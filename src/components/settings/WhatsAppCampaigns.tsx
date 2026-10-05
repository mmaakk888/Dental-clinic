import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, ExternalLink, ImagePlus, Info, Link, MessageCircle, RotateCcw, Search, Users, X } from 'lucide-react';
import { Patient, WhatsappSettings } from '../../types';
import { extraMessageTemplates, fillMessageTemplate } from '../../utils/whatsappUtils';
import { campaignRecipients } from '../../utils/campaigns';
import { WhatsAppComposer } from '../patient/WhatsAppComposer';
import { useToastAndConfirm } from '../common/ToastAndConfirm';
import './WhatsAppManagement.css';

interface Props { patients: Patient[]; settings: WhatsappSettings; clinicName: string; onSave: (settings: WhatsappSettings) => void }
type CampaignStep = 'audience' | 'message' | 'review';
const normalizeDigits = (value: string) => value.replace(/[٠-٩۰-۹]/g, digit => String(digit.charCodeAt(0) - (digit <= '٩' ? 0x0660 : 0x06f0)));
const steps: Array<{ key: CampaignStep; title: string; description: string }> = [
  { key: 'audience', title: 'الجمهور', description: 'اختيار المرضى والموافقة' },
  { key: 'message', title: 'الرسالة', description: 'النص والصورة والرابط' },
  { key: 'review', title: 'المراجعة', description: 'فتح واتساب لكل مريض' },
];

export function WhatsAppCampaigns({ patients, settings, clinicName, onSave }: Props) {
  const { askConfirm } = useToastAndConfirm();
  const [step, setStep] = useState<CampaignStep>('audience');
  const [kind, setKind] = useState<'greeting' | 'offer'>('greeting');
  const [message, setMessage] = useState(settings.templates.greeting ?? extraMessageTemplates.greeting.text);
  const [link, setLink] = useState('');
  const [attachment, setAttachment] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState('');
  const imageInputRef = useRef<HTMLInputElement>(null);
  const previousPreset = useRef(settings.templates.greeting ?? extraMessageTemplates.greeting.text);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
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

  const contacts = campaignRecipients(patients);
  const consent = settings.campaignConsent ?? {};
  const query = normalizeDigits(search.trim().toLowerCase());
  const filtered = contacts.filter(({ patient, phone }) => `${patient.name.toLowerCase()} ${normalizeDigits(patient.id)} ${phone}`.includes(query));
  const eligible = contacts.filter(contact => consent[contact.phone] === 'allowed' && selected.includes(contact.phone));
  const approvedCount = contacts.filter(contact => consent[contact.phone] === 'allowed').length;
  const current = eligible.find(contact => contact.phone === active);
  const previewContact = eligible.find(contact => contact.phone === previewPhone) || eligible[0];
  const nextContact = eligible.find(contact => !opened.includes(contact.phone));
  const openedCount = eligible.filter(contact => opened.includes(contact.phone)).length;
  const pages = Math.max(1, Math.ceil(filtered.length / 20));
  const effectivePage = Math.min(page, pages - 1);
  const visibleContacts = filtered.slice(effectivePage * 20, effectivePage * 20 + 20);
  let validLink = !link.trim();
  try {
    const url = new URL(link.trim());
    validLink = ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname) && !/\s/.test(link.trim());
  } catch { /* A blank link is optional; an incomplete one must be corrected. */ }
  const unknownVariables = (message.match(/\{[^{}]+\}/g) || []).filter(token => !['{patientName}', '{clinicName}'].includes(token));
  const unfinished = /\[[^\]]+\]/.test(message);
  const ready = Boolean(eligible.length && message.trim() && validLink && !unknownVariables.length && !unfinished);
  const previewText = fillMessageTemplate(message, { patientName: step === 'review' ? previewContact?.patient.name || 'أحمد محمد' : 'أحمد محمد', clinicName }) + (link.trim() ? `\n${link.trim()}` : '');

  const clearProgress = () => { setOpened([]); setNotice(''); };
  const updateConsent = (phone: string, value: string) => {
    const next = { ...consent };
    if (value === 'allowed' || value === 'declined') next[phone] = value; else delete next[phone];
    try {
      onSave({ ...settings, campaignConsent: next });
      if (value !== 'allowed') setSelected(ids => ids.filter(id => id !== phone));
      setNotice('');
    } catch { setNotice('تعذّر حفظ الموافقة. حاول مرة أخرى قبل إضافة هذا المريض للحملة.'); }
  };
  const goToStep = (nextStep: CampaignStep) => {
    if (nextStep !== 'audience' && !eligible.length) { setNotice('حدد مريضًا واحدًا على الأقل ممن وافقوا على رسائل الحملات.'); return; }
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
    <div className="wa-preview-caption"><span>معاينة الرسالة</span><small>{step === 'review' ? 'حسب المريض المختار، بدون إرسال' : 'بيانات تجريبية، بدون إرسال'}</small></div>
    <div className="wa-chat-header"><span className="wa-chat-avatar"><MessageCircle size={18} /></span><div><strong>{clinicName}</strong><small>{step === 'review' ? previewContact?.patient.name || 'رسالة الحملة' : 'رسالة الحملة'}</small></div></div>
    <div className="wa-chat-body"><div className="wa-chat-bubble">
      {imagePreview && <img className="wa-chat-image" src={imagePreview} alt="معاينة الصورة المختارة للحملة" onError={() => { removeImage(); setNotice('تعذّر عرض هذه الصورة. اختر ملف صورة صالحًا قبل متابعة الحملة.'); }} />}
      <p>{previewText.trim() || 'ستظهر معاينة رسالتك هنا.'}</p><span className="wa-chat-time">٥:٠٠ م</span>
    </div></div>
    <p className="wa-preview-footnote">رابط واتساب يفتح النص فقط. راجع الصورة وأرفقها يدويًا أو شاركها من نافذة المريض إذا كان جهازك يدعم ذلك.</p>
  </aside>;

  return <section className="wa-panel wa-campaign" dir="rtl" aria-labelledby="wa-campaign-title">
    <div className="wa-panel-heading"><div><h3 id="wa-campaign-title">إعداد حملة</h3><p>معايدة أو خبر من العيادة، مع مراجعة الرسالة لكل مريض.</p></div><span className="wa-status-pending"><ExternalLink size={15} /> فتح يدوي</span></div>
    <nav className="wa-campaign-steps" aria-label="خطوات إعداد الحملة">{steps.map((item, index) => <button type="button" key={item.key} aria-current={step === item.key ? 'step' : undefined} onClick={() => goToStep(item.key)} className={step === item.key ? 'is-active' : ''}>
      <span className="wa-step-number">{index + 1}</span><span><strong>{item.title}</strong><small>{item.description}</small></span>
    </button>)}</nav>

    {step === 'audience' && <div className="wa-campaign-stage">
      <div className="wa-stage-heading"><div><h4>من سيستقبل الحملة؟</h4><p>اختر المرضى الذين وافقوا على استقبال المعايدات والعروض.</p></div><span className="wa-count-badge">{eligible.length.toLocaleString('ar-EG')} محدد</span></div>
      <div className="wa-audience-stats"><span><strong>{contacts.length.toLocaleString('ar-EG')}</strong> رقم صالح</span><span><strong>{approvedCount.toLocaleString('ar-EG')}</strong> وافق على الحملات</span></div>
      <p className="wa-context-note"><Info size={16} /> تُحفظ الموافقة فورًا. سجّل «وافق» بعد موافقة المريض الفعلية فقط؛ كل رقم يظهر مرة واحدة.</p>
      <div className="wa-audience-toolbar"><div className="wa-search-field"><Search size={18} /><input aria-label="بحث المرضى للحملة" placeholder="الاسم أو رقم الملف أو الهاتف" value={search} onChange={event => { setSearch(event.target.value); setPage(0); }} />{search && <button type="button" aria-label="مسح البحث" onClick={() => { setSearch(''); setPage(0); }}><X size={16} /></button>}</div><button type="button" className="wa-button wa-button-secondary" onClick={() => setSelected(ids => [...new Set([...ids, ...visibleContacts.filter(contact => consent[contact.phone] === 'allowed').map(contact => contact.phone)])])} disabled={!visibleContacts.some(contact => consent[contact.phone] === 'allowed')}>تحديد موافقي هذه الصفحة</button></div>
      <div className="wa-selection-tools"><button type="button" onClick={() => setSelected(contacts.filter(contact => consent[contact.phone] === 'allowed').map(contact => contact.phone))} disabled={!approvedCount}>تحديد كل الموافقين ({approvedCount.toLocaleString('ar-EG')})</button><button type="button" onClick={() => setSelected([])} disabled={!eligible.length}>إلغاء التحديد</button></div>
      <div className="wa-audience-list">{visibleContacts.map(({ patient, phone }) => <div key={phone} className={`wa-audience-row ${selected.includes(phone) && consent[phone] === 'allowed' ? 'is-selected' : ''}`}>
        <label className="wa-contact-select"><input type="checkbox" disabled={consent[phone] !== 'allowed'} checked={selected.includes(phone) && consent[phone] === 'allowed'} onChange={event => setSelected(ids => event.target.checked ? [...new Set([...ids, phone])] : ids.filter(id => id !== phone))} /><span><strong>{patient.name}</strong><small>ملف #{patient.id} <span dir="ltr">+{phone}</span></small></span></label>
        <label className="wa-consent-select"><span>موافقة الحملات</span><select aria-label={`موافقة ${patient.name}`} value={consent[phone] ?? 'unknown'} onChange={event => updateConsent(phone, event.target.value)}><option value="unknown">موافقة غير مسجلة</option><option value="allowed">وافق على الحملات</option><option value="declined">رفض / أوقف الرسائل</option></select></label>
      </div>)}</div>
      {!filtered.length && <div className="wa-empty-state"><Users size={27} /><p>{contacts.length ? 'لا توجد أرقام مطابقة للبحث.' : 'لا توجد أرقام هاتف صالحة للحملات. أضف أرقام المرضى من ملفاتهم.'}</p></div>}
      <div className="wa-pagination"><button type="button" aria-label="الصفحة السابقة" disabled={effectivePage === 0} onClick={() => setPage(effectivePage - 1)}><ChevronRight size={16} /><span>السابق</span></button><span>صفحة {effectivePage + 1} من {pages}</span><button type="button" aria-label="الصفحة التالية" disabled={effectivePage + 1 >= pages} onClick={() => setPage(effectivePage + 1)}><span>التالي</span><ChevronLeft size={16} /></button></div>
      <div className="wa-stage-actions"><p>قائمة الحملة مؤقتة؛ موافقات المرضى تبقى محفوظة.</p><button type="button" className="wa-button wa-button-primary" disabled={!eligible.length} onClick={() => goToStep('message')}>تجهيز الرسالة <ChevronLeft size={17} /></button></div>
    </div>}

    {step === 'message' && <div className="wa-campaign-stage">
      <div className="wa-stage-heading"><div><h4>ماذا تريد أن تقول؟</h4><p>رسالة موحدة لـ {eligible.length.toLocaleString('ar-EG')} مريضًا، مع تخصيص اسم كل مريض عند المراجعة.</p></div></div>
      <div className="wa-editor-layout">
        <div className="wa-template-editor">
          <div className="wa-kind-options" aria-label="نوع الحملة">{[{ key: 'greeting' as const, title: 'معايدة' }, { key: 'offer' as const, title: 'عرض أو إعلان' }].map(option => <button key={option.key} type="button" aria-pressed={kind === option.key} className={kind === option.key ? 'is-active' : ''} onClick={() => { if (kind === option.key) return; setKind(option.key); setMessage(settings.templates[option.key] ?? extraMessageTemplates[option.key].text); clearProgress(); }}>{option.title}</button>)}</div>
          <label htmlFor="wa-campaign-message" className="wa-field-label">نص الحملة</label><textarea id="wa-campaign-message" rows={8} value={message} onChange={event => { setMessage(event.target.value); clearProgress(); }} placeholder="اكتب رسالة الحملة…" />
          <p className="wa-field-help">يمكن استخدام <code dir="ltr">{'{patientName}'}</code> و<code dir="ltr">{'{clinicName}'}</code>. للأرقام المشتركة بين أفراد الأسرة، استخدم تحية عامة.</p>
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
          <label htmlFor="wa-preview-patient" className="wa-field-label">معاينة لمريض من الجمهور</label><select id="wa-preview-patient" value={previewContact?.phone || ''} onChange={event => setPreviewPhone(event.target.value)}>{eligible.map(contact => <option key={contact.phone} value={contact.phone}>{contact.patient.name} — ملف #{contact.patient.id}</option>)}</select>
          <div className="wa-open-progress"><strong>{openedCount} من {eligible.length}</strong><span>طُلب فتح الرسالة في واتساب</span><div className="wa-progress-track" role="progressbar" aria-label="طلبات فتح واتساب" aria-valuemin={0} aria-valuemax={eligible.length || 1} aria-valuenow={openedCount}><span style={{ width: `${eligible.length ? openedCount / eligible.length * 100 : 0}%` }} /></div></div>
          <p className="wa-field-help">هذه قائمة الفتح، وليست تأكيدًا على الإرسال أو التسليم.</p>
          <ol className="wa-review-contact-list">{eligible.slice(0, 20).map(contact => <li key={contact.phone}><div><strong>{contact.patient.name}</strong><small dir="ltr">+{contact.phone}</small></div><span className={opened.includes(contact.phone) ? 'is-opened' : ''}>{opened.includes(contact.phone) ? <><ExternalLink size={14} /> طُلب الفتح</> : 'بانتظار المراجعة'}</span></li>)}</ol>
          {eligible.length > 20 && <p className="wa-field-help">تعرض القائمة أول ٢٠ مستلمًا؛ زر المراجعة يتابع جميع المحددين.</p>}
          <button type="button" className="wa-button wa-button-primary wa-open-next" disabled={!ready || !nextContact} onClick={() => { if (nextContact) setActive(nextContact.phone); }}><ExternalLink size={17} /><span>{nextContact ? `مراجعة رسالة ${nextContact.patient.name}` : 'طُلب الفتح لكل المحددين'}</span></button>
          <p className="wa-field-help">راجع المستلم والنص والصورة داخل النافذة، ثم أكمل الإرسال في واتساب.</p>
          {openedCount > 0 && <button type="button" className="wa-button wa-button-plain" onClick={() => askConfirm({ title: 'إعادة قائمة الفتح', message: 'سيبدأ عداد الفتح من جديد. راجع واتساب قبل إعادة الرسائل لتجنب إرسالها مرتين.', confirmLabel: 'إعادة القائمة', tone: 'warning', onConfirm: () => { setOpened([]); setNotice('أُعيدت قائمة الفتح. راجع الرسائل السابقة قبل الإرسال مرة أخرى.'); } })}><RotateCcw size={15} /> إعادة قائمة الفتح</button>}
        </div>
        {preview}
      </div>
      <div className="wa-stage-actions"><button type="button" className="wa-button wa-button-plain" onClick={() => goToStep('message')}><ArrowRight size={17} /> تعديل الرسالة</button><span className="wa-field-help">الصورة والنص والاختيارات تخص إعداد هذه الحملة.</span></div>
    </div>}
    {notice && <p role="status" className="wa-inline-notice">{notice}</p>}
    {current && <WhatsAppComposer patient={current.patient} appointments={[]} settings={settings} clinicName={clinicName} onClose={() => setActive(null)} campaign={{ template: kind, message, link, attachment, onOpened: () => setOpened(ids => ids.includes(current.phone) ? ids : [...ids, current.phone]) }} />}
  </section>;
}
