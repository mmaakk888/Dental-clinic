import type { ClinicContact, Patient } from '../types';
import { normalizeDirectoryDigits, normalizeDirectoryName } from './patientDirectory';
import { normalizeContactPhone } from './clinicContacts';

type RegistrationPerson = Pick<Patient, 'id' | 'name' | 'mobile'>;
export interface PatientRegistrationEntry {
  readonly source: 'patient' | 'contact';
  readonly id: string;
  readonly name: string;
  readonly mobile: string;
  readonly normalizedName: string;
  readonly phone: string;
}
export interface PatientRegistrationMatch {
  readonly source: 'patient' | 'contact';
  readonly id: string;
  readonly name: string;
  readonly mobile: string;
  readonly fileNo?: string;
  readonly reason: 'phone' | 'name' | 'phone-and-name';
}

/** Pure suggestion only. The save workflow must re-read files under its lock. */
export function getNextPatientFileNo(patients: readonly Pick<Patient, 'id'>[]): string {
  let maximum = 0n;
  for (const patient of patients) {
    const id = normalizeDirectoryDigits(patient.id).trim();
    if (/^\d+$/.test(id)) {
      const number = BigInt(id);
      if (number > maximum) maximum = number;
    }
  }
  return String(maximum + 1n);
}

/** Cache normalizations once per directory change, never copy clinical fields. */
export function createPatientRegistrationIndex(patients: readonly RegistrationPerson[], contacts: readonly Pick<ClinicContact, 'id' | 'name' | 'mobile'>[]): PatientRegistrationEntry[] {
  return [
    ...patients.map(person => ({ source: 'patient' as const, id: person.id, name: person.name, mobile: person.mobile })),
    ...contacts.map(person => ({ source: 'contact' as const, id: person.id, name: person.name, mobile: person.mobile })),
  ].map(person => ({ source: person.source, id: person.id, name: person.name, mobile: person.mobile,
    normalizedName: normalizeDirectoryName(person.name), phone: normalizeContactPhone(person.mobile) }));
}

function oneEditApart(left: string, right: string): boolean {
  if (Math.abs(left.length - right.length) > 1) return false;
  let first = 0, second = 0, edits = 0;
  while (first < left.length && second < right.length) {
    if (left[first] === right[second]) { first++; second++; continue; }
    if (++edits > 1) return false;
    if (left.length >= right.length) first++;
    if (right.length >= left.length) second++;
  }
  return edits + (first < left.length || second < right.length ? 1 : 0) <= 1;
}

/** Advisory resemblance, not identity inference. Avoid matching a first name alone. */
export function registrationNamesSimilar(left: string, right: string): boolean {
  if (left.length < 6 || right.length < 6) return false;
  const leftWords = left.split(' '), rightWords = right.split(' ');
  if (leftWords.length < 2 || rightWords.length < 2) return false;
  if (left === right || left.startsWith(`${right} `) || right.startsWith(`${left} `)) return true;
  return oneEditApart(left, right);
}

export function findPatientRegistrationMatches(index: readonly PatientRegistrationEntry[], draft: { name: string; mobile: string },
  options: { excludePatientId?: string; limit?: number } = {}): PatientRegistrationMatch[] {
  const phone = normalizeContactPhone(draft.mobile), name = normalizeDirectoryName(draft.name);
  const ranked: { entry: PatientRegistrationEntry; phoneMatch: boolean; nameMatch: boolean }[] = [];
  for (const entry of index) {
    if (entry.source === 'patient' && entry.id === options.excludePatientId) continue;
    const phoneMatch = Boolean(phone && phone === entry.phone), nameMatch = registrationNamesSimilar(name, entry.normalizedName);
    if (phoneMatch || nameMatch) ranked.push({ entry, phoneMatch, nameMatch });
  }
  return ranked.sort((a, b) => Number(b.phoneMatch) - Number(a.phoneMatch) || Number(b.entry.source === 'patient') - Number(a.entry.source === 'patient'))
    .slice(0, Math.max(0, Math.min(options.limit ?? 8, 50)))
    .map(({ entry, phoneMatch, nameMatch }) => ({ source: entry.source, id: entry.id, name: entry.name, mobile: entry.mobile,
      ...(entry.source === 'patient' ? { fileNo: entry.id } : {}), reason: phoneMatch ? nameMatch ? 'phone-and-name' : 'phone' : 'name' }));
}
