import React, { useState, useMemo, useDeferredValue } from 'react';
import {
  Calendar as CalendarIcon, Clock, Plus, UserCheck, Phone,
  ChevronRight, ChevronLeft, Search, AlertTriangle,
  Sparkles, User, ChevronDown, X
} from 'lucide-react';
import { Appointment, Patient, NavigationOrigin, AppointmentStatus } from '../../types';
import { useToastAndConfirm } from '../common/ToastAndConfirm';
import { useConfirmedAction } from '../common/useConfirmedAction';
import { EmptyState } from '../common/EmptyState';
import { logAuditAction } from '../../services/auditLogger';
import { AppointmentStatusModal, APPOINTMENT_STATUS_CONFIGS } from './AppointmentStatusModal';
import { adjacentCalendarMonth, appointmentTimeMinutes, availableAppointmentTimes, findAppointmentConflicts, isValidAppointmentDate, localDateISO, occupiesAppointmentSlot } from './appointmentScheduling';
import { useAppointmentDialog } from './useAppointmentDialog';
import { cleanEgyptianPhone } from '../../utils/whatsappUtils';

interface AppointmentsViewProps {
  appointments: Appointment[];
  patients: Patient[];
  onSelectPatient: (patientId: string, origin: NavigationOrigin) => void;
  onSaveAppointment: (appt: Omit<Appointment, 'id'> & { id?: string }) => void | Promise<void>;
  onUpdateApptStatus: (apptId: string, status: AppointmentStatus) => void | Promise<void>;
  onBackToHome: () => void;
  onEditorChange?: (open: boolean) => void;
  localAuditEnabled?: boolean;
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
  const lastDay = new Date(year, month + 1, 0);

  const days = [];
  for (let i = 1; i <= lastDay.getDate(); i++) {
    days.push(new Date(year, month, i));
  }
  return days;
}

function format12Hour(time24: string): string {
  if (appointmentTimeMinutes(time24) === null) return 'وقت غير محدد';
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
  onBackToHome,
  onEditorChange,
  localAuditEnabled = true
}) => {
  const { showToast, validationFail, askConfirm } = useToastAndConfirm();
  const { saving, run } = useConfirmedAction();

  const todayISO = localDateISO();
  const [selectedDate, setSelectedDate] = useState<string>(todayISO);
  const [refDate, setRefDate] = useState<Date>(new Date());
  const [calendarMode, setCalendarMode] = useState<'day' | 'week' | 'month'>('week');
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);

  // Status Modal State
  const [statusModalAppt, setStatusModalAppt] = useState<Appointment | null>(null);

  const handleSelectStatus = async (newStatus: AppointmentStatus) => {
    if (!statusModalAppt) return;
    await run(async () => { await onUpdateApptStatus(statusModalAppt.id, newStatus);
    
    const cfg = APPOINTMENT_STATUS_CONFIGS[newStatus];
    showToast(`تم تحديث حالة الموعد إلى (${cfg ? cfg.label : newStatus}) بنجاح`, 'success');
    setStatusModalAppt(null);
    });
  };

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  React.useEffect(() => { onEditorChange?.(isModalOpen || !!statusModalAppt); return () => onEditorChange?.(false); }, [isModalOpen, statusModalAppt, onEditorChange]);
  const bookingDialogRef = useAppointmentDialog(isModalOpen, () => { if (!saving) setIsModalOpen(false); });

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
  const monthStartsOn = (monthDays[0].getDay() + 1) % 7;

  const handlePrevWeek = () => {
    const prev = new Date(refDate);
    prev.setDate(refDate.getDate() - 7);
    setRefDate(prev);
    setSelectedDate(localDateISO(prev));
  };

  const handleNextWeek = () => {
    const next = new Date(refDate);
    next.setDate(refDate.getDate() + 7);
    setRefDate(next);
    setSelectedDate(localDateISO(next));
  };

  const handleGoToToday = () => {
    setRefDate(new Date());
    setSelectedDate(todayISO);
  };

  // Appointments stats
  const todayAppts = useMemo(() => appointments.filter(a => a.date === todayISO), [appointments, todayISO]);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = localDateISO(tomorrow);
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

  // Suggest Next Available Appointment Slot
  const handleSuggestNextSlot = () => {
    const availableTime = availableAppointmentTimes(appointments, selectedDate)[0];

    if (availableTime) {
      const [h24, m] = availableTime.split(':');
      let h = parseInt(h24, 10);
      const period = h >= 12 ? 'PM' : 'AM';
      h = h % 12 || 12;

      handleOpenAddModal();
      setApptHour(h.toString().padStart(2, '0'));
      setApptMin(m);
      setApptPeriod(period as 'AM' | 'PM');
    } else {
      showToast('لا يوجد وقت متاح بين ٤ مساءً و١٠ مساءً في هذا التاريخ. يمكنك اختيار وقت آخر يدويًا.', 'warning');
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

    const targetPatient = patients.find(p => p.id === selectedPatientId);
    if (!targetPatient) {
      validationFail('apptModal', 'input-patient-search', 'اختر المريض من نتائج البحث. إذا كان جديدًا، أضف ملفه أولًا من قسم المرضى.');
      return;
    }

    if (!isValidAppointmentDate(apptDate)) {
      validationFail('apptModal', 'input-appt-date', 'اختر تاريخًا صحيحًا للموعد');
      return;
    }

    let h = parseInt(apptHour, 10);
    if (apptPeriod === 'PM' && h < 12) h += 12;
    if (apptPeriod === 'AM' && h === 12) h = 0;
    const time24 = `${h.toString().padStart(2, '0')}:${apptMin}`;
    if (appointmentTimeMinutes(time24) === null) {
      validationFail('apptModal', 'input-appt-hour', 'اختر وقتًا صحيحًا للموعد');
      return;
    }
    const info = { patientId: targetPatient.id, fileNo: targetPatient.id, patientName: targetPatient.name, mobile: targetPatient.mobile };

    const isDoubleBooked = findAppointmentConflicts(appointments, apptDate, time24).length > 0;
    if (isDoubleBooked) {
      askConfirm({
        title: 'موعد متعارض',
        message: `يوجد موعد آخر يتداخل مع هذا الوقت (${format12Hour(time24)}). هل ترغب في تأكيد الحجز رغم التعارض؟`,
        confirmLabel: 'تأكيد الموعد المزدوج',
        tone: 'warning',
        onConfirm: async () => {
          await saveApptFinal(info, time24);
        }
      });
      return;
    }

    saveApptFinal(info, time24);
  };

  const saveApptFinal = async (
    info: { patientId: string; fileNo: string; patientName: string; mobile: string },
    time24: string
  ) => {
    await run(async () => { await onSaveAppointment({
      patientId: info.patientId,
      fileNo: info.fileNo,
      patientName: info.patientName,
      mobile: info.mobile,
      date: apptDate,
      time: time24,
      durationMinutes: 30,
      note: note.trim() || 'كشف ومتابعة',
      isFollowUp,
      isWalkIn: false,
      status: 'scheduled'
    });

    if (localAuditEnabled) logAuditAction({
      userName: 'العيادة',
      userRole: 'موظف',
      action: 'create',
      entity: 'appointment',
      recordName: `حجز موعد - ${info.patientName}`,
      details: `حجز موعد بتاريخ ${apptDate} الساعة ${format12Hour(time24)}`
    });

    showToast('تم حجز الموعد بنجاح في جدول المواعيد');
    setIsModalOpen(false);
    });
  };

  const filteredPatientsDropdown = useMemo(() => {
    if (!patientSearch.trim()) return patients.slice(0, 6);
    const q = patientSearch.trim().toLowerCase();
    return patients.filter(
      p => p.name.toLowerCase().includes(q) || p.mobile.includes(q) || p.id.includes(q)
    ).slice(0, 8);
  }, [patients, patientSearch]);

  const handleOpenPatient = (appointment: Appointment) => {
    const patient = patients.find(p => p.id === appointment.patientId) || patients.find(p => p.id === appointment.fileNo);
    if (!patient) {
      showToast('هذا الموعد غير مرتبط بملف مريض موجود. أضف ملف المريض من قسم المرضى.', 'warning');
      return;
    }
    onSelectPatient(patient.id, 'appointments');
  };

  return (
    <div className="space-y-4 font-tajawal max-w-7xl mx-auto dir-rtl relative">

      {/* Top Banner Overview Stats - Compact, Perfectly Balanced Grid */}
      <div>
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
                <CalendarIcon className="w-3.5 h-3.5 shrink-0" />
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
                aria-pressed={calendarMode === 'day'}
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
                aria-pressed={calendarMode === 'week'}
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
                aria-pressed={calendarMode === 'month'}
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
                aria-label="البحث في مواعيد اليوم المحدد"
                placeholder="ابحث بالاسم أو الهاتف أو رقم الملف"
                className="w-full pr-9 pl-9 min-h-[44px] bg-slate-50/90 rounded-xl border border-slate-200 text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-indigo-200 focus:border-indigo-500 outline-none transition-all"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="مسح البحث"
                  className="absolute left-0 top-1/2 -translate-y-1/2 w-9 h-11 flex items-center justify-center text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={handleOpenAddModal}
              className="px-3.5 min-h-[44px] rounded-xl bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] text-white font-extrabold text-sm flex items-center justify-center gap-1.5 shadow-2xs transition-all cursor-pointer whitespace-nowrap shrink-0 touch-manipulation"
            >
              <Plus className="w-4 h-4" />
              <span>حجز موعد جديد</span>
            </button>
          </div>
        </div>

        {calendarMode === 'day' && (
          <div className="pt-3 border-t border-slate-100">
            <label htmlFor="selected-day" className="block text-sm font-bold text-slate-700 mb-2">تاريخ عرض المواعيد</label>
            <input
              id="selected-day"
              type="date"
              value={selectedDate}
              onChange={event => {
                if (!isValidAppointmentDate(event.target.value)) return;
                setSelectedDate(event.target.value);
                setRefDate(new Date(`${event.target.value}T12:00:00`));
              }}
              className="w-full sm:w-auto min-h-[44px] px-3 rounded-xl border border-slate-200 bg-slate-50 text-sm font-bold"
            />
          </div>
        )}

        {/* Date Selector Strip (Week View) */}
        {calendarMode === 'week' && (
          <div className="space-y-2 pt-2.5 border-t border-slate-100">
            <div className="flex items-center justify-between gap-2 bg-slate-50/80 px-2 py-1 rounded-xl border border-slate-200/60">
              <button
                type="button"
                onClick={handlePrevWeek}
                className="h-[32px] px-2.5 rounded-lg bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold flex items-center justify-center gap-1 cursor-pointer transition-colors border border-slate-200/80 active:scale-95 shrink-0 min-w-[36px]"
                title="الأسبوع السابق"
                aria-label="الأسبوع السابق"
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
                aria-label="الأسبوع التالي"
              >
                <span className="hidden sm:inline">التالي</span>
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
              {weekDays.map((dateObj, idx) => {
                const isoStr = localDateISO(dateObj);
                const isSelected = isoStr === selectedDate;
                const isToday = isoStr === todayISO;
                const count = appointments.filter(a => a.date === isoStr).length;

                return (
                  <button
                    key={isoStr}
                    type="button"
                    onClick={() => setSelectedDate(isoStr)}
                    aria-pressed={isSelected}
                    aria-label={`${dateObj.toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' })}، ${count} مواعيد`}
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
                  const prev = adjacentCalendarMonth(refDate, -1);
                  setRefDate(prev);
                  setSelectedDate(localDateISO(prev));
                }}
                aria-label="الشهر السابق"
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
                  const next = adjacentCalendarMonth(refDate, 1);
                  setRefDate(next);
                  setSelectedDate(localDateISO(next));
                }}
                aria-label="الشهر التالي"
                className="h-[32px] px-2.5 rounded-lg bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold flex items-center justify-center gap-1 cursor-pointer transition-colors border border-slate-200/80 active:scale-95 shrink-0"
              >
                <span className="hidden sm:inline">الشهر التالي</span>
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
              {DAY_NAMES_AR.map(day => (
                <div key={day} className="text-center text-[10px] sm:text-xs font-bold text-slate-500 py-1">{day}</div>
              ))}
              {Array.from({ length: monthStartsOn }, (_, index) => <div key={`blank-${index}`} aria-hidden="true" />)}
              {monthDays.map((dateObj) => {
                const isoStr = localDateISO(dateObj);
                const isSelected = isoStr === selectedDate;
                const isToday = isoStr === todayISO;
                const count = appointments.filter(a => a.date === isoStr).length;

                return (
                  <button
                    key={isoStr}
                    type="button"
                    onClick={() => setSelectedDate(isoStr)}
                    aria-pressed={isSelected}
                    aria-label={`${dateObj.toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' })}، ${count} مواعيد`}
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
            title="اقتراح وقت خالٍ بين ٤ مساءً و١٠ مساءً، مع مراعاة مدة المواعيد المسجلة"
            className="px-2.5 py-1.5 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-900 font-bold text-xs flex items-center justify-center gap-1 cursor-pointer transition-colors border border-amber-200/80 active:scale-95 self-start sm:self-auto min-h-[36px] touch-manipulation"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-700 shrink-0" />
            <span>حجز وقت متاح</span>
          </button>
        </div>

        {dayAppointments.length === 0 ? (
          <EmptyState
            icon={<CalendarIcon className="w-8 h-8 opacity-80" />}
            message={searchQuery.trim() ? 'لا توجد مواعيد مطابقة للبحث' : 'لا توجد مواعيد مسجلة في هذا اليوم'}
            description={searchQuery.trim() ? 'جرّب اسمًا أو رقم ملف آخر، أو امسح البحث لعرض كل مواعيد اليوم.' : 'احجز موعدًا جديدًا لمريض في هذا التاريخ.'}
            ctaLabel={searchQuery.trim() ? 'مسح البحث' : 'حجز موعد جديد'}
            onCtaClick={searchQuery.trim() ? () => setSearchQuery('') : handleOpenAddModal}
          />
        ) : (
          <div className="grid gap-2.5">
            {dayAppointments.map(a => {
              const hasConflict = occupiesAppointmentSlot(a) && findAppointmentConflicts(appointments, a.date, a.time, a.durationMinutes, a.id).length > 0;
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
                          onClick={() => handleOpenPatient(a)}
                          className="font-black text-slate-900 text-sm sm:text-base hover:text-indigo-600 transition-colors text-right cursor-pointer leading-tight break-words"
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
                        {a.mobile && <span dir="ltr" className="font-mono text-slate-600 inline-flex items-center gap-1"><Phone className="w-3 h-3" /> {a.mobile}</span>}
                        {a.mobile && a.note && <span>•</span>}
                        <span className="text-slate-700 font-bold break-words">{a.note}</span>
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
                        const phone = cleanEgyptianPhone(a.mobile || '');
                        if (/^[1-9]\d{7,14}$/.test(phone)) {
                          window.location.href = `tel:+${phone}`;
                        } else {
                          showToast('لا يوجد رقم هاتف صحيح مسجل لهذا المريض', 'warning');
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
                      onClick={() => handleOpenPatient(a)}
                      className="px-3 py-2 min-h-[44px] rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs flex items-center justify-center gap-1.5 transition-all border border-slate-200/80 cursor-pointer active:scale-95 touch-manipulation min-w-[44px]"
                      title="فتح ملف المريض"
                    >
                      <User className="w-3.5 h-3.5 text-slate-600" />
                      <span>الملف</span>
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
        <div className="clinic-modal-overlay fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-xs p-0 sm:p-4 animate-fadeIn">
          <div
            id="apptModal"
            ref={bookingDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="booking-title"
            tabIndex={-1}
            className="clinic-modal-panel bg-white rounded-t-3xl sm:rounded-3xl max-w-lg w-full p-5 sm:p-6 shadow-2xl border border-slate-200 space-y-4 font-tajawal relative max-h-[92dvh] sm:max-h-[90dvh] overflow-y-auto modal-scroll"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 id="booking-title" className="font-extrabold text-base sm:text-lg text-slate-900 flex items-center gap-2">
                <CalendarIcon className="w-5 h-5 text-indigo-600" />
                <span>حجز موعد جديد</span>
              </h3>
              <button
                type="button"
                disabled={saving} onClick={() => { if (!saving) setIsModalOpen(false); }}
                className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-colors cursor-pointer min-h-[44px] touch-manipulation"
              >
                إلغاء وإغلاق
              </button>
            </div>

            <form onSubmit={handleSaveAppointment} className="space-y-4"><fieldset disabled={saving} className="contents">
              {/* Select Patient Dropdown / Search */}
              <div className="space-y-1.5">
                <label htmlFor="input-patient-search" className="text-xs font-bold text-slate-700 block">المريض المسجل</label>
                <input
                  id="input-patient-search"
                  data-dialog-autofocus
                  type="text"
                  value={patientSearch}
                  onChange={e => {
                    setPatientSearch(e.target.value);
                    setSelectedPatientId('');
                  }}
                  placeholder="ابحث بالاسم أو الهاتف أو رقم الملف"
                  className="w-full px-3.5 py-3 rounded-2xl border border-slate-200 text-base font-bold text-slate-900 outline-none focus:ring-2 focus:ring-indigo-200"
                />

                {!selectedPatientId && (
                  <div className="bg-slate-50 border border-slate-200 rounded-2xl max-h-40 overflow-y-auto p-1 space-y-1 mt-1">
                    {filteredPatientsDropdown.map(p => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          setSelectedPatientId(p.id);
                          setPatientSearch(`${p.name} (ملف #${p.id})`);
                        }}
                        className="w-full text-right p-2.5 rounded-xl hover:bg-indigo-50 text-sm font-bold text-slate-800 flex items-center justify-between gap-2 min-h-[44px] touch-manipulation"
                      >
                        <span className="break-words min-w-0">{p.name}</span>
                        <span className="text-slate-500 font-mono shrink-0">#{p.id}</span>
                      </button>
                    ))}
                    {filteredPatientsDropdown.length === 0 && <p className="p-3 text-sm text-slate-600">لا توجد نتائج. المريض الجديد يحتاج ملفًا من قسم المرضى أولًا.</p>}
                  </div>
                )}
              </div>

              {/* Date & Time selectors */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label htmlFor="input-appt-date" className="text-xs font-bold text-slate-700 block">التاريخ</label>
                  <input
                    id="input-appt-date"
                    type="date"
                    required
                    value={apptDate}
                    onChange={e => setApptDate(e.target.value)}
                    className="w-full px-3.5 py-3 rounded-2xl border border-slate-200 text-base font-bold text-slate-900 outline-none font-mono"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="input-appt-hour" className="text-xs font-bold text-slate-700 block">الوقت</label>
                  <div className="grid grid-cols-3 gap-1.5">
                    <select
                      id="input-appt-hour"
                      aria-label="ساعة الموعد"
                      value={apptHour}
                      onChange={e => setApptHour(e.target.value)}
                      className="px-2 py-3 rounded-xl border border-slate-200 text-base font-bold text-slate-900 outline-none"
                    >
                      {['01','02','03','04','05','06','07','08','09','10','11','12'].map(h => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>

                    <select
                      aria-label="دقائق الموعد"
                      value={apptMin}
                      onChange={e => setApptMin(e.target.value)}
                      className="px-2 py-3 rounded-xl border border-slate-200 text-base font-bold text-slate-900 outline-none"
                    >
                      {['00','15','30','45'].map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>

                    <select
                      aria-label="فترة الموعد"
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

              <label className="flex items-center gap-2 min-h-[44px] text-sm font-bold text-slate-700 cursor-pointer">
                <input type="checkbox" checked={isFollowUp} onChange={event => setIsFollowUp(event.target.checked)} className="w-4 h-4 accent-indigo-600" />
                موعد متابعة
              </label>

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
                  disabled={saving} onClick={() => { if (!saving) setIsModalOpen(false); }}
                  className="px-5 py-3.5 min-h-[48px] rounded-2xl bg-slate-100 hover:bg-slate-200 active:scale-[0.98] text-slate-700 font-bold text-sm cursor-pointer transition-all touch-manipulation"
                >
                  إلغاء وإغلاق
                </button>
              </div>
            </fieldset></form>
          </div>
        </div>
      )}

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
