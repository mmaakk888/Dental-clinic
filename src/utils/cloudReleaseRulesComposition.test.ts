import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { composeCloudReleaseRules, composeUnscopedCloudReleaseRules } from '../../scripts/build-cloud-release-rules.mjs';
import { scopeCloudReleaseRules, verifyCloudReleaseRulesScopeEquivalence } from '../../scripts/scope-cloud-release-rules.mjs';
import { compactCloudRuleSymbols } from '../../scripts/compact-cloud-rule-symbols.mjs';

const base = readFileSync('rules/base.release.rules', 'utf8').replace(/\r\n/g, '\n');
const fragments = Object.fromEntries(['prosthetic', 'expense', 'settings'].map(kind =>
  [kind, readFileSync(`rules/${kind}.release.rules.fragment`, 'utf8').replace(/\r\n/g, '\n')]));

const raw = composeUnscopedCloudReleaseRules(base, fragments);
const result = scopeCloudReleaseRules(raw, fragments).source;
const deployedResult = composeCloudReleaseRules(base, fragments);
const sha = (value: string) => createHash('sha256').update(value).digest('hex');

test('public deterministic generator compacts the exact engine-qualified global-LCA source', () => {
  assert.equal(sha(raw), 'dd789948b46b69be97e9c2ac64489e8208096f17d7c3a6f5694e289e97fb92dd');
  assert.equal(sha(result), '9a2a2788cf6ab5a1b417b9f9629afadfc775582b036bc46f2d1c61012e0f4eb2');
  assert.equal(sha(deployedResult), 'dff8efe554b10d0e3e087adc82accd65da58a1d1df4f8ac42cf0b80390e44f31');
  assert.equal(Buffer.byteLength(deployedResult), 138067);
  assert.equal(readFileSync('firestore.release.rules', 'utf8').replace(/\r\n/g, '\n'), deployedResult);
  assert.equal(composeCloudReleaseRules(base, Object.fromEntries(Object.entries(fragments).reverse())), deployedResult);
  assert.equal(compactCloudRuleSymbols(result).restoredExactly, true);
});

test('scope relocation preserves every reachable predicate, allow body, effective path and lexical call binding', () => {
  const { source, audit } = scopeCloudReleaseRules(raw, fragments);
  assert.equal(source, result);
  assert.equal(audit.originalFunctions, 287);
  assert.equal(audit.reachableFunctions, 274);
  assert.equal(audit.definitionCopies, 274);
  assert.equal(audit.checkedCalls, 1207);
  assert.equal(audit.wildcardChecks, 207);
  assert.equal(audit.newFreeWildcardCaptures, 0);
  for (const property of ['helperCopiesOnlyInDistinctLexicalScopes', 'exactReachableFunctionBodies', 'exactAllowBodies',
    'effectiveGrantPathsEqual', 'everyUserFunctionCallResolvedToOriginalBody']) assert.equal(audit[property], true);
  assert.equal(audit.removedUnreachable.length, 13);
  assert.equal(audit.maxLeafVisibleFunctions, 103);
  assert.equal(audit.everyReachableFunctionDefinedOnce, true);
  assert.deepEqual(verifyCloudReleaseRulesScopeEquivalence(raw, source), audit);
});

test('shared helper dependencies remain global and every reachable function is defined once', () => {
  const audit = scopeCloudReleaseRules(raw, fragments).audit;
  assert.equal(audit.rootFunctions, 27);
  for (const name of ['activeOwner', 'owner', 'verifiedOwner']) assert.ok(audit.sharedRootNames.includes(name));
  const names = [...result.matchAll(/\bfunction\s+([A-Za-z_]\w*)\s*\(/g)].map(match => match[1]);
  assert.equal(names.length, 274); assert.equal(new Set(names).size, 274);
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
  const scoped = scopeCloudReleaseRules(nextRaw, withRegex).source;
  assert.equal(verifyCloudReleaseRulesScopeEquivalence(nextRaw, scoped).exactReachableFunctionBodies, true);
  assert.equal(compactCloudRuleSymbols(scoped).source, next);
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
  const uuid = /function uuid\(id\) \{[\s\S]*?\n    \}/.exec(result)![0];
  assert.throws(() => verifyCloudReleaseRulesScopeEquivalence(raw, result.replace(uuid, `${uuid}\n${uuid}`)), /same lexical scope/);
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
  const before = composeUnscopedCloudReleaseRules(base, safe), after = scopeCloudReleaseRules(before, safe).source;
  assert.equal(verifyCloudReleaseRulesScopeEquivalence(before, after).newFreeWildcardCaptures, 0);
});

test('public structural helper is pure and has no private fixtures, administrative authentication or RPC dependencies', () => {
  const source = readFileSync('scripts/scope-cloud-release-rules.mjs', 'utf8');
  assert.doesNotMatch(source, /node:(?:fs|vm)|(?:requireAuth|fetch|readFileSync|writeFileSync)\s*\(|\.firebase[\\/]/);
});

test('compaction cannot capture an existing argument and leaves method calls, paths, quoted fields and comments intact', () => {
  const source = `function get(A) { return lookup(A) && A.get('get', false); }
function lookup(value) { return value.get == 'lookup()' && value.matches('get\\\\(.*'); }
match /get/{lookup} { allow get: if get(resource.data); }
// get(lookup()) must not be changed here
`;
  const compact = compactCloudRuleSymbols(source);
  assert.equal(compact.functionNames, 2);
  assert.equal(compact.renamedOccurrences, 4);
  assert.ok(compact.source.includes('function B(A)'));
  assert.ok(compact.source.includes("A.get('get', false)"));
  assert.ok(compact.source.includes("value.get == 'lookup()'"));
  assert.ok(compact.source.includes('match /get/{lookup} { allow get:'));
  assert.ok(compact.source.includes('// get(lookup()) must not be changed here'));
  assert.equal(compact.restoredExactly, true);
});
