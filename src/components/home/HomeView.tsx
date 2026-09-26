import React, { useMemo, useState } from 'react';
import {
  AlertCircle, Calendar, CheckCircle2, ChevronLeft, Clock, CreditCard,
  FileText, Landmark, Microscope, Receipt, Search, Settings2,
  Stethoscope, UserPlus, Users, X, Zap
} from 'lucide-react';
import { ActiveView, Appointment, Expense, Patient, UILabels, User as UserType } from '../../types';
import { calculateDailyCollections, getPatientFinancialSummary } from '../../utils/financials';

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
  : new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 0 }).format(value) + ' ج.م';

const localDateKey = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};

const MetricCard: React.FC<{
  title: string; value: string | number; note: string; icon: React.ReactNode;
  tone: Tone; onClick: () => void;
}> = ({ title, value, note, icon, tone, onClick }) => (
  <button type="button" onClick={onClick} className={'dashboard-card text-start ' + tones[tone].hover}>
    <span className={'dashboard-icon ' + tones[tone].icon}>{icon}</span>
    <span className="mt-4 block text-2xl font-black text-slate-950 sm:text-3xl">{value}</span>
    <span className="mt-1 block text-sm font-extrabold text-slate-800">{title}</span>
    <span className="mt-1 block text-xs font-medium text-slate-500">{note}</span>
  </button>
);

export const HomeView: React.FC<HomeViewProps> = React.memo(({
  clinicName, labels, tileOrder, patientCount, todayApptCount, activeLabCount,
  onNavigate, currentUser, patients = [], appointments = [], expenses = [],
  isPrivacyMode = false, onSelectPatient, onOpenWalkIn, onOpenDailyReport,
  onOpenScheduleModal, onOpenInvoiceModal
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const today = localDateKey();
  const permissions = currentUser?.permissions;
  const canPatients = permissions?.patientView !== false;
  const canAppointments = permissions?.appointments !== false;
  const canLab = permissions?.lab !== false;
  const canFinance = permissions?.summary !== false;
  const canSettings = permissions?.controlPanel !== false;

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

  const filteredPatients = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase('ar');
    if (!query) return [];
    return patients.filter(patient => patient.name.toLocaleLowerCase('ar').includes(query)
      || patient.mobile.includes(query) || patient.id.includes(query)).slice(0, 6);
  }, [patients, searchQuery]);

  const modules = {
    patients: { view: 'patients' as ActiveView, icon: <Users />, tone: 'indigo' as Tone, count: patientCount + ' ملف', allowed: canPatients, title: 'سجل المرضى', desc: 'الملفات الطبية والحسابات' },
    appointments: { view: 'appointments' as ActiveView, icon: <Calendar />, tone: 'amber' as Tone, count: todayApptCount + ' اليوم', allowed: canAppointments, title: 'المواعيد', desc: 'تنظيم الحجوزات والمتابعات' },
    lab: { view: 'lab' as ActiveView, icon: <Microscope />, tone: 'purple' as Tone, count: activeLabCount + ' نشطة', allowed: canLab, title: 'التركيبات والمعامل', desc: 'متابعة الحالات والمستحقات' },
    summary: { view: 'summary' as ActiveView, icon: <Landmark />, tone: 'emerald' as Tone, count: 'تقارير', allowed: canFinance, title: 'المالية والتقارير', desc: 'الإيرادات والمصروفات والأرباح' },
    settings: { view: 'settings' as ActiveView, icon: <Settings2 />, tone: 'teal' as Tone, count: 'إدارة', allowed: canSettings, title: 'لوحة التحكم', desc: 'المظهر والمحتوى والصلاحيات' },
  };
  const orderedModules = tileOrder
    .map(key => ({ key, module: modules[key as keyof typeof modules] }))
    .filter(item => item.module?.allowed);
  const statusLabel: Record<string, string> = {
    scheduled: 'محجوز', waiting: 'في الانتظار', attended: 'تم الكشف', no_show: 'لم يحضر',
    apologized: 'اعتذر', confirmed: 'مؤكد', cancelled: 'ملغي'
  };

  return (
    <div className="dashboard-shell" dir="rtl">
      <section className="dashboard-hero">
        <div className="min-w-0">
          <p className="dashboard-eyebrow">لوحة التشغيل اليومية</p>
          <h1 className="dashboard-title">{clinicName || 'نظام إدارة عيادة الأسنان'}</h1>
          <p className="dashboard-subtitle">{labels.homeSubtitle || 'ملخص واضح للحجوزات والتحصيل والمهام اليومية.'}</p>
        </div>
        <div className="dashboard-date"><Clock /><span>{new Date().toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' })}</span></div>
      </section>

      {canPatients && (
        <section className="dashboard-search-panel">
          <Search className="pointer-events-none absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
          <input value={searchQuery} onChange={event => setSearchQuery(event.target.value)} className="dashboard-search-input" placeholder="ابحث باسم المريض أو رقم الهاتف أو رقم الملف" />
          {searchQuery && <button type="button" className="dashboard-search-clear" onClick={() => setSearchQuery('')}><X /></button>}
          {searchQuery && (
            <div className="dashboard-search-results">
              {filteredPatients.length ? filteredPatients.map(patient => (
                <button key={patient.id} type="button" className="dashboard-search-result" onClick={() => { onSelectPatient?.(patient.id, 'home'); setSearchQuery(''); }}>
                  <span className="dashboard-avatar">{patient.name.charAt(0)}</span>
                  <span className="min-w-0 flex-1"><strong>{patient.name}</strong><small>ملف {patient.id} · {patient.mobile}</small></span>
                  <ChevronLeft />
                </button>
              )) : <p className="p-4 text-center text-sm font-bold text-slate-500">لا توجد نتائج مطابقة</p>}
            </div>
          )}
        </section>
      )}

      <section className="dashboard-metrics">
        <MetricCard title="مواعيد اليوم" value={stats.dayAppointments.length} note={stats.waiting + ' في الانتظار · ' + stats.completed + ' تم الكشف'} icon={<Calendar />} tone="amber" onClick={() => onNavigate('appointments')} />
        {canFinance ? (
          <>
            <MetricCard title="تحصيل اليوم" value={money(stats.collected, isPrivacyMode)} note="اضغط لمعرفة من دفع اليوم" icon={<CreditCard />} tone="emerald" onClick={() => onOpenDailyReport ? onOpenDailyReport() : onNavigate('summary')} />
            <MetricCard title="الأرصدة المتبقية" value={money(stats.outstanding, isPrivacyMode)} note="مستحقات ملفات المرضى" icon={<Landmark />} tone="rose" onClick={() => onNavigate('summary')} />
          </>
        ) : (
          <MetricCard title="تحصيل مريض" value="تسجيل دفعة" note="بدون عرض إجمالي إيراد العيادة" icon={<CreditCard />} tone="emerald" onClick={() => onNavigate('secretary-desk')} />
        )}
        {canLab && <MetricCard title="حالات المعمل" value={activeLabCount} note="حالات لم تُغلق بعد" icon={<Microscope />} tone="purple" onClick={() => onNavigate('lab')} />}
      </section>

      <div className="dashboard-main-grid">
        <section className="dashboard-panel lg:col-span-2">
          <div className="dashboard-panel-header">
            <div><p className="dashboard-eyebrow">مسار اليوم</p><h2 className="dashboard-section-title">المواعيد القادمة</h2></div>
            <button type="button" className="dashboard-link" onClick={() => onNavigate('appointments')}>عرض الجدول <ChevronLeft /></button>
          </div>
          {stats.dayAppointments.length ? (
            <div className="dashboard-appointment-list">
              {stats.dayAppointments.slice(0, 6).map(appointment => (
                <button key={appointment.id} type="button" onClick={() => onSelectPatient?.(appointment.patientId, 'home')} className="dashboard-appointment">
                  <span className="dashboard-time">{appointment.time || '--:--'}</span>
                  <span className="min-w-0 flex-1 text-start"><strong>{appointment.patientName}</strong><small>{appointment.note || 'موعد كشف'}</small></span>
                  <span className={'dashboard-status status-' + appointment.status}>{statusLabel[appointment.status] || appointment.status}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="dashboard-empty"><CheckCircle2 /><strong>لا توجد مواعيد مسجلة اليوم</strong><span>أضف موعدًا جديدًا من الإجراءات السريعة.</span></div>
          )}
        </section>

        <aside className="dashboard-panel">
          <div className="dashboard-panel-header"><div><p className="dashboard-eyebrow">تنفيذ سريع</p><h2 className="dashboard-section-title">أهم الإجراءات</h2></div><Zap className="text-amber-500" /></div>
          <div className="dashboard-actions">
            {canPatients && <button type="button" onClick={onOpenWalkIn} className="dashboard-action"><span className="dashboard-action-icon bg-indigo-100 text-indigo-700"><UserPlus /></span><span><strong>زيارة بدون موعد</strong><small>فتح ملف وتسجيل التحصيل</small></span><ChevronLeft /></button>}
            {canAppointments && <button type="button" onClick={onOpenScheduleModal} className="dashboard-action"><span className="dashboard-action-icon bg-amber-100 text-amber-700"><Calendar /></span><span><strong>حجز موعد</strong><small>إضافة حجز جديد بسرعة</small></span><ChevronLeft /></button>}
            <button type="button" onClick={() => onNavigate('secretary-desk')} className="dashboard-action"><span className="dashboard-action-icon bg-emerald-100 text-emerald-700"><CreditCard /></span><span><strong>تسجيل دفعة</strong><small>تحصيل مبلغ من مريض</small></span><ChevronLeft /></button>
            {canFinance && <button type="button" onClick={onOpenInvoiceModal} className="dashboard-action"><span className="dashboard-action-icon bg-rose-100 text-rose-700"><Receipt /></span><span><strong>إضافة مصروف</strong><small>تسجيل فاتورة أو مصروف</small></span><ChevronLeft /></button>}
            {onOpenDailyReport && <button type="button" onClick={onOpenDailyReport} className="dashboard-action"><span className="dashboard-action-icon bg-slate-100 text-slate-700"><FileText /></span><span><strong>التقرير اليومي</strong><small>ملخص الحركة والتحصيل</small></span><ChevronLeft /></button>}
          </div>
        </aside>
      </div>

      {(stats.noShow > 0 || stats.spent > 0 || activeLabCount > 0) && (
        <section className="dashboard-alerts">
          <div className="flex items-center gap-2"><AlertCircle /><strong>تنبيهات تحتاج متابعة</strong></div>
          <div className="dashboard-alert-grid">
            {stats.noShow > 0 && <span>{stats.noShow} موعد لم يحضر صاحبه</span>}
            {activeLabCount > 0 && <span>{activeLabCount} حالة معمل ما زالت مفتوحة</span>}
            {canFinance && stats.spent > 0 && <span>مصروفات اليوم: {money(stats.spent, isPrivacyMode)}</span>}
          </div>
        </section>
      )}

      <section>
        <div className="dashboard-section-heading"><div><p className="dashboard-eyebrow">الإدارة</p><h2 className="dashboard-section-title">أقسام النظام</h2></div><span>الترتيب والمسميات من لوحة التحكم</span></div>
        <div className="dashboard-modules">
          {orderedModules.map(({ key, module }) => {
            const configured = labels.tiles[key];
            return (
              <button key={key} type="button" onClick={() => onNavigate(module.view)} className={'dashboard-module ' + tones[module.tone].hover}>
                <span className={'dashboard-icon ' + tones[module.tone].icon}>{module.icon}</span>
                <span className="dashboard-module-count">{module.count}</span>
                <strong>{configured?.title || module.title}</strong><small>{configured?.desc || module.desc}</small><ChevronLeft className="dashboard-module-arrow" />
              </button>
            );
          })}
        </div>
      </section>

      <section className="dashboard-footer-strip">
        <Stethoscope /><span>{labels.welcomeText || 'اختر الإجراء المطلوب للمتابعة'}</span>
        {canSettings && <button type="button" onClick={() => onNavigate('settings')}>فتح لوحة التحكم <ChevronLeft /></button>}
      </section>
    </div>
  );
});

HomeView.displayName = 'HomeView';

