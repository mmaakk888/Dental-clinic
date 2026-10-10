import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, Cloud, Database, Eye, FolderHeart, LoaderCircle, LogOut, RefreshCw, ShieldCheck, UsersRound } from 'lucide-react';
import { ClinicLogo } from '../common/ClinicLogo';
import CloudUnavailablePage from './CloudUnavailablePage';
import { isCloudOperatingRequest } from '../../utils/clinicEntryRoute';
import { CLOUD_PROJECT_ID } from '../../utils/cloudIdentity';
import { createFirebaseOperatingAuth } from '../../utils/cloudOperatingAuth';
import { CLOUD_CONTACTS_UI_STAGE, createCloudContactUiPreview } from '../../utils/cloudContactUiStage';
import type { createCloudContactWorkspaceController } from '../../utils/cloudContactWorkspaceController';
import { CLOUD_PATIENTS_UI_STAGE, createCloudPatientUiPreview } from '../../utils/cloudPatientUiStage';
import type { CloudPatientWorkspaceController } from '../../utils/cloudPatientWorkspaceController';
import { createCloudOperatingPageController, type CloudOperatingPageController,
  type CloudOperatingPageState } from '../../utils/cloudOperatingPageController';

const CloudContactsWorkspace = lazy(() => import('../contacts/CloudContactsWorkspace'));
const CloudPatientsWorkspace = lazy(() => import('../patients/CloudPatientsWorkspace'));
type ContactsWorkspace = ReturnType<typeof createCloudContactWorkspaceController>;

const INITIAL_STATE: CloudOperatingPageState = {
  auth: { phase: 'signed-out', owner: null }, pending: false, closing: false, error: '', cleanupFailed: false,
  contacts: { phase: 'closed', error: '' },
  patients: { phase: 'closed', error: '' },
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
  const previewRef = useRef<ContactsWorkspace | null>(null);
  const [preview, setPreview] = useState<ContactsWorkspace | null>(null);
  const [workspace, setWorkspace] = useState<ContactsWorkspace | null>(null);
  const patientPreviewRef = useRef<CloudPatientWorkspaceController | null>(null);
  const [patientPreview, setPatientPreview] = useState<CloudPatientWorkspaceController | null>(null);
  const [patientWorkspace, setPatientWorkspace] = useState<CloudPatientWorkspaceController | null>(null);

  useEffect(() => {
    // A pure controller, not an SDK session. StrictMode remount gets a fresh
    // controller; late results from the disposed instance cannot update it.
    const controller = createCloudOperatingPageController(createFirebaseOperatingAuth, validRoute);
    active.current = controller;
    const unsubscribe = controller.subscribe(next => {
      if (active.current === controller) {
        setView(next);
        // Temporary Auth checking keeps the same workspace lease. Actual
        // identity loss disposes it in the parent before this UI notification.
        if (next.contacts.phase !== 'open') setWorkspace(null);
        if (next.patients.phase !== 'open') setPatientWorkspace(null);
      }
    });
    setView(controller.getState());
    return () => {
      if (active.current === controller) active.current = null;
      previewRef.current?.dispose();
      previewRef.current = null;
      patientPreviewRef.current?.dispose();
      patientPreviewRef.current = null;
      unsubscribe();
      void controller.dispose().catch(() => undefined);
    };
  }, []);

  async function leave(returnToLocal: boolean) {
    const controller = active.current;
    if (!controller) return;
    const contacts = controller.getContactsWorkspace()?.getState();
    const patients = controller.getPatientsWorkspace()?.getState();
    if ([contacts, patients].some(current => current?.draft || current && current.saveStatus !== 'idle')
      && !window.confirm('الخروج يمسح المسودة من هذه الصفحة. إذا وصلت عملية للخادم فلن يلغيها الخروج. هل تريد المتابعة؟')) return;
    previewRef.current?.dispose();
    previewRef.current = null;
    setPreview(null);
    setWorkspace(null);
    patientPreviewRef.current?.dispose();
    patientPreviewRef.current = null;
    setPatientPreview(null);
    setPatientWorkspace(null);
    setPassword('');
    const confirmed = await controller.signOut();
    if (confirmed && returnToLocal && active.current === controller && validRoute()) window.location.assign('/');
  }

  function openPreview() {
    const parent = active.current;
    if (!parent || !validRoute() || previewRef.current || patientPreviewRef.current) return;
    const status = parent.getState();
    if (status.pending || status.closing || status.cleanupFailed || status.contacts.phase !== 'closed'
      || status.patients.phase !== 'closed') return;
    const controller: ContactsWorkspace = createCloudContactUiPreview(() => previewRef.current === controller
      && active.current === parent && validRoute());
    previewRef.current = controller;
    setPreview(controller);
  }

  async function openContacts() {
    // Source-reviewed readiness, not permission: server authorization remains
    // mandatory when this future feature is released. No URL/setting bypass.
    if (!CLOUD_CONTACTS_UI_STAGE.available) return;
    const controller = active.current;
    if (!controller || !validRoute() || previewRef.current || patientPreviewRef.current) return;
    const contacts = await controller.openContacts();
    if (!contacts || active.current !== controller || !validRoute()
      || controller.getContactsWorkspace() !== contacts) return;
    setWorkspace(contacts);
    await contacts.loadFirst();
  }

  function closeContacts(displayed: ContactsWorkspace) {
    if (previewRef.current === displayed) {
      previewRef.current.dispose();
      previewRef.current = null;
      setPreview(null);
    } else if (active.current?.getContactsWorkspace() === displayed && active.current.closeContacts(displayed)) setWorkspace(null);
  }

  function openPatientPreview() {
    const parent = active.current;
    if (!parent || !validRoute() || previewRef.current || patientPreviewRef.current) return;
    const status = parent.getState();
    if (status.pending || status.closing || status.cleanupFailed || status.contacts.phase !== 'closed'
      || status.patients.phase !== 'closed') return;
    const controller: CloudPatientWorkspaceController = createCloudPatientUiPreview(() => patientPreviewRef.current === controller
      && active.current === parent && validRoute());
    patientPreviewRef.current = controller;
    setPatientPreview(controller);
  }

  async function openPatients() {
    if (!CLOUD_PATIENTS_UI_STAGE.available) return;
    const controller = active.current;
    if (!controller || !validRoute() || previewRef.current || patientPreviewRef.current) return;
    const patients = await controller.openPatients();
    if (!patients || active.current !== controller || !validRoute()
      || controller.getPatientsWorkspace() !== patients) return;
    setPatientWorkspace(patients);
    await patients.refresh();
  }

  function closePatients(displayed: CloudPatientWorkspaceController) {
    if (patientPreviewRef.current === displayed) {
      displayed.dispose();
      patientPreviewRef.current = null;
      setPatientPreview(null);
    } else if (active.current?.getPatientsWorkspace() === displayed && active.current.closePatients(displayed)) setPatientWorkspace(null);
  }

  if (!validRoute()) return <CloudUnavailablePage />;

  const busy = view.pending || view.closing;
  const blocked = busy || view.cleanupFailed;
  const owner = view.auth.phase === 'owner-checked' ? view.auth.owner : null;
  const displayedWorkspace = preview ?? workspace;
  const displayedPatients = patientPreview ?? patientWorkspace;

  return <main dir="rtl" className="min-h-dvh bg-slate-50 px-4 py-5 sm:px-6 sm:py-8 text-slate-900">
    <div className="mx-auto w-full max-w-5xl space-y-5 sm:space-y-7">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3"><ClinicLogo size="lg" layout="icon-only" showText={false} /><div className="min-w-0"><p className="text-xs font-bold text-indigo-600">تجهيز نسخة العيادة السحابية</p><h1 className="mt-1 text-xl sm:text-2xl font-extrabold">دخول التشغيل</h1></div></div>
        <button type="button" onClick={() => void leave(true)} disabled={view.closing || view.cleanupFailed} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-600 disabled:opacity-50"><ArrowRight size={18} aria-hidden="true" /> العودة للنسخة المحلية</button>
      </header>

      {displayedPatients ? <Suspense fallback={<section role="status" className="rounded-3xl border border-slate-200 bg-white p-6 text-sm leading-7">جارٍ فتح واجهة ملفات المرضى…</section>}>
        <CloudPatientsWorkspace controller={displayedPatients} onClose={() => closePatients(displayedPatients)} previewOnly={patientPreview !== null} closing={view.closing} />
      </Suspense> : displayedWorkspace ? <Suspense fallback={<section role="status" className="rounded-3xl border border-slate-200 bg-white p-6 text-sm leading-7">جارٍ فتح واجهة جهات الاتصال…</section>}>
        <CloudContactsWorkspace controller={displayedWorkspace} onClose={() => closeContacts(displayedWorkspace)} previewOnly={preview !== null} />
      </Suspense> : <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
        <section className="min-w-0 rounded-3xl border border-slate-200 bg-white p-5 sm:p-7 shadow-sm" aria-labelledby="operating-account-title">
          <div className="mb-5 flex items-start gap-3"><span className="rounded-2xl bg-indigo-50 p-3 text-indigo-600"><ShieldCheck size={25} aria-hidden="true" /></span><div className="min-w-0"><h2 id="operating-account-title" className="text-lg font-extrabold">حساب مالك العيادة</h2><p className="mt-1 text-sm leading-7 text-slate-500">نستخدم حساب Firebase وعضويتك المعتمدة، وليس حساب الدخول المحلي.</p></div></div>

          {view.error && <p role="alert" className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm leading-7 text-rose-800">{view.error}</p>}

          {owner ? <div className="space-y-4">
            <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950"><p className="flex items-center gap-2 font-extrabold"><Check size={20} aria-hidden="true" /> تم تأكيد الدخول وعضوية المالك</p><p dir="ltr" className="mt-2 break-all text-sm">{owner.email}</p><p className="mt-2 text-sm leading-7">هذه نتيجة فحص حديثة، وليست تفعيلًا لحفظ ملفات المرضى أو مزامنتها.</p></div>
            <button type="button" disabled={blocked} onClick={() => void active.current?.refresh()} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 font-bold text-indigo-700 disabled:opacity-50"><RefreshCw size={19} aria-hidden="true" /> إعادة التحقق من الجلسة</button>
          </div> : <form className="space-y-4" aria-busy={busy} onSubmit={event => {
            event.preventDefault();
            const controller = active.current;
            if (!controller || blocked || previewRef.current || patientPreviewRef.current) return;
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
          <section aria-labelledby="operating-patients-title" className="rounded-3xl border border-indigo-100 bg-white p-5 sm:p-7 shadow-sm">
            <div className="flex items-start gap-3"><span className="shrink-0 rounded-2xl bg-indigo-50 p-3 text-indigo-600"><FolderHeart size={23} aria-hidden="true" /></span><div className="min-w-0"><h2 id="operating-patients-title" className="text-lg font-extrabold">ملفات المرضى السحابية</h2><p className="mt-1 text-sm leading-7 text-slate-500">ملف تعريفي مرتب ورقم تلقائي مشترك، مع بحث بالرقم أو الهاتف.</p></div></div>
            <p id="operating-patients-stage" className="mt-4 rounded-xl bg-amber-50 p-3 text-sm leading-7 text-amber-950">{CLOUD_PATIENTS_UI_STAGE.reason}</p>
            <button type="button" disabled={blocked} onClick={openPatientPreview} className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm font-bold text-indigo-700 disabled:opacity-50"><Eye size={19} aria-hidden="true" />معاينة واجهة ملفات المرضى</button>
            <p className="mt-2 text-xs leading-6 text-slate-500">معاينة فارغة للتصميم فقط، بلا بيانات أو اتصال بقاعدة البيانات. لا يلزم تسجيل الدخول لمشاهدتها.</p>
            {owner && <button type="button" aria-describedby="operating-patients-stage" disabled={blocked || !CLOUD_PATIENTS_UI_STAGE.available || view.patients.phase === 'opening'} onClick={() => void openPatients()} className="mt-3 flex min-h-11 w-full items-center justify-center rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-500 disabled:cursor-not-allowed disabled:opacity-60">{CLOUD_PATIENTS_UI_STAGE.available ? 'فتح ملفات المرضى من الخادم' : 'حفظ ملفات المرضى غير مفعّل بعد'}</button>}
            {view.patients.error && <p role="alert" className="mt-3 rounded-xl bg-rose-50 p-3 text-sm leading-7 text-rose-800">{view.patients.error}</p>}
          </section>
          <section aria-labelledby="operating-contacts-title" className="rounded-3xl border border-indigo-100 bg-white p-5 sm:p-7 shadow-sm">
            <div className="flex items-start gap-3"><span className="shrink-0 rounded-2xl bg-indigo-50 p-3 text-indigo-600"><UsersRound size={23} aria-hidden="true" /></span><div className="min-w-0"><h2 id="operating-contacts-title" className="text-lg font-extrabold">جهات الاتصال السحابية</h2><p className="mt-1 text-sm leading-7 text-slate-500">واجهة مرتبة للموبايل والكمبيوتر، وحالات واضحة للحفظ وإعادة المحاولة.</p></div></div>
            <p id="operating-contacts-stage" className="mt-4 rounded-xl bg-amber-50 p-3 text-sm leading-7 text-amber-950">{CLOUD_CONTACTS_UI_STAGE.reason}</p>
            <button type="button" disabled={blocked} onClick={openPreview} className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm font-bold text-indigo-700 disabled:opacity-50"><Eye size={19} aria-hidden="true" />معاينة واجهة جهات الاتصال</button>
            <p className="mt-2 text-xs leading-6 text-slate-500">معاينة فارغة للتصميم فقط، بلا بيانات أو اتصال بقاعدة البيانات. لا يلزم تسجيل الدخول لمشاهدتها.</p>
            {owner && <button type="button" aria-describedby="operating-contacts-stage" disabled={blocked || !CLOUD_CONTACTS_UI_STAGE.available || view.contacts.phase === 'opening'} onClick={() => void openContacts()} className="mt-3 flex min-h-11 w-full items-center justify-center rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-500 disabled:cursor-not-allowed disabled:opacity-60">{CLOUD_CONTACTS_UI_STAGE.available ? 'فتح جهات الاتصال من الخادم' : 'الحفظ السحابي غير مفعّل بعد'}</button>}
            {view.contacts.error && <p role="alert" className="mt-3 rounded-xl bg-rose-50 p-3 text-sm leading-7 text-rose-800">{view.contacts.error}</p>}
          </section>
          <section className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-7 shadow-sm"><h2 id="operating-readiness-title" className="text-lg font-extrabold">قبل بدء العمل أونلاين</h2><ol className="mt-5 space-y-4">
            <li className="flex items-start gap-3"><span className={`rounded-xl p-2.5 ${owner ? 'bg-emerald-50 text-emerald-700' : 'bg-indigo-50 text-indigo-600'}`}><ShieldCheck size={21} aria-hidden="true" /></span><div className="min-w-0"><p className="font-bold">دخول المالك والعضوية</p><p className="mt-1 text-sm leading-7 text-slate-500">{owner ? 'تم تأكيدهما في هذه الجلسة.' : 'هذا المدخل يفحصهما من Firebase.'}</p></div></li>
            <li className="flex items-start gap-3"><span className="rounded-xl bg-slate-100 p-2.5 text-slate-500"><Database size={21} aria-hidden="true" /></span><div className="min-w-0"><p className="font-bold">حفظ العيادة والصلاحيات</p><p className="mt-1 text-sm leading-7 text-slate-500">قيد الربط والاختبار. ملفات المرضى والماليات غير متاحة هنا، ولم تُنقل البيانات التجريبية.</p></div></li>
            <li className="flex items-start gap-3"><span className="rounded-xl bg-slate-100 p-2.5 text-slate-500"><Cloud size={21} aria-hidden="true" /></span><div className="min-w-0"><p className="font-bold">النشر والتشغيل</p><p className="mt-1 text-sm leading-7 text-slate-500">لم يُنشر الموقع بعد. يبدأ العمل الحقيقي بعد اختبار الحفظ والصلاحيات من جهازين.</p></div></li>
          </ol></section>
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-7 text-amber-950">لا تدخل بيانات مرضى حقيقية في هذه المرحلة. نجاح الدخول لا يعني أن نظام العيادة جاهز للاستخدام السحابي.</div>
          <p className="px-1 text-xs leading-6 text-slate-500">المشروع: <bdi className="break-all">{CLOUD_PROJECT_ID}</bdi><br />لا إنشاء حسابات أو رفع بيانات بمجرد فتح هذه الصفحة.</p>
        </aside>
      </div>}
    </div>
  </main>;
}
