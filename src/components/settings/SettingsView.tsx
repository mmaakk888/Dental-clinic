import React, { useState, useEffect } from 'react';
import { ArrowRight, Sliders, Palette, Layout, FileSpreadsheet, Users, ShieldAlert, RotateCcw, Download, Upload, Check, Trash2, Plus, Edit3, MessageCircle, Pill, Link, Save, Cloud, CloudUpload, CloudDownload, RefreshCw, Database, Server, CheckCircle2, Type, ChevronLeft, ChevronDown } from 'lucide-react';
import { ThemeSettings, UILabels, User, UserPermission, Patient, Appointment, Lab, LabCase, Expense, WhatsappSettings, DrugCatalogItem } from '../../types';
import { useToastAndConfirm } from '../common/ToastAndConfirm';
import { saveBackupToFirebase, fetchFirebaseBackups, fetchSingleFirebaseBackup, removeFirebaseBackup, FirebaseBackupMeta } from '../../utils/firebaseService';
import { ClinicLogo } from '../common/ClinicLogo';
import { AuditTrailView } from './AuditTrailView';
import * as XLSX from 'xlsx';

interface SettingsViewProps {
  activeSubTab?: string;
  onSubTabChange?: (subTab: string) => void;
  clinicName: string;
  clinicLogo: string | null;
  theme: ThemeSettings;
  labels: UILabels;
  tileOrder: string[];
  users: User[];
  serviceTypes: string[];
  patients: Patient[];
  appointments: Appointment[];
  labs: Lab[];
  labCases: LabCase[];
  expenses: Expense[];
  whatsappSettings: WhatsappSettings;
  drugCatalog: DrugCatalogItem[];
  onSaveClinicInfo: (name: string, logo: string | null) => void;
  onSaveTheme: (theme: ThemeSettings) => void;
  onSaveLabels: (labels: UILabels) => void;
  onSaveTileOrder: (order: string[]) => void;
  onSaveUsers: (users: User[]) => void;
  onSaveServiceTypes: (types: string[]) => void;
  onSaveWhatsappSettings: (settings: WhatsappSettings) => void;
  onSaveDrugCatalog: (catalog: DrugCatalogItem[]) => void;
  onImportPatients: (newPatients: Patient[]) => void;
  onRestoreFullData: (data: any) => void;
  onResetAllData: () => void;
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
  serviceTypes,
  patients,
  appointments,
  labs,
  labCases,
  expenses,
  whatsappSettings,
  drugCatalog,
  onSaveClinicInfo,
  onSaveTheme,
  onSaveLabels,
  onSaveTileOrder,
  onSaveUsers,
  onSaveServiceTypes,
  onSaveWhatsappSettings,
  onSaveDrugCatalog,
  onImportPatients,
  onRestoreFullData,
  onResetAllData,
  onBackToHome
}) => {
  const { showToast, askConfirm, validationFail } = useToastAndConfirm();

  const [activeSubTab, setActiveSubTab] = useState<'identity' | 'layout' | 'services' | 'whatsapp' | 'drugs' | 'firebase' | 'users' | 'excel' | 'system' | 'audit'>(
    (externalSubTab as any) || 'identity'
  );

  useEffect(() => {
    if (externalSubTab) {
      setActiveSubTab(externalSubTab as any);
    }
  }, [externalSubTab]);

  const handleSelectSubTab = (tab: any) => {
    setActiveSubTab(tab);
    if (onSubTabChange) {
      onSubTabChange(tab);
    }
  };

  // WhatsApp Form State
  const [waState, setWaState] = useState<WhatsappSettings>({ ...whatsappSettings });

  // Drug Catalog Form State
  const [catalogList, setCatalogList] = useState<DrugCatalogItem[]>([...drugCatalog]);
  const [isDrugModalOpen, setIsDrugModalOpen] = useState(false);
  const [editingDrug, setEditingDrug] = useState<DrugCatalogItem | null>(null);
  const [drugName, setDrugName] = useState('');
  const [drugCategory, setDrugCategory] = useState('');
  const [drugDosage, setDrugDosage] = useState('');
  const [drugDuration, setDrugDuration] = useState('');

  // Form States
  const [tempClinicName, setTempClinicName] = useState(clinicName);
  const [tempLogo, setTempLogo] = useState<string | null>(clinicLogo);
  const [tempTheme, setTempTheme] = useState<ThemeSettings>(theme);
  const [customFontInput, setCustomFontInput] = useState('');
  const [tempLabels, setTempLabels] = useState<UILabels>(labels);
  const [tempTileOrder, setTempTileOrder] = useState<string[]>([...tileOrder]);
  const [tempServiceTypes, setTempServiceTypes] = useState<string[]>([...serviceTypes]);
  const [newServiceInput, setNewServiceInput] = useState('');

  // Excel Export Column Checkboxes
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

  // User Management Modal
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [userName, setUserName] = useState('');
  const [userUsername, setUserUsername] = useState('');
  const [userPassword, setUserPassword] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [userPhone, setUserPhone] = useState('');
  const [userRole, setUserRole] = useState<'doctor' | 'secretary' | 'admin'>('secretary');
  const [userPermissions, setUserPermissions] = useState<UserPermission>({
    patientView: true,
    patientEdit: true,
    deletePatients: false,
    patientFinance: true,
    appointments: true,
    lab: false,
    labProfit: false,
    summary: false,
    controlPanel: false
  });

  // Handle Logo Upload
  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        showToast('حجم الصورة كبير جداً، يرجى اختيار صورة أقل من 2 ميجابايت', 'error');
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setTempLogo(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const applyNamedGoogleFont = (fontName: string) => {
    if (!fontName.trim()) return;
    const cleanName = fontName.trim();
    const encodedName = cleanName.replace(/\s+/g, '+');
    const fontUrl = `https://fonts.googleapis.com/css2?family=${encodedName}:wght@300;400;500;600;700;800;900&display=swap`;
    const fontFamilyStr = `'${cleanName}', sans-serif`;

    const updatedTheme: ThemeSettings = {
      ...tempTheme,
      fontFamily: fontFamilyStr,
      customFontUrl: fontUrl
    };

    setTempTheme(updatedTheme);
    onSaveTheme(updatedTheme);

    // Inject immediately into document head
    let link = document.getElementById('dynamic-google-font') as HTMLLinkElement;
    if (!link) {
      link = document.createElement('link');
      link.id = 'dynamic-google-font';
      link.rel = 'stylesheet';
      document.head.appendChild(link);
    }
    link.href = fontUrl;

    document.body.style.fontFamily = fontFamilyStr;
    showToast(`تم تطبيق الخط العربي الجديد (${cleanName}) بنجاح`, 'success');
  };

  const handleApplyCustomGoogleFont = () => {
    if (!customFontInput.trim()) {
      showToast('يرجى كتابة اسم الخط العربي المطلوب أولاً', 'warning');
      return;
    }
    applyNamedGoogleFont(customFontInput);
  };

  const handleApplyThemeColors = (newTheme: ThemeSettings) => {
    setTempTheme(newTheme);
    onSaveTheme(newTheme);
    document.documentElement.style.setProperty('--primary', newTheme.primary);
    document.documentElement.style.setProperty('--secondary', newTheme.secondary);
    document.documentElement.style.setProperty('--accent', newTheme.accent);
    document.documentElement.style.setProperty('--bg-main', newTheme.background);
    if (newTheme.fontFamily) {
      document.body.style.fontFamily = newTheme.fontFamily;
    }
  };

  const handleSaveIdentity = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveClinicInfo(tempClinicName, tempLogo);
    onSaveTheme(tempTheme);
    showToast('تم حفظ إعدادات الهوية والمظهر بنجاح', 'success');
  };

  const handleMoveTile = (index: number, direction: 'up' | 'down') => {
    const newOrder = [...tempTileOrder];
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= newOrder.length) return;
    const temp = newOrder[index];
    newOrder[index] = newOrder[targetIdx];
    newOrder[targetIdx] = temp;
    setTempTileOrder(newOrder);
    onSaveTileOrder(newOrder);
  };

  const handleSaveLayout = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveLabels(tempLabels);
    onSaveTileOrder(tempTileOrder);
    showToast('تم حفظ ترتيب ومسميات الواجهة بنجاح', 'success');
  };

  const handleAddServiceType = () => {
    if (!newServiceInput.trim()) return;
    if (tempServiceTypes.includes(newServiceInput.trim())) {
      showToast('نوع الخدمة موجود بالفعل بالقائمة', 'warning');
      return;
    }
    const updated = [...tempServiceTypes, newServiceInput.trim()];
    setTempServiceTypes(updated);
    onSaveServiceTypes(updated);
    setNewServiceInput('');
    showToast('تم إضافة نوع الخدمة الجديد', 'success');
  };

  const handleDeleteServiceType = (st: string) => {
    const updated = tempServiceTypes.filter(s => s !== st);
    setTempServiceTypes(updated);
    onSaveServiceTypes(updated);
    showToast('تم حذف نوع الخدمة', 'warning');
  };

  // Excel Export Handler
  const handleExportExcel = () => {
    const exportData = patients.map(p => {
      const row: Record<string, any> = {};
      const req = p.sessions.reduce((a, s) => a + s.amount, 0);
      const pd = p.sessions.reduce((a, s) => a + s.paid, 0);

      if (exportCols.id) row['رقم الملف'] = p.id;
      if (exportCols.name) row['اسم المريض'] = p.name;
      if (exportCols.mobile) row['الموبايل'] = p.mobile;
      if (exportCols.age) row['السن'] = p.age;
      if (exportCols.firstVisit) row['تاريخ الدخول'] = p.firstVisit;
      if (exportCols.totalRequired) row['إجمالي المطلوبات'] = req;
      if (exportCols.totalPaid) row['إجمالي المدفوع'] = pd;
      if (exportCols.totalRemain) row['المتبقي'] = req - pd;

      return row;
    });

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'مرضى العيادة');
    XLSX.writeFile(workbook, `مرضى_عيادة_الأسنان_${new Date().toISOString().split('T')[0]}.xlsx`);
    showToast('تم تصدير ملف الإكسيل بنجاح', 'success');
  };

  // Helper for downloading CSV with UTF-8 BOM for Arabic compatibility
  const downloadCSV = (filename: string, headers: string[], rows: (string | number)[][]) => {
    const escapeCell = (val: string | number) => {
      const str = String(val ?? '');
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const csvContent = '\uFEFF' + [
      headers.map(escapeCell).join(','),
      ...rows.map(row => row.map(escapeCell).join(','))
    ].join('\r\n');

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
    const headers = ['رقم الملف', 'اسم المريض', 'رقم الموبايل', 'السن', 'تاريخ الدخول', 'الحساسية والإنذارات', 'إجمالي المطلوب (ج.م)', 'إجمالي المدفوع (ج.م)', 'المتبقي (ج.م)'];
    const rows = patients.map(p => {
      const req = p.sessions.reduce((a, s) => a + s.amount, 0);
      const pd = p.sessions.reduce((a, s) => a + s.paid, 0);
      return [
        p.id,
        p.name,
        p.mobile,
        p.age,
        p.firstVisit,
        p.allergy || 'لا يوجد',
        req,
        pd,
        req - pd
      ];
    });

    downloadCSV(`نسخة_احتياطية_المرضى_${new Date().toISOString().split('T')[0]}.csv`, headers, rows);
    showToast('تم تصدير ملف بيانات المرضى بصيغة CSV بنجاح', 'success');
  };

  const handleExportFinancialReportCSV = () => {
    const headers = ['تاريخ الحركة', 'نوع الحركة', 'رقم الملف', 'اسم المريض', 'الخدمة / الملاحظة', 'المبلغ المطلوب (ج.م)', 'المبلغ المدفوع (ج.م)', 'طريقة الدفع / تفاصيل'];
    const rows: (string | number)[][] = [];

    patients.forEach(p => {
      // Treatments / Sessions
      p.sessions.forEach(s => {
        rows.push([
          s.date,
          'جلسة علاجية',
          p.id,
          p.name,
          `${s.type}${s.toothNo ? ` (سن #${s.toothNo})` : ''}`,
          s.amount,
          s.paid,
          s.notes || '-'
        ]);
      });

      // Payments
      p.payments?.forEach(pay => {
        rows.push([
          pay.date,
          'دفعة مسددة',
          p.id,
          p.name,
          'تسديد مستحقات',
          0,
          pay.amount,
          `${pay.method || 'نقداً'} ${pay.note ? `- ${pay.note}` : ''}`
        ]);
      });
    });

    // Chronological order descending
    rows.sort((a, b) => String(b[0]).localeCompare(String(a[0])));

    downloadCSV(`تقرير_المالية_والتحصيلات_${new Date().toISOString().split('T')[0]}.csv`, headers, rows);
    showToast('تم تصدير التقرير المالي الشامل بصيغة CSV بنجاح', 'success');
  };

  // Excel Import Handler
  const handleImportExcelFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const workbook = XLSX.read(bstr, { type: 'binary' });
        const wsname = workbook.SheetNames[0];
        const ws = workbook.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json<any>(ws);

        let importedCount = 0;
        const existingIds = new Set(patients.map(p => p.id));
        const newPatientsList: Patient[] = [];

        data.forEach((row, idx) => {
          const rawId = row['رقم الملف'] || row['FileNo'] || row['ID'] || (1000 + idx).toString();
          const pId = String(rawId).trim();

          if (!existingIds.has(pId)) {
            existingIds.add(pId);
            importedCount++;
            newPatientsList.push({
              id: pId,
              name: row['اسم المريض'] || row['Name'] || 'مريض مستورد',
              mobile: String(row['الموبايل'] || row['Mobile'] || ''),
              age: parseInt(row['السن'] || row['Age'] || '30', 10),
              firstVisit: row['تاريخ الدخول'] || row['FirstVisit'] || new Date().toISOString().split('T')[0],
              notes: 'تم استيراده من ملف إكسيل',
              allergy: '',
              sessions: [],
              payments: []
            });
          }
        });

        if (importedCount > 0) {
          onImportPatients(newPatientsList);
          showToast(`تم استيراد ${importedCount} حالة جديدة بنجاح`, 'success');
        } else {
          showToast('لم يتم إضافة أية حالات جديدة (قد تكون أرقام الملفات مكررة)', 'warning');
        }
      } catch (err) {
        showToast('حدث خطأ أثناء قراءة ملف الإكسيل، يرجى التأكد من المخطط', 'error');
      }
    };
    reader.readAsBinaryString(file);
  };

  // User Save
  const handleOpenAddUser = () => {
    setEditingUser(null);
    setUserName('');
    setUserUsername('');
    setUserPassword('123');
    setUserEmail('');
    setUserPhone('');
    setUserRole('secretary');
    setUserPermissions({
      patientView: true,
      patientEdit: true,
      deletePatients: false,
      patientFinance: true,
      appointments: true,
      lab: false,
      labProfit: false,
      summary: false,
      controlPanel: false
    });
    setIsUserModalOpen(true);
  };

  const handleOpenEditUser = (user: User) => {
    setEditingUser(user);
    setUserName(user.name);
    setUserUsername(user.username || '');
    setUserPassword(user.password || '');
    setUserEmail(user.email || '');
    setUserPhone(user.phone || '');
    setUserRole(user.role);
    setUserPermissions({
      patientView: user.permissions?.patientView ?? true,
      patientEdit: user.permissions?.patientEdit ?? true,
      deletePatients: user.permissions?.deletePatients ?? false,
      patientFinance: user.permissions?.patientFinance ?? true,
      appointments: user.permissions?.appointments ?? true,
      lab: user.permissions?.lab ?? false,
      labProfit: user.permissions?.labProfit ?? false,
      summary: user.permissions?.summary ?? false,
      controlPanel: user.permissions?.controlPanel ?? false
    });
    setIsUserModalOpen(true);
  };

  const handleSaveUserForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!userName.trim()) {
      validationFail('userModal', 'input-user-name', 'يرجى كتابة الاسم الكامل للمستخدم');
      return;
    }

    if (!userUsername.trim()) {
      validationFail('userModal', 'input-user-username', 'يرجى كتابة اسم المستخدم للدخول');
      return;
    }

    const newUser: User = {
      id: editingUser ? editingUser.id : `u_${Date.now()}`,
      name: userName.trim(),
      username: userUsername.trim().toLowerCase(),
      password: userPassword.trim() || '123',
      email: userEmail.trim(),
      phone: userPhone.trim(),
      role: userRole,
      permissions: userPermissions,
      isActive: editingUser?.isActive ?? true,
      credentialVersion: editingUser
        ? (editingUser.credentialVersion ?? 1) + (editingUser.password !== (userPassword.trim() || '123') ? 1 : 0)
        : 1
    };

    let updatedUsers = [...users];
    if (editingUser) {
      updatedUsers = updatedUsers.map(u => u.id === editingUser.id ? newUser : u);
    } else {
      updatedUsers.push(newUser);
    }

    onSaveUsers(updatedUsers);
    setIsUserModalOpen(false);
    showToast('تم حفظ حساب المستخدم وصلاحياته بنجاح', 'success');
  };

  const handleDeleteUser = (uId: string) => {
    if (users.length <= 1) {
      showToast('لا يمكن حذف المستخدم الوحيد بالنظام', 'error');
      return;
    }
    const updated = users.filter(u => u.id !== uId);
    onSaveUsers(updated);
    showToast('تم حذف حساب المستخدم', 'warning');
  };

  const handleSaveWhatsappForm = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveWhatsappSettings(waState);
    showToast('تم حفظ إعدادات وأربطة الواتساب بنجاح', 'success');
  };

  const handleOpenAddDrug = () => {
    setEditingDrug(null);
    setDrugName('');
    setDrugCategory('مضاد حيوي');
    setDrugDosage('');
    setDrugDuration('');
    setIsDrugModalOpen(true);
  };

  const handleSaveDrugForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!drugName.trim()) {
      showToast('يرجى أكتب اسم الدواء', 'warning');
      return;
    }

    const newItem: DrugCatalogItem = {
      id: editingDrug ? editingDrug.id : `d_${Date.now()}`,
      name: drugName.trim(),
      category: drugCategory.trim() || 'دواء أسنان',
      defaultDosage: drugDosage.trim() || 'حسب إرشادات الطبيب',
      defaultDuration: drugDuration.trim()
    };

    let updated = [...catalogList];
    if (editingDrug) {
      updated = updated.map(d => d.id === editingDrug.id ? newItem : d);
    } else {
      updated.push(newItem);
    }

    setCatalogList(updated);
    onSaveDrugCatalog(updated);
    setIsDrugModalOpen(false);
    showToast('تم حفظ الدواء في الفهرس بنجاح', 'success');
  };

  const handleDeleteDrug = (id: string) => {
    const updated = catalogList.filter(d => d.id !== id);
    setCatalogList(updated);
    onSaveDrugCatalog(updated);
    showToast('تم حذف الدواء من الفهرس', 'info');
  };

  // Firebase Cloud Backup State & Handlers
  const [cloudBackups, setCloudBackups] = useState<FirebaseBackupMeta[]>([]);
  const [isUploadingCloud, setIsUploadingCloud] = useState(false);
  const [isFetchingCloud, setIsFetchingCloud] = useState(false);

  useEffect(() => {
    if (activeSubTab === 'firebase') {
      loadCloudBackups();
    }
  }, [activeSubTab]);

  const loadCloudBackups = async () => {
    setIsFetchingCloud(true);
    try {
      const list = await fetchFirebaseBackups();
      setCloudBackups(list);
    } catch (err) {
      console.error('Error fetching firebase backups:', err);
    } finally {
      setIsFetchingCloud(false);
    }
  };

  const handleUploadCloudBackup = async () => {
    setIsUploadingCloud(true);
    try {
      const fullData = {
        patients,
        appointments,
        labs,
        labCases,
        expenses,
        users,
        serviceTypes,
        whatsappSettings,
        drugCatalog,
        clinicName,
        clinicLogo
      };

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
    askConfirm({
      title: 'استعادة نسخة احتياطية من السحابة',
      message: `هل أنت متأكد من استعادة النسخة الاحتياطية المؤرخة (${timestamp})؟ سيتم استبدال البيانات الحالية بالبيانات السحابية المحفوظة.`,
      confirmLabel: 'استعادة الآن',
      tone: 'warning',
      onConfirm: async () => {
        try {
          const fullData = await fetchSingleFirebaseBackup(backupId);
          if (fullData) {
            onRestoreFullData(fullData);
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
    askConfirm({
      title: 'حذف النسخة السحابية',
      message: 'هل أنت متأكد من حذف هذه النسخة الاحتياطية من قاعدة بيانات Firebase؟',
      confirmLabel: 'حذف',
      tone: 'danger',
      onConfirm: async () => {
        try {
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
    <div className="space-y-6 max-w-7xl mx-auto py-2">
      {/* View Header */}
      <div className="flex items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <div className="flex items-center gap-3">
          <button
            onClick={onBackToHome}
            className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer"
            title="رجوع للشاشة الرئيسية"
          >
            <ArrowRight className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-slate-900 font-tajawal tracking-tight">
              لوحة التحكم والإعدادات
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              تخصيص الهوية، الألوان، الواتساب، الفهرس والنسخ الاحتياطي السحابي (Firebase)
            </p>
          </div>
        </div>
      </div>

      {/* Modern 2-Column Settings Layout (Internal Sidebar + Active Panel) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* Internal Settings Sidebar Column */}
        <div className="lg:col-span-3 space-y-3">
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
              {[
                { key: 'identity', label: 'الهوية والمظهر', description: 'اسم العيادة والشعار والألوان', icon: <Palette className="w-4 h-4 text-emerald-500" /> },
                { key: 'layout', label: 'المحتوى والترتيب', description: 'ترتيب واجهة الشاشة والتسميات', icon: <Layout className="w-4 h-4 text-indigo-500" /> },
                { key: 'services', label: 'الخدمات والأسعار', description: 'أنواع العلاجات وتصنيفات الحشو', icon: <Sliders className="w-4 h-4 text-amber-500" /> },
                { key: 'whatsapp', label: 'أتمتة الواتساب', description: 'رسائل التذكير والتأكيد التلقائية', icon: <MessageCircle className="w-4 h-4 text-emerald-600" /> },
                { key: 'drugs', label: 'فهرس الأدوية', description: 'دليل الوصفات والجرعات للروشتة', icon: <Pill className="w-4 h-4 text-purple-500" /> },
                { key: 'firebase', label: 'النسخ السحابي', description: 'مزامنة Firebase والنسخ الاحتياطي', icon: <Cloud className="w-4 h-4 text-sky-500" /> },
                { key: 'users', label: 'المستخدمين والصلاحيات', description: 'إدارة أطقم العمل وحسابات الدخول', icon: <Users className="w-4 h-4 text-amber-600" /> },
                { key: 'audit', label: 'سجل النشاطات', description: 'تتبع عمليات الدخول وتغيير البيانات', icon: <ShieldAlert className="w-4 h-4 text-rose-500" /> },
                { key: 'excel', label: 'تصدير واستيراد Excel', description: 'تصدير واسترجاع بيانات المرضى', icon: <FileSpreadsheet className="w-4 h-4 text-teal-500" /> },
                { key: 'system', label: 'عرض النظام والتأمين', description: 'إعادة الضبط الافتراضي واستقرار النظام', icon: <Server className="w-4 h-4 text-purple-600" /> },
              ].map(st => {
                const isActive = activeSubTab === st.key;
                return (
                  <button
                    key={st.key}
                    type="button"
                    onClick={() => handleSelectSubTab(st.key as any)}
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
        <div className="lg:col-span-9 min-w-0 animate-fadeIn">
        {/* 1. Identity & Theme SubTab */}
        {activeSubTab === 'identity' && (
          <form onSubmit={handleSaveIdentity} className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xs space-y-6">
            <h3 className="text-base font-bold text-slate-900 font-tajawal">
              شعار واسم العيادة
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  اسم العيادة العربي
                </label>
                <input
                  type="text"
                  value={tempClinicName}
                  onChange={e => setTempClinicName(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-bold focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  شعار العيادة وعرض المعاينة العالية الدقة (HD)
                </label>
                <div className="flex items-center gap-4 flex-wrap bg-slate-50 p-3 rounded-2xl border border-slate-200">
                  <ClinicLogo
                    size="lg"
                    customLogoUrl={tempLogo || '/src/assets/images/clinic_logo_hd_1784964208393.jpg'}
                  />
                  <div className="flex items-center gap-2">
                    <label className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold cursor-pointer transition-colors shadow-xs">
                      تغيير صورة الشعار
                      <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
                    </label>
                    {tempLogo && (
                      <button
                        type="button"
                        onClick={() => setTempLogo(null)}
                        className="px-3 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-xl text-xs font-bold cursor-pointer transition-colors"
                      >
                        إعادة للشعار الافتراضي
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t border-slate-100 pt-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-slate-900 font-tajawal flex items-center gap-2">
                  <Palette className="w-5 h-5 text-indigo-600" />
                  ألوان وستايل الواجهة الحية (تثبيت ستايل مخصص بضغطة زر)
                </h3>
              </div>

              {/* Theme Presets */}
              <div className="space-y-2">
                <span className="text-xs font-bold text-slate-700 block">اختر ثيم ألوان طبية جاهزة:</span>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2.5">
                  {[
                    { name: '👑 أزرق ملكي', primary: '#2563eb', secondary: '#1d4ed8', accent: '#f59e0b', background: '#f8fafc' },
                    { name: '🌿 زمردي طبي', primary: '#059669', secondary: '#047857', accent: '#10b981', background: '#f0fdf4' },
                    { name: '🔮 بنفسجي فاخر', primary: '#7c3aed', secondary: '#6d28d9', accent: '#f59e0b', background: '#faf5ff' },
                    { name: '🏛️ رمادي كلاسيكي', primary: '#334155', secondary: '#1e293b', accent: '#0284c7', background: '#f8fafc' },
                    { name: '🌸 وردي هادئ', primary: '#e11d48', secondary: '#be123c', accent: '#fb7185', background: '#fff1f2' },
                    { name: '🌊 فيروزي حديث', primary: '#0d9488', secondary: '#0f766e', accent: '#f59e0b', background: '#f0fdfa' }
                  ].map(preset => (
                    <button
                      key={preset.name}
                      type="button"
                      onClick={() => handleApplyThemeColors(preset)}
                      className="p-3 bg-slate-50 hover:bg-slate-100 rounded-2xl border border-slate-200 text-right cursor-pointer transition-all hover:scale-[1.02] flex flex-col gap-2"
                    >
                      <span className="text-xs font-bold text-slate-800 font-tajawal">{preset.name}</span>
                      <div className="flex items-center gap-1.5">
                        <span className="w-4 h-4 rounded-full shadow-2xs border border-white" style={{ backgroundColor: preset.primary }} />
                        <span className="w-4 h-4 rounded-full shadow-2xs border border-white" style={{ backgroundColor: preset.secondary }} />
                        <span className="w-4 h-4 rounded-full shadow-2xs border border-white" style={{ backgroundColor: preset.accent }} />
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-2">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">اللون الأساسي (Primary):</label>
                  <input
                    type="color"
                    value={tempTheme.primary}
                    onChange={e => handleApplyThemeColors({ ...tempTheme, primary: e.target.value })}
                    className="w-full h-10 rounded-xl cursor-pointer border border-slate-200 p-1"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">اللون الثانوي (Secondary):</label>
                  <input
                    type="color"
                    value={tempTheme.secondary}
                    onChange={e => handleApplyThemeColors({ ...tempTheme, secondary: e.target.value })}
                    className="w-full h-10 rounded-xl cursor-pointer border border-slate-200 p-1"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">لون التمييز (Accent):</label>
                  <input
                    type="color"
                    value={tempTheme.accent}
                    onChange={e => handleApplyThemeColors({ ...tempTheme, accent: e.target.value })}
                    className="w-full h-10 rounded-xl cursor-pointer border border-slate-200 p-1"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">خلفية الصفحة (Background):</label>
                  <input
                    type="color"
                    value={tempTheme.background}
                    onChange={e => handleApplyThemeColors({ ...tempTheme, background: e.target.value })}
                    className="w-full h-10 rounded-xl cursor-pointer border border-slate-200 p-1"
                  />
                </div>
              </div>
            </div>

            {/* Arabic Font Selection Section */}
            <div className="border-t border-slate-100 pt-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-slate-900 font-tajawal flex items-center gap-2">
                  <Type className="w-5 h-5 text-indigo-600" />
                  خطوط التطبيق والنصوص العربية (تغيير واختيار الخط العربي)
                </h3>
              </div>

              <div className="space-y-3">
                <span className="text-xs font-bold text-slate-700 block">اختر خطاً عربياً راقياً ومريحاً للعين:</span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { name: 'القاهرة (Cairo)', font: "'Cairo', sans-serif", desc: 'عصري وشديد الوضوح' },
                    { name: 'تجوال (Tajawal)', font: "'Tajawal', sans-serif", desc: 'ناعم ومتناسق للواجهات' },
                    { name: 'الإسكندرية (Alexandria)', font: "'Alexandria', sans-serif", desc: 'دقيق وشديد الوضوح' },
                    { name: 'آي بي إم (IBM Plex)', font: "'IBM Plex Sans Arabic', sans-serif", desc: 'رسمي واحترافي' },
                    { name: 'ريديكس برو (Readex)', font: "'Readex Pro', sans-serif", desc: 'أنيق وخفيف للموبايل' },
                    { name: 'الأميري (Amiri)', font: "'Amiri', serif", desc: 'نسخي وفخم كلاسيكي' },
                    { name: 'تشانغا (Changa)', font: "'Changa', sans-serif", desc: 'عريض وجريء' },
                    { name: 'ريم الكوفي (Reem Kufi)', font: "'Reem Kufi', sans-serif", desc: 'كوفي أصيل وجذاب' },
                  ].map(f => {
                    const isSelected = tempTheme.fontFamily === f.font || (!tempTheme.fontFamily && f.font.includes('Cairo'));
                    return (
                      <button
                        key={f.name}
                        type="button"
                        onClick={() => {
                          const updated = { ...tempTheme, fontFamily: f.font };
                          setTempTheme(updated);
                          handleApplyThemeColors(updated);
                        }}
                        style={{ fontFamily: f.font }}
                        className={`p-3.5 rounded-2xl border text-right cursor-pointer transition-all flex flex-col justify-between h-24 ${
                          isSelected
                            ? 'bg-indigo-50/90 border-indigo-600 text-indigo-950 ring-2 ring-indigo-300 shadow-2xs'
                            : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-800'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-black">{f.name}</span>
                          {isSelected && <Check className="w-4 h-4 text-indigo-600 shrink-0" />}
                        </div>
                        <span className="text-[11px] opacity-80 font-normal line-clamp-1">{f.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Custom Google Font Option */}
              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <span className="text-xs font-bold text-slate-800">إضافة خط عربي مخصص أونلاين من Google Fonts:</span>
                  <span className="text-[11px] text-indigo-600 font-bold">يمكنك تجربة أي خط عربي عبر اسم الخط</span>
                </div>

                <div className="flex flex-col sm:flex-row items-center gap-2">
                  <input
                    type="text"
                    placeholder="اكتب اسم الخط بالإنجليزية (مثال: Almarai, El Messiri, Kufam)"
                    value={customFontInput}
                    onChange={e => setCustomFontInput(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs font-bold focus:border-indigo-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleApplyCustomGoogleFont}
                    className="w-full sm:w-auto px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shrink-0 cursor-pointer transition-colors shadow-2xs"
                  >
                    تطبيق الخط المخصص
                  </button>
                </div>

                {/* Quick helper buttons for extra popular Arabic fonts */}
                <div className="flex items-center gap-2 flex-wrap text-xs pt-1">
                  <span className="text-[11px] text-slate-500 font-semibold">خطوط عربية مقترحة:</span>
                  {[
                    { label: 'المراعي (Almarai)', name: 'Almarai' },
                    { label: 'المسيري (El Messiri)', name: 'El Messiri' },
                    { label: 'عارف رقعة (Aref Ruqaa)', name: 'Aref Ruqaa' },
                    { label: 'حرمل (Harmattan)', name: 'Harmattan' },
                    { label: 'لاليزار (Lalezar)', name: 'Lalezar' },
                  ].map(gFont => (
                    <button
                      key={gFont.name}
                      type="button"
                      onClick={() => {
                        setCustomFontInput(gFont.name);
                        applyNamedGoogleFont(gFont.name);
                      }}
                      className="px-2.5 py-1 bg-white hover:bg-indigo-50 border border-slate-200 hover:border-indigo-300 rounded-lg text-[11px] font-bold text-slate-700 hover:text-indigo-700 transition-colors cursor-pointer"
                    >
                      + {gFont.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Live Font Preview Box */}
              <div 
                className="p-4 bg-indigo-50/60 rounded-2xl border border-indigo-100 space-y-1 transition-all"
                style={{ fontFamily: tempTheme.fontFamily || "'Cairo', sans-serif" }}
              >
                <span className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider block">معاينة حية للنص العربي بالخط الحالي:</span>
                <p className="text-base font-black text-slate-900">
                  د. مريم علي — عيادة طب وجراحة الأسنان والتجميل
                </p>
                <p className="text-xs text-slate-700 font-medium leading-relaxed">
                  نظام إدارة العيادة: السجل الطبي للمرضى، كشوفات المواعيد الحية، حسابات التركيبات، والتقارير المالية 🦷
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
              <button
                type="submit"
                className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-xs cursor-pointer transition-colors"
              >
                حفظ الهوية والألوان
              </button>
            </div>
          </form>
        )}

        {/* 2. Layout & Order SubTab */}
        {activeSubTab === 'layout' && (
          <form onSubmit={handleSaveLayout} className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xs space-y-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900 font-tajawal">
                  تخصيص ترتيب ومسميات وأوصاف أقسام العيادة الرئيسية (▲▼)
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  يمكنك تغيير اسم ونصوص أي قسم بالكامل، بالإضافة إلى إعادة ترتيب ظهور الأقسام في الصفحة الرئيسية والنافبار.
                </p>
              </div>

              <button
                type="submit"
                className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-xs cursor-pointer transition-colors shrink-0"
              >
                حفظ المسميات والترتيب
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <label className="space-y-2 text-right">
                <span className="text-xs font-bold text-slate-700">عنوان الترحيب في لوحة التحكم</span>
                <input
                  type="text"
                  value={tempLabels.welcomeText}
                  onChange={(event) => setTempLabels({ ...tempLabels, welcomeText: event.target.value })}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                  placeholder="مرحباً بك في عيادتك"
                />
              </label>
              <label className="space-y-2 text-right">
                <span className="text-xs font-bold text-slate-700">الوصف المختصر للصفحة الرئيسية</span>
                <input
                  type="text"
                  value={tempLabels.homeSubtitle}
                  onChange={(event) => setTempLabels({ ...tempLabels, homeSubtitle: event.target.value })}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                  placeholder="إدارة يوم العمل من مكان واحد"
                />
              </label>
            </div>

            <div className="space-y-4">
              {tempTileOrder.map((tileKey, idx) => (
                <div key={tileKey} className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
                  <div className="flex items-center justify-between text-xs border-b border-slate-200/60 pb-2">
                    <span className="font-extrabold text-indigo-900 font-mono text-sm">
                      الترتيب #{idx + 1} — (رمز القسم: {tileKey})
                    </span>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleMoveTile(idx, 'up')}
                        disabled={idx === 0}
                        className="px-3 py-1 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 disabled:opacity-40 cursor-pointer text-slate-700 font-bold text-xs"
                      >
                        ▲ للأعلى
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMoveTile(idx, 'down')}
                        disabled={idx === tempTileOrder.length - 1}
                        className="px-3 py-1 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 disabled:opacity-40 cursor-pointer text-slate-700 font-bold text-xs"
                      >
                        ▼ للأسفل
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 mb-1">
                        عنوان القسم (الاسم الظاهر بالواجهة)
                      </label>
                      <input
                        type="text"
                        value={tempLabels.tiles[tileKey]?.title || ''}
                        onChange={e => {
                          const val = e.target.value;
                          setTempLabels(prev => ({
                            ...prev,
                            tiles: {
                              ...prev.tiles,
                              [tileKey]: {
                                title: val,
                                desc: prev.tiles[tileKey]?.desc || ''
                              }
                            }
                          }));
                        }}
                        className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:border-indigo-600"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 mb-1">
                        الوصف التوضيحي للقسم
                      </label>
                      <input
                        type="text"
                        value={tempLabels.tiles[tileKey]?.desc || ''}
                        onChange={e => {
                          const val = e.target.value;
                          setTempLabels(prev => ({
                            ...prev,
                            tiles: {
                              ...prev.tiles,
                              [tileKey]: {
                                title: prev.tiles[tileKey]?.title || '',
                                desc: val
                              }
                            }
                          }));
                        }}
                        className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs text-slate-700 focus:outline-none focus:border-indigo-600"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-4 border-t border-slate-100 flex items-center justify-end">
              <button
                type="submit"
                className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-xs cursor-pointer transition-colors"
              >
                حفظ الترتيب والمسميات
              </button>
            </div>
          </form>
        )}

        {/* 3. Service Types SubTab */}
        {activeSubTab === 'services' && (
          <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xs space-y-6">
            <h3 className="text-base font-bold text-slate-900 font-tajawal">
              إدارة قائمة أنواع الخدمات الطبية
            </h3>

            <div className="flex items-center gap-3">
              <input
                type="text"
                value={newServiceInput}
                onChange={e => setNewServiceInput(e.target.value)}
                placeholder="أكتب اسم الخدمة الطبية الجديدة..."
                className="px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm focus:border-indigo-500 focus:outline-none grow"
              />
              <button
                type="button"
                onClick={handleAddServiceType}
                className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold cursor-pointer shrink-0"
              >
                + إضافة خدمة
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {tempServiceTypes.map(st => (
                <div key={st} className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-800">{st}</span>
                  <button
                    type="button"
                    onClick={() => handleDeleteServiceType(st)}
                    className="text-rose-600 hover:text-rose-800 p-1 cursor-pointer"
                  >
                    🗑
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* WhatsApp Integration SubTab */}
        {activeSubTab === 'whatsapp' && (
          <form onSubmit={handleSaveWhatsappForm} className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xs space-y-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900 font-tajawal flex items-center gap-2">
                  <MessageCircle className="w-5 h-5 text-emerald-600" />
                  إعدادات أتمتة وتكامل رسائل الواتساب (WhatsApp Integration)
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  ربط خدمات الرسائل المباشرة مع مزودي الخدمة (Twilio / Make / UltraMsg / Wati)
                </p>
              </div>

              <button
                type="submit"
                className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-md cursor-pointer flex items-center gap-1.5"
              >
                <Save className="w-4 h-4" />
                حفظ إعدادات الواتساب
              </button>
            </div>

            {/* API Credentials */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">رقم المرسل بالعيادة (Sender Phone)</label>
                <input
                  type="text"
                  value={waState.senderNumber}
                  onChange={e => setWaState({ ...waState, senderNumber: e.target.value })}
                  placeholder="01012345678"
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono focus:outline-none focus:border-emerald-600"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">مفتاح API الخاص بالخدمة (API Key / Token)</label>
                <input
                  type="password"
                  value={waState.apiKey}
                  onChange={e => setWaState({ ...waState, apiKey: e.target.value })}
                  placeholder="ضع الـ API Key لمزود الواتساب..."
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono focus:outline-none focus:border-emerald-600"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">رابط Webhook لتطبيقات الأتمتة (Webhook URL)</label>
                <input
                  type="text"
                  value={waState.webhookUrl}
                  onChange={e => setWaState({ ...waState, webhookUrl: e.target.value })}
                  placeholder="https://hook.make.com/..."
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono focus:outline-none focus:border-emerald-600"
                />
              </div>
            </div>

            {/* Automation Triggers Toggles */}
            <div className="space-y-3 pt-2">
              <h4 className="text-xs font-bold text-slate-800 font-tajawal">مشغلات الأتمتة والتنبيهات المباشرة (Event Triggers):</h4>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <label className="p-3 bg-slate-50 rounded-2xl border border-slate-200 flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={waState.autoConfirmOnAppt}
                    onChange={e => setWaState({ ...waState, autoConfirmOnAppt: e.target.checked })}
                    className="w-4 h-4 text-emerald-600 rounded-md"
                  />
                  <div>
                    <span className="font-bold text-slate-800 text-xs block">إشعار حجز الموعد</span>
                    <span className="text-[11px] text-slate-500">إرسال تفاصيل الموعد فور التسجيل</span>
                  </div>
                </label>

                <label className="p-3 bg-slate-50 rounded-2xl border border-slate-200 flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={waState.autoRemind24h}
                    onChange={e => setWaState({ ...waState, autoRemind24h: e.target.checked })}
                    className="w-4 h-4 text-emerald-600 rounded-md"
                  />
                  <div>
                    <span className="font-bold text-slate-800 text-xs block">تذكير المواعيد (24 ساعة)</span>
                    <span className="text-[11px] text-slate-500">تذكير تلقائي قبل الموعد بيوم</span>
                  </div>
                </label>

                <label className="p-3 bg-slate-50 rounded-2xl border border-slate-200 flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={waState.autoPostOpOnAttended}
                    onChange={e => setWaState({ ...waState, autoPostOpOnAttended: e.target.checked })}
                    className="w-4 h-4 text-emerald-600 rounded-md"
                  />
                  <div>
                    <span className="font-bold text-slate-800 text-xs block">تعليمات ما بعد الجلسة</span>
                    <span className="text-[11px] text-slate-500">إرسال Post-Op فور إتمام الحضور</span>
                  </div>
                </label>
              </div>
            </div>

            {/* Editable Templates */}
            <div className="space-y-4 pt-2">
              <h4 className="text-xs font-bold text-slate-800 font-tajawal">
                تعديل قوالب الرسائل الديناميكية (يمكنك استخدام المتغيرات: &#123;patientName&#125;, &#123;date&#125;, &#123;time&#125;, &#123;clinicName&#125;, &#123;fileNo&#125;, &#123;remainingBalance&#125;):
              </h4>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">قالب تذكير الموعد (Reminder)</label>
                  <textarea
                    rows={3}
                    value={waState.templates.reminderTomorrow}
                    onChange={e => setWaState({ ...waState, templates: { ...waState.templates, reminderTomorrow: e.target.value } })}
                    className="w-full p-3 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:outline-none focus:border-emerald-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">قالب الموعد الجديد (New Appt)</label>
                  <textarea
                    rows={3}
                    value={waState.templates.newAppt}
                    onChange={e => setWaState({ ...waState, templates: { ...waState.templates, newAppt: e.target.value } })}
                    className="w-full p-3 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:outline-none focus:border-emerald-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">قالب تعليمات ما بعد الجلسة (Post-Op)</label>
                  <textarea
                    rows={3}
                    value={waState.templates.postOp}
                    onChange={e => setWaState({ ...waState, templates: { ...waState.templates, postOp: e.target.value } })}
                    className="w-full p-3 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:outline-none focus:border-emerald-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">قالب إشعارات الرصيد والمتبقي (Account Balance)</label>
                  <textarea
                    rows={3}
                    value={waState.templates.accountBalance}
                    onChange={e => setWaState({ ...waState, templates: { ...waState.templates, accountBalance: e.target.value } })}
                    className="w-full p-3 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:outline-none focus:border-emerald-600"
                  />
                </div>
              </div>
            </div>
          </form>
        )}

        {/* Drug Catalog SubTab */}
        {activeSubTab === 'drugs' && (
          <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xs space-y-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900 font-tajawal flex items-center gap-2">
                  <Pill className="w-5 h-5 text-indigo-600" />
                  إدارة فهرس أدوية العيادة (Drug Catalog)
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  الأدوية المتاحة للإضافة السريعة في الروشتات الطبية الإلكترونية
                </p>
              </div>

              <button
                type="button"
                onClick={handleOpenAddDrug}
                className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-md cursor-pointer flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                + إضافة دواء جديد
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {catalogList.map(drug => (
                <div key={drug.id} className="p-4 bg-slate-50 rounded-2xl border border-slate-200 flex items-start justify-between gap-3 text-xs">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-extrabold text-slate-900 text-sm font-mono">{drug.name}</span>
                      <span className="text-[10px] bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded-md font-bold">
                        {drug.category}
                      </span>
                    </div>
                    <p className="text-slate-600 mt-1 font-medium">الجرعة: {drug.defaultDosage}</p>
                    {drug.defaultDuration && <p className="text-slate-400 text-[11px]">المدة: {drug.defaultDuration}</p>}
                  </div>

                  <button
                    type="button"
                    onClick={() => handleDeleteDrug(drug.id)}
                    className="p-1.5 text-rose-600 hover:bg-rose-100 rounded-lg cursor-pointer"
                    title="حذف الدواء"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Firebase Cloud Backup SubTab */}
        {activeSubTab === 'firebase' && (
          <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xs space-y-6">
            {/* Connection Status Banner */}
            <div className="p-4 bg-gradient-to-r from-indigo-900 to-slate-900 text-white rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-md">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-white/10 rounded-xl backdrop-blur-xs">
                  <Cloud className="w-7 h-7 text-sky-400" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold text-sm font-tajawal">الاتصال المباشر بـ Firebase Cloud Database</span>
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
                      متصل ونشط
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

        {/* 4. Users & Permissions SubTab */}
        {activeSubTab === 'users' && (
          <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xs space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900 font-tajawal">
                  إدارة مستخدمي النظام وصلاحيات الوصول (Roles & Permissions)
                </h3>
                <p className="text-xs text-slate-500">
                  تحديد اسم المستخدم، كلمة السر، والرتبة (طبيب / سكرتارية) مع التحكم الدقيق في صلاحيات كل شاشة
                </p>
              </div>

              <button
                type="button"
                onClick={handleOpenAddUser}
                className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold cursor-pointer flex items-center gap-1.5 shadow-xs shrink-0"
              >
                + إضافة مستخدم جديد
              </button>
            </div>

            {/* User Credentials & Permissions List */}
            <div className="space-y-4">
              {users.map(u => (
                <div key={u.id} className="p-5 bg-slate-50 hover:bg-slate-100/70 rounded-2xl border border-slate-200 transition-colors space-y-3 text-xs">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200/60 pb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-800 font-extrabold text-sm flex items-center justify-center font-tajawal">
                        {u.role === 'doctor' ? '👨‍⚕️' : u.role === 'admin' ? '🛡️' : '👩‍💼'}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-extrabold text-slate-900 text-sm font-tajawal">{u.name}</span>
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-indigo-100 text-indigo-900">
                            {u.role === 'doctor' ? 'طبيب معالج' : u.role === 'admin' ? 'مدير النظام' : 'استقبال / سكرتارية'}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-[11px] text-slate-500 font-mono mt-0.5">
                          <span>اسم الدخول: <strong className="text-slate-800">@{u.username || 'غير محدد'}</strong></span>
                          <span>•</span>
                          <span>كلمة السر: <strong className="text-slate-800">{u.password ? '••••••' : '123'}</strong></span>
                          {u.email && (
                            <>
                              <span>•</span>
                              <span>البريد: {u.email}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleOpenEditUser(u)}
                        className="px-3 py-1.5 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-bold cursor-pointer transition-colors shadow-2xs"
                      >
                        تعديل الحساب والصلاحيات
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDeleteUser(u.id)}
                        className="p-1.5 text-rose-600 hover:bg-rose-100 rounded-xl cursor-pointer transition-colors"
                        title="حذف هذا الحساب"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Permissions Summary Badges */}
                  <div>
                    <span className="text-[11px] font-bold text-slate-500 block mb-1.5">الصلاحيات الممنوحة لهذا الحساب:</span>
                    <div className="flex flex-wrap gap-1.5">
                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${u.permissions?.patientView ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200/80 text-slate-400 line-through'}`}>
                        👁️ رؤية الملفات
                      </span>
                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${u.permissions?.patientEdit ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200/80 text-slate-400 line-through'}`}>
                        ✏️ إضافة/تعديل جلسات
                      </span>
                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${u.permissions?.patientFinance ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200/80 text-slate-400 line-through'}`}>
                        💵 المالية والتحصيل
                      </span>
                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${u.permissions?.appointments ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200/80 text-slate-400 line-through'}`}>
                        📅 الحجوزات والمواعيد
                      </span>
                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${u.permissions?.lab ? 'bg-indigo-100 text-indigo-800' : 'bg-slate-200/80 text-slate-400 line-through'}`}>
                        🧪 حالات التركيبات
                      </span>
                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${u.permissions?.labProfit ? 'bg-indigo-100 text-indigo-800' : 'bg-slate-200/80 text-slate-400 line-through'}`}>
                        📈 أرباح التركيبات
                      </span>
                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${u.permissions?.summary ? 'bg-amber-100 text-amber-900' : 'bg-slate-200/80 text-slate-400 line-through'}`}>
                        📊 التقارير والملخص
                      </span>
                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${u.permissions?.controlPanel ? 'bg-sky-100 text-sky-900' : 'bg-slate-200/80 text-slate-400 line-through'}`}>
                        ⚙️ لوحة التحكم
                      </span>
                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${u.permissions?.deletePatients ? 'bg-rose-100 text-rose-800' : 'bg-slate-200/80 text-slate-400 line-through'}`}>
                        🗑️ حذف المرضى
                      </span>
                    </div>
                  </div>
                </div>
              ))}
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
                    <p className="text-xs text-slate-500">يتضمن كافة بيانات الحالات، أرقام الهواتف، التواريخ، والملخص المالي لكل حالة.</p>
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
                <div className="p-4 rounded-2xl bg-emerald-50/60 border border-emerald-200/80 space-y-3">
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
                </div>
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
                {Object.keys(exportCols).map(colKey => (
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
        {activeSubTab === 'system' && (
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
                  onConfirm: () => {
                    onResetAllData();
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

      {/* User Modal */}
      {isUserModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-fadeIn">
          <div id="userModal" className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h2 className="text-base font-bold text-slate-900 font-tajawal">
                {editingUser ? `تعديل حساب والصلاحيات: ${editingUser.name}` : 'إضافة حساب مستخدم جديد'}
              </h2>
              <button onClick={() => setIsUserModalOpen(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveUserForm} className="space-y-4 text-xs font-tajawal">
              {/* Preset quick roles */}
              <div className="flex flex-wrap items-center gap-2 p-3 bg-slate-50 border border-slate-200 rounded-2xl">
                <span className="text-[11px] font-bold text-slate-600 block w-full sm:w-auto">تطبيق نموذج صلاحيات جاهز (Quick Preset):</span>
                
                <button
                  type="button"
                  onClick={() => {
                    setUserRole('admin');
                    setUserPermissions({
                      patientView: true,
                      patientEdit: true,
                      deletePatients: true,
                      patientFinance: true,
                      appointments: true,
                      lab: true,
                      labProfit: true,
                      summary: true,
                      controlPanel: true,
                      registerPayment: true,
                      viewRemainingBalance: true,
                      viewTodayCollections: true,
                      editPayment: true,
                      deletePayment: true,
                      viewExpenses: true,
                      viewProfits: true,
                      managePrices: true,
                      financialReports: true
                    });
                  }}
                  className="px-3 py-1.5 rounded-xl bg-purple-100 text-purple-900 hover:bg-purple-200 text-[11px] font-extrabold cursor-pointer transition-colors flex items-center gap-1"
                >
                  👑 صاحب العيادة / مدير النظام
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setUserRole('doctor');
                    setUserPermissions({
                      patientView: true,
                      patientEdit: true,
                      deletePatients: true,
                      patientFinance: true,
                      appointments: true,
                      lab: true,
                      labProfit: true,
                      summary: true,
                      controlPanel: true,
                      registerPayment: true,
                      viewRemainingBalance: true,
                      viewTodayCollections: true,
                      editPayment: true,
                      deletePayment: true,
                      viewExpenses: true,
                      viewProfits: true,
                      managePrices: true,
                      financialReports: true
                    });
                  }}
                  className="px-3 py-1.5 rounded-xl bg-indigo-100 text-indigo-900 hover:bg-indigo-200 text-[11px] font-extrabold cursor-pointer transition-colors flex items-center gap-1"
                >
                  👨‍⚕️ طبيب معالج (كامل)
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setUserRole('secretary');
                    setUserPermissions({
                      patientView: true,
                      patientEdit: true,
                      deletePatients: false,
                      patientFinance: true,
                      appointments: true,
                      lab: true,
                      labProfit: false,
                      summary: false,
                      controlPanel: false,
                      registerPayment: true,
                      viewRemainingBalance: true,
                      viewTodayCollections: true,
                      editPayment: false,
                      deletePayment: false,
                      viewExpenses: false,
                      viewProfits: false,
                      managePrices: false,
                      financialReports: false
                    });
                  }}
                  className="px-3 py-1.5 rounded-xl bg-emerald-100 text-emerald-900 hover:bg-emerald-200 text-[11px] font-extrabold cursor-pointer transition-colors flex items-center gap-1"
                >
                  👩‍💼 سكرتارية (التحصيل فقط)
                </button>
              </div>

              {/* Form Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    الاسم الكامل <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="input-user-name"
                    type="text"
                    required
                    value={userName}
                    onChange={e => setUserName(e.target.value)}
                    placeholder="مثال: د. مريم علي أو سارة أحمد"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold focus:border-indigo-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    اسم المستخدم للدخول <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="input-user-username"
                    type="text"
                    required
                    value={userUsername}
                    onChange={e => setUserUsername(e.target.value)}
                    placeholder="مثال: dr_maryam أو sara_rec"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono font-bold focus:border-indigo-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    كلمة السر <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={userPassword}
                    onChange={e => setUserPassword(e.target.value)}
                    placeholder="أدخل كلمة السر..."
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono font-bold focus:border-indigo-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    الرتبة الوظيفية
                  </label>
                  <select
                    value={userRole}
                    onChange={e => {
                      const r = e.target.value as any;
                      setUserRole(r);
                      if (r === 'secretary') {
                        setUserPermissions(prev => ({
                          ...prev,
                          summary: false,
                          controlPanel: false,
                          viewExpenses: false,
                          viewProfits: false,
                          managePrices: false,
                          financialReports: false,
                          editPayment: false,
                          deletePayment: false,
                          deletePatients: false
                        }));
                      }
                    }}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="secretary">👩‍💼 سكرتارية / مسؤول استقبال وتحصيل</option>
                    <option value="doctor">👨‍⚕️ طبيب معالج</option>
                    <option value="admin">👑 صاحب العيادة / مدير النظام</option>
                  </select>
                </div>
              </div>

              {/* Categorized Granular Permissions Switches */}
              <div className="pt-3 border-t border-slate-100 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black text-slate-900 font-tajawal block">
                    مصفوفة التحكم الصارم في الصلاحيات (RBAC Granular Permissions)
                  </span>
                  <span className="text-[10px] text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full font-bold">
                    مستقل لكل شاشة وخاصية
                  </span>
                </div>

                {/* 1. Patients Group */}
                <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-950 border-b border-slate-200/60 pb-1.5">
                    <span>👥</span>
                    <span>1. قسم ملفات وسجلات المرضى (Patients)</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <label className="p-2.5 bg-white rounded-xl border border-slate-200 flex items-center justify-between cursor-pointer">
                      <span className="font-bold text-slate-800 text-[11px]">رؤية المرضى (View Patients)</span>
                      <input
                        type="checkbox"
                        checked={userPermissions.patientView}
                        onChange={e => setUserPermissions({ ...userPermissions, patientView: e.target.checked })}
                        className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                      />
                    </label>

                    <label className="p-2.5 bg-white rounded-xl border border-slate-200 flex items-center justify-between cursor-pointer">
                      <span className="font-bold text-slate-800 text-[11px]">تعديل المرضى والزيارات (Edit)</span>
                      <input
                        type="checkbox"
                        checked={userPermissions.patientEdit}
                        onChange={e => setUserPermissions({ ...userPermissions, patientEdit: e.target.checked })}
                        className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                      />
                    </label>

                    <label className="p-2.5 bg-rose-50/60 rounded-xl border border-rose-200 flex items-center justify-between cursor-pointer">
                      <span className="font-bold text-rose-900 text-[11px]">حذف الملفات (Delete)</span>
                      <input
                        type="checkbox"
                        checked={userPermissions.deletePatients}
                        onChange={e => setUserPermissions({ ...userPermissions, deletePatients: e.target.checked })}
                        className="w-4 h-4 rounded text-rose-600 focus:ring-rose-500"
                      />
                    </label>
                  </div>
                </div>

                {/* 2. Appointments Group */}
                <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-amber-950 border-b border-slate-200/60 pb-1.5">
                    <span>📅</span>
                    <span>2. قسم المواعيد والحجوزات (Appointments)</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <label className="p-2.5 bg-white rounded-xl border border-slate-200 flex items-center justify-between cursor-pointer col-span-2">
                      <span className="font-bold text-slate-800 text-[11px]">إدارة جدول الحجوزات اليومي وتغيير المواعيد (Manage Appointments)</span>
                      <input
                        type="checkbox"
                        checked={userPermissions.appointments}
                        onChange={e => setUserPermissions({ ...userPermissions, appointments: e.target.checked })}
                        className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                      />
                    </label>
                  </div>
                </div>

                {/* 3. Collections Group (التحصيل) */}
                <div className="p-3 bg-emerald-50/50 rounded-2xl border border-emerald-200/80 space-y-2">
                  <div className="flex items-center justify-between border-b border-emerald-200/60 pb-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-950">
                      <span>💳</span>
                      <span>3. قسم التحصيل اليومي والسندات (Collections Desk)</span>
                    </div>
                    <span className="text-[10px] text-emerald-800 font-bold bg-emerald-100 px-2 py-0.5 rounded-md">خاص بالاستقبال</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <label className="p-2.5 bg-white rounded-xl border border-slate-200 flex items-center justify-between cursor-pointer">
                      <span className="font-bold text-slate-800 text-[11px]">تسجيل المقبوضات والسندات (Register Payment)</span>
                      <input
                        type="checkbox"
                        checked={userPermissions.registerPayment ?? userPermissions.patientFinance}
                        onChange={e => setUserPermissions({ ...userPermissions, registerPayment: e.target.checked, patientFinance: e.target.checked })}
                        className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500"
                      />
                    </label>

                    <label className="p-2.5 bg-white rounded-xl border border-slate-200 flex items-center justify-between cursor-pointer">
                      <span className="font-bold text-slate-800 text-[11px]">رؤية رصيد المريض والديون (View Balance)</span>
                      <input
                        type="checkbox"
                        checked={userPermissions.viewRemainingBalance ?? true}
                        onChange={e => setUserPermissions({ ...userPermissions, viewRemainingBalance: e.target.checked })}
                        className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500"
                      />
                    </label>

                    <label className="p-2.5 bg-white rounded-xl border border-slate-200 flex items-center justify-between cursor-pointer">
                      <span className="font-bold text-slate-800 text-[11px]">رؤية إجمالي تحصيل اليوم (Today Collections)</span>
                      <input
                        type="checkbox"
                        checked={userPermissions.viewTodayCollections ?? true}
                        onChange={e => setUserPermissions({ ...userPermissions, viewTodayCollections: e.target.checked })}
                        className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500"
                      />
                    </label>

                    <label className="p-2.5 bg-amber-50/60 rounded-xl border border-amber-200 flex items-center justify-between cursor-pointer">
                      <span className="font-bold text-amber-950 text-[11px]">تعديل الدفعات والأقساط القديمة (Edit Payment)</span>
                      <input
                        type="checkbox"
                        checked={userPermissions.editPayment ?? false}
                        onChange={e => setUserPermissions({ ...userPermissions, editPayment: e.target.checked })}
                        className="w-4 h-4 rounded text-amber-600 focus:ring-amber-500"
                      />
                    </label>

                    <label className="p-2.5 bg-rose-50/60 rounded-xl border border-rose-200 flex items-center justify-between cursor-pointer col-span-1 sm:col-span-2">
                      <span className="font-bold text-rose-950 text-[11px]">حذف المعاملات المالية والسندات (Delete Payment)</span>
                      <input
                        type="checkbox"
                        checked={userPermissions.deletePayment ?? false}
                        onChange={e => setUserPermissions({ ...userPermissions, deletePayment: e.target.checked })}
                        className="w-4 h-4 rounded text-rose-600 focus:ring-rose-500"
                      />
                    </label>
                  </div>
                </div>

                {/* 4. Laboratory Group */}
                <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-teal-950 border-b border-slate-200/60 pb-1.5">
                    <span>🧪</span>
                    <span>4. قسم التركيبات (Prosthetics)</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <label className="p-2.5 bg-white rounded-xl border border-slate-200 flex items-center justify-between cursor-pointer">
                      <span className="font-bold text-slate-800 text-[11px]">إدارة طلبات المعمل والتركيبات (Manage Lab)</span>
                      <input
                        type="checkbox"
                        checked={userPermissions.lab}
                        onChange={e => setUserPermissions({ ...userPermissions, lab: e.target.checked })}
                        className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                      />
                    </label>

                    <label className="p-2.5 bg-white rounded-xl border border-slate-200 flex items-center justify-between cursor-pointer">
                      <span className="font-bold text-slate-800 text-[11px]">رؤية أسعار وتكاليف المعمل (View Lab Costs)</span>
                      <input
                        type="checkbox"
                        checked={userPermissions.labProfit}
                        onChange={e => setUserPermissions({ ...userPermissions, labProfit: e.target.checked })}
                        className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                      />
                    </label>
                  </div>
                </div>

                {/* 5. Full Finance & Reports Group (Restricted from Secretary!) */}
                <div className="p-3 bg-indigo-50/50 rounded-2xl border border-indigo-200/80 space-y-2">
                  <div className="flex items-center justify-between border-b border-indigo-200/60 pb-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-950">
                      <span>📊</span>
                      <span>5. لوحة المالية والأرباح الشاملة (Finance & Analytics)</span>
                    </div>
                    <span className="text-[10px] text-rose-800 font-bold bg-rose-100 px-2 py-0.5 rounded-md">محظور عن السكرتارية</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <label className="p-2.5 bg-white rounded-xl border border-slate-200 flex items-center justify-between cursor-pointer">
                      <span className="font-bold text-slate-800 text-[11px]">رؤية الشاشة المالية بالكامل (View Finance Dashboard)</span>
                      <input
                        type="checkbox"
                        checked={userPermissions.summary}
                        onChange={e => setUserPermissions({ ...userPermissions, summary: e.target.checked })}
                        className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                      />
                    </label>

                    <label className="p-2.5 bg-white rounded-xl border border-slate-200 flex items-center justify-between cursor-pointer">
                      <span className="font-bold text-slate-800 text-[11px]">رؤية وإضافة المصروفات (View Expenses)</span>
                      <input
                        type="checkbox"
                        checked={userPermissions.viewExpenses ?? userPermissions.summary}
                        onChange={e => setUserPermissions({ ...userPermissions, viewExpenses: e.target.checked })}
                        className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                      />
                    </label>

                    <label className="p-2.5 bg-white rounded-xl border border-slate-200 flex items-center justify-between cursor-pointer">
                      <span className="font-bold text-slate-800 text-[11px]">رؤية صافي الأرباح والتحليلات (View Net Profit)</span>
                      <input
                        type="checkbox"
                        checked={userPermissions.viewProfits ?? userPermissions.summary}
                        onChange={e => setUserPermissions({ ...userPermissions, viewProfits: e.target.checked })}
                        className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                      />
                    </label>

                    <label className="p-2.5 bg-white rounded-xl border border-slate-200 flex items-center justify-between cursor-pointer">
                      <span className="font-bold text-slate-800 text-[11px]">إدارة قائمة أسعار الخدمات (Manage Prices)</span>
                      <input
                        type="checkbox"
                        checked={userPermissions.managePrices ?? userPermissions.controlPanel}
                        onChange={e => setUserPermissions({ ...userPermissions, managePrices: e.target.checked })}
                        className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                      />
                    </label>
                  </div>
                </div>

                {/* 6. Settings & Reports Group */}
                <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900 border-b border-slate-200/60 pb-1.5">
                    <span>⚙️</span>
                    <span>6. التقارير وإعدادات النظام (Settings & Reports)</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <label className="p-2.5 bg-white rounded-xl border border-slate-200 flex items-center justify-between cursor-pointer">
                      <span className="font-bold text-slate-800 text-[11px]">تصدير التقارير المالية والإكسيل (Export Reports)</span>
                      <input
                        type="checkbox"
                        checked={userPermissions.financialReports ?? userPermissions.summary}
                        onChange={e => setUserPermissions({ ...userPermissions, financialReports: e.target.checked })}
                        className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                      />
                    </label>

                    <label className="p-2.5 bg-white rounded-xl border border-slate-200 flex items-center justify-between cursor-pointer">
                      <span className="font-bold text-slate-800 text-[11px]">دخول لوحة التحكم وإدارة المستخدمين (Control Panel)</span>
                      <input
                        type="checkbox"
                        checked={userPermissions.controlPanel}
                        onChange={e => setUserPermissions({ ...userPermissions, controlPanel: e.target.checked })}
                        className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                      />
                    </label>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsUserModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-md cursor-pointer"
                >
                  حفظ الحساب والصلاحيات
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Drug Modal */}
      {isDrugModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-fadeIn">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h2 className="text-base font-bold text-slate-900 font-tajawal">
                {editingDrug ? 'تعديل الدواء' : 'إضافة دواء جديد للفهرس'}
              </h2>
              <button onClick={() => setIsDrugModalOpen(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveDrugForm} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  اسم الدواء والتركيز <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={drugName}
                  onChange={e => setDrugName(e.target.value)}
                  placeholder="مثال: Augmentin 1g"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  التصنيف الطبي
                </label>
                <input
                  type="text"
                  value={drugCategory}
                  onChange={e => setDrugCategory(e.target.value)}
                  placeholder="مثال: مضاد حيوي / مسكن آلام"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  الجرعة الافتراضية (Dosage)
                </label>
                <input
                  type="text"
                  value={drugDosage}
                  onChange={e => setDrugDosage(e.target.value)}
                  placeholder="مثال: قرص كل 12 ساعة بعد الأكل"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  مدة العلاج الافتراضية (Duration)
                </label>
                <input
                  type="text"
                  value={drugDuration}
                  onChange={e => setDrugDuration(e.target.value)}
                  placeholder="مثال: لمدة 5-7 أيام"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsDrugModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-xs cursor-pointer"
                >
                  حفظ الدواء
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
