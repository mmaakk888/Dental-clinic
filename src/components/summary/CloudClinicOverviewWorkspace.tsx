import React, { useRef, useSyncExternalStore } from 'react';
import { ArrowDownToLine, ArrowUpRight, CalendarDays, FileText, Phone, RefreshCw, Search, Users, Wallet, X } from 'lucide-react';
import type { CloudClinicOverviewController, CloudClinicOverviewState, CloudClinicOverviewTab } from '../../utils/cloudClinicOverviewController';
import { filterCloudOverviewDirectory, formatCloudClinicCents, type CloudOverviewExportFormat } from '../../utils/cloudClinicOverviewProjection';
import './CloudClinicOverviewWorkspace.css';
import { CloudHomeDashboard } from '../home/CloudHomeDashboard';
import { CloudOriginalContacts } from '../contacts/CloudOriginalContacts';
import type { CloudOriginalContactsBridge } from '../../utils/cloudOriginalContactsBridge';
import { CloudOriginalPatients } from '../patients/CloudOriginalPatients';
import type { CloudOriginalPatientsBridge } from '../../utils/cloudOriginalPatientsBridge';
import { CloudOriginalAppointments } from '../appointments/CloudOriginalAppointments';
import type { CloudOriginalAppointmentsBridge } from '../../utils/cloudOriginalAppointmentsBridge';
import { CloudOriginalLabs } from '../lab/CloudOriginalLabs';
import type { CloudOriginalLabsBridge } from '../../utils/cloudOriginalLabsBridge';
import { CloudOriginalPatientFile } from '../patient/CloudOriginalPatientFile';
import type { CloudOriginalPatientFileBridge } from '../../utils/cloudOriginalPatientFileBridge';
import { CloudOriginalSettings } from '../settings/CloudOriginalSettings';
import type { CloudOriginalSettingsBridge } from '../../utils/cloudOriginalSettingsBridge';
import { CloudOriginalWhatsApp } from '../settings/CloudOriginalWhatsApp';
import type { CloudOriginalWhatsAppBridge } from '../../utils/cloudOriginalWhatsAppBridge';

export interface CloudClinicOverviewWorkspaceProps {
  controller: CloudClinicOverviewController; previewOnly?: boolean; disabled?: boolean; onClose?: () => void;
  onOpenPatient(patientRecordId: string): void; onNavigate?(section: string): void;
  contactsBridge?: CloudOriginalContactsBridge;
  patientsBridge?: CloudOriginalPatientsBridge; createPatientRequest?: number;
  appointmentsBridge?: CloudOriginalAppointmentsBridge;
  labsBridge?: CloudOriginalLabsBridge;
  patientFileBridge?: CloudOriginalPatientFileBridge; selectedPatientRecordId?: string;
  settingsBridge?: CloudOriginalSettingsBridge; initialSettingsSection?: 'identity' | 'services' | 'whatsapp'; initialPricingLabId?: string;
  whatsAppBridge?: CloudOriginalWhatsAppBridge;
}
export interface CloudClinicOverviewWorkspaceViewProps {
  state: Readonly<CloudClinicOverviewState>; previewOnly?: boolean; disabled?: boolean;
  onRefresh(): void; onTab(tab: CloudClinicOverviewTab): void; onRange(from: string, to: string): void;
  onQuery(query: string): void; onFilter(filter: 'all' | 'files' | 'nofiles'): void; onMoreDirectory(): void; onMoreCash(): void;
  onExport(format: CloudOverviewExportFormat): void; onClose?(): void; onOpenPatient(patientRecordId: string): void;
  onNavigate?(section: string): void; onContact(event: React.MouseEvent<HTMLAnchorElement>): void;
}
const tabs: readonly [CloudClinicOverviewTab, string][] = [['home', 'العمل اليومي'], ['directory', 'جهات الاتصال'], ['finance', 'الماليات'], ['export', 'التصدير']];
const appointmentLabels = { scheduled: 'محدد', waiting: 'في الانتظار', attended: 'تم الحضور', no_show: 'لم يحضر', apologized: 'اعتذر', confirmed: 'مؤكد', cancelled: 'ملغى' };
const money = (value: string) => <bdi>{formatCloudClinicCents(value)}</bdi>;
function asOf(value: string) { const date = new Date(value); return new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Cairo' }).format(date); }
export function CloudClinicOverviewWorkspaceView(props: CloudClinicOverviewWorkspaceViewProps) {
  const { state, previewOnly = false } = props;
  if (state.tab === 'home') return <>
    {previewOnly && <p className="cloud-overview__notice">معاينة تصميم فارغة وخاملة؛ لا قراءة أو تنزيل أو بيانات فعلية.</p>}
    <CloudHomeDashboard state={previewOnly ? { ...state, snapshot: null, projection: null, directoryQuery: '', error: '', notice: '' } : state}
      disabled={props.disabled || previewOnly} onRefresh={props.onRefresh} onQuery={props.onQuery} onOpenPatient={props.onOpenPatient} onNavigate={props.onNavigate} />
  </>;
  const blocked = Boolean(props.disabled || previewOnly || state.closed || state.loading || state.exporting);
  const snapshot = previewOnly ? null : state.snapshot, projection = previewOnly ? null : state.projection;
  const query = previewOnly ? '' : state.directoryQuery, filter = previewOnly ? 'all' : state.directoryFilter;
  const directory = projection ? filterCloudOverviewDirectory(projection, query, filter) : [];
  const displayedDirectory = directory.slice(0, state.directoryLimit), cash = projection?.cash.slice(0, state.cashLimit) ?? [];
  const click = (action: () => void) => () => { if (!blocked) action(); };
  const totals = projection?.totals;
  const metric = (label: string, value: string, hint: string) => <article className="cloud-overview__metric" key={label}><span>{label}</span><strong>{money(value)}</strong><small>{hint}</small></article>;
  const followUpPanel = totals ? <section className="cloud-overview__panel" key="followUp"><h3>أرصدة تحتاج متابعة — حتى تاريخ النسخة</h3><div className="cloud-overview__balance-grid">
      <p>متبقي المرضى<strong>{money(totals.outstandingPatientCents)}</strong></p><p>مستحق المعامل<strong>{money(totals.outstandingLabCents)}</strong></p>
      <p>محجوز للمعامل من التحصيل<strong>{money(totals.reservedForLabCents)}</strong></p><p>مصروفات غير مسددة<strong>{money(totals.outstandingExpenseCents)}</strong></p></div>
      <small>هذه أرصدة تراكمية حتى النسخة، وليست أرصدة الفترة المختارة أو خصمًا نقديًا جديدًا.</small></section> : null;

  return <section className="cloud-overview" dir="rtl" aria-label="ملخص العيادة السحابي" aria-busy={state.loading || state.exporting}>
    <header className="cloud-overview__header"><div><h2>{snapshot?.settings.clinicSettings.data.identity.clinicName || 'العيادة'}</h2><p>نسخة كاملة للمالك · بيانات محمية من مصدر واحد</p></div><div className="cloud-overview__header-buttons">
      <button type="button" className="cloud-overview__primary" disabled={blocked} onClick={click(props.onRefresh)}><RefreshCw size={18} aria-hidden="true" />{state.loading ? 'جارٍ التحديث…' : 'تحديث البيانات'}</button>
      {props.onClose && <button type="button" disabled={blocked} onClick={click(props.onClose)}><X size={18} aria-hidden="true" />إغلاق</button>}</div></header>
    {previewOnly && <p className="cloud-overview__notice">معاينة تصميم فارغة وخاملة؛ لا قراءة أو تنزيل أو بيانات فعلية.</p>}
    {snapshot && <p className="cloud-overview__asof">آخر نسخة مؤكدة: <time dateTime={snapshot.readTime}>{asOf(snapshot.readTime)}</time> بتوقيت القاهرة. التحديث صريح، وليس مزامنة لحظية.</p>}
    {!previewOnly && state.error && <p role="alert" className="cloud-overview__error">{state.error}</p>}
    {!previewOnly && state.notice && <p role="status" className="cloud-overview__notice">{state.notice}</p>}
    {!props.onNavigate && <nav className="cloud-overview__tabs" aria-label="أقسام ملخص العيادة">{tabs.map(([tab, label]) => <button type="button" key={tab} aria-current={state.tab === tab ? 'page' : undefined} disabled={blocked} onClick={click(() => props.onTab(tab))}>{label}</button>)}</nav>}
    {!snapshot ? <div className="cloud-overview__empty cloud-overview__panel"><Users size={32} aria-hidden="true" /><h3>ابدأ بتحديث البيانات</h3><p>نقرأ جميع الأقسام في نسخة متسقة قبل عرض البحث أو أي إجمالي. فتح الصفحة لا يقرأ البيانات تلقائيًا.</p></div> : <>
      {state.tab === 'finance' && <div className="cloud-overview__range"><span>فترة العرض</span><label>من<input type="date" value={state.range.from} disabled={blocked} onChange={event => { if (event.target.value && !blocked) props.onRange(event.target.value, state.range.to); }} /></label><label>إلى<input type="date" value={state.range.to} disabled={blocked} onChange={event => { if (event.target.value && !blocked) props.onRange(state.range.from, event.target.value); }} /></label><small>تغيير الفترة يحسب النسخة المحمّلة دون طلب جديد.</small></div>}
      {state.tab === 'directory' && <section className="cloud-overview__panel"><div className="cloud-overview__section-title"><h3>الدليل الموحد</h3><span>{directory.length} نتيجة من {projection?.counts.entries} سجل</span></div><p>أرقام الملفات وجهات الاتصال معًا، مع مطابقة الرقم الكامل وإظهار كل ملف مرتبط. التشابه ليس دمجًا أو موافقة على الحملات.</p>
        <label className="cloud-overview__search"><Search size={20} aria-hidden="true" /><input type="search" value={query} maxLength={200} disabled={blocked} placeholder="الاسم أو الموبايل أو رقم الملف" aria-label="بحث كامل في الدليل" onChange={event => { if (!blocked) props.onQuery(event.target.value); }} /></label>
        <div className="cloud-overview__filters" role="group" aria-label="نوع جهات الاتصال">{([['all', 'الكل'], ['files', 'لهم ملفات'], ['nofiles', 'بدون ملفات']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={filter === value} disabled={blocked} onClick={click(() => props.onFilter(value))}>{label}</button>)}</div>
        <ul className="cloud-overview__directory">{displayedDirectory.map(row => <li key={row.id}><div className="cloud-overview__contact-title"><strong>{row.name}</strong><bdi>{row.mobile || 'بدون رقم موبايل'}</bdi><span className="cloud-overview__badge">{row.files.length ? `${row.files.length} ملف مرتبط` : 'بدون ملف'}</span></div>
          {row.files.length > 0 && <div className="cloud-overview__file-links">{row.files.map(file => <button type="button" key={file.patientRecordId} disabled={blocked} onClick={click(() => props.onOpenPatient(file.patientRecordId))}>ملف <bdi>{file.fileNo}</bdi> · {file.name}<ArrowUpRight size={15} aria-hidden="true" /></button>)}</div>}
          {row.phone && <div className="cloud-overview__contact-actions"><a href={`tel:+${row.phone}`} aria-disabled={blocked} onClick={props.onContact}><Phone size={17} aria-hidden="true" />اتصال</a><a href={`https://wa.me/${row.phone}`} target="_blank" rel="noopener noreferrer" aria-disabled={blocked} onClick={props.onContact}>واتساب</a></div>}</li>)}</ul>
        {!directory.length && <p className="cloud-overview__empty">لا توجد أرقام مطابقة لهذا البحث.</p>}
        <p className="cloud-overview__pagination">عرض {displayedDirectory.length} من {directory.length}؛ البحث يشمل النسخة كاملة، وليس المعروض فقط.</p>{directory.length > displayedDirectory.length && <button type="button" disabled={blocked} onClick={click(props.onMoreDirectory)}>عرض ٥٠ رقمًا إضافيًا</button>}</section>}
      {state.tab === 'finance' && totals && <><section className="cloud-overview__metrics">
        {metric('التحصيل الفعلي', totals.collectedCents, 'إيصالات المرضى فقط')}{metric('دفعات المعامل', totals.labPaidCents, 'كل إيصال مرة واحدة')}{metric('دفعات المصروفات', totals.expensePaidCents, 'المسدّد فعلًا وليس قيمة الفاتورة')}{metric('صافي الحركة النقدية', totals.netCashCents, 'ليس صافي الربح')}
      </section><section className="cloud-overview__panel"><h3>القيمة والاستهلاك — خلال الفترة</h3><div className="cloud-overview__balance-grid"><p>خدمات وكشف مسجلة<strong>{money(totals.chargedCents)}</strong></p><p>فواتير ومصروفات مسجلة<strong>{money(totals.expenseChargedCents)}</strong></p><p>تكلفة خامات مستهلكة<strong>{money(totals.materialUsedCents)}</strong></p><p>تكلفة هالك الخامات<strong>{money(totals.materialWasteCents)}</strong></p></div><small>القيم المسجلة لا تعني سدادًا. استهلاك الخامات ليس دفعة نقدية إضافية.</small></section>
        {followUpPanel}<section className="cloud-overview__panel"><h3>تفاصيل الحركة النقدية</h3><ul className="cloud-overview__cash">{cash.map(row => <li key={row.id}><div><span className={`cloud-overview__badge cloud-overview__badge--${row.kind}`}>{row.kind === 'patient' ? 'تحصيل مريض' : row.kind === 'lab' ? 'دفعة معمل' : 'مصروف مدفوع'}</span><strong>{row.title}</strong><small>{row.detail}{row.fileNo ? ` · ملف ${row.fileNo}` : ''}</small><time dateTime={row.date}><bdi>{row.date}</bdi></time></div><div><strong>{row.kind === 'patient' ? '+' : '−'} {money(row.amountCents)}</strong>{row.patientRecordId && <button type="button" disabled={blocked} onClick={click(() => props.onOpenPatient(row.patientRecordId!))}>فتح الملف</button>}</div></li>)}</ul>
          {!cash.length && <p className="cloud-overview__empty">لا حركة نقدية في هذه الفترة.</p>}<p className="cloud-overview__pagination">عرض {cash.length} من {projection?.cash.length} إيصال؛ جميع الإيصالات داخلة في الإجماليات.</p>{(projection?.cash.length ?? 0) > cash.length && <button type="button" disabled={blocked} onClick={click(props.onMoreCash)}>عرض ٥٠ إيصالًا إضافيًا</button>}</section></>}
      {state.tab === 'export' && <section className="cloud-overview__panel cloud-overview__export"><ArrowDownToLine size={30} aria-hidden="true" /><h3>تصدير المالك</h3><p>الملفات من النسخة الكاملة بتاريخ {asOf(snapshot.readTime)}، بصرف النظر عن فلاتر البحث والفترة المعروضة. تتم إعادة تفويض حسابك قبل وبعد تجهيز التنزيل.</p><div className="cloud-overview__notice">التصدير التشغيلي حساس وغير مشفّر، وليس نسخة استعادة كاملة. لا يشمل حسابات الدخول والأسرار وسجل journal وصور الفواتير أو الشعار. احفظه في مكان خاص ولا ترفعه إلى GitHub.</div>
        <div className="cloud-overview__actions"><button type="button" disabled={blocked} onClick={click(() => props.onExport('contacts-csv'))}><Users size={20} aria-hidden="true" />تصدير دليل الأرقام CSV</button><button type="button" disabled={blocked} onClick={click(() => props.onExport('operational-json'))}><FileText size={20} aria-hidden="true" />تصدير البيانات التشغيلية JSON</button></div><small>لا تنفيذ لاستيراد أو استعادة من هذه الشاشة، ولا إرسال تلقائي لأي ملف.</small></section>}
    </>}
  </section>;
}

export function CloudClinicOverviewWorkspace(props: CloudClinicOverviewWorkspaceProps) {
  const { controller } = props, state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  const live = useRef({ props, state }); live.current = { props, state };
  const valid = () => live.current.props.controller === controller && live.current.state === state && controller.getState() === state
    && !live.current.props.previewOnly && !live.current.props.disabled && !state.closed && !state.loading && !state.exporting && controller.canClose();
  const run = (action: () => unknown) => { if (valid()) void action(); };
  async function download(format: CloudOverviewExportFormat) {
    if (!valid() || !state.snapshot) return;
    const ticket = await controller.prepareExport(format, state.snapshot);
    // The prepare transition replaces state, so check the owned controller/current flags, not the old render ticket here.
    if (!ticket || live.current.props.controller !== controller || live.current.props.previewOnly || live.current.props.disabled) return;
    const url = URL.createObjectURL(new Blob([ticket.text], { type: ticket.mime }));
    try {
      const output = controller.consumeExport(ticket); if (!output) return;
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = output.filename; anchor.rel = 'noopener'; anchor.click();
    } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
  if (state.tab === 'directory' && props.contactsBridge && !props.previewOnly) return <CloudOriginalContacts state={state} bridge={props.contactsBridge}
    disabled={props.disabled} onOpenPatient={props.onOpenPatient} onNavigate={props.onNavigate} />;
  if (state.tab === 'patients' && props.patientsBridge && !props.previewOnly) return <CloudOriginalPatients state={state} bridge={props.patientsBridge}
    appointmentsBridge={props.appointmentsBridge} disabled={props.disabled} createRequest={props.createPatientRequest} onOpenPatient={props.onOpenPatient} onNavigate={props.onNavigate} />;
  if (state.tab === 'appointments' && props.appointmentsBridge && !props.previewOnly) return <CloudOriginalAppointments state={state} bridge={props.appointmentsBridge}
    disabled={props.disabled} onOpenPatient={props.onOpenPatient} onNavigate={props.onNavigate} />;
  if (state.tab === 'labs' && props.labsBridge && !props.previewOnly) return <CloudOriginalLabs state={state} bridge={props.labsBridge}
    disabled={props.disabled} onNavigate={props.onNavigate} />;
  if (state.tab === 'settings' && props.settingsBridge && !props.previewOnly) return <CloudOriginalSettings state={state} bridge={props.settingsBridge}
    whatsAppBridge={props.whatsAppBridge} contactsBridge={props.contactsBridge} onOpenPatient={props.onOpenPatient}
    disabled={props.disabled} onNavigate={props.onNavigate} initialSection={props.initialSettingsSection} initialPricingLabId={props.initialPricingLabId} />;
  if (state.tab === 'patient-file' && props.selectedPatientRecordId && props.patientFileBridge && props.patientsBridge && props.appointmentsBridge && props.labsBridge && !props.previewOnly)
    return <CloudOriginalPatientFile state={state} patientRecordId={props.selectedPatientRecordId} bridge={props.patientFileBridge}
      patientsBridge={props.patientsBridge} appointmentsBridge={props.appointmentsBridge} labsBridge={props.labsBridge} whatsAppBridge={props.whatsAppBridge} disabled={props.disabled} onNavigate={props.onNavigate} />;
  return <CloudClinicOverviewWorkspaceView state={state} previewOnly={props.previewOnly} disabled={props.disabled}
    onRefresh={() => run(() => controller.refresh())} onTab={tab => run(() => controller.setTab(tab))}
    onRange={(from, to) => run(() => controller.setRange({ from, to }))} onQuery={query => run(() => controller.setDirectoryQuery(query))}
    onFilter={filter => run(() => controller.setDirectoryFilter(filter))} onMoreDirectory={() => run(() => controller.showMoreDirectory())}
    onMoreCash={() => run(() => controller.showMoreCash())} onExport={format => run(() => download(format))}
    onOpenPatient={patientId => run(() => props.onOpenPatient(patientId))} onNavigate={props.onNavigate ? section => run(() => props.onNavigate?.(section)) : undefined}
    onClose={props.onClose ? () => run(() => props.onClose?.()) : undefined}
    onContact={event => { if (!valid()) event.preventDefault(); }} />;
}
