import React, { useState, useMemo, useRef } from 'react';
import { ArrowRight, Banknote, TrendingUp, Plus, Trash2, Receipt, Edit3, Pin, Camera, Image as ImageIcon, Eye, X, FileText, Search, Sparkles, Building2, BarChart2, Users, Zap, Droplets, Package } from 'lucide-react';
import { Patient, LabCase, Expense, MaterialUsage } from '../../types';
import { useToastAndConfirm } from '../common/ToastAndConfirm';
import { BalanceProgressMeter } from '../common/FinancialBadge';
import { InvoiceOcrModal } from './InvoiceOcrModal';
import { ExpenseDetailModal } from './ExpenseDetailModal';
import { SupplierAnalyticsView } from './SupplierAnalyticsView';
import { getPatientFinancialSummary } from '../../utils/financials';
import { expenseBreakdown, expensesForMonth, getExpensePaymentSummary, inferExpenseType, mergeExpenseUpdate } from '../../utils/expenseUtils';
import './SummaryView.css';

type SummaryTab = 'overview' | 'expenses' | 'analytics';

const SummaryMetric: React.FC<{
  title: string; value: string; note: string; icon: React.ReactNode; tone: 'green' | 'rose' | 'amber' | 'indigo';
}> = ({ title, value, note, icon, tone }) => <article className={'summary-metric summary-metric--' + tone}>
  <div className="summary-metric-heading"><span className="summary-metric-icon" aria-hidden="true">{icon}</span><h3>{title}</h3></div>
  <p className="summary-metric-value"><bdi dir="ltr">{value}</bdi></p>
  <p className="summary-metric-note">{note}</p>
</article>;

interface SummaryViewProps {
  patients: Patient[];
  labCases: LabCase[];
  expenses: Expense[];
  materialUsages: MaterialUsage[];
  isPrivacyMode?: boolean;
  capabilities?: { viewExpenses?: boolean; viewProfits?: boolean; financialReports?: boolean };
  isOpenAddExpenseModal?: boolean;
  onCloseAddExpenseModal?: () => void;
  onAddExpense: (expense: Omit<Expense, 'id'>) => void;
  onSaveExpense?: (expense: Omit<Expense, 'id'> & { id?: string }) => void;
  onDeleteExpense: (id: string) => void;
  onAddMaterialUsage: (usage: Omit<MaterialUsage, 'id'>) => void;
  onDeleteMaterialUsage: (id: string) => void;
  onBackToHome: () => void;
}

const localDateKey = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};

export const SummaryView: React.FC<SummaryViewProps> = React.memo(({
  patients,
  labCases,
  expenses,
  materialUsages,
  isPrivacyMode = false,
  capabilities,
  isOpenAddExpenseModal = false,
  onCloseAddExpenseModal,
  onAddExpense,
  onSaveExpense,
  onDeleteExpense,
  onAddMaterialUsage,
  onDeleteMaterialUsage,
  onBackToHome
}) => {
  const { showToast, askConfirm } = useToastAndConfirm();
  const canViewExpenses = capabilities?.viewExpenses !== false;
  const canViewProfits = capabilities?.viewProfits !== false;
  const canViewReports = capabilities?.financialReports !== false;
  const canViewAnalytics = canViewExpenses && canViewReports;

  const [activeTab, setActiveTab] = useState<SummaryTab>('overview');
  const switcherAnchorRef = useRef<HTMLDivElement>(null);
  const switcherRef = useRef<HTMLDivElement>(null);
  const sectionContentRef = useRef<HTMLDivElement>(null);
  const shouldScrollToSection = useRef(false);
  const [switcherLayout, setSwitcherLayout] = useState({ pinned: false, left: 0, width: 0, height: 0 });
  const sections = [
    { key: 'overview' as SummaryTab, label: 'الملخص المالي', icon: BarChart2, visible: true },
    { key: 'expenses' as SummaryTab, label: 'المصروفات', icon: Receipt, visible: canViewExpenses },
    { key: 'analytics' as SummaryTab, label: 'الخامات والموردون', icon: Package, visible: canViewAnalytics },
  ].filter(section => section.visible);

  const switchSection = (section: SummaryTab) => {
    if ((section === 'expenses' && !canViewExpenses) || (section === 'analytics' && !canViewAnalytics)) return;
    shouldScrollToSection.current = true;
    setActiveTab(section);
    if (section === activeTab) scrollToSection();
  };

  const scrollToSection = () => {
    const content = sectionContentRef.current;
    if (!content) return;
    shouldScrollToSection.current = false;
    const barHeight = switcherRef.current?.getBoundingClientRect().height || 64;
    window.scrollTo({ top: Math.max(0, window.scrollY + content.getBoundingClientRect().top - barHeight - 28),
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };

  React.useEffect(() => {
    if (!shouldScrollToSection.current) return;
    const frame = requestAnimationFrame(scrollToSection);
    return () => cancelAnimationFrame(frame);
  }, [activeTab]);

  React.useEffect(() => {
    let frame = 0;
    const measure = () => {
      const anchor = switcherAnchorRef.current;
      const bar = switcherRef.current;
      if (!anchor || !bar) return;
      const bounds = anchor.getBoundingClientRect();
      const next = { pinned: bounds.top < 12, left: bounds.left, width: bounds.width, height: bar.getBoundingClientRect().height };
      setSwitcherLayout(previous => previous.pinned === next.pinned && Math.abs(previous.left - next.left) < .5
        && Math.abs(previous.width - next.width) < .5 && Math.abs(previous.height - next.height) < .5 ? previous : next);
    };
    const scheduleMeasure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(scheduleMeasure);
    if (switcherAnchorRef.current) observer.observe(switcherAnchorRef.current);
    if (switcherRef.current) observer.observe(switcherRef.current);
    document.addEventListener('scroll', scheduleMeasure, true);
    window.addEventListener('resize', scheduleMeasure);
    scheduleMeasure();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener('scroll', scheduleMeasure, true);
      window.removeEventListener('resize', scheduleMeasure);
    };
  }, []);
  const [expenseSearchQuery, setExpenseSearchQuery] = useState('');

  // ERP Modals State
  const [isOcrModalOpen, setIsOcrModalOpen] = useState(false);
  const [viewingExpenseDetail, setViewingExpenseDetail] = useState<Expense | null>(null);

  // Expense Form State
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [expenseTitle, setExpenseTitle] = useState('');
  const [expenseCategory, setExpenseCategory] = useState<'supplies' | 'fixed' | 'maintenance' | 'other'>('supplies');
  const [expenseAmount, setExpenseAmount] = useState<number | ''>('');
  const [expenseDate, setExpenseDate] = useState<string>(localDateKey());
  const [expenseNote, setExpenseNote] = useState('');
  const [isFixedExpense, setIsFixedExpense] = useState(false);
  const [expenseInvoiceImage, setExpenseInvoiceImage] = useState<string | undefined>(undefined);
  const [expenseFilterCategory, setExpenseFilterCategory] = useState<'all' | 'fixed' | 'supplies' | 'maintenance'>('all');
  const currentMonth = localDateKey().slice(0, 7);
  const [expenseMonth, setExpenseMonth] = useState<string | 'all'>(currentMonth);
  const [expenseType, setExpenseType] = useState<NonNullable<Expense['expenseType']>>('supplies');
  const monthExpenses = useMemo(() => expensesForMonth(expenses, expenseMonth), [expenses, expenseMonth]);
  const monthlyBreakdown = useMemo(() => expenseBreakdown(monthExpenses), [monthExpenses]);
  const monthlyTotal = monthExpenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const monthlyPaid = monthExpenses.reduce((sum, expense) => sum + getExpensePaymentSummary(expense).paid, 0);
  const monthlyRemaining = monthExpenses.reduce((sum, expense) => sum + getExpensePaymentSummary(expense).remaining, 0);
  const isInvoiceTotalLocked = !!editingExpense && (Boolean(editingExpense.items?.length)
    || editingExpense.subtotal !== undefined || editingExpense.tax !== undefined || editingExpense.discount !== undefined
    || editingExpense.paidAmount !== undefined || editingExpense.remainingAmount !== undefined
    || editingExpense.paymentMethod === 'credit' || editingExpense.paymentMethod === 'deferred');
  const filteredExpenses = useMemo(() => monthExpenses.filter(expense => {
    if (expenseFilterCategory === 'fixed' && !(expense.isFixed || expense.category === 'fixed')) return false;
    if (expenseFilterCategory === 'supplies' && expense.category !== 'supplies') return false;
    if (expenseFilterCategory === 'maintenance' && expense.category !== 'maintenance' && expense.category !== 'other') return false;
    const query = expenseSearchQuery.trim().toLocaleLowerCase('ar');
    if (!query) return true;
    return [expense.title, expense.supplierName, expense.taxNumber, expense.invoiceNumber, expense.note,
      ...(expense.items || []).map(item => item.itemName)].some(value => value?.toLocaleLowerCase('ar').includes(query));
  }).sort((first, second) => (second.invoiceDate || second.date).localeCompare(first.invoiceDate || first.date)),
  [monthExpenses, expenseFilterCategory, expenseSearchQuery]);

  // Lightbox Image Viewer State
  const [activeInvoiceLightbox, setActiveInvoiceLightbox] = useState<{ title: string; imageUrl: string; amount: number; date: string } | null>(null);

  React.useEffect(() => {
    if ((activeTab === 'expenses' && !canViewExpenses) || (activeTab === 'analytics' && !canViewAnalytics)) setActiveTab('overview');
    if (!canViewExpenses) {
      setIsExpenseModalOpen(false);
      setIsOcrModalOpen(false);
      setViewingExpenseDetail(null);
      setActiveInvoiceLightbox(null);
    }
  }, [activeTab, canViewExpenses, canViewAnalytics]);

  // Close Expense Modal Handler
  const handleCloseExpenseModal = () => {
    setIsExpenseModalOpen(false);
    if (onCloseAddExpenseModal) {
      onCloseAddExpenseModal();
    }
  };

  // Open modal if external trigger opens add expense
  React.useEffect(() => {
    if (isOpenAddExpenseModal && !canViewExpenses) {
      onCloseAddExpenseModal?.();
      return;
    }
    if (isOpenAddExpenseModal && canViewExpenses) {
      setActiveTab('expenses');
      setEditingExpense(null);
      setExpenseTitle('');
      setExpenseCategory('supplies');
      setExpenseType('supplies');
      setExpenseAmount('');
      setExpenseDate(localDateKey());
      setExpenseNote('');
      setIsFixedExpense(false);
      setExpenseInvoiceImage(undefined);
      setIsExpenseModalOpen(true);
    }
  }, [isOpenAddExpenseModal, canViewExpenses]);

  React.useEffect(() => {
    const isAnyOpen = isExpenseModalOpen || Boolean(activeInvoiceLightbox);
    if (isAnyOpen) {
      document.body.classList.add('modal-open');
    } else {
      document.body.classList.remove('modal-open');
    }
    return () => {
      document.body.classList.remove('modal-open');
    };
  }, [isExpenseModalOpen, activeInvoiceLightbox]);

  // Aggregate Financial Metrics
  const { totalRequired, totalPaid, totalRemain, totalLabCosts, totalLabPaid, totalLabRemaining,
    totalExpensesAmount, totalExpensesPaid, totalExpenseRemaining, cashBalance } = useMemo(() => {
    let req = 0;
    let paid = 0;
    let rem = 0;

    patients.forEach(p => {
      const financial = getPatientFinancialSummary(p);
      req += Math.max(0, financial.totalRequired - financial.totalDiscounts);
      paid += financial.totalCollected;
      rem += financial.totalRemaining;
    });

    const safeAmount = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;
    const labCosts = labCases.reduce((acc, c) => acc + safeAmount(c.labTotal), 0);
    const labPaid = labCases.reduce((acc, c) => acc + safeAmount(c.labPaid), 0);
    const labRemaining = labCases.reduce((acc, c) => acc + Math.max(0, safeAmount(c.labTotal) - safeAmount(c.labPaid)), 0);
    const expensePayments = expenses.map(getExpensePaymentSummary);
    const expAmt = expensePayments.reduce((acc, e) => acc + e.total, 0);
    const expPaid = expensePayments.reduce((acc, e) => acc + e.paid, 0);
    const expRemaining = expensePayments.reduce((acc, e) => acc + e.remaining, 0);

    return {
      totalRequired: req,
      totalPaid: paid,
      totalRemain: rem,
      totalLabCosts: labCosts,
      totalLabPaid: labPaid,
      totalLabRemaining: labRemaining,
      totalExpensesAmount: expAmt,
      totalExpensesPaid: expPaid,
      totalExpenseRemaining: expRemaining,
      cashBalance: paid - labPaid - expPaid
    };
  }, [patients, labCases, expenses]);

  const maskMoney = (amt: number) => {
    if (isPrivacyMode) return '*** ج.م';
    return `${amt.toLocaleString()} ج.م`;
  };

  const handleInvoiceFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canViewExpenses) return;
    const file = e.target.files?.[0];
    if (file) {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
        showToast('اختر صورة بصيغة JPG أو PNG أو WEBP', 'warning');
        e.target.value = '';
        return;
      }
      if (file.size > 8 * 1024 * 1024) {
        showToast('حجم صورة الفاتورة كبير جداً، يرجى اختيار صورة أقل من 8 ميجابايت', 'warning');
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setExpenseInvoiceImage(reader.result as string);
        showToast('تم إرفاق صورة الفاتورة بنجاح 📷', 'success');
      };
      reader.onerror = () => showToast('تعذر قراءة الصورة، حاول اختيارها مرة أخرى', 'error');
      reader.readAsDataURL(file);
    }
  };

  const handleOpenAddExpense = (presetTitle?: string, presetCat?: 'fixed' | 'supplies' | 'maintenance' | 'other', presetType?: NonNullable<Expense['expenseType']>) => {
    if (!canViewExpenses) return;
    setEditingExpense(null);
    setExpenseTitle(presetTitle || '');
    setExpenseCategory(presetCat || 'supplies');
    setExpenseType(presetType || (presetCat === 'maintenance' ? 'maintenance' : presetCat === 'supplies' || !presetCat ? 'supplies' : 'other'));
    setExpenseAmount('');
    setExpenseDate(localDateKey());
    setExpenseNote('');
    setIsFixedExpense(presetCat === 'fixed' || (presetTitle && !presetTitle.includes('خامات')) ? true : false);
    setExpenseInvoiceImage(undefined);
    setIsExpenseModalOpen(true);
  };

  const handleOpenEditExpense = (exp: Expense) => {
    if (!canViewExpenses) return;
    setEditingExpense(exp);
    setExpenseTitle(exp.title);
    setExpenseCategory(exp.category);
    setExpenseType(inferExpenseType(exp));
    setExpenseAmount(exp.amount);
    setExpenseDate(exp.invoiceDate || exp.date);
    setExpenseNote(exp.note || '');
    setIsFixedExpense(exp.isFixed ?? (exp.category === 'fixed'));
    setExpenseInvoiceImage(exp.invoiceImageUrl);
    setIsExpenseModalOpen(true);
  };

  const handleSaveExpenseForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canViewExpenses) return;
    if (!expenseTitle.trim()) {
      showToast('يرجى كتابة بيان / عنوان المصروف', 'warning');
      return;
    }

    const amt = typeof expenseAmount === 'number' ? expenseAmount : 0;
    if (!Number.isFinite(amt) || amt <= 0) {
      showToast('يرجى كتابة قيمة مصروف صحيحة أكبر من الصفر', 'warning');
      return;
    }
    if (!expenseDate) {
      showToast('يرجى تحديد تاريخ المصروف', 'warning');
      return;
    }
    if (isInvoiceTotalLocked && editingExpense && amt !== editingExpense.amount) {
      showToast('إجمالي هذه الفاتورة مرتبط بالأصناف والمدفوعات، ولا يمكن تغييره من نموذج البيانات الأساسية', 'warning');
      return;
    }
    if (editingExpense && !onSaveExpense) {
      showToast('تعديل المصروف غير متاح الآن', 'warning');
      return;
    }

    const payload = {
      id: editingExpense ? editingExpense.id : undefined,
      title: expenseTitle.trim(),
      category: expenseCategory,
      expenseType,
      amount: amt,
      date: expenseDate,
      note: expenseNote.trim(),
      isFixed: isFixedExpense,
      recurringPeriod: isFixedExpense ? 'monthly' as const : 'none' as const,
      invoiceImageUrl: expenseInvoiceImage
    };
    const savedPayload = editingExpense
      ? mergeExpenseUpdate(editingExpense, { ...payload, ...(editingExpense.invoiceDate ? { invoiceDate: expenseDate } : {}) })
      : payload;

    if (onSaveExpense) {
      onSaveExpense(savedPayload);
    } else {
      onAddExpense(savedPayload);
    }

    handleCloseExpenseModal();
    showToast(editingExpense ? 'تم تعديل بيانات المصروف بنجاح' : 'تم تسجيل المصروف وإرفاق الفاتورة بنجاح', 'success');
  };

  const handleDeleteExpenseConfirmed = (exp: Expense) => {
    if (!canViewExpenses) return;
    askConfirm({
      title: 'حذف مصروف',
      message: `هل أنت متأكد من حذف المصروف (${exp.title}) بقيمة ${exp.amount} ج.م؟`,
      confirmLabel: 'تأكيد الحذف',
      tone: 'danger',
      onConfirm: () => {
        onDeleteExpense(exp.id);
        showToast('تم حذف المصروف بنجاح', 'info');
      }
    });
  };

  const getCategoryLabel = (cat: string) => {
    switch (cat) {
      case 'supplies': return 'خامات ومستلزمات';
      case 'fixed': return 'مصروفات ثابتة';
      case 'maintenance': return 'صيانة وتشغيل العيادة';
      case 'other': return 'مصروفات أخرى';
      default: return cat;
    }
  };

  return (
    <div className="summary-workspace max-w-7xl mx-auto py-2" dir="rtl">
      {/* View Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <div className="flex items-center gap-3">
          <button
            onClick={onBackToHome}
            className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer"
            title="رجوع للشاشة الرئيسية"
          >
            <ArrowRight className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-slate-900 font-tajawal tracking-tight">
              الملخص المالي والمصروفات
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              المقبوضات والمدفوعات الفعلية، مع متابعة المستحقات غير المسددة
            </p>
          </div>
        </div>

      </div>

      <div ref={switcherAnchorRef} className="summary-switcher-anchor" style={{ height: switcherLayout.height || undefined }}>
        <div ref={switcherRef} role="tablist" aria-label="أقسام الماليات"
          className={'summary-section-switcher' + (switcherLayout.pinned ? ' summary-section-switcher--pinned' : '')}
          style={switcherLayout.pinned ? { left: switcherLayout.left, width: switcherLayout.width } : undefined}>
          {sections.map(section => <button key={section.key} type="button" id={'finance-tab-' + section.key} role="tab"
            aria-selected={activeTab === section.key} aria-controls="finance-section-content" tabIndex={activeTab === section.key ? 0 : -1}
            onClick={() => switchSection(section.key)} onKeyDown={event => {
              const index = sections.findIndex(item => item.key === section.key);
              const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? sections.length - 1
                : event.key === 'ArrowLeft' ? (index + 1) % sections.length
                : event.key === 'ArrowRight' ? (index - 1 + sections.length) % sections.length : -1;
              if (nextIndex < 0) return;
              event.preventDefault();
              const next = sections[nextIndex].key;
              switchSection(next);
              requestAnimationFrame(() => document.getElementById('finance-tab-' + next)?.focus({ preventScroll: true }));
            }}><section.icon aria-hidden="true" /><span>{section.label}</span></button>)}
        </div>
      </div>

      <div ref={sectionContentRef} id="finance-section-content" role="tabpanel" aria-labelledby={'finance-tab-' + activeTab}
        className="summary-section-content" tabIndex={0}>

      {activeTab === 'overview' && canViewReports && (
        <div className="summary-overview">
          <div className="summary-overview-heading"><h2>الملخص المالي</h2><span>إجمالي السجلات المسجلة</span></div>
          <div className="summary-metrics">
            <SummaryMetric title="المحصّل من المرضى" value={maskMoney(totalPaid)} icon={<Banknote />} tone="green"
              note={`مستحقات لم تُحصّل: ${maskMoney(totalRemain)}`} />
            {canViewProfits && <SummaryMetric title="المدفوع للمعامل" value={maskMoney(totalLabPaid)} icon={<Receipt />} tone="rose"
              note={`إجمالي تكلفة الحالات: ${maskMoney(totalLabCosts)}`} />}
            {canViewExpenses && <SummaryMetric title="مدفوعات المصروفات" value={maskMoney(totalExpensesPaid)} icon={<Banknote />} tone="amber"
              note={`إجمالي قيمة الفواتير: ${maskMoney(totalExpensesAmount)}`} />}
            {canViewProfits && canViewExpenses && <SummaryMetric title="الرصيد النقدي المسجل" value={maskMoney(cashBalance)} icon={<TrendingUp />} tone="indigo"
              note="المقبوضات بعد مدفوعات المعامل والمصروفات، دون رصيد افتتاحي" />}
          </div>

          {canViewProfits && <div className="summary-liabilities">
            <div><strong>التزامات لم تُسدد</strong><span>المبالغ المستحقة للمعامل{canViewExpenses && ' والموردين'}</span></div>
            <bdi>{maskMoney(totalLabRemaining + (canViewExpenses ? totalExpenseRemaining : 0))}</bdi>
            <p>للمعامل: {maskMoney(totalLabRemaining)}{canViewExpenses && <> · للموردين والمصروفات: {maskMoney(totalExpenseRemaining)}</>}</p>
          </div>}

          {/* Patient Debtors List */}
          <div className="summary-debtors bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-4">
            <h2 className="text-base font-bold text-slate-900 font-tajawal flex flex-wrap gap-2 items-center justify-between">
              <span>مستحقات المرضى غير المحصلة</span>
              <span className="text-xs font-mono font-normal text-slate-500">
                إجمالي المتبقي: {maskMoney(totalRemain)}
              </span>
            </h2>

            <div className="divide-y divide-slate-100 border border-slate-200 rounded-2xl overflow-hidden">
              {patients
                .map(p => {
                  const financial = getPatientFinancialSummary(p);
                  return { ...p, req: Math.max(0, financial.totalRequired - financial.totalDiscounts), pd: financial.totalCollected, rem: financial.totalRemaining };
                })
                .filter(p => p.rem > 0)
                .sort((a, b) => b.rem - a.rem)
                .map(p => (
                  <div key={p.id} className="p-4 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900 text-sm">{p.name}</span>
                        <span className="font-mono text-slate-400">#{p.id}</span>
                      </div>
                      <span className="text-slate-500 block text-[11px]">موبايل: {p.mobile || '—'}</span>
                    </div>

                    <div className="w-full sm:w-72">
                      {isPrivacyMode ? <span className="text-slate-400 text-xs">التفاصيل المالية مخفية</span> : <BalanceProgressMeter
                        total={p.req}
                        paid={p.pd}
                        remaining={p.rem}
                        size="sm"
                        type="patient"
                      />}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'overview' && !canViewReports && <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
        التقارير المالية غير متاحة لهذا الحساب.{canViewExpenses && ' يمكنك متابعة المصروفات والفواتير من القسم المتاح أعلاه.'}
      </div>}

      {/* Expenses Tab */}
      {activeTab === 'expenses' && canViewExpenses && (
        <div className="summary-expenses bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-5">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
            <div>
              <h2 className="text-base font-bold text-slate-900 font-tajawal flex items-center gap-2">
                <span>سجل المصروفات وفواتير الموردين</span>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-900 font-mono">
                  {expenses.length} بند
                </span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                أضف مصروفًا يدويًا أو ارفع صورة فاتورة، ثم راجع بياناتها وأصنافها
              </p>
            </div>

            <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto min-w-0">
              <button
                type="button"
                onClick={() => setIsOcrModalOpen(true)}
                className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-700 to-indigo-800 hover:from-emerald-800 hover:to-indigo-900 text-white text-xs font-black shadow-md cursor-pointer transition-all flex items-center justify-center gap-2 shrink-0 border border-emerald-400/30"
              >
                <Sparkles className="w-4 h-4 text-emerald-300" />
                <span>قراءة صورة فاتورة</span>
              </button>

              <button
                type="button"
                onClick={() => handleOpenAddExpense()}
                className="px-3.5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold shadow-md cursor-pointer transition-colors flex items-center justify-center gap-1.5 shrink-0"
              >
                <Plus className="w-4 h-4 text-amber-400" />
                <span>إضافة مصروف</span>
              </button>
            </div>
          </div>

          {/* Preset Buttons Bar for Fast Entry */}
          <details className="summary-expense-presets bg-amber-50/70 border border-amber-200/80 p-3.5 rounded-2xl space-y-2">
            <summary className="text-sm font-bold text-amber-900 cursor-pointer">إضافة مصروف متكرر <span className="text-xs font-normal">إيجار · رواتب · مرافق</span></summary>
            <div className="flex flex-wrap gap-2 text-xs">
              <button
                type="button"
                onClick={() => handleOpenAddExpense('إيجار العيادة', 'fixed', 'rent')}
                className="px-3 py-1.5 rounded-xl bg-white hover:bg-amber-100 text-amber-950 border border-amber-300 font-bold text-[11px] cursor-pointer shadow-2xs transition-colors flex items-center gap-1"
              >
                <Building2 className="h-4 w-4" aria-hidden="true" /><span>إيجار العيادة</span>
              </button>
              <button
                type="button"
                onClick={() => handleOpenAddExpense('مرتب السكرتيرة / المساعد', 'fixed', 'salary')}
                className="px-3 py-1.5 rounded-xl bg-white hover:bg-amber-100 text-amber-950 border border-amber-300 font-bold text-[11px] cursor-pointer shadow-2xs transition-colors flex items-center gap-1"
              >
                <Users className="h-4 w-4" aria-hidden="true" /><span>راتب السكرتيرة</span>
              </button>
              <button
                type="button"
                onClick={() => handleOpenAddExpense('فاتورة الكهرباء', 'fixed', 'electricity')}
                className="px-3 py-1.5 rounded-xl bg-white hover:bg-amber-100 text-amber-950 border border-amber-300 font-bold text-[11px] cursor-pointer shadow-2xs transition-colors flex items-center gap-1"
              >
                <Zap className="h-4 w-4" aria-hidden="true" /><span>فاتورة الكهرباء</span>
              </button>
              <button
                type="button"
                onClick={() => handleOpenAddExpense('فاتورة المياه', 'fixed', 'water')}
                className="px-3 py-1.5 rounded-xl bg-white hover:bg-amber-100 text-amber-950 border border-amber-300 font-bold text-[11px] cursor-pointer shadow-2xs transition-colors flex items-center gap-1"
              >
                <Droplets className="h-4 w-4" aria-hidden="true" /><span>فاتورة المياه</span>
              </button>
            </div>
          </details>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div><h3 className="font-bold text-sm text-slate-900">مصروفات الفترة</h3><p className="text-xs text-slate-500">{monthExpenses.length} بند حسب تاريخ الفاتورة</p></div>
              <div className="flex flex-wrap items-center gap-2">
                <input aria-label="شهر المصروفات" type="month" value={expenseMonth === 'all' ? '' : expenseMonth} onChange={e => setExpenseMonth(e.target.value || currentMonth)} className="border border-slate-300 rounded-xl p-2 bg-white" />
                <button type="button" onClick={() => setExpenseMonth(currentMonth)} className="px-3 py-2 rounded-xl bg-white border text-xs font-bold">الشهر الحالي</button>
                <button type="button" onClick={() => setExpenseMonth('all')} className={`px-3 py-2 rounded-xl border text-xs font-bold ${expenseMonth === 'all' ? 'bg-slate-900 text-white' : 'bg-white'}`}>كل الفترات</button>
              </div>
            </div>
            {canViewReports && <>
              <div className="summary-expense-totals">
                <div><span>قيمة الفواتير</span><strong><bdi>{maskMoney(monthlyTotal)}</bdi></strong></div>
                <div><span>المدفوع المسجل</span><strong><bdi>{maskMoney(monthlyPaid)}</bdi></strong></div>
                <div><span>المتبقي للموردين</span><strong><bdi>{maskMoney(monthlyRemaining)}</bdi></strong></div>
              </div>
              <details className="summary-expense-breakdown">
                <summary>تفصيل المصروفات حسب النوع</summary>
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 text-center">
                  {[
                    ['الإيجار', monthlyBreakdown.rent], ['الكهرباء', monthlyBreakdown.electricity], ['المياه', monthlyBreakdown.water],
                    ['الرواتب', monthlyBreakdown.salary], ['الخامات', monthlyBreakdown.supplies], ['الصيانة', monthlyBreakdown.maintenance], ['أخرى', monthlyBreakdown.other]
                  ].map(([label, amount]) => <div key={String(label)} className="rounded-xl bg-white border p-2"><span className="block text-xs text-slate-500">{label}</span><strong className="text-xs text-slate-900">{maskMoney(Number(amount))}</strong></div>)}
                </div>
              </details>
            </>}
          </div>

          {/* Search & Category Filter Bar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-2.5" />
              <input
                type="text"
                value={expenseSearchQuery}
                onChange={e => setExpenseSearchQuery(e.target.value)}
                placeholder="بحث شامل باسم المورد، الرقم الضريبي، رقم الفاتورة، أو اسم المادة والأصناف المشتراة..."
                className="w-full pr-10 pl-3 py-2 text-xs rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 font-medium"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 pb-1 text-xs shrink-0">
              <button
                type="button"
                onClick={() => setExpenseFilterCategory('all')}
                className={`px-3 py-1.5 rounded-xl font-bold transition-colors cursor-pointer shrink-0 ${
                  expenseFilterCategory === 'all' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                الكل ({monthExpenses.length})
              </button>
              <button
                type="button"
                onClick={() => setExpenseFilterCategory('supplies')}
                className={`px-3 py-1.5 rounded-xl font-bold transition-colors cursor-pointer shrink-0 ${
                  expenseFilterCategory === 'supplies' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                📦 خامات ومستلزمات ({monthExpenses.filter(e => e.category === 'supplies').length})
              </button>
              <button
                type="button"
                onClick={() => setExpenseFilterCategory('fixed')}
                className={`px-3 py-1.5 rounded-xl font-bold transition-colors cursor-pointer shrink-0 ${
                  expenseFilterCategory === 'fixed' ? 'bg-amber-600 text-white' : 'bg-amber-50 text-amber-900 border border-amber-200'
                }`}
              >
                📌 ثابتة ({monthExpenses.filter(e => e.isFixed || e.category === 'fixed').length})
              </button>
            </div>
          </div>

          {filteredExpenses.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-xs bg-slate-50 rounded-2xl border border-slate-200">
              {monthExpenses.length ? 'لا توجد مصروفات مطابقة للبحث أو التصنيف المحدد.' : 'لا توجد مصروفات في الفترة المحددة. يمكنك اختيار شهر آخر أو إضافة مصروف جديد.'}
            </div>
          ) : (
            <div className="divide-y divide-slate-100 border border-slate-200 rounded-2xl overflow-hidden">
              {filteredExpenses.map(exp => {
                  const isFixed = exp.isFixed || exp.category === 'fixed';
                  return (
                    <div key={exp.id} className="p-4 bg-white hover:bg-slate-50/90 transition-colors flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
                      <div className="space-y-1.5 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            type="button"
                            onClick={() => setViewingExpenseDetail(exp)}
                            className="font-black text-slate-900 text-sm font-tajawal hover:text-indigo-600 transition text-right cursor-pointer"
                          >
                            {exp.supplierName || exp.title}
                          </button>
                          {exp.invoiceNumber && (
                            <span className="bg-slate-100 text-slate-700 text-[11px] px-2 py-0.5 rounded-md font-mono border border-slate-200">
                              #{exp.invoiceNumber}
                            </span>
                          )}
                          {isFixed ? (
                            <span className="text-[10px] bg-amber-100 text-amber-900 border border-amber-300 font-bold px-2 py-0.5 rounded-md flex items-center gap-1">
                              <Pin className="w-3 h-3 text-amber-700" /> مصروف ثابت
                            </span>
                          ) : (
                            <span className="text-[10px] bg-indigo-50 text-indigo-800 px-2 py-0.5 rounded-md font-medium border border-indigo-200">
                              {getCategoryLabel(exp.category)}
                            </span>
                          )}
                        </div>

                        {/* Itemized Line Items Chips preview */}
                        {exp.items && exp.items.length > 0 && (
                          <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                            <span className="text-[10px] font-bold text-slate-400">البنود:</span>
                            {exp.items.slice(0, 3).map((it, idx) => (
                              <span key={idx} className="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-slate-100 text-slate-800 border border-slate-200">
                                {it.itemName} ({it.quantity} {it.unit || 'قطع'})
                              </span>
                            ))}
                            {exp.items.length > 3 && (
                              <span className="text-[10px] font-bold text-indigo-600">+{exp.items.length - 3} أصناف أخرى</span>
                            )}
                          </div>
                        )}

                        <div className="flex flex-wrap items-center gap-2 text-[13px] text-slate-500">
                          <span>التاريخ: {exp.invoiceDate || exp.date}</span>
                          {exp.taxNumber && <span>• ضريبي: {exp.taxNumber}</span>}
                          {exp.note && <span>• {exp.note}</span>}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-3 border-t sm:border-t-0 pt-2 sm:pt-0 w-full sm:w-auto justify-between sm:justify-end">
                        <div className="text-left font-mono">
                          <span className="font-black text-rose-700 text-base block">
                            {maskMoney(exp.amount)}
                          </span>
                          <span className="block text-[13px] text-slate-500">مدفوع: {maskMoney(getExpensePaymentSummary(exp).paid)} · متبقي: {maskMoney(getExpensePaymentSummary(exp).remaining)}</span>
                          {exp.tax ? <span className="text-[10px] text-slate-400">شامل الضريبة: {maskMoney(exp.tax)}</span> : null}
                        </div>

                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setViewingExpenseDetail(exp)}
                            className="min-h-[44px] px-2.5 py-1.5 text-sm font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-xl transition cursor-pointer flex items-center gap-1"
                            title="عرض تفاصيل الفاتورة الكاملة"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>تفاصيل</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleOpenEditExpense(exp)}
                            className="min-h-[44px] min-w-[44px] grid place-items-center p-1.5 text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition cursor-pointer"
                            title="تعديل"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDeleteExpenseConfirmed(exp)}
                            className="min-h-[44px] min-w-[44px] grid place-items-center p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                            title="حذف"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      )}

      {/* Analytics Tab */}
      {activeTab === 'analytics' && canViewAnalytics && (
        <SupplierAnalyticsView expenses={expenses} materialUsages={materialUsages} onAddMaterialUsage={onAddMaterialUsage} onDeleteMaterialUsage={onDeleteMaterialUsage} isPrivacyMode={isPrivacyMode} />
      )}
      </div>

      {/* Add / Edit Expense Modal */}
      {isExpenseModalOpen && canViewExpenses && (
        <div 
          onClick={handleCloseExpenseModal}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/75 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto animate-fadeIn dir-rtl"
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4 max-h-[90dvh] overflow-y-auto modal-scroll my-auto relative z-10"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h2 className="text-base font-bold text-[#0f3d3e] font-tajawal">
                {editingExpense ? `تعديل مصروف: ${editingExpense.title}` : 'تسجيل مصروف جديد'}
              </h2>
              <button 
                type="button" 
                onClick={handleCloseExpenseModal} 
                className="text-slate-400 hover:text-slate-600 cursor-pointer p-1 rounded-lg hover:bg-slate-100 transition"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveExpenseForm} className="space-y-4 text-xs">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  البيان / عنوان المصروف <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={expenseTitle}
                  onChange={e => setExpenseTitle(e.target.value)}
                  placeholder="مثال: إيجار المقر الشهرى / مرتب السكرتيرة"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold focus:outline-none focus:border-[#0f3d3e]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  تصنيف المصروف
                </label>
                <select
                  value={expenseCategory}
                  onChange={e => { const category = e.target.value as Expense['category']; setExpenseCategory(category); setExpenseType(category === 'supplies' ? 'supplies' : category === 'maintenance' ? 'maintenance' : 'other'); }}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold focus:outline-none focus:border-[#0f3d3e]"
                >
                  <option value="fixed">📌 مصروفات ثابتة (إيجارات/راتب سكرتيرة/كهرباء)</option>
                  <option value="supplies">📦 خامات ومستلزمات طبيب</option>
                  <option value="maintenance">🛠️ صيانة وتشغيل الأجهزة</option>
                  <option value="other">💬 مصروفات نثرية وأخرى</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">نوع المصروف بالتحديد</label>
                <select value={expenseType} onChange={e => {
                  const type = e.target.value as NonNullable<Expense['expenseType']>;
                  setExpenseType(type);
                  setExpenseCategory(type === 'supplies' ? 'supplies' : type === 'maintenance' ? 'maintenance' : type === 'other' ? 'other' : 'fixed');
                }} className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold">
                  <option value="rent">🏢 إيجار</option><option value="electricity">⚡ كهرباء</option><option value="water">💧 مياه</option><option value="salary">👩‍💼 رواتب</option><option value="supplies">📦 خامات ومستلزمات</option><option value="maintenance">🛠️ صيانة</option><option value="other">أخرى</option>
                </select>
              </div>

              <label className="p-3 bg-amber-50/80 rounded-xl border border-amber-200 flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isFixedExpense}
                  onChange={e => setIsFixedExpense(e.target.checked)}
                  className="w-4 h-4 rounded text-amber-600 focus:ring-amber-500"
                />
                <div>
                  <span className="font-bold text-amber-950 block">تصنيف كمصروف شهري ثابت</span>
                  <span className="text-[10px] text-amber-800">للتقارير فقط؛ تسجل القيد الفعلي كل شهر حتى لا يُحسب مبلغ لم يُدفع.</span>
                </div>
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    المبلغ (ج.م) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="number"
                    required
                    min="0.01"
                    step="0.01"
                    value={expenseAmount}
                    readOnly={isInvoiceTotalLocked}
                    onChange={e => setExpenseAmount(e.target.value === '' ? '' : parseFloat(e.target.value))}
                    placeholder="0"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono font-bold focus:outline-none focus:border-[#0f3d3e]"
                  />
                  {isInvoiceTotalLocked && <p className="mt-1 text-xs text-slate-500">إجمالي الفاتورة محفوظ مع أصنافها ومدفوعاتها. هذا النموذج يعدّل البيانات الأساسية فقط.</p>}
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    تاريخ المصروف / الفاتورة
                  </label>
                  <input
                    type="date"
                    required
                    value={expenseDate}
                    onChange={e => setExpenseDate(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono focus:outline-none focus:border-[#0f3d3e]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">ملاحظات إضافية</label>
                <input
                  type="text"
                  value={expenseNote}
                  onChange={e => setExpenseNote(e.target.value)}
                  placeholder="اسم المورد، رقم الفاتورة أو إيصال السداد..."
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:outline-none focus:border-[#0f3d3e]"
                />
              </div>

              {/* Photo Invoice Attachment Field */}
              <div className="bg-emerald-50/70 border border-emerald-200 p-3.5 rounded-2xl space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-emerald-950 flex items-center gap-1.5">
                    <Camera className="w-4 h-4 text-emerald-700" />
                    <span>صورة فاتورة الخامات / الإيصال (اختياري)</span>
                  </label>
                  {expenseInvoiceImage && (
                    <button
                      type="button"
                      onClick={() => setExpenseInvoiceImage(undefined)}
                      className="text-[11px] font-bold text-rose-600 hover:underline cursor-pointer"
                    >
                      حذف الصورة
                    </button>
                  )}
                </div>

                <p className="text-[11px] text-emerald-800 leading-relaxed">
                  أرفق الصورة للرجوع إليها. لتسجيل الأصناف والكميات استخدم «قراءة صورة فاتورة» من سجل المصروفات.
                </p>

                {expenseInvoiceImage ? (
                  <div className="relative rounded-xl overflow-hidden border border-emerald-300 bg-white group max-h-48 flex items-center justify-center">
                    <img
                      src={expenseInvoiceImage}
                      alt="صورة الفاتورة المرفقة"
                      className="object-contain max-h-44 w-full"
                    />
                    <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => setActiveInvoiceLightbox({
                          title: expenseTitle || 'معاينة الفاتورة',
                          imageUrl: expenseInvoiceImage,
                          amount: typeof expenseAmount === 'number' ? expenseAmount : 0,
                          date: expenseDate
                        })}
                        className="px-3 py-1.5 bg-white text-slate-900 font-bold text-xs rounded-lg shadow-sm flex items-center gap-1 cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>تكبير الصورة</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center p-4 border-2 border-dashed border-emerald-300 hover:border-emerald-500 rounded-xl bg-white hover:bg-emerald-50/50 cursor-pointer transition-colors text-center">
                    <ImageIcon className="w-6 h-6 text-emerald-600 mb-1" />
                    <span className="font-bold text-xs text-emerald-950">اضغط لالتقاط صورة الفاتورة بالكاميرا أو رفع ملف</span>
                    <span className="text-[10px] text-slate-400 mt-0.5">يدعم JPG, PNG, WEBP</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      capture="environment"
                      onChange={handleInvoiceFileChange}
                      className="hidden"
                    />
                  </label>
                )}
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={handleCloseExpenseModal}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer transition"
                >
                  إلغاء وإغلاق
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-[#0f3d3e] hover:bg-[#1b5e5a] text-white text-xs font-bold shadow-md cursor-pointer active:scale-95 transition"
                >
                  {editingExpense ? 'حفظ التعديلات' : 'حفظ المصروف'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Invoice Image Lightbox Modal */}
      {activeInvoiceLightbox && canViewExpenses && (
        <div 
          onClick={() => setActiveInvoiceLightbox(null)}
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-4 animate-fadeIn"
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            className="bg-slate-900 rounded-3xl max-w-2xl w-full p-5 text-white shadow-2xl border border-slate-700 space-y-4"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div>
                <h3 className="text-base font-extrabold text-emerald-400 font-tajawal flex items-center gap-2">
                  <FileText className="w-5 h-5 text-emerald-400" />
                  <span>{activeInvoiceLightbox.title}</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  المبلغ: <span className="font-mono text-emerald-300 font-bold">{maskMoney(activeInvoiceLightbox.amount)}</span> | التاريخ: <span className="font-mono text-slate-300">{activeInvoiceLightbox.date}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveInvoiceLightbox(null)}
                className="p-2 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-xl transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="relative rounded-2xl overflow-hidden bg-black/60 p-2 flex items-center justify-center min-h-[300px] max-h-[70vh]">
              <img
                src={activeInvoiceLightbox.imageUrl}
                alt={activeInvoiceLightbox.title}
                className="max-h-[65vh] w-auto object-contain rounded-lg shadow-lg"
              />
            </div>

            <div className="flex items-center justify-between pt-2 text-xs">
              <a
                href={activeInvoiceLightbox.imageUrl}
                download={`فاتورة_${activeInvoiceLightbox.title}_${activeInvoiceLightbox.date}.png`}
                target="_blank"
                rel="noreferrer"
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold cursor-pointer transition-colors shadow-xs"
              >
                تحميل الصورة / فتح بنفذة جديدة ↗
              </a>
              <button
                type="button"
                onClick={() => setActiveInvoiceLightbox(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold cursor-pointer"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ERP OCR Invoice Modal */}
      {canViewExpenses && <InvoiceOcrModal
        isOpen={isOcrModalOpen}
        onClose={() => setIsOcrModalOpen(false)}
        existingExpenses={expenses}
        onSaveExpense={(newExp) => {
          if (!canViewExpenses) return;
          if (onSaveExpense) {
            onSaveExpense(newExp);
          } else {
            onAddExpense(newExp);
          }
          showToast('تم تسجيل الفاتورة وبنودها بنجاح 🧾', 'success');
        }}
      />}

      {/* ERP Expense Detail Modal */}
      {canViewExpenses && <ExpenseDetailModal
        isOpen={Boolean(viewingExpenseDetail)}
        expense={viewingExpenseDetail}
        onClose={() => setViewingExpenseDetail(null)}
        isPrivacyMode={isPrivacyMode}
        onEdit={(exp) => {
          setViewingExpenseDetail(null);
          handleOpenEditExpense(exp);
        }}
      />}
    </div>
  );
});

SummaryView.displayName = 'SummaryView';
