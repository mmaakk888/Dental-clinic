import React, { useMemo, useState } from 'react';
import type { LabCase } from '../../types';
import { getLabPaymentHistory } from '../../utils/labPaymentHistory';

const money = (value: number) => value.toLocaleString('ar-EG', { maximumFractionDigits: 2 });
const monthLabel = (value: string) => new Date(`${value}-01T12:00:00`).toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' });

export const LabPaymentHistory: React.FC<{
  cases: readonly LabCase[]; currentMonth: string; title?: string; showCaseDetails?: boolean; collapsible?: boolean;
}> = ({ cases, currentMonth, title = 'سجل دفعات المعمل', showCaseDetails = false, collapsible = false }) => {
  const [month, setMonth] = useState(currentMonth);
  const [period, setPeriod] = useState<'all' | 'month'>('all');
  const [visibleCount, setVisibleCount] = useState(20);
  const history = useMemo(() => getLabPaymentHistory(cases, month), [cases, month]);
  const entries = period === 'all' ? history.entries : history.entries.filter(entry => entry.dated && entry.receipt.date.startsWith(`${month}-`));
  return <section className="lab-payment-history" aria-label={title}>
    <h3>{title}</h3>
    <div className="lab-payment-stats">
      <div><span>وصل للمعمل حتى الآن</span><strong>{money(history.totalPaid)} <small>ج.م</small></strong></div>
      <div><span>{month === currentMonth ? 'المدفوع هذا الشهر' : 'المدفوع في الشهر المختار'}</span><strong>{money(history.monthPaid)} <small>ج.م</small></strong><small>{monthLabel(month)} · بإيصالات مؤرخة</small></div>
      <div><span>المتبقي للمعمل</span><strong>{money(history.remaining)} <small>ج.م</small></strong></div>
    </div>
    {history.unknownDateAmount > 0 && <p className="lab-payment-history-note">يوجد {money(history.unknownDateAmount)} ج.م من الإجمالي بدون تاريخ دفعة موثّق؛ لا يدخل حساب أي شهر.{history.unloggedAmount > 0 && ' يشمل مبالغ سابقة محفوظة كإجمالي فقط.'}</p>}
    {(history.inconsistentCases > 0 || history.invalidEntries > 0) && <p role="alert" className="lab-payment-history-warning">يوجد تعارض بين إجمالي المسدّد والإيصالات أو إيصال بمبلغ غير صالح. راجع السجل قبل اعتماد حساب المعمل؛ لم نعدّل الإجمالي تلقائيًا.</p>}
    <details className="lab-payment-receipts" open={collapsible ? undefined : true}>
    <summary>تفاصيل الإيصالات ({history.entries.length})</summary>
    <div className="lab-payment-history-controls">
      <div className="lab-payment-period" role="group" aria-label="فترة سجل الدفعات">
        <button type="button" aria-pressed={period === 'all'} onClick={() => { setPeriod('all'); setVisibleCount(20); }}>كل الدفعات</button>
        <button type="button" aria-pressed={period === 'month'} onClick={() => { setPeriod('month'); setVisibleCount(20); }}>دفعات الشهر</button>
      </div>
      <label>الشهر<input aria-label="شهر دفعات المعمل" type="month" value={month} onChange={event => {
        if (/^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value)) { setMonth(event.target.value); setPeriod('month'); setVisibleCount(20); }
      }} /></label>
    </div>
    {!entries.length ? <p className="lab-payment-history-empty">{period === 'month' ? 'لا توجد دفعات مؤرخة في الشهر المختار.' : 'لا توجد إيصالات دفعات مسجلة لهذه الحالات بعد.'}</p> : <ol className="lab-payment-history-list">
      {entries.slice(0, visibleCount).map(entry => <li key={entry.key} className={entry.receipt.voidedAt ? 'is-voided' : undefined}>
        <div className="lab-payment-receipt-heading"><time dateTime={entry.dated ? entry.receipt.date : undefined} dir="ltr">{entry.dated ? entry.receipt.date : 'تاريخ غير موثّق'}</time><strong>{money(entry.receipt.amount)} <small>ج.م</small></strong></div>
        {showCaseDetails && <p><bdi>#{entry.fileNo} · {entry.patientName}</bdi><span>{entry.serviceName}</span></p>}
        <p>{entry.receipt.note || 'دفعة مسدّدة للمعمل'}{entry.receipt.voidedAt && <strong className="lab-payment-void-label">ملغاة — لا تدخل إجمالي إيصالات الشهر</strong>}</p>
        {entry.receipt.voidedAt && entry.receipt.voidReason && <p>{entry.receipt.voidReason}</p>}
      </li>)}
    </ol>}
    {entries.length > visibleCount && <button type="button" className="lab-payment-show-more" onClick={() => setVisibleCount(count => count + 20)}>عرض دفعات أقدم ({entries.length - visibleCount})</button>}
    </details>
    <p className="lab-payment-history-caption">هذه دفعات وصلت للمعمل فقط؛ لا تشمل تحصيل المريض أو المبلغ المحجوز للمعمل.</p>
  </section>;
};
