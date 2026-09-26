import { LabCase, Patient } from '../types';
import { getSessionCollected } from './financials';

export function getLabCaseFinancials(item: LabCase, patients: Patient[]) {
  const session = patients.find(p => p.id === item.patientId)?.sessions.find(s => s.id === item.linkedSessionId);
  const collected = session ? getSessionCollected(session) : 0;
  const cost = Math.max(0, item.labTotal);
  const paid = Math.max(0, item.labPaid);
  return {
    linked: Boolean(session),
    collected,
    reserved: Math.max(0, Math.min(collected, cost) - paid),
    remaining: Math.max(0, cost - paid),
    availableToClinic: Math.max(0, collected - cost),
  };
}

export function allocateLabPayment(cases: LabCase[], labId: string, amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('أدخل مبلغاً صحيحاً');
  const eligible = cases.filter(c => c.labId === labId && c.labTotal > c.labPaid)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const due = eligible.reduce((sum, c) => sum + c.labTotal - c.labPaid, 0);
  if (amount > due) throw new Error('المبلغ أكبر من المستحق للمعمل');
  let remaining = amount;
  return eligible.flatMap(c => {
    const allocated = Math.min(remaining, c.labTotal - c.labPaid);
    remaining -= allocated;
    return allocated > 0 ? [{ caseId: c.id, amount: allocated }] : [];
  });
}
