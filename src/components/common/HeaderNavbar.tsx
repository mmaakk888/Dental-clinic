import React, { useState, useEffect, useMemo, lazy, Suspense, useCallback } from 'react';
import type { ActiveView, Patient, Appointment, LabCase, Expense, User as UserType, DeviceMode, UILabels, NavigationOrigin } from '../../types';
import { Sliders, Search, Eye, EyeOff, LogOut, Bell, ChevronDown, X, Wifi, WifiOff, AlertTriangle, Database, CloudOff, ArrowLeft } from 'lucide-react';
import { useOfflineSyncStatus } from '../../hooks/useOfflineSyncStatus';
import { useAppointmentDialog } from '../appointments/useAppointmentDialog';
import { canPerformAction, canAccessView } from '../../utils/rbac';
import { buildClinicNotifications, countUnreadNotifications, getLocalNotificationDay } from '../../utils/clinicNotifications';
import { STORAGE_FAILURE_EVENT } from '../../utils/storage';
import './HeaderNavbar.css';
import {usePortableRuntime} from '../../portable/runtime';

const GlobalSearchModal = lazy(() => import('./GlobalSearchModal').then(module => ({ default: module.GlobalSearchModal })));
const NotificationCenterModal = lazy(() => import('./NotificationCenterModal').then(module => ({ default: module.NotificationCenterModal })));
const EMPTY_RECORDS: never[] = [];
const EMPTY_READ_KEYS: ReadonlySet<string> = new Set();
type HeaderOverlay = 'account' | 'status' | 'search' | 'notifications' | null;

function HeaderDialogLoading({ onClose }: { onClose: () => void }) {
  const dialogRef = useAppointmentDialog(true, onClose);
  return <div className="clinic-modal-overlay clinic-topbar-overlay" dir="rtl">
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="فتح النافذة" tabIndex={-1}
      className="clinic-modal-panel clinic-topbar-sheet clinic-topbar-loading">
      <p role="status">جارٍ فتح النافذة…</p>
      <button type="button" onClick={onClose} className="clinic-topbar-secondary">إلغاء وإغلاق</button>
    </div>
  </div>;
}

/** Updates at local midnight and when returning to an inactive/background tab. */
function useNotificationDay() {
  const [today, setToday] = useState(getLocalNotificationDay);
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const update = () => {
      setToday(getLocalNotificationDay());
      clearTimeout(timeout);
      const now = new Date();
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      timeout = setTimeout(update, midnight.getTime() - now.getTime() + 100);
    };
    update();
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      clearTimeout(timeout);
      window.removeEventListener('focus', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  return today;
}

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
  onSelectPatient: (patientId: string, origin: NavigationOrigin) => void;
  onLogout: () => void;
}

const getRoleLabel = (role?: string) => ({ doctor: 'طبيب العيادة', secretary: 'استقبال', receptionist: 'استقبال', admin: 'مدير النظام', accountant: 'محاسب' }[role || ''] || 'مستخدم');

export const HeaderNavbar: React.FC<HeaderNavbarProps> = React.memo(({
  clinicName, patients, appointments = EMPTY_RECORDS, labCases = EMPTY_RECORDS, expenses = EMPTY_RECORDS,
  currentUser, isPrivacyMode, onTogglePrivacyMode, onNavigate, onSelectPatient, onLogout,
}) => {
  const [overlay, setOverlay] = useState<HeaderOverlay>(null);
  const [hasOpenedSearch, setHasOpenedSearch] = useState(false);
  const [hasOpenedNotifications, setHasOpenedNotifications] = useState(false);
  const [storageWarning, setStorageWarning] = useState(false);
  const accountKey = currentUser ? `${currentUser.id}:${currentUser.username}` : '';
  // Read acknowledgements stay in this account's current tab session only.
  const [readState, setReadState] = useState<{ account: string; keys: ReadonlySet<string> }>({ account: accountKey, keys: EMPTY_READ_KEYS });
  const readKeys = readState.account === accountKey ? readState.keys : EMPTY_READ_KEYS;
  const today = useNotificationDay();
  const portable=usePortableRuntime();
  const { online, queued, pending, failed } = useOfflineSyncStatus(!portable);
  const closeOverlay = useCallback(() => setOverlay(null), []);
  const sheetRef = useAppointmentDialog(overlay === 'account' || overlay === 'status', closeOverlay);

  useEffect(() => {
    setOverlay(null);
    setReadState({ account: accountKey, keys: EMPTY_READ_KEYS });
  }, [accountKey]);
  useEffect(() => {
    const onFailure = () => setStorageWarning(true);
    window.addEventListener(STORAGE_FAILURE_EVENT, onFailure);
    return () => window.removeEventListener(STORAGE_FAILURE_EVENT, onFailure);
  }, []);
  useEffect(() => {
    if (overlay === 'search') setHasOpenedSearch(true);
    if (overlay === 'notifications') setHasOpenedNotifications(true);
  }, [overlay]);
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.repeat || event.key.toLowerCase() !== 'k') return;
      // Do not open a competing header overlay over an unrelated editing dialog.
      if (!overlay && document.querySelector('[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"], dialog[open]')) return;
      event.preventDefault();
      setOverlay(previous => previous === 'search' ? null : 'search');
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [overlay]);

  const canPatientView = canPerformAction(currentUser, 'view_patients');
  const canPatientFinance = canPatientView && canPerformAction(currentUser, 'view_patient_finance')
    && canPerformAction(currentUser, 'view_remaining_balance') && !isPrivacyMode;
  const visiblePatients = canPatientView ? patients : EMPTY_RECORDS;
  const visibleAppointments = canAccessView(currentUser, 'appointments') ? appointments : EMPTY_RECORDS;
  const visibleLabCases = canAccessView(currentUser, 'lab') ? labCases : EMPTY_RECORDS;
  const visibleExpenses = canAccessView(currentUser, 'summary') && canPerformAction(currentUser, 'view_expenses') && !isPrivacyMode ? expenses : EMPTY_RECORDS;
  const canSettings = canAccessView(currentUser, 'settings');
  const canBackup = canSettings && canPerformAction(currentUser, 'backup_restore');
  const notifications = useMemo(() => buildClinicNotifications({
    patients: canPatientFinance ? visiblePatients : EMPTY_RECORDS, appointments: visibleAppointments, labCases: visibleLabCases, today,
  }), [canPatientFinance, visiblePatients, visibleAppointments, visibleLabCases, today]);
  const unreadCount = countUnreadNotifications(notifications, readKeys);
  const markRead = useCallback((keys: string[]) => {
    setReadState(previous => ({ account: accountKey, keys: new Set([
      ...(previous.account === accountKey ? previous.keys : EMPTY_READ_KEYS), ...keys,
    ]) }));
  }, [accountKey]);
  const navigateFromSheet = (view: ActiveView, subTab?: string) => {
    closeOverlay();
    onNavigate(view, subTab);
  };

  return <>
    <header className="clinic-topbar" dir="rtl" aria-label="الحساب وأدوات العيادة">
      <div className="clinic-topbar-inner">
        <button type="button" className="clinic-topbar-account" onClick={() => setOverlay('account')}
          aria-label={`قائمة الحساب: ${currentUser?.name || 'حساب العيادة'}`} aria-expanded={overlay === 'account'}
          aria-haspopup="dialog" aria-controls="clinic-account-dialog">
          <span className="clinic-topbar-avatar" aria-hidden="true">{currentUser?.name?.charAt(0) || 'ع'}</span>
          <span className="clinic-topbar-account-text">
            <span className="clinic-topbar-name">{currentUser?.name || clinicName || 'عيادة الأسنان'}</span>
            <span className="clinic-topbar-meta">{getRoleLabel(currentUser?.role)}<span aria-hidden="true"> · </span>{clinicName || 'عيادة الأسنان'}</span>
          </span>
          <ChevronDown className="clinic-topbar-chevron" aria-hidden="true" />
        </button>

        <div className="clinic-topbar-tools" role="group" aria-label="الأدوات السريعة">
          <button type="button" className="clinic-topbar-tool" onClick={() => setOverlay('search')}
            aria-label="البحث الشامل" title="البحث بالاسم أو رقم الملف أو الهاتف (Ctrl+K)"
            aria-haspopup="dialog" aria-expanded={overlay === 'search'} aria-keyshortcuts="Control+k Meta+k">
            <Search aria-hidden="true" /><span className="clinic-topbar-tool-label">بحث</span>
          </button>
          <button type="button" className={`clinic-topbar-tool ${isPrivacyMode ? 'clinic-topbar-tool--privacy' : ''}`}
            onClick={onTogglePrivacyMode} aria-pressed={isPrivacyMode}
            aria-label={isPrivacyMode ? 'إظهار المبالغ المالية' : 'إخفاء المبالغ المالية'}
            title={isPrivacyMode ? 'المبالغ مخفية — اضغط لإظهارها' : 'إخفاء المبالغ المالية'}>
            {isPrivacyMode ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
            <span className="clinic-topbar-tool-label">{isPrivacyMode ? 'المبالغ مخفية' : 'إخفاء المبالغ'}</span>
          </button>
          <button type="button" className={`clinic-topbar-tool clinic-topbar-status ${storageWarning ? 'clinic-topbar-tool--warning' : ''}`}
            onClick={() => setOverlay('status')} aria-label={portable ? 'حالة الموقع: خادم العيادة، عرض التفاصيل' : storageWarning ? 'حالة الموقع: ظهر خطأ حفظ، راجع التفاصيل' : 'حالة الموقع: تخزين محلي، عرض التفاصيل'}
            title={portable?'حفظ PHP وMySQL — تفاصيل الاتصال والنسخ الاحتياطي':'تخزين محلي في هذا المتصفح — تفاصيل الشبكة والنسخ الاحتياطي'}
            aria-haspopup="dialog" aria-expanded={overlay === 'status'} aria-controls="clinic-status-dialog">
            {storageWarning ? <AlertTriangle aria-hidden="true" /> : <Database aria-hidden="true" />}
            <span className="clinic-topbar-tool-label">{portable?(portable.pending()?'راجع الحفظ':'خادم العيادة'):storageWarning ? 'راجع الحفظ' : 'محلي'}</span>
            <span aria-hidden="true" className={`clinic-topbar-network-dot ${online ? 'is-online' : ''}`} />
          </button>
          <button type="button" className="clinic-topbar-tool clinic-topbar-bell" onClick={() => setOverlay('notifications')}
            aria-label={unreadCount ? `التنبيهات والإشعارات (${unreadCount} غير مقروء)` : 'التنبيهات والإشعارات — لا جديد'}
            title="التنبيهات والإشعارات" aria-haspopup="dialog" aria-expanded={overlay === 'notifications'} aria-controls="clinic-notifications-dialog">
            <Bell aria-hidden="true" />
            {unreadCount > 0 && <span aria-hidden="true" className="clinic-topbar-count">{unreadCount > 99 ? '99+' : unreadCount}</span>}
          </button>
        </div>
      </div>
    </header>

    {(overlay === 'account' || overlay === 'status') && <div className="clinic-modal-overlay clinic-topbar-overlay" dir="rtl"
      onClick={event => { if (event.target === event.currentTarget) closeOverlay(); }}>
      <section ref={sheetRef} id={overlay === 'account' ? 'clinic-account-dialog' : 'clinic-status-dialog'}
        role="dialog" aria-modal="true" aria-labelledby="clinic-topbar-dialog-title" tabIndex={-1}
        className="clinic-modal-panel clinic-modal-panel--framed clinic-topbar-sheet">
        <div className="clinic-topbar-sheet-heading">
          <div><p className="clinic-topbar-eyebrow">{overlay === 'account' ? 'جلسة العمل' : 'على هذا الجهاز'}</p>
            <h2 id="clinic-topbar-dialog-title">{overlay === 'account' ? 'الحساب والخيارات' : 'حالة الموقع والبيانات'}</h2></div>
          <button type="button" className="clinic-topbar-close" onClick={closeOverlay} aria-label="إغلاق النافذة"><X aria-hidden="true" /></button>
        </div>
        <div className="clinic-topbar-sheet-body overflow-y-auto">
          {overlay === 'account' ? <>
            <div className="clinic-topbar-profile-card">
              <span className="clinic-topbar-avatar" aria-hidden="true">{currentUser?.name?.charAt(0) || 'ع'}</span>
              <div><h3>{currentUser?.name || 'حساب العيادة'}</h3><p dir="ltr">@{currentUser?.username}</p>
                <span>{getRoleLabel(currentUser?.role)} · {clinicName || 'عيادة الأسنان'}</span></div>
            </div>
            <button type="button" className="clinic-topbar-menu-action" onClick={() => setOverlay('search')}><Search aria-hidden="true" /><span>البحث الشامل<small>اسم المريض، رقم الملف، أو الموبايل</small></span><ArrowLeft aria-hidden="true" /></button>
            {canSettings && <button type="button" className="clinic-topbar-menu-action" onClick={() => navigateFromSheet('settings')}><Sliders aria-hidden="true" /><span>إعدادات العيادة<small>الهوية والخدمات والحسابات والبيانات</small></span><ArrowLeft aria-hidden="true" /></button>}
            <p className="clinic-topbar-note">التنقل بين الأقسام متاح من الشريط السفلي. إخفاء المبالغ لا يحوّل الصفحة إلى شاشة مريض مستقلة.</p>
            <button type="button" className="clinic-topbar-logout" onClick={() => { closeOverlay(); onLogout(); }}><LogOut aria-hidden="true" />تسجيل الخروج من الحساب</button>
          </> : portable ? <>
            <div className="clinic-topbar-local-notice"><Database aria-hidden="true"/><div><h3>حفظ مشترك على MySQL</h3><p>التعديلات تُحفظ على خادم العيادة بعد تأكيده، ولا تُحفظ ملفات المرضى في المتصفح كبديل. تُحدّث البيانات كل دقيقة أثناء فتح الصفحة، وليست مزامنة لحظية أو عملًا دون إنترنت.</p></div></div>
            <p role="status">{portable.pending()?'توجد محاولة تحتاج تأكيدًا أو إلغاءً من الخادم.':'لا توجد محاولة حفظ معلقة في هذه الصفحة.'}</p>
            <button type="button" className="clinic-topbar-primary" onClick={()=>void portable.refresh().then(closeOverlay).catch(()=>{})}>تحديث بيانات الخادم الآن</button>
            {canBackup&&<button type="button" className="clinic-topbar-secondary" onClick={()=>navigateFromSheet('settings','excel')}>النسخ الاحتياطي والتصدير</button>}
          </> : <>
            <div className="clinic-topbar-local-notice"><Database aria-hidden="true" /><div><h3>النسخة تعمل بتخزين محلي</h3><p>السجلات موجودة في متصفح هذا الجهاز، وليست قاعدة مشتركة بين الأجهزة. هذه الحالة ليست تأكيدًا لنجاح آخر حفظ أو وجود نسخة احتياطية.</p></div></div>
            {storageWarning && <p role="alert" className="clinic-topbar-save-warning">ظهر خطأ حفظ خلال هذه الجلسة. راجع رسالة الخطأ وأعد المحاولة قبل إغلاق المسودة؛ لا تعتبر التعديل محفوظًا.</p>}
            <dl className="clinic-topbar-status-list">
              <div><dt>{online ? <Wifi aria-hidden="true" /> : <WifiOff aria-hidden="true" />}شبكة المتصفح</dt><dd>{online ? 'المتصفح يبلغ بتوفر شبكة' : 'المتصفح يبلغ بعدم الاتصال'}</dd></div>
              <div><dt><CloudOff aria-hidden="true" />المزامنة بين الأجهزة</dt><dd>غير مفعّلة</dd></div>
              <div><dt>الرفع السحابي</dt><dd>لا يوجد رفع مشترك مؤكّد</dd></div>
              {queued > 0 && <div><dt>طابور محلي قديم</dt><dd>{queued.toLocaleString('ar-EG')} عملية — لم تُرفع</dd></div>}
              {pending > 0 && <div><dt>بانتظار الربط</dt><dd>{pending.toLocaleString('ar-EG')} عملية</dd></div>}
              {failed > 0 && <div><dt>بعلامة فشل في الطابور</dt><dd>{failed.toLocaleString('ar-EG')} عملية</dd></div>}
            </dl>
            <p className="clinic-topbar-note">مؤشر الشبكة لا يختبر الوصول إلى الإنترنت أو Firebase. احتفظ بنسخة احتياطية مؤكدة قبل تغيير الجهاز أو حذف بيانات المتصفح.</p>
            {canBackup && <button type="button" className="clinic-topbar-primary" onClick={() => navigateFromSheet('settings', 'excel')}><Sliders aria-hidden="true" />النسخة الاحتياطية والتصدير</button>}
          </>}
        </div>
        <div className="clinic-topbar-sheet-footer"><button type="button" className="clinic-topbar-secondary" onClick={closeOverlay}>إغلاق والعودة</button></div>
      </section>
    </div>}

    <Suspense fallback={overlay === 'search' ? <HeaderDialogLoading onClose={closeOverlay} /> : null}>
      {(overlay === 'search' || hasOpenedSearch) && <GlobalSearchModal key={accountKey} isOpen={overlay === 'search'} onClose={closeOverlay}
        patients={visiblePatients} appointments={visibleAppointments} labCases={visibleLabCases} expenses={visibleExpenses}
        showFinancials={canPatientFinance} showLabCosts={canPerformAction(currentUser, 'view_lab_costs') && !isPrivacyMode}
        onSelectPatient={onSelectPatient} onNavigate={onNavigate} />}
    </Suspense>
    <Suspense fallback={overlay === 'notifications' ? <HeaderDialogLoading onClose={closeOverlay} /> : null}>
      {(overlay === 'notifications' || hasOpenedNotifications) && <NotificationCenterModal key={accountKey} isOpen={overlay === 'notifications'} onClose={closeOverlay}
        notifications={notifications} readKeys={readKeys} onMarkRead={markRead} onSelectPatient={onSelectPatient} onNavigate={onNavigate} />}
    </Suspense>
  </>;
});

HeaderNavbar.displayName = 'HeaderNavbar';
