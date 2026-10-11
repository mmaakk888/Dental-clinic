import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createCloudOperatingAuthSession, type CloudOperatingAuthAdapter } from './cloudOperatingAuth';
import { createCloudOperatingPageController } from './cloudOperatingPageController';
import { createCloudPatientRepository } from './cloudPatientRepository';
import { createCloudClinicalRepository, type CloudClinicalAdapter, type CloudClinicalSessionData } from './cloudClinicalRepository';
import { createCloudOperationIntentRepository, type CloudIntentAdapter } from './cloudOperationIntent';

// Composition of actual pure Auth/page/file/recovery/journal/domain modules.
// Every identity and document below is fabricated. No SDK, browser storage,
// live Firebase, Rules-engine, visual or two-device verification is involved.
const UID = 'synthetic-clinical-lifecycle-owner';
const EMAIL = 'clinical-lifecycle@example.invalid';
const PASSWORD = 'synthetic-password-only';
const AUTH_TIME = 1_700_000_000;
const PATIENT = '10000000-0000-4000-8000-000000000001';
const OTHER = '10000000-0000-4000-8000-000000000002';
const PROFILE_OP = '20000000-0000-4000-8000-000000000001';
const ITEM = '30000000-0000-4000-8000-000000000001';
const DAY = '2026-10-11';
const ROOT = 'clinics/main/';
const path = (kind: string, id: string | number = PATIENT) => `${ROOT}${kind}/${id}`;
const digest = async (value: string) => createHash('sha256').update(value).digest('hex');
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(accept => { resolve = accept; });
  return { promise, resolve };
}
function member(): Awaited<ReturnType<CloudOperatingAuthAdapter['readOwner']>> {
  return { identity: { uid: UID, email: EMAIL, status: 'owner-confirmed' },
    membership: { schemaVersion: 1, clinicId: 'main', uid: UID, role: 'owner', status: 'active',
      identityVersion: 1, verifiedAfter: AUTH_TIME }, authTime: AUTH_TIME };
}
const visit = (): CloudClinicalSessionData => ({ type: 'حشو عادي', date: DAY, teethIds: ['ur5'],
  services: [{ id: ITEM, name: 'حشو عادي', priceCents: 30_000, tooth: 'ur5' }], examinationCents: 10_000,
  notes: 'ملاحظات مصطنعة', treatmentStage: 'single', rootCanalStatus: '', visitStatus: 'completed' });

function syntheticServer() {
  const rows = new Map<string, any>([
    [path('patientProfiles'), { schemaVersion: 1, clinicId: 'main', recordId: PATIENT, fileNo: 451,
      revision: 1, lastOperationId: PROFILE_OP,
      phoneKey: createHash('sha256').update('patient-phone-v1:201000000001').digest('hex'),
      data: { name: 'مريض مصطنع', mobile: '01000000001', age: 30, gender: '', firstVisit: DAY, notes: '', allergy: '' } }],
    [path('patientFiles', 451), { schemaVersion: 1, clinicId: 'main', fileNo: 451, recordId: PATIENT }],
  ]);
  const calls: string[] = [];
  const hooks: { loseAck?: 'prepare' | 'commit'; pauseCommit?: boolean;
    accepted?: ReturnType<typeof deferred>; replyGate?: ReturnType<typeof deferred> } = {};
  let writes = 0, tail = Promise.resolve();
  const runTransaction: CloudClinicalAdapter['runTransaction'] = async work => {
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>(accept => { release = accept; });
    await previous;
    try {
      const staged = structuredClone(rows), changed: string[] = [];
      let wrote = false;
      const result = await work({
        get: async key => {
          assert.equal(wrote, false, 'all transaction reads precede writes');
          calls.push(`data:transaction:get:${key}`);
          return structuredClone(staged.get(key) ?? null);
        },
        set: (key, value) => { wrote = true; changed.push(key); staged.set(key, structuredClone(value)); },
      });
      // No writes become visible if the transaction body failed.
      rows.clear();
      for (const [key, value] of staged) rows.set(key, value);
      writes += changed.length;
      if (changed.length) {
        const stage = changed.some(key => key.startsWith(path('clinicalOperations', ''))) ? 'commit' : 'prepare';
        calls.push(`data:accepted:${stage}`);
        if (stage === 'commit' && hooks.pauseCommit) {
          hooks.pauseCommit = false;
          hooks.accepted?.resolve();
          await hooks.replyGate?.promise;
        }
        if (hooks.loseAck === stage) {
          hooks.loseAck = undefined;
          throw new Error('SYNTHETIC_ACCEPTED_REPLY_LOST');
        }
      }
      return result;
    } finally { release(); }
  };
  const readRecord = async (key: string) => {
    calls.push(`data:get:${key}`);
    return structuredClone(rows.get(key) ?? null);
  };
  function page(kind: string, afterId: string | null, limit: number, match: (value: any) => boolean) {
    calls.push(`data:list:${kind}`);
    return [...rows].filter(([key, value]) => key.startsWith(path(kind, ''))
      && (!afterId || key.split('/').at(-1)! > afterId) && match(value))
      .sort(([a], [b]) => a < b ? -1 : 1).slice(0, limit)
      .map(([key, value]) => ({ id: key.split('/').at(-1)!, data: structuredClone(value) }));
  }
  function client() {
    const authHooks: { gate?: ReturnType<typeof deferred>; started?: ReturnType<typeof deferred> } = {};
    const auth = createCloudOperatingAuthSession({
      signIn: async () => { calls.push('auth:sign-in'); },
      readOwner: async () => {
        calls.push('auth:read-owner'); authHooks.started?.resolve();
        await authHooks.gate?.promise; return member();
      },
      signOut: async () => { calls.push('auth:sign-out'); },
      destroy: async () => { calls.push('auth:destroy'); },
    });
    const authorizeOwner = async () => (await auth.authorizeOwner()).uid;
    const clinicalAdapter: CloudClinicalAdapter = { authorizeOwner, runTransaction, readRecord,
      listSessionsPage: async (id, after, limit) => page('patientSessions', after, limit, value => value.patientId === id),
      listReceiptsPage: async (id, after, limit) => page('patientReceipts', after, limit, value => value.patientId === id) };
    const intentAdapter: CloudIntentAdapter = { authorizeOwner, runTransaction, readRecord,
      listPreparedPage: async (kind, uid, after, limit) => page('operationIntents', after, limit,
        value => value.kind === kind && value.actorUid === uid && value.status === 'prepared'),
      listHistoryPage: async (kind, uid, after, limit) => page('operationIntents', after, limit,
        value => value.kind === kind && value.actorUid === uid) };
    const repository = createCloudClinicalRepository(clinicalAdapter, { digest });
    const journal = createCloudOperationIntentRepository(intentAdapter, { digest });
    const patients = createCloudPatientRepository({ authorizeOwner, runTransaction, readRecord }, { digest });
    const session = { ...auth,
      getClinical: async () => { calls.push('capability:clinical'); await auth.authorizeOwner(); return { repository, journal }; },
      getPatients: async () => { calls.push('capability:patients'); await auth.authorizeOwner(); return patients; } };
    const controller = createCloudOperatingPageController(async () => session, () => true);
    const open = async () => {
      await controller.signIn(EMAIL, PASSWORD);
      const bundle = await controller.openClinical();
      assert.ok(bundle, 'the pure owner-checked page opens its clinical bundle');
      return bundle;
    };
    return { auth, authHooks, page: controller, journal, repository, open };
  }
  const count = (kind: string) => [...rows.keys()].filter(key => key.startsWith(path(kind, ''))).length;
  return { rows, calls, hooks, client, count, writes: () => writes };
}

test('lost clinical commit ACK is discovered after reload as committed history and exact-ID replay never collects twice', async () => {
  const server = syntheticServer(), old = server.client();
  assert.deepEqual(server.calls, []);
  const first = await old.open();
  assert.equal(server.calls.some(value => value.startsWith('data:')), false, 'opening a bundle alone remains inert');
  assert.equal(await first.file.open(PATIENT), true);
  server.hooks.loseAck = 'commit';
  assert.equal(await first.file.saveVisit(PATIENT, visit(), 10_000), false);
  const operationId = first.file.getState().pendingOperationId!;
  assert.equal(first.file.getState().saveStatus, 'retry-required');
  assert.equal(server.rows.get(path('operationIntents', operationId)).status, 'committed');
  assert.equal((await old.journal.listPreparedPage('clinical')).records.length, 0,
    'prepared-only recovery would lose this accepted operation');
  assert.equal(old.page.closeClinical(first), false);
  await old.page.dispose();
  assert.equal(first.file.getState().pendingOperationId, null);
  const fresh = server.client(), next = await fresh.open();
  await next.recovery.loadFirst();
  assert.equal(next.recovery.getState().loaded, true);
  assert.deepEqual(next.recovery.getState().records.map(value => [value.operationId, value.status]), [[operationId, 'committed']]);
  const beforeReplay = server.writes();
  assert.equal(await next.file.resume(operationId), true);
  assert.equal(server.writes(), beforeReplay);
  assert.equal(next.file.getState().snapshot?.accountRevision, 1);
  assert.equal(next.file.getState().snapshot?.paidCents, 10_000);
  assert.equal(server.count('patientReceipts'), 1);
  assert.equal(server.count('patientSessions'), 1);
  // Historical acknowledgements must still refresh the current, newer ledger.
  assert.equal(await next.file.addReceipt(PATIENT, operationId, { amountCents: 5_000, date: DAY, note: 'تحصيل مصطنع' }), true);
  const afterPayment = server.writes();
  assert.equal(await next.file.resume(operationId), true);
  assert.equal(server.writes(), afterPayment);
  assert.equal(next.file.getState().snapshot?.accountRevision, 2);
  assert.equal(next.file.getState().snapshot?.paidCents, 15_000);
  assert.equal(server.count('patientReceipts'), 2);
  assert.equal(server.rows.get(path('patientAccounts')).paidCents, 15_000);
  await fresh.page.dispose();
});

test('lost prepare ACK survives a fresh page and resumes the original command before creating one cash receipt', async () => {
  const server = syntheticServer(), old = server.client(), first = await old.open();
  assert.equal(await first.file.open(PATIENT), true);
  server.hooks.loseAck = 'prepare';
  assert.equal(await first.file.saveVisit(PATIENT, visit(), 10_000), false);
  const operationId = first.file.getState().pendingOperationId!;
  const prepared = structuredClone(server.rows.get(path('operationIntents', operationId)));
  assert.equal(prepared.status, 'prepared'); assert.equal(server.writes(), 1);
  assert.equal(server.count('patientAccounts'), 0); assert.equal(server.count('patientReceipts'), 0);
  await old.page.dispose();
  const fresh = server.client(), next = await fresh.open();
  await next.recovery.loadFirst();
  assert.deepEqual(next.recovery.getState().records.map(value => value.operationId), [operationId]);
  assert.deepEqual(next.recovery.getState().records[0].command, prepared.command);
  assert.equal(await next.file.resume(operationId), true);
  assert.equal(server.rows.get(path('operationIntents', operationId)).status, 'committed');
  assert.deepEqual(server.rows.get(path('operationIntents', operationId)).command, prepared.command);
  assert.equal(server.count('clinicalOperations'), 1); assert.equal(server.count('patientReceipts'), 1);
  assert.equal(server.rows.get(path('patientReceipts', operationId)).amountCents, 10_000);
  const writes = server.writes();
  assert.equal(await next.file.resume(operationId), true); assert.equal(server.writes(), writes);
  await next.recovery.loadFirst(); assert.equal(next.recovery.getState().records[0].status, 'committed');
  await fresh.page.dispose();
});

test('lost payment ACK recovers its payment UUID rather than creating another charge, session or cash receipt', async () => {
  const server = syntheticServer(), old = server.client(), first = await old.open();
  assert.equal(await first.file.open(PATIENT), true);
  assert.equal(await first.file.saveVisit(PATIENT, visit(), 10_000), true);
  const sessionId = first.file.getState().snapshot!.patient.sessions[0].id;
  server.hooks.loseAck = 'commit';
  assert.equal(await first.file.addReceipt(PATIENT, sessionId, { amountCents: 5_000, date: DAY, note: 'دفعة مصطنعة' }), false);
  const operationId = first.file.getState().pendingOperationId!;
  await old.page.dispose();
  const fresh = server.client(), next = await fresh.open(); await next.recovery.loadFirst();
  const recovered = next.recovery.getState().records.find(value => value.operationId === operationId)!;
  assert.equal(recovered.status, 'committed'); assert.equal(recovered.command.action, 'payment');
  assert.equal(recovered.command.sessionId, sessionId);
  const before = server.writes(); assert.equal(await next.file.resume(operationId), true);
  assert.equal(server.writes(), before); assert.equal(server.count('patientSessions'), 1);
  assert.equal(server.count('patientReceipts'), 2); assert.equal(server.count('clinicalOperations'), 2);
  assert.equal(next.file.getState().snapshot?.totalCents, 40_000);
  assert.equal(next.file.getState().snapshot?.paidCents, 15_000);
  assert.equal(server.rows.get(path('patientReceipts', operationId)).amountCents, 5_000);
  await fresh.page.dispose();
});

test('ordinary clinical draft blocks close, file switching and workspace switching across transient Auth checking', async () => {
  const server = syntheticServer(), client = server.client(), bundle = await client.open();
  assert.equal(await bundle.file.open(PATIENT), true);
  assert.equal(bundle.file.setDraftDirty(PATIENT, true), true);
  const before = server.calls.filter(value => value.startsWith('data:')).length;
  assert.equal(await bundle.file.open(OTHER), false); assert.equal(await bundle.file.refresh(), false);
  assert.equal(await bundle.file.resume(PROFILE_OP), false); assert.equal(client.page.closeClinical(bundle), false);
  assert.equal(await client.page.openPatients(), null);
  assert.equal(server.calls.includes('capability:patients'), false);
  assert.equal(server.calls.filter(value => value.startsWith('data:')).length, before);
  client.authHooks.gate = deferred(); client.authHooks.started = deferred();
  const checking = client.page.refresh(); await client.authHooks.started.promise;
  assert.equal(client.auth.getState().phase, 'checking');
  assert.equal(client.page.getClinicalWorkspace(), bundle); assert.equal(bundle.file.getState().draftDirty, true);
  client.authHooks.gate.resolve(); await checking;
  assert.equal(bundle.file.setDraftDirty(OTHER, false), false);
  assert.equal(bundle.file.setDraftDirty(PATIENT, false), true);
  assert.equal(client.page.closeClinical(bundle), true);
  assert.equal(bundle.file.getState().closed, true); assert.equal(bundle.recovery.getState().closed, true);
  assert.equal(server.writes(), 0); await client.page.dispose();
});

test('actual logout during an accepted clinical commit masks late success without claiming the server payment was undone', async () => {
  const server = syntheticServer(), client = server.client(), bundle = await client.open();
  assert.equal(await bundle.file.open(PATIENT), true);
  server.hooks.pauseCommit = true; server.hooks.accepted = deferred(); server.hooks.replyGate = deferred();
  const saving = bundle.file.saveVisit(PATIENT, visit(), 10_000);
  await server.hooks.accepted.promise;
  const operationId = bundle.file.getState().pendingOperationId!;
  assert.equal(server.rows.get(path('operationIntents', operationId)).status, 'committed');
  assert.equal(server.rows.get(path('patientAccounts')).paidCents, 10_000);
  assert.equal(server.count('patientReceipts'), 1);
  const logout = client.page.signOut();
  assert.equal(client.page.getClinicalWorkspace(), null);
  assert.equal(bundle.file.getState().closed, true); assert.equal(bundle.file.getState().snapshot, null);
  assert.equal(bundle.recovery.getState().closed, true); assert.deepEqual(bundle.recovery.getState().records, []);
  server.hooks.replyGate.resolve(); assert.equal(await saving, false); assert.equal(await logout, true);
  assert.equal(bundle.file.getState().notice, ''); assert.equal(bundle.file.getState().pendingOperationId, null);
  assert.equal(server.count('patientReceipts'), 1); assert.equal(server.rows.get(path('patientAccounts')).paidCents, 10_000);
  await client.page.dispose();
});
