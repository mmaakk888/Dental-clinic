import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';

const ID = '10000000-0000-4000-8000-000000000001';
const OP = '20000000-0000-4000-8000-000000000001';
const UID = 'synthetic-owner';
const project = 'dental-clinic-mmaakk888';
const entry = 'src/utils/firebaseCloudContacts.ts';
const bundle = build({ entryPoints: [entry], bundle: true, write: false, metafile: true, platform: 'node', format: 'cjs',
  external: ['firebase/*'], supported: { 'dynamic-import': false }, logLevel: 'silent' });

async function harness(options: { hostname?: string; projectId?: string; appName?: string; verified?: boolean;
  memberDisabled?: boolean; staleAuthTime?: boolean; swapDuringMemberRead?: boolean; denyWrite?: boolean; denyRead?: boolean;
  stopAt?: 'database' | 'token' | 'member' | 'record' | 'page' | 'transaction-read' | 'transaction-ack' } = {}) {
  const compiled = await bundle, module = { exports: {} as any }, calls: string[] = [];
  const user = { uid: UID, email: 'owner@example.invalid', emailVerified: options.verified ?? true };
  const auth = { app: { name: options.appName ?? `clinic-operating-${ID}`, options: { projectId: options.projectId ?? project, authDomain: `${project}.firebaseapp.com` } },
    emulatorConfig: null, currentUser: user as typeof user | null };
  const rows = new Map<string, any>();
  const active = { value: true };
  const stop = (boundary: typeof options.stopAt) => { if (options.stopAt === boundary) active.value = false; };
  let copyToServiceRealm!: (value: unknown) => any;
  const scope = { module, exports: module.exports, TextEncoder, crypto: webcrypto,
    window: { location: { hostname: options.hostname ?? '127.0.0.1' } },
    get localStorage() { throw new Error('Local clinic storage forbidden'); },
    get sessionStorage() { throw new Error('Local sessions forbidden'); },
    fetch: () => { throw new Error('Real network forbidden'); },
    require: (name: string) => {
      calls.push(`import:${name}`);
      if (name === 'firebase/auth') return {
        getIdTokenResult: async (target: unknown) => { assert.equal(target, user); calls.push('token'); stop('token'); return { signInProvider: 'password', claims: {
          sub: UID, aud: project, iss: `https://securetoken.google.com/${project}`, email: user.email, email_verified: true,
          dentalClinicId: 'main', dentalClinicRole: 'owner', auth_time: options.staleAuthTime ? 99 : 100,
        } }; },
      };
      if (name === 'firebase/firestore/lite') return {
        getFirestore: (app: unknown) => { assert.equal(app, auth.app); calls.push('database:named-default'); stop('database'); return 'synthetic-database'; },
        doc: (_db: unknown, ...parts: string[]) => parts.join('/'),
        getDoc: async (path: string) => {
          if (path.startsWith('clinics/main/contactRecords/')) {
            calls.push(`record:${path}`); if (options.denyRead) throw new Error('PRIVATE_READ_DENIED'); stop('record');
            return { exists: () => rows.has(path), data: () => rows.get(path) };
          }
          assert.equal(path, `clinics/main/members/${UID}`); calls.push(`member:${path}`); stop('member');
          if (options.swapDuringMemberRead) auth.currentUser = { ...user };
          return { exists: () => true, data: () => copyToServiceRealm({ schemaVersion: 1, clinicId: 'main', uid: UID, role: 'owner',
            status: options.memberDisabled ? 'disabled' : 'active', identityVersion: 1, verifiedAfter: 100 }) };
        },
        collection: (_db: unknown, ...parts: string[]) => parts.join('/'),
        documentId: () => '__name__', orderBy: (field: string) => ({ kind: 'order', field }),
        startAfter: (id: string) => ({ kind: 'after', id }), limit: (count: number) => ({ kind: 'limit', count }),
        query: (path: string, ...constraints: any[]) => ({ path, constraints }),
        getDocs: async (query: any) => {
          assert.equal(query.path, 'clinics/main/contactRecords');
          assert.deepEqual(query.constraints[0], { kind: 'order', field: '__name__' });
          assert.equal(query.constraints.at(-1).kind, 'limit');
          calls.push(`page:${JSON.stringify(query.constraints)}`);
          if (options.denyRead) throw new Error('PRIVATE_READ_DENIED'); stop('page');
          const after = query.constraints.find((value: any) => value.kind === 'after')?.id;
          return { docs: [...rows.entries()].filter(([path]) => path.startsWith(`${query.path}/`) && (!after || path.split('/').at(-1)! > after))
            .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).slice(0, query.constraints.at(-1).count)
            .map(([path, data]) => ({ id: path.split('/').at(-1), data: () => data })) };
        },
        runTransaction: async (_db: unknown, work: any, settings: any) => {
          assert.equal(settings.maxAttempts, 5); calls.push('transaction');
          const staged = new Map(rows);
          const result = await work({
            get: async (path: string) => { calls.push(`get:${path}`); stop('transaction-read'); return { exists: () => staged.has(path), data: () => staged.get(path) }; },
            set: (path: string, data: unknown) => { if (options.denyWrite) throw new Error('PRIVATE_PERMISSION_DENIED'); calls.push(`set:${path}`); staged.set(path, data); },
            delete: (path: string) => { calls.push(`delete:${path}`); staged.delete(path); },
          });
          rows.clear(); for (const [key, value] of staged) rows.set(key, value); stop('transaction-ack'); return result;
        },
      };
      throw new Error(`Unexpected SDK import ${name}`);
    },
  };
  runInNewContext(compiled.outputFiles[0].text, scope);
  copyToServiceRealm = runInNewContext('(value) => JSON.parse(JSON.stringify(value))', scope);
  // Construct payload in the bundle's own realm for its plain-object guard.
  const payload = runInNewContext(`({ operationId:'${OP}', recordId:'${ID}', expectedRevision:0, action:'create',
    contact:{ id:'${ID}',name:'جهة اختبار وهمية',mobile:'01000000001',createdAt:'2026-10-08T10:00:00.000Z' } })`, scope);
  return { service: module.exports, auth, calls, rows, payload, compiled, active, toRealm: copyToServiceRealm };
}

test('prepared Firebase contact adapter does not load SDK or clinic storage on import', async () => {
  const h = await harness(); assert.deepEqual(h.calls, []);
  const inputs = Object.keys(h.compiled.metafile!.inputs);
  assert.equal(inputs.some(path => /utils\/(?:storage|localClinicBackup|firebaseService|offlineSync)|App\.tsx|components\//.test(path)), false);
});

test('adapter requires loopback, exact new project and isolated operating app before SDK imports', async () => {
  for (const options of [{ hostname: 'public.example.invalid' }, { projectId: 'zippy-dispatcher-m1ttq' },
    { appName: '[DEFAULT]' }, { appName: `clinic-owner-setup-${ID}` }]) {
    const h = await harness(options);
    await assert.rejects(h.service.createFirebaseCloudContacts(h.auth), /تعذّر تأكيد الحفظ السحابي/);
    assert.deepEqual(h.calls, []); assert.equal(h.rows.size, 0);
  }
});

test('explicit commit uses named-app Lite transaction only after verified canonical owner checks', async () => {
  const h = await harness(), repo = await h.service.createFirebaseCloudContacts(h.auth);
  assert.equal(h.calls.some(call => call.startsWith('member:') || call === 'transaction'), false, 'creating adapter does not read/write records');
  const result = await repo.commit(h.payload); assert.equal(result.status, 'committed'); assert.equal(h.rows.size, 3);
  assert.ok(h.calls.indexOf(`member:clinics/main/members/${UID}`) < h.calls.indexOf('transaction'));
  assert.ok(h.calls.includes('import:firebase/firestore/lite')); assert.equal(h.calls.includes('import:firebase/firestore'), false);
  assert.equal(h.calls.some(call => /patients|backup|expenses|labCosts/.test(call)), false);
});

test('unverified, disabled, stale-cutoff or replaced owner cannot schedule contact writes', async () => {
  for (const options of [{ verified: false }, { memberDisabled: true }, { staleAuthTime: true }, { swapDuringMemberRead: true }]) {
    const h = await harness(options), repo = await h.service.createFirebaseCloudContacts(h.auth);
    await assert.rejects(repo.commit(h.payload), /تعذّر تأكيد الحفظ السحابي/);
    assert.equal(h.rows.size, 0); assert.equal(h.calls.some(call => call.startsWith('set:') || call === 'transaction'), false);
  }
});

test('server permission denial remains a fixed failed save with no local fallback or partial records', async () => {
  const h = await harness({ denyWrite: true }), repo = await h.service.createFirebaseCloudContacts(h.auth);
  await assert.rejects(repo.commit(h.payload), (error: unknown) => /تعذّر تأكيد الحفظ السحابي/.test(String(error)) && !String(error).includes('PRIVATE'));
  assert.equal(h.rows.size, 0);
});

const OTHER = '10000000-0000-4000-8000-000000000002';
function syntheticRecord(id = ID, deleted = false) {
  return { schemaVersion: 1, clinicId: 'main', recordId: id, revision: deleted ? 2 : 1,
    deleted, lastOperationId: OP,
    phoneKey: deleted ? null : createHash('sha256').update('contact-phone-v1:201000000001').digest('hex'),
    data: deleted ? null : { id, name: 'جهة قراءة وهمية', mobile: '01000000001', createdAt: '2026-10-08T10:00:00.000Z' } };
}

test('SDK get uses only a fresh exact contact document and rechecks membership after its result', async () => {
  const h = await harness(), repo = await h.service.createFirebaseCloudContacts(h.auth);
  h.rows.set(`clinics/main/contactRecords/${ID}`, h.toRealm(syntheticRecord()));
  const value = await repo.get(ID);
  assert.equal(value.data.name, 'جهة قراءة وهمية'); assert.equal(value.recordId, ID);
  const recordCall = h.calls.indexOf(`record:clinics/main/contactRecords/${ID}`);
  assert.ok(recordCall > h.calls.indexOf(`member:clinics/main/members/${UID}`));
  assert.ok(h.calls.lastIndexOf(`member:clinics/main/members/${UID}`) > recordCall);
  assert.equal(h.calls.includes('transaction'), false); assert.equal(await repo.get(OTHER), null);
  assert.equal(h.calls.some(call => /patients|backup|expenses|labCosts/.test(call)), false);
});

test('SDK pages use document-ID ordering, an exclusive cursor and bounded limits including tombstones', async () => {
  const h = await harness(), repo = await h.service.createFirebaseCloudContacts(h.auth);
  h.rows.set(`clinics/main/contactRecords/${ID}`, h.toRealm(syntheticRecord()));
  h.rows.set(`clinics/main/contactRecords/${OTHER}`, h.toRealm(syntheticRecord(OTHER, true)));
  const all = await repo.listPage();
  assert.equal(all.records.length, 2); assert.equal(all.records[1].deleted, true); assert.equal(all.nextAfterId, null);
  assert.ok(h.calls.some(call => call.startsWith('page:') && call.includes('"count":25')));
  const first = await repo.listPage(h.toRealm({ limit: 1 })); assert.equal(first.nextAfterId, ID);
  const next = await repo.listPage(h.toRealm({ afterId: ID, limit: 1 }));
  assert.equal(next.records[0].recordId, OTHER); assert.equal(next.nextAfterId, OTHER);
  assert.ok(h.calls.some(call => call.startsWith('page:') && call.includes(`"kind":"after","id":"${ID}"`)));
  assert.equal(h.calls.includes('transaction'), false);
});

test('SDK read denial never becomes an empty successful result or exposes raw provider details', async () => {
  const h = await harness({ denyRead: true }), repo = await h.service.createFirebaseCloudContacts(h.auth);
  for (const read of [() => repo.get(ID), () => repo.listPage()]) {
    await assert.rejects(read(), (error: unknown) => /تعذّر تأكيد الحفظ السحابي/.test(String(error)) && !String(error).includes('PRIVATE'));
  }
  assert.equal(h.rows.size, 0);
});

test('optional lifecycle binding refuses an inactive factory without loading any SDK', async () => {
  for (const isActive of [() => false, () => { throw new Error('PRIVATE_LIFETIME_DETAIL'); }]) {
    const h = await harness();
    await assert.rejects(h.service.createFirebaseCloudContacts(h.auth, { isActive }), (error: unknown) => /تعذّر تأكيد الحفظ السحابي/.test(String(error)) && !String(error).includes('PRIVATE'));
    assert.deepEqual(h.calls, []);
  }
});

test('lifecycle invalidation after synchronous database initialization also refuses the factory', async () => {
  const h = await harness({ stopAt: 'database' });
  await assert.rejects(h.service.createFirebaseCloudContacts(h.auth, { isActive: () => h.active.value }), /تعذّر تأكيد الحفظ السحابي/);
  assert.equal(h.calls.some(call => call.startsWith('member:') || call.startsWith('page:') || call.startsWith('record:')), false);
});

test('owner get and page cannot publish data after lifecycle invalidation at token, membership or record boundaries', async () => {
  for (const method of ['get', 'listPage'] as const) {
    for (const stopAt of ['token', 'member', method === 'get' ? 'record' : 'page'] as const) {
      const h = await harness({ stopAt }), repo = await h.service.createFirebaseCloudContacts(h.auth, { isActive: () => h.active.value });
      h.rows.set(`clinics/main/contactRecords/${ID}`, h.toRealm(syntheticRecord()));
      await assert.rejects(method === 'get' ? repo.get(ID) : repo.listPage(), /تعذّر تأكيد الحفظ السحابي/);
      assert.equal(h.calls.some(call => call.startsWith('set:') || call === 'transaction'), false);
      if (stopAt === 'token') assert.equal(h.calls.some(call => call.startsWith('member:')), false);
      if (stopAt === 'member') assert.equal(h.calls.some(call => call.startsWith('record:') || call.startsWith('page:')), false);
    }
  }
});

test('lifecycle invalidation fences transaction reads and a lost lifetime after commit never confirms success', async () => {
  for (const stopAt of ['transaction-read', 'transaction-ack'] as const) {
    const h = await harness({ stopAt }), repo = await h.service.createFirebaseCloudContacts(h.auth, { isActive: () => h.active.value });
    await assert.rejects(repo.commit(h.payload), /تعذّر تأكيد الحفظ السحابي/);
    assert.equal(h.rows.size, stopAt === 'transaction-read' ? 0 : 3);
    if (stopAt === 'transaction-read') assert.equal(h.calls.some(call => call.startsWith('set:')), false);
  }
});

test('inactive lifecycle blocks every new operation before token or data reads without local fallback', async () => {
  const h = await harness(), repo = await h.service.createFirebaseCloudContacts(h.auth, { isActive: () => h.active.value });
  h.active.value = false; const before = [...h.calls];
  for (const action of [() => repo.get(ID), () => repo.listPage(), () => repo.commit(h.payload)]) await assert.rejects(action(), /تعذّر تأكيد الحفظ السحابي/);
  assert.deepEqual(h.calls, before); assert.equal(h.rows.size, 0);
});
