import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import type { WorkBook } from 'xlsx';
import { CONTACT_SPREADSHEET_HEADERS, MAX_CONTACT_SPREADSHEET_BYTES, createContactWorkbook, downloadContactSpreadsheet, downloadContactTemplate, parseContactWorkbook, readContactSpreadsheet, serializeContactCsv, type ContactExportRow } from './contactSpreadsheets';

const fixtureRows: ContactExportRow[] = [
  { name: 'اسم تجريبي أول', mobile: '01012345678', notes: 'ملاحظة، خاصة\nبسطر آخر', patientIds: ['001', '+٤٠٢'] },
  { name: 'اسم تجريبي ثانٍ', mobile: '+201123456789', notes: '', patientIds: ['0007'] },
  { name: 'اسم عربي تجريبي', mobile: '٠١٢١٢٣٤٥٦٧٨', notes: 'بدون بيانات طبية', patientIds: [] },
];
const workbook = (rows: unknown[][]): WorkBook => {
  const result = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(result, XLSX.utils.aoa_to_sheet(rows), 'أول ورقة');
  return result;
};
const excelFile = (data: WorkBook, name = 'تجريبي.xlsx', bookType: XLSX.BookType = 'xlsx') => new File([XLSX.write(data, { type: 'array', bookType, compression: true })], name);
const csvFile = (text: string, name = 'تجريبي.csv') => new File([text], name, { type: 'text/csv' });

test('XLSX export preserves text phone/file IDs and contains only the allowed contact columns', async () => {
  const result = await createContactWorkbook(fixtureRows);
  const sheet = result.Sheets[result.SheetNames[0]];
  assert.deepEqual(XLSX.utils.sheet_to_json(sheet, { header: 1 })[0], Array.from(CONTACT_SPREADSHEET_HEADERS));
  assert.equal(sheet.B2.t, 's'); assert.equal(sheet.B2.z, '@'); assert.equal(sheet.B2.v, '01012345678');
  assert.equal(sheet.D2.t, 's'); assert.equal(sheet.D2.v, '001، +٤٠٢');
  assert.equal(sheet.B3.v, '+201123456789'); assert.equal(sheet.B4.v, '٠١٢١٢٣٤٥٦٧٨');
  assert.equal(result.Workbook?.Views?.[0]?.RTL, true);
  assert.equal(sheet['!cols']?.length, 4);
  assert.ok(!JSON.stringify(result).includes('campaignConsent'));
  assert.ok(!JSON.stringify(result).includes('payments'));
});

test('XLSX export/read round trip keeps local/international/Arabic phones without generating patient files', async () => {
  const result = await readContactSpreadsheet(excelFile(await createContactWorkbook(fixtureRows)));
  assert.deepEqual(result, fixtureRows.map((row, index) => ({ rowNumber: index + 2, name: row.name, mobile: row.mobile, notes: row.notes })));
  assert.ok(result.every(row => !('patientIds' in row) && !('consent' in row)));
});

test('CSV export/read round trip preserves literal phones and protects single leading-zero file IDs', async () => {
  const text = serializeContactCsv(fixtureRows);
  assert.ok(text.startsWith('\uFEFF'));
  assert.ok(text.includes("'01012345678")); assert.ok(text.includes("'+201123456789"));
  assert.ok(text.includes("'٠١٢١٢٣٤٥٦٧٨")); assert.ok(text.includes("'0007"));
  assert.deepEqual(await readContactSpreadsheet(csvFile(text)), fixtureRows.map((row, index) => ({ rowNumber: index + 2, name: row.name, mobile: row.mobile, notes: row.notes })));
});

test('CSV uses formula-safe escaping while its own protected literal name/notes round trip', async () => {
  const rows = [{ name: '=HYPERLINK("https://example.invalid")', mobile: '+201012345678', notes: '@SUM(A1:A2)', patientIds: ['=not-a-formula'] }];
  const text = serializeContactCsv(rows);
  assert.ok(text.includes("'=HYPERLINK")); assert.ok(text.includes("'@SUM"));
  const result = await readContactSpreadsheet(csvFile(text));
  assert.equal(result[0].name, rows[0].name); assert.equal(result[0].notes, rows[0].notes);
  assert.equal(result[0].mobile, rows[0].mobile);
});

test('existing leading apostrophes in names/notes survive our CSV protection round trip', async () => {
  const rows = [{ name: "'+Synthetic", mobile: '01012345678', notes: "''literal note", patientIds: [] }];
  const result = await readContactSpreadsheet(csvFile(serializeContactCsv(rows)));
  assert.equal(result[0].name, rows[0].name); assert.equal(result[0].notes, rows[0].notes);
});

test('blank template has headers only, no fake contact or phone', async () => {
  const result = await createContactWorkbook([]);
  assert.equal(result.Sheets[result.SheetNames[0]]['!ref'], 'A1:D1');
  assert.deepEqual(parseContactWorkbook(result), []);
  assert.equal(serializeContactCsv([]), '\uFEFF' + CONTACT_SPREADSHEET_HEADERS.join(','));
});

test('English/Arabic header aliases, BOM and semicolon delimiters are accepted', async () => {
  const csv = '\uFEFFFull Name;Phone Number;Notes\r\nاسم تجريبي;01012345678;ملاحظة';
  assert.deepEqual(await readContactSpreadsheet(csvFile(csv)), [{ rowNumber: 2, name: 'اسم تجريبي', mobile: '01012345678', notes: 'ملاحظة' }]);
  const arabic = workbook([['اسم جهة الاتصال', 'رقم الهاتف'], ['تجريبي', '01012345678']]);
  assert.deepEqual(parseContactWorkbook(arabic), [{ rowNumber: 2, name: 'تجريبي', mobile: '01012345678', notes: '' }]);
});

test('legacy XLS files are supported while preserving text phones', async () => {
  assert.deepEqual(await readContactSpreadsheet(excelFile(workbook([['Name', 'Mobile'], ['Synthetic only', '01012345678']]), 'synthetic.xls', 'biff8')),
    [{ rowNumber: 2, name: 'Synthetic only', mobile: '01012345678', notes: '' }]);
});

test('only the explicitly documented first sheet is imported', async () => {
  const result = workbook([['الاسم', 'رقم الموبايل'], ['تجريبي أول', '01012345678']]);
  XLSX.utils.book_append_sheet(result, XLSX.utils.aoa_to_sheet([['الاسم', 'رقم الموبايل'], ['لن يستورد', '01123456789']]), 'ثاني ورقة');
  const rows = await readContactSpreadsheet(excelFile(result));
  assert.equal(rows.length, 1); assert.equal(rows[0].name, 'تجريبي أول');
});

test('numeric Excel phone cells are rejected instead of guessing a missing leading zero', async () => {
  for (const value of [1012345678, 201012345678, 1.012e9]) {
    await assert.rejects(readContactSpreadsheet(excelFile(workbook([['الاسم', 'رقم الموبايل'], ['تجريبي', value]]))), /الصف 2.*نص.*لن يتم تخمينه/);
  }
});

test('formula cells are rejected even with a cached result and in unused columns', async () => {
  for (const formula of [{ t: 's', f: '"01012345678"', v: '01012345678' }, { t: 'n', f: '1+1', v: 2 }, { t: 's', F: 'C2:C3', v: 'cached' }]) {
    const result = workbook([['Name', 'Mobile', 'Other'], ['Synthetic only', '01012345678', '']]);
    result.Sheets[result.SheetNames[0]].C2 = formula as XLSX.CellObject;
    assert.throws(() => parseContactWorkbook(result), /معادلة/);
  }
  const result = workbook([['Name', 'Mobile'], ['Synthetic only', '01012345678']]);
  result.Sheets[result.SheetNames[0]].B2 = { t: 's', f: '"01012345678"', v: '01012345678' };
  await assert.rejects(readContactSpreadsheet(excelFile(result)), /معادلة/);
});

test('unprotected CSV formula-like name/notes are rejected but + phone numbers remain valid text', async () => {
  for (const value of ['=SUM(A1:A2)', '@SUM(A1:A2)', '-1+2']) {
    await assert.rejects(readContactSpreadsheet(csvFile(`Name,Mobile,Notes\nSynthetic only,+201012345678,${value}`)), /تشبه معادلة/);
  }
  assert.equal((await readContactSpreadsheet(csvFile('Name,Mobile\nSynthetic only,+201012345678')))[0].mobile, '+201012345678');
});

test('missing or duplicate ambiguous headers are rejected before any records are returned', () => {
  for (const headers of [['Name', 'Notes'], ['الاسم', 'Mobile', 'Phone'], ['Name', 'الاسم', 'Mobile'], ['Name', 'Mobile', 'Extra', 'Extra']]) {
    assert.throws(() => parseContactWorkbook(workbook([headers, ['Synthetic only', '01012345678']])));
  }
});

test('empty rows are skipped while source row numbers and invalid incomplete rows are preserved', () => {
  const result = workbook([['Name', 'Mobile', 'Notes'], ['Synthetic only', '01012345678', ''], [], ['', '', 'ملاحظة بلا اسم أو رقم']]);
  assert.deepEqual(parseContactWorkbook(result).map(row => [row.rowNumber, row.name, row.mobile]), [[2, 'Synthetic only', '01012345678'], [4, '', '']]);
});

test('row and column caps reject oversized dimensions without silently truncating', async () => {
  const result = workbook([['Name', 'Mobile'], ['Synthetic only', '01012345678']]);
  const sheet = result.Sheets[result.SheetNames[0]];
  sheet['!fullref'] = 'A1:B5002'; assert.throws(() => parseContactWorkbook(result), /٥٠٠٠/);
  delete sheet['!fullref']; sheet['!ref'] = 'A1:AG2'; assert.throws(() => parseContactWorkbook(result), /٣٢/);
  sheet['!ref'] = 'A1:B2'; sheet.AG2 = { t: 's', v: 'outside declared range' }; assert.throws(() => parseContactWorkbook(result), /٣٢/);
  const csv = 'Name,Mobile\n' + Array.from({ length: 5001 }, () => 'Synthetic only,01012345678').join('\n');
  await assert.rejects(readContactSpreadsheet(csvFile(csv)), /٥٠٠٠/);
  await assert.rejects(readContactSpreadsheet(csvFile('Name,Mobile,' + Array.from({ length: 31 }, (_, index) => `Other${index}`).join(','))), /٣٢/);
  const tooManyExcelRows = workbook([['Name', 'Mobile'], ['Synthetic only', '01012345678']]);
  tooManyExcelRows.Sheets[tooManyExcelRows.SheetNames[0]].A5002 = { t: 's', v: 'Beyond limit' };
  tooManyExcelRows.Sheets[tooManyExcelRows.SheetNames[0]]['!ref'] = 'A1:B5002';
  await assert.rejects(readContactSpreadsheet(excelFile(tooManyExcelRows)), /٥٠٠٠/);
});

test('exactly 5000 records are accepted and CSV quoted multiline values do not consume extra records', async () => {
  const csv = 'Name,Mobile,Notes\n' + Array.from({ length: 5000 }, (_, index) => `Synthetic ${index},01012345678,"line one\nline two"`).join('\n');
  const rows = await readContactSpreadsheet(csvFile(csv));
  assert.equal(rows.length, 5000); assert.equal(rows[4999].rowNumber, 5001); assert.equal(rows[0].notes, 'line one\nline two');
});

test('unsupported, empty, oversized, invalid UTF8 and malformed quote files fail clearly', async () => {
  await assert.rejects(readContactSpreadsheet(csvFile('Name,Mobile', 'file.txt')), /XLSX/);
  await assert.rejects(readContactSpreadsheet(csvFile('')), /غير فارغ/);
  await assert.rejects(readContactSpreadsheet(new File([new Uint8Array(MAX_CONTACT_SPREADSHEET_BYTES + 1)], 'large.xlsx')), /٥ ميجابايت/);
  await assert.rejects(readContactSpreadsheet(new File([new Uint8Array([0xff, 0xfe, 0x61])], 'invalid.csv')), /UTF-8/);
  await assert.rejects(readContactSpreadsheet(csvFile('Name,Mobile\n"Unclosed,01012345678')), /اقتباس/);
});

test('merged cells, error cells, invalid ranges and ZIP expansion limits fail closed', async () => {
  const merged = workbook([['Name', 'Mobile'], ['Synthetic only', '01012345678']]);
  merged.Sheets[merged.SheetNames[0]]['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }];
  assert.throws(() => parseContactWorkbook(merged), /مدمجة/);
  const invalid = workbook([['Name', 'Mobile'], ['Synthetic only', '01012345678']]);
  invalid.Sheets[invalid.SheetNames[0]].B2 = { t: 'e', v: 0 }; assert.throws(() => parseContactWorkbook(invalid), /غير نصية/);
  invalid.Sheets[invalid.SheetNames[0]]['!ref'] = 'NotACell'; assert.throws(() => parseContactWorkbook(invalid), /نطاق/);
  const bytes = new Uint8Array(await excelFile(await createContactWorkbook([])).arrayBuffer());
  const view = new DataView(bytes.buffer);
  for (let position = 0; position <= bytes.length - 46; position++) {
    if (view.getUint32(position, true) === 0x02014b50) { view.setUint32(position + 24, 30 * 1024 * 1024, true); break; }
  }
  await assert.rejects(readContactSpreadsheet(new File([bytes], 'oversized.xlsx')), /فك الضغط/);
});

test('export authorization is checked before processing and again before the download with no real downloads', async () => {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  let clicks = 0, authorizations = 0;
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({ click: () => { clicks++; }, remove: () => {} }) } });
  URL.createObjectURL = () => 'blob:synthetic-test'; URL.revokeObjectURL = () => {};
  try {
    await assert.rejects(downloadContactSpreadsheet(fixtureRows, 'xlsx', () => { authorizations++; if (authorizations === 2) throw new Error('permission revoked'); }), /permission revoked/);
    assert.equal(authorizations, 2); assert.equal(clicks, 0);
    authorizations = 0;
    await downloadContactSpreadsheet(fixtureRows, 'csv', () => { authorizations++; });
    assert.equal(authorizations, 2); assert.equal(clicks, 1);
    authorizations = 0;
    await downloadContactTemplate(() => { authorizations++; });
    assert.equal(authorizations, 2); assert.equal(clicks, 2);
    await assert.rejects(downloadContactSpreadsheet(fixtureRows, 'xlsx', () => { throw new Error('denied before export'); }), /denied before export/);
    assert.equal(clicks, 2);
  } finally {
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument); else delete (globalThis as any).document;
    URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke;
  }
});
