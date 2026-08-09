import React, { useState, useMemo, useDeferredValue, useEffect, useRef } from 'react';
import {
  Calendar as CalendarIcon, Clock, Plus, UserCheck, UserX, Phone,
  ArrowRight, ChevronRight, ChevronLeft, Zap, Filter, Search, AlertTriangle,
  CheckCircle2, XCircle, RotateCcw, Sparkles, User, ChevronDown, AlertCircle,
  RefreshCw
} from 'lucide-react';
import { Appointment, Patient, NavigationOrigin, AppointmentStatus } from '../../types';
import { useToastAndConfirm } from '../common/ToastAndConfirm';
import { EmptyState } from '../common/EmptyState';
import { logAuditAction } from '../../services/auditLogger';
import { AppointmentStatusModal, APPOINTMENT_STATUS_CONFIGS } from './AppointmentStatusModal';

interface AppointmentsViewProps {
  appointments: Appointment[];
  patients: Patient[];
  onSelectPatient: (patientId: string, origin: NavigationOrigin) => void;
  onSaveAppointment: (appt: Omit<Appointment, 'id'> & { id?: string }) => void;
  onUpdateApptStatus: (apptId: string, status: AppointmentStatus) => void;
  onBackToHome: () => void;
}

function getWeekDays(referenceDate: Date) {
  const current = new Date(referenceDate);
  const dayOfWeek = current.getDay();
  const diffToSat = (dayOfWeek + 1) % 7;

  const saturday = new Date(current);
  saturday.setDate(current.getDate() - diffToSat);

  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(saturday);
    d.setDate(saturday.getDate() + i);
    days.push(d);
  }
  return days;
}

function getMonthDays(referenceDate: Date) {
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  const days = [];
  for (let i = 1; i <= lastDay.getDate(); i++) {
    days.push(new Date(year, month, i));
  }
  return days;
}

function formatDateISO(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function format12Hour(time24: string): string {
  if (!time24) return '';
  const [hStr, mStr] = time24.split(':');
  let h = parseInt(hStr, 10);
  const period = h >= 12 ? 'م' : 'ص';
  h = h % 12 || 12;
  return `${h}:${mStr || '00'} ${period}`;
}

const DAY_NAMES_AR = ['السبت', 'الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];

export const AppointmentsView: React.FC<AppointmentsViewProps> = React.memo(({
  appointments,
  patients,
  onSelectPatient,
  onSaveAppointment,
  onUpdateApptStatus,
  onBackToHome
}) => {
  const { showToast, validationFail, askConfirm } = useToastAndConfirm();

  const todayISO = formatDateISO(new Date());
  const [selectedDate, setSelectedDate] = useState<string>(todayISO);
  const [refDate, setRefDate] = useState<Date>(new Date());
  const [calendarMode, setCalendarMode] = useState<'day' | 'week' | 'month'>('week');
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [isSearchFocused, setIsSearchFocused] = useState(false);

  // Smart Collapsing Header & Mobile Smart FAB
  const [isStatsCollapsed, setIsStatsCollapsed] = useState(false);
  const [isFabExpanded, setIsFabExpanded] = useState(true);
  const [isFabVisible, setIsFabVisible] = useState(true);

  // Pull-To-Refresh State
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const touchStartYRef = useRef<number>(0);

  // Scroll detection for Smart Collapsing Header & Smart FAB (High Performance 60FPS)
  const statsCollapsedRef = useRef(false);
  const fabExpandedRef = useRef(true);
  const fabVisibleRef = useRef(true);
  const rafScrollRef = useRef<number | null>(null);

  useEffect(() => {
    let lastScrollY = window.scrollY;

    const handleScroll = () => {
      if (rafScrollRef.current !== null) return;

      rafScrollRef.current = requestAnimationFrame(() => {
        rafScrollRef.current = null;
        const currentScrollY = window.scrollY;

        // Smart Header collapse
        const shouldCollapseStats = currentScrollY > 50;
        if (shouldCollapseStats !== statsCollapsedRef.current) {
          statsCollapsedRef.current = shouldCollapseStats;
          setIsStatsCollapsed(shouldCollapseStats);
        }

        // Smart FAB collapse & hide logic
        if (currentScrollY > lastScrollY + 12 && currentScrollY > 50) {
          if (fabExpandedRef.current) {
            fabExpandedRef.current = false;
            setIsFabExpanded(false);
          }
          if (currentScrollY > 320 && fabVisibleRef.current) {
            fabVisibleRef.current = false;
            setIsFabVisible(false);
          }
        } else if (currentScrollY < lastScrollY - 8 || currentScrollY < 30) {
          if (!fabExpandedRef.current) {
            fabExpandedRef.current = true;
            setIsFabExpanded(true);
          }
          if (!fabVisibleRef.current) {
            fabVisibleRef.current = true;
            setIsFabVisible(true);
          }
        }

        lastScrollY = currentScrollY;
      });
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (rafScrollRef.current !== null) cancelAnimationFrame(rafScrollRef.current);
    };
  }, []);

  // Optimized Native Pull-to-Refresh Gesture Handler
  const rafTouchRef = useRef<number | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (window.scrollY <= 2 && e.touches.length === 1) {
      touchStartYRef.current = e.touches[0].clientY;
    } else {
      touchStartYRef.current = 0;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartYRef.current > 0 && window.scrollY <= 2) {
      const currentY = e.touches[0].clientY;
      const diff = currentY - touchStartYRef.current;
      if (diff > 0 && diff < 150) {
        if (rafTouchRef.current === null) {
          rafTouchRef.current = requestAnimationFrame(() => {
            rafTouchRef.current = null;
            setPullDistance(Math.round(diff));
          });
        }
      }
    }
  };

  const handleTouchEnd = () => {
    if (pullDistance > 65 && !isRefreshing) {
      setIsRefreshing(true);
      setPullDistance(60);
      showToast('جاري تحديث جدول ومواعيد العيادة...', 'info');
      setTimeout(() => {
        setIsRefreshing(false);
        setPullDistance(0);
        showToast('تم تحديث جدول المواعيد بنجاح ✨', 'success');
      }, 1000);
    } else {
      setPullDistance(0);
    }
    touchStartYRef.current = 0;
  };

  // Status Modal State
  const [statusModalAppt, setStatusModalAppt] = useState<Appointment | null>(null);

  const handleSelectStatus = (newStatus: AppointmentStatus) => {
    if (!statusModalAppt) return;
    onUpdateApptStatus(statusModalAppt.id, newStatus);
    
    const cfg = APPOINTMENT_STATUS_CONFIGS[newStatus];
    showToast(`تم تحديث حالة الموعد إلى (${cfg ? cfg.label : newStatus}) بنجاح`, 'success');
    setStatusModalAppt(null);
  };

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isWalkInModalOpen, setIsWalkInModalOpen] = useState(false);

  React.useEffect(() => {
    if (isModalOpen) {
      document.body.classList.add('modal-open');
    } else {
      document.body.classList.remove('modal-open');
    }
    return () => {
      document.body.classList.remove('modal-open');
    };
  }, [isModalOpen]);

  // Form State
  const [patientSearch, setPatientSearch] = useState('');
  const [selectedPatientId, setSelectedPatientId] = useState('');
  const [apptDate, setApptDate] = useState(todayISO);
  const [apptHour, setApptHour] = useState('05');
  const [apptMin, setApptMin] = useState('00');
  const [apptPeriod, setApptPeriod] = useState<'AM' | 'PM'>('PM');
  const [isFollowUp, setIsFollowUp] = useState(false);
  const [note, setNote] = useState('');

  // Navigation between weeks/months
  const weekDays = getWeekDays(refDate);
  const monthDays = getMonthDays(refDate);

  const handlePrevWeek = () => {
    const prev = new Date(refDate);
    prev.setDate(refDate.getDate() - 7);
    setRefDate(prev);
  };

  const handleNextWeek = () => {
    const next = new Date(refDate);
    next.setDate(refDate.getDate() + 7);
    setRefDate(next);
  };

  const handleGoToToday = () => {
    setRefDate(new Date());
    setSelectedDate(todayISO);
  };

  // Appointments stats
  const todayAppts = useMemo(() => appointments.filter(a => a.date === todayISO), [appointments, todayISO]);
  const tomorrowStr = formatDateISO(new Date(Date.now() + 86400000));
  const tomorrowAppts = useMemo(() => appointments.filter(a => a.date === tomorrowStr), [appointments, tomorrowStr]);

  // Appointments on selected day
  const dayAppointments = useMemo(() => {
    return appointments
      .filter(a => a.date === selectedDate)
      .filter(a =>
        !deferredSearchQuery.trim() ||
        a.patientName.toLowerCase().includes(deferredSearchQuery.toLowerCase().trim()) ||
        a.mobile.includes(deferredSearchQuery.trim()) ||
        a.fileNo.includes(deferredSearchQuery.trim())
      )
      .sort((a, b) => a.time.localeCompare(b.time));
  }, [appointments, selectedDate, deferredSearchQuery]);

  // Double booking detector map for selected date
  const timeSlotCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    dayAppointments.forEach(a => {
      counts[a.time] = (counts[a.time] || 0) + 1;
    });
    return counts;
  }, [dayAppointments]);

  // Suggest Next Available Appointment Slot
  const handleSuggestNextSlot = () => {
    // Standard working hours 4:00 PM to 10:00 PM
    const possibleHours = ['16:00', '16:30', '17:00', '17:30', '18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00'];
    const takenTimes = appointments.filter(a => a.date === selectedDate).map(a => a.time);

    const availableTime = possibleHours.find(t => !takenTimes.includes(t));

    if (availableTime) {
      const [h24, m] = availableTime.split(':');
      let h = parseInt(h24, 10);
      const period = h >= 12 ? 'PM' : 'AM';
      h = h % 12 || 12;

      setApptHour(h.toString().padStart(2, '0'));
      setApptMin(m);
      setApptPeriod(period as 'AM' | 'PM');
      showToast(`تم اقتراح أفضل موعد متاح الساعة ${format12Hour(availableTime)}`, 'success');
    } else {
      showToast('جدول اليوم ممتلئ، يرجى اختيار تاريخ آخر', 'warning');
    }
  };

  const handleOpenAddModal = () => {
    setPatientSearch('');
    setSelectedPatientId('');
    setApptDate(selectedDate);
    setApptHour('05');
    setApptMin('00');
    setApptPeriod('PM');
    setIsFollowUp(false);
    setNote('');
    setIsModalOpen(true);
  };

  const handleSaveAppointment = (e: React.FormEvent) => {
    e.preventDefault();

    let targetPatient = patients.find(p => p.id === selectedPatientId);

    if (!targetPatient && patientSearch.trim()) {
      const searchClean = patientSearch.trim().toLowerCase().replace(/\s*\(ملف #.*\)/, '');
      targetPatient = patients.find(
        p => p.id === searchClean || p.name.trim().toLowerCase() === searchClean
      );
    }

    if (!targetPatient && !patientSearch.trim()) {
      validationFail('apptModal', 'input-patient-search', 'يرجى كتابة اسم المريض أو اختياره من الفهرس');
      return;
    }

    const patientName = targetPatient ? targetPatient.name : patientSearch.trim().replace(/\s*\(ملف #.*\)/, '');
    const patientId = targetPatient ? targetPatient.id : `p_${Date.now()}`;
    const fileNo = targetPatient ? targetPatient.id : 'جديد';
    const mobile = targetPatient ? targetPatient.mobile : '';

    let h = parseInt(apptHour, 10);
    if (apptPeriod === 'PM' && h < 12) h += 12;
    if (apptPeriod === 'AM' && h === 12) h = 0;
    const time24 = `${h.toString().padStart(2, '0')}:${apptMin}`;

    // Check for double booking
    const isDoubleBooked = appointments.some(a => a.date === apptDate && a.time === time24 && a.status !== 'cancelled');
    if (isDoubleBooked) {
      askConfirm({
        title: '⚠️ تحذير: موعد متضارب',
        message: `يوجد موعد آخر مسجل في نفس الوقت (${format12Hour(time24)}). هل ترغب في تأكيد الموعد المزدوج؟`,
        confirmLabel: 'تأكيد الموعد المزدوج',
        tone: 'warning',
        onConfirm: () => {
          saveApptFinal({ patientId, fileNo, patientName, mobile }, time24);
        }
      });
      return;
    }

    saveApptFinal({ patientId, fileNo, patientName, mobile }, time24);
  };

  const saveApptFinal = (
    info: { patientId: string; fileNo: string; patientName: string; mobile: string },
    time24: string
  ) => {
    onSaveAppointment({
      patientId: info.patientId,
      fileNo: info.fileNo,
      patientName: info.patientName,
      mobile: info.mobile,
      date: apptDate,
      time: time24,
      note: note.trim() || 'كشف ومتابعة',
      isFollowUp,
      isWalkIn: false,
      status: 'scheduled'
    });

    logAuditAction({
      userName: 'العيادة',
      userRole: 'موظف',
      action: 'create',
      entity: 'appointment',
      recordName: `حجز موعد - ${info.patientName}`,
      details: `حجز موعد بتاريخ ${apptDate} الساعة ${format12Hour(time24)}`
    });

    showToast('تم حجز الموعد بنجاح في جدول المواعيد');
    setIsModalOpen(false);
  };

  const filteredPatientsDropdown = useMemo(() => {
    if (!patientSearch.trim()) return patients.slice(0, 6);
    const q = patientSearch.trim().toLowerCase();
    return patients.filter(
      p => p.name.toLowerCase().includes(q) || p.mobile.includes(q) || p.id.includes(q)
    ).slice(0, 8);
  }, [patients, patientSearch]);

  return (
    <div 
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className="space-y-2 sm:space-y-3 font-tajawal max-w-7xl mx-auto px-1 sm:px-0 dir-rtl relative select-none"
    >
      {/* Sleek Floating Pull-To-Refresh Pill Badge (No Layout Shift) */}
      {(pullDistance > 0 || isRefreshing) && (
        <div 
          className="fixed top-14 left-1/2 -translate-x-1/2 z-50 bg-indigo-900/90 text-white backdrop-blur-md px-4 py-2 rounded-full shadow-xl flex items-center gap-2 text-xs font-extrabold dir-rtl border border-indigo-400/30 transition-all duration-200 pointer-events-none animate-fadeIn"
          style={{ 
            opacity: Math.min(pullDistance / 40, 1),
            transform: `translate(-50%, ${Math.min(pullDistance * 0.4, 24)}px) scale(${Math.min(0.85 + pullDistance * 0.003, 1)})`
          }}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-indigo-300' : 'text-indigo-200'}`} />
          <span className="whitespace-nowrap font-tajawal">
            {isRefreshing ? 'جاري تحديث المواعيد...' : pullDistance > 60 ? 'اترك لتأكيد التحديث' : 'اسحب لتحديث الجدول'}
          </span>
        </div>
      )}

      {/* Top Banner Overview Stats - Compact, Perfectly Balanced Grid */}
      <div 
        className={`transition-all duration-300 overflow-hidden ${
          isStatsCollapsed 
            ? 'max-h-0 opacity-0 my-0 border-0 pointer-events-none' 
            : 'max-h-32 opacity-100 mb-1.5'
        }`}
      >
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-2 sm:p-3">
          <div className="grid grid-cols-4 divide-x divide-x-reverse divide-slate-100">
            {/* Stat 1: Today */}
            <div className="flex flex-col items-center justify-center text-center px-1">
              <div className="flex items-center gap-1 text-indigo-600 mb-0.5">
                <CalendarIcon className="w-3.5 h-3.5 shrink-0" />
                <span className="text-xs sm:text-sm font-black text-slate-900">{todayAppts.length}</span>
              </div>
              <span className="text-[10px] sm:text-xs text-slate-500 font-bold truncate">مواعيد اليوم</span>
            </div>

            {/* Stat 2: Tomorrow */}
            <div className="flex flex-col items-center justify-center text-center px-1">
              <div className="flex items-center gap-1 text-amber-600 mb-0.5">
                <Clock className="w-3.5 h-3.5 shrink-0" />
                <span className="text-xs sm:text-sm font-black text-slate-900">{tomorrowAppts.length}</span>
              </div>
              <span className="text-[10px] sm:text-xs text-slate-500 font-bold truncate">مواعيد الغد</span>
            </div>

            {/* Stat 3: Attended */}
            <div className="flex flex-col items-center justify-center text-center px-1">
              <div className="flex items-center gap-1 text-emerald-600 mb-0.5">
                <UserCheck className="w-3.5 h-3.5 shrink-0" />
                <span className="text-xs sm:text-sm font-black text-emerald-700">
                  {todayAppts.filter(a => a.status === 'attended').length}
                </span>
              </div>
              <span className="text-[10px] sm:text-xs text-slate-500 font-bold truncate">حضر اليوم</span>
            </div>

            {/* Stat 4: Total */}
            <div className="flex flex-col items-center justify-center text-center px-1">
              <div className="flex items-center gap-1 text-purple-600 mb-0.5">
                <Zap className="w-3.5 h-3.5 shrink-0" />
                <span className="text-xs sm:text-sm font-black text-purple-700">{appointments.length}</span>
              </div>
              <span className="text-[10px] sm:text-xs text-slate-500 font-bold truncate">إجمالي الجدول</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Calendar Navigation Header */}
      <div className="bg-white rounded-2xl p-3 sm:p-4 shadow-2xs border border-slate-200/90 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5">
          {/* Calendar View Switcher & Today Button */}
          <div className="flex items-center gap-2 w-full md:w-auto">
            {/* Segmented Control */}
            <div className="bg-slate-100/90 p-1 rounded-xl flex items-center gap-1 text-xs font-bold border border-slate-200/80 flex-1 md:flex-initial h-[40px]">
              <button
                type="button"
                onClick={() => setCalendarMode('day')}
                className={`flex-1 md:w-16 h-full rounded-lg transition-all duration-150 cursor-pointer flex items-center justify-center text-xs font-bold active:scale-95 ${
                  calendarMode === 'day'
                    ? 'bg-white text-indigo-700 shadow-2xs font-black'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                يومي
              </button>
              <button
                type="button"
                onClick={() => setCalendarMode('week')}
                className={`flex-1 md:w-16 h-full rounded-lg transition-all duration-150 cursor-pointer flex items-center justify-center text-xs font-bold active:scale-95 ${
                  calendarMode === 'week'
                    ? 'bg-white text-indigo-700 shadow-2xs font-black'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                أسبوعي
              </button>
              <button
                type="button"
                onClick={() => setCalendarMode('month')}
                className={`flex-1 md:w-16 h-full rounded-lg transition-all duration-150 cursor-pointer flex items-center justify-center text-xs font-bold active:scale-95 ${
                  calendarMode === 'month'
                    ? 'bg-white text-indigo-700 shadow-2xs font-black'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                شهري
              </button>
            </div>

            <button
              type="button"
              onClick={handleGoToToday}
              className={`px-3.5 h-[40px] rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 shrink-0 active:scale-95 min-w-[44px] ${
                selectedDate === todayISO
                  ? 'bg-indigo-600 text-white shadow-2xs font-black'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200/80'
              }`}
            >
              <CalendarIcon className="w-3.5 h-3.5" />
              <span>اليوم</span>
            </button>
          </div>

          {/* Quick Search & New Appointment Button */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full md:w-auto">
            <div className="relative flex-1 sm:w-60">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="تصفية باسم المريض أو الهاتف..."
                className="w-full pr-8.5 pl-3 h-[40px] bg-slate-50/90 rounded-xl border border-slate-200 text-xs font-medium text-slate-900 placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-indigo-200 focus:border-indigo-500 outline-none transition-all"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute left-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 text-xs cursor-pointer"
                >
                  ✕
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={handleOpenAddModal}
              className="px-3.5 h-[40px] rounded-xl bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] text-white font-extrabold text-xs sm:text-sm flex items-center justify-center gap-1.5 shadow-2xs transition-all cursor-pointer whitespace-nowrap shrink-0 touch-manipulation"
            >
              <Plus className="w-4 h-4" />
              <span>حجز موعد جديد</span>
            </button>
          </div>
        </div>

        {/* Date Selector Strip (Week View) */}
        {calendarMode === 'week' && (
          <div className="space-y-2 pt-2.5 border-t border-slate-100">
            <div className="flex items-center justify-between gap-2 bg-slate-50/80 px-2 py-1 rounded-xl border border-slate-200/60">
              <button
                type="button"
                onClick={handlePrevWeek}
                className="h-[32px] px-2.5 rounded-lg bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold flex items-center justify-center gap-1 cursor-pointer transition-colors border border-slate-200/80 active:scale-95 shrink-0 min-w-[36px]"
                title="الأسبوع السابق"
              >
                <ChevronRight className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">السابق</span>
              </button>

              <span className="text-xs font-extrabold text-slate-800 text-center flex-1 truncate px-1">
                أسبوع {weekDays[0].toLocaleDateString('ar-EG', { month: 'short', day: 'numeric' })} - {weekDays[6].toLocaleDateString('ar-EG', { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>

              <button
                type="button"
                onClick={handleNextWeek}
                className="h-[32px] px-2.5 rounded-lg bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold flex items-center justify-center gap-1 cursor-pointer transition-colors border border-slate-200/80 active:scale-95 shrink-0 min-w-[36px]"
                title="الأسبوع التالي"
              >
                <span className="hidden sm:inline">التالي</span>
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
              {weekDays.map((dateObj, idx) => {
                const isoStr = formatDateISO(dateObj);
                const isSelected = isoStr === selectedDate;
                const isToday = isoStr === todayISO;
                const count = appointments.filter(a => a.date === isoStr).length;

                return (
                  <button
                    key={isoStr}
                    type="button"
                    onClick={() => setSelectedDate(isoStr)}
                    className={`relative py-1.5 px-1 sm:p-2 rounded-xl flex flex-col items-center justify-center min-h-[62px] sm:min-h-[68px] text-center transition-all duration-150 cursor-pointer border touch-manipulation active:scale-[0.96] ${
                      isSelected
                        ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs font-bold ring-2 ring-indigo-200'
                        : isToday
                        ? 'bg-amber-50 text-amber-950 border-amber-300 hover:bg-amber-100'
                        : 'bg-slate-50 text-slate-700 border-slate-200/80 hover:bg-slate-100'
                    }`}
                  >
                    {isToday && !isSelected && (
                      <span className="absolute top-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-amber-500" />
                    )}
                    <span className="text-[10px] sm:text-[11px] font-bold block opacity-85 leading-none">
                      {DAY_NAMES_AR[idx]}
                    </span>
                    <span className="text-xs sm:text-sm font-black block my-0.5 leading-none">
                      {dateObj.getDate()}
                    </span>
                    <span
                      className={`text-[9px] font-bold px-1.5 py-0.2 rounded-full inline-flex items-center justify-center leading-none ${
                        isSelected
                          ? 'bg-white/20 text-white'
                          : count > 0
                          ? 'bg-indigo-100 text-indigo-800'
                          : 'opacity-40 bg-slate-200/60 text-slate-600'
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Date Selector Strip (Month View) */}
        {calendarMode === 'month' && (
          <div className="space-y-2 pt-2.5 border-t border-slate-100">
            <div className="flex items-center justify-between gap-2 bg-slate-50/80 px-2 py-1 rounded-xl border border-slate-200/60">
              <button
                type="button"
                onClick={() => {
                  const prev = new Date(refDate);
                  prev.setMonth(prev.getMonth() - 1);
                  setRefDate(prev);
                }}
                className="h-[32px] px-2.5 rounded-lg bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold flex items-center justify-center gap-1 cursor-pointer transition-colors border border-slate-200/80 active:scale-95 shrink-0"
              >
                <ChevronRight className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">الشهر السابق</span>
              </button>

              <span className="text-xs font-extrabold text-slate-800 text-center flex-1 truncate px-1">
                شهر {refDate.toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' })}
              </span>

              <button
                type="button"
                onClick={() => {
                  const next = new Date(refDate);
                  next.setMonth(next.getMonth() + 1);
                  setRefDate(next);
                }}
                className="h-[32px] px-2.5 rounded-lg bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold flex items-center justify-center gap-1 cursor-pointer transition-colors border border-slate-200/80 active:scale-95 shrink-0"
              >
                <span className="hidden sm:inline">الشهر التالي</span>
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
              {monthDays.map((dateObj) => {
                const isoStr = formatDateISO(dateObj);
                const isSelected = isoStr === selectedDate;
                const isToday = isoStr === todayISO;
                const count = appointments.filter(a => a.date === isoStr).length;

                return (
                  <button
                    key={isoStr}
                    type="button"
                    onClick={() => setSelectedDate(isoStr)}
                    className={`p-1 sm:p-1.5 rounded-lg flex flex-col items-center justify-center min-h-[46px] text-center transition-all cursor-pointer border touch-manipulation active:scale-95 ${
                      isSelected
                        ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs font-bold'
                        : isToday
                        ? 'bg-amber-50 text-amber-950 border-amber-300'
                        : 'bg-slate-50 text-slate-700 border-slate-200/70 hover:bg-slate-100'
                    }`}
                  >
                    <span className="text-xs font-extrabold leading-none">{dateObj.getDate()}</span>
                    {count > 0 && (
                      <span className={`text-[9px] font-bold px-1 rounded-full mt-0.5 ${isSelected ? 'bg-white/20 text-white' : 'bg-indigo-100 text-indigo-800'}`}>
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Selected Day Appointments List */}
      <div className="bg-white rounded-2xl p-3.5 sm:p-4 shadow-2xs border border-slate-200/90 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-slate-100">
          <div className="flex items-center gap-2 min-w-0">
            <CalendarIcon className="w-4.5 h-4.5 text-indigo-600 shrink-0" />
            <h3 className="font-extrabold text-xs sm:text-sm text-slate-900 leading-tight truncate">
              جدول المواعيد • {selectedDate === todayISO ? 'اليوم' : selectedDate} ({dayAppointments.length} حجز)
            </h3>
          </div>

          <button
            type="button"
            onClick={handleSuggestNextSlot}
            className="px-2.5 py-1.5 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-900 font-bold text-xs flex items-center justify-center gap-1 cursor-pointer transition-colors border border-amber-200/80 active:scale-95 self-start sm:self-auto min-h-[36px] touch-manipulation"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-700 shrink-0" />
            <span>اقترح أقرب موعد متاح</span>
          </button>
        </div>

        {dayAppointments.length === 0 ? (
          <EmptyState
            icon={<CalendarIcon className="w-8 h-8 opacity-80" />}
            message="لا توجد مواعيد مسجلة في هذا اليوم"
            description="اضغط على زر 'حجز موعد' لإضافة حجز جديد لمريض في هذا التاريخ"
            ctaLabel="حجز موعد جديد"
            onCtaClick={handleOpenAddModal}
          />
        ) : (
          <div className="grid gap-2.5">
            {dayAppointments.map(a => {
              const hasConflict = timeSlotCounts[a.time] > 1;
              const statusCfg = APPOINTMENT_STATUS_CONFIGS[a.status] || APPOINTMENT_STATUS_CONFIGS['scheduled'];
              const StatusIcon = statusCfg.icon;

              return (
                <div
                  key={a.id}
                  className={`p-3 sm:p-3.5 rounded-xl border transition-all duration-150 flex flex-col md:flex-row md:items-center justify-between gap-3 ${
                    a.status === 'attended'
                      ? 'bg-emerald-50/50 border-emerald-200/90'
                      : a.status === 'no_show'
                      ? 'bg-rose-50/50 border-rose-200/90'
                      : a.status === 'apologized'
                      ? 'bg-orange-50/50 border-orange-200/90'
                      : a.status === 'waiting'
                      ? 'bg-amber-50/50 border-amber-200/90'
                      : 'bg-white hover:bg-slate-50/90 border-slate-200/90 shadow-2xs'
                  }`}
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <div
                      className={`w-11 h-11 rounded-xl flex flex-col items-center justify-center font-black text-xs shrink-0 shadow-2xs leading-none text-center ${statusCfg.activeBg}`}
                    >
                      {format12Hour(a.time)}
                    </div>

                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          type="button"
                          onClick={() => onSelectPatient(a.fileNo, 'appointments')}
                          className="font-black text-slate-900 text-sm sm:text-base hover:text-indigo-600 transition-colors text-right cursor-pointer leading-tight"
                        >
                          {a.patientName}
                        </button>
                        <span className="text-[10px] px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-bold border border-slate-200/70">
                          ملف #{a.fileNo}
                        </span>

                        {a.isFollowUp && (
                          <span className="text-[10px] px-2 py-0.5 rounded-md bg-purple-100 text-purple-800 font-bold border border-purple-200/70">
                            إعادة / متابعة
                          </span>
                        )}

                        {hasConflict && a.status !== 'no_show' && a.status !== 'apologized' && a.status !== 'cancelled' && (
                          <span className="text-[10px] px-2 py-0.5 rounded-md bg-amber-500 text-white font-bold flex items-center gap-1 shadow-2xs">
                            <AlertTriangle className="w-3 h-3" /> موعد مزدوج
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2.5 text-xs text-slate-500 font-medium flex-wrap pt-0.5">
                        {a.mobile && <span className="dir-ltr font-mono text-slate-600">📱 {a.mobile}</span>}
                        {a.mobile && a.note && <span>•</span>}
                        <span className="text-slate-700 font-bold">{a.note}</span>
                      </div>
                    </div>
                  </div>

                  {/* Actions & Status Selector */}
                  <div className="flex items-center gap-2 self-stretch md:self-center shrink-0 flex-wrap justify-end pt-2 md:pt-0 border-t md:border-t-0 border-slate-100">
                    {/* Status Selector Pill Button */}
                    <button
                      type="button"
                      onClick={() => setStatusModalAppt(a)}
                      className={`px-3 py-2 min-h-[44px] rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition-all cursor-pointer border active:scale-95 touch-manipulation shadow-2xs ${statusCfg.badgeBg}`}
                      title="اضغط لتغيير حالة الموعد"
                    >
                      <StatusIcon className="w-3.5 h-3.5 shrink-0" />
                      <span>{statusCfg.label}</span>
                      <ChevronDown className="w-3 h-3 opacity-60 shrink-0" />
                    </button>

                    {/* Direct Call Button */}
                    <button
                      type="button"
                      onClick={() => {
                        if (a.mobile && a.mobile.trim()) {
                          window.location.href = `tel:${a.mobile.replace(/\D/g, '')}`;
                        } else {
                          showToast('لا يوجد رقم هاتف مسجل لهذا المريض', 'warning');
                        }
                      }}
                      className="px-3 py-2 min-h-[44px] rounded-xl bg-indigo-50 hover:bg-indigo-100 active:scale-95 text-indigo-800 font-bold text-xs flex items-center justify-center gap-1.5 transition-all border border-indigo-200/80 cursor-pointer shrink-0 touch-manipulation min-w-[44px]"
                      title="اتصال هاتفي مباشر"
                    >
                      <Phone className="w-3.5 h-3.5 text-indigo-600" />
                      <span>اتصال</span>
                    </button>

                    {/* Patient File Button */}
                    <button
                      type="button"
                      onClick={() => onSelectPatient(a.fileNo, 'appointments')}
                      className="px-3 py-2 min-h-[44px] rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs flex items-center justify-center gap-1.5 transition-all border border-slate-200/80 cursor-pointer active:scale-95 touch-manipulation min-w-[44px]"
                      title="فتح ملف المريض"
                    >
                      <User className="w-3.5 h-3.5 text-slate-600" />
                      <span className="hidden sm:inline">الملف</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add Appointment Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-xs p-0 sm:p-4 animate-fadeIn">
          <div
            id="apptModal"
            className="bg-white rounded-t-3xl sm:rounded-3xl max-w-lg w-full p-5 sm:p-6 shadow-2xl border border-slate-200 space-y-4 font-tajawal relative max-h-[92dvh] sm:max-h-[90dvh] overflow-y-auto modal-scroll"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-extrabold text-base sm:text-lg text-slate-900 flex items-center gap-2">
                <CalendarIcon className="w-5 h-5 text-indigo-600" />
                <span>حجز موعد مريض جديد</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-colors cursor-pointer min-h-[44px] touch-manipulation"
              >
                إلغاء وإغلاق
              </button>
            </div>

            <form onSubmit={handleSaveAppointment} className="space-y-4">
              {/* Select Patient Dropdown / Search */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 block">المريض المسجل</label>
                <input
                  id="input-patient-search"
                  type="text"
                  value={patientSearch}
                  onChange={e => {
                    setPatientSearch(e.target.value);
                    setSelectedPatientId('');
                  }}
                  placeholder="ابحث باسم المريض أو رقم الهاتف..."
                  className="w-full px-3.5 py-3 rounded-2xl border border-slate-200 text-base font-bold text-slate-900 outline-none focus:ring-2 focus:ring-indigo-200"
                />

                {patientSearch && !selectedPatientId && (
                  <div className="bg-slate-50 border border-slate-200 rounded-2xl max-h-40 overflow-y-auto p-1 space-y-1 mt-1">
                    {filteredPatientsDropdown.map(p => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          setSelectedPatientId(p.id);
                          setPatientSearch(`${p.name} (ملف #${p.id})`);
                        }}
                        className="w-full text-right p-2.5 rounded-xl hover:bg-indigo-50 text-xs font-bold text-slate-800 flex items-center justify-between min-h-[44px] touch-manipulation"
                      >
                        <span>{p.name}</span>
                        <span className="text-slate-500 font-mono">#{p.id}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Date & Time selectors */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 block">التاريخ</label>
                  <input
                    type="date"
                    value={apptDate}
                    onChange={e => setApptDate(e.target.value)}
                    className="w-full px-3.5 py-3 rounded-2xl border border-slate-200 text-base font-bold text-slate-900 outline-none font-mono"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 block">الوقت</label>
                  <div className="grid grid-cols-3 gap-1.5">
                    <select
                      value={apptHour}
                      onChange={e => setApptHour(e.target.value)}
                      className="px-2 py-3 rounded-xl border border-slate-200 text-base font-bold text-slate-900 outline-none"
                    >
                      {['01','02','03','04','05','06','07','08','09','10','11','12'].map(h => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>

                    <select
                      value={apptMin}
                      onChange={e => setApptMin(e.target.value)}
                      className="px-2 py-3 rounded-xl border border-slate-200 text-base font-bold text-slate-900 outline-none"
                    >
                      {['00','15','30','45'].map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>

                    <select
                      value={apptPeriod}
                      onChange={e => setApptPeriod(e.target.value as 'AM' | 'PM')}
                      className="px-2 py-3 rounded-xl border border-slate-200 text-base font-bold text-slate-900 outline-none"
                    >
                      <option value="PM">مساءً</option>
                      <option value="AM">صباحاً</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Note */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 block">سبب الكشف / ملاحظات الموعد</label>
                <input
                  type="text"
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  placeholder="مثال: تركيب طربوش زيركون، حشو عصب، كشف دوري"
                  className="w-full px-3.5 py-3 rounded-2xl border border-slate-200 text-base font-bold text-slate-900 outline-none"
                />
              </div>

              <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                <button
                  type="submit"
                  className="flex-1 py-3.5 min-h-[48px] rounded-2xl bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] text-white font-black text-sm shadow-md transition-all cursor-pointer touch-manipulation"
                >
                  حفظ الحجز الآن
                </button>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-5 py-3.5 min-h-[48px] rounded-2xl bg-slate-100 hover:bg-slate-200 active:scale-[0.98] text-slate-700 font-bold text-sm cursor-pointer transition-all touch-manipulation"
                >
                  إلغاء وإغلاق
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Smart Mobile Floating Action Button (FAB) for fast appointment booking */}
      <div 
        className={`fixed bottom-22 sm:bottom-10 left-4 sm:left-8 z-40 transition-all duration-300 ${
          isFabVisible ? 'translate-y-0 opacity-100' : 'translate-y-20 opacity-0 pointer-events-none'
        }`}
      >
        <button
          type="button"
          onClick={handleOpenAddModal}
          className={`bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white font-extrabold shadow-lg border border-indigo-500/40 flex items-center justify-center transition-all duration-300 cursor-pointer touch-manipulation ${
            isFabExpanded 
              ? 'px-4 py-3 rounded-full gap-2 text-xs sm:text-sm min-h-[48px]' 
              : 'w-12 h-12 rounded-full min-h-[48px]'
          }`}
          title="حجز موعد جديد"
        >
          <Plus className="w-5 h-5 shrink-0" />
          {isFabExpanded && <span className="whitespace-nowrap font-tajawal">حجز موعد</span>}
        </button>
      </div>

      {/* Appointment Status Bottom Sheet / Modal */}
      <AppointmentStatusModal
        appointment={statusModalAppt}
        onClose={() => setStatusModalAppt(null)}
        onSelectStatus={handleSelectStatus}
      />
    </div>
  );
});

AppointmentsView.displayName = 'AppointmentsView';

