import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createCloudOperatingAuthSession, type CloudOperatingAuthAdapter } from './cloudOperatingAuth';
import { createCloudOperatingPageController } from './cloudOperatingPageController';
import { createCloudPatientRepository, type CloudPatientAdapter } from './cloudPatientRepository';

// Composition only: actual pure lifecycle/workspace/repository modules with a
// fabricated membership and atomic in-memory server. Not a live owner login,
// Rules-engine check, browser visual QA or multi-device verification.
const UID = 'synthetic-patient-lifecycle-owner';
const EMAIL = 'patient-lifecycle@example.invalid';
const PASSWORD = 'synthetic-password-only';
const TIME = 1_700_000_000;
const OP = '20000000-0000-4000-8000-000000000001';
const OTHER = '10000000-0000-4000-8000-000000000002';
const ROOT = 'clinics/main/';
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(accept => { resolve = accept; });
  return { promise, resolve };
}
function member(): Awaited<ReturnType<CloudOperatingAuthAdapter['readOwner']>> {
  return { identity: { uid: UID, email: EMAIL, status: 'owner-confirmed' },
    membership: { schemaVersion: 1, clinicId: 'main', uid: UID, role: 'owner', status: 'active',
      identityVersion: 1, verifiedAfter: TIME }, authTime: TIME };
}
function fixture() {
  const rows = new Map<string, any>([[`${ROOT}counters/patientFiles`, {
    schemaVersion: 1, clinicId: 'main', lastFileNo: 0, lastOperationId: null }]]);
  const calls: string[] = [];
  const hooks: { ownerGate?: ReturnType<typeof deferred>; ownerStarted?: ReturnType<typeof deferred>;
    readGate?: ReturnType<typeof deferred>; readStarted?: ReturnType<typeof deferred>;
    accepted?: ReturnType<typeof deferred>; replyGate?: ReturnType<typeof deferred>;
    loseReply?: boolean; failRead?: boolean } = {};
  let writes = 0, commits = 0, tail = Promise.resolve();
  const auth = createCloudOperatingAuthSession({
    signIn: async () => { calls.push('auth:signIn'); },
    readOwner: async () => { calls.push('auth:read'); hooks.ownerStarted?.resolve(); await hooks.ownerGate?.promise; return member(); },
    signOut: async () => { calls.push('auth:signOut'); }, destroy: async () => { calls.push('auth:destroy'); },
  });
  const profileRows = () => [...rows].filter(([path]) => path.startsWith(`${ROOT}patientProfiles/`))
    .map(([path, data]) => ({ id: path.split('/').at(-1)!, data: structuredClone(data) })).sort((a, b) => a.id < b.id ? -1 : 1);
  const adapter: CloudPatientAdapter = {
    authorizeOwner: async () => (await auth.authorizeOwner()).uid,
    readRecord: async path => {
      calls.push('data:get'); hooks.readStarted?.resolve(); await hooks.readGate?.promise;
      if (hooks.failRead) { hooks.failRead = false; throw new Error('SYNTHETIC_READ_FAILURE'); }
      return structuredClone(rows.get(path) ?? null);
    },
    listRecordsPage: async (afterId, limit) => {
      calls.push('data:list'); return profileRows().filter(row => !afterId || row.id > afterId).slice(0, limit);
    },
    findRecordsByPhone: async (key, afterId, limit) => {
      calls.push('data:phone'); return profileRows().filter(row => row.data.phoneKey === key && (!afterId || row.id > afterId)).slice(0, limit);
    },
    runTransaction: async work => {
      const previous = tail; let release!: () => void;
      tail = new Promise<void>(accept => { release = accept; }); await previous;
      try {
        ++commits; calls.push('data:transaction'); const staged = structuredClone(rows); let changed = 0, wrote = false;
        const result = await work({
          get: async path => { assert.equal(wrote, false); return structuredClone(staged.get(path) ?? null); },
          set: (path, value) => { wrote = true; ++changed; staged.set(path, structuredClone(value)); },
        });
        rows.clear(); for (const [path, value] of staged) rows.set(path, value); writes += changed;
        if (changed) {
          hooks.accepted?.resolve(); await hooks.replyGate?.promise;
          if (hooks.loseReply) { hooks.loseReply = false; throw new Error('SYNTHETIC_LOST_ACK'); }
        }
        return result;
      } finally { release(); }
    },
  };
  const digest = async (value: string) => createHash('sha256').update(value).digest('hex');
  const repository = createCloudPatientRepository(adapter, { digest });
  const session = { ...auth, getPatients: async () => { calls.push('capability:patients'); await auth.authorizeOwner(); return repository; } };
  const page = createCloudOperatingPageController(async () => session, () => true);
  const independent = createCloudPatientRepository({ ...adapter, authorizeOwner: async () => UID }, { digest });
  const open = async () => { await page.signIn(EMAIL, PASSWORD); const workspace = await page.openPatients(); assert.ok(workspace); return workspace; };
  const draft = (workspace: NonNullable<Awaited<ReturnType<typeof page.openPatients>>>) => {
    assert.equal(workspace.beginCreate(), true);
    assert.equal(workspace.updateProfile({ name: 'مريض مصطنع', mobile: '01000000001' }), true);
  };
  return { rows, calls, hooks, auth, page, repository, independent, open, draft,
    writes: () => writes, commits: () => commits };
}

test('patient Auth/page/workspace opens inertly and only an explicit save allocates a public file number', async () => {
  const h = fixture(); assert.deepEqual(h.calls, []); const workspace = await h.open();
  assert.equal(h.calls.some(call => call.startsWith('data:')), false);
  h.draft(workspace); assert.equal(h.writes(), 0); await workspace.save();
  assert.equal(h.writes(), 4); assert.equal(workspace.getState().selected?.fileNo, 1);
  assert.equal(workspace.getState().selected?.data.name, 'مريض مصطنع'); assert.equal(workspace.getState().draft, null);
  assert.equal(h.rows.get(`${ROOT}counters/patientFiles`).lastFileNo, 1); await h.page.dispose();
});

test('patient workspace retains draft across fresh Auth checking but clears it synchronously on actual logout', async () => {
  const h = fixture(), workspace = await h.open(); h.draft(workspace); const draft = workspace.getState().draft;
  h.hooks.ownerGate = deferred(); h.hooks.ownerStarted = deferred();
  const checking = h.page.refresh(); await h.hooks.ownerStarted.promise;
  assert.equal(h.auth.getState().phase, 'checking'); assert.equal(h.page.getPatientsWorkspace(), workspace);
  assert.equal(workspace.getState().draft, draft); h.hooks.ownerGate.resolve(); await checking;
  assert.equal(h.page.closePatients(), false); const logout = h.page.signOut();
  assert.equal(h.page.getPatientsWorkspace(), null); assert.equal(workspace.getState().closed, true);
  assert.equal(workspace.getState().draft, null); assert.equal(await logout, true); assert.equal(h.writes(), 0); await h.page.dispose();
});

test('lost patient acknowledgment retries immutable command once and rereads a newer edit rather than its submitted draft', async () => {
  const h = fixture(), workspace = await h.open(); h.draft(workspace); h.hooks.loseReply = true;
  await workspace.save(); const state = workspace.getState(); assert.equal(state.saveStatus, 'retry-required');
  const id = state.draft!.recordId, saved = h.rows.get(`${ROOT}patientProfiles/${id}`);
  assert.equal(h.writes(), 4); assert.equal(h.page.closePatients(), false);
  assert.equal(workspace.cancelDraft(), false); assert.equal(workspace.updateProfile({ name: 'must not change' }), false);
  await h.independent.commit({ operationId: OP, recordId: id, expectedRevision: 1, action: 'update', profile: { ...saved.data, name: 'تعديل أحدث مصطنع' } });
  const beforeRetry = h.writes(); await workspace.save();
  assert.equal(h.writes(), beforeRetry); assert.equal(h.rows.get(`${ROOT}counters/patientFiles`).lastFileNo, 1);
  assert.equal(workspace.getState().selected?.revision, 2); assert.equal(workspace.getState().selected?.data.name, 'تعديل أحدث مصطنع');
  assert.equal(workspace.getState().draft, null); assert.equal(h.page.closePatients(), true); await h.page.dispose();
});

test('acknowledged patient save with failed read retries only refresh, never a second transaction or allocation', async () => {
  const h = fixture(), workspace = await h.open(); h.draft(workspace); h.hooks.failRead = true;
  await workspace.save(); assert.equal(workspace.getState().saveStatus, 'refresh-required');
  const commits = h.commits(); await workspace.save(); assert.equal(h.commits(), commits);
  assert.equal(workspace.getState().saveStatus, 'idle'); assert.equal(h.writes(), 4); assert.equal(workspace.getState().selected?.fileNo, 1); await h.page.dispose();
});

test('stale profile edit is never silently rebased to overwrite a newer clinical identity', async () => {
  const h = fixture(), workspace = await h.open(); h.draft(workspace); await workspace.save();
  const stale = workspace.getState().selected!; assert.equal(workspace.beginEdit(stale), true);
  assert.equal(workspace.updateProfile({ name: 'stale submitted edit' }), true);
  await h.independent.commit({ operationId: OP, recordId: stale.recordId, expectedRevision: 1, action: 'update', profile: { ...stale.data, name: 'newer saved edit' } });
  const before = h.writes(); await workspace.save(); assert.equal(h.writes(), before);
  assert.equal(workspace.getState().draft?.expectedRevision, 1); assert.equal(workspace.getState().saveStatus, 'idle');
  assert.ok(workspace.getState().error); assert.equal(workspace.cancelDraft(), true);
  await workspace.select(stale.recordId); assert.equal(workspace.getState().selected?.data.name, 'newer saved edit'); await h.page.dispose();
});

test('patient lookup returns every shared family file and opens exact numeric-file record without merging', async () => {
  const h = fixture(), workspace = await h.open(); h.draft(workspace); await workspace.save(); const first = workspace.getState().selected!;
  await h.independent.commit({ operationId: OP, recordId: OTHER, expectedRevision: 0, action: 'create', profile: { ...first.data, name: 'ملف آخر مصطنع' } });
  await workspace.findByPhone({ mobile: '+٢٠١٠٠٠٠٠٠٠٠١' }); assert.deepEqual(workspace.getState().records.map(value => value.fileNo).sort(), [1, 2]);
  await workspace.findByFileNo(2); assert.equal(workspace.getState().selected?.recordId, OTHER);
  assert.equal(h.rows.get(`${ROOT}counters/patientFiles`).lastFileNo, 2); await h.page.dispose();
});

test('late patient read after logout cannot repopulate rows or selected details', async () => {
  const h = fixture(), workspace = await h.open(); h.draft(workspace); await workspace.save(); const id = workspace.getState().selected!.recordId;
  h.hooks.readGate = deferred(); h.hooks.readStarted = deferred(); const selecting = workspace.select(id);
  await h.hooks.readStarted.promise; const logout = h.page.signOut(); h.hooks.readGate.resolve(); await selecting; await logout;
  assert.equal(workspace.getState().closed, true); assert.equal(workspace.getState().selected, null); assert.deepEqual(workspace.getState().records, []); await h.page.dispose();
});

test('accepted patient write after logout is not represented as server rollback or late UI success', async () => {
  const h = fixture(), workspace = await h.open(); h.draft(workspace); h.hooks.accepted = deferred(); h.hooks.replyGate = deferred();
  const saving = workspace.save(); await h.hooks.accepted.promise; assert.equal(h.writes(), 4);
  const logout = h.page.signOut(); h.hooks.replyGate.resolve(); await saving; await logout;
  assert.equal(workspace.getState().closed, true); assert.equal(workspace.getState().selected, null);
  assert.equal(workspace.getState().notice, ''); assert.equal(h.rows.get(`${ROOT}counters/patientFiles`).lastFileNo, 1); await h.page.dispose();
});
