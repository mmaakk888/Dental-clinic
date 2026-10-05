import test from 'node:test';
import assert from 'node:assert/strict';
import { Patient, Session } from '../types';
import { calculateDailyCollections, getPatientFinancialSummary, appendSessionReceipt } from './financials';

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

test('adding a receipt retains legacy paid amounts and their original collection date', () => {
  const legacy = makeSession({ paid: 500, remain: 700, paymentsLog: [], payDate: '2026-09-20' });
  const updated = appendSessionReceipt(legacy, { id: 'new', amount: 200, date: '2026-09-22' });
  assert.equal(updated.paid, 700);
  assert.equal(updated.remain, 500);
  assert.equal(calculateDailyCollections([makePatient({ sessions: [updated] })], date => date === '2026-09-20').totalIncomeCollected, 500);
  assert.equal(calculateDailyCollections([makePatient({ sessions: [updated] })], date => date === '2026-09-22').totalIncomeCollected, 200);
});

test('display-only legacy aggregate is retained but never counted as another receipt', () => {
  const patient = makePatient({ payments: [{ id: 'summary', amount: 1200, date: '2026-09-22', legacyAggregate: true }] });
  assert.equal(getPatientFinancialSummary(patient).totalCollected, 1200);
  assert.equal(calculateDailyCollections([patient], () => true).totalIncomeCollected, 1200);
  assert.equal(patient.payments.length, 1);
});

test('adding a receipt to a voided log does not resurrect the voided amount', () => {
  const original = makeSession({ paid: 500, paymentsLog: [{ id: 'void', amount: 500, date: '2026-09-20', voidedAt: '2026-09-21' }] });
  assert.equal(appendSessionReceipt(original, { id: 'new', amount: 100, date: '2026-09-22' }).paid, 100);
});

test('a new receipt never hides an independent payment with the same date and amount', () => {
  const original = makeSession({ amount: 100, paid: 0, paymentsLog: [], date: '2026-10-06' });
  const patient = makePatient({ sessions: [original], payments: [{ id: 'independent', amount: 20, date: '2026-10-06' }] });
  const updated = { ...patient, sessions: [appendSessionReceipt(original, { id: 'new', amount: 20, date: '2026-10-06' })] };
  assert.equal(getPatientFinancialSummary(patient).totalCollected, 20);
  assert.equal(getPatientFinancialSummary(updated).totalCollected, 40);
  assert.equal(getPatientFinancialSummary(updated).totalRemaining, 60);
  assert.equal(calculateDailyCollections([updated], date => date === '2026-10-06').totalIncomeCollected, 40);
});

test('a modern independent receipt is not a mirror of an older session receipt', () => {
  const patient = makePatient({ payments: [{ id: 'independent', amount: 700, date: '2026-09-22', createdAt: '2026-09-22T12:00:00Z' }] });
  assert.equal(getPatientFinancialSummary(patient).totalCollected, 1900);
  assert.equal(calculateDailyCollections([patient], date => date === '2026-09-22').totalIncomeCollected, 1400);
});

test('synthesizing an old paid log preserves independent receipts already counted', () => {
  const original = makeSession({ amount: 100, paid: 20, paymentsLog: [], date: '2026-10-06' });
  const patient = makePatient({ sessions: [original], payments: [{ id: 'independent', amount: 20, date: '2026-10-06' }] });
  const updated = { ...patient, sessions: [appendSessionReceipt(original, { id: 'new', amount: 10, date: '2026-10-06' })] };
  assert.equal(getPatientFinancialSummary(patient).totalCollected, 40);
  assert.equal(getPatientFinancialSummary(updated).totalCollected, 50);
  assert.equal(calculateDailyCollections([updated], date => date === '2026-10-06').totalIncomeCollected, 50);
});

test('exam fee is allocated once across installment dates, not again on every payment', () => {
  const patient = makePatient({ sessions: [makeSession({ amount: 500, examinationFee: 50,
    services: [{ id: 'filling', name: 'حشو', price: 450 }],
    paymentsLog: [{ id: 'first', amount: 100, date: '2026-09-20' }, { id: 'second', amount: 200, date: '2026-09-22' }]
  })] });
  const first = calculateDailyCollections([patient], date => date === '2026-09-20');
  const second = calculateDailyCollections([patient], date => date === '2026-09-22');
  assert.equal(first.examFeesCollected, 50);
  assert.equal(second.examFeesCollected, 0);
  assert.equal(second.procedureFeesCollectedByName['حشو'], 200);
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
