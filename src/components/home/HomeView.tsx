import React, { useMemo, useState } from 'react';
import {
  AlertCircle, Banknote, Calendar, CheckCircle2, ChevronLeft, Clock,
  FileText, Landmark, Microscope, Receipt, Search,
  Stethoscope, UserPlus, X
} from 'lucide-react';
import { ActiveView, Appointment, Expense, Patient, UILabels, User as UserType } from '../../types';
import { getHomeSubtitle, getHomeWelcome } from '../../utils/clinicContent';
import { calculateDailyCollections, getPatientFinancialSummary } from '../../utils/financials';
import { canAccessView, canPerformAction } from '../../utils/rbac';

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

type Tone = 'indigo' | 'emerald' | 'amber' | 'rose' | 'purple' | 'teal';
const tones: Record<Tone, { icon: string; hover: string }> = {
  indigo: { icon: 'bg-indigo-100 text-indigo-700', hover: 'hover:border-indigo-300' },
  emerald: { icon: 'bg-emerald-100 text-emerald-700', hover: 'hover:border-emerald-300' },
  amber: { icon: 'bg-amber-100 text-amber-700', hover: 'hover:border-amber-300' },
  rose: { icon: 'bg-rose-100 text-rose-700', hover: 'hover:border-rose-300' },
  purple: { icon: 'bg-purple-100 text-purple-700', hover: 'hover:border-purple-300' },
  teal: { icon: 'bg-teal-100 text-teal-700', hover: 'hover:border-teal-300' },
};

const money = (value: number, hidden: boolean) => hidden
  ? '••••••'
  : new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 }).format(value) + ' ج.م';

const normalizeSearch = (value: string) => value.trim().toLocaleLowerCase('ar')
  .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
  .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));

const localDateKey = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};

const MetricCard: React.FC<{
  title: string; value: string | number; note: string; icon: React.ReactNode;
  tone: Tone; onClick?: () => void;
}> = ({ title, value, note, icon, tone, onClick }) => {
  const content = <>
    <span aria-hidden="true" className={'dashboard-icon ' + tones[tone].icon}>{icon}</span>
    <span className="mt-4 block text-2xl font-black text-slate-950 sm:text-3xl">{value}</span>
    <span className="mt-1 block text-sm font-extrabold text-slate-800">{title}</span>
    <span className="mt-1 block text-xs font-medium text-slate-500">{note}</span>
  </>;
  return onClick
    ? <button type="button" onClick={onClick} className={'dashboard-card text-start ' + tones[tone].hover}>{content}</button>
    : <div className="dashboard-card text-start">{content}</div>;
};

export const HomeView: React.FC<HomeViewProps> = React.memo(({
  clinicName, labels, activeLabCount,
  onNavigate, currentUser, patients = [], appointments = [], expenses = [],
  isPrivacyMode = false, onSelectPatient, onOpenWalkIn, onOpenDailyReport,
  onOpenScheduleModal, onOpenInvoiceModal, onOpenPayment
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const today = localDateKey();
  const user = currentUser ?? null;
  const canPatients = canAccessView(user, 'patients');
  const canAppointments = canAccessView(user, 'appointments');
  const canLab = canAccessView(user, 'lab');
  const canFinance = canAccessView(user, 'summary');
  const canSettings = canAccessView(user, 'settings');
  const canRegisterPayment = canPatients && canPerformAction(user, 'register_payment');
  const canWalkIn = canPatients && canPerformAction(user, 'add_patient') && canRegisterPayment;
  const canViewCollections = canPerformAction(user, 'view_today_collections');
  const canViewRemaining = canPerformAction(user, 'view_remaining_balance');
  const canViewExpenses = canFinance && canPerformAction(user, 'view_expenses');
  const canReports = canViewCollections && canPerformAction(user, 'financial_reports');
  const showActions = !!((canWalkIn && onOpenWalkIn) || (canAppointments && onOpenScheduleModal)
    || canRegisterPayment || (canViewExpenses && onOpenInvoiceModal) || (canReports && onOpenDailyReport));

  const stats = useMemo(() => {
    const dayAppointments = appointments
      .filter(item => item.date === today)
      .sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    const dailyCollections = calculateDailyCollections(patients, date => date === today);
    const collected = dailyCollections.totalIncomeCollected;
    const spent = expenses.filter(expense => expense.date === today)
      .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
    const outstanding = patients.reduce(
      (total, patient) => total + getPatientFinancialSummary(patient).totalRemaining,
      0
    );
    return {
      dayAppointments, collected, spent, outstanding,
      waiting: dayAppointments.filter(item => item.status === 'waiting' || item.status === 'confirmed').length,
      completed: dayAppointments.filter(item => item.status === 'attended').length,
      noShow: dayAppointments.filter(item => item.status === 'no_show').length,
    };
  }, [appointments, expenses, patients, today]);

  const showAlerts = (canAppointments && stats.noShow > 0)
    || (canLab && activeLabCount > 0) || (canViewExpenses && stats.spent > 0);
  const subtitle = getHomeSubtitle(labels);

  const filteredPatients = useMemo(() => {
    const query = normalizeSearch(searchQuery).replace(/^#\s*/, '');
    if (!query) return [];
    const phoneQuery = query.replace(/[\s()+-]/g, '');
    return patients.filter(patient => normalizeSearch(patient.name).includes(query)
      || (!!phoneQuery && normalizeSearch(patient.mobile).replace(/[\s()+-]/g, '').includes(phoneQuery))
      || normalizeSearch(patient.id).includes(query)).slice(0, 6);
  }, [patients, searchQuery]);

  const statusLabel: Record<string, string> = {
    scheduled: 'محجوز', waiting: 'في الانتظار', attended: 'تم الحضور', no_show: 'لم يحضر',
    apologized: 'اعتذر', confirmed: 'مؤكد', cancelled: 'ملغي'
  };

  return (
    <div className="dashboard-shell" dir="rtl">
      <section className="dashboard-hero">
        <div className="min-w-0">
          <p className="dashboard-eyebrow">لوحة التشغيل اليومية</p>
          <h1 className="dashboard-title">{clinicName || 'نظام إدارة عيادة الأسنان'}</h1>
          <p className="dashboard-subtitle">{subtitle}</p>
        </div>
        <div className="dashboard-date"><Clock aria-hidden="true" /><span>{new Date().toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' })}</span></div>
      </section>

      {canPatients && (
        <section role="search" aria-label="البحث في ملفات المرضى" className="dashboard-search-panel" onFocus={() => setIsSearchFocused(true)}
          onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsSearchFocused(false); }}>
          <Search aria-hidden="true" className="pointer-events-none absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
          <input aria-label="البحث عن مريض بالاسم أو الهاتف أو رقم الملف" aria-controls="dashboard-patient-results"
            value={searchQuery} onChange={event => setSearchQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { setIsSearchFocused(false); event.currentTarget.blur(); } }}
            className="dashboard-search-input" placeholder="اسم المريض، الهاتف أو رقم الملف" autoComplete="off" />
          {searchQuery && <button type="button" aria-label="مسح البحث" className="dashboard-search-clear" onClick={() => setSearchQuery('')}><X aria-hidden="true" /></button>}
          {searchQuery.trim() && isSearchFocused && (
            <div id="dashboard-patient-results" className="dashboard-search-results">
              {filteredPatients.length ? filteredPatients.map(patient => (
                <button key={patient.id} type="button" className="dashboard-search-result" onClick={() => { onSelectPatient?.(patient.id, 'home'); setSearchQuery(''); }}>
                  <span className="dashboard-avatar">{patient.name.charAt(0)}</span>
                  <span className="min-w-0 flex-1"><strong>{patient.name}</strong><small>ملف <bdi>{patient.id}</bdi> · <bdi>{patient.mobile}</bdi></small></span>
                  <ChevronLeft aria-hidden="true" />
                </button>
              )) : <p className="p-4 text-center text-sm font-bold text-slate-500">لا توجد نتائج مطابقة</p>}
            </div>
          )}
        </section>
      )}

      <section className="dashboard-metrics" aria-label="ملخص اليوم">
        {canAppointments && <MetricCard title="مواعيد اليوم" value={stats.dayAppointments.length} note={stats.waiting + ' في الانتظار · ' + stats.completed + ' تم الحضور'} icon={<Calendar />} tone="amber" onClick={() => onNavigate('appointments')} />}
        {canViewCollections && <MetricCard title="تحصيل اليوم" value={money(stats.collected, isPrivacyMode)} note={canReports ? 'عرض تفاصيل التحصيل اليومي' : 'إجمالي المبالغ المحصّلة اليوم'} icon={<Banknote />} tone="emerald"
          onClick={canReports ? () => onOpenDailyReport ? onOpenDailyReport() : onNavigate('summary') : undefined} />}
        {canViewRemaining && <MetricCard title="الأرصدة المتبقية" value={money(stats.outstanding, isPrivacyMode)} note="مستحقات ملفات المرضى" icon={<Landmark />} tone="rose" onClick={canFinance ? () => onNavigate('summary') : undefined} />}
        {canLab && <MetricCard title="حالات المعمل" value={activeLabCount} note="حالات لم تُغلق بعد" icon={<Microscope />} tone="purple" onClick={() => onNavigate('lab')} />}
      </section>

      <div className={'dashboard-main-grid' + (!canAppointments || !showActions ? ' dashboard-main-grid-single' : '')}>
        {canAppointments && <section className="dashboard-panel">
          <div className="dashboard-panel-header">
            <div><p className="dashboard-eyebrow">مسار اليوم</p><h2 className="dashboard-section-title">جدول اليوم</h2></div>
            <button type="button" className="dashboard-link" onClick={() => onNavigate('appointments')}>عرض الجدول <ChevronLeft aria-hidden="true" /></button>
          </div>
          {stats.dayAppointments.length ? (
            <div className="dashboard-appointment-list">
              {stats.dayAppointments.slice(0, 6).map(appointment => (
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
            <div className="dashboard-empty"><CheckCircle2 aria-hidden="true" /><strong>لا توجد مواعيد مسجلة اليوم</strong><span>يمكنك إضافة موعد جديد من جدول المواعيد.</span></div>
          )}
        </section>}

        {showActions && <aside className="dashboard-panel">
          <div className="dashboard-panel-header"><div><p className="dashboard-eyebrow">تنفيذ سريع</p><h2 className="dashboard-section-title">إجراءات اليوم</h2></div></div>
          <div className="dashboard-actions">
            {canWalkIn && onOpenWalkIn && <button type="button" onClick={onOpenWalkIn} className="dashboard-action"><span aria-hidden="true" className="dashboard-action-icon bg-indigo-100 text-indigo-700"><UserPlus /></span><span><strong>زيارة بدون موعد</strong><small>فتح ملف وتسجيل التحصيل</small></span><ChevronLeft aria-hidden="true" /></button>}
            {canAppointments && onOpenScheduleModal && <button type="button" onClick={onOpenScheduleModal} className="dashboard-action"><span aria-hidden="true" className="dashboard-action-icon bg-amber-100 text-amber-700"><Calendar /></span><span><strong>حجز موعد</strong><small>إضافة حجز جديد</small></span><ChevronLeft aria-hidden="true" /></button>}
            {canRegisterPayment && <button type="button" onClick={() => onOpenPayment ? onOpenPayment() : onNavigate('patients')} className="dashboard-action"><span aria-hidden="true" className="dashboard-action-icon bg-emerald-100 text-emerald-700"><Banknote /></span><span><strong>تسجيل دفعة</strong><small>تحصيل مباشر من ملف المريض</small></span><ChevronLeft aria-hidden="true" /></button>}
            {canViewExpenses && onOpenInvoiceModal && <button type="button" onClick={onOpenInvoiceModal} className="dashboard-action"><span aria-hidden="true" className="dashboard-action-icon bg-rose-100 text-rose-700"><Receipt /></span><span><strong>إضافة فاتورة مصروف</strong><small>رفع الفاتورة ومراجعة بياناتها</small></span><ChevronLeft aria-hidden="true" /></button>}
            {canReports && onOpenDailyReport && <button type="button" onClick={onOpenDailyReport} className="dashboard-action"><span aria-hidden="true" className="dashboard-action-icon bg-slate-100 text-slate-700"><FileText /></span><span><strong>التقرير اليومي</strong><small>تفاصيل الخدمات والتحصيل</small></span><ChevronLeft aria-hidden="true" /></button>}
          </div>
        </aside>}
      </div>

      {showAlerts && (
        <section className="dashboard-alerts">
          <div className="flex items-center gap-2"><AlertCircle aria-hidden="true" /><strong>تنبيهات تحتاج متابعة</strong></div>
          <div className="dashboard-alert-grid">
            {canAppointments && stats.noShow > 0 && <span>{stats.noShow} موعد لم يحضر صاحبه</span>}
            {canLab && activeLabCount > 0 && <span>{activeLabCount} حالة معمل ما زالت مفتوحة</span>}
            {canViewExpenses && stats.spent > 0 && <span>قيمة مصروفات اليوم: {money(stats.spent, isPrivacyMode)}</span>}
          </div>
        </section>
      )}


      <section className="dashboard-footer-strip">
        <Stethoscope aria-hidden="true" /><span>{getHomeWelcome(labels)}</span>
        {canSettings && <button type="button" onClick={() => onNavigate('settings')}>إعدادات العيادة <ChevronLeft aria-hidden="true" /></button>}
      </section>
    </div>
  );
});

HomeView.displayName = 'HomeView';
