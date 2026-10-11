import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createCloudOperationIntentRepository, prepareCloudIntentCommand, type CloudIntentAdapter,
  type CloudOperationIntent, type CloudOperationIntentRepository } from './cloudOperationIntent';
import { CloudServiceCatalogError, createCloudServiceCatalogRepository,
  type CloudServiceCatalogAdapter, type CloudServiceCatalogCommand, type CloudServiceCatalogRecord } from './cloudServiceCatalogRepository';
import { createCloudCatalogWorkspaceController, MAX_CLOUD_CATALOG_HISTORY_RECORDS,
  type CloudCatalogWorkspaceCapability, type CloudCatalogWorkspaceController } from './cloudCatalogWorkspaceController';

// Entirely fabricated capabilities/atomic server. No SDK, browser records,
// Firebase projects, Rules, account credentials or real clinical data.
const OWNER = 'synthetic-catalog-editor-owner', WHEN = '2026-10-11T00:00:00.000Z';
const id = (number: number) => `20000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const SERVICE = '30000000-0000-4000-8000-000000000001';
const CATALOG = 'clinics/main/settings/serviceCatalog';
const operation = (number: number) => `clinics/main/catalogOperations/${id(number)}`;
const intentPath = (number: number) => `clinics/main/operationIntents/${id(number)}`;
const digest = async (value: string) => createHash('sha256').update(value).digest('hex');
const data = () => ({ examinationCents: 10_000, services: [
  { serviceId: SERVICE, name: 'خدمة مصطنعة', kind: 'clinical' as const, priceCents: 30_000, active: true },
] });
const command = (number = 1, revision = 0): CloudServiceCatalogCommand => ({ operationId: id(number), expectedRevision: revision, createdAt: WHEN, data: data() });
const record = (revision = 1, operationId = id(1)): CloudServiceCatalogRecord => ({ schemaVersion: 1, clinicId: 'main',
  recordId: 'serviceCatalog', revision, lastOperationId: operationId, data: data() });
function intent(input = command(), status: CloudOperationIntent['status'] = 'prepared', actorUid = OWNER): CloudOperationIntent {
  const canonical = prepareCloudIntentCommand(input);
  return { schemaVersion: 1, clinicId: 'main', recordId: input.operationId, operationId: input.operationId, actorUid, kind: 'catalog',
    requestHash: createHash('sha256').update(JSON.stringify(['clinic-operation-intent-v1', actorUid, 'catalog', canonical])).digest('hex'),
    status, revision: status === 'prepared' ? 1 : 2, createdAt: input.createdAt, command: canonical };
}
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, deny) => { resolve = accept; reject = deny; }); return { resolve, reject, promise }; }
function fake() {
  const calls: string[] = [], inputs: CloudServiceCatalogCommand[] = [], storedIntents = new Map<string, CloudOperationIntent>();
  let snapshot: CloudServiceCatalogRecord | null = null, active = true, number = 0, controller!: CloudCatalogWorkspaceController;
  const hooks: { get?: () => Promise<unknown>; prepare?: (input: CloudServiceCatalogCommand) => Promise<unknown>;
    commit?: (input: CloudServiceCatalogCommand) => Promise<unknown>; intentGet?: (id: string) => Promise<unknown>;
    cancel?: (id: string) => Promise<unknown>; history?: (afterId: string | null) => Promise<unknown>;
    capability?: () => Promise<CloudCatalogWorkspaceCapability>; active?: () => boolean; newId?: () => string; now?: () => string } = {};
  const capability: CloudCatalogWorkspaceCapability = {
    repository: {
      get: async () => { calls.push('get'); return hooks.get ? await hooks.get() as any : structuredClone(snapshot); },
      commit: async input => { const value = input as CloudServiceCatalogCommand; calls.push(`commit:${value.operationId}`); inputs.push(structuredClone(value));
        if (hooks.commit) return await hooks.commit(value) as any;
        snapshot = { ...record(value.expectedRevision + 1, value.operationId), data: structuredClone(value.data) };
        storedIntents.set(value.operationId, intent(value, 'committed'));
        return { status: 'committed', recordId: 'serviceCatalog', revision: value.expectedRevision + 1 }; },
    },
    journal: {
      prepare: async (_kind, input) => { const value = input as unknown as CloudServiceCatalogCommand; calls.push(`prepare:${value.operationId}`);
        if (hooks.prepare) return await hooks.prepare(value) as any;
        if (!storedIntents.has(value.operationId)) storedIntents.set(value.operationId, intent(value));
        return structuredClone(storedIntents.get(value.operationId)!); },
      get: async key => { calls.push(`intent-get:${key}`); return hooks.intentGet ? await hooks.intentGet(key) as any : structuredClone(storedIntents.get(key) ?? null); },
      cancel: async key => { calls.push(`cancel:${key}`); if (hooks.cancel) return await hooks.cancel(key) as any;
        const old = storedIntents.get(key)!; const cancelled = { ...old, status: 'cancelled' as const, revision: 2 as const };
        storedIntents.set(key, cancelled); return structuredClone(cancelled); },
      listPreparedPage: async () => { calls.push('PREPARED-FALLBACK'); return { records: [], nextAfterId: null }; },
      listHistoryPage: async (_kind, input) => { calls.push(`history:${input?.afterId ?? null}:${input?.limit}`);
        return hooks.history ? await hooks.history(input?.afterId ?? null) as any : { records: [], nextAfterId: null }; },
    },
  };
  controller = createCloudCatalogWorkspaceController({ getCapability: async () => { calls.push('capability'); return hooks.capability ? hooks.capability() : capability; },
    isActive: () => hooks.active ? hooks.active() : active,
    newId: () => { calls.push('new-id'); return hooks.newId ? hooks.newId() : id(++number); },
    now: () => { calls.push('now'); return hooks.now ? hooks.now() : WHEN; },
  });
  return { controller, capability, calls, hooks, inputs, storedIntents,
    active: (value: boolean) => { active = value; }, snapshot: (value: CloudServiceCatalogRecord | null) => { snapshot = value; } };
}
async function edit(h: ReturnType<typeof fake>) {
  assert.equal(await h.controller.load(), true); assert.equal(h.controller.beginEdit(), true); assert.equal(h.controller.updateDraft(data()), true);
}

test('catalog editor construction is inert; all initial state is frozen and no defaults are read or generated', () => {
  const h = fake(); assert.deepEqual(h.calls, []); const state = h.controller.getState();
  assert.equal(Object.isFrozen(state), true); assert.equal(Object.isFrozen(state.history), true);
  assert.equal(state.snapshot, null); assert.equal(state.loaded, false); assert.equal(state.draft, null);
  assert.equal(h.controller.beginEdit(), false); assert.equal(h.controller.updateDraft(data()), false); assert.equal(h.controller.cancelDraft(), false);
  assert.deepEqual(h.calls, []);
});
test('explicit null load permits a draft only with unknown examination, never guessed100 or zero', async () => {
  const h = fake(); assert.equal(await h.controller.load(), true); assert.equal(h.controller.getState().loaded, true);
  assert.equal(h.controller.beginEdit(), true); assert.deepEqual(h.controller.getState().draft, { examinationCents: null, services: [] });
  assert.equal(await h.controller.save(), false); assert.equal(h.controller.getState().pendingOperationId, null);
  assert.equal(h.calls.some(call => /prepare|commit/.test(call)), false);
});
test('loaded catalog produces an isolated deeply frozen draft; every ordinary draft blocks refresh/history/resume', async () => {
  const h = fake(), snapshot = record(); h.snapshot(snapshot); await h.controller.load(); h.controller.beginEdit();
  snapshot.data.services[0].name = 'تعديل خارجي'; assert.equal(h.controller.getState().draft?.services[0].name, 'خدمة مصطنعة');
  assert.equal(Object.isFrozen(h.controller.getState().draft?.services[0]), true);
  const calls = h.calls.length; assert.equal(await h.controller.load(), false); await h.controller.loadHistory(); await h.controller.loadMoreHistory();
  assert.equal(await h.controller.resume(id(1)), false); assert.equal(h.calls.length, calls); assert.equal(h.controller.cancelDraft(), true);
});
test('full draft replacement validates nullable exam/unknown and free prices without altering the saved snapshot', async () => {
  const h = fake(); h.snapshot(record()); await h.controller.load(); h.controller.beginEdit();
  const input = { examinationCents: null, services: [{ ...data().services[0], priceCents: null }] };
  assert.equal(h.controller.updateDraft(input), true); input.services[0].name = 'متأخر';
  assert.equal(h.controller.getState().draft?.services[0].name, 'خدمة مصطنعة'); assert.equal(h.controller.getState().draft?.services[0].priceCents, null);
  assert.equal(h.controller.getState().snapshot?.data.services[0].priceCents, 30_000);
  assert.equal(h.controller.updateDraft({ examinationCents: 0, services: [{ ...data().services[0], priceCents: 0 }] }), true);
});
test('invalid draft replacement is rejected atomically, including accessors/prototypes/unknown fields/dense array checks', async () => {
  const h = fake(); await edit(h); const before = h.controller.getState().draft; let getters = 0;
  const accessor = Object.defineProperty({ ...data() }, 'services', { enumerable: true, get() { getters++; return []; } });
  for (const input of [{ ...data(), extra: true }, { ...data(), examinationCents: -1 }, { ...data(), services: new Array(1) },
    { ...data(), services: [{ ...data().services[0], name: '' }] }, accessor, Object.assign(Object.create({}), data()),
    new Proxy(data(), { ownKeys() { throw new Error('PRIVATE'); } })]) {
    assert.equal(h.controller.updateDraft(input), false); assert.equal(h.controller.getState().draft, before);
  }
  assert.equal(getters, 0); assert.doesNotMatch(h.controller.getState().error, /PRIVATE/);
});
test('save prepares one durable operation, commits it and reads current server prices before clearing draft', async () => {
  const h = fake(); await edit(h); assert.equal(await h.controller.save(), true);
  assert.deepEqual(h.calls.filter(call => /prepare|commit/.test(call)), [`prepare:${id(1)}`, `commit:${id(1)}`]);
  assert.equal(h.controller.getState().snapshot?.revision, 1); assert.equal(h.controller.getState().draft, null);
  assert.equal(h.controller.getState().pendingOperationId, null); assert.equal(h.controller.getState().saveStatus, 'idle');
  assert.equal(h.calls.filter(call => call === 'new-id').length, 1); assert.equal(h.calls.filter(call => call === 'get').length, 2);
});
test('explicit zero fee and empty catalog are valid first saves, without a patient charge', async () => {
  const h = fake(); await h.controller.load(); h.controller.beginEdit(); h.controller.updateDraft({ examinationCents: 0, services: [] });
  assert.equal(await h.controller.save(), true); assert.deepEqual(h.controller.getState().snapshot?.data, { examinationCents: 0, services: [] });
});
test('pending saves lock every edit/load/history/resume/repeated callback without generating another operation', async () => {
  const h = fake(); await edit(h); const gate = deferred<unknown>(); h.hooks.prepare = () => gate.promise;
  const pending = h.controller.save(); await Promise.resolve(); await Promise.resolve();
  assert.equal(h.controller.getState().pendingOperationId, id(1)); assert.equal(await h.controller.save(), false);
  assert.equal(await h.controller.retry(), false); assert.equal(await h.controller.cancelPending(), false);
  assert.equal(h.controller.beginEdit(), false); assert.equal(h.controller.updateDraft(data()), false); assert.equal(h.controller.cancelDraft(), false);
  assert.equal(await h.controller.load(), false); assert.equal(await h.controller.resume(id(9)), false); await h.controller.loadHistory();
  gate.resolve(intent()); assert.equal(await pending, true); assert.equal(h.calls.filter(call => call === 'new-id').length, 1);
});
test('uncertain preparation preserves the original complete command and retry never allocates or rebases it', async () => {
  const h = fake(); await edit(h); let first = true;
  h.hooks.prepare = async input => { if (first) { first = false; throw new Error('PRIVATE_PREPARE'); } return intent(input); };
  assert.equal(await h.controller.save(), false); assert.equal(h.controller.getState().saveStatus, 'retry-required');
  const draft = h.controller.getState().draft; assert.equal(h.controller.updateDraft({ examinationCents: 0, services: [] }), false);
  assert.equal(h.controller.cancelDraft(), false); assert.equal(await h.controller.load(), false);
  assert.equal(await h.controller.retry(), true); assert.deepEqual(h.inputs[0], command());
  assert.equal(h.calls.filter(call => call === 'new-id').length, 1); assert.equal(draft?.examinationCents, 10_000);
});
test('uncertain commit retries sameID/body while confirmed commit with failed refresh retries reads only', async () => {
  const h = fake(); await edit(h); let first = true;
  h.hooks.commit = async input => { if (first) { first = false; throw new Error('PRIVATE_COMMIT'); }
    h.snapshot({ ...record(), data: input.data }); return { status: 'already-committed', recordId: 'serviceCatalog', revision: 1 }; };
  assert.equal(await h.controller.save(), false); assert.equal(await h.controller.retry(), true);
  assert.deepEqual(h.inputs[0], h.inputs[1]);
  const x = fake(); await edit(x); let fail = true; x.hooks.get = async () => { if (fail) throw new Error('PRIVATE_REFRESH'); return record(); };
  assert.equal(await x.controller.save(), false); assert.equal(x.controller.getState().saveStatus, 'refresh-required');
  assert.equal(await x.controller.cancelPending(), false); const writes = x.calls.filter(call => /prepare|commit/.test(call)).length;
  fail = false; assert.equal(await x.controller.retry(), true); assert.equal(x.calls.filter(call => /prepare|commit/.test(call)).length, writes);
});
test('historical acknowledgement refreshes a newer catalog instead of publishing the old submitted values', async () => {
  const h = fake(); await edit(h); const newer = { ...record(2, id(2)), data: { examinationCents: 55_000, services: [] } };
  h.hooks.get = async () => newer; assert.equal(await h.controller.save(), true);
  assert.equal(h.controller.getState().snapshot?.revision, 2); assert.equal(h.controller.getState().snapshot?.data.examinationCents, 55_000);
});
test('in-flight acknowledgement refresh is exclusive even for listeners reacting synchronously to its status', async () => {
  const h = fake(); await edit(h); const nested: Promise<boolean>[] = [];
  h.controller.subscribe(state => {
    if (state.saveStatus === 'refresh-required' && state.loading) {
      nested.push(h.controller.retry(), h.controller.load(), h.controller.cancelPending());
      assert.equal(h.controller.updateDraft(data()), false);
    }
  });
  assert.equal(await h.controller.save(), true); assert.deepEqual(await Promise.all(nested), [false, false, false]);
  assert.equal(h.calls.filter(call => call === 'get').length, 2); assert.equal(h.inputs.length, 1);
});
test('missing/older/inconsistent post-ACK snapshots stay refresh-required and never become fake current prices', async () => {
  for (const result of [null, { ...record(), lastOperationId: id(2) }, { ...record(), data: { examinationCents: 0, services: [] } }]) {
    const h = fake(); await edit(h); h.hooks.get = async () => result;
    assert.equal(await h.controller.save(), false); assert.equal(h.controller.getState().saveStatus, 'refresh-required');
    assert.equal(h.controller.getState().pendingOperationId, id(1)); assert.notEqual(h.controller.getState().draft, null);
  }
});
test('malformed or foreign preparation intent rejects before any domain commit', async () => {
  for (const change of [(value: any) => { value.kind = 'clinical'; }, (value: any) => { value.operationId = id(9); },
    (value: any) => { value.createdAt = '2026-10-11T00:00:00.001Z'; }, (value: any) => { value.command.data.examinationCents = 0; },
    (value: any) => { value.status = 'cancelled'; value.revision = 2; }, (value: any) => { value.command.extra = true; }]) {
    const h = fake(); await edit(h); h.hooks.prepare = async input => { const result = intent(input); change(result); return result; };
    assert.equal(await h.controller.save(), false); assert.equal(h.inputs.length, 0); assert.equal(h.controller.getState().saveStatus, 'retry-required');
  }
});
test('malformed acknowledgements retain uncertain command rather than clear it or claim success', async () => {
  for (const result of [null, { status: 'committed', recordId: 'other', revision: 1 },
    { status: 'committed', recordId: 'serviceCatalog', revision: 2 }, { status: 'committed', recordId: 'serviceCatalog', revision: 1, extra: true }]) {
    const h = fake(); await edit(h); h.hooks.commit = async () => result;
    assert.equal(await h.controller.save(), false); assert.equal(h.controller.getState().saveStatus, 'retry-required');
    assert.equal(h.controller.getState().pendingOperationId, id(1));
  }
});
test('cancelPending validates complete matching command before mutation and unlocks only confirmed cancellation', async () => {
  const h = fake(); await edit(h); h.hooks.commit = async () => { throw new Error('PRIVATE'); };
  await h.controller.save(); assert.equal(await h.controller.cancelPending(), true);
  assert.equal(h.controller.getState().draft, null); assert.equal(h.controller.getState().loaded, false);
  assert.equal(h.controller.getState().pendingOperationId, null); assert.equal(h.controller.getState().snapshot, null);
  const x = fake(); await edit(x); x.hooks.commit = async () => { throw new Error('PRIVATE'); }; await x.controller.save();
  x.hooks.intentGet = async () => intent({ ...command(), data: { examinationCents: 0, services: [] } });
  assert.equal(await x.controller.cancelPending(), false); assert.equal(x.calls.some(call => call.startsWith('cancel:')), false);
  assert.equal(x.controller.getState().pendingOperationId, id(1));
});
test('missing/committed/foreign cancellation state cannot unlock or pretend to undo an accepted save', async () => {
  for (const value of [null, intent(command(), 'committed'), intent(command(), 'prepared', 'another-owner')]) {
    const h = fake(); await edit(h); h.hooks.commit = async () => { throw new Error('PRIVATE'); }; await h.controller.save();
    h.hooks.intentGet = async () => value; assert.equal(await h.controller.cancelPending(), false);
    assert.equal(h.calls.some(call => call.startsWith('cancel:')), false); assert.equal(h.controller.getState().pendingOperationId, id(1));
  }
});
test('cancel response must match full original command and terminal cancelled status', async () => {
  const h = fake(); await edit(h); h.hooks.commit = async () => { throw new Error('PRIVATE'); }; await h.controller.save();
  h.hooks.cancel = async () => intent(command(), 'prepared'); assert.equal(await h.controller.cancelPending(), false);
  assert.equal(h.controller.getState().saveStatus, 'retry-required'); assert.equal(h.controller.getState().pendingOperationId, id(1));
});
test('resume prepared and committed durable commands replays their original IDs and never generates a replacement', async () => {
  for (const status of ['prepared', 'committed'] as const) {
    const h = fake(); h.storedIntents.set(id(7), intent(command(7), status));
    assert.equal(await h.controller.resume(id(7)), true); assert.equal(h.inputs[0].operationId, id(7));
    assert.equal(h.calls.some(call => call === 'new-id' || call === 'now'), false); assert.equal(h.controller.getState().snapshot?.lastOperationId, id(7));
  }
});
test('resume rejects cancelled/malformed/wrong-kind/wrong-ID/time commands without a new write', async () => {
  for (const change of [(value: any) => { value.status = 'cancelled'; value.revision = 2; }, (value: any) => { value.kind = 'contact'; },
    (value: any) => { value.createdAt = '2026-10-11T00:00:00.001Z'; }, (value: any) => { value.command.data.extra = true; }]) {
    const h = fake(), value = intent(); change(value); h.hooks.intentGet = async () => value;
    assert.equal(await h.controller.resume(id(1)), false); assert.equal(h.inputs.length, 0); assert.equal(h.controller.getState().pendingOperationId, null);
  }
});
test('all-status history is explicit, UUID ordered and bounded25 with no prepared-only fallback or writes', async () => {
  const h = fake(); h.hooks.history = async after => after === null
    ? { records: Array.from({ length: 25 }, (_, index) => intent(command(index + 1), ['prepared', 'committed', 'cancelled'][index % 3] as any)), nextAfterId: id(25) }
    : { records: [intent(command(26))], nextAfterId: null };
  await h.controller.loadHistory(); assert.equal(h.controller.getState().history.length, 25); assert.equal(h.controller.getState().historyNextAfterId, id(25));
  await h.controller.loadMoreHistory(); assert.equal(h.controller.getState().history.length, 26);
  assert.equal(h.controller.getState().historyNextAfterId, null); assert.equal(Object.isFrozen(h.controller.getState().history[0].command), true);
  assert.equal(h.calls.some(call => /PREPARED|commit|prepare|new-id/.test(call)), false);
  const calls = h.calls.length; await h.controller.loadMoreHistory(); assert.equal(h.calls.length, calls);
});
test('unsupported history fails closed instead of replacing all-status recovery with prepared queue', async () => {
  const h = fake(); delete h.capability.journal.listHistoryPage; await h.controller.loadHistory();
  assert.equal(h.controller.getState().historyLoaded, false); assert.notEqual(h.controller.getState().error, '');
  assert.equal(h.calls.includes('PREPARED-FALLBACK'), false);
});
test('history rejects malformed/foreign/unordered/duplicate/oversized records and wrong cursor without publishing them', async () => {
  const foreign = intent(); (foreign as any).kind = 'clinical';
  const malformed = intent(); (malformed.command.data as any).extra = true;
  for (const page of [
    { records: [foreign], nextAfterId: null }, { records: [malformed], nextAfterId: null },
    { records: [intent(command(2)), intent(command(1))], nextAfterId: null },
    { records: [intent(), intent()], nextAfterId: null },
    { records: [intent(), intent(command(2), 'prepared', 'other')], nextAfterId: null },
    { records: [intent()], nextAfterId: id(1) }, { records: new Array(1), nextAfterId: null },
    { records: Array.from({ length: 26 }, (_, index) => intent(command(index + 1))), nextAfterId: id(26) },
  ]) {
    const h = fake(); h.hooks.history = async () => page; await h.controller.loadHistory();
    assert.deepEqual(h.controller.getState().history, []); assert.equal(h.controller.getState().historyLoaded, false);
  }
});
test('history owner binding carries across pages and pending operations; it cannot change within the lease', async () => {
  const h = fake(); h.hooks.history = async after => after === null
    ? { records: Array.from({ length: 25 }, (_, index) => intent(command(index + 1))), nextAfterId: id(25) }
    : { records: [intent(command(26), 'prepared', 'other-owner')], nextAfterId: null };
  await h.controller.loadHistory(); await h.controller.loadMoreHistory(); assert.equal(h.controller.getState().history.length, 25);
  assert.notEqual(h.controller.getState().error, '');
});
test('history explicitly fails above2000 records rather than silently truncating or claiming a complete list', async () => {
  assert.equal(MAX_CLOUD_CATALOG_HISTORY_RECORDS, 2000); const h = fake();
  h.hooks.history = async after => { const first = after === null ? 1 : Number(after.slice(-12)) + 1;
    return { records: Array.from({ length: 25 }, (_, index) => intent(command(first + index))), nextAfterId: id(first + 24) }; };
  await h.controller.loadHistory(); for (let page = 1; page <= 80; page++) await h.controller.loadMoreHistory();
  const state = h.controller.getState(); assert.equal(state.history.length, 2000); assert.equal(state.historyLoaded, false);
  assert.equal(state.historyNextAfterId, null); assert.match(state.error, /٢٠٠٠/); assert.match(state.notice, /الجزء المحمّل/);
});
test('load/history/saving transitions are exclusive and retained repeated callbacks cannot race', async () => {
  const h = fake(), gate = deferred<unknown>(); h.hooks.get = () => gate.promise;
  const pending = h.controller.load(); assert.equal(await h.controller.load(), false); assert.equal(h.controller.beginEdit(), false);
  await h.controller.loadHistory(); assert.equal(h.calls.some(call => call.startsWith('history:')), false);
  gate.resolve(null); assert.equal(await pending, true);
  const historyGate = deferred<unknown>(); h.hooks.history = () => historyGate.promise; const listing = h.controller.loadHistory();
  assert.equal(await h.controller.load(), false); assert.equal(h.controller.beginEdit(), false); await h.controller.loadHistory();
  historyGate.resolve({ records: [], nextAfterId: null }); await listing;
  assert.equal(h.calls.filter(call => call.startsWith('history:')).length, 1);
});
test('actual lease loss synchronously clears every field and suppresses late capability/read/history results', async () => {
  for (const operationName of ['capability', 'get', 'history'] as const) {
    const h = fake(), gate = deferred<any>();
    if (operationName === 'capability') h.hooks.capability = () => gate.promise;
    if (operationName === 'get') h.hooks.get = () => gate.promise;
    if (operationName === 'history') h.hooks.history = () => gate.promise;
    const pending = operationName === 'history' ? h.controller.loadHistory() : h.controller.load();
    await Promise.resolve(); await Promise.resolve(); h.active(false); assert.equal(h.controller.getState().closed, true);
    gate.resolve(operationName === 'capability' ? h.capability : operationName === 'history' ? { records: [intent()], nextAfterId: null } : record());
    await pending; assert.equal(h.controller.getState().snapshot, null); assert.equal(h.controller.getState().history.length, 0);
    assert.equal(h.controller.getState().draft, null); assert.equal(h.controller.getState().loaded, false);
  }
});
test('logout during accepted save clears the view, never claims server undo and cannot revive a retained controller', async () => {
  const h = fake(); await edit(h); const gate = deferred<unknown>(), started = deferred<void>();
  h.hooks.commit = async input => { h.snapshot({ ...record(), data: input.data }); started.resolve(); return gate.promise; };
  const pending = h.controller.save(); await started.promise; h.controller.dispose();
  gate.resolve({ status: 'committed', recordId: 'serviceCatalog', revision: 1 }); assert.equal(await pending, false);
  h.active(true); assert.equal(await h.controller.load(), false); assert.equal(await h.controller.retry(), false);
  assert.equal(await h.controller.resume(id(1)), false); assert.equal(h.controller.getState().closed, true);
  assert.equal(h.controller.getState().pendingOperationId, null); assert.doesNotMatch(h.controller.getState().notice, /تراجع|undo/);
});
test('temporary checking does not erase a dirty editor while the parent retains its actual lease', async () => {
  const h = fake(); await edit(h); const before = h.controller.getState().draft;
  h.hooks.active = () => true; assert.equal(h.controller.getState().draft, before); assert.equal(h.controller.getState().closed, false);
});
test('provider failures and hostile input/exception objects cannot expose private payloads or trigger fallback', async () => {
  const h = fake(); h.hooks.get = async () => { throw new Proxy({}, { get() { throw new Error('PRIVATE_TOKEN'); } }); };
  assert.equal(await h.controller.load(), false); assert.doesNotMatch(h.controller.getState().error, /PRIVATE/); assert.equal(h.controller.getState().loaded, false);
  const x = fake(); await edit(x); x.hooks.commit = async () => { throw new Error('PRIVATE_PROVIDER'); }; await x.controller.save();
  assert.doesNotMatch(x.controller.getState().error, /PRIVATE/);
});
test('reentrant UUID/clock/input callbacks cannot start a second action or replace the command being captured', async () => {
  const h = fake(); await edit(h); let nested: Promise<boolean> | undefined;
  h.hooks.newId = () => { nested = h.controller.save(); assert.equal(h.controller.cancelDraft(), false); return id(9); };
  h.hooks.now = () => { assert.equal(h.controller.updateDraft({ examinationCents: 0, services: [] }), false); return WHEN; };
  assert.equal(await h.controller.save(), true); assert.equal(await nested, false); assert.equal(h.inputs.length, 1);
  assert.equal(h.inputs[0].operationId, id(9)); assert.equal(h.inputs[0].data.examinationCents, 10_000);
});
test('reentrant activity callbacks cannot mutate state, and a listener disposing before work prevents data calls', async () => {
  const h = fake(); h.hooks.active = () => { assert.equal(h.controller.beginEdit(), false); return true; };
  assert.equal(await h.controller.load(), true);
  const x = fake(); x.controller.subscribe(state => { if (state.loading) x.controller.dispose(); });
  assert.equal(await x.controller.load(), false); assert.deepEqual(x.calls, []); assert.equal(x.controller.getState().closed, true);
});
test('a hostile capability method getter that closes the controller cannot invoke the retained method', async () => {
  const h = fake(); let called = false;
  Object.defineProperty(h.capability.repository, 'get', { get() { h.controller.dispose(); return async () => { called = true; return record(); }; } });
  assert.equal(await h.controller.load(), false); assert.equal(called, false); assert.equal(h.controller.getState().closed, true);
});

function atomic() {
  const docs = new Map<string, any>(), calls: string[] = []; let tail = Promise.resolve(), writes = 0;
  const faults = { lostPrepare: false, lostCommit: false, failRefresh: false };
  const adapter: CloudServiceCatalogAdapter & CloudIntentAdapter = {
    authorizeOwner: async () => OWNER,
    readRecord: async path => { calls.push(`read:${path}`); if (path === CATALOG && faults.failRefresh) throw new Error('PRIVATE_REFRESH'); return structuredClone(docs.get(path) ?? null); },
    listHistoryPage: async (kind, owner, after, limit) => [...docs]
      .filter(([key, value]) => key.startsWith('clinics/main/operationIntents/') && value.kind === kind && value.actorUid === owner && (!after || value.operationId > after))
      .sort(([a], [b]) => a < b ? -1 : 1).slice(0, limit).map(([key, value]) => ({ id: key.split('/').at(-1), data: structuredClone(value) })),
    runTransaction: async work => {
      const previous = tail; let release!: () => void; tail = new Promise<void>(accept => { release = accept; }); await previous;
      try {
        const staged = structuredClone(docs); let wrote = false, isCommit = false, isPrepare = false;
        const result = await work({ get: async path => { assert.equal(wrote, false); return structuredClone(staged.get(path) ?? null); },
          set: (path, value: any) => { wrote = true; writes++; isCommit ||= path === CATALOG;
            isPrepare ||= path.startsWith('clinics/main/operationIntents/') && value.status === 'prepared'; staged.set(path, structuredClone(value)); } });
        docs.clear(); for (const [path, value] of staged) docs.set(path, value);
        if (isCommit && faults.lostCommit) { faults.lostCommit = false; throw new Error('PRIVATE_LOST_COMMIT'); }
        if (isPrepare && faults.lostPrepare) { faults.lostPrepare = false; throw new Error('PRIVATE_LOST_PREPARE'); }
        return result;
      } finally { release(); }
    },
  };
  const capability = () => ({ repository: createCloudServiceCatalogRepository(adapter, { digest }), journal: createCloudOperationIntentRepository(adapter, { digest }) });
  const client = (start = 1) => { let n = start - 1; return createCloudCatalogWorkspaceController({ getCapability: async () => capability(),
    isActive: () => true, newId: () => id(++n), now: () => WHEN }); };
  return { docs, calls, faults, client, capability, writes: () => writes };
}
async function atomicEdit(controller: CloudCatalogWorkspaceController) {
  assert.equal(await controller.load(), true); assert.equal(controller.beginEdit(), true); assert.equal(controller.updateDraft(data()), true);
}
test('actual repository+journal composition recovers lost preparation after disposal/reload with one original operation', async () => {
  const h = atomic(), first = h.client(); await atomicEdit(first); h.faults.lostPrepare = true;
  assert.equal(await first.save(), false); first.dispose(); assert.equal(h.docs.has(CATALOG), false);
  const second = h.client(99); await second.loadHistory(); const recovered = second.getState().history[0];
  assert.equal(recovered.status, 'prepared'); assert.equal(await second.resume(recovered.operationId), true);
  assert.equal(h.docs.get(CATALOG).revision, 1); assert.equal(h.docs.size, 3); assert.equal(h.docs.has(operation(99)), false);
});
test('actual lost commit ACK is discovered as committed and historical replay after a newer save never overwrites prices', async () => {
  const h = atomic(), first = h.client(); await atomicEdit(first); h.faults.lostCommit = true;
  assert.equal(await first.save(), false); first.dispose(); assert.equal(h.docs.get(CATALOG).revision, 1);
  const newer = h.client(2); await atomicEdit(newer); newer.updateDraft({ examinationCents: 20_000, services: [] }); await newer.save();
  const before = structuredClone(h.docs), writes = h.writes(), recovered = h.client(99); await recovered.loadHistory();
  assert.equal(recovered.getState().history[0].status, 'committed'); assert.equal(await recovered.resume(id(1)), true);
  assert.equal(recovered.getState().snapshot?.revision, 2); assert.equal(recovered.getState().snapshot?.data.examinationCents, 20_000);
  assert.deepEqual(h.docs, before); assert.equal(h.writes(), writes);
});
test('actual CAS conflict retains immutable stale command until confirmed cancellation then fresh reload', async () => {
  const h = atomic(), a = h.client(), b = h.client(2); await atomicEdit(a); await atomicEdit(b);
  assert.equal(await a.save(), true); assert.equal(await b.save(), false); assert.equal(b.getState().saveStatus, 'retry-required');
  assert.equal(b.updateDraft({ examinationCents: 0, services: [] }), false); assert.equal(await b.cancelPending(), true);
  assert.equal(h.docs.get(intentPath(2)).status, 'cancelled'); assert.equal(h.docs.has(operation(2)), false);
  assert.equal(b.getState().loaded, false); assert.equal(await b.load(), true); assert.equal(b.getState().snapshot?.revision, 1);
});
test('actual acknowledged save plus refresh failure retries only reads and does not increment revision again', async () => {
  const h = atomic(), controller = h.client(); await atomicEdit(controller); h.faults.failRefresh = true;
  assert.equal(await controller.save(), false); assert.equal(controller.getState().saveStatus, 'refresh-required'); const writes = h.writes();
  assert.equal(await controller.cancelPending(), false); h.faults.failRefresh = false; assert.equal(await controller.retry(), true);
  assert.equal(h.writes(), writes); assert.equal(h.docs.get(CATALOG).revision, 1);
});
