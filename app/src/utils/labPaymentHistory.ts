import type { LabCase, PaymentInstallment } from '../types';

const cents = (value: number): number => Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : 0;

export function isLabPaymentDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export interface LabPaymentHistoryEntry {
  key: string;
  caseId: string;
  fileNo: string;
  patientName: string;
  serviceName: string;
  receipt: PaymentInstallment;
  /** Invalid or absent legacy dates must never be assigned to the current month. */
  dated: boolean;
}

/** Read-only view of supplier cash, never patient receipts or reserved balances.
 * labPaid remains the authoritative cumulative legacy balance. Missing historical
 * receipts are disclosed, not manufactured or assigned to a convenient date. */
export function getLabPaymentHistory(cases: readonly LabCase[], month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('اختر شهرًا صحيحًا لسجل دفعات المعمل.');
  let totalPaidCents = 0, remainingCents = 0, activeReceiptsCents = 0, monthPaidCents = 0;
  let unknownDateCents = 0, unloggedCents = 0, inconsistentCases = 0, invalidEntries = 0;
  const entries: LabPaymentHistoryEntry[] = [];
  for (const item of cases) {
    const paid = cents(item.labPaid);
    totalPaidCents += paid;
    remainingCents += Math.max(0, cents(item.labTotal) - paid);
    let caseActive = 0, caseUndated = 0;
    (item.paymentsLog || []).forEach((receipt, index) => {
      if (!Number.isFinite(receipt.amount) || receipt.amount <= 0) { invalidEntries++; return; }
      const amount = cents(receipt.amount);
      const dated = isLabPaymentDate(receipt.date);
      entries.push({ key: `${item.id}:${receipt.id}:${index}`, caseId: item.id, fileNo: item.fileNo,
        patientName: item.patientName, serviceName: item.subType, receipt: { ...receipt }, dated });
      if (receipt.voidedAt) return;
      caseActive += amount;
      if (!dated) caseUndated += amount;
      else if (receipt.date.startsWith(`${month}-`)) monthPaidCents += amount;
    });
    activeReceiptsCents += caseActive;
    const unlogged = Math.max(0, paid - caseActive);
    unloggedCents += unlogged;
    unknownDateCents += unlogged + caseUndated;
    if (caseActive > paid) inconsistentCases++;
  }
  entries.sort((a, b) => Number(b.dated) - Number(a.dated)
    || (a.dated && b.dated ? b.receipt.date.localeCompare(a.receipt.date) : 0)
    || (b.receipt.createdAt || '').localeCompare(a.receipt.createdAt || '')
    || a.key.localeCompare(b.key));
  return { entries, totalPaid: totalPaidCents / 100, remaining: remainingCents / 100,
    activeReceiptsTotal: activeReceiptsCents / 100, monthPaid: monthPaidCents / 100,
    unknownDateAmount: unknownDateCents / 100, unloggedAmount: unloggedCents / 100,
    inconsistentCases, invalidEntries };
}
