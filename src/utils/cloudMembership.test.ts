import test from 'node:test';
import assert from 'node:assert/strict';
import { type CloudOwnerIdentity, CLOUD_CLINIC_ID } from './cloudIdentity';
import {
  CLOUD_OWNER_MEMBERSHIP_SCHEMA_VERSION,
  assessCloudOwnerMembership,
  parseCloudOwnerMembership,
  type CloudOwnerMembership,
} from './cloudMembership';

function syntheticOwner(): CloudOwnerIdentity {
  return { uid: 'synthetic-owner-uid', email: 'owner@example.invalid', status: 'owner-confirmed' };
}

function syntheticMembership(): CloudOwnerMembership {
  return {
    schemaVersion: 1,
    clinicId: CLOUD_CLINIC_ID,
    uid: 'synthetic-owner-uid',
    role: 'owner',
    status: 'active',
    identityVersion: 1,
    verifiedAfter: 1_700_000_000,
  };
}

function assertPrivateFailure(run: () => unknown): void {
  assert.throws(run, error => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, 'تعذر التحقق من عضوية مالك العيادة.');
    assert.equal(error.message.includes('synthetic'), false);
    assert.equal(error.message.includes('example.invalid'), false);
    return true;
  });
}

test('membership schema is explicitly v1 and copies the canonical record without mutation', () => {
  assert.equal(CLOUD_OWNER_MEMBERSHIP_SCHEMA_VERSION, 1);
  const input = syntheticMembership();
  const before = structuredClone(input);
  const parsed = parseCloudOwnerMembership(input);
  assert.deepEqual(parsed, input);
  assert.notEqual(parsed, input);
  parsed.status = 'disabled';
  assert.deepEqual(input, before);
});

test('owner assessment confirms diagnostic metadata only with exact UID and verified email identity', () => {
  const membership = syntheticMembership();
  const identity = syntheticOwner();
  const before = { membership: structuredClone(membership), identity: structuredClone(identity) };
  assert.deepEqual(assessCloudOwnerMembership(identity, membership, membership.verifiedAfter), {
    status: 'membership-confirmed', identityVersion: 1, verifiedAfter: 1_700_000_000,
  });
  assert.deepEqual(membership, before.membership);
  assert.deepEqual(identity, before.identity);
});

test('plain null-prototype and frozen records retain their safe exact own fields', () => {
  const plain = Object.assign(Object.create(null), syntheticMembership());
  assert.deepEqual(parseCloudOwnerMembership(plain), syntheticMembership());
  assert.deepEqual(parseCloudOwnerMembership(Object.freeze(syntheticMembership())), syntheticMembership());
});

test('valid disabled membership parses as metadata but cannot confirm an owner', () => {
  const membership = { ...syntheticMembership(), status: 'disabled' as const };
  assert.equal(parseCloudOwnerMembership(membership).status, 'disabled');
  assertPrivateFailure(() => assessCloudOwnerMembership(syntheticOwner(), membership, membership.verifiedAfter));
});

test('verifiedAfter permits the original sign-in exactly at or after the lower bound only', () => {
  const membership = syntheticMembership();
  assertPrivateFailure(() => assessCloudOwnerMembership(syntheticOwner(), membership, membership.verifiedAfter - 1));
  for (const authTime of [membership.verifiedAfter, membership.verifiedAfter + 1, Number.MAX_SAFE_INTEGER]) {
    assert.equal(assessCloudOwnerMembership(syntheticOwner(), membership, authTime).status, 'membership-confirmed');
  }
  membership.verifiedAfter = 0;
  assert.equal(assessCloudOwnerMembership(syntheticOwner(), membership, 0).status, 'membership-confirmed');
});

test('assessment fails closed for malformed authentication timestamps rather than coercing values', () => {
  for (const authTime of [undefined, null, '1700000000', true, -1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, new Date()]) {
    assertPrivateFailure(() => assessCloudOwnerMembership(syntheticOwner(), syntheticMembership(), authTime as number));
  }
});

for (const [field, values] of [
  ['schemaVersion', [undefined, null, 0, 2, '1', true]],
  ['clinicId', [undefined, null, '', 'Main', 'other-clinic', ['main']]],
  ['uid', [undefined, null, '', ' ', ' u', 'u ', 'u\n', 'u\u0000', 'u'.repeat(129), 1, ['uid']]],
  ['role', [undefined, null, '', 'secretary', 'doctor', 'admin', 'Owner', ['owner']]],
  ['status', [undefined, null, '', 'enabled', 'Active', true, ['active']]],
  ['identityVersion', [undefined, null, '', '1', true, 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]],
  ['verifiedAfter', [undefined, null, '', '0', true, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, new Date()]],
] as const) {
  test(`membership parser rejects invalid ${field} without leaking input`, () => {
    for (const value of values) {
      assertPrivateFailure(() => parseCloudOwnerMembership({ ...syntheticMembership(), [field]: value }));
    }
  });
}

test('safe integer boundaries and maximum valid UID length are retained exactly', () => {
  const membership = syntheticMembership();
  membership.identityVersion = Number.MAX_SAFE_INTEGER;
  membership.verifiedAfter = Number.MAX_SAFE_INTEGER;
  membership.uid = 'u'.repeat(128);
  const identity = { ...syntheticOwner(), uid: membership.uid };
  assert.deepEqual(parseCloudOwnerMembership(membership), membership);
  assert.equal(assessCloudOwnerMembership(identity, membership, Number.MAX_SAFE_INTEGER).identityVersion, Number.MAX_SAFE_INTEGER);
});

test('membership exact shape rejects missing and unknown keys including symbols and non-enumerable extras', () => {
  for (const field of Object.keys(syntheticMembership())) {
    const incomplete: Record<string, unknown> = { ...syntheticMembership() };
    delete incomplete[field];
    assertPrivateFailure(() => parseCloudOwnerMembership(incomplete));
  }
  for (const key of ['permissions', 'email', 'admin', 'toString', '__proto__', 'constructor', Symbol('owner')]) {
    const extra = { ...syntheticMembership() };
    Object.defineProperty(extra, key, { value: true, enumerable: true });
    assertPrivateFailure(() => parseCloudOwnerMembership(extra));
  }
  const hiddenExtra = { ...syntheticMembership() };
  Object.defineProperty(hiddenExtra, 'permissions', { value: 'all', enumerable: false });
  assertPrivateFailure(() => parseCloudOwnerMembership(hiddenExtra));
});

test('membership primitive, array, date and custom prototype objects do not establish canonical metadata', () => {
  for (const input of [undefined, null, true, false, 1, 'owner', [], new Date(), Object.create(syntheticMembership())]) {
    assertPrivateFailure(() => parseCloudOwnerMembership(input));
  }
  const ownWithInherited = Object.assign(Object.create({ admin: true }), syntheticMembership());
  assertPrivateFailure(() => parseCloudOwnerMembership(ownWithInherited));
});

test('membership parser does not evaluate field accessors or accept hidden known fields', () => {
  let evaluated = false;
  for (const field of Object.keys(syntheticMembership())) {
    const accessor = { ...syntheticMembership() };
    Object.defineProperty(accessor, field, {
      enumerable: true,
      get() { evaluated = true; throw new Error('untrusted accessor details'); },
    });
    assertPrivateFailure(() => parseCloudOwnerMembership(accessor));
    const hidden = { ...syntheticMembership() };
    Object.defineProperty(hidden, field, { value: hidden[field as keyof CloudOwnerMembership], enumerable: false });
    assertPrivateFailure(() => parseCloudOwnerMembership(hidden));
  }
  assert.equal(evaluated, false);
});

test('throwing or revoked proxy metadata is normalized to the fixed membership error', () => {
  for (const handler of [
    { getPrototypeOf() { throw new Error('private prototype trap'); } },
    { ownKeys() { throw new Error('private keys trap'); } },
    { getOwnPropertyDescriptor() { throw new Error('private descriptor trap'); } },
  ]) {
    assertPrivateFailure(() => parseCloudOwnerMembership(new Proxy(syntheticMembership(), handler)));
  }
  const proxy = Proxy.revocable(syntheticMembership(), {});
  proxy.revoke();
  assertPrivateFailure(() => parseCloudOwnerMembership(proxy.proxy));
});

test('verified identity never substitutes for a missing, different or disabled canonical owner record', () => {
  for (const membership of [undefined, null, {}, { ...syntheticMembership(), uid: 'other-synthetic-owner' }, { ...syntheticMembership(), status: 'disabled' }]) {
    assertPrivateFailure(() => assessCloudOwnerMembership(syntheticOwner(), membership, 1_700_000_001));
  }
});

test('pending email or malformed diagnostic identity cannot pass membership assessment', () => {
  for (const identity of [
    undefined, null, {}, [], 'owner',
    { ...syntheticOwner(), status: 'verification-required' },
    { ...syntheticOwner(), status: 'membership-confirmed' },
    { ...syntheticOwner(), uid: '' },
    { ...syntheticOwner(), email: '' },
    { ...syntheticOwner(), email: ' owner@example.invalid' },
    { ...syntheticOwner(), role: 'owner' },
    Object.create(syntheticOwner()),
  ]) {
    assertPrivateFailure(() => assessCloudOwnerMembership(identity as CloudOwnerIdentity, syntheticMembership(), 1_700_000_001));
  }
});

test('identity accessors are rejected without invocation during membership assessment', () => {
  let evaluated = false;
  for (const field of ['uid', 'email', 'status']) {
    const identity = { ...syntheticOwner() };
    Object.defineProperty(identity, field, {
      enumerable: true,
      get() { evaluated = true; throw new Error('private identity details'); },
    });
    assertPrivateFailure(() => assessCloudOwnerMembership(identity, syntheticMembership(), 1_700_000_001));
  }
  assert.equal(evaluated, false);
});
