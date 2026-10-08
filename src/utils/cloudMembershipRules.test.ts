import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { namedCases, testSuite } = require('../../scripts/cloudMembershipRulesCases.cjs');

test('membership deployment config targets only the default Firestore rule source', () => {
  const config = JSON.parse(readFileSync(new URL('../../firebase.membership.json', import.meta.url), 'utf8'));
  assert.deepEqual(config, { firestore: { database: '(default)', rules: 'firestore.membership.rules' } });
  const closed = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
  assert.match(closed, /allow read, write: if false/u);
  assert.doesNotMatch(closed, /if true|request\.auth/u);
});

test('membership rules allow only self get and cannot perform production document lookups', () => {
  const rules = readFileSync(new URL('../../firestore.membership.rules', import.meta.url), 'utf8');
  assert.doesNotMatch(rules, /\b(?:get|exists|getAfter|existsAfter)\s*\(/u);
  assert.match(rules, /match \/clinics\/main\/members\/\{uid\}/u);
  assert.match(rules, /allow get: if database == '\(default\)'/u);
  assert.match(rules, /allow list, create, update, delete: if false/u);
  assert.match(rules, /allow read, write: if false/u);
});

test('Rules API fixtures are synthetic, explicit and independent; this does not evaluate live rules', () => {
  assert.equal(namedCases.length, 104);
  assert.equal(testSuite.testCases.length, namedCases.length);
  assert.equal(new Set(namedCases.map((entry: { name: string }) => entry.name)).size, namedCases.length);
  assert.equal(namedCases.filter((entry: any) => entry.testCase.expectation === 'ALLOW').length, 4);
  assert.equal(namedCases.filter((entry: any) => entry.testCase.expectation === 'DENY').length, 100);
  for (const { testCase } of namedCases) {
    assert.ok(Object.hasOwn(testCase, 'resource'));
    assert.equal(testCase.pathEncoding, 'PLAIN');
    assert.match(testCase.request.path, /^\/databases\//u);
    assert.equal(testCase.functionMocks, undefined);
  }
  const serialized = JSON.stringify(testSuite);
  assert.doesNotMatch(serialized, /@/u);
  assert.equal(namedCases[0].testCase.resource.data.status, 'active');
});
