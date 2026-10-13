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
  const c = await scenario('contact-create', 'contact', { operationId: id(3), recordId: id(201), expectedRevision: 0, action: 'create',
    contact: { id: id(201), name: 'جهة مصطنعة', mobile: '01012345678', createdAt: WHEN } });
  const cu = await scenario('contact-update-phone', 'contact', { ...c.command, operationId: id(4), expectedRevision: 1, action: 'update',
    contact: { ...c.command.contact, mobile: '01012345679' } }, c.after);
  scenarios.push(c, cu, await scenario('contact-delete', 'contact', { ...c.command, operationId: id(5), expectedRevision: 2, action: 'delete', contact: null }, cu.after));
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
  }
  const failed = results.filter(r => r.expected !== r.actual);
  console.log(JSON.stringify({ target: '127.0.0.1:8789 DEMO-only', rulesEngineCases: results.length, passed: results.length - failed.length, failed,
    testedDomains: [...new Set(selected.map(s => s.kind))], completeRelease: false }));
  if (failed.length) process.exitCode = 1;
} catch (error: any) { console.error(JSON.stringify({ status: 'release-demo-incomplete', detail: String(error?.message ?? 'unknown').slice(0, 2000) })); process.exitCode = 1; }
