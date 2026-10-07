import type { Patient, SessionServiceItem } from '../types';
import { canonicalFileNumber } from './clinicMutations';

export function nextWalkInFileNumber(patients: readonly Pick<Patient, 'id'>[]): string {
  let maximum = 100;
  for (const patient of patients) {
    const canonical = canonicalFileNumber(patient.id);
    if (!/^\d+$/.test(canonical)) continue;
    const value = Number(canonical);
    if (Number.isSafeInteger(value)) maximum = Math.max(maximum, value);
  }
  return Number.isSafeInteger(maximum + 1) ? String(maximum + 1) : '';
}

export function validateWalkInAmounts(examinationFee: number, services: readonly SessionServiceItem[], paid: number, discount: number): string | null {
  if ([examinationFee, paid, discount, ...services.map(item => item.price)].some(value => !Number.isFinite(value) || value < 0)) return 'أدخل مبالغ صحيحة لا تقل عن صفر.';
  if (services.some(item => !item.name.trim())) return 'اكتب اسم كل خدمة أو احذف السطر الفارغ.';
  const total = examinationFee + services.reduce((sum, item) => sum + item.price, 0);
  if (!Number.isFinite(total) || paid + discount > total + 0.000001) return 'الدفعة والخصم أكبر من إجمالي الزيارة. راجع المبالغ.';
  return null;
}
