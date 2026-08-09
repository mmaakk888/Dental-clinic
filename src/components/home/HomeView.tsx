import React, { useState, useMemo, useEffect } from 'react';
import { 
  Users, Calendar, Microscope, Landmark, Sliders, ChevronLeft, 
  Search, User, Stethoscope, Zap, UserPlus, PhoneCall, Sparkles, 
  AlertCircle, Plus, Receipt, FileText, CheckCircle2, Clock, X,
  ArrowUpRight, HeartPulse, CreditCard, BarChart3, TrendingUp, DollarSign, Activity
} from 'lucide-react';
import { ActiveView, UILabels, User as UserType, Patient, Appointment, Expense } from '../../types';
import { AiAssistantPanel } from './AiAssistantPanel';

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

// Unified Reusable Badge Component
const UnifiedBadge: React.FC<{
  children: React.ReactNode;
  variant?: 'indigo' | 'amber' | 'emerald' | 'purple' | 'teal' | 'rose' | 'slate';
  className?: string;
}> = ({ children, variant = 'slate', className = '' }) => {
  const variants = {
    indigo: 'bg-indigo-50 text-indigo-700 border-indigo-100',
    amber: 'bg-amber-50 text-amber-700 border-amber-100',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    purple: 'bg-purple-50 text-purple-700 border-purple-100',
    teal: 'bg-teal-50 text-teal-700 border-teal-100',
    rose: 'bg-rose-50 text-rose-700 border-rose-100',
    slate: 'bg-slate-100 text-slate-700 border-slate-200/80',
  };
  return (
    <span className={`inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-md border font-tajawal shrink-0 ${variants[variant]} ${className}`}>
      {children}
    </span>
  );
};

export const HomeView: React.FC<HomeViewProps> = React.memo(({
  clinicName,
  labels,
  tileOrder,
  patientCount,
  todayApptCount,
  activeLabCount,
  onNavigate,
  currentUser,
  patients = [],
  appointments = [],
  expenses = [],
  isPrivacyMode = false,
  onSelectPatient,
  onLogout,
  onOpenWalkIn,
  onOpenDailyReport,
  onOpenScheduleModal,
  onOpenInvoiceModal,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [isQuickActionsOpen, setIsQuickActionsOpen] = useState(false);
  const [isFabVisible, setIsFabVisible] = useState(true);

  // Auto-hide FAB on scroll down, show on scroll up
  useEffect(() => {
    let lastScrollY = window.scrollY;
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      if (currentScrollY > lastScrollY && currentScrollY > 60) {
        setIsFabVisible(false);
      } else {
        setIsFabVisible(true);
      }
      lastScrollY = currentScrollY;
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const isReceptionist = useMemo(() => {
    return currentUser?.role === 'secretary' || currentUser?.role === 'receptionist';
  }, [currentUser]);

  // Calculate daily metrics cleanly
  const { 
    todayRevenue, 
    todayPatientsCount, 
    newPatientsTodayCount, 
    followupPatientsTodayCount,
    todayApptsList,
    totalExpensesToday,
    totalDebtPending
  } = useMemo(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    let rev = 0;
    let todayPatientsSet = new Set<string>();
    let newCount = 0;
    let followupCount = 0;
    let totalDebt = 0;

    patients.forEach(p => {
      let isToday = false;
      const createdToday = p.createdAt === todayStr;

      // Calculate debt pending
      const cost = p.sessions ? p.sessions.reduce((sAcc, s) => sAcc + s.amount, 0) : 0;
      const paid = (p.sessions ? p.sessions.reduce((sAcc, s) => sAcc + (s.paid || 0), 0) : 0) + 
                   (p.payments ? p.payments.reduce((pAcc, pay) => pAcc + pay.amount, 0) : 0);
      totalDebt += Math.max(0, cost - paid);

      if (p.payments) {
        p.payments.forEach(pay => {
          if (pay.date === todayStr) {
            rev += (pay.amount || 0);
            isToday = true;
          }
        });
      }

      if (p.sessions) {
        p.sessions.forEach(s => {
          if (s.date === todayStr) {
            rev += (s.paid || 0);
            isToday = true;
          }
        });
      }

      if (createdToday) {
        newCount++;
        todayPatientsSet.add(p.id);
      } else if (isToday) {
        followupCount++;
        todayPatientsSet.add(p.id);
      }
    });

    const todayAppts = appointments.filter(a => a.date === todayStr);
    const expToday = expenses.filter(e => e.date === todayStr).reduce((acc, e) => acc + e.amount, 0);

    return {
      todayRevenue: rev,
      todayPatientsCount: todayPatientsSet.size,
      newPatientsTodayCount: newCount,
      followupPatientsTodayCount: followupCount,
      todayApptsList: todayAppts,
      totalExpensesToday: expToday,
      totalDebtPending: totalDebt
    };
  }, [patients, appointments, expenses]);

  // Live instant patient filtering
  const filteredPatients = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase().trim();
    return patients.filter(p => 
      (p.name && p.name.toLowerCase().includes(q)) ||
      (p.mobile && p.mobile.includes(q)) ||
      ((p as any).phone && (p as any).phone.includes(q)) ||
      (p.id && p.id.includes(q))
    ).slice(0, 5);
  }, [patients, searchQuery]);

  return (
    <div className="w-full max-w-7xl mx-auto space-y-4 font-['Cairo',sans-serif] text-slate-900 select-none px-2 sm:px-4 dir-rtl pb-28 md:pb-8 leading-relaxed">
      
      {/* =========================================================
          SECTION 1: SEARCH BAR & INSTANT PATIENT RESULTS
          ========================================================= */}
      <section className="bg-white rounded-2xl p-3 border border-slate-200/90 shadow-2xs space-y-2 font-cairo">
        <div className="relative flex items-center">
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="ابحث باسم المريض، رقم الهاتف، أو رقم الملف..."
            className="w-full h-11 pr-11 pl-10 bg-slate-50 border border-slate-200/90 rounded-xl text-xs sm:text-sm font-bold text-slate-900 placeholder-slate-400 focus:bg-white focus:border-indigo-600 focus:ring-2 focus:ring-indigo-100 outline-none transition-all dir-rtl"
            style={{ fontSize: '16px' }}
          />
          <Search className="w-4.5 h-4.5 text-indigo-500 absolute right-3.5 pointer-events-none" />
          
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute left-2.5 text-slate-500 hover:text-slate-700 text-xs font-bold px-2.5 py-1 rounded-lg bg-slate-200/70 active:scale-95 transition-all min-h-[36px] flex items-center justify-center cursor-pointer"
            >
              إلغاء
            </button>
          )}
        </div>

        {/* Live Search Dropdown Results */}
        {filteredPatients.length > 0 && (
          <div className="p-2 bg-slate-50 rounded-xl border border-slate-200/90 space-y-1.5 animate-fadeIn">
            <div className="flex items-center justify-between px-1.5 text-xs font-bold text-slate-500">
              <span className="font-tajawal">نتائج البحث المباشر ({filteredPatients.length}):</span>
              <span className="text-indigo-600 font-bold text-[11px] font-tajawal">انقر لفتح الملف</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {filteredPatients.map(p => (
                <div
                  key={p.id}
                  onClick={() => {
                    if (onSelectPatient) onSelectPatient(p.id, 'home');
                    setSearchQuery('');
                  }}
                  className="p-2.5 bg-white hover:bg-indigo-50/70 border border-slate-200/90 rounded-xl flex items-center justify-between cursor-pointer transition-all active:scale-98 min-h-[48px] shadow-2xs"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8.5 h-8.5 rounded-full bg-indigo-100 text-indigo-800 text-xs font-black flex items-center justify-center shrink-0 border border-indigo-200/70 font-mono">
                      {p.name.charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <span className="text-xs sm:text-sm font-bold text-slate-900 truncate block font-tajawal">{p.name}</span>
                      <span className="text-[11px] text-slate-500 font-mono block dir-ltr text-right">
                        📱 {p.mobile || (p as any).phone || 'بدون هاتف'}
                      </span>
                    </div>
                  </div>
                  <ChevronLeft className="w-4.5 h-4.5 text-indigo-500 shrink-0" />
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* =========================================================
          SECTION 2: TODAY'S SUMMARY WIDGETS (4 CARDS GRID)
          ========================================================= */}
      <section className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <h2 className="text-xs sm:text-sm font-black text-slate-800 font-tajawal">
              {isReceptionist ? 'ملخص الاستقبال والعمليات اليومية' : 'ملخص الكشف والعيادة اليوم'}
            </h2>
            <UnifiedBadge variant={isReceptionist ? 'teal' : 'indigo'}>
              {isReceptionist ? 'حساب الاستقبال' : 'لوحة الطبيب'}
            </UnifiedBadge>
          </div>
          <span className="text-[11px] font-bold text-slate-400 font-mono">
            {new Date().toLocaleDateString('ar-EG', { weekday: 'short', day: 'numeric', month: 'short' })}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {isReceptionist ? (
            /* ================= RECEPTIONIST SUMMARY CARDS ================= */
            <>
              {/* Card 1: Today's Appointments */}
              <div 
                onClick={() => onNavigate('appointments')}
                className="group bg-white hover:bg-amber-50/60 p-3 rounded-2xl border border-slate-200/90 shadow-2xs hover:shadow-xs transition-all cursor-pointer flex flex-col justify-between active:scale-98 touch-manipulation min-h-[92px]"
              >
                <div className="flex items-center justify-between w-full">
                  <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                    <Calendar className="w-4 h-4" />
                  </div>
                  <ChevronLeft className="w-4 h-4 text-slate-400 group-hover:text-amber-600 transition-colors" />
                </div>
                <div>
                  <span className="text-xl sm:text-2xl font-black text-slate-900 font-mono block leading-none mt-1">
                    {todayApptCount}
                  </span>
                  <span className="text-xs text-slate-800 font-black block truncate mt-1 font-tajawal">
                    حجوزات اليوم
                  </span>
                  <span className="text-[10px] text-slate-500 font-bold block truncate">
                    مواعيد العيادة المقررة
                  </span>
                </div>
              </div>

              {/* Card 2: New Patient Registrations */}
              <div 
                onClick={() => onNavigate('patients')}
                className="group bg-white hover:bg-indigo-50/60 p-3 rounded-2xl border border-slate-200/90 shadow-2xs hover:shadow-xs transition-all cursor-pointer flex flex-col justify-between active:scale-98 touch-manipulation min-h-[92px]"
              >
                <div className="flex items-center justify-between w-full">
                  <div className="w-8 h-8 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
                    <UserPlus className="w-4 h-4" />
                  </div>
                  <ChevronLeft className="w-4 h-4 text-slate-400 group-hover:text-indigo-600 transition-colors" />
                </div>
                <div>
                  <span className="text-xl sm:text-2xl font-black text-slate-900 font-mono block leading-none mt-1">
                    {newPatientsTodayCount}
                  </span>
                  <span className="text-xs text-slate-800 font-black block truncate mt-1 font-tajawal">
                    مرضى جدد اليوم
                  </span>
                  <span className="text-[10px] text-slate-500 font-bold block truncate">
                    تسجيل وملفات جديدة
                  </span>
                </div>
              </div>

              {/* Card 3: Payments & Collections */}
              <div 
                onClick={() => onNavigate('secretary-desk')}
                className="group bg-white hover:bg-emerald-50/60 p-3 rounded-2xl border border-slate-200/90 shadow-2xs hover:shadow-xs transition-all cursor-pointer flex flex-col justify-between active:scale-98 touch-manipulation min-h-[92px]"
              >
                <div className="flex items-center justify-between w-full">
                  <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                    <Landmark className="w-4 h-4" />
                  </div>
                  <ChevronLeft className="w-4 h-4 text-slate-400 group-hover:text-emerald-600 transition-colors" />
                </div>
                <div>
                  <span className="text-base sm:text-xl font-black text-slate-900 font-mono block leading-none mt-1 truncate">
                    {isPrivacyMode ? '***' : (todayRevenue > 0 ? `${todayRevenue.toLocaleString()} د.ع` : '0 د.ع')}
                  </span>
                  <span className="text-xs text-slate-800 font-black block truncate mt-1 font-tajawal">
                    تحصيل المقبوضات
                  </span>
                  <span className="text-[10px] text-slate-500 font-bold block truncate">
                    سندات التحصيل اليومي
                  </span>
                </div>
              </div>

              {/* Card 4: Prosthetic Orders */}
              <div 
                onClick={() => onNavigate('lab')}
                className="group bg-white hover:bg-purple-50/60 p-3 rounded-2xl border border-slate-200/90 shadow-2xs hover:shadow-xs transition-all cursor-pointer flex flex-col justify-between active:scale-98 touch-manipulation min-h-[92px]"
              >
                <div className="flex items-center justify-between w-full">
                  <div className="w-8 h-8 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center shrink-0">
                    <Microscope className="w-4 h-4" />
                  </div>
                  <ChevronLeft className="w-4 h-4 text-slate-400 group-hover:text-purple-600 transition-colors" />
                </div>
                <div>
                  <span className="text-xl sm:text-2xl font-black text-slate-900 font-mono block leading-none mt-1">
                    {activeLabCount}
                  </span>
                  <span className="text-xs text-slate-800 font-black block truncate mt-1 font-tajawal">
                    التركيبات
                  </span>
                  <span className="text-[10px] text-slate-500 font-bold block truncate">
                    استلام وتتبع الحالات
                  </span>
                </div>
              </div>
            </>
          ) : (
            /* ================= DOCTOR SUMMARY CARDS ================= */
            <>
              {/* Card 1: Patients Today */}
              <div 
                onClick={() => onNavigate('patients')}
                className="group bg-white hover:bg-indigo-50/60 p-3 rounded-2xl border border-slate-200/90 shadow-2xs hover:shadow-xs transition-all cursor-pointer flex flex-col justify-between active:scale-98 touch-manipulation min-h-[92px]"
              >
                <div className="flex items-center justify-between w-full">
                  <div className="w-8 h-8 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
                    <Users className="w-4 h-4" />
                  </div>
                  <ChevronLeft className="w-4 h-4 text-slate-400 group-hover:text-indigo-600 transition-colors" />
                </div>
                <div>
                  <span className="text-xl sm:text-2xl font-black text-slate-900 font-mono block leading-none mt-1">
                    {todayPatientsCount > 0 ? todayPatientsCount : patientCount}
                  </span>
                  <span className="text-xs text-slate-800 font-black block truncate mt-1 font-tajawal">
                    مرضى اليوم
                  </span>
                  <span className="text-[10px] text-slate-500 font-bold block truncate">
                    {newPatientsTodayCount > 0 ? `${newPatientsTodayCount} جديد • ` : ''}{followupPatientsTodayCount > 0 ? `${followupPatientsTodayCount} متابعة` : 'كشوفات عيادة'}
                  </span>
                </div>
              </div>

              {/* Card 2: Today's Appointments */}
              <div 
                onClick={() => onNavigate('appointments')}
                className="group bg-white hover:bg-amber-50/60 p-3 rounded-2xl border border-slate-200/90 shadow-2xs hover:shadow-xs transition-all cursor-pointer flex flex-col justify-between active:scale-98 touch-manipulation min-h-[92px]"
              >
                <div className="flex items-center justify-between w-full">
                  <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                    <Calendar className="w-4 h-4" />
                  </div>
                  <ChevronLeft className="w-4 h-4 text-slate-400 group-hover:text-amber-600 transition-colors" />
                </div>
                <div>
                  <span className="text-xl sm:text-2xl font-black text-slate-900 font-mono block leading-none mt-1">
                    {todayApptCount}
                  </span>
                  <span className="text-xs text-slate-800 font-black block truncate mt-1 font-tajawal">
                    مواعيد اليوم
                  </span>
                  <span className="text-[10px] text-slate-500 font-bold block truncate">
                    جدول الحجوزات
                  </span>
                </div>
              </div>

              {/* Card 3: Today's Revenue */}
              <div 
                onClick={() => onNavigate('summary')}
                className="group bg-white hover:bg-emerald-50/60 p-3 rounded-2xl border border-slate-200/90 shadow-2xs hover:shadow-xs transition-all cursor-pointer flex flex-col justify-between active:scale-98 touch-manipulation min-h-[92px]"
              >
                <div className="flex items-center justify-between w-full">
                  <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                    <Landmark className="w-4 h-4" />
                  </div>
                  <ChevronLeft className="w-4 h-4 text-slate-400 group-hover:text-emerald-600 transition-colors" />
                </div>
                <div>
                  <span className="text-base sm:text-xl font-black text-slate-900 font-mono block leading-none mt-1 truncate">
                    {isPrivacyMode ? '***' : (todayRevenue > 0 ? `${todayRevenue.toLocaleString()} د.ع` : '0 د.ع')}
                  </span>
                  <span className="text-xs text-slate-800 font-black block truncate mt-1 font-tajawal">
                    إيراد اليوم
                  </span>
                  <span className="text-[10px] text-slate-500 font-bold block truncate">
                    دخل العيادة المسجل
                  </span>
                </div>
              </div>

              {/* Card 4: Prosthetic Cases */}
              <div 
                onClick={() => onNavigate('lab')}
                className="group bg-white hover:bg-purple-50/60 p-3 rounded-2xl border border-slate-200/90 shadow-2xs hover:shadow-xs transition-all cursor-pointer flex flex-col justify-between active:scale-98 touch-manipulation min-h-[92px]"
              >
                <div className="flex items-center justify-between w-full">
                  <div className="w-8 h-8 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center shrink-0">
                    <Microscope className="w-4 h-4" />
                  </div>
                  <ChevronLeft className="w-4 h-4 text-slate-400 group-hover:text-purple-600 transition-colors" />
                </div>
                <div>
                  <span className="text-xl sm:text-2xl font-black text-slate-900 font-mono block leading-none mt-1">
                    {activeLabCount}
                  </span>
                  <span className="text-xs text-slate-800 font-black block truncate mt-1 font-tajawal">
                    التركيبات
                  </span>
                  <span className="text-[10px] text-slate-500 font-bold block truncate">
                    طلبات قيد الإنجاز
                  </span>
                </div>
              </div>
            </>
          )}
        </div>
      </section>

      {/* =========================================================
          SECTION 3: UPCOMING / TODAY'S APPOINTMENTS (COMPACT TIMELINE)
          ========================================================= */}
      <section className="bg-white rounded-2xl p-4 border border-slate-200/90 shadow-2xs space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-4.5 h-4.5 text-indigo-600" />
            <h3 className="text-xs sm:text-sm font-black text-slate-900 font-tajawal">
              جدول مواعيد اليوم ({todayApptsList.length})
            </h3>
          </div>
          {onOpenDailyReport && (
            <button
              type="button"
              onClick={onOpenDailyReport}
              className="text-xs font-bold text-indigo-700 hover:text-indigo-900 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1 rounded-lg border border-indigo-100 flex items-center gap-1 cursor-pointer active:scale-95 transition-all font-tajawal"
            >
              <span>التقرير اليومي</span>
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {todayApptsList.length === 0 ? (
          <div className="text-center py-6 bg-slate-50 rounded-xl border border-dashed border-slate-200">
            <Calendar className="w-8 h-8 text-slate-300 mx-auto mb-1.5" />
            <p className="text-xs text-slate-500 font-bold">لا توجد مواعيد مسجلة لليوم حتى الآن</p>
          </div>
        ) : (
          <div className="space-y-2">
            {todayApptsList.slice(0, 4).map(appt => (
              <div
                key={appt.id}
                onClick={() => {
                  if (onSelectPatient) onSelectPatient(appt.patientId, 'home');
                }}
                className="p-3 bg-slate-50 hover:bg-indigo-50/60 rounded-xl border border-slate-200/80 flex items-center justify-between gap-3 cursor-pointer transition-all active:scale-98 min-h-[50px]"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-11 py-1 rounded-lg bg-indigo-100 text-indigo-900 font-mono font-black text-xs text-center shrink-0 border border-indigo-200/60">
                    {appt.time || '10:00'}
                  </div>
                  <div className="min-w-0">
                    <span className="text-xs sm:text-sm font-bold text-slate-900 truncate block">
                      {appt.patientName}
                    </span>
                    <span className="text-[11px] text-slate-500 truncate block font-medium">
                      {appt.notes || appt.type || 'كشف عيادة'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <UnifiedBadge variant={appt.status === 'confirmed' ? 'emerald' : 'amber'}>
                    {appt.status === 'confirmed' ? 'مؤكد' : 'منتظر'}
                  </UnifiedBadge>
                  <ChevronLeft className="w-4 h-4 text-slate-400" />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* =========================================================
          SECTION 4: IN-LINE QUICK ACTIONS BAR
          ========================================================= */}
      <section className="bg-gradient-to-r from-slate-900 to-indigo-950 text-white rounded-2xl p-3.5 border border-slate-800 shadow-sm space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6.5 h-6.5 rounded-lg bg-amber-400/20 text-amber-300 flex items-center justify-center shrink-0">
              <Zap className="w-3.5 h-3.5 fill-amber-300" />
            </div>
            <h3 className="text-xs font-bold text-white font-tajawal">
              اختصارات العمليات السريعة
            </h3>
          </div>
          <button
            type="button"
            onClick={() => setIsQuickActionsOpen(true)}
            className="text-[11px] font-bold text-indigo-300 hover:text-white flex items-center gap-1 transition-colors"
          >
            <span>جميع الإجراءات</span>
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <button
            type="button"
            onClick={() => {
              if (onOpenWalkIn) onOpenWalkIn();
              else onNavigate('patients');
            }}
            className="p-2.5 bg-slate-800/80 hover:bg-slate-800 border border-slate-700/80 rounded-xl flex items-center gap-2 text-right transition-all active:scale-95 min-h-[44px]"
          >
            <UserPlus className="w-4 h-4 text-indigo-400 shrink-0" />
            <span className="text-xs font-bold text-slate-200 truncate font-tajawal">مريض جديد</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (onOpenScheduleModal) onOpenScheduleModal();
              else onNavigate('appointments');
            }}
            className="p-2.5 bg-slate-800/80 hover:bg-slate-800 border border-slate-700/80 rounded-xl flex items-center gap-2 text-right transition-all active:scale-95 min-h-[44px]"
          >
            <Calendar className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="text-xs font-bold text-slate-200 truncate font-tajawal">حجز موعد</span>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('secretary-desk')}
            className="p-2.5 bg-slate-800/80 hover:bg-slate-800 border border-slate-700/80 rounded-xl flex items-center gap-2 text-right transition-all active:scale-95 min-h-[44px]"
          >
            <CreditCard className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="text-xs font-bold text-slate-200 truncate font-tajawal">تحصيل مبلغ</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (onOpenInvoiceModal) onOpenInvoiceModal();
              else onNavigate('summary');
            }}
            className="p-2.5 bg-slate-800/80 hover:bg-slate-800 border border-slate-700/80 rounded-xl flex items-center gap-2 text-right transition-all active:scale-95 min-h-[44px]"
          >
            <Receipt className="w-4 h-4 text-rose-400 shrink-0" />
            <span className="text-xs font-bold text-slate-200 truncate font-tajawal">إضافة مصروف</span>
          </button>
        </div>
      </section>

      {/* =========================================================
          SECTION 5: MAIN MODULES GRID
          ========================================================= */}
      <section className="space-y-2">
        <h2 className="text-xs sm:text-sm font-black text-slate-800 font-tajawal px-1">
          الوحدات والأقسام الرئيسية
        </h2>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
          {/* Module 1: Appointments */}
          <button
            type="button"
            onClick={() => onNavigate('appointments')}
            className="group bg-white rounded-2xl p-3.5 border border-slate-200/90 shadow-2xs hover:shadow-md hover:border-amber-400 transition-all duration-200 text-right flex flex-col justify-between cursor-pointer active:scale-95 touch-manipulation min-h-[96px] w-full"
          >
            <div className="flex items-center justify-between w-full">
              <div className="w-8.5 h-8.5 rounded-xl bg-amber-50 group-hover:bg-amber-100 flex items-center justify-center transition-colors shrink-0">
                <Calendar className="w-4.5 h-4.5 text-amber-600" />
              </div>
              <UnifiedBadge variant="amber">{todayApptCount} موعد</UnifiedBadge>
            </div>
            <div>
              <h3 className="text-xs sm:text-sm font-black text-slate-900 group-hover:text-amber-700 font-tajawal transition-colors truncate">
                جدول المواعيد
              </h3>
              <p className="text-[11px] text-slate-500 truncate font-medium mt-0.5">
                الكشوفات والحجوزات
              </p>
            </div>
          </button>

          {/* Module 2: Patients */}
          <button
            type="button"
            onClick={() => onNavigate('patients')}
            className="group bg-white rounded-2xl p-3.5 border border-slate-200/90 shadow-2xs hover:shadow-md hover:border-indigo-400 transition-all duration-200 text-right flex flex-col justify-between cursor-pointer active:scale-95 touch-manipulation min-h-[96px] w-full"
          >
            <div className="flex items-center justify-between w-full">
              <div className="w-8.5 h-8.5 rounded-xl bg-indigo-50 group-hover:bg-indigo-100 flex items-center justify-center transition-colors shrink-0">
                <Users className="w-4.5 h-4.5 text-indigo-600" />
              </div>
              <UnifiedBadge variant="indigo">{patientCount} مريض</UnifiedBadge>
            </div>
            <div>
              <h3 className="text-xs sm:text-sm font-black text-slate-900 group-hover:text-indigo-700 font-tajawal transition-colors truncate">
                سجل المرضى
              </h3>
              <p className="text-[11px] text-slate-500 truncate font-medium mt-0.5">
                الملفات والتشخيص
              </p>
            </div>
          </button>

          {/* Module 3: Finance */}
          <button
            type="button"
            onClick={() => onNavigate('summary')}
            className="group bg-white rounded-2xl p-3.5 border border-slate-200/90 shadow-2xs hover:shadow-md hover:border-emerald-400 transition-all duration-200 text-right flex flex-col justify-between cursor-pointer active:scale-95 touch-manipulation min-h-[96px] w-full"
          >
            <div className="flex items-center justify-between w-full">
              <div className="w-8.5 h-8.5 rounded-xl bg-emerald-50 group-hover:bg-emerald-100 flex items-center justify-center transition-colors shrink-0">
                <Landmark className="w-4.5 h-4.5 text-emerald-600" />
              </div>
              <UnifiedBadge variant="emerald">المالية</UnifiedBadge>
            </div>
            <div>
              <h3 className="text-xs sm:text-sm font-black text-slate-900 group-hover:text-emerald-700 font-tajawal transition-colors truncate">
                الحسابات والمالية
              </h3>
              <p className="text-[11px] text-slate-500 truncate font-medium mt-0.5">
                الإيرادات والمصروفات
              </p>
            </div>
          </button>

          {/* Module 4: Prosthetic Cases */}
          <button
            type="button"
            onClick={() => onNavigate('lab')}
            className="group bg-white rounded-2xl p-3.5 border border-slate-200/90 shadow-2xs hover:shadow-md hover:border-purple-400 transition-all duration-200 text-right flex flex-col justify-between cursor-pointer active:scale-95 touch-manipulation min-h-[96px] w-full"
          >
            <div className="flex items-center justify-between w-full">
              <div className="w-8.5 h-8.5 rounded-xl bg-purple-50 group-hover:bg-purple-100 flex items-center justify-center transition-colors shrink-0">
                <Microscope className="w-4.5 h-4.5 text-purple-600" />
              </div>
              <UnifiedBadge variant="purple">{activeLabCount} حالة</UnifiedBadge>
            </div>
            <div>
              <h3 className="text-xs sm:text-sm font-black text-slate-900 group-hover:text-purple-700 font-tajawal transition-colors truncate">
                التركيبات
              </h3>
              <p className="text-[11px] text-slate-500 truncate font-medium mt-0.5">
                طلبات وتكاليف التركيبات
              </p>
            </div>
          </button>

          {/* Module 5: Reception Desk */}
          <button
            type="button"
            onClick={() => onNavigate('secretary-desk')}
            className="group bg-white rounded-2xl p-3.5 border border-slate-200/90 shadow-2xs hover:shadow-md hover:border-teal-400 transition-all duration-200 text-right flex flex-col justify-between cursor-pointer active:scale-95 touch-manipulation min-h-[96px] w-full"
          >
            <div className="flex items-center justify-between w-full">
              <div className="w-8.5 h-8.5 rounded-xl bg-teal-50 group-hover:bg-teal-100 flex items-center justify-center transition-colors shrink-0">
                <Stethoscope className="w-4.5 h-4.5 text-teal-600" />
              </div>
              <UnifiedBadge variant="teal">الاستقبال</UnifiedBadge>
            </div>
            <div>
              <h3 className="text-xs sm:text-sm font-black text-slate-900 group-hover:text-teal-700 font-tajawal transition-colors truncate">
                مكتب الاستقبال
              </h3>
              <p className="text-[11px] text-slate-500 truncate font-medium mt-0.5">
                تسجيل الدخول والتحصيل
              </p>
            </div>
          </button>
        </div>
      </section>

      {/* =========================================================
          SECTION 6: AI ASSISTANT PANEL
          ========================================================= */}
      <AiAssistantPanel
        patients={patients}
        appointments={appointments}
        expenses={expenses}
        onOpenScheduleModal={() => onOpenScheduleModal && onOpenScheduleModal()}
        onOpenInvoiceModal={() => onOpenInvoiceModal && onOpenInvoiceModal()}
        onNavigateToPatients={() => onNavigate('patients')}
      />

      {/* =========================================================
          SECTION 7: CLINIC PERFORMANCE & DASHBOARD REPORT WIDGET
          ========================================================= */}
      <section className="bg-white rounded-2xl p-4 border border-slate-200/90 shadow-2xs space-y-3">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
              <BarChart3 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs sm:text-sm font-black text-slate-900 font-tajawal">
                تقرير العيادة ومؤشرات الأداء
              </h3>
              <p className="text-[10px] text-slate-500 font-medium">ملخص حركة العيادة الإجمالية</p>
            </div>
          </div>

          {onOpenDailyReport && (
            <button
              type="button"
              onClick={onOpenDailyReport}
              className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-3 py-1.5 rounded-xl shadow-2xs transition-all active:scale-95 flex items-center gap-1 font-tajawal"
            >
              <span>تقرير تفصيلي</span>
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Dashboard Metrics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {/* Item 1: Revenue */}
          <div 
            onClick={() => onNavigate('summary')}
            className="p-3 bg-emerald-50/60 rounded-xl border border-emerald-100/80 cursor-pointer hover:bg-emerald-50 transition-colors"
          >
            <span className="text-[10px] text-emerald-700 font-bold block">مقبوضات اليوم</span>
            <span className="text-sm font-black text-emerald-950 font-mono block mt-0.5 dir-ltr text-right truncate">
              {isPrivacyMode ? '***' : `${todayRevenue.toLocaleString()} د.ع`}
            </span>
          </div>

          {/* Item 2: Patients Total */}
          <div 
            onClick={() => onNavigate('patients')}
            className="p-3 bg-indigo-50/60 rounded-xl border border-indigo-100/80 cursor-pointer hover:bg-indigo-50 transition-colors"
          >
            <span className="text-[10px] text-indigo-700 font-bold block">إجمالي المرضى</span>
            <span className="text-sm font-black text-indigo-950 font-mono block mt-0.5 dir-ltr text-right">
              {patientCount} مريض
            </span>
          </div>

          {/* Item 3: Expenses Today */}
          <div 
            onClick={() => onNavigate('summary')}
            className="p-3 bg-rose-50/60 rounded-xl border border-rose-100/80 cursor-pointer hover:bg-rose-50 transition-colors"
          >
            <span className="text-[10px] text-rose-700 font-bold block">مصروفات اليوم</span>
            <span className="text-sm font-black text-rose-950 font-mono block mt-0.5 dir-ltr text-right truncate">
              {isPrivacyMode ? '***' : `${totalExpensesToday.toLocaleString()} د.ع`}
            </span>
          </div>

          {/* Item 4: Pending Debts */}
          <div 
            onClick={() => onNavigate('secretary-desk')}
            className="p-3 bg-amber-50/60 rounded-xl border border-amber-100/80 cursor-pointer hover:bg-amber-50 transition-colors"
          >
            <span className="text-[10px] text-amber-700 font-bold block">متبقي الديون</span>
            <span className="text-sm font-black text-amber-950 font-mono block mt-0.5 dir-ltr text-right truncate">
              {isPrivacyMode ? '***' : `${totalDebtPending.toLocaleString()} د.ع`}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
});

HomeView.displayName = 'HomeView';

