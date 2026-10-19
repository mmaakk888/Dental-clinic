import React, { lazy, Suspense, useState, useEffect, useRef } from 'react';
import { ArrowRight, Sliders, Palette, Layout, FileSpreadsheet, Users, ShieldAlert, Check, Trash2, MessageCircle, Pill, Cloud, CloudUpload, CloudDownload, RefreshCw, Database, Server, CheckCircle2, ChevronLeft, ChevronDown, X } from 'lucide-react';
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
import { canPerformAction } from '../../utils/rbac';
import { EmptyClinicCard } from './EmptyClinicCard';
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

import {OriginalSettingsLayout, settingsSections, type SettingsSectionKey} from './OriginalSettingsLayout';

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
  clinicalPrices?: Record<string, number>;
  examinationFee?: number;
  prostheticRouting?: import('../../utils/prostheticRouting').ProstheticRoutingSettings;
  onSaveProstheticRouting?: (value: import('../../utils/prostheticRouting').ProstheticRoutingSettings, baseline: import('../../utils/prostheticRouting').ProstheticRoutingSettings) => void | Promise<void>;
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
  readWhatsappSettings?: () => WhatsappSettings;
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
  onSaveServiceCatalog: (values: ServiceCatalogValues) => void | Promise<void>;
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
  onClearOperationalData: () => Promise<void>;
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
  clinicalPrices,
  examinationFee,
  prostheticRouting,
  onSaveProstheticRouting,
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
  readWhatsappSettings,
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
  canManageFullBackup: fullBackupRequested = false,
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
  onClearOperationalData,
  onBackToHome
}: SettingsViewProps) => {
  const { showToast, askConfirm, validationFail } = useToastAndConfirm();
  const canDataTransfer = canPerformAction(currentUser, 'data_import') && canPerformAction(currentUser, 'data_export');
  const canManageUsers = canPerformAction(currentUser, 'manage_users');
  const canManageFullBackup = fullBackupRequested && canDataTransfer;
  const allowedSettingsSections = settingsSections.filter(section =>
    section.key === 'users' ? canManageUsers
      : ['excel', 'firebase', 'system'].includes(section.key) ? canDataTransfer : true);
  const isAllowedSection = (value: string | undefined): value is SettingsSectionKey => allowedSettingsSections.some(section => section.key === value);

  const [activeSubTab, setActiveSubTab] = useState<SettingsSectionKey>(
    isAllowedSection(externalSubTab) ? externalSubTab : 'identity'
  );
  const [visitedSections, setVisitedSections] = useState<ReadonlySet<SettingsSectionKey>>(() => new Set([
    isAllowedSection(externalSubTab) ? externalSubTab : 'identity'
  ]));


  useEffect(() => {
    if (externalSubTab) {
      const section = isAllowedSection(externalSubTab) ? externalSubTab : 'identity';
      setActiveSubTab(section);
      setVisitedSections(previous => retainVisitedSettingsSection(previous, section));
    }
  }, [externalSubTab, canDataTransfer, canManageUsers]);

  useEffect(() => {
    if (!isAllowedSection(activeSubTab)) setActiveSubTab('identity');
  }, [activeSubTab, canDataTransfer, canManageUsers]);

  const handleSelectSubTab = (tab: SettingsSectionKey) => {
    if (!isAllowedSection(tab)) return;
    setVisitedSections(previous => retainVisitedSettingsSection(previous, tab));
    setActiveSubTab(tab); onSubTabChange?.(tab);
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
        clinicalPrices,
        examinationFee,
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

  return (<OriginalSettingsLayout activeSection={activeSubTab} sectionKeys={allowedSettingsSections.map(section => section.key)} onSection={handleSelectSubTab} onBackToHome={onBackToHome}>
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
            <ServiceCatalogManagement serviceTypes={serviceTypes} crownPrices={crownPrices} clinicalPrices={clinicalPrices} examinationFee={examinationFee} canManagePrices={canManagePrices} onSaveServiceCatalog={onSaveServiceCatalog}
              prostheticRouting={prostheticRouting} onSaveProstheticRouting={onSaveProstheticRouting}
              labs={labs} canViewLabCosts={canViewLabCosts} canManageLabPrices={canManageLabPrices} onSaveLabPricing={onSaveLabPricing} initialPricingLabId={initialPricingLabId} />
          </SettingsSectionContent>
        </div>}
        {visitedSections.has('drugs') && <div hidden={activeSubTab !== 'drugs'}>
          <SettingsSectionContent label="فهرس الأدوية">
            <DrugCatalogManagement drugCatalog={drugCatalog} onSaveDrugCatalog={onSaveDrugCatalog} />
          </SettingsSectionContent>
        </div>}
        {canManageUsers && visitedSections.has('users') && <div hidden={activeSubTab !== 'users'}>
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
              readSettings={readWhatsappSettings}
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
              <a href="/?clinic-cloud=1" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-xl border border-indigo-200 bg-white px-3 py-2 font-bold text-indigo-700">فتح مدخل التشغيل السحابي — قيد التجهيز (نافذة جديدة)</a>
              <p className="text-xs leading-relaxed">المدخل الجديد يفحص حساب Firebase وعضوية المالك فقط؛ لا ينقل هذه النسخ أو بيانات العيادة، ولا يفعّل الحفظ السحابي بعد.</p>
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
            <AuditTrailView canExport={canDataTransfer && canManageFullBackup} onAuthorizeExport={() => onAuthorizeDataExport('full_backup')} />
          </SettingsSectionContent>
        )}

        {/* Patient/contact transfers are grouped here, never in the directory. */}
        {activeSubTab === 'excel' && canDataTransfer && (
          <SettingsSectionContent label="التصدير والاستيراد">
            <DataTransferManagement
              canTransferData={canDataTransfer}
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

        {/* Never silently wipe existing browser data on an update. */}
        {activeSubTab === 'system' && (!canManageFullBackup || currentUser?.role !== 'admin' && currentUser?.role !== 'doctor') && <p role="status" className="p-5 border rounded-2xl text-sm text-slate-600">بدء عيادة فارغة متاح للطبيب أو مدير النظام بالصلاحيات الكاملة، وخارج وضع الخصوصية.</p>}
        {activeSubTab === 'system' && canManageFullBackup && (currentUser?.role === 'admin' || currentUser?.role === 'doctor') && (
          <EmptyClinicCard onAuthorize={() => onAuthorizeDataExport('full_backup')} onClear={onClearOperationalData} />
        )}
        </div>
    </OriginalSettingsLayout>
  );
};
