import { Session, SessionServiceItem, Patient, Appointment } from '../types';

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
      const installmentsInPeriod = session.paymentsLog?.filter(p => dateFilterFn(p.date)) || [];
      const installmentPaidInPeriod = installmentsInPeriod.reduce((sum, p) => sum + p.amount, 0);

      if (sessionInPeriod || installmentsInPeriod.length > 0) {
        patientIdsSeen.add(patient.id);

        const examFee = session.examinationFee || 0;
        const totalVal = session.amount;
        
        // Paid amount for this session in period
        const paidInPeriod = sessionInPeriod ? session.paid : installmentPaidInPeriod;
        const discountAmt = sessionInPeriod ? (session.discount || 0) : 0;
        const remainAmt = Math.max(0, session.amount - session.paid - (session.discount || 0));

        if (sessionInPeriod) {
          totalOutstandingRemain += remainAmt;
          totalDiscountsGiven += discountAmt;
        }

        totalIncomeCollected += paidInPeriod;

        // Payment Method breakdown
        const method = session.paymentMethod || 'cash';
        if (method === 'cash') cashTotal += paidInPeriod;
        else if (method === 'card') cardTotal += paidInPeriod;
        else if (method === 'transfer') transferTotal += paidInPeriod;

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
        const distribution = distributePaymentToServices(examFee, servicesList, paidInPeriod, discountAmt);

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
          date: session.date,
          isWalkIn: Boolean(session.isWalkIn),
        });
      }
    });

    // Also include general payments made on this date
    patient.payments?.forEach(pay => {
      if (dateFilterFn(pay.date)) {
        totalIncomeCollected += pay.amount;
        const method = pay.paymentMethod || 'cash';
        if (method === 'cash') cashTotal += pay.amount;
        else if (method === 'card') cardTotal += pay.amount;
        else if (method === 'transfer') transferTotal += pay.amount;
        procedureFeesCollectedByName['دفعة عامة / أقساط'] = (procedureFeesCollectedByName['دفعة عامة / أقساط'] || 0) + pay.amount;
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
