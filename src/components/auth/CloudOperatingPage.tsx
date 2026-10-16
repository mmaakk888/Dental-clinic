import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, ClipboardList, Cloud, Database, Eye, FolderHeart, LoaderCircle, LogOut, RefreshCw, ShieldCheck, Tags, UsersRound } from 'lucide-react';
import { ClinicLogo } from '../common/ClinicLogo';
import CloudUnavailablePage from './CloudUnavailablePage';
import { isCloudOperatingRequest } from '../../utils/clinicEntryRoute';
import { CLOUD_PROJECT_ID } from '../../utils/cloudIdentity';
import { createFirebaseOperatingAuth } from '../../utils/cloudOperatingAuth';
import { CLOUD_CONTACTS_UI_STAGE, createCloudContactUiPreview } from '../../utils/cloudContactUiStage';
import type { createCloudContactWorkspaceController } from '../../utils/cloudContactWorkspaceController';
import { CLOUD_PATIENTS_UI_STAGE, createCloudPatientUiPreview } from '../../utils/cloudPatientUiStage';
import type { CloudPatientWorkspaceController } from '../../utils/cloudPatientWorkspaceController';
import { CLOUD_CLINICAL_UI_STAGE, createCloudClinicalUiPreview,
  type CloudClinicalWorkspaceBundle } from '../../utils/cloudClinicalUiStage';
import { createCloudOperatingPageController, type CloudOperatingPageController,
  type CloudOperatingPageState } from '../../utils/cloudOperatingPageController';
import { CLOUD_CATALOG_UI_STAGE, createCloudCatalogUiPreview } from '../../utils/cloudCatalogUiStage';
import type { CloudCatalogWorkspaceController } from '../../utils/cloudCatalogWorkspaceController';
import { CLOUD_COMPLETE_RELEASE_UI, createCloudReleaseWorkspace, type CloudReleaseWorkspace } from '../../utils/cloudReleaseWorkspaceFactories';
import type { CloudShellBranding, CloudShellSection } from './CloudClinicShell';
import { CloudSelectedPatientDisplay, CloudSelectedPatientDisplayView } from '../patient/CloudSelectedPatientDisplay';
import type { CloudOperatingOwner } from '../../utils/cloudOperatingAuth';

const CloudContactsWorkspace = lazy(() => import('../contacts/CloudContactsWorkspace'));
const CloudPatientsWorkspace = lazy(() => import('../patients/CloudPatientsWorkspace'));
const CloudClinicalWorkspace = lazy(() => import('../patients/CloudClinicalWorkspace'));
const CloudServiceCatalogWorkspace = lazy(() => import('../settings/CloudServiceCatalogWorkspace'));
const CloudAppointmentsWorkspace = lazy(() => import('../appointments/CloudAppointmentsWorkspace'));
const CloudClinicSettingsWorkspace = lazy(() => import('../settings/CloudClinicSettingsWorkspace'));
const CloudProstheticWorkspace = lazy(() => import('../labs/CloudProstheticWorkspace').then(module => ({ default: module.CloudProstheticWorkspace })));
const CloudPrescriptionWorkspace = lazy(() => import('../patient/CloudPrescriptionWorkspace'));
const CloudExpensesWorkspace = lazy(() => import('../summary/CloudExpensesWorkspace').then(module => ({ default: module.CloudExpensesWorkspace })));
const CloudClinicOverviewWorkspace = lazy(() => import('../summary/CloudClinicOverviewWorkspace').then(module => ({ default: module.CloudClinicOverviewWorkspace })));
const CloudTransferWorkspace = lazy(() => import('../settings/CloudTransferWorkspace').then(module => ({ default: module.CloudTransferWorkspace })));
const CloudWhatsAppWorkspace = lazy(() => import('../settings/CloudWhatsAppWorkspace').then(module => ({ default: module.CloudWhatsAppWorkspace })));
const CloudClinicShell = lazy(() => import('./CloudClinicShell').then(module => ({ default: module.CloudClinicShell })));
const CloudClinicClock = lazy(() => import('./CloudClinicShell').then(module => ({ default: module.CloudClinicClock })));
type ContactsWorkspace = ReturnType<typeof createCloudContactWorkspaceController>;

const INITIAL_STATE: CloudOperatingPageState = {
  auth: { phase: 'signed-out', owner: null }, pending: false, closing: false, error: '', cleanupFailed: false,
  contacts: { phase: 'closed', error: '' },
  patients: { phase: 'closed', error: '' },
  clinical: { phase: 'closed', error: '' },
  catalog: { phase: 'closed', error: '' },
};

function validRoute() {
  return typeof window !== 'undefined' && isCloudOperatingRequest(window.location.hostname, window.location.search, window.location.protocol);
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
  const clinicalPreviewRef = useRef<CloudClinicalWorkspaceBundle | null>(null);
  const [clinicalPreview, setClinicalPreview] = useState<CloudClinicalWorkspaceBundle | null>(null);
  const [clinicalWorkspace, setClinicalWorkspace] = useState<CloudClinicalWorkspaceBundle | null>(null);
  const catalogPreviewRef = useRef<CloudCatalogWorkspaceController | null>(null);
  const [catalogPreview, setCatalogPreview] = useState<CloudCatalogWorkspaceController | null>(null);
  const [catalogWorkspace, setCatalogWorkspace] = useState<CloudCatalogWorkspaceController | null>(null);
  const additionalRef = useRef<CloudReleaseWorkspace | null>(null);
  const [additional, setAdditional] = useState<CloudReleaseWorkspace | null>(null);
  const lastOwner = useRef<CloudOperatingOwner | null>(null);
  const [branding, setBranding] = useState<CloudShellBranding | null>(null);
  const [patientDisplay, setPatientDisplay] = useState(false);
  const [displayNotice, setDisplayNotice] = useState('');
  const [selectingWalkIn, setSelectingWalkIn] = useState(false);
  const hasPreview = () => !!(previewRef.current || patientPreviewRef.current || clinicalPreviewRef.current || catalogPreviewRef.current);

  useEffect(() => {
    // A pure controller, not an SDK session. StrictMode remount gets a fresh
    // controller; late results from the disposed instance cannot update it.
    const controller = createCloudOperatingPageController(createFirebaseOperatingAuth, validRoute);
    active.current = controller;
    const unsubscribe = controller.subscribe(next => {
      if (active.current === controller) {
        setView(next);
        if (next.auth.phase === 'owner-checked' && next.auth.owner) {
          if (lastOwner.current && lastOwner.current.uid !== next.auth.owner.uid) { setBranding(null); setPatientDisplay(false); }
          lastOwner.current = next.auth.owner;
        } else if (next.auth.phase !== 'checking') {
          lastOwner.current = null; setBranding(null); setPatientDisplay(false); setDisplayNotice(''); setSelectingWalkIn(false);
        }
        // Temporary Auth checking keeps the same workspace lease. Actual
        // identity loss disposes it in the parent before this UI notification.
        if (next.contacts.phase !== 'open') setWorkspace(null);
        if (next.patients.phase !== 'open') setPatientWorkspace(null);
        if (next.clinical.phase !== 'open') setClinicalWorkspace(null);
        if (next.catalog.phase !== 'open') setCatalogWorkspace(null);
        if (additionalRef.current && controller.getAdditionalWorkspace() !== additionalRef.current) {
          additionalRef.current = null; setAdditional(null);
        }
      }
    });
    setView(controller.getState());
    return () => {
      if (active.current === controller) active.current = null;
      previewRef.current?.dispose();
      previewRef.current = null;
      patientPreviewRef.current?.dispose();
      patientPreviewRef.current = null;
      clinicalPreviewRef.current?.visit?.dispose();
      clinicalPreviewRef.current?.file.dispose();
      clinicalPreviewRef.current?.recovery.dispose();
      clinicalPreviewRef.current = null;
      catalogPreviewRef.current?.dispose();
      catalogPreviewRef.current = null;
      additionalRef.current = null;
      lastOwner.current = null;
      unsubscribe();
      void controller.dispose().catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    if (!additional || !['home', 'directory', 'finance', 'export'].includes(additional.kind)) return;
    if (!(additional.kind === 'home' || additional.kind === 'directory' || additional.kind === 'finance' || additional.kind === 'export')) return;
    const parent = active.current, ownerUid = lastOwner.current?.uid;
    const update = () => {
      if (!parent || !ownerUid || active.current !== parent || lastOwner.current?.uid !== ownerUid
        || parent.getAdditionalWorkspace(additional.kind) !== additional) return;
      const state = additional.controller.getState();
      if (state.closed || !state.snapshot) return;
      const data = state.snapshot.settings.clinicSettings.data;
      setBranding({ identity: data.identity, theme: data.theme, content: data.content, readTime: state.snapshot.readTime, logo: state.logo });
    };
    update(); return additional.controller.subscribe(update);
  }, [additional]);

  async function leave(returnToLocal: boolean) {
    const controller = active.current;
    if (!controller) return;
    const contacts = controller.getContactsWorkspace()?.getState();
    const patients = controller.getPatientsWorkspace()?.getState();
    const clinical = controller.getClinicalWorkspace()?.file.getState();
    const catalog = controller.getCatalogWorkspace()?.getState();
    if (([contacts, patients, catalog].some(current => current?.draft || current && current.saveStatus !== 'idle')
      || clinical?.draftDirty || clinical && (clinical.saveStatus !== 'idle' || clinical.pendingOperationId !== null)
      || additionalRef.current && !additionalRef.current.canClose())
      && !window.confirm('الخروج يمسح المسودة غير المحضّرة من هذه الصفحة. العمليات التي وصلت لسجل الخادم يمكن مراجعتها بعد الدخول، والخروج لا يلغي حفظًا مقبولًا. هل تريد المتابعة؟')) return;
    previewRef.current?.dispose();
    previewRef.current = null;
    setPreview(null);
    setWorkspace(null);
    patientPreviewRef.current?.dispose();
    patientPreviewRef.current = null;
    setPatientPreview(null);
    setPatientWorkspace(null);
    clinicalPreviewRef.current?.visit?.dispose();
    clinicalPreviewRef.current?.file.dispose();
    clinicalPreviewRef.current?.recovery.dispose();
    clinicalPreviewRef.current = null;
    setClinicalPreview(null);
    setClinicalWorkspace(null);
    catalogPreviewRef.current?.dispose();
    catalogPreviewRef.current = null;
    setCatalogPreview(null);
    setCatalogWorkspace(null);
    additionalRef.current = null; setAdditional(null);
    setPassword('');
    const confirmed = await controller.signOut();
    if (confirmed && returnToLocal && active.current === controller && validRoute()) window.location.assign('/');
  }

  function openPreview() {
    const parent = active.current;
    if (!parent || !validRoute() || hasPreview()) return;
    const status = parent.getState();
    if (status.pending || status.closing || status.cleanupFailed || status.contacts.phase !== 'closed'
      || status.patients.phase !== 'closed' || status.clinical.phase !== 'closed' || status.catalog.phase !== 'closed') return;
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
    if (!controller || !validRoute() || hasPreview()) return;
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
    if (!parent || !validRoute() || hasPreview()) return;
    const status = parent.getState();
    if (status.pending || status.closing || status.cleanupFailed || status.contacts.phase !== 'closed'
      || status.patients.phase !== 'closed' || status.clinical.phase !== 'closed' || status.catalog.phase !== 'closed') return;
    const controller: CloudPatientWorkspaceController = createCloudPatientUiPreview(() => patientPreviewRef.current === controller
      && active.current === parent && validRoute());
    patientPreviewRef.current = controller;
    setPatientPreview(controller);
  }

  async function openPatients(create = false) {
    if (!CLOUD_PATIENTS_UI_STAGE.available) return;
    const controller = active.current;
    if (!controller || !validRoute() || hasPreview()) return;
    const patients = await controller.openPatients();
    if (!patients || active.current !== controller || !validRoute()
      || controller.getPatientsWorkspace() !== patients) return;
    setPatientWorkspace(patients);
    await patients.refresh();
    if (create && active.current === controller && controller.getPatientsWorkspace() === patients && validRoute()) patients.beginCreate();
  }

  function closePatients(displayed: CloudPatientWorkspaceController) {
    if (patientPreviewRef.current === displayed) {
      displayed.dispose();
      patientPreviewRef.current = null;
      setPatientPreview(null);
    } else if (active.current?.getPatientsWorkspace() === displayed && active.current.closePatients(displayed)) setPatientWorkspace(null);
  }

  function openClinicalPreview() {
    const parent = active.current;
    if (!parent || !validRoute() || hasPreview()) return;
    const status = parent.getState();
    if (status.pending || status.closing || status.cleanupFailed || status.contacts.phase !== 'closed'
      || status.patients.phase !== 'closed' || status.clinical.phase !== 'closed' || status.catalog.phase !== 'closed') return;
    const controller: CloudClinicalWorkspaceBundle = createCloudClinicalUiPreview(() => clinicalPreviewRef.current === controller
      && active.current === parent && validRoute());
    clinicalPreviewRef.current = controller;
    setClinicalPreview(controller);
  }

  async function openClinical(patientRecordId?: string, startVisit = false) {
    if (!CLOUD_CLINICAL_UI_STAGE.available) return;
    const controller = active.current;
    if (!controller || !validRoute() || hasPreview()) return;
    const clinical = await controller.openClinical();
    if (!clinical || active.current !== controller || !validRoute()
      || controller.getClinicalWorkspace() !== clinical) return;
    setClinicalWorkspace(clinical);
    // A selected UUID is only a read target, never a profile-only financial
    // snapshot. Opening from the entry alone does not read any clinic records.
    if (patientRecordId !== undefined) {
      await clinical.file.open(patientRecordId);
      const snapshot = clinical.file.getState().snapshot;
      if (startVisit && snapshot && active.current === controller && controller.getClinicalWorkspace() === clinical && validRoute()) {
        setSelectingWalkIn(false); await clinical.visit?.begin(snapshot);
      }
    }
  }

  function closeClinical(displayed: CloudClinicalWorkspaceBundle) {
    if (clinicalPreviewRef.current === displayed) {
      displayed.visit?.dispose(); displayed.file.dispose(); displayed.recovery.dispose();
      clinicalPreviewRef.current = null;
      setClinicalPreview(null);
    } else if (active.current?.getClinicalWorkspace() === displayed && active.current.closeClinical(displayed)) setClinicalWorkspace(null);
  }

  function openCatalogPreview() {
    const parent = active.current;
    if (!parent || !validRoute() || hasPreview()) return;
    const status = parent.getState();
    if (status.pending || status.closing || status.cleanupFailed || status.contacts.phase !== 'closed'
      || status.patients.phase !== 'closed' || status.clinical.phase !== 'closed' || status.catalog.phase !== 'closed') return;
    const controller: CloudCatalogWorkspaceController = createCloudCatalogUiPreview(() => catalogPreviewRef.current === controller
      && active.current === parent && validRoute());
    catalogPreviewRef.current = controller; setCatalogPreview(controller);
  }

  async function openCatalog() {
    if (!CLOUD_CATALOG_UI_STAGE.available) return;
    const parent = active.current;
    if (!parent || !validRoute() || hasPreview()) return;
    const catalog = await parent.openCatalog();
    if (!catalog || active.current !== parent || !validRoute() || parent.getCatalogWorkspace() !== catalog) return;
    setCatalogWorkspace(catalog);
    // Opening obtains a lifetime-bound controller only. Reads stay explicit in
    // the catalog view, not page mount or successful sign-in.
  }

  function closeCatalog(displayed: CloudCatalogWorkspaceController) {
    if (catalogPreviewRef.current === displayed) {
      displayed.dispose(); catalogPreviewRef.current = null; setCatalogPreview(null);
    } else if (active.current?.getCatalogWorkspace() === displayed && active.current.closeCatalog(displayed)) setCatalogWorkspace(null);
  }

  async function openAdditional(kind: 'appointments' | 'settings' | 'prosthetics' | 'prescription' | 'expenses' | 'home' | 'directory' | 'finance' | 'export' | 'transfer' | 'whatsapp', patientRecordId?: string) {
    if (!CLOUD_COMPLETE_RELEASE_UI.available || hasPreview()) return;
    const parent = active.current;
    if (!parent || !validRoute() || kind === 'prescription' && patientRecordId === undefined) return;
    const opened = await parent.openAdditional(kind, context => createCloudReleaseWorkspace(context,
      kind === 'appointments' || kind === 'home' || kind === 'directory' || kind === 'finance' || kind === 'export' ? { kind, initialDate: (() => {
        const parts = new Intl.DateTimeFormat('en', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
        const part = (type: string) => parts.find(item => item.type === type)?.value ?? '';
        return `${part('year')}-${part('month')}-${part('day')}`;
      })() }
        : kind === 'prescription' ? { kind, patientRecordId: patientRecordId! } : { kind }));
    if (!opened || active.current !== parent || !validRoute() || parent.getAdditionalWorkspace(kind) !== opened) return;
    additionalRef.current = opened; setAdditional(opened);
    if (opened.kind === 'prosthetics' && patientRecordId !== undefined) await opened.controller.beginOrder(patientRecordId);
    if (opened.kind === 'home' || opened.kind === 'directory' || opened.kind === 'finance' || opened.kind === 'export' || opened.kind === 'whatsapp') await opened.controller.refresh();
  }
  function closeAdditional(displayed: CloudReleaseWorkspace) {
    const parent = active.current;
    if (!parent || additionalRef.current !== displayed || parent.getAdditionalWorkspace(displayed.kind) !== displayed) return;
    if (parent.closeAdditional(displayed)) { additionalRef.current = null; setAdditional(null); }
  }
  function navigate(section: string) {
    const parent = active.current;
    if (!CLOUD_COMPLETE_RELEASE_UI.available || !parent || !validRoute() || hasPreview() || patientDisplay
      || parent.getState().auth.phase !== 'owner-checked' || parent.getState().pending || parent.getState().closing) return;
    setSelectingWalkIn(section === 'walk-in');
    if (section === 'patients-new') void openPatients(true);
    else if (section === 'patients') void openPatients();
    else if (section === 'contacts' || section === 'directory') void openAdditional('directory');
    else if (section === 'contact-edit') void openContacts();
    else if (section === 'walk-in') void openAdditional('directory');
    else if (section === 'lab') void openAdditional('prosthetics');
    else if (section === 'summary') void openAdditional('finance');
    else if (section === 'catalog') void openCatalog();
    else if (['home', 'appointments', 'settings', 'finance', 'export', 'transfer', 'expenses', 'whatsapp'].includes(section)) void openAdditional(section as 'home' | 'appointments' | 'settings' | 'finance' | 'export' | 'transfer' | 'expenses' | 'whatsapp');
  }
  function togglePatientDisplay() {
    const parent = active.current;
    if (!parent || !validRoute() || parent.getState().auth.phase !== 'owner-checked') return;
    if (patientDisplay) { setPatientDisplay(false); setDisplayNotice(''); return; }
    const contacts = parent.getContactsWorkspace()?.getState(), patients = parent.getPatientsWorkspace()?.getState();
    const clinical = parent.getClinicalWorkspace()?.file.getState(), catalog = parent.getCatalogWorkspace()?.getState();
    if ([contacts, patients, catalog].some(state => state && (state.draft || state.loading || state.saveStatus !== 'idle'))
      || clinical && (clinical.draftDirty || clinical.loading || clinical.pendingOperationId || clinical.saveStatus !== 'idle')
      || additionalRef.current && !additionalRef.current.canClose()) {
      setDisplayNotice('أكمل المسودة أو ألغها وانتظر تأكيد العملية قبل عرض شاشة المريض؛ حتى لا تفقد تعديلًا غير محفوظ.'); return;
    }
    setDisplayNotice(''); setPatientDisplay(true);
  }

  if (!validRoute()) return <CloudUnavailablePage />;

  const busy = view.pending || view.closing;
  const blocked = busy || view.cleanupFailed;
  const runtimeBlocked = blocked || view.auth.phase !== 'owner-checked';
  const owner = view.auth.phase === 'owner-checked' ? view.auth.owner : null;
  const displayedWorkspace = preview ?? workspace;
  const displayedPatients = patientPreview ?? patientWorkspace;
  const displayedClinical = clinicalPreview ?? clinicalWorkspace;
  const displayedCatalog = catalogPreview ?? catalogWorkspace;

  const workspaceContent = additional ? <Suspense fallback={<section role="status" className="rounded-3xl border border-slate-200 bg-white p-6 text-sm leading-7">جارٍ فتح القسم…</section>}>
    {additional.kind === 'appointments' ? <CloudAppointmentsWorkspace controller={additional.controller} onClose={() => closeAdditional(additional)} disabled={runtimeBlocked} />
      : additional.kind === 'settings' ? <><div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-5">{([['catalog', 'الخدمات والأسعار'], ['transfer', 'الاستيراد'], ['export', 'التصدير'], ['contact-edit', 'إدارة الأرقام'], ['whatsapp', 'إدارة واتساب']] as const).map(([section, label]) => <button type="button" className="min-h-11 rounded-xl border border-slate-200 bg-white p-3 font-bold" disabled={runtimeBlocked} key={section} onClick={() => navigate(section)}>{label}</button>)}</div><CloudClinicSettingsWorkspace controller={additional.controller} onClose={() => closeAdditional(additional)} disabled={runtimeBlocked} /></>
      : additional.kind === 'prosthetics' ? <CloudProstheticWorkspace controller={additional.controller} onClose={() => closeAdditional(additional)} disabled={runtimeBlocked} />
      : additional.kind === 'expenses' ? <CloudExpensesWorkspace controller={additional.controller} onClose={() => closeAdditional(additional)} disabled={runtimeBlocked} />
      : additional.kind === 'transfer' ? <CloudTransferWorkspace controller={additional.controller} onClose={() => closeAdditional(additional)} disabled={runtimeBlocked} />
      : additional.kind === 'whatsapp' ? <CloudWhatsAppWorkspace controller={additional.controller} onClose={() => closeAdditional(additional)} onEditSettings={() => navigate('settings')} disabled={runtimeBlocked} />
      : additional.kind === 'prescription' ? <CloudPrescriptionWorkspace controller={additional.controller} patientRecordId={additional.patientRecordId} onClose={() => closeAdditional(additional)} disabled={runtimeBlocked} />
      : <>{selectingWalkIn && additional.kind === 'directory' && <div className="mb-3 rounded-2xl border border-indigo-200 bg-indigo-50 p-4 leading-7">اختر ملف المريض من البحث بالاسم أو الرقم لتسجيل زيارة بدون موعد. <button type="button" disabled={runtimeBlocked} className="min-h-11 font-bold text-indigo-700" onClick={() => navigate('patients-new')}>إنشاء ملف لمريض جديد</button></div>}<CloudClinicOverviewWorkspace controller={additional.controller} disabled={runtimeBlocked} onClose={() => closeAdditional(additional)} onOpenPatient={id => void openClinical(id, selectingWalkIn)} onNavigate={navigate} /></>}
  </Suspense> : displayedCatalog ? <Suspense fallback={<p role="status">جارٍ فتح الخدمات والأسعار…</p>}>
    <CloudServiceCatalogWorkspace controller={displayedCatalog} onClose={() => closeCatalog(displayedCatalog)} previewOnly={catalogPreview !== null} disabled={catalogPreview === null && runtimeBlocked} />
  </Suspense> : displayedClinical ? <Suspense fallback={<p role="status">جارٍ فتح الملف السريري…</p>}>
    <CloudClinicalWorkspace controller={displayedClinical} onClose={() => closeClinical(displayedClinical)} previewOnly={clinicalPreview !== null} closing={clinicalPreview === null && runtimeBlocked}
      onStartProsthetic={CLOUD_COMPLETE_RELEASE_UI.available && clinicalPreview === null ? id => void openAdditional('prosthetics', id) : undefined}
      onOpenPrescription={CLOUD_COMPLETE_RELEASE_UI.available && clinicalPreview === null ? id => void openAdditional('prescription', id) : undefined} />
  </Suspense> : displayedPatients ? <Suspense fallback={<p role="status">جارٍ فتح ملفات المرضى…</p>}>
    <CloudPatientsWorkspace controller={displayedPatients} onClose={() => closePatients(displayedPatients)} previewOnly={patientPreview !== null} closing={patientPreview === null && runtimeBlocked}
      onOpenClinical={patientPreview === null && CLOUD_CLINICAL_UI_STAGE.available ? id => void openClinical(id) : undefined} />
  </Suspense> : displayedWorkspace ? <Suspense fallback={<p role="status">جارٍ فتح جهات الاتصال…</p>}>
    <CloudContactsWorkspace controller={displayedWorkspace} onClose={() => closeContacts(displayedWorkspace)} previewOnly={preview !== null} disabled={preview === null && runtimeBlocked} />
  </Suspense> : null;

  if (CLOUD_COMPLETE_RELEASE_UI.available && (owner || view.auth.phase === 'checking' && lastOwner.current)) {
    const section: CloudShellSection = displayedPatients || displayedClinical ? 'patients' : displayedWorkspace ? 'contacts'
      : additional?.kind === 'appointments' ? 'appointments' : additional?.kind === 'prosthetics' ? 'lab'
      : additional?.kind === 'finance' || additional?.kind === 'expenses' ? 'summary' : additional?.kind === 'directory' ? 'contacts'
      : additional?.kind === 'settings' || additional?.kind === 'transfer' || additional?.kind === 'export' || additional?.kind === 'whatsapp' || displayedCatalog ? 'settings' : 'home';
    return <Suspense fallback={<main dir="rtl" role="status" className="min-h-dvh bg-slate-50 p-6">جارٍ فتح مساحة العيادة…</main>}><CloudClinicShell branding={branding} section={section} accountEmail={owner?.email || ''} disabled={view.closing || view.cleanupFailed}
      checking={view.auth.phase !== 'owner-checked'} error={view.error || displayNotice || view.contacts.error || view.patients.error || view.clinical.error || view.catalog.error}
      patientDisplayActive={patientDisplay} onPatientDisplay={togglePatientDisplay}
      patientDisplay={displayedClinical ? <CloudSelectedPatientDisplay controller={displayedClinical.file} /> : <CloudSelectedPatientDisplayView snapshot={null} />}
      onNavigate={navigate} onSignOut={() => void leave(false)} onRefreshSession={() => void active.current?.refresh()}>
      {section === 'home' && <CloudClinicClock />}
      {workspaceContent || <section className="rounded-3xl border border-slate-200 bg-white p-6"><h1 className="text-xl font-extrabold">العيادة</h1><p className="my-3 leading-7">ابدأ العمل أو اختر قسمًا من الشريط. لا تُرفع أي بيانات محلية إلى حسابك.</p><button type="button" className="min-h-12 rounded-xl bg-indigo-600 px-5 py-3 font-bold text-white" disabled={blocked} onClick={() => navigate('home')}>ابدأ العمل</button></section>}
    </CloudClinicShell></Suspense>;
  }
  if (CLOUD_COMPLETE_RELEASE_UI.available) return <main dir="rtl" className="min-h-dvh bg-slate-50 px-4 py-8 text-slate-900">
    <section className="mx-auto w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <div className="mb-6 flex items-center gap-3"><ClinicLogo layout="icon-only" size="lg" showText={false}/><div><h1 className="text-xl font-extrabold">إدارة العيادة</h1><p className="mt-1 text-sm text-slate-500">دخول المالك</p></div></div>
      {view.error && <p role="alert" className="mb-4 rounded-xl bg-rose-50 p-3 text-sm leading-7 text-rose-800">{view.error}</p>}
      <form className="space-y-4" aria-busy={busy} onSubmit={event => {
        event.preventDefault(); const parent = active.current;
        if (!parent || blocked || hasPreview() || !validRoute()) return;
        const submittedPassword = password; setPassword(''); void parent.signIn(email, submittedPassword);
      }}>
        <label className="block space-y-2"><span className="text-sm font-bold">البريد الإلكتروني</span><input name="email" type="email" dir="ltr" autoComplete="username" required maxLength={254} disabled={blocked} value={email} onChange={event => setEmail(event.target.value)} className="min-h-12 w-full rounded-xl border border-slate-300 px-4 py-3 text-base" /></label>
        <label className="block space-y-2"><span className="text-sm font-bold">كلمة سر حساب الموقع</span><input name="password" type="password" autoComplete="current-password" required maxLength={4096} disabled={blocked} value={password} onChange={event => setPassword(event.target.value)} className="min-h-12 w-full rounded-xl border border-slate-300 px-4 py-3 text-base" /></label>
        <button type="submit" disabled={blocked} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 font-bold text-white disabled:opacity-50">{busy ? <LoaderCircle size={20}/> : <ShieldCheck size={20}/>} {busy ? 'جارٍ التحقق…' : 'دخول العيادة'}</button>
      </form>
      {busy && <button type="button" disabled={view.closing || view.cleanupFailed} className="mt-3 min-h-11 w-full rounded-xl border border-slate-300 p-3 font-bold" onClick={() => void leave(false)}>{view.closing ? 'جارٍ إغلاق الجلسة…' : 'إلغاء وتسجيل الخروج'}</button>}
      <p className="mt-5 text-xs leading-6 text-slate-500">اكتب كلمة سر الموقع، وليس حساب Google. الجلسة في الذاكرة فقط؛ لا تُحمّل بيانات المرضى قبل تسجيل الدخول.</p>
    </section>
  </main>;

  return <main dir="rtl" className="min-h-dvh bg-slate-50 px-4 py-5 sm:px-6 sm:py-8 text-slate-900">
    <div className="mx-auto w-full max-w-5xl space-y-5 sm:space-y-7">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3"><ClinicLogo size="lg" layout="icon-only" showText={false} /><div className="min-w-0"><p className="text-xs font-bold text-indigo-600">تجهيز نسخة العيادة السحابية</p><h1 className="mt-1 text-xl sm:text-2xl font-extrabold">دخول التشغيل</h1></div></div>
        <button type="button" onClick={() => void leave(true)} disabled={view.closing || view.cleanupFailed} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-600 disabled:opacity-50"><ArrowRight size={18} aria-hidden="true" /> العودة للنسخة المحلية</button>
      </header>

      {workspaceContent || <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
        <section className="min-w-0 rounded-3xl border border-slate-200 bg-white p-5 sm:p-7 shadow-sm" aria-labelledby="operating-account-title">
          <div className="mb-5 flex items-start gap-3"><span className="rounded-2xl bg-indigo-50 p-3 text-indigo-600"><ShieldCheck size={25} aria-hidden="true" /></span><div className="min-w-0"><h2 id="operating-account-title" className="text-lg font-extrabold">حساب مالك العيادة</h2><p className="mt-1 text-sm leading-7 text-slate-500">نستخدم حساب Firebase وعضويتك المعتمدة، وليس حساب الدخول المحلي.</p></div></div>

          {view.error && <p role="alert" className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm leading-7 text-rose-800">{view.error}</p>}

          {owner ? <div className="space-y-4">
            <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950"><p className="flex items-center gap-2 font-extrabold"><Check size={20} aria-hidden="true" /> تم تأكيد الدخول وعضوية المالك</p><p dir="ltr" className="mt-2 break-all text-sm">{owner.email}</p><p className="mt-2 text-sm leading-7">هذه نتيجة فحص حديثة، وليست تفعيلًا لحفظ ملفات المرضى أو مزامنتها.</p></div>
            <button type="button" disabled={blocked} onClick={() => void active.current?.refresh()} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 font-bold text-indigo-700 disabled:opacity-50"><RefreshCw size={19} aria-hidden="true" /> إعادة التحقق من الجلسة</button>
          </div> : <form className="space-y-4" aria-busy={busy} onSubmit={event => {
            event.preventDefault();
            const controller = active.current;
            if (!controller || blocked || hasPreview()) return;
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
          <section className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-7 shadow-sm" aria-label="ربط بقية وظائف العيادة">
            <h2 className="text-lg font-extrabold">بقية وظائف العيادة</h2>
            <p className="mt-3 text-sm leading-7 text-slate-500">{CLOUD_COMPLETE_RELEASE_UI.reason}</p>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">{(['appointments', 'prosthetics', 'expenses', 'settings'] as const).map(kind =>
              <button key={kind} type="button" disabled={blocked || !owner || !CLOUD_COMPLETE_RELEASE_UI.available}
                onClick={() => void openAdditional(kind)} className="min-h-12 rounded-xl border border-slate-200 p-3 text-sm font-bold disabled:opacity-50">
                {kind === 'appointments' ? 'مواعيد العيادة' : kind === 'prosthetics' ? 'التركيبات والمعامل' : kind === 'expenses' ? 'المصروفات والخامات' : 'إعدادات العيادة'}</button>)}</div>
          </section>
          <section aria-labelledby="operating-catalog-title" className="rounded-3xl border border-indigo-100 bg-white p-5 sm:p-7 shadow-sm">
            <div className="flex items-start gap-3"><span className="shrink-0 rounded-2xl bg-indigo-50 p-3 text-indigo-600"><Tags size={23} aria-hidden="true" /></span><div className="min-w-0"><h2 id="operating-catalog-title" className="text-lg font-extrabold">الخدمات والأسعار والكشف</h2><p className="mt-1 text-sm leading-7 text-slate-500">فهرس موحد للزيارة، مع فصل الخدمات العلاجية عن التركيبات والحفاظ على أسعار الجلسات السابقة.</p></div></div>
            <p id="operating-catalog-stage" className="mt-4 rounded-xl bg-amber-50 p-3 text-sm leading-7 text-amber-950">{CLOUD_CATALOG_UI_STAGE.reason}</p>
            <button type="button" disabled={blocked} onClick={openCatalogPreview} className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm font-bold text-indigo-700 disabled:opacity-50"><Eye size={19} aria-hidden="true" />معاينة الخدمات والأسعار</button>
            <p className="mt-2 text-xs leading-6 text-slate-500">معاينة فارغة للتصميم فقط، بلا بيانات أو اتصال بقاعدة البيانات. لا يلزم تسجيل الدخول لمشاهدتها.</p>
            {owner && <button type="button" aria-describedby="operating-catalog-stage" disabled={blocked || !CLOUD_CATALOG_UI_STAGE.available || view.catalog.phase === 'opening'} onClick={() => void openCatalog()} className="mt-3 flex min-h-11 w-full items-center justify-center rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-500 disabled:cursor-not-allowed disabled:opacity-60">{CLOUD_CATALOG_UI_STAGE.available ? 'فتح الخدمات والأسعار من الخادم' : 'الخدمات والأسعار غير مفعّلة بعد'}</button>}
            {view.catalog.error && <p role="alert" className="mt-3 rounded-xl bg-rose-50 p-3 text-sm leading-7 text-rose-800">{view.catalog.error}</p>}
          </section>
          <section aria-labelledby="operating-clinical-title" className="rounded-3xl border border-indigo-100 bg-white p-5 sm:p-7 shadow-sm">
            <div className="flex items-start gap-3"><span className="shrink-0 rounded-2xl bg-indigo-50 p-3 text-indigo-600"><ClipboardList size={23} aria-hidden="true" /></span><div className="min-w-0"><h2 id="operating-clinical-title" className="text-lg font-extrabold">الملف السريري واسترجاع العمليات</h2><p className="mt-1 text-sm leading-7 text-slate-500">الجلسات والتحصيل الفعلي وحساب المريض، مع سجل للتحقق من العمليات غير المؤكدة.</p></div></div>
            <p id="operating-clinical-stage" className="mt-4 rounded-xl bg-amber-50 p-3 text-sm leading-7 text-amber-950">{CLOUD_CLINICAL_UI_STAGE.reason}</p>
            <button type="button" disabled={blocked} onClick={openClinicalPreview} className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm font-bold text-indigo-700 disabled:opacity-50"><Eye size={19} aria-hidden="true" />معاينة الملف السريري وسجل الاسترجاع</button>
            <p className="mt-2 text-xs leading-6 text-slate-500">تتضمن تصميم تسجيل الزيارة والخدمات والكشف الاختياري. معاينة فارغة بلا بيانات أو اتصال بقاعدة البيانات، ولا يلزم تسجيل الدخول لمشاهدتها.</p>
            {owner && <button type="button" aria-describedby="operating-clinical-stage" disabled={blocked || !CLOUD_CLINICAL_UI_STAGE.available || view.clinical.phase === 'opening'} onClick={() => void openClinical()} className="mt-3 flex min-h-11 w-full items-center justify-center rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-500 disabled:cursor-not-allowed disabled:opacity-60">{CLOUD_CLINICAL_UI_STAGE.available ? 'فتح الملف السريري وسجل الاسترجاع' : 'التشغيل السريري غير مفعّل بعد'}</button>}
            {view.clinical.error && <p role="alert" className="mt-3 rounded-xl bg-rose-50 p-3 text-sm leading-7 text-rose-800">{view.clinical.error}</p>}
          </section>
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
