import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInvoiceExtraction } from './invoiceExtraction';

const fixture = () => ({ supplierName: ' مورد مصطنع ', invoiceDate: '2026-10-12', totalAmount: 500,
  paidAmount: 100, remainingAmount: 400, paymentMethod: 'cash', category: 'supplies',
  lineItems: [{ itemName: 'خامة اختبار', quantity: 5, unitPrice: 100, total: 500, confidence: 90 }] });

test('valid OCR suggestions are detached and bounded, not persisted', () => {
  const input = fixture(), result = parseInvoiceExtraction(input);
  assert.equal(result.supplierName, 'مورد مصطنع');
  result.lineItems![0].itemName = 'تعديل'; assert.equal(input.lineItems[0].itemName, 'خامة اختبار');
});
test('missing amounts remain absent, including on a cash-labeled invoice', () => {
  assert.deepEqual(parseInvoiceExtraction({}), {});
  assert.deepEqual(parseInvoiceExtraction({ totalAmount: 500, paymentMethod: 'cash' }), { totalAmount: 500, paymentMethod: 'cash' });
});
test('invalid top-level values and field names never enter the editor', () => {
  for (const input of [null, [], 'فاتورة', { supplierName: {} }, { supplierName: 500 },
    { notes: 'a'.repeat(4001) }, { supplierPhone: '\u0000' }, { unknown: true }, JSON.parse('{"__proto__":{}}')]) {
    assert.throws(() => parseInvoiceExtraction(input));
  }
});
test('getters are not executed while validating a suggestion', () => {
  let calls = 0; const input = Object.defineProperty({}, 'totalAmount', { enumerable: true, get() { calls++; return 500; } });
  assert.throws(() => parseInvoiceExtraction(input)); assert.equal(calls, 0);
});
test('wrong enums, invalid dates and times are rejected', () => {
  for (const input of [{ category: 'invalid' }, { paymentMethod: 'paid' }, { invoiceDate: '2026-02-30' }, { invoiceTime: '25:00' }]) {
    assert.throws(() => parseInvoiceExtraction(input));
  }
});
test('nonfinite, negative, wrongly typed and conflicting payment amounts are rejected', () => {
  for (const input of [{ totalAmount: '500' }, { totalAmount: null }, { totalAmount: NaN }, { paidAmount: -1 },
    { tax: .001 }, { totalAmount: 500, paidAmount: 100, remainingAmount: 300 }]) assert.throws(() => parseInvoiceExtraction(input));
});
test('invalid line-item shape, names, quantities, money and confidence are rejected instead of defaulted to zero', () => {
  for (const changes of [{ itemName: '' }, { itemName: {} }, { quantity: 0 }, { quantity: '5' }, { unitPrice: -1 },
    { unitPrice: undefined }, { total: NaN }, { confidence: 101 }, { discount: -.01 }, { notes: {} }]) {
    const input = fixture(); Object.assign(input.lineItems[0], changes);
    assert.throws(() => parseInvoiceExtraction(input));
  }
  assert.throws(() => parseInvoiceExtraction({ lineItems: {} }));
  assert.throws(() => parseInvoiceExtraction({ lineItems: Array(201).fill(fixture().lineItems[0]) }));
  assert.throws(() => parseInvoiceExtraction({ lineItems: new Array(2) }));
});
test('confidence metadata is a bounded ordinary numeric record', () => {
  assert.deepEqual(parseInvoiceExtraction({ fieldConfidence: { totalAmount: 90 } }), { fieldConfidence: { totalAmount: 90 } });
  for (const fieldConfidence of [null, [], { totalAmount: '90' }, { totalAmount: Infinity }, JSON.parse('{"constructor":1}')]) {
    assert.throws(() => parseInvoiceExtraction({ fieldConfidence }));
  }
});

test('sparse or accessor line items cannot hide a row or execute getters', () => {
  const sparse: unknown[] & { extra?: unknown } = new Array(1); sparse.extra = fixture().lineItems[0];
  assert.throws(() => parseInvoiceExtraction({ lineItems: sparse }));
  let calls = 0;
  const items = Object.defineProperty(new Array(1), '0', { enumerable: true, get() { calls++; return fixture().lineItems[0]; } });
  assert.throws(() => parseInvoiceExtraction({ lineItems: items })); assert.equal(calls, 0);
});
