import test from 'node:test';
import assert from 'node:assert/strict';
import { LabCase, Patient } from '../types';
import { allocateLabPayment, getLabCaseFinancials } from './labFinancials';

const item = { id: 'c1', labId: 'lab', patientId: 'p', linkedSessionId: 's', labTotal: 750, labPaid: 0, date: '2026-09-20', status: 'pending' } as LabCase;
const patients = [{ id: 'p', sessions: [{ id: 's', paid: 1000, paymentsLog: [{ id: 'r', amount: 500, date: '2026-09-20' }] }] }] as Patient[];

test('reserves actual receipts up to cost and releases paid lab amounts', () => {
  assert.equal(getLabCaseFinancials(item, patients).reserved, 500);
  assert.equal(getLabCaseFinancials({ ...item, labPaid: 200 }, patients).reserved, 300);
  assert.equal(getLabCaseFinancials({ ...item, labTotal: 300 }, patients).availableToClinic, 200);
});
test('unlinked cases cannot reserve unrelated patient receipts', () => {
  assert.equal(getLabCaseFinancials({ ...item, linkedSessionId: undefined }, patients).reserved, 0);
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
