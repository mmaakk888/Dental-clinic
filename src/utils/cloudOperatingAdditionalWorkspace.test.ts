import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudOperatingAuthSession, type CloudOperatingAuthAdapter } from './cloudOperatingAuth';
import { createCloudOperatingPageController, type CloudOperatingAdditionalContext,
  type CloudOperatingAdditionalWorkspace, type CloudOperatingPageSession } from './cloudOperatingPageController';
const UID = 'synthetic-additional-owner', EMAIL = 'owner@example.invalid', AUTH_TIME = 1_700_000_000;
function deferred<T = void>() { let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(accept => { resolve = accept; }); return { promise, resolve }; }
function fixture() {
  let runtime = true, uid = UID, failOwner = false;
  const calls: string[] = [];
  const adapter: CloudOperatingAuthAdapter = { signIn: async () => { calls.push('signIn'); },
    readOwner: async () => {
      calls.push('owner'); if (failOwner) throw new Error('PRIVATE_AUTH_ERROR');
      return { identity: { uid, email: EMAIL, status: 'owner-confirmed' }, membership: { schemaVersion: 1,
        clinicId: 'main', uid, role: 'owner', status: 'active', identityVersion: 1, verifiedAfter: AUTH_TIME }, authTime: AUTH_TIME };
    }, signOut: async () => { calls.push('signOut'); }, destroy: async () => { calls.push('destroy'); } };
  const core = createCloudOperatingAuthSession(adapter);
  const session: CloudOperatingPageSession = { ...core, getPatients: async () => {
    calls.push('getPatients'); return { commit: async () => { throw new Error('notused'); }, get: async () => null,
      getByFileNo: async () => null, listPage: async () => ({ records: [], nextAfterId: null }),
      findByPhone: async () => ({ records: [], nextAfterId: null }) };
  } };
  const page = createCloudOperatingPageController(async () => { calls.push('factory'); return session; }, () => runtime);
  return { page, core, calls, runtime: (value: boolean) => { runtime = value; }, identity: (value: string) => { uid = value; },
    failure: () => { failOwner = true; }, login: () => page.signIn(EMAIL, 'synthetic-password') };
}
function workspace() {
  let locked = false, disposed = 0;
  return { canClose: () => !locked, dispose: () => { disposed++; }, lock: (value: boolean) => { locked = value; }, disposed: () => disposed };
}
test('additional section is inert before checked owner and factories receive only scoped capability getters', async () => {
  const h = fixture(), w = workspace(); let constructed = 0;
  assert.equal(await h.page.openAdditional('appointments', () => { constructed++; return w; }), null);
  assert.equal(constructed, 0); assert.deepEqual(h.calls, []); await h.login();
  let context!: CloudOperatingAdditionalContext;
  assert.equal(await h.page.openAdditional('appointments', value => { context = value; return w; }), w);
  assert.equal(context.ownerUid, UID); assert.equal(context.isActive(), true); assert.equal(Object.isFrozen(context), true);
  assert.deepEqual(Object.keys(context).sort(), ['ownerUid', 'isActive', 'getContacts', 'getPatients', 'getClinical',
    'getServiceCatalog', 'getAppointments', 'getClinicSettings', 'getProsthetics', 'getExpenses', 'getClinicSnapshot'].sort());
  assert.equal(h.calls.includes('getPatients'), false); await context.getPatients(); assert.equal(h.calls.includes('getPatients'), true);
  await assert.rejects(context.getAppointments()); await h.page.dispose(); assert.equal(context.isActive(), false);
  await assert.rejects(context.getPatients()); assert.equal(w.disposed(), 1);
});
test('one opening owns one factory and close-before-factory prevents any construction', async () => {
  const h = fixture(); await h.login(); let count = 0; const w = workspace();
  const first = h.page.openAdditional('appointments', () => { count++; return w; });
  const same = h.page.openAdditional('appointments', () => { count++; return workspace(); });
  assert.equal(first, same); const other = h.page.openAdditional('settings', () => workspace());
  assert.equal(h.page.closeAdditional(), true); assert.equal(await other, null); assert.equal(await first, null); assert.equal(count, 0);
  assert.equal(await h.page.openAdditional('appointments', () => w), w); assert.equal(w.disposed(), 0);
  await h.page.dispose();
});
test('late factories are disposed on logout, runtime loss, same-object identity change and view loss', async () => {
  for (const loss of ['logout', 'runtime', 'identity', 'view'] as const) {
    const h = fixture(); await h.login(); const gate = deferred(), w = workspace(); let context!: CloudOperatingAdditionalContext;
    const opening = h.page.openAdditional('prosthetics', async value => { context = value; await gate.promise; return w; });
    await Promise.resolve();
    if (loss === 'logout') await h.page.signOut();
    if (loss === 'runtime') { h.runtime(false); h.page.getState(); }
    if (loss === 'identity') { h.identity('another-synthetic-owner'); await h.core.authorizeOwner(); }
    if (loss === 'view') await h.page.dispose();
    gate.resolve(); assert.equal(await opening, null); assert.equal(context.isActive(), false); assert.equal(w.disposed(), 1);
    assert.equal(h.page.getAdditionalWorkspace(), null); await h.page.dispose();
  }
});
test('dirty additional sections block basic and other-section navigation; exact close preserves new leases', async () => {
  const h = fixture(); await h.login(); const w = workspace();
  await h.page.openAdditional('settings', () => w); w.lock(true);
  assert.equal(await h.page.openAdditional('appointments', () => workspace()), null);
  assert.equal(await h.page.openPatients(), null); assert.equal(h.page.getAdditionalWorkspace('settings'), w);
  assert.equal(h.page.closeAdditional(w), false); assert.equal(w.disposed(), 0);
  w.lock(false); assert.equal(h.page.closeAdditional(w), true); assert.equal(w.disposed(), 1);
  const next = workspace(); await h.page.openAdditional('settings', () => next);
  assert.equal(h.page.closeAdditional(w), false); assert.equal(h.page.getAdditionalWorkspace(), next); await h.page.dispose();
});
test('temporary owner checking keeps exact additional lease; real auth failure revokes it', async () => {
  const h = fixture(); await h.login(); const w = workspace(); let context!: CloudOperatingAdditionalContext;
  await h.page.openAdditional('expenses', value => { context = value; return w; }); w.lock(true);
  const refresh = h.page.refresh(); assert.equal(context.isActive(), true); await refresh;
  assert.equal(h.page.getAdditionalWorkspace(), w); assert.equal(w.disposed(), 0);
  h.failure(); await h.page.refresh(); assert.equal(context.isActive(), false); assert.equal(w.disposed(), 1);
  await h.page.dispose();
});
test('ordinary switch cannot reopen the outgoing section from synchronous disposal callbacks', async () => {
  const h = fixture(); await h.login(); let reentrant: Promise<CloudOperatingAdditionalWorkspace | null> | null = null;
  const w: CloudOperatingAdditionalWorkspace = { canClose: () => true, dispose: () => {
    reentrant = h.page.openAdditional('settings', () => workspace());
  } };
  await h.page.openAdditional('settings', () => w); const next = workspace();
  assert.equal(await h.page.openAdditional('appointments', () => next), next); assert.equal(await reentrant, null);
  assert.equal(h.page.getAdditionalWorkspace('appointments'), next); await h.page.dispose();
});
test('reentrant logout during canClose cannot falsely confirm closure or revive the outgoing workspace', async () => {
  const h = fixture(); await h.login(); let trigger = false, logout: Promise<boolean> | null = null;
  const w = { canClose: () => { if (trigger) { trigger = false; logout = h.page.signOut(); } return true; }, dispose: () => undefined };
  await h.page.openAdditional('settings', () => w); trigger = true;
  assert.equal(h.page.closeAdditional(w), false); assert.equal(h.page.getAdditionalWorkspace(), null);
  await logout;
  assert.equal(h.page.getAdditionalWorkspace(), null); assert.equal(h.page.getState().auth.phase, 'signed-out');
  await h.page.dispose();
});
