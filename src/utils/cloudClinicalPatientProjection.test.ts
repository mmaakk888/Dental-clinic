import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { projectCloudClinicalPatient, loadCloudClinicalPatient } from './cloudClinicalPatientProjection';
import { CloudClinicalError, type CloudClinicalAccount, type CloudClinicalReceipt, type CloudClinicalRepository,
  type CloudClinicalSession } from './cloudClinicalRepository';
import type { CloudPatientRecord } from './cloudPatientRepository';
import { getPatientFinancialSummary, getSessionCollected } from './financials';

// Fabricated contracts only: no Firebase, browser records or real identities.
const PATIENT = '10000000-0000-4000-8000-000000000001', OTHER = '10000000-0000-4000-8000-000000000002';
const id = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const DAY = '2026-10-11', WHEN = `${DAY}T00:00:00.000Z`;
const profile = (): CloudPatientRecord => ({ schemaVersion: 1, clinicId: 'main', recordId: PATIENT,
  fileNo: 451, revision: 1, lastOperationId: id(9000), phoneKey: null,
  data: { name: 'مريض مصطنع', mobile: '', age: 30, gender: '', firstVisit: DAY, notes: '', allergy: '' } });
const session = (n = 1, paid = 10_001): CloudClinicalSession => ({ schemaVersion: 1, clinicId: 'main',
  patientId: PATIENT, fileNo: 451, sessionId: id(n), revision: 1, lastOperationId: id(n),
  totalCents: 40_001, paidCents: paid, data: { type: 'حشو عادي', date: DAY, teethIds: ['ur5'],
    services: [{ id: id(8000 + n), name: 'حشو عادي', priceCents: 30_001, tooth: 'ur5' }], examinationCents: 10_000,
    notes: 'متابعة مصطنعة', treatmentStage: 'single', rootCanalStatus: '', visitStatus: 'completed' } });
const receipt = (n = 1, sid = n, amount = 10_001): CloudClinicalReceipt => ({ schemaVersion: 1, clinicId: 'main',
  receiptId: id(n), patientId: PATIENT, sessionId: id(sid), fileNo: 451, amountCents: amount,
  date: DAY, note: '', actorUid: 'synthetic-clinical-owner', createdAt: WHEN, paymentMethod: 'cash' });
const account = (sessions: CloudClinicalSession[] = [session()]): CloudClinicalAccount => ({ schemaVersion: 1, clinicId: 'main',
  patientId: PATIENT, fileNo: 451, revision: sessions.reduce((sum, value) => sum + value.revision, 0),
  lastOperationId: sessions[sessions.length - 1].lastOperationId, sessionCount: sessions.length,
  totalCents: sessions.reduce((sum, value) => sum + value.totalCents, 0), paidCents: sessions.reduce((sum, value) => sum + value.paidCents, 0) });
const invalid = (value: unknown) => value instanceof CloudClinicalError && value.code === 'invalid';
const unavailable = (value: unknown) => value instanceof CloudClinicalError && value.code === 'unavailable';
const conflict = (value: unknown) => value instanceof CloudClinicalError && value.code === 'conflict';

test('patient presentation preserves optional stable catalog references and historical absence', () => {
  const legacy = session();
  const oldView = projectCloudClinicalPatient(profile(), account([legacy]), [legacy], [receipt()]);
  assert.equal(Object.hasOwn(oldView.patient.sessions[0].services![0], 'catalogServiceId'), false);
  for (const catalogServiceId of [id(7000), null]) {
    const current = session(); current.data.services[0].catalogServiceId = catalogServiceId;
    const result = projectCloudClinicalPatient(profile(), account([current]), [current], [receipt()]);
    assert.equal(result.patient.sessions[0].services![0].catalogServiceId, catalogServiceId);
    assert.equal(result.totalCents, 40_001); assert.equal(result.paidCents, 10_001);
  }
});

function deferred() { let resolve!: () => void; const promise = new Promise<void>(accept => { resolve = accept; }); return { resolve, promise }; }
function harness() {
  const calls: string[] = [];
  const source = { profile: profile(), account: account() as CloudClinicalAccount | null,
    sessions: [session()], receipts: [receipt()] };
  const hooks: { read?: (kind: string) => Promise<void> | void; page?: (kind: string, after: string | null) => unknown } = {};
  const read = async (kind: string) => { calls.push(kind); await hooks.read?.(kind); };
  function page<T>(records: T[], after: string | null, limit: number, key: (value: T) => string) {
    const rows = records.filter(value => after === null || key(value) > after).sort((a, b) => key(a).localeCompare(key(b))).slice(0, limit);
    return { records: structuredClone(rows), nextAfterId: rows.length === limit ? key(rows[rows.length - 1]) : null };
  }
  const repository: CloudClinicalRepository = {
    getProfile: async () => { await read('profile'); return structuredClone(source.profile); },
    getAccount: async () => { await read('account'); return structuredClone(source.account); },
    getSession: async () => { throw new Error('unused'); }, commit: async () => { throw new Error('unused'); },
    listSessions: async input => { assert.equal(input.patientId, PATIENT); assert.equal(input.limit, 50);
      await read('sessions'); return (hooks.page?.('sessions', input.afterId ?? null)
        ?? page(source.sessions, input.afterId ?? null, input.limit!, value => value.sessionId)) as any; },
    listReceipts: async input => { assert.equal(input.patientId, PATIENT); assert.equal(input.limit, 50);
      await read('receipts'); return (hooks.page?.('receipts', input.afterId ?? null)
        ?? page(source.receipts, input.afterId ?? null, input.limit!, value => value.receiptId)) as any; },
  };
  return { calls, source, hooks, repository };
}

test('projection preserves public file number separately from cloud UUID and never copies cash twice', () => {
  const snapshot = projectCloudClinicalPatient(profile(), account(), [session()], [receipt()]);
  assert.equal(snapshot.patientRecordId, PATIENT); assert.equal(snapshot.patient.id, '451');
  assert.deepEqual(snapshot.patient.payments, []); assert.equal(snapshot.accountRevision, 1);
  assert.equal(snapshot.patient.sessions[0].examinationFee, 100);
  assert.equal(snapshot.patient.sessions[0].treatmentFee, 300.01);
  assert.equal(snapshot.patient.sessions[0].paymentsLog[0].amount, 100.01);
  assert.equal(getSessionCollected(snapshot.patient.sessions[0]), 100.01);
  assert.deepEqual(getPatientFinancialSummary(snapshot.patient), {
    totalRequired: 400.01, totalCollected: 100.01, totalDiscounts: 0, totalRemaining: 300,
  });
});
test('only fully empty histories with null account form a new empty clinical projection', () => {
  const result = projectCloudClinicalPatient(profile(), null, [], []);
  assert.equal(result.accountRevision, 0); assert.deepEqual(result.patient.sessions, []);
  assert.throws(() => projectCloudClinicalPatient(profile(), null, [session()], [receipt()]), invalid);
  assert.throws(() => projectCloudClinicalPatient(profile(), null, [], [receipt()]), invalid);
  assert.throws(() => projectCloudClinicalPatient(profile(), account(), [], []), invalid);
});
test('unpaid or explicitly free service requires no invented receipt or pay date', () => {
  const current = session(1, 0);
  const result = projectCloudClinicalPatient(profile(), account([current]), [current], []);
  assert.equal(result.patient.sessions[0].paid, 0); assert.equal(result.patient.sessions[0].payDate, undefined);
  assert.deepEqual(result.patient.sessions[0].paymentsLog, []);
  current.data.services[0].priceCents = 0; current.data.examinationCents = 0; current.totalCents = 0;
  assert.equal(projectCloudClinicalPatient(profile(), account([current]), [current], []).totalCents, 0);
});
test('partial sessions, receipts, or wrong sums are rejected instead of displaying partial finances', () => {
  const a = session(), b = session(2), acc = account([a, b]);
  for (const [sessions, receipts] of [[[a], [receipt()]], [[a, b], [receipt()]],
    [[a, b], [receipt(), receipt(2, 2, 5000)]]] as const) {
    assert.throws(() => projectCloudClinicalPatient(profile(), acc, sessions, receipts), invalid);
  }
  for (const changes of [{ paidCents: 1 }, { totalCents: 1_000_000 }, { sessionCount: 3 },
    { revision: 5 }, { lastOperationId: id(99) }]) {
    assert.throws(() => projectCloudClinicalPatient(profile(), { ...account(), ...changes }, [a], [receipt()]), invalid);
  }
});
test('duplicate/cross-patient/cross-file/orphan session and receipt identities fail closed', () => {
  const a = session(), r = receipt();
  assert.throws(() => projectCloudClinicalPatient(profile(), account(), [a, a], [r]), invalid);
  assert.throws(() => projectCloudClinicalPatient(profile(), account(), [a], [r, r]), invalid);
  for (const changes of [{ patientId: OTHER }, { fileNo: 452 }]) {
    assert.throws(() => projectCloudClinicalPatient(profile(), { ...account(), ...changes }, [a], [r]), invalid);
    assert.throws(() => projectCloudClinicalPatient(profile(), account(), [{ ...a, ...changes }], [r]), invalid);
    assert.throws(() => projectCloudClinicalPatient(profile(), account(), [a], [{ ...r, ...changes }]), invalid);
  }
  assert.throws(() => projectCloudClinicalPatient(profile(), account(), [a], [{ ...r, sessionId: id(99) }]), invalid);
});
test('later receipts and progress revisions still reconcile exactly to the whole file', () => {
  const a = session(); a.revision = 3; a.lastOperationId = id(3); a.paidCents = 15_001;
  a.data.rootCanalStatus = 'working_length'; a.data.treatmentStage = 'second'; a.data.visitStatus = 'follow_up';
  const result = projectCloudClinicalPatient(profile(), account([a]), [a], [receipt(2, 1, 5000), receipt()]);
  assert.equal(result.accountRevision, 3); assert.equal(result.patient.sessions[0].paid, 150.01);
  assert.equal(result.patient.sessions[0].rootCanalStatus, 'working_length');
  assert.deepEqual(result.patient.sessions[0].paymentsLog.map(value => value.id), [id(1), id(2)]);
});
test('tooth board, services and notes remain canonical and all projected results are detached/frozen', () => {
  const p = profile(), a = session(), r = receipt(); a.data.teethIds.push('ul2');
  const result = projectCloudClinicalPatient(p, account([a]), [a], [r]);
  assert.equal(result.patient.sessions[0].tooth, null); assert.deepEqual(result.patient.sessions[0].teethIds, ['ur5', 'ul2']);
  p.data.name = 'changed'; a.data.notes = 'changed'; r.note = 'changed';
  assert.equal(result.patient.name, 'مريض مصطنع'); assert.equal(result.patient.sessions[0].visitNotes, 'متابعة مصطنعة');
  assert.equal(result.patient.sessions[0].paymentsLog[0].note, '');
  assert.equal(Object.isFrozen(result.patient.sessions[0].services![0]), true);
  assert.equal(Object.isFrozen(result.profile.data), true);
  assert.throws(() => result.patient.sessions.push({} as any));
});
test('projection rejects unknown private fields, sparse arrays and hostile accessors without invoking getters', () => {
  let getters = 0; const hostile = Object.defineProperty([], '0', { enumerable: true, get() { getters++; throw new Error('PRIVATE'); } });
  assert.throws(() => projectCloudClinicalPatient(profile(), account(), hostile, [receipt()]), invalid);
  assert.equal(getters, 0);
  assert.throws(() => projectCloudClinicalPatient(profile(), account(), new Array(1), [receipt()]), invalid);
  assert.throws(() => projectCloudClinicalPatient(profile(), account(), [{ ...session(), labCost: 5 }], [receipt()]), invalid);
});
test('selected file loader fences complete history with fresh profile/account before and after pages', async () => {
  const h = harness(); assert.deepEqual(h.calls, []);
  const result = await loadCloudClinicalPatient(h.repository, PATIENT);
  assert.equal(result.totalCents, 40_001);
  assert.deepEqual(h.calls, ['profile', 'account', 'sessions', 'receipts', 'account', 'profile']);
});
test('a genuinely new empty file is verified using both history queries and repeated null account', async () => {
  const h = harness(); h.source.account = null; h.source.sessions = []; h.source.receipts = [];
  assert.equal((await loadCloudClinicalPatient(h.repository, PATIENT)).accountRevision, 0);
  assert.equal(h.calls.filter(value => value === 'account').length, 2);
  h.source.sessions = [session()]; await assert.rejects(loadCloudClinicalPatient(h.repository, PATIENT), unavailable);
});
test('loader reads all pages including the final empty query of an exactly full page', async () => {
  const h = harness(); h.source.sessions = Array.from({ length: 50 }, (_, n) => session(n + 1));
  h.source.receipts = Array.from({ length: 50 }, (_, n) => receipt(n + 1)); h.source.account = account(h.source.sessions);
  const result = await loadCloudClinicalPatient(h.repository, PATIENT);
  assert.equal(result.patient.sessions.length, 50);
  assert.equal(h.calls.filter(value => value === 'sessions').length, 2);
  assert.equal(h.calls.filter(value => value === 'receipts').length, 2);
});
test('session/payment or profile race invalidates the entire read rather than rebasing a financial snapshot', async () => {
  for (const kind of ['account', 'profile']) {
    const h = harness(); let count = 0;
    h.hooks.read = value => { if (value === kind && ++count === 2) {
      if (kind === 'account') h.source.account!.revision++;
      else h.source.profile.revision++;
    } };
    await assert.rejects(loadCloudClinicalPatient(h.repository, PATIENT), conflict);
  }
  const h = harness(); h.source.account = null; h.source.sessions = []; h.source.receipts = [];
  let count = 0; h.hooks.read = value => { if (value === 'account' && ++count === 2) h.source.account = account(); };
  await assert.rejects(loadCloudClinicalPatient(h.repository, PATIENT), conflict);
});
test('loader rejects cursor, ordering, duplicate and malformed-page coverage claims', async () => {
  for (const page of [{ records: [session()], nextAfterId: id(1) },
    { records: [session(2), session()], nextAfterId: null }, { records: [session(), session()], nextAfterId: null },
    { records: new Array(1), nextAfterId: null }, { records: [session()], nextAfterId: null, extra: true }]) {
    const h = harness(); h.hooks.page = kind => kind === 'sessions' ? page : undefined;
    await assert.rejects(loadCloudClinicalPatient(h.repository, PATIENT), unavailable);
  }
});
test('loader bounds oversized histories and never exposes the truncated first 2000 records', async () => {
  const h = harness(); h.source.sessions = Array.from({ length: 2001 }, (_, n) => session(n + 1, 0));
  h.source.account = account(h.source.sessions); h.source.receipts = [];
  await assert.rejects(loadCloudClinicalPatient(h.repository, PATIENT), unavailable);
  assert.equal(h.calls.includes('receipts'), false);
  assert.equal(h.calls.filter(value => value === 'sessions').length, 41);
});
test('loader cannot publish after selected-file lease or identity is lost at an async boundary', async () => {
  const h = harness(), gate = deferred(), started = deferred(); let active = true;
  h.hooks.read = async kind => { if (kind === 'sessions') { started.resolve(); await gate.promise; } };
  const pending = loadCloudClinicalPatient(h.repository, PATIENT, () => { if (!active) throw new Error('PRIVATE'); });
  await started.promise; active = false; gate.resolve(); await assert.rejects(pending, unavailable);
  assert.equal(h.calls.includes('receipts'), false);
});
test('loader never returns another patient, leaks provider exceptions, or invokes malformed-page getters', async () => {
  const h = harness(); h.source.profile.recordId = OTHER;
  await assert.rejects(loadCloudClinicalPatient(h.repository, PATIENT), unavailable);
  h.source.profile = profile(); let getter = 0;
  h.hooks.page = () => Object.defineProperty({ nextAfterId: null }, 'records', { enumerable: true, get() { getter++; throw new Error('PRIVATE'); } });
  await assert.rejects(loadCloudClinicalPatient(h.repository, PATIENT), unavailable); assert.equal(getter, 0);
  h.hooks.read = () => { throw new Error('PRIVATE_PROVIDER_URL'); };
  await assert.rejects(loadCloudClinicalPatient(h.repository, PATIENT), value => unavailable(value) && !String(value).includes('PRIVATE'));
  h.calls.length = 0; await assert.rejects(loadCloudClinicalPatient(h.repository, `${PATIENT}\n`), unavailable);
  assert.deepEqual(h.calls, []);
});
test('clinical presentation/complete-history loader dependency graph remains SDK/storage/App-free', async () => {
  const result = await build({ entryPoints: ['src/utils/cloudClinicalPatientProjection.ts'], bundle: true,
    platform: 'browser', write: false, metafile: true, logLevel: 'silent' });
  for (const path of Object.keys(result.metafile!.inputs)) {
    assert.doesNotMatch(path, /firebase|storage\.ts|App\.tsx|prostheticRouting|cloudOperatingAuth/i);
  }
});
