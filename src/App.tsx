import React, { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { ActiveView, NavigationOrigin, LabService, Patient, ClinicContact, Appointment, AppointmentStatus, Lab, LabCase, ThemeSettings, UILabels, User, DeviceMode, Session, MaterialUsage } from './types';
import { Storage, STORAGE_FAILURE_EVENT, CLINIC_CONTENT_STORAGE_KEYS, SERVICE_CATALOG_STORAGE_KEYS, DRUG_CATALOG_STORAGE_KEY, LABS_STORAGE_KEY, CLINIC_DOMAIN_STORAGE_KEYS } from './utils/storage';
import type { ClinicIdentitySettings, ClinicDomainData } from './utils/storage';
import { withClinicWriteLock } from './utils/clinicWriteLock';
import { addWalkInRecord, savePatientRecord, addPatientReceipt, importPatientRecords, canonicalFileNumber } from './utils/clinicMutations';
import { saveClinicContact, deleteClinicContact } from './utils/clinicContacts';
import { isLocalClinicHost } from './utils/localRuntime';
import { assertClinicBackup } from './utils/backupValidation';
import { authenticateLocalAccount, secureUserAccountsForStorage } from './utils/passwords';
import { cloneContentDraft } from './utils/clinicContent';
import type { ContentDraft } from './utils/clinicContent';
import { cloneServiceCatalog, validateServiceCatalog } from './utils/serviceCatalog';
import type { ServiceCatalogValues } from './utils/serviceCatalog';
import { getDefaultViewForUser, canAccessView, canPerformAction } from './utils/rbac';
import type { RBACAction } from './utils/rbac';
import { canUserLoginNow, matchesSessionIdentity, matchesRememberedSession } from './utils/accessControl';
import { allocateLabPayment } from './utils/labFinancials';
import { prepareLabMetadataSave, prepareLabPricingSave, mergeLabCaseWorkflowUpdate } from './utils/labManagement';
import { mergeExpenseUpdate } from './utils/expenseUtils';
import { getInventory } from './utils/inventory';
import { appendSessionReceipt } from './utils/financials';
import { isValidAppointmentDate, appointmentTimeMinutes, localDateISO } from './components/appointments/appointmentScheduling';
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
    <div className="w-full py-12 flex flex-col items-center justify-center space-y-3 font-cairo dir-rtl animate-fadeIn">
      <div className="w-10 h-10 border-3 border-purple-600 border-t-transparent rounded-full animate-spin" />
      <p className="text-xs font-bold text-slate-500">جارٍ تحميل الشاشة...</p>
    </div>
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

export function AppContent() {
  useVisibleViewport();
  const { showToast, cancelConfirm } = useToastAndConfirm();
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
  const { serviceTypes, crownPrices } = serviceCatalog;
  const [clinicName, setClinicName] = useState<string>(() => Storage.getClinicName());
  const [clinicLogo, setClinicLogo] = useState<string | null>(() => Storage.getClinicLogo());

  const [expenses, setExpenses] = useState<import('./types').Expense[]>(() => Storage.getExpenses());
  const [materialUsages, setMaterialUsages] = useState<MaterialUsage[]>(() => Storage.getMaterialUsages());
  const [whatsappSettings, setWhatsappSettings] = useState<import('./types').WhatsappSettings>(() => Storage.getWhatsappSettings());
  const [drugCatalog, setDrugCatalog] = useState<import('./types').DrugCatalogItem[]>(() => Storage.getDrugCatalogFresh());
  const [isPrivacyMode, setIsPrivacyMode] = useState<boolean>(() => Storage.getPrivacyMode());

  const publishDomain = useCallback((data: ClinicDomainData) => {
    setPatients(data.patients); setAppointments(data.appointments); setLabCases(data.labCases);
    setExpenses(data.expenses); setMaterialUsages(data.materialUsages); setContacts(data.contacts);
  }, []);

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

  const handleSaveWalkInVisit = (payload: {
    patient: {
      isNew: boolean;
      id: string;
      name: string;
      mobile: string;
      age: number;
      gender?: string;
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
    requireFreshSettingsPermission(payload.patient.isNew ? 'add_patient' : 'edit_patient');
    requireFreshSettingsPermission('register_payment');
    if ([payload.visit.totalFee, payload.visit.paidAmount, payload.visit.discountAmount ?? 0].some(amount => !Number.isFinite(amount) || amount < 0) || payload.visit.paidAmount + (payload.visit.discountAmount ?? 0) > payload.visit.totalFee) throw new Error('راجع مبالغ الزيارة والدفعة والخصم.');
    const todayStr = localDateISO();
    const timeStr = new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
    const sessionId = `s_${crypto.randomUUID()}`;
    const apptId = `a_${crypto.randomUUID()}`;

    const discountAmt = payload.visit.discountAmount || 0;
    const remainBal = Math.max(0, payload.visit.totalFee - payload.visit.paidAmount - discountAmt);

    // 1. Session object
    const newSession: import('./types').Session = {
      id: sessionId,
      type: payload.visit.procedurePerformed || 'كشف سريع (زائر)',
      tooth: null,
      amount: payload.visit.totalFee,
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
      treatmentFee: payload.visit.treatmentFee,
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

    return commitDomain([payload.patient.isNew ? 'add_patient' : 'edit_patient', 'add_session', 'register_payment'], data => addWalkInRecord(data, payload.patient, newSession, newAppt))
      .then(() => {
        setIsWalkInModalOpen(false);
        handleSelectPatient(canonicalFileNumber(payload.patient.id), 'home');
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
    setActiveView(view === 'secretary-desk' ? 'home' : view);
    if (view === 'settings') setInitialWhatsAppSection('templates');
    if (subTab) {
      setActiveSubTab(subTab);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

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
    if (!theme.customFontUrl?.trim()) return;
    const fontLink = document.createElement('link');
    fontLink.id = 'dynamic-google-font';
    fontLink.rel = 'stylesheet';
    fontLink.href = theme.customFontUrl;
    fontLink.onerror = () => showToast('تعذّر تحميل الخط المخصص؛ سيُستخدم الخط البديل مؤقتًا.', 'warning');
    document.head.appendChild(fontLink);
    return () => { fontLink.onerror = null; fontLink.remove(); };
  }, [theme.customFontUrl, showToast]);

  // Domain changes persist explicitly under a cross-tab write lock. Rendering,
  // loading a tab and refreshing another tab must never trigger an autosave.

  // Auth Handlers
  const handleAuthenticate = (username: string, password: string): Promise<User> => withClinicWriteLock(async () => {
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
    setActiveView(view === 'secretary-desk' ? 'home' : view);
  }, []);

  const handleSelectPatient = useCallback((patientId: string, origin: NavigationOrigin) => {
    setSelectedPatientId(patientId);
    setNavigationOrigin(origin);
    setActiveView('patient-file');
  }, []);

  // Patient Actions
  const handleSavePatient = (patientData: Omit<Patient, 'sessions' | 'payments'>, originalId?: string) => {
    return commitDomain([originalId === undefined ? 'add_patient' : 'edit_patient'], data => ({ ...data,
      patients: savePatientRecord(data.patients, patientData, originalId) }));
  };

  const handleDeletePatient = async (patientId: string) => {
    await commitDomain(['delete_patient'], data => {
      if (data.labCases.some(item => item.patientId === patientId)) throw new Error('الملف مرتبط بشغل معمل. احتفظ به للحفاظ على ارتباط الحسابات وسجل التركيبات.');
      if (!data.patients.some(patient => patient.id === patientId)) throw new Error('الملف لم يعد موجودًا.');
      return { ...data, patients: data.patients.filter(patient => patient.id !== patientId),
        appointments: data.appointments.filter(appointment => appointment.patientId !== patientId) };
    });
    if (selectedPatientId === patientId) {
      setSelectedPatientId(null);
      setActiveView('patients');
    }
  };

  const handleSaveSession = (patientId: string, sessionData: Omit<import('./types').Session, 'id'>) => {
    if (!isValidAppointmentDate(sessionData.date) || !Number.isFinite(sessionData.amount) || sessionData.amount < 0 || !Number.isFinite(sessionData.paid) || sessionData.paid < 0 || !Number.isFinite(sessionData.discount ?? 0) || (sessionData.discount ?? 0) < 0 || (sessionData.discount ?? 0) > sessionData.amount || sessionData.paid > sessionData.amount - (sessionData.discount ?? 0)) throw new Error('راجع تاريخ الخدمة والتكلفة والخصم والدفعة.');
    const sessionId = `s_${crypto.randomUUID()}`;
    const newSession: import('./types').Session = {
      ...sessionData,
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

  const handleAddPaymentInstallment = (patientId: string, sessionId: string, installment: { amount: number; date: string }) => {
    if (!Number.isFinite(installment.amount) || installment.amount <= 0 || !isValidAppointmentDate(installment.date)) throw new Error('راجع مبلغ الدفعة وتاريخ التحصيل.');
    return commitDomain(['register_payment'], data => ({ ...data,
      patients: addPatientReceipt(data.patients, patientId, sessionId, { id: `inst_${crypto.randomUUID()}`,
        amount: installment.amount, date: installment.date, paymentMethod: 'cash', createdAt: new Date().toISOString() }) }));
  };

  // Appointment Actions
  const handleSaveAppointment = (apptData: Omit<Appointment, 'id'> & { id?: string }) => {
    return commitDomain(['manage_appointments'], data => {
    const linkedPatient = data.patients.find(patient => patient.id === apptData.patientId);
    if (!linkedPatient) throw new Error('اختر ملف مريض موجودًا قبل حجز الموعد.');
    if (!isValidAppointmentDate(apptData.date) || appointmentTimeMinutes(apptData.time) === null) throw new Error('اختر تاريخًا ووقتًا صحيحين للموعد.');
    if (apptData.durationMinutes !== undefined && (!Number.isFinite(apptData.durationMinutes) || apptData.durationMinutes <= 0 || apptData.durationMinutes > 1440)) throw new Error('أدخل مدة موعد صحيحة أكبر من صفر وأقل من يوم.');
    const canonicalData = { ...apptData, patientName: linkedPatient.name, fileNo: linkedPatient.id, mobile: linkedPatient.mobile };
    if (apptData.id) {
      if (!data.appointments.some(appointment => appointment.id === apptData.id)) throw new Error('الموعد المطلوب تعديله غير موجود.');
      return { ...data, appointments: data.appointments.map(a => a.id === apptData.id ? { ...a, ...canonicalData } as Appointment : a) };
    } else {
      const newAppt: Appointment = {
        ...canonicalData,
        id: `a_${crypto.randomUUID()}`
      };
      return { ...data, appointments: [newAppt, ...data.appointments] };
    }
    });
  };

  const handleUpdateApptStatus = (apptId: string, status: AppointmentStatus) => {
    return commitDomain(['manage_appointments'], data => {
      if (!data.appointments.some(appointment => appointment.id === apptId)) throw new Error('الموعد لم يعد موجودًا.');
      if (!['scheduled', 'confirmed', 'waiting', 'attended', 'apologized', 'no_show', 'cancelled'].includes(status)) throw new Error('حالة الموعد غير صالحة.');
      return { ...data, appointments: data.appointments.map(a => a.id === apptId ? { ...a, status } : a) };
    });
  };

  const handleDeleteAppointment = (apptId: string) => {
    return commitDomain(['manage_appointments'], data => ({ ...data, appointments: data.appointments.filter(a => a.id !== apptId) }));
  };

  // Lab Actions
  const handleSaveLab = (labData: Omit<Lab, 'id'> & { id?: string }, baseline?: Lab) => withClinicWriteLock(() => {
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
    requireFreshSettingsPermission('manage_lab');
    requireFreshSettingsPermission('view_lab_costs');
    if (isPrivacyMode) throw new Error('أوقف وضع عرض المريض قبل حذف المعمل.');
    const latest = Storage.getLabsFresh();
    if (!latest.some(lab => lab.id === labId)) { setLabs(latest); throw new Error('هذا المعمل لم يعد موجودًا. راجع قائمة المعامل.'); }
    // Recheck after confirmation, including records saved by another tab.
    if (Storage.getLabCasesFresh().some(item => item.labId === labId) || labCases.some(item => item.labId === labId)) {
      throw new Error('لا يمكن حذف معمل له حالات مسجلة، للحفاظ على حساباته وسجل التركيبات.');
    }
    Storage.saveLabsConfirmed(latest.filter(lab => lab.id !== labId));
    setLabs(Storage.getLabsFresh());
  });

  const handleSaveLabPricing = (labId: string, services: LabService[], baseline: Lab) => withClinicWriteLock(() => {
    requireFreshSettingsPermission('manage_prices');
    requireFreshSettingsPermission('view_lab_costs');
    if (isPrivacyMode) throw new Error('أوقف وضع عرض المريض قبل تعديل تكاليف المعامل.');
    const latest = Storage.getLabsFresh();
    try {
      const next = prepareLabPricingSave(latest, labId, services, baseline);
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
    return commitDomain(['manage_lab', 'view_lab_costs'], data => {
    if (!data.patients.some(patient => patient.id === caseData.patientId) || !Storage.getLabsFresh().some(lab => lab.id === caseData.labId)) throw new Error('اختر مريضًا ومعملًا موجودين.');
    if ([caseData.labTotal, caseData.labPaid, caseData.patientTotal].some(amount => !Number.isFinite(amount) || amount < 0) || caseData.labPaid > caseData.labTotal) throw new Error('راجع مبالغ التركيبة وحساب المعمل.');
    if (caseData.id) {
      if (!data.labCases.some(item => item.id === caseData.id)) throw new Error('حالة المعمل لم تعد موجودة.');
      return { ...data, labCases: data.labCases.map(c => c.id === caseData.id ? mergeLabCaseWorkflowUpdate(c, caseData as LabCase) : c) };
    } else {
      const newCase: LabCase = {
        ...caseData,
        id: `lc_${crypto.randomUUID()}`
      };
      return { ...data, labCases: [newCase, ...data.labCases] };
    }
    });
  };

  const handleUpdateLabCase = (updatedCase: LabCase) => {
    return commitDomain(['manage_lab'], data => ({ ...data, labCases: data.labCases.map(c => {
      if (c.id !== updatedCase.id) return c;
      if (c.linkedSessionId !== updatedCase.linkedSessionId) {
        requireFreshSettingsPermission('view_lab_costs');
        if (updatedCase.linkedSessionId && data.labCases.some(other => other.id !== c.id && other.patientId === c.patientId && other.linkedSessionId === updatedCase.linkedSessionId)) throw new Error('الخدمة مرتبطة بحالة معمل أخرى.');
      }
      // A status/link change must not replace a newer payment snapshot.
      return mergeLabCaseWorkflowUpdate(c, updatedCase);
    }) }));
  };

  const handleAddLabCasePayment = (caseId: string, amount: number) => {
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('أدخل مبلغًا صحيحًا للمعمل.');
    const receiptId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    return commitDomain(['manage_lab', 'view_lab_costs'], data => {
    if (!data.labCases.some(item => item.id === caseId)) throw new Error('حالة المعمل لم تعد موجودة.');
    return { ...data, labCases: data.labCases.map(c => {
      if (c.id !== caseId) return c;
      if (amount > c.labTotal - c.labPaid) throw new Error('الدفعة أكبر من مستحق المعمل الحالي.');
      const newPaid = c.labPaid + amount;
      return {
        ...c,
        labPaid: newPaid,
        paymentsLog: [...(c.paymentsLog || []), { id: receiptId, amount, date: localDateISO(), createdAt, recordedBy: currentUser!.id }]
      };
    }) };
    });
  };

  const handleLabBulkPayment = (labId: string, amount: number) => {
    const receiptId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    return commitDomain(['manage_lab', 'view_lab_costs'], data => {
      const allocations = allocateLabPayment(data.labCases, labId, amount);
      return { ...data, labCases: data.labCases.map(c => {
        const allocation = allocations.find(a => a.caseId === c.id);
        return allocation ? { ...c, labPaid: c.labPaid + allocation.amount,
          paymentsLog: [...(c.paymentsLog || []), { id: receiptId, amount: allocation.amount,
            date: localDateISO(), createdAt, recordedBy: currentUser!.id, note: 'دفعة مجمعة للمعمل' }]
        } : c;
      }) };
    });
  };

  // Settings Actions
  const handleSaveIdentity = (values: ClinicIdentitySettings) => {
    requireFreshSettingsPermission('access_control_panel');
    Storage.saveClinicIdentity(values);
    setClinicName(values.clinicName);
    setClinicLogo(values.clinicLogo);
    setTheme({ ...values.theme });
  };

  const handleSaveContent = (values: ContentDraft) => {
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

  const refreshCurrentAccount = (latestUsers: User[]) => {
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
  };

  const requireFreshSettingsPermission = (action: RBACAction): User[] => {
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
  };

  const handleSaveUsers = (newUsers: User[]) => withClinicWriteLock(async () => {
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

  const handleSaveServiceCatalog = (values: ServiceCatalogValues) => {
    requireFreshSettingsPermission('manage_prices');
    const latest = Storage.getServiceCatalog();
    if (JSON.stringify(latest) !== JSON.stringify(cloneServiceCatalog(serviceCatalog))) {
      setServiceCatalog(latest);
      throw new Error('تغيّرت الخدمات أو الأسعار في تبويب آخر. المسودة لم تُحذف؛ راجع أحدث الإعدادات قبل الحفظ.');
    }
    const checked = validateServiceCatalog(values, latest);
    if (!checked.valid) throw new Error(Object.values(checked.errors)[0]);
    requireFreshSettingsPermission('manage_prices');
    Storage.saveServiceCatalog(checked.value);
    setServiceCatalog(cloneServiceCatalog(checked.value));
  };

  const handleSaveExpense = (expenseData: Omit<import('./types').Expense, 'id'> & { id?: string }) => {
    return commitDomain(['view_expenses'], data => {
    if (isPrivacyMode) throw new Error('أوقف وضع عرض المريض قبل تعديل المصروفات.');
    if (!Number.isFinite(expenseData.amount) || expenseData.amount < 0 || !isValidAppointmentDate(expenseData.date) || !expenseData.title?.trim()) throw new Error('راجع اسم المصروف ومبلغه وتاريخه.');
    if (expenseData.id) {
      if (!data.expenses.some(expense => expense.id === expenseData.id)) throw new Error('المصروف لم يعد موجودًا.');
      return { ...data, expenses: data.expenses.map(e => e.id === expenseData.id ? mergeExpenseUpdate(e, expenseData) : e) };
    } else {
      const newExp: import('./types').Expense = {
        ...expenseData,
        id: `exp_${crypto.randomUUID()}`
      };
      return { ...data, expenses: [newExp, ...data.expenses] };
    }
    });
  };

  const handleAddExpense = (expense: Omit<import('./types').Expense, 'id'>) => {
    return handleSaveExpense(expense);
  };

  const handleDeleteExpense = (expenseId: string) => {
    return commitDomain(['view_expenses'], data => ({ ...data, expenses: data.expenses.filter(e => e.id !== expenseId) }));
  };

  const handleAddMaterialUsage = (usage: Omit<MaterialUsage, 'id'>) => {
    return commitDomain(['view_expenses'], data => {
      if (!isValidAppointmentDate(usage.date) || !Number.isFinite(usage.quantity) || usage.quantity <= 0 || !['used', 'waste'].includes(usage.kind)) throw new Error('راجع كمية الخامة ونوع الحركة وتاريخها.');
      const material = getInventory(data.expenses, data.materialUsages).find(item => item.key === usage.materialKey);
      if (!material || usage.quantity > material.remaining) throw new Error('الكمية تتجاوز المتاح الحالي. راجع المخزون ثم أعد المحاولة.');
      return { ...data, materialUsages: [{ ...usage, materialName: material.name, unit: material.unit,
        unitCostAtUse: material.averageUnitCost, id: `usage_${crypto.randomUUID()}` }, ...data.materialUsages] };
    });
  };

  const handleDeleteMaterialUsage = (id: string) => commitDomain(['view_expenses'], data => ({ ...data, materialUsages: data.materialUsages.filter(usage => usage.id !== id) }));

  const handleSaveWhatsappSettings = (settings: import('./types').WhatsappSettings) => withClinicWriteLock(() => {
    requireFreshSettingsPermission('access_control_panel');
    const latest = Storage.getWhatsappSettingsFresh();
    if (JSON.stringify(latest) !== JSON.stringify(whatsappSettings)) {
      setWhatsappSettings(latest);
      throw new Error('تغيّرت إعدادات واتساب في تبويب آخر. راجع أحدث البيانات ثم أعد المحاولة.');
    }
    Storage.saveWhatsappSettings(settings);
    setWhatsappSettings(settings);
  });

  const handleSaveContact = (contact: ClinicContact, original?: ClinicContact) =>
    commitDomain(['view_patients', 'edit_patient'], data => ({ ...data, contacts: saveClinicContact(data.contacts, contact, original) }));

  const handleDeleteContact = (original: ClinicContact) =>
    commitDomain(['view_patients', 'edit_patient'], data => ({ ...data, contacts: deleteClinicContact(data.contacts, original) }));

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

  const handleTogglePrivacyMode = () => {
    setIsPrivacyMode(prev => {
      const next = !prev;
      Storage.savePrivacyMode(next);
      return next;
    });
  };

  const authorizeDataExport = (kind: 'patients' | 'patient_finance' | 'financial_report' | 'full_backup') => {
    requireFreshSettingsPermission('view_patients');
    if (kind !== 'patients' && Storage.getPrivacyModeFresh()) throw new Error('أوقف وضع عرض المريض قبل تصدير بيانات مالية أو نسخة كاملة.');
    if (kind === 'patient_finance') requireFreshSettingsPermission('view_patient_finance');
    if (kind === 'financial_report') { requireFreshSettingsPermission('view_patient_finance'); requireFreshSettingsPermission('financial_reports'); }
    if (kind === 'full_backup') {
      ['backup_restore', 'manage_users', 'view_patient_finance', 'financial_reports', 'view_lab_costs', 'view_expenses']
        .forEach(action => requireFreshSettingsPermission(action as RBACAction));
    }
  };

  const handleImportPatients = (imported: Patient[]) => commitDomain(['add_patient'], latest => {
    const checked = assertClinicBackup({ patients: imported });
    return { ...latest, patients: importPatientRecords(latest.patients, checked.patients!) };
  });

  const handleRestoreFullData = (input: unknown) => withClinicWriteLock(async () => {
    authorizeDataExport('full_backup');
    const latest = Storage.getDomainData();
    const checked = assertClinicBackup(input, { patients: latest.patients, appointments: latest.appointments,
      labCases: latest.labCases, labs: Storage.getLabsFresh() });
    const previousUsers = Storage.getUsers();
    if (checked.users) checked.users = await secureUserAccountsForStorage(checked.users, previousUsers);
    // Hashing can take time. Revalidate session/time before touching any data.
    authorizeDataExport('full_backup');
    if (JSON.stringify(Storage.getUsers()) !== JSON.stringify(previousUsers)) throw new Error('تغيّرت الحسابات أثناء الاستعادة؛ أعد المحاولة.');
    Storage.saveBackupConfirmed(checked as unknown as Record<string, unknown>);
    publishDomain(Storage.getDomainData());
    setLabs(Storage.getLabsFresh()); setServiceCatalog(Storage.getServiceCatalog());
    setDrugCatalog(Storage.getDrugCatalogFresh()); setWhatsappSettings(Storage.getWhatsappSettings());
    setClinicName(Storage.getClinicName()); setClinicLogo(Storage.getClinicLogo()); setTheme(Storage.getTheme());
    const content = Storage.getClinicContent(); setLabels(content.labels); setTileOrder(content.tileOrder);
    if (checked.users) { const saved = Storage.getUsers(); setUsers(saved); refreshCurrentAccount(saved); }
  });

  const handleResetAllData = () => withClinicWriteLock(() => {
    authorizeDataExport('full_backup');
    if (currentUser?.role !== 'admin' && currentUser?.role !== 'doctor') throw new Error('إعادة ضبط العيادة متاحة للطبيب أو مدير النظام فقط.');
    cancelConfirm();
    Storage.resetAll();
    window.location.reload();
  });

  const activePatient = patients.find(p => p.id === selectedPatientId);
  const now = new Date();
  const todayISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const todayApptCount = appointments.filter(a => a.date === todayISO).length;

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
      <OfflineSyncBanner />
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

      <main className="clinic-workspace flex-1 min-w-0 max-w-7xl 2xl:max-w-[1700px] 3xl:max-w-[2200px] w-full mx-auto px-3 sm:px-6 py-3 sm:py-6">
        <Suspense fallback={<ViewFallbackLoader />}>
          {(activeView === 'home' || activeView === 'secretary-desk') && (
            <HomeView
              clinicName={clinicName}
              clinicLogo={clinicLogo}
              labels={labels}
              tileOrder={tileOrder}
              patientCount={patients.length}
              todayApptCount={todayApptCount}
              activeLabCount={labCases.filter(c => c.status !== 'completed').length}
              onNavigate={handleNavigateWithSubTab}
              currentUser={currentUser}
              patients={patients}
              appointments={appointments}
              expenses={expenses}
              isPrivacyMode={isPrivacyMode}
              onSelectPatient={handleSelectPatient}
              onLogout={handleLogout}
              onOpenWalkIn={() => setIsWalkInModalOpen(true)}
              onOpenDailyReport={() => setIsDailyReportModalOpen(true)}
              onOpenScheduleModal={() => setIsSmartScheduleOpen(true)}
              onOpenInvoiceModal={() => setIsInvoiceOcrOpen(true)}
              onOpenPayment={() => setIsHomePaymentOpen(true)}
            />
          )}

          {activeView === 'patients' && (
            canAccessView(currentUser, 'patients') ? (
              <PatientsView
                patients={patients}
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
              <PatientFileView
                patient={activePatient}
                appointments={appointments}
                origin={navigationOrigin}
                serviceTypes={serviceTypes}
                labs={labs}
                crownPrices={crownPrices}
                clinicName={clinicName}
                whatsappSettings={whatsappSettings}
                drugCatalog={drugCatalog}
                isPrivacyMode={isPrivacyMode || !canPerformAction(currentUser, 'view_patient_finance')}
                capabilities={{
                  patientEdit: canPerformAction(currentUser, 'edit_patient'),
                  registerPayment: canPerformAction(currentUser, 'register_payment'),
                  appointments: canPerformAction(currentUser, 'manage_appointments'),
                  deletePatients: canPerformAction(currentUser, 'delete_patient'),
                  rx: canPerformAction(currentUser, 'print_prescription'),
                  whatsapp: canPerformAction(currentUser, 'view_patients'),
                  viewRemainingBalance: canPerformAction(currentUser, 'view_remaining_balance'),
                }}
                onSaveSession={handleSaveSession}
                onAddPaymentInstallment={handleAddPaymentInstallment}
                onUpdatePatient={data => handleSavePatient(data, data.id)}
                onDeletePatient={handleDeletePatient}
                onSaveAppointment={handleSaveAppointment}
                onUpdateApptStatus={handleUpdateApptStatus}
                onDeleteAppointment={handleDeleteAppointment}
                onBack={() => handleNavigateWithSubTab(navigationOrigin === 'contacts' ? 'contacts' : navigationOrigin === 'appointments' ? 'appointments' : 'patients')}
              />
            ) : (
              <PermissionDeniedCard title="ملف المريض" onBackToHome={() => handleNavigateWithSubTab('home')} />
            )
          )}

          {activeView === 'appointments' && (
            canAccessView(currentUser, 'appointments') ? (
              <AppointmentsView
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
                patients={patients}
                crownPrices={crownPrices}
                onSaveLab={handleSaveLab}
                onDeleteLab={handleDeleteLab}
                onSaveLabCase={handleSaveLabCase}
                onUpdateLabCase={handleUpdateLabCase}
                onAddLabCasePayment={handleAddLabCasePayment}
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
                canExportPatientFinance={!isPrivacyMode && canPerformAction(currentUser, 'view_patient_finance')}
                canExportFinancialReports={!isPrivacyMode && canPerformAction(currentUser, 'view_patient_finance') && canPerformAction(currentUser, 'financial_reports')}
                canManageFullBackup={!isPrivacyMode && ['backup_restore', 'manage_users', 'view_patients', 'view_patient_finance', 'financial_reports', 'view_lab_costs', 'view_expenses'].every(action => canPerformAction(currentUser, action as RBACAction))}
                onAuthorizeDataExport={authorizeDataExport}
                drugCatalog={drugCatalog}
                onSaveIdentity={handleSaveIdentity}
                onSaveContent={handleSaveContent}
                onSaveUsers={handleSaveUsers}
                onSaveServiceCatalog={handleSaveServiceCatalog}
                onSaveLabPricing={handleSaveLabPricing}
                initialPricingLabId={labPricingTarget}
                canViewLabCosts={canPerformAction(currentUser, 'view_lab_costs') && !isPrivacyMode}
                canManageLabPrices={canPerformAction(currentUser, 'manage_prices') && canPerformAction(currentUser, 'view_lab_costs') && !isPrivacyMode}
                onSaveWhatsappSettings={handleSaveWhatsappSettings}
                onSaveContact={handleSaveContact}
                onDeleteContact={handleDeleteContact}
                canManageContacts={canPerformAction(currentUser, 'view_patients') && canPerformAction(currentUser, 'edit_patient')}
                initialWhatsAppSection={initialWhatsAppSection}
                onOpenPatient={canPerformAction(currentUser, 'view_patients') ? openContactPatient : undefined}
                onSaveDrugCatalog={handleSaveDrugCatalog}
                onImportPatients={handleImportPatients}
                onRestoreFullData={handleRestoreFullData}
                onResetAllData={handleResetAllData}
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
        {isWalkInModalOpen && (
          <QuickWalkInModal
            isOpen={isWalkInModalOpen}
            onClose={() => setIsWalkInModalOpen(false)}
            patients={patients}
            onSaveWalkInVisit={handleSaveWalkInVisit}
          />
        )}

        {/* Daily Financial & Visit Report Modal */}
        {isDailyReportModalOpen && (
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
        {isSmartScheduleOpen && (
          <SmartScheduleModal
            isOpen={isSmartScheduleOpen}
            onClose={() => setIsSmartScheduleOpen(false)}
            patients={patients}
            existingAppointments={appointments}
            onBookAppointment={handleSaveAppointment}
          />
        )}

        {/* AI Invoice OCR Expense Modal */}
        {isInvoiceOcrOpen && (
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
        <p>حماية بيانات العيادة عبر الإنترنت تحتاج إكمال Firebase Authentication وقواعد الوصول أولًا. لم يتم تحميل ملفات المرضى أو فتح حساب محلي على هذا الرابط.</p>
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
