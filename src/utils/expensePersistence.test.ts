import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import type { Expense } from '../types';
import type { ClinicDomainData } from './storage';
import { assertUniqueSupplierInvoice, prepareBasicExpenseUpdate } from './expenseUtils';
import { isValidAppointmentDate } from '../components/appointments/appointmentScheduling';

// Extract actual callbacks without hydrating App or reading a browser/profile.
function callback(file: URL, name: string, dependencies: Record<string, unknown>): any {
  const source = readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression: ts.Expression | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) expression = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(ast); assert.ok(expression, `missing callback ${name}`);
  const code = ts.transpileModule(`return (${expression.getText(ast)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function(...Object.keys(dependencies), code)(...Object.values(dependencies));
}
const basic = (changes: Partial<Expense> = {}): Expense => ({
  id: 'synthetic-expense', title: 'مصروف اختبار', category: 'supplies', amount: 500, date: '2026-10-10', ...changes,
});
function appHarness(initial = basic()) {
  let domain: ClinicDomainData = { patients: [], contacts: [], appointments: [], labCases: [], expenses: [initial], materialUsages: [] };
  const events: string[] = []; let beforeLock = () => {}; let denied = false; let failWrite = false;
  const dependencies: Record<string, unknown> = {
    withClinicWriteLock: async (operation: () => unknown) => { beforeLock(); events.push('lock'); return operation(); },
    requireFreshSettingsPermission: () => { events.push('authorize'); if (denied) throw new Error('synthetic-denied'); },
    Storage: {
      getDomainData: () => { events.push('read'); return structuredClone(domain); },
      saveDomainDataConfirmed: (next: ClinicDomainData) => {
        events.push('save'); if (failWrite) throw new Error('synthetic-write-failure'); domain = structuredClone(next);
      },
      getPrivacyModeFresh: () => false,
    },
    publishDomain: () => { events.push('publish'); },
    prepareBasicExpenseUpdate, assertUniqueSupplierInvoice, isValidAppointmentDate,
  };
  const file = new URL('../App.tsx', import.meta.url);
  dependencies.commitDomain = callback(file, 'commitDomain', dependencies);
  return {
    save: callback(file, 'handleSaveExpense', dependencies) as (update: Expense, baseline?: Expense) => Promise<void>,
    current: () => structuredClone(domain), events,
    before: (action: () => void) => { beforeLock = action; },
    seed: (expense: Expense) => { domain = { ...domain, expenses: [expense] }; },
    deny: () => { denied = true; }, fail: () => { failWrite = true; },
  };
}

test('actual expense App save preserves payments/items updated while the basic form was open', async () => {
  const baseline = basic({ paidAmount: 100 }); const h = appHarness(baseline);
  const fresh = { ...baseline, paidAmount: 300, remainingAmount: 200,
    items: [{ id: 'fresh-item', itemName: 'خامة اختبار', quantity: 5, unit: 'قطعة', unitPrice: 100, total: 500 }] };
  h.before(() => h.seed(fresh));
  await h.save({ ...baseline, title: 'عنوان من النموذج', paidAmount: 100, items: [] }, baseline);
  const result = h.current().expenses[0];
  assert.equal(result.paidAmount, 300); assert.equal(result.remainingAmount, 200);
  assert.deepEqual(result.items, fresh.items); assert.equal(result.title, 'عنوان من النموذج');
  assert.deepEqual(h.events, ['lock', 'authorize', 'read', 'save', 'publish']);
});

test('actual expense App save rejects stale details, missing baseline and newly locked totals without writing', async () => {
  const baseline = basic();
  const stale = appHarness({ ...baseline, note: 'ملاحظة أحدث' });
  await assert.rejects(stale.save(baseline, baseline), /تغيّرت/);
  const noBaseline = appHarness(); await assert.rejects(noBaseline.save(baseline), /أعد فتح/);
  const locked = appHarness({ ...baseline, paidAmount: 100 });
  await assert.rejects(locked.save({ ...baseline, amount: 600 }, baseline), /إجمالي الفاتورة/);
  for (const h of [stale, noBaseline, locked]) assert.equal(h.events.includes('save'), false);
});

test('actual expense App save has no published success on revoked access or failed persistence', async () => {
  const baseline = basic(); const denied = appHarness(); denied.deny();
  await assert.rejects(denied.save(baseline, baseline), /synthetic-denied/);
  assert.equal(denied.events.includes('read'), false);
  const failed = appHarness(); failed.fail();
  await assert.rejects(failed.save({ ...baseline, note: 'تعديل' }, baseline), /synthetic-write-failure/);
  assert.equal(failed.current().expenses[0].note, undefined);
  for (const h of [denied, failed]) assert.equal(h.events.includes('publish'), false);
});

function formHarness(baseline: Expense | null, save: (...args: any[]) => unknown) {
  const calls: unknown[][] = []; const messages: string[] = []; let closes = 0;
  const dependencies = {
    canViewExpenses: true, saving: false, expenseTitle: 'عنوان من النموذج', expenseAmount: 500,
    expenseDate: '2026-10-10', isInvoiceTotalLocked: !!baseline, editingExpense: baseline,
    expenseCategory: 'supplies', expenseType: 'supplies', expenseNote: 'ملاحظة',
    isFixedExpense: false, expenseInvoiceImage: undefined,
    onSaveExpense: (...args: unknown[]) => { calls.push(args); return save(...args); },
    onAddExpense: () => { throw new Error('not the update path'); },
    showToast: (message: string) => { messages.push(message); },
    confirmSave: async (operation: () => unknown, success: () => void) => { await operation(); success(); },
    handleCloseExpenseModal: () => { closes++; },
  };
  return { submit: callback(new URL('../components/summary/SummaryView.tsx', import.meta.url), 'handleSaveExpenseForm', dependencies),
    calls, messages, closes: () => closes };
}

test('actual basic expense form sends visible fields plus its baseline, not a stale invoice ledger', async () => {
  const baseline = basic({ paidAmount: 100, remainingAmount: 400, supplierName: 'مورد اختبار', invoiceDate: '2026-10-09',
    items: [{ id: 'item', itemName: 'خامة', quantity: 5, unit: 'قطعة', unitPrice: 100, total: 500 }] });
  const h = formHarness(baseline, async () => {});
  await h.submit({ preventDefault() {} });
  assert.equal(h.calls.length, 1); const [payload, sentBaseline] = h.calls[0] as [Expense, Expense];
  assert.equal(sentBaseline, baseline); assert.equal(payload.invoiceDate, '2026-10-10');
  for (const field of ['items', 'paidAmount', 'remainingAmount', 'supplierName']) assert.equal(Object.hasOwn(payload, field), false);
  assert.equal(h.closes(), 1);
});

test('actual basic expense form retains its draft when persistence rejects', async () => {
  const h = formHarness(basic(), async () => { throw new Error('synthetic-write-failure'); });
  await assert.rejects(h.submit({ preventDefault() {} }), /synthetic-write-failure/);
  assert.equal(h.closes(), 0); assert.deepEqual(h.messages, []);
});
