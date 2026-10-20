import React, { useDeferredValue, useMemo, useState, useEffect, useRef } from 'react';
import {
  AlertCircle, Banknote, Calendar, CheckCircle2, ChevronLeft, Clock,
  FileText, Landmark, Microscope, Receipt, Search,
  UserPlus, X
} from 'lucide-react';
import { ActiveView, Appointment, Expense, Patient, UILabels, User as UserType } from '../../types';
import { calculateDailyCollections, getPatientFinancialSummary } from '../../utils/financials';
import { canAccessView, canPerformAction } from '../../utils/rbac';
import { getHomeActionAccess } from '../../utils/homeActions';
import { buildHomePatientSearch, searchHomePatients } from '../../utils/homePatientSearch';
import {hasPatientFile} from '../../utils/patientFileIdentity';
import { getHomeClockDisplay } from '../../utils/homeClock';
import { useHomeClock } from '../../hooks/useHomeClock';
import { getHomeLayout } from '../../utils/homeLayout';
import { DashboardActionButton, DashboardMetricCard as MetricCard, type DashboardTone as Tone } from './DashboardPrimitives';
import './HomeView.css';

interface HomeViewProps {
  clinicName: string;
  clinicLogo: string | null;
  labels: UILabels;
  tileOrder: string[];
  patientCount: number;
  todayApptCount: number;
  activeLabCount: number;
  onNavigate: (view: ActiveView, subTab?: string) => void;
  currentUser?: UserType | null;
  patients?: Patient[];
  appointments?: Appointment[];
  expenses?: Expense[];
  isPrivacyMode?: boolean;
  onSelectPatient?: (patientId: string, origin: any) => void;
  onLogout?: () => void;
  onOpenWalkIn?: () => void;
  onOpenDailyReport?: () => void;
  onOpenScheduleModal?: () => void;
  onOpenInvoiceModal?: () => void;
  onOpenPayment?: () => void;
}

const numberFormat = new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 });
const money = (value: number, hidden: boolean) => hidden
  ? '••••••'
  : numberFormat.format(value) + ' ج.م';

const EMPTY_PATIENTS: Patient[] = [];
const EMPTY_APPOINTMENTS: Appointment[] = [];
const EMPTY_EXPENSES: Expense[] = [];

export const HomeView: React.FC<HomeViewProps> = React.memo(({
  activeLabCount, labels,
  onNavigate, currentUser, patients = EMPTY_PATIENTS, appointments = EMPTY_APPOINTMENTS, expenses = EMPTY_EXPENSES,
  isPrivacyMode = false, onSelectPatient, onOpenWalkIn, onOpenDailyReport,
  onOpenScheduleModal, onOpenInvoiceModal, onOpenPayment
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearch = useDeferredValue(searchQuery);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [selectedPatientIndex, setSelectedPatientIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const clock = useHomeClock();
  const clockDisplay = useMemo(() => getHomeClockDisplay(clock), [clock]);
  const today = clockDisplay.day;
  const user = currentUser ?? null;
  const canPatients = canAccessView(user, 'patients');
  const canAppointments = canAccessView(user, 'appointments');
  const canLab = canAccessView(user, 'lab');
  const canFinance = canAccessView(user, 'summary');
  const actionAccess = getHomeActionAccess(user);
  const layout = useMemo(() => getHomeLayout(labels), [labels]);
  const visibleSections = layout.sectionOrder.filter(key => !layout.hiddenSections.includes(key));
  const canViewCollections = canPerformAction(user, 'view_today_collections');
  const canViewRemaining = canPerformAction(user, 'view_remaining_balance');
  const canViewExpenses = canFinance && canPerformAction(user, 'view_expenses');
  const actions = [
    { id: 'walkin', allowed: actionAccess.walkIn && !!onOpenWalkIn, title: 'زيارة بدون موعد', note: 'مريض مسجل أو جديد · خدمة وتحصيل', icon: <UserPlus />, tone: 'indigo' as Tone, run: onOpenWalkIn, dialog: true },
    { id: 'schedule', allowed: actionAccess.schedule && !!onOpenScheduleModal, title: 'حجز موعد', note: 'اختيار ملف وموعد · بدون تحصيل', icon: <Calendar />, tone: 'amber' as Tone, run: onOpenScheduleModal, dialog: true },
    { id: 'payment', allowed: actionAccess.payment, title: 'تسجيل دفعة', note: 'سداد خدمة سابقة · لا تُنشئ زيارة', icon: <Banknote />, tone: 'emerald' as Tone, run: onOpenPayment || (() => onNavigate('patients')), dialog: !!onOpenPayment },
    { id: 'report', allowed: actionAccess.report && !!onOpenDailyReport, title: 'التقرير اليومي', note: 'من دفع والخدمات المنفذة · للعرض', icon: <FileText />, tone: 'teal' as Tone, run: onOpenDailyReport, dialog: true },
    { id: 'invoice', allowed: actionAccess.invoice && !isPrivacyMode && !!onOpenInvoiceModal, title: 'إضافة فاتورة مصروف', note: 'صورة الفاتورة والأصناف · مراجعة أولًا', icon: <Receipt />, tone: 'rose' as Tone, run: onOpenInvoiceModal, dialog: true },
  ].filter(action => action.allowed);

  const stats = useMemo(() => {
    const dayAppointments = appointments
      .filter(item => item.date === today)
      .sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    const collected = canViewCollections && !isPrivacyMode
      ? calculateDailyCollections(patients, date => date === today).totalIncomeCollected : 0;
    const spent = canViewExpenses && !isPrivacyMode ? expenses.filter(expense => expense.date === today)
      .reduce((sum, expense) => sum + Number(expense.amount || 0), 0)
      : 0;
    const outstanding = canViewRemaining && !isPrivacyMode ? patients.reduce(
      (total, patient) => total + getPatientFinancialSummary(patient).totalRemaining,
      0
    ) : 0;
    return {
      dayAppointments, collected, spent, outstanding,
      waiting: dayAppointments.filter(item => item.status === 'waiting' || item.status === 'confirmed').length,
      completed: dayAppointments.filter(item => item.status === 'attended').length,
      noShow: dayAppointments.filter(item => item.status === 'no_show').length,
    };
  }, [appointments, expenses, patients, today, canViewCollections, canViewExpenses, canViewRemaining, isPrivacyMode]);

  const showAlerts = (canAppointments && stats.noShow > 0)
    || (canLab && activeLabCount > 0) || (canViewExpenses && stats.spent > 0);
  const searchIndex = useMemo(() => buildHomePatientSearch(canPatients ? patients.filter(hasPatientFile) : EMPTY_PATIENTS), [patients, canPatients]);
  const filteredPatients = useMemo(() => searchHomePatients(searchIndex, deferredSearch, 6), [searchIndex, deferredSearch]);
  const searchPending = searchQuery !== deferredSearch;
  useEffect(() => { setSelectedPatientIndex(0); }, [deferredSearch, filteredPatients]);
  const activePatientIndex = Math.min(selectedPatientIndex, Math.max(0, filteredPatients.length - 1));
  const openPatient = (patient: Patient) => {
    if (searchPending) return;
    if (onSelectPatient) onSelectPatient(patient.id, 'home');
    else onNavigate('patients');
    setSearchQuery('');
    setIsSearchFocused(false);
  };

  const statusLabel: Record<string, string> = {
    scheduled: 'محجوز', waiting: 'في الانتظار', attended: 'تم الحضور', no_show: 'لم يحضر',
    apologized: 'اعتذر', confirmed: 'مؤكد', cancelled: 'ملغي'
  };

  return (
    <div className="dashboard-shell home-workspace" dir="rtl" data-home-density={layout.density}>
      <h1 className="sr-only">لوحة اليوم</h1>
      <section className="home-today-strip" aria-label="تاريخ اليوم والوقت المحلي">
        <div><Calendar aria-hidden="true" /><time dateTime={clockDisplay.day}>{clockDisplay.dateLabel}</time></div>
        <div><Clock aria-hidden="true" /><time dateTime={clockDisplay.instant} aria-label={`الساعة ${clockDisplay.timeLabel}`}>{clockDisplay.timeLabel}</time></div>
      </section>

      {canPatients && (
        <section role="search" aria-label="البحث في ملفات المرضى" className="dashboard-search-panel" onFocus={() => setIsSearchFocused(true)}
          onKeyDown={event => {
            if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
              searchInputRef.current?.focus();
              setIsSearchFocused(false);
            }
          }}
          onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsSearchFocused(false); }}>
          <Search aria-hidden="true" className="pointer-events-none absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
          <input ref={searchInputRef} role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-label="البحث عن مريض بالاسم أو الهاتف أو رقم الملف"
            aria-controls={searchQuery.trim() && isSearchFocused ? 'dashboard-patient-results' : undefined} aria-expanded={!!searchQuery.trim() && isSearchFocused}
            aria-activedescendant={isSearchFocused && !searchPending && filteredPatients.length ? `dashboard-patient-result-${activePatientIndex}` : undefined}
            value={searchQuery} onChange={event => setSearchQuery(event.target.value)} onKeyDown={event => {
              if (event.nativeEvent.isComposing) return;
              if (searchPending || !filteredPatients.length) return;
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault(); setIsSearchFocused(true);
                setSelectedPatientIndex(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + filteredPatients.length) % filteredPatients.length);
              }
              if (event.key === 'Enter' && isSearchFocused) { event.preventDefault(); openPatient(filteredPatients[activePatientIndex]); }
            }}
            className="dashboard-search-input" placeholder="اسم المريض، الهاتف أو رقم الملف" autoComplete="off" />
          {searchQuery && <button type="button" aria-label="مسح البحث" className="dashboard-search-clear" onClick={() => setSearchQuery('')}><X aria-hidden="true" /></button>}
          {searchQuery.trim() && isSearchFocused && (
            <div id="dashboard-patient-results" role="listbox" aria-label="نتائج ملفات المرضى" className="dashboard-search-results" aria-busy={searchPending}>
              {searchPending ? <p className="home-search-message" role="status">جارٍ البحث…</p> : filteredPatients.length ? filteredPatients.map((patient, index) => (
                <button key={patient.id} id={`dashboard-patient-result-${index}`} role="option" aria-selected={activePatientIndex === index}
                  type="button" className="dashboard-search-result" onClick={() => openPatient(patient)}>
                  <span className="dashboard-avatar">{patient.name.charAt(0)}</span>
                  <span className="min-w-0 flex-1"><strong>{patient.name}</strong><small>ملف <bdi>{patient.id}</bdi> · <bdi>{patient.mobile}</bdi></small></span>
                  <ChevronLeft aria-hidden="true" />
                </button>
              )) : <p className="home-search-message" role="status">لا توجد نتائج مطابقة</p>}
            </div>
          )}
        </section>
      )}

      {visibleSections.map(key => <React.Fragment key={key}>
      {key === 'actions' && actions.length > 0 && <section className="home-actions-panel" data-home-section="actions" aria-labelledby="home-actions-title">
        <div className="home-section-heading"><h2 id="home-actions-title">إجراءات اليوم</h2><p>اختصارات حسب صلاحيات حسابك</p></div>
        <div className="home-action-grid">
          {actions.map(action => <DashboardActionButton key={action.id} className={`home-action-${action.id}`}
            title={action.title} note={action.note} icon={action.icon} tone={action.tone} dialog={action.dialog} onClick={action.run!} />)}
        </div>
      </section>}

      {key === 'metrics' && (canAppointments || canViewCollections || canViewRemaining || canLab) && <section className="dashboard-metrics" data-home-section="metrics" aria-label="ملخص اليوم">
        {canAppointments && <MetricCard title="مواعيد اليوم" value={stats.dayAppointments.length} note={stats.waiting + ' في الانتظار · ' + stats.completed + ' تم الحضور'} icon={<Calendar />} tone="amber" onClick={() => onNavigate('appointments')} />}
        {canViewCollections && <MetricCard title="تحصيل اليوم" value={money(stats.collected, isPrivacyMode)} note={actionAccess.report ? 'من دفع اليوم والخدمات المسجلة' : 'إجمالي المبالغ المحصّلة اليوم'} icon={<Banknote />} tone="emerald"
          onClick={actionAccess.report && onOpenDailyReport ? onOpenDailyReport : undefined} />}
        {canViewRemaining && <MetricCard title="الأرصدة المتبقية" value={money(stats.outstanding, isPrivacyMode)} note="مستحقات ملفات المرضى" icon={<Landmark />} tone="rose" onClick={canFinance ? () => onNavigate('summary') : undefined} />}
        {canLab && <MetricCard title="حالات المعمل" value={activeLabCount} note="حالات لم تُغلق بعد" icon={<Microscope />} tone="purple" onClick={() => onNavigate('lab')} />}
      </section>}

        {key === 'schedule' && canAppointments && <section className="dashboard-panel" data-home-section="schedule">
          <div className="dashboard-panel-header">
            <div><p className="dashboard-eyebrow">مسار اليوم</p><h2 className="dashboard-section-title">جدول اليوم</h2></div>
            <button type="button" className="dashboard-link" onClick={() => onNavigate('appointments')}>عرض الجدول <ChevronLeft aria-hidden="true" /></button>
          </div>
          {stats.dayAppointments.length ? (
            <div className="dashboard-appointment-list">
              {stats.dayAppointments.slice(0, layout.appointmentLimit).map(appointment => (
                <button key={appointment.id} type="button" onClick={() => {
                  if (canPatients && onSelectPatient && patients.some(patient => patient.id === appointment.patientId)) onSelectPatient(appointment.patientId, 'home');
                  else onNavigate('appointments');
                }} className="dashboard-appointment">
                  <span className="dashboard-time">{appointment.time || '--:--'}</span>
                  <span className="min-w-0 flex-1 text-start"><strong>{appointment.patientName}</strong><small>{appointment.note || 'موعد كشف'}</small></span>
                  <span className={'dashboard-status status-' + appointment.status}>{statusLabel[appointment.status] || appointment.status}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="dashboard-empty"><CheckCircle2 aria-hidden="true" /><strong>لا توجد مواعيد مسجلة اليوم</strong><span>{!canPatients ? 'تظهر هنا المواعيد المتاحة لحسابك عند تسجيلها.' : patients.length ? 'يمكنك متابعة الحجوزات من جدول المواعيد.' : 'ابدأ بإضافة أول مريض، ثم سجّل موعده من ملفه.'}</span>{!patients.length && canPatients && canPerformAction(user,'add_patient') && <button type="button" className="clinic-next-action" onClick={()=>onNavigate('patients')}>إضافة أول مريض</button>}</div>
          )}
          {stats.dayAppointments.length > layout.appointmentLimit && <p className="home-schedule-more">يظهر {layout.appointmentLimit.toLocaleString('ar-EG')} من {stats.dayAppointments.length.toLocaleString('ar-EG')} مواعيد اليوم. باقي المواعيد في الجدول الكامل.</p>}
        </section>}


      {key === 'followUp' && showAlerts && (
        <section className="dashboard-alerts" data-home-section="followUp">
          <div className="flex items-center gap-2"><AlertCircle aria-hidden="true" /><strong>تنبيهات تحتاج متابعة</strong></div>
          <div className="dashboard-alert-grid">
            {canAppointments && stats.noShow > 0 && <span>{stats.noShow} موعد لم يحضر صاحبه</span>}
            {canLab && activeLabCount > 0 && <span>{activeLabCount} حالة معمل ما زالت مفتوحة</span>}
            {canViewExpenses && stats.spent > 0 && <span>قيمة مصروفات اليوم: {money(stats.spent, isPrivacyMode)}</span>}
          </div>
        </section>
      )}
      </React.Fragment>)}

    </div>
  );
});

HomeView.displayName = 'HomeView';
