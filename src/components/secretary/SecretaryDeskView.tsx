import React, { useState, useMemo } from 'react';
import { 
  Calendar, Users, DollarSign, Plus, CheckCircle2, XCircle, Clock, 
  Search, UserPlus, Phone, ShieldCheck, ArrowRight, MessageCircle, 
  CreditCard, Microscope, Smartphone, AlertCircle, Receipt, ChevronLeft, User as UserIcon,
  Eye, EyeOff, FolderOpen, X, ChevronDown
} from 'lucide-react';
import { Patient, Appointment, LabCase, User, NavigationOrigin, ActiveView, AppointmentStatus } from '../../types';
import { useToastAndConfirm } from '../common/ToastAndConfirm';
import { BalanceProgressMeter, CompactBalanceBadge } from '../common/FinancialBadge';
import { AppointmentStatusModal, APPOINTMENT_STATUS_CONFIGS } from '../appointments/AppointmentStatusModal';

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
  onAddPaymentInstallment: (patientId: string, sessionId: string, amount: number) => void;
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
  const { showToast } = useToastAndConfirm();
  const permissions = currentUser?.permissions || {
    patientView: true,
    patientEdit: true,
    deletePatients: false,
    patientFinance: true,
    appointments: true,
    lab: true,
    labProfit: false,
    summary: false,
    controlPanel: false
  };

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  // Active Mobile Tab
  const [activeTab, setActiveTab] = useState<'today' | 'payments' | 'new-patient' | 'lab'>('today');

  // Today's Collection Privacy Toggle
  const [showCollection, setShowCollection] = useState<boolean>(false);

  // Search & Filters
  const [patientSearch, setPatientSearch] = useState('');

  // Modals state
  const [isApptModalOpen, setIsApptModalOpen] = useState(false);
  const [isNewPatientModalOpen, setIsNewPatientModalOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);

  React.useEffect(() => {
    const isAnyModalOpen = isApptModalOpen || isNewPatientModalOpen || isPaymentModalOpen;
    if (isAnyModalOpen) {
      document.body.classList.add('modal-open');
    } else {
      document.body.classList.remove('modal-open');
    }
    return () => {
      document.body.classList.remove('modal-open');
    };
  }, [isApptModalOpen, isNewPatientModalOpen, isPaymentModalOpen]);

  // New Appointment Form State
  const [apptPatientId, setApptPatientId] = useState('');
  const [apptPatientName, setApptPatientName] = useState('');
  const [apptMobile, setApptMobile] = useState('');
  const [apptDate, setApptDate] = useState(todayStr);
  const [apptTime, setApptTime] = useState('17:00');
  const [apptNote, setApptNote] = useState('');
  const [apptIsWalkIn, setApptIsWalkIn] = useState(false);

  // Status Selector Modal State
  const [secStatusModalAppt, setSecStatusModalAppt] = useState<Appointment | null>(null);

  const handleSecSelectStatus = (newStatus: AppointmentStatus) => {
    if (!secStatusModalAppt) return;
    onUpdateApptStatus(secStatusModalAppt.id, newStatus);
    const cfg = APPOINTMENT_STATUS_CONFIGS[newStatus];
    showToast(`تم تحديث حالة الموعد إلى (${cfg ? cfg.label : newStatus}) بنجاح`, 'success');
    setSecStatusModalAppt(null);
  };

  // Auto suggest next file number
  const getNextFileNo = () => {
    const numericIds = patients
      .map(p => {
        const match = p.id.match(/\d+/);
        return match ? parseInt(match[0], 10) : NaN;
      })
      .filter(n => !isNaN(n));
    if (numericIds.length === 0) return '101';
    return (Math.max(...numericIds) + 1).toString();
  };

  // New Patient Form State
  const [newPatientFileNo, setNewPatientFileNo] = useState('');
  const [newPatientName, setNewPatientName] = useState('');
  const [newPatientMobile, setNewPatientMobile] = useState('');
  const [newPatientAge, setNewPatientAge] = useState<number | ''>('');
  const [newPatientNotes, setNewPatientNotes] = useState('');

  const handleOpenNewPatientModal = () => {
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

  // Today's Appointments
  const todayAppointments = useMemo(() => {
    return appointments.filter(a => a.date === todayStr);
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
    const q = patientSearch.trim().toLowerCase();
    if (!q) return patients.slice(0, 15);
    return patients.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.id.includes(q) ||
      p.mobile.includes(q)
    );
  }, [patients, patientSearch]);

  // Handlers
  const handleSaveNewAppointment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!permissions.appointments) {
      showToast('ليس لديك صلاحية تسجيل المواعيد', 'error');
      return;
    }
    if (!apptPatientName.trim()) {
      showToast('يرجى كتابة اسم المريض', 'warning');
      return;
    }

    onSaveAppointment({
      patientId: apptPatientId || `p_${Date.now()}`,
      fileNo: apptPatientId || 'جديد',
      patientName: apptPatientName.trim(),
      mobile: apptMobile.trim(),
      date: apptDate,
      time: apptTime,
      note: apptNote.trim(),
      isFollowUp: false,
      isWalkIn: apptIsWalkIn,
      status: 'scheduled'
    });

    setIsApptModalOpen(false);
    setApptPatientName('');
    setApptMobile('');
    setApptNote('');
    showToast('تم حجز الموعد بنجاح في جدول المواعيد', 'success');
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

    const fileNo = newPatientFileNo.trim() || getNextFileNo();
    const isDuplicate = patients.some(p => p.id.trim() === fileNo);
    if (isDuplicate) {
      showToast(`رقم الملف (${fileNo}) مستخدم بالفعل لحالة أخرى`, 'warning');
      return;
    }

    const newPatient: Patient = {
      id: fileNo,
      name: newPatientName.trim(),
      mobile: newPatientMobile.trim(),
      age: typeof newPatientAge === 'number' ? newPatientAge : 25,
      firstVisit: todayStr,
      notes: newPatientNotes.trim(),
      allergy: 'لا يوجد',
      sessions: [],
      payments: []
    };

    onSavePatient(newPatient);
    setIsNewPatientModalOpen(false);
    setNewPatientName('');
    setNewPatientMobile('');
    setNewPatientAge('');
    setNewPatientNotes('');
    showToast(`تم فتح الملف برقم #${fileNo} والدخول للملف مباشرة`, 'success');

    // Automatically open patient file!
    onSelectPatient(fileNo, { view: 'secretary' });
  };

  const handleConfirmQuickPayment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!permissions.patientFinance) {
      showToast('ليس لديك صلاحية التحصيل والتحكم المالي', 'error');
      return;
    }
    if (!payPatientId) {
      showToast('يرجى اختيار المريض المراد التحصيل منه أولاً', 'warning');
      return;
    }
    const targetPatient = patients.find(p => p.id === payPatientId);
    let targetSessionId = paySessionId;
    if (!targetSessionId && targetPatient && targetPatient.sessions.length > 0) {
      targetSessionId = targetPatient.sessions[0].id;
    }
    if (!targetSessionId) {
      showToast('لا توجد جلسات علاجية مسجلة بهذا الملف بعد', 'warning');
      return;
    }
    const amt = typeof payAmount === 'number' ? payAmount : 0;
    if (amt <= 0) {
      showToast('يرجى كتابة مبلغ تحصيل صحيح أكبر من صفر', 'warning');
      return;
    }

    onAddPaymentInstallment(payPatientId, targetSessionId, amt);
    setIsPaymentModalOpen(false);
    setPayAmount('');
    setPaySearchQuery('');
    showToast('تم تسجيل تحصيل المبلغ وإضافة القسط بنجاح', 'success');
  };

  const openWhatsAppReminder = (mobile: string, name: string, time: string) => {
    if (!mobile) {
      showToast('لا يوجد رقم موبايل مسجل لهذا المريض', 'warning');
      return;
    }
    const cleanNum = mobile.replace(/[^0-9]/g, '');
    const num = cleanNum.startsWith('0') ? `20${cleanNum.slice(1)}` : cleanNum;
    const msg = `أهلاً بك أستاذ/ة ${name}، نذكركم بموعدكم اليوم بـ ${clinicName} الساعة ${time}. نتمنى لكم السلامة دائماً.`;
    window.open(`https://wa.me/${num}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  // Today's Calculations for Stats Bar
  const todayPatientsCount = new Set([
    ...todayAppointments.map(a => a.patientName || a.patientId),
    ...patients.filter(p => p.firstVisit === todayStr).map(p => p.name)
  ]).size;

  const todayCollectionTotal = patients.reduce((acc, p) => {
    const todayPays = p.payments?.filter(pay => pay.date === todayStr) || [];
    return acc + todayPays.reduce((sum, item) => sum + item.amount, 0);
  }, 0);

  return (
    <div className="space-y-3.5 max-w-5xl mx-auto py-2 font-tajawal select-none">
      {/* 1. Ultra-Compact Streamlined Welcome Bar (No bloated permissions tags) */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-3 sm:p-3.5 shadow-2xs">
        <div className="flex items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={onBackToHome}
              className="p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer shrink-0 active:scale-95 touch-manipulation"
              title="العودة لشاشة الرئيسية"
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
          onClick={() => setShowCollection(prev => !prev)}
          className="bg-white hover:bg-emerald-50/40 border border-slate-200/90 hover:border-emerald-300 rounded-2xl p-3 shadow-2xs flex flex-col justify-between min-h-[76px] text-right transition-all cursor-pointer active:scale-96 touch-manipulation"
          title={showCollection ? 'إخفاء المبلغ للخصوصية' : 'اضغط لإظهار التحصيل المالي'}
        >
          <div className="flex items-center justify-between text-slate-500 text-[11px] font-bold w-full">
            <span className="flex items-center gap-1 text-slate-700">
              تحصيل اليوم
            </span>
            <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex items-center justify-center shrink-0 shadow-xs">
              {showCollection ? <EyeOff className="w-3.5 h-3.5 text-white" /> : <Eye className="w-3.5 h-3.5 text-white" />}
            </div>
          </div>
          <div className="mt-1 font-mono">
            {showCollection ? (
              <div className="text-sm sm:text-base font-black text-emerald-700 truncate">
                {todayCollectionTotal.toLocaleString()} <span className="text-[10px] font-sans text-slate-500 font-normal">ج.م</span>
              </div>
            ) : (
              <div className="text-xs sm:text-sm font-bold text-slate-400 tracking-widest flex items-center gap-1">
                <span>•••••</span>
                <span className="text-[9px] font-sans text-slate-400 font-normal">(اضغط)</span>
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
                  const totalReq = patient.sessions.reduce((a, s) => a + s.amount, 0);
                  const totalPaid = patient.sessions.reduce((a, s) => a + s.paid, 0);
                  const remain = totalReq - totalPaid;

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
                          {remain > 0 ? (
                            <span className="text-rose-700 font-bold bg-rose-50 px-1.5 py-0.2 rounded border border-rose-200/60">
                              متبقي: {remain.toLocaleString()} ج.م
                            </span>
                          ) : (
                            <span className="text-emerald-700 font-bold bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-200/60">
                              خالص الحساب
                            </span>
                          )}
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
          <span className="text-[10px] font-medium text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">تصميم سهل بيد واحدة 📱</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
          {/* Action 1: New Appointment */}
          <button
            type="button"
            disabled={!permissions.appointments}
            onClick={() => {
              setApptDate(todayStr);
              setIsApptModalOpen(true);
            }}
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
              <span className="text-[10px] sm:text-[11px] text-slate-500 font-medium block leading-tight mt-0.5">تسجيل كشف جديد</span>
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
            disabled={!permissions.patientFinance}
            onClick={() => setIsPaymentModalOpen(true)}
            className={`p-3.5 sm:p-4 rounded-2xl border text-center transition-all duration-200 flex flex-col items-center justify-center gap-2 cursor-pointer touch-manipulation group relative overflow-hidden ${
              permissions.patientFinance
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
      <div className="bg-white rounded-2xl p-1.5 border border-slate-200 shadow-xs flex items-center justify-between text-xs font-bold gap-1">
        <button
          type="button"
          onClick={() => setActiveTab('today')}
          className={`flex-1 py-2.5 rounded-xl transition-all text-center cursor-pointer flex items-center justify-center gap-1.5 ${
            activeTab === 'today' ? 'bg-slate-900 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Clock className="w-4 h-4 text-emerald-400" />
          <span>جدول اليوم ({todayAppointments.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('payments')}
          className={`flex-1 py-2.5 rounded-xl transition-all text-center cursor-pointer flex items-center justify-center gap-1.5 ${
            activeTab === 'payments' ? 'bg-indigo-900 text-white shadow-xs' : 'text-slate-700 hover:bg-indigo-50 font-black'
          }`}
        >
          <Users className="w-4 h-4 text-indigo-400" />
          <span>📋 فهرس المرضى والبحث</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('lab')}
          className={`flex-1 py-2.5 rounded-xl transition-all text-center cursor-pointer flex items-center justify-center gap-1.5 ${
            activeTab === 'lab' ? 'bg-slate-900 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Microscope className="w-4 h-4 text-purple-400" />
          <span>المعمل</span>
        </button>
      </div>

      {/* TAB 1: TODAY'S QUEUE & APPOINTMENTS */}
      {activeTab === 'today' && (
        <div className="bg-white rounded-3xl p-5 border border-slate-200 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3.5">
            <div className="space-y-0.5">
              <h2 className="text-base font-extrabold text-slate-900">جدول كشوفات ومواعيد اليوم ({todayStr})</h2>
              <p className="text-xs text-slate-500 font-medium">تأكيد حضور المرضى أو إرسال تذكير واتساب بلمسة واحدة</p>
            </div>
            {permissions.appointments && (
              <button
                type="button"
                onClick={() => setIsApptModalOpen(true)}
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
                          ⏰ {appt.time}
                        </span>
                        {appt.isWalkIn && (
                          <span className="bg-amber-100 text-amber-900 text-[10px] font-bold px-2 py-0.5 rounded-md">
                            كشف بدون حجز مسبق (Walk-in)
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-slate-500">
                        {appt.mobile && <span className="dir-ltr font-mono text-slate-600">📱 {appt.mobile}</span>}
                        {appt.note && <span>📝 {appt.note}</span>}
                      </div>
                    </div>

                    {/* Actions Bar */}
                    <div className="flex items-center gap-2 w-full sm:w-auto justify-end border-t sm:border-t-0 pt-2 sm:pt-0">
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
                          if (appt.mobile && appt.mobile.trim()) {
                            window.location.href = `tel:${appt.mobile.replace(/\D/g, '')}`;
                          } else {
                            showToast('لا يوجد رقم هاتف مسجل للمريض', 'warning');
                          }
                        }}
                        className="px-3 py-2 min-h-[44px] rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-800 font-bold text-xs flex items-center justify-center gap-1 transition-all border border-indigo-200 cursor-pointer active:scale-95 touch-manipulation"
                        title="اتصال هاتفي مباشر"
                      >
                        <Phone className="w-3.5 h-3.5 text-indigo-600" />
                        <span>اتصال</span>
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
      {activeTab === 'payments' && (
        <div className="bg-white rounded-3xl p-4 sm:p-5 border border-slate-200 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-base font-black text-slate-900 flex items-center gap-2">
                <span>📋 فهرس سجلات المرضى والحالات</span>
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
              placeholder="ابحث باسم المريض أو رقم الموبايل أو رقم الملف..."
              className="w-full pr-10 pl-9 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-xs sm:text-sm font-bold focus:outline-none focus:bg-white focus:border-indigo-600 focus:ring-2 focus:ring-indigo-100 transition-all"
            />
            {patientSearch && (
              <button
                type="button"
                onClick={() => setPatientSearch('')}
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
                const totalReq = patient.sessions.reduce((a, s) => a + s.amount, 0);
                const totalPaid = patient.sessions.reduce((a, s) => a + s.paid, 0);
                const remain = totalReq - totalPaid;

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
                      <div className="w-full sm:w-60">
                        <BalanceProgressMeter
                          total={totalReq}
                          paid={totalPaid}
                          remaining={remain}
                          size="sm"
                          type="patient"
                        />
                      </div>

                      <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto justify-end">
                        {permissions.patientFinance && remain > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setPayPatientId(patient.id);
                              const unpaidSession = patient.sessions.find(s => s.remain > 0);
                              if (unpaidSession) setPaySessionId(unpaidSession.id);
                              setIsPaymentModalOpen(true);
                            }}
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
      {activeTab === 'lab' && (
        <div className="bg-white rounded-3xl p-5 border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-base font-bold text-slate-900">متابعة تركيبات وحالات المعمل</h2>
              <p className="text-xs text-slate-500">استلام التركيبات وتسليمها للمرضى بالطابق</p>
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
                      {lc.status === 'completed' ? 'تم التسليم والإنهاء' : lc.status === 'delivered' ? 'وصلت العيادة' : 'في المعمل'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* MODAL 1: ADD APPOINTMENT */}
      {isApptModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-xs p-0 sm:p-4 animate-fadeIn">
          <div className="bg-white rounded-t-3xl sm:rounded-3xl max-w-md w-full p-5 sm:p-6 shadow-2xl border border-slate-200 space-y-4 max-h-[92dvh] sm:max-h-[90dvh] overflow-y-auto modal-scroll">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-extrabold text-slate-900">حجز موعد مريض جديد</h3>
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
                <label className="block font-bold text-slate-700 mb-1">اسم المريض <span className="text-rose-500">*</span></label>
                <input
                  type="text"
                  required
                  value={apptPatientName}
                  onChange={e => setApptPatientName(e.target.value)}
                  placeholder="أكتب اسم المريض..."
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl font-bold focus:outline-none focus:border-emerald-600"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">رقم الموبايل (للواتساب)</label>
                <input
                  type="tel"
                  value={apptMobile}
                  onChange={e => setApptMobile(e.target.value)}
                  placeholder="010xxxxxxx"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono focus:outline-none focus:border-emerald-600"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">تاريخ الحجز</label>
                  <input
                    type="date"
                    value={apptDate}
                    onChange={e => setApptDate(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono focus:outline-none focus:border-emerald-600"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">الوقت</label>
                  <input
                    type="time"
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
                <span className="font-bold text-amber-950">حضر للعيادة فوراً بدون حجز مسبق (Walk-in)</span>
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
                  className="px-4 py-2 font-semibold text-slate-600 bg-slate-100 rounded-xl cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-md cursor-pointer"
                >
                  حفظ الموعد
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: ADD NEW PATIENT */}
      {isNewPatientModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-fadeIn">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4 max-h-[90dvh] overflow-y-auto modal-scroll">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">فتح ملف مريض جديد بالاستقبال</h3>
              <button onClick={() => setIsNewPatientModalOpen(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">✕</button>
            </div>

            <form onSubmit={handleCreateNewPatient} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  رقم الملف الورقي <span className="text-rose-500">*</span> <span className="text-slate-400 font-normal text-[11px]">(مقتَرح تلقائياً بعد آخر ملف ويمكن تعديله)</span>
                </label>
                <input
                  type="text"
                  required
                  value={newPatientFileNo}
                  onChange={e => setNewPatientFileNo(e.target.value)}
                  placeholder="مثال: 106"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl font-bold font-mono text-indigo-900 focus:outline-none focus:border-indigo-600"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">الاسم الثلاثي للمريض <span className="text-rose-500">*</span></label>
                <input
                  type="text"
                  required
                  value={newPatientName}
                  onChange={e => setNewPatientName(e.target.value)}
                  placeholder="أكتب الاسم الكامل..."
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl font-bold focus:outline-none focus:border-indigo-600"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
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
                    value={newPatientAge}
                    onChange={e => setNewPatientAge(e.target.value === '' ? '' : parseInt(e.target.value))}
                    placeholder="25"
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
                  className="px-4 py-2 font-semibold text-slate-600 bg-slate-100 rounded-xl cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold shadow-md cursor-pointer"
                >
                  إنشاء الملف
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: QUICK FINANCIAL COLLECTION */}
      {isPaymentModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-fadeIn">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center font-bold">
                  <DollarSign className="w-4 h-4" />
                </div>
                <h3 className="text-base font-bold text-slate-900">تحصيل قسط / دفعة مالية</h3>
              </div>
              <button 
                type="button"
                onClick={() => {
                  setIsPaymentModalOpen(false);
                  setPaySearchQuery('');
                }} 
                className="p-1.5 rounded-xl bg-slate-100 text-slate-500 hover:text-slate-800 cursor-pointer font-bold text-xs"
              >
                إلغاء وإغلاق ✕
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
                      <div className="text-[11px] text-slate-600 flex items-center gap-3">
                        <span>📱 {selectedPaymentPatient.mobile || 'بدون هاتف'}</span>
                        <span className="font-bold text-amber-900">
                          إجمالي المتبقي: {selectedPaymentPatient.sessions.reduce((acc, s) => acc + s.remain, 0).toLocaleString()} ج.م
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setPayPatientId('');
                        setPaySessionId('');
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
                        autoFocus
                        value={paySearchQuery}
                        onChange={e => setPaySearchQuery(e.target.value)}
                        placeholder="ابحث برقم الملف (مثل 101)، الاسم، أو رقم الهاتف..."
                        className="w-full pr-10 pl-8 py-2.5 bg-amber-50/50 border border-amber-300 rounded-2xl text-xs font-bold focus:outline-none focus:bg-white focus:border-amber-600 shadow-2xs"
                      />
                      {paySearchQuery && (
                        <button
                          type="button"
                          onClick={() => setPaySearchQuery('')}
                          className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 font-bold text-xs"
                        >
                          ✕
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
                          const totalRemain = p.sessions.reduce((acc, s) => acc + s.remain, 0);
                          return (
                            <div
                              key={p.id}
                              onClick={() => {
                                setPayPatientId(p.id);
                                const unpaidSession = p.sessions.find(s => s.remain > 0) || p.sessions[p.sessions.length - 1];
                                if (unpaidSession) {
                                  setPaySessionId(unpaidSession.id);
                                  if (unpaidSession.remain > 0) {
                                    setPayAmount(unpaidSession.remain);
                                  }
                                }
                              }}
                              className="p-3 bg-white hover:bg-amber-100/70 cursor-pointer transition-colors flex items-center justify-between gap-2 active:bg-amber-200"
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

                              <div className="text-left shrink-0">
                                <span className={`text-[10px] font-bold px-2.5 py-1 rounded-lg block ${
                                  totalRemain > 0 ? 'bg-amber-100 text-amber-900 border border-amber-200' : 'bg-emerald-100 text-emerald-800'
                                }`}>
                                  {totalRemain > 0 ? `متبقي: ${totalRemain.toLocaleString()} ج.م` : 'خالص الحساب'}
                                </span>
                              </div>
                            </div>
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
                  {selectedPaymentPatient.sessions.length === 0 ? (
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-[11px] flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                      <span>لا توجد جلسات مسجلة لهذا المريض بعد.</span>
                    </div>
                  ) : (
                    <select
                      value={paySessionId}
                      onChange={e => {
                        setPaySessionId(e.target.value);
                        const s = selectedPaymentPatient.sessions.find(x => x.id === e.target.value);
                        if (s && s.remain > 0) setPayAmount(s.remain);
                      }}
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl font-bold focus:outline-none focus:border-amber-600 text-xs"
                    >
                      <option value="">-- اختر الجلسة المراد تحصيل قسطها --</option>
                      {selectedPaymentPatient.sessions.map(s => (
                        <option key={s.id} value={s.id}>
                          {s.type} (تاريخ {s.date}) - متبقي: {s.remain.toLocaleString()} ج.م
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
                  value={payAmount}
                  onChange={e => setPayAmount(e.target.value === '' ? '' : parseFloat(e.target.value))}
                  placeholder="0"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono font-bold focus:outline-none focus:border-amber-600 text-sm"
                />
              </div>

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
                  disabled={!payPatientId}
                  className={`px-5 py-2.5 rounded-xl text-white font-extrabold text-xs shadow-md transition-all cursor-pointer ${
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

