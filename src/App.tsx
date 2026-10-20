import React, { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from 'react';
import { ActiveView, NavigationOrigin, LabService, Patient, ClinicContact, Appointment, AppointmentStatus, Lab, LabCase, ThemeSettings, UILabels, User, DeviceMode, Session, MaterialUsage } from './types';
import { Storage as BrowserStorage, STORAGE_FAILURE_EVENT, CLINIC_CONTENT_STORAGE_KEYS, SERVICE_CATALOG_STORAGE_KEYS, DRUG_CATALOG_STORAGE_KEY, LABS_STORAGE_KEY, CLINIC_DOMAIN_STORAGE_KEYS, WHATSAPP_SETTINGS_STORAGE_KEY, PRIVACY_MODE_STORAGE_KEY, PROSTHETIC_ROUTING_STORAGE_KEY } from './utils/storage';
import type {PortableRuntime} from './portable/runtime';
import type { ClinicIdentitySettings, ClinicDomainData } from './utils/storage';
import { withClinicWriteLock } from './utils/clinicWriteLock';
import { addWalkInRecord, savePatientRecord, savePatientAppointment, deletePatientRecord, addPatientReceipt, importPatientRecords, canonicalFileNumber } from './utils/clinicMutations';
import { saveClinicContact, deleteClinicContact } from './utils/clinicContacts';
import { applyContactImport, type ContactImportInput, type ContactImportSummary } from './utils/contactTransfer';
import { isLocalClinicHost } from './utils/localRuntime';
import { assertClinicBackup } from './utils/backupValidation';
import { authenticateLocalAccount, secureUserAccountsForStorage } from './utils/passwords';
import { cloneContentDraft } from './utils/clinicContent';
import type { ContentDraft } from './utils/clinicContent';
import { cloneServiceCatalog, getServiceGroup, validateServiceCatalog } from './utils/serviceCatalog';
import type { ServiceCatalogValues } from './utils/serviceCatalog';
import { cloneProstheticRouting, validateProstheticRouting } from './utils/prostheticRouting';
import type { ProstheticRoutingSettings } from './utils/prostheticRouting';
import { createProstheticOrder, getLinkedPatientAccount, validateProstheticOrder } from './utils/prostheticWorkflow';
import type { ProstheticOrderInput } from './utils/prostheticWorkflow';
import { getNextPatientFileNo } from './utils/patientRegistration';
import { validateWalkInAmounts } from './utils/walkInDraft';
import { getToothLabel } from './utils/toothUtils';
import { getDefaultViewForUser, canAccessView, canPerformAction } from './utils/rbac';
import { getHomeActionAccess } from './utils/homeActions';
import type { RBACAction } from './utils/rbac';
import { canUserLoginNow, matchesSessionIdentity, matchesRememberedSession } from './utils/accessControl';
import { allocateLabPayment, labMoneyCents } from './utils/labFinancials';
import { prepareLabMetadataSave, prepareLabPricingSave, mergeLabCaseWorkflowUpdate, assertLabCaseSessionLink } from './utils/labManagement';
import { prepareBasicExpenseUpdate, assertUniqueSupplierInvoice } from './utils/expenseUtils';
import { getInventory } from './utils/inventory';
import { appendSessionReceipt, financialMoneyCents } from './utils/financials';
import { isValidAppointmentDate, localDateISO } from './components/appointments/appointmentScheduling';
import { ToastAndConfirmProvider, useToastAndConfirm } from './components/common/ToastAndConfirm';
import { HeaderNavbar } from './components/common/HeaderNavbar';
import { SidebarNav } from './components/navigation/SidebarNav';
import { MobileBottomNav } from './components/navigation/MobileBottomNav';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useVisibleViewport } from './hooks/useVisibleViewport';
import { useAppointmentDialog } from './components/appointments/useAppointmentDialog';
import { LoginModal } from './components/auth/LoginModal';
import { OfflineSyncBanner } from './components/common/OfflineSyncBanner';
import { HomeView } from './components/home/HomeView';
import { ScreenLoader } from './components/common/ScreenLoader';
import {activeFontStylesheet} from './utils/fontStylesheet';
import {hasPatientFile} from './utils/patientFileIdentity';
const UnfiledVisitView = lazy(() => import('./components/contacts/UnfiledVisitView').then(m=>({default:m.UnfiledVisitView})));

// Code-split views & modals via React.lazy for ultra-fast mobile startup and reduced bundle size
const PatientsView = lazy(() => import('./components/patients/PatientsView').then(m => ({ default: m.PatientsView })));
const ClinicContacts = lazy(() => import('./components/settings/ClinicContacts').then(m => ({ default: m.ClinicContacts })));
const PatientFileView = lazy(() => import('./components/patient/PatientFileView').then(m => ({ default: m.PatientFileView })));
const AppointmentsView = lazy(() => import('./components/appointments/AppointmentsView').then(m => ({ default: m.AppointmentsView })));
const LabView = lazy(() => import('./components/lab/LabView').then(m => ({ default: m.LabView })));
const SummaryView = lazy(() => import('./components/summary/SummaryView').then(m => ({ default: m.SummaryView })));
const SettingsView = lazy(() => import('./components/settings/SettingsView').then(m => ({ default: m.SettingsView })));
const HomePaymentModal = lazy(() => import('./components/home/HomePaymentModal').then(m => ({ default: m.HomePaymentModal })));

const QuickWalkInModal = lazy(() => import('./components/walkin/QuickWalkInModal').then(m => ({ default: m.QuickWalkInModal })));
const DailyReportModal = lazy(() => import('./components/reports/DailyReportModal').then(m => ({ default: m.DailyReportModal })));
const ApprovalQueueModal = lazy(() => import('./components/common/ApprovalQueueModal').then(m => ({ default: m.ApprovalQueueModal })));
const SmartScheduleModal = lazy(() => import('./components/appointments/SmartScheduleModal').then(m => ({ default: m.SmartScheduleModal })));
const InvoiceOcrModal = lazy(() => import('./components/summary/InvoiceOcrModal').then(m => ({ default: m.InvoiceOcrModal })));
const EndodonticHelperModal = lazy(() => import('./components/patient/EndodonticHelperModal').then(m => ({ default: m.EndodonticHelperModal })));

function ViewFallbackLoader() {
  return (
    <ScreenLoader />
  );
}

function PermissionDeniedCard({ title, onBackToHome }: { title: string; onBackToHome: () => void }) {
  return (
    <div className="bg-white rounded-3xl p-8 border border-rose-200 text-center space-y-4 max-w-lg mx-auto my-12 shadow-md font-tajawal animate-fadeIn">
      <div className="w-16 h-16 bg-rose-100 text-rose-600 rounded-2xl flex items-center justify-center mx-auto text-3xl font-bold">
        🔒
      </div>
      <h3 className="text-lg font-extrabold text-slate-900">عذراً! ليس لديك صلاحية الوصول إلى {title}</h3>
      <p className="text-xs text-slate-600 leading-relaxed">
        تم تقييد وصول حسابك الحالي لهذا القسم بواسطة طبيب أو مدير النظام. إذا كنت بحاجة للوصول، يرجى طلب تحديث الصلاحيات من لوحة التحكم.
      </p>
      <button
        type="button"
        onClick={onBackToHome}
        className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-xs cursor-pointer transition-colors"
      >
        العودة للشاشة الرئيسية
      </button>
    </div>
  );
}

function ModalOpeningPlaceholder({ onClose }: { onClose: () => void }) {
  const dialogRef = useAppointmentDialog(true, onClose);
  return <div className="clinic-modal-overlay fixed inset-0 z-[80] bg-slate-900/50 flex items-center justify-center" dir="rtl">
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="فتح النافذة" tabIndex={-1}
      className="clinic-modal-panel w-full max-w-xs bg-white p-5 shadow-xl text-center space-y-4">
      <p role="status" className="font-bold text-slate-700">جارٍ فتح النافذة…</p>
      <button type="button" onClick={onClose} className="min-h-[44px] px-5 py-2 rounded-xl bg-slate-100 font-bold text-slate-600">إلغاء</button>
    </div>
  </div>;
}

export function AppContent({runtime}: {runtime?: PortableRuntime} = {}) {
  const Storage = runtime?.storage ?? BrowserStorage;
  useVisibleViewport();
  const { showToast, cancelConfirm, askConfirm } = useToastAndConfirm();
  const rxDirty=useRef(false);
  const handleRxDirtyChange=useCallback((dirty:boolean)=>{rxDirty.current=dirty;},[]);
  const navigateWithRxGuard=useCallback((next:()=>void)=>{
    if(!rxDirty.current){next();return;}
    askConfirm({title:'روشتة غير محفوظة',message:'احفظ الروشتة من قسم الروشتات قبل المغادرة، أو أكّد تجاهل المسودة. النسخ المحفوظة لن تتغير.',confirmLabel:'تجاهل المسودة والمغادرة',tone:'warning',onConfirm:()=>{rxDirty.current=false;next();}});
  },[askConfirm]);
  useEffect(() => {
    const notifyFailure = () => showToast('تعذر حفظ آخر تعديل على الجهاز. احتفظ بالصفحة مفتوحة وصدّر نسخة احتياطية قبل إغلاقها.', 'error', { duration: 12000 });
    window.addEventListener(STORAGE_FAILURE_EVENT, notifyFailure);
    return () => window.removeEventListener(STORAGE_FAILURE_EVENT, notifyFailure);
  }, [showToast]);
  // Application State
  const [activeView, setActiveView] = useState<ActiveView>('home');
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [navigationOrigin, setNavigationOrigin] = useState<NavigationOrigin>('patients');

  // Persistent Domain Data
  const [users, setUsers] = useState<User[]>(() => Storage.getUsers());

  // Authentication State. Remembered sessions never persist a password.
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    if (runtime) return runtime.currentUser();
    const savedUsers = Storage.getUsers();
    const remembered = Storage.getRememberedSession();

    if (remembered) {
      const match = savedUsers.find(u => matchesRememberedSession(u, remembered));
      if (match) {
        if (!canUserLoginNow(match).allowed) {
          Storage.saveCurrentUser(null);
          return null;
        }
        Storage.saveCurrentUser(match);
        return match;
      } else {
        // User account deleted or password/username changed -> cancel auto-login!
        Storage.saveRememberedSession(null);
        Storage.saveCurrentUser(null);
        return null;
      }
    }

    const sessionUser = Storage.getCurrentUser();
    if (sessionUser) {
      const match = savedUsers.find(u =>
        u.id === sessionUser.id &&
        u.username.toLowerCase() === sessionUser.username.toLowerCase() &&
        (u.credentialVersion ?? 1) === (sessionUser.credentialVersion ?? 1) &&
        canUserLoginNow(u).allowed
      );
      if (match) {
        return match;
      } else {
        Storage.saveCurrentUser(null);
        return null;
      }
    }

    return null;
  });

  const [isLoginModalOpen, setIsLoginModalOpen] = useState<boolean>(() => !currentUser);

  // Persistent Domain Data
  const [patients, setPatients] = useState<Patient[]>(() => Storage.getPatients());
  const [contacts, setContacts] = useState<ClinicContact[]>(() => Storage.getContacts());
  const filePatients=useMemo(()=>patients.filter(hasPatientFile),[patients]);
  const [appointments, setAppointments] = useState<Appointment[]>(() => Storage.getAppointments());
  const [labs, setLabs] = useState<Lab[]>(() => Storage.getLabsFresh());
  const [labCases, setLabCases] = useState<LabCase[]>(() => Storage.getLabCases());
  const [theme, setTheme] = useState<ThemeSettings>(() => Storage.getTheme());
  const [labels, setLabels] = useState<UILabels>(() => Storage.getUILabels());
  const [tileOrder, setTileOrder] = useState<string[]>(() => Storage.getTileOrder());
  useEffect(() => {
    const refreshContent = (event: StorageEvent) => {
      if (event.storageArea && event.storageArea !== localStorage) return;
      if (event.key !== null && !CLINIC_CONTENT_STORAGE_KEYS.includes(event.key)) return;
      // Read the latest persisted pair instead of applying an event's partial
      // newValue. A following key event refreshes again; this is not a DB lock.
      const latest = Storage.getClinicContent();
      setLabels(latest.labels);
      setTileOrder(latest.tileOrder);
    };
    window.addEventListener('storage', refreshContent);
    return () => window.removeEventListener('storage', refreshContent);
  }, []);

  const [serviceCatalog, setServiceCatalog] = useState<ServiceCatalogValues>(() => Storage.getServiceCatalog());
  const { serviceTypes, crownPrices, clinicalPrices, examinationFee } = serviceCatalog;
  const [prostheticRouting, setProstheticRouting] = useState(() => Storage.getProstheticRouting());
  const [clinicName, setClinicName] = useState<string>(() => Storage.getClinicName());
  const [clinicLogo, setClinicLogo] = useState<string | null>(() => Storage.getClinicLogo());

  const [expenses, setExpenses] = useState<import('./types').Expense[]>(() => Storage.getExpenses());
  const [materialUsages, setMaterialUsages] = useState<MaterialUsage[]>(() => Storage.getMaterialUsages());
  const [whatsappSettings, setWhatsappSettings] = useState<import('./types').WhatsappSettings>(() => Storage.getWhatsappSettings());
  const [drugCatalog, setDrugCatalog] = useState<import('./types').DrugCatalogItem[]>(() => Storage.getDrugCatalogFresh());
  const [isPrivacyMode, setIsPrivacyMode] = useState<boolean>(() => Storage.getPrivacyMode());

  useEffect(() => {
    const refreshMessagingAndPrivacy = (event: StorageEvent) => {
      if (event.storageArea && event.storageArea !== localStorage) return;
      if (event.key === null || event.key === WHATSAPP_SETTINGS_STORAGE_KEY) setWhatsappSettings(Storage.getWhatsappSettingsFresh());
      if (event.key === null || event.key === PRIVACY_MODE_STORAGE_KEY) setIsPrivacyMode(Storage.getPrivacyModeFresh());
    };
    window.addEventListener('storage', refreshMessagingAndPrivacy);
    return () => window.removeEventListener('storage', refreshMessagingAndPrivacy);
  }, []);

  const publishDomain = useCallback((data: ClinicDomainData) => {
    setPatients(data.patients); setAppointments(data.appointments); setLabCases(data.labCases);
    setExpenses(data.expenses); setMaterialUsages(data.materialUsages); setContacts(data.contacts);
  }, []);

  useEffect(() => {
    if (!runtime) return;
    const refresh = () => {
      const user = runtime.currentUser();
      setCurrentUser(user); setIsLoginModalOpen(!user); setUsers(Storage.getUsers());
      publishDomain(Storage.getDomainData()); setLabs(Storage.getLabsFresh());
      setServiceCatalog(Storage.getServiceCatalog()); setProstheticRouting(Storage.getProstheticRouting());
      setClinicName(Storage.getClinicName()); setClinicLogo(Storage.getClinicLogo()); setTheme(Storage.getTheme());
      const content = Storage.getClinicContent(); setLabels(content.labels); setTileOrder(content.tileOrder);
      setWhatsappSettings(Storage.getWhatsappSettingsFresh()); setDrugCatalog(Storage.getDrugCatalogFresh());
    };
    refresh(); return runtime.subscribe(refresh);
  }, [runtime, publishDomain]);

  const commitDomain = async (actions: RBACAction[], mutate: (data: ClinicDomainData) => ClinicDomainData) => {
    await withClinicWriteLock(() => {
      actions.forEach(requireFreshSettingsPermission);
      const latest = Storage.getDomainData();
      const next = mutate(latest);
      Storage.saveDomainDataConfirmed(next, latest);
      publishDomain(next);
    });
  };

  useEffect(() => {
    const refreshDomain = (event: StorageEvent) => {
      if (event.storageArea && event.storageArea !== localStorage) return;
      if (event.key !== null && !CLINIC_DOMAIN_STORAGE_KEYS.some(key => key === event.key)) return;
      try { publishDomain(Storage.getDomainData()); }
      catch (error) { showToast(error instanceof Error ? error.message : 'تعذّر تحديث بيانات العيادة.', 'error'); }
    };
    window.addEventListener('storage', refreshDomain);
    return () => window.removeEventListener('storage', refreshDomain);
  }, [publishDomain, showToast]);

  useEffect(() => {
    const refreshCatalogs = (event: StorageEvent) => {
      if (event.storageArea && event.storageArea !== localStorage) return;
      if (event.key === null || SERVICE_CATALOG_STORAGE_KEYS.includes(event.key)) {
        const latest = Storage.getServiceCatalog();
        setServiceCatalog(previous => JSON.stringify(previous) === JSON.stringify(latest) ? previous : latest);
      }
      if (event.key === null || event.key === LABS_STORAGE_KEY) {
        const latest = Storage.getLabsFresh();
        setLabs(previous => JSON.stringify(previous) === JSON.stringify(latest) ? previous : latest);
      }
      if (event.key === null || event.key === PROSTHETIC_ROUTING_STORAGE_KEY) setProstheticRouting(Storage.getProstheticRouting());
      if (event.key === null || event.key === DRUG_CATALOG_STORAGE_KEY) {
        const latest = Storage.getDrugCatalogFresh();
        setDrugCatalog(previous => JSON.stringify(previous) === JSON.stringify(latest) ? previous : latest);
      }
    };
    window.addEventListener('storage', refreshCatalogs);
    return () => window.removeEventListener('storage', refreshCatalogs);
  }, []);

  // Hybrid Navigation Layout State
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem('dental_sidebar_collapsed') === 'true';
    }
    return false;
  });

  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState<string>('identity');
  const [initialWhatsAppSection, setInitialWhatsAppSection] = useState<'templates' | 'campaigns'>('templates');
  const [labPricingTarget, setLabPricingTarget] = useState<string>();

  // Walk-in Visit and End-of-day report modal states
  const [isWalkInModalOpen, setIsWalkInModalOpen] = useState(false);
  const [isDailyReportModalOpen, setIsDailyReportModalOpen] = useState(false);
  const [isHomePaymentOpen, setIsHomePaymentOpen] = useState(false);
  useEffect(() => {
    if (!canPerformAction(currentUser, 'view_patients') || !canPerformAction(currentUser, 'register_payment')) setIsHomePaymentOpen(false);
  }, [currentUser]);

  // AI & Security Modals state
  const [isApprovalQueueOpen, setIsApprovalQueueOpen] = useState(false);
  const [isSmartScheduleOpen, setIsSmartScheduleOpen] = useState(false);
  const [isInvoiceOcrOpen, setIsInvoiceOcrOpen] = useState(false);
  const [isAddExpenseModalOpen, setIsAddExpenseModalOpen] = useState(false);
  const [isEndoHelperOpen, setIsEndoHelperOpen] = useState(false);
  const [endoToothNumber, setEndoToothNumber] = useState('21');
  const [endoPatientName, setEndoPatientName] = useState('');
  const homeActionAccess = getHomeActionAccess(currentUser);
  useEffect(() => {
    if (!homeActionAccess.walkIn) setIsWalkInModalOpen(false);
    if (!homeActionAccess.schedule) setIsSmartScheduleOpen(false);
    if (!homeActionAccess.report) setIsDailyReportModalOpen(false);
    if (!homeActionAccess.invoice || isPrivacyMode) setIsInvoiceOcrOpen(false);
  }, [homeActionAccess.walkIn, homeActionAccess.schedule, homeActionAccess.report, homeActionAccess.invoice, isPrivacyMode]);

  const handleSaveWalkInVisit = (payload: {
    patient: {
      isNew: boolean;
      id: string;
      name: string;
      mobile: string;
      age: number;
      gender?: string;
      withoutFile?:boolean;
      confirmExistingFile?:boolean;
    };
    visit: {
      chiefComplaint: string;
      diagnosis: string;
      procedurePerformed: string;
      services?: import('./types').SessionServiceItem[];
      prescriptionNotes: string;
      visitNotes: string;
      visitStatus: 'completed' | 'follow_up';
      examinationFee: number;
      treatmentFee: number;
      totalFee: number;
      paidAmount: number;
      discountAmount?: number;
      paymentMethod: 'cash' | 'card' | 'transfer';
      isPaid: boolean;
    };
  }) => {
    if (runtime) return runtime.action('walkin.save', payload);
    requireFreshSettingsPermission(payload.patient.isNew ? 'add_patient' : 'edit_patient');
    requireFreshSettingsPermission('register_payment');
    const serviceItems = payload.visit.services || [];
    const visitError = validateWalkInAmounts(payload.visit.examinationFee, serviceItems, payload.visit.paidAmount, payload.visit.discountAmount ?? 0);
    if (visitError) throw new Error(visitError);
    const calculatedTreatmentFee = serviceItems.reduce((sum, service) => sum + service.price, 0);
    if (!Number.isFinite(payload.visit.treatmentFee) || !Number.isFinite(payload.visit.totalFee)
      || Math.abs(calculatedTreatmentFee - payload.visit.treatmentFee) > 0.000001
      || Math.abs(payload.visit.examinationFee + calculatedTreatmentFee - payload.visit.totalFee) > 0.000001) throw new Error('إجمالي الزيارة لا يطابق الكشف والخدمات؛ راجع المسودة.');
    // Each source amount has already passed cent-precision validation. Store
    // canonical totals, not floating-point residue from their UI aggregation.
    const treatmentFee = Math.round(calculatedTreatmentFee * 100) / 100;
    const totalFee = Math.round((payload.visit.examinationFee + treatmentFee) * 100) / 100;
    const visitTeeth = [...new Set(serviceItems.map(service => service.tooth).filter((tooth): tooth is string => !!tooth))];
    const todayStr = localDateISO();
    const timeStr = new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
    const sessionId = `s_${crypto.randomUUID()}`;
    const apptId = `a_${crypto.randomUUID()}`;

    const discountAmt = payload.visit.discountAmount || 0;
    const remainBal = (Math.round(totalFee * 100) - Math.round(payload.visit.paidAmount * 100) - Math.round(discountAmt * 100)) / 100;

    // 1. Session object
    const newSession: import('./types').Session = {
      id: sessionId,
      type: payload.visit.procedurePerformed || 'كشف سريع (زائر)',
      tooth: visitTeeth.length === 1 ? visitTeeth[0] : null,
      teethIds: visitTeeth.length ? visitTeeth : undefined,
      toothLabel: visitTeeth.length ? visitTeeth.map(getToothLabel).join('، ') : undefined,
      amount: totalFee,
      paid: payload.visit.paidAmount,
      discount: discountAmt,
      remain: remainBal,
      date: todayStr,
      time: timeStr,
      paymentsLog: payload.visit.paidAmount > 0 ? [{ id: `inst_${crypto.randomUUID()}`, amount: payload.visit.paidAmount, date: todayStr, paymentMethod: 'cash', createdAt: new Date().toISOString() }] : [],
      chiefComplaint: payload.visit.chiefComplaint,
      diagnosis: payload.visit.diagnosis,
      procedurePerformed: payload.visit.procedurePerformed,
      services: payload.visit.services,
      prescriptionNotes: payload.visit.prescriptionNotes,
      visitNotes: payload.visit.visitNotes,
      examinationFee: payload.visit.examinationFee,
      treatmentFee,
      paymentMethod: 'cash',
      isWalkIn: true,
      visitStatus: payload.visit.visitStatus
    };

    // Patient, receipt and attended visit are persisted together before success.
    const newAppt: Appointment = {
      id: apptId,
      patientId: payload.patient.id,
      fileNo: payload.patient.id,
      patientName: payload.patient.name,
      mobile: payload.patient.mobile,
      date: todayStr,
      time: `${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`,
      note: payload.visit.chiefComplaint ? `زائر بدون موعد: ${payload.visit.chiefComplaint}` : 'كشف سريع (زائر)',
      isFollowUp: payload.visit.visitStatus === 'follow_up',
      isWalkIn: true,
      status: 'attended'
    };

    let savedFileNo = canonicalFileNumber(payload.patient.id);
    return commitDomain([payload.patient.isNew ? 'add_patient' : 'edit_patient', 'add_session', 'register_payment'], data => {
      const patient = payload.patient.isNew ? { ...payload.patient, id: getNextPatientFileNo(data.patients) } : payload.patient;
      savedFileNo = payload.patient.isNew ? patient.id : data.patients.find(item => canonicalFileNumber(item.id) === canonicalFileNumber(patient.id))?.id || canonicalFileNumber(patient.id);
      return addWalkInRecord(data, patient, newSession, newAppt);
    })
      .then(() => {
        setIsWalkInModalOpen(false);
        handleSelectPatient(savedFileNo, 'home');
      });
  };

  const handleToggleSidebarCollapse = () => {
    setIsSidebarCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('dental_sidebar_collapsed', String(next));
      return next;
    });
  };

  // Device Mode State ('auto' | 'mobile' | 'desktop' | 'tv')
  const [deviceMode, setDeviceMode] = useState<DeviceMode>(() => {
    return (localStorage.getItem('dental_device_mode') as DeviceMode) || 'auto';
  });

  // Responsive layout follows the window width; a large monitor is not necessarily a TV.
  const [isDetectedMobile, setIsDetectedMobile] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < 768;
  });

  const [isDetectedTv, setIsDetectedTv] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth >= 1920;
  });

  const handleNavigateWithSubTab = useCallback((view: ActiveView, subTab?: string) => {
    navigateWithRxGuard(()=>{
    setActiveView(view === 'secretary-desk' ? 'home' : view);
    if (view === 'settings') setInitialWhatsAppSection('templates');
    if (subTab) {
      setActiveSubTab(subTab);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }, [navigateWithRxGuard]);

  const handleCloseAddExpenseModal = useCallback(() => {
    setIsAddExpenseModalOpen(false);
  }, []);

  const handleTriggerAddExpense = useCallback(() => {
    handleNavigateWithSubTab('summary');
    setIsAddExpenseModalOpen(true);
  }, [handleNavigateWithSubTab]);

  useEffect(() => {
    let animationFrameId: number;

    const checkDevice = () => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      animationFrameId = requestAnimationFrame(() => {
        const isMobile = window.innerWidth < 768;
        const isTv = window.innerWidth >= 1920;
        setIsDetectedMobile(prev => prev !== isMobile ? isMobile : prev);
        setIsDetectedTv(prev => prev !== isTv ? isTv : prev);
      });
    };

    checkDevice();
    window.addEventListener('resize', checkDevice);
    return () => {
      window.removeEventListener('resize', checkDevice);
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
    };
  }, []);

  // Sync Body Layout Classes and CSS overrides for Device Modes
  useEffect(() => {
    localStorage.setItem('dental_device_mode', deviceMode);

    document.body.classList.remove('tv-mode', 'forced-mobile-mode', 'forced-desktop-mode');

    if (deviceMode === 'tv') {
      document.body.classList.add('tv-mode');
    } else if (deviceMode === 'mobile') {
      document.body.classList.add('forced-mobile-mode');
    } else if (deviceMode === 'desktop') {
      document.body.classList.add('forced-desktop-mode');
    } else if (deviceMode === 'auto') {
      if (isDetectedMobile) {
        document.body.classList.add('forced-mobile-mode');
      }
    }
  }, [deviceMode, isDetectedMobile, isDetectedTv]);

  const handleChangeDeviceMode = (newMode: DeviceMode) => {
    setDeviceMode(newMode);
  };

  // Privacy Mode keyboard shortcut (Ctrl+P or Cmd+P)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        setIsPrivacyMode(prev => {
          const next = !prev;
          Storage.savePrivacyMode(next);
          return next;
        });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Apply Theme CSS variables and Font on load
  useEffect(() => {
    document.documentElement.style.setProperty('--primary', theme.primary);
    document.documentElement.style.setProperty('--secondary', theme.secondary);
    document.documentElement.style.setProperty('--accent', theme.accent);
    document.documentElement.style.setProperty('--bg-main', theme.background);

    // Apply font family
    const fontToApply = theme.fontFamily || "'Cairo', 'Tajawal', sans-serif";
    document.documentElement.style.setProperty('--app-font', fontToApply);
    document.body.style.fontFamily = fontToApply;
  }, [theme]);

  useEffect(() => {
    // Saved custom fonts have one owner. Built-in choices remove a stale link.
    document.getElementById('dynamic-google-font')?.remove();
    const fontUrl=activeFontStylesheet(theme.fontFamily,theme.customFontUrl);
    if (!fontUrl) return;
    const fontLink = document.createElement('link');
    fontLink.id = 'dynamic-google-font';
    fontLink.rel = 'stylesheet';
    fontLink.href = fontUrl;
    fontLink.onerror = () => showToast('تعذّر تحميل الخط المخصص؛ سيُستخدم الخط البديل مؤقتًا.', 'warning');
    document.head.appendChild(fontLink);
    return () => { fontLink.onerror = null; fontLink.remove(); };
  }, [theme.fontFamily, theme.customFontUrl, showToast]);

  // Domain changes persist explicitly under a cross-tab write lock. Rendering,
  // loading a tab and refreshing another tab must never trigger an autosave.

  // Auth Handlers
  const handleAuthenticate = (username: string, password: string): Promise<User> => withClinicWriteLock(async () => {
    if (runtime) return runtime.authenticate(username, password);
    const previous = Storage.getUsers();
    const authenticated = await authenticateLocalAccount(previous, username, password);
    if (!canUserLoginNow(authenticated.user).allowed) throw new Error('الحساب غير متاح الآن حسب جدول العمل.');
    const secured = await secureUserAccountsForStorage(authenticated.users, previous);
    if (JSON.stringify(Storage.getUsers()) !== JSON.stringify(previous)) throw new Error('تغيّرت الحسابات أثناء الدخول؛ أعد المحاولة.');
    const user = secured.find(account => account.id === authenticated.user.id)!;
    if (!canUserLoginNow(user).allowed) throw new Error('انتهى وقت العمل المسموح للحساب.');
    if (JSON.stringify(secured) !== JSON.stringify(previous)) Storage.saveUsersConfirmed(secured);
    setUsers(secured);
    return user;
  });

  const handleLoginSuccess = (user: User, rememberMe: boolean = true) => {
    if (runtime) { void runtime.remember(rememberMe).catch(error => showToast(error.message, 'error')); setCurrentUser(runtime.currentUser()); setIsLoginModalOpen(false); setActiveView('home'); return; }
    Storage.saveCurrentUser(user);
    if (rememberMe) {
      Storage.saveRememberedSession(Storage.createRememberedSession(user));
    } else {
      Storage.saveRememberedSession(null);
    }
    setCurrentUser(user);
    setIsLoginModalOpen(false);

    // Auto-route to appropriate view based on role and device
    const targetView = getDefaultViewForUser(user, isDetectedMobile);
    setActiveView(targetView);
  };

  const handleLogout = useCallback(() => {
    if (runtime) void runtime.logout().catch(() => showToast('لم يتأكد إنهاء جلسة الخادم؛ أعد المحاولة عند رجوع الاتصال.', 'error'));
    cancelConfirm();
    setCurrentUser(null);
    setIsLoginModalOpen(true);
    try { Storage.saveCurrentUser(null); Storage.saveRememberedSession(null); }
    catch { showToast('تم قفل الواجهة، لكن تعذّر مسح جلسة المتصفح. أغلق التبويبات وامسح بيانات الموقع قبل ترك الجهاز.', 'error'); }
  }, [cancelConfirm, showToast]);

  useEffect(() => {
    if (!currentUser) return;
    const verifyAccessWindow = () => {
      const latestUsers = Storage.getUsers();
      const latestUser = latestUsers.find(user => user.id === currentUser.id);
      if (!Storage.getCurrentUser() || !latestUser || !matchesSessionIdentity(latestUser, { userId: currentUser.id, username: currentUser.username, credentialVersion: currentUser.credentialVersion ?? 1 })) {
        handleLogout();
      } else if (!canUserLoginNow(latestUser).allowed) {
        // Lock the active session, but keep a valid remember-me identity for the next shift.
        cancelConfirm();
        setCurrentUser(null);
        try { Storage.saveCurrentUser(null); } catch { showToast('تعذّر مسح جلسة المتصفح؛ أغلق التبويبات قبل ترك الجهاز.', 'error'); }
        setIsLoginModalOpen(true);
      } else {
        setUsers(previous => JSON.stringify(previous) === JSON.stringify(latestUsers) ? previous : latestUsers);
        if (JSON.stringify([latestUser.permissions, latestUser.role, latestUser.name, latestUser.accessSchedule]) !== JSON.stringify([currentUser.permissions, currentUser.role, currentUser.name, currentUser.accessSchedule])) {
          const { password: _password, ...safeUser } = latestUser;
          setCurrentUser(safeUser);
          Storage.saveCurrentUser(safeUser);
        }
      }
    };
    const timer = window.setInterval(verifyAccessWindow, 60_000);
    window.addEventListener('focus', verifyAccessWindow);
    window.addEventListener('storage', verifyAccessWindow);
    document.addEventListener('visibilitychange', verifyAccessWindow);
    verifyAccessWindow();
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', verifyAccessWindow);
      window.removeEventListener('storage', verifyAccessWindow);
      document.removeEventListener('visibilitychange', verifyAccessWindow);
    };
  }, [currentUser, handleLogout, cancelConfirm]);

  const handleOpenLogin = useCallback(() => {
    setIsLoginModalOpen(true);
  }, []);

  // Navigation handlers
  const handleNavigate = useCallback((view: ActiveView) => {
    navigateWithRxGuard(()=>setActiveView(view === 'secretary-desk' ? 'home' : view));
  }, [navigateWithRxGuard]);

  const handleSelectPatient = useCallback((patientId: string, origin: NavigationOrigin) => {
    navigateWithRxGuard(()=>{
    setSelectedPatientId(patientId);
    setNavigationOrigin(origin);
    setActiveView('patient-file');
    });
  }, [navigateWithRxGuard]);

  // Patient Actions
  const handleSavePatient = async (patientData: Omit<Patient, 'sessions' | 'payments'>, originalId?: string, baseline?: Patient) => {
    if (runtime) return runtime.action('patient.save', {value: patientData, ...(originalId ? {originalId} : {})});
    let savedId = patientData.id;
    await commitDomain([originalId === undefined ? 'add_patient' : 'edit_patient'], data => {
      savedId = originalId === undefined ? getNextPatientFileNo(data.patients) : patientData.id;
      const updatedPatients = savePatientRecord(data.patients, { ...patientData, id: savedId }, originalId, baseline);
      savedId = updatedPatients.find(item => canonicalFileNumber(item.id) === canonicalFileNumber(savedId))!.id;
      return { ...data, patients: updatedPatients };
    });
    return savedId;
  };

  const handleDeletePatient = async (patientId: string) => {
    if (runtime) return runtime.action('patient.delete', {id: patientId});
    await commitDomain(['delete_patient'], data => deletePatientRecord(data, patientId));
    if (selectedPatientId === patientId) {
      setSelectedPatientId(null);
      setActiveView('patients');
    }
  };

  const handleSaveSession = (patientId: string, sessionData: Omit<import('./types').Session, 'id'>) => {
    if (runtime) return runtime.action('visit.save', {patientId, value: sessionData});
    if (sessionData.prosthetic || getServiceGroup(sessionData.type) === 'prosthetic' || sessionData.services?.some(item => getServiceGroup(item.name) === 'prosthetic')) throw new Error('سجّل التركيبة من زر «تركيبة جديدة» لربطها بالمعمل والحساب مرة واحدة.');
    const amountCents = financialMoneyCents(sessionData.amount);
    const paidCents = financialMoneyCents(sessionData.paid);
    const discountCents = financialMoneyCents(sessionData.discount ?? 0);
    if (!isValidAppointmentDate(sessionData.date) || discountCents > amountCents || paidCents > amountCents - discountCents) throw new Error('راجع تاريخ الخدمة والتكلفة والخصم والدفعة.');
    const sessionId = `s_${crypto.randomUUID()}`;
    const newSession: import('./types').Session = {
      ...sessionData,
      amount: amountCents / 100,
      paid: paidCents / 100,
      discount: sessionData.discount === undefined ? undefined : discountCents / 100,
      remain: (amountCents - discountCents - paidCents) / 100,
      examinationFee: sessionData.examinationFee === undefined ? undefined : financialMoneyCents(sessionData.examinationFee) / 100,
      treatmentFee: sessionData.treatmentFee === undefined ? undefined : financialMoneyCents(sessionData.treatmentFee) / 100,
      services: sessionData.services?.map(item => ({ ...item, price: financialMoneyCents(item.price) / 100 })),
      paymentsLog: sessionData.paymentsLog?.map(receipt => ({ ...receipt, amount: financialMoneyCents(receipt.amount) / 100 })),
      id: sessionId
    };

    return commitDomain(sessionData.paid > 0 ? ['add_session', 'register_payment'] : ['add_session'], data => {
      if (!data.patients.some(patient => patient.id === patientId)) throw new Error('ملف المريض غير موجود.');
      return { ...data, patients: data.patients.map(p => {
      if (p.id !== patientId) return p;
      const updatedSessions = [newSession, ...p.sessions];

      return {
        ...p,
        sessions: updatedSessions,
        payments: p.payments
      };
      }) };
    });
  };

  const handleCompleteTreatment = (patientId:string,sessionId:string,completed:boolean) => {
    if(runtime)return runtime.action('visit.complete',{patientId,sessionId,completed});
    throw new Error('إغلاق العلاج متاح في نسخة PHP المتصلة بالخادم.');
  };
  const handleSavePrescription = (patientId:string,value:import('./types').PrescriptionDraft) => {
    if(runtime)return runtime.action('rx.save',{patientId,value});
    throw new Error('حفظ الروشتة يحتاج اتصالًا بخادم العيادة.');
  };

  const handleSaveProstheticOrder = (input: ProstheticOrderInput) => {
    if (runtime) return runtime.action('prosthetic.order', {value: input});
    validateProstheticOrder(input);
    return commitDomain(input.paid > 0 ? ['view_patients', 'add_session', 'register_payment'] : ['view_patients', 'add_session'], data =>
      createProstheticOrder(data, input, Storage.getProstheticRouting(), Storage.getLabsFresh(), Storage.getServiceCatalog()));
  };

  const handleAddPaymentInstallment = (patientId: string, sessionId: string, installment: { amount: number; date: string }) => {
    if (runtime) return runtime.action('receipt.add', {patientId, sessionId, value: installment});
    if (!Number.isFinite(installment.amount) || installment.amount <= 0 || !isValidAppointmentDate(installment.date)) throw new Error('راجع مبلغ الدفعة وتاريخ التحصيل.');
    return commitDomain(['register_payment'], data => ({ ...data,
      patients: addPatientReceipt(data.patients, patientId, sessionId, { id: `inst_${crypto.randomUUID()}`,
        amount: installment.amount, date: installment.date, paymentMethod: 'cash', createdAt: new Date().toISOString() }) }));
  };

  // Appointment Actions
  const handleSaveAppointment = (apptData: Omit<Appointment, 'id'> & { id?: string }, baseline?: Appointment) => runtime ? runtime.action('appointment.save', {value: apptData}) :
    commitDomain(['manage_appointments'], data => savePatientAppointment(data, apptData, baseline));

  const handleUpdateApptStatus = (apptId: string, status: AppointmentStatus) => {
    if (runtime) return runtime.action('appointment.status', {id: apptId, status});
    return commitDomain(['manage_appointments'], data => {
      if (!data.appointments.some(appointment => appointment.id === apptId)) throw new Error('الموعد لم يعد موجودًا.');
      if (!['scheduled', 'confirmed', 'waiting', 'attended', 'apologized', 'no_show', 'cancelled'].includes(status)) throw new Error('حالة الموعد غير صالحة.');
      return { ...data, appointments: data.appointments.map(a => a.id === apptId ? { ...a, status } : a) };
    });
  };

  const handleDeleteAppointment = (apptId: string) => {
    if (runtime) return runtime.action('appointment.delete', {id: apptId});
    return commitDomain(['manage_appointments'], data => ({ ...data, appointments: data.appointments.filter(a => a.id !== apptId) }));
  };

  // Lab Actions
  const handleSaveLab = (labData: Omit<Lab, 'id'> & { id?: string }, baseline?: Lab) => withClinicWriteLock(() => {
    if (runtime) return runtime.action('lab.save', {value: labData});
    requireFreshSettingsPermission('manage_lab');
    requireFreshSettingsPermission('view_lab_costs');
    if (isPrivacyMode) throw new Error('أوقف وضع عرض المريض قبل تعديل بيانات المعمل.');
    const latest = Storage.getLabsFresh();
    try {
      const next = prepareLabMetadataSave(latest, labData, baseline, crypto.randomUUID());
      Storage.saveLabsConfirmed(next);
      setLabs(Storage.getLabsFresh());
    } catch (error) {
      setLabs(latest);
      throw error;
    }
  });

  const handleDeleteLab = (labId: string) => withClinicWriteLock(() => {
    if (runtime) return runtime.action('lab.delete', {id: labId});
    requireFreshSettingsPermission('manage_lab');
    requireFreshSettingsPermission('view_lab_costs');
    if (isPrivacyMode) throw new Error('أوقف وضع عرض المريض قبل حذف المعمل.');
    const latest = Storage.getLabsFresh();
    if (!latest.some(lab => lab.id === labId)) { setLabs(latest); throw new Error('هذا المعمل لم يعد موجودًا. راجع قائمة المعامل.'); }
    // Recheck after confirmation, including records saved by another tab.
    if (Storage.getLabCasesFresh().some(item => item.labId === labId) || labCases.some(item => item.labId === labId)) {
      throw new Error('لا يمكن حذف معمل له حالات مسجلة، للحفاظ على حساباته وسجل التركيبات.');
    }
    const routing = Storage.getProstheticRouting();
    if (Object.values(routing.defaultLabs).includes(labId) || routing.overrides.some(item => item.labId === labId)) throw new Error('المعمل مستخدم في توزيع التركيبات. غيّر التوزيع أولًا قبل حذفه.');
    Storage.saveLabsConfirmed(latest.filter(lab => lab.id !== labId));
    setLabs(Storage.getLabsFresh());
  });

  const handleSaveLabPricing = (labId: string, services: LabService[], baseline: Lab) => withClinicWriteLock(() => {
    if (runtime) return runtime.action('lab.prices', {labId, services});
    requireFreshSettingsPermission('manage_prices');
    requireFreshSettingsPermission('view_lab_costs');
    if (isPrivacyMode) throw new Error('أوقف وضع عرض المريض قبل تعديل تكاليف المعامل.');
    const latest = Storage.getLabsFresh();
    try {
      const next = prepareLabPricingSave(latest, labId, services, baseline);
      validateProstheticRouting(Storage.getProstheticRouting(), next);
      requireFreshSettingsPermission('manage_prices');
      requireFreshSettingsPermission('view_lab_costs');
      Storage.saveLabsConfirmed(next);
      setLabs(Storage.getLabsFresh());
    } catch (error) {
      setLabs(latest);
      throw error;
    }
  });

  const handleOpenLabPricing = (labId?: string) => {
    setLabPricingTarget(labId || '*');
    handleNavigateWithSubTab('settings', 'services');
  };

  const handleSaveLabCase = (caseData: Omit<LabCase, 'id'> & { id?: string }) => {
    if (runtime) return runtime.action('lab.legacy', {value: caseData});
    return commitDomain(['manage_lab', 'view_lab_costs'], data => {
    if (caseData.id) {
      const current = data.labCases.find(item => item.id === caseData.id);
      if (!current) throw new Error('حالة المعمل لم تعد موجودة.');
      const next = mergeLabCaseWorkflowUpdate(current, caseData as LabCase);
      assertLabCaseSessionLink(data.labCases, data.patients, next);
      return { ...data, labCases: data.labCases.map(c => c.id === next.id ? next : c) };
    } else {
      if (!data.patients.some(patient => patient.id === caseData.patientId) || !Storage.getLabsFresh().some(lab => lab.id === caseData.labId)) throw new Error('اختر مريضًا ومعملًا موجودين.');
      if (!caseData.linkedSessionId) throw new Error('استخدم «تركيبة جديدة» أو اربط جلسة تركيبة محفوظة؛ لا يمكن إنشاء حساب منفصل عن ملف المريض.');
      const account = getLinkedPatientAccount(caseData as LabCase, data);
      if (!account || (!account.session.prosthetic && getServiceGroup(account.session.type) !== 'prosthetic')) throw new Error('اختر جلسة تركيبة موجودة في ملف المريض.');
      const lab = Storage.getLabsFresh().find(item => item.id === caseData.labId)!;
      const matches = lab.services.filter(item => item.id === caseData.labServiceId && item.category === (caseData.type === 'ثابت' ? 'fixed' : 'removable'));
      if (matches.length !== 1 || !Number.isInteger(caseData.units) || caseData.units < 1 || caseData.units > 100 || !Number.isFinite(matches[0].price) || matches[0].price < 0) throw new Error('راجع خدمة المعمل وعدد الوحدات.');
      const newCase: LabCase = {
        ...caseData,
        id: `lc_${crypto.randomUUID()}`, labTotal: Math.round(matches[0].price * caseData.units * 100) / 100,
        labPaid: 0, paymentsLog: [], patientTotal: account.total, patientPaid: account.paid,
      };
      assertLabCaseSessionLink(data.labCases, data.patients, newCase);
      return { ...data, labCases: [newCase, ...data.labCases] };
    }
    });
  };

  const handleUpdateLabCase = (updatedCase: LabCase) => {
    if (runtime) return runtime.action('lab.progress', {value: updatedCase});
    return commitDomain(['manage_lab'], data => {
      if (!data.labCases.some(item => item.id === updatedCase.id)) throw new Error('حالة المعمل لم تعد موجودة.');
      return { ...data, labCases: data.labCases.map(c => {
      if (c.id !== updatedCase.id) return c;
      if (c.linkedSessionId !== updatedCase.linkedSessionId) {
        requireFreshSettingsPermission('view_lab_costs');
      }
      // A status/link change must not replace a newer payment snapshot.
      const next = mergeLabCaseWorkflowUpdate(c, updatedCase);
      assertLabCaseSessionLink(data.labCases, data.patients, next);
      return next;
    }) };
    });
  };

  const handleAddLabCasePayment = (caseId: string, amount: number, date=localDateISO(),note='') => {
    if (runtime) return runtime.action('lab.payment', {caseId, amount,date,note});
    const amountCents = labMoneyCents(amount);
    if (amountCents <= 0) throw new Error('أدخل مبلغًا صحيحًا للمعمل.');
    const receiptId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    return commitDomain(['manage_lab', 'view_lab_costs'], data => {
    if (!data.labCases.some(item => item.id === caseId)) throw new Error('حالة المعمل لم تعد موجودة.');
    return { ...data, labCases: data.labCases.map(c => {
      if (c.id !== caseId) return c;
      const currentPaid = labMoneyCents(c.labPaid);
      if (amountCents > labMoneyCents(c.labTotal) - currentPaid) throw new Error('الدفعة أكبر من مستحق المعمل الحالي.');
      const newPaid = (currentPaid + amountCents) / 100;
      return {
        ...c,
        labPaid: newPaid,
        paymentsLog: [...(c.paymentsLog || []), { id: receiptId, amount: amountCents / 100, date, note,createdAt, recordedBy: currentUser!.id }]
      };
    }) };
    });
  };

  const handleLabBulkPayment = (labId: string, amount: number,date=localDateISO(),note='دفعة مجمعة للمعمل') => {
    if (runtime) return runtime.action('lab.payment', {labId, amount,date,note});
    const receiptId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    return commitDomain(['manage_lab', 'view_lab_costs'], data => {
      const allocations = allocateLabPayment(data.labCases, labId, amount);
      return { ...data, labCases: data.labCases.map(c => {
        const allocation = allocations.find(a => a.caseId === c.id);
        return allocation ? { ...c, labPaid: (labMoneyCents(c.labPaid) + labMoneyCents(allocation.amount)) / 100,
          paymentsLog: [...(c.paymentsLog || []), { id: receiptId, amount: allocation.amount,
            date, createdAt, recordedBy: currentUser!.id, note }]
        } : c;
      }) };
    });
  };

  // Settings Actions
  const handleSaveIdentity = (values: ClinicIdentitySettings) => {
    if (runtime) return runtime.action('settings.identity', {value: values});
    requireFreshSettingsPermission('access_control_panel');
    Storage.saveClinicIdentity(values);
    setClinicName(values.clinicName);
    setClinicLogo(values.clinicLogo);
    setTheme({ ...values.theme });
  };

  const handleSaveContent = (values: ContentDraft) => {
    if (runtime) return runtime.action('settings.content', {value: values});
    requireFreshSettingsPermission('access_control_panel');
    const latest = Storage.getClinicContent();
    if (JSON.stringify(latest) !== JSON.stringify(cloneContentDraft({ labels, tileOrder }))) {
      setLabels(latest.labels);
      setTileOrder(latest.tileOrder);
      throw new Error('تغيّرت إعدادات المحتوى في تبويب آخر. المسودة لم تُحذف؛ راجع أحدث الإعدادات قبل الحفظ.');
    }
    const next = cloneContentDraft(values);
    Storage.saveClinicContent(next);
    setLabels(next.labels);
    setTileOrder(next.tileOrder);
  };

  const refreshCurrentAccount = useCallback((latestUsers: User[]) => {
    if (currentUser) {
      const match = latestUsers.find(user => matchesSessionIdentity(user, {
        userId: currentUser.id, username: currentUser.username, credentialVersion: currentUser.credentialVersion ?? 1,
      }) && canUserLoginNow(user).allowed);
      if (!match) {
        handleLogout();
        showToast('تغيّرت بيانات الحساب. يرجى تسجيل الدخول مرة أخرى.', 'warning');
      } else {
        const { password: _password, ...safeUser } = match;
        setCurrentUser(safeUser);
        Storage.saveCurrentUser(safeUser);
      }
    }
  }, [currentUser, handleLogout, showToast]);

  const requireFreshSettingsPermission = useCallback((action: RBACAction): User[] => {
    if (!canPerformAction(currentUser, action)) throw new Error('هذا الحساب لا يملك صلاحية حفظ هذه الإعدادات.');
    const latestUsers = Storage.getUsers();
    const activeSession = Storage.getCurrentUser();
    const latestUser = latestUsers.find(user => currentUser && matchesSessionIdentity(user, {
      userId: currentUser.id, username: currentUser.username, credentialVersion: currentUser.credentialVersion ?? 1,
    }));
    if (!activeSession || activeSession.id !== currentUser?.id || activeSession.username !== currentUser?.username
      || (activeSession.credentialVersion ?? 1) !== (currentUser?.credentialVersion ?? 1)
      || !latestUser || !canUserLoginNow(latestUser).allowed) {
      setUsers(latestUsers);
      handleLogout();
      throw new Error('تغيّرت صلاحية جلسة الحساب. سجّل الدخول مرة أخرى قبل الحفظ.');
    }
    if (!canPerformAction(latestUser, action)) {
      setUsers(latestUsers);
      refreshCurrentAccount(latestUsers);
      throw new Error('تغيّرت صلاحيات هذا الحساب؛ لم تُحفظ الإعدادات.');
    }
    return latestUsers;
  }, [currentUser, handleLogout, refreshCurrentAccount]);

  const openHomeAction = useCallback((kind: 'walkIn' | 'schedule' | 'payment' | 'report' | 'invoice') => {
    const actions: Record<typeof kind, RBACAction[]> = {
      walkIn: ['view_patients', 'add_patient', 'add_session', 'register_payment'],
      schedule: ['view_patients', 'manage_appointments'],
      payment: ['view_patients', 'register_payment'],
      report: ['view_patients', 'view_today_collections'],
      invoice: ['view_summary_reports', 'view_expenses'],
    };
    try {
      actions[kind].forEach(requireFreshSettingsPermission);
      if (kind === 'invoice' && Storage.getPrivacyModeFresh()) throw new Error('أوقف وضع عرض المريض قبل فتح مصروفات العيادة.');
      if (kind === 'walkIn') setIsWalkInModalOpen(true);
      if (kind === 'schedule') setIsSmartScheduleOpen(true);
      if (kind === 'payment') setIsHomePaymentOpen(true);
      if (kind === 'report') setIsDailyReportModalOpen(true);
      if (kind === 'invoice') setIsInvoiceOcrOpen(true);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذّر فتح الإجراء. راجع صلاحيات الحساب.', 'error');
    }
  }, [requireFreshSettingsPermission, showToast]);
  const openHomeWalkIn = useCallback(() => openHomeAction('walkIn'), [openHomeAction]);
  const openHomeSchedule = useCallback(() => openHomeAction('schedule'), [openHomeAction]);
  const openHomePayment = useCallback(() => openHomeAction('payment'), [openHomeAction]);
  const openHomeReport = useCallback(() => openHomeAction('report'), [openHomeAction]);
  const openHomeInvoice = useCallback(() => openHomeAction('invoice'), [openHomeAction]);

  const handleSaveUsers = (newUsers: User[]) => withClinicWriteLock(async () => {
    if (runtime) throw Error('استخدم محرر حساب الخادم، لا قائمة كلمات السر المحلية.');
    const latest = requireFreshSettingsPermission('manage_users');
    if (JSON.stringify(latest) !== JSON.stringify(users)) {
      setUsers(latest);
      refreshCurrentAccount(latest);
      throw new Error('تغيّرت الحسابات في تبويب آخر. المسودة لم تُحذف؛ راجع أحدث الحسابات قبل الحفظ.');
    }
    const secured = await secureUserAccountsForStorage(newUsers, latest);
    const checked = requireFreshSettingsPermission('manage_users');
    if (JSON.stringify(checked) !== JSON.stringify(latest)) {
      setUsers(checked);
      refreshCurrentAccount(checked);
      throw new Error('تغيّرت الحسابات أثناء المراجعة. راجع أحدث الحسابات ثم أعد المحاولة.');
    }
    Storage.saveUsersConfirmed(secured);
    const savedUsers = Storage.getUsers();
    setUsers(savedUsers);
    refreshCurrentAccount(savedUsers);
  });

  const handleSaveServiceCatalog = (values: ServiceCatalogValues) => withClinicWriteLock(() => {
    if (runtime) return runtime.action('settings.catalog', {value: values});
    requireFreshSettingsPermission('manage_prices');
    const latest = Storage.getServiceCatalog();
    if (JSON.stringify(latest) !== JSON.stringify(cloneServiceCatalog(serviceCatalog))) {
      setServiceCatalog(latest);
      throw new Error('تغيّرت الخدمات أو الأسعار في تبويب آخر. المسودة لم تُحذف؛ راجع أحدث الإعدادات قبل الحفظ.');
    }
    const checked = validateServiceCatalog(values, latest);
    if (!checked.valid) throw new Error(Object.values(checked.errors)[0]);
    validateProstheticRouting(Storage.getProstheticRouting(), undefined, Object.keys(checked.value.crownPrices));
    requireFreshSettingsPermission('manage_prices');
    Storage.saveServiceCatalog(checked.value);
    setServiceCatalog(cloneServiceCatalog(checked.value));
  });

  const handleSaveProstheticRouting = (value: ProstheticRoutingSettings, baseline: ProstheticRoutingSettings) => withClinicWriteLock(() => {
    if (runtime) return runtime.action('settings.routing', {value});
    const authorize = () => {
      const latestUsers = requireFreshSettingsPermission('access_control_panel');
      const owner = latestUsers.find(item => item.id === currentUser?.id);
      if (!owner || !['doctor', 'admin'].includes(owner.role) || Storage.getPrivacyModeFresh()) throw new Error('إعداد توجيه التركيبات خاص بالطبيب وخارج وضع عرض المريض.');
      (['manage_prices', 'manage_lab', 'view_lab_costs'] as RBACAction[]).forEach(requireFreshSettingsPermission);
    };
    authorize();
    const latest = Storage.getProstheticRouting();
    if (JSON.stringify(latest) !== JSON.stringify(cloneProstheticRouting(baseline))) {
      setProstheticRouting(latest);
      throw new Error('تغيّر توزيع المعامل في تبويب آخر. احتفظ بالمسودة وراجع أحدث الإعدادات.');
    }
    const checked = validateProstheticRouting(value, Storage.getLabsFresh(), Object.keys(Storage.getServiceCatalog().crownPrices));
    authorize();
    Storage.saveProstheticRouting(checked);
    setProstheticRouting(cloneProstheticRouting(checked));
  });

  const handleSaveExpense = (expenseData: Omit<import('./types').Expense, 'id'> & { id?: string }, baseline?: import('./types').Expense) => {
    if (runtime) return runtime.action('expense.save', {value: expenseData});
    return commitDomain(['view_expenses'], data => {
    if (Storage.getPrivacyModeFresh()) throw new Error('أوقف وضع عرض المريض قبل تعديل المصروفات.');
    if (!Number.isFinite(expenseData.amount) || expenseData.amount < 0 || !isValidAppointmentDate(expenseData.date) || !expenseData.title?.trim()) throw new Error('راجع اسم المصروف ومبلغه وتاريخه.');
    if (expenseData.id) {
      const current = data.expenses.find(expense => expense.id === expenseData.id);
      if (!current) throw new Error('المصروف لم يعد موجودًا.');
      const next = prepareBasicExpenseUpdate(current, expenseData, baseline);
      assertUniqueSupplierInvoice(data.expenses, next);
      return { ...data, expenses: data.expenses.map(e => e.id === next.id ? next : e) };
    } else {
      const newExp: import('./types').Expense = {
        ...expenseData,
        id: `exp_${crypto.randomUUID()}`
      };
      assertUniqueSupplierInvoice(data.expenses, newExp);
      return { ...data, expenses: [newExp, ...data.expenses] };
    }
    });
  };

  const handleAddExpense = (expense: Omit<import('./types').Expense, 'id'>) => {
    return handleSaveExpense(expense);
  };

  const handleDeleteExpense = (expenseId: string) => {
    if (runtime) return runtime.action('expense.delete', {id: expenseId});
    return commitDomain(['view_expenses'], data => ({ ...data, expenses: data.expenses.filter(e => e.id !== expenseId) }));
  };

  const handleAddMaterialUsage = (usage: Omit<MaterialUsage, 'id'>) => {
    if (runtime) return runtime.action('material.usage', {value: usage});
    return commitDomain(['view_expenses'], data => {
      if (!isValidAppointmentDate(usage.date) || !Number.isFinite(usage.quantity) || usage.quantity <= 0 || !['used', 'waste'].includes(usage.kind)) throw new Error('راجع كمية الخامة ونوع الحركة وتاريخها.');
      const material = getInventory(data.expenses, data.materialUsages).find(item => item.key === usage.materialKey);
      if (!material || usage.quantity > material.remaining) throw new Error('الكمية تتجاوز المتاح الحالي. راجع المخزون ثم أعد المحاولة.');
      return { ...data, materialUsages: [{ ...usage, materialName: material.name, unit: material.unit,
        unitCostAtUse: material.averageUnitCost, id: `usage_${crypto.randomUUID()}` }, ...data.materialUsages] };
    });
  };

  const handleDeleteMaterialUsage = (id: string) => runtime ? runtime.action('material.delete', {id}) : commitDomain(['view_expenses'], data => ({ ...data, materialUsages: data.materialUsages.filter(usage => usage.id !== id) }));

  const handleSaveWhatsappSettings = (settings: import('./types').WhatsappSettings) => withClinicWriteLock(() => {
    if (runtime) return runtime.action('settings.whatsapp', {value: settings});
    requireFreshSettingsPermission('access_control_panel');
    const latest = Storage.getWhatsappSettingsFresh();
    if (JSON.stringify(latest) !== JSON.stringify(whatsappSettings)) {
      setWhatsappSettings(latest);
      throw new Error('تغيّرت إعدادات واتساب في تبويب آخر. راجع أحدث البيانات ثم أعد المحاولة.');
    }
    Storage.saveWhatsappSettings(settings);
    setWhatsappSettings(settings);
  });

  const handleSaveContact = (contact: ClinicContact, original?: ClinicContact) => runtime ? runtime.action('contacts.save', {value: contact, ...(original ? {original} : {})}) :
    commitDomain(['view_patients', 'edit_patient'], data => ({ ...data, contacts: saveClinicContact(data.contacts, contact, original) }));

  const handleDeleteContact = (original: ClinicContact) => runtime ? runtime.action('contacts.delete', {id: original.id}) :
    commitDomain(['view_patients', 'edit_patient'], data => ({ ...data, contacts: deleteClinicContact(data.contacts, original) }));

  const handleImportContacts = async (rows: ContactImportInput[]): Promise<ContactImportSummary> => {
    if (runtime) return runtime.action('contacts.import', {rows});
    let summary: ContactImportSummary = { addedCount: 0, duplicateCount: 0, invalidCount: 0 };
    await commitDomain(['data_import', 'access_control_panel', 'view_patients', 'edit_patient'], data => {
      const result = applyContactImport(data.contacts, rows);
      summary = { addedCount: result.addedCount, duplicateCount: result.duplicateCount, invalidCount: result.invalidCount };
      return { ...data, contacts: result.contacts };
    });
    return summary;
  };

  const authorizeContactExport = () => { requireFreshSettingsPermission('data_export'); requireFreshSettingsPermission('access_control_panel'); requireFreshSettingsPermission('view_patients'); };

  const authorizeWhatsappSend = ({ isCampaign, requiresFinance }: { isCampaign: boolean; requiresFinance: boolean }) => {
    requireFreshSettingsPermission('view_patients');
    if (isCampaign) requireFreshSettingsPermission('access_control_panel');
    if (requiresFinance) {
      requireFreshSettingsPermission('view_patient_finance');
      requireFreshSettingsPermission('view_remaining_balance');
      if (Storage.getPrivacyModeFresh()) throw new Error('أوقف وضع عرض المريض قبل إرسال بيانات حسابه.');
    }
  };

  const openContactPatient = (patientId: string) => {
    try {
      requireFreshSettingsPermission('view_patients');
      handleSelectPatient(patientId, 'contacts');
    } catch (error) { showToast(error instanceof Error ? error.message : 'تعذّر فتح ملف المريض.', 'error'); }
  };

  const openContactCampaigns = () => {
    try {
      requireFreshSettingsPermission('view_patients');
      requireFreshSettingsPermission('access_control_panel');
      handleNavigateWithSubTab('settings', 'whatsapp');
      setInitialWhatsAppSection('campaigns');
    } catch (error) { showToast(error instanceof Error ? error.message : 'تعذّر فتح الحملات.', 'error'); }
  };

  const handleSaveDrugCatalog = (catalog: import('./types').DrugCatalogItem[]) => {
    if (runtime) return runtime.action('settings.drugs', {value: catalog});
    requireFreshSettingsPermission('access_control_panel');
    const latest = Storage.getDrugCatalogFresh();
    if (JSON.stringify(latest) !== JSON.stringify(drugCatalog)) {
      setDrugCatalog(latest);
      throw new Error('تغيّر فهرس الأدوية في تبويب آخر. المسودة لم تُحذف؛ راجع أحدث الفهرس قبل الحفظ.');
    }
    requireFreshSettingsPermission('access_control_panel');
    Storage.saveDrugCatalogConfirmed(catalog);
    setDrugCatalog(Storage.getDrugCatalogFresh());
  };

  const handleTogglePrivacyMode = useCallback(() => {
    setIsPrivacyMode(prev => {
      const next = !prev;
      Storage.savePrivacyMode(next);
      return next;
    });
  }, []);

  const authorizeDataExport = (kind: 'patients' | 'patient_finance' | 'financial_report' | 'full_backup') => {
    requireFreshSettingsPermission('data_export');
    requireFreshSettingsPermission('view_patients');
    if (kind !== 'patients' && Storage.getPrivacyModeFresh()) throw new Error('أوقف وضع عرض المريض قبل تصدير بيانات مالية أو نسخة كاملة.');
    if (kind === 'patient_finance') requireFreshSettingsPermission('view_patient_finance');
    if (kind === 'financial_report') { requireFreshSettingsPermission('view_patient_finance'); requireFreshSettingsPermission('financial_reports'); }
    if (kind === 'full_backup') {
      ['access_control_panel', 'backup_restore', 'manage_users', 'view_patient_finance', 'financial_reports', 'view_lab_costs', 'view_expenses']
        .forEach(action => requireFreshSettingsPermission(action as RBACAction));
    }
  };

  const authorizePatientImport = () => {
    (['data_import', 'access_control_panel', 'view_patients', 'add_patient'] as RBACAction[]).forEach(requireFreshSettingsPermission);
  };

  const authorizeExpenseExport = () => {
    requireFreshSettingsPermission('data_export');
    requireFreshSettingsPermission('view_expenses');
    if (Storage.getPrivacyModeFresh()) throw new Error('أوقف وضع عرض المريض قبل تنزيل صور الفواتير.');
  };

  const authorizePrescriptionPrint = () => {
    requireFreshSettingsPermission('data_export');
    requireFreshSettingsPermission('print_prescription');
    if (Storage.getPrivacyModeFresh()) throw new Error('أوقف وضع عرض المريض قبل طباعة بياناته.');
  };

  const handleImportPatients = (imported: Patient[]) => runtime ? runtime.action('patients.import', {rows: imported}) : commitDomain(['data_import', 'access_control_panel', 'view_patients', 'add_patient'], latest => {
    const checked = assertClinicBackup({ patients: imported });
    return { ...latest, patients: importPatientRecords(latest.patients, checked.patients!) };
  });

  const handleGetFullBackupSnapshot = () => withClinicWriteLock(async () => {
    if (runtime) {await runtime.refresh();authorizeDataExport('full_backup');return (await runtime.read('backup')).backup;}
    authorizeDataExport('full_backup');
    return assertClinicBackup(Storage.getBackupDataFresh());
  });

  const handleRestoreFullData = (input: unknown) => withClinicWriteLock(async () => {
    if (runtime) return runtime.action('backup.restore', {value: input});
    requireFreshSettingsPermission('data_import');
    authorizeDataExport('full_backup');
    const latest = Storage.getDomainData();
    const checked = assertClinicBackup(input, { patients: latest.patients, appointments: latest.appointments,
      labCases: latest.labCases, labs: Storage.getLabsFresh(), prostheticRouting: Storage.getProstheticRouting(), crownPrices: Storage.getServiceCatalog().crownPrices });
    const previousUsers = Storage.getUsers();
    if (checked.users) checked.users = await secureUserAccountsForStorage(checked.users, previousUsers);
    // Hashing can take time. Revalidate session/time before touching any data.
    requireFreshSettingsPermission('data_import');
    authorizeDataExport('full_backup');
    if (JSON.stringify(Storage.getUsers()) !== JSON.stringify(previousUsers)) throw new Error('تغيّرت الحسابات أثناء الاستعادة؛ أعد المحاولة.');
    Storage.saveBackupConfirmed(checked as unknown as Record<string, unknown>);
    publishDomain(Storage.getDomainData());
    setLabs(Storage.getLabsFresh()); setServiceCatalog(Storage.getServiceCatalog()); setProstheticRouting(Storage.getProstheticRouting());
    setDrugCatalog(Storage.getDrugCatalogFresh()); setWhatsappSettings(Storage.getWhatsappSettings());
    setClinicName(Storage.getClinicName()); setClinicLogo(Storage.getClinicLogo()); setTheme(Storage.getTheme());
    const content = Storage.getClinicContent(); setLabels(content.labels); setTileOrder(content.tileOrder);
    if (checked.users) { const saved = Storage.getUsers(); setUsers(saved); refreshCurrentAccount(saved); }
  });

  const handleClearOperationalData = () => withClinicWriteLock(() => {
    if (runtime) throw Error('مسح سجلات الخادم غير متاح من زر المسح المحلي؛ استخدم نسخة احتياطية وأداة إدارة القاعدة.');
    authorizeDataExport('full_backup');
    const latestUser = Storage.getUsers().find(user => user.id === currentUser?.id);
    if (latestUser?.role !== 'admin' && latestUser?.role !== 'doctor') throw new Error('بدء عيادة فارغة متاح للطبيب أو مدير النظام فقط.');
    // Explicit confirmed local clear only. Never reset accounts or settings,
    // import a backup, or write to any remote project here.
    Storage.clearOperationalDataConfirmed();
    publishDomain({ patients: [], contacts: [], appointments: [], labCases: [], expenses: [], materialUsages: [] });
    setLabs([]);
    setProstheticRouting(Storage.getProstheticRouting());
    setSelectedPatientId(null); setLabPricingTarget(undefined);
    setEndoPatientName('');
    setIsHomePaymentOpen(false); setIsWalkInModalOpen(false); setIsDailyReportModalOpen(false);
    setIsApprovalQueueOpen(false); setIsSmartScheduleOpen(false); setIsInvoiceOcrOpen(false);
    setIsAddExpenseModalOpen(false); setIsEndoHelperOpen(false); setIsMobileDrawerOpen(false);
    setActiveView('home');
  });

  const activePatient = useMemo(() => patients.find(p => p.id === selectedPatientId), [patients, selectedPatientId]);
  const now = new Date();
  const todayISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const todayApptCount = useMemo(() => appointments.filter(a => a.date === todayISO).length, [appointments, todayISO]);
  const activeLabCount = useMemo(() => labCases.filter(c => !['completed','delivered'].includes(c.status)).length, [labCases]);

  // Gatekeeper: If no authenticated user, show ONLY full-screen login interface
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 relative overflow-hidden font-['Cairo',sans-serif]">
        <div className="absolute top-1/4 right-1/4 w-96 h-96 bg-indigo-600/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-1/4 left-1/4 w-96 h-96 bg-sky-600/20 rounded-full blur-3xl pointer-events-none" />
        
        <LoginModal
          users={users}
          clinicName={clinicName}
          clinicLogo={clinicLogo}
          onLogin={handleLoginSuccess}
          onAuthenticate={handleAuthenticate}
          onUpdateUsers={handleSaveUsers}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-[var(--bg-main)] text-[#17262a] font-['Cairo',sans-serif] flex flex-col transition-colors">
      {!runtime && <OfflineSyncBanner />}
      <HeaderNavbar
        activeView={activeView}
        labels={labels}
        activeSubTab={activeSubTab}
        clinicName={clinicName}
        clinicLogo={clinicLogo}
        patients={patients}
        appointments={appointments}
        labCases={labCases}
        expenses={expenses}
        isPrivacyMode={isPrivacyMode}
        deviceMode={deviceMode}
        isDetectedMobile={isDetectedMobile}
        isDetectedTv={isDetectedTv}
        currentUser={currentUser}
        onLogout={handleLogout}
        onTogglePrivacyMode={handleTogglePrivacyMode}
        onNavigate={handleNavigateWithSubTab}
        onSelectPatient={handleSelectPatient}
      />

      <main className={`clinic-workspace flex-1 min-w-0 max-w-7xl 2xl:max-w-[1700px] 3xl:max-w-[2200px] w-full mx-auto px-3 sm:px-6 ${activeView === 'home' || activeView === 'secretary-desk' ? 'pt-1 sm:pt-2 pb-3 sm:pb-6' : 'py-3 sm:py-6'}`}>
        <Suspense fallback={<ViewFallbackLoader />}>
          {(activeView === 'home' || activeView === 'secretary-desk') && (
            <HomeView
              clinicName={clinicName}
              clinicLogo={clinicLogo}
              labels={labels}
              tileOrder={tileOrder}
              patientCount={filePatients.length}
              todayApptCount={todayApptCount}
              activeLabCount={activeLabCount}
              onNavigate={handleNavigateWithSubTab}
              currentUser={currentUser}
              patients={patients}
              appointments={appointments}
              expenses={expenses}
              isPrivacyMode={isPrivacyMode}
              onSelectPatient={handleSelectPatient}
              onLogout={handleLogout}
              onOpenWalkIn={openHomeWalkIn}
              onOpenDailyReport={openHomeReport}
              onOpenScheduleModal={openHomeSchedule}
              onOpenInvoiceModal={openHomeInvoice}
              onOpenPayment={openHomePayment}
            />
          )}

          {activeView === 'patients' && (
            canAccessView(currentUser, 'patients') ? (
              <PatientsView
                nextFileNo={runtime?.nextFileNo()}
                contacts={contacts}
                patients={filePatients}
                appointments={appointments}
                labCases={labCases}
                isPrivacyMode={isPrivacyMode}
                currentUser={currentUser}
                onSelectPatient={handleSelectPatient}
                onSavePatient={handleSavePatient}
                onDeletePatient={handleDeletePatient}
                onSaveAppointment={handleSaveAppointment}
                onOpenContacts={() => handleNavigateWithSubTab('contacts')}
                onBackToHome={() => handleNavigateWithSubTab('home')}
              />
            ) : (
              <PermissionDeniedCard title="قائمة وسجلات المرضى" onBackToHome={() => handleNavigateWithSubTab('home')} />
            )
          )}

          {activeView === 'contacts' && (
            canAccessView(currentUser, 'contacts') ? <ClinicContacts contacts={contacts} patients={patients}
              canManageContacts={canPerformAction(currentUser, 'edit_patient')}
              onSave={handleSaveContact} onDelete={handleDeleteContact} onOpenPatient={openContactPatient}
              onOpenCampaigns={canPerformAction(currentUser, 'access_control_panel') ? openContactCampaigns : undefined} />
              : <PermissionDeniedCard title="جهات الاتصال" onBackToHome={() => handleNavigateWithSubTab('home')} />
          )}

          {activeView === 'patient-file' && activePatient && (
            canAccessView(currentUser, 'patient-file') ? (
              activePatient.withoutFile ? <UnfiledVisitView key={activePatient.id} patient={activePatient} contact={contacts.find(c=>c.id===activePatient.contactId)} showFinance={!isPrivacyMode&&canPerformAction(currentUser,'view_patient_finance')} canPay={canPerformAction(currentUser,'register_payment')} onPay={handleAddPaymentInstallment} onBack={()=>handleNavigateWithSubTab('contacts')}/> : <PatientFileView
                key={activePatient.id}
                patient={activePatient}
                appointments={appointments}
                origin={navigationOrigin}
                serviceTypes={serviceTypes}
                labs={labs}
                crownPrices={crownPrices}
                clinicalPrices={clinicalPrices}
                examinationFee={examinationFee}
                clinicName={clinicName}
                clinicLogo={clinicLogo}
                whatsappSettings={whatsappSettings}
                prescriptionHeader={runtime?.prescriptionHeader()}
                onAuthorizeWhatsappSend={authorizeWhatsappSend}
                readWhatsappSettings={Storage.getWhatsappSettingsFresh}
                drugCatalog={drugCatalog}
                isPrivacyMode={isPrivacyMode || !canPerformAction(currentUser, 'view_patient_finance')}
                capabilities={{
                  patientEdit: canPerformAction(currentUser, 'edit_patient'),
                  registerPayment: canPerformAction(currentUser, 'register_payment'),
                  appointments: canPerformAction(currentUser, 'manage_appointments'),
                  deletePatients: canPerformAction(currentUser, 'delete_patient'),
                  rx: canPerformAction(currentUser, 'print_prescription'),
                  exportData: !isPrivacyMode && canPerformAction(currentUser, 'data_export'),
                  whatsapp: canPerformAction(currentUser, 'view_patients'),
                  viewRemainingBalance: canPerformAction(currentUser, 'view_remaining_balance'),
                }}
                onAuthorizePrint={authorizePrescriptionPrint}
                onSaveSession={handleSaveSession}
                onCompleteTreatment={runtime ? handleCompleteTreatment : undefined}
                onSavePrescription={runtime ? handleSavePrescription : undefined}
                onRxDirtyChange={handleRxDirtyChange}
                onSaveProstheticOrder={canPerformAction(currentUser, 'add_session') ? handleSaveProstheticOrder : undefined}
                onAddPaymentInstallment={handleAddPaymentInstallment}
                onUpdatePatient={async (data, baseline) => { await handleSavePatient(data, data.id, baseline); }}
                onDeletePatient={handleDeletePatient}
                onSaveAppointment={handleSaveAppointment}
                onUpdateApptStatus={handleUpdateApptStatus}
                onDeleteAppointment={handleDeleteAppointment}
                onBack={() => handleNavigateWithSubTab(navigationOrigin === 'contacts' ? 'contacts' : navigationOrigin === 'appointments' ? 'appointments' : navigationOrigin === 'lab' ? 'lab' : 'patients')}
              />
            ) : (
              <PermissionDeniedCard title="ملف المريض" onBackToHome={() => handleNavigateWithSubTab('home')} />
            )
          )}

          {activeView === 'appointments' && (
            canAccessView(currentUser, 'appointments') ? (
              <AppointmentsView localAuditEnabled={!runtime}
                onAddFirstPatient={canPerformAction(currentUser,'add_patient') ? () => handleNavigateWithSubTab('patients') : undefined}
                appointments={appointments}
                patients={patients}
                onSelectPatient={handleSelectPatient}
                onSaveAppointment={handleSaveAppointment}
                onUpdateApptStatus={handleUpdateApptStatus}
                onBackToHome={() => handleNavigateWithSubTab('home')}
              />
            ) : (
              <PermissionDeniedCard title="جدول الحجوزات والمواعيد" onBackToHome={() => handleNavigateWithSubTab('home')} />
            )
          )}

          {activeView === 'lab' && (
            canAccessView(currentUser, 'lab') ? (
              <LabView
                labs={labs}
                labCases={labCases}
                patients={filePatients}
                crownPrices={crownPrices}
                examinationFee={examinationFee}
                onSaveProstheticOrder={canPerformAction(currentUser, 'add_session') ? handleSaveProstheticOrder : undefined}
                canRegisterPayment={canPerformAction(currentUser, 'register_payment')}
                onSaveLab={handleSaveLab}
                onDeleteLab={handleDeleteLab}
                onSaveLabCase={handleSaveLabCase}
                onUpdateLabCase={handleUpdateLabCase}
                onAddLabCasePayment={handleAddLabCasePayment}
                onOpenPatient={patientId=>handleSelectPatient(patientId,'lab')}
                onBulkPayment={handleLabBulkPayment}
                onManageLabPrices={canAccessView(currentUser, 'settings') ? handleOpenLabPricing : undefined}
                onBackToHome={() => handleNavigateWithSubTab('home')}
                canViewFinancials={canPerformAction(currentUser, 'view_lab_costs') && !isPrivacyMode}
                canManagePrices={canPerformAction(currentUser, 'manage_prices')}
              />
            ) : (
              <PermissionDeniedCard title="متابعة حالات التركيبات" onBackToHome={() => handleNavigateWithSubTab('home')} />
            )
          )}

          {activeView === 'summary' && (
            canAccessView(currentUser, 'summary') ? (
              <SummaryView
                canExportData={!isPrivacyMode && canPerformAction(currentUser, 'data_export')}
                onAuthorizeDataExport={authorizeExpenseExport}
                patients={patients}
                labCases={labCases}
                expenses={expenses}
                materialUsages={materialUsages}
                isPrivacyMode={isPrivacyMode}
                capabilities={{
                  viewExpenses: canPerformAction(currentUser, 'view_expenses'),
                  viewProfits: canPerformAction(currentUser, 'view_profits'),
                  financialReports: canPerformAction(currentUser, 'financial_reports'),
                }}
                isOpenAddExpenseModal={isAddExpenseModalOpen}
                onCloseAddExpenseModal={handleCloseAddExpenseModal}
                onAddExpense={handleAddExpense}
                onSaveExpense={handleSaveExpense}
                onDeleteExpense={handleDeleteExpense}
                onAddMaterialUsage={handleAddMaterialUsage}
                onDeleteMaterialUsage={handleDeleteMaterialUsage}
                onBackToHome={() => handleNavigateWithSubTab('home')}
              />
            ) : (
              <PermissionDeniedCard title="الملخص المالي والتقارير" onBackToHome={() => handleNavigateWithSubTab('home')} />
            )
          )}

          {activeView === 'settings' && (
            canAccessView(currentUser, 'settings') ? (
              <SettingsView
                activeSubTab={activeSubTab}
                onSubTabChange={setActiveSubTab}
                clinicName={clinicName}
                clinicLogo={clinicLogo}
                theme={theme}
                labels={labels}
                tileOrder={tileOrder}
                users={users}
                currentUser={currentUser}
                serviceTypes={serviceTypes}
                crownPrices={crownPrices}
                clinicalPrices={clinicalPrices}
                examinationFee={examinationFee}
                canManagePrices={canPerformAction(currentUser, 'manage_prices')}
                patients={patients}
                contacts={contacts}
                canViewPatients={canPerformAction(currentUser, 'view_patients')}
                appointments={appointments}
                labs={labs}
                labCases={labCases}
                expenses={expenses}
                materialUsages={materialUsages}
                whatsappSettings={whatsappSettings}
                canViewPatientFinance={!isPrivacyMode && canPerformAction(currentUser, 'view_remaining_balance')}
                canExportPatientFinance={!isPrivacyMode && canPerformAction(currentUser, 'data_export') && canPerformAction(currentUser, 'view_patient_finance')}
                canExportFinancialReports={!isPrivacyMode && canPerformAction(currentUser, 'data_export') && canPerformAction(currentUser, 'view_patient_finance') && canPerformAction(currentUser, 'financial_reports')}
                canManageFullBackup={!isPrivacyMode && ['backup_restore', 'manage_users', 'view_patients', 'view_patient_finance', 'financial_reports', 'view_lab_costs', 'view_expenses'].every(action => canPerformAction(currentUser, action as RBACAction))}
                onAuthorizeDataExport={authorizeDataExport}
                onGetFullBackupSnapshot={handleGetFullBackupSnapshot}
                drugCatalog={drugCatalog}
                onSaveIdentity={handleSaveIdentity}
                onSaveContent={handleSaveContent}
                onSaveUsers={handleSaveUsers}
                onSaveServiceCatalog={handleSaveServiceCatalog}
                prostheticRouting={prostheticRouting}
                onSaveProstheticRouting={currentUser && ['doctor', 'admin'].includes(currentUser.role) && !isPrivacyMode ? handleSaveProstheticRouting : undefined}
                onSaveLabPricing={handleSaveLabPricing}
                initialPricingLabId={labPricingTarget}
                canViewLabCosts={canPerformAction(currentUser, 'view_lab_costs') && !isPrivacyMode}
                canManageLabPrices={canPerformAction(currentUser, 'manage_prices') && canPerformAction(currentUser, 'view_lab_costs') && !isPrivacyMode}
                onSaveWhatsappSettings={handleSaveWhatsappSettings}
                onAuthorizeWhatsappSend={authorizeWhatsappSend}
                readWhatsappSettings={Storage.getWhatsappSettingsFresh}
                onSaveContact={handleSaveContact}
                onDeleteContact={handleDeleteContact}
                onImportContacts={handleImportContacts}
                onAuthorizeContactExport={authorizeContactExport}
                canManageContacts={canPerformAction(currentUser, 'view_patients') && canPerformAction(currentUser, 'edit_patient')}
                initialWhatsAppSection={initialWhatsAppSection}
                onOpenPatient={canPerformAction(currentUser, 'view_patients') ? openContactPatient : undefined}
                onSaveDrugCatalog={handleSaveDrugCatalog}
                onImportPatients={handleImportPatients}
                canImportPatients={canPerformAction(currentUser, 'data_import') && canPerformAction(currentUser, 'view_patients') && canPerformAction(currentUser, 'add_patient')}
                onAuthorizePatientImport={authorizePatientImport}
                onRestoreFullData={handleRestoreFullData}
                onClearOperationalData={handleClearOperationalData}
                onBackToHome={() => handleNavigateWithSubTab('home')}
              />
            ) : (
              <PermissionDeniedCard title="لوحة التحكم والإعدادات" onBackToHome={() => handleNavigateWithSubTab('home')} />
            )
          )}

        </Suspense>
      </main>
      <MobileBottomNav
        activeView={activeView}
        labels={labels}
        tileOrder={tileOrder}
        currentUser={currentUser}
        appointments={appointments}
        labCases={labCases}
        onNavigate={handleNavigateWithSubTab}
      />


      {isLoginModalOpen && (
        <LoginModal
          users={users}
          clinicName={clinicName}
          clinicLogo={clinicLogo}
          onLogin={handleLoginSuccess}
          onAuthenticate={handleAuthenticate}
          onUpdateUsers={handleSaveUsers}
        />
      )}

      <Suspense fallback={<ModalOpeningPlaceholder onClose={() => {
        setIsHomePaymentOpen(false); setIsWalkInModalOpen(false); setIsDailyReportModalOpen(false);
        setIsApprovalQueueOpen(false); setIsSmartScheduleOpen(false); setIsInvoiceOcrOpen(false); setIsEndoHelperOpen(false);
      }} />}>
        {isHomePaymentOpen && canPerformAction(currentUser, 'view_patients') && canPerformAction(currentUser, 'register_payment') && (
          <HomePaymentModal patients={patients}
            showRemaining={!isPrivacyMode && canPerformAction(currentUser, 'view_remaining_balance')}
            onClose={() => setIsHomePaymentOpen(false)} onSave={handleAddPaymentInstallment}
            onOpenPatient={patientId => handleSelectPatient(patientId, 'home')} />
        )}
        {/* Quick Walk-in Visit Modal */}
        {isWalkInModalOpen && homeActionAccess.walkIn && (
          <QuickWalkInModal
            nextFileNo={runtime?.nextFileNo()}
            isOpen={isWalkInModalOpen}
            onClose={() => setIsWalkInModalOpen(false)}
            patients={filePatients}
            serviceTypes={serviceTypes}
            clinicalPrices={clinicalPrices}
            defaultExamFee={examinationFee}
            onSaveWalkInVisit={handleSaveWalkInVisit}
            allowWithoutFile={!!runtime}
            contacts={contacts}
          />
        )}

        {/* Daily Financial & Visit Report Modal */}
        {isDailyReportModalOpen && homeActionAccess.report && (
          <DailyReportModal
            isOpen={isDailyReportModalOpen}
            onClose={() => setIsDailyReportModalOpen(false)}
            patients={patients}
            appointments={appointments}
            isPrivacyMode={isPrivacyMode}
            canViewRemainingBalance={canPerformAction(currentUser, 'view_remaining_balance')}
            canViewHistory={canPerformAction(currentUser, 'financial_reports')}
            onSelectPatientFile={canPerformAction(currentUser, 'view_patients') ? (pId) => handleSelectPatient(pId, 'home') : undefined}
          />
        )}

        {/* Doctor Approval Queue Modal */}
        {isApprovalQueueOpen && (
          <ApprovalQueueModal
            isOpen={isApprovalQueueOpen}
            onClose={() => setIsApprovalQueueOpen(false)}
            currentUser={currentUser}
          />
        )}

        {/* AI Smart Schedule & Workload Balancer Modal */}
        {isSmartScheduleOpen && homeActionAccess.schedule && (
          <SmartScheduleModal
            isOpen={isSmartScheduleOpen}
            onClose={() => setIsSmartScheduleOpen(false)}
            patients={filePatients}
            existingAppointments={appointments}
            onBookAppointment={handleSaveAppointment}
          />
        )}

        {/* AI Invoice OCR Expense Modal */}
        {isInvoiceOcrOpen && homeActionAccess.invoice && !isPrivacyMode && (
          <InvoiceOcrModal
            isOpen={isInvoiceOcrOpen}
            onClose={() => setIsInvoiceOcrOpen(false)}
            onSaveExpense={handleSaveExpense}
            existingExpenses={expenses}
          />
        )}

        {/* AI Endodontic Working Length Assistant Modal */}
        {isEndoHelperOpen && (
          <EndodonticHelperModal
            isOpen={isEndoHelperOpen}
            onClose={() => setIsEndoHelperOpen(false)}
            toothNumber={endoToothNumber}
            patientName={endoPatientName}
            onSaveWorkingLength={(data) => {
              // Working length saved with auto cleanup flag
            }}
          />
        )}
      </Suspense>
    </div>
  );
}

export default function App() {
  // Do not accidentally deploy local/unsigned accounts as a public clinical app.
  // Replace this gate only with an authoritative authenticated data layer.
  if (typeof window !== 'undefined' && !isLocalClinicHost(window.location.hostname)) {
    return <main dir="rtl" className="min-h-screen grid place-items-center bg-slate-50 p-6">
      <section role="alert" className="max-w-lg rounded-2xl border bg-white p-6 text-center space-y-3">
        <h1 className="text-xl font-bold">التشغيل الحالي محلي فقط</h1>
        <p>حماية بيانات العيادة عبر الإنترنت تحتاج خادمًا موثوقًا للحسابات وقاعدة البيانات والصلاحيات أولًا، ولا تتطلب شركة استضافة بعينها. لم يتم تحميل ملفات المرضى أو فتح حساب محلي على هذا الرابط.</p>
        <p className="text-sm text-slate-600">افتح المعاينة على نفس الجهاز من 127.0.0.1 أو localhost.</p>
      </section>
    </main>;
  }
  return (
    <ToastAndConfirmProvider>
      <AppContent />
    </ToastAndConfirmProvider>
  );
}
