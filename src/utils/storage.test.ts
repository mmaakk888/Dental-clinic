import test from 'node:test';
import assert from 'node:assert/strict';
import { Storage, STORAGE_FAILURE_EVENT, SERVICE_CATALOG_STORAGE_KEYS, LABS_STORAGE_KEY } from './storage';
import { LabCase, User } from '../types';
import { INITIAL_PATIENTS } from '../data/initialData';
import { DEFAULT_THEME, DEFAULT_UI_LABELS } from '../data/initialData';

const local = new Map<string, string>();
const session = new Map<string, string>();
const adapter = (map: Map<string, string>) => ({ getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => map.set(key, value), removeItem: (key: string) => map.delete(key) });
Object.defineProperty(globalThis, 'localStorage', { value: adapter(local), configurable: true });
Object.defineProperty(globalThis, 'sessionStorage', { value: adapter(session), configurable: true });
Object.defineProperty(globalThis, 'window', { value: new EventTarget(), configurable: true });

test('fresh lab cases observe a newly linked case without returning mutable cached records', () => {
  const key = 'dental_lab_cases_v2';
  local.set(key, JSON.stringify([{ id: 'fresh-case', labId: 'existing-lab', labTotal: 50, paymentsLog: [{ id: 'receipt', amount: 20 }] }]));
  const before = local.get(key);
  const first = Storage.getLabCasesFresh();
  assert.equal(first[0].labId, 'existing-lab');
  first[0].paymentsLog![0].amount = 99;
  assert.equal(Storage.getLabCasesFresh()[0].paymentsLog![0].amount, 20);
  local.set(key, JSON.stringify([{ id: 'new-case', labId: 'another-lab' }]));
  assert.equal(Storage.getLabCasesFresh()[0].id, 'new-case');
  assert.notEqual(local.get(key), before);
  local.delete(key);
});

test('domain writes persist before save returns, and reset cannot be undone by delayed writes', () => {
  Storage.saveExpenses([{ id: 'e', title: 'اختبار', category: 'other', date: '2026-10-05', amount: 5 }]);
  assert.equal(JSON.parse(local.get('dental_expenses_v2')!)[0].amount, 5);
  Storage.resetAll();
  assert.equal(local.size, 0);
});

test('unchecked remember-me login is session-only and never persists password', () => {
  const user = { id: 'doctor', username: 'doctor', name: 'طبيب', password: 'test-secret', role: 'doctor', permissions: {} } as User;
  Storage.saveCurrentUser(user);
  assert.equal(local.has('dental_current_user_v2'), false);
  assert.equal(Storage.getCurrentUser()?.username, 'doctor');
  assert.equal(session.get('dental_current_user_v2')!.includes('test-secret'), false);
  session.clear();
  assert.equal(Storage.getCurrentUser(), null);
});

test('account checks observe updated permissions from another tab rather than stale cache', () => {
  const user = { id: 'reception', username: 'reception', name: 'استقبال', role: 'secretary', permissions: { patientEdit: true } } as User;
  Storage.saveUsers([user]);
  assert.equal(Storage.getUsers()[0].permissions.patientEdit, true);
  local.set('dental_users_v2', JSON.stringify([{ ...user, permissions: { patientEdit: false } }]));
  assert.equal(Storage.getUsers()[0].permissions.patientEdit, false);
});

test('only exact untouched legacy demo records receive the aggregate marker', () => {
  const oldFixture = { ...INITIAL_PATIENTS[0], payments: INITIAL_PATIENTS[0].payments.map(({ legacyAggregate: _marker, ...payment }) => payment) };
  Storage.savePatients([oldFixture, { ...oldFixture, id: 'real-501', name: 'مريض حقيقي' }]);
  const records = Storage.getPatients();
  assert.equal(records[0].payments[0].legacyAggregate, true);
  assert.equal(records[1].payments[0].legacyAggregate, undefined);
});

test('failed persistence emits a visible-failure signal while keeping data in memory', () => {
  let failures = 0;
  const listener = () => failures++;
  window.addEventListener(STORAGE_FAILURE_EVENT, listener);
  Object.defineProperty(globalThis, 'localStorage', { value: { ...adapter(local), setItem: () => { throw new Error('quota'); } }, configurable: true });
  Storage.saveExpenses([{ id: 'failed', title: 'اختبار', category: 'other', date: '2026-10-05', amount: 10 }]);
  assert.equal(failures, 1);
  assert.equal(Storage.getExpenses()[0].id, 'failed');
  window.removeEventListener(STORAGE_FAILURE_EVENT, listener);
  Object.defineProperty(globalThis, 'localStorage', { value: adapter(local), configurable: true });
});

test('identity saves publish name, logo and theme together without changing patient data', () => {
  const recordsBefore = local.get('dental_patients_v2');
  const theme = { ...DEFAULT_THEME, primary: '#2563eb' };
  Storage.saveClinicIdentity({ clinicName: 'عيادة اختبار', clinicLogo: null, theme });
  assert.equal(Storage.getClinicName(), 'عيادة اختبار');
  assert.equal(Storage.getClinicLogo(), null);
  assert.deepEqual(Storage.getTheme(), theme);
  assert.equal(JSON.parse(local.get('dental_clinic_name_v2')!), 'عيادة اختبار');
  assert.deepEqual(JSON.parse(local.get('dental_theme_v2')!), theme);
  assert.equal(local.get('dental_patients_v2'), recordsBefore);
  theme.primary = '#ff0000';
  assert.equal(Storage.getTheme().primary, '#2563eb', 'saved theme is not aliased to the draft');
});

test('an interrupted identity save restores persisted keys and leaves cached values unchanged', () => {
  const original = { clinicName: 'الاسم السابق', clinicLogo: 'old-logo', theme: { ...DEFAULT_THEME } };
  Storage.saveClinicIdentity(original);
  const persistedBefore = new Map(local);
  let failOnce = true;
  let failures = 0;
  const listener = () => failures++;
  window.addEventListener(STORAGE_FAILURE_EVENT, listener);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    ...adapter(local),
    setItem: (key: string, value: string) => {
      if (key === 'dental_clinic_name_v2' && failOnce) { failOnce = false; throw new Error('quota'); }
      local.set(key, value);
    },
  } });
  try {
    assert.throws(() => Storage.saveClinicIdentity({ clinicName: 'تغيير', clinicLogo: 'new-logo', theme: { ...DEFAULT_THEME, primary: '#112233' } }), /لم تُحفظ/);
    assert.deepEqual(local, persistedBefore);
    assert.equal(Storage.getClinicName(), original.clinicName);
    assert.equal(Storage.getClinicLogo(), original.clinicLogo);
    assert.deepEqual(Storage.getTheme(), original.theme);
    assert.equal(failures, 1);
  } finally {
    window.removeEventListener(STORAGE_FAILURE_EVENT, listener);
    Object.defineProperty(globalThis, 'localStorage', { value: adapter(local), configurable: true });
  }
});

test('identity rollback removes newly introduced keys rather than storing null strings', () => {
  Storage.resetAll();
  let failOnce = true;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    ...adapter(local),
    setItem: (key: string, value: string) => {
      if (key === 'dental_theme_v2' && failOnce) { failOnce = false; throw new Error('quota'); }
      local.set(key, value);
    },
  } });
  try {
    assert.throws(() => Storage.saveClinicIdentity({ clinicName: 'اختبار', clinicLogo: null, theme: { ...DEFAULT_THEME } }));
    assert.equal(local.size, 0);
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { value: adapter(local), configurable: true });
  }
});

test('identity save reports a rollback failure instead of falsely claiming previous values restored', () => {
  Storage.saveClinicIdentity({ clinicName: 'الاسم السابق', clinicLogo: 'old-logo', theme: { ...DEFAULT_THEME } });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    ...adapter(local),
    setItem: (key: string, value: string) => {
      if (key === 'dental_clinic_name_v2' || value === JSON.stringify('old-logo')) throw new Error('storage blocked');
      local.set(key, value);
    },
  } });
  try {
    assert.throws(() => Storage.saveClinicIdentity({ clinicName: 'تغيير', clinicLogo: 'new-logo', theme: { ...DEFAULT_THEME } }), /استعادة بعض الإعدادات/);
    assert.equal(Storage.getClinicLogo(), 'old-logo', 'cache stays on the visible saved identity');
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { value: adapter(local), configurable: true });
    Storage.resetAll();
  }
});

const makeContentDraft = () => ({
  labels: {
    ...DEFAULT_UI_LABELS,
    homeSubtitle: 'ملخص يوم العيادة',
    welcomeText: 'اختر قسمًا للمتابعة',
    tabs: { ...DEFAULT_UI_LABELS.tabs, lab: 'معمل ملف المريض', customTab: 'تبويب محفوظ' },
    tiles: {
      ...DEFAULT_UI_LABELS.tiles,
      patients: { title: 'ملفات المرضى القديمة', desc: 'ملفات وسجل العيادة' },
      customSection: { title: 'عنوان قسم محفوظ', desc: 'وصف محفوظ' },
    },
    navigationLabels: { home: 'البداية', patients: 'المرضى' },
    futureSetting: { tags: ['محفوظ'], nested: { enabled: true } },
  },
  tileOrder: ['summary', 'patients', 'appointments', 'lab', 'settings'],
});

test('content saves confirm both keys and preserve unrelated records, identity and legacy labels', () => {
  Storage.resetAll();
  Storage.savePatients([]);
  Storage.saveClinicIdentity({ clinicName: 'عيادة اختبار المحتوى', clinicLogo: 'test-logo', theme: { ...DEFAULT_THEME } });
  const unrelatedBefore = new Map(local);
  const draft = makeContentDraft();
  const writtenKeys: string[] = [];
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    ...adapter(local),
    setItem: (key: string, value: string) => { writtenKeys.push(key); local.set(key, value); },
  } });
  try {
    Storage.saveClinicContent(draft);
    assert.deepEqual(writtenKeys, ['dental_ui_labels_v2', 'dental_tile_order_v2']);
    assert.deepEqual(JSON.parse(local.get('dental_ui_labels_v2')!), draft.labels);
    assert.deepEqual(JSON.parse(local.get('dental_tile_order_v2')!), draft.tileOrder);
    assert.deepEqual(Storage.getUILabels(), draft.labels);
    assert.deepEqual(Storage.getTileOrder(), draft.tileOrder);
    for (const [key, value] of unrelatedBefore) assert.equal(local.get(key), value, `${key} remains unchanged`);
    assert.deepEqual(Storage.getUILabels().tabs, draft.labels.tabs);
    assert.deepEqual(Storage.getUILabels().tiles.customSection, draft.labels.tiles.customSection);
    assert.equal(Storage.getUILabels().tiles.patients.title, 'ملفات المرضى القديمة');
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { value: adapter(local), configurable: true });
    Storage.resetAll();
  }
});

test('saved content and nested legacy fields do not alias the mutable draft', () => {
  Storage.resetAll();
  const draft = makeContentDraft();
  Storage.saveClinicContent(draft);
  const labelsBefore = JSON.parse(local.get('dental_ui_labels_v2')!);
  const orderBefore = JSON.parse(local.get('dental_tile_order_v2')!);
  draft.labels.homeSubtitle = 'تغيير بعد الحفظ';
  draft.labels.tabs.lab = 'تغيير تبويب';
  draft.labels.tiles.patients.title = 'تغيير عنوان';
  draft.labels.tiles.customSection.desc = 'تغيير وصف';
  draft.labels.navigationLabels.home = 'تغيير الرئيسية';
  draft.labels.futureSetting.tags.push('تغيير');
  draft.labels.futureSetting.nested.enabled = false;
  draft.tileOrder.reverse();
  assert.deepEqual(Storage.getUILabels(), labelsBefore);
  assert.deepEqual(Storage.getTileOrder(), orderBefore);
  assert.deepEqual(JSON.parse(local.get('dental_ui_labels_v2')!), labelsBefore);
  assert.deepEqual(JSON.parse(local.get('dental_tile_order_v2')!), orderBefore);
  Storage.resetAll();
});

test('content save normalizes duplicate, unknown and missing section order before persistence', () => {
  Storage.resetAll();
  const draft = makeContentDraft();
  draft.tileOrder = ['settings', 'home', 'patients', 'settings', 'unknown', 'lab'];
  const originalOrder = [...draft.tileOrder];
  Storage.saveClinicContent(draft);
  const expected = ['settings', 'patients', 'lab', 'appointments', 'summary'];
  assert.deepEqual(Storage.getTileOrder(), expected);
  assert.deepEqual(JSON.parse(local.get('dental_tile_order_v2')!), expected);
  assert.deepEqual(draft.tileOrder, originalOrder, 'normalization does not mutate the caller draft');
  Storage.resetAll();
});

test('an interrupted second content write restores both persisted keys and their cached values', () => {
  Storage.resetAll();
  const original = makeContentDraft();
  Storage.saveClinicContent(original);
  const persistedBefore = new Map(local);
  const next = makeContentDraft();
  next.labels.homeSubtitle = 'عنوان جديد';
  next.labels.navigationLabels.home = 'رئيسية جديدة';
  next.tileOrder = ['settings', 'lab', 'patients', 'appointments', 'summary'];
  let failOnce = true;
  let failures = 0;
  const listener = () => failures++;
  window.addEventListener(STORAGE_FAILURE_EVENT, listener);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    ...adapter(local),
    setItem: (key: string, value: string) => {
      if (key === 'dental_tile_order_v2' && failOnce) { failOnce = false; throw new Error('quota'); }
      local.set(key, value);
    },
  } });
  try {
    assert.throws(() => Storage.saveClinicContent(next), /لم تُحفظ/);
    assert.deepEqual(local, persistedBefore);
    assert.deepEqual(Storage.getUILabels(), original.labels);
    assert.deepEqual(Storage.getTileOrder(), original.tileOrder);
    assert.equal(failures, 1);
  } finally {
    window.removeEventListener(STORAGE_FAILURE_EVENT, listener);
    Object.defineProperty(globalThis, 'localStorage', { value: adapter(local), configurable: true });
    Storage.resetAll();
  }
});

test('content rollback removes initially absent keys and retains cached fallback settings', () => {
  Storage.resetAll();
  const labelsBefore = Storage.getUILabels();
  const orderBefore = Storage.getTileOrder();
  let failOnce = true;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    ...adapter(local),
    setItem: (key: string, value: string) => {
      if (key === 'dental_tile_order_v2' && failOnce) { failOnce = false; throw new Error('quota'); }
      local.set(key, value);
    },
  } });
  try {
    assert.throws(() => Storage.saveClinicContent(makeContentDraft()), /لم تُحفظ/);
    assert.equal(local.has('dental_ui_labels_v2'), false);
    assert.equal(local.has('dental_tile_order_v2'), false);
    assert.equal(local.size, 0);
    assert.deepEqual(Storage.getUILabels(), labelsBefore);
    assert.deepEqual(Storage.getTileOrder(), orderBefore);
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { value: adapter(local), configurable: true });
    Storage.resetAll();
  }
});

test('fresh content snapshots observe external changes, normalize order without writes and isolate returned drafts', () => {
  Storage.resetAll();
  const original = makeContentDraft();
  Storage.saveClinicContent(original);
  assert.deepEqual(Storage.getUILabels(), original.labels);
  assert.deepEqual(Storage.getTileOrder(), original.tileOrder);

  const external = makeContentDraft();
  external.labels.homeSubtitle = 'وصف محفوظ في تبويب آخر';
  external.labels.tabs.customTab = 'تبويب خارجي محفوظ';
  external.labels.tiles.customSection.title = 'عنوان خارجي محفوظ';
  external.labels.navigationLabels.home = 'الاستقبال';
  const externalOrder = ['settings', 'home', 'settings', null, 'unknown', 'lab'];
  local.set('dental_ui_labels_v2', JSON.stringify(external.labels));
  local.set('dental_tile_order_v2', JSON.stringify(externalOrder));
  assert.equal(Storage.getUILabels().homeSubtitle, original.labels.homeSubtitle, 'ordinary reads still have the old cache');
  assert.deepEqual(Storage.getTileOrder(), original.tileOrder);

  const persistedBefore = new Map(local);
  const writes: string[] = [];
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    ...adapter(local),
    setItem: (key: string, value: string) => { writes.push(`set:${key}`); local.set(key, value); },
    removeItem: (key: string) => { writes.push(`remove:${key}`); local.delete(key); },
  } });
  try {
    const snapshot = Storage.getClinicContent();
    assert.deepEqual(snapshot.labels, external.labels);
    assert.deepEqual(snapshot.tileOrder, ['settings', 'lab', 'patients', 'appointments', 'summary']);
    assert.deepEqual(local, persistedBefore, 'fresh reads do not rewrite malformed persisted order');
    assert.deepEqual(writes, []);

    snapshot.labels.homeSubtitle = 'تغيير في المسودة المسترجعة';
    snapshot.labels.tabs.customTab = 'تغيير تبويب في المسودة';
    snapshot.labels.tiles.customSection.title = 'تغيير عنوان في المسودة';
    snapshot.labels.navigationLabels!.home = 'تغيير التنقل';
    (snapshot.labels as typeof external.labels).futureSetting.tags.push('تغيير');
    (snapshot.labels as typeof external.labels).futureSetting.nested.enabled = false;
    snapshot.tileOrder.reverse();
    assert.deepEqual(Storage.getUILabels(), external.labels, 'the returned snapshot does not alias cached labels');
    assert.deepEqual(Storage.getClinicContent().labels, external.labels);
    assert.deepEqual(Storage.getClinicContent().tileOrder, ['settings', 'lab', 'patients', 'appointments', 'summary']);
    assert.deepEqual(local, persistedBefore);
    assert.deepEqual(writes, []);
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { value: adapter(local), configurable: true });
    Storage.resetAll();
  }
});

test('content saves report silent rollback failure without publishing partially persisted settings to cache', () => {
  Storage.resetAll();
  const original = makeContentDraft();
  Storage.saveClinicContent(original);
  const originalLabels = local.get('dental_ui_labels_v2')!;
  const originalOrder = local.get('dental_tile_order_v2')!;
  const next = makeContentDraft();
  next.labels.homeSubtitle = 'وصف لا يمكن استعادة سابقه';
  next.tileOrder = ['settings', 'lab', 'patients', 'appointments', 'summary'];
  let failOrderOnce = true;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    ...adapter(local),
    setItem: (key: string, value: string) => {
      if (key === 'dental_tile_order_v2' && failOrderOnce) { failOrderOnce = false; throw new Error('quota'); }
      if (key === 'dental_ui_labels_v2' && value === originalLabels) return;
      local.set(key, value);
    },
  } });
  try {
    assert.throws(() => Storage.saveClinicContent(next), /استعادة بعض الإعدادات/);
    assert.notEqual(local.get('dental_ui_labels_v2'), originalLabels, 'the silent rollback did not restore the first write');
    assert.deepEqual(JSON.parse(local.get('dental_ui_labels_v2')!), next.labels);
    assert.equal(local.get('dental_tile_order_v2'), originalOrder);
    assert.deepEqual(Storage.getUILabels(), original.labels, 'failed content writes never publish their labels to cache');
    assert.deepEqual(Storage.getTileOrder(), original.tileOrder, 'failed content writes never publish their order to cache');
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { value: adapter(local), configurable: true });
    Storage.resetAll();
  }
});

const makeServiceCatalog = () => ({ serviceTypes: ['حشو', 'تركيبات - ثابتة', 'تركيبات - متحركة'], crownPrices: { PFM: 1200, 'نوع مخصص': 0 } });
const makeDrugCatalog = () => [{ id: 'test-drug', name: 'اسم محفوظ للاختبار', category: 'تصنيف اختبار', defaultDosage: 'نص محفوظ', defaultDuration: 'مدة محفوظة', metadata: { labels: ['قديم'] } }];
const makeAccountList = () => [{ id: 'test-manager', username: 'test-manager', name: 'مدير اختبار', role: 'admin', permissions: { controlPanel: true }, accessSchedule: { enabled: false, days: [0, 1], startTime: '09:00', endTime: '17:00' }, metadata: { tags: ['قديم'] } }] as unknown as (User & { metadata: { tags: string[] } })[];
const makeLabs = () => [{ id: 'test-lab', name: 'معمل اختبار', phone: '01012345678', services: [
  { id: 'test-pfm', name: 'PFM', category: 'fixed' as const, unitLabel: 'طربوش', price: 400, metadata: { tags: ['خدمة محفوظة'] } },
  { id: 'test-free', name: 'خدمة مجانية', category: 'other' as const, unitLabel: 'وحدة', price: 0, metadata: { tags: [] as string[] } },
], metadata: { tags: ['معمل محفوظ'], nested: { enabled: true } } }];

test('confirmed lab prices preserve zero and unknown nested fields without changing patient prices or historical cases', () => {
  Storage.resetAll();
  Storage.saveServiceCatalog(makeServiceCatalog());
  Storage.savePatients(INITIAL_PATIENTS);
  const oldCase = { id: 'old-case', labId: 'test-lab', units: 2, labTotal: 800, labUnitPrice: 400, patientTotal: 2400, labPaid: 100 } as unknown as LabCase;
  Storage.saveLabCases([oldCase]);
  const before = new Map(local);
  const draft = makeLabs();
  draft[0].services[0].price = 650;
  Storage.saveLabsConfirmed(draft);
  const persisted = JSON.parse(local.get(LABS_STORAGE_KEY)!);
  assert.equal(LABS_STORAGE_KEY, 'dental_labs_v2');
  assert.deepEqual(persisted, draft);
  assert.equal(Storage.getLabs()[0].services[1].price, 0);
  for (const [key, value] of before) assert.equal(local.get(key), value, `${key} remains unchanged`);
  assert.equal(Storage.getCrownPrices().PFM, 1200);
  assert.deepEqual(Storage.getLabCases(), [oldCase]);
  draft[0].name = 'تعديل المسودة';
  draft[0].services[0].price = 1;
  draft[0].services[0].metadata.tags.push('تعديل');
  draft[0].metadata.tags.push('تعديل');
  draft[0].metadata.nested.enabled = false;
  assert.deepEqual(Storage.getLabs(), persisted, 'confirmed cache has no aliases to the mutable caller draft');
  assert.deepEqual(JSON.parse(local.get(LABS_STORAGE_KEY)!), persisted);
  Storage.resetAll();
});

test('fresh lab reads observe another tab and return independent nested drafts without writes', () => {
  Storage.resetAll();
  Storage.saveLabsConfirmed(makeLabs());
  const changed = makeLabs();
  changed[0].name = 'اسم من تبويب آخر';
  changed[0].services[0].price = 0;
  local.set(LABS_STORAGE_KEY, JSON.stringify(changed));
  assert.equal(Storage.getLabs()[0].name, makeLabs()[0].name, 'ordinary domain reads retain their established cache behavior');
  const before = new Map(local);
  const writes: string[] = [];
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    ...adapter(local), setItem: (key: string, value: string) => { writes.push(key); local.set(key, value); },
  } });
  try {
    const fresh = Storage.getLabsFresh() as ReturnType<typeof makeLabs>;
    assert.deepEqual(fresh, changed);
    fresh[0].services[0].price = 900;
    fresh[0].services[0].metadata.tags.push('تعديل');
    fresh[0].metadata.nested.enabled = false;
    fresh.reverse();
    assert.deepEqual(Storage.getLabs(), changed, 'returned draft does not alias the refreshed cache');
    assert.deepEqual(Storage.getLabsFresh(), changed);
    assert.deepEqual(local, before);
    assert.deepEqual(writes, []);
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { value: adapter(local), configurable: true });
    Storage.resetAll();
  }
});

test('failed confirmed lab writes retain persisted and cached records and emit failure', () => {
  Storage.resetAll();
  const original = makeLabs();
  Storage.saveLabsConfirmed(original);
  const before = new Map(local);
  let failOnce = true;
  let failures = 0;
  const listener = () => failures++;
  window.addEventListener(STORAGE_FAILURE_EVENT, listener);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    ...adapter(local), setItem: (key: string, value: string) => {
      local.set(key, value);
      if (key === LABS_STORAGE_KEY && failOnce) { failOnce = false; throw new Error('quota after write'); }
    },
  } });
  try {
    assert.throws(() => Storage.saveLabsConfirmed([]), /لم تُحفظ/);
    assert.deepEqual(local, before);
    assert.deepEqual(Storage.getLabs(), original);
    assert.equal(failures, 1);
  } finally {
    window.removeEventListener(STORAGE_FAILURE_EVENT, listener);
    Object.defineProperty(globalThis, 'localStorage', { value: adapter(local), configurable: true });
    Storage.resetAll();
  }
});

test('confirmed lab writes reject silent no-op persistence without publishing draft values', () => {
  Storage.resetAll();
  Storage.saveLabsConfirmed(makeLabs());
  const before = new Map(local);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { ...adapter(local), setItem: () => undefined } });
  try {
    assert.throws(() => Storage.saveLabsConfirmed([]), /لم تُحفظ/);
    assert.deepEqual(local, before);
    assert.deepEqual(Storage.getLabs(), makeLabs());
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { value: adapter(local), configurable: true });
    Storage.resetAll();
  }
});

test('service catalog saves confirm both legacy keys and isolate drafts without changing historical or identity records', () => {
  Storage.resetAll();
  Storage.savePatients([]);
  Storage.saveClinicIdentity({ clinicName: 'عيادة اختبار الخدمات', clinicLogo: null, theme: { ...DEFAULT_THEME } });
  const untouched = new Map(local);
  const draft = makeServiceCatalog();
  Storage.saveServiceCatalog(draft);
  assert.deepEqual(SERVICE_CATALOG_STORAGE_KEYS, ['dental_service_types_v2', 'dental_crown_prices_v2']);
  assert.deepEqual(JSON.parse(local.get('dental_service_types_v2')!), draft.serviceTypes);
  assert.deepEqual(JSON.parse(local.get('dental_crown_prices_v2')!), draft.crownPrices);
  for (const [key, value] of untouched) assert.equal(local.get(key), value);
  draft.serviceTypes[0] = 'تغيير بعد الحفظ';
  draft.crownPrices.PFM = 1;
  assert.equal(Storage.getServiceTypes()[0], 'حشو');
  assert.equal(Storage.getCrownPrices().PFM, 1200);
  assert.equal(Storage.getCrownPrices()['نوع مخصص'], 0);
  Storage.resetAll();
});

test('fresh service catalogs observe external pairs without writes and return independent malformed price drafts', () => {
  Storage.resetAll();
  const original = makeServiceCatalog();
  Storage.saveServiceCatalog(original);
  const names = ['  اسم   خارجي  ', 'تركيبات - ثابتة'];
  const prices = { PFM: 1500, 'نوع محفوظ': { invalid: ['لا يحذف'] } };
  local.set('dental_service_types_v2', JSON.stringify(names));
  local.set('dental_crown_prices_v2', JSON.stringify(prices));
  assert.deepEqual(Storage.getServiceTypes(), original.serviceTypes);
  const before = new Map(local);
  const latest = Storage.getServiceCatalog();
  assert.deepEqual(latest.serviceTypes, names);
  assert.deepEqual(latest.crownPrices, prices);
  latest.serviceTypes.reverse();
  (latest.crownPrices['نوع محفوظ'] as any).invalid.push('تغيير');
  assert.deepEqual(Storage.getServiceCatalog().serviceTypes, names);
  assert.deepEqual(Storage.getServiceCatalog().crownPrices, prices);
  assert.deepEqual(local, before);
  Storage.resetAll();
});

test('service catalog second-key failure restores persisted and cached settings', () => {
  Storage.resetAll();
  const original = makeServiceCatalog();
  Storage.saveServiceCatalog(original);
  const before = new Map(local);
  let failOnce = true;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    ...adapter(local),
    setItem: (key: string, value: string) => {
      if (key === 'dental_crown_prices_v2' && failOnce) { failOnce = false; throw new Error('quota'); }
      local.set(key, value);
    },
  } });
  try {
    assert.throws(() => Storage.saveServiceCatalog({ serviceTypes: ['تنظيف'], crownPrices: { PFM: 2000 } }), /لم تُحفظ/);
    assert.deepEqual(local, before);
    assert.deepEqual(Storage.getServiceTypes(), original.serviceTypes);
    assert.deepEqual(Storage.getCrownPrices(), original.crownPrices);
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { value: adapter(local), configurable: true });
    Storage.resetAll();
  }
});

test('service catalog detects a silent second write and rolls back the first key', () => {
  Storage.resetAll();
  Storage.saveServiceCatalog(makeServiceCatalog());
  const before = new Map(local);
  const next = { serviceTypes: ['تنظيف'], crownPrices: { PFM: 2000 } };
  let ignored = false;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    ...adapter(local),
    setItem: (key: string, value: string) => {
      if (key === 'dental_crown_prices_v2' && !ignored) { ignored = true; return; }
      local.set(key, value);
    },
  } });
  try {
    assert.throws(() => Storage.saveServiceCatalog(next), /لم تُحفظ/);
    assert.deepEqual(local, before);
    assert.deepEqual(Storage.getServiceTypes(), makeServiceCatalog().serviceTypes);
    assert.deepEqual(Storage.getCrownPrices(), makeServiceCatalog().crownPrices);
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { value: adapter(local), configurable: true });
    Storage.resetAll();
  }
});

test('service catalog reports a silent rollback failure rather than claiming original values were restored', () => {
  Storage.resetAll();
  const original = makeServiceCatalog();
  Storage.saveServiceCatalog(original);
  const oldNames = local.get('dental_service_types_v2')!;
  let failOnce = true;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    ...adapter(local),
    setItem: (key: string, value: string) => {
      if (key === 'dental_crown_prices_v2' && failOnce) { failOnce = false; throw new Error('quota'); }
      if (key === 'dental_service_types_v2' && value === oldNames) return;
      local.set(key, value);
    },
  } });
  try {
    assert.throws(() => Storage.saveServiceCatalog({ serviceTypes: ['تنظيف'], crownPrices: { PFM: 2000 } }), /استعادة بعض الإعدادات/);
    assert.notEqual(local.get('dental_service_types_v2'), oldNames);
    assert.deepEqual(Storage.getServiceTypes(), original.serviceTypes);
    assert.deepEqual(Storage.getCrownPrices(), original.crownPrices);
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { value: adapter(local), configurable: true });
    Storage.resetAll();
  }
});

test('confirmed account and drug saves preserve unknown nested fields without mutable draft aliases', () => {
  Storage.resetAll();
  const accounts = makeAccountList();
  const drugs = makeDrugCatalog();
  Storage.saveUsersConfirmed(accounts);
  Storage.saveDrugCatalogConfirmed(drugs);
  const savedAccounts = JSON.parse(local.get('dental_users_v2')!);
  const savedDrugs = JSON.parse(local.get('dental_drug_catalog_v2')!);
  accounts[0].permissions.controlPanel = false;
  accounts[0].accessSchedule!.days.push(6);
  accounts[0].metadata.tags.push('تعديل');
  drugs[0].defaultDosage = 'تعديل النص';
  drugs[0].metadata.labels.push('تعديل');
  assert.deepEqual(Storage.getUsers(), savedAccounts);
  assert.deepEqual(Storage.getDrugCatalog(), savedDrugs);
  const freshAccounts = Storage.getUsers();
  freshAccounts[0].accessSchedule!.days.reverse();
  const freshDrugs = Storage.getDrugCatalogFresh();
  freshDrugs[0].name = 'تعديل المسودة';
  assert.deepEqual(Storage.getUsers(), savedAccounts);
  assert.deepEqual(Storage.getDrugCatalogFresh(), savedDrugs);
  Storage.resetAll();
});

test('confirmed account and drug writes reject silent no-op persistence and retain original records', () => {
  Storage.resetAll();
  Storage.saveUsersConfirmed(makeAccountList());
  Storage.saveDrugCatalogConfirmed(makeDrugCatalog());
  const before = new Map(local);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { ...adapter(local), setItem: () => undefined } });
  try {
    assert.throws(() => Storage.saveUsersConfirmed([]), /لم تُحفظ/);
    assert.throws(() => Storage.saveDrugCatalogConfirmed([]), /لم تُحفظ/);
    assert.deepEqual(local, before);
    assert.deepEqual(Storage.getUsers(), makeAccountList());
    assert.deepEqual(Storage.getDrugCatalog(), makeDrugCatalog());
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { value: adapter(local), configurable: true });
    Storage.resetAll();
  }
});

test('fresh drug reads observe external changes without silently rewriting the catalog', () => {
  Storage.resetAll();
  Storage.saveDrugCatalogConfirmed(makeDrugCatalog());
  const changed = makeDrugCatalog();
  changed[0].name = 'اسم محفوظ من تبويب آخر';
  local.set('dental_drug_catalog_v2', JSON.stringify(changed));
  assert.equal(Storage.getDrugCatalog()[0].name, makeDrugCatalog()[0].name);
  const before = new Map(local);
  assert.deepEqual(Storage.getDrugCatalogFresh(), changed);
  assert.deepEqual(local, before);
  Storage.resetAll();
});

test('legacy backup catalog restores retain absent crown prices and persist imported drugs and accounts explicitly', () => {
  Storage.resetAll();
  const original = makeServiceCatalog();
  Storage.saveServiceCatalog(original);
  Storage.saveLabsConfirmed(makeLabs());
  Storage.savePatients([]);
  const patientBefore = local.get('dental_patients_v2');
  Storage.saveRestoredCatalogs({ serviceTypes: ['خدمة مستوردة'], drugCatalog: makeDrugCatalog(), users: makeAccountList() });
  assert.deepEqual(Storage.getServiceCatalog(), { serviceTypes: ['خدمة مستوردة'], crownPrices: original.crownPrices });
  assert.deepEqual(JSON.parse(local.get('dental_drug_catalog_v2')!), makeDrugCatalog());
  assert.deepEqual(JSON.parse(local.get('dental_users_v2')!), makeAccountList());
  assert.deepEqual(Storage.getLabsFresh(), makeLabs(), 'legacy backups without labs retain existing supplier prices');
  assert.equal(local.get('dental_patients_v2'), patientBefore);
  Storage.resetAll();
});

test('backup catalog restores confirm lab costs and retain unknown fields without changing case snapshots', () => {
  Storage.resetAll();
  Storage.saveServiceCatalog(makeServiceCatalog());
  const historicalCases = Storage.getLabCases();
  Storage.saveLabCases(historicalCases);
  const casesBefore = local.get('dental_lab_cases_v2');
  const restored = makeLabs();
  restored[0].services[0].price = 0;
  Storage.saveRestoredCatalogs({ labs: restored });
  const persisted = JSON.parse(local.get(LABS_STORAGE_KEY)!);
  assert.deepEqual(Storage.getLabsFresh(), restored);
  assert.equal(Storage.getLabs()[0].services[0].price, 0);
  assert.equal(local.get('dental_lab_cases_v2'), casesBefore);
  assert.deepEqual(Storage.getLabCases(), historicalCases);
  assert.deepEqual(Storage.getServiceCatalog(), makeServiceCatalog());
  restored[0].services[0].metadata.tags.push('تعديل لاحق');
  restored[0].metadata.nested.enabled = false;
  assert.deepEqual(Storage.getLabs(), persisted, 'restored backup does not alias cached lab data');
  Storage.resetAll();
});

test('failed imported catalog restore rolls back every selected settings key before domain state can be published', () => {
  Storage.resetAll();
  Storage.saveServiceCatalog(makeServiceCatalog());
  Storage.saveLabsConfirmed(makeLabs());
  Storage.saveDrugCatalogConfirmed(makeDrugCatalog());
  Storage.saveUsersConfirmed(makeAccountList());
  const before = new Map(local);
  let failOnce = true;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    ...adapter(local),
    setItem: (key: string, value: string) => {
      if (key === 'dental_users_v2' && failOnce) { failOnce = false; throw new Error('quota'); }
      local.set(key, value);
    },
  } });
  try {
    assert.throws(() => Storage.saveRestoredCatalogs({ serviceTypes: ['اسم مستورد'], crownPrices: { PFM: 5000 }, labs: [], drugCatalog: [], users: [] }), /لم تُحفظ/);
    assert.deepEqual(local, before);
    assert.deepEqual(Storage.getServiceTypes(), makeServiceCatalog().serviceTypes);
    assert.deepEqual(Storage.getCrownPrices(), makeServiceCatalog().crownPrices);
    assert.deepEqual(Storage.getDrugCatalog(), makeDrugCatalog());
    assert.deepEqual(Storage.getUsers(), makeAccountList());
    assert.deepEqual(Storage.getLabs(), makeLabs());
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { value: adapter(local), configurable: true });
    Storage.resetAll();
  }
});
