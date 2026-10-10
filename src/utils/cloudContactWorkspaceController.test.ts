import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { createCloudContactWorkspaceController } from './cloudContactWorkspaceController';
import { CloudContactError, createCloudContactRepository, type CloudContactAdapter, type CloudContactCommand, type CloudContactRecord,
  type CloudContactRepository } from './cloudContactRepository';

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
  let current: CloudContactRecord | null = record();
  const handlers: { commitError?: unknown; getError?: unknown; listError?: unknown;
    commitDelay?: Promise<any>; listDelay?: Promise<typeof page>; factoryDelay?: Promise<CloudContactRepository> } = {};
  const repository: CloudContactRepository = {
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
  return { controller, calls, commands, handlers, repository, createDraft,
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

test('invalid, duplicate and stale conflict saves retain editable drafts without raw service errors', async () => {
  for (const code of ['invalid', 'duplicate', 'conflict'] as const) {
    const h = harness(); h.createDraft();
    h.handlers.commitError = new CloudContactError(code);
    await h.controller.save();
    assert.equal(h.controller.getState().saveStatus, 'idle');
    assert.ok(h.controller.getState().draft);
    assert.equal(h.controller.changeDraft({ name: 'تصحيح وهمي', mobile: '01000000002' }), true);
    assert.equal(h.controller.cancelDraft(), true);
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
  await Promise.resolve(); await Promise.resolve();
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
      if (loseReply) { loseReply = false; throw new Error('synthetic lost acknowledgement'); }
      return result;
    },
  };
  const repository = createCloudContactRepository(adapter, {
    digest: async value => createHash('sha256').update(value).digest('hex'),
  });
  const newerOperation = '20000000-0000-4000-8000-000000000002';
  const deletionOperation = '20000000-0000-4000-8000-000000000003';
  const ids = [ID, OP, deletionOperation];
  const controller = createCloudContactWorkspaceController({ getRepository: async () => repository,
    isActive: () => true, newId: () => ids.shift()!, now: () => TIME });
  controller.beginCreate(); controller.changeDraft({ name: 'إضافة وهمية', mobile: '01000000001' });
  await controller.save();
  assert.equal(controller.getState().saveStatus, 'retry-required');
  assert.equal(controller.getState().records.length, 0);
  assert.equal(rows.size, 3);
  const saved = (await repository.get(ID))!;
  await repository.commit({ operationId: newerOperation, recordId: ID, expectedRevision: 1, action: 'update',
    contact: { ...saved.data!, name: 'تعديل أحدث مؤكد' } });
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
