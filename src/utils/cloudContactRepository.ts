import type { ClinicContact } from '../types';
import { clinicContactValidationError, normalizeContactPhone } from './clinicContacts';

// Transaction core only. No SDK initialization, local fallback, account data,
// network, or automatic migration. A future adapter must enforce owner access
// in server rules, then implement runTransaction with Firestore transactions.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const MAX_REVISION = 2_000_000_000;
const INVALID = 'بيانات عملية جهات الاتصال غير صالحة؛ لم يتم تأكيد الحفظ.';

export class CloudContactError extends Error {
  constructor(public readonly code: 'invalid' | 'conflict' | 'duplicate' | 'unavailable') {
    super({ invalid: INVALID, conflict: 'تغيّرت جهة الاتصال. أعد فتحها قبل الحفظ.',
      duplicate: 'رقم الموبايل موجود بالفعل في جهات الاتصال.',
      unavailable: 'تعذّر تأكيد الحفظ السحابي. احتفظ بالمسودة وأعد المحاولة بنفس العملية.' }[code]);
  }
}

type Action = 'create' | 'update' | 'delete';
export interface CloudContactCommand {
  operationId: string;
  recordId: string;
  expectedRevision: number;
  action: Action;
  contact: ClinicContact | null;
}
export interface CloudContactRecord {
  schemaVersion: 1;
  clinicId: 'main';
  recordId: string;
  revision: number;
  deleted: boolean;
  lastOperationId: string;
  /** Server-validated derived key; null only for tombstones. Not encryption. */
  phoneKey: string | null;
  data: ClinicContact | null;
}
export interface CloudContactCommit {
  status: 'committed' | 'already-committed';
  recordId: string;
  revision: number;
}
export interface CloudContactTransaction {
  get(path: string): Promise<unknown | null>;
  set(path: string, value: object): void;
  delete(path: string): void;
}
export interface CloudContactAdapter {
  /** Must fail closed on sign-out, stale membership, or changed identity. */
  authorizeOwner(): Promise<string>;
  /** Must resolve only after an atomic server commit, never an offline enqueue. */
  runTransaction<T>(work: (transaction: CloudContactTransaction) => Promise<T>): Promise<T>;
}
export interface CloudContactRepositoryOptions {
  // Injected only for deterministic synthetic tests; production defaults to SHA-256.
  digest?: (text: string) => Promise<string>;
}

function invalid(): never { throw new CloudContactError('invalid'); }
function record(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) invalid();
  const keys = Reflect.ownKeys(value);
  if (required.some(key => !keys.includes(key)) || keys.some(key => typeof key !== 'string' || ![...required, ...optional].includes(key))) invalid();
  const copy: Record<string, unknown> = {};
  for (const key of keys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) invalid();
    copy[key] = descriptor.value;
  }
  return copy;
}
function contact(value: unknown): ClinicContact {
  const fields = record(value, ['id', 'name', 'mobile', 'createdAt'], ['notes']);
  if (clinicContactValidationError(fields)) invalid();
  // The phone index alone uses an equivalent canonical number; original display
  // values are retained. This is not a migration/import codec.
  return { id: fields.id as string, name: fields.name as string, mobile: fields.mobile as string,
    createdAt: fields.createdAt as string, ...(fields.notes === undefined ? {} : { notes: fields.notes as string }) };
}
function revision(value: unknown, allowZero = false): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= (allowZero ? 0 : 1) && value <= MAX_REVISION;
}
function uid(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value);
}
export function parseCloudContactRecord(value: unknown): CloudContactRecord {
  try {
    const fields = record(value, ['schemaVersion', 'clinicId', 'recordId', 'revision', 'deleted', 'lastOperationId', 'phoneKey', 'data']);
    if (fields.schemaVersion !== 1 || fields.clinicId !== 'main' || typeof fields.recordId !== 'string' || !UUID.test(fields.recordId)
      || !revision(fields.revision) || typeof fields.deleted !== 'boolean' || typeof fields.lastOperationId !== 'string' || !UUID.test(fields.lastOperationId)) invalid();
    if (fields.deleted && fields.data !== null || !fields.deleted && fields.data === null) invalid();
    if (fields.deleted ? fields.phoneKey !== null : typeof fields.phoneKey !== 'string' || !HASH.test(fields.phoneKey)) invalid();
    const data = fields.deleted ? null : contact(fields.data);
    if (data && data.id !== fields.recordId) invalid();
    return { schemaVersion: 1, clinicId: 'main', recordId: fields.recordId, revision: fields.revision,
      deleted: fields.deleted, lastOperationId: fields.lastOperationId, phoneKey: fields.phoneKey as string | null, data };
  } catch { return invalid(); }
}
function command(value: unknown): CloudContactCommand {
  const fields = record(value, ['operationId', 'recordId', 'expectedRevision', 'action', 'contact']);
  if (typeof fields.operationId !== 'string' || !UUID.test(fields.operationId) || typeof fields.recordId !== 'string' || !UUID.test(fields.recordId)
    || !revision(fields.expectedRevision, true) || fields.expectedRevision >= MAX_REVISION
    || !['create', 'update', 'delete'].includes(fields.action as string)
    || (fields.action === 'create') !== (fields.expectedRevision === 0)
    || (fields.action === 'delete') !== (fields.contact === null)) invalid();
  const data = fields.contact === null ? null : contact(fields.contact);
  if (data && data.id !== fields.recordId) invalid();
  return { operationId: fields.operationId, recordId: fields.recordId, expectedRevision: fields.expectedRevision,
    action: fields.action as Action, contact: data };
}
async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
const recordPath = (id: string) => `clinics/main/contactRecords/${id}`;
const operationPath = (id: string) => `clinics/main/contactOperations/${id}`;
const phonePath = (key: string) => `clinics/main/contactPhones/${key}`;
function phoneIndex(value: unknown, key: string): string | null {
  if (value === null) return null;
  const fields = record(value, ['schemaVersion', 'clinicId', 'phoneKey', 'recordId']);
  if (fields.schemaVersion !== 1 || fields.clinicId !== 'main' || fields.phoneKey !== key || typeof fields.recordId !== 'string' || !UUID.test(fields.recordId)) invalid();
  return fields.recordId;
}

export function createCloudContactRepository(adapter: CloudContactAdapter, options: CloudContactRepositoryOptions = {}) {
  const digest = options.digest ?? sha256;
  const hash = async (text: string) => { const value = await digest(text); if (!HASH.test(value)) invalid(); return value; };
  return {
    async commit(input: CloudContactCommand): Promise<CloudContactCommit> {
      try {
        // Clone, validate, and hash before a retried callback. Operation/record
        // IDs come from the caller and must be retained after an uncertain reply.
        const prepared = command(input);
        const actorUid = await adapter.authorizeOwner();
        if (!uid(actorUid)) invalid();
        const requestHash = await hash(JSON.stringify([actorUid, prepared.operationId, prepared.recordId,
          prepared.expectedRevision, prepared.action, prepared.contact]));
        const nextPhoneKey = prepared.contact ? await hash(`contact-phone-v1:${normalizeContactPhone(prepared.contact.mobile)}`) : null;
        const receipt = { schemaVersion: 1, clinicId: 'main', operationId: prepared.operationId, actorUid,
          recordId: prepared.recordId, action: prepared.action, expectedRevision: prepared.expectedRevision,
          resultRevision: prepared.expectedRevision + 1, requestHash };
        const result = await adapter.runTransaction<CloudContactCommit>(async transaction => {
          if (await adapter.authorizeOwner() !== actorUid) throw new CloudContactError('unavailable');
          const existingReceipt = await transaction.get(operationPath(prepared.operationId));
          if (existingReceipt !== null) {
            const checked = record(existingReceipt, Object.keys(receipt));
            if (Object.keys(receipt).some(key => checked[key] !== receipt[key as keyof typeof receipt])) throw new CloudContactError('conflict');
            if (await adapter.authorizeOwner() !== actorUid) throw new CloudContactError('unavailable');
            return { status: 'already-committed', recordId: prepared.recordId, revision: receipt.resultRevision };
          }
          const existing = await transaction.get(recordPath(prepared.recordId));
          const current = existing === null ? null : parseCloudContactRecord(existing);
          if (current?.recordId !== undefined && current.recordId !== prepared.recordId) invalid();
          if (prepared.action === 'create' ? current !== null : !current || current.deleted || current.revision !== prepared.expectedRevision) throw new CloudContactError('conflict');
          if (current?.data && prepared.contact && (current.data.id !== prepared.contact.id || current.data.createdAt !== prepared.contact.createdAt)) throw new CloudContactError('conflict');
          const oldPhoneKey = current?.data ? await hash(`contact-phone-v1:${normalizeContactPhone(current.data.mobile)}`) : null;
          if (current && current.phoneKey !== oldPhoneKey) invalid();
          const keys = Array.from(new Set([oldPhoneKey, nextPhoneKey].filter((key): key is string => key !== null)));
          const indexes = new Map<string, string | null>();
          for (const key of keys) indexes.set(key, phoneIndex(await transaction.get(phonePath(key)), key));
          if (oldPhoneKey && indexes.get(oldPhoneKey) !== prepared.recordId) throw new CloudContactError('conflict');
          if (nextPhoneKey && indexes.get(nextPhoneKey) !== null && indexes.get(nextPhoneKey) !== prepared.recordId) throw new CloudContactError('duplicate');
          // All reads precede writes. Recheck authorization immediately before
          // scheduling writes; authoritative rules must recheck at server commit.
          if (await adapter.authorizeOwner() !== actorUid) throw new CloudContactError('unavailable');
          if (oldPhoneKey && oldPhoneKey !== nextPhoneKey) transaction.delete(phonePath(oldPhoneKey));
          if (nextPhoneKey) transaction.set(phonePath(nextPhoneKey), { schemaVersion: 1, clinicId: 'main', phoneKey: nextPhoneKey, recordId: prepared.recordId });
          transaction.set(recordPath(prepared.recordId), { schemaVersion: 1, clinicId: 'main', recordId: prepared.recordId,
            revision: receipt.resultRevision, deleted: prepared.action === 'delete', lastOperationId: prepared.operationId, phoneKey: nextPhoneKey, data: prepared.contact });
          transaction.set(operationPath(prepared.operationId), receipt);
          return { status: 'committed', recordId: prepared.recordId, revision: receipt.resultRevision };
        });
        // An acknowledged historical receipt is not a current record snapshot.
        // The future UI must refresh server data, never publish the command as
        // the latest record, especially after an already-committed response.
        if (await adapter.authorizeOwner() !== actorUid) throw new CloudContactError('unavailable');
        return result;
      } catch (error) {
        if (error instanceof CloudContactError) throw error;
        throw new CloudContactError('unavailable');
      }
    },
  };
}
