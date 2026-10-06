import React, { useMemo, useState } from 'react';
import { Banknote, Search, X } from 'lucide-react';
import { Patient } from '../../types';
import { getPatientFinancialSummary } from '../../utils/financials';
import { normalizePaymentSearch as normalize, paymentSessionRemaining as remainingFor, validateHomePayment } from '../../utils/homePayment';
import { localDateISO } from '../appointments/appointmentScheduling';
import { useAppointmentDialog } from '../appointments/useAppointmentDialog';
import { useToastAndConfirm } from '../common/ToastAndConfirm';

interface Props {
  patients: Patient[];
  showRemaining: boolean;
  onClose: () => void;
  onSave: (patientId: string, sessionId: string, installment: { amount: number; date: string }) => void;
  onOpenPatient: (patientId: string) => void;
}

const money = (value: number) => new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 }).format(value) + ' ج.م';

export function HomePaymentModal({ patients, showRemaining, onClose, onSave, onOpenPatient }: Props) {
  const { showToast } = useToastAndConfirm();
  const dialogRef = useAppointmentDialog(true, onClose);
  const [query, setQuery] = useState('');
  const [patientId, setPatientId] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);
  const patient = patients.find(item => item.id === patientId);
  const sessions = patient?.sessions.filter(item => remainingFor(item) > 0) || [];
  const results = useMemo(() => {
    const text = normalize(query);
    return patients.filter(item => !text || [item.id, item.name, item.mobile || ''].some(value => normalize(value).includes(text))).slice(0, 20);
  }, [patients, query]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const session = patient?.sessions.find(item => item.id === sessionId);
    const value = Number(amount);
    const validation = validateHomePayment(patient, sessionId, value);
    if (!patient || !session || (!validation.valid && validation.reason === 'selection')) { showToast('اختر المريض والخدمة المطلوب سدادها.', 'warning'); return; }
    if (!validation.valid && validation.reason === 'amount') { showToast('أدخل مبلغًا صحيحًا أكبر من صفر.', 'warning'); return; }
    if (!validation.valid) {
      showToast(showRemaining ? `المبلغ أكبر من المستحق (${money(validation.maximum)}).` : 'المبلغ أكبر من المستحق. راجع الطبيب قبل تسجيله.', 'warning');
      return;
    }
    setSaving(true);
    try {
      onSave(patient.id, session.id, { amount: value, date: localDateISO() });
      showToast('تم تسجيل الدفعة ضمن تحصيل اليوم.', 'success');
      onClose();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذّر حفظ الدفعة.', 'error');
      setSaving(false);
    }
  };

  return <div className="clinic-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-3 sm:p-6" dir="rtl">
    <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="home-payment-title" tabIndex={-1}
      className="clinic-modal-panel w-full max-w-xl max-h-[90dvh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 shadow-xl space-y-5">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div className="flex items-center gap-3"><span className="grid h-12 w-12 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><Banknote aria-hidden="true" /></span>
          <div><h2 id="home-payment-title" className="text-xl font-extrabold text-slate-950">تسجيل دفعة</h2><p className="text-sm text-slate-500">اختَر المريض والخدمة، ثم سجل المبلغ المحصّل.</p></div></div>
        <button type="button" aria-label="إغلاق تسجيل الدفعة" onClick={onClose} className="grid min-h-[44px] min-w-[44px] place-items-center rounded-xl bg-slate-100 text-slate-600"><X aria-hidden="true" /></button>
      </div>
      <form onSubmit={submit} className="space-y-5">
        <div className="space-y-2">
          <label htmlFor="home-payment-search" className="block font-bold text-slate-800">١. المريض</label>
          {patient ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 flex flex-wrap items-center justify-between gap-3">
            <div><strong className="block text-lg text-slate-950">{patient.name}</strong><span className="text-sm text-slate-600">ملف <bdi>#{patient.id}</bdi>{showRemaining ? ` · المتبقي ${money(getPatientFinancialSummary(patient).totalRemaining)}` : ''}</span></div>
            <button type="button" onClick={() => { setPatientId(''); setSessionId(''); setAmount(''); }} className="rounded-lg bg-white px-3 py-2 text-sm font-bold text-emerald-800 min-h-[44px]">تغيير المريض</button>
          </div> : <>
            <div className="relative"><Search aria-hidden="true" className="absolute start-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
              <input id="home-payment-search" data-dialog-autofocus value={query} onChange={event => setQuery(event.target.value)} autoComplete="off"
                placeholder="رقم الملف أو اسم المريض أو الهاتف" className="w-full min-h-[52px] rounded-xl border border-slate-300 bg-white ps-11 pe-3 text-base" /></div>
            <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-100">
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
          <input id="home-payment-amount" type="number" min="0.01" step="0.01" required value={amount} onChange={event => setAmount(event.target.value)} inputMode="decimal" placeholder="0.00"
            className="w-full min-h-[56px] rounded-xl border border-slate-300 bg-white px-4 text-xl font-bold" />
          <p className="text-sm text-slate-500">تحصيل نقدي بتاريخ {localDateISO()}، ويُضاف مرة واحدة إلى حساب المريض وتحصيل اليوم.</p>
        </div>
        <div className="flex flex-wrap justify-end gap-3 border-t border-slate-100 pt-4">
          <button type="button" onClick={onClose} className="min-h-[48px] rounded-xl bg-slate-100 px-5 font-bold text-slate-600">إلغاء</button>
          <button type="submit" disabled={!patient || !sessionId || saving} className="min-h-[48px] rounded-xl bg-emerald-700 px-5 font-bold text-white disabled:opacity-40 disabled:cursor-not-allowed">{saving ? 'جارٍ التسجيل…' : 'حفظ الدفعة'}</button>
        </div>
      </form>
    </section>
  </div>;
}
