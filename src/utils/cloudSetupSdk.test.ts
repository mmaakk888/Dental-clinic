import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import type { CloudSetupSession } from './cloudAuthSetup';

const PROJECT_ID = 'dental-clinic-mmaakk888';
const SYNTHETIC_UID = 'synthetic-owner-uid';
const SYNTHETIC_EMAIL = 'owner@example.invalid';
const SYNTHETIC_PASSWORD = 'synthetic-password-only';
const AUTH_TIME = 1_700_000_000;

type SetupExports = {
  createCloudAuthSetupService(): Promise<CloudSetupSession>;
  cloudSetupErrorMessage(error: unknown): string;
  cloudSetupNeedsSignIn(error: unknown): boolean;
  __copySyntheticRecord(value: object): object;
};

const bundledService = build({
  entryPoints: ['src/utils/cloudAuthSetup.ts'], bundle: true, write: false,
  metafile: true, platform: 'node', format: 'cjs', logLevel: 'silent', external: ['firebase/*'],
  supported: { 'dynamic-import': false },
});

function syntheticMembership() {
  return {
    schemaVersion: 1, clinicId: 'main', uid: SYNTHETIC_UID, role: 'owner', status: 'active',
    identityVersion: 1, verifiedAfter: AUTH_TIME,
  };
}

async function harness(options: {
  emailVerified?: boolean;
  tokenEmailVerified?: boolean;
  membership?: unknown;
  exists?: boolean;
  getDocError?: unknown;
  authTime?: unknown;
  changeUidDuringRead?: boolean;
  hostname?: string;
} = {}) {
  const bundle = await bundledService;
  const imports: string[] = [];
  const calls: string[] = [];
  const tokenForces: boolean[] = [];
  const paths: string[][] = [];
  const names: string[] = [];
  const user = { uid: SYNTHETIC_UID, email: SYNTHETIC_EMAIL, emailVerified: options.emailVerified ?? true };
  const auth = { currentUser: null as typeof user | null, languageCode: '', emulatorConfig: null };
  const memoryPersistence = { type: 'synthetic-memory-only' };
  const app = { name: '' };
  const database = { marker: 'synthetic-default-database' };
  const document = { marker: 'synthetic-single-member-reference' };
  const module = { exports: {} as SetupExports };
  let tokenEmailVerified = options.tokenEmailVerified ?? options.emailVerified ?? true;
  const context = {
    module,
    exports: module.exports,
    window: {
      location: { hostname: options.hostname ?? '127.0.0.1' },
      get localStorage() { throw new Error('Local clinic storage must not be accessed.'); },
      get sessionStorage() { throw new Error('Browser sessions must not be accessed.'); },
    },
    crypto: { randomUUID: () => 'synthetic-setup-instance' },
    fetch: () => { throw new Error('No real network requests are permitted.'); },
    require: (name: string) => {
      imports.push(name);
      if (name === 'firebase/app') return {
        initializeApp: (config: { projectId: string; authDomain: string }, appName: string) => {
          calls.push('initializeApp');
          assert.equal(config.projectId, PROJECT_ID);
          assert.equal(config.authDomain, `${PROJECT_ID}.firebaseapp.com`);
          assert.equal(appName, 'clinic-owner-setup-synthetic-setup-instance');
          assert.notEqual(appName, '[DEFAULT]');
          names.push(appName);
          app.name = appName;
          return app;
        },
        getApps: () => { throw new Error('The old/default apps must not be enumerated.'); },
        getApp: () => { throw new Error('The old/default app must not be read.'); },
        deleteApp: async (target: unknown) => {
          assert.equal(target, app);
          calls.push('deleteApp');
        },
      };
      if (name === 'firebase/auth') return {
        inMemoryPersistence: memoryPersistence,
        initializeAuth: (target: unknown, settings: { persistence: unknown }) => {
          assert.equal(target, app);
          assert.equal(settings.persistence, memoryPersistence);
          calls.push('initializeAuth:memory');
          return auth;
        },
        signInWithEmailAndPassword: async (target: unknown, email: string, password: string) => {
          assert.equal(target, auth);
          assert.equal(email, SYNTHETIC_EMAIL);
          assert.equal(password, SYNTHETIC_PASSWORD);
          calls.push('signIn');
          auth.currentUser = user;
        },
        reload: async (target: unknown) => {
          assert.equal(target, auth.currentUser);
          calls.push('reload');
        },
        getIdTokenResult: async (target: unknown, forceRefresh: boolean) => {
          assert.equal(target, auth.currentUser);
          calls.push('token:force');
          tokenForces.push(forceRefresh);
          return {
            signInProvider: 'password',
            claims: {
              sub: SYNTHETIC_UID, aud: PROJECT_ID, iss: `https://securetoken.google.com/${PROJECT_ID}`,
              email: SYNTHETIC_EMAIL, email_verified: tokenEmailVerified,
              dentalClinicId: 'main', dentalClinicRole: 'owner',
              auth_time: 'authTime' in options ? options.authTime : AUTH_TIME,
            },
          };
        },
        sendEmailVerification: async (target: unknown) => {
          assert.equal(target, auth.currentUser);
          calls.push('sendEmailVerification');
        },
        signOut: async (target: unknown) => {
          assert.equal(target, auth);
          calls.push('signOut');
          auth.currentUser = null;
        },
      };
      if (name === 'firebase/firestore/lite') return {
        getFirestore: (target: unknown, databaseName: string) => {
          assert.equal(target, app);
          assert.equal(databaseName, '(default)');
          calls.push('getFirestore:setup:default');
          return database;
        },
        doc: (target: unknown, ...path: string[]) => {
          assert.equal(target, database);
          assert.deepEqual(path, ['clinics', 'main', 'members', SYNTHETIC_UID]);
          paths.push(path);
          calls.push('doc:owner-member');
          return document;
        },
        getDoc: async (target: unknown) => {
          assert.equal(target, document);
          calls.push('getDoc:owner-member');
          if (options.changeUidDuringRead) auth.currentUser = { ...user, uid: 'different-synthetic-owner' };
          if (options.getDocError) throw options.getDocError;
          return {
            exists: () => options.exists ?? true,
            data: () => {
              calls.push('snapshot:data');
              const membership = 'membership' in options ? options.membership : syntheticMembership();
              return membership && typeof membership === 'object'
                ? module.exports.__copySyntheticRecord(membership) : membership;
            },
          };
        },
      };
      throw new Error(`Unexpected dependency in synthetic SDK test: ${name}`);
    },
  };
  // The synthetic record must share the VM realm's plain Object prototype.
  // This test-only helper is appended in memory; no generated file is written.
  runInNewContext(`${bundle.outputFiles[0].text}\nmodule.exports.__copySyntheticRecord = value => ({ ...value });`, context);
  return {
    api: module.exports,
    imports, calls, tokenForces, paths, names, auth,
    confirmEmail: () => { user.emailVerified = true; tokenEmailVerified = true; },
  };
}

async function assertMembershipFailure(
  setup: Awaited<ReturnType<typeof harness>>,
  service: CloudSetupSession,
) {
  await assert.rejects(service.checkMembership(), error => {
    assert.equal(setup.api.cloudSetupNeedsSignIn(error), true);
    assert.equal(setup.api.cloudSetupErrorMessage(error), 'تعذر تأكيد عضوية المالك. سجّل الدخول من جديد ثم أعد فحص الربط.');
    assert.equal(setup.api.cloudSetupErrorMessage(error).includes(SYNTHETIC_UID), false);
    return true;
  });
  assert.equal(setup.auth.currentUser, null);
  assert.equal(setup.calls.at(-1), 'signOut');
}

test('actual SDK service graph excludes clinical code, old backup configuration and full Firestore', async () => {
  const bundle = await bundledService;
  const inputs = Object.keys(bundle.metafile!.inputs);
  assert.ok(inputs.includes('src/utils/cloudMembership.ts'));
  assert.ok(inputs.includes('firebase.cloud-config.json'));
  assert.doesNotMatch(inputs.join('\n'), /src\/App\.tsx|storage\.ts|firebaseService|offlineSync|aiService|firebase-applet-config/iu);
  const dependencies = Object.values(bundle.metafile!.outputs).flatMap(output => output.imports.map(item => item.path));
  assert.deepEqual([...new Set(dependencies)].sort(), ['firebase/app', 'firebase/auth', 'firebase/firestore/lite']);
});

test('creation, sign-in, refresh, explicit email and sign-out never import or read Firestore', async () => {
  const setup = await harness({ emailVerified: false });
  assert.deepEqual(setup.imports, []);
  const service = await setup.api.createCloudAuthSetupService();
  assert.deepEqual(setup.imports.sort(), ['firebase/app', 'firebase/auth']);
  assert.equal(setup.auth.languageCode, 'ar');
  assert.equal((await service.signIn(SYNTHETIC_EMAIL, SYNTHETIC_PASSWORD)).status, 'verification-required');
  await service.refresh();
  await service.sendVerification();
  setup.confirmEmail();
  assert.equal((await service.refresh()).status, 'owner-confirmed');
  await service.signOut();
  assert.equal(setup.calls.filter(call => call === 'sendEmailVerification').length, 1);
  assert.equal(setup.tokenForces.every(force => force === true), true);
  assert.equal(setup.imports.includes('firebase/firestore/lite'), false);
  assert.deepEqual(setup.paths, []);
  await service.dispose();
  assert.deepEqual(setup.calls.slice(-2), ['signOut', 'deleteApp']);
  assert.equal(setup.calls.filter(call => call === 'deleteApp').length, 1);
});

test('explicit membership check refreshes identity then reads only the named app default member document', async () => {
  const setup = await harness();
  const service = await setup.api.createCloudAuthSetupService();
  await service.signIn(SYNTHETIC_EMAIL, SYNTHETIC_PASSWORD);
  const before = setup.calls.length;
  const result = await service.checkMembership();
  assert.equal(result.status, 'membership-confirmed');
  assert.equal(result.identityVersion, 1);
  assert.equal(result.verifiedAfter, AUTH_TIME);
  assert.deepEqual(Object.keys(result).sort(), ['identityVersion', 'status', 'verifiedAfter']);
  assert.deepEqual(setup.calls.slice(before), [
    'reload', 'token:force', 'getFirestore:setup:default', 'doc:owner-member', 'getDoc:owner-member', 'snapshot:data',
  ]);
  assert.deepEqual(setup.paths, [['clinics', 'main', 'members', SYNTHETIC_UID]]);
  assert.equal(setup.names.length, 1);
  assert.equal(setup.tokenForces.every(force => force === true), true);
  await service.dispose();
  assert.deepEqual(setup.calls.slice(-2), ['signOut', 'deleteApp']);
});

test('membership requires both SDK and fresh-token email verification before importing Lite', async () => {
  for (const options of [{ emailVerified: false }, { tokenEmailVerified: false }]) {
    const setup = await harness(options);
    const service = await setup.api.createCloudAuthSetupService();
    await service.signIn(SYNTHETIC_EMAIL, SYNTHETIC_PASSWORD);
    await assertMembershipFailure(setup, service);
    assert.equal(setup.imports.includes('firebase/firestore/lite'), false);
    assert.deepEqual(setup.paths, []);
    await service.dispose();
  }
});

test('membership refuses malformed original auth_time before importing Lite', async () => {
  for (const authTime of [undefined, null, '1700000000', -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const setup = await harness({ authTime });
    const service = await setup.api.createCloudAuthSetupService();
    await service.signIn(SYNTHETIC_EMAIL, SYNTHETIC_PASSWORD);
    await assertMembershipFailure(setup, service);
    assert.equal(setup.imports.includes('firebase/firestore/lite'), false);
    await service.dispose();
  }
});

test('invalid canonical metadata and missing member documents sign out with the sanitized error', async () => {
  for (const options of [
    { exists: false },
    { membership: undefined },
    { membership: { ...syntheticMembership(), status: 'disabled' } },
    { membership: { ...syntheticMembership(), uid: 'different-synthetic-owner' } },
    { membership: { ...syntheticMembership(), permissions: 'all' } },
    { membership: { ...syntheticMembership(), verifiedAfter: AUTH_TIME + 1 } },
  ]) {
    const setup = await harness(options);
    const service = await setup.api.createCloudAuthSetupService();
    await service.signIn(SYNTHETIC_EMAIL, SYNTHETIC_PASSWORD);
    await assertMembershipFailure(setup, service);
    assert.deepEqual(setup.paths, [['clinics', 'main', 'members', SYNTHETIC_UID]]);
    if (options.exists === false) assert.equal(setup.calls.includes('snapshot:data'), false);
    await service.dispose();
  }
});

test('raw Firestore errors cannot expose service details and cause diagnostic sign-out', async () => {
  const setup = await harness({ getDocError: { code: 'permission-denied', message: 'private synthetic provider details', token: 'synthetic-token' } });
  const service = await setup.api.createCloudAuthSetupService();
  await service.signIn(SYNTHETIC_EMAIL, SYNTHETIC_PASSWORD);
  await assertMembershipFailure(setup, service);
  assert.equal(setup.calls.includes('snapshot:data'), false);
  await service.dispose();
});

test('UID replacement during the document request rejects the result before reading its data', async () => {
  const setup = await harness({ changeUidDuringRead: true });
  const service = await setup.api.createCloudAuthSetupService();
  await service.signIn(SYNTHETIC_EMAIL, SYNTHETIC_PASSWORD);
  await assertMembershipFailure(setup, service);
  assert.equal(setup.calls.includes('snapshot:data'), false);
  await service.dispose();
});

test('a non-loopback host is refused before any Firebase SDK import', async () => {
  const setup = await harness({ hostname: 'preview.example.invalid' });
  await assert.rejects(setup.api.createCloudAuthSetupService(), error => {
    assert.equal(setup.api.cloudSetupErrorMessage(error), 'التجهيز متاح على نفس اللاب فقط.');
    return true;
  });
  assert.deepEqual(setup.imports, []);
  assert.deepEqual(setup.calls, []);
});
