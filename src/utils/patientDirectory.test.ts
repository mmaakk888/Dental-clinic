import test from 'node:test';
import assert from 'node:assert/strict';
import { createPatientDirectoryIndex, getPatientMatchScore, normalizeDirectoryDigits, searchPatientDirectory, sortDirectoryPatients } from './patientDirectory';

const patient = (id: string, name = 'مريض تجريبي', mobile = '01012345678') => ({ id, name, mobile });

test('normalizes Arabic and Persian digits without changing other characters', () => {
  assert.equal(normalizeDirectoryDigits('# ٤٠١ A۲۳'), '# 401 A23');
  assert.equal(normalizeDirectoryDigits('ABC-101'), 'ABC-101');
});

test('ranks exact file, file prefix and partial file matches', () => {
  assert.equal(getPatientMatchScore(patient('401'), '٤٠١'), 100);
  assert.equal(getPatientMatchScore(patient('4012'), '401'), 90);
  assert.equal(getPatientMatchScore(patient('1401'), '401'), 50);
});

test('# queries search only file numbers, including Arabic digits and surrounding space', () => {
  assert.equal(getPatientMatchScore(patient('٤٠١'), '  # ۴۰۱  '), 100);
  assert.equal(getPatientMatchScore(patient('1401'), '#401'), 50);
  assert.equal(getPatientMatchScore(patient('7', 'اسم 401', '01040123456'), '#401'), 0);
  assert.equal(getPatientMatchScore(patient('A12'), '#a12'), 100);
});

test('blank and standalone # queries show all files', () => {
  for (const query of ['', '   ', '#', ' #   ']) assert.equal(getPatientMatchScore(patient('401'), query), 1);
});

test('normalizes Arabic alef, ya, tatweel and diacritics for name search', () => {
  assert.equal(getPatientMatchScore(patient('7', 'أَحْمَـد عَلَى'), 'احمد علي'), 85);
  assert.equal(getPatientMatchScore(patient('7', 'إبراهيم يحيى'), 'ابراهيم يحيي'), 85);
  assert.equal(getPatientMatchScore(patient('7', 'آدم مصطفى'), 'ادم مصطفي'), 85);
  assert.equal(getPatientMatchScore(patient('7', 'أحمد   علي'), 'احمد علي'), 85);
  assert.equal(getPatientMatchScore(patient('7', 'محمد أحمد علي'), 'احمد علي'), 60);
  assert.equal(getPatientMatchScore(patient('7', 'أحمد علي'), 'احمد'), 80);
});

test('matches equivalent Egyptian local and international phone numbers', () => {
  for (const query of ['01012345678', '+20 101 234 5678', '00201012345678', '201012345678', '٠١٠١٢٣٤٥٦٧٨', '1012345678']) {
    assert.equal(getPatientMatchScore(patient('7'), query), 75, query);
  }
  assert.equal(getPatientMatchScore(patient('7', 'مريض تجريبي', '+20 101 234 5678'), '01012345678'), 75);
  assert.equal(getPatientMatchScore(patient('7', 'مريض تجريبي', '00201012345678'), '01012345678'), 75);
});

test('matches partial phone digits and common phone formatting', () => {
  assert.equal(getPatientMatchScore(patient('7'), '2345'), 70);
  assert.equal(getPatientMatchScore(patient('7'), '(010) 123-45678'), 75);
  assert.equal(getPatientMatchScore(patient('7'), '+20 10'), 70);
});

test('mixed letter-number query does not match unrelated phone digits', () => {
  assert.equal(getPatientMatchScore(patient('7'), 'abc12'), 0);
  assert.equal(getPatientMatchScore(patient('7'), 'مريض12'), 0);
  assert.equal(getPatientMatchScore(patient('abc12'), 'abc12'), 100);
  assert.equal(getPatientMatchScore(patient('7', 'ABC12 patient'), 'abc12'), 80);
});

test('supports legacy phone when mobile is missing', () => {
  assert.equal(getPatientMatchScore({ id: '7', name: 'مريض تجريبي', phone: '01012345678' }, '+201012345678'), 75);
  assert.equal(getPatientMatchScore({ id: '7', name: 'مريض تجريبي' }, '01012345678'), 0);
});

test('naturally sorts numeric file numbers ascending and descending', () => {
  const patients = [patient('10'), patient('2'), patient('٤٠١'), patient('101')];
  assert.deepEqual(sortDirectoryPatients(patients, '', 'fileAsc').map(p => p.id), ['2', '10', '101', '٤٠١']);
  assert.deepEqual(sortDirectoryPatients(patients, '', 'fileDesc').map(p => p.id), ['٤٠١', '101', '10', '2']);
});

test('naturally sorts alphanumeric IDs and handles leading zeros', () => {
  const patients = [patient('A10'), patient('A2'), patient('A1')];
  assert.deepEqual(sortDirectoryPatients(patients, '', 'fileAsc').map(p => p.id), ['A1', 'A2', 'A10']);
  assert.deepEqual(sortDirectoryPatients(patients, '', 'fileDesc').map(p => p.id), ['A10', 'A2', 'A1']);
  assert.deepEqual(sortDirectoryPatients([patient('002'), patient('10')], '', 'fileAsc').map(p => p.id), ['002', '10']);
});

test('sorts Arabic names and uses file order when normalized names tie', () => {
  const patients = [patient('20', 'محمد'), patient('10', 'أحمد'), patient('2', 'احمد')];
  assert.deepEqual(sortDirectoryPatients(patients, '', 'name').map(p => p.id), ['2', '10', '20']);
});

test('search relevance wins over selected file sort, then uses selected order for equal scores', () => {
  const patients = [patient('4019'), patient('9401'), patient('401'), patient('4012'), patient('8')];
  assert.deepEqual(sortDirectoryPatients(patients, '#401', 'fileAsc').map(p => p.id), ['401', '4012', '4019', '9401', '8']);
  assert.deepEqual(sortDirectoryPatients(patients, '#401', 'fileDesc').map(p => p.id), ['401', '4019', '4012', '9401', '8']);
});

test('search relevance also wins over alphabetical name sort', () => {
  const patients = [patient('3', 'محمد أحمد'), patient('2', 'أحمد يوسف'), patient('1', 'احمد')];
  assert.deepEqual(sortDirectoryPatients(patients, 'احمد', 'name').map(p => p.id), ['1', '2', '3']);
});

test('does not mutate input array or patient records and remains stable for equal records', () => {
  const first = Object.freeze(patient('2'));
  const second = Object.freeze(patient('2'));
  const last = Object.freeze(patient('10'));
  const patients = Object.freeze([last, first, second]);
  const sorted = sortDirectoryPatients(patients, '', 'fileAsc');
  assert.notEqual(sorted, patients);
  assert.deepEqual(patients, [last, first, second]);
  assert.equal(sorted[0], first);
  assert.equal(sorted[1], second);
  assert.equal(sorted[2], last);
});

test('indexed directory search preserves relevance, selected ordering and filter scope', () => {
  const records = [patient('4019'), patient('9401'), patient('401'), patient('4012'), patient('8')];
  const index = createPatientDirectoryIndex(records);
  assert.deepEqual(searchPatientDirectory(index, '#٤٠١', 'fileAsc').map(record => record.id), ['401', '4012', '4019', '9401']);
  assert.deepEqual(searchPatientDirectory(index, '#۴۰۱', 'fileDesc', record => record.id !== '4012').map(record => record.id), ['401', '4019', '9401']);
  assert.deepEqual(searchPatientDirectory(index, 'absent', 'name'), []);
  assert.deepEqual(searchPatientDirectory(index, '', 'fileAsc').map(record => record.id), ['8', '401', '4012', '4019', '9401']);
  assert.deepEqual(records.map(record => record.id), ['4019', '9401', '401', '4012', '8']);
});

test('indexed directory retains literal IDs and shared phones without normalizing source records', () => {
  const records = Object.freeze([Object.freeze(patient('002', 'أَحْمَـد عَلَى', '٠١٠١٢٣٤٥٦٧٨')),
    Object.freeze(patient('2', 'إبراهيم', '+201012345678')), Object.freeze(patient('A٢', 'شخص آخر', '01012345679'))]);
  const index = createPatientDirectoryIndex(records);
  assert.equal(searchPatientDirectory(index, '#۰۰۲', 'fileAsc')[0], records[0]);
  assert.deepEqual(searchPatientDirectory(index, 'احمد علي', 'name'), [records[0]]);
  assert.deepEqual(searchPatientDirectory(index, '+20 1012345678', 'fileAsc'), [records[1], records[0]]);
  assert.deepEqual(searchPatientDirectory(index, 'abc1234', 'fileAsc'), []);
  assert.equal(records[0].id, '002');
  assert.equal(records[0].mobile, '٠١٠١٢٣٤٥٦٧٨');
});

test('directory index reads record search fields once, never per keystroke or sort comparison', () => {
  let fieldReads = 0;
  const records = Array.from({ length: 1000 }, (_, index) => ({
    get id() { fieldReads++; return String(index); },
    get name() { fieldReads++; return `أحمد تجريبي ${index}`; },
    get mobile() { fieldReads++; return '01012345678'; },
  }));
  const index = createPatientDirectoryIndex(records);
  assert.equal(fieldReads, records.length * 3);
  for (const query of ['', 'احمد', '#١٢', '+201012345678', 'غير موجود']) {
    for (const sort of ['fileAsc', 'fileDesc', 'name'] as const) searchPatientDirectory(index, query, sort);
  }
  assert.equal(fieldReads, records.length * 3);
});
