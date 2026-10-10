import { LabCase, Patient } from '../types';
import { getPatientFinancialSummary, getSessionCollected, sumFinancialAmounts } from './financials';

/** Supplier cash writes use integer piastres, accepting only negligible binary
 * residue from addition, never silently rounding a user-entered sub-cent amount. */
export function labMoneyCents(value: number): number {
  const scaled = value * 100;
  const rounded = Math.round(scaled);
  if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(rounded) || Math.abs(scaled - rounded) > 0.000001) {
    throw new Error('أدخل مبلغًا صحيحًا للمعمل بمنزلتين عشريتين على الأكثر.');
  }
  return rounded;
}

export function getLabCaseFinancials(item: LabCase, patients: Patient[]) {
  const patient = patients.find(p => p.id === item.patientId);
  const session = patient?.sessions.find(s => s.id === item.linkedSessionId);
  const collected = session ? getSessionCollected(session) : 0;
  const cost = Math.max(0, item.labTotal);
  const paid = Math.max(0, item.labPaid);
  return {
    linked: Boolean(session),
    patientTotal: session && Number.isFinite(session.amount) ? Math.max(0, sumFinancialAmounts([session.amount, -(session.discount || 0)])) : null,
    patientFileRemaining: patient ? getPatientFinancialSummary(patient).totalRemaining : null,
    collected,
    reserved: Math.max(0, sumFinancialAmounts([Math.min(collected, cost), -paid])),
    remaining: Math.max(0, sumFinancialAmounts([cost, -paid])),
    availableToClinic: Math.max(0, sumFinancialAmounts([collected, -cost])),
  };
}

export function allocateLabPayment(cases: LabCase[], labId: string, amount: number) {
  const amountCents = labMoneyCents(amount);
  if (amountCents <= 0) throw new Error('أدخل مبلغاً صحيحاً');
  const eligible = cases.filter(c => c.labId === labId).map(c => ({ item: c, due: Math.max(0, labMoneyCents(c.labTotal) - labMoneyCents(c.labPaid)) }))
    .filter(c => c.due > 0).sort((a, b) => a.item.date.localeCompare(b.item.date) || a.item.id.localeCompare(b.item.id));
  const due = eligible.reduce((sum, c) => sum + c.due, 0);
  if (!Number.isSafeInteger(due)) throw new Error('إجمالي مستحق المعمل غير صالح. راجع الحسابات.');
  if (amountCents > due) throw new Error('المبلغ أكبر من المستحق للمعمل');
  let remaining = amountCents;
  return eligible.flatMap(c => {
    const allocated = Math.min(remaining, c.due);
    remaining -= allocated;
    return allocated > 0 ? [{ caseId: c.item.id, amount: allocated / 100 }] : [];
  });
}
