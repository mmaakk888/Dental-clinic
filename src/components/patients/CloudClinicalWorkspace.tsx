import React, { useCallback, useId, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowDown, Check, ClipboardList, CreditCard, History, MessageCircle, Pencil, Phone, RefreshCw, ShieldCheck, X } from 'lucide-react';
import type { Session } from '../../types';
import type { CloudClinicalProgress } from '../../utils/cloudClinicalRepository';
import type { CloudClinicalPatientSnapshot } from '../../utils/cloudClinicalPatientProjection';
import type { CloudClinicalWorkspaceState } from '../../utils/cloudClinicalWorkspaceController';
import type { CloudClinicalRecoveryState } from '../../utils/cloudClinicalRecoveryController';
import type { CloudClinicalWorkspaceBundle } from '../../utils/cloudClinicalUiStage';
import type { CloudOperationIntent } from '../../utils/cloudOperationIntent';
import { normalizeContactPhone } from '../../utils/clinicContacts';
import { normalizeDirectoryDigits } from '../../utils/patientDirectory';
import './CloudClinicalWorkspace.css';

export interface CloudClinicalEditor {
  mode: 'payment' | 'progress'; snapshot: CloudClinicalPatientSnapshot; session: Session;
  amount: string; date: string; note: string; progress: CloudClinicalProgress;
}
const money = (cents: number) => `${(cents / 100).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ج.م`;
const stages: Record<CloudClinicalProgress['treatmentStage'], string> = { single: 'جلسة واحدة', first: 'الجلسة الأولى', second: 'الجلسة الثانية', third: 'الجلسة الثالثة', follow_up: 'متابعة' };
const roots: Record<CloudClinicalProgress['rootCanalStatus'], string> = { '': 'غير محدد', access_cleaning: 'فتح وتنظيف', working_length: 'تحديد طول القنوات', canal_filled: 'حشو العصب', impression: 'أخذ المقاس', final_restoration: 'الحشو النهائي' };
const busy = (state: CloudClinicalWorkspaceState) => state.loading || state.saveStatus !== 'idle';
function parseAmount(value: string): number | null {
  const text = normalizeDirectoryDigits(value.trim()).replace('٫', '.');
  if (!/^[0-9]{1,11}(?:\.[0-9]{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents > 0 && cents <= 1_000_000_000_000 ? cents : null;
}
function today() { const value = new Date(); return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`; }
const button = 'ccw-button', primary = `${button} ccw-primary`;

export interface CloudClinicalWorkspaceViewProps {
  state: CloudClinicalWorkspaceState; recovery: CloudClinicalRecoveryState;
  editor: CloudClinicalEditor | null; previewOnly?: boolean; closing?: boolean;
  onClose: () => void; onRefresh: () => void; onRetry: () => void; onCancelPending: () => void;
  onStartEdit: (snapshot: CloudClinicalPatientSnapshot, session: Session, mode: CloudClinicalEditor['mode']) => void;
  onChangeEditor: (editor: CloudClinicalEditor, patch: Partial<Pick<CloudClinicalEditor, 'amount' | 'date' | 'note' | 'progress'>>) => void;
  onSave: (editor: CloudClinicalEditor) => void; onCancelEditor: (editor: CloudClinicalEditor) => void;
  onContact: (snapshot: CloudClinicalPatientSnapshot) => boolean;
  onRecoveryLoad: () => void; onRecoveryMore: () => void; onResume: (intent: CloudOperationIntent) => void;
}

/** Presentation only: never opens a file, initializes Auth or fetches on mount. */
export function CloudClinicalWorkspaceView(props: CloudClinicalWorkspaceViewProps) {
  const { state, recovery, previewOnly = false, closing = false } = props, prefix = useId();
  const unavailable = previewOnly || state.closed || recovery.closed;
  const snapshot = unavailable || !state.loaded ? null : state.snapshot;
  const editor = snapshot && props.editor?.snapshot === snapshot ? props.editor : null;
  const locked = unavailable || closing || busy(state) || recovery.loading;
  const dirty = !unavailable && state.draftDirty;
  const guard = (work: () => void) => { if (!locked) work(); };
  const phone = snapshot ? normalizeContactPhone(snapshot.profile.data.mobile) : '';
  const contactLocked = locked || dirty || Boolean(editor);
  const closeBlocked = closing || !previewOnly && !state.closed && (busy(state) || recovery.loading || dirty || Boolean(editor));
  const pending = !unavailable && state.pendingOperationId;
  const recoveryRecords = unavailable ? [] : recovery.records;
  const amount = editor ? parseAmount(editor.amount) : null;
  const maxPayment = editor && snapshot ? Math.min(Math.round(editor.session.remain * 100), snapshot.totalCents - snapshot.paidCents) : 0;
  const amountInvalid = Boolean(editor?.mode === 'payment' && editor.amount && (amount === null || amount > maxPayment));
  const receiptRows = snapshot ? snapshot.patient.sessions.flatMap(session => (session.paymentsLog ?? []).map(receipt => ({ session, receipt })))
    .sort((a, b) => b.receipt.date.localeCompare(a.receipt.date) || a.receipt.id.localeCompare(b.receipt.id)) : [];
  return <section className="cloud-clinical-workspace" dir="rtl" aria-label="حساب وجلسات ملف المريض">
    <header className="ccw-surface ccw-header"><div className="ccw-heading"><span className="ccw-icon"><ClipboardList size={23} aria-hidden="true" /></span><div>
      <h2>{snapshot ? snapshot.profile.data.name : 'الجلسات وحساب ملف المريض'}</h2>
      <p>{snapshot ? `رقم الملف ${snapshot.profile.fileNo.toLocaleString('ar-EG', { useGrouping: false })} · سجل كامل تم التحقق منه` : 'حساب ملف واحد، وليس إجمالي العيادة'}</p>
    </div></div><div className="ccw-actions"><button type="button" className={button} disabled={locked || dirty || Boolean(editor) || !state.patientRecordId} onClick={() => guard(() => { if (!dirty && !editor) props.onRefresh(); })}><RefreshCw size={18} aria-hidden="true" />تحديث الملف</button>
      <button type="button" className={button} disabled={closeBlocked} onClick={() => { if (!closeBlocked) props.onClose(); }}><X size={18} aria-hidden="true" />إلغاء وإغلاق</button></div></header>
    {previewOnly ? <p className="ccw-message ccw-info">معاينة تصميم فقط — بلا ملفات أو أرصدة أو عمليات فعلية. القراءة والحفظ غير مفعّلين.</p> : !unavailable && <>
      {closeBlocked && <p className="ccw-message">ألغِ المسودة صراحة أو تحقّق من العملية المعلقة قبل إغلاق الملف. الخروج من الحساب لا يلغي كتابة قبلها الخادم.</p>}
      {state.loading && <p role="status" className="ccw-message">جارٍ التحقق من سجل الملف كاملًا…</p>}
      {state.error && <p role="alert" className="ccw-message ccw-error">{state.error}</p>}
      {state.notice && <p role="status" className="ccw-message ccw-success">{state.notice}</p>}
    </>}
    {pending && <section className="ccw-surface ccw-warning" aria-label="عملية تحتاج التحقق"><h3>تحقّق من نفس العملية</h3><p>لا تسجّل دفعة بديلة. إعادة التحقق تستخدم المعرف الأصلي، وبعد تأكيد الحفظ تعيد القراءة فقط.</p><p className="ccw-operation" dir="ltr">{pending}</p>
      <div className="ccw-actions"><button type="button" className={primary} disabled={closing || state.loading || recovery.loading || ['saving', 'preparing'].includes(state.saveStatus)} onClick={() => { if (!previewOnly && !closing && !state.loading && !recovery.loading && ['retry-required', 'refresh-required'].includes(state.saveStatus)) props.onRetry(); }}><RefreshCw size={18} aria-hidden="true" />{state.saveStatus === 'refresh-required' ? 'تحديث النتيجة — قراءة فقط' : 'إعادة نفس المحاولة'}</button>
        {state.saveStatus === 'retry-required' && <button type="button" className={button} disabled={closing || state.loading || recovery.loading} onClick={() => { if (!previewOnly && !closing && !state.loading && !recovery.loading) props.onCancelPending(); }}>التحقق من إمكانية إلغاء العملية</button>}</div></section>}
    <div className="ccw-columns"><main className="ccw-main">
      {snapshot ? <>
        <section className="ccw-surface" aria-label="ملخص حساب الملف"><div className="ccw-totals"><div><span>إجمالي الخدمات</span><strong>{money(snapshot.totalCents)}</strong></div><div><span>المحصّل فعليًا</span><strong>{money(snapshot.paidCents)}</strong></div><div className="ccw-balance"><span>المتبقي</span><strong>{money(snapshot.totalCents - snapshot.paidCents)}</strong></div></div>
          <div className="ccw-contact"><p>{phone ? <bdi>{snapshot.profile.data.mobile}</bdi> : 'لم يُسجل رقم موبايل لهذا الملف'}</p>{phone && <div className="ccw-actions">
            <a className={button} href={contactLocked ? undefined : `tel:+${phone}`} tabIndex={contactLocked ? -1 : undefined} aria-disabled={contactLocked} onClick={event => { if (contactLocked || !props.onContact(snapshot)) event.preventDefault(); }}><Phone size={18} aria-hidden="true" />اتصال</a>
            <a className={`${button} ccw-whatsapp`} href={contactLocked ? undefined : `https://wa.me/${phone}`} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" tabIndex={contactLocked ? -1 : undefined} aria-disabled={contactLocked} onClick={event => { if (contactLocked || !props.onContact(snapshot)) event.preventDefault(); }}><MessageCircle size={18} aria-hidden="true" />واتساب</a></div>}</div>
          <p className="ccw-help">الكشف والخدمات مبالغ مستحقة؛ التحصيل هو الإيصالات المسجلة فقط. لا تكاليف معامل في هذه الشاشة.</p>
        </section>
        {editor && <section className="ccw-surface ccw-editor" aria-label={editor.mode === 'payment' ? 'تسجيل دفعة' : 'تحديث متابعة العلاج'}><h3>{editor.mode === 'payment' ? 'تسجيل دفعة نقدية' : 'تحديث متابعة العلاج'}</h3><p>{editor.session.type} · <bdi>{editor.session.date}</bdi></p>
          <form onSubmit={event => { event.preventDefault(); guard(() => { if (editor.mode !== 'payment' || amount !== null && amount <= maxPayment) props.onSave(editor); }); }}>
            <fieldset disabled={locked}><legend className="ccw-sr">بيانات {editor.mode === 'payment' ? 'الدفعة' : 'المتابعة'}</legend>
              {editor.mode === 'payment' ? <><div className="ccw-pair"><div><label htmlFor={`${prefix}-amount`}>المبلغ المحصّل فعلًا</label><input id={`${prefix}-amount`} type="text" inputMode="decimal" dir="ltr" autoComplete="off" value={editor.amount} aria-invalid={amountInvalid || undefined} aria-describedby={`${prefix}-amount-help`} onChange={event => guard(() => props.onChangeEditor(editor, { amount: event.target.value }))} required maxLength={15} /></div>
                <div><label htmlFor={`${prefix}-date`}>تاريخ الدفعة</label><input id={`${prefix}-date`} type="date" dir="ltr" required min="1900-01-01" max="9999-12-31" value={editor.date} onChange={event => guard(() => props.onChangeEditor(editor, { date: event.target.value }))} /></div></div>
                <p id={`${prefix}-amount-help`} className={amountInvalid ? 'ccw-field-error' : 'ccw-help'}>أقصى تحصيل متاح: {money(maxPayment)}. لا مبلغ تلقائي، ولا تحصيل أكثر من المتبقي.</p>
                <label htmlFor={`${prefix}-note`}>ملاحظة الدفعة — اختياري</label><textarea id={`${prefix}-note`} rows={2} maxLength={1000} value={editor.note} onChange={event => guard(() => props.onChangeEditor(editor, { note: event.target.value }))} /></>
                : <><div className="ccw-pair"><div><label htmlFor={`${prefix}-stage`}>مرحلة العلاج</label><select id={`${prefix}-stage`} value={editor.progress.treatmentStage} onChange={event => guard(() => props.onChangeEditor(editor, { progress: { ...editor.progress, treatmentStage: event.target.value as CloudClinicalProgress['treatmentStage'] } }))}>{Object.entries(stages).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
                  <div><label htmlFor={`${prefix}-root`}>خطوة علاج العصب — إن وجدت</label><select id={`${prefix}-root`} value={editor.progress.rootCanalStatus} onChange={event => guard(() => props.onChangeEditor(editor, { progress: { ...editor.progress, rootCanalStatus: event.target.value as CloudClinicalProgress['rootCanalStatus'] } }))}>{Object.entries(roots).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div></div>
                  <label htmlFor={`${prefix}-status`}>حالة الزيارة</label><select id={`${prefix}-status`} value={editor.progress.visitStatus} onChange={event => guard(() => props.onChangeEditor(editor, { progress: { ...editor.progress, visitStatus: event.target.value as CloudClinicalProgress['visitStatus'] } }))}><option value="completed">مكتملة</option><option value="follow_up">تحتاج متابعة</option></select>
                  <label htmlFor={`${prefix}-notes`}>ملاحظات العلاج</label><textarea id={`${prefix}-notes`} rows={3} maxLength={4000} value={editor.progress.notes} onChange={event => guard(() => props.onChangeEditor(editor, { progress: { ...editor.progress, notes: event.target.value } }))} /><p className="ccw-help">المتابعة لا تضيف خدمة أو مبلغًا أو إيصالًا جديدًا.</p></>}
            </fieldset><div className="ccw-actions"><button className={primary} type="submit" disabled={locked || editor.mode === 'payment' && (amount === null || amount > maxPayment)}><Check size={18} aria-hidden="true" />{editor.mode === 'payment' ? 'تأكيد تسجيل الدفعة' : 'حفظ المتابعة'}</button>
              <button className={button} type="button" disabled={locked} onClick={() => guard(() => props.onCancelEditor(editor))}>إلغاء المسودة</button></div>
          </form></section>}
        <section className="ccw-surface" aria-label="جلسات الملف"><div className="ccw-section-title"><h3>الجلسات والخدمات</h3><span>{snapshot.patient.sessions.length.toLocaleString('ar-EG')} جلسة</span></div>
          {!snapshot.patient.sessions.length && <p className="ccw-empty">لا جلسات مسجلة لهذا الملف بعد.</p>}
          <div className="ccw-list">{snapshot.patient.sessions.map(session => <article className="ccw-session" key={session.id}><header><div><h4>{session.type}</h4><p>تاريخ الجلسة · <bdi>{session.date}</bdi></p></div><span className="ccw-pill">{session.visitStatus === 'follow_up' ? 'تحتاج متابعة' : 'مكتملة'}</span></header>
            <dl className="ccw-session-totals"><div><dt>القيمة</dt><dd>{money(Math.round(session.amount * 100))}</dd></div><div><dt>المحصّل</dt><dd>{money(Math.round(session.paid * 100))}</dd></div><div><dt>المتبقي</dt><dd>{money(Math.round(session.remain * 100))}</dd></div></dl>
            <details><summary>تفاصيل الخدمة والمتابعة</summary><div className="ccw-details"><p>مرحلة العلاج: {stages[session.treatmentStage ?? 'single']}</p>{session.rootCanalStatus && <p>العصب: {roots[session.rootCanalStatus]}</p>}{session.teethIds?.length ? <p>الأسنان: <bdi>{session.teethIds.join(' · ')}</bdi></p> : <p>لم تُحدد أسنان</p>}
              {(session.services ?? []).map(service => <p key={service.id}>{service.name} — {money(Math.round(service.price * 100))}</p>)}{Boolean(session.examinationFee) && <p>قيمة الكشف المسجلة: {money(Math.round(session.examinationFee! * 100))}</p>}{session.visitNotes && <p className="ccw-notes">{session.visitNotes}</p>}</div></details>
            <div className="ccw-actions"><button className={primary} type="button" disabled={locked || dirty || Boolean(editor) || session.remain <= 0 || snapshot.totalCents <= snapshot.paidCents} onClick={() => guard(() => { if (!dirty && !editor) props.onStartEdit(snapshot, session, 'payment'); })}><CreditCard size={18} aria-hidden="true" />تسجيل دفعة</button>
              <button className={button} type="button" disabled={locked || dirty || Boolean(editor)} onClick={() => guard(() => { if (!dirty && !editor) props.onStartEdit(snapshot, session, 'progress'); })}><Pencil size={18} aria-hidden="true" />تحديث المتابعة</button></div></article>)}</div>
        </section>
        <section className="ccw-surface" aria-label="تاريخ التحصيل"><h3>سجل المدفوعات الفعلية</h3>{!receiptRows.length ? <p className="ccw-empty">لا إيصالات تحصيل مسجلة.</p> : <ol className="ccw-receipts">{receiptRows.map(({ session, receipt }) => <li key={receipt.id}><div><strong>{money(Math.round(receipt.amount * 100))}</strong><p>{session.type} · <bdi>{receipt.date}</bdi></p>{receipt.note && <p className="ccw-notes">{receipt.note}</p>}</div><span className="ccw-pill">نقدي</span></li>)}</ol>}</section>
      </> : <section className="ccw-surface ccw-empty"><ClipboardList size={32} aria-hidden="true" /><h3>لا يوجد حساب معروض</h3><p>{previewOnly ? 'تظهر هنا الجلسات والحساب بعد تفعيل الربط واختيار ملف.' : state.patientRecordId ? 'اضغط تحديث الملف لقراءة سجل كامل ومؤكد.' : 'اختر ملفًا من قائمة المرضى لقراءة حسابه. لا تُقرأ ملفات تلقائيًا.'}</p><p>الحساب غير المقروء لا يعني أن الرصيد صفر.</p></section>}
      <p className="ccw-message ccw-info">تسجيل زيارة أو خدمة جديدة غير متاح في هذا المسار بعد؛ يلزم ربط فهرس الخدمات والأسعار والإعدادات أولًا. هذه الشاشة لا تستخدم أسعارًا أو بيانات محلية بديلة.</p>
    </main><aside className="ccw-surface ccw-recovery" aria-label="استرجاع العمليات"><div className="ccw-section-title"><h3><History size={20} aria-hidden="true" />سجل العمليات والاسترجاع</h3></div><p className="ccw-help">يعرض الصفحات المحمّلة بترتيب المعرف، وليس الأحدث أو كل عمليات العيادة. المتابعة تتحقق من الأمر الأصلي وقد تستكمله، دون إنشاء دفعة بديلة.</p>
      <button className={button} type="button" disabled={locked || dirty || Boolean(editor)} onClick={() => guard(() => { if (!dirty && !editor) props.onRecoveryLoad(); })}><RefreshCw size={18} aria-hidden="true" />{recovery.loaded && !unavailable ? 'تحديث سجل العمليات' : 'تحميل سجل العمليات'}</button>
      {!unavailable && recovery.loading && <p role="status" className="ccw-help">جارٍ تحميل السجل…</p>}{!unavailable && recovery.error && <p role="alert" className="ccw-message ccw-error">{recovery.error}</p>}{!unavailable && recovery.notice && <p role="status" className="ccw-message">{recovery.notice}</p>}
      {!unavailable && recovery.loaded && !recoveryRecords.length && <p className="ccw-empty">لا عمليات في الصفحات المحمّلة.</p>}
      <div className="ccw-list">{recoveryRecords.map(intent => <article className="ccw-recovery-item" key={intent.operationId}><strong>{intent.command.action === 'payment' ? 'دفعة نقدية' : intent.command.action === 'progress' ? 'متابعة علاج' : 'تسجيل زيارة'}</strong><span className="ccw-pill">{intent.status === 'prepared' ? 'محضّرة — تحتاج تحققًا' : intent.status === 'committed' ? 'حُفظت — يمكن التحقق من نتيجتها' : 'أُلغيت — لا تُستأنف'}</span><time dateTime={intent.createdAt}><bdi>{intent.createdAt.replace('T', ' ').replace('.000Z', ' UTC')}</bdi></time><p className="ccw-operation" dir="ltr">{intent.operationId}</p>
        <button className={button} type="button" disabled={locked || dirty || Boolean(editor) || intent.status === 'cancelled'} onClick={() => guard(() => { if (!dirty && !editor && intent.status !== 'cancelled') props.onResume(intent); })}>{intent.status === 'committed' ? 'التحقق من نتيجة العملية الأصلية' : intent.status === 'cancelled' ? 'عملية ملغاة' : 'استرجاع ومتابعة العملية الأصلية'}</button></article>)}</div>
      {!unavailable && recovery.nextAfterId && <button className={button} type="button" disabled={locked || dirty || Boolean(editor)} onClick={() => guard(() => { if (!dirty && !editor) props.onRecoveryMore(); })}><ArrowDown size={18} aria-hidden="true" />تحميل المزيد من العمليات</button>}
    </aside></div><footer className="ccw-help ccw-footer"><ShieldCheck size={18} aria-hidden="true" />سجل هذا الملف فقط، بدون تكاليف المعامل أو استيراد أو تصدير. فتح واتساب إجراء يدوي ولا يؤكد إرسال رسالة.</footer>
  </section>;
}

/** The parent owns/disposes the bundle. Rendering subscribes only, never reads. */
export default function CloudClinicalWorkspace({ controller, onClose, previewOnly = false, closing = false }: {
  controller: CloudClinicalWorkspaceBundle; onClose: () => void; previewOnly?: boolean; closing?: boolean;
}) {
  const fileSubscribe = useCallback((notify: () => void) => controller.file.subscribe(() => notify()), [controller]);
  const recoverySubscribe = useCallback((notify: () => void) => controller.recovery.subscribe(() => notify()), [controller]);
  const fileSnapshot = useCallback(() => controller.file.getState(), [controller]), recoverySnapshot = useCallback(() => controller.recovery.getState(), [controller]);
  const state = useSyncExternalStore(fileSubscribe, fileSnapshot, fileSnapshot), recovery = useSyncExternalStore(recoverySubscribe, recoverySnapshot, recoverySnapshot);
  const [editor, setEditor] = useState<CloudClinicalEditor | null>(null), editorRef = useRef(editor), running = useRef(false);
  editorRef.current = editor;
  const live = useRef({ controller, onClose, previewOnly, closing }); live.current = { controller, onClose, previewOnly, closing };
  const fresh = (allowPending = false) => {
    if (live.current.controller !== controller || live.current.previewOnly || live.current.closing || running.current) return null;
    const value = controller.file.getState(), directory = controller.recovery.getState();
    return value.closed || directory.closed || value.loading || directory.loading || (!allowPending && value.saveStatus !== 'idle') ? null : value;
  };
  const sameEditor = (expected: CloudClinicalEditor) => { const value = fresh(); return value && editorRef.current === expected && value.snapshot === expected.snapshot && value.patientRecordId === expected.snapshot.patientRecordId ? value : null; };
  const clearEditor = () => { editorRef.current = null; setEditor(null); };
  const run = async (work: () => Promise<unknown>) => { if (running.current) return; running.current = true; try { await work(); } catch { /* Controllers own fixed messages; no provider error reaches rendering. */ } finally { running.current = false; } };
  return <CloudClinicalWorkspaceView state={state} recovery={recovery} editor={editor} previewOnly={previewOnly} closing={closing}
    onClose={() => { if (live.current.controller !== controller || live.current.closing || running.current) return; const value = controller.file.getState(), directory = controller.recovery.getState(); if (live.current.previewOnly || value.closed || !busy(value) && !value.draftDirty && !editorRef.current && !directory.loading) live.current.onClose(); }}
    onRefresh={() => { const value = fresh(); if (value && !value.draftDirty && !editorRef.current) void run(() => controller.file.refresh()); }}
    onStartEdit={(snapshot, session, mode) => { const value = fresh(); if (!value || value.draftDirty || editorRef.current || value.snapshot !== snapshot || !snapshot.patient.sessions.includes(session)) return; if (mode === 'payment' && (session.remain <= 0 || snapshot.totalCents <= snapshot.paidCents)) return;
      if (!controller.file.setDraftDirty(snapshot.patientRecordId, true)) return;
      const next: CloudClinicalEditor = { mode, snapshot, session, amount: '', date: today(), note: '', progress: { notes: session.visitNotes ?? '', treatmentStage: session.treatmentStage ?? 'single', rootCanalStatus: session.rootCanalStatus ?? '', visitStatus: session.visitStatus ?? 'completed' } };
      editorRef.current = next; setEditor(next); }}
    onChangeEditor={(expected, patch) => { if (!sameEditor(expected)) return; const next = { ...expected, ...patch }; editorRef.current = next; setEditor(next); }}
    onSave={expected => { if (!sameEditor(expected)) return; const cents = parseAmount(expected.amount), maximum = Math.min(Math.round(expected.session.remain * 100), expected.snapshot.totalCents - expected.snapshot.paidCents); if (expected.mode === 'payment' && (cents === null || cents > maximum)) return;
      void run(async () => { const success = expected.mode === 'payment' ? await controller.file.addReceipt(expected.snapshot.patientRecordId, expected.session.id, { amountCents: cents!, date: expected.date, note: expected.note }) : await controller.file.saveProgress(expected.snapshot.patientRecordId, expected.session.id, expected.progress); if (success && live.current.controller === controller && editorRef.current === expected) clearEditor(); }); }}
    onCancelEditor={expected => { if (sameEditor(expected) && controller.file.setDraftDirty(expected.snapshot.patientRecordId, false)) clearEditor(); }}
    onContact={snapshot => { const value = fresh(); return Boolean(value && !value.draftDirty && !editorRef.current && value.snapshot === snapshot && normalizeContactPhone(snapshot.profile.data.mobile)); }}
    onRetry={() => { const value = fresh(true), expected = editorRef.current; if (value && ['retry-required', 'refresh-required'].includes(value.saveStatus)) void run(async () => { if (await controller.file.retry() && live.current.controller === controller && editorRef.current === expected) clearEditor(); }); }}
    onCancelPending={() => { const value = fresh(true), expected = editorRef.current; if (value?.saveStatus === 'retry-required') void run(async () => { if (await controller.file.cancelPending() && live.current.controller === controller && editorRef.current === expected) clearEditor(); }); }}
    onRecoveryLoad={() => { const value = fresh(); if (value && !value.draftDirty && !editorRef.current) void run(() => controller.recovery.loadFirst()); }}
    onRecoveryMore={() => { const value = fresh(); if (value && !value.draftDirty && !editorRef.current && controller.recovery.getState().nextAfterId) void run(() => controller.recovery.loadMore()); }}
    onResume={intent => { const value = fresh(); if (value && !value.draftDirty && !editorRef.current && intent.status !== 'cancelled' && controller.recovery.getState().records.includes(intent)) void run(() => controller.file.resume(intent.operationId)); }} />;
}
