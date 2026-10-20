import React, { useEffect, useId, useMemo, useState } from 'react';
import {usePortableRuntime} from '../../portable/runtime';
import { History, Search, Download, UserRound, CalendarDays, Monitor, Printer, SlidersHorizontal, X } from 'lucide-react';
import { getAuditLogs, type AuditLogItem } from '../../services/auditLogger';
import { AUDIT_ACTIONS, AUDIT_ENTITIES, auditActionLabel, auditEntityLabel, filterAuditLogs, formatAuditDateTime, serializeAuditCsv } from '../../utils/auditTrailPresentation';
import { downloadTransferBlob } from '../../utils/patientSpreadsheets';
import { useToastAndConfirm } from '../common/ToastAndConfirm';
import './auditTrail.css';
import {presentServerAudit} from '../../utils/serverAuditPresentation';

export interface AuditTrailViewProps {
  canExport?: boolean;
  /** Must reauthorize the current stored account, session and privacy state. */
  onAuthorizeExport?: () => void;
}

export const AuditTrailView: React.FC<AuditTrailViewProps> = ({ canExport = false, onAuthorizeExport }) => {
  const portable = usePortableRuntime();
  const [logs,setLogs] = useState<AuditLogItem[]>(() => portable ? [] : getAuditLogs());
  const [serverError,setServerError] = useState('');
  useEffect(()=>{if(!portable)return;let live=true;portable.read('audit').then(value=>{if(live)setLogs(value.logs.map(presentServerAudit));}).catch(error=>{if(live)setServerError(error.message);});return()=>{live=false;};},[portable]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterAction, setFilterAction] = useState('all');
  const [filterEntity, setFilterEntity] = useState('all');
  const [visibleCount, setVisibleCount] = useState(50);
  const { showToast } = useToastAndConfirm();
  const fieldId = `audit-${useId().replace(/[^\w-]/g, '')}`;
  const filteredLogs = useMemo(() => filterAuditLogs(logs, searchQuery, filterAction, filterEntity), [logs, searchQuery, filterAction, filterEntity]);
  const hasFilters = !!searchQuery.trim() || filterAction !== 'all' || filterEntity !== 'all';
  const transferAllowed = canExport && typeof onAuthorizeExport === 'function';

  const authorize = () => {
    if (!transferAllowed) throw new Error('غير مسموح بتصدير سجل النشاطات أو طباعته من هذا الحساب.');
    onAuthorizeExport!();
  };
  const handleExportCSV = () => {
    try {
      authorize();
      const blob = new Blob([serializeAuditCsv(filteredLogs)], { type: 'text/csv;charset=utf-8;' });
      downloadTransferBlob(blob, `سجل_نشاطات_العيادة_${new Date().toISOString().split('T')[0]}.csv`, authorize);
    } catch {
      showToast('تعذّر تصدير سجل النشاطات. راجع صلاحيات الحساب وحالة الجلسة.', 'error');
    }
  };
  const handlePrint = () => {
    try {
      authorize();
      // Native printing includes only mounted rows, unlike the complete CSV.
      if (filteredLogs.length > visibleCount) {
        showToast('اعرض بقية النتائج أولًا للطباعة، أو صدّر CSV للحصول على كل النتائج.', 'warning');
        return;
      }
      authorize();
      window.print();
    } catch {
      showToast('تعذّرت الطباعة. راجع صلاحيات الحساب وحالة الجلسة.', 'error');
    }
  };
  const resetFilters = () => { setSearchQuery(''); setFilterAction('all'); setFilterEntity('all'); setVisibleCount(50); };

  return (
    <section className="audit-trail" dir="rtl" aria-labelledby={`${fieldId}-title`}>
      <header className="audit-trail-header">
        <div className="audit-trail-heading">
          <span className="audit-trail-icon" aria-hidden="true"><History /></span>
          <div>
            <h2 id={`${fieldId}-title`}>سجل النشاطات</h2>
            <p>{portable ? 'أحدث ٢٠٠٠ عملية مؤكدة، باسم الحساب والتاريخ والقسم؛ دون كلمات السر أو تفاصيل طبية في السجل.' : 'العمليات المسجلة في هذا المتصفح، مع المستخدم والتاريخ وتفاصيل كل عملية.'}</p>
            {serverError && <p role="alert">{serverError}</p>}
          </div>
        </div>
        {transferAllowed && <div className="audit-trail-actions">
          <button type="button" className="audit-trail-button is-primary" onClick={handleExportCSV} disabled={!filteredLogs.length}><Download aria-hidden="true" />تصدير CSV</button>
          <button type="button" className="audit-trail-button" onClick={handlePrint} disabled={!filteredLogs.length}><Printer aria-hidden="true" />طباعة</button>
        </div>}
      </header>

      <div className="audit-trail-filters" role="search" aria-label="تصفية سجل النشاطات">
        <label className="audit-trail-field audit-trail-search" htmlFor={`${fieldId}-search`}>
          <span>البحث في السجل</span>
          <div className="audit-trail-input-wrap"><Search aria-hidden="true" /><input id={`${fieldId}-search`} type="search" value={searchQuery} onChange={event => { setSearchQuery(event.target.value); setVisibleCount(50); }} placeholder="اسم المستخدم، رقم الملف أو التفاصيل" /></div>
        </label>
        <label className="audit-trail-field" htmlFor={`${fieldId}-action`}>
          <span>نوع العملية</span>
          <select id={`${fieldId}-action`} value={filterAction} onChange={event => { setFilterAction(event.target.value); setVisibleCount(50); }}>
            <option value="all">كل العمليات</option>
            {AUDIT_ACTIONS.map(action => <option key={action.value} value={action.value}>{action.label}</option>)}
          </select>
        </label>
        <label className="audit-trail-field" htmlFor={`${fieldId}-entity`}>
          <span>القسم</span>
          <select id={`${fieldId}-entity`} value={filterEntity} onChange={event => { setFilterEntity(event.target.value); setVisibleCount(50); }}>
            <option value="all">كل الأقسام</option>
            {AUDIT_ENTITIES.map(entity => <option key={entity.value} value={entity.value}>{entity.label}</option>)}
          </select>
        </label>
      </div>

      <div className="audit-trail-summary">
        <p role="status"><SlidersHorizontal aria-hidden="true" />{hasFilters ? 'نتائج البحث' : 'العمليات المسجلة'} <strong><bdi>{filteredLogs.length.toLocaleString('ar-EG')}</bdi></strong>{hasFilters && <span>من <bdi>{logs.length.toLocaleString('ar-EG')}</bdi></span>}</p>
        {hasFilters && <button type="button" className="audit-trail-reset" onClick={resetFilters}><X aria-hidden="true" />مسح الفلاتر</button>}
      </div>

      {filteredLogs.length === 0 ? <div className="audit-trail-empty">
        <History aria-hidden="true" />
        <h3>{hasFilters ? 'لا توجد نتائج مطابقة' : 'لا توجد نشاطات مسجلة'}</h3>
        <p>{hasFilters ? 'جرّب اسمًا أو رقم ملف آخر، أو أعد عرض كل العمليات.' : 'ستظهر هنا العمليات التي يسجلها النظام أثناء العمل.'}</p>
        {hasFilters && <button type="button" className="audit-trail-button" onClick={resetFilters}>عرض كل العمليات</button>}
      </div> : <ol className="audit-trail-list" aria-label="العمليات المسجلة">
        {filteredLogs.slice(0, visibleCount).map(log => {
          const timestamp = formatAuditDateTime(log.timestamp);
          return <li key={log.id}>
            <article className="audit-trail-entry">
              <div className="audit-trail-entry-top">
                <div className="audit-trail-tags"><span className={`audit-trail-badge is-${log.action}`}>{auditActionLabel(log.action)}</span><span className="audit-trail-entity">{auditEntityLabel(log.entity)}</span></div>
                <time className="audit-trail-time" dateTime={timestamp.iso} aria-label={`التاريخ: ${timestamp.date}، الوقت: ${timestamp.time}`}><CalendarDays aria-hidden="true" /><bdi>{timestamp.date}</bdi><span aria-hidden="true">·</span><bdi>{timestamp.time}</bdi></time>
              </div>
              <div className="audit-trail-entry-body">
                <div className="audit-trail-description">
                  <h3><bdi dir="auto">{log.recordName || 'عملية عامة'}</bdi></h3>
                  <p><bdi dir="auto">{log.details || 'لا توجد تفاصيل إضافية.'}</bdi></p>
                  {log.newValue !== undefined && log.newValue !== '' && <div className="audit-trail-value"><span>القيمة المسجلة</span><strong><bdi dir="auto">{log.newValue}</bdi></strong></div>}
                </div>
                <dl className="audit-trail-meta">
                  <div><dt><UserRound aria-hidden="true" />المستخدم</dt><dd><bdi dir="auto">{log.userName || 'غير محدد'}</bdi>{log.userRole && <small><bdi dir="auto">{log.userRole}</bdi></small>}</dd></div>
                  <div><dt><Monitor aria-hidden="true" />الجهاز</dt><dd><bdi dir="auto">{log.device || 'غير محدد'}</bdi></dd></div>
                </dl>
              </div>
            </article>
          </li>;
        })}
      </ol>}
      {filteredLogs.length > visibleCount && <button type="button" className="audit-trail-button audit-trail-more" onClick={() => setVisibleCount(count => count + 50)}>عرض المزيد (<bdi>{(filteredLogs.length - visibleCount).toLocaleString('ar-EG')}</bdi> عملية متبقية)</button>}
      <p className="audit-trail-note">هذا سجل محلي للعمليات المسجلة، وليس سجل مراجعة سحابيًا أو نسخة احتياطية من بيانات العيادة.</p>
    </section>
  );
};
