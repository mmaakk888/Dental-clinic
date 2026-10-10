import React, { useId, useMemo, useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, Plus, Search, X } from 'lucide-react';
import { normalizeServiceName, parseCatalogPrice } from '../../utils/serviceCatalog';

export interface WalkInServiceOption { name: string; price?: number }
export interface WalkInServicePickerProps {
  options: readonly WalkInServiceOption[];
  disabled?: boolean;
  onAdd: (name: string, price: number) => void;
  onAddCustom: () => void;
}
const amount = (value: number) => `${new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 }).format(value)} ج.م`;

/** A selection is only a candidate. Nothing enters the visit draft until the
 * separate add button is confirmed; this component never saves clinic data. */
export function WalkInServicePicker({ options, disabled = false, onAdd, onAddCustom }: WalkInServicePickerProps) {
  const id = `walkin-services-${useId().replace(/[^\w-]/g, '')}`;
  const trigger = useRef<HTMLButtonElement>(null);
  const latest = useRef({ options, disabled, onAdd, onAddCustom });
  latest.current = { options, disabled, onAdd, onAddCustom };
  const sequence = useRef(0);
  const pendingSelection = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(20);
  const [candidate, setCandidate] = useState<{ name: string; price: string; token: number; configured: boolean } | null>(null);
  const [error, setError] = useState('');
  const [lastAdded, setLastAdded] = useState('');
  const preparedQuery = normalizeServiceName(query);
  const matches = useMemo(() => options.filter(option => normalizeServiceName(option.name).includes(preparedQuery)
    || typeof option.price === 'number' && parseCatalogPrice(option.price).valid && (String(option.price).includes(preparedQuery)
      || normalizeServiceName(amount(option.price)).includes(preparedQuery))), [options, preparedQuery]);
  const parsedPrice = candidate ? parseCatalogPrice(candidate.price) : undefined;
  const close = () => { if (latest.current.disabled) return; pendingSelection.current = null; setCandidate(null); setError(''); setOpen(false); };
  const select = (option: WalkInServiceOption) => {
    if (latest.current.disabled || !latest.current.options.some(item => item.name === option.name)) return;
    const token = ++sequence.current;
    pendingSelection.current = token;
    const configured = typeof option.price === 'number' && parseCatalogPrice(option.price).valid;
    setCandidate({ name: option.name, price: configured ? String(option.price) : '', token, configured });
    setError(''); setLastAdded('');
  };
  const add = () => {
    if (latest.current.disabled || !candidate || pendingSelection.current !== candidate.token) return;
    if (!latest.current.options.some(option => option.name === candidate.name)) { setError('الخدمة لم تعد في الفهرس الحالي. اختر خدمة أخرى.'); return; }
    const parsed = parseCatalogPrice(candidate.price);
    if (!parsed.valid || parsed.value === undefined) { setError('اكتب سعرًا صحيحًا لهذه الزيارة؛ الصفر مقبول إذا كان مقصودًا.'); return; }
    // Consume synchronously, before the parent callback/React render. A stale
    // double click cannot append this same selection a second time.
    pendingSelection.current = null;
    try { latest.current.onAdd(candidate.name, parsed.value); }
    catch { pendingSelection.current = candidate.token; setError('تعذّرت إضافة الخدمة للمسودة. راجع الاختيار وحاول مرة أخرى.'); return; }
    setLastAdded(`أُضيفت للمسودة: ${candidate.name} — ${amount(parsed.value)}. لم تُحفظ الزيارة بعد.`);
    setCandidate(null); setQuery(''); setVisibleCount(20); setError(''); setOpen(false);
  };

  return <div className="walkin-explicit-picker">
    <div className="walkin-picker-actions">
      <button ref={trigger} type="button" className="walkin-picker-trigger" disabled={disabled || !options.length} aria-expanded={open} aria-controls={`${id}-panel`}
        onClick={() => { if (latest.current.disabled) return; if (open) close(); else { setOpen(true); setVisibleCount(20); } }}><Plus aria-hidden="true" /><span>اختيار خدمة من الفهرس</span><ChevronDown aria-hidden="true" /></button>
      <button type="button" className="clinic-action-cancel" disabled={disabled} onClick={() => { if (latest.current.disabled) return; close(); latest.current.onAddCustom(); setLastAdded('سطر خدمة أخرى جاهز للتعديل في المسودة؛ اكتب الاسم والسعر قبل حفظ الزيارة.'); }}><Plus aria-hidden="true" />خدمة أخرى</button>
    </div>
    {open && <section id={`${id}-panel`} className="walkin-picker-panel" aria-labelledby={`${id}-title`} onKeyDown={event => {
      if (event.key === 'Enter' && (event.target as HTMLElement).tagName === 'INPUT') {
        event.preventDefault(); event.stopPropagation(); return;
      }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); trigger.current?.focus(); }
    }}>
      <div className="walkin-picker-heading"><div><h5 id={`${id}-title`}>اختر الخدمة ثم راجعها قبل الإضافة</h5><p>الاختيار وحده لا يضيف خدمة أو يسجّل حسابًا.</p></div><button type="button" aria-label="إغلاق اختيار الخدمات" disabled={disabled} onClick={close}><X aria-hidden="true" /></button></div>
      <label className="walkin-picker-search"><Search aria-hidden="true" /><input type="search" aria-label="بحث خدمات الزيارة" value={query} maxLength={200} autoComplete="off" placeholder="ابحث باسم الخدمة…"
        onChange={event => { setQuery(event.target.value); setVisibleCount(20); }} /></label>
      <div className="walkin-picker-results" role="group" aria-label="نتائج اختيار خدمات الزيارة">{matches.slice(0, visibleCount).map(option => <button type="button" key={option.name} disabled={disabled} aria-pressed={candidate?.name === option.name}
        aria-label={`اختيار خدمة ${option.name}`} onClick={() => select(option)}><span>{option.name}</span><small>{typeof option.price === 'number' && parseCatalogPrice(option.price).valid ? amount(option.price) : 'السعر غير محدد'}</small><CheckCircle2 aria-hidden="true" /></button>)}</div>
      {!matches.length && <p className="walkin-picker-empty" role="status">لا توجد خدمة مطابقة. غيّر البحث أو استخدم «خدمة أخرى».</p>}
      {matches.length > visibleCount && <button type="button" className="walkin-picker-more" disabled={disabled} onClick={() => setVisibleCount(count => count + 20)}>عرض خدمات أخرى ({matches.length - visibleCount})</button>}
      {candidate && <div className="walkin-picker-candidate" aria-label="الخدمة المختارة قبل الإضافة">
        <div><small>الخدمة المختارة</small><strong dir="auto">{candidate.name}</strong><button type="button" disabled={disabled} aria-label="إلغاء اختيار الخدمة" onClick={() => { pendingSelection.current = null; setCandidate(null); setError(''); }}><X aria-hidden="true" /></button></div>
        <label>السعر لهذه الزيارة (ج.م)<input aria-label="سعر الخدمة المختارة" type="number" min="0" step="0.01" inputMode="decimal" value={candidate.price} placeholder="اكتب السعر" required
          onChange={event => { setCandidate(previous => previous ? { ...previous, price: event.target.value } : previous); setError(''); }} /></label>
        <p>{candidate.configured ? 'السعر مقترح من الفهرس؛ يمكنك تعديله لهذه الزيارة.' : 'لا يوجد سعر صالح مسجّل؛ اكتب السعر المقصود قبل الإضافة.'}</p>
        <button type="button" className="walkin-picker-confirm" disabled={disabled || !parsedPrice?.valid} onClick={add}><CheckCircle2 aria-hidden="true" />إضافة الخدمة للمسودة</button>
      </div>}
      {error && <p className="walkin-picker-error" role="alert">{error}</p>}
    </section>}
    {lastAdded && <p className="walkin-picker-added" role="status"><CheckCircle2 aria-hidden="true" /><span>{lastAdded}</span></p>}
  </div>;
}
