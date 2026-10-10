import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import type { CloudOperatingAuthSession } from './cloudOperatingAuth';

const PROJECT = 'dental-clinic-mmaakk888';
const INSTANCE = '00000000-0000-4000-8000-000000000001';
const EMAIL = 'owner@example.invalid';
const UID = 'synthetic-owner';
const PASSWORD = 'synthetic-password-only';
const AUTH_TIME = 1_700_000_000;

const bundle = build({ entryPoints: ['src/utils/cloudOperatingAuth.ts'], bundle: true, write: false,
  metafile: true, platform: 'node', format: 'cjs', logLevel: 'silent', external: ['firebase/*'],
  supported: { 'dynamic-import': false } });

async function fixture(options: {
  hostname?: string;
  verified?: boolean;
  emulator?: boolean;
  membership?: Record<string, unknown> | null;
  stepFailure?: string;
  switchAt?: string;
  claims?: Record<string, unknown>;
} = {}) {
  const imports: string[] = [];
  const calls: string[] = [];
  const paths: string[][] = [];
  const forced: boolean[] = [];
  const app = { name: '' };
  const user = { uid: UID, email: EMAIL, emailVerified: options.verified ?? true };
  const auth = { currentUser: null as typeof user | null, emulatorConfig: options.emulator ? {} : null, languageCode: '' };
  let observer: ((value: typeof auth.currentUser) => void) | null = null;
  let observerError: (() => void) | null = null;
  const memory = { synthetic: 'memory' };
  const database = {};
  const document = {};
  const module = { exports: {} as {
    createFirebaseOperatingAuth(): Promise<CloudOperatingAuthSession>;
    cloudOperatingAuthErrorMessage(error: unknown): string;
    __copy(value: object): object;
  } };
  const location = { hostname: options.hostname ?? '127.0.0.1' };
  function step(name: string) {
    calls.push(name);
    if (options.switchAt === name) {
      auth.currentUser = { ...user, uid: 'different-synthetic-owner' };
      observer?.(auth.currentUser);
    }
    if (options.stepFailure === name) throw new Error(`synthetic-provider-token-${PASSWORD}`);
  }
  const compiled = await bundle;
  runInNewContext(`${compiled.outputFiles[0].text}\nmodule.exports.__copy = value => ({ ...value });`, {
    module, exports: module.exports,
    window: { location,
      get localStorage() { throw new Error('No clinic records or remembered accounts may be read.'); },
      get sessionStorage() { throw new Error('No local sessions may be read.'); } },
    crypto: { randomUUID: () => INSTANCE },
    fetch: () => { throw new Error('Synthetic SDK test forbids real network requests.'); },
    require: (name: string) => {
      imports.push(name);
      if (name === 'firebase/app') return {
        initializeApp: (settings: { projectId: string; authDomain: string }, appName: string) => {
          assert.equal(settings.projectId, PROJECT);
          assert.equal(settings.authDomain, `${PROJECT}.firebaseapp.com`);
          assert.equal(appName, `clinic-operating-${INSTANCE}`);
          app.name = appName; step('initializeApp'); return app;
        },
        deleteApp: async (target: unknown) => { assert.equal(target, app); step('deleteApp'); },
      };
      if (name === 'firebase/auth') return {
        inMemoryPersistence: memory,
        initializeAuth: (target: unknown, settings: { persistence: unknown }) => {
          assert.equal(target, app); assert.equal(settings.persistence, memory); step('initializeAuth'); return auth;
        },
        signInWithEmailAndPassword: async (target: unknown, email: string, password: string) => {
          assert.equal(target, auth); assert.equal(email, EMAIL); assert.equal(password, PASSWORD);
          step('signIn'); auth.currentUser = user; observer?.(user);
        },
        reload: async (target: unknown) => { assert.equal(target, user); step('reload'); },
        getIdTokenResult: async (target: unknown, force: boolean) => {
          assert.equal(target, user); forced.push(force); step('getToken');
          return { signInProvider: 'password', claims: {
            sub: UID, aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, email: EMAIL,
            email_verified: options.verified ?? true, dentalClinicId: 'main', dentalClinicRole: 'owner',
            auth_time: AUTH_TIME, ...options.claims,
          } };
        },
        signOut: async (target: unknown) => {
          assert.equal(target, auth); step('signOut'); auth.currentUser = null; observer?.(null);
        },
        onAuthStateChanged: (target: unknown, next: typeof observer, failure: typeof observerError) => {
          assert.equal(target, auth); step('subscribe'); observer = next; observerError = failure;
          // Simulate the initial asynchronous SDK notification.
          Promise.resolve().then(() => observer?.(auth.currentUser));
          return () => { step('unsubscribe'); observer = null; observerError = null; };
        },
      };
      if (name === 'firebase/firestore/lite') return {
        getFirestore: (target: unknown, databaseId: string) => {
          assert.equal(target, app); assert.equal(databaseId, '(default)'); step('getFirestore'); return database;
        },
        doc: (target: unknown, ...segments: string[]) => {
          assert.equal(target, database); assert.deepEqual(segments, ['clinics', 'main', 'members', UID]);
          paths.push(segments); step('doc'); return document;
        },
        getDoc: async (target: unknown) => {
          assert.equal(target, document); step('getDoc');
          return {
            exists: () => options.membership !== null,
            data: () => module.exports.__copy(options.membership ?? {
              schemaVersion: 1, clinicId: 'main', uid: UID, role: 'owner', status: 'active',
              identityVersion: 1, verifiedAfter: AUTH_TIME,
            }),
          };
        },
      };
      throw new Error(`Forbidden dependency: ${name}`);
    },
  });
  return { api: module.exports, imports, calls, paths, forced, auth, location,
    loseIdentity: () => { auth.currentUser = null; observer?.(null); },
    observerFailure: () => observerError?.(),
  };
}

test('operating SDK graph excludes clinic storage, App, old backup config, local sessions and full Firestore', async () => {
  const compiled = await bundle;
  const inputs = Object.keys(compiled.metafile!.inputs);
  assert.ok(inputs.some(path => path.endsWith('firebase.cloud-config.json')));
  for (const forbidden of ['storage.ts', 'App.tsx', 'firebaseService.ts', 'firebase-applet-config.json', 'cloudAuthSetup.ts']) {
    assert.equal(inputs.some(path => path.endsWith(forbidden)), false, forbidden);
  }
  const dependencies = compiled.metafile!.outputs[Object.keys(compiled.metafile!.outputs)[0]].imports.map(value => value.path);
  assert.deepEqual(dependencies.sort(), ['firebase/app', 'firebase/auth', 'firebase/firestore/lite'].sort());
});

test('factory rejects external hosts before importing SDK, never just removes the loopback protection', async () => {
  for (const hostname of ['example.com', `${PROJECT}.web.app`, '127.0.0.1.evil.invalid', '192.168.1.2']) {
    const h = await fixture({ hostname });
    await assert.rejects(h.api.createFirebaseOperatingAuth());
    assert.deepEqual(h.imports, []); assert.deepEqual(h.calls, []);
  }
});

test('explicit operating app initializes memory Auth only, not clinical data or Firestore', async () => {
  const h = await fixture();
  const session = await h.api.createFirebaseOperatingAuth();
  assert.deepEqual(h.imports.sort(), ['firebase/app', 'firebase/auth'].sort());
  assert.deepEqual(h.calls, ['initializeApp', 'initializeAuth', 'subscribe']);
  assert.equal(h.auth.languageCode, 'ar');
  assert.equal(session.getState().phase, 'signed-out');
  assert.deepEqual(h.paths, []);
  await session.dispose();
  assert.deepEqual(h.calls.slice(-3), ['signOut', 'unsubscribe', 'deleteApp']);
});

test('owner sign-in refreshes identity and reads only exact canonical self membership from the server', async () => {
  const h = await fixture();
  const session = await h.api.createFirebaseOperatingAuth();
  const owner = await session.signIn(EMAIL, PASSWORD);
  assert.equal(owner.uid, UID);
  assert.equal(session.getState().phase, 'owner-checked');
  assert.deepEqual(h.paths, [['clinics', 'main', 'members', UID]]);
  assert.deepEqual(h.forced, [true]);
  await session.authorizeOwner();
  assert.equal(h.paths.length, 2);
  assert.deepEqual(h.forced, [true, true]);
  await session.dispose();
});

test('unverified, foreign-project, wrong-claim and missing auth_time identities never read Firestore', async () => {
  const cases = [{ verified: false }, { claims: { aud: 'foreign-project' } },
    { claims: { dentalClinicRole: 'secretary' } }, { claims: { auth_time: '1700000000' } },
    { claims: { auth_time: -1 } }, { claims: { auth_time: undefined } }];
  for (const options of cases) {
    const h = await fixture(options);
    const session = await h.api.createFirebaseOperatingAuth();
    await assert.rejects(session.signIn(EMAIL, PASSWORD));
    assert.equal(session.getState().owner, null);
    assert.equal(h.imports.includes('firebase/firestore/lite'), false);
    assert.equal(h.auth.currentUser, null);
    await session.dispose();
  }
});

test('missing, disabled, pre-cutoff or malformed membership cannot produce owner-checked', async () => {
  const baseline = { schemaVersion: 1, clinicId: 'main', uid: UID, role: 'owner', status: 'active',
    identityVersion: 1, verifiedAfter: AUTH_TIME };
  for (const membership of [null, { ...baseline, status: 'disabled' },
    { ...baseline, verifiedAfter: AUTH_TIME + 1 }, { ...baseline, extra: true }]) {
    const h = await fixture({ membership });
    const session = await h.api.createFirebaseOperatingAuth();
    await assert.rejects(session.signIn(EMAIL, PASSWORD));
    assert.equal(session.getState().owner, null); assert.equal(h.auth.currentUser, null);
    await session.dispose();
  }
});

test('identity changes at each asynchronous boundary prevent any late owner result', async () => {
  for (const switchAt of ['reload', 'getToken', 'getDoc']) {
    const h = await fixture({ switchAt });
    const session = await h.api.createFirebaseOperatingAuth();
    await assert.rejects(session.signIn(EMAIL, PASSWORD));
    assert.equal(session.getState().owner, null); assert.equal(h.auth.currentUser, null);
    if (switchAt !== 'getDoc') assert.deepEqual(h.paths, []);
    await session.dispose();
  }
});

test('SDK sign-out or observer failure clears previous UI snapshot immediately', async () => {
  for (const event of ['loseIdentity', 'observerFailure'] as const) {
    const h = await fixture();
    const session = await h.api.createFirebaseOperatingAuth();
    await session.signIn(EMAIL, PASSWORD);
    h[event]();
    assert.deepEqual({ ...session.getState() }, { phase: 'signed-out', owner: null });
    await session.dispose();
  }
});

test('runtime host change cannot continue a prior successful login', async () => {
  const h = await fixture();
  const session = await h.api.createFirebaseOperatingAuth();
  await session.signIn(EMAIL, PASSWORD);
  h.location.hostname = 'external.example.invalid';
  await assert.rejects(session.authorizeOwner());
  assert.equal(session.getState().owner, null); assert.equal(h.auth.currentUser, null);
  assert.equal(h.paths.length, 1);
  await session.dispose();
});

test('emulator or initialization/subscription failure destroys only its isolated app with safe errors', async () => {
  for (const options of [{ emulator: true }, { stepFailure: 'initializeAuth' }, { stepFailure: 'subscribe' }]) {
    const h = await fixture(options);
    await assert.rejects(h.api.createFirebaseOperatingAuth(), error => {
      assert.equal(h.api.cloudOperatingAuthErrorMessage(error).includes(PASSWORD), false);
      return true;
    });
    assert.equal(h.calls.filter(call => call === 'deleteApp').length, 1);
    assert.deepEqual(h.paths, []);
  }
});

test('SDK/provider failures never expose tokens or credential payloads and never produce a local fallback', async () => {
  for (const stepFailure of ['signIn', 'reload', 'getToken', 'getDoc']) {
    const h = await fixture({ stepFailure });
    const session = await h.api.createFirebaseOperatingAuth();
    await assert.rejects(session.signIn(EMAIL, PASSWORD), error => {
      assert.equal(String(error).includes(PASSWORD), false);
      assert.equal(h.api.cloudOperatingAuthErrorMessage(error).includes(PASSWORD), false);
      return true;
    });
    assert.equal(session.getState().owner, null); assert.equal(h.auth.currentUser, null);
    await session.dispose();
  }
});
