import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import type { SessionServiceItem, Patient } from '../types';
import type { ClinicDomainData } from './storage';
import { addWalkInRecord, canonicalFileNumber } from './clinicMutations';
import { validateWalkInAmounts } from './walkInDraft';
import { getToothLabel, getToothStatusForPatient } from './toothUtils';
import { calculateDailyCollections, getPatientFinancialSummary } from './financials';
import { getNextPatientFileNo } from './patientRegistration';

// Execute the actual App walk-in boundary without hydrating App, reading clinic
// storage, rendering a browser, contacting Firebase or saving a real visit.
const source = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback: ts.Expression | undefined;
const visit = (node: ts.Node) => {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'handleSaveWalkInVisit') callback = node.initializer;
  ts.forEachChild(node, visit);
};
visit(parsed); assert.ok(callback);
const executable = ts.transpileModule(`return (${callback.getText(parsed)});`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const initialPatient: Patient = { id: '401', name: 'مريض اختبار مصطنع', mobile: '01000000000', age: 30, firstVisit: '2026-10-01', notes: 'ملاحظة محفوظة مصطنعة', allergy: '', sessions: [], payments: [] };
function payload(services: SessionServiceItem[], examinationFee = 100, paid = 300, discountAmount = 50) {
  const treatmentFee = services.reduce((sum, item) => sum + item.price, 0);
  return { patient: { isNew: false, id: '401', name: 'اسم من مسودة اختبار', mobile: '01100000000', age: 30 }, visit: {
    chiefComplaint: 'شكوى مصطنعة', diagnosis: 'تشخيص مصطنع', procedurePerformed: services.map(item => item.name).join(' + ') || 'كشف',
    services, prescriptionNotes: '', visitNotes: '', visitStatus: 'completed', examinationFee, treatmentFee,
    totalFee: treatmentFee + examinationFee, paidAmount: paid, discountAmount, paymentMethod: 'cash', isPaid: paid + discountAmount === treatmentFee + examinationFee,
  } };
}
function harness(rejectCommit = false, initialPatients: Patient[] = [structuredClone(initialPatient)]) {
  let data: ClinicDomainData = { patients: initialPatients, appointments: [], contacts: [], labCases: [], expenses: [], materialUsages: [] };
  const events: string[] = [], requestedActions: string[][] = [];
  const dependencies = {
    requireFreshSettingsPermission: (action: string) => { events.push(`authorize:${action}`); },
    validateWalkInAmounts, getToothLabel, localDateISO: () => '2026-10-10', canonicalFileNumber, addWalkInRecord, getNextPatientFileNo,
    commitDomain: async (actions: string[], mutate: (current: ClinicDomainData) => ClinicDomainData) => {
      requestedActions.push(actions); if (rejectCommit) throw new Error('synthetic-save-failed');
      const next = mutate(data); events.push('confirmed-write'); data = next;
    },
    setIsWalkInModalOpen: (open: boolean) => { events.push(`modal:${open}`); },
    handleSelectPatient: (id: string) => { events.push(`select:${id}`); },
  };
  const save = new Function(...Object.keys(dependencies), executable)(...Object.values(dependencies));
  return { save, events, requestedActions, current: () => data,
    replacePatients: (patients: Patient[]) => { data = { ...data, patients }; } };
}

test('actual walk-in save retains each service tooth, chart status and one cash receipt without duplicating income', async () => {
  const h = harness();
  const services: SessionServiceItem[] = [{ id: 'synthetic-fill', name: 'حشو ليزر', price: 600, tooth: 'ur6' }, { id: 'synthetic-extract', name: 'خلع سن', price: 400, tooth: 'llE' }];
  await h.save(payload(services));
  const patient = h.current().patients[0], session = patient.sessions[0];
  assert.deepEqual(session.services, services); assert.equal(session.tooth, null); assert.deepEqual(session.teethIds, ['ur6', 'llE']);
  assert.equal(getToothStatusForPatient(patient.sessions, 'ur6').status, 'filled');
  assert.equal(getToothStatusForPatient(patient.sessions, 'llE').status, 'extracted');
  assert.equal(getToothStatusForPatient(patient.sessions, 'ul6').status, 'normal');
  assert.equal(session.examinationFee, 100); assert.equal(session.treatmentFee, 1000); assert.equal(session.amount, 1100);
  assert.equal(session.paymentsLog.length, 1); assert.equal(session.paymentsLog[0].amount, 300); assert.equal(session.remain, 750);
  assert.equal(getPatientFinancialSummary(patient).totalCollected, 300);
  assert.equal(calculateDailyCollections([patient], day => day === '2026-10-10').totalIncomeCollected, 300);
  assert.equal(patient.name, initialPatient.name); assert.equal(patient.mobile, initialPatient.mobile); assert.equal(patient.notes, initialPatient.notes);
  assert.equal(h.current().appointments[0].status, 'attended'); assert.equal(h.current().appointments[0].patientId, '401');
  assert.deepEqual(h.requestedActions[0], ['edit_patient', 'add_session', 'register_payment']);
  assert.ok(h.events.indexOf('confirmed-write') < h.events.indexOf('modal:false'));
});

test('actual walk-in save preserves a single primary tooth and allows explicit examination-only or free visits', async () => {
  const one = harness(); await one.save(payload([{ id: 'synthetic-primary', name: 'خدمة مجانية', price: 0, tooth: 'ulA' }], 0, 0, 0));
  assert.equal(one.current().patients[0].sessions[0].tooth, 'ulA');
  assert.equal(one.current().patients[0].sessions[0].paymentsLog.length, 0);
  assert.equal(calculateDailyCollections(one.current().patients, () => true).totalIncomeCollected, 0);
  const exam = harness(); await exam.save(payload([], 100, 100, 0));
  const session = exam.current().patients[0].sessions[0];
  assert.equal(session.tooth, null); assert.equal(session.teethIds, undefined);
  assert.equal(session.treatmentFee, 0); assert.equal(session.examinationFee, 100);
  assert.equal(calculateDailyCollections(exam.current().patients, () => true).examFeesCollected, 100);
});

test('actual walk-in save stores cent totals and accepts an exact paid/discount split without floating residue', async () => {
  const h = harness();
  await h.save(payload([{ id: 'synthetic-cent', name: 'خدمة مصطنعة', price: 0.3 }], 0, 0.1, 0.2));
  const session = h.current().patients[0].sessions[0];
  assert.equal(session.amount, 0.3); assert.equal(session.remain, 0);
  const summed = harness();
  await summed.save(payload([{ id: 'cent-a', name: 'خدمة أ', price: 0.1 }, { id: 'cent-b', name: 'خدمة ب', price: 0.2 }], 0, 0.3, 0));
  const summedSession = summed.current().patients[0].sessions[0];
  assert.equal(summedSession.amount, 0.3); assert.equal(summedSession.treatmentFee, 0.3);
  assert.equal(summedSession.remain, 0);
});

test('actual walk-in boundary rejects forged totals and malformed tooth IDs before any commit', () => {
  const h = harness();
  const valid = payload([{ id: 'synthetic-service', name: 'خدمة اختبار', price: 600, tooth: 'ur6' }]);
  assert.throws(() => h.save({ ...valid, visit: { ...valid.visit, treatmentFee: 700 } }), /إجمالي/);
  assert.throws(() => h.save({ ...valid, visit: { ...valid.visit, totalFee: 800 } }), /إجمالي/);
  assert.throws(() => h.save(payload([{ id: 'synthetic-invalid-tooth', name: 'خدمة اختبار', price: 600, tooth: 'ur99' }])), /سنًا صحيحًا/);
  assert.equal(h.requestedActions.length, 0); assert.equal(h.current().patients[0].sessions.length, 0);
});

test('actual walk-in failure does not close the form, select a file or publish a partial session', async () => {
  const h = harness(true);
  await assert.rejects(h.save(payload([{ id: 'synthetic-service', name: 'خدمة اختبار', price: 600, tooth: 'ur6' }])), /synthetic-save-failed/);
  assert.equal(h.current().patients[0].sessions.length, 0); assert.equal(h.current().appointments.length, 0);
  assert.ok(!h.events.some(event => event.startsWith('modal:') || event.startsWith('select:')));
});

test('new walk-ins ignore a stale suggested file number and allocate after the latest stored maximum', async () => {
  const h = harness(), visit = payload([], 100, 0, 0);
  const draft = { ...visit, patient: { ...visit.patient, isNew: true, id: '402' } };
  // Another saved file appeared after this form suggested 402.
  h.replacePatients([{ ...structuredClone(initialPatient), id: '٤٠٤' }, structuredClone(initialPatient)]);
  await Promise.all([h.save(draft), h.save({ ...draft, patient: { ...draft.patient, name: 'مريض مصطنع ثانٍ' } })]);
  assert.deepEqual(h.current().patients.map(patient => patient.id), ['406', '405', '٤٠٤', '401']);
  assert.deepEqual(h.current().appointments.map(appointment => appointment.patientId), ['406', '405']);
  assert.deepEqual(h.current().appointments.map(appointment => appointment.fileNo), ['406', '405']);
  assert.ok(h.events.includes('select:405')); assert.ok(h.events.includes('select:406'));
  assert.deepEqual(h.requestedActions[0], ['add_patient', 'add_session', 'register_payment']);
});

test('an existing walk-in retains and opens its stored Arabic ID rather than a canonical draft alias', async () => {
  const stored = { ...structuredClone(initialPatient), id: '٤٠١' }, h = harness(false, [stored]);
  await h.save(payload([], 100, 0, 0));
  assert.equal(h.current().patients.length, 1); assert.equal(h.current().patients[0].id, '٤٠١');
  assert.equal(h.current().patients[0].name, initialPatient.name);
  assert.equal(h.current().appointments[0].patientId, '٤٠١'); assert.equal(h.current().appointments[0].fileNo, '٤٠١');
  assert.ok(h.events.includes('select:٤٠١')); assert.equal(h.events.includes('select:401'), false);
});

test('a new walk-in in an empty clinic starts with file one without creating implicit collection', async () => {
  const h = harness(false, []), visit = payload([], 100, 0, 0);
  await h.save({ ...visit, patient: { ...visit.patient, isNew: true, id: '999' } });
  assert.equal(h.current().patients[0].id, '1'); assert.ok(h.events.includes('select:1'));
  assert.deepEqual(h.current().patients[0].sessions[0].paymentsLog, []);
  assert.equal(calculateDailyCollections(h.current().patients, () => true).totalIncomeCollected, 0);
});
