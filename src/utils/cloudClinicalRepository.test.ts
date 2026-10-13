import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { prepareCloudIntentCommand } from './cloudOperationIntent';
import { CloudClinicalError, createCloudClinicalRepository, parseCloudClinicalAccount, parseCloudClinicalSession,
  parseCloudClinicalReceipt, prepareCloudClinicalCommand, prepareCloudClinicalPageInput, prepareCloudClinicalSessionData,
  type CloudClinicalAdapter, type CloudClinicalCommand, type CloudClinicalSessionData } from './cloudClinicalRepository';

// Atomic fabricated server only. These are not Rules-engine, SDK/Auth or
// two-device tests, and never touch browser records or a Firebase project.
const OWNER = 'synthetic-clinical-owner', PATIENT = '10000000-0000-4000-8000-000000000001';
const OTHER = '10000000-0000-4000-8000-000000000002';
const OP = '20000000-0000-4000-8000-000000000001', OP2 = '20000000-0000-4000-8000-000000000002';
const OP3 = '20000000-0000-4000-8000-000000000003', ITEM = '30000000-0000-4000-8000-000000000001';
const WHEN = '2026-10-11T00:00:00.000Z', DAY = '2026-10-11';
const path = (kind: string, id: string | number = PATIENT) => `clinics/main/${kind}/${id}`;
const digest = async (value: string) => createHash('sha256').update(value).digest('hex');
const code = (expected: CloudClinicalError['code']) => (value: unknown) => value instanceof CloudClinicalError && value.code === expected;
const data = (): CloudClinicalSessionData => ({ type: 'حشو عادي', date: DAY, teethIds: ['ur5'],
  services: [{ id: ITEM, name: 'حشو عادي', priceCents: 30_000, tooth: 'ur5' }], examinationCents: 10_000,
  notes: '', treatmentStage: 'single', rootCanalStatus: '', visitStatus: 'completed' });
const visit = (changes: Record<string, unknown> = {}): CloudClinicalCommand => ({ operationId: OP, patientId: PATIENT,
  sessionId: OP, expectedRevision: 0, action: 'visit', createdAt: WHEN, data: data(), paidCents: 10_000, ...changes } as CloudClinicalCommand);
const payment = (changes: Record<string, unknown> = {}): CloudClinicalCommand => ({ operationId: OP2, patientId: PATIENT,
  sessionId: OP, expectedRevision: 1, action: 'payment', createdAt: WHEN, amountCents: 5_000, date: DAY, note: '', ...changes } as CloudClinicalCommand);
const progress = (changes: Record<string, unknown> = {}): CloudClinicalCommand => ({ operationId: OP2, patientId: PATIENT,
  sessionId: OP, expectedRevision: 1, action: 'progress', createdAt: WHEN,
  changes: { notes: 'متابعة مصطنعة', treatmentStage: 'second', rootCanalStatus: 'working_length', visitStatus: 'follow_up' }, ...changes } as CloudClinicalCommand);
function deferred() { let resolve!: () => void; const promise = new Promise<void>(accept => { resolve = accept; }); return { resolve, promise }; }
function harness(options: { lostReply?: boolean; failWrite?: number; retry?: boolean } = {}) {
  const docs = new Map<string, any>([
    [path('patientProfiles'), { schemaVersion: 1, clinicId: 'main', recordId: PATIENT, fileNo: 451, revision: 1, lastOperationId: OP3,
      phoneKey: createHash('sha256').update('patient-phone-v1:201000000001').digest('hex'),
      data: { name: 'مريض مصطنع', mobile: '01000000001', age: 30, gender: '', firstVisit: DAY, notes: '', allergy: '' } }],
    [path('patientFiles', 451), { schemaVersion: 1, clinicId: 'main', fileNo: 451, recordId: PATIENT }],
  ]);
  const calls: string[] = []; let uid = OWNER, tail = Promise.resolve(), writes = 0;
  // Upstream prepared journals are synthetic fixtures outside this domain's
  // map. The separate recovery integration tests exercise real preparation.
  const preparedIntents = new Map<string, unknown>();
  const hooks: { auth?: () => void; read?: (path: string) => void; list?: (kind: string) => unknown; gate?: ReturnType<typeof deferred>; started?: ReturnType<typeof deferred> } = {};
  const page = (kind: string, patientId: string, afterId: string | null, limit: number) => [...docs]
    .filter(([key, value]) => key.startsWith(path(kind, '')) && value.patientId === patientId && (!afterId || key.split('/').at(-1)! > afterId))
    .sort(([a], [b]) => a < b ? -1 : 1).slice(0, limit).map(([key, value]) => ({ id: key.split('/').at(-1)!, data: structuredClone(value) }));
  const adapter: CloudClinicalAdapter = {
    authorizeOwner: async () => { calls.push('auth'); hooks.auth?.(); return uid; },
    readRecord: async key => { calls.push(`read:${key}`); hooks.read?.(key); return structuredClone(docs.get(key) ?? null); },
    listSessionsPage: async (id, after, limit) => { calls.push(`sessions:${after}:${limit}`); return hooks.list ? hooks.list('sessions') : page('patientSessions', id, after, limit); },
    listReceiptsPage: async (id, after, limit) => { calls.push(`receipts:${after}:${limit}`); return hooks.list ? hooks.list('receipts') : page('patientReceipts', id, after, limit); },
    runTransaction: async work => {
      const previous = tail; let release!: () => void; tail = new Promise<void>(accept => { release = accept; }); await previous;
      const attempt = async (publish: boolean) => {
        const staged = structuredClone(docs); let wrote = false;
        const result = await work({ get: async key => { assert.equal(wrote, false, 'all reads must precede writes'); calls.push(`get:${key}`); return structuredClone(staged.get(key) ?? preparedIntents.get(key) ?? null); },
          set: (key, value) => { wrote = true; calls.push(`set:${key}`); if (++writes === options.failWrite) throw new Error('PRIVATE_PROVIDER_FAILURE'); staged.set(key, structuredClone(value)); } });
        if (publish) { docs.clear(); for (const [key, value] of staged) docs.set(key, value); }
        return result;
      };
      try {
        hooks.started?.resolve(); await hooks.gate?.promise;
        if (options.retry) { options.retry = false; await attempt(false); }
        const result = await attempt(true);
        if (options.lostReply) { options.lostReply = false; throw new Error('PRIVATE_LOST_ACK'); }
        return result;
      } finally { release(); }
    },
  };
  function client() {
    const core = createCloudClinicalRepository(adapter, { digest });
    return { ...core, commit: async (input: CloudClinicalCommand) => {
      const command = prepareCloudClinicalCommand(input), canonical = prepareCloudIntentCommand(command), capturedUid = uid;
      const requestHash = await digest(JSON.stringify(['clinic-operation-intent-v1', capturedUid, 'clinical', canonical]));
      const key = path('operationIntents', command.operationId);
      if (!preparedIntents.has(key)) preparedIntents.set(key, { schemaVersion: 1, clinicId: 'main', recordId: command.operationId,
        operationId: command.operationId, actorUid: capturedUid, kind: 'clinical', requestHash,
        status: 'prepared', revision: 1, createdAt: command.createdAt, command: canonical });
      return core.commit(command);
    } };
  }
  return { docs, calls, hooks, adapter, repo: client(), client,
    actor: (value: string) => { uid = value; }, writes: () => writes };
}

test('clinical construction is inert and missing account stays unknown, not an invented zero balance', async () => {
  const h = harness(); assert.deepEqual(h.calls, []); assert.equal(await h.repo.getAccount(PATIENT), null); assert.equal(h.writes(), 0);
  assert.equal((await h.repo.getProfile(PATIENT)).fileNo, 451); assert.equal(await h.repo.getSession(OP), null);
});
test('visit atomically links patient account, session, actual cash receipt and historical operation', async () => {
  const h = harness(), result = await h.repo.commit(visit());
  assert.deepEqual(result, { status: 'committed', patientId: PATIENT, sessionId: OP, fileNo: 451, revision: 1 });
  const account = await h.repo.getAccount(PATIENT), session = await h.repo.getSession(OP);
  assert.equal(account?.totalCents, 40_000); assert.equal(account?.paidCents, 10_000); assert.equal(account?.sessionCount, 1);
  assert.equal(session?.totalCents, 40_000); assert.equal(session?.paidCents, 10_000); assert.equal(h.writes(), 5);
  const cash = (await h.repo.listReceipts({ patientId: PATIENT })).records[0];
  assert.equal(cash.amountCents, 10_000); assert.equal(cash.paymentMethod, 'cash'); assert.equal(cash.actorUid, OWNER);
  assert.doesNotMatch(JSON.stringify(h.docs.get(path('clinicalOperations', OP))), /مصطنع|mobile|notes|services/);
});
test('optional examination is a charge, never proof of collection; zero payment creates no cash receipt', async () => {
  for (const fee of [0, 10_000]) {
    const h = harness(); await h.repo.commit(visit({ data: { ...data(), examinationCents: fee }, paidCents: 0 }));
    assert.equal((await h.repo.getAccount(PATIENT))?.totalCents, 30_000 + fee); assert.equal((await h.repo.getAccount(PATIENT))?.paidCents, 0);
    assert.equal(h.docs.has(path('patientReceipts', OP)), false); assert.equal(h.writes(), 4);
  }
});
test('exam-only visit and explicitly free clinical service do not invent treatment or paid money', async () => {
  const h = harness(); await h.repo.commit(visit({ data: { ...data(), services: [], teethIds: [], type: 'كشف', examinationCents: 10_000 }, paidCents: 0 }));
  assert.equal((await h.repo.getSession(OP))?.totalCents, 10_000);
  await h.repo.commit(visit({ operationId: OP2, sessionId: OP2, expectedRevision: 1, data: { ...data(), examinationCents: 0, services: [{ id: ITEM, name: 'خدمة بدون مقابل', priceCents: 0, tooth: 'ur5' }] }, paidCents: 0 }));
  assert.equal((await h.repo.getAccount(PATIENT))?.sessionCount, 2); assert.equal((await h.repo.getAccount(PATIENT))?.totalCents, 10_000);
});
test('additional cash payment updates one canonical session and account with one dated receipt', async () => {
  const h = harness(); await h.repo.commit(visit()); await h.repo.commit(payment());
  assert.equal((await h.repo.getSession(OP))?.paidCents, 15_000); assert.equal((await h.repo.getAccount(PATIENT))?.paidCents, 15_000);
  assert.equal((await h.repo.getAccount(PATIENT))?.totalCents, 40_000); assert.equal((await h.repo.getAccount(PATIENT))?.sessionCount, 1);
  assert.equal((await h.repo.listReceipts({ patientId: PATIENT })).records.length, 2); assert.equal(h.writes(), 10);
});
test('treatment progress changes clinical stage without a second charge, collection or session', async () => {
  const h = harness(); await h.repo.commit(visit()); await h.repo.commit(progress());
  const account = await h.repo.getAccount(PATIENT), session = await h.repo.getSession(OP);
  assert.equal(account?.revision, 2); assert.equal(account?.totalCents, 40_000); assert.equal(account?.paidCents, 10_000); assert.equal(account?.sessionCount, 1);
  assert.equal(session?.revision, 2); assert.equal(session?.data.treatmentStage, 'second'); assert.equal(session?.data.rootCanalStatus, 'working_length');
  assert.equal(session?.data.examinationCents, 10_000); assert.equal(h.docs.has(path('patientReceipts', OP2)), false);
});
test('same operation replay and lost acknowledgement never duplicate a charge or receipt, even after a newer payment', async () => {
  const h = harness({ lostReply: true }); await assert.rejects(h.repo.commit(visit()), code('unavailable'));
  const accepted = structuredClone(h.docs); assert.equal((await h.repo.commit(visit())).status, 'already-committed'); assert.deepEqual(h.docs, accepted);
  await h.repo.commit(payment()); const newer = structuredClone(h.docs);
  assert.equal((await h.repo.commit(visit())).revision, 1); assert.deepEqual(h.docs, newer); assert.equal(h.writes(), 10);
});
test('transaction callback retry publishes one canonical set, not duplicate rows', async () => {
  const h = harness({ retry: true }); await h.repo.commit(visit());
  assert.equal(h.docs.size, 7); assert.equal((await h.repo.getAccount(PATIENT))?.sessionCount, 1);
});
test('same-ID changed body, expected revision, actor or action fails without overwriting history', async () => {
  const h = harness(); await h.repo.commit(visit()); const baseline = structuredClone(h.docs);
  for (const changed of [visit({ paidCents: 0 }), visit({ expectedRevision: 1 }), progress({ operationId: OP })]) await assert.rejects(h.repo.commit(changed), code('conflict'));
  h.actor('different-synthetic-owner'); await assert.rejects(h.repo.commit(visit()), code('conflict')); assert.deepEqual(h.docs, baseline);
});
test('concurrent clients with the same account revision cannot silently overwrite or overpay', async () => {
  const h = harness(); await h.repo.commit(visit()); const second = h.client();
  const results = await Promise.allSettled([h.repo.commit(payment({ amountCents: 20_000 })), second.commit(payment({ operationId: OP3, amountCents: 20_000 }))]);
  assert.equal(results.filter(value => value.status === 'fulfilled').length, 1); assert.equal((await h.repo.getAccount(PATIENT))?.paidCents, 30_000);
  assert.equal((await h.repo.listReceipts({ patientId: PATIENT })).records.length, 2);
});
test('payment is capped by both current session debt and whole-file debt, down to one piastre', async () => {
  const h = harness(); await h.repo.commit(visit()); const before = structuredClone(h.docs);
  await assert.rejects(h.repo.commit(payment({ amountCents: 30_001 })), code('conflict')); assert.deepEqual(h.docs, before);
  // A failed prepared command remains immutable; changing the requested
  // amount is a new operation, not reuse of its recovery identity.
  await h.repo.commit(payment({ operationId: OP3, amountCents: 30_000 })); assert.equal((await h.repo.getAccount(PATIENT))?.paidCents, 40_000);
  await assert.rejects(h.repo.commit(payment({ operationId: '20000000-0000-4000-8000-000000000004', expectedRevision: 2, amountCents: 1 })), code('conflict'));
  const x = harness(); await x.repo.commit(visit()); x.docs.get(path('patientAccounts')).paidCents = 39_000;
  await assert.rejects(x.repo.commit(payment({ amountCents: 1_001 })), code('conflict'));
});
test('fractional cents, negative amounts, unsafe/oversized integers and zero additional receipts fail before authorization', async () => {
  for (const amount of [-1, 0.5, NaN, Infinity, 1_000_000_000_001, Number.MAX_SAFE_INTEGER]) {
    const h = harness(); await assert.rejects(h.repo.commit(visit({ paidCents: amount })), code('invalid')); assert.deepEqual(h.calls, []);
    await assert.rejects(h.repo.commit(payment({ amountCents: amount })), code('invalid'));
  }
  assert.throws(() => prepareCloudClinicalCommand(payment({ amountCents: 0 })), code('invalid'));
});
test('failed intermediate write publishes none of account/session/receipt/operation and exposes no provider details', async () => {
  for (const n of [1, 2, 3, 4, 5]) {
    const h = harness({ failWrite: n }), before = structuredClone(h.docs);
    await assert.rejects(h.repo.commit(visit()), code('unavailable')); assert.deepEqual(h.docs, before);
  }
});
test('commands are detached before awaiting authorization; mutation of caller fields cannot change accepted content', async () => {
  const h = harness(), command = visit(); const saving = h.repo.commit(command);
  if (command.action === 'visit') { command.data.services[0].priceCents = 999_999; command.data.notes = 'CHANGED_LATE'; }
  await saving; assert.equal((await h.repo.getSession(OP))?.totalCents, 40_000); assert.equal((await h.repo.getSession(OP))?.data.notes, '');
});
test('strict commands reject accessors, symbols, unknown private fields and sparse service/tooth lists without calling getters', () => {
  let getters = 0; const bad = visit(); Object.defineProperty(bad, 'paidCents', { enumerable: true, get() { getters++; return 0; } });
  for (const value of [bad, { ...visit(), labCost: 1 }, { ...visit(), [Symbol('private')]: true },
    visit({ data: { ...data(), services: new Array(1) } }), visit({ data: { ...data(), teethIds: new Array(1) } }), Object.create(visit())]) {
    assert.throws(() => prepareCloudClinicalCommand(value), code('invalid'));
  }
  assert.equal(getters, 0);
});
test('clinical IDs, calendar dates, timestamps and enum fields require exact canonical bounded values', () => {
  for (const changes of [{ operationId: `${OP}\n` }, { patientId: `${PATIENT}\n` }, { sessionId: OP2 }, { createdAt: '2026-02-30T00:00:00.000Z' },
    { createdAt: WHEN + '\n' }, { data: { ...data(), date: '2026-02-30' } }, { data: { ...data(), treatmentStage: 'arbitrary' } },
    { data: { ...data(), rootCanalStatus: 'arbitrary' } }, { data: { ...data(), visitStatus: 'arbitrary' } }, { expectedRevision: 2_000_000_000 }]) {
    assert.throws(() => prepareCloudClinicalCommand(visit(changes)), code('invalid'));
  }
});
test('tooth references are canonical, unique and service teeth belong to the selected board', () => {
  for (const teethIds of [['ur9'], ['ur5', 'ur5'], ['ur5\n'], ['ur5', 'bad']]) assert.throws(() => prepareCloudClinicalCommand(visit({ data: { ...data(), teethIds } })), code('invalid'));
  assert.throws(() => prepareCloudClinicalCommand(visit({ data: { ...data(), teethIds: ['ll1'] } })), code('invalid'));
  assert.throws(() => prepareCloudClinicalCommand(visit({ data: { ...data(), services: [data().services[0], data().services[0]] } })), code('invalid'));
  assert.throws(() => prepareCloudClinicalCommand(visit({ data: { ...data(), services: new Array(65).fill(data().services[0]) } })), code('invalid'));
  const child = data(); child.teethIds = ['urA']; child.services[0].tooth = 'urA'; assert.equal(prepareCloudClinicalCommand(visit({ data: child })).action, 'visit');
});
test('plain clinical path does not accept unsupported prosthetic labels or an empty uncharged visit', () => {
  for (const input of [{ ...data(), type: 'تركيبات - ثابتة' }, { ...data(), services: [{ ...data().services[0], name: 'تركيبة زيركون' }] },
    { ...data(), examinationCents: 0, services: [] }]) assert.throws(() => prepareCloudClinicalCommand(visit({ data: input })), code('invalid'));
});
function prostheticData(): CloudClinicalSessionData {
  return { ...data(), type: 'تركيب زيركون', prostheticCaseId: OP,
    prosthetic: { kind: 'fixed', material: 'تركيب زيركون', units: 3, unitPriceCents: 10_000 },
    services: [{ id: OP, name: 'تركيب زيركون', priceCents: 30_000, tooth: 'ur5', catalogServiceId: ITEM }] };
}
test('linked prosthetic session reads preserve the immutable patient-only snapshot; ordinary visits cannot create one', () => {
  const linked = prostheticData(); assert.deepEqual(prepareCloudClinicalSessionData(linked), linked);
  assert.throws(() => prepareCloudClinicalCommand(visit({ data: linked })), code('invalid'));
  assert.throws(() => prepareCloudClinicalCommand(visit({ data: { ...linked, type: 'زيركون' } })), code('invalid'));
  for (const patch of [{ prostheticCaseId: undefined }, { prosthetic: undefined }, { prostheticCaseId: OP + '\n' },
    { prosthetic: { ...linked.prosthetic, units: 0 } }, { prosthetic: { ...linked.prosthetic, units: 1.5 } },
    { prosthetic: { ...linked.prosthetic, unitPriceCents: -1 } }, { prosthetic: { ...linked.prosthetic, labCostCents: 1 } },
    { services: [{ ...linked.services[0], priceCents: 1 }] }, { services: [{ ...linked.services[0], catalogServiceId: null }] },
    { services: [{ ...linked.services[0], id: OP2 }] }]) {
    assert.throws(() => prepareCloudClinicalSessionData({ ...linked, ...patch }), code('invalid'));
  }
});
test('shared clinical payments and progress keep a prosthetic session linked and do not recharge it', async () => {
  const h = harness(); await h.repo.commit(visit());
  h.docs.get(path('patientSessions', OP)).data = prostheticData();
  const linked = await h.repo.getSession(OP); assert.equal(linked?.data.prostheticCaseId, OP);
  assert.equal((await h.repo.listSessions({ patientId: PATIENT })).records[0].data.prosthetic?.units, 3);
  await h.repo.commit(payment());
  let current = await h.repo.getSession(OP);
  assert.equal(current?.totalCents, 40_000); assert.equal(current?.paidCents, 15_000);
  assert.deepEqual(current?.data.prosthetic, prostheticData().prosthetic); assert.equal(current?.data.prostheticCaseId, OP);
  await h.repo.commit(progress({ operationId: OP3, expectedRevision: 2 }));
  current = await h.repo.getSession(OP);
  assert.equal(current?.totalCents, 40_000); assert.equal(current?.paidCents, 15_000);
  assert.equal(current?.data.prostheticCaseId, OP); assert.equal(current?.data.treatmentStage, 'second');
  assert.equal((await h.repo.getAccount(PATIENT))?.sessionCount, 1);
  assert.equal((await h.repo.listReceipts({ patientId: PATIENT })).records.length, 2);
  const wrong = structuredClone(current!); wrong.data.prostheticCaseId = OP2;
  assert.throws(() => parseCloudClinicalSession(wrong), code('invalid'));
});
test('missing/mismatched profile or immutable file index cannot create clinical orphans', async () => {
  for (const change of ['missing-profile', 'wrong-profile', 'wrong-phone', 'missing-index', 'wrong-index']) {
    const h = harness();
    if (change === 'missing-profile') h.docs.delete(path('patientProfiles'));
    if (change === 'wrong-profile') h.docs.get(path('patientProfiles')).recordId = OTHER;
    if (change === 'wrong-phone') h.docs.get(path('patientProfiles')).phoneKey = '0'.repeat(64);
    if (change === 'missing-index') h.docs.delete(path('patientFiles', 451));
    if (change === 'wrong-index') h.docs.get(path('patientFiles', 451)).recordId = OTHER;
    const before = structuredClone(h.docs); await assert.rejects(h.repo.commit(visit())); assert.deepEqual(h.docs, before); assert.equal(h.writes(), 0);
  }
});
test('account/session/cash collisions and cross-patient or inconsistent stored data fail closed', async () => {
  for (const change of ['account-other', 'session-other', 'session-paid', 'receipt-collision', 'wrong-total']) {
    const h = harness(); await h.repo.commit(visit());
    if (change === 'account-other') h.docs.get(path('patientAccounts')).patientId = OTHER;
    if (change === 'session-other') h.docs.get(path('patientSessions', OP)).patientId = OTHER;
    if (change === 'session-paid') h.docs.get(path('patientSessions', OP)).paidCents = 11_000;
    if (change === 'receipt-collision') h.docs.set(path('patientReceipts', OP2), {});
    if (change === 'wrong-total') h.docs.get(path('patientSessions', OP)).totalCents = 41_000;
    const before = structuredClone(h.docs); await assert.rejects(h.repo.commit(payment())); assert.deepEqual(h.docs, before);
  }
});
test('account revision is required before payment or progress and missing account is never bootstrapped by them', async () => {
  for (const action of [payment(), progress()]) { const h = harness(); await assert.rejects(h.repo.commit(action), code('conflict')); assert.equal(h.writes(), 0); }
  const h = harness(); await h.repo.commit(visit()); await assert.rejects(h.repo.commit(payment({ expectedRevision: 2 })), code('conflict'));
});
test('schema parsers reject malformed counters, unbalanced session totals and noncash or undated receipts', async () => {
  const h = harness(); await h.repo.commit(visit());
  const a = h.docs.get(path('patientAccounts')), s = h.docs.get(path('patientSessions', OP)), r = h.docs.get(path('patientReceipts', OP));
  for (const delta of [{ paidCents: 40_001 }, { sessionCount: 0 }, { sessionCount: 2 }, { revision: 0 }, { labCost: 1 }]) assert.throws(() => parseCloudClinicalAccount({ ...a, ...delta }), code('invalid'));
  assert.throws(() => parseCloudClinicalSession({ ...s, totalCents: s.totalCents + 1 }), code('invalid'));
  for (const delta of [{ paymentMethod: 'card' }, { amountCents: 0 }, { date: '' }, { actorUid: '' }, { createdAt: WHEN + '\n' }]) assert.throws(() => parseCloudClinicalReceipt({ ...r, ...delta }), code('invalid'));
});
test('paged session/receipt reads have checked patient/file/ID order and default25/max50 limits', async () => {
  const h = harness(); await h.repo.commit(visit()); await h.repo.commit(payment());
  assert.deepEqual(prepareCloudClinicalPageInput({ patientId: PATIENT }), { patientId: PATIENT, afterId: null, limit: 25 });
  const first = await h.repo.listReceipts({ patientId: PATIENT, limit: 1 }); assert.equal(first.nextAfterId, OP);
  const next = await h.repo.listReceipts({ patientId: PATIENT, limit: 1, afterId: first.nextAfterId }); assert.equal(next.records[0].receiptId, OP2);
  const last = await h.repo.listReceipts({ patientId: PATIENT, limit: 1, afterId: next.nextAfterId }); assert.equal(last.nextAfterId, null); assert.deepEqual(last.records, []);
  assert.equal((await h.repo.listSessions({ patientId: PATIENT, limit: 50 })).records[0].sessionId, OP);
  for (const value of [{ patientId: OTHER + '\n' }, { patientId: PATIENT, limit: 51 }, { patientId: PATIENT, afterId: OP + '\n' }, { patientId: PATIENT, limit: 0 }, { patientId: PATIENT, unexpected: 1 }]) assert.throws(() => prepareCloudClinicalPageInput(value), code('invalid'));
});
test('malformed, unsorted, cross-patient/file and document-ID-mismatch query results are rejected', async () => {
  const h = harness(); await h.repo.commit(visit()); const session = h.docs.get(path('patientSessions', OP));
  for (const rows of [new Array(1), [{ id: OP, data: { ...session, patientId: OTHER } }], [{ id: OP, data: { ...session, fileNo: 452 } }],
    [{ id: OP2, data: session }], [{ id: OP, data: session }, { id: OP, data: session }], [{ id: OP, data: session, extra: true }]]) {
    h.hooks.list = () => rows; await assert.rejects(h.repo.listSessions({ patientId: PATIENT }), code('invalid'));
  }
});
test('missing read/query methods fail closed rather than returning fabricated empty account/history', async () => {
  const h = harness(), missing = createCloudClinicalRepository({ authorizeOwner: h.adapter.authorizeOwner, runTransaction: h.adapter.runTransaction }, { digest });
  await assert.rejects(missing.getAccount(PATIENT), code('unavailable')); await assert.rejects(missing.listSessions({ patientId: PATIENT }), code('unavailable'));
  assert.equal(h.writes(), 0);
});
test('identity loss before final transaction authorization cannot publish data', async () => {
  const h = harness(); let count = 0; h.hooks.auth = () => { if (++count === 6) h.actor('different-synthetic-owner'); };
  await assert.rejects(h.repo.commit(visit()), code('unavailable')); assert.equal(h.writes(), 0); assert.equal(h.docs.size, 2);
});
test('unavailable/hostile adapter errors never escape as provider payloads or raw text', async () => {
  const h = harness(), broken = createCloudClinicalRepository({ ...h.adapter, readRecord: async () => { throw new Error('PRIVATE_PROVIDER_DETAIL'); } }, { digest });
  await assert.rejects(broken.getAccount(PATIENT), value => value instanceof CloudClinicalError && !value.message.includes('PRIVATE'));
});
test('clinical core dependency graph contains no SDK/Auth/local storage/App/private-lab backend', async () => {
  const output = await build({ entryPoints: ['src/utils/cloudClinicalRepository.ts'], bundle: true, write: false, metafile: true, platform: 'browser', logLevel: 'silent' });
  for (const input of Object.keys(output.metafile!.inputs)) assert.doesNotMatch(input, /firebase|storage\.ts|src\/App\.tsx|cloudOperatingAuth|prostheticRouting|firebaseService|offlineSync/iu);
});

test('public session draft validation needs no fabricated operation ID and cannot mutate caller data', () => {
  const input = data(), prepared = prepareCloudClinicalSessionData(input);
  input.services[0].priceCents = 1; input.teethIds.push('ur6');
  assert.equal(prepared.services[0].priceCents, 30_000); assert.deepEqual(prepared.teethIds, ['ur5']);
  assert.equal(Object.hasOwn(prepared, 'operationId'), false);
});

test('public session draft validation rejects unknown prices and normalizes hostile errors without reading storage', () => {
  const unknown = data(); unknown.services[0].priceCents = null as never;
  for (const value of [unknown, { ...data(), examinationCents: -1 }, new Proxy({}, { ownKeys() { throw new Error('PRIVATE_DRAFT'); } })]) {
    assert.throws(() => prepareCloudClinicalSessionData(value), error => code('invalid')(error) && !String(error).includes('PRIVATE'));
  }
});

test('optional catalog references retain stable identity without changing historical command shapes', () => {
  const legacy = data();
  assert.deepEqual(prepareCloudClinicalSessionData(legacy), legacy);
  for (const catalogServiceId of [OTHER, null]) {
    const input = { ...data(), services: [{ ...data().services[0], catalogServiceId }] };
    assert.equal(prepareCloudClinicalSessionData(input).services[0].catalogServiceId, catalogServiceId);
  }
  for (const catalogServiceId of ['', 'service-name', undefined, 1]) {
    assert.throws(() => prepareCloudClinicalSessionData({ ...data(), services: [{ ...data().services[0], catalogServiceId }] }), code('invalid'));
  }
});

test('stored catalog identity is part of the original immutable clinical operation fingerprint', async () => {
  const h = harness(), input = visit({ data: { ...data(), services: [{ ...data().services[0], catalogServiceId: OTHER }] } });
  await h.repo.commit(input);
  assert.equal(h.docs.get(path('patientSessions', OP)).data.services[0].catalogServiceId, OTHER);
  assert.equal((await h.repo.commit(input)).status, 'already-committed');
  const altered = structuredClone(input);
  assert.equal(altered.action, 'visit');
  if (altered.action !== 'visit') throw new Error('Synthetic visit expected');
  altered.data.services[0].catalogServiceId = OP2;
  await assert.rejects(h.repo.commit(altered), code('conflict'));
});
