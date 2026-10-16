import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { MessageCircle, RefreshCw, Search, ImagePlus, Phone, ShieldCheck, X, Settings2 } from 'lucide-react';
import type { CloudWhatsAppWorkspaceController } from '../../utils/cloudWhatsAppWorkspaceController';
import { normalizeContactPhone } from '../../utils/clinicContacts';
import { cloudWhatsAppConsentAllowed, renderCloudWhatsAppDraft } from '../../utils/cloudWhatsAppWorkspaceController';
import { filterCloudOverviewDirectory } from '../../utils/cloudClinicOverviewProjection';
import CloudProfileContactRecoveryPanel from '../shared/CloudProfileContactRecoveryPanel';
import './CloudWhatsAppWorkspace.css';

export interface CloudWhatsAppWorkspaceProps { controller: CloudWhatsAppWorkspaceController; previewOnly?: boolean; disabled?: boolean; onClose?(): void; onEditSettings?(): void }
export function CloudWhatsAppWorkspace(props: CloudWhatsAppWorkspaceProps) {
  const { controller, previewOnly = false } = props, state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  const consentState = useSyncExternalStore(controller.consent.subscribe, controller.consent.getState, controller.consent.getState);
  const [imageBusy, setImageBusy] = useState(false), [nativeNotice, setNativeNotice] = useState('');
  const latest = useRef({ props, state, consentState, imageBusy }); latest.current = { props, state, consentState, imageBusy };
  const compression = useRef<AbortController | null>(null);
  useEffect(() => () => { compression.current?.abort(); }, []);
  const blocked = Boolean(previewOnly || props.disabled || state.closed || state.loading || state.preparing || imageBusy);
  const valid = () => { const current = latest.current; return current.props.controller === controller && !current.props.previewOnly && !current.props.disabled
    && current.state === state && controller.getState() === state && !current.imageBusy && !blocked; };
  const run = (action: () => unknown) => { if (valid()) void action(); };
  const runConsent = (action: () => unknown) => { if (valid() && latest.current.consentState === consentState && controller.consent.getState() === consentState && !state.draft) void action(); };
  const snapshot = previewOnly ? null : state.snapshot, draft = previewOnly ? null : state.draft;
  const rows = state.projection && !previewOnly ? filterCloudOverviewDirectory(state.projection, state.query, 'all') : [];
  const eligible = rows.filter(row => state.tab !== 'campaigns' || snapshot && row.phone && cloudWhatsAppConsentAllowed(snapshot, row.phone));
  const visible = eligible.slice(0, state.directoryLimit);
  let rendered = ''; try { if (snapshot && draft) rendered = renderCloudWhatsAppDraft(snapshot, draft).message; } catch { /* Fixed error instead of partial financial text. */ }
  const consentBusy = consentState.loading || consentState.recoveryLoading || consentState.saveStatus !== 'idle';
  async function image(file: File) {
    if (!valid() || !draft) return; const original = draft, abort = new AbortController(); compression.current?.abort(); compression.current = abort; setImageBusy(true); setNativeNotice('');
    try {
      const { compressInvoiceImage } = await import('../../utils/invoiceImageCompression');
      const result = await compressInvoiceImage(file, { signal: abort.signal });
      if (abort.signal.aborted || compression.current !== abort || latest.current.props.controller !== controller || latest.current.props.previewOnly || latest.current.props.disabled || controller.getState().draft !== original) return;
      const encoded = result.dataUrl.split(',')[1], bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
      controller.setAttachment(new File([bytes], 'clinic-message.jpg', { type: 'image/jpeg' }), original);
    } catch { if (!abort.signal.aborted && latest.current.props.controller === controller) setNativeNotice('تعذر تجهيز الصورة. اختر صورة JPG/PNG/WebP حتى8 ميجابايت، واضحة وغير طويلة جدًا.'); }
    finally { if (compression.current === abort) { compression.current = null; setImageBusy(false); } }
  }
  function output(action: 'open' | 'share' | 'download') {
    if (!valid() || !state.output) return;
    const approved = controller.consumeOutput(state.output); if (!approved || latest.current.props.controller !== controller || latest.current.props.disabled || latest.current.props.previewOnly) return;
    if (action === 'open') {
      const tab = window.open(approved.url, '_blank', 'noopener,noreferrer');
      setNativeNotice(tab ? 'راجع المستلم والنص في واتساب قبل الإرسال. الصورة تحتاج إرفاقًا يدويًا إن لم تستخدم المشاركة.' : 'لو لم يفتح واتساب، اسمح بالنوافذ المنبثقة ثم تحقّق من الرسالة وأعد المحاولة.'); return;
    }
    if (action === 'share') {
      const data: ShareData = { text: approved.text, ...(approved.file ? { files: [approved.file] } : {}) };
      if (!navigator.share || approved.file && (!navigator.canShare || !navigator.canShare(data))) { setNativeNotice('المشاركة بالملفات غير مدعومة هنا. تحقّق مرة أخرى، نزّل الصورة وأرفقها يدويًا في واتساب.'); return; }
      // No await before this native user-gesture operation. A share completion
      // is never delivery confirmation; cancellation produces no auto-send.
      void navigator.share(data).then(() => setNativeNotice('انتهت نافذة المشاركة؛ راجع واتساب للتأكد من الإرسال.')).catch(() => setNativeNotice('أُغلقت نافذة المشاركة أو لم تكتمل. لم نرسل رسالة تلقائيًا.')); return;
    }
    if (!approved.file) return; const url = URL.createObjectURL(approved.file);
    try { const anchor = document.createElement('a'); anchor.href = url; anchor.download = approved.file.name; anchor.click(); setNativeNotice('نُزّلت الصورة فقط. أرفقها يدويًا بالمحادثة، ولم نعتبرها مرسلة.'); }
    finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
  const compose = (phone: string, patientRecordId: string | null, mode: 'individual' | 'campaign') => run(() => controller.beginMessage({ phone, patientRecordId, mode, templateId: null }));
  return <section className="cloud-wa" dir="rtl" aria-label="إدارة واتساب السحابية">
    <header className="cloud-wa__header"><div><h2><MessageCircle/>إدارة واتساب</h2><p>قوالب ودليل موحد · إرسال يدوي من مصدر بيانات محمي</p></div><div className="cloud-wa__actions">
      <button type="button" disabled={blocked || Boolean(draft) || !controller.canClose()} onClick={() => run(() => controller.refresh())}><RefreshCw size={18}/>تحديث البيانات</button>
      {props.onEditSettings && <button type="button" disabled={blocked || !controller.canClose()} onClick={() => run(() => props.onEditSettings?.())}><Settings2 size={18}/>القوالب والإعدادات</button>}
      {props.onClose && <button type="button" disabled={blocked || !controller.canClose()} onClick={() => run(() => props.onClose?.())}><X size={18}/>إغلاق</button>}</div></header>
    <p className="cloud-wa__notice">واتساب API غير مربوط. لا إرسال تلقائي أو بوت؛ الأزرار تفتح واتساب أو نافذة مشاركة الهاتف. الصورة لا تُرفق تلقائيًا برابط المحادثة.</p>
    {previewOnly && <p className="cloud-wa__notice">معاينة فارغة؛ لا بيانات أو قراءة أو إرسال.</p>}
    {!previewOnly && state.error && <p role="alert" className="cloud-wa__error">{state.error}</p>}
    {!previewOnly && state.notice && <p role="status" className="cloud-wa__notice">{state.notice}</p>}
    {nativeNotice && !previewOnly && <p role="status" className="cloud-wa__notice">{nativeNotice}</p>}
    {state.loading && <p role="status">جارٍ تحميل الدليل والقوالب…</p>}
    <nav className="cloud-wa__tabs" aria-label="أقسام واتساب">{([['messages', 'رسائل المرضى'], ['campaigns', 'الحملات والمعايدات'], ['consent', 'موافقات الأرقام']] as const).map(([key, label]) => <button type="button" key={key} aria-current={state.tab === key ? 'page' : undefined} disabled={blocked || Boolean(draft) || !controller.canClose()} onClick={() => run(() => controller.setTab(key))}>{label}</button>)}</nav>
    {draft && snapshot ? <div className="cloud-wa__editor">
      <div className="cloud-wa__panel"><h3>{draft.mode === 'campaign' ? 'رسالة حملة للرقم المختار' : 'رسالة فردية'} <bdi>{draft.phone}</bdi></h3>
        <p>{draft.patientRecordId ? `ملف ${snapshot.patients.find(file => file.patientRecordId === draft.patientRecordId)?.profile.fileNo}` : 'بدون اختيار ملف؛ لن تُستخدم أرصدة أو رقم ملف في الرسالة.'}</p>
        <label>القالب<select value={draft.templateId || ''} disabled={blocked} onChange={event => run(() => controller.chooseTemplate(event.target.value || null, draft))}><option value="">رسالة مخصصة</option>{snapshot.settings.clinicSettings.data.whatsapp.templates.filter(row => draft.mode !== 'campaign' || ['greeting', 'offer', 'custom'].includes(row.key)).map(row => <option key={row.templateId} value={row.templateId}>{row.title}</option>)}</select></label>
        {draft.mode === 'individual' && <><label>موعد مسجل<select value={draft.appointmentId || ''} disabled={blocked} onChange={event => { if (event.target.value) run(() => controller.chooseAppointment(event.target.value, draft)); }}><option value="">أدخل الموعد يدويًا أو اختر موعدًا</option>{snapshot.records.appointmentRecords.filter(row => !['cancelled', 'no_show', 'apologized'].includes(row.data.status) && (draft.patientRecordId ? row.data.patientRecordId === draft.patientRecordId : row.data.patientRecordId === null && normalizeContactPhone(row.data.phone) === draft.phone)).map(row => <option key={row.recordId} value={row.recordId}>{row.data.date} · {row.data.time} · {row.data.patientName}</option>)}</select></label>
          <div className="cloud-wa__pair"><label>تاريخ الموعد<input type="date" value={draft.date} disabled={blocked} onChange={event => run(() => controller.updateDraft({ date: event.target.value }, draft))}/></label><label>الوقت<input type="time" value={draft.time} disabled={blocked} onChange={event => run(() => controller.updateDraft({ time: event.target.value }, draft))}/></label></div></>}
        <label>نص الرسالة<textarea rows={7} maxLength={4000} disabled={blocked} value={draft.text} onChange={event => run(() => controller.updateDraft({ text: event.target.value }, draft))}/></label>
        <small>المتاح: {'{patientName}'} و{'{clinicName}'}. في الرسالة الفردية: {'{date}'} و{'{time}'}. رقم الملف والمتبقي يتطلبان اختيار ملف المريض.</small>
        <label>رابط اختياري<input type="url" dir="ltr" maxLength={2048} value={draft.link} disabled={blocked} placeholder="https://" onChange={event => run(() => controller.updateDraft({ link: event.target.value }, draft))}/></label>
        <label className="cloud-wa__image"><ImagePlus size={20}/>{imageBusy ? 'جارٍ تجهيز الصورة…' : draft.attachment ? 'تغيير الصورة المضغوطة' : 'إرفاق صورة'}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={blocked} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void image(file); }}/></label>
        {draft.attachment && <button type="button" disabled={blocked} onClick={() => run(() => controller.setAttachment(null, draft))}>حذف الصورة · {Math.ceil(draft.attachment.size / 1024)} KiB</button>}
      </div>
      <div className="cloud-wa__panel"><h3>معاينة الرسالة</h3><pre className="cloud-wa__preview">{rendered || 'اكتب الرسالة واختر القالب.'}</pre>
        <div className="cloud-wa__actions"><button type="button" className="cloud-wa__primary" disabled={blocked} onClick={() => run(() => controller.prepareOutput(draft))}><ShieldCheck size={18}/>{state.preparing ? 'جارٍ التحقق…' : 'تحقّق وجهّز الرسالة'}</button><button type="button" disabled={blocked} onClick={() => run(() => controller.cancelDraft(draft))}>إلغاء المسودة</button></div>
        {state.output && <div className="cloud-wa__actions"><button type="button" className="cloud-wa__primary" disabled={blocked} onClick={() => output('open')}><MessageCircle size={18}/>فتح واتساب</button><button type="button" disabled={blocked} onClick={() => output('share')}>مشاركة النص{draft.attachment ? ' والصورة' : ''}</button>{draft.attachment && <button type="button" disabled={blocked} onClick={() => output('download')}>تنزيل الصورة</button>}</div>}
        <small>كل إخراج يحتاج تحققًا حديثًا، وصالح30 ثانية للاستخدام مرة واحدة. راجع اسم المستلم داخل واتساب.</small>
      </div>
    </div> : <>
      <label className="cloud-wa__search"><Search size={20}/><input type="search" value={previewOnly ? '' : state.query} maxLength={200} disabled={blocked || !controller.canClose()} placeholder="الاسم أو الموبايل أو رقم الملف" onChange={event => run(() => controller.setQuery(event.target.value))}/></label>
      {state.tab === 'campaigns' && snapshot && <div className="cloud-wa__notice"><strong>الحملات للموافقين فقط</strong><p>الأرقام العائلية لا تعني موافقة كل أصحاب الملفات. تختار الأرقام هنا وتفتح كل محادثة يدويًا؛ لا إرسال جماعي تلقائي.</p><div className="cloud-wa__actions"><button type="button" disabled={blocked} onClick={() => run(() => controller.selectCampaignPhones(rows.filter(row => row.phone && cloudWhatsAppConsentAllowed(snapshot, row.phone)).map(row => row.phone)))}>اختيار كل الموافقين في نتائج البحث</button><button type="button" disabled={blocked} onClick={() => run(() => controller.selectCampaignPhones([]))}>إلغاء الاختيار</button></div><small>{state.selectedPhones.length} رقم محدد</small></div>}
      <ul className="cloud-wa__directory">{visible.map(row => <li className="cloud-wa__panel" key={row.id}><div><strong>{row.name}</strong><bdi>{row.mobile || 'بدون موبايل'}</bdi><small>{row.files.length ? row.files.map(file => `ملف ${file.fileNo} · ${file.name}`).join(' / ') : 'بدون ملف'}</small></div>
        {state.tab === 'consent' ? <div className="cloud-wa__actions"><span>{snapshot && cloudWhatsAppConsentAllowed(snapshot, row.phone) ? 'موافقة مسجلة' : 'لا توجد موافقة على الحملات'}</span><button type="button" disabled={blocked || !row.phone || !controller.canClose()} onClick={() => run(() => controller.beginConsent(row.phone, 'allowed'))}>تسجيل موافقة صريحة</button><button type="button" disabled={blocked || !row.phone || !controller.canClose()} onClick={() => run(() => controller.beginConsent(row.phone, 'declined'))}>رفض / إيقاف الحملات</button></div>
          : state.tab === 'campaigns' ? <div className="cloud-wa__actions"><label><input type="checkbox" checked={state.selectedPhones.includes(row.phone)} disabled={blocked} onChange={event => run(() => controller.selectCampaignPhones(event.target.checked ? [...state.selectedPhones, row.phone] : state.selectedPhones.filter(phone => phone !== row.phone)))}/>تحديد الرقم</label><button type="button" disabled={blocked || !state.selectedPhones.includes(row.phone)} onClick={() => compose(row.phone, null, 'campaign')}>تجهيز رسالة لهذا الرقم</button></div>
          : <div className="cloud-wa__actions"><button type="button" disabled={blocked || !row.phone} onClick={() => compose(row.phone, null, 'individual')}><MessageCircle size={18}/>رسالة بدون حساب</button>{row.files.map(file => <button type="button" disabled={blocked || !row.phone} key={file.patientRecordId} onClick={() => compose(row.phone, file.patientRecordId, 'individual')}>رسالة ملف {file.fileNo}</button>)}<a href={row.phone && !blocked ? `tel:+${row.phone}` : undefined} aria-disabled={blocked || !row.phone} onClick={event => { if (!valid() || !row.phone) event.preventDefault(); }}><Phone size={18}/>اتصال</a></div>}</li>)}</ul>
      {!visible.length && <p className="cloud-wa__panel">{snapshot ? 'لا توجد نتائج مطابقة. راجع البحث أو موافقات الحملات.' : 'اضغط تحديث البيانات لقراءة الدليل والقوالب. فتح القسم وحده لا يقرأ بيانات.'}</p>}
      {eligible.length > state.directoryLimit && <button type="button" disabled={blocked} onClick={() => run(() => controller.showMore())}>عرض50 سجلًا إضافيًا</button>}
    </>}
    {!previewOnly && consentState.draft && <section className="cloud-wa__panel"><h3>تأكيد موافقة الرقم</h3><p>{consentState.draft.contact?.name} · <bdi>{consentState.draft.contact?.mobile}</bdi></p><p>الحالة: {consentState.draft.contact?.campaignConsent?.status === 'allowed' ? 'موافق على الحملات' : 'رافض / إيقاف الحملات'}. سجّل الموافقة فقط بعد تأكيد صاحب الرقم؛ لا تنشئ ملف مريض.</p>
      {consentState.error && <p role="alert" className="cloud-wa__error">{consentState.error}</p>}
      {consentState.pendingOperationId && <p>العملية الأصلية: <bdi>{consentState.pendingOperationId}</bdi></p>}
      <div className="cloud-wa__actions"><button type="button" disabled={blocked || ['preparing', 'saving'].includes(consentState.saveStatus)} onClick={() => runConsent(() => controller.consent.save())}>{consentState.saveStatus === 'idle' ? 'تأكيد وحفظ' : 'إعادة التحقق من نفس العملية'}</button><button type="button" disabled={blocked || ['preparing', 'saving'].includes(consentState.saveStatus)} onClick={() => runConsent(() => consentState.pendingOperationId ? controller.consent.cancelPending() : controller.consent.cancelDraft())}>إلغاء بعد التحقق</button></div></section>}
    {!previewOnly && <CloudProfileContactRecoveryPanel controller={controller.consent.recovery} canAct={() => valid() && controller.consent.getState() === consentState && controller.canClose()} onResume={id => { if (!draft && !consentBusy) runConsent(() => controller.consent.resume(id)); }} disabled={blocked || Boolean(draft) || consentBusy || Boolean(consentState.draft)}/>} 
  </section>;
}
