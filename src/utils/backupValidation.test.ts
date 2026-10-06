import test from 'node:test';
import assert from 'node:assert/strict';
import { assertClinicBackup, validateClinicBackup } from './backupValidation';
import { DEFAULT_DRUG_CATALOG, DEFAULT_PATIENT_CROWN_PRICES, DEFAULT_SERVICE_TYPES, DEFAULT_THEME, DEFAULT_TILE_ORDER, DEFAULT_UI_LABELS, DEFAULT_USERS, DEFAULT_WHATSAPP_SETTINGS, INITIAL_APPOINTMENTS, INITIAL_EXPENSES, INITIAL_LAB_CASES, INITIAL_LABS, INITIAL_PATIENTS } from '../data/initialData';

const fixtures = () => structuredClone({ patients: INITIAL_PATIENTS, appointments: INITIAL_APPOINTMENTS, labs: INITIAL_LABS,
  labCases: INITIAL_LAB_CASES, expenses: INITIAL_EXPENSES, materialUsages: [], users: DEFAULT_USERS,
  serviceTypes: DEFAULT_SERVICE_TYPES, crownPrices: DEFAULT_PATIENT_CROWN_PRICES, drugCatalog: DEFAULT_DRUG_CATALOG,
  whatsappSettings: DEFAULT_WHATSAPP_SETTINGS, clinicName: 'عيادة اختبار', clinicLogo: null,
  theme: DEFAULT_THEME, labels: DEFAULT_UI_LABELS, tileOrder: DEFAULT_TILE_ORDER });

test('whole backup validation accepts shipped legacy fixtures without repricing historical money', () => {
  const input = fixtures();
  const value = assertClinicBackup(input);
  assert.deepEqual(value.patients, input.patients);
  assert.deepEqual(value.labCases, input.labCases);
  assert.deepEqual(value.labs, input.labs);
  assert.deepEqual(value.theme, input.theme);
  assert.deepEqual(value.labels, input.labels);
});

test('whole backup validation rejects null/malformed nested records and duplicate stable IDs', () => {
  const mutations: ((backup: any) => void)[] = [
    data => { data.labs[0].services = null; }, data => { data.patients[0].sessions = null; },
    data => { data.labCases = {}; }, data => { data.appointments[0].time = '99:99'; },
    data => { data.patients[0].sessions[0].paymentsLog = [null]; }, data => { data.expenses[0].amount = -1; },
    data => { data.labs[0].services[0].price = '400'; }, data => { data.users[0].permissions = null; },
    data => { data.patients.push(structuredClone(data.patients[0])); }, data => { data.users[1].username = data.users[0].username.toUpperCase(); },
    data => { data.patients[0].sessions[0].amount = Infinity; }, data => { data.whatsappSettings.templates.postOp = {}; },
    data => { data.expenses[0].invoiceImageUrl = 'javascript:alert(1)'; }, data => { data.clinicLogo = { unsafe: true }; },
    data => { data.theme.customFontUrl = 'https://attacker.invalid/style.css'; }, data => { data.labels.tiles.patients = null; },
    data => { data.drugCatalog[0].defaultDosage = ['wrong']; }, data => { data.users.forEach((user: any) => { user.isActive = false; }); },
  ];
  mutations.forEach(mutate => { const input = fixtures(); mutate(input); assert.equal(validateClinicBackup(input).valid, false); });
});

test('whole backup validation rejects orphan cases, appointments and foreign linked sessions', () => {
  const input = fixtures(); input.labCases[0].labId = 'missing'; assert.equal(validateClinicBackup(input).valid, false);
  const appointment = fixtures(); appointment.appointments[0].patientId = appointment.appointments[0].fileNo = 'missing'; assert.equal(validateClinicBackup(appointment).valid, false);
  const linked = fixtures(); linked.labCases[0].linkedSessionId = linked.patients[1].sessions[0].id; assert.equal(validateClinicBackup(linked).valid, false);
  const patient = fixtures(); (patient.patients[0].payments[0] as any).linkedSessionId = 'missing'; assert.equal(validateClinicBackup(patient).valid, false);
});

test('partial legacy backups keep omitted sections absent and validate retained-data references through context', () => {
  const value = assertClinicBackup({ clinicName: 'عيادة جديدة', labs: [] });
  assert.equal('patients' in value, false); assert.equal('users' in value, false);
  assert.equal(validateClinicBackup({ labs: [] }, { patients: INITIAL_PATIENTS, labCases: INITIAL_LAB_CASES }).valid, false);
  assert.equal(validateClinicBackup({ patients: [] }, { appointments: INITIAL_APPOINTMENTS }).valid, false);
});

test('validation safely defaults absent optional legacy fields but refuses explicit invalid types', () => {
  const input: any = { patients: [{ id: '1', name: 'مريض اختبار', age: 25, firstVisit: '' }] };
  const value = assertClinicBackup(input);
  assert.deepEqual(value.patients?.[0].sessions, []); assert.deepEqual(value.patients?.[0].payments, []);
  assert.equal(value.patients?.[0].notes, ''); assert.equal(value.patients?.[0].allergy, '');
  assert.equal('notes' in input.patients[0], false);
  input.patients[0].notes = null; assert.equal(validateClinicBackup(input).valid, false);
});

test('unsafe keys, cycles, oversized/deep inputs and credentialless restores fail before any write', () => {
  assert.equal(validateClinicBackup(JSON.parse('{"clinicName":"test","__proto__":{"polluted":true}}')).valid, false);
  const cycle: any = { clinicName: 'test' }; cycle.unknown = cycle; assert.equal(validateClinicBackup(cycle).valid, false);
  let nested: any = {}; const input: any = { clinicName: 'test', unknown: nested };
  for (let i = 0; i < 40; i++) { nested.child = {}; nested = nested.child; }
  assert.equal(validateClinicBackup(input).valid, false);
  const noPassword = fixtures(); delete noPassword.users[0].password; assert.equal(validateClinicBackup(noPassword).valid, false);
  assert.equal(validateClinicBackup({}).valid, false);
});

test('backup clone retains JSON-safe unknown record metadata and omits undefined without mutating source', () => {
  const input: any = fixtures(); input.labs[0].futureField = { nested: ['keep'] }; input.patients[0].gender = undefined;
  const value: any = assertClinicBackup(input); value.labs[0].futureField.nested.push('independent');
  assert.deepEqual(input.labs[0].futureField.nested, ['keep']); assert.equal(Object.hasOwn(value.patients[0], 'gender'), false);
  const credential = fixtures(); credential.users[0].password = 'pbkdf2$future$encoded'; assert.equal(validateClinicBackup(credential).valid, true);
});

test('receipt and invoice item schemas reject corrupt nested totals, nonfinite data and invalid schedules', () => {
  const invoice: any = fixtures(); invoice.expenses[0].items = [{id:'i',itemName:'خامة',quantity:1,unit:'قطعة',unitPrice:5,total:5}];
  assert.equal(validateClinicBackup(invoice).valid, true); invoice.expenses[0].items[0].quantity = 0; assert.equal(validateClinicBackup(invoice).valid, false);
  const schedule: any = fixtures(); schedule.users[0].accessSchedule = { enabled:true,days:[],startTime:'09:00',endTime:'17:00',timezone:'Africa/Cairo' };
  assert.equal(validateClinicBackup(schedule).valid, false);
});
