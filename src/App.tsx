import React, { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { ActiveView, NavigationOrigin, Patient, Appointment, AppointmentStatus, Lab, LabCase, ThemeSettings, UILabels, User, DeviceMode, Session, MaterialUsage } from './types';
import { Storage, STORAGE_FAILURE_EVENT } from './utils/storage';
import { getDefaultViewForUser, canAccessView } from './utils/rbac';
import { canUserLoginNow, matchesSessionIdentity } from './utils/accessControl';
import { allocateLabPayment } from './utils/labFinancials';
import { mergeExpenseUpdate } from './utils/expenseUtils';
import { appendSessionReceipt } from './utils/financials';
import { isValidAppointmentDate, appointmentTimeMinutes, localDateISO } from './components/appointments/appointmentScheduling';
import { ToastAndConfirmProvider, useToastAndConfirm } from './components/common/ToastAndConfirm';
import { HeaderNavbar } from './components/common/HeaderNavbar';
import { SidebarNav } from './components/navigation/SidebarNav';
import { MobileBottomNav } from './components/navigation/MobileBottomNav';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { LoginModal } from './components/auth/LoginModal';
import { OfflineSyncBanner } from './components/common/OfflineSyncBanner';
import { HomeView } from './components/home/HomeView';

// Code-split views & modals via React.lazy for ultra-fast mobile startup and reduced bundle size
const PatientsView = lazy(() => import('./components/patients/PatientsView').then(m => ({ default: m.PatientsView })));
const PatientFileView = lazy(() => import('./components/patient/PatientFileView').then(m => ({ default: m.PatientFileView })));
const AppointmentsView = lazy(() => import('./components/appointments/AppointmentsView').then(m => ({ default: m.AppointmentsView })));
const LabView = lazy(() => import('./components/lab/LabView').then(m => ({ default: m.LabView })));
const SummaryView = lazy(() => import('./components/summary/SummaryView').then(m => ({ default: m.SummaryView })));
const SettingsView = lazy(() => import('./components/settings/SettingsView').then(m => ({ default: m.SettingsView })));
const SecretaryDeskView = lazy(() => import('./components/secretary/SecretaryDeskView').then(m => ({ default: m.SecretaryDeskView })));

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

export function AppContent() {
  const { showToast } = useToastAndConfirm();
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
      const match = savedUsers.find(u => matchesSessionIdentity(u, remembered));
      if (match) {
        if (!canUserLoginNow(match).allowed) {
          Storage.saveCurrentUser(null);
          return null;
        }
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
  const [appointments, setAppointments] = useState<Appointment[]>(() => Storage.getAppointments());
  const [labs, setLabs] = useState<Lab[]>(() => Storage.getLabs());
  const [labCases, setLabCases] = useState<LabCase[]>(() => Storage.getLabCases());
  const [theme, setTheme] = useState<ThemeSettings>(() => Storage.getTheme());
  const [labels, setLabels] = useState<UILabels>(() => Storage.getUILabels());
  const [tileOrder, setTileOrder] = useState<string[]>(() => Storage.getTileOrder());

  const [serviceTypes, setServiceTypes] = useState<string[]>(() => Storage.getServiceTypes());
  const [crownPrices, setCrownPrices] = useState<Record<string, number>>(() => Storage.getCrownPrices());
  const [clinicName, setClinicName] = useState<string>(() => Storage.getClinicName());
  const [clinicLogo, setClinicLogo] = useState<string | null>(() => Storage.getClinicLogo());

  const [expenses, setExpenses] = useState<import('./types').Expense[]>(() => Storage.getExpenses());
  const [materialUsages, setMaterialUsages] = useState<MaterialUsage[]>(() => Storage.getMaterialUsages());
  const [whatsappSettings, setWhatsappSettings] = useState<import('./types').WhatsappSettings>(() => Storage.getWhatsappSettings());
  const [drugCatalog, setDrugCatalog] = useState<import('./types').DrugCatalogItem[]>(() => Storage.getDrugCatalog());
  const [isPrivacyMode, setIsPrivacyMode] = useState<boolean>(() => Storage.getPrivacyMode());

  // Hybrid Navigation Layout State
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem('dental_sidebar_collapsed') === 'true';
    }
    return false;
  });

  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState<string>('identity');

  // Walk-in Visit and End-of-day report modal states
  const [isWalkInModalOpen, setIsWalkInModalOpen] = useState(false);
  const [isDailyReportModalOpen, setIsDailyReportModalOpen] = useState(false);

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
    if (!currentUser?.permissions.patientEdit || !(currentUser?.permissions.registerPayment ?? currentUser?.permissions.patientFinance)) throw new Error('هذا الحساب لا يملك صلاحية تسجيل الزيارة والتحصيل.');
    if ([payload.visit.totalFee, payload.visit.paidAmount, payload.visit.discountAmount ?? 0].some(amount => !Number.isFinite(amount) || amount < 0) || payload.visit.paidAmount + (payload.visit.discountAmount ?? 0) > payload.visit.totalFee) throw new Error('راجع مبالغ الزيارة والدفعة والخصم.');
    const todayStr = localDateISO();
    const timeStr = new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
    const sessionId = `s_${Date.now()}`;
    const apptId = `a_${Date.now()}`;

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
      paymentsLog: payload.visit.paidAmount > 0 ? [{ id: `inst_${Date.now()}`, amount: payload.visit.paidAmount, date: todayStr }] : [],
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

    // 2. Update Patients State
    setPatients(prev => {
      const existingIdx = prev.findIndex(p => p.id === payload.patient.id);
      
      if (existingIdx >= 0) {
        // Existing patient
        const updated = [...prev];
        const target = updated[existingIdx];
        
        const updatedSessions = [newSession, ...target.sessions];
        updated[existingIdx] = {
          ...target,
          mobile: payload.patient.mobile || target.mobile,
          sessions: updatedSessions,
          payments: target.payments
        };
        return updated;
      } else {
        // Brand new patient
        const newPatient: Patient = {
          id: payload.patient.id,
          name: payload.patient.name,
          mobile: payload.patient.mobile,
          age: payload.patient.age ?? 0,
          gender: payload.patient.gender,
          firstVisit: todayStr,
          notes: payload.visit.visitNotes,
          allergy: '',
          sessions: [newSession],
          payments: []
        };
        return [newPatient, ...prev];
      }
    });

    // 3. Automatically add to today's appointments as attended walk-in
    const newAppt: Appointment = {
      id: apptId,
      patientId: payload.patient.id,
      fileNo: payload.patient.id,
      patientName: payload.patient.name,
      mobile: payload.patient.mobile,
      date: todayStr,
      time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
      note: payload.visit.chiefComplaint ? `زائر بدون موعد: ${payload.visit.chiefComplaint}` : 'كشف سريع (زائر)',
      isFollowUp: payload.visit.visitStatus === 'follow_up',
      isWalkIn: true,
      status: 'attended'
    };

    setAppointments(prev => [newAppt, ...prev]);

    // Close modal and navigate to patient file
    setIsWalkInModalOpen(false);
    handleSelectPatient(payload.patient.id, 'home');
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

  // Automatically detect screen width & device type (Mobile vs Computer Browser vs Large TV 60")
  const [isDetectedMobile, setIsDetectedMobile] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < 768 || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  });

  const [isDetectedTv, setIsDetectedTv] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth >= 1920 || (typeof window.screen !== 'undefined' && window.screen.width >= 1920);
  });

  const handleNavigateWithSubTab = useCallback((view: ActiveView, subTab?: string) => {
    setActiveView(view);
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
        const isMobile = window.innerWidth < 768 || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
        const isTv = window.innerWidth >= 1920 || (typeof window.screen !== 'undefined' && window.screen.width >= 1920);
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
      if (isDetectedTv && !isDetectedMobile) {
        document.body.classList.add('tv-mode');
      } else if (isDetectedMobile) {
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

    // Inject custom Google Font stylesheet if provided
    if (theme.customFontUrl && theme.customFontUrl.trim()) {
      let fontLink = document.getElementById('dynamic-google-font') as HTMLLinkElement;
      if (!fontLink) {
        fontLink = document.createElement('link');
        fontLink.id = 'dynamic-google-font';
        fontLink.rel = 'stylesheet';
        document.head.appendChild(fontLink);
      }
      fontLink.href = theme.customFontUrl;
    }
  }, [theme]);

  // Sync state to storage
  useEffect(() => { Storage.savePatients(patients); }, [patients]);
  useEffect(() => { Storage.saveAppointments(appointments); }, [appointments]);
  useEffect(() => { Storage.saveLabs(labs); }, [labs]);
  useEffect(() => { Storage.saveLabCases(labCases); }, [labCases]);
  useEffect(() => { Storage.saveExpenses(expenses); }, [expenses]);
  useEffect(() => { Storage.saveMaterialUsages(materialUsages); }, [materialUsages]);
  useEffect(() => { Storage.saveWhatsappSettings(whatsappSettings); }, [whatsappSettings]);
  useEffect(() => { Storage.saveDrugCatalog(drugCatalog); }, [drugCatalog]);

  // Auth Handlers
  const handleLoginSuccess = (user: User, rememberMe: boolean = true) => {
    setCurrentUser(user);
    Storage.saveCurrentUser(user);
    if (rememberMe) {
      Storage.saveRememberedSession(Storage.createRememberedSession(user));
    } else {
      Storage.saveRememberedSession(null);
    }
    setIsLoginModalOpen(false);

    // Auto-route to appropriate view based on role and device
    const targetView = getDefaultViewForUser(user, isDetectedMobile);
    setActiveView(targetView);
  };

  const handleLogout = useCallback(() => {
    setCurrentUser(null);
    Storage.saveCurrentUser(null);
    Storage.saveRememberedSession(null);
    setIsLoginModalOpen(true);
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    const verifyAccessWindow = () => {
      const latestUsers = Storage.getUsers();
      const latestUser = latestUsers.find(user => user.id === currentUser.id);
      if (!latestUser || !matchesSessionIdentity(latestUser, { userId: currentUser.id, username: currentUser.username, credentialVersion: currentUser.credentialVersion ?? 1 })) {
        handleLogout();
      } else if (!canUserLoginNow(latestUser).allowed) {
        // Lock the active session, but keep a valid remember-me identity for the next shift.
        setCurrentUser(null);
        Storage.saveCurrentUser(null);
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
  }, [currentUser, handleLogout]);

  const handleOpenLogin = useCallback(() => {
    setIsLoginModalOpen(true);
  }, []);

  // Navigation handlers
  const handleNavigate = useCallback((view: ActiveView) => {
    setActiveView(view);
  }, []);

  const handleSelectPatient = useCallback((patientId: string, origin: NavigationOrigin) => {
    setSelectedPatientId(patientId);
    setNavigationOrigin(origin);
    setActiveView('patient-file');
  }, []);

  // Patient Actions
  const handleSavePatient = (patientData: Omit<Patient, 'sessions' | 'payments'>) => {
    if (!currentUser?.permissions.patientEdit) throw new Error('هذا الحساب لا يملك صلاحية تعديل ملفات المرضى.');
    if (!patientData.id?.trim() || !patientData.name?.trim()) throw new Error('أدخل رقم الملف واسم المريض.');
    setPatients(prev => {
      const idx = prev.findIndex(p => p.id === patientData.id);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = {
          ...updated[idx],
          ...patientData
        };
        return updated;
      } else {
        const newPatient: Patient = {
          ...patientData,
          sessions: [],
          payments: []
        };
        return [newPatient, ...prev];
      }
    });
  };

  const handleDeletePatient = (patientId: string) => {
    if (!currentUser?.permissions.deletePatients) throw new Error('هذا الحساب لا يملك صلاحية حذف ملفات المرضى.');
    if (labCases.some(item => item.patientId === patientId)) {
      throw new Error('الملف مرتبط بشغل معمل. احتفظ به للحفاظ على ارتباط الحسابات وسجل التركيبات.');
    }
    setPatients(prev => prev.filter(p => p.id !== patientId));
    setAppointments(prev => prev.filter(a => a.patientId !== patientId));
    if (selectedPatientId === patientId) {
      setSelectedPatientId(null);
      setActiveView('patients');
    }
  };

  const handleSaveSession = (patientId: string, sessionData: Omit<import('./types').Session, 'id'>) => {
    if (!currentUser?.permissions.patientEdit) throw new Error('هذا الحساب لا يملك صلاحية تسجيل الخدمات.');
    if (sessionData.paid > 0 && !(currentUser.permissions.registerPayment ?? currentUser.permissions.patientFinance)) throw new Error('هذا الحساب لا يملك صلاحية تسجيل الدفعات.');
    if (!patients.some(patient => patient.id === patientId)) throw new Error('ملف المريض غير موجود.');
    if (!isValidAppointmentDate(sessionData.date) || !Number.isFinite(sessionData.amount) || sessionData.amount < 0 || !Number.isFinite(sessionData.paid) || sessionData.paid < 0 || !Number.isFinite(sessionData.discount ?? 0) || (sessionData.discount ?? 0) < 0 || (sessionData.discount ?? 0) > sessionData.amount || sessionData.paid > sessionData.amount - (sessionData.discount ?? 0)) throw new Error('راجع تاريخ الخدمة والتكلفة والخصم والدفعة.');
    const sessionId = `s_${Date.now()}`;
    const newSession: import('./types').Session = {
      ...sessionData,
      id: sessionId
    };

    setPatients(prev => prev.map(p => {
      if (p.id !== patientId) return p;
      const updatedSessions = [newSession, ...p.sessions];

      return {
        ...p,
        sessions: updatedSessions,
        payments: p.payments
      };
    }));
  };

  const handleAddPaymentInstallment = (patientId: string, sessionId: string, installment: { amount: number; date: string }) => {
    if (!(currentUser?.permissions.registerPayment ?? currentUser?.permissions.patientFinance)) throw new Error('هذا الحساب لا يملك صلاحية تسجيل الدفعات.');
    if (!Number.isFinite(installment.amount) || installment.amount <= 0 || !isValidAppointmentDate(installment.date)) throw new Error('راجع مبلغ الدفعة وتاريخ التحصيل.');
    if (!patients.find(patient => patient.id === patientId)?.sessions.some(session => session.id === sessionId)) throw new Error('الخدمة المطلوب سدادها غير موجودة.');
    const instId = `inst_${Date.now()}`;

    setPatients(prev => prev.map(p => {
      if (p.id !== patientId) return p;

      const updatedSessions = p.sessions.map(s => {
        if (s.id !== sessionId) return s;
        return appendSessionReceipt(s, { id: instId, amount: installment.amount, date: installment.date, paymentMethod: 'cash', createdAt: new Date().toISOString() });
      });

      return {
        ...p,
        sessions: updatedSessions,
        payments: p.payments
      };
    }));
  };

  // Appointment Actions
  const handleSaveAppointment = (apptData: Omit<Appointment, 'id'> & { id?: string }) => {
    if (!currentUser?.permissions.appointments) throw new Error('هذا الحساب لا يملك صلاحية إدارة المواعيد.');
    const linkedPatient = patients.find(patient => patient.id === apptData.patientId);
    if (!linkedPatient) throw new Error('اختر ملف مريض موجودًا قبل حجز الموعد.');
    if (!isValidAppointmentDate(apptData.date) || appointmentTimeMinutes(apptData.time) === null) throw new Error('اختر تاريخًا ووقتًا صحيحين للموعد.');
    if (apptData.durationMinutes !== undefined && (!Number.isFinite(apptData.durationMinutes) || apptData.durationMinutes <= 0 || apptData.durationMinutes > 1440)) throw new Error('أدخل مدة موعد صحيحة أكبر من صفر وأقل من يوم.');
    const canonicalData = { ...apptData, patientName: linkedPatient.name, fileNo: linkedPatient.id, mobile: linkedPatient.mobile };
    if (apptData.id) {
      if (!appointments.some(appointment => appointment.id === apptData.id)) throw new Error('الموعد المطلوب تعديله غير موجود.');
      setAppointments(prev => prev.map(a => a.id === apptData.id ? { ...a, ...canonicalData } as Appointment : a));
    } else {
      const newAppt: Appointment = {
        ...canonicalData,
        id: `a_${crypto.randomUUID()}`
      };
      setAppointments(prev => [newAppt, ...prev]);
    }
  };

  const handleUpdateApptStatus = (apptId: string, status: AppointmentStatus) => {
    if (!currentUser?.permissions.appointments) throw new Error('هذا الحساب لا يملك صلاحية إدارة المواعيد.');
    setAppointments(prev => prev.map(a => a.id === apptId ? { ...a, status } : a));
  };

  const handleDeleteAppointment = (apptId: string) => {
    if (!currentUser?.permissions.appointments) throw new Error('هذا الحساب لا يملك صلاحية إدارة المواعيد.');
    setAppointments(prev => prev.filter(a => a.id !== apptId));
  };

  // Lab Actions
  const handleSaveLab = (labData: Omit<Lab, 'id'> & { id?: string }) => {
    if (labData.id) {
      setLabs(prev => prev.map(l => l.id === labData.id ? (labData as Lab) : l));
    } else {
      const newLab: Lab = {
        ...labData,
        id: `lab_${Date.now()}`
      };
      setLabs(prev => [...prev, newLab]);
    }
  };

  const handleDeleteLab = (labId: string) => {
    setLabs(prev => prev.filter(l => l.id !== labId));
  };

  const handleSaveLabCase = (caseData: Omit<LabCase, 'id'> & { id?: string }) => {
    if (caseData.id) {
      setLabCases(prev => prev.map(c => c.id === caseData.id ? (caseData as LabCase) : c));
    } else {
      const newCase: LabCase = {
        ...caseData,
        id: `lc_${Date.now()}`
      };
      setLabCases(prev => [newCase, ...prev]);
    }
  };

  const handleUpdateLabCase = (updatedCase: LabCase) => {
    setLabCases(prev => prev.map(c => {
      if (c.id !== updatedCase.id) return c;
      if (c.linkedSessionId !== updatedCase.linkedSessionId) {
        if (currentUser?.permissions?.labProfit !== true) return c;
        if (updatedCase.linkedSessionId && prev.some(other => other.id !== c.id && other.patientId === c.patientId && other.linkedSessionId === updatedCase.linkedSessionId)) return c;
      }
      return updatedCase;
    }));
  };

  const handleAddLabCasePayment = (caseId: string, amount: number) => {
    if (currentUser?.permissions?.labProfit !== true || !Number.isFinite(amount) || amount <= 0) return;
    const receiptId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    setLabCases(prev => prev.map(c => {
      if (c.id !== caseId) return c;
      if (amount > c.labTotal - c.labPaid) return c;
      const newPaid = c.labPaid + amount;
      return {
        ...c,
        labPaid: newPaid,
        paymentsLog: [...(c.paymentsLog || []), { id: receiptId, amount, date: new Date().toLocaleDateString('en-CA'), createdAt, recordedBy: currentUser.id }]
      };
    }));
  };

  const handleLabBulkPayment = (labId: string, amount: number) => {
    if (currentUser?.permissions?.labProfit !== true) return;
    const receiptId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    setLabCases(prev => {
      let allocations: ReturnType<typeof allocateLabPayment>;
      try { allocations = allocateLabPayment(prev, labId, amount); } catch { return prev; }
      return prev.map(c => {
        const allocation = allocations.find(a => a.caseId === c.id);
        return allocation ? { ...c, labPaid: c.labPaid + allocation.amount,
          paymentsLog: [...(c.paymentsLog || []), { id: receiptId, amount: allocation.amount,
            date: new Date().toLocaleDateString('en-CA'), createdAt, recordedBy: currentUser.id, note: 'دفعة مجمعة للمعمل' }]
        } : c;
      });
    });
  };

  // Settings Actions
  const handleSaveClinicInfo = (name: string, logo: string | null) => {
    setClinicName(name);
    setClinicLogo(logo);
    Storage.saveClinicName(name);
    Storage.saveClinicLogo(logo);
  };

  const handleSaveTheme = (newTheme: ThemeSettings) => {
    setTheme(newTheme);
    Storage.saveTheme(newTheme);
  };

  const handleSaveLabels = (newLabels: UILabels) => {
    setLabels(newLabels);
    Storage.saveUILabels(newLabels);
  };

  const handleSaveTileOrder = (newOrder: string[]) => {
    setTileOrder(newOrder);
    Storage.saveTileOrder(newOrder);
  };

  const handleSaveUsers = (newUsers: User[]) => {
    setUsers(newUsers);
    Storage.saveUsers(newUsers);

    if (currentUser) {
      const match = newUsers.find(
        u => u.id === currentUser.id &&
          u.username === currentUser.username &&
          (u.credentialVersion ?? 1) === (currentUser.credentialVersion ?? 1) &&
          u.isActive !== false
      );
      if (!match) {
        handleLogout();
        showToast('تغيّرت بيانات الحساب. يرجى تسجيل الدخول مرة أخرى.', 'warning');
      } else {
        setCurrentUser(match);
        Storage.saveCurrentUser(match);
      }
    }
  };

  const handleSaveServiceTypes = (types: string[]) => {
    setServiceTypes(types);
    Storage.saveServiceTypes(types);
  };

  const handleSaveCrownPrices = (prices: Record<string, number>) => {
    setCrownPrices(prices);
    Storage.saveCrownPrices(prices);
  };

  const handleSaveExpense = (expenseData: Omit<import('./types').Expense, 'id'> & { id?: string }) => {
    if (expenseData.id) {
      setExpenses(prev => prev.map(e => e.id === expenseData.id ? mergeExpenseUpdate(e, expenseData) : e));
    } else {
      const newExp: import('./types').Expense = {
        ...expenseData,
        id: `exp_${Date.now()}`
      };
      setExpenses(prev => [newExp, ...prev]);
    }
  };

  const handleAddExpense = (expense: Omit<import('./types').Expense, 'id'>) => {
    handleSaveExpense(expense);
  };

  const handleDeleteExpense = (expenseId: string) => {
    setExpenses(prev => prev.filter(e => e.id !== expenseId));
  };

  const handleAddMaterialUsage = (usage: Omit<MaterialUsage, 'id'>) => {
    setMaterialUsages(prev => [{ ...usage, id: `usage_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` }, ...prev]);
  };

  const handleDeleteMaterialUsage = (id: string) => setMaterialUsages(prev => prev.filter(usage => usage.id !== id));

  const handleSaveWhatsappSettings = (settings: import('./types').WhatsappSettings) => {
    setWhatsappSettings(settings);
    Storage.saveWhatsappSettings(settings);
  };

  const handleSaveDrugCatalog = (catalog: import('./types').DrugCatalogItem[]) => {
    setDrugCatalog(catalog);
    Storage.saveDrugCatalog(catalog);
  };

  const handleTogglePrivacyMode = () => {
    setIsPrivacyMode(prev => {
      const next = !prev;
      Storage.savePrivacyMode(next);
      return next;
    });
  };

  const handleImportPatients = (imported: Patient[]) => {
    setPatients(prev => [...imported, ...prev]);
  };

  const handleRestoreFullData = (data: any) => {
    if (Array.isArray(data.patients)) setPatients(data.patients);
    if (Array.isArray(data.appointments)) setAppointments(data.appointments);
    if (Array.isArray(data.labs)) setLabs(data.labs);
    if (Array.isArray(data.labCases)) setLabCases(data.labCases);
    if (Array.isArray(data.expenses)) setExpenses(data.expenses);
    if (Array.isArray(data.materialUsages)) setMaterialUsages(data.materialUsages);
    else if (Array.isArray(data.expenses)) setMaterialUsages([]);
    if (Array.isArray(data.users)) setUsers(data.users);
    if (Array.isArray(data.serviceTypes)) setServiceTypes(data.serviceTypes);
    if (data.whatsappSettings) setWhatsappSettings(data.whatsappSettings);
    if (Array.isArray(data.drugCatalog)) setDrugCatalog(data.drugCatalog);
    if (typeof data.clinicName === 'string') setClinicName(data.clinicName);
    if (data.clinicLogo !== undefined) setClinicLogo(data.clinicLogo);
  };

  const handleResetAllData = () => {
    Storage.resetAll();
    window.location.reload();
  };

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

      <main className="flex-1 min-w-0 max-w-7xl 2xl:max-w-[1700px] 3xl:max-w-[2200px] w-full mx-auto px-3 sm:px-6 py-3 sm:py-6 pb-[calc(7rem+env(safe-area-inset-bottom,0px))]">
        <Suspense fallback={<ViewFallbackLoader />}>
          {activeView === 'home' && (
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
            />
          )}

          {activeView === 'patients' && (
            currentUser?.permissions?.patientView !== false ? (
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
                onBackToHome={() => handleNavigateWithSubTab('home')}
              />
            ) : (
              <PermissionDeniedCard title="قائمة وسجلات المرضى" onBackToHome={() => handleNavigateWithSubTab('home')} />
            )
          )}

          {activeView === 'patient-file' && activePatient && (
            currentUser?.permissions?.patientView !== false ? (
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
                isPrivacyMode={isPrivacyMode || !currentUser?.permissions.patientFinance}
                capabilities={{
                  patientEdit: currentUser?.permissions.patientEdit === true,
                  registerPayment: currentUser?.permissions.registerPayment ?? currentUser?.permissions.patientFinance ?? false,
                  appointments: currentUser?.permissions.appointments === true,
                  deletePatients: currentUser?.permissions.deletePatients === true,
                  rx: currentUser?.permissions.patientView === true,
                  whatsapp: currentUser?.permissions.patientView === true,
                  viewRemainingBalance: currentUser?.permissions.viewRemainingBalance ?? currentUser?.permissions.patientFinance ?? false,
                }}
                onSaveSession={handleSaveSession}
                onAddPaymentInstallment={handleAddPaymentInstallment}
                onUpdatePatient={handleSavePatient}
                onDeletePatient={handleDeletePatient}
                onSaveAppointment={handleSaveAppointment}
                onUpdateApptStatus={handleUpdateApptStatus}
                onDeleteAppointment={handleDeleteAppointment}
                onBack={() => handleNavigateWithSubTab(navigationOrigin === 'appointments' ? 'appointments' : 'patients')}
              />
            ) : (
              <PermissionDeniedCard title="ملف المريض" onBackToHome={() => handleNavigateWithSubTab('home')} />
            )
          )}

          {activeView === 'appointments' && (
            currentUser?.permissions?.appointments !== false ? (
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
            currentUser?.permissions?.lab !== false ? (
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
                onSaveCrownPrices={handleSaveCrownPrices}
                onBackToHome={() => handleNavigateWithSubTab('home')}
                canViewFinancials={currentUser?.permissions?.labProfit === true && !isPrivacyMode}
              />
            ) : (
              <PermissionDeniedCard title="متابعة حالات التركيبات" onBackToHome={() => handleNavigateWithSubTab('home')} />
            )
          )}

          {activeView === 'summary' && (
            currentUser?.permissions?.summary !== false ? (
              <SummaryView
                patients={patients}
                labCases={labCases}
                expenses={expenses}
                materialUsages={materialUsages}
                isPrivacyMode={isPrivacyMode}
                capabilities={{
                  viewExpenses: currentUser?.permissions.viewExpenses ?? currentUser?.permissions.summary ?? false,
                  viewProfits: currentUser?.permissions.viewProfits ?? currentUser?.permissions.summary ?? false,
                  financialReports: currentUser?.permissions.financialReports ?? currentUser?.permissions.summary ?? false,
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
            currentUser?.permissions?.controlPanel !== false ? (
              <SettingsView
                activeSubTab={activeSubTab}
                onSubTabChange={setActiveSubTab}
                clinicName={clinicName}
                clinicLogo={clinicLogo}
                theme={theme}
                labels={labels}
                tileOrder={tileOrder}
                users={users}
                serviceTypes={serviceTypes}
                patients={patients}
                appointments={appointments}
                labs={labs}
                labCases={labCases}
                expenses={expenses}
                materialUsages={materialUsages}
                whatsappSettings={whatsappSettings}
                drugCatalog={drugCatalog}
                onSaveClinicInfo={handleSaveClinicInfo}
                onSaveTheme={handleSaveTheme}
                onSaveLabels={handleSaveLabels}
                onSaveTileOrder={handleSaveTileOrder}
                onSaveUsers={handleSaveUsers}
                onSaveServiceTypes={handleSaveServiceTypes}
                onSaveWhatsappSettings={handleSaveWhatsappSettings}
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

          {activeView === 'secretary-desk' && (
            <SecretaryDeskView
              currentUser={currentUser}
              patients={patients}
              appointments={appointments}
              labCases={labCases}
              serviceTypes={serviceTypes}
              clinicName={clinicName}
              onSelectPatient={handleSelectPatient}
              onSavePatient={handleSavePatient}
              onSaveAppointment={handleSaveAppointment}
              onUpdateApptStatus={handleUpdateApptStatus}
              onAddPaymentInstallment={handleAddPaymentInstallment}
              onBackToHome={() => handleNavigateWithSubTab('home')}
              onNavigate={handleNavigateWithSubTab}
            />
          )}
        </Suspense>
      </main>
      <MobileBottomNav
        activeView={activeView}
        labels={labels}
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
          onUpdateUsers={handleSaveUsers}
        />
      )}

      <Suspense fallback={null}>
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
            canViewRemainingBalance={currentUser?.permissions.viewRemainingBalance ?? currentUser?.permissions.patientFinance ?? false}
            canViewHistory={currentUser?.permissions.financialReports ?? currentUser?.permissions.summary ?? false}
            onSelectPatientFile={currentUser?.permissions.patientView ? (pId) => handleSelectPatient(pId, 'home') : undefined}
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
  return (
    <ToastAndConfirmProvider>
      <AppContent />
    </ToastAndConfirmProvider>
  );
}
