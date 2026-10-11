import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { createCloudClinicalRecoveryController, MAX_CLOUD_CLINICAL_RECOVERY_RECORDS } from './cloudClinicalRecoveryController';
import type { CloudClinicalCapability } from './cloudClinicalWorkspaceController';
import type { CloudClinicalCommand } from './cloudClinicalRepository';
import { prepareCloudIntentCommand, type CloudOperationIntent } from './cloudOperationIntent';

const PATIENT = '90000000-0000-4000-8000-000000000001', ACTOR = 'synthetic-recovery-owner';
const WHEN = '2026-10-11T10:00:00.000Z';
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function intent(n: number, status: CloudOperationIntent['status'] = 'prepared'): CloudOperationIntent {
  const command: CloudClinicalCommand = { action: 'visit', operationId: id(n), patientId: PATIENT, sessionId: id(n),
    expectedRevision: 0, createdAt: WHEN, paidCents: 10000, data: { type: 'كشف مصطنع', date: '2026-10-11',
      examinationCents: 10000, teethIds: [], services: [], notes: '', treatmentStage: 'single', rootCanalStatus: '', visitStatus: 'completed' } };
  const canonical = prepareCloudIntentCommand(command);
  return { schemaVersion: 1, clinicId: 'main', recordId: id(n), operationId: id(n), actorUid: ACTOR, kind: 'clinical',
    requestHash: createHash('sha256').update(JSON.stringify(['clinic-operation-intent-v1', ACTOR, 'clinical', canonical])).digest('hex'),
    status, revision: status === 'prepared' ? 1 : 2, createdAt: WHEN, command: canonical };
}
function deferred() {
  let resolve!: () => void; const promise = new Promise<void>(accept => { resolve = accept; }); return { promise, resolve };
}
function harness(rows: CloudOperationIntent[] = []) {
  let alive = true, capCalls = 0;
  const calls: { kind: unknown; input: { afterId: string | null; limit: number } }[] = [];
  const hooks: { cap?: () => Promise<void> | void; list?: () => Promise<void> | void; replace?: (value: any) => any } = {};
  const capability = { repository: new Proxy({}, { get() { throw new Error('No patient or financial writes from recovery list.'); } }),
    journal: { listHistoryPage: async (kind: unknown, input: { afterId: string | null; limit: number }) => {
      calls.push({ kind, input: structuredClone(input) }); await hooks.list?.();
      const records = structuredClone(rows.filter(row => input.afterId === null || row.operationId > input.afterId).slice(0, input.limit));
      const page = { records, nextAfterId: records.length === input.limit ? records.at(-1)!.operationId : null };
      return hooks.replace ? hooks.replace(page) : page;
    }, listPreparedPage: async () => { throw new Error('Prepared-only fallback forbidden.'); },
    prepare: async () => { throw new Error('No prepare from recovery.'); },
    get: async () => { throw new Error('No per-operation mutation/read from list.'); },
    cancel: async () => { throw new Error('No cancel from recovery.'); },
  } } as unknown as CloudClinicalCapability;
  const controller = createCloudClinicalRecoveryController({ isActive: () => alive,
    getCapability: async () => { capCalls++; await hooks.cap?.(); return capability; } });
  return { controller, calls, rows, hooks, capability, capCalls: () => capCalls, alive: (value: boolean) => { alive = value; } };
}
test('recovery controller constructs inertly and loads history only on explicit action', async () => {
  const h = harness([intent(1)]); assert.equal(h.capCalls(), 0); assert.deepEqual(h.calls, []);
  assert.deepEqual(h.controller.getState().records, []); assert.equal(h.controller.getState().loaded, false);
  await h.controller.loadMore(); assert.equal(h.capCalls(), 0);
  await h.controller.loadFirst(); assert.equal(h.capCalls(), 1);
  assert.deepEqual(h.calls, [{ kind: 'clinical', input: { afterId: null, limit: 25 } }]);
  const state = h.controller.getState(); assert.equal(state.loaded, true); assert.equal(state.loading, false);
  assert.equal(state.records.length, 1); assert.equal(state.nextAfterId, null); assert.match(state.notice, /المعرف/);
  assert.equal(Object.isFrozen(state.records[0].command), true);
});
test('all statuses remain discoverable, including committed lost acknowledgements and cancelled history', async () => {
  const h = harness([intent(1), intent(2, 'committed'), intent(3, 'cancelled')]); await h.controller.loadFirst();
  assert.deepEqual(h.controller.getState().records.map(row => row.status), ['prepared', 'committed', 'cancelled']);
  assert.deepEqual(h.controller.getState().records.map(row => row.revision), [1, 2, 2]);
});
test('recovery fails closed when all-status history is unsupported and never falls back to prepared-only list', async () => {
  const h = harness([intent(1)]); delete (h.capability.journal as any).listHistoryPage;
  await h.controller.loadFirst(); assert.equal(h.controller.getState().loaded, false);
  assert.deepEqual(h.calls, []); assert.match(h.controller.getState().error, /تعذر/);
});
test('history pages are ascending, bounded and explicit; loadMore appends without duplicate reads or hidden truncation', async () => {
  const h = harness(Array.from({ length: 27 }, (_, index) => intent(index + 1))); await h.controller.loadFirst();
  assert.equal(h.controller.getState().records.length, 25); assert.equal(h.controller.getState().nextAfterId, id(25));
  assert.match(h.controller.getState().notice, /جزئية/); await h.controller.loadMore();
  assert.equal(h.controller.getState().records.length, 27); assert.equal(h.controller.getState().nextAfterId, null);
  assert.deepEqual(h.calls[1].input, { afterId: id(25), limit: 25 }); await h.controller.loadMore(); assert.equal(h.calls.length, 2);
});
test('a full last page requires one explicit empty page to confirm the end', async () => {
  const h = harness(Array.from({ length: 25 }, (_, index) => intent(index + 1))); await h.controller.loadFirst();
  assert.equal(h.controller.getState().nextAfterId, id(25)); await h.controller.loadMore();
  assert.equal(h.controller.getState().records.length, 25); assert.equal(h.controller.getState().nextAfterId, null);
});
test('malformed clinical history commands, envelope links, status revisions, extras and dates never publish', async () => {
  const mutations: ((row: any) => void)[] = [
    row => { row.kind = 'contact'; }, row => { row.command.paidCents = 0.5; },
    row => { row.command.sessionId = id(55); }, row => { row.command.privateLabCost = 100; },
    row => { row.command.data.date = '2026-02-31'; }, row => { row.createdAt = '2026-10-12T10:00:00.000Z'; },
    row => { row.recordId = id(99); }, row => { row.revision = 2; }, row => { row.command.operationId = id(99); },
  ];
  for (const mutate of mutations) {
    const h = harness([intent(1)]); mutate(h.rows[0]); await h.controller.loadFirst();
    assert.equal(h.controller.getState().loaded, false); assert.deepEqual(h.controller.getState().records, []);
    assert.match(h.controller.getState().error, /تعذر/);
  }
});
test('mixed actor pages are rejected rather than showing another owner records', async () => {
  const h = harness(Array.from({ length: 26 }, (_, index) => intent(index + 1)));
  h.rows[25].actorUid = 'another-synthetic-owner'; await h.controller.loadFirst(); await h.controller.loadMore();
  assert.equal(h.controller.getState().records.length, 25); assert.equal(h.controller.getState().nextAfterId, id(25));
  assert.match(h.controller.getState().error, /تعذر/);
});
test('unordered, duplicate, sparse, accessor, extra or prematurely terminated history pages fail closed', async () => {
  const mutations = [
    (page: any) => ({ ...page, records: [intent(2), intent(1)] }),
    (page: any) => ({ ...page, records: [intent(1), intent(1)] }),
    (page: any) => ({ ...page, records: new Array(1) }),
    (page: any) => Object.defineProperty(page, 'records', { enumerable: true, get() { throw new Error('PRIVATE'); } }),
    (page: any) => ({ ...page, secret: 'PRIVATE' }),
    (page: any) => ({ ...page, nextAfterId: null }),
  ];
  for (const replace of mutations) {
    const h = harness(Array.from({ length: 25 }, (_, index) => intent(index + 1))); h.hooks.replace = replace;
    await h.controller.loadFirst(); assert.equal(h.controller.getState().loaded, false);
    assert.doesNotMatch(h.controller.getState().error, /PRIVATE/); assert.deepEqual(h.controller.getState().records, []);
  }
});
test('loadMore rejects repeated or regressed cursors and preserves the already verified subset', async () => {
  const h = harness(Array.from({ length: 26 }, (_, index) => intent(index + 1))); await h.controller.loadFirst();
  h.hooks.replace = page => ({ ...page, records: [intent(25)], nextAfterId: null }); await h.controller.loadMore();
  assert.equal(h.controller.getState().records.length, 25); assert.match(h.controller.getState().notice, /الجزء/);
  assert.equal(h.controller.getState().nextAfterId, id(25));
});
test('capacity overflow is explicit and preserves exactly 2000 verified records, never silently truncates', async () => {
  const h = harness(Array.from({ length: MAX_CLOUD_CLINICAL_RECOVERY_RECORDS + 1 }, (_, index) => intent(index + 1)));
  await h.controller.loadFirst(); for (let page = 1; page < 80; page++) await h.controller.loadMore();
  assert.equal(h.controller.getState().records.length, 2000); await h.controller.loadMore();
  assert.equal(h.controller.getState().records.length, 2000); assert.match(h.controller.getState().error, /٢٠٠٠/);
  assert.match(h.controller.getState().notice, /ليس جميع/); assert.equal(h.controller.getState().nextAfterId, id(2000));
});
test('delayed capability and read results cannot repopulate a disposed history view', async () => {
  for (const boundary of ['cap', 'list'] as const) {
    const h = harness([intent(1)]), gate = deferred(), reached = deferred();
    h.hooks[boundary] = async () => { reached.resolve(); await gate.promise; };
    const loading = h.controller.loadFirst(); await reached.promise; h.controller.dispose(); gate.resolve(); await loading;
    assert.equal(h.controller.getState().closed, true); assert.deepEqual(h.controller.getState().records, []);
    if (boundary === 'cap') assert.deepEqual(h.calls, []);
  }
});
test('lease loss permanently clears history and retained actions cannot revive it', async () => {
  const h = harness([intent(1)]); await h.controller.loadFirst(); h.alive(false);
  assert.equal(h.controller.getState().closed, true); h.alive(true);
  await h.controller.loadFirst(); await h.controller.loadMore(); assert.deepEqual(h.controller.getState().records, []);
  assert.equal(h.calls.length, 1);
});
test('overlapping and retained loading callbacks stay exclusive', async () => {
  const h = harness([intent(1)]), gate = deferred(), reached = deferred();
  h.hooks.list = async () => { reached.resolve(); await gate.promise; };
  const loading = h.controller.loadFirst(); await reached.promise;
  await h.controller.loadFirst(); await h.controller.loadMore(); assert.equal(h.calls.length, 1);
  gate.resolve(); await loading; assert.equal(h.controller.getState().loaded, true);
});
test('refresh failures clear stale history, while loadMore failures retain an explicitly partial subset', async () => {
  const h = harness(Array.from({ length: 26 }, (_, index) => intent(index + 1))); await h.controller.loadFirst();
  h.hooks.list = () => { throw new Error('PRIVATE_PROVIDER'); }; await h.controller.loadMore();
  assert.equal(h.controller.getState().records.length, 25); assert.match(h.controller.getState().notice, /الجزء/);
  assert.doesNotMatch(h.controller.getState().error, /PRIVATE/); await h.controller.loadFirst();
  assert.deepEqual(h.controller.getState().records, []); assert.equal(h.controller.getState().loaded, false);
});
test('published records are defensive deep-frozen clones, not mutable adapter references', async () => {
  const h = harness([intent(1)]); await h.controller.loadFirst(); h.rows[0].command.paidCents = 1;
  const state = h.controller.getState(); assert.equal(state.records[0].command.paidCents, 10000);
  assert.equal(Object.isFrozen(state), true); assert.equal(Object.isFrozen(state.records), true);
  assert.throws(() => { (state.records[0].command as any).paidCents = 1; });
});
test('listener errors and lease callback disposal cannot cause late data actions or resurrection', async () => {
  const h = harness([intent(1)]); h.controller.subscribe(() => { throw new Error('PRIVATE_VIEW'); });
  await h.controller.loadFirst(); assert.equal(h.controller.getState().loaded, true);
  let controller!: ReturnType<typeof createCloudClinicalRecoveryController>, close = false;
  controller = createCloudClinicalRecoveryController({ getCapability: async () => { throw new Error('Must not obtain capability.'); },
    isActive: () => { if (close) controller.dispose(); return true; } });
  close = true; await controller.loadFirst(); assert.equal(controller.getState().closed, true);
});
test('recovery dependency graph stays Auth/SDK/storage/App/network-free', async () => {
  const result = await build({ entryPoints: ['src/utils/cloudClinicalRecoveryController.ts'], bundle: true,
    platform: 'browser', write: false, metafile: true, logLevel: 'silent' });
  for (const path of Object.keys(result.metafile!.inputs)) assert.doesNotMatch(path, /firebase|storage\.ts|App\.tsx|cloudOperatingAuth/i);
});
