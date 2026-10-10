import React, { useId } from 'react';
import { Check, Eye, SlidersHorizontal } from 'lucide-react';
import type { DockAppearance } from '../../types';

const sizes: { value: DockAppearance['size']; title: string; description: string }[] = [
  { value: 'compact', title: 'مدمج', description: 'مساحة أقل مع أزرار واضحة' },
  { value: 'comfortable', title: 'متوازن', description: 'الحجم الحالي المناسب للاستخدام اليومي' },
  { value: 'large', title: 'كبير', description: 'أيقونات أكبر وأسهل في اللمس' },
];

export function DockAppearanceControls({ value, onChange, mode = 'mobile', disabled = false }: { value: DockAppearance; onChange: (next: DockAppearance) => void; mode?: 'mobile' | 'desktop'; disabled?: boolean }) {
  const id = useId();
  return <div className="cl-section-card cl-dock-settings">
    <div className="cl-section-title"><SlidersHorizontal aria-hidden="true" /><div><h3>حجم شريط {mode === 'mobile' ? 'الموبايل' : 'الكمبيوتر'} وطريقة عرضه</h3><p>هذه الاختيارات تخص {mode === 'mobile' ? 'الموبايل فقط ولا تغيّر شريط الكمبيوتر' : 'الكمبيوتر فقط ولا تغيّر شريط الموبايل'}. جرّب المعاينة ثم احفظ.</p></div></div>
    <fieldset className="cl-choice-field" disabled={disabled}><legend>حجم الشريط والأيقونات</legend><div className="cl-size-choices">{sizes.map(size => <button key={size.value} type="button" aria-pressed={value.size === size.value} onClick={() => onChange({ ...value, size: size.value })}>
      <span className="cl-size-illustration" data-size={size.value} aria-hidden="true"><i /><i /><i /></span><strong>{size.title}</strong><small>{size.description}</small>{value.size === size.value && <Check className="cl-choice-check" aria-hidden="true" />}
    </button>)}</div></fieldset>
    <div className="cl-dock-details" data-device={mode}><label className="cl-label-toggle" htmlFor={`${id}-labels`}><span className="cl-label-toggle-icon"><Eye aria-hidden="true" /></span><span><strong>إظهار أسماء الأقسام</strong><small>{mode === 'mobile' ? 'إلغاء الاختيار يعرض الأيقونات فقط. تظل الأسماء داخل «المزيد».' : 'اختر الأيقونة مع الاسم أو الأيقونة فقط. اسم كل قسم يظل متاحًا لقارئ الشاشة وعند الإشارة إليه.'}</small></span><input id={`${id}-labels`} type="checkbox" disabled={disabled} checked={value.showLabels} onChange={event => onChange({ ...value, showLabels: event.target.checked })} /></label>
      {mode === 'mobile' && <fieldset className="cl-choice-field" disabled={disabled}><legend>الاختيارات المباشرة على الموبايل</legend><div className="cl-count-choices">{([3, 4] as const).map(count => <button key={count} type="button" aria-pressed={value.mobileVisibleCount === count} onClick={() => onChange({ ...value, mobileVisibleCount: count })}>{count === 3 ? '٣ أقسام + المزيد' : '٤ أقسام + المزيد'}</button>)}</div><p className="cl-hint">العدد يشمل الرئيسية بعد الصلاحيات. «داخل المزيد» للموبايل فقط؛ الكمبيوتر يعرض كل أقسامه مباشرة.</p></fieldset>}
    </div>
    <div className="cl-note"><SlidersHorizontal aria-hidden="true" /><p>الأحجام محددة للحفاظ على وضوح النص وأزرار اللمس. ترتيب كل جهاز من تبويب «ترتيب الشريط»، وأسماء الأقسام مشتركة. الإعداد يُحفظ لهذا المتصفح، ولا يغيّر صلاحيات الحسابات.</p></div>
  </div>;
}
