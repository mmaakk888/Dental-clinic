import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ActiveView, Patient, Appointment, LabCase, Expense, User as UserType, DeviceMode, UILabels } from '../../types';
import { 
  Home, Users, Calendar, Microscope, Landmark, Sliders, Search, Command, 
  Eye, EyeOff, LogOut, Stethoscope, Bell, ChevronDown, CheckCircle2, ArrowRight, X, Shield,
  Wifi, WifiOff, RefreshCw, AlertTriangle, Database, Cloud
} from 'lucide-react';
import { GlobalSearchModal } from './GlobalSearchModal';
import { NotificationCenterModal } from './NotificationCenterModal';
import { OfflineSyncEngine, PendingMutation } from '../../utils/offlineSync';
import { getPatientFinancialSummary } from '../../utils/financials';

interface HeaderNavbarProps {
  activeView: ActiveView;
  activeSubTab?: string;
  labels: UILabels;
  clinicName: string;
  clinicLogo: string | null;
  patients: Patient[];
  appointments?: Appointment[];
  labCases?: LabCase[];
  expenses?: Expense[];
  currentUser: UserType | null;
  isPrivacyMode: boolean;
  deviceMode?: DeviceMode;
  isDetectedMobile?: boolean;
  isDetectedTv?: boolean;
  isSidebarCollapsed?: boolean;
  onOpenMobileMenu?: () => void;
  onChangeDeviceMode?: (mode: DeviceMode) => void;
  onTogglePrivacyMode: () => void;
  onNavigate: (view: ActiveView, subTab?: string) => void;
  onSelectPatient: (patientId: string, origin: any) => void;
  onLogout: () => void;
}

export const HeaderNavbar: React.FC<HeaderNavbarProps> = React.memo(({
  activeView,
  labels,
  clinicName,
  clinicLogo,
  patients,
  appointments = [],
  labCases = [],
  expenses = [],
  currentUser,
  isPrivacyMode,
  isDetectedMobile = false,
  onTogglePrivacyMode,
  onNavigate,
  onSelectPatient,
  onLogout
}) => {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
  
  // Offline & Sync states
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [queue, setQueue] = useState<PendingMutation[]>(() => OfflineSyncEngine.getQueue());
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [lastSyncTime, setLastSyncTime] = useState<number>(() => OfflineSyncEngine.getLastSyncTime());
  const profileRef = useRef<HTMLDivElement>(null);

  // Monitor network status & queue updates
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      triggerSync();
    };
    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const interval = setInterval(() => {
      setQueue(OfflineSyncEngine.getQueue());
      setLastSyncTime(OfflineSyncEngine.getLastSyncTime());
    }, 2000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, []);

  const triggerSync = async () => {
    if (!navigator.onLine) return;
    setIsSyncing(true);
    await OfflineSyncEngine.processQueue();
    setIsSyncing(false);
    setQueue(OfflineSyncEngine.getQueue());
    setLastSyncTime(OfflineSyncEngine.getLastSyncTime());
  };

  const canPatientView = currentUser?.permissions?.patientView !== false;
  const canPatientFinance = canPatientView && currentUser?.permissions?.patientFinance !== false && (currentUser?.permissions?.viewRemainingBalance ?? currentUser?.permissions?.patientFinance) !== false && !isPrivacyMode;
  const visiblePatients = canPatientView ? patients : [];
  const visibleAppointments = currentUser?.permissions?.appointments !== false ? appointments : [];
  const visibleLabCases = currentUser?.permissions?.lab !== false ? labCases : [];
  const visibleExpenses = currentUser?.permissions?.summary !== false && currentUser?.permissions?.viewExpenses !== false && !isPrivacyMode ? expenses : [];

  // Notifications calculation
  const { todayApptsCount, overduePatientsCount, pendingLabCount, totalNotifCount } = useMemo(() => {
    const now = new Date();
    const todayStr = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const appts = visibleAppointments.filter(a => a.date === todayStr).length;
    const overdue = canPatientFinance ? visiblePatients.filter(p => getPatientFinancialSummary(p).totalRemaining > 500).length : 0;
    const pendingLabs = visibleLabCases.filter(l => l.status === 'pending').length;
    return {
      todayApptsCount: appts,
      overduePatientsCount: overdue,
      pendingLabCount: pendingLabs,
      totalNotifCount: appts + overdue + pendingLabs
    };
  }, [appointments, patients, labCases, currentUser, isPrivacyMode]);

  // Shortcut Ctrl+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsSearchOpen(prev => !prev);
      }
      if (e.key === 'Escape') {
        setIsSearchOpen(false);
        setIsProfileMenuOpen(false);
        setIsSyncModalOpen(false);
        setIsNotifOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Close profile menu on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setIsProfileMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Format sync relative time
  const getRelativeSyncTime = (timestamp: number) => {
    const diffSec = Math.floor((Date.now() - timestamp) / 1000);
    if (diffSec < 10) return 'الآن';
    if (diffSec < 60) return `منذ ${diffSec} ثانية`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `منذ ${diffMin} دقيقة`;
    const diffHours = Math.floor(diffMin / 60);
    return `منذ ${diffHours} ساعة`;
  };

  // Role translation
  const getRoleLabel = (role?: string) => {
    switch (role) {
      case 'doctor':
        return 'طبيب العيادة';
      case 'secretary':
      case 'receptionist':
        return 'استقبال';
      case 'admin':
        return 'مدير النظام';
      case 'accountant':
        return 'محاسب';
      default:
        return 'مستخدم';
    }
  };

  // Navigation Items

  const failedCount = queue.filter(q => q.status === 'failed').length;
  const pendingCount = queue.filter(q => q.status === 'pending' || q.status === 'syncing').length;

  return (
    <>
      <header className="bg-white border-b border-slate-200 font-['Cairo',sans-serif] w-full shadow-2xs">
        <div className="clinic-header-inner max-w-[1800px] mx-auto px-3 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-2 sm:gap-4">
          
          {/* RTL Right Side: Brand/Back & Clickable Account Area Trigger */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {/* Functional Back to Home button when in sub-views */}
            {activeView !== 'home' && (
              <button
                type="button"
                onClick={() => onNavigate('home')}
                className="h-10 px-2.5 sm:px-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black transition-all cursor-pointer shadow-xs flex items-center justify-center gap-1.5 active:scale-95 touch-manipulation shrink-0 z-20 min-h-[44px]"
                title="العودة للشاشة الرئيسية"
              >
                <ArrowRight className="w-4 h-4 shrink-0" />
                <span className="font-tajawal hidden sm:inline">{labels.tabs.home || 'الرئيسية'}</span>
              </button>
            )}

            {/* CLICKABLE ACCOUNT AREA (Circular Avatar + Doctor Name + Clinic Name) */}
            {currentUser ? (
              <button
                type="button"
                onClick={() => setIsProfileMenuOpen(true)}
                className="clinic-account-trigger flex items-center gap-2 sm:gap-2.5 p-1 sm:p-1.5 px-2 sm:px-3 rounded-2xl bg-slate-50 hover:bg-indigo-50/60 active:bg-indigo-100/60 border border-slate-200/90 transition-all cursor-pointer shadow-2xs active:scale-98 min-h-[44px] group shrink-0"
                title="قائمة الحساب والخيارات"
              >
                {/* Circular User Avatar */}
                <div className="clinic-account-avatar w-8.5 h-8.5 sm:w-10 sm:h-10 rounded-full bg-gradient-to-tr from-indigo-600 to-indigo-700 text-white font-black text-xs sm:text-sm flex items-center justify-center border-2 border-indigo-200/90 shadow-2xs shrink-0 font-mono">
                  {currentUser.name ? currentUser.name.charAt(0).toUpperCase() : 'د'}
                </div>

                {/* Account Details: Doctor Name & Clinic/Role Name */}
                <div className="flex flex-col text-right min-w-0">
                  <span className="clinic-account-name text-xs sm:text-sm font-black text-slate-900 truncate font-tajawal max-w-[95px] sm:max-w-[170px] leading-tight">
                    {currentUser.name}
                  </span>
                  <span className="clinic-account-meta text-[10px] sm:text-[11px] font-bold text-slate-500 truncate font-tajawal max-w-[95px] sm:max-w-[170px] leading-tight flex items-center gap-1">
                    <span className="text-indigo-700 font-extrabold">{getRoleLabel(currentUser.role)}</span>
                    <span className="text-slate-300">•</span>
                    <span>{clinicName || 'عيادة الأسنان'}</span>
                  </span>
                </div>

                <ChevronDown className="w-4 h-4 text-slate-400 group-hover:text-indigo-600 transition-transform duration-200 shrink-0" />
              </button>
            ) : (
              <div 
                onClick={() => onNavigate('home')}
                className="flex items-center gap-2 bg-slate-50 hover:bg-slate-100 p-1 px-2.5 rounded-xl border border-slate-200 transition-all cursor-pointer active:scale-95 touch-manipulation shrink-0 min-h-[44px]"
              >
                {clinicLogo ? (
                  <img
                    src={clinicLogo}
                    alt="Logo"
                    referrerPolicy="no-referrer"
                    className="w-7 h-7 rounded-lg object-contain shrink-0"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  />
                ) : (
                  <div className="w-7 h-7 rounded-lg bg-indigo-600 text-white flex items-center justify-center shadow-2xs shrink-0">
                    <Stethoscope className="w-4 h-4 text-indigo-100" />
                  </div>
                )}
                <span className="text-xs sm:text-sm font-black text-slate-900 truncate font-tajawal max-w-[120px] sm:max-w-none">
                  {clinicName || 'عيادة الأسنان'}
                </span>
              </div>
            )}
          </div>

          {/* RTL Left Side Actions: Privacy Toggle, Connection Status & Notification Bell */}
          <div className="clinic-header-tools flex items-center gap-1.5 sm:gap-2 shrink-0">
            
            {/* Patient-facing privacy toggle for mirrored clinic displays */}
            <button
              type="button"
              onClick={onTogglePrivacyMode}
              className={`h-11 px-2.5 sm:px-3 flex items-center justify-center gap-2 rounded-xl transition-all cursor-pointer border shrink-0 touch-manipulation active:scale-95 min-h-[44px] ${
                isPrivacyMode 
                  ? 'bg-amber-50 hover:bg-amber-100/90 text-amber-800 border-amber-300/80 shadow-2xs' 
                  : 'bg-emerald-50 hover:bg-emerald-100/90 text-emerald-800 border-emerald-300/80 shadow-2xs'
              }`}
              title={isPrivacyMode ? 'المبالغ المالية مخفية - انقر لإظهارها' : 'المبالغ المالية ظاهرة - انقر لإخفائها'}
            >
              {isPrivacyMode ? (
                <EyeOff className="w-4.5 h-4.5 text-amber-700 animate-fadeIn" />
              ) : (
                <Eye className="w-4.5 h-4.5 text-emerald-700 animate-fadeIn" />
              )}
              <span className="hidden lg:inline text-[11px] font-black">
                {isPrivacyMode ? 'المبالغ مخفية' : 'إخفاء المبالغ'}
              </span>
            </button>

            {/* PERMANENT CONNECTION STATUS INDICATOR BUTTON */}
            <button
              type="button"
              onClick={() => setIsSyncModalOpen(true)}
              className={`h-9.5 sm:h-10 px-2 sm:px-2.5 rounded-xl flex items-center gap-1.5 border font-bold text-xs transition-all cursor-pointer shrink-0 touch-manipulation active:scale-95 min-h-[44px] ${
                isSyncing
                  ? 'bg-amber-50 border-amber-300 text-amber-800'
                  : !isOnline
                  ? 'bg-sky-50 border-sky-300 text-sky-800'
                  : failedCount > 0
                  ? 'bg-rose-50 border-rose-300 text-rose-800'
                  : 'bg-emerald-50 border-emerald-300 text-emerald-800'
              }`}
              title="حالة الاتصال وحفظ البيانات"
            >
              {isSyncing ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 text-amber-700 animate-spin shrink-0" />
                  <span className="hidden sm:inline font-tajawal text-[11px]">مزامنة...</span>
                </>
              ) : !isOnline ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-sky-500 shrink-0" />
                  <WifiOff className="w-3.5 h-3.5 text-sky-700 shrink-0" />
                  <span className="hidden sm:inline font-tajawal text-[11px]">أوفلاين</span>
                </>
              ) : failedCount > 0 ? (
                <>
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-700 shrink-0" />
                  <span className="hidden sm:inline font-tajawal text-[11px]">خطأ</span>
                </>
              ) : (
                <>
                  <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                  <Wifi className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                  <span className="hidden sm:inline font-tajawal text-[11px]">متصل</span>
                </>
              )}
            </button>

            {/* Notification Bell - Touch Friendly min 44px */}
            <button
              type="button"
              onClick={() => setIsNotifOpen(true)}
              className="relative w-9.5 h-9.5 sm:w-10 sm:h-10 flex items-center justify-center rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer border border-slate-200 shrink-0 touch-manipulation active:scale-95 min-h-[44px]"
              title="التنبيهات والإشعارات"
              aria-label={totalNotifCount ? `التنبيهات والإشعارات (${totalNotifCount})` : 'التنبيهات والإشعارات'}
              aria-expanded={isNotifOpen}
              aria-controls="clinic-notifications-dialog"
            >
              <Bell className="w-4.5 h-4.5 text-slate-700" />
              {totalNotifCount > 0 && (
                <span aria-hidden="true" className="clinic-notification-count absolute -top-1 -right-1 w-4.5 h-4.5 bg-rose-600 text-white rounded-full text-[10px] font-black flex items-center justify-center border border-white">
                  {totalNotifCount > 9 ? '9+' : totalNotifCount}
                </span>
              )}
            </button>

          </div>
        </div>

      </header>

      {/* MODERN ACCOUNT MENU BOTTOM SHEET */}
      {isProfileMenuOpen && currentUser && (
        <>
          {/* Backdrop Overlay */}
          <div 
            className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 animate-fadeIn transition-opacity cursor-pointer"
            onClick={() => setIsProfileMenuOpen(false)}
          />

          {/* Bottom Sheet Card */}
          <div 
            className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-3xl shadow-2xl border-t border-slate-200/90 p-4 sm:p-5 max-w-lg mx-auto animate-slideUp font-cairo dir-rtl max-h-[88vh] overflow-y-auto pb-[max(1.25rem,env(safe-area-inset-bottom))]"
            ref={profileRef}
          >
            {/* Sheet Handle & Header */}
            <div className="relative mb-3.5">
              <div className="w-12 h-1 bg-slate-200 rounded-full mx-auto" />
              <div className="flex items-center justify-between mt-2 pt-1">
                <span className="text-xs font-black text-slate-400 uppercase tracking-wider font-tajawal">
                  قائمة الحساب والخيارات
                </span>
                <button
                  type="button"
                  onClick={() => setIsProfileMenuOpen(false)}
                  className="w-8.5 h-8.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center transition-all active:scale-95 shrink-0 min-h-[44px] sm:min-h-0 cursor-pointer"
                  title="إغلاق"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* GROUP 1: User Profile & Doctor Details */}
            <div className="p-3.5 bg-gradient-to-r from-slate-50 via-indigo-50/40 to-slate-50 rounded-2xl border border-slate-200/80 flex items-center gap-3.5 mb-4">
              <div className="w-13 h-13 rounded-full bg-gradient-to-tr from-indigo-600 to-indigo-700 text-white font-black text-lg flex items-center justify-center border-2 border-indigo-200 shadow-sm shrink-0 font-mono">
                {currentUser.name ? currentUser.name.charAt(0).toUpperCase() : 'د'}
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-sm sm:text-base font-black text-slate-900 font-tajawal truncate">
                  {currentUser.name}
                </span>
                <span className="text-xs text-slate-500 font-mono truncate dir-ltr text-right mb-1">
                  @{currentUser.username}
                </span>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="bg-indigo-100/90 text-indigo-800 text-[10px] font-black px-2 py-0.5 rounded-md font-tajawal border border-indigo-200/70">
                    {getRoleLabel(currentUser.role)}
                  </span>
                  <span className="bg-amber-100/90 text-amber-900 text-[10px] font-black px-2 py-0.5 rounded-md font-tajawal border border-amber-200/70 truncate max-w-[140px]">
                    {clinicName || 'عيادة الأسنان'}
                  </span>
                </div>
              </div>
            </div>

            {/* GROUP 2: Clinic System Administration */}
            <div className="space-y-2 mb-4">
              <span className="text-[11px] font-black text-slate-400 uppercase tracking-wider block font-tajawal px-1">
                إدارة العيادة والنظام
              </span>
              <div className="space-y-1.5">
                {currentUser.permissions?.controlPanel && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsProfileMenuOpen(false);
                      onNavigate('settings');
                    }}
                    className="w-full p-3 bg-slate-50 hover:bg-indigo-50/70 text-slate-800 font-bold text-xs sm:text-sm rounded-2xl border border-slate-200/80 flex items-center justify-between transition-all active:scale-98 min-h-[48px] group cursor-pointer"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                        <Sliders className="w-4.5 h-4.5" />
                      </div>
                      <span className="font-tajawal">إعدادات العيادة والنظام</span>
                    </div>
                    <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-indigo-600 transition-colors rotate-180" />
                  </button>
                )}

                {activeView !== 'home' && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsProfileMenuOpen(false);
                      onNavigate('home');
                    }}
                    className="w-full p-3 bg-slate-50 hover:bg-slate-100 text-slate-800 font-bold text-xs sm:text-sm rounded-2xl border border-slate-200/80 flex items-center justify-between transition-all active:scale-98 min-h-[48px] group cursor-pointer"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-slate-200 text-slate-700 flex items-center justify-center shrink-0 group-hover:bg-slate-800 group-hover:text-white transition-colors">
                        <Home className="w-4.5 h-4.5" />
                      </div>
                      <span className="font-tajawal">العودة للشاشة الرئيسية</span>
                    </div>
                    <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-slate-700 transition-colors rotate-180" />
                  </button>
                )}
              </div>
            </div>

            {/* GROUP 3: Account Actions / Session */}
            <div className="space-y-2">
              <span className="text-[11px] font-black text-slate-400 uppercase tracking-wider block font-tajawal px-1">
                جلسة العمل
              </span>
              <button
                type="button"
                onClick={() => {
                  setIsProfileMenuOpen(false);
                  onLogout();
                }}
                className="w-full p-3 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-xs sm:text-sm rounded-2xl border border-rose-200/80 flex items-center justify-center gap-2.5 transition-all active:scale-95 min-h-[48px] shadow-2xs cursor-pointer font-tajawal"
              >
                <LogOut className="w-4.5 h-4.5 text-rose-600 shrink-0" />
                <span>تسجيل الخروج من الحساب</span>
              </button>
            </div>
          </div>
        </>
      )}

      {/* SYNC & CONNECTION DETAILS BOTTOM SHEET */}
      {isSyncModalOpen && (
        <>
          <div 
            className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 animate-fadeIn transition-opacity cursor-pointer"
            onClick={() => setIsSyncModalOpen(false)}
          />

          <div className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-3xl shadow-2xl border-t border-slate-200/90 p-4 sm:p-5 max-w-lg mx-auto animate-slideUp font-cairo dir-rtl max-h-[90vh] overflow-y-auto pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            {/* Sheet Handle & Header */}
            <div className="relative mb-3.5">
              <div className="w-12 h-1 bg-slate-200 rounded-full mx-auto" />
              <div className="flex items-center justify-between mt-2 pt-1">
                <span className="text-xs font-black text-slate-400 uppercase tracking-wider font-tajawal flex items-center gap-1.5">
                  <Database className="w-4 h-4 text-indigo-600" />
                  حالة الاتصال وقواعد البيانات (Offline First)
                </span>
                <button
                  type="button"
                  onClick={() => setIsSyncModalOpen(false)}
                  className="w-8.5 h-8.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center transition-all active:scale-95 shrink-0 min-h-[44px] sm:min-h-0 cursor-pointer"
                  title="إغلاق"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* STATUS BANNER CARD */}
            <div className={`p-3.5 rounded-2xl border mb-4 flex items-center gap-3.5 ${
              isSyncing
                ? 'bg-amber-50 border-amber-200 text-amber-900'
                : !isOnline
                ? 'bg-sky-50 border-sky-200 text-sky-900'
                : failedCount > 0
                ? 'bg-rose-50 border-rose-200 text-rose-900'
                : 'bg-emerald-50 border-emerald-200 text-emerald-900'
            }`}>
              <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                isSyncing
                  ? 'bg-amber-100 text-amber-700'
                  : !isOnline
                  ? 'bg-sky-100 text-sky-700'
                  : failedCount > 0
                  ? 'bg-rose-100 text-rose-700'
                  : 'bg-emerald-100 text-emerald-700'
              }`}>
                {isSyncing ? (
                  <RefreshCw className="w-5 h-5 animate-spin" />
                ) : !isOnline ? (
                  <WifiOff className="w-5 h-5" />
                ) : failedCount > 0 ? (
                  <AlertTriangle className="w-5 h-5 animate-bounce" />
                ) : (
                  <Wifi className="w-5 h-5" />
                )}
              </div>
              <div className="min-w-0">
                <span className="text-sm font-black block font-tajawal">
                  {isSyncing
                    ? 'جاري مزامنة السجلات المعلقة الآن...'
                    : !isOnline
                    ? 'أنتم تعملون بوضع بدون إنترنت (Offline Mode)'
                    : failedCount > 0
                    ? 'توجد عمليات تعذر رفعها تلقائياً'
                    : 'الإنترنت متاح — البيانات محفوظة على هذا الجهاز'}
                </span>
                <span className="text-[11px] opacity-90 block mt-0.5 leading-relaxed font-tajawal">
                  {!isOnline
                    ? 'يمكن متابعة العمل محليًا. احتفظ بنسخة احتياطية قبل تغيير الجهاز أو حذف بيانات المتصفح.'
                    : 'النسخ السحابي اليدوي متاح من الإعدادات بعد تفعيل الحساب؛ المزامنة المشتركة لم تُفعّل بعد.'}
                </span>
              </div>
            </div>

            {/* DETAILED METRICS GRID */}
            <div className="space-y-2 mb-4">
              <span className="text-[11px] font-black text-slate-400 uppercase tracking-wider block font-tajawal px-1">
                تفاصيل المزامنة وقواعد البيانات
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-tajawal">
                
                {/* Local DB */}
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Database className="w-4 h-4 text-indigo-600" />
                    <span className="font-bold text-slate-700">قاعدة البيانات المحلية</span>
                  </div>
                  <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 text-[10px] font-black">
                    حفظ محلي
                  </span>
                </div>

                {/* Cloud DB */}
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Cloud className="w-4 h-4 text-sky-600" />
                    <span className="font-bold text-slate-700">السحابة والخادم</span>
                  </div>
                  <span className={`px-2 py-0.5 rounded-md text-[10px] font-black ${
                    isOnline ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'
                  }`}>
                    {'الربط المشترك غير مفعّل'}
                  </span>
                </div>

                {/* Last Sync Time */}
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 flex items-center justify-between">
                  <span className="font-bold text-slate-700">آخر مزامنة ناجحة</span>
                  <span className="font-mono text-slate-900 font-bold">
                    {'لم يتم التحقق من رفع سحابي'}
                  </span>
                </div>

                {/* Pending Records Count */}
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 flex items-center justify-between">
                  <span className="font-bold text-slate-700">سجلات معلقة للمزامنة</span>
                  <span className={`font-mono font-bold px-2 py-0.5 rounded-md text-[11px] ${
                    pendingCount > 0 ? 'bg-amber-100 text-amber-800' : 'bg-slate-200 text-slate-700'
                  }`}>
                    {pendingCount} سجل
                  </span>
                </div>

                {/* Failed Records Count */}
                {failedCount > 0 && (
                  <div className="p-3 bg-rose-50 rounded-xl border border-rose-200 col-span-full flex items-center justify-between">
                    <span className="font-bold text-rose-800">سجلات تعذر رفعها (إعادة المحاولة)</span>
                    <span className="font-mono font-black text-rose-700 bg-white px-2 py-0.5 rounded border border-rose-200">
                      {failedCount}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* SYNC ACTIONS */}
            <div className="space-y-2">
              <button
                type="button"
                disabled={true}
                onClick={triggerSync}
                className={`w-full p-3.5 rounded-2xl font-bold text-xs sm:text-sm flex items-center justify-center gap-2 transition-all active:scale-98 min-h-[48px] shadow-2xs font-tajawal cursor-pointer ${
                  true
                    ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                    : 'bg-indigo-600 hover:bg-indigo-700 text-white active:scale-95'
                }`}
              >
                <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
                <span>{isSyncing ? 'جاري المزامن الآن...' : 'المزامنة المشتركة غير مفعّلة'}</span>
              </button>

              <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200/70 text-[11px] text-slate-500 text-center font-tajawal flex items-center justify-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>لنسخ البيانات احتياطيًا، افتح الإعدادات ثم النسخ الاحتياطية.</span>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Global Search Modal */}
      <GlobalSearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        patients={visiblePatients}
        appointments={visibleAppointments}
        labCases={visibleLabCases}
        expenses={visibleExpenses}
        showFinancials={canPatientFinance}
        showLabCosts={currentUser?.permissions?.labProfit === true && !isPrivacyMode}
        onSelectPatient={onSelectPatient}
        onNavigate={onNavigate}
      />

      {/* Notification Center Modal */}
      <NotificationCenterModal
        isOpen={isNotifOpen}
        onClose={() => setIsNotifOpen(false)}
        patients={canPatientFinance ? visiblePatients : []}
        appointments={visibleAppointments}
        labCases={visibleLabCases}
        onSelectPatient={onSelectPatient}
        onNavigate={onNavigate}
      />
    </>
  );
});

HeaderNavbar.displayName = 'HeaderNavbar';
