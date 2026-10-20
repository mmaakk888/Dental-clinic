import React, { lazy, Suspense, useState, useEffect, useRef } from 'react';
import { ArrowRight, Sliders, Palette, Layout, FileSpreadsheet, Users, ShieldAlert, Check, Trash2, MessageCircle, Pill, Cloud, CloudUpload, CloudDownload, RefreshCw, Database, Server, CheckCircle2, ChevronLeft, ChevronDown, X } from 'lucide-react';
import { ThemeSettings, UILabels, User, Patient, ClinicContact, Appointment, Lab, LabService, LabCase, Expense, WhatsappSettings, DrugCatalogItem, MaterialUsage } from '../../types';
import { useToastAndConfirm } from '../common/ToastAndConfirm';
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
import {usePortableRuntime} from '../../portable/runtime';
import {PortableBackupPanel} from './PortableBackupPanel';
import {ScreenLoader} from '../common/ScreenLoader';

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
    <Suspense fallback={<ScreenLoader label={`جارٍ فتح ${label}…`} />}>
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
  const portable = usePortableRuntime();
  const { showToast, askConfirm, validationFail } = useToastAndConfirm();
  const canDataTransfer = canPerformAction(currentUser, 'data_import') && canPerformAction(currentUser, 'data_export');
  const canManageUsers = canPerformAction(currentUser, 'manage_users');
  const canManageFullBackup = fullBackupRequested && canDataTransfer;
  const allowedSettingsSections = settingsSections.filter(section =>
    section.key === 'users' ? canManageUsers
      : ['excel', 'backup', 'system'].includes(section.key) ? canDataTransfer : true);
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

        {activeSubTab === 'backup' && !canManageFullBackup && <div role="status" className="clinic-status-card">النسخ الاحتياطي متاح للحساب الإداري المصرّح له، خارج وضع الخصوصية.</div>}
        {activeSubTab === 'backup' && canManageFullBackup && <PortableBackupPanel onTransfer={() => handleSelectSubTab('excel')} />}

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
        {activeSubTab === 'system' && portable && <div role="status" className="rounded-2xl border bg-white p-5">البيانات محفوظة على MySQL. مسح قاعدة التشغيل من زر التخزين المحلي غير متاح؛ استخدم نسخة احتياطية وإجراء إدارة قاعدة مدروسًا. لا تُحذف سجلات مالية قائمة عند تحديث البرنامج.</div>}
        {activeSubTab === 'system' && !portable && canManageFullBackup && (currentUser?.role === 'admin' || currentUser?.role === 'doctor') && (
          <EmptyClinicCard onAuthorize={() => onAuthorizeDataExport('full_backup')} onClear={onClearOperationalData} />
        )}
        </div>
    </OriginalSettingsLayout>
  );
};
