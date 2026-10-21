import React, { useEffect, useRef, useState } from 'react';
import { Appointment, Patient, WhatsappSettings } from '../../types';
import { cleanEgyptianPhone, extraMessageTemplates, format12HourAr, formatArabicDate, getWhatsAppUrl } from '../../utils/whatsappUtils';
import { getPatientFinancialSummary } from '../../utils/financials';
import { getWhatsAppDraftTemplate, prepareFreshWhatsAppAction, prepareSafeWhatsAppMessage, whatsAppComposerContextKey, type WhatsAppSendAuthorization, type ProtectedWhatsAppActions } from '../../utils/whatsappSafety';
import { useProtectedWhatsAppAction } from '../../hooks/useProtectedWhatsAppAction';
import { appointmentTimeMinutes, isValidAppointmentDate } from '../appointments/appointmentScheduling';
import type { CampaignRecipient } from '../../utils/campaigns';
import {useAppointmentDialog} from '../appointments/useAppointmentDialog';
import {useDialogDraftClose} from '../common/useDialogCloseGuard';

interface CommonProps {
  key?: string;
  settings: WhatsappSettings;
  clinicName: string;
  onClose: () => void;
  onAuthorizeSend?: (request: WhatsAppSendAuthorization) => void;
  readSettings?: () => WhatsappSettings;
  cloudActions?: ProtectedWhatsAppActions;
}
interface CampaignDraft {
  template: 'greeting' | 'offer';
  message: string;
  link: string;
  attachment: File | null;
  onOpened: () => void;
}
type Props = CommonProps & ({
  patient: Patient;
  appointments: Appointment[];
  canViewPatientFinance?: boolean;
  campaign?: never;
  campaignRecipient?: never;
} | {
  campaignRecipient: Pick<CampaignRecipient, 'id' | 'name' | 'mobile' | 'source'>;
  campaign: CampaignDraft;
  patient?: never;
  appointments?: never;
  canViewPatientFinance?: false;
});

export function WhatsAppComposer(props: Props) {
  // A new recipient/access context must never inherit the previous patient's edited text or photo.
  const recipient = props.campaignRecipient ?? props.patient;
  const identity = props.campaignRecipient ? `${props.campaignRecipient.source}:${recipient.id}` : recipient.id;
  return <WhatsAppComposerBody key={whatsAppComposerContextKey(identity, recipient.mobile, props.canViewPatientFinance === true, props.campaign?.template)} {...props} />;
}

function WhatsAppComposerBody(props: Props) {
  const { settings, clinicName, onClose, campaign, canViewPatientFinance = false } = props;
  const recipient = props.campaignRecipient ?? props.patient;
  const patient = !campaign ? props.patient : undefined;
  const appointments = props.appointments ?? [];
  const [template, setTemplate] = useState(campaign?.template ?? 'reminderTomorrow');
  const [appointmentId, setAppointmentId] = useState('manual');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [edited, setEdited] = useState<string | null>(null);
  const [link, setLink] = useState(campaign?.link ?? '');
  const [attachment, setAttachment] = useState<File | null>(campaign?.attachment ?? null);
  const [notice, setNotice] = useState('');
  const authorizeProtected = useProtectedWhatsAppAction(props.cloudActions, setNotice);
  const [sharing, setSharing] = useState(false);
  const sharingRef = useRef(false);
  const requestClose = useDialogDraftClose(true, sharing, onClose, { template, appointmentId, date, time, edited, link, attachment: attachment ? [attachment.name, attachment.size, attachment.lastModified] : null });
  const closeDialog = () => { if (!sharingRef.current) requestClose(); };
  const dialogRef = useAppointmentDialog(true, closeDialog);
  const options = { reminderTomorrow: 'تذكير بالموعد', newAppt: 'تأكيد موعد', ...(canViewPatientFinance && !campaign ? { accountBalance: 'الرصيد المتبقي' } : {}), postOp: 'تعليمات عامة',
    ...Object.fromEntries(Object.entries(extraMessageTemplates).map(([key, value]) => [key, value.title])) };
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const appts = patient ? appointments.filter(a => (a.patientId === patient.id || a.fileNo === patient.id) && !['cancelled', 'no_show', 'apologized', 'attended'].includes(a.status) && a.date >= today)
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)) : [];
  const selected = appts.find(a => a.id === appointmentId);
  const activeDate = selected?.date || (appointmentId === 'manual' ? date : '');
  const activeTime = selected?.time || (appointmentId === 'manual' ? time : '');
  const raw = getWhatsAppDraftTemplate(template, settings, campaign?.message);
  const values: Record<string, string> = { patientName: recipient.name, clinicName };
  if (patient) values.fileNo = patient.id;
  if (isValidAppointmentDate(activeDate)) values.date = formatArabicDate(activeDate);
  if (appointmentTimeMinutes(activeTime) !== null) values.time = format12HourAr(activeTime);
  if (canViewPatientFinance && patient) values.remainingBalance = getPatientFinancialSummary(patient).totalRemaining.toLocaleString('ar-EG');
  const safety = prepareSafeWhatsAppMessage({ templateName: template, rawTemplate: raw, editedText: edited, values, phone: recipient.mobile,
    canViewPatientFinance, isCampaign: Boolean(campaign), campaignConsent: settings.campaignConsent });
  const message = safety.message;
  const text = message + (link.trim() ? `\n${link.trim()}` : '');
  const phone = cleanEgyptianPhone(recipient.mobile);
  const validPhone = /^[1-9]\d{7,14}$/.test(phone);
  const needsDate = !campaign && (['reminderTomorrow', 'newAppt', 'rootCanal'].includes(template) || /\{(?:date|time)\}/.test(raw));
  const missingDate = needsDate && (!isValidAppointmentDate(activeDate) || appointmentTimeMinutes(activeTime) === null);
  const unfinished = safety.unfinished || /\[[^\]]+\]|\{[^{}]+\}/.test(text);
  let validLink = !link.trim();
  try { const url = new URL(link.trim()); validLink = ['https:', 'http:'].includes(url.protocol) && Boolean(url.hostname) && !/\s/.test(link.trim()); } catch { /* Optional blank links remain valid. */ }
  const ready = validPhone && !missingDate && !unfinished && validLink && !!message.trim() && safety.financeAllowed && safety.consentAllowed && !safety.unsupportedVariables.length;
  const authorizeAction = () => { const input = {
    templateName: template, rawTemplate: raw, editedText: edited, values, phone: recipient.mobile,
    canViewPatientFinance, isCampaign: Boolean(campaign), link, appointmentReady: !missingDate,
  }; return props.cloudActions ? authorizeProtected({ ...input, patientFileNo: patient?.id ?? null })
    : prepareFreshWhatsAppAction(input, props.readSettings ?? (() => { throw Error('تعذر قراءة أحدث إعدادات واتساب.'); }), props.onAuthorizeSend); };
  return <div className="clinic-modal-overlay fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-3" dir="rtl">
    <section ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="تجهيز رسالة واتساب" onKeyDown={e => {
      if (e.key === 'Escape') { e.stopPropagation(); closeDialog(); }
      if (e.key !== 'Tab') return;
      const items = Array.from(dialogRef.current?.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)') || []) as HTMLElement[];
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }} className="clinic-modal-panel w-full max-w-xl max-h-[90dvh] overflow-y-auto rounded-2xl bg-white p-4 sm:p-6 space-y-4">
      <div className="flex items-center justify-between gap-2"><h2 className="font-bold text-lg min-w-0 break-words">رسالة إلى {recipient.name}</h2><button type="button" disabled={sharing} onClick={closeDialog} className="p-3 min-h-[44px] shrink-0 rounded-xl bg-slate-100">إغلاق</button></div>
      <p className="text-sm text-slate-600">رقم المستلم: <bdi dir="ltr">{validPhone ? `+${phone}` : recipient.mobile}</bdi></p>
      <p className="text-sm text-slate-600">تجهّز الرسالة هنا ثم تراجعها وتضغط إرسال داخل واتساب.</p>
      <p className="text-xs text-slate-500">{campaign ? 'راجع الاسم والرقم ونص الحملة قبل الإرسال. لا تُرسل عروضاً إلا لمن وافق على استقبالها.' : 'راجع التاريخ والتعليمات الطبية والمبلغ قبل الإرسال. لا تُرسل عروضاً إلا لمن وافق على استقبالها.'}</p>
      {!campaign && <label className="block text-sm font-bold">نوع الرسالة<select value={template} onChange={e => { setTemplate(e.target.value); setEdited(null); }} className="block w-full border rounded-xl p-3 mt-1">{Object.entries(options).map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select></label>}
      {needsDate && <div className="space-y-2">
        <label className="block text-sm">الموعد<select value={appointmentId} onChange={e => { setAppointmentId(e.target.value); setEdited(null); }} className="block border rounded-xl p-3 w-full"><option value="manual">تحديد موعد يدوياً</option>{appts.map(a => <option key={a.id} value={a.id}>{formatArabicDate(a.date)} — {format12HourAr(a.time)}</option>)}</select></label>
        {appointmentId === 'manual' && <div className="grid grid-cols-2 gap-2"><input aria-label="تاريخ الموعد" type="date" value={date} onChange={e => { setDate(e.target.value); setEdited(null); }} className="border rounded-xl p-3 min-w-0" /><input aria-label="وقت الموعد" type="time" value={time} onChange={e => { setTime(e.target.value); setEdited(null); }} className="border rounded-xl p-3 min-w-0" /></div>}
      </div>}
      <label className="block text-sm font-bold">نص الرسالة<textarea rows={7} value={message} onChange={e => setEdited(e.target.value)} className="block w-full border rounded-xl p-3 mt-1 font-normal" /></label>
      <label className="block text-sm">رابط اختياري<input type="url" value={link} onChange={e => setLink(e.target.value)} placeholder="https://" className="block w-full border rounded-xl p-3" dir="ltr" /></label>
      <label className="block text-sm">إرفاق صورة<input type="file" accept="image/jpeg,image/png,image/webp" className="block w-full mt-2" onChange={e => {
        const file = e.target.files?.[0];
        if (file && (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || !file.size || file.size > 8 * 1024 * 1024)) { setNotice('اختر صورة JPG أو PNG أو WebP حتى 8 ميجابايت'); setAttachment(null); e.target.value = ''; return; }
        setAttachment(file || null); setNotice('');
      }} /></label>
      {attachment && <p className="text-sm text-slate-600">{attachment.name} — مشاركة الصورة تفتح قائمة المشاركة؛ اختر واتساب ثم المستلم. رابط واتساب وحده لا يرفق صورة.</p>}
      {!validPhone && <p className="text-rose-700 text-sm">راجع رقم هاتف المستلم.</p>}
      {missingDate && <p className="text-amber-800 text-sm">حدد تاريخ الموعد ووقته.</p>}
      {unfinished && <p className="text-amber-800 text-sm">أكمل النص الموجود بين الأقواس قبل فتح واتساب.</p>}
      {!validLink && <p className="text-rose-700 text-sm">اكتب رابطاً كاملاً يبدأ بـ https://</p>}
      {!safety.financeAllowed && <p className="text-rose-700 text-sm">{campaign ? 'لا تُستخدم بيانات حساب المريض في الحملات العامة.' : 'هذه الرسالة تحتاج صلاحية الاطلاع على حساب المريض.'}</p>}
      {!safety.consentAllowed && <p className="text-amber-800 text-sm">لا يمكن فتح المعايدات والعروض قبل تسجيل موافقة صاحب الرقم الفعلية على رسائل الحملات.</p>}
      {safety.unsupportedVariables.length > 0 && <p className="text-amber-800 text-sm">{campaign ? 'الحملات تدعم اسم المستلم واسم العيادة فقط. ' : ''}راجع المتغيرات غير المتاحة: {safety.unsupportedVariables.join('، ')}.</p>}
      {notice && <p role="status" className="text-sm text-slate-700">{notice}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!ready || sharing} className="rounded-xl bg-emerald-700 text-white px-4 py-3 disabled:opacity-40" onClick={() => {
          if (sharingRef.current) return;
          try {
            const current = authorizeAction();
            window.open(getWhatsAppUrl(current.phone, current.text), '_blank', 'noopener,noreferrer');
            campaign?.onOpened();
            setNotice('طُلب فتح واتساب؛ راجع المستلم والإرسال داخله. هذا ليس تأكيد إرسال أو تسليم.');
          } catch (error) { setNotice(error instanceof Error ? error.message : 'تعذّر فتح واتساب. راجع البيانات وحاول مرة أخرى.'); }
        }}>فتح الرسالة في واتساب</button>
        {attachment && <button type="button" disabled={!ready || sharing} className="rounded-xl bg-slate-100 px-4 py-3 disabled:opacity-40" onClick={async () => {
          if (sharingRef.current || !attachment) return;
          if (!navigator.canShare?.({ files: [attachment] })) { setNotice('مشاركة الصور غير متاحة في هذا المتصفح. افتح الرسالة وأرفق الصورة من واتساب يدوياً.'); return; }
          let current: ReturnType<typeof authorizeAction>;
          try { current = authorizeAction(); }
          catch (error) { setNotice(error instanceof Error ? error.message : 'تعذّر التحقق من صلاحية مشاركة الرسالة.'); return; }
          try {
            sharingRef.current = true;
            setSharing(true);
            await navigator.share({ files: [attachment], text: current.text });
            setNotice('أُغلقت نافذة المشاركة؛ تحقق من المستلم والإرسال داخل واتساب. هذا ليس تأكيد إرسال أو تسليم.');
          }
          catch (error) { setNotice(error instanceof Error && error.name === 'AbortError' ? 'تم إلغاء المشاركة' : 'تعذرت المشاركة؛ أرفق الصورة يدوياً داخل واتساب.'); }
          finally { sharingRef.current = false; setSharing(false); }
        }}>مشاركة الصورة والنص</button>}
      </div>
    </section>
  </div>;
}
