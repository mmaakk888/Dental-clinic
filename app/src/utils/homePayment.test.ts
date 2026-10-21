import test from 'node:test';
import assert from 'node:assert/strict';
import { Patient, Session } from '../types';
import { normalizePaymentSearch, paymentSessionRemaining, validateHomePayment } from './homePayment';

const session = { id: 's1', amount: 100, discount: 10, paid: 30, date: '2026-10-06', type: 'خدمة' } as Session;
const patient = { id: '101', sessions: [session], payments: [] } as unknown as Patient;

test('home payment search accepts Arabic file digits and spaced phone numbers', () => {
  assert.equal(normalizePaymentSearch(' #١٠١ '), '101');
  assert.equal(normalizePaymentSearch('+٢٠ ١٠-١٢٣٤٥٦٧٨'), '201012345678');
  assert.equal(normalizePaymentSearch(' محمد إبراهيم '), normalizePaymentSearch('محمدإبراهيم'));
});

test('home payment requires an existing patient and session, and finite positive cash', () => {
  assert.equal(validateHomePayment(undefined, 's1', 10).valid, false);
  assert.equal(validateHomePayment(patient, 'missing', 10).valid, false);
  for (const amount of [0, -1, NaN, Infinity]) assert.equal(validateHomePayment(patient, 's1', amount).valid, false);
  assert.equal(validateHomePayment(patient, 's1', 20).valid, true);
});

test('home payment respects both service balance and independent patient receipts', () => {
  assert.equal(paymentSessionRemaining(session), 60);
  assert.equal(validateHomePayment(patient, 's1', 61).valid, false);
  const withReceipt: Patient = { ...patient, payments: [{ id: 'p1', amount: 40, date: '2026-10-06', paymentMethod: 'cash' }] };
  assert.deepEqual(validateHomePayment(withReceipt, 's1', 21), { valid: false, reason: 'limit', maximum: 20 });
  assert.equal(validateHomePayment(withReceipt, 's1', 20).valid, true);
});

test('home payment uses active receipt logs instead of stale paid values', () => {
  const withVoidedReceipt = { ...session, paid: 90, paymentsLog: [{ id: 'r1', amount: 90, date: '2026-10-06', voidedAt: '2026-10-06T12:00:00Z' }] } as Session;
  assert.equal(paymentSessionRemaining(withVoidedReceipt), 90);
  assert.equal(paymentSessionRemaining({ ...session, amount: NaN, discount: -20 }), 0);
});

test('home and patient-file collection agree on legitimate cent-valued final receipts', () => {
  const decimal = { ...session, amount: 0.3, discount: 0, paid: 0.1, paymentsLog: [{ id: 'decimal', amount: 0.1, date: '2026-10-10' }] };
  const record = { ...patient, sessions: [decimal] };
  assert.deepEqual(validateHomePayment(record, decimal.id, 0.2), { valid: true, maximum: 0.2 });
  assert.equal(validateHomePayment(record, decimal.id, 0.21).valid, false);
});
