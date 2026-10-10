import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createCloudOperatingAuthSession, type CloudOperatingAuthAdapter } from './cloudOperatingAuth';
import { createCloudOperatingPageController } from './cloudOperatingPageController';
import { createCloudContactRepository, type CloudContactAdapter, type CloudContactRecord } from './cloudContactRepository';

// Composition tests only: real pure Auth/page/workspace/repository modules,
// fabricated membership and an in-memory server. No SDK, emulator, live login,
// local browser storage, campaign consent or patient data are represented here.
const EMAIL = 'lifecycle-owner@example.invalid';
const PASSWORD = 'synthetic-password-only';
const UID = 'synthetic-lifecycle-owner';
const AUTH_TIME = 1_700_000_000;
const TIME = '2026-10-10T10:00:00.000Z';
const OP = '20000000-0000-4000-8000-000000000001';
const NEXT_OP = '20000000-0000-4000-8000-000000000002';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
}

function member(): Awaited<ReturnType<CloudOperatingAuthAdapter['readOwner']>> {
  return { identity: { uid: UID, email: EMAIL, status: 'owner-confirmed' },
    membership: { schemaVersion: 1, clinicId: 'main', uid: UID, role: 'owner', status: 'active',
      identityVersion: 1, verifiedAfter: AUTH_TIME }, authTime: AUTH_TIME };
}

function fixture() {
  const rows = new Map<string, any>();
  const calls: string[] = [];
  const hooks: {
    ownerGate?: ReturnType<typeof deferred>;
    ownerStarted?: ReturnType<typeof deferred>;
    capabilityGate?: ReturnType<typeof deferred>;
    capabilityStarted?: ReturnType<typeof deferred>;
    commitReplyGate?: ReturnType<typeof deferred>;
    commitAccepted?: ReturnType<typeof deferred>;
    loseReply?: boolean;
    failRecordRead?: boolean;
  } = {};
  let writes = 0;
  const auth = createCloudOperatingAuthSession({
    signIn: async () => { calls.push('auth:signIn'); },
    readOwner: async () => {
      calls.push('auth:readOwner'); hooks.ownerStarted?.resolve(undefined);
      await hooks.ownerGate?.promise;
      return member();
    },
    signOut: async () => { calls.push('auth:signOut'); },
    destroy: async () => { calls.push('auth:destroy'); },
  });
  const adapter: CloudContactAdapter = {
    authorizeOwner: async () => (await auth.authorizeOwner()).uid,
    readRecord: async path => {
      calls.push('data:get');
      if (hooks.failRecordRead) { hooks.failRecordRead = false; throw new Error('SYNTHETIC_REFRESH_FAILURE'); }
      return structuredClone(rows.get(path) ?? null);
    },
    listRecordsPage: async (afterId, maximum) => {
      calls.push(`data:list:${afterId ?? 'first'}:${maximum}`);
      return [...rows.entries()].filter(([path]) => path.startsWith('clinics/main/contactRecords/'))
        .map(([path, data]) => ({ id: path.split('/').at(-1)!, data: structuredClone(data) }))
        .filter(row => afterId === null || row.id > afterId).sort((a, b) => a.id < b.id ? -1 : 1).slice(0, maximum);
    },
    runTransaction: async work => {
      calls.push('data:transaction');
      const staged = new Map(rows), changed: string[] = [];
      const result = await work({
        get: async path => structuredClone(staged.get(path) ?? null),
        set: (path, value) => { staged.set(path, structuredClone(value)); changed.push(path); },
        delete: path => { staged.delete(path); changed.push(path); },
      });
      rows.clear(); for (const [path, value] of staged) rows.set(path, value);
      writes += changed.length;
      if (changed.length) {
        hooks.commitAccepted?.resolve(undefined); await hooks.commitReplyGate?.promise;
        if (hooks.loseReply) { hooks.loseReply = false; throw new Error('SYNTHETIC_LOST_ACKNOWLEDGEMENT'); }
      }
      return result;
    },
  };
  const digest = async (value: string) => createHash('sha256').update(value).digest('hex');
  const repository = createCloudContactRepository(adapter, { digest });
  // This seam deliberately has no SDK and can return late after logout. The
  // page lease, not this fabricated capability factory, must reject that view.
  const session = { ...auth, getContacts: async () => {
    calls.push('capability'); await auth.authorizeOwner();
    hooks.capabilityStarted?.resolve(undefined); await hooks.capabilityGate?.promise;
    return repository;
  } };
  const page = createCloudOperatingPageController(async () => session, () => true);
  const independent = createCloudContactRepository({ ...adapter, authorizeOwner: async () => UID }, { digest });
  const loginAndOpen = async () => {
    await page.signIn(EMAIL, PASSWORD);
    const workspace = await page.openContacts();
    assert.ok(workspace);
    return workspace;
  };
  const createDraft = (workspace: NonNullable<Awaited<ReturnType<typeof page.openContacts>>>) => {
    assert.equal(workspace.beginCreate(), true);
    assert.equal(workspace.changeDraft({ name: 'جهة مصطنعة', mobile: '01000000001' }), true);
  };
  return { rows, calls, hooks, auth, page, repository, independent, loginAndOpen, createDraft, writes: () => writes };
}

test('Auth/page/workspace composition keeps explicit opening inert and preserves a draft across per-read checking', async () => {
  const h = fixture();
  assert.deepEqual(h.calls, []);
  const workspace = await h.loginAndOpen();
  assert.equal(h.calls.some(call => call.startsWith('data:')), false, 'opening does not list or save');
  h.createDraft(workspace);
  const draft = workspace.getState().draft;
  h.hooks.ownerGate = deferred(); h.hooks.ownerStarted = deferred();
  const loading = workspace.loadFirst();
  await h.hooks.ownerStarted.promise;
  assert.equal(h.auth.getState().phase, 'checking');
  assert.equal(h.page.getContactsWorkspace(), workspace);
  assert.equal(workspace.getState().draft, draft);
  assert.equal(workspace.getState().closed, false);
  h.hooks.ownerGate.resolve(undefined); await loading;
  assert.equal(workspace.getState().loaded, true);
  assert.equal(workspace.getState().draft, draft);
  h.hooks.ownerGate = deferred(); h.hooks.ownerStarted = deferred();
  const refresh = h.page.refresh();
  await h.hooks.ownerStarted.promise;
  assert.equal(h.page.getContactsWorkspace(), workspace);
  assert.equal(workspace.getState().draft, draft);
  h.hooks.ownerGate.resolve(undefined); await refresh;
  assert.equal(h.page.getContactsWorkspace(), workspace);
  await h.page.dispose();
  assert.equal(workspace.getState().closed, true);
});

test('a capability opening that resolves after logout cannot mount a workspace or read records', async () => {
  const h = fixture(); await h.page.signIn(EMAIL, PASSWORD);
  h.hooks.capabilityGate = deferred(); h.hooks.capabilityStarted = deferred();
  const opening = h.page.openContacts();
  await h.hooks.capabilityStarted.promise;
  const logout = h.page.signOut();
  assert.equal(h.page.getContactsWorkspace(), null);
  h.hooks.capabilityGate.resolve(undefined);
  assert.equal(await opening, null);
  assert.equal(await logout, true);
  assert.equal(h.page.getContactsWorkspace(), null);
  assert.equal(h.calls.some(call => call.startsWith('data:')), false);
  await h.page.dispose();
});

test('lease survives uncertain real-core retry, prevents close, and displays a later confirmed revision without duplicate writes', async () => {
  const h = fixture(), workspace = await h.loginAndOpen(); h.createDraft(workspace);
  h.hooks.loseReply = true;
  await workspace.save();
  assert.equal(workspace.getState().saveStatus, 'retry-required');
  assert.equal(h.page.getContactsWorkspace(), workspace);
  assert.equal(h.page.closeContacts(), false);
  const saved = [...h.rows.entries()].find(([path]) => path.startsWith('clinics/main/contactRecords/'))![1] as CloudContactRecord;
  const latest = { ...saved.data!, name: 'تعديل مصطنع أحدث' };
  await h.independent.commit({ operationId: NEXT_OP, recordId: saved.recordId, expectedRevision: 1, action: 'update', contact: latest });
  const beforeRetry = h.writes();
  await workspace.save();
  assert.equal(h.writes(), beforeRetry, 'the retained historical operation adds no writes');
  assert.equal(workspace.getState().saveStatus, 'idle');
  assert.equal(workspace.getState().records[0].revision, 2);
  assert.equal(workspace.getState().records[0].data?.name, latest.name);
  assert.equal(workspace.getState().draft, null);
  assert.equal(h.page.closeContacts(), true);
  assert.equal(workspace.getState().closed, true);
  await h.page.dispose();
});

test('confirmed write plus failed refresh keeps the lease locked and retries reads, not another transaction', async () => {
  const h = fixture(), workspace = await h.loginAndOpen(); h.createDraft(workspace);
  h.hooks.failRecordRead = true;
  await workspace.save();
  assert.equal(workspace.getState().saveStatus, 'refresh-required');
  assert.equal(h.page.closeContacts(), false);
  const writes = h.writes(), transactions = h.calls.filter(call => call === 'data:transaction').length;
  await workspace.save();
  assert.equal(h.writes(), writes);
  assert.equal(h.calls.filter(call => call === 'data:transaction').length, transactions);
  assert.equal(workspace.getState().saveStatus, 'idle');
  assert.equal(workspace.getState().records.length, 1);
  await h.page.dispose();
});

test('logout disposes an accepted pending write view without claiming to undo the synthetic server commit', async () => {
  const h = fixture(), workspace = await h.loginAndOpen(); h.createDraft(workspace);
  h.hooks.commitReplyGate = deferred(); h.hooks.commitAccepted = deferred();
  const saving = workspace.save();
  await h.hooks.commitAccepted.promise;
  assert.equal(h.page.closeContacts(), false);
  const logout = h.page.signOut();
  assert.equal(workspace.getState().closed, true);
  assert.equal(workspace.getState().draft, null);
  assert.equal(h.page.getContactsWorkspace(), null);
  h.hooks.commitReplyGate.resolve(undefined);
  await saving; await logout;
  assert.equal(workspace.getState().records.length, 0);
  assert.equal([...h.rows.keys()].filter(path => path.includes('/contactRecords/')).length, 1);
  assert.equal([...h.rows.keys()].filter(path => path.includes('/contactOperations/')).length, 1);
  await h.page.dispose();
});

test('all-tombstone first page remains owned and its live successor is reachable through the real repository cursor', async () => {
  const h = fixture(), workspace = await h.loginAndOpen();
  const ids = Array.from({ length: 26 }, (_, index) => `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`);
  for (const [index, id] of ids.entries()) {
    const deleted = index < 25;
    h.rows.set(`clinics/main/contactRecords/${id}`, { schemaVersion: 1, clinicId: 'main', recordId: id,
      revision: deleted ? 2 : 1, deleted, lastOperationId: OP,
      phoneKey: deleted ? null : createHash('sha256').update('contact-phone-v1:201000000001').digest('hex'),
      data: deleted ? null : { id, name: 'آخر جهة مصطنعة', mobile: '01000000001', createdAt: TIME } });
  }
  assert.equal(workspace.getState().loaded, false);
  await workspace.loadFirst();
  assert.equal(workspace.getState().records.length, 25);
  assert.equal(workspace.getState().records.every(row => row.deleted), true);
  assert.equal(workspace.getState().nextAfterId, ids[24]);
  assert.equal(h.page.getContactsWorkspace(), workspace);
  await workspace.loadMore();
  assert.equal(workspace.getState().records.filter(row => !row.deleted).length, 1);
  assert.equal(workspace.getState().records.at(-1)?.recordId, ids[25]);
  assert.equal(workspace.getState().nextAfterId, null);
  await h.page.dispose();
});
