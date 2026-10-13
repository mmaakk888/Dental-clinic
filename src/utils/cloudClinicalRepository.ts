import { normalizeContactPhone } from './clinicContacts';
import { parseCloudPatientRecord } from './cloudPatientRepository';
import { parseCompositeToothId } from './toothUtils';
import { CloudOperationIntentError, readCloudOperationIntentForCommit,
  markCloudOperationIntentCommitted } from './cloudOperationIntent';

/** Prepared owner-only clinical storage. No SDK, activation, local fallback,
 * historical migration or private supplier data belongs to this module. */
export interface CloudClinicalService {
  id: string; name: string; priceCents: number; tooth: string | null;
  /** Stable catalog reference; historical commands without it retain their exact shape. */
  catalogServiceId?: string | null;
}
export interface CloudClinicalProgress {
  notes: string; treatmentStage: 'single' | 'first' | 'second' | 'third' | 'follow_up';
  rootCanalStatus: '' | 'access_cleaning' | 'working_length' | 'canal_filled' | 'impression' | 'final_restoration';
  visitStatus: 'completed' | 'follow_up';
}
export interface CloudClinicalSessionData extends CloudClinicalProgress {
  type: string; date: string; teethIds: string[]; services: CloudClinicalService[]; examinationCents: number;
  /** Created only by the dedicated atomic prosthetic order workflow. */
  prostheticCaseId?: string;
  /** Patient-facing immutable snapshot; never a lab identity or supplier cost. */
  prosthetic?: { kind: 'fixed' | 'removable'; material: string; units: number; unitPriceCents: number };
}
export interface CloudClinicalAccount {
  schemaVersion: 1; clinicId: 'main'; patientId: string; fileNo: number; revision: number;
  lastOperationId: string; totalCents: number; paidCents: number; sessionCount: number;
}
export interface CloudClinicalSession {
  schemaVersion: 1; clinicId: 'main'; sessionId: string; patientId: string; fileNo: number;
  revision: number; lastOperationId: string; totalCents: number; paidCents: number; data: CloudClinicalSessionData;
}
export interface CloudClinicalReceipt {
  schemaVersion: 1; clinicId: 'main'; receiptId: string; patientId: string; sessionId: string;
  fileNo: number; amountCents: number; date: string; note: string; createdAt: string;
  actorUid: string; paymentMethod: 'cash';
}
interface CommandBase { operationId: string; patientId: string; sessionId: string; expectedRevision: number; createdAt: string }
export type CloudClinicalCommand = CommandBase & (
  { action: 'visit'; data: CloudClinicalSessionData; paidCents: number }
  | { action: 'payment'; amountCents: number; date: string; note: string }
  | { action: 'progress'; changes: CloudClinicalProgress }
);
export interface CloudClinicalCommit {
  status: 'committed' | 'already-committed'; patientId: string; sessionId: string; fileNo: number; revision: number;
}
export interface CloudClinicalPageInput { patientId: string; afterId?: string | null; limit?: number }
export interface CloudClinicalPage<T> { records: T[]; nextAfterId: string | null }
export interface CloudClinicalTransaction { get(path: string): Promise<unknown | null>; set(path: string, value: object): void }
export interface CloudClinicalAdapter {
  authorizeOwner(): Promise<string>;
  runTransaction<T>(work: (transaction: CloudClinicalTransaction) => Promise<T>): Promise<T>;
  readRecord?(path: string): Promise<unknown | null>;
  listSessionsPage?(patientId: string, afterId: string | null, limit: number): Promise<unknown>;
  listReceiptsPage?(patientId: string, afterId: string | null, limit: number): Promise<unknown>;
}
export interface CloudClinicalRepositoryOptions { digest?: (text: string) => Promise<string> }
export class CloudClinicalError extends Error {
  constructor(public readonly code: 'invalid' | 'conflict' | 'unavailable') {
    super(({ invalid: 'بيانات الجلسة أو التحصيل غير صالحة.', conflict: 'تغير حساب المريض؛ راجع أحدث السجل قبل الحفظ.',
      unavailable: 'تعذر تأكيد عملية الجلسة أو التحصيل من الخادم.' })[code]);
    this.name = 'CloudClinicalError';
  }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_REVISION = 2_000_000_000;
export const MAX_CLOUD_CLINICAL_CENTS = 1_000_000_000_000;
function invalid(): never { throw new CloudClinicalError('invalid'); }
function unavailable(): never { throw new CloudClinicalError('unavailable'); }
function conflict(): never { throw new CloudClinicalError('conflict'); }
function safeError(value: unknown): CloudClinicalError {
  try { if (value instanceof CloudClinicalError && ['invalid', 'conflict', 'unavailable'].includes(value.code)) return new CloudClinicalError(value.code); } catch { /* fixed errors only */ }
  try { if (value instanceof CloudOperationIntentError && ['invalid', 'conflict', 'unavailable'].includes(value.code)) return new CloudClinicalError(value.code); } catch { /* fixed errors only */ }
  return new CloudClinicalError('unavailable');
}
function fields(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
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
const integer = (value: unknown, min = 0, max = MAX_REVISION): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
const money = (value: unknown): value is number => integer(value, 0, MAX_CLOUD_CLINICAL_CENTS);
const actor = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128 && value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value);
function text(value: unknown, max: number, multiline = false): value is string {
  return typeof value === 'string' && value.length <= max && (multiline || value === value.trim())
    && !(multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u : /[\u0000-\u001f\u007f]/u).test(value);
}
function day(value: unknown): value is string {
  if (typeof value !== 'string' || value.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01' || value > '9999-12-31') return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function timestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.length !== 24 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !day(value.slice(0, 10))) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}
function array(value: unknown, limit: number): unknown[] {
  if (!Array.isArray(value) || value.length > limit || Reflect.ownKeys(value).length !== value.length + 1) invalid();
  return Array.from({ length: value.length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) invalid();
    return descriptor.value;
  });
}
function progress(value: unknown): CloudClinicalProgress {
  const item = fields(value, ['notes', 'treatmentStage', 'rootCanalStatus', 'visitStatus']);
  if (!text(item.notes, 4000, true) || !['single', 'first', 'second', 'third', 'follow_up'].includes(item.treatmentStage as string)
    || !['', 'access_cleaning', 'working_length', 'canal_filled', 'impression', 'final_restoration'].includes(item.rootCanalStatus as string)
    || !['completed', 'follow_up'].includes(item.visitStatus as string)) invalid();
  return { notes: item.notes, treatmentStage: item.treatmentStage as CloudClinicalProgress['treatmentStage'],
    rootCanalStatus: item.rootCanalStatus as CloudClinicalProgress['rootCanalStatus'], visitStatus: item.visitStatus as CloudClinicalProgress['visitStatus'] };
}
function sessionData(value: unknown): CloudClinicalSessionData {
  const item = fields(value, ['type', 'date', 'teethIds', 'services', 'examinationCents', 'notes', 'treatmentStage', 'rootCanalStatus', 'visitStatus'], ['prostheticCaseId', 'prosthetic']);
  const linkedProsthetic = Object.hasOwn(item, 'prostheticCaseId');
  if (linkedProsthetic !== Object.hasOwn(item, 'prosthetic') || linkedProsthetic && !uuid(item.prostheticCaseId)
    || !text(item.type, 200) || !item.type || !linkedProsthetic && item.type.normalize('NFKC').trim().startsWith('تركيب')
    || !day(item.date) || !money(item.examinationCents)) invalid();
  const teethIds = array(item.teethIds, 32);
  if (teethIds.some(id => typeof id !== 'string' || id.length > 3 || !parseCompositeToothId(id)) || new Set(teethIds).size !== teethIds.length) invalid();
  const ids = new Set<string>();
  const services = array(item.services, 64).map(value => {
    const row = fields(value, ['id', 'name', 'priceCents', 'tooth'], ['catalogServiceId']);
    if (!uuid(row.id) || ids.has(row.id) || !text(row.name, 200) || !row.name
      || !linkedProsthetic && row.name.normalize('NFKC').trim().startsWith('تركيب') || !money(row.priceCents)
      || 'catalogServiceId' in row && row.catalogServiceId !== null && !uuid(row.catalogServiceId)
      || row.tooth !== null && (typeof row.tooth !== 'string' || row.tooth.length > 3 || !parseCompositeToothId(row.tooth) || !teethIds.includes(row.tooth))) invalid();
    ids.add(row.id);
    return { id: row.id, name: row.name, priceCents: row.priceCents, tooth: row.tooth as string | null,
      ...('catalogServiceId' in row ? { catalogServiceId: row.catalogServiceId as string | null } : {}) };
  });
  let prosthetic: CloudClinicalSessionData['prosthetic'];
  if (linkedProsthetic) {
    const snapshot = fields(item.prosthetic, ['kind', 'material', 'units', 'unitPriceCents']);
    if (!['fixed', 'removable'].includes(snapshot.kind as string) || !text(snapshot.material, 200) || !snapshot.material
      || !integer(snapshot.units, 1, 100) || !money(snapshot.unitPriceCents)) invalid();
    prosthetic = { kind: snapshot.kind as 'fixed' | 'removable', material: snapshot.material,
      units: snapshot.units, unitPriceCents: snapshot.unitPriceCents };
    if (!money(prosthetic.units * prosthetic.unitPriceCents) || services.length !== 1
      || services[0].id !== item.prostheticCaseId || !services[0].catalogServiceId
      || services[0].name !== prosthetic.material || item.type !== prosthetic.material
      || services[0].priceCents !== prosthetic.units * prosthetic.unitPriceCents) invalid();
  }
  if (!services.length && item.examinationCents === 0) invalid();
  const result = { type: item.type, date: item.date, teethIds: teethIds as string[], services, examinationCents: item.examinationCents,
    ...(linkedProsthetic ? { prostheticCaseId: item.prostheticCaseId as string, prosthetic } : {}),
    ...progress({ notes: item.notes, treatmentStage: item.treatmentStage, rootCanalStatus: item.rootCanalStatus, visitStatus: item.visitStatus }) };
  total(result);
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 64 * 1024) invalid();
  return result;
}
function total(value: CloudClinicalSessionData): number {
  const result = value.services.reduce((sum, row) => sum + row.priceCents, value.examinationCents);
  if (!money(result)) invalid();
  return result;
}
/** Draft validation without inventing an operation ID or creating a charge. */
export function prepareCloudClinicalSessionData(input: unknown): CloudClinicalSessionData {
  try { return sessionData(input); }
  catch { throw new CloudClinicalError('invalid'); }
}
export function prepareCloudClinicalCommand(value: unknown): CloudClinicalCommand {
  try {
    const item = fields(value, ['operationId', 'patientId', 'sessionId', 'expectedRevision', 'action', 'createdAt'], ['data', 'paidCents', 'amountCents', 'date', 'note', 'changes']);
    if (!uuid(item.operationId) || !uuid(item.patientId) || !uuid(item.sessionId) || !integer(item.expectedRevision, 0, MAX_REVISION - 1) || !timestamp(item.createdAt)) invalid();
    const base = { operationId: item.operationId, patientId: item.patientId, sessionId: item.sessionId, expectedRevision: item.expectedRevision, createdAt: item.createdAt };
    if (item.action === 'visit') {
      fields(value, [...Object.keys(base), 'action', 'data', 'paidCents']);
      const data = sessionData(item.data);
      if (data.prostheticCaseId !== undefined || item.sessionId !== item.operationId || !money(item.paidCents) || item.paidCents > total(data)) invalid();
      return { ...base, action: 'visit', data, paidCents: item.paidCents };
    }
    if (item.action === 'payment') {
      fields(value, [...Object.keys(base), 'action', 'amountCents', 'date', 'note']);
      if (!item.expectedRevision || !money(item.amountCents) || !item.amountCents || !day(item.date) || !text(item.note, 1000, true)) invalid();
      return { ...base, action: 'payment', amountCents: item.amountCents, date: item.date, note: item.note };
    }
    if (item.action === 'progress') {
      fields(value, [...Object.keys(base), 'action', 'changes']);
      if (!item.expectedRevision) invalid();
      return { ...base, action: 'progress', changes: progress(item.changes) };
    }
    return invalid();
  } catch { return invalid(); }
}
export function parseCloudClinicalAccount(value: unknown): CloudClinicalAccount {
  try {
    const item = fields(value, ['schemaVersion', 'clinicId', 'patientId', 'fileNo', 'revision', 'lastOperationId', 'totalCents', 'paidCents', 'sessionCount']);
    if (item.schemaVersion !== 1 || item.clinicId !== 'main' || !uuid(item.patientId) || !integer(item.fileNo, 1) || !integer(item.revision, 1)
      || !uuid(item.lastOperationId) || !money(item.totalCents) || !money(item.paidCents) || item.paidCents > item.totalCents
      || !integer(item.sessionCount, 1) || item.sessionCount > item.revision) invalid();
    return { schemaVersion: 1, clinicId: 'main', patientId: item.patientId, fileNo: item.fileNo, revision: item.revision,
      lastOperationId: item.lastOperationId, totalCents: item.totalCents, paidCents: item.paidCents, sessionCount: item.sessionCount };
  } catch { return invalid(); }
}
export function parseCloudClinicalSession(value: unknown): CloudClinicalSession {
  try {
    const item = fields(value, ['schemaVersion', 'clinicId', 'sessionId', 'patientId', 'fileNo', 'revision', 'lastOperationId', 'totalCents', 'paidCents', 'data']);
    if (item.schemaVersion !== 1 || item.clinicId !== 'main' || !uuid(item.sessionId) || !uuid(item.patientId) || !integer(item.fileNo, 1)
      || !integer(item.revision, 1) || !uuid(item.lastOperationId) || !money(item.totalCents) || !money(item.paidCents) || item.paidCents > item.totalCents) invalid();
    const data = sessionData(item.data);
    if (item.totalCents !== total(data) || data.prostheticCaseId !== undefined && data.prostheticCaseId !== item.sessionId) invalid();
    return { schemaVersion: 1, clinicId: 'main', sessionId: item.sessionId, patientId: item.patientId, fileNo: item.fileNo,
      revision: item.revision, lastOperationId: item.lastOperationId, totalCents: item.totalCents, paidCents: item.paidCents, data };
  } catch { return invalid(); }
}
export function parseCloudClinicalReceipt(value: unknown): CloudClinicalReceipt {
  try {
    const item = fields(value, ['schemaVersion', 'clinicId', 'receiptId', 'patientId', 'sessionId', 'fileNo', 'amountCents', 'date', 'note', 'createdAt', 'actorUid', 'paymentMethod']);
    if (item.schemaVersion !== 1 || item.clinicId !== 'main' || !uuid(item.receiptId) || !uuid(item.patientId) || !uuid(item.sessionId) || !integer(item.fileNo, 1)
      || !money(item.amountCents) || !item.amountCents || !day(item.date) || !text(item.note, 1000, true) || !timestamp(item.createdAt) || !actor(item.actorUid) || item.paymentMethod !== 'cash') invalid();
    return { schemaVersion: 1, clinicId: 'main', receiptId: item.receiptId, patientId: item.patientId, sessionId: item.sessionId,
      fileNo: item.fileNo, amountCents: item.amountCents, date: item.date, note: item.note, createdAt: item.createdAt, actorUid: item.actorUid, paymentMethod: 'cash' };
  } catch { return invalid(); }
}
export function prepareCloudClinicalPageInput(value: unknown): { patientId: string; afterId: string | null; limit: number } {
  try {
    const item = fields(value, ['patientId'], ['afterId', 'limit']), afterId = item.afterId ?? null, limit = item.limit === undefined ? 25 : item.limit;
    if (!uuid(item.patientId) || item.afterId !== undefined && item.afterId !== null && !uuid(item.afterId) || !integer(limit, 1, 50)) invalid();
    return { patientId: item.patientId, afterId: afterId as string | null, limit };
  } catch { return invalid(); }
}
const path = (collection: string, id: string | number) => `clinics/main/${collection}/${id}`;
async function sha256(value: string): Promise<string> {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, '0')).join('');
}
export function createCloudClinicalRepository(adapter: CloudClinicalAdapter, options: CloudClinicalRepositoryOptions = {}) {
  const digest = options.digest ?? sha256;
  const hash = async (value: string) => { const result = await digest(value); if (typeof result !== 'string' || result.length !== 64 || !/^[0-9a-f]{64}$/.test(result)) invalid(); return result; };
  const authorize = async () => { const uid = await adapter.authorizeOwner(); if (!actor(uid)) invalid(); return uid; };
  const reauthorize = async (uid: string) => { if (await authorize() !== uid) unavailable(); };
  async function profile(patientId: string, read: (path: string) => Promise<unknown | null>, uid: string) {
    const stored = await read(path('patientProfiles', patientId));
    if (stored === null) conflict();
    const result = parseCloudPatientRecord(stored);
    if (result.recordId !== patientId || result.phoneKey !== (result.data.mobile ? await hash(`patient-phone-v1:${normalizeContactPhone(result.data.mobile)}`) : null)) invalid();
    await reauthorize(uid);
    const index = fields(await read(path('patientFiles', result.fileNo)), ['schemaVersion', 'clinicId', 'fileNo', 'recordId']);
    if (index.schemaVersion !== 1 || index.clinicId !== 'main' || index.fileNo !== result.fileNo || index.recordId !== patientId) invalid();
    await reauthorize(uid); return result;
  }
  function account(value: unknown, patientId: string, fileNo: number): CloudClinicalAccount | null {
    if (value === null) return null;
    const result = parseCloudClinicalAccount(value);
    if (result.patientId !== patientId || result.fileNo !== fileNo) invalid();
    return result;
  }
  const read = (value: string) => { if (!adapter.readRecord) return unavailable(); return adapter.readRecord(value); };
  async function list<T extends CloudClinicalSession | CloudClinicalReceipt>(input: CloudClinicalPageInput, kind: 'sessions' | 'receipts'): Promise<CloudClinicalPage<T>> {
    const prepared = prepareCloudClinicalPageInput(input), uid = await authorize();
    const owner = await profile(prepared.patientId, read, uid);
    const query = kind === 'sessions' ? adapter.listSessionsPage : adapter.listReceiptsPage;
    if (!query) unavailable();
    await reauthorize(uid);
    const raw = await query(prepared.patientId, prepared.afterId, prepared.limit), records: T[] = [];
    let previous = prepared.afterId;
    for (const value of array(raw, prepared.limit)) {
      const row = fields(value, ['id', 'data']);
      if (!uuid(row.id) || previous !== null && row.id <= previous) invalid();
      const record = kind === 'sessions' ? parseCloudClinicalSession(row.data) : parseCloudClinicalReceipt(row.data);
      if (record.patientId !== prepared.patientId || record.fileNo !== owner.fileNo || ('sessionId' in record && kind === 'sessions' ? record.sessionId : (record as CloudClinicalReceipt).receiptId) !== row.id) invalid();
      records.push(record as T); previous = row.id;
    }
    await reauthorize(uid);
    return { records, nextAfterId: records.length === prepared.limit ? previous : null };
  }
  return {
    async getProfile(patientId: string) {
      try {
        if (!uuid(patientId)) invalid();
        const uid = await authorize(), result = await profile(patientId, read, uid);
        await reauthorize(uid); return result;
      } catch (error) { throw safeError(error); }
    },
    async getAccount(patientId: string): Promise<CloudClinicalAccount | null> {
      try {
        if (!uuid(patientId)) invalid();
        const uid = await authorize(), owner = await profile(patientId, read, uid);
        const result = account(await read(path('patientAccounts', patientId)), patientId, owner.fileNo);
        await reauthorize(uid); return result;
      } catch (error) { throw safeError(error); }
    },
    async getSession(sessionId: string): Promise<CloudClinicalSession | null> {
      try {
        if (!uuid(sessionId)) invalid();
        const uid = await authorize(), value = await read(path('patientSessions', sessionId));
        if (value === null) { await reauthorize(uid); return null; }
        const result = parseCloudClinicalSession(value);
        if (result.sessionId !== sessionId) invalid();
        const owner = await profile(result.patientId, read, uid);
        if (result.fileNo !== owner.fileNo) invalid();
        await reauthorize(uid); return result;
      } catch (error) { throw safeError(error); }
    },
    async listSessions(input: CloudClinicalPageInput): Promise<CloudClinicalPage<CloudClinicalSession>> {
      try { return await list<CloudClinicalSession>(input, 'sessions'); } catch (error) { throw safeError(error); }
    },
    async listReceipts(input: CloudClinicalPageInput): Promise<CloudClinicalPage<CloudClinicalReceipt>> {
      try { return await list<CloudClinicalReceipt>(input, 'receipts'); } catch (error) { throw safeError(error); }
    },
    async commit(input: CloudClinicalCommand): Promise<CloudClinicalCommit> {
      try {
        const command = prepareCloudClinicalCommand(input), uid = await authorize();
        const requestHash = await hash(JSON.stringify([uid, command]));
        const baseReceipt = { schemaVersion: 1, clinicId: 'main', operationId: command.operationId, actorUid: uid,
          patientId: command.patientId, sessionId: command.sessionId, action: command.action, expectedRevision: command.expectedRevision,
          resultRevision: command.expectedRevision + 1, createdAt: command.createdAt, requestHash };
        await reauthorize(uid);
        const result = await adapter.runTransaction<CloudClinicalCommit>(async tx => {
          await reauthorize(uid);
          const existingOperation = await tx.get(path('clinicalOperations', command.operationId));
          // Durable preparation must already exist on the server. It is marked
          // committed atomically with the actual domain receipt, never later
          // through an independent "confirm success" request.
          const intent = await readCloudOperationIntentForCommit(tx, { actorUid: uid, kind: 'clinical', command }, { digest });
          if (intent.createdAt !== command.createdAt || intent.status !== (existingOperation === null ? 'prepared' : 'committed')) conflict();
          if (existingOperation !== null) {
            const receipt = fields(existingOperation, [...Object.keys(baseReceipt), 'fileNo']);
            if (!integer(receipt.fileNo, 1) || Object.keys(baseReceipt).some(key => receipt[key] !== baseReceipt[key as keyof typeof baseReceipt])) conflict();
            await reauthorize(uid);
            return { status: 'already-committed', patientId: command.patientId, sessionId: command.sessionId, fileNo: receipt.fileNo, revision: baseReceipt.resultRevision };
          }
          const owner = await profile(command.patientId, value => tx.get(value), uid);
          const current = account(await tx.get(path('patientAccounts', command.patientId)), command.patientId, owner.fileNo);
          if ((current?.revision ?? 0) !== command.expectedRevision || !current && command.action !== 'visit') conflict();
          const oldSession = await tx.get(path('patientSessions', command.sessionId));
          const currentSession = oldSession === null ? null : parseCloudClinicalSession(oldSession);
          if (command.action === 'visit' ? currentSession !== null : !currentSession || currentSession.sessionId !== command.sessionId || currentSession.patientId !== command.patientId || currentSession.fileNo !== owner.fileNo) conflict();
          if (currentSession && (!current || currentSession.revision > current.revision || currentSession.totalCents > current.totalCents || currentSession.paidCents > current.paidCents)) invalid();
          if (await tx.get(path('patientReceipts', command.operationId)) !== null) conflict();
          const charged = command.action === 'visit' ? total(command.data) : 0;
          const collected = command.action === 'visit' ? command.paidCents : command.action === 'payment' ? command.amountCents : 0;
          if (command.action === 'payment' && (collected > currentSession!.totalCents - currentSession!.paidCents || collected > current!.totalCents - current!.paidCents)) conflict();
          const nextAccount: CloudClinicalAccount = { schemaVersion: 1, clinicId: 'main', patientId: command.patientId, fileNo: owner.fileNo,
            revision: baseReceipt.resultRevision, lastOperationId: command.operationId, totalCents: (current?.totalCents ?? 0) + charged,
            paidCents: (current?.paidCents ?? 0) + collected, sessionCount: (current?.sessionCount ?? 0) + (command.action === 'visit' ? 1 : 0) };
          parseCloudClinicalAccount(nextAccount);
          const nextSession: CloudClinicalSession = command.action === 'visit'
            ? { schemaVersion: 1, clinicId: 'main', sessionId: command.sessionId, patientId: command.patientId, fileNo: owner.fileNo,
              revision: 1, lastOperationId: command.operationId, totalCents: charged, paidCents: collected, data: command.data }
            : { ...currentSession!, revision: currentSession!.revision + 1, lastOperationId: command.operationId,
              paidCents: currentSession!.paidCents + collected,
              data: command.action === 'progress' ? { ...currentSession!.data, ...command.changes } : currentSession!.data };
          parseCloudClinicalSession(nextSession);
          let cash: CloudClinicalReceipt | null = null;
          if (collected > 0) {
            cash = { schemaVersion: 1, clinicId: 'main', receiptId: command.operationId, patientId: command.patientId, sessionId: command.sessionId,
              fileNo: owner.fileNo, amountCents: collected, date: command.action === 'visit' ? command.data.date : command.action === 'payment' ? command.date : '',
              note: command.action === 'payment' ? command.note : '', createdAt: command.createdAt, actorUid: uid, paymentMethod: 'cash' };
            parseCloudClinicalReceipt(cash);
          }
          // All reads precede writes; candidate Rules must couple account,
          // session, optional cash and immutable operation on every transition.
          // Nondeletable account+session coupling is essential: a missing account
          // is not proof that arbitrary preexisting history can be discarded.
          await reauthorize(uid);
          tx.set(path('patientAccounts', command.patientId), nextAccount);
          tx.set(path('patientSessions', command.sessionId), nextSession);
          if (cash) tx.set(path('patientReceipts', command.operationId), cash);
          tx.set(path('clinicalOperations', command.operationId), { ...baseReceipt, fileNo: owner.fileNo });
          markCloudOperationIntentCommitted(tx, intent);
          return { status: 'committed', patientId: command.patientId, sessionId: command.sessionId, fileNo: owner.fileNo, revision: nextAccount.revision };
        });
        await reauthorize(uid); return result;
      } catch (error) { throw safeError(error); }
    },
  };
}
export type CloudClinicalRepository = ReturnType<typeof createCloudClinicalRepository>;
