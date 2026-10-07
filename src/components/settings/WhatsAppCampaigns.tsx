import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, ExternalLink, Filter, ImagePlus, Info, Link, MessageCircle, RotateCcw, Search, Users, X } from 'lucide-react';
import { ClinicContact, Patient, WhatsappSettings } from '../../types';
import { extraMessageTemplates, fillMessageTemplate } from '../../utils/whatsappUtils';
import { campaignRecipientCanReceive, campaignRecipientLabel, campaignRecipients, matchesCampaignRecipient } from '../../utils/campaigns';
import { WhatsAppComposer } from '../patient/WhatsAppComposer';
import { useToastAndConfirm } from '../common/ToastAndConfirm';
import type { WhatsAppSendAuthorization } from '../../utils/whatsappSafety';
import './WhatsAppManagement.css';

interface Props { patients: Patient[]; contacts?: ClinicContact[]; settings: WhatsappSettings; clinicName: string; onSave: (settings: WhatsappSettings) => void | Promise<void>; onAuthorizeSend?: (request: WhatsAppSendAuthorization) => void }
type CampaignStep = 'audience' | 'message' | 'review';
const normalizeDigits = (value: string) => value.replace(/[٠-٩۰-۹]/g, digit => String(digit.charCodeAt(0) - (digit <= '٩' ? 0x0660 : 0x06f0)));
const steps: Array<{ key: CampaignStep; title: string; description: string }> = [
  { key: 'audience', title: 'الجمهور', description: 'اختيار المستلمين والموافقة' },
  { key: 'message', title: 'الرسالة', description: 'النص والصورة والرابط' },
  { key: 'review', title: 'المراجعة', description: 'فتح واتساب لكل مستلم' },
];

export function WhatsAppCampaigns({ patients, contacts = [], settings, clinicName, onSave, onAuthorizeSend }: Props) {
  const { askConfirm } = useToastAndConfirm();
  const consentBusy = useRef(false);
  const [savingConsent, setSavingConsent] = useState(false);
  const [step, setStep] = useState<CampaignStep>('audience');
  const [kind, setKind] = useState<'greeting' | 'offer'>('greeting');
  const [message, setMessage] = useState(settings.templates.greeting ?? extraMessageTemplates.greeting.text);
  const [link, setLink] = useState('');
  const [attachment, setAttachment] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState('');
  const imageInputRef = useRef<HTMLInputElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const previousPreset = useRef(settings.templates.greeting ?? extraMessageTemplates.greeting.text);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [consentFilter, setConsentFilter] = useState<'all' | 'allowed' | 'unknown' | 'declined'>('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'patient' | 'contact'>('all');
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [sortOrder, setSortOrder] = useState<'name' | 'file'>('name');
  const [reviewFilter, setReviewFilter] = useState<'all' | 'pending' | 'opened'>('all');
  const [reviewPage, setReviewPage] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [opened, setOpened] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [previewPhone, setPreviewPhone] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!attachment) { setImagePreview(''); return; }
    const source = URL.createObjectURL(attachment);
    setImagePreview(source);
    return () => URL.revokeObjectURL(source);
  }, [attachment]);
  useEffect(() => {
    const preset = settings.templates[kind] ?? extraMessageTemplates[kind].text;
    const previous = previousPreset.current;
    setMessage(current => current === previous ? preset : current);
    previousPreset.current = preset;
  }, [kind, settings.templates.greeting, settings.templates.offer]);

  const recipients = campaignRecipients(patients, contacts);
  const consent = settings.campaignConsent ?? {};
  const filtered = recipients.filter(recipient => matchesCampaignRecipient(recipient, search)
    && (sourceFilter === 'all' || recipient.source === sourceFilter))
    .filter(({ phone }) =>
    (consentFilter === 'all' || (consent[phone] || 'unknown') === consentFilter)
    && (!selectedOnly || selected.includes(phone) && consent[phone] === 'allowed'))
    .sort((a, b) => sortOrder === 'name' ? a.name.localeCompare(b.name, 'ar')
      : a.source === 'patient' && b.source === 'patient' ? normalizeDigits(a.fileNo).localeCompare(normalizeDigits(b.fileNo), 'en', { numeric: true })
        : a.source !== b.source ? (a.source === 'patient' ? -1 : 1) : a.name.localeCompare(b.name, 'ar'));
  const eligible = recipients.filter(contact => campaignRecipientCanReceive(contact, consent) && selected.includes(contact.phone));
  const approvedCount = recipients.filter(contact => campaignRecipientCanReceive(contact, consent)).length;
  const current = eligible.find(contact => contact.phone === active);
  const previewContact = eligible.find(contact => contact.phone === previewPhone) || eligible[0];
  const nextContact = eligible.find(contact => !opened.includes(contact.phone));
  const openedCount = eligible.filter(contact => opened.includes(contact.phone)).length;
  const pages = Math.max(1, Math.ceil(filtered.length / 20));
  const effectivePage = Math.min(page, pages - 1);
  const visibleContacts = filtered.slice(effectivePage * 20, effectivePage * 20 + 20);
  const matchingApproved = filtered.filter(contact => consent[contact.phone] === 'allowed');
  const excludedCount = patients.length + contacts.length - recipients.length;
  const reviewContacts = eligible.filter(contact => reviewFilter === 'all' || opened.includes(contact.phone) === (reviewFilter === 'opened'));
  const reviewPages = Math.max(1, Math.ceil(reviewContacts.length / 10));
  const effectiveReviewPage = Math.min(reviewPage, reviewPages - 1);
  const visibleReviewContacts = reviewContacts.slice(effectiveReviewPage * 10, effectiveReviewPage * 10 + 10);
  let validLink = !link.trim();
  try {
    const url = new URL(link.trim());
    validLink = ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname) && !/\s/.test(link.trim());
  } catch { /* A blank link is optional; an incomplete one must be corrected. */ }
  const unknownVariables = (message.match(/\{[^{}]+\}/g) || []).filter(token => !['{patientName}', '{clinicName}'].includes(token));
  const unfinished = /\[[^\]]+\]/.test(message);
  const ready = Boolean(eligible.length && message.trim() && validLink && !unknownVariables.length && !unfinished);
  const previewText = fillMessageTemplate(message, { patientName: step === 'review' ? previewContact?.name || 'أحمد محمد' : 'أحمد محمد', clinicName }) + (link.trim() ? `\n${link.trim()}` : '');

  const clearProgress = () => { setOpened([]); setReviewPage(0); setNotice(''); };
  const insertVariable = (key: 'patientName' | 'clinicName') => {
    const editor = messageInputRef.current as HTMLTextAreaElement | null;
    const start = editor?.selectionStart ?? message.length;
    const end = editor?.selectionEnd ?? start;
    const token = `{${key}}`;
    setMessage(message.slice(0, start) + token + message.slice(end));
    clearProgress();
    requestAnimationFrame(() => { editor?.focus(); editor?.setSelectionRange(start + token.length, start + token.length); });
  };
  const updateConsent = async (phone: string, value: string) => {
    if (consentBusy.current) return;
    const next = { ...consent };
    if (value === 'allowed' || value === 'declined') next[phone] = value; else delete next[phone];
    consentBusy.current = true; setSavingConsent(true);
    try {
      await onSave({ ...settings, campaignConsent: next });
      if (value !== 'allowed') setSelected(ids => ids.filter(id => id !== phone));
      setNotice('');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'تعذّر حفظ الموافقة. حاول مرة أخرى قبل إضافة هذا المستلم للحملة.'); }
    finally { consentBusy.current = false; setSavingConsent(false); }
  };
  const goToStep = (nextStep: CampaignStep) => {
    if (nextStep !== 'audience' && !eligible.length) { setNotice('حدد مستلمًا واحدًا على الأقل ممن وافقوا على رسائل الحملات.'); return; }
    if (nextStep === 'review' && !ready) { setNotice('أكمل نص الرسالة والمتغيرات والرابط قبل المراجعة.'); return; }
    setStep(nextStep);
    setNotice('');
  };
  const chooseImage = (file: File | undefined) => {
    clearProgress();
    if (file && (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || !file.size || file.size > 8 * 1024 * 1024)) {
      setNotice('اختر صورة JPG أو PNG أو WebP بحجم أقل من ٨ ميجابايت.');
      setAttachment(null);
      if (imageInputRef.current) imageInputRef.current.value = '';
      return;
    }
    setAttachment(file || null);
  };
  const removeImage = () => {
    setAttachment(null);
    if (imageInputRef.current) imageInputRef.current.value = '';
    clearProgress();
  };
  const preview = <aside className="wa-message-preview" aria-label="معاينة رسالة الحملة">
    <div className="wa-preview-caption"><span>معاينة الرسالة</span><small>{step === 'review' ? 'حسب المستلم المختار، بدون إرسال' : 'بيانات تجريبية، بدون إرسال'}</small></div>
    <div className="wa-chat-header"><span className="wa-chat-avatar"><MessageCircle size={18} /></span><div><strong>{clinicName}</strong><small>{step === 'review' ? previewContact?.name || 'رسالة الحملة' : 'رسالة الحملة'}</small></div></div>
    <div className="wa-chat-body"><div className="wa-chat-bubble">
      {imagePreview && <img className="wa-chat-image" src={imagePreview} alt="معاينة الصورة المختارة للحملة" onError={() => { removeImage(); setNotice('تعذّر عرض هذه الصورة. اختر ملف صورة صالحًا قبل متابعة الحملة.'); }} />}
      <p>{previewText.trim() || 'ستظهر معاينة رسالتك هنا.'}</p><span className="wa-chat-time">٥:٠٠ م</span>
    </div></div>
    <p className="wa-preview-footnote">رابط واتساب يفتح النص فقط. راجع الصورة وأرفقها يدويًا أو شاركها من نافذة الرسالة إذا كان جهازك يدعم ذلك.</p>
  </aside>;

  return <section className="wa-panel wa-campaign" dir="rtl" aria-labelledby="wa-campaign-title">
    <div className="wa-panel-heading"><div><h3 id="wa-campaign-title">إعداد حملة</h3><p>معايدة أو خبر من العيادة للمرضى وجهات الاتصال، مع مراجعة كل رسالة.</p></div><span className="wa-status-pending"><ExternalLink size={15} /> فتح يدوي</span></div>
    <nav className="wa-campaign-steps" aria-label="خطوات إعداد الحملة">{steps.map((item, index) => <button type="button" key={item.key} aria-current={step === item.key ? 'step' : undefined} onClick={() => goToStep(item.key)} className={step === item.key ? 'is-active' : ''}>
      <span className="wa-step-number">{index + 1}</span><span><strong>{item.title}</strong><small>{item.description}</small></span>
    </button>)}</nav>

    {step === 'audience' && <div className="wa-campaign-stage">
      <div className="wa-stage-heading"><div><h4>من سيستقبل الحملة؟</h4><p>اختر المرضى أو جهات الاتصال الذين وافقوا على استقبال المعايدات والعروض.</p></div><span className="wa-count-badge">{eligible.length.toLocaleString('ar-EG')} محدد</span></div>
      <div className="wa-audience-stats"><span><strong>{recipients.length.toLocaleString('ar-EG')}</strong> رقم صالح</span><span><strong>{approvedCount.toLocaleString('ar-EG')}</strong> وافق على الحملات</span><span><strong>{excludedCount.toLocaleString('ar-EG')}</strong> سجل مستبعد لتكرار الرقم أو عدم صلاحيته</span></div>
      <p className="wa-context-note"><Info size={16} /> تُحفظ الموافقة فورًا. سجّل «وافق» بعد موافقة صاحب الرقم الفعلية فقط. الرقم المرتبط بملف يظهر ضمن المرضى، مرة واحدة حتى لو كان مسجلًا بجهات الاتصال.</p>
      <div className="wa-audience-toolbar"><div className="wa-search-field"><Search size={18} /><input aria-label="بحث المستلمين للحملة" placeholder="الاسم أو رقم الملف أو الهاتف" value={search} onChange={event => { setSearch(event.target.value); setPage(0); }} />{search && <button type="button" aria-label="مسح البحث" onClick={() => { setSearch(''); setPage(0); }}><X size={16} /></button>}</div><button type="button" className="wa-button wa-button-secondary" onClick={() => setSelected(ids => [...new Set([...ids, ...visibleContacts.filter(contact => consent[contact.phone] === 'allowed').map(contact => contact.phone)])])} disabled={!visibleContacts.some(contact => consent[contact.phone] === 'allowed')}>تحديد موافقي هذه الصفحة</button></div>
      <div className="wa-audience-filters">
        <label><span>المصدر</span><select aria-label="مصدر مستلمي الحملة" value={sourceFilter} onChange={event => { setSourceFilter(event.target.value as typeof sourceFilter); setPage(0); }}><option value="all">المرضى وجهات الاتصال</option><option value="patient">لهم ملفات مرضى</option><option value="contact">جهات اتصال بدون ملفات</option></select></label>
        <label><Filter size={15} /><span>الموافقة</span><select value={consentFilter} onChange={event => { setConsentFilter(event.target.value as typeof consentFilter); setPage(0); }}><option value="all">جميع الحالات</option><option value="allowed">وافقوا على الحملات</option><option value="unknown">بدون موافقة مسجلة</option><option value="declined">رفضوا / أوقفوا الرسائل</option></select></label><label><span>الترتيب</span><select value={sortOrder} onChange={event => { setSortOrder(event.target.value as typeof sortOrder); setPage(0); }}><option value="name">اسم المستلم</option><option value="file">رقم الملف، ثم جهات الاتصال</option></select></label><label className="wa-filter-check"><input type="checkbox" checked={selectedOnly} onChange={event => { setSelectedOnly(event.target.checked); setPage(0); }} /> المحددون فقط</label><span className="wa-result-count">{filtered.length.toLocaleString('ar-EG')} نتيجة</span></div>
      <div className="wa-selection-tools"><button type="button" onClick={() => setSelected(ids => [...new Set([...ids, ...matchingApproved.map(contact => contact.phone)])])} disabled={!matchingApproved.length}>تحديد الموافقين في النتائج ({matchingApproved.length.toLocaleString('ar-EG')})</button><button type="button" onClick={() => setSelected([])} disabled={!eligible.length}>إلغاء التحديد</button><span>تغيير البحث والفلاتر لا يلغي اختياراتك.</span></div>
      <div className="wa-audience-list">{visibleContacts.map(recipient => <div key={recipient.phone} className={`wa-audience-row ${selected.includes(recipient.phone) && consent[recipient.phone] === 'allowed' ? 'is-selected' : ''}`}>
        <label className="wa-contact-select"><input type="checkbox" disabled={consent[recipient.phone] !== 'allowed'} checked={selected.includes(recipient.phone) && consent[recipient.phone] === 'allowed'} onChange={event => setSelected(ids => event.target.checked ? [...new Set([...ids, recipient.phone])] : ids.filter(id => id !== recipient.phone))} /><span><strong>{recipient.name}</strong><small>{campaignRecipientLabel(recipient)} <span dir="ltr">+{recipient.phone}</span></small></span></label>
        <label className="wa-consent-select"><span>موافقة الحملات</span><select disabled={savingConsent} aria-label={`موافقة ${recipient.name}`} value={consent[recipient.phone] ?? 'unknown'} onChange={event => updateConsent(recipient.phone, event.target.value)}><option value="unknown">موافقة غير مسجلة</option><option value="allowed">وافق على الحملات</option><option value="declined">رفض / أوقف الرسائل</option></select></label>
      </div>)}</div>
      {!filtered.length && <div className="wa-empty-state"><Users size={27} /><p>{recipients.length ? 'لا توجد أرقام مطابقة للبحث والفلاتر.' : 'لا توجد أرقام هاتف صالحة للحملات. أضف جهة اتصال أو رقمًا في ملف مريض.'}</p></div>}
      <div className="wa-pagination"><button type="button" aria-label="الصفحة السابقة" disabled={effectivePage === 0} onClick={() => setPage(effectivePage - 1)}><ChevronRight size={16} /><span>السابق</span></button><span>صفحة {effectivePage + 1} من {pages}</span><button type="button" aria-label="الصفحة التالية" disabled={effectivePage + 1 >= pages} onClick={() => setPage(effectivePage + 1)}><span>التالي</span><ChevronLeft size={16} /></button></div>
      <div className="wa-stage-actions"><p>قائمة الحملة مؤقتة؛ موافقات أصحاب الأرقام تبقى محفوظة.</p><button type="button" className="wa-button wa-button-primary" disabled={!eligible.length} onClick={() => goToStep('message')}>تجهيز الرسالة <ChevronLeft size={17} /></button></div>
    </div>}

    {step === 'message' && <div className="wa-campaign-stage">
      <div className="wa-stage-heading"><div><h4>ماذا تريد أن تقول؟</h4><p>رسالة موحدة لـ {eligible.length.toLocaleString('ar-EG')} مستلمًا، مع تخصيص اسم كل مستلم عند المراجعة.</p></div></div>
      <div className="wa-editor-layout">
        <div className="wa-template-editor">
          <div className="wa-kind-options" aria-label="نوع الحملة">{[{ key: 'greeting' as const, title: 'معايدة' }, { key: 'offer' as const, title: 'عرض أو إعلان' }].map(option => <button key={option.key} type="button" aria-pressed={kind === option.key} className={kind === option.key ? 'is-active' : ''} onClick={() => { if (kind === option.key) return; setKind(option.key); setMessage(settings.templates[option.key] ?? extraMessageTemplates[option.key].text); clearProgress(); }}>{option.title}</button>)}</div>
          <label htmlFor="wa-campaign-message" className="wa-field-label">نص الحملة</label><textarea id="wa-campaign-message" ref={messageInputRef} rows={8} value={message} onChange={event => { setMessage(event.target.value); clearProgress(); }} placeholder="اكتب رسالة الحملة…" />
          <div className="wa-editor-meta"><span>{Array.from(message).length.toLocaleString('ar-EG')} حرف · {message.trim() ? message.trim().split(/\s+/).length.toLocaleString('ar-EG') : '٠'} كلمة</span><span>مسودة هذه الحملة فقط</span></div>
          <div className="wa-variable-buttons"><button type="button" onClick={() => insertVariable('patientName')}>اسم المستلم <code dir="ltr">{'{patientName}'}</code></button><button type="button" onClick={() => insertVariable('clinicName')}>اسم العيادة <code dir="ltr">{'{clinicName}'}</code></button></div>
          <p className="wa-field-help">للأرقام المشتركة بين أفراد الأسرة، استخدم تحية عامة. تعديل هذه الرسالة لا يغيّر القالب المحفوظ.</p>
          <label htmlFor="wa-campaign-link" className="wa-field-label wa-label-icon"><Link size={16} /> رابط اختياري</label><input id="wa-campaign-link" type="url" value={link} onChange={event => { setLink(event.target.value); clearProgress(); }} dir="ltr" placeholder="https://" />
          {!validLink && <p className="wa-inline-notice">اكتب رابطًا كاملًا يبدأ بـ https:// أو http://.</p>}
          <div className="wa-image-upload"><div><strong>صورة الحملة</strong><span>اختيارية · JPG أو PNG أو WebP حتى ٨ ميجابايت</span></div><label className="wa-button wa-button-secondary" htmlFor="wa-campaign-image"><ImagePlus size={17} /> {attachment ? 'تغيير الصورة' : 'اختيار صورة'}</label><input ref={imageInputRef} id="wa-campaign-image" type="file" accept="image/png,image/jpeg,image/webp" className="wa-file-input" onChange={event => chooseImage(event.target.files?.[0])} />{attachment && <div className="wa-attachment-meta"><span>{attachment.name}</span><button type="button" onClick={removeImage} aria-label="إزالة صورة الحملة"><X size={16} /></button></div>}</div>
          {unknownVariables.length > 0 && <p className="wa-inline-notice">احذف أو أكمل المتغيرات غير المناسبة للحملة: {Array.from(new Set(unknownVariables)).join('، ')}.</p>}
          {unfinished && <p className="wa-inline-notice">أكمل التفاصيل المكتوبة بين الأقواس المربعة قبل المراجعة.</p>}
          <p className="wa-context-note"><Info size={16} /> للحملات العامة استخدم المعايدات والأخبار. التفاصيل المالية والعلاجية تُراجع في الرسائل الفردية.</p>
        </div>
        {preview}
      </div>
      <div className="wa-stage-actions"><button type="button" className="wa-button wa-button-plain" onClick={() => goToStep('audience')}><ArrowRight size={17} /> تعديل الجمهور</button><button type="button" className="wa-button wa-button-primary" disabled={!ready} onClick={() => goToStep('review')}>مراجعة الحملة <ChevronLeft size={17} /></button></div>
    </div>}

    {step === 'review' && <div className="wa-campaign-stage">
      <div className="wa-stage-heading"><div><h4>راجع ثم افتح واتساب</h4><p>كل رسالة تفتح للمراجعة والإرسال يدويًا. لا تُرسل رسائل تلقائيًا من هذه الصفحة.</p></div></div>
      <div className="wa-review-summary"><span><Users size={18} /><strong>{eligible.length}</strong> مستلم</span><span><MessageCircle size={18} />{kind === 'greeting' ? 'معايدة' : 'عرض أو إعلان'}</span><span><ImagePlus size={18} />{attachment ? 'صورة مرفقة للمشاركة' : 'بدون صورة'}</span><span><Link size={18} />{link.trim() ? 'رابط مضاف' : 'بدون رابط'}</span></div>
      <div className="wa-editor-layout">
        <div className="wa-review-queue">
          <label htmlFor="wa-preview-recipient" className="wa-field-label">معاينة لمستلم من الجمهور</label><select id="wa-preview-recipient" value={previewContact?.phone || ''} onChange={event => setPreviewPhone(event.target.value)}>{eligible.map(contact => <option key={contact.phone} value={contact.phone}>{contact.name} — {campaignRecipientLabel(contact)}</option>)}</select>
          <div className="wa-open-progress"><strong>{openedCount} من {eligible.length}</strong><span>طُلب فتح الرسالة في واتساب</span><div className="wa-progress-track" role="progressbar" aria-label="طلبات فتح واتساب" aria-valuemin={0} aria-valuemax={eligible.length || 1} aria-valuenow={openedCount}><span style={{ width: `${eligible.length ? openedCount / eligible.length * 100 : 0}%` }} /></div></div>
          <p className="wa-field-help">هذه قائمة الفتح، وليست تأكيدًا على الإرسال أو التسليم.</p>
          <div className="wa-review-filters" aria-label="فلترة قائمة المراجعة">{[{ key: 'all' as const, label: 'الجميع', count: eligible.length }, { key: 'pending' as const, label: 'بانتظار الفتح', count: eligible.length - openedCount }, { key: 'opened' as const, label: 'طُلب فتحها', count: openedCount }].map(item => <button key={item.key} type="button" aria-pressed={reviewFilter === item.key} onClick={() => { setReviewFilter(item.key); setReviewPage(0); }}>{item.label} <span>{item.count.toLocaleString('ar-EG')}</span></button>)}</div>
          <ol className="wa-review-contact-list">{visibleReviewContacts.map(contact => <li key={contact.phone}><div><strong>{contact.name}</strong><small>{campaignRecipientLabel(contact)}</small><small dir="ltr">+{contact.phone}</small></div><span className={opened.includes(contact.phone) ? 'is-opened' : ''}>{opened.includes(contact.phone) ? <><ExternalLink size={14} /> طُلب الفتح</> : 'بانتظار المراجعة'}</span><button type="button" className="wa-review-row-action" disabled={!ready} onClick={() => { setPreviewPhone(contact.phone); if (opened.includes(contact.phone)) askConfirm({ title: 'مراجعة رسالة فُتحت سابقًا', message: 'طُلب فتح رسالة هذا المستلم سابقًا في هذه الحملة. راجع واتساب لتجنب إرسالها مرتين.', confirmLabel: 'مراجعة الرسالة', tone: 'warning', onConfirm: () => setActive(contact.phone) }); else setActive(contact.phone); }} aria-label={`مراجعة رسالة ${contact.name}`}><ExternalLink size={15} /> مراجعة</button></li>)}</ol>
          {!reviewContacts.length && <p className="wa-field-help">لا يوجد مستلمون في حالة المراجعة المختارة.</p>}
          {reviewPages > 1 && <div className="wa-pagination"><button type="button" disabled={effectiveReviewPage === 0} onClick={() => setReviewPage(effectiveReviewPage - 1)}><ChevronRight size={15} /> السابق</button><span>{effectiveReviewPage + 1} / {reviewPages}</span><button type="button" disabled={effectiveReviewPage + 1 >= reviewPages} onClick={() => setReviewPage(effectiveReviewPage + 1)}>التالي <ChevronLeft size={15} /></button></div>}
          <button type="button" className="wa-button wa-button-primary wa-open-next" disabled={!ready || !nextContact} onClick={() => { if (nextContact) { setPreviewPhone(nextContact.phone); setActive(nextContact.phone); } }}><ExternalLink size={17} /><span>{nextContact ? `مراجعة رسالة ${nextContact.name}` : 'طُلب الفتح لكل المحددين'}</span></button>
          <p className="wa-field-help">راجع المستلم والنص والصورة داخل النافذة، ثم أكمل الإرسال في واتساب.</p>
          {openedCount > 0 && <button type="button" className="wa-button wa-button-plain" onClick={() => askConfirm({ title: 'إعادة قائمة الفتح', message: 'سيبدأ عداد الفتح من جديد. راجع واتساب قبل إعادة الرسائل لتجنب إرسالها مرتين.', confirmLabel: 'إعادة القائمة', tone: 'warning', onConfirm: () => { setOpened([]); setNotice('أُعيدت قائمة الفتح. راجع الرسائل السابقة قبل الإرسال مرة أخرى.'); } })}><RotateCcw size={15} /> إعادة قائمة الفتح</button>}
        </div>
        {preview}
      </div>
      <div className="wa-stage-actions"><button type="button" className="wa-button wa-button-plain" onClick={() => goToStep('message')}><ArrowRight size={17} /> تعديل الرسالة</button><span className="wa-field-help">الصورة والنص والاختيارات تخص إعداد هذه الحملة.</span></div>
    </div>}
    {notice && <p role="status" className="wa-inline-notice">{notice}</p>}
    {current && <WhatsAppComposer key={current.phone} campaignRecipient={current} settings={settings} clinicName={clinicName} onAuthorizeSend={onAuthorizeSend} onClose={() => setActive(null)} campaign={{ template: kind, message, link, attachment, onOpened: () => setOpened(ids => ids.includes(current.phone) ? ids : [...ids, current.phone]) }} />}
  </section>;
}
