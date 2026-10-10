import test from 'node:test';
import assert from 'node:assert/strict';
import { assertClinicBackup, validateClinicBackup } from './backupValidation';
import { DEFAULT_DRUG_CATALOG, DEFAULT_PATIENT_CROWN_PRICES, DEFAULT_SERVICE_TYPES, DEFAULT_THEME, DEFAULT_TILE_ORDER, DEFAULT_UI_LABELS, DEFAULT_USERS, DEFAULT_WHATSAPP_SETTINGS, INITIAL_APPOINTMENTS, INITIAL_EXPENSES, INITIAL_LAB_CASES, INITIAL_LABS, INITIAL_PATIENTS } from '../data/initialData';

const fixtures = () => structuredClone({ patients: INITIAL_PATIENTS, appointments: INITIAL_APPOINTMENTS, labs: INITIAL_LABS,
  labCases: INITIAL_LAB_CASES, expenses: INITIAL_EXPENSES, materialUsages: [], users: DEFAULT_USERS,
  serviceTypes: DEFAULT_SERVICE_TYPES, crownPrices: DEFAULT_PATIENT_CROWN_PRICES, drugCatalog: DEFAULT_DRUG_CATALOG,
  whatsappSettings: DEFAULT_WHATSAPP_SETTINGS, clinicName: 'عيادة اختبار', clinicLogo: null,
  theme: DEFAULT_THEME, labels: DEFAULT_UI_LABELS, tileOrder: DEFAULT_TILE_ORDER });

const backupContact = () => ({ id: 'contact-backup-test', name: 'جهة اختبار', mobile: '01012345678', notes: '', createdAt: '2026-10-07T09:00:00.000Z' });

test('contacts are recognized independently from files and legacy backups keep their omission', () => {
  const input = { contacts: [{ ...backupContact(), future: { tags: ['keep'] } }] };
  const value = assertClinicBackup(input);
  assert.deepEqual(value.contacts, input.contacts);
  assert.equal('patients' in value, false);
  (value.contacts![0] as typeof input.contacts[0]).future.tags.push('independent');
  assert.deepEqual(input.contacts[0].future.tags, ['keep']);
  assert.equal('contacts' in assertClinicBackup(fixtures()), false);
  assert.deepEqual(assertClinicBackup({ contacts: [] }).contacts, []);
});

test('contact backup validation rejects malformed rows, duplicates and invalid names, phones or timestamps', () => {
  const invalid: unknown[] = [null, {}, [null], [{ ...backupContact(), name: '' }], [{ ...backupContact(), name: 'n'.repeat(201) }],
    [{ ...backupContact(), notes: 'n'.repeat(2001) }], [{ ...backupContact(), mobile: 'name01012345678' }],
    [{ ...backupContact(), mobile: '0101234567' }], [{ ...backupContact(), createdAt: '2026-02-31T09:00:00.000Z' }],
    [{ ...backupContact(), createdAt: undefined }], [backupContact(), { ...backupContact(), id: 'other', mobile: '+201012345678' }],
    [backupContact(), { ...backupContact(), mobile: '01112345678' }]];
  invalid.forEach(contacts => assert.equal(validateClinicBackup({ contacts }).valid, false));
});

test('contacts sharing an existing patient mobile remain separate records without auto-merging or consent', () => {
  const input = { patients: [{ id: '401', name: 'مريض تجريبي', age: 30, mobile: '+201012345678' }],
    contacts: [backupContact()] };
  const value = assertClinicBackup(input);
  assert.equal(value.contacts?.length, 1);
  assert.equal(value.patients?.length, 1);
  assert.equal(value.patients?.[0].id, '401');
  assert.equal('whatsappSettings' in value, false);
});

test('whole backup validation accepts shipped legacy fixtures without repricing historical money', () => {
  const input = fixtures();
  const value = assertClinicBackup(input);
  assert.deepEqual(value.patients, input.patients);
  assert.deepEqual(value.labCases, input.labCases);
  assert.deepEqual(value.labs, input.labs);
  assert.deepEqual(value.theme, input.theme);
  assert.deepEqual(value.labels, input.labels);
});

test('clinical prices and examination defaults are optional backup settings, not historical visit migration', () => {
  const input = { clinicalPrices: { 'حشو': 350, 'تنظيف': 0 }, examinationFee: 0, crownPrices: { PFM: 1200, 'نوع مخصص': 2500 } };
  const result = assertClinicBackup(input);
  assert.deepEqual(result, input);
  result.clinicalPrices!['حشو'] = 999;
  assert.equal(input.clinicalPrices['حشو'], 350);
  const legacy = assertClinicBackup({ crownPrices: { PFM: 1200 } });
  assert.equal('clinicalPrices' in legacy, false); assert.equal('examinationFee' in legacy, false);
  for (const clinicalPrices of [[], null, 'bad', { 'حشو': -1 }, { 'حشو': '350' }, { 'حشو': 1, 'حَشو': 2 }, { '': 100 }]) assert.equal(validateClinicBackup({ clinicalPrices }).valid, false);
  for (const examinationFee of [-1, null, '100', NaN, Infinity, 100.123]) assert.equal(validateClinicBackup({ examinationFee }).valid, false);
});

test('service-specific tooth backup binding accepts only exact permanent or primary quadrant notation', () => {
  const patient = { id: '401', name: 'مريض اختبار', age: 30, mobile: '', sessions: [{ id: 'session-test', type: 'حشو', date: '2026-10-10', amount: 100, paid: 0, services: [{ id: 'service-test', name: 'حشو', price: 100 }] }], payments: [] };
  assert.equal(validateClinicBackup({ patients: [patient] }).valid, true);
  for (const tooth of [null, 'ur1', 'll8', 'ulA', 'lrE']) assert.equal(validateClinicBackup({ patients: [{ ...patient, sessions: [{ ...patient.sessions[0], services: [{ ...patient.sessions[0].services[0], tooth }] }] }] }).valid, true);
  for (const tooth of ['ur0', 'ur9', 'UR1', 'primaryurA', 'urA ', 'ur1junk', 'ur\n1', 1, [], {}]) assert.equal(validateClinicBackup({ patients: [{ ...patient, sessions: [{ ...patient.sessions[0], services: [{ ...patient.sessions[0].services[0], tooth }] }] }] }).valid, false, String(tooth));
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

test('partial patient restores check retained legacy appointments linked only by fileNo', () => {
  const patient: any = { id: '401', name: 'مريض اختبار', mobile: '', age: 30, sessions: [], payments: [] };
  const appointment: any = { id: 'legacy-appointment', fileNo: '401', patientName: 'مريض اختبار', mobile: '', date: '2026-10-07', time: '17:30',
    note: '', status: 'scheduled', isFollowUp: false, isWalkIn: false };
  assert.equal(validateClinicBackup({ patients: [] }, { appointments: [appointment] }).valid, false);
  const retained = assertClinicBackup({ patients: [patient] }, { appointments: [appointment] });
  assert.equal(retained.patients?.[0].id, '401');
  assert.equal('appointments' in retained, false);
  assert.equal('patientId' in appointment, false);
});

test('backup patient IDs reject canonical Arabic and Persian collisions without rewriting identities', () => {
  const patient: any = { id: '401', name: 'مريض اختبار', mobile: '', age: 30 };
  for (const id of ['٤٠١', '۴۰۱', ' 401 ']) {
    assert.equal(validateClinicBackup({ patients: [patient, { ...patient, id }] }).valid, false);
  }
  const single = assertClinicBackup({ patients: [{ ...patient, id: '٤٠١' }] });
  assert.equal(single.patients?.[0].id, '٤٠١');
  const leadingZero = assertClinicBackup({ patients: [{ ...patient, id: '001' }, { ...patient, id: '1' }] });
  assert.deepEqual(leadingZero.patients?.map(row => row.id), ['001', '1']);
});

test('legacy references resolve exact IDs first, and canonical IDs only when unique', () => {
  const patient: any = { id: '401', name: 'مريض اختبار', mobile: '', age: 30, sessions: [], payments: [] };
  const appointment: any = { id: 'legacy-appointment', fileNo: '٤٠١', patientName: 'مريض اختبار', mobile: '', date: '2026-10-07', time: '17:30',
    note: '', status: 'scheduled', isFollowUp: false, isWalkIn: false };
  assert.equal(validateClinicBackup({ clinicName: 'عيادة اختبار' }, { patients: [patient], appointments: [appointment] }).valid, true);
  const legacyPatients = [patient, { ...patient, id: '٤٠١' }];
  assert.equal(validateClinicBackup({ clinicName: 'عيادة اختبار' }, { patients: legacyPatients, appointments: [appointment] }).valid, true);
  assert.equal(validateClinicBackup({ clinicName: 'عيادة اختبار' }, { patients: legacyPatients, appointments: [{ ...appointment, fileNo: '۴۰۱' }] }).valid, false);
  assert.equal(validateClinicBackup({ clinicName: 'عيادة اختبار' }, { patients: [{ ...patient, id: '001' }], appointments: [{ ...appointment, fileNo: '1' }] }).valid, false);
});

test('canonical lab references cannot associate two cases with the same retained session', () => {
  const input = fixtures();
  const linked = { ...input.labCases[0], linkedSessionId: input.patients[0].sessions[0].id };
  const arabicId = linked.patientId.replace(/\d/g, digit => '٠١٢٣٤٥٦٧٨٩'[Number(digit)]);
  const alternate = { ...linked, id: 'second-lab-case', patientId: arabicId, fileNo: arabicId };
  input.labCases = [linked, alternate];
  assert.equal(validateClinicBackup(input).valid, false);
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

test('prosthetic routing round-trips and partial legacy imports cannot orphan retained lab/material links', () => {
  const labs = [{ id: 'synthetic-route-lab', name: 'معمل مصطنع', services: [{ id: 'synthetic-route-service', name: 'زيركون', category: 'fixed' as const, price: 300, unitLabel: 'كراون' }] }];
  const prostheticRouting = { defaultLabs: { fixed: labs[0].id }, overrides: [{ kind: 'fixed' as const, material: 'زيركون', labId: labs[0].id, labServiceId: labs[0].services[0].id }] };
  const crownPrices = { 'زيركون': 1500 };
  const input = { labs, crownPrices, prostheticRouting };
  const value = assertClinicBackup(input);
  assert.deepEqual(value.prostheticRouting, prostheticRouting);
  assert.notEqual(value.prostheticRouting!.overrides[0], prostheticRouting.overrides[0]);
  const context = { labs, crownPrices, prostheticRouting };
  assert.equal(validateClinicBackup({ labs: [] }, context).valid, false);
  assert.equal(validateClinicBackup({ crownPrices: {} }, context).valid, false);
  assert.equal(validateClinicBackup({ labs: [{ ...labs[0], services: [] }] }, context).valid, false);
  const legacy = assertClinicBackup({ clinicName: 'عيادة مصطنعة' }, context);
  assert.equal('prostheticRouting' in legacy, false, 'omitted legacy sections remain omitted rather than being copied into the imported draft');
  assert.equal(validateClinicBackup({ labs: [], crownPrices: {}, prostheticRouting: { defaultLabs: {}, overrides: [] } }, context).valid, true);
});
