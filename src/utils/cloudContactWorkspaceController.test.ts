import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { createCloudContactWorkspaceController, type CloudContactWorkspaceCapability } from './cloudContactWorkspaceController';
import { CloudContactError, createJournaledCloudContactRepository, type CloudContactAdapter, type CloudContactCommand, type CloudContactRecord,
  type CloudContactRepository } from './cloudContactRepository';
import { createCloudOperationIntentRepository, prepareCloudIntentCommand, type CloudOperationIntentRepository } from './cloudOperationIntent';

const ID = '10000000-0000-4000-8000-000000000001';
const OP = '20000000-0000-4000-8000-000000000001';
const TIME = '2026-10-10T10:00:00.000Z';
const phoneKey = createHash('sha256').update('contact-phone-v1:201000000001').digest('hex');

function record(revision = 1, name = 'جهة اختبار مصطنعة', deleted = false): CloudContactRecord {
  return { schemaVersion: 1, clinicId: 'main', recordId: ID, revision, deleted,
    lastOperationId: OP, phoneKey: deleted ? null : phoneKey,
    data: deleted ? null : { id: ID, name, mobile: '01000000001', createdAt: TIME } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness() {
  const calls: string[] = [], commands: CloudContactCommand[] = [];
  let active = true, ids = [ID, OP];
  let page = { records: [] as CloudContactRecord[], nextAfterId: null as string | null };
  let current: CloudContactRecord | null = record(2);
  const intents = new Map<string, any>();
  const journal = createCloudOperationIntentRepository({ authorizeOwner: async () => 'synthetic-owner',
    readRecord: async path => structuredClone(intents.get(path) ?? null),
    runTransaction: async work => {
      const staged = structuredClone(intents);
      const result = await work({ get: async path => structuredClone(staged.get(path) ?? null),
        set: (path, value) => staged.set(path, structuredClone(value)) });
      intents.clear(); for (const [key, value] of staged) intents.set(key, value); return result;
    },
  }, { digest: async value => createHash('sha256').update(value).digest('hex') });
  const handlers: { commitError?: unknown; getError?: unknown; listError?: unknown;
    commitDelay?: Promise<any>; listDelay?: Promise<typeof page>; factoryDelay?: Promise<CloudContactWorkspaceCapability> } = {};
  const repository: CloudContactWorkspaceCapability = { journal,
    commit: async command => {
      calls.push('commit'); commands.push(command);
      if (handlers.commitError) throw handlers.commitError;
      if (handlers.commitDelay) return handlers.commitDelay;
      return { status: 'committed', recordId: command.recordId, revision: command.expectedRevision + 1 };
    },
    get: async id => {
      calls.push(`get:${id}`);
      if (handlers.getError) throw handlers.getError;
      return current;
    },
    listPage: async input => {
      calls.push(`list:${input?.afterId ?? 'first'}:${input?.limit}`);
      if (handlers.listError) throw handlers.listError;
      if (handlers.listDelay) return handlers.listDelay;
      return page;
    },
  };
  const controller = createCloudContactWorkspaceController({
    getRepository: async () => { calls.push('factory'); return handlers.factoryDelay ?? repository; },
    isActive: () => active, newId: () => ids.shift()!, now: () => TIME,
  });
  const createDraft = () => {
    assert.equal(controller.beginCreate(), true);
    assert.equal(controller.changeDraft({ name: 'جهة جديدة وهمية', mobile: '01000000001' }), true);
  };
  return { controller, calls, commands, handlers, repository, journal, intents, createDraft,
    setActive: (value: boolean) => { active = value; },
    setPage: (value: typeof page) => { page = value; },
    setCurrent: (value: CloudContactRecord | null) => { current = value; },
    setIds: (value: string[]) => { ids = value; } };
}

test('prepared workspace is inert, has no local records and does not read on draft creation', () => {
  const h = harness();
  assert.deepEqual(h.calls, []);
  assert.equal(h.controller.getState().loaded, false);
  h.createDraft();
  assert.deepEqual(h.calls, []);
  assert.equal(h.controller.beginCreate(), false, 'an open unsaved draft must not be replaced');
  assert.equal(h.controller.beginEdit(record()), false);
  assert.equal(h.controller.beginDelete(record()), false);
  assert.equal(h.controller.cancelDraft(), true);
  assert.equal(h.controller.getState().draft, null);
});

test('explicit paging is bounded, retains tombstones and never claims an empty clinic from an unloaded state', async () => {
  const h = harness();
  h.setPage({ records: [record(2, '', true)], nextAfterId: ID });
  await h.controller.loadFirst();
  assert.deepEqual(h.calls, ['factory', 'list:first:25']);
  assert.equal(h.controller.getState().loaded, true);
  assert.equal(h.controller.getState().records[0].deleted, true);
  h.setPage({ records: [], nextAfterId: null });
  await h.controller.loadMore();
  assert.equal(h.calls.at(-1), `list:${ID}:25`);
  assert.equal(h.controller.getState().records.length, 1);
  await h.controller.loadMore();
  assert.equal(h.calls.filter(call => call.startsWith('list:')).length, 2);
});

test('uncertain save retains immutable operation and payload; exact same-ID retry refreshes instead of publishing the draft', async () => {
  const h = harness(); h.createDraft();
  h.handlers.commitError = new Error('PRIVATE_LOST_REPLY');
  await h.controller.save();
  assert.equal(h.controller.getState().saveStatus, 'retry-required');
  assert.equal(h.controller.getState().draft?.recordId, ID);
  assert.equal(h.controller.changeDraft({ name: 'changed', mobile: '01000000002' }), false);
  assert.equal(h.controller.cancelDraft(), false);
  assert.equal(h.controller.beginCreate(), false);
  await h.controller.loadFirst();
  assert.equal(h.calls.some(call => call.startsWith('list:')), false);
  assert.equal(Object.isFrozen(h.commands[0]), true);
  assert.equal(Object.isFrozen(h.commands[0].contact), true);
  h.handlers.commitError = null;
  h.setCurrent(record(3, 'تعديل أحدث من جهاز آخر'));
  h.setPage({ records: [record(3, 'تعديل أحدث من جهاز آخر')], nextAfterId: null });
  await h.controller.save();
  assert.equal(h.commands[0], h.commands[1]);
  assert.equal(h.commands[1].operationId, OP);
  assert.equal(h.controller.getState().saveStatus, 'idle');
  assert.equal(h.controller.getState().draft, null);
  assert.equal(h.controller.getState().records[0].data?.name, 'تعديل أحدث من جهاز آخر');
  assert.ok(h.calls.indexOf(`get:${ID}`) > h.calls.indexOf('commit'));
  assert.equal(h.controller.getState().error.includes('PRIVATE'), false);
});

test('acknowledged commit with failed refresh retries only reads, never another mutation', async () => {
  const h = harness(); h.createDraft();
  h.handlers.getError = new Error('PRIVATE_REFRESH');
  await h.controller.save();
  assert.equal(h.controller.getState().saveStatus, 'refresh-required');
  assert.match(h.controller.getState().error, /الحفظ مؤكد/);
  assert.equal(h.controller.getState().records.length, 0);
  h.handlers.getError = null;
  h.setPage({ records: [record()], nextAfterId: null });
  await h.controller.save();
  assert.equal(h.commands.length, 1);
  assert.equal(h.controller.getState().saveStatus, 'idle');
});

test('invalid, duplicate and stale conflicts retain exact prepared operations until confirmed journal cancellation', async () => {
  for (const code of ['invalid', 'duplicate', 'conflict'] as const) {
    const h = harness(); h.createDraft();
    h.handlers.commitError = new CloudContactError(code);
    await h.controller.save();
    assert.equal(h.controller.getState().saveStatus, 'retry-required');
    assert.ok(h.controller.getState().draft);
    assert.equal(h.controller.changeDraft({ name: 'تصحيح وهمي', mobile: '01000000002' }), false);
    assert.equal(h.controller.cancelDraft(), false);
    assert.equal(await h.controller.cancelPending(), true);
    assert.equal(h.controller.getState().pendingOperationId, null);
  }
  const h = harness(); h.controller.beginCreate();
  await h.controller.save();
  assert.deepEqual(h.calls, []);
  assert.ok(h.controller.getState().draft);
});

test('edit and delete use immutable displayed revisions, never generate an optimistic patient/contact snapshot', async () => {
  const h = harness();
  h.setIds([OP]);
  const displayed = record(4);
  assert.equal(h.controller.beginEdit(displayed), true);
  displayed.revision = 99; displayed.data!.name = 'متغير خارج المسودة';
  h.controller.changeDraft({ name: 'تصحيح وهمي', mobile: '01000000001' });
  h.setCurrent(record(6, '', true));
  h.setPage({ records: [record(6, '', true)], nextAfterId: null });
  await h.controller.save();
  assert.equal(h.commands[0].expectedRevision, 4);
  assert.equal(h.controller.getState().records[0].deleted, true);
  const deletion = harness(); deletion.setIds([OP]);
  assert.equal(deletion.controller.beginDelete(record(2)), true);
  deletion.setCurrent(record(3, '', true));
  await deletion.controller.save();
  assert.equal(deletion.commands[0].action, 'delete');
  assert.equal(deletion.commands[0].contact, null);
  assert.equal(deletion.commands[0].expectedRevision, 2);
});

test('duplicate clicks during delayed commit and closing a pending factory cannot issue extra requests', async () => {
  const h = harness(), gate = deferred<any>(); h.createDraft();
  h.handlers.commitDelay = gate.promise;
  const pending = h.controller.save();
  for (let tick = 0; tick < 30; tick++) await Promise.resolve();
  await h.controller.save(); await h.controller.loadMore();
  assert.equal(h.controller.cancelDraft(), false);
  assert.equal(h.commands.length, 1);
  h.controller.dispose();
  gate.resolve({ status: 'committed', recordId: ID, revision: 1 });
  await pending;
  assert.equal(h.calls.some(call => call.startsWith('get:') || call.startsWith('list:')), false);
  assert.equal(h.controller.getState().closed, true);

  const other = harness(), factoryGate = deferred<CloudContactRepository>();
  other.handlers.factoryDelay = factoryGate.promise;
  const loading = other.controller.loadFirst();
  other.controller.dispose(); factoryGate.resolve(other.repository);
  await loading;
  assert.deepEqual(other.calls, ['factory']);
});

test('owner invalidation during page read clears records and late results cannot restore the workspace', async () => {
  const h = harness(); h.setPage({ records: [record()], nextAfterId: null });
  await h.controller.loadFirst();
  const gate = deferred<{ records: CloudContactRecord[]; nextAfterId: string | null }>();
  h.handlers.listDelay = gate.promise;
  const pending = h.controller.loadFirst();
  await Promise.resolve(); await Promise.resolve();
  h.setActive(false);
  assert.equal(h.controller.getState().records.length, 0);
  gate.resolve({ records: [record(9)], nextAfterId: null });
  await pending;
  assert.equal(h.controller.getState().closed, true);
  assert.equal(h.controller.beginCreate(), false);
});

test('reentrant lifetime checks cannot mark a closed workspace loading or issue a factory request', async () => {
  let closeInCheck = false, factories = 0;
  const h = harness();
  const controller = createCloudContactWorkspaceController({
    getRepository: async () => { factories++; return h.repository; },
    isActive: () => { if (closeInCheck) controller.dispose(); return true; },
  });
  closeInCheck = true;
  await controller.loadFirst();
  assert.equal(factories, 0);
  assert.equal(controller.getState().closed, true);
  assert.equal(controller.getState().loading, false);
});

test('draft setters reject accessors and hostile/reentrant objects without reviving a closed draft', () => {
  const h = harness(); h.createDraft();
  let getterCalls = 0;
  const accessor = { get name() { getterCalls++; h.controller.dispose(); return 'unsafe'; }, mobile: '01000000001' };
  assert.equal(h.controller.changeDraft(accessor), false);
  assert.equal(getterCalls, 0);
  const hostile = new Proxy({ name: 'synthetic', mobile: '01000000001' }, {
    ownKeys() { throw new Error('PRIVATE_SETTER_ERROR'); },
  });
  assert.doesNotThrow(() => assert.equal(h.controller.changeDraft(hostile), false));
  const closing = new Proxy({ name: 'synthetic', mobile: '01000000001' }, {
    getOwnPropertyDescriptor(target, property) { h.controller.dispose(); return Reflect.getOwnPropertyDescriptor(target, property); },
  });
  assert.equal(h.controller.changeDraft(closing), false);
  assert.equal(h.controller.getState().closed, true);
  assert.equal(h.controller.getState().draft, null);
});

test('failed list leaves previously confirmed records but reports stale refresh honestly and never substitutes defaults', async () => {
  const h = harness(); h.setPage({ records: [record()], nextAfterId: null });
  await h.controller.loadFirst();
  h.handlers.listError = new Error('PRIVATE_SERVER_ERROR');
  await h.controller.loadFirst();
  assert.equal(h.controller.getState().records.length, 1);
  assert.match(h.controller.getState().error, /تعذر تحديث/);
  assert.doesNotMatch(h.controller.getState().error, /PRIVATE/);
  assert.equal(Object.isFrozen(h.controller.getState()), true);
  assert.equal(Object.isFrozen(h.controller.getState().records), true);
  assert.equal(Object.isFrozen(h.controller.getState().records[0].data), true);
});

test('bounded display window keeps later pages reachable beyond 500 records without deleting server rows', async () => {
  const h = harness();
  for (let page = 0; page < 21; page++) {
    const rows = Array.from({ length: 25 }, (_, offset) => {
      const id = `10000000-0000-4000-8000-${String(page * 25 + offset + 1).padStart(12, '0')}`;
      const value = record();
      return { ...value, recordId: id, data: { ...value.data!, id } };
    });
    h.setPage({ records: rows, nextAfterId: rows.at(-1)!.recordId });
    if (page === 0) await h.controller.loadFirst();
    else await h.controller.loadMore();
  }
  assert.equal(h.controller.getState().records.length, 500);
  assert.equal(h.controller.getState().records[0].recordId.endsWith('000000000026'), true);
  assert.equal(h.controller.getState().nextAfterId?.endsWith('000000000525'), true);
  assert.match(h.controller.getState().notice, /لم تُحذف/);
  h.setPage({ records: [], nextAfterId: null });
  await h.controller.loadMore();
  assert.equal(h.controller.getState().nextAfterId, null);
  assert.equal(h.calls.filter(call => call.startsWith('list:')).length, 22);
});

test('workspace dependency graph has no App, local storage/backup, Auth SDK or clinical financial code', async () => {
  const compiled = await build({ entryPoints: ['src/utils/cloudContactWorkspaceController.ts'], bundle: true,
    write: false, metafile: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
  const inputs = Object.keys(compiled.metafile!.inputs);
  assert.equal(inputs.some(path => /(?:App\.tsx|components\/|utils\/(?:storage|localClinicBackup|firebaseService|offlineSync|cloudOperatingAuth)|node_modules\/.*firebase)/.test(path)), false);
});

test('real transaction core and workspace compose: lost acknowledgement, competing edit, exact retry and tombstone stay consistent', async () => {
  // Synthetic memory server only. This tests composition, not SDK/Rules or a
  // real owner's data; those boundaries have separate emulator/adapter tests.
  const rows = new Map<string, any>();
  let loseReply = true, writes = 0;
  const adapter: CloudContactAdapter = {
    authorizeOwner: async () => 'synthetic-owner',
    readRecord: async path => structuredClone(rows.get(path) ?? null),
    listRecordsPage: async (after, count) => [...rows.entries()]
      .filter(([path]) => path.startsWith('clinics/main/contactRecords/'))
      .map(([path, data]) => ({ id: path.split('/').at(-1)!, data: structuredClone(data) }))
      .filter(row => after === null || row.id > after)
      .sort((a, b) => a.id < b.id ? -1 : 1).slice(0, count),
    runTransaction: async work => {
      const staged = new Map(rows);
      const result = await work({
        get: async path => structuredClone(staged.get(path) ?? null),
        set: (path, value) => { writes++; staged.set(path, structuredClone(value)); },
        delete: path => { writes++; staged.delete(path); },
      });
      rows.clear(); for (const [path, value] of staged) rows.set(path, value);
      if (loseReply && rows.has(`clinics/main/contactOperations/${OP}`)) { loseReply = false; throw new Error('synthetic lost acknowledgement'); }
      return result;
    },
  };
  const digest = async (value: string) => createHash('sha256').update(value).digest('hex');
  const journal = createCloudOperationIntentRepository(adapter, { digest });
  const repository = { ...createJournaledCloudContactRepository(adapter, { digest }), journal };
  const newerOperation = '20000000-0000-4000-8000-000000000002';
  const deletionOperation = '20000000-0000-4000-8000-000000000003';
  const ids = [ID, OP, deletionOperation];
  const controller = createCloudContactWorkspaceController({ getRepository: async () => repository,
    isActive: () => true, newId: () => ids.shift()!, now: () => TIME });
  controller.beginCreate(); controller.changeDraft({ name: 'إضافة وهمية', mobile: '01000000001' });
  await controller.save();
  assert.equal(controller.getState().saveStatus, 'retry-required');
  assert.equal(controller.getState().records.length, 0);
  assert.equal(rows.size, 4);
  const saved = (await repository.get(ID))!;
  const newer: CloudContactCommand = { operationId: newerOperation, recordId: ID, expectedRevision: 1, action: 'update',
    contact: { ...saved.data!, name: 'تعديل أحدث مؤكد' } };
  await journal.prepare('contact', newer, TIME); await repository.commit(newer);
  const beforeRetry = writes;
  await controller.save();
  assert.equal(writes, beforeRetry, 'historical receipt retry adds no writes');
  assert.equal(controller.getState().records[0].revision, 2);
  assert.equal(controller.getState().records[0].data?.name, 'تعديل أحدث مؤكد');
  controller.beginDelete(controller.getState().records[0]);
  await controller.save();
  assert.equal(controller.getState().records[0].deleted, true);
  assert.equal(controller.getState().records[0].data, null);
  assert.equal([...rows.keys()].some(path => path.includes('/contactPhones/')), false);
  assert.equal([...rows.keys()].filter(path => path.includes('/contactOperations/')).length, 3);
});

/** Real pure journal + journaled domain contracts over fabricated atomic rows. */
function durableHarness() {
  const rows = new Map<string, any>(), preparedCalls: Array<{ command: unknown; time: string }> = [], calls: string[] = [];
  const controls = { lose: '' as '' | 'prepare' | 'commit', failReads: false, writes: 0 };
  let tail = Promise.resolve();
  const digest = async (value: string) => createHash('sha256').update(value).digest('hex');
  const adapter: CloudContactAdapter = {
    authorizeOwner: async () => 'synthetic-owner',
    readRecord: async path => { if (controls.failReads) throw new Error('PRIVATE_READ'); return structuredClone(rows.get(path) ?? null); },
    listRecordsPage: async (after, count) => {
      if (controls.failReads) throw new Error('PRIVATE_READ');
      return [...rows.entries()].filter(([path, data]) => path.startsWith('clinics/main/contactRecords/') && (!after || data.recordId > after))
        .sort(([a], [b]) => a.localeCompare(b)).slice(0, count).map(([path, data]) => ({ id: path.split('/').at(-1), data: structuredClone(data) }));
    },
    runTransaction: async work => {
      const prior = tail; let release!: () => void; tail = new Promise<void>(resolve => { release = resolve; }); await prior;
      try {
        const staged = structuredClone(rows); let wrote = false, changedIntent = false, changedReceipt = false;
        const result = await work({ get: async path => { assert.equal(wrote, false); return structuredClone(staged.get(path) ?? null); },
          set: (path, value) => { wrote = true; controls.writes++; changedIntent ||= path.includes('/operationIntents/');
            changedReceipt ||= path.includes('/contactOperations/'); staged.set(path, structuredClone(value)); },
          delete: path => { wrote = true; controls.writes++; staged.delete(path); } });
        rows.clear(); for (const [path, value] of staged) rows.set(path, value);
        if (controls.lose === 'prepare' && changedIntent && !changedReceipt || controls.lose === 'commit' && changedReceipt) {
          controls.lose = ''; throw new Error('PRIVATE_LOST_ACK');
        }
        return result;
      } finally { release(); }
    },
  };
  const core = createJournaledCloudContactRepository(adapter, { digest });
  const source = createCloudOperationIntentRepository({ ...adapter,
    listHistoryPage: async (kind, uid, after, count) => [...rows.entries()]
      .filter(([path, data]) => path.startsWith('clinics/main/operationIntents/') && data.kind === kind && data.actorUid === uid && (!after || data.operationId > after))
      .sort(([a], [b]) => a.localeCompare(b)).slice(0, count).map(([path, data]) => ({ id: path.split('/').at(-1), data: structuredClone(data) })),
  }, { digest });
  const journal: CloudOperationIntentRepository = { ...source,
    prepare: async (kind, command, time) => { calls.push('prepare'); preparedCalls.push({ command, time }); return source.prepare(kind, command, time); },
  };
  const capability: CloudContactWorkspaceCapability = { ...core, journal,
    commit: async command => { calls.push('commit'); return core.commit(command); },
    get: async id => { calls.push('get'); return core.get(id); },
    listPage: async input => { calls.push('list'); return core.listPage(input); },
  };
  function create(ids = [ID, OP], times = [TIME, '2026-10-12T11:00:00.000Z']) {
    const active = { value: true }; let idCalls = 0, timeCalls = 0;
    const controller = createCloudContactWorkspaceController({ getRepository: async () => capability,
      isActive: () => active.value, newId: () => { idCalls++; return ids.shift()!; }, now: () => { timeCalls++; return times.shift()!; } });
    return { controller, active, get idCalls() { return idCalls; }, get timeCalls() { return timeCalls; } };
  }
  return { rows, controls, calls, preparedCalls, capability, core, journal, create };
}

test('save prepares once with independent operation time and retains exact UUID/command/time after lost prepare ACK', async () => {
  const h = durableHarness(), owner = h.create(), controller = owner.controller;
  assert.deepEqual(h.calls, []); assert.equal(controller.recovery.getState().loaded, false);
  controller.beginCreate(); controller.changeDraft({ name: 'جهة وهمية جديدة', mobile: '01000000001' });
  h.controls.lose = 'prepare'; await controller.save();
  assert.equal(controller.getState().saveStatus, 'retry-required'); assert.equal(controller.getState().pendingOperationId, OP);
  assert.equal(h.calls.includes('commit'), false); assert.equal(h.rows.size, 1);
  const first = h.preparedCalls[0]; assert.equal(first.time, '2026-10-12T11:00:00.000Z');
  assert.equal((first.command as CloudContactCommand).contact!.createdAt, TIME);
  await controller.save(); assert.equal(h.preparedCalls[1].command, first.command); assert.equal(h.preparedCalls[1].time, first.time);
  assert.equal(owner.idCalls, 2); assert.equal(owner.timeCalls, 2); assert.equal(controller.getState().saveStatus, 'idle');
  assert.equal(controller.getState().records[0].revision, 1);
});

test('new owner-view lifetime recovers prepared and committed lost ACKs through all-status history and same UUID', async () => {
  for (const lost of ['prepare', 'commit'] as const) {
    const h = durableHarness(), old = h.create(); old.controller.beginCreate();
    old.controller.changeDraft({ name: 'اسم وهمي للاسترجاع', mobile: '01000000001' }); h.controls.lose = lost;
    await old.controller.save(); old.controller.dispose();
    const fresh = h.create([], []); await fresh.controller.recovery.loadFirst();
    assert.equal(fresh.controller.recovery.getState().records[0].status, lost === 'prepare' ? 'prepared' : 'committed');
    const writes = h.controls.writes; assert.equal(await fresh.controller.resume(OP), true);
    assert.equal(fresh.idCalls, 0); assert.equal(fresh.timeCalls, 0); assert.equal(fresh.controller.getState().records[0].data?.name, 'اسم وهمي للاسترجاع');
    if (lost === 'commit') assert.equal(h.controls.writes, writes);
    assert.equal([...h.rows.keys()].filter(path => path.includes('/contactOperations/')).length, 1);
  }
});

test('resuming historical contact update after newer tombstone and phone reassignment never rewrites either record', async () => {
  const h = durableHarness(), old = h.create(); old.controller.beginCreate(); old.controller.changeDraft({ name: 'تجريبي', mobile: '01000000001' });
  await old.controller.save(); const original = (await h.core.get(ID))!;
  const updateId = '20000000-0000-4000-8000-000000000002', deleteId = '20000000-0000-4000-8000-000000000003';
  const otherOp = '20000000-0000-4000-8000-000000000004', otherId = '10000000-0000-4000-8000-000000000002';
  const update: CloudContactCommand = { operationId: updateId, recordId: ID, expectedRevision: 1, action: 'update', contact: { ...original.data!, mobile: '01000000002' } };
  await h.journal.prepare('contact', update, TIME); await h.core.commit(update);
  const remove: CloudContactCommand = { operationId: deleteId, recordId: ID, expectedRevision: 2, action: 'delete', contact: null };
  await h.journal.prepare('contact', remove, TIME); await h.core.commit(remove);
  const other: CloudContactCommand = { operationId: otherOp, recordId: otherId, expectedRevision: 0, action: 'create', contact: { ...original.data!, id: otherId, mobile: '01000000002' } };
  await h.journal.prepare('contact', other, TIME); await h.core.commit(other);
  const fresh = h.create([], []), before = structuredClone(h.rows), writes = h.controls.writes;
  assert.equal(await fresh.controller.resume(updateId), true); assert.deepEqual(h.rows, before); assert.equal(h.controls.writes, writes);
  assert.equal(fresh.controller.getState().records.find(row => row.recordId === ID)?.deleted, true);
  assert.equal(fresh.controller.getState().records.find(row => row.recordId === otherId)?.data?.mobile, '01000000002');
});

test('missing journal fails closed before domain commit and cannot discard an uncertain operation', async () => {
  const h = harness(), capability = { ...h.repository }; delete capability.journal;
  const ids = [ID, OP], controller = createCloudContactWorkspaceController({ getRepository: async () => capability,
    isActive: () => true, newId: () => ids.shift()!, now: () => TIME });
  controller.beginCreate(); controller.changeDraft({ name: 'تجريبي', mobile: '01000000001' }); await controller.save();
  assert.equal(h.calls.includes('commit'), false); assert.equal(controller.getState().saveStatus, 'retry-required');
  assert.equal(controller.cancelDraft(), false); assert.equal(await controller.cancelPending(), false); assert.equal(controller.getState().pendingOperationId, OP);
});

test('confirmed cancellation clears only the exact prepared command; failed cancellation keeps original command locked', async () => {
  const h = durableHarness(), owner = h.create(); owner.controller.beginCreate(); owner.controller.changeDraft({ name: 'تجريبي', mobile: '01000000001' });
  h.controls.lose = 'prepare'; await owner.controller.save();
  assert.equal(await owner.controller.cancelPending(), true);
  assert.equal((await h.journal.get(OP))?.status, 'cancelled'); assert.equal(owner.controller.getState().pendingOperationId, null);
  assert.equal(owner.controller.getState().draft, null); assert.equal(h.rows.size, 1);
  const fresh = h.create([], []); assert.equal(await fresh.controller.resume(OP), false); assert.equal(fresh.controller.getState().pendingOperationId, null);
});

test('server committed race refuses cancellation and recovery acknowledges original operation without another write', async () => {
  const h = durableHarness(), owner = h.create(); owner.controller.beginCreate(); owner.controller.changeDraft({ name: 'تجريبي', mobile: '01000000001' });
  h.controls.lose = 'commit'; await owner.controller.save(); const writes = h.controls.writes;
  assert.equal(await owner.controller.cancelPending(), false); assert.equal(owner.controller.getState().pendingOperationId, OP);
  await owner.controller.save(); assert.equal(h.controls.writes, writes); assert.equal(owner.controller.getState().saveStatus, 'idle');
});

test('post-ACK refresh retry is read only and locks its ticket before subscribers can retry reentrantly', async () => {
  const h = durableHarness(), owner = h.create(); owner.controller.beginCreate(); owner.controller.changeDraft({ name: 'تجريبي', mobile: '01000000001' });
  h.controls.failReads = true; await owner.controller.save(); assert.equal(owner.controller.getState().saveStatus, 'refresh-required');
  const before = h.calls.filter(value => value === 'commit' || value === 'prepare').length;
  const reentrant: Promise<void>[] = [];
  owner.controller.subscribe(value => { if (value.saveStatus === 'refresh-required') reentrant.push(owner.controller.save()); });
  h.controls.failReads = false; await owner.controller.save(); await Promise.all(reentrant);
  assert.equal(owner.controller.getState().saveStatus, 'idle');
  assert.equal(h.calls.filter(value => value === 'commit' || value === 'prepare').length, before);
});

test('invalid timestamps and final-line UUIDs never prepare a command or call a repository', async () => {
  for (const invalid of ['2026-02-30T10:00:00.000Z', TIME + '\n', '']) {
    const h = harness(), ids = [ID, OP]; let times = 0;
    const controller = createCloudContactWorkspaceController({ getRepository: async () => { throw new Error('forbidden'); },
      isActive: () => true, newId: () => ids.shift()!, now: () => ++times === 1 ? TIME : invalid });
    assert.equal(controller.beginCreate(), true); controller.changeDraft({ name: 'تجريبي', mobile: '01000000001' }); await controller.save();
    assert.equal(controller.getState().saveStatus, 'idle'); assert.equal(controller.getState().pendingOperationId, null); assert.deepEqual(h.calls, []);
  }
  for (const ending of ['\n', '\r', '\u2028']) {
    const h = harness(); h.setIds([ID + ending]); assert.equal(h.controller.beginCreate(), false);
    assert.equal(await h.controller.resume(OP + ending), false); assert.deepEqual(h.calls, []);
  }
});

test('reentrant UUID/clock callbacks cannot start another save or resurrect a disposed controller', async () => {
  const h = harness(); let ids = [ID, OP], recursing = false;
  const controller = createCloudContactWorkspaceController({ getRepository: async () => h.repository, isActive: () => true,
    now: () => TIME, newId: () => { if (recursing) void controller.save(); return ids.shift()!; } });
  controller.beginCreate(); controller.changeDraft({ name: 'تجريبي', mobile: '01000000001' }); recursing = true; await controller.save();
  assert.equal(h.commands.length, 1);
  const other = createCloudContactWorkspaceController({ getRepository: async () => h.repository, isActive: () => true,
    now: () => { other.dispose(); return TIME; }, newId: () => ID });
  assert.equal(other.beginCreate(), false); assert.equal(other.getState().closed, true); assert.equal(other.getState().draft, null);
});

test('captured state transitions reach all subscribers even when an earlier subscriber synchronously cancels a draft', () => {
  const h = harness(), seen: boolean[] = []; let once = true;
  h.controller.subscribe(value => { if (value.draft && once) { once = false; h.controller.cancelDraft(); } });
  h.controller.subscribe(value => seen.push(Boolean(value.draft)));
  h.controller.beginCreate(); assert.deepEqual(seen, [false, true]); assert.equal(h.controller.getState().draft, null);
});

test('cached recovery facade stays inert while ordinary drafts, domain reads or pending operations own the workspace', async () => {
  const h = durableHarness(), owner = h.create(); await owner.controller.recovery.loadFirst();
  const prior = owner.controller.recovery.getState(); assert.equal(prior.loaded, true);
  owner.controller.beginCreate(); await owner.controller.recovery.loadFirst(); assert.equal(owner.controller.recovery.getState(), prior);
  owner.controller.changeDraft({ name: 'تجريبي', mobile: '01000000001' }); h.controls.lose = 'prepare'; await owner.controller.save();
  await owner.controller.recovery.loadFirst(); await owner.controller.recovery.loadMore(); assert.equal(owner.controller.recovery.getState(), prior);
});

test('recovery loading is separately stable, blocks ordinary actions, and clears both controllers on lease loss', async () => {
  const h = harness(), gate = deferred<any>();
  const journal: CloudOperationIntentRepository = { ...h.journal, listHistoryPage: async () => gate.promise };
  const controller = createCloudContactWorkspaceController({ getRepository: async () => ({ ...h.repository, journal }), isActive: () => active }); let active = true;
  const loading = controller.recovery.loadFirst(); for (let tick = 0; tick < 20; tick++) await Promise.resolve();
  assert.equal(controller.getState().recoveryLoading, true); assert.equal(controller.getState().loading, false);
  assert.equal(controller.beginCreate(), false); await controller.loadFirst(); assert.equal(h.calls.some(value => value.startsWith('list:')), false);
  active = false; assert.equal(controller.getState().closed, true); assert.equal(controller.recovery.getState().closed, true);
  gate.resolve({ records: [], nextAfterId: null }); await loading; assert.equal(controller.getState().records.length, 0);
});

test('malformed recovered command/envelope is rejected before domain commit or cancellation mutation', async () => {
  for (const change of ['kind', 'id', 'time', 'command', 'actor', 'hash'] as const) {
    const h = harness(), capability = { ...h.repository }, ids = [ID, OP]; let changed = false, cancelCalls = 0;
    capability.journal = { ...h.journal,
      get: async id => {
        const original = await h.journal.get(id); if (!original || !changed) return original;
        if (change === 'kind') return { ...original, kind: 'clinical' };
        if (change === 'id') return { ...original, operationId: ID, recordId: ID };
        if (change === 'time') return { ...original, createdAt: '2026-10-12T10:00:00.000Z' };
        if (change === 'actor') return { ...original, actorUid: 'other-synthetic-owner' };
        if (change === 'hash') return { ...original, requestHash: 'a'.repeat(64) };
        return { ...original, command: prepareCloudIntentCommand({ ...original.command,
          contact: { ...(original.command.contact as any), mobile: 'bad' } }) };
      },
      cancel: async id => { cancelCalls++; return h.journal.cancel(id); },
    };
    const controller = createCloudContactWorkspaceController({ getRepository: async () => capability,
      isActive: () => true, newId: () => ids.shift()!, now: () => TIME });
    controller.beginCreate(); controller.changeDraft({ name: 'تجريبي', mobile: '01000000001' });
    h.handlers.commitError = new Error('lost'); await controller.save(); changed = true;
    assert.equal(await controller.cancelPending(), false); assert.equal(cancelCalls, 0);
    assert.equal(controller.getState().pendingOperationId, OP); assert.equal(controller.cancelDraft(), false);
  }
});

test('lost cancellation acknowledgement retains pending identity until exact idempotent cancellation is verified', async () => {
  const h = durableHarness(), owner = h.create(); owner.controller.beginCreate(); owner.controller.changeDraft({ name: 'تجريبي', mobile: '01000000001' });
  h.controls.lose = 'prepare'; await owner.controller.save();
  h.controls.lose = 'prepare'; assert.equal(await owner.controller.cancelPending(), false);
  assert.equal((await h.journal.get(OP))?.status, 'cancelled'); assert.equal(owner.controller.getState().pendingOperationId, OP);
  assert.equal(await owner.controller.cancelPending(), true); assert.equal(owner.controller.getState().pendingOperationId, null);
});

test('ordinary reads and recovery cannot steal each other loading state or survive permanent owner loss', async () => {
  const h = harness(), gate = deferred<{ records: CloudContactRecord[]; nextAfterId: string | null }>();
  await h.controller.recovery.loadFirst(); // Missing all-status source reports an error but caches no authority fallback.
  h.handlers.listDelay = gate.promise; const read = h.controller.loadFirst();
  for (let tick = 0; tick < 20; tick++) await Promise.resolve();
  assert.equal(h.controller.getState().loading, true); assert.equal(h.controller.getState().recoveryLoading, false);
  const before = [...h.calls]; await h.controller.recovery.loadFirst(); assert.deepEqual(h.calls, before);
  assert.equal(h.controller.getState().loading, true);
  h.setActive(false); h.controller.getState(); gate.resolve({ records: [record()], nextAfterId: null }); await read;
  assert.equal(h.controller.getState().closed, true); assert.equal(h.controller.recovery.getState().closed, true);
});

test('post-ACK contact refresh reconciles independent reads without replacing a newer record or tombstone with an older page', async () => {
  for (const deleted of [false, true]) {
    const h = harness(); h.createDraft();
    h.setCurrent(record(3, 'أحدث قراءة مؤكدة', deleted)); h.setPage({ records: [record(2, 'صفحة أقدم')], nextAfterId: null });
    await h.controller.save(); assert.equal(h.controller.getState().saveStatus, 'idle');
    assert.equal(h.controller.getState().records[0].revision, 3); assert.equal(h.controller.getState().records[0].deleted, deleted);
    assert.equal(h.controller.getState().records[0].data?.name, deleted ? undefined : 'أحدث قراءة مؤكدة');
  }
});
test('same-revision conflicting contact read/page cannot be published and refresh retry does not resubmit the operation', async () => {
  const h = harness(); h.createDraft(); h.setCurrent(record(2, 'قراءة أولى')); h.setPage({ records: [record(2, 'بيانات متعارضة')], nextAfterId: null });
  await h.controller.save(); assert.equal(h.controller.getState().saveStatus, 'refresh-required');
  assert.equal(h.controller.getState().records.length, 0); assert.equal(h.commands.length, 1);
  h.setPage({ records: [record(3, 'تعديل أحدث مؤكد')], nextAfterId: null }); await h.controller.save();
  assert.equal(h.controller.getState().saveStatus, 'idle'); assert.equal(h.controller.getState().records[0].revision, 3);
  assert.equal(h.commands.length, 1);
});
