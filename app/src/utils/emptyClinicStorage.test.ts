import test from 'node:test';
import assert from 'node:assert/strict';
import { Storage, STORAGE_FAILURE_EVENT, PROSTHETIC_ROUTING_STORAGE_KEY } from './storage';
import type { Appointment, ClinicContact, Expense, Lab, LabCase, MaterialUsage, Patient } from '../types';

const local = new Map<string, string>();
const session = new Map<string, string>();
const events = new EventTarget();
const adapter = (map: Map<string, string>) => ({
  getItem: (key: string) => map.get(key) ?? null,
  setItem: (key: string, value: string) => { map.set(key, value); },
  removeItem: (key: string) => { map.delete(key); },
});
const installAdapter = (value = adapter(local)) => Object.defineProperty(globalThis, 'localStorage', { value, configurable: true });
Object.defineProperty(globalThis, 'sessionStorage', { value: adapter(session), configurable: true });
Object.defineProperty(globalThis, 'window', { value: events, configurable: true });
installAdapter();

const operationalKeys = [
  'dental_patients_v2', 'dental_contacts', 'dental_appointments_v2', 'dental_labs_v2',
  'dental_lab_cases_v2', 'dental_expenses_v2', 'dental_material_usages_v1',
] as const;
const operationalSections = ['patients', 'contacts', 'appointments', 'labs', 'labCases', 'expenses', 'materialUsages'] as const;

function resetSyntheticStorage(): void {
  installAdapter();
  local.clear();
  session.clear();
  Storage.resetAll();
}

function syntheticSnapshot() {
  const patients: Patient[] = [{ id: 'synthetic-file', name: 'اسم اختبار', mobile: '', age: 30,
    firstVisit: '2026-10-08', notes: '', allergy: '', sessions: [], payments: [] }];
  const contacts: ClinicContact[] = [{ id: 'synthetic-contact', name: 'جهة اختبار', mobile: '01000000001', createdAt: '2026-10-08T10:00:00.000Z' }];
  const appointments: Appointment[] = [{ id: 'synthetic-appointment', patientId: patients[0].id,
    fileNo: patients[0].id, patientName: patients[0].name, mobile: '', date: '2026-10-08', time: '10:00',
    note: '', isFollowUp: false, isWalkIn: false, status: 'scheduled' }];
  const labs: Lab[] = [{ id: 'synthetic-lab', name: 'معمل اختبار', services: [] }];
  const labCases: LabCase[] = [{ id: 'synthetic-case', labId: labs[0].id, labName: labs[0].name,
    patientId: patients[0].id, patientName: patients[0].name, fileNo: patients[0].id,
    type: 'fixed', subType: 'synthetic', units: 1, unitLabel: 'وحدة', labTotal: 10, labPaid: 0,
    patientTotal: 20, patientPaid: 0, date: '2026-10-08', status: 'pending' }];
  const expenses: Expense[] = [{ id: 'synthetic-expense', title: 'مصروف اختبار', category: 'other', amount: 5, date: '2026-10-08' }];
  const materialUsages: MaterialUsage[] = [{ id: 'synthetic-usage', materialKey: 'synthetic-material',
    materialName: 'خامة اختبار', quantity: 1, unit: 'وحدة', date: '2026-10-08', kind: 'used', unitCostAtUse: 1 }];
  return { patients, contacts, appointments, labs, labCases, expenses, materialUsages };
}

function readOperationalLists() {
  return { patients: Storage.getPatients(), contacts: Storage.getContacts(), appointments: Storage.getAppointments(),
    labs: Storage.getLabs(), labCases: Storage.getLabCases(), expenses: Storage.getExpenses(), materialUsages: Storage.getMaterialUsages() };
}

test('fresh missing storage starts all seven operational lists empty without writing defaults', () => {
  resetSyntheticStorage();
  const lists = readOperationalLists();
  for (const section of operationalSections) assert.deepEqual(lists[section], [], section);
  const domain = Storage.getDomainData();
  for (const section of ['patients', 'contacts', 'appointments', 'labCases', 'expenses', 'materialUsages'] as const) {
    assert.deepEqual(domain[section], [], section);
  }
  assert.deepEqual(Storage.getLabsFresh(), []);
  assert.deepEqual(Storage.getLabCasesFresh(), []);
  assert.deepEqual(Storage.getContactsFresh(), []);
  const backup = Storage.getBackupDataFresh();
  for (const section of operationalSections) assert.deepEqual(backup[section], [], `backup.${section}`);
  assert.equal(local.size, 0, 'reading an empty clinic does not persist fixtures/accounts/settings');
  assert.equal(session.size, 0);
});

test('changing operational defaults does not delete or replace existing saved records', () => {
  resetSyntheticStorage();
  const saved = syntheticSnapshot();
  Storage.saveBackupConfirmed(saved);
  const before = new Map(local);
  assert.deepEqual(readOperationalLists(), saved);
  assert.deepEqual(Storage.getLabsFresh(), saved.labs);
  assert.deepEqual(Storage.getLabCasesFresh(), saved.labCases);
  const backup = Storage.getBackupDataFresh();
  for (const section of operationalSections) assert.deepEqual(backup[section], saved[section]);
  assert.deepEqual(local, before, 'reads never perform an implicit demo purge');
});

test('explicit empty clinic writes seven arrays, clears dependent lab routing and preserves other config/session', () => {
  resetSyntheticStorage();
  Storage.saveBackupConfirmed(syntheticSnapshot());
  const preserved = {
    dental_users_v2: [{ id: 'synthetic-owner', username: 'synthetic-owner', password: 'synthetic-hash', permissions: {} }],
    dental_theme_v2: { primary: '#123456' }, dental_ui_labels_v2: { custom: 'keep' },
    dental_tile_order_v2: ['settings', 'patients'], dental_service_types_v2: ['خدمة اختبار'],
    dental_crown_prices_v2: { synthetic: 3 }, dental_clinic_name_v2: 'عيادة اختبار',
    dental_clinic_logo_v2: 'synthetic-logo', dental_whatsapp_settings_v2: { apiKey: 'synthetic-provider-value', templates: {} },
    dental_drug_catalog_v2: [{ id: 'synthetic-drug' }], dental_privacy_mode_v2: false,
    dental_current_user_v2: { id: 'synthetic-legacy-session' }, dental_remembered_session_v2: { userId: 'synthetic-owner' },
    dental_clinic_pending_mutations: [{ id: 'synthetic-pending' }], dental_clinic_last_sync_time: 1,
    dental_device_mode: 'desktop', unrelated_key: 'untouched',
  };
  for (const [key, value] of Object.entries(preserved)) local.set(key, JSON.stringify(value));
  session.set('dental_current_user_v2', JSON.stringify({ id: 'synthetic-current-session' }));
  session.set('unrelated_session', 'untouched');
  const before = new Map(local);
  const beforeSession = new Map(session);
  const writes: string[] = [];
  const removals: string[] = [];
  installAdapter({ ...adapter(local),
    setItem(key, value) { writes.push(key); local.set(key, value); },
    removeItem(key) { removals.push(key); local.delete(key); },
  });
  try {
    Storage.clearOperationalDataConfirmed();
    assert.deepEqual(writes, [...operationalKeys, PROSTHETIC_ROUTING_STORAGE_KEY]);
    assert.deepEqual(removals, []);
    for (const key of operationalKeys) assert.equal(local.get(key), '[]', key);
    for (const [key, value] of before) {
      if (!operationalKeys.includes(key as typeof operationalKeys[number])) assert.equal(local.get(key), value, key);
    }
    assert.deepEqual(Storage.getProstheticRouting(), { defaultLabs: {}, overrides: [] });
    assert.equal(local.size, new Set([...before.keys(), PROSTHETIC_ROUTING_STORAGE_KEY]).size);
    assert.deepEqual(session, beforeSession);
    for (const value of Object.values(readOperationalLists())) assert.deepEqual(value, []);
    assert.deepEqual(Storage.getLabsFresh(), []);
    assert.deepEqual(Storage.getDomainData(), { patients: [], contacts: [], appointments: [], labCases: [], expenses: [], materialUsages: [] });
  } finally { installAdapter(); }
});

test('explicit clear of missing lists persists empty arrays and empty routing without creating account/catalog keys', () => {
  resetSyntheticStorage();
  Storage.clearOperationalDataConfirmed();
  assert.deepEqual([...local.keys()], [...operationalKeys, PROSTHETIC_ROUTING_STORAGE_KEY]);
  for (const key of operationalKeys) assert.equal(local.get(key), '[]');
  assert.deepEqual(Storage.getProstheticRouting(), { defaultLabs: {}, overrides: [] });
  assert.equal(session.size, 0);
  assert.deepEqual(Storage.getBackupDataFresh().patients, []);
});

test('empty clinic clears pointers to deleted labs and rolls back routing together with all lists on failed confirmation', () => {
  resetSyntheticStorage();
  Storage.saveBackupConfirmed(syntheticSnapshot());
  Storage.saveProstheticRouting({ defaultLabs: { fixed: 'synthetic-lab' }, overrides: [] });
  const before = new Map(local);
  let failOnce = true;
  installAdapter({ ...adapter(local), setItem(key, value) {
    local.set(key, value);
    if (key === PROSTHETIC_ROUTING_STORAGE_KEY && failOnce) { failOnce = false; throw new Error('synthetic quota'); }
  } });
  try {
    assert.throws(() => Storage.clearOperationalDataConfirmed(), /لم تُحفظ/);
    assert.deepEqual(local, before);
    assert.equal(Storage.getProstheticRouting().defaultLabs.fixed, 'synthetic-lab');
  } finally { installAdapter(); }
  Storage.clearOperationalDataConfirmed();
  assert.deepEqual(Storage.getProstheticRouting(), { defaultLabs: {}, overrides: [] });
  assert.deepEqual(Storage.getBackupDataFresh().prostheticRouting, { defaultLabs: {}, overrides: [] });
});

test('a thrown write at any operational key rolls back earlier writes and leaves caches/session intact', () => {
  for (const failureKey of operationalKeys) {
    resetSyntheticStorage();
    const saved = syntheticSnapshot();
    Storage.saveBackupConfirmed(saved);
    session.set('dental_current_user_v2', 'synthetic-session');
    const before = new Map(local);
    const beforeSession = new Map(session);
    readOperationalLists();
    let failOnce = true;
    let failureEvents = 0;
    const onFailure = () => { failureEvents++; };
    events.addEventListener(STORAGE_FAILURE_EVENT, onFailure);
    installAdapter({ ...adapter(local), setItem(key, value) {
      local.set(key, value);
      if (key === failureKey && failOnce) { failOnce = false; throw new Error('synthetic quota failure after write'); }
    } });
    try {
      assert.throws(() => Storage.clearOperationalDataConfirmed(), /لم تُحفظ التغييرات/);
      assert.deepEqual(local, before, failureKey);
      assert.deepEqual(session, beforeSession);
      assert.deepEqual(readOperationalLists(), saved, 'unconfirmed empty arrays never enter the cache');
      assert.equal(failureEvents, 1);
    } finally {
      installAdapter();
      events.removeEventListener(STORAGE_FAILURE_EVENT, onFailure);
    }
  }
});

test('silent no-op at any operational key is not success; retry publishes empty lists only after confirmation', () => {
  for (const failureKey of operationalKeys) {
    resetSyntheticStorage();
    const saved = syntheticSnapshot();
    Storage.saveBackupConfirmed(saved);
    const before = new Map(local);
    readOperationalLists();
    installAdapter({ ...adapter(local), setItem(key, value) {
      if (key === failureKey && value === '[]') return;
      local.set(key, value);
    } });
    try {
      assert.throws(() => Storage.clearOperationalDataConfirmed(), /لم تُحفظ التغييرات/);
      assert.deepEqual(local, before, failureKey);
      assert.deepEqual(readOperationalLists(), saved);
    } finally { installAdapter(); }
    Storage.clearOperationalDataConfirmed();
    for (const value of Object.values(readOperationalLists())) assert.deepEqual(value, []);
    for (const key of operationalKeys) assert.equal(local.get(key), '[]');
  }
});
