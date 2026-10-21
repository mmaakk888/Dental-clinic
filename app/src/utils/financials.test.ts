import test from 'node:test';
import assert from 'node:assert/strict';
import { Patient, Session } from '../types';
import { calculateDailyCollections, getPatientFinancialSummary, appendSessionReceipt, getSessionCollected, sumFinancialAmounts, financialMoneyCents } from './financials';

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

test('report balance agrees with the current patient ledger including unallocated general receipts', () => {
  const record = makePatient({ sessions: [makeSession({ amount: 100, discount: 0, paid: 20, paymentsLog: [
    { id: 'session-receipt', amount: 20, date: '2026-09-20', createdAt: '2026-09-20T10:00:00Z' }
  ] })], payments: [{ id: 'independent', amount: 40, date: '2026-09-21', createdAt: '2026-09-21T10:00:00Z' }] });
  const report = calculateDailyCollections([record], () => true);
  assert.equal(report.rows.length, 2);
  assert.equal(report.totalIncomeCollected, 60);
  assert.equal(report.totalOutstandingRemain, 40);
  assert.deepEqual(report.rows.map(row => row.remainAmount), [40, 40]);
  // A report of the later general receipt alone still exposes the SAME current
  // file balance, without pretending that cash was applied to a specific tooth.
  const later = calculateDailyCollections([record], day => day === '2026-09-21');
  assert.equal(later.totalOutstandingRemain, 40);
  assert.equal(later.rows[0].remainAmount, 40);
});

test('several visits and receipts count a current file debt only once, with no other files added', () => {
  const record = makePatient({ sessions: [makeSession({ amount: 100, paid: 0, paymentsLog: [] }),
    makeSession({ id: 'second-session', amount: 100, paid: 0, paymentsLog: [] })], payments: [
    { id: 'general', amount: 50, date: '2026-09-20', createdAt: '2026-09-20T10:00:00Z' }
  ] });
  const excluded = makePatient({ id: 'other-file', sessions: [makeSession({ date: '2025-01-01', paid: 0, paymentsLog: [] })] });
  const report = calculateDailyCollections([record, excluded], day => day === '2026-09-20');
  assert.equal(report.rows.length, 3);
  assert.equal(report.totalOutstandingRemain, 150);
  assert.equal(report.visitedPatientsCount, 1);
  assert.ok(report.rows.every(row => row.remainAmount === 150));
});

test('historical service labels cannot corrupt keyed revenue totals through object prototype names', () => {
  for (const name of ['__proto__', 'constructor', 'toString']) {
    const record = makePatient({ sessions: [makeSession({ amount: 20, paid: 20, examinationFee: 0,
      services: [{ id: 'historical-label', name, price: 20 }], paymentsLog: [] })] });
    const report = calculateDailyCollections([record], () => true);
    assert.equal(report.procedureFeesCollectedByName[name], 20);
    assert.equal(Object.values(report.procedureFeesCollectedByName).reduce((sum, amount) => sum + amount, 0), 20);
  }
});

test('historical incomplete service breakdowns preserve all actual cash with an explicit unallocated category', () => {
  const record = makePatient({ sessions: [makeSession({ amount: 500, paid: 400, time: undefined, paymentsLog: [],
    services: [{ id: 'known-line', name: 'خدمة قديمة مسجلة', price: 100 }] })] });
  const report = calculateDailyCollections([record], () => true);
  assert.equal(report.totalIncomeCollected, 400);
  assert.equal(report.procedureFeesCollectedByName['خدمة قديمة مسجلة'], 100);
  assert.equal(report.procedureFeesCollectedByName['تحصيل غير موزع على خدمة'], 300);
  assert.equal(Object.values(report.procedureFeesCollectedByName).reduce((sum, amount) => sum + amount, 0), report.totalIncomeCollected);
  assert.equal(report.rows[0].servicesBreakdown.reduce((sum, item) => sum + item.paid, 0), report.rows[0].paidAmount);
  assert.equal(report.rows[0].time, '—');
});

test('disjoint date filters allocate installments at their real position rather than skipping intervening receipts', () => {
  const record = makePatient({ sessions: [makeSession({ amount: 300, examinationFee: 100,
    services: [{ id: 'first-treatment', name: 'الخدمة الأولى', price: 100 }, { id: 'second-treatment', name: 'الخدمة الثانية', price: 100 }],
    paymentsLog: [{ id: 'r1', date: '2026-09-20', amount: 100 }, { id: 'r2', date: '2026-09-21', amount: 100 }, { id: 'r3', date: '2026-09-22', amount: 100 }]
  })] });
  const report = calculateDailyCollections([record], day => day !== '2026-09-21');
  assert.equal(report.totalIncomeCollected, 200);
  assert.equal(report.examFeesCollected, 100);
  assert.equal(report.procedureFeesCollectedByName['الخدمة الأولى'], 0);
  assert.equal(report.procedureFeesCollectedByName['الخدمة الثانية'], 100);
  assert.equal(Object.values(report.procedureFeesCollectedByName).reduce((sum, amount) => sum + amount, 0), 200);
});

test('patient totals and new receipt balances use cents rather than exposing fractional arithmetic residue', () => {
  const session = makeSession({ amount: 0.8, discount: 0.1, paid: 0.7, paymentsLog: [
    { id: 'cent-first', date: '2026-09-20', amount: 0.3 },
    { id: 'cent-second', date: '2026-09-22', amount: 0.4 },
  ] });
  const before = structuredClone(session);
  assert.equal(getSessionCollected({ ...session, paymentsLog: session.paymentsLog.map((receipt, index) => ({ ...receipt, amount: index ? 0.2 : 0.1 })) }), 0.3);
  assert.deepEqual(getPatientFinancialSummary(makePatient({ sessions: [session] })), {
    totalRequired: 0.8, totalCollected: 0.7, totalDiscounts: 0.1, totalRemaining: 0,
  });
  const first = { ...session, paymentsLog: [session.paymentsLog[0]] };
  assert.equal(appendSessionReceipt(first, session.paymentsLog[1]).remain, 0);
  assert.deepEqual(session, before);
});

test('daily cent allocations and independent receipt totals do not gain tiny balances or unallocated categories', () => {
  const session = makeSession({ amount: 0.3, paid: 0.3, examinationFee: 0.1, discount: 0,
    services: [{ id: 'decimal-service', name: 'خدمة بالقرش', price: 0.2 }], paymentsLog: [
      { id: 'cent-first', amount: 0.1, date: '2026-09-20', createdAt: '2026-09-20T10:00:00Z' },
      { id: 'cent-second', amount: 0.2, date: '2026-09-22', createdAt: '2026-09-22T10:00:00Z' },
    ] });
  const record = makePatient({ sessions: [session], payments: [
    { id: 'cent-general', amount: 0.1, date: '2026-09-22', createdAt: '2026-09-22T11:00:00Z' },
  ] });
  const report = calculateDailyCollections([record], date => date === '2026-09-22');
  assert.equal(report.totalIncomeCollected, 0.3);
  assert.equal(report.cashTotal, 0.3);
  assert.equal(report.examFeesCollected, 0);
  assert.equal(report.procedureFeesCollectedByName['خدمة بالقرش'], 0.2);
  assert.equal(report.procedureFeesCollectedByName['تحصيل غير موزع على خدمة'], undefined);
  assert.equal(report.rows[0].servicesBreakdown[1].paid, 0.2);
});

test('financial sums do not rewrite genuinely fractional imported history while new cash rejects sub-cent values', () => {
  const session = makeSession({ amount: 1.234, discount: 0.001, paid: 0.007, paymentsLog: [
    { id: 'imported-fraction', date: '2026-09-20', amount: 0.007 },
  ] });
  const patient = makePatient({ sessions: [session] }), before = structuredClone(patient);
  assert.equal(sumFinancialAmounts([0.001, 0.007]), 0.008);
  assert.equal(sumFinancialAmounts([1e-10]), 1e-10);
  assert.equal(getSessionCollected(session), 0.007);
  assert.equal(getPatientFinancialSummary(patient).totalRequired, 1.234);
  assert.equal(getPatientFinancialSummary(patient).totalCollected, 0.007);
  assert.deepEqual(patient, before);
  for (const value of [0.001, 1.234, Number.MAX_SAFE_INTEGER, Infinity, NaN, -1]) assert.throws(() => financialMoneyCents(value));
  assert.equal(financialMoneyCents(0.1 + 0.2), 30);
});

test('direct session receipt append rejects duplicate and synthesized legacy receipt IDs before changing a ledger', () => {
  const session = makeSession(), before = structuredClone(session);
  assert.throws(() => appendSessionReceipt(session, { id: 'pay-1', amount: 1, date: '2026-09-22' }), /معرّف إيصال/);
  const legacy = makeSession({ paid: 10, paymentsLog: [] });
  assert.throws(() => appendSessionReceipt(legacy, { id: `legacy_${legacy.id}`, amount: 1, date: '2026-09-22' }), /معرّف إيصال/);
  assert.deepEqual(session, before);
  assert.deepEqual(legacy.paymentsLog, []);
});
