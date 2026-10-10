/** Explicit DEMO-only integration check; never called by App or ordinary tests.
 * Start the official Firestore emulator on 127.0.0.1:8787 with hardcoded project
 * demo-clinic-patient-rules, then:
 * pnpm exec tsx scripts/test-cloud-patient-emulator.ts --demo-emulator
 * No IAM, production project, real Auth account or patient records.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, collection, getDoc, getDocs, query, orderBy,
  documentId, limit, startAfter, where, writeBatch, runTransaction, setLogLevel } from 'firebase/firestore/lite';
import { createCloudPatientRepository, CloudPatientError, type CloudPatientAdapter } from '../src/utils/cloudPatientRepository';

const require = createRequire(import.meta.url);
const { namedCases, UID, paths, fixture, profile } = require('./cloudPatientRulesCases.cjs');
const PROJECT = 'demo-clinic-patient-rules';
const BASE = 'http://127.0.0.1:8787';
if (process.argv[2] !== '--demo-emulator') throw new Error('Explicit --demo-emulator required. Never run against a real project.');
if (process.env.FIRESTORE_EMULATOR_HOST && process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8787') throw new Error('Unexpected emulator target.');
setLogLevel('silent');
function fields(data: Record<string, any>): Record<string, any> {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, encode(value)]));
}
function encode(value: any): object {
  if (value === null) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  return { mapValue: { fields: fields(value) } };
}
async function admin(path: string, method: string, body?: object) {
  const url = new URL(path, BASE);
  assert.equal(url.origin, BASE); assert.ok(url.pathname.includes(`/projects/${PROJECT}`));
  const response = await fetch(url, { method, headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!response.ok) throw new Error(`Demo emulator setup failed (${response.status}).`);
  return response;
}
async function seed(rows: Record<string, any>) {
  // Reset ONLY this disposable hardcoded demo namespace; never production.
  await admin(`/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, 'DELETE');
  const writes = Object.entries(rows).map(([path, value]) => ({ update: { name: `projects/${PROJECT}${path}`, fields: fields(value) } }));
  if (writes.length) await admin(`/v1/projects/${PROJECT}/databases/(default)/documents:commit`, 'POST', { writes });
}
function mockToken(auth: any) {
  const payload = { iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, iat: 1800000000, exp: 4102444800,
    ...auth.token, sub: auth.uid, user_id: auth.uid };
  return `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.`;
}
function client(auth: any) {
  const app = initializeApp({ projectId: PROJECT, apiKey: 'demo-only-no-real-key' }, `patient-test-${randomUUID()}`);
  const database = getFirestore(app);
  connectFirestoreEmulator(database, '127.0.0.1', 8787, auth ? { mockUserToken: mockToken(auth) } : undefined);
  return { app, database };
}
const localPath = (path: string) => path.split('/documents/')[1];
async function evaluate(entry: any) {
  const state = entry.state;
  await seed(state.before);
  const { app, database } = client(state.auth);
  try {
    const target = localPath(state.path);
    if (state.method === 'get') await getDoc(doc(database, target));
    else if (state.method === 'list') {
      await getDocs(query(collection(database, target), orderBy(documentId()), ...(state.limit ? [limit(state.limit)] : [])));
    } else if (state.doubleFields) {
      const writes = Object.entries(state.writes).map(([path, value]) => {
        const encoded = fields(value as Record<string, any>);
        for (const [selected, field] of state.doubleFields) {
          if (selected === path) {
            assert.ok(encoded[field]?.integerValue);
            encoded[field] = { doubleValue: Number(encoded[field].integerValue) };
          }
        }
        return { update: { name: `projects/${PROJECT}${path}`, fields: encoded } };
      });
      const response = await fetch(`${BASE}/v1/projects/${PROJECT}/databases/(default)/documents:commit`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${mockToken(state.auth)}` },
        body: JSON.stringify({ writes }),
      });
      if (!response.ok) {
        const body = await response.json() as { error?: { status?: string } };
        assert.equal(body.error?.status, 'PERMISSION_DENIED');
        return false;
      }
    } else {
      const batch = writeBatch(database);
      for (const [path, value] of Object.entries(state.writes)) {
        if (value === null) batch.delete(doc(database, localPath(path)));
        else batch.set(doc(database, localPath(path)), value as object);
      }
      await batch.commit();
    }
    return true;
  } catch (error: any) {
    if (!['permission-denied', 'unauthenticated'].includes(error?.code)) throw new Error(`Unexpected demo failure: ${String(error?.code || 'unknown')}`);
    return false;
  } finally { await deleteApp(app); }
}
async function integrationChecks() {
  const state = fixture('create'); await seed(state.before);
  const { app, database } = client(state.auth);
  const adapter: CloudPatientAdapter = {
    // Synthetic owner stub: this does NOT test production Auth or two devices.
    authorizeOwner: async () => UID,
    readRecord: async path => { const result = await getDoc(doc(database, path)); return result.exists() ? result.data() : null; },
    listRecordsPage: async (afterId, maximum) => {
      const result = await getDocs(query(collection(database, 'clinics/main/patientProfiles'), orderBy(documentId()),
        ...(afterId ? [startAfter(afterId)] : []), limit(maximum)));
      return result.docs.map(row => ({ id: row.id, data: row.data() }));
    },
    findRecordsByPhone: async (phoneKey, afterId, maximum) => {
      const result = await getDocs(query(collection(database, 'clinics/main/patientProfiles'), where('phoneKey', '==', phoneKey),
        orderBy(documentId()), ...(afterId ? [startAfter(afterId)] : []), limit(maximum)));
      return result.docs.map(row => ({ id: row.id, data: row.data() }));
    },
    runTransaction: work => runTransaction(database, transaction => work({
      get: async path => { const result = await transaction.get(doc(database, path)); return result.exists() ? result.data() : null; },
      set: (path, value) => { transaction.set(doc(database, path), value); },
    }), { maxAttempts: 5 }),
  };
  const repository = createCloudPatientRepository(adapter);
  const command = () => ({ operationId: randomUUID(), recordId: randomUUID(), expectedRevision: 0,
    action: 'create' as const, profile: structuredClone(profile) });
  try {
    const first = command();
    const created = await repository.commit(first);
    assert.equal(created.fileNo, 1); assert.equal(created.revision, 1);
    assert.equal((await repository.commit(first)).status, 'already-committed');
    assert.equal((await getDoc(doc(database, localPath(paths.counter)))).data()?.lastFileNo, 1, 'retry cannot consume a number');
    const races = [command(), command()];
    const results = await Promise.allSettled(races.map(value => repository.commit(value)));
    // A transaction denied by a racing Rules snapshot may need explicit same-ID
    // retry. Do not recast every permission failure as a successful transaction.
    for (const [index, result] of results.entries()) {
      if (result.status === 'rejected') {
        assert.ok(result.reason instanceof CloudPatientError);
        assert.equal(result.reason.code, 'unavailable');
        await repository.commit(races[index]);
      }
    }
    const acknowledged = await Promise.all(races.map(value => repository.commit(value)));
    assert.deepEqual(acknowledged.map(value => value.fileNo).sort(), [2, 3]);
    assert.ok(acknowledged.every(value => value.status === 'already-committed'));
    assert.equal((await getDoc(doc(database, localPath(paths.counter)))).data()?.lastFileNo, 3);
    const current = (await getDoc(doc(database, `clinics/main/patientProfiles/${first.recordId}`))).data()!;
    const attempted = randomUUID(); const invalid = writeBatch(database);
    invalid.set(doc(database, `clinics/main/patientProfiles/${first.recordId}`), { ...current, revision: 2, lastOperationId: attempted });
    await assert.rejects(invalid.commit(), (error: any) => error.code === 'permission-denied');
    assert.deepEqual((await getDoc(doc(database, `clinics/main/patientProfiles/${first.recordId}`))).data(), current);
    const updates = ['first edit', 'competing edit'].map(name => ({ ...first, operationId: randomUUID(), action: 'update' as const,
      expectedRevision: 1, profile: { ...profile, name } }));
    const changed = await Promise.allSettled(updates.map(value => repository.commit(value)));
    assert.equal(changed.filter(value => value.status === 'fulfilled').length, 1);
    for (const [index, result] of changed.entries()) {
      if (result.status === 'fulfilled') assert.equal((await repository.commit(updates[index])).status, 'already-committed');
      else await assert.rejects(repository.commit(updates[index]), (error: any) => error instanceof CloudPatientError && error.code === 'conflict');
    }
    let loseReply = true;
    const uncertain = createCloudPatientRepository({ ...adapter, runTransaction: async work => {
      const result = await adapter.runTransaction(work);
      if (loseReply) { loseReply = false; throw new Error('Synthetic lost acknowledgement'); }
      return result;
    } });
    const retained = command();
    await assert.rejects(uncertain.commit(retained), (error: any) => error instanceof CloudPatientError && error.code === 'unavailable');
    const resolved = await uncertain.commit(retained);
    assert.equal(resolved.status, 'already-committed'); assert.equal(resolved.fileNo, 4);
    assert.equal((await getDoc(doc(database, localPath(paths.counter)))).data()?.lastFileNo, 4);
    const records = await getDocs(query(collection(database, 'clinics/main/patientProfiles'), orderBy(documentId()), limit(50)));
    assert.equal(records.size, 4);
    const family = await getDocs(query(collection(database, 'clinics/main/patientProfiles'), where('phoneKey', '==', current.phoneKey), orderBy(documentId()), limit(50)));
    assert.equal(family.size, 4, 'family phone is advisory, never uniqueness or identity');
    const phoneFirst = await repository.findByPhone({ mobile: '+٢٠ ١٠ ١٢٣٤ ٥٦٧٨', limit: 2 });
    const phoneSecond = await repository.findByPhone({ mobile: '01012345678', limit: 2, afterId: phoneFirst.nextAfterId });
    assert.equal(new Set([...phoneFirst.records, ...phoneSecond.records].map(value => value.recordId)).size, 4);
    assert.equal((await repository.get(first.recordId))?.revision, 2);
    assert.equal((await repository.getByFileNo(1))?.recordId, first.recordId);
    assert.equal(await repository.getByFileNo(1000), null);
    const one = await repository.listPage({ limit: 2 });
    const two = await repository.listPage({ limit: 2, afterId: one.nextAfterId });
    const three = await repository.listPage({ limit: 2, afterId: two.nextAfterId });
    assert.equal(new Set([...one.records, ...two.records].map(value => value.recordId)).size, 4);
    assert.equal(three.records.length, 0);
    for (const number of [1, 2, 3, 4]) {
      const index = (await getDoc(doc(database, `clinics/main/patientFiles/${number}`))).data()!;
      assert.equal(index.fileNo, number);
      assert.equal((await getDoc(doc(database, `clinics/main/patientProfiles/${index.recordId}`))).data()?.fileNo, number);
    }
    await assert.rejects(getDocs(collection(database, 'clinics/main/patientProfiles')), (error: any) => error.code === 'permission-denied');
    await assert.rejects(getDocs(query(collection(database, 'clinics/main/patientFiles'), limit(25))), (error: any) => error.code === 'permission-denied');
    return ['atomic create allocation', 'same-ID retry no new file number', 'concurrent allocator unique numbers',
      'partial profile write denied atomically', 'concurrent profile CAS', 'lost acknowledgement retained retry',
      'shared family phone nonunique', 'exact phone query pages', 'fresh UUID/file-number reads',
      'bounded cursor pages', 'immutable file-index crosslinks', 'unbounded/companion lists denied'];
  } finally { await deleteApp(app); }
}
try {
  await admin(`/emulator/v1/projects/${PROJECT}:securityRules`, 'PUT', { rules: { files: [{ name: 'firestore.patients-stage.rules', content: readFileSync('firestore.patients-stage.rules', 'utf8') }] } });
  const failed: { name: string; expected: boolean; actual: boolean }[] = []; let passed = 0;
  const sdkOnly = process.argv[3] === '--sdk-workflow';
  const cases = sdkOnly ? [] : namedCases.filter((entry: any) => !process.argv[3] || entry.name === process.argv[3]);
  if (!sdkOnly && !cases.length) throw new Error('No matching synthetic case.');
  for (const entry of cases) {
    const actual = await evaluate(entry);
    if (actual === entry.allowed) passed++; else failed.push({ name: entry.name, expected: entry.allowed, actual });
    if ((passed + failed.length) % 40 === 0) console.log(JSON.stringify({ evaluated: passed + failed.length, total: cases.length }));
  }
  const integration = failed.length || process.argv[3] && !sdkOnly ? [] : await integrationChecks();
  console.log(JSON.stringify({ target: 'loopback-demo-emulator-only', rulesEngineCases: cases.length, passed, failed, sdkIntegrationChecks: integration }));
  if (failed.length) process.exitCode = 1;
} catch (error: any) {
  console.error(JSON.stringify({ status: 'demo-emulator-test-incomplete', detail: error instanceof Error ? error.message : 'unknown' }));
  process.exitCode = 1;
}
