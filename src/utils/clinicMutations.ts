import type { Appointment, Patient, Session } from '../types';
import type { ClinicDomainData } from './storage';
import { appendSessionReceipt, getSessionCollected } from './financials';

export function canonicalFileNumber(value: string): string {
  return value.trim().replace(/[٠-٩۰-۹]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.includes(digit)
    ? '٠١٢٣٤٥٦٧٨٩'.indexOf(digit) : '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));
}

export function savePatientRecord(patients: Patient[], data: Omit<Patient, 'sessions' | 'payments'>, originalId?: string): Patient[] {
  // Runtime callbacks may pass a complete, stale Patient despite the Omit type.
  // A demographic edit must never write its old financial arrays over fresh data.
  const { sessions: _sessions, payments: _payments, ...details } = data as Patient;
  const id = canonicalFileNumber(data.id);
  if (!id || !data.name?.trim()) throw new Error('أدخل رقم الملف واسم المريض.');
  const index = patients.findIndex(patient => canonicalFileNumber(patient.id) === id);
  if (originalId !== undefined) {
    if (canonicalFileNumber(originalId) !== id || index < 0) throw new Error('الملف المطلوب تعديله غير موجود أو تغيّر رقمه. أعد فتح الملف.');
    return patients.map((patient, position) => position === index ? { ...patient, ...details, id: patient.id } : patient);
  }
  if (index >= 0) throw new Error(`رقم الملف (${id}) مستخدم بالفعل. اختر الملف الموجود أو رقمًا جديدًا.`);
  return [{ ...details, id, sessions: [], payments: [] }, ...patients];
}

/** Imported history is preserved; imports never merge or replace existing files. */
export function importPatientRecords(patients: Patient[], imported: Patient[]): Patient[] {
  const ids = new Set(patients.map(patient => canonicalFileNumber(patient.id)));
  const additions = imported.map(patient => {
    const id = canonicalFileNumber(patient.id);
    if (!id || ids.has(id)) throw new Error(`رقم الملف (${id}) موجود بالفعل؛ لم يبدأ الاستيراد.`);
    ids.add(id);
    return { ...patient, id };
  });
  return [...additions, ...patients];
}

export function addWalkInRecord(domain: ClinicDomainData, patient: {
  isNew: boolean; id: string; name: string; mobile: string; age?: number; gender?: Patient['gender'];
}, session: Session, appointment: Appointment): ClinicDomainData {
  const id = canonicalFileNumber(patient.id);
  const existing = domain.patients.find(record => canonicalFileNumber(record.id) === id);
  if (patient.isNew && existing) throw new Error(`رقم الملف (${id}) مستخدم بالفعل. اختر «مريض موجود» بدل دمج الملفين.`);
  if (!patient.isNew && !existing) throw new Error('ملف المريض لم يعد موجودًا. أعد البحث واختيار الملف.');
  if (!id || !patient.name.trim()) throw new Error('أدخل رقم الملف واسم المريض.');
  const canonicalId = existing?.id ?? id;
  const patients = existing
    ? domain.patients.map(record => record.id === canonicalId ? { ...record, sessions: [session, ...record.sessions] } : record)
    : [{ id, name: patient.name.trim(), mobile: patient.mobile, age: patient.age ?? 0, gender: patient.gender,
      firstVisit: session.date, notes: session.visitNotes ?? '', allergy: '', sessions: [session], payments: [] }, ...domain.patients];
  return { ...domain, patients, appointments: [{ ...appointment, patientId: canonicalId, fileNo: canonicalId,
    patientName: existing?.name ?? patient.name.trim(), mobile: existing?.mobile ?? patient.mobile }, ...domain.appointments] };
}

export function addPatientReceipt(patients: Patient[], patientId: string, sessionId: string,
  receipt: Parameters<typeof appendSessionReceipt>[1]): Patient[] {
  const patient = patients.find(record => record.id === patientId);
  const session = patient?.sessions.find(record => record.id === sessionId);
  if (!session) throw new Error('الخدمة المطلوب سدادها غير موجودة.');
  const remaining = Math.max(0, session.amount - (session.discount ?? 0) - getSessionCollected(session));
  if (!Number.isFinite(receipt.amount) || receipt.amount <= 0 || receipt.amount > remaining) throw new Error('الدفعة أكبر من المستحق الحالي أو غير صالحة. راجع حساب المريض ثم أعد المحاولة.');
  return patients.map(record => record.id !== patientId ? record : { ...record,
    sessions: record.sessions.map(item => item.id === sessionId ? appendSessionReceipt(item, receipt) : item) });
}
