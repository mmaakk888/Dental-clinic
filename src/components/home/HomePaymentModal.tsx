import React, { useDeferredValue, useMemo, useState, useRef } from 'react';
import { Banknote, Search, X } from 'lucide-react';
import { Patient } from '../../types';
import { getPatientFinancialSummary } from '../../utils/financials';
import { paymentSessionRemaining as remainingFor, validateHomePayment } from '../../utils/homePayment';
import { buildHomePatientSearch, searchHomePatients } from '../../utils/homePatientSearch';
import { localDateISO } from '../appointments/appointmentScheduling';
import { useAppointmentDialog } from '../appointments/useAppointmentDialog';
import { useToastAndConfirm } from '../common/ToastAndConfirm';
import '../common/ActionDialog.css';

interface Props {
  patients: Patient[];
  showRemaining: boolean;
  onClose: () => void;
  onSave: (patientId: string, sessionId: string, installment: { amount: number; date: string }) => void | Promise<void>;
  onOpenPatient: (patientId: string) => void;
}

const amountFormat = new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 });
const money = (value: number) => amountFormat.format(value) + ' ج.م';

export function HomePaymentModal({ patients, showRemaining, onClose, onSave, onOpenPatient }: Props) {
  const { showToast } = useToastAndConfirm();
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [patientId, setPatientId] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const closeDialog = () => { if (!savingRef.current) onClose(); };
  const dialogRef = useAppointmentDialog(true, closeDialog);
  const patient = useMemo(() => patients.find(item => item.id === patientId), [patients, patientId]);
  const sessions = patient?.sessions.filter(item => remainingFor(item) > 0) || [];
  const searchIndex = useMemo(() => buildHomePatientSearch(patients), [patients]);
  const results = useMemo(() => searchHomePatients(searchIndex, deferredQuery, 20, true), [searchIndex, deferredQuery]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (savingRef.current) return;
    const session = patient?.sessions.find(item => item.id === sessionId);
    const value = Number(amount);
    const validation = validateHomePayment(patient, sessionId, value);
    if (!patient || !session || (!validation.valid && validation.reason === 'selection')) { showToast('اختر المريض والخدمة المطلوب سدادها.', 'warning'); return; }
    if (!validation.valid && validation.reason === 'amount') { showToast('أدخل مبلغًا صحيحًا أكبر من صفر.', 'warning'); return; }
    if (!validation.valid) {
      showToast(showRemaining ? `المبلغ أكبر من المستحق (${money(validation.maximum)}).` : 'المبلغ أكبر من المستحق. راجع الطبيب قبل تسجيله.', 'warning');
      return;
    }
    savingRef.current = true; setSaving(true);
    try {
      await onSave(patient.id, session.id, { amount: value, date: localDateISO() });
      showToast('تم تسجيل الدفعة ضمن تحصيل اليوم.', 'success');
      onClose();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذّر حفظ الدفعة.', 'error');
    } finally { savingRef.current = false; setSaving(false); }
  };

  return <div className="clinic-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-3 sm:p-6" dir="rtl">
    <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="home-payment-title" tabIndex={-1}
      data-action-tone="emerald" aria-busy={saving}
      className="clinic-modal-panel clinic-modal-panel--framed clinic-action-dialog w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl flex flex-col">
      <div className="clinic-action-header">
        <div className="clinic-action-heading"><span className="clinic-action-symbol"><Banknote aria-hidden="true" /></span>
          <div><h2 id="home-payment-title">تسجيل دفعة</h2><p>سداد خدمة سابقة، بدون إنشاء زيارة أو رسوم كشف.</p></div></div>
        <button type="button" aria-label="إغلاق تسجيل الدفعة" disabled={saving} onClick={closeDialog} className="clinic-action-close"><X aria-hidden="true" /></button>
      </div>
      <form id="home-payment-form" onSubmit={submit} className="min-h-0 overflow-y-auto p-4 sm:p-6 space-y-5"><fieldset disabled={saving} className="contents">
        <div className="space-y-2">
          <label htmlFor="home-payment-search" className="block font-bold text-slate-800">١. المريض</label>
          {patient ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 flex flex-wrap items-center justify-between gap-3">
            <div><strong className="block text-lg text-slate-950">{patient.name}</strong><span className="text-sm text-slate-600">ملف <bdi>#{patient.id}</bdi>{showRemaining ? ` · المتبقي ${money(getPatientFinancialSummary(patient).totalRemaining)}` : ''}</span></div>
            <button type="button" onClick={() => { setPatientId(''); setSessionId(''); setAmount(''); }} className="rounded-lg bg-white px-3 py-2 text-sm font-bold text-emerald-800 min-h-[44px]">تغيير المريض</button>
          </div> : <>
            <div className="relative"><Search aria-hidden="true" className="absolute start-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
              <input id="home-payment-search" data-dialog-autofocus value={query} onChange={event => setQuery(event.target.value)} autoComplete="off"
                placeholder="رقم الملف أو اسم المريض أو الهاتف" className="w-full min-h-[52px] rounded-xl border border-slate-300 bg-white ps-11 pe-3 text-base" /></div>
            <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-100" aria-busy={query !== deferredQuery}>
              {results.map(item => <button key={item.id} type="button" className="w-full flex items-center gap-3 p-3 text-start hover:bg-slate-50 min-h-[56px]"
                onClick={() => { setPatientId(item.id); setSessionId(item.sessions.find(session => remainingFor(session) > 0)?.id || ''); setAmount(''); }}>
                <span className="rounded-lg bg-slate-100 px-3 py-2 font-bold text-slate-700"><bdi>#{item.id}</bdi></span>
                <span className="min-w-0"><strong className="block text-base text-slate-900">{item.name}</strong><small className="text-sm text-slate-500"><bdi>{item.mobile || 'بدون هاتف'}</bdi></small></span>
              </button>)}
              {!results.length && <p className="p-4 text-slate-500">لا يوجد ملف مطابق للبحث.</p>}
            </div>
            {results.length === 20 && <p className="text-sm text-slate-500">أول ٢٠ نتيجة. اكتب رقم الملف أو الاسم لتحديد المريض.</p>}
          </>}
        </div>
        {patient && <div className="space-y-2">
          <label htmlFor="home-payment-session" className="block font-bold text-slate-800">٢. الخدمة المطلوب سدادها</label>
          {sessions.length ? <select id="home-payment-session" value={sessionId} onChange={event => { setSessionId(event.target.value); setAmount(''); }} required
            className="w-full min-h-[52px] rounded-xl border border-slate-300 bg-white px-3 text-base">
            <option value="">اختر الخدمة</option>{sessions.map(session => <option key={session.id} value={session.id}>{session.type} · {session.date}{showRemaining ? ` · متبقي ${money(remainingFor(session))}` : ''}</option>)}
          </select> : <div className="rounded-xl bg-slate-50 p-4 text-slate-600"><p>لا توجد خدمة بمبلغ مستحق للتحصيل.</p>
            <button type="button" className="mt-2 min-h-[44px] font-bold text-indigo-700" onClick={() => { onOpenPatient(patient.id); onClose(); }}>فتح ملف المريض</button></div>}
        </div>}
        <div className="space-y-2"><label htmlFor="home-payment-amount" className="block font-bold text-slate-800">٣. المبلغ المحصّل الآن (ج.م)</label>
          <input id="home-payment-amount" type="number" min="0.01" step="0.01" required disabled={!patient || !sessionId} value={amount} onChange={event => setAmount(event.target.value)} inputMode="decimal" placeholder="0.00"
            className="w-full min-h-[56px] rounded-xl border border-slate-300 bg-white px-4 text-xl font-bold" />
          <p className="text-sm text-slate-500">تحصيل نقدي بتاريخ {localDateISO()}، ويُضاف مرة واحدة إلى حساب المريض وتحصيل اليوم.</p>
        </div>
      </fieldset></form>
      <div className="clinic-action-footer">
        <button type="button" onClick={closeDialog} disabled={saving} className="clinic-action-cancel">إلغاء وإغلاق</button>
        <button type="submit" form="home-payment-form" disabled={!patient || !sessionId || saving} className="clinic-action-primary">{saving ? 'جارٍ التسجيل…' : 'حفظ الدفعة'}</button>
      </div>
    </section>
  </div>;
}
