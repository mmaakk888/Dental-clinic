import React, { useEffect, useId, useRef, useState } from 'react';
import { AlertCircle, Banknote, Building2, ChevronDown, LockKeyhole, Plus, Save, Trash2, Undo2 } from 'lucide-react';
import type { Lab, LabService } from '../../types';
import { cloneLab, createLabPricingDraft, snapshotLab, validateLabPricingDraft } from '../../utils/labPricing';
import type { LabPricingDraftRow } from '../../utils/labPricing';
import { useToastAndConfirm } from '../common/ToastAndConfirm';
import './labPricingManagement.css';

export interface LabPricingManagementProps {
  labs: Lab[];
  canViewLabCosts: boolean;
  canManageLabPrices: boolean;
  initialLabId?: string;
  onSaveLabPricing: (labId: string, services: LabService[], baseline: Lab) => void;
}

type LabDraft = { baseline: Lab; rows: LabPricingDraftRow[]; errors: Record<string, string>; saveError: string };
const newDraft = (lab: Lab): LabDraft => ({ baseline: cloneLab(lab), rows: createLabPricingDraft(lab), errors: {}, saveError: '' });
const isDirty = (draft: LabDraft) => JSON.stringify(draft.rows) !== JSON.stringify(createLabPricingDraft(draft.baseline));
const categoryLabels = { fixed: 'تركيبات ثابتة', removable: 'تركيبات متحركة', other: 'أخرى' };

/** The authorized child is never mounted, or initialized with costs, without read access. */
export function LabPricingManagement(props: LabPricingManagementProps) {
  if (!props.canViewLabCosts) return <section className="lp-manager" dir="rtl" aria-label="تكلفة المعامل">
    <header className="lp-header"><span className="lp-heading-icon"><Building2 aria-hidden="true" /></span><div><h2>تكلفة المعامل</h2><p>أسعار كل معمل عند تسجيل الحالات الجديدة.</p></div></header>
    <p className="lp-alert"><LockKeyhole aria-hidden="true" />عرض تكلفة المعامل غير متاح لحسابك أو في وضع الخصوصية الحالي.</p>
  </section>;
  return <AuthorizedLabPricingManagement {...props} />;
}

function AuthorizedLabPricingManagement(props: LabPricingManagementProps) {
  const { labs, canManageLabPrices, initialLabId } = props;
  const { showToast, askConfirm } = useToastAndConfirm();
  const id = `lab-pricing-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const startingLab = labs.find(lab => lab.id === initialLabId) || labs[0];
  const [selectedId, setSelectedId] = useState(startingLab?.id || '');
  const [drafts, setDrafts] = useState(() => new Map<string, LabDraft>(startingLab ? [[startingLab.id, newDraft(startingLab)]] : []));
  const [expanded, setExpanded] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const latest = useRef(props); latest.current = props;
  const draftsRef = useRef(drafts); draftsRef.current = drafts;
  const selectionRef = useRef(selectedId); selectionRef.current = selectedId;
  const formRef = useRef<HTMLFormElement>(null);
  const active = useRef(true);
  const busy = useRef(false);
  const lastRequestedLab = useRef(initialLabId);
  const receivedLab = labs.find(lab => lab.id === selectedId);
  const draft = drafts.get(selectedId);
  const dirty = !!draft && isDirty(draft);
  const conflict = !!draft && (!receivedLab || snapshotLab(receivedLab) !== snapshotLab(draft.baseline));
  const editable = canManageLabPrices && !conflict && !saving;

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  // Refresh clean drafts. An edited draft retains its original complete baseline for the parent save check.
  useEffect(() => {
    setDrafts(current => {
      let changed = false;
      const next = new Map(current);
      current.forEach((entry, labId) => {
        const incoming = labs.find(lab => lab.id === labId);
        if (incoming && !isDirty(entry) && snapshotLab(incoming) !== snapshotLab(entry.baseline)) {
          next.set(labId, newDraft(incoming)); changed = true;
        }
      });
      const selected = labs.find(lab => lab.id === selectionRef.current);
      if (selected && !next.has(selected.id)) { next.set(selected.id, newDraft(selected)); changed = true; }
      return changed ? next : current;
    });
    if (!labs.some(lab => lab.id === selectionRef.current)) {
      const current = draftsRef.current.get(selectionRef.current);
      if (!current || !isDirty(current)) {
        const first = labs[0];
        setSelectedId(first?.id || '');
        if (first) setDrafts(previous => previous.has(first.id) ? previous : new Map(previous).set(first.id, newDraft(first)));
        setExpanded(null);
      }
    }
  }, [labs]);

  const selectLab = (labId: string) => {
    if (!active.current || !latest.current.canViewLabCosts) return;
    const incoming = latest.current.labs.find(lab => lab.id === labId);
    if (!incoming) return;
    setDrafts(previous => previous.has(labId) ? previous : new Map(previous).set(labId, newDraft(incoming)));
    setSelectedId(labId); setExpanded(null);
  };
  const requestLabChange = (labId: string) => {
    if (labId === selectionRef.current || busy.current || !latest.current.labs.some(lab => lab.id === labId)) return;
    const current = draftsRef.current.get(selectionRef.current);
    if (!current || !isDirty(current)) { selectLab(labId); return; }
    askConfirm({ title: 'الانتقال إلى معمل آخر؟', message: 'لديك تغييرات غير محفوظة. ستبقى مسودة هذا المعمل هنا للعودة إليها، ويجب حفظ كل معمل على حدة.', confirmLabel: 'الانتقال مع الاحتفاظ بالمسودة', cancelLabel: 'متابعة تعديل المعمل', tone: 'warning', onConfirm: () => selectLab(labId) });
  };
  useEffect(() => {
    if (lastRequestedLab.current === initialLabId) return;
    lastRequestedLab.current = initialLabId;
    if (initialLabId) requestLabChange(initialLabId);
  }, [initialLabId]);

  const changeRow = (index: number, field: keyof LabService, value: string) => {
    if (!latest.current.canManageLabPrices || !editable) return;
    setDrafts(previous => {
      const current = previous.get(selectedId);
      if (!current) return previous;
      const rows = current.rows.map((row, position) => position === index ? { ...row, [field]: value } : row);
      const errors = { ...current.errors }; delete errors[`services.${index}.${field}`];
      return new Map(previous).set(selectedId, { ...current, rows, errors, saveError: '' });
    });
  };
  const addService = () => {
    if (!editable || !draft) return;
    let serviceId: string;
    do { serviceId = `lab-service-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`; }
    while (draft.rows.some(row => row.id === serviceId));
    const row: LabPricingDraftRow = { id: serviceId, name: '', category: 'fixed', unitLabel: '', price: '' };
    setDrafts(previous => {
      const current = previous.get(selectedId);
      return current ? new Map(previous).set(selectedId, { ...current, rows: [...current.rows, row], errors: {}, saveError: '' }) : previous;
    });
    setExpanded(serviceId);
    requestAnimationFrame(() => document.getElementById(`${id}-name-${draft.rows.length}`)?.focus());
  };
  const removeService = (index: number) => {
    if (!editable || !draft) return;
    const labId = selectedId;
    const before = JSON.stringify(draft.rows);
    const baseline = snapshotLab(draft.baseline);
    askConfirm({ title: 'إزالة خدمة من هذا المعمل؟', message: 'ستُزال الخدمة من مسودة المعمل فقط، ومن اختيارات الحالات الجديدة بعد الحفظ. الحالات السابقة وإجمالياتها لا تتغير.', confirmLabel: 'إزالة من المسودة', tone: 'warning', onConfirm: () => {
      const current = draftsRef.current.get(labId);
      const incoming = latest.current.labs.find(lab => lab.id === labId);
      if (!active.current || !latest.current.canManageLabPrices || !current || !incoming || JSON.stringify(current.rows) !== before || snapshotLab(incoming) !== baseline) {
        if (active.current) showToast('تغيرت البيانات أو الصلاحية. أعد فتح الإجراء.', 'warning'); return;
      }
      setDrafts(previous => new Map(previous).set(labId, { ...current, rows: current.rows.filter((_, position) => position !== index), errors: {}, saveError: '' }));
      setExpanded(null);
    } });
  };
  const discard = () => {
    const labId = selectedId;
    askConfirm({ title: conflict ? 'تحميل آخر نسخة من المعمل؟' : 'إلغاء تغييرات هذا المعمل؟', message: 'ستُلغى المسودة غير المحفوظة لهذا المعمل وتُحمّل آخر بياناته المحفوظة. مسودات المعامل الأخرى والحالات السابقة لا تتغير.', confirmLabel: conflict ? 'إلغاء المسودة وتحميل آخر نسخة' : 'إلغاء تغييرات هذا المعمل', tone: 'warning', onConfirm: () => {
      if (!active.current || !latest.current.canViewLabCosts) return;
      const incoming = latest.current.labs.find(lab => lab.id === labId);
      setDrafts(previous => { const next = new Map(previous); if (incoming) next.set(labId, newDraft(incoming)); else next.delete(labId); return next; });
      if (!incoming) selectLab(latest.current.labs[0]?.id || '');
      setExpanded(null);
    } });
  };
  const save = (event: React.FormEvent) => {
    event.preventDefault();
    const labId = selectionRef.current;
    const current = draftsRef.current.get(labId);
    if (busy.current || !current || !isDirty(current) || !latest.current.canManageLabPrices || !latest.current.canViewLabCosts) return;
    const incoming = latest.current.labs.find(lab => lab.id === labId);
    if (!incoming || snapshotLab(incoming) !== snapshotLab(current.baseline)) {
      setDrafts(previous => new Map(previous).set(labId, { ...current, saveError: 'تغيرت بيانات المعمل. احتفظنا بالمسودة؛ حمّل آخر نسخة قبل إعادة التعديل.' }));
      return;
    }
    const checked = validateLabPricingDraft(current.rows, current.baseline.services);
    setDrafts(previous => new Map(previous).set(labId, { ...current, errors: checked.errors, saveError: '' }));
    if (!checked.valid) {
      const index = Number(Object.keys(checked.errors)[0]?.split('.')[1]);
      if (Number.isInteger(index) && current.rows[index]) setExpanded(current.rows[index].id);
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      showToast('راجع بيانات خدمات المعمل قبل الحفظ.', 'warning'); return;
    }
    busy.current = true; setSaving(true);
    try {
      latest.current.onSaveLabPricing(labId, checked.services, cloneLab(current.baseline));
      const savedLab = cloneLab(current.baseline); savedLab.services = checked.services;
      setDrafts(previous => new Map(previous).set(labId, newDraft(savedLab)));
      showToast('تم حفظ تكلفة خدمات المعمل المختار.', 'success');
    } catch (error) {
      setDrafts(previous => new Map(previous).set(labId, { ...current, errors: checked.errors, saveError: error instanceof Error ? error.message : 'تعذر الحفظ. المسودة محفوظة هنا؛ حاول مرة أخرى.' }));
    } finally { busy.current = false; setSaving(false); }
  };
  const otherDrafts = Array.from(drafts.entries()).filter(([labId, entry]) => labId !== selectedId && isDirty(entry)).length;
  const shownLab = receivedLab || draft?.baseline;
  return <section className="lp-manager" dir="rtl" aria-label="تكلفة المعامل">
    <header className="lp-header"><span className="lp-heading-icon"><Building2 aria-hidden="true" /></span><div><h2>تكلفة المعامل</h2><p>اختر المعمل، ثم عدّل تكلفة خدماته بشكل مستقل.</p></div><span className="lp-status" data-dirty={dirty}>{dirty ? 'مسودة غير محفوظة' : 'التكلفة المحفوظة'}</span></header>
    <p className="lp-note"><Banknote aria-hidden="true" /><span><strong>تكلفة المعمل عليك، وليست سعر البيع للمريض.</strong> التغيير يُستخدم للحالات الجديدة فقط؛ تكلفة الحالات السابقة وإجمالياتها وأسعار البيع للمريض لا تتغير.</span></p>
    {!labs.length && !draft ? <div className="lp-empty"><Building2 aria-hidden="true" /><h3>لا توجد معامل محفوظة</h3><p>أضف معملًا من صفحة المعامل، ثم ارجع لتحديد تكلفة خدماته.</p></div> : <>
      <div className="lp-lab-picker"><label htmlFor={`${id}-lab`}>المعمل المطلوب تعديل تكلفته</label><select id={`${id}-lab`} value={selectedId} disabled={saving} onChange={event => requestLabChange(event.target.value)}>{!receivedLab && selectedId && <option value={selectedId}>المعمل غير متاح حاليًا</option>}{labs.map(lab => <option key={lab.id} value={lab.id}>{lab.name}</option>)}</select><small>الحفظ يخص المعمل المختار وحده.{otherDrafts > 0 && ` توجد مسودات غير محفوظة لمعامل أخرى: ${otherDrafts}.`}</small></div>
      {!canManageLabPrices && <p className="lp-alert"><LockKeyhole aria-hidden="true" />يمكنك عرض تكلفة خدمات المعامل. التعديل يحتاج صلاحية إدارة الأسعار.</p>}
      {conflict && <div className="lp-alert" role="alert"><AlertCircle aria-hidden="true" /><span>{receivedLab ? 'تغيرت بيانات هذا المعمل أثناء التعديل.' : 'المعمل المختار لم يعد موجودًا في القائمة المحفوظة.'} احتفظنا بالمسودة، والحفظ متوقف لحماية آخر بيانات محفوظة. استخدم «تحميل آخر نسخة» لإلغاء المسودة وإعادة التحميل.</span></div>}
      {draft && <form ref={formRef} onSubmit={save} noValidate className="lp-form">
        <div className="lp-section-heading"><div><h3 dir="auto">خدمات {shownLab?.name}</h3><p>التكلفة لكل وحدة بالجنيه المصري.</p></div>{canManageLabPrices && <button type="button" className="lp-button lp-primary" disabled={!editable} onClick={addService}><Plus aria-hidden="true" />إضافة خدمة للمعمل</button>}</div>
        <div className="lp-list">{draft.rows.map((row, index) => {
          const open = expanded === row.id;
          const error = (field: string) => draft.errors[`services.${index}.${field}`];
          const errorId = (field: string) => `${id}-${field}-error-${index}`;
          return <div key={`${row.id}-${index}`} className="lp-row">
            <div className="lp-row-main"><div className="lp-row-info"><strong dir="auto">{row.name || 'خدمة جديدة'}</strong><small>{categoryLabels[row.category] || 'تصنيف غير محدد'} · {row.unitLabel || 'وحدة غير محددة'}</small></div><div className="lp-cost"><label htmlFor={`${id}-price-${index}`}>تكلفة المعمل لكل وحدة</label><div><input id={`${id}-price-${index}`} aria-label={`تكلفة المعمل لخدمة ${row.name || 'جديدة'}`} type="text" inputMode="decimal" dir="ltr" value={row.price} maxLength={20} readOnly={!editable} aria-invalid={!!error('price')} aria-describedby={error('price') ? errorId('price') : undefined} onChange={event => changeRow(index, 'price', event.target.value)} /><span aria-hidden="true">ج.م</span></div>{error('price') && <p className="lp-error" id={errorId('price')} role="alert">{error('price')}</p>}</div></div>
            {canManageLabPrices && <div className="lp-row-actions"><button type="button" className="lp-button lp-details" disabled={!editable} aria-expanded={open} aria-controls={`${id}-details-${index}`} onClick={() => setExpanded(open ? null : row.id)}><ChevronDown aria-hidden="true" />{open ? 'إغلاق التفاصيل' : 'تعديل تفاصيل الخدمة'}</button><button type="button" className="lp-icon-button lp-danger" disabled={!editable} aria-label={`إزالة خدمة ${row.name || 'جديدة'} من مسودة المعمل`} onClick={() => removeService(index)}><Trash2 aria-hidden="true" /></button></div>}
            {open && canManageLabPrices && <div id={`${id}-details-${index}`} className="lp-details-grid">
              <div className="lp-field lp-name-field"><label htmlFor={`${id}-name-${index}`}>اسم الخدمة</label><input id={`${id}-name-${index}`} dir="auto" value={row.name ?? ''} maxLength={80} disabled={!editable} aria-invalid={!!error('name')} aria-describedby={error('name') ? errorId('name') : undefined} onChange={event => changeRow(index, 'name', event.target.value)} />{error('name') && <p className="lp-error" id={errorId('name')} role="alert">{error('name')}</p>}</div>
              <div className="lp-field"><label htmlFor={`${id}-category-${index}`}>التصنيف</label><select id={`${id}-category-${index}`} value={row.category} disabled={!editable} aria-invalid={!!error('category')} aria-describedby={error('category') ? errorId('category') : undefined} onChange={event => changeRow(index, 'category', event.target.value)}><option value="fixed">تركيبات ثابتة</option><option value="removable">تركيبات متحركة</option><option value="other">أخرى</option></select>{error('category') && <p className="lp-error" id={errorId('category')} role="alert">{error('category')}</p>}</div>
              <div className="lp-field"><label htmlFor={`${id}-unitLabel-${index}`}>اسم الوحدة</label><input id={`${id}-unitLabel-${index}`} dir="auto" value={row.unitLabel ?? ''} maxLength={40} placeholder="مثل: طربوش أو طقم" disabled={!editable} aria-invalid={!!error('unitLabel')} aria-describedby={error('unitLabel') ? errorId('unitLabel') : undefined} onChange={event => changeRow(index, 'unitLabel', event.target.value)} />{error('unitLabel') && <p className="lp-error" id={errorId('unitLabel')} role="alert">{error('unitLabel')}</p>}</div>
            </div>}
            {error('id') && <p className="lp-error" role="alert">{error('id')} احذف هذه الخدمة من المسودة ثم أضفها مجددًا.</p>}
            {!open && ['name', 'category', 'unitLabel'].some(field => error(field)) && <p className="lp-error" role="alert">راجع تفاصيل هذه الخدمة قبل الحفظ.</p>}
          </div>;
        })}</div>
        {!draft.rows.length && <div className="lp-empty"><Banknote aria-hidden="true" /><h3>لا توجد خدمات لهذا المعمل</h3><p>{canManageLabPrices ? 'أضف خدمة وحدد تكلفتها، ثم احفظ المعمل المختار.' : 'لم تُحفظ خدمات لهذا المعمل بعد.'}</p></div>}
        {draft.errors.services && <p className="lp-error" role="alert">{draft.errors.services}</p>}
        {draft.saveError && <p className="lp-alert" role="alert"><AlertCircle aria-hidden="true" />{draft.saveError}</p>}
        {(canManageLabPrices || conflict) && <footer className="lp-save-bar"><div><strong>{dirty ? 'تغييرات هذا المعمل لم تُحفظ بعد' : 'تكلفة هذا المعمل محفوظة'}</strong><small>يحفظ هذا الزر خدمات المعمل المختار وتكلفتها فقط.</small></div><div className="lp-actions"><button type="button" className="lp-button" disabled={(!dirty && !conflict) || saving} onClick={discard}><Undo2 aria-hidden="true" />{conflict ? 'تحميل آخر نسخة' : 'إلغاء التغييرات'}</button>{canManageLabPrices && <button type="submit" className="lp-button lp-primary" disabled={!dirty || conflict || saving}><Save aria-hidden="true" />{saving ? 'جارٍ الحفظ…' : 'حفظ أسعار المعمل المختار'}</button>}</div></footer>}
      </form>}
    </>}
  </section>;
}
