import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createCloudOperatingAuthSession, type CloudOperatingAuthAdapter } from './cloudOperatingAuth';
import { createCloudOperatingPageController } from './cloudOperatingPageController';
import { createCloudClinicalRepository, type CloudClinicalAdapter } from './cloudClinicalRepository';
import { createCloudServiceCatalogRepository, type CloudServiceCatalogAdapter,
  type CloudServiceCatalogData } from './cloudServiceCatalogRepository';
import { createCloudOperationIntentRepository, type CloudIntentAdapter } from './cloudOperationIntent';
import type { CloudCatalogVisitMetadata } from './cloudCatalogVisitDraft';

// End-to-end composition of the actual pure Auth/page, captured catalog,
// visit editor, file projection and atomic domain/journal contracts. Every
// fixture is fabricated. This is not SDK, Rules, browser or two-device QA.
const UID = 'synthetic-priced-visit-owner', EMAIL = 'priced-visit@example.invalid';
const PASSWORD = 'synthetic-password-only', AUTH_TIME = 1_700_000_000;
const PATIENT = '10000000-0000-4000-8000-000000000001';
const PROFILE_OP = '20000000-0000-4000-8000-000000000001';
const SERVICE = '30000000-0000-4000-8000-000000000001';
const UNKNOWN = '30000000-0000-4000-8000-000000000002';
const PROSTHETIC = '30000000-0000-4000-8000-000000000003';
const DAY = '2026-10-11', TIME = `${DAY}T10:00:00.000Z`;
const path = (kind: string, id: string | number = PATIENT) => `clinics/main/${kind}/${id}`;
const digest = async (value: string) => createHash('sha256').update(value).digest('hex');
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(accept => { resolve = accept; });
  return { promise, resolve };
}
function membership(): Awaited<ReturnType<CloudOperatingAuthAdapter['readOwner']>> {
  return { identity: { uid: UID, email: EMAIL, status: 'owner-confirmed' },
    membership: { schemaVersion: 1, clinicId: 'main', uid: UID, role: 'owner', status: 'active',
      identityVersion: 1, verifiedAfter: AUTH_TIME }, authTime: AUTH_TIME };
}
const catalogData = (fee = 10_000, price = 30_000, name = 'خدمة علاجية مصطنعة'): CloudServiceCatalogData => ({
  examinationCents: fee,
  services: [
    { serviceId: SERVICE, name, kind: 'clinical', priceCents: price, active: true },
    { serviceId: UNKNOWN, name: 'خدمة دون سعر مصطنعة', kind: 'clinical', priceCents: null, active: true },
    { serviceId: PROSTHETIC, name: 'منتج معمل مصطنع', kind: 'prosthetic', priceCents: 50_000, active: true },
  ],
});
const metadata = (): CloudCatalogVisitMetadata => ({ date: DAY, notes: 'ملاحظات مصطنعة',
  treatmentStage: 'single', rootCanalStatus: '', visitStatus: 'completed' });

function syntheticServer() {
  const rows = new Map<string, any>([
    [path('patientProfiles'), { schemaVersion: 1, clinicId: 'main', recordId: PATIENT, fileNo: 451,
      revision: 1, lastOperationId: PROFILE_OP,
      phoneKey: createHash('sha256').update('patient-phone-v1:201000000001').digest('hex'),
      data: { name: 'مريض مصطنع', mobile: '01000000001', age: 30, gender: '', firstVisit: DAY, notes: '', allergy: '' } }],
    [path('patientFiles', 451), { schemaVersion: 1, clinicId: 'main', fileNo: 451, recordId: PATIENT }],
  ]);
  const calls: string[] = [];
  const hooks: { loseAck?: 'prepare' | 'commit'; failFileReads?: number; pauseCommit?: boolean;
    accepted?: ReturnType<typeof deferred>; replyGate?: ReturnType<typeof deferred> } = {};
  let writes = 0, idCounter = 0, commitCalls = 0, tail = Promise.resolve();
  const newId = () => `90000000-0000-4000-8000-${String(++idCounter).padStart(12, '0')}`;
  const runTransaction: CloudClinicalAdapter['runTransaction'] = async work => {
    const previous = tail; let release!: () => void;
    tail = new Promise<void>(accept => { release = accept; }); await previous;
    try {
      const staged = structuredClone(rows), changed: string[] = []; let wrote = false;
      const result = await work({
        get: async key => {
          assert.equal(wrote, false, 'all atomic reads precede writes');
          calls.push(`transaction:get:${key}`); return structuredClone(staged.get(key) ?? null);
        },
        set: (key, value) => { wrote = true; changed.push(key); staged.set(key, structuredClone(value)); },
      });
      // A rejected body publishes nothing; a lost later reply cannot undo an
      // accepted transaction or make its durable clinical intent disappear.
      rows.clear(); for (const [key, value] of staged) rows.set(key, value);
      writes += changed.length;
      const clinicalCommit = changed.some(key => key.startsWith(path('clinicalOperations', '')));
      const clinicalPrepare = changed.some(key => key.startsWith(path('operationIntents', '')))
        && changed.every(key => !key.startsWith(path('catalogOperations', '')))
        && changed.some(key => rows.get(key)?.kind === 'clinical');
      const stage = clinicalCommit ? 'commit' : clinicalPrepare ? 'prepare' : null;
      if (stage) {
        calls.push(`accepted:${stage}`);
        if (stage === 'commit' && hooks.pauseCommit) {
          hooks.pauseCommit = false; hooks.accepted?.resolve(); await hooks.replyGate?.promise;
        }
        if (hooks.loseAck === stage) {
          hooks.loseAck = undefined; throw new Error('SYNTHETIC_ACCEPTED_REPLY_LOST');
        }
      }
      return result;
    } finally { release(); }
  };
  const readRecord = async (key: string) => {
    calls.push(`get:${key}`);
    if (key === path('patientProfiles') && hooks.failFileReads) {
      hooks.failFileReads--; throw new Error('SYNTHETIC_READ_UNAVAILABLE');
    }
    return structuredClone(rows.get(key) ?? null);
  };
  function list(kind: string, after: string | null, limit: number, match: (value: any) => boolean) {
    calls.push(`list:${kind}`);
    return [...rows].filter(([key, value]) => key.startsWith(path(kind, ''))
      && (!after || key.split('/').at(-1)! > after) && match(value))
      .sort(([a], [b]) => a < b ? -1 : 1).slice(0, limit)
      .map(([key, value]) => ({ id: key.split('/').at(-1)!, data: structuredClone(value) }));
  }
  function client() {
    const authHooks: { gate?: ReturnType<typeof deferred>; started?: ReturnType<typeof deferred> } = {};
    const auth = createCloudOperatingAuthSession({
      signIn: async () => { calls.push('auth:sign-in'); },
      readOwner: async () => {
        calls.push('auth:read-owner'); authHooks.started?.resolve(); await authHooks.gate?.promise; return membership();
      },
      signOut: async () => { calls.push('auth:sign-out'); }, destroy: async () => { calls.push('auth:destroy'); },
    });
    const authorizeOwner = async () => (await auth.authorizeOwner()).uid;
    const clinicalAdapter: CloudClinicalAdapter = { authorizeOwner, runTransaction, readRecord,
      listSessionsPage: async (id, after, limit) => list('patientSessions', after, limit, row => row.patientId === id),
      listReceiptsPage: async (id, after, limit) => list('patientReceipts', after, limit, row => row.patientId === id) };
    const journalAdapter: CloudIntentAdapter = { authorizeOwner, runTransaction, readRecord,
      listPreparedPage: async (kind, uid, after, limit) => list('operationIntents', after, limit,
        row => row.kind === kind && row.actorUid === uid && row.status === 'prepared'),
      listHistoryPage: async (kind, uid, after, limit) => list('operationIntents', after, limit,
        row => row.kind === kind && row.actorUid === uid) };
    const catalogAdapter: CloudServiceCatalogAdapter = { authorizeOwner, runTransaction, readRecord };
    const clinical = createCloudClinicalRepository(clinicalAdapter, { digest });
    const repository = { ...clinical, commit: async (...args: Parameters<typeof clinical.commit>) => {
      commitCalls++; return clinical.commit(...args);
    } };
    const catalog = createCloudServiceCatalogRepository(catalogAdapter, { digest });
    const journal = createCloudOperationIntentRepository(journalAdapter, { digest });
    const page = createCloudOperatingPageController(async () => ({ ...auth,
      getClinical: async () => { calls.push('capability:clinical'); await auth.authorizeOwner(); return { repository, journal }; },
      getServiceCatalog: async () => { calls.push('capability:catalog'); await auth.authorizeOwner(); return { repository: catalog, journal }; },
    }), () => true);
    const signIn = () => page.signIn(EMAIL, PASSWORD);
    async function configureCatalog(value = catalogData()) {
      const current = await catalog.get();
      const command = { operationId: newId(), expectedRevision: current?.revision ?? 0, createdAt: TIME, data: value };
      await journal.prepare('catalog', command, TIME); await catalog.commit(command);
      return (await catalog.get())!;
    }
    async function open() {
      const bundle = await page.openClinical(); assert.ok(bundle);
      assert.ok(bundle.visit, 'the actual owner page creates the visit controller in its clinical lease');
      return { ...bundle, visit: bundle.visit, lease: bundle };
    }
    return { auth, authHooks, page, catalog, journal, repository, signIn, configureCatalog, open };
  }
  const count = (kind: string) => [...rows.keys()].filter(key => key.startsWith(path(kind, ''))).length;
  return { rows, calls, hooks, client, count, writes: () => writes, commitCalls: () => commitCalls };
}

test('priced visit captures configured examination, chosen service and tooth; only explicit save charges and actual cash collects', async () => {
  const server = syntheticServer(), client = server.client(); assert.deepEqual(server.calls, []);
  await client.signIn(); const originalCatalog = await client.configureCatalog();
  const bundle = await client.open(); await bundle.file.open(PATIENT);
  assert.equal(server.calls.includes('capability:catalog'), false, 'opening/reading a file never acquires service pricing');
  const before = server.writes();
  assert.equal(await bundle.visit.begin(bundle.file.getState().snapshot!), true);
  assert.equal(server.calls.filter(call => call === 'capability:catalog').length, 1);
  assert.equal(bundle.visit.getState().draft?.examinationCents, 10_000);
  assert.equal(bundle.visit.getState().draft?.examinationEnabled, false);
  assert.equal(bundle.file.getState().draftDirty, true);
  assert.equal(bundle.visit.chooseService(SERVICE), true);
  const rowId = bundle.visit.getState().draft!.services[0].id;
  assert.equal(bundle.visit.getState().draft?.services.length, 1, 'a single selection appends immediately');
  assert.equal(bundle.visit.setServicePrice(rowId, 25_000), true);
  assert.equal(bundle.visit.setServiceTooth(rowId, 'ur5'), true);
  assert.equal(bundle.visit.setExaminationEnabled(true), true);
  assert.equal(server.writes(), before, 'selection, tooth, price and examination edits never save');
  assert.equal(server.count('patientAccounts'), 0); assert.equal(server.count('patientReceipts'), 0);
  const newerCatalog = await client.configureCatalog(catalogData(15_000, 45_000, 'خدمة علاجية محدثة'));
  assert.equal(newerCatalog.revision, originalCatalog.revision + 1);
  assert.equal(bundle.visit.getState().catalog?.revision, originalCatalog.revision);
  assert.equal(bundle.visit.getState().draft?.examinationCents, 10_000);
  assert.equal(await bundle.visit.save(metadata(), 10_000), true);
  const snapshot = bundle.file.getState().snapshot!, session = snapshot.patient.sessions[0];
  assert.equal(snapshot.patientRecordId, PATIENT); assert.equal(snapshot.patient.id, '451');
  assert.equal(snapshot.totalCents, 35_000); assert.equal(snapshot.paidCents, 10_000);
  assert.equal(session.remain, 250); assert.equal(session.examinationFee, 100); assert.equal(session.treatmentFee, 250);
  assert.deepEqual(session.teethIds, ['ur5']);
  assert.deepEqual(session.services, [{ id: rowId, catalogServiceId: SERVICE,
    name: 'خدمة علاجية مصطنعة', price: 250, tooth: 'ur5' }]);
  const intent = server.rows.get(path('operationIntents', session.id));
  assert.equal(intent.status, 'committed'); assert.equal(intent.command.data.examinationCents, 10_000);
  assert.equal(intent.command.paidCents, 10_000); assert.equal(server.count('patientReceipts'), 1);
  assert.equal(server.rows.get(path('patientReceipts', session.id)).amountCents, 10_000);
  assert.equal(await bundle.visit.begin(snapshot), true);
  assert.equal(bundle.visit.getState().catalog?.revision, newerCatalog.revision);
  assert.equal(bundle.visit.getState().draft?.examinationEnabled, false);
  assert.equal(bundle.visit.chooseService(SERVICE), true);
  assert.equal(bundle.visit.getState().draft?.services[0].priceCents, 45_000);
  assert.equal(await bundle.visit.save(metadata(), 0), true);
  assert.equal(bundle.file.getState().snapshot?.totalCents, 80_000);
  assert.equal(bundle.file.getState().snapshot?.paidCents, 10_000);
  assert.equal(server.count('patientSessions'), 2); assert.equal(server.count('patientReceipts'), 1);
  assert.equal([...server.rows.keys()].some(key => /lab|supplier|expense|counter/i.test(key)), false);
  await client.page.dispose();
});

test('configured examination is an opt-in charge, not automatic cash or a default created on catalog load', async () => {
  const server = syntheticServer(), client = server.client(); await client.signIn(); await client.configureCatalog();
  const bundle = await client.open(); await bundle.file.open(PATIENT);
  const before = server.writes(); assert.equal(await bundle.visit.begin(bundle.file.getState().snapshot!), true);
  assert.equal(await bundle.visit.save(metadata(), 0), false, 'an empty opt-out visit is not saved');
  assert.equal(server.writes(), before); assert.equal(server.count('clinicalOperations'), 0);
  assert.equal(bundle.visit.setExaminationEnabled(true), true);
  assert.equal(await bundle.visit.save(metadata(), 0), true);
  const current = bundle.file.getState().snapshot!;
  assert.equal(current.totalCents, 10_000); assert.equal(current.paidCents, 0);
  assert.equal(current.patient.sessions[0].examinationFee, 100);
  assert.equal(current.patient.sessions[0].paymentsLog?.length ?? 0, 0);
  assert.equal(server.count('patientReceipts'), 0); assert.equal(server.count('clinicalOperations'), 1);
  await client.page.dispose();
});

test('unknown service price requires an explicit value and prosthetic classification never becomes an ordinary visit charge', async () => {
  const server = syntheticServer(), client = server.client(); await client.signIn(); await client.configureCatalog();
  const bundle = await client.open(); await bundle.file.open(PATIENT);
  await bundle.visit.begin(bundle.file.getState().snapshot!); const before = server.writes();
  assert.equal(bundle.visit.chooseService(PROSTHETIC), false);
  assert.equal(bundle.visit.chooseService(UNKNOWN), true);
  const rowId = bundle.visit.getState().draft!.services[0].id;
  assert.equal(bundle.visit.getState().draft?.services[0].priceCents, null);
  assert.equal(await bundle.visit.save(metadata(), 0), false);
  assert.equal(server.writes(), before); assert.equal(server.count('clinicalOperations'), 0);
  assert.equal(bundle.visit.setServicePrice(rowId, 0), true, 'explicit intended zero is different from unknown');
  assert.equal(await bundle.visit.save(metadata(), 0), true);
  assert.equal(bundle.file.getState().snapshot?.totalCents, 0);
  assert.equal(server.count('patientSessions'), 1); assert.equal(server.count('patientReceipts'), 0);
  await client.page.dispose();
});

for (const stage of ['prepare', 'commit'] as const) {
  test(`lost ${stage} acknowledgement blocks another visit and fresh all-status recovery replays the original priced command`, async () => {
    const server = syntheticServer(), old = server.client(); await old.signIn(); await old.configureCatalog();
    const first = await old.open(); await first.file.open(PATIENT);
    await first.visit.begin(first.file.getState().snapshot!); assert.equal(first.visit.chooseService(SERVICE), true);
    const rowId = first.visit.getState().draft!.services[0].id;
    first.visit.setServiceTooth(rowId, 'ul2'); first.visit.setExaminationEnabled(true);
    server.hooks.loseAck = stage;
    assert.equal(await first.visit.save(metadata(), 10_000), false);
    const operationId = first.file.getState().pendingOperationId!, original = structuredClone(server.rows.get(path('operationIntents', operationId)));
    assert.equal(original.status, stage === 'commit' ? 'committed' : 'prepared');
    assert.equal(first.visit.getState().phase, 'pending');
    const beforeBlocked = server.writes();
    assert.equal(await first.visit.begin(first.file.getState().snapshot!), false);
    assert.equal(first.visit.chooseService(SERVICE), false);
    assert.equal(await first.visit.save(metadata(), 10_000), false);
    assert.equal(first.visit.cancel(), false);
    assert.equal(server.writes(), beforeBlocked); assert.equal(old.page.closeClinical(first.lease), false);
    await old.page.dispose(); assert.equal(first.visit.getState().closed, true);
    assert.equal(first.visit.getState().draft, null); assert.equal(first.visit.getState().snapshot, null);
    const fresh = server.client(); await fresh.signIn(); const next = await fresh.open();
    await next.recovery.loadFirst();
    assert.deepEqual(next.recovery.getState().records.map(row => [row.operationId, row.status]), [[operationId, original.status]]);
    const beforeReplay = server.writes();
    assert.equal(await next.file.resume(operationId), true);
    if (stage === 'commit') assert.equal(server.writes(), beforeReplay);
    assert.deepEqual(server.rows.get(path('operationIntents', operationId)).command, original.command);
    assert.equal(server.rows.get(path('operationIntents', operationId)).status, 'committed');
    assert.equal(server.count('patientSessions'), 1); assert.equal(server.count('patientReceipts'), 1);
    assert.equal(next.file.getState().snapshot?.totalCents, 40_000); assert.equal(next.file.getState().snapshot?.paidCents, 10_000);
    assert.deepEqual(next.file.getState().snapshot?.patient.sessions[0].teethIds, ['ul2']);
    assert.equal(await next.file.addReceipt(PATIENT, operationId, { amountCents: 5_000, date: DAY, note: 'دفعة لاحقة مصطنعة' }), true);
    const afterNewPayment = server.writes(); assert.equal(await next.file.resume(operationId), true);
    assert.equal(server.writes(), afterNewPayment); assert.equal(next.file.getState().snapshot?.accountRevision, 2);
    assert.equal(next.file.getState().snapshot?.paidCents, 15_000);
    assert.equal(next.file.getState().snapshot?.patient.sessions[0].paymentsLog?.length, 2);
    assert.equal(server.count('patientSessions'), 1); assert.equal(server.count('patientReceipts'), 2);
    await fresh.page.dispose();
  });
}

test('acknowledged visit with failed full-file refresh retries reads only and remains exclusive until account reconciliation', async () => {
  const server = syntheticServer(), client = server.client(); await client.signIn(); await client.configureCatalog();
  const bundle = await client.open(); await bundle.file.open(PATIENT);
  await bundle.visit.begin(bundle.file.getState().snapshot!); bundle.visit.chooseService(SERVICE);
  server.hooks.failFileReads = 1; assert.equal(await bundle.visit.save(metadata(), 5_000), false);
  assert.equal(bundle.file.getState().saveStatus, 'refresh-required'); assert.equal(bundle.visit.getState().phase, 'pending');
  const operationId = bundle.file.getState().pendingOperationId!, before = server.writes(), commits = server.commitCalls();
  assert.equal(server.rows.get(path('operationIntents', operationId)).status, 'committed');
  assert.equal(await bundle.visit.begin(bundle.file.getState().snapshot!), false);
  assert.equal(await bundle.visit.retry(), true);
  assert.equal(server.writes(), before); assert.equal(server.commitCalls(), commits, 'post-ACK retry never commits again');
  assert.equal(bundle.file.getState().snapshot?.totalCents, 30_000);
  assert.equal(bundle.file.getState().snapshot?.paidCents, 5_000);
  assert.equal(bundle.file.getState().snapshot?.patient.sessions[0].paymentsLog?.[0].id, operationId);
  assert.equal(bundle.visit.getState().phase, 'idle'); assert.equal(bundle.visit.getState().draft, null);
  await client.page.dispose();
});

test('captured visit survives temporary Auth checking, protects navigation and disappears synchronously on actual logout', async () => {
  const server = syntheticServer(), client = server.client(); await client.signIn(); await client.configureCatalog();
  const bundle = await client.open(); await bundle.file.open(PATIENT);
  await bundle.visit.begin(bundle.file.getState().snapshot!); assert.equal(bundle.visit.chooseService(SERVICE), true);
  const rowId = bundle.visit.getState().draft!.services[0].id;
  assert.equal(bundle.visit.setServiceTooth(rowId, 'lr4'), true); const draft = bundle.visit.getState().draft, before = server.writes();
  client.authHooks.started = deferred(); client.authHooks.gate = deferred();
  const checking = client.page.refresh(); await client.authHooks.started.promise;
  assert.equal(client.auth.getState().phase, 'checking');
  assert.equal(bundle.visit.getState().phase, 'editing'); assert.equal(bundle.visit.getState().draft, draft);
  assert.equal(await client.page.openCatalog(), null); assert.equal(client.page.closeClinical(bundle.lease), false);
  assert.equal(server.writes(), before);
  const logout = client.page.signOut();
  assert.equal(client.page.getClinicalWorkspace(), null); assert.equal(bundle.visit.getState().closed, true);
  assert.equal(bundle.visit.getState().snapshot, null); assert.equal(bundle.visit.getState().catalog, null);
  assert.equal(bundle.visit.getState().draft, null); assert.equal(bundle.visit.chooseService(SERVICE), false);
  client.authHooks.gate.resolve(); await checking; assert.equal(await logout, true);
  assert.equal(server.writes(), before); assert.equal(server.count('patientAccounts'), 0);
  await client.page.dispose();
});

test('accepted priced visit is not undone by logout; old draft masks late success and fresh recovery proves one actual receipt', async () => {
  const server = syntheticServer(), old = server.client(); await old.signIn(); await old.configureCatalog();
  const bundle = await old.open(); await bundle.file.open(PATIENT);
  await bundle.visit.begin(bundle.file.getState().snapshot!); bundle.visit.chooseService(SERVICE); bundle.visit.setExaminationEnabled(true);
  server.hooks.pauseCommit = true; server.hooks.accepted = deferred(); server.hooks.replyGate = deferred();
  const saving = bundle.visit.save(metadata(), 10_000); await server.hooks.accepted.promise;
  const operationId = bundle.file.getState().pendingOperationId!;
  assert.equal(server.rows.get(path('patientAccounts')).totalCents, 40_000);
  assert.equal(server.rows.get(path('patientAccounts')).paidCents, 10_000);
  const logout = old.page.signOut();
  assert.equal(bundle.visit.getState().closed, true); assert.equal(bundle.visit.getState().draft, null);
  assert.equal(bundle.file.getState().snapshot, null); server.hooks.replyGate.resolve();
  assert.equal(await saving, false); assert.equal(await logout, true);
  const fresh = server.client(); await fresh.signIn(); const next = await fresh.open(); await next.recovery.loadFirst();
  assert.equal(next.recovery.getState().records[0].operationId, operationId);
  assert.equal(next.recovery.getState().records[0].status, 'committed');
  const before = server.writes(); assert.equal(await next.file.resume(operationId), true);
  assert.equal(server.writes(), before); assert.equal(server.count('patientSessions'), 1);
  assert.equal(server.count('patientReceipts'), 1); assert.equal(next.file.getState().snapshot?.paidCents, 10_000);
  await old.page.dispose(); await fresh.page.dispose();
});

test('a concurrent account revision never rebases a captured visit or payment; explicit durable cancellation requires a fresh complete file', async () => {
  const server = syntheticServer(), first = server.client(); await first.signIn(); await first.configureCatalog();
  const bundle = await first.open(); await bundle.file.open(PATIENT);
  await bundle.visit.begin(bundle.file.getState().snapshot!); bundle.visit.chooseService(SERVICE);
  assert.equal(await bundle.visit.save(metadata(), 10_000), true);
  const firstSession = bundle.file.getState().snapshot!.patient.sessions[0].id;
  const captured = bundle.file.getState().snapshot!;
  await bundle.visit.begin(captured); bundle.visit.chooseService(SERVICE);
  const other = server.client(); await other.signIn(); const concurrent = await other.open(); await concurrent.file.open(PATIENT);
  assert.equal(await concurrent.file.addReceipt(PATIENT, firstSession, { amountCents: 5_000, date: DAY, note: 'تحصيل متزامن مصطنع' }), true);
  assert.equal(server.rows.get(path('patientAccounts')).revision, 2);
  assert.equal(await bundle.visit.save(metadata(), 10_000), false);
  const operationId = bundle.file.getState().pendingOperationId!, before = server.writes();
  const original = structuredClone(server.rows.get(path('operationIntents', operationId)));
  assert.equal(original.status, 'prepared'); assert.equal(original.command.expectedRevision, 1);
  assert.equal(await bundle.visit.retry(), false);
  assert.equal(server.writes(), before); assert.equal(server.count('patientSessions'), 1);
  assert.equal(server.rows.get(path('patientAccounts')).totalCents, 30_000);
  assert.equal(server.rows.get(path('patientAccounts')).paidCents, 15_000);
  assert.equal(bundle.visit.getState().snapshot, captured, 'the stale visit is retained, not silently rebased');
  assert.equal(await bundle.visit.cancelPending(), true);
  assert.equal(server.rows.get(path('operationIntents', operationId)).status, 'cancelled');
  assert.deepEqual(server.rows.get(path('operationIntents', operationId)).command, original.command);
  assert.equal(bundle.visit.getState().phase, 'idle'); assert.equal(bundle.file.getState().snapshot, null);
  assert.equal(bundle.file.getState().loaded, false, 'cancellation never publishes stale totals as current');
  assert.equal(await bundle.file.open(PATIENT), true);
  assert.equal(bundle.file.getState().snapshot?.accountRevision, 2);
  assert.equal(bundle.file.getState().snapshot?.paidCents, 15_000);
  assert.equal(await bundle.visit.begin(bundle.file.getState().snapshot!), true);
  assert.equal(bundle.visit.cancel(), true); assert.equal(bundle.file.getState().draftDirty, false);
  assert.equal(server.count('patientSessions'), 1); assert.equal(server.count('patientReceipts'), 2);
  await first.page.dispose(); await other.page.dispose();
});

test('a genuinely missing protected catalog cannot seed an examination price, create a charge or strand the file dirty', async () => {
  const server = syntheticServer(), client = server.client(); await client.signIn();
  const bundle = await client.open(); await bundle.file.open(PATIENT); const snapshot = bundle.file.getState().snapshot!;
  assert.equal(await bundle.visit.begin(snapshot), false);
  assert.equal(bundle.visit.getState().phase, 'idle'); assert.equal(bundle.visit.getState().catalog, null);
  assert.equal(bundle.visit.getState().draft, null); assert.equal(bundle.file.getState().draftDirty, false);
  assert.equal(bundle.file.getState().snapshot, snapshot); assert.equal(server.writes(), 0);
  assert.equal(server.count('operationIntents'), 0); assert.equal(server.count('patientAccounts'), 0);
  assert.equal(client.page.closeClinical(bundle.lease), true);
  await client.page.dispose();
});

test('replacing or removing a row tooth cannot retain invisible row-derived teeth in an examination-only saved visit', async () => {
  const server = syntheticServer(), client = server.client(); await client.signIn(); await client.configureCatalog();
  const bundle = await client.open(); await bundle.file.open(PATIENT);
  await bundle.visit.begin(bundle.file.getState().snapshot!); bundle.visit.chooseService(SERVICE);
  const rowId = bundle.visit.getState().draft!.services[0].id;
  assert.equal(bundle.visit.setServiceTooth(rowId, 'ur5'), true);
  assert.equal(bundle.visit.setServiceTooth(rowId, 'ul2'), true);
  assert.deepEqual(bundle.visit.getState().draft?.teethIds, ['ul2'], 'the old row tooth is no longer selected anywhere');
  assert.equal(bundle.visit.removeService(rowId), true);
  assert.deepEqual(bundle.visit.getState().draft?.teethIds, [], 'removing the only selected row removes its implicit tooth');
  assert.equal(bundle.visit.setExaminationEnabled(true), true); assert.equal(await bundle.visit.save(metadata(), 0), true);
  const session = bundle.file.getState().snapshot!.patient.sessions[0];
  assert.deepEqual(session.teethIds, []); assert.deepEqual(session.services, []);
  assert.equal(session.examinationFee, 100); assert.equal(session.amount, 100); assert.equal(session.paid, 0);
  await client.page.dispose();
});

test('row tooth reconciliation preserves explicit whole-visit teeth and teeth still used by another selected service', async () => {
  const server = syntheticServer(), client = server.client(); await client.signIn(); await client.configureCatalog();
  const bundle = await client.open(); await bundle.file.open(PATIENT);
  await bundle.visit.begin(bundle.file.getState().snapshot!);
  assert.equal(bundle.visit.setTeeth(['ur5', 'lr3']), true);
  assert.equal(bundle.visit.chooseService(SERVICE), true); const firstRow = bundle.visit.getState().draft!.services[0].id;
  assert.equal(bundle.visit.setServiceTooth(firstRow, 'ur5'), true);
  assert.equal(bundle.visit.setServiceTooth(firstRow, 'ul2'), true);
  assert.equal(bundle.visit.chooseService(SERVICE), true); const secondRow = bundle.visit.getState().draft!.services[1].id;
  assert.equal(bundle.visit.setServiceTooth(secondRow, 'ul2'), true);
  assert.equal(bundle.visit.removeService(firstRow), true);
  assert.deepEqual(new Set(bundle.visit.getState().draft?.teethIds), new Set(['ur5', 'lr3', 'ul2']));
  assert.equal(bundle.visit.removeService(secondRow), true);
  assert.deepEqual(bundle.visit.getState().draft?.teethIds, ['ur5', 'lr3']);
  assert.equal(bundle.visit.setExaminationEnabled(true), true); assert.equal(await bundle.visit.save(metadata(), 0), true);
  assert.deepEqual(bundle.file.getState().snapshot?.patient.sessions[0].teethIds, ['ur5', 'lr3']);
  await client.page.dispose();
});
