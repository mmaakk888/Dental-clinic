import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { makeClinicSnapshotFixture, SNAPSHOT_OWNER, SNAPSHOT_TIME, snapshotId, snapshotRestDocument } from './testing/cloudClinicSnapshotFixtures';

// Actual SDK facade and pure snapshot reader in an isolated synthetic VM.
// Fake Auth/Lite/REST only; no live project, credentials, provider or owner data.
const compiled = build({ entryPoints: ['src/utils/firebaseCloudClinicSnapshot.ts'], bundle: true, write: false, metafile: true,
  platform: 'node', format: 'cjs', supported: { 'dynamic-import': false }, external: ['firebase/*'], logLevel: 'silent' });
type Options = { full?: boolean; hostname?: string; appName?: string; projectId?: string; emulator?: boolean; provider?: string; verified?: boolean;
  member?: object; claims?: object; stopAt?: string; swapAt?: string; status?: number; tooLarge?: boolean; badUtf8?: boolean; badJson?: boolean; drift?: boolean; redirect?: boolean;
  privateFault?: 'foreign' | 'time' | 'extra' | 'duplicate' };
async function harness(options: Options = {}) {
  const output = await compiled, fixture = await makeClinicSnapshotFixture(options.full ?? false), module = { exports: {} as any };
  const calls: string[] = [], requests: { url: string; init: any; body: any }[] = [];
  const user = { uid: SNAPSHOT_OWNER, email: 'snapshot-owner@example.invalid', emailVerified: options.verified ?? true };
  const auth = { app: { name: options.appName ?? `clinic-operating-${snapshotId(999)}`, options: { projectId: options.projectId ?? 'osama-clinic-38706',
    authDomain: 'osama-clinic-38706.firebaseapp.com' } }, currentUser: user as typeof user | null, emulatorConfig: options.emulator ? {} : null };
  let active = true, copy!: (value: unknown) => any;
  const location = { hostname: options.hostname ?? '127.0.0.1' };
  function step(name: string) { calls.push(name); if (name === options.stopAt) active = false; if (name === options.swapAt) auth.currentUser = { ...user }; }
  const scope = { module, exports: module.exports, TextEncoder, TextDecoder, Uint8Array, AbortController, setTimeout, clearTimeout, crypto: webcrypto,
    window: { location, get localStorage() { throw new Error('PRIVATE_LOCAL'); }, get sessionStorage() { throw new Error('PRIVATE_LOCAL'); } },
    require: (name: string) => {
      if (name === 'firebase/auth') return { getIdTokenResult: async (target: unknown) => { assert.equal(target, user); step('token'); return copy({ token: 'SYNTHETIC_ID_TOKEN',
        signInProvider: options.provider ?? 'password', claims: { sub: SNAPSHOT_OWNER, aud: 'osama-clinic-38706', iss: 'https://securetoken.google.com/osama-clinic-38706',
          email: user.email, email_verified: options.verified ?? true, dentalClinicId: 'main', dentalClinicRole: 'owner', auth_time: 100, ...options.claims } }); } };
      if (name === 'firebase/firestore/lite') return { getFirestore: (app: unknown, database: string) => { assert.equal(app, auth.app); assert.equal(database, '(default)'); step('database'); return 'synthetic-db'; },
        doc: (database: unknown, ...parts: string[]) => { assert.equal(database, 'synthetic-db'); const key = parts.join('/');
          assert.equal(key, `clinics/main/members/${SNAPSHOT_OWNER}`); step('member-doc'); return key; },
        getDoc: async () => { step('member'); return { exists: () => { step('member-exists'); return true; }, data: () => { step('member-data'); return copy({ schemaVersion: 1, clinicId: 'main', uid: SNAPSHOT_OWNER,
          role: 'owner', status: 'active', identityVersion: 1, verifiedAfter: 100, ...options.member }); } }; } };
      throw new Error('PRIVATE_IMPORT');
    },
    fetch: async (url: string, init: any) => {
      step('fetch'); const body = JSON.parse(init.body); requests.push({ url, init, body });
      const privateRead = Array.isArray(body.documents);
      assert.equal(url, privateRead ? 'https://firestore.googleapis.com/v1/projects/osama-clinic-38706/databases/(default)/documents:batchGet'
        : 'https://firestore.googleapis.com/v1/projects/osama-clinic-38706/databases/(default)/documents/clinics/main:runQuery');
      assert.equal(init.method, 'POST'); assert.equal(init.cache, 'no-store'); assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error'); assert.equal(init.referrerPolicy, 'no-referrer');
      const query = body.structuredQuery, collection = privateRead ? body.documents[0].split('/').at(-2) : query.from[0].collectionId,
        documentId = privateRead ? body.documents[0].split('/').at(-1) : query.where?.fieldFilter.value.referenceValue.split('/').at(-1),
        afterId = query?.startAt?.values[0].referenceValue.split('/').at(-1);
      if (privateRead) { assert.equal(body.documents.length, 1); assert.ok(['expenseOperations', 'operationIntents'].includes(collection)); assert.equal(body.readTime, SNAPSHOT_TIME); }
      else { assert.equal(query.orderBy[0].field.fieldPath, '__name__'); assert.equal(query.orderBy[0].direction, 'ASCENDING'); assert.ok(query.limit >= 1 && query.limit <= 50);
        assert.ok(!['invoiceImages', 'operationIntents', 'members', 'settingsOperations'].includes(collection)); }
      const values = [...fixture.docs].filter(([key]) => key.startsWith(`clinics/main/${collection}/`) && (!documentId || key.endsWith(`/${documentId}`))
        && (!afterId || key.split('/').at(-1)! > afterId)).sort(([a], [b]) => a.localeCompare(b)).slice(0, privateRead ? 1 : query.limit);
      const stamp = options.drift && body.readTime ? '2026-10-13T00:00:00.999999Z' : SNAPSHOT_TIME;
      const response: any[] = values.length ? values.map(([key, value]) => ({ readTime: stamp, [privateRead ? 'found' : 'document']: snapshotRestDocument(collection, key.split('/').at(-1)!, value) }))
        : [privateRead ? { readTime: stamp, missing: body.documents[0] } : { readTime: stamp }];
      if (privateRead && options.privateFault) {
        const row: any = response[0];
        if (options.privateFault === 'foreign') row.found.name = row.found.name.replace('osama-clinic-38706', 'foreign-project');
        if (options.privateFault === 'time') row.readTime = '2026-10-13T00:00:00.999999Z';
        if (options.privateFault === 'extra') row.transaction = 'PRIVATE_UNEXPECTED';
        if (options.privateFault === 'duplicate') response.push(response[0]);
      }
      const encoded = options.badUtf8 ? Uint8Array.from([255, 255]) : new TextEncoder().encode(options.badJson ? 'PRIVATE_BAD_JSON' : JSON.stringify(response));
      let done = false;
      return { get ok() { step('response-ok'); return (options.status ?? 200) === 200; }, get status() { step('response-status'); return options.status ?? 200; },
        get redirected() { step('response-redirected'); return options.redirect ?? false; }, headers: { get: () => { step('response-header'); return options.tooLarge ? String(5 * 1024 * 1024) : null; } },
        get body() { step('response-body'); return { getReader: () => { step('reader'); return { read: async () => { step(done ? 'stream-done' : 'stream-chunk'); if (done) return { done: true }; done = true; return { done: false, value: encoded }; },
          cancel: async () => { calls.push('cancel-stream'); }, releaseLock: () => { calls.push('release-stream'); } }; } }; } };
    },
  };
  copy = runInNewContext('(value) => JSON.parse(JSON.stringify(value))', scope);
  runInNewContext(output.outputFiles[0].text, scope);
  return { calls, requests, fixture, auth, user, location, factory: () => module.exports.createFirebaseCloudClinicSnapshot(auth, { isActive: () => active }),
    active: (value: boolean) => { active = value; } };
}
test('snapshot SDK factory binds named operating app but performs no authorization/read/fetch until explicit readFull', async () => {
  const h = await harness(), capability = await h.factory(); assert.equal(h.requests.length, 0); assert.equal(h.calls.includes('token'), false); assert.equal(h.calls.includes('member'), false);
  assert.deepEqual(Object.keys(capability), ['readFull', 'readDirectory']); assert.ok(Object.isFrozen(capability));
  const snapshot = await capability.readFull(); assert.equal(snapshot.readTime, SNAPSHOT_TIME); assert.equal(snapshot.patients.length, 0);
});
test('SDK probes exact catalog once then sends every allowlisted page/singleton at exactly one captured readTime', async () => {
  const h = await harness({ full: true }), capability = await h.factory(), result = await capability.readFull(); assert.equal(result.patients[0].paidCents, 75_000);
  assert.equal(h.requests[0].body.readTime, undefined); const probe = h.requests[0].body.structuredQuery;
  assert.equal(probe.from[0].collectionId, 'settings'); assert.equal(probe.where.fieldFilter.value.referenceValue.split('/').at(-1), 'serviceCatalog');
  assert.ok(h.requests.slice(1).every(request => request.body.readTime === SNAPSHOT_TIME));
  const singletons = h.requests.slice(1).filter(request => request.body.structuredQuery?.from[0].collectionId === 'settings');
  assert.deepEqual(singletons.map(request => request.body.structuredQuery.where.fieldFilter.value.referenceValue.split('/').at(-1)).sort(),
    ['clinicSettings','prostheticRouting','serviceCatalog']);
  assert.ok(singletons.every(request => request.body.structuredQuery.limit === 1 && request.body.structuredQuery.where.fieldFilter.op === 'EQUAL'
    && request.body.structuredQuery.where.fieldFilter.field.fieldPath === '__name__'));
  assert.equal(h.calls.filter(call => call === 'member').length, h.requests.length * 2); assert.equal(h.calls.filter(call => call === 'token').length, h.requests.length * 2);
  assert.ok(!JSON.stringify(result).includes('SYNTHETIC_ID_TOKEN'));
});

test('SDK registration-only directory preserves authorization fences and fetches no financial/private collection', async () => {
  const h = await harness({ full: true }), capability = await h.factory();
  assert.equal(h.requests.length, 0);
  const result = await capability.readDirectory();
  assert.equal(result.patientProfiles.length, 1); assert.equal(result.readTime, SNAPSHOT_TIME);
  assert.equal(h.requests[0].body.structuredQuery.from[0].collectionId, 'settings');
  assert.ok(h.requests.slice(1).every(request => !request.body.documents
    && ['patientProfiles', 'contactRecords'].includes(request.body.structuredQuery.from[0].collectionId)
    && request.body.readTime === SNAPSHOT_TIME));
  assert.equal(h.calls.filter(call => call === 'member').length, h.requests.length * 2);
  h.active(false); const requests = h.requests.length;
  await assert.rejects(capability.readDirectory()); h.active(true);
  await assert.rejects(capability.readDirectory()); assert.equal(h.requests.length, requests);
});
test('SDK resolves pending material via exact private batchGet names with the same captured readTime, no private scans or output', async () => {
  const h = await harness({ full: true }), key = [...h.fixture.docs.keys()].find(key => key.includes('/materialBalances/'))!;
  const current = h.fixture.docs.get(key).base;
  h.fixture.docs.set(key, { schemaVersion: 2, clinicId: 'main', recordId: current.recordId, base: null,
    pending: { operationId: snapshotId(14), indexes: [0], lastProofRank: 0,
      candidate: { ...current, revision: 1, lastOperationId: snapshotId(14), usedMilli: 0, wasteMilli: 0, consumedCostCents: 0 } } });
  h.fixture.docs.delete(`clinics/main/materialUsages/${snapshotId(17)}`);
  const cap = await h.factory(), result = await cap.readFull(), privateReads = h.requests.filter(request => request.body.documents);
  assert.equal(privateReads.length, 2); assert.ok(privateReads.every(request => request.body.documents.length === 1 && request.body.readTime === SNAPSHOT_TIME));
  assert.ok(privateReads.some(request => request.body.documents[0].endsWith(`/operationIntents/${snapshotId(14)}`)));
  assert.ok(privateReads.some(request => request.body.documents[0].endsWith(`/expenseOperations/${snapshotId(14)}`)));
  assert.equal(result.records.materialBalances[0].purchasedMilli, 2000); assert.doesNotMatch(JSON.stringify(result.records.materialBalances), /pending|requestHash/);
});
for (const privateFault of ['foreign', 'time', 'extra', 'duplicate'] as const) {
  test(`SDK private material resolution rejects altered batchGet framing without a partial export: ${privateFault}`, async () => {
    const h = await harness({ full: true, privateFault }), key = [...h.fixture.docs.keys()].find(key => key.includes('/materialBalances/'))!;
    const current = h.fixture.docs.get(key).base;
    h.fixture.docs.set(key, { schemaVersion: 2, clinicId: 'main', recordId: current.recordId, base: null,
      pending: { operationId: snapshotId(14), indexes: [0], lastProofRank: 0,
        candidate: { ...current, revision: 1, lastOperationId: snapshotId(14), usedMilli: 0, wasteMilli: 0, consumedCostCents: 0 } } });
    h.fixture.docs.delete(`clinics/main/materialUsages/${snapshotId(17)}`);
    const cap = await h.factory(); await assert.rejects(cap.readFull());
  });
}
for (const options of [{ hostname: 'clinic.example.invalid' }, { appName: '[DEFAULT]' }, { appName: 'firebase-setup-test' }, { projectId: 'foreign-project' }, { emulator: true }]) {
  test(`SDK denies alternate runtime/app/project/emulator before reads: ${JSON.stringify(options)}`, async () => { const h = await harness(options); await assert.rejects(h.factory()); assert.equal(h.requests.length, 0); });
}
for (const options of [{ verified: false }, { provider: 'google.com' }, { claims: { dentalClinicRole: 'secretary' } }, { member: { status: 'disabled' } }, { member: { verifiedAfter: 101 } }]) {
  test(`SDK requires fresh canonical verified password owner, never historical snapshot membership: ${JSON.stringify(options)}`, async () => {
    const h = await harness(options), cap = await h.factory(); await assert.rejects(cap.readFull()); assert.equal(h.requests.length, 0);
  });
}
for (const stopAt of ['token', 'member-doc', 'member', 'member-exists', 'member-data', 'fetch', 'response-ok', 'response-status', 'response-redirected', 'response-header', 'response-body', 'reader', 'stream-chunk', 'stream-done']) {
  test(`SDK boundary ${stopAt} permanently invalidates late reads on actual lease loss`, async () => {
    const h = await harness({ stopAt }), cap = await h.factory(); await assert.rejects(cap.readFull()); const reads = h.requests.length;
    h.active(true); await assert.rejects(cap.readFull()); assert.equal(h.requests.length, reads);
  });
}
test('same-UID user object replacement, UID mutation and external-host transition never revive an old capability', async () => {
  for (const mutate of [(h: Awaited<ReturnType<typeof harness>>) => { h.auth.currentUser = { ...h.user }; },
    (h: Awaited<ReturnType<typeof harness>>) => { h.user.uid = 'different-user'; },
    (h: Awaited<ReturnType<typeof harness>>) => { h.location.hostname = 'external.example.invalid'; }]) {
    const h = await harness(), cap = await h.factory(); mutate(h); await assert.rejects(cap.readFull()); h.auth.currentUser = h.user; h.user.uid = SNAPSHOT_OWNER; h.location.hostname = '127.0.0.1'; await assert.rejects(cap.readFull());
  }
});
for (const options of [{ status: 403 }, { status: 500 }, { tooLarge: true }, { badUtf8: true }, { badJson: true }, { drift: true }, { redirect: true }]) {
  test(`REST failure/malformed/oversize/drifting snapshot never becomes cached/local/partial output: ${JSON.stringify(options)}`, async () => {
    const h = await harness(options), cap = await h.factory(); await assert.rejects(cap.readFull(), error => error instanceof Error || String(error).includes('تعذر'));
  });
}
test('SDK module exposes no write/cache/image/provider SDK and only fixed REST endpoint', async () => {
  const output = await compiled; assert.ok(!Object.keys(output.metafile!.inputs).some(file => /services[/\\]aiService|utils[/\\]Storage|firebase-admin/.test(file)));
  const h = await harness(), cap = await h.factory(); assert.equal((cap as any).query, undefined); assert.equal((cap as any).auth, undefined); assert.equal((cap as any).token, undefined);
});
