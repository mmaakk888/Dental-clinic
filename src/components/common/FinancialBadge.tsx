import React from 'react';
import { CheckCircle2, AlertCircle, Clock, ShieldCheck } from 'lucide-react';

interface BalanceProgressMeterProps {
  total: number;
  paid: number;
  remaining?: number;
  label?: string;
  size?: 'sm' | 'md' | 'lg';
  type?: 'lab' | 'patient' | 'expense' | 'general';
  showPercentages?: boolean;
  className?: string;
}

export const BalanceProgressMeter: React.FC<BalanceProgressMeterProps> = ({
  total,
  paid,
  remaining: customRemaining,
  label,
  size = 'md',
  showPercentages = true,
  className = ''
}) => {
  const calcRemain = customRemaining !== undefined ? customRemaining : (total - paid);
  const remaining = Math.max(0, calcRemain);
  const safeTotal = total > 0 ? total : (paid + remaining);
  
  const paidRatio = safeTotal > 0 ? Math.min(100, Math.max(0, Math.round((paid / safeTotal) * 100))) : (remaining === 0 ? 100 : 0);
  const remainingRatio = 100 - paidRatio;

  const isFullyPaid = remaining <= 0;
  const isPartiallyPaid = paid > 0 && remaining > 0;
  const isUnpaid = paid <= 0 && remaining > 0;

  // Status Styling
  let badgeBg = 'bg-emerald-100 text-emerald-900 border-emerald-300';
  let badgeIcon = <ShieldCheck className="w-4 h-4 text-emerald-700" />;
  let badgeText = 'خالص السداد';
  let barColor = 'bg-gradient-to-r from-emerald-500 to-teal-600';

  if (isPartiallyPaid) {
    badgeBg = 'bg-amber-100 text-amber-950 border-amber-300';
    badgeIcon = <Clock className="w-4 h-4 text-amber-700" />;
    badgeText = `متبقي (${remaining.toLocaleString()} ج.م)`;
    barColor = 'bg-gradient-to-r from-amber-500 to-orange-500';
  } else if (isUnpaid) {
    badgeBg = 'bg-rose-100 text-rose-950 border-rose-300';
    badgeIcon = <AlertCircle className="w-4 h-4 text-rose-700" />;
    badgeText = `غير مسدد (${remaining.toLocaleString()} ج.م)`;
    barColor = 'bg-gradient-to-r from-rose-500 to-red-600';
  }

  if (size === 'sm') {
    return (
      <div className={`space-y-1.5 ${className}`}>
        <div className="flex items-center justify-between text-xs sm:text-sm">
          <span className="text-slate-700 font-bold">{label || 'السداد'}:</span>
          <div className="flex items-center gap-1.5 font-extrabold">
            <span className="text-emerald-700">{paid.toLocaleString()}</span>
            <span className="text-slate-300">/</span>
            <span className="text-slate-900">{safeTotal.toLocaleString()} ج.م</span>
            {isFullyPaid ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-100 text-emerald-900 font-black text-xs border border-emerald-300">
                ✓ خالص
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-rose-100 text-rose-950 font-black text-xs border border-rose-300">
                متبقي {remaining.toLocaleString()} ج.م
              </span>
            )}
          </div>
        </div>
        {/* Progress Track */}
        <div className="w-full h-2 bg-slate-200/80 rounded-full overflow-hidden flex p-0.5 shadow-inner">
          <div
            className={`h-full rounded-full transition-all duration-500 ${barColor}`}
            style={{ width: `${paidRatio}%` }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={`p-3.5 bg-slate-50 rounded-2xl border border-slate-200/90 space-y-3 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        {label && <span className="text-xs sm:text-sm font-black text-slate-800 font-tajawal">{label}</span>}
        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-black border shadow-2xs ${badgeBg}`}>
          {badgeIcon}
          {badgeText}
        </span>
      </div>

      {/* Numerical Breakdown */}
      <div className="grid grid-cols-3 gap-2 text-center text-xs sm:text-sm">
        <div className="p-2 bg-white rounded-xl border border-slate-200 shadow-2xs space-y-0.5">
          <span className="text-xs text-slate-500 block font-bold">المطلوب</span>
          <span className="font-black text-slate-900 text-sm sm:text-base">{safeTotal.toLocaleString()} <span className="text-xs font-normal text-slate-500">ج.م</span></span>
        </div>
        <div className="p-2 bg-emerald-50 rounded-xl border border-emerald-200 shadow-2xs space-y-0.5">
          <span className="text-xs text-emerald-800 block font-bold">المسدد</span>
          <span className="font-black text-emerald-900 text-sm sm:text-base">{paid.toLocaleString()} <span className="text-xs font-normal text-emerald-700">ج.م</span></span>
        </div>
        <div className={`p-2 rounded-xl border shadow-2xs space-y-0.5 ${isFullyPaid ? 'bg-slate-100 border-slate-200' : 'bg-rose-50 border-rose-200'}`}>
          <span className={`text-xs block font-bold ${isFullyPaid ? 'text-slate-600' : 'text-rose-900'}`}>المتبقي</span>
          <span className={`font-black text-sm sm:text-base ${isFullyPaid ? 'text-slate-700' : 'text-rose-950'}`}>{remaining.toLocaleString()} <span className={`text-xs font-normal ${isFullyPaid ? 'text-slate-500' : 'text-rose-700'}`}>ج.م</span></span>
        </div>
      </div>

      {/* Visual Progress Bar */}
      <div className="space-y-1">
        <div className="w-full h-2.5 bg-slate-200 rounded-full overflow-hidden flex p-0.5 shadow-inner">
          <div
            className={`h-full rounded-full transition-all duration-500 ${barColor}`}
            style={{ width: `${paidRatio}%` }}
          />
        </div>
        {showPercentages && (
          <div className="flex justify-between items-center text-xs font-bold text-slate-500 px-0.5">
            <span>مدفوع: {paidRatio}%</span>
            <span>متبقي: {remainingRatio}%</span>
          </div>
        )}
      </div>
    </div>
  );
};

interface CompactBalanceBadgeProps {
  remaining: number;
  total?: number;
  showText?: boolean;
}

export const CompactBalanceBadge: React.FC<CompactBalanceBadgeProps> = ({
  remaining,
  total,
  showText = true
}) => {
  if (remaining <= 0) {
    return (
      <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-100 text-emerald-900 border border-emerald-300 text-xs sm:text-sm font-black shadow-2xs">
        <CheckCircle2 className="w-4 h-4 text-emerald-700" />
        {showText ? 'خالص السداد' : '0 ج.م'}
      </span>
    );
  }

  const isHighRemain = total && total > 0 ? (remaining / total) > 0.5 : remaining > 500;

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs sm:text-sm font-black border shadow-2xs ${
        isHighRemain
          ? 'bg-rose-100 text-rose-950 border-rose-300'
          : 'bg-amber-100 text-amber-950 border-amber-300'
      }`}
    >
      <AlertCircle className={`w-4 h-4 ${isHighRemain ? 'text-rose-700' : 'text-amber-700'}`} />
      <span>متبقي: {remaining.toLocaleString()} ج.م</span>
    </span>
  );
};

interface VisualFinancialCardProps {
  title: string;
  subtitle?: string;
  amount: string | number;
  icon: React.ReactNode;
  gradient?: 'teal' | 'emerald' | 'amber' | 'rose' | 'indigo' | 'slate';
  ratioPercent?: number;
  ratioLabel?: string;
  footerInfo?: string;
  className?: string;
}

export const VisualFinancialCard: React.FC<VisualFinancialCardProps> = ({
  title,
  subtitle,
  amount,
  icon,
  gradient = 'teal',
  ratioPercent,
  ratioLabel,
  footerInfo,
  className = ''
}) => {
  const gradientStyles = {
    teal: 'bg-gradient-to-br from-[#0f3d3e] to-[#1b5e5a] text-white border-[#1b5e5a]',
    emerald: 'bg-gradient-to-br from-emerald-800 to-teal-900 text-white border-emerald-700',
    amber: 'bg-gradient-to-br from-amber-800 to-orange-900 text-white border-amber-700',
    rose: 'bg-gradient-to-br from-rose-800 to-red-900 text-white border-rose-700',
    indigo: 'bg-gradient-to-br from-indigo-800 to-slate-900 text-white border-indigo-700',
    slate: 'bg-gradient-to-br from-slate-800 to-slate-900 text-white border-slate-700'
  };

  const accentBars = {
    teal: 'bg-[#c9a227]',
    emerald: 'bg-emerald-400',
    amber: 'bg-amber-400',
    rose: 'bg-rose-400',
    indigo: 'bg-indigo-400',
    slate: 'bg-slate-400'
  };

  return (
    <div className={`rounded-3xl p-5 border shadow-md relative overflow-hidden flex flex-col justify-between ${gradientStyles[gradient]} ${className}`}>
      {/* Background Decorative Element */}
      <div className="absolute -left-6 -bottom-6 w-24 h-24 rounded-full bg-white/5 pointer-events-none blur-xl" />

      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="p-2.5 rounded-2xl bg-white/10 backdrop-blur-md border border-white/15 text-white">
            {icon}
          </div>
          {ratioPercent !== undefined && (
            <span className="px-3 py-1 rounded-full bg-white/20 backdrop-blur-md border border-white/25 text-xs font-black text-amber-200">
              {ratioPercent}% {ratioLabel || ''}
            </span>
          )}
        </div>

        <span className="text-xs sm:text-sm font-bold text-white/90 block font-tajawal">{title}</span>
        {subtitle && <span className="text-xs text-white/70 block font-medium">{subtitle}</span>}

        <div className="mt-2 text-2xl sm:text-3xl md:text-4xl font-black tracking-tight text-white drop-shadow-xs">
          {typeof amount === 'number' ? `${amount.toLocaleString()} ج.م` : amount}
        </div>
      </div>

      {ratioPercent !== undefined && (
        <div className="mt-4 pt-3 border-t border-white/10">
          <div className="w-full h-2 bg-white/20 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${accentBars[gradient]}`}
              style={{ width: `${Math.min(100, Math.max(0, ratioPercent))}%` }}
            />
          </div>
        </div>
      )}

      {footerInfo && (
        <span className="mt-2 text-xs text-white/80 font-bold block">
          {footerInfo}
        </span>
      )}
    </div>
  );
};


