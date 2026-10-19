import React, { useEffect, useId, useRef, useState } from 'react';
import { AlertCircle, ChevronDown, ChevronUp, FileText, Pencil, Pill, Plus, Save, Search, SlidersHorizontal, Trash2, X } from 'lucide-react';
import type { DrugCatalogItem } from '../../types';
import { DRUG_FIELD_LIMITS, drugCatalogChanged, drugCatalogDraft, drugCatalogSnapshot, filterDrugCatalog, getDrugCategories, upsertDrugCatalogItem, validateDrugCatalogDraft } from '../../utils/drugCatalog';
import type { DrugCatalogDraft, DrugCatalogSort } from '../../utils/drugCatalog';
import { useAppointmentDialog } from '../appointments/useAppointmentDialog';
import { useToastAndConfirm } from '../common/ToastAndConfirm';
import './drugCatalogManagement.css';

export interface DrugCatalogManagementProps {
  drugCatalog: DrugCatalogItem[];
  onSaveDrugCatalog: (items: DrugCatalogItem[]) => void | Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
}

interface EditorState {
  item?: DrugCatalogItem;
  baseline: string;
  draft: DrugCatalogDraft;
}

function DrugCatalogEditor({ editor, drugCatalog, onSaveDrugCatalog, onClose }: DrugCatalogManagementProps & { editor: EditorState; onClose: () => void }) {
  const { showToast } = useToastAndConfirm();
  const id = `drug-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [draft, setDraft] = useState(() => ({ ...editor.draft }));
  const [errors, setErrors] = useState<Partial<Record<keyof DrugCatalogDraft, string>>>({});
  const [saveError, setSaveError] = useState('');
  const [showDefaults, setShowDefaults] = useState(!!(draft.defaultDosage || draft.defaultDuration));
  const [discardPrompt, setDiscardPrompt] = useState(false);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);
  const changed = JSON.stringify(draft) !== JSON.stringify(editor.draft);
  const conflict = drugCatalogChanged(editor.baseline, drugCatalog);
  const resumeEditing = () => {
    setDiscardPrompt(false);
    requestAnimationFrame(() => formRef.current?.querySelector<HTMLInputElement>('input')?.focus());
  };
  const requestClose = () => {
    if (busy.current) return;
    if (discardPrompt) { resumeEditing(); return; }
    if (!changed) { onClose(); return; }
    setDiscardPrompt(true);
    requestAnimationFrame(() => continueRef.current?.focus());
  };
  const dialogRef = useAppointmentDialog(true, requestClose);
  const categories = getDrugCategories(drugCatalog);
  const update = (key: keyof DrugCatalogDraft, value: string) => {
    setDraft(current => ({ ...current, [key]: value }));
    setErrors(current => { const next = { ...current }; delete next[key]; return next; });
    setSaveError('');
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy.current || conflict || discardPrompt) return;
    const checked = validateDrugCatalogDraft(draft, drugCatalog, editor.item?.id);
    setErrors(checked.errors);
    if (!checked.valid) {
      if (checked.errors.defaultDosage || checked.errors.defaultDuration) setShowDefaults(true);
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLInputElement>('input[aria-invalid="true"]')?.focus());
      return;
    }
    busy.current = true;
    setSaving(true);
    try {
      const newId = `drug_${typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`}`;
      const next = upsertDrugCatalogItem(drugCatalog, checked.value, editor.item?.id, newId);
      await onSaveDrugCatalog(next);
      showToast(editor.item ? 'تم حفظ تعديلات الدواء.' : 'تمت إضافة الدواء إلى الفهرس.', 'success');
      onClose();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'تعذّر حفظ الدواء. بياناتك في النافذة كما هي؛ حاول مرة أخرى.');
    } finally { busy.current = false; setSaving(false); }
  };
  const field = (key: keyof DrugCatalogDraft, label: string, hint: string, optional = false) => (
    <div className="dc-field">
      <label htmlFor={`${id}-${key}`}>{label}{optional && <span>اختياري</span>}</label>
      <input id={`${id}-${key}`} type="text" dir="auto" value={draft[key]} maxLength={DRUG_FIELD_LIMITS[key]} required={key === 'name'}
        data-dialog-autofocus={key === 'name' ? true : undefined} list={key === 'category' ? `${id}-categories` : undefined}
        aria-invalid={!!errors[key]} aria-describedby={`${id}-${key}-hint${errors[key] ? ` ${id}-${key}-error` : ''}`}
        onChange={event => update(key, event.target.value)} />
      <p id={`${id}-${key}-hint`} className="dc-hint">{hint}</p>
      {errors[key] && <p id={`${id}-${key}-error`} className="dc-error" role="alert">{errors[key]}</p>}
    </div>
  );

  return <div className="clinic-modal-overlay dc-overlay" dir="rtl" onClick={event => { if (event.target === event.currentTarget) requestClose(); }}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-intro`} tabIndex={-1} className="clinic-modal-panel clinic-modal-panel--framed dc-dialog">
      <header className="dc-dialog-header"><span className="dc-dialog-icon"><Pill aria-hidden="true" /></span><div><h2 id={`${id}-title`}>{editor.item ? 'تعديل الدواء' : 'إضافة دواء للفهرس'}</h2><p id={`${id}-intro`}>بيانات واضحة للاختيار عند إنشاء الروشتة.</p></div><button type="button" className="dc-icon-button" aria-label="إلغاء وإغلاق الدواء" onClick={requestClose} disabled={saving}><X aria-hidden="true" /></button></header>
      <form ref={formRef} onSubmit={save} noValidate className="dc-editor-form">
        <div className="dc-editor-body overflow-y-auto">
          {discardPrompt ? <section className="dc-discard-prompt" aria-label="تأكيد إلغاء التعديلات"><AlertCircle aria-hidden="true" /><h3>إلغاء التعديلات غير المحفوظة؟</h3><p>لن تتغير قائمة الأدوية. يمكنك الرجوع لإكمال التعديل أو الإغلاق بدون حفظ.</p><div><button ref={continueRef} type="button" className="dc-button dc-button-primary" onClick={resumeEditing}>متابعة التعديل</button><button type="button" className="dc-button dc-button-danger" onClick={onClose}>إغلاق بدون حفظ</button></div></section> : <>
            {conflict && <div className="dc-alert" role="alert"><AlertCircle aria-hidden="true" /><p>تغيّرت قائمة الأدوية أثناء فتح هذه النافذة. لن تُحفظ المسودة فوق التغييرات الجديدة؛ أغلق النافذة وأعد فتح الدواء من القائمة.</p></div>}
            <section className="dc-form-section"><h3>بيانات الدواء</h3>{field('name', 'اسم الدواء والتركيز', 'اكتب الاسم كما تريد ظهوره في الروشتة. أضف التركيز لتمييز الأنواع.')}{field('category', 'التصنيف', 'اختَر تصنيفًا سابقًا أو اكتب تصنيفًا جديدًا. يمكنك تركه فارغًا.', true)}<datalist id={`${id}-categories`}>{categories.map(category => <option key={category} value={category} />)}</datalist></section>
            <section className="dc-defaults-section"><button type="button" className="dc-defaults-toggle" aria-expanded={showDefaults} aria-controls={`${id}-defaults`} onClick={() => setShowDefaults(value => !value)}><FileText aria-hidden="true" /><span><strong>نصوص جاهزة للروشتة</strong><small>اختياري · يكتبها الطبيب ويراجعها لكل مريض</small></span>{showDefaults ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}</button>
              <div id={`${id}-defaults`} hidden={!showDefaults} className="dc-defaults-fields">{field('defaultDosage', 'نص الجرعة الافتراضي', 'يُنسخ عند اختيار الدواء في روشتة جديدة، ويمكن تعديله حسب المريض. تركه فارغًا لا يضيف جرعة تلقائية.', true)}{field('defaultDuration', 'مدة العلاج الافتراضية', 'نص اختياري يحدده الطبيب. لن تتغير أي روشتة محفوظة سابقًا.', true)}</div>
            </section>
            <p className="dc-editor-note"><AlertCircle aria-hidden="true" /><span>هذا فهرس لتنظيم الأدوية، وليس توصية علاجية. كل جرعة ومدة تُراجع بواسطة الطبيب قبل إصدار الروشتة.</span></p>
            {saveError && <div className="dc-alert" role="alert"><AlertCircle aria-hidden="true" /><p>{saveError}</p></div>}
          </>}
        </div>
        {!discardPrompt && <footer className="dc-dialog-footer"><button type="button" className="dc-button" onClick={requestClose} disabled={saving}>إلغاء وإغلاق</button><button type="submit" className="dc-button dc-button-primary" disabled={saving || conflict || (!!editor.item && !changed)}><Save aria-hidden="true" />{saving ? 'جارٍ الحفظ…' : 'حفظ الدواء'}</button></footer>}
      </form>
    </div>
  </div>;
}

export function DrugCatalogManagement({ drugCatalog, onSaveDrugCatalog, onDirtyChange }: DrugCatalogManagementProps) {
  const { askConfirm, showToast } = useToastAndConfirm();
  const id = `drug-catalog-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [sort, setSort] = useState<DrugCatalogSort>('name');
  const [editor, setEditor] = useState<EditorState | null>(null);
  useEffect(() => { onDirtyChange?.(!!editor); return () => onDirtyChange?.(false); }, [editor, onDirtyChange]);
  const [saveError, setSaveError] = useState('');
  const latest = useRef({ drugCatalog, onSaveDrugCatalog });
  latest.current = { drugCatalog, onSaveDrugCatalog };
  const categories = getDrugCategories(drugCatalog);
  const filtered = filterDrugCatalog(drugCatalog, { query, category, sort });
  const hasUncategorized = drugCatalog.some(item => !item.category?.trim());
  const filteredActive = !!query || category !== null;
  const resetFilters = () => { setQuery(''); setCategory(null); };
  const openEditor = (item?: DrugCatalogItem) => {
    setSaveError('');
    setEditor({ item, baseline: drugCatalogSnapshot(drugCatalog), draft: drugCatalogDraft(item) });
  };
  const remove = (item: DrugCatalogItem) => {
    const baseline = drugCatalogSnapshot(drugCatalog);
    setSaveError('');
    askConfirm({ title: `حذف «${item.name}» من الفهرس؟`, message: 'لن يظهر هذا الدواء في قائمة الاختيار للروشتات الجديدة. الروشتات المحفوظة وبيانات المرضى لن تُحذف أو تتغير.', confirmLabel: 'حذف من الفهرس', tone: 'danger', onConfirm: async () => {
      const current = latest.current;
      if (drugCatalogChanged(baseline, current.drugCatalog)) {
        setSaveError('تغيّرت قائمة الأدوية قبل تأكيد الحذف. راجع القائمة ثم أعد المحاولة.');
        return;
      }
      try {
        await current.onSaveDrugCatalog(current.drugCatalog.filter(entry => entry.id !== item.id));
        showToast('تم حذف الدواء من الفهرس فقط.', 'success');
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : 'تعذّر حذف الدواء. القائمة كما هي؛ حاول مرة أخرى.');
      }
    } });
  };
  return <section className="drug-catalog-management" dir="rtl" aria-labelledby={`${id}-title`}>
    <header className="dc-header"><div><span className="dc-eyebrow">تنظيم الروشتة</span><h2 id={`${id}-title`}>فهرس الأدوية</h2><p>ابحث عن الدواء، نظّم تصنيفه، وعدّل النصوص الجاهزة من مكان واحد.</p></div><button type="button" className="dc-button dc-button-primary" onClick={() => openEditor()}><Plus aria-hidden="true" />إضافة دواء</button></header>
    <div className="dc-scope-note"><FileText aria-hidden="true" /><p>تعديل الفهرس يؤثر على الاختيار في الروشتات الجديدة فقط. الروشتات المحفوظة سابقًا تظل كما هي.</p></div>
    {saveError && <div className="dc-alert" role="alert"><AlertCircle aria-hidden="true" /><p>{saveError}</p><button type="button" className="dc-icon-button" aria-label="إغلاق رسالة حفظ الأدوية" onClick={() => setSaveError('')}><X aria-hidden="true" /></button></div>}
    <section className="dc-catalog-panel" aria-label="قائمة الأدوية">
      <div className="dc-toolbar"><div className="dc-search-field"><label htmlFor={`${id}-search`}>البحث</label><div><Search aria-hidden="true" /><input id={`${id}-search`} type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="اسم الدواء أو التصنيف" /><button type="button" className="dc-icon-button" aria-label="مسح البحث عن دواء" disabled={!query} onClick={() => setQuery('')}><X aria-hidden="true" /></button></div></div>
        <div className="dc-filter-field"><label htmlFor={`${id}-category`}>التصنيف</label><select id={`${id}-category`} value={category === null ? 'all' : category === '' ? 'blank' : `category:${category}`} onChange={event => setCategory(event.target.value === 'all' ? null : event.target.value === 'blank' ? '' : event.target.value.slice(9))}><option value="all">كل التصنيفات</option>{(hasUncategorized || category === '') && <option value="blank">بدون تصنيف</option>}{categories.map(label => <option key={label} value={`category:${label}`}>{label}</option>)}{category && !categories.includes(category) && <option value={`category:${category}`}>{category}</option>}</select></div>
        <div className="dc-filter-field"><label htmlFor={`${id}-sort`}>الترتيب</label><select id={`${id}-sort`} value={sort} onChange={event => setSort(event.target.value as DrugCatalogSort)}><option value="name">الاسم</option><option value="category">التصنيف ثم الاسم</option></select></div>
      </div>
      <div className="dc-results-heading"><p role="status">{filteredActive ? `عرض ${filtered.length} من ${drugCatalog.length}` : `عدد الأدوية: ${drugCatalog.length}`}<span> · التصنيفات: {categories.length}</span></p>{filteredActive && <button type="button" className="dc-reset-button" onClick={resetFilters}><SlidersHorizontal aria-hidden="true" />عرض الكل</button>}</div>
      {filtered.length ? <div className="dc-list">{filtered.map(item => <article key={item.id} className="dc-drug-row"><span className="dc-drug-icon"><Pill aria-hidden="true" /></span><div className="dc-drug-content"><div className="dc-drug-heading"><h3 dir="auto">{item.name}</h3><span className="dc-category-tag">{item.category?.trim() || 'بدون تصنيف'}</span></div>{item.defaultDosage || item.defaultDuration ? <dl className="dc-drug-defaults">{item.defaultDosage && <div><dt>الجرعة الجاهزة</dt><dd dir="auto">{item.defaultDosage}</dd></div>}{item.defaultDuration && <div><dt>المدة الجاهزة</dt><dd dir="auto">{item.defaultDuration}</dd></div>}</dl> : <p className="dc-no-defaults">بدون جرعة أو مدة افتراضية</p>}</div><div className="dc-row-actions"><button type="button" className="dc-button dc-edit-button" aria-label={`تعديل ${item.name}`} onClick={() => openEditor(item)}><Pencil aria-hidden="true" />تعديل</button><button type="button" className="dc-button dc-button-danger" aria-label={`حذف ${item.name} من الفهرس`} onClick={() => remove(item)}><Trash2 aria-hidden="true" />حذف</button></div></article>)}</div> : <div className="dc-empty"><Pill aria-hidden="true" /><h3>{drugCatalog.length ? 'لا توجد أدوية مطابقة' : 'ابدأ بتنظيم فهرس الأدوية'}</h3><p>{drugCatalog.length ? 'جرّب اسمًا آخر أو اعرض جميع التصنيفات.' : 'أضف أسماء الأدوية والتركيز، ثم اكتب نصوص الروشتة الاختيارية حسب اختيار الطبيب.'}</p><button type="button" className="dc-button" onClick={drugCatalog.length ? resetFilters : () => openEditor()}>{drugCatalog.length ? 'عرض جميع الأدوية' : 'إضافة أول دواء'}</button></div>}
    </section>
    {editor && <DrugCatalogEditor editor={editor} drugCatalog={drugCatalog} onSaveDrugCatalog={onSaveDrugCatalog} onClose={() => setEditor(null)} />}
  </section>;
}
