import React, { useState, useMemo, useDeferredValue, useEffect } from 'react';
import { 
  Search, 
  UserPlus, 
  Eye, 
  EyeOff, 
  Edit3, 
  MessageCircle, 
  Trash2, 
  ArrowRight, 
  ShieldAlert, 
  Phone, 
  X, 
  MoreVertical, 
  Calendar, 
  DollarSign, 
  Activity, 
  PhoneCall, 
  FileText, 
  Plus,
  CheckCircle2,
  Copy,
  Microscope,
  Clock,
  UserCheck,
  CreditCard,
  RefreshCw
} from 'lucide-react';
import { Patient, NavigationOrigin, Appointment, LabCase, User, AppointmentStatus } from '../../types';
import { useToastAndConfirm } from '../common/ToastAndConfirm';
import { EmptyState } from '../common/EmptyState';
import { getPatientFinancialSummary } from '../../utils/financials';
import { cleanEgyptianPhone, getWhatsAppUrl as buildWhatsAppUrl } from '../../utils/whatsappUtils';
import { appointmentTimeMinutes, findAppointmentConflicts, isValidAppointmentDate } from '../appointments/appointmentScheduling';

const clinicToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const normalizeDigits = (value: string) => value.replace(/[٠-٩۰-۹]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.includes(digit) ? '٠١٢٣٤٥٦٧٨٩'.indexOf(digit) : '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));

interface PatientsViewProps {
  patients: Patient[];
  appointments?: Appointment[];
  labCases?: LabCase[];
  isPrivacyMode?: boolean;
  currentUser?: User | null;
  onSelectPatient: (patientId: string, origin: NavigationOrigin) => void;
  onSavePatient: (patientData: Omit<Patient, 'sessions' | 'payments'>) => void;
  onDeletePatient: (patientId: string) => void;
  onSaveAppointment?: (appt: Omit<Appointment, 'id'> & { id?: string }) => void;
  onBackToHome: () => void;
}

type FilterChip = 'all' | 'todayAppt' | 'ongoing' | 'debt' | 'allergy' | 'lab' | 'noAppt';

// Utility for highlighting matching search substrings
const highlightText = (text: string, query: string) => {
  if (!query || !query.trim() || !text) return text;
  const q = query.trim().toLowerCase();
  const lower = text.toLowerCase();
  const index = lower.indexOf(q);
  if (index === -1) return text;

  const before = text.substring(0, index);
  const match = text.substring(index, index + q.length);
  const after = text.substring(index + q.length);

  return (
    <>
      {before}
      <mark className="bg-amber-200/90 text-amber-950 font-black rounded px-0.5 py-0 leading-none">
        {match}
      </mark>
      {after}
    </>
  );
};

const getPatientMatchScore = (patient: Patient, q: string): number => {
  if (!q) return 1;
  const cleanQ = q.toLowerCase();
  const id = (patient.id || '').toLowerCase();
  const name = (patient.name || '').toLowerCase();
  const mobile = (patient.mobile || (patient as any).phone || '').replace(/\D/g, '');
  const cleanQMobile = cleanQ.replace(/\D/g, '');

  if (id === cleanQ) return 100;
  if (id.startsWith(cleanQ)) return 90;
  if (name === cleanQ) return 85;
  if (name.startsWith(cleanQ)) return 80;
  if (cleanQMobile && mobile === cleanQMobile) return 75;
  if (cleanQMobile && mobile.includes(cleanQMobile)) return 70;
  if (name.includes(cleanQ)) return 60;
  if (id.includes(cleanQ)) return 50;

  return 0;
};

export const PatientsView: React.FC<PatientsViewProps> = React.memo(({
  patients,
  appointments = [],
  labCases = [],
  isPrivacyMode = true,
  currentUser,
  onSelectPatient,
  onSavePatient,
  onDeletePatient,
  onSaveAppointment,
  onBackToHome
}) => {
  const { showToast, askConfirm, validationFail } = useToastAndConfirm();
  
  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [activeFilter, setActiveFilter] = useState<FilterChip>('all');
  const [showAmounts, setShowAmounts] = useState(!isPrivacyMode);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  useEffect(() => { setShowAmounts(!isPrivacyMode); }, [isPrivacyMode]);

  // Modals & Bottom Sheets State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPatient, setEditingPatient] = useState<Patient | null>(null);

  // Progressive list rendering / Virtualization state for smooth 60FPS scrolling
  const [visibleCount, setVisibleCount] = useState(30);

  useEffect(() => {
    setVisibleCount(30);
  }, [deferredSearchQuery, activeFilter]);

  // Options Bottom Sheet State
  const [activeBottomSheetPatient, setActiveBottomSheetPatient] = useState<Patient | null>(null);

  // Quick Appointment Modal State
  const [quickApptPatient, setQuickApptPatient] = useState<Patient | null>(null);
  const [quickApptDate, setQuickApptDate] = useState<string>(clinicToday());
  const [quickApptTime, setQuickApptTime] = useState<string>('10:00');
  const [quickApptService, setQuickApptService] = useState<string>('كشف واستشارة أسنان');

  // Lock body scroll when modals or bottom sheet are open
  useEffect(() => {
    if (isModalOpen || activeBottomSheetPatient || quickApptPatient) {
      document.body.classList.add('modal-open');
    } else {
      document.body.classList.remove('modal-open');
    }
    return () => {
      document.body.classList.remove('modal-open');
    };
  }, [isModalOpen, activeBottomSheetPatient, quickApptPatient]);

  // Form State for Add / Edit Patient
  const [fileNo, setFileNo] = useState('');
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [age, setAge] = useState<number | ''>('');
  const [allergy, setAllergy] = useState('');
  const [notes, setNotes] = useState('');

  // Auto suggest next file number
  const getNextFileNo = () => {
    const numericIds = patients
      .map(p => {
        const match = normalizeDigits(p.id).match(/^\d+$/);
        return match ? parseInt(match[0], 10) : NaN;
      })
      .filter(n => !isNaN(n));
    if (numericIds.length === 0) return '101';
    return (Math.max(...numericIds) + 1).toString();
  };

  const handleOpenAddModal = () => {
    setEditingPatient(null);
    setFileNo(getNextFileNo());
    setName('');
    setMobile('');
    setAge('');
    setAllergy('');
    setNotes('');
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (p: Patient, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setActiveBottomSheetPatient(null);
    setEditingPatient(p);
    setFileNo(p.id);
    setName(p.name);
    setMobile(p.mobile);
    setAge(p.age);
    setAllergy(p.allergy || '');
    setNotes(p.notes || '');
    setIsModalOpen(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();

    if (!fileNo.trim()) {
      validationFail('patientModal', 'input-fileNo', 'يرجى إدخال رقم الملف');
      return;
    }

    if (!name.trim()) {
      validationFail('patientModal', 'input-name', 'يرجى إدخال اسم المريض الثلاثي');
      return;
    }

    const savedFileNo = editingPatient?.id || normalizeDigits(fileNo.trim());
    const isDuplicate = patients.some(
      p => normalizeDigits(p.id.trim()) === normalizeDigits(savedFileNo) && (!editingPatient || editingPatient.id !== p.id)
    );
    if (isDuplicate) {
      validationFail('patientModal', 'input-fileNo', `رقم الملف (${savedFileNo}) مستخدم بالفعل لحالة أخرى`);
      return;
    }

    const normalizedPhone = cleanEgyptianPhone(mobile);
    const savedMobile = normalizedPhone.startsWith('20') ? `0${normalizedPhone.slice(2)}` : normalizedPhone;
    if (mobile.trim() && !/^01[0125]\d{8}$/.test(savedMobile)) {
      validationFail('patientModal', 'input-mobile', 'رقم الموبايل يجب أن يتكون من 11 رقمًا ويبدأ بـ 01 (مثل 01012345678)');
      return;
    }

    const parsedAge = typeof age === 'number' ? age : parseInt(age as string, 10);
    if (!Number.isInteger(parsedAge) || parsedAge < 0 || parsedAge > 120) {
      validationFail('patientModal', 'input-age', 'يرجى إدخال سن صحيح (بين 0 و 120)');
      return;
    }

    const todayStr = clinicToday();

    onSavePatient({
      id: savedFileNo,
      name: name.trim(),
      mobile: savedMobile,
      age: parsedAge,
      gender: editingPatient?.gender,
      firstVisit: editingPatient ? editingPatient.firstVisit : todayStr,
      allergy: allergy.trim(),
      notes: notes.trim()
    });

    setIsModalOpen(false);
    showToast(editingPatient ? 'تم تحديث بيانات الحالة بنجاح' : 'تم حفظ الحالة والدخول للملف مباشرة', 'success');
    onSelectPatient(savedFileNo, 'patients');
  };

  const handleDelete = (p: Patient, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setActiveBottomSheetPatient(null);
    askConfirm({
      title: 'حذف ملف الحالة',
      message: `هل أنت متأكد من حذف ملف المريض (${p.name}) رقم (${p.id}) بكل جلساته ومدفوعاته؟ لن يتم إعادة ترقيم باقي الملفات.`,
      confirmLabel: 'حذف الملف',
      tone: 'danger',
      onConfirm: () => {
        try { onDeletePatient(p.id); } catch (error) {
          showToast(error instanceof Error ? error.message : 'تعذر حذف الملف.', 'warning');
          return;
        }
        showToast(`تم حذف ملف المريض ${p.name}`, 'warning');
      }
    });
  };

  const getWhatsAppUrl = (mobileNum: string, patientName: string) => {
    return buildWhatsAppUrl(mobileNum, `أهلاً ${patientName}، نتواصل معك من عيادة الأسنان لمتابعة حالتك. نتمنى لك دوام الصحة والعافية.`);
  };

  const handleCopyPhone = async (mobileNum: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!mobileNum) return;
    try {
      await navigator.clipboard.writeText(mobileNum);
      showToast(`تم نسخ رقم الهاتف (${mobileNum})`, 'info');
    } catch {
      showToast('تعذر نسخ رقم الهاتف. يمكنك نسخه من ملف المريض.', 'warning');
    }
  };

  const handleSaveQuickAppt = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickApptPatient || !onSaveAppointment) return;
    if (!isValidAppointmentDate(quickApptDate) || appointmentTimeMinutes(quickApptTime) === null) {
      showToast('حدد تاريخًا ووقتًا صحيحين للموعد', 'warning');
      return;
    }

    const appointment: Omit<Appointment, 'id'> = {
      patientId: quickApptPatient.id,
      fileNo: quickApptPatient.id,
      patientName: quickApptPatient.name,
      mobile: quickApptPatient.mobile,
      date: quickApptDate,
      time: quickApptTime,
      durationMinutes: 30,
      appointmentType: quickApptService,
      status: 'scheduled',
      note: 'حجز سريع من فهرس المرضى',
      isFollowUp: false,
      isWalkIn: false
    };

    const saveAppointment = () => {
      try {
        onSaveAppointment(appointment);
        showToast(`تم حجز موعد للمريض (${quickApptPatient.name}) بتاريخ ${quickApptDate}`, 'success');
        setQuickApptPatient(null);
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'تعذّر حفظ الموعد. راجع البيانات وحاول مرة أخرى.', 'error');
      }
    };
    if (findAppointmentConflicts(appointments, quickApptDate, quickApptTime).length) {
      askConfirm({ title: 'موعد متعارض', message: 'يتداخل وقت الحجز مع موعد آخر مسجل. هل تريد تأكيد الحجز رغم التعارض؟', confirmLabel: 'تأكيد الحجز', tone: 'warning', onConfirm: saveAppointment });
    } else saveAppointment();
  };

  const todayStr = clinicToday();

  // Helper getters for patient status flags
  const getPatientMetrics = (p: Patient) => {
    const financial = getPatientFinancialSummary(p);
    const totalRequired = Math.max(0, financial.totalRequired - financial.totalDiscounts);
    const totalPaid = financial.totalCollected;
    const totalRemain = financial.totalRemaining;
    const hasAllergy = Boolean(p.allergy && p.allergy.trim());
    const hasTodayAppointment = appointments.some(a => (a.patientId === p.id || a.fileNo === p.id) && a.date === todayStr && !['cancelled', 'no_show', 'apologized'].includes(a.status));
    const hasIncompleteTreatment = p.sessions ? p.sessions.some(s => s.visitStatus === 'follow_up' || (s.treatmentStage && s.treatmentStage !== 'single')) : false;
    const hasLabCase = labCases.some(c => c.patientId === p.id && c.status !== 'completed');

    return {
      totalRequired,
      totalPaid,
      totalRemain,
      hasAllergy,
      hasTodayAppointment,
      hasIncompleteTreatment,
      hasLabCase
    };
  };

  // Compute dynamic counters for all filter chips
  const filterCounts = useMemo(() => {
    let todayAppt = 0;
    let ongoing = 0;
    let debt = 0;
    let allergy = 0;
    let lab = 0;
    let noAppt = 0;

    patients.forEach(p => {
      const m = getPatientMetrics(p);
      if (m.hasTodayAppointment) todayAppt++;
      else noAppt++;

      if (m.hasIncompleteTreatment) ongoing++;
      if (m.totalRemain > 0) debt++;
      if (m.hasAllergy) allergy++;
      if (m.hasLabCase) lab++;
    });

    return {
      all: patients.length,
      todayAppt,
      ongoing,
      debt,
      allergy,
      lab,
      noAppt
    };
  }, [patients, appointments, labCases, todayStr]);

  // Filtered and ranked patients with debounced search & filter chip support
  const filteredPatients = useMemo(() => {
    const q = deferredSearchQuery.trim();

    return patients
      .filter(p => {
        const metrics = getPatientMetrics(p);
        if (activeFilter === 'todayAppt' && !metrics.hasTodayAppointment) return false;
        if (activeFilter === 'ongoing' && !metrics.hasIncompleteTreatment) return false;
        if (activeFilter === 'debt' && metrics.totalRemain <= 0) return false;
        if (activeFilter === 'allergy' && !metrics.hasAllergy) return false;
        if (activeFilter === 'lab' && !metrics.hasLabCase) return false;
        if (activeFilter === 'noAppt' && metrics.hasTodayAppointment) return false;

        return true;
      })
      .map(p => ({ patient: p, score: getPatientMatchScore(p, q) }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(item => item.patient);
  }, [patients, deferredSearchQuery, activeFilter, appointments, labCases]);

  const isDoctor = currentUser?.role === 'doctor' || !currentUser?.role;

  return (
    <div
      className="space-y-2 max-w-7xl mx-auto py-1 font-['Cairo',sans-serif] dir-rtl relative select-none"
    >
      {/* 1. Smart Collapsing Top Bar Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4">
        <p className="text-sm text-slate-600">اختر ملف المريض لحجز موعد أو تسجيل دفعة.</p>
        <button type="button" onClick={handleOpenAddModal} className="flex items-center gap-2 min-h-[44px] rounded-xl bg-purple-700 px-4 py-3 text-sm font-bold text-white"><UserPlus className="w-4 h-4" />إضافة مريض</button>
      </div>
      <div 
        className="flex flex-wrap items-center justify-between gap-2.5 bg-white px-3.5 py-3 rounded-2xl border border-slate-200/90 shadow-sm"
      >
        <div className="flex items-center gap-2">
          <button
            onClick={onBackToHome}
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer active:scale-95 shrink-0"
            title="رجوع للشاشة الرئيسية"
          >
            <ArrowRight className="w-4.5 h-4.5" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base sm:text-lg font-black text-slate-900 font-tajawal tracking-tight">
                فهرس المرضى
              </h1>
              <span className="px-2 py-0.5 rounded-lg bg-purple-100 text-purple-900 text-xs font-mono font-black border border-purple-200/80">
                {filteredPatients.length} / {patients.length}
              </span>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => !isPrivacyMode && setShowAmounts(!showAmounts)}
          disabled={isPrivacyMode}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-bold transition-all cursor-pointer active:scale-95 shrink-0 min-h-[36px]"
          title={showAmounts ? 'إخفاء المبالغ والمديونيات' : 'إظهار المبالغ والمديونيات'}
        >
          {showAmounts ? <EyeOff className="w-4 h-4 text-amber-600" /> : <Eye className="w-4 h-4 text-emerald-600" />}
          <span className="hidden sm:inline">{showAmounts ? 'إخفاء المبالغ' : 'إظهار المبالغ'}</span>
        </button>
      </div>

      {/* 2. Sticky Realtime Search Bar & Horizontal Filter Chips */}
      <div className="sticky top-0 z-20 bg-white/95 backdrop-blur-md py-1.5 space-y-1.5 border-b border-slate-200/70 -mx-3 px-3 sm:-mx-6 sm:px-6 shadow-2xs">
        
        {/* Instant Search Bar */}
        <div className="relative">
          <Search className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onFocus={() => setIsSearchFocused(true)}
            onBlur={() => setIsSearchFocused(false)}
            placeholder="ابحث بالاسم أو الهاتف أو رقم الملف (#)..."
            className={`w-full pl-9 pr-10 py-2 bg-slate-50 border rounded-xl text-xs sm:text-sm font-medium text-slate-900 placeholder:text-slate-400 transition-all min-h-[40px] ${
              isSearchFocused || searchQuery 
                ? 'bg-white border-purple-600 ring-2 ring-purple-500/20 shadow-xs' 
                : 'border-slate-200/90 hover:border-slate-300'
            }`}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 p-1 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-pointer transition-colors"
              title="مسح البحث"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Compact Horizontal Scroll Filter Chips (With Dynamic Counters) */}
        <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
          <button
            type="button"
            onClick={() => setActiveFilter('all')}
            className={`px-2.5 py-1.5 min-h-[32px] rounded-lg font-bold transition-all cursor-pointer whitespace-nowrap shrink-0 text-xs ${
              activeFilter === 'all'
                ? 'bg-purple-700 text-white shadow-xs ring-2 ring-purple-600/30'
                : 'bg-slate-100 text-slate-700 border border-slate-200/80 hover:bg-slate-200'
            }`}
          >
            الكل ({filterCounts.all})
          </button>

          <button
            type="button"
            onClick={() => setActiveFilter('todayAppt')}
            className={`flex items-center gap-1 px-2.5 py-1.5 min-h-[32px] rounded-lg font-bold transition-all cursor-pointer whitespace-nowrap shrink-0 text-xs ${
              activeFilter === 'todayAppt'
                ? 'bg-sky-600 text-white shadow-xs ring-2 ring-sky-500/30'
                : 'bg-sky-50 text-sky-800 border border-sky-200/80 hover:bg-sky-100'
            }`}
          >
            <Calendar className="w-3.5 h-3.5" />
            <span>موعد اليوم ({filterCounts.todayAppt})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveFilter('ongoing')}
            className={`flex items-center gap-1 px-2.5 py-1.5 min-h-[32px] rounded-lg font-bold transition-all cursor-pointer whitespace-nowrap shrink-0 text-xs ${
              activeFilter === 'ongoing'
                ? 'bg-emerald-600 text-white shadow-xs ring-2 ring-emerald-500/30'
                : 'bg-emerald-50 text-emerald-800 border border-emerald-200/80 hover:bg-emerald-100'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>علاج جارٍ ({filterCounts.ongoing})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveFilter('debt')}
            className={`flex items-center gap-1 px-2.5 py-1.5 min-h-[32px] rounded-lg font-bold transition-all cursor-pointer whitespace-nowrap shrink-0 text-xs ${
              activeFilter === 'debt'
                ? 'bg-amber-600 text-white shadow-xs ring-2 ring-amber-500/30'
                : 'bg-amber-50 text-amber-800 border border-amber-200/80 hover:bg-amber-100'
            }`}
          >
            <DollarSign className="w-3.5 h-3.5" />
            <span>رصيد متبقٍ ({filterCounts.debt})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveFilter('allergy')}
            className={`flex items-center gap-1 px-2.5 py-1.5 min-h-[32px] rounded-lg font-bold transition-all cursor-pointer whitespace-nowrap shrink-0 text-xs ${
              activeFilter === 'allergy'
                ? 'bg-rose-600 text-white shadow-xs ring-2 ring-rose-500/30'
                : 'bg-rose-50 text-rose-800 border border-rose-200/80 hover:bg-rose-100'
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>حساسية ({filterCounts.allergy})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveFilter('lab')}
            className={`flex items-center gap-1 px-2.5 py-1.5 min-h-[32px] rounded-lg font-bold transition-all cursor-pointer whitespace-nowrap shrink-0 text-xs ${
              activeFilter === 'lab'
                ? 'bg-purple-600 text-white shadow-xs ring-2 ring-purple-500/30'
                : 'bg-purple-50 text-purple-800 border border-purple-200/80 hover:bg-purple-100'
            }`}
          >
            <Microscope className="w-3.5 h-3.5" />
            <span>تركيبات ({filterCounts.lab})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveFilter('noAppt')}
            className={`flex items-center gap-1 px-2.5 py-1.5 min-h-[32px] rounded-lg font-bold transition-all cursor-pointer whitespace-nowrap shrink-0 text-xs ${
              activeFilter === 'noAppt'
                ? 'bg-slate-800 text-white shadow-xs'
                : 'bg-white text-slate-700 border border-slate-200/80 hover:bg-slate-100'
            }`}
          >
            <span>بدون موعد اليوم ({filterCounts.noAppt})</span>
          </button>

          {(searchQuery || activeFilter !== 'all') && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setActiveFilter('all');
              }}
              className="mr-auto text-rose-600 hover:text-rose-700 font-black hover:underline cursor-pointer px-2 py-1 text-xs shrink-0"
            >
              مسح الفلاتر
            </button>
          )}
        </div>
      </div>

      {/* 3. Patient Cards Grid */}
      <div className="pb-28 sm:pb-12">
        {filteredPatients.length === 0 ? (
          <EmptyState
            message={searchQuery || activeFilter !== 'all' ? 'لا توجد حالات تطابق فلاتر البحث الحالية' : 'لا توجد حالات مسجلة في الفهرس بعد'}
            description={searchQuery || activeFilter !== 'all' ? 'جرّب تغيير كلمات البحث أو اختر فلتر آخر' : 'ابدأ بإضافة أول ملف مريض لتنظيم العيادة'}
            ctaLabel={searchQuery || activeFilter !== 'all' ? 'إلغاء الفلاتر' : 'إضافة أول حالة'}
            onCtaClick={searchQuery || activeFilter !== 'all' ? () => { setSearchQuery(''); setActiveFilter('all'); } : handleOpenAddModal}
          />
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-2.5">
              {filteredPatients.slice(0, visibleCount).map(p => {
                const metrics = getPatientMetrics(p);

              // Compile badges list for patient
              const activeBadges: React.ReactNode[] = [];

              if (metrics.hasTodayAppointment) {
                activeBadges.push(
                  <span key="today" className="font-bold bg-sky-50 text-sky-800 border border-sky-200/90 px-1.5 py-0.5 rounded flex items-center gap-0.5 shrink-0 text-[10px]">
                    <span className="w-1.5 h-1.5 rounded-full bg-sky-500 shrink-0" />
                    <span>📅 اليوم</span>
                  </span>
                );
              }

              if (metrics.hasIncompleteTreatment) {
                activeBadges.push(
                  <span key="ongoing" className="font-bold bg-emerald-50 text-emerald-800 border border-emerald-200/90 px-1.5 py-0.5 rounded flex items-center gap-0.5 shrink-0 text-[10px]">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                    <span>🦷 علاج جاري</span>
                  </span>
                );
              }

              if (metrics.totalRemain > 0) {
                activeBadges.push(
                  <span key="debt" className="font-black bg-amber-50 text-amber-900 border border-amber-200/90 px-1.5 py-0.5 rounded flex items-center gap-0.5 shrink-0 text-[10px]">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                    <span>
                      {showAmounts ? `💰 مديونية: ${metrics.totalRemain.toLocaleString()} ج` : '💰 مديونية'}
                    </span>
                  </span>
                );
              }

              if (metrics.hasAllergy) {
                activeBadges.push(
                  <span key="allergy" className="font-bold bg-rose-50 text-rose-800 border border-rose-200/90 px-1.5 py-0.5 rounded flex items-center gap-0.5 shrink-0 text-[10px]">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" />
                    <span>⚠️ حساسية</span>
                  </span>
                );
              }

              if (metrics.hasLabCase) {
                activeBadges.push(
                  <span key="lab" className="font-bold bg-purple-50 text-purple-800 border border-purple-200/90 px-1.5 py-0.5 rounded flex items-center gap-0.5 shrink-0 text-[10px]">
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-500 shrink-0" />
                    <span>🦷 تركيبات</span>
                  </span>
                );
              }

              const visibleBadges = activeBadges.slice(0, 3);
              const extraBadgesCount = activeBadges.length > 3 ? activeBadges.length - 3 : 0;

              return (
                <div
                  key={p.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`فتح ملف ${p.name}، رقم ${p.id}`}
                  onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onSelectPatient(p.id, 'patients'); } }}
                  onClick={() => onSelectPatient(p.id, 'patients')}
                  className="group relative bg-white hover:bg-purple-50/30 active:bg-purple-100/40 rounded-2xl border border-slate-200/90 hover:border-purple-300/80 p-2.5 sm:p-3 shadow-2xs hover:shadow-xs transition-all duration-150 cursor-pointer touch-manipulation flex flex-col justify-between space-y-1.5 active:scale-[0.985] content-visibility-auto"
                >
                  {/* Card Row 1: Prominent Patient Name, Subtle File Badge, Far-Left 44x44 Touch Target Three-Dots Button */}
                  <div className="flex items-center justify-between gap-1.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <h3 className="font-black text-sm sm:text-base text-slate-900 truncate font-tajawal group-hover:text-purple-950 transition-colors leading-tight">
                        {highlightText(p.name, searchQuery)}
                      </h3>
                      <span className="px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 font-mono font-bold text-[10px] shrink-0 border border-slate-200/80">
                        #{highlightText(p.id, searchQuery)}
                      </span>
                    </div>

                    {/* Far Left Options Button (Three Dots) with comfortable 44x44px touch area */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveBottomSheetPatient(p);
                      }}
                      className="w-11 h-11 min-w-[44px] min-h-[44px] -ml-1.5 -mt-1 rounded-xl hover:bg-slate-100 active:bg-slate-200 text-slate-400 hover:text-slate-700 transition-colors flex items-center justify-center cursor-pointer shrink-0"
                      title="خيارات الإجراءات"
                    >
                      <MoreVertical className="w-4.5 h-4.5 text-slate-500" />
                    </button>
                  </div>

                  {/* Card Row 2: Direct Call Phone + Age + Last Visit Info */}
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 font-medium">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {p.mobile ? (
                        <a
                          href={`tel:${p.mobile}`}
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center gap-1 text-[11px] font-medium text-slate-700 hover:text-purple-700 font-mono dir-ltr p-0.5 rounded hover:bg-purple-50 transition-colors"
                          title="اضغط للاتصال المباشر"
                        >
                          <Phone className="w-4 h-4 text-purple-600 shrink-0" />
                          <span>{highlightText(p.mobile || (p as any).phone || '—', searchQuery)}</span>
                        </a>
                      ) : (
                        <div className="flex items-center gap-1 text-[11px] font-medium text-slate-400 font-mono dir-ltr">
                          <Phone className="w-4 h-4 text-slate-300 shrink-0" />
                          <span>—</span>
                        </div>
                      )}
                      <span className="text-slate-300">•</span>
                      <span className="text-[11px] font-tajawal font-medium text-slate-600 shrink-0">{p.age} سنة</span>
                    </div>

                    {p.firstVisit && (
                      <span className="text-[10px] text-slate-500 font-tajawal truncate shrink-0 font-medium">
                        أول زيارة: {p.firstVisit}
                      </span>
                    )}
                  </div>

                  {/* Card Row 3: Compact Unified Status Badges (Max 3 Badges + Overflow pill) */}
                  {activeBadges.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1 pt-1 border-t border-slate-100 text-[10px] font-tajawal">
                      {visibleBadges}
                      {extraBadgesCount > 0 && (
                        <span className="font-bold bg-slate-100 text-slate-700 border border-slate-200/90 px-1.5 py-0.5 rounded text-[10px] shrink-0">
                          +{extraBadgesCount}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {visibleCount < filteredPatients.length && (
            <div className="pt-3 pb-2 text-center">
              <button
                type="button"
                onClick={() => setVisibleCount(prev => prev + 30)}
                className="px-6 py-2.5 rounded-xl bg-purple-100 hover:bg-purple-200 text-purple-900 text-xs font-black border border-purple-200 transition-colors cursor-pointer shadow-xs active:scale-95"
              >
                عرض المزيد من الحالات ({filteredPatients.length - visibleCount} حالة متبقية)
              </button>
            </div>
          )}
        </>
        )}
      </div>


      {/* 5. Touch Options Bottom Sheet (قائمة الخيارات السريعة للمريض) */}
      {activeBottomSheetPatient && (
        <>
          <div 
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 animate-fadeIn transition-opacity cursor-pointer"
            onClick={() => setActiveBottomSheetPatient(null)}
          />

          <div className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-3xl shadow-2xl border-t border-slate-200/90 p-4 sm:p-5 max-w-lg mx-auto animate-slideUp font-cairo dir-rtl max-h-[90vh] overflow-y-auto pb-[max(1.25rem,env(safe-area-inset-bottom))] space-y-3">
            {/* Drag Handle & Patient Header */}
            <div className="relative pb-2 border-b border-slate-100">
              <div className="w-12 h-1 bg-slate-200 rounded-full mx-auto mb-3" />
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-black text-base sm:text-lg text-slate-900 font-tajawal">
                      {activeBottomSheetPatient.name}
                    </h3>
                    <span className="px-2 py-0.5 bg-purple-100 text-purple-800 font-mono font-bold text-xs rounded-md border border-purple-200">
                      #{activeBottomSheetPatient.id}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 font-medium mt-0.5">
                    {activeBottomSheetPatient.mobile || 'بدون رقم هاتف'} • {activeBottomSheetPatient.age} سنة
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setActiveBottomSheetPatient(null)}
                  className="w-8.5 h-8.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center transition-all active:scale-95 shrink-0 min-h-[44px] sm:min-h-0 cursor-pointer"
                  title="إغلاق"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Bottom Sheet Actions List */}
            <div className="space-y-1.5 pt-1">
              {/* 1. Open Patient File */}
              <button
                type="button"
                onClick={() => {
                  const id = activeBottomSheetPatient.id;
                  setActiveBottomSheetPatient(null);
                  onSelectPatient(id, 'patients');
                }}
                className="w-full text-right p-3 rounded-2xl bg-slate-50 hover:bg-purple-50 text-slate-900 hover:text-purple-900 flex items-center gap-3 transition-colors cursor-pointer font-bold text-xs sm:text-sm font-tajawal min-h-[48px] active:scale-[0.99] border border-slate-200/60"
              >
                <div className="w-9 h-9 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center shrink-0">
                  <FileText className="w-4.5 h-4.5" />
                </div>
                <span>فتح الملف الطبي الكامل</span>
              </button>

              {/* 2. Edit Patient Info */}
              <button
                type="button"
                onClick={() => handleOpenEditModal(activeBottomSheetPatient)}
                className="w-full text-right p-3 rounded-2xl bg-slate-50 hover:bg-slate-100 text-slate-900 flex items-center gap-3 transition-colors cursor-pointer font-bold text-xs sm:text-sm font-tajawal min-h-[48px] active:scale-[0.99] border border-slate-200/60"
              >
                <div className="w-9 h-9 rounded-xl bg-slate-200 text-slate-700 flex items-center justify-center shrink-0">
                  <Edit3 className="w-4.5 h-4.5" />
                </div>
                <span>تعديل البيانات الأساسية</span>
              </button>

              {/* 3. Book New Appointment */}
              {onSaveAppointment && <button
                type="button"
                onClick={() => {
                  const p = activeBottomSheetPatient;
                  setActiveBottomSheetPatient(null);
                  setQuickApptDate(clinicToday());
                  setQuickApptTime('10:00');
                  setQuickApptService('كشف واستشارة أسنان');
                  setQuickApptPatient(p);
                }}
                className="w-full text-right p-3 rounded-2xl bg-slate-50 hover:bg-sky-50 text-slate-900 hover:text-sky-900 flex items-center gap-3 transition-colors cursor-pointer font-bold text-xs sm:text-sm font-tajawal min-h-[48px] active:scale-[0.99] border border-slate-200/60"
              >
                <div className="w-9 h-9 rounded-xl bg-sky-100 text-sky-700 flex items-center justify-center shrink-0">
                  <Calendar className="w-4.5 h-4.5" />
                </div>
                <span>حجز موعد جديد</span>
              </button>}

              {/* 4. Record Payment / Account */}
              <button
                type="button"
                onClick={() => {
                  const id = activeBottomSheetPatient.id;
                  setActiveBottomSheetPatient(null);
                  onSelectPatient(id, 'patients');
                }}
                className="w-full text-right p-3 rounded-2xl bg-slate-50 hover:bg-emerald-50 text-slate-900 hover:text-emerald-900 flex items-center gap-3 transition-colors cursor-pointer font-bold text-xs sm:text-sm font-tajawal min-h-[48px] active:scale-[0.99] border border-slate-200/60"
              >
                <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                  <CreditCard className="w-4.5 h-4.5" />
                </div>
                <span>فتح الملف لمراجعة الحساب</span>
              </button>

              {/* 5. Phone Call & WhatsApp options if mobile exists */}
              {activeBottomSheetPatient.mobile && (
                <>
                  <a
                    href={`tel:${activeBottomSheetPatient.mobile}`}
                    onClick={() => setActiveBottomSheetPatient(null)}
                    className="w-full text-right p-3 rounded-2xl bg-slate-50 hover:bg-blue-50 text-slate-900 hover:text-blue-900 flex items-center gap-3 transition-colors cursor-pointer font-bold text-xs sm:text-sm font-tajawal min-h-[48px] active:scale-[0.99] border border-slate-200/60"
                  >
                    <div className="w-9 h-9 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
                      <PhoneCall className="w-4.5 h-4.5" />
                    </div>
                    <span>اتصال هاتفي ({activeBottomSheetPatient.mobile})</span>
                  </a>

                  <a
                    href={getWhatsAppUrl(activeBottomSheetPatient.mobile, activeBottomSheetPatient.name)}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setActiveBottomSheetPatient(null)}
                    className="w-full text-right p-3 rounded-2xl bg-slate-50 hover:bg-emerald-50 text-slate-900 hover:text-emerald-900 flex items-center gap-3 transition-colors cursor-pointer font-bold text-xs sm:text-sm font-tajawal min-h-[48px] active:scale-[0.99] border border-slate-200/60"
                  >
                    <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                      <MessageCircle className="w-4.5 h-4.5" />
                    </div>
                    <span>مراسلة عبر واتساب</span>
                  </a>

                  <button
                    type="button"
                    onClick={() => {
                      handleCopyPhone(activeBottomSheetPatient.mobile);
                      setActiveBottomSheetPatient(null);
                    }}
                    className="w-full text-right p-3 rounded-2xl bg-slate-50 hover:bg-slate-100 text-slate-900 flex items-center gap-3 transition-colors cursor-pointer font-bold text-xs sm:text-sm font-tajawal min-h-[48px] active:scale-[0.99] border border-slate-200/60"
                  >
                    <div className="w-9 h-9 rounded-xl bg-slate-200 text-slate-700 flex items-center justify-center shrink-0">
                      <Copy className="w-4.5 h-4.5" />
                    </div>
                    <span>نسخ رقم الهاتف</span>
                  </button>
                </>
              )}

              {/* 6. Delete Patient (Only visible for doctor role) */}
              {isDoctor && (
                <button
                  type="button"
                  onClick={() => handleDelete(activeBottomSheetPatient)}
                  className="w-full text-right p-3 rounded-2xl bg-rose-50 hover:bg-rose-100 text-rose-700 flex items-center gap-3 transition-colors cursor-pointer font-bold text-xs sm:text-sm font-tajawal min-h-[48px] active:scale-[0.99] border border-rose-200/80 mt-2"
                >
                  <div className="w-9 h-9 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
                    <Trash2 className="w-4.5 h-4.5" />
                  </div>
                  <span>حذف ملف الحالة كلياً</span>
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {/* 6. Quick Appointment Modal */}
      {quickApptPatient && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-xs p-0 sm:p-4 animate-fadeIn">
          <div className="bg-white rounded-t-3xl sm:rounded-3xl max-w-md w-full p-5 shadow-2xl border border-slate-200 space-y-4 relative font-cairo dir-rtl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="font-black text-base text-slate-900 font-tajawal">
                  حجز موعد للمريض: {quickApptPatient.name}
                </h3>
                <span className="text-xs text-slate-500 font-medium">رقم الملف: #{quickApptPatient.id}</span>
              </div>
              <button
                type="button"
                onClick={() => setQuickApptPatient(null)}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveQuickAppt} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">تاريخ الموعد</label>
                <input
                  type="date"
                  value={quickApptDate}
                  onChange={e => setQuickApptDate(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono font-bold"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">وقت الموعد</label>
                <input
                  type="time"
                  value={quickApptTime}
                  onChange={e => setQuickApptTime(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono font-bold"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">نوع الإجراء أو الخدمة</label>
                <input
                  type="text"
                  value={quickApptService}
                  onChange={e => setQuickApptService(e.target.value)}
                  placeholder="مثال: كشف، حشو، خلع، متابعة..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold"
                  required
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setQuickApptPatient(null)}
                  className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors cursor-pointer min-h-[44px]"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold shadow-md transition-all cursor-pointer min-h-[44px]"
                >
                  تأكيد الحجز
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 7. Patient Add/Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-xs p-0 sm:p-4 animate-fadeIn">
          <div
            id="patientModal"
            className="bg-white rounded-t-3xl sm:rounded-3xl max-w-lg w-full p-5 sm:p-6 shadow-2xl border border-slate-200 space-y-4 relative max-h-[92dvh] sm:max-h-[90dvh] overflow-y-auto modal-scroll font-cairo dir-rtl"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h2 className="text-base sm:text-lg font-black text-purple-950 font-tajawal">
                {editingPatient ? `تعديل ملف المريض #${editingPatient.id}` : 'إضافة حالة جديدة'}
              </h2>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-colors cursor-pointer min-h-[44px]"
              >
                إلغاء وإغلاق
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    رقم الملف الورقي <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="input-fileNo"
                    type="text"
                    readOnly={Boolean(editingPatient)}
                    inputMode="numeric"
                    value={fileNo}
                    onChange={e => setFileNo(e.target.value)}
                    placeholder="مثال: 106"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono font-bold focus:outline-none focus:border-purple-600 focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    تاريخ الدخول
                  </label>
                  <input
                    type="text"
                    disabled
                    value={editingPatient ? editingPatient.firstVisit : clinicToday()}
                    className="w-full px-3.5 py-2.5 bg-slate-100 border border-slate-200 rounded-xl text-xs font-mono font-bold text-slate-500 cursor-not-allowed"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  الاسم الثلاثي للمريض <span className="text-rose-500">*</span>
                </label>
                <input
                  id="input-name"
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="مثال: أحمد عبد الله محمود"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs sm:text-sm font-bold focus:outline-none focus:border-purple-600 focus:bg-white"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    رقم الموبايل (مصر)
                  </label>
                  <input
                    id="input-mobile"
                    type="tel"
                    value={mobile}
                    onChange={e => setMobile(e.target.value)}
                    placeholder="01012345678"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono font-bold focus:outline-none focus:border-purple-600 focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    السن (بالسنوات) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="input-age"
                    type="number"
                    min="0"
                    max="120"
                    step="1"
                    value={age}
                    onChange={e => setAge(e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="مثال: 32"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono font-bold focus:outline-none focus:border-purple-600 focus:bg-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1.5 text-rose-700">
                  <ShieldAlert className="w-3.5 h-3.5" />
                  حساسية أو ملاحظات طبية خاصة
                </label>
                <input
                  id="input-allergy"
                  type="text"
                  value={allergy}
                  onChange={e => setAllergy(e.target.value)}
                  placeholder="مثال: حساسية بنسلين، ضغط مرتفع، سكر..."
                  className="w-full px-3.5 py-2.5 bg-rose-50/50 border border-rose-200 rounded-xl text-xs font-bold focus:outline-none focus:border-rose-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  ملاحظات عامة عن الحالة
                </label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={2}
                  placeholder="أكتب أي ملاحظات إضافية يفضل تذكرها..."
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs sm:text-sm font-medium focus:outline-none focus:border-purple-600 focus:bg-white"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors cursor-pointer min-h-[44px]"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-purple-700 hover:bg-purple-800 text-white text-xs font-bold shadow-md shadow-purple-900/20 transition-all cursor-pointer min-h-[44px]"
                >
                  {editingPatient ? 'حفظ التعديلات' : 'إنشاء الملف'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
});

PatientsView.displayName = 'PatientsView';
