import test from 'node:test';
import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';
import type { User } from '../types';
import { authenticateLocalAccount, getSecureCredentialVersion, hashPassword, hasPasswordCredential,
  isPasswordHash, PASSWORD_HASH_ITERATIONS, secureUserAccountsForStorage, validateNewPassword, verifyPassword } from './passwords';

const synthetic = (password?: string): User => ({ id: 'synthetic', name: 'اختبار', username: 'synthetic',
  role: 'doctor', permissions: {} as User['permissions'], password, extra: { untouched: ['keep'] } } as User);

test('PBKDF2 uses a random 128-bit salt and matches the independent Node implementation', async () => {
  const password = 'synthetic passphrase only';
  const first = await hashPassword(password), second = await hashPassword(password);
  assert.ok(isPasswordHash(first)); assert.notEqual(first, second);
  const [, iterations, salt, expected] = first.split('$');
  assert.equal(Number(iterations), PASSWORD_HASH_ITERATIONS);
  assert.equal(salt.length, 32); assert.equal(expected.length, 64);
  assert.equal(pbkdf2Sync(password, Buffer.from(salt, 'hex'), Number(iterations), 32, 'sha256').toString('hex'), expected);
  assert.equal(await verifyPassword(first, password), true);
  assert.equal(await verifyPassword(first, 'wrong synthetic passphrase'), false);
});

test('credential parser fails closed on malformed, weak, oversized or unknown hash versions', async () => {
  const suffix = `$${'00'.repeat(16)}$${'00'.repeat(32)}`;
  for (const stored of [undefined, '', 'pbkdf2-sha256', `pbkdf2-sha256$1${suffix}`,
    `pbkdf2-sha256$999999999${suffix}`, `pbkdf2-sha256$600000$zz$xx`, `pbkdf2-sha256-v2$600000${suffix}`]) {
    assert.equal(isPasswordHash(stored), false); assert.equal(hasPasswordCredential(synthetic(stored)), false);
    assert.equal(await verifyPassword(stored, 'synthetic passphrase only'), false);
  }
  await assert.rejects(hashPassword(''));
  await assert.rejects(hashPassword('x'.repeat(129)));
});

test('new passwords support passphrases and Unicode without silently trimming meaningful spaces', async () => {
  assert.ok(validateNewPassword('short'));
  assert.ok(validateNewPassword(' '.repeat(12)));
  assert.ok(validateNewPassword('long password\nnew line'));
  assert.equal(validateNewPassword('كلمة مرور خاصة بالاختبار'), null);
  const password = ' leading and trailing ';
  const hash = await hashPassword(password);
  assert.equal(await verifyPassword(hash, password), true);
  assert.equal(await verifyPassword(hash, password.trim()), false);
});

test('legacy credentials migrate after verification without mutating metadata or other accounts', async () => {
  const user = synthetic('old-test-only');
  const other = { ...synthetic('other-test-only'), id: 'other', username: 'other' };
  const before = JSON.stringify([user, other]);
  const result = await authenticateLocalAccount([user, other], ' SYNTHETIC ', 'old-test-only');
  assert.equal(result.migrated, true); assert.ok(isPasswordHash(result.user.password));
  assert.equal(result.user.credentialVersion, 2);
  assert.deepEqual((result.user as any).extra, (user as any).extra);
  assert.equal(result.users[1].password, other.password);
  assert.equal(JSON.stringify([user, other]), before);
  assert.equal(await verifyPassword(result.user.password, 'old-test-only'), true);
  const second = await authenticateLocalAccount(result.users, 'synthetic', 'old-test-only');
  assert.equal(second.migrated, false); assert.equal(second.user.credentialVersion, 2);
});

test('passwordless, inactive and ambiguous identities cannot log in', async () => {
  await assert.rejects(authenticateLocalAccount([synthetic()], 'synthetic', ''));
  await assert.rejects(authenticateLocalAccount([synthetic('test-only')], 'synthetic', 'incorrect'));
  await assert.rejects(authenticateLocalAccount([{ ...synthetic('test-only'), isActive: false }], 'synthetic', 'test-only'));
  await assert.rejects(authenticateLocalAccount([synthetic('test-only'), { ...synthetic('other'), id: 'second' }], 'synthetic', 'test-only'));
  await assert.rejects(authenticateLocalAccount([{ ...synthetic('test-only'), credentialVersion: 0 }], 'synthetic', 'test-only'));
});

test('securing a saved account list migrates once and preserves disabled passwordless records', async () => {
  const users = [synthetic('legacy-test-only'), { ...synthetic(), id: 'disabled', isActive: false }];
  const secured = await secureUserAccountsForStorage(users);
  assert.ok(isPasswordHash(secured[0].password)); assert.equal(secured[0].credentialVersion, 2);
  assert.equal(secured[1].password, undefined); assert.equal(hasPasswordCredential(secured[1]), false);
  assert.deepEqual(await secureUserAccountsForStorage(secured), secured);
  assert.equal(users[0].credentialVersion, undefined);
  for (const credentialVersion of [0, -1, NaN, Infinity, 1.2]) assert.throws(() => getSecureCredentialVersion({ credentialVersion }));
});

test('confirmed-save baseline gives new accounts version one and changes/migrations exactly one revocation', async () => {
  const original = { ...synthetic('old-synthetic-only'), credentialVersion: 5 };
  const pending = { ...original, password: 'new synthetic passphrase', credentialVersion: 6 };
  const replacement = await secureUserAccountsForStorage([pending], [original]);
  assert.equal(replacement[0].credentialVersion, 6);
  const migrated = await secureUserAccountsForStorage([original], [original]);
  assert.equal(migrated[0].credentialVersion, 6);
  const fresh = await secureUserAccountsForStorage([synthetic('new synthetic passphrase')], []);
  assert.equal(fresh[0].credentialVersion, 1);
  assert.deepEqual(await secureUserAccountsForStorage(replacement, [original]), replacement);
});
