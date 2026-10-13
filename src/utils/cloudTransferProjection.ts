import type { PatientImportRow } from './patientSpreadsheets';
import type { ContactImportInput } from './contactTransfer';
import type { CloudClinicSnapshot } from './cloudClinicSnapshot';
import { prepareCloudPatientCommand, type CloudPatientProfile } from './cloudPatientRepository';
import { prepareCloudContactCommand } from './cloudContactRepository';
import { normalizeContactPhone, normalizeContactSearch } from './clinicContacts';

export type CloudTransferKind = 'patients' | 'contacts';
export interface CloudTransferPreviewRow {
  rowNumber: number; name: string; mobile: string; fileNo: number | null;
  status: 'ready' | 'duplicate' | 'invalid'; message: string;
  matchingFiles: readonly { fileNo: number; name: string; reason: 'phone' | 'name' | 'phone-and-name' }[];
  matchingFileCount: number;
  profile: CloudPatientProfile | null; contact: { name: string; mobile: string; notes: string } | null;
}
export interface CloudTransferPreview {
  kind: CloudTransferKind; readTime: string; rows: readonly CloudTransferPreviewRow[];
  readyCount: number; duplicateCount: number; invalidCount: number;
}
const VALIDATION_ID = '00000000-0000-4000-8000-000000000001';
const VALIDATION_TIME = '2000-01-01T00:00:00.000Z';
function fail(): never { throw new Error('بنية ملف الاستيراد غير صالحة؛ لم يبدأ الحفظ.'); }
function object(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail();
  const keys = Reflect.ownKeys(value), result: Record<string, any> = {};
  if (required.some(key => !keys.includes(key)) || keys.some(key => typeof key !== 'string' || ![...required, ...optional].includes(key))) fail();
  for (const key of keys as string[]) { const d = Object.getOwnPropertyDescriptor(value, key); if (!d || !('value' in d) || !d.enumerable) fail(); result[key] = d.value; }
  return result;
}
function dense(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > 5000 || Reflect.ownKeys(value).length !== value.length + 1) fail();
  return Array.from({ length: value.length }, (_, index) => { const d = Object.getOwnPropertyDescriptor(value, String(index)); if (!d || !('value' in d) || !d.enumerable) fail(); return d.value; });
}
function text(value: unknown, limit = 10_000): string { if (typeof value !== 'string' || value.length > limit) fail(); return value; }
export function cloudImportFileNo(value: unknown): number {
  const raw = text(value, 200), digits = raw.replace(/[٠-٩۰-۹]/g, c => String(c.charCodeAt(0) - (c <= '٩' ? 0x660 : 0x6f0)));
  // Leading-zero/alphabetic IDs are not silently changed to another identity.
  if (!/^[1-9]\d{0,9}(?![\s\S])/.test(digits) || Number(digits) > 2_000_000_000) throw new Error('رقم الملف يجب أن يكون عددًا صحيحًا من ١ إلى ٢٠٠٠٠٠٠٠٠٠ دون أصفار بادئة؛ لن نغيّر هويته تلقائيًا.');
  return Number(digits);
}
function freeze<T>(value: T): T { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }

/** Capture parser output before any asynchronous authorization/read. Getters,
 * inherited fields, sparse arrays and clinical history are never traversed. */
export function prepareCloudTransferRows(kind: CloudTransferKind, inputs: readonly PatientImportRow[] | readonly ContactImportInput[]): PatientImportRow[] | ContactImportInput[] {
  if (!['patients', 'contacts'].includes(kind)) fail();
  let bytes = 0;
  const checkedText = (value: unknown) => { const result = text(value); bytes += new TextEncoder().encode(result).byteLength; if (bytes > 8 * 1024 * 1024) fail(); return result; };
  return freeze(dense(inputs).map(input => {
    const row = object(input, kind === 'patients' ? ['rowNumber', 'id', 'name', 'mobile'] : ['rowNumber', 'name', 'mobile', 'notes'], kind === 'patients' ? ['patient', 'error'] : []);
    if (!Number.isSafeInteger(row.rowNumber) || row.rowNumber < 1) fail();
    for (const key of ['name', 'mobile', ...(kind === 'patients' ? ['id'] : ['notes'])]) checkedText(row[key]);
    if (row.error !== undefined) checkedText(row.error);
    if (row.patient !== undefined) {
      const p = object(row.patient, ['id', 'name', 'mobile', 'age', 'firstVisit', 'allergy', 'notes', 'sessions', 'payments'], ['gender']);
      if (dense(p.sessions).length || dense(p.payments).length) fail();
      for (const key of ['id', 'name', 'mobile', 'firstVisit', 'allergy', 'notes']) checkedText(p[key]);
      if (p.gender !== undefined) checkedText(p.gender);
      row.patient = { ...p, sessions: [], payments: [] };
    }
    return row;
  })) as PatientImportRow[] | ContactImportInput[];
}

/** A preview from one confirmed complete cloud snapshot. It grants no write
 * permission; ordinary per-row transactions recheck uniqueness at commit. */
export function previewCloudTransfer(kind: CloudTransferKind, inputs: readonly PatientImportRow[] | readonly ContactImportInput[], snapshot: CloudClinicSnapshot): CloudTransferPreview {
  if (!['patients', 'contacts'].includes(kind)) fail();
  const rows = dense(inputs), seenRows = new Set<number>(); let bytes = 0;
  const profiles = snapshot.records.patientProfiles, contacts = snapshot.records.contactRecords;
  const files = new Set(profiles.map(p => p.fileNo)), existingPhones = new Map<string, string>();
  for (const contact of contacts) if (!contact.deleted && contact.data) existingPhones.set(normalizeContactPhone(contact.data.mobile), contact.data.name);
  const byPhone = new Map<string, typeof profiles>(), byName = new Map<string, typeof profiles>();
  for (const patient of profiles) {
    const phone = normalizeContactPhone(patient.data.mobile), name = normalizeContactSearch(patient.data.name);
    if (phone) { const list = byPhone.get(phone) ?? []; list.push(patient); byPhone.set(phone, list); }
    if (name) { const list = byName.get(name) ?? []; list.push(patient); byName.set(name, list); }
  }
  for (const values of [...byPhone.values(), ...byName.values()]) values.sort((a, b) => a.fileNo - b.fileNo);
  const batchPhones = new Set<string>(), result: CloudTransferPreviewRow[] = [];
  for (const input of rows) {
    const row = object(input, kind === 'patients' ? ['rowNumber', 'id', 'name', 'mobile'] : ['rowNumber', 'name', 'mobile', 'notes'], kind === 'patients' ? ['patient', 'error'] : []);
    if (!Number.isSafeInteger(row.rowNumber) || row.rowNumber < 1 || seenRows.has(row.rowNumber)) fail(); seenRows.add(row.rowNumber);
    const name = text(row.name), mobile = text(row.mobile), phone = normalizeContactPhone(mobile), normalizedName = normalizeContactSearch(name);
    for (const v of [name, mobile, row.notes ?? '', row.id ?? '']) { bytes += new TextEncoder().encode(text(v)).byteLength; if (bytes > 8 * 1024 * 1024) fail(); }
    const phoneMatches = byPhone.get(phone) ?? [], nameMatches = byName.get(normalizedName) ?? [];
    const nameOnly = nameMatches.filter(p => normalizeContactPhone(p.data.mobile) !== phone || !phone);
    const matches = [...phoneMatches.slice(0, 20).map(p => ({ fileNo: p.fileNo, name: p.data.name,
      reason: normalizeContactSearch(p.data.name) === normalizedName ? 'phone-and-name' as const : 'phone' as const })),
      ...nameOnly.slice(0, Math.max(0, 20 - phoneMatches.length)).map(p => ({ fileNo: p.fileNo, name: p.data.name, reason: 'name' as const }))];
    const next: CloudTransferPreviewRow = { rowNumber: row.rowNumber, name, mobile, fileNo: null, status: 'invalid', message: '',
      matchingFiles: matches.sort((a, b) => a.fileNo - b.fileNo), matchingFileCount: phoneMatches.length + nameOnly.length, profile: null, contact: null };
    try {
      if (kind === 'patients') {
        if (row.error !== undefined) throw new Error(text(row.error));
        if (!row.patient) throw new Error('بيانات الملف غير صالحة.');
        const p = object(row.patient, ['id', 'name', 'mobile', 'age', 'firstVisit', 'allergy', 'notes', 'sessions', 'payments'], ['gender']);
        if (p.id !== row.id || p.name !== name || p.mobile !== mobile || dense(p.sessions).length || dense(p.payments).length) throw new Error('الاستيراد يقبل بيانات الملف الأساسية فقط، دون جلسات أو مدفوعات.');
        const fileNo = cloudImportFileNo(row.id);
        const profile: CloudPatientProfile = { name: text(p.name, 200), mobile: text(p.mobile, 60), age: p.age, gender: p.gender ?? '',
          firstVisit: text(p.firstVisit, 10), notes: text(p.notes, 4000), allergy: text(p.allergy, 1000) };
        bytes += new TextEncoder().encode(JSON.stringify(profile)).byteLength; if (bytes > 8 * 1024 * 1024) fail();
        prepareCloudPatientCommand({ operationId: VALIDATION_ID, recordId: VALIDATION_ID, expectedRevision: 0, action: 'import', fileNo, profile });
        next.fileNo = fileNo; next.profile = profile;
        if (files.has(fileNo)) { next.status = 'duplicate'; next.message = 'رقم الملف موجود أو مكرر في هذا الملف؛ لن ندمج أو نستبدل بياناته.'; }
        else { files.add(fileNo); next.status = 'ready'; next.message = 'يُحفظ بنفس رقم الملف التاريخي؛ تاريخ أول زيارة الفارغ يبقى غير مسجل.'; }
      } else {
        const contact = { name: name.trim().replace(/\s+/g, ' '), mobile: mobile.trim(), notes: text(row.notes, 2000).trim() };
        prepareCloudContactCommand({ operationId: VALIDATION_ID, recordId: VALIDATION_ID, expectedRevision: 0, action: 'create',
          contact: { ...contact, id: VALIDATION_ID, createdAt: VALIDATION_TIME } });
        next.contact = contact;
        if (existingPhones.has(phone) || batchPhones.has(phone)) { next.status = 'duplicate'; next.message = existingPhones.has(phone)
          ? `الرقم محفوظ باسم «${existingPhones.get(phone)}»؛ لن نغيّر السجل الموجود.` : 'الرقم مكرر داخل الملف؛ يُضاف مرة واحدة فقط.'; }
        else { batchPhones.add(phone); next.status = 'ready'; next.message = 'جهة اتصال جديدة؛ مطابقة ملف مريض للتنبيه فقط، دون إنشاء ملف أو دمج أو موافقة تسويقية.'; }
      }
    } catch (error) { next.status = 'invalid'; next.profile = null; next.contact = null; next.message = error instanceof Error && error.message.length <= 300 ? error.message : 'راجع بيانات الصف وحدود الحقول؛ لا اقتطاع أو تخمين للقيم.'; }
    if (bytes > 8 * 1024 * 1024) fail();
    result.push(next);
  }
  return freeze({ kind, readTime: snapshot.readTime, rows: result, readyCount: result.filter(r => r.status === 'ready').length,
    duplicateCount: result.filter(r => r.status === 'duplicate').length, invalidCount: result.filter(r => r.status === 'invalid').length });
}
