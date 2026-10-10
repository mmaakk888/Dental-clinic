import React, { useDeferredValue, useId, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Crown, Search, X } from 'lucide-react';
import type { Patient } from '../types';
import type { ProstheticKind } from '../utils/prostheticRouting';
import { getPatientProstheticPrice, validateProstheticOrder, type ProstheticOrderInput } from '../utils/prostheticWorkflow';
import { buildHomePatientSearch, searchHomePatients } from '../utils/homePatientSearch';
import { getToothLabel, parseCompositeToothId } from '../utils/toothUtils';
import { getWalkInToothOptions, walkInExaminationDefault } from '../utils/walkInDraft';
import { useAppointmentDialog } from './appointments/useAppointmentDialog';
import { useToastAndConfirm } from './common/ToastAndConfirm';
import { useConfirmedAction } from './common/useConfirmedAction';
import './ProstheticOrderForm.css';

export interface ProstheticOrderFormProps {
  patient?: Patient;
  patients?: Patient[];
  crownPrices: Record<string, number>;
  examinationFee?: number;
  initialKind?: ProstheticKind;
  initialToothId?: string | null;
  canRegisterPayment: boolean;
  onSave: (input: ProstheticOrderInput) => void | Promise<void>;
  onClose: () => void;
}

const money = (value: number) => Number.isFinite(value)
  ? `${new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 }).format(value)} ج.م` : '—';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const cents = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/** Patient-facing registration draft. Private supplier routing/costs stay in
 * the authorized save workflow and are deliberately absent from this API. */
export function ProstheticOrderForm({ patient, patients = [], crownPrices, examinationFee = 100, initialKind = 'fixed',
  initialToothId = null, canRegisterPayment, onSave, onClose }: ProstheticOrderFormProps) {
  const id = `prosthetic-order-${useId().replace(/[^\w-]/g, '')}`;
  const { showToast } = useToastAndConfirm();
  const { saving, run } = useConfirmedAction();
  const committing = useRef(false);
  const operationId = useRef<string | null>(null);
  if (!operationId.current) operationId.current = crypto.randomUUID();
  const close = () => { if (!committing.current) onClose(); };
  const dialogRef = useAppointmentDialog(true, close);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [patientId, setPatientId] = useState('');
  const patientIndex = useMemo(() => buildHomePatientSearch(patients), [patients]);
  const results = useMemo(() => searchHomePatients(patientIndex, deferredQuery, 8, true), [patientIndex, deferredQuery]);
  const selectedPatient = patient ?? patients.find(item => item.id === patientId);
  const [kind, setKind] = useState<ProstheticKind>(initialKind);
  const [material, setMaterial] = useState('');
  const materials = useMemo(() => Object.keys(crownPrices).filter(name => getPatientProstheticPrice(name, { crownPrices }) !== undefined), [crownPrices]);
  const [units, setUnits] = useState('1');
  const [teethIds, setTeethIds] = useState<string[]>(initialToothId && parseCompositeToothId(initialToothId) ? [initialToothId] : []);
  const [toothKind, setToothKind] = useState<'adult' | 'pediatric'>(initialToothId && /[A-E]$/.test(initialToothId) ? 'pediatric' : 'adult');
  const [withExamination, setWithExamination] = useState(false);
  const [exam, setExam] = useState(String(walkInExaminationDefault(examinationFee)));
  const [paidText, setPaidText] = useState('');
  const [date, setDate] = useState(today);
  const [deliveryExpectedDate, setDeliveryExpectedDate] = useState('');
  const [note, setNote] = useState('');
  const unitPrice = getPatientProstheticPrice(material, { crownPrices });
  const examAmount = withExamination ? Number(exam || 0) : 0;
  const treatmentTotal = cents((unitPrice ?? 0) * Number(units));
  const total = cents(treatmentTotal + examAmount);
  const paid = canRegisterPayment ? Number(paidText || 0) : 0;
  const remaining = cents(Math.max(0, total - paid));

  const addTooth = (value: string) => {
    if (!value || !parseCompositeToothId(value) || teethIds.includes(value)) return;
    if (teethIds.length >= 32) { showToast('الحد الأقصى ٣٢ موضعًا. راجع الأسنان المحددة.', 'warning'); return; }
    setTeethIds(previous => previous.includes(value) ? previous : [...previous, value]);
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (committing.current) return;
    if (!selectedPatient) { showToast('اختر ملف المريض أولًا.', 'warning'); return; }
    if (unitPrice === undefined) { showToast('اختر خامة لها سعر مريض صالح من فهرس العيادة.', 'warning'); return; }
    const input: ProstheticOrderInput = {
      operationId: operationId.current!, patientId: selectedPatient.id, kind, material,
      units: Number(units), teethIds: [...teethIds], date, expectedUnitPrice: unitPrice,
      examinationFee: examAmount, paid, ...(note.trim() ? { note: note.trim() } : {}),
      ...(deliveryExpectedDate ? { deliveryExpectedDate } : {}),
    };
    try { validateProstheticOrder(input); }
    catch (error) { showToast(error instanceof Error ? error.message : 'راجع بيانات التركيبة والمبلغ المحصّل.', 'warning'); return; }
    committing.current = true;
    try {
      await run(() => onSave(input), () => { showToast('تم حفظ التركيبة وحساب المريض والدفعة المسجلة.', 'success'); onClose(); });
    } finally { committing.current = false; }
  };

  return <div className="clinic-modal-overlay prosthetic-order-overlay" dir="rtl" onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-busy={saving} tabIndex={-1} className="clinic-modal-panel clinic-modal-panel--framed prosthetic-order-dialog">
      <div className="prosthetic-order-header"><span className="prosthetic-order-symbol"><Crown aria-hidden="true" /></span><div><h2 id={`${id}-title`}>تسجيل تركيبة</h2><p>المريض، نوع التركيبة، ثم الحساب والتحصيل الفعلي.</p></div><button type="button" className="prosthetic-order-close" disabled={saving} onClick={close} aria-label="إلغاء وإغلاق تسجيل التركيبة"><X aria-hidden="true" /></button></div>
      <form id={`${id}-form`} onSubmit={submit} className="prosthetic-order-body"><fieldset disabled={saving}>
        <section className="prosthetic-order-section"><h3>١. ملف المريض</h3>
          {selectedPatient ? <div className="prosthetic-order-patient"><div><strong dir="auto">{selectedPatient.name}</strong><span>ملف <bdi>#{selectedPatient.id}</bdi></span></div>{!patient && <button type="button" className="prosthetic-order-secondary" onClick={() => setPatientId('')}>تغيير المريض</button>}</div> : <>
            <label className="prosthetic-order-search"><Search aria-hidden="true" /><input aria-label="البحث عن مريض للتركيبة" value={query} onChange={event => setQuery(event.target.value)} placeholder="اسم المريض أو #رقم الملف أو الهاتف" data-dialog-autofocus autoComplete="off" /></label>
            <div className="prosthetic-order-patient-results" aria-busy={query !== deferredQuery}>{results.map(item => <button type="button" key={item.id} onClick={() => setPatientId(item.id)}><strong dir="auto">{item.name}</strong><span>ملف <bdi>#{item.id}</bdi></span></button>)}{!results.length && <p className="prosthetic-order-hint">لا يوجد ملف مطابق؛ أنشئ ملف المريض أولًا من قسم المرضى.</p>}</div>
          </>}
        </section>
        <section className="prosthetic-order-section"><h3>٢. تفاصيل التركيبة</h3><div className="prosthetic-order-kind" role="group" aria-label="نوع التركيبة">{(['fixed', 'removable'] as const).map(value => <button type="button" key={value} aria-pressed={kind === value} onClick={() => setKind(value)}>{value === 'fixed' ? 'تركيبة ثابتة' : 'تركيبة متحركة'}</button>)}</div>
          <div className="prosthetic-order-grid"><label>الخامة أو نوع التركيبة<select aria-label="خامة التركيبة" value={material} onChange={event => setMaterial(event.target.value)} required><option value="">اختر من فهرس العيادة…</option>{materials.map(name => <option key={name} value={name}>{name}</option>)}</select></label><label>{kind === 'fixed' ? 'عدد الكراونات' : 'عدد الوحدات'}<input aria-label="عدد وحدات التركيبة" type="number" min="1" max="100" step="1" value={units} onChange={event => setUnits(event.target.value)} inputMode="numeric" required /></label></div>
          {!materials.length && <p className="prosthetic-order-warning" role="status">لا توجد خامات بأسعار مريض صالحة. جهّز أسعار التركيبات من لوحة التحكم أولًا.</p>}
          <p className="prosthetic-order-hint">سعر {kind === 'fixed' ? 'الكراون' : 'الوحدة'} للمريض: <bdi>{unitPrice === undefined ? 'اختر الخامة' : money(unitPrice)}</bdi> · السعر من فهرس العيادة.</p>
          <details className="prosthetic-order-teeth"><summary>تحديد الأسنان (اختياري){teethIds.length > 0 && <span>{teethIds.length} محدد</span>}</summary><p className="prosthetic-order-hint">يمكن ترك الأسنان غير محددة مؤقتًا.{kind === 'fixed' && ' عند تحديدها يجب أن يساوي عددها عدد الكراونات.'}</p><div className="prosthetic-order-grid"><label>الأسنان<select aria-label="نوع الأسنان للتركيبة" value={toothKind} onChange={event => setToothKind(event.target.value as 'adult' | 'pediatric')}><option value="adult">أسنان دائمة</option><option value="pediatric">أسنان لبنية</option></select></label><label>إضافة موضع<select aria-label="إضافة سن للتركيبة" value="" onChange={event => addTooth(event.target.value)}><option value="">غير محدد / اختر سنًا لإضافته…</option>{getWalkInToothOptions(toothKind).map(group => <optgroup key={group.label} label={group.label}>{group.options.map(option => <option key={option.value} value={option.value} disabled={teethIds.includes(option.value)}>{option.label}</option>)}</optgroup>)}</select></label></div><div className="prosthetic-order-selected-teeth">{teethIds.map(value => <button type="button" key={value} onClick={() => setTeethIds(previous => previous.filter(item => item !== value))} aria-label={`إزالة ${getToothLabel(value)}`}><span>{getToothLabel(value)}</span><X aria-hidden="true" /></button>)}</div>{teethIds.length > 0 && <button type="button" className="prosthetic-order-secondary" onClick={() => setTeethIds([])}>إلغاء تحديد الأسنان</button>}</details>
        </section>
        <section className="prosthetic-order-section"><h3>٣. الكشف والتحصيل النقدي</h3><div className="prosthetic-order-kind" role="group" aria-label="اختيار الكشف للتركيبة"><button type="button" aria-pressed={!withExamination} onClick={() => setWithExamination(false)}>بدون كشف</button><button type="button" aria-pressed={withExamination} onClick={() => setWithExamination(true)}>بكشف</button></div><div className="prosthetic-order-grid">{withExamination && <label>رسوم الكشف لهذه الزيارة<input aria-label="رسوم كشف التركيبة" type="number" min="0" step="0.01" value={exam} onChange={event => setExam(event.target.value)} inputMode="decimal" /><small>المقترح {money(walkInExaminationDefault(examinationFee))}، قابل للتعديل لهذه الزيارة.</small></label>}{canRegisterPayment && <label>المدفوع الآن نقدًا<input aria-label="المبلغ المحصّل للتركيبة" type="number" min="0" step="0.01" value={paidText} onChange={event => setPaidText(event.target.value)} placeholder="0" inputMode="decimal" /><small>اكتب المبلغ الذي استلمته فعلًا؛ لا يُملأ تلقائيًا.</small></label>}</div>{!canRegisterPayment && <p className="prosthetic-order-hint">هذا الحساب يسجّل التركيبة دون تحصيل؛ تُسجّل الدفعة لاحقًا بواسطة صاحب الصلاحية.</p>}
          <dl className="prosthetic-order-totals"><div><dt>التركيبة</dt><dd><bdi>{unitPrice === undefined ? '—' : money(treatmentTotal)}</bdi></dd></div><div><dt>الكشف</dt><dd><bdi>{money(examAmount)}</bdi></dd></div><div><dt>الإجمالي</dt><dd><bdi>{unitPrice === undefined ? '—' : money(total)}</bdi></dd></div><div><dt>المحصّل الآن</dt><dd><bdi>{money(paid)}</bdi></dd></div><div><dt>المتبقي للمريض</dt><dd><bdi>{unitPrice === undefined ? '—' : money(remaining)}</bdi></dd></div></dl>
        </section>
        <details className="prosthetic-order-section prosthetic-order-extra"><summary>التاريخ والملاحظات</summary><div className="prosthetic-order-grid"><label>تاريخ التسجيل<input aria-label="تاريخ تسجيل التركيبة" type="date" value={date} onChange={event => setDate(event.target.value)} required /></label><label>الاستلام المتوقع (اختياري)<input aria-label="تاريخ استلام التركيبة المتوقع" type="date" min={date} value={deliveryExpectedDate} onChange={event => setDeliveryExpectedDate(event.target.value)} /></label></div><label>ملاحظات (اختياري)<textarea aria-label="ملاحظات التركيبة" rows={2} maxLength={2000} value={note} onChange={event => setNote(event.target.value)} /></label></details>
      </fieldset></form>
      <div className="prosthetic-order-footer"><p>الحفظ يسجّل التركيبة وحسابها مرة واحدة، دون تحصيل تلقائي.</p><div><button type="button" className="prosthetic-order-secondary" disabled={saving} onClick={close}>إلغاء وإغلاق</button><button type="submit" form={`${id}-form`} className="prosthetic-order-save" disabled={saving || !selectedPatient || unitPrice === undefined}><CheckCircle2 aria-hidden="true" />{saving ? 'جارٍ حفظ التركيبة…' : 'حفظ التركيبة'}</button></div></div>
    </div>
  </div>;
}
