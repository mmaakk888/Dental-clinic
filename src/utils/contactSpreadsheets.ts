import type { CellObject, WorkBook, WorkSheet } from 'xlsx';
import type { ContactImportInput } from './contactTransfer';
import { MAX_CONTACT_IMPORT_ROWS } from './contactTransfer';
import { normalizeContactPhone, normalizeContactSearch } from './clinicContacts';
import { serializeClinicCsv } from './csvExport';

export const MAX_CONTACT_SPREADSHEET_BYTES = 5 * 1024 * 1024;
export const MAX_CONTACT_SPREADSHEET_COLUMNS = 32;
export const CONTACT_SPREADSHEET_HEADERS = ['الاسم', 'رقم الموبايل', 'ملاحظة', 'أرقام الملفات المرتبطة'] as const;
export interface ContactExportRow { name: string; mobile: string; notes: string; patientIds: string[] }
type ImportColumn = 'name' | 'mobile' | 'notes';
const headerKey = (value: string) => normalizeContactSearch(value).replace(/[\s_().-]/g, '');
const aliases: Record<ImportColumn, readonly string[]> = {
  name: ['الاسم', 'اسم', 'اسم المريض', 'اسم جهة الاتصال', 'name', 'full name', 'patient name', 'contact name'],
  mobile: ['رقم الموبايل', 'الموبايل', 'موبايل', 'رقم المحمول', 'المحمول', 'رقم الهاتف', 'الهاتف', 'هاتف', 'رقم التليفون', 'تليفون', 'mobile', 'mobile number', 'phone', 'phone number', 'telephone', 'whatsapp'],
  notes: ['ملاحظة', 'ملاحظات', 'الملاحظات', 'note', 'notes'],
};
const columnForHeader = (header: string): ImportColumn | undefined => (Object.keys(aliases) as ImportColumn[])
  .find(key => aliases[key].some(alias => headerKey(alias) === headerKey(header)));
const formulaPrefix = /^[\s\u0000-\u001f\u007f]*[=+\-@]/u;

function cellAddress(column: number, row: number): string {
  let label = '';
  for (let value = column + 1; value > 0; value = Math.floor((value - 1) / 26)) label = String.fromCharCode(65 + (value - 1) % 26) + label;
  return `${label}${row + 1}`;
}
function coordinates(address: string): { row: number; column: number } {
  const match = /^([A-Z]{1,3})([1-9]\d{0,6})$/.exec(address);
  if (!match) throw new Error('نطاق خلايا الملف غير صالح. استخدم قالب جهات الاتصال.');
  let column = 0;
  for (const letter of match[1]) column = column * 26 + letter.charCodeAt(0) - 64;
  return { column: column - 1, row: Number(match[2]) - 1 };
}
function assertDimensions(last: { row: number; column: number }): void {
  if (last.column >= MAX_CONTACT_SPREADSHEET_COLUMNS) throw new Error('الملف يتجاوز ٣٢ عمودًا. انسخ أعمدة البيانات المطلوبة فقط إلى ملف جديد.');
  if (last.row > MAX_CONTACT_IMPORT_ROWS) throw new Error('الملف يتجاوز ٥٠٠٠ صف بيانات. قسّمه إلى ملفات أصغر؛ لم يتم اقتطاع أي صفوف.');
}
function getCell(sheet: WorkSheet, column: number, row: number): CellObject | undefined { return sheet[cellAddress(column, row)]; }
function rawText(cell: CellObject | undefined): string {
  if (!cell || cell.v === undefined || cell.v === null) return '';
  if (cell.t === 'e' || cell.t === 'd' || cell.t === 'b' || typeof cell.v === 'object') throw new Error('توجد خلايا تاريخ أو خطأ أو قيمة غير نصية. استخدم نصًا للاسم والهاتف والملاحظة.');
  return String(cell.v);
}
function csvLiteral(value: string, phone = false): string {
  if (phone) return value.startsWith("'") && normalizeContactPhone(value.slice(1)) ? value.slice(1) : value;
  if (value.startsWith("''")) return value.slice(1);
  // Remove only the protective marker our CSV serializer adds, not arbitrary apostrophes.
  if (value.startsWith("'") && (formulaPrefix.test(value.slice(1)) || /^[\t\r\n]/.test(value.slice(1)))) return value.slice(1);
  if (formulaPrefix.test(value)) throw new Error('توجد قيمة تشبه معادلة في CSV. حوّلها إلى نص صريح أو استخدم قالب Excel قبل الاستيراد.');
  return value;
}

/** First sheet only, first row is the header. No clinical fields or consent are imported. */
export function parseContactWorkbook(workbook: WorkBook, options: { csv?: boolean } = {}): ContactImportInput[] {
  const firstName = workbook.SheetNames?.[0];
  const sheet = firstName ? workbook.Sheets?.[firstName] : undefined;
  if (!sheet || !sheet['!ref']) throw new Error('الورقة الأولى فارغة. استخدم قالب جهات الاتصال وأضف الأسماء والأرقام.');
  if (sheet['!merges']?.length) throw new Error('الورقة تحتوي على خلايا مدمجة. ألغِ الدمج أو استخدم قالب جهات الاتصال.');
  for (const ref of [sheet['!ref'], sheet['!fullref']].filter(Boolean) as string[]) {
    const endpoints = ref.split(':');
    if (endpoints.length > 2) throw new Error('نطاق خلايا الملف غير صالح.');
    endpoints.forEach(endpoint => assertDimensions(coordinates(endpoint)));
  }
  let lastRow = 0, lastColumn = 0;
  for (const [address, cell] of Object.entries(sheet)) {
    if (address.startsWith('!')) continue;
    const position = coordinates(address);
    assertDimensions(position);
    lastRow = Math.max(lastRow, position.row); lastColumn = Math.max(lastColumn, position.column);
    if (cell && (cell.f !== undefined || cell.F !== undefined)) throw new Error(`الخلية ${address} تحتوي على معادلة. استبدلها بنص صريح قبل الاستيراد؛ لا تُستخدم نتائج المعادلات المخزنة.`);
  }
  const mapped = new Map<ImportColumn, number>();
  const seenHeaders = new Set<string>();
  for (let column = 0; column <= lastColumn; column++) {
    const header = rawText(getCell(sheet, column, 0)).replace(/^\uFEFF/, '').trim();
    if (!header) continue;
    const key = headerKey(header), known = columnForHeader(header);
    if (seenHeaders.has(key) || known && mapped.has(known)) throw new Error(`عنوان العمود «${header}» مكرر أو يشير إلى الحقل نفسه. اجعل لكل حقل عمودًا واحدًا.`);
    seenHeaders.add(key);
    if (known) mapped.set(known, column);
  }
  if (!mapped.has('name') || !mapped.has('mobile')) throw new Error('يجب أن يحتوي الصف الأول على «الاسم» و«رقم الموبايل» (أو Name وMobile). استخدم القالب لتجهيز الملف.');
  const rows: ContactImportInput[] = [];
  for (let row = 1; row <= lastRow; row++) {
    const allCells = Array.from({ length: lastColumn + 1 }, (_, column) => getCell(sheet, column, row));
    if (allCells.every(cell => !cell || cell.v === null || cell.v === undefined || String(cell.v).trim() === '')) continue;
    const phoneCell = getCell(sheet, mapped.get('mobile')!, row);
    let mobile = rawText(phoneCell);
    if (phoneCell?.t === 'n' || phoneCell?.v !== undefined && typeof phoneCell.v === 'number') {
      throw new Error(`رقم الموبايل في الصف ${row + 1} محفوظ كرقم وقد يكون فقد الصفر الأول. حوّل عمود الهاتف إلى «نص / Text» ثم أعد كتابة الرقم كاملًا قبل الاستيراد؛ لن يتم تخمينه.`);
    }
    let name = rawText(getCell(sheet, mapped.get('name')!, row));
    let notes = mapped.has('notes') ? rawText(getCell(sheet, mapped.get('notes')!, row)) : '';
    if (options.csv) { name = csvLiteral(name); mobile = csvLiteral(mobile, true); notes = csvLiteral(notes); }
    rows.push({ rowNumber: row + 1, name, mobile, notes });
  }
  return rows;
}

/** Count CSV records without treating quoted line breaks or commas as new records/cells. */
function checkCsvDimensions(text: string): string {
  let quoted = false;
  const separators = { ',': 0, ';': 0, '\t': 0 };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') { if (quoted && text[i + 1] === '"') i++; else quoted = !quoted; }
    else if (!quoted && (char === '\r' || char === '\n')) break;
    else if (!quoted && char in separators) separators[char]++;
  }
  const delimiter = Object.keys(separators).sort((a, b) => separators[b] - separators[a])[0];
  quoted = false;
  let rows = 0, columns = 1, hasData = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') { hasData = true; if (quoted && text[i + 1] === '"') i++; else quoted = !quoted; }
    else if (!quoted && char === delimiter) { columns++; hasData = true; }
    else if (!quoted && (char === '\r' || char === '\n')) {
      if (char === '\r' && text[i + 1] === '\n') i++;
      assertDimensions({ row: rows, column: columns - 1 }); rows++; columns = 1; hasData = false;
    } else hasData = true;
  }
  if (quoted) throw new Error('ملف CSV يحتوي على علامات اقتباس غير مكتملة. احفظه مرة أخرى أو استخدم Excel.');
  if (hasData) assertDimensions({ row: rows, column: columns - 1 });
  return delimiter;
}

/** Reject excessive declared ZIP expansion before asking SheetJS to parse an XLSX. */
function checkZipSize(bytes: Uint8Array): void {
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (view.getUint32(offset, true) === 0x06054b50 && offset + 22 + view.getUint16(offset + 20, true) === bytes.length) { end = offset; break; }
  }
  if (end < 0) throw new Error('بنية ملف Excel المضغوط غير صالحة. احفظ نسخة جديدة منه.');
  const entries = view.getUint16(end + 10, true), directorySize = view.getUint32(end + 12, true);
  let position = view.getUint32(end + 16, true), expanded = 0;
  if (entries > 512 || position + directorySize > end || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) throw new Error('ملف Excel معقد أو كبير جدًا. انسخ البيانات المطلوبة فقط إلى ملف جديد.');
  for (let index = 0; index < entries; index++) {
    if (position + 46 > end || view.getUint32(position, true) !== 0x02014b50) throw new Error('بنية ملف Excel المضغوط غير صالحة.');
    const size = view.getUint32(position + 24, true);
    expanded += size;
    if (size > 15 * 1024 * 1024 || expanded > 25 * 1024 * 1024 || view.getUint16(position + 8, true) & 1) throw new Error('ملف Excel كبير جدًا بعد فك الضغط أو مشفّر. استخدم ملفًا أصغر وغير مشفّر.');
    position += 46 + view.getUint16(position + 28, true) + view.getUint16(position + 30, true) + view.getUint16(position + 32, true);
  }
  if (position > end) throw new Error('بنية ملف Excel المضغوط غير صالحة.');
}

/** Shared bounded workbook reader; callers still validate their own allowed columns and cells. */
export async function readBoundedSpreadsheet(file: File): Promise<{ workbook: WorkBook; csv: boolean }> {
  if (!/\.(xlsx|xls|csv)$/i.test(file.name)) throw new Error('اختر ملف Excel بصيغة XLSX أو XLS أو ملف CSV.');
  if (!file.size || file.size > MAX_CONTACT_SPREADSHEET_BYTES) throw new Error('اختر ملفًا غير فارغ بحجم لا يتجاوز ٥ ميجابايت.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_CONTACT_SPREADSHEET_BYTES) throw new Error('حجم الملف غير صالح أو يتجاوز ٥ ميجابايت.');
  const csv = /\.csv$/i.test(file.name);
  let csvText = '', delimiter: string | undefined;
  if (csv) {
    try { csvText = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, ''); }
    catch { throw new Error('احفظ ملف CSV بترميز UTF-8 حتى تظهر الأسماء العربية بصورة صحيحة.'); }
    delimiter = checkCsvDimensions(csvText);
  } else checkZipSize(bytes);
  const XLSX = await import('xlsx');
  let workbook: WorkBook;
  try {
    workbook = XLSX.read(csv ? csvText : bytes, { type: csv ? 'string' : 'array', raw: true, cellFormula: true,
      cellDates: true, cellHTML: false, cellText: false, bookVBA: false, sheets: 0, sheetRows: MAX_CONTACT_IMPORT_ROWS + 2, ...(csv ? { FS: delimiter } : {}) });
  } catch { throw new Error('تعذّرت قراءة الملف. تأكد أنه ملف Excel أو CSV صالح وغير مشفّر، ثم احفظ نسخة جديدة.'); }
  return { workbook, csv };
}
export async function readContactSpreadsheet(file: File): Promise<ContactImportInput[]> {
  const { workbook, csv } = await readBoundedSpreadsheet(file);
  return parseContactWorkbook(workbook, { csv });
}

function exportValues(rows: readonly ContactExportRow[]): string[][] {
  return rows.map(row => [row.name, row.mobile, row.notes, row.patientIds.join('، ')]);
}
export function serializeContactCsv(rows: readonly ContactExportRow[]): string {
  // CSV cannot encode cell types. The explicit marker preserves 0/+ in Excel;
  // the import reader removes it only for a valid, complete phone number.
  const protectExistingMarker = (value: string) => value.startsWith("'") ? `'${value}` : value;
  return serializeClinicCsv(CONTACT_SPREADSHEET_HEADERS, exportValues(rows).map(row => [protectExistingMarker(row[0]), row[1] ? `'${row[1]}` : '', protectExistingMarker(row[2]), row[3] ? `'${row[3]}` : '']));
}
export async function createContactWorkbook(rows: readonly ContactExportRow[]): Promise<WorkBook> {
  const XLSX = await import('xlsx');
  const worksheet: WorkSheet = {};
  const values = [Array.from(CONTACT_SPREADSHEET_HEADERS), ...exportValues(rows)];
  values.forEach((row, rowIndex) => row.forEach((value, column) => { worksheet[cellAddress(column, rowIndex)] = { t: 's', v: value, z: '@' }; }));
  worksheet['!ref'] = `A1:D${values.length}`;
  worksheet['!cols'] = [{ wch: 28 }, { wch: 22 }, { wch: 42 }, { wch: 27 }];
  worksheet['!autofilter'] = { ref: worksheet['!ref'] };
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'جهات الاتصال');
  workbook.Workbook = { Views: [{ RTL: true }] };
  return workbook;
}
function triggerDownload(blob: Blob, filename: string, authorize: () => void): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename;
  try { authorize(); anchor.click(); }
  finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
export async function downloadContactSpreadsheet(rows: readonly ContactExportRow[], format: 'xlsx' | 'csv', authorize: () => void): Promise<void> {
  authorize();
  if (format !== 'xlsx' && format !== 'csv') throw new Error('صيغة التصدير غير مدعومة.');
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  if (format === 'csv') { triggerDownload(new Blob([serializeContactCsv(rows)], { type: 'text/csv;charset=utf-8' }), `جهات_الاتصال_${date}.csv`, authorize); return; }
  const workbook = await createContactWorkbook(rows);
  const XLSX = await import('xlsx');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx', compression: true });
  triggerDownload(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `جهات_الاتصال_${date}.xlsx`, authorize);
}
export async function downloadContactTemplate(authorize: () => void = () => {}): Promise<void> {
  authorize();
  const workbook = await createContactWorkbook([]);
  const XLSX = await import('xlsx');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx', compression: true });
  triggerDownload(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'قالب_جهات_الاتصال.xlsx', authorize);
}
