import test from 'node:test';
import assert from 'node:assert/strict';
import { addPatientReceipt, addWalkInRecord, canonicalFileNumber, importPatientRecords, savePatientRecord } from './clinicMutations';
import type { Patient, Session, Appointment } from '../types';
import type { ClinicDomainData } from './storage';

const session = (): Session => ({ id: 's1', type: 'حشو', tooth: null, amount: 100, paid: 20, remain: 80,
  date: '2026-10-06', paymentsLog: [{ id: 'r1', date: '2026-10-06', amount: 20 }] });
const patient = (): Patient => ({ id: '401', name: 'مريض اختبار', mobile: '01000000000', age: 25,
  firstVisit: '2026-10-06', notes: '', allergy: '', sessions: [session()], payments: [] });
const domain = (): ClinicDomainData => ({ patients: [patient()], appointments: [], labCases: [], expenses: [], materialUsages: [] });
const appointment = (): Appointment => ({ id: 'a1', patientId: '401', fileNo: '401', patientName: 'اختبار', mobile: '',
  date: '2026-10-06', time: '17:30', note: '', status: 'attended', isFollowUp: false, isWalkIn: true });

test('new patient rejects an existing file number including Arabic/Persian digits', () => {
  assert.equal(canonicalFileNumber(' ۴٠١ '), '401');
  const input = patient(); input.id = '٤٠١';
  assert.throws(() => savePatientRecord([patient()], input), /مستخدم بالفعل/);
  assert.throws(() => addWalkInRecord(domain(), { ...input, isNew: true }, session(), appointment()), /دمج الملفين/);
});

test('editing requires explicit existing identity and preserves financial history', () => {
  const original = patient();
  const { sessions: _sessions, payments: _payments, ...details } = original;
  const saved = savePatientRecord([original], { ...details, name: 'اسم معدل' }, '401')[0];
  assert.equal(saved.name, 'اسم معدل');
  assert.deepEqual(saved.sessions, original.sessions);
  assert.deepEqual(saved.payments, original.payments);
  assert.throws(() => savePatientRecord([original], { ...details, id: '402' }, '401'), /تغيّر رقمه/);
  assert.throws(() => savePatientRecord([], details, '401'), /غير موجود/);
});

test('import retains full session/receipt history and rejects canonical duplicate numbers without partial changes', () => {
  const original = [patient()]; const imported = { ...patient(), id: '٤٠٢', name: 'ملف مستورد' };
  const next = importPatientRecords(original, [imported]);
  assert.equal(next[0].id, '402');
  assert.deepEqual(next[0].sessions, imported.sessions); assert.deepEqual(next[0].payments, imported.payments);
  assert.equal(original.length, 1);
  assert.throws(() => importPatientRecords(original, [imported, { ...patient(), id: '٤٠١' }]), /لم يبدأ الاستيراد/);
  assert.throws(() => importPatientRecords(original, [imported, { ...imported, id: '۴۰۲' }]), /لم يبدأ الاستيراد/);
});

test('complete stale patient callbacks cannot replace newer financial arrays during a demographic edit', () => {
  const fresh = patient(); fresh.sessions[0].paymentsLog.push({ id: 'new-receipt', amount: 10, date: '2026-10-06' });
  fresh.payments.push({ id: 'general', amount: 5, date: '2026-10-06' });
  const stale = { ...patient(), name: 'اسم جديد', sessions: [], payments: [] };
  const saved = savePatientRecord([fresh], stale, '401')[0];
  assert.equal(saved.name, stale.name);
  assert.deepEqual(saved.sessions, fresh.sessions); assert.deepEqual(saved.payments, fresh.payments);
});

test('walk-in adds session and appointment together without overwriting an existing phone/name', () => {
  const before = domain(); const visit = { ...session(), id: 's2' };
  const after = addWalkInRecord(before, { isNew: false, id: '٤٠١', name: 'لا تستبدل الاسم', mobile: '01999999999' }, visit, appointment());
  assert.equal(before.patients[0].sessions.length, 1);
  assert.equal(before.appointments.length, 0);
  assert.equal(after.patients[0].sessions.length, 2);
  assert.equal(after.patients[0].mobile, before.patients[0].mobile);
  assert.equal(after.appointments[0].mobile, before.patients[0].mobile);
  assert.equal(after.appointments[0].patientName, before.patients[0].name);
  assert.throws(() => addWalkInRecord(before, { isNew: false, id: '999', name: 'غير موجود', mobile: '' }, visit, appointment()), /لم يعد موجود/);
});

test('receipts use latest remaining balance and retain all earlier receipts', () => {
  const original = [patient()];
  const first = addPatientReceipt(original, '401', 's1', { id: 'r2', date: '2026-10-06', amount: 50 });
  assert.deepEqual(first[0].sessions[0].paymentsLog.map(receipt => receipt.id), ['r1', 'r2']);
  assert.equal(original[0].sessions[0].paid, 20);
  assert.throws(() => addPatientReceipt(first, '401', 's1', { id: 'r3', date: '2026-10-06', amount: 31 }), /المستحق الحالي/);
  const final = addPatientReceipt(first, '401', 's1', { id: 'r3', date: '2026-10-06', amount: 30 });
  assert.equal(final[0].sessions[0].remain, 0);
  assert.equal(final[0].sessions[0].paymentsLog.length, 3);
  assert.throws(() => addPatientReceipt(final, '401', 'missing', { id: 'r4', date: '2026-10-06', amount: 1 }), /غير موجودة/);
});
