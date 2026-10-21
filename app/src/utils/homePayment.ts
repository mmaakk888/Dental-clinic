import { Patient, Session } from '../types';
import { getSessionCollected } from './financials';
import { getPatientSessionReceiptLimit } from './patientCollection';

export const normalizePaymentSearch = (value: string) => value.trim().toLocaleLowerCase('ar')
  .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
  .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
  .replace(/[\s()+#-]/g, '');

export const paymentSessionRemaining = (session: Session) => Math.max(0,
  (Number.isFinite(session.amount) ? Math.max(0, session.amount) : 0)
  - (Number.isFinite(session.discount) ? Math.max(0, session.discount || 0) : 0)
  - getSessionCollected(session));

export function validateHomePayment(patient: Patient | undefined, sessionId: string, value: number) {
  const session = patient?.sessions.find(item => item.id === sessionId);
  if (!patient || !session) return { valid: false, reason: 'selection', maximum: 0 } as const;
  if (!Number.isFinite(value) || value <= 0) return { valid: false, reason: 'amount', maximum: 0 } as const;
  const maximum = getPatientSessionReceiptLimit(patient, session);
  if (value > maximum) return { valid: false, reason: 'limit', maximum } as const;
  return { valid: true, maximum } as const;
}
