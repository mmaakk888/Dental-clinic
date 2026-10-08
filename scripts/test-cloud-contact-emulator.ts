/** Explicit DEMO-only integration test. Never used by App or routine pnpm test.
 * Start the official Firestore emulator on 127.0.0.1:8787 with project
 * demo-clinic-contact-rules, then run: pnpm exec tsx scripts/test-cloud-contact-emulator.ts --demo-emulator
 * No IAM/login/real Auth accounts/billing/network project/production writes.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, collection, getDoc, getDocs, writeBatch, runTransaction, setLogLevel } from 'firebase/firestore/lite';
import { createCloudContactRepository, CloudContactError, type CloudContactAdapter } from '../src/utils/cloudContactRepository';

const require = createRequire(import.meta.url);
const { namedCases, UID, fixture, recordPath } = require('./cloudContactRulesCases.cjs');
const PROJECT = 'demo-clinic-contact-rules';
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
  // Destructive only inside the disposable, explicit demo emulator namespace.
  await admin(`/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, 'DELETE');
  const writes = Object.entries(rows).map(([path, value]) => ({ update: { name: `projects/${PROJECT}${path}`, fields: fields(value.data) } }));
  if (writes.length) await admin(`/v1/projects/${PROJECT}/databases/(default)/documents:commit`, 'POST', { writes });
}
function client(auth: any) {
  const app = initializeApp({ projectId: PROJECT, apiKey: 'demo-only-no-real-key' }, `contact-test-${randomUUID()}`);
  const database = getFirestore(app);
  connectFirestoreEmulator(database, '127.0.0.1', 8787, auth ? { mockUserToken: mockToken(auth) } : undefined);
  return { app, database };
}
function mockToken(auth: any) {
  // Unsigned synthetic emulator token, NEVER an application credential. String
  // form permits negative malformed-claim cases rejected by SDK's convenience API.
  const payload = { iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, iat: 1800000000, exp: 4102444800,
    ...auth.token, sub: auth.uid, user_id: auth.uid };
  return `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.`;
}
const localPath = (path: string) => path.split('/documents/')[1];
function databaseFromPath(path: string) { return path.split('/')[2]; }
async function evaluate(entry: any) {
  const state = entry.state || { path: entry.testCase.request.path, method: entry.testCase.request.method, auth: entry.testCase.request.auth,
    before: { [entry.testCase.request.path]: entry.testCase.resource }, after: {} };
  // Supply a harmless document for malformed/missing membership negative cases.
  const before = Object.fromEntries(Object.entries(state.before).filter(([, value]: any) => value?.data));
  await seed(before);
  const { app, database } = client(state.auth);
  try {
    // A separate named database stays in the same DEMO emulator; never a real DB.
    const selected = databaseFromPath(state.path) === '(default)' ? database : getFirestore(app, databaseFromPath(state.path));
    if (selected !== database) connectFirestoreEmulator(selected, '127.0.0.1', 8787, state.auth ? { mockUserToken: mockToken(state.auth) } : undefined);
    const target = localPath(state.path);
    if (state.method === 'get') await getDoc(doc(selected, target));
    else if (state.method === 'list') await getDocs(collection(selected, target.split('/').length % 2 === 0 ? target.split('/').slice(0, -1).join('/') : target));
    else {
      const batch = writeBatch(selected);
      const paths = entry.state && !entry.name.startsWith('standalone')
        ? new Set([...Object.keys(state.before), ...Object.keys(state.after)].filter(path => /\/contact(?:Records|Operations|Phones)\//u.test(path))) : new Set<string>();
      paths.add(state.path);
      for (const path of paths) {
        const ref = doc(selected, localPath(path));
        if (path === state.path && state.method === 'delete' || !state.after[path]) batch.delete(ref);
        else batch.set(ref, state.after[path].data);
      }
      // Forbidden path cases must actually attempt a write, not only delete a
      // missing value. Membership writes also use a fabricated payload.
      if (!state.after[state.path] && state.method !== 'delete') batch.set(doc(selected, target), { synthetic: true });
      await batch.commit();
    }
    return { allowed: true };
  } catch (error: any) {
    if (!['permission-denied', 'unauthenticated'].includes(error?.code)) throw new Error(`Unexpected demo test failure: ${String(error?.code || 'unknown')}`);
    return { allowed: false };
  } finally { await deleteApp(app); }
}
async function integrationChecks() {
  const state = fixture('create'); await seed(state.before);
  const { app, database } = client(state.auth);
  const adapter: CloudContactAdapter = { authorizeOwner: async () => UID,
    runTransaction: work => runTransaction(database, transaction => work({
      get: async path => { const result = await transaction.get(doc(database, path)); return result.exists() ? result.data() : null; },
      set: (path, value) => { transaction.set(doc(database, path), value); },
      delete: path => { transaction.delete(doc(database, path)); },
    }), { maxAttempts: 5 }) };
  const repository = createCloudContactRepository(adapter);
  try {
    const id = state.after[recordPath].data.recordId;
    const contact = state.after[recordPath].data.data;
    const command = { recordId: id, operationId: randomUUID(), action: 'create' as const, expectedRevision: 0, contact };
    assert.equal((await repository.commit(command)).status, 'committed');
    assert.equal((await repository.commit(command)).status, 'already-committed');
    const reference = doc(database, localPath(recordPath));
    const previous = (await getDoc(reference)).data()!;
    const invalidOperation = randomUUID(); const rejectedBatch = writeBatch(database);
    rejectedBatch.set(reference, { ...previous, revision: 2, lastOperationId: invalidOperation });
    // Missing new receipt must reject the WHOLE batch, with no partial record.
    await assert.rejects(rejectedBatch.commit(), (error: any) => error.code === 'permission-denied');
    assert.deepEqual((await getDoc(reference)).data(), previous);
    assert.equal((await getDoc(doc(database, 'clinics', 'main', 'contactOperations', invalidOperation))).exists(), false);
    const update = { ...command, operationId: randomUUID(), action: 'update' as const, expectedRevision: 1,
      contact: { ...contact, name: 'Atomic SDK update', mobile: '01123456789' } };
    // A sequential move isolates payload/rule correctness before racing clients.
    await repository.commit(update);
    const race = { ...update, operationId: randomUUID(), expectedRevision: 2 };
    const competing = { ...race, operationId: randomUUID(), contact: { ...race.contact, name: 'Competing edit' } };
    const concurrent = await Promise.allSettled([repository.commit(race), repository.commit(competing)]);
    assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 1, 'exactly one concurrent writer is acknowledged');
    // A stale CAS may hit server Rules before the SDK's updateTime precondition
    // and return permission-denied. Never disguise every authorization failure
    // as conflict. Retain the ID, then a fresh transaction can resolve it safely.
    assert.equal(concurrent.filter(result => result.status === 'rejected' && result.reason instanceof CloudContactError
      && ['conflict', 'unavailable'].includes(result.reason.code)).length, 1, 'losing writer fails closed');
    for (const [index, command] of [race, competing].entries()) {
      if (concurrent[index].status === 'fulfilled') assert.equal((await repository.commit(command)).status, 'already-committed');
      else await assert.rejects(repository.commit(command), (error: any) => error instanceof CloudContactError && error.code === 'conflict');
    }
    const otherId = randomUUID();
    await assert.rejects(repository.commit({ recordId: otherId, operationId: randomUUID(), action: 'create', expectedRevision: 0,
      contact: { ...contact, id: otherId, mobile: '+٢٠١١٢٣٤٥٦٧٨٩' } }), (error: any) => error instanceof CloudContactError && error.code === 'duplicate');
    assert.equal((await repository.commit({ ...command, operationId: randomUUID(), action: 'delete', expectedRevision: 3, contact: null })).revision, 4);
    const deleted = await getDoc(doc(database, localPath(recordPath)));
    assert.equal(deleted.data()?.deleted, true); assert.equal(deleted.data()?.data, null);
    await assert.rejects(repository.commit({ ...command, operationId: randomUUID() }), (error: any) => error instanceof CloudContactError && error.code === 'conflict');
    let loseReply = true;
    const uncertain = createCloudContactRepository({ ...adapter, runTransaction: async work => {
      const result = await adapter.runTransaction(work);
      if (loseReply) { loseReply = false; throw new Error('Synthetic lost acknowledgement'); }
      return result;
    } });
    const newId = randomUUID(); const retryCommand = { ...command, operationId: randomUUID(), recordId: newId, contact: { ...contact, id: newId } };
    await assert.rejects(uncertain.commit(retryCommand), (error: any) => error instanceof CloudContactError && error.code === 'unavailable');
    assert.equal((await uncertain.commit(retryCommand)).status, 'already-committed');
    assert.equal((await getDoc(doc(database, 'clinics', 'main', 'contactRecords', newId))).data()?.revision, 1);
    return ['create', 'idempotent retry', 'atomic rejection', 'concurrent CAS', 'equivalent phone uniqueness',
      'versioned delete', 'tombstone contents', 'no resurrection', 'lost acknowledgement', 'resolved acknowledgement'];
  } finally { await deleteApp(app); }
}
try {
  await admin(`/emulator/v1/projects/${PROJECT}:securityRules`, 'PUT', { rules: { files: [{ name: 'firestore.contacts-stage.rules', content: readFileSync('firestore.contacts-stage.rules', 'utf8') }] } });
  const failed: { name: string; expected: string; actual: string }[] = []; let passed = 0;
  const sdkOnly = process.argv[3] === '--sdk-workflow';
  const contactCases = sdkOnly ? [] : namedCases.filter((entry: any) => entry.state && (!process.argv[3] || entry.name === process.argv[3]));
  if (!sdkOnly && !contactCases.length) throw new Error('No matching synthetic case.');
  for (const entry of contactCases) {
    const result = await evaluate(entry);
    const expected = entry.expectation || entry.testCase.expectation;
    if (result.allowed === (expected === 'ALLOW')) passed++;
    else failed.push({ name: entry.name, expected, actual: result.allowed ? 'ALLOW' : 'DENY' });
    if ((passed + failed.length) % 40 === 0) console.log(JSON.stringify({ evaluated: passed + failed.length, total: contactCases.length }));
  }
  const integrationPassed = failed.length || process.argv[3] && !sdkOnly ? [] : await integrationChecks();
  console.log(JSON.stringify({ target: 'loopback-demo-emulator-only', cases: contactCases.length, passed, failed, sdkIntegrationChecks: integrationPassed }));
  if (failed.length) process.exitCode = 1;
} catch (error: any) {
  console.error(JSON.stringify({ status: 'demo-emulator-test-incomplete', detail: error instanceof Error ? error.message : 'unknown' })); process.exitCode = 1;
}
