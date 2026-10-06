import React, { useState, useMemo } from 'react';
import { 
  Calendar, Users, DollarSign, Plus, Clock,
  Search, UserPlus, Phone, ArrowRight, MessageCircle,
  Microscope, AlertCircle, ChevronLeft, User as UserIcon,
  Eye, EyeOff, FolderOpen, X, ChevronDown
} from 'lucide-react';
import { Patient, Appointment, LabCase, User, NavigationOrigin, ActiveView, AppointmentStatus, Session, UserPermission } from '../../types';
import { useToastAndConfirm } from '../common/ToastAndConfirm';
import { BalanceProgressMeter } from '../common/FinancialBadge';
import { AppointmentStatusModal, APPOINTMENT_STATUS_CONFIGS, format12HourTime } from '../appointments/AppointmentStatusModal';
import { calculateDailyCollections, getPatientFinancialSummary, getSessionCollected } from '../../utils/financials';
import { appointmentTimeMinutes, findAppointmentConflicts, isValidAppointmentDate, localDateISO } from '../appointments/appointmentScheduling';
import { useAppointmentDialog } from '../appointments/useAppointmentDialog';
import { cleanEgyptianPhone, getWhatsAppUrl } from '../../utils/whatsappUtils';

const normalizeDigits = (value: string) => value.replace(/[٠-٩۰-۹]/g, digit => String(digit.charCodeAt(0) - (digit <= '٩' ? 0x0660 : 0x06f0)));
const sessionRemaining = (session: Session) => Math.max(0,
  (Number.isFinite(session.amount) ? Math.max(0, session.amount) : 0)
  - (Number.isFinite(session.discount) ? Math.max(0, session.discount || 0) : 0)
  - getSessionCollected(session));

interface SecretaryDeskViewProps {
  currentUser: User | null;
  patients: Patient[];
  appointments: Appointment[];
  labCases: LabCase[];
  serviceTypes: string[];
  clinicName: string;
  onSelectPatient: (patientId: string, origin: NavigationOrigin) => void;
  onSavePatient: (patient: Patient) => void;
  onSaveAppointment: (appt: Omit<Appointment, 'id'>) => void;
  onUpdateApptStatus: (apptId: string, status: AppointmentStatus) => void;
  onAddPaymentInstallment: (patientId: string, sessionId: string, installment: { amount: number; date: string }) => void;
  onBackToHome: () => void;
  onNavigate?: (view: ActiveView) => void;
}

export const SecretaryDeskView: React.FC<SecretaryDeskViewProps> = React.memo(({
  currentUser,
  patients,
  appointments,
  labCases,
  serviceTypes,
  clinicName,
  onSelectPatient,
  onSavePatient,
  onSaveAppointment,
  onUpdateApptStatus,
  onAddPaymentInstallment,
  onBackToHome,
  onNavigate
}) => {
  const { showToast, askConfirm } = useToastAndConfirm();
  const permissions: UserPermission = currentUser?.permissions || {
    patientView: false,
    patientEdit: false,
    deletePatients: false,
    patientFinance: false,
    appointments: false,
    lab: false,
    labProfit: false,
    summary: false,
    controlPanel: false
  };
  const canRegisterPayments = permissions.patientFinance && permissions.registerPayment !== false;
  const canViewRemaining = permissions.patientFinance && permissions.viewRemainingBalance !== false;
  const canViewCollections = permissions.patientFinance && permissions.viewTodayCollections !== false
    && (permissions.viewTodayCollections === true || permissions.summary);

  const todayStr = localDateISO();

  // Active Mobile Tab
  const [activeTab, setActiveTab] = useState<'today' | 'payments' | 'lab'>(permissions.appointments ? 'today' : permissions.patientView ? 'payments' : 'lab');

  // Today's Collection Privacy Toggle
  const [showCollection, setShowCollection] = useState<boolean>(false);

  // Search & Filters
  const [patientSearch, setPatientSearch] = useState('');

  // Modals state
  const [isApptModalOpen, setIsApptModalOpen] = useState(false);
  const [isNewPatientModalOpen, setIsNewPatientModalOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);

  const appointmentDialogRef = useAppointmentDialog(isApptModalOpen && permissions.appointments, () => setIsApptModalOpen(false));
  const newPatientDialogRef = useAppointmentDialog(isNewPatientModalOpen && permissions.patientEdit, () => setIsNewPatientModalOpen(false));
  const paymentDialogRef = useAppointmentDialog(isPaymentModalOpen && canRegisterPayments, () => setIsPaymentModalOpen(false));

  // New Appointment Form State
  const [apptPatientId, setApptPatientId] = useState('');
  const [apptDate, setApptDate] = useState(todayStr);
  const [apptTime, setApptTime] = useState('17:00');
  const [apptNote, setApptNote] = useState('');
  const [apptIsWalkIn, setApptIsWalkIn] = useState(false);

  // Status Selector Modal State
  const [secStatusModalAppt, setSecStatusModalAppt] = useState<Appointment | null>(null);

  const handleSecSelectStatus = (newStatus: AppointmentStatus) => {
    if (!secStatusModalAppt || !permissions.appointments) return;
    onUpdateApptStatus(secStatusModalAppt.id, newStatus);
    const cfg = APPOINTMENT_STATUS_CONFIGS[newStatus];
    showToast(`تم تحديث حالة الموعد إلى (${cfg ? cfg.label : newStatus}) بنجاح`, 'success');
    setSecStatusModalAppt(null);
  };

  // Auto suggest next file number
  const getNextFileNo = () => {
    const numericIds = patients
      .map(p => /^\d+$/.test(normalizeDigits(p.id.trim())) ? Number(normalizeDigits(p.id.trim())) : NaN)
      .filter(n => Number.isSafeInteger(n) && n >= 0);
    if (numericIds.length === 0) return '101';
    return (numericIds.reduce((largest, value) => Math.max(largest, value), 0) + 1).toString();
  };

  // New Patient Form State
  const [newPatientFileNo, setNewPatientFileNo] = useState('');
  const [newPatientName, setNewPatientName] = useState('');
  const [newPatientMobile, setNewPatientMobile] = useState('');
  const [newPatientAge, setNewPatientAge] = useState<number | ''>('');
  const [newPatientNotes, setNewPatientNotes] = useState('');

  const handleOpenNewPatientModal = () => {
    if (!permissions.patientEdit) return;
    setNewPatientFileNo(getNextFileNo());
    setNewPatientName('');
    setNewPatientMobile('');
    setNewPatientAge('');
    setNewPatientNotes('');
    setIsNewPatientModalOpen(true);
  };

  // Quick Payment Collection State
  const [payPatientId, setPayPatientId] = useState('');
  const [paySessionId, setPaySessionId] = useState('');
  const [payAmount, setPayAmount] = useState<number | ''>('');
  const [paySearchQuery, setPaySearchQuery] = useState('');
  const handleOpenAppointmentModal = () => {
    if (!permissions.appointments) return;
    setApptPatientId('');
    setApptDate(todayStr);
    setApptTime('17:00');
    setApptNote('');
    setApptIsWalkIn(false);
    setIsApptModalOpen(true);
  };
  const handleOpenPaymentModal = (patient?: Patient) => {
    if (!canRegisterPayments) return;
    const unpaidSession = patient?.sessions.find(session => sessionRemaining(session) > 0);
    setPayPatientId(patient?.id || '');
    setPaySessionId(unpaidSession?.id || '');
    setPayAmount('');
    setPaySearchQuery('');
    setIsPaymentModalOpen(true);
  };

  // Today's Appointments
  const todayAppointments = useMemo(() => {
    return appointments.filter(a => a.date === todayStr).sort((a, b) => a.time.localeCompare(b.time));
  }, [appointments, todayStr]);

  // Selected Patient for Payment
  const selectedPaymentPatient = useMemo(() => {
    return patients.find(p => p.id === payPatientId);
  }, [patients, payPatientId]);

  // Quick Payment Patient Search Results (by File #, Name, or Mobile)
  const matchedPayPatients = useMemo(() => {
    const cleanPayQuery = paySearchQuery.trim().toLowerCase().replace(/^#/, '');
    if (!cleanPayQuery) return patients.slice(0, 10);
    return patients.filter(p =>
      p.id.toLowerCase().includes(cleanPayQuery) ||
      p.name.toLowerCase().includes(cleanPayQuery) ||
      p.mobile.replace(/[^0-9]/g, '').includes(cleanPayQuery)
    );
  }, [patients, paySearchQuery]);

  // Patient Search Results
  const filteredPatients = useMemo(() => {
    if (!permissions.patientView) return [];
    const q = normalizeDigits(patientSearch.trim().toLowerCase());
    if (!q) return patients.slice(0, 15);
    return patients.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.id.includes(q) ||
      p.mobile.includes(q)
    );
  }, [patients, patientSearch, permissions.patientView]);

  // Handlers
  const handleSaveNewAppointment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!permissions.appointments) {
      showToast('ليس لديك صلاحية تسجيل المواعيد', 'error');
      return;
    }
    const patient = patients.find(item => item.id === apptPatientId);
    if (!patient) {
      showToast('اختر ملف مريض موجودًا. أضف ملف المريض الجديد أولًا من قسم المرضى.', 'warning');
      return;
    }
    if (!isValidAppointmentDate(apptDate) || appointmentTimeMinutes(apptTime) === null) {
      showToast('حدد تاريخًا ووقتًا صحيحين للموعد', 'warning');
      return;
    }
    const appointment: Omit<Appointment, 'id'> = {
      patientId: patient.id,
      fileNo: patient.id,
      patientName: patient.name,
      mobile: patient.mobile,
      date: apptDate,
      time: apptTime,
      note: apptNote.trim() || 'كشف ومتابعة',
      durationMinutes: 30,
      isFollowUp: false,
      isWalkIn: apptIsWalkIn,
      status: apptIsWalkIn ? 'waiting' : 'scheduled'
    };
    const saveAppointment = () => {
      try {
        onSaveAppointment(appointment);
        setIsApptModalOpen(false);
        showToast('تم حجز الموعد بنجاح في جدول المواعيد', 'success');
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'تعذّر حفظ الموعد. راجع البيانات وحاول مرة أخرى.', 'error');
      }
    };
    if (findAppointmentConflicts(appointments, apptDate, apptTime).length) {
      askConfirm({ title: 'موعد متعارض', message: 'يتداخل وقت الحجز مع موعد آخر. هل تريد تأكيد الحجز رغم التعارض؟', confirmLabel: 'تأكيد الحجز', tone: 'warning', onConfirm: saveAppointment });
    } else saveAppointment();
  };

  const handleCreateNewPatient = (e: React.FormEvent) => {
    e.preventDefault();
    if (!permissions.patientEdit) {
      showToast('ليس لديك صلاحية إضافة مرضى جدد', 'error');
      return;
    }
    if (!newPatientName.trim()) {
      showToast('يرجى كتابة اسم المريض الثلاثي', 'warning');
      return;
    }

    const fileNo = normalizeDigits(newPatientFileNo.trim() || getNextFileNo());
    if (!/^\d+$/.test(fileNo) || !Number.isSafeInteger(Number(fileNo)) || Number(fileNo) <= 0) {
      showToast('رقم الملف يجب أن يكون رقمًا صحيحًا أكبر من صفر', 'warning');
      return;
    }
    if (newPatientAge !== '' && (!Number.isFinite(newPatientAge) || !Number.isInteger(newPatientAge) || newPatientAge < 0 || newPatientAge > 130)) {
      showToast('راجع العمر؛ أدخل عدد سنوات صحيحًا من صفر إلى ١٣٠ أو اتركه فارغًا.', 'warning');
      return;
    }
    if (newPatientMobile.trim() && !/^[1-9]\d{7,14}$/.test(cleanEgyptianPhone(newPatientMobile))) {
      showToast('راجع رقم الهاتف أو اتركه فارغًا إذا لم يكن متاحًا.', 'warning');
      return;
    }
    const isDuplicate = patients.some(p => normalizeDigits(p.id.trim()) === fileNo);
    if (isDuplicate) {
      showToast(`رقم الملف (${fileNo}) مستخدم بالفعل لحالة أخرى`, 'warning');
      return;
    }

    const newPatient: Patient = {
      id: fileNo,
      name: newPatientName.trim(),
      mobile: newPatientMobile.trim(),
      age: typeof newPatientAge === 'number' ? newPatientAge : 0,
      firstVisit: todayStr,
      notes: newPatientNotes.trim(),
      allergy: '',
      sessions: [],
      payments: []
    };

    try {
      onSavePatient(newPatient);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذّر إنشاء الملف. راجع البيانات وحاول مرة أخرى.', 'error');
      return;
    }
    setIsNewPatientModalOpen(false);
    setNewPatientName('');
    setNewPatientMobile('');
    setNewPatientAge('');
    setNewPatientNotes('');
    showToast(`تم فتح الملف برقم #${fileNo}`, 'success');

    // Automatically open patient file!
    if (permissions.patientView) onSelectPatient(fileNo, 'patients');
  };

  const handleConfirmQuickPayment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canRegisterPayments) {
      showToast('ليس لديك صلاحية التحصيل والتحكم المالي', 'error');
      return;
    }
    if (!payPatientId) {
      showToast('يرجى اختيار المريض المراد التحصيل منه أولاً', 'warning');
      return;
    }
    const targetPatient = patients.find(p => p.id === payPatientId);
    const targetSession = targetPatient?.sessions.find(session => session.id === paySessionId);
    if (!targetPatient || !targetSession) {
      showToast('اختر جلسة موجودة في ملف المريض لتحصيل الدفعة', 'warning');
      return;
    }
    const amt = typeof payAmount === 'number' ? payAmount : 0;
    if (!Number.isFinite(amt) || amt <= 0) {
      showToast('يرجى كتابة مبلغ تحصيل صحيح أكبر من صفر', 'warning');
      return;
    }

    const maximumPayment = Math.min(sessionRemaining(targetSession), getPatientFinancialSummary(targetPatient).totalRemaining);
    if (amt > maximumPayment) {
      showToast(canViewRemaining
        ? `المبلغ أكبر من المتبقي المستحق (${maximumPayment.toLocaleString()} ج.م). راجع الجلسة المختارة.`
        : 'المبلغ أكبر من المستحق للجلسة. راجع طبيب العيادة قبل التحصيل.', 'warning');
      return;
    }
    try {
      onAddPaymentInstallment(payPatientId, targetSession.id, { amount: amt, date: localDateISO() });
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذّر حفظ الدفعة. حاول مرة أخرى.', 'error');
      return;
    }
    setIsPaymentModalOpen(false);
    setPayAmount('');
    setPaySearchQuery('');
    showToast('تم تسجيل تحصيل المبلغ وإضافة القسط بنجاح', 'success');
  };

  const openWhatsAppReminder = (mobile: string, name: string, time: string) => {
    const phone = cleanEgyptianPhone(mobile || '');
    if (!/^[1-9]\d{7,14}$/.test(phone)) {
      showToast('لا يوجد رقم هاتف صحيح مسجل لهذا المريض', 'warning');
      return;
    }
    const msg = `أهلاً بك أستاذ/ة ${name}، نذكركم بموعدكم اليوم بـ ${clinicName} الساعة ${time}. نتمنى لكم السلامة دائماً.`;
    window.open(getWhatsAppUrl(phone, msg), '_blank', 'noopener,noreferrer');
    showToast('راجع الرسالة داخل واتساب وأرسلها يدويًا.', 'info');
  };

  // Today's Calculations for Stats Bar
  const todayPatientsCount = new Set([
    ...todayAppointments.map(a => a.patientId || a.fileNo),
    ...patients.filter(p => p.firstVisit === todayStr).map(p => p.id)
  ]).size;

  const todayCollectionTotal = useMemo(() => calculateDailyCollections(patients, date => date === todayStr).totalIncomeCollected, [patients, todayStr]);

  return (
    <div className="space-y-3.5 max-w-5xl mx-auto py-2 font-tajawal" dir="rtl">
      {/* 1. Ultra-Compact Streamlined Welcome Bar (No bloated permissions tags) */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-3 sm:p-3.5 shadow-2xs">
        <div className="flex items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={onBackToHome}
              className="p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer shrink-0 active:scale-95 touch-manipulation"
              title="العودة لشاشة الرئيسية"
              aria-label="العودة للرئيسية"
            >
              <ArrowRight className="w-4 h-4" />
            </button>
            <div className="min-w-0">
              <h1 className="text-xs sm:text-sm font-black text-slate-900 tracking-tight flex items-center gap-1 truncate">
                <span>مرحباً بك، {currentUser?.name || 'مستخدم العيادة'}</span>
                <span className="text-emerald-600">👋</span>
              </h1>
              <p className="text-[11px] text-slate-500 font-medium truncate">
                واجهة الخدمات السريعة لعيادة الأسنان
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 bg-emerald-50 px-2.5 py-1.5 rounded-xl border border-emerald-200/80 text-[11px] text-emerald-900 font-bold shrink-0">
            <UserIcon className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
            <span>{currentUser?.role === 'secretary' ? 'حساب سكرتيرة' : 'حساب طبيب'}</span>
          </div>
        </div>
      </div>

      {/* 2. Mini Statistics Cards with Privacy Toggle for Collection */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {/* Today Patients */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-3 shadow-2xs flex flex-col justify-between min-h-[76px] hover:border-slate-300 transition-all">
          <div className="flex items-center justify-between text-slate-500 text-[11px] font-bold">
            <span>مرضى اليوم</span>
            <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-indigo-500 to-blue-600 text-white flex items-center justify-center shrink-0 shadow-xs">
              <Users className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-sm sm:text-base font-black text-slate-900 font-mono mt-1">
            {todayPatientsCount} <span className="text-[10px] font-sans text-slate-500 font-normal">حالة</span>
          </div>
        </div>

        {/* Today Appointments */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-3 shadow-2xs flex flex-col justify-between min-h-[76px] hover:border-slate-300 transition-all">
          <div className="flex items-center justify-between text-slate-500 text-[11px] font-bold">
            <span>مواعيد اليوم</span>
            <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 text-white flex items-center justify-center shrink-0 shadow-xs">
              <Calendar className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-sm sm:text-base font-black text-slate-900 font-mono mt-1">
            {todayAppointments.length} <span className="text-[10px] font-sans text-slate-500 font-normal">موعد</span>
          </div>
        </div>

        {/* Today Collection (With Tap-to-Reveal Privacy Toggle for Patient Privacy) */}
        <button
          type="button"
          onClick={() => { if (canViewCollections) setShowCollection(prev => !prev); }}
          disabled={!canViewCollections}
          aria-pressed={canViewCollections && showCollection}
          className="bg-white hover:bg-emerald-50/40 border border-slate-200/90 hover:border-emerald-300 rounded-2xl p-3 shadow-2xs flex flex-col justify-between min-h-[76px] text-right transition-all cursor-pointer active:scale-96 touch-manipulation"
          title={!canViewCollections ? 'عرض تحصيل اليوم غير مسموح لهذا الحساب' : showCollection ? 'إخفاء المبلغ للخصوصية' : 'اضغط لإظهار التحصيل المالي'}
        >
          <div className="flex items-center justify-between text-slate-500 text-[11px] font-bold w-full">
            <span className="flex items-center gap-1 text-slate-700">
              تحصيل اليوم
            </span>
            <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex items-center justify-center shrink-0 shadow-xs">
              {canViewCollections && showCollection ? <EyeOff className="w-3.5 h-3.5 text-white" /> : <Eye className="w-3.5 h-3.5 text-white" />}
            </div>
          </div>
          <div className="mt-1 font-mono">
            {canViewCollections && showCollection ? (
              <div className="text-sm sm:text-base font-black text-emerald-700 truncate">
                {todayCollectionTotal.toLocaleString()} <span className="text-[10px] font-sans text-slate-500 font-normal">ج.م</span>
              </div>
            ) : (
              <div className="text-xs sm:text-sm font-bold text-slate-400 tracking-widest flex items-center gap-1">
                <span>•••••</span>
                <span className="text-[10px] font-sans text-slate-400 font-normal">{canViewCollections ? '(اضغط)' : 'غير متاح'}</span>
              </div>
            )}
          </div>
        </button>
      </div>

      {/* 2.5 Prominent Instant Case Index & Live Search Bar (فهرس الحالات والبحث المباشر) */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white rounded-2xl p-3 sm:p-3.5 shadow-md border border-indigo-800/40 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-indigo-500/20 text-indigo-300 border border-indigo-400/30 flex items-center justify-center shrink-0">
              <Search className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-xs sm:text-sm font-black text-white flex items-center gap-2 truncate">
                <span>فهرس الحالات والبحث السريع</span>
                <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 text-[10px] font-mono px-2 py-0.5 rounded-full shrink-0">
                  {patients.length} حالة
                </span>
              </h2>
              <p className="text-[10px] sm:text-[11px] text-slate-300 font-medium truncate">
                ابحث بالاسم، الموبايل، أو رقم الملف للوصول المباشر للملف الطبي
              </p>
            </div>
          </div>
          
          <button
            type="button"
            disabled={!permissions.patientView}
            onClick={() => {
              if (onNavigate) {
                onNavigate('patients');
              } else {
                setActiveTab('payments');
              }
            }}
            className="px-2.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-extrabold transition-all shrink-0 flex items-center gap-1 active:scale-95 cursor-pointer shadow-xs touch-manipulation"
          >
            <span>الفهرس الكامل</span>
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Realtime Search Input */}
        <div className="relative">
          <Search className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={patientSearch}
            onChange={e => {
              setPatientSearch(e.target.value);
            }}
            placeholder="🔍 اكتب اسم المريض، الهاتف، أو رقم الملف للبحث المباشر..."
            className="w-full pr-10 pl-9 py-2.5 bg-white text-slate-900 placeholder-slate-400 rounded-xl text-xs sm:text-sm font-bold shadow-inner focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-all"
          />
          {patientSearch && (
            <button
              type="button"
              onClick={() => setPatientSearch('')}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1 cursor-pointer hover:bg-slate-100 rounded-lg transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Live Patient Search Match Cards Overlay when typing */}
        {patientSearch.trim().length > 0 && (
          <div className="bg-white rounded-xl p-2.5 border border-slate-200 text-slate-900 space-y-2 shadow-lg max-h-72 overflow-y-auto mt-2 animate-fadeIn">
            <div className="text-[11px] font-bold text-slate-500 px-1 flex items-center justify-between border-b border-slate-100 pb-1.5">
              <span>نتائج البحث في فهرس الحالات ({filteredPatients.length}):</span>
              <button
                type="button"
                onClick={() => {
                  setActiveTab('payments');
                }}
                className="text-indigo-600 hover:underline font-extrabold cursor-pointer"
              >
                انتقل للجدول الكامل ←
              </button>
            </div>

            {filteredPatients.length === 0 ? (
              <div className="text-center py-4 text-xs text-slate-400 font-medium">
                لا توجد حالات تطابق "{patientSearch}". يمكنك تسجيل مريض جديد.
              </div>
            ) : (
              <div className="space-y-2">
                {filteredPatients.slice(0, 6).map(patient => {
                  const financial = getPatientFinancialSummary(patient);
                  const totalReq = Math.max(0, financial.totalRequired - financial.totalDiscounts);
                  const totalPaid = financial.totalCollected;
                  const remain = financial.totalRemaining;

                  return (
                    <button
                      key={patient.id}
                      type="button"
                      onClick={() => {
                        onSelectPatient(patient.id, 'patients');
                      }}
                      className="w-full text-right p-3 rounded-xl bg-slate-50 hover:bg-indigo-50/80 border border-slate-200/90 hover:border-indigo-300 transition-all duration-200 flex items-center justify-between gap-3 cursor-pointer group active:scale-[0.98] touch-manipulation hover:-translate-y-0.5"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-extrabold text-slate-900 text-xs sm:text-sm group-hover:text-indigo-900 transition-colors">
                            {patient.name}
                          </span>
                          <span className="font-mono text-[10px] bg-indigo-100 text-indigo-900 px-2 py-0.5 rounded-md font-bold border border-indigo-200/60">
                            #{patient.id}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 font-medium flex items-center gap-2 flex-wrap">
                          <span>📱 {patient.mobile || '—'}</span>
                          {canViewRemaining && (remain > 0 ? (
                            <span className="text-rose-700 font-bold bg-rose-50 px-1.5 py-0.2 rounded border border-rose-200/60">
                              متبقي: {remain.toLocaleString()} ج.م
                            </span>
                          ) : (
                            <span className="text-emerald-700 font-bold bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-200/60">
                              خالص الحساب
                            </span>
                          ))}
                        </div>
                      </div>

                      <div className="flex items-center text-slate-400 group-hover:text-indigo-600 transition-colors shrink-0">
                        <ChevronLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 3. Aesthetic Square Quick Action Cards Grid (Side-by-Side for One-Handed Thumb Reach) */}
      <div className="space-y-2 pt-1">
        <div className="text-[11px] font-black text-slate-700 px-1 flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>الإجراءات السريعة الرئيسية</span>
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
          {/* Action 1: New Appointment */}
          <button
            type="button"
            disabled={!permissions.appointments}
            onClick={handleOpenAppointmentModal}
            className={`p-3.5 sm:p-4 rounded-2xl border text-center transition-all duration-200 flex flex-col items-center justify-center gap-2 cursor-pointer touch-manipulation group relative overflow-hidden ${
              permissions.appointments
                ? 'bg-white hover:bg-emerald-50/50 border-slate-200/90 hover:border-emerald-400 shadow-2xs hover:shadow-xs text-slate-900 active:scale-95'
                : 'bg-slate-50 text-slate-400 border-slate-200 opacity-60 cursor-not-allowed'
            }`}
          >
            <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex items-center justify-center shrink-0 shadow-md shadow-emerald-500/20 group-hover:scale-105 transition-transform">
              <Calendar className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
            </div>
            <div className="text-center w-full">
              <span className="font-black text-xs sm:text-sm block text-slate-900 group-hover:text-emerald-900 transition-colors">حجز موعد</span>
              <span className="text-[10px] sm:text-[11px] text-slate-500 font-medium block leading-tight mt-0.5">اختيار المريض ووقت الحضور</span>
            </div>
          </button>

          {/* Action 2: New Patient */}
          <button
            type="button"
            disabled={!permissions.patientEdit}
            onClick={handleOpenNewPatientModal}
            className={`p-3.5 sm:p-4 rounded-2xl border text-center transition-all duration-200 flex flex-col items-center justify-center gap-2 cursor-pointer touch-manipulation group relative overflow-hidden ${
              permissions.patientEdit
                ? 'bg-white hover:bg-indigo-50/50 border-slate-200/90 hover:border-indigo-400 shadow-2xs hover:shadow-xs text-slate-900 active:scale-95'
                : 'bg-slate-50 text-slate-400 border-slate-200 opacity-60 cursor-not-allowed'
            }`}
          >
            <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-blue-600 text-white flex items-center justify-center shrink-0 shadow-md shadow-indigo-500/20 group-hover:scale-105 transition-transform">
              <UserPlus className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
            </div>
            <div className="text-center w-full">
              <span className="font-black text-xs sm:text-sm block text-slate-900 group-hover:text-indigo-900 transition-colors">تسجيل مريض</span>
              <span className="text-[10px] sm:text-[11px] text-slate-500 font-medium block leading-tight mt-0.5">فتح ملف مريض جديد</span>
            </div>
          </button>

          {/* Action 3: Quick Payment */}
          <button
            type="button"
            disabled={!canRegisterPayments}
            onClick={() => handleOpenPaymentModal()}
            className={`p-3.5 sm:p-4 rounded-2xl border text-center transition-all duration-200 flex flex-col items-center justify-center gap-2 cursor-pointer touch-manipulation group relative overflow-hidden ${
              canRegisterPayments
                ? 'bg-white hover:bg-amber-50/50 border-slate-200/90 hover:border-amber-400 shadow-2xs hover:shadow-xs text-slate-900 active:scale-95'
                : 'bg-slate-50 text-slate-400 border-slate-200 opacity-60 cursor-not-allowed'
            }`}
          >
            <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-500 text-white flex items-center justify-center shrink-0 shadow-md shadow-amber-500/20 group-hover:scale-105 transition-transform">
              <DollarSign className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
            </div>
            <div className="text-center w-full">
              <span className="font-black text-xs sm:text-sm block text-slate-900 group-hover:text-amber-900 transition-colors">تحصيل نقدي</span>
              <span className="text-[10px] sm:text-[11px] text-slate-500 font-medium block leading-tight mt-0.5">دفعة وقسط مالي</span>
            </div>
          </button>

          {/* Action 4: Lab Cases */}
          <button
            type="button"
            disabled={!permissions.lab}
            onClick={() => setActiveTab('lab')}
            className="p-3.5 sm:p-4 rounded-2xl border border-slate-200/90 hover:border-purple-400 bg-white hover:bg-purple-50/50 shadow-2xs hover:shadow-xs text-slate-900 transition-all duration-200 flex flex-col items-center justify-center gap-2 cursor-pointer active:scale-95 touch-manipulation group relative overflow-hidden"
          >
            <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-gradient-to-br from-purple-500 to-violet-600 text-white flex items-center justify-center shrink-0 shadow-md shadow-purple-500/20 group-hover:scale-105 transition-transform">
              <Microscope className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
            </div>
            <div className="text-center w-full">
              <span className="font-black text-xs sm:text-sm block text-slate-900 group-hover:text-purple-900 transition-colors">حالات المعمل</span>
              <span className="text-[10px] sm:text-[11px] text-slate-500 font-medium block leading-tight mt-0.5">تركيبات وطربوش</span>
            </div>
          </button>
        </div>
      </div>

      {/* Main Mobile Navigation Tabs */}
      <div className="bg-white rounded-2xl p-1.5 border border-slate-200 shadow-xs grid grid-cols-3 text-xs font-bold gap-1">
        <button
          type="button"
          onClick={() => setActiveTab('today')}
          disabled={!permissions.appointments}
          aria-pressed={activeTab === 'today'}
          className={`flex-1 py-2.5 rounded-xl transition-all text-center cursor-pointer flex items-center justify-center gap-1.5 ${
            activeTab === 'today' ? 'bg-slate-900 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Clock className="w-4 h-4 text-emerald-400" />
          <span>مواعيد اليوم</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('payments')}
          disabled={!permissions.patientView}
          aria-pressed={activeTab === 'payments'}
          className={`flex-1 py-2.5 rounded-xl transition-all text-center cursor-pointer flex items-center justify-center gap-1.5 ${
            activeTab === 'payments' ? 'bg-indigo-900 text-white shadow-xs' : 'text-slate-700 hover:bg-indigo-50 font-black'
          }`}
        >
          <Users className="w-4 h-4 text-indigo-400" />
          <span>المرضى</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('lab')}
          disabled={!permissions.lab}
          aria-pressed={activeTab === 'lab'}
          className={`flex-1 py-2.5 rounded-xl transition-all text-center cursor-pointer flex items-center justify-center gap-1.5 ${
            activeTab === 'lab' ? 'bg-slate-900 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Microscope className="w-4 h-4 text-purple-400" />
          <span>المعمل</span>
        </button>
      </div>

      {/* TAB 1: TODAY'S QUEUE & APPOINTMENTS */}
      {activeTab === 'today' && permissions.appointments && (
        <div className="bg-white rounded-3xl p-5 border border-slate-200 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3.5">
            <div className="space-y-0.5">
              <h2 className="text-base font-extrabold text-slate-900">جدول كشوفات ومواعيد اليوم ({todayStr})</h2>
              <p className="text-xs text-slate-500 font-medium">متابعة الحضور وفتح رسالة تذكير للمراجعة والإرسال من واتساب</p>
            </div>
            {permissions.appointments && (
              <button
                type="button"
                onClick={handleOpenAppointmentModal}
                className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-extrabold cursor-pointer transition-all shadow-xs flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 active:scale-98"
              >
                <Plus className="w-4 h-4" />
                <span>حجز موعد جديد</span>
              </button>
            )}
          </div>

          {todayAppointments.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-xs bg-slate-50 rounded-2xl border border-slate-200">
              لا توجد مواعيد مسجلة بتاريخ اليوم ({todayStr}). يمكنك حجز موعد جديد بالضغط أعلاه.
            </div>
          ) : (
            <div className="space-y-3">
              {todayAppointments.map(appt => {
                const statusCfg = APPOINTMENT_STATUS_CONFIGS[appt.status] || APPOINTMENT_STATUS_CONFIGS['scheduled'];
                const StatusIcon = statusCfg.icon;

                return (
                  <div
                    key={appt.id}
                    className={`p-3.5 sm:p-4 rounded-2xl border transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs ${
                      appt.status === 'attended'
                        ? 'bg-emerald-50/80 border-emerald-200'
                        : appt.status === 'no_show'
                        ? 'bg-rose-50/80 border-rose-200'
                        : appt.status === 'apologized'
                        ? 'bg-orange-50/80 border-orange-200'
                        : appt.status === 'waiting'
                        ? 'bg-amber-50/80 border-amber-200'
                        : 'bg-white border-slate-200 shadow-2xs'
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-extrabold text-slate-900 text-sm">{appt.patientName}</span>
                        <span className="font-mono bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md text-[11px]">
                          {format12HourTime(appt.time)}
                        </span>
                        {appt.isWalkIn && (
                          <span className="bg-amber-100 text-amber-900 text-[10px] font-bold px-2 py-0.5 rounded-md">
                            حضور بدون حجز مسبق
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-500 flex-wrap">
                        {appt.mobile && <span dir="ltr" className="font-mono text-slate-600">{appt.mobile}</span>}
                        {appt.note && <span className="break-words">{appt.note}</span>}
                      </div>
                    </div>

                    {/* Actions Bar */}
                    <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap justify-end border-t sm:border-t-0 pt-2 sm:pt-0">
                      {/* Status Selector Pill Button */}
                      {permissions.appointments && (
                        <button
                          type="button"
                          onClick={() => setSecStatusModalAppt(appt)}
                          className={`px-3 py-2 min-h-[44px] rounded-xl text-xs font-extrabold flex items-center justify-center gap-1.5 transition-all cursor-pointer border active:scale-95 touch-manipulation ${statusCfg.badgeBg}`}
                          title="تعديل حالة الموعد"
                        >
                          <StatusIcon className="w-3.5 h-3.5 shrink-0" />
                          <span>{statusCfg.label}</span>
                          <ChevronDown className="w-3 h-3 opacity-60 shrink-0" />
                        </button>
                      )}

                      {/* Direct Phone Call Button */}
                      <button
                        type="button"
                        onClick={() => {
                          const phone = cleanEgyptianPhone(appt.mobile || '');
                          if (/^[1-9]\d{7,14}$/.test(phone)) {
                            window.location.href = `tel:+${phone}`;
                          } else {
                            showToast('لا يوجد رقم هاتف صحيح مسجل للمريض', 'warning');
                          }
                        }}
                        className="px-3 py-2 min-h-[44px] rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-800 font-bold text-xs flex items-center justify-center gap-1 transition-all border border-indigo-200 cursor-pointer active:scale-95 touch-manipulation"
                        title="اتصال هاتفي مباشر"
                      >
                        <Phone className="w-3.5 h-3.5 text-indigo-600" />
                        <span>اتصال</span>
                      </button>
                      <button type="button" disabled={['cancelled', 'apologized', 'no_show', 'attended'].includes(appt.status)} onClick={() => openWhatsAppReminder(appt.mobile, appt.patientName, format12HourTime(appt.time))} className="px-3 py-2 min-h-[44px] rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-bold text-xs flex items-center justify-center gap-1 border border-emerald-200 disabled:opacity-40 disabled:cursor-not-allowed">
                        <MessageCircle className="w-3.5 h-3.5" />
                        <span>تذكير واتساب</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: PATIENT SEARCH & QUICK FINANCIAL PAYMENTS */}
      {activeTab === 'payments' && permissions.patientView && (
        <div className="bg-white rounded-3xl p-4 sm:p-5 border border-slate-200 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-base font-black text-slate-900 flex items-center gap-2">
                <span>فهرس المرضى</span>
                <span className="bg-indigo-100 text-indigo-900 text-xs px-2.5 py-0.5 rounded-full font-bold">
                  {filteredPatients.length} من أصل {patients.length}
                </span>
              </h2>
              <p className="text-xs text-slate-500 font-medium">البحث المباشر بالاسم، الهاتف، أو رقم الملف للوصول الفوري لملف الحالة الطبي</p>
            </div>

            {permissions.patientEdit && (
              <button
                type="button"
                onClick={handleOpenNewPatientModal}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs flex items-center justify-center gap-1.5 shadow-xs cursor-pointer active:scale-95 transition-all self-start sm:self-auto"
              >
                <UserPlus className="w-4 h-4" />
                <span>إضافة مريض جديد</span>
              </button>
            )}
          </div>

          {/* Patient Quick Search Input */}
          <div className="relative">
            <Search className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={patientSearch}
              onChange={e => setPatientSearch(e.target.value)}
                aria-label="البحث في ملفات المرضى"
              placeholder="ابحث باسم المريض أو رقم الموبايل أو رقم الملف..."
              className="w-full pr-10 pl-9 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-xs sm:text-sm font-bold focus:outline-none focus:bg-white focus:border-indigo-600 focus:ring-2 focus:ring-indigo-100 transition-all"
            />
            {patientSearch && (
              <button
                type="button"
                onClick={() => setPatientSearch('')}
                aria-label="مسح البحث"
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1 cursor-pointer hover:bg-slate-200/60 rounded-lg transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="divide-y divide-slate-100 border border-slate-200 rounded-2xl overflow-hidden">
            {filteredPatients.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-xs bg-slate-50">
                لا توجد حالات تطابق البحث. تأكد من الاسم أو قم بفتح ملف جديد.
              </div>
            ) : (
              filteredPatients.map(patient => {
                const financial = getPatientFinancialSummary(patient);
                const totalReq = Math.max(0, financial.totalRequired - financial.totalDiscounts);
                const totalPaid = financial.totalCollected;
                const remain = financial.totalRemaining;

                return (
                  <div key={patient.id} className="p-3.5 sm:p-4 bg-white hover:bg-slate-50/80 transition-colors flex flex-col md:flex-row items-start md:items-center justify-between gap-3 text-xs">
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-black text-slate-900 text-sm sm:text-base">{patient.name}</span>
                        <span className="font-mono text-xs bg-indigo-100 text-indigo-900 px-2 py-0.5 rounded-md font-bold">
                          #{patient.id}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 font-medium">
                        📱 موبايل: {patient.mobile || '—'} | 🎂 العمر: {patient.age || '—'}
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between md:justify-end gap-3 w-full md:w-auto border-t md:border-t-0 pt-2 md:pt-0">
                      {canViewRemaining && <div className="w-full sm:w-60">
                        <BalanceProgressMeter
                          total={totalReq}
                          paid={totalPaid}
                          remaining={remain}
                          size="sm"
                          type="patient"
                        />
                      </div>}

                      <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto justify-end">
                        {canRegisterPayments && remain > 0 && (
                          <button
                            type="button"
                            onClick={() => handleOpenPaymentModal(patient)}
                            className="px-3 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-black text-[11px] cursor-pointer shadow-2xs flex items-center gap-1 transition-all active:scale-95 touch-manipulation"
                          >
                            <DollarSign className="w-3.5 h-3.5 text-amber-100" />
                            <span>تحصيل</span>
                          </button>
                        )}

                        {permissions.patientView && (
                          <button
                            type="button"
                            onClick={() => onSelectPatient(patient.id, 'patients')}
                            className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-[11px] cursor-pointer shadow-xs flex items-center gap-1.5 transition-all active:scale-95 touch-manipulation"
                          >
                            <FolderOpen className="w-3.5 h-3.5" />
                            <span>فتح ملف الحالة</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* TAB 3: LAB CASES & PICKUPS */}
      {activeTab === 'lab' && permissions.lab && (
        <div className="bg-white rounded-3xl p-5 border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-base font-bold text-slate-900">متابعة تركيبات وحالات المعمل</h2>
              <p className="text-xs text-slate-500">متابعة استلام التركيبات وحالة تسليمها للمرضى</p>
            </div>
          </div>

          {labCases.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-xs bg-slate-50 rounded-2xl border border-slate-200">
              لا توجد حالات معمل مسجلة حالياً بالعيادة.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 border border-slate-200 rounded-2xl overflow-hidden">
              {labCases.map(lc => (
                <div key={lc.id} className="p-4 bg-white flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-900 text-sm">{lc.patientName}</span>
                      <span className="bg-purple-100 text-purple-900 text-[10px] font-bold px-2 py-0.5 rounded-md">
                        {lc.type} - {lc.subType} ({lc.units} وحدة)
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      🔬 المعمل: <b>{lc.labName}</b> | 📅 تاريخ الإرسال: {lc.date}
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${
                      lc.status === 'completed' || lc.status === 'delivered'
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-amber-100 text-amber-800'
                    }`}>
                      {{ completed: 'تم تسليمها للمريض', delivered: 'وصلت العيادة', ready: 'جاهزة للاستلام', delayed: 'متأخرة', pending: 'قيد العمل في المعمل' }[lc.status] || 'قيد المتابعة'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* MODAL 1: ADD APPOINTMENT */}
      {isApptModalOpen && permissions.appointments && (
        <div className="clinic-modal-overlay fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-xs p-0 sm:p-4 animate-fadeIn">
          <div ref={appointmentDialogRef} role="dialog" aria-modal="true" aria-labelledby="secretary-appointment-title" tabIndex={-1} className="clinic-modal-panel bg-white rounded-t-3xl sm:rounded-3xl max-w-md w-full p-5 sm:p-6 shadow-2xl border border-slate-200 space-y-4 max-h-[92dvh] sm:max-h-[90dvh] overflow-y-auto modal-scroll">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 id="secretary-appointment-title" className="text-base font-extrabold text-slate-900">حجز موعد جديد</h3>
              <button
                type="button"
                onClick={() => setIsApptModalOpen(false)}
                className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-colors cursor-pointer min-h-[44px]"
              >
                إلغاء وإغلاق
              </button>
            </div>

            <form onSubmit={handleSaveNewAppointment} className="space-y-3.5 text-xs">
              <div>
                <label htmlFor="secretary-appointment-patient" className="block font-bold text-slate-700 mb-1">ملف المريض <span className="text-rose-500">*</span></label>
                <select
                  id="secretary-appointment-patient"
                  data-dialog-autofocus
                  required
                  value={apptPatientId}
                  onChange={e => setApptPatientId(e.target.value)}
                  className="w-full px-3.5 py-2.5 min-h-[44px] bg-slate-50 border border-slate-300 rounded-xl text-sm font-bold focus:outline-none focus:border-emerald-600"
                >
                  <option value="">اختر المريض من الملفات المسجلة</option>
                  {patients.map(patient => <option key={patient.id} value={patient.id}>{patient.name} — ملف #{patient.id}</option>)}
                </select>
                <p className="text-xs text-slate-500 mt-1">إذا كان المريض جديدًا، سجّل ملفه أولًا من زر «تسجيل مريض».</p>
              </div>

              <div>
                <label htmlFor="secretary-appointment-mobile" className="block font-bold text-slate-700 mb-1">رقم الهاتف من ملف المريض</label>
                <input
                  id="secretary-appointment-mobile"
                  type="tel"
                  value={patients.find(patient => patient.id === apptPatientId)?.mobile || ''}
                  readOnly
                  placeholder="اختر المريض لعرض رقمه"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono focus:outline-none focus:border-emerald-600"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">تاريخ الحجز</label>
                  <input
                    type="date"
                    required
                    value={apptDate}
                    onChange={e => setApptDate(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono focus:outline-none focus:border-emerald-600"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">الوقت</label>
                  <input
                    type="time"
                    required
                    value={apptTime}
                    onChange={e => setApptTime(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono focus:outline-none focus:border-emerald-600"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 p-2.5 bg-amber-50 rounded-xl border border-amber-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={apptIsWalkIn}
                  onChange={e => setApptIsWalkIn(e.target.checked)}
                  className="w-4 h-4 rounded text-amber-600"
                />
                <span className="font-bold text-amber-950">وصل للعيادة بدون حجز مسبق</span>
              </label>

              <div>
                <label className="block font-bold text-slate-700 mb-1">ملاحظات الحجز</label>
                <input
                  type="text"
                  value={apptNote}
                  onChange={e => setApptNote(e.target.value)}
                  placeholder="نوع الشكوى أو اسم الخدمة..."
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:outline-none focus:border-emerald-600"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsApptModalOpen(false)}
                  className="px-4 py-2 min-h-[44px] font-semibold text-slate-600 bg-slate-100 rounded-xl cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 min-h-[44px] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-md cursor-pointer"
                >
                  حفظ الموعد
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: ADD NEW PATIENT */}
      {isNewPatientModalOpen && permissions.patientEdit && (
        <div className="clinic-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-fadeIn">
          <div ref={newPatientDialogRef} role="dialog" aria-modal="true" aria-labelledby="secretary-new-patient-title" tabIndex={-1} className="clinic-modal-panel bg-white rounded-3xl max-w-md w-full p-5 sm:p-6 shadow-2xl border border-slate-200 space-y-4 max-h-[90dvh] overflow-y-auto modal-scroll">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 id="secretary-new-patient-title" className="text-base font-bold text-slate-900">فتح ملف مريض جديد</h3>
              <button type="button" onClick={() => setIsNewPatientModalOpen(false)} aria-label="إلغاء وإغلاق" className="text-slate-400 hover:text-slate-600 cursor-pointer min-w-[44px] min-h-[44px] flex items-center justify-center"><X className="w-5 h-5" /></button>
            </div>

            <form onSubmit={handleCreateNewPatient} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  رقم الملف الورقي <span className="text-rose-500">*</span> <span className="text-slate-400 font-normal text-[11px]">(مقتَرح تلقائياً بعد آخر ملف ويمكن تعديله)</span>
                </label>
                <input
                  type="text"
                  required
                  data-dialog-autofocus
                  inputMode="numeric"
                  value={newPatientFileNo}
                  onChange={e => setNewPatientFileNo(e.target.value)}
                  placeholder="مثال: 106"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl font-bold font-mono text-indigo-900 focus:outline-none focus:border-indigo-600"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">اسم المريض <span className="text-rose-500">*</span></label>
                <input
                  type="text"
                  required
                  value={newPatientName}
                  onChange={e => setNewPatientName(e.target.value)}
                  placeholder="أكتب الاسم الكامل..."
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl font-bold focus:outline-none focus:border-indigo-600"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">رقم الموبايل</label>
                  <input
                    type="tel"
                    value={newPatientMobile}
                    onChange={e => setNewPatientMobile(e.target.value)}
                    placeholder="010xxxxxxx"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono focus:outline-none focus:border-indigo-600"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">العمر (بالسنوات)</label>
                  <input
                    type="number"
                    min="0"
                    max="130"
                    step="1"
                    value={newPatientAge}
                    onChange={e => setNewPatientAge(e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="اختياري"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono focus:outline-none focus:border-indigo-600"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">ملاحظات أولية من الاستقبال</label>
                <input
                  type="text"
                  value={newPatientNotes}
                  onChange={e => setNewPatientNotes(e.target.value)}
                  placeholder="مصدر المعرفة، الشكوى الرئيسية..."
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:outline-none focus:border-indigo-600"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsNewPatientModalOpen(false)}
                  className="px-4 py-2 min-h-[44px] font-semibold text-slate-600 bg-slate-100 rounded-xl cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 min-h-[44px] rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold shadow-md cursor-pointer"
                >
                  إنشاء الملف
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: QUICK FINANCIAL COLLECTION */}
      {isPaymentModalOpen && canRegisterPayments && (
        <div className="clinic-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-fadeIn">
          <div ref={paymentDialogRef} role="dialog" aria-modal="true" aria-labelledby="secretary-payment-title" tabIndex={-1} className="clinic-modal-panel bg-white rounded-3xl max-w-md w-full p-5 sm:p-6 shadow-2xl border border-slate-200 space-y-4 max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center font-bold">
                  <DollarSign className="w-4 h-4" />
                </div>
                <h3 id="secretary-payment-title" className="text-base font-bold text-slate-900">تحصيل دفعة نقدية</h3>
              </div>
              <button 
                type="button"
                onClick={() => {
                  setIsPaymentModalOpen(false);
                  setPaySearchQuery('');
                }} 
                className="px-3 py-2 min-h-[44px] shrink-0 rounded-xl bg-slate-100 text-slate-500 hover:text-slate-800 cursor-pointer font-bold text-xs"
              >
                إلغاء وإغلاق
              </button>
            </div>

            <form onSubmit={handleConfirmQuickPayment} className="space-y-4 text-xs">
              {/* Patient Selection Header */}
              <div>
                <label className="block font-bold text-slate-800 mb-1.5">
                  تحديد المريض (برقم الملف أو الاسم أو الهاتف) <span className="text-rose-500">*</span>
                </label>

                {selectedPaymentPatient ? (
                  /* Selected Patient Card */
                  <div className="p-3.5 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-300 rounded-2xl flex items-center justify-between gap-3 shadow-xs">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-extrabold text-slate-900 text-sm">{selectedPaymentPatient.name}</span>
                        <span className="font-mono bg-amber-600 text-white font-extrabold px-2 py-0.5 rounded-md text-[11px]">
                          ملف #{selectedPaymentPatient.id}
                        </span>
                      </div>
                      <div className="text-xs text-slate-600 flex items-center gap-3 flex-wrap">
                        <span>📱 {selectedPaymentPatient.mobile || 'بدون هاتف'}</span>
                        {canViewRemaining && <span className="font-bold text-amber-900">
                          إجمالي المتبقي: {getPatientFinancialSummary(selectedPaymentPatient).totalRemaining.toLocaleString()} ج.م
                        </span>}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setPayPatientId('');
                        setPaySessionId('');
                        setPayAmount('');
                        setPaySearchQuery('');
                      }}
                      className="px-3 py-1.5 rounded-xl bg-white border border-amber-300 text-amber-900 hover:bg-amber-100 font-bold text-[11px] cursor-pointer shrink-0 transition-colors shadow-2xs"
                    >
                      تغيير المريض
                    </button>
                  </div>
                ) : (
                  /* Patient Search Input & Live Suggestion List */
                  <div className="space-y-2">
                    <div className="relative">
                      <Search className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-amber-600 pointer-events-none" />
                      <input
                        type="text"
                        data-dialog-autofocus
                        value={paySearchQuery}
                        onChange={e => setPaySearchQuery(e.target.value)}
                        placeholder="ابحث برقم الملف (مثل 101)، الاسم، أو رقم الهاتف..."
                        className="w-full pr-10 pl-8 py-2.5 bg-amber-50/50 border border-amber-300 rounded-2xl text-xs font-bold focus:outline-none focus:bg-white focus:border-amber-600 shadow-2xs"
                      />
                      {paySearchQuery && (
                        <button
                          type="button"
                          onClick={() => setPaySearchQuery('')}
                          aria-label="مسح البحث"
                          className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 font-bold text-xs"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>

                    {/* Filtered Patients List */}
                    <div className="border border-slate-200 rounded-2xl overflow-hidden divide-y divide-slate-100 max-h-52 overflow-y-auto bg-slate-50/80 shadow-inner">
                      {matchedPayPatients.length === 0 ? (
                        <div className="p-4 text-center text-slate-500 font-medium text-xs">
                          لا يوجد مريض مطابق لـ "{paySearchQuery}"
                        </div>
                      ) : (
                        matchedPayPatients.map(p => {
                          const totalRemain = getPatientFinancialSummary(p).totalRemaining;
                          return (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => {
                                setPayPatientId(p.id);
                                const unpaidSession = p.sessions.find(s => sessionRemaining(s) > 0);
                                setPaySessionId(unpaidSession?.id || '');
                                setPayAmount('');
                              }}
                              className="w-full text-right p-3 bg-white hover:bg-amber-100/70 cursor-pointer transition-colors flex items-center justify-between gap-2 active:bg-amber-200"
                            >
                              <div className="flex items-center gap-2.5 overflow-hidden">
                                <span className="font-mono bg-amber-100 text-amber-900 font-extrabold px-2.5 py-1 rounded-xl text-xs shrink-0 border border-amber-200">
                                  #{p.id}
                                </span>
                                <div className="truncate">
                                  <span className="font-extrabold text-slate-900 text-xs block truncate">{p.name}</span>
                                  <span className="text-[11px] text-slate-500 block font-mono">📱 {p.mobile || 'بدون هاتف'}</span>
                                </div>
                              </div>

                              {canViewRemaining && <div className="text-left shrink-0">
                                <span className={`text-[10px] font-bold px-2.5 py-1 rounded-lg block ${
                                  totalRemain > 0 ? 'bg-amber-100 text-amber-900 border border-amber-200' : 'bg-emerald-100 text-emerald-800'
                                }`}>
                                  {totalRemain > 0 ? `متبقي: ${totalRemain.toLocaleString()} ج.م` : 'خالص الحساب'}
                                </span>
                              </div>}
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Session Selector (shown when patient is selected) */}
              {selectedPaymentPatient && (
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    الجلسة المستحقة <span className="text-rose-500">*</span>
                  </label>
                  {selectedPaymentPatient.sessions.filter(session => sessionRemaining(session) > 0).length === 0 ? (
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-[11px] flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                      <span>لا توجد جلسات بمبالغ مستحقة للتحصيل لهذا المريض.</span>
                    </div>
                  ) : (
                    <select
                      value={paySessionId}
                      onChange={e => {
                        setPaySessionId(e.target.value);
                        const s = selectedPaymentPatient.sessions.find(x => x.id === e.target.value);
                        if (s && canViewRemaining && sessionRemaining(s) > 0) setPayAmount(Math.min(sessionRemaining(s), getPatientFinancialSummary(selectedPaymentPatient).totalRemaining));
                        else setPayAmount('');
                      }}
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl font-bold focus:outline-none focus:border-amber-600 text-xs"
                    >
                      <option value="">-- اختر الجلسة المراد تحصيل قسطها --</option>
                      {selectedPaymentPatient.sessions.filter(session => sessionRemaining(session) > 0).map(s => (
                        <option key={s.id} value={s.id}>
                          {s.type} (تاريخ {s.date}){canViewRemaining ? ` — متبقي: ${sessionRemaining(s).toLocaleString()} ج.م` : ''}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {/* Payment Amount Input */}
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  المبلغ المحصل الآن (ج.م) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="number"
                  required
                  min="0.01"
                  step="0.01"
                  value={payAmount}
                  onChange={e => setPayAmount(e.target.value === '' ? '' : parseFloat(e.target.value))}
                  placeholder="0"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono font-bold focus:outline-none focus:border-amber-600 text-sm"
                />
              </div>
              <p className="text-xs text-slate-500">تاريخ التحصيل: {todayStr}. تُسجّل هذه الدفعة نقديًا في تحصيلات اليوم.</p>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setIsPaymentModalOpen(false);
                    setPaySearchQuery('');
                  }}
                  className="px-4 py-2.5 font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer text-xs transition-colors"
                >
                  إلغاء وإغلاق
                </button>
                <button
                  type="submit"
                  disabled={!payPatientId || !paySessionId || !canRegisterPayments}
                  className={`px-5 py-2.5 rounded-xl text-white font-extrabold text-xs shadow-md transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                    payPatientId
                      ? 'bg-amber-600 hover:bg-amber-700 shadow-amber-600/20 active:scale-98'
                      : 'bg-slate-300 cursor-not-allowed'
                  }`}
                >
                  تأكيد وحفظ التحصيل
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Appointment Status Modal for Secretary View */}
      <AppointmentStatusModal
        appointment={secStatusModalAppt}
        onClose={() => setSecStatusModalAppt(null)}
        onSelectStatus={handleSecSelectStatus}
      />
    </div>
  );
});

SecretaryDeskView.displayName = 'SecretaryDeskView';
