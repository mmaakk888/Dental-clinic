import React, { useDeferredValue, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Plus, Stethoscope, Trash2, X } from 'lucide-react';
import type { DrugCatalogItem, Patient, SessionServiceItem } from '../../types';
import { canonicalFileNumber } from '../../utils/clinicMutations';
import { STANDARD_SERVICES_CATALOG } from '../../utils/financials';
import { buildHomePatientSearch, searchHomePatients } from '../../utils/homePatientSearch';
import { nextWalkInFileNumber, validateWalkInAmounts } from '../../utils/walkInDraft';
import { useAppointmentDialog } from '../appointments/useAppointmentDialog';
import { useToastAndConfirm } from '../common/ToastAndConfirm';
import { useConfirmedAction } from '../common/useConfirmedAction';
import '../common/ActionDialog.css';

interface QuickWalkInModalProps {
  isOpen: boolean;
  onClose: () => void;
  patients: Patient[];
  drugCatalog?: DrugCatalogItem[];
  defaultExamFee?: number;
  onSaveWalkInVisit: (data: {
    patient: { isNew: boolean; id: string; name: string; mobile: string; age: number; gender?: string };
    visit: {
      chiefComplaint: string; diagnosis: string; procedurePerformed: string; services?: SessionServiceItem[];
      prescriptionNotes: string; visitNotes: string; visitStatus: 'completed' | 'follow_up';
      examinationFee: number; treatmentFee: number; totalFee: number; paidAmount: number;
      discountAmount?: number; paymentMethod: 'cash' | 'card' | 'transfer'; isPaid: boolean;
    };
  }) => void | Promise<void>;
  onSelectPatientFile?: (patientId: string) => void;
}

const amountFormat = new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 });
const amountText = (value: number) => `${amountFormat.format(value)} ج.م`;

export const QuickWalkInModal: React.FC<QuickWalkInModalProps> = ({ isOpen, onClose, patients, defaultExamFee = 0, onSaveWalkInVisit }) => {
  const { showToast } = useToastAndConfirm();
  const { saving, run } = useConfirmedAction();
  const committingRef = useRef(false);
  const closeDialog = () => { if (!committingRef.current) onClose(); };
  const dialogRef = useAppointmentDialog(isOpen, closeDialog);
  const [patientMode, setPatientMode] = useState<'existing' | 'new'>('existing');
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [selectedId, setSelectedId] = useState('');
  const searchIndex = useMemo(() => buildHomePatientSearch(patients), [patients]);
  const results = useMemo(() => searchHomePatients(searchIndex, deferredQuery, 8, true), [searchIndex, deferredQuery]);
  const selectedPatient = useMemo(() => patients.find(item => item.id === selectedId), [patients, selectedId]);
  const autoFileNo = useMemo(() => nextWalkInFileNumber(patients), [patients]);
  const [fileNo, setFileNo] = useState('');
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState('');
  const [services, setServices] = useState<SessionServiceItem[]>([]);
  const [examinationFee, setExaminationFee] = useState(defaultExamFee ? String(defaultExamFee) : '');
  const [paidAmount, setPaidAmount] = useState('');
  const [discountAmount, setDiscountAmount] = useState('');
  const [chiefComplaint, setChiefComplaint] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [prescriptionNotes, setPrescriptionNotes] = useState('');
  const [visitNotes, setVisitNotes] = useState('');
  const [visitStatus, setVisitStatus] = useState<'completed' | 'follow_up'>('completed');
  const exam = Number(examinationFee || 0);
  const paid = Number(paidAmount || 0);
  const discount = Number(discountAmount || 0);
  const treatment = services.reduce((sum, item) => sum + item.price, 0);
  const total = exam + treatment;
  const remaining = Math.max(0, total - paid - discount);
  const updateService = (id: string, patch: Partial<SessionServiceItem>) => setServices(previous => previous.map(item => item.id === id ? { ...item, ...patch } : item));
  const addService = (name = '', price = 0) => setServices(previous => [...previous, { id: crypto.randomUUID(), name, price }]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (committingRef.current) return;
    if (patientMode === 'existing' && !selectedPatient) { showToast('اختر ملف المريض أولًا.', 'warning'); return; }
    const newId = fileNo.trim() || autoFileNo;
    if (patientMode === 'new') {
      if (!name.trim() || !mobile.trim() || !newId) { showToast('اكتب اسم المريض والهاتف ورقم ملف متاح.', 'warning'); return; }
      if (patients.some(item => canonicalFileNumber(item.id) === canonicalFileNumber(newId))) { showToast('رقم الملف مستخدم. اختر المريض المسجل أو رقمًا آخر.', 'warning'); return; }
      if (age && (!Number.isInteger(Number(age)) || Number(age) < 0 || Number(age) > 120)) { showToast('أدخل عمرًا صحيحًا من صفر إلى ١٢٠ سنة، أو اتركه فارغًا.', 'warning'); return; }
    }
    const error = validateWalkInAmounts(exam, services, paid, discount);
    if (error) { showToast(error, 'warning'); return; }
    const patient = patientMode === 'existing' && selectedPatient
      ? { isNew: false, id: selectedPatient.id, name: selectedPatient.name, mobile: selectedPatient.mobile, age: selectedPatient.age || 0, gender: selectedPatient.gender }
      : { isNew: true, id: newId, name: name.trim(), mobile: mobile.trim(), age: age ? Number(age) : 0, gender: gender || undefined };
    committingRef.current = true;
    try {
      await run(async () => {
        await onSaveWalkInVisit({ patient, visit: {
          chiefComplaint: chiefComplaint.trim(), diagnosis: diagnosis.trim(),
          procedurePerformed: services.map(item => item.name.trim()).join(' + ') || (exam > 0 ? 'كشف واستشارة' : 'زيارة بدون إجراء مسجل'),
          services: services.map(item => ({ ...item, name: item.name.trim() })), prescriptionNotes: prescriptionNotes.trim(), visitNotes: visitNotes.trim(), visitStatus,
          examinationFee: exam, treatmentFee: treatment, totalFee: total, paidAmount: paid, discountAmount: discount, paymentMethod: 'cash', isPaid: remaining === 0,
        } });
      }, () => { showToast('تم حفظ الزيارة والدفعة المسجلة ضمن تحصيل اليوم.', 'success'); onClose(); });
    } finally { committingRef.current = false; }
  };

  if (!isOpen) return null;
  return <div className="clinic-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-3 sm:p-6" dir="rtl">
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="walkin-title" tabIndex={-1} aria-busy={saving}
      className="clinic-modal-panel clinic-modal-panel--framed clinic-action-dialog w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl flex flex-col">
      <header className="clinic-action-header"><div className="clinic-action-heading"><span className="clinic-action-symbol"><Stethoscope aria-hidden="true" /></span>
        <div><h2 id="walkin-title">زيارة بدون موعد</h2><p>اختيار المريض، ثم الخدمة والمبلغ المدفوع فعلًا.</p></div></div>
        <button type="button" disabled={saving} onClick={closeDialog} aria-label="إلغاء وإغلاق الزيارة" className="clinic-action-close"><X aria-hidden="true" /></button>
      </header>
      <form id="walkin-form" onSubmit={submit} className="walkin-form min-h-0 overflow-y-auto"><fieldset disabled={saving} className="contents">
        <section className="walkin-section"><h4>١. المريض</h4>
          <div className="walkin-mode"><button type="button" aria-pressed={patientMode === 'existing'} onClick={() => setPatientMode('existing')}>مريض مسجل</button><button type="button" aria-pressed={patientMode === 'new'} onClick={() => setPatientMode('new')}>مريض جديد</button></div>
          {patientMode === 'existing' ? selectedPatient ? <div className="flex items-center justify-between gap-3 flex-wrap"><div><strong className="block">{selectedPatient.name}</strong><small className="text-slate-500">ملف <bdi>#{selectedPatient.id}</bdi> · <bdi>{selectedPatient.mobile}</bdi></small></div><button type="button" className="clinic-action-cancel" onClick={() => setSelectedId('')}>تغيير المريض</button></div> : <>
            <label>ابحث بالاسم أو رقم الملف أو الهاتف<input data-dialog-autofocus value={query} onChange={event => setQuery(event.target.value)} placeholder="اسم المريض، #رقم الملف أو الهاتف" autoComplete="off" /></label>
            <div className="walkin-results" aria-busy={query !== deferredQuery}>{results.map(item => <button type="button" key={item.id} onClick={() => setSelectedId(item.id)}><strong>{item.name} <bdi>#{item.id}</bdi></strong><small><bdi>{item.mobile}</bdi></small></button>)}{!results.length && <p className="p-3 text-sm text-slate-500">لا يوجد ملف مطابق. يمكنك اختيار «مريض جديد».</p>}</div>
          </> : <div className="walkin-grid">
            <label>اسم المريض<input value={name} onChange={event => setName(event.target.value)} required autoComplete="name" /></label>
            <label>رقم الهاتف<input type="tel" value={mobile} onChange={event => setMobile(event.target.value)} required autoComplete="tel" placeholder="01xxxxxxxxx" /></label>
            <label>رقم الملف المقترح<input value={fileNo || autoFileNo} onChange={event => setFileNo(event.target.value)} required /></label>
            <label>العمر (اختياري)<input type="number" min="0" max="120" step="1" value={age} onChange={event => setAge(event.target.value)} /></label>
            <label>الجنس (اختياري)<select value={gender} onChange={event => setGender(event.target.value)}><option value="">غير محدد</option><option value="ذكر">ذكر</option><option value="أنثى">أنثى</option></select></label>
          </div>}
        </section>
        <section className="walkin-section"><h4>٢. الخدمات والكشف</h4>
          <p className="walkin-hint mb-3">لا تُضاف خدمة أو دفعة تلقائيًا. أسعار الاختصارات مقترحة ويمكن تعديلها قبل الحفظ.</p>
          <div className="walkin-presets">{STANDARD_SERVICES_CATALOG.filter(item => item.id !== 'exam').map(item => <button type="button" key={item.id} onClick={() => addService(item.name, item.defaultPrice)}>{item.name}</button>)}<button type="button" onClick={() => addService()}><Plus aria-hidden="true" className="inline h-4 w-4" /> خدمة أخرى</button></div>
          {services.map((item, index) => <div key={item.id} className="walkin-service"><label>الخدمة {index + 1}<input aria-label={`اسم الخدمة ${index + 1}`} value={item.name} onChange={event => updateService(item.id, { name: event.target.value })} required /></label><label>السعر (ج.م)<input aria-label={`سعر الخدمة ${index + 1}`} type="number" min="0" step="0.01" value={item.price} onChange={event => updateService(item.id, { price: Number(event.target.value) })} required /></label><button type="button" aria-label={`حذف الخدمة ${index + 1}`} onClick={() => setServices(previous => previous.filter(service => service.id !== item.id))}><Trash2 aria-hidden="true" className="mx-auto h-4 w-4" /></button></div>)}
          <label className="mt-3">رسوم الكشف (اختياري، صفر بدون كشف)<input type="number" min="0" step="0.01" value={examinationFee} onChange={event => setExaminationFee(event.target.value)} placeholder="0" /></label>
        </section>
        <details className="walkin-section walkin-details"><summary>تفاصيل طبية وملاحظات (اختياري)</summary><div className="walkin-grid">
          <label>الشكوى الرئيسية<input value={chiefComplaint} onChange={event => setChiefComplaint(event.target.value)} /></label><label>التشخيص<input value={diagnosis} onChange={event => setDiagnosis(event.target.value)} /></label>
          <label>الوصفة أو تعليمات الطبيب<textarea rows={2} value={prescriptionNotes} onChange={event => setPrescriptionNotes(event.target.value)} /></label><label>ملاحظات الزيارة<textarea rows={2} value={visitNotes} onChange={event => setVisitNotes(event.target.value)} /></label>
          <label>حالة الزيارة<select value={visitStatus} onChange={event => setVisitStatus(event.target.value as 'completed' | 'follow_up')}><option value="completed">اكتملت الزيارة</option><option value="follow_up">تحتاج متابعة</option></select></label>
        </div></details>
        <section className="walkin-section"><h4>٣. التحصيل النقدي</h4><div className="walkin-grid"><label>المدفوع الآن (ج.م)<input type="number" min="0" step="0.01" value={paidAmount} onChange={event => setPaidAmount(event.target.value)} placeholder="0" inputMode="decimal" /></label><label>خصم أو إعفاء (اختياري)<input type="number" min="0" step="0.01" value={discountAmount} onChange={event => setDiscountAmount(event.target.value)} placeholder="0" inputMode="decimal" /></label></div>
          <div className="walkin-payment-summary"><span>إجمالي الزيارة<strong>{amountText(total)}</strong></span><span>المدفوع<strong>{amountText(paid)}</strong></span><span>المتبقي<strong>{amountText(remaining)}</strong></span></div>
          <button type="button" className="clinic-action-cancel mt-3" onClick={() => { setPaidAmount(String(Math.max(0, total - discount))); showToast('تم ملء مبلغ السداد في المسودة. لم يُحفظ بعد.', 'info'); }}>ملء باقي المبلغ للسداد</button>
          <p className="walkin-hint">تُحفظ الزيارة والكشف والدفعة مرة واحدة عند الضغط على «حفظ الزيارة» فقط. خدمة سابقة؟ استخدم «تسجيل دفعة» من الرئيسية.</p>
        </section>
      </fieldset></form>
      <footer className="clinic-action-footer"><button type="button" disabled={saving} onClick={closeDialog} className="clinic-action-cancel">إلغاء وإغلاق</button><button type="submit" form="walkin-form" disabled={saving} className="clinic-action-primary"><CheckCircle2 aria-hidden="true" className="h-5 w-5" />{saving ? 'جارٍ حفظ الزيارة…' : 'حفظ الزيارة'}</button></footer>
    </div>
  </div>;
};
