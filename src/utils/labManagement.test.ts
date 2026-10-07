import test from 'node:test';
import assert from 'node:assert/strict';
import type { Lab, LabCase, LabService, Patient } from '../types';
import { cloneLab } from './labPricing';
import { assertLabCaseSessionLink, mergeLabCaseWorkflowUpdate, prepareLabMetadataSave, prepareLabPricingSave } from './labManagement';

const service = (price = 400): LabService => ({ id: 'pfm', category: 'fixed', name: 'PFM', unitLabel: 'طربوش', price });
const makeLabs = (): Lab[] => [
  { id: 'lab-a', name: 'معمل أول', phone: '01000', address: 'القاهرة', notes: 'ملاحظة', services: [service()], extra: { options: ['keep'] } },
  { id: 'lab-b', name: 'معمل ثان', services: [service(650)], extra: { options: ['second'] } },
] as unknown as Lab[];

test('locked case linking rejects a second case for the same patient session', () => {
  const patients = [{ id: '401', sessions: [{ id: 'session-1' }, { id: 'session-2' }] }, { id: '402', sessions: [{ id: 'session-1' }] }] as Patient[];
  const existing = [{ id: 'case-1', patientId: '401', linkedSessionId: 'session-1' }] as LabCase[];
  const snapshot = structuredClone({ patients, existing });
  assert.throws(() => assertLabCaseSessionLink(existing, patients, { id: 'case-2', patientId: '401', linkedSessionId: 'session-1' }), /مرتبطة بالفعل/);
  assert.throws(() => assertLabCaseSessionLink(existing, patients, { id: 'case-2', patientId: '401', linkedSessionId: 'missing' }), /لم تعد موجودة/);
  assert.throws(() => assertLabCaseSessionLink(existing, patients, { id: 'case-2', patientId: 'missing' }), /لم يعد موجودًا/);
  assert.doesNotThrow(() => assertLabCaseSessionLink(existing, patients, existing[0]));
  assert.doesNotThrow(() => assertLabCaseSessionLink(existing, patients, { id: 'case-2', patientId: '401', linkedSessionId: 'session-2' }));
  assert.doesNotThrow(() => assertLabCaseSessionLink(existing, patients, { id: 'case-2', patientId: '402', linkedSessionId: 'session-1' }));
  assert.doesNotThrow(() => assertLabCaseSessionLink(existing, patients, { id: 'case-2', patientId: '401' }));
  assert.deepEqual({ patients, existing }, snapshot);
});

test('pricing updates only the selected supplier and allows concurrent changes to other suppliers', () => {
  const latest = makeLabs();
  const baseline = cloneLab(latest[0]);
  latest[1].name = 'معمل ثان محدث';
  latest[1].services[0].price = 725;
  const before = structuredClone(latest);
  const result = prepareLabPricingSave(latest, 'lab-a', [service(500)], baseline);
  assert.equal(result[0].services[0].price, 500);
  assert.deepEqual(result[1], latest[1]);
  assert.deepEqual(latest, before);
  assert.notEqual(result[1], latest[1]);
  assert.notEqual(result[1].services, latest[1].services);
  (result[1] as any).extra.options.push('changed');
  assert.deepEqual((latest[1] as any).extra.options, ['second']);
});

test('pricing rejects any stale selected supplier, missing supplier or unrelated baseline', () => {
  for (const mutate of [
    (lab: Lab) => { lab.name = 'تغيير'; },
    (lab: Lab) => { lab.services[0].price = 1; },
    (lab: Lab) => { (lab as any).extra.options.push('latest'); },
  ]) {
    const latest = makeLabs();
    const baseline = cloneLab(latest[0]);
    mutate(latest[0]);
    assert.throws(() => prepareLabPricingSave(latest, 'lab-a', [service(500)], baseline), /تغيّرت/);
  }
  const latest = makeLabs();
  assert.throws(() => prepareLabPricingSave(latest, 'missing', [service()], latest[0]), /غير موجود/);
  assert.throws(() => prepareLabPricingSave(latest, 'lab-a', [service()], latest[1]), /تغيّرت/);
  assert.throws(() => prepareLabPricingSave([...latest, cloneLab(latest[0])], 'lab-a', [service()], latest[0]), /مكرر/);
});

test('pricing preserves zero, validates parent input and retains unknown service metadata', () => {
  const latest = makeLabs();
  (latest[0].services[0] as any).vendor = { codes: ['original'] };
  const supplied = [service(0)];
  const result = prepareLabPricingSave(latest, 'lab-a', supplied, cloneLab(latest[0]));
  assert.equal(result[0].services[0].price, 0);
  assert.deepEqual((result[0].services[0] as any).vendor, { codes: ['original'] });
  (result[0].services[0] as any).vendor.codes.push('changed');
  assert.deepEqual((latest[0].services[0] as any).vendor.codes, ['original']);
  assert.equal(supplied[0].price, 0);
  for (const bad of [-1, Infinity, NaN, 1.001, 10_000_000.01]) {
    assert.throws(() => prepareLabPricingSave(latest, 'lab-a', [service(bad)], cloneLab(latest[0])));
  }
  assert.throws(() => prepareLabPricingSave(latest, 'lab-a', [{ ...service(), name: '' }], cloneLab(latest[0])));
  assert.throws(() => prepareLabPricingSave(latest, 'lab-a', [service(), { ...service(), id: 'second' }], cloneLab(latest[0])), /موجود/);
  assert.throws(() => prepareLabPricingSave(latest, 'lab-a', null as any, cloneLab(latest[0])), /غير صحيحة/);
});

test('pricing add and removal do not mutate historical totals or patient selling prices', () => {
  const latest = makeLabs();
  const historicalCase = { labId: 'lab-a', labTotal: 800, labPaid: 200, patientTotal: 2400, units: 2, subType: 'PFM' };
  const sellingPrices = { PFM: 1200 };
  const result = prepareLabPricingSave(latest, 'lab-a', [{ ...service(0), id: 'custom', name: 'زيركون' }], cloneLab(latest[0]));
  assert.deepEqual(result[0].services.map(entry => entry.id), ['custom']);
  assert.deepEqual(latest[0].services.map(entry => entry.id), ['pfm']);
  assert.deepEqual(historicalCase, { labId: 'lab-a', labTotal: 800, labPaid: 200, patientTotal: 2400, units: 2, subType: 'PFM' });
  assert.deepEqual(sellingPrices, { PFM: 1200 });
  assert.deepEqual(prepareLabPricingSave(latest, 'lab-a', [], cloneLab(latest[0]))[0].services, []);
});

test('metadata updates only permitted fields, preserving canonical services and unknown fields', () => {
  const latest = makeLabs();
  const baseline = cloneLab(latest[0]);
  const draft = { ...cloneLab(latest[0]), name: '  معمل محدّث  ', phone: ' 01111 ', address: ' عنوان ', notes: ' سطر أول\r\nسطر ثان ', services: [service(9999)], extra: { options: ['do not copy'] } };
  latest[1].phone = 'concurrent update';
  const result = prepareLabMetadataSave(latest, draft, baseline);
  assert.equal(result[0].name, 'معمل محدّث');
  assert.equal(result[0].phone, '01111');
  assert.equal(result[0].address, 'عنوان');
  assert.equal(result[0].notes, 'سطر أول\r\nسطر ثان');
  assert.deepEqual(result[0].services, latest[0].services);
  assert.deepEqual((result[0] as any).extra, { options: ['keep'] });
  assert.deepEqual(result[1], latest[1]);
  assert.notEqual(result[0].services, latest[0].services);
  assert.equal(latest[0].name, baseline.name);
  assert.equal(draft.services[0].price, 9999);
});

test('metadata editing requires a current matching baseline even if only costs changed', () => {
  const latest = makeLabs();
  const baseline = cloneLab(latest[0]);
  latest[0].services[0].price = 500;
  assert.throws(() => prepareLabMetadataSave(latest, { ...baseline, name: 'new' }, baseline), /تغيّرت/);
  assert.throws(() => prepareLabMetadataSave(latest, latest[0]), /تغيّرت/);
  assert.throws(() => prepareLabMetadataSave(latest, { ...baseline, id: 'missing' }, baseline), /غير موجود/);
});

test('new suppliers have empty service lists and never inherit caller costs or metadata extras', () => {
  const latest = makeLabs();
  const result = prepareLabMetadataSave(latest, { name: ' معمل جديد ', services: [service(700)], extra: { leak: true } } as any, undefined, 'lab-new');
  assert.deepEqual(result[2], { id: 'lab-new', name: 'معمل جديد', phone: undefined, address: undefined, notes: undefined, services: [] });
  assert.equal(latest.length, 2);
  assert.notEqual(result[0].services, latest[0].services);
  assert.throws(() => prepareLabMetadataSave(latest, { name: 'جديد', services: [] }), /معرّف/);
  for (const id of ['', ' ', ' lab-new', 'lab-new\n', 'lab-a']) {
    assert.throws(() => prepareLabMetadataSave(latest, { name: 'جديد', services: [] }, undefined, id), /معرّف/);
  }
});

test('normalized supplier names cannot duplicate another supplier', () => {
  const latest = makeLabs();
  for (const name of ['معمل أَوّل', '  معمل   أول  ', 'معمل اوّل']) {
    assert.throws(() => prepareLabMetadataSave(latest, { name, services: [] }, undefined, 'new'), /موجود/);
    assert.throws(() => prepareLabMetadataSave(latest, { ...latest[1], name }, cloneLab(latest[1])), /موجود/);
  }
  assert.equal(prepareLabMetadataSave(latest, { ...latest[0], name: ' معمل أول ' }, cloneLab(latest[0]))[0].name, 'معمل أول');
});

test('metadata validates required names, lengths and single-line fields without dropping invalid controls', () => {
  const latest = makeLabs();
  const draft = { name: 'معمل جديد', services: [] };
  for (const name of ['', ' ', 'ـَ', '\tمعمل', 'معمل\nجديد', 'معمل\u2028جديد', 'x'.repeat(101), 5, null]) {
    assert.throws(() => prepareLabMetadataSave(latest, { ...draft, name } as any, undefined, 'new'));
  }
  for (const [field, value] of [
    ['phone', 'x'.repeat(41)], ['address', 'x'.repeat(201)], ['notes', 'x'.repeat(1001)],
    ['phone', '\n010'], ['address', 'first\nsecond'], ['notes', 'first\tsecond'], ['notes', 'x\u0000y'],
    ['phone', null], ['address', 5],
  ]) {
    assert.throws(() => prepareLabMetadataSave(latest, { ...draft, [field]: value } as any, undefined, 'new'));
  }
  const accepted = prepareLabMetadataSave(latest, {
    name: '🦷'.repeat(100), phone: 'x'.repeat(40), address: 'x'.repeat(200), notes: 'x'.repeat(1000), services: [],
  }, undefined, 'new');
  assert.equal(Array.from(accepted[2].name).length, 100);
});

test('failed metadata and pricing preparations leave all inputs unchanged', () => {
  const latest = makeLabs();
  const before = structuredClone(latest);
  const baseline = cloneLab(latest[0]);
  const draft = { ...cloneLab(latest[0]), name: 'معمل ثان' };
  assert.throws(() => prepareLabMetadataSave(latest, draft, baseline));
  assert.throws(() => prepareLabPricingSave(latest, 'lab-a', [service(-1)], baseline));
  assert.deepEqual(latest, before);
  assert.deepEqual(baseline, before[0]);
  assert.equal(draft.name, 'معمل ثان');
});

function makeCase(): LabCase {
  return {
    id: 'case-1', linkedSessionId: 'old-session', labId: 'lab-a', labName: 'معمل أول',
    patientId: 'patient-1', patientName: 'مريض', fileNo: '401', type: 'تركيبات - ثابتة', subType: 'PFM',
    units: 2, unitLabel: 'طربوش', labTotal: 800, labPaid: 600, patientTotal: 2400, patientPaid: 1500,
    date: '2026-10-01', deliveryExpectedDate: '2026-10-07', note: 'ملاحظة حالية', status: 'pending',
    paymentsLog: [{ id: 'payment-1', date: '2026-10-05', amount: 600, note: 'أحدث دفعة' }],
    reservation: { reserved: 800, history: [{ amount: 600, note: 'محفوظ' }] },
    extra: { nested: ['unknown latest metadata'] },
  } as unknown as LabCase;
}

test('workflow updates change only status and link, retaining current totals, payments and metadata', () => {
  const current = makeCase();
  const incoming = { ...structuredClone(current), status: 'ready', linkedSessionId: 'new-session', labPaid: 0,
    paymentsLog: [], labTotal: 5, patientTotal: 7, patientPaid: 0, labName: 'قديم', note: 'قديم',
    reservation: { reserved: 0 }, extra: { nested: ['stale'] } } as unknown as LabCase;
  const beforeCurrent = structuredClone(current);
  const beforeIncoming = structuredClone(incoming);
  const result = mergeLabCaseWorkflowUpdate(current, incoming);
  assert.deepEqual(result, { ...beforeCurrent, status: 'ready', linkedSessionId: 'new-session' });
  assert.equal(result.labPaid, 600);
  assert.deepEqual(result.paymentsLog, beforeCurrent.paymentsLog);
  assert.deepEqual((result as any).reservation, (beforeCurrent as any).reservation);
  assert.deepEqual((result as any).extra, (beforeCurrent as any).extra);
  assert.deepEqual(current, beforeCurrent);
  assert.deepEqual(incoming, beforeIncoming);
});

test('workflow result has no nested aliases to financial and reservation snapshots', () => {
  const current = makeCase();
  const result = mergeLabCaseWorkflowUpdate(current, { ...current, status: 'delivered' });
  assert.notEqual(result.paymentsLog, current.paymentsLog);
  result.paymentsLog![0].amount = 1;
  (result as any).reservation.history[0].amount = 1;
  (result as any).extra.nested.push('changed');
  assert.equal(current.paymentsLog![0].amount, 600);
  assert.equal((current as any).reservation.history[0].amount, 600);
  assert.deepEqual((current as any).extra.nested, ['unknown latest metadata']);
});

test('workflow unlink is explicit and mismatched case IDs are rejected without mutation', () => {
  const current = makeCase();
  const before = structuredClone(current);
  const result = mergeLabCaseWorkflowUpdate(current, { ...current, linkedSessionId: undefined, status: 'completed' });
  assert.equal(result.linkedSessionId, undefined);
  assert.equal(result.status, 'completed');
  assert.equal(result.labPaid, before.labPaid);
  assert.throws(() => mergeLabCaseWorkflowUpdate(current, { ...current, id: 'another' }), /معرّف/);
  assert.deepEqual(current, before);
});
