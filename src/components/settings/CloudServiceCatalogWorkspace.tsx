import React, { useCallback, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowRight, Check, ChevronLeft, CircleDollarSign, ClipboardList, History, Pencil, Plus, RefreshCw, Search, X } from 'lucide-react';
import { MAX_CLOUD_CLINICAL_CENTS } from '../../utils/cloudClinicalRepository';
import { parseCloudServiceCatalogData, prepareCloudServiceCatalogMutationCommand,
  type CloudServiceCatalogData, type CloudServiceCatalogRecord } from '../../utils/cloudServiceCatalogRepository';
import type { CloudCatalogWorkspaceController, CloudCatalogWorkspaceDraft, CloudCatalogWorkspaceState } from '../../utils/cloudCatalogWorkspaceController';
import type { CloudOperationIntent } from '../../utils/cloudOperationIntent';
import { normalizeDirectoryDigits, normalizeDirectoryName } from '../../utils/patientDirectory';
import './CloudServiceCatalogWorkspace.css';

export interface CloudCatalogEditorRow {
  serviceId: string; name: string; price: string; kind: 'clinical' | 'prosthetic'; active: boolean;
}
export interface CloudCatalogEditor {
  sourceDraft: CloudCatalogWorkspaceDraft;
  examination: string;
  rows: CloudCatalogEditorRow[];
  selectedServiceId: string | null;
}
export type CloudCatalogFilter = 'all' | 'clinical' | 'prosthetic';
const moneyText = (cents: number | null) => cents === null ? '' : String(cents / 100);
const moneyLabel = (cents: number | null) => cents === null ? 'السعر غير محدد' : `${(cents / 100).toLocaleString('ar-EG', { maximumFractionDigits: 2 })} ج.م`;
const locked = (state: CloudCatalogWorkspaceState) => state.loading || state.historyLoading || state.saveStatus !== 'idle';
/** Blank is deliberately null, never Number('') or a default price. */
export function parseCloudCatalogMoneyText(value: string): { valid: boolean; cents: number | null } {
  if (typeof value !== 'string' || value.length > 32) return { valid: false, cents: null };
  const normalized = normalizeDirectoryDigits(value.trim()).replace(/[٫,]/g, '.');
  if (!normalized) return { valid: true, cents: null };
  if (!/^\d{1,11}(?:\.\d{1,2})?$/.test(normalized)) return { valid: false, cents: null };
  const [whole, fraction = ''] = normalized.split('.'), cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return { valid: Number.isSafeInteger(cents) && cents <= MAX_CLOUD_CLINICAL_CENTS, cents };
}
function editorFor(draft: CloudCatalogWorkspaceDraft): CloudCatalogEditor {
  return { sourceDraft: draft, examination: moneyText(draft.examinationCents), selectedServiceId: draft.services[0]?.serviceId ?? null,
    rows: draft.services.map(row => ({ serviceId: row.serviceId, name: row.name, price: moneyText(row.priceCents), kind: row.kind, active: row.active })) };
}
export function buildCloudCatalogEditorData(editor: CloudCatalogEditor): CloudServiceCatalogData | null {
  try {
    const exam = parseCloudCatalogMoneyText(editor.examination);
    if (!exam.valid || exam.cents === null) return null;
    return parseCloudServiceCatalogData({ examinationCents: exam.cents, services: editor.rows.map(row => {
      const price = parseCloudCatalogMoneyText(row.price); if (!price.valid) throw new Error();
      return { serviceId: row.serviceId, name: row.name, priceCents: price.cents, kind: row.kind, active: row.active };
    }) });
  } catch { return null; }
}
/** One explicit save equals one bounded mutation, never N hidden writes. */
export function cloudCatalogEditorSaveTarget(editor: CloudCatalogEditor, snapshot: CloudServiceCatalogRecord | null): 'examination' | string | null {
  try {
    const data = buildCloudCatalogEditorData(editor); if (!data) return null;
    const previous = snapshot?.data ?? null, oldRows = previous?.services ?? [];
    if (data.services.length < oldRows.length || data.services.length > oldRows.length + 1) return null;
    const changed: number[] = [];
    for (let index = 0; index < data.services.length; index++) {
      if (index < oldRows.length && data.services[index].serviceId !== oldRows[index].serviceId) return null;
      if (JSON.stringify(data.services[index]) !== JSON.stringify(oldRows[index])) changed.push(index);
    }
    const examinationChanged = previous === null || data.examinationCents !== previous.examinationCents;
    if (examinationChanged) return changed.length === 0 ? 'examination' : null;
    if (changed.length !== 1 || previous === null) return null;
    const index = changed[0];
    // Validate the same safe name/shape as the new server-bound mutation before
    // enabling Save. Fixed fixture metadata is validation-only, never an ID or
    // clock used for a real operation, and causes no reads or writes.
    prepareCloudServiceCatalogMutationCommand({ mutationVersion: 2, operationId: '00000000-0000-4000-8000-000000000000',
      expectedRevision: snapshot!.revision, createdAt: '2026-01-01T00:00:00.000Z', action: 'service', index, service: data.services[index] });
    return data.services[index].serviceId;
  } catch { return null; }
}
export interface CloudServiceCatalogWorkspaceViewProps {
  state: CloudCatalogWorkspaceState; previewOnly?: boolean; editor: CloudCatalogEditor | null;
  query: string; filter: CloudCatalogFilter;
  onClose: () => void; onLoad: () => void; onBeginEdit: () => void;
  onQuery: (query: string) => void; onFilter: (filter: CloudCatalogFilter) => void;
  onChangeEditor: (next: CloudCatalogEditor, expected: CloudCatalogEditor) => void;
  onUseExamination100: (expected: CloudCatalogEditor) => void;
  onAddService: (expected: CloudCatalogEditor) => void; onSave: (expected: CloudCatalogEditor) => void;
  onCancelEditor: (expected: CloudCatalogEditor) => void;
  onRetry: () => void; onCancelPending: () => void; onHistoryLoad: () => void; onHistoryMore: () => void;
  onResume: (intent: CloudOperationIntent) => void;
}

/** Presentation only: no request, default catalog, ID or mutation on render. */
export function CloudServiceCatalogWorkspaceView(props: CloudServiceCatalogWorkspaceViewProps) {
  const prefix = useId(), latest = useRef(props); latest.current = props;
  const { state } = props, unavailable = props.previewOnly || state.closed;
  const disabled = unavailable || locked(state);
  const editor = unavailable ? null : props.editor;
  const rows = unavailable ? [] : editor?.rows ?? state.snapshot?.data.services.map(row => ({ ...row, price: moneyText(row.priceCents) })) ?? [];
  const query = unavailable ? '' : normalizeDirectoryName(props.query);
  const filtered = useMemo(() => rows.filter(row => (props.filter === 'all' || row.kind === props.filter)
    && normalizeDirectoryName(row.name).includes(query)), [rows, props.filter, query]);
  const selected = editor?.rows.find(row => row.serviceId === editor.selectedServiceId) ?? null;
  const saveTarget = editor ? cloudCatalogEditorSaveTarget(editor, state.snapshot) : null;
  const blockedClose = !props.previewOnly && !state.closed && (locked(state) || Boolean(state.draft) || Boolean(state.pendingOperationId));
  const ready = () => !latest.current.previewOnly && !latest.current.state.closed && !locked(latest.current.state);
  const browse = (action: (current: CloudServiceCatalogWorkspaceViewProps) => void) => { if (ready()) action(latest.current); };
  const edit = (expected: CloudCatalogEditor, action: (current: CloudServiceCatalogWorkspaceViewProps) => void) => {
    if (ready() && latest.current.editor === expected && latest.current.state.draft === expected.sourceDraft) action(latest.current);
  };
  const change = (expected: CloudCatalogEditor, patch: Partial<CloudCatalogEditorRow>) => edit(expected, current => current.onChangeEditor({ ...expected,
    rows: expected.rows.map(row => row.serviceId === expected.selectedServiceId ? { ...row, ...patch } : row) }, expected));
  const retry = state.saveStatus === 'retry-required', refresh = state.saveStatus === 'refresh-required';
  return <section className="cloud-catalog-workspace" dir="rtl" aria-labelledby={`${prefix}-title`}>
    <header className="ccat-surface ccat-header"><div className="ccat-heading"><span className="ccat-heading-icon"><CircleDollarSign size={25} aria-hidden="true" /></span>
      <div><h2 id={`${prefix}-title`}>الخدمات والأسعار</h2><p>فهرس موحّد لأسعار المريض وقيمة الكشف، دون حسابات المعامل.</p></div></div>
      <div><button className="ccat-button ccat-secondary" type="button" disabled={blockedClose} onClick={() => {
        const current = latest.current, s = current.state;
        if (current.previewOnly || s.closed || !locked(s) && !s.draft && !s.pendingOperationId) current.onClose();
      }}><ArrowRight size={18} aria-hidden="true" />إلغاء وإغلاق</button>
        {blockedClose && <p className="ccat-help">ألغِ المسودة أو أكمل التحقق من العملية قبل الإغلاق.</p>}</div>
    </header>
    {props.previewOnly ? <p className="ccat-message ccat-warning" role="status"><strong>معاينة تصميم فقط — القراءة والحفظ غير مفعّلين</strong>لا توجد أسعار أو خدمات افتراضية أو حقيقية في هذه المعاينة.</p>
      : state.closed ? <p className="ccat-message" role="status">أُغلقت مساحة العمل وأُخفيت بيانات الفهرس.</p> : null}
    {!unavailable && (retry || refresh) && <div className="ccat-message ccat-warning" role="status"><strong>{refresh ? 'الحفظ مؤكد — تحديث العرض مطلوب' : 'تأكيد الحفظ لم يصل'}</strong>
      <p>{refresh ? 'إعادة التحقق تقرأ الفهرس فقط؛ لا تُرسل تعديلًا جديدًا.' : 'قد يكون التعديل وصل. أعد نفس العملية دون تغيير المسودة أو إنشاء محاولة جديدة.'}</p>
      {state.pendingOperationId && <p className="ccat-operation">معرّف العملية <bdi dir="ltr">{state.pendingOperationId}</bdi></p>}
      <div className="ccat-actions"><button className="ccat-button ccat-primary" type="button" disabled={state.loading || state.historyLoading} onClick={() => {
        const current = latest.current; if (!current.previewOnly && !current.state.closed && !current.state.loading && !current.state.historyLoading
          && ['retry-required', 'refresh-required'].includes(current.state.saveStatus)) current.onRetry();
      }}><RefreshCw size={18} aria-hidden="true" />{refresh ? 'إعادة التحقق بالقراءة' : 'إعادة نفس المحاولة'}</button>
        {retry && <button className="ccat-button ccat-secondary" type="button" disabled={state.loading || state.historyLoading} onClick={() => {
          const current = latest.current; if (!current.previewOnly && !current.state.closed && !current.state.loading && !current.state.historyLoading
            && current.state.saveStatus === 'retry-required') current.onCancelPending();
        }}><X size={18} aria-hidden="true" />التحقق من إلغاء العملية</button>}</div></div>}
    {!unavailable && state.error && <p className="ccat-message ccat-error" role="alert">{state.error}</p>}
    {!unavailable && state.notice && <p className="ccat-message ccat-info" role="status">{state.notice}</p>}
    <div className="ccat-layout">
      <section className="ccat-surface ccat-catalog" aria-labelledby={`${prefix}-catalog`} aria-busy={!unavailable && state.loading}>
        <div className="ccat-section-heading"><div><h3 id={`${prefix}-catalog`}>{editor ? 'مسودة تعديلات الفهرس' : 'فهرس الخدمات'}</h3>
          <p className="ccat-help">{unavailable ? 'عرض فارغ لمراجعة ترتيب القسم' : state.snapshot ? `نسخة الفهرس ${state.snapshot.revision.toLocaleString('ar-EG')} — ${rows.length.toLocaleString('ar-EG')} خدمة` : 'لم يُحدد فهرس مؤكد بعد؛ لا أسعار افتراضية'}</p></div>
          <div className="ccat-actions"><button className="ccat-button ccat-secondary" type="button" disabled={disabled || Boolean(state.draft)} onClick={() => browse(current => { if (!current.state.draft) current.onLoad(); })}><RefreshCw size={18} aria-hidden="true" />{state.loaded && !unavailable ? 'تحديث الفهرس' : 'تحميل الفهرس'}</button>
            {!editor && <button className="ccat-button ccat-primary" type="button" disabled={disabled || !state.loaded || Boolean(state.draft)} onClick={() => browse(current => { if (current.state.loaded && !current.state.draft) current.onBeginEdit(); })}><Pencil size={18} aria-hidden="true" />{state.loaded && !state.snapshot ? 'إعداد الفهرس' : 'تعديل الفهرس'}</button>}</div></div>
        <label className="ccat-search" htmlFor={`${prefix}-search`}><Search size={18} aria-hidden="true" /><input id={`${prefix}-search`} type="search" value={unavailable ? '' : props.query} disabled={disabled} maxLength={200} placeholder="ابحث باسم الخدمة في الفهرس المحمّل" onChange={event => browse(current => current.onQuery(event.target.value))} /></label>
        <div className="ccat-filters" aria-label="تصنيف الخدمات">{([['all', 'الكل'], ['clinical', 'خدمات علاجية'], ['prosthetic', 'التركيبات']] as const).map(([value, label]) =>
          <button key={value} type="button" className={`ccat-button ccat-filter${props.filter === value ? ' is-selected' : ''}`} aria-pressed={props.filter === value} disabled={disabled} onClick={() => browse(current => current.onFilter(value))}>{label}</button>)}</div>
        {props.filter === 'prosthetic' && <p className="ccat-help">أسعار التركيبات هنا هي سعر المريض، وليست تكلفة المعمل. توجيه المعمل وحساباته خارج هذا الفهرس.</p>}
        <div className="ccat-service-list">{filtered.map(row => <article className={`ccat-service${selected?.serviceId === row.serviceId ? ' is-selected' : ''}`} key={row.serviceId}>
          <div className="ccat-service-main"><strong>{row.name || 'خدمة جديدة — أكمل الاسم'}</strong><div className="ccat-meta"><span>{row.kind === 'clinical' ? 'علاجية' : 'تركيبات'}</span><span className={!row.active ? 'ccat-inactive' : ''}>{row.active ? 'نشطة' : 'موقوفة'}</span></div></div>
          <b className="ccat-price">{(() => { const amount = parseCloudCatalogMoneyText(row.price); return amount.valid ? moneyLabel(amount.cents) : 'راجع السعر'; })()}</b>
          {editor && <button className="ccat-button ccat-icon-button ccat-secondary" type="button" aria-label={`تعديل ${row.name || 'الخدمة الجديدة'}`} disabled={disabled} onClick={() => edit(editor, current => current.onChangeEditor({ ...editor, selectedServiceId: row.serviceId }, editor))}><Pencil size={18} aria-hidden="true" /></button>}
        </article>)}</div>
        {!filtered.length && <div className="ccat-empty"><ClipboardList size={30} aria-hidden="true" /><strong>{unavailable ? 'لا توجد بيانات في المعاينة' : !state.loaded ? 'حمّل الفهرس أولًا' : query || props.filter !== 'all' ? 'لا توجد خدمات مطابقة' : 'لا توجد خدمات في الفهرس المحمّل'}</strong><p className="ccat-help">لا تُنشأ خدمات أو أسعار تلقائيًا. يمكنك إعدادها صراحة بعد تحميل الفهرس.</p></div>}
        {editor && <button className="ccat-button ccat-secondary ccat-add" type="button" disabled={disabled || !state.snapshot || editor.rows.length >= 300} onClick={() => edit(editor, current => { if (current.state.snapshot) current.onAddService(editor); })}><Plus size={18} aria-hidden="true" />إضافة خدمة</button>}
      </section>
      <aside className="ccat-detail">
        <section className="ccat-surface ccat-exam" aria-labelledby={`${prefix}-exam`}><h3 id={`${prefix}-exam`}>قيمة الكشف</h3>
          {editor ? <><label htmlFor={`${prefix}-exam-input`}>القيمة الافتراضية بالجنيه</label><input id={`${prefix}-exam-input`} className="ccat-input" type="text" inputMode="decimal" maxLength={32} dir="ltr" value={editor.examination} disabled={disabled} aria-invalid={parseCloudCatalogMoneyText(editor.examination).cents === null || !parseCloudCatalogMoneyText(editor.examination).valid || undefined}
            onChange={event => edit(editor, current => current.onChangeEditor({ ...editor, examination: event.target.value }, editor))} />
            <button className="ccat-button ccat-secondary" type="button" disabled={disabled} onClick={() => edit(editor, current => current.onUseExamination100(editor))}>استخدام ١٠٠ ج.م للكشف</button>
            <button className="ccat-button ccat-primary" type="button" disabled={disabled || saveTarget !== 'examination'} onClick={() => edit(editor, current => {
              if (cloudCatalogEditorSaveTarget(editor, current.state.snapshot) === 'examination') current.onSave(editor);
            })}><Check size={18} aria-hidden="true" />حفظ قيمة الكشف</button></>
            : <p className="ccat-exam-value">{!unavailable && state.snapshot ? moneyLabel(state.snapshot.data.examinationCents) : 'غير محددة — يلزم تحميل الفهرس'}</p>}
          <p className="ccat-help">إضافة الكشف في الزيارة اختيارية. تحديد قيمته هنا لا يسجّل تحصيلًا أو دفعة.</p></section>
        {editor && <form className="ccat-surface ccat-editor" onSubmit={event => { event.preventDefault(); edit(editor, current => {
          if (editor.selectedServiceId && cloudCatalogEditorSaveTarget(editor, current.state.snapshot) === editor.selectedServiceId) current.onSave(editor);
        }); }}>
          <h3>{selected ? 'تفاصيل الخدمة' : 'أضف خدمة لبدء تنظيم الفهرس'}</h3>
          {selected && <><label htmlFor={`${prefix}-name`}>اسم الخدمة</label><input id={`${prefix}-name`} className="ccat-input" type="text" maxLength={200} value={selected.name} disabled={disabled} onChange={event => change(editor, { name: event.target.value })} />
            <label htmlFor={`${prefix}-kind`}>نوع الخدمة</label><select id={`${prefix}-kind`} className="ccat-input" value={selected.kind} disabled={disabled} onChange={event => { if (event.target.value === 'clinical' || event.target.value === 'prosthetic') change(editor, { kind: event.target.value }); }}><option value="clinical">خدمة علاجية</option><option value="prosthetic">تركيبات</option></select>
            <label htmlFor={`${prefix}-price`}>سعر المريض بالجنيه — اختياري</label><input id={`${prefix}-price`} className="ccat-input" type="text" inputMode="decimal" maxLength={32} dir="ltr" value={selected.price} disabled={disabled} aria-invalid={!parseCloudCatalogMoneyText(selected.price).valid || undefined} onChange={event => change(editor, { price: event.target.value })} />
            <p className="ccat-help">اتركه فارغًا إذا لم يُحدد السعر. اكتب 0 فقط لو الخدمة مجانية فعلًا.{selected.kind === 'prosthetic' ? ' هذا سعر المريض، وليس تكلفة المعمل.' : ''}</p>
            <label className="ccat-check"><input type="checkbox" checked={selected.active} disabled={disabled} onChange={event => change(editor, { active: event.target.checked })} />الخدمة نشطة ومتاحة للاختيار</label>
            <p className="ccat-help ccat-operation">معرّف ثابت <bdi dir="ltr">{selected.serviceId}</bdi></p></>}
          {saveTarget === null && <p className="ccat-field-error" role="status">عدّل قيمة الكشف أو خدمة واحدة ثم احفظها. أكمل الاسم والسعر الصحيح دون تكرار، ولا تغيّر عدة خدمات في العملية نفسها.</p>}
          {!state.snapshot && <p className="ccat-help">احفظ قيمة الكشف أولًا لإنشاء فهرس فارغ، ثم أضف كل خدمة واحفظها منفردة.</p>}
          <p className="ccat-help">التعديلات تخص الزيارات الجديدة فقط؛ أسعار الجلسات السابقة لا تتغير.</p>
          <div className="ccat-actions"><button className="ccat-button ccat-primary" type="submit" disabled={disabled || !selected || saveTarget !== selected.serviceId}><Check size={18} aria-hidden="true" />حفظ الخدمة المحددة</button>
            <button className="ccat-button ccat-secondary" type="button" disabled={disabled} onClick={() => edit(editor, current => current.onCancelEditor(editor))}><X size={18} aria-hidden="true" />إلغاء المسودة</button></div>
        </form>}
      </aside>
    </div>
    <section className="ccat-surface ccat-history" aria-labelledby={`${prefix}-history`} aria-busy={!unavailable && state.historyLoading}>
      <div className="ccat-section-heading"><div><h3 id={`${prefix}-history`}><History size={19} aria-hidden="true" />استرجاع تعديلات الفهرس</h3><p className="ccat-help">الصفحات المحمّلة مرتبة بالمعرّف، وليست قائمة الأحدث عالميًا. المتابعة تستخدم العملية الأصلية ولا تنشئ تعديلًا جديدًا.</p></div>
        <button className="ccat-button ccat-secondary" type="button" disabled={disabled || Boolean(state.draft)} onClick={() => browse(current => { if (!current.state.draft) current.onHistoryLoad(); })}><History size={18} aria-hidden="true" />تحميل سجل العمليات</button></div>
      {!unavailable && state.history.map(intent => <article className="ccat-history-row" key={intent.operationId}><div><strong>{intent.status === 'prepared' ? 'عملية محضّرة — تحتاج تحققًا' : intent.status === 'committed' ? 'مسجلة كمنفذة — يمكن إعادة التحقق' : 'عملية ملغاة'}</strong>
        <time dateTime={intent.createdAt}>{new Date(intent.createdAt).toLocaleString('ar-EG')}</time><bdi className="ccat-operation" dir="ltr">{intent.operationId}</bdi></div>
        <button className="ccat-button ccat-secondary" type="button" disabled={disabled || Boolean(state.draft) || intent.status === 'cancelled'} onClick={() => browse(current => { if (!current.state.draft && intent.status !== 'cancelled' && current.state.history.includes(intent)) current.onResume(intent); })}>متابعة نفس العملية<ChevronLeft size={18} aria-hidden="true" /></button></article>)}
      {(unavailable || !state.history.length) && <p className="ccat-help">{unavailable ? 'لا توجد عمليات في هذه المعاينة.' : state.historyLoaded ? 'لا توجد عمليات ضمن الصفحات المحمّلة.' : 'السجل لم يُحمّل بعد.'}</p>}
      {!unavailable && state.historyNextAfterId && <button className="ccat-button ccat-secondary" type="button" disabled={disabled || Boolean(state.draft)} onClick={() => browse(current => { if (!current.state.draft && current.state.historyNextAfterId) current.onHistoryMore(); })}>تحميل الصفحة التالية</button>}
    </section>
  </section>;
}

export default function CloudServiceCatalogWorkspace({ controller, previewOnly = false, onClose }: {
  controller: CloudCatalogWorkspaceController; previewOnly?: boolean; onClose: () => void;
}) {
  const state = useSyncExternalStore(useCallback(notify => controller.subscribe(notify), [controller]), controller.getState, controller.getState);
  const latest = useRef({ controller, previewOnly, onClose }); latest.current = { controller, previewOnly, onClose };
  const [query, setQuery] = useState(''), [filter, setFilter] = useState<CloudCatalogFilter>('all');
  const [editor, setEditor] = useState<CloudCatalogEditor | null>(null);
  const editing = useRef<{ controller: CloudCatalogWorkspaceController; value: CloudCatalogEditor } | null>(null);
  const busy = useRef(false);
  const current = () => latest.current.controller === controller && !latest.current.previewOnly ? controller.getState() : null;
  const available = () => { const value = current(); return value && !value.closed && !locked(value) && !busy.current ? value : null; };
  const editorCurrent = (expected: CloudCatalogEditor) => {
    const value = available(); return value && editing.current?.controller === controller && editing.current.value === expected
      && value.draft === expected.sourceDraft ? value : null;
  };
  const publishEditor = (value: CloudCatalogEditor | null) => { editing.current = value ? { controller, value } : null; setEditor(value); };
  const run = async (work: () => Promise<unknown>, allowPending = false) => {
    const value = current();
    if (!value || value.closed || busy.current || value.loading || value.historyLoading || !allowPending && value.saveStatus !== 'idle') return;
    busy.current = true;
    try { await work(); } catch { /* Controller owns fixed errors and uncertain commands. */ }
    finally { busy.current = false; }
  };
  const visibleEditor = !previewOnly && !state.closed && editor && editing.current?.controller === controller
    && state.draft === editor.sourceDraft ? editor : null;
  return <CloudServiceCatalogWorkspaceView state={state} previewOnly={previewOnly} query={query} filter={filter} editor={visibleEditor}
    onQuery={value => { if (available()) setQuery(value); }} onFilter={value => { if (available() && ['all', 'clinical', 'prosthetic'].includes(value)) setFilter(value); }}
    onClose={() => { const value = latest.current.controller === controller ? controller.getState() : null;
      if (value && !busy.current && (latest.current.previewOnly || value.closed || !locked(value) && !value.draft && !value.pendingOperationId)) latest.current.onClose(); }}
    onLoad={() => { const value = available(); if (value && !value.draft) void run(() => controller.load()); }}
    onBeginEdit={() => { const value = available(); if (!value || !value.loaded || value.draft || !controller.beginEdit()) return;
      const fresh = current(); if (fresh?.draft && !fresh.closed) publishEditor(editorFor(fresh.draft)); }}
    onChangeEditor={(next, expected) => { if (editorCurrent(expected) && next.sourceDraft === expected.sourceDraft) publishEditor(next); }}
    onUseExamination100={expected => { const value = editorCurrent(expected); if (!value?.draft
      || !controller.updateDraft({ ...value.draft, examinationCents: 10_000 })) return;
      const fresh = current(); if (fresh?.draft && !fresh.closed) publishEditor({ ...expected, sourceDraft: fresh.draft, examination: '100' }); }}
    onAddService={expected => { if (!editorCurrent(expected)?.snapshot || expected.rows.length >= 300) return;
      try { const serviceId = crypto.randomUUID();
        if (!editorCurrent(expected) || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(serviceId)
          || expected.rows.some(row => row.serviceId === serviceId)) return;
        publishEditor({ ...expected, selectedServiceId: serviceId, rows: [...expected.rows, { serviceId, name: '', price: '', kind: 'clinical', active: true }] });
      } catch { /* No generated ID means no new row or write. */ } }}
    onCancelEditor={expected => { if (editorCurrent(expected) && controller.cancelDraft()) publishEditor(null); }}
    onSave={expected => { const value = editorCurrent(expected); if (!value || cloudCatalogEditorSaveTarget(expected, value.snapshot) === null) return;
      const data = buildCloudCatalogEditorData(expected); if (!data) return;
      if (!controller.updateDraft(data)) return; const fresh = current(); if (!fresh?.draft) return;
      publishEditor({ ...expected, sourceDraft: fresh.draft });
      void run(async () => { await controller.save(); const result = current(); if (result && !result.closed && !result.draft) publishEditor(null); }); }}
    onRetry={() => { const value = current(); if (value && ['retry-required', 'refresh-required'].includes(value.saveStatus)) void run(async () => { await controller.retry(); const result = current(); if (result && !result.closed && !result.draft) publishEditor(null); }, true); }}
    onCancelPending={() => { if (current()?.saveStatus === 'retry-required') void run(async () => { await controller.cancelPending(); const result = current(); if (result && !result.closed && !result.draft) publishEditor(null); }, true); }}
    onHistoryLoad={() => { const value = available(); if (value && !value.draft) void run(() => controller.loadHistory()); }}
    onHistoryMore={() => { const value = available(); if (value && !value.draft && value.historyNextAfterId) void run(() => controller.loadMoreHistory()); }}
    onResume={intent => { const value = available(); if (value && !value.draft && value.history.includes(intent) && intent.status !== 'cancelled') void run(() => controller.resume(intent.operationId)); }} />;
}
