import React, { lazy, Suspense, useState, useEffect, useRef } from 'react';
import { ArrowRight, Sliders, Palette, Layout, FileSpreadsheet, Users, ShieldAlert, RotateCcw, Check, Trash2, MessageCircle, Pill, Cloud, CloudUpload, CloudDownload, RefreshCw, Database, Server, CheckCircle2, ChevronLeft, ChevronDown, X } from 'lucide-react';
import { ThemeSettings, UILabels, User, Patient, ClinicContact, Appointment, Lab, LabService, LabCase, Expense, WhatsappSettings, DrugCatalogItem, MaterialUsage } from '../../types';
import { useToastAndConfirm } from '../common/ToastAndConfirm';
import type { FirebaseBackupMeta } from '../../utils/firebaseService';
import type { ContactImportInput, ContactImportSummary } from '../../utils/contactTransfer';
import type { ServiceCatalogValues } from '../../utils/serviceCatalog';
import type { ContentDraft } from '../../utils/clinicContent';
import type { ClinicIdentitySettings } from '../../utils/storage';
import { calculateDailyCollections } from '../../utils/financials';
import type { WhatsAppSendAuthorization } from '../../utils/whatsappSafety';
import { useAppointmentDialog } from '../appointments/useAppointmentDialog';
import { serializeClinicCsv } from '../../utils/csvExport';
import { retainVisitedSettingsSection } from './settingsSectionState';
import { localDateISO } from '../appointments/appointmentScheduling';
import { assertClinicBackup } from '../../utils/backupValidation';
import './settingsNavigation.css';

// Editors are loaded when first opened, not together with the settings shell.
const IdentityAppearance = lazy(() => import('./IdentityAppearance').then(module => ({ default: module.IdentityAppearance })));
const ContentLayout = lazy(() => import('./ContentLayout').then(module => ({ default: module.ContentLayout })));
const ServiceCatalogManagement = lazy(() => import('./ServiceCatalogManagement').then(module => ({ default: module.ServiceCatalogManagement })));
const DrugCatalogManagement = lazy(() => import('./DrugCatalogManagement').then(module => ({ default: module.DrugCatalogManagement })));
const UserAccountsManagement = lazy(() => import('./UserAccountsManagement').then(module => ({ default: module.UserAccountsManagement })));
const AuditTrailView = lazy(() => import('./AuditTrailView').then(module => ({ default: module.AuditTrailView })));
const WhatsAppManagement = lazy(() => import('./WhatsAppManagement').then(module => ({ default: module.WhatsAppManagement })));
const DataTransferManagement = lazy(() => import('./DataTransferManagement').then(module => ({ default: module.DataTransferManagement })));

function SettingsSectionContent({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Suspense fallback={<div role="status" aria-live="polite" className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600">جارٍ فتح {label}…</div>}>
      {children}
    </Suspense>
  );
}

const settingsSections = [
  { key: 'identity', group: 'appearance', label: 'الهوية والمظهر', description: 'اسم العيادة والشعار والألوان', icon: <Palette className="w-4 h-4 text-emerald-500" /> },
  { key: 'layout', group: 'appearance', label: 'المحتوى والترتيب', description: 'ترتيب الشريط وحجمه ونصوص الرئيسية', icon: <Layout className="w-4 h-4 text-indigo-500" /> },
  { key: 'services', group: 'practice', label: 'الخدمات والأسعار', description: 'الخدمات وأسعار البيع وتكاليف المعامل', icon: <Sliders className="w-4 h-4 text-amber-500" /> },
  { key: 'whatsapp', group: 'practice', label: 'إدارة واتساب', description: 'جهات الاتصال والرسائل والحملات', icon: <MessageCircle className="w-4 h-4 text-emerald-600" /> },
  { key: 'drugs', group: 'practice', label: 'فهرس الأدوية', description: 'فهرس الأدوية المستخدم في الروشتة', icon: <Pill className="w-4 h-4 text-purple-500" /> },
  { key: 'firebase', group: 'data', label: 'النسخ السحابي', description: 'إعدادات النسخ الاحتياطي السحابي', icon: <Cloud className="w-4 h-4 text-sky-500" /> },
  { key: 'users', group: 'people', label: 'المستخدمون والصلاحيات', description: 'حسابات العمل وصلاحيات الدخول', icon: <Users className="w-4 h-4 text-amber-600" /> },
  { key: 'audit', group: 'people', label: 'سجل النشاطات', description: 'الدخول والعمليات المسجلة', icon: <ShieldAlert className="w-4 h-4 text-rose-500" /> },
  { key: 'excel', group: 'data', label: 'التصدير والاستيراد', description: 'ملفات المرضى وجهات الاتصال والتقارير', icon: <FileSpreadsheet className="w-4 h-4 text-teal-500" /> },
  { key: 'system', group: 'data', label: 'عرض النظام والتأمين', description: 'إعدادات النظام والعمليات الحساسة', icon: <Server className="w-4 h-4 text-purple-600" /> },
] as const;
type SettingsSectionKey = typeof settingsSections[number]['key'];
const isSettingsSection = (value: string | undefined): value is SettingsSectionKey => settingsSections.some(section => section.key === value);
const settingsSectionGroups = [
  { key: 'appearance', label: 'مظهر العيادة' },
  { key: 'practice', label: 'الخدمات والتواصل' },
  { key: 'people', label: 'الفريق والخصوصية' },
  { key: 'data', label: 'البيانات والنظام' },
] as const;

function SettingsSectionPicker({ activeSection, onSelect, onClose }: {
  activeSection: SettingsSectionKey;
  onSelect: (section: SettingsSectionKey) => void;
  onClose: () => void;
}) {
  const dialogRef = useAppointmentDialog(true, onClose);
  return (
    <div className="clinic-modal-overlay settings-picker-overlay" dir="rtl" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialogRef} id="settings-section-picker" role="dialog" aria-modal="true" aria-labelledby="settings-picker-title" tabIndex={-1} className="clinic-modal-panel clinic-modal-panel--framed settings-picker-dialog">
        <div className="settings-picker-header">
          <div><h2 id="settings-picker-title">أقسام الإعدادات</h2><p>اختَر القسم الذي تريد تعديله.</p></div>
          <button type="button" onClick={onClose} aria-label="إغلاق أقسام الإعدادات" className="settings-picker-close"><X aria-hidden="true" /></button>
        </div>
        <div className="settings-picker-groups">
          {settingsSectionGroups.map(group => (
            <section key={group.key} aria-label={group.label} className="settings-picker-group">
              <h3>{group.label}</h3>
              <div className="settings-picker-options">
                {settingsSections.filter(section => section.group === group.key).map(section => {
                  const isActive = section.key === activeSection;
                  return <button key={section.key} type="button" className="settings-picker-option" aria-current={isActive ? 'page' : undefined}
                    data-dialog-autofocus={isActive ? true : undefined} onClick={() => onSelect(section.key)}>
                    <span className="settings-picker-icon" aria-hidden="true">{section.icon}</span>
                    <span className="settings-picker-label"><strong>{section.label}</strong><small>{section.description}</small></span>
                    {isActive ? <Check aria-hidden="true" className="settings-picker-indicator" /> : <ChevronLeft aria-hidden="true" className="settings-picker-indicator" />}
                  </button>;
                })}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

interface SettingsViewProps {
  activeSubTab?: string;
  onSubTabChange?: (subTab: string) => void;
  clinicName: string;
  clinicLogo: string | null;
  theme: ThemeSettings;
  labels: UILabels;
  tileOrder: string[];
  users: User[];
  currentUser: User | null;
  serviceTypes: string[];
  crownPrices: Record<string, number>;
  canManagePrices: boolean;
  canViewLabCosts: boolean;
  canManageLabPrices: boolean;
  initialPricingLabId?: string;
  patients: Patient[];
  contacts: ClinicContact[];
  canViewPatients?: boolean;
  canManageContacts?: boolean;
  canImportPatients?: boolean;
  onAuthorizePatientImport: () => void;
  onAuthorizeWhatsappSend?: (request: WhatsAppSendAuthorization) => void;
  initialWhatsAppSection?: 'templates' | 'campaigns';
  appointments: Appointment[];
  labs: Lab[];
  labCases: LabCase[];
  expenses: Expense[];
  materialUsages: MaterialUsage[];
  whatsappSettings: WhatsappSettings;
  canViewPatientFinance?: boolean;
  canExportPatientFinance?: boolean;
  canExportFinancialReports?: boolean;
  canManageFullBackup?: boolean;
  onAuthorizeDataExport: (kind: 'patients' | 'patient_finance' | 'financial_report' | 'full_backup') => void;
  onGetFullBackupSnapshot: () => Promise<unknown>;
  drugCatalog: DrugCatalogItem[];
  onSaveIdentity: (values: ClinicIdentitySettings) => void;
  onSaveContent: (values: ContentDraft) => void | Promise<void>;
  onSaveUsers: (users: User[]) => void | Promise<void>;
  onSaveServiceCatalog: (values: ServiceCatalogValues) => void;
  onSaveLabPricing: (labId: string, services: LabService[], baseline: Lab) => void | Promise<void>;
  onSaveWhatsappSettings: (settings: WhatsappSettings) => void | Promise<void>;
  onSaveContact: (contact: ClinicContact, original?: ClinicContact) => void | Promise<void>;
  onDeleteContact: (original: ClinicContact) => void | Promise<void>;
  onImportContacts: (rows: ContactImportInput[]) => Promise<ContactImportSummary>;
  onAuthorizeContactExport: () => void;
  onOpenPatient?: (patientId: string) => void;
  onSaveDrugCatalog: (catalog: DrugCatalogItem[]) => void;
  onImportPatients: (newPatients: Patient[]) => Promise<void>;
  onRestoreFullData: (data: any) => Promise<void>;
  onResetAllData: () => Promise<void>;
  onBackToHome: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  activeSubTab: externalSubTab,
  onSubTabChange,
  clinicName,
  clinicLogo,
  theme,
  labels,
  tileOrder,
  users,
  currentUser,
  serviceTypes,
  crownPrices,
  canManagePrices,
  canViewLabCosts,
  canManageLabPrices,
  initialPricingLabId,
  patients,
  contacts,
  canViewPatients = false,
  canManageContacts = false,
  canImportPatients = false,
  onAuthorizePatientImport,
  onAuthorizeWhatsappSend,
  initialWhatsAppSection = 'templates',
  appointments,
  labs,
  labCases,
  expenses,
  materialUsages,
  whatsappSettings,
  canViewPatientFinance = false,
  canExportPatientFinance = false,
  canExportFinancialReports = false,
  canManageFullBackup = false,
  onAuthorizeDataExport,
  onGetFullBackupSnapshot,
  drugCatalog,
  onSaveIdentity,
  onSaveContent,
  onSaveUsers,
  onSaveServiceCatalog,
  onSaveLabPricing,
  onSaveWhatsappSettings,
  onSaveContact,
  onDeleteContact,
  onImportContacts,
  onAuthorizeContactExport,
  onOpenPatient,
  onSaveDrugCatalog,
  onImportPatients,
  onRestoreFullData,
  onResetAllData,
  onBackToHome
}: SettingsViewProps) => {
  const { showToast, askConfirm, validationFail } = useToastAndConfirm();

  const [activeSubTab, setActiveSubTab] = useState<SettingsSectionKey>(
    isSettingsSection(externalSubTab) ? externalSubTab : 'identity'
  );
  const [visitedSections, setVisitedSections] = useState<ReadonlySet<SettingsSectionKey>>(() => new Set([
    isSettingsSection(externalSubTab) ? externalSubTab : 'identity'
  ]));
  const selectedSettingsContent = useRef<HTMLDivElement>(null);
  const mobileSettingsAnchor = useRef<HTMLDivElement>(null);
  const mobileSettingsToolbar = useRef<HTMLDivElement>(null);
  const [isSettingsPickerOpen, setIsSettingsPickerOpen] = useState(false);
  const [settingsToolbarLayout, setSettingsToolbarLayout] = useState({ pinned: false, left: 0, width: 0, height: 0 });
  const activeSettingsSection = settingsSections.find(section => section.key === activeSubTab)!;

  useEffect(() => {
    if (externalSubTab) {
      const section = isSettingsSection(externalSubTab) ? externalSubTab : 'identity';
      setActiveSubTab(section);
      setVisitedSections(previous => retainVisitedSettingsSection(previous, section));
    }
  }, [externalSubTab]);

  useEffect(() => {
    // App's overflow container prevents a regular sticky child from following
    // the viewport. Pin only this local section control, keeping its space.
    let frame: number | undefined;
    const measure = () => {
      frame = undefined;
      const anchor = mobileSettingsAnchor.current;
      const toolbar = mobileSettingsToolbar.current;
      if (!anchor || !toolbar) return;
      const isMobile = window.matchMedia('(max-width: 1023px)').matches;
      const bounds = anchor.getBoundingClientRect();
      const next = { pinned: isMobile && bounds.top < 12, left: bounds.left, width: bounds.width, height: toolbar.getBoundingClientRect().height };
      setSettingsToolbarLayout(previous => previous.pinned === next.pinned && Math.abs(previous.left - next.left) < 0.5
        && Math.abs(previous.width - next.width) < 0.5 && Math.abs(previous.height - next.height) < 0.5 ? previous : next);
      if (!isMobile) setIsSettingsPickerOpen(false);
    };
    const schedule = () => { if (frame === undefined) frame = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(schedule);
    if (mobileSettingsAnchor.current) observer.observe(mobileSettingsAnchor.current);
    if (mobileSettingsToolbar.current) observer.observe(mobileSettingsToolbar.current);
    window.addEventListener('scroll', schedule, { passive: true, capture: true });
    window.addEventListener('resize', schedule);
    measure();
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
    };
  }, []);

  const handleSelectSubTab = (tab: SettingsSectionKey) => {
    setVisitedSections(previous => retainVisitedSettingsSection(previous, tab));
    setActiveSubTab(tab);
    setIsSettingsPickerOpen(false);
    if (onSubTabChange) {
      onSubTabChange(tab);
    }
    requestAnimationFrame(() => {
      if (!window.matchMedia('(max-width: 1023px)').matches) return;
      const content = selectedSettingsContent.current;
      if (!content) return;
      const toolbarHeight = mobileSettingsToolbar.current?.getBoundingClientRect().height || 0;
      window.scrollTo({ top: Math.max(0, content.getBoundingClientRect().top + window.scrollY - toolbarHeight - 28),
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      content.focus({ preventScroll: true });
    });
  };


  // Helper for downloading CSV with UTF-8 BOM for Arabic compatibility
  const downloadCSV = async (filename: string, headers: string[], rows: (string | number)[][]) => {
    const csvContent = serializeClinicCsv(headers, rows);

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const { downloadTransferBlob } = await import('../../utils/patientSpreadsheets');
    downloadTransferBlob(blob, filename, () => onAuthorizeDataExport('financial_report'));
  };

  // CSV Export Handlers

  const handleExportFinancialReportCSV = async () => {
    try {
    if (!canExportFinancialReports) throw new Error('التقرير المالي غير متاح لهذا الحساب أو في وضع الخصوصية.');
    onAuthorizeDataExport('financial_report');
    const headers = ['تاريخ الخدمة / الدفعة', 'نوع السجل', 'رقم الملف', 'اسم المريض', 'الخدمة / الملاحظة', 'المطلوب بعد الخصم (ج.م)', 'إجمالي المدفوع (ج.م)', 'طريقة الدفع'];
    const sessionsByPatient = new Map(patients.map(patient => [patient.id, new Map(patient.sessions.map(session => [session.id, session]))]));
    const rows: (string | number)[][] = calculateDailyCollections(patients, () => true).rows.map(row => {
      const session = sessionsByPatient.get(row.patientId)?.get(row.sessionId);
      return [row.date, session ? 'تحصيل على خدمة' : 'دفعة عامة', `'${row.fileNo}`, row.patientName, row.proceduresText,
        session ? Math.max(0, row.totalValue - row.discountAmount) : 0, row.paidAmount, 'نقدي'];
    });

    // Chronological order descending
    rows.sort((a, b) => String(b[0]).localeCompare(String(a[0])));

    await downloadCSV(`تقرير_المالية_والتحصيلات_${localDateISO()}.csv`, headers, rows);
    showToast('تم تصدير التقرير المالي الشامل بصيغة CSV بنجاح', 'success');
    } catch (error) { showToast(error instanceof Error ? error.message : 'تعذّر تصدير التقرير المالي.', 'error'); }
  };


  // Firebase Cloud Backup State & Handlers
  const [cloudBackups, setCloudBackups] = useState<FirebaseBackupMeta[]>([]);
  const [isUploadingCloud, setIsUploadingCloud] = useState(false);
  const [isFetchingCloud, setIsFetchingCloud] = useState(false);
  const [cloudStatus, setCloudStatus] = useState<'idle' | 'verified' | 'error'>('idle');

  useEffect(() => {
    if (activeSubTab === 'firebase') {
      loadCloudBackups();
    }
  }, [activeSubTab]);

  const loadCloudBackups = async () => {
    if (!canManageFullBackup) { setCloudBackups([]); setCloudStatus('error'); return; }
    setIsFetchingCloud(true);
    try {
      onAuthorizeDataExport('full_backup');
      const { fetchFirebaseBackups } = await import('../../utils/firebaseService');
      onAuthorizeDataExport('full_backup');
      const list = await fetchFirebaseBackups();
      onAuthorizeDataExport('full_backup');
      setCloudBackups(list);
      setCloudStatus('verified');
    } catch (err) {
      console.error('Error fetching firebase backups:', err);
      setCloudStatus('error');
    } finally {
      setIsFetchingCloud(false);
    }
  };

  const handleUploadCloudBackup = async () => {
    setIsUploadingCloud(true);
    try {
      if (!canManageFullBackup) throw new Error('النسخ الكامل يحتاج صلاحيات الإدارة والبيانات المالية وخروجًا من وضع الخصوصية.');
      onAuthorizeDataExport('full_backup');
      const fullData = assertClinicBackup({
        patients,
        contacts,
        appointments,
        labs,
        labCases,
        expenses,
        materialUsages,
        users,
        serviceTypes,
        crownPrices,
        whatsappSettings,
        drugCatalog,
        clinicName,
        clinicLogo,
        theme,
        labels,
        tileOrder
      });

      const { saveBackupToFirebase } = await import('../../utils/firebaseService');
      onAuthorizeDataExport('full_backup');
      const meta = await saveBackupToFirebase(fullData, clinicName);
      showToast(`تم رفع النسخة الاحتياطية بنجاح إلى Firebase (${meta.timestamp})`, 'success');
      await loadCloudBackups();
    } catch (err) {
      console.error('Upload backup error:', err);
      showToast('تعذّر رفع النسخة. راجع المصادقة وقواعد المشروع وحجم النسخة والاتصال؛ لم يتم تأكيد حفظها على Firebase.', 'error');
    } finally {
      setIsUploadingCloud(false);
    }
  };

  const handleRestoreCloudBackup = async (backupId: string, timestamp: string) => {
    if (!canManageFullBackup) return showToast('استعادة النسخة الكاملة غير متاحة لهذا الحساب أو في وضع الخصوصية.', 'warning');
    askConfirm({
      title: 'استعادة نسخة احتياطية من السحابة',
      message: `هل أنت متأكد من استعادة النسخة الاحتياطية المؤرخة (${timestamp})؟ سيتم استبدال البيانات الحالية بالبيانات السحابية المحفوظة.`,
      confirmLabel: 'استعادة الآن',
      tone: 'warning',
      onConfirm: async () => {
        try {
          onAuthorizeDataExport('full_backup');
          const { fetchSingleFirebaseBackup } = await import('../../utils/firebaseService');
          onAuthorizeDataExport('full_backup');
          const fullData = await fetchSingleFirebaseBackup(backupId);
          if (fullData) {
            onAuthorizeDataExport('full_backup');
            await onRestoreFullData(fullData);
            showToast('تم استعادة كافة بيانات العيادة بنجاح من Firebase!', 'success');
          } else {
            showToast('تعذر جلب بيانات النسخة الاحتياطية من السحابة', 'error');
          }
        } catch (err) {
          console.error('Restore error:', err);
          showToast('حدث خطأ أثناء استعادة النسخة', 'error');
        }
      }
    });
  };

  const handleDeleteCloudBackup = async (backupId: string) => {
    if (!canManageFullBackup) return showToast('إدارة النسخ الكاملة غير متاحة لهذا الحساب أو في وضع الخصوصية.', 'warning');
    askConfirm({
      title: 'حذف النسخة السحابية',
      message: 'هل أنت متأكد من حذف هذه النسخة الاحتياطية من قاعدة بيانات Firebase؟',
      confirmLabel: 'حذف',
      tone: 'danger',
      onConfirm: async () => {
        try {
          onAuthorizeDataExport('full_backup');
          const { removeFirebaseBackup } = await import('../../utils/firebaseService');
          onAuthorizeDataExport('full_backup');
          await removeFirebaseBackup(backupId);
          setCloudBackups(prev => prev.filter(b => b.id !== backupId));
          showToast('تم حذف النسخة الاحتياطية من السحابة', 'info');
        } catch (err) {
          console.error('Delete backup error:', err);
          showToast('تعذر حذف النسخة السحابية', 'error');
        }
      }
    });
  };

  return (
    <div className="settings-view space-y-6 max-w-7xl mx-auto py-2 min-w-0">
      {/* View Header */}
      <div className="flex items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <div className="flex items-center gap-3">
          <button
            type="button" aria-label="العودة للشاشة الرئيسية"
            onClick={onBackToHome}
            className="min-h-[44px] min-w-[44px] p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer"
            title="رجوع للشاشة الرئيسية"
          >
            <ArrowRight className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-slate-900 font-tajawal tracking-tight">
              لوحة التحكم والإعدادات
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              إعدادات العيادة، الخدمات، التواصل وصلاحيات الفريق
            </p>
          </div>
        </div>
      </div>

      <div ref={mobileSettingsAnchor} className="settings-mobile-nav-anchor" style={settingsToolbarLayout.pinned ? { height: settingsToolbarLayout.height } : undefined}>
        <div ref={mobileSettingsToolbar} className={`settings-mobile-nav${settingsToolbarLayout.pinned ? ' is-pinned' : ''}`}
          style={settingsToolbarLayout.pinned ? { left: settingsToolbarLayout.left, width: settingsToolbarLayout.width } : undefined}>
          <span aria-hidden="true" className="settings-mobile-nav-icon">{activeSettingsSection.icon}</span>
          <div className="settings-mobile-nav-title"><small>القسم الحالي</small><strong aria-live="polite">{activeSettingsSection.label}</strong></div>
          <button type="button" className="settings-mobile-nav-change" aria-haspopup="dialog" aria-expanded={isSettingsPickerOpen}
            aria-controls="settings-section-picker" onClick={() => setIsSettingsPickerOpen(true)}>
            تغيير القسم <ChevronDown aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Modern 2-Column Settings Layout (Internal Sidebar + Active Panel) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* Internal Settings Sidebar Column */}
        <div className="settings-desktop-nav hidden lg:block lg:col-span-3 space-y-3">
          <div className="bg-white rounded-3xl p-3 border border-slate-200/90 shadow-xs space-y-2 lg:sticky lg:top-20">
            <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700 font-tajawal flex items-center gap-1.5">
                <Sliders className="w-4 h-4 text-indigo-600" />
                أقسام لوحة التحكم
              </span>
              <span className="text-[10px] bg-indigo-50 text-indigo-700 px-2.5 py-0.5 rounded-full font-extrabold">
                10 أقسام
              </span>
            </div>

            <div className="space-y-1">
              {settingsSections.map(st => {
                const isActive = activeSubTab === st.key;
                return (
                  <button
                    key={st.key}
                    type="button"
                    onClick={() => handleSelectSubTab(st.key)}
                    aria-current={isActive ? 'page' : undefined}
                    className={`w-full flex items-center justify-between p-2.5 sm:p-3 rounded-2xl text-right transition-all cursor-pointer font-tajawal group ${
                      isActive
                        ? 'bg-indigo-600 text-white shadow-md ring-1 ring-indigo-500/30 font-bold'
                        : 'text-slate-700 hover:bg-slate-100/90 hover:text-slate-900'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className={`p-2 rounded-xl transition-colors shrink-0 ${
                        isActive ? 'bg-white/15 text-white' : 'bg-slate-100 group-hover:bg-white text-slate-600'
                      }`}>
                        {st.icon}
                      </div>
                      <div className="min-w-0">
                        <div className={`text-xs sm:text-sm font-bold truncate ${isActive ? 'text-white' : 'text-slate-800'}`}>
                          {st.label}
                        </div>
                        <div className={`text-[10px] truncate ${isActive ? 'text-emerald-200' : 'text-slate-500'}`}>
                          {st.description}
                        </div>
                      </div>
                    </div>

                    <ChevronLeft className={`w-4 h-4 shrink-0 transition-all ${
                      isActive ? 'text-white translate-x-[-2px]' : 'text-slate-400 opacity-0 group-hover:opacity-100'
                    }`} />
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Selected Settings Content Panel Column */}
        <div ref={selectedSettingsContent} role="region" aria-label={`إعدادات ${activeSettingsSection.label}`} tabIndex={-1} className="settings-content-panel lg:col-span-9 min-w-0">
        {/* Mount draft editors on first visit, then retain them across navigation. */}
        {visitedSections.has('identity') && <div hidden={activeSubTab !== 'identity'}>
          <SettingsSectionContent label="الهوية والمظهر">
            <IdentityAppearance
              clinicName={clinicName}
              clinicLogo={clinicLogo}
              theme={theme}
              onSaveIdentity={onSaveIdentity}
            />
          </SettingsSectionContent>
        </div>}
        {visitedSections.has('layout') && <div hidden={activeSubTab !== 'layout'}>
          <SettingsSectionContent label="المحتوى والترتيب">
            <ContentLayout labels={labels} tileOrder={tileOrder} clinicName={clinicName} onSaveContent={onSaveContent} />
          </SettingsSectionContent>
        </div>}
        {visitedSections.has('services') && <div hidden={activeSubTab !== 'services'}>
          <SettingsSectionContent label="الخدمات والأسعار">
            <ServiceCatalogManagement serviceTypes={serviceTypes} crownPrices={crownPrices} canManagePrices={canManagePrices} onSaveServiceCatalog={onSaveServiceCatalog}
              labs={labs} canViewLabCosts={canViewLabCosts} canManageLabPrices={canManageLabPrices} onSaveLabPricing={onSaveLabPricing} initialPricingLabId={initialPricingLabId} />
          </SettingsSectionContent>
        </div>}
        {visitedSections.has('drugs') && <div hidden={activeSubTab !== 'drugs'}>
          <SettingsSectionContent label="فهرس الأدوية">
            <DrugCatalogManagement drugCatalog={drugCatalog} onSaveDrugCatalog={onSaveDrugCatalog} />
          </SettingsSectionContent>
        </div>}
        {visitedSections.has('users') && <div hidden={activeSubTab !== 'users'}>
          <SettingsSectionContent label="المستخدمون والصلاحيات">
            <UserAccountsManagement users={users} currentUser={currentUser} onSaveUsers={onSaveUsers} />
          </SettingsSectionContent>
        </div>}
        <div key={activeSubTab} className="settings-section-enter">

        {/* WhatsApp Integration SubTab */}
        {activeSubTab === 'whatsapp' && !canViewPatients && <p role="status" className="p-5 text-sm text-slate-600">جهات الاتصال والرسائل تشمل أسماء وأرقام المرضى. يلزم تفعيل صلاحية عرض المرضى مع الوصول للوحة التحكم.</p>}
        {activeSubTab === "whatsapp" && canViewPatients && (
          <SettingsSectionContent label="إدارة واتساب">
            <WhatsAppManagement clinicName={clinicName} whatsappSettings={whatsappSettings}
              patients={patients} contacts={contacts} appointments={appointments} canViewPatientFinance={canViewPatientFinance}
              onSaveContact={onSaveContact} onDeleteContact={onDeleteContact} onOpenPatient={onOpenPatient}
              onAuthorizeSend={onAuthorizeWhatsappSend}
              canManageContacts={canManageContacts} initialSection={initialWhatsAppSection}
              onSaveWhatsappSettings={onSaveWhatsappSettings} />
          </SettingsSectionContent>
        )}

        {/* Firebase Cloud Backup SubTab */}
        {activeSubTab === 'firebase' && !canManageFullBackup && <div role="status" className="bg-slate-50 border rounded-2xl p-5 text-sm text-slate-600">النسخة الكاملة تشمل بيانات العيادة والحسابات المالية والمستخدمين. يلزم الوصول الإداري والمالي المناسب والخروج من وضع الخصوصية.</div>}
        {activeSubTab === 'firebase' && canManageFullBackup && (
          <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xs space-y-6">
            <section aria-labelledby="cloud-readiness-title" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 space-y-2 text-sm text-amber-950">
              <h3 id="cloud-readiness-title" className="font-bold">نسخ احتياطي يدوي، وليس مزامنة بين الأجهزة</h3>
              <p className="leading-relaxed">التشغيل الحالي محلي. يلزم إكمال Firebase Authentication وصلاحيات قاعدة البيانات قبل الاعتماد على النسخ السحابي أو نقل بيانات مرضى حقيقية. لا تفتح قواعد المشروع للجميع لتجاوز خطأ الاتصال.</p>
              <p className="leading-relaxed">للنسخة المحلية الكاملة افتح «التصدير والاستيراد». رفع الواجهة إلى Firebase Hosting وحده لا ينقل ملفات المرضى أو يفعّل المزامنة.</p>
            </section>
            {/* Connection Status Banner */}
            <div className="p-4 bg-gradient-to-r from-indigo-900 to-slate-900 text-white rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-md">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-white/10 rounded-xl backdrop-blur-xs">
                  <Cloud className="w-7 h-7 text-sky-400" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold text-sm font-tajawal">النسخ الاحتياطية على Firebase</span>
                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${cloudStatus === 'verified' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' : 'bg-white/10 text-slate-200 border-white/20'}`}>
                      {isFetchingCloud ? 'جارٍ التحقق' : cloudStatus === 'verified' ? 'قائمة النسخ متاحة' : cloudStatus === 'error' ? 'تعذر التحقق' : 'لم يتم التحقق'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 mt-1">
                    مشروع الفايربيس: <span className="font-mono text-sky-300">zippy-dispatcher-m1ttq</span> | قاعدة البيانات: Firestore Database
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleUploadCloudBackup}
                disabled={isUploadingCloud}
                className="px-6 py-3 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-600 hover:to-indigo-700 text-white text-xs font-bold shadow-lg flex items-center justify-center gap-2 cursor-pointer transition-all disabled:opacity-50 shrink-0"
              >
                {isUploadingCloud ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    جاري رفع النسخة إلى Firebase...
                  </>
                ) : (
                  <>
                    <CloudUpload className="w-5 h-5 text-sky-200" />
                    رفع نسخة احتياطية الآن بضغطة زر ☁️
                  </>
                )}
              </button>
            </div>

            {/* Quick Stats Summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl">
                <span className="text-[11px] text-slate-500 font-medium block">عدد المرضى الحاليين</span>
                <span className="text-lg font-black text-slate-900 font-mono">{patients.length} مريض</span>
              </div>
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl">
                <span className="text-[11px] text-slate-500 font-medium block">إجمالي المواعيد</span>
                <span className="text-lg font-black text-slate-900 font-mono">{appointments.length} موعد</span>
              </div>
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl">
                <span className="text-[11px] text-slate-500 font-medium block">حالات وشغلات التركيبات</span>
                <span className="text-lg font-black text-slate-900 font-mono">{labCases.length} حالة</span>
              </div>
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl">
                <span className="text-[11px] text-slate-500 font-medium block">سجلات المصروفات</span>
                <span className="text-lg font-black text-slate-900 font-mono">{expenses.length} مصروف</span>
              </div>
            </div>

            {/* Cloud Backups List */}
            <div className="space-y-4 pt-2">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <Database className="w-5 h-5 text-indigo-600" />
                  <h3 className="text-sm font-bold text-slate-900 font-tajawal">
                    النسخ الاحتياطية المحفوظة في قاعدة بيانات Firebase Firestore
                  </h3>
                </div>

                <button
                  type="button"
                  onClick={loadCloudBackups}
                  disabled={isFetchingCloud}
                  className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold cursor-pointer flex items-center gap-1.5 transition-colors"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isFetchingCloud ? 'animate-spin' : ''}`} />
                  تحديث القائمة
                </button>
              </div>

              {isFetchingCloud ? (
                <div className="p-8 text-center text-slate-500 text-xs flex items-center justify-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-indigo-600" />
                  جاري جلب النسخ الاحتياطية من السحابة...
                </div>
              ) : cloudStatus === 'error' ? (
                <div role="alert" className="p-5 bg-amber-50 rounded-2xl border border-amber-200 text-sm text-amber-900">تعذر تحميل قائمة النسخ. راجع الاتصال وإعدادات المصادقة وقواعد المشروع؛ لا يمكن تأكيد وجود نسخ أو غيابها الآن.</div>
              ) : cloudBackups.length === 0 ? (
                <div className="p-8 bg-slate-50 rounded-2xl border border-dashed border-slate-300 text-center space-y-2">
                  <Server className="w-8 h-8 text-slate-400 mx-auto" />
                  <p className="text-xs font-bold text-slate-700">لا توجد نسخ احتياطية سحابية محفوظة بعد</p>
                  <p className="text-[11px] text-slate-500">توفر القائمة لا يثبت وجود مزامنة أو اكتمال حماية المشروع. احتفظ بنسخة محلية كاملة، ولا تعتمد النسخ السحابي قبل إعداد المصادقة والقواعد واختبار الاسترجاع.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {cloudBackups.map(bk => (
                    <div key={bk.id} className="p-4 bg-slate-50 hover:bg-slate-100/80 rounded-2xl border border-slate-200 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                          <span className="font-extrabold text-slate-900 text-sm font-mono">{bk.timestamp}</span>
                          <span className="px-2 py-0.5 rounded-md bg-sky-100 text-sky-800 text-[10px] font-bold">
                            {bk.clinicName}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-[11px] text-slate-500 font-medium">
                          <span>👤 {bk.patientCount} مريض</span>
                          <span>•</span>
                          <span>📅 {bk.appointmentCount} موعد</span>
                          <span>•</span>
                          <span>🧪 {bk.labCaseCount} معمل</span>
                          <span>•</span>
                          <span>💸 {bk.expenseCount} مصروف</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleRestoreCloudBackup(bk.id, bk.timestamp)}
                          className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold cursor-pointer flex items-center gap-1.5 shadow-2xs"
                        >
                          <CloudDownload className="w-4 h-4" />
                          استعادة هذه النسخة
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDeleteCloudBackup(bk.id)}
                          className="p-2 text-rose-600 hover:bg-rose-100 rounded-xl cursor-pointer transition-colors"
                          title="حذف النسخة من السحابة"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Audit Log SubTab */}
        {activeSubTab === 'audit' && (
          <SettingsSectionContent label="سجل النشاطات">
            <AuditTrailView />
          </SettingsSectionContent>
        )}

        {/* Patient/contact transfers are grouped here, never in the directory. */}
        {activeSubTab === 'excel' && (
          <SettingsSectionContent label="التصدير والاستيراد">
            <DataTransferManagement
              key={`${currentUser?.id || 'none'}:${currentUser?.credentialVersion ?? 1}`}
              patients={patients} contacts={contacts} canViewPatients={canViewPatients}
              canImportPatients={canImportPatients} canManageContacts={canManageContacts}
              canExportPatientFinance={canExportPatientFinance} canExportFinancialReports={canExportFinancialReports}
              onImportPatients={onImportPatients} onAuthorizePatientImport={onAuthorizePatientImport}
              onImportContacts={onImportContacts} onAuthorizeContactExport={onAuthorizeContactExport}
              onAuthorizeDataExport={onAuthorizeDataExport} onExportFinancialReport={handleExportFinancialReportCSV}
              canManageFullBackup={canManageFullBackup} onGetFullBackupSnapshot={onGetFullBackupSnapshot} onRestoreFullData={onRestoreFullData}
            />
          </SettingsSectionContent>
        )}

        {/* 6. System & Reset SubTab */}
        {activeSubTab === 'system' && !canManageFullBackup && <p role="status" className="p-5 border rounded-2xl text-sm text-slate-600">إعادة ضبط العيادة غير متاحة لهذا الحساب أو في وضع الخصوصية.</p>}
        {activeSubTab === 'system' && canManageFullBackup && (
          <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xs space-y-6">
            <h3 className="text-base font-bold text-rose-800 font-tajawal flex items-center gap-2">
              <RotateCcw className="w-5 h-5 text-rose-600" />
              منطقة العمليات الحساسة وإعادة ضبط النظام
            </h3>

            <p className="text-xs text-slate-600 leading-relaxed">
              تنبيه: زر إعادة الضبط يسترجع جميع البيانات الافتراضية للعيادة ويمسح أي تغييرات محلية تم إجراؤها.
            </p>

            <button
              type="button"
              onClick={() => {
                askConfirm({
                  title: 'إعادة ضبط النظام بالكامل',
                  message: 'هل أنت متأكد من مسح جميع البيانات المحلية واستعادة الضبط الافتراضي؟',
                  confirmLabel: 'مسح وإعادة الضبط',
                  tone: 'danger',
                  onConfirm: async () => {
                    onAuthorizeDataExport('full_backup');
                    await onResetAllData();
                    showToast('تم إعادة ضبط البيانات للافتراضي', 'warning');
                  }
                });
              }}
              className="px-6 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-xs cursor-pointer transition-colors"
            >
              إعادة ضبط البيانات للافتراضي
            </button>
          </div>
        )}
        </div>
        </div>
      </div>

      {isSettingsPickerOpen && <SettingsSectionPicker activeSection={activeSubTab} onSelect={handleSelectSubTab} onClose={() => setIsSettingsPickerOpen(false)} />}

    </div>
  );
};
