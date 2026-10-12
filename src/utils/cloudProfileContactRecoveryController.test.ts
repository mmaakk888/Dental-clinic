import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createCloudProfileContactRecoveryController } from './cloudProfileContactRecoveryController';
import { prepareCloudIntentCommand, type CloudOperationIntent, type CloudOperationIntentRepository } from './cloudOperationIntent';
import type { CloudContactCommand } from './cloudContactRepository';
import type { CloudPatientCommand } from './cloudPatientRepository';

// Read-only pure history-controller contracts with fabricated records. No SDK,
// live Auth/Rules, browser persistence, patient records or accepted mutations.
type Kind = 'contact' | 'patient-profile';
const OWNER = 'synthetic-profile-contact-history-owner';
const WHEN = '2026-10-12T10:00:00.000Z', RECORD = '90000000-0000-4000-8000-000000000001';
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function intent(kind: Kind, n: number, status: CloudOperationIntent['status'] = 'prepared'): CloudOperationIntent {
  const command: CloudContactCommand | CloudPatientCommand = kind === 'contact'
    ? { operationId: id(n), recordId: RECORD, expectedRevision: 0, action: 'create',
      contact: { id: RECORD, name: 'جهة مصطنعة', mobile: '01000000001', createdAt: '2026-10-08T10:00:00.000Z' } }
    : { operationId: id(n), recordId: RECORD, expectedRevision: 0, action: 'create',
      profile: { name: 'ملف مصطنع', mobile: '01000000001', age: 30, gender: '', firstVisit: '2026-10-12', notes: '', allergy: '' } };
  return { schemaVersion: 1, clinicId: 'main', recordId: id(n), operationId: id(n), actorUid: OWNER, kind,
    requestHash: 'a'.repeat(64), createdAt: WHEN, status, revision: status === 'prepared' ? 1 : 2,
    command: prepareCloudIntentCommand(command) };
}
function deferred() {
  let resolve!: () => void; const promise = new Promise<void>(accept => { resolve = accept; }); return { promise, resolve };
}
function harness(kind: Kind = 'contact', count = 0) {
  const rows = Array.from({ length: count }, (_, index) => intent(kind, index + 1));
  const calls: { kind: unknown; input: { afterId: string | null; limit: number } }[] = [];
  const hooks: { journal?: () => Promise<void> | void; list?: () => Promise<void> | void;
    replace?: (value: unknown) => unknown } = {};
  let alive = true, throwing = false, acquisitions = 0, forbiddenCalls = 0;
  const forbidden = async (): Promise<never> => { forbiddenCalls++; throw new Error('SYNTHETIC_PRIVATE_FORBIDDEN_MUTATION'); };
  const journal: CloudOperationIntentRepository = {
    prepare: forbidden, get: forbidden, cancel: forbidden, listPreparedPage: forbidden,
    listHistoryPage: async (which, input) => {
      const query = { afterId: input?.afterId ?? null, limit: input?.limit ?? 25 };
      calls.push({ kind: which, input: { ...query } }); await hooks.list?.();
      const records = rows.filter(row => query.afterId === null || row.operationId > query.afterId).slice(0, query.limit);
      const page = { records, nextAfterId: records.length === query.limit ? records.at(-1)!.operationId : null };
      return (hooks.replace ? hooks.replace(page) : page) as Awaited<ReturnType<NonNullable<CloudOperationIntentRepository['listHistoryPage']>>>;
    },
  };
  const controller = createCloudProfileContactRecoveryController({ kind,
    getJournal: async () => { acquisitions++; await hooks.journal?.(); return journal; },
    isActive: () => { if (throwing) throw new Error('SYNTHETIC_PRIVATE_LEASE'); return alive; } });
  return { kind, rows, calls, hooks, journal, controller, acquisitions: () => acquisitions, forbiddenCalls: () => forbiddenCalls,
    alive: (value: boolean) => { alive = value; }, throwing: (value: boolean) => { throwing = value; } };
}

test('profile/contact recovery constructs without reads and only explicit loadFirst acquires a journal', async () => {
  for (const kind of ['contact', 'patient-profile'] as const) {
    const h = harness(kind, 1); assert.equal(h.acquisitions(), 0); assert.deepEqual(h.calls, []);
    assert.deepEqual(h.controller.getState(), { records: [], loaded: false, loading: false,
      nextAfterId: null, error: '', notice: '', closed: false });
    await h.controller.loadMore(); assert.equal(h.acquisitions(), 0);
    await h.controller.loadFirst(); assert.equal(h.acquisitions(), 1);
    assert.deepEqual(h.calls, [{ kind, input: { afterId: null, limit: 25 } }]);
    assert.equal(h.controller.getState().loaded, true); assert.equal(h.controller.getState().loading, false);
    assert.match(h.controller.getState().notice, /المعرف/); assert.equal(h.forbiddenCalls(), 0);
  }
});

test('construction and subscription invoke no injected lifecycle or journal callbacks', () => {
  let lifecycleCalls = 0, acquisitions = 0;
  const controller = createCloudProfileContactRecoveryController({ kind: 'contact',
    isActive: () => { lifecycleCalls++; return true; },
    getJournal: async () => { acquisitions++; throw new Error('SYNTHETIC_PRIVATE_FORBIDDEN'); } });
  const stop = controller.subscribe(() => undefined); stop();
  assert.equal(lifecycleCalls, 0); assert.equal(acquisitions, 0); controller.dispose();
  assert.equal(lifecycleCalls, 0); assert.equal(acquisitions, 0);
});

test('history retains prepared, committed lost-acknowledgement and cancelled records for both kinds', async () => {
  for (const kind of ['contact', 'patient-profile'] as const) {
    const h = harness(kind); h.rows.push(intent(kind, 1), intent(kind, 2, 'committed'), intent(kind, 3, 'cancelled'));
    await h.controller.loadFirst();
    assert.deepEqual(h.controller.getState().records.map(value => value.status), ['prepared', 'committed', 'cancelled']);
    assert.deepEqual(h.controller.getState().records.map(value => value.revision), [1, 2, 2]);
    assert.equal(h.forbiddenCalls(), 0);
  }
});

test('contact creation date remains independent from operation timestamp and optional notes stay absent', async () => {
  const h = harness('contact', 1); await h.controller.loadFirst();
  const row = h.controller.getState().records[0];
  assert.notEqual((row.command.contact as { createdAt: string }).createdAt, row.createdAt);
  assert.equal(Object.hasOwn(row.command.contact as object, 'notes'), false);
});

test('valid update commands and contact deletion history preserve full original commands and CAS revisions', async () => {
  for (const kind of ['contact', 'patient-profile'] as const) {
    const h = harness(kind, 1); h.rows[0].command.action = 'update'; h.rows[0].command.expectedRevision = 7;
    await h.controller.loadFirst(); assert.equal(h.controller.getState().records[0].command.expectedRevision, 7);
  }
  const h = harness('contact', 1); h.rows[0].command.action = 'delete'; h.rows[0].command.expectedRevision = 7;
  h.rows[0].command.contact = null; await h.controller.loadFirst();
  assert.equal(h.controller.getState().records[0].command.contact, null);
});

test('missing all-status history fails closed without reading the prepared queue or any mutation method', async () => {
  for (const kind of ['contact', 'patient-profile'] as const) {
    const h = harness(kind, 1); delete h.journal.listHistoryPage;
    await h.controller.loadFirst(); assert.equal(h.controller.getState().loaded, false);
    assert.deepEqual(h.controller.getState().records, []); assert.match(h.controller.getState().error, /تعذر/);
    assert.equal(h.forbiddenCalls(), 0); assert.deepEqual(h.calls, []);
  }
});

test('bounded UUID paging appends verified records without reacquiring the journal or implying globally recent order', async () => {
  for (const kind of ['contact', 'patient-profile'] as const) {
    const h = harness(kind, 27); await h.controller.loadFirst();
    assert.equal(h.controller.getState().records.length, 25); assert.equal(h.controller.getState().nextAfterId, id(25));
    assert.match(h.controller.getState().notice, /جزئية/);
    await h.controller.loadMore(); assert.equal(h.controller.getState().records.length, 27);
    assert.equal(h.controller.getState().nextAfterId, null); assert.equal(h.acquisitions(), 1);
    assert.deepEqual(h.calls[1], { kind, input: { afterId: id(25), limit: 25 } });
    await h.controller.loadMore(); assert.equal(h.calls.length, 2);
  }
});

test('a completely full final page requires an explicit empty page to confirm the end', async () => {
  const h = harness('contact', 25); await h.controller.loadFirst();
  assert.equal(h.controller.getState().nextAfterId, id(25)); await h.controller.loadMore();
  assert.equal(h.calls.length, 2); assert.equal(h.controller.getState().records.length, 25);
  assert.equal(h.controller.getState().nextAfterId, null);
});

test('refresh starts again from null and does not duplicate or silently preserve a stale history list', async () => {
  const h = harness('patient-profile', 26); await h.controller.loadFirst(); await h.controller.loadMore();
  h.rows.splice(1); await h.controller.loadFirst();
  assert.equal(h.controller.getState().records.length, 1); assert.equal(h.controller.getState().nextAfterId, null);
  assert.deepEqual(h.calls.at(-1), { kind: 'patient-profile', input: { afterId: null, limit: 25 } });
});

test('invalid domain commands, kind, envelope linkage, revisions and extra fields never become visible', async () => {
  for (const kind of ['contact', 'patient-profile'] as const) {
    const mutations: ((row: any) => void)[] = [
      row => { row.kind = kind === 'contact' ? 'patient-profile' : 'contact'; },
      row => { row.recordId = id(99); }, row => { row.command.operationId = id(99); },
      row => { row.revision = 2; }, row => { row.createdAt = '2026-02-30T00:00:00.000Z'; },
      row => { row.command.privateLabCost = 100; }, row => { row.command.expectedRevision = 9; },
      row => { row.unexpected = 'SYNTHETIC_PRIVATE'; },
      row => { row.command[kind === 'contact' ? 'contact' : 'profile'].mobile = 'bad-number'; },
      row => { row.command[kind === 'contact' ? 'contact' : 'profile'].extra = true; },
    ];
    for (const mutate of mutations) {
      const h = harness(kind, 1); mutate(h.rows[0]); await h.controller.loadFirst();
      assert.equal(h.controller.getState().loaded, false); assert.deepEqual(h.controller.getState().records, []);
      assert.match(h.controller.getState().error, /تعذر/); assert.doesNotMatch(h.controller.getState().error, /SYNTHETIC_PRIVATE/);
    }
  }
});

test('one page and subsequent pages must remain coherent to one actor', async () => {
  for (const kind of ['contact', 'patient-profile'] as const) {
    const samePage = harness(kind, 2); samePage.rows[1].actorUid = 'other-synthetic-owner';
    await samePage.controller.loadFirst(); assert.equal(samePage.controller.getState().loaded, false);
    const h = harness(kind, 26); h.rows[25].actorUid = 'other-synthetic-owner';
    await h.controller.loadFirst(); await h.controller.loadMore();
    assert.equal(h.controller.getState().records.length, 25); assert.equal(h.controller.getState().nextAfterId, id(25));
    assert.match(h.controller.getState().error, /تعذر/); assert.match(h.controller.getState().notice, /الجزء/);
  }
});

test('refreshed first pages may use a newly authorized actor without mixing records from the previous history', async () => {
  const h = harness('contact', 1); await h.controller.loadFirst(); h.rows[0].actorUid = 'new-synthetic-owner';
  await h.controller.loadFirst(); assert.equal(h.controller.getState().records.length, 1);
  assert.equal(h.controller.getState().records[0].actorUid, 'new-synthetic-owner');
});

test('unordered duplicate sparse and oversized history arrays fail closed', async () => {
  const replacements = [
    () => ({ records: [intent('contact', 2), intent('contact', 1)], nextAfterId: null }),
    () => ({ records: [intent('contact', 1), intent('contact', 1)], nextAfterId: null }),
    () => ({ records: new Array(1), nextAfterId: null }),
    () => ({ records: Array.from({ length: 26 }, (_, index) => intent('contact', index + 1)), nextAfterId: id(26) }),
  ];
  for (const replace of replacements) {
    const h = harness('contact', 1); h.hooks.replace = replace; await h.controller.loadFirst();
    assert.equal(h.controller.getState().loaded, false); assert.deepEqual(h.controller.getState().records, []);
  }
});

test('page and row accessors reject without running hidden getters, and unknown fields fail schema validation', async () => {
  let reads = 0;
  const replacements = [
    () => Object.defineProperty({ nextAfterId: null }, 'records', { enumerable: true, get: () => { reads++; return []; } }),
    () => { const records = [intent('contact', 1)]; Object.defineProperty(records, '0',
      { enumerable: true, get: () => { reads++; return intent('contact', 1); } }); return { records, nextAfterId: null }; },
    () => { const row = intent('contact', 1); Object.defineProperty(row.command.contact, 'name',
      { enumerable: true, get: () => { reads++; return 'hidden'; } }); return { records: [row], nextAfterId: null }; },
    () => ({ records: [], nextAfterId: null, secret: 'SYNTHETIC_PRIVATE' }),
  ];
  for (const replace of replacements) {
    const h = harness(); h.hooks.replace = replace; await h.controller.loadFirst();
    assert.equal(h.controller.getState().loaded, false); assert.doesNotMatch(h.controller.getState().error, /SYNTHETIC_PRIVATE/);
  }
  assert.equal(reads, 0);
});

test('the server continuation must exactly reflect a dense full page and canonical final ID', async () => {
  for (const nextAfterId of [null, id(24), id(26), id(25) + '\n', 25]) {
    const h = harness('contact', 25); h.hooks.replace = value => ({ ...(value as object), nextAfterId });
    await h.controller.loadFirst(); assert.equal(h.controller.getState().loaded, false);
  }
  const h = harness('contact', 1); h.hooks.replace = value => ({ ...(value as object), nextAfterId: id(1) });
  await h.controller.loadFirst(); assert.equal(h.controller.getState().loaded, false);
});

test('loadMore rejects a regressed record/cursor and preserves only the earlier verified subset', async () => {
  const h = harness('contact', 26); await h.controller.loadFirst();
  h.hooks.replace = () => ({ records: [intent('contact', 25)], nextAfterId: null }); await h.controller.loadMore();
  assert.equal(h.controller.getState().records.length, 25); assert.equal(h.controller.getState().nextAfterId, id(25));
  assert.match(h.controller.getState().notice, /الجزء/); assert.match(h.controller.getState().error, /تعذر/);
});

test('capacity overflow reports an incomplete list and retains exactly 2000 verified operations', async () => {
  const h = harness('patient-profile', 2001); await h.controller.loadFirst();
  for (let page = 1; page < 80; page++) await h.controller.loadMore();
  assert.equal(h.controller.getState().records.length, 2000); assert.equal(h.controller.getState().nextAfterId, id(2000));
  const reads = h.calls.length;
  await h.controller.loadMore(); assert.equal(h.controller.getState().records.length, 2000);
  assert.match(h.controller.getState().error, /٢٠٠٠/); assert.match(h.controller.getState().notice, /ليس جميع/);
  assert.equal(h.controller.getState().nextAfterId, id(2000)); assert.equal(h.forbiddenCalls(), 0);
  assert.equal(h.calls.length, reads, 'capacity is explicit before requesting another server page');
});

test('outputs are detached deep-frozen copies and never freeze provider-owned data', async () => {
  for (const kind of ['contact', 'patient-profile'] as const) {
    const h = harness(kind, 1); await h.controller.loadFirst(); const state = h.controller.getState();
    assert.equal(Object.isFrozen(state), true); assert.equal(Object.isFrozen(state.records), true);
    assert.equal(Object.isFrozen(state.records[0]), true); assert.equal(Object.isFrozen(state.records[0].command), true);
    assert.notEqual(state.records[0], h.rows[0]); assert.notEqual(state.records[0].command, h.rows[0].command);
    assert.equal(Object.isFrozen(h.rows[0]), false);
    h.rows[0].command.expectedRevision = 99; assert.equal(state.records[0].command.expectedRevision, 0);
    assert.throws(() => { (state.records[0].command as any).expectedRevision = 1; });
  }
});

test('pending journal acquisition and list responses cannot repopulate disposed history', async () => {
  for (const boundary of ['journal', 'list'] as const) {
    const h = harness('contact', 1), gate = deferred(), reached = deferred();
    h.hooks[boundary] = async () => { reached.resolve(); await gate.promise; };
    const pending = h.controller.loadFirst(); await reached.promise; h.controller.dispose(); gate.resolve(); await pending;
    assert.equal(h.controller.getState().closed, true); assert.deepEqual(h.controller.getState().records, []);
    if (boundary === 'journal') assert.deepEqual(h.calls, []);
  }
});

test('observed lease loss and throwing lifetime callbacks permanently clear all records', async () => {
  for (const failure of ['false', 'throw'] as const) {
    const h = harness('patient-profile', 1); await h.controller.loadFirst();
    if (failure === 'false') h.alive(false); else h.throwing(true);
    assert.equal(h.controller.getState().closed, true); assert.deepEqual(h.controller.getState().records, []);
    h.alive(true); h.throwing(false); await h.controller.loadFirst(); await h.controller.loadMore();
    assert.equal(h.calls.length, 1); assert.equal(h.acquisitions(), 1);
  }
});

test('lease loss after acquisition or list invocation invalidates late data without claiming a server mutation', async () => {
  for (const boundary of ['journal', 'list'] as const) {
    const h = harness('contact', 1); h.hooks[boundary] = () => { h.alive(false); };
    await h.controller.loadFirst(); assert.equal(h.controller.getState().closed, true);
    assert.deepEqual(h.controller.getState().records, []); assert.equal(h.forbiddenCalls(), 0);
    if (boundary === 'journal') assert.deepEqual(h.calls, []);
  }
});

test('a reentrant history-method accessor cannot schedule a request after revoking the view', async () => {
  const h = harness('contact', 1), original = h.journal.listHistoryPage;
  Object.defineProperty(h.journal, 'listHistoryPage', { enumerable: true, get: () => { h.alive(false); return original; } });
  await h.controller.loadFirst(); assert.equal(h.controller.getState().closed, true); assert.deepEqual(h.calls, []);
});

test('exclusive loading prevents repeated first/more callbacks from starting parallel history reads', async () => {
  const h = harness('contact', 1), gate = deferred(), reached = deferred();
  h.hooks.list = async () => { reached.resolve(); await gate.promise; };
  const pending = h.controller.loadFirst(); await reached.promise;
  await h.controller.loadFirst(); await h.controller.loadMore(); assert.equal(h.calls.length, 1);
  gate.resolve(); await pending; assert.equal(h.controller.getState().loaded, true);
});

test('provider failures are safe; failed more preserves a marked subset but failed refresh clears stale records', async () => {
  const h = harness('contact', 26); await h.controller.loadFirst();
  h.hooks.list = () => { throw new Error('SYNTHETIC_PRIVATE_PROVIDER'); };
  await h.controller.loadMore(); assert.equal(h.controller.getState().records.length, 25);
  assert.match(h.controller.getState().notice, /الجزء/); assert.doesNotMatch(h.controller.getState().error, /SYNTHETIC_PRIVATE/);
  await h.controller.loadFirst(); assert.deepEqual(h.controller.getState().records, []);
  assert.equal(h.controller.getState().loaded, false); assert.equal(h.controller.getState().loading, false);
});

test('acquisition failure is retryable without a failed cached journal or exposing a private error', async () => {
  const h = harness('patient-profile', 1); h.hooks.journal = () => { throw new Error('SYNTHETIC_PRIVATE_ACQUISITION'); };
  await h.controller.loadFirst(); assert.match(h.controller.getState().error, /تعذر/);
  assert.doesNotMatch(h.controller.getState().error, /SYNTHETIC_PRIVATE/); assert.deepEqual(h.calls, []);
  delete h.hooks.journal; await h.controller.loadFirst(); assert.equal(h.acquisitions(), 2);
  assert.equal(h.controller.getState().records.length, 1);
});

test('captured subscriber transitions survive a prior listener synchronously disposing the controller', async () => {
  const h = harness('contact', 1); const seen: { loading: boolean; closed: boolean }[] = [];
  h.controller.subscribe(value => { if (value.loading && !value.closed) h.controller.dispose(); });
  h.controller.subscribe(value => { seen.push({ loading: value.loading, closed: value.closed }); });
  await h.controller.loadFirst();
  assert.deepEqual(seen, [{ loading: false, closed: true }, { loading: true, closed: false }]);
  assert.equal(h.controller.getState().closed, true); assert.equal(h.acquisitions(), 0); assert.deepEqual(h.calls, []);
});

test('throwing listeners and unsubscribed callbacks neither block other views nor grant data access', async () => {
  const h = harness('contact', 1); let seen = 0, removed = 0;
  h.controller.subscribe(() => { throw new Error('SYNTHETIC_PRIVATE_VIEW'); });
  const unsubscribe = h.controller.subscribe(() => { removed++; }); unsubscribe(); unsubscribe();
  h.controller.subscribe(() => { seen++; }); await h.controller.loadFirst();
  assert.equal(h.controller.getState().loaded, true); assert.equal(seen, 2); assert.equal(removed, 0);
  assert.equal(h.forbiddenCalls(), 0);
});

test('disposal from isActive is observed before journal acquisition despite its true return value', async () => {
  let controller!: ReturnType<typeof createCloudProfileContactRecoveryController>, close = false, acquired = 0;
  controller = createCloudProfileContactRecoveryController({ kind: 'contact',
    getJournal: async () => { acquired++; throw new Error('SYNTHETIC_PRIVATE_FORBIDDEN'); },
    isActive: () => { if (close) controller.dispose(); return true; } });
  close = true; await controller.loadFirst(); assert.equal(controller.getState().closed, true); assert.equal(acquired, 0);
});

test('recovery dependency graph remains Auth/SDK/browser-storage/App and network-free', async () => {
  const result = await build({ entryPoints: ['src/utils/cloudProfileContactRecoveryController.ts'], bundle: true,
    platform: 'browser', write: false, metafile: true, logLevel: 'silent' });
  for (const path of Object.keys(result.metafile!.inputs)) assert.doesNotMatch(path, /firebase|storage\.ts|App\.tsx|cloudOperatingAuth/i);
});
