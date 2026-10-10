import type { Patient, SessionServiceItem } from '../types';
import { canonicalFileNumber } from './clinicMutations';
import { getClinicalServicePrice, getServiceGroup, normalizeServiceName } from './serviceCatalog';
import { getToothLabel, PEDIATRIC_LETTERS, QUADRANTS } from './toothUtils';
import { getNextPatientFileNo } from './patientRegistration';
import { financialMoneyCents } from './financials';

export function getWalkInServiceOptions(serviceTypes: readonly string[] = [], clinicalPrices: Record<string, number> = {}) {
  const seen = new Set<string>();
  return serviceTypes.filter(name => {
    const normalized = normalizeServiceName(name);
    if (!normalized || seen.has(normalized) || getServiceGroup(name) === 'prosthetic') return false;
    seen.add(normalized); return true;
  }).map(name => ({ name, price: getClinicalServicePrice(name, { serviceTypes: [...serviceTypes], clinicalPrices, crownPrices: {} }) }));
}

export function getWalkInToothOptions(kind: 'adult' | 'pediatric') {
  const identifiers: readonly (string | number)[] = kind === 'pediatric' ? PEDIATRIC_LETTERS : [1, 2, 3, 4, 5, 6, 7, 8];
  return QUADRANTS.map(quadrant => ({
    label: quadrant.title,
    options: identifiers.map(identifier => {
      const value = `${quadrant.id}${identifier}`;
      return { value, label: getToothLabel(value) };
    }),
  }));
}

export function walkInExaminationDefault(value: unknown = 100): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 100;
}

export function nextWalkInFileNumber(patients: readonly Pick<Patient, 'id'>[]): string {
  return getNextPatientFileNo(patients);
}

export function validateWalkInAmounts(examinationFee: number, services: readonly SessionServiceItem[], paid: number, discount: number): string | null {
  if ([examinationFee, paid, discount, ...services.map(item => item.price)].some(value => !Number.isFinite(value) || value < 0)) return 'أدخل مبالغ صحيحة لا تقل عن صفر.';
  let totalCents: number, paidCents: number, discountCents: number;
  try {
    totalCents = financialMoneyCents(examinationFee) + services.reduce((sum, item) => sum + financialMoneyCents(item.price), 0);
    paidCents = financialMoneyCents(paid); discountCents = financialMoneyCents(discount);
  } catch {
    return 'أدخل مبالغ صحيحة بمنزلتين عشريتين على الأكثر.';
  }
  if (services.some(item => !item.name.trim())) return 'اكتب اسم كل خدمة أو احذف السطر الفارغ.';
  if (services.some(item => item.tooth !== undefined && item.tooth !== null && (typeof item.tooth !== 'string' || !/^(?:ur|ul|lr|ll)(?:[1-8]|[A-E])$/.test(item.tooth)))) return 'اختَر سنًا صحيحًا لكل خدمة، أو اترك تحديد السن فارغًا.';
  if (!Number.isSafeInteger(totalCents) || !Number.isSafeInteger(paidCents + discountCents)
    || paidCents + discountCents > totalCents) return 'الدفعة والخصم أكبر من إجمالي الزيارة. راجع المبالغ.';
  return null;
}
