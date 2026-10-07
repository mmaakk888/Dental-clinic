import type { ClinicContact, Patient } from '../types';
import { clinicContactValidationError, normalizeContactPhone } from './clinicContacts';

export const MAX_CONTACT_IMPORT_ROWS = 5000;
export const MAX_CONTACT_IMPORT_CELL_CHARACTERS = 10_000;
export const MAX_CONTACT_IMPORT_TEXT_BYTES = 8 * 1024 * 1024;

export interface ContactImportInput {
  rowNumber: number;
  name: string;
  mobile: string;
  notes: string;
}

export interface ContactImportPreviewRow extends ContactImportInput {
  status: 'new' | 'duplicate' | 'invalid';
  message: string;
  patientIds: string[];
}

export interface ContactImportPreview {
  rows: ContactImportPreviewRow[];
  newCount: number;
  duplicateCount: number;
  invalidCount: number;
}

export interface ContactImportOptions {
  createId?: () => string;
  createdAt?: string;
}

export interface ContactImportSummary {
  addedCount: number;
  duplicateCount: number;
  invalidCount: number;
}

const VALIDATION_TIMESTAMP = '2000-01-01T00:00:00.000Z';
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

/** Parser output has a strict shape. Invalid field contents are previewed, not silently coerced. */
function requireImportInputs(inputs: readonly ContactImportInput[]): void {
  if (!Array.isArray(inputs)) throw new Error('بيانات استيراد جهات الاتصال يجب أن تكون قائمة صفوف صالحة.');
  if (inputs.length > MAX_CONTACT_IMPORT_ROWS) throw new Error('الحد الأقصى للاستيراد ٥٠٠٠ جهة اتصال في المرة الواحدة. قسّم الملف قبل الاستيراد.');
  let textBytes = 0;
  const encoder = new TextEncoder();
  // A sparse array must not skip a malformed row when Array.map/forEach runs.
  for (let index = 0; index < inputs.length; index++) {
    const row: unknown = inputs[index];
    if (!isRecord(row) || !Number.isSafeInteger(row.rowNumber) || Number(row.rowNumber) < 1
      || typeof row.name !== 'string' || typeof row.mobile !== 'string' || typeof row.notes !== 'string') {
      throw new Error(`بنية صف الاستيراد ${index + 1} غير صالحة. راجع الاسم والموبايل والملاحظات ورقم الصف.`);
    }
    // Ordinary over-limit names/notes remain visible as invalid preview rows.
    // Extreme raw cell/payload sizes are refused before any result array or ID is built.
    for (const value of [row.name, row.mobile, row.notes]) {
      if (value.length > MAX_CONTACT_IMPORT_CELL_CHARACTERS) throw new Error(`أحد حقول الصف ${row.rowNumber} كبير جدًا؛ الحد الأقصى ١٠ آلاف حرف للحقل.`);
      textBytes += encoder.encode(value).byteLength;
      if (textBytes > MAX_CONTACT_IMPORT_TEXT_BYTES) throw new Error('نصوص الاستيراد تتجاوز ٨ ميجابايت؛ قسّم الملف قبل الاستيراد.');
    }
  }
}

function existingContactPhones(contacts: readonly ClinicContact[]): Map<string, Pick<ClinicContact, 'id' | 'name' | 'mobile'>> {
  if (!Array.isArray(contacts)) throw new Error('قائمة جهات الاتصال الحالية غير صالحة؛ لم يبدأ الاستيراد.');
  const phones = new Map<string, Pick<ClinicContact, 'id' | 'name' | 'mobile'>>();
  for (const contact of contacts) {
    if (!isRecord(contact) || typeof contact.id !== 'string' || typeof contact.name !== 'string' || typeof contact.mobile !== 'string') {
      throw new Error('قائمة جهات الاتصال الحالية تحتوي سجلًا غير صالح؛ لم يبدأ الاستيراد.');
    }
    const phone = normalizeContactPhone(contact.mobile);
    if (phone && !phones.has(phone)) phones.set(phone, { id: contact.id, name: contact.name, mobile: contact.mobile });
  }
  return phones;
}

function patientFilesByPhone(patients: readonly Patient[]): Map<string, string[]> {
  if (!Array.isArray(patients)) throw new Error('قائمة ملفات المرضى غير صالحة؛ تعذّرت معاينة الاستيراد.');
  const files = new Map<string, string[]>();
  for (const patient of patients) {
    if (!isRecord(patient) || typeof patient.id !== 'string' || typeof patient.mobile !== 'string') {
      throw new Error('أحد ملفات المرضى غير صالح؛ تعذّرت معاينة الاستيراد.');
    }
    const phone = normalizeContactPhone(patient.mobile);
    if (!phone) continue;
    const ids = files.get(phone) ?? [];
    if (!ids.includes(patient.id)) ids.push(patient.id);
    files.set(phone, ids);
  }
  return files;
}

function rowValidationError(row: ContactImportInput): string | null {
  return clinicContactValidationError({ id: 'contact-import-validation', name: row.name,
    mobile: row.mobile, notes: row.notes, createdAt: VALIDATION_TIMESTAMP });
}

/** Names, file matches and duplicates are informational; no patient or contact is changed. */
export function previewContactImport(inputs: readonly ContactImportInput[], contacts: readonly ClinicContact[], patients: readonly Patient[]): ContactImportPreview {
  requireImportInputs(inputs);
  const existing = existingContactPhones(contacts);
  const files = patientFilesByPhone(patients);
  const batchPhones = new Map<string, number>();
  const result: ContactImportPreview = { rows: [], newCount: 0, duplicateCount: 0, invalidCount: 0 };
  for (const input of inputs) {
    const phone = normalizeContactPhone(input.mobile);
    const patientIds = [...(files.get(phone) ?? [])];
    const error = rowValidationError(input);
    let status: ContactImportPreviewRow['status'];
    let message: string;
    if (error) {
      status = 'invalid'; message = error; result.invalidCount++;
    } else if (existing.has(phone)) {
      status = 'duplicate'; message = `الرقم محفوظ بالفعل باسم «${existing.get(phone)!.name}»؛ لن نغيّر السجل الموجود.`;
      result.duplicateCount++;
    } else if (batchPhones.has(phone)) {
      status = 'duplicate'; message = `الرقم مكرر في الصف ${batchPhones.get(phone)} من هذا الملف؛ سيُضاف مرة واحدة.`;
      result.duplicateCount++;
    } else {
      status = 'new'; message = patientIds.length ? 'جهة اتصال جديدة؛ الرقم مرتبط بملف مريض، دون دمج تلقائي.' : 'جهة اتصال جديدة بدون ملف مطابق.';
      batchPhones.set(phone, input.rowNumber); result.newCount++;
    }
    result.rows.push({ rowNumber: input.rowNumber, name: input.name, mobile: input.mobile, notes: input.notes, status, message, patientIds });
  }
  return result;
}

/** Re-evaluate against fresh contacts under the caller's write lock. Never trust a prior preview. */
export function applyContactImport(contacts: readonly ClinicContact[], inputs: readonly ContactImportInput[], options: ContactImportOptions = {}): ContactImportSummary & { contacts: ClinicContact[] } {
  requireImportInputs(inputs);
  const phones = existingContactPhones(contacts);
  if (!isRecord(options) || options.createId !== undefined && typeof options.createId !== 'function') {
    throw new Error('إعدادات استيراد جهات الاتصال غير صالحة؛ لم يبدأ الاستيراد.');
  }
  const createdAt = options.createdAt === undefined ? new Date().toISOString() : options.createdAt;
  if (typeof createdAt !== 'string') throw new Error('تاريخ الاستيراد غير صالح؛ لم يبدأ الاستيراد.');
  const timestampError = clinicContactValidationError({ id: 'contact-import-validation', name: 'تحقق', mobile: '01012345678', createdAt });
  if (timestampError) throw new Error(`لم يبدأ الاستيراد. ${timestampError}`);
  const createId: () => string = typeof options.createId === 'function'
    ? options.createId as () => string : () => `contact_${crypto.randomUUID()}`;
  const ids = new Set(contacts.map(contact => contact.id));
  const additions: ClinicContact[] = [];
  let duplicateCount = 0;
  let invalidCount = 0;
  for (const input of inputs) {
    if (rowValidationError(input)) { invalidCount++; continue; }
    const phone = normalizeContactPhone(input.mobile);
    if (phones.has(phone)) { duplicateCount++; continue; }
    const contact: ClinicContact = { id: createId(), name: input.name.trim().replace(/\s+/g, ' '),
      mobile: input.mobile.trim(), notes: input.notes.trim(), createdAt };
    const error = clinicContactValidationError(contact);
    if (error) throw new Error(`لم يبدأ الاستيراد. ${error}`);
    if (ids.has(contact.id)) throw new Error('معرّف جهة اتصال مكرر؛ لم يبدأ الاستيراد. أعد المحاولة.');
    ids.add(contact.id); phones.set(phone, contact); additions.push(contact);
  }
  // Publish one new array only after all ID generation and validation succeeded.
  // Existing records/metadata/order stay untouched, including duplicate rows' notes.
  return { contacts: [...contacts, ...additions], addedCount: additions.length, duplicateCount, invalidCount };
}
