import test from 'node:test';
import assert from 'node:assert/strict';
import type { LabCase, PaymentInstallment } from '../types';
import { getLabPaymentHistory, isLabPaymentDate } from './labPaymentHistory';

const receipt = (id: string, amount: number, date = '2026-10-10', changes: Partial<PaymentInstallment> = {}): PaymentInstallment => ({ id, amount, date, ...changes });
const item = (changes: Partial<LabCase> = {}): LabCase => ({ id: 'synthetic-case', labId: 'synthetic-lab', labName: 'معمل اختبار', patientId: '501', fileNo: '501', patientName: 'مريض اختبار', type: 'ثابت', subType: 'زيركون', units: 1, unitLabel: 'وحدة', labTotal: 1000, labPaid: 0, patientTotal: 9000, patientPaid: 8000, date: '2026-09-01', status: 'pending', ...changes });

test('supplier history uses actual lab receipts, with cumulative and month totals, not patient paid/reserved snapshots', () => {
  const cases = [item({ labPaid: 650, paymentsLog: [receipt('old', 250, '2026-09-30'), receipt('month', 400)] })];
  const before = structuredClone(cases), result = getLabPaymentHistory(cases, '2026-10');
  assert.equal(result.totalPaid, 650); assert.equal(result.monthPaid, 400); assert.equal(result.remaining, 350);
  assert.equal(result.activeReceiptsTotal, 650); assert.equal(result.unknownDateAmount, 0);
  assert.deepEqual(result.entries.map(entry => entry.receipt.id), ['month', 'old']); assert.deepEqual(cases, before);
});

test('legacy aggregate-only payments are visible but never fabricated as dated receipts', () => {
  const result = getLabPaymentHistory([item({ labPaid: 700, paymentsLog: [receipt('new', 200)] })], '2026-10');
  assert.equal(result.totalPaid, 700); assert.equal(result.monthPaid, 200);
  assert.equal(result.unloggedAmount, 500); assert.equal(result.unknownDateAmount, 500); assert.equal(result.entries.length, 1);
  const old = getLabPaymentHistory([item({ labPaid: 700 })], '2026-10'); assert.equal(old.monthPaid, 0); assert.deepEqual(old.entries, []);
});

test('cancelled supplier receipts stay in audit history but never enter active/month sums', () => {
  const result = getLabPaymentHistory([item({ labPaid: 200, paymentsLog: [receipt('active', 200), receipt('cancelled', 500, '2026-10-10', { voidedAt: '2026-10-11T12:00:00Z', voidReason: 'اختبار' })] })], '2026-10');
  assert.equal(result.totalPaid, 200); assert.equal(result.monthPaid, 200); assert.equal(result.activeReceiptsTotal, 200);
  assert.equal(result.entries.length, 2); assert.equal(result.unknownDateAmount, 0);
});

test('one bulk receipt ID is legitimately allocated to several cases and is not deduplicated across cases', () => {
  const cases = [item({ labPaid: 300, paymentsLog: [receipt('one-bulk', 300)] }), item({ id: 'other-case', labPaid: 100, paymentsLog: [receipt('one-bulk', 100)] })];
  const result = getLabPaymentHistory(cases, '2026-10');
  assert.equal(result.totalPaid, 400); assert.equal(result.monthPaid, 400); assert.equal(result.entries.length, 2);
  assert.notEqual(result.entries[0].key, result.entries[1].key);
});

test('invalid/absent legacy dates remain visible but cannot enter a month; leap and year boundaries are exact', () => {
  for (const date of ['2026-02-29', '2026-13-01', '2026-10-32', '', '2026-10-01T00:00:00Z', '2026-1-01']) assert.equal(isLabPaymentDate(date), false);
  assert.equal(isLabPaymentDate('2024-02-29'), true);
  const result = getLabPaymentHistory([item({ labPaid: 400, paymentsLog: [receipt('invalid', 100, '2026-02-29'), receipt('other-year', 100, '2025-10-10'), receipt('dec', 100, '2026-12-31'), receipt('jan', 100, '2027-01-01')] })], '2027-01');
  assert.equal(result.monthPaid, 100); assert.equal(result.unknownDateAmount, 100);
  assert.equal(result.entries.at(-1)?.receipt.id, 'invalid');
  for (const month of ['', '2026-1', '2026-00', '2026-13']) assert.throws(() => getLabPaymentHistory([], month));
});

test('inconsistent totals are disclosed without changing records or pretending logs equal aggregate', () => {
  const result = getLabPaymentHistory([item({ labPaid: 100, paymentsLog: [receipt('more', 300), receipt('nan', NaN), receipt('negative', -1)] })], '2026-10');
  assert.equal(result.totalPaid, 100); assert.equal(result.monthPaid, 300); assert.equal(result.inconsistentCases, 1);
  assert.equal(result.invalidEntries, 2); assert.equal(result.entries.length, 1);
});

test('equal-date receipts use creation times then stable keys, and summaries have no floating residue', () => {
  const result = getLabPaymentHistory([item({ labPaid: 0.3, labTotal: 0.6, paymentsLog: [receipt('a', 0.1, '2026-10-10', { createdAt: '2026-10-10T10:00:00Z' }), receipt('b', 0.2, '2026-10-10', { createdAt: '2026-10-10T11:00:00Z' })] })], '2026-10');
  assert.equal(result.monthPaid, 0.3); assert.equal(result.remaining, 0.3); assert.equal(result.totalPaid, 0.3);
  assert.deepEqual(result.entries.map(entry => entry.receipt.id), ['b', 'a']);
});
