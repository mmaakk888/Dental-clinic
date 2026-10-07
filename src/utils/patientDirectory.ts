import type { Patient } from '../types';

export type PatientDirectorySort = 'fileDesc' | 'fileAsc' | 'name';

type DirectoryPatient = Pick<Patient, 'id' | 'name'> & Partial<Pick<Patient, 'mobile'>> & { phone?: string };

export interface PatientDirectoryEntry<T extends DirectoryPatient> {
  readonly patient: T;
  readonly index: number;
  readonly file: string;
  readonly name: string;
  readonly phone: string;
}

const arabicDigits = '٠١٢٣٤٥٦٧٨٩';
const persianDigits = '۰۱۲۳۴۵۶۷۸۹';
const directoryCollator = new Intl.Collator('ar-EG', { numeric: true, sensitivity: 'base' });

export const normalizeDirectoryDigits = (value: string): string =>
  value.replace(/[٠-٩۰-۹]/g, digit => String(arabicDigits.includes(digit) ? arabicDigits.indexOf(digit) : persianDigits.indexOf(digit)));

export const normalizeDirectoryName = (value: string): string => normalizeDirectoryDigits(value.normalize('NFKC'))
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

const prepareDirectoryQuery = (query: string) => {
  const trimmedQuery = normalizeDirectoryDigits(query).trim();
  const fileQuery = normalizeFile(trimmedQuery.replace(/^#\s*/, ''));
  return {
    empty: !fileQuery,
    fileOnly: trimmedQuery.startsWith('#'),
    file: fileQuery,
    name: normalizeDirectoryName(trimmedQuery),
    // Letters must not disappear and turn e.g. "abc12" into a phone query "12".
    phone: /^\+?[\d\s().-]+$/.test(trimmedQuery) ? normalizePhone(trimmedQuery) : '',
  };
};

/** Normalize record fields once per data update, not on every key or sort comparison. */
export const createPatientDirectoryIndex = <T extends DirectoryPatient>(patients: readonly T[]): PatientDirectoryEntry<T>[] =>
  patients.map((patient, index) => ({ patient, index, file: normalizeFile(patient.id || ''),
    name: normalizeDirectoryName(patient.name || ''), phone: normalizePhone(patient.mobile || patient.phone || '') }));

const indexedMatchScore = <T extends DirectoryPatient>(entry: PatientDirectoryEntry<T>, query: ReturnType<typeof prepareDirectoryQuery>): number => {
  if (query.empty) return 1;
  const { file: id, name, phone: mobile } = entry;
  const { file: fileQuery, name: nameQuery, phone: phoneQuery } = query;

  if (id === fileQuery) return 100;
  if (id.startsWith(fileQuery)) return 90;
  if (query.fileOnly) return id.includes(fileQuery) ? 50 : 0;

  if (nameQuery && name === nameQuery) return 85;
  if (nameQuery && name.startsWith(nameQuery)) return 80;

  if (phoneQuery && mobile === phoneQuery) return 75;
  if (phoneQuery && mobile.includes(phoneQuery)) return 70;

  if (nameQuery && name.includes(nameQuery)) return 60;
  if (id.includes(fileQuery)) return 50;
  return 0;
};

/** Rank file numbers first; # limits the search to file numbers only. */
export const getPatientMatchScore = (patient: DirectoryPatient, query: string): number =>
  indexedMatchScore(createPatientDirectoryIndex([patient])[0], prepareDirectoryQuery(query));

const rankDirectoryEntries = <T extends DirectoryPatient>(
  index: readonly PatientDirectoryEntry<T>[],
  query: string,
  sortOrder: PatientDirectorySort,
  matchesOnly: boolean,
  include?: (patient: T) => boolean,
): T[] => {
  const preparedQuery = prepareDirectoryQuery(query);
  const hasQuery = Boolean(query.trim());
  const ranked = [];
  for (const entry of index) {
    if (include && !include(entry.patient)) continue;
    const score = hasQuery ? indexedMatchScore(entry, preparedQuery) : 1;
    if (!matchesOnly || score > 0) ranked.push({ entry, score });
  }
  const compareFiles = (left: PatientDirectoryEntry<T>, right: PatientDirectoryEntry<T>) => directoryCollator.compare(left.file, right.file);
  const compareNames = (left: PatientDirectoryEntry<T>, right: PatientDirectoryEntry<T>) => directoryCollator.compare(left.name, right.name);
  return ranked
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score;
      const primary = sortOrder === 'name'
        ? compareNames(left.entry, right.entry)
        : compareFiles(left.entry, right.entry) * (sortOrder === 'fileDesc' ? -1 : 1);
      if (primary) return primary;
      const secondary = sortOrder === 'name' ? compareFiles(left.entry, right.entry) : compareNames(left.entry, right.entry);
      return secondary || left.entry.index - right.entry.index;
    })
    .map(item => item.entry.patient);
};

/** Search and rank in one pass; each matching score is calculated only once. */
export const searchPatientDirectory = <T extends DirectoryPatient>(
  index: readonly PatientDirectoryEntry<T>[], query: string, sortOrder: PatientDirectorySort,
  include?: (patient: T) => boolean,
): T[] => rankDirectoryEntries(index, query, sortOrder, true, include);

/** Sort a copy without filtering or mutating patient records. */
export const sortDirectoryPatients = <T extends DirectoryPatient>(
  patients: readonly T[], query: string, sortOrder: PatientDirectorySort,
): T[] => rankDirectoryEntries(createPatientDirectoryIndex(patients), query, sortOrder, false);
