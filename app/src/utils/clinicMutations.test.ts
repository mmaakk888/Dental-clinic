import test from 'node:test';
import assert from 'node:assert/strict';
import { addPatientReceipt, addWalkInRecord, canonicalFileNumber, deletePatientRecord, importPatientRecords, savePatientAppointment, savePatientRecord } from './clinicMutations';
import { getPatientFinancialSummary } from './financials';
import type { Patient, Session, Appointment } from '../types';
import type { ClinicDomainData } from './storage';

const session = (): Session => ({ id: 's1', type: 'حشو', tooth: null, amount: 100, paid: 20, remain: 80,
  date: '2026-10-06', paymentsLog: [{ id: 'r1', date: '2026-10-06', amount: 20 }] });
const patient = (): Patient => ({ id: '401', name: 'مريض اختبار', mobile: '01000000000', age: 25,
  firstVisit: '2026-10-06', notes: '', allergy: '', sessions: [session()], payments: [] });
const domain = (): ClinicDomainData => ({ patients: [patient()], contacts: [], appointments: [], labCases: [], expenses: [], materialUsages: [] });
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
  assert.equal(next[0].id, imported.id);
  assert.deepEqual(next[0].sessions, imported.sessions); assert.deepEqual(next[0].payments, imported.payments);
  assert.equal(original.length, 1);
  assert.throws(() => importPatientRecords(original, [imported, { ...patient(), id: '٤٠١' }]), /لم يبدأ الاستيراد/);
  assert.throws(() => importPatientRecords(original, [imported, { ...imported, id: '۴۰۲' }]), /لم يبدأ الاستيراد/);
});

test('historical imports keep source file identities, phone formatting and financial history unchanged', () => {
  for (const id of ['٠٠٤٠٢', '۰۰۴۰۲', 'ملف-٤٠٢']) {
    const imported = { ...patient(), id, mobile: '٠١٠ ٠٠٠٠ ٠٠٠٠' };
    const before = structuredClone(imported);
    const result = importPatientRecords([], [imported]);
    assert.deepEqual(result[0], before);
    assert.deepEqual(imported, before);
  }
  assert.throws(() => importPatientRecords([{ ...patient(), id: '٠٠٤٠٢' }], [{ ...patient(), id: '۰۰۴۰۲' }]), /لم يبدأ الاستيراد/);
});

test('patient deletion removes both appointment identity aliases and preserves unrelated domain records', () => {
  const originalPatient = patient();
  const unrelatedPatient = { ...patient(), id: '402', name: 'ملف آخر' };
  const unrelatedAppointment = { ...appointment(), id: 'keep', patientId: '402', fileNo: '402' };
  const before = { ...domain(), patients: [originalPatient, unrelatedPatient], appointments: [
    appointment(),
    { ...appointment(), id: 'legacy-file-only', patientId: '', fileNo: originalPatient.id },
    { ...appointment(), id: 'patient-id-only', patientId: originalPatient.id, fileNo: '' },
    unrelatedAppointment,
  ] };
  const after = deletePatientRecord(before, originalPatient.id);
  assert.deepEqual(after.patients, [unrelatedPatient]);
  assert.equal(after.patients[0], unrelatedPatient);
  assert.deepEqual(after.appointments, [unrelatedAppointment]);
  assert.equal(after.appointments[0], unrelatedAppointment);
  for (const section of ['contacts', 'labCases', 'expenses', 'materialUsages'] as const) assert.equal(after[section], before[section]);
  assert.equal(before.patients.length, 2);
  assert.equal(before.appointments.length, 4);
  assert.equal(before.patients[0], originalPatient);
});

test('patient deletion refuses both current and legacy laboratory references and missing patient files', () => {
  for (const identity of [{ patientId: '401', fileNo: '401' }, { patientId: '', fileNo: '401' }, { patientId: '401', fileNo: '' }]) {
    const before = domain();
    before.labCases = [{ id: 'fake-case', ...identity } as ClinicDomainData['labCases'][number]];
    assert.throws(() => deletePatientRecord(before, '401'), /مرتبط بشغل معمل/);
    assert.equal(before.patients.length, 1);
    assert.equal(before.labCases.length, 1);
  }
  assert.throws(() => deletePatientRecord(domain(), 'missing-file'), /لم يعد موجودًا/);
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

test('independent general receipts cap session collection at the current patient debt', () => {
  const before = patient();
  before.payments = [{ id: 'general-1', amount: 50, date: '2026-10-06', createdAt: '2026-10-06T10:00:00Z' }];
  assert.equal(getPatientFinancialSummary(before).totalRemaining, 30);
  assert.throws(() => addPatientReceipt([before], before.id, 's1', { id: 'over', date: '2026-10-06', amount: 31 }), /المستحق الحالي/);
  const after = addPatientReceipt([before], before.id, 's1', { id: 'settle', date: '2026-10-06', amount: 30 })[0];
  assert.equal(getPatientFinancialSummary(after).totalRemaining, 0);
  assert.equal(after.sessions[0].remain, 50);
  assert.deepEqual(after.payments, before.payments);
  assert.throws(() => addPatientReceipt([after], after.id, 's1', { id: 'again', date: '2026-10-06', amount: 1 }), /المستحق الحالي/);
  assert.equal(before.sessions[0].paymentsLog.length, 1);
});

test('voided general and session receipts do not consume current collection allowance', () => {
  const before = patient();
  before.sessions[0].paymentsLog.push({ id: 'void-session', amount: 40, date: '2026-10-06', voidedAt: '2026-10-06T10:00:00Z' });
  before.payments = [{ id: 'void-general', amount: 70, date: '2026-10-06', voidedAt: '2026-10-06T10:00:00Z' }];
  const after = addPatientReceipt([before], before.id, 's1', { id: 'settle', date: '2026-10-06', amount: 80 })[0];
  assert.equal(getPatientFinancialSummary(after).totalCollected, 100);
  assert.equal(getPatientFinancialSummary(after).totalRemaining, 0);
  assert.equal(after.sessions[0].paymentsLog.find(receipt => receipt.id === 'void-session')?.voidedAt, '2026-10-06T10:00:00Z');
  assert.deepEqual(after.payments, before.payments);
});

test('a different service debt cannot permit collection above the selected service balance', () => {
  const before = patient();
  before.sessions.push({ ...session(), id: 's2', amount: 500, paid: 0, remain: 500, paymentsLog: [] });
  assert.throws(() => addPatientReceipt([before], before.id, 's1', { id: 'over', date: '2026-10-06', amount: 81 }), /المستحق الحالي/);
  const after = addPatientReceipt([before], before.id, 's1', { id: 'settle', date: '2026-10-06', amount: 80 })[0];
  assert.equal(after.sessions[1], before.sessions[1]);
  assert.equal(getPatientFinancialSummary(after).totalRemaining, 500);
});

test('replayed receipt identifiers are rejected before any history or general-payment identity can be corrupted', () => {
  const before = patient();
  for (const id of ['r1', '']) {
    assert.throws(() => addPatientReceipt([before], before.id, 's1', { id, date: '2026-10-06', amount: 1 }), /معرّف إيصال/);
  }
  before.payments.push({ id: 'general-id', date: '2026-10-06', amount: 5, createdAt: '2026-10-06T10:00:00Z' });
  assert.throws(() => addPatientReceipt([before], before.id, 's1', { id: 'general-id', date: '2026-10-06', amount: 1 }), /معرّف إيصال/);
  assert.equal(getPatientFinancialSummary(before).totalCollected, 25);
});

test('cent-valued receipts are not rejected due to floating-point balance residue', () => {
  const before = patient();
  before.sessions[0] = { ...session(), amount: 0.3, paid: 0.1, remain: 0.2, paymentsLog: [{ id: 'decimal-prior', date: '2026-10-06', amount: 0.1 }] };
  const after = addPatientReceipt([before], before.id, 's1', { id: 'decimal-settle', date: '2026-10-06', amount: 0.2 })[0];
  assert.equal(after.sessions[0].remain, 0);
});

test('patient receipt boundaries reject sub-cent cash, invalid dates and reserved legacy identities without modifying history', () => {
  const before = patient(), original = structuredClone(before);
  for (const amount of [0.001, 1.999, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => addPatientReceipt([before], before.id, 's1', { id: 'invalid-money', date: '2026-10-06', amount }));
  }
  for (const date of ['', '2026-02-30', '2026-13-01', '2026-10-6']) {
    assert.throws(() => addPatientReceipt([before], before.id, 's1', { id: 'invalid-date', date, amount: 1 }), /تاريخًا صحيحًا/);
  }
  assert.deepEqual(before, original);
  const legacy = { ...patient(), sessions: [{ ...session(), paymentsLog: [] }] };
  assert.throws(() => addPatientReceipt([legacy], legacy.id, 's1', { id: 'legacy_s1', date: '2026-10-06', amount: 1 }), /معرّف إيصال/);
  assert.deepEqual(legacy.sessions[0].paymentsLog, []);
});

test('new computed cash residue is canonicalized to the same cent amount before the debt comparison', () => {
  const before = { ...patient(), sessions: [{ ...session(), amount: 0.3, paid: 0, remain: 0.3, paymentsLog: [] }] };
  const after = addPatientReceipt([before], before.id, 's1', { id: 'computed-sum', date: '2026-10-06', amount: 0.1 + 0.2 })[0];
  assert.equal(after.sessions[0].paymentsLog[0].amount, 0.3);
  assert.equal(after.sessions[0].paid, 0.3);
  assert.equal(after.sessions[0].remain, 0);
});

test('patient edit rejects a concurrent demographic change but accepts independent financial changes', () => {
  const baseline = patient();
  const draft = { ...baseline, name: 'اسم المسودة' };
  const concurrentDemographics = { ...baseline, mobile: '01012345678' };
  assert.throws(() => savePatientRecord([concurrentDemographics], draft, baseline.id, baseline), /تغيّرت بيانات المريض/);
  const concurrentFinance = addPatientReceipt([baseline], baseline.id, 's1', { id: 'during-edit', date: '2026-10-06', amount: 10 })[0];
  const after = savePatientRecord([concurrentFinance], draft, baseline.id, baseline)[0];
  assert.equal(after.name, draft.name);
  assert.deepEqual(after.sessions, concurrentFinance.sessions);
  assert.throws(() => savePatientRecord([baseline], draft, baseline.id, { ...baseline, id: 'another-file' }), /تغيّرت بيانات المريض/);
});

test('demographic edits preserve additional stored metadata even from an untyped stale complete record', () => {
  const fresh = { ...patient(), customMetadata: { version: 2 } };
  const stale = { ...patient(), customMetadata: { version: 1 }, name: 'اسم معدل' };
  const after = savePatientRecord([fresh], stale, fresh.id)[0] as typeof fresh;
  assert.deepEqual(after.customMetadata, { version: 2 });
  assert.equal(after.name, stale.name);
});

test('omitted optional demographic fields preserve the latest stored value', () => {
  const fresh = { ...patient(), gender: 'female' };
  const { gender: _gender, ...draft } = fresh;
  const after = savePatientRecord([fresh], { ...draft, name: 'اسم معدل' }, fresh.id)[0];
  assert.equal(after.gender, 'female');
  assert.equal(savePatientRecord([fresh], { ...draft, gender: undefined }, fresh.id)[0].gender, undefined);
});

test('appointment scheduling edit preserves newer status, reminder history, patient identity, and extra metadata', () => {
  const baseline = appointment();
  const reminderLog: Appointment['reminderLog'] = [{ sentAt: '2026-10-06T10:00:00Z', type: 'whatsapp', channel: 'manual_wa', status: 'pending' }];
  const fresh = { ...baseline, status: 'confirmed' as const, reminderSent: true, reminderLog, customMetadata: 'LATEST' };
  const before = { ...domain(), appointments: [fresh] };
  const after = savePatientAppointment(before, { ...baseline, time: '19:30', reminderSent: false, reminderLog: [], customMetadata: 'STALE' } as Appointment, baseline).appointments[0] as typeof fresh;
  assert.equal(after.time, '19:30');
  assert.equal(after.status, 'confirmed');
  assert.equal(after.reminderSent, true);
  assert.deepEqual(after.reminderLog, reminderLog);
  assert.equal(after.customMetadata, 'LATEST');
  assert.equal(after.patientName, before.patients[0].name);
  assert.equal(after.mobile, before.patients[0].mobile);
  assert.equal(before.appointments[0].time, baseline.time);
});

test('appointment edits cannot overwrite a concurrently changed schedule or revive deleted appointments', () => {
  const baseline = appointment();
  const before = { ...domain(), appointments: [{ ...baseline, date: '2026-10-07' }] };
  assert.throws(() => savePatientAppointment(before, { ...baseline, time: '19:00' }, baseline), /تغيّرت بيانات الموعد/);
  assert.throws(() => savePatientAppointment(domain(), baseline, baseline), /الموعد المطلوب تعديله غير موجود/);
  assert.throws(() => savePatientAppointment({ ...domain(), appointments: [baseline] }, baseline, { ...baseline, id: 'other' }), /تغيّرت بيانات الموعد/);
});

test('generic scheduling edits preserve omitted optional scheduling fields but accept explicit clearing', () => {
  const fresh = { ...appointment(), doctorName: 'طبيب اختبار', durationMinutes: 45, appointmentType: 'نوع اختبار' };
  const before = { ...domain(), appointments: [fresh] };
  const input = { ...appointment(), time: '19:00' };
  const after = savePatientAppointment(before, input).appointments[0];
  assert.equal(after.doctorName, fresh.doctorName);
  assert.equal(after.durationMinutes, fresh.durationMinutes);
  assert.equal(after.appointmentType, fresh.appointmentType);
  assert.equal(savePatientAppointment(before, { ...input, doctorName: undefined }).appointments[0].doctorName, undefined);
});

test('new appointments require an existing file and valid scheduling details', () => {
  const { id: _id, ...input } = appointment();
  for (const changes of [{ patientId: 'missing' }, { date: '2026-02-30' }, { time: '25:00' }, { durationMinutes: 0 }]) {
    assert.throws(() => savePatientAppointment(domain(), { ...input, ...changes }));
  }
  const before = domain();
  const after = savePatientAppointment(before, input);
  assert.match(after.appointments[0].id, /^a_/);
  assert.equal(after.appointments[0].fileNo, before.patients[0].id);
  assert.equal(before.appointments.length, 0);
});
