import React, { useState } from 'react';
import { Sparkles, TrendingUp, Calendar, DollarSign, ChevronLeft, RefreshCw, FileText } from 'lucide-react';
import { AiService, ClinicalSummaryResult, FinancialInsightsResult } from '../../services/aiService';
import { Patient, Appointment, Expense } from '../../types';

interface AiAssistantPanelProps {
  patients: Patient[];
  appointments: Appointment[];
  expenses: Expense[];
  onOpenScheduleModal: () => void;
  onOpenInvoiceModal: () => void;
  onNavigateToPatients: () => void;
}

export const AiAssistantPanel: React.FC<AiAssistantPanelProps> = ({
  patients,
  appointments,
  expenses,
  onOpenScheduleModal,
  onOpenInvoiceModal,
  onNavigateToPatients,
}) => {
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [clinicalSummary, setClinicalSummary] = useState<ClinicalSummaryResult | null>(null);

  const [isGeneratingFinancials, setIsGeneratingFinancials] = useState(false);
  const [financialInsights, setFinancialInsights] = useState<FinancialInsightsResult | null>(null);

  const todayStr = new Date().toISOString().split('T')[0];
  const todayAppts = appointments.filter(a => a.date === todayStr);

  const overdueFollowUps = appointments.filter(a => a.isFollowUp && a.status === 'scheduled' && a.date < todayStr);

  const totalDebt = patients.reduce((acc, p) => {
    const cost = p.sessions.reduce((sAcc, s) => sAcc + s.amount, 0);
    const paid = p.sessions.reduce((sAcc, s) => sAcc + (s.paid || 0), 0) + p.payments.reduce((pAcc, pay) => pAcc + pay.amount, 0);
    return acc + Math.max(0, cost - paid);
  }, 0);

  const currentMonthRevenue = patients.reduce((acc, p) => {
    return acc + p.sessions.reduce((sAcc, s) => sAcc + (s.paid || 0), 0) + p.payments.reduce((pAcc, pay) => pAcc + pay.amount, 0);
  }, 0);

  const currentMonthExpenses = expenses.reduce((acc, e) => acc + e.amount, 0);

  const handleGenerateBrief = async () => {
    setIsGeneratingSummary(true);
    const res = await AiService.getClinicalSummary({
      appointmentsCount: todayAppts.length,
      totalRevenue: todayAppts.reduce((acc) => acc + 250, 0),
      pendingFollowUps: overdueFollowUps.length,
      totalDebt,
      newPatientsCount: patients.filter(p => p.firstVisit === todayStr).length,
    });
    setClinicalSummary(res);
    setIsGeneratingSummary(false);
  };

  const handleGenerateFinancials = async () => {
    setIsGeneratingFinancials(true);
    const categoryTotals = expenses.reduce((acc, e) => {
      acc[e.category] = (acc[e.category] || 0) + e.amount;
      return acc;
    }, {} as Record<string, number>);

    const res = await AiService.generateFinancialInsights(
      currentMonthRevenue,
      currentMonthExpenses,
      categoryTotals,
      currentMonthRevenue * 0.9,
      currentMonthExpenses * 0.95
    );
    setFinancialInsights(res);
    setIsGeneratingFinancials(false);
  };

  return (
    <div className="bg-slate-900 text-white rounded-2xl p-4 shadow-sm border border-slate-800 space-y-3 font-tajawal">
      {/* Panel Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center shrink-0">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
              <span>المساعد الذكي للعيادة</span>
              <span className="text-[10px] bg-indigo-500/20 text-indigo-300 px-1.5 py-0.5 rounded font-mono">AI Pro</span>
            </h3>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={handleGenerateBrief}
            disabled={isGeneratingSummary}
            className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold px-2.5 py-1 rounded-lg transition disabled:opacity-50 active:scale-95"
          >
            <RefreshCw className={`w-3 h-3 ${isGeneratingSummary ? 'animate-spin' : ''}`} />
            <span>موجز اليوم</span>
          </button>
          <button
            onClick={handleGenerateFinancials}
            disabled={isGeneratingFinancials}
            className="flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-slate-700 text-[11px] font-bold px-2.5 py-1 rounded-lg transition disabled:opacity-50 active:scale-95"
          >
            <TrendingUp className={`w-3 h-3 ${isGeneratingFinancials ? 'animate-spin' : ''}`} />
            <span>رؤى مالية</span>
          </button>
        </div>
      </div>

      {/* Compact Quick Alerts */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
        {/* Card 1 */}
        <div 
          onClick={onOpenScheduleModal}
          className="bg-slate-800/60 hover:bg-slate-800 p-2.5 rounded-xl border border-slate-700/60 flex items-center justify-between cursor-pointer transition-colors"
        >
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-amber-400 shrink-0" />
            <div>
              <span className="text-[11px] text-slate-300 font-bold block">متابعات معلقة</span>
              <span className="text-[10px] text-slate-400 block">{overdueFollowUps.length} حالات بحاجة لتأكيد</span>
            </div>
          </div>
          <ChevronLeft className="w-4 h-4 text-slate-500" />
        </div>

        {/* Card 2 */}
        <div 
          onClick={onNavigateToPatients}
          className="bg-slate-800/60 hover:bg-slate-800 p-2.5 rounded-xl border border-slate-700/60 flex items-center justify-between cursor-pointer transition-colors"
        >
          <div className="flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-rose-400 shrink-0" />
            <div>
              <span className="text-[11px] text-slate-300 font-bold block">متبقي الديون</span>
              <span className="text-[10px] font-mono text-rose-300 block">{totalDebt.toLocaleString()} ج.م</span>
            </div>
          </div>
          <ChevronLeft className="w-4 h-4 text-slate-500" />
        </div>

        {/* Card 3 */}
        <div 
          onClick={onOpenInvoiceModal}
          className="bg-slate-800/60 hover:bg-slate-800 p-2.5 rounded-xl border border-slate-700/60 flex items-center justify-between cursor-pointer transition-colors"
        >
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-emerald-400 shrink-0" />
            <div>
              <span className="text-[11px] text-slate-300 font-bold block">ماسح الفواتير</span>
              <span className="text-[10px] text-slate-400 block">تصوير فاتورة المورد</span>
            </div>
          </div>
          <ChevronLeft className="w-4 h-4 text-slate-500" />
        </div>
      </div>

      {/* Generated Summaries */}
      {clinicalSummary && (
        <div className="p-3 rounded-xl bg-indigo-950/60 border border-indigo-500/20 text-xs space-y-1.5 animate-fadeIn">
          <div className="font-bold text-indigo-300 flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" /> الموجز اليومي
          </div>
          <p className="text-slate-300 text-[11px] leading-relaxed">{clinicalSummary.dailyBrief}</p>
        </div>
      )}

      {financialInsights && (
        <div className="p-3 rounded-xl bg-emerald-950/60 border border-emerald-500/20 text-xs space-y-1.5 animate-fadeIn">
          <div className="font-bold text-emerald-300 flex items-center gap-1">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" /> التوصية المالية
          </div>
          <p className="text-slate-300 text-[11px] leading-relaxed">{financialInsights.recommendation}</p>
        </div>
      )}
    </div>
  );
};

