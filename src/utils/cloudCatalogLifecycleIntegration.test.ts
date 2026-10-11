import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createCloudOperatingAuthSession, type CloudOperatingAuthAdapter } from './cloudOperatingAuth';
import { createCloudOperatingPageController } from './cloudOperatingPageController';
import { createCloudServiceCatalogRepository, type CloudServiceCatalogAdapter, type CloudServiceCatalogData } from './cloudServiceCatalogRepository';
import { createCloudOperationIntentRepository, type CloudIntentAdapter } from './cloudOperationIntent';

// Actual pure Auth/page/catalog/journal/repository composition on a fabricated
// atomic store. No SDK, real identity, browser data, Rules or Hosting is used.
const UID = 'synthetic-catalog-lifecycle-owner', EMAIL = 'catalog-lifecycle@example.invalid';
const PASSWORD = 'synthetic-password-only', AUTH_TIME = 1_700_000_000;
const SERVICE = '30000000-0000-4000-8000-000000000001';
const CATALOG = 'clinics/main/settings/serviceCatalog';
const path = (kind: string, id = '') => `clinics/main/${kind}/${id}`;
const digest = async (value: string) => createHash('sha256').update(value).digest('hex');
const data = (fee = 10_000, price = 30_000): CloudServiceCatalogData => ({ examinationCents: fee,
  services: [{ serviceId: SERVICE, name: 'خدمة علاجية مصطنعة', kind: 'clinical', priceCents: price, active: true }] });
function deferred() { let resolve!: () => void; const promise = new Promise<void>(accept => { resolve = accept; }); return { promise, resolve }; }
function member(): Awaited<ReturnType<CloudOperatingAuthAdapter['readOwner']>> {
  return { identity: { uid: UID, email: EMAIL, status: 'owner-confirmed' },
    membership: { schemaVersion: 1, clinicId: 'main', uid: UID, role: 'owner', status: 'active',
      identityVersion: 1, verifiedAfter: AUTH_TIME }, authTime: AUTH_TIME };
}
function syntheticServer() {
  const rows = new Map<string, any>(), calls: string[] = [];
  const hooks: { loseCommitAck?: boolean; pauseCommit?: boolean;
    accepted?: ReturnType<typeof deferred>; replyGate?: ReturnType<typeof deferred> } = {};
  let writes = 0, tail = Promise.resolve();
  const runTransaction: CloudServiceCatalogAdapter['runTransaction'] = async work => {
    const previous = tail; let release!: () => void;
    tail = new Promise<void>(accept => { release = accept; }); await previous;
    try {
      const staged = structuredClone(rows), changed: string[] = []; let wrote = false;
      const result = await work({
        get: async key => { assert.equal(wrote, false, 'all transaction reads precede writes');
          calls.push(`data:tx:get:${key}`); return structuredClone(staged.get(key) ?? null); },
        set: (key, value) => { wrote = true; changed.push(key); staged.set(key, structuredClone(value)); },
      });
      // Failed transaction bodies publish nothing; accepted transactions are
      // atomic even when their later acknowledgement is paused or lost.
      rows.clear(); for (const [key, value] of staged) rows.set(key, value); writes += changed.length;
      if (changed.includes(CATALOG)) {
        calls.push('data:accepted:catalog');
        if (hooks.pauseCommit) { hooks.pauseCommit = false; hooks.accepted?.resolve(); await hooks.replyGate?.promise; }
        if (hooks.loseCommitAck) { hooks.loseCommitAck = false; throw new Error('SYNTHETIC_ACCEPTED_ACK_LOST'); }
      }
      return result;
    } finally { release(); }
  };
  const readRecord = async (key: string) => { calls.push(`data:get:${key}`); return structuredClone(rows.get(key) ?? null); };
  function list(kind: string, uid: string, after: string | null, limit: number, preparedOnly: boolean) {
    calls.push(`data:list:${preparedOnly ? 'prepared' : 'history'}`);
    return [...rows].filter(([key, value]) => key.startsWith(path('operationIntents')) && value.kind === kind
      && value.actorUid === uid && (!preparedOnly || value.status === 'prepared') && (!after || value.operationId > after))
      .sort(([a], [b]) => a < b ? -1 : 1).slice(0, limit)
      .map(([key, value]) => ({ id: key.split('/').at(-1)!, data: structuredClone(value) }));
  }
  function client() {
    const authHooks: { gate?: ReturnType<typeof deferred>; started?: ReturnType<typeof deferred> } = {};
    const auth = createCloudOperatingAuthSession({
      signIn: async () => { calls.push('auth:sign-in'); },
      readOwner: async () => { calls.push('auth:read-owner'); authHooks.started?.resolve(); await authHooks.gate?.promise; return member(); },
      signOut: async () => { calls.push('auth:sign-out'); }, destroy: async () => { calls.push('auth:destroy'); },
    });
    const authorizeOwner = async () => (await auth.authorizeOwner()).uid;
    const adapter: CloudServiceCatalogAdapter & CloudIntentAdapter = { authorizeOwner, runTransaction, readRecord,
      listPreparedPage: async (kind, uid, after, limit) => list(kind, uid, after, limit, true),
      listHistoryPage: async (kind, uid, after, limit) => list(kind, uid, after, limit, false) };
    const repository = createCloudServiceCatalogRepository(adapter, { digest });
    const journal = createCloudOperationIntentRepository(adapter, { digest });
    const session = { ...auth, getServiceCatalog: async () => {
      calls.push('capability:catalog'); await auth.authorizeOwner(); return { repository, journal };
    } };
    const page = createCloudOperatingPageController(async () => session, () => true);
    const open = async () => { await page.signIn(EMAIL, PASSWORD); const workspace = await page.openCatalog(); assert.ok(workspace); return workspace; };
    return { auth, authHooks, page, repository, journal, open };
  }
  const count = (kind: string) => [...rows.keys()].filter(key => key.startsWith(path(kind))).length;
  return { rows, calls, hooks, client, count, writes: () => writes };
}

test('pure owner page explicitly opens/loads/edits/saves catalog with one atomic revision and no clinical/cash records', async () => {
  const server = syntheticServer(), client = server.client(); assert.deepEqual(server.calls, []);
  const workspace = await client.open(); assert.equal(server.calls.some(call => call.startsWith('data:')), false);
  assert.equal(server.writes(), 0); assert.equal(await workspace.load(), true); assert.equal(workspace.getState().snapshot, null);
  assert.equal(workspace.beginEdit(), true); assert.equal(workspace.getState().draft?.examinationCents, null);
  assert.equal(workspace.updateDraft(data()), true); assert.equal(await workspace.save(), true);
  const current = workspace.getState().snapshot!; assert.equal(current.revision, 1); assert.deepEqual(current.data, data());
  assert.equal(workspace.getState().saveStatus, 'idle'); assert.equal(workspace.getState().draft, null);
  assert.equal(server.writes(), 4); assert.equal(server.count('catalogOperations'), 1); assert.equal(server.count('operationIntents'), 1);
  assert.equal(server.rows.get(path('operationIntents', current.lastOperationId)).status, 'committed');
  assert.equal([...server.rows.keys()].some(key => /patient|receipt|lab|contact|counter/i.test(key)), false);
  assert.equal(client.page.closeCatalog(workspace), true); await client.page.dispose();
});

test('lost catalog commit ACK survives actual logout and new-page all-status history resumes the same ID without another revision', async () => {
  const server = syntheticServer(), old = server.client(), workspace = await old.open(); await workspace.load();
  workspace.beginEdit(); workspace.updateDraft(data()); server.hooks.loseCommitAck = true;
  assert.equal(await workspace.save(), false); const operationId = workspace.getState().pendingOperationId!;
  assert.equal(workspace.getState().saveStatus, 'retry-required'); assert.equal(server.rows.get(CATALOG).revision, 1);
  const original = structuredClone(server.rows.get(path('operationIntents', operationId)));
  assert.equal(original.status, 'committed'); assert.equal((await old.journal.listPreparedPage('catalog')).records.length, 0);
  assert.equal(old.page.closeCatalog(workspace), false); assert.equal(await old.page.signOut(), true);
  assert.equal(workspace.getState().closed, true); assert.equal(workspace.getState().pendingOperationId, null);
  const fresh = server.client(), recovered = await fresh.open(); await recovered.loadHistory();
  assert.deepEqual(recovered.getState().history.map(row => [row.operationId, row.status]), [[operationId, 'committed']]);
  assert.deepEqual(recovered.getState().history[0].command, original.command);
  const before = server.writes(); assert.equal(await recovered.resume(operationId), true); assert.equal(server.writes(), before);
  assert.equal(recovered.getState().snapshot?.revision, 1); assert.deepEqual(recovered.getState().snapshot?.data, data());
  assert.equal(server.count('catalogOperations'), 1); assert.deepEqual(server.rows.get(path('operationIntents', operationId)).command, original.command);
  await old.page.dispose(); await fresh.page.dispose();
});

test('historical catalog resume refreshes newer accepted prices rather than overwriting them with the old operation', async () => {
  const server = syntheticServer(), first = server.client(), oldWorkspace = await first.open(); await oldWorkspace.load();
  oldWorkspace.beginEdit(); oldWorkspace.updateDraft(data()); assert.equal(await oldWorkspace.save(), true);
  const originalId = oldWorkspace.getState().snapshot!.lastOperationId; await first.page.signOut();
  const newer = server.client(), workspace = await newer.open(); await workspace.load(); workspace.beginEdit(); workspace.updateDraft(data(15_000, 45_000));
  assert.equal(await workspace.save(), true); const newerId = workspace.getState().snapshot!.lastOperationId; assert.notEqual(originalId, newerId);
  const before = server.writes(); assert.equal(await workspace.resume(originalId), true); assert.equal(server.writes(), before);
  assert.equal(workspace.getState().snapshot?.revision, 2); assert.equal(workspace.getState().snapshot?.lastOperationId, newerId);
  assert.deepEqual(workspace.getState().snapshot?.data, data(15_000, 45_000)); assert.deepEqual(server.rows.get(CATALOG).data, data(15_000, 45_000));
  assert.equal(server.count('catalogOperations'), 2); await first.page.dispose(); await newer.page.dispose();
});

test('accepted catalog write survives checking/logout while old memory and late success are masked and a fresh page recovers it', async () => {
  const server = syntheticServer(), old = server.client(), workspace = await old.open(); await workspace.load(); workspace.beginEdit(); workspace.updateDraft(data());
  server.hooks.pauseCommit = true; server.hooks.accepted = deferred(); server.hooks.replyGate = deferred();
  const saving = workspace.save(); await server.hooks.accepted.promise; const operationId = workspace.getState().pendingOperationId!;
  assert.equal(server.rows.get(CATALOG).revision, 1); assert.equal(server.rows.get(path('operationIntents', operationId)).status, 'committed');
  old.authHooks.gate = deferred(); old.authHooks.started = deferred(); const checking = old.page.refresh(); await old.authHooks.started.promise;
  assert.equal(old.auth.getState().phase, 'checking'); assert.equal(old.page.getCatalogWorkspace(), workspace);
  assert.equal(workspace.getState().pendingOperationId, operationId); const logout = old.page.signOut();
  assert.equal(old.page.getCatalogWorkspace(), null); assert.equal(workspace.getState().closed, true); assert.equal(workspace.getState().snapshot, null);
  assert.equal(workspace.getState().draft, null); assert.deepEqual(workspace.getState().history, []);
  old.authHooks.gate.resolve(); server.hooks.replyGate.resolve(); assert.equal(await saving, false); await checking; assert.equal(await logout, true);
  assert.equal(workspace.getState().notice, ''); assert.equal(workspace.getState().pendingOperationId, null); assert.equal(server.rows.get(CATALOG).revision, 1);
  const fresh = server.client(), recovered = await fresh.open(); await recovered.loadHistory();
  assert.equal(recovered.getState().history[0].operationId, operationId); assert.equal(recovered.getState().history[0].status, 'committed');
  const before = server.writes(); assert.equal(await recovered.resume(operationId), true); assert.equal(server.writes(), before);
  assert.equal(recovered.getState().snapshot?.revision, 1); assert.equal(server.count('catalogOperations'), 1);
  await old.page.dispose(); await fresh.page.dispose();
});
