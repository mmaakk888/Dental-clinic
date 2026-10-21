import test from 'node:test';
import assert from 'node:assert/strict';
import { Expense } from '../types';
import { assertUniqueSupplierInvoice, expenseBreakdown, expensesForMonth, getExpensePaymentSummary, inferExpenseType, isExpenseInvoiceTotalLocked, mergeExpenseUpdate, prepareBasicExpenseUpdate } from './expenseUtils';

const expense = (id: string, title: string, category: Expense['category'], amount: number, date: string): Expense => ({ id, title, category, amount, date });

test('basic expense edits preserve supplier, invoice items and payment metadata', () => {
  const original: Expense = {
    ...expense('invoice-1', 'خامات', 'supplies', 500, '2026-09-01'),
    supplierName: 'المورد', invoiceNumber: 'INV-42', paidAmount: 200, remainingAmount: 300,
    items: [{ id: 'item-1', itemName: 'قفازات', quantity: 5, unit: 'علبة', unitPrice: 100, total: 500 }],
    invoiceImageUrl: 'image',
  };
  const updated = mergeExpenseUpdate(original, { title: 'خامات سبتمبر', note: 'تمت المراجعة' });
  assert.equal(updated.supplierName, original.supplierName);
  assert.equal(updated.invoiceNumber, original.invoiceNumber);
  assert.deepEqual(updated.items, original.items);
  assert.equal(updated.paidAmount, 200);
  assert.equal(updated.remainingAmount, 300);
  assert.equal(updated.title, 'خامات سبتمبر');
  assert.equal(original.title, 'خامات');
  assert.equal(mergeExpenseUpdate(original, { invoiceImageUrl: undefined }).invoiceImageUrl, undefined);
  assert.equal(mergeExpenseUpdate(original, { id: 'different' }).id, original.id);
});

test('classifies legacy operating expenses without changing stored records', () => {
  assert.equal(inferExpenseType(expense('1', 'إيجار العيادة', 'fixed', 1, '2026-09-01')), 'rent');
  assert.equal(inferExpenseType(expense('2', 'مرتب السكرتيرة', 'fixed', 1, '2026-09-01')), 'salary');
  assert.equal(inferExpenseType(expense('3', 'فاتورة كهرباء', 'fixed', 1, '2026-09-01')), 'electricity');
  assert.equal(inferExpenseType(expense('4', 'فاتورة مياه', 'fixed', 1, '2026-09-01')), 'water');
});

test('filters by invoice month and totals each expense once', () => {
  const rows = [
    expense('1', 'خامات', 'supplies', 500, '2026-09-01'),
    { ...expense('2', 'إيجار', 'fixed', 2000, '2026-08-01'), invoiceDate: '2026-09-03' }
  ];
  const september = expensesForMonth(rows, '2026-09');
  assert.equal(september.length, 2);
  assert.deepEqual(expenseBreakdown(september), { rent: 2000, electricity: 0, water: 0, salary: 0, supplies: 500, maintenance: 0, other: 0 });
});

test('invoice payments distinguish paid cash from outstanding liabilities', () => {
  assert.deepEqual(getExpensePaymentSummary({ amount: 500, paidAmount: 200, remainingAmount: 123 }), { total: 500, paid: 200, remaining: 300 });
  assert.deepEqual(getExpensePaymentSummary({ amount: 500, paidAmount: 0 }), { total: 500, paid: 0, remaining: 500 });
  assert.deepEqual(getExpensePaymentSummary({ amount: 500, remainingAmount: 300 }), { total: 500, paid: 200, remaining: 300 });
  assert.deepEqual(getExpensePaymentSummary({ amount: 500, paymentMethod: 'deferred' }), { total: 500, paid: 0, remaining: 500 });
  assert.deepEqual(getExpensePaymentSummary({ amount: 500, paymentMethod: 'cash' }), { total: 500, paid: 500, remaining: 0 });
  assert.deepEqual(getExpensePaymentSummary({ amount: 500 }), { total: 500, paid: 500, remaining: 0 });
});

test('invoice payment summaries clamp invalid or excessive amounts', () => {
  assert.deepEqual(getExpensePaymentSummary({ amount: 500, paidAmount: 700 }), { total: 500, paid: 500, remaining: 0 });
  assert.deepEqual(getExpensePaymentSummary({ amount: 500, paidAmount: NaN }), { total: 500, paid: 0, remaining: 500 });
  assert.deepEqual(getExpensePaymentSummary({ amount: 500, remainingAmount: 700 }), { total: 500, paid: 0, remaining: 500 });
  assert.deepEqual(getExpensePaymentSummary({ amount: Infinity, paidAmount: 10 }), { total: 0, paid: 0, remaining: 0 });
});

test('fresh invoice validation rejects repeated supplier invoices including fallback supplier names', () => {
  const first = { ...expense('first', 'مورد خامات', 'supplies', 100, '2026-10-07'), supplierName: 'مورد خامات', invoiceNumber: 'INV-7' };
  const current = [first];
  const snapshot = structuredClone(current);
  assert.throws(() => assertUniqueSupplierInvoice(current, { ...first, id: 'second' }), /مسجّل/);
  assert.throws(() => assertUniqueSupplierInvoice(current, { ...first, id: undefined, supplierName: undefined }), /مسجّل/);
  assert.throws(() => assertUniqueSupplierInvoice(current, { ...first, id: 'second', supplierName: ' مورد   خامات ', invoiceNumber: ' inv-7 ' }), /مسجّل/);
  assert.deepEqual(current, snapshot);
  assert.doesNotThrow(() => assertUniqueSupplierInvoice(current, first));
  assert.doesNotThrow(() => assertUniqueSupplierInvoice(current, { ...first, id: 'second', supplierName: 'مورد آخر' }));
  assert.doesNotThrow(() => assertUniqueSupplierInvoice(current, { ...first, id: 'second', invoiceNumber: 'INV-8' }));
});

test('ordinary repeated expenses without invoice numbers remain valid and invoice edits use merged metadata', () => {
  const first = { ...expense('first', 'إيجار', 'fixed', 100, '2026-10-07'), invoiceNumber: '  ' };
  assert.doesNotThrow(() => assertUniqueSupplierInvoice([first], { ...first, id: 'next' }));
  const invoice = { ...first, supplierName: 'مورد', invoiceNumber: '001' };
  assert.doesNotThrow(() => assertUniqueSupplierInvoice([invoice], { ...invoice, id: 'next', invoiceNumber: '1' }));
  assert.doesNotThrow(() => assertUniqueSupplierInvoice([invoice], mergeExpenseUpdate(invoice, { title: 'عنوان جديد' })));
  const next = { ...invoice, id: 'next', invoiceNumber: '002' };
  assert.throws(() => assertUniqueSupplierInvoice([invoice, next], mergeExpenseUpdate(next, { invoiceNumber: '001' })), /مسجّل/);
});

test('basic expense save preserves the fresh supplier ledger and ignores hidden stale fields', () => {
  const baseline: Expense = { ...expense('invoice', 'خامات', 'supplies', 500, '2026-10-10'), paidAmount: 100,
    items: [{ id: 'old-item', itemName: 'خامة', quantity: 5, unit: 'قطعة', unitPrice: 100, total: 500 }] };
  const current: Expense = { ...baseline, paidAmount: 300, remainingAmount: 200,
    supplierName: 'المورد الجديد', items: [{ ...baseline.items![0], id: 'fresh-item' }],
    extraInvoiceField: 'retain' } as Expense;
  const snapshot = structuredClone(current);
  const result = prepareBasicExpenseUpdate(current, { ...baseline, title: 'خامات العيادة', note: 'مراجعة' }, baseline);
  assert.equal(result.title, 'خامات العيادة');
  assert.equal(result.note, 'مراجعة');
  assert.equal(result.paidAmount, 300); assert.equal(result.remainingAmount, 200);
  assert.equal(result.supplierName, current.supplierName); assert.deepEqual(result.items, current.items);
  assert.equal((result as Expense & { extraInvoiceField: string }).extraInvoiceField, 'retain');
  assert.deepEqual(current, snapshot);
});

test('basic expense save refuses a missing/mismatched baseline and stale editable fields', () => {
  const baseline = expense('expense', 'إيجار', 'fixed', 500, '2026-10-10');
  assert.throws(() => prepareBasicExpenseUpdate(baseline, baseline), /أعد فتح/);
  assert.throws(() => prepareBasicExpenseUpdate(baseline, baseline, { ...baseline, id: 'other' }), /أعد فتح/);
  assert.throws(() => prepareBasicExpenseUpdate(baseline, { ...baseline, id: 'other' }, baseline), /أعد فتح/);
  for (const changes of [{ title: 'عنوان أحدث' }, { amount: 600 }, { category: 'other' as const },
    { note: 'ملاحظة أحدث' }, { invoiceImageUrl: 'new-image' }]) {
    const current = { ...baseline, ...changes };
    assert.throws(() => prepareBasicExpenseUpdate(current, { ...baseline, note: 'مسودة' }, baseline), /تغيّرت/);
  }
});

test('basic expense save enforces the invoice total lock against fresh data, not just the old form', () => {
  const baseline = expense('invoice', 'فاتورة', 'supplies', 500, '2026-10-10');
  for (const details of [{ items: [{ id: 'item', itemName: 'خامة', quantity: 5, unit: 'قطعة', unitPrice: 100, total: 500 }] },
    { paidAmount: 100 }, { remainingAmount: 400 }, { subtotal: 500 }, { tax: 0 }, { discount: 0 },
    { paymentMethod: 'credit' as const }, { paymentMethod: 'deferred' as const }]) {
    const current = { ...baseline, ...details };
    assert.equal(isExpenseInvoiceTotalLocked(current), true);
    assert.throws(() => prepareBasicExpenseUpdate(current, { ...baseline, amount: 600 }, baseline), /إجمالي الفاتورة/);
    assert.equal(prepareBasicExpenseUpdate(current, { ...baseline, note: 'بيان' }, baseline).amount, 500);
  }
  assert.equal(isExpenseInvoiceTotalLocked(baseline), false);
  assert.equal(prepareBasicExpenseUpdate(baseline, { ...baseline, amount: 600 }, baseline).amount, 600);
});
