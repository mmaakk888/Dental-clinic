import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import type { WorkBook } from 'xlsx';
import type { Patient } from '../types';
import { importPatientRecords } from './clinicMutations';
import { createPatientWorkbook, downloadPatientSpreadsheet, parsePatientVisitDate, parsePatientWorkbook, previewPatientImport, readPatientSpreadsheet, serializePatientCsv, type PatientExportColumns } from './patientSpreadsheets';

const columns: PatientExportColumns = { id: true, name: true, mobile: true, age: true, firstVisit: true, allergy: true, notes: true, gender: true, totalRequired: true, totalPaid: true, totalRemain: true };
const patient = (overrides: Partial<Patient> = {}): Patient => ({ id: '00401', name: 'مريض وهمي', mobile: '01012345678', age: 35, firstVisit: '2026-02-01', notes: 'ملاحظة، تجريبية\nسطر جديد', allergy: '', gender: 'male', sessions: [], payments: [], ...overrides });
function workbook(rows: unknown[][]): WorkBook { const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'مرضى'); return book; }
const excelFile = (book: WorkBook) => new File([XLSX.write(book, { type: 'array', bookType: 'xlsx', compression: true })], 'مرضى_وهميون.xlsx');
const csvFile = (text: string) => new File([text], 'مرضى_وهميون.csv');

test('patient XLSX export uses literal text IDs/phones, numeric age and totals, and no formulas', async () => {
  const book = await createPatientWorkbook([patient({ name: '=TEST()', id: '00401' })], columns, true), sheet = book.Sheets[book.SheetNames[0]];
  assert.equal(sheet.A2.t, 's'); assert.equal(sheet.A2.v, '00401'); assert.equal(sheet.C2.t, 's'); assert.equal(sheet.C2.v, '01012345678');
  assert.equal(sheet.D2.t, 'n'); assert.equal(sheet.I2.t, 'n'); assert.equal(sheet.B2.f, undefined); assert.equal(sheet.B2.v, '=TEST()');
  assert.equal(book.Workbook?.Views?.[0]?.RTL, true);
});
test('basic patient XLSX round trip preserves leading zeros, text, date and gender without inventing clinical data', async () => {
  const p = patient(), rows = await readPatientSpreadsheet(excelFile(await createPatientWorkbook([p], columns, false)));
  assert.equal(rows[0].error, undefined); assert.deepEqual(rows[0].patient, p);
  assert.deepEqual(rows[0].patient?.sessions, []); assert.deepEqual(rows[0].patient?.payments, []);
});

test('spreadsheet round trips retain Arabic/Persian file IDs and formatted phones while duplicate checks normalize only for comparison', async () => {
  for (const id of ['٠٠٤٠١', '۰۰۴۰۱', 'ملف-٤٠١']) {
    const p = patient({ id, mobile: '٠١٠ ١٢٣٤ ٥٦٧٨' });
    const excel = await readPatientSpreadsheet(excelFile(await createPatientWorkbook([p], columns, false)));
    const csv = await readPatientSpreadsheet(csvFile(serializePatientCsv([p], columns, false)));
    assert.deepEqual(excel[0].patient, p);
    assert.deepEqual(csv[0].patient, p);
    assert.equal(previewPatientImport(excel, [patient({ id: id === 'ملف-٤٠١' ? 'ملف-401' : '00401' })]).duplicateCount, 1);
  }
});

test('patient spreadsheet preview, committed import and subsequent export preserve original file identity end to end', async () => {
  const p = patient({ id: '٠٠٤٠١', mobile: '٠١٠ ١٢٣٤ ٥٦٧٨' });
  const parsed = await readPatientSpreadsheet(excelFile(await createPatientWorkbook([p], columns, false)));
  const preview = previewPatientImport(parsed, []);
  assert.equal(preview.newCount, 1);
  const saved = importPatientRecords([], preview.newPatients);
  assert.deepEqual(saved, [p]);
  const exported = await readPatientSpreadsheet(csvFile(serializePatientCsv(saved, columns, false)));
  assert.deepEqual(exported[0].patient, p);
  assert.equal(previewPatientImport(parsed, [patient({ id: '00401' })]).duplicateCount, 1);
  assert.throws(() => importPatientRecords(saved, [patient({ id: '۰۰۴۰۱' })]), /موجود|مكرر/);
});
test('CSV patient round trip protects formulas and phone/file zero prefixes', async () => {
  const p = patient({ name: '=TEST("literal")', notes: '@not-a-formula', allergy: "'+literal" });
  const text = serializePatientCsv([p], columns, false); assert.ok(text.includes("'00401")); assert.ok(text.includes("'01012345678"));
  assert.deepEqual((await readPatientSpreadsheet(csvFile(text)))[0].patient, p);
});
test('patient CSV apostrophe markers are reversible in file IDs as well as notes', async () => {
  for (const id of ['FILE-401', "'A01", "''A01", '+A01', '=literal-ID', '@literal-ID', '-12', '0001']) {
    const p = patient({ id, notes: "''literal" }); assert.deepEqual((await readPatientSpreadsheet(csvFile(serializePatientCsv([p], columns, false))))[0].patient, p);
  }
});
test('patient export excludes every financial column without finance permission', async () => {
  const book = await createPatientWorkbook([patient()], columns, false), sheet = book.Sheets[book.SheetNames[0]];
  const headers = XLSX.utils.sheet_to_json(sheet, { header: 1 })[0] as string[];
  assert.ok(!headers.includes('المدفوع')); assert.ok(!headers.includes('المتبقي')); assert.equal(headers.length, 8);
  const text = serializePatientCsv([patient()], columns, false); assert.ok(!text.includes('المتبقي'));
});
test('patient export rejects financial-only selection when finance is unavailable', async () => {
  const selection = Object.fromEntries(Object.keys(columns).map(key => [key, key === 'totalPaid'])) as PatientExportColumns;
  await assert.rejects(createPatientWorkbook([patient()], selection, false), /اختر عمودًا/);
});
test('numeric phone and formatted numeric file ID are invalid rows instead of guessed values', () => {
  const book = workbook([['رقم الملف', 'اسم المريض', 'الموبايل'], [401, 'وهمي', 1012345678], [402, 'وهمي آخر', '01012345678']]);
  book.Sheets[book.SheetNames[0]].A3.z = '00000';
  const rows = parsePatientWorkbook(book); assert.match(rows[0].error!, /الصفر/); assert.match(rows[1].error!, /رقم الملف/);
  assert.equal(previewPatientImport(rows, []).newCount, 0);
});
test('unsafe numeric IDs and invalid ages cannot enter an import', () => {
  const book = workbook([['ID', 'Name', 'Age'], [Number.MAX_SAFE_INTEGER + 1, 'وهمي', 30], ['402', 'وهمي', 121], ['403', 'وهمي', -1], ['404', 'وهمي', 4.5]]);
  assert.equal(previewPatientImport(parsePatientWorkbook(book), []).invalidCount, 4);
});
test('optional phone/date/age can be blank without inventing a visit date', () => {
  const row = parsePatientWorkbook(workbook([['ID', 'Name'], ['401', 'وهمي']]))[0];
  assert.equal(row.error, undefined); assert.equal(row.patient?.firstVisit, ''); assert.equal(row.patient?.mobile, ''); assert.equal(row.patient?.age, 0);
});
test('calendar parsing is exact, supports Arabic dates and leap days, rejects invalid dates', () => {
  assert.equal(parsePatientVisitDate('٢٩/٢/٢٠٢٤'), '2024-02-29'); assert.equal(parsePatientVisitDate('2026-10-07'), '2026-10-07');
  assert.equal(parsePatientVisitDate(new Date('2026-10-07T00:00:00.000Z')), '2026-10-07');
  for (const value of ['2026-02-30', '29/2/2025', '10/31/2026', 'not a date', 123]) assert.throws(() => parsePatientVisitDate(value), /تاريخ/);
});
test('typed Excel dates parse as calendar dates while an invalid nonblank date is shown in preview', async () => {
  const book = workbook([['ID', 'Name', 'FirstVisit'], ['401', 'وهمي', new Date('2026-10-07T00:00:00Z')], ['402', 'وهمي', '2026-02-30']]);
  const rows = await readPatientSpreadsheet(excelFile(book)); assert.equal(rows[0].patient?.firstVisit, '2026-10-07'); assert.match(rows[1].error!, /تاريخ/);
});
test('formulas are rejected across the first sheet including ignored financial columns', () => {
  const book = workbook([['ID', 'Name', 'Total'], ['401', 'وهمي', 1]]); book.Sheets[book.SheetNames[0]].C2.f = '1+1';
  assert.throws(() => parsePatientWorkbook(book), /معادلة/);
});
test('unprotected CSV formulas in patient name/notes/ID are not silently trusted', async () => {
  for (const text of ['ID,Name\r\n=401,وهمي', 'ID,Name\r\n401,=TEST()', 'ID,Name,Notes\r\n401,وهمي,@TEST()']) {
    assert.equal(previewPatientImport(await readPatientSpreadsheet(csvFile(text)), []).invalidCount, 1);
  }
});
test('header aliases are supported but missing/duplicate columns and merges are rejected', () => {
  assert.equal(parsePatientWorkbook(workbook([['File No', 'Patient Name'], ['401', 'وهمي']]))[0].error, undefined);
  assert.throws(() => parsePatientWorkbook(workbook([['ID', 'رقم الملف', 'Name'], ['401', '402', 'وهمي']])), /مكرر/);
  assert.throws(() => parsePatientWorkbook(workbook([['Name'], ['وهمي']])), /رقم الملف/);
  const book = workbook([['ID', 'Name'], ['401', 'وهمي']]); book.Sheets[book.SheetNames[0]]['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }]; assert.throws(() => parsePatientWorkbook(book), /دمج/);
});
test('patient import preserves full canonical file IDs and never merges matching phones or repeated IDs', () => {
  const rows = parsePatientWorkbook(workbook([['ID', 'Name', 'Mobile'], ['٤٠١', 'مكرر', '01012345678'], ['402', 'جديد', '01012345678'], ['۴۰۲', 'مكرر داخلي', '01012345678'], ['00401', 'صفر مميز', '01012345678']]));
  const preview = previewPatientImport(rows, [patient({ id: '401' })]); assert.equal(preview.newCount, 2); assert.equal(preview.duplicateCount, 2);
  assert.deepEqual(preview.newPatients.map(p => p.id), ['402', '00401']);
});
test('financial summary columns do not fabricate imported sessions/payments', () => {
  const row = parsePatientWorkbook(workbook([['ID', 'Name', 'المدفوع', 'المتبقي'], ['401', 'وهمي', 900, 100]]))[0];
  assert.deepEqual(row.patient?.sessions, []); assert.deepEqual(row.patient?.payments, []); assert.ok(!('totalPaid' in row.patient!));
});
test('row/column limits are strict and no late patient rows are silently discarded', () => {
  const book = workbook([['ID', 'Name'], ['401', 'وهمي']]); const sheet = book.Sheets[book.SheetNames[0]];
  sheet['!fullref'] = 'A1:B5002'; assert.throws(() => parsePatientWorkbook(book), /٥٠٠٠/); delete sheet['!fullref'];
  sheet.AG2 = { t: 's', v: 'late' }; assert.throws(() => parsePatientWorkbook(book), /٣٢/);
});
test('only first worksheet is parsed and blank rows are skipped', () => {
  const book = workbook([['ID', 'Name'], [], ['401', 'وهمي']]); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['ID', 'Name'], ['402', 'آخر']]), 'آخر');
  assert.deepEqual(parsePatientWorkbook(book).map(row => row.id), ['401']); assert.equal(parsePatientWorkbook(book)[0].rowNumber, 3);
});
test('invalid UTF-8, empty/oversized and wrong-type files are rejected before parsing', async () => {
  await assert.rejects(readPatientSpreadsheet(new File([new Uint8Array([0xff])], 'test.csv')), /UTF-8/);
  await assert.rejects(readPatientSpreadsheet(new File([], 'test.xlsx')), /غير فارغ/);
  await assert.rejects(readPatientSpreadsheet(new File(['{}'], 'test.json')), /CSV/);
  await assert.rejects(readPatientSpreadsheet(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'test.xlsx')), /٥ ميجابايت/);
});

test('oversized cell text is rejected before preview state can retain it', () => {
  assert.throws(() => parsePatientWorkbook(workbook([['ID', 'Name'], ['401', 'x'.repeat(10_001)]])), /النصوص/);
});

test('patient download authorizes before work and again before the click, including revocation during XLSX loading', async () => {
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document'), originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  let clicks = 0, authorizations = 0;
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({ click: () => { clicks++; }, remove: () => {} }) } });
  URL.createObjectURL = () => 'blob:synthetic-patient'; URL.revokeObjectURL = () => {};
  try {
    await assert.rejects(downloadPatientSpreadsheet([patient()], columns, false, 'xlsx', () => { authorizations++; if (authorizations === 2) throw new Error('revoked'); }), /revoked/);
    assert.equal(clicks, 0); assert.equal(authorizations, 2); authorizations = 0;
    await downloadPatientSpreadsheet([patient()], columns, false, 'csv', () => { authorizations++; });
    assert.equal(clicks, 1); assert.equal(authorizations, 2);
    await assert.rejects(downloadPatientSpreadsheet([patient()], columns, true, 'xlsx', () => { throw new Error('not allowed'); }), /not allowed/);
    assert.equal(clicks, 1);
  } finally {
    if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor); else delete (globalThis as any).document;
    URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke;
  }
});
