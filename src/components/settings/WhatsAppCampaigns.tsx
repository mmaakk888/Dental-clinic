import React, { useState } from 'react';
import { Patient, WhatsappSettings } from '../../types';
import { extraMessageTemplates } from '../../utils/whatsappUtils';
import { campaignRecipients } from '../../utils/campaigns';
import { WhatsAppComposer } from '../patient/WhatsAppComposer';

interface Props { patients: Patient[]; settings: WhatsappSettings; clinicName: string; onSave: (settings: WhatsappSettings) => void }

export function WhatsAppCampaigns({ patients, settings, clinicName, onSave }: Props) {
  const [kind, setKind] = useState<'greeting' | 'offer'>('greeting');
  const [message, setMessage] = useState(settings.templates.greeting ?? extraMessageTemplates.greeting.text);
  const [link, setLink] = useState('');
  const [attachment, setAttachment] = useState<File | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [opened, setOpened] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const contacts = campaignRecipients(patients);
  const consent = settings.campaignConsent ?? {};
  const filtered = contacts.filter(({ patient, phone }) => `${patient.name} ${patient.id} ${phone}`.includes(search.trim()));
  const eligible = contacts.filter(c => consent[c.phone] === 'allowed' && selected.includes(c.phone));
  const current = eligible.find(c => c.phone === active);
  const pages = Math.max(1, Math.ceil(filtered.length / 20));
  const effectivePage = Math.min(page, pages - 1);
  const updateConsent = (phone: string, value: string) => {
    const next = { ...consent };
    if (value === 'allowed' || value === 'declined') next[phone] = value; else delete next[phone];
    onSave({ ...settings, campaignConsent: next });
    if (value !== 'allowed') setSelected(ids => ids.filter(id => id !== phone));
  };
  return <section className="bg-white border border-slate-200 rounded-3xl p-4 sm:p-6 space-y-4" dir="rtl">
    <h3 className="font-bold text-lg">حملة واتساب يدوية</h3>
    <p className="text-sm text-slate-600">رسالة موحدة مع مراجعة وإرسال لكل مريض داخل واتساب. لا يوجد إرسال جماعي تلقائي أو تأكيد تسليم. الاختيارات وحالة الفتح مؤقتة وتُصفّر عند مغادرة القسم.</p>
    <label className="block text-sm font-bold">نوع الحملة<select value={kind} onChange={e => { const key = e.target.value as 'greeting' | 'offer'; setKind(key); setMessage(settings.templates[key] ?? extraMessageTemplates[key].text); setOpened([]); }} className="block w-full border rounded-xl p-3 mt-1"><option value="greeting">معايدة</option><option value="offer">عرض أو إعلان</option></select></label>
    <label className="block text-sm font-bold">نص الحملة<textarea rows={5} value={message} onChange={e => { setMessage(e.target.value); setOpened([]); }} className="block w-full border rounded-xl p-3 mt-1" /></label>
    <p className="text-xs text-slate-500">يمكن استخدام {'{patientName}'} و{'{clinicName}'}. لا تضع معلومات مالية أو علاجية في رسالة جماعية. للأرقام المشتركة بين أفراد الأسرة، استخدم تحية عامة.</p>
    <label className="block text-sm">رابط اختياري<input type="url" value={link} onChange={e => { setLink(e.target.value); setOpened([]); }} dir="ltr" className="block w-full border rounded-xl p-3" /></label>
    <label className="block text-sm">صورة الحملة<input type="file" accept="image/png,image/jpeg,image/webp" className="block w-full mt-2" onChange={e => {
      const file = e.target.files?.[0]; setOpened([]);
      if (file && (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024)) { setNotice('اختر صورة JPG أو PNG أو WebP أقل من 8 ميجابايت.'); setAttachment(null); e.target.value = ''; return; }
      setAttachment(file ?? null); setNotice('');
    }} /></label>
    <p className="text-xs text-slate-500">الصورة تُشارك يدوياً من نافذة كل مريض إذا دعم المتصفح ذلك؛ وإلا أرفقها داخل واتساب.</p>
    <div className="border-t pt-4 space-y-3">
      <h4 className="font-bold">المستلمون والموافقة</h4>
      <p className="text-sm text-slate-600">سجّل «وافق» فقط بعد موافقة المريض الفعلية على رسائل العروض والمعايدات. اختيار «رفض» يمنع إضافته للحملة. حفظ الموافقة يحفظ إعدادات واتساب الحالية أيضاً.</p>
      <p className="text-xs text-slate-500">تظهر الأرقام الصالحة فقط، ويظهر كل رقم مرة واحدة لمنع التكرار.</p>
      <input aria-label="بحث المرضى للحملة" placeholder="ابحث بالاسم أو الملف أو الرقم الدولي" value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} className="w-full border rounded-xl p-3" />
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setSelected(ids => [...new Set([...ids, ...filtered.filter(c => consent[c.phone] === 'allowed').map(c => c.phone)])])} className="bg-slate-100 p-3 rounded-xl text-sm">تحديد الموافقين في نتائج البحث</button>
        <button type="button" onClick={() => setSelected([])} className="bg-slate-100 p-3 rounded-xl text-sm">إلغاء التحديد</button>
      </div>
      {filtered.slice(effectivePage * 20, effectivePage * 20 + 20).map(({ patient, phone }) => <div key={phone} className="flex flex-wrap items-center justify-between gap-3 border rounded-xl p-3">
        <label className="flex items-center gap-2 min-w-0"><input type="checkbox" disabled={consent[phone] !== 'allowed'} checked={selected.includes(phone) && consent[phone] === 'allowed'} onChange={e => setSelected(ids => e.target.checked ? [...ids, phone] : ids.filter(id => id !== phone))} /><span className="break-words">{patient.name}<span className="block text-xs text-slate-500">ملف {patient.id} · {phone}</span></span></label>
        <select aria-label={`موافقة ${patient.name}`} value={consent[phone] ?? 'unknown'} onChange={e => updateConsent(phone, e.target.value)} className="border rounded-xl p-2"><option value="unknown">لم تُسجل موافقة</option><option value="allowed">وافق</option><option value="declined">رفض / إيقاف</option></select>
      </div>)}
      {!filtered.length && <p className="text-sm text-slate-500">لا توجد أرقام مطابقة.</p>}
      <div className="flex items-center gap-3"><button type="button" disabled={effectivePage === 0} onClick={() => setPage(effectivePage - 1)} className="p-2 disabled:opacity-40">السابق</button><span>{effectivePage + 1} / {pages}</span><button type="button" disabled={effectivePage + 1 >= pages} onClick={() => setPage(effectivePage + 1)} className="p-2 disabled:opacity-40">التالي</button></div>
    </div>
    <div className="rounded-xl bg-emerald-50 p-4 space-y-2">
      <p className="text-sm">المحددون: {eligible.length} · طُلب فتح واتساب لـ {eligible.filter(c => opened.includes(c.phone)).length} — ليس تأكيد إرسال.</p>
      <button type="button" disabled={!eligible.length || !message.trim()} onClick={() => { const next = eligible.find(c => !opened.includes(c.phone)); if (next) setActive(next.phone); else setNotice('تم طلب فتح واتساب لكل المحددين. راجع الرسائل داخل واتساب؛ لا يمكن تأكيد إرسالها من هنا.'); }} className="bg-emerald-700 text-white rounded-xl px-4 py-3 disabled:opacity-40">مراجعة رسالة المريض التالي</button>
      <button type="button" onClick={() => { setOpened([]); setNotice('تمت إعادة قائمة الفتح؛ انتبه لعدم إرسال الرسالة مرتين.'); }} className="p-3 text-sm">إعادة قائمة الفتح</button>
    </div>
    {notice && <p role="status" className="text-sm text-amber-800">{notice}</p>}
    {current && <WhatsAppComposer patient={current.patient} appointments={[]} settings={settings} clinicName={clinicName} onClose={() => setActive(null)} campaign={{ template: kind, message, link, attachment, onOpened: () => setOpened(ids => ids.includes(current.phone) ? ids : [...ids, current.phone]) }} />}
  </section>;
}
