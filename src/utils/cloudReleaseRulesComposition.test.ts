import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { composeCloudReleaseRules, composeUnscopedCloudReleaseRules } from '../../scripts/build-cloud-release-rules.mjs';
import { scopeCloudReleaseRules, verifyCloudReleaseRulesScopeEquivalence } from '../../scripts/scope-cloud-release-rules.mjs';

const base = readFileSync('rules/base.release.rules', 'utf8').replace(/\r\n/g, '\n');
const fragments = Object.fromEntries(['prosthetic', 'expense', 'settings'].map(kind =>
  [kind, readFileSync(`rules/${kind}.release.rules.fragment`, 'utf8').replace(/\r\n/g, '\n')]));

const raw = composeUnscopedCloudReleaseRules(base, fragments);
const result = composeCloudReleaseRules(base, fragments);
const sha = (value: string) => createHash('sha256').update(value).digest('hex');

test('public deterministic generator reproduces the source-only compiler-qualified global-LCA candidate', () => {
  assert.equal(sha(raw), 'dd789948b46b69be97e9c2ac64489e8208096f17d7c3a6f5694e289e97fb92dd');
  assert.equal(sha(result), '9a2a2788cf6ab5a1b417b9f9629afadfc775582b036bc46f2d1c61012e0f4eb2');
  assert.equal(Buffer.byteLength(result), 150847);
  assert.equal(readFileSync('firestore.release.rules', 'utf8').replace(/\r\n/g, '\n'), result);
  assert.equal(composeCloudReleaseRules(base, Object.fromEntries(Object.entries(fragments).reverse())), result);
});

test('scope relocation preserves every reachable predicate, allow body, effective path and lexical call binding', () => {
  const { source, audit } = scopeCloudReleaseRules(raw, fragments);
  assert.equal(source, result);
  assert.equal(audit.originalFunctions, 287);
  assert.equal(audit.reachableFunctions, 274);
  assert.equal(audit.checkedCalls, 1207);
  assert.equal(audit.wildcardChecks, 207);
  assert.equal(audit.newFreeWildcardCaptures, 0);
  for (const property of ['everyReachableFunctionDefinedOnce', 'exactReachableFunctionBodies', 'exactAllowBodies',
    'effectiveGrantPathsEqual', 'everyUserFunctionCallResolvedToOriginalBody']) assert.equal(audit[property], true);
  assert.equal(audit.removedUnreachable.length, 13);
  assert.equal(audit.maxLeafVisibleFunctions, 103);
  assert.deepEqual(verifyCloudReleaseRulesScopeEquivalence(raw, source), audit);
});

test('only the actual cross-domain common dependency closure remains global; every reachable definition occurs once', () => {
  const audit = scopeCloudReleaseRules(raw, fragments).audit;
  assert.equal(audit.rootFunctions, 27);
  assert.deepEqual(audit.sharedRootNames, ['activeOwner', 'anyPath', 'asciiDigits', 'boundedQuery', 'calendarDay', 'coupledIntent',
    'day', 'domainReceiptPath', 'ex_imageMeta', 'ex_text', 'exact', 'expected', 'hash', 'intentPath', 'longText', 'money',
    'nameKey', 'owner', 'patientPositiveNumber', 'pr_command', 'pr_fresh', 'receiptCollection', 'revision', 'singletonPath',
    'trimSpaces', 'uuid', 'verifiedOwner']);
  const names = [...result.matchAll(/\bfunction\s+([A-Za-z_]\w*)\s*\(/g)].map(match => match[1]);
  assert.equal(names.length, 274); assert.equal(new Set(names).size, names.length);
  assert.equal(result.match(/match \/clinics\/main \{/g)?.length, 4);
  assert.equal(result.split('match /{document=**} { allow read, write: if false; }').length, 2);
});

test('all command and clinical companion hooks remain exact after relocation', () => {
  for (const kind of ['prosthetic', 'expense', 'settings']) assert.ok(result.includes(`d.kind == '${kind}' ? d.command.createdAt==d.createdAt && `));
  for (const [clinical, prosthetic] of [['clinicalAccountWrite', 'pr_patientAccountWrite'], ['clinicalSessionWrite', 'pr_patientSessionWrite']]) {
    assert.ok(result.includes(`.data.kind=='prosthetic'?${prosthetic}(resource,request.resource.data,id):${clinical}(resource,request.resource.data,id)`));
  }
  assert.ok(result.includes(".data.kind=='prosthetic'?pr_patientCash(request.resource.data,id):clinicalCash(request.resource.data,id)"));
});

test('raw composition and relocated function copies preserve regex replacement tokens and quoted braces verbatim', () => {
  const comment = "// Replacement safety fixture: $' $& $$ $` '{not-a-scope}'";
  const withRegex = { ...fragments, settings: fragments.settings.replace('function st_preparedSettings(c) {', () => `function st_preparedSettings(c) {\n${comment}`) };
  const nextRaw = composeUnscopedCloudReleaseRules(base, withRegex), next = composeCloudReleaseRules(base, withRegex);
  assert.ok(nextRaw.includes(withRegex.settings)); assert.ok(next.includes(comment));
  assert.equal(verifyCloudReleaseRulesScopeEquivalence(nextRaw, next).exactReachableFunctionBodies, true);
});

test('unreachable helpers are removed without adding predicates or unrelated global helpers', () => {
  const extra = { ...fragments, settings: fragments.settings + '\nfunction st_unusedCompositionProbe() { return false; }\n' };
  const source = composeUnscopedCloudReleaseRules(base, extra), scoped = scopeCloudReleaseRules(source, extra);
  assert.ok(scoped.audit.removedUnreachable.includes('st_unusedCompositionProbe'));
  assert.doesNotMatch(scoped.source, /function st_unusedCompositionProbe/);
  assert.equal(scoped.source, result);
});

test('Rules generation rejects already-composed base, missing fragment, broad wildcard fragment or an unrecognized companion hook', () => {
  assert.throws(() => composeCloudReleaseRules(composeCloudReleaseRules(base, fragments), fragments));
  assert.throws(() => composeCloudReleaseRules(raw, fragments));
  assert.throws(() => composeCloudReleaseRules(base, { expense: fragments.expense }));
  assert.throws(() => composeCloudReleaseRules(base, { ...fragments, expense: fragments.expense + '\nmatch /{document=**} { allow read: if true; }' }));
  assert.throws(() => composeCloudReleaseRules(base.replace('clinicalCash(request.resource.data,id)', 'UNKNOWN'), fragments));
});

test('nested broad wildcards, outside paths, duplicate leaves and unknown fragment names fail closed', () => {
  for (const path of ['/clinics/main/expenseRecords/{document=**}', '/outside/{id}', '/clinics/main/invoiceImages/{id}']) {
    assert.throws(() => composeCloudReleaseRules(base, { ...fragments, expense: fragments.expense + `\nmatch ${path} { allow get: if owner(); }` }));
  }
  assert.throws(() => composeCloudReleaseRules(base, { ...fragments, unknown: fragments.settings }));
});

test('verification rejects changed financial predicates, allow grants, extra definitions and missing helpers', () => {
  assert.throws(() => verifyCloudReleaseRulesScopeEquivalence(raw, result.replace('return st_proofBase(', 'return true || st_proofBase(')), /Changed predicate/);
  assert.throws(() => verifyCloudReleaseRulesScopeEquivalence(raw, result.replace('allow get: if owner() && uuid(id);', 'allow get: if true;')), /Changed allow/);
  assert.throws(() => verifyCloudReleaseRulesScopeEquivalence(raw, result + '\nfunction extraCompositionProbe() { return true; }'), /extra helper/);
  assert.throws(() => verifyCloudReleaseRulesScopeEquivalence(raw, result.replace('function st_proofWrite(', 'function renamedCompositionProbe(')), /Reachable helper/);
});

test('exact function text is insufficient when a dependency is relocated into an inaccessible sibling', () => {
  const head = "rules_version = '2'; service cloud.firestore { match /databases/{database}/documents {";
  const shared = 'function sharedProbe() { return true; }', caller = 'function callerProbe() { return sharedProbe(); }';
  const first = 'match /clinics/main/first/{id} { allow get: if callerProbe(); }';
  const second = 'match /clinics/main/second/{id} { allow get: if false; }';
  const before = `${head}${shared}${caller}${first}${second}}}`;
  const after = `${head}${first.replace('{ allow', `{ ${caller} allow`)}${second.replace('{ allow', `{ ${shared} allow`)}}}`;
  assert.throws(() => verifyCloudReleaseRulesScopeEquivalence(before, after), /Unresolved helper sharedProbe/);
});

test('relocation refuses to turn an unbound wildcard name into a newly captured authorization input', () => {
  const risk = { ...fragments, settings: fragments.settings.replace('allow get: if owner() && id.matches(',
    'allow get: if owner() && st_wildcardCompositionProbe() && id.matches(')
    + "\nfunction st_wildcardCompositionProbe() { return id == 'synthetic'; }\n" };
  assert.throws(() => composeCloudReleaseRules(base, risk), /New free wildcard capture/);
});

test('explicit wildcard parameters retain their original binding without a false-positive capture rejection', () => {
  const safe = { ...fragments, settings: fragments.settings.replace('allow get: if owner() && id.matches(',
    'allow get: if owner() && st_wildcardCompositionProbe(id) && id.matches(')
    + "\nfunction st_wildcardCompositionProbe(id) { return id != ''; }\n" };
  const before = composeUnscopedCloudReleaseRules(base, safe), after = composeCloudReleaseRules(base, safe);
  assert.equal(verifyCloudReleaseRulesScopeEquivalence(before, after).newFreeWildcardCaptures, 0);
});

test('public structural helper is pure and has no private fixtures, administrative authentication or RPC dependencies', () => {
  const source = readFileSync('scripts/scope-cloud-release-rules.mjs', 'utf8');
  assert.doesNotMatch(source, /node:(?:fs|vm)|(?:requireAuth|fetch|readFileSync|writeFileSync)\s*\(|\.firebase[\\/]/);
});
