import React from 'react';
import { ChevronLeft, EyeOff, Wallet } from 'lucide-react';

interface PatientFinancialOverviewProps {
  total: number;
  paid: number;
  remaining: number;
  isPrivacyMode: boolean;
  canViewRemainingBalance: boolean;
  onOpenDetails: () => void;
}

const money = (amount: number) => new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 }).format(amount);

/** One patient-only balance summary, never lab costs or clinic profits. */
export function PatientFinancialOverview({ total, paid, remaining, isPrivacyMode, canViewRemainingBalance, onOpenDetails }: PatientFinancialOverviewProps) {
  const ratio = total > 0 ? Math.min(100, Math.max(0, Math.round(paid / total * 100))) : 0;
  const revealRemaining = !isPrivacyMode && canViewRemainingBalance;
  return <section className="patient-balance" aria-labelledby="patient-balance-title">
    <div className="patient-balance-heading">
      <h2 id="patient-balance-title"><Wallet aria-hidden="true" />حساب المريض</h2>
      <button type="button" onClick={onOpenDetails}>تفاصيل الحساب<ChevronLeft aria-hidden="true" /></button>
    </div>
    {isPrivacyMode ? <p className="patient-balance-private"><EyeOff aria-hidden="true" />المبالغ مخفية في وضع الخصوصية</p>
      : <>
        <dl className="patient-balance-values">
          <div><dt>الإجمالي بعد الخصم</dt><dd><bdi>{money(total)}</bdi><small>ج.م</small></dd></div>
          <div className="patient-balance-paid"><dt>المدفوع</dt><dd><bdi>{money(paid)}</bdi><small>ج.م</small></dd></div>
          <div className={revealRemaining && remaining > 0 ? 'patient-balance-due' : 'patient-balance-neutral'}><dt>المتبقي</dt><dd>{revealRemaining ? <><bdi>{money(remaining)}</bdi><small>ج.م</small></> : <span aria-label="المتبقي غير متاح لهذا الحساب">—</span>}</dd></div>
        </dl>
        {revealRemaining && total > 0 && <div className="patient-balance-progress">
          <span>تم تحصيل <bdi>{ratio}%</bdi></span>
          <div role="progressbar" aria-label="نسبة سداد حساب المريض" aria-valuemin={0} aria-valuemax={100} aria-valuenow={ratio}><i style={{ width: `${ratio}%` }} /></div>
        </div>}
        {total === 0 && paid === 0 && revealRemaining && <p className="patient-balance-empty">لا توجد مبالغ مسجّلة حتى الآن.</p>}
      </>}
  </section>;
}
