import React, { useCallback, useRef, useSyncExternalStore } from 'react';
import { ArrowRight, Camera, Download, History, Package, Plus, RefreshCw, Save, Trash2, Wallet, X } from 'lucide-react';
import { buildCloudExpenseCreate, type CloudExpenseWorkspaceController, type CloudExpenseWorkspaceDraft,
  type CloudExpenseSelection } from '../../utils/cloudExpenseWorkspaceController';
import './CloudExpensesWorkspace.css';

export interface CloudExpensesWorkspaceProps { controller: CloudExpenseWorkspaceController; previewOnly?: boolean; disabled?: boolean; onClose?: () => void }
const money = (cents: number) => `${(cents / 100).toLocaleString('ar-EG', { maximumFractionDigits: 2 })} ج.م`;
const quantity = (milli: number) => (milli / 1000).toLocaleString('ar-EG', { maximumFractionDigits: 3 });
const expenseTypes = { rent: 'الإيجار', electricity: 'الكهرباء', water: 'المياه', salary: 'راتب السكرتيرة / موظف', supplies: 'خامات ومستهلكات', maintenance: 'صيانة', other: 'أخرى' };
const categories = { supplies: 'خامات ومستهلكات', fixed: 'مصروف ثابت', maintenance: 'صيانة', other: 'أخرى' };

/** Protected expense/manual invoice interface, not the legacy local OCR modal.
 * No implicit provider, storage, requests or browser record hydration on mount. */
export function CloudExpensesWorkspace(props: CloudExpensesWorkspaceProps) {
  const state = useSyncExternalStore(useCallback(listener => props.controller.subscribe(listener), [props.controller]), props.controller.getState, props.controller.getState);
  const latest = useRef(props); latest.current = props;
  const unavailable = !!props.previewOnly || state.closed, draft = unavailable ? null : state.draft, snapshot = unavailable ? null : state.snapshot;
  const selection = snapshot?.selection ?? null;
  const busy = state.loading || state.historyLoading || state.imageLoading || ['preparing', 'saving'].includes(state.saveStatus);
  const locked = unavailable || !!props.disabled || busy || state.saveStatus !== 'idle';
  const browsable = !locked && !draft;
  const ready = () => { const current = latest.current, value = current.controller.getState();
    return current.controller === props.controller && !current.previewOnly && !current.disabled && !value.closed
      && !value.loading && !value.historyLoading && !value.imageLoading && !['preparing', 'saving'].includes(value.saveStatus); };
  const browse = (work: (controller: CloudExpenseWorkspaceController) => unknown) => {
    if (!ready() || !props.controller.canClose()) return;
    try { void Promise.resolve(work(props.controller)).catch(() => undefined); } catch { /* Controllers own safe status. */ }
  };
  const edit = (expected: CloudExpenseWorkspaceDraft, work: (controller: CloudExpenseWorkspaceController) => unknown) => {
    if (!ready() || props.controller.getState().draft !== expected || props.controller.getState().saveStatus !== 'idle') return;
    try { void Promise.resolve(work(props.controller)).catch(() => undefined); } catch { /* No raw provider errors. */ }
  };
  const update = (expected: CloudExpenseWorkspaceDraft, patch: object) => edit(expected, controller => controller.updateDraft({ ...expected, ...patch }, expected));
  const updateHeader = (expected: Extract<CloudExpenseWorkspaceDraft, { action: 'create' }>, patch: object) => update(expected, { header: { ...expected.header, ...patch } });
  const sameSelection = (expected: CloudExpenseSelection) => props.controller.getState().snapshot?.selection === expected;
  async function upload(file: File, expected: CloudExpenseSelection) {
    if (!ready() || !props.controller.canClose() || !sameSelection(expected)) return;
    await props.controller.prepareImage(async () => {
      const { compressInvoiceImage } = await import('../../utils/invoiceImageCompression');
      const compressed = await compressInvoiceImage(file);
      if (!/^data:image\/jpeg;base64,/.test(compressed.dataUrl)) throw new Error();
      const base64 = compressed.dataUrl.slice('data:image/jpeg;base64,'.length), bytes = Uint8Array.from(atob(base64), value => value.charCodeAt(0));
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return { base64, image: { sha256: Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join(''),
        byteLength: compressed.byteLength, width: compressed.width, height: compressed.height, contentType: 'image/jpeg' } };
    }, expected);
  }
  async function recoverImage(file: File, expectedOperationId: string) {
    if (!ready() || props.controller.getState().pendingOperationId !== expectedOperationId || file.size > 150 * 1024 || file.size < 16 || file.type !== 'image/jpeg') return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!ready() || props.controller.getState().pendingOperationId !== expectedOperationId) return;
    let binary = ''; for (const value of bytes) binary += String.fromCharCode(value);
    await props.controller.provideRecoveryImage(btoa(binary), expectedOperationId);
  }
  function download(expected: CloudExpenseWorkspaceDraft) {
    if (!ready() || props.controller.getState().draft !== expected) return;
    const image = props.controller.getPreparedImage(expected); if (!image || !ready() || props.controller.getState().draft !== expected) return;
    const link = document.createElement('a'); link.href = `data:image/jpeg;base64,${image.base64}`; link.download = 'clinic-invoice-prepared.jpg'; link.click();
  }
  let reviewedTotal: number | null = null;
  if (draft?.action === 'create') { try { reviewedTotal = buildCloudExpenseCreate({ ...draft, paid: draft.paid || '0' }, draft.items.map((_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`)).data.totalCents; } catch { /* Incomplete draft is retained. */ } }
  return <section className="cloud-expenses-workspace" dir="rtl" aria-label="المصروفات والخامات">
    <header className="cexp-surface cexp-heading"><div><h2><Wallet aria-hidden="true" />المصروفات والخامات</h2><p>قيمة الفاتورة ليست مبلغًا مدفوعًا؛ الدفعات الفعلية والمخزون مرتبطان بنفس المستند.</p></div>
      <button type="button" className="cexp-button" disabled={!unavailable && (busy || !!draft || !!state.pendingOperationId || !!props.disabled)} onClick={() => {
        const current = latest.current; if (current.controller !== props.controller || current.disabled) return;
        if (current.previewOnly || current.controller.getState().closed || current.controller.canClose()) current.onClose?.();
      }}><ArrowRight size={18} aria-hidden="true" />إلغاء وإغلاق</button></header>
    {props.previewOnly && <p className="cexp-message">معاينة فارغة فقط — لا مصروفات أو صور أو بيانات افتراضية، ولا قراءة أو حفظ.</p>}
    {!props.previewOnly && state.closed && <p className="cexp-message">أُغلقت مساحة العمل وأُخفيت البيانات.</p>}
    {!unavailable && (state.error || state.imageError) && <p className="cexp-message cexp-error" role="alert">{state.error || state.imageError}</p>}
    {!unavailable && state.notice && <p className="cexp-message" role="status">{state.notice}</p>}
    {!unavailable && ['retry-required', 'refresh-required'].includes(state.saveStatus) && <section className="cexp-surface" aria-label="تأكيد العملية">
      <h3>{state.saveStatus === 'refresh-required' ? 'الحفظ مؤكد — تحديث العرض مطلوب' : 'تأكيد العملية لم يصل'}</h3><p>{state.saveStatus === 'refresh-required' ? 'إعادة التحقق قراءة فقط، دون تسجيل دفعة أو صرف خامات جديد.' : 'أعد نفس العملية الأصلية؛ لا تسجّل فاتورة أو دفعة بديلة قبل التحقق.'}</p><bdi className="cexp-id" dir="ltr">{state.pendingOperationId}</bdi>
      {state.requiresImageBytes && <label className="cexp-upload">اختر نفس JPEG المضغوط الذي حفظته قبل الرفع — لا يُعاد ضغطه<input type="file" accept="image/jpeg" disabled={busy || !!props.disabled} onChange={event => {
        const file = event.target.files?.[0], operationId = state.pendingOperationId; event.target.value = '';
        if (file && operationId) void recoverImage(file, operationId).catch(() => undefined);
      }} /></label>}
      <div className="cexp-actions"><button type="button" className="cexp-button cexp-primary" disabled={busy || !!props.disabled || state.requiresImageBytes} onClick={() => {
        if (ready() && props.controller.getState().pendingOperationId === state.pendingOperationId) void props.controller.retry();
      }}><RefreshCw size={18} aria-hidden="true" />{state.saveStatus === 'refresh-required' ? 'إعادة التحقق بالقراءة' : 'إعادة نفس المحاولة'}</button>
        {state.saveStatus === 'retry-required' && <button type="button" className="cexp-button" disabled={busy || !!props.disabled} onClick={() => {
          if (ready() && props.controller.getState().pendingOperationId === state.pendingOperationId) void props.controller.cancelPending();
        }}>التحقق من إلغاء العملية</button>}</div></section>}
    {draft ? <form className="cexp-surface cexp-editor" onSubmit={event => { event.preventDefault(); edit(draft, controller => controller.save(draft)); }}>
      <h3>{draft.action === 'create' ? 'فاتورة أو مصروف جديد — مسودة' : draft.action === 'pay' ? 'تسجيل دفعة للمورد' : draft.action === 'edit' ? 'تعديل وصف المصروف' : draft.action === 'usage' ? 'تسجيل استهلاك / هالك' : 'مراجعة صورة الفاتورة المضغوطة'}</h3>
      <fieldset disabled={locked}>
        {draft.action === 'create' ? <><div className="cexp-fields"><label>عنوان المصروف<input value={draft.header.title} maxLength={200} onChange={event => updateHeader(draft, { title: event.target.value })} /></label>
          <label>نوع المصروف<select value={draft.header.expenseType} onChange={event => updateHeader(draft, { expenseType: event.target.value })}>{Object.entries(expenseTypes).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label>القسم<select value={draft.header.category} onChange={event => updateHeader(draft, { category: event.target.value })}>{Object.entries(categories).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label>تاريخ المصروف<input type="date" value={draft.header.date} onChange={event => updateHeader(draft, { date: event.target.value })} /></label></div>
          <details><summary>المورد وبيانات الفاتورة</summary><div className="cexp-fields">{[['supplierName', 'اسم المورد'], ['supplierPhone', 'موبايل المورد'], ['supplierAddress', 'عنوان المورد'], ['invoiceNumber', 'رقم الفاتورة'], ['taxNumber', 'الرقم الضريبي'], ['commercialRecord', 'السجل التجاري']].map(([key, label]) => <label key={key}>{label}<input value={draft.header[key as keyof typeof draft.header] as string} onChange={event => updateHeader(draft, { [key]: event.target.value })} /></label>)}
            <label>تاريخ الفاتورة<input type="date" value={draft.header.invoiceDate} onChange={event => updateHeader(draft, { invoiceDate: event.target.value })} /></label><label>وقت الفاتورة — اختياري<input type="time" value={draft.header.invoiceTime} onChange={event => updateHeader(draft, { invoiceTime: event.target.value })} /></label></div></details>
          <div className="cexp-heading"><h4>الأصناف والخامات <bdi>({draft.items.length}/٢٠)</bdi></h4><button type="button" className="cexp-button" disabled={locked || draft.items.length >= 20} onClick={() => edit(draft, controller => controller.addItem(draft))}><Plus size={18} aria-hidden="true" />إضافة صنف</button></div>
          <p className="cexp-help">الاستخراج الآلي غير مُهيّأ حاليًا. أدخل الأصناف وراجعها يدويًا؛ لا نستنتج المدفوع من كلمة «نقدي». يمكنك إرفاق الصورة بعد حفظ الفاتورة.</p>
          <div className="cexp-items">{draft.items.map(item => <section key={item.key} className="cexp-item"><div className="cexp-fields">{[['name', 'اسم الصنف'], ['unit', 'الوحدة'], ['quantity', 'الكمية'], ['unitPrice', 'سعر الوحدة — ج.م'], ['discount', 'خصم الصنف — ج.م'], ['tax', 'ضريبة الصنف — ج.م']].map(([key, label]) => <label key={key}>{label}<input value={item[key as keyof typeof item] as string} inputMode={['quantity', 'unitPrice', 'discount', 'tax'].includes(key) ? 'decimal' : undefined} onChange={event => update(draft, { items: draft.items.map(row => row.key === item.key ? { ...row, [key]: event.target.value } : row) })} /></label>)}</div>
            <button type="button" className="cexp-button" disabled={locked} onClick={() => edit(draft, controller => controller.removeItem(item.key, draft))}><Trash2 size={17} aria-hidden="true" />حذف الصنف من المسودة</button></section>)}</div>
          <div className="cexp-fields">{!draft.items.length && <label>قيمة المصروف قبل الضريبة والخصم — ج.م<input inputMode="decimal" value={draft.subtotal} onChange={event => update(draft, { subtotal: event.target.value })} /></label>}
            <label>ضريبة إضافية على الفاتورة — ج.م<input inputMode="decimal" value={draft.tax} onChange={event => update(draft, { tax: event.target.value })} /></label><label>خصم إضافي على الفاتورة — ج.م<input inputMode="decimal" value={draft.discount} onChange={event => update(draft, { discount: event.target.value })} /></label>
            <label>ما دفعته فعلًا الآن — ج.م<input inputMode="decimal" value={draft.paid} placeholder="اكتب ٠ إن لم تدفع" onChange={event => update(draft, { paid: event.target.value })} /></label></div>
          <p className="cexp-total">قيمة الفاتورة <strong>{reviewedTotal === null ? 'أكمل القيم والأصناف' : money(reviewedTotal)}</strong></p>
          <label className="cexp-checkbox"><input type="checkbox" checked={draft.header.isFixed} onChange={event => updateHeader(draft, { isFixed: event.target.checked })} />مصروف ثابت</label><label>التكرار<select value={draft.header.recurringPeriod} onChange={event => updateHeader(draft, { recurringPeriod: event.target.value })}><option value="none">بدون تكرار</option><option value="monthly">شهري — وصف فقط</option><option value="yearly">سنوي — وصف فقط</option></select></label>
          <label>ملاحظات<textarea rows={2} value={draft.header.note} onChange={event => updateHeader(draft, { note: event.target.value })} /></label></>
          : draft.action === 'pay' ? <><div className="cexp-fields"><label>المبلغ المدفوع فعلًا — ج.م<input inputMode="decimal" value={draft.amount} onChange={event => update(draft, { amount: event.target.value })} /></label><label>تاريخ الدفعة<input type="date" value={draft.date} onChange={event => update(draft, { date: event.target.value })} /></label></div><label>ملاحظات<textarea value={draft.note} onChange={event => update(draft, { note: event.target.value })} /></label></>
            : draft.action === 'usage' ? <><div className="cexp-fields"><label>الكمية — حتى ٣ منازل عشرية<input inputMode="decimal" value={draft.quantity} onChange={event => update(draft, { quantity: event.target.value })} /></label><label>نوع الحركة<select value={draft.kind} onChange={event => update(draft, { kind: event.target.value })}><option value="used">استهلاك</option><option value="waste">هالك</option></select></label><label>التاريخ<input type="date" value={draft.date} onChange={event => update(draft, { date: event.target.value })} /></label></div><label>ملاحظات<textarea value={draft.note} onChange={event => update(draft, { note: event.target.value })} /></label></>
              : draft.action === 'edit' ? <><div className="cexp-fields"><label>العنوان<input value={draft.data.title} onChange={event => update(draft, { data: { ...draft.data, title: event.target.value } })} /></label><label>التاريخ<input type="date" value={draft.data.date} onChange={event => update(draft, { data: { ...draft.data, date: event.target.value } })} /></label><label>النوع<select value={draft.data.expenseType} onChange={event => update(draft, { data: { ...draft.data, expenseType: event.target.value } })}>{Object.entries(expenseTypes).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>التكرار<select value={draft.data.recurringPeriod} onChange={event => update(draft, { data: { ...draft.data, recurringPeriod: event.target.value } })}><option value="none">بدون</option><option value="monthly">شهري</option><option value="yearly">سنوي</option></select></label></div><label className="cexp-checkbox"><input type="checkbox" checked={draft.data.isFixed} onChange={event => update(draft, { data: { ...draft.data, isFixed: event.target.checked } })} />مصروف ثابت</label><label>ملاحظات<textarea value={draft.data.note} onChange={event => update(draft, { data: { ...draft.data, note: event.target.value } })} /></label><p>تعديل الوصف لا يغيّر مبلغ الفاتورة أو الدفعات أو كميات الشراء.</p></>
                : <><p>JPEG مضغوط <bdi>{Math.ceil(draft.image.byteLength / 1024)}</bdi> كيلوبايت — <bdi>{draft.image.width} × {draft.image.height}</bdi>. لن يُرفع الأصل، ولن تدخل الصورة في سجل العمليات.</p><p>احفظ نسخة الصورة المضغوطة قبل الرفع لتستطيع استكمال نفس المحاولة إذا أغلقت المتصفح قبل تأكيدها.</p><button type="button" className="cexp-button" disabled={locked || !state.imageBytesReady} onClick={() => download(draft)}><Download size={18} aria-hidden="true" />تنزيل الصورة المضغوطة للاسترجاع</button></>}
      </fieldset><div className="cexp-actions"><button type="submit" className="cexp-button cexp-primary" disabled={locked || draft.action === 'attach-image' && !state.imageBytesReady}><Save size={18} aria-hidden="true" />حفظ العملية</button><button type="button" className="cexp-button" disabled={locked} onClick={() => edit(draft, controller => controller.cancelDraft(draft))}><X size={18} aria-hidden="true" />إلغاء المسودة</button></div>
    </form> : <>
      <section className="cexp-surface"><div className="cexp-heading"><h3>سجل المصروفات</h3><div className="cexp-actions"><button type="button" className="cexp-button" disabled={!browsable} onClick={() => browse(controller => controller.loadExpenses())}><RefreshCw size={18} aria-hidden="true" />تحميل المصروفات</button><button type="button" className="cexp-button cexp-primary" disabled={!browsable} onClick={() => browse(controller => controller.beginCreate())}><Plus size={18} aria-hidden="true" />مصروف أو فاتورة</button></div></div>
        <p className="cexp-help">قائمة صفحات بترتيب المعرّف، وليست الأحدث أو إجمالي الشهر. تفاصيل الفاتورة تُقرأ كاملة عند فتحها.</p><div className="cexp-list">{snapshot?.expenses.map(record => <button type="button" key={record.recordId} className="cexp-row" disabled={!browsable} onClick={() => browse(controller => {
          if (controller.getState().snapshot?.expenses.includes(record)) return controller.openExpense(record.recordId);
        })}><span><strong>{record.data.title}</strong><small>{record.data.supplierName || expenseTypes[record.data.expenseType]} · <time>{record.data.date}</time></small></span><span><bdi>{money(record.data.totalCents)}</bdi><small>المدفوع <bdi>{money(record.paidCents)}</bdi></small></span></button>)}</div>
        {snapshot?.expenseCursor && <button type="button" className="cexp-button" disabled={!browsable} onClick={() => browse(controller => controller.loadExpenses(true))}>تحميل مصروفات إضافية</button>}</section>
      <section className="cexp-surface"><div className="cexp-heading"><h3><Package size={20} aria-hidden="true" />الخامات</h3><button type="button" className="cexp-button" disabled={!browsable} onClick={() => browse(controller => controller.loadMaterials())}>تحميل الخامات</button></div><p className="cexp-help">تُضاف كميات الشراء من أصناف الفواتير، ولا يتكرر الشراء عند تسجيل دفعة.</p>
        <div className="cexp-list">{snapshot?.materials.map(record => <button type="button" className="cexp-row" key={record.recordId} disabled={!browsable} onClick={() => browse(controller => {
          if (controller.getState().snapshot?.materials.includes(record)) return controller.openMaterial(record.recordId);
        })}><strong>{record.name}</strong><span>المتاح <bdi>{quantity(record.purchasedMilli - record.usedMilli - record.wasteMilli)}</bdi> {record.unit}</span></button>)}</div>
        {snapshot?.materialCursor && <button type="button" className="cexp-button" disabled={!browsable} onClick={() => browse(controller => controller.loadMaterials(true))}>تحميل خامات إضافية</button>}</section>
      {selection && <section className="cexp-surface" aria-label="تفاصيل السجل المحدد">{selection.kind === 'expense' ? <><div className="cexp-heading"><h3>{selection.record.data.title}</h3><div className="cexp-actions"><button type="button" className="cexp-button" disabled={!browsable} onClick={() => browse(controller => sameSelection(selection) && controller.beginEdit(selection))}>تعديل الوصف</button><button type="button" className="cexp-button cexp-primary" disabled={!browsable || selection.record.paidCents >= selection.record.data.totalCents} onClick={() => browse(controller => sameSelection(selection) && controller.beginPayment(selection))}>تسجيل دفعة</button></div></div>
        <div className="cexp-metrics"><div><span>قيمة الفاتورة</span><strong>{money(selection.record.data.totalCents)}</strong></div><div><span>المدفوع فعلًا</span><strong>{money(selection.record.paidCents)}</strong></div><div><span>المتبقي</span><strong>{money(selection.record.data.totalCents - selection.record.paidCents)}</strong></div></div>
        {selection.record.data.items.map(item => <p key={item.itemId}>{item.name} · <bdi>{quantity(item.quantityMilli)}</bdi> {item.unit} · <bdi>{money(item.totalCents)}</bdi></p>)}
        <h4>تاريخ الدفعات — كامل ومؤكد</h4>{selection.payments.length ? selection.payments.map(payment => <div className="cexp-history-row" key={payment.recordId}><time>{payment.date}</time><strong>{money(payment.amountCents)}</strong><span>{payment.note}</span></div>) : <p>لم تُسجّل دفعات لهذه الفاتورة.</p>}
        <div className="cexp-actions"><label className="cexp-upload"><Camera size={18} aria-hidden="true" />إرفاق / استبدال صورة بعد الضغط<input type="file" accept="image/jpeg,image/png,image/webp" disabled={!browsable} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload(file, selection).catch(() => undefined); }} /></label>
          {selection.record.imageId && <button type="button" className="cexp-button" disabled={!browsable} onClick={() => browse(controller => sameSelection(selection) && controller.loadImage(selection))}>عرض صورة الفاتورة</button>}</div>
      </> : <><div className="cexp-heading"><h3>{selection.record.name}</h3><button type="button" className="cexp-button cexp-primary" disabled={!browsable} onClick={() => browse(controller => sameSelection(selection) && controller.beginUsage(selection))}>استهلاك أو هالك</button></div><div className="cexp-metrics"><div><span>تم شراؤه</span><strong>{quantity(selection.record.purchasedMilli)} {selection.record.unit}</strong></div><div><span>تكلفة الشراء</span><strong>{money(selection.record.purchaseCostCents)}</strong></div><div><span>تكلفة المستهلك والهالك</span><strong>{money(selection.record.consumedCostCents)}</strong></div></div>
        <h4>حركات الاستهلاك والهالك — كاملة ومؤكدة</h4>{selection.usages.map(usage => <div className="cexp-history-row" key={usage.recordId}><time>{usage.date}</time><strong>{usage.kind === 'used' ? 'استهلاك' : 'هالك'} <bdi>{quantity(usage.quantityMilli)}</bdi></strong><span>{money(usage.costCents)} · {usage.note}</span></div>)}</>}
      </section>}
      {!unavailable && state.image && <section className="cexp-surface" aria-label="صورة الفاتورة المؤكدة"><button type="button" className="cexp-button" disabled={busy || !!props.disabled} onClick={() => { if (ready() && props.controller.getState().image === state.image) props.controller.hideImage(); }}>إغلاق الصورة</button><img className="cexp-invoice-image" src={`data:image/jpeg;base64,${state.image.base64}`} alt="صورة الفاتورة المؤكدة من الخادم" /></section>}
      <section className="cexp-surface"><div className="cexp-heading"><h3><History size={20} aria-hidden="true" />استرجاع عمليات المصروفات</h3><button type="button" className="cexp-button" disabled={!browsable} onClick={() => browse(controller => controller.loadHistory())}>تحميل سجل العمليات</button></div><p>يشمل الملتزمة والمنتظرة والملغاة؛ بترتيب المعرّف لا الأحدث. إعادة العملية الأصلية لا تُكرر الدفع أو المخزون.</p>
        {!unavailable && state.history.map(intent => <div className="cexp-recovery-row" key={intent.operationId}><span>{intent.status === 'committed' ? 'ملتزمة' : intent.status === 'cancelled' ? 'ملغاة' : 'منتظرة'} · <time>{intent.createdAt.slice(0, 10)}</time></span><bdi className="cexp-id" dir="ltr">{intent.operationId}</bdi><button type="button" className="cexp-button" disabled={!browsable || intent.status === 'cancelled'} onClick={() => browse(controller => {
          if (controller.getState().history.includes(intent)) return controller.resume(intent.operationId);
        })}>التحقق من نفس العملية</button></div>)}
        {!unavailable && state.historyNextAfterId && <button type="button" className="cexp-button" disabled={!browsable} onClick={() => browse(controller => controller.loadMoreHistory())}>تحميل عمليات إضافية</button>}</section>
    </>}
  </section>;
}
