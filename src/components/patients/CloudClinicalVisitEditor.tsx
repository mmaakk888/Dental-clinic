import React, { useCallback, useId, useRef, useState, useSyncExternalStore } from 'react';
import { Check, ChevronLeft, ClipboardPlus, Search, Trash2, X } from 'lucide-react';
import type { CloudCatalogVisitDraftState, CloudCatalogVisitMetadata } from '../../utils/cloudCatalogVisitDraft';
import { MAX_CLOUD_CLINICAL_CENTS, prepareCloudClinicalSessionData, type CloudClinicalProgress } from '../../utils/cloudClinicalRepository';
import type { CloudClinicalPatientSnapshot } from '../../utils/cloudClinicalPatientProjection';
import type { CloudServiceCatalogRecord } from '../../utils/cloudServiceCatalogRepository';
import type { CloudClinicalVisitWorkspaceController, CloudClinicalVisitWorkspaceState } from '../../utils/cloudClinicalVisitWorkspaceController';
import { getToothLabel } from '../../utils/toothUtils';
import { ExaminationFeeToggle } from '../common/ExaminationFeeToggle';
import { ToothSelectionGrid, type DentitionType } from '../common/ToothSelectionGrid';
import './CloudClinicalVisitEditor.css';

export interface CloudClinicalVisitEditorModel {
  sourceDraft: CloudCatalogVisitDraftState;
  snapshot: CloudClinicalPatientSnapshot;
  catalog: CloudServiceCatalogRecord;
  prices: Readonly<Record<string, string>>;
  query: string;
  choiceLimit: number;
  selectedRowId: string | null;
  dentition: DentitionType;
  paid: string;
  date: string;
  notes: string;
  treatmentStage: CloudClinicalProgress['treatmentStage'];
  rootCanalStatus: CloudClinicalProgress['rootCanalStatus'];
  visitStatus: CloudClinicalProgress['visitStatus'];
}

/** Integer piastres only. Empty is unknown, not zero; no locale rounding. */
export function parseCloudClinicalVisitMoney(value: string): { valid: boolean; cents: number | null } {
  if (typeof value !== 'string' || value.length > 32) return { valid: false, cents: null };
  const normalized = value.trim().replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x6f0)).replace(/٫/g, '.');
  if (!normalized) return { valid: true, cents: null };
  if (!/^[0-9]{1,11}(?:\.[0-9]{1,2})?$/.test(normalized)) return { valid: false, cents: null };
  const [whole, fraction = ''] = normalized.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents <= MAX_CLOUD_CLINICAL_CENTS
    ? { valid: true, cents } : { valid: false, cents: null };
}

export function getCloudClinicalVisitTotal(editor: CloudClinicalVisitEditorModel): number | null {
  let total = editor.sourceDraft.examinationEnabled ? editor.sourceDraft.examinationCents : 0;
  for (const row of editor.sourceDraft.services) {
    const parsed = parseCloudClinicalVisitMoney(editor.prices[row.id] ?? '');
    if (!parsed.valid || parsed.cents === null) return null;
    total += parsed.cents;
  }
  return Number.isSafeInteger(total) && total >= 0 && total <= MAX_CLOUD_CLINICAL_CENTS ? total : null;
}

export function buildCloudClinicalVisitSubmission(editor: CloudClinicalVisitEditorModel): {
  metadata: CloudCatalogVisitMetadata; paidCents: number;
} | null {
  const total = getCloudClinicalVisitTotal(editor), paid = parseCloudClinicalVisitMoney(editor.paid);
  if (total === null || !paid.valid || paid.cents === null || paid.cents > total) return null;
  const metadata: CloudCatalogVisitMetadata = { date: editor.date, notes: editor.notes,
    treatmentStage: editor.treatmentStage, rootCanalStatus: editor.rootCanalStatus, visitStatus: editor.visitStatus };
  try {
    prepareCloudClinicalSessionData({ ...metadata, type: editor.sourceDraft.services.length ? 'زيارة علاجية' : 'كشف',
      examinationCents: editor.sourceDraft.examinationEnabled ? editor.sourceDraft.examinationCents : 0,
      teethIds: [...editor.sourceDraft.teethIds], services: editor.sourceDraft.services.map(row => ({
        id: row.id, catalogServiceId: row.catalogServiceId, name: row.name, tooth: row.tooth,
        priceCents: parseCloudClinicalVisitMoney(editor.prices[row.id] ?? '').cents,
      })) });
    return { metadata, paidCents: paid.cents };
  } catch { return null; }
}

type RawPatch = Partial<Pick<CloudClinicalVisitEditorModel, 'query' | 'choiceLimit' | 'selectedRowId' | 'dentition' | 'paid' | 'date' | 'notes' | 'treatmentStage' | 'rootCanalStatus' | 'visitStatus'>>;
export interface CloudClinicalVisitEditorViewProps {
  state: CloudClinicalVisitWorkspaceState;
  editor: CloudClinicalVisitEditorModel | null;
  previewOnly?: boolean;
  closing?: boolean;
  onChange: (expected: CloudClinicalVisitEditorModel, patch: RawPatch) => void;
  onChooseService: (expected: CloudClinicalVisitEditorModel, serviceId: string) => void;
  onPrice: (expected: CloudClinicalVisitEditorModel, rowId: string, value: string) => void;
  onRemove: (expected: CloudClinicalVisitEditorModel, rowId: string) => void;
  onTooth: (expected: CloudClinicalVisitEditorModel, rowId: string, tooth: string | null) => void;
  onExamination: (expected: CloudClinicalVisitEditorModel, selected: boolean) => void;
  onSave: (expected: CloudClinicalVisitEditorModel) => void;
  onCancel: (expected: CloudClinicalVisitEditorModel) => void;
  onCancelLoading: (expected: CloudClinicalVisitWorkspaceState) => void;
}
const money = (cents: number) => `${(cents / 100).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ج.م`;
const stageLabels = { single: 'جلسة واحدة', first: 'الجلسة الأولى', second: 'الجلسة الثانية', third: 'الجلسة الثالثة', follow_up: 'متابعة' };
const rootLabels = { '': 'غير محدد', access_cleaning: 'فتح وتنظيف', working_length: 'تحديد طول القنوات', canal_filled: 'حشو العصب', impression: 'أخذ المقاس', final_restoration: 'الحشو النهائي' };

/** Rendering and subscriptions never load a catalog, choose a service or read a clock. */
export function CloudClinicalVisitEditorView(props: CloudClinicalVisitEditorViewProps) {
  const prefix = useId(), live = useRef(props); live.current = props;
  const { state, previewOnly = false, closing = false } = props;
  const unavailable = previewOnly || state.closed;
  const editor = !unavailable && props.editor && props.editor.sourceDraft === state.draft
    && props.editor.snapshot === state.snapshot && props.editor.catalog === state.catalog ? props.editor : null;
  const locked = unavailable || closing || state.phase !== 'editing';
  const edit = (expected: CloudClinicalVisitEditorModel, action: (current: CloudClinicalVisitEditorViewProps) => void) => {
    const current = live.current;
    if (!current.previewOnly && !current.closing && !current.state.closed && current.state.phase === 'editing'
      && current.editor === expected && current.state.draft === expected.sourceDraft
      && current.state.snapshot === expected.snapshot && current.state.catalog === expected.catalog) action(current);
  };
  if ((!previewOnly && !editor && state.phase === 'idle' && !state.error) || (state.closed && !previewOnly)) return null;
  const total = editor ? getCloudClinicalVisitTotal(editor) : null;
  const paid = editor ? parseCloudClinicalVisitMoney(editor.paid) : { valid: true, cents: null };
  const remaining = total !== null && paid.valid && paid.cents !== null && paid.cents <= total ? total - paid.cents : null;
  const submission = editor ? buildCloudClinicalVisitSubmission(editor) : null;
  const selected = editor?.sourceDraft.services.find(row => row.id === editor.selectedRowId);
  const services = editor ? editor.catalog.data.services.filter(service => service.active && service.kind === 'clinical'
    && (!editor.query.trim() || service.name.normalize('NFKC').toLocaleLowerCase('ar').includes(editor.query.trim().normalize('NFKC').toLocaleLowerCase('ar')))) : [];
  return <section className="cloud-clinical-visit" dir="rtl" aria-label="تسجيل زيارة وخدمات" aria-busy={!unavailable && ['loading', 'submitting'].includes(state.phase)}>
    <header className="ccv-heading"><span className="ccv-icon"><ClipboardPlus size={23} aria-hidden="true" /></span><div><h3>تسجيل زيارة وخدمات</h3><p>{editor ? `ملف ${editor.snapshot.profile.fileNo.toLocaleString('ar-EG', { useGrouping: false })} · ${editor.snapshot.profile.data.name}` : 'خدمات وأسنان وكشف اختياري وتحصيل واضح'}</p></div></header>
    {previewOnly && <p className="ccv-message ccv-info">معاينة تصميم فارغة فقط — لا أسعار افتراضية أو بيانات أو تسجيل فعلي.</p>}
    {!unavailable && state.error && <p role="alert" className="ccv-message ccv-error">{state.error}</p>}
    {!unavailable && state.phase === 'loading' && <div className="ccv-message"><p role="status">{state.error ? 'لم تكتمل تهيئة الزيارة؛ يمكنك إعادة محاولة تحرير المسودة دون حفظ.' : 'جارٍ قراءة قائمة الخدمات والأسعار المحمية…'}</p><button className="ccv-button" type="button" disabled={closing} onClick={() => {
      const current = live.current;
      if (!current.previewOnly && !current.closing && !current.state.closed && current.state === state
        && current.state.phase === 'loading' && !current.state.draft) current.onCancelLoading(state);
    }}>إلغاء فتح الزيارة</button></div>}
    {!unavailable && state.phase === 'submitting' && <p role="status" className="ccv-message">جارٍ تسجيل نفس الزيارة والتحقق من نتيجتها… لا تسجّل زيارة بديلة.</p>}
    {!unavailable && state.phase === 'pending' && <div className="ccv-message ccv-warning"><strong>نتيجة العملية تحتاج تحققًا</strong><p>استخدم أزرار التحقق أعلى الملف لنفس العملية الأصلية. لا تسجّل زيارة أو تحصيلًا بديلًا؛ إغلاق الحساب لا يتراجع عن حفظ قبله الخادم.</p></div>}
    <div className="ccv-layout"><div className="ccv-services"><label htmlFor={`${prefix}-search`}>اختيار خدمة علاجية</label><div className="ccv-search"><Search size={18} aria-hidden="true" /><input id={`${prefix}-search`} type="search" maxLength={200} placeholder="ابحث عن الخدمة" value={editor?.query ?? ''} disabled={locked || !editor} onChange={event => { if (editor) edit(editor, current => current.onChange(editor, { query: event.target.value, choiceLimit: 8 })); }} /></div>
      <p className="ccv-help">اضغط على الخدمة لإضافتها للزيارة مباشرة؛ لا تُحفظ إلا بعد مراجعة الزيارة.</p>
      <div className="ccv-service-options">{services.slice(0, editor?.choiceLimit ?? 8).map(service => <button key={service.serviceId} className="ccv-service-choice" type="button" disabled={locked || !editor || editor.sourceDraft.services.length >= 64} onClick={() => { if (editor) edit(editor, current => current.onChooseService(editor, service.serviceId)); }}><span><strong>{service.name}</strong><small>{service.priceCents === null ? 'السعر غير محدد — أدخله في الزيارة' : money(service.priceCents)}</small></span><ChevronLeft size={19} aria-hidden="true" /></button>)}</div>
      {editor && services.length > 0 && <p className="ccv-help">المعروض {Math.min(editor.choiceLimit, services.length).toLocaleString('ar-EG')} من {services.length.toLocaleString('ar-EG')} خدمة مطابقة. البحث يشمل كل الخدمات العلاجية النشطة في الفهرس المحمّل.</p>}
      {editor && services.length > editor.choiceLimit && <button className="ccv-button" type="button" disabled={locked} onClick={() => edit(editor, current => current.onChange(editor, { choiceLimit: Math.min(300, editor.choiceLimit + 8) }))}>عرض خدمات إضافية</button>}
      {!services.length && <p className="ccv-empty">{previewOnly ? 'تظهر هنا الخدمات العلاجية النشطة بعد تحميل الفهرس.' : editor?.query ? 'لا توجد خدمة مطابقة في القائمة المحمّلة.' : 'لا توجد خدمات علاجية نشطة في الفهرس المحمّل.'}</p>}
      <p className="ccv-help">التركيبات لها مسار منفصل؛ لا تُضاف هنا كخدمة علاجية.</p>
    </div><form className="ccv-form" onSubmit={event => { event.preventDefault(); if (editor) edit(editor, current => { if (buildCloudClinicalVisitSubmission(editor)) current.onSave(editor); }); }}>
      <div className="ccv-section-heading"><h4>خدمات هذه الزيارة</h4><span>{editor ? editor.sourceDraft.services.length.toLocaleString('ar-EG') : '—'}</span></div>
      <div className="ccv-selected-services">{editor?.sourceDraft.services.map(row => {
        const parsed = parseCloudClinicalVisitMoney(editor.prices[row.id] ?? '');
        return <article className="ccv-row" key={row.id}><div className="ccv-row-title"><strong>{row.name}</strong><button className="ccv-button ccv-icon-button" type="button" disabled={locked} aria-label={`حذف ${row.name} من الزيارة`} onClick={() => edit(editor, current => current.onRemove(editor, row.id))}><Trash2 size={18} aria-hidden="true" /></button></div><div className="ccv-row-fields"><div><label htmlFor={`${prefix}-price-${row.id}`}>سعر الخدمة بالجنيه</label><input id={`${prefix}-price-${row.id}`} type="text" inputMode="decimal" dir="ltr" autoComplete="off" maxLength={32} value={editor.prices[row.id] ?? ''} disabled={locked} aria-invalid={!parsed.valid || parsed.cents === null || undefined} onChange={event => edit(editor, current => current.onPrice(editor, row.id, event.target.value))} /></div><button className="ccv-button ccv-tooth-button" type="button" disabled={locked} aria-pressed={editor.selectedRowId === row.id} onClick={() => edit(editor, current => current.onChange(editor, { selectedRowId: editor.selectedRowId === row.id ? null : row.id }))}>{row.tooth ? getToothLabel(row.tooth) : 'اختيار السن — اختياري'}</button></div>{(!parsed.valid || parsed.cents === null) && <p className="ccv-field-error">أدخل سعرًا صحيحًا. اكتب 0 فقط لو الخدمة مجانية.</p>}</article>;
      })}</div>
      {!editor?.sourceDraft.services.length && <p className="ccv-empty">لم تُضف خدمات بعد. اختر خدمة أو أضف الكشف فقط.</p>}
      {selected && editor && <section className="ccv-tooth-picker" aria-label="تحديد سن الخدمة"><div className="ccv-section-heading"><h4>سن خدمة: {selected.name}</h4><button className="ccv-button" type="button" disabled={locked} onClick={() => edit(editor, current => current.onChange(editor, { selectedRowId: null }))}><X size={17} aria-hidden="true" />إغلاق الاختيار</button></div><ToothSelectionGrid mode="single" value={selected.tooth ? [selected.tooth] : []} dentition={editor.dentition} disabled={locked} escapeClearsSelection onDentitionChange={dentition => edit(editor, current => current.onChange(editor, { dentition }))} onChange={ids => edit(editor, current => current.onTooth(editor, selected.id, ids[0] ?? null))} ariaLabel="سن الخدمة المختارة" /><p className="ccv-help">اختيار سن واحد لهذه الخدمة. اختيار السن لا يحفظ الزيارة؛ مسح التحديد يجعلها خدمة عامة.</p></section>}
      {editor ? <ExaminationFeeToggle selected={editor.sourceDraft.examinationEnabled} fee={editor.sourceDraft.examinationCents / 100} disabled={locked} onChange={selected => edit(editor, current => current.onExamination(editor, selected))} /> : <div className="ccv-exam-unknown"><strong>إضافة كشف — اختياري</strong><p>تُقرأ قيمته من الخدمات والأسعار؛ لا توجد قيمة مفترضة في المعاينة.</p><button className="ccv-button" type="button" disabled>قيمة الكشف غير مقروءة</button></div>}
      <fieldset disabled={locked || !editor}><legend>بيانات الجلسة والتحصيل</legend><div className="ccv-pair"><div><label htmlFor={`${prefix}-date`}>تاريخ الزيارة</label><input id={`${prefix}-date`} type="date" dir="ltr" min="1900-01-01" max="9999-12-31" required value={editor?.date ?? ''} onChange={event => { if (editor) edit(editor, current => current.onChange(editor, { date: event.target.value })); }} /></div><div><label htmlFor={`${prefix}-paid`}>المحصّل فعلًا بالجنيه</label><input id={`${prefix}-paid`} type="text" inputMode="decimal" autoComplete="off" dir="ltr" maxLength={32} required value={editor?.paid ?? ''} aria-invalid={Boolean(editor?.paid && (!paid.valid || paid.cents === null || total !== null && paid.cents > total)) || undefined} onChange={event => { if (editor) edit(editor, current => current.onChange(editor, { paid: event.target.value })); }} /></div></div><p className="ccv-help">لا تحصيل تلقائي. اكتب 0 لو لم يدفع المريض شيئًا؛ الكشف وحده لا يُعد دفعة.</p>
        <div className="ccv-pair"><div><label htmlFor={`${prefix}-stage`}>مرحلة العلاج</label><select id={`${prefix}-stage`} value={editor?.treatmentStage ?? 'single'} onChange={event => { if (editor && event.target.value in stageLabels) edit(editor, current => current.onChange(editor, { treatmentStage: event.target.value as CloudClinicalProgress['treatmentStage'] })); }}>{Object.entries(stageLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><div><label htmlFor={`${prefix}-root`}>خطوة العصب — إن وجدت</label><select id={`${prefix}-root`} value={editor?.rootCanalStatus ?? ''} onChange={event => { if (editor && event.target.value in rootLabels) edit(editor, current => current.onChange(editor, { rootCanalStatus: event.target.value as CloudClinicalProgress['rootCanalStatus'] })); }}>{Object.entries(rootLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div></div><label htmlFor={`${prefix}-status`}>حالة الزيارة</label><select id={`${prefix}-status`} value={editor?.visitStatus ?? 'completed'} onChange={event => { if (editor && ['completed', 'follow_up'].includes(event.target.value)) edit(editor, current => current.onChange(editor, { visitStatus: event.target.value as CloudClinicalProgress['visitStatus'] })); }}><option value="completed">مكتملة</option><option value="follow_up">تحتاج متابعة</option></select><label htmlFor={`${prefix}-notes`}>ملاحظات العلاج — اختياري</label><textarea id={`${prefix}-notes`} rows={2} maxLength={4000} value={editor?.notes ?? ''} onChange={event => { if (editor) edit(editor, current => current.onChange(editor, { notes: event.target.value })); }} /></fieldset>
      <dl className="ccv-totals"><div><dt>قيمة الزيارة</dt><dd>{total === null ? 'غير مكتملة' : money(total)}</dd></div><div><dt>المحصّل المُدخل</dt><dd>{paid.valid && paid.cents !== null ? money(paid.cents) : 'لم يُحدد'}</dd></div><div><dt>المتبقي بعد الحفظ</dt><dd>{remaining === null ? 'غير محسوب' : money(remaining)}</dd></div></dl><p className="ccv-help">هذا ملخص الزيارة الجديدة فقط، وليس رصيد الملف السابق. السعر الفارغ لا يُحسب صفرًا.</p>
      <div className="ccv-actions"><button className="ccv-button ccv-primary" type="submit" disabled={locked || !submission}><Check size={18} aria-hidden="true" />حفظ الزيارة والتحصيل المُدخل</button><button className="ccv-button" type="button" disabled={locked || !editor} onClick={() => { if (editor) edit(editor, current => current.onCancel(editor)); }}><X size={18} aria-hidden="true" />إلغاء مسودة الزيارة</button></div>
    </form></div>
  </section>;
}

function createEditor(state: CloudClinicalVisitWorkspaceState): CloudClinicalVisitEditorModel | null {
  if (!state.draft || !state.snapshot || !state.catalog) return null;
  return { sourceDraft: state.draft, snapshot: state.snapshot, catalog: state.catalog,
    prices: Object.fromEntries(state.draft.services.map(row => [row.id, row.priceCents === null ? '' : String(row.priceCents / 100)])),
    query: '', choiceLimit: 8, selectedRowId: null, dentition: 'adult', paid: '', date: '', notes: '',
    treatmentStage: 'single', rootCanalStatus: '', visitStatus: 'completed' };
}

function advanceEditor(expected: CloudClinicalVisitEditorModel, draft: CloudCatalogVisitDraftState,
  patch: Partial<CloudClinicalVisitEditorModel> = {}): CloudClinicalVisitEditorModel {
  const prices = Object.fromEntries(draft.services.map(row => [row.id,
    expected.prices[row.id] ?? (row.priceCents === null ? '' : String(row.priceCents / 100))]));
  const selectedRowId = patch.selectedRowId === undefined ? expected.selectedRowId : patch.selectedRowId;
  return { ...expected, ...patch, sourceDraft: draft, prices: patch.prices ?? prices,
    selectedRowId: draft.services.some(row => row.id === selectedRowId) ? selectedRowId : null };
}

/** The parent owns lifetime and begins explicitly; no effect starts data work. */
export default function CloudClinicalVisitEditor({ controller, previewOnly = false, closing = false }: {
  controller: CloudClinicalVisitWorkspaceController; previewOnly?: boolean; closing?: boolean;
}) {
  const state = useSyncExternalStore(useCallback(notify => controller.subscribe(notify), [controller]), controller.getState, controller.getState);
  const live = useRef({ controller, previewOnly, closing }); live.current = { controller, previewOnly, closing };
  const editing = useRef<{ controller: CloudClinicalVisitWorkspaceController; editor: CloudClinicalVisitEditorModel } | null>(null);
  const working = useRef<{ controller: CloudClinicalVisitWorkspaceController } | null>(null), transition = useRef<{
    controller: CloudClinicalVisitWorkspaceController; current: CloudClinicalVisitEditorModel;
    patch: Partial<CloudClinicalVisitEditorModel>;
  } | null>(null), [, render] = useState(0);
  if (previewOnly || state.closed || !state.draft || !state.snapshot || !state.catalog) editing.current = null;
  else if (editing.current?.controller !== controller || editing.current.editor.sourceDraft !== state.draft
    || editing.current.editor.snapshot !== state.snapshot || editing.current.editor.catalog !== state.catalog) {
    const owned = transition.current?.controller === controller && editing.current?.controller === controller
      && transition.current.current === editing.current.editor && state.snapshot === editing.current.editor.snapshot
      && state.catalog === editing.current.editor.catalog;
    const next = owned ? advanceEditor(editing.current!.editor, state.draft, transition.current!.patch) : createEditor(state);
    editing.current = next ? { controller, editor: next } : null;
    if (owned && next) transition.current!.current = next;
  }
  const current = () => {
    if (live.current.controller !== controller || live.current.previewOnly || live.current.closing || working.current?.controller === controller) return null;
    const value = controller.getState();
    return live.current.controller === controller && !live.current.previewOnly && !live.current.closing && !value.closed ? value : null;
  };
  const owns = (expected: CloudClinicalVisitEditorModel) => {
    const value = current();
    return value && value.phase === 'editing' && editing.current?.controller === controller && editing.current.editor === expected
      && value.draft === expected.sourceDraft && value.snapshot === expected.snapshot && value.catalog === expected.catalog ? value : null;
  };
  const publish = (editor: CloudClinicalVisitEditorModel | null) => { editing.current = editor ? { controller, editor } : null; render(value => value + 1); };
  const changeDraft = (expected: CloudClinicalVisitEditorModel, action: () => boolean, patch: Partial<CloudClinicalVisitEditorModel> = {}) => {
    if (!owns(expected)) return;
    const ticket = { controller }; working.current = ticket;
    const update = { controller, current: expected, patch }; transition.current = update;
    try {
      if (!action()) return;
      const next = controller.getState();
      if (live.current.controller !== controller || live.current.previewOnly || live.current.closing || next.closed || next.phase !== 'editing'
        || next.snapshot !== expected.snapshot || next.catalog !== expected.catalog || !next.draft
        || transition.current !== update || editing.current?.editor !== update.current) return;
      publish(advanceEditor(update.current, next.draft, patch));
    } catch { /* No arbitrary error details or unconfirmed edits reach the view. */ }
    finally { if (working.current === ticket) working.current = null; if (transition.current === update) transition.current = null; }
  };
  // Keep the functional file compact before explicit begin and after completion.
  // Hooks remain unconditional; only the deliberate design preview shows an idle form.
  if (!previewOnly && (state.closed || state.phase === 'idle')) return null;
  return <CloudClinicalVisitEditorView state={state} editor={editing.current?.controller === controller ? editing.current.editor : null} previewOnly={previewOnly} closing={closing}
    onChange={(expected, patch) => { if (owns(expected)) publish({ ...expected, ...patch }); }}
    onChooseService={(expected, id) => changeDraft(expected, () => controller.chooseService(id))}
    onPrice={(expected, rowId, raw) => { if (!owns(expected) || !expected.sourceDraft.services.some(row => row.id === rowId)) return;
      const parsed = parseCloudClinicalVisitMoney(raw), prices = { ...expected.prices, [rowId]: raw };
      if (parsed.valid) changeDraft(expected, () => controller.setServicePrice(rowId, parsed.cents), { prices });
      else publish({ ...expected, prices }); }}
    onRemove={(expected, rowId) => changeDraft(expected, () => controller.removeService(rowId))}
    onTooth={(expected, rowId, tooth) => changeDraft(expected, () => controller.setServiceTooth(rowId, tooth))}
    onExamination={(expected, selected) => changeDraft(expected, () => controller.setExaminationEnabled(selected))}
    onCancel={expected => { if (!owns(expected)) return; const ticket = { controller }; working.current = ticket;
      try { if (controller.cancel() && live.current.controller === controller && !live.current.previewOnly && !live.current.closing && editing.current?.editor === expected) publish(null); }
      finally { if (working.current === ticket) working.current = null; } }}
    onCancelLoading={expected => { const value = current(); if (!value || value !== expected || value.phase !== 'loading' || value.draft) return;
      const ticket = { controller }; working.current = ticket;
      try { controller.cancel(); } finally { if (working.current === ticket) working.current = null; } }}
    onSave={expected => { if (!owns(expected)) return; const submission = buildCloudClinicalVisitSubmission(expected); if (!submission || !owns(expected)) return;
      const ticket = { controller }; working.current = ticket;
      void (async () => { try { await controller.save(submission.metadata, submission.paidCents); }
        catch { /* No provider error or late result is published. */ } finally { if (working.current === ticket) working.current = null; } })(); }} />;
}
