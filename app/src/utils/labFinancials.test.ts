import test from 'node:test';
import assert from 'node:assert/strict';
import { LabCase, Patient } from '../types';
import { allocateLabPayment, getLabCaseFinancials, labMoneyCents } from './labFinancials';

const item = { id: 'c1', labId: 'lab', patientId: 'p', linkedSessionId: 's', labTotal: 750, labPaid: 0, date: '2026-09-20', status: 'pending' } as LabCase;
const patients = [{ id: 'p', sessions: [{ id: 's', paid: 1000, paymentsLog: [{ id: 'r', amount: 500, date: '2026-09-20' }] }] }] as Patient[];

test('reserves actual receipts up to cost and releases paid lab amounts', () => {
  assert.equal(getLabCaseFinancials(item, patients).reserved, 500);
  assert.equal(getLabCaseFinancials({ ...item, labPaid: 200 }, patients).reserved, 300);
  assert.equal(getLabCaseFinancials({ ...item, labTotal: 300 }, patients).availableToClinic, 200);
});
test('private lab balances and linked patient totals retain exact cent values without changing history', () => {
  const record = { ...item, labTotal: 0.3, labPaid: 0.1 };
  const records = [{ id: 'p', sessions: [{ id: 's', amount: 0.8, discount: 0.1, paid: 0.3,
    paymentsLog: [{ id: 'cent-receipt', amount: 0.3, date: '2026-09-20' }] }], payments: [] }] as Patient[];
  const before = structuredClone({ record, records }), result = getLabCaseFinancials(record, records);
  assert.equal(result.patientTotal, 0.7);
  assert.equal(result.patientFileRemaining, 0.4);
  assert.equal(result.reserved, 0.2);
  assert.equal(result.remaining, 0.2);
  assert.deepEqual({ record, records }, before);
});
test('unlinked cases cannot reserve unrelated patient receipts', () => {
  assert.equal(getLabCaseFinancials({ ...item, linkedSessionId: undefined }, patients).reserved, 0);
});

test('general file payments settle whole-file debt but are not fabricated as linked-service/lab-reserved receipts', () => {
  const records = [{ id: 'p', sessions: [{ id: 's', amount: 1000, paid: 200, paymentsLog: [{ id: 'session-receipt', amount: 200, date: '2026-10-10' }] }], payments: [{ id: 'general-receipt', amount: 800, date: '2026-10-10', createdAt: '2026-10-10T12:00:00Z' }] }] as Patient[];
  const before = structuredClone(records), result = getLabCaseFinancials(item, records);
  assert.equal(result.patientFileRemaining, 0); assert.equal(result.patientTotal, 1000);
  assert.equal(result.collected, 200); assert.equal(result.reserved, 200); assert.deepEqual(records, before);
});
test('fully voided receipts never fall back to stale paid total', () => {
  const voided = [{ id: 'p', sessions: [{ id: 's', paid: 500, paymentsLog: [{ id: 'r', amount: 500, date: '2026-09-20', voidedAt: '2026-09-21' }] }] }] as Patient[];
  assert.equal(getLabCaseFinancials(item, voided).reserved, 0);
});
test('bulk payment splits oldest first and only for the selected lab', () => {
  const cases = [{ ...item, id: 'new', date: '2026-09-22' }, { ...item, id: 'other', labId: 'other' }, item];
  assert.deepEqual(allocateLabPayment(cases, 'lab', 900), [{ caseId: 'c1', amount: 750 }, { caseId: 'new', amount: 150 }]);
  assert.throws(() => allocateLabPayment(cases, 'lab', 1501));
  assert.throws(() => allocateLabPayment(cases, 'lab', NaN));
  assert.equal(item.status, 'pending');
});

test('bulk supplier payments use exact cents and never create residue-only receipts', () => {
  const cases = [{ ...item, id: 'first', labTotal: 0.1, labPaid: 0 }, { ...item, id: 'second', labTotal: 0.2, labPaid: 0 }];
  assert.deepEqual(allocateLabPayment(cases, 'lab', 0.3), [{ caseId: 'first', amount: 0.1 }, { caseId: 'second', amount: 0.2 }]);
  assert.deepEqual(allocateLabPayment(cases, 'lab', 0.1 + 0.2), [{ caseId: 'first', amount: 0.1 }, { caseId: 'second', amount: 0.2 }]);
  assert.deepEqual(allocateLabPayment([{ ...item, labTotal: 0.3, labPaid: 0.1 }], 'lab', 0.2), [{ caseId: 'c1', amount: 0.2 }]);
  assert.throws(() => allocateLabPayment(cases, 'lab', 0.31));
});

test('supplier writes reject negative, unsafe and sub-cent amounts instead of silently rounding', () => {
  for (const value of [-1, NaN, Infinity, 0.001, 1.001, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => labMoneyCents(value)); assert.throws(() => allocateLabPayment([item], 'lab', value));
  }
  assert.equal(labMoneyCents(0), 0); assert.equal(labMoneyCents(0.1 + 0.2), 30);
  assert.throws(() => allocateLabPayment([{ ...item, labTotal: 100.001 }], 'lab', 10));
  assert.throws(() => allocateLabPayment([{ ...item, labPaid: NaN }], 'lab', 10));
});
