import test from 'node:test';
import assert from 'node:assert/strict';
import { invoiceFinancialDraft } from './invoiceFinancialDraft';

test('an unknown invoice does not invent totals, discounts or payment', () => {
  assert.deepEqual(invoiceFinancialDraft({}), { subtotal: '', discount: '', tax: '', totalAmount: '', paidAmount: '', remainingAmount: '' });
  assert.deepEqual(invoiceFinancialDraft({ totalAmount: 500 }), { subtotal: '', discount: '', tax: '', totalAmount: 500, paidAmount: '', remainingAmount: '' });
});

test('a payment method label is not evidence of paid money', () => {
  const value = { totalAmount: 500, paymentMethod: 'cash' };
  assert.equal(invoiceFinancialDraft(value).paidAmount, '');
});

test('explicit zero paid and zero remaining are preserved, not replaced through truthiness', () => {
  assert.deepEqual(invoiceFinancialDraft({ totalAmount: 500, paidAmount: 0 }), {
    subtotal: '', discount: '', tax: '', totalAmount: 500, paidAmount: 0, remainingAmount: 500 });
  assert.equal(invoiceFinancialDraft({ totalAmount: 500, remainingAmount: 0 }).paidAmount, 500);
  assert.equal(invoiceFinancialDraft({ totalAmount: 0, paidAmount: 0 }).remainingAmount, 0);
});

test('only an explicit total and remaining balance can derive a missing paid amount', () => {
  assert.equal(invoiceFinancialDraft({ totalAmount: 500, remainingAmount: 400 }).paidAmount, 100);
  assert.equal(invoiceFinancialDraft({ remainingAmount: 400 }).paidAmount, '');
  assert.equal(invoiceFinancialDraft({ paidAmount: 100 }).totalAmount, '');
});

test('financial reconciliation uses integer piastres instead of float equality', () => {
  assert.equal(invoiceFinancialDraft({ totalAmount: .3, paidAmount: .1, remainingAmount: .2 }).remainingAmount, .2);
  assert.equal(invoiceFinancialDraft({ totalAmount: 10.23, remainingAmount: 10.21 }).paidAmount, .02);
});

test('a conflicting extracted payment ledger is rejected rather than clamped or silently overwritten', () => {
  for (const value of [{ totalAmount: 500, paidAmount: 501 }, { totalAmount: 500, remainingAmount: 501 },
    { totalAmount: 500, paidAmount: 100, remainingAmount: 300 }]) {
    assert.throws(() => invoiceFinancialDraft(value), /غير متوافقة/);
  }
});

test('invalid, negative, overprecision, unsafe and wrongly typed extracted amounts are rejected', () => {
  for (const field of ['subtotal', 'discount', 'tax', 'totalAmount', 'paidAmount', 'remainingAmount']) {
    for (const value of [-1, NaN, Infinity, '500', null, .001, 10_000_000_001]) {
      assert.throws(() => invoiceFinancialDraft({ [field]: value } as any), /غير متوافقة/);
    }
  }
});

test('the source extraction object is never rewritten to fill missing amounts', () => {
  const input = Object.freeze({ totalAmount: 500, paidAmount: 100 });
  const result = invoiceFinancialDraft(input); result.paidAmount = 200;
  assert.deepEqual(input, { totalAmount: 500, paidAmount: 100 });
});
