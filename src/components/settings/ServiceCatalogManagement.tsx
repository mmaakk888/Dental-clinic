import React, { useEffect, useId, useRef, useState } from 'react';
import { AlertCircle, Banknote, Building2, CheckCircle2, List, LockKeyhole, Pencil, Plus, Save, Search, SlidersHorizontal, Trash2, Undo2, X } from 'lucide-react';
import type { Lab, LabService } from '../../types';
import { cloneServiceCatalog, getServiceGroup, isProtectedServiceType, normalizeServiceName, validateServiceCatalog, validateServiceName } from '../../utils/serviceCatalog';
import type { ServiceCatalogValues } from '../../utils/serviceCatalog';
import { useAppointmentDialog } from '../appointments/useAppointmentDialog';
import { useToastAndConfirm } from '../common/ToastAndConfirm';
import { LabPricingManagement } from './LabPricingManagement';
import './serviceCatalogManagement.css';

export interface ServiceCatalogManagementProps extends ServiceCatalogValues {
  canManagePrices: boolean;
  onSaveServiceCatalog: (values: ServiceCatalogValues) => void;
  labs: Lab[];
  canViewLabCosts: boolean;
  canManageLabPrices: boolean;
  onSaveLabPricing: (labId: string, services: LabService[], baseline: Lab) => void;
  initialPricingLabId?: string;
}
const snapshot = (values: ServiceCatalogValues) => JSON.stringify(values);
type Editor = { index?: number; name: string; baseline: string };

function ServiceNameEditor({ editor, values, onChange, onClose }: {
  editor: Editor; values: ServiceCatalogValues; onChange: (names: string[]) => void; onClose: () => void;
}) {
  const id = `service-name-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [name, setName] = useState(editor.name);
  const [error, setError] = useState('');
  const [discard, setDiscard] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);
  const conflict = editor.baseline !== snapshot(values);
  const close = () => {
    if (discard) { setDiscard(false); requestAnimationFrame(() => inputRef.current?.focus()); return; }
    if (name === editor.name) { onClose(); return; }
    setDiscard(true); requestAnimationFrame(() => continueRef.current?.focus());
  };
  const dialogRef = useAppointmentDialog(true, close);
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (conflict || discard) return;
    const checked = validateServiceName(name, values.serviceTypes, editor.index);
    if (!checked.valid) { setError(checked.error); inputRef.current?.focus(); return; }
    const names = [...values.serviceTypes];
    if (editor.index === undefined) names.push(checked.value); else names[editor.index] = checked.value;
    onChange(names); onClose();
  };
  return <div className="clinic-modal-overlay sc-overlay" dir="rtl" onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} tabIndex={-1} className="clinic-modal-panel clinic-modal-panel--framed sc-dialog">
      <header className="sc-dialog-header"><div><h2 id={`${id}-title`}>{editor.index === undefined ? 'إضافة خدمة' : 'تعديل اسم الخدمة'}</h2><p>التعديل في المسودة أولًا، ثم احفظ الفهرس.</p></div><button type="button" className="sc-icon-button" aria-label="إغلاق خدمة" onClick={close}><X aria-hidden="true" /></button></header>
      <form onSubmit={submit} noValidate>
        <div className="sc-dialog-body overflow-y-auto">{discard ? <section className="sc-discard"><AlertCircle aria-hidden="true" /><h3>إغلاق بدون إضافة التعديل؟</h3><p>الاسم الذي كتبته لن يُضاف إلى المسودة.</p><div className="sc-actions"><button ref={continueRef} type="button" className="sc-button sc-primary" onClick={() => { setDiscard(false); requestAnimationFrame(() => inputRef.current?.focus()); }}>متابعة التعديل</button><button type="button" className="sc-button" onClick={onClose}>إغلاق بدون تعديل</button></div></section> : <>
          {conflict && <p className="sc-alert" role="alert">تغيرت المسودة أثناء فتح النافذة. أغلق النافذة وافتح الخدمة من جديد.</p>}
          <div className="sc-field"><label htmlFor={id}>اسم الخدمة</label><input ref={inputRef} data-dialog-autofocus id={id} dir="auto" value={name} maxLength={80} aria-invalid={!!error} aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`} onChange={event => { setName(event.target.value); setError(''); }} /><p id={`${id}-hint`}>اسم مختصر وواضح يظهر عند تسجيل خدمة جديدة.</p>{error && <p id={`${id}-error`} className="sc-error" role="alert">{error}</p>}</div>
          <p className="sc-note">تغيير الاسم لا يعيد تسمية الخدمات أو الجلسات المحفوظة سابقًا.</p>
        </>}</div>
        {!discard && <footer className="sc-dialog-footer"><button type="button" className="sc-button" onClick={close}>إلغاء</button><button type="submit" className="sc-button sc-primary" disabled={conflict || (editor.index !== undefined && name === editor.name)}><CheckCircle2 aria-hidden="true" />{editor.index === undefined ? 'إضافة إلى المسودة' : 'تحديث المسودة'}</button></footer>}
      </form>
    </div>
  </div>;
}

export function ServiceCatalogManagement({ serviceTypes, crownPrices, canManagePrices, onSaveServiceCatalog,
  labs, canViewLabCosts, canManageLabPrices, onSaveLabPricing, initialPricingLabId }: ServiceCatalogManagementProps) {
  const { showToast, askConfirm } = useToastAndConfirm();
  const id = `service-catalog-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [draft, setDraft] = useState(() => cloneServiceCatalog({ serviceTypes, crownPrices }));
  const [saved, setSaved] = useState(() => cloneServiceCatalog({ serviceTypes, crownPrices }));
  const [section, setSection] = useState<'services' | 'prices' | 'labs'>(initialPricingLabId ? 'labs' : 'services');
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('all');
  const [sort, setSort] = useState('original');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const draftRef = useRef(draft); draftRef.current = draft;
  const savedRef = useRef(saved); savedRef.current = saved;
  const received = useRef(snapshot(saved));
  const latest = useRef({ canManagePrices, onSaveServiceCatalog }); latest.current = { canManagePrices, onSaveServiceCatalog };
  const formRef = useRef<HTMLFormElement>(null);
  const saveBarRef = useRef<HTMLElement>(null);
  const [bar, setBar] = useState({ pinned: false, left: 0, width: 0, height: 0 });
  const dirty = snapshot(draft) !== snapshot(saved);

  useEffect(() => {
    if (initialPricingLabId) setSection('labs');
  }, [initialPricingLabId]);

  useEffect(() => {
    const incoming = cloneServiceCatalog({ serviceTypes, crownPrices });
    if (snapshot(incoming) === received.current) return;
    received.current = snapshot(incoming);
    const clash = snapshot(draftRef.current) !== snapshot(savedRef.current) && snapshot(draftRef.current) !== snapshot(incoming);
    setSaved(incoming); setConflict(clash);
    if (!clash) { setDraft(cloneServiceCatalog(incoming)); setErrors({}); setSaveError(''); }
  }, [serviceTypes, crownPrices]);
  useEffect(() => {
    const measure = () => {
      if (!formRef.current || !saveBarRef.current) return;
      const bounds = formRef.current.getBoundingClientRect();
      const next = { pinned: section !== 'labs' && dirty && canManagePrices && window.innerHeight >= 520 && bounds.width > 0, left: bounds.left, width: bounds.width, height: saveBarRef.current.getBoundingClientRect().height };
      setBar(previous => previous.pinned === next.pinned && Math.abs(previous.left - next.left) < .5 && Math.abs(previous.width - next.width) < .5 && Math.abs(previous.height - next.height) < .5 ? previous : next);
    };
    const observer = new ResizeObserver(measure);
    if (formRef.current) observer.observe(formRef.current);
    if (saveBarRef.current) observer.observe(saveBarRef.current);
    window.addEventListener('resize', measure); measure();
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [dirty, canManagePrices, section]);
  const updateNames = (names: string[]) => {
    if (!latest.current.canManagePrices || conflict) return;
    setDraft(current => ({ ...current, serviceTypes: names })); setErrors({}); setSaveError('');
  };
  const remove = (name: string, index: number) => {
    const baseline = snapshot(draft);
    askConfirm({ title: 'إزالة الخدمة من الفهرس؟', message: `سيُحذف «${name}» من اختيارات التسجيل الجديد بعد حفظ المسودة. الجلسات والحسابات السابقة لا تتغير.`, confirmLabel: 'إزالة من المسودة', tone: 'warning', onConfirm: () => {
      if (!latest.current.canManagePrices || baseline !== snapshot(draftRef.current) || isProtectedServiceType(name)) { showToast('تغيرت القائمة أو الصلاحية. أعد فتح الإجراء.', 'warning'); return; }
      updateNames(draftRef.current.serviceTypes.filter((_, position) => position !== index));
    } });
  };
  const discard = () => askConfirm({ title: 'إلغاء التغييرات غير المحفوظة؟', message: 'ستعود قائمة الخدمات وأسعار التركيبات إلى آخر إعدادات محفوظة. بيانات المرضى لا تتغير.', confirmLabel: 'إلغاء التغييرات', tone: 'warning', onConfirm: () => {
    setDraft(cloneServiceCatalog(savedRef.current)); setErrors({}); setSaveError(''); setConflict(false); setEditor(null);
  } });
  const save = (event: React.FormEvent) => {
    event.preventDefault();
    if (busy.current || !dirty || conflict || !latest.current.canManagePrices) return;
    const checked = validateServiceCatalog(draft, saved);
    setErrors(checked.errors);
    if (!checked.valid) {
      const key = Object.keys(checked.errors)[0]; setSection(key.startsWith('crownPrices.') ? 'prices' : 'services');
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus());
      showToast('راجع البيانات الموضحة قبل الحفظ.', 'warning'); return;
    }
    busy.current = true; setSaving(true); setSaveError('');
    try {
      latest.current.onSaveServiceCatalog(checked.value);
      setDraft(cloneServiceCatalog(checked.value)); setSaved(cloneServiceCatalog(checked.value)); setConflict(false);
      showToast('تم حفظ قائمة الخدمات وأسعار التركيبات.', 'success');
    } catch (error) { setSaveError(error instanceof Error ? error.message : 'تعذر الحفظ. المسودة محفوظة هنا؛ حاول مرة أخرى.'); }
    finally { busy.current = false; setSaving(false); }
  };
  const rows = draft.serviceTypes.map((name, index) => ({ name, index })).filter(({ name }) => normalizeServiceName(name).includes(normalizeServiceName(query)) && (group === 'all' || getServiceGroup(name) === group));
  if (sort === 'name') rows.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  const prices = Object.entries(draft.crownPrices);
  const activeFilter = !!query || group !== 'all';
  const editable = canManagePrices && !conflict;
  return <section className="sc-manager" data-section={section} dir="rtl" aria-label="إدارة الخدمات والأسعار">
    <header className="sc-header"><span className="sc-heading-icon"><SlidersHorizontal aria-hidden="true" /></span><div><h2>الخدمات والأسعار</h2><p>خدمات العيادة، وأسعار البيع للمريض، وتكلفة كل معمل.</p></div><span hidden={section === 'labs'} className="sc-status" data-dirty={dirty}>{dirty ? 'تغييرات غير محفوظة' : 'الفهرس المحفوظ'}</span></header>
    <div className="sc-tabs" aria-label="أقسام الخدمات والأسعار">
      <button type="button" aria-pressed={section === 'services'} onClick={() => setSection('services')}><List aria-hidden="true" />الخدمات <span>{draft.serviceTypes.length}</span></button>
      <button type="button" aria-pressed={section === 'prices'} onClick={() => setSection('prices')}><Banknote aria-hidden="true" />أسعار البيع <span>{prices.length}</span></button>
      <button type="button" aria-pressed={section === 'labs'} onClick={() => setSection('labs')}><Building2 aria-hidden="true" />أسعار المعامل{canViewLabCosts && <span>{labs.length}</span>}</button>
    </div>
    <div hidden={section === 'labs'} className="sc-catalog-panel">
    {!canManagePrices && <p className="sc-alert"><LockKeyhole aria-hidden="true" />حسابك يمكنه عرض الفهرس فقط. تعديل الخدمات والأسعار يحتاج صلاحية إدارة الأسعار.</p>}
    {conflict && <div className="sc-alert" role="alert"><AlertCircle aria-hidden="true" /><span>تغيرت الإعدادات في نافذة أخرى. مسودتك كما هي، ولن نحفظها فوق التغييرات الجديدة. استخدم «إلغاء التغييرات» لتحميل آخر نسخة.</span></div>}
    <form ref={formRef} onSubmit={save} noValidate className="sc-form">
      <div hidden={section !== 'services'} className="sc-section-card">
        <div className="sc-section-heading"><div><h3>الخدمات المتاحة للتسجيل</h3><p>نظّم الأسماء التي تختار منها عند إضافة خدمة في ملف المريض.</p></div><button type="button" className="sc-button sc-primary" disabled={!editable} onClick={() => setEditor({ name: '', baseline: snapshot(draft) })}><Plus aria-hidden="true" />إضافة خدمة</button></div>
        <div className="sc-search"><Search aria-hidden="true" /><label className="sr-only" htmlFor={`${id}-search`}>بحث في الخدمات</label><input id={`${id}-search`} type="search" value={query} placeholder="ابحث باسم الخدمة…" onChange={event => setQuery(event.target.value)} /></div>
        <div className="sc-filters"><div><label htmlFor={`${id}-group`}>التصنيف</label><select id={`${id}-group`} value={group} onChange={event => setGroup(event.target.value)}><option value="all">كل الخدمات</option><option value="clinical">علاج ومتابعة</option><option value="prosthetic">تركيبات</option></select></div><div><label htmlFor={`${id}-sort`}>الترتيب</label><select id={`${id}-sort`} value={sort} onChange={event => setSort(event.target.value)}><option value="original">ترتيب الفهرس</option><option value="name">حسب الاسم</option></select></div></div>
        <div className="sc-result-count" aria-live="polite"><span>الخدمات الظاهرة: {rows.length} من {draft.serviceTypes.length}</span>{activeFilter && <button type="button" onClick={() => { setQuery(''); setGroup('all'); }}>مسح البحث والتصفية</button>}</div>
        {errors.serviceTypes && <p className="sc-error" role="alert">{errors.serviceTypes}</p>}
        <div className="sc-list">{rows.map(({ name, index }) => <div key={`${index}-${name}`} className="sc-row"><span className="sc-row-number">{index + 1}</span><div className="sc-row-info"><strong dir="auto">{name}</strong><small>{getServiceGroup(name) === 'prosthetic' ? 'تركيبات' : 'علاج ومتابعة'}{isProtectedServiceType(name) && ' · نوع مرتبط بالنظام'}</small>{errors[`serviceTypes.${index}`] && <p className="sc-error" role="alert">{errors[`serviceTypes.${index}`]}</p>}</div>{isProtectedServiceType(name) ? <span className="sc-protected" title="اسم ثابت للحفاظ على تسجيل التركيبات"><LockKeyhole aria-hidden="true" /><span>ثابت</span></span> : <div className="sc-row-actions"><button type="button" className="sc-icon-button" disabled={!editable} aria-label={`تعديل خدمة ${name}`} onClick={() => setEditor({ index, name, baseline: snapshot(draft) })}><Pencil aria-hidden="true" /></button><button type="button" className="sc-icon-button sc-danger" disabled={!editable} aria-label={`إزالة خدمة ${name}`} onClick={() => remove(name, index)}><Trash2 aria-hidden="true" /></button></div>}</div>)}</div>
        {!rows.length && <div className="sc-empty"><Search aria-hidden="true" /><h3>{activeFilter ? 'لا توجد خدمات تطابق البحث' : 'الفهرس فارغ'}</h3><p>{activeFilter ? 'جرّب اسمًا مختلفًا أو امسح التصفية.' : 'أضف خدمة إلى المسودة ثم احفظ الفهرس.'}</p></div>}
        <p className="sc-note"><AlertCircle aria-hidden="true" /><span>هذه قائمة أسماء، وليست تسعيرًا عامًا. مبلغ الخدمة العادية يُكتب عند تسجيل الجلسة، ولا تتغير أسعار الاختصارات السريعة من هنا. نوعا التركيبات الثابتة والمتحركة يحتفظان باسميهما لارتباطهما بالنظام.</span></p>
      </div>
      <div hidden={section !== 'prices'} className="sc-section-card">
        <div className="sc-section-heading"><div><h3>سعر بيع التركيبة للمريض</h3><p>السعر للوحدة الواحدة، بالجنيه المصري.</p></div><span className="sc-price-unit">ج.م / وحدة</span></div>
        <p className="sc-note"><Banknote aria-hidden="true" /><span>هذه أسعار بيع للمريض، وليست تكلفة المعمل. التعديل يُستخدم في التسجيل الجديد فقط؛ حسابات المرضى والجلسات القديمة لا تتغير.</span></p>
        <div className="sc-price-list">{prices.map(([name, price], index) => { const key = `crownPrices.${name}`; return <div className="sc-price-row" key={name}><div><label htmlFor={`${id}-price-${index}`} dir="auto">{name}</label><small>لكل وحدة من هذا النوع</small></div><div className="sc-price-field"><input id={`${id}-price-${index}`} dir="ltr" type="text" inputMode="decimal" value={String(price ?? '')} disabled={!editable} maxLength={16} aria-invalid={!!errors[key]} aria-describedby={errors[key] ? `${id}-price-error-${index}` : undefined} onChange={event => {
          const value = event.target.value; setDraft(current => ({ ...current, crownPrices: { ...current.crownPrices, [name]: value as unknown as number } }));
          setErrors(previous => { const next = { ...previous }; delete next[key]; return next; }); setSaveError('');
        }} /><span aria-hidden="true">ج.م</span></div>{errors[key] && <p id={`${id}-price-error-${index}`} role="alert" className="sc-error">{errors[key]}</p>}</div>; })}</div>
        {!prices.length && <div className="sc-empty"><Banknote aria-hidden="true" /><h3>لا توجد أسعار تركيبات محفوظة</h3><p>لن نضيف أسعارًا من عندنا أو نغير حسابات المرضى.</p></div>}
      </div>
      {saveError && <p className="sc-alert" role="alert"><AlertCircle aria-hidden="true" />{saveError}</p>}
      {canManagePrices && <><div aria-hidden="true" style={bar.pinned ? { height: bar.height + 16 } : undefined} /><footer ref={saveBarRef} className="sc-save-bar" data-pinned={bar.pinned} style={bar.pinned ? { left: bar.left, width: bar.width } : undefined}><div><strong>{dirty ? 'المسودة جاهزة للمراجعة' : 'كل التغييرات محفوظة'}</strong><small>الحفظ يطبّق الفهرس والأسعار معًا.</small></div><div className="sc-actions"><button type="button" className="sc-button" onClick={discard} disabled={(!dirty && !conflict) || saving}><Undo2 aria-hidden="true" />إلغاء التغييرات</button><button type="submit" className="sc-button sc-primary" disabled={!dirty || conflict || saving}><Save aria-hidden="true" />{saving ? 'جارٍ الحفظ…' : 'حفظ الفهرس والأسعار'}</button></div></footer></>}
    </form>
    {editor && editable && <ServiceNameEditor editor={editor} values={draft} onChange={updateNames} onClose={() => setEditor(null)} />}
    </div>
    <div hidden={section !== 'labs'} className="sc-lab-pricing-panel">
      {canViewLabCosts ? <LabPricingManagement labs={labs} canViewLabCosts={canViewLabCosts} canManageLabPrices={canManageLabPrices}
        onSaveLabPricing={onSaveLabPricing} initialLabId={initialPricingLabId === '*' ? undefined : initialPricingLabId} />
        : <section className="sc-section-card" aria-label="أسعار المعامل"><h3>أسعار المعامل</h3><p className="sc-alert"><LockKeyhole aria-hidden="true" />عرض تكلفة المعامل غير متاح لحسابك أو في وضع الخصوصية الحالي.</p></section>}
    </div>
  </section>;
}
