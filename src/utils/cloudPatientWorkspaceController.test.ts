import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { createCloudPatientWorkspaceController, type CloudPatientWorkspaceController } from './cloudPatientWorkspaceController';
import { CloudPatientError, type CloudPatientCommand, type CloudPatientCommit, type CloudPatientPage,
  type CloudPatientRecord, type CloudPatientRepository } from './cloudPatientRepository';

const ID = '10000000-0000-4000-8000-000000000001';
const OTHER = '10000000-0000-4000-8000-000000000002';
const OP = '20000000-0000-4000-8000-000000000001';
const DAY = '2026-10-10';
const phoneKey = createHash('sha256').update('patient-phone-v1:201000000001').digest('hex');
function record(revision = 1, name = 'مريض اختبار مصطنع', n = 1): CloudPatientRecord {
  return { schemaVersion: 1, clinicId: 'main', recordId: `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    fileNo: n, revision, lastOperationId: OP, phoneKey,
    data: { name, mobile: '01000000001', age: 30, gender: '', firstVisit: DAY, notes: '', allergy: '' } };
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (value: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function tick() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }
function harness() {
  const calls: string[] = [], commands: CloudPatientCommand[] = [];
  let active = true, ids = [ID, OP], current: CloudPatientRecord | null = record();
  let page: CloudPatientPage = { records: [], nextAfterId: null };
  const handlers: { commitError?: unknown; getError?: unknown; listError?: unknown;
    commitResult?: CloudPatientCommit; commitDelay?: Promise<CloudPatientCommit>;
    getDelay?: Promise<CloudPatientRecord | null>; listDelay?: Promise<CloudPatientPage>;
    factoryDelay?: Promise<CloudPatientRepository> } = {};
  const repository: CloudPatientRepository = {
    commit: async command => {
      calls.push('commit'); commands.push(command);
      if (handlers.commitError) throw handlers.commitError;
      if (handlers.commitDelay) return handlers.commitDelay;
      return handlers.commitResult ?? { status: 'committed', recordId: command.recordId, fileNo: 1,
        revision: command.expectedRevision + 1 };
    },
    get: async id => {
      calls.push(`get:${id}`);
      if (handlers.getError) throw handlers.getError;
      return handlers.getDelay ?? current;
    },
    getByFileNo: async fileNo => {
      calls.push(`file:${fileNo}`);
      if (handlers.getError) throw handlers.getError;
      return handlers.getDelay ?? current;
    },
    listPage: async input => {
      calls.push(`list:${input?.afterId ?? 'first'}:${input?.limit}`);
      if (handlers.listError) throw handlers.listError;
      return handlers.listDelay ?? page;
    },
    findByPhone: async input => {
      calls.push(`phone:${input.mobile}:${input.afterId ?? 'first'}:${input.limit}`);
      if (handlers.listError) throw handlers.listError;
      return handlers.listDelay ?? page;
    },
  };
  const controller = createCloudPatientWorkspaceController({
    getRepository: async () => { calls.push('factory'); return handlers.factoryDelay ?? repository; },
    isActive: () => active, newId: () => ids.shift()!, today: () => DAY,
  });
  const createDraft = () => {
    assert.equal(controller.beginCreate(), true);
    assert.equal(controller.updateProfile({ name: 'ملف جديد وهمي', mobile: '01000000001' }), true);
  };
  return { controller, calls, commands, handlers, repository, createDraft,
    setActive: (value: boolean) => { active = value; }, setIds: (value: string[]) => { ids = value; },
    setPage: (value: CloudPatientPage) => { page = value; },
    setCurrent: (value: CloudPatientRecord | null) => { current = value; } };
}

test('patient workspace is inert, profile-only and empty until an explicit read', () => {
  const h = harness();
  assert.deepEqual(h.calls, []);
  const state = h.controller.getState();
  assert.equal(state.loaded, false); assert.deepEqual(state.records, []); assert.equal(state.selected, null);
  h.createDraft();
  assert.deepEqual(h.calls, []);
  assert.deepEqual(h.controller.getState().draft, { action: 'create', recordId: ID, expectedRevision: 0,
    profile: { name: 'ملف جديد وهمي', mobile: '01000000001', age: 0, gender: '', firstVisit: DAY, notes: '', allergy: '' } });
  assert.equal('fileNo' in h.controller.getState().draft!, false);
  assert.equal('sessions' in h.controller.getState().draft!.profile, false);
  assert.equal(h.controller.beginCreate(), false);
  assert.equal(h.controller.cancelDraft(), true);
});

test('invalid ID suffix and invalid default dates cannot construct a draft or call a repository', () => {
  for (const input of [{ id: `${ID}\n`, day: DAY }, { id: ID, day: '2026-02-30' },
    { id: ID, day: '2026-01-01\n' }, { id: ID, day: '1899-12-31' }]) {
    let calls = 0;
    const controller = createCloudPatientWorkspaceController({ getRepository: async () => { calls++; throw Error(); },
      isActive: () => true, newId: () => input.id, today: () => input.day });
    assert.equal(controller.beginCreate(), false); assert.equal(controller.getState().draft, null); assert.equal(calls, 0);
  }
});

test('ordinary draft prevents refresh, selection, file lookup, phone lookup and replacing another draft', async () => {
  const h = harness(); h.createDraft();
  await h.controller.refresh(); await h.controller.loadMore(); await h.controller.select(ID);
  await h.controller.findByFileNo(1); await h.controller.findByPhone({ mobile: '01000000001' });
  assert.deepEqual(h.calls, []); assert.equal(h.controller.beginEdit(record()), false);
  assert.equal(h.controller.getState().draft?.recordId, ID);
});

test('explicit paged reads are bounded and detached, with refresh returning to the all query', async () => {
  const h = harness(), raw = record(); h.setPage({ records: [raw], nextAfterId: null });
  await h.controller.refresh();
  assert.deepEqual(h.calls, ['factory', 'list:first:25']);
  const state = h.controller.getState();
  assert.equal(state.loaded, true); assert.equal(state.loading, false); assert.deepEqual(state.query, { kind: 'all' });
  raw.data.name = 'mutation outside the view'; assert.equal(state.records[0].data.name, 'مريض اختبار مصطنع');
  for (const value of [state, state.records, state.records[0], state.records[0].data, state.query]) assert.equal(Object.isFrozen(value), true);
  await h.controller.loadMore(); assert.equal(h.calls.length, 2);
});

test('selection rereads the server; only the exact selected snapshot can enter an edit draft', async () => {
  const h = harness(); h.setPage({ records: [record(1, 'list snapshot')], nextAfterId: null });
  await h.controller.refresh();
  assert.equal(h.controller.beginEdit(h.controller.getState().records[0]), false, 'list snapshots are not a fresh selection');
  h.setCurrent(record(3, 'new server name'));
  await h.controller.select(ID);
  const selected = h.controller.getState().selected!;
  assert.equal(selected.revision, 3); assert.equal(selected.data.name, 'new server name');
  assert.equal(h.controller.beginEdit({ ...selected, data: { ...selected.data, name: 'tampered' } }), false);
  assert.equal(h.controller.beginEdit(selected), true);
  assert.equal(h.controller.getState().draft?.expectedRevision, 3);
  assert.equal(h.controller.getState().draft?.profile.name, 'new server name');
  assert.equal(h.controller.getState().selected, selected);
});

test('file lookup replaces the result subset, preserves public file number and handles missing files without creating anything', async () => {
  const h = harness(); h.setCurrent(record(4, 'synthetic file 451', 451));
  await h.controller.findByFileNo(451);
  assert.deepEqual(h.calls, ['factory', 'file:451']);
  assert.deepEqual(h.controller.getState().query, { kind: 'file', fileNo: 451 });
  assert.equal(h.controller.getState().selected?.fileNo, 451);
  assert.equal(h.controller.getState().records.length, 1); assert.equal(h.controller.getState().nextAfterId, null);
  await h.controller.loadMore(); assert.equal(h.calls.length, 2);
  h.setCurrent(null); await h.controller.findByFileNo(452);
  assert.equal(h.controller.getState().selected, null); assert.deepEqual(h.controller.getState().records, []);
  assert.match(h.controller.getState().notice, /لم يتم إنشاء/); assert.equal(h.commands.length, 0);
});

test('file/ID and invalid phone searches fail before requesting any repository or widening to all records', async () => {
  const h = harness();
  for (const value of [0, -1, NaN, 1.1, Infinity, 2_000_000_001, '1' as any]) await h.controller.findByFileNo(value);
  for (const value of [`${ID}\n`, 'bad-id', null as any]) await h.controller.select(value);
  for (const value of [undefined, null, {}, { mobile: '0100' }, { mobile: '01000000001', limit: 51 },
    { mobile: '01000000001', afterId: `${ID}\n` }]) await h.controller.findByPhone(value as any);
  assert.deepEqual(h.calls, []);
});

test('phone matching is canonical, nonunique and paged without changing query into an all-list request', async () => {
  const h = harness();
  const first = Array.from({ length: 25 }, (_, i) => record(1, `family test ${i}`, i + 1));
  h.setPage({ records: first, nextAfterId: first.at(-1)!.recordId });
  await h.controller.findByPhone({ mobile: '+20 100 000 0001' });
  assert.equal(h.calls.at(-1), 'phone:201000000001:first:25');
  assert.deepEqual(h.controller.getState().query, { kind: 'phone', mobile: '201000000001' });
  assert.equal(h.controller.getState().records.length, 25);
  assert.match(h.controller.getState().notice, /لا ندمج/);
  h.setPage({ records: [record(1, 'another family file', 26)], nextAfterId: null });
  await h.controller.loadMore();
  assert.equal(h.calls.at(-1), `phone:201000000001:${first.at(-1)!.recordId}:25`);
  assert.equal(h.controller.getState().records.length, 26);
  h.setPage({ records: [], nextAfterId: null }); await h.controller.refresh();
  assert.deepEqual(h.controller.getState().query, { kind: 'all' }); assert.equal(h.calls.at(-1), 'list:first:25');
});

test('phone query snapshots input synchronously, supports a reviewed limit up to 50 and retains it on later pages', async () => {
  const h = harness(), gate = deferred<CloudPatientRepository>(); h.handlers.factoryDelay = gate.promise;
  const rows = Array.from({ length: 50 }, (_, i) => record(1, `test ${i}`, i + 1));
  h.setPage({ records: rows, nextAfterId: rows.at(-1)!.recordId });
  const input = { mobile: '01000000001', limit: 50 };
  const pending = h.controller.findByPhone(input); input.mobile = '01000000002'; input.limit = 1;
  gate.resolve(h.repository); await pending;
  assert.equal(h.calls.at(-1), 'phone:201000000001:first:50');
  h.setPage({ records: [], nextAfterId: null }); await h.controller.loadMore();
  assert.equal(h.calls.at(-1), `phone:201000000001:${rows.at(-1)!.recordId}:50`);
});

test('malformed/cross-linked get results never overwrite a confirmed selection', async () => {
  const h = harness(); await h.controller.select(ID);
  const selected = h.controller.getState().selected;
  h.setCurrent(record(2, 'different document', 2)); await h.controller.select(ID);
  assert.equal(h.controller.getState().selected, selected);
  assert.match(h.controller.getState().error, /تعذر فتح/);
  await h.controller.findByFileNo(1); assert.equal(h.controller.getState().selected, selected);
  h.setCurrent({ ...record(), data: { ...record().data, firstVisit: '2026-02-30' } });
  await h.controller.select(ID); assert.equal(h.controller.getState().selected, selected);
});

test('malformed pages, duplicate IDs/files, bad cursor and sparse arrays are rejected without substituting empty defaults', async () => {
  const cases: unknown[] = [
    { records: [record()], nextAfterId: ID },
    { records: [record(1, 'b', 2), record()], nextAfterId: null },
    { records: [record(), record()], nextAfterId: null },
    { records: [record(), { ...record(1, 'second', 2), fileNo: 1 }], nextAfterId: null },
    { records: new Array(1), nextAfterId: null },
    { records: [], nextAfterId: null, private: 'not part of the protocol' },
    { records: [record()], get nextAfterId() { throw Error('PRIVATE'); } },
  ];
  for (const value of cases) {
    const h = harness(); h.setPage({ records: [record()], nextAfterId: null }); await h.controller.refresh();
    const before = h.controller.getState().records;
    h.setPage(value as CloudPatientPage); await h.controller.refresh();
    assert.equal(h.controller.getState().records, before); assert.equal(h.controller.getState().loading, false);
    assert.match(h.controller.getState().error, /تعذر قراءة/); assert.doesNotMatch(h.controller.getState().error, /PRIVATE/);
  }
});

test('phone results from a different family number fail closed even if the envelope is otherwise valid', async () => {
  const h = harness(); h.setPage({ records: [{ ...record(), data: { ...record().data, mobile: '01000000002' } }], nextAfterId: null });
  await h.controller.findByPhone({ mobile: '01000000001' });
  assert.equal(h.controller.getState().loaded, false); assert.deepEqual(h.controller.getState().records, []);
  assert.match(h.controller.getState().error, /تعذر قراءة/);
});

test('profile setters accept bounded partial fields, reject server fields/accessors/symbols, and never call hostile getters', () => {
  const h = harness(); h.createDraft();
  assert.equal(h.controller.updateProfile({ notes: 'ملاحظة\nمصطنعة', allergy: '', age: 120 }), true);
  const before = h.controller.getState().draft;
  let getters = 0;
  for (const value of [null, [], { fileNo: 50 }, { sessions: [] }, { age: -1 }, { age: 121 }, { age: 1.5 },
    { notes: 'a'.repeat(4001) }, { name: undefined }, { name: 'n', [Symbol('x')]: 1 },
    { get name() { getters++; return 'unsafe'; } }]) assert.equal(h.controller.updateProfile(value as any), false);
  assert.equal(getters, 0); assert.equal(h.controller.getState().draft, before);
  assert.equal(Object.isFrozen(before?.profile), true);
});

test('invalid unfinished profiles remain drafts with no repository work or assumed file number', async () => {
  const h = harness(); h.controller.beginCreate(); await h.controller.save();
  assert.deepEqual(h.calls, []); assert.equal(h.controller.getState().saveStatus, 'idle');
  assert.ok(h.controller.getState().draft); assert.equal(h.controller.getState().selected, null);
  assert.match(h.controller.getState().error, /راجع/);
});

test('uncertain save locks editing/cancellation and reuses exactly the same operation and profile', async () => {
  const h = harness(); h.createDraft(); h.handlers.commitError = Error('PRIVATE_LOST_REPLY');
  await h.controller.save();
  assert.equal(h.controller.getState().saveStatus, 'retry-required');
  assert.equal(h.controller.updateProfile({ name: 'changed after uncertain reply' }), false);
  assert.equal(h.controller.cancelDraft(), false); assert.equal(h.controller.beginCreate(), false);
  await h.controller.refresh(); await h.controller.select(ID); await h.controller.findByFileNo(1);
  assert.deepEqual(h.calls, ['factory', 'commit']);
  assert.equal(Object.isFrozen(h.commands[0]), true); assert.equal(Object.isFrozen(h.commands[0].profile), true);
  h.handlers.commitError = null; h.handlers.commitResult = { status: 'already-committed', recordId: ID, fileNo: 1, revision: 1 };
  h.setCurrent(record(3, 'newer device name')); h.setPage({ records: [record(3, 'newer device name')], nextAfterId: null });
  await h.controller.save();
  assert.equal(h.commands.length, 2); assert.equal(h.commands[0], h.commands[1]);
  assert.equal(h.commands[1].operationId, OP); assert.equal(h.controller.getState().saveStatus, 'idle');
  assert.equal(h.controller.getState().draft, null); assert.equal(h.controller.getState().selected?.data.name, 'newer device name');
  assert.equal(h.controller.getState().records[0].revision, 3);
  assert.doesNotMatch(h.controller.getState().error, /PRIVATE/);
});

test('acknowledged saves with failed GET retry reads only and retain a fixed server file number', async () => {
  const h = harness(); h.createDraft(); h.handlers.getError = Error('PRIVATE_GET_FAILURE');
  await h.controller.save();
  assert.equal(h.controller.getState().saveStatus, 'refresh-required'); assert.match(h.controller.getState().error, /الحفظ مؤكد/);
  assert.equal(h.controller.updateProfile({ name: 'unsafe' }), false); assert.equal(h.controller.cancelDraft(), false);
  h.handlers.getError = null; await h.controller.save();
  assert.equal(h.commands.length, 1); assert.equal(h.controller.getState().selected?.fileNo, 1);
  assert.equal(h.controller.getState().saveStatus, 'idle');
  assert.deepEqual(h.calls, ['factory', 'commit', `get:${ID}`, `get:${ID}`, 'list:first:25']);
});

test('acknowledged saves with failed list also retry reads only and never publish a submitted draft', async () => {
  const h = harness(); h.createDraft(); h.handlers.listError = Error('PRIVATE_LIST_FAILURE');
  await h.controller.save();
  assert.equal(h.controller.getState().saveStatus, 'refresh-required'); assert.equal(h.controller.getState().selected, null);
  h.handlers.listError = null; h.setCurrent(record(4, 'fresh name, not submitted name')); await h.controller.save();
  assert.equal(h.commands.length, 1); assert.equal(h.controller.getState().selected?.data.name, 'fresh name, not submitted name');
});

test('confirmed selected record remains available even outside the first UUID page; newer first-page snapshots win', async () => {
  const h = harness(); h.createDraft(); h.setPage({ records: [record(1, 'another file', 2)], nextAfterId: null });
  await h.controller.save();
  assert.equal(h.controller.getState().selected?.recordId, ID); assert.equal(h.controller.getState().records[0].recordId, OTHER);
  const newer = harness(); newer.createDraft(); newer.setCurrent(record(2, 'GET version'));
  newer.setPage({ records: [record(3, 'later first-page version')], nextAfterId: null }); await newer.controller.save();
  assert.equal(newer.controller.getState().selected?.revision, 3); assert.equal(newer.controller.getState().records[0].revision, 3);
  const stalePage = harness(); stalePage.createDraft(); stalePage.setCurrent(record(3, 'GET version'));
  stalePage.setPage({ records: [record(2, 'older list row')], nextAfterId: null }); await stalePage.controller.save();
  assert.equal(stalePage.controller.getState().selected?.revision, 3); assert.equal(stalePage.controller.getState().records[0].revision, 3);
});

test('invalid/mismatched receipts stay uncertain; inconsistent post-ack profile remains read-refresh-required', async () => {
  for (const result of [{ status: 'committed', recordId: OTHER, fileNo: 1, revision: 1 },
    { status: 'committed', recordId: ID, fileNo: 0, revision: 1 },
    { status: 'committed', recordId: ID, fileNo: 1, revision: 99 }]) {
    const h = harness(); h.createDraft(); h.handlers.commitResult = result as CloudPatientCommit;
    await h.controller.save(); assert.equal(h.controller.getState().saveStatus, 'retry-required');
    assert.equal(h.calls.some(call => call.startsWith('get:')), false);
  }
  const h = harness(); h.createDraft(); h.setCurrent({ ...record(), fileNo: 999 });
  await h.controller.save(); assert.equal(h.controller.getState().saveStatus, 'refresh-required');
  assert.equal(h.controller.getState().selected, null); h.setCurrent(record()); await h.controller.save();
  assert.equal(h.commands.length, 1);
});

test('post-ack list cannot change content at an existing revision or allocate the selected public number to another UUID', async () => {
  for (const row of [record(1, 'different content at the same revision'), { ...record(1, 'other UUID', 2), fileNo: 1 }]) {
    const h = harness(); h.createDraft(); h.setPage({ records: [row], nextAfterId: null });
    await h.controller.save(); assert.equal(h.controller.getState().saveStatus, 'refresh-required');
    assert.equal(h.controller.getState().selected, null);
    h.setPage({ records: [record()], nextAfterId: null }); await h.controller.save();
    assert.equal(h.commands.length, 1); assert.equal(h.controller.getState().saveStatus, 'idle');
  }
});

test('CAS conflict preserves stale expected revision without rebasing and requires cancellation then fresh selection', async () => {
  const h = harness(); h.setIds([OP, '20000000-0000-4000-8000-000000000002']);
  await h.controller.select(ID); const selected = h.controller.getState().selected!;
  assert.equal(h.controller.beginEdit(selected), true); h.controller.updateProfile({ name: 'stale edited draft' });
  h.handlers.commitError = new CloudPatientError('conflict'); await h.controller.save();
  assert.equal(h.controller.getState().saveStatus, 'idle'); assert.equal(h.controller.getState().draft?.expectedRevision, 1);
  assert.match(h.controller.getState().error, /ألغِها/); assert.equal(h.controller.getState().selected, selected);
  h.setCurrent(record(5, 'newer server version')); await h.controller.select(ID);
  assert.equal(h.controller.getState().selected, selected, 'ordinary stale draft blocks changing its base');
  h.controller.updateProfile({ name: 'second stale edit' }); await h.controller.save();
  assert.deepEqual(h.commands.map(command => command.expectedRevision), [1, 1]);
  assert.notEqual(h.commands[0].operationId, h.commands[1].operationId);
  assert.equal(h.controller.cancelDraft(), true); await h.controller.select(ID);
  assert.equal(h.controller.beginEdit(h.controller.getState().selected!), true);
  assert.equal(h.controller.getState().draft?.expectedRevision, 5);
});

test('update receipt cannot change the original public file number or downgrade selected revision', async () => {
  const h = harness(); h.setIds([OP]); await h.controller.select(ID); h.controller.beginEdit(h.controller.getState().selected!);
  h.handlers.commitResult = { status: 'committed', recordId: ID, fileNo: 999, revision: 2 };
  await h.controller.save(); assert.equal(h.controller.getState().saveStatus, 'retry-required');
  assert.equal(h.controller.getState().selected?.fileNo, 1);
  h.handlers.commitResult = { status: 'already-committed', recordId: ID, fileNo: 1, revision: 2 };
  h.setCurrent(record(1)); await h.controller.save(); assert.equal(h.controller.getState().saveStatus, 'refresh-required');
  h.setCurrent(record(2)); await h.controller.save(); assert.equal(h.controller.getState().saveStatus, 'idle');
  assert.equal(h.commands.length, 2, 'post-ack stale reads never resubmit the mutation');
});

test('invalid definite-save errors retain an editable draft without leaking raw errors', async () => {
  const h = harness(); h.createDraft(); h.handlers.commitError = new CloudPatientError('invalid'); await h.controller.save();
  assert.equal(h.controller.getState().saveStatus, 'idle'); assert.ok(h.controller.getState().draft);
  assert.equal(h.controller.updateProfile({ name: 'fixed input' }), true); assert.equal(h.controller.cancelDraft(), true);
});

test('duplicate clicks during commit or reads cannot issue extra requests and disposal ignores a late accepted write', async () => {
  const h = harness(), gate = deferred<CloudPatientCommit>(); h.createDraft(); h.handlers.commitDelay = gate.promise;
  const pending = h.controller.save(); await tick(); await h.controller.save(); await h.controller.refresh();
  await h.controller.findByFileNo(1); assert.equal(h.commands.length, 1); assert.equal(h.controller.cancelDraft(), false);
  h.controller.dispose(); gate.resolve({ status: 'committed', recordId: ID, fileNo: 1, revision: 1 }); await pending;
  assert.equal(h.controller.getState().closed, true); assert.equal(h.controller.getState().draft, null);
  assert.equal(h.calls.some(call => call.startsWith('get:') || call.startsWith('list:')), false);
});

test('actual identity loss clears records, selected file and ordinary/uncertain drafts permanently', async () => {
  for (const uncertain of [false, true]) {
    const h = harness(); h.setPage({ records: [record()], nextAfterId: null }); await h.controller.refresh();
    await h.controller.select(ID); h.createDraft();
    if (uncertain) { h.handlers.commitError = Error('lost'); await h.controller.save(); }
    h.setActive(false); const closed = h.controller.getState();
    assert.equal(closed.closed, true); assert.equal(closed.draft, null); assert.equal(closed.selected, null); assert.deepEqual(closed.records, []);
    h.setActive(true); assert.equal(h.controller.beginCreate(), false); const before = h.calls.length;
    await h.controller.save(); await h.controller.refresh(); assert.equal(h.calls.length, before);
  }
});

test('late page/get/factory responses cannot revive a disposed or identity-lost workspace', async () => {
  for (const mode of ['factory', 'page', 'get'] as const) {
    const h = harness(), factory = deferred<CloudPatientRepository>(), page = deferred<CloudPatientPage>(), get = deferred<CloudPatientRecord | null>();
    if (mode === 'factory') h.handlers.factoryDelay = factory.promise;
    if (mode === 'page') h.handlers.listDelay = page.promise;
    if (mode === 'get') h.handlers.getDelay = get.promise;
    const pending = mode === 'get' ? h.controller.select(ID) : h.controller.refresh(); await tick();
    h.setActive(false); assert.equal(h.controller.getState().closed, true);
    factory.resolve(h.repository); page.resolve({ records: [record()], nextAfterId: null }); get.resolve(record()); await pending;
    assert.deepEqual(h.controller.getState().records, []); assert.equal(h.controller.getState().selected, null);
    if (mode === 'factory') assert.deepEqual(h.calls, ['factory']);
  }
});

test('reentrant lifetime and patch callbacks cannot publish a closed draft or start a repository request', async () => {
  let closeInCheck = false, factories = 0;
  const controller = createCloudPatientWorkspaceController({ getRepository: async () => { factories++; throw Error(); },
    isActive: () => { if (closeInCheck) controller.dispose(); return true; } });
  closeInCheck = true; await controller.refresh();
  assert.equal(controller.getState().closed, true); assert.equal(controller.getState().loading, false); assert.equal(factories, 0);
  const h = harness(); h.createDraft();
  const patch = new Proxy({ name: 'test' }, { getOwnPropertyDescriptor(target, key) { h.controller.dispose(); return Reflect.getOwnPropertyDescriptor(target, key); } });
  assert.equal(h.controller.updateProfile(patch), false); assert.equal(h.controller.getState().draft, null);
});

test('listener-triggered disposal during a loading/save publication happens before factory or SDK boundaries', async () => {
  for (const save of [false, true]) {
    const h = harness(); if (save) h.createDraft();
    h.controller.subscribe(value => { if (value.loading || value.saveStatus === 'saving') h.controller.dispose(); });
    if (save) await h.controller.save(); else await h.controller.refresh();
    assert.deepEqual(h.calls, []); assert.equal(h.controller.getState().closed, true);
  }
});

test('later cursor pages remain reachable after the 500-record display window', async () => {
  const h = harness();
  for (let page = 0; page < 21; page++) {
    const rows = Array.from({ length: 25 }, (_, offset) => record(1, 'synthetic only', page * 25 + offset + 1));
    h.setPage({ records: rows, nextAfterId: rows.at(-1)!.recordId });
    if (!page) await h.controller.refresh(); else await h.controller.loadMore();
  }
  assert.equal(h.controller.getState().records.length, 500); assert.equal(h.controller.getState().records[0].fileNo, 26);
  assert.equal(h.controller.getState().nextAfterId, record(1, '', 525).recordId); assert.match(h.controller.getState().notice, /لم تُحذف/);
  h.setPage({ records: [], nextAfterId: null }); await h.controller.loadMore();
  assert.equal(h.controller.getState().nextAfterId, null); assert.equal(h.calls.filter(call => call.startsWith('list:')).length, 22);
});

test('subscribe/unsubscribe are inert and disposed controllers never notify or regain authority', () => {
  const h = harness(); let count = 0;
  const unsubscribe = h.controller.subscribe(() => count++); assert.equal(count, 0);
  h.controller.beginCreate(); assert.equal(count, 1); unsubscribe(); h.controller.cancelDraft(); assert.equal(count, 1);
  h.controller.dispose(); h.controller.subscribe(() => count++); h.controller.dispose(); assert.equal(count, 1);
  assert.deepEqual(h.calls, []);
});

test('workspace dependencies exclude local App, storage, Auth SDK and clinical financial data', async () => {
  const built = await build({ entryPoints: ['src/utils/cloudPatientWorkspaceController.ts'], bundle: true,
    write: false, metafile: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
  assert.equal(Object.keys(built.metafile!.inputs).some(path => /(?:App\.tsx|components\/|utils\/(?:storage|localClinicBackup|firebaseService|offlineSync|cloudOperatingAuth)|node_modules\/.*firebase)/.test(path)), false);
});
