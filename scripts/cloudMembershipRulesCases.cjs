'use strict';

/**
 * Synthetic fixtures for the official Rules projects.test request format.
 * This module performs no I/O, requests, authentication or production writes.
 * All users and records below are fabricated, not the clinic owner's account.
 *
 * Every case supplies resource.data; the candidate rules must contain no
 * service-provided document lookups. REST Rules tests are not a local emulator
 * and may consume project/API quota. Invocation and deployment are separate.
 * https://firebase.google.com/docs/reference/rules/rest/v1/projects/test
 * https://firebase.google.com/docs/rules/manage-deploy#test_your_updates_with_rest
 */
const MAX_SAFE_INTEGER = 9007199254740991;
const SYNTHETIC_UID = 'synthetic-owner-rules-check';
const BASE_PATH = `/databases/(default)/documents/clinics/main/members/${SYNTHETIC_UID}`;

function fixture() {
  return {
    expectation: 'ALLOW',
    pathEncoding: 'PLAIN',
    expressionReportLevel: 'NONE',
    request: {
      path: BASE_PATH,
      method: 'get',
      auth: {
        uid: SYNTHETIC_UID,
        token: {
          email_verified: true,
          firebase: { sign_in_provider: 'password' },
          dentalClinicId: 'main',
          dentalClinicRole: 'owner',
          auth_time: 1800000000,
        },
      },
    },
    resource: {
      data: {
        schemaVersion: 1,
        clinicId: 'main',
        uid: SYNTHETIC_UID,
        role: 'owner',
        status: 'active',
        identityVersion: 1,
        verifiedAfter: 1799999999,
      },
    },
  };
}

function buildNamedCases() {
  const cases = [];
  const add = (name, expectation, mutate = () => {}) => {
    const testCase = fixture();
    testCase.expectation = expectation;
    mutate(testCase);
    cases.push({ name, testCase });
  };

  add('verified password owner reads exact active self membership', 'ALLOW');
  add('auth_time equal to verifiedAfter is accepted', 'ALLOW', c => { c.resource.data.verifiedAfter = c.request.auth.token.auth_time; });
  add('zero verifiedAfter and auth_time are accepted', 'ALLOW', c => { c.resource.data.verifiedAfter = 0; c.request.auth.token.auth_time = 0; });
  add('safe upper integer bounds are accepted', 'ALLOW', c => {
    c.resource.data.identityVersion = MAX_SAFE_INTEGER;
    c.resource.data.verifiedAfter = MAX_SAFE_INTEGER;
    c.request.auth.token.auth_time = MAX_SAFE_INTEGER;
  });

  add('anonymous request', 'DENY', c => { c.request.auth = null; });
  add('missing auth context', 'DENY', c => { delete c.request.auth; });
  add('different signed-in UID cannot read another member', 'DENY', c => { c.request.auth.uid = 'synthetic-other-user'; });
  add('empty signed-in UID', 'DENY', c => { c.request.auth.uid = ''; });
  add('oversized signed-in UID', 'DENY', c => {
    c.request.auth.uid = 'x'.repeat(129);
    c.request.path = `/databases/(default)/documents/clinics/main/members/${c.request.auth.uid}`;
    c.resource.data.uid = c.request.auth.uid;
  });
  add('missing token map', 'DENY', c => { delete c.request.auth.token; });

  for (const key of ['email_verified', 'firebase', 'dentalClinicId', 'dentalClinicRole', 'auth_time']) {
    add(`missing token ${key}`, 'DENY', c => { delete c.request.auth.token[key]; });
  }
  for (const value of [false, 'true', 1, null]) {
    add(`email_verified wrong value ${JSON.stringify(value)}`, 'DENY', c => { c.request.auth.token.email_verified = value; });
  }
  add('missing sign-in provider', 'DENY', c => { c.request.auth.token.firebase = {}; });
  for (const value of ['google.com', 'custom', 'anonymous', 'phone', 'PASSWORD', '', null]) {
    add(`sign-in provider ${JSON.stringify(value)}`, 'DENY', c => { c.request.auth.token.firebase.sign_in_provider = value; });
  }
  for (const value of [null, [], 'password', 1]) {
    add(`firebase token map wrong shape ${JSON.stringify(value)}`, 'DENY', c => { c.request.auth.token.firebase = value; });
  }
  for (const value of ['other-clinic', '', null, 1]) {
    add(`clinic claim ${JSON.stringify(value)}`, 'DENY', c => { c.request.auth.token.dentalClinicId = value; });
  }
  for (const value of ['secretary', 'doctor', 'OWNER', '', null, true]) {
    add(`role claim ${JSON.stringify(value)}`, 'DENY', c => { c.request.auth.token.dentalClinicRole = value; });
  }
  for (const value of [-1, 1.5, '1800000000', null, MAX_SAFE_INTEGER + 1]) {
    add(`auth_time invalid ${JSON.stringify(value)}`, 'DENY', c => { c.request.auth.token.auth_time = value; });
  }
  add('previous sign-in is before revocation cutoff', 'DENY', c => { c.request.auth.token.auth_time = c.resource.data.verifiedAfter - 1; });

  for (const key of Object.keys(fixture().resource.data)) {
    add(`missing membership ${key}`, 'DENY', c => { delete c.resource.data[key]; });
  }
  add('membership has unexpected permissions field', 'DENY', c => { c.resource.data.permissions = { admin: true }; });
  add('membership data absent', 'DENY', c => { delete c.resource.data; });
  add('membership data null', 'DENY', c => { c.resource.data = null; });
  add('membership data list', 'DENY', c => { c.resource.data = []; });
  for (const value of [0, 2, 1.5, '1', null, true]) {
    add(`schemaVersion invalid ${JSON.stringify(value)}`, 'DENY', c => { c.resource.data.schemaVersion = value; });
  }
  for (const [key, values] of [
    ['clinicId', ['other-clinic', null]],
    ['uid', ['synthetic-other-user', null]],
    ['role', ['secretary', 'doctor', null]],
    ['status', ['disabled', 'revoked', 'pending', null]],
  ]) {
    for (const value of values) {
      add(`membership ${key} invalid ${JSON.stringify(value)}`, 'DENY', c => { c.resource.data[key] = value; });
    }
  }
  for (const value of [0, -1, 1.5, '1', null, true, MAX_SAFE_INTEGER + 1]) {
    add(`identityVersion invalid ${JSON.stringify(value)}`, 'DENY', c => { c.resource.data.identityVersion = value; });
  }
  for (const value of [-1, 1.5, '1799999999', null, true, MAX_SAFE_INTEGER + 1]) {
    add(`verifiedAfter invalid ${JSON.stringify(value)}`, 'DENY', c => { c.resource.data.verifiedAfter = value; });
  }

  for (const method of ['list', 'create', 'update', 'delete']) {
    add(`self membership ${method} forbidden`, 'DENY', c => {
      c.request.method = method;
      if (method === 'create' || method === 'update') c.request.resource = { data: { ...c.resource.data } };
    });
  }
  const forbiddenPaths = [
    '/databases/(default)/documents/clinics/main',
    '/databases/(default)/documents/clinics/main/members',
    '/databases/(default)/documents/clinics/main/members/synthetic-other-user',
    `/databases/(default)/documents/clinics/other-clinic/members/${SYNTHETIC_UID}`,
    `/databases/other-database/documents/clinics/main/members/${SYNTHETIC_UID}`,
    '/databases/(default)/documents/clinics/main/patients/synthetic-patient',
    '/databases/(default)/documents/clinics/main/finances/synthetic-finance',
    '/databases/(default)/documents/patients/synthetic-patient',
    `/databases/(default)/documents/clinics/main/members/${SYNTHETIC_UID}/private/synthetic-private`,
    `/databases/(default)/documents/users/${SYNTHETIC_UID}`,
  ];
  for (const path of forbiddenPaths) {
    add(`path forbidden ${path}`, 'DENY', c => { c.request.path = path; });
  }
  add('member collection query forbidden', 'DENY', c => { c.request.method = 'list'; c.request.path = '/databases/(default)/documents/clinics/main/members'; });
  add('member collection group query forbidden', 'DENY', c => { c.request.method = 'list'; c.request.path = '/databases/(default)/documents/members'; });
  return cases;
}

const namedCases = buildNamedCases();
const testSuite = { testCases: namedCases.map(({ testCase }) => testCase) };

module.exports = { SYNTHETIC_UID, BASE_PATH, buildNamedCases, namedCases, testSuite };
