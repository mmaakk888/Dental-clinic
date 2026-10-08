import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
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
  memberDisabled?: boolean; staleAuthTime?: boolean; swapDuringMemberRead?: boolean; denyWrite?: boolean } = {}) {
  const compiled = await bundle, module = { exports: {} as any }, calls: string[] = [];
  const user = { uid: UID, email: 'owner@example.invalid', emailVerified: options.verified ?? true };
  const auth = { app: { name: options.appName ?? `clinic-operating-${ID}`, options: { projectId: options.projectId ?? project, authDomain: `${project}.firebaseapp.com` } },
    emulatorConfig: null, currentUser: user as typeof user | null };
  const rows = new Map<string, any>();
  let copyToServiceRealm!: (value: unknown) => any;
  const scope = { module, exports: module.exports, TextEncoder, crypto: webcrypto,
    window: { location: { hostname: options.hostname ?? '127.0.0.1' } },
    get localStorage() { throw new Error('Local clinic storage forbidden'); },
    get sessionStorage() { throw new Error('Local sessions forbidden'); },
    fetch: () => { throw new Error('Real network forbidden'); },
    require: (name: string) => {
      calls.push(`import:${name}`);
      if (name === 'firebase/auth') return {
        getIdTokenResult: async (target: unknown) => { assert.equal(target, user); calls.push('token'); return { signInProvider: 'password', claims: {
          sub: UID, aud: project, iss: `https://securetoken.google.com/${project}`, email: user.email, email_verified: true,
          dentalClinicId: 'main', dentalClinicRole: 'owner', auth_time: options.staleAuthTime ? 99 : 100,
        } }; },
      };
      if (name === 'firebase/firestore/lite') return {
        getFirestore: (app: unknown) => { assert.equal(app, auth.app); calls.push('database:named-default'); return 'synthetic-database'; },
        doc: (_db: unknown, ...parts: string[]) => parts.join('/'),
        getDoc: async (path: string) => {
          assert.equal(path, `clinics/main/members/${UID}`); calls.push(`member:${path}`);
          if (options.swapDuringMemberRead) auth.currentUser = { ...user };
          return { exists: () => true, data: () => copyToServiceRealm({ schemaVersion: 1, clinicId: 'main', uid: UID, role: 'owner',
            status: options.memberDisabled ? 'disabled' : 'active', identityVersion: 1, verifiedAfter: 100 }) };
        },
        runTransaction: async (_db: unknown, work: any, settings: any) => {
          assert.equal(settings.maxAttempts, 5); calls.push('transaction');
          const staged = new Map(rows);
          const result = await work({
            get: async (path: string) => { calls.push(`get:${path}`); return { exists: () => staged.has(path), data: () => staged.get(path) }; },
            set: (path: string, data: unknown) => { if (options.denyWrite) throw new Error('PRIVATE_PERMISSION_DENIED'); calls.push(`set:${path}`); staged.set(path, data); },
            delete: (path: string) => { calls.push(`delete:${path}`); staged.delete(path); },
          });
          rows.clear(); for (const [key, value] of staged) rows.set(key, value); return result;
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
  return { service: module.exports, auth, calls, rows, payload, compiled };
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
