import test from 'node:test';
import assert from 'node:assert/strict';
import { CLOUD_CLINIC_ID, CLOUD_PROJECT_ID, assessCloudOwnerIdentity } from './cloudIdentity';

type IdentityInput = Parameters<typeof assessCloudOwnerIdentity>[0];

function syntheticOwner(): IdentityInput {
  return {
    uid: 'synthetic-owner-uid',
    email: 'Owner@example.invalid',
    emailVerified: true,
    token: {
      signInProvider: 'password',
      claims: {
        sub: 'synthetic-owner-uid',
        aud: CLOUD_PROJECT_ID,
        iss: `https://securetoken.google.com/${CLOUD_PROJECT_ID}`,
        email: 'owner@example.invalid',
        email_verified: true,
        dentalClinicId: CLOUD_CLINIC_ID,
        dentalClinicRole: 'owner',
      },
    },
  };
}

function assertRejected(input: unknown): void {
  assert.throws(() => assessCloudOwnerIdentity(input as IdentityInput), error => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /[\u0600-\u06ff]/u);
    assert.ok(error.message.length < 100);
    assert.equal(error.message.includes('example.invalid'), false);
    return true;
  });
}

test('cloud identity constants target only the new clinic project', () => {
  assert.equal(CLOUD_PROJECT_ID, 'osama-clinic-38706');
  assert.equal(CLOUD_CLINIC_ID, 'main');
});

test('matching synthetic owner identity with both email checks returns diagnostic confirmation only', () => {
  const input = syntheticOwner();
  const before = structuredClone(input);
  assert.deepEqual(assessCloudOwnerIdentity(input), {
    uid: input.uid,
    email: input.email,
    status: 'owner-confirmed',
  });
  assert.deepEqual(input, before);
});

test('email verification remains pending unless SDK and token both report boolean true', () => {
  for (const [sdkVerified, tokenVerified] of [
    [false, false], [false, true], [true, false], [true, undefined], [true, 'true'], [true, 1], ['true', true],
  ]) {
    const input = syntheticOwner();
    input.emailVerified = sdkVerified as boolean;
    input.token.claims.email_verified = tokenVerified;
    assert.equal(assessCloudOwnerIdentity(input).status, 'verification-required');
  }
});

test('UID accepts the maximum length and rejects empty, unbounded or malformed values', () => {
  const boundary = syntheticOwner();
  boundary.uid = 'u'.repeat(128);
  boundary.token.claims.sub = boundary.uid;
  assert.equal(assessCloudOwnerIdentity(boundary).uid.length, 128);
  for (const uid of ['', ' ', ' u', 'u ', 'u\n', 'u\u0000', 'u'.repeat(129), null, 7]) {
    const input = syntheticOwner();
    input.uid = uid as string;
    input.token.claims.sub = uid;
    assertRejected(input);
  }
});

for (const [name, claim, value] of [
  ['mismatched subject', 'sub', 'other-synthetic-owner'],
  ['missing subject', 'sub', undefined],
  ['numeric subject', 'sub', 1],
  ['other project', 'aud', 'other-synthetic-project'],
  ['previous project audience', 'aud', 'dental-clinic-mmaakk888'],
  ['array audience', 'aud', [CLOUD_PROJECT_ID]],
  ['missing audience', 'aud', undefined],
  ['other issuer', 'iss', 'https://securetoken.google.com/other-synthetic-project'],
  ['previous project issuer', 'iss', 'https://securetoken.google.com/dental-clinic-mmaakk888'],
  ['lookalike issuer', 'iss', `https://securetoken.google.com.attacker.invalid/${CLOUD_PROJECT_ID}`],
  ['issuer trailing slash', 'iss', `https://securetoken.google.com/${CLOUD_PROJECT_ID}/`],
  ['missing issuer', 'iss', undefined],
  ['secretary role', 'dentalClinicRole', 'secretary'],
  ['admin role', 'dentalClinicRole', 'admin'],
  ['missing role', 'dentalClinicRole', undefined],
  ['array role', 'dentalClinicRole', ['owner']],
  ['another clinic', 'dentalClinicId', 'other-synthetic-clinic'],
  ['missing clinic', 'dentalClinicId', undefined],
  ['mismatched email', 'email', 'other@example.invalid'],
  ['missing token email', 'email', undefined],
  ['empty token email', 'email', ''],
  ['whitespace token email', 'email', ' '],
  ['malformed token email', 'email', { address: 'owner@example.invalid' }],
] as const) {
  test(`cloud identity rejects ${name}`, () => {
    const input = syntheticOwner();
    input.token.claims[claim] = value;
    assertRejected(input);
  });
}

test('cloud identity accepts only the password sign-in provider', () => {
  for (const provider of [null, '', 'google.com', 'anonymous', 'custom', 'Password', ['password']]) {
    const input = syntheticOwner();
    input.token.signInProvider = provider as string;
    assertRejected(input);
  }
});

test('cloud identity requires a nonempty SDK email matching the token case-insensitively', () => {
  for (const email of [null, '', ' ', 'other@example.invalid', ' owner@example.invalid', 7]) {
    const input = syntheticOwner();
    input.email = email as string;
    assertRejected(input);
  }
});

test('malformed identity, token or claims objects fail closed with an Arabic error', () => {
  for (const input of [null, undefined, {}, [], 'owner']) assertRejected(input);
  for (const token of [null, undefined, [], 'token']) assertRejected({ ...syntheticOwner(), token });
  for (const claims of [null, undefined, [], 'claims', 7]) {
    const input = syntheticOwner();
    input.token.claims = claims as unknown as Record<string, unknown>;
    assertRejected(input);
  }
});

test('inherited or accessor claims cannot establish ownership', () => {
  const inherited = syntheticOwner();
  inherited.token.claims = Object.create(inherited.token.claims);
  assertRejected(inherited);

  const accessor = syntheticOwner();
  Object.defineProperty(accessor.token.claims, 'dentalClinicRole', {
    get() { throw new Error('Must not evaluate untrusted claim accessors'); },
  });
  assertRejected(accessor);
});

test('matching verified email never infers an owner role or clinic membership', () => {
  for (const missingClaim of ['dentalClinicRole', 'dentalClinicId']) {
    const input = syntheticOwner();
    delete input.token.claims[missingClaim];
    assertRejected(input);
  }
  const input = syntheticOwner();
  delete input.token.claims.dentalClinicRole;
  input.token.claims.admin = true;
  input.token.claims.role = 'owner';
  assertRejected(input);
});
