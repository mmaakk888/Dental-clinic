import React, { useEffect, useId, useRef, useState } from 'react';
import { AlertCircle, CalendarDays, Check, CheckCircle2, ChevronDown, Eye, ImagePlus, Monitor, Palette, RotateCcw, Save, Smartphone, Type, Undo2, Users } from 'lucide-react';
import type { ThemeSettings } from '../../types';
import { ClinicLogo } from '../common/ClinicLogo';
import { useToastAndConfirm } from '../common/ToastAndConfirm';
import { applyColorPreset, applyFontChoice, buildGoogleFont, cloneIdentityDraft, COLOR_PRESETS, contrastRatio, DEFAULT_THEME, FONT_CHOICES, normalizeHexColor, readableForeground, validateClinicName, validateLogoMetadata } from '../../utils/clinicIdentity';
import './identityAppearance.css';
import {activeFontStylesheet} from '../../utils/fontStylesheet';

export interface IdentityAppearanceDraft {
  clinicName: string;
  clinicLogo: string | null;
  theme: ThemeSettings;
}

interface IdentityAppearanceProps extends IdentityAppearanceDraft {
  onSaveIdentity: (draft: IdentityAppearanceDraft) => void;
  onDraftChange?: (draft: IdentityAppearanceDraft) => void;
}

const identitySections = [
  { key: 'clinic', label: 'بيانات العيادة', icon: ImagePlus },
  { key: 'colors', label: 'الألوان', icon: Palette },
  { key: 'font', label: 'الخط', icon: Type },
  { key: 'preview', label: 'المعاينة', icon: Eye },
] as const;
type IdentitySection = typeof identitySections[number]['key'];
type ColorKey = 'primary' | 'secondary' | 'accent' | 'background';
const colorFields: ReadonlyArray<{ key: ColorKey; label: string; description: string }> = [
  { key: 'primary', label: 'اللون الأساسي', description: 'الأزرار والعناصر الرئيسية' },
  { key: 'secondary', label: 'اللون المساند', description: 'العناوين الصغيرة في الرئيسية' },
  { key: 'accent', label: 'لون التمييز', description: 'لمسات الهوية مثل إطار الترحيب' },
  { key: 'background', label: 'خلفية الصفحة', description: 'المساحة المحيطة بالمحتوى' },
];
const themeKeys: ReadonlyArray<keyof ThemeSettings> = ['primary', 'secondary', 'accent', 'background', 'fontFamily', 'customFontUrl'];
const firstFontFamily = (family: string | undefined) => (family || DEFAULT_THEME.fontFamily || 'Cairo').split(',')[0].trim().replace(/^['"]|['"]$/g, '');
const matchingFont = (family: string | undefined) => FONT_CHOICES.find(font => font.name.toLowerCase() === firstFontFamily(family).toLowerCase());
const equalDrafts = (first: IdentityAppearanceDraft, second: IdentityAppearanceDraft) => first.clinicName === second.clinicName
  && first.clinicLogo === second.clinicLogo && themeKeys.every(key => first.theme[key] === second.theme[key]);

function IdentityLogo({ source }: { source: string | null }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [source]);
  if (source && !failed) return <img className="ia-logo-image" src={source} alt="شعار العيادة" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
  return <ClinicLogo size="lg" layout="icon-only" showText={false} />;
}

export function IdentityAppearance({ clinicName, clinicLogo, theme, onSaveIdentity, onDraftChange }: IdentityAppearanceProps) {
  const { showToast, askConfirm } = useToastAndConfirm();
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [draft, setDraft] = useState<IdentityAppearanceDraft>(() => cloneIdentityDraft({ clinicName, clinicLogo, theme }));
  const [saved, setSaved] = useState<IdentityAppearanceDraft>(() => cloneIdentityDraft({ clinicName, clinicLogo, theme }));
  const received = useRef(cloneIdentityDraft({ clinicName, clinicLogo, theme }));
  const savedRef = useRef(saved);
  savedRef.current = saved;
  const draftCallback = useRef(onDraftChange);
  draftCallback.current = onDraftChange;
  const [section, setSection] = useState<IdentitySection>('clinic');
  const [previewMode, setPreviewMode] = useState<'desktop' | 'mobile'>('mobile');
  const [customFontInput, setCustomFontInput] = useState(() => matchingFont(theme.fontFamily) ? '' : firstFontFamily(theme.fontFamily));
  const [customFontEdited, setCustomFontEdited] = useState(false);
  const [fontStatus, setFontStatus] = useState<'ready' | 'loading' | 'unavailable'>('ready');
  const [fontRetry, setFontRetry] = useState(0);
  const [logoBusy, setLogoBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState('');
  const [logoError, setLogoError] = useState('');
  const [fontError, setFontError] = useState('');
  const [colorError, setColorError] = useState('');
  const [saveError, setSaveError] = useState('');
  const uploadVersion = useRef(0);
  const readerRef = useRef<FileReader | null>(null);
  const saveBusy = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const saveBarRef = useRef<HTMLElement>(null);
  const [saveBarLayout, setSaveBarLayout] = useState({ pinned: false, left: 0, width: 0, height: 0 });
  const sectionPanel = useRef<HTMLElement>(null);
  const tabButtons = useRef<Array<HTMLButtonElement | null>>([]);
  const isDirty = !equalDrafts(draft, saved) || customFontEdited;

  useEffect(() => {
    // The workspace clips overflow, so sticky cannot follow the viewport here.
    // Pin only a dirty draft's save controls, preserving their normal space.
    const measure = () => {
      const form = formRef.current;
      const bar = saveBarRef.current;
      if (!form || !bar) return;
      const bounds = form.getBoundingClientRect();
      const next = { pinned: (isDirty || logoBusy) && window.innerHeight >= 520 && bounds.width > 0, left: bounds.left, width: bounds.width, height: bar.getBoundingClientRect().height };
      setSaveBarLayout(previous => previous.pinned === next.pinned && Math.abs(previous.left - next.left) < .5
        && Math.abs(previous.width - next.width) < .5 && Math.abs(previous.height - next.height) < .5 ? previous : next);
    };
    const observer = new ResizeObserver(measure);
    if (formRef.current) observer.observe(formRef.current);
    if (saveBarRef.current) observer.observe(saveBarRef.current);
    window.addEventListener('resize', measure);
    measure();
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [isDirty, logoBusy]);

  useEffect(() => {
    const incoming = cloneIdentityDraft({ clinicName, clinicLogo, theme });
    const previous = received.current;
    if (equalDrafts(incoming, previous)) return;
    received.current = incoming;
    setSaved(incoming);
    // Sync changed saved fields, but never erase a locally edited field merely
    // because a parent re-renders or updates another part of the identity.
    setDraft(current => {
      const mergedTheme = { ...incoming.theme };
      for (const key of themeKeys) if (current.theme[key] !== previous.theme[key]) mergedTheme[key] = current.theme[key];
      return {
        clinicName: current.clinicName === previous.clinicName ? incoming.clinicName : current.clinicName,
        clinicLogo: current.clinicLogo === previous.clinicLogo ? incoming.clinicLogo : current.clinicLogo,
        theme: mergedTheme,
      };
    });
  }, [clinicName, clinicLogo, theme]);

  useEffect(() => { draftCallback.current?.(cloneIdentityDraft(draft)); }, [draft]);
  useEffect(() => () => { uploadVersion.current += 1; readerRef.current?.abort(); }, []);

  const selectedFont = matchingFont(draft.theme.fontFamily);
  const customFont = selectedFont ? null : buildGoogleFont(firstFontFamily(draft.theme.fontFamily));
  const previewFontUrl = activeFontStylesheet(draft.theme.fontFamily,draft.theme.customFontUrl);
  const previewFontName = customFont?.name;
  useEffect(() => {
    if (!previewFontUrl || !previewFontName) { setFontStatus(selectedFont ? 'ready' : 'unavailable'); return; }
    let disposed = false;
    let finished = false;
    setFontStatus('loading');
    // This preview link is separate from App's saved-font link. It only loads
    // font-face definitions; no root variables or body styles are changed.
    const link = document.createElement('link');
    link.id = `identity-preview-font-${id}`;
    link.rel = 'stylesheet';
    link.href = previewFontUrl;
    const finish = (status: 'ready' | 'unavailable') => {
      if (disposed || finished) return;
      finished = true;
      window.clearTimeout(timeout);
      setFontStatus(status);
    };
    const timeout = window.setTimeout(() => finish('unavailable'), 12_000);
    link.onload = () => {
      if (!document.fonts) { finish('unavailable'); return; }
      document.fonts.load(`400 18px "${previewFontName}"`, 'عيادة الأسنان').then(faces => finish(faces.length ? 'ready' : 'unavailable')).catch(() => finish('unavailable'));
    };
    link.onerror = () => finish('unavailable');
    document.head.appendChild(link);
    return () => { disposed = true; window.clearTimeout(timeout); link.onload = null; link.onerror = null; link.remove(); };
  }, [previewFontUrl, previewFontName, fontRetry, id, selectedFont]);

  const changeDraft = (change: Partial<IdentityAppearanceDraft>) => {
    setSaveError('');
    setDraft(current => ({ ...current, ...change }));
  };
  const chooseFont = (font: { name: string; fontFamily: string; customFontUrl: string }) => {
    setDraft(current => ({ ...current, theme: applyFontChoice(current.theme, font) }));
    setCustomFontEdited(false); setCustomFontInput(''); setFontError(''); setSaveError('');
  };
  const applyCustomFont = () => {
    const font = buildGoogleFont(customFontInput);
    if (!font) { setFontError('اكتب اسم الخط بالإنجليزية فقط، مثل Almarai، دون رابط أو رموز.'); return; }
    chooseFont(font); setCustomFontInput(font.name);
  };
  const chooseSection = (next: IdentitySection) => { setSection(next); };
  const handleTabKey = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (event.key === 'ArrowLeft') next = (index + 1) % identitySections.length;
    else if (event.key === 'ArrowRight') next = (index - 1 + identitySections.length) % identitySections.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = identitySections.length - 1;
    else return;
    event.preventDefault(); chooseSection(identitySections[next].key); tabButtons.current[next]?.focus();
  };
  const cancelUpload = () => { uploadVersion.current += 1; readerRef.current?.abort(); readerRef.current = null; setLogoBusy(false); };
  const handleLogoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    cancelUpload();
    const version = uploadVersion.current;
    const validation = validateLogoMetadata({ type: file.type, size: file.size });
    if (!validation.valid) { setLogoError(validation.error || 'الصورة غير صالحة.'); return; }
    setLogoBusy(true); setLogoError(''); setSaveError('');
    try {
      const source = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); readerRef.current = reader;
        reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('تعذّرت قراءة الصورة.'));
        reader.onerror = () => reject(new Error('تعذّرت قراءة الصورة.'));
        reader.onabort = () => reject(new Error('تم إلغاء قراءة الصورة.'));
        reader.readAsDataURL(file);
      });
      if (version !== uploadVersion.current) return;
      const image = new Image();
      if (typeof image.decode === 'function') {
        image.src = source;
        try { await image.decode(); }
        catch { throw new Error('الصورة تالفة أو غير قابلة للفتح. اختر صورة أخرى.'); }
      }
      else await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('تعذّر فتح الصورة.')); image.src = source; });
      if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth > 4096 || image.naturalHeight > 4096) throw new Error('اختر صورة واضحة بأبعاد لا تتجاوز ٤٠٩٦ × ٤٠٩٦ بكسل.');
      if (version !== uploadVersion.current) return;
      setDraft(current => ({ ...current, clinicLogo: source }));
    } catch (error) {
      if (version === uploadVersion.current) setLogoError(error instanceof Error ? error.message : 'تعذّر فتح الصورة؛ الشعار الحالي لم يتغير.');
    } finally { if (version === uploadVersion.current) { readerRef.current = null; setLogoBusy(false); } }
  };
  const discard = () => {
    const restore = () => {
      cancelUpload(); const original = cloneIdentityDraft(savedRef.current); setDraft(original);
      setCustomFontInput(matchingFont(original.theme.fontFamily) ? '' : firstFontFamily(original.theme.fontFamily));
      setCustomFontEdited(false); setNameError(''); setLogoError(''); setFontError(''); setColorError(''); setSaveError('');
    };
    if (!isDirty && !logoBusy) return;
    askConfirm({ title: 'إلغاء التغييرات غير المحفوظة؟', message: 'ستعود المعاينة إلى الهوية المحفوظة. لن يتغير اسم العيادة أو شعارها أو إعداداتها المحفوظة.', confirmLabel: 'إلغاء التغييرات', tone: 'warning', onConfirm: restore });
  };
  const resetTheme = () => askConfirm({ title: 'استعادة المظهر الافتراضي؟', message: 'سيعود اللون والخط في المسودة إلى الافتراضي فقط. اسم العيادة والشعار لا يتغيران، ولن يُطبّق المظهر حتى تحفظه.', confirmLabel: 'استعادة في المسودة', tone: 'info', onConfirm: () => {
    setDraft(current => ({ ...current, theme: { ...DEFAULT_THEME } })); setCustomFontInput(''); setCustomFontEdited(false); setFontError(''); setColorError(''); setSaveError('');
  } });
  const saveIdentity = (event: React.FormEvent) => {
    event.preventDefault();
    if (saveBusy.current || logoBusy || !isDirty) return;
    const name = validateClinicName(draft.clinicName);
    if (!name.valid) { setNameError(name.error || 'راجع اسم العيادة.'); setSection('clinic'); requestAnimationFrame(() => nameInput.current?.focus()); return; }
    let nextTheme = { ...draft.theme };
    for (const field of colorFields) {
      const color = normalizeHexColor(nextTheme[field.key]);
      if (!color) { setColorError(`راجع ${field.label}: اكتب ٦ خانات مثل #2563eb.`); setSection('colors'); return; }
      nextTheme[field.key] = color;
    }
    if (customFontEdited) {
      const font = buildGoogleFont(customFontInput);
      if (!font) { setFontError('اكتب اسم خط صحيح بالإنجليزية، أو اختر أحد الخطوط الجاهزة.'); setSection('font'); return; }
      nextTheme = applyFontChoice(nextTheme, font);
    }
    const next = { clinicName: name.value, clinicLogo: draft.clinicLogo, theme: nextTheme };
    saveBusy.current = true; setSaving(true); setSaveError('');
    try {
      onSaveIdentity(cloneIdentityDraft(next));
      setDraft(cloneIdentityDraft(next)); setSaved(cloneIdentityDraft(next)); setCustomFontEdited(false);
      setNameError(''); setColorError(''); setFontError('');
      showToast('تم حفظ هوية العيادة ومظهرها.', 'success');
    } catch (error) { setSaveError(error instanceof Error ? error.message : 'تعذّر الحفظ. المسودة محفوظة هنا لتعيد المحاولة.'); }
    finally { saveBusy.current = false; setSaving(false); }
  };

  const previewColors = Object.fromEntries(colorFields.map(field => [field.key, normalizeHexColor(draft.theme[field.key]) || normalizeHexColor(saved.theme[field.key]) || DEFAULT_THEME[field.key]])) as Pick<ThemeSettings, ColorKey>;
  const previewFontFamily = fontStatus === 'ready' ? draft.theme.fontFamily || DEFAULT_THEME.fontFamily : DEFAULT_THEME.fontFamily;
  const previewStyle = {
    '--ia-primary': previewColors.primary, '--ia-secondary': previewColors.secondary,
    '--ia-accent': previewColors.accent, '--ia-background': previewColors.background,
    '--ia-accent-text': readableForeground(previewColors.accent), '--app-font': previewFontFamily,
  } as React.CSSProperties;
  const contrastWarnings = [
    contrastRatio(previewColors.primary, '#ffffff') < 4.5 ? 'اللون الأساسي فاتح على نص الأزرار الأبيض.' : '',
    contrastRatio(previewColors.secondary, '#ffffff') < 4.5 ? 'اللون المساند يحتاج نصًا أوضح عند استخدام الأبيض.' : '',
    contrastRatio(previewColors.background, '#17262a') < 4.5 ? 'الخلفية داكنة على النصوص الداكنة المستخدمة في الموقع.' : '',
  ].filter(Boolean);
  const preview = <section className="ia-preview-card" aria-label="معاينة هوية العيادة">
    <div className="ia-preview-heading"><div><h3>معاينة تجريبية</h3><p>نموذج للألوان والخط، وليس نسخة من كل شاشة.</p></div>
      <div className="ia-device-controls" aria-label="حجم نموذج المعاينة">
        <button type="button" aria-label="معاينة الموبايل" aria-pressed={previewMode === 'mobile'} onClick={() => setPreviewMode('mobile')}><Smartphone aria-hidden="true" /></button>
        <button type="button" aria-label="معاينة الكمبيوتر" aria-pressed={previewMode === 'desktop'} onClick={() => setPreviewMode('desktop')}><Monitor aria-hidden="true" /></button>
      </div>
    </div>
    <div className="ia-preview-stage"><div className="ia-preview" data-device={previewMode} style={previewStyle}>
      <div className="ia-demo-header"><IdentityLogo source={draft.clinicLogo} /><div><strong>{draft.clinicName.trim() || 'اسم عيادتك'}</strong><small>نموذج العرض</small></div></div>
      <div className="ia-demo-body"><div className="ia-demo-welcome"><small>أهلًا بك</small><h4>كل التفاصيل في مكان واحد</h4><p>تنظيم مواعيد العيادة ومتابعة العمل بسهولة.</p><span className="ia-demo-action">إجراء تجريبي</span></div>
        <div className="ia-demo-metrics"><div><CalendarDays aria-hidden="true" /><span>معاينة المواعيد</span><strong>٠</strong></div><div><Users aria-hidden="true" /><span>معاينة المتابعات</span><strong>٠</strong></div></div>
        <div className="ia-demo-row"><span className="ia-demo-dot" /><span>مثال على بطاقة متابعة</span><small>مؤكد</small></div>
      </div>
      <div className="ia-demo-navigation" aria-hidden="true"><span>الرئيسية</span><span>المرضى</span><span>المواعيد</span></div>
    </div></div>
    {fontStatus === 'loading' && <p className="ia-hint" role="status">جاري تحميل الخط للمعاينة فقط…</p>}
    {fontStatus === 'unavailable' && <div className="ia-warning"><AlertCircle aria-hidden="true" /><div><p>تعذّر عرض الخط الآن؛ تظهر المعاينة بخط القاهرة مؤقتًا.</p>{previewFontUrl && <button type="button" className="ia-text-button" onClick={() => setFontRetry(value => value + 1)}>إعادة محاولة تحميل الخط</button>}</div></div>}
  </section>;

  return <form ref={formRef} className="identity-appearance" dir="rtl" noValidate onSubmit={saveIdentity}>
    <header className="ia-header"><div><span className="ia-eyebrow">هوية واضحة لعيادتك</span><h2>الهوية والمظهر</h2><p>عاين التغييرات، ثم احفظ الشكل المناسب.</p></div>
      <span className="ia-draft-status" data-dirty={isDirty || logoBusy} role="status">{isDirty || logoBusy ? <><span /> تغييرات غير محفوظة</> : <><CheckCircle2 aria-hidden="true" /> الهوية المحفوظة</>}</span>
    </header>
    <div className="ia-tabs" role="tablist" aria-label="إعدادات الهوية والمظهر">
      {identitySections.map((item, index) => <button key={item.key} ref={element => { tabButtons.current[index] = element; }} type="button" id={`${id}-${item.key}-tab`} role="tab" aria-selected={section === item.key}
        aria-controls={`${id}-identity-panel`} tabIndex={section === item.key ? 0 : -1} onKeyDown={event => handleTabKey(event, index)} onClick={() => chooseSection(item.key)}><item.icon aria-hidden="true" />{item.label}</button>)}
    </div>
    <div className={`ia-content-layout${section === 'preview' ? ' is-preview-only' : ''}`}>
      <section ref={sectionPanel} id={`${id}-identity-panel`} role="tabpanel" aria-labelledby={`${id}-${section}-tab`} tabIndex={-1} className="ia-section-panel">
        {section === 'clinic' && <div className="ia-section-card ia-section-enter"><div className="ia-section-title"><ImagePlus aria-hidden="true" /><div><h3>بيانات العيادة</h3><p>الاسم والشعار اللذان يظهران في واجهة النظام.</p></div></div>
          <div className="ia-field"><label htmlFor={`${id}-clinic-name`}>اسم العيادة</label><input ref={nameInput} id={`${id}-clinic-name`} value={draft.clinicName} onChange={event => { changeDraft({ clinicName: event.target.value }); setNameError(''); }}
            onBlur={() => { const validation = validateClinicName(draft.clinicName); setNameError(validation.error || ''); }} required maxLength={100} autoComplete="organization" aria-invalid={!!nameError} aria-describedby={nameError ? `${id}-name-error` : `${id}-name-help`} />
            <p id={`${id}-name-help`} className="ia-hint">اكتب الاسم كما تحب أن يظهر، بحد أقصى ١٠٠ حرف.</p>{nameError && <p id={`${id}-name-error`} className="ia-error" role="alert">{nameError}</p>}</div>
          <div className="ia-logo-card"><div className="ia-logo-frame"><IdentityLogo source={draft.clinicLogo} /></div><div className="ia-logo-controls"><strong>{draft.clinicLogo ? 'شعار مخصص' : 'الشعار الافتراضي'}</strong><p>PNG أو JPG أو WebP حتى ٢ ميجابايت.</p>
            <div className="ia-inline-actions"><button type="button" className="ia-secondary-button" onClick={() => fileInput.current?.click()}>{logoBusy ? 'اختيار صورة أخرى' : 'اختيار صورة للشعار'}</button>
              {draft.clinicLogo && <button type="button" className="ia-text-button" onClick={() => { cancelUpload(); changeDraft({ clinicLogo: null }); setLogoError(''); }}>استخدام الشعار الافتراضي</button>}</div>
            <input ref={fileInput} className="ia-file-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={handleLogoUpload} aria-label="اختيار صورة شعار العيادة" />
          </div></div>
          {logoBusy && <p className="ia-hint" role="status">جاري فحص الصورة؛ الشعار الحالي لا يتغير حتى تنجح القراءة.</p>}
          {logoError && <p className="ia-error" role="alert">{logoError} الشعار السابق لم يتغير.</p>}
          <p className="ia-hint">استبدال الشعار أو إزالته يُطبّق بعد حفظ الهوية فقط.</p>
        </div>}
        {section === 'colors' && <div className="ia-section-card ia-section-enter"><div className="ia-section-title"><Palette aria-hidden="true" /><div><h3>ألوان مرتبة وجاهزة</h3><p>اختيار الألوان لا يغيّر الخط أو بيانات العيادة.</p></div></div>
          <div className="ia-preset-grid">{COLOR_PRESETS.map(preset => {
            const selected = colorFields.every(field => normalizeHexColor(draft.theme[field.key]) === preset[field.key]);
            return <button key={preset.id} type="button" className="ia-preset-option" aria-pressed={selected} onClick={() => { setDraft(current => ({ ...current, theme: applyColorPreset(current.theme, preset) })); setColorError(''); setSaveError(''); }}>
              <span className="ia-option-heading"><strong>{preset.name}</strong>{selected && <Check aria-hidden="true" />}</span><small>{preset.description}</small><span className="ia-color-swatches" aria-hidden="true">{colorFields.map(field => <span key={field.key} style={{ background: preset[field.key] }} />)}</span>
            </button>;
          })}</div>
          <details className="ia-advanced"><summary>ألوان مخصصة <ChevronDown aria-hidden="true" /></summary><div className="ia-color-fields">{colorFields.map(field => <div key={field.key} className="ia-field"><label htmlFor={`${id}-${field.key}-hex`}>{field.label}</label><p className="ia-hint">{field.description}</p>
            <div className="ia-color-inputs"><input type="color" value={previewColors[field.key]} aria-label={`اختيار ${field.label}`} onChange={event => { setDraft(current => ({ ...current, theme: { ...current.theme, [field.key]: event.target.value } })); setColorError(''); setSaveError(''); }} />
              <input id={`${id}-${field.key}-hex`} value={draft.theme[field.key]} maxLength={7} dir="ltr" spellCheck={false} autoComplete="off" aria-invalid={!normalizeHexColor(draft.theme[field.key])} onChange={event => { setDraft(current => ({ ...current, theme: { ...current.theme, [field.key]: event.target.value } })); setColorError(''); setSaveError(''); }} onBlur={() => { const color = normalizeHexColor(draft.theme[field.key]); if (color) setDraft(current => ({ ...current, theme: { ...current.theme, [field.key]: color } })); }} /></div>
            {!normalizeHexColor(draft.theme[field.key]) && <p className="ia-error">أدخل ٦ خانات صحيحة، مثل #2563eb.</p>}</div>)}</div></details>
          {colorError && <p className="ia-error" role="alert">{colorError}</p>}
          {contrastWarnings.length > 0 && <div className="ia-warning"><AlertCircle aria-hidden="true" /><div><strong>راجع وضوح النص قبل الحفظ</strong>{contrastWarnings.map(warning => <p key={warning}>{warning}</p>)}<p>الألوان الداكنة للأزرار والخلفية الفاتحة عادة أوضح. هذا تنبيه لهذه الأزواج فقط، وليس تقييمًا لكل التصميم.</p></div></div>}
        </div>}
        {section === 'font' && <div className="ia-section-card ia-section-enter"><div className="ia-section-title"><Type aria-hidden="true" /><div><h3>خط واضح وسهل القراءة</h3><p>اختر خطًا للمعاينة؛ لا يتغير خط الموقع قبل الحفظ.</p></div></div>
          <div className="ia-font-grid">{FONT_CHOICES.slice(0, 3).map(font => <button key={font.id} type="button" className="ia-font-option" aria-pressed={selectedFont?.id === font.id} onClick={() => chooseFont(font)}>
            <span className="ia-option-heading"><strong>{font.label}</strong>{selectedFont?.id === font.id && <Check aria-hidden="true" />}</span><small>{font.description}</small><span className="ia-font-sample" style={{ '--app-font': font.fontFamily } as React.CSSProperties}>تنظيم عيادتك ببساطة</span></button>)}</div>
          <details className="ia-advanced"><summary>خطوط أخرى وخط مخصص <ChevronDown aria-hidden="true" /></summary><div className="ia-advanced-body"><div className="ia-font-grid">{FONT_CHOICES.slice(3).map(font => <button key={font.id} type="button" className="ia-font-option" aria-pressed={selectedFont?.id === font.id} onClick={() => chooseFont(font)}>
            <span className="ia-option-heading"><strong>{font.label}</strong>{selectedFont?.id === font.id && <Check aria-hidden="true" />}</span><span className="ia-font-sample" style={{ '--app-font': font.fontFamily } as React.CSSProperties}>اسم العيادة والمواعيد</span></button>)}</div>
            <div className="ia-field"><label htmlFor={`${id}-custom-font`}>اسم خط من Google Fonts</label><p className="ia-hint">اسم الخط بالإنجليزية فقط، وليس رابطًا. يحتاج الإنترنت لعرض الخط الجديد.</p><div className="ia-custom-font-input"><input id={`${id}-custom-font`} value={customFontInput} maxLength={60} dir="ltr" placeholder="Almarai" spellCheck={false} autoComplete="off" aria-invalid={!!fontError}
              onChange={event => { setCustomFontInput(event.target.value); setCustomFontEdited(true); setFontError(''); setSaveError(''); }} /><button type="button" className="ia-secondary-button" onClick={applyCustomFont}>عرض في المعاينة</button></div>
              {fontError && <p className="ia-error" role="alert">{fontError}</p>}{customFontEdited && <p className="ia-hint">اضغط «عرض في المعاينة» للتجربة، أو احفظ لضم الاسم المكتوب إلى الهوية.</p>}</div>
          </div></details>
          <p className="ia-current-font">الخط المختار: <bdi>{firstFontFamily(draft.theme.fontFamily)}</bdi></p>
        </div>}
        {section === 'preview' && <div className="ia-section-enter">{preview}</div>}
      </section>
      {section !== 'preview' && <aside className="ia-preview-aside">{preview}<button type="button" className="ia-preview-expand" onClick={() => { setSection('preview'); requestAnimationFrame(() => sectionPanel.current?.focus({ preventScroll: true })); }}><Eye aria-hidden="true" /> فتح المعاينة كاملة</button></aside>}
    </div>
    <div className="ia-reset-row"><p>تستعيد إعدادات اللون والخط فقط، دون بيانات العيادة.</p><button type="button" className="ia-text-button" onClick={resetTheme}><RotateCcw aria-hidden="true" /> استعادة المظهر الافتراضي</button></div>
    {saveError && <div className="ia-save-error" role="alert"><AlertCircle aria-hidden="true" /><span>{saveError}</span></div>}
    <div className="ia-save-anchor" style={saveBarLayout.pinned ? { height: saveBarLayout.height } : undefined}>
    <footer ref={saveBarRef} className="ia-save-bar" data-pinned={saveBarLayout.pinned} style={saveBarLayout.pinned ? { left: saveBarLayout.left, width: saveBarLayout.width } : undefined}><div><strong>{isDirty ? 'جاهز لحفظ تغييراتك؟' : 'كل التغييرات محفوظة'}</strong><small>{logoBusy ? 'انتظر اكتمال فحص الشعار أولًا.' : 'المعاينة لا تغيّر الموقع حتى تضغط حفظ.'}</small></div><div className="ia-save-actions">
      <button type="button" className="ia-secondary-button" onClick={discard} disabled={(!isDirty && !logoBusy) || saving}><Undo2 aria-hidden="true" /> إلغاء التغييرات</button>
      <button type="submit" className="ia-primary-button" disabled={!isDirty || logoBusy || saving}><Save aria-hidden="true" />{saving ? 'جاري الحفظ…' : 'حفظ الهوية والمظهر'}</button>
    </div></footer></div>
  </form>;
}
