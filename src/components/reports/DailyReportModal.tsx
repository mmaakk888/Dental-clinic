import React, { useState, useMemo } from 'react';
import { Patient, Appointment, Session } from '../../types';
import { 
  X, Calendar, Landmark, DollarSign, Users, CheckCircle2, Clock, 
  CreditCard, TrendingUp, AlertCircle, FileText, Filter, Search, Tag, Percent
} from 'lucide-react';
import { calculateDailyCollections } from '../../utils/financials';
import { localDateISO } from '../appointments/appointmentScheduling';
import { useAppointmentDialog } from '../appointments/useAppointmentDialog';

interface DailyReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  patients: Patient[];
  appointments: Appointment[];
  isPrivacyMode?: boolean;
  canViewRemainingBalance?: boolean;
  canViewHistory?: boolean;
  onSelectPatientFile?: (patientId: string) => void;
}

export type ReportFilterRange = 'today' | 'yesterday' | 'week' | 'month' | 'custom';

export const DailyReportModal: React.FC<DailyReportModalProps> = ({
  isOpen,
  onClose,
  patients,
  appointments,
  isPrivacyMode = false,
  canViewRemainingBalance = true,
  canViewHistory = true,
  onSelectPatientFile
}) => {
  const [filterRange, setFilterRange] = useState<ReportFilterRange>('today');
  const [customDate, setCustomDate] = useState<string>(localDateISO());
  const [searchQuery, setSearchQuery] = useState('');
  const dialogRef = useAppointmentDialog(isOpen, onClose);
  const effectiveRange = canViewHistory ? filterRange : 'today';

  // Helper date strings
  const todayStr = localDateISO();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = localDateISO(yesterday);

  // Helper date filter evaluator
  const isDateInFilter = (dateStr: string) => {
    if (!dateStr) return false;
    if (effectiveRange === 'today') return dateStr === todayStr;
    if (effectiveRange === 'yesterday') return dateStr === yesterdayStr;
    if (effectiveRange === 'custom') return dateStr === customDate;
    
    const d = new Date(dateStr);
    const now = new Date();
    
    if (effectiveRange === 'week') {
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(now.getDate() - 6);
      return dateStr >= localDateISO(oneWeekAgo) && dateStr <= todayStr;
    }
    
    if (effectiveRange === 'month') {
      return dateStr.slice(0, 7) === todayStr.slice(0, 7);
    }
    
    return true;
  };

  // Compile Financial & Collection Metrics using financials.ts engine
  const metrics = useMemo(() => {
    return calculateDailyCollections(patients, isDateInFilter);
  }, [patients, effectiveRange, customDate, todayStr]);

  // Filter visit list by search query
  const filteredRows = useMemo(() => {
    if (!searchQuery.trim()) return metrics.rows;
    const q = searchQuery.trim().toLowerCase();
    return metrics.rows.filter(r =>
      r.patientName.toLowerCase().includes(q) ||
      r.fileNo.includes(q) ||
      r.proceduresText.toLowerCase().includes(q)
    );
  }, [metrics.rows, searchQuery]);

  if (!isOpen) return null;

  const mask = (val: number) => isPrivacyMode ? '***' : `${val.toLocaleString()} ج.م`;

  return (
    <div className="clinic-modal-overlay fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 overflow-y-auto animate-fadeIn dir-rtl font-['Cairo',sans-serif]">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="تقرير التحصيل" tabIndex={-1} className="clinic-modal-panel clinic-modal-panel--framed bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-5xl overflow-hidden my-auto flex flex-col max-h-[92dvh]">
        
        {/* Header */}
        <div className="bg-linear-to-r from-slate-900 via-indigo-950 to-slate-900 text-white p-4 sm:p-5 flex items-center justify-between shrink-0 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-600/30 text-indigo-300 flex items-center justify-center border border-indigo-500/30">
              <Landmark className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-black font-tajawal flex items-center gap-2">
                تقرير التحصيل
              </h3>
              <p className="text-xs text-slate-300 font-medium">
                راجع الخدمات والدفعات المسجلة في الفترة المختارة
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-all cursor-pointer touch-manipulation active:scale-95"
            title="إلغاء وإغلاق"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Filter Controls Bar */}
        <div className="bg-slate-50 border-b border-slate-200 p-3 sm:p-4 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto">
            <span className="text-xs font-black text-slate-700 font-tajawal shrink-0 ml-1">
              الفترة الزمنية للتقرير:
            </span>

            <button
              type="button"
              onClick={() => setFilterRange('today')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer touch-manipulation shrink-0 ${
                filterRange === 'today'
                  ? 'bg-indigo-600 text-white shadow-2xs font-black'
                  : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              اليوم
            </button>

            <button
              type="button"
              onClick={() => setFilterRange('yesterday')}
              disabled={!canViewHistory}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer touch-manipulation shrink-0 ${
                filterRange === 'yesterday'
                  ? 'bg-indigo-600 text-white shadow-2xs font-black'
                  : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              الأمس
            </button>

            <button
              type="button"
              onClick={() => setFilterRange('week')}
              disabled={!canViewHistory}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer touch-manipulation shrink-0 ${
                filterRange === 'week'
                  ? 'bg-indigo-600 text-white shadow-2xs font-black'
                  : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              آخر 7 أيام
            </button>

            <button
              type="button"
              onClick={() => setFilterRange('month')}
              disabled={!canViewHistory}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer touch-manipulation shrink-0 ${
                filterRange === 'month'
                  ? 'bg-indigo-600 text-white shadow-2xs font-black'
                  : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              هذا الشهر
            </button>

            <button
              type="button"
              onClick={() => setFilterRange('custom')}
              disabled={!canViewHistory}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer touch-manipulation shrink-0 ${
                filterRange === 'custom'
                  ? 'bg-indigo-600 text-white shadow-2xs font-black'
                  : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              تاريخ مخصص
            </button>
          </div>

          {effectiveRange === 'custom' && (
            <div className="flex items-center gap-2">
              <label className="text-xs font-bold text-slate-600">اختر التاريخ:</label>
              <input
                type="date"
                value={customDate}
                onChange={(e) => setCustomDate(e.target.value)}
                className="px-3 py-1.5 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-900 outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          )}
        </div>

        {/* Scrollable Report Content */}
        <div className="min-h-0 p-4 sm:p-6 overflow-y-auto space-y-6 flex-1 bg-slate-50/50">
          
          {/* SECTION 1: MAIN REVENUE METRICS CARDS */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            
            {/* Total Income Collected */}
            <div className="bg-emerald-600 text-white p-4 rounded-2xl shadow-md border border-emerald-500">
              <div className="flex items-center justify-between mb-1 opacity-90">
                <span className="text-xs font-black font-tajawal">التحصيل الفعلي للفترة</span>
                <TrendingUp className="w-5 h-5" />
              </div>
              <div className="text-2xl sm:text-3xl font-black font-mono tracking-tight my-1">
                {mask(metrics.totalIncomeCollected)}
              </div>
              <div className="text-[10px] opacity-80 font-bold">
                كل الدفعات مسجلة نقدًا حسب نظام العيادة
              </div>
            </div>

            {/* Total Discounts / Exemptions */}
            <div className="bg-amber-50 p-4 rounded-2xl border border-amber-300 shadow-2xs">
              <div className="flex items-center justify-between mb-1 text-amber-900">
                <span className="text-xs font-black font-tajawal">إجمالي الإعفاءات والخصومات</span>
                <Percent className="w-5 h-5 text-amber-600" />
              </div>
              <div className="text-2xl sm:text-3xl font-black text-amber-950 font-mono tracking-tight my-1">
                {mask(metrics.totalDiscountsGiven)}
              </div>
              <div className="text-[10px] text-amber-700 font-bold">
                تُخصم من المتبقي ولا تُحتسب كإيراد عيادة
              </div>
            </div>

            {/* Total Outstanding Remaining */}
            <div className="bg-rose-50 p-4 rounded-2xl border border-rose-200 shadow-2xs">
              <div className="flex items-center justify-between mb-1 text-rose-900">
                <span className="text-xs font-black font-tajawal font-tajawal">المتبقي المطلوب (ديون زيارات)</span>
                <AlertCircle className="w-5 h-5 text-rose-600" />
              </div>
              <div className="text-2xl sm:text-3xl font-black text-rose-800 font-mono tracking-tight my-1">
                {canViewRemainingBalance ? mask(metrics.totalOutstandingRemain) : 'غير متاح'}
              </div>
              <div className="text-[10px] text-rose-600 font-bold">
                متبقي غير مسدد على جلسات الفترة
              </div>
            </div>

            {/* Visited Patients Count */}
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
              <div className="flex items-center justify-between mb-1 text-slate-700">
                <span className="text-xs font-black font-tajawal">عدد المرضى المستفيدين</span>
                <Users className="w-5 h-5 text-indigo-600" />
              </div>
              <div className="text-2xl sm:text-3xl font-black text-slate-900 font-mono my-1">
                {metrics.visitedPatientsCount} مريض
              </div>
              <div className="text-[10px] text-slate-500 font-bold">
                إجمالي حالات الجلسات والتحصيلات
              </div>
            </div>

          </div>

          {/* SECTION 2: PROCEDURE BREAKDOWN & PAYMENT METHODS */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            
            {/* Procedure Income Breakdown */}
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs space-y-3">
              <h4 className="text-xs font-black text-slate-900 font-tajawal flex items-center justify-between border-b border-slate-100 pb-2">
                <span>إيراد كل خدمة على حدة:</span>
                <FileText className="w-4 h-4 text-indigo-600" />
              </h4>

              <div className="space-y-1.5 text-xs font-bold">
                {Object.keys(metrics.procedureFeesCollectedByName).length > 0 ? (
                  Object.entries(metrics.procedureFeesCollectedByName).map(([procName, amount]) => (
                    <div key={procName} className="flex items-center justify-between p-2 rounded-xl bg-slate-50 border border-slate-100">
                      <span className="text-slate-800 font-bold">{procName}</span>
                      <span className="font-mono font-black text-indigo-900">{mask(Number(amount))}</span>
                    </div>
                  ))
                ) : (
                  <div className="text-center p-3 text-slate-400 text-xs">لا توجد خدمات محصلة في هذه الفترة</div>
                )}
              </div>
            </div>

            {/* Payment Methods Breakdown */}
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs space-y-3">
              <h4 className="text-xs font-black text-slate-900 font-tajawal flex items-center justify-between border-b border-slate-100 pb-2">
                <span>طريقة تسجيل التحصيل:</span>
                <CreditCard className="w-4 h-4 text-indigo-600" />
              </h4>

              <div className="text-center">
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <span className="text-[11px] font-bold text-slate-600 block mb-1">نقدًا</span>
                  <span className="text-sm sm:text-base font-black font-mono text-slate-900 block">{mask(metrics.cashTotal)}</span>
                </div>

              </div>
            </div>

          </div>

          {/* SECTION 3: DETAILED TRANSACTIONS TABLE */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden space-y-3 p-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <h4 className="text-xs sm:text-sm font-black text-slate-900 font-tajawal flex items-center gap-2">
                  جدول العمليات والتحصيلات التفصيلي
                  <span className="bg-indigo-100 text-indigo-800 text-xs font-bold px-2.5 py-0.5 rounded-full font-mono">
                    {filteredRows.length} سجل
                  </span>
                </h4>
                <p className="text-[11px] text-slate-500 font-medium">
                  عرض كل زيارة، الخدمات المقدمة، المبلغ المستحصل، والخصم الممنوح
                </p>
              </div>

              {/* Quick Search inside report */}
              <div className="relative w-full sm:w-64">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-2.5" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="بحث باسم المريض أو الخدمة..."
                  className="w-full pl-3 pr-8 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:ring-2 focus:ring-indigo-500 outline-none"
                />
              </div>
            </div>

            {/* Visit Table */}
            {filteredRows.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="daily-report-table w-full text-right text-xs font-medium text-slate-700 border-collapse">
                  <thead>
                    <tr className="bg-slate-50 text-slate-900 font-black font-tajawal border-b border-slate-200">
                      <th className="p-2.5">المريض / الملف</th>
                      <th className="p-2.5">الوقت والتاريخ</th>
                      <th className="p-2.5">الخدمات المنفذة</th>
                      <th className="p-2.5">إجمالي المطلوب</th>
                      <th className="p-2.5 text-emerald-700">المحصل فعلياً</th>
                      <th className="p-2.5 text-amber-700">الخصم/الإعفاء</th>
                      <th className="p-2.5 text-rose-700">المتبقي</th>
                      <th className="p-2.5 text-center">طريقة الدفع</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredRows.map((row, idx) => (
                      <tr 
                        key={`${row.sessionId}_${idx}`}
                        className="hover:bg-indigo-50/40 transition-colors cursor-pointer"
                        onClick={() => {
                          if (onSelectPatientFile) {
                            onSelectPatientFile(row.patientId);
                            onClose();
                          }
                        }}
                      >
                        <td className="p-2.5 font-bold text-slate-900">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-[11px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-600">
                              #{row.fileNo}
                            </span>
                            {onSelectPatientFile ? <button type="button" className="font-tajawal text-xs text-indigo-700 hover:underline min-h-11" aria-label={`فتح ملف ${row.patientName}`}>{row.patientName}</button> : <span className="font-tajawal text-xs">{row.patientName}</span>}
                            {row.isWalkIn && (
                              <span className="text-[9px] font-black bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded-full shrink-0">
                                زائر
                              </span>
                            )}
                          </div>
                        </td>

                        <td className="p-2.5 font-mono text-[11px] text-slate-500">
                          {row.date} ({row.time})
                        </td>

                        <td className="p-2.5 font-bold text-slate-800 max-w-xs truncate">
                          {row.proceduresText}
                        </td>

                        <td className="p-2.5 font-mono">
                          {mask(row.totalValue)}
                        </td>

                        <td className="p-2.5 font-mono font-black text-emerald-700 bg-emerald-50/50">
                          {mask(row.paidAmount)}
                        </td>

                        <td className="p-2.5 font-mono font-bold text-amber-700">
                          {row.discountAmount > 0 ? mask(row.discountAmount) : '-'}
                        </td>

                        <td className="p-2.5 font-mono font-bold">
                          {!canViewRemainingBalance ? <span className="text-slate-400">غير متاح</span> : row.remainAmount > 0 ? (
                            <span className="text-rose-600 font-black">{mask(row.remainAmount)}</span>
                          ) : (
                            <span className="text-slate-400">0</span>
                          )}
                        </td>

                        <td className="p-2.5 text-center">
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-slate-700 inline-block">
                            {row.paymentMethod === 'cash' ? '💵 نقدًا' : row.paymentMethod === 'card' ? '💳 بطاقة' : '📲 تحويل'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-8 text-center text-slate-500 space-y-1">
                <Clock className="w-8 h-8 mx-auto text-slate-300" />
                <p className="text-xs font-bold">لا توجد عمليات أو تحصيلات مسجلة لهذه الفترة المختارة.</p>
              </div>
            )}
          </div>

        </div>

        {/* Footer */}
        <div className="bg-slate-50 border-t border-slate-200 p-3 sm:p-4 flex flex-wrap gap-2 items-center justify-between shrink-0">
          <div className="text-xs font-bold text-slate-500 font-mono">
            تقرير التحصيل: {new Date().toLocaleDateString('ar-EG')}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-black text-xs transition-all active:scale-95 cursor-pointer touch-manipulation"
          >
            إغلاق التقرير
          </button>
        </div>

      </div>
    </div>
  );
};
