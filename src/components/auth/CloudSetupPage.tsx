import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, CheckCircle2, Cloud, LoaderCircle, LockKeyhole, Mail, RefreshCw } from 'lucide-react';
import { cloudSetupErrorMessage, cloudSetupNeedsSignIn, createCloudAuthSetupService, type CloudSetupSession } from '../../utils/cloudAuthSetup';
import { CLOUD_PROJECT_ID, type CloudOwnerIdentity } from '../../utils/cloudIdentity';
import { isCloudSetupRequest } from '../../utils/cloudSetupRoute';
import type { CloudOwnerMembershipAssessment } from '../../utils/cloudMembership';

export default function CloudSetupPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [identity, setIdentity] = useState<CloudOwnerIdentity | null>(null);
  const [membership, setMembership] = useState<CloudOwnerMembershipAssessment | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [mailCooldown, setMailCooldown] = useState(false);
  const mounted = useRef(false);
  const pending = useRef(false);
  const service = useRef<Promise<CloudSetupSession> | null>(null);
  const mailTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (mailTimer.current) clearTimeout(mailTimer.current);
      const oldService = service.current;
      service.current = null;
      void oldService?.then(session => session.dispose()).catch(() => undefined);
    };
  }, []);

  async function getSession() {
    if (!service.current) {
      const started = createCloudAuthSetupService();
      service.current = started;
      void started.catch(() => { if (service.current === started) service.current = null; });
    }
    return service.current;
  }

  async function run(action: (session: CloudSetupSession) => Promise<void>, clearIdentityOnError = false) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true); setError(''); setMessage(''); setMembership(null);
    try { await action(await getSession()); }
    catch (cause) {
      if (mounted.current) { setError(cloudSetupErrorMessage(cause)); if (clearIdentityOnError || cloudSetupNeedsSignIn(cause)) setIdentity(null); }
    } finally {
      pending.current = false;
      if (mounted.current) { setBusy(false); setPassword(''); }
    }
  }

  if (typeof window === 'undefined' || !isCloudSetupRequest(window.location.hostname, window.location.search)) {
    return <main dir="rtl" className="min-h-screen grid place-items-center bg-slate-50 p-6"><p role="alert">صفحة التجهيز متاحة على نفس اللاب فقط، بالرابط المحلي المخصص لها.</p></main>;
  }

  const verified = identity?.status === 'owner-confirmed';
  return <main dir="rtl" className="min-h-dvh bg-slate-50 px-4 py-8 sm:py-12 text-slate-900">
    <section className="mx-auto max-w-xl space-y-5">
      <a href="/" className="inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm font-bold text-slate-600 focus-visible:outline-2 focus-visible:outline-indigo-600"><ArrowRight size={18} /> العودة للنسخة المحلية</a>
      <div className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-8 shadow-sm space-y-6">
        <header className="flex items-start gap-3">
          <div className="rounded-2xl bg-indigo-50 p-3 text-indigo-600"><Cloud size={26} /></div>
          <div className="min-w-0"><p className="text-xs font-bold text-indigo-600 mb-1">تجهيز Firebase · الحساب والربط</p><h1 className="text-xl sm:text-2xl font-extrabold">تأكيد حساب مالك العيادة</h1><p className="text-sm text-slate-500 mt-2 leading-6">صفحة مستقلة لتأكيد الدخول والبريد وفحص عضوية المالك. لا تحمل ملفات المرضى أو ترفعها.</p></div>
        </header>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-7 text-amber-950">الموقع ما زال محليًا. نجاح هذه الخطوة لا يشغّل المزامنة ولا يتيح ملفات المرضى أو الماليات.</div>
        {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm leading-6 text-rose-800">{error}</p>}
        {message && <p role="status" className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm leading-6 text-sky-900">{message}</p>}
        {!identity ? <form className="space-y-4" aria-busy={busy} onSubmit={event => {
          event.preventDefault();
          void run(async session => {
            const next = await session.signIn(email, password);
            if (mounted.current) setIdentity(next);
          }, true);
        }}>
          <div className="space-y-2"><label className="block text-sm font-bold" htmlFor="cloud-setup-email">إيميل حساب Firebase الذي أضفته</label><input id="cloud-setup-email" name="email" dir="ltr" type="email" autoComplete="username" required maxLength={254} disabled={busy} value={email} onChange={e => setEmail(e.target.value)} className="w-full min-w-0 rounded-xl border border-slate-300 bg-white px-4 py-3 text-base outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:opacity-60" /></div>
          <div className="space-y-2"><label className="block text-sm font-bold" htmlFor="cloud-setup-password">الباسورد الجديد الخاص بالموقع، وليس Google</label><input id="cloud-setup-password" name="password" type="password" autoComplete="current-password" required maxLength={4096} disabled={busy} value={password} onChange={e => setPassword(e.target.value)} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:opacity-60" /></div>
          <button type="submit" disabled={busy} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 font-bold text-white disabled:opacity-50">{busy ? <LoaderCircle className="animate-spin" size={20} /> : <LockKeyhole size={20} />} {busy ? 'جاري التحقق…' : 'التحقق من حسابي'}</button>
          <p className="text-xs leading-6 text-slate-500">الدخول هنا مؤقت في الذاكرة فقط؛ لا نُنشئ «تذكرني» أو جلسة للنظام المحلي، ولا نحفظ كلمة السر في بيانات العيادة.</p>
        </form> : <div className="space-y-4" aria-busy={busy}>
          <div className={`rounded-2xl border p-4 ${verified ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50'}`}>
            <h2 className="flex items-center gap-2 font-bold">{verified ? <CheckCircle2 size={20} className="text-emerald-600" /> : <Mail size={20} className="text-indigo-600" />} {verified ? 'هوية المالك والبريد مؤكدان' : 'الدخول صحيح؛ باقي تأكيد البريد'}</h2>
            <p dir="ltr" className="mt-2 break-all text-sm text-slate-600">{identity.email}</p>
            <p className="mt-2 text-sm leading-7 text-slate-600">{verified ? 'البريد جاهز. اضغط فحص الربط للتحقق من سجل عضويتك على قاعدة البيانات. هذه ليست مزامنة أو صلاحية لملفات المرضى.' : 'اضغط إرسال رسالة التأكيد، وافتح الرسالة في بريدك ثم اضغط رابط التأكيد. بعد ذلك ارجع هنا وحدّث الحالة.'}</p>
          </div>
          {verified && <div className="space-y-3">
            <button type="button" disabled={busy} onClick={() => void run(async session => {
              const next = await session.checkMembership();
              if (mounted.current) setMembership(next);
            })} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 p-3 font-bold text-white disabled:opacity-50"><Cloud size={19} /> فحص الربط بقاعدة البيانات</button>
            {membership && <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-7 text-emerald-900"><p className="font-bold">تم تأكيد عضوية المالك والاتصال بقاعدة البيانات</p><p>تمت قراءة سجل عضويتك فقط. ملفات المرضى والماليات لم تُنقل، والموقع لم يُنشر بعد.</p></div>}
            <p className="text-xs leading-6 text-slate-500">لو كانت الصفحة مفتوحة قبل تجهيز العضوية، سجّل الخروج والدخول من جديد أولًا؛ تحديث الرمز وحده لا يجدد وقت تسجيل الدخول.</p>
          </div>}
          {!verified && <button type="button" disabled={busy || mailCooldown} onClick={() => void run(async session => {
            await session.sendVerification();
            if (!mounted.current) return;
            setMessage('طلب Firebase إرسال رسالة تأكيد لبريدك. راجع الوارد والرسائل غير المرغوب فيها؛ لا ترسل رابط التأكيد في المحادثة.');
            setMailCooldown(true);
            mailTimer.current = setTimeout(() => { if (mounted.current) setMailCooldown(false); }, 30000);
          })} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 p-3 font-bold text-white disabled:opacity-50"><Mail size={19} /> {mailCooldown ? 'انتظر قليلًا قبل إعادة الإرسال' : 'إرسال رسالة تأكيد البريد'}</button>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button type="button" disabled={busy} onClick={() => void run(async session => { const next = await session.refresh(); if (mounted.current) setIdentity(next); }, true)} className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white p-3 font-bold disabled:opacity-50"><RefreshCw className={busy ? 'animate-spin' : ''} size={18} /> تحديث حالة التأكيد</button>
            <button type="button" disabled={busy} onClick={() => void run(async session => { await session.signOut(); if (mounted.current) { setIdentity(null); setMessage('تم الخروج من جلسة التجهيز فقط.'); } })} className="min-h-12 rounded-xl border border-slate-300 bg-white p-3 font-bold disabled:opacity-50">تسجيل الخروج</button>
          </div>
        </div>}
        <footer className="border-t border-slate-100 pt-4 text-xs leading-6 text-slate-500"><span>المشروع: </span><bdi className="break-all">{CLOUD_PROJECT_ID}</bdi><br />لم يتم نشر الموقع أو ترحيل ملفات المرضى.</footer>
      </div>
    </section>
  </main>;
}
