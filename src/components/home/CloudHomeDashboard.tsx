import React from 'react';
import { AlertCircle, Banknote, Calendar, CheckCircle2, ChevronLeft, FileText, Landmark, Microscope, Receipt, RefreshCw, Search, UserPlus, X } from 'lucide-react';
import type { CloudClinicOverviewState } from '../../utils/cloudClinicOverviewController';
import { filterCloudOverviewDirectory, formatCloudClinicCents } from '../../utils/cloudClinicOverviewProjection';
import { DashboardActionButton, DashboardMetricCard } from './DashboardPrimitives';
import './HomeView.css';

export interface CloudHomeDashboardProps {
  state: Readonly<CloudClinicOverviewState>; disabled?: boolean;
  onRefresh(): void; onQuery(value: string): void; onOpenPatient(id: string): void;
  onNavigate?(section: string): void;
}
const statusLabels: Record<string, string> = { scheduled:'محجوز', waiting:'في الانتظار', attended:'تم الحضور', no_show:'لم يحضر', apologized:'اعتذر', confirmed:'مؤكد', cancelled:'ملغي' };

/** Same dashboard presentation as HomeView, fed only by the complete protected
 * cloud snapshot. Missing/unconfirmed records never become zero balances. */
export function CloudHomeDashboard(props: CloudHomeDashboardProps) {
  const { state } = props, blocked = Boolean(props.disabled || state.closed || state.loading || state.exporting);
  const snapshot = state.closed ? null : state.snapshot, projection = state.closed ? null : state.projection, layout = snapshot?.settings.clinicSettings.data.content.homeLayout;
  const sectionOrder = layout?.sectionOrder ?? (['actions', 'metrics', 'schedule', 'followUp'] as const);
  const run = (work: () => void) => { if (!blocked) work(); };
  const navigate = (key: string) => run(() => props.onNavigate?.(key));
  const results = projection && state.directoryQuery.trim()
    ? [...new Map(filterCloudOverviewDirectory(projection, state.directoryQuery, 'files').flatMap(row => row.files).map(file => [file.patientRecordId, file])).values()].slice(0, 6) : [];
  const totals = projection?.totals, appointments = projection?.appointments ?? [];
  const activeLabs = snapshot?.records.labCases.filter(row => row.status !== 'delivered').length;
  const waiting = appointments.filter(row => ['waiting', 'confirmed'].includes(row.data.status)).length;
  const completed = appointments.filter(row => row.data.status === 'attended').length;
  const noShow = appointments.filter(row => row.data.status === 'no_show').length;
  const metricMoney = (value: string) => <bdi>{formatCloudClinicCents(value)}</bdi>;
  const sections: Record<string, React.ReactNode> = {
    actions: <section className="home-actions-panel" key="actions" data-home-section="actions">
      <div className="home-section-heading"><h2>إجراءات اليوم</h2><p>المهام اليومية في مكان واحد</p></div>
      <div className="home-action-grid">
        <DashboardActionButton title="زيارة بدون موعد" note="مريض مسجل أو جديد · خدمة وتحصيل" icon={<UserPlus/>} tone="indigo" disabled={blocked || !props.onNavigate} onClick={() => navigate('walk-in')}/>
        <DashboardActionButton title="حجز موعد" note="اختيار ملف وموعد · بدون تحصيل" icon={<Calendar/>} tone="amber" disabled={blocked || !props.onNavigate} onClick={() => navigate('appointments')}/>
        <DashboardActionButton title="تسجيل دفعة" note="اختر ملف المريض لسداد خدمة سابقة" icon={<Banknote/>} tone="emerald" disabled={blocked || !props.onNavigate} onClick={() => navigate('patients')}/>
        <DashboardActionButton title="التقرير اليومي" note="من دفع والخدمات المنفذة · للعرض" icon={<FileText/>} tone="teal" disabled={blocked || !props.onNavigate} onClick={() => navigate('finance')}/>
        <DashboardActionButton title="إضافة فاتورة مصروف" note="المصروف والأصناف وصورة الفاتورة" icon={<Receipt/>} tone="rose" disabled={blocked || !props.onNavigate} onClick={() => navigate('expenses')}/>
      </div>
    </section>,
    metrics: totals ? <section className="dashboard-metrics" key="metrics" data-home-section="metrics" aria-label="ملخص اليوم">
      <DashboardMetricCard title="مواعيد اليوم" value={appointments.length} note={`${waiting} في الانتظار · ${completed} تم الحضور`} icon={<Calendar/>} tone="amber" disabled={blocked} onClick={() => navigate('appointments')}/>
      <DashboardMetricCard title="تحصيل اليوم" value={metricMoney(totals.collectedCents)} note="من دفع اليوم والخدمات المسجلة" icon={<Banknote/>} tone="emerald" disabled={blocked} onClick={() => navigate('finance')}/>
      <DashboardMetricCard title="الأرصدة المتبقية" value={metricMoney(totals.outstandingPatientCents)} note="مستحقات ملفات المرضى" icon={<Landmark/>} tone="rose" disabled={blocked} onClick={() => navigate('finance')}/>
      <DashboardMetricCard title="حالات المعمل" value={activeLabs} note="حالات لم تُغلق بعد" icon={<Microscope/>} tone="purple" disabled={blocked} onClick={() => navigate('lab')}/>
    </section> : null,
    schedule: projection ? <section className="dashboard-panel" key="schedule" data-home-section="schedule">
      <div className="dashboard-panel-header"><div><p className="dashboard-eyebrow">مسار اليوم</p><h2 className="dashboard-section-title">جدول اليوم</h2></div>
        <button type="button" className="dashboard-link" disabled={blocked} onClick={() => navigate('appointments')}>عرض الجدول<ChevronLeft aria-hidden="true"/></button></div>
      {appointments.length ? <div className="dashboard-appointment-list">{appointments.slice(0, layout?.appointmentLimit ?? 6).map(row => <button key={row.recordId} type="button" className="dashboard-appointment" disabled={blocked}
        onClick={() => run(() => { if (row.data.patientRecordId) props.onOpenPatient(row.data.patientRecordId); else props.onNavigate?.('appointments'); })}>
        <bdi className="dashboard-time">{row.data.time}</bdi><span className="min-w-0 flex-1 text-start"><strong>{row.data.patientName}</strong><small>{row.data.reason || 'موعد كشف'}</small></span>
        <span className={`dashboard-status status-${row.data.status}`}>{statusLabels[row.data.status]}</span>
      </button>)}</div> : <div className="dashboard-empty"><CheckCircle2 aria-hidden="true"/><strong>لا توجد مواعيد مسجلة اليوم</strong><span>يمكنك إضافة موعد جديد من جدول المواعيد.</span></div>}
      {appointments.length > (layout?.appointmentLimit ?? 6) && <p className="home-schedule-more">يظهر {layout?.appointmentLimit ?? 6} من {appointments.length} مواعيد اليوم. الباقي في الجدول الكامل.</p>}
    </section> : null,
    followUp: totals && (noShow > 0 || Boolean(activeLabs) || totals.expensePaidCents !== '0') ? <section className="dashboard-alerts" key="followUp" data-home-section="followUp">
      <div className="flex items-center gap-2"><AlertCircle aria-hidden="true"/><strong>تنبيهات تحتاج متابعة</strong></div><div className="dashboard-alert-grid">
        {noShow > 0 && <span>{noShow} موعد لم يحضر صاحبه</span>}{Boolean(activeLabs) && <span>{activeLabs} حالة معمل ما زالت مفتوحة</span>}
        {totals.expensePaidCents !== '0' && <span>مدفوعات مصروفات اليوم: {metricMoney(totals.expensePaidCents)}</span>}
      </div>
    </section> : null,
  };
  return <div className="dashboard-shell home-workspace cloud-home-dashboard" dir="rtl" data-home-density={layout?.density ?? 'comfortable'} aria-busy={state.loading}>
    <h1 className="sr-only">لوحة اليوم</h1>
    <section className="dashboard-search-panel" role="search" aria-label="البحث في ملفات المرضى">
      <Search aria-hidden="true" className="pointer-events-none absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400"/>
      <input className="dashboard-search-input" type="search" aria-label="البحث عن مريض بالاسم أو الهاتف أو رقم الملف" placeholder="اسم المريض، الهاتف أو رقم الملف" autoComplete="off" maxLength={200}
        disabled={blocked || !projection} value={state.directoryQuery} onChange={event => run(() => props.onQuery(event.target.value))}/>
      {state.directoryQuery && <button type="button" className="dashboard-search-clear" aria-label="مسح البحث" disabled={blocked} onClick={() => run(() => props.onQuery(''))}><X/></button>}
      {state.directoryQuery.trim() && projection && <div className="dashboard-search-results" aria-label="نتائج ملفات المرضى">
        {results.length ? results.map(file => <button type="button" key={file.patientRecordId} className="dashboard-search-result" disabled={blocked} onClick={() => run(() => props.onOpenPatient(file.patientRecordId))}>
          <span className="dashboard-avatar">{file.name.charAt(0)}</span><span className="min-w-0 flex-1"><strong>{file.name}</strong><small>ملف <bdi>{file.fileNo}</bdi></small></span><ChevronLeft aria-hidden="true"/>
        </button>) : <p className="home-search-message">لا توجد ملفات مطابقة</p>}
      </div>}
    </section>
    {state.error && <p role="alert" className="cloud-home-error">{state.error}</p>}
    {!projection && <section className="dashboard-panel"><h2 className="dashboard-section-title">{state.loading ? 'جارٍ تحميل العيادة…' : 'ابدأ بتحديث البيانات'}</h2>
      <p className="mt-2 text-sm text-slate-500">نقرأ جميع الأقسام قبل عرض الأرصدة والبحث. فتح الصفحة لا يقرأ البيانات تلقائيًا.</p>
      <button type="button" className="dashboard-link mt-3" disabled={blocked} onClick={() => run(props.onRefresh)}><RefreshCw size={18}/>تحديث البيانات</button></section>}
    {sectionOrder.filter(key => !layout?.hiddenSections.includes(key)).map(key => sections[key])}
    <details className="cloud-home-details"><summary>أدوات العيادة وآخر تحديث</summary>
      <div className="flex flex-wrap gap-2 mt-3">{([['patients-new','ملف مريض جديد'],['directory','جهات الاتصال'],['whatsapp','رسائل واتساب'],['transfer','الاستيراد والتصدير'],['settings','الإعدادات']] as const).map(([key,label]) =>
        <button type="button" key={key} className="dashboard-link" disabled={blocked || !props.onNavigate} onClick={() => navigate(key)}>{label}</button>)}
        <button type="button" className="dashboard-link" disabled={blocked} onClick={() => run(props.onRefresh)}><RefreshCw size={17}/>تحديث البيانات</button></div>
      {snapshot && <p className="mt-3 text-xs leading-7 text-slate-500">آخر نسخة مؤكدة: <time dateTime={snapshot.readTime}>{new Intl.DateTimeFormat('ar-EG',{dateStyle:'medium',timeStyle:'short',timeZone:'Africa/Cairo'}).format(new Date(snapshot.readTime))}</time> بتوقيت القاهرة. استخدم تحديث البيانات لعرض آخر حركة.</p>}
      <p className="mt-1 text-xs leading-7 text-slate-500">تحصيل اليوم مبالغ مدفوعة فعلًا، وليس صافي الربح. تفاصيل المصروفات والمعامل في الماليات.</p>
    </details>
  </div>;
}
