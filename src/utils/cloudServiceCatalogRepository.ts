import { CloudOperationIntentError, readCloudOperationIntentForCommit,
  markCloudOperationIntentCommitted } from './cloudOperationIntent';

/** Owner-only protected service pricing contract. This pure module never
 * imports local settings, invents a fee, seeds a catalog or charges a patient.
 * Future Rules must enforce the same singleton/receipt/intent coupling. */
export interface CloudServiceDefinition {
  serviceId: string; name: string; kind: 'clinical' | 'prosthetic'; priceCents: number | null; active: boolean;
}
export interface CloudServiceCatalogData { examinationCents: number; services: CloudServiceDefinition[] }
export interface CloudServiceCatalogRecord {
  schemaVersion: 1; clinicId: 'main'; recordId: 'serviceCatalog'; revision: number;
  lastOperationId: string; data: CloudServiceCatalogData;
}
export interface CloudServiceCatalogCommand {
  operationId: string; expectedRevision: number; createdAt: string; data: CloudServiceCatalogData;
}
export interface CloudServiceCatalogCommit {
  status: 'committed' | 'already-committed'; recordId: 'serviceCatalog'; revision: number;
}
export interface CloudServiceCatalogTransaction {
  get(path: string): Promise<unknown | null>; set(path: string, value: object): void;
}
export interface CloudServiceCatalogAdapter {
  authorizeOwner(): Promise<string>;
  runTransaction<T>(work: (transaction: CloudServiceCatalogTransaction) => Promise<T>): Promise<T>;
  readRecord?(path: string): Promise<unknown | null>;
}
export interface CloudServiceCatalogOptions { digest?: (text: string) => Promise<string> }
export class CloudServiceCatalogError extends Error {
  constructor(public readonly code: 'invalid' | 'conflict' | 'unavailable') {
    super(({ invalid: 'بيانات الخدمات والتسعير غير صالحة.', conflict: 'تغيرت قائمة الخدمات؛ راجع أحدث الأسعار قبل الحفظ.',
      unavailable: 'تعذر تأكيد حفظ الخدمات والتسعير من الخادم.' })[code]);
    this.name = 'CloudServiceCatalogError';
  }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_REVISION = 2_000_000_000, MAX_CENTS = 1_000_000_000_000;
/** Leaves room for the command envelope inside the128 KiB durable journal.
 * Row/character limits apply in addition to this overall UTF-8 JSON budget. */
export const MAX_CLOUD_SERVICE_CATALOG_BYTES = 120 * 1024;
const CATALOG_PATH = 'clinics/main/settings/serviceCatalog';
const receiptPath = (id: string) => `clinics/main/catalogOperations/${id}`;
function invalid(): never { throw new CloudServiceCatalogError('invalid'); }
function conflict(): never { throw new CloudServiceCatalogError('conflict'); }
function unavailable(): never { throw new CloudServiceCatalogError('unavailable'); }
function safeError(value: unknown): CloudServiceCatalogError {
  try {
    if ((value instanceof CloudServiceCatalogError || value instanceof CloudOperationIntentError)
      && ['invalid', 'conflict', 'unavailable'].includes(value.code)) return new CloudServiceCatalogError(value.code);
  } catch { /* Never return provider or arbitrary object details. */ }
  return new CloudServiceCatalogError('unavailable');
}
function fields(value: unknown, required: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== required.length || required.some(key => !keys.includes(key))) invalid();
  const result: Record<string, unknown> = {};
  for (const key of required) {
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (!property || !('value' in property) || !property.enumerable) invalid();
    result[key] = property.value;
  }
  return result;
}
const uuid = (value: unknown): value is string => typeof value === 'string' && value.length === 36 && UUID.test(value);
const integer = (value: unknown, min: number, max: number): value is number => typeof value === 'number'
  && Number.isSafeInteger(value) && !Object.is(value, -0) && value >= min && value <= max;
const actor = (value: unknown): value is string => typeof value === 'string' && value.length > 0
  && value.length <= 128 && value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value);
function timestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.length !== 24 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    || value < '1900-01-01T00:00:00.000Z' || value > '9999-12-31T23:59:59.999Z') return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}
function normalizedName(value: string) {
  return value.normalize('NFKC').replace(/[٠-٩۰-۹]/g, digit => {
    const code = digit.charCodeAt(0); return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  }).replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '').replace(/ـ/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/[ىی]/g, 'ي').replace(/\s+/gu, ' ').trim().toLowerCase();
}
function services(value: unknown): CloudServiceDefinition[] {
  if (!Array.isArray(value) || value.length > 300 || Reflect.ownKeys(value).length !== value.length + 1) invalid();
  const ids = new Set<string>(), names = new Set<string>();
  return Array.from({ length: value.length }, (_, index) => {
    const property = Object.getOwnPropertyDescriptor(value, String(index));
    if (!property || !('value' in property) || !property.enumerable) invalid();
    const row = fields(property.value, ['serviceId', 'name', 'kind', 'priceCents', 'active']);
    if (!uuid(row.serviceId) || ids.has(row.serviceId) || typeof row.name !== 'string' || !row.name
      || row.name !== row.name.trim() || [...row.name].length > 80 || /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(row.name)
      || !['clinical', 'prosthetic'].includes(row.kind as string)
      || row.priceCents !== null && !integer(row.priceCents, 0, MAX_CENTS) || typeof row.active !== 'boolean') invalid();
    const key = normalizedName(row.name);
    if (!key || ['__proto__', 'prototype', 'constructor'].includes(key) || names.has(key)) invalid();
    ids.add(row.serviceId); names.add(key);
    return { serviceId: row.serviceId, name: row.name, kind: row.kind as CloudServiceDefinition['kind'],
      priceCents: row.priceCents as number | null, active: row.active };
  });
}
export function parseCloudServiceCatalogData(value: unknown): CloudServiceCatalogData {
  try {
    const item = fields(value, ['examinationCents', 'services']);
    if (!integer(item.examinationCents, 0, MAX_CENTS)) invalid();
    const result = { examinationCents: item.examinationCents, services: services(item.services) };
    if (new TextEncoder().encode(JSON.stringify(result)).byteLength > MAX_CLOUD_SERVICE_CATALOG_BYTES) invalid();
    return result;
  } catch { return invalid(); }
}
export function parseCloudServiceCatalogRecord(value: unknown): CloudServiceCatalogRecord {
  try {
    const item = fields(value, ['schemaVersion', 'clinicId', 'recordId', 'revision', 'lastOperationId', 'data']);
    if (item.schemaVersion !== 1 || item.clinicId !== 'main' || item.recordId !== 'serviceCatalog'
      || !integer(item.revision, 1, MAX_REVISION) || !uuid(item.lastOperationId)) invalid();
    return { schemaVersion: 1, clinicId: 'main', recordId: 'serviceCatalog', revision: item.revision,
      lastOperationId: item.lastOperationId, data: parseCloudServiceCatalogData(item.data) };
  } catch { return invalid(); }
}
/** A full replacement is snapshotted before authorization or hashing awaits. */
export function prepareCloudServiceCatalogCommand(value: unknown): CloudServiceCatalogCommand {
  try {
    const item = fields(value, ['operationId', 'expectedRevision', 'createdAt', 'data']);
    if (!uuid(item.operationId) || !integer(item.expectedRevision, 0, MAX_REVISION - 1) || !timestamp(item.createdAt)) invalid();
    return { operationId: item.operationId, expectedRevision: item.expectedRevision, createdAt: item.createdAt,
      data: parseCloudServiceCatalogData(item.data) };
  } catch { return invalid(); }
}
async function sha256(value: string) {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, '0')).join('');
}
export function createCloudServiceCatalogRepository(adapter: CloudServiceCatalogAdapter, options: CloudServiceCatalogOptions = {}) {
  const digest = options.digest ?? sha256;
  const authorize = async () => { const uid = await adapter.authorizeOwner(); if (!actor(uid)) invalid(); return uid; };
  const reauthorize = async (uid: string) => { if (await authorize() !== uid) unavailable(); };
  return {
    async get(): Promise<CloudServiceCatalogRecord | null> {
      try {
        const uid = await authorize(); if (!adapter.readRecord) unavailable();
        const value = await adapter.readRecord(CATALOG_PATH);
        await reauthorize(uid);
        const result = value === null ? null : parseCloudServiceCatalogRecord(value);
        await reauthorize(uid); return result;
      } catch (error) { throw safeError(error); }
    },
    async commit(input: unknown): Promise<CloudServiceCatalogCommit> {
      try {
        const command = prepareCloudServiceCatalogCommand(input), uid = await authorize();
        const requestHash = await digest(JSON.stringify(['clinic-service-catalog-v1', uid, command]));
        if (typeof requestHash !== 'string' || requestHash.length !== 64 || !/^[0-9a-f]{64}$/.test(requestHash)) invalid();
        const receipt = { schemaVersion: 1, clinicId: 'main', operationId: command.operationId, recordId: 'serviceCatalog',
          actorUid: uid, expectedRevision: command.expectedRevision, resultRevision: command.expectedRevision + 1,
          createdAt: command.createdAt, requestHash };
        await reauthorize(uid);
        const result = await adapter.runTransaction<CloudServiceCatalogCommit>(async transaction => {
          await reauthorize(uid);
          const oldReceipt = await transaction.get(receiptPath(command.operationId));
          const intent = await readCloudOperationIntentForCommit(transaction, { actorUid: uid, kind: 'catalog', command }, { digest });
          if (intent.createdAt !== command.createdAt || intent.status !== (oldReceipt === null ? 'prepared' : 'committed')) conflict();
          if (oldReceipt !== null) {
            const old = fields(oldReceipt, Object.keys(receipt));
            if (Object.keys(receipt).some(key => old[key] !== receipt[key as keyof typeof receipt])) conflict();
            await reauthorize(uid);
            // This acknowledges the historical operation, NOT today's catalog.
            // The caller must get() again before showing current prices.
            return { status: 'already-committed', recordId: 'serviceCatalog', revision: receipt.resultRevision };
          }
          const raw = await transaction.get(CATALOG_PATH), current = raw === null ? null : parseCloudServiceCatalogRecord(raw);
          if ((current?.revision ?? 0) !== command.expectedRevision) conflict();
          const next: CloudServiceCatalogRecord = { schemaVersion: 1, clinicId: 'main', recordId: 'serviceCatalog',
            revision: receipt.resultRevision, lastOperationId: command.operationId, data: command.data };
          parseCloudServiceCatalogRecord(next);
          // All reads precede writes, including the durable intent + operation
          // receipt. No reset, independent acknowledgement or patient charge.
          await reauthorize(uid);
          transaction.set(CATALOG_PATH, next);
          transaction.set(receiptPath(command.operationId), receipt);
          markCloudOperationIntentCommitted(transaction, intent);
          return { status: 'committed', recordId: 'serviceCatalog', revision: next.revision };
        });
        await reauthorize(uid);
        const checked = fields(result, ['status', 'recordId', 'revision']);
        if (!['committed', 'already-committed'].includes(checked.status as string) || checked.recordId !== 'serviceCatalog'
          || checked.revision !== command.expectedRevision + 1) invalid();
        return { status: checked.status as CloudServiceCatalogCommit['status'], recordId: 'serviceCatalog', revision: checked.revision as number };
      } catch (error) { throw safeError(error); }
    },
  };
}
export type CloudServiceCatalogRepository = ReturnType<typeof createCloudServiceCatalogRepository>;
