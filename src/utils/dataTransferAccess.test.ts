import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import type { User } from '../types';
import { canPerformAction } from './rbac';
import { matchesSessionIdentity } from './accessControl';
import { createSafeSecretaryPermissions } from './userAccounts';

// Run the actual App boundary callbacks with synthetic storage and no App
// hydration, browser session, record download or Firebase request.
const source = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const targets = ['requireFreshSettingsPermission', 'commitDomain', 'authorizeDataExport',
  'authorizeContactExport', 'authorizePatientImport', 'handleImportPatients', 'handleImportContacts', 'handleRestoreFullData'];
const declarations = new Map<string, ts.Expression>();
const visit = (node: ts.Node) => {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && targets.includes(node.name.text) && node.initializer) declarations.set(node.name.text, node.initializer);
  ts.forEachChild(node, visit);
};
visit(parsed);
for (const name of targets) assert.ok(declarations.has(name), `Missing App boundary: ${name}`);
const executable = ts.transpileModule(targets.map(name => `const ${name} = ${declarations.get(name)!.getText(parsed)};`).join('\n')
  + `\nreturn {${targets.join(',')}};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

function account(role: User['role']): User {
  return { id: 'synthetic-clinic-user', username: 'synthetic', name: 'اختبار', role, credentialVersion: 1,
    permissions: Object.fromEntries(Object.keys(createSafeSecretaryPermissions()).map(key => [key, true])) as unknown as User['permissions'] };
}
function harness(role: User['role'] = 'doctor') {
  const currentUser = account(role);
  let latestUser = currentUser;
  const touched: string[] = [];
  let lockGate = Promise.resolve();
  const dependencies: Record<string, unknown> = {
    currentUser, canPerformAction, matchesSessionIdentity, canUserLoginNow: () => ({ allowed: true }),
    useCallback: (callback: unknown) => callback,
    setUsers: () => {}, handleLogout: () => {}, refreshCurrentAccount: () => {},
    withClinicWriteLock: (work: () => unknown) => lockGate.then(work),
    Storage: {
      getUsers: () => [latestUser], getCurrentUser: () => currentUser, getPrivacyModeFresh: () => false,
      getDomainData: () => { touched.push('read-domain'); return { patients: [], contacts: [] }; },
      saveDomainDataConfirmed: () => touched.push('write-domain'),
    },
    publishDomain: () => touched.push('publish'),
    assertClinicBackup: (input: unknown) => { touched.push('validate'); return input; },
    importPatientRecords: () => { touched.push('import-patients'); return []; },
    applyContactImport: () => { touched.push('import-contacts'); return { contacts: [], addedCount: 0, duplicateCount: 0, invalidCount: 0 }; },
  };
  const actions = new Function(...Object.keys(dependencies), executable)(...Object.values(dependencies));
  return { ...actions, touched, demote: () => { latestUser = account('secretary'); },
    waitForLock: () => { let release!: () => void; lockGate = new Promise<void>(resolve => { release = resolve; }); return release; } };
}

test('all real export boundaries reject secretary even with every delegated flag enabled', () => {
  const h = harness('secretary');
  for (const kind of ['patients', 'patient_finance', 'financial_report', 'full_backup']) assert.throws(() => h.authorizeDataExport(kind));
  assert.throws(() => h.authorizeContactExport());
  assert.throws(() => h.authorizePatientImport());
  assert.deepEqual(h.touched, []);
});

test('real import and full-restore entry points deny secretary before reading or mutating data', async () => {
  const h = harness('secretary');
  await assert.rejects(h.handleImportPatients([]));
  await assert.rejects(h.handleImportContacts([]));
  await assert.rejects(h.handleRestoreFullData({}));
  assert.deepEqual(h.touched, []);
});

test('export callbacks recheck the persisted role instead of trusting a stale doctor view', () => {
  const h = harness();
  h.authorizeDataExport('patients'); h.authorizeContactExport();
  h.demote();
  for (const kind of ['patients', 'patient_finance', 'financial_report', 'full_backup']) assert.throws(() => h.authorizeDataExport(kind));
  assert.throws(() => h.authorizeContactExport());
  assert.deepEqual(h.touched, []);
});

test('imports recheck role after waiting for the actual clinic write lock', async () => {
  for (const action of ['handleImportPatients', 'handleImportContacts']) {
    const h = harness(); const release = h.waitForLock();
    const result = h[action]([]); h.demote(); release();
    await assert.rejects(result); assert.deepEqual(h.touched, []);
  }
});

test('authorized doctor and admin retain patient/contact imports and all export authorizations', async () => {
  for (const role of ['doctor', 'admin'] as const) {
    const h = harness(role);
    for (const kind of ['patients', 'patient_finance', 'financial_report', 'full_backup']) h.authorizeDataExport(kind);
    h.authorizeContactExport(); h.authorizePatientImport();
    await h.handleImportPatients([]); await h.handleImportContacts([]);
    assert.equal(h.touched.filter((item: string) => item === 'write-domain').length, 2);
    assert.equal(h.touched.filter((item: string) => item === 'publish').length, 2);
  }
});
