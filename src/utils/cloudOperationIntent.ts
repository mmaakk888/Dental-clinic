/** Prepared owner-bound server recovery journal. No SDK, browser persistence,
 * activation or domain authorization. Future combined Rules must enforce these
 * transitions and couple committed intent + domain receipt atomically. */
export type CloudOperationKind = 'patient-profile' | 'contact' | 'clinical' | 'catalog' | 'appointment'
  | 'prosthetic' | 'expense' | 'settings';
export type CloudIntentJson = null | boolean | number | string | CloudIntentJson[] | { [key: string]: CloudIntentJson };
export interface CloudOperationIntent {
  schemaVersion: 1; clinicId: 'main'; recordId: string; operationId: string;
  actorUid: string; kind: CloudOperationKind; requestHash: string;
  status: 'prepared' | 'committed' | 'cancelled'; revision: 1 | 2;
  createdAt: string; command: { [key: string]: CloudIntentJson };
}
export interface CloudIntentTransaction {
  get(path: string): Promise<unknown | null>; set(path: string, value: object): void;
}
export interface CloudIntentAdapter {
  authorizeOwner(): Promise<string>;
  runTransaction<T>(work: (transaction: CloudIntentTransaction) => Promise<T>): Promise<T>;
  readRecord?(path: string): Promise<unknown | null>;
  listPreparedPage?(kind: CloudOperationKind, actorUid: string, afterId: string | null, limit: number): Promise<unknown>;
  /** Includes committed intents: an accepted write can lose its acknowledgement. */
  listHistoryPage?(kind: CloudOperationKind, actorUid: string, afterId: string | null, limit: number): Promise<unknown>;
}
export interface CloudIntentOptions { digest?: (text: string) => Promise<string> }
export class CloudOperationIntentError extends Error {
  constructor(public readonly code: 'invalid' | 'conflict' | 'unavailable') {
    super(({ invalid: 'بيانات عملية الاسترجاع غير صالحة.', conflict: 'تغيّرت حالة العملية؛ راجع سجلها قبل تكرارها.',
      unavailable: 'تعذر تأكيد حالة العملية من الخادم.' })[code]);
    this.name = 'CloudOperationIntentError';
  }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const validId = (value: unknown): value is string => typeof value === 'string' && value.length === 36 && UUID.test(value);
const validActor = (value: unknown): value is string => typeof value === 'string' && value.length > 0
  && value.length <= 128 && value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value);
const validKind = (value: unknown): value is CloudOperationKind => ['patient-profile', 'contact', 'clinical', 'catalog', 'appointment',
  'prosthetic', 'expense', 'settings'].includes(value as string);
function invalid(): never { throw new CloudOperationIntentError('invalid'); }
function conflict(): never { throw new CloudOperationIntentError('conflict'); }
function unavailable(): never { throw new CloudOperationIntentError('unavailable'); }
function safeError(value: unknown) {
  try { if (value instanceof CloudOperationIntentError && ['invalid', 'conflict', 'unavailable'].includes(value.code)) return new CloudOperationIntentError(value.code); }
  catch { /* Only fixed errors leave this module. */ }
  return new CloudOperationIntentError('unavailable');
}
function date(value: unknown): value is string {
  if (typeof value !== 'string' || value.length !== 24 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    || value < '1900-01-01T00:00:00.000Z' || value > '9999-12-31T23:59:59.999Z') return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}
function fields(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  const keys = Reflect.ownKeys(value);
  if (keys.length > 256 || keys.some(key => typeof key !== 'string' || !key || key.length > 128
    || ['__proto__', 'prototype', 'constructor'].includes(key))) invalid();
  const result: Record<string, unknown> = {};
  for (const key of (keys as string[]).sort()) {
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (!property || !('value' in property) || !property.enumerable) invalid();
    result[key] = property.value;
  }
  return result;
}
function json(value: unknown, depth: number, budget: { nodes: number; bytes: number }): CloudIntentJson {
  if (++budget.nodes > 16_000 || depth > 8) invalid();
  if (value === null) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') { if (!Number.isFinite(value) || Object.is(value, -0)) invalid(); return value; }
  if (typeof value === 'string') {
    budget.bytes += new TextEncoder().encode(value).byteLength;
    if (budget.bytes > 128 * 1024) invalid(); return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 2048 || Reflect.ownKeys(value).length !== value.length + 1) invalid();
    return Array.from({ length: value.length }, (_, index) => {
      const property = Object.getOwnPropertyDescriptor(value, String(index));
      if (!property || !('value' in property) || !property.enumerable) invalid();
      return json(property.value, depth + 1, budget);
    });
  }
  const result: { [key: string]: CloudIntentJson } = {};
  for (const [key, item] of Object.entries(fields(value))) {
    budget.bytes += new TextEncoder().encode(key).byteLength;
    if (budget.bytes > 128 * 1024) invalid(); result[key] = json(item, depth + 1, budget);
  }
  return result;
}
export function prepareCloudIntentCommand(value: unknown): { [key: string]: CloudIntentJson } {
  try {
    const command = json(fields(value), 0, { nodes: 0, bytes: 0 }) as { [key: string]: CloudIntentJson };
    if (!validId(command.operationId) || new TextEncoder().encode(JSON.stringify(command)).byteLength > 128 * 1024) invalid();
    return command;
  } catch { return invalid(); }
}
export function parseCloudOperationIntent(value: unknown): CloudOperationIntent {
  try {
    const item = fields(value), keys = ['schemaVersion', 'clinicId', 'recordId', 'operationId', 'actorUid', 'kind',
      'requestHash', 'status', 'revision', 'createdAt', 'command'];
    if (Object.keys(item).length !== keys.length || keys.some(key => !Object.hasOwn(item, key))
      || item.schemaVersion !== 1 || item.clinicId !== 'main' || !validId(item.operationId) || item.recordId !== item.operationId
      || !validActor(item.actorUid) || !validKind(item.kind) || typeof item.requestHash !== 'string'
      || item.requestHash.length !== 64 || !/^[0-9a-f]{64}$/.test(item.requestHash) || !date(item.createdAt)
      || !['prepared', 'committed', 'cancelled'].includes(item.status as string)
      || item.revision !== (item.status === 'prepared' ? 1 : 2)) invalid();
    const command = prepareCloudIntentCommand(item.command);
    if (command.operationId !== item.operationId) invalid();
    return { schemaVersion: 1, clinicId: 'main', recordId: item.operationId, operationId: item.operationId,
      actorUid: item.actorUid, kind: item.kind, requestHash: item.requestHash, status: item.status as CloudOperationIntent['status'],
      revision: item.revision as 1 | 2, createdAt: item.createdAt, command };
  } catch { return invalid(); }
}
async function sha256(value: string) {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, '0')).join('');
}
async function fingerprint(actorUid: string, kind: CloudOperationKind, command: object, options: CloudIntentOptions) {
  const result = await (options.digest ?? sha256)(JSON.stringify(['clinic-operation-intent-v1', actorUid, kind, command]));
  if (typeof result !== 'string' || result.length !== 64 || !/^[0-9a-f]{64}$/.test(result)) invalid();
  return result;
}
const path = (id: string) => `clinics/main/operationIntents/${id}`;
const receiptPath = (kind: CloudOperationKind, id: string) => `clinics/main/${
  ({ 'patient-profile': 'patientOperations', contact: 'contactOperations', clinical: 'clinicalOperations', catalog: 'catalogOperations',
    appointment: 'appointmentOperations', prosthetic: 'prostheticOperations', expense: 'expenseOperations', settings: 'settingsOperations' })[kind]}/${id}`;
async function checked(value: unknown, uid: string, id: string, options: CloudIntentOptions) {
  const intent = parseCloudOperationIntent(value);
  if (intent.actorUid !== uid || intent.operationId !== id) conflict();
  if (intent.requestHash !== await fingerprint(uid, intent.kind, intent.command, options)) invalid();
  return intent;
}

/** Must be called INSIDE the actual domain transaction, before any writes.
 * The domain independently validates its own immutable receipt/fingerprint.
 * This helper permits committed replay, but the caller must require the
 * matching domain receipt; prepared must require its absence. */
export async function readCloudOperationIntentForCommit(transaction: CloudIntentTransaction,
  expected: { actorUid: string; kind: CloudOperationKind; command: unknown }, options: CloudIntentOptions = {}) {
  try {
    if (!validActor(expected.actorUid) || !validKind(expected.kind)) invalid();
    const command = prepareCloudIntentCommand(expected.command), id = command.operationId as string;
    const intent = await checked(await transaction.get(path(id)), expected.actorUid, id, options);
    if (intent.kind !== expected.kind || JSON.stringify(intent.command) !== JSON.stringify(command)
      || intent.status === 'cancelled') conflict();
    return intent;
  } catch (error) { throw safeError(error); }
}
/** Not an independent confirmation API: caller stages this with the actual
 * domain receipt in the SAME transaction. Never call on a client boolean. */
export function markCloudOperationIntentCommitted(transaction: CloudIntentTransaction, value: CloudOperationIntent) {
  const intent = parseCloudOperationIntent(value);
  if (intent.status !== 'prepared') conflict();
  transaction.set(path(intent.operationId), { ...intent, status: 'committed', revision: 2 });
}

export function createCloudOperationIntentRepository(adapter: CloudIntentAdapter, options: CloudIntentOptions = {}) {
  const authorize = async () => { const uid = await adapter.authorizeOwner(); if (!validActor(uid)) invalid(); return uid; };
  const reauthorize = async (uid: string) => { if (await authorize() !== uid) unavailable(); };
  async function consistentReceipt(transaction: CloudIntentTransaction, intent: CloudOperationIntent) {
    const exists = await transaction.get(receiptPath(intent.kind, intent.operationId)) !== null;
    if (exists !== (intent.status === 'committed')) conflict();
  }
  async function list(kind: CloudOperationKind, input: { afterId?: string | null; limit?: number }, preparedOnly: boolean) {
    try {
      const item = fields(input), keys = Object.keys(item), after = item.afterId ?? null, limit = item.limit === undefined ? 25 : item.limit;
      if (!validKind(kind) || keys.some(key => !['afterId', 'limit'].includes(key))
        || after !== null && !validId(after) || typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 50) invalid();
      const uid = await authorize(), reader = preparedOnly ? adapter.listPreparedPage : adapter.listHistoryPage;
      if (!reader) unavailable();
      const raw = await reader.call(adapter, kind, uid, after as string | null, limit);
      if (!Array.isArray(raw) || raw.length > limit || Reflect.ownKeys(raw).length !== raw.length + 1) invalid();
      const records: CloudOperationIntent[] = []; let previous = after as string | null;
      for (let index = 0; index < raw.length; index++) {
        const property = Object.getOwnPropertyDescriptor(raw, String(index));
        if (!property || !('value' in property) || !property.enumerable) invalid();
        const row = fields(property.value);
        if (Object.keys(row).length !== 2 || !Object.hasOwn(row, 'id') || !Object.hasOwn(row, 'data')
          || !validId(row.id) || previous !== null && row.id <= previous) invalid();
        const intent = await checked(row.data, uid, row.id, options);
        if (intent.kind !== kind || preparedOnly && intent.status !== 'prepared') invalid();
        records.push(intent); previous = row.id;
      }
      await reauthorize(uid); return { records, nextAfterId: records.length === limit ? previous : null };
    } catch (error) { throw safeError(error); }
  }
  return {
    async prepare(kind: CloudOperationKind, input: unknown, createdAt: string): Promise<CloudOperationIntent> {
      try {
        if (!validKind(kind) || !date(createdAt)) invalid();
        const command = prepareCloudIntentCommand(input), uid = await authorize(), id = command.operationId as string;
        const intent: CloudOperationIntent = { schemaVersion: 1, clinicId: 'main', recordId: id, operationId: id,
          actorUid: uid, kind, requestHash: await fingerprint(uid, kind, command, options),
          status: 'prepared', revision: 1, createdAt, command };
        await reauthorize(uid);
        const result = await adapter.runTransaction(async transaction => {
          await reauthorize(uid);
          const stored = await transaction.get(path(id));
          if (stored !== null) {
            const previous = await checked(stored, uid, id, options);
            if (previous.kind !== kind || previous.requestHash !== intent.requestHash || previous.createdAt !== createdAt
              || JSON.stringify(previous.command) !== JSON.stringify(command)) conflict();
            await consistentReceipt(transaction, previous); await reauthorize(uid); return previous;
          }
          if (await transaction.get(receiptPath(kind, id)) !== null) conflict();
          await reauthorize(uid); transaction.set(path(id), intent); return intent;
        });
        await reauthorize(uid); return parseCloudOperationIntent(result);
      } catch (error) { throw safeError(error); }
    },
    async get(id: string): Promise<CloudOperationIntent | null> {
      try {
        if (!validId(id)) invalid(); const uid = await authorize();
        if (!adapter.readRecord) unavailable();
        const value = await adapter.readRecord(path(id)); await reauthorize(uid);
        const result = value === null ? null : await checked(value, uid, id, options);
        await reauthorize(uid); return result;
      } catch (error) { throw safeError(error); }
    },
    async listPreparedPage(kind: CloudOperationKind, input: { afterId?: string | null; limit?: number } = {}) {
      return list(kind, input, true);
    },
    async listHistoryPage(kind: CloudOperationKind, input: { afterId?: string | null; limit?: number } = {}) {
      return list(kind, input, false);
    },
    async cancel(id: string): Promise<CloudOperationIntent> {
      try {
        if (!validId(id)) invalid(); const uid = await authorize();
        const result = await adapter.runTransaction(async transaction => {
          await reauthorize(uid);
          const intent = await checked(await transaction.get(path(id)), uid, id, options);
          await consistentReceipt(transaction, intent); await reauthorize(uid);
          if (intent.status === 'committed') conflict();
          if (intent.status === 'cancelled') return intent;
          const cancelled: CloudOperationIntent = { ...intent, status: 'cancelled', revision: 2 };
          transaction.set(path(id), cancelled); return cancelled;
        });
        await reauthorize(uid); return parseCloudOperationIntent(result);
      } catch (error) { throw safeError(error); }
    },
  };
}
type IntentRepository = ReturnType<typeof createCloudOperationIntentRepository>;
/** Older isolated capabilities may not support history. Recovery must fail
 * closed in that case, never substitute the prepared-only queue. */
export type CloudOperationIntentRepository = Omit<IntentRepository, 'listHistoryPage'>
  & Partial<Pick<IntentRepository, 'listHistoryPage'>>;
