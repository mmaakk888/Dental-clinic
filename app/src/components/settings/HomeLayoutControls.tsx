import React, { useId } from 'react';
import { ArrowDown, ArrowUp, Calendar, Clock, Eye, LockKeyhole, Search, SlidersHorizontal } from 'lucide-react';
import type { HomeLayoutSettings, HomeSectionKey } from '../../types';
import { HOME_SECTIONS, moveHomeSection } from '../../utils/homeLayout';

export function HomeLayoutControls({ value, onChange, disabled = false }: {
  value: HomeLayoutSettings; onChange: (next: HomeLayoutSettings) => void; disabled?: boolean;
}) {
  const id = useId();
  const toggle = (key: HomeSectionKey) => onChange({ ...value,
    hiddenSections: value.hiddenSections.includes(key) ? value.hiddenSections.filter(item => item !== key) : [...value.hiddenSections, key] });
  return <div className="cl-home-controls">
    <div className="cl-home-fixed"><span><Clock aria-hidden="true" /> تاريخ اليوم والساعة</span><span><Search aria-hidden="true" /> البحث في المرضى</span><small><LockKeyhole aria-hidden="true" /> ثابتان في البداية؛ البحث للمصرّح له فقط.</small></div>
    <fieldset className="cl-choice-field" disabled={disabled}><legend>الأقسام الظاهرة وترتيبها</legend>
      <p className="cl-home-intro">فعّل ما تحتاجه، ثم استخدم الأسهم لترتيبه تحت البحث. إخفاء قسم لا يحذفه من شريط التنقل.</p>
      <div className="cl-home-section-list">{value.sectionOrder.map((key, index) => {
        const section = HOME_SECTIONS.find(item => item.key === key)!;
        const visible = !value.hiddenSections.includes(key);
        return <div key={key} className="cl-home-section-row" data-visible={visible}>
          <label htmlFor={`${id}-${key}`}><input id={`${id}-${key}`} type="checkbox" checked={visible} onChange={() => toggle(key)} />
            <span><strong>{section.label}</strong><small>{section.description}</small></span>
          </label>
          <div className="cl-move-buttons"><button type="button" aria-label={`تقديم ${section.label} في الرئيسية`} disabled={index === 0} onClick={() => onChange(moveHomeSection(value, key, 'up'))}><ArrowUp aria-hidden="true" /></button><button type="button" aria-label={`تأخير ${section.label} في الرئيسية`} disabled={index === value.sectionOrder.length - 1} onClick={() => onChange(moveHomeSection(value, key, 'down'))}><ArrowDown aria-hidden="true" /></button></div>
        </div>;
      })}</div>
    </fieldset>
    {value.hiddenSections.length === HOME_SECTIONS.length && <p className="cl-home-minimal" role="status"><Eye aria-hidden="true" /> ستظهر الساعة والتاريخ والبحث فقط. يمكنك الوصول لباقي الوظائف من الشريط العائم.</p>}
    <div className="cl-home-options">
      <fieldset className="cl-choice-field" disabled={disabled}><legend><SlidersHorizontal aria-hidden="true" /> المسافات بين العناصر</legend><div className="cl-count-choices">
        <button type="button" aria-pressed={value.density === 'comfortable'} onClick={() => onChange({ ...value, density: 'comfortable' })}>مريحة</button>
        <button type="button" aria-pressed={value.density === 'compact'} onClick={() => onChange({ ...value, density: 'compact' })}>مدمجة</button>
      </div><p className="cl-hint">المدمج يقلل الفراغات مع الحفاظ على وضوح الخط وسهولة اللمس.</p></fieldset>
      <fieldset className="cl-choice-field" disabled={disabled}><legend><Calendar aria-hidden="true" /> مواعيد ظاهرة في الرئيسية</legend><div className="cl-home-limit-choices">{([3, 6, 10] as const).map(count => <button key={count} type="button" aria-pressed={value.appointmentLimit === count} onClick={() => onChange({ ...value, appointmentLimit: count })}>{count.toLocaleString('ar-EG')} مواعيد</button>)}</div><p className="cl-hint">باقي المواعيد تظل في الجدول الكامل، ولا تتغير الأعداد الإجمالية.</p></fieldset>
    </div>
    <div className="cl-note"><LockKeyhole aria-hidden="true" /><p>هذه إعدادات عرض لكل الحسابات على هذا المتصفح؛ لا تمنح السكرتيرة صلاحيات أو تكشف مبالغ مخفية بوضع الخصوصية.</p></div>
  </div>;
}
