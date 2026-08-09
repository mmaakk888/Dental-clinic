import React, { useState, useMemo } from 'react';
import { Microscope, ArrowRight, Plus, Phone, MapPin, DollarSign, Edit3, Trash2, CheckCircle, Search, TrendingUp, ChevronLeft, AlertCircle, Clock, CheckCircle2, Truck, AlertTriangle, Filter } from 'lucide-react';
import { Lab, LabCase, Patient, LabService } from '../../types';
import { useToastAndConfirm } from '../common/ToastAndConfirm';
import { EmptyState } from '../common/EmptyState';
import { BalanceProgressMeter, CompactBalanceBadge, VisualFinancialCard } from '../common/FinancialBadge';

interface LabViewProps {
  labs: Lab[];
  labCases: LabCase[];
  patients: Patient[];
  crownPrices: Record<string, number>;
  onSaveLab: (lab: Omit<Lab, 'id'> & { id?: string }) => void;
  onDeleteLab: (labId: string) => void;
  onSaveLabCase: (caseData: Omit<LabCase, 'id'>) => void;
  onUpdateLabCase?: (updatedCase: LabCase) => void;
  onAddLabCasePayment: (caseId: string, amount: number) => void;
  onSaveCrownPrices: (prices: Record<string, number>) => void;
  onBackToHome: () => void;
}

export const LabView: React.FC<LabViewProps> = ({
  labs,
  labCases,
  patients,
  crownPrices,
  onSaveLab,
  onDeleteLab,
  onSaveLabCase,
  onUpdateLabCase,
  onAddLabCasePayment,
  onSaveCrownPrices,
  onBackToHome
}) => {
  const { showToast, askConfirm, validationFail } = useToastAndConfirm();

  const [activeTab, setActiveTab] = useState<'labs' | 'all-cases'>('labs');
  const [selectedLabId, setSelectedLabId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'ready' | 'delivered' | 'delayed' | 'paid' | 'unpaid'>('all');
  const [labFilter, setLabFilter] = useState<string>('all');

  // Modals
  const [isLabModalOpen, setIsLabModalOpen] = useState(false);
  const [isCaseModalOpen, setIsCaseModalOpen] = useState(false);
  const [isCrownPricingModalOpen, setIsCrownPricingModalOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);

  React.useEffect(() => {
    const isAnyModalOpen = isLabModalOpen || isCaseModalOpen || isCrownPricingModalOpen || isPaymentModalOpen;
    if (isAnyModalOpen) {
      document.body.classList.add('modal-open');
    } else {
      document.body.classList.remove('modal-open');
    }
    return () => {
      document.body.classList.remove('modal-open');
    };
  }, [isLabModalOpen, isCaseModalOpen, isCrownPricingModalOpen, isPaymentModalOpen]);
  
  const [editingLab, setEditingLab] = useState<Lab | null>(null);
  const [selectedCaseForPayment, setSelectedCaseForPayment] = useState<LabCase | null>(null);

  // Form States for Lab
  const [labName, setLabName] = useState('');
  const [labPhone, setLabPhone] = useState('');
  const [labAddress, setLabAddress] = useState('');
  const [labNotes, setLabNotes] = useState('');
  const [labServices, setLabServices] = useState<LabService[]>([]);

  // Form State for Lab Case
  const [casePatientId, setCasePatientId] = useState('');
  const [caseServiceId, setCaseServiceId] = useState('');
  const [caseUnits, setCaseUnits] = useState<number>(1);
  const [caseDeliveryDate, setCaseDeliveryDate] = useState<string>('');
  const [caseNote, setCaseNote] = useState('');

  const todayStr = new Date().toISOString().split('T')[0];

  const getCaseStatusInfo = (c: LabCase) => {
    const isDelayed = c.status !== 'delivered' && c.status !== 'completed' && c.deliveryExpectedDate && c.deliveryExpectedDate < todayStr;
    const activeStatus = isDelayed ? 'delayed' : c.status;

    if (activeStatus === 'delivered' || activeStatus === 'completed') {
      return { key: 'delivered', label: 'تم التسليم', color: 'bg-emerald-100 text-emerald-800 border-emerald-300', dot: '🟢' };
    }
    if (activeStatus === 'ready') {
      return { key: 'ready', label: 'جاهز للاستلام', color: 'bg-blue-100 text-blue-800 border-blue-300', dot: '🔵' };
    }
    if (activeStatus === 'delayed') {
      return { key: 'delayed', label: 'متأخر عن الموعد', color: 'bg-rose-100 text-rose-800 border-rose-300 animate-pulse', dot: '🔴' };
    }
    return { key: 'pending', label: 'قيد التنفيذ', color: 'bg-amber-100 text-amber-800 border-amber-300', dot: '🟠' };
  };

  const handleUpdateStatus = (c: LabCase, newStatus: LabCase['status']) => {
    if (onUpdateLabCase) {
      onUpdateLabCase({ ...c, status: newStatus });
      showToast(`تم تحديث حالة التركيبة إلى (${newStatus === 'delivered' ? 'تم التسليم' : newStatus === 'ready' ? 'جاهز للاستلام' : 'قيد التنفيذ'})`, 'success');
    }
  };

  // Form State for Crown Pricing
  const [tempCrownPrices, setTempCrownPrices] = useState<Record<string, number>>({ ...crownPrices });

  // Payment Form State
  const [paymentAmount, setPaymentAmount] = useState<number | ''>('');

  const selectedLab = labs.find(l => l.id === selectedLabId);

  const handleOpenAddLabModal = () => {
    setEditingLab(null);
    setLabName('');
    setLabPhone('');
    setLabAddress('');
    setLabNotes('');
    setLabServices([
      { id: 'ls1', category: 'fixed', name: 'PFM', unitLabel: 'طربوش', price: 400 },
      { id: 'ls2', category: 'fixed', name: 'زيركون', unitLabel: 'طربوش', price: 750 }
    ]);
    setIsLabModalOpen(true);
  };

  const handleOpenEditLabModal = (lab: Lab) => {
    setEditingLab(lab);
    setLabName(lab.name);
    setLabPhone(lab.phone || '');
    setLabAddress(lab.address || '');
    setLabNotes(lab.notes || '');
    setLabServices([...lab.services]);
    setIsLabModalOpen(true);
  };

  const handleSaveLabForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!labName.trim()) {
      validationFail('labModal', 'input-lab-name', 'يرجى كتابة اسم المعمل');
      return;
    }

    onSaveLab({
      id: editingLab ? editingLab.id : undefined,
      name: labName.trim(),
      phone: labPhone.trim(),
      address: labAddress.trim(),
      notes: labNotes.trim(),
      services: labServices
    });

    setIsLabModalOpen(false);
    showToast(editingLab ? 'تم تعديل بيانات المعمل بنجاح' : 'تم إضافة المعمل الجديد بنجاح', 'success');
  };

  const handleDeleteLabConfirmed = (lab: Lab) => {
    askConfirm({
      title: 'حذف المعمل',
      message: `هل أنت تأكد من حذف المعمل (${lab.name}) وكافة الخدمات المسجلة لديه؟`,
      confirmLabel: 'حذف المعمل',
      tone: 'danger',
      onConfirm: () => {
        onDeleteLab(lab.id);
        if (selectedLabId === lab.id) setSelectedLabId(null);
        showToast('تم حذف المعمل بنجاح', 'warning');
      }
    });
  };

  const handleOpenAddCaseModal = () => {
    if (!selectedLab) return;
    setCasePatientId(patients[0]?.id || '');
    setCaseServiceId(selectedLab.services[0]?.id || '');
    setCaseUnits(1);
    const inAWeek = new Date();
    inAWeek.setDate(inAWeek.getDate() + 7);
    setCaseDeliveryDate(inAWeek.toISOString().split('T')[0]);
    setCaseNote('');
    setIsCaseModalOpen(true);
  };

  const handleSaveLabCase = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLab) return;

    const targetPatient = patients.find(p => p.id === casePatientId);
    if (!targetPatient) {
      validationFail('caseModal', 'select-case-patient', 'يرجى اختيار المريض');
      return;
    }

    const targetService = selectedLab.services.find(s => s.id === caseServiceId);
    if (!targetService) {
      validationFail('caseModal', 'select-case-service', 'يرجى اختيار خدمة المعمل');
      return;
    }

    const labTotal = targetService.price * caseUnits;
    const patientUnitPrice = crownPrices[targetService.name] || 2200;
    const patientTotal = patientUnitPrice * caseUnits;

    onSaveLabCase({
      labId: selectedLab.id,
      labName: selectedLab.name,
      patientId: targetPatient.id,
      patientName: targetPatient.name,
      fileNo: targetPatient.id,
      type: targetService.category === 'fixed' ? 'تركيبات - ثابتة' : 'تركيبات - أخرى',
      subType: targetService.name,
      units: caseUnits,
      unitLabel: targetService.unitLabel,
      labTotal,
      labPaid: 0,
      patientTotal,
      patientPaid: 0,
      date: new Date().toISOString().split('T')[0],
      deliveryExpectedDate: caseDeliveryDate || undefined,
      note: caseNote.trim(),
      status: 'pending'
    });

    setIsCaseModalOpen(false);
    showToast('تم إضافة حالة المعمل بنجاح', 'success');
  };

  const handleSaveLabPayment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCaseForPayment) return;

    const amt = typeof paymentAmount === 'number' ? paymentAmount : 0;
    if (amt <= 0) {
      validationFail('labPaymentModal', 'input-lab-payment', 'يرجى إدخال مبلغ دفع صحيح للمعمل');
      return;
    }

    onAddLabCasePayment(selectedCaseForPayment.id, amt);
    setIsPaymentModalOpen(false);
    showToast('تم تسديد الدفعة للمعمل بنجاح', 'success');
  };

  const handleSaveCrownPricesForm = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveCrownPrices(tempCrownPrices);
    setIsCrownPricingModalOpen(false);
    showToast('تم تحديث أسعار بيع التركيبات للمرضى بنجاح', 'success');
  };

  // Lab Cases for selected lab
  const currentLabCases = selectedLab
    ? labCases.filter(c => c.labId === selectedLab.id)
    : [];

  const currentLabTotal = currentLabCases.reduce((acc, c) => acc + c.labTotal, 0);
  const currentLabPaid = currentLabCases.reduce((acc, c) => acc + c.labPaid, 0);
  const currentLabRemain = currentLabTotal - currentLabPaid;

  // Filtered Lab Cases
  const filteredCases = useMemo(() => {
    return labCases.filter(c => {
      // Filter by selected lab if in dedicated view
      if (selectedLabId && c.labId !== selectedLabId) return false;

      // Filter by lab dropdown
      if (labFilter !== 'all' && c.labId !== labFilter) return false;

      // Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const match =
          c.patientName.toLowerCase().includes(q) ||
          c.fileNo.includes(q) ||
          c.labName.toLowerCase().includes(q) ||
          c.subType.toLowerCase().includes(q);
        if (!match) return false;
      }

      // Status Filter
      const isDelayed = c.status !== 'delivered' && c.status !== 'completed' && c.deliveryExpectedDate && c.deliveryExpectedDate < todayStr;
      const activeStatus = isDelayed ? 'delayed' : c.status;
      const isPaid = c.labPaid >= c.labTotal;

      if (statusFilter === 'pending' && activeStatus !== 'pending') return false;
      if (statusFilter === 'ready' && activeStatus !== 'ready') return false;
      if (statusFilter === 'delivered' && activeStatus !== 'delivered' && activeStatus !== 'completed') return false;
      if (statusFilter === 'delayed' && !isDelayed) return false;
      if (statusFilter === 'paid' && !isPaid) return false;
      if (statusFilter === 'unpaid' && isPaid) return false;

      return true;
    });
  }, [labCases, selectedLabId, labFilter, searchQuery, statusFilter, todayStr]);

  const totalNetProfit = labCases.reduce((acc, c) => acc + (c.patientTotal - c.labTotal), 0);

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
              حسابات التركيبات
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              متابعة التكاليف، المستحقات وأرباح التركيبات
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setTempCrownPrices({ ...crownPrices });
              setIsCrownPricingModalOpen(true);
            }}
            className="px-3.5 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-900 text-xs font-bold border border-amber-200/60 transition-colors cursor-pointer"
          >
            ⚙️ تسعير البيع للمريض
          </button>

          <button
            type="button"
            onClick={handleOpenAddLabModal}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-xs cursor-pointer"
          >
            <Plus className="w-4 h-4 text-white" />
            إضافة معمل جديد
          </button>
        </div>
      </div>

      {/* View Selection Tabs */}
      {!selectedLabId && (
        <div className="flex items-center gap-2 border-b border-slate-200 pb-1">
          <button
            onClick={() => setActiveTab('labs')}
            className={`px-5 py-2.5 rounded-xl font-tajawal font-bold text-xs sm:text-sm transition-all cursor-pointer ${
              activeTab === 'labs'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            قائمة المعامل المسجلة ({labs.length})
          </button>

          <button
            onClick={() => setActiveTab('all-cases')}
            className={`px-5 py-2.5 rounded-xl font-tajawal font-bold text-xs sm:text-sm transition-all cursor-pointer ${
              activeTab === 'all-cases'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            جميع حالات التركيبات والأرباح ({labCases.length})
          </button>
        </div>
      )}

      {/* DEDICATED LAB PAGE (Section 8) */}
      {selectedLabId && selectedLab ? (
        <div className="space-y-6 animate-fadeIn">
          {/* Dedicated Lab Header */}
          <div className="bg-white rounded-3xl p-6 border border-slate-200/90 shadow-md space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <button
                onClick={() => setSelectedLabId(null)}
                className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold transition-colors cursor-pointer"
              >
                <ArrowRight className="w-4 h-4" />
                رجوع لقائمة المعامل
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleOpenEditLabModal(selectedLab)}
                  className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer"
                  title="تعديل بيانات المعمل والخدمات"
                >
                  <Edit3 className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteLabConfirmed(selectedLab)}
                  className="p-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 transition-colors cursor-pointer"
                  title="حذف المعمل"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
              <div className="space-y-1">
                <h1 className="text-2xl font-extrabold text-[#0f3d3e] font-tajawal flex items-center gap-2">
                  <Microscope className="w-6 h-6 text-[#c9a227]" />
                  {selectedLab.name}
                </h1>
                <div className="flex items-center gap-4 text-xs text-slate-600 flex-wrap pt-1">
                  {selectedLab.phone && <span className="font-mono dir-ltr">📞 {selectedLab.phone}</span>}
                  {selectedLab.address && <span>📍 {selectedLab.address}</span>}
                </div>
              </div>

              <button
                type="button"
                onClick={handleOpenAddCaseModal}
                className="px-5 py-2.5 rounded-xl bg-[#0f3d3e] hover:bg-[#1b5e5a] text-white text-xs font-bold shadow-md transition-all cursor-pointer"
              >
                + إضافة حالة لهذا المعمل
              </button>
            </div>

            {/* Financial Stats Bar with Visual Progress Meter for this Lab */}
            <div className="pt-2">
              <BalanceProgressMeter
                total={currentLabTotal}
                paid={currentLabPaid}
                remaining={currentLabRemain}
                label="الموقف المالي الكلي لهذا المعمل"
                size="lg"
                type="lab"
              />
            </div>
          </div>

          {/* Lab Services Catalog */}
          <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-3">
            <h3 className="text-sm font-bold text-[#0f3d3e] font-tajawal">
              كتالوج خدمات وأسعار المعمل المعتمدة
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              {selectedLab.services.map(s => (
                <div key={s.id} className="p-3 bg-[#f7f5ef] rounded-xl border border-slate-200">
                  <span className="font-bold text-slate-800 block">{s.name}</span>
                  <span className="text-slate-500 block text-[11px] mt-0.5">{s.unitLabel} — {s.price} ج.م</span>
                </div>
              ))}
            </div>
          </div>

          {/* Lab Cases List */}
          <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-4">
            <h3 className="text-base font-bold text-slate-800 font-tajawal">
              حالات المعمل الحالية ({currentLabCases.length})
            </h3>

            {currentLabCases.length === 0 ? (
              <p className="text-xs text-slate-500 italic py-4">لا توجد حالات مسجلة لهذا المعمل بعد.</p>
            ) : (
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-2xl overflow-hidden">
                {currentLabCases.map(c => {
                  const isPaid = c.labPaid >= c.labTotal;
                  const remain = c.labTotal - c.labPaid;

                  return (
                    <div key={c.id} className="p-4 bg-white flex flex-col md:flex-row md:items-center justify-between gap-4 text-xs">
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono font-bold bg-slate-100 text-[#0f3d3e] px-2 py-0.5 rounded-md">
                            #{c.fileNo}
                          </span>
                          <span className="font-bold text-slate-900 text-sm">{c.patientName}</span>
                          <span className="text-[11px] bg-amber-100 text-amber-900 px-2 py-0.5 rounded-md font-bold">
                            {c.subType} ({c.units} {c.unitLabel})
                          </span>
                        </div>
                        <p className="text-slate-500 text-[11px]">تاريخ الطلب: {c.date} {c.note && `• ${c.note}`}</p>
                      </div>

                      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between md:justify-end gap-4">
                        {/* Compact Balance Progress Bar */}
                        <div className="w-full sm:w-64">
                          <BalanceProgressMeter
                            total={c.labTotal}
                            paid={c.labPaid}
                            remaining={remain}
                            size="sm"
                            type="lab"
                          />
                        </div>

                        {remain > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedCaseForPayment(c);
                              setPaymentAmount(remain);
                              setIsPaymentModalOpen(true);
                            }}
                            className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold cursor-pointer transition-all shadow-xs shrink-0 flex items-center gap-1"
                          >
                            <span>+ تسديد للمعمل</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : activeTab === 'labs' ? (
        /* LAB CARDS VIEW WITH VISUAL BALANCE METERS */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {labs.map(lab => {
            const cases = labCases.filter(c => c.labId === lab.id);
            const total = cases.reduce((acc, c) => acc + c.labTotal, 0);
            const paid = cases.reduce((acc, c) => acc + c.labPaid, 0);
            const remain = total - paid;
            const paidPercent = total > 0 ? Math.round((paid / total) * 100) : 100;

            return (
              <div
                key={lab.id}
                onClick={() => setSelectedLabId(lab.id)}
                className="group bg-white rounded-3xl p-6 border border-slate-200/90 shadow-sm hover:shadow-xl hover:border-[#c9a227]/50 transition-all duration-300 text-right flex flex-col justify-between min-h-72 cursor-pointer relative overflow-hidden transform hover:-translate-y-1 space-y-4"
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="w-12 h-12 rounded-2xl bg-[#e4ede9] text-[#0f3d3e] flex items-center justify-center font-bold shadow-inner">
                      <Microscope className="w-6 h-6 text-[#0f3d3e]" />
                    </div>
                    <CompactBalanceBadge remaining={remain} total={total} />
                  </div>

                  <div>
                    <h3 className="text-xl font-bold text-[#0f3d3e] group-hover:text-[#1b5e5a] font-tajawal transition-colors">
                      {lab.name}
                    </h3>
                    <p className="text-xs text-slate-500 mt-1 line-clamp-1">
                      {lab.phone || lab.address || `${cases.length} حالة تركيبات مسجلة`}
                    </p>
                  </div>
                </div>

                {/* Embedded Visual Progress Meter */}
                <div className="space-y-2 bg-slate-50 p-3 rounded-2xl border border-slate-100">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-slate-500 font-sans text-[11px]">نسبة التسديد للمعمل:</span>
                    <span className="font-bold text-slate-800">{paidPercent}%</span>
                  </div>
                  <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden flex">
                    <div
                      className={`h-full transition-all duration-500 ${remain <= 0 ? 'bg-emerald-500' : 'bg-amber-500'}`}
                      style={{ width: `${paidPercent}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] font-mono pt-0.5">
                    <span className="text-slate-600">المطلوب: {total.toLocaleString()}</span>
                    <span className={remain > 0 ? 'text-rose-700 font-bold' : 'text-emerald-700 font-bold'}>
                      {remain > 0 ? `متبقي: ${remain.toLocaleString()}` : 'خالص السداد'}
                    </span>
                  </div>
                </div>

                <div className="pt-2 flex items-center justify-between text-xs font-bold text-[#0f3d3e] group-hover:text-[#c9a227]">
                  <span>عرض كشف المعمل والتفاصيل</span>
                  <ChevronLeft className="w-4 h-4 transform group-hover:-translate-x-1 transition-transform" />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* ALL LAB CASES TAB WITH PROFIT CALCULATION & FILTERS */
        <div className="space-y-5 animate-fadeIn">
          {/* Net Profit Visual Financial Card */}
          <VisualFinancialCard
            title="صافي أرباح التركيبات الكلي"
            subtitle="تحصيل المريض الإجمالي − تكلفة المعمل المباشرة"
            amount={totalNetProfit}
            icon={<TrendingUp className="w-6 h-6 text-[#c9a227]" />}
            gradient="teal"
            footerInfo={`إجمالي عدد حالات التركيبات المسجلة: ${labCases.length} حالة`}
          />

          {/* Search & Lab Filter Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2 relative">
              <Search className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="ابحث باسم المريض، رقم الملف، نوع التركيبة، أو اسم المعمل..."
                className="w-full pl-4 pr-12 py-3 bg-white border border-slate-200 rounded-2xl text-sm focus:outline-none focus:border-indigo-600 shadow-xs"
              />
            </div>

            <div>
              <select
                value={labFilter}
                onChange={e => setLabFilter(e.target.value)}
                className="w-full px-4 py-3 bg-white border border-slate-200 rounded-2xl text-xs font-bold text-slate-800 focus:outline-none focus:border-indigo-600 shadow-xs cursor-pointer"
              >
                <option value="all">جميع المعامل المسجلة ({labs.length})</option>
                {labs.map(l => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Status Filter Badges */}
          <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none text-xs">
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-3.5 py-2 rounded-xl font-bold whitespace-nowrap cursor-pointer transition-all ${
                statusFilter === 'all'
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              الكل ({labCases.length})
            </button>

            <button
              onClick={() => setStatusFilter('pending')}
              className={`px-3.5 py-2 rounded-xl font-bold whitespace-nowrap cursor-pointer transition-all flex items-center gap-1.5 ${
                statusFilter === 'pending'
                  ? 'bg-amber-600 text-white shadow-xs'
                  : 'bg-amber-50 text-amber-900 border border-amber-200 hover:bg-amber-100'
              }`}
            >
              <span>🟠</span>
              <span>قيد التنفيذ</span>
            </button>

            <button
              onClick={() => setStatusFilter('ready')}
              className={`px-3.5 py-2 rounded-xl font-bold whitespace-nowrap cursor-pointer transition-all flex items-center gap-1.5 ${
                statusFilter === 'ready'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-blue-50 text-blue-900 border border-blue-200 hover:bg-blue-100'
              }`}
            >
              <span>🔵</span>
              <span>جاهز للاستلام</span>
            </button>

            <button
              onClick={() => setStatusFilter('delivered')}
              className={`px-3.5 py-2 rounded-xl font-bold whitespace-nowrap cursor-pointer transition-all flex items-center gap-1.5 ${
                statusFilter === 'delivered'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'bg-emerald-50 text-emerald-900 border border-emerald-200 hover:bg-emerald-100'
              }`}
            >
              <span>🟢</span>
              <span>تم التسليم</span>
            </button>

            <button
              onClick={() => setStatusFilter('delayed')}
              className={`px-3.5 py-2 rounded-xl font-bold whitespace-nowrap cursor-pointer transition-all flex items-center gap-1.5 ${
                statusFilter === 'delayed'
                  ? 'bg-rose-600 text-white shadow-xs'
                  : 'bg-rose-50 text-rose-900 border border-rose-200 hover:bg-rose-100'
              }`}
            >
              <span>🔴</span>
              <span>متأخر عن الموعد</span>
            </button>

            <button
              onClick={() => setStatusFilter('paid')}
              className={`px-3.5 py-2 rounded-xl font-bold whitespace-nowrap cursor-pointer transition-all ${
                statusFilter === 'paid'
                  ? 'bg-teal-700 text-white shadow-xs'
                  : 'bg-teal-50 text-teal-900 border border-teal-200 hover:bg-teal-100'
              }`}
            >
              🟢 مدفوع بالكامل
            </button>

            <button
              onClick={() => setStatusFilter('unpaid')}
              className={`px-3.5 py-2 rounded-xl font-bold whitespace-nowrap cursor-pointer transition-all ${
                statusFilter === 'unpaid'
                  ? 'bg-rose-700 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-800 border border-slate-300 hover:bg-slate-200'
              }`}
            >
              🔴 غير مدفوع / جزئي
            </button>
          </div>

          {/* Lab Cases List / Cards */}
          {filteredCases.length === 0 ? (
            <div className="bg-white rounded-2xl p-8 border border-slate-200 text-center space-y-2">
              <Microscope className="w-10 h-10 text-slate-300 mx-auto" />
              <p className="text-sm font-bold text-slate-700 font-tajawal">لا توجد حالات معمل تطابق التصفية الحالية</p>
              <p className="text-xs text-slate-500">جرّب تغيير التصفية أو البحث باسم آخر</p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredCases.map(c => {
                const statusInfo = getCaseStatusInfo(c);
                const remain = c.labTotal - c.labPaid;
                const isFullyPaid = c.labPaid >= c.labTotal;
                const isPartiallyPaid = c.labPaid > 0 && c.labPaid < c.labTotal;
                const profit = c.patientTotal - c.labTotal;

                return (
                  <div
                    key={c.id}
                    className="bg-white rounded-3xl p-5 border border-slate-200/90 shadow-sm hover:shadow-md transition-all space-y-4"
                  >
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-3 border-b border-slate-100">
                      {/* Patient & Work Info */}
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono font-bold bg-slate-100 text-slate-800 px-2.5 py-0.5 rounded-lg text-xs">
                            #{c.fileNo}
                          </span>
                          <span className="font-extrabold text-slate-900 text-base">{c.patientName}</span>
                          <span className="px-2.5 py-0.5 bg-indigo-50 text-indigo-900 border border-indigo-100 text-xs font-bold rounded-lg">
                            {c.subType} ({c.units} {c.unitLabel})
                          </span>
                          <span className="text-xs font-bold text-slate-600 bg-slate-50 px-2 py-0.5 rounded-md border border-slate-200">
                            🏢 {c.labName}
                          </span>
                        </div>

                        <div className="flex items-center gap-4 text-xs text-slate-500 flex-wrap pt-1 font-mono">
                          <span>📅 إرسال للمعمل: {c.date}</span>
                          {c.deliveryExpectedDate && (
                            <span className={statusInfo.key === 'delayed' ? 'text-rose-600 font-bold' : 'text-slate-600'}>
                              ⏱️ موعد الاستلام: {c.deliveryExpectedDate}
                            </span>
                          )}
                          {c.note && <span className="font-sans text-slate-600">📝 {c.note}</span>}
                        </div>
                      </div>

                      {/* Interactive Status Changer Badge */}
                      <div className="flex items-center gap-2 shrink-0">
                        <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-2xl border text-xs font-bold ${statusInfo.color}`}>
                          <span>{statusInfo.dot}</span>
                          <span>{statusInfo.label}</span>
                        </div>

                        <select
                          value={c.status}
                          onChange={e => handleUpdateStatus(c, e.target.value as LabCase['status'])}
                          className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 cursor-pointer focus:outline-none focus:border-indigo-600"
                          title="تغيير حالة التركيبة"
                        >
                          <option value="pending">🟠 قيد التنفيذ</option>
                          <option value="ready">🔵 جاهز للاستلام</option>
                          <option value="delivered">🟢 تم التسليم</option>
                        </select>
                      </div>
                    </div>

                    {/* Financial Summary & Meter for this Case */}
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
                      <div className="md:col-span-8">
                        <BalanceProgressMeter
                          total={c.labTotal}
                          paid={c.labPaid}
                          remaining={remain}
                          size="sm"
                          type="lab"
                        />
                      </div>

                      <div className="md:col-span-4 flex items-center justify-between md:justify-end gap-3 pt-2 md:pt-0 border-t md:border-t-0 border-slate-100">
                        {/* Financial Status Badge */}
                        <span className={`px-2.5 py-1 rounded-xl text-xs font-bold border ${
                          isFullyPaid
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : isPartiallyPaid
                            ? 'bg-amber-50 text-amber-800 border-amber-200'
                            : 'bg-rose-50 text-rose-800 border-rose-200'
                        }`}>
                          {isFullyPaid ? '🟢 مدفوع بالكامل' : isPartiallyPaid ? '🟡 مدفوع جزئياً' : '🔴 غير مدفوع'}
                        </span>

                        {remain > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedCaseForPayment(c);
                              setPaymentAmount(remain);
                              setIsPaymentModalOpen(true);
                            }}
                            className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs transition-all cursor-pointer flex items-center gap-1"
                          >
                            <span>+ تسديد للمعمل</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Modal: Add/Edit Lab */}
      {isLabModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-fadeIn">
          <div id="labModal" className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4 max-h-[90dvh] overflow-y-auto modal-scroll">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h2 className="text-base font-bold text-[#0f3d3e] font-tajawal">
                {editingLab ? 'تعديل بيانات المعمل' : 'إضافة معمل جديد'}
              </h2>
              <button onClick={() => setIsLabModalOpen(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveLabForm} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  اسم المعمل <span className="text-rose-500">*</span>
                </label>
                <input
                  id="input-lab-name"
                  type="text"
                  value={labName}
                  onChange={e => setLabName(e.target.value)}
                  placeholder="مثال: معمل الأمل للأسنان"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm focus:outline-none focus:border-[#0f3d3e]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    رقم الهاتف
                  </label>
                  <input
                    type="text"
                    value={labPhone}
                    onChange={e => setLabPhone(e.target.value)}
                    placeholder="01001122334"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-mono focus:outline-none focus:border-[#0f3d3e]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    العنوان
                  </label>
                  <input
                    type="text"
                    value={labAddress}
                    onChange={e => setLabAddress(e.target.value)}
                    placeholder="الدقي - القاهرة"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm focus:outline-none focus:border-[#0f3d3e]"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsLabModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 bg-slate-100 rounded-xl cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-[#0f3d3e] text-white text-xs font-bold shadow-md cursor-pointer"
                >
                  حفظ البيانات
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Add Case to Lab */}
      {isCaseModalOpen && selectedLab && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-fadeIn">
          <div id="caseModal" className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4 max-h-[90dvh] overflow-y-auto modal-scroll">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h2 className="text-base font-bold text-[#0f3d3e] font-tajawal">
                إضافة حالة جديدة لمعمل ({selectedLab.name})
              </h2>
              <button onClick={() => setIsCaseModalOpen(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveLabCase} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  اختر المريض
                </label>
                <select
                  id="select-case-patient"
                  value={casePatientId}
                  onChange={e => setCasePatientId(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-bold"
                >
                  {patients.map(p => (
                    <option key={p.id} value={p.id}>{p.name} (#{p.id})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  اختر الخدمة من معمل {selectedLab.name}
                </label>
                <select
                  id="select-case-service"
                  value={caseServiceId}
                  onChange={e => setCaseServiceId(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-bold"
                >
                  {selectedLab.services.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name} (تكلفة المعمل: {s.price} ج.م/{s.unitLabel})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  العدد / الوحدات
                </label>
                <input
                  type="number"
                  value={caseUnits}
                  onChange={e => setCaseUnits(parseInt(e.target.value, 10) || 1)}
                  min={1}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  تاريخ التسليم المتوقع من المعمل
                </label>
                <input
                  type="date"
                  value={caseDeliveryDate}
                  onChange={e => setCaseDeliveryDate(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  ملاحظات التركيبة
                </label>
                <input
                  type="text"
                  value={caseNote}
                  onChange={e => setCaseNote(e.target.value)}
                  placeholder="مثال: لون A2، جسر 3 قطع علوي يمين..."
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsCaseModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 bg-slate-100 rounded-xl cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-[#0f3d3e] text-white text-xs font-bold shadow-md cursor-pointer"
                >
                  تأكيد الإضافة
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Crown Pricing Settings */}
      {isCrownPricingModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-fadeIn">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4 max-h-[90dvh] overflow-y-auto modal-scroll">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h2 className="text-base font-bold text-[#0f3d3e] font-tajawal">
                تسعير بيع التركيبات للمرضى
              </h2>
              <button onClick={() => setIsCrownPricingModalOpen(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveCrownPricesForm} className="space-y-4">
              {Object.keys(tempCrownPrices).map(crownKey => (
                <div key={crownKey}>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    سعر طربوش ({crownKey}) للمريض (ج.م)
                  </label>
                  <input
                    type="number"
                    value={tempCrownPrices[crownKey]}
                    onChange={e => setTempCrownPrices({ ...tempCrownPrices, [crownKey]: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm font-mono"
                  />
                </div>
              ))}

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsCrownPricingModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 bg-slate-100 rounded-xl cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-[#0f3d3e] text-white text-xs font-bold shadow-md cursor-pointer"
                >
                  حفظ أسعار البيع
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Pay Lab */}
      {isPaymentModalOpen && selectedCaseForPayment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-fadeIn">
          <div id="labPaymentModal" className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4 max-h-[90dvh] overflow-y-auto modal-scroll">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h2 className="text-base font-bold text-[#0f3d3e] font-tajawal">
                تسديد دفعة للمعمل
              </h2>
              <button onClick={() => setIsPaymentModalOpen(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveLabPayment} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  المبلغ المسدد للمعمل (ج.م)
                </label>
                <input
                  id="input-lab-payment"
                  type="number"
                  value={paymentAmount}
                  onChange={e => setPaymentAmount(e.target.value === '' ? '' : parseFloat(e.target.value))}
                  placeholder="أكتب المبلغ"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-mono"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsPaymentModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 bg-slate-100 rounded-xl cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-md cursor-pointer"
                >
                  تأكيد الدفع
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
