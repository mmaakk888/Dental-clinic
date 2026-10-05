import { Session, SessionServiceItem, Patient, Appointment, PaymentInstallment } from '../types';

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
    return activePayments.reduce((sum, payment) => sum + positiveMoney(payment.amount), 0);
  }
  return positiveMoney(session.paid);
}

export function appendSessionReceipt(session: Session, receipt: PaymentInstallment): Session {
  const priorCollected = getSessionCollected(session);
  const priorLog = session.paymentsLog || [];
  const legacyLog: PaymentInstallment[] = !priorLog.length && priorCollected > 0 ? [{
    id: `legacy_${session.id}`, amount: priorCollected, date: session.payDate || session.date,
    paymentMethod: 'cash', note: 'دفعة سابقة محفوظة قبل سجل الدفعات'
  }] : [];
  const paymentsLog = [...legacyLog, ...priorLog, receipt];
  const paid = getSessionCollected({ ...session, paymentsLog });
  return { ...session, paymentsLog, paid, remain: Math.max(0, positiveMoney(session.amount) - positiveMoney(session.discount) - paid) };
}

function getIndependentGeneralPayments(patient: Patient) {
  const sessionPaymentIds = new Set(
    patient.sessions.flatMap(session => (session.paymentsLog || []).map(payment => payment.id))
  );
  const linkedSessionIds = new Set(patient.sessions.map(session => session.id));
  const legacyMirrorCounts = new Map<string, number>();

  patient.sessions.forEach(session => {
    (session.paymentsLog || [])
      .filter(payment => !payment.voidedAt)
      .forEach(payment => {
        const key = `${payment.date}|${positiveMoney(payment.amount)}`;
        legacyMirrorCounts.set(key, (legacyMirrorCounts.get(key) || 0) + 1);
      });
  });

  return (patient.payments || []).filter(payment => {
    if (payment.voidedAt || payment.legacyAggregate || sessionPaymentIds.has(payment.id)) return false;
    if (payment.linkedSessionId && linkedSessionIds.has(payment.linkedSessionId)) return false;

    // Older app versions copied every session receipt into `patient.payments`
    // with a different id. Consume matching date/amount pairs once as mirrors.
    if (!payment.linkedSessionId) {
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
  const totalRequired = patient.sessions.reduce(
    (sum, session) => sum + positiveMoney(session.amount),
    0
  );
  const totalDiscounts = patient.sessions.reduce(
    (sum, session) => sum + positiveMoney(session.discount),
    0
  );
  const sessionCollections = patient.sessions.reduce(
    (sum, session) => sum + getSessionCollected(session),
    0
  );
  const generalCollections = getIndependentGeneralPayments(patient)
    .reduce((sum, payment) => sum + positiveMoney(payment.amount), 0);
  const totalCollected = sessionCollections + generalCollections;
  const netRequired = Math.max(0, totalRequired - totalDiscounts);

  return {
    totalRequired,
    totalCollected,
    totalDiscounts,
    totalRemaining: Math.max(0, netRequired - totalCollected)
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
  remainingPaidPool -= examFeePaid;
  const examFeeRemain = Math.max(0, examinationFee - examFeePaid);

  // 2. Procedures Paid Allocation
  const updatedServices = services.map(srv => {
    const itemPaid = Math.min(srv.price, remainingPaidPool);
    remainingPaidPool -= itemPaid;
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
  const procedureFeesCollectedByName: Record<string, number> = {};
  let totalIncomeCollected = 0;
  let totalDiscountsGiven = 0;
  let totalOutstandingRemain = 0;
  let cashTotal = 0;
  let cardTotal = 0;
  let transferTotal = 0;

  const patientIdsSeen = new Set<string>();

  patients.forEach(patient => {
    patient.sessions.forEach(session => {
      // Check if session itself took place on the filtered date
      const sessionInPeriod = dateFilterFn(session.date);

      // Check installments logged on the filtered date
      const allActiveInstallments = (session.paymentsLog || []).filter(payment => !payment.voidedAt);
      const installmentsInPeriod = allActiveInstallments.filter(p => dateFilterFn(p.date));
      const installmentPaidInPeriod = installmentsInPeriod.reduce((sum, p) => sum + positiveMoney(p.amount), 0);

      // Legacy sessions may have only a paid total and no receipt log.
      const legacyPaidInPeriod = (session.paymentsLog || []).length === 0 && session.paid > 0 && dateFilterFn(session.payDate || session.date)
        ? positiveMoney(session.paid)
        : 0;
      const paidInPeriod = installmentPaidInPeriod + legacyPaidInPeriod;

      if (sessionInPeriod || paidInPeriod > 0) {
        patientIdsSeen.add(patient.id);

        const examFee = session.examinationFee || 0;
        const totalVal = session.amount;
        
        const discountAmt = sessionInPeriod ? (session.discount || 0) : 0;
        const remainAmt = Math.max(0, session.amount - getSessionCollected(session) - (session.discount || 0));

        if (sessionInPeriod) {
          totalOutstandingRemain += remainAmt;
          totalDiscountsGiven += discountAmt;
        }

        totalIncomeCollected += paidInPeriod;

        // Payment Method breakdown
        // Clinic policy records all receipts as cash, regardless of the external channel.
        const method: 'cash' = 'cash';
        cashTotal += paidInPeriod;

        // Procedures breakdown allocation for reports
        let servicesList = session.services && session.services.length > 0
          ? session.services
          : [];

        if (servicesList.length === 0) {
          // Fallback if session has no explicit breakdown array
          const procText = session.procedurePerformed || session.type || 'كشف وحشو أسنان';
          const treatFee = Math.max(0, session.amount - examFee);
          if (treatFee > 0) {
            servicesList = [{ id: 'auto', name: procText, price: treatFee }];
          }
        }

        // Calculate distribution of paid amount
        const firstReceiptDate = installmentsInPeriod.map(payment => payment.date).sort()[0];
        const previouslyCollected = firstReceiptDate ? allActiveInstallments
          .filter(payment => payment.date < firstReceiptDate)
          .reduce((sum, payment) => sum + positiveMoney(payment.amount), 0) : 0;
        const beforeDistribution = distributePaymentToServices(examFee, servicesList, previouslyCollected, discountAmt);
        const cumulativeDistribution = distributePaymentToServices(examFee, servicesList, previouslyCollected + paidInPeriod, discountAmt);
        const distribution = {
          examFeePaid: Math.max(0, cumulativeDistribution.examFeePaid - beforeDistribution.examFeePaid),
          services: cumulativeDistribution.services.map((service, index) => ({
            ...service, paid: Math.max(0, (service.paid || 0) - (beforeDistribution.services[index]?.paid || 0))
          }))
        };

        if (examFee > 0) {
          examFeesCollected += distribution.examFeePaid;
          procedureFeesCollectedByName['كشف ومعاينة'] = (procedureFeesCollectedByName['كشف ومعاينة'] || 0) + distribution.examFeePaid;
        }

        distribution.services.forEach(srv => {
          const sName = srv.name || 'خدمة أسنان';
          const sPaid = srv.paid || 0;
          procedureFeesCollectedByName[sName] = (procedureFeesCollectedByName[sName] || 0) + sPaid;
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
          time: session.time || '10:00 ص',
          proceduresText,
          servicesBreakdown: [
            ...(examFee > 0 ? [{ name: 'كشف ومعاينة', price: examFee, paid: distribution.examFeePaid }] : []),
            ...distribution.services.map(s => ({ name: s.name, price: s.price, paid: s.paid || 0 }))
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
        totalIncomeCollected += paymentAmount;
        cashTotal += paymentAmount;
        procedureFeesCollectedByName['دفعة عامة / أقساط'] = (procedureFeesCollectedByName['دفعة عامة / أقساط'] || 0) + paymentAmount;
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
          remainAmount: getPatientFinancialSummary(patient).totalRemaining,
          paymentMethod: 'cash',
          date: pay.date,
          isWalkIn: false
        });
      }
    });
  });

  return {
    rows,
    examFeesCollected,
    procedureFeesCollectedByName,
    totalIncomeCollected,
    totalDiscountsGiven,
    totalOutstandingRemain,
    cashTotal,
    cardTotal,
    transferTotal,
    visitedPatientsCount: patientIdsSeen.size,
  };
}
