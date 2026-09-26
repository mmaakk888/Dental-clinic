import test from 'node:test';
import assert from 'node:assert/strict';
import { Patient, Session } from '../types';
import { calculateDailyCollections, getPatientFinancialSummary } from './financials';

const makeSession = (overrides: Partial<Session> = {}): Session => ({
  id: 'session-1',
  type: 'علاج عصب',
  tooth: 'ur6',
  amount: 1_200,
  paid: 1_200,
  remain: 0,
  date: '2026-09-20',
  paymentsLog: [
    { id: 'pay-1', amount: 500, date: '2026-09-20' },
    { id: 'pay-2', amount: 700, date: '2026-09-22' }
  ],
  services: [{ id: 'root-canal', name: 'علاج عصب', price: 1_200 }],
  examinationFee: 0,
  ...overrides
});

const makePatient = (overrides: Partial<Patient> = {}): Patient => ({
  id: '401',
  name: 'مريض اختبار',
  mobile: '01000000000',
  age: 35,
  firstVisit: '2026-09-20',
  notes: '',
  allergy: '',
  sessions: [makeSession()],
  payments: [],
  ...overrides
});

test('daily collection counts only receipts made on the selected date', () => {
  const patient = makePatient();
  const firstDay = calculateDailyCollections([patient], date => date === '2026-09-20');
  const secondDay = calculateDailyCollections([patient], date => date === '2026-09-22');

  assert.equal(firstDay.totalIncomeCollected, 500);
  assert.equal(secondDay.totalIncomeCollected, 700);
  assert.equal(firstDay.rows[0].paidAmount, 500);
  assert.equal(secondDay.rows[0].paidAmount, 700);
});

test('a receipt mirrored in general payments is not counted twice', () => {
  const patient = makePatient({
    payments: [{ id: 'legacy-general-id', amount: 700, date: '2026-09-22' }]
  });

  const report = calculateDailyCollections([patient], date => date === '2026-09-22');

  assert.equal(report.totalIncomeCollected, 700);
  assert.equal(report.rows.length, 1);
});

test('voided receipts are excluded from daily and patient totals', () => {
  const patient = makePatient({
    sessions: [makeSession({
      paid: 1_200,
      paymentsLog: [
        { id: 'pay-ok', amount: 500, date: '2026-09-20' },
        { id: 'pay-void', amount: 700, date: '2026-09-20', voidedAt: '2026-09-21T10:00:00Z' }
      ]
    })]
  });

  const report = calculateDailyCollections([patient], date => date === '2026-09-20');
  const summary = getPatientFinancialSummary(patient);

  assert.equal(report.totalIncomeCollected, 500);
  assert.equal(summary.totalCollected, 500);
  assert.equal(summary.totalRemaining, 700);
});

test('patient summary applies discounts and independent payments once', () => {
  const patient = makePatient({
    sessions: [makeSession({ amount: 1_200, discount: 100 })],
    payments: [
      { id: 'legacy-mirror', amount: 700, date: '2026-09-22' },
      { id: 'general-1', amount: 100, date: '2026-09-23', note: 'سداد رصيد' }
    ]
  });

  const summary = getPatientFinancialSummary(patient);

  assert.deepEqual(summary, {
    totalRequired: 1_200,
    totalCollected: 1_300,
    totalDiscounts: 100,
    totalRemaining: 0
  });
});

test('general payments appear in the selected day drill-down as cash', () => {
  const patient = makePatient({
    sessions: [],
    payments: [{ id: 'general-1', amount: 250, date: '2026-09-24', note: 'دفعة سابقة' }]
  });

  const report = calculateDailyCollections([patient], date => date === '2026-09-24');

  assert.equal(report.totalIncomeCollected, 250);
  assert.equal(report.cashTotal, 250);
  assert.equal(report.rows[0].patientName, 'مريض اختبار');
  assert.equal(report.rows[0].proceduresText, 'دفعة سابقة');
});
