import type { CellObject, WorkBook, WorkSheet } from 'xlsx';
import type { Patient } from '../types';
import { canonicalFileNumber } from './clinicMutations';
import { normalizeContactPhone, normalizeContactSearch } from './clinicContacts';
import { getPatientFinancialSummary } from './financials';
import { serializeClinicCsv } from './csvExport';
import { readBoundedSpreadsheet } from './contactSpreadsheets';

export const PATIENT_COLUMNS = { id: 'رقم الملف', name: 'اسم المريض', mobile: 'الموبايل', age: 'السن', firstVisit: 'تاريخ الدخول', allergy: 'الحساسية والإنذارات', notes: 'ملاحظات', gender: 'الجنس', totalRequired: 'المطلوب بعد الخصم', totalPaid: 'المدفوع', totalRemain: 'المتبقي' } as const;
export type PatientExportColumns = Record<keyof typeof PATIENT_COLUMNS, boolean>;
export interface PatientImportRow { rowNumber: number; id: string; name: string; mobile: string; patient?: Patient; error?: string }
export interface PatientImportPreviewRow extends PatientImportRow { status: 'new' | 'duplicate' | 'invalid'; message: string }
const normalizeDigits = (value: string) => value.replace(/[٠-٩۰-۹]/g, digit => String(digit.charCodeAt(0) - (digit <= '٩' ? 0x0660 : 0x06f0)));
const headerKey = (value: string) => normalizeContactSearch(value).replace(/[\s_().-]/g, '');
const aliases: Record<string, string[]> = {
  id: ['رقم الملف', 'FileNo', 'File number', 'ID'], name: ['اسم المريض', 'الاسم', 'Name', 'Patient name'],
  mobile: ['الموبايل', 'رقم الموبايل', 'رقم الهاتف', 'Mobile', 'Phone'], age: ['السن', 'العمر', 'Age'],
  firstVisit: ['تاريخ الدخول', 'أول زيارة', 'FirstVisit', 'First visit'], allergy: ['الحساسية والإنذارات', 'الحساسية', 'Allergy'],
  notes: ['ملاحظات', 'ملاحظة', 'Notes'], gender: ['الجنس', 'Gender'],
};
const formulaPrefix = /^[\s\u0000-\u001f\u007f]*[=+\-@]/u;
function literal(value: string, csv: boolean): string {
  if (!csv) return value;
  if (value.startsWith("''")) return value.slice(1);
  if (value.startsWith("'") && (formulaPrefix.test(value.slice(1)) || /^[\t\r\n]/.test(value.slice(1)))) return value.slice(1);
  if (formulaPrefix.test(value)) throw new Error('قيمة تشبه معادلة؛ استخدم نصًا صريحًا.');
  return value;
}
function cellText(cell: CellObject | undefined): string {
  if (!cell || cell.v === null || cell.v === undefined) return '';
  if (cell.t === 'b' || cell.t === 'e' || cell.t === 'd' || typeof cell.v === 'object') throw new Error('نوع خلية غير صالح لهذا الحقل.');
  const result = String(cell.v).trim();
  if (result.length > 10_000) throw new Error('نص أطول من الحد المسموح.');
  return result;
}
/** Parse calendar dates without guessing an ambiguous month-first format or timezone conversion. */
export function parsePatientVisitDate(value: unknown): string {
  if (value === '' || value === null || value === undefined) return '';
  const text = value instanceof Date && Number.isFinite(value.getTime())
    ? `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`
    : normalizeDigits(String(value).trim());
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text), local = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);
  if (!iso && !local) throw new Error('تاريخ الزيارة غير صالح؛ استخدم YYYY-MM-DD أو يوم/شهر/سنة.');
  const year = Number(iso ? iso[1] : local![3]), month = Number(iso ? iso[2] : local![2]), day = Number(iso ? iso[3] : local![1]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (year < 1900 || year > 9999 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new Error('تاريخ الزيارة غير صالح.');
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Spreadsheet import creates basic NEW records only, never infers clinical history or receipts. */
export function parsePatientWorkbook(workbook: WorkBook, options: { csv?: boolean } = {}): PatientImportRow[] {
  const sheet = workbook.Sheets?.[workbook.SheetNames?.[0]];
  if (!sheet?.['!ref']) throw new Error('الورقة الأولى فارغة. استخدم قالب ملفات المرضى.');
  if (sheet['!merges']?.length) throw new Error('ألغِ دمج خلايا الورقة قبل الاستيراد.');
  const address = (value: string) => {
    const match = /^([A-Z]{1,3})([1-9]\d{0,6})$/.exec(value);
    if (!match) throw new Error('نطاق خلايا الملف غير صالح.');
    let column = 0; for (const letter of match[1]) column = column * 26 + letter.charCodeAt(0) - 64;
    const row = Number(match[2]);
    if (column > 32 || row > 5001) throw new Error('الحد الأقصى ٥٠٠٠ مريض و٣٢ عمودًا؛ لم يتم اقتطاع أي صفوف.');
    return { row, column };
  };
  for (const ref of [sheet['!ref'], sheet['!fullref']].filter(Boolean) as string[]) {
    const parts = ref.split(':'); if (parts.length > 2) throw new Error('نطاق خلايا الملف غير صالح.'); parts.forEach(address);
  }
  let lastRow = 1, lastColumn = 1, textCharacters = 0;
  for (const [key, cell] of Object.entries(sheet)) {
    if (key.startsWith('!')) continue;
    const pos = address(key); lastRow = Math.max(lastRow, pos.row); lastColumn = Math.max(lastColumn, pos.column);
    if (cell?.f !== undefined || cell?.F !== undefined) throw new Error(`الخلية ${key} تحتوي على معادلة. استبدلها بقيمة صريحة قبل الاستيراد.`);
    if (typeof cell?.v === 'string') {
      textCharacters += cell.v.length;
      if (cell.v.length > 10_000 || textCharacters > 4 * 1024 * 1024) throw new Error('النصوص في الملف كبيرة جدًا. قسّمه إلى ملفات أصغر؛ لم يُحفظ أي تغيير.');
    }
  }
  const colLabel = (column: number) => column <= 26 ? String.fromCharCode(64 + column) : 'A' + String.fromCharCode(64 + column - 26);
  const mapped = new Map<string, number>(), seen = new Set<string>();
  for (let column = 1; column <= lastColumn; column++) {
    const header = cellText(sheet[`${colLabel(column)}1`]).replace(/^\uFEFF/, ''); if (!header) continue;
    const key = headerKey(header), known = Object.keys(aliases).find(field => aliases[field].some(alias => headerKey(alias) === key));
    if (seen.has(key) || known && mapped.has(known)) throw new Error(`عنوان العمود «${header}» مكرر؛ اجعل لكل حقل عمودًا واحدًا.`);
    seen.add(key); if (known) mapped.set(known, column);
  }
  if (!mapped.has('id') || !mapped.has('name')) throw new Error('يلزم عمود «رقم الملف» و«اسم المريض» في الصف الأول.');
  const rows: PatientImportRow[] = [];
  for (let row = 2; row <= lastRow; row++) {
    if (Array.from({ length: lastColumn }, (_, index) => sheet[`${colLabel(index + 1)}${row}`]).every(cell => !cell || cell.v === undefined || cell.v === null || String(cell.v).trim() === '')) continue;
    const result: PatientImportRow = { rowNumber: row, id: '', name: '', mobile: '' };
    const get = (field: string) => mapped.has(field) ? sheet[`${colLabel(mapped.get(field)!)}${row}`] as CellObject | undefined : undefined;
    try {
      const rawId = get('id');
      const idText = cellText(rawId);
      // Our CSV writer marks EVERY file ID as literal text. Remove exactly one
      // marker, including alphabetic IDs; an original apostrophe is doubled.
      // Preserve the source file identity. Canonical digit conversion belongs
      // only in duplicate comparison, not in imported/saved/exported values.
      result.id = options.csv && idText.startsWith("'") ? idText.slice(1) : literal(idText, !!options.csv);
      result.name = literal(cellText(get('name')), !!options.csv);
      const phoneCell = get('mobile'); result.mobile = cellText(phoneCell);
      if (options.csv && result.mobile.startsWith("'") && normalizeContactPhone(result.mobile.slice(1))) result.mobile = result.mobile.slice(1);
      if (!result.id || result.id.length > 200 || /[\u0000-\u001f\u007f]/.test(result.id) || rawId?.t === 'n' && (!Number.isSafeInteger(rawId.v) || Number(rawId.v) <= 0 || /^0{2,}/.test(String(rawId.z || '')))) throw new Error('رقم الملف غير صالح. احفظه كنص للحفاظ على الأصفار.');
      if (!result.name || result.name.length > 200) throw new Error('اسم المريض مطلوب ولا يزيد عن ٢٠٠ حرف.');
      if (phoneCell?.t === 'n' || typeof phoneCell?.v === 'number') throw new Error('الموبايل محفوظ كرقم وقد فقد الصفر؛ أعد كتابة الرقم كاملًا كنص.');
      if (result.mobile && !normalizeContactPhone(result.mobile)) throw new Error('رقم الموبايل غير مكتمل أو غير صالح.');
      const ageText = normalizeDigits(cellText(get('age'))), age = ageText ? Number(ageText) : 0;
      if (!Number.isInteger(age) || age < 0 || age > 120) throw new Error('السن يجب أن يكون عددًا صحيحًا من ٠ إلى ١٢٠.');
      const gender = literal(cellText(get('gender')), !!options.csv).toLowerCase();
      if (gender && !['female', 'male', 'أنثى', 'انثى', 'ذكر'].includes(gender)) throw new Error('الجنس اختياري: ذكر أو أنثى.');
      const dateCell = get('firstVisit');
      if (dateCell?.t === 'e' || dateCell?.t === 'b' || dateCell?.t === 'n') throw new Error('تاريخ الزيارة يجب أن يكون تاريخ Excel أو نص YYYY-MM-DD.');
      const allergy = literal(cellText(get('allergy')), !!options.csv), notes = literal(cellText(get('notes')), !!options.csv);
      if (notes.length > 10_000 || allergy.length > 10_000) throw new Error('الملاحظة أطول من الحد المسموح.');
      result.patient = { id: result.id, name: result.name, mobile: result.mobile, age, firstVisit: parsePatientVisitDate(dateCell?.v), allergy: allergy === 'لا يوجد' ? '' : allergy, notes,
        gender: gender ? ['female', 'أنثى', 'انثى'].includes(gender) ? 'female' : 'male' : undefined, sessions: [], payments: [] };
    } catch (error) { result.error = error instanceof Error ? error.message : 'بيانات الصف غير صالحة.'; }
    rows.push(result);
  }
  return rows;
}
export async function readPatientSpreadsheet(file: File): Promise<PatientImportRow[]> {
  const { workbook, csv } = await readBoundedSpreadsheet(file);
  return parsePatientWorkbook(workbook, { csv });
}
export function previewPatientImport(inputs: readonly PatientImportRow[], patients: readonly Patient[]) {
  const ids = new Set(patients.map(patient => canonicalFileNumber(patient.id)));
  const rows: PatientImportPreviewRow[] = inputs.map(row => {
    if (!row.patient || row.error) return { ...row, status: 'invalid', message: row.error || 'بيانات غير صالحة.' };
    const key = canonicalFileNumber(row.patient.id);
    if (ids.has(key)) return { ...row, status: 'duplicate', message: 'رقم الملف موجود بالفعل؛ لن ندمج أو نستبدل الملف.' };
    ids.add(key); return { ...row, status: 'new', message: 'ملف جديد جاهز للإضافة.' };
  });
  return { rows, newPatients: rows.filter(row => row.status === 'new').map(row => row.patient!), newCount: rows.filter(row => row.status === 'new').length,
    duplicateCount: rows.filter(row => row.status === 'duplicate').length, invalidCount: rows.filter(row => row.status === 'invalid').length };
}

function patientExportRows(patients: readonly Patient[], columns: PatientExportColumns, finance: boolean): { keys: Array<keyof PatientExportColumns>; rows: (string | number)[][] } {
  const keys = (Object.keys(PATIENT_COLUMNS) as Array<keyof PatientExportColumns>).filter(key => columns[key] && (finance || !['totalRequired', 'totalPaid', 'totalRemain'].includes(key)));
  if (!keys.length) throw new Error('اختر عمودًا متاحًا واحدًا على الأقل.');
  return { keys, rows: patients.map(patient => {
    const financial = keys.some(key => ['totalRequired', 'totalPaid', 'totalRemain'].includes(key)) ? getPatientFinancialSummary(patient) : null;
    return keys.map(key => key === 'totalRequired' ? Math.max(0, financial!.totalRequired - financial!.totalDiscounts) : key === 'totalPaid' ? financial!.totalCollected : key === 'totalRemain' ? financial!.totalRemaining : patient[key] ?? '');
  }) };
}
export function serializePatientCsv(patients: readonly Patient[], columns: PatientExportColumns, finance: boolean): string {
  const { keys, rows } = patientExportRows(patients, columns, finance);
  return serializeClinicCsv(keys.map(key => PATIENT_COLUMNS[key]), rows.map(row => row.map((value, index) => ['id', 'mobile'].includes(keys[index]) && value !== '' ? `'${value}` : typeof value === 'string' && value.startsWith("'") ? `'${value}` : value)));
}
export async function createPatientWorkbook(patients: readonly Patient[], columns: PatientExportColumns, finance: boolean): Promise<WorkBook> {
  const XLSX = await import('xlsx');
  const { keys, rows } = patientExportRows(patients, columns, finance);
  const sheet: WorkSheet = {};
  const values: (string | number)[][] = [keys.map(key => PATIENT_COLUMNS[key]), ...rows];
  values.forEach((row, r) => row.forEach((value, c) => { sheet[XLSX.utils.encode_cell({ r, c })] = typeof value === 'number' ? { t: 'n', v: value } : { t: 's', v: value, z: '@' }; }));
  sheet['!ref'] = XLSX.utils.encode_range({ r: 0, c: 0 }, { r: values.length - 1, c: keys.length - 1 });
  sheet['!cols'] = keys.map(key => ({ wch: ['name', 'notes', 'allergy'].includes(key) ? 32 : 22 })); sheet['!autofilter'] = { ref: sheet['!ref'] };
  const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, sheet, 'ملفات المرضى'); workbook.Workbook = { Views: [{ RTL: true }] }; return workbook;
}
export function downloadTransferBlob(blob: Blob, filename: string, authorize: () => void): void {
  const url = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href = url; anchor.download = filename;
  try { authorize(); anchor.click(); } finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
export async function downloadPatientSpreadsheet(patients: readonly Patient[], columns: PatientExportColumns, finance: boolean, format: 'xlsx' | 'csv', authorize: () => void): Promise<void> {
  authorize();
  if (format === 'csv') { downloadTransferBlob(new Blob([serializePatientCsv(patients, columns, finance)], { type: 'text/csv;charset=utf-8' }), 'ملفات_المرضى.csv', authorize); return; }
  const workbook = await createPatientWorkbook(patients, columns, finance), XLSX = await import('xlsx');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx', compression: true });
  downloadTransferBlob(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), patients.length ? 'ملفات_المرضى.xlsx' : 'قالب_ملفات_المرضى.xlsx', authorize);
}
