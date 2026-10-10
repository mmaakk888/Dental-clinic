import type { Appointment, Patient, Session } from '../types';
import type { ClinicDomainData } from './storage';
import { appendSessionReceipt, financialMoneyCents } from './financials';
import { getPatientSessionReceiptLimit } from './patientCollection';
import { appointmentTimeMinutes, isValidAppointmentDate } from '../components/appointments/appointmentScheduling';

const patientDetailFields = ['name', 'mobile', 'age', 'gender', 'firstVisit', 'notes', 'allergy'] as const;
const appointmentFormFields = ['patientId', 'date', 'time', 'durationMinutes', 'appointmentType', 'doctorName', 'note', 'isFollowUp', 'isWalkIn'] as const;

export function canonicalFileNumber(value: string): string {
  return value.trim().replace(/[٠-٩۰-۹]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.includes(digit)
    ? '٠١٢٣٤٥٦٧٨٩'.indexOf(digit) : '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));
}

export function savePatientRecord(patients: Patient[], data: Omit<Patient, 'sessions' | 'payments'>, originalId?: string, baseline?: Patient): Patient[] {
  // Runtime callbacks may pass a complete, stale Patient despite the Omit type.
  // A demographic edit must never write its old financial arrays over fresh data.
  const { sessions: _sessions, payments: _payments, ...details } = data as Patient;
  const id = canonicalFileNumber(data.id);
  if (!id || !data.name?.trim()) throw new Error('أدخل رقم الملف واسم المريض.');
  const index = patients.findIndex(patient => canonicalFileNumber(patient.id) === id);
  if (originalId !== undefined) {
    if (canonicalFileNumber(originalId) !== id || index < 0) throw new Error('الملف المطلوب تعديله غير موجود أو تغيّر رقمه. أعد فتح الملف.');
    if (baseline && (canonicalFileNumber(baseline.id) !== id || patientDetailFields.some(field => baseline[field] !== patients[index][field]))) {
      throw new Error('تغيّرت بيانات المريض أثناء التعديل. أعد فتح نموذج التعديل لمراجعة أحدث البيانات.');
    }
    const changes = Object.fromEntries(patientDetailFields.filter(field => Object.hasOwn(details, field)).map(field => [field, details[field]]));
    return patients.map((patient, position) => position === index ? { ...patient, ...changes, id: patient.id } : patient);
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
    return { ...patient };
  });
  return [...additions, ...patients];
}

/** Remove all appointment aliases together without orphaning a laboratory account. */
export function deletePatientRecord(domain: ClinicDomainData, patientId: string): ClinicDomainData {
  if (domain.labCases.some(item => item.patientId === patientId || item.fileNo === patientId)) {
    throw new Error('الملف مرتبط بشغل معمل. احتفظ به للحفاظ على ارتباط الحسابات وسجل التركيبات.');
  }
  if (!domain.patients.some(patient => patient.id === patientId)) throw new Error('الملف لم يعد موجودًا.');
  return { ...domain,
    patients: domain.patients.filter(patient => patient.id !== patientId),
    appointments: domain.appointments.filter(appointment => appointment.patientId !== patientId && appointment.fileNo !== patientId),
  };
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
  if (!patient || !session) throw new Error('الخدمة المطلوب سدادها غير موجودة.');
  const remaining = getPatientSessionReceiptLimit(patient, session);
  if (!Number.isFinite(receipt.amount) || receipt.amount <= 0) throw new Error('الدفعة أكبر من المستحق الحالي أو غير صالحة. راجع حساب المريض ثم أعد المحاولة.');
  const amount = financialMoneyCents(receipt.amount) / 100;
  if (amount <= 0 || amount > remaining) throw new Error('الدفعة أكبر من المستحق الحالي أو غير صالحة. راجع حساب المريض ثم أعد المحاولة.');
  if (!receipt.id || patient.sessions.some(item => item.paymentsLog?.some(payment => payment.id === receipt.id)) || patient.payments?.some(payment => payment.id === receipt.id)) {
    throw new Error('معرّف إيصال التحصيل مستخدم بالفعل. لم تُسجل دفعة مكررة.');
  }
  return patients.map(record => record.id !== patientId ? record : { ...record,
    sessions: record.sessions.map(item => item.id === sessionId ? appendSessionReceipt(item, { ...receipt, amount }) : item) });
}

/** A scheduling edit must preserve status changes and reminder history from other tabs. */
export function savePatientAppointment(domain: ClinicDomainData, input: Omit<Appointment, 'id'> & { id?: string }, baseline?: Appointment): ClinicDomainData {
  const patient = domain.patients.find(record => record.id === input.patientId);
  if (!patient) throw new Error('اختر ملف مريض موجودًا قبل حجز الموعد.');
  if (!isValidAppointmentDate(input.date) || appointmentTimeMinutes(input.time) === null) throw new Error('اختر تاريخًا ووقتًا صحيحين للموعد.');
  if (input.durationMinutes !== undefined && (!Number.isFinite(input.durationMinutes) || input.durationMinutes <= 0 || input.durationMinutes > 1440)) throw new Error('أدخل مدة موعد صحيحة أكبر من صفر وأقل من يوم.');
  const canonicalData = { ...input, patientName: patient.name, fileNo: patient.id, mobile: patient.mobile };
  if (!input.id) {
    if (baseline) throw new Error('الموعد المطلوب تعديله غير موجود.');
    return { ...domain, appointments: [{ ...canonicalData, id: `a_${crypto.randomUUID()}` } as Appointment, ...domain.appointments] };
  }
  const current = domain.appointments.find(appointment => appointment.id === input.id);
  if (!current) throw new Error('الموعد المطلوب تعديله غير موجود.');
  if (baseline && (baseline.id !== current.id || appointmentFormFields.some(field => baseline[field] !== current[field]))) {
    throw new Error('تغيّرت بيانات الموعد أثناء التعديل. أعد فتحه لمراجعة أحدث البيانات.');
  }
  const scheduleChanges = {
    ...Object.fromEntries(appointmentFormFields.filter(field => Object.hasOwn(input, field)).map(field => [field, input[field]])),
    patientName: patient.name, fileNo: patient.id, mobile: patient.mobile,
  } as Partial<Appointment>;
  return { ...domain, appointments: domain.appointments.map(appointment => appointment.id === current.id
    ? { ...appointment, ...scheduleChanges } as Appointment : appointment) };
}
