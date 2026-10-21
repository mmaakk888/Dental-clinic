import type { Patient } from '../types';

type SearchPatient = Pick<Patient, 'id' | 'name' | 'mobile'>;
type SearchEntry<T> = { patient: T; file: string; name: string; phone: string };

const normalize = (value: string) => value.normalize('NFKC')
  .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
  .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
  .replace(/[\u064B-\u065F\u0670ـ]/g, '')
  .replace(/[أإآٱ]/g, 'ا').replace(/[ىی]/g, 'ي').trim().toLowerCase();

const phone = (value: string) => {
  const digits = normalize(value).replace(/\D/g, '');
  if (/^00201/.test(digits)) return `0${digits.slice(4)}`;
  if (/^201/.test(digits)) return `0${digits.slice(2)}`;
  return digits;
};

/** Normalize records once per dataset, rather than on every input keystroke. */
export function buildHomePatientSearch<T extends SearchPatient>(patients: readonly T[]): SearchEntry<T>[] {
  return patients.map(patient => ({ patient, file: normalize(patient.id), name: normalize(patient.name), phone: phone(patient.mobile || '') }));
}

/** Bounded output avoids rendering a large file directory inside a small dialog. */
export function searchHomePatients<T>(index: readonly SearchEntry<T>[], query: string, limit: number, showEmpty = false): T[] {
  if (limit <= 0) return [];
  const text = normalize(query);
  if (!text) return showEmpty ? index.slice(0, limit).map(item => item.patient) : [];
  const fileOnly = text.startsWith('#');
  const fileQuery = text.replace(/^#\s*/, '');
  if (!fileQuery) return [];
  const phoneQuery = !fileOnly && /^\+?[\d\s().-]+$/.test(text) ? phone(text) : '';
  const results: T[] = [];
  // An exact file match must not disappear behind the first partial/name matches.
  const exact = index.find(item => item.file === fileQuery);
  if (exact) results.push(exact.patient);
  if (results.length >= limit) return results;
  for (const item of index) {
    if (item === exact) continue;
    if (item.file.includes(fileQuery) || (!fileOnly && (item.name.includes(text) || (!!phoneQuery && item.phone.includes(phoneQuery))))) {
      results.push(item.patient);
      if (results.length >= limit) break;
    }
  }
  return results;
}
