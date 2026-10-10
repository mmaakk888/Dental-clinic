import assert from 'node:assert/strict';
import test from 'node:test';
import type { Lab, Patient } from '../types';
import type { ClinicDomainData } from './storage';
import type { ServiceCatalogValues } from './serviceCatalog';
import type { ProstheticRoutingSettings } from './prostheticRouting';
import { addPatientReceipt } from './clinicMutations';
import { calculateDailyCollections, getPatientFinancialSummary } from './financials';
import { createProstheticOrder, getLinkedPatientAccount, getPatientProstheticPrice, validateProstheticOrder } from './prostheticWorkflow';
import type { ProstheticOrderInput } from './prostheticWorkflow';

const operationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const sessionId = `prosthetic_session_${operationId}`;
const caseId = `prosthetic_case_${operationId}`;
const patient = (id = '401'): Patient => ({
  id, name: `مريض اختبار ${id}`, mobile: '01000000000', age: 25,
  firstVisit: '2026-10-10', notes: '', allergy: '', sessions: [], payments: [],
});
const domainFixture = (): ClinicDomainData => ({
  patients: [patient(), patient('402')], contacts: [], appointments: [], labCases: [], expenses: [], materialUsages: [],
});
const labsFixture = (): Lab[] => [
  { id: 'lab-fixed', name: 'معمل ثابت خاص', services: [
    { id: 'zircon-default', name: 'زيركون', category: 'fixed', unitLabel: 'كراون', price: 300 },
    { id: 'pfm-default', name: 'PFM', category: 'fixed', unitLabel: 'كراون', price: 200 },
  ] },
  { id: 'lab-removable', name: 'معمل متحرك خاص', services: [
    { id: 'removable-default', name: 'طقم كامل', category: 'removable', unitLabel: 'طقم', price: 700 },
  ] },
  { id: 'lab-special', name: 'معمل مخصص خاص', services: [
    { id: 'special-service-id', name: 'خدمة مختلفة الاسم داخل المعمل', category: 'fixed', unitLabel: 'وحدة', price: 425 },
  ] },
];
const catalogFixture = (): ServiceCatalogValues => ({
  serviceTypes: ['حشو', 'تركيبات - ثابتة', 'تركيبات - متحركة'],
  crownPrices: { 'زيركون': 1500, PFM: 1000, 'طقم كامل': 3000 }, clinicalPrices: { 'حشو': 500 }, examinationFee: 100,
});
const routingFixture = (): ProstheticRoutingSettings => ({
  defaultLabs: { fixed: 'lab-fixed', removable: 'lab-removable' }, overrides: [],
});
const inputFixture = (changes: Partial<ProstheticOrderInput> = {}): ProstheticOrderInput => ({
  operationId, patientId: '401', kind: 'fixed', material: 'زيركون', units: 3,
  teethIds: ['ur1', 'ur2', 'ur3'], date: '2026-10-10', expectedUnitPrice: 1500, examinationFee: 0, paid: 0,
  ...changes,
});
const create = (domain = domainFixture(), input = inputFixture(), routing = routingFixture(), labs = labsFixture(), catalog = catalogFixture()) =>
  createProstheticOrder(domain, input, routing, labs, catalog);

test('three crowns create exactly one linked clinical charge and private laboratory case without implicit collection or expense', () => {
  const domain = domainFixture(), original = structuredClone(domain), input = inputFixture();
  const result = create(domain, input);
  assert.deepEqual(domain, original);
  assert.notEqual(result, domain);
  assert.equal(result.patients[0].sessions.length, 1);
  assert.equal(result.patients[1], domain.patients[1]);
  assert.equal(result.labCases.length, 1);
  const session = result.patients[0].sessions[0], item = result.labCases[0];
  assert.equal(session.id, sessionId);
  assert.equal(item.id, caseId);
  assert.equal(item.linkedSessionId, session.id);
  assert.deepEqual(session.prosthetic, { kind: 'fixed', material: 'زيركون', units: 3, unitPrice: 1500 });
  assert.equal(session.treatmentFee, 4500);
  assert.equal(session.examinationFee, 0);
  assert.equal(session.amount, 4500);
  assert.equal(session.paid, 0);
  assert.equal(session.remain, 4500);
  assert.deepEqual(session.paymentsLog, []);
  assert.equal(session.paymentMethod, 'cash');
  assert.equal(session.services?.length, 1);
  assert.equal(session.services?.[0].price, 4500);
  assert.deepEqual(session.teethIds, input.teethIds);
  assert.notEqual(session.teethIds, input.teethIds);
  assert.equal(session.tooth, null);
  assert.equal(item.labId, 'lab-fixed');
  assert.equal(item.labServiceId, 'zircon-default');
  assert.equal(item.labTotal, 900);
  assert.equal(item.labPaid, 0);
  assert.deepEqual(item.paymentsLog, []);
  assert.equal(item.patientTotal, 4500);
  assert.equal(item.patientPaid, 0);
  assert.equal(item.status, 'pending');
  for (const key of ['contacts', 'appointments', 'expenses', 'materialUsages'] as const) assert.equal(result[key], domain[key]);
});

test('optional examination is charged once and only an actual cash amount creates a patient receipt', () => {
  const result = create(domainFixture(), inputFixture({ examinationFee: 100, paid: 600, note: '  ملاحظة للطبيب\nمتابعة  ', deliveryExpectedDate: '2026-10-17' }));
  const session = result.patients[0].sessions[0], item = result.labCases[0];
  assert.equal(session.amount, 4600);
  assert.equal(session.treatmentFee, 4500);
  assert.equal(session.examinationFee, 100);
  assert.equal(session.paid, 600);
  assert.equal(session.remain, 4000);
  assert.deepEqual(session.paymentsLog.map(({ createdAt: _createdAt, ...receipt }) => receipt), [{ id: `prosthetic_receipt_${operationId}`, amount: 600, date: '2026-10-10', paymentMethod: 'cash' }]);
  assert.ok(Number.isFinite(Date.parse(session.paymentsLog[0].createdAt!)));
  assert.equal(item.patientTotal, 4600);
  assert.equal(item.patientPaid, 600);
  assert.equal(item.labTotal, 900);
  assert.equal(item.labPaid, 0);
  assert.deepEqual(item.paymentsLog, []);
  assert.equal(session.visitNotes, 'ملاحظة للطبيب\nمتابعة');
  assert.equal(item.deliveryExpectedDate, '2026-10-17');
  assert.deepEqual(result.patients[0].payments, []);
  assert.deepEqual(result.expenses, []);
});

test('initial prosthetic cash cannot hide an older independent receipt with the same date and amount', () => {
  const domain = domainFixture();
  domain.patients[0].payments = [{ id: 'old-independent-general', amount: 600, date: '2026-10-10' }];
  const input = inputFixture({ paid: 600 });
  const result = create(domain, input);
  assert.equal(getPatientFinancialSummary(result.patients[0]).totalCollected, 1200);
  assert.equal(getPatientFinancialSummary(result.patients[0]).totalRemaining, 3300);
  assert.equal(calculateDailyCollections(result.patients, day => day === '2026-10-10').totalIncomeCollected, 1200);
  const timestamp = result.patients[0].sessions[0].paymentsLog[0].createdAt;
  const retry = create(result, input);
  assert.equal(retry, result);
  assert.equal(retry.patients[0].sessions[0].paymentsLog[0].createdAt, timestamp);
  // Previously saved v1 linked orders are recognized without rewriting them.
  delete result.patients[0].sessions[0].paymentsLog[0].createdAt;
  assert.equal(getPatientFinancialSummary(result.patients[0]).totalCollected, 1200);
});

test('normalised patient material uses the default fixed lab and removable orders use their separate default lab', () => {
  const fixed = create(domainFixture(), inputFixture({ material: 'زِيـركون' }));
  assert.equal(fixed.labCases[0].labId, 'lab-fixed');
  assert.equal(fixed.patients[0].sessions[0].amount, 4500);
  const removable = create(domainFixture(), inputFixture({ kind: 'removable', material: 'طقم كامل', units: 1, teethIds: [], expectedUnitPrice: 3000 }));
  assert.equal(removable.labCases[0].labId, 'lab-removable');
  assert.equal(removable.labCases[0].labServiceId, 'removable-default');
  assert.equal(removable.labCases[0].labTotal, 700);
  assert.equal(removable.patients[0].sessions[0].amount, 3000);
  assert.equal(removable.patients[0].sessions[0].prosthetic?.kind, 'removable');
});

test('material override resolves the exact lab and service IDs rather than the default lab or service display name', () => {
  const routing = routingFixture();
  routing.overrides.push({ kind: 'fixed', material: 'زِيـركون', labId: 'lab-special', labServiceId: 'special-service-id' });
  const result = create(domainFixture(), inputFixture(), routing);
  assert.equal(result.labCases[0].labId, 'lab-special');
  assert.equal(result.labCases[0].labServiceId, 'special-service-id');
  assert.equal(result.labCases[0].labTotal, 1275);
  assert.equal(result.patients[0].sessions[0].amount, 4500);
});

test('missing or ambiguous laboratory references fail without mutating any patient or ledger', () => {
  const invalid: { name: string; routing: ProstheticRoutingSettings; labs: Lab[] }[] = [
    { name: 'missing default', routing: { defaultLabs: {}, overrides: [] }, labs: labsFixture() },
    { name: 'missing lab', routing: { defaultLabs: { fixed: 'missing' }, overrides: [] }, labs: labsFixture() },
    { name: 'duplicate lab ID', routing: routingFixture(), labs: [...labsFixture(), structuredClone(labsFixture()[0])] },
    { name: 'missing material service', routing: routingFixture(), labs: labsFixture().map(lab => ({ ...lab, services: [] })) },
    { name: 'duplicate normalized service', routing: routingFixture(), labs: labsFixture().map(lab => lab.id === 'lab-fixed'
      ? { ...lab, services: [...lab.services, { ...lab.services[0], id: 'another', name: 'زِيـركون' }] } : lab) },
    { name: 'stale override service', routing: { defaultLabs: { fixed: 'lab-fixed' }, overrides: [{ kind: 'fixed', material: 'زيركون', labId: 'lab-special', labServiceId: 'missing' }] }, labs: labsFixture() },
    { name: 'wrong category override', routing: { defaultLabs: {}, overrides: [{ kind: 'fixed', material: 'زيركون', labId: 'lab-removable', labServiceId: 'removable-default' }] }, labs: labsFixture() },
    { name: 'duplicate override service ID', routing: { defaultLabs: {}, overrides: [{ kind: 'fixed', material: 'زيركون', labId: 'lab-special', labServiceId: 'special-service-id' }] }, labs: labsFixture().map(lab => lab.id === 'lab-special' ? { ...lab, services: [...lab.services, { ...lab.services[0] }] } : lab) },
  ];
  for (const sample of invalid) {
    const domain = domainFixture(), before = structuredClone(domain);
    assert.throws(() => create(domain, inputFixture(), sample.routing, sample.labs), sample.name);
    assert.deepEqual(domain, before, sample.name);
  }
});

test('selling price must be configured, unique and equal to the opened draft; explicit zero remains valid', () => {
  for (const crownPrices of [{}, { 'زيركون': 1600 }, { 'زيركون': Number.NaN }, { 'زيركون': 1500, 'زِيـركون': 1500 }]) {
    const domain = domainFixture(), before = structuredClone(domain);
    assert.throws(() => create(domain, inputFixture(), routingFixture(), labsFixture(), { ...catalogFixture(), crownPrices }));
    assert.deepEqual(domain, before);
  }
  const catalog = { ...catalogFixture(), crownPrices: { 'زيركون': 0 } };
  assert.equal(getPatientProstheticPrice('زيركون', catalog), 0);
  const result = create(domainFixture(), inputFixture({ expectedUnitPrice: 0 }), routingFixture(), labsFixture(), catalog);
  assert.equal(result.patients[0].sessions[0].amount, 0);
  assert.equal(result.labCases[0].labTotal, 900);
  assert.equal(result.labCases[0].labPaid, 0);
});

test('invalid lab cost fails without using the patient selling price as a substitute', () => {
  for (const price of [-1, Number.NaN, Number.POSITIVE_INFINITY, 1.001, 10_000_001]) {
    const labs = labsFixture();
    labs[0].services[0].price = price;
    const domain = domainFixture(), before = structuredClone(domain);
    assert.throws(() => create(domain, inputFixture(), routingFixture(), labs));
    assert.deepEqual(domain, before);
  }
});

test('fixed positions support exact permanent and primary IDs, enforce count and leave unknown positions explicitly empty', () => {
  for (const teethIds of [['ur1', 'ul8', 'lr4'], ['urA', 'ulE', 'llB']]) {
    const result = create(domainFixture(), inputFixture({ teethIds }));
    assert.deepEqual(result.patients[0].sessions[0].teethIds, teethIds);
    assert.deepEqual(result.labCases[0].teethIds, teethIds);
  }
  const single = create(domainFixture(), inputFixture({ teethIds: ['llE'], units: 1 }));
  assert.equal(single.patients[0].sessions[0].tooth, 'llE');
  assert.equal(single.patients[0].sessions[0].services?.[0].tooth, 'llE');
  const unassigned = create(domainFixture(), inputFixture({ teethIds: [] }));
  assert.equal(unassigned.patients[0].sessions[0].tooth, null);
  assert.equal(unassigned.patients[0].sessions[0].teethIds, undefined);
  for (const teethIds of [['ur1'], ['ur1', 'ur1', 'ur2'], ['ur0', 'ur2', 'ur3'], ['ur9', 'ur2', 'ur3'],
    ['ur1extra', 'ur2', 'ur3'], ['ur1.5', 'ur2', 'ur3'], ['ur01', 'ur2', 'ur3'], ['UR1', 'ur2', 'ur3'], ['ura', 'urB', 'urC'],
    ['urF', 'urB', 'urC'], ['primaryurA', 'urB', 'urC'], ['urA ', 'urB', 'urC']]) {
    assert.throws(() => validateProstheticOrder(inputFixture({ teethIds })), teethIds.join(','));
  }
});

test('counts, dates, identifiers, text and money reject invalid drafts before domain mutation', () => {
  const invalid: Partial<ProstheticOrderInput>[] = [
    { units: 0 }, { units: -1 }, { units: 1.5 }, { units: 101 }, { units: Number.NaN },
    { date: '2026-02-30' }, { date: '2026-10-1' }, { date: '' },
    { deliveryExpectedDate: '2026-10-09' }, { deliveryExpectedDate: '2026-13-10' },
    { operationId: '' }, { operationId: 'not-a-uuid' }, { patientId: '' }, { patientId: 'missing' },
    { material: '' }, { material: 'زيركون\u0000' }, { note: 'note\u0001' }, { note: 'x'.repeat(2001) },
    { expectedUnitPrice: -1 }, { expectedUnitPrice: 1500.001 }, { expectedUnitPrice: Number.NaN },
    { expectedUnitPrice: Number.POSITIVE_INFINITY }, { expectedUnitPrice: 10_000_001 },
    { examinationFee: -1 }, { examinationFee: 0.001 }, { examinationFee: Number.NaN },
    { paid: -1 }, { paid: 0.001 }, { paid: Number.POSITIVE_INFINITY }, { paid: 4500.01 },
  ];
  for (const changes of invalid) {
    const domain = domainFixture(), before = structuredClone(domain);
    assert.throws(() => create(domain, inputFixture(changes)), JSON.stringify(changes));
    assert.deepEqual(domain, before);
  }
  for (const field of ['units', 'expectedUnitPrice', 'examinationFee', 'paid'] as const) {
    assert.throws(() => create(domainFixture(), inputFixture({ [field]: '3' } as unknown as Partial<ProstheticOrderInput>)), field);
  }
});

test('currency multiplication rounds once to cents rather than introducing floating point debt', () => {
  const labs = labsFixture(); labs[0].services[0].price = 0.2;
  const result = create(domainFixture(), inputFixture({ expectedUnitPrice: 0.1, examinationFee: 0.2, paid: 0.5 }),
    routingFixture(), labs, { ...catalogFixture(), crownPrices: { 'زيركون': 0.1 } });
  const session = result.patients[0].sessions[0];
  assert.equal(session.treatmentFee, 0.3);
  assert.equal(session.amount, 0.5);
  assert.equal(session.remain, 0);
  assert.equal(result.labCases[0].labTotal, 0.6);
});

test('same operation retry is a reference-identical no-op even after selling prices and routing change', () => {
  const input = inputFixture({ paid: 500 });
  const result = create(domainFixture(), input);
  const retry = create(result, { ...input, teethIds: ['ur3', 'ur1', 'ur2'] }, { defaultLabs: {}, overrides: [] }, [], { ...catalogFixture(), crownPrices: {} });
  assert.equal(retry, result);
  assert.equal(retry.labCases.length, 1);
  assert.equal(retry.patients[0].sessions.length, 1);
  assert.equal(retry.patients[0].sessions[0].paymentsLog?.length, 1);
  assert.equal(retry.labCases[0].labTotal, 900);
  assert.deepEqual(retry.expenses, []);
});

test('reusing an operation ID for a changed payload is rejected without altering the first order', () => {
  const input = inputFixture(), result = create(domainFixture(), input), before = structuredClone(result);
  const changes: Partial<ProstheticOrderInput>[] = [
    { patientId: '402' }, { kind: 'removable' }, { material: 'PFM' }, { units: 2, teethIds: ['ur1', 'ur2'] },
    { teethIds: ['ul1', 'ur2', 'ur3'] }, { date: '2026-10-11' }, { expectedUnitPrice: 1600 },
    { examinationFee: 100 }, { paid: 1 }, { note: 'ملاحظة جديدة' }, { deliveryExpectedDate: '2026-10-20' },
  ];
  for (const change of changes) {
    assert.throws(() => create(result, { ...input, ...change }));
    assert.deepEqual(result, before);
  }
});

test('partial or conflicting order identity is rejected instead of creating a second patient charge', () => {
  const valid = create();
  const broken: { name: string; domain: ClinicDomainData }[] = [
    { name: 'only laboratory case', domain: { ...valid, patients: domainFixture().patients } },
    { name: 'only clinical session', domain: { ...valid, labCases: [] } },
    { name: 'missing creation fingerprint', domain: { ...valid, labCases: [{ ...valid.labCases[0], creationFingerprint: undefined }] } },
    { name: 'different linked session', domain: { ...valid, labCases: [{ ...valid.labCases[0], linkedSessionId: 'other' }] } },
    { name: 'different case patient', domain: { ...valid, labCases: [{ ...valid.labCases[0], patientId: '402' }] } },
    { name: 'duplicate session identity', domain: { ...valid, patients: [{ ...valid.patients[0], sessions: [...valid.patients[0].sessions, valid.patients[0].sessions[0]] }, valid.patients[1]] } },
    { name: 'session moved to another patient', domain: { ...valid, patients: [patient(), { ...patient('402'), sessions: valid.patients[0].sessions }] } },
    { name: 'another linked case', domain: { ...valid, labCases: [...valid.labCases, { ...valid.labCases[0], id: 'another-case' }] } },
    { name: 'duplicate case identity', domain: { ...valid, labCases: [...valid.labCases, { ...valid.labCases[0] }] } },
  ];
  for (const item of broken) {
    const before = structuredClone(item.domain);
    assert.throws(() => create(item.domain), item.name);
    assert.deepEqual(item.domain, before, item.name);
  }
});

test('later patient receipts update the linked account from its source session without paying the lab or duplicating charges', () => {
  const input = inputFixture({ examinationFee: 100, paid: 500 });
  const initial = create(domainFixture(), input), item = initial.labCases[0];
  const updated: ClinicDomainData = { ...initial, patients: addPatientReceipt(initial.patients, '401', sessionId,
    { id: 'later-explicit-receipt', amount: 1200, date: '2026-10-11', paymentMethod: 'cash' }) };
  const account = getLinkedPatientAccount(item, updated);
  assert.ok(account);
  assert.equal(account.total, 4600);
  assert.equal(account.paid, 1700);
  assert.equal(account.remaining, 2900);
  assert.equal(account.session, updated.patients[0].sessions[0]);
  assert.equal(item.patientPaid, 500, 'the private case snapshot is not a second patient receipt ledger');
  assert.equal(item.labPaid, 0);
  assert.equal(updated.labCases, initial.labCases);
  assert.equal(updated.expenses, initial.expenses);
  assert.equal(updated.patients[0].sessions.length, 1);
  assert.equal(create(updated, input), updated);
  assert.equal(getLinkedPatientAccount({ ...item, linkedSessionId: 'missing' }, updated), null);
  assert.equal(getLinkedPatientAccount({ ...item, patientId: 'missing' }, updated), null);
});

test('linked account uses exact cent totals and preserves imported fractional history rather than rounding it', () => {
  const result = create(), item = result.labCases[0], session = result.patients[0].sessions[0];
  Object.assign(session, { amount: 0.8, discount: 0.1, paid: 0.7, paymentsLog: [
    { id: 'test-cent-first', amount: 0.3, date: '2026-10-10' }, { id: 'test-cent-second', amount: 0.4, date: '2026-10-11' },
  ] });
  const before = structuredClone(result), account = getLinkedPatientAccount(item, result)!;
  assert.equal(account.total, 0.7);
  assert.equal(account.paid, 0.7);
  assert.equal(account.remaining, 0);
  assert.deepEqual(result, before);
  session.amount = 1.234; session.discount = 0.001;
  assert.equal(getLinkedPatientAccount(item, result)!.total, 1.234 - 0.001);
  assert.equal(session.amount, 1.234);
  assert.equal(session.discount, 0.001);
});

test('patient-side session and services never contain supplier identity, private laboratory cost or profit', () => {
  const result = create(), session = result.patients[0].sessions[0];
  const forbidden = ['lab', 'labId', 'labName', 'labServiceId', 'labTotal', 'labPaid', 'labCost', 'cost', 'profit', 'creationFingerprint'];
  const inspect = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    for (const [key, nested] of Object.entries(value)) {
      assert.equal(forbidden.includes(key), false, `private field ${key} in patient-facing record`);
      inspect(nested);
    }
  };
  inspect(session);
  const serialized = JSON.stringify(session);
  for (const lab of labsFixture()) {
    assert.equal(serialized.includes(lab.id), false);
    assert.equal(serialized.includes(lab.name), false);
  }
});
