import { normalizeContactPhone } from './clinicContacts';
import { CloudOperationIntentError, readCloudOperationIntentForCommit, markCloudOperationIntentCommitted } from './cloudOperationIntent';

/** Prepared profile-only storage. NOT a migration codec or an enabled clinical
 * feature. Sessions, receipts and private lab costs belong to separate domains.
 * The counter must be initialized by trusted setup after empty-store checks;
 * a missing counter is never silently interpreted as a fresh clinic. */
export interface CloudPatientProfile {
  name: string; mobile: string; age: number; gender: string;
  firstVisit: string; notes: string; allergy: string;
}
export interface CloudPatientRecord {
  schemaVersion: 1; clinicId: 'main'; recordId: string; fileNo: number;
  revision: number; lastOperationId: string; phoneKey: string | null;
  data: CloudPatientProfile;
}
export interface CloudPatientCommand {
  operationId: string; recordId: string; expectedRevision: number;
  action: 'create' | 'update'; profile: CloudPatientProfile;
}
/** Explicit owner historical-number import, never a general upsert. Existing
 * create/update command shapes and retry fingerprints remain unchanged. */
export interface CloudPatientImportCommand {
  operationId: string; recordId: string; expectedRevision: 0;
  action: 'import'; fileNo: number; profile: CloudPatientProfile;
}
export type CloudPatientWriteCommand = CloudPatientCommand | CloudPatientImportCommand;
export interface CloudPatientCommit {
  status: 'committed' | 'already-committed'; recordId: string; fileNo: number; revision: number;
}
export interface CloudPatientPageInput { afterId?: string | null; limit?: number }
export interface CloudPatientPhoneInput extends CloudPatientPageInput { mobile: string }
export interface CloudPatientPage { records: CloudPatientRecord[]; nextAfterId: string | null }
export interface CloudPatientTransaction {
  get(path: string): Promise<unknown | null>;
  set(path: string, value: object): void;
}
export interface CloudPatientAdapter {
  authorizeOwner(): Promise<string>;
  runTransaction<T>(work: (transaction: CloudPatientTransaction) => Promise<T>): Promise<T>;
  readRecord?(path: string): Promise<unknown | null>;
  listRecordsPage?(afterId: string | null, limit: number): Promise<unknown>;
  findRecordsByPhone?(phoneKey: string, afterId: string | null, limit: number): Promise<unknown>;
}
export interface CloudPatientRepositoryOptions { digest?: (text: string) => Promise<string> }
export class CloudPatientError extends Error {
  constructor(public readonly code: 'invalid' | 'conflict' | 'unavailable') {
    super(({ invalid: 'بيانات ملف المريض غير صالحة.', conflict: 'تغير الملف أو محاولة الحفظ؛ أعد قراءة الملف قبل التعديل.',
      unavailable: 'تعذر تأكيد عملية ملف المريض من الخادم.' })[code]);
    this.name = 'CloudPatientError';
  }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const MAX = 2_000_000_000;
function invalid(): never { throw new CloudPatientError('invalid'); }
function unavailable(): never { throw new CloudPatientError('unavailable'); }
function safeError(error: unknown): CloudPatientError {
  try {
    if (error instanceof CloudPatientError && ['invalid', 'conflict', 'unavailable'].includes(error.code)) return new CloudPatientError(error.code);
    if (error instanceof CloudOperationIntentError && ['invalid', 'conflict', 'unavailable'].includes(error.code)) return new CloudPatientError(error.code);
  } catch { /* No raw provider/hostile object details. */ }
  return new CloudPatientError('unavailable');
}
function fields(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  const keys = Reflect.ownKeys(value);
  if (required.some(key => !keys.includes(key)) || keys.some(key => typeof key !== 'string' || ![...required, ...optional].includes(key))) invalid();
  const result: Record<string, unknown> = {};
  for (const key of keys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) invalid();
    result[key] = descriptor.value;
  }
  return result;
}
const uuid = (value: unknown): value is string => typeof value === 'string' && value.length === 36 && UUID.test(value);
const validHash = (value: unknown): value is string => typeof value === 'string' && value.length === 64 && HASH.test(value);
const integer = (value: unknown, zero = false): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= (zero ? 0 : 1) && value <= MAX;
const actor = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128 && value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value);
function text(value: unknown, max: number, multiline = false): value is string {
  return typeof value === 'string' && value.length <= max
    && !(multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u : /[\u0000-\u001f\u007f]/u).test(value)
    && (multiline || value === value.trim());
}
function calendarDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01' || value > '9999-12-31') return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function profile(value: unknown): CloudPatientProfile {
  const item = fields(value, ['name', 'mobile', 'age', 'gender', 'firstVisit', 'notes', 'allergy']);
  if (!text(item.name, 200) || !item.name || !text(item.mobile, 60) || item.mobile !== '' && !normalizeContactPhone(item.mobile)
    || !integer(item.age, true) || item.age > 120 || !text(item.gender, 40) || item.firstVisit !== '' && !calendarDay(item.firstVisit)
    || !text(item.notes, 4000, true) || !text(item.allergy, 1000, true)) invalid();
  return { name: item.name, mobile: item.mobile, age: item.age, gender: item.gender,
    firstVisit: item.firstVisit, notes: item.notes, allergy: item.allergy };
}
export function prepareCloudPatientCommand(value: unknown): CloudPatientWriteCommand {
  try {
    const item = fields(value, ['operationId', 'recordId', 'expectedRevision', 'action', 'profile'], ['fileNo']);
    if (!uuid(item.operationId) || !uuid(item.recordId) || !integer(item.expectedRevision, true) || item.expectedRevision >= MAX
      || !['create', 'update', 'import'].includes(item.action as string)
      || (item.action !== 'update') !== (item.expectedRevision === 0)) invalid();
    if (item.action === 'import') {
      if (!integer(item.fileNo)) invalid();
      return { operationId: item.operationId, recordId: item.recordId, expectedRevision: 0,
        action: 'import', fileNo: item.fileNo, profile: profile(item.profile) };
    }
    if (Object.hasOwn(item, 'fileNo')) invalid();
    return { operationId: item.operationId, recordId: item.recordId, expectedRevision: item.expectedRevision,
      action: item.action as CloudPatientCommand['action'], profile: profile(item.profile) };
  } catch { return invalid(); }
}
export function parseCloudPatientRecord(value: unknown): CloudPatientRecord {
  try {
    const item = fields(value, ['schemaVersion', 'clinicId', 'recordId', 'fileNo', 'revision', 'lastOperationId', 'phoneKey', 'data']);
    if (item.schemaVersion !== 1 || item.clinicId !== 'main' || !uuid(item.recordId) || !integer(item.fileNo)
      || !integer(item.revision) || !uuid(item.lastOperationId) || item.phoneKey !== null && !validHash(item.phoneKey)) invalid();
    const data = profile(item.data);
    if ((data.mobile === '') !== (item.phoneKey === null)) invalid();
    return { schemaVersion: 1, clinicId: 'main', recordId: item.recordId, fileNo: item.fileNo,
      revision: item.revision, lastOperationId: item.lastOperationId, phoneKey: item.phoneKey as string | null, data };
  } catch { return invalid(); }
}
export function prepareCloudPatientPageInput(value: unknown): { afterId: string | null; limit: number } {
  try {
    const item = value === undefined ? {} : fields(value, [], ['afterId', 'limit']);
    const afterId = item.afterId === undefined ? null : item.afterId;
    const limit = item.limit === undefined ? 25 : item.limit;
    if (afterId !== null && !uuid(afterId) || !integer(limit) || limit > 50) invalid();
    return { afterId: afterId as string | null, limit };
  } catch { return invalid(); }
}
export function prepareCloudPatientPhoneInput(value: unknown): { mobile: string; afterId: string | null; limit: number } {
  try {
    const item = fields(value, ['mobile'], ['afterId', 'limit']);
    if (!text(item.mobile, 60) || !normalizeContactPhone(item.mobile)) invalid();
    return { mobile: normalizeContactPhone(item.mobile), ...prepareCloudPatientPageInput({
      ...(item.afterId === undefined ? {} : { afterId: item.afterId }), ...(item.limit === undefined ? {} : { limit: item.limit }) }) };
  } catch { return invalid(); }
}
const recordPath = (id: string) => `clinics/main/patientProfiles/${id}`;
const operationPath = (id: string) => `clinics/main/patientOperations/${id}`;
const filePath = (fileNo: number) => `clinics/main/patientFiles/${fileNo}`;
const counterPath = 'clinics/main/counters/patientFiles';
function fileIndex(value: unknown, fileNo: number): string {
  const item = fields(value, ['schemaVersion', 'clinicId', 'fileNo', 'recordId']);
  if (item.schemaVersion !== 1 || item.clinicId !== 'main' || item.fileNo !== fileNo || !uuid(item.recordId)) invalid();
  return item.recordId;
}
function counter(value: unknown): { lastFileNo: number; lastOperationId: string | null } {
  if (value === null) unavailable();
  const item = fields(value, ['schemaVersion', 'clinicId', 'lastFileNo', 'lastOperationId']);
  if (item.schemaVersion !== 1 || item.clinicId !== 'main' || !integer(item.lastFileNo, true)
    || (item.lastFileNo === 0 ? item.lastOperationId !== null : !uuid(item.lastOperationId))) invalid();
  return { lastFileNo: item.lastFileNo, lastOperationId: item.lastOperationId as string | null };
}
function rows(value: unknown, limit: number): unknown[] {
  if (!Array.isArray(value) || value.length > limit || Reflect.ownKeys(value).length !== value.length + 1) invalid();
  const copy: unknown[] = [];
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) invalid();
    copy.push(descriptor.value);
  }
  return copy;
}
async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
function createPatientRepository(adapter: CloudPatientAdapter, options: CloudPatientRepositoryOptions, journalRequired: boolean) {
  const digest = options.digest ?? sha256;
  const hash = async (value: string) => { const result = await digest(value); if (!validHash(result)) invalid(); return result; };
  const phoneHash = (data: CloudPatientProfile) => data.mobile === '' ? Promise.resolve(null) : hash(`patient-phone-v1:${normalizeContactPhone(data.mobile)}`);
  const checkedRecord = async (value: unknown, id: string): Promise<CloudPatientRecord> => {
    const result = parseCloudPatientRecord(value);
    if (result.recordId !== id || result.phoneKey !== await phoneHash(result.data)) invalid();
    return result;
  };
  const authorize = async () => { const uid = await adapter.authorizeOwner(); if (!actor(uid)) invalid(); return uid; };
  const reauthorize = async (uid: string) => { if (await authorize() !== uid) unavailable(); };
  const checkedPage = async (value: unknown, afterId: string | null, limit: number, phoneKey?: string): Promise<CloudPatientPage> => {
    const records: CloudPatientRecord[] = [];
    const files = new Set<number>();
    let previous = afterId;
    for (const entry of rows(value, limit)) {
      const row = fields(entry, ['id', 'data']);
      if (!uuid(row.id) || previous !== null && row.id <= previous) invalid();
      const result = await checkedRecord(row.data, row.id);
      if (files.has(result.fileNo) || phoneKey !== undefined && result.phoneKey !== phoneKey) invalid();
      files.add(result.fileNo); records.push(result); previous = row.id;
    }
    return { records, nextAfterId: records.length === limit ? previous : null };
  };
  return {
    async get(recordId: string): Promise<CloudPatientRecord | null> {
      try {
        if (!uuid(recordId)) invalid();
        if (!adapter.readRecord) unavailable();
        const uid = await authorize(), value = await adapter.readRecord(recordPath(recordId));
        const result = value === null ? null : await checkedRecord(value, recordId);
        await reauthorize(uid); return result;
      } catch (error) { throw safeError(error); }
    },
    async getByFileNo(fileNo: number): Promise<CloudPatientRecord | null> {
      try {
        if (!integer(fileNo)) invalid();
        if (!adapter.readRecord) unavailable();
        const uid = await authorize(), value = await adapter.readRecord(filePath(fileNo));
        let result: CloudPatientRecord | null = null;
        if (value !== null) {
          const id = fileIndex(value, fileNo);
          await reauthorize(uid);
          const stored = await adapter.readRecord(recordPath(id));
          if (stored === null) invalid();
          result = await checkedRecord(stored, id);
          if (result.fileNo !== fileNo) invalid();
        }
        await reauthorize(uid); return result;
      } catch (error) { throw safeError(error); }
    },
    async listPage(input?: CloudPatientPageInput): Promise<CloudPatientPage> {
      try {
        const prepared = prepareCloudPatientPageInput(input);
        if (!adapter.listRecordsPage) unavailable();
        const uid = await authorize();
        const result = await checkedPage(await adapter.listRecordsPage(prepared.afterId, prepared.limit), prepared.afterId, prepared.limit);
        await reauthorize(uid); return result;
      } catch (error) { throw safeError(error); }
    },
    /** Exact full-number match; returns every family file through bounded pages.
     * Never merges patients or infers identity/marketing consent from a phone. */
    async findByPhone(input: CloudPatientPhoneInput): Promise<CloudPatientPage> {
      try {
        const prepared = prepareCloudPatientPhoneInput(input);
        if (!adapter.findRecordsByPhone) unavailable();
        const uid = await authorize(), key = await hash(`patient-phone-v1:${prepared.mobile}`);
        await reauthorize(uid);
        const result = await checkedPage(await adapter.findRecordsByPhone(key, prepared.afterId, prepared.limit), prepared.afterId, prepared.limit, key);
        await reauthorize(uid); return result;
      } catch (error) { throw safeError(error); }
    },
    async commit(input: CloudPatientWriteCommand): Promise<CloudPatientCommit> {
      try {
        // Snapshot before the first await. The caller retains these identifiers
        // and content after an uncertain reply, never substitutes a new ID.
        const prepared = prepareCloudPatientCommand(input);
        if (prepared.action === 'import' && !journalRequired) invalid();
        const uid = await authorize();
        const requestHash = await hash(JSON.stringify([uid, prepared.operationId, prepared.recordId,
          prepared.expectedRevision, prepared.action, prepared.profile,
          ...(prepared.action === 'import' ? [prepared.fileNo] : [])]));
        const phoneKey = await phoneHash(prepared.profile);
        const baseReceipt = { schemaVersion: 1, clinicId: 'main', operationId: prepared.operationId,
          actorUid: uid, recordId: prepared.recordId, action: prepared.action, expectedRevision: prepared.expectedRevision,
          resultRevision: prepared.expectedRevision + 1, requestHash };
        const result = await adapter.runTransaction<CloudPatientCommit>(async tx => {
          await reauthorize(uid);
          const oldReceipt = await tx.get(operationPath(prepared.operationId));
          // The journaled factory has no caller-controlled bypass. An accepted
          // operation and its durable status are one atomic domain transaction.
          const intent = journalRequired ? await readCloudOperationIntentForCommit(tx,
            { actorUid: uid, kind: 'patient-profile', command: prepared }, { digest }) : null;
          if (intent && intent.status !== (oldReceipt === null ? 'prepared' : 'committed')) throw new CloudPatientError('conflict');
          // Profile commands intentionally carry no time. Bind the separately
          // retained preparation envelope in the journaled receipt only.
          const expectedReceipt = { ...baseReceipt, ...(intent
            ? { intentCreatedAt: intent.createdAt, intentRequestHash: intent.requestHash } : {}) };
          if (oldReceipt !== null) {
            const item = fields(oldReceipt, [...Object.keys(expectedReceipt), 'fileNo']);
            if (!integer(item.fileNo) || prepared.action === 'import' && item.fileNo !== prepared.fileNo
              || Object.keys(expectedReceipt).some(key => item[key] !== expectedReceipt[key as keyof typeof expectedReceipt])) throw new CloudPatientError('conflict');
            await reauthorize(uid);
            return { status: 'already-committed', recordId: prepared.recordId, fileNo: item.fileNo, revision: baseReceipt.resultRevision };
          }
          const stored = await tx.get(recordPath(prepared.recordId));
          const current = stored === null ? null : await checkedRecord(stored, prepared.recordId);
          if (prepared.action !== 'update' ? current !== null : !current || current.revision !== prepared.expectedRevision) throw new CloudPatientError('conflict');
          let fileNo: number;
          let nextCounter: number | null = null;
          if (prepared.action !== 'update') {
            const latest = counter(await tx.get(counterPath));
            if (prepared.action === 'create' && latest.lastFileNo >= MAX) unavailable();
            if (latest.lastOperationId === prepared.operationId) throw new CloudPatientError('conflict');
            fileNo = prepared.action === 'import' ? prepared.fileNo : latest.lastFileNo + 1;
            nextCounter = Math.max(latest.lastFileNo, fileNo);
            if (await tx.get(filePath(fileNo)) !== null) throw new CloudPatientError('conflict');
          } else {
            fileNo = current!.fileNo;
            if (fileIndex(await tx.get(filePath(fileNo)), fileNo) !== prepared.recordId) invalid();
          }
          // All reads precede writes. Rules must independently couple these
          // records and check current owner membership at server commit.
          await reauthorize(uid);
          if (prepared.action !== 'update') {
            tx.set(counterPath, { schemaVersion: 1, clinicId: 'main', lastFileNo: nextCounter!, lastOperationId: prepared.operationId });
            tx.set(filePath(fileNo), { schemaVersion: 1, clinicId: 'main', fileNo, recordId: prepared.recordId });
          }
          tx.set(recordPath(prepared.recordId), { schemaVersion: 1, clinicId: 'main', recordId: prepared.recordId,
            fileNo, revision: baseReceipt.resultRevision, lastOperationId: prepared.operationId, phoneKey, data: prepared.profile });
          tx.set(operationPath(prepared.operationId), { ...expectedReceipt, fileNo });
          if (intent) markCloudOperationIntentCommitted(tx, intent);
          return { status: 'committed', recordId: prepared.recordId, fileNo, revision: baseReceipt.resultRevision };
        });
        await reauthorize(uid);
        // Historical receipt is not a fresh patient snapshot. Read again before
        // rendering success/current details; no optimistic clinical data here.
        return result;
      } catch (error) { throw safeError(error); }
    },
  };
}
/** Legacy isolated stage contract only. Its old candidate Rules do not include
 * recovery intents and are NOT deployable for the journaled SDK capability. */
export function createCloudPatientRepository(adapter: CloudPatientAdapter, options: CloudPatientRepositoryOptions = {}) {
  return createPatientRepository(adapter, options, false);
}
/** Durable preparation is mandatory, including on historical receipt replay. */
export function createJournaledCloudPatientRepository(adapter: CloudPatientAdapter, options: CloudPatientRepositoryOptions = {}) {
  return createPatientRepository(adapter, options, true);
}
export type CloudPatientRepository = ReturnType<typeof createCloudPatientRepository>;
