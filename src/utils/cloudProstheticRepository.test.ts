import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createCloudOperationIntentRepository } from './cloudOperationIntent';
import { createCloudClinicalRepository } from './cloudClinicalRepository';
import { CloudProstheticError, createCloudProstheticRepository, prepareCloudProstheticCommand, prepareCloudProstheticPageInput,
  parseCloudProstheticCase, parseCloudLabAccount, parseCloudLabPayment, parseCloudProstheticCommit, projectCloudProstheticFinancials, MAX_CLOUD_LAB_PAYMENT_ALLOCATIONS,
  type CloudProstheticAdapter, type CloudProstheticCommand } from './cloudProstheticRepository';

// Fabricated atomic adapter only. Never touches a browser or Firebase project.
const OWNER = 'synthetic-prosthetic-owner';
const PATIENT = '10000000-0000-4000-8000-000000000001', LAB = '10000000-0000-4000-8000-000000000002';
const SERVICE = '10000000-0000-4000-8000-000000000003', MATERIAL = '10000000-0000-4000-8000-000000000004';
const OP = '20000000-0000-4000-8000-000000000001', OP2 = '20000000-0000-4000-8000-000000000002', OP3 = '20000000-0000-4000-8000-000000000003';
const WHEN = '2026-10-12T00:00:00.000Z', DAY = '2026-10-12';
const path = (collection: string, id: string | number = LAB) => `clinics/main/${collection}/${id}`;
const digest = async (value: string) => createHash('sha256').update(value).digest('hex');
const code = (expected: CloudProstheticError['code']) => (value: unknown) => value instanceof CloudProstheticError && value.code === expected;
const create = (changes: Record<string, unknown> = {}): CloudProstheticCommand => ({ action: 'create', operationId: OP, labId: LAB,
  expectedLabAccountRevision: 0, createdAt: WHEN, patientId: PATIENT, expectedPatientRevision: 0, serviceId: SERVICE,
  expectedCatalogRevision: 1, expectedRoutingRevision: 1, expectedLabRevision: 1, kind: 'fixed', units: 3,
  teethIds: ['ur4', 'ur5', 'ur6'], date: DAY, deliveryExpectedDate: '2026-10-20', patientUnitPriceCents: 100_000,
  includeExamination: true, paidCents: 50_000, note: 'طلب مصطنع', ...changes } as CloudProstheticCommand);
const payment = (changes: Record<string, unknown> = {}): CloudProstheticCommand => ({ action: 'lab-payment', operationId: OP2, labId: LAB,
  expectedLabAccountRevision: 1, createdAt: WHEN, date: DAY, note: 'دفعة مصطنعة',
  allocations: [{ caseId: OP, expectedRevision: 1, amountCents: 10_000 }], ...changes } as CloudProstheticCommand);
const progress = (changes: Record<string, unknown> = {}): CloudProstheticCommand => ({ action: 'progress', operationId: OP2, labId: LAB,
  expectedLabAccountRevision: 1, createdAt: WHEN, caseId: OP, expectedCaseRevision: 1, status: 'ready', note: 'جاهزة مصطنعة', ...changes } as CloudProstheticCommand);
function harness() {
  const docs = new Map<string, any>([
    [path('patientProfiles', PATIENT), { schemaVersion: 1, clinicId: 'main', recordId: PATIENT, fileNo: 451, revision: 1, lastOperationId: OP3, phoneKey: null,
      data: { name: 'مريض مصطنع', mobile: '', age: 30, gender: '', firstVisit: DAY, notes: '', allergy: '' } }],
    [path('patientFiles', 451), { schemaVersion: 1, clinicId: 'main', fileNo: 451, recordId: PATIENT }],
    [path('settings', 'serviceCatalog'), { schemaVersion: 1, clinicId: 'main', recordId: 'serviceCatalog', revision: 1, lastOperationId: OP3,
      data: { examinationCents: 10_000, services: [{ serviceId: SERVICE, name: 'تركيبة زيركون', kind: 'prosthetic', priceCents: 100_000, active: true }] } }],
    [path('settings', 'prostheticRouting'), { schemaVersion: 1, clinicId: 'main', recordId: 'prostheticRouting', revision: 1, lastOperationId: OP3,
      data: { routes: [{ serviceId: SERVICE, labId: LAB, materialId: MATERIAL }] } }],
    [path('labDefinitions'), { schemaVersion: 1, clinicId: 'main', recordId: LAB, revision: 1, lastOperationId: OP3,
      data: { name: 'معمل مصطنع', phone: '', address: '', notes: '', active: true,
        costs: [{ materialId: MATERIAL, name: 'زيركون', category: 'fixed', unitLabel: 'كراون', billingBasis: 'per-unit', unitCostCents: 20_000, active: true }] } }],
  ]);
  const calls: string[] = []; let uid = OWNER, tail = Promise.resolve(), writes = 0;
  const hooks: { read?: (key: string) => void; list?: (kind: string, rows: unknown[]) => unknown; auth?: () => void;
    lostReply?: boolean; failWrite?: number; retry?: boolean; beforeTransaction?: () => Promise<void> } = {};
  const page = (kind: string, labId: string, after: string | null, limit: number) => [...docs]
    .filter(([key, value]) => key.startsWith(path(kind, '')) && value.labId === labId && (!after || key.split('/').at(-1)! > after))
    .sort(([a], [b]) => a < b ? -1 : 1).slice(0, limit).map(([key, data]) => ({ id: key.split('/').at(-1)!, data: structuredClone(data) }));
  const adapter: CloudProstheticAdapter = {
    authorizeOwner: async () => { calls.push('auth'); hooks.auth?.(); return uid; },
    readRecord: async key => { calls.push(`read:${key}`); hooks.read?.(key); return structuredClone(docs.get(key) ?? null); },
    listCasesPage: async (labId, after, limit) => { calls.push(`cases:${after}:${limit}`); const rows = page('labCases', labId, after, limit); return hooks.list ? hooks.list('cases', rows) : rows; },
    listPaymentsPage: async (labId, after, limit) => { calls.push(`payments:${after}:${limit}`); const rows = page('labPayments', labId, after, limit); return hooks.list ? hooks.list('payments', rows) : rows; },
    runTransaction: async work => {
      const previous = tail; let release!: () => void; tail = new Promise<void>(resolve => { release = resolve; }); await previous;
      const attempt = async (publish: boolean) => {
        const staged = structuredClone(docs); let wrote = false;
        const result = await work({ get: async key => { assert.equal(wrote, false, 'all reads precede writes'); calls.push(`get:${key}`); return structuredClone(staged.get(key) ?? null); },
          set: (key, value) => { wrote = true; calls.push(`set:${key}`); if (++writes === hooks.failWrite) throw new Error('PRIVATE_PROVIDER'); staged.set(key, structuredClone(value)); } });
        if (publish) { docs.clear(); for (const [key, value] of staged) docs.set(key, value); }
        return result;
      };
      try {
        await hooks.beforeTransaction?.();
        if (hooks.retry) { hooks.retry = false; await attempt(false); }
        const result = await attempt(true);
        if (hooks.lostReply) { hooks.lostReply = false; throw new Error('PRIVATE_LOST_REPLY'); }
        return result;
      } finally { release(); }
    },
  };
  const core = createCloudProstheticRepository(adapter, { digest }), journal = createCloudOperationIntentRepository(adapter, { digest });
  const repo = { ...core, commit: async (input: CloudProstheticCommand) => {
    const command = prepareCloudProstheticCommand(input);
    await journal.prepare('prosthetic', command, command.createdAt); return core.commit(command);
  } };
  return { docs, calls, hooks, adapter, repo, core, journal, actor: (value: string) => { uid = value; }, writes: () => writes };
}
test('prosthetic construction is inert; absent lab account is unknown, not invented zero', async () => {
  const h = harness(); assert.deepEqual(h.calls, []); assert.equal(await h.repo.getLabAccount(LAB), null);
  assert.equal(await h.repo.getLabSummary({ labId: LAB, month: '2026-10' }), null); assert.equal(h.writes(), 0);
});
test('one order atomically writes linked patient debt, actual receipt, private cost and recovery receipt', async () => {
  const h = harness(), result = await h.repo.commit(create());
  assert.equal(result.patientId, PATIENT); assert.equal(result.caseId, OP); assert.equal(result.fileNo, 451);
  const account = h.docs.get(path('patientAccounts', PATIENT)), session = h.docs.get(path('patientSessions', OP));
  assert.equal(account.totalCents, 310_000); assert.equal(account.paidCents, 50_000); assert.equal(account.sessionCount, 1);
  assert.equal(session.data.prostheticCaseId, OP); assert.equal(session.data.prosthetic.units, 3);
  assert.equal(session.data.prosthetic.unitPriceCents, 100_000); assert.equal(session.services, undefined);
  const item = await h.repo.getCase(OP); assert.equal(item?.totalCostCents, 60_000); assert.equal(item?.paidCostCents, 0);
  assert.equal(h.docs.get(path('patientReceipts', OP)).amountCents, 50_000);
  assert.equal(h.docs.get(path('operationIntents', OP)).status, 'committed');
  assert.doesNotMatch(JSON.stringify([account, session, h.docs.get(path('patientReceipts', OP))]), /unitCost|labId|معمل مصطنع|paidCost|materialId/);
  assert.equal((await h.repo.getLabAccount(LAB))?.totalCostCents, 60_000);
});
test('zero collection does not create a receipt and examination remains opt-in configured charge', async () => {
  for (const includeExamination of [false, true]) {
    const h = harness(); await h.repo.commit(create({ paidCents: 0, includeExamination }));
    assert.equal(h.docs.has(path('patientReceipts', OP)), false);
    assert.equal(h.docs.get(path('patientAccounts', PATIENT)).totalCents, includeExamination ? 310_000 : 300_000);
    assert.equal(h.docs.get(path('patientAccounts', PATIENT)).paidCents, 0);
  }
});
test('explicit owner selling-price adjustment never replaces supplier or configured-price snapshots', async () => {
  const h = harness(); await h.repo.commit(create({ patientUnitPriceCents: 120_000 }));
  const item = await h.repo.getCase(OP); assert.equal(item?.snapshot.configuredPatientUnitPriceCents, 100_000);
  assert.equal(item?.snapshot.patientUnitPriceCents, 120_000); assert.equal(item?.snapshot.unitCostCents, 20_000);
  assert.equal(h.docs.get(path('patientAccounts', PATIENT)).totalCents, 370_000);
});
test('whole-case removable supplier cost is explicit rather than multiplied by tooth count', async () => {
  const h = harness(), definition = h.docs.get(path('labDefinitions'));
  definition.data.costs[0].category = 'removable'; definition.data.costs[0].billingBasis = 'whole-case';
  await h.repo.commit(create({ kind: 'removable', units: 8, teethIds: [], paidCents: 0 }));
  assert.equal((await h.repo.getCase(OP))?.totalCostCents, 20_000);
  assert.equal(h.docs.get(path('patientAccounts', PATIENT)).totalCents, 810_000);
});
test('later patient collection uses the existing clinical session, never a stale case patientPaid field', async () => {
  const h = harness(); await h.repo.commit(create());
  const clinical = createCloudClinicalRepository(h.adapter, { digest });
  const command = { action: 'payment' as const, operationId: OP2, patientId: PATIENT, sessionId: OP, expectedRevision: 1,
    createdAt: WHEN, amountCents: 25_000, date: DAY, note: '' };
  await h.journal.prepare('clinical', command, WHEN); await clinical.commit(command);
  assert.equal(h.docs.get(path('patientAccounts', PATIENT)).paidCents, 75_000);
  assert.equal(h.docs.get(path('patientSessions', OP)).paidCents, 75_000);
  assert.equal((await h.repo.getCase(OP))?.paidCostCents, 0); assert.equal((await h.repo.getLabAccount(LAB))?.paidCostCents, 0);
});
test('lab payment retains immutable dated allocation receipt and lifetime/month summaries', async () => {
  const h = harness(); await h.repo.commit(create()); await h.repo.commit(payment());
  await h.repo.commit(payment({ operationId: OP3, expectedLabAccountRevision: 2, date: '2026-11-01',
    allocations: [{ caseId: OP, expectedRevision: 2, amountCents: 15_000 }] }));
  const october = await h.repo.getLabSummary({ labId: LAB, month: '2026-10' });
  assert.equal(october?.paidCostCents, 25_000); assert.equal(october?.monthPaidCents, 10_000); assert.equal(october?.remainingCents, 35_000);
  assert.equal(october?.payments.length, 2); assert.equal(october?.payments[0].allocations[0].caseId, OP);
  assert.equal((await h.repo.getLabSummary({ labId: LAB, month: '2026-11' }))?.monthPaidCents, 15_000);
  assert.equal(h.docs.get(path('patientAccounts', PATIENT)).paidCents, 50_000);
});
test('one payment can atomically allocate across linked cases without duplicate supplier cash', async () => {
  const h = harness(); await h.repo.commit(create());
  await h.repo.commit(create({ operationId: OP2, expectedLabAccountRevision: 1, expectedPatientRevision: 1, paidCents: 0 }));
  await h.repo.commit(payment({ operationId: OP3, expectedLabAccountRevision: 2,
    allocations: [{ caseId: OP, expectedRevision: 1, amountCents: 10_000 }, { caseId: OP2, expectedRevision: 1, amountCents: 30_000 }] }));
  const summary = await h.repo.getLabSummary({ labId: LAB, month: '2026-10' });
  assert.equal(summary?.totalCostCents, 120_000); assert.equal(summary?.paidCostCents, 40_000); assert.equal(summary?.payments.length, 1);
  assert.equal(summary?.cases[0].paidCostCents, 10_000); assert.equal(summary?.cases[1].paidCostCents, 30_000);
});
test('case progress preserves snapshots, cost and cash; it advances the lab fence', async () => {
  const h = harness(); await h.repo.commit(create()); const initial = h.docs.get(path('labCases', OP));
  await h.repo.commit(progress()); const latest = await h.repo.getCase(OP);
  assert.equal(latest?.status, 'ready'); assert.equal(latest?.revision, 2); assert.deepEqual(latest?.snapshot, initial.snapshot);
  assert.equal(latest?.totalCostCents, 60_000); assert.equal(latest?.paidCostCents, 0);
  assert.equal((await h.repo.getLabAccount(LAB))?.revision, 2); assert.equal(h.docs.size, 14);
});
test('same-ID historical create replay reads receipt and intent only and never restores newer states', async () => {
  const h = harness(), command = create(); await h.repo.commit(command); await h.repo.commit(progress());
  h.docs.delete(path('settings', 'serviceCatalog')); h.docs.delete(path('labDefinitions'));
  const before = structuredClone(h.docs), writes = h.writes(); h.calls.length = 0;
  assert.equal((await h.core.commit(command)).status, 'already-committed'); assert.deepEqual(h.docs, before); assert.equal(h.writes(), writes);
  assert.deepEqual(h.calls.filter(item => item.startsWith('get:')), [`get:${path('prostheticOperations', OP)}`, `get:${path('operationIntents', OP)}`]);
});
test('historical lab payment replay never overwrites a newer payment or progress', async () => {
  const h = harness(); await h.repo.commit(create()); const command = payment(); await h.repo.commit(command);
  await h.repo.commit(progress({ operationId: OP3, expectedLabAccountRevision: 2, expectedCaseRevision: 2 }));
  const before = structuredClone(h.docs), writes = h.writes(); assert.equal((await h.core.commit(command)).status, 'already-committed');
  assert.deepEqual(h.docs, before); assert.equal(h.writes(), writes);
});
test('lost commit acknowledgement reuses the original operation without another debt or receipt', async () => {
  const h = harness(), command = prepareCloudProstheticCommand(create()); await h.journal.prepare('prosthetic', command, WHEN);
  h.hooks.lostReply = true; await assert.rejects(h.core.commit(command), code('unavailable'));
  assert.equal((await h.core.commit(command)).status, 'already-committed');
  assert.equal(h.docs.get(path('patientAccounts', PATIENT)).totalCents, 310_000);
  assert.equal([...h.docs.keys()].filter(key => key.startsWith(path('patientReceipts', ''))).length, 1);
});
test('transaction retries and concurrent creation cannot double charge', async () => {
  const h = harness(); h.hooks.retry = true; const results = await Promise.all([h.repo.commit(create()), h.repo.commit(create())]);
  assert.equal(results.filter(item => item.status === 'committed').length, 1); assert.equal(results.filter(item => item.status === 'already-committed').length, 1);
  assert.equal(h.docs.get(path('patientAccounts', PATIENT)).sessionCount, 1);
});
test('two devices at the same patient/lab revisions have one winner, never silent rebasing', async () => {
  const h = harness(); const results = await Promise.allSettled([h.repo.commit(create()), h.repo.commit(create({ operationId: OP2 }))]);
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1); assert.equal(results.filter(item => item.status === 'rejected').length, 1);
  assert.equal(h.docs.get(path('patientAccounts', PATIENT)).totalCents, 310_000);
});
test('every staged write failure leaves both clinical and private ledgers unchanged', async () => {
  for (let position = 1; position <= 7; position++) {
    const h = harness(), command = prepareCloudProstheticCommand(create()); await h.journal.prepare('prosthetic', command, WHEN);
    const before = structuredClone(h.docs); h.hooks.failWrite = h.writes() + position;
    await assert.rejects(h.core.commit(command), code('unavailable')); assert.deepEqual(h.docs, before);
  }
});
test('unprepared, cancelled and changed-content same-ID operations all fail closed', async () => {
  const h = harness(); await assert.rejects(h.core.commit(create()), code('invalid'));
  const command = prepareCloudProstheticCommand(create()); await h.journal.prepare('prosthetic', command, WHEN); await h.journal.cancel(OP);
  await assert.rejects(h.core.commit(command), code('conflict'));
  const second = harness(); await second.repo.commit(create());
  await assert.rejects(second.core.commit(create({ paidCents: 40_000 })), code('conflict'));
});
for (const mutate of [
  (h: ReturnType<typeof harness>) => h.docs.delete(path('settings', 'serviceCatalog')),
  (h: ReturnType<typeof harness>) => h.docs.get(path('settings', 'serviceCatalog')).data.services[0].active = false,
  (h: ReturnType<typeof harness>) => h.docs.get(path('settings', 'serviceCatalog')).data.services[0].kind = 'clinical',
  (h: ReturnType<typeof harness>) => h.docs.get(path('settings', 'serviceCatalog')).data.services[0].priceCents = null,
  (h: ReturnType<typeof harness>) => h.docs.get(path('settings', 'serviceCatalog')).revision = 2,
  (h: ReturnType<typeof harness>) => h.docs.delete(path('settings', 'prostheticRouting')),
  (h: ReturnType<typeof harness>) => h.docs.get(path('settings', 'prostheticRouting')).data.routes = [],
  (h: ReturnType<typeof harness>) => h.docs.get(path('settings', 'prostheticRouting')).revision = 2,
  (h: ReturnType<typeof harness>) => h.docs.get(path('labDefinitions')).revision = 2,
  (h: ReturnType<typeof harness>) => h.docs.get(path('labDefinitions')).data.active = false,
  (h: ReturnType<typeof harness>) => h.docs.get(path('labDefinitions')).data.costs[0].active = false,
  (h: ReturnType<typeof harness>) => h.docs.get(path('labDefinitions')).data.costs[0].unitCostCents = null,
  (h: ReturnType<typeof harness>) => h.docs.get(path('labDefinitions')).data.costs[0].category = 'removable',
]) test(`fresh confirmed routing and pricing are mandatory (${mutate.toString()})`, async () => {
  const h = harness(); mutate(h); const before = structuredClone(h.docs);
  await assert.rejects(h.repo.commit(create()), code('conflict'));
  for (const [key, value] of before) assert.deepEqual(h.docs.get(key), value);
  assert.equal(h.docs.has(path('patientAccounts', PATIENT)), false);
});
test('patient UUID/index and ownership are checked, public fileNo cannot substitute identity', async () => {
  const h = harness(); h.docs.get(path('patientFiles', 451)).recordId = LAB;
  await assert.rejects(h.repo.commit(create()), code('invalid'));
  await assert.rejects(h.core.commit(create({ patientId: '451' })), code('invalid'));
});
test('overpayment, wrong lab and stale allocation versions are rejected without partial cash', async () => {
  for (const changes of [
    { allocations: [{ caseId: OP, expectedRevision: 1, amountCents: 60_001 }] },
    { allocations: [{ caseId: OP, expectedRevision: 2, amountCents: 10_000 }] },
    { expectedLabAccountRevision: 2 },
  ]) {
    const h = harness(); await h.repo.commit(create()); const before = structuredClone(h.docs);
    await assert.rejects(h.repo.commit(payment(changes)), code('conflict'));
    assert.equal(h.docs.has(path('labPayments', OP2)), false); assert.deepEqual(h.docs.get(path('labCases', OP)), before.get(path('labCases', OP)));
  }
  const h = harness(); await assert.rejects(h.repo.commit(create({ paidCents: 310_001 })), code('conflict'));
});
test('input is copied before authorization and retained handlers cannot mutate the submitted command', async () => {
  const h = harness(), command = create(); h.hooks.auth = () => { (command as any).patientUnitPriceCents = 1; (command as any).teethIds.length = 0; };
  const validated = prepareCloudProstheticCommand(command); await h.journal.prepare('prosthetic', validated, WHEN); await h.core.commit(validated);
  assert.equal(h.docs.get(path('patientAccounts', PATIENT)).totalCents, 310_000); assert.equal((await h.repo.getCase(OP))?.snapshot.teethIds.length, 3);
});
test('ownership change after a server write rejects the late result, never pretends server undo', async () => {
  const h = harness(), command = prepareCloudProstheticCommand(create()); await h.journal.prepare('prosthetic', command, WHEN);
  const original = h.adapter.runTransaction;
  h.adapter.runTransaction = async work => { const result = await original(work); h.actor('another-synthetic-owner'); return result; };
  await assert.rejects(h.core.commit(command), code('unavailable')); assert.equal(h.docs.get(path('patientAccounts', PATIENT)).totalCents, 310_000);
});
test('summary rejects concurrent changes, truncated pages and allocation drift instead of displaying false totals', async () => {
  const h = harness(); await h.repo.commit(create()); await h.repo.commit(payment());
  h.hooks.list = (kind, rows) => { if (kind === 'payments') h.docs.get(path('labAccounts')).revision++; return rows; };
  await assert.rejects(h.repo.getLabSummary({ labId: LAB, month: '2026-10' }), code('conflict'));
  h.hooks.list = (kind, rows) => kind === 'payments' ? [] : rows;
  await assert.rejects(h.repo.getLabSummary({ labId: LAB, month: '2026-10' }), code('invalid'));
  h.hooks.list = undefined; h.docs.get(path('labCases', OP)).paidCostCents = 1;
  await assert.rejects(h.repo.getLabSummary({ labId: LAB, month: '2026-10' }), code('invalid'));
});
test('bounded page cursors are strict, all ledger pages include cancelled-free immutable payment history', async () => {
  const h = harness(); await h.repo.commit(create()); await h.repo.commit(payment());
  const first = await h.repo.listPayments({ labId: LAB, limit: 1 }); assert.equal(first.nextAfterId, OP2);
  assert.deepEqual(await h.repo.listPayments({ labId: LAB, limit: 1, afterId: OP2 }), { records: [], nextAfterId: null });
  h.hooks.list = (_kind, rows) => [...rows, ...rows]; await assert.rejects(h.repo.listCases({ labId: LAB }), code('invalid'));
  h.hooks.list = (_kind, rows) => { const copy = [...rows]; delete copy[0]; return copy; }; await assert.rejects(h.repo.listCases({ labId: LAB }), code('invalid'));
});
test('summary refuses orphan histories and case read rejects broken clinical linkage', async () => {
  const h = harness(); await h.repo.commit(create()); h.docs.delete(path('labAccounts'));
  await assert.rejects(h.repo.getLabSummary({ labId: LAB, month: '2026-10' }), code('invalid'));
  h.docs.get(path('patientSessions', OP)).fileNo = 452; await assert.rejects(h.repo.getCase(OP), code('invalid'));
});
test('command/parser boundaries reject unknown fields, accessors, sparse arrays, bad dates, cents and identities', () => {
  const values: unknown[] = [null, {}, create({ operationId: `${OP}\n` }), create({ patientId: '451' }), create({ units: 0 }), create({ units: 2 }),
    create({ patientUnitPriceCents: 0.5 }), create({ patientUnitPriceCents: -0 }), create({ date: '2026-02-31' }), create({ deliveryExpectedDate: '2026-01-01' }),
    create({ privateCost: 1 }), create({ teethIds: ['ur4', 'ur4', 'ur6'] }), payment({ allocations: [] }),
    payment({ allocations: [{ caseId: OP, expectedRevision: 1, amountCents: 0 }] }),
    payment({ allocations: [{ caseId: OP, expectedRevision: 1, amountCents: 1 }, { caseId: OP, expectedRevision: 1, amountCents: 1 }] }),
    progress({ status: 'cancelled' }),
  ];
  const accessor = create(); Object.defineProperty(accessor, 'note', { enumerable: true, get() { throw new Error('PRIVATE'); } }); values.push(accessor);
  const sparse = new Array(3); sparse[0] = 'ur4'; values.push(create({ teethIds: sparse }));
  for (const value of values) assert.throws(() => prepareCloudProstheticCommand(value), code('invalid'));
  assert.equal(MAX_CLOUD_LAB_PAYMENT_ALLOCATIONS, 8);
  assert.deepEqual(prepareCloudProstheticPageInput({ labId: LAB }), { labId: LAB, afterId: null, limit: 25 });
  for (const value of [{ labId: LAB, limit: 51 }, { labId: LAB, afterId: `${OP}\n` }, { labId: LAB, limit: -0 }]) assert.throws(() => prepareCloudProstheticPageInput(value), code('invalid'));
  for (const parse of [parseCloudProstheticCase, parseCloudLabAccount, parseCloudLabPayment]) assert.throws(() => parse({}), code('invalid'));
});
test('unexpected provider/Proxy failures produce only fixed safe messages', async () => {
  const h = harness(); h.adapter.authorizeOwner = async () => { throw new Error('PRIVATE_TOKEN_AND_COST'); };
  await assert.rejects(h.core.commit(create()), error => code('unavailable')(error) && !String(error).includes('PRIVATE'));
  const proxy = new Proxy({}, { getPrototypeOf() { throw new Error('PRIVATE_PROXY'); } });
  assert.throws(() => prepareCloudProstheticCommand(proxy), error => code('invalid')(error) && !String(error).includes('PRIVATE'));
});
test('patient money projection earmarks cash for the supplier from the confirmed linked session only', async () => {
  const h = harness(); await h.repo.commit(create()); await h.repo.commit(payment());
  const projection = projectCloudProstheticFinancials({ item: h.docs.get(path('labCases', OP)),
    session: h.docs.get(path('patientSessions', OP)), account: h.docs.get(path('patientAccounts', PATIENT)) });
  assert.equal(projection.reservedForLabCents, 40_000); assert.equal(projection.availableToClinicCents, 0);
  assert.equal(projection.labRemainingCents, 50_000); assert.equal(projection.patientRemainingCents, 260_000);
  assert.throws(() => projectCloudProstheticFinancials({ item: h.docs.get(path('labCases', OP)),
    session: { ...h.docs.get(path('patientSessions', OP)), patientId: LAB }, account: h.docs.get(path('patientAccounts', PATIENT)) }), code('invalid'));
});
test('malformed adapter acknowledgement is never published as a confirmed operation', async () => {
  const h = harness(), original = h.adapter.runTransaction;
  const command = prepareCloudProstheticCommand(create()); await h.journal.prepare('prosthetic', command, WHEN);
  h.adapter.runTransaction = async work => { const result = await original(work); return { ...result as object, labRevision: 999 } as any; };
  await assert.rejects(h.core.commit(command), code('invalid'));
  assert.equal(h.docs.get(path('patientAccounts', PATIENT)).totalCents, 310_000);
  assert.throws(() => parseCloudProstheticCommit({ status: 'committed' }, command), code('invalid'));
});
test('lab summary reads beyond the first page and reconciles the complete account instead of summing one screen', async () => {
  const h = harness();
  for (let index = 1; index <= 51; index++) {
    await h.repo.commit(create({ operationId: `20000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      expectedPatientRevision: index - 1, expectedLabAccountRevision: index - 1, units: 1, teethIds: [], paidCents: 0, includeExamination: false }));
  }
  h.calls.length = 0; const summary = await h.repo.getLabSummary({ labId: LAB, month: '2026-10' });
  assert.equal(summary?.cases.length, 51); assert.equal(summary?.totalCostCents, 1_020_000); assert.equal(summary?.remainingCents, 1_020_000);
  assert.equal(h.calls.filter(call => call.startsWith('cases:')).length, 2);
});
test('history above the declared complete-summary cap fails explicitly instead of dropping financial rows', async () => {
  const h = harness(); await h.repo.commit(create()); const sample = h.docs.get(path('labCases', OP));
  for (let index = 2; index <= 2001; index++) {
    const id = `20000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
    h.docs.set(path('labCases', id), { ...structuredClone(sample), recordId: id, sessionId: id, lastOperationId: id });
  }
  const account = h.docs.get(path('labAccounts')); account.revision = 2001; account.caseCount = 2001; account.totalCostCents = 60_000 * 2001;
  await assert.rejects(h.repo.getLabSummary({ labId: LAB, month: '2026-10' }), code('unavailable'));
});
test('equal total cannot disguise a different service, tooth board, date or immutable patient-price snapshot', async () => {
  for (const mutate of [
    (item: any) => item.snapshot.serviceId = MATERIAL,
    (item: any) => item.snapshot.teethIds = ['ul4', 'ul5', 'ul6'],
    (item: any) => item.snapshot.date = '2026-10-13',
    (item: any) => { item.snapshot.examinationCents = 40_000; item.snapshot.patientUnitPriceCents = 90_000; },
  ]) {
    const h = harness(); await h.repo.commit(create()); mutate(h.docs.get(path('labCases', OP)));
    await assert.rejects(h.repo.getCase(OP), code('invalid'));
  }
});
