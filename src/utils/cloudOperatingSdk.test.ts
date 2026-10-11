import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import type { CloudClinicalCapability, CloudOperatingFirebaseSession, CloudServiceCatalogCapability } from './cloudOperatingAuth';
import type { CloudClinicalCommand } from './cloudClinicalRepository';

const PROJECT = 'dental-clinic-mmaakk888';
const INSTANCE = '00000000-0000-4000-8000-000000000001';
const EMAIL = 'owner@example.invalid';
const UID = 'synthetic-owner';
const PASSWORD = 'synthetic-password-only';
const AUTH_TIME = 1_700_000_000;
const RECORD = '00000000-0000-4000-8000-000000000002';
const CREATED_AT = '2026-10-10T10:00:00.000Z';
function rawClinicalCommand(): CloudClinicalCommand {
  return { operationId: INSTANCE, patientId: RECORD, sessionId: INSTANCE, expectedRevision: 0,
    createdAt: CREATED_AT, action: 'visit', paidCents: 10000, data: {
      type: 'حشو مصطنع', date: '2026-10-10', teethIds: ['ur1'], examinationCents: 10000,
      services: [{ id: RECORD, name: 'حشو مصطنع', priceCents: 20000, tooth: 'ur1' }],
      notes: '', treatmentStage: 'first', rootCanalStatus: '', visitStatus: 'follow_up',
    } };
}
function rawCatalogCommand() {
  return { operationId: INSTANCE, expectedRevision: 0, createdAt: CREATED_AT,
    data: { examinationCents: 10000, services: [{ serviceId: RECORD, name: 'خدمة مصطنعة', kind: 'clinical', priceCents: 20000, active: true }] } };
}

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
  metafile: true, platform: 'node', format: 'cjs', logLevel: 'silent', external: ['firebase/*', './firebaseCloudContacts', './firebaseCloudPatients', './firebaseCloudClinical', './firebaseCloudServiceCatalog'],
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
  clinicalImportHook?: () => void;
  clinicalFactoryGate?: Promise<void>;
  clinicalMethodGate?: Promise<void>;
  clinicalFailure?: unknown;
  clinicalIntentKind?: 'clinical' | 'contact';
  clinicalIntentActor?: string;
  catalogImportHook?: () => void;
  catalogFactoryGate?: Promise<void>;
  catalogMethodGate?: Promise<void>;
  catalogFailure?: unknown;
  catalogIntentKind?: 'catalog' | 'clinical';
  catalogIntentActor?: string;
  catalogRecord?: unknown;
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
  const clinicalCalls: string[] = [], clinicalInputs: unknown[] = [];
  let clinicalActive: (() => boolean) | null = null;
  const catalogCalls: string[] = [], catalogInputs: unknown[] = [];
  let catalogActive: (() => boolean) | null = null;
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
    crypto: { randomUUID: () => INSTANCE }, TextEncoder,
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
      if (name === './firebaseCloudClinical') {
        options.clinicalImportHook?.();
        return { createFirebaseCloudClinical: async (target: unknown, settings: { isActive: () => boolean }) => {
          assert.equal(target, auth); assert.equal(settings.isActive(), true);
          clinicalCalls.push('factory'); clinicalActive = settings.isActive;
          await options.clinicalFactoryGate;
          const work = async <T>(name: string, input: unknown, result: T) => {
            clinicalCalls.push(name); clinicalInputs.push(input);
            await options.clinicalMethodGate;
            if (options.clinicalFailure !== undefined) throw options.clinicalFailure;
            return result;
          };
          const intent = (command: unknown, createdAt = '2026-10-10T10:00:00.000Z', status = 'prepared') => module.exports.__input({
            schemaVersion: 1, clinicId: 'main', recordId: INSTANCE, operationId: INSTANCE,
            actorUid: options.clinicalIntentActor ?? UID, kind: options.clinicalIntentKind ?? 'clinical', requestHash: '0'.repeat(64),
            status, revision: status === 'prepared' ? 1 : 2, createdAt, command,
          });
          const recovered = () => rawClinicalCommand();
          return {
            repository: {
              commit: (input: unknown) => work('commit', input, { status: 'committed', patientId: RECORD, sessionId: INSTANCE, revision: 1, fileNo: 1 }),
              getProfile: (input: unknown) => work('getProfile', input, null),
              getAccount: (input: unknown) => work('getAccount', input, null),
              getSession: (input: unknown) => work('getSession', input, null),
              listSessions: (input: unknown) => work('listSessions', input, { records: [], nextAfterId: null }),
              listReceipts: (input: unknown) => work('listReceipts', input, { records: [], nextAfterId: null }),
            },
            journal: {
              prepare: (kind: unknown, command: unknown, createdAt: string) => work('prepare', { kind, command, createdAt }, intent(command, createdAt)),
              get: (id: string) => work('intentGet', id, intent(recovered())),
              listPreparedPage: (kind: unknown, input: unknown) => work('listPreparedPage', { kind, input }, { records: [intent(recovered())], nextAfterId: null }),
              listHistoryPage: (kind: unknown, input: unknown) => work('listHistoryPage', { kind, input }, { records: [intent(recovered())], nextAfterId: null }),
              cancel: (id: string) => work('cancel', id, intent(recovered(), undefined, 'cancelled')),
            },
          };
        } };
      }
      if (name === './firebaseCloudServiceCatalog') {
        options.catalogImportHook?.();
        return { createFirebaseCloudServiceCatalog: async (target: unknown, settings: { isActive: () => boolean }) => {
          assert.equal(target, auth); assert.equal(settings.isActive(), true);
          catalogCalls.push('factory'); catalogActive = settings.isActive; await options.catalogFactoryGate;
          const work = async <T>(name: string, input: unknown, result: T) => {
            catalogCalls.push(name); catalogInputs.push(input); await options.catalogMethodGate;
            if (options.catalogFailure !== undefined) throw options.catalogFailure;
            return result;
          };
          const intent = (command: unknown, createdAt = CREATED_AT, status = 'prepared') => module.exports.__input({
            schemaVersion: 1, clinicId: 'main', recordId: INSTANCE, operationId: INSTANCE,
            actorUid: options.catalogIntentActor ?? UID, kind: options.catalogIntentKind ?? 'catalog', requestHash: '0'.repeat(64),
            status, revision: status === 'prepared' ? 1 : 2, createdAt, command,
          });
          return {
            repository: {
              get: () => work('get', null, options.catalogRecord === undefined ? null : module.exports.__input(options.catalogRecord)),
              commit: (input: unknown) => work('commit', input, { status: 'committed', recordId: 'serviceCatalog', revision: 1 }),
            },
            journal: {
              prepare: (kind: unknown, command: unknown, createdAt: string) => work('prepare', { kind, command, createdAt }, intent(command, createdAt)),
              get: (id: string) => work('intentGet', id, intent(rawCatalogCommand())),
              listPreparedPage: (kind: unknown, input: unknown) => work('listPreparedPage', { kind, input }, { records: [intent(rawCatalogCommand())], nextAfterId: null }),
              listHistoryPage: (kind: unknown, input: unknown) => work('listHistoryPage', { kind, input }, { records: [intent(rawCatalogCommand())], nextAfterId: null }),
              cancel: (id: string) => work('cancel', id, intent(rawCatalogCommand(), undefined, 'cancelled')),
            },
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
    clinicalCalls, clinicalInputs, clinicalActive: () => clinicalActive?.() ?? false,
    catalogCalls, catalogInputs, catalogActive: () => catalogActive?.() ?? false,
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
  assert.deepEqual(dependencies.sort(), ['firebase/app', 'firebase/auth', 'firebase/firestore/lite', './firebaseCloudContacts', './firebaseCloudPatients', './firebaseCloudClinical', './firebaseCloudServiceCatalog'].sort());
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
  assert.deepEqual(Object.keys(session).sort(), ['authorizeOwner', 'dispose', 'getClinical', 'getContacts', 'getPatients', 'getServiceCatalog', 'getState',
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

type ClinicalTestMethod = 'commit' | 'getProfile' | 'getAccount' | 'getSession' | 'listSessions' | 'listReceipts'
  | 'prepare' | 'intentGet' | 'listPreparedPage' | 'listHistoryPage' | 'cancel';
const CLINICAL_METHODS: readonly ClinicalTestMethod[] = ['commit', 'getProfile', 'getAccount', 'getSession', 'listSessions', 'listReceipts',
  'prepare', 'intentGet', 'listPreparedPage', 'listHistoryPage', 'cancel'];
function invokeClinical(capability: CloudClinicalCapability, method: ClinicalTestMethod, copy: <T>(value: T) => T): Promise<unknown> {
  switch (method) {
    case 'commit': return capability.repository.commit(copy(rawClinicalCommand()));
    case 'getProfile': return capability.repository.getProfile(RECORD);
    case 'getAccount': return capability.repository.getAccount(RECORD);
    case 'getSession': return capability.repository.getSession(INSTANCE);
    case 'listSessions': return capability.repository.listSessions(copy({ patientId: RECORD, limit: 2 }));
    case 'listReceipts': return capability.repository.listReceipts(copy({ patientId: RECORD, limit: 2 }));
    case 'prepare': return capability.journal.prepare('clinical', copy(rawClinicalCommand()), CREATED_AT);
    case 'intentGet': return capability.journal.get(INSTANCE);
    case 'listPreparedPage': return capability.journal.listPreparedPage('clinical', copy({ limit: 2 }));
    case 'listHistoryPage': return capability.journal.listHistoryPage!('clinical', copy({ limit: 2 }));
    case 'cancel': return capability.journal.cancel(INSTANCE);
  }
}

test('clinical capability is explicit, lazy, frozen, clinical-only and reauthorizes before AND after each method', async () => {
  const h = await fixture(), session = await h.api.createFirebaseOperatingAuth();
  await assert.rejects(session.getClinical()); assert.equal(h.imports.includes('./firebaseCloudClinical'), false);
  await session.signIn(EMAIL, PASSWORD);
  assert.deepEqual(h.clinicalCalls, []); assert.equal(h.imports.includes('./firebaseCloudClinical'), false);
  const capability = await session.getClinical(); assert.equal(capability, await session.getClinical());
  assert.deepEqual(h.clinicalCalls, ['factory']);
  assert.deepEqual(Object.keys(capability).sort(), ['journal', 'repository']);
  assert.deepEqual(Object.keys(capability.repository).sort(), ['commit', 'getAccount', 'getProfile', 'getSession', 'listReceipts', 'listSessions']);
  assert.deepEqual(Object.keys(capability.journal).sort(), ['cancel', 'get', 'listHistoryPage', 'listPreparedPage', 'prepare']);
  assert.equal(Object.isFrozen(capability), true); assert.equal(Object.isFrozen(capability.repository), true); assert.equal(Object.isFrozen(capability.journal), true);
  assert.equal(h.clinicalActive(), true);
  for (const method of CLINICAL_METHODS) {
    const before = h.paths.length;
    await invokeClinical(capability, method, h.api.__input);
    assert.equal(h.paths.length, before + 2, method);
  }
  assert.deepEqual(h.clinicalCalls, ['factory', ...CLINICAL_METHODS]);
  assert.deepEqual(h.contactCalls, []); assert.deepEqual(h.patientCalls, []);
  await session.dispose(); assert.equal(h.clinicalActive(), false);
});

test('all retained clinical and journal methods stay revoked across same-UID relogin or runtime and identity loss', async () => {
  for (const event of ['signOut', 'invalidate', 'replacement', 'hostname', 'emulator', 'dispose', 'observerFailure'] as const) {
    const h = await fixture(), session = await h.api.createFirebaseOperatingAuth(); await session.signIn(EMAIL, PASSWORD);
    const old = await session.getClinical();
    if (event === 'signOut') { await session.signOut(); await session.signIn(EMAIL, PASSWORD); }
    if (event === 'invalidate') session.invalidate();
    if (event === 'replacement') h.replaceIdentity();
    if (event === 'hostname') h.location.hostname = 'outside.example.invalid';
    if (event === 'emulator') h.auth.emulatorConfig = {};
    if (event === 'dispose') await session.dispose();
    if (event === 'observerFailure') h.observerFailure();
    for (const method of CLINICAL_METHODS) await assert.rejects(invokeClinical(old, method, h.api.__input), undefined, `${event}/${method}`);
    assert.equal(h.clinicalActive(), false, event);
    h.location.hostname = '127.0.0.1'; h.auth.emulatorConfig = null;
    await assert.rejects(old.repository.getAccount(RECORD), undefined, 'restored runtime cannot resurrect a generation');
    assert.deepEqual(h.clinicalCalls, ['factory']);
    if (event === 'signOut') { const fresh = await session.getClinical(); assert.notEqual(fresh, old); await fresh.repository.getAccount(RECORD); }
    await session.dispose();
  }
});

test('clinical lazy import closed during loading never creates an adapter or returns a capability', async () => {
  let dispose!: () => Promise<void>, closing: Promise<void> | null = null;
  const h = await fixture({ clinicalImportHook: () => { closing = dispose(); } });
  const session = await h.api.createFirebaseOperatingAuth(); await session.signIn(EMAIL, PASSWORD); dispose = session.dispose;
  await assert.rejects(session.getClinical()); await closing; assert.deepEqual(h.clinicalCalls, []);
});

test('deferred clinical factories reject after logout or same-UID object replacement', async () => {
  for (const event of ['signOut', 'replaceIdentity'] as const) {
    const gate = deferred(), h = await fixture({ clinicalFactoryGate: gate.promise });
    const session = await h.api.createFirebaseOperatingAuth(); await session.signIn(EMAIL, PASSWORD);
    const loading = session.getClinical(), rejected = assert.rejects(loading);
    await until(() => h.clinicalCalls.includes('factory'));
    if (event === 'signOut') await session.signOut(); else h.replaceIdentity();
    assert.equal(h.clinicalActive(), false); gate.resolve(); await rejected;
    assert.deepEqual(h.clinicalCalls, ['factory']); await session.dispose();
  }
});

test('logout during initial clinical or journal authorization prevents every underlying data invocation', async () => {
  for (const method of ['getClinical', ...CLINICAL_METHODS] as const) {
    const gate = deferred(); let enabled = false, reached = false;
    const h = await fixture({ onGetDoc: async () => { if (enabled) { reached = true; await gate.promise; } } });
    const session = await h.api.createFirebaseOperatingAuth(); await session.signIn(EMAIL, PASSWORD);
    const capability = method === 'getClinical' ? null : await session.getClinical(); enabled = true;
    const pending = method === 'getClinical' ? session.getClinical() : invokeClinical(capability!, method, h.api.__input);
    const rejected = assert.rejects(pending); await until(() => reached);
    const stopping = session.signOut(); gate.resolve(); await rejected; await stopping;
    assert.deepEqual(h.clinicalCalls, method === 'getClinical' ? [] : ['factory'], method);
    await session.dispose();
  }
});

test('server-accepted clinical or recovery work may finish after logout but cannot publish its late result', async () => {
  for (const method of CLINICAL_METHODS) {
    const gate = deferred(), h = await fixture({ clinicalMethodGate: gate.promise });
    const session = await h.api.createFirebaseOperatingAuth(); await session.signIn(EMAIL, PASSWORD);
    const capability = await session.getClinical(), pending = invokeClinical(capability, method, h.api.__input);
    const rejected = assert.rejects(pending); await until(() => h.clinicalCalls.includes(method));
    await session.signOut(); gate.resolve(); await rejected;
    assert.deepEqual(h.clinicalCalls, ['factory', method]); assert.equal(h.clinicalActive(), false);
    await session.dispose();
  }
});

test('clinical results require a fresh server membership check after the underlying method returns', async () => {
  const membership: Record<string, unknown> = { schemaVersion: 1, clinicId: 'main', uid: UID, role: 'owner', status: 'active',
    identityVersion: 1, verifiedAfter: AUTH_TIME };
  const gate = deferred(), h = await fixture({ membership, clinicalMethodGate: gate.promise });
  const session = await h.api.createFirebaseOperatingAuth(); await session.signIn(EMAIL, PASSWORD);
  const capability = await session.getClinical(), pending = capability.repository.getAccount(RECORD), rejected = assert.rejects(pending);
  await until(() => h.clinicalCalls.includes('getAccount')); membership.status = 'disabled'; gate.resolve(); await rejected;
  assert.equal(session.getState().owner, null); assert.equal(h.clinicalActive(), false); await session.dispose();
});

test('clinical commands, page queries and journal preparation/page arguments snapshot before delayed authorization', async () => {
  for (const method of ['commit', 'listSessions', 'listReceipts', 'prepare', 'listPreparedPage', 'listHistoryPage'] as const) {
    const gate = deferred(); let enabled = false, reached = false;
    const h = await fixture({ onGetDoc: async () => { if (enabled) { reached = true; await gate.promise; } } });
    const session = await h.api.createFirebaseOperatingAuth(); await session.signIn(EMAIL, PASSWORD);
    const cap = await session.getClinical(); enabled = true;
    const command = h.api.__input(rawClinicalCommand()), page = h.api.__input({ patientId: RECORD, afterId: INSTANCE, limit: 2 });
    const intentPage = h.api.__input({ afterId: INSTANCE, limit: 2 });
    const pending = method === 'commit' ? cap.repository.commit(command) : method === 'prepare' ? cap.journal.prepare('clinical', command, CREATED_AT)
      : method === 'listPreparedPage' ? cap.journal.listPreparedPage('clinical', intentPage)
        : method === 'listHistoryPage' ? cap.journal.listHistoryPage!('clinical', intentPage) : cap.repository[method](page);
    await until(() => reached);
    command.operationId = RECORD; if (command.action === 'visit') { command.data.notes = 'Changed'; command.data.services[0].priceCents = 1; }
    page.patientId = INSTANCE; page.limit = 50; intentPage.limit = 50; intentPage.afterId = RECORD;
    gate.resolve(); await pending;
    const received = h.clinicalInputs[0] as any;
    if (method === 'commit' || method === 'prepare') {
      const value = method === 'prepare' ? received.command : received;
      assert.equal(value.operationId, INSTANCE); assert.equal(value.data.notes, ''); assert.equal(value.data.services[0].priceCents, 20000);
      if (method === 'prepare') { assert.equal(received.kind, 'clinical'); assert.equal(received.createdAt, CREATED_AT); }
    } else {
      const value = method === 'listPreparedPage' || method === 'listHistoryPage' ? received.input : received;
      assert.equal(value.limit, 2); assert.equal(value.afterId, INSTANCE);
      if (method !== 'listPreparedPage' && method !== 'listHistoryPage') assert.equal(value.patientId, RECORD);
    }
    await session.dispose();
  }
});

test('malformed clinical or journal inputs and nonclinical kinds fail asynchronously before authorization or data calls', async () => {
  const h = await fixture(), session = await h.api.createFirebaseOperatingAuth(); await session.signIn(EMAIL, PASSWORD);
  const cap = await session.getClinical(), before = h.paths.length;
  const malicious = new Proxy({}, { ownKeys() { throw new Error(PASSWORD); } });
  for (const value of [{}, malicious]) {
    for (const work of [() => cap.repository.commit(value as never), () => cap.repository.listSessions(value as never),
      () => cap.repository.listReceipts(value as never), () => cap.journal.prepare('clinical', value, CREATED_AT)]) {
      let pending!: Promise<unknown>; assert.doesNotThrow(() => { pending = work(); });
      await assert.rejects(pending, error => !String(error).includes(PASSWORD));
    }
  }
  for (const value of [h.api.__input({ limit: 0 }), malicious]) await assert.rejects(cap.journal.listPreparedPage('clinical', value), error => !String(error).includes(PASSWORD));
  for (const value of [h.api.__input({ limit: 0 }), malicious]) await assert.rejects(cap.journal.listHistoryPage!('clinical', value), error => !String(error).includes(PASSWORD));
  for (const id of ['', `${RECORD}\n`, Object.assign({}, { toString: () => { throw new Error(PASSWORD); } })]) {
    for (const work of [() => cap.repository.getProfile(id as never), () => cap.repository.getAccount(id as never), () => cap.repository.getSession(id as never),
      () => cap.journal.get(id as never), () => cap.journal.cancel(id as never)]) await assert.rejects(work(), error => !String(error).includes(PASSWORD));
  }
  for (const kind of ['contact', 'patient-profile'] as const) {
    await assert.rejects(cap.journal.prepare(kind, h.api.__input(rawClinicalCommand()), CREATED_AT));
    await assert.rejects(cap.journal.listPreparedPage(kind));
    await assert.rejects(cap.journal.listHistoryPage!(kind));
  }
  await assert.rejects(cap.journal.prepare('clinical', h.api.__input(rawClinicalCommand()), '2026-10-11T10:00:00.000Z'));
  assert.equal(h.paths.length, before); assert.deepEqual(h.clinicalCalls, ['factory']); await session.dispose();
});

test('clinical and journal provider and hostile Proxy failures stay fixed and never leak account payloads', async () => {
  for (const clinicalFailure of [new Error(PASSWORD), new Proxy({}, { getPrototypeOf() { throw new Error(PASSWORD); } })]) {
    const h = await fixture({ clinicalFailure }), session = await h.api.createFirebaseOperatingAuth(); await session.signIn(EMAIL, PASSWORD);
    const cap = await session.getClinical();
    for (const method of CLINICAL_METHODS) await assert.rejects(invokeClinical(cap, method, h.api.__input), error => {
      assert.equal(String(error).includes(PASSWORD), false); assert.equal(h.api.cloudOperatingAuthErrorMessage(error).includes(PASSWORD), false); return true;
    });
    await session.dispose();
  }
});

test('clinical journal rejects another domain or another actor returned by its adapter', async () => {
  for (const options of [{ clinicalIntentKind: 'contact' as const }, { clinicalIntentActor: 'different-synthetic-owner' }]) {
    const h = await fixture(options), session = await h.api.createFirebaseOperatingAuth(); await session.signIn(EMAIL, PASSWORD);
    const cap = await session.getClinical();
    for (const method of ['prepare', 'intentGet', 'listPreparedPage', 'listHistoryPage', 'cancel'] as const) await assert.rejects(invokeClinical(cap, method, h.api.__input));
    await session.dispose();
  }
});

type CatalogTestMethod = 'get' | 'commit' | 'prepare' | 'intentGet' | 'listPreparedPage' | 'listHistoryPage' | 'cancel';
const CATALOG_METHODS: readonly CatalogTestMethod[] = ['get', 'commit', 'prepare', 'intentGet', 'listPreparedPage', 'listHistoryPage', 'cancel'];
function invokeCatalog(cap: CloudServiceCatalogCapability, method: CatalogTestMethod, copy: <T>(value: T) => T): Promise<unknown> {
  switch (method) {
    case 'get': return cap.repository.get();
    case 'commit': return cap.repository.commit(copy(rawCatalogCommand()));
    case 'prepare': return cap.journal.prepare('catalog', copy(rawCatalogCommand()), CREATED_AT);
    case 'intentGet': return cap.journal.get(INSTANCE);
    case 'listPreparedPage': return cap.journal.listPreparedPage('catalog', copy({ limit: 2 }));
    case 'listHistoryPage': return cap.journal.listHistoryPage!('catalog', copy({ limit: 2 }));
    case 'cancel': return cap.journal.cancel(INSTANCE);
  }
}

test('catalog capability is explicit lazy and frozen, missing catalog stays unknown, each action reauthorizes before and after', async () => {
  const h = await fixture(), session = await h.api.createFirebaseOperatingAuth();
  await assert.rejects(session.getServiceCatalog()); assert.equal(h.imports.includes('./firebaseCloudServiceCatalog'), false);
  await session.signIn(EMAIL, PASSWORD); assert.deepEqual(h.catalogCalls, []);
  const cap = await session.getServiceCatalog(); assert.equal(cap, await session.getServiceCatalog());
  assert.equal(Object.isFrozen(cap), true); assert.equal(Object.isFrozen(cap.repository), true); assert.equal(Object.isFrozen(cap.journal), true);
  assert.deepEqual(Object.keys(cap.repository).sort(), ['commit', 'get']);
  for (const method of CATALOG_METHODS) {
    const before = h.paths.length, result = await invokeCatalog(cap, method, h.api.__input);
    if (method === 'get') assert.equal(result, null);
    assert.equal(h.paths.length - before, 2, method);
  }
  assert.deepEqual(h.catalogCalls, ['factory', ...CATALOG_METHODS]); await session.dispose();
});

test('retained catalog actions never revive after logout/relogin, same-UID object replacement or runtime/emulator loss', async () => {
  for (const event of ['logout', 'invalidate', 'dispose', 'replace', 'host', 'emulator'] as const) {
    const h = await fixture(), session = await h.api.createFirebaseOperatingAuth(); await session.signIn(EMAIL, PASSWORD);
    const cap = await session.getServiceCatalog();
    if (event === 'logout') { await session.signOut(); await session.signIn(EMAIL, PASSWORD); }
    else if (event === 'invalidate') session.invalidate();
    else if (event === 'dispose') await session.dispose();
    else if (event === 'replace') h.replaceIdentity();
    else if (event === 'host') h.location.hostname = 'outside.invalid';
    else h.auth.emulatorConfig = {};
    const before = h.catalogCalls.length;
    for (const method of CATALOG_METHODS) await assert.rejects(invokeCatalog(cap, method, h.api.__input));
    assert.equal(h.catalogActive(), false); assert.equal(h.catalogCalls.length, before);
    if (event === 'host') h.location.hostname = '127.0.0.1';
    if (event === 'emulator') h.auth.emulatorConfig = null;
    await assert.rejects(cap.repository.get()); await session.dispose();
  }
});

test('catalog import or factory cancelled during loading never returns a usable late capability', async () => {
  for (const at of ['import', 'factory']) {
    const gate = deferred(); let session!: CloudOperatingFirebaseSession;
    const h = await fixture(at === 'import' ? { catalogImportHook: () => { void session.signOut(); } } : { catalogFactoryGate: gate.promise });
    session = await h.api.createFirebaseOperatingAuth(); await session.signIn(EMAIL, PASSWORD);
    const pending = session.getServiceCatalog(), rejected = assert.rejects(pending);
    if (at === 'factory') { await until(() => h.catalogCalls.includes('factory')); await session.signOut(); gate.resolve(); }
    await rejected; assert.equal(h.catalogActive(), false); await session.dispose();
  }
});

test('catalog owner loss during authorization prevents invocation while accepted work is masked after logout', async () => {
  for (const method of CATALOG_METHODS) {
    const gate = deferred(); let enabled = false, reached = false;
    const h = await fixture({ onGetDoc: async () => { if (enabled) { reached = true; await gate.promise; } } });
    const session = await h.api.createFirebaseOperatingAuth(); await session.signIn(EMAIL, PASSWORD);
    const cap = await session.getServiceCatalog(); enabled = true;
    const pending = invokeCatalog(cap, method, h.api.__input), rejected = assert.rejects(pending);
    await until(() => reached); const logout = session.signOut(); gate.resolve(); await rejected; await logout;
    assert.deepEqual(h.catalogCalls, ['factory']); await session.dispose();
    const acceptedGate = deferred(), accepted = await fixture({ catalogMethodGate: acceptedGate.promise });
    const live = await accepted.api.createFirebaseOperatingAuth(); await live.signIn(EMAIL, PASSWORD);
    const bound = await live.getServiceCatalog(), doing = invokeCatalog(bound, method, accepted.api.__input), refused = assert.rejects(doing);
    await until(() => accepted.catalogCalls.includes(method)); await live.signOut(); acceptedGate.resolve(); await refused;
    assert.equal(accepted.catalogActive(), false); await live.dispose();
  }
});

test('catalog commands and query bounds snapshot before delayed server authorization', async () => {
  for (const method of ['commit', 'prepare', 'listPreparedPage', 'listHistoryPage'] as const) {
    const gate = deferred(); let enabled = false, reached = false;
    const h = await fixture({ onGetDoc: async () => { if (enabled) { reached = true; await gate.promise; } } });
    const session = await h.api.createFirebaseOperatingAuth(); await session.signIn(EMAIL, PASSWORD);
    const cap = await session.getServiceCatalog(), input = h.api.__input(rawCatalogCommand()), bounds = h.api.__input({ afterId: RECORD, limit: 2 }); enabled = true;
    const pending = method === 'commit' ? cap.repository.commit(input) : method === 'prepare' ? cap.journal.prepare('catalog', input, CREATED_AT)
      : cap.journal[method]!('catalog', bounds);
    await until(() => reached); input.data.examinationCents = 1; input.data.services[0].priceCents = 1; bounds.limit = 50; bounds.afterId = INSTANCE;
    gate.resolve(); await pending;
    const received = h.catalogInputs[0] as any;
    if (method === 'commit' || method === 'prepare') { const value = method === 'prepare' ? received.command : received; assert.equal(value.data.examinationCents, 10000); assert.equal(value.data.services[0].priceCents, 20000); }
    else { assert.equal(received.input.limit, 2); assert.equal(received.input.afterId, RECORD); }
    await session.dispose();
  }
});

test('catalog malformed commands, foreign kinds, timestamps, IDs and bounds fail before authorization/data calls', async () => {
  const h = await fixture(), session = await h.api.createFirebaseOperatingAuth(); await session.signIn(EMAIL, PASSWORD);
  const cap = await session.getServiceCatalog(), before = h.paths.length;
  const malicious = new Proxy({}, { ownKeys() { throw new Error(PASSWORD); } });
  for (const input of [{}, malicious]) {
    await assert.rejects(cap.repository.commit(input as never), error => !String(error).includes(PASSWORD));
    await assert.rejects(cap.journal.prepare('catalog', input, CREATED_AT), error => !String(error).includes(PASSWORD));
  }
  for (const kind of ['clinical', 'contact', 'patient-profile'] as const) {
    await assert.rejects(cap.journal.prepare(kind, h.api.__input(rawCatalogCommand()), CREATED_AT));
    await assert.rejects(cap.journal.listPreparedPage(kind)); await assert.rejects(cap.journal.listHistoryPage!(kind));
  }
  for (const method of ['listPreparedPage', 'listHistoryPage'] as const) {
    for (const input of [h.api.__input({ limit: 0 }), h.api.__input({ limit: 51 }), malicious]) await assert.rejects(cap.journal[method]!('catalog', input), error => !String(error).includes(PASSWORD));
  }
  for (const id of ['', `${INSTANCE}\n`]) { await assert.rejects(cap.journal.get(id)); await assert.rejects(cap.journal.cancel(id)); }
  await assert.rejects(cap.journal.prepare('catalog', h.api.__input(rawCatalogCommand()), CREATED_AT.replace('10:00:', '11:00:')));
  assert.equal(h.paths.length, before); assert.deepEqual(h.catalogCalls, ['factory']); await session.dispose();
});

test('catalog adapter failures, foreign returned intents and malformed singleton records expose no private errors or defaults', async () => {
  for (const options of [{ catalogFailure: new Error(PASSWORD) }, { catalogFailure: new Proxy({}, { getPrototypeOf() { throw new Error(PASSWORD); } }) }]) {
    const h = await fixture(options), session = await h.api.createFirebaseOperatingAuth(); await session.signIn(EMAIL, PASSWORD);
    const cap = await session.getServiceCatalog();
    for (const method of CATALOG_METHODS) await assert.rejects(invokeCatalog(cap, method, h.api.__input), error => !String(error).includes(PASSWORD));
    await session.dispose();
  }
  for (const options of [{ catalogIntentKind: 'clinical' as const }, { catalogIntentActor: 'another-owner' }]) {
    const h = await fixture(options), session = await h.api.createFirebaseOperatingAuth(); await session.signIn(EMAIL, PASSWORD);
    const cap = await session.getServiceCatalog();
    for (const method of ['prepare', 'intentGet', 'listPreparedPage', 'listHistoryPage', 'cancel'] as const) await assert.rejects(invokeCatalog(cap, method, h.api.__input));
    await session.dispose();
  }
  const h = await fixture({ catalogRecord: { examinationCents: 0 } }), session = await h.api.createFirebaseOperatingAuth();
  await session.signIn(EMAIL, PASSWORD); await assert.rejects((await session.getServiceCatalog()).repository.get()); await session.dispose();
});
