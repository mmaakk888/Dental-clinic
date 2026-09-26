import React, { useEffect, useRef, useState } from 'react';
import { Appointment, Patient, WhatsappSettings } from '../../types';
import { cleanEgyptianPhone, extraMessageTemplates, fillMessageTemplate, format12HourAr, formatArabicDate, getWhatsAppUrl } from '../../utils/whatsappUtils';
import { getPatientFinancialSummary } from '../../utils/financials';

interface Props {
  patient: Patient;
  appointments: Appointment[];
  settings: WhatsappSettings;
  clinicName: string;
  onClose: () => void;
}

export function WhatsAppComposer({ patient, appointments, settings, clinicName, onClose }: Props) {
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    return () => { document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  const [template, setTemplate] = useState('reminderTomorrow');
  const [appointmentId, setAppointmentId] = useState('manual');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [edited, setEdited] = useState<string | null>(null);
  const [link, setLink] = useState('');
  const [attachment, setAttachment] = useState<File | null>(null);
  const [notice, setNotice] = useState('');
  const options = { reminderTomorrow: 'تذكير بالموعد', newAppt: 'تأكيد موعد', accountBalance: 'الرصيد المتبقي', postOp: 'تعليمات عامة',
    ...Object.fromEntries(Object.entries(extraMessageTemplates).map(([key, value]) => [key, value.title])) };
  const appts = appointments.filter(a => (a.patientId === patient.id || a.fileNo === patient.id) && !['cancelled', 'no_show'].includes(a.status))
    .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
  const selected = appts.find(a => a.id === appointmentId);
  const activeDate = selected?.date || date;
  const activeTime = selected?.time || time;
  const raw = settings.templates[template as keyof typeof settings.templates] ?? extraMessageTemplates[template as keyof typeof extraMessageTemplates]?.text ?? '';
  const message = edited ?? fillMessageTemplate(raw, { patientName: patient.name, clinicName, fileNo: patient.id,
    date: formatArabicDate(activeDate), time: format12HourAr(activeTime), remainingBalance: getPatientFinancialSummary(patient).totalRemaining.toLocaleString('ar-EG') });
  const text = message + (link.trim() ? `\n${link.trim()}` : '');
  const phone = cleanEgyptianPhone(patient.mobile);
  const validPhone = /^[1-9]\d{7,14}$/.test(phone);
  const missingDate = ['reminderTomorrow', 'newAppt', 'rootCanal'].includes(template) && (!activeDate || !activeTime);
  const unfinished = /\[[^\]]+\]|\{\w+\}/.test(text);
  const validLink = !link || /^https?:\/\/\S+$/i.test(link.trim());
  const ready = validPhone && !missingDate && !unfinished && validLink && !!message.trim();
  return <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-3" dir="rtl">
    <section ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="تجهيز رسالة واتساب" onKeyDown={e => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key !== 'Tab') return;
      const items = Array.from(dialogRef.current?.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)') || []) as HTMLElement[];
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }} className="w-full max-w-xl max-h-[90dvh] overflow-y-auto rounded-2xl bg-white p-4 sm:p-6 space-y-4">
      <div className="flex items-center justify-between gap-2"><h2 className="font-bold text-lg">رسالة إلى {patient.name}</h2><button type="button" onClick={onClose} className="p-3 rounded-xl bg-slate-100">إغلاق</button></div>
      <p className="text-sm text-slate-600">تجهّز الرسالة هنا ثم تراجعها وتضغط إرسال داخل واتساب.</p>
      <p className="text-xs text-slate-500">راجع التاريخ والتعليمات الطبية والمبلغ قبل الإرسال. لا تُرسل عروضاً إلا لمن وافق على استقبالها.</p>
      <label className="block text-sm font-bold">نوع الرسالة<select value={template} onChange={e => { setTemplate(e.target.value); setEdited(null); }} className="block w-full border rounded-xl p-3 mt-1">{Object.entries(options).map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select></label>
      {['reminderTomorrow', 'newAppt', 'rootCanal'].includes(template) && <div className="space-y-2">
        <label className="block text-sm">الموعد<select value={appointmentId} onChange={e => { setAppointmentId(e.target.value); setEdited(null); }} className="block border rounded-xl p-3 w-full"><option value="manual">تحديد موعد يدوياً</option>{appts.map(a => <option key={a.id} value={a.id}>{a.date} — {format12HourAr(a.time)}</option>)}</select></label>
        {appointmentId === 'manual' && <div className="grid grid-cols-2 gap-2"><input aria-label="تاريخ الموعد" type="date" value={date} onChange={e => { setDate(e.target.value); setEdited(null); }} className="border rounded-xl p-3 min-w-0" /><input aria-label="وقت الموعد" type="time" value={time} onChange={e => { setTime(e.target.value); setEdited(null); }} className="border rounded-xl p-3 min-w-0" /></div>}
      </div>}
      <label className="block text-sm font-bold">نص الرسالة<textarea rows={7} value={message} onChange={e => setEdited(e.target.value)} className="block w-full border rounded-xl p-3 mt-1 font-normal" /></label>
      <label className="block text-sm">رابط اختياري<input type="url" value={link} onChange={e => setLink(e.target.value)} placeholder="https://" className="block w-full border rounded-xl p-3" dir="ltr" /></label>
      <label className="block text-sm">إرفاق صورة<input type="file" accept="image/jpeg,image/png,image/webp" className="block w-full mt-2" onChange={e => {
        const file = e.target.files?.[0];
        if (file && (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024)) { setNotice('اختر صورة JPG أو PNG أو WebP أقل من 8 ميجابايت'); setAttachment(null); e.target.value = ''; return; }
        setAttachment(file || null); setNotice('');
      }} /></label>
      {attachment && <p className="text-sm text-slate-600">{attachment.name} — مشاركة الصورة تفتح قائمة المشاركة؛ اختر واتساب ثم المريض. رابط واتساب وحده لا يرفق صورة.</p>}
      {!validPhone && <p className="text-rose-700 text-sm">راجع رقم هاتف المريض.</p>}
      {missingDate && <p className="text-amber-800 text-sm">حدد تاريخ الموعد ووقته.</p>}
      {unfinished && <p className="text-amber-800 text-sm">أكمل النص الموجود بين الأقواس قبل فتح واتساب.</p>}
      {!validLink && <p className="text-rose-700 text-sm">اكتب رابطاً كاملاً يبدأ بـ https://</p>}
      {notice && <p role="status" className="text-sm text-slate-700">{notice}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!ready} className="rounded-xl bg-emerald-700 text-white px-4 py-3 disabled:opacity-40" onClick={() => window.open(getWhatsAppUrl(patient.mobile, text), '_blank', 'noopener,noreferrer')}>فتح الرسالة في واتساب</button>
        {attachment && <button type="button" disabled={!ready} className="rounded-xl bg-slate-100 px-4 py-3 disabled:opacity-40" onClick={async () => {
          if (!navigator.canShare?.({ files: [attachment] })) { setNotice('مشاركة الصور غير متاحة في هذا المتصفح. افتح الرسالة وأرفق الصورة من واتساب يدوياً.'); return; }
          try { await navigator.share({ files: [attachment], text }); setNotice('تم فتح المشاركة؛ تحقق من المستلم والإرسال داخل واتساب.'); }
          catch (error) { setNotice(error instanceof Error && error.name === 'AbortError' ? 'تم إلغاء المشاركة' : 'تعذرت المشاركة؛ أرفق الصورة يدوياً داخل واتساب.'); }
        }}>مشاركة الصورة والنص</button>}
      </div>
    </section>
  </div>;
}
