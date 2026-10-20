import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import type { LabCase } from '../types';
import { Storage, type ClinicDomainData } from './storage';
import { allocateLabPayment, labMoneyCents } from './labFinancials';
import { getLabPaymentHistory } from './labPaymentHistory';
import { localDateISO } from '../components/appointments/appointmentScheduling';

// Actual App callbacks and confirmed persistence, isolated invented records.
// This does not hydrate App, access a browser or read/write clinic storage.
const source = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = new Map<string, ts.Expression>();
const visit = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) declarations.set(node.name.text, node.initializer); ts.forEachChild(node, visit); }; visit(ast);
function callback(name: string, deps: Record<string, unknown>) {
  const expression = declarations.get(name); assert.ok(expression);
  const code = ts.transpileModule(`return (${expression.getText(ast)});`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return new Function('runtime', 'portable', ...Object.keys(deps), code)(undefined, null, ...Object.values(deps));
}
const item = (changes: Partial<LabCase> = {}): LabCase => ({ id: 'synthetic-case', patientId: '501', fileNo: '501', patientName: 'مريض اختبار', labId: 'synthetic-lab', labName: 'معمل اختبار', type: 'ثابت', subType: 'زيركون', unitLabel: 'وحدة', units: 1, labTotal: 1000, labPaid: 600, patientTotal: 5000, patientPaid: 4000, date: '2026-10-01', status: 'pending', ...changes });
async function withHarness(run: (h: ReturnType<typeof harness>) => Promise<void>) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try { await run(harness()); } finally { if (original) Object.defineProperty(globalThis, 'localStorage', original); else Reflect.deleteProperty(globalThis, 'localStorage'); }
}
function harness() {
  const keys: Record<keyof ClinicDomainData, string> = { patients: 'dental_patients_v2', contacts: 'dental_contacts', appointments: 'dental_appointments_v2', labCases: 'dental_lab_cases_v2', expenses: 'dental_expenses_v2', materialUsages: 'dental_material_usages_v1' };
  const values = new Map<string, string>(); const events: string[] = [], actions: string[] = [];
  for (const [field, key] of Object.entries(keys)) values.set(key, JSON.stringify(field === 'labCases' ? [item()] : []));
  let locked = false, queue = Promise.resolve(), beforeLock: (() => void) | undefined, failWrite = false, denied = '';
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { events.push(`write:${key}`); if (failWrite && key === keys.labCases) { failWrite = false; throw new Error('synthetic-quota'); } values.set(key, value); },
    removeItem: (key: string) => values.delete(key),
  } });
  const deps: Record<string, unknown> = {
    Storage: { ...Storage, getDomainData: () => { assert.equal(locked, true); events.push('read'); return Storage.getDomainData(); }, saveDomainDataConfirmed: (next: ClinicDomainData, previous: ClinicDomainData) => { assert.equal(locked, true); Storage.saveDomainDataConfirmed(next, previous); events.push('confirmed'); } },
    currentUser: { id: 'synthetic-owner' }, labMoneyCents, allocateLabPayment, localDateISO,
    publishDomain: () => events.push('publish'),
    requireFreshSettingsPermission: (action: string) => { assert.equal(locked, true); actions.push(action); if (action === denied) throw new Error('synthetic-revoked'); },
    withClinicWriteLock: (operation: () => unknown) => {
      const result = queue.then(() => { const before = beforeLock; beforeLock = undefined; before?.(); locked = true; events.push('lock'); try { return operation(); } finally { locked = false; } });
      queue = result.then(() => undefined, () => undefined); return result;
    },
  };
  deps.commitDomain = callback('commitDomain', deps);
  return { pay: callback('handleAddLabCasePayment', deps), bulk: callback('handleLabBulkPayment', deps),
    current: () => Storage.getDomainData(), snapshot: () => new Map(values), events, actions,
    seedCases: (cases: LabCase[]) => values.set(keys.labCases, JSON.stringify(cases)),
    beforeLock: (before: () => void) => { beforeLock = before; }, failNext: () => { failWrite = true; }, deny: (action: string) => { denied = action; },
  };
}

test('actual case payment records dated supplier cash and cumulative total without touching patient balances', async () => withHarness(async h => {
  const before = h.current(); await h.pay('synthetic-case', 125);
  const after = h.current(), paidCase = after.labCases[0]; assert.equal(paidCase.labPaid, 725);
  assert.equal(paidCase.patientPaid, before.labCases[0].patientPaid); assert.equal(paidCase.patientTotal, 5000);
  assert.deepEqual(after.patients, before.patients); assert.deepEqual(after.expenses, before.expenses);
  assert.equal(paidCase.paymentsLog?.length, 1); const receipt = paidCase.paymentsLog![0];
  assert.equal(receipt.amount, 125); assert.equal(receipt.date, localDateISO()); assert.equal(receipt.recordedBy, 'synthetic-owner'); assert.ok(receipt.createdAt);
  assert.deepEqual(h.actions, ['manage_lab', 'view_lab_costs']); assert.ok(h.events.indexOf('confirmed') < h.events.indexOf('publish'));
}));

test('actual payment checks current locked case, rejects stale overpayment and unknown case with no writes', async () => withHarness(async h => {
  h.beforeLock(() => h.seedCases([item({ labPaid: 950 })]));
  await assert.rejects(h.pay('synthetic-case', 100), /أكبر/); assert.equal(h.current().labCases[0].labPaid, 950);
  assert.equal(h.events.some(event => event.startsWith('write:')), false);
  await assert.rejects(h.pay('missing', 10), /لم تعد موجودة/); assert.equal(h.current().labCases[0].paymentsLog, undefined);
}));

test('concurrent case payments cannot overpay the current supplier balance', async () => withHarness(async h => {
  const results = await Promise.allSettled([h.pay('synthetic-case', 350), h.pay('synthetic-case', 350)]);
  assert.deepEqual(results.map(result => result.status), ['fulfilled', 'rejected']);
  assert.equal(h.current().labCases[0].labPaid, 950); assert.equal(h.current().labCases[0].paymentsLog?.length, 1);
}));

test('case payment exact-cent boundary accepts full fractional remainder but rejects sub-cent/unsafe values before writing', async () => withHarness(async h => {
  h.seedCases([item({ labTotal: 0.3, labPaid: 0.1 })]);
  for (const amount of [0, -1, NaN, Infinity, 0.001, 0.201, Number.MAX_SAFE_INTEGER]) assert.throws(() => h.pay('synthetic-case', amount));
  await h.pay('synthetic-case', 0.2); assert.equal(h.current().labCases[0].labPaid, 0.3);
  assert.equal(h.current().labCases[0].paymentsLog![0].amount, 0.2);
  await assert.rejects(h.pay('synthetic-case', 0.01), /أكبر/);
}));

test('actual bulk payment remains one dated receipt with per-case allocations and no duplicated whole amount', async () => withHarness(async h => {
  h.seedCases([item({ id: 'a', labPaid: 0, labTotal: 0.1 }), item({ id: 'b', labPaid: 0, labTotal: 0.2 }), item({ id: 'other', labId: 'other', labTotal: 999 })]);
  await h.bulk('synthetic-lab', 0.3);
  const cases = h.current().labCases;
  assert.equal(cases[0].labPaid, 0.1); assert.equal(cases[1].labPaid, 0.2); assert.equal(cases[2].labPaid, 600);
  assert.equal(cases[0].paymentsLog![0].id, cases[1].paymentsLog![0].id);
  assert.equal(cases[0].paymentsLog![0].date, localDateISO());
  assert.equal(cases[0].paymentsLog![0].amount, 0.1); assert.equal(cases[1].paymentsLog![0].amount, 0.2);
  assert.equal(getLabPaymentHistory(cases.slice(0, 2), localDateISO().slice(0, 7)).monthPaid, 0.3);
}));

test('bulk allocation rechecks newest balances under lock and rejects excess/sub-cent without partial writes', async () => withHarness(async h => {
  h.beforeLock(() => h.seedCases([item({ labPaid: 990 })]));
  await assert.rejects(h.bulk('synthetic-lab', 50), /أكبر/); assert.equal(h.current().labCases[0].labPaid, 990);
  await assert.rejects(h.bulk('synthetic-lab', 1.001), /منزلتين/);
  assert.equal(h.events.some(event => event.startsWith('write:')), false);
}));

test('revoked supplier-cost permission at execution blocks payment and bulk with no financial publication', async () => withHarness(async h => {
  const before = h.snapshot(); h.deny('view_lab_costs');
  await assert.rejects(h.pay('synthetic-case', 10), /revoked/); await assert.rejects(h.bulk('synthetic-lab', 10), /revoked/);
  assert.deepEqual(h.snapshot(), before); assert.equal(h.events.includes('publish'), false);
}));

test('confirmed supplier write failure rolls back and does not publish paid amount or false receipt', async () => withHarness(async h => {
  const before = h.snapshot(); h.failNext(); await assert.rejects(h.pay('synthetic-case', 50));
  assert.deepEqual(h.snapshot(), before); assert.equal(h.events.includes('publish'), false);
  h.failNext(); await assert.rejects(h.bulk('synthetic-lab', 50)); assert.deepEqual(h.snapshot(), before);
}));
