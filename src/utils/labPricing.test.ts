import test from 'node:test';
import assert from 'node:assert/strict';
import type { Lab, LabService } from '../types';
import { cloneLab, createLabPricingDraft, snapshotLab, validateLabPricingDraft } from './labPricing';
import type { LabPricingDraftRow } from './labPricing';

const service = (overrides: Partial<LabService> = {}): LabService => ({
  id: 'service-1', category: 'fixed', name: 'PFM', unitLabel: 'طربوش', price: 750, ...overrides,
});
const lab = (overrides: Partial<Lab> = {}): Lab => ({
  id: 'lab-1', name: 'معمل أول', phone: '01000000000', address: 'القاهرة', notes: 'ملاحظات',
  services: [service()], ...overrides,
});
const row = (overrides: Partial<LabPricingDraftRow> = {}): LabPricingDraftRow => ({
  ...service(), price: '750', ...overrides,
});

test('drafts retain each lab service and numeric price without introducing defaults', () => {
  const source = lab({ services: [service({ price: 0 }), service({ id: 'service-2', name: 'زيركون', price: 123.45 })] });
  assert.deepEqual(createLabPricingDraft(source), [
    { ...source.services[0], price: '0' }, { ...source.services[1], price: '123.45' },
  ]);
  assert.deepEqual(createLabPricingDraft(lab({ services: [] })), []);
  const empty = validateLabPricingDraft([]);
  assert.equal(empty.valid, true);
  assert.deepEqual(empty.services, []);
  assert.deepEqual(empty.errors, {});
});

test('cloning labs and creating drafts isolate unknown nested service and metadata fields', () => {
  const source = {
    ...lab(),
    metadata: { contacts: [{ name: 'مسؤول', tags: ['قديم'] }] },
    services: [{ ...service(), legacyDetails: { materials: [{ label: 'خامة', codes: ['A'] }] } }],
  };
  const before = structuredClone(source);
  const copy = cloneLab(source) as typeof source;
  const draft = createLabPricingDraft(source) as Array<LabPricingDraftRow & { legacyDetails: typeof source.services[0]['legacyDetails'] }>;
  assert.deepEqual(copy, source);
  assert.notEqual(copy, source);
  assert.notEqual(copy.services, source.services);
  assert.notEqual(copy.services[0].legacyDetails, source.services[0].legacyDetails);
  assert.notEqual(draft[0].legacyDetails, source.services[0].legacyDetails);
  copy.metadata.contacts[0].tags.push('نسخة');
  copy.services[0].legacyDetails.materials[0].codes.push('B');
  draft[0].legacyDetails.materials[0].codes.push('C');
  draft[0].price = '950';
  assert.deepEqual(source, before);
  assert.deepEqual(copy.services[0].legacyDetails.materials[0].codes, ['A', 'B']);
  assert.deepEqual(draft[0].legacyDetails.materials[0].codes, ['A', 'C']);
});

test('baseline service fields survive by id while edited labels and new labels are trimmed', () => {
  const baseline = [
    { ...service({ name: '  PFM   قديم  ', unitLabel: '  طربوش  ' }), legacyDetails: { material: ['A'], nested: { revision: 1 } } },
    { ...service({ id: 'service-2', name: 'خدمة محذوفة' }), legacyDetails: { material: ['B'], nested: { revision: 2 } } },
  ];
  const input = [
    row({ name: baseline[0].name, unitLabel: baseline[0].unitLabel, price: '900' }),
    row({ id: 'new-service', name: '  خدمة جديدة  ', category: 'other', unitLabel: '  وحدة  ', price: '٠' }),
  ];
  const beforeInput = structuredClone(input);
  const beforeBaseline = structuredClone(baseline);
  const result = validateLabPricingDraft(input, baseline);
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, {});
  assert.deepEqual(result.services, [
    { ...baseline[0], price: 900 },
    service({ id: 'new-service', name: 'خدمة جديدة', category: 'other', unitLabel: 'وحدة', price: 0 }),
  ]);
  const retained = result.services[0] as typeof baseline[0];
  retained.legacyDetails.material.push('نسخة');
  retained.legacyDetails.nested.revision = 99;
  assert.deepEqual(input, beforeInput);
  assert.deepEqual(baseline, beforeBaseline);

  const renamed = validateLabPricingDraft([row({ name: '  اسم معدل  ', unitLabel: '  طقم  ', category: 'removable', price: '800' })], baseline);
  assert.equal(renamed.valid, true);
  assert.equal(renamed.services[0].name, 'اسم معدل');
  assert.equal(renamed.services[0].unitLabel, 'طقم');
  assert.equal(renamed.services[0].category, 'removable');
  assert.deepEqual((renamed.services[0] as typeof baseline[0]).legacyDetails, baseline[0].legacyDetails);
});

test('adding, editing, deleting and reordering services preserve ids and do not mutate inputs', () => {
  const source = lab({ services: [
    service(), service({ id: 'delete', name: 'حافظ مسافة', category: 'other' }),
    service({ id: 'keep', name: 'طقم كامل', category: 'removable', unitLabel: 'طقم', price: 1100 }),
  ] });
  const before = structuredClone(source);
  const draft = createLabPricingDraft(source);
  draft[0] = { ...draft[0], name: 'PFM معدل', price: '975.50' };
  const submitted = [draft[2], draft[0], row({ id: 'new', name: 'نصف طقم', category: 'removable', unitLabel: 'طقم', price: '450' })];
  const submittedBefore = structuredClone(submitted);
  const result = validateLabPricingDraft(submitted, source.services);
  assert.equal(result.valid, true);
  assert.deepEqual(result.services.map(item => item.id), ['keep', 'service-1', 'new']);
  assert.equal(result.services[1].name, 'PFM معدل');
  assert.equal(result.services[1].price, 975.5);
  assert.equal(result.services[2].price, 450);
  assert.deepEqual(source, before);
  assert.deepEqual(submitted, submittedBefore);
  assert.deepEqual(validateLabPricingDraft([], source.services).services, []);
});

test('validated services belong only to the selected lab and leave historical amounts and labels unchanged', () => {
  const labs = [lab(), lab({ id: 'lab-2', name: 'معمل ثان', services: [service({ name: 'PFM آخر', price: 400 })] })];
  const historicalCases = [{ labId: 'lab-1', labName: labs[0].name, subType: 'PFM', unitLabel: 'طربوش', units: 2, labTotal: 1500, labPaid: 500, patientTotal: 3000 }];
  const historicalSessions = [{ amount: 3000, paid: 2000, services: [{ name: 'PFM', price: 1500, units: 2 }] }];
  const before = structuredClone({ labs, historicalCases, historicalSessions });
  const draft = createLabPricingDraft(labs[0]);
  draft[0].price = '1250';
  draft[0].name = 'PFM جديد';
  const checked = validateLabPricingDraft(draft, labs[0].services);
  assert.equal(checked.valid, true);
  const updatedLabs = labs.map(item => item.id === labs[0].id ? { ...cloneLab(item), services: checked.services } : item);
  assert.equal(updatedLabs[0].services[0].price, 1250);
  assert.equal(updatedLabs[0].services[0].name, 'PFM جديد');
  assert.deepEqual(updatedLabs[1], before.labs[1]);
  assert.deepEqual({ labs, historicalCases, historicalSessions }, before);
  updatedLabs[0].services[0].price = 0;
  assert.equal(labs[0].services[0].price, 750);
  assert.equal(labs[1].services[0].price, 400);
});

test('prices accept zero, Arabic and Persian decimals, and the inclusive maximum', () => {
  for (const [input, expected] of [['0', 0], ['٠', 0], ['۰', 0], [' ١٢٣٫٤٥ ', 123.45], ['۱۲۳.۴۵', 123.45], ['0005.20', 5.2], ['10000000', 10_000_000]] as const) {
    const result = validateLabPricingDraft([row({ price: input })]);
    assert.equal(result.valid, true, input);
    assert.equal(result.services[0].price, expected, input);
    assert.deepEqual(result.errors, {}, input);
  }
});

test('prices require an explicit complete nonnegative decimal without coercion or silent fallback', () => {
  for (const input of ['', ' ', '-1', '-0.1', 'Infinity', 'NaN', '1e3', '0x10', '+10', '1,000', '١٬٠٠٠', '1.234', '.5', '1.', '10000000.01', '\n10', '10\u2028', undefined, null, {}, false]) {
    const inputRow = row({ price: input as any });
    const before = structuredClone(inputRow);
    const result = validateLabPricingDraft([inputRow]);
    assert.equal(result.valid, false, String(input));
    assert.ok(Object.keys(result.errors).length, String(input));
    assert.deepEqual(inputRow, before);
  }
});

test('service names reject missing, oversized, multiline and control input', () => {
  for (const name of ['', '   ', 'ـَ', 'اسم\nخدمة', '\tاسم', 'اسم\u0085', 'اسم\u2028ثان', 'اسم\u2029ثان', '🦷'.repeat(81), null, 5]) {
    const result = validateLabPricingDraft([row({ name: name as any })]);
    assert.equal(result.valid, false, String(name));
    assert.ok(Object.keys(result.errors).length, String(name));
  }
  assert.equal(validateLabPricingDraft([row({ name: '🦷'.repeat(80) })]).valid, true);
});

test('normalized duplicate names are detected across Arabic marks, spacing, case and digit variants', () => {
  for (const [first, second] of [['إِزالة   جير', 'ازالة جير'], ['PFM ١', 'pfm ۱'], ['حافظ عَلى', 'حافظ علی']] as const) {
    const result = validateLabPricingDraft([row({ name: first }), row({ id: 'service-2', name: second })]);
    assert.equal(result.valid, false, `${first} / ${second}`);
    assert.ok(Object.keys(result.errors).length);
  }
  assert.equal(validateLabPricingDraft([row({ name: 'PFM' }), row({ id: 'service-2', name: 'PFM جديد' })]).valid, true);
});

test('unit labels require one nonempty line of at most forty characters', () => {
  for (const unitLabel of ['', '   ', 'وحدة\nطقم', '\tوحدة', 'وحدة\u0085', 'وحدة\u2028طقم', 'وحدة\u2029طقم', '🦷'.repeat(41), null, 5]) {
    const result = validateLabPricingDraft([row({ unitLabel: unitLabel as any })]);
    assert.equal(result.valid, false, String(unitLabel));
    assert.ok(Object.keys(result.errors).length, String(unitLabel));
  }
  assert.equal(validateLabPricingDraft([row({ unitLabel: '🦷'.repeat(40) })]).valid, true);
});

test('categories are limited to fixed, removable and other and ids must be present and unique', () => {
  for (const category of ['fixed', 'removable', 'other'] as const) {
    const result = validateLabPricingDraft([row({ category })]);
    assert.equal(result.valid, true, category);
    assert.equal(result.services[0].category, category);
  }
  for (const category of ['', 'Fixed', 'clinical', null, undefined]) {
    const result = validateLabPricingDraft([row({ category: category as any })]);
    assert.equal(result.valid, false, String(category));
    assert.ok(Object.keys(result.errors).length);
  }
  for (const id of ['', '   ', null, undefined, 5]) {
    const result = validateLabPricingDraft([row({ id: id as any })]);
    assert.equal(result.valid, false, String(id));
    assert.ok(Object.keys(result.errors).length);
  }
  const duplicate = validateLabPricingDraft([row(), row({ name: 'خدمة ثانية' })]);
  assert.equal(duplicate.valid, false);
  assert.ok(Object.keys(duplicate.errors).length);
});

test('snapshots remain stable for clones and detect stale metadata, nested fields and service changes', () => {
  const source = { ...lab(), metadata: { revision: 1 }, services: [{ ...service(), legacyDetails: { code: 'old' } }] };
  const initialSnapshot = snapshotLab(source);
  assert.equal(initialSnapshot, JSON.stringify(source));
  assert.equal(snapshotLab(cloneLab(source)), initialSnapshot);
  for (const field of ['name', 'phone', 'address', 'notes'] as const) {
    const changed = cloneLab(source);
    changed[field] = `${changed[field]} معدل`;
    assert.notEqual(snapshotLab(changed), initialSnapshot, field);
  }
  const changedMetadata = cloneLab(source) as typeof source;
  changedMetadata.metadata.revision = 2;
  assert.notEqual(snapshotLab(changedMetadata), initialSnapshot);
  const changedNestedService = cloneLab(source) as typeof source;
  changedNestedService.services[0].legacyDetails.code = 'new';
  assert.notEqual(snapshotLab(changedNestedService), initialSnapshot);
  const changedPrice = cloneLab(source);
  changedPrice.services[0].price = 900;
  assert.notEqual(snapshotLab(changedPrice), initialSnapshot);
  const deletedService = cloneLab(source);
  deletedService.services = [];
  assert.notEqual(snapshotLab(deletedService), initialSnapshot);
  const addedService = cloneLab(source);
  addedService.services.push(service({ id: 'service-2', name: 'خدمة جديدة' }));
  assert.notEqual(snapshotLab(addedService), initialSnapshot);
  assert.equal(snapshotLab(source), initialSnapshot);
});
