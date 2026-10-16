import { parseCloudPatientRecord } from './cloudPatientRepository';
import { parseCloudContactRecord } from './cloudContactRepository';
import { parseCloudClinicalAccount, parseCloudClinicalSession, parseCloudClinicalReceipt } from './cloudClinicalRepository';
import { projectCloudClinicalPatient, type CloudClinicalPatientSnapshot } from './cloudClinicalPatientProjection';
import { parseCloudAppointmentRecord, parseCloudAppointmentDay } from './cloudAppointmentRepository';
import { parseCloudLabDefinition, parseCloudClinicSettingsRecord, parseCloudProstheticRouting } from './cloudClinicSettingsRepository';
import { parseCloudServiceCatalogRecord } from './cloudServiceCatalogRepository';
import { parseCloudProstheticCase, parseCloudLabAccount, parseCloudLabPayment, projectCloudProstheticFinancials } from './cloudProstheticRepository';
import { parseCloudExpenseRecord, parseCloudExpensePayment, parseCloudMaterialBalance, parseCloudMaterialHead, resolveCloudMaterialHead,
  parseCloudMaterialUsage, cloudMaterialId, cloudMaterialIdV2 } from './cloudExpenseRepository';
import { cloudSupplierInvoiceIdentityV2 } from './cloudExpenseInventoryProofs';
import { normalizeContactPhone } from './clinicContacts';

const parsers = { patientProfiles: parseCloudPatientRecord, patientAccounts: parseCloudClinicalAccount,
  patientSessions: parseCloudClinicalSession, patientReceipts: parseCloudClinicalReceipt, contactRecords: parseCloudContactRecord,
  appointmentRecords: parseCloudAppointmentRecord, appointmentDays: parseCloudAppointmentDay, labDefinitions: parseCloudLabDefinition,
  labCases: parseCloudProstheticCase, labAccounts: parseCloudLabAccount, labPayments: parseCloudLabPayment,
  expenseRecords: parseCloudExpenseRecord, expensePayments: parseCloudExpensePayment, materialBalances: parseCloudMaterialBalance,
  materialUsages: parseCloudMaterialUsage, patientFiles: parseFileIndex };
export type CloudSnapshotCollection = keyof typeof parsers;
export const CLOUD_SNAPSHOT_COLLECTIONS = Object.freeze(Object.keys(parsers) as CloudSnapshotCollection[]);
export const CLOUD_SNAPSHOT_LIMITS = Object.freeze({ pageSize: 50, perCollection: 20_000, totalRecords: 100_000, totalBytes: 64 * 1024 * 1024, responseBytes: 4 * 1024 * 1024 });
export interface CloudPatientFileIndex { schemaVersion: 1; clinicId: 'main'; fileNo: number; recordId: string }
export interface CloudPatientFileCounter { schemaVersion: 1; clinicId: 'main'; lastFileNo: number; lastOperationId: string | null }
export interface CloudClinicSnapshot {
  readTime: string; records: { [K in CloudSnapshotCollection]: ReturnType<typeof parsers[K]>[] };
  counter: CloudPatientFileCounter;
  settings: { serviceCatalog: ReturnType<typeof parseCloudServiceCatalogRecord>; clinicSettings: ReturnType<typeof parseCloudClinicSettingsRecord>;
    prostheticRouting: ReturnType<typeof parseCloudProstheticRouting> };
  patients: CloudClinicalPatientSnapshot[];
}
/** Protected registration-only directory. No accounts, sessions, receipts,
 * images, operation history or partial loaded-page fallback. */
export interface CloudClinicDirectorySnapshot {
  readTime: string;
  patientProfiles: readonly ReturnType<typeof parseCloudPatientRecord>[];
  contactRecords: readonly ReturnType<typeof parseCloudContactRecord>[];
}
export interface CloudSnapshotQuery {
  collection: CloudSnapshotCollection | 'settings' | 'counters' | 'expenseOperations' | 'operationIntents'; afterId: string | null; documentId: string | null; readTime: string; limit: number;
}
export interface CloudClinicSnapshotAdapter {
  /** Exact catalog query without a consistency selector, used only for its final server time. */
  probeReadTime(): Promise<unknown>;
  query(input: CloudSnapshotQuery): Promise<unknown>;
  assertActive?(): void;
}
export class CloudClinicSnapshotError extends Error { constructor() { super('تعذر تأكيد نسخة كاملة ومتسقة من بيانات العيادة؛ لم نعرض أو نُصدّر نسخة جزئية.'); this.name = 'CloudClinicSnapshotError'; } }
function fail(): never { throw new CloudClinicSnapshotError(); }
const uuid = (value: unknown): value is string => typeof value === 'string' && value.length === 36 && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const integer = (value: unknown, min = 0, max = 2_000_000_000): value is number => typeof value === 'number' && Number.isSafeInteger(value) && !Object.is(value, -0) && value >= min && value <= max;
function fields(value: unknown, required: string[], optional: string[] = []): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail();
  const keys = Reflect.ownKeys(value); if (required.some(key => !keys.includes(key)) || keys.some(key => typeof key !== 'string' || ![...required, ...optional].includes(key))) fail();
  const result: Record<string, any> = {};
  for (const key of keys as string[]) { if (['__proto__', 'prototype', 'constructor'].includes(key)) fail(); const property = Object.getOwnPropertyDescriptor(value, key);
    if (!property || !('value' in property) || !property.enumerable) fail(); result[key] = property.value; } return result;
}
function rows(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max || Reflect.ownKeys(value).length !== value.length + 1) fail();
  return Array.from({ length: value.length }, (_, index) => { const property = Object.getOwnPropertyDescriptor(value, String(index));
    if (!property || !('value' in property) || !property.enumerable) fail(); return property.value; });
}
const freeze = <T>(value: T): T => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
function parseFileIndex(value: unknown): CloudPatientFileIndex { const row = fields(value, ['schemaVersion', 'clinicId', 'fileNo', 'recordId']);
  if (row.schemaVersion !== 1 || row.clinicId !== 'main' || !integer(row.fileNo, 1) || !uuid(row.recordId)) fail(); return row as CloudPatientFileIndex; }
function parseCounter(value: unknown): CloudPatientFileCounter { const row = fields(value, ['schemaVersion', 'clinicId', 'lastFileNo', 'lastOperationId']);
  if (row.schemaVersion !== 1 || row.clinicId !== 'main' || !integer(row.lastFileNo) || (row.lastFileNo === 0 ? row.lastOperationId !== null : !uuid(row.lastOperationId))) fail(); return row as CloudPatientFileCounter; }
/** Strict UTC server timestamp with microsecond precision, not a UI-selected time. */
export function parseCloudSnapshotReadTime(value: unknown): string {
  if (typeof value !== 'string' || value.length > 30 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3}(?:\d{3})?(?:000)?)?Z$/.test(value)) fail();
  const base = value.slice(0, 19), date = new Date(`${base}.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 19) !== base || value < '1900-01-01') fail(); return value;
}
const timeKey = (value: string) => `${value.slice(0, 19)}.${(value.match(/\.(\d+)Z$/)?.[1] ?? '').padEnd(9, '0')}`;
/** Only the JSON Value forms actually used by protected clinic contracts.
 * Bytes/reference/geopoint/opaque provider values are rejected, not exported. */
export function decodeFirestoreSnapshotValue(value: unknown): unknown {
  let nodes = 0, bytes = 0;
  function decode(value: unknown, depth: number): unknown {
    if (++nodes > 16_000 || depth > 12) fail();
    const raw = fields(value, [], ['nullValue', 'booleanValue', 'integerValue', 'doubleValue', 'stringValue', 'arrayValue', 'mapValue']);
    const keys = Object.keys(raw); if (keys.length !== 1) fail(); const key = keys[0], item = raw[key];
    if (key === 'nullValue') { if (item !== null && item !== 'NULL_VALUE') fail(); return null; }
    if (key === 'booleanValue') { if (typeof item !== 'boolean') fail(); return item; }
    if (key === 'integerValue') { if (typeof item !== 'string' || !/^(?:0|-?[1-9]\d{0,15})$/.test(item) || !Number.isSafeInteger(Number(item))) fail(); return Number(item); }
    if (key === 'doubleValue') { if (typeof item !== 'number' || !Number.isFinite(item) || Object.is(item, -0)) fail(); return item; }
    if (key === 'stringValue') { if (typeof item !== 'string' || (bytes += new TextEncoder().encode(item).byteLength) > 256 * 1024) fail(); return item; }
    if (key === 'arrayValue') { const array = fields(item, [], ['values']); return rows(array.values ?? [], 2048).map(value => decode(value, depth + 1)); }
    const map = fields(item, [], ['fields']), output: Record<string, unknown> = {};
    const entries = fields(map.fields ?? {}, [], Object.keys(map.fields ?? {}));
    if (Object.keys(entries).length > 300) fail();
    for (const [key, value] of Object.entries(entries)) { if (!key || key.length > 200 || (bytes += new TextEncoder().encode(key).byteLength) > 256 * 1024) fail(); output[key] = decode(value, depth + 1); } return output;
  }
  try { return decode(value, 0); } catch { return fail(); }
}
const documentRoot = 'projects/dental-clinic-mmaakk888/databases/(default)/documents/clinics/main';
/** Parses one bounded runQuery response. Probe results are never published.
 * At fixed readTime, EVERY response must confirm that same instant; increasing
 * stream times are accepted only during the discarded initial probe. */
export function parseCloudSnapshotQueryResponse(value: unknown, input: Omit<CloudSnapshotQuery, 'readTime'> & { readTime?: string }) {
  try {
    const scope = fields(input, ['collection', 'afterId', 'documentId', 'limit'], ['readTime']);
    if (![...CLOUD_SNAPSHOT_COLLECTIONS, 'settings', 'counters', 'expenseOperations', 'operationIntents'].includes(scope.collection) || !integer(scope.limit, 1, 50)
      || scope.afterId !== null && (typeof scope.afterId !== 'string' || scope.afterId.length > 100)
      || scope.documentId !== null && (typeof scope.documentId !== 'string' || scope.documentId.length > 100)
      || ['expenseOperations', 'operationIntents'].includes(scope.collection)
        && (!uuid(scope.documentId) || scope.afterId !== null || scope.limit !== 1 || scope.readTime === undefined)) fail();
    const expected = scope.readTime === undefined ? null : parseCloudSnapshotReadTime(scope.readTime);
    const records: { id: string; data: unknown }[] = []; let finalTime: string | null = null, previous = scope.afterId;
    const responses = rows(value, scope.limit + 200); if (!responses.length) fail();
    for (let index = 0; index < responses.length; index++) {
      const row = fields(responses[index], ['readTime'], ['document', 'skippedResults', 'done']);
      const stamp = parseCloudSnapshotReadTime(row.readTime);
      if (expected && timeKey(stamp) !== timeKey(expected) || finalTime && timeKey(stamp) < timeKey(finalTime)
        || row.skippedResults !== undefined && row.skippedResults !== 0 || row.done !== undefined && (row.done !== true || index !== responses.length - 1)) fail(); finalTime = stamp;
      if (row.document !== undefined) {
        const doc = fields(row.document, ['name'], ['fields', 'createTime', 'updateTime']);
        const prefix = `${documentRoot}/${scope.collection}/`;
        if (typeof doc.name !== 'string' || !doc.name.startsWith(prefix)) fail(); const id = doc.name.slice(prefix.length);
        if (!id || id.includes('/') || id.includes('%') || scope.documentId !== null && id !== scope.documentId || previous !== null && id <= previous) fail();
        if (doc.createTime !== undefined) parseCloudSnapshotReadTime(doc.createTime); if (doc.updateTime !== undefined) parseCloudSnapshotReadTime(doc.updateTime);
        records.push({ id, data: decodeFirestoreSnapshotValue({ mapValue: { fields: doc.fields ?? {} } }) }); previous = id;
        if (records.length > scope.limit) fail();
      }
    }
    if (!finalTime || new TextEncoder().encode(JSON.stringify(records)).byteLength > CLOUD_SNAPSHOT_LIMITS.responseBytes) fail();
    return { readTime: finalTime, records, nextAfterId: records.length === scope.limit ? previous as string : null };
  } catch { return fail(); }
}
async function sha256(value: string) { const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)); return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join(''); }
const normalizeSupplier = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase('ar-EG').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ');
function grouped<T>(values: T[], key: (value: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>(); for (const value of values) { const id = key(value), list = map.get(id) ?? []; list.push(value); map.set(id, list); } return map;
}
function costs(data: ReturnType<typeof parseCloudExpenseRecord>['data']): number[] {
  if (!data.items.length) return []; if (!data.subtotalCents) return data.items.map(() => 0);
  const values = data.items.map(row => ({ id: row.itemId, cost: Number(BigInt(row.totalCents) * BigInt(data.totalCents) / BigInt(data.subtotalCents)), remainder: BigInt(row.totalCents) * BigInt(data.totalCents) % BigInt(data.subtotalCents) }));
  let remaining = data.totalCents - values.reduce((sum, row) => sum + row.cost, 0);
  for (const row of [...values].sort((a, b) => a.remainder === b.remainder ? a.id < b.id ? -1 : 1 : a.remainder > b.remainder ? -1 : 1)) { if (remaining-- <= 0) break; row.cost++; } return values.map(row => row.cost);
}
/** Complete operational read-only export/report source, NOT disaster restore.
 * No automatic calls, arbitrary readTime/path, SDK, storage, writes or images.
 * Every collection/singleton is read again at ONE final server-probe instant.
 * Hard bounds reject oversized clinics; they never silently truncate totals. */
export function createCloudClinicSnapshotReader(adapter: CloudClinicSnapshotAdapter, options: { digest?: (value: string) => Promise<string> } = {}) {
  const digest = async (value: string) => { const hash = await (options.digest ?? sha256)(value); if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) fail(); return hash; };
  return Object.freeze({ async readDirectory(): Promise<CloudClinicDirectorySnapshot> {
    try {
      const assert = () => adapter.assertActive?.();
      const call = async <T>(work: () => Promise<T>) => { assert(); const value = await work(); assert(); return value; };
      const probe = parseCloudSnapshotQueryResponse(await call(() => adapter.probeReadTime()),
        { collection: 'settings', documentId: 'serviceCatalog', afterId: null, limit: 1 });
      const readTime = probe.readTime; let count = 0, byteLength = 0;
      const result: CloudClinicDirectorySnapshot = { readTime, patientProfiles: [], contactRecords: [] };
      const fileNos = new Set<number>(), contactPhones = new Set<string>();
      for (const collection of ['patientProfiles', 'contactRecords'] as const) {
        const records: any[] = []; let afterId: string | null = null;
        do {
          const input = { collection, documentId: null, afterId, limit: CLOUD_SNAPSHOT_LIMITS.pageSize, readTime };
          const page = parseCloudSnapshotQueryResponse(await call(() => adapter.query(input)), input);
          count += page.records.length;
          byteLength += new TextEncoder().encode(JSON.stringify(page.records)).byteLength;
          if (count > CLOUD_SNAPSHOT_LIMITS.totalRecords || byteLength > CLOUD_SNAPSHOT_LIMITS.totalBytes
            || records.length + page.records.length > CLOUD_SNAPSHOT_LIMITS.perCollection) fail();
          for (const row of page.records) {
            const parsed = parsers[collection](row.data);
            if (parsed.recordId !== row.id) fail();
            if (collection === 'patientProfiles') {
              const patient = parsed as ReturnType<typeof parseCloudPatientRecord>;
              const key = patient.data.mobile ? await call(() => digest(`patient-phone-v1:${normalizeContactPhone(patient.data.mobile)}`)) : null;
              if (patient.phoneKey !== key || fileNos.has(patient.fileNo)) fail(); fileNos.add(patient.fileNo);
            } else {
              const contact = parsed as ReturnType<typeof parseCloudContactRecord>;
              if (!contact.deleted) {
                const key = await call(() => digest(`contact-phone-v1:${normalizeContactPhone(contact.data!.mobile)}`));
                if (contact.phoneKey !== key || contactPhones.has(key)) fail(); contactPhones.add(key);
              }
            }
            records.push(parsed);
          }
          afterId = page.nextAfterId;
        } while (afterId !== null);
        result[collection] = records;
      }
      assert(); return freeze(result);
    } catch { return fail(); }
  }, async readFull(): Promise<CloudClinicSnapshot> {
    try {
      const assert = () => adapter.assertActive?.();
      const call = async <T>(work: () => Promise<T>) => { assert(); const value = await work(); assert(); return value; };
      const probe = parseCloudSnapshotQueryResponse(await call(() => adapter.probeReadTime()), { collection: 'settings', documentId: 'serviceCatalog', afterId: null, limit: 1 });
      const readTime = probe.readTime; let count = 0, byteLength = 0;
      const all: Record<string, any[]> = {};
      async function query(collection: CloudSnapshotQuery['collection'], documentId: string | null, afterId: string | null, limit: number) {
        const value = parseCloudSnapshotQueryResponse(await call(() => adapter.query({ collection, documentId, afterId, limit, readTime })), { collection, documentId, afterId, limit, readTime });
        byteLength += new TextEncoder().encode(JSON.stringify(value.records)).byteLength; count += value.records.length;
        if (byteLength > CLOUD_SNAPSHOT_LIMITS.totalBytes || count > CLOUD_SNAPSHOT_LIMITS.totalRecords) fail(); return value;
      }
      // A material head may refer to exactly one immutable receipt and intent.
      // Read only those names at the SAME instant as the public snapshot, and
      // keep their content private (never a journal/proof collection export).
      const privateRows = new Map<string, unknown | null>();
      async function readPrivate(collection: 'expenseOperations' | 'operationIntents', id: string): Promise<unknown | null> {
        const key = `${collection}/${id}`;
        if (privateRows.has(key)) return privateRows.get(key)!;
        const page = await query(collection, id, null, 1);
        if (page.records.length > 1 || page.records.length === 1 && page.records[0].id !== id) fail();
        const value = page.records[0]?.data ?? null; privateRows.set(key, value); return value;
      }
      for (const collection of CLOUD_SNAPSHOT_COLLECTIONS) {
        const records: unknown[] = []; let afterId: string | null = null, seenRecords = 0;
        do { const page = await query(collection, null, afterId, 50);
          for (const row of page.records) {
            if (++seenRecords > CLOUD_SNAPSHOT_LIMITS.perCollection) fail();
            const parsed = collection === 'materialBalances'
              ? await call(() => resolveCloudMaterialHead(parseCloudMaterialHead(row.data), readPrivate, { digest }))
              : parsers[collection](row.data as never);
            // A new cancelled/prepared head has no purchase yet. Its private
            // candidate must never inflate stock, expenses, reports or export.
            if (parsed === null) continue;
            const identity = collection === 'patientFiles' ? String((parsed as CloudPatientFileIndex).fileNo)
              : collection === 'patientAccounts' ? (parsed as ReturnType<typeof parseCloudClinicalAccount>).patientId
                : collection === 'patientSessions' ? (parsed as ReturnType<typeof parseCloudClinicalSession>).sessionId
                  : collection === 'patientReceipts' ? (parsed as ReturnType<typeof parseCloudClinicalReceipt>).receiptId
                    : collection === 'labAccounts' ? (parsed as ReturnType<typeof parseCloudLabAccount>).labId
                      : collection === 'labPayments' ? (parsed as ReturnType<typeof parseCloudLabPayment>).receiptId : (parsed as { recordId: string }).recordId;
            if (identity !== row.id) fail(); records.push(parsed);
          }
          if (records.length > CLOUD_SNAPSHOT_LIMITS.perCollection) fail(); afterId = page.nextAfterId;
        } while (afterId !== null); all[collection] = records;
      }
      const records = all as CloudClinicSnapshot['records'];
      async function singleton(collection: 'settings' | 'counters', documentId: string) { const page = await query(collection, documentId, null, 1);
        if (page.records.length !== 1 || page.records[0].id !== documentId) fail(); return page.records[0].data; }
      const counter = parseCounter(await singleton('counters', 'patientFiles'));
      const settings = { serviceCatalog: parseCloudServiceCatalogRecord(await singleton('settings', 'serviceCatalog')),
        clinicSettings: parseCloudClinicSettingsRecord(await singleton('settings', 'clinicSettings')),
        prostheticRouting: parseCloudProstheticRouting(await singleton('settings', 'prostheticRouting')) };
      const profiles = new Map(records.patientProfiles.map(row => [row.recordId, row])), accounts = new Map(records.patientAccounts.map(row => [row.patientId, row]));
      const files = new Map(records.patientFiles.map(row => [row.fileNo, row]));
      if (files.size !== records.patientFiles.length || files.size !== profiles.size || Math.max(0, ...files.keys()) !== counter.lastFileNo) fail();
      for (const profile of profiles.values()) {
        if (files.get(profile.fileNo)?.recordId !== profile.recordId || profile.phoneKey !== (profile.data.mobile ? await call(() => digest(`patient-phone-v1:${normalizeContactPhone(profile.data.mobile)}`)) : null)) fail();
      }
      for (const record of [...records.patientAccounts, ...records.patientSessions, ...records.patientReceipts]) if (!profiles.has(record.patientId) || profiles.get(record.patientId)!.fileNo !== record.fileNo) fail();
      const sessionsByPatient = grouped(records.patientSessions, row => row.patientId), receiptsByPatient = grouped(records.patientReceipts, row => row.patientId);
      const patients = records.patientProfiles.map(profile => projectCloudClinicalPatient(profile, accounts.get(profile.recordId) ?? null,
        sessionsByPatient.get(profile.recordId) ?? [], receiptsByPatient.get(profile.recordId) ?? []));
      const phoneKeys = new Set<string>();
      for (const contact of records.contactRecords) { if (contact.deleted) continue;
        const key = await call(() => digest(`contact-phone-v1:${normalizeContactPhone(contact.data!.mobile)}`)); if (contact.phoneKey !== key || phoneKeys.has(key)) fail(); phoneKeys.add(key); }
      const days = new Map(records.appointmentDays.map(row => [row.recordId, row]));
      const appointmentsByDay = grouped(records.appointmentRecords, row => row.data.date);
      for (const appointment of records.appointmentRecords) if (!days.has(appointment.data.date) || appointment.data.patientRecordId && !profiles.has(appointment.data.patientRecordId)) fail();
      for (const day of days.values()) {
        const slots = (appointmentsByDay.get(day.recordId) ?? []).filter(row => ['scheduled', 'confirmed', 'waiting', 'attended'].includes(row.data.status)).map(row => {
          const startMinute = Number(row.data.time.slice(0, 2)) * 60 + Number(row.data.time.slice(3)); return { recordId: row.recordId, startMinute, endMinute: startMinute + row.data.durationMinutes }; })
          .sort((a, b) => a.startMinute - b.startMinute || a.recordId.localeCompare(b.recordId));
        // Legacy readable indexes retain UUID order; compare a sorted copy,
        // without rewriting the historical record or mutating exported data.
        const storedSlots = [...day.slots].sort((a, b) => a.startMinute - b.startMinute || a.recordId.localeCompare(b.recordId));
        if (JSON.stringify(slots) !== JSON.stringify(storedSlots)) fail();
      }
      const labs = new Map(records.labDefinitions.map(row => [row.recordId, row])), sessions = new Map(records.patientSessions.map(row => [row.sessionId, row]));
      for (const route of settings.prostheticRouting.data.routes) {
        const service = settings.serviceCatalog.data.services.find(row => row.serviceId === route.serviceId), lab = labs.get(route.labId), material = lab?.data.costs.find(row => row.materialId === route.materialId);
        if (!service?.active || service.kind !== 'prosthetic' || !lab?.data.active || !material?.active) fail();
      }
      const cases = new Map(records.labCases.map(row => [row.recordId, row]));
      for (const item of cases.values()) { const session = sessions.get(item.sessionId), account = accounts.get(item.patientId);
        if (!labs.has(item.labId) || !session || !account) fail(); projectCloudProstheticFinancials({ item, session, account }); }
      for (const session of sessions.values()) if (session.data.prostheticCaseId && !cases.has(session.data.prostheticCaseId)) fail();
      for (const payment of records.labPayments) if (!labs.has(payment.labId) || payment.allocations.some(row => cases.get(row.caseId)?.labId !== payment.labId)) fail();
      const casesByLab = grouped(records.labCases, row => row.labId), paymentsByLab = grouped(records.labPayments, row => row.labId);
      const allocatedByCase = new Map<string, number>();
      for (const payment of records.labPayments) for (const row of payment.allocations) allocatedByCase.set(row.caseId, (allocatedByCase.get(row.caseId) ?? 0) + row.amountCents);
      for (const account of records.labAccounts) {
        if (!labs.has(account.labId)) fail(); const casesForLab = casesByLab.get(account.labId) ?? [], payments = paymentsByLab.get(account.labId) ?? [];
        if (account.caseCount !== casesForLab.length || account.paymentCount !== payments.length || account.totalCostCents !== casesForLab.reduce((sum, row) => sum + row.totalCostCents, 0)
          || account.paidCostCents !== payments.reduce((sum, row) => sum + row.amountCents, 0)
          || account.revision !== casesForLab.reduce((sum, row) => sum + row.revision, 0) - payments.reduce((sum, row) => sum + row.allocations.length - 1, 0)) fail();
        for (const item of casesForLab) if (item.paidCostCents !== (allocatedByCase.get(item.recordId) ?? 0)) fail();
      }
      const labAccountIds = new Set(records.labAccounts.map(row => row.labId)); for (const item of records.labCases) if (!labAccountIds.has(item.labId)) fail();
      const expenses = new Map(records.expenseRecords.map(row => [row.recordId, row])), materials = new Map(records.materialBalances.map(row => [row.recordId, row]));
      const paymentsByExpense = grouped(records.expensePayments, row => row.expenseId), usagesByMaterial = grouped(records.materialUsages, row => row.materialId);
      for (const payment of records.expensePayments) if (!expenses.has(payment.expenseId)) fail();
      const purchased = new Map<string, { quantity: number; cost: number; revisions: number }>(), invoiceKeys = new Set<string>();
      for (const expense of expenses.values()) {
        const payments = paymentsByExpense.get(expense.recordId) ?? [];
        if (payments.length !== expense.paymentCount || expense.paidCents !== payments.reduce((sum, row) => sum + row.amountCents, 0)) fail();
        const key = expense.data.invoiceNumber ? await call(() => digest(expense.inventoryVersion === 2
          ? cloudSupplierInvoiceIdentityV2(expense.data.supplierName, expense.data.invoiceNumber)
          : JSON.stringify(['clinic-supplier-invoice-v1', normalizeSupplier(expense.data.supplierName), normalizeSupplier(expense.data.invoiceNumber)]))) : null;
        if (key !== expense.invoiceKey || key && invoiceKeys.has(key)) fail(); if (key) invoiceKeys.add(key);
        const allocated = costs(expense.data), seen = new Set<string>();
        for (let index = 0; index < expense.data.items.length; index++) {
          const item = expense.data.items[index], key = await call(() => (expense.inventoryVersion === 2 ? cloudMaterialIdV2 : cloudMaterialId)(item.name, item.unit, { digest })), previous = purchased.get(key) ?? { quantity: 0, cost: 0, revisions: 0 };
          purchased.set(key, { quantity: previous.quantity + item.quantityMilli, cost: previous.cost + allocated[index], revisions: previous.revisions + (seen.has(key) ? 0 : 1) }); seen.add(key);
        }
      }
      for (const usage of records.materialUsages) if (!materials.has(usage.materialId)) fail();
      if (purchased.size !== materials.size) fail();
      for (const material of materials.values()) {
        if (await call(() => (material.identityVersion === 2 ? cloudMaterialIdV2 : cloudMaterialId)(material.name, material.unit, { digest })) !== material.recordId) fail();
        const purchase = purchased.get(material.recordId), usages = usagesByMaterial.get(material.recordId) ?? [];
        if (!purchase || purchase.quantity !== material.purchasedMilli || purchase.cost !== material.purchaseCostCents
          || material.revision !== purchase.revisions + usages.length || material.usedMilli !== usages.filter(row => row.kind === 'used').reduce((sum, row) => sum + row.quantityMilli, 0)
          || material.wasteMilli !== usages.filter(row => row.kind === 'waste').reduce((sum, row) => sum + row.quantityMilli, 0)
          || material.consumedCostCents !== usages.reduce((sum, row) => sum + row.costCents, 0)) fail();
      }
      assert(); return freeze({ readTime, records, counter, settings, patients });
    } catch { return fail(); }
  } });
}
