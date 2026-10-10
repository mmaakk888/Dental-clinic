import React, { useId } from 'react';
import { Check, Eye, SlidersHorizontal } from 'lucide-react';
import type { DockAppearance } from '../../types';

const sizes: { value: DockAppearance['size']; title: string; description: string }[] = [
  { value: 'compact', title: 'مدمج', description: 'مساحة أقل مع أزرار واضحة' },
  { value: 'comfortable', title: 'متوازن', description: 'الحجم الحالي المناسب للاستخدام اليومي' },
  { value: 'large', title: 'كبير', description: 'أيقونات أكبر وأسهل في اللمس' },
];

export function DockAppearanceControls({ value, onChange }: { value: DockAppearance; onChange: (next: DockAppearance) => void }) {
  const id = useId();
  return <div className="cl-section-card cl-dock-settings">
    <div className="cl-section-title"><SlidersHorizontal aria-hidden="true" /><div><h3>حجم الشريط وطريقة عرضه</h3><p>يتكيّف الحجم تلقائيًا مع الموبايل والكمبيوتر. جرّب المعاينة ثم احفظ لتطبيق اختيارك.</p></div></div>
    <fieldset className="cl-choice-field"><legend>حجم الشريط والأيقونات</legend><div className="cl-size-choices">{sizes.map(size => <button key={size.value} type="button" aria-pressed={value.size === size.value} onClick={() => onChange({ ...value, size: size.value })}>
      <span className="cl-size-illustration" data-size={size.value} aria-hidden="true"><i /><i /><i /></span><strong>{size.title}</strong><small>{size.description}</small>{value.size === size.value && <Check className="cl-choice-check" aria-hidden="true" />}
    </button>)}</div></fieldset>
    <div className="cl-dock-details"><label className="cl-label-toggle" htmlFor={`${id}-labels`}><span className="cl-label-toggle-icon"><Eye aria-hidden="true" /></span><span><strong>إظهار أسماء الأقسام</strong><small>إلغاء الاختيار يعرض الأيقونات فقط. تظل الأسماء داخل «المزيد».</small></span><input id={`${id}-labels`} type="checkbox" checked={value.showLabels} onChange={event => onChange({ ...value, showLabels: event.target.checked })} /></label>
      <fieldset className="cl-choice-field"><legend>الاختيارات المباشرة على الموبايل</legend><div className="cl-count-choices">{([3, 4] as const).map(count => <button key={count} type="button" aria-pressed={value.mobileVisibleCount === count} onClick={() => onChange({ ...value, mobileVisibleCount: count })}>{count === 3 ? '٣ أقسام + المزيد' : '٤ أقسام + المزيد'}</button>)}</div><p className="cl-hint">العدد يشمل الرئيسية بعد الصلاحيات. «داخل المزيد» للموبايل فقط؛ الكمبيوتر يعرض كل أقسامه مباشرة.</p></fieldset>
    </div>
    <div className="cl-note"><SlidersHorizontal aria-hidden="true" /><p>الأحجام محددة للحفاظ على وضوح النص وأزرار اللمس. ترتيب الأقسام وأسماؤها من تبويب «ترتيب الشريط». الإعداد يُحفظ لهذا المتصفح، ولا يغيّر صلاحيات الحسابات.</p></div>
  </div>;
}
