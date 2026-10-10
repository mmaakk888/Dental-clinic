import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClinicContactDirectory, clinicDirectoryRowMatchesSearch, prepareContactSearchQuery } from './clinicContacts';
import type { ClinicContact, Patient } from '../types';

const patient = (id: string, name: string, mobile: string): Patient => ({ id, name, mobile, age: 30, firstVisit: '', notes: 'SYNTHETIC_CLINICAL_PRIVATE', allergy: '', sessions: [], payments: [] });
const contact = (id: string, name: string, mobile: string): ClinicContact => ({ id, name, mobile, notes: 'ملاحظة اتصال اختبار', createdAt: '2026-10-10T10:00:00.000Z' });

test('directory derives patient phones and standalone contacts without persisting, duplicating canonical numbers or copying clinical fields', () => {
  const contacts = Object.freeze([Object.freeze(contact('c1', 'اسم اتصال مصطنع', '01012345678')), Object.freeze(contact('c2', 'اتصال مستقل', '01212345678'))]);
  const patients = Object.freeze([Object.freeze(patient('401', 'أحمد اختبار', '+201012345678')), Object.freeze(patient('402', 'سارة اختبار', '٠١٠١٢٣٤٥٦٧٨')),
    Object.freeze(patient('403', 'محمد اختبار', '01112345678')), Object.freeze(patient('404', 'مريض بلا هاتف', ''))]);
  const before = JSON.stringify({ contacts, patients });
  const rows = buildClinicContactDirectory(contacts, patients);
  assert.equal(rows.length, 3); assert.equal(JSON.stringify({ contacts, patients }), before);
  const linked = rows.find(row => row.contact?.id === 'c1')!;
  assert.deepEqual(linked.matches, [{ id: '401', name: 'أحمد اختبار' }, { id: '402', name: 'سارة اختبار' }]);
  assert.equal(rows.find(row => row.contact?.id === 'c2')!.matches.length, 0);
  const derived = rows.find(row => row.id.startsWith('patient-phone:'))!;
  assert.equal(derived.name, 'محمد اختبار'); assert.equal(derived.contact, undefined); assert.deepEqual(derived.matches, [{ id: '403', name: 'محمد اختبار' }]);
  assert.ok(!JSON.stringify(rows).includes('SYNTHETIC_CLINICAL_PRIVATE'));
});

test('patient-only shared family phone shows every distinct file and every alias remains searchable', () => {
  const rows = buildClinicContactDirectory([], [patient('10', 'محمود اختبار', '01012345678'), patient('11', 'إبراهيم اختبار', '+201012345678')]);
  assert.equal(rows.length, 1); assert.deepEqual(rows[0].matches.map(file => file.id), ['10', '11']);
  for (const query of ['محمود', 'ابراهيم', '٠١٠١٢٣', '+201012345678', '٢٣٤٥٦٧٨']) assert.equal(clinicDirectoryRowMatchesSearch(rows[0], prepareContactSearchQuery(query)), true, query);
  for (const query of ['سارة', 'abc1234', '01012345679']) assert.equal(clinicDirectoryRowMatchesSearch(rows[0], prepareContactSearchQuery(query)), false, query);
});

test('contact alias and linked patient names both search the same row without replacing stored contact identity', () => {
  const saved = contact('c1', 'الاسم المتعارف عليه', '01012345678');
  const rows = buildClinicContactDirectory([saved], [patient('11', 'اسم المريض الأصلي', '+201012345678')]);
  assert.equal(rows[0].contact, saved); assert.equal(rows[0].name, saved.name);
  for (const query of ['المتعارف', 'الأصلي']) assert.equal(clinicDirectoryRowMatchesSearch(rows[0], prepareContactSearchQuery(query)), true);
});

test('malformed legacy numbers stay visible but never cause partial/nearby-number grouping', () => {
  const rows = buildClinicContactDirectory([], [patient('1', 'اختبار واحد', '010123'), patient('2', 'اختبار اثنين', '010123'),
    patient('3', 'اختبار ثلاثة', '01012345678'), patient('4', 'اختبار أربعة', '01012345679')]);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map(row => row.matches.map(file => file.id)), [['1'], ['2'], ['3'], ['4']]);
  assert.equal(rows[0].mobile, '010123');
});

test('derivation preserves legacy independent contacts and does not infer campaign consent', () => {
  const rows = buildClinicContactDirectory([contact('a', 'اسم أول', '01012345678'), contact('b', 'اسم آخر', '+201012345678')], [patient('5', 'اسم ملف', '01012345678')]);
  assert.equal(rows.length, 2); assert.ok(rows.every(row => row.matches[0].id === '5'));
  assert.ok(rows.every(row => !('consent' in row) && !('marketingConsent' in row)));
});
