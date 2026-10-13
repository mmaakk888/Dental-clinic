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
  member?: object; claims?: object; stopAt?: string; swapAt?: string; status?: number; tooLarge?: boolean; badUtf8?: boolean; badJson?: boolean; drift?: boolean; redirect?: boolean };
async function harness(options: Options = {}) {
  const output = await compiled, fixture = await makeClinicSnapshotFixture(options.full ?? false), module = { exports: {} as any };
  const calls: string[] = [], requests: { url: string; init: any; body: any }[] = [];
  const user = { uid: SNAPSHOT_OWNER, email: 'snapshot-owner@example.invalid', emailVerified: options.verified ?? true };
  const auth = { app: { name: options.appName ?? `clinic-operating-${snapshotId(999)}`, options: { projectId: options.projectId ?? 'dental-clinic-mmaakk888',
    authDomain: 'dental-clinic-mmaakk888.firebaseapp.com' } }, currentUser: user as typeof user | null, emulatorConfig: options.emulator ? {} : null };
  let active = true, copy!: (value: unknown) => any;
  const location = { hostname: options.hostname ?? '127.0.0.1' };
  function step(name: string) { calls.push(name); if (name === options.stopAt) active = false; if (name === options.swapAt) auth.currentUser = { ...user }; }
  const scope = { module, exports: module.exports, TextEncoder, TextDecoder, Uint8Array, AbortController, setTimeout, clearTimeout, crypto: webcrypto,
    window: { location, get localStorage() { throw new Error('PRIVATE_LOCAL'); }, get sessionStorage() { throw new Error('PRIVATE_LOCAL'); } },
    require: (name: string) => {
      if (name === 'firebase/auth') return { getIdTokenResult: async (target: unknown) => { assert.equal(target, user); step('token'); return copy({ token: 'SYNTHETIC_ID_TOKEN',
        signInProvider: options.provider ?? 'password', claims: { sub: SNAPSHOT_OWNER, aud: 'dental-clinic-mmaakk888', iss: 'https://securetoken.google.com/dental-clinic-mmaakk888',
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
      assert.equal(url, 'https://firestore.googleapis.com/v1/projects/dental-clinic-mmaakk888/databases/(default)/documents/clinics/main:runQuery');
      assert.equal(init.method, 'POST'); assert.equal(init.cache, 'no-store'); assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error'); assert.equal(init.referrerPolicy, 'no-referrer');
      const query = body.structuredQuery, collection = query.from[0].collectionId, documentId = query.where?.fieldFilter.value.referenceValue.split('/').at(-1), afterId = query.startAt?.values[0].referenceValue.split('/').at(-1);
      assert.equal(query.orderBy[0].field.fieldPath, '__name__'); assert.equal(query.orderBy[0].direction, 'ASCENDING'); assert.ok(query.limit >= 1 && query.limit <= 50);
      assert.ok(!['invoiceImages', 'operationIntents', 'members', 'settingsOperations'].includes(collection));
      const values = [...fixture.docs].filter(([key]) => key.startsWith(`clinics/main/${collection}/`) && (!documentId || key.endsWith(`/${documentId}`))
        && (!afterId || key.split('/').at(-1)! > afterId)).sort(([a], [b]) => a.localeCompare(b)).slice(0, query.limit);
      const stamp = options.drift && body.readTime ? '2026-10-13T00:00:00.999999Z' : SNAPSHOT_TIME;
      const response = values.length ? values.map(([key, value]) => ({ readTime: stamp, document: snapshotRestDocument(collection, key.split('/').at(-1)!, value) })) : [{ readTime: stamp }];
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
  assert.deepEqual(Object.keys(capability), ['readFull']); assert.ok(Object.isFrozen(capability));
  const snapshot = await capability.readFull(); assert.equal(snapshot.readTime, SNAPSHOT_TIME); assert.equal(snapshot.patients.length, 0);
});
test('SDK probes exact catalog once then sends every allowlisted page/singleton at exactly one captured readTime', async () => {
  const h = await harness({ full: true }), capability = await h.factory(), result = await capability.readFull(); assert.equal(result.patients[0].paidCents, 75_000);
  assert.equal(h.requests[0].body.readTime, undefined); const probe = h.requests[0].body.structuredQuery;
  assert.equal(probe.from[0].collectionId, 'settings'); assert.equal(probe.where.fieldFilter.value.referenceValue.split('/').at(-1), 'serviceCatalog');
  assert.ok(h.requests.slice(1).every(request => request.body.readTime === SNAPSHOT_TIME));
  assert.equal(h.calls.filter(call => call === 'member').length, h.requests.length * 2); assert.equal(h.calls.filter(call => call === 'token').length, h.requests.length * 2);
  assert.ok(!JSON.stringify(result).includes('SYNTHETIC_ID_TOKEN'));
});
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
