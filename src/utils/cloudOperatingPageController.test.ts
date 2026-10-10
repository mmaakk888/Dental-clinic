import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createCloudOperatingAuthSession, type CloudOperatingAuthAdapter,
  type CloudOperatingAuthSession } from './cloudOperatingAuth';
import { createCloudOperatingPageController, type CloudOperatingPageState } from './cloudOperatingPageController';

const EMAIL = 'owner@example.invalid';
const PASSWORD = 'synthetic-password-only';
const AUTH_TIME = 1_700_000_000;

function record(): Awaited<ReturnType<CloudOperatingAuthAdapter['readOwner']>> {
  return { identity: { uid: 'synthetic-owner', email: EMAIL, status: 'owner-confirmed' },
    membership: { schemaVersion: 1, clinicId: 'main', uid: 'synthetic-owner', role: 'owner',
      status: 'active', identityVersion: 1, verifiedAfter: AUTH_TIME }, authTime: AUTH_TIME };
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

function fixture(options: {
  adapter?: Partial<CloudOperatingAuthAdapter>;
  factory?: (session: CloudOperatingAuthSession) => Promise<CloudOperatingAuthSession>;
  runtime?: () => boolean;
} = {}) {
  const calls: string[] = [];
  const credentials: [string, string][] = [];
  let runtime = true;
  const session = createCloudOperatingAuthSession({
    signIn: async (email, password) => {
      calls.push('signIn'); credentials.push([email, password]); await options.adapter?.signIn?.(email, password);
    },
    readOwner: async () => { calls.push('readOwner'); return options.adapter?.readOwner ? options.adapter.readOwner() : record(); },
    signOut: async () => { calls.push('signOut'); await options.adapter?.signOut?.(); },
    destroy: async () => { calls.push('destroy'); await options.adapter?.destroy?.(); },
  });
  const controller = createCloudOperatingPageController(async () => {
    calls.push('factory'); return options.factory ? options.factory(session) : session;
  }, options.runtime ?? (() => runtime));
  return { controller, session, calls, credentials, setRuntime: (value: boolean) => { runtime = value; } };
}

test('page controller is inert until explicit sign-in, and initial refresh never initializes Auth', async () => {
  const h = fixture();
  assert.deepEqual(h.controller.getState(), { auth: { phase: 'signed-out', owner: null },
    pending: false, closing: false, error: '', cleanupFailed: false });
  assert.equal(Object.isFrozen(h.controller.getState()), true);
  assert.equal(Object.isFrozen(h.controller.getState().auth), true);
  await h.controller.refresh();
  assert.match(h.controller.getState().error, /سجّل الدخول أولًا/u);
  assert.deepEqual(h.calls, []);
  assert.equal(await h.controller.signOut(), true);
  assert.deepEqual(h.calls, []);
  await h.controller.dispose();
});

test('explicit sign-in exposes only checked metadata and refresh repeats authorization without another factory', async () => {
  const h = fixture();
  const states: CloudOperatingPageState[] = [];
  h.controller.subscribe(value => states.push(value));
  await h.controller.signIn(EMAIL, PASSWORD);
  assert.deepEqual(h.calls, ['factory', 'signIn', 'readOwner']);
  assert.equal(h.controller.getState().auth.phase, 'owner-checked');
  assert.equal(h.controller.getState().auth.owner?.email, EMAIL);
  assert.equal(h.controller.getState().pending, false);
  assert.equal(h.controller.getState().error, '');
  assert.equal(states.some(value => value.pending), true);
  assert.equal(states.every(Object.isFrozen), true);
  assert.equal(JSON.stringify(states).includes(PASSWORD), false);
  await h.controller.refresh();
  assert.deepEqual(h.calls, ['factory', 'signIn', 'readOwner', 'readOwner']);
  assert.equal(h.controller.getState().pending, false);
  await h.controller.dispose();
});

test('duplicate sign-in/refresh during delayed factory are ignored without a second SDK request', async () => {
  const gate = deferred<CloudOperatingAuthSession>();
  const started = deferred();
  const h = fixture({ factory: async () => { started.resolve(); return gate.promise; } });
  const login = h.controller.signIn(EMAIL, PASSWORD);
  await started.promise;
  await h.controller.signIn('different@example.invalid', PASSWORD);
  await h.controller.refresh();
  assert.deepEqual(h.calls, ['factory']);
  gate.resolve(h.session); await login;
  assert.deepEqual(h.credentials, [[EMAIL, PASSWORD]]);
  await h.controller.dispose();
});

test('sign-out supersedes delayed factory and never passes credentials to its abandoned session', async () => {
  const gate = deferred<CloudOperatingAuthSession>();
  const started = deferred();
  const h = fixture({ factory: async () => { started.resolve(); return gate.promise; } });
  const login = h.controller.signIn(EMAIL, PASSWORD);
  await started.promise;
  let finished = false;
  const logout = h.controller.signOut().then(value => { finished = true; return value; });
  assert.equal(h.controller.getState().auth.owner, null);
  assert.equal(h.controller.getState().closing, true);
  assert.equal(h.controller.getState().pending, false);
  await Promise.resolve(); assert.equal(finished, false);
  await h.controller.signIn(EMAIL, PASSWORD);
  gate.resolve(h.session);
  await login; assert.equal(await logout, true);
  assert.deepEqual(h.calls, ['factory', 'signOut', 'destroy']);
  assert.deepEqual(h.credentials, []);
  assert.equal(h.controller.getState().auth.phase, 'signed-out');
  assert.equal(h.controller.getState().closing, false);
});

test('immediate sign-out before the factory microtask prevents even SDK initialization', async () => {
  const h = fixture();
  const login = h.controller.signIn(EMAIL, PASSWORD);
  assert.equal(await h.controller.signOut(), true);
  await login;
  assert.deepEqual(h.calls, []);
});

test('sign-out while Auth request is pending clears owner immediately and waits for confirmed cleanup', async () => {
  const gate = deferred();
  const started = deferred();
  const h = fixture({ adapter: { signIn: async () => { started.resolve(); await gate.promise; } } });
  const login = h.controller.signIn(EMAIL, PASSWORD);
  await started.promise;
  const logout = h.controller.signOut();
  assert.equal(h.controller.getState().auth.owner, null);
  assert.equal(h.controller.getState().closing, true);
  assert.equal(h.controller.signOut(), logout);
  gate.resolve(); await login;
  assert.equal(await logout, true);
  assert.equal(h.calls.includes('readOwner'), false);
  assert.equal(h.calls.at(-1), 'destroy');
  assert.equal(h.controller.getState().error, '');
});

test('dispose owns a delayed factory result but never authenticates or publishes after closing', async () => {
  const gate = deferred<CloudOperatingAuthSession>();
  const started = deferred();
  const h = fixture({ factory: async () => { started.resolve(); return gate.promise; } });
  const states: CloudOperatingPageState[] = [];
  h.controller.subscribe(value => states.push(value));
  const login = h.controller.signIn(EMAIL, PASSWORD);
  await started.promise;
  const closing = h.controller.dispose();
  assert.equal(h.controller.dispose(), closing);
  const count = states.length;
  assert.equal(h.controller.getState().auth.phase, 'closed');
  gate.resolve(h.session); await login; await closing;
  assert.equal(states.length, count);
  assert.deepEqual(h.calls, ['factory', 'signOut', 'destroy']);
  assert.equal(h.controller.getState().closing, false);
  assert.equal(await h.controller.signOut(), false);
  await h.controller.signIn(EMAIL, PASSWORD); await h.controller.refresh();
  assert.deepEqual(h.credentials, []);
});

test('a fresh controller is unaffected by an abandoned prior StrictMode-style view lifetime', async () => {
  const gate = deferred<CloudOperatingAuthSession>();
  const started = deferred();
  const old = fixture({ factory: async () => { started.resolve(); return gate.promise; } });
  const oldLogin = old.controller.signIn(EMAIL, PASSWORD);
  await started.promise;
  const oldClose = old.controller.dispose();
  const fresh = fixture();
  await fresh.controller.signIn(EMAIL, PASSWORD);
  gate.resolve(old.session); await oldLogin; await oldClose;
  assert.equal(fresh.controller.getState().auth.phase, 'owner-checked');
  assert.equal(old.controller.getState().auth.phase, 'closed');
  assert.deepEqual(old.credentials, []);
  assert.equal(fresh.calls.includes('destroy'), false);
  await fresh.controller.dispose();
});

test('dispose upgrades a pending sign-out and does not duplicate session cleanup', async () => {
  const gate = deferred();
  const started = deferred();
  const h = fixture({ adapter: { signOut: async () => { started.resolve(); await gate.promise; } } });
  await h.controller.signIn(EMAIL, PASSWORD);
  const logout = h.controller.signOut();
  await started.promise;
  const closing = h.controller.dispose();
  assert.equal(h.controller.getState().auth.phase, 'closed');
  gate.resolve(); assert.equal(await logout, true); await closing;
  assert.equal(h.calls.filter(value => value === 'signOut').length, 1);
  assert.equal(h.calls.filter(value => value === 'destroy').length, 1);
});

test('failed cleanup returns false and permanently blocks another factory or sign-in until reload', async () => {
  for (const failure of ['signOut', 'destroy'] as const) {
    const h = fixture({ adapter: { [failure]: async () => { throw new Error(PASSWORD); } } });
    await h.controller.signIn(EMAIL, PASSWORD);
    assert.equal(await h.controller.signOut(), false);
    assert.equal(h.controller.getState().cleanupFailed, true);
    assert.equal(h.controller.getState().auth.owner, null);
    assert.match(h.controller.getState().error, /أعد تحميل الصفحة/u);
    assert.equal(h.controller.getState().error.includes(PASSWORD), false);
    const previousCalls = [...h.calls];
    await h.controller.signIn(EMAIL, PASSWORD); await h.controller.refresh();
    assert.equal(await h.controller.signOut(), false);
    await h.controller.dispose();
    assert.deepEqual(h.calls, previousCalls);
  }
});

test('factory and operation failures are fixed safe UI errors, not thrown SDK details', async () => {
  for (const mode of ['factory', 'signIn', 'readOwner'] as const) {
    const secret = new Proxy({}, { getPrototypeOf() { throw new Error(PASSWORD); } });
    const h = fixture(mode === 'factory'
      ? { factory: async () => { throw secret; } }
      : { adapter: { [mode]: async () => { throw secret; } } });
    await assert.doesNotReject(h.controller.signIn(EMAIL, PASSWORD));
    assert.equal(h.controller.getState().auth.owner, null);
    assert.equal(h.controller.getState().pending, false);
    assert.ok(h.controller.getState().error);
    assert.equal(h.controller.getState().error.includes(PASSWORD), false);
    await h.controller.dispose();
  }
});

test('rejected delayed factory is awaited by sign-out without producing a spurious cleanup failure', async () => {
  const gate = deferred<CloudOperatingAuthSession>();
  const started = deferred();
  const h = fixture({ factory: async () => { started.resolve(); return gate.promise; } });
  const login = h.controller.signIn(EMAIL, PASSWORD);
  await started.promise;
  const logout = h.controller.signOut();
  gate.reject(new Error(PASSWORD)); await login;
  assert.equal(await logout, true);
  assert.equal(h.controller.getState().cleanupFailed, false);
  assert.equal(h.controller.getState().error, '');
});

test('identity invalidation clears checked UI metadata and cannot be restored by a late operation result', async () => {
  const h = fixture();
  await h.controller.signIn(EMAIL, PASSWORD);
  h.session.invalidate();
  assert.equal(h.controller.getState().auth.owner, null);
  assert.equal(h.controller.getState().auth.phase, 'signed-out');
  await h.controller.dispose();
});

test('in-flight membership invalidation cannot return a checked owner to the page', async () => {
  const gate = deferred<ReturnType<typeof record>>();
  const started = deferred();
  const h = fixture({ adapter: { readOwner: async () => { started.resolve(); return gate.promise; } } });
  const login = h.controller.signIn(EMAIL, PASSWORD);
  await started.promise;
  h.session.invalidate(); gate.resolve(record()); await login;
  assert.equal(h.controller.getState().auth.owner, null);
  assert.ok(h.controller.getState().error);
  assert.equal(h.controller.getState().pending, false);
  await h.controller.dispose();
});

test('invalid or throwing runtime refuses factory calls and returns only safe UI messages', async () => {
  for (const runtime of [() => false, () => { throw new Error(PASSWORD); }]) {
    const h = fixture({ runtime });
    await h.controller.signIn(EMAIL, PASSWORD);
    assert.deepEqual(h.calls, []);
    assert.ok(h.controller.getState().error);
    assert.equal(h.controller.getState().error.includes(PASSWORD), false);
    await h.controller.dispose();
  }
});

test('runtime change while the factory resolves disposes its result before credentials can run', async () => {
  const gate = deferred<CloudOperatingAuthSession>();
  const started = deferred();
  const h = fixture({ factory: async () => { started.resolve(); return gate.promise; } });
  const login = h.controller.signIn(EMAIL, PASSWORD);
  await started.promise;
  h.setRuntime(false); gate.resolve(h.session); await login;
  assert.deepEqual(h.calls, ['factory', 'signOut', 'destroy']);
  assert.equal(h.controller.getState().auth.owner, null);
  assert.ok(h.controller.getState().error);
  assert.deepEqual(h.credentials, []);
});

test('runtime change after authorization cannot publish a checked result', async () => {
  let h!: ReturnType<typeof fixture>;
  h = fixture({ adapter: { readOwner: async () => { h.setRuntime(false); return record(); } } });
  const states: CloudOperatingPageState[] = [];
  h.controller.subscribe(value => states.push(value));
  await h.controller.signIn(EMAIL, PASSWORD);
  assert.equal(h.controller.getState().auth.owner, null);
  assert.equal(h.calls.at(-1), 'destroy');
  assert.ok(h.controller.getState().error);
  assert.equal(states.some(value => value.auth.phase === 'owner-checked' || value.auth.owner !== null), false);
});

test('authorization and SDK cleanup failure permanently block retry instead of retaining an ambiguous session', async () => {
  const h = fixture({ adapter: {
    signIn: async () => { throw new Error(PASSWORD); },
    signOut: async () => { throw new Error(PASSWORD); },
  } });
  await h.controller.signIn(EMAIL, PASSWORD);
  assert.equal(h.controller.getState().cleanupFailed, true);
  assert.equal(h.controller.getState().auth.owner, null);
  assert.equal(h.controller.getState().pending, false);
  assert.match(h.controller.getState().error, /أعد تحميل الصفحة/u);
  assert.equal(h.controller.getState().error.includes(PASSWORD), false);
  assert.equal(h.calls.at(-1), 'destroy');
  const previousCalls = [...h.calls];
  await h.controller.signIn(EMAIL, PASSWORD); await h.controller.refresh();
  assert.equal(await h.controller.signOut(), false);
  assert.deepEqual(h.calls, previousCalls);
  await h.controller.dispose();
});

test('cancelling on core checking invalidates queued SDK sign-in before it starts', async () => {
  const h = fixture();
  let checkingCount = 0;
  let logout: Promise<boolean> | null = null;
  h.controller.subscribe(value => {
    if (value.auth.phase === 'checking' && ++checkingCount === 2) logout = h.controller.signOut();
  });
  await h.controller.signIn(EMAIL, PASSWORD);
  assert.equal(await logout, true);
  assert.equal(checkingCount, 2);
  assert.deepEqual(h.credentials, []);
  assert.equal(h.calls[0], 'factory');
  assert.equal(h.calls.at(-1), 'destroy');
  assert.equal(h.calls.filter(value => value === 'destroy').length, 1);
  assert.equal(h.calls.includes('signIn'), false);
});

test('subscriber errors, unsubscribe and reentrant closing cannot interrupt ownership cleanup', async () => {
  const h = fixture();
  let logout: Promise<boolean> | null = null;
  let disposal: Promise<void> | null = null;
  h.controller.subscribe(() => { throw new Error(PASSWORD); });
  const values: CloudOperatingPageState[] = [];
  const unsubscribe = h.controller.subscribe(value => values.push(value));
  h.controller.subscribe(value => {
    if (value.auth.phase === 'signing-out') logout = h.controller.signOut();
    if (value.auth.phase === 'closed') disposal = h.controller.dispose();
  });
  await h.controller.signIn(EMAIL, PASSWORD);
  unsubscribe(); const count = values.length;
  const firstLogout = h.controller.signOut();
  assert.equal(firstLogout, logout); assert.equal(await firstLogout, true);
  const firstDispose = h.controller.dispose();
  assert.equal(firstDispose, disposal); await firstDispose;
  assert.equal(values.length, count);
  assert.equal(h.calls.filter(value => value === 'destroy').length, 1);
});

test('closing from a checking notification prevents delayed factory/auth work', async () => {
  const h = fixture();
  let closing: Promise<void> | null = null;
  h.controller.subscribe(value => { if (value.auth.phase === 'checking') closing = h.controller.dispose(); });
  await h.controller.signIn(EMAIL, PASSWORD); await closing;
  assert.deepEqual(h.calls, []);
  assert.equal(h.controller.getState().auth.phase, 'closed');
});

test('controller bundle imports no clinical storage, App, old backup, full Firestore or provider service', async () => {
  const result = await build({ entryPoints: ['src/utils/cloudOperatingPageController.ts'],
    bundle: true, write: false, metafile: true, platform: 'browser', logLevel: 'silent',
    external: ['firebase/*'] });
  for (const input of Object.keys(result.metafile!.inputs)) {
    assert.doesNotMatch(input, /src\/App\.tsx|storage\.ts|firebaseService|offlineSync|aiService|firebase-applet-config/iu);
  }
  const imports = Object.values(result.metafile!.outputs).flatMap(value => value.imports.map(item => item.path));
  assert.equal(imports.includes('firebase/firestore'), false);
  assert.doesNotMatch(imports.join('\n'), /firebase\/storage|firebase-admin/iu);
});
