import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Exercise the actual App action without importing App, hydrating a clinic,
// installing browser globals, or contacting Firebase. AST extraction avoids a
// second implementation of this destructive callback in the test fixture.
const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('App.tsx', appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let initializer: ts.Expression | undefined;
const findAction = (node: ts.Node): void => {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
    && node.name.text === 'handleClearOperationalData') initializer = node.initializer;
  ts.forEachChild(node, findAction);
};
findAction(parsed);
assert.ok(initializer, 'App must provide the explicitly confirmed operational clear action');
const executable = ts.transpileModule(`return (${initializer.getText(parsed)});`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

type SyntheticAccount = { id: string; role: string };
type Call = { name: string; args: unknown[] };
const clearedViews: Record<string, unknown> = {
  setLabs: [],
  setSelectedPatientId: null,
  setLabPricingTarget: undefined,
  setEndoPatientName: '',
  setIsHomePaymentOpen: false,
  setIsWalkInModalOpen: false,
  setIsDailyReportModalOpen: false,
  setIsApprovalQueueOpen: false,
  setIsSmartScheduleOpen: false,
  setIsInvoiceOcrOpen: false,
  setIsAddExpenseModalOpen: false,
  setIsEndoHelperOpen: false,
  setIsMobileDrawerOpen: false,
  setActiveView: 'home',
};

function createHarness(options: { currentUser?: SyntheticAccount; users?: SyntheticAccount[];
  authorizationError?: Error; clearError?: Error; accountReadError?: Error } = {}) {
  const calls: Call[] = [];
  let users = options.users ?? [{ id: 'synthetic-owner', role: 'doctor' }];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const record = (name: string) => (...args: unknown[]) => { calls.push({ name, args }); };
  const dependencies: Record<string, unknown> = {
    currentUser: options.currentUser ?? { id: 'synthetic-owner', role: 'doctor' },
    withClinicWriteLock: (operation: () => unknown) => {
      record('lock-request')();
      return gate.then(() => { record('lock-acquired')(); return operation(); });
    },
    authorizeDataExport: (kind: string) => {
      record('authorizeDataExport')(kind);
      if (options.authorizationError) throw options.authorizationError;
    },
    Storage: {
      getUsers: () => {
        record('getUsers')();
        if (options.accountReadError) throw options.accountReadError;
        return users;
      },
      clearOperationalDataConfirmed: () => {
        record('clearOperationalDataConfirmed')();
        if (options.clearError) throw options.clearError;
      },
      resetAll: record('forbidden-resetAll'),
    },
    publishDomain: record('publishDomain'),
    showToast: record('showToast'),
    cancelConfirm: record('cancelConfirm'),
    window: { location: { reload: record('forbidden-reload') } },
    ...Object.fromEntries(Object.keys(clearedViews).map(name => [name, record(name)])),
  };
  const action = new Function(...Object.keys(dependencies), executable)(...Object.values(dependencies)) as () => Promise<void>;
  return { action, calls, release, replaceUsers: (next: SyntheticAccount[]) => { users = next; } };
}

const names = (calls: Call[]) => calls.map(call => call.name);
const assertNoPublishedSuccess = (calls: Call[]) => {
  assert.equal(calls.some(call => call.name === 'publishDomain' || call.name in clearedViews
    || call.name === 'showToast' || call.name === 'cancelConfirm'
    || call.name.startsWith('forbidden-')), false);
};

test('empty-clinic App action waits for the clinic lock before fresh authorization or any mutation', async () => {
  const harness = createHarness();
  assert.deepEqual(harness.calls, [], 'constructing the callback has no side effects');
  const pending = harness.action();
  await Promise.resolve();
  assert.deepEqual(names(harness.calls), ['lock-request']);
  harness.release();
  await pending;
  assert.deepEqual(names(harness.calls).slice(0, 5), [
    'lock-request', 'lock-acquired', 'authorizeDataExport', 'getUsers', 'clearOperationalDataConfirmed',
  ]);
  assert.deepEqual(harness.calls[2].args, ['full_backup']);
});

test('empty-clinic App action accepts persisted doctor/admin roles and publishes only after confirmed persistence', async t => {
  for (const role of ['doctor', 'admin']) await t.test(role, async () => {
    const harness = createHarness({ users: [{ id: 'synthetic-owner', role }] });
    const pending = harness.action(); harness.release(); await pending;
    const writeIndex = names(harness.calls).indexOf('clearOperationalDataConfirmed');
    const publishIndex = names(harness.calls).indexOf('publishDomain');
    assert.ok(writeIndex >= 0 && publishIndex > writeIndex);
    assert.deepEqual(harness.calls[publishIndex].args, [{
      patients: [], contacts: [], appointments: [], labCases: [], expenses: [], materialUsages: [],
    }]);
    for (const [setter, value] of Object.entries(clearedViews)) {
      const setterIndex = names(harness.calls).indexOf(setter);
      assert.ok(setterIndex > writeIndex, `${setter} runs only after persistence succeeds`);
      assert.deepEqual(harness.calls[setterIndex].args, [value]);
    }
    assert.equal(harness.calls.filter(call => call.name === 'clearOperationalDataConfirmed').length, 1);
    assert.equal(harness.calls.some(call => call.name.startsWith('forbidden-')), false);
  });
});

test('empty-clinic App action refuses an account demoted or deleted while waiting for the lock', async t => {
  for (const [label, users] of [
    ['demoted', [{ id: 'synthetic-owner', role: 'secretary' }]],
    ['deleted', []],
    ['different administrator', [{ id: 'another-synthetic-owner', role: 'admin' }]],
  ] as [string, SyntheticAccount[]][]) await t.test(label, async () => {
    const harness = createHarness();
    const pending = harness.action();
    harness.replaceUsers(users);
    harness.release();
    await assert.rejects(pending, /طبيب أو مدير النظام/);
    assert.equal(names(harness.calls).includes('clearOperationalDataConfirmed'), false);
    assertNoPublishedSuccess(harness.calls);
  });
});

test('empty-clinic App action uses the latest role rather than a stale role in the rendered account', async () => {
  const harness = createHarness({ currentUser: { id: 'synthetic-owner', role: 'secretary' } });
  const pending = harness.action();
  harness.replaceUsers([{ id: 'synthetic-owner', role: 'admin' }]);
  harness.release();
  await pending;
  assert.ok(names(harness.calls).includes('clearOperationalDataConfirmed'));
});

test('empty-clinic App action rejects failed authorization without reading accounts, clearing or closing views', async () => {
  const failure = new Error('synthetic expired session or privacy restriction');
  const harness = createHarness({ authorizationError: failure });
  const pending = harness.action(); harness.release();
  await assert.rejects(pending, error => error === failure);
  assert.deepEqual(names(harness.calls), ['lock-request', 'lock-acquired', 'authorizeDataExport']);
  assertNoPublishedSuccess(harness.calls);
});

test('empty-clinic App action preserves visible state and propagates an unconfirmed clear failure', async () => {
  const failure = new Error('synthetic storage write/rollback failure');
  const harness = createHarness({ clearError: failure });
  const pending = harness.action(); harness.release();
  await assert.rejects(pending, error => error === failure);
  assert.deepEqual(names(harness.calls), [
    'lock-request', 'lock-acquired', 'authorizeDataExport', 'getUsers', 'clearOperationalDataConfirmed',
  ]);
  assertNoPublishedSuccess(harness.calls);
});

test('empty-clinic App action fails closed if the fresh account read fails', async () => {
  const failure = new Error('synthetic account read failure');
  const harness = createHarness({ accountReadError: failure });
  const pending = harness.action(); harness.release();
  await assert.rejects(pending, error => error === failure);
  assert.equal(names(harness.calls).includes('clearOperationalDataConfirmed'), false);
  assertNoPublishedSuccess(harness.calls);
});
