import test from 'node:test';
import assert from 'node:assert/strict';
import type { ClinicContact, Patient } from '../types';
import { clinicContactValidationError, contactMatchesSearch, deleteClinicContact, findPatientsByPhone,
  normalizeContactPhone, saveClinicContact, createPhoneDirectoryIndex, findRecordsByPhone,
  createContactSearchEntry, indexedContactMatchesSearch, prepareContactSearchQuery } from './clinicContacts';

const contact = (changes: Partial<ClinicContact> = {}): ClinicContact => ({ id: 'contact-test', name: 'أَحمد علي',
  mobile: '01012345678', createdAt: '2026-10-07T09:00:00.000Z', notes: '', ...changes });
const patient = (id: string, mobile: string): Patient => ({ id, mobile, name: 'اسم تجريبي', age: 30,
  firstVisit: '', notes: '', allergy: '', sessions: [], payments: [] });

test('contact phone normalization equates local/international and Arabic/Persian mobile digits', () => {
  for (const phone of ['01012345678', '+20 101 234 5678', '00201012345678', '٠١٠١٢٣٤٥٦٧٨', '+۲۰۱۰۱۲۳۴۵۶۷۸', '(010) 1234-5678']) {
    assert.equal(normalizeContactPhone(phone), '201012345678');
  }
  assert.equal(normalizeContactPhone('+971501234567'), '971501234567');
});

test('contact normalization rejects letters, extensions, incomplete Egyptian mobiles and unsafe characters', () => {
  for (const phone of ['', '0101234567', '010123456789', '+20101234567', '2010123456789', '+20212345678',
    'abc01012345678', '01012345678 ext9', '01012345678/01087654321', '++201012345678', '01012345678\n', '00000000']) {
    assert.equal(normalizeContactPhone(phone), '', phone);
  }
  assert.equal(normalizeContactPhone('1'.repeat(61)), '');
});

test('file matching returns every shared family file and never infers nearby or partial numbers', () => {
  const patients = [patient('401', '01012345678'), patient('402', '+20 1012345678'), patient('403', '01012345679'), patient('404', 'wrong01012345678')];
  assert.deepEqual(findPatientsByPhone(patients, '٠٠٢٠١٠١٢٣٤٥٦٧٨').map(item => item.id), ['401', '402']);
  assert.deepEqual(findPatientsByPhone(patients, '010123'), []);
  assert.deepEqual(findPatientsByPhone(patients, '01012345677'), []);
  assert.deepEqual(findPatientsByPhone(patients, 'name01012345678'), []);
});

test('contact searching supports normalized Arabic names and phone fragments without treating letters as digits', () => {
  const record = contact();
  for (const query of ['', 'احمد', 'أحمد علي', '٠١٠١٢٣', '+201012345678', '٢٣٤٥٦٧٨']) assert.equal(contactMatchesSearch(record, query), true, query);
  for (const query of ['محمود', 'abc1234', '01012345679']) assert.equal(contactMatchesSearch(record, query), false, query);
});

test('contact creation validates fields, trims only contact details and never creates a clinical file', () => {
  const input = contact({ name: '  أحمد   علي  ', mobile: ' 01012345678 ', notes: '  تواصل  ' });
  const source: ClinicContact[] = [];
  const records = saveClinicContact(source, input);
  assert.equal(source.length, 0);
  assert.deepEqual(records, [contact({ name: 'أحمد علي', notes: 'تواصل' })]);
  assert.equal('sessions' in records[0], false);
  assert.equal('payments' in records[0], false);
  assert.equal('age' in records[0], false);
  assert.equal(input.name, '  أحمد   علي  ');
});

test('contact creation rejects duplicate IDs and equivalent mobile formats without mutating source', () => {
  const source = [contact()];
  const before = structuredClone(source);
  assert.throws(() => saveClinicContact(source, contact({ id: 'different', mobile: '+201012345678' })), /الرقم موجود/);
  assert.throws(() => saveClinicContact(source, contact({ mobile: '01112345678' })), /معرّف/);
  assert.deepEqual(source, before);
});

test('contact edits preserve creation time and unknown metadata, and reject stale or conflicting edits', () => {
  const original = { ...contact(), future: { tags: ['keep'] } };
  const source = [original, contact({ id: 'other', mobile: '01112345678' })];
  const saved = saveClinicContact(source, contact({ name: 'اسم جديد', createdAt: '2026-10-08T09:00:00.000Z' }), original);
  assert.equal(saved[0].name, 'اسم جديد');
  assert.equal(saved[0].createdAt, original.createdAt);
  assert.deepEqual((saved[0] as typeof original).future, original.future);
  assert.equal(source[0].name, original.name);
  assert.throws(() => saveClinicContact(source, contact({ id: 'changed' }), original), /معرّف/);
  assert.throws(() => saveClinicContact(source, contact({ mobile: '+201112345678' }), original), /الرقم موجود/);
  assert.throws(() => saveClinicContact(saved, contact({ name: 'مسودة قديمة' }), original), /تغيّرت/);
  assert.throws(() => saveClinicContact([], contact(), original), /تغيّرت/);
});

test('contact deletion is explicit, stale guarded and changes no other contact or clinical file', () => {
  const original = contact();
  const other = contact({ id: 'other', mobile: '01112345678' });
  const source = [original, other];
  assert.deepEqual(deleteClinicContact(source, original), [other]);
  assert.equal(source.length, 2);
  assert.throws(() => deleteClinicContact([{ ...original, notes: 'newer' }], original), /تغيّرت/);
  assert.throws(() => deleteClinicContact([], original), /تغيّرت/);
});

test('contact field validation rejects malformed, oversized and unsafe inputs before persistence', () => {
  const changes: any[] = [{ name: '' }, { name: 'a'.repeat(201) }, { name: 'اسم\nمخفي' }, { id: 'unsafe id' },
    { mobile: 'abc01012345678' }, { mobile: null }, { notes: 'n'.repeat(2001) }, { notes: [] }, { notes: '\u0000' },
    { createdAt: '' }, { createdAt: '2026-02-31T09:00:00.000Z' }, { createdAt: 'yesterday' }];
  changes.forEach(change => {
    const input = contact(change);
    assert.ok(clinicContactValidationError(input));
    assert.throws(() => saveClinicContact([], input));
  });
  assert.ok(clinicContactValidationError(null));
  assert.ok(clinicContactValidationError([]));
  assert.equal(clinicContactValidationError(contact({ notes: 'سطر أول\nسطر ثانٍ' })), null);
});

test('phone index preserves all canonical family matches, source IDs and original order', () => {
  const patients = Object.freeze([Object.freeze(patient('002', '01012345678')), Object.freeze(patient('۲', '+20 1012345678')),
    Object.freeze(patient('3', '01012345679')), Object.freeze(patient('invalid', 'label01012345678'))]);
  const index = createPhoneDirectoryIndex(patients);
  for (const phone of ['01012345678', '٠٠٢٠١٠١٢٣٤٥٦٧٨', '+۲۰۱۰۱۲۳۴۵۶۷۸']) {
    const matches = findRecordsByPhone(index, phone);
    assert.deepEqual(matches, [patients[0], patients[1]]);
    assert.equal(matches[0].id, '002');
    assert.equal(matches[1].id, '۲');
  }
  for (const phone of ['', '010123', '01012345677', 'label01012345678']) assert.deepEqual(findRecordsByPhone(index, phone), []);
  assert.deepEqual(findRecordsByPhone(index, '01012345679'), [patients[2]]);
});

test('phone index scans each patient only once rather than once per contact lookup', () => {
  let phoneReads = 0;
  const patients = Array.from({ length: 1000 }, (_, id) => ({ id: String(id),
    get mobile() { phoneReads++; return `010${String(id).padStart(8, '0')}`; },
  }));
  const index = createPhoneDirectoryIndex(patients);
  assert.equal(phoneReads, patients.length);
  for (let id = 0; id < 1000; id++) assert.equal(findRecordsByPhone(index, `+2010${String(id).padStart(8, '0')}`)[0], patients[id]);
  assert.equal(phoneReads, patients.length);
  assert.equal(findRecordsByPhone(index, '01000000000'), findRecordsByPhone(index, '+201000000000'));
  assert.equal(findRecordsByPhone(index, ''), findRecordsByPhone(index, 'invalid'));
});

test('indexed contact searching retains normalized names, phone fragments and mixed-query rejection', () => {
  const records = [contact(), contact({ id: 'other', name: 'محمود مصطفى', mobile: '+971501234567' })];
  for (const query of ['', 'احمد', 'أحمد علي', '٠١٠١٢٣', '+201012345678', '٢٣٤٥٦٧٨', 'مصطفي', '+971', 'abc1234', '01012345679']) {
    const prepared = prepareContactSearchQuery(query);
    for (const record of records) assert.equal(indexedContactMatchesSearch(createContactSearchEntry(record), prepared), contactMatchesSearch(record, query), query);
  }
});

test('contact search entry reads record fields once and reuses them for later queries', () => {
  let reads = 0;
  const record = { get name() { reads++; return 'أَحمد علي'; }, get mobile() { reads++; return '٠١٠١٢٣٤٥٦٧٨'; } };
  const entry = createContactSearchEntry(record);
  assert.equal(reads, 2);
  for (const query of ['احمد', '٠١٠١٢٣', '+201012345678', 'abc1234']) indexedContactMatchesSearch(entry, prepareContactSearchQuery(query));
  assert.equal(reads, 2);
});
