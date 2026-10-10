import React, { useId, useMemo, useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, Plus, Search, X } from 'lucide-react';
import { normalizeServiceName, parseCatalogPrice } from '../../utils/serviceCatalog';

export interface WalkInServiceOption { name: string; price?: number }
export interface WalkInServicePickerProps {
  options: readonly WalkInServiceOption[];
  disabled?: boolean;
  onAdd: (name: string, price?: number) => void;
  onAddCustom: () => void;
}
const amount = (value: number) => `${new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 }).format(value)} ج.م`;

/** A deliberate service click appends one draft row immediately. This component
 * never saves a visit, creates a receipt or substitutes zero for a missing price. */
export function WalkInServicePicker({ options, disabled = false, onAdd, onAddCustom }: WalkInServicePickerProps) {
  const id = `walkin-services-${useId().replace(/[^\w-]/g, '')}`;
  const trigger = useRef<HTMLButtonElement>(null);
  const latest = useRef({ options, disabled, onAdd, onAddCustom });
  latest.current = { options, disabled, onAdd, onAddCustom };
  const sequence = useRef(0);
  const pendingSelection = useRef<number | null>(null);
  const [openToken, setOpenToken] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(20);
  const [error, setError] = useState('');
  const [lastAdded, setLastAdded] = useState('');
  const preparedQuery = normalizeServiceName(query);
  const matches = useMemo(() => options.filter(option => normalizeServiceName(option.name).includes(preparedQuery)
    || typeof option.price === 'number' && parseCatalogPrice(option.price).valid && (String(option.price).includes(preparedQuery)
      || normalizeServiceName(amount(option.price)).includes(preparedQuery))), [options, preparedQuery]);
  const open = openToken !== null;
  const close = () => { if (latest.current.disabled) return; pendingSelection.current = null; setError(''); setOpenToken(null); };
  const select = (option: WalkInServiceOption, token: number | null) => {
    if (latest.current.disabled || token === null || pendingSelection.current !== token) return;
    // Resolve the selected name against the latest catalog so a retained click
    // cannot append a removed service or its stale suggested price.
    const current = latest.current.options.find(item => item.name === option.name);
    if (!current) { setError('الخدمة لم تعد في الفهرس الحالي. اختر خدمة أخرى.'); return; }
    const parsed = typeof current.price === 'number' ? parseCatalogPrice(current.price) : undefined;
    const price = parsed?.valid ? parsed.value : undefined;
    // Consume this opening synchronously. The same retained handler cannot add
    // twice, even after another opening intentionally allows a new selection.
    pendingSelection.current = null;
    try { latest.current.onAdd(current.name, price); }
    catch { pendingSelection.current = token; setError('تعذّرت إضافة الخدمة للزيارة. اضغط على الخدمة للمحاولة مجددًا.'); return; }
    setLastAdded(`أُضيفت ${current.name} للزيارة${price === undefined ? '؛ اكتب سعرها قبل الحفظ' : ` — ${amount(price)}`}. يمكنك تعديل السعر أو حذف الخدمة. لم تُحفظ الزيارة بعد.`);
    setQuery(''); setVisibleCount(20); setError(''); setOpenToken(null);
  };

  return <div className="walkin-explicit-picker">
    <div className="walkin-picker-actions">
      <button ref={trigger} type="button" className="walkin-picker-trigger" disabled={disabled || !options.length} aria-expanded={open} aria-controls={`${id}-panel`}
        onClick={() => { if (latest.current.disabled || !latest.current.options.length) return; if (open) close(); else { const token = ++sequence.current; pendingSelection.current = token; setOpenToken(token); setVisibleCount(20); setError(''); } }}><Plus aria-hidden="true" /><span>اختيار خدمة من الفهرس</span><ChevronDown aria-hidden="true" /></button>
      <button type="button" className="clinic-action-cancel" disabled={disabled} onClick={() => { if (latest.current.disabled) return; try { latest.current.onAddCustom(); } catch { setError('تعذّرت إضافة سطر خدمة أخرى. حاول مجددًا.'); return; } close(); setLastAdded('سطر خدمة أخرى جاهز للتعديل في المسودة؛ اكتب الاسم والسعر قبل حفظ الزيارة.'); }}><Plus aria-hidden="true" />خدمة أخرى</button>
    </div>
    {open && <section id={`${id}-panel`} className="walkin-picker-panel" aria-labelledby={`${id}-title`} onKeyDown={event => {
      if (event.key === 'Enter' && (event.target as HTMLElement).tagName === 'INPUT') {
        event.preventDefault(); event.stopPropagation(); return;
      }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); trigger.current?.focus(); }
    }}>
      <div className="walkin-picker-heading"><div><h5 id={`${id}-title`}>اضغط على الخدمة لإضافتها للزيارة</h5><p>تُضاف بالسعر المحدد في الفهرس، ويمكنك تعديله أو حذف الخدمة قبل الحفظ.</p></div><button type="button" aria-label="إغلاق اختيار الخدمات" disabled={disabled} onClick={close}><X aria-hidden="true" /></button></div>
      <label className="walkin-picker-search"><Search aria-hidden="true" /><input type="search" aria-label="بحث خدمات الزيارة" value={query} maxLength={200} autoComplete="off" placeholder="ابحث باسم الخدمة…"
        onChange={event => { setQuery(event.target.value); setVisibleCount(20); }} /></label>
      <div className="walkin-picker-results" role="group" aria-label="نتائج اختيار خدمات الزيارة">{matches.slice(0, visibleCount).map(option => <button type="button" key={option.name} disabled={disabled}
        aria-label={`اختيار خدمة ${option.name}`} onClick={() => select(option, openToken)}><span>{option.name}</span><small>{typeof option.price === 'number' && parseCatalogPrice(option.price).valid ? amount(option.price) : 'أضف السعر بعد الاختيار'}</small><Plus aria-hidden="true" /></button>)}</div>
      {!matches.length && <p className="walkin-picker-empty" role="status">لا توجد خدمة مطابقة. غيّر البحث أو استخدم «خدمة أخرى».</p>}
      {matches.length > visibleCount && <button type="button" className="walkin-picker-more" disabled={disabled} onClick={() => setVisibleCount(count => count + 20)}>عرض خدمات أخرى ({matches.length - visibleCount})</button>}
    </section>}
    {error && <p className="walkin-picker-error" role="alert">{error}</p>}
    {lastAdded && <p className="walkin-picker-added" role="status"><CheckCircle2 aria-hidden="true" /><span>{lastAdded}</span></p>}
  </div>;
}
