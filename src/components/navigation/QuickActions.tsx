import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { ActiveView, User as UserType, Patient, Appointment, LabCase, Expense } from '../../types';
import { 
  Zap, UserPlus, Calendar, Receipt, FileText, CreditCard, Microscope, 
  Sliders, Plus, Search, Sparkles, ChevronDown, X, Printer, Stethoscope, 
  Activity, CheckCircle2, Clock, ArrowUpRight, ChevronLeft, Keyboard, 
  Command, Download, ShieldCheck, HeartPulse
} from 'lucide-react';

export interface QuickActionsProps {
  activeView: ActiveView;
  currentUser: UserType | null;
  patients?: Patient[];
  appointments?: Appointment[];
  labCases?: LabCase[];
  expenses?: Expense[];
  onNavigate: (view: ActiveView, subTab?: string) => void;
  onOpenWalkIn?: () => void;
  onOpenScheduleModal?: () => void;
  onOpenDailyReport?: () => void;
  onOpenInvoiceModal?: () => void;
  onOpenApprovalQueue?: () => void;
  onOpenEndoHelper?: (toothNumber?: string, patientName?: string) => void;
  onSelectPatient?: (patientId: string, origin: any) => void;
  onTriggerAddExpense?: () => void;
  onTriggerAddLabCase?: () => void;
  onTriggerAddPatient?: () => void;
}

interface ActionItem {
  id: string;
  label: string;
  subLabel?: string;
  icon: React.ReactNode;
  badge?: string | number;
  shortcut?: string;
  accentColor: 'indigo' | 'emerald' | 'amber' | 'purple' | 'rose' | 'sky' | 'teal';
  isPrimary: boolean; // Shown directly in Desktop Action Bar
  onClick: () => void;
}

export const QuickActions: React.FC<QuickActionsProps> = React.memo(({
  activeView,
  currentUser,
  patients = [],
  appointments = [],
  labCases = [],
  expenses = [],
  onNavigate,
  onOpenWalkIn,
  onOpenScheduleModal,
  onOpenDailyReport,
  onOpenInvoiceModal,
  onOpenApprovalQueue,
  onOpenEndoHelper,
  onSelectPatient,
  onTriggerAddExpense,
  onTriggerAddLabCase,
  onTriggerAddPatient
}) => {
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const [isMobileSheetOpen, setIsMobileSheetOpen] = useState(false);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  // Close "More" dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setIsMoreMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Keyboard Shortcuts Listener (Alt+N, Alt+A, Alt+E, Alt+R, Esc, ?)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing inside input or textarea
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      if (e.altKey || e.metaKey) {
        const key = e.key.toLowerCase();
        if (key === 'n') {
          e.preventDefault();
          if (onOpenWalkIn) onOpenWalkIn();
          else if (onTriggerAddPatient) onTriggerAddPatient();
          else onNavigate('patients');
        } else if (key === 'a') {
          e.preventDefault();
          if (onOpenScheduleModal) onOpenScheduleModal();
          else onNavigate('appointments');
        } else if (key === 'e') {
          e.preventDefault();
          if (onOpenInvoiceModal) onOpenInvoiceModal();
          else if (onTriggerAddExpense) onTriggerAddExpense();
          else onNavigate('summary');
        } else if (key === 'r') {
          e.preventDefault();
          if (onOpenDailyReport) onOpenDailyReport();
        }
      }

      if (e.key === 'Escape') {
        setIsMoreMenuOpen(false);
        setIsMobileSheetOpen(false);
        setShowShortcutsModal(false);
      }

      if (e.key === '?' && !e.shiftKey) {
        // Toggle shortcuts helper
        setShowShortcutsModal(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onOpenWalkIn, onOpenScheduleModal, onOpenInvoiceModal, onOpenDailyReport, onTriggerAddPatient, onTriggerAddExpense, onNavigate]);

  // Context-Aware Quick Action Items according to activeView
  const actionItems: ActionItem[] = useMemo(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    const todayApptCount = appointments.filter(a => a.date === todayStr).length;
    const pendingLabsCount = labCases.filter(l => l.status === 'pending').length;

    // Helper functions
    const triggerNewPatient = () => {
      if (onOpenWalkIn) onOpenWalkIn();
      else if (onTriggerAddPatient) onTriggerAddPatient();
      else onNavigate('patients');
    };

    const triggerNewAppointment = () => {
      if (onOpenScheduleModal) onOpenScheduleModal();
      else onNavigate('appointments');
    };

    const triggerInvoiceOcr = () => {
      if (onOpenInvoiceModal) onOpenInvoiceModal();
      else onNavigate('summary');
    };

    const triggerDailyReport = () => {
      if (onOpenDailyReport) onOpenDailyReport();
      else onNavigate('summary');
    };

    const triggerEndoHelper = () => {
      if (onOpenEndoHelper) onOpenEndoHelper('21', 'مريض عيادة');
      else onNavigate('patients');
    };

    const triggerApprovalQueue = () => {
      if (onOpenApprovalQueue) onOpenApprovalQueue();
      else onNavigate('home');
    };

    const triggerAddExpense = () => {
      if (onTriggerAddExpense) onTriggerAddExpense();
      else onNavigate('summary');
    };

    const triggerAddLabCase = () => {
      if (onTriggerAddLabCase) onTriggerAddLabCase();
      else onNavigate('lab');
    };

    // View-specific action map
    switch (activeView) {
      case 'patients':
      case 'patient-file':
        return [
          {
            id: 'walkin_patient',
            label: 'مريض جديد (كشف زائر)',
            subLabel: 'تسجيل مريض جديد بلمسة واحدة',
            icon: <UserPlus className="w-4 h-4" />,
            shortcut: 'Alt + N',
            accentColor: 'indigo',
            isPrimary: true,
            onClick: triggerNewPatient
          },
          {
            id: 'smart_schedule',
            label: 'حجز موعد للمريض',
            subLabel: 'إضافة حجز بالأجندة أو الذكاء الاصطناعي',
            icon: <Calendar className="w-4 h-4" />,
            shortcut: 'Alt + A',
            accentColor: 'amber',
            isPrimary: true,
            onClick: triggerNewAppointment
          },
          {
            id: 'endo_helper',
            label: 'مساعد حشو الجذور (Endo)',
            subLabel: 'حساب قياسات وطول أقنية الجذور',
            icon: <Sparkles className="w-4 h-4" />,
            accentColor: 'teal',
            isPrimary: true,
            onClick: triggerEndoHelper
          },
          {
            id: 'lab_order',
            label: 'طلب معمل تركيبات',
            subLabel: 'تسجيل حالة معمل جديدة',
            icon: <Microscope className="w-4 h-4" />,
            badge: pendingLabsCount > 0 ? pendingLabsCount : undefined,
            accentColor: 'purple',
            isPrimary: true,
            onClick: triggerAddLabCase
          },
          // Secondary (More)
          {
            id: 'daily_report',
            label: 'تقرير اليوم المالي',
            subLabel: 'ملخص الحسابات والإيرادات',
            icon: <FileText className="w-4 h-4" />,
            shortcut: 'Alt + R',
            accentColor: 'emerald',
            isPrimary: false,
            onClick: triggerDailyReport
          },
          {
            id: 'ocr_invoice',
            label: 'مسح فاتورة خامات (OCR)',
            subLabel: 'استخراج تلقائي لمستلزمات الموردين',
            icon: <Receipt className="w-4 h-4" />,
            shortcut: 'Alt + E',
            accentColor: 'rose',
            isPrimary: false,
            onClick: triggerInvoiceOcr
          }
        ];

      case 'appointments':
        return [
          {
            id: 'new_appt',
            label: 'حجز موعد جديد',
            subLabel: 'جدول كشف أو جلسة علاجية',
            icon: <Calendar className="w-4 h-4" />,
            shortcut: 'Alt + A',
            accentColor: 'amber',
            isPrimary: true,
            onClick: triggerNewAppointment
          },
          {
            id: 'walkin_patient',
            label: 'كشف سريع بدون موعد',
            subLabel: 'تسجيل مريض زائر فوراً بالعيادة',
            icon: <UserPlus className="w-4 h-4" />,
            shortcut: 'Alt + N',
            accentColor: 'indigo',
            isPrimary: true,
            onClick: triggerNewPatient
          },
          {
            id: 'daily_report',
            label: 'تقرير مواعيد اليوم',
            subLabel: `عدد مواعيد اليوم: ${todayApptCount}`,
            icon: <FileText className="w-4 h-4" />,
            badge: todayApptCount,
            shortcut: 'Alt + R',
            accentColor: 'emerald',
            isPrimary: true,
            onClick: triggerDailyReport
          },
          {
            id: 'reception_desk',
            label: 'التحصيل والمكتب',
            subLabel: 'إدارة الوردية واستلام الدفعات',
            icon: <CreditCard className="w-4 h-4" />,
            accentColor: 'sky',
            isPrimary: true,
            onClick: () => onNavigate('secretary-desk')
          },
          // Secondary
          {
            id: 'ocr_invoice',
            label: 'إضافة فاتورة خامات',
            icon: <Receipt className="w-4 h-4" />,
            shortcut: 'Alt + E',
            accentColor: 'rose',
            isPrimary: false,
            onClick: triggerInvoiceOcr
          }
        ];

      case 'summary':
        return [
          {
            id: 'ocr_invoice',
            label: 'مسح فاتورة ذكي (OCR)',
            subLabel: 'استخراج وتفنيط فواتير الموردين بالذكاء الاصطناعي',
            icon: <Sparkles className="w-4 h-4 text-emerald-300" />,
            shortcut: 'Alt + E',
            accentColor: 'rose',
            isPrimary: true,
            onClick: triggerInvoiceOcr
          },
          {
            id: 'add_expense',
            label: 'إضافة مصروف يدوي',
            subLabel: 'تسجيل المصروفات الثابتة أو التشغيلية',
            icon: <Plus className="w-4 h-4" />,
            accentColor: 'amber',
            isPrimary: true,
            onClick: triggerAddExpense
          },
          {
            id: 'daily_report',
            label: 'تقرير الحسابات اليومي',
            subLabel: 'كشف تفصيلي بالإيرادات والمصروفات',
            icon: <FileText className="w-4 h-4" />,
            shortcut: 'Alt + R',
            accentColor: 'emerald',
            isPrimary: true,
            onClick: triggerDailyReport
          },
          {
            id: 'reception_collections',
            label: 'مكتب التحصيل',
            subLabel: 'متابعة الدفعات المستحقة للعيادة',
            icon: <CreditCard className="w-4 h-4" />,
            accentColor: 'sky',
            isPrimary: true,
            onClick: () => onNavigate('secretary-desk')
          },
          // Secondary
          {
            id: 'walkin_patient',
            label: 'تسجيل كشف زائر',
            icon: <UserPlus className="w-4 h-4" />,
            shortcut: 'Alt + N',
            accentColor: 'indigo',
            isPrimary: false,
            onClick: triggerNewPatient
          }
        ];

      case 'lab':
        return [
          {
            id: 'new_lab_case',
            label: 'طلب تركيبة جديد',
            subLabel: 'تسجيل حالة معمل وتركيب أسنان',
            icon: <Microscope className="w-4 h-4" />,
            badge: pendingLabsCount > 0 ? pendingLabsCount : undefined,
            accentColor: 'purple',
            isPrimary: true,
            onClick: triggerAddLabCase
          },
          {
            id: 'walkin_patient',
            label: 'مريض جديد',
            subLabel: 'تسجيل بيانات مريض الكشف',
            icon: <UserPlus className="w-4 h-4" />,
            shortcut: 'Alt + N',
            accentColor: 'indigo',
            isPrimary: true,
            onClick: triggerNewPatient
          },
          {
            id: 'smart_schedule',
            label: 'حجز موعد التسليم',
            subLabel: 'جدول موعد تجربة أو تسليم التركيبة',
            icon: <Calendar className="w-4 h-4" />,
            shortcut: 'Alt + A',
            accentColor: 'amber',
            isPrimary: true,
            onClick: triggerNewAppointment
          },
          // Secondary
          {
            id: 'daily_report',
            label: 'تقرير المعامل المالي',
            icon: <FileText className="w-4 h-4" />,
            shortcut: 'Alt + R',
            accentColor: 'emerald',
            isPrimary: false,
            onClick: triggerDailyReport
          }
        ];

      case 'secretary-desk':
        return [
          {
            id: 'reception_payment',
            label: 'تحصيل مبلغ / دفعة',
            subLabel: 'تسجيل استلام مستحقات ودفعة مريض',
            icon: <CreditCard className="w-4 h-4" />,
            accentColor: 'emerald',
            isPrimary: true,
            onClick: () => {
              // Scroll to collection box or search in desk
              const input = document.querySelector('input[placeholder*="بحث"]') as HTMLInputElement;
              if (input) input.focus();
            }
          },
          {
            id: 'walkin_patient',
            label: 'تسجيل مريض زائر (كشف)',
            subLabel: 'إدخال سريع للمريض المنتظر بالعيادة',
            icon: <UserPlus className="w-4 h-4" />,
            shortcut: 'Alt + N',
            accentColor: 'indigo',
            isPrimary: true,
            onClick: triggerNewPatient
          },
          {
            id: 'smart_schedule',
            label: 'حجز موعد جديد',
            subLabel: 'جدولة كشف أو استشارة بأجندة العيادة',
            icon: <Calendar className="w-4 h-4" />,
            shortcut: 'Alt + A',
            accentColor: 'amber',
            isPrimary: true,
            onClick: triggerNewAppointment
          },
          {
            id: 'daily_report',
            label: 'تقرير الوردية اليومي',
            subLabel: 'إغلاق ومراجعة الصندوق اليومي',
            icon: <FileText className="w-4 h-4" />,
            shortcut: 'Alt + R',
            accentColor: 'sky',
            isPrimary: true,
            onClick: triggerDailyReport
          },
          // Secondary
          {
            id: 'ocr_invoice',
            label: 'مسح فاتورة توريد',
            icon: <Receipt className="w-4 h-4" />,
            shortcut: 'Alt + E',
            accentColor: 'rose',
            isPrimary: false,
            onClick: triggerInvoiceOcr
          }
        ];

      case 'settings':
        return [
          {
            id: 'walkin_patient',
            label: 'مريض جديد',
            icon: <UserPlus className="w-4 h-4" />,
            shortcut: 'Alt + N',
            accentColor: 'indigo',
            isPrimary: true,
            onClick: triggerNewPatient
          },
          {
            id: 'daily_report',
            label: 'التقرير الشامل',
            icon: <FileText className="w-4 h-4" />,
            shortcut: 'Alt + R',
            accentColor: 'emerald',
            isPrimary: true,
            onClick: triggerDailyReport
          },
          {
            id: 'approval_queue',
            label: 'قائمة الموافقات الأمنية',
            icon: <ShieldCheck className="w-4 h-4" />,
            accentColor: 'purple',
            isPrimary: true,
            onClick: triggerApprovalQueue
          }
        ];

      case 'home':
      default:
        return [
          {
            id: 'walkin_patient',
            label: 'مريض جديد (كشف زائر)',
            subLabel: 'تسجيل مريض جديد وتأكيد حضوره بالعيادة',
            icon: <UserPlus className="w-4 h-4" />,
            shortcut: 'Alt + N',
            accentColor: 'indigo',
            isPrimary: true,
            onClick: triggerNewPatient
          },
          {
            id: 'smart_schedule',
            label: 'موعد جديد (حجز ذكي)',
            subLabel: 'جدول كشف أو متابعة في أوقات المواعيد',
            icon: <Calendar className="w-4 h-4" />,
            shortcut: 'Alt + A',
            accentColor: 'amber',
            isPrimary: true,
            onClick: triggerNewAppointment
          },
          {
            id: 'ocr_invoice',
            label: 'مسح فاتورة خامات (OCR)',
            subLabel: 'مسح وتفنيط فواتير التوريد بالذكاء الاصطناعي',
            icon: <Receipt className="w-4 h-4" />,
            shortcut: 'Alt + E',
            accentColor: 'rose',
            isPrimary: true,
            onClick: triggerInvoiceOcr
          },
          {
            id: 'daily_report',
            label: 'ملخص الحسابات اليومي',
            subLabel: 'كشف الإيرادات والزيارات لليوم',
            icon: <FileText className="w-4 h-4" />,
            shortcut: 'Alt + R',
            accentColor: 'emerald',
            isPrimary: true,
            onClick: triggerDailyReport
          },
          // Secondary
          {
            id: 'lab_order',
            label: 'طلب معمل تركيبات',
            subLabel: 'متابعة وإضافة طلب تركيبة أسنان',
            icon: <Microscope className="w-4 h-4" />,
            badge: pendingLabsCount > 0 ? pendingLabsCount : undefined,
            accentColor: 'purple',
            isPrimary: false,
            onClick: triggerAddLabCase
          },
          {
            id: 'approval_queue',
            label: 'قائمة الموافقات الأمنية',
            subLabel: 'تأكيد طلبات الحذف والتعديلات',
            icon: <ShieldCheck className="w-4 h-4" />,
            accentColor: 'sky',
            isPrimary: false,
            onClick: triggerApprovalQueue
          },
          {
            id: 'endo_helper',
            label: 'مساعد حشو الجذور (Endo)',
            subLabel: 'حساب أقنية الجذور بدقة العيادة',
            icon: <Sparkles className="w-4 h-4" />,
            accentColor: 'teal',
            isPrimary: false,
            onClick: triggerEndoHelper
          }
        ];
    }
  }, [
    activeView, appointments, labCases, onOpenWalkIn, onOpenScheduleModal, 
    onOpenInvoiceModal, onOpenDailyReport, onOpenEndoHelper, onOpenApprovalQueue, 
    onTriggerAddExpense, onTriggerAddLabCase, onTriggerAddPatient, onNavigate
  ]);

  // Separate primary visible actions vs secondary items in "More"
  const primaryActions = useMemo(() => actionItems.filter(item => item.isPrimary), [actionItems]);
  const secondaryActions = useMemo(() => actionItems.filter(item => !item.isPrimary), [actionItems]);

  // Color theme generator for action capsule buttons
  const getCapsuleStyles = (color: ActionItem['accentColor']) => {
    switch (color) {
      case 'indigo':
        return 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs border-indigo-500/30';
      case 'amber':
        return 'bg-amber-600 hover:bg-amber-700 text-white shadow-xs border-amber-500/30';
      case 'emerald':
        return 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs border-emerald-500/30';
      case 'purple':
        return 'bg-purple-600 hover:bg-purple-700 text-white shadow-xs border-purple-500/30';
      case 'rose':
        return 'bg-rose-600 hover:bg-rose-700 text-white shadow-xs border-rose-500/30';
      case 'sky':
        return 'bg-sky-600 hover:bg-sky-700 text-white shadow-xs border-sky-500/30';
      case 'teal':
        return 'bg-teal-600 hover:bg-teal-700 text-white shadow-xs border-teal-500/30';
      default:
        return 'bg-slate-800 hover:bg-slate-900 text-white shadow-xs border-slate-700';
    }
  };

  const getItemIconBg = (color: ActionItem['accentColor']) => {
    switch (color) {
      case 'indigo': return 'bg-indigo-100 text-indigo-700';
      case 'amber': return 'bg-amber-100 text-amber-800';
      case 'emerald': return 'bg-emerald-100 text-emerald-800';
      case 'purple': return 'bg-purple-100 text-purple-800';
      case 'rose': return 'bg-rose-100 text-rose-800';
      case 'sky': return 'bg-sky-100 text-sky-800';
      case 'teal': return 'bg-teal-100 text-teal-800';
      default: return 'bg-slate-100 text-slate-800';
    }
  };

  return (
    <nav 
      aria-label="شريط الإجراءات السريعة" 
      className="w-full font-['Cairo',sans-serif] dir-rtl select-none"
    >
      {/* 
        =========================================================
        1. DESKTOP & TABLET ACTION BAR (Visible ONLY on ≥ 768px)
        Placed directly at top below HeaderNavbar
        =========================================================
      */}
      <div className="hidden md:block sticky top-14 sm:top-16 z-20 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 border-b border-indigo-900/40 text-white shadow-sm transition-all duration-300">
        <div className="max-w-[1800px] mx-auto px-4 sm:px-6 py-2.5 flex items-center justify-between gap-3">
          
          {/* Right Section: Bar Title & Context Badge */}
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-amber-400 to-amber-500 text-slate-950 font-black flex items-center justify-center shadow-md animate-pulse">
              <Zap className="w-4.5 h-4.5 fill-slate-950" />
            </div>
            
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <span className="text-xs font-black text-white font-tajawal tracking-wide">
                  الإجراءات السريعة
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-500/30 text-indigo-200 border border-indigo-400/30 font-mono">
                  {activeView.toUpperCase()}
                </span>
              </div>
              <span className="text-[10px] text-slate-300 font-medium hidden lg:inline">
                الوصول الفوري للعمليات بدون تحريك الماوس لمسافات طويلة
              </span>
            </div>
          </div>

          {/* Center / Left Section: Dynamic Primary Action Buttons */}
          <div className="flex items-center gap-2 flex-wrap justify-end">
            
            {/* Tablet shows first 2-3 actions, Desktop shows 4-5 actions */}
            {primaryActions.map((action, index) => {
              // Hide 4th+ items on tablet (768px-1024px), show all on desktop (>=1024px)
              const isTabletHidden = index >= 2 ? 'hidden lg:flex' : 'flex';

              return (
                <button
                  key={action.id}
                  type="button"
                  onClick={action.onClick}
                  className={`${isTabletHidden} items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-extrabold font-tajawal transition-all duration-150 cursor-pointer active:scale-95 border ${getCapsuleStyles(action.accentColor)} group relative`}
                  title={action.shortcut ? `اختصار: ${action.shortcut}` : action.label}
                >
                  <span className="shrink-0">{action.icon}</span>
                  <span className="whitespace-nowrap">{action.label}</span>
                  
                  {action.badge !== undefined && (
                    <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold bg-white text-slate-900">
                      {action.badge}
                    </span>
                  )}

                  {/* Hotkey tag pill */}
                  {action.shortcut && (
                    <span className="hidden xl:inline-block text-[9px] font-mono px-1.5 py-0.5 rounded bg-black/30 text-amber-200 border border-white/20">
                      {action.shortcut}
                    </span>
                  )}
                </button>
              );
            })}

            {/* "⚡ المزيد" (More Actions Popover) */}
            <div className="relative" ref={moreMenuRef}>
              <button
                type="button"
                onClick={() => setIsMoreMenuOpen(prev => !prev)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black font-tajawal transition-all cursor-pointer border active:scale-95 ${
                  isMoreMenuOpen
                    ? 'bg-amber-400 text-slate-950 border-amber-300 shadow-md'
                    : 'bg-white/10 hover:bg-white/20 text-white border-white/20'
                }`}
                aria-expanded={isMoreMenuOpen}
                aria-label="عرض المزيد من الإجراءات السريعة"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                <span>المزيد من الإجراءات</span>
                {secondaryActions.length > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-amber-400 text-slate-950 font-mono">
                    +{secondaryActions.length}
                  </span>
                )}
                <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${isMoreMenuOpen ? 'rotate-180' : ''}`} />
              </button>

              {/* Desktop Popover Menu */}
              {isMoreMenuOpen && (
                <div 
                  className="absolute left-0 mt-2 w-72 sm:w-80 bg-white text-slate-900 rounded-2xl shadow-2xl border border-slate-200 p-2 z-50 animate-fadeIn font-tajawal text-xs space-y-1"
                  role="menu"
                >
                  <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between text-slate-500 font-bold text-[11px]">
                    <span>عمليات إضافية متوفرة</span>
                    <span className="font-mono text-[10px] bg-slate-100 px-2 py-0.5 rounded-md">Esc للإغلاق</span>
                  </div>

                  <div className="max-h-80 overflow-y-auto space-y-1 p-1">
                    {/* Render extra items + hidden tablet items if tablet */}
                    {actionItems.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          setIsMoreMenuOpen(false);
                          item.onClick();
                        }}
                        className="w-full p-2.5 rounded-xl hover:bg-indigo-50/70 text-right flex items-center justify-between transition-colors cursor-pointer group border border-transparent hover:border-indigo-100"
                        role="menuitem"
                      >
                        <div className="flex items-center gap-2.5">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold shrink-0 ${getItemIconBg(item.accentColor)}`}>
                            {item.icon}
                          </div>
                          <div>
                            <span className="font-bold text-slate-900 block group-hover:text-indigo-700">
                              {item.label}
                            </span>
                            {item.subLabel && (
                              <span className="text-[10px] text-slate-500 font-medium block">
                                {item.subLabel}
                              </span>
                            )}
                          </div>
                        </div>

                        {item.shortcut && (
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 font-bold">
                            {item.shortcut}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>

                  {/* Shortcuts Legend link at bottom of popover */}
                  <div className="pt-1 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => {
                        setIsMoreMenuOpen(false);
                        setShowShortcutsModal(true);
                      }}
                      className="w-full py-2 bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold text-[11px] rounded-xl text-center flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Keyboard className="w-3.5 h-3.5 text-indigo-600" />
                      <span>عرض جميع اختصارات الكيبورد (أسرع للعمل)</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Keyboard Shortcuts Trigger Button */}
            <button
              type="button"
              onClick={() => setShowShortcutsModal(true)}
              className="hidden xl:flex items-center justify-center w-8 h-8 rounded-xl bg-white/10 hover:bg-white/20 text-white border border-white/20 transition-all cursor-pointer active:scale-95"
              title="اختصارات لوحة المفاتيح (?)"
            >
              <Keyboard className="w-4 h-4 text-amber-300" />
            </button>

          </div>
        </div>
      </div>

      {/* 
        =========================================================
        2. MOBILE FLOATING ACTION BUTTON & BOTTOM SHEET (ONLY < 768px)
        Preserves perfect thumb placement on mobile screens
        =========================================================
      */}
      <div className="md:hidden">
        {/* Floating Action Button (FAB) at bottom-right, well spaced above MobileBottomNav */}
        <button
          type="button"
          onClick={() => setIsMobileSheetOpen(true)}
          className="fixed bottom-20 left-4 z-40 w-13 h-13 rounded-2xl bg-gradient-to-tr from-slate-900 via-indigo-950 to-indigo-900 text-white shadow-2xl border-2 border-indigo-400/40 flex items-center justify-center transition-all duration-200 active:scale-90 touch-manipulation cursor-pointer group"
          aria-label="فتح الإجراءات السريعة"
          title="إجراءات سريعة"
        >
          <div className="relative">
            <Zap className="w-6 h-6 text-amber-400 fill-amber-400 animate-pulse" />
            <span className="absolute -top-1 -right-1 flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500"></span>
            </span>
          </div>
        </button>

        {/* Mobile Bottom Sheet Modal Overlay */}
        {isMobileSheetOpen && (
          <div 
            className="clinic-modal-overlay fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-end justify-center animate-fadeIn dir-rtl"
            onClick={() => setIsMobileSheetOpen(false)}
          >
            <div 
              className="clinic-modal-panel w-full max-w-lg bg-white rounded-t-3xl p-5 shadow-2xl border-t border-slate-200 animate-slideUp font-tajawal space-y-4 max-h-[85dvh] overflow-y-auto"
              onClick={e => e.stopPropagation()}
            >
              {/* Sheet Drag Handle & Title */}
              <div className="space-y-3">
                <div className="w-12 h-1.5 bg-slate-300 rounded-full mx-auto" />
                <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center font-black">
                      <Zap className="w-5 h-5 text-amber-600 fill-amber-600" />
                    </div>
                    <div>
                      <h3 className="text-sm font-black text-slate-900">الإجراءات والعمليات السريعة</h3>
                      <p className="text-[11px] text-slate-500 font-medium">اختر العملية المطلوبة للبدء بلمسة واحدة</p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setIsMobileSheetOpen(false)}
                    className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition-colors cursor-pointer touch-manipulation min-h-[44px]"
                    title="إلغاء وإغلاق"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Action List Items */}
              <div className="space-y-2">
                {actionItems.map(item => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setIsMobileSheetOpen(false);
                      item.onClick();
                    }}
                    className="w-full p-3 bg-slate-50 hover:bg-indigo-50/70 active:bg-indigo-100/70 border border-slate-200/90 rounded-2xl flex items-center justify-between text-right transition-all cursor-pointer touch-manipulation min-h-[52px]"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 font-bold ${getItemIconBg(item.accentColor)}`}>
                        {item.icon}
                      </div>
                      <div>
                        <span className="text-xs font-black text-slate-900 block font-tajawal">
                          {item.label}
                        </span>
                        {item.subLabel && (
                          <span className="text-[11px] text-slate-500 font-medium block">
                            {item.subLabel}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {item.badge !== undefined && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-100 text-amber-900 border border-amber-300">
                          {item.badge}
                        </span>
                      )}
                      <ChevronLeft className="w-4.5 h-4.5 text-slate-400" />
                    </div>
                  </button>
                ))}
              </div>

              {/* Close Touch Button */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setIsMobileSheetOpen(false)}
                  className="w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-800 font-black text-xs rounded-2xl transition-colors cursor-pointer text-center font-tajawal touch-manipulation min-h-[48px]"
                >
                  إلغاء وإغلاق
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 
        =========================================================
        3. KEYBOARD SHORTCUTS MODAL
        Provides a fast cheat-sheet for clinic power users
        =========================================================
      */}
      {showShortcutsModal && (
        <div 
          className="clinic-modal-overlay fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn dir-rtl"
          onClick={() => setShowShortcutsModal(false)}
        >
          <div 
            className="clinic-modal-panel w-full max-w-md bg-white rounded-3xl p-6 shadow-2xl border border-slate-200 space-y-4 font-tajawal max-h-[90dvh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold">
                  <Keyboard className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900">اختصارات لوحة المفاتيح</h3>
                  <p className="text-[11px] text-slate-500 font-medium">اختصارات سريعة لإجراء المهام بدون استخدام الماوس</p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowShortcutsModal(false)}
                className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2 text-xs">
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
                <span className="font-bold text-slate-800">مريض جديد (كشف زائر)</span>
                <span className="font-mono bg-white px-2.5 py-1 rounded-lg border text-indigo-700 font-black">Alt + N</span>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
                <span className="font-bold text-slate-800">حجز موعد جديد</span>
                <span className="font-mono bg-white px-2.5 py-1 rounded-lg border text-amber-700 font-black">Alt + A</span>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
                <span className="font-bold text-slate-800">مسح فاتورة خامات / مصروف</span>
                <span className="font-mono bg-white px-2.5 py-1 rounded-lg border text-rose-700 font-black">Alt + E</span>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
                <span className="font-bold text-slate-800">تقرير الحسابات والزيارات</span>
                <span className="font-mono bg-white px-2.5 py-1 rounded-lg border text-emerald-700 font-black">Alt + R</span>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
                <span className="font-bold text-slate-800">البحث الشامل في العيادة</span>
                <span className="font-mono bg-white px-2.5 py-1 rounded-lg border text-sky-700 font-black">Ctrl + K</span>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
                <span className="font-bold text-slate-800">تفعيل / إخفاء وضع الخصوصية</span>
                <span className="font-mono bg-white px-2.5 py-1 rounded-lg border text-purple-700 font-black">Ctrl + P</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowShortcutsModal(false)}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl transition-colors cursor-pointer text-center"
            >
              فهمت، إغلاق
            </button>
          </div>
        </div>
      )}
    </nav>
  );
});

QuickActions.displayName = 'QuickActions';
