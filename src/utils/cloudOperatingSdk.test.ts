import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import type { CloudOperatingFirebaseSession } from './cloudOperatingAuth';

const PROJECT = 'dental-clinic-mmaakk888';
const INSTANCE = '00000000-0000-4000-8000-000000000001';
const EMAIL = 'owner@example.invalid';
const UID = 'synthetic-owner';
const PASSWORD = 'synthetic-password-only';
const AUTH_TIME = 1_700_000_000;
const RECORD = '00000000-0000-4000-8000-000000000002';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(accept => { resolve = accept; });
  return { promise, resolve };
}

async function until(check: () => boolean) {
  for (let tick = 0; tick < 100 && !check(); ++tick) await Promise.resolve();
  assert.equal(check(), true, 'Expected synthetic boundary was not reached.');
}

const bundle = build({ entryPoints: ['src/utils/cloudOperatingAuth.ts'], bundle: true, write: false,
  metafile: true, platform: 'node', format: 'cjs', logLevel: 'silent', external: ['firebase/*', './firebaseCloudContacts', './firebaseCloudPatients'],
  supported: { 'dynamic-import': false } });

async function fixture(options: {
  hostname?: string;
  verified?: boolean;
  emulator?: boolean;
  membership?: Record<string, unknown> | null;
  stepFailure?: string;
  switchAt?: string;
  claims?: Record<string, unknown>;
  contactsImportHook?: () => void;
  contactsFactoryGate?: Promise<void>;
  contactsMethodGate?: Promise<void>;
  contactsFailure?: unknown;
  patientsImportHook?: () => void;
  patientsFactoryGate?: Promise<void>;
  patientsMethodGate?: Promise<void>;
  patientsFailure?: unknown;
  onGetDoc?: () => Promise<void> | void;
} = {}) {
  const imports: string[] = [];
  const calls: string[] = [];
  const paths: string[][] = [];
  const forced: boolean[] = [];
  const contactCalls: string[] = [];
  const contactInputs: unknown[] = [];
  let contactsActive: (() => boolean) | null = null;
  const patientCalls: string[] = [], patientInputs: unknown[] = [];
  let patientsActive: (() => boolean) | null = null;
  const app = { name: '' };
  const user = { uid: UID, email: EMAIL, emailVerified: options.verified ?? true };
  const auth = { currentUser: null as typeof user | null, emulatorConfig: options.emulator ? {} : null, languageCode: '' };
  let observer: ((value: typeof auth.currentUser) => void) | null = null;
  let observerError: (() => void) | null = null;
  const memory = { synthetic: 'memory' };
  const database = {};
  const document = {};
  const module = { exports: {} as {
    createFirebaseOperatingAuth(): Promise<CloudOperatingFirebaseSession>;
    cloudOperatingAuthErrorMessage(error: unknown): string;
    __copy(value: object): object;
    __input<T>(value: T): T;
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
  runInNewContext(`${compiled.outputFiles[0].text}\nmodule.exports.__copy = value => ({ ...value });
module.exports.__input = value => JSON.parse(JSON.stringify(value));`, {
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
      if (name === './firebaseCloudContacts') {
        options.contactsImportHook?.();
        return { createFirebaseCloudContacts: async (target: unknown, settings: { isActive: () => boolean }) => {
          assert.equal(target, auth);
          assert.equal(settings.isActive(), true);
          contactCalls.push('factory'); contactsActive = settings.isActive;
          await options.contactsFactoryGate;
          const work = async <T>(name: string, result: T) => {
            contactCalls.push(name);
            await options.contactsMethodGate;
            if (options.contactsFailure !== undefined) throw options.contactsFailure;
            return result;
          };
          return {
            commit: (input: unknown) => {
              contactInputs.push(input);
              return work('commit', { status: 'committed', recordId: RECORD, revision: 1 });
            },
            get: () => work('get', null),
            listPage: (input: unknown) => {
              contactInputs.push(input);
              return work('listPage', { records: [], nextAfterId: null });
            },
          };
        } };
      }
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
      if (name === './firebaseCloudPatients') {
        options.patientsImportHook?.();
        return { createFirebaseCloudPatients: async (target: unknown, settings: { isActive: () => boolean }) => {
          assert.equal(target, auth); assert.equal(settings.isActive(), true);
          patientCalls.push('factory'); patientsActive = settings.isActive;
          await options.patientsFactoryGate;
          const work = async <T>(name: string, input: unknown, result: T) => {
            patientCalls.push(name); patientInputs.push(input);
            await options.patientsMethodGate;
            if (options.patientsFailure !== undefined) throw options.patientsFailure;
            return result;
          };
          return {
            commit: (input: unknown) => work('commit', input, { status: 'committed', recordId: RECORD, revision: 1, fileNo: 1 }),
            get: (input: unknown) => work('get', input, null),
            getByFileNo: (input: unknown) => work('getByFileNo', input, null),
            listPage: (input: unknown) => work('listPage', input, { records: [], nextAfterId: null }),
            findByPhone: (input: unknown) => work('findByPhone', input, { records: [], nextAfterId: null }),
          };
        } };
      }
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
          await options.onGetDoc?.();
          return {
            exists: () => { step('snapshotExists'); return options.membership !== null; },
            data: () => { step('snapshotData'); return module.exports.__copy(options.membership ?? {
              schemaVersion: 1, clinicId: 'main', uid: UID, role: 'owner', status: 'active',
              identityVersion: 1, verifiedAfter: AUTH_TIME,
            }); },
          };
        },
      };
      throw new Error(`Forbidden dependency: ${name}`);
    },
  });
  return { api: module.exports, imports, calls, paths, forced, auth, location, contactCalls, contactInputs,
    contactsActive: () => contactsActive?.() ?? false,
    patientCalls, patientInputs, patientsActive: () => patientsActive?.() ?? false,
    loseIdentity: () => { auth.currentUser = null; observer?.(null); },
    replaceIdentity: () => { auth.currentUser = { ...user }; observer?.(auth.currentUser); },
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
  assert.deepEqual(dependencies.sort(), ['firebase/app', 'firebase/auth', 'firebase/firestore/lite', './firebaseCloudContacts', './firebaseCloudPatients'].sort());
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
  for (const switchAt of ['reload', 'getToken', 'getDoc', 'snapshotExists', 'snapshotData']) {
    const h = await fixture({ switchAt });
    const session = await h.api.createFirebaseOperatingAuth();
    await assert.rejects(session.signIn(EMAIL, PASSWORD));
    assert.equal(session.getState().owner, null); assert.equal(h.auth.currentUser, null);
    if (switchAt === 'reload' || switchAt === 'getToken') assert.deepEqual(h.paths, []);
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

test('contacts are explicit and unavailable before owner confirmation without loading their adapter', async () => {
  const h = await fixture();
  const session = await h.api.createFirebaseOperatingAuth();
  await assert.rejects(session.getContacts());
  assert.equal(h.imports.includes('./firebaseCloudContacts'), false);
  assert.deepEqual(h.contactCalls, []);
  await session.signIn(EMAIL, PASSWORD);
  assert.equal(h.imports.includes('./firebaseCloudContacts'), false);
  await session.dispose();
});

test('contacts bind only exact isolated Auth, cache creation not data, and freshly authorize every method', async () => {
  const h = await fixture();
  const session = await h.api.createFirebaseOperatingAuth();
  await session.signIn(EMAIL, PASSWORD);
  const repository = await session.getContacts();
  const again = await session.getContacts();
  assert.equal(again, repository);
  assert.equal(Object.isFrozen(repository), true);
  assert.equal(h.contactsActive(), true);
  assert.deepEqual(Object.keys(session).sort(), ['authorizeOwner', 'dispose', 'getContacts', 'getPatients', 'getState',
    'invalidate', 'signIn', 'signOut', 'subscribe'].sort());
  assert.deepEqual(Object.keys(repository).sort(), ['commit', 'get', 'listPage']);
  assert.deepEqual(h.contactCalls, ['factory']);
  const before = h.paths.length;
  assert.equal(await repository.get(RECORD), null);
  const page = await repository.listPage();
  assert.equal(page.nextAfterId, null);
  const committed = await repository.commit(h.api.__input({ operationId: INSTANCE, recordId: RECORD,
    expectedRevision: 0, action: 'create' as const, contact: { id: RECORD, name: 'Synthetic contact',
      mobile: '01000000001', createdAt: '2026-10-10T10:00:00.000Z' } }));
  assert.equal(committed.revision, 1);
  assert.equal(h.paths.length, before + 3);
  assert.deepEqual(h.contactCalls, ['factory', 'get', 'listPage', 'commit']);
  await session.dispose();
});

test('logout permanently revokes retained contact capabilities even after same owner logs in again', async () => {
  const h = await fixture();
  const session = await h.api.createFirebaseOperatingAuth();
  await session.signIn(EMAIL, PASSWORD);
  const old = await session.getContacts();
  const logout = session.signOut();
  assert.equal(h.contactsActive(), false);
  await assert.rejects(old.get(RECORD));
  await logout;
  await session.signIn(EMAIL, PASSWORD);
  await assert.rejects(old.listPage());
  await assert.rejects(old.commit(h.api.__input({ operationId: INSTANCE, recordId: RECORD,
    expectedRevision: 0, action: 'create' as const, contact: { id: RECORD, name: 'Synthetic contact',
      mobile: '01000000001', createdAt: '2026-10-10T10:00:00.000Z' } })));
  assert.deepEqual(h.contactCalls, ['factory']);
  const next = await session.getContacts();
  assert.notEqual(next, old);
  assert.equal(await next.get(RECORD), null);
  assert.deepEqual(h.contactCalls, ['factory', 'factory', 'get']);
  await session.dispose();
});

test('explicit invalidation, disposal and SDK identity replacement immediately revoke retained methods', async () => {
  for (const event of ['invalidate', 'dispose', 'loseIdentity', 'replaceIdentity', 'observerFailure'] as const) {
    const h = await fixture();
    const session = await h.api.createFirebaseOperatingAuth();
    await session.signIn(EMAIL, PASSWORD);
    const repository = await session.getContacts();
    if (event === 'invalidate') session.invalidate();
    else if (event === 'dispose') void session.dispose();
    else h[event]();
    assert.equal(h.contactsActive(), false, event);
    await assert.rejects(repository.get(RECORD));
    assert.deepEqual(h.contactCalls, ['factory']);
    await session.dispose();
  }
});

test('host or emulator changes revoke a retained capability rather than allowing it to revive later', async () => {
  for (const change of ['hostname', 'emulator'] as const) {
    const h = await fixture();
    const session = await h.api.createFirebaseOperatingAuth();
    await session.signIn(EMAIL, PASSWORD);
    const repository = await session.getContacts();
    if (change === 'hostname') h.location.hostname = 'external.example.invalid';
    else h.auth.emulatorConfig = {};
    await assert.rejects(repository.get(RECORD));
    h.location.hostname = '127.0.0.1'; h.auth.emulatorConfig = null;
    await assert.rejects(repository.get(RECORD));
    assert.deepEqual(h.contactCalls, ['factory']);
    await session.dispose();
  }
});

test('a closed lazy contacts import never proceeds to adapter creation', async () => {
  let stop: (() => Promise<void>) | null = null;
  let closing: Promise<void> | null = null;
  const h = await fixture({ contactsImportHook: () => { closing = stop!(); } });
  const session = await h.api.createFirebaseOperatingAuth();
  stop = () => session.signOut();
  await session.signIn(EMAIL, PASSWORD);
  await assert.rejects(session.getContacts());
  await closing;
  assert.deepEqual(h.contactCalls, []);
  await session.dispose();
});

test('a delayed adapter factory cannot return a capability after logout or identity changes', async () => {
  for (const change of ['signOut', 'replaceIdentity'] as const) {
    const gate = deferred();
    const h = await fixture({ contactsFactoryGate: gate.promise });
    const session = await h.api.createFirebaseOperatingAuth();
    await session.signIn(EMAIL, PASSWORD);
    const loading = session.getContacts();
    const rejected = assert.rejects(loading);
    await until(() => h.contactCalls.includes('factory'));
    const closing = change === 'signOut' ? session.signOut() : (h.replaceIdentity(), Promise.resolve());
    assert.equal(h.contactsActive(), false);
    gate.resolve();
    await rejected;
    await closing;
    await session.dispose();
  }
});

test('logout during fresh contact authorization prevents lazy initialization or data method invocation', async () => {
  for (const method of ['getContacts', 'get', 'listPage', 'commit'] as const) {
    const gate = deferred();
    let gateEnabled = false;
    let gateReached = false;
    const h = await fixture({ onGetDoc: async () => {
      if (gateEnabled) { gateReached = true; await gate.promise; }
    } });
    const session = await h.api.createFirebaseOperatingAuth();
    await session.signIn(EMAIL, PASSWORD);
    const repository = method === 'getContacts' ? null : await session.getContacts();
    gateEnabled = true;
    const pending = method === 'getContacts' ? session.getContacts() : method === 'get' ? repository!.get(RECORD)
      : method === 'listPage' ? repository!.listPage() : repository!.commit(h.api.__input({ operationId: INSTANCE,
        recordId: RECORD, expectedRevision: 0, action: 'create' as const, contact: { id: RECORD,
          name: 'Synthetic contact', mobile: '01000000001', createdAt: '2026-10-10T10:00:00.000Z' } }));
    const rejected = assert.rejects(pending);
    await until(() => gateReached);
    const closing = session.signOut();
    gate.resolve();
    await rejected;
    await closing;
    assert.deepEqual(h.contactCalls, method === 'getContacts' ? [] : ['factory']);
    if (method === 'getContacts') assert.equal(h.imports.includes('./firebaseCloudContacts'), false);
    await session.dispose();
  }
});

test('an already accepted data request may finish but its post-logout UI result is rejected', async () => {
  for (const method of ['get', 'listPage', 'commit'] as const) {
    const gate = deferred();
    const h = await fixture({ contactsMethodGate: gate.promise });
    const session = await h.api.createFirebaseOperatingAuth();
    await session.signIn(EMAIL, PASSWORD);
    const repository = await session.getContacts();
    const pending = method === 'get' ? repository.get(RECORD) : method === 'listPage' ? repository.listPage()
      : repository.commit(h.api.__input({ operationId: INSTANCE, recordId: RECORD, expectedRevision: 0, action: 'create' as const,
        contact: { id: RECORD, name: 'Synthetic contact', mobile: '01000000001', createdAt: '2026-10-10T10:00:00.000Z' } }));
    const rejected = assert.rejects(pending);
    await until(() => h.contactCalls.includes(method));
    const closing = session.signOut();
    assert.equal(h.contactsActive(), false);
    gate.resolve();
    await rejected;
    await closing;
    assert.deepEqual(h.contactCalls, ['factory', method]);
    await session.dispose();
  }
});

test('bound command and page inputs are snapshotted before pending membership authorization', async () => {
  for (const method of ['commit', 'listPage'] as const) {
    const gate = deferred();
    let enabled = false;
    let reached = false;
    const h = await fixture({ onGetDoc: async () => {
      if (enabled) { reached = true; await gate.promise; }
    } });
    const session = await h.api.createFirebaseOperatingAuth();
    await session.signIn(EMAIL, PASSWORD);
    const repository = await session.getContacts();
    enabled = true;
    const command = h.api.__input({ operationId: INSTANCE, recordId: RECORD, expectedRevision: 0, action: 'create' as const,
      contact: { id: RECORD, name: 'Original synthetic contact', mobile: '01000000001', createdAt: '2026-10-10T10:00:00.000Z' } });
    const query = h.api.__input({ limit: 2, afterId: RECORD });
    const pending = method === 'commit' ? repository.commit(command) : repository.listPage(query);
    await until(() => reached);
    command.operationId = RECORD;
    command.contact.name = 'Changed during authorization';
    command.contact.mobile = '01000000002';
    query.limit = 50;
    query.afterId = INSTANCE;
    gate.resolve();
    await pending;
    const received = h.contactInputs[0] as typeof command & typeof query;
    if (method === 'commit') {
      assert.equal(received.operationId, INSTANCE);
      assert.equal(received.contact.name, 'Original synthetic contact');
      assert.equal(received.contact.mobile, '01000000001');
    } else {
      assert.equal(received.limit, 2);
      assert.equal(received.afterId, RECORD);
    }
    await session.dispose();
  }
});

test('invalid or malicious contact inputs reject asynchronously before another authorization or data request', async () => {
  const h = await fixture();
  const session = await h.api.createFirebaseOperatingAuth();
  await session.signIn(EMAIL, PASSWORD);
  const repository = await session.getContacts();
  const before = h.paths.length;
  const malicious = new Proxy({}, { ownKeys() { throw new Error(PASSWORD); } });
  for (const input of [{}, malicious]) {
    let pending!: Promise<unknown>;
    assert.doesNotThrow(() => { pending = repository.commit(input as never); });
    await assert.rejects(pending, error => !String(error).includes(PASSWORD));
  }
  for (const input of [{ limit: 0 }, malicious]) {
    let pending!: Promise<unknown>;
    assert.doesNotThrow(() => { pending = repository.listPage(input as never); });
    await assert.rejects(pending, error => !String(error).includes(PASSWORD));
  }
  assert.equal(h.paths.length, before);
  await session.dispose();
});

test('contact method failures keep provider details and malformed Proxy exceptions out of UI errors', async () => {
  for (const contactsFailure of [new Error(PASSWORD),
    new Proxy({}, { getPrototypeOf() { throw new Error(PASSWORD); } })]) {
    const h = await fixture({ contactsFailure });
    const session = await h.api.createFirebaseOperatingAuth();
    await session.signIn(EMAIL, PASSWORD);
    const repository = await session.getContacts();
    await assert.rejects(repository.get(RECORD), error => {
      assert.equal(String(error).includes(PASSWORD), false);
      assert.equal(h.api.cloudOperatingAuthErrorMessage(error).includes(PASSWORD), false);
      return true;
    });
    await session.dispose();
  }
});

test('patient capability is explicit, owner-only, lazy and exposes no SDK app or local data', async () => {
  const h = await fixture(), session = await h.api.createFirebaseOperatingAuth();
  await assert.rejects(session.getPatients());
  await session.signIn(EMAIL, PASSWORD);
  assert.deepEqual(h.patientCalls, []); assert.equal(h.imports.includes('./firebaseCloudPatients'), false);
  const repository = await session.getPatients();
  assert.equal(repository, await session.getPatients()); assert.deepEqual(h.patientCalls, ['factory']);
  assert.deepEqual(Object.keys(repository).sort(), ['commit', 'findByPhone', 'get', 'getByFileNo', 'listPage']);
  assert.equal(h.patientsActive(), true);
  const before = h.paths.length;
  await repository.get(RECORD); await repository.getByFileNo(1);
  await repository.listPage(); await repository.findByPhone(h.api.__input({ mobile: '01000000001' }));
  await repository.commit(h.api.__input({ operationId: INSTANCE, recordId: RECORD, expectedRevision: 0, action: 'create',
    profile: { name: 'Synthetic profile', mobile: '', age: 0, gender: '', firstVisit: '2026-10-10', notes: '', allergy: '' } }));
  assert.equal(h.paths.length, before + 5, 'fresh forced-token and membership authorization before every capability operation');
  assert.deepEqual(h.contactCalls, []); await session.dispose(); assert.equal(h.patientsActive(), false);
});

test('retained patient methods cannot revive across same-UID relogin or actual identity/runtime loss', async () => {
  for (const event of ['signOut', 'invalidate', 'replacement', 'hostname', 'emulator', 'dispose'] as const) {
    const h = await fixture(), session = await h.api.createFirebaseOperatingAuth(); await session.signIn(EMAIL, PASSWORD);
    const repository = await session.getPatients();
    if (event === 'signOut') { await session.signOut(); await session.signIn(EMAIL, PASSWORD); }
    if (event === 'invalidate') session.invalidate();
    if (event === 'replacement') h.replaceIdentity();
    if (event === 'hostname') h.location.hostname = 'outside.invalid';
    if (event === 'emulator') (h.auth as any).emulatorConfig = {};
    if (event === 'dispose') await session.dispose();
    await assert.rejects(repository.get(RECORD), undefined, event);
    assert.equal(h.patientsActive(), false, event);
    h.location.hostname = '127.0.0.1'; (h.auth as any).emulatorConfig = null;
    await assert.rejects(repository.listPage(), undefined, 'restoring runtime never resurrects old capability');
    assert.deepEqual(h.patientCalls, ['factory']); await session.dispose();
  }
});

test('patient import/factory cancellation never yields a late usable repository', async () => {
  let dispose!: () => Promise<void>, closing: Promise<void> | null = null;
  const h = await fixture({ patientsImportHook: () => { closing = dispose(); } });
  const session = await h.api.createFirebaseOperatingAuth(); await session.signIn(EMAIL, PASSWORD); dispose = session.dispose;
  await assert.rejects(session.getPatients()); await closing; assert.deepEqual(h.patientCalls, []);
  const gate = deferred(), next = await fixture({ patientsFactoryGate: gate.promise });
  const second = await next.api.createFirebaseOperatingAuth(); await second.signIn(EMAIL, PASSWORD);
  const loading = second.getPatients(); await until(() => next.patientCalls.includes('factory'));
  await second.signOut(); gate.resolve(); await assert.rejects(loading); assert.equal(next.patientsActive(), false); await second.dispose();
});

test('patient commands/pages/phone queries snapshot before delayed membership checks', async () => {
  for (const method of ['commit', 'listPage', 'findByPhone'] as const) {
    const gate = deferred(); let enabled = false, reached = false;
    const h = await fixture({ onGetDoc: async () => { if (enabled) { reached = true; await gate.promise; } } });
    const session = await h.api.createFirebaseOperatingAuth(); await session.signIn(EMAIL, PASSWORD);
    const repository = await session.getPatients(); enabled = true;
    const command = h.api.__input({ operationId: INSTANCE, recordId: RECORD, expectedRevision: 0, action: 'create' as const,
      profile: { name: 'Original synthetic profile', mobile: '01000000001', age: 20, gender: '', firstVisit: '2026-10-10', notes: '', allergy: '' } });
    const query = h.api.__input({ limit: 2, afterId: RECORD, mobile: '01000000001' });
    const page = h.api.__input({ limit: 2, afterId: RECORD });
    const pending = method === 'commit' ? repository.commit(command) : method === 'findByPhone' ? repository.findByPhone(query) : repository.listPage(page);
    await until(() => reached);
    command.operationId = RECORD; command.profile.name = 'Changed'; query.mobile = '01000000002'; query.limit = 50; page.limit = 50;
    gate.resolve(); await pending;
    const received = h.patientInputs[0] as any;
    if (method === 'commit') { assert.equal(received.operationId, INSTANCE); assert.equal(received.profile.name, 'Original synthetic profile'); }
    else { assert.equal(received.limit, 2); if (method === 'findByPhone') assert.equal(received.mobile, '201000000001'); }
    await session.dispose();
  }
});

test('patient authorization/factory never proceeds after logout at membership boundary', async () => {
  const gate = deferred(); let enabled = false, reached = false;
  const h = await fixture({ onGetDoc: async () => { if (enabled) { reached = true; await gate.promise; } } });
  const session = await h.api.createFirebaseOperatingAuth(); await session.signIn(EMAIL, PASSWORD); enabled = true;
  const pending = session.getPatients(); await until(() => reached); const stopping = session.signOut();
  gate.resolve(); await assert.rejects(pending); await stopping;
  assert.deepEqual(h.patientCalls, []); await session.dispose();
});

test('server-accepted patient operation may finish after logout but its late result is rejected', async () => {
  const gate = deferred(), h = await fixture({ patientsMethodGate: gate.promise });
  const session = await h.api.createFirebaseOperatingAuth(); await session.signIn(EMAIL, PASSWORD); const repository = await session.getPatients();
  const pending = repository.get(RECORD); await until(() => h.patientCalls.includes('get'));
  await session.signOut(); gate.resolve(); await assert.rejects(pending); assert.equal(h.patientsActive(), false); await session.dispose();
});

test('patient command/query validation and provider failures never expose payloads or load local fallback', async () => {
  const h = await fixture({ patientsFailure: new Error(PASSWORD) }), session = await h.api.createFirebaseOperatingAuth();
  await session.signIn(EMAIL, PASSWORD); const repository = await session.getPatients(); const before = h.paths.length;
  const malicious = new Proxy({}, { ownKeys() { throw new Error(PASSWORD); } });
  for (const value of [{}, malicious]) {
    await assert.rejects(repository.commit(value as never), error => !String(error).includes(PASSWORD));
    await assert.rejects(repository.findByPhone(value as never), error => !String(error).includes(PASSWORD));
  }
  assert.equal(h.paths.length, before); assert.deepEqual(h.patientCalls, ['factory']);
  await assert.rejects(repository.get(RECORD), error => !String(error).includes(PASSWORD)); await session.dispose();
});
