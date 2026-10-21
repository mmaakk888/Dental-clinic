import type {Patient, Session} from '../types';
import {getIndependentGeneralPayments, getSessionCollected} from './financials';

/** Stable numbering shared by sessions, collections and prescriptions, not the filtered display index. */
export function patientSessionTimeline(sessions: readonly Session[]) {
  const sorted = [...sessions].sort((a,b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || '') || (a.createdAt || '').localeCompare(b.createdAt || '') || a.id.localeCompare(b.id));
  return sorted.map((session,index) => ({session,number:index + 1}));
}
export interface PatientReceiptRow {id: string; date: string; amount: number; scope: 'session'|'account'; title: string; sessionId?: string; sessionNumber?: number; voided: boolean; historical: boolean}
/** A receipt is shown once. General cash is not silently reassigned to a service. */
export function patientReceiptTimeline(patient: Patient): PatientReceiptRow[] {
  const rows: PatientReceiptRow[] = [];
  for (const {session,number} of patientSessionTimeline(patient.sessions)) {
    const logs = session.paymentsLog || [];
    for (const payment of logs) rows.push({id:payment.id,date:payment.date,amount:payment.amount,scope:'session',title:session.type,sessionId:session.id,sessionNumber:number,voided:!!payment.voidedAt,historical:false});
    const opening = logs.length ? session.legacyOpeningPaid || 0 : getSessionCollected(session);
    if (opening > 0) rows.push({id:`opening:${session.id}`,date:session.payDate || session.date,amount:opening,scope:'session',title:session.type,sessionId:session.id,sessionNumber:number,voided:false,historical:true});
  }
  for (const payment of getIndependentGeneralPayments(patient)) rows.push({id:payment.id,date:payment.date,amount:payment.amount,scope:'account',title:'دفعة عامة على حساب المريض',voided:false,historical:false});
  const directIds = new Set(rows.map(r=>r.id));
  for (const payment of patient.payments || []) if (payment.voidedAt && !payment.legacyAggregate && !directIds.has(payment.id) && !payment.linkedSessionId) rows.push({id:payment.id,date:payment.date,amount:payment.amount,scope:'account',title:'دفعة عامة على حساب المريض',voided:true,historical:false});
  return rows.sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id));
}
