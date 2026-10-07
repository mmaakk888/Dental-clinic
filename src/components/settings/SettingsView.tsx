import React, { useState, useEffect, useRef } from 'react';
import { ArrowRight, Sliders, Palette, Layout, FileSpreadsheet, Users, ShieldAlert, RotateCcw, Download, Upload, Check, Trash2, Plus, MessageCircle, Pill, Save, Cloud, CloudUpload, CloudDownload, RefreshCw, Database, Server, CheckCircle2, ChevronLeft, ChevronDown, X } from 'lucide-react';
import { ThemeSettings, UILabels, User, Patient, ClinicContact, Appointment, Lab, LabService, LabCase, Expense, WhatsappSettings, DrugCatalogItem, MaterialUsage } from '../../types';
import { useToastAndConfirm } from '../common/ToastAndConfirm';
import type { FirebaseBackupMeta } from '../../utils/firebaseService';
import type { ContactImportInput, ContactImportSummary } from '../../utils/contactTransfer';
import { IdentityAppearance } from './IdentityAppearance';
import { ContentLayout } from './ContentLayout';
import { ServiceCatalogManagement } from './ServiceCatalogManagement';
import { DrugCatalogManagement } from './DrugCatalogManagement';
import { UserAccountsManagement } from './UserAccountsManagement';
import type { ServiceCatalogValues } from '../../utils/serviceCatalog';
import type { ContentDraft } from '../../utils/clinicContent';
import type { ClinicIdentitySettings } from '../../utils/storage';
import { AuditTrailView } from './AuditTrailView';
import { WhatsAppManagement } from './WhatsAppManagement';
import { calculateDailyCollections, getPatientFinancialSummary } from '../../utils/financials';
import { useAppointmentDialog } from '../appointments/useAppointmentDialog';
import { serializeClinicCsv } from '../../utils/csvExport';
import { assertClinicBackup } from '../../utils/backupValidation';
import './settingsNavigation.css';

const settingsSections = [
  { key: 'identity', group: 'appearance', label: 'الهوية والمظهر', description: 'اسم العيادة والشعار والألوان', icon: <Palette className="w-4 h-4 text-emerald-500" /> },
  { key: 'layout', group: 'appearance', label: 'المحتوى والترتيب', description: 'نصوص الرئيسية وأقسام التنقل', icon: <Layout className="w-4 h-4 text-indigo-500" /> },
  { key: 'services', group: 'practice', label: 'الخدمات والأسعار', description: 'الخدمات وأسعار البيع وتكاليف المعامل', icon: <Sliders className="w-4 h-4 text-amber-500" /> },
  { key: 'whatsapp', group: 'practice', label: 'إدارة واتساب', description: 'جهات الاتصال والرسائل والحملات', icon: <MessageCircle className="w-4 h-4 text-emerald-600" /> },
  { key: 'drugs', group: 'practice', label: 'فهرس الأدوية', description: 'فهرس الأدوية المستخدم في الروشتة', icon: <Pill className="w-4 h-4 text-purple-500" /> },
  { key: 'firebase', group: 'data', label: 'النسخ السحابي', description: 'إعدادات النسخ الاحتياطي السحابي', icon: <Cloud className="w-4 h-4 text-sky-500" /> },
  { key: 'users', group: 'people', label: 'المستخدمون والصلاحيات', description: 'حسابات العمل وصلاحيات الدخول', icon: <Users className="w-4 h-4 text-amber-600" /> },
  { key: 'audit', group: 'people', label: 'سجل النشاطات', description: 'الدخول والعمليات المسجلة', icon: <ShieldAlert className="w-4 h-4 text-rose-500" /> },
  { key: 'excel', group: 'data', label: 'تصدير واستيراد Excel', description: 'تصدير بيانات المرضى واستيرادها', icon: <FileSpreadsheet className="w-4 h-4 text-teal-500" /> },
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
  drugCatalog: DrugCatalogItem[];
  onSaveIdentity: (values: ClinicIdentitySettings) => void;
  onSaveContent: (values: ContentDraft) => void;
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
  const selectedSettingsContent = useRef<HTMLDivElement>(null);
  const mobileSettingsAnchor = useRef<HTMLDivElement>(null);
  const mobileSettingsToolbar = useRef<HTMLDivElement>(null);
  const [isSettingsPickerOpen, setIsSettingsPickerOpen] = useState(false);
  const [settingsToolbarLayout, setSettingsToolbarLayout] = useState({ pinned: false, left: 0, width: 0, height: 0 });
  const activeSettingsSection = settingsSections.find(section => section.key === activeSubTab)!;

  useEffect(() => {
    if (externalSubTab) {
      setActiveSubTab(isSettingsSection(externalSubTab) ? externalSubTab : 'identity');
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

  // Excel Export Column Checkboxes
  const excelBusyRef = useRef(false);
  const [exportCols, setExportCols] = useState({
    id: true,
    name: true,
    mobile: true,
    age: true,
    firstVisit: true,
    totalRequired: true,
    totalPaid: true,
    totalRemain: true
  });

  // Excel Export Handler
  const handleExportExcel = async () => {
    if (excelBusyRef.current) { showToast('انتظر حتى تنتهي عملية الإكسيل الحالية', 'info'); return; }
    if (!Object.values(exportCols).some(Boolean)) { showToast('اختر عمودًا واحدًا على الأقل للتصدير', 'warning'); return; }
    if (!patients.length) { showToast('لا توجد بيانات مرضى لتصديرها', 'warning'); return; }
    excelBusyRef.current = true;
    try {
      const columns = { ...exportCols, totalRequired: exportCols.totalRequired && canExportPatientFinance,
        totalPaid: exportCols.totalPaid && canExportPatientFinance, totalRemain: exportCols.totalRemain && canExportPatientFinance };
      if (!Object.values(columns).some(Boolean)) throw new Error('اختر عمودًا متاحًا واحدًا على الأقل للتصدير.');
      const containsFinance = columns.totalRequired || columns.totalPaid || columns.totalRemain;
      onAuthorizeDataExport(containsFinance ? 'patient_finance' : 'patients');
      const XLSX = await import('xlsx');
      onAuthorizeDataExport(containsFinance ? 'patient_finance' : 'patients');
      const exportData = patients.map(p => {
        const row: Record<string, string | number> = {};
        const financial = containsFinance ? getPatientFinancialSummary(p) : null;
        if (columns.id) row['رقم الملف'] = p.id;
        if (columns.name) row['اسم المريض'] = p.name;
        if (columns.mobile) row['الموبايل'] = p.mobile;
        if (columns.age) row['السن'] = p.age;
        if (columns.firstVisit) row['تاريخ الدخول'] = p.firstVisit;
        if (columns.totalRequired) row['إجمالي المطلوبات بعد الخصم'] = Math.max(0, financial!.totalRequired - financial!.totalDiscounts);
        if (columns.totalPaid) row['إجمالي المدفوع'] = financial!.totalCollected;
        if (columns.totalRemain) row['المتبقي'] = financial!.totalRemaining;
        return row;
      });
      const worksheet = XLSX.utils.json_to_sheet(exportData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'مرضى العيادة');
      onAuthorizeDataExport(containsFinance ? 'patient_finance' : 'patients');
      XLSX.writeFile(workbook, `مرضى_عيادة_الأسنان_${new Date().toISOString().split('T')[0]}.xlsx`);
      showToast('تم تجهيز ملف الإكسيل للتنزيل', 'success');
    } catch {
      showToast('تعذر تجهيز ملف الإكسيل. أعد المحاولة بعد التأكد من اتصال الموقع.', 'error');
    } finally {
      excelBusyRef.current = false;
    }
  };

  // Helper for downloading CSV with UTF-8 BOM for Arabic compatibility
  const downloadCSV = (filename: string, headers: string[], rows: (string | number)[][]) => {
    const csvContent = serializeClinicCsv(headers, rows);

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // CSV Export Handlers
  const handleExportPatientsCSV = () => {
    try {
    onAuthorizeDataExport(canExportPatientFinance ? 'patient_finance' : 'patients');
    const headers = ['رقم الملف', 'اسم المريض', 'الموبايل', 'السن', 'تاريخ الدخول', 'الحساسية والإنذارات',
      ...(canExportPatientFinance ? ['إجمالي المطلوب بعد الخصم (ج.م)', 'إجمالي المدفوع (ج.م)', 'المتبقي (ج.م)'] : [])];
    const rows = patients.map(p => {
      const financial = canExportPatientFinance ? getPatientFinancialSummary(p) : null;
      return [
        p.id,
        p.name,
        p.mobile,
        p.age,
        p.firstVisit,
        p.allergy || 'لا يوجد',
        ...(financial ? [Math.max(0, financial.totalRequired - financial.totalDiscounts), financial.totalCollected, financial.totalRemaining] : [])
      ];
    });

    downloadCSV(`نسخة_احتياطية_المرضى_${new Date().toISOString().split('T')[0]}.csv`, headers, rows);
    showToast('تم تصدير ملف بيانات المرضى بصيغة CSV بنجاح', 'success');
    } catch (error) { showToast(error instanceof Error ? error.message : 'تعذّر تصدير البيانات.', 'error'); }
  };

  const handleExportFinancialReportCSV = () => {
    try {
    if (!canExportFinancialReports) throw new Error('التقرير المالي غير متاح لهذا الحساب أو في وضع الخصوصية.');
    onAuthorizeDataExport('financial_report');
    const headers = ['تاريخ الخدمة / الدفعة', 'نوع السجل', 'رقم الملف', 'اسم المريض', 'الخدمة / الملاحظة', 'المطلوب بعد الخصم (ج.م)', 'إجمالي المدفوع (ج.م)', 'طريقة الدفع'];
    const rows: (string | number)[][] = calculateDailyCollections(patients, () => true).rows.map(row => {
      const patient = patients.find(p => p.id === row.patientId);
      const session = patient?.sessions.find(s => s.id === row.sessionId);
      return [row.date, session ? 'ملخص سداد خدمة' : 'دفعة عامة', row.fileNo, row.patientName, row.proceduresText,
        session ? Math.max(0, row.totalValue - row.discountAmount) : 0, row.paidAmount, 'نقدي'];
    });

    // Chronological order descending
    rows.sort((a, b) => String(b[0]).localeCompare(String(a[0])));

    downloadCSV(`تقرير_المالية_والتحصيلات_${new Date().toISOString().split('T')[0]}.csv`, headers, rows);
    showToast('تم تصدير التقرير المالي الشامل بصيغة CSV بنجاح', 'success');
    } catch (error) { showToast(error instanceof Error ? error.message : 'تعذّر تصدير التقرير المالي.', 'error'); }
  };

  // Excel Import Handler
  const handleImportExcelFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { showToast('ملف الإكسيل يجب ألا يتجاوز ١٠ ميجابايت. قسّم الملف الكبير قبل الاستيراد.', 'warning'); return; }
    if (excelBusyRef.current) { showToast('انتظر حتى تنتهي عملية الإكسيل الحالية', 'info'); return; }
    excelBusyRef.current = true;
    try {
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!sheet) throw new Error('empty-workbook');
      const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
      if (data.length > 50_000) throw new Error('too-many-rows');
      if (!data.length) { showToast('الملف لا يحتوي على صفوف مرضى لاستيرادها', 'warning'); return; }

      const normalizeDigits = (value: string) => value.replace(/[٠-٩۰-۹]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.includes(digit) ? '٠١٢٣٤٥٦٧٨٩'.indexOf(digit) : '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));
      const readCell = (row: Record<string, unknown>, keys: string[]) => {
        for (const key of keys) { if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') return row[key]; }
        return '';
      };
      const parseVisitDate = (value: unknown): string => {
        if (value instanceof Date && Number.isFinite(value.getTime())) {
          return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
        }
        const text = normalizeDigits(String(value ?? '').trim());
        const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
        const local = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/.exec(text);
        if (!iso && !local) return '';
        const year = Number(iso ? iso[1] : local![3]);
        const month = Number(iso ? iso[2] : local![2]);
        const day = Number(iso ? iso[3] : local![1]);
        const date = new Date(Date.UTC(year, month - 1, day));
        if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      };
      const existingIds = new Set(patients.map(p => normalizeDigits(p.id.trim())));
      const newPatientsList: Patient[] = [];
      let duplicateCount = 0;
      let invalidCount = 0;

      data.forEach(row => {
        const rawId = readCell(row, ['رقم الملف', 'FileNo', 'ID']);
        const id = normalizeDigits(String(rawId).trim());
        const rawName = readCell(row, ['اسم المريض', 'Name']);
        const name = typeof rawName === 'string' ? rawName.trim() : '';
        const rawAge = readCell(row, ['السن', 'Age']);
        const age = rawAge === '' ? 0 : typeof rawAge === 'number' || typeof rawAge === 'string' ? Number(normalizeDigits(String(rawAge))) : NaN;
        const numericIdInvalid = typeof rawId === 'number' && (!Number.isSafeInteger(rawId) || rawId <= 0);
        if (!id || id.length > 200 || !['string', 'number'].includes(typeof rawId) || numericIdInvalid || /[\r\n\t]/.test(id) || !name || name.length > 200 || !Number.isInteger(age) || age < 0 || age > 120) {
          invalidCount++;
          return;
        }
        if (existingIds.has(id)) { duplicateCount++; return; }
        existingIds.add(id);
        const rawAllergy = String(readCell(row, ['الحساسية والإنذارات', 'الحساسية', 'Allergy'])).trim();
        const gender = String(readCell(row, ['الجنس', 'Gender'])).trim().toLowerCase();
        newPatientsList.push({
          id,
          name,
          mobile: normalizeDigits(String(readCell(row, ['الموبايل', 'رقم الموبايل', 'Mobile'])).trim()),
          age,
          gender: ['female', 'أنثى'].includes(gender) ? 'female' : ['male', 'ذكر'].includes(gender) ? 'male' : undefined,
          firstVisit: parseVisitDate(readCell(row, ['تاريخ الدخول', 'FirstVisit'])),
          notes: String(readCell(row, ['ملاحظات', 'Notes'])).trim(),
          allergy: rawAllergy === 'لا يوجد' ? '' : rawAllergy,
          sessions: [],
          payments: []
        });
      });

      const ignored = duplicateCount + invalidCount;
      const detail = ignored ? `؛ تم تجاهل ${ignored} صف (${duplicateCount} مكرر و${invalidCount} بيانات غير صالحة)` : '';
      if (newPatientsList.length) {
        await onImportPatients(newPatientsList);
        showToast(`تم استيراد ${newPatientsList.length} مريض${detail}`, ignored ? 'warning' : 'success');
      } else {
        showToast(`لم تتم إضافة مرضى${detail}. راجع رقم الملف والاسم والسن.`, 'warning');
      }
    } catch {
      showToast('تعذر استيراد الملف. راجع صيغته وعناوين أعمدته ثم أعد المحاولة.', 'error');
    } finally {
      excelBusyRef.current = false;
    }
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
      showToast('تعذر رفع النسخة إلى Firebase. يرجى التأكد من الاتصال بالإنترنت.', 'error');
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
        {/* Keep the editor mounted while switching sections so drafts are not lost. */}
        <div hidden={activeSubTab !== 'identity'}>
          <IdentityAppearance
            clinicName={clinicName}
            clinicLogo={clinicLogo}
            theme={theme}
            onSaveIdentity={onSaveIdentity}
          />
        </div>
        <div hidden={activeSubTab !== 'layout'}>
          <ContentLayout labels={labels} tileOrder={tileOrder} clinicName={clinicName} onSaveContent={onSaveContent} />
        </div>
        <div hidden={activeSubTab !== 'services'}>
          <ServiceCatalogManagement serviceTypes={serviceTypes} crownPrices={crownPrices} canManagePrices={canManagePrices} onSaveServiceCatalog={onSaveServiceCatalog}
            labs={labs} canViewLabCosts={canViewLabCosts} canManageLabPrices={canManageLabPrices} onSaveLabPricing={onSaveLabPricing} initialPricingLabId={initialPricingLabId} />
        </div>
        <div hidden={activeSubTab !== 'drugs'}>
          <DrugCatalogManagement drugCatalog={drugCatalog} onSaveDrugCatalog={onSaveDrugCatalog} />
        </div>
        <div hidden={activeSubTab !== 'users'}>
          <UserAccountsManagement users={users} currentUser={currentUser} onSaveUsers={onSaveUsers} />
        </div>
        <div key={activeSubTab} className="settings-section-enter">

        {/* WhatsApp Integration SubTab */}
        {activeSubTab === 'whatsapp' && !canViewPatients && <p role="status" className="p-5 text-sm text-slate-600">جهات الاتصال والرسائل تشمل أسماء وأرقام المرضى. يلزم تفعيل صلاحية عرض المرضى مع الوصول للوحة التحكم.</p>}
        {activeSubTab === "whatsapp" && canViewPatients && (
          <WhatsAppManagement clinicName={clinicName} whatsappSettings={whatsappSettings}
            patients={patients} contacts={contacts} appointments={appointments} canViewPatientFinance={canViewPatientFinance}
            onSaveContact={onSaveContact} onDeleteContact={onDeleteContact} onOpenPatient={onOpenPatient}
            onImportContacts={onImportContacts} onAuthorizeContactExport={onAuthorizeContactExport}
            canManageContacts={canManageContacts} initialSection={initialWhatsAppSection}
            onSaveWhatsappSettings={onSaveWhatsappSettings} />
        )}

        {/* Firebase Cloud Backup SubTab */}
        {activeSubTab === 'firebase' && !canManageFullBackup && <div role="status" className="bg-slate-50 border rounded-2xl p-5 text-sm text-slate-600">النسخة الكاملة تشمل بيانات العيادة والحسابات المالية والمستخدمين. يلزم الوصول الإداري والمالي المناسب والخروج من وضع الخصوصية.</div>}
        {activeSubTab === 'firebase' && canManageFullBackup && (
          <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xs space-y-6">
            {/* Connection Status Banner */}
            <div className="p-4 bg-gradient-to-r from-indigo-900 to-slate-900 text-white rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-md">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-white/10 rounded-xl backdrop-blur-xs">
                  <Cloud className="w-7 h-7 text-sky-400" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold text-sm font-tajawal">النسخ الاحتياطية على Firebase</span>
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
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
                  <p className="text-[11px] text-slate-500">اضغط على زر "رفع نسخة احتياطية الآن" لحفظ كافة بيانات العيادة في Firebase.</p>
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
          <AuditTrailView />
        )}

        {/* 5. CSV & Excel Data Export/Import SubTab */}
        {activeSubTab === 'excel' && (
          <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xs space-y-8">
            {/* CSV Backup & External Analysis Section */}
            <div className="space-y-4">
              <h3 className="text-base font-bold text-slate-900 font-tajawal flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-indigo-600" />
                تصدير النسخ الاحتياطية والتقارير بصيغة (CSV)
              </h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                ملفات CSV مناسبة للغاية للتحليل الخارجي على برامج مثل Excel، Google Sheets أو للاحتفاظ بنسخ احتياطية سريعة.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Export Patients CSV */}
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
                  <div className="space-y-1">
                    <h4 className="text-sm font-bold text-slate-900 font-tajawal">1. تصدير بيانات المرضى (CSV)</h4>
                    <p className="text-xs text-slate-500">{canExportPatientFinance ? 'بيانات الملفات والتواصل والتواريخ، مع الملخص المالي المسموح لهذا الحساب.' : 'بيانات الملفات والتواصل والتواريخ فقط، دون حسابات أو مبالغ مالية.'}</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleExportPatientsCSV}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition-colors cursor-pointer shadow-2xs"
                  >
                    <Download className="w-4 h-4" />
                    تنزيل ملف CSV للمرضى
                  </button>
                </div>

                {/* Export Financial Report CSV */}
                {canExportFinancialReports && <div className="p-4 rounded-2xl bg-emerald-50/60 border border-emerald-200/80 space-y-3">
                  <div className="space-y-1">
                    <h4 className="text-sm font-bold text-emerald-900 font-tajawal">2. تصدير التقرير المالي والتحصيلات (CSV)</h4>
                    <p className="text-xs text-emerald-700">سجل زمني شامل لكافة الجلسات العلاجية، الدفعات، والتحصيلات المالية بالعيادة.</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleExportFinancialReportCSV}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors cursor-pointer shadow-2xs"
                  >
                    <Download className="w-4 h-4" />
                    تنزيل التقرير المالي CSV
                  </button>
                </div>}
              </div>
            </div>

            {/* Excel (.xlsx) Custom Export Section */}
            <div className="border-t border-slate-100 pt-6 space-y-4">
              <h3 className="text-base font-bold text-slate-900 font-tajawal flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
                تصدير مخصص لبيانات المرضى والحالات إلى ملف إكسيل (.xlsx)
              </h3>

              <p className="text-xs text-slate-600">حدد الأعمدة التي ترغب بضمها لملف الإكسيل:</p>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                {Object.keys(exportCols).filter(colKey => canExportPatientFinance || !['totalRequired', 'totalPaid', 'totalRemain'].includes(colKey)).map(colKey => (
                  <label key={colKey} className="flex items-center gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={(exportCols as any)[colKey]}
                      onChange={e => setExportCols({ ...exportCols, [colKey]: e.target.checked })}
                      className="w-4 h-4 text-indigo-600 rounded-md"
                    />
                    <span className="font-bold text-slate-800">
                      {colKey === 'id' ? 'رقم الملف' :
                       colKey === 'name' ? 'اسم المريض' :
                       colKey === 'mobile' ? 'الموبايل' :
                       colKey === 'age' ? 'السن' :
                       colKey === 'firstVisit' ? 'تاريخ الدخول' :
                       colKey === 'totalRequired' ? 'المطلوبات' :
                       colKey === 'totalPaid' ? 'المدفوع' : 'المتبقي'}
                    </span>
                  </label>
                ))}
              </div>

              <button
                type="button"
                onClick={handleExportExcel}
                className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs cursor-pointer transition-colors"
              >
                <Download className="w-4 h-4" />
                تنزيل ملف الإكسيل الآن (.xlsx)
              </button>
            </div>

            <div className="border-t border-slate-100 pt-6 space-y-4">
              <h3 className="text-base font-bold text-slate-900 font-tajawal flex items-center gap-2">
                <Upload className="w-5 h-5 text-indigo-600" />
                استيراد حالات جديدة من ملف إكسيل (.xlsx / .csv)
              </h3>

              <p className="text-xs text-slate-600">
                رفع ملف يحتوي أعمدة (رقم الملف، اسم المريض، الموبايل، السن، تاريخ الدخول). أي صفوف برقم ملف مكرر سيتم تجاهلها تلقائياً.
              </p>

              <label className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 text-white text-xs font-bold cursor-pointer shadow-xs hover:bg-indigo-700 transition-colors">
                <Upload className="w-4 h-4 text-white" />
                اختر ملف الإكسيل للاستيراد
                <input type="file" accept=".xlsx, .xls, .csv" onChange={handleImportExcelFile} className="hidden" />
              </label>
            </div>
          </div>
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
