import type { Patient, Session } from '../types';
import { getPatientFinancialSummary, getSessionCollected } from './financials';

/** Independent general receipts can settle debt without changing a session log. */
export function getPatientSessionReceiptLimit(patient: Patient, session: Session): number {
  const sessionRemaining = Math.max(0, session.amount - (session.discount ?? 0) - getSessionCollected(session));
  const limit = Math.min(sessionRemaining, getPatientFinancialSummary(patient).totalRemaining);
  // Remove floating-point residue from calculations on cent-valued amounts.
  const cents = Math.round(limit * 100) / 100;
  return Math.abs(cents - limit) < 1e-8 ? cents : limit;
}

/** Hidden balances must not be recoverable from input defaults or max attributes. */
export function getPatientCollectionPresentation(patient: Patient, session: Session | undefined, revealBalance: boolean) {
  const limit = session ? getPatientSessionReceiptLimit(patient, session) : 0;
  return {
    initialAmount: (revealBalance && session ? limit : '') as number | '',
    maxAmount: revealBalance && session ? limit : undefined,
    optionSuffix: revealBalance && session ? ` — المتاح للتحصيل: ${limit} ج.م` : '',
  };
}
