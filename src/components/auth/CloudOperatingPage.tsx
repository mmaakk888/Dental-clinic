import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, Cloud, Database, LoaderCircle, LogOut, RefreshCw, ShieldCheck } from 'lucide-react';
import { ClinicLogo } from '../common/ClinicLogo';
import CloudUnavailablePage from './CloudUnavailablePage';
import { isCloudOperatingRequest } from '../../utils/clinicEntryRoute';
import { CLOUD_PROJECT_ID } from '../../utils/cloudIdentity';
import { createFirebaseOperatingAuth } from '../../utils/cloudOperatingAuth';
import { createCloudOperatingPageController, type CloudOperatingPageController,
  type CloudOperatingPageState } from '../../utils/cloudOperatingPageController';

const INITIAL_STATE: CloudOperatingPageState = {
  auth: { phase: 'signed-out', owner: null }, pending: false, closing: false, error: '', cleanupFailed: false,
};

function validRoute() {
  return typeof window !== 'undefined' && isCloudOperatingRequest(window.location.hostname, window.location.search);
}

/** Isolated operating entry. No App import or hydration of local clinic records. */
export default function CloudOperatingPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [view, setView] = useState<CloudOperatingPageState>(INITIAL_STATE);
  const active = useRef<CloudOperatingPageController | null>(null);

  useEffect(() => {
    // A pure controller, not an SDK session. StrictMode remount gets a fresh
    // controller; late results from the disposed instance cannot update it.
    const controller = createCloudOperatingPageController(createFirebaseOperatingAuth, validRoute);
    active.current = controller;
    const unsubscribe = controller.subscribe(next => {
      if (active.current === controller) setView(next);
    });
    setView(controller.getState());
    return () => {
      if (active.current === controller) active.current = null;
      unsubscribe();
      void controller.dispose().catch(() => undefined);
    };
  }, []);

  async function leave(returnToLocal: boolean) {
    const controller = active.current;
    if (!controller) return;
    setPassword('');
    const confirmed = await controller.signOut();
    if (confirmed && returnToLocal && active.current === controller && validRoute()) window.location.assign('/');
  }

  if (!validRoute()) return <CloudUnavailablePage />;

  const busy = view.pending || view.closing;
  const blocked = busy || view.cleanupFailed;
  const owner = view.auth.phase === 'owner-checked' ? view.auth.owner : null;

  return <main dir="rtl" className="min-h-dvh bg-slate-50 px-4 py-5 sm:px-6 sm:py-8 text-slate-900">
    <div className="mx-auto w-full max-w-5xl space-y-5 sm:space-y-7">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3"><ClinicLogo size="lg" layout="icon-only" showText={false} /><div className="min-w-0"><p className="text-xs font-bold text-indigo-600">تجهيز نسخة العيادة السحابية</p><h1 className="mt-1 text-xl sm:text-2xl font-extrabold">دخول التشغيل</h1></div></div>
        <button type="button" onClick={() => void leave(true)} disabled={view.closing || view.cleanupFailed} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-600 disabled:opacity-50"><ArrowRight size={18} aria-hidden="true" /> العودة للنسخة المحلية</button>
      </header>

      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
        <section className="min-w-0 rounded-3xl border border-slate-200 bg-white p-5 sm:p-7 shadow-sm" aria-labelledby="operating-account-title">
          <div className="mb-5 flex items-start gap-3"><span className="rounded-2xl bg-indigo-50 p-3 text-indigo-600"><ShieldCheck size={25} aria-hidden="true" /></span><div className="min-w-0"><h2 id="operating-account-title" className="text-lg font-extrabold">حساب مالك العيادة</h2><p className="mt-1 text-sm leading-7 text-slate-500">نستخدم حساب Firebase وعضويتك المعتمدة، وليس حساب الدخول المحلي.</p></div></div>

          {view.error && <p role="alert" className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm leading-7 text-rose-800">{view.error}</p>}

          {owner ? <div className="space-y-4">
            <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950"><p className="flex items-center gap-2 font-extrabold"><Check size={20} aria-hidden="true" /> تم تأكيد الدخول وعضوية المالك</p><p dir="ltr" className="mt-2 break-all text-sm">{owner.email}</p><p className="mt-2 text-sm leading-7">هذه نتيجة فحص حديثة، وليست تفعيلًا لحفظ ملفات المرضى أو مزامنتها.</p></div>
            <button type="button" disabled={blocked} onClick={() => void active.current?.refresh()} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 font-bold text-indigo-700 disabled:opacity-50"><RefreshCw size={19} aria-hidden="true" /> إعادة التحقق من الجلسة</button>
          </div> : <form className="space-y-4" aria-busy={busy} onSubmit={event => {
            event.preventDefault();
            const controller = active.current;
            if (!controller || blocked) return;
            const submittedPassword = password;
            setPassword('');
            void controller.signIn(email, submittedPassword);
          }}>
            <div className="space-y-2"><label htmlFor="operating-email" className="block text-sm font-bold">إيميل حساب الموقع على Firebase</label><input id="operating-email" name="email" dir="ltr" type="email" autoComplete="username" required maxLength={254} disabled={blocked} value={email} onChange={event => setEmail(event.target.value)} className="min-h-12 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-4 py-3 text-base outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:opacity-60" /></div>
            <div className="space-y-2"><label htmlFor="operating-password" className="block text-sm font-bold">كلمة سر الموقع، وليست كلمة سر Google</label><input id="operating-password" name="password" type="password" autoComplete="current-password" required maxLength={4096} disabled={blocked} value={password} onChange={event => setPassword(event.target.value)} className="min-h-12 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-4 py-3 text-base outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:opacity-60" /></div>
            <button type="submit" disabled={blocked} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 font-extrabold text-white disabled:opacity-50">{busy ? <LoaderCircle size={20} aria-hidden="true" /> : <ShieldCheck size={20} aria-hidden="true" />}{busy ? 'جارٍ التحقق…' : 'الدخول والتحقق من العضوية'}</button>
            <p className="text-xs leading-6 text-slate-500">الدخول مؤقت في الذاكرة فقط. لا نحفظ كلمة السر ضمن إعدادات العيادة، ولا نستخدم «تذكرني» في هذه المرحلة.</p>
          </form>}

          {(busy || owner) && <button type="button" disabled={view.closing || view.cleanupFailed} onClick={() => void leave(false)} className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-700 disabled:opacity-50"><LogOut size={18} aria-hidden="true" />{view.closing ? 'جارٍ إغلاق الجلسة…' : busy ? 'إلغاء العملية وتسجيل الخروج' : 'تسجيل الخروج'}</button>}
          {busy && <p role="status" className="mt-3 text-sm leading-7 text-slate-500">{view.closing ? 'ننتظر انتهاء الطلب القديم لتأكيد الخروج، دون فتح أي ملفات.' : 'جارٍ فحص الحساب والعضوية من الخادم…'}</p>}
        </section>

        <aside className="min-w-0 space-y-4" aria-labelledby="operating-readiness-title">
          <section className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-7 shadow-sm"><h2 id="operating-readiness-title" className="text-lg font-extrabold">قبل بدء العمل أونلاين</h2><ol className="mt-5 space-y-4">
            <li className="flex items-start gap-3"><span className={`rounded-xl p-2.5 ${owner ? 'bg-emerald-50 text-emerald-700' : 'bg-indigo-50 text-indigo-600'}`}><ShieldCheck size={21} aria-hidden="true" /></span><div className="min-w-0"><p className="font-bold">دخول المالك والعضوية</p><p className="mt-1 text-sm leading-7 text-slate-500">{owner ? 'تم تأكيدهما في هذه الجلسة.' : 'هذا المدخل يفحصهما من Firebase.'}</p></div></li>
            <li className="flex items-start gap-3"><span className="rounded-xl bg-slate-100 p-2.5 text-slate-500"><Database size={21} aria-hidden="true" /></span><div className="min-w-0"><p className="font-bold">حفظ العيادة والصلاحيات</p><p className="mt-1 text-sm leading-7 text-slate-500">قيد الربط والاختبار. ملفات المرضى والماليات غير متاحة هنا، ولم تُنقل البيانات التجريبية.</p></div></li>
            <li className="flex items-start gap-3"><span className="rounded-xl bg-slate-100 p-2.5 text-slate-500"><Cloud size={21} aria-hidden="true" /></span><div className="min-w-0"><p className="font-bold">النشر والتشغيل</p><p className="mt-1 text-sm leading-7 text-slate-500">لم يُنشر الموقع بعد. يبدأ العمل الحقيقي بعد اختبار الحفظ والصلاحيات من جهازين.</p></div></li>
          </ol></section>
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-7 text-amber-950">لا تدخل بيانات مرضى حقيقية في هذه المرحلة. نجاح الدخول لا يعني أن نظام العيادة جاهز للاستخدام السحابي.</div>
          <p className="px-1 text-xs leading-6 text-slate-500">المشروع: <bdi className="break-all">{CLOUD_PROJECT_ID}</bdi><br />لا إنشاء حسابات أو رفع بيانات بمجرد فتح هذه الصفحة.</p>
        </aside>
      </div>
    </div>
  </main>;
}
