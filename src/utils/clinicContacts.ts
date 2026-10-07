import type { ClinicContact, Patient } from '../types';
import { normalizeDirectoryDigits } from './patientDirectory';
import { cleanEgyptianPhone } from './whatsappUtils';

export const CONTACT_NAME_MAX_LENGTH = 200;
export const CONTACT_MOBILE_MAX_LENGTH = 60;
export const CONTACT_NOTES_MAX_LENGTH = 2000;

/** Equivalent phone formats only; no edit-distance or partial-number matches. */
export function normalizeContactPhone(value: string): string {
  if (typeof value !== 'string' || value.length > CONTACT_MOBILE_MAX_LENGTH || /[\u0000-\u001f\u007f]/.test(value)) return '';
  const formatted = normalizeDirectoryDigits(value).trim();
  // Do not silently turn an arbitrary label/extension into somebody's phone.
  if (!/^\+?[\d ().-]+$/.test(formatted)) return '';
  const digits = formatted.replace(/\D/g, '');
  if (digits.startsWith('01') && !/^01\d{9}$/.test(digits)) return '';
  const phone = cleanEgyptianPhone(formatted);
  if (!/^[1-9]\d{7,14}$/.test(phone)) return '';
  // Egyptian contacts are mobile numbers; do not accept truncated local numbers.
  if (phone.startsWith('20') && !/^201\d{9}$/.test(phone)) return '';
  return phone;
}

export function normalizeContactSearch(value: string): string {
  return normalizeDirectoryDigits(value.normalize('NFKC'))
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '').replace(/ـ/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/[ىی]/g, 'ي').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Search may use a phone fragment; linking to files still requires a full match. */
export function contactMatchesSearch(contact: ClinicContact, query: string): boolean {
  const text = normalizeContactSearch(query);
  if (!text || normalizeContactSearch(contact.name).includes(text)) return true;
  const formatted = normalizeDirectoryDigits(query).trim();
  if (!/^\+?[\d ().-]+$/.test(formatted)) return false;
  const phone = normalizeContactPhone(contact.mobile);
  const digits = formatted.replace(/\D/g, '');
  const normalizedQuery = normalizeContactPhone(formatted);
  return Boolean(phone && digits && (phone.includes(normalizedQuery || digits)
    || phone.startsWith('201') && `0${phone.slice(2)}`.includes(digits)));
}

export function findPatientsByPhone(patients: readonly Patient[], phone: string): Patient[] {
  const normalized = normalizeContactPhone(phone);
  if (!normalized) return [];
  // Several files may legitimately share a family phone. Never select/merge one.
  return patients.filter(patient => normalizeContactPhone(patient.mobile) === normalized);
}

export function clinicContactValidationError(input: unknown): string | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'بيانات جهة الاتصال غير صالحة.';
  const contact = input as ClinicContact;
  if (typeof contact.id !== 'string' || !contact.id.trim() || contact.id.length > 200 || /[\u0000-\u0020\u007f]/.test(contact.id)) return 'معرّف جهة الاتصال غير صالح.';
  if (typeof contact.name !== 'string' || !contact.name.trim() || contact.name.length > CONTACT_NAME_MAX_LENGTH
    || /[\u0000-\u001f\u007f]/.test(contact.name)) return 'أدخل اسمًا صحيحًا لا يتجاوز ٢٠٠ حرف.';
  if (!normalizeContactPhone(contact.mobile)) return 'أدخل رقم موبايل صحيحًا؛ مثل 01012345678 أو +201012345678.';
  if (contact.notes !== undefined && (typeof contact.notes !== 'string' || contact.notes.length > CONTACT_NOTES_MAX_LENGTH
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(contact.notes))) return 'الملاحظات لا تتجاوز ٢٠٠٠ حرف.';
  if (typeof contact.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(contact.createdAt)
    || !Number.isFinite(Date.parse(contact.createdAt))
    || new Date(contact.createdAt).toISOString().slice(0, 19) !== contact.createdAt.slice(0, 19)) return 'تاريخ إضافة جهة الاتصال غير صالح.';
  return null;
}

function requireUnchangedContact(contacts: readonly ClinicContact[], original: ClinicContact): ClinicContact {
  const latest = contacts.find(contact => contact.id === original.id);
  if (!latest || JSON.stringify(latest) !== JSON.stringify(original)) {
    throw new Error('جهة الاتصال تغيّرت أو حُذفت من تبويب آخر. أعد فتحها قبل الحفظ أو الحذف.');
  }
  return latest;
}

/** Pure mutation: caller reads fresh state under the clinic lock and confirms persistence. */
export function saveClinicContact(contacts: readonly ClinicContact[], input: ClinicContact, original?: ClinicContact): ClinicContact[] {
  const error = clinicContactValidationError(input);
  if (error) throw new Error(error);
  const phone = normalizeContactPhone(input.mobile);
  if (original !== undefined) {
    if (original.id !== input.id) throw new Error('لا يمكن تغيير معرّف جهة الاتصال.');
    const latest = requireUnchangedContact(contacts, original);
    if (contacts.some(contact => contact.id !== latest.id && normalizeContactPhone(contact.mobile) === phone)) {
      throw new Error('الرقم موجود بالفعل في جهات الاتصال؛ ابحث عنه بدل إضافته مرتين.');
    }
    return contacts.map(contact => contact.id === latest.id ? { ...latest,
      name: input.name.trim().replace(/\s+/g, ' '), mobile: input.mobile.trim(), notes: input.notes?.trim() ?? '' } : contact);
  }
  if (contacts.some(contact => contact.id === input.id)) throw new Error('معرّف جهة الاتصال مستخدم بالفعل. أعد محاولة الإضافة.');
  if (contacts.some(contact => normalizeContactPhone(contact.mobile) === phone)) {
    throw new Error('الرقم موجود بالفعل في جهات الاتصال؛ ابحث عنه بدل إضافته مرتين.');
  }
  return [{ id: input.id, name: input.name.trim().replace(/\s+/g, ' '), mobile: input.mobile.trim(),
    notes: input.notes?.trim() ?? '', createdAt: input.createdAt }, ...contacts];
}

export function deleteClinicContact(contacts: readonly ClinicContact[], original: ClinicContact): ClinicContact[] {
  requireUnchangedContact(contacts, original);
  return contacts.filter(contact => contact.id !== original.id);
}
