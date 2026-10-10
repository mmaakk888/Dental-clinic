import test from 'node:test';
import assert from 'node:assert/strict';
import { cloudOperatingAuthErrorMessage, CloudOperatingAuthError, createCloudOperatingAuthSession,
  type CloudOperatingAuthAdapter, type CloudOperatingAuthState } from './cloudOperatingAuth';

const EMAIL = 'owner@example.invalid';
const PASSWORD = 'synthetic-password-only';
const AUTH_TIME = 1_700_000_000;

function record(): Awaited<ReturnType<CloudOperatingAuthAdapter['readOwner']>> {
  return {
    identity: { uid: 'synthetic-owner', email: EMAIL, status: 'owner-confirmed' },
    membership: { schemaVersion: 1, clinicId: 'main', uid: 'synthetic-owner', role: 'owner',
      status: 'active', identityVersion: 1, verifiedAfter: AUTH_TIME },
    authTime: AUTH_TIME,
  };
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

function fixture(overrides: Partial<CloudOperatingAuthAdapter> = {}) {
  const calls: string[] = [];
  const credentials: [string, string][] = [];
  const session = createCloudOperatingAuthSession({
    signIn: async (email, password) => {
      calls.push('signIn'); credentials.push([email, password]); await overrides.signIn?.(email, password);
    },
    readOwner: async () => { calls.push('readOwner'); return overrides.readOwner ? overrides.readOwner() : record(); },
    signOut: async () => { calls.push('signOut'); await overrides.signOut?.(); },
    destroy: async () => { calls.push('destroy'); await overrides.destroy?.(); },
  });
  return { session, calls, credentials };
}

async function rejectsCode(work: Promise<unknown>, code: CloudOperatingAuthError['code']) {
  await assert.rejects(work, error => error instanceof CloudOperatingAuthError && error.code === code);
}

test('operating lifecycle has no automatic reads or writes and rejects invalid credentials before SDK work', async () => {
  const h = fixture();
  assert.deepEqual(h.session.getState(), { phase: 'signed-out', owner: null });
  for (const [email, password] of [['', PASSWORD], ['owner', PASSWORD], ['a @b.test', PASSWORD],
    ['x'.repeat(255) + '@example.invalid', PASSWORD], [EMAIL, ''], [EMAIL, 'x'.repeat(4097)],
    [null, PASSWORD], [EMAIL, null]]) {
    await rejectsCode(h.session.signIn(email as string, password as string), 'invalid-input');
  }
  assert.deepEqual(h.calls, []);
});

test('sign-in checks canonical membership and returns an immutable metadata snapshot with no credentials', async () => {
  const h = fixture();
  const phases: string[] = [];
  h.session.subscribe(state => phases.push(state.phase));
  const owner = await h.session.signIn(` ${EMAIL} `, PASSWORD);
  assert.deepEqual(h.credentials, [[EMAIL, PASSWORD]]);
  assert.deepEqual(h.calls, ['signIn', 'readOwner']);
  assert.deepEqual(phases, ['checking', 'owner-checked']);
  assert.equal(Object.isFrozen(owner), true);
  assert.equal(Object.isFrozen(h.session.getState()), true);
  assert.deepEqual(Object.keys(owner).sort(), ['uid', 'email', 'identityVersion', 'verifiedAfter'].sort());
  assert.equal(JSON.stringify(h.session.getState()).includes(PASSWORD), false);
});

test('every authorization repeats the server read and replaces prior metadata rather than caching permission', async () => {
  let version = 1;
  const h = fixture({ readOwner: async () => { const next = record(); next.membership.identityVersion = version; return next; } });
  await h.session.signIn(EMAIL, PASSWORD);
  version = 2;
  const next = await h.session.authorizeOwner();
  assert.equal(next.identityVersion, 2);
  assert.deepEqual(h.calls, ['signIn', 'readOwner', 'readOwner']);
});

test('revoked, malformed, unverified and pre-cutoff memberships deny operation and discard prior snapshot', async () => {
  const corruptions: ((value: ReturnType<typeof record>) => void)[] = [
    value => { value.membership.status = 'disabled'; },
    value => { value.membership.uid = 'other-synthetic-owner'; },
    value => { value.identity.status = 'verification-required'; },
    value => { value.authTime--; },
    value => { value.authTime = NaN; },
    value => { value.membership.identityVersion = 0; },
    value => { Object.defineProperty(value.membership, 'status', { enumerable: true, get() { throw new Error(PASSWORD); } }); },
  ];
  for (const corrupt of corruptions) {
    let value = record();
    const h = fixture({ readOwner: async () => value });
    await h.session.signIn(EMAIL, PASSWORD);
    value = record(); corrupt(value);
    await rejectsCode(h.session.authorizeOwner(), 'unavailable');
    assert.deepEqual(h.session.getState(), { phase: 'signed-out', owner: null });
    assert.equal(h.calls.at(-1), 'signOut');
  }
});

test('single-flight rejects duplicate login and refresh without calling the adapter again', async () => {
  const gate = deferred();
  const started = deferred();
  const h = fixture({ signIn: async () => { started.resolve(); await gate.promise; } });
  const login = h.session.signIn(EMAIL, PASSWORD);
  await started.promise;
  await rejectsCode(h.session.signIn(EMAIL, PASSWORD), 'busy');
  await rejectsCode(h.session.authorizeOwner(), 'busy');
  assert.deepEqual(h.calls, ['signIn']);
  gate.resolve();
  await login;
});

test('sign-out immediately invalidates pending login and waits to clean its late SDK result', async () => {
  const gate = deferred();
  const started = deferred();
  const h = fixture({ signIn: async () => { started.resolve(); await gate.promise; } });
  const login = h.session.signIn(EMAIL, PASSWORD);
  const rejected = rejectsCode(login, 'changed');
  await started.promise;
  const logout = h.session.signOut();
  assert.deepEqual(h.session.getState(), { phase: 'signing-out', owner: null });
  await rejectsCode(h.session.signIn(EMAIL, PASSWORD), 'busy');
  gate.resolve();
  await rejected; await logout;
  assert.equal(h.calls.includes('readOwner'), false);
  assert.equal(h.calls.at(-1), 'signOut');
  assert.deepEqual(h.session.getState(), { phase: 'signed-out', owner: null });
});

test('SDK identity invalidation discards an in-flight membership read even if it later succeeds', async () => {
  const gate = deferred<ReturnType<typeof record>>();
  const started = deferred();
  const h = fixture({ readOwner: async () => { started.resolve(); return gate.promise; } });
  const login = h.session.signIn(EMAIL, PASSWORD);
  const rejected = rejectsCode(login, 'changed');
  await started.promise;
  h.session.invalidate();
  assert.equal(h.session.getState().owner, null);
  gate.resolve(record());
  await rejected;
  assert.equal(h.session.getState().phase, 'signed-out');
});

test('dispose closes immediately, is idempotent and destroys only after pending work has been signed out', async () => {
  const gate = deferred<ReturnType<typeof record>>();
  const started = deferred();
  const h = fixture({ readOwner: async () => { started.resolve(); return gate.promise; } });
  const login = h.session.signIn(EMAIL, PASSWORD);
  const rejected = rejectsCode(login, 'changed');
  await started.promise;
  const closing = h.session.dispose();
  assert.equal(h.session.dispose(), closing);
  assert.deepEqual(h.session.getState(), { phase: 'closed', owner: null });
  await rejectsCode(h.session.signIn(EMAIL, PASSWORD), 'closed');
  gate.resolve(record());
  await rejected; await closing;
  assert.equal(h.calls.at(-1), 'destroy');
  assert.equal(h.calls.filter(call => call === 'destroy').length, 1);
  assert.equal(h.session.getState().phase, 'closed');
});

test('dispose upgrades a pending sign-out without reopening or destroying the SDK app twice', async () => {
  const gate = deferred();
  const h = fixture({ signOut: async () => gate.promise });
  await h.session.signIn(EMAIL, PASSWORD);
  const logout = h.session.signOut();
  const close = h.session.dispose();
  assert.equal(h.session.getState().phase, 'closed');
  gate.resolve(); await logout; await close;
  assert.equal(h.calls.filter(call => call === 'signOut').length, 1);
  assert.equal(h.calls.filter(call => call === 'destroy').length, 1);
});

test('failed SDK cleanup stays closed to new sign-in until explicit cleanup succeeds', async () => {
  let failing = true;
  const h = fixture({ signOut: async () => { if (failing) throw new Error(PASSWORD); } });
  await h.session.signIn(EMAIL, PASSWORD);
  await rejectsCode(h.session.signOut(), 'unavailable');
  assert.equal(h.session.getState().owner, null);
  await rejectsCode(h.session.signIn(EMAIL, PASSWORD), 'unavailable');
  failing = false;
  await h.session.signOut();
  await h.session.signIn(EMAIL, PASSWORD);
  assert.equal(h.session.getState().phase, 'owner-checked');
});

test('failed authorization never leaks a raw provider error, token or malformed Proxy', async () => {
  const errors = [new Error(PASSWORD), { code: 'auth/provider-code', message: PASSWORD },
    new Proxy({}, { getPrototypeOf() { throw new Error(PASSWORD); } })];
  for (const failure of errors) {
    const h = fixture({ readOwner: async () => { throw failure; } });
    await assert.rejects(h.session.signIn(EMAIL, PASSWORD), error => {
      assert.equal(error instanceof CloudOperatingAuthError, true);
      assert.equal(String(error).includes(PASSWORD), false);
      assert.equal(cloudOperatingAuthErrorMessage(error).includes(PASSWORD), false);
      return true;
    });
    assert.equal(cloudOperatingAuthErrorMessage(failure).includes(PASSWORD), false);
  }
});

test('subscriber errors cannot interrupt invalidation and unsubscribed views do not receive changes', async () => {
  const h = fixture();
  const snapshots: CloudOperatingAuthState[] = [];
  h.session.subscribe(() => { throw new Error('synthetic-view-failure'); });
  const unsubscribe = h.session.subscribe(state => snapshots.push(state));
  await h.session.signIn(EMAIL, PASSWORD);
  unsubscribe();
  h.session.invalidate();
  assert.equal(h.session.getState().owner, null);
  assert.equal(snapshots.length, 2);
  assert.equal(snapshots[1].phase, 'owner-checked');
});

test('checking notifications cannot synchronously launch a competing authorization', async () => {
  const h = fixture();
  let competing: Promise<void> | null = null;
  h.session.subscribe(state => {
    if (state.phase === 'checking') competing = rejectsCode(h.session.authorizeOwner(), 'busy');
  });
  await h.session.signIn(EMAIL, PASSWORD);
  await competing;
  assert.deepEqual(h.calls, ['signIn', 'readOwner']);
});

test('sign-out during an owner-checked notification cannot return a usable late login result', async () => {
  const h = fixture();
  let logout: Promise<void> | null = null;
  h.session.subscribe(state => { if (state.phase === 'owner-checked') logout = h.session.signOut(); });
  await rejectsCode(h.session.signIn(EMAIL, PASSWORD), 'changed');
  await logout;
  assert.equal(h.session.getState().owner, null);
});

test('signing-out and closed notifications are re-entrant without recursive cleanup', async () => {
  const h = fixture();
  let logout: Promise<void> | null = null;
  let disposal: Promise<void> | null = null;
  h.session.subscribe(state => {
    if (state.phase === 'signing-out') logout = h.session.signOut();
    if (state.phase === 'closed') disposal = h.session.dispose();
  });
  const firstLogout = h.session.signOut();
  assert.equal(firstLogout, logout);
  await firstLogout;
  const firstDispose = h.session.dispose();
  assert.equal(firstDispose, disposal);
  await firstDispose;
  assert.equal(h.calls.filter(call => call === 'destroy').length, 1);
});
