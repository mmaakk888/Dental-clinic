import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { composeCloudReleaseRules } from '../../scripts/build-cloud-release-rules.mjs';

const base = readFileSync('rules/base.release.rules', 'utf8').replace(/\r\n/g, '\n');
const fragments = Object.fromEntries(['prosthetic', 'expense', 'settings'].map(kind =>
  [kind, readFileSync(`rules/${kind}.release.rules.fragment`, 'utf8').replace(/\r\n/g, '\n')]));

test('combined Rules source contains exactly the reviewed domain fragments and preserves regex replacement tokens verbatim', () => {
  const result = composeCloudReleaseRules(base, fragments);
  for (const fragment of Object.values(fragments)) assert.equal(result.split(fragment).length, 2);
  assert.equal(result.split('match /{document=**} { allow read, write: if false; }').length, 2);
  assert.match(result, /d.kind == 'expense' \? d.command.createdAt==d.createdAt && ex_preparedExpense/);
  assert.match(result, /d.kind == 'settings' \? d.command.createdAt==d.createdAt && st_preparedSettings/);
  assert.ok(result.includes(".data.kind=='prosthetic'?pr_patientAccountWrite(resource,request.resource.data,id):clinicalAccountWrite(resource,request.resource.data,id)"));
  assert.ok(Buffer.byteLength(result) <= 256 * 1024);
  const withRegex = { ...fragments, settings: fragments.settings + "\n    // Replacement safety fixture: $' $& $$ $`\n" };
  assert.ok(composeCloudReleaseRules(base, withRegex).includes(withRegex.settings));
});

test('Rules generation rejects already-composed base, missing fragment, broad wildcard fragment or an unrecognized companion hook', () => {
  assert.throws(() => composeCloudReleaseRules(composeCloudReleaseRules(base, fragments), fragments));
  assert.throws(() => composeCloudReleaseRules(base, { expense: fragments.expense }));
  assert.throws(() => composeCloudReleaseRules(base, { ...fragments, expense: fragments.expense + '\nmatch /{document=**} { allow read: if true; }' }));
  assert.throws(() => composeCloudReleaseRules(base.replace('clinicalCash(request.resource.data,id)', 'UNKNOWN'), fragments));
});
