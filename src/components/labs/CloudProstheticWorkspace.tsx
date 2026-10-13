import React, { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowRight, Check, ClipboardList, History, Landmark, Plus, RefreshCw, Save, X } from 'lucide-react';
import { ToothSelectionGrid } from '../common/ToothSelectionGrid';
import { ExaminationFeeToggle } from '../common/ExaminationFeeToggle';
import { parseCloudProstheticMoney, type CloudProstheticWorkspaceController, type CloudProstheticWorkspaceDraft } from '../../utils/cloudProstheticWorkspaceController';
import type { CloudProstheticStatus } from '../../utils/cloudProstheticRepository';
import { normalizeDirectoryDigits } from '../../utils/patientDirectory';
import './CloudProstheticWorkspace.css';

export interface CloudProstheticWorkspaceProps {
  controller: CloudProstheticWorkspaceController; previewOnly?: boolean; disabled?: boolean;
  onClose?: () => void;
  /** Parent opens its protected patient selector; pass selected patient UUID to controller.beginOrder(). */
  onChoosePatient?: () => void;
}
const money = (cents: number) => `${(cents / 100).toLocaleString('ar-EG', { maximumFractionDigits: 2 })} ج.م`;
const labels: Record<CloudProstheticStatus, string> = { pending: 'قيد الطلب', in_progress: 'قيد التنفيذ', ready: 'جاهزة', delivered: 'تم التسليم' };
const statusLabel = { prepared: 'محفوظة للمحاولة', committed: 'ملتزمة', cancelled: 'ملغاة' };

/** No reads on render/mount. All commands pass through the owned controller;
 * preview masks even mistakenly supplied private records and is inert. */
export function CloudProstheticWorkspace(props: CloudProstheticWorkspaceProps) {
  const state = useSyncExternalStore(useCallback(listener => props.controller.subscribe(listener), [props.controller]), props.controller.getState, props.controller.getState);
  const latest = useRef(props); latest.current = props;
  const [month, setMonth] = useState<string | null>(null), [caseLimit, setCaseLimit] = useState(25), [paymentLimit, setPaymentLimit] = useState(25);
  const latestMonth = useRef(month); latestMonth.current = month;
  const unavailable = !!props.previewOnly || state.closed;
  const draft = unavailable ? null : state.draft, ledger = unavailable ? null : state.ledger;
  const busy = state.loading || state.historyLoading || state.saveStatus === 'preparing' || state.saveStatus === 'saving';
  const locked = unavailable || !!props.disabled || busy || state.saveStatus !== 'idle';
  const browseDisabled = locked || !!draft;
  function ready(controller = props.controller) {
    const current = latest.current, value = current.controller.getState();
    return current.controller === controller && !current.previewOnly && !current.disabled && !value.closed
      && !value.loading && !value.historyLoading && !['preparing', 'saving'].includes(value.saveStatus);
  }
  function browse(work: (controller: CloudProstheticWorkspaceController) => void) {
    if (ready() && props.controller.canClose()) work(props.controller);
  }
  function edit(expected: CloudProstheticWorkspaceDraft, work: (controller: CloudProstheticWorkspaceController) => void) {
    if (ready() && props.controller.getState().draft === expected && props.controller.getState().saveStatus === 'idle') work(props.controller);
  }
  const update = (expected: CloudProstheticWorkspaceDraft, patch: unknown) => edit(expected, controller => controller.updateDraft(expected.handle, patch));
  const order = draft?.type === 'order' ? draft : null;
  const unitPrice = order ? parseCloudProstheticMoney(order.unitPrice) : null;
  const count = order && /^\d{1,3}$/.test(normalizeDirectoryDigits(order.units.trim())) ? Number(normalizeDirectoryDigits(order.units.trim())) : null;
  const total = unitPrice !== null && count !== null && count >= 1 && count <= 100 ? unitPrice * count + (order?.includeExamination ? order.examinationCents : 0) : null;
  return <section className="cloud-prosthetic-workspace" dir="rtl" aria-label="التركيبات والمعامل">
    <header className="cprost-surface cprost-header"><div><h2><Landmark aria-hidden="true" />{order ? 'تسجيل تركيبة للمريض' : 'التركيبات والمعامل'}</h2>
      <p>{order ? 'سعر المريض والتحصيل الفعلي فقط؛ تفاصيل المعمل لا تظهر في هذا النموذج.' : 'حساب مرتبط بملف المريض، ودفعات مؤرخة لكل معمل — للمالك فقط.'}</p></div>
      <button type="button" className="cprost-button" disabled={!unavailable && (busy || !!draft || !!state.pendingOperationId || !!props.disabled)} onClick={() => {
        const current = latest.current;
        if (current.controller !== props.controller || current.disabled) return;
        if (current.previewOnly || current.controller.getState().closed || current.controller.canClose()) current.onClose?.();
      }}><ArrowRight size={18} aria-hidden="true" />إلغاء وإغلاق</button></header>
    {props.previewOnly && <p className="cprost-message" role="status">معاينة تصميم فارغة فقط — لا تُقرأ ملفات أو أسعار ولا تُسجّل عمليات.</p>}
    {!props.previewOnly && state.closed && <p className="cprost-message" role="status">أُغلقت مساحة العمل وأُخفيت البيانات.</p>}
    {!unavailable && state.error && <p className="cprost-message cprost-error" role="alert">{state.error}</p>}
    {!unavailable && state.notice && <p className="cprost-message" role="status">{state.notice}</p>}
    {!unavailable && ['retry-required', 'refresh-required'].includes(state.saveStatus) && <section className="cprost-surface cprost-recovery" aria-label="التحقق من العملية">
      <h3>{state.saveStatus === 'refresh-required' ? 'الحفظ مؤكد — نحتاج تحديث الحساب' : 'تأكيد العملية لم يصل'}</h3>
      <p>{state.saveStatus === 'refresh-required' ? 'إعادة التحقق تقرأ السجل فقط دون تسجيل دفعة أو طلب جديد.' : 'قد تكون العملية وصلت. أعد المحاولة الأصلية أو تحقق من إلغائها قبل تسجيل بديل.'}</p>
      <bdi className="cprost-id" dir="ltr">{state.pendingOperationId}</bdi>
      <div className="cprost-actions"><button type="button" className="cprost-button cprost-primary" disabled={busy || !!props.disabled} onClick={() => {
        if (ready() && props.controller.getState().pendingOperationId === state.pendingOperationId && state.pendingOperationId) void props.controller.retry(state.pendingOperationId);
      }}><RefreshCw size={18} aria-hidden="true" />{state.saveStatus === 'refresh-required' ? 'إعادة التحقق بالقراءة' : 'إعادة نفس المحاولة'}</button>
        {state.saveStatus === 'retry-required' && <button type="button" className="cprost-button" disabled={busy || !!props.disabled} onClick={() => {
          if (ready() && props.controller.getState().pendingOperationId === state.pendingOperationId && state.pendingOperationId) void props.controller.cancelPending(state.pendingOperationId);
        }}><X size={18} aria-hidden="true" />التحقق من إلغاء العملية</button>}</div>
    </section>}
    {order ? <form className="cprost-surface cprost-editor" onSubmit={event => { event.preventDefault(); edit(order, controller => { void controller.saveDraft(order.handle); }); }}>
      <div className="cprost-section-heading"><h3>{order.patientName} <small>ملف <bdi>{order.fileNo}</bdi></small></h3><span>مسودة — لم تُحفظ</span></div>
      <fieldset disabled={locked}><legend>١. اختر الخدمة</legend><div className="cprost-service-choices">
        {order.choices.map(choice => <button key={choice.serviceId} type="button" className="cprost-choice" aria-pressed={order.serviceId === choice.serviceId}
          onClick={() => edit(order, controller => controller.selectService(order.handle, choice.serviceId))}><strong>{choice.name}</strong><bdi>{money(choice.priceCents)}</bdi>{order.serviceId === choice.serviceId && <Check size={18} aria-hidden="true" />}</button>)}
      </div></fieldset>
      <fieldset disabled={locked}><legend>٢. العدد والأسنان</legend><div className="cprost-fields">
        <label>نوع التركيبة<select value={order.kind ?? ''} disabled={locked || order.choices.find(choice => choice.serviceId === order.serviceId)?.kind != null} onChange={event => update(order, { kind: event.target.value })}><option value="" disabled>اختر النوع</option><option value="fixed">ثابتة</option><option value="removable">متحركة</option></select></label>
        <label>عدد الوحدات<input inputMode="numeric" value={order.units} maxLength={3} onChange={event => update(order, { units: event.target.value })} /></label>
        <label>تاريخ الطلب<input type="date" value={order.date} onChange={event => update(order, { date: event.target.value })} /></label>
        <label>التسليم المتوقع — اختياري<input type="date" value={order.deliveryDate} min={order.date} onChange={event => update(order, { deliveryDate: event.target.value })} /></label>
      </div><details className="cprost-teeth"><summary>اختيار الأسنان <bdi>({order.teethIds.length})</bdi></summary>
        <ToothSelectionGrid value={order.teethIds} disabled={locked} onChange={teethIds => update(order, { teethIds })} />
        <p>عند تحديد أسنان لتركيبة ثابتة يجب أن يطابق عددها عدد الوحدات.</p></details></fieldset>
      <fieldset disabled={locked}><legend>٣. حساب المريض</legend><div className="cprost-fields">
        <label>سعر الوحدة للمريض — ج.م<input inputMode="decimal" value={order.unitPrice} maxLength={32} onChange={event => update(order, { unitPrice: event.target.value })} /></label>
        <label>المحصّل الآن فعلًا — ج.م<input inputMode="decimal" value={order.paid} maxLength={32} placeholder="اكتب ٠ إذا لم يدفع" onChange={event => update(order, { paid: event.target.value })} /></label>
      </div><ExaminationFeeToggle selected={order.includeExamination} fee={order.examinationCents / 100} disabled={locked} onChange={includeExamination => update(order, { includeExamination })} />
        <p className="cprost-total">إجمالي المطلوب من المريض <strong>{total === null ? 'أكمل السعر والعدد' : money(total)}</strong></p>
        <label>ملاحظات<textarea value={order.note} maxLength={2000} rows={2} onChange={event => update(order, { note: event.target.value })} /></label></fieldset>
      <div className="cprost-actions"><button type="submit" className="cprost-button cprost-primary" disabled={locked}><Save size={18} aria-hidden="true" />حفظ التركيبة وربطها بالملف</button>
        <button type="button" className="cprost-button" disabled={locked} onClick={() => edit(order, controller => controller.cancelDraft(order.handle))}><X size={18} aria-hidden="true" />إلغاء المسودة</button></div>
    </form> : draft ? <form className="cprost-surface cprost-editor" onSubmit={event => { event.preventDefault(); edit(draft, controller => { void controller.saveDraft(draft.handle); }); }}>
      <h3>{draft.type === 'progress' ? 'تحديث حالة التركيبة' : draft.caseId ? 'دفعة للمعمل على هذه الحالة' : 'دفعة مجمّعة للمعمل'}</h3>
      <fieldset disabled={locked}><div className="cprost-fields">
        {draft.type === 'progress' ? <label>الحالة<select value={draft.status} onChange={event => update(draft, { status: event.target.value })}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          : <><label>المدفوع للمعمل فعلًا — ج.م<input inputMode="decimal" value={draft.amount} maxLength={32} onChange={event => update(draft, { amount: event.target.value })} /></label><label>تاريخ الدفعة<input type="date" value={draft.date} onChange={event => update(draft, { date: event.target.value })} /></label></>}
      </div><label>ملاحظات<textarea value={draft.note} rows={2} maxLength={draft.type === 'payment' ? 1000 : 2000} onChange={event => update(draft, { note: event.target.value })} /></label></fieldset>
      {draft.type === 'payment' && !draft.caseId && <p>تُوزّع الدفعة على أقدم الحالات غير المسدّدة، بحد أقصى ٨ حالات للعملية. لا تغيّر تحصيل المريض.</p>}
      <div className="cprost-actions"><button type="submit" className="cprost-button cprost-primary" disabled={locked}><Save size={18} aria-hidden="true" />حفظ العملية</button><button type="button" className="cprost-button" disabled={locked} onClick={() => edit(draft, controller => controller.cancelDraft(draft.handle))}><X size={18} aria-hidden="true" />إلغاء المسودة</button></div>
    </form> : <>
      <section className="cprost-surface" aria-label="اختيار المعمل" aria-busy={state.loading}>
        <div className="cprost-section-heading"><h3>المعامل</h3><div className="cprost-actions"><button type="button" className="cprost-button" disabled={browseDisabled} onClick={() => browse(controller => { void controller.loadLabs(); })}><RefreshCw size={18} aria-hidden="true" />تحميل المعامل</button>
          <button type="button" className="cprost-button cprost-primary" disabled={browseDisabled || !props.onChoosePatient} onClick={() => browse(() => latest.current.onChoosePatient?.())}><Plus size={18} aria-hidden="true" />تركيبة لمريض</button></div></div>
        <label className="cprost-month">شهر كشف الحساب<input type="month" value={unavailable ? '' : month ?? state.month ?? ''} disabled={browseDisabled} onChange={event => { if (ready()) setMonth(event.target.value); }} /></label>
        <div className="cprost-labs">{!unavailable && state.labs.map(lab => <button key={lab.recordId} type="button" className="cprost-choice" disabled={browseDisabled} aria-pressed={state.selectedLab?.recordId === lab.recordId}
          onClick={() => browse(controller => {
            if (!controller.getState().labs.includes(lab) || latestMonth.current !== month || controller.getState().month !== state.month) return;
            setCaseLimit(25); setPaymentLimit(25); void controller.openLab(lab.recordId, month ?? state.month ?? '');
          })}><strong>{lab.data.name}</strong><span>{lab.data.active ? 'نشط' : 'غير نشط'}</span></button>)}</div>
        {!unavailable && state.labsCursor && <button type="button" className="cprost-button" disabled={browseDisabled} onClick={() => browse(controller => { void controller.loadLabs(true); })}>تحميل معامل إضافية</button>}
        {(!state.labsLoaded || unavailable) && <p>حمّل قائمة المعامل واختر شهرًا؛ لا نعرض رصيدًا افتراضيًا.</p>}
      </section>
      {!unavailable && state.selectedLab && <section className="cprost-surface" aria-label="كشف حساب المعمل">
        <div className="cprost-section-heading"><div><h3>{state.selectedLab.data.name}</h3><p>كشف كامل ومؤكد لشهر <bdi>{state.month}</bdi></p></div><button type="button" className="cprost-button" disabled={browseDisabled} onClick={() => browse(controller => {
          if (controller.getState().selectedLab === state.selectedLab && controller.getState().month === state.month) void controller.refresh();
        })}><RefreshCw size={18} aria-hidden="true" />تحديث الحساب</button></div>
        {ledger ? <><div className="cprost-metrics">{[['تكلفة الحالات', ledger.totalCostCents], ['وصل للمعمل إجمالًا', ledger.paidCostCents], ['وصل هذا الشهر', ledger.monthPaidCents], ['متبقي للمعمل', ledger.remainingCents], ['محجوز للمعمل من التحصيل', ledger.reservedForLabCents], ['تحصيل زائد عن تكلفة المعمل', ledger.availableToClinicCents]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{money(value as number)}</strong></div>)}</div>
          <p className="cprost-help">التحصيل الزائد ليس صافي الربح؛ لم نخصم مصروفات العيادة. المحجوز محسوب من دفعات جلسات المرضى المؤكدة، وليس مبلغًا مدفوعًا للمعمل.</p>
          <div className="cprost-section-heading"><h3><ClipboardList size={19} aria-hidden="true" />الحالات <bdi>({ledger.cases.length})</bdi></h3><button type="button" className="cprost-button cprost-primary" disabled={browseDisabled || !ledger.remainingCents} onClick={() => browse(controller => {
            if (controller.getState().ledger === ledger) controller.beginPayment();
          })}>دفعة مجمّعة</button></div>
          <div className="cprost-case-list">{ledger.cases.slice(0, caseLimit).map(item => {
            const financial = ledger.caseFinancials.find(row => row.caseId === item.recordId)!;
            const history = ledger.payments.filter(payment => payment.allocations.some(row => row.caseId === item.recordId));
            return <article key={item.recordId} className="cprost-case"><div className="cprost-section-heading"><strong>{financial.patientName} <small>ملف <bdi>{item.fileNo}</bdi></small></strong><span className="cprost-badge">{labels[item.status]}</span></div>
              <p>{item.snapshot.serviceName} — <bdi>{item.snapshot.units}</bdi> وحدة · <time>{item.snapshot.date}</time></p>
              <div className="cprost-case-money"><span>تكلفة المعمل <bdi>{money(item.totalCostCents)}</bdi></span><span>دُفع للمعمل <bdi>{money(item.paidCostCents)}</bdi></span><span>متبقي <bdi>{money(financial.labRemainingCents)}</bdi></span><span>محجوز <bdi>{money(financial.reservedForLabCents)}</bdi></span></div>
              <div className="cprost-actions"><button type="button" className="cprost-button" disabled={browseDisabled} onClick={() => browse(controller => {
                if (controller.getState().ledger === ledger && ledger.cases.includes(item)) controller.beginProgress(item.recordId);
              })}>تحديث الحالة</button><button type="button" className="cprost-button" disabled={browseDisabled || !financial.labRemainingCents} onClick={() => browse(controller => {
                if (controller.getState().ledger === ledger && ledger.cases.includes(item)) controller.beginPayment(item.recordId);
              })}>دفع للمعمل</button></div>
              <details><summary>تاريخ دفعات هذه الحالة <bdi>({history.length})</bdi></summary>{history.length ? history.map(payment => <p key={payment.receiptId} className="cprost-history-row"><time>{payment.date}</time><strong>{money(payment.allocations.find(row => row.caseId === item.recordId)!.amountCents)}</strong><span>{payment.note}</span></p>) : <p>لم تُسجّل دفعات للمعمل على هذه الحالة.</p>}</details>
            </article>;
          })}</div>
          {ledger.cases.length > caseLimit && <button type="button" className="cprost-button" disabled={browseDisabled} onClick={() => browse(() => setCaseLimit(value => value + 25))}>عرض حالات إضافية — الإجماليات تشمل الكل</button>}
          <h3>سجل دفعات المعمل</h3><div>{ledger.payments.slice(0, paymentLimit).map(payment => <div key={payment.receiptId} className="cprost-history-row"><time>{payment.date}</time><strong>{money(payment.amountCents)}</strong><span>{payment.note || 'دفعة نقدية'} — موزعة على <bdi>{payment.allocations.length}</bdi> حالة</span></div>)}</div>
          {ledger.payments.length > paymentLimit && <button type="button" className="cprost-button" disabled={browseDisabled} onClick={() => browse(() => setPaymentLimit(value => value + 25))}>عرض دفعات إضافية</button>}
        </> : <p>لم يُنشأ حساب لهذا المعمل بعد؛ لا يوجد رصيد مفترض.</p>}
      </section>}
      <section className="cprost-surface" aria-label="سجل استرجاع عمليات التركيبات"><div className="cprost-section-heading"><h3><History size={19} aria-hidden="true" />استرجاع العمليات</h3><button type="button" className="cprost-button" disabled={browseDisabled} onClick={() => browse(controller => { void controller.loadHistory(); })}>تحميل السجل</button></div>
        <p>يشمل العمليات الملتزمة حتى لو ضاع تأكيدها. الاسترجاع يُعيد نفس المعرّف ولا يسجّل دفعة جديدة. الترتيب بالمعرّف وليس بالأحدث.</p>
        {!unavailable && state.history.map(intent => <div key={intent.operationId} className="cprost-recovery-row"><span>{statusLabel[intent.status]} <time>{intent.createdAt.slice(0, 10)}</time></span><bdi className="cprost-id" dir="ltr">{intent.operationId}</bdi><button type="button" className="cprost-button" disabled={browseDisabled || intent.status === 'cancelled'} onClick={() => browse(controller => {
          if (controller.getState().history.includes(intent)) void controller.resume(intent.operationId);
        })}>تحقق من نفس العملية</button></div>)}
        {!unavailable && state.historyCursor && <button type="button" className="cprost-button" disabled={browseDisabled} onClick={() => browse(controller => { void controller.loadHistory(true); })}>تحميل عمليات إضافية</button>}
      </section>
    </>}
  </section>;
}
