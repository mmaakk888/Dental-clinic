import test from 'node:test';
import assert from 'node:assert/strict';
import { cloudSetupErrorMessage, cloudSetupNeedsSignIn, createCloudSetupSession, type CloudSetupAdapter } from './cloudAuthSetup';
import type { CloudOwnerIdentity } from './cloudIdentity';

const SYNTHETIC_EMAIL = 'owner@example.invalid';
const SYNTHETIC_PASSWORD = 'synthetic-password-only';

function syntheticIdentity(status: CloudOwnerIdentity['status'] = 'verification-required'): CloudOwnerIdentity {
  return { uid: 'synthetic-owner-uid', email: SYNTHETIC_EMAIL, status };
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

function harness(overrides: Partial<CloudSetupAdapter> = {}) {
  const calls: string[] = [];
  const signIns: [string, string][] = [];
  let identity = syntheticIdentity();
  const adapter: CloudSetupAdapter = {
    signIn: async (email, password) => {
      calls.push('signIn');
      signIns.push([email, password]);
      await overrides.signIn?.(email, password);
    },
    readIdentity: async () => {
      calls.push('readIdentity');
      return overrides.readIdentity ? await overrides.readIdentity() : identity;
    },
    sendVerification: async () => { calls.push('sendVerification'); await overrides.sendVerification?.(); },
    signOut: async () => { calls.push('signOut'); await overrides.signOut?.(); },
    destroy: async () => { calls.push('destroy'); await overrides.destroy?.(); },
  };
  return {
    session: createCloudSetupSession(adapter),
    calls,
    signIns,
    setIdentity: (next: CloudOwnerIdentity) => { identity = next; },
  };
}

test('invalid email or password is rejected before any adapter call', async () => {
  const invalid: [unknown, unknown][] = [
    ['', SYNTHETIC_PASSWORD],
    [' ', SYNTHETIC_PASSWORD],
    ['owner', SYNTHETIC_PASSWORD],
    ['owner@example', SYNTHETIC_PASSWORD],
    ['owner @example.invalid', SYNTHETIC_PASSWORD],
    [`${'a'.repeat(250)}@example.invalid`, SYNTHETIC_PASSWORD],
    [null, SYNTHETIC_PASSWORD],
    [7, SYNTHETIC_PASSWORD],
    [SYNTHETIC_EMAIL, ''],
    [SYNTHETIC_EMAIL, 'x'.repeat(4097)],
    [SYNTHETIC_EMAIL, null],
    [SYNTHETIC_EMAIL, 7],
  ];
  for (const [email, password] of invalid) {
    const fixture = harness();
    await assert.rejects(fixture.session.signIn(email as string, password as string), /البريد الإلكتروني/u);
    assert.deepEqual(fixture.calls, []);
    assert.deepEqual(fixture.signIns, []);
  }
});

test('sign-in trims the email, preserves the supplied password, and returns fresh identity', async () => {
  const fixture = harness();
  const identity = syntheticIdentity('owner-confirmed');
  fixture.setIdentity(identity);
  assert.equal(await fixture.session.signIn(`  ${SYNTHETIC_EMAIL}  `, SYNTHETIC_PASSWORD), identity);
  assert.deepEqual(fixture.signIns, [[SYNTHETIC_EMAIL, SYNTHETIC_PASSWORD]]);
  assert.deepEqual(fixture.calls, ['signIn', 'readIdentity']);
});

test('a rejected adapter sign-in signs out without reading identity or sending mail', async () => {
  const failure = new Error('synthetic sign-in failure');
  const fixture = harness({ signIn: async () => { throw failure; } });
  await assert.rejects(fixture.session.signIn(SYNTHETIC_EMAIL, SYNTHETIC_PASSWORD), error => error === failure);
  assert.deepEqual(fixture.calls, ['signIn', 'signOut']);
});

test('an identity rejection after sign-in signs out and preserves the original failure', async () => {
  const failure = new Error('synthetic identity failure');
  const fixture = harness({
    readIdentity: async () => { throw failure; },
    signOut: async () => { throw new Error('synthetic cleanup failure'); },
  });
  await assert.rejects(fixture.session.signIn(SYNTHETIC_EMAIL, SYNTHETIC_PASSWORD), error => error === failure);
  assert.deepEqual(fixture.calls, ['signIn', 'readIdentity', 'signOut']);
});

test('only one operation runs at a time and rejected concurrent requests do not call the adapter', async () => {
  const started = deferred();
  const release = deferred();
  const fixture = harness({ signIn: async () => { started.resolve(); await release.promise; } });
  const login = fixture.session.signIn(SYNTHETIC_EMAIL, SYNTHETIC_PASSWORD);
  await started.promise;

  for (const operation of [
    () => fixture.session.signIn(SYNTHETIC_EMAIL, SYNTHETIC_PASSWORD),
    () => fixture.session.refresh(),
    () => fixture.session.sendVerification(),
    () => fixture.session.signOut(),
  ]) await assert.rejects(operation(), /انتظر انتهاء العملية الحالية/u);
  assert.deepEqual(fixture.calls, ['signIn']);

  release.resolve();
  assert.deepEqual(await login, syntheticIdentity());
  await fixture.session.refresh();
  assert.deepEqual(fixture.calls, ['signIn', 'readIdentity', 'readIdentity']);
});

test('single-flight state is released after an operation fails so a retry can succeed', async () => {
  let fail = true;
  const fixture = harness({ signIn: async () => { if (fail) throw new Error('synthetic retryable failure'); } });
  await assert.rejects(fixture.session.signIn(SYNTHETIC_EMAIL, SYNTHETIC_PASSWORD));
  fail = false;
  assert.deepEqual(await fixture.session.signIn(SYNTHETIC_EMAIL, SYNTHETIC_PASSWORD), syntheticIdentity());
  assert.deepEqual(fixture.calls, ['signIn', 'signOut', 'signIn', 'readIdentity']);
});

test('refresh reads the current identity instead of reusing the previous verification status', async () => {
  const fixture = harness();
  assert.equal((await fixture.session.signIn(SYNTHETIC_EMAIL, SYNTHETIC_PASSWORD)).status, 'verification-required');
  const confirmed = syntheticIdentity('owner-confirmed');
  fixture.setIdentity(confirmed);
  assert.equal(await fixture.session.refresh(), confirmed);
  assert.deepEqual(fixture.calls, ['signIn', 'readIdentity', 'readIdentity']);
});

test('refresh failure signs out and preserves the failure even if cleanup also fails', async () => {
  const failure = new Error('synthetic refresh failure');
  const fixture = harness({
    readIdentity: async () => { throw failure; },
    signOut: async () => { throw new Error('synthetic cleanup failure'); },
  });
  await assert.rejects(fixture.session.refresh(), error => error === failure);
  assert.deepEqual(fixture.calls, ['readIdentity', 'signOut']);
});

test('creating a session, signing in and refreshing never send verification mail automatically', async () => {
  const fixture = harness();
  assert.deepEqual(fixture.calls, []);
  await fixture.session.signIn(SYNTHETIC_EMAIL, SYNTHETIC_PASSWORD);
  await fixture.session.refresh();
  assert.deepEqual(fixture.calls, ['signIn', 'readIdentity', 'readIdentity']);

  await fixture.session.sendVerification();
  assert.deepEqual(fixture.calls, ['signIn', 'readIdentity', 'readIdentity', 'readIdentity', 'sendVerification']);
});

test('verification sending rechecks owner identity and refuses an already confirmed email', async () => {
  const fixture = harness();
  await fixture.session.signIn(SYNTHETIC_EMAIL, SYNTHETIC_PASSWORD);
  fixture.setIdentity(syntheticIdentity('owner-confirmed'));
  await assert.rejects(fixture.session.sendVerification(), /البريد مؤكد بالفعل/u);
  assert.deepEqual(fixture.calls, ['signIn', 'readIdentity', 'readIdentity']);
});

test('verification sending stops if the fresh identity cannot be established', async () => {
  const secret = 'synthetic-password-and-id-token-never-display';
  const fixture = harness({
    readIdentity: async () => { throw new Error(secret); },
    signOut: async () => { throw new Error('synthetic cleanup failure'); },
  });
  await assert.rejects(fixture.session.sendVerification(), error => {
    assert.equal(cloudSetupNeedsSignIn(error), true);
    const message = cloudSetupErrorMessage(error);
    assert.match(message, /سجّل الدخول من جديد/u);
    assert.equal(message.includes(secret), false);
    return true;
  });
  assert.deepEqual(fixture.calls, ['readIdentity', 'signOut']);
});

test('verification provider failure keeps the identity available and permits an explicit retry', async () => {
  let fail = true;
  const failure = { code: 'auth/network-request-failed', message: 'synthetic-password-and-id-token-never-display' };
  const fixture = harness({ sendVerification: async () => { if (fail) throw failure; } });
  await assert.rejects(fixture.session.sendVerification(), error => {
    assert.equal(error, failure);
    assert.equal(cloudSetupNeedsSignIn(error), false);
    assert.match(cloudSetupErrorMessage(error), /تعذر الاتصال/u);
    return true;
  });
  fail = false;
  await fixture.session.sendVerification();
  assert.deepEqual(fixture.calls, ['readIdentity', 'sendVerification', 'readIdentity', 'sendVerification']);
});

test('explicit sign-out invokes only sign-out and allows a subsequent operation', async () => {
  const fixture = harness();
  await fixture.session.signOut();
  assert.deepEqual(fixture.calls, ['signOut']);
  await fixture.session.refresh();
  assert.deepEqual(fixture.calls, ['signOut', 'readIdentity']);
});

test('dispose is idempotent, signs out before destroy and rejects every new operation', async () => {
  const fixture = harness();
  const first = fixture.session.dispose();
  assert.equal(fixture.session.dispose(), first);
  await first;
  assert.equal(fixture.session.dispose(), first);
  for (const operation of [
    () => fixture.session.signIn(SYNTHETIC_EMAIL, SYNTHETIC_PASSWORD),
    () => fixture.session.refresh(),
    () => fixture.session.sendVerification(),
    () => fixture.session.signOut(),
  ]) await assert.rejects(operation(), /أُغلقت جلسة التجهيز/u);
  assert.deepEqual(fixture.calls, ['signOut', 'destroy']);
});

test('dispose waits for an in-flight login, rejects its late result, then cleans up', async () => {
  const started = deferred();
  const release = deferred<CloudOwnerIdentity>();
  const fixture = harness({ readIdentity: async () => { started.resolve(); return release.promise; } });
  const login = fixture.session.signIn(SYNTHETIC_EMAIL, SYNTHETIC_PASSWORD);
  const rejectedLogin = assert.rejects(login, /أُغلقت جلسة التجهيز/u);
  await started.promise;

  const disposal = fixture.session.dispose();
  assert.equal(fixture.session.dispose(), disposal);
  assert.deepEqual(fixture.calls, ['signIn', 'readIdentity']);
  await assert.rejects(fixture.session.refresh(), /أُغلقت جلسة التجهيز/u);
  assert.deepEqual(fixture.calls, ['signIn', 'readIdentity']);

  release.resolve(syntheticIdentity('owner-confirmed'));
  await rejectedLogin;
  await disposal;
  assert.deepEqual(fixture.calls, ['signIn', 'readIdentity', 'signOut', 'destroy']);
});

test('dispose also waits for an explicit verification send already in flight', async () => {
  const started = deferred();
  const release = deferred();
  const fixture = harness({ sendVerification: async () => { started.resolve(); await release.promise; } });
  const sending = fixture.session.sendVerification();
  const rejectedSend = assert.rejects(sending, /أُغلقت جلسة التجهيز/u);
  await started.promise;
  const disposal = fixture.session.dispose();
  assert.deepEqual(fixture.calls, ['readIdentity', 'sendVerification']);
  release.resolve();
  await rejectedSend;
  await disposal;
  assert.deepEqual(fixture.calls, ['readIdentity', 'sendVerification', 'signOut', 'destroy']);
});

test('dispose destroys the adapter even if sign-out fails and does not repeat cleanup', async () => {
  const failure = new Error('synthetic sign-out failure');
  const fixture = harness({ signOut: async () => { throw failure; } });
  const disposal = fixture.session.dispose();
  await assert.rejects(disposal, error => error === failure);
  assert.equal(fixture.session.dispose(), disposal);
  await assert.rejects(fixture.session.dispose(), error => error === failure);
  assert.deepEqual(fixture.calls, ['signOut', 'destroy']);
});

test('known Firebase failure codes produce fixed Arabic messages without raw details', () => {
  const secret = 'synthetic-password-and-id-token-never-display';
  const network = cloudSetupErrorMessage({ code: 'auth/network-request-failed', message: secret, customData: { token: secret } });
  const rateLimit = cloudSetupErrorMessage({ code: 'auth/too-many-requests', message: secret });
  assert.match(network, /تعذر الاتصال/u);
  assert.match(rateLimit, /طلبات كثيرة/u);
  for (const message of [network, rateLimit]) assert.equal(message.includes(secret), false);
});

test('unknown, credential and forged internal errors are sanitized without exposing secrets', () => {
  const secret = 'synthetic-password-and-id-token-never-display';
  const generic = cloudSetupErrorMessage(null);
  for (const error of [
    undefined, 7, secret, new Error(secret),
    { code: 'auth/invalid-credential', message: secret, customData: { password: secret } },
    { code: `auth/${secret}`, message: secret },
    { name: 'SetupError', message: secret },
    { name: 'IdentityError', message: secret },
    { code: { toString: () => secret }, message: secret },
  ]) {
    const message = cloudSetupErrorMessage(error);
    assert.equal(message, generic);
    assert.match(message, /[\u0600-\u06ff]/u);
    assert.equal(message.includes(secret), false);
    assert.equal(cloudSetupNeedsSignIn(error), false);
  }
});

test('ordinary internal validation errors do not incorrectly require a new sign-in', async () => {
  const fixture = harness();
  await assert.rejects(fixture.session.signIn('', ''), error => {
    assert.equal(cloudSetupNeedsSignIn(error), false);
    assert.match(cloudSetupErrorMessage(error), /البريد الإلكتروني/u);
    return true;
  });
});

test('error sanitization does not evaluate an untrusted code accessor', () => {
  const error = { get code() { throw new Error('synthetic-password-and-id-token-never-display'); } };
  assert.equal(cloudSetupErrorMessage(error), cloudSetupErrorMessage(null));
});

test('error sanitization safely handles a throwing property-descriptor Proxy trap', () => {
  const error = new Proxy({}, {
    getOwnPropertyDescriptor() { throw new Error('synthetic-password-and-id-token-never-display'); },
  });
  assert.equal(cloudSetupErrorMessage(error), cloudSetupErrorMessage(null));
});
