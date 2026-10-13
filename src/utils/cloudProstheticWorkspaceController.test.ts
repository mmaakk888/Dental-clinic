import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createCloudProstheticWorkspaceController, parseCloudProstheticMoney } from './cloudProstheticWorkspaceController';
import { createCloudProstheticRepository, type CloudProstheticAdapter } from './cloudProstheticRepository';
import { createCloudClinicalRepository, type CloudClinicalAdapter } from './cloudClinicalRepository';
import { createCloudClinicSettingsRepository } from './cloudClinicSettingsRepository';
import { createCloudOperationIntentRepository } from './cloudOperationIntent';
import { loadCloudProstheticLedger } from './cloudProstheticLedgerProjection';

const OWNER = 'synthetic-prosthetic-workspace-owner';
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PATIENT = id(900), LAB = id(901), SERVICE = id(902), MATERIAL = id(903), WHEN = '2026-10-12T00:00:00.000Z', DAY = '2026-10-12';
const path = (collection: string, key: string | number) => `clinics/main/${collection}/${key}`;
const digest = async (value: string) => createHash('sha256').update(value).digest('hex');
function deferred() { let resolve!: () => void; const promise = new Promise<void>(accept => { resolve = accept; }); return { promise, resolve }; }
/** Fabricated atomic adapter and real pure domain/journal cores. No SDK, live
 * Auth, browser records or Firebase services are involved. */
function harness() {
  const docs = new Map<string, any>([
    [path('patientProfiles', PATIENT), { schemaVersion: 1, clinicId: 'main', recordId: PATIENT, fileNo: 451, revision: 1, lastOperationId: id(999), phoneKey: null,
      data: { name: 'مريض مصطنع فقط', mobile: '', age: 35, gender: '', firstVisit: DAY, notes: '', allergy: '' } }],
    [path('patientFiles', 451), { schemaVersion: 1, clinicId: 'main', fileNo: 451, recordId: PATIENT }],
    [path('settings', 'serviceCatalog'), { schemaVersion: 1, clinicId: 'main', recordId: 'serviceCatalog', revision: 1, lastOperationId: id(999),
      data: { examinationCents: 10_000, services: [{ serviceId: SERVICE, name: 'تركيبة زيركون', kind: 'prosthetic', priceCents: 100_000, active: true }] } }],
    [path('settings', 'prostheticRouting'), { schemaVersion: 1, clinicId: 'main', recordId: 'prostheticRouting', revision: 1, lastOperationId: id(999),
      data: { routes: [{ serviceId: SERVICE, labId: LAB, materialId: MATERIAL }] } }],
    [path('labDefinitions', LAB), { schemaVersion: 1, clinicId: 'main', recordId: LAB, revision: 1, lastOperationId: id(999),
      data: { name: 'معمل خاص مصطنع', phone: '', address: '', notes: '', active: true,
        costs: [{ materialId: MATERIAL, name: 'مادة خاصة', category: 'fixed', unitLabel: 'كراون', billingBasis: 'per-unit', unitCostCents: 20_000, active: true }] } }],
  ]);
  let active = true, nextId = 1, ids = 0, times = 0;
  const calls: string[] = [], submitted: unknown[] = [];
  const hooks: { read?: (key: string) => void | Promise<void>; cap?: () => void | Promise<void>; commit?: () => void | Promise<void>; accepted?: () => void } = {};
  const faults = { lostPrepare: false, lostCommit: false, beforeCommit: false, failRefresh: false, wrongAck: false };
  const page = (collection: string, key: string, after: string | null, limit: number, field: string) => [...docs]
    .filter(([p, value]) => p.startsWith(path(collection, '')) && value[field] === key && (!after || p.split('/').at(-1)! > after))
    .sort(([a], [b]) => a.localeCompare(b)).slice(0, limit).map(([p, data]) => ({ id: p.split('/').at(-1)!, data: structuredClone(data) }));
  const adapter: CloudProstheticAdapter & CloudClinicalAdapter = {
    authorizeOwner: async () => OWNER,
    readRecord: async key => { calls.push(`read:${key}`); await hooks.read?.(key);
      if (faults.failRefresh) { faults.failRefresh = false; throw new Error('PRIVATE_PROVIDER'); } return structuredClone(docs.get(key) ?? null); },
    runTransaction: async work => { const staged = structuredClone(docs); let written = false;
      const result = await work({ get: async key => { assert.equal(written, false); return structuredClone(staged.get(key) ?? null); },
        set: (key, value) => { written = true; staged.set(key, structuredClone(value)); } });
      docs.clear(); for (const [key, value] of staged) docs.set(key, value); return result; },
    listCasesPage: async (labId, after, limit) => page('labCases', labId, after, limit, 'labId'),
    listPaymentsPage: async (labId, after, limit) => page('labPayments', labId, after, limit, 'labId'),
    listSessionsPage: async (patientId, after, limit) => page('patientSessions', patientId, after, limit, 'patientId'),
    listReceiptsPage: async (patientId, after, limit) => page('patientReceipts', patientId, after, limit, 'patientId'),
  };
  const journalCore = createCloudOperationIntentRepository({ ...adapter,
    listHistoryPage: async (kind, uid, after, limit) => [...docs].filter(([key, value]) => key.startsWith(path('operationIntents', ''))
      && value.kind === kind && value.actorUid === uid && (!after || value.operationId > after))
      .sort(([a], [b]) => a.localeCompare(b)).slice(0, limit).map(([, value]) => ({ id: value.operationId, data: structuredClone(value) })),
  }, { digest });
  const core = createCloudProstheticRepository(adapter, { digest }), clinical = createCloudClinicalRepository(adapter, { digest });
  const settings = createCloudClinicSettingsRepository({ ...adapter,
    listLabsPage: async (after, limit) => [...docs].filter(([key, value]) => key.startsWith(path('labDefinitions', '')) && (!after || value.recordId > after))
      .sort(([a], [b]) => a.localeCompare(b)).slice(0, limit).map(([key, data]) => ({ id: key.split('/').at(-1)!, data: structuredClone(data) })),
  }, { digest });
  const journal = { ...journalCore, prepare: async (...args: Parameters<typeof journalCore.prepare>) => {
    calls.push('prepare'); const result = await journalCore.prepare(...args);
    if (faults.lostPrepare) { faults.lostPrepare = false; throw new Error('PRIVATE_PREPARE_ACK'); } return result;
  }, cancel: async (operationId: string) => { calls.push('cancel'); return journalCore.cancel(operationId); } };
  const capability = { journal, repository: { ...core, commit: async (command: Parameters<typeof core.commit>[0]) => {
    calls.push('commit'); submitted.push(structuredClone(command)); await hooks.commit?.();
    if (faults.beforeCommit) throw new Error('PRIVATE_COMMIT');
    const result = await core.commit(command); hooks.accepted?.();
    if (faults.lostCommit) { faults.lostCommit = false; throw new Error('PRIVATE_ACK'); }
    return faults.wrongAck ? { ...result, labRevision: result.labRevision + 1 } : result;
  } } };
  const options = { getCapability: async () => { calls.push('capability'); await hooks.cap?.(); return capability; },
    getClinical: async () => { calls.push('clinical'); return { repository: clinical, journal }; },
    getSettings: async () => { calls.push('settings'); return { repository: settings }; },
    getCatalog: async () => { calls.push('catalog'); return structuredClone(docs.get(path('settings', 'serviceCatalog')) ?? null); },
    ownerUid: OWNER, isActive: () => active, newId: () => { ids++; return id(nextId++); }, now: () => { times++; return WHEN; } };
  return { docs, calls, submitted, hooks, faults, core, clinical, settings, journal, capability, options,
    controller: createCloudProstheticWorkspaceController(options), fresh: () => createCloudProstheticWorkspaceController(options),
    active: (value: boolean) => { active = value; }, ids: () => ids, times: () => times };
}
async function order(h: ReturnType<typeof harness>, options: { paid?: string; units?: string; examination?: boolean } = {}) {
  assert.equal(await h.controller.beginOrder(PATIENT), true); const draft = h.controller.getState().draft!;
  assert.equal(h.controller.selectService(draft.handle, SERVICE), true);
  assert.equal(h.controller.updateDraft(draft.handle, { paid: options.paid ?? '500', units: options.units ?? '3', includeExamination: options.examination ?? true,
    teethIds: options.units === '1' ? ['ur4'] : ['ur4', 'ur5', 'ur6'] }), true); return draft.handle;
}
async function saved(h: ReturnType<typeof harness>) { const handle = await order(h); assert.equal(await h.controller.saveDraft(handle), true); }

test('prosthetic workspace and subscription are inert; public file number is never write identity', async () => {
  const h = harness(), unsubscribe = h.controller.subscribe(() => undefined); assert.deepEqual(h.calls, []); assert.equal(h.ids(), 0); assert.equal(h.times(), 0);
  assert.equal(await h.controller.beginOrder('451'), false); assert.deepEqual(h.calls, []); assert.equal(h.controller.getState().ledger, null); unsubscribe();
});
test('order choices and editor expose patient prices only, with opt-in configured examination and shared teeth', async () => {
  const h = harness(), handle = await order(h);
  const draft = h.controller.getState().draft!; assert.equal(draft.type, 'order');
  assert.doesNotMatch(JSON.stringify(draft), /labId|unitCost|معمل خاص|مادة خاصة|expectedLab/);
  assert.equal(h.controller.canClose(), false); assert.equal(await h.controller.openLab(LAB, '2026-10'), false);
  assert.equal(await h.controller.saveDraft(handle), true); const ledger = h.controller.getState().ledger!;
  assert.equal(ledger.totalCostCents, 60_000); assert.equal(ledger.patientCollectedCents, 50_000); assert.equal(ledger.patientRemainingCents, 260_000);
  assert.equal(ledger.reservedForLabCents, 50_000); assert.equal(ledger.availableToClinicCents, 0); assert.equal(h.ids(), 1);
  assert.equal(h.docs.get(path('operationIntents', id(1))).status, 'committed');
  assert.equal(h.docs.get(path('patientAccounts', PATIENT)).totalCents, 310_000); assert.equal(h.controller.canClose(), true);
});
test('blank or invalid money, mismatching fixed teeth and missing service never consume operation IDs', async () => {
  for (const patch of [{ paid: '' }, { paid: 'NaN' }, { paid: '99999' }, { unitPrice: '' }, { units: '2' }, { date: '2026-02-30' }]) {
    const h = harness(), handle = await order(h); h.controller.updateDraft(handle, patch);
    assert.equal(await h.controller.saveDraft(handle), false); assert.equal(h.ids(), 0); assert.equal(h.calls.includes('prepare'), false);
  }
  const h = harness(); await h.controller.beginOrder(PATIENT); assert.equal(await h.controller.saveDraft(h.controller.getState().draft!.handle), false); assert.equal(h.ids(), 0);
});
test('explicit zero collection does not create a receipt; fee is not automatically charged', async () => {
  const h = harness(), handle = await order(h, { paid: '0', examination: false }); await h.controller.saveDraft(handle);
  assert.equal(h.docs.has(path('patientReceipts', id(1))), false); assert.equal(h.docs.get(path('patientAccounts', PATIENT)).totalCents, 300_000);
});
test('unknown catalog, routing, supplier cost or inactive material never substitutes browser defaults', async () => {
  for (const change of [(h: ReturnType<typeof harness>) => h.docs.delete(path('settings', 'serviceCatalog')),
    (h: ReturnType<typeof harness>) => h.docs.delete(path('settings', 'prostheticRouting')),
    (h: ReturnType<typeof harness>) => { h.docs.get(path('labDefinitions', LAB)).data.costs[0].unitCostCents = null; },
    (h: ReturnType<typeof harness>) => { h.docs.get(path('labDefinitions', LAB)).data.costs[0].active = false; }]) {
    const h = harness(); change(h); assert.equal(await h.controller.beginOrder(PATIENT), false); assert.equal(h.controller.getState().draft, null); assert.equal(h.ids(), 0);
  }
});
test('service price adjustment remains separate from private immutable supplier cost', async () => {
  const h = harness(), handle = await order(h); h.controller.updateDraft(handle, { unitPrice: '1200' }); await h.controller.saveDraft(handle);
  assert.equal(h.controller.getState().ledger!.cases[0].snapshot.patientUnitPriceCents, 120_000);
  assert.equal(h.controller.getState().ledger!.cases[0].snapshot.unitCostCents, 20_000); assert.equal(h.docs.get(path('patientAccounts', PATIENT)).totalCents, 370_000);
});
test('lost durable prepare retains exact ID/time/body and locks navigation until original retry', async () => {
  const h = harness(), handle = await order(h); h.faults.lostPrepare = true;
  assert.equal(await h.controller.saveDraft(handle), false); assert.equal(h.controller.getState().saveStatus, 'retry-required');
  assert.equal(h.controller.updateDraft(handle, { paid: '200' }), false); assert.equal(h.controller.cancelDraft(handle), false);
  assert.equal(await h.controller.loadHistory(), false); assert.equal(h.controller.canClose(), false);
  const original = structuredClone(h.docs.get(path('operationIntents', id(1))).command), times = h.times();
  assert.equal(await h.controller.retry(id(1)), true); assert.deepEqual(h.submitted, [original]); assert.equal(h.ids(), 1); assert.equal(h.times(), times);
});
test('lost commit ACK cannot duplicate patient debt, cash, order or lab payment on same-ID retry', async () => {
  const h = harness(), handle = await order(h); h.faults.lostCommit = true; assert.equal(await h.controller.saveDraft(handle), false);
  assert.equal(await h.controller.cancelPending(id(1)), false); assert.equal(h.calls.includes('cancel'), false);
  assert.equal(await h.controller.retry(id(1)), true); assert.deepEqual(h.submitted[0], h.submitted[1]);
  assert.equal(h.controller.getState().ledger!.cases.length, 1); assert.equal(h.docs.get(path('patientAccounts', PATIENT)).totalCents, 310_000);
  assert.equal(h.docs.get(path('patientAccounts', PATIENT)).paidCents, 50_000);
});
test('acknowledged refresh failure retries only reads, not journal preparation or a new write', async () => {
  const h = harness(), handle = await order(h); h.hooks.accepted = () => { h.faults.failRefresh = true; h.hooks.accepted = undefined; };
  assert.equal(await h.controller.saveDraft(handle), false); assert.equal(h.controller.getState().saveStatus, 'refresh-required'); assert.equal(h.controller.getState().ledger, null);
  const prepares = h.calls.filter(x => x === 'prepare').length, commits = h.calls.filter(x => x === 'commit').length;
  assert.equal(await h.controller.retry(id(1)), true); assert.equal(h.calls.filter(x => x === 'prepare').length, prepares); assert.equal(h.calls.filter(x => x === 'commit').length, commits);
});
test('reentrant ACK listener cannot race the first refresh or start another operation', async () => {
  const h = harness(), handle = await order(h); let reentered = false;
  h.controller.subscribe(state => { if (state.saveStatus === 'refresh-required' && state.loading) {
    reentered = true; assert.equal(h.controller.canClose(), false); assert.equal(h.controller.beginPayment(), false); void h.controller.retry(id(1));
  } });
  assert.equal(await h.controller.saveDraft(handle), true); assert.equal(reentered, true); assert.equal(h.calls.filter(x => x === 'commit').length, 1);
});
test('wrong ACK shape/revision fails closed, retaining original operation for historical confirmation', async () => {
  const h = harness(), handle = await order(h); h.faults.wrongAck = true; assert.equal(await h.controller.saveDraft(handle), false);
  assert.equal(h.controller.getState().saveStatus, 'retry-required'); assert.equal(h.controller.getState().ledger, null);
  h.faults.wrongAck = false; assert.equal(await h.controller.retry(id(1)), true); assert.equal(h.ids(), 1);
});
test('CAS catalog changes retain the stale body until confirmed cancellation then fresh re-entry', async () => {
  const h = harness(), handle = await order(h); h.docs.get(path('settings', 'serviceCatalog')).revision = 2;
  assert.equal(await h.controller.saveDraft(handle), false); assert.equal(await h.controller.retry(id(1)), false);
  assert.equal(await h.controller.cancelPending(id(1)), true); assert.equal(h.docs.get(path('operationIntents', id(1))).status, 'cancelled');
  assert.equal(h.controller.getState().loaded, false); assert.equal(h.controller.getState().draft, null); assert.equal(await h.controller.beginOrder(PATIENT), true);
});
test('confirmed cancellation checks original owner/kind/body and cannot discard a committed write', async () => {
  const h = harness(), handle = await order(h); h.faults.beforeCommit = true; await h.controller.saveDraft(handle);
  h.docs.get(path('operationIntents', id(1))).command.note = 'مختلف';
  assert.equal(await h.controller.cancelPending(id(1)), false); assert.equal(h.calls.includes('cancel'), false); assert.equal(h.controller.canClose(), false);
});
test('progress and dated lab payments never alter patient charges/receipts; ledger shows lifetime/month allocations', async () => {
  const h = harness(); await saved(h); const before = structuredClone(h.docs.get(path('patientAccounts', PATIENT)));
  assert.equal(h.controller.beginProgress(id(1)), true); let handle = h.controller.getState().draft!.handle;
  h.controller.updateDraft(handle, { status: 'ready', note: 'جاهزة' }); assert.equal(await h.controller.saveDraft(handle), true);
  assert.equal(h.controller.beginPayment(id(1)), true); handle = h.controller.getState().draft!.handle;
  h.controller.updateDraft(handle, { amount: '200', date: '2026-11-01', note: 'دفعة مصطنعة' }); assert.equal(await h.controller.saveDraft(handle), true);
  const ledger = h.controller.getState().ledger!; assert.equal(ledger.paidCostCents, 20_000); assert.equal(ledger.monthPaidCents, 0);
  assert.equal(ledger.cases[0].status, 'ready'); assert.equal(ledger.reservedForLabCents, 30_000);
  assert.equal(await h.controller.openLab(LAB, '2026-11'), true); assert.equal(h.controller.getState().ledger!.monthPaidCents, 20_000);
  assert.deepEqual(h.docs.get(path('patientAccounts', PATIENT)), before); assert.equal(h.controller.getState().ledger!.payments[0].allocations[0].caseId, id(1));
});
test('batch allocation uses oldest unpaid cases and exact sums, never overpaying', async () => {
  const h = harness(); await saved(h); const second = await order(h, { paid: '0', examination: false }); assert.equal(await h.controller.saveDraft(second), true);
  assert.equal(h.controller.beginPayment(), true); const handle = h.controller.getState().draft!.handle;
  h.controller.updateDraft(handle, { amount: '700' }); assert.equal(await h.controller.saveDraft(handle), true);
  const allocations = h.controller.getState().ledger!.payments[0].allocations; assert.deepEqual(allocations, [{ caseId: id(1), amountCents: 60_000 }, { caseId: id(2), amountCents: 10_000 }]);
  assert.equal(h.controller.getState().ledger!.paidCostCents, 70_000);
  assert.equal(h.controller.beginPayment(), true); h.controller.updateDraft(h.controller.getState().draft!.handle, { amount: '999999' });
  assert.equal(await h.controller.saveDraft(h.controller.getState().draft!.handle), false); assert.equal(h.ids(), 3);
});
test('batch payment exceeding eight allocations fails before allocating another operation ID', async () => {
  const h = harness();
  for (let index = 0; index < 9; index++) { const handle = await order(h, { paid: '0', units: '1', examination: false }); assert.equal(await h.controller.saveDraft(handle), true); }
  assert.equal(h.controller.beginPayment(), true); const handle = h.controller.getState().draft!.handle;
  h.controller.updateDraft(handle, { amount: '1800' }); assert.equal(await h.controller.saveDraft(handle), false);
  assert.equal(h.ids(), 9); assert.equal(h.docs.has(path('operationIntents', id(10))), false); assert.equal(h.controller.getState().ledger!.paidCostCents, 0);
});
test('all-status recovery after disposal replays original committed receipt, never newer state or another ID', async () => {
  const h = harness(), handle = await order(h); h.faults.lostCommit = true; await h.controller.saveDraft(handle); h.controller.dispose();
  const fresh = h.fresh(); assert.equal(await fresh.loadHistory(), true); assert.equal(fresh.getState().history[0].status, 'committed');
  const ids = h.ids(), times = h.times(); assert.equal(await fresh.resume(id(1)), true); assert.equal(h.ids(), ids); assert.equal(h.times(), times);
  assert.equal(fresh.getState().ledger!.cases.length, 1); assert.equal(h.docs.get(path('patientAccounts', PATIENT)).revision, 1);
});
test('history fails closed on missing all-status API, wrong owner or invalid full domain body', async () => {
  for (const change of [(h: ReturnType<typeof harness>) => { h.capability.journal.listHistoryPage = undefined as any; },
    (h: ReturnType<typeof harness>) => { h.docs.get(path('operationIntents', id(1))).actorUid = 'different-owner';
      h.capability.journal.listHistoryPage = async () => ({ records: [h.docs.get(path('operationIntents', id(1)))], nextAfterId: null }); },
    (h: ReturnType<typeof harness>) => { h.docs.get(path('operationIntents', id(1))).command.extra = true;
      h.capability.journal.listHistoryPage = async () => ({ records: [h.docs.get(path('operationIntents', id(1)))], nextAfterId: null }); }]) {
    const h = harness(); await saved(h); change(h); assert.equal(await h.controller.loadHistory(), false); assert.equal(h.controller.getState().historyLoaded, false);
  }
});
test('reads and all-status history locks ordinary navigation and close before notifying listeners', async () => {
  const h = harness(), wait = deferred(); h.hooks.cap = () => wait.promise;
  const pending = h.controller.loadHistory(); assert.equal(h.controller.getState().historyLoading, true);
  assert.equal(await h.controller.beginOrder(PATIENT), false); assert.equal(await h.controller.loadLabs(), false); assert.equal(h.controller.canClose(), false);
  wait.resolve(); assert.equal(await pending, true);
});
test('actual lifetime loss clears data synchronously and rejects late reads without server undo claims', async () => {
  const h = harness(), wait = deferred(); h.hooks.cap = () => wait.promise;
  const pending = h.controller.beginOrder(PATIENT); await Promise.resolve(); h.active(false); assert.equal(h.controller.canClose(), false); wait.resolve();
  assert.equal(await pending, false); assert.equal(h.controller.getState().closed, true); assert.equal(h.controller.getState().draft, null); assert.equal(h.controller.getState().ledger, null);
});
test('draft handles cannot edit, save or cancel a replacement editor', async () => {
  const h = harness(), old = await order(h); assert.equal(h.controller.cancelDraft(old), true); const fresh = await order(h);
  assert.notEqual(old, fresh); assert.equal(h.controller.updateDraft(old, { paid: '0' }), false); assert.equal(h.controller.cancelDraft(old), false); assert.equal(await h.controller.saveDraft(old), false);
});
test('subscriber receives captured transitions even when earlier subscriber publishes a nested draft edit', async () => {
  const h = harness(), handle = await order(h); let change = true; const observed: string[] = [];
  h.controller.subscribe(state => { if (state.draft?.type === 'order' && state.draft.note === 'outer' && change) { change = false; h.controller.updateDraft(handle, { note: 'inner' }); } });
  h.controller.subscribe(state => { if (state.draft?.type === 'order') observed.push(state.draft.note); });
  h.controller.updateDraft(handle, { note: 'outer' }); assert.deepEqual(observed, ['inner', 'outer']); assert.equal((h.controller.getState().draft as any).note, 'inner');
});
test('full private loader follows later clinical cash, not copied lab case paid values', async () => {
  const h = harness(); await saved(h); const payment = { action: 'payment' as const, operationId: id(850), patientId: PATIENT, sessionId: id(1), expectedRevision: 1,
    createdAt: WHEN, date: DAY, amountCents: 50_000, note: '' };
  await h.journal.prepare('clinical', payment, WHEN); await h.clinical.commit(payment);
  const ledger = await loadCloudProstheticLedger(h.core, h.clinical, { labId: LAB, month: '2026-10' });
  assert.equal(ledger!.patientCollectedCents, 100_000); assert.equal(ledger!.reservedForLabCents, 60_000); assert.equal(ledger!.availableToClinicCents, 40_000);
  assert.equal(h.docs.get(path('labAccounts', LAB)).revision, 1); assert.equal(h.docs.get(path('labCases', id(1))).paidCostCents, 0);
});
test('patient receipt/account changes after full read invalidate private reserved totals even with same lab revision', async () => {
  const h = harness(); await saved(h); let accountReads = 0;
  h.hooks.read = key => { if (key === path('patientAccounts', PATIENT) && ++accountReads === 4) h.docs.get(key).revision++; };
  await assert.rejects(loadCloudProstheticLedger(h.core, h.clinical, { labId: LAB, month: '2026-10' }), error => !!error && typeof error === 'object' && 'code' in error && error.code === 'conflict');
});
test('private loader rechecks every earlier patient fence after reading a later linked patient', async () => {
  const h = harness(); await saved(h); const other = id(910), profile = structuredClone(h.docs.get(path('patientProfiles', PATIENT)));
  profile.recordId = other; profile.fileNo = 452; profile.data.name = 'مريض ثان مصطنع'; h.docs.set(path('patientProfiles', other), profile);
  h.docs.set(path('patientFiles', 452), { schemaVersion: 1, clinicId: 'main', fileNo: 452, recordId: other });
  assert.equal(await h.controller.beginOrder(other), true); const handle = h.controller.getState().draft!.handle;
  h.controller.selectService(handle, SERVICE); h.controller.updateDraft(handle, { paid: '0' }); assert.equal(await h.controller.saveDraft(handle), true);
  let mutate = true; h.hooks.read = key => { if (mutate && key === path('patientProfiles', other)) { mutate = false; h.docs.get(path('patientAccounts', PATIENT)).revision++; } };
  await assert.rejects(loadCloudProstheticLedger(h.core, h.clinical, { labId: LAB, month: '2026-10' }), error => !!error && typeof error === 'object' && 'code' in error && error.code === 'conflict');
});
test('injected ID callback cannot save stale content after a reentrant editor change', async () => {
  const h = harness(); let controller: ReturnType<typeof createCloudProstheticWorkspaceController>;
  controller = createCloudProstheticWorkspaceController({ ...h.options, newId: () => {
    const draft = controller.getState().draft!; controller.updateDraft(draft.handle, { note: 'changed while allocating' }); return id(1);
  } });
  assert.equal(await controller.beginOrder(PATIENT), true); const handle = controller.getState().draft!.handle;
  controller.selectService(handle, SERVICE); controller.updateDraft(handle, { paid: '0' }); assert.equal(await controller.saveDraft(handle), false);
  assert.equal(h.calls.includes('prepare'), false); assert.equal(controller.getState().saveStatus, 'idle');
});
test('mismatched linked public snapshot and incomplete clinical history reject entire private ledger', async () => {
  for (const change of [(h: ReturnType<typeof harness>) => { h.docs.get(path('patientSessions', id(1))).data.prosthetic.units = 2; },
    (h: ReturnType<typeof harness>) => h.docs.delete(path('patientReceipts', id(1))),
    (h: ReturnType<typeof harness>) => { h.docs.get(path('labCases', id(1))).snapshot.serviceName = 'مختلف'; }]) {
    const h = harness(); await saved(h); change(h); await assert.rejects(loadCloudProstheticLedger(h.core, h.clinical, { labId: LAB, month: '2026-10' }));
  }
});
test('private loader rejects fabricated summary totals and never exposes a partial total', async () => {
  const h = harness(); await saved(h); const summary = await h.core.getLabSummary({ labId: LAB, month: '2026-10' });
  const fake = { ...h.core, getLabSummary: async () => ({ ...summary!, remainingCents: 1 }) };
  await assert.rejects(loadCloudProstheticLedger(fake, h.clinical, { labId: LAB, month: '2026-10' }));
});
test('money parser supports explicit Arabic zero and cents without treating blanks as zero', () => {
  assert.equal(parseCloudProstheticMoney(''), null); assert.equal(parseCloudProstheticMoney('  '), null);
  assert.equal(parseCloudProstheticMoney('٠'), 0); assert.equal(parseCloudProstheticMoney('١٢٫٥٠'), 1250);
  for (const value of ['1.001', '-1', '1e3', 'Infinity', 'NaN', '1,200.50']) assert.equal(parseCloudProstheticMoney(value), null);
});
