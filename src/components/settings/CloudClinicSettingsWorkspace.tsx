import React, { useCallback, useId, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowDown, ArrowUp, ArrowRight, Building2, Check, History, ImagePlus, Palette, Pencil, Plus, RefreshCw, Settings2, Trash2, X, Layout, Pill, MessageCircle, Sliders, FileSpreadsheet, Download, Route } from 'lucide-react';
import { SettingsSectionNavigation, type SettingsNavigationSection } from './SettingsSectionNavigation';
import { parseCloudClinicLogoData, prepareCloudClinicSettingsCommand, MAX_CLOUD_CLINIC_LOGO_BYTES,
  type CloudClinicSettingsData, type CloudLabDefinitionData, type CloudSettingsTarget } from '../../utils/cloudClinicSettingsRepository';
import type { CloudClinicSettingsWorkspaceController, CloudClinicSettingsWorkspaceDraft,
  CloudClinicSettingsWorkspaceState } from '../../utils/cloudClinicSettingsWorkspaceController';
import type { CloudOperationIntent } from '../../utils/cloudOperationIntent';
import './CloudServiceCatalogWorkspace.css';
import './CloudClinicSettingsWorkspace.css';

const sections = [
  ['identity', 'بيانات العيادة'], ['appearance', 'المظهر'], ['content', 'المحتوى والشريط'], ['medications', 'الأدوية'],
  ['whatsapp', 'قوالب واتساب'], ['labs', 'المعامل وأسعارها'], ['routing', 'توجيه التركيبات'], ['logo', 'الشعار'],
] as const;
export type CloudClinicSettingsSection = typeof sections[number][0];
const navigation = ['patients', 'contacts', 'appointments', 'lab', 'summary', 'settings'] as const;
const labels = { home: 'الرئيسية', patients: 'المرضى', contacts: 'جهات الاتصال', appointments: 'المواعيد', lab: 'التركيبات', summary: 'الماليات', settings: 'الإعدادات' };
const targetFor = (section: CloudClinicSettingsSection): CloudSettingsTarget => section === 'labs' ? 'lab' : section === 'routing' ? 'prostheticRouting' : section === 'logo' ? 'clinicLogo' : 'clinicSettings';
const busy = (state: CloudClinicSettingsWorkspaceState) => state.loading || state.historyLoading || state.saveStatus === 'preparing' || state.saveStatus === 'saving';
const record = (value: any): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const valueText = (value: unknown) => typeof value === 'string' ? value : '';
const moneyText = (value: unknown) => typeof value === 'number' ? String(value / 100) : valueText(value);
/** Empty memory-only editor, not a cloud default or bootstrap. Required brand,
 * colors/font and labels stay blank until the owner chooses them explicitly. */
export function emptyCloudClinicSettingsEditor(): CloudClinicSettingsData {
  return { identity: { clinicName: '', doctorName: '', phone: '', address: '', logoRecordId: null },
    theme: { primary: '', secondary: '', accent: '', background: '', fontFamily: '', customFontUrl: null },
    content: { homeSubtitle: '', welcomeText: '', tiles: Object.fromEntries(navigation.map(key => [key, { title: '', desc: '' }])) as CloudClinicSettingsData['content']['tiles'],
      tabs: { info: '', chart: '', sessions: '', finance: '', lab: '' }, navigationLabels: Object.fromEntries(['home', ...navigation].map(key => [key, ''])) as CloudClinicSettingsData['content']['navigationLabels'],
      mobile: { order: [...navigation], size: 'comfortable', showLabels: true, visibleCount: 4, moreSections: [] },
      desktop: { order: [...navigation], size: 'comfortable', showLabels: true },
      homeLayout: { sectionOrder: ['actions', 'metrics', 'schedule', 'followUp'], hiddenSections: [], density: 'comfortable', appointmentLimit: 6 } },
    medications: [], whatsapp: { senderNumber: '', autoConfirmOnAppt: false, autoRemind24h: false, autoPostOpOnAttended: false, templates: [] } };
}
const emptyLab = (): CloudLabDefinitionData => ({ name: '', phone: '', address: '', notes: '', active: true, costs: [] });
/** Material cost text is converted only on explicit validated save. Raw '12.'
 * or invalid input stays editable, and blank is unknown rather than zero. */
export function buildCloudSettingsEditorData(draft: CloudClinicSettingsWorkspaceDraft): unknown | undefined {
  try {
    let data: unknown = draft.data;
    if (draft.target === 'lab') {
      const input = record(data);
      data = { ...input, costs: input.costs.map((row: any) => {
        if (typeof row.unitCostCents !== 'string') return row;
        const text = row.unitCostCents.replace(/[٠-٩۰-۹]/g, (digit: string) => String(digit.charCodeAt(0) - (digit >= '۰' ? 0x06f0 : 0x0660))).replace(/٫/g, '.').trim();
        if (!text) return { ...row, unitCostCents: null };
        if (!/^\d{1,11}(?:\.\d{1,2})?$/.test(text)) throw new Error();
        const [whole, fraction = ''] = text.split('.'); return { ...row, unitCostCents: Number(whole) * 100 + Number(fraction.padEnd(2, '0')) };
      }) };
    }
    return prepareCloudClinicSettingsCommand({ target: draft.target, recordId: draft.recordId,
      operationId: '00000000-0000-4000-8000-000000000000', expectedRevision: draft.expectedRevision,
      createdAt: '2026-10-12T00:00:00.000Z', data }).data;
  } catch { return undefined; }
}
export interface CloudClinicSettingsWorkspaceViewProps {
  state: CloudClinicSettingsWorkspaceState; section: CloudClinicSettingsSection; previewOnly?: boolean; disabled?: boolean;
  onNavigate?(section: string): void;
  onSection(section: CloudClinicSettingsSection): void; onClose(): void; onLoad(): void; onBegin(): void;
  onUpdate(value: unknown, expected: CloudClinicSettingsWorkspaceDraft): void; onSave(expected: CloudClinicSettingsWorkspaceDraft): void;
  onCancel(expected: CloudClinicSettingsWorkspaceDraft): void; onRetry(): void; onCancelPending(): void;
  onHistory(more: boolean): void; onResume(intent: CloudOperationIntent): void; onLabs(more: boolean): void;
  onSelectLab(id: string): void; onNewLab(): void; onReferences(): void;
  onAddId(work: (id: string) => unknown, expected: CloudClinicSettingsWorkspaceDraft): void;
  onLogo(file: File, expected: CloudClinicSettingsWorkspaceDraft): void;
}
/** Presentation only; preview masks even accidentally supplied data/callbacks. */
export function CloudClinicSettingsWorkspaceView(props: CloudClinicSettingsWorkspaceViewProps) {
  const prefix = useId(), latest = useRef(props); latest.current = props;
  const [contentDevice, setContentDevice] = useState<'mobile' | 'desktop'>('mobile');
  const { state, section } = props, hidden = props.previewOnly || state.closed;
  const draft = hidden ? null : state.draft, source = hidden ? null : draft ? draft.data : state.snapshot?.data;
  const data = record(source), clinic = state.selection.target === 'clinicSettings' ? data : {};
  const disabled = props.disabled === true || hidden || busy(state) || state.saveStatus !== 'idle', editing = !!draft && !disabled;
  const common = () => { const current = latest.current; return !current.disabled && !current.previewOnly && !current.state.closed && !busy(current.state); };
  const edit = (work: (current: CloudClinicSettingsWorkspaceViewProps, expected: CloudClinicSettingsWorkspaceDraft) => void) => {
    const current = latest.current; if (common() && current.state.saveStatus === 'idle' && draft && current.state.draft === draft) work(current, draft);
  };
  const update = (value: unknown) => edit((current, expected) => current.onUpdate(value, expected));
  const field = (label: string, value: unknown, change: (value: string) => void, multiline = false, options: { inputMode?: 'tel' | 'decimal'; max?: number } = {}) =>
    <label key={label} className="csettings-field">{label}{multiline ? <textarea rows={3} value={valueText(value)} disabled={!editing} maxLength={options.max ?? 4000} onChange={event => change(event.target.value)} />
      : <input value={valueText(value)} disabled={!editing} maxLength={options.max ?? 400} inputMode={options.inputMode} onChange={event => change(event.target.value)} />}</label>;
  const check = (label: string, value: unknown, change: (checked: boolean) => void) => <label key={label} className="ccat-check"><input type="checkbox" checked={value === true} disabled={!editing} onChange={event => change(event.target.checked)} />{label}</label>;
  const choice = (label: string, value: unknown, items: readonly (readonly [string, string])[], change: (value: string) => void) => <label key={label} className="csettings-field">{label}<select value={valueText(value)} disabled={!editing} onChange={event => change(event.target.value)}>{items.map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>;
  const rowButtons = (index: number, length: number, move: (direction: number) => void, remove?: () => void) => <div className="ccat-actions">
    <button type="button" className="ccat-button ccat-secondary" disabled={!editing || !index} aria-label="تحريك لأعلى" onClick={() => move(-1)}><ArrowUp size={17} /></button>
    <button type="button" className="ccat-button ccat-secondary" disabled={!editing || index === length - 1} aria-label="تحريك لأسفل" onClick={() => move(1)}><ArrowDown size={17} /></button>
    {remove && <button type="button" className="ccat-button ccat-secondary" disabled={!editing} aria-label="إزالة الصف من المسودة" onClick={remove}><Trash2 size={17} /></button>}</div>;
  const identity = record(clinic.identity), theme = record(clinic.theme), content = record(clinic.content), wa = record(clinic.whatsapp);
  const replacePart = (key: string, patch: Record<string, unknown>) => update({ ...clinic, [key]: { ...record(clinic[key]), ...patch } });
  const rows: any[] = Array.isArray(data.costs) ? data.costs : [], medications: any[] = Array.isArray(clinic.medications) ? clinic.medications : [];
  const templates: any[] = Array.isArray(wa.templates) ? wa.templates : [], routes: any[] = Array.isArray(data.routes) ? data.routes : [];
  let logo: ReturnType<typeof parseCloudClinicLogoData> = null;
  if (!hidden && state.selection.target === 'clinicLogo') { try { logo = parseCloudClinicLogoData(source); } catch { /* Incomplete draft is not an image. */ } }
  const selectSection = (key: string) => {
    const current = latest.current;
    if (!common() || current.state.saveStatus !== 'idle') return;
    if (key === 'catalog' || key === 'transfer' || key === 'export' || key === 'whatsapp-manager') {
      if (!current.state.draft && !current.state.pendingOperationId) current.onNavigate?.(key === 'whatsapp-manager' ? 'whatsapp' : key);
      return;
    }
    const next = sections.find(([section]) => section === key)?.[0];
    if (next && (!current.state.draft || targetFor(next) === current.state.selection.target)) current.onSection(next);
  };
  const navigationItems: SettingsNavigationSection[] = [
    { key: 'identity', label: 'الهوية والمظهر', description: 'بيانات العيادة والشعار والألوان', group: 'appearance', icon: <Palette size={20} /> },
    { key: 'content', label: 'المحتوى والترتيب', description: 'ترتيب الشريط وحجمه ونصوص الرئيسية', group: 'appearance', icon: <Layout size={20} /> },
    ...(props.onNavigate ? [{ key: 'catalog', label: 'الخدمات والأسعار', description: 'قيمة الكشف وأسعار خدمات المرضى', group: 'practice', icon: <Sliders size={20} /> }] : []),
    { key: 'labs', label: 'المعامل وأسعارها', description: 'تكلفة كل معمل بشكل مستقل', group: 'practice', icon: <Building2 size={20} /> },
    { key: 'routing', label: 'توجيه التركيبات', description: 'المعمل الافتراضي لكل خدمة', group: 'practice', icon: <Route size={20} /> },
    { key: 'medications', label: 'فهرس الأدوية', description: 'الأدوية المستخدمة في الروشتة', group: 'practice', icon: <Pill size={20} /> },
    ...(props.onNavigate ? [{ key: 'whatsapp-manager', label: 'إدارة واتساب', description: 'جهات الاتصال والرسائل والحملات', group: 'practice', icon: <MessageCircle size={20} /> }] : []),
    { key: 'whatsapp', label: 'قوالب واتساب', description: 'النصوص الجاهزة وبيانات التواصل', group: 'practice', icon: <MessageCircle size={20} /> },
    ...(props.onNavigate ? [
      { key: 'transfer', label: 'الاستيراد', description: 'ملفات المرضى وجهات الاتصال', group: 'data', icon: <FileSpreadsheet size={20} /> },
      { key: 'export', label: 'التصدير', description: 'دليل الأرقام والبيانات التشغيلية', group: 'data', icon: <Download size={20} /> },
    ] : []),
  ].map(item => ({ ...item, disabled: !!draft && (!sections.some(([key]) => key === item.key) || targetFor(item.key as CloudClinicSettingsSection) !== state.selection.target) }));
  return <section className="cloud-catalog-workspace cloud-clinic-settings" dir="rtl" aria-labelledby={`${prefix}-title`}>
    <header className="ccat-surface ccat-header"><div className="ccat-heading"><span className="ccat-heading-icon"><Settings2 aria-hidden="true" /></span><div><h2 id={`${prefix}-title`}>لوحة التحكم والإعدادات</h2><p>إعدادات العيادة، الخدمات والتواصل — محفوظة في حسابك السحابي.</p></div></div>
      <button type="button" className="ccat-button ccat-secondary" disabled={props.disabled || !hidden && (busy(state) || !!draft || !!state.pendingOperationId)} onClick={() => { const current = latest.current;
        if (!current.disabled && (current.previewOnly || current.state.closed || common() && !current.state.draft && !current.state.pendingOperationId)) current.onClose(); }}><ArrowRight size={18} />إلغاء وإغلاق</button></header>
    <div className="csettings-layout"><SettingsSectionNavigation sections={navigationItems} groups={[{ key: 'appearance', label: 'مظهر العيادة' }, { key: 'practice', label: 'الخدمات والتواصل' }, { key: 'data', label: 'البيانات والنظام' }]}
      activeSection={section === 'appearance' || section === 'logo' ? 'identity' : section} disabled={hidden || busy(state) || state.saveStatus !== 'idle'} onSelect={selectSection} />
    <div className="csettings-content settings-content-panel">
      {['identity', 'appearance', 'logo'].includes(section) && <div className="csettings-identity-tabs" role="group" aria-label="الهوية والمظهر">
        {([['identity', 'بيانات العيادة'], ['appearance', 'الألوان والخط'], ['logo', 'الشعار']] as const).map(([key, label]) => <button type="button" className={`ccat-button ${section === key ? 'ccat-primary' : 'ccat-secondary'}`} key={key} aria-pressed={section === key}
          disabled={hidden || busy(state) || state.saveStatus !== 'idle' || !!draft && targetFor(key) !== state.selection.target} onClick={() => selectSection(key)}>{label}</button>)}
      </div>}
    {hidden ? <p className="ccat-message ccat-warning">{props.previewOnly ? 'معاينة فارغة فقط — لا قراءة أو حفظ أو إعدادات افتراضية.' : 'أُغلقت مساحة الإعدادات وأُخفيت بياناتها.'}</p>
      : <><div className="ccat-actions"><button type="button" className="ccat-button ccat-secondary" disabled={disabled || !!draft} onClick={() => { if (common() && !latest.current.state.draft && latest.current.state.saveStatus === 'idle') latest.current.onLoad(); }}><RefreshCw size={18} />تحميل / تحديث القسم</button>
        <button type="button" className="ccat-button ccat-primary" disabled={disabled || !state.loaded || !!draft || targetFor(section) !== state.selection.target} onClick={() => { if (common() && !latest.current.state.draft && latest.current.state.loaded && latest.current.state.saveStatus === 'idle' && targetFor(latest.current.section) === latest.current.state.selection.target) latest.current.onBegin(); }}><Pencil size={18} />{state.snapshot ? 'تعديل القسم' : 'إعداد القسم صراحة'}</button>
        <span className="ccat-help">{state.snapshot ? `الإصدار ${state.snapshot.revision.toLocaleString('ar-EG')}` : state.loaded ? 'لا توجد نسخة محفوظة' : 'القسم لم يُحمّل بعد'}</span></div>
        {state.error && <p className="ccat-message ccat-error" role="alert">{state.error}</p>}{state.notice && <p className="ccat-message ccat-info" role="status">{state.notice}</p>}
        {state.saveStatus !== 'idle' && <section className="ccat-message ccat-warning"><strong>{state.saveStatus === 'refresh-required' ? 'الحفظ مؤكد — التحديث بالقراءة فقط' : 'العملية الأصلية ثابتة حتى تأكيدها'}</strong>
          <bdi dir="ltr" className="ccat-operation">{state.pendingOperationId}</bdi><div className="ccat-actions"><button type="button" className="ccat-button ccat-primary" disabled={busy(state)} onClick={() => { if (common() && ['retry-required', 'refresh-required'].includes(latest.current.state.saveStatus)) latest.current.onRetry(); }}>إعادة التحقق</button>
            {state.saveStatus === 'retry-required' && <button type="button" className="ccat-button ccat-secondary" disabled={busy(state)} onClick={() => { if (common() && latest.current.state.saveStatus === 'retry-required') latest.current.onCancelPending(); }}>التحقق من الإلغاء</button>}</div></section>}
        {!state.loaded && <p className="ccat-help" role={state.loading ? 'status' : undefined}>{state.loading ? 'جارٍ تحميل إعدادات القسم من حسابك…' : 'اضغط تحميل القسم لقراءة إعداداته المحفوظة.'}</p>}
        {(state.loaded || section === 'labs') && <div className="ccat-surface csettings-editor">
          {section === 'identity' && <><h3>بيانات العيادة والتواصل</h3><div className="csettings-grid">{field('اسم العيادة', identity.clinicName, value => replacePart('identity', { clinicName: value }), false, { max: 100 })}
            {field('اسم الطبيب', identity.doctorName, value => replacePart('identity', { doctorName: value }), false, { max: 100 })}
            {field('هاتف دولي بأرقام فقط، مثل 201…', identity.phone, value => replacePart('identity', { phone: value }), false, { inputMode: 'tel', max: 15 })}
            {field('العنوان', identity.address, value => replacePart('identity', { address: value }), true, { max: 400 })}</div>
            {check('استخدام الشعار المحفوظ في هوية العيادة', identity.logoRecordId !== null && identity.logoRecordId !== undefined, value => replacePart('identity', { logoRecordId: value ? 'clinicLogo' : null }))}<p className="ccat-help">احفظ الشعار أولًا من قسم الشعار؛ لا رابط صورة خارجي أو تكلفة معمل هنا.</p></>}
          {section === 'appearance' && <><h3>الألوان والخط</h3><div className="ccat-actions">{[['أزرق', '#2563eb', '#1d4ed8', '#f59e0b', '#f8fafc'], ['زمردي', '#059669', '#047857', '#10b981', '#f0fdf4']].map(([label, primary, secondary, accent, background]) => <button key={label} type="button" disabled={!editing} className="ccat-button ccat-secondary" onClick={() => replacePart('theme', { primary, secondary, accent, background, fontFamily: "'Cairo', sans-serif", customFontUrl: null })}><Palette size={17} />اختيار {label} وخط القاهرة</button>)}</div>
            <div className="csettings-grid">{(['primary', 'secondary', 'accent', 'background'] as const).map((key, index) => <label className="csettings-field" key={key}>{['اللون الأساسي', 'اللون المساند', 'لون التمييز', 'الخلفية'][index]}<input type="text" dir="ltr" maxLength={7} disabled={!editing} value={valueText(theme[key])} placeholder="#2563eb" onChange={event => replacePart('theme', { [key]: event.target.value })} /></label>)}
              {field('عائلة الخط', theme.fontFamily, value => replacePart('theme', { fontFamily: value }), false, { max: 200 })}{field('رابط Google Fonts الاختياري', theme.customFontUrl, value => replacePart('theme', { customFontUrl: value || null }), false, { max: 1000 })}</div>
            <div className="csettings-brand-preview" style={{ color: /^#[0-9a-f]{6}$/.test(theme.primary ?? '') ? theme.primary : undefined, background: /^#[0-9a-f]{6}$/.test(theme.background ?? '') ? theme.background : undefined }}><strong>{identity.clinicName || 'معاينة اسم العيادة'}</strong><span>معاينة الألوان فقط؛ لا تُطبَّق قبل تأكيد الحفظ.</span></div></>}
          {section === 'content' && <><h3>المحتوى وترتيب الشريط</h3><button type="button" className="ccat-button ccat-secondary" disabled={!editing} onClick={() => replacePart('content', {
            navigationLabels: { ...labels }, tiles: Object.fromEntries(navigation.map(key => [key, { title: labels[key], desc: '' }])), tabs: { info: 'البيانات', chart: 'الأسنان', sessions: 'الجلسات', finance: 'الحساب', lab: 'المعمل' } })}>تطبيق تسميات عربية مقترحة في المسودة</button>
            <div className="csettings-grid">{field('الوصف المحفوظ للرئيسية', content.homeSubtitle, value => replacePart('content', { homeSubtitle: value }), false, { max: 180 })}{field('النص المساعد', content.welcomeText, value => replacePart('content', { welcomeText: value }), false, { max: 180 })}</div>
            <div className="csettings-identity-tabs" role="tablist" aria-label="إعدادات العرض حسب الجهاز">{(['mobile', 'desktop'] as const).map(device => <button type="button" role="tab" key={device} aria-selected={contentDevice === device} className={`ccat-button ${contentDevice === device ? 'ccat-primary' : 'ccat-secondary'}`}
              disabled={disabled} onClick={() => { if (common() && latest.current.state.saveStatus === 'idle') setContentDevice(device); }}>{device === 'mobile' ? 'إعدادات الموبايل' : 'إعدادات الكمبيوتر'}</button>)}</div>
            {([contentDevice] as const).map(device => { const preferences = record(content[device]), order: string[] = Array.isArray(preferences.order) ? preferences.order : [];
              const change = (patch: any) => replacePart('content', { [device]: { ...preferences, ...patch } });
              return <fieldset className="csettings-fieldset" key={device}><legend>{device === 'mobile' ? 'شريط الموبايل' : 'شريط الكمبيوتر'}</legend><div className="csettings-grid">{choice('الحجم', preferences.size, [['compact', 'صغير'], ['comfortable', 'مريح'], ['large', 'كبير']], value => change({ size: value }))}
                {check('إظهار المسميات', preferences.showLabels, value => change({ showLabels: value }))}{device === 'mobile' && choice('عدد الروابط المباشرة', String(preferences.visibleCount ?? ''), [['3', '٣'], ['4', '٤']], value => change({ visibleCount: Number(value) }))}</div>
                {order.map((key, index) => <div className="csettings-order-row" key={key}><span>{labels[key as keyof typeof labels] ?? key}</span>{rowButtons(index, order.length, direction => { const moved = [...order]; [moved[index], moved[index + direction]] = [moved[index + direction], moved[index]]; change({ order: moved }); })}
                  {device === 'mobile' && check('في المزيد', preferences.moreSections?.includes(key), checked => change({ moreSections: checked ? [...preferences.moreSections, key] : preferences.moreSections.filter((value: string) => value !== key) }))}</div>)}</fieldset>;
            })}<div className="csettings-grid">{(['home', ...navigation] as const).map(key => field(`مسمى ${labels[key]}`, record(content.navigationLabels)[key], value => replacePart('content', { navigationLabels: { ...record(content.navigationLabels), [key]: value } }), false, { max: 80 }))}</div>
            <details><summary>وصف الأقسام وتسميات ملف المريض وترتيب الرئيسية</summary><div className="csettings-grid">{navigation.map(key => <React.Fragment key={key}>{field(`عنوان بطاقة ${labels[key]}`, record(record(content.tiles)[key]).title, value => replacePart('content', { tiles: { ...record(content.tiles), [key]: { ...record(record(content.tiles)[key]), title: value } } }), false, { max: 80 })}
              {field(`وصف ${labels[key]}`, record(record(content.tiles)[key]).desc, value => replacePart('content', { tiles: { ...record(content.tiles), [key]: { ...record(record(content.tiles)[key]), desc: value } } }), true, { max: 400 })}</React.Fragment>)}
              {Object.keys(record(content.tabs)).map(key => field(`تبويب ${key}`, record(content.tabs)[key], value => replacePart('content', { tabs: { ...record(content.tabs), [key]: value } }), false, { max: 80 }))}</div>
              {(record(content.homeLayout).sectionOrder ?? []).map((key: string, index: number, order: string[]) => <div className="csettings-order-row" key={key}><span>{{ actions: 'إجراءات اليوم', metrics: 'المؤشرات', schedule: 'المواعيد', followUp: 'المتابعة' }[key] ?? key}</span>
                {rowButtons(index, order.length, direction => { const moved = [...order]; [moved[index], moved[index + direction]] = [moved[index + direction], moved[index]]; replacePart('content', { homeLayout: { ...record(content.homeLayout), sectionOrder: moved } }); })}
                {check('إخفاء من الرئيسية', record(content.homeLayout).hiddenSections?.includes(key), checked => replacePart('content', { homeLayout: { ...record(content.homeLayout), hiddenSections: checked ? [...record(content.homeLayout).hiddenSections, key] : record(content.homeLayout).hiddenSections.filter((value: string) => value !== key) } }))}</div>)}
              {choice('كثافة الرئيسية', record(content.homeLayout).density, [['comfortable', 'مريحة'], ['compact', 'مختصرة']], value => replacePart('content', { homeLayout: { ...record(content.homeLayout), density: value } }))}
              {choice('عدد المواعيد الظاهرة', String(record(content.homeLayout).appointmentLimit ?? ''), [['3', '٣'], ['6', '٦'], ['10', '١٠']], value => replacePart('content', { homeLayout: { ...record(content.homeLayout), appointmentLimit: Number(value) } }))}</details></>}
          {section === 'medications' && <><h3>فهرس الأدوية</h3><p className="ccat-help">الجرعات نصوص الطبيب الاختيارية وليست توصية طبية أو وصفة تلقائية.</p>{medications.map((row, index) => <fieldset className="csettings-fieldset" key={row.medicationId}><legend>{row.name || 'دواء جديد'}</legend>
            <div className="csettings-grid">{(['name', 'category', 'defaultDosage', 'defaultDuration'] as const).map((key, position) => field(['اسم الدواء', 'التصنيف', 'الجرعة الاختيارية', 'المدة الاختيارية'][position], row[key], value => update({ ...clinic, medications: medications.map((current, i) => i === index ? { ...current, [key]: value } : current) }), key === 'defaultDosage', { max: [160, 80, 500, 200][position] }))}</div>
            {check('متاح للاختيار', row.active, value => update({ ...clinic, medications: medications.map((current, i) => i === index ? { ...current, active: value } : current) }))}<button type="button" className="ccat-button ccat-secondary" disabled={!editing} onClick={() => update({ ...clinic, medications: medications.filter((_, i) => i !== index) })}><Trash2 size={17} />إزالة من الفهرس</button></fieldset>)}
            <button type="button" className="ccat-button ccat-secondary" disabled={!editing || medications.length >= 300} onClick={() => edit((current, expected) => current.onAddId(id => ({ ...clinic, medications: [...medications, { medicationId: id, name: '', category: '', defaultDosage: '', defaultDuration: '', active: true }] }), expected))}><Plus size={17} />إضافة دواء</button></>}
          {section === 'whatsapp' && <><h3>قوالب واتساب والإعدادات اليدوية</h3><p className="ccat-message ccat-info">حفظ القوالب أو تفضيلات التذكير لا يربط API ولا يرسل رسائل تلقائيًا. الإرسال اليدوي يفتح واتساب للمراجعة؛ موافقة الحملات لا تُستنتج من وجود رقم أو ملف.</p>
            {field('رقم الإرسال الدولي الاختياري', wa.senderNumber, value => replacePart('whatsapp', { senderNumber: value }), false, { max: 15, inputMode: 'tel' })}
            <details><summary>تفضيلات مستقبلية — غير مفعّلة دون مزوّد</summary>{check('تأكيد الموعد عند الربط مستقبلًا', wa.autoConfirmOnAppt, value => replacePart('whatsapp', { autoConfirmOnAppt: value }))}
              {check('تذكير قبل ٢٤ ساعة عند الربط', wa.autoRemind24h, value => replacePart('whatsapp', { autoRemind24h: value }))}{check('تعليمات بعد الحضور عند الربط', wa.autoPostOpOnAttended, value => replacePart('whatsapp', { autoPostOpOnAttended: value }))}</details>
            {templates.map((row, index) => { const change = (patch: any) => replacePart('whatsapp', { templates: templates.map((value, i) => i === index ? { ...value, ...patch } : value) });
              return <fieldset className="csettings-fieldset" key={row.templateId}><legend>{row.title || 'قالب جديد'}</legend>{field('عنوان القالب', row.title, value => change({ title: value }), false, { max: 80 })}
                {choice('استخدام القالب', row.key, [['custom', 'مخصص'], ['reminderTomorrow', 'تذكير الموعد'], ['newAppt', 'تأكيد الحجز'], ['postOp', 'بعد الجلسة'], ['accountBalance', 'الحساب'], ['greeting', 'معايدة'], ['offer', 'عرض'], ['extraction', 'تعليمات الخلع'], ['filling', 'تعليمات الحشو'], ['rootCanal', 'تعليمات العصب']], value => change({ key: value }))}
                {field('نص القالب', row.text, value => change({ text: value }), true)}<p className="ccat-help">متغيرات جاهزة: {'{patientName} · {clinicName} · {date} · {time} · {balance}'} 🌷</p>
                <button type="button" className="ccat-button ccat-secondary" disabled={!editing} onClick={() => replacePart('whatsapp', { templates: templates.filter((_, i) => i !== index) })}><Trash2 size={17} />إزالة القالب</button></fieldset>;
            })}<button type="button" className="ccat-button ccat-secondary" disabled={!editing || templates.length >= 60} onClick={() => edit((current, expected) => current.onAddId(id => ({ ...clinic, whatsapp: { ...wa, templates: [...templates, { templateId: id, key: 'custom', title: '', text: '' }] } }), expected))}><Plus size={17} />إضافة قالب</button></>}
          {section === 'labs' && <><h3>المعامل وتسعير التكلفة الخاص بالمالك</h3><div className="ccat-actions"><button type="button" className="ccat-button ccat-secondary" disabled={disabled || !!draft} onClick={() => { if (common() && !latest.current.state.draft) latest.current.onLabs(false); }}><Building2 size={17} />تحميل المعامل</button>
            <button type="button" className="ccat-button ccat-secondary" disabled={disabled || !!draft} onClick={() => { if (common() && !latest.current.state.draft) latest.current.onNewLab(); }}><Plus size={17} />معمل جديد</button></div>
            <div className="csettings-labs">{state.labs.map(lab => <button type="button" className="ccat-button ccat-secondary" key={lab.recordId} disabled={disabled || !!draft} onClick={() => { if (common() && !latest.current.state.draft) latest.current.onSelectLab(lab.recordId); }}>{lab.data.name}</button>)}</div>
            {state.labsNextAfterId && <button type="button" className="ccat-button ccat-secondary" disabled={disabled || !!draft} onClick={() => { if (common() && !latest.current.state.draft) latest.current.onLabs(true); }}>المعامل التالية</button>}
            {state.selection.target === 'lab' && <><div className="csettings-grid">{field('اسم المعمل', data.name, value => update({ ...data, name: value }), false, { max: 100 })}{field('الهاتف الدولي', data.phone, value => update({ ...data, phone: value }), false, { max: 15, inputMode: 'tel' })}
              {field('العنوان', data.address, value => update({ ...data, address: value }), true, { max: 400 })}{field('ملاحظات خاصة', data.notes, value => update({ ...data, notes: value }), true, { max: 2000 })}</div>{check('المعمل نشط', data.active, value => update({ ...data, active: value }))}
              {rows.map((row, index) => { const change = (patch: any) => update({ ...data, costs: rows.map((value, i) => i === index ? { ...value, ...patch } : value) });
                return <fieldset className="csettings-fieldset" key={row.materialId}><legend>{row.name || 'خدمة معمل جديدة'}</legend><div className="csettings-grid">{field('اسم المادة / الخدمة', row.name, value => change({ name: value }), false, { max: 80 })}
                  {field('تكلفة المعمل بالجنيه — الفارغ مجهول', moneyText(row.unitCostCents), value => change({ unitCostCents: value }), false, { max: 32, inputMode: 'decimal' })}
                  {choice('التصنيف', row.category, [['fixed', 'ثابت'], ['removable', 'متحرك'], ['other', 'أخرى']], value => change({ category: value }))}
                  {choice('طريقة حساب التكلفة', row.billingBasis, [['per-unit', 'لكل تاج / وحدة'], ['whole-case', 'للحالة كاملة']], value => change({ billingBasis: value }))}{field('اسم الوحدة', row.unitLabel, value => change({ unitLabel: value }), false, { max: 40 })}</div>
                  {check('متاحة للتوجيه', row.active, value => change({ active: value }))}<button type="button" className="ccat-button ccat-secondary" disabled={!editing} onClick={() => update({ ...data, costs: rows.filter((_, i) => i !== index) })}><Trash2 size={17} />إزالة المادة من المسودة</button></fieldset>;
              })}<button type="button" className="ccat-button ccat-secondary" disabled={!editing || rows.length >= 100} onClick={() => edit((current, expected) => current.onAddId(id => ({ ...data, costs: [...rows, { materialId: id, name: '', category: 'fixed', unitLabel: '', billingBasis: 'per-unit', unitCostCents: null, active: true }] }), expected))}><Plus size={17} />إضافة سعر خاص بالمعمل</button>
              <p className="ccat-help">هذه تكلفة المعمل فقط؛ أسعار المريض والكشف من قسم الخدمات والأسعار. لا يمكن إزالة مادة مرتبطة بتوجيه نشط قبل تعديل التوجيه.</p></>}</>}
          {section === 'routing' && <><h3>المعمل الافتراضي لكل خدمة تركيبات</h3><button type="button" className="ccat-button ccat-secondary" disabled={disabled || !!draft} onClick={() => { if (common() && !latest.current.state.draft) latest.current.onReferences(); }}>تحميل الخدمات والمعامل للتوجيه</button>
            <p className="ccat-help">حمّل الاختيارات قبل بدء التعديل. الربط يعاد فحصه عند الحفظ؛ لا اختيار معمل أو تكلفة بالتخمين.</p>{routes.map((row, index) => { const change = (patch: any) => update({ ...data, routes: routes.map((value, i) => i === index ? { ...value, ...patch } : value) });
              const lab = state.labs.find(lab => lab.recordId === row.labId);
              return <fieldset className="csettings-fieldset" key={index}><legend>توجيه {index + 1}</legend><div className="csettings-grid">
                {choice('خدمة المريض', row.serviceId, [['', 'اختر الخدمة'], ...(state.catalog?.data.services.filter(service => service.active && service.kind === 'prosthetic').map(service => [service.serviceId, service.name] as const) ?? [])], value => change({ serviceId: value }))}
                {choice('المعمل', row.labId, [['', 'اختر المعمل'], ...state.labs.filter(lab => lab.data.active).map(lab => [lab.recordId, lab.data.name] as const)], value => change({ labId: value, materialId: '' }))}
                {choice('مادة / خدمة المعمل', row.materialId, [['', 'اختر المادة'], ...(lab?.data.costs.filter(cost => cost.active).map(cost => [cost.materialId, `${cost.name} — ${cost.billingBasis === 'whole-case' ? 'للحالة' : 'للوحدة'}`] as const) ?? [])], value => change({ materialId: value }))}</div>
                <button type="button" className="ccat-button ccat-secondary" disabled={!editing} onClick={() => update({ ...data, routes: routes.filter((_, i) => i !== index) })}><Trash2 size={17} />إزالة التوجيه</button></fieldset>;
            })}<button type="button" className="ccat-button ccat-secondary" disabled={!editing || !state.referencesLoaded || routes.length >= 100} onClick={() => update({ ...data, routes: [...routes, { serviceId: '', labId: '', materialId: '' }] })}><Plus size={17} />توجيه جديد</button></>}
          {section === 'logo' && <><h3>شعار العيادة</h3><p className="ccat-help">PNG أو JPEG حتى٤٨KiB، وأبعاد حتى٢٠٤٨px. سجل محمي منفصل لا يُحمّل مع التقارير. احفظه ثم فعّله من بيانات العيادة.</p>
            {logo?.base64 && <img className="csettings-logo" src={`data:${logo.mimeType};base64,${logo.base64}`} alt="الشعار المقروء أو مسودته" />}
            <label className="ccat-button ccat-secondary"><ImagePlus size={17} />اختيار شعار<input type="file" accept="image/png,image/jpeg" disabled={!editing} onChange={event => { const file = event.target.files?.[0]; if (file) edit((current, expected) => current.onLogo(file, expected)); event.target.value = ''; }} /></label>
            <button type="button" className="ccat-button ccat-secondary" disabled={!editing} onClick={() => update(null)}>إزالة محتوى الشعار</button><p className="ccat-help">ألغِ ربطه ببيانات العيادة أولًا؛ إزالة شعار مستخدم تُرفض لحماية الترابط.</p></>}
          {draft && <footer className="csettings-save"><button type="button" className="ccat-button ccat-primary" disabled={!editing || buildCloudSettingsEditorData(draft) === undefined} onClick={() => edit((current, expected) => current.onSave(expected))}><Check size={18} />حفظ القسم</button>
            <button type="button" className="ccat-button ccat-secondary" disabled={!editing} onClick={() => edit((current, expected) => current.onCancel(expected))}><X size={18} />إلغاء المسودة</button>
            {buildCloudSettingsEditorData(draft) === undefined && <p className="ccat-help">أكمل الحقول والروابط المطلوبة. السعر الفارغ مجهول، والصفر يُكتب صراحة.</p>}</footer>}
        </div>}
        <details className="ccat-surface ccat-history csettings-recovery"><summary><History size={18} />استرجاع عمليات الإعدادات</summary><div className="ccat-section-heading"><p className="ccat-help">استخدمه لمتابعة عملية سابقة انقطع تأكيدها، وليس للتعديل اليومي.</p><button type="button" className="ccat-button ccat-secondary" disabled={disabled || !!draft} onClick={() => { if (common() && !latest.current.state.draft && latest.current.state.saveStatus === 'idle') latest.current.onHistory(false); }}>تحميل سجل العمليات</button></div>
          {state.history.map(intent => <article className="ccat-history-row" key={intent.operationId}><div><strong>{intent.status === 'prepared' ? 'محضرة' : intent.status === 'committed' ? 'منفذة — يمكن إعادة التحقق' : 'ملغاة'}</strong><time dateTime={intent.createdAt}>{intent.createdAt}</time><bdi dir="ltr" className="ccat-operation">{intent.operationId}</bdi></div>
            <button type="button" className="ccat-button ccat-secondary" disabled={disabled || !!draft || intent.status === 'cancelled'} onClick={() => { if (common() && !latest.current.state.draft && latest.current.state.saveStatus === 'idle' && latest.current.state.history.includes(intent) && intent.status !== 'cancelled') latest.current.onResume(intent); }}>متابعة نفس العملية</button></article>)}
          <p className="ccat-help">السجل المحمّل بترتيب المعرّف، وليس ترتيب الأحدث عالميًا. الاسترجاع لا ينشئ تعديلًا بديلًا ولا يعيد إعدادات تاريخية فوق الحالية.</p>{state.historyNextAfterId && <button type="button" className="ccat-button ccat-secondary" disabled={disabled || !!draft} onClick={() => { if (common() && !latest.current.state.draft && latest.current.state.saveStatus === 'idle') latest.current.onHistory(true); }}>المزيد من العمليات</button>}</details></>}
    </div></div>
  </section>;
}

/** Root supplies the exact owner/view lease controller and owns its disposal. */
export default function CloudClinicSettingsWorkspace({ controller, onClose, onNavigate, previewOnly = false, disabled = false }: {
  controller: CloudClinicSettingsWorkspaceController; onClose(): void; onNavigate?(section: string): void; previewOnly?: boolean; disabled?: boolean;
}) {
  const state = useSyncExternalStore(useCallback(notify => controller.subscribe(notify), [controller]), controller.getState, controller.getState);
  const [section, setSection] = useState<CloudClinicSettingsSection>('identity'), [uploadError, setUploadError] = useState('');
  const latest = useRef({ controller, previewOnly, disabled, onClose, onNavigate, section }); latest.current = { controller, previewOnly, disabled, onClose, onNavigate, section };
  const permitted = (expected?: CloudClinicSettingsWorkspaceDraft) => { const current = latest.current, state = current.controller.getState();
    return latest.current === current && current.controller === controller && !current.disabled && !current.previewOnly && !state.closed && !busy(state) && state.saveStatus === 'idle'
      && (expected === undefined || state.draft === expected); };
  const update = (data: unknown, expected: CloudClinicSettingsWorkspaceDraft) => { if (permitted(expected)) controller.updateDraft(data, expected); };
  return <>{uploadError && !previewOnly && !state.closed && <p role="alert" className="ccat-message ccat-error">{uploadError}</p>}<CloudClinicSettingsWorkspaceView state={state} section={section} previewOnly={previewOnly} disabled={disabled}
    onNavigate={onNavigate ? next => { if (permitted() && controller.canClose()) latest.current.onNavigate?.(next); } : undefined}
    onSection={next => { if (!permitted()) return; const current = controller.getState(), target = targetFor(next); if (current.draft && target !== current.selection.target) return;
      setSection(next); setUploadError(''); if (target !== current.selection.target && target !== 'lab') void controller.load(target); }}
    onClose={() => { const lease = latest.current; if (lease.disabled || lease.controller !== controller) return;
      const allowed = lease.previewOnly || controller.canClose(); if (latest.current === lease && allowed) lease.onClose(); }}
    onLoad={() => { if (!permitted() || controller.getState().draft || latest.current.section !== section) return; const target = targetFor(section); if (target === 'lab') void controller.loadLabs(); else void controller.load(target); }}
    onBegin={() => { if (!permitted() || latest.current.section !== section || targetFor(section) !== controller.getState().selection.target || !controller.beginEdit()) return; const draft = controller.getState().draft!;
      if (draft.data === null && draft.target !== 'clinicLogo') update(draft.target === 'clinicSettings' ? emptyCloudClinicSettingsEditor() : draft.target === 'lab' ? emptyLab() : { routes: [] }, draft); }}
    onUpdate={update} onSave={expected => { if (!permitted(expected)) return; const data = buildCloudSettingsEditorData(expected); if (data === undefined) return;
      if (controller.updateDraft(data, expected)) void controller.save(controller.getState().draft); }}
    onCancel={expected => { if (permitted(expected)) controller.cancelDraft(expected); }}
    onRetry={() => { const current = controller.getState(); if (!latest.current.disabled && !latest.current.previewOnly && latest.current.controller === controller && !current.closed && !busy(current) && ['retry-required', 'refresh-required'].includes(current.saveStatus)) void controller.retry(); }}
    onCancelPending={() => { const current = controller.getState(); if (!latest.current.disabled && !latest.current.previewOnly && latest.current.controller === controller && !current.closed && !busy(current) && current.saveStatus === 'retry-required') void controller.cancelPending(); }}
    onHistory={more => { if (permitted() && !controller.getState().draft) void (more ? controller.loadMoreHistory() : controller.loadHistory()); }}
    onResume={intent => { if (permitted() && !controller.getState().draft && controller.getState().history.includes(intent) && intent.status !== 'cancelled') void controller.resume(intent.operationId); }}
    onLabs={more => { if (permitted() && !controller.getState().draft) void (more ? controller.loadMoreLabs() : controller.loadLabs()); }}
    onSelectLab={id => { if (permitted() && !controller.getState().draft && controller.getState().labs.some(lab => lab.recordId === id)) void controller.load('lab', id); }}
    onNewLab={async () => { if (!permitted() || controller.getState().draft) return; const id = crypto.randomUUID(); if (!permitted() || !await controller.load('lab', id) || !permitted()) return;
      if (controller.beginEdit()) update(emptyLab(), controller.getState().draft!); }}
    onReferences={() => { if (permitted() && !controller.getState().draft) void controller.loadRoutingReferences(); }}
    onAddId={(work, expected) => { if (!permitted(expected)) return; const id = crypto.randomUUID(); if (permitted(expected)) update(work(id), expected); }}
    onLogo={async (file, expected) => {
      if (!permitted(expected)) return; setUploadError('');
      try {
        if (!['image/png', 'image/jpeg'].includes(file.type) || file.size < 1 || file.size > MAX_CLOUD_CLINIC_LOGO_BYTES) throw new Error();
        const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error()); reader.onerror = reject; reader.readAsDataURL(file); });
        if (!permitted(expected)) return;
        const image = new Image(); image.src = dataUrl; await image.decode(); if (!permitted(expected)) return;
        const data = parseCloudClinicLogoData({ mimeType: file.type, base64: dataUrl.split(',')[1], width: image.naturalWidth, height: image.naturalHeight }); update(data, expected);
      } catch { if (permitted(expected)) setUploadError('تعذر قراءة شعار صالح ضمن الحد. اختر PNG أو JPEG حتى٤٨KiB وأبعاد حتى٢٠٤٨px.'); }
    }} /></>;
}
