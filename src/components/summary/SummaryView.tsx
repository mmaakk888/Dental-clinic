import React, { useState, useMemo } from 'react';
import { ArrowRight, Landmark, DollarSign, TrendingUp, AlertCircle, Calendar, Plus, Trash2, Receipt, ShieldAlert, CreditCard, Edit3, Pin, Camera, Image as ImageIcon, Eye, X, FileText, Search, Sparkles, Building2, BarChart2 } from 'lucide-react';
import { Patient, LabCase, Expense, MaterialUsage } from '../../types';
import { useToastAndConfirm } from '../common/ToastAndConfirm';
import { BalanceProgressMeter, CompactBalanceBadge, VisualFinancialCard } from '../common/FinancialBadge';
import { InvoiceOcrModal } from './InvoiceOcrModal';
import { ExpenseDetailModal } from './ExpenseDetailModal';
import { SupplierAnalyticsView } from './SupplierAnalyticsView';
import { getPatientFinancialSummary } from '../../utils/financials';
import { expenseBreakdown, expensesForMonth, inferExpenseType } from '../../utils/expenseUtils';

interface SummaryViewProps {
  patients: Patient[];
  labCases: LabCase[];
  expenses: Expense[];
  materialUsages: MaterialUsage[];
  isPrivacyMode?: boolean;
  isOpenAddExpenseModal?: boolean;
  onCloseAddExpenseModal?: () => void;
  onAddExpense: (expense: Omit<Expense, 'id'>) => void;
  onSaveExpense?: (expense: Omit<Expense, 'id'> & { id?: string }) => void;
  onDeleteExpense: (id: string) => void;
  onAddMaterialUsage: (usage: Omit<MaterialUsage, 'id'>) => void;
  onDeleteMaterialUsage: (id: string) => void;
  onBackToHome: () => void;
}

export const SummaryView: React.FC<SummaryViewProps> = React.memo(({
  patients,
  labCases,
  expenses,
  materialUsages,
  isPrivacyMode = false,
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

  const [activeTab, setActiveTab] = useState<'overview' | 'expenses' | 'analytics'>('overview');
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
  const [expenseDate, setExpenseDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [expenseNote, setExpenseNote] = useState('');
  const [isFixedExpense, setIsFixedExpense] = useState(false);
  const [expenseInvoiceImage, setExpenseInvoiceImage] = useState<string | undefined>(undefined);
  const [expenseFilterCategory, setExpenseFilterCategory] = useState<'all' | 'fixed' | 'supplies' | 'maintenance'>('all');
  const currentMonth = new Date().toISOString().slice(0, 7);
  const [expenseMonth, setExpenseMonth] = useState<string | 'all'>(currentMonth);
  const [expenseType, setExpenseType] = useState<NonNullable<Expense['expenseType']>>('supplies');
  const monthExpenses = useMemo(() => expensesForMonth(expenses, expenseMonth), [expenses, expenseMonth]);
  const monthlyBreakdown = useMemo(() => expenseBreakdown(monthExpenses), [monthExpenses]);
  const monthlyTotal = monthExpenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);

  // Lightbox Image Viewer State
  const [activeInvoiceLightbox, setActiveInvoiceLightbox] = useState<{ title: string; imageUrl: string; amount: number; date: string } | null>(null);

  // Close Expense Modal Handler
  const handleCloseExpenseModal = () => {
    setIsExpenseModalOpen(false);
    if (onCloseAddExpenseModal) {
      onCloseAddExpenseModal();
    }
  };

  // Open modal if external trigger opens add expense
  React.useEffect(() => {
    if (isOpenAddExpenseModal) {
      setActiveTab('expenses');
      setEditingExpense(null);
      setExpenseTitle('');
      setExpenseCategory('supplies');
      setExpenseType('supplies');
      setExpenseAmount('');
      setExpenseDate(new Date().toISOString().split('T')[0]);
      setExpenseNote('');
      setIsFixedExpense(false);
      setExpenseInvoiceImage(undefined);
      setIsExpenseModalOpen(true);
    }
  }, [isOpenAddExpenseModal]);

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
  const { totalRequired, totalPaid, totalRemain, totalLabCosts, totalExpensesAmount, realNetProfit } = useMemo(() => {
    let req = 0;
    let paid = 0;

    patients.forEach(p => {
      const financial = getPatientFinancialSummary(p);
      req += Math.max(0, financial.totalRequired - financial.totalDiscounts);
      paid += financial.totalCollected;
    });

    const rem = Math.max(0, req - paid);
    const labCosts = labCases.reduce((acc, c) => acc + c.labTotal, 0);
    const expAmt = expenses.reduce((acc, e) => acc + e.amount, 0);
    const profit = paid - (labCosts + expAmt);

    return {
      totalRequired: req,
      totalPaid: paid,
      totalRemain: rem,
      totalLabCosts: labCosts,
      totalExpensesAmount: expAmt,
      realNetProfit: profit
    };
  }, [patients, labCases, expenses]);

  const maskMoney = (amt: number) => {
    if (isPrivacyMode) return '*** ج.م';
    return `${amt.toLocaleString()} ج.م`;
  };

  const handleInvoiceFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 8 * 1024 * 1024) {
        showToast('حجم صورة الفاتورة كبير جداً، يرجى اختيار صورة أقل من 8 ميجابايت', 'warning');
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setExpenseInvoiceImage(reader.result as string);
        showToast('تم إرفاق صورة الفاتورة بنجاح 📷', 'success');
      };
      reader.readAsDataURL(file);
    }
  };

  const handleOpenAddExpense = (presetTitle?: string, presetCat?: 'fixed' | 'supplies' | 'maintenance' | 'other', presetType?: NonNullable<Expense['expenseType']>) => {
    setEditingExpense(null);
    setExpenseTitle(presetTitle || '');
    setExpenseCategory(presetCat || 'supplies');
    setExpenseType(presetType || (presetCat === 'maintenance' ? 'maintenance' : presetCat === 'supplies' || !presetCat ? 'supplies' : 'other'));
    setExpenseAmount('');
    setExpenseDate(new Date().toISOString().split('T')[0]);
    setExpenseNote('');
    setIsFixedExpense(presetCat === 'fixed' || (presetTitle && !presetTitle.includes('خامات')) ? true : false);
    setExpenseInvoiceImage(undefined);
    setIsExpenseModalOpen(true);
  };

  const handleOpenEditExpense = (exp: Expense) => {
    setEditingExpense(exp);
    setExpenseTitle(exp.title);
    setExpenseCategory(exp.category);
    setExpenseType(inferExpenseType(exp));
    setExpenseAmount(exp.amount);
    setExpenseDate(exp.date);
    setExpenseNote(exp.note || '');
    setIsFixedExpense(exp.isFixed ?? (exp.category === 'fixed'));
    setExpenseInvoiceImage(exp.invoiceImageUrl);
    setIsExpenseModalOpen(true);
  };

  const handleSaveExpenseForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!expenseTitle.trim()) {
      showToast('يرجى كتابة بيان / عنوان المصروف', 'warning');
      return;
    }

    const amt = typeof expenseAmount === 'number' ? expenseAmount : 0;
    if (amt <= 0) {
      showToast('يرجى كتابة قيمة مصروف صحيحة أكبر من الصفر', 'warning');
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

    if (onSaveExpense) {
      onSaveExpense(payload);
    } else {
      onAddExpense(payload);
    }

    handleCloseExpenseModal();
    showToast(editingExpense ? 'تم تعديل بيانات المصروف بنجاح' : 'تم تسجيل المصروف وإرفاق الفاتورة بنجاح', 'success');
  };

  const handleDeleteExpenseConfirmed = (exp: Expense) => {
    askConfirm({
      title: 'حذف مصروف',
      message: `هل أنت تأكد من حذف المصروف (${exp.title}) بقيمة ${exp.amount} ج.م؟`,
      confirmLabel: 'تأكيد الحذف',
      tone: 'danger',
      onConfirm: () => {
        onDeleteExpense(exp.id);
        showToast('تم حذف بنج تسجيل المصروف', 'info');
      }
    });
  };

  const getCategoryLabel = (cat: string) => {
    switch (cat) {
      case 'supplies': return 'خامات ومستلزمات';
      case 'fixed': return 'مصروفات ثابتة (إيجار/عقود)';
      case 'maintenance': return 'صيانة وتشغيل العيادة';
      case 'other': return 'مصروفات أخرى';
      default: return cat;
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto py-2">
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
              نظرة شمولية على المقبوضات، التكاليف، المصروفات وصافي الربح الحقيقي
            </p>
          </div>
        </div>

        {/* Tab switcher */}
        <div className="summary-tabs grid grid-cols-1 sm:grid-cols-3 gap-2 bg-slate-100 p-1 rounded-xl border border-slate-200 w-full lg:w-auto">
          <button
            type="button"
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold font-tajawal transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'overview' ? 'bg-[#0f3d3e] text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            📊 الميزانية والأرباح
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('expenses')}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold font-tajawal transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'expenses' ? 'bg-[#0f3d3e] text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            💸 جدول المصروفات والفواتير ({expenses.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('analytics')}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold font-tajawal transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'analytics' ? 'bg-indigo-700 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            📈 تحليلات الخامات والموردين (ERP)
          </button>
        </div>
      </div>

      {/* Main Financial KPI Deck */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <VisualFinancialCard
          title="إجمالي المقبوضات الفعلية"
          subtitle="السيولة المحصلة من المرضى"
          amount={maskMoney(totalPaid)}
          icon={<DollarSign className="w-6 h-6 text-emerald-400" />}
          gradient="emerald"
          ratioPercent={totalRequired > 0 ? Math.round((totalPaid / totalRequired) * 100) : 100}
          ratioLabel="تحصيل"
          footerInfo={`المتبقي غير المحصل: ${maskMoney(totalRemain)}`}
        />

        <VisualFinancialCard
          title="مستحقات التركيبات الكلية"
          subtitle="تكلفة التركيبات والطرابيش"
          amount={maskMoney(totalLabCosts)}
          icon={<Receipt className="w-6 h-6 text-rose-300" />}
          gradient="rose"
          footerInfo="إجمالي طلبات وتصنيع التركيبات"
        />

        <VisualFinancialCard
          title="المصروفات التشغيلية"
          subtitle="خامات + إيجارات + صيانة"
          amount={maskMoney(totalExpensesAmount)}
          icon={<CreditCard className="w-6 h-6 text-amber-300" />}
          gradient="amber"
          footerInfo={`إجمالي عدد البنود: ${expenses.length} مصروف`}
        />

        <VisualFinancialCard
          title="صافي الربح الحقيقي"
          subtitle="المقبوضات − (التركيبات + المصروفات)"
          amount={maskMoney(realNetProfit)}
          icon={<TrendingUp className="w-6 h-6 text-[#c9a227]" />}
          gradient="teal"
          footerInfo="الميزانية الصافية للعيادة"
        />
      </div>

      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Patient Debtors List */}
          <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-4">
            <h2 className="text-base font-bold text-slate-900 font-tajawal flex items-center justify-between">
              <span>قائمة الحالات ذات المتبقي المالي الأعلى (المستحقات غير المحصلة)</span>
              <span className="text-xs font-mono font-normal text-slate-500">
                إجمالي المتبقي: {maskMoney(totalRemain)}
              </span>
            </h2>

            <div className="divide-y divide-slate-100 border border-slate-200 rounded-2xl overflow-hidden">
              {patients
                .map(p => {
                  const req = p.sessions.reduce((a, s) => a + s.amount, 0);
                  const pd = p.sessions.reduce((a, s) => a + s.paid, 0);
                  return { ...p, req, pd, rem: req - pd };
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
                      <BalanceProgressMeter
                        total={p.req}
                        paid={p.pd}
                        remaining={p.rem}
                        size="sm"
                        type="patient"
                      />
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* Expenses Tab */}
      {activeTab === 'expenses' && (
        <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-5">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
            <div>
              <h2 className="text-base font-bold text-slate-900 font-tajawal flex items-center gap-2">
                <span>سجل المصروفات وفواتير الموردين (ERP)</span>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-900 font-mono">
                  {expenses.length} بند
                </span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                إدارة كاملة لفواتير الموردين، تفنيط البنود، تصوير الفواتير، واستخراج الذكاء الاصطناعي
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
                <span>إضافة يدوي</span>
              </button>
            </div>
          </div>

          {/* Preset Buttons Bar for Fast Entry */}
          <div className="bg-amber-50/70 border border-amber-200/80 p-3.5 rounded-2xl space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-amber-900 block font-tajawal">
                ⚡ كبسولات إدخال الفواتير والمصروفات:
              </span>
              <span className="text-[10px] text-emerald-800 bg-emerald-100/80 px-2 py-0.5 rounded-md font-bold">
                📷 المسح الضوئي الذكي مفعل
              </span>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <button
                type="button"
                onClick={() => setIsOcrModalOpen(true)}
                className="px-3.5 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-[11px] cursor-pointer shadow-2xs transition-colors flex items-center gap-1.5"
              >
                <Camera className="w-3.5 h-3.5 text-emerald-200" />
                <span>📷 مسح فاتورة المورد بالكامل</span>
              </button>
              <button
                type="button"
                onClick={() => handleOpenAddExpense('إيجار مقر العيادة الشهرية', 'fixed', 'rent')}
                className="px-3 py-1.5 rounded-xl bg-white hover:bg-amber-100 text-amber-950 border border-amber-300 font-bold text-[11px] cursor-pointer shadow-2xs transition-colors flex items-center gap-1"
              >
                🏢 إيجار المقر
              </button>
              <button
                type="button"
                onClick={() => handleOpenAddExpense('مرتب السكرتيرة / المساعد', 'fixed', 'salary')}
                className="px-3 py-1.5 rounded-xl bg-white hover:bg-amber-100 text-amber-950 border border-amber-300 font-bold text-[11px] cursor-pointer shadow-2xs transition-colors flex items-center gap-1"
              >
                👩‍💼 مرتب السكرتيرة
              </button>
              <button
                type="button"
                onClick={() => handleOpenAddExpense('فاتورة الكهرباء', 'fixed', 'electricity')}
                className="px-3 py-1.5 rounded-xl bg-white hover:bg-amber-100 text-amber-950 border border-amber-300 font-bold text-[11px] cursor-pointer shadow-2xs transition-colors flex items-center gap-1"
              >
                ⚡ فاتورة الكهرباء
              </button>
              <button
                type="button"
                onClick={() => handleOpenAddExpense('فاتورة المياه', 'fixed', 'water')}
                className="px-3 py-1.5 rounded-xl bg-white hover:bg-amber-100 text-amber-950 border border-amber-300 font-bold text-[11px] cursor-pointer shadow-2xs transition-colors flex items-center gap-1"
              >
                💧 فاتورة المياه
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div><h3 className="font-bold text-sm text-slate-900">مصروفات الفترة</h3><p className="text-xs text-slate-500">كل فاتورة تُحسب مرة واحدة في شهر تاريخ الفاتورة.</p></div>
              <div className="flex flex-wrap items-center gap-2">
                <input aria-label="شهر المصروفات" type="month" value={expenseMonth === 'all' ? '' : expenseMonth} onChange={e => setExpenseMonth(e.target.value || currentMonth)} className="border border-slate-300 rounded-xl p-2 bg-white" />
                <button type="button" onClick={() => setExpenseMonth(currentMonth)} className="px-3 py-2 rounded-xl bg-white border text-xs font-bold">الشهر الحالي</button>
                <button type="button" onClick={() => setExpenseMonth('all')} className={`px-3 py-2 rounded-xl border text-xs font-bold ${expenseMonth === 'all' ? 'bg-slate-900 text-white' : 'bg-white'}`}>كل الفترات</button>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 text-center">
              {[
                ['الإيجار', monthlyBreakdown.rent], ['الكهرباء', monthlyBreakdown.electricity], ['المياه', monthlyBreakdown.water],
                ['الرواتب', monthlyBreakdown.salary], ['الخامات', monthlyBreakdown.supplies], ['الصيانة', monthlyBreakdown.maintenance], ['أخرى', monthlyBreakdown.other]
              ].map(([label, amount]) => <div key={String(label)} className="rounded-xl bg-white border p-2"><span className="block text-[11px] text-slate-500">{label}</span><strong className="text-xs text-slate-900">{maskMoney(Number(amount))}</strong></div>)}
            </div>
            <p className="text-sm font-black text-rose-700">الإجمالي: {maskMoney(monthlyTotal)} · {monthExpenses.length} بند</p>
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

          {monthExpenses.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-xs bg-slate-50 rounded-2xl border border-slate-200">
              لا توجد مصروفات مسجلة بعد بالعيادة. يمكنك المسح الضوئي لفواتيرك أو استخدام الإدخال السريع.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 border border-slate-200 rounded-2xl overflow-hidden">
              {monthExpenses
                .filter(exp => {
                  if (expenseFilterCategory === 'fixed' && !(exp.isFixed || exp.category === 'fixed')) return false;
                  if (expenseFilterCategory === 'supplies' && exp.category !== 'supplies') return false;
                  if (expenseFilterCategory === 'maintenance' && exp.category !== 'maintenance' && exp.category !== 'other') return false;

                  if (expenseSearchQuery.trim()) {
                    const q = expenseSearchQuery.toLowerCase();
                    const matchTitle = (exp.title || '').toLowerCase().includes(q);
                    const matchSupplier = (exp.supplierName || '').toLowerCase().includes(q);
                    const matchTax = (exp.taxNumber || '').toLowerCase().includes(q);
                    const matchInvoiceNo = (exp.invoiceNumber || '').toLowerCase().includes(q);
                    const matchNote = (exp.note || '').toLowerCase().includes(q);
                    const matchItems = exp.items?.some(i => (i.itemName || '').toLowerCase().includes(q));
                    return matchTitle || matchSupplier || matchTax || matchInvoiceNo || matchNote || matchItems;
                  }
                  return true;
                })
                .map(exp => {
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

                        <div className="flex items-center gap-3 text-[11px] text-slate-500">
                          <span>التاريخ: {exp.invoiceDate || exp.date}</span>
                          {exp.taxNumber && <span>• ضريبي: {exp.taxNumber}</span>}
                          {exp.note && <span>• {exp.note}</span>}
                        </div>
                      </div>

                      <div className="flex items-center gap-3 border-t sm:border-t-0 pt-2 sm:pt-0 w-full sm:w-auto justify-between sm:justify-end">
                        <div className="text-left font-mono">
                          <span className="font-black text-rose-700 text-sm block">
                            -{maskMoney(exp.amount)}
                          </span>
                          {exp.tax ? <span className="text-[10px] text-slate-400">شامل الضريبة: {maskMoney(exp.tax)}</span> : null}
                        </div>

                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setViewingExpenseDetail(exp)}
                            className="px-2.5 py-1.5 text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-xl transition cursor-pointer flex items-center gap-1"
                            title="عرض تفاصيل الفاتورة الكاملة"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>تفاصيل</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleOpenEditExpense(exp)}
                            className="p-1.5 text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition cursor-pointer"
                            title="تعديل"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDeleteExpenseConfirmed(exp)}
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer"
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
      {activeTab === 'analytics' && (
        <SupplierAnalyticsView expenses={expenses} materialUsages={materialUsages} onAddMaterialUsage={onAddMaterialUsage} onDeleteMaterialUsage={onDeleteMaterialUsage} isPrivacyMode={isPrivacyMode} />
      )}

      {/* Add / Edit Expense Modal */}
      {isExpenseModalOpen && (
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
                <select value={expenseType} onChange={e => setExpenseType(e.target.value as NonNullable<Expense['expenseType']>)} className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold">
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
                    value={expenseAmount}
                    onChange={e => setExpenseAmount(e.target.value === '' ? '' : parseFloat(e.target.value))}
                    placeholder="0"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono font-bold focus:outline-none focus:border-[#0f3d3e]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    تاريخ الصرف
                  </label>
                  <input
                    type="date"
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
                  يمكنك التقاط صورة الفاتورة فوراً بالهاتف أو رفعها بدلاً من كتابة كل أسماء الخامات والأسعار تفصيلياً.
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
                      accept="image/*"
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
      {activeInvoiceLightbox && (
        <div 
          onClick={() => setActiveInvoiceLightbox(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-4 animate-fadeIn"
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
                  المبلغ: <span className="font-mono text-emerald-300 font-bold">{activeInvoiceLightbox.amount.toLocaleString()} ج.م</span> | التاريخ: <span className="font-mono text-slate-300">{activeInvoiceLightbox.date}</span>
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
      <InvoiceOcrModal
        isOpen={isOcrModalOpen}
        onClose={() => setIsOcrModalOpen(false)}
        existingExpenses={expenses}
        onSaveExpense={(newExp) => {
          if (onSaveExpense) {
            onSaveExpense(newExp);
          } else {
            onAddExpense(newExp);
          }
          showToast('تم تسجيل الفاتورة وبنودها بنجاح 🧾', 'success');
        }}
      />

      {/* ERP Expense Detail Modal */}
      <ExpenseDetailModal
        isOpen={Boolean(viewingExpenseDetail)}
        expense={viewingExpenseDetail}
        onClose={() => setViewingExpenseDetail(null)}
        isPrivacyMode={isPrivacyMode}
        onEdit={(exp) => {
          setViewingExpenseDetail(null);
          handleOpenEditExpense(exp);
        }}
      />
    </div>
  );
});

SummaryView.displayName = 'SummaryView';

