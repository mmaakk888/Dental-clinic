import React, { useEffect, useId, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, GitBranch, LockKeyhole, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import type { Lab } from '../../types';
import { cloneProstheticRouting, validateProstheticRouting } from '../../utils/prostheticRouting';
import type { ProstheticRoutingSettings } from '../../utils/prostheticRouting';
import './prostheticRouting.css';

interface ProstheticRoutingManagementProps {
  value: ProstheticRoutingSettings;
  labs: Lab[];
  materials: string[];
  onSave: (value: ProstheticRoutingSettings, baseline: ProstheticRoutingSettings) => void | Promise<void>;
}

type Kind = 'fixed' | 'removable';
const kinds: Array<{ key: Kind; label: string }> = [
  { key: 'fixed', label: 'تركيبات ثابتة' },
  { key: 'removable', label: 'تركيبات متحركة' },
];
const equal = (a: ProstheticRoutingSettings, b: ProstheticRoutingSettings) => JSON.stringify(a) === JSON.stringify(b);
// New rows are intentionally incomplete until all four choices are made.
// The persisted-value cloner validates, so it must not be used for form drafts.
const copyDraft = (current: ProstheticRoutingSettings): ProstheticRoutingSettings => ({
  defaultLabs: { ...current.defaultLabs }, overrides: current.overrides.map(entry => ({ ...entry })),
});
const money = (amount: number) => new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 }).format(amount);

/** Private administration only. The parent must enforce owner/financial access. */
export function ProstheticRoutingManagement({ value, labs, materials, onSave }: ProstheticRoutingManagementProps) {
  const prefix = `prosthetic-routing-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [draft, setDraft] = useState(() => cloneProstheticRouting(value));
  const [saved, setSaved] = useState(() => cloneProstheticRouting(value));
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const busy = useRef(false);
  const received = useRef(cloneProstheticRouting(value));
  const draftRef = useRef(draft);
  const savedRef = useRef(saved);
  draftRef.current = draft;
  savedRef.current = saved;
  const dirty = !equal(draft, saved);

  useEffect(() => {
    const incoming = cloneProstheticRouting(value);
    if (equal(incoming, received.current)) return;
    received.current = incoming;
    const clashes = !equal(draftRef.current, savedRef.current) && !equal(draftRef.current, incoming);
    setSaved(cloneProstheticRouting(incoming));
    setConflict(clashes);
    setNotice('');
    if (!clashes) { setDraft(cloneProstheticRouting(incoming)); setError(''); }
  }, [value]);

  const edit = (update: (current: ProstheticRoutingSettings) => ProstheticRoutingSettings) => {
    if (busy.current || conflict) return;
    setDraft(current => update(copyDraft(current)));
    setError(''); setNotice('');
  };
  const setDefault = (kind: Kind, labId: string) => edit(current => {
    if (labId) current.defaultLabs[kind] = labId;
    else delete current.defaultLabs[kind];
    return current;
  });
  const setOverride = (index: number, field: 'kind' | 'material' | 'labId' | 'labServiceId', next: string) => edit(current => {
    const entry = current.overrides[index];
    if (!entry) return current;
    if (field === 'kind') entry.kind = next as Kind;
    else entry[field] = next;
    if (field === 'kind' || field === 'labId') entry.labServiceId = '';
    return current;
  });
  const reload = () => {
    if (busy.current) return;
    setDraft(cloneProstheticRouting(savedRef.current));
    setConflict(false); setError(''); setNotice('تم تحميل الإعدادات المحفوظة.');
  };
  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy.current || conflict || !dirty) return;
    let next: ProstheticRoutingSettings;
    try { next = validateProstheticRouting(copyDraft(draftRef.current), labs, materials); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'راجع بيانات الربط قبل الحفظ.'); return; }
    const baseline = cloneProstheticRouting(savedRef.current);
    busy.current = true; setSaving(true); setError(''); setNotice('');
    try {
      await onSave(cloneProstheticRouting(next), cloneProstheticRouting(baseline));
      if (!equal(received.current, baseline) && !equal(received.current, next)) {
        setConflict(true);
        setError('وصلت إعدادات أحدث أثناء الحفظ. راجع النسخة المحفوظة قبل المتابعة.');
        return;
      }
      setDraft(cloneProstheticRouting(next)); setSaved(cloneProstheticRouting(next));
      setConflict(false); setNotice('تم حفظ ربط التركيبات بالمعامل.');
    } catch {
      setError('تعذر تأكيد الحفظ. المسودة موجودة كما هي؛ حاول مرة أخرى بعد مراجعة الاتصال والتخزين.');
    } finally { busy.current = false; setSaving(false); }
  };

  return <form className="prosthetic-routing" onSubmit={save} aria-labelledby={`${prefix}-title`} aria-busy={saving}>
    <header className="pr-heading">
      <span className="pr-heading-icon"><GitBranch aria-hidden="true" /></span>
      <div><h3 id={`${prefix}-title`}>ربط التركيبات بالمعامل</h3><p>حدد المعمل المعتاد لكل نوع، أو اربط خامة بخدمة معينة داخل معمل.</p></div>
      <span className="pr-private"><LockKeyhole aria-hidden="true" />إدارة خاصة</span>
    </header>

    <div className="pr-rule"><AlertCircle aria-hidden="true" /><p>هذه الإعدادات تخص التسجيل الجديد فقط؛ لا تغيّر المعمل أو تكلفة أي حالة قديمة. أسعار بيع المريض مستقلة عن تكلفة المعمل.</p></div>
    {conflict && <div className="pr-message pr-warning" role="alert"><p>الإعدادات اتغيّرت في مكان آخر. مسودتك محفوظة هنا، والحفظ متوقف لمنع استبدال النسخة الأحدث.</p><button type="button" onClick={reload} disabled={saving}><RotateCcw aria-hidden="true" />تحميل النسخة المحفوظة</button></div>}
    {error && <p className="pr-message pr-error" role="alert">{error}</p>}
    {notice && <p className="pr-message pr-success" role="status"><CheckCircle2 aria-hidden="true" />{notice}</p>}

    <fieldset className="pr-section" disabled={saving || conflict}>
      <legend>١. المعامل الافتراضية</legend>
      <p className="pr-hint">يمكن اختيار معمل مختلف للثابت والمتحرك. ترك الاختيار فارغًا يوقف الربط التلقائي لهذا النوع، إلا إذا أضفت له ربطًا خاصًا.</p>
      <div className="pr-defaults">{kinds.map(kind => <div className="pr-field" key={kind.key}>
        <label htmlFor={`${prefix}-default-${kind.key}`}>{kind.label}</label>
        <select id={`${prefix}-default-${kind.key}`} value={draft.defaultLabs[kind.key] || ''} onChange={event => setDefault(kind.key, event.target.value)}>
          <option value="">بدون معمل افتراضي</option>
          {draft.defaultLabs[kind.key] && !labs.some(lab => lab.id === draft.defaultLabs[kind.key]) && <option value={draft.defaultLabs[kind.key]}>المعمل المحفوظ لم يعد متاحًا</option>}
          {labs.map(lab => <option key={lab.id} value={lab.id}>{lab.name}</option>)}
        </select>
      </div>)}</div>
      {!labs.length && <p className="pr-empty">لا توجد معامل بعد. أضف المعمل وخدماته أولًا من قسم المعامل وأسعاره.</p>}
      <p className="pr-hint pr-matching">بدون ربط خاص، تُبحث خدمة بنفس اسم الخامة داخل تصنيفها في المعمل المحدد. إذا لم توجد مطابقة واضحة واحدة، يتوقف اعتماد التكلفة حتى تختار الخدمة؛ لن تُفترض تكلفة صفرية.</p>
    </fieldset>

    <fieldset className="pr-section" disabled={saving || conflict}>
      <legend>٢. ربط خاص للخامات <span>اختياري</span></legend>
      <p className="pr-hint">مفيد إذا اختلف اسم الخامة عند المعمل. الربط الخاص يسبق المعمل الافتراضي، ويختار خدمة محددة بالاسم والتصنيف.</p>
      {!draft.overrides.length && <p className="pr-empty">لا يوجد ربط خاص. سيُستخدم المعمل الافتراضي عند اختياره؛ وإلا تحتاج إلى استكمال إعداد الربط قبل تسجيل التركيبة.</p>}
      <div className="pr-overrides">{draft.overrides.map((entry, index) => {
        const lab = labs.find(item => item.id === entry.labId);
        const services = lab?.services.filter(item => item.category === entry.kind) || [];
        const selectedService = services.find(item => item.id === entry.labServiceId);
        return <article className="pr-override" key={index} aria-labelledby={`${prefix}-override-${index}`}>
          <div className="pr-override-heading"><h4 id={`${prefix}-override-${index}`}>ربط خامة <bdi>{(index + 1).toLocaleString('ar-EG')}</bdi></h4><button type="button" className="pr-remove" aria-label={`إزالة الربط ${index + 1}`} onClick={() => edit(current => { current.overrides.splice(index, 1); return current; })}><Trash2 aria-hidden="true" />إزالة</button></div>
          <div className="pr-override-fields">
            <div className="pr-field"><label htmlFor={`${prefix}-${index}-kind`}>نوع التركيبة</label><select id={`${prefix}-${index}-kind`} value={entry.kind} onChange={event => setOverride(index, 'kind', event.target.value)}>{kinds.map(kind => <option key={kind.key} value={kind.key}>{kind.label}</option>)}</select></div>
            <div className="pr-field"><label htmlFor={`${prefix}-${index}-material`}>الخامة عند العيادة</label><select id={`${prefix}-${index}-material`} value={entry.material} onChange={event => setOverride(index, 'material', event.target.value)}><option value="">اختر الخامة</option>{entry.material && !materials.includes(entry.material) && <option value={entry.material}>{entry.material} (غير متاحة)</option>}{materials.map(material => <option key={material} value={material}>{material}</option>)}</select></div>
            <div className="pr-field"><label htmlFor={`${prefix}-${index}-lab`}>المعمل</label><select id={`${prefix}-${index}-lab`} value={entry.labId} onChange={event => setOverride(index, 'labId', event.target.value)}><option value="">اختر المعمل</option>{entry.labId && !lab && <option value={entry.labId}>المعمل المحفوظ لم يعد متاحًا</option>}{labs.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
            <div className="pr-field"><label htmlFor={`${prefix}-${index}-service`}>الخدمة داخل المعمل</label><select id={`${prefix}-${index}-service`} value={entry.labServiceId} disabled={!lab || !services.length} onChange={event => setOverride(index, 'labServiceId', event.target.value)}><option value="">{!lab ? 'اختر المعمل أولًا' : !services.length ? 'لا توجد خدمات لهذا النوع' : 'اختر الخدمة المطابقة'}</option>{entry.labServiceId && !selectedService && <option value={entry.labServiceId}>الخدمة المحفوظة لم تعد متاحة لهذا النوع</option>}{services.map(service => <option key={service.id} value={service.id}>{service.name} — {service.unitLabel}</option>)}</select></div>
          </div>
          {selectedService && Number.isFinite(selectedService.price) && selectedService.price >= 0 && <p className="pr-cost">تكلفة الوحدة الحالية عند المعمل: <strong><bdi>{money(selectedService.price)}</bdi> ج.م</strong><span>تُثبت للحالة عند تسجيلها، ولا تعيد تسعير الحالات السابقة.</span></p>}
          {lab && !services.length && <p className="pr-inline-warning">أضف خدمة من نوع {entry.kind === 'fixed' ? 'التركيبات الثابتة' : 'التركيبات المتحركة'} إلى هذا المعمل من قسم أسعاره.</p>}
        </article>;
      })}</div>
      <button type="button" className="pr-add" disabled={!labs.length || !materials.length || draft.overrides.length >= 300} onClick={() => edit(current => { if (current.overrides.length < 300) current.overrides.push({ kind: 'fixed', material: '', labId: '', labServiceId: '' }); return current; })}><Plus aria-hidden="true" />إضافة ربط خاص</button>
      {!materials.length && <p className="pr-hint">أضف خامات التركيبات في فهرس أسعار بيع المريض لإتاحة الربط الخاص.</p>}
    </fieldset>

    <footer className="pr-save-bar"><p aria-live="polite">{saving ? 'جارٍ تأكيد الحفظ…' : conflict ? 'راجع التعارض قبل الحفظ' : dirty ? 'تغييرات في المسودة لم تُحفظ بعد' : 'الإعدادات مطابقة للنسخة المحفوظة'}</p><div><button type="button" className="pr-reset" onClick={reload} disabled={saving || !dirty}><RotateCcw aria-hidden="true" />تراجع</button><button type="submit" className="pr-save" disabled={saving || conflict || !dirty}><Save aria-hidden="true" />{saving ? 'جارٍ الحفظ…' : 'حفظ الربط'}</button></div></footer>
  </form>;
}
