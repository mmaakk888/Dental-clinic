import type {PrescriptionDraft} from '../types';
import {normalizePrescriptionDesign} from './prescriptionTemplate';
import {isValidAppointmentDate} from '../components/appointments/appointmentScheduling';

export function validatePrescriptionDraft(value: PrescriptionDraft): void {
  if (!isValidAppointmentDate(value.date)) throw Error('حدد تاريخًا صحيحًا للروشتة.');
  if (!value.items.length || value.items.length > 64) throw Error('أضف الأدوية؛ الحد الأقصى ٦٤ دواء في الروشتة الواحدة.');
  const fields: Array<[unknown,number]> = [[value.diagnosis,4000],[value.instructions,4000],...Object.values(value.header).map(v=>[v,500] as [unknown,number])];
  for (const item of value.items) {if (!item.drugName.trim()) throw Error('راجع أسماء الأدوية قبل حفظ الروشتة أو إخراجها.');fields.push([item.drugName,200],[item.dosage,500],[item.duration||'',200]);}
  if (fields.some(([v,max])=>typeof v!=='string'||Array.from(v).length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v))) throw Error('يوجد نص يتجاوز الحد المسموح؛ اختصره قبل الحفظ أو الطباعة، لم يُحذف أي نص.');
}
/** Compare clinical content, not server-issued item identifiers. */
export function prescriptionDraftSignature(value:PrescriptionDraft):string {
  return JSON.stringify([value.date,value.sessionId||null,value.diagnosis,value.items.map(i=>[i.drugName,i.dosage,i.duration||'']),value.instructions,
    ['doctorTitle','doctorName','doctorEnglish','specialty1','specialty2','phone','address'].map(k=>value.header[k as keyof typeof value.header]||''),normalizePrescriptionDesign(value.design)]);
}
