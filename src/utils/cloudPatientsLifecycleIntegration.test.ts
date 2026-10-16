import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createCloudOperatingAuthSession, type CloudOperatingAuthAdapter } from './cloudOperatingAuth';
import { createCloudOperatingPageController } from './cloudOperatingPageController';
import { createJournaledCloudPatientRepository, type CloudPatientAdapter } from './cloudPatientRepository';
import { createCloudOperationIntentRepository, type CloudIntentAdapter } from './cloudOperationIntent';

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
async function waitForStage(started: ReturnType<typeof deferred>, action: Promise<unknown>, label: string, context: () => unknown) {
  let timer: ReturnType<typeof setTimeout>;
  try {
    await Promise.race([
      started.promise,
      action.then(() => assert.fail(`${label} was not reached before the action completed: ${JSON.stringify(context())}`)),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out: ${JSON.stringify(context())}`)), 30_000); }),
    ]);
  } finally { clearTimeout(timer!); }
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
    loseReply?: boolean; failRead?: boolean; losePrepareReply?: boolean;
    historyGate?: ReturnType<typeof deferred>; historyStarted?: ReturnType<typeof deferred> } = {};
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
        ++commits; calls.push('data:transaction'); const staged = structuredClone(rows); let changed = 0, wrote = false, domainWrite = false;
        const result = await work({
          get: async path => { assert.equal(wrote, false); return structuredClone(staged.get(path) ?? null); },
          set: (path, value) => { wrote = true; ++changed; domainWrite ||= path.includes('/patientProfiles/'); staged.set(path, structuredClone(value)); },
        });
        rows.clear(); for (const [path, value] of staged) rows.set(path, value); writes += changed;
        if (domainWrite) {
          hooks.accepted?.resolve(); await hooks.replyGate?.promise;
          if (hooks.loseReply) { hooks.loseReply = false; throw new Error('SYNTHETIC_LOST_ACK'); }
        }
        if (changed === 1 && !domainWrite && hooks.losePrepareReply) {
          hooks.losePrepareReply = false; throw new Error('SYNTHETIC_LOST_PREPARE_ACK');
        }
        return result;
      } finally { release(); }
    },
  };
  const digest = async (value: string) => createHash('sha256').update(value).digest('hex');
  const journalAdapter: CloudIntentAdapter = { authorizeOwner: adapter.authorizeOwner, runTransaction: adapter.runTransaction,
    readRecord: adapter.readRecord, listHistoryPage: async (kind, actorUid, afterId, limit) => {
      calls.push('data:history'); hooks.historyStarted?.resolve(); await hooks.historyGate?.promise;
      return [...rows].filter(([path, value]) => path.startsWith(`${ROOT}operationIntents/`)
        && value.kind === kind && value.actorUid === actorUid && (afterId === null || value.operationId > afterId))
        .sort((a, b) => a[0] < b[0] ? -1 : 1).slice(0, limit).map(([, data]) => ({ id: data.operationId, data: structuredClone(data) }));
    } };
  const journal = createCloudOperationIntentRepository(journalAdapter, { digest });
  const repository = { ...createJournaledCloudPatientRepository(adapter, { digest }), journal };
  const session = { ...auth, getPatients: async () => { calls.push('capability:patients'); await auth.authorizeOwner(); return repository; },
    getClinicSnapshot: async () => {
      calls.push('capability:directory'); await auth.authorizeOwner();
      return { readFull: async () => { throw new Error('Patient registration must not request a financial snapshot.'); }, readDirectory: async () => {
        // Fresh COMPLETE metadata from the same fabricated atomic server,
        // never an empty fallback or the workspace's loaded patient page.
        await auth.authorizeOwner(); calls.push('data:directory');
        const patientProfiles = profileRows().map(row => row.data);
        const contactRecords = [...rows].filter(([path]) => path.startsWith(`${ROOT}contactRecords/`))
          .sort(([a], [b]) => a < b ? -1 : 1).map(([, data]) => structuredClone(data));
        await auth.authorizeOwner();
        return { readTime: '2026-10-12T12:00:00.000Z', patientProfiles, contactRecords };
      } };
    } };
  const page = createCloudOperatingPageController(async () => session, () => true);
  const independentCore = createJournaledCloudPatientRepository({ ...adapter, authorizeOwner: async () => UID }, { digest });
  const independentJournal = createCloudOperationIntentRepository({ ...journalAdapter, authorizeOwner: async () => UID }, { digest });
  const independent = { commit: async (command: Parameters<typeof independentCore.commit>[0]) => {
    await independentJournal.prepare('patient-profile', command, '2026-10-12T12:00:00.000Z'); return independentCore.commit(command);
  } };
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
  assert.equal(h.writes(), 6); assert.equal(workspace.getState().selected?.fileNo, 1);
  assert.equal(workspace.getState().selected?.data.name, 'مريض مصطنع'); assert.equal(workspace.getState().draft, null);
  assert.equal(h.rows.get(`${ROOT}counters/patientFiles`).lastFileNo, 1); await h.page.dispose();
});

test('patient lifecycle registration preflight freshly sees prior files and requires explicit separate-file confirmation', async () => {
  const h = fixture(), workspace = await h.open(); h.draft(workspace); await workspace.save();
  assert.equal(h.writes(), 6); h.draft(workspace); await workspace.save();
  const check = workspace.getState().registrationCheck;
  assert.ok(check, workspace.getState().error || 'Fresh directory must warn about the existing same-phone file');
  assert.equal(check.matchCount, 1); assert.equal(check.matches[0].fileNo, 1);
  assert.equal(h.writes(), 6, 'review alone creates no journal or file');
  assert.equal(h.calls.filter(call => call === 'data:directory').length, 2);
  await workspace.confirmSeparateFile(check);
  assert.equal(workspace.getState().selected?.fileNo, 2); assert.equal(h.writes(), 12);
  await h.page.dispose();
});

test('patient workspace retains draft across fresh Auth checking but clears it synchronously on actual logout', async () => {
  const h = fixture(), workspace = await h.open(); h.draft(workspace); const draft = workspace.getState().draft;
  h.hooks.ownerGate = deferred(); h.hooks.ownerStarted = deferred();
  const checking = h.page.refresh(); await waitForStage(h.hooks.ownerStarted, checking, 'owner recheck', () => h.page.getState());
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
  assert.equal(h.writes(), 6); assert.equal(h.page.closePatients(), false);
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
  assert.equal(workspace.getState().saveStatus, 'idle'); assert.equal(h.writes(), 6); assert.equal(workspace.getState().selected?.fileNo, 1); await h.page.dispose();
});

test('stale profile edit is never silently rebased to overwrite a newer clinical identity', async () => {
  const h = fixture(), workspace = await h.open(); h.draft(workspace); await workspace.save();
  const stale = workspace.getState().selected!; assert.equal(workspace.beginEdit(stale), true);
  assert.equal(workspace.updateProfile({ name: 'stale submitted edit' }), true);
  await h.independent.commit({ operationId: OP, recordId: stale.recordId, expectedRevision: 1, action: 'update', profile: { ...stale.data, name: 'newer saved edit' } });
  const before = h.writes(); await workspace.save(); assert.equal(h.writes(), before + 1, 'failed CAS keeps only a durable prepared intent');
  assert.equal(workspace.getState().draft?.expectedRevision, 1); assert.equal(workspace.getState().saveStatus, 'retry-required');
  assert.ok(workspace.getState().error); assert.equal(workspace.cancelDraft(), false);
  assert.equal(await workspace.cancelPending(), true);
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
  await waitForStage(h.hooks.readStarted, selecting, 'patient detail read', () => workspace.getState()); const logout = h.page.signOut(); h.hooks.readGate.resolve(); await selecting; await logout;
  assert.equal(workspace.getState().closed, true); assert.equal(workspace.getState().selected, null); assert.deepEqual(workspace.getState().records, []); await h.page.dispose();
});

test('accepted patient write after logout is not represented as server rollback or late UI success', async () => {
  const h = fixture(), workspace = await h.open(); h.draft(workspace); h.hooks.accepted = deferred(); h.hooks.replyGate = deferred();
  const saving = workspace.save(); await waitForStage(h.hooks.accepted, saving, 'accepted patient write', () => workspace.getState()); assert.equal(h.writes(), 6);
  const logout = h.page.signOut(); h.hooks.replyGate.resolve(); await saving; await logout;
  assert.equal(workspace.getState().closed, true); assert.equal(workspace.getState().selected, null);
  assert.equal(workspace.getState().notice, ''); assert.equal(h.rows.get(`${ROOT}counters/patientFiles`).lastFileNo, 1); await h.page.dispose();
});

test('patient history read blocks page close and new drafts then clears late output on actual logout', async () => {
  const h = fixture(), workspace = await h.open();
  assert.equal(h.calls.includes('data:history'), false);
  h.hooks.historyGate = deferred(); h.hooks.historyStarted = deferred();
  const reading = workspace.recovery.loadFirst(); await waitForStage(h.hooks.historyStarted, reading, 'patient history read', () => workspace.getState());
  assert.equal(h.page.closePatients(), false); assert.equal(workspace.beginCreate(), false);
  assert.equal(h.page.getPatientsWorkspace(), workspace);
  const logout = h.page.signOut(); h.hooks.historyGate.resolve(); await reading; await logout;
  assert.equal(workspace.recovery.getState().closed, true); assert.deepEqual(workspace.recovery.getState().records, []);
  assert.equal(h.writes(), 0); await h.page.dispose();
});

test('patient cached history cannot bypass a draft or unresolved preparation; cancellation never allocates a file', async () => {
  const h = fixture(), workspace = await h.open(); await workspace.recovery.loadFirst();
  const historyCalls = () => h.calls.filter(call => call === 'data:history').length;
  h.draft(workspace); await workspace.recovery.loadFirst(); assert.equal(historyCalls(), 1);
  h.hooks.losePrepareReply = true; await workspace.save();
  assert.equal(workspace.getState().saveStatus, 'retry-required'); assert.ok(workspace.getState().pendingOperationId);
  assert.equal(h.rows.get(`${ROOT}counters/patientFiles`).lastFileNo, 0);
  await workspace.recovery.loadFirst(); assert.equal(historyCalls(), 1);
  assert.equal(await workspace.cancelPending(), true); await workspace.recovery.loadFirst();
  assert.equal(historyCalls(), 2); assert.equal(workspace.recovery.getState().records[0].status, 'cancelled');
  assert.equal(h.rows.get(`${ROOT}counters/patientFiles`).lastFileNo, 0);
  assert.equal(h.page.closePatients(), true); await h.page.dispose();
});
