import type { Lab, LabCase, Session } from '../types';
import type { ClinicDomainData } from './storage';
import type { ServiceCatalogValues } from './serviceCatalog';
import { normalizeServiceName, parseCatalogPrice } from './serviceCatalog';
import type { ProstheticKind, ProstheticRoutingSettings } from './prostheticRouting';
import { resolveProstheticLab } from './prostheticRouting';
import { isValidAppointmentDate } from '../components/appointments/appointmentScheduling';
import { getToothLabel, parseCompositeToothId } from './toothUtils';
import { getSessionCollected } from './financials';

export interface ProstheticOrderInput {
  operationId: string;
  patientId: string;
  kind: ProstheticKind;
  material: string;
  units: number;
  teethIds: string[];
  date: string;
  expectedUnitPrice: number;
  examinationFee: number;
  paid: number;
  note?: string;
  deliveryExpectedDate?: string;
}
const cents = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function getPatientProstheticPrice(material: string, catalog: Pick<ServiceCatalogValues, 'crownPrices'>): number | undefined {
  const names = Object.keys(catalog.crownPrices).filter(name => normalizeServiceName(name) === normalizeServiceName(material));
  if (names.length !== 1 || !parseCatalogPrice(catalog.crownPrices[names[0]]).valid) return undefined;
  return catalog.crownPrices[names[0]];
}

export function validateProstheticOrder(input: ProstheticOrderInput): void {
  if (!input || typeof input !== 'object' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input.operationId)
    || typeof input.patientId !== 'string' || !input.patientId.trim() || input.patientId.length > 200
    || !['fixed', 'removable'].includes(input.kind) || typeof input.material !== 'string' || !normalizeServiceName(input.material)
    || input.material.length > 160 || /[\p{Cc}\u2028\u2029]/u.test(input.material)
    || !Number.isInteger(input.units) || input.units < 1 || input.units > 100) throw new Error('راجع نوع التركيبة والخامة وعدد الوحدات وملف المريض.');
  if (![input.expectedUnitPrice, input.examinationFee, input.paid].every(value => typeof value === 'number' && parseCatalogPrice(value).valid)) throw new Error('راجع سعر المريض والكشف والمبلغ المحصّل.');
  if (!isValidAppointmentDate(input.date) || (input.deliveryExpectedDate && (!isValidAppointmentDate(input.deliveryExpectedDate) || input.deliveryExpectedDate < input.date))) throw new Error('راجع تاريخ التسجيل والاستلام المتوقع.');
  if (!Array.isArray(input.teethIds) || input.teethIds.length > 32 || input.teethIds.some(id => !parseCompositeToothId(id)) || new Set(input.teethIds).size !== input.teethIds.length) throw new Error('حدد مواضع أسنان صحيحة دون تكرار.');
  if (input.kind === 'fixed' && input.teethIds.length && input.teethIds.length !== input.units) throw new Error('عدد المواضع المحددة يجب أن يساوي عدد الكراونات، أو اترك المواضع بدون تحديد مؤقتًا.');
  if (input.note !== undefined && (typeof input.note !== 'string' || input.note.length > 2000 || /[\p{Cc}\u2028\u2029]/u.test(input.note.replace(/[\r\n]/g, '')))) throw new Error('راجع ملاحظات التركيبة؛ الحد الأقصى ٢٠٠٠ حرف.');
  const total = cents(input.expectedUnitPrice * input.units + input.examinationFee);
  if (total > 1_000_000_000 || input.paid > total) throw new Error('المبلغ المحصّل أكبر من إجمالي حساب التركيبة والكشف.');
}

/** Prepare both linked records together under the caller's same-origin write lock.
 * Storage confirms both keys with rollback attempts, not a cloud/ACID transaction. */
export function createProstheticOrder(domain: ClinicDomainData, input: ProstheticOrderInput, settings: ProstheticRoutingSettings,
  labs: readonly Lab[], catalog: ServiceCatalogValues): ClinicDomainData {
  validateProstheticOrder(input);
  const sessionId = `prosthetic_session_${input.operationId}`, caseId = `prosthetic_case_${input.operationId}`;
  const fingerprint = JSON.stringify({ patientId: input.patientId, kind: input.kind, material: input.material, units: input.units,
    teethIds: [...input.teethIds].sort(), date: input.date, unitPrice: input.expectedUnitPrice, examinationFee: input.examinationFee,
    paid: input.paid, note: input.note?.trim() || '', deliveryExpectedDate: input.deliveryExpectedDate || '' });
  const oldCases = domain.labCases.filter(item => item.id === caseId);
  const oldCase = oldCases[0];
  const oldSessions = domain.patients.flatMap(patient => patient.sessions.filter(session => session.id === sessionId).map(session => ({ patient, session })));
  if (oldCase || oldSessions.length) {
    if (oldCases.length === 1 && oldCase?.creationFingerprint === fingerprint && oldCase.linkedSessionId === sessionId && oldCase.patientId === input.patientId
      && oldSessions.length === 1 && oldSessions[0].patient.id === input.patientId
      && !domain.labCases.some(item => item.id !== caseId && item.linkedSessionId === sessionId && item.patientId === input.patientId)) return domain;
    throw new Error('معرّف التسجيل مستخدم بالفعل أو ارتباطه غير مكتمل. راجع الحالة الموجودة؛ لم يتكرر الحساب.');
  }
  const patient = domain.patients.find(item => item.id === input.patientId);
  if (!patient) throw new Error('ملف المريض غير موجود. أعد اختيار الملف.');
  const unitPrice = getPatientProstheticPrice(input.material, catalog);
  if (unitPrice === undefined || unitPrice !== input.expectedUnitPrice) throw new Error('تغيّر سعر بيع التركيبة أو لم يُضبط. راجع السعر من الإعدادات وأعد فتح التسجيل.');
  const { lab, service } = resolveProstheticLab(settings, labs, input.kind, input.material);
  if (!parseCatalogPrice(service.price).valid) throw new Error('إعداد تكلفة هذه التركيبة غير صالح. اطلب من الطبيب مراجعة أسعار المعمل.');
  const treatmentFee = cents(unitPrice * input.units), total = cents(treatmentFee + input.examinationFee), labTotal = cents(service.price * input.units);
  const type = input.kind === 'fixed' ? 'تركيبات - ثابتة' : 'تركيبات - متحركة';
  const name = `${type} · ${input.material} (${input.units} ${input.kind === 'fixed' ? 'كراون' : 'وحدة'})`;
  const session: Session = { id: sessionId, type: name, tooth: input.teethIds.length === 1 ? input.teethIds[0] : null,
    ...(input.teethIds.length ? { teethIds: [...input.teethIds], toothLabel: input.teethIds.map(getToothLabel).join('، ') } : {}),
    amount: total, paid: input.paid, remain: cents(total - input.paid), date: input.date, payDate: input.date,
    paymentsLog: input.paid > 0 ? [{ id: `prosthetic_receipt_${input.operationId}`, amount: input.paid, date: input.date, paymentMethod: 'cash', createdAt: new Date().toISOString() }] : [],
    services: [{ id: `prosthetic_item_${input.operationId}`, name, price: treatmentFee, ...(input.teethIds.length === 1 ? { tooth: input.teethIds[0] } : {}) }],
    examinationFee: input.examinationFee, treatmentFee, paymentMethod: 'cash', visitStatus: 'follow_up', treatmentStage: 'first',
    visitNotes: input.note?.trim() || undefined,
    prosthetic: { kind: input.kind, material: input.material, units: input.units, unitPrice },
  };
  const labCase: LabCase = { id: caseId, linkedSessionId: sessionId, labId: lab.id, labName: lab.name, labServiceId: service.id,
    patientId: patient.id, patientName: patient.name, fileNo: patient.id, type: input.kind === 'fixed' ? 'ثابت' : 'متحرك', subType: input.material,
    units: input.units, unitLabel: service.unitLabel, labTotal, labPaid: 0, patientTotal: total, patientPaid: input.paid, date: input.date,
    deliveryExpectedDate: input.deliveryExpectedDate || undefined, note: input.note?.trim() || undefined, status: 'pending', paymentsLog: [],
    creationFingerprint: fingerprint, ...(input.teethIds.length ? { teethIds: [...input.teethIds] } : {}),
  };
  return { ...domain, patients: domain.patients.map(item => item.id === patient.id ? { ...item, sessions: [session, ...item.sessions] } : item),
    labCases: [labCase, ...domain.labCases] };
}

/** Existing clinical charges are linked, never billed again or paid from a stale case snapshot. */
export function getLinkedPatientAccount(item: LabCase, domain: Pick<ClinicDomainData, 'patients'>) {
  const session = domain.patients.find(patient => patient.id === item.patientId)?.sessions.find(record => record.id === item.linkedSessionId);
  if (!session) return null;
  const total = Math.max(0, session.amount - (session.discount || 0));
  const paid = getSessionCollected(session);
  return { total, paid, remaining: Math.max(0, total - paid), session };
}
