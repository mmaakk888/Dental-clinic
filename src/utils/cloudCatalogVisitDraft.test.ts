import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { CloudCatalogVisitDraftError, createCloudCatalogVisitDraft, type CloudCatalogVisitMetadata } from './cloudCatalogVisitDraft';
import { createCloudClinicalRepository, MAX_CLOUD_CLINICAL_CENTS, type CloudClinicalAdapter,
  type CloudClinicalCommand } from './cloudClinicalRepository';
import { createCloudOperationIntentRepository, type CloudIntentAdapter } from './cloudOperationIntent';
import type { CloudServiceCatalogRecord } from './cloudServiceCatalogRepository';

// Fabricated catalog and patient only. The map adapter tests pure contracts,
// not Firebase, deployed Rules, real records, billing or UI rendering.
const id = (value: number) => `90000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const SERVICE = id(1), UNKNOWN = id(2), PROSTHETIC = id(3), INACTIVE = id(4), ZERO = id(5);
const PATIENT = id(100), OPERATION = id(101), OWNER = 'synthetic-catalog-draft-owner';
const DATE = '2026-10-11', WHEN = `${DATE}T00:00:00.000Z`;
const metadata = (overrides: Partial<CloudCatalogVisitMetadata> = {}): CloudCatalogVisitMetadata => ({
  date: DATE, notes: '', treatmentStage: 'single', rootCanalStatus: '', visitStatus: 'completed', ...overrides,
});
function catalog(overrides: Partial<CloudServiceCatalogRecord['data']> = {}): CloudServiceCatalogRecord {
  return { schemaVersion: 1, clinicId: 'main', recordId: 'serviceCatalog', revision: 7, lastOperationId: id(90),
    data: { examinationCents: 10_000, services: [
      { serviceId: SERVICE, name: 'حشو عادي', kind: 'clinical', priceCents: 30_000, active: true },
      { serviceId: UNKNOWN, name: 'خدمة بسعر يحدد يدويًا', kind: 'clinical', priceCents: null, active: true },
      { serviceId: PROSTHETIC, name: 'اسم عادي لا يكشف نوعه', kind: 'prosthetic', priceCents: 80_000, active: true },
      { serviceId: INACTIVE, name: 'خدمة موقوفة', kind: 'clinical', priceCents: 20_000, active: false },
      { serviceId: ZERO, name: 'متابعة بدون تكلفة', kind: 'clinical', priceCents: 0, active: true },
    ], ...overrides } };
}
function draft(record: unknown = catalog()) {
  let count = 0;
  const controller = createCloudCatalogVisitDraft(record, { newId: () => id(1000 + ++count) });
  return { controller, idCalls: () => count };
}
function invalid(work: () => unknown) {
  assert.throws(work, error => error instanceof CloudCatalogVisitDraftError
    && error.message === 'راجع الخدمة المختارة والسعر والأسنان وبيانات الزيارة قبل الحفظ.');
}
function clinicalHarness() {
  const docs = new Map<string, unknown>(), calls: string[] = [];
  docs.set(`clinics/main/patientProfiles/${PATIENT}`, { schemaVersion: 1, clinicId: 'main', recordId: PATIENT,
    fileNo: 451, revision: 1, lastOperationId: id(99), phoneKey: null,
    data: { name: 'مريض اختبار مصطنع', mobile: '', age: 30, gender: '', firstVisit: DATE, notes: '', allergy: '' } });
  docs.set('clinics/main/patientFiles/451', { schemaVersion: 1, clinicId: 'main', recordId: PATIENT, fileNo: 451 });
  const adapter: CloudClinicalAdapter & CloudIntentAdapter = {
    authorizeOwner: async () => OWNER,
    readRecord: async path => { calls.push(`read:${path}`); return structuredClone(docs.get(path) ?? null); },
    runTransaction: async work => {
      calls.push('transaction'); const staged = new Map(docs), writes = new Map<string, object>(); let writing = false;
      const result = await work({
        get: async path => { assert.equal(writing, false); return structuredClone(staged.get(path) ?? null); },
        set: (path, value) => { writing = true; writes.set(path, structuredClone(value)); },
      });
      for (const [path, value] of writes) docs.set(path, value);
      return result;
    },
  };
  const digest = async (value: string) => createHash('sha256').update(value).digest('hex');
  const journal = createCloudOperationIntentRepository(adapter, { digest });
  const clinical = createCloudClinicalRepository(adapter, { digest });
  return { docs, calls, journal, clinical };
}

test('catalog draft starts empty with captured fee and no automatic exam, charge, ID or save', () => {
  const h = draft(), state = h.controller.getState();
  assert.deepEqual(state, { catalogRevision: 7, services: [], teethIds: [], examinationEnabled: false,
    examinationCents: 10_000, dirty: false });
  assert.equal(h.idCalls(), 0);
  invalid(() => h.controller.buildSession(metadata()));
  assert.equal(h.idCalls(), 0);
});
test('one deliberate selection appends one row immediately; repeated services get independent IDs', () => {
  const h = draft(), first = h.controller.chooseService(SERVICE), firstState = h.controller.getState();
  assert.equal(firstState.services.length, 1);
  assert.deepEqual(firstState.services[0], { id: first, catalogServiceId: SERVICE, name: 'حشو عادي', priceCents: 30_000, tooth: null });
  assert.equal(firstState.dirty, true);
  const second = h.controller.chooseService(SERVICE);
  assert.notEqual(second, first);
  assert.equal(h.controller.getState().services.length, 2);
  assert.equal(firstState.services.length, 1);
  assert.equal(h.idCalls(), 2);
});
test('unknown configured prices stay null and block building until an explicit amount including zero is entered', () => {
  const h = draft(), row = h.controller.chooseService(UNKNOWN);
  assert.equal(h.controller.getState().services[0].priceCents, null);
  invalid(() => h.controller.buildSession(metadata()));
  h.controller.setServicePrice(row, 0);
  assert.equal(h.controller.buildSession(metadata()).services[0].priceCents, 0);
  h.controller.setServicePrice(row, null);
  invalid(() => h.controller.buildSession(metadata()));
});
test('an explicitly configured zero is retained without substituting a default', () => {
  const h = draft(); h.controller.chooseService(ZERO);
  const data = h.controller.buildSession(metadata());
  assert.equal(data.services[0].priceCents, 0);
  assert.equal(data.examinationCents, 0);
});
test('price overrides in either direction change only this row, not another row or the source catalog', () => {
  const input = catalog(), h = draft(input), first = h.controller.chooseService(SERVICE), second = h.controller.chooseService(SERVICE);
  h.controller.setServicePrice(first, 15_000);
  h.controller.setServicePrice(second, 40_000);
  assert.deepEqual(h.controller.buildSession(metadata()).services.map(row => row.priceCents), [15_000, 40_000]);
  assert.equal(input.data.services[0].priceCents, 30_000);
  assert.equal(h.controller.getCatalog().data.services[0].priceCents, 30_000);
});
test('catalog snapshot and returned state are recursively immutable and independent of later input changes', () => {
  const input = catalog(), h = draft(input); h.controller.chooseService(SERVICE);
  input.data.services[0].name = 'changed'; input.data.services[0].priceCents = 0;
  input.data.examinationCents = 999;
  assert.equal(h.controller.getState().examinationCents, 10_000);
  assert.equal(h.controller.getState().services[0].name, 'حشو عادي');
  for (const value of [h.controller.getState(), h.controller.getState().services, h.controller.getState().services[0],
    h.controller.getState().teethIds, h.controller.getCatalog(), h.controller.getCatalog().data, h.controller.getCatalog().data.services]) {
    assert.equal(Object.isFrozen(value), true);
  }
  assert.throws(() => { (h.controller.getState().services as any[]).push({}); });
});
test('explicit source kind blocks prosthetics even under an ordinary name; inactive and unknown IDs cannot append', () => {
  const h = draft();
  for (const value of [PROSTHETIC, INACTIVE, id(999), '', '1', 'ABCDEF00-0000-4000-8000-000000000001']) invalid(() => h.controller.chooseService(value));
  assert.equal(h.controller.getState().services.length, 0);
  assert.equal(h.idCalls(), 0);
});
test('Arabic labels never grant kind eligibility or bypass the full clinical parser', () => {
  const input = catalog(); input.data.services[0].name = 'تركيب غير صالح للمسار العلاجي';
  const h = draft(input); h.controller.chooseService(SERVICE);
  invalid(() => h.controller.buildSession(metadata()));
});
test('exam is opt-in with the exact catalog amount and does not modify selected services', () => {
  const h = draft(); h.controller.chooseService(SERVICE);
  assert.equal(h.controller.buildSession(metadata()).examinationCents, 0);
  h.controller.setExaminationEnabled(true);
  assert.equal(h.controller.buildSession(metadata()).examinationCents, 10_000);
  h.controller.setExaminationEnabled(false);
  assert.equal(h.controller.buildSession(metadata()).examinationCents, 0);
  assert.equal(h.controller.getState().services.length, 1);
  invalid(() => h.controller.setExaminationEnabled(1 as any));
});
test('exam-only visits use configured fee; zero exam alone cannot invent a clinical charge or service', () => {
  const h = draft(); h.controller.setExaminationEnabled(true);
  assert.deepEqual(h.controller.buildSession(metadata()).services, []);
  assert.equal(h.controller.buildSession(metadata()).type, 'كشف');
  const zero = draft(catalog({ examinationCents: 0 })); zero.controller.setExaminationEnabled(true);
  assert.equal(zero.controller.getState().examinationCents, 0);
  invalid(() => zero.controller.buildSession(metadata()));
});
test('canonical adult and primary teeth are retained; service assignment adds its tooth once', () => {
  const h = draft(), row = h.controller.chooseService(SERVICE);
  h.controller.setServiceTooth(row, 'ur5'); h.controller.setServiceTooth(row, 'ur5');
  assert.deepEqual(h.controller.getState().teethIds, ['ur5']);
  h.controller.setServiceTooth(row, 'llA');
  assert.deepEqual(h.controller.getState().teethIds, ['ur5', 'llA']);
  const data = h.controller.buildSession(metadata());
  assert.equal(data.services[0].tooth, 'llA');
  assert.deepEqual(data.teethIds, ['ur5', 'llA']);
});
test('tooth board cannot silently detach an assigned service; explicit clearing permits removal', () => {
  const h = draft(), row = h.controller.chooseService(SERVICE); h.controller.setServiceTooth(row, 'ur5');
  const before = h.controller.getState(); invalid(() => h.controller.setTeeth([]));
  assert.equal(h.controller.getState(), before);
  h.controller.setServiceTooth(row, null); h.controller.setTeeth([]);
  assert.deepEqual(h.controller.buildSession(metadata()).teethIds, []);
  assert.equal(h.controller.getState().services[0].tooth, null);
});
test('teeth arrays reject sparse, duplicate, malformed, normalized-looking or over-bound IDs without coercion', () => {
  const h = draft(), row = h.controller.chooseService(SERVICE);
  for (const value of ['ur9', 'URA', 'ura', 'ur01', 'ur١', 'ur1 ', 1, {}, undefined]) invalid(() => h.controller.setServiceTooth(row, value as any));
  for (const values of [['ur1', 'ur1'], ['ur9'], new Array(1), 'ur1', null,
    [...['ur', 'ul', 'lr', 'll'].flatMap(quadrant => Array.from({ length: 8 }, (_, index) => `${quadrant}${index + 1}`)), 'urA']]) {
    invalid(() => h.controller.setTeeth(values as any));
  }
  assert.deepEqual(h.controller.getState().teethIds, []);
});
test('32 distinct canonical teeth are allowed but service auto-add refuses a 33rd', () => {
  const h = draft(), row = h.controller.chooseService(SERVICE);
  const all = ['ur', 'ul', 'lr', 'll'].flatMap(quadrant => Array.from({ length: 8 }, (_, index) => `${quadrant}${index + 1}`));
  h.controller.setTeeth(all); invalid(() => h.controller.setServiceTooth(row, 'urA'));
  assert.deepEqual(h.controller.getState().teethIds, all);
  assert.equal(h.controller.getState().services[0].tooth, null);
});
test('64 independent rows are allowed and the 65th deliberate choice fails before generating an ID', () => {
  const h = draft(catalog({ services: [{ serviceId: SERVICE, name: 'متابعة', kind: 'clinical', priceCents: 0, active: true }] }));
  for (let index = 0; index < 64; index++) h.controller.chooseService(SERVICE);
  assert.equal(h.controller.buildSession(metadata()).services.length, 64);
  invalid(() => h.controller.chooseService(SERVICE));
  assert.equal(h.idCalls(), 64);
});
test('row ID collisions and malformed/throwing ID suppliers never partially append', () => {
  const same = createCloudCatalogVisitDraft(catalog(), { newId: () => id(1000) });
  same.chooseService(SERVICE); const state = same.getState(); invalid(() => same.chooseService(SERVICE));
  assert.equal(same.getState(), state);
  for (const newId of [() => 'bad', () => undefined as any, () => { throw new Error('PRIVATE_ID_PROVIDER'); }]) {
    const h = createCloudCatalogVisitDraft(catalog(), { newId }); invalid(() => h.chooseService(SERVICE));
    assert.deepEqual(h.getState().services, []);
  }
});
test('row methods require the stable row UUID, never the catalog UUID, unknown ID or index', () => {
  const h = draft(), row = h.controller.chooseService(SERVICE), before = h.controller.getState();
  for (const badId of [SERVICE, id(9999), '', 0]) {
    invalid(() => h.controller.removeService(badId as any));
    invalid(() => h.controller.setServicePrice(badId as any, 0));
    invalid(() => h.controller.setServiceTooth(badId as any, null));
  }
  assert.equal(h.controller.getState(), before); h.controller.removeService(row);
  assert.equal(h.controller.getState().dirty, false);
});
test('integer piastre prices reject negative, fractions, strings, NaN, unsafe, undefined and over-limit values', () => {
  const h = draft(), row = h.controller.chooseService(SERVICE), state = h.controller.getState();
  for (const price of [-1, -0, 0.1, '0', '', undefined, NaN, Infinity, Number.MAX_SAFE_INTEGER, MAX_CLOUD_CLINICAL_CENTS + 1]) {
    invalid(() => h.controller.setServicePrice(row, price as any));
    assert.equal(h.controller.getState(), state);
  }
});
test('known-charge overflow from append, price edit or opt-in exam is rejected atomically', () => {
  const h = draft(catalog({ services: [{ serviceId: SERVICE, name: 'خدمة', kind: 'clinical', priceCents: MAX_CLOUD_CLINICAL_CENTS, active: true }] }));
  const row = h.controller.chooseService(SERVICE), state = h.controller.getState();
  invalid(() => h.controller.chooseService(SERVICE)); invalid(() => h.controller.setExaminationEnabled(true));
  assert.equal(h.controller.getState(), state);
  h.controller.setServicePrice(row, MAX_CLOUD_CLINICAL_CENTS - 10_000); h.controller.setExaminationEnabled(true);
  invalid(() => h.controller.setServicePrice(row, MAX_CLOUD_CLINICAL_CENTS));
  const data = h.controller.buildSession(metadata());
  assert.equal(data.services[0].priceCents + data.examinationCents, MAX_CLOUD_CLINICAL_CENTS);
});
test('reset restores empty clean draft without resetting the catalog or changing source defaults', () => {
  const h = draft(), row = h.controller.chooseService(SERVICE); h.controller.setServiceTooth(row, 'ur5');
  h.controller.setExaminationEnabled(true); h.controller.reset();
  assert.deepEqual(h.controller.getState(), { catalogRevision: 7, services: [], teethIds: [], examinationEnabled: false,
    examinationCents: 10_000, dirty: false });
  assert.equal(h.controller.getCatalog().revision, 7);
});
test('a plain tooth selection is an unsaved dirty draft and clearing it restores clean state', () => {
  const h = draft(); h.controller.setTeeth(['ulA']); assert.equal(h.controller.getState().dirty, true);
  h.controller.setTeeth([]); assert.equal(h.controller.getState().dirty, false);
});
test('returned session is a validated copy with stable catalog UUID, without private costs or payment fields', () => {
  const h = draft(); h.controller.chooseService(SERVICE);
  const first = h.controller.buildSession(metadata({ type: 'حشو', notes: 'ملاحظة مصطنعة\nمتابعة' }));
  first.services[0].priceCents = 0; first.teethIds.push('ur5');
  const second = h.controller.buildSession(metadata());
  assert.equal(second.services[0].priceCents, 30_000); assert.deepEqual(second.teethIds, []);
  assert.deepEqual(Object.keys(second.services[0]).sort(), ['catalogServiceId', 'id', 'name', 'priceCents', 'tooth']);
  assert.equal(second.services[0].catalogServiceId, SERVICE);
  for (const field of ['paidCents', 'costCents', 'labId', 'catalogServiceId', 'catalogRevision']) assert.equal(field in second, false);
});
test('full clinical metadata/date/stage constraints are preserved without trimming or coercing inputs', () => {
  const h = draft(); h.controller.chooseService(SERVICE);
  for (const overrides of [{ date: '2026-02-30' }, { date: '11/10/2026' }, { type: '' }, { type: ' زيارة ' },
    { treatmentStage: 'fourth' }, { rootCanalStatus: 'done' }, { visitStatus: 'pending' }, { notes: '\u0000' },
    { notes: 'a'.repeat(4001) }, { type: 'تركيب ثابت' }]) invalid(() => h.controller.buildSession(metadata(overrides as any)));
  for (const input of [null, [], {}, { ...metadata(), paidCents: 0 }, { ...metadata(), extra: true }]) {
    invalid(() => h.controller.buildSession(input as any));
  }
});
test('malformed/missing catalogs do not default to a fee, guessed price or an empty valid catalog', () => {
  for (const input of [null, undefined, {}, [], { ...catalog(), revision: 0 },
    { ...catalog(), data: { services: [] } }, { ...catalog(), data: { examinationCents: null, services: [] } },
    { ...catalog(), data: { examinationCents: 100, services: new Array(1) } },
    { ...catalog(), data: { ...catalog().data, services: [{ ...catalog().data.services[0], kind: undefined }] } }]) {
    invalid(() => createCloudCatalogVisitDraft(input));
  }
  const empty = draft(catalog({ services: [], examinationCents: 73 }));
  assert.deepEqual(empty.controller.getCatalog().data.services, []);
  assert.equal(empty.controller.getState().examinationCents, 73);
});
test('getters on catalog/options/metadata/teeth are rejected without executing them', () => {
  let getters = 0;
  const getter = { enumerable: true, get() { getters++; throw new Error('PRIVATE_GETTER'); } };
  const record = catalog(); Object.defineProperty(record, 'data', getter);
  invalid(() => createCloudCatalogVisitDraft(record));
  const options = {}; Object.defineProperty(options, 'newId', getter);
  invalid(() => createCloudCatalogVisitDraft(catalog(), options));
  const h = draft(); h.controller.chooseService(SERVICE);
  const input = metadata(); Object.defineProperty(input, 'notes', getter);
  invalid(() => h.controller.buildSession(input));
  const selected = ['ur1']; Object.defineProperty(selected, '0', getter);
  invalid(() => h.controller.setTeeth(selected));
  assert.equal(getters, 0);
});
test('hostile/revoked proxies and malformed options surface only fixed errors and preserve drafts', () => {
  const hostile = new Proxy({}, { ownKeys() { throw new Error('PRIVATE_PROXY'); } });
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  invalid(() => createCloudCatalogVisitDraft(hostile)); invalid(() => createCloudCatalogVisitDraft(revoked.proxy));
  for (const value of [null, [], { newId: 1 }, { extra: true }]) invalid(() => createCloudCatalogVisitDraft(catalog(), value as any));
  const h = draft(); h.controller.chooseService(SERVICE); const before = h.controller.getState();
  invalid(() => h.controller.buildSession(hostile as any));
  invalid(() => h.controller.setTeeth(revoked.proxy as any));
  assert.equal(h.controller.getState(), before);
});
test('listeners receive immutable states, can unsubscribe and cannot reenter mutation or break an append', () => {
  const h = draft(), observed: unknown[] = [];
  const unsubscribe = h.controller.subscribe(state => {
    observed.push(state); invalid(() => h.controller.reset()); throw new Error('PRIVATE_VIEW');
  });
  h.controller.chooseService(SERVICE);
  assert.equal(observed.length, 1); assert.equal(h.controller.getState().services.length, 1);
  unsubscribe(); h.controller.chooseService(SERVICE); assert.equal(observed.length, 1);
  invalid(() => h.controller.subscribe(null as any));
});
test('an ID supplier cannot reenter or clear a partially-created row', () => {
  let controller: ReturnType<typeof createCloudCatalogVisitDraft>;
  controller = createCloudCatalogVisitDraft(catalog(), { newId: () => { controller.reset(); return id(1000); } });
  invalid(() => controller.chooseService(SERVICE));
  assert.deepEqual(controller.getState().services, []);
  assert.equal(controller.getState().dirty, false);
});
test('buildSession does not create an operation, change state, emit a mutation or consume another ID', () => {
  const h = draft(); h.controller.chooseService(SERVICE); const state = h.controller.getState(); let events = 0;
  h.controller.subscribe(() => { events++; });
  h.controller.buildSession(metadata()); h.controller.buildSession(metadata());
  assert.equal(h.controller.getState(), state); assert.equal(h.idCalls(), 1); assert.equal(events, 0);
});

test('actual pure clinical transaction separates catalog exam charge from actual cash and same-ID retry', async () => {
  const { docs, calls, journal, clinical } = clinicalHarness();
  const h = draft(); h.controller.chooseService(SERVICE); h.controller.setExaminationEnabled(true);
  const data = h.controller.buildSession(metadata());
  assert.deepEqual(calls, []);
  const command: CloudClinicalCommand = { operationId: OPERATION, patientId: PATIENT, sessionId: OPERATION,
    expectedRevision: 0, action: 'visit', createdAt: WHEN, paidCents: 15_000, data };
  await journal.prepare('clinical', command, WHEN);
  assert.equal((await clinical.commit(command)).status, 'committed');
  assert.equal((await clinical.commit(command)).status, 'already-committed');
  const account = await clinical.getAccount(PATIENT);
  assert.equal(account?.totalCents, 40_000); assert.equal(account?.paidCents, 15_000); assert.equal(account?.sessionCount, 1);
  const receipts = [...docs].filter(([path]) => path.startsWith('clinics/main/patientReceipts/'));
  assert.equal(receipts.length, 1); assert.equal((receipts[0][1] as any).amountCents, 15_000);
  assert.equal((docs.get(`clinics/main/operationIntents/${OPERATION}`) as any).status, 'committed');
});
test('catalog changes affect only newly captured drafts/sessions; stored visit retains row/catalog IDs and original snapshots', async () => {
  const input = catalog(), old = draft(input), rowId = old.controller.chooseService(SERVICE);
  old.controller.setExaminationEnabled(true);
  const firstData = old.controller.buildSession(metadata()), h = clinicalHarness();
  const firstCommand: CloudClinicalCommand = { operationId: OPERATION, patientId: PATIENT, sessionId: OPERATION,
    expectedRevision: 0, action: 'visit', createdAt: WHEN, paidCents: 0, data: firstData };
  await h.journal.prepare('clinical', firstCommand, WHEN); await h.clinical.commit(firstCommand);

  input.revision = 8; input.lastOperationId = id(91); input.data.examinationCents = 12_000;
  input.data.services[0].name = 'حشو عادي محدث'; input.data.services[0].priceCents = 35_000;
  const fresh = createCloudCatalogVisitDraft(input, { newId: () => id(2000) });
  const freshRowId = fresh.chooseService(SERVICE); fresh.setExaminationEnabled(true);
  const freshData = fresh.buildSession(metadata());
  assert.notEqual(freshRowId, rowId);
  assert.equal(fresh.getState().catalogRevision, 8);
  assert.deepEqual(freshData.services[0], { id: freshRowId, catalogServiceId: SERVICE,
    name: 'حشو عادي محدث', priceCents: 35_000, tooth: null });
  assert.equal(freshData.examinationCents, 12_000);
  assert.deepEqual(old.controller.buildSession(metadata()), firstData);

  const secondOperation = id(102), secondCommand: CloudClinicalCommand = { operationId: secondOperation,
    patientId: PATIENT, sessionId: secondOperation, expectedRevision: 1, action: 'visit', createdAt: WHEN,
    paidCents: 0, data: freshData };
  await h.journal.prepare('clinical', secondCommand, WHEN); await h.clinical.commit(secondCommand);
  const previous = await h.clinical.getSession(OPERATION), current = await h.clinical.getSession(secondOperation);
  assert.deepEqual(previous?.data, firstData);
  assert.deepEqual(previous?.data.services[0], { id: rowId, catalogServiceId: SERVICE,
    name: 'حشو عادي', priceCents: 30_000, tooth: null });
  assert.equal(previous?.data.examinationCents, 10_000);
  assert.equal(previous?.totalCents, 40_000); assert.equal(current?.totalCents, 47_000);
  assert.equal((await h.clinical.getAccount(PATIENT))?.totalCents, 87_000);
});
test('production draft bundle has no SDK, local catalog/storage, network or hardcoded fee imports', async () => {
  const result = await build({ entryPoints: ['src/utils/cloudCatalogVisitDraft.ts'], bundle: true,
    write: false, platform: 'browser', format: 'esm', minify: false, metafile: true, logLevel: 'silent' });
  const inputs = Object.keys(result.metafile!.inputs);
  for (const fragment of ['firebase/', 'firebaseCloud', 'serviceCatalog.ts', 'initialData', 'storage.ts']) {
    assert.equal(inputs.some(input => input.includes(fragment)), false, fragment);
  }
  assert.doesNotMatch(result.outputFiles[0].text, /localStorage|sessionStorage|fetch\(|initializeApp|runTransaction\(/);
});
