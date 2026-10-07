import React, { useEffect, useRef, useState } from 'react';
import { Appointment, Patient, ClinicContact, WhatsappSettings } from '../../types';
import { Clipboard, ContactRound, ExternalLink, FileText, ImagePlus, Info, LockKeyhole, Megaphone, MessageCircle, Plug, Save, Search, Send, X } from 'lucide-react';
import { cleanEgyptianPhone, extraMessageTemplates, fillMessageTemplate, format12HourAr, formatArabicDate, getWhatsAppUrl } from '../../utils/whatsappUtils';
import { getPatientFinancialSummary } from '../../utils/financials';
import { localDateISO } from '../appointments/appointmentScheduling';
import { WhatsAppCampaigns } from './WhatsAppCampaigns';
import { ClinicContacts } from './ClinicContacts';
import { prepareFreshWhatsAppAction, type WhatsAppSendAuthorization } from '../../utils/whatsappSafety';
import { Storage } from '../../utils/storage';
import { useToastAndConfirm } from '../common/ToastAndConfirm';
import { useConfirmedAction } from '../common/useConfirmedAction';
import './WhatsAppManagement.css';

interface Props {
  clinicName: string;
  whatsappSettings: WhatsappSettings;
  patients: Patient[];
  contacts: ClinicContact[];
  canManageContacts?: boolean;
  initialSection?: 'templates' | 'campaigns';
  onSaveContact: (contact: ClinicContact, original?: ClinicContact) => void | Promise<void>;
  onDeleteContact: (original: ClinicContact) => void | Promise<void>;
  onAuthorizeSend?: (request: WhatsAppSendAuthorization) => void;
  onOpenPatient?: (patientId: string) => void;
  onSaveWhatsappSettings: (settings: WhatsappSettings) => void | Promise<void>;
  appointments?: Appointment[];
  canViewPatientFinance?: boolean;
}
type TemplateKey = keyof WhatsappSettings['templates'];
type Section = 'templates' | 'individual' | 'contacts' | 'campaigns' | 'connection';
type Category = 'all' | 'appointments' | 'care' | 'campaigns';
const catalog: Array<{ key: TemplateKey; title: string; category: Exclude<Category, 'all'>; description: string; fallback: string }> = [
  { key: 'reminderTomorrow', title: 'تذكير بالموعد', category: 'appointments', description: 'تذكير بموعد المريض، مع التاريخ والوقت.', fallback: 'أهلاً {patientName}، نذكرك بموعدك في {clinicName} يوم {date} الساعة {time}.' },
  { key: 'newAppt', title: 'تأكيد موعد جديد', category: 'appointments', description: 'تأكيد تفاصيل الموعد بعد تسجيله.', fallback: 'أهلاً {patientName}، موعدك في {clinicName} يوم {date} الساعة {time}.' },
  { key: 'accountBalance', title: 'الرصيد المتبقي', category: 'appointments', description: 'رسالة حساب فردية؛ راجع الرقم قبل فتح واتساب.', fallback: 'أهلاً {patientName}، الرصيد المتبقي في حسابك لدى {clinicName} هو {remainingBalance} جنيه.' },
  { key: 'postOp', title: 'تعليمات عامة بعد الجلسة', category: 'care', description: 'نص يراجعه الطبيب حسب حالة المريض.', fallback: 'أهلاً {patientName}، سعدنا بزيارتك لـ{clinicName}.\n[أضف التعليمات المناسبة للحالة]' },
  { key: 'extraction', title: 'تعليمات بعد الخلع', category: 'care', description: 'تعليمات شخصية يراجعها الطبيب قبل الإرسال.', fallback: extraMessageTemplates.extraction.text },
  { key: 'filling', title: 'تعليمات بعد الحشو', category: 'care', description: 'إرشادات الطبيب المناسبة لنوع الحشو والحالة.', fallback: extraMessageTemplates.filling.text },
  { key: 'rootCanal', title: 'تعليمات علاج العصب', category: 'care', description: 'تعليمات الجلسة وتفاصيل موعد المتابعة.', fallback: extraMessageTemplates.rootCanal.text },
  { key: 'greeting', title: 'معايدة', category: 'campaigns', description: 'تحية لطيفة للمناسبات والأعياد، بموافقة المريض.', fallback: extraMessageTemplates.greeting.text },
  { key: 'offer', title: 'عرض أو إعلان', category: 'campaigns', description: 'أخبار العيادة والعروض لمن وافق على الحملات.', fallback: extraMessageTemplates.offer.text },
];
const categories: Array<{ key: Category; title: string }> = [{ key: 'all', title: 'الكل' }, { key: 'appointments', title: 'المواعيد والحساب' }, { key: 'care', title: 'تعليمات المريض' }, { key: 'campaigns', title: 'الحملات' }];
const variables = [{ key: 'patientName', title: 'اسم المريض' }, { key: 'clinicName', title: 'اسم العيادة' }, { key: 'date', title: 'تاريخ الموعد' }, { key: 'time', title: 'وقت الموعد' }, { key: 'fileNo', title: 'رقم الملف' }, { key: 'remainingBalance', title: 'الرصيد المتبقي' }];
const unresolved = (text: string) => Array.from(new Set(text.match(/\{[^{}]+\}/g) || []));
const isDateValid = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day;
};
const isTimeValid = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const normalizeSearch = (value: string) => value.toLowerCase().replace(/[٠-٩۰-۹]/g, digit => String(digit.charCodeAt(0) - (digit <= '٩' ? 0x0660 : 0x06f0)));

export function WhatsAppManagement({ clinicName, whatsappSettings, patients, contacts, canManageContacts = false, initialSection = 'templates', onSaveContact, onDeleteContact, onOpenPatient, onAuthorizeSend, onSaveWhatsappSettings, appointments = [], canViewPatientFinance = false }: Props) {
  const { showToast, askConfirm } = useToastAndConfirm();
  const { saving, run } = useConfirmedAction();
  const [section, setSection] = useState<Section>(initialSection);
  useEffect(() => { setSection(initialSection); }, [initialSection]);
  const [draft, setDraft] = useState<WhatsappSettings>({ ...whatsappSettings });
  const previousSettings = useRef(whatsappSettings);
  useEffect(() => {
    const previous = previousSettings.current as WhatsappSettings;
    setDraft(current => ({ ...whatsappSettings, templates: JSON.stringify(current.templates) === JSON.stringify(previous.templates) ? whatsappSettings.templates : current.templates }));
    previousSettings.current = whatsappSettings;
  }, [whatsappSettings]);
  const [templateKey, setTemplateKey] = useState<TemplateKey>('reminderTomorrow');
  const [category, setCategory] = useState<Category>('all');
  const [templateSearch, setTemplateSearch] = useState('');
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const editorHeadingRef = useRef<HTMLDivElement>(null);
  const [sampleName, setSampleName] = useState('أحمد محمد');
  const [sampleDate, setSampleDate] = useState(() => localDateISO(new Date(Date.now() + 86400000)));
  const [sampleTime, setSampleTime] = useState('17:30');
  const activeTemplate = catalog.find(template => template.key === templateKey)!;
  const templateText = draft.templates[templateKey] ?? activeTemplate.fallback;
  const changed = JSON.stringify(draft.templates) !== JSON.stringify(whatsappSettings.templates);
  const templateQuery = normalizeSearch(templateSearch.trim());
  const filteredTemplates = catalog.filter(template => (category === 'all' || template.category === category) && normalizeSearch(`${template.title} ${template.description}`).includes(templateQuery));
  const selectCategory = (next: Category) => {
    setCategory(next);
    if (next !== 'all' && activeTemplate.category !== next) setTemplateKey(catalog.find(template => template.category === next)!.key);
  };
  const selectTemplate = (key: TemplateKey) => {
    setTemplateKey(key);
    setTemplatePickerOpen(false);
    requestAnimationFrame(() => {
      if (!window.matchMedia('(max-width: 780px)').matches) return;
      const heading = editorHeadingRef.current as HTMLDivElement | null;
      heading?.focus({ preventScroll: true });
      heading?.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    });
  };
  const templateUnknown = unresolved(templateText).filter(token => !variables.some(variable => token === `{${variable.key}}`));
  const templatePreview = fillMessageTemplate(templateText, { patientName: sampleName.trim() || 'اسم المريض', clinicName, date: isDateValid(sampleDate) ? formatArabicDate(sampleDate) : 'تاريخ الموعد', time: isTimeValid(sampleTime) ? format12HourAr(sampleTime) : 'وقت الموعد', fileNo: '٤٠١', remainingBalance: '٥٠٠' });
  const updateTemplate = (value: string) => setDraft(current => ({ ...current, templates: { ...current.templates, [templateKey]: value } }));
  const insertVariable = (key: string) => {
    const editor = editorRef.current as HTMLTextAreaElement | null;
    const start = editor?.selectionStart ?? templateText.length;
    const end = editor?.selectionEnd ?? start;
    const token = `{${key}}`;
    updateTemplate(templateText.slice(0, start) + token + templateText.slice(end));
    requestAnimationFrame(() => { editor?.focus(); editor?.setSelectionRange(start + token.length, start + token.length); });
  };
  const saveTemplates = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!changed) return;
    await run(async () => { await onSaveWhatsappSettings({ ...whatsappSettings, templates: draft.templates }); showToast('تم حفظ الرسائل الجاهزة', 'success'); });
  };
  const copyText = async (text: string) => {
    try { if (!navigator.clipboard?.writeText) throw new Error(); await navigator.clipboard.writeText(text); showToast('تم نسخ النص؛ لم تُرسل رسالة', 'success'); }
    catch { showToast('النسخ غير متاح هنا. حدد النص وانسخه يدويًا.', 'warning'); }
  };

  const [patientSearch, setPatientSearch] = useState('');
  const [patientId, setPatientId] = useState('');
  const [manualKey, setManualKey] = useState<TemplateKey>('reminderTomorrow');
  const [appointmentId, setAppointmentId] = useState('manual');
  const [manualDate, setManualDate] = useState('');
  const [manualTime, setManualTime] = useState('');
  const [manualEdited, setManualEdited] = useState<string | null>(null);
  const [manualLink, setManualLink] = useState('');
  const [manualImage, setManualImage] = useState<File | null>(null);
  const [manualImagePreview, setManualImagePreview] = useState('');
  const individualImageRef = useRef<HTMLInputElement>(null);
  const [individualNotice, setIndividualNotice] = useState('');
  useEffect(() => {
    if (!manualImage) { setManualImagePreview(''); return; }
    const source = URL.createObjectURL(manualImage);
    setManualImagePreview(source);
    return () => URL.revokeObjectURL(source);
  }, [manualImage]);
  useEffect(() => {
    if (!canViewPatientFinance) {
      setManualEdited(null);
      setManualKey(current => current === 'accountBalance' ? 'reminderTomorrow' : current);
      setIndividualNotice('');
    }
  }, [canViewPatientFinance]);
  const patient = patients.find(item => item.id === patientId);
  const patientQuery = normalizeSearch(patientSearch.trim());
  const patientMatches = patients.filter(item => normalizeSearch(`${item.name} ${item.id} ${item.mobile}`).includes(patientQuery)).slice(0, 8);
  const upcoming = patient ? appointments.filter(item => (item.patientId === patient.id || item.fileNo === patient.id) && !['cancelled', 'no_show', 'apologized', 'attended'].includes(item.status) && item.date >= localDateISO()).sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)) : [];
  const appointment = upcoming.find(item => item.id === appointmentId);
  const actualDate = appointment?.date || (appointmentId === 'manual' ? manualDate : '');
  const actualTime = appointment?.time || (appointmentId === 'manual' ? manualTime : '');
  const manualTemplate = catalog.find(item => item.key === manualKey)!;
  const manualStored = draft.templates[manualKey] ?? manualTemplate.fallback;
  const manualRaw = manualKey === 'reminderTomorrow' ? manualStored.replace('غداً {date}', 'يوم {date}') : manualStored;
  const manualValues: Record<string, string> = { patientName: patient?.name || 'اسم المريض', clinicName, fileNo: patient?.id || 'رقم الملف' };
  if (isDateValid(actualDate)) manualValues.date = formatArabicDate(actualDate);
  if (isTimeValid(actualTime)) manualValues.time = format12HourAr(actualTime);
  if (patient && canViewPatientFinance) manualValues.remainingBalance = getPatientFinancialSummary(patient).totalRemaining.toLocaleString('ar-EG');
  const financialTemplate = manualKey === 'accountBalance' || /\{remainingBalance\}/.test(manualRaw);
  const manualText = patient && (!financialTemplate || canViewPatientFinance) ? manualEdited ?? fillMessageTemplate(manualRaw, manualValues) : fillMessageTemplate(manualRaw, manualValues);
  const manualFullText = manualText + (manualLink.trim() ? `\n${manualLink.trim()}` : '');
  let manualLinkValid = !manualLink.trim();
  try { const url = new URL(manualLink.trim()); manualLinkValid = ['https:', 'http:'].includes(url.protocol) && Boolean(url.hostname) && !/\s/.test(manualLink.trim()); } catch { /* The link is optional, but incomplete links are not opened. */ }
  const phone = cleanEgyptianPhone(patient?.mobile || '');
  const validPhone = /^[1-9]\d{7,14}$/.test(phone);
  const hasIncompleteText = unresolved(manualText).length > 0 || /\[[^\]]+\]/.test(manualText);
  const needsAppointment = /\{(?:date|time)\}/.test(manualRaw);
  const appointmentReady = !needsAppointment || (isDateValid(actualDate) && isTimeValid(actualTime));
  const isCampaignTemplate = manualTemplate.category === 'campaigns';
  const hasCampaignConsent = !isCampaignTemplate || draft.campaignConsent?.[phone] === 'allowed';
  const financeAllowed = !financialTemplate || canViewPatientFinance;
  const manualReady = Boolean(patient && validPhone && manualText.trim() && !hasIncompleteText && appointmentReady && hasCampaignConsent && financeAllowed && manualLinkValid);
  const authorizeIndividualAction = () => {
    if (!patient) throw new Error('اختر المريض أولًا.');
    return prepareFreshWhatsAppAction({ templateName: manualKey, rawTemplate: manualRaw, editedText: manualEdited, values: manualValues, phone: patient.mobile,
      canViewPatientFinance, isCampaign: false, link: manualLink, appointmentReady }, Storage.getWhatsappSettingsFresh, onAuthorizeSend);
  };
  const selectPatient = (item: Patient) => { setPatientId(item.id); setPatientSearch(''); setAppointmentId('manual'); setManualDate(''); setManualTime(''); setManualEdited(null); setManualImage(null); setManualLink(''); if (individualImageRef.current) individualImageRef.current.value = ''; setIndividualNotice(''); };
  const clearPatient = () => { setPatientId(''); setManualEdited(null); setAppointmentId('manual'); setManualDate(''); setManualTime(''); setManualLink(''); setManualImage(null); if (individualImageRef.current) individualImageRef.current.value = ''; setIndividualNotice(''); };
  const selectManualTemplate = (key: TemplateKey) => { setManualKey(key); setManualEdited(null); setIndividualNotice(''); };
  const clearIndividualImage = () => { setManualImage(null); if (individualImageRef.current) individualImageRef.current.value = ''; };
  const chatPreview = (text: string, caption: string, recipient?: string, imageSource?: string) => <aside className="wa-message-preview" aria-label="معاينة الرسالة">
    <div className="wa-preview-caption"><span>معاينة الرسالة</span><small>{caption}</small></div>
    <div className="wa-chat-header"><span className="wa-chat-avatar"><MessageCircle size={18} /></span><div><strong>{clinicName}</strong><small>{recipient || 'رسالة من العيادة'}</small></div></div>
    <div className="wa-chat-body"><div className="wa-chat-bubble">{imageSource && <img className="wa-chat-image" src={imageSource} alt="معاينة الصورة المختارة" onError={() => { clearIndividualImage(); setIndividualNotice('تعذّر عرض الصورة. اختر ملف صورة صالحًا.'); }} />}<p>{text.trim() || 'ستظهر معاينة رسالتك هنا.'}</p><span className="wa-chat-time">معاينة فقط</span></div></div>
    <p className="wa-preview-footnote">تظهر معاينة النص هنا، ولا تُرسل أي رسالة من المعاينة.</p>
  </aside>;

  return <section className="wa-management" dir="rtl" aria-labelledby="wa-management-title">
    <header className="wa-management-header"><div className="wa-section-identity"><span className="wa-section-symbol"><MessageCircle size={23} /></span><div><h2 id="wa-management-title">إدارة واتساب</h2><p>جهات اتصالك ورسائلك وحملاتك في مكان واحد.</p></div></div><span className="wa-mode-badge"><ExternalLink size={14} /> الوضع الحالي: فتح يدوي</span></header>
    <nav className="wa-section-navigation wa-five-sections" aria-label="أقسام إدارة واتساب">{[
      { key: 'templates' as const, title: 'مكتبة الرسائل', icon: FileText }, { key: 'individual' as const, title: 'رسالة فردية', icon: Send }, { key: 'contacts' as const, title: 'جهات الاتصال', icon: ContactRound }, { key: 'campaigns' as const, title: 'الحملات', icon: Megaphone }, { key: 'connection' as const, title: 'الربط المستقبلي', icon: Plug },
    ].map(item => <button key={item.key} type="button" aria-pressed={section === item.key} onClick={() => setSection(item.key)}><item.icon size={18} /><span>{item.title}</span></button>)}</nav>

    <div hidden={section !== 'templates'}>
      <form onSubmit={saveTemplates} className={`wa-panel wa-section-content wa-library-panel ${templatePickerOpen ? 'wa-picker-expanded' : ''}`}>
        <fieldset disabled={saving} className="contents"><div className="wa-panel-heading"><div><h3>مكتبة الرسائل الجاهزة</h3><p>ابحث عن الرسالة، عدّل النص، وجرّب معاينته دون إرسال.</p></div><button type="submit" className="wa-button wa-button-primary" disabled={!changed || saving}><Save size={17} /> {saving ? 'جارٍ الحفظ…' : 'حفظ التعديلات'}</button></div>
        <div className="wa-mobile-template-picker"><div><span>الرسالة الحالية</span><strong>{activeTemplate.title}</strong></div><button type="button" className="wa-button wa-button-secondary" aria-expanded={templatePickerOpen} aria-controls="wa-library-search wa-library-categories wa-library-template-results" onClick={() => setTemplatePickerOpen(open => !open)}>{templatePickerOpen ? <><X size={15} /> إغلاق الاختيار</> : 'تغيير الرسالة'}</button></div>
        <div className="wa-library-toolbar" id="wa-library-search"><div className="wa-search-field"><Search size={18} /><input aria-label="بحث الرسائل الجاهزة" value={templateSearch} onChange={event => setTemplateSearch(event.target.value)} placeholder="ابحث عن رسالة أو استخدام…" />{templateSearch && <button type="button" aria-label="مسح بحث الرسائل" onClick={() => setTemplateSearch('')}><X size={16} /></button>}</div><span className="wa-result-count">{filteredTemplates.length.toLocaleString('ar-EG')} رسائل</span></div>
        <div className="wa-category-filters" id="wa-library-categories" aria-label="تصنيف الرسائل">{categories.map(item => <button type="button" key={item.key} aria-pressed={category === item.key} onClick={() => selectCategory(item.key)}>{item.title}</button>)}</div>
        <div className="wa-library-layout"><aside className="wa-library-list" id="wa-library-template-results" aria-label="الرسائل المتاحة">{filteredTemplates.map(item => <button type="button" key={item.key} aria-pressed={templateKey === item.key} onClick={() => selectTemplate(item.key)}><FileText size={17} /><span><strong>{item.title}</strong><small>{item.description}</small></span></button>)}{!filteredTemplates.length && <p className="wa-field-help">لا توجد رسالة مطابقة. غيّر البحث أو التصنيف.</p>}</aside>
          <div className="wa-editor-layout"><div className="wa-template-editor"><div className="wa-editor-heading" ref={editorHeadingRef} tabIndex={-1}><h4>{activeTemplate.title}</h4><p>{activeTemplate.description}</p></div><label htmlFor="wa-template-text" className="wa-field-label">نص الرسالة</label><textarea id="wa-template-text" ref={editorRef} rows={9} value={templateText} onChange={event => updateTemplate(event.target.value)} />
            <div className="wa-editor-meta"><span>{Array.from(templateText).length.toLocaleString('ar-EG')} حرف · {templateText.trim() ? templateText.trim().split(/\s+/).length.toLocaleString('ar-EG') : '٠'} كلمة</span><span>{changed ? 'تعديلات غير محفوظة' : 'لا توجد تعديلات غير محفوظة'}</span></div>
            <div className="wa-variable-section"><h5>بيانات متغيرة داخل الرسالة</h5><p>اضغط لإضافة البيان في مكان مؤشر الكتابة؛ يتبدل عند تجهيز الرسالة للمريض.</p><div className="wa-variable-buttons">{variables.map(item => <button key={item.key} type="button" onClick={() => insertVariable(item.key)}><span>{item.title}</span><code dir="ltr">{`{${item.key}}`}</code></button>)}</div></div>
            {templateUnknown.length > 0 && <p className="wa-inline-notice">متغيرات تحتاج تعديلًا: {templateUnknown.join('، ')}.</p>}
            {activeTemplate.category === 'care' && <p className="wa-context-note"><Info size={16} /> التعليمات الطبية يراجعها الطبيب حسب الحالة قبل الإرسال؛ حفظ القالب لا يعني اعتماده لكل المرضى.</p>}
            <div className="wa-editor-tools"><button type="button" className="wa-button wa-button-secondary" onClick={() => copyText(templatePreview)} disabled={!templatePreview.trim()}><Clipboard size={16} /> نسخ المعاينة</button><button type="button" className="wa-button wa-button-secondary" disabled={templateKey === 'accountBalance' && !canViewPatientFinance} onClick={() => { selectManualTemplate(templateKey); setSection('individual'); }}><Send size={16} /> تجهيز لمريض</button></div>
          </div><div className="wa-preview-workbench"><details className="wa-preview-controls" open><summary>بيانات تجربة المعاينة</summary><label>اسم تجريبي<input value={sampleName} onChange={event => setSampleName(event.target.value)} aria-label="اسم تجريبي للمعاينة" /></label><div className="wa-preview-date-fields"><label>التاريخ<input type="date" value={sampleDate} onChange={event => setSampleDate(event.target.value)} /></label><label>الوقت<input type="time" value={sampleTime} onChange={event => setSampleTime(event.target.value)} /></label></div><p>رقم الملف ٤٠١ والرصيد ٥٠٠ بيانات تجريبية وليست حساب مريض.</p></details>{chatPreview(templatePreview, 'بيانات تجريبية، بدون إرسال')}</div></div>
        </div>
        {changed && <div className="wa-draft-footer"><span>يمكن التنقل بين الرسائل دون فقد التعديلات داخل هذه الصفحة.</span><button type="button" className="wa-button wa-button-plain" onClick={() => askConfirm({ title: 'تجاهل تعديلات الرسائل', message: 'ستعود النصوص إلى آخر نسخة محفوظة. لن تتغير موافقات المرضى.', confirmLabel: 'تجاهل التعديلات', tone: 'warning', onConfirm: () => setDraft(current => ({ ...current, templates: whatsappSettings.templates })) })}>تجاهل التعديلات</button></div>}
        </fieldset></form>
    </div>

    <div hidden={section !== 'individual'} className="wa-panel wa-section-content">
      <div className="wa-panel-heading"><div><h3>تجهيز رسالة فردية</h3><p>اختر المريض والرسالة، راجع البيانات، ثم افتح واتساب بنفسك.</p></div><span className="wa-status-pending"><ExternalLink size={15} /> لا إرسال تلقائي</span></div>
      <div className="wa-individual-layout"><div className="wa-individual-controls"><div className="wa-control-group"><h4><span>١</span> المريض</h4>{patient && <div className="wa-picked-patient"><div><strong>{patient.name}</strong><small>ملف #{patient.id} · <bdi>{patient.mobile}</bdi></small></div><button type="button" aria-label="إلغاء اختيار المريض" onClick={clearPatient}><X size={16} /></button></div>}<div className="wa-search-field"><Search size={17} /><input aria-label="ابحث عن مريض لتجهيز الرسالة" value={patientSearch} onChange={event => setPatientSearch(event.target.value)} placeholder="اسم المريض أو الملف أو الهاتف" /></div>{(!patient || patientSearch) && <div className="wa-patient-options">{patientMatches.map(item => <button key={item.id} type="button" onClick={() => selectPatient(item)}><strong>{item.name}</strong><small>ملف #{item.id} · <bdi>{item.mobile}</bdi></small></button>)}{!patientMatches.length && <p className="wa-field-help">لا توجد نتائج مطابقة.</p>}{patients.length > 8 && !patientQuery && <p className="wa-field-help">ابحث بالاسم أو رقم الملف لإظهار المريض المطلوب.</p>}</div>}</div>
        <div className="wa-control-group"><h4><span>٢</span> الرسالة وبياناتها</h4><label className="wa-field-label" htmlFor="wa-individual-template">الرسالة الجاهزة</label><select id="wa-individual-template" value={manualKey} onChange={event => selectManualTemplate(event.target.value as TemplateKey)}>{catalog.map(item => <option key={item.key} value={item.key} disabled={item.key === 'accountBalance' && !canViewPatientFinance}>{item.title}</option>)}</select>{needsAppointment && <><label className="wa-field-label" htmlFor="wa-individual-appointment">الموعد</label><select id="wa-individual-appointment" value={appointmentId} onChange={event => { setAppointmentId(event.target.value); setManualEdited(null); }}><option value="manual">تحديد التاريخ والوقت يدويًا</option>{upcoming.map(item => <option key={item.id} value={item.id}>{formatArabicDate(item.date)} · {format12HourAr(item.time)}</option>)}</select>{appointmentId === 'manual' && <div className="wa-preview-date-fields"><label>التاريخ<input type="date" value={manualDate} onChange={event => { setManualDate(event.target.value); setManualEdited(null); }} /></label><label>الوقت<input type="time" value={manualTime} onChange={event => { setManualTime(event.target.value); setManualEdited(null); }} /></label></div>}</>}
          {isCampaignTemplate && !hasCampaignConsent && <p className="wa-inline-notice">لا يمكن فتح المعايدات والعروض لهذا الرقم حتى تُسجل موافقة المريض في قسم الحملات.</p>}{!financeAllowed && <p className="wa-inline-notice">هذه الرسالة تحتاج صلاحية الاطلاع على حساب المريض.</p>}
        </div></div><div className="wa-template-editor"><h4>٣. مراجعة النص النهائي</h4><p>تعديل النص هنا يخص هذه الرسالة فقط، ولا يغير القالب المحفوظ.</p><label className="wa-field-label" htmlFor="wa-individual-text">النص الذي سيفتح في واتساب</label><textarea id="wa-individual-text" rows={9} value={manualText} onChange={event => { setManualEdited(event.target.value); setIndividualNotice(''); }} /><div className="wa-editor-meta"><span>{Array.from(manualText).length.toLocaleString('ar-EG')} حرف</span><button type="button" className="wa-inline-action" onClick={() => setManualEdited(null)} disabled={manualEdited === null}>إعادة نص القالب</button></div>
          {!patient && <p className="wa-field-help">اختر المريض لتظهر بياناته بدل بيانات المعاينة.</p>}{patient && !validPhone && <p className="wa-inline-notice">رقم المريض غير صالح لواتساب؛ صححه من ملف المريض.</p>}{hasIncompleteText && <p className="wa-inline-notice">أكمل النص بين الأقواس والمتغيرات قبل فتح واتساب.</p>}{needsAppointment && !appointmentReady && <p className="wa-inline-notice">حدد تاريخًا ووقتًا صالحين للموعد.</p>}
          <label htmlFor="wa-individual-link" className="wa-field-label">رابط اختياري</label><input id="wa-individual-link" type="url" dir="ltr" value={manualLink} placeholder="https://" onChange={event => { setManualLink(event.target.value); setIndividualNotice(''); }} />{!manualLinkValid && <p className="wa-inline-notice">اكتب رابطًا كاملًا يبدأ بـ https:// أو http://.</p>}
          <div className="wa-image-upload"><div><strong>صورة للرسالة</strong><span>اختيارية · حتى ٨ ميجابايت</span></div><label className="wa-button wa-button-secondary" htmlFor="wa-individual-image"><ImagePlus size={16} /> {manualImage ? 'تغيير الصورة' : 'اختيار صورة'}</label><input id="wa-individual-image" ref={individualImageRef} className="wa-file-input" type="file" accept="image/jpeg,image/png,image/webp" onChange={event => { const file = event.target.files?.[0]; if (file && (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || !file.size || file.size > 8 * 1024 * 1024)) { clearIndividualImage(); setIndividualNotice('اختر صورة JPG أو PNG أو WebP بحجم حتى ٨ ميجابايت.'); return; } setManualImage(file || null); setIndividualNotice(''); }} />{manualImage && <div className="wa-attachment-meta"><span>{manualImage.name}</span><button type="button" aria-label="إزالة صورة الرسالة" onClick={clearIndividualImage}><X size={16} /></button></div>}</div>
          <div className="wa-editor-tools"><button type="button" className="wa-button wa-button-secondary" disabled={!manualText.trim() || !patient || !financeAllowed} onClick={() => { try { const current = authorizeIndividualAction(); void copyText(current.text); } catch (error) { setIndividualNotice(error instanceof Error ? error.message : 'تعذّر التحقق من الرسالة.'); } }}><Clipboard size={16} /> نسخ النص</button><button type="button" className="wa-button wa-button-primary" disabled={!manualReady} onClick={() => { if (!manualReady || !patient) return; try { const current = authorizeIndividualAction(); window.open(getWhatsAppUrl(current.phone, current.text), '_blank', 'noopener,noreferrer'); setIndividualNotice('طُلب فتح واتساب للنص فقط. راجع المستلم وأرفق الصورة إن وجدت، ثم اضغط إرسال داخله؛ لا يوجد تأكيد إرسال أو تسليم من الموقع.'); } catch (error) { setIndividualNotice(error instanceof Error ? error.message : 'تعذّر فتح واتساب.'); } }}><ExternalLink size={16} /> فتح واتساب</button>{manualImage && <button type="button" className="wa-button wa-button-secondary" disabled={!manualReady} onClick={async () => { if (!manualReady || !manualImage) return; if (!navigator.canShare?.({ files: [manualImage] })) { setIndividualNotice('مشاركة الصور غير مدعومة هنا. افتح النص ثم أرفق الصورة يدويًا من واتساب.'); return; } try { const current = authorizeIndividualAction(); await navigator.share({ files: [manualImage], text: current.text }); setIndividualNotice('أُغلقت نافذة المشاركة؛ تحقّق من المستلم والإرسال داخل واتساب. المشاركة لا تثبت إرسال الرسالة.'); } catch (error) { setIndividualNotice(error instanceof Error && error.name === 'AbortError' ? 'أُلغيت المشاركة؛ لم يتأكد إرسال أي رسالة.' : 'تعذّرت المشاركة؛ أرفق الصورة يدويًا من واتساب.'); } }}><ImagePlus size={16} /> مشاركة الصورة والنص</button>}</div>{individualNotice && <p className="wa-context-note" role="status"><Info size={16} />{individualNotice}</p>}
          {manualImage && <p className="wa-field-help">فتح واتساب يجهز النص فقط. مشاركة الصورة تفتح قائمة المشاركة؛ اختر واتساب وتحقق من المستلم بنفسك.</p>}
          {chatPreview(manualFullText, patient ? 'بيانات المريض المختار؛ راجع قبل الفتح' : 'معاينة فقط، لم يُختر مريض', patient?.name, manualImagePreview)}
        </div></div>
    </div>

    <div hidden={section !== 'contacts'} className="wa-section-content"><ClinicContacts contacts={contacts} patients={patients} canManageContacts={canManageContacts} onSave={onSaveContact} onDelete={onDeleteContact} onOpenPatient={onOpenPatient} /></div>
    <div hidden={section !== 'campaigns'} className="wa-section-content"><WhatsAppCampaigns patients={patients} contacts={contacts} settings={draft} clinicName={clinicName} onAuthorizeSend={onAuthorizeSend} onSave={async next => { await onSaveWhatsappSettings({ ...whatsappSettings, campaignConsent: next.campaignConsent }); setDraft(current => ({ ...current, campaignConsent: next.campaignConsent })); }} /></div>
    <div hidden={section !== 'connection'} className="wa-panel wa-section-content"><div className="wa-panel-heading"><div><h3>الربط والقدرات المستقبلية</h3><p>الوضع اليدوي يعمل الآن. الخيارات الآلية تحتاج خدمة خلفية موثوقة قبل تفعيلها.</p></div><span className="wa-status-pending"><Plug size={15} /> غير متصل</span></div><div className="wa-capability-grid">{[
      { title: 'تذكيرات المواعيد', detail: 'جدولة التذكير للمرضى بعد ربط خدمة الإرسال والتحقق من الموافقات.' }, { title: 'حملات مجدولة', detail: 'إرسال منظم مع حد للرسائل وإلغاء الحملة؛ غير متاح في الوضع اليدوي.' }, { title: 'تتبع الرسائل', detail: 'حالات الإرسال والتسليم من ردود الخدمة الفعلية، لا من مجرد فتح واتساب.' }, { title: 'وسائط مرفقة', detail: 'إرسال الصور والمرفقات عبر الخدمة بعد إعداد آمن، ومراجعة المستلم.' },
    ].map(item => <article key={item.title}><LockKeyhole size={20} /><h4>{item.title}</h4><p>{item.detail}</p><span>يتطلب الربط · غير مفعّل</span></article>)}</div><p className="wa-context-note"><Info size={17} /> مفاتيح الاتصال لا تُحفظ داخل واجهة المتصفح. لا يفعّل حفظ الرسائل أي إرسال تلقائي أو اشتراك.</p><button type="button" className="wa-button wa-button-secondary wa-back-to-manual" onClick={() => setSection('individual')}><MessageCircle size={17} /> استخدام الفتح اليدوي الآن</button></div>
  </section>;
}
