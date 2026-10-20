import { Session, SessionServiceItem, Patient, Appointment, PaymentInstallment } from '../types';
import { isValidAppointmentDate } from '../components/appointments/appointmentScheduling';

/** New cash entries are integer piastres; only negligible binary arithmetic
 * residue is accepted, never an intentional third decimal or an unsafe total. */
export function financialMoneyCents(value: number): number {
  const scaled = value * 100, rounded = Math.round(scaled);
  if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(rounded) || Math.abs(scaled - rounded) > 0.000001) {
    throw new Error('أدخل مبلغًا صحيحًا بمنزلتين عشريتين على الأكثر.');
  }
  return rounded;
}

/** Calculate cent-valued records exactly without rounding imported fractional
 * amounts. Those retain the previous arithmetic and their original precision. */
export function sumFinancialAmounts(values: readonly number[]): number {
  if (values.every(value => Number.isFinite(value) && /^-?\d+(?:\.\d{1,2})?$/.test(String(value)))) {
    let cents = 0;
    for (const value of values) {
      const entryCents = Math.round(value * 100);
      if (!Number.isSafeInteger(entryCents) || !Number.isSafeInteger(cents + entryCents)) {
        return values.reduce((sum, entry) => sum + entry, 0);
      }
      cents += entryCents;
    }
    return cents / 100;
  }
  return values.reduce((sum, value) => sum + value, 0);
}

export interface PatientFinancialSummary {
  totalRequired: number;
  totalCollected: number;
  totalDiscounts: number;
  totalRemaining: number;
}

const positiveMoney = (value: number | undefined): number =>
  Number.isFinite(value) ? Math.max(0, Number(value)) : 0;

/**
 * Payment logs are the canonical source of session collections. `session.paid`
 * remains a compatibility fallback for records created before payment logs
 * were introduced.
 */
export function getSessionCollected(session: Session): number {
  const activePayments = (session.paymentsLog || []).filter(payment => !payment.voidedAt);
  if ((session.paymentsLog || []).length > 0) {
    return sumFinancialAmounts([positiveMoney(session.legacyOpeningPaid),...activePayments.map(payment => positiveMoney(payment.amount))]);
  }
  return positiveMoney(session.paid);
}

export function appendSessionReceipt(session: Session, receipt: PaymentInstallment): Session {
  const priorCollected = getSessionCollected(session);
  const priorLog = session.paymentsLog || [];
  const amountCents = financialMoneyCents(receipt.amount);
  if (amountCents <= 0 || !isValidAppointmentDate(receipt.date)) throw new Error('أدخل مبلغًا موجبًا وتاريخًا صحيحًا لإيصال التحصيل.');
  if (typeof receipt.id !== 'string' || !receipt.id.trim() || priorLog.some(payment => payment.id === receipt.id)
    || (!priorLog.length && priorCollected > 0 && receipt.id === `legacy_${session.id}`)) {
    throw new Error('معرّف إيصال التحصيل مستخدم بالفعل أو غير صالح. لم تُسجل دفعة مكررة.');
  }
  const legacyLog: PaymentInstallment[] = !priorLog.length && priorCollected > 0 ? [{
    id: `legacy_${session.id}`, amount: priorCollected, date: session.payDate || session.date,
    paymentMethod: 'cash', note: 'دفعة سابقة محفوظة قبل سجل الدفعات'
  }] : [];
  // New receipts are explicit transactions, never legacy date/amount mirrors.
  const paymentsLog = [...legacyLog, ...priorLog, { ...receipt, amount: amountCents / 100, createdAt: receipt.createdAt || new Date().toISOString() }];
  const paid = getSessionCollected({ ...session, paymentsLog });
  return { ...session, paymentsLog, paid, remain: Math.max(0, sumFinancialAmounts([positiveMoney(session.amount), -positiveMoney(session.discount), -paid])) };
}

export function getIndependentGeneralPayments(patient: Patient) {
  const sessionPaymentIds = new Set(
    patient.sessions.flatMap(session => (session.paymentsLog || []).map(payment => payment.id))
  );
  const linkedSessionIds = new Set(patient.sessions.map(session => session.id));
  const legacyMirrorCounts = new Map<string, number>();

  patient.sessions.forEach(session => {
    (session.paymentsLog || [])
      .filter(payment => !payment.voidedAt && !payment.createdAt && payment.id !== `legacy_${session.id}`
        // The first linked-prosthetic release omitted createdAt. Its exact,
        // operation-derived receipt identity still proves an explicit new
        // transaction; it must not hide an unrelated older general receipt.
        && !(session.prosthetic && /^prosthetic_session_[a-f0-9-]{36}$/i.test(session.id)
          && payment.id === session.id.replace('prosthetic_session_', 'prosthetic_receipt_')))
      .forEach(payment => {
        const key = `${payment.date}|${positiveMoney(payment.amount)}`;
        legacyMirrorCounts.set(key, (legacyMirrorCounts.get(key) || 0) + 1);
      });
  });

  return (patient.payments || []).filter(payment => {
    if (payment.voidedAt || payment.legacyAggregate || sessionPaymentIds.has(payment.id)) return false;
    if (payment.linkedSessionId && linkedSessionIds.has(payment.linkedSessionId)) return false;

    // Older app versions copied every session receipt into `patient.payments`
    // with a different id. Only metadata-free historical records participate
    // in this fallback; equal amounts/dates do not identify new transactions.
    if (!payment.linkedSessionId && !payment.createdAt) {
      const key = `${payment.date}|${positiveMoney(payment.amount)}`;
      const mirrorCount = legacyMirrorCounts.get(key) || 0;
      if (mirrorCount > 0) {
        legacyMirrorCounts.set(key, mirrorCount - 1);
        return false;
      }
    }

    return true;
  });
}

export function getPatientFinancialSummary(patient: Patient): PatientFinancialSummary {
  const totalRequired = sumFinancialAmounts(patient.sessions.map(session => positiveMoney(session.amount)));
  const totalDiscounts = sumFinancialAmounts(patient.sessions.map(session => positiveMoney(session.discount)));
  const sessionCollections = sumFinancialAmounts(patient.sessions.map(getSessionCollected));
  const generalCollections = sumFinancialAmounts(getIndependentGeneralPayments(patient).map(payment => positiveMoney(payment.amount)));
  const totalCollected = sumFinancialAmounts([sessionCollections, generalCollections]);
  const netRequired = Math.max(0, sumFinancialAmounts([totalRequired, -totalDiscounts]));

  return {
    totalRequired,
    totalCollected,
    totalDiscounts,
    totalRemaining: Math.max(0, sumFinancialAmounts([netRequired, -totalCollected]))
  };
}

export const STANDARD_SERVICES_CATALOG = [
  { id: 'exam', name: 'كشف ومعاينة', defaultPrice: 50 },
  { id: 'extraction', name: 'خلع أسنان', defaultPrice: 200 },
  { id: 'filling', name: 'حشو تجميلي / ليزر', defaultPrice: 350 },
  { id: 'root_canal', name: 'علاج عصب (حشو جذور)', defaultPrice: 600 },
  { id: 'scaling', name: 'تنظيف جير وتلميع', defaultPrice: 250 },
  { id: 'xray', name: 'أشعة تشخيصية', defaultPrice: 100 },
  { id: 'other', name: 'خدمة أخرى', defaultPrice: 150 },
];

/**
  Distributes a paid amount sequentially across Examination Fee and Procedure Items.
 */
export function distributePaymentToServices(
  examinationFee: number,
  services: SessionServiceItem[],
  paidAmount: number,
  discountAmount: number = 0
) {
  let remainingPaidPool = Math.max(0, paidAmount);

  // 1. Exam Fee Paid Allocation
  const examFeePaid = Math.min(examinationFee, remainingPaidPool);
  remainingPaidPool = sumFinancialAmounts([remainingPaidPool, -examFeePaid]);
  const examFeeRemain = Math.max(0, sumFinancialAmounts([examinationFee, -examFeePaid]));

  // 2. Procedures Paid Allocation
  const updatedServices = services.map(srv => {
    const itemPaid = Math.min(srv.price, remainingPaidPool);
    remainingPaidPool = sumFinancialAmounts([remainingPaidPool, -itemPaid]);
    return {
      ...srv,
      paid: itemPaid,
    };
  });

  return {
    examFeePaid,
    examFeeRemain,
    services: updatedServices,
  };
}

export interface DailyReportRow {
  sessionId: string;
  patientId: string;
  fileNo: string;
  patientName: string;
  mobile: string;
  time: string;
  proceduresText: string;
  servicesBreakdown: Array<{ name: string; price: number; paid: number }>;
  totalValue: number;
  paidAmount: number;
  discountAmount: number;
  /** Current whole-file balance, not debt attributed to this visit or day. */
  remainAmount: number;
  paymentMethod: 'cash' | 'card' | 'transfer';
  date: string;
  isWalkIn: boolean;
}

export interface DailyCollectionMetrics {
  rows: DailyReportRow[];
  examFeesCollected: number;
  procedureFeesCollectedByName: Record<string, number>;
  totalIncomeCollected: number;
  totalDiscountsGiven: number;
  totalOutstandingRemain: number;
  cashTotal: number;
  cardTotal: number;
  transferTotal: number;
  visitedPatientsCount: number;
}

/**
  Calculates actual daily collections on a specific date (or date filter).
  Revenue is tracked strictly on the date of session execution or installment payment, NOT patient creation.
 */
export function calculateDailyCollections(
  patients: Patient[],
  dateFilterFn: (dateStr: string) => boolean
): DailyCollectionMetrics {
  const rows: DailyReportRow[] = [];
  let examFeesCollected = 0;
  const procedureFeesCollectedByName: Record<string, number> = Object.create(null);
  let totalIncomeCollected = 0;
  let totalDiscountsGiven = 0;
  let totalOutstandingRemain = 0;
  let cashTotal = 0;
  let cardTotal = 0;
  let transferTotal = 0;

  const patientIdsSeen = new Set<string>();

  patients.forEach(patient => {
    const patientFinancial = getPatientFinancialSummary(patient);
    patient.sessions.forEach(session => {
      // Check if session itself took place on the filtered date
      const sessionInPeriod = dateFilterFn(session.date);

      // Check installments logged on the filtered date
      const allActiveInstallments = (session.paymentsLog || []).filter(payment => !payment.voidedAt);
      const installmentsInPeriod = allActiveInstallments.filter(p => dateFilterFn(p.date));
      const installmentPaidInPeriod = sumFinancialAmounts(installmentsInPeriod.map(p => positiveMoney(p.amount)));

      // Legacy sessions may have only a paid total and no receipt log.
      const legacyPaidInPeriod = session.legacyOpeningPaid === undefined && (session.paymentsLog || []).length === 0 && session.paid > 0 && dateFilterFn(session.payDate || session.date)
        ? positiveMoney(session.paid)
        : 0;
      const paidInPeriod = sumFinancialAmounts([installmentPaidInPeriod, legacyPaidInPeriod]);

      if (sessionInPeriod || paidInPeriod > 0) {
        patientIdsSeen.add(patient.id);

        const examFee = session.examinationFee || 0;
        const totalVal = session.amount;
        
        const discountAmt = sessionInPeriod ? (session.discount || 0) : 0;
        const remainAmt = patientFinancial.totalRemaining;

        if (sessionInPeriod) {
          totalDiscountsGiven = sumFinancialAmounts([totalDiscountsGiven, discountAmt]);
        }

        totalIncomeCollected = sumFinancialAmounts([totalIncomeCollected, paidInPeriod]);

        // Payment Method breakdown
        // Clinic policy records all receipts as cash, regardless of the external channel.
        const method: 'cash' = 'cash';
        cashTotal = sumFinancialAmounts([cashTotal, paidInPeriod]);

        // Procedures breakdown allocation for reports
        let servicesList = session.services && session.services.length > 0
          ? session.services
          : [];

        if (servicesList.length === 0) {
          // Fallback if session has no explicit breakdown array
          const procText = session.procedurePerformed || session.type || 'كشف وحشو أسنان';
          const treatFee = Math.max(0, sumFinancialAmounts([session.amount, -examFee]));
          if (treatFee > 0) {
            servicesList = [{ id: 'auto', name: procText, price: treatFee }];
          }
        }

        // Allocate each selected receipt at its real chronological position.
        // Combining a disjoint period before allocation would charge the exam
        // again or move money to another service when an intervening date is
        // excluded. This is reporting only, never a rewrite of receipt history.
        const distribution = { examFeePaid: 0, services: servicesList.map(service => ({ ...service, paid: 0 })) };
        let collectedBefore = positiveMoney(session.legacyOpeningPaid);
        for (const receipt of [...allActiveInstallments].sort((a, b) => a.date.localeCompare(b.date))) {
          const before = distributePaymentToServices(examFee, servicesList, collectedBefore, discountAmt);
          collectedBefore = sumFinancialAmounts([collectedBefore, positiveMoney(receipt.amount)]);
          if (!dateFilterFn(receipt.date)) continue;
          const after = distributePaymentToServices(examFee, servicesList, collectedBefore, discountAmt);
          distribution.examFeePaid = sumFinancialAmounts([distribution.examFeePaid, Math.max(0, sumFinancialAmounts([after.examFeePaid, -before.examFeePaid]))]);
          distribution.services.forEach((service, index) => { service.paid = sumFinancialAmounts([service.paid,
            Math.max(0, sumFinancialAmounts([after.services[index]?.paid || 0, -(before.services[index]?.paid || 0)]))]); });
        }
        if (legacyPaidInPeriod > 0) {
          const legacy = distributePaymentToServices(examFee, servicesList, legacyPaidInPeriod, discountAmt);
          distribution.examFeePaid = legacy.examFeePaid;
          distribution.services.forEach((service, index) => { service.paid = legacy.services[index]?.paid || 0; });
        }
        // Incomplete historical breakdowns and overpayments must not make
        // actual cash disappear or pretend it belongs to a known treatment.
        const unallocatedPaid = Math.max(0, sumFinancialAmounts([paidInPeriod, -distribution.examFeePaid,
          -sumFinancialAmounts(distribution.services.map(service => service.paid))]));
        if (unallocatedPaid > 0) procedureFeesCollectedByName['تحصيل غير موزع على خدمة'] =
          sumFinancialAmounts([procedureFeesCollectedByName['تحصيل غير موزع على خدمة'] || 0, unallocatedPaid]);

        if (examFee > 0) {
          examFeesCollected = sumFinancialAmounts([examFeesCollected, distribution.examFeePaid]);
          procedureFeesCollectedByName['كشف ومعاينة'] = sumFinancialAmounts([procedureFeesCollectedByName['كشف ومعاينة'] || 0, distribution.examFeePaid]);
        }

        distribution.services.forEach(srv => {
          const sName = srv.name || 'خدمة أسنان';
          const sPaid = srv.paid || 0;
          procedureFeesCollectedByName[sName] = sumFinancialAmounts([procedureFeesCollectedByName[sName] || 0, sPaid]);
        });

        // Procedures summary text
        const procSummaryItems: string[] = [];
        if (examFee > 0) procSummaryItems.push(`كشف (${examFee} ج.م)`);
        servicesList.forEach(s => procSummaryItems.push(`${s.name} (${s.price} ج.م)`));
        const proceduresText = procSummaryItems.length > 0 ? procSummaryItems.join(' + ') : (session.procedurePerformed || session.type || 'خدمة أسنان');

        rows.push({
          sessionId: session.id,
          patientId: patient.id,
          fileNo: patient.id,
          patientName: patient.name,
          mobile: patient.mobile,
          time: session.time || '—',
          proceduresText,
          servicesBreakdown: [
            ...(examFee > 0 ? [{ name: 'كشف ومعاينة', price: examFee, paid: distribution.examFeePaid }] : []),
            ...distribution.services.map(s => ({ name: s.name, price: s.price, paid: s.paid || 0 })),
            ...(unallocatedPaid > 0 ? [{ name: 'تحصيل غير موزع على خدمة', price: 0, paid: unallocatedPaid }] : [])
          ],
          totalValue: totalVal,
          paidAmount: paidInPeriod,
          discountAmount: discountAmt,
          remainAmount: remainAmt,
          paymentMethod: method,
          date: sessionInPeriod ? session.date : (installmentsInPeriod[0]?.date || session.payDate || session.date),
          isWalkIn: Boolean(session.isWalkIn),
        });
      }
    });

    // Also include general payments made on this date
    getIndependentGeneralPayments(patient).forEach(pay => {
      if (dateFilterFn(pay.date)) {
        const paymentAmount = positiveMoney(pay.amount);
        totalIncomeCollected = sumFinancialAmounts([totalIncomeCollected, paymentAmount]);
        cashTotal = sumFinancialAmounts([cashTotal, paymentAmount]);
        procedureFeesCollectedByName['دفعة عامة / أقساط'] = sumFinancialAmounts([procedureFeesCollectedByName['دفعة عامة / أقساط'] || 0, paymentAmount]);
        patientIdsSeen.add(patient.id);
        rows.push({
          sessionId: pay.linkedSessionId || `general_${pay.id}`,
          patientId: patient.id,
          fileNo: patient.id,
          patientName: patient.name,
          mobile: patient.mobile,
          time: pay.createdAt ? new Date(pay.createdAt).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : '—',
          proceduresText: pay.note || 'دفعة عامة / سداد رصيد سابق',
          servicesBreakdown: [{ name: 'دفعة عامة / أقساط', price: paymentAmount, paid: paymentAmount }],
          totalValue: paymentAmount,
          paidAmount: paymentAmount,
          discountAmount: 0,
          remainAmount: patientFinancial.totalRemaining,
          paymentMethod: 'cash',
          date: pay.date,
          isWalkIn: false
        });
      }
    });
    // General receipts are unallocated credits. Do not invent a per-service
    // settlement or count one patient's current debt again for every visit.
    if (patientIdsSeen.has(patient.id)) totalOutstandingRemain = sumFinancialAmounts([totalOutstandingRemain, patientFinancial.totalRemaining]);
  });

  return {
    rows,
    examFeesCollected,
    // Keep the public plain-record shape, copying only accumulated own keys.
    procedureFeesCollectedByName: { ...procedureFeesCollectedByName },
    totalIncomeCollected,
    totalDiscountsGiven,
    totalOutstandingRemain,
    cashTotal,
    cardTotal,
    transferTotal,
    visitedPatientsCount: patientIdsSeen.size,
  };
}
