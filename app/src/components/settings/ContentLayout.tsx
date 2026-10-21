import React, { useEffect, useId, useRef, useState } from 'react';
import { AlertCircle, ArrowDown, ArrowUp, Calendar, CheckCircle2, ChevronLeft, ContactRound, Eye, Home, Landmark, ListOrdered, LockKeyhole, Microscope, Monitor, MoreHorizontal, RotateCcw, Save, Settings2, SlidersHorizontal, Smartphone, Type, Undo2, Users } from 'lucide-react';
import type { DockAppearance, HomeLayoutSettings } from '../../types';
import { DEFAULT_UI_LABELS } from '../../data/initialData';
import { cloneContentDraft, DEFAULT_HOME_SUBTITLE, DEFAULT_HOME_WELCOME, getDeviceNavigationOrder, getHomeSubtitle, getHomeWelcome, getNavigationItems, getNavigationLabel, moveNavigationSection, NAVIGATION_SECTIONS, normalizeNavigationOrder, validateContentDraft } from '../../utils/clinicContent';
import type { ContentDraft, NavigationKey } from '../../utils/clinicContent';
import { useToastAndConfirm } from '../common/ToastAndConfirm';
import { DEFAULT_DOCK_APPEARANCE, getDesktopDockAppearance, getDockAppearance, splitDesktopNavigation, splitMobileNavigation } from '../../utils/dockAppearance';
import { DockAppearanceControls } from './DockAppearanceControls';
import { HomeLayoutControls } from './HomeLayoutControls';
import { getHomeLayout, HOME_SECTIONS } from '../../utils/homeLayout';
import './contentLayout.css';

interface ContentLayoutProps extends ContentDraft {
  onDirtyChange?: (dirty: boolean) => void;
  clinicName: string;
  onSaveContent: (values: ContentDraft) => void | Promise<void>;
}
const sections = [
  { key: 'home', label: 'الرئيسية', icon: Home },
  { key: 'navigation', label: 'ترتيب الشريط', icon: ListOrdered },
  { key: 'appearance', label: 'حجم الشريط', icon: SlidersHorizontal },
  { key: 'preview', label: 'المعاينة', icon: Eye },
] as const;
type EditorSection = typeof sections[number]['key'];
const icons = { home: Home, patients: Users, contacts: ContactRound, appointments: Calendar, lab: Microscope, summary: Landmark, settings: Settings2 };
const equalDrafts = (a: ContentDraft, b: ContentDraft) => JSON.stringify(a) === JSON.stringify(b);

// Materialize the text already displayed by the app only in this local draft.
// Legacy patient-file tab labels and unsupported fields remain untouched.
function editableDraft(values: ContentDraft): ContentDraft {
  const next = cloneContentDraft(values);
  next.tileOrder = normalizeNavigationOrder(values.tileOrder);
  next.labels.dockAppearance = { ...next.labels.dockAppearance, ...getDockAppearance(next.labels) };
  next.labels.dockAppearance.desktop = { ...next.labels.dockAppearance.desktop, ...getDesktopDockAppearance(values.labels), order: getDeviceNavigationOrder(values.labels, values.tileOrder, 'desktop') };
  next.labels.homeLayout = getHomeLayout(next.labels);
  next.labels.homeSubtitle = getHomeSubtitle(next.labels);
  next.labels.welcomeText = getHomeWelcome(next.labels);
  next.labels.navigationLabels = { ...next.labels.navigationLabels, ...Object.fromEntries(getNavigationItems(next.labels, next.tileOrder).map(item => [item.key, item.label])) };
  NAVIGATION_SECTIONS.forEach(({ key, description }) => {
    const tile = next.labels.tiles[key];
    if (typeof tile?.desc !== 'string') next.labels.tiles[key] = { ...tile, desc: description };
  });
  return next;
}

export function ContentPreview({ draft, clinicName, mode, onModeChange }: { draft: ContentDraft; clinicName: string; mode: 'mobile' | 'desktop'; onModeChange: (mode: 'mobile' | 'desktop') => void }) {
  const items = getNavigationItems(draft.labels, getDeviceNavigationOrder(draft.labels, draft.tileOrder, mode));
  const appearance = { ...getDockAppearance(draft.labels), ...(mode === 'desktop' ? getDesktopDockAppearance(draft.labels) : {}) };
  const homeLayout = getHomeLayout(draft.labels);
  const split = mode === 'mobile' ? splitMobileNavigation(items, appearance) : splitDesktopNavigation(items, appearance);
  const { visible, extra } = split;
  return <section className="cl-preview-card" aria-label="معاينة المحتوى والترتيب">
    <div className="cl-preview-heading"><div><h3>شوف التغييرات قبل الحفظ</h3><p>نموذج توضيحي بدون بيانات مرضى.</p></div>
      <div className="cl-device-controls" aria-label="حجم المعاينة">
        <button type="button" aria-label="معاينة الموبايل" aria-pressed={mode === 'mobile'} onClick={() => onModeChange('mobile')}><Smartphone aria-hidden="true" /></button>
        <button type="button" aria-label="معاينة الكمبيوتر" aria-pressed={mode === 'desktop'} onClick={() => onModeChange('desktop')}><Monitor aria-hidden="true" /></button>
      </div>
    </div>
    <div className="cl-preview-stage"><div className="cl-demo" data-device={mode}>
      <div className="cl-demo-top"><Home aria-hidden="true" /><span>{clinicName || 'عيادة الأسنان'}</span><span className="cl-demo-tag">معاينة</span></div>
      <div className="cl-demo-body" data-home-density={homeLayout.density}><div className="cl-demo-day"><Calendar aria-hidden="true" /><span>تاريخ اليوم</span><time>١٠:٣٠ ص</time></div>
        <div className="cl-demo-placeholder"><Users aria-hidden="true" /><span>بحث بالاسم أو رقم الملف أو الموبايل</span></div>
        {homeLayout.sectionOrder.filter(key => !homeLayout.hiddenSections.includes(key)).map(key => <div key={key} className="cl-demo-placeholder" data-home-section={key}><SlidersHorizontal aria-hidden="true" /><span>{HOME_SECTIONS.find(section => section.key === key)!.label}</span><small>{key === 'schedule' ? `حتى ${homeLayout.appointmentLimit.toLocaleString('ar-EG')} مواعيد` : 'حسب الصلاحيات'}</small></div>)}
      </div>
      <div className="cl-demo-dock" data-dock-size={appearance.size} data-show-labels={appearance.showLabels} aria-label="ترتيب شريط التنقل في المعاينة">{visible.map(item => {
        const Icon = icons[item.key];
        return <span key={item.key} data-active={item.key === 'home'} aria-label={item.label} title={item.label}><Icon aria-hidden="true" /><small>{item.label}</small></span>;
      })}{!!extra.length && <span aria-label="المزيد" title="المزيد"><MoreHorizontal aria-hidden="true" /><small>المزيد</small></span>}</div>
    </div></div>
    {!!extra.length && <div className="cl-demo-more"><h4>داخل «المزيد»</h4>{extra.map(item => {
      const Icon = icons[item.key];
      return <div key={item.key}><Icon aria-hidden="true" /><span><strong>{item.label}</strong><small>{item.description}</small></span><ChevronLeft aria-hidden="true" /></div>;
    })}</div>}
    <p className="cl-hint">المعاينة تعرض جميع الأقسام. في الموقع تظهر الأقسام المسموح بها للحساب فقط.</p>
  </section>;
}

export function ContentLayout({ labels, tileOrder, clinicName, onSaveContent, onDirtyChange }: ContentLayoutProps) {
  const { showToast, askConfirm } = useToastAndConfirm();
  const id = `content-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [draft, setDraft] = useState(() => editableDraft({ labels, tileOrder }));
  const [saved, setSaved] = useState(() => editableDraft({ labels, tileOrder }));
  const received = useRef(saved);
  const draftRef = useRef(draft);
  const savedRef = useRef(saved);
  draftRef.current = draft;
  savedRef.current = saved;
  const [section, setSection] = useState<EditorSection>('navigation');
  const [selectedKey, setSelectedKey] = useState<NavigationKey>('patients');
  const [previewMode, setPreviewMode] = useState<'mobile' | 'desktop'>('mobile');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const [moveNotice, setMoveNotice] = useState('');
  const busy = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const saveBarRef = useRef<HTMLElement>(null);
  const nameEditorRef = useRef<HTMLDivElement>(null);
  const legacyTextsRef = useRef<HTMLDetailsElement>(null);
  const tabButtons = useRef<Array<HTMLButtonElement | null>>([]);
  const [barLayout, setBarLayout] = useState({ pinned: false, left: 0, width: 0, height: 0 });
  const isDirty = !equalDrafts(draft, saved);
  useEffect(() => { onDirtyChange?.(isDirty); return () => onDirtyChange?.(false); }, [isDirty, onDirtyChange]);

  useEffect(() => {
    const incoming = editableDraft({ labels, tileOrder });
    if (equalDrafts(incoming, received.current)) return;
    received.current = incoming;
    const edited = !equalDrafts(draftRef.current, savedRef.current);
    const clashes = edited && !equalDrafts(draftRef.current, incoming);
    setSaved(incoming);
    setConflict(clashes);
    if (!clashes) { setDraft(cloneContentDraft(incoming)); setErrors({}); setSaveError(''); }
  }, [labels, tileOrder]);

  useEffect(() => {
    const measure = () => {
      if (!formRef.current || !saveBarRef.current) return;
      const bounds = formRef.current.getBoundingClientRect();
      const next = { pinned: isDirty && window.innerHeight >= 520 && bounds.width > 0, left: bounds.left, width: bounds.width, height: saveBarRef.current.getBoundingClientRect().height };
      setBarLayout(previous => previous.pinned === next.pinned && Math.abs(previous.left - next.left) < .5 && Math.abs(previous.width - next.width) < .5 && Math.abs(previous.height - next.height) < .5 ? previous : next);
    };
    const observer = new ResizeObserver(measure);
    if (formRef.current) observer.observe(formRef.current);
    if (saveBarRef.current) observer.observe(saveBarRef.current);
    window.addEventListener('resize', measure);
    measure();
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [isDirty]);

  const clearError = (key: string) => {
    setErrors(previous => { const next = { ...previous }; delete next[key]; return next; });
    setSaveError('');
  };
  const updateHome = (key: 'homeSubtitle' | 'welcomeText', value: string) => {
    if (busy.current) return;
    setDraft(current => ({ ...current, labels: { ...current.labels, [key]: value } }));
    clearError(key);
  };
  const updateName = (value: string) => {
    if (busy.current) return;
    setDraft(current => ({ ...current, labels: { ...current.labels, navigationLabels: { ...current.labels.navigationLabels, [selectedKey]: value } } }));
    clearError(`navigationLabels.${selectedKey}`);
  };
  const selectNavigationSection = (key: NavigationKey) => {
    setSelectedKey(key);
    if (!window.matchMedia('(max-width: 1119px)').matches) return;
    requestAnimationFrame(() => {
      const editor = nameEditorRef.current;
      if (!editor) return;
      const toolbar = document.querySelector('.settings-mobile-nav');
      const toolbarHeight = toolbar?.getBoundingClientRect().height || 0;
      window.scrollTo({ top: Math.max(0, editor.getBoundingClientRect().top + window.scrollY - toolbarHeight - 28), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    });
  };
  const updateDescription = (value: string) => {
    if (busy.current) return;
    if (selectedKey === 'home') return;
    setDraft(current => ({ ...current, labels: { ...current.labels, tiles: { ...current.labels.tiles, [selectedKey]: { ...current.labels.tiles[selectedKey], desc: value } } } }));
    clearError(`tiles.${selectedKey}.desc`);
  };
  const updateAppearance = (value: DockAppearance) => {
    if (busy.current || conflict) return;
    setDraft(current => ({ ...current, labels: { ...current.labels, dockAppearance: previewMode === 'desktop'
      ? { ...current.labels.dockAppearance!, desktop: { ...current.labels.dockAppearance!.desktop!, size: value.size, showLabels: value.showLabels } }
      : { ...current.labels.dockAppearance, ...value } } }));
    clearError('dockAppearance');
  };
  const updatePlacement = (key: Exclude<NavigationKey, 'home'>, placement: 'dock' | 'more') => {
    if (busy.current || conflict || previewMode !== 'mobile') return;
    setDraft(current => {
      const appearance = getDockAppearance(current.labels);
      const moreSections = appearance.moreSections!.filter(item => item !== key);
      if (placement === 'more') moreSections.push(key);
      return { ...current, labels: { ...current.labels, dockAppearance: { ...current.labels.dockAppearance, ...appearance, moreSections } } };
    });
    setMoveNotice(`${getNavigationLabel(draft.labels, key)}: ${placement === 'more' ? 'داخل المزيد على الموبايل فقط' : 'في شريط الموبايل؛ قد ينتقل للمزيد إذا امتلأ العدد المباشر'}. شريط الكمبيوتر لا يتغير. احفظ لتطبيق التغيير.`);
    clearError('dockAppearance');
  };
  const updateHomeLayout = (value: HomeLayoutSettings) => {
    if (busy.current) return;
    setDraft(current => ({ ...current, labels: { ...current.labels, homeLayout: value } }));
    clearError('homeLayout');
  };
  const move = (key: Exclude<NavigationKey, 'home'>, direction: 'up' | 'down') => {
    if (busy.current || conflict) return;
    const nextOrder = moveNavigationSection(getDeviceNavigationOrder(draft.labels, draft.tileOrder, previewMode), key, direction);
    setDraft(current => previewMode === 'desktop'
      ? { ...current, labels: { ...current.labels, dockAppearance: { ...current.labels.dockAppearance!, desktop: { ...current.labels.dockAppearance!.desktop!, order: nextOrder } } } }
      : { ...current, tileOrder: nextOrder });
    setMoveNotice(`انتقل ${getNavigationLabel(draft.labels, key)} إلى الموضع ${nextOrder.indexOf(key) + 2} في شريط ${previewMode === 'mobile' ? 'الموبايل' : 'الكمبيوتر'} فقط.`);
    setSaveError('');
  };
  const restore = () => {
    setDraft(cloneContentDraft(savedRef.current));
    setConflict(false); setErrors({}); setSaveError(''); setMoveNotice('');
  };
  const discard = () => askConfirm({ title: 'إلغاء التغييرات غير المحفوظة؟', message: 'ستعود الرئيسية والنصوص والشريط إلى آخر إعدادات محفوظة. بيانات العيادة والمرضى لا تتغير.', confirmLabel: 'إلغاء التغييرات', tone: 'warning', onConfirm: restore });
  const reset = () => askConfirm({ title: 'استعادة إعدادات العرض الافتراضية؟', message: 'تعود أقسام الرئيسية والشريط والنصوص للوضع الافتراضي في المسودة فقط. اسم العيادة وشعارها وصلاحيات الحسابات لا تتغير؛ التطبيق بعد الحفظ.', confirmLabel: 'استعادة في المسودة', tone: 'info', onConfirm: () => {
    setDraft(current => {
      const next = cloneContentDraft(current);
      next.tileOrder = normalizeNavigationOrder([]);
      next.labels.dockAppearance = { ...next.labels.dockAppearance, ...DEFAULT_DOCK_APPEARANCE };
      next.labels.dockAppearance.desktop = { ...next.labels.dockAppearance.desktop, size: DEFAULT_DOCK_APPEARANCE.size, showLabels: DEFAULT_DOCK_APPEARANCE.showLabels, order: normalizeNavigationOrder([]) };
      next.labels.homeLayout = getHomeLayout(undefined);
      next.labels.homeSubtitle = DEFAULT_HOME_SUBTITLE;
      next.labels.welcomeText = DEFAULT_HOME_WELCOME;
      next.labels.navigationLabels = { ...next.labels.navigationLabels, home: 'الرئيسية' };
      NAVIGATION_SECTIONS.forEach(({ key, label, description }) => {
        next.labels.navigationLabels![key] = label;
        next.labels.tiles[key] = { ...next.labels.tiles[key], desc: description };
      });
      return next;
    });
    setErrors({}); setSaveError(''); setMoveNotice('');
  } });
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy.current || !isDirty || conflict) return;
    const result = validateContentDraft(draft, saved);
    setErrors(result.errors);
    if (!result.valid) {
      const errorKey = Object.keys(result.errors)[0];
      if (errorKey === 'homeSubtitle' || errorKey === 'welcomeText' || errorKey === 'homeLayout') setSection('home');
      else if (errorKey === 'dockAppearance') setSection('appearance');
      else { setSection('navigation'); setSelectedKey(errorKey.split('.')[1] as NavigationKey); }
      requestAnimationFrame(() => {
        if ((errorKey === 'homeSubtitle' || errorKey === 'welcomeText') && legacyTextsRef.current) legacyTextsRef.current.open = true;
        const input = formRef.current?.querySelector<HTMLInputElement>('input[aria-invalid="true"]');
        input?.focus();
      });
      showToast('راجع الحقل الموضّح قبل الحفظ.', 'warning');
      return;
    }
    busy.current = true;
    setSaving(true);
    try {
      await onSaveContent(result.value);
      const next = editableDraft(result.value);
      setDraft(next); setSaved(cloneContentDraft(next));
      setSaveError(''); setMoveNotice('');
      showToast('تم حفظ الرئيسية والمحتوى وترتيب التنقل.', 'success');
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'تعذّر الحفظ. المسودة كما هي؛ حاول مرة أخرى.');
    } finally { busy.current = false; setSaving(false); }
  };
  const tabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let target: number | undefined;
    if (event.key === 'ArrowLeft') target = (index + 1) % sections.length;
    if (event.key === 'ArrowRight') target = (index - 1 + sections.length) % sections.length;
    if (event.key === 'Home') target = 0;
    if (event.key === 'End') target = sections.length - 1;
    if (target === undefined) return;
    event.preventDefault(); setSection(sections[target].key); tabButtons.current[target]?.focus();
  };
  const field = (key: string, label: string, value: string, limit: number, hint: string, update: (value: string) => void) => {
    const fieldId = `${id}-${key.replaceAll('.', '-')}`;
    return <div className="cl-field"><label htmlFor={fieldId}>{label}</label>
      <input id={fieldId} type="text" value={value} maxLength={limit} aria-invalid={!!errors[key]} aria-describedby={`${fieldId}-hint${errors[key] ? ` ${fieldId}-error` : ''}`} onChange={event => update(event.target.value)} />
      <div className="cl-field-meta"><p id={`${fieldId}-hint`}>{hint}</p><span aria-hidden="true">{Array.from(value).length} / {limit}</span></div>
      {errors[key] && <p className="cl-error" id={`${fieldId}-error`} role="alert">{errors[key]}</p>}
    </div>;
  };
  const selectedName = draft.labels.navigationLabels?.[selectedKey] ?? getNavigationLabel(draft.labels, selectedKey);
  const selectedCanonical = selectedKey === 'home' ? 'الرئيسية' : NAVIGATION_SECTIONS.find(item => item.key === selectedKey)!.label;
  const appearance = getDockAppearance(draft.labels);
  const editorAppearance = previewMode === 'desktop' ? { ...appearance, ...getDesktopDockAppearance(draft.labels) } : appearance;
  const editedOrder = getDeviceNavigationOrder(draft.labels, draft.tileOrder, previewMode);
  const forcedMore = new Set(appearance.moreSections);
  const mobileDirectKeys = new Set(splitMobileNavigation(getNavigationItems(draft.labels, draft.tileOrder), appearance).visible.map(item => item.key));
  return <form ref={formRef} className="content-layout" onSubmit={save} noValidate dir="rtl">
    <header className="cl-header"><div><span className="cl-eyebrow">مظهر العيادة / تنظيم الواجهة</span><h2>المحتوى والترتيب</h2><p>اختَر أقسام الرئيسية ورتّبها، واضبط الشريط العائم وأسماء أقسامه.</p></div>
      <span className="cl-draft-status" data-dirty={isDirty} role="status">{isDirty ? <><span /> تغييرات غير محفوظة</> : <><CheckCircle2 aria-hidden="true" /> الإعدادات المحفوظة</>}</span>
    </header>
    <div className="cl-tabs" role="tablist" aria-label="أجزاء المحتوى والترتيب">{sections.map((item, index) => <button key={item.key} ref={element => { tabButtons.current[index] = element; }} type="button" role="tab" id={`${id}-tab-${item.key}`} aria-controls={`${id}-panel-${item.key}`} aria-selected={section === item.key} tabIndex={section === item.key ? 0 : -1} onKeyDown={event => tabKeyDown(event, index)} onClick={() => setSection(item.key)}><item.icon aria-hidden="true" />{item.label}</button>)}</div>
    {(section === 'navigation' || section === 'appearance') && <div className="cl-device-editor"><div><strong>تعديل شريط {previewMode === 'mobile' ? 'الموبايل' : 'الكمبيوتر'}</strong><p>الترتيب والحجم وإظهار الأسماء مستقلّة لكل جهاز. أسماء الأقسام نفسها مشتركة.</p></div><div className="cl-device-switch" role="group" aria-label="الجهاز الذي تعدّل شريطه"><button type="button" aria-label="تعديل شريط الموبايل" aria-pressed={previewMode === 'mobile'} onClick={() => setPreviewMode('mobile')}><Smartphone aria-hidden="true" />الموبايل</button><button type="button" aria-label="تعديل شريط الكمبيوتر" aria-pressed={previewMode === 'desktop'} onClick={() => setPreviewMode('desktop')}><Monitor aria-hidden="true" />الكمبيوتر</button></div></div>}
    {conflict && <div className="cl-save-error" role="alert"><AlertCircle aria-hidden="true" /><div><strong>تغيّرت الإعدادات المحفوظة أثناء التعديل.</strong><p>مسودتك لم تُحذف. ألغِ التغييرات للعودة إلى أحدث إعدادات قبل التعديل والحفظ من جديد.</p></div></div>}
    <div className={`cl-body-layout${section === 'preview' ? ' cl-preview-only' : ''}${section === 'navigation' || section === 'appearance' ? ' cl-no-aside' : ''}`}>
      <section id={`${id}-panel-${section}`} role="tabpanel" aria-labelledby={`${id}-tab-${section}`} className="cl-editor-panel cl-section-enter" key={section}>
        {section === 'home' && <div className="cl-section-card"><div className="cl-section-title"><Home aria-hidden="true" /><div><h3>رتّب الرئيسية على طريقة شغلك</h3><p>تحكّم في الأقسام الظاهرة وترتيبها والمسافات بينها، وشاهد النتيجة قبل الحفظ.</p></div></div>
          <HomeLayoutControls value={getHomeLayout(draft.labels)} onChange={updateHomeLayout} disabled={saving || conflict} />
          {errors.homeLayout && <p className="cl-error" role="alert">{errors.homeLayout}</p>}
          <details ref={legacyTextsRef} className="cl-legacy-texts"><summary><Type aria-hidden="true" /> نصوص التصميم السابق <ChevronLeft className="cl-legacy-chevron" aria-hidden="true" /></summary><p>محفوظة للتوافق مع النسخ السابقة، ولا تظهر في الرئيسية الحالية. تعديلها لا يضيف كارت الترحيب.</p><div>
            {field('homeSubtitle', 'الوصف المحفوظ سابقًا', draft.labels.homeSubtitle, 180, 'هذا النص غير ظاهر في التصميم الحالي.', value => updateHome('homeSubtitle', value))}
            {field('welcomeText', 'رسالة المتابعة المحفوظة سابقًا', draft.labels.welcomeText, 120, 'هذا النص غير ظاهر في التصميم الحالي.', value => updateHome('welcomeText', value))}
          </div></details>
          <div className="cl-note"><Home aria-hidden="true" /><p>اسم العيادة وشعارها وألوانها تُعدّل من قسم «الهوية والمظهر».</p></div>
        </div>}
        {section === 'navigation' && <div className="cl-navigation-panel"><div className="cl-section-card"><div className="cl-section-title"><ListOrdered aria-hidden="true" /><div><h3>ترتيب أقسام {previewMode === 'mobile' ? 'الموبايل' : 'الكمبيوتر'}</h3><p>{previewMode === 'mobile' ? 'حدّد لكل قسم: في الشريط أو داخل المزيد. اضغط الاسم لتغييره، والأسهم لترتيبه.' : 'كل الأقسام المسموح بها تظهر مباشرة على الكمبيوتر. استخدم الأسهم لترتيبها دون تغيير شريط الموبايل.'}</p></div></div>
          <div className="cl-order-list">
            <div className="cl-order-row cl-fixed-row" data-selected={selectedKey === 'home'}><button type="button" className="cl-row-select" onClick={() => selectNavigationSection('home')} aria-pressed={selectedKey === 'home'} aria-controls={`${id}-name-editor`} aria-label="تعديل اسم الرئيسية"><span className="cl-row-icon"><Home aria-hidden="true" /></span><span className="cl-row-label"><strong>{getNavigationLabel(draft.labels, 'home')}</strong><small>أول الشريط دائمًا</small></span></button><span className="cl-fixed-tag"><LockKeyhole aria-hidden="true" /> ثابتة</span></div>
            {editedOrder.map((key, index) => {
              const navKey = key as Exclude<NavigationKey, 'home'>;
              const Icon = icons[navKey];
              const name = getNavigationLabel(draft.labels, navKey);
              return <div key={key} className={`cl-order-row${previewMode === 'mobile' ? ' cl-placeable-row' : ''}`} data-selected={selectedKey === key}><button type="button" className="cl-row-select" onClick={() => selectNavigationSection(navKey)} aria-pressed={selectedKey === key} aria-controls={`${id}-name-editor`} aria-label={`تغيير اسم ${name}`}><span className="cl-row-number">{index + 2}</span><span className="cl-row-icon"><Icon aria-hidden="true" /></span><span className="cl-row-label"><strong>{name}</strong><small>{previewMode === 'desktop' ? 'في شريط الكمبيوتر مباشرة' : forcedMore.has(key) ? 'داخل المزيد على الموبايل فقط' : mobileDirectKeys.has(navKey) ? 'في شريط الموبايل مباشرة' : 'داخل المزيد لامتلاء شريط الموبايل'}</small></span></button>
                <div className="cl-move-buttons"><button type="button" aria-label={`تقديم ${name} في الترتيب`} title="تقديم القسم" disabled={index === 0 || saving || conflict} onClick={() => move(navKey, 'up')}><ArrowUp aria-hidden="true" /></button><button type="button" aria-label={`تأخير ${name} في الترتيب`} title="تأخير القسم" disabled={index === editedOrder.length - 1 || saving || conflict} onClick={() => move(navKey, 'down')}><ArrowDown aria-hidden="true" /></button></div>
                {previewMode === 'mobile' && <div className="cl-placement-choices" role="group" aria-label={`مكان ظهور ${name}`}><button type="button" aria-pressed={!forcedMore.has(key)} aria-label={`${name}: في الشريط`} disabled={saving || conflict} onClick={() => updatePlacement(navKey, 'dock')}><ListOrdered aria-hidden="true" />في الشريط</button><button type="button" aria-pressed={forcedMore.has(key)} aria-label={`${name}: داخل المزيد`} disabled={saving || conflict} onClick={() => updatePlacement(navKey, 'more')}><MoreHorizontal aria-hidden="true" />داخل المزيد</button></div>}
              </div>;
            })}
          </div>
          <p className="cl-hint">الرئيسية ثابتة أول شريط كل جهاز. «داخل المزيد» للموبايل فقط؛ الكمبيوتر يعرض جميع الأقسام المسموح بها بترتيبه المستقل. على الموبايل يظهر أول ٣ أو ٤ أقسام مؤهلة حسب الترتيب والصلاحيات، والباقي داخل المزيد.</p>
          <p className="sr-only" aria-live="polite">{moveNotice}</p>
        </div>
          <div ref={nameEditorRef} id={`${id}-name-editor`} className="cl-section-card cl-name-editor"><div className="cl-section-title"><Settings2 aria-hidden="true" /><div><h3>تغيير اسم {selectedCanonical}</h3><p>اكتب الاسم المناسب لك؛ يظهر في الشريط وقائمة المزيد بدون تغيير وظيفة القسم.</p></div></div>
            {field(`navigationLabels.${selectedKey}`, 'الاسم الظاهر في التنقل', selectedName, 20, 'اسم قصير وواضح لسهولة القراءة على الموبايل.', updateName)}
            {selectedKey !== 'home' && field(`tiles.${selectedKey}.desc`, 'الوصف داخل قائمة المزيد', draft.labels.tiles[selectedKey]?.desc ?? DEFAULT_UI_LABELS.tiles[selectedKey].desc, 140, 'يظهر إذا كان القسم داخل «المزيد». الفارغ يستخدم الوصف الافتراضي.', updateDescription)}
            <div className="cl-note"><LockKeyhole aria-hidden="true" /><p>تغيير الاسم أو الترتيب لا يمنح صلاحيات جديدة، ولا يغيّر ترتيب مؤشرات اليوم أو الإجراءات.</p></div>
          </div>
        </div>}
        {section === 'appearance' && <><DockAppearanceControls value={editorAppearance} mode={previewMode} disabled={saving || conflict} onChange={updateAppearance} />{errors.dockAppearance && <p className="cl-error" role="alert">{errors.dockAppearance}</p>}<div className="cl-appearance-preview"><ContentPreview draft={draft} clinicName={clinicName} mode={previewMode} onModeChange={setPreviewMode} /></div></>}
        {section === 'preview' && <ContentPreview draft={draft} clinicName={clinicName} mode={previewMode} onModeChange={setPreviewMode} />}
      </section>
      {section === 'home' && <aside className="cl-preview-aside"><ContentPreview draft={draft} clinicName={clinicName} mode={previewMode} onModeChange={setPreviewMode} /><button type="button" className="cl-preview-expand" onClick={() => setSection('preview')}><Eye aria-hidden="true" /> فتح المعاينة</button></aside>}
    </div>
    <div className="cl-reset-row"><p>التغييرات تُحفظ على هذا المتصفح. بيانات المرضى لا تتغير.</p><button type="button" className="cl-text-button" onClick={reset} disabled={saving || conflict}><RotateCcw aria-hidden="true" /> استعادة الافتراضي</button></div>
    {saveError && <div className="cl-save-error" role="alert"><AlertCircle aria-hidden="true" /><p>{saveError}</p></div>}
    {barLayout.pinned && <div aria-hidden="true" style={{ height: barLayout.height + 20 }} />}
    <footer ref={saveBarRef} className="cl-save-bar" data-pinned={barLayout.pinned} style={barLayout.pinned ? { left: barLayout.left, width: barLayout.width } : undefined}><div><strong>{isDirty ? 'احفظ لتطبيق التغييرات' : 'كل التغييرات محفوظة'}</strong><small>المعاينة لا تغيّر الموقع قبل الحفظ.</small></div><div className="cl-save-actions"><button type="button" className="cl-secondary-button" onClick={discard} disabled={(!isDirty && !conflict) || saving}><Undo2 aria-hidden="true" /> إلغاء التغييرات</button><button type="submit" className="cl-primary-button" disabled={!isDirty || saving || conflict}><Save aria-hidden="true" />{saving ? 'جاري الحفظ…' : 'حفظ المحتوى والترتيب'}</button></div></footer>
  </form>;
}
