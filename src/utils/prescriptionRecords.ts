import type {PrescriptionDraft} from '../types';
/** Compare clinical content, not server-issued item identifiers. */
export function prescriptionDraftSignature(value:PrescriptionDraft):string {
  return JSON.stringify([value.date,value.sessionId||null,value.diagnosis,value.items.map(i=>[i.drugName,i.dosage,i.duration||'']),value.instructions,
    ['doctorTitle','doctorName','doctorEnglish','specialty1','specialty2','phone','address'].map(k=>value.header[k as keyof typeof value.header]||'')]);
}
