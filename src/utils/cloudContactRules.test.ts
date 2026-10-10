import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { normalizeContactPhone, clinicContactValidationError } from './clinicContacts';

const require = createRequire(import.meta.url);
const { namedCases, buildNamedCases, ROOT, UID } = require('../../scripts/cloudContactRulesCases.cjs');
const source = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('contact rules remain a separate staged default-database configuration, not a Hosting deployment', () => {
  assert.deepEqual(JSON.parse(source('firebase.contacts-stage.json')), { firestore: { database: '(default)', rules: 'firestore.contacts-stage.rules' } });
  assert.deepEqual(JSON.parse(source('firebase.membership.json')), { firestore: { database: '(default)', rules: 'firestore.membership.rules' } });
  assert.doesNotMatch(source('firestore.membership.rules'), /contactRecords|contactOperations|contactPhones/u);
  assert.match(source('firestore.rules'), /allow read, write: if false/u);
});

test('candidate derives phone index hashes and denies physical record deletion and receipt mutation', () => {
  const rules = source('firestore.contacts-stage.rules');
  assert.match(rules, /hashing\.sha256\('contact-phone-v1:' \+ canonical/u);
  assert.match(rules, /toHexString\(\)\.lower\(\)/u);
  assert.match(rules, /allow delete: if false/u);
  assert.match(rules, /allow list, update, delete: if false/u);
  assert.match(rules, /!exists\(operationPath\(after.lastOperationId\)\)/u);
  assert.match(rules, /data.phoneKey == phone.key/u);
  assert.match(rules, /!existsAfter\(phonePath\(oldKey\)\)/u);
  assert.match(rules, /allow read, write: if false/u);
});

test('emulator cases are synthetic, independent and have explicit allow and deny expectations', () => {
  assert.equal(namedCases.length, 416);
  assert.equal(new Set(namedCases.map((entry: any) => entry.name)).size, namedCases.length);
  const again = buildNamedCases();
  const create = again.find((entry: any) => entry.name === 'create/contactRecords/create valid atomic context');
  assert.ok(create); assert.equal(create.expectation, 'ALLOW');
  assert.equal(create.state.auth.uid, UID); assert.match(UID, /^synthetic-/u);
  assert.ok(Object.keys(create.state.before).every(path => path.startsWith(`${ROOT}/`)));
  assert.ok(namedCases.some((entry: any) => entry.expectation === 'DENY'));
  create.state.auth.token.email_verified = false;
  assert.equal(namedCases.find((entry: any) => entry.name === create.name).state.auth.token.email_verified, true);
  assert.doesNotMatch(JSON.stringify(namedCases), /mmaakk888|@gmail|vkl5dm5E/u);
});

test('phone parity fixtures independently agree with actual application normalization and hash keys', () => {
  for (const entry of namedCases.filter((entry: any) => entry.name.startsWith('phone parity'))) {
    const row: any = Object.entries(entry.state.after).find(([path]) => path.includes('/contactRecords/'))?.[1];
    const canonical = normalizeContactPhone(row.data.data.mobile);
    if (entry.expectation === 'ALLOW') {
      assert.ok(canonical, entry.name);
      const hash = createHash('sha256').update(`contact-phone-v1:${canonical}`).digest('hex');
      assert.ok(entry.state.after[`${ROOT}/contactPhones/${hash}`], entry.name);
    } else assert.equal(canonical, '', entry.name);
  }
});

test('positive contact fixtures preserve ordinary ISO string dates accepted by the repository codec', () => {
  for (const entry of namedCases.filter((entry: any) => entry.state && entry.expectation === 'ALLOW')) {
    for (const [path, row] of Object.entries<any>(entry.state.after)) {
      if (!path.includes('/contactRecords/') || row.data.deleted) continue;
      assert.equal(typeof row.data.data.createdAt, 'string');
      assert.equal(clinicContactValidationError(row.data.data), null, entry.name);
    }
  }
});

test('emulator runner is explicit loopback/demo only and cannot use IAM or publish rules', () => {
  const runner = source('scripts/test-cloud-contact-emulator.ts');
  assert.match(runner, /process\.argv\[2\] !== '--demo-emulator'/u);
  assert.match(runner, /const PROJECT = 'demo-clinic-contact-rules'/u);
  assert.match(runner, /const BASE = 'http:\/\/127\.0\.0\.1:8787'/u);
  assert.match(runner, /assert.equal\(url.origin, BASE\)/u);
  assert.match(runner, /connectFirestoreEmulator/u);
  assert.doesNotMatch(runner, /requireAuth|firebase-admin|cloudbilling|firebaserules.googleapis|dental-clinic-mmaakk888/u);
  assert.match(runner, /stringValue: value/u);
});

test('atomic negative cases include every coupled document and forbidden-domain boundary', () => {
  const names = new Set(namedCases.map((entry: any) => entry.name));
  for (const name of ['create rejects missing receipt', 'create rejects reused receipt', 'create rejects missing phone',
    'update rejects changed createdAt', 'update rejects tombstone revival', 'move requires old phone release',
    'move requires new phone reservation', 'delete requires phone release', 'standalone receipt denied',
    'standalone index create denied', 'standalone index update denied', 'standalone index delete denied',
    'cannot reassign existing phone index', 'physical record delete is denied']) assert.ok(names.has(name), name);
  assert.ok(namedCases.some((entry: any) => entry.name.includes('labPrivate')));
  assert.ok(namedCases.some((entry: any) => entry.name.includes('canonical secretary')));
});

test('control validation uses whole-string allowed sets, including multi-line note negatives', () => {
  const rules = source('firestore.contacts-stage.rules');
  assert.doesNotMatch(rules, /!\w+(?:\.\w+)*\.matches\('\.\*/u);
  assert.ok(namedCases.some((entry: any) => entry.name === 'allows notes newline tab and carriage return'));
  assert.ok(namedCases.some((entry: any) => entry.name.startsWith('reject contact notes=') && entry.name.includes('u0001')));
});

test('only owner contact-record paging gains an integer 1–50 bound; companions and domains stay closed', () => {
  const rules = source('firestore.contacts-stage.rules');
  assert.match(rules, /allow list: if owner\(\) && 'limit' in request.query\s*&& request.query.limit is int && request.query.limit >= 1 && request.query.limit <= 50/u);
  assert.equal((rules.match(/allow list: if owner\(\)/gu) || []).length, 1);
  const names = new Set(namedCases.map((entry: any) => entry.name));
  for (const name of ['owner bounded contact list 1', 'owner bounded contact list 25', 'owner bounded contact list 50',
    'owner contact list with UUID cursor', 'owner empty bounded contact list', 'owner bounded contact list includes tombstones',
    'contact list unbounded denied', 'contact list excessive limit denied', 'bounded contact list rejects anonymous',
    'bounded contact list rejects secretary claim', 'bounded contact list rejects canonical secretary',
    'bounded contact list rejects membership disabled', 'bounded contact list rejects stale auth_time',
    'bounded nondefault database contact list denied', 'bounded other clinic contact list denied',
    'bounded contactPhones list remains denied', 'bounded contactOperations list remains denied']) assert.ok(names.has(name), name);
  const boundary = namedCases.filter((entry: any) => entry.state?.queryBoundary);
  assert.equal(boundary.length, 5);
  assert.ok(boundary.every((entry: any) => entry.expectation === 'DENY'));
  const runner = source('scripts/test-cloud-contact-emulator.ts');
  assert.match(runner, /rulesEngineCases: contactCases.length - queryBoundaryPassed/u);
  assert.match(runner, /orderBy\(documentId\(\)\)/u);
  assert.match(runner, /startAfter\(spec.afterId\)/u);
  assert.match(runner, /stable document-ID cursor pages have no gap or duplicate/u);
  assert.match(runner, /pages include tombstones rather than silently skipping cursors/u);
});
