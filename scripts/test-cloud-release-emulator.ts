/** Combined release Rules-engine runner, DEMO namespace only. Never imports IAM
 * or production helpers. Explicit invocation, loopback endpoint, fabricated
 * Auth and records; every reset is hardcoded to this disposable project.
 * pnpm exec tsx scripts/test-cloud-release-emulator.ts --demo-emulator [domain]
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase/app';
import { connectFirestoreEmulator, getFirestore, doc, getDoc, collection, getDocs, query, where, orderBy,
  documentId, limit, writeBatch, runTransaction, setLogLevel } from 'firebase/firestore/lite';
import { createCloudOperationIntentRepository, type CloudOperationKind } from '../src/utils/cloudOperationIntent';
import { createJournaledCloudPatientRepository } from '../src/utils/cloudPatientRepository';
import { createJournaledCloudContactRepository } from '../src/utils/cloudContactRepository';
import { createCloudServiceCatalogRepository, normalizedCloudServiceName } from '../src/utils/cloudServiceCatalogRepository';
import { createCloudClinicalRepository } from '../src/utils/cloudClinicalRepository';
import { createCloudAppointmentRepository } from '../src/utils/cloudAppointmentRepository';
import { createCloudExpenseRepository } from '../src/utils/cloudExpenseRepository';
import { createCloudClinicSettingsRepository } from '../src/utils/cloudClinicSettingsRepository';
import { createCloudProstheticRepository } from '../src/utils/cloudProstheticRepository';

const PROJECT = 'demo-clinic-release-rules', BASE = 'http://127.0.0.1:8789';
const UID = 'synthetic-release-owner', WHEN = '2026-10-12T00:00:00.000Z', DAY = '2026-10-12';
const id = (n: number) => `80000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const path = (collection: string, key: string | number) => `clinics/main/${collection}/${key}`;
if (process.argv[2] !== '--demo-emulator' || process.env.FIRESTORE_EMULATOR_HOST && process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8789')
  throw new Error('Explicit isolated release DEMO emulator required.');
setLogLevel('silent');
const digest = async (text: string) => createHash('sha256').update(text).digest('hex');
const digestBytes = async (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const member = { schemaVersion: 1, clinicId: 'main', uid: UID, role: 'owner', status: 'active', identityVersion: 1, verifiedAfter: 100 };
const token = { uid: UID, token: { email_verified: true, dentalClinicId: 'main', dentalClinicRole: 'owner',
  auth_time: 100, firebase: { sign_in_provider: 'password' } } };
const profile = { name: 'مريض مصطنع', mobile: '', age: 30, gender: '', firstVisit: DAY, notes: '', allergy: '' };
const envelope = (recordId: string, data: unknown) => ({ schemaVersion: 1, clinicId: 'main', recordId, revision: 1, lastOperationId: id(999), data });
const patient = { ...envelope(id(101), profile), fileNo: 401, phoneKey: null };
const seedBase = () => new Map<string, any>([[path('members', UID), member],
  [path('counters', 'patientFiles'), { schemaVersion: 1, clinicId: 'main', lastFileNo: 0, lastOperationId: null }]]);
const seedPatient = () => new Map<string, any>([...seedBase(), [path('patientProfiles', id(101)), patient],
  [path('patientFiles', 401), { schemaVersion: 1, clinicId: 'main', fileNo: 401, recordId: id(101) }]]);
function encode(value: any): any {
  if (value === null) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)])) } };
}
async function admin(endpoint: string, method: string, body?: object) {
  const url = new URL(endpoint, BASE); assert.equal(url.origin, BASE); assert.ok(url.pathname.includes(`/projects/${PROJECT}`));
  const response = await fetch(url, { method, headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!response.ok) { const result = await response.text(); throw new Error(`DEMO setup ${response.status}: ${result.slice(0, 2000)}`); }
  return response;
}
async function seed(rows: Map<string, any>) {
  await admin(`/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, 'DELETE');
  if (rows.size) await admin(`/v1/projects/${PROJECT}/databases/(default)/documents:commit`, 'POST', {
    writes: [...rows].map(([key, data]) => ({ update: { name: `projects/${PROJECT}/databases/(default)/documents/${key}`, fields: encode(data).mapValue.fields } })),
  });
}
function client(auth: typeof token | null = token) {
  const app = initializeApp({ projectId: PROJECT, apiKey: 'demo-only-no-production-key' }, `release-demo-${randomUUID()}`);
  const database = getFirestore(app);
  const payload = auth && { iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, iat: 1800000000, exp: 4102444800,
    ...auth.token, sub: auth.uid, user_id: auth.uid };
  const mockUserToken = payload && `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.`;
  connectFirestoreEmulator(database, '127.0.0.1', 8789, mockUserToken ? { mockUserToken } : undefined);
  return { app, database };
}
type Scenario = { name: string; kind: CloudOperationKind; command: any; before: Map<string, any>; after: Map<string, any>; writes: Map<string, any>;
  preparationBefore?: Map<string, any>; preparations?: Map<string, any> };
function memory(rows: Map<string, any>) {
  const adapter: any = { authorizeOwner: async () => UID,
    runTransaction: async (work: any) => { const staged = structuredClone(rows); const result = await work({
      get: async (key: string) => structuredClone(staged.get(key) ?? null), set: (key: string, data: object) => staged.set(key, structuredClone(data)),
      delete: (key: string) => staged.delete(key),
    }); rows.clear(); staged.forEach((data, key) => rows.set(key, data)); return result; } };
  return adapter;
}
const domain = (kind: CloudOperationKind, adapter: any): any => ({ 'patient-profile': createJournaledCloudPatientRepository,
  contact: createJournaledCloudContactRepository, catalog: createCloudServiceCatalogRepository, clinical: createCloudClinicalRepository,
  appointment: createCloudAppointmentRepository, expense: createCloudExpenseRepository, settings: createCloudClinicSettingsRepository,
  prosthetic: createCloudProstheticRepository })[kind](adapter, { digest, digestBytes });
async function scenario(name: string, kind: CloudOperationKind, command: any, initial = seedBase(), image?: string): Promise<Scenario> {
  const rows = structuredClone(initial), adapter = memory(rows), journal = createCloudOperationIntentRepository(adapter, { digest });
  await journal.prepare(kind, command, WHEN); const before = structuredClone(rows);
  await domain(kind, adapter).commit(command, image); const after = structuredClone(rows), writes = new Map<string, any>();
  for (const [key, value] of after) if (JSON.stringify(value) !== JSON.stringify(before.get(key))) writes.set(key, value);
  for (const key of before.keys()) if (!after.has(key)) writes.set(key, null);
  // Validation proofs are separate durable preparation requests, never a
  // financial partial commit. Test their real Rules independently before the
  // final atomic write, exactly as the production repository now does.
  const preparations = new Map([...writes].filter(([key]) => key.includes('/clinicalSessionProofs/')));
  const preparationBefore = preparations.size ? structuredClone(before) : undefined;
  for (const [key, value] of preparations) { before.set(key, value); writes.delete(key); }
  return { name, kind, command, before, after, writes, preparationBefore, preparations };
}
const scenarios: Scenario[] = [];
async function collect() {
  const p = await scenario('patient-create', 'patient-profile', { operationId: id(1), recordId: id(101), expectedRevision: 0, action: 'create', profile });
  scenarios.push(p, await scenario('patient-update', 'patient-profile', { ...p.command, operationId: id(2), expectedRevision: 1,
    action: 'update', profile: { ...profile, name: 'مريض مصطنع معدل' } }, p.after));
  const high=await scenario('patient-import-high','patient-profile',{operationId:id(6),recordId:id(106),expectedRevision:0,action:'import',fileNo:450,
    profile:{...profile,firstVisit:''}});
  const low=await scenario('patient-import-low','patient-profile',{operationId:id(7),recordId:id(107),expectedRevision:0,action:'import',fileNo:12,
    profile:{...profile,firstVisit:''}},high.after);
  scenarios.push(high,low,await scenario('patient-create-after-import','patient-profile',{operationId:id(8),recordId:id(108),expectedRevision:0,
    action:'create',profile},low.after));
  const c = await scenario('contact-create', 'contact', { operationId: id(3), recordId: id(201), expectedRevision: 0, action: 'create',
    contact: { id: id(201), name: 'جهة مصطنعة', mobile: '01012345678', createdAt: WHEN } });
  const cu = await scenario('contact-update-phone', 'contact', { ...c.command, operationId: id(4), expectedRevision: 1, action: 'update',
    contact: { ...c.command.contact, mobile: '01012345679' } }, c.after);
  scenarios.push(c, cu, await scenario('contact-delete', 'contact', { ...c.command, operationId: id(5), expectedRevision: 2, action: 'delete', contact: null }, cu.after));
  const consent=await scenario('contact-explicit-campaign-consent','contact',{...c.command,operationId:id(220),recordId:id(221),
    contact:{...c.command.contact,id:id(221),campaignConsent:{status:'allowed',phone:'201012345678',recordedAt:WHEN}}});
  scenarios.push(consent,await scenario('contact-explicit-campaign-decline','contact',{...consent.command,operationId:id(222),expectedRevision:1,action:'update',
    contact:{...consent.command.contact,campaignConsent:{...consent.command.contact.campaignConsent,status:'declined'}}},consent.after));
  const exam = await scenario('catalog-initialize-examination', 'catalog', { mutationVersion: 2, action: 'examination',
    operationId: id(10), expectedRevision: 0, createdAt: WHEN, examinationCents: 10000 });
  const append = await scenario('catalog-append-service', 'catalog', { mutationVersion: 2, action: 'service',
    operationId: id(11), expectedRevision: 1, createdAt: WHEN, index: 0,
    service: { serviceId: id(1000), name: 'خدمة 0', kind: 'clinical', priceCents: 5000, active: true } }, exam.after);
  scenarios.push(exam, append, await scenario('catalog-edit-price', 'catalog', { ...append.command, operationId: id(12), expectedRevision: 2,
    service: { ...append.command.service, priceCents: 7000 } }, append.after),
  await scenario('catalog-rename-service', 'catalog', { ...append.command, operationId: id(13), expectedRevision: 2,
    service: { ...append.command.service, name: 'خدمة معدلة' } }, append.after));
  const inactive = structuredClone(append.after); inactive.set(path('settings', 'prostheticRouting'), envelope('prostheticRouting', { routes: [] }));
  scenarios.push(await scenario('catalog-disable-unrouted', 'catalog', { ...append.command, operationId: id(14), expectedRevision: 2,
    service: { ...append.command.service, active: false } }, inactive));
  for (const count of [8, 32, 100, 299, 300]) {
    const initial = seedBase(), services = Array.from({ length: count }, (_, n) => ({ serviceId: id(1000 + n), name: `خدمة ${n}`,
      kind: 'clinical' as const, priceCents: 5000, active: true }));
    initial.set(path('settings', 'serviceCatalog'), envelope('serviceCatalog', { examinationCents: 10000, services }));
    for (let n = 0; n < count; n++) {
      const nameKey = await digest(`catalog-service-name-v2:${normalizedCloudServiceName(services[n].name)}`);
      initial.set(path('catalogServiceIds', services[n].serviceId), { schemaVersion: 1, clinicId: 'main', recordId: services[n].serviceId,
        index: n, nameKey, revision: 1, lastOperationId: id(999) });
      initial.set(path('catalogServiceNames', nameKey), { schemaVersion: 1, clinicId: 'main', nameKey, serviceId: services[n].serviceId });
    }
    scenarios.push(await scenario(`catalog-edit-at-${count}-rows`, 'catalog', { ...append.command, operationId: id(20 + count), expectedRevision: 1,
      index: count - 1, service: { ...services[count - 1], priceCents: 7000 } }, initial));
    if (count === 299) scenarios.push(await scenario('catalog-append-300th', 'catalog', { ...append.command, operationId: id(399), expectedRevision: 1,
      index: count, service: { ...services[0], serviceId: id(1299), name: 'خدمة 299' } }, initial));
  }
  const visit = await scenario('clinical-visit', 'clinical', { operationId: id(400), patientId: id(101), sessionId: id(400), expectedRevision: 0,
    createdAt: WHEN, action: 'visit', paidCents: 2000, data: { type: 'حشو', date: DAY, teethIds: ['ur1'], services: [
      { id: id(401), name: 'حشو', priceCents: 10000, tooth: 'ur1' }], examinationCents: 10000,
      notes: '', treatmentStage: 'first', rootCanalStatus: '', visitStatus: 'follow_up' } }, seedPatient());
  scenarios.push(visit, await scenario('clinical-payment', 'clinical', { operationId: id(402), patientId: id(101), sessionId: id(400), expectedRevision: 1,
    createdAt: WHEN, action: 'payment', amountCents: 1000, date: DAY, note: '' }, visit.after),
  await scenario('clinical-progress', 'clinical', { operationId: id(403), patientId: id(101), sessionId: id(400), expectedRevision: 1,
    createdAt: WHEN, action: 'progress', changes: { notes: 'متابعة', treatmentStage: 'second', rootCanalStatus: '', visitStatus: 'follow_up' } }, visit.after));
  scenarios.push(await scenario('clinical-visit-unpaid', 'clinical', { ...visit.command, operationId: id(405), sessionId: id(405), paidCents: 0 }, seedPatient()),
    await scenario('clinical-examination-only', 'clinical', { ...visit.command, operationId: id(406), sessionId: id(406), paidCents: 0,
      data: { ...visit.command.data, services: [], teethIds: [], type: 'كشف', examinationCents: 10000 } }, seedPatient()));
  for (const count of [2, 4, 8, 16, 64]) scenarios.push(await scenario(`clinical-${count}-services`, 'clinical', {
    ...visit.command, operationId: id(410 + count), sessionId: id(410 + count), paidCents: 0,
    data: { ...visit.command.data, services: Array.from({ length: count }, (_, n) => ({ ...visit.command.data.services[0], id: id(2000 + n) })) } }, seedPatient()));
  const appt = await scenario('appointment-create', 'appointment', { operationId: id(500), recordId: id(501), expectedRevision: 0, createdAt: WHEN,
    data: { patientRecordId: null, patientName: 'موعد مصطنع', phone: '', date: DAY, time: '10:00', durationMinutes: 30, status: 'scheduled',
      reason: '', notes: '', doctorName: '', appointmentType: '', isFollowUp: false, isWalkIn: false } });
  scenarios.push(appt, await scenario('appointment-cancel', 'appointment', { ...appt.command, operationId: id(502), expectedRevision: 1,
    data: { ...appt.command.data, status: 'cancelled' } }, appt.after));
  const otherDay='2026-10-13';
  const clock=(minute:number)=>`${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`;
  const appointmentSeed=(count:number,date=DAY,offset=0)=>{
    const rows=seedBase(),slots=Array.from({length:count},(_,n)=>({recordId:id(5000+offset+count-n),startMinute:n*4,endMinute:n*4+2}));
    rows.set(path('appointmentDays',date),{schemaVersion:1,clinicId:'main',recordId:date,revision:1,lastOperationId:id(999),slotIndexVersion:2,slots});
    for(const slot of slots)rows.set(path('appointmentRecords',slot.recordId),{schemaVersion:1,clinicId:'main',recordId:slot.recordId,revision:1,lastOperationId:id(999),
      data:{...appt.command.data,date,time:clock(slot.startMinute),durationMinutes:2}});
    return {rows,slots};
  };
  const almost=appointmentSeed(199);
  scenarios.push(await scenario('appointment-create-200th','appointment',{...appt.command,operationId:id(510),recordId:id(5500),
    data:{...appt.command.data,time:clock(199*4),durationMinutes:2}},almost.rows));
  const full=appointmentSeed(200);
  for(const [n,newMinute] of [[0,1390],[100,403],[199,2]] as const){const own=full.slots[n];
    scenarios.push(await scenario(`appointment-reschedule-200-${n}`,'appointment',{...appt.command,operationId:id(520+n),recordId:own.recordId,expectedRevision:1,
      data:{...appt.command.data,time:clock(newMinute),durationMinutes:1}},full.rows));}
  for(const n of [0,100,199])scenarios.push(await scenario(`appointment-cancel-200-${n}`,'appointment',{...appt.command,operationId:id(730+n),
    recordId:full.slots[n].recordId,expectedRevision:1,data:{...appt.command.data,time:clock(n*4),durationMinutes:2,status:'cancelled'}},full.rows));
  const destination=appointmentSeed(199,otherDay,1000),both=new Map([...full.rows,...destination.rows]);
  scenarios.push(await scenario('appointment-cross-day-200','appointment',{...appt.command,operationId:id(940),recordId:full.slots[100].recordId,expectedRevision:1,
    data:{...appt.command.data,date:otherDay,time:clock(199*4),durationMinutes:2}},both));
  const inactiveAppointment=await scenario('appointment-inactive-create','appointment',{...appt.command,operationId:id(941),data:{...appt.command.data,status:'no_show'}});
  scenarios.push(inactiveAppointment,await scenario('appointment-inactive-cross-day','appointment',{...inactiveAppointment.command,operationId:id(942),expectedRevision:1,
    data:{...inactiveAppointment.command.data,date:otherDay,notes:'ملاحظة'}},inactiveAppointment.after));
  scenarios.push(await scenario('appointment-linked-profile','appointment',{...appt.command,operationId:id(943),data:{...appt.command.data,patientRecordId:id(101)}},seedPatient()));
  scenarios.push(await scenario('appointment-max-text','appointment',{...appt.command,operationId:id(944),data:{...appt.command.data,
    patientName:'أ'.repeat(200),reason:'أ'.repeat(200),notes:'أ'.repeat(4000),doctorName:'أ'.repeat(200),appointmentType:'أ'.repeat(80),phone:'201012345678'}},seedBase()));
  const e = await scenario('expense-create', 'expense', { action: 'create', operationId: id(600), recordId: id(601), expectedRevision: 0, createdAt: WHEN,
    paidCents: 2000, data: { title: 'فاتورة مصطنعة', category: 'supplies', expenseType: 'supplies', date: DAY, note: '', isFixed: false,
      recurringPeriod: 'none', supplierName: 'مورد مصطنع', supplierPhone: '', supplierAddress: '', invoiceNumber: '1', invoiceDate: DAY, invoiceTime: '',
      taxNumber: '', commercialRecord: '', currency: 'EGP', subtotalCents: 10000, taxCents: 0, discountCents: 0, totalCents: 10000,
      items: [{ itemId: id(602), name: 'خامة مصطنعة', unit: 'علبة', quantityMilli: 2000, unitPriceCents: 5000, discountCents: 0, taxCents: 0, totalCents: 10000 }] } });
  const materialId = [...e.after].find(([key]) => key.includes('/materialBalances/'))![1].recordId;
  scenarios.push(e, await scenario('expense-payment', 'expense', { action: 'pay', operationId: id(603), recordId: id(601), expectedRevision: 1,
    createdAt: WHEN, amountCents: 1000, date: DAY, note: '' }, e.after), await scenario('material-usage', 'expense', { action: 'usage', operationId: id(604),
    materialId, expectedRevision: 1, createdAt: WHEN, quantityMilli: 1000, kind: 'used', date: DAY, note: '' }, e.after));
}
async function batchAllowed(state: Map<string, any>, writes: Map<string, any>, auth: typeof token | null = token): Promise<boolean> {
  await seed(state); const { app, database } = client(auth);
  try { const batch = writeBatch(database); for (const [key, value] of writes) {
    if (value === null) batch.delete(doc(database, key)); else batch.set(doc(database, key), value); } await batch.commit(); return true;
  } catch (error: any) { if (error?.code === 'permission-denied' || error?.code === 'unauthenticated') {
      if (process.env.RELEASE_DEMO_RULE_DIAGNOSTICS === '1') console.log(JSON.stringify({ rulesDiagnostic: String(error.message).slice(0,4000) }));
      return false;
    }
    throw new Error(`Unexpected DEMO request failure: ${String(error?.code || 'unknown')}`); }
  finally { await deleteApp(app); }
}
const results: { name: string; expected: boolean; actual: boolean }[] = [];
async function check(name: string, expected: boolean, state: Map<string, any>, writes: Map<string, any>, auth: typeof token | null = token) {
  console.log(JSON.stringify({ checking: name }));
  let actual: boolean;
  try { actual = await batchAllowed(state, writes, auth); }
  catch (error: any) { throw new Error(`${name}: ${String(error?.message ?? 'unknown')}`); }
  results.push({ name, expected, actual });
  if (actual !== expected) console.log(JSON.stringify({ name, expected, actual }));
}
async function appointmentTransactionAcceptance(initial:Scenario) {
  await seed(initial.before);const {app,database}=client();
  const adapter:any={authorizeOwner:async()=>UID,runTransaction:(work:any)=>runTransaction(database,async tx=>work({
    get:async(key:string)=>{const snap=await tx.get(doc(database,key));return snap.exists()?snap.data():null;},
    set:(key:string,data:object)=>tx.set(doc(database,key),data),
  }))};
  try{
    const repo=createCloudAppointmentRepository(adapter,{digest}),journal=createCloudOperationIntentRepository(adapter,{digest});
    const a={...initial.command,operationId:id(1950),recordId:id(5501)},b={...initial.command,operationId:id(1951),recordId:id(5502)};
    await journal.prepare('appointment',a,WHEN);await journal.prepare('appointment',b,WHEN);
    const outcomes=await Promise.allSettled([repo.commit(a),repo.commit(b)]);
    assert.equal(outcomes.filter(v=>v.status==='fulfilled').length,1,'one winner for overlapping200th slot');
    const winner=outcomes[0].status==='fulfilled'?a:b;
    const accepted=(await getDoc(doc(database,path('appointmentDays',DAY)))).data()!;
    assert.equal(accepted.slots.length,200);assert.equal(accepted.revision,2);
    await journal.prepare('appointment',{...winner,operationId:id(1952),expectedRevision:1,data:{...winner.data,status:'cancelled'}},WHEN);
    await repo.commit({...winner,operationId:id(1952),expectedRevision:1,data:{...winner.data,status:'cancelled'}});
    assert.equal((await repo.commit(winner)).status,'already-committed');
    const later=(await getDoc(doc(database,path('appointmentDays',DAY)))).data()!;
    assert.equal(later.slots.length,199);assert.equal(later.revision,3);
    results.push({name:'appointment:actual-transactions-collision-max200-and-historical-ACK',expected:true,actual:true});
  }finally{await deleteApp(app);}
}
async function readerQueryAcceptance(state:Map<string,any>) {
  const cases:[string,boolean,(db:ReturnType<typeof getFirestore>)=>Promise<unknown>][]=[];
  for(const name of ['patientProfiles','patientFiles','patientAccounts','patientSessions','patientReceipts','contactRecords','appointmentRecords','appointmentDays']){
    cases.push([`${name}:bounded-whole-snapshot`,true,db=>getDocs(query(collection(db,`clinics/main/${name}`),orderBy(documentId()),limit(50)))]);
    cases.push([`${name}:unbounded-denied`,false,db=>getDocs(query(collection(db,`clinics/main/${name}`),orderBy(documentId())))]);
  }
  cases.push(['catalog:exact-ID-query',true,db=>getDocs(query(collection(db,'clinics/main/settings'),where(documentId(),'==','serviceCatalog'),orderBy(documentId()),limit(1)))]);
  cases.push(['counter:exact-ID-query',true,db=>getDocs(query(collection(db,'clinics/main/counters'),where(documentId(),'==','patientFiles'),orderBy(documentId()),limit(1)))]);
  cases.push(['settings:unfiltered-denied',false,db=>getDocs(query(collection(db,'clinics/main/settings'),limit(1)))]);
  cases.push(['counter:unfiltered-denied',false,db=>getDocs(query(collection(db,'clinics/main/counters'),limit(1)))]);
  cases.push(['appointment:date-filtered-page',true,db=>getDocs(query(collection(db,'clinics/main/appointmentRecords'),where('data.date','==',DAY),orderBy(documentId()),limit(50)))]);
  for(const name of ['operationIntents','patientOperations','clinicalOperations','clinicalSessionProofs','invoiceImages'])
    cases.push([`${name}:private-unfiltered-denied`,false,db=>getDocs(query(collection(db,`clinics/main/${name}`),limit(50)))]);
  for(const [name,expected,run]of cases){await seed(state);const {app,database}=client();let actual=false;
    try{await run(database);actual=true;}catch(error:any){if(error?.code!=='permission-denied')throw error;}finally{await deleteApp(app);}
    results.push({name:`reader:${name}`,expected,actual});if(actual!==expected)console.log(JSON.stringify({name:`reader:${name}`,expected,actual}));
  }
}
async function patientImportTransactionAcceptance(initial:Scenario){
  await seed(initial.after);const {app,database}=client();
  const adapter:any={authorizeOwner:async()=>UID,runTransaction:(work:any)=>runTransaction(database,async tx=>work({
    get:async(key:string)=>{const snap=await tx.get(doc(database,key));return snap.exists()?snap.data():null;},set:(key:string,data:object)=>tx.set(doc(database,key),data),
  })).catch(error=>{console.log(JSON.stringify({patientTransactionDiagnostic:String(error?.message??'unknown').slice(0,2000)}));throw error;})};
  try{const repo=createJournaledCloudPatientRepository(adapter,{digest}),journal=createCloudOperationIntentRepository(adapter,{digest});
    const importing={action:'import' as const,operationId:id(1960),recordId:id(1961),expectedRevision:0 as const,fileNo:500,profile:{...profile,firstVisit:''}};
    const ordinary={action:'create' as const,operationId:id(1962),recordId:id(1963),expectedRevision:0,profile};
    await journal.prepare('patient-profile',importing,WHEN);await journal.prepare('patient-profile',ordinary,WHEN);
    // The engine can deny a stale companion before returning ABORTED to Lite.
    // Recovery must replay the ORIGINAL operation, never allocate a replacement
    // ID or assume a failed response rolled back a server-accepted transaction.
    const attempts=await Promise.allSettled([repo.commit(importing),repo.commit(ordinary)]);
    assert.ok(attempts.some(value=>value.status==='fulfilled'),'at least one valid counter allocation wins');
    const importResult=await repo.commit(importing),createResult=await repo.commit(ordinary);
    assert.equal(importResult.fileNo,500);assert.ok(createResult.fileNo===451||createResult.fileNo===501);
    const counter=(await getDoc(doc(database,path('counters','patientFiles')))).data()!;
    assert.equal(counter.lastFileNo,Math.max(500,createResult.fileNo));
    const collisionA={...importing,operationId:id(1964),recordId:id(1965),fileNo:600},collisionB={...importing,operationId:id(1966),recordId:id(1967),fileNo:600};
    await journal.prepare('patient-profile',collisionA,WHEN);await journal.prepare('patient-profile',collisionB,WHEN);
    const outcomes=await Promise.allSettled([repo.commit(collisionA),repo.commit(collisionB)]);
    assert.equal(outcomes.filter(v=>v.status==='fulfilled').length,1);
    assert.equal((await repo.commit(importing)).status,'already-committed');
    assert.equal((await getDoc(doc(database,path('counters','patientFiles')))).data()!.lastFileNo,600);
    results.push({name:'patient-import:actual-concurrent-create-import-collision-historical-ACK',expected:true,actual:true});
  }finally{await deleteApp(app);}
}
try {
  await admin(`/emulator/v1/projects/${PROJECT}:securityRules`, 'PUT', { rules: { files: [{ name: 'firestore.release.rules', content: readFileSync('firestore.release.rules', 'utf8') }] } });
  await collect(); const selected = process.argv[3] ? scenarios.filter(s => s.kind === process.argv[3] || s.name === process.argv[3]) : scenarios;
  if (!selected.length) throw new Error('Unknown selected DEMO domain/case.');
  for (const s of selected) {
    await check(`${s.name}:prepared-journal-create`, true, new Map([...(s.preparationBefore ?? s.before)].filter(([key]) => key !== path('operationIntents', s.command.operationId))),
      new Map([[path('operationIntents', s.command.operationId), s.before.get(path('operationIntents', s.command.operationId))]]));
    const preparedState = s.preparationBefore && structuredClone(s.preparationBefore);
    if (preparedState && s.preparations) for (const [key, value] of s.preparations) {
      await check(`${s.name}:prepare-service-chunk-${value.level}-${value.index}`, true, preparedState, new Map([[key,value]]));
      const bad = structuredClone(value); bad.subtotalCents++;
      await check(`${s.name}:reject-chunk-sum-${value.level}-${value.index}`, false, preparedState, new Map([[key,bad]]));
      if(value.level>0)for(let child=0;child<4;child++) {
        const childKey=path('clinicalSessionProofs',`${value.operationId}-${value.level-1}-${value.index*4+child}`);
        if(preparedState.has(childKey)){const missing=structuredClone(preparedState);missing.delete(childKey);
          await check(`${s.name}:group-missing-child-${value.level}-${value.index}-${child}`,false,missing,new Map([[key,value]]));}
      }
      if(value.level===0 && value.index===0){
        for(const mutation of ['extra','price','tooth','id','name'] as const){const invalid=structuredClone(value);
          if(mutation==='extra')invalid.rows[0].extra='bad';if(mutation==='price')invalid.rows[0].priceCents=-1;
          if(mutation==='tooth')invalid.rows[0].tooth='ur9';if(mutation==='id')invalid.rows[0].id='bad';if(mutation==='name')invalid.rows[0].name='';
          await check(`${s.name}:leaf-reject-${mutation}`,false,preparedState,new Map([[key,invalid]]));}
        const cancelled=structuredClone(preparedState);const intent=cancelled.get(path('operationIntents',value.operationId));intent.status='cancelled';intent.revision=2;
        await check(`${s.name}:cancelled-cannot-prepare-leaf`,false,cancelled,new Map([[key,value]]));
      }
      const rootLevel = s.command.data.services.length<=8?0:s.command.data.services.length<=32?1:2;
      if (value.level===rootLevel) { const incomplete = structuredClone(s.before); incomplete.delete(key);
        await check(`${s.name}:missing-service-root-${value.level}-${value.index}`, false, incomplete, s.writes); }
      preparedState.set(key,value);
    }
    await check(`${s.name}:complete-atomic-commit`, true, s.before, s.writes);
    await check(`${s.name}:anonymous-denied`, false, s.before, s.writes, null);
    const secretary = structuredClone(token); secretary.token.dentalClinicRole = 'secretary';
    await check(`${s.name}:secretary-denied`, false, s.before, s.writes, secretary);
    const unverified = structuredClone(token); unverified.token.email_verified = false;
    await check(`${s.name}:unverified-denied`, false, s.before, s.writes, unverified);
    for (const key of s.writes.keys()) { const partial = structuredClone(s.writes); partial.delete(key);
      await check(`${s.name}:missing-${key.split('/').at(-2)}`, false, s.before, partial); }
    const forged = structuredClone(s.writes), first = [...forged].find(([key, value]) => value !== null && !key.includes('/operationIntents/'));
    if (first) { first[1].extra = 'tampered'; await check(`${s.name}:extra-schema-field`, false, s.before, forged); }
    const journalOnly = new Map([[path('operationIntents', s.command.operationId), s.after.get(path('operationIntents', s.command.operationId))]]);
    await check(`${s.name}:journal-only-commit`, false, s.before, journalOnly);
    const deletion = new Map([...s.writes].filter(([, value]) => value !== null).map(([key]) => [key, null]));
    await check(`${s.name}:physical-domain-deletion`, false, s.after, deletion);
    const noIntent = structuredClone(s.before); noIntent.delete(path('operationIntents', s.command.operationId));
    await check(`${s.name}:missing-prepared-intent`, false, noIntent, s.writes);
    if(s.kind==='appointment'){
      const receiptKey=path('appointmentOperations',s.command.operationId),receipt=s.writes.get(receiptKey);
      for(const field of ['removeAt','insertAt','expectedDayRevision','date'] as const){const bad=structuredClone(s.writes),p=bad.get(receiptKey).dayChanges[0];
        if(field==='date')p.date='2026-10-15';else p[field]++;
        await check(`${s.name}:forged-${field}`,false,s.before,bad);}
      const wrongVersion=structuredClone(s.writes);wrongVersion.get(receiptKey).dayIndexVersion=1;
      await check(`${s.name}:reject-legacy-write`,false,s.before,wrongVersion);
      const extraProof=structuredClone(s.writes);extraProof.get(receiptKey).dayChanges.push({...receipt.dayChanges[0]});
      await check(`${s.name}:extra-day-proof`,false,s.before,extraProof);
      for(const [key,value]of s.writes)if(key.includes('/appointmentDays/')&&value.slots.length>1){
        const altered=structuredClone(s.writes);altered.get(key).slots[0].endMinute++;
        await check(`${s.name}:unrelated-slot-tamper`,false,s.before,altered);
        const reordered=structuredClone(s.writes);reordered.get(key).slots.reverse();
        await check(`${s.name}:slot-reordering`,false,s.before,reordered);
      }
      if(s.command.data.patientRecordId){const missingProfile=structuredClone(s.before);missingProfile.delete(path('patientProfiles',s.command.data.patientRecordId));
        await check(`${s.name}:missing-linked-profile`,false,missingProfile,s.writes);}
      const stale=structuredClone(s.before),old=stale.get(path('appointmentRecords',s.command.recordId));
      if(old){old.revision++;await check(`${s.name}:stale-record-revision`,false,stale,s.writes);}
      if(s.name==='appointment-max-text')for(const field of ['patientName','reason','notes','doctorName','appointmentType']as const){
        for(const suffix of ['\u202e','\u0000','\u2028']){const badBefore=structuredClone(s.before),badWrites=structuredClone(s.writes);
          const bad=field==='notes'?'نص'+suffix:'نص'+suffix;
          badBefore.get(path('operationIntents',s.command.operationId)).command.data[field]=bad;
          badWrites.get(path('operationIntents',s.command.operationId)).command.data[field]=bad;
          badWrites.get(path('appointmentRecords',s.command.recordId)).data[field]=bad;
          await check(`${s.name}:invalid-${field}-${suffix.charCodeAt(0)}`,false,badBefore,badWrites);}
      }
    }
    if(s.kind==='patient-profile'&&s.command.action==='import'){
      const counter=path('counters','patientFiles');
      for(const delta of [-1,1]){const bad=structuredClone(s.writes);bad.get(counter).lastFileNo+=delta;
        await check(`${s.name}:counter-must-be-exact-max-${delta}`,false,s.before,bad);}
      const wrongIntent=structuredClone(s.before);wrongIntent.get(path('operationIntents',s.command.operationId)).command.fileNo++;
      await check(`${s.name}:import-fileNo-must-match-intent`,false,wrongIntent,s.writes);
      const collision=structuredClone(s.before);collision.set(path('patientFiles',s.command.fileNo),{schemaVersion:1,clinicId:'main',fileNo:s.command.fileNo,recordId:id(109)});
      await check(`${s.name}:existing-file-number-cannot-be-overwritten`,false,collision,s.writes);
      const duplicate=structuredClone(s.before);duplicate.set(path('patientProfiles',s.command.recordId),{...patient,recordId:s.command.recordId,fileNo:s.command.fileNo});
      await check(`${s.name}:existing-profile-cannot-be-overwritten`,false,duplicate,s.writes);
    }
    if(s.kind==='contact'&&s.command.contact?.campaignConsent){
      for(const patch of [{phone:'201012345679'},{status:'yes'},{recordedAt:'2026-02-30T00:00:00.000Z'},{extra:true}]){
        const badBefore=structuredClone(s.before),badWrites=structuredClone(s.writes);
        Object.assign(badBefore.get(path('operationIntents',s.command.operationId)).command.contact.campaignConsent,patch);
        Object.assign(badWrites.get(path('operationIntents',s.command.operationId)).command.contact.campaignConsent,patch);
        Object.assign(badWrites.get(path('contactRecords',s.command.recordId)).data.campaignConsent,patch);
        await check(`${s.name}:forged-consent-${Object.keys(patch)[0]}`,false,badBefore,badWrites);
      }
    }
  }
  if(selected.some(s=>s.kind==='appointment'))await appointmentTransactionAcceptance(scenarios.find(s=>s.name==='appointment-create-200th')!);
  if(selected.some(s=>s.kind==='patient-profile'||s.kind==='appointment'))await readerQueryAcceptance(scenarios.find(s=>s.name==='patient-import-low')!.after);
  if(selected.some(s=>s.kind==='patient-profile'))await patientImportTransactionAcceptance(scenarios.find(s=>s.name==='patient-import-low')!);
  const failed = results.filter(r => r.expected !== r.actual);
  console.log(JSON.stringify({ target: '127.0.0.1:8789 DEMO-only', rulesEngineCases: results.length, passed: results.length - failed.length, failed,
    testedDomains: [...new Set(selected.map(s => s.kind))], completeRelease: false }));
  if (failed.length) process.exitCode = 1;
} catch (error: any) { console.error(JSON.stringify({ status: 'release-demo-incomplete', detail: String(error?.message ?? 'unknown').slice(0, 2000) })); process.exitCode = 1; }
