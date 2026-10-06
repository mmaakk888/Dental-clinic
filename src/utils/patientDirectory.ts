import type { Patient } from '../types';

export type PatientDirectorySort = 'fileDesc' | 'fileAsc' | 'name';

type DirectoryPatient = Pick<Patient, 'id' | 'name'> & Partial<Pick<Patient, 'mobile'>> & { phone?: string };

const arabicDigits = '٠١٢٣٤٥٦٧٨٩';
const persianDigits = '۰۱۲۳۴۵۶۷۸۹';
const directoryCollator = new Intl.Collator('ar-EG', { numeric: true, sensitivity: 'base' });

export const normalizeDirectoryDigits = (value: string): string =>
  value.replace(/[٠-٩۰-۹]/g, digit => String(arabicDigits.includes(digit) ? arabicDigits.indexOf(digit) : persianDigits.indexOf(digit)));

const normalizeName = (value: string): string => normalizeDirectoryDigits(value.normalize('NFKC'))
  .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
  .replace(/ـ/g, '')
  .replace(/[أإآٱ]/g, 'ا')
  .replace(/[ىی]/g, 'ي')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

const normalizeFile = (value: string): string => normalizeDirectoryDigits(value).trim().toLowerCase();

// Compare Egyptian local and international numbers in the same national form.
// Short substrings remain usable for callers who know only part of a number.
const normalizePhone = (value: string): string => {
  const digits = normalizeDirectoryDigits(value).replace(/\D/g, '');
  if (/^00201/.test(digits)) return `0${digits.slice(4)}`;
  if (/^201/.test(digits)) return `0${digits.slice(2)}`;
  if (/^1[0125]\d{8}$/.test(digits)) return `0${digits}`;
  return digits;
};

/** Rank file numbers first; # limits the search to file numbers only. */
export const getPatientMatchScore = (patient: DirectoryPatient, query: string): number => {
  const trimmedQuery = normalizeDirectoryDigits(query).trim();
  if (!trimmedQuery) return 1;

  const fileOnly = trimmedQuery.startsWith('#');
  const fileQuery = normalizeFile(trimmedQuery.replace(/^#\s*/, ''));
  if (!fileQuery) return 1;
  const id = normalizeFile(patient.id || '');

  if (id === fileQuery) return 100;
  if (id.startsWith(fileQuery)) return 90;
  if (fileOnly) return id.includes(fileQuery) ? 50 : 0;

  const name = normalizeName(patient.name || '');
  const nameQuery = normalizeName(trimmedQuery);
  if (nameQuery && name === nameQuery) return 85;
  if (nameQuery && name.startsWith(nameQuery)) return 80;

  // Letters must not disappear and turn e.g. "abc12" into a phone query "12".
  if (/^\+?[\d\s().-]+$/.test(trimmedQuery)) {
    const mobile = normalizePhone(patient.mobile || patient.phone || '');
    const phoneQuery = normalizePhone(trimmedQuery);
    if (phoneQuery && mobile === phoneQuery) return 75;
    if (phoneQuery && mobile.includes(phoneQuery)) return 70;
  }

  if (nameQuery && name.includes(nameQuery)) return 60;
  if (id.includes(fileQuery)) return 50;
  return 0;
};

/** Sort a copy without filtering or mutating patient records. */
export const sortDirectoryPatients = <T extends DirectoryPatient>(
  patients: readonly T[],
  query: string,
  sortOrder: PatientDirectorySort,
): T[] => {
  const hasQuery = Boolean(query.trim());
  const compareFiles = (left: T, right: T) => directoryCollator.compare(normalizeFile(left.id), normalizeFile(right.id));
  const compareNames = (left: T, right: T) => directoryCollator.compare(normalizeName(left.name), normalizeName(right.name));

  return patients
    .map((patient, index) => ({ patient, index, score: hasQuery ? getPatientMatchScore(patient, query) : 0 }))
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score;
      const primary = sortOrder === 'name'
        ? compareNames(left.patient, right.patient)
        : compareFiles(left.patient, right.patient) * (sortOrder === 'fileDesc' ? -1 : 1);
      if (primary) return primary;
      const secondary = sortOrder === 'name' ? compareFiles(left.patient, right.patient) : compareNames(left.patient, right.patient);
      return secondary || left.index - right.index;
    })
    .map(item => item.patient);
};
