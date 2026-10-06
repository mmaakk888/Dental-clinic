import React, { useState, useMemo } from 'react';
import { Microscope, ArrowRight, Plus, Phone, MapPin, DollarSign, Edit3, Trash2, CheckCircle, Search, TrendingUp, ChevronLeft, AlertCircle, Clock, CheckCircle2, Truck, AlertTriangle, Filter } from 'lucide-react';
import { Lab, LabCase, Patient } from '../../types';
import { useToastAndConfirm } from '../common/ToastAndConfirm';
import { EmptyState } from '../common/EmptyState';
import { allocateLabPayment, getLabCaseFinancials } from '../../utils/labFinancials';
import { BalanceProgressMeter, VisualFinancialCard } from '../common/FinancialBadge';
import { cloneLab } from '../../utils/labPricing';
import { useAppointmentDialog } from '../appointments/useAppointmentDialog';
import { useConfirmedAction } from '../common/useConfirmedAction';
import './labView.css';

interface LabViewProps {
  labs: Lab[];
  labCases: LabCase[];
  patients: Patient[];
  crownPrices: Record<string, number>;
  onSaveLab: (lab: Omit<Lab, 'id'> & { id?: string }, baseline?: Lab) => void | Promise<void>;
  onDeleteLab: (labId: string) => void | Promise<void>;
  onSaveLabCase: (caseData: Omit<LabCase, 'id'>) => void | Promise<void>;
  onUpdateLabCase?: (updatedCase: LabCase) => void | Promise<void>;
  onAddLabCasePayment: (caseId: string, amount: number) => void | Promise<void>;
  onManageLabPrices?: (labId?: string) => void;
  onBackToHome: () => void;
  canViewFinancials?: boolean;
  canManagePrices?: boolean;
  onBulkPayment: (labId: string, amount: number) => void | Promise<void>;
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
  onManageLabPrices,
  onBackToHome,
  canViewFinancials = false,
  canManagePrices = false,
  onBulkPayment
}) => {
  const { showToast, askConfirm, validationFail } = useToastAndConfirm();
  const { saving, run: confirmSave } = useConfirmedAction();

  const [activeTab, setActiveTab] = useState<'labs' | 'all-cases'>('labs');
  const [selectedLabId, setSelectedLabId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'ready' | 'delivered' | 'delayed' | 'paid' | 'unpaid'>('all');
  const [labFilter, setLabFilter] = useState<string>('all');
  const [bulkAmount, setBulkAmount] = useState('');
  const [caseSessionId, setCaseSessionId] = useState('');

  React.useEffect(() => { setBulkAmount(''); }, [selectedLabId]);
  React.useEffect(() => {
    if (!canViewFinancials && (statusFilter === 'paid' || statusFilter === 'unpaid')) setStatusFilter('all');
  }, [canViewFinancials, statusFilter]);

  // Modals
  const [isLabModalOpen, setIsLabModalOpen] = useState(false);
  const [isCaseModalOpen, setIsCaseModalOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);

  React.useEffect(() => {
    const isAnyModalOpen = isLabModalOpen || isCaseModalOpen || isPaymentModalOpen;
    if (isAnyModalOpen) {
      document.body.classList.add('modal-open');
    } else {
      document.body.classList.remove('modal-open');
    }
    return () => {
      document.body.classList.remove('modal-open');
    };
  }, [isLabModalOpen, isCaseModalOpen, isPaymentModalOpen]);
  
  const [editingLab, setEditingLab] = useState<Lab | null>(null);
  const [selectedCaseForPayment, setSelectedCaseForPayment] = useState<LabCase | null>(null);

  // Form States for Lab
  const [labName, setLabName] = useState('');
  const [labPhone, setLabPhone] = useState('');
  const [labAddress, setLabAddress] = useState('');
  const [labNotes, setLabNotes] = useState('');
  const [labFormError, setLabFormError] = useState('');
  const labDialogRef = useAppointmentDialog(isLabModalOpen, () => { if (!saving) setIsLabModalOpen(false); });
  const caseDialogRef = useAppointmentDialog(isCaseModalOpen, () => { if (!saving) setIsCaseModalOpen(false); });
  const paymentDialogRef = useAppointmentDialog(isPaymentModalOpen, () => { if (!saving) setIsPaymentModalOpen(false); });

  // Form State for Lab Case
  const [casePatientId, setCasePatientId] = useState('');
  const [caseServiceId, setCaseServiceId] = useState('');
  const [caseUnits, setCaseUnits] = useState<number | ''>(1);
  const [caseDeliveryDate, setCaseDeliveryDate] = useState<string>('');
  const [caseNote, setCaseNote] = useState('');

  const localDateKey = (value: Date = new Date()) => new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  const todayStr = localDateKey();

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
      return { key: 'delayed', label: 'متأخر عن الموعد', color: 'bg-rose-100 text-rose-800 border-rose-300', dot: '🔴' };
    }
    return { key: 'pending', label: 'قيد التنفيذ', color: 'bg-amber-100 text-amber-800 border-amber-300', dot: '🟠' };
  };

  const handleUpdateStatus = async (c: LabCase, newStatus: LabCase['status']) => {
    if (onUpdateLabCase) await confirmSave(() => onUpdateLabCase({ ...c, status: newStatus }), () => {
      showToast(`تم تحديث حالة التركيبة إلى (${newStatus === 'delivered' ? 'تم التسليم' : newStatus === 'ready' ? 'جاهز للاستلام' : 'قيد التنفيذ'})`, 'success');
    });
  };

  // Payment Form State
  const [paymentAmount, setPaymentAmount] = useState<number | ''>('');

  const selectedLab = labs.find(l => l.id === selectedLabId);

  const handleOpenAddLabModal = () => {
    setEditingLab(null);
    setLabName('');
    setLabPhone('');
    setLabAddress('');
    setLabNotes('');
    setLabFormError('');
    setIsLabModalOpen(true);
  };

  const handleOpenEditLabModal = (lab: Lab) => {
    setEditingLab(cloneLab(lab));
    setLabName(lab.name);
    setLabPhone(lab.phone || '');
    setLabAddress(lab.address || '');
    setLabNotes(lab.notes || '');
    setLabFormError('');
    setIsLabModalOpen(true);
  };

  const handleSaveLabForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canViewFinancials || saving) return;
    if (!labName.trim()) {
      setLabFormError('يرجى كتابة اسم المعمل.');
      document.getElementById('input-lab-name')?.focus();
      return;
    }
    await confirmSave(() => onSaveLab({
        id: editingLab?.id, name: labName.trim(), phone: labPhone.trim(),
        address: labAddress.trim(), notes: labNotes.trim(), services: editingLab?.services || []
      }, editingLab || undefined), () => {
      setIsLabModalOpen(false);
      showToast(editingLab ? 'تم حفظ بيانات المعمل بنجاح' : 'تم إضافة المعمل. حدّد خدماته وأسعاره من قسم أسعار المعامل.', 'success');
    });
  };

  const handleDeleteLabConfirmed = (lab: Lab) => {
    if (!canViewFinancials) return;
    if (labCases.some(item => item.labId === lab.id)) {
      showToast('لا يمكن حذف معمل له حالات مسجلة، للحفاظ على حساباته وسجل التركيبات', 'warning');
      return;
    }
    askConfirm({
      title: 'حذف المعمل',
      message: `هل أنت متأكد من حذف المعمل (${lab.name}) وخدماته المسجلة؟`,
      confirmLabel: 'حذف المعمل',
      tone: 'danger',
      onConfirm: async () => {
        await confirmSave(() => onDeleteLab(lab.id), () => {
          if (selectedLabId === lab.id) setSelectedLabId(null);
          showToast('تم حذف المعمل بنجاح', 'warning');
        });
      }
    });
  };

  const handleOpenAddCaseModal = () => {
    if (!selectedLab) return;
    if (!patients.length || !selectedLab.services.length) {
      showToast(!patients.length ? 'أضف ملف المريض أولًا قبل تسجيل حالة معمل' : 'حدّد خدمات المعمل وتكلفتها أولًا من قسم أسعار المعامل', 'warning');
      return;
    }
    setCaseSessionId('');
    setCasePatientId(patients[0]?.id || '');
    setCaseServiceId(selectedLab.services[0]?.id || '');
    setCaseUnits(1);
    const inAWeek = new Date();
    inAWeek.setDate(inAWeek.getDate() + 7);
    setCaseDeliveryDate(localDateKey(inAWeek));
    setCaseNote('');
    setIsCaseModalOpen(true);
  };

  const handleSaveLabCase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLab || saving) return;

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

    const units = typeof caseUnits === 'number' ? caseUnits : 0;
    if (!Number.isInteger(units) || units < 1) {
      showToast('أدخل عدد وحدات صحيحًا أكبر من صفر', 'warning');
      return;
    }
    if (!Number.isFinite(targetService.price) || targetService.price < 0) {
      showToast('تكلفة خدمة المعمل غير صحيحة، راجع أسعار المعمل', 'warning');
      return;
    }
    const labTotal = targetService.price * units;
    if (caseSessionId && labCases.some(c => c.patientId === targetPatient.id && c.linkedSessionId === caseSessionId)) {
      showToast('هذه الخدمة مرتبطة بالفعل بطلب معمل', 'warning');
      return;
    }
    const linkedSession = targetPatient.sessions.find(session => session.id === caseSessionId);
    if (caseSessionId && !linkedSession) {
      showToast('الخدمة المحددة غير موجودة في ملف المريض، اختر الخدمة مرة أخرى', 'warning');
      return;
    }
    const patientUnitPrice = crownPrices[targetService.name] ?? 0;
    const patientTotal = linkedSession ? Math.max(0, linkedSession.amount - (linkedSession.discount || 0)) : patientUnitPrice * units;
    if (!Number.isFinite(labTotal) || !Number.isFinite(patientTotal) || patientTotal < 0) {
      showToast('راجع أسعار الخدمة وعدد الوحدات قبل الحفظ', 'warning');
      return;
    }
    if (caseDeliveryDate && caseDeliveryDate < todayStr) {
      showToast('تاريخ الاستلام المتوقع يجب ألا يسبق تاريخ الطلب', 'warning');
      return;
    }

    await confirmSave(() => onSaveLabCase({
      linkedSessionId: caseSessionId || undefined,
      labId: selectedLab.id,
      labName: selectedLab.name,
      patientId: targetPatient.id,
      patientName: targetPatient.name,
      fileNo: targetPatient.id,
      type: targetService.category === 'fixed' ? 'تركيبات - ثابتة' : 'تركيبات - أخرى',
      subType: targetService.name,
      units,
      unitLabel: targetService.unitLabel,
      labTotal,
      labPaid: 0,
      patientTotal,
      patientPaid: 0,
      date: todayStr,
      deliveryExpectedDate: caseDeliveryDate || undefined,
      note: caseNote.trim(),
      status: 'pending'
    }), () => {
      setIsCaseModalOpen(false);
      showToast('تم إضافة حالة المعمل بنجاح', 'success');
    });
  };

  const handleSaveLabPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canViewFinancials || saving) return;
    if (!selectedCaseForPayment) return;

    const amt = typeof paymentAmount === 'number' ? paymentAmount : 0;
    if (!Number.isFinite(amt) || amt <= 0) {
      validationFail('labPaymentModal', 'input-lab-payment', 'يرجى إدخال مبلغ دفع صحيح للمعمل');
      return;
    }

    const currentCase = labCases.find(item => item.id === selectedCaseForPayment.id);
    if (!currentCase || amt > Math.max(0, currentCase.labTotal - currentCase.labPaid)) {
      showToast('المبلغ أكبر من المتبقي للمعمل أو غير صحيح', 'warning');
      return;
    }

    await confirmSave(() => onAddLabCasePayment(selectedCaseForPayment.id, amt), () => {
      setIsPaymentModalOpen(false);
      showToast('تم تسديد الدفعة للمعمل بنجاح', 'success');
    });
  };

  // Lab Cases for selected lab
  const currentLabCases = selectedLab
    ? labCases.filter(c => c.labId === selectedLab.id)
    : [];

  const currentLabTotal = currentLabCases.reduce((acc, c) => acc + c.labTotal, 0);
  const currentLabPaid = currentLabCases.reduce((acc, c) => acc + c.labPaid, 0);
  const currentLabRemain = currentLabCases.reduce((sum, item) => sum + Math.max(0, item.labTotal - item.labPaid), 0);

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

  const totalNetProfit = labCases.reduce((acc, c) => acc + getLabCaseFinancials(c, patients).collected - c.labTotal, 0);

  const renderReservation = (item: LabCase) => {
    if (!canViewFinancials) return null;
    const financial = getLabCaseFinancials(item, patients);
    const patient = patients.find(p => p.id === item.patientId);
    return <details className="lab-reservation w-full rounded-xl border border-teal-200 bg-teal-50 text-xs"><summary>التحصيل والمحجوز لهذه الحالة</summary><div className="p-3 pt-0 space-y-2">
      <label className="block font-bold">الخدمة المرتبطة بحساب المريض</label>
      <select className="w-full min-h-11 rounded-lg border border-slate-200 bg-white px-2" value={item.linkedSessionId || ''}
        disabled={!onUpdateLabCase || saving}
        onChange={e => {
          const nextId = e.target.value || undefined;
          void confirmSave(() => onUpdateLabCase?.({ ...item, linkedSessionId: nextId }));
        }}>
        <option value="">اختر الخدمة لحساب المحجوز</option>
        {(patient?.sessions || []).filter(s => s.id === item.linkedSessionId || !labCases.some(c => c.patientId === item.patientId && c.linkedSessionId === s.id)).map(s =>
          <option key={s.id} value={s.id}>{s.type} — {s.date} — {s.toothLabel || 'عام'}</option>)}
      </select>
      {financial.linked ? <div className="grid grid-cols-2 gap-2">
        <span>المحصل للخدمة: <strong>{financial.collected.toLocaleString()} ج.م</strong></span>
        <span>محجوز للمعمل: <strong>{financial.reserved.toLocaleString()} ج.م</strong></span>
        <span>متبقي للمعمل: <strong>{financial.remaining.toLocaleString()} ج.م</strong></span>
        <span>المتاح بعد تكلفة المعمل: <strong>{financial.availableToClinic.toLocaleString()} ج.م</strong></span>
      </div> : <p className="text-amber-800">لم تُربط الخدمة بعد؛ لا يُحسب مبلغ محجوز لهذه الحالة.</p>}
    </div></details>;
  };

  let bulkAllocations: ReturnType<typeof allocateLabPayment> = [];
  if (selectedLabId && Number(bulkAmount) > 0) {
    try { bulkAllocations = allocateLabPayment(labCases, selectedLabId, Number(bulkAmount)); } catch { /* Inline validation below. */ }
  }

  return (
    <div aria-busy={saving} className="lab-view space-y-4 max-w-7xl mx-auto py-2">
      {saving && <p role="status" className="rounded-xl bg-teal-50 p-3 text-sm text-teal-900">جارٍ تأكيد الحفظ…</p>}
      {/* View Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
        <div className="flex items-center gap-3">
          <button
            onClick={onBackToHome}
            className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer"
            title="رجوع للشاشة الرئيسية" aria-label="رجوع للشاشة الرئيسية"
          >
            <ArrowRight className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-slate-900 font-tajawal tracking-tight">
              حسابات التركيبات
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              {canViewFinancials ? 'متابعة التكاليف، المستحقات وأرباح التركيبات' : 'متابعة حالات التركيبات ومواعيد التسليم'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {canManagePrices && canViewFinancials && onManageLabPrices && <button
            type="button" onClick={() => onManageLabPrices(selectedLabId || undefined)}
            className="lab-pricing-shortcut"
          ><DollarSign className="h-4 w-4" /> أسعار المعامل</button>}

          {canViewFinancials && <button
            type="button"
            onClick={handleOpenAddLabModal}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-xs cursor-pointer"
          >
            <Plus className="w-4 h-4 text-white" />
            إضافة معمل جديد
          </button>}
        </div>
      </div>

      {/* View Selection Tabs */}
      {!selectedLabId && (
        <div className="lab-section-tabs">
          <button
            aria-pressed={activeTab === 'labs'} onClick={() => setActiveTab('labs')}
            className={`px-5 py-2.5 rounded-xl font-tajawal font-bold text-xs sm:text-sm transition-all cursor-pointer ${
              activeTab === 'labs'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            المعامل ({labs.length})
          </button>

          <button
            aria-pressed={activeTab === 'all-cases'} onClick={() => setActiveTab('all-cases')}
            className={`px-5 py-2.5 rounded-xl font-tajawal font-bold text-xs sm:text-sm transition-all cursor-pointer ${
              activeTab === 'all-cases'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            حالات التركيبات ({labCases.length})
          </button>
        </div>
      )}

      {/* DEDICATED LAB PAGE (Section 8) */}
      {selectedLabId && selectedLab ? (
        <div className="space-y-6 animate-fadeIn">
          {/* Dedicated Lab Header */}
          <div className="bg-white rounded-2xl p-4 border border-slate-200/90 shadow-xs space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <button
                onClick={() => setSelectedLabId(null)}
                className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold transition-colors cursor-pointer"
              >
                <ArrowRight className="w-4 h-4" />
                رجوع لقائمة المعامل
              </button>

              {canViewFinancials && <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleOpenEditLabModal(selectedLab)}
                  className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer"
                  title="تعديل بيانات المعمل" aria-label="تعديل بيانات المعمل"
                >
                  <Edit3 className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteLabConfirmed(selectedLab)}
                  className="p-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 transition-colors cursor-pointer"
                  title="حذف المعمل" aria-label="حذف المعمل"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>}
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
            {canViewFinancials && <div className="pt-2">
              <BalanceProgressMeter
                total={currentLabTotal}
                paid={currentLabPaid}
                remaining={currentLabRemain}
                label="الموقف المالي الكلي لهذا المعمل"
                size="md"
                type="lab"
              />
            </div>}
          </div>

          {/* Lab Services Catalog */}
          {canViewFinancials && <details className="lab-disclosure bg-white rounded-2xl border border-slate-200">
            <summary>دفعة مجمعة وسجل المدفوعات</summary>
            <div className="p-4 pt-0 space-y-3">
            <p className="text-sm text-slate-600">المحجوز حالياً: {currentLabCases.reduce((sum, c) => sum + getLabCaseFinancials(c, patients).reserved, 0).toLocaleString()} ج.م. توزع الدفعة على أقدم الحالات المستحقة.</p>
            <label className="block text-sm">مبلغ الدفعة (ج.م)
              <input type="number" min="0.01" step="0.01" value={bulkAmount} onChange={e => setBulkAmount(e.target.value)} className="block w-full border rounded-xl p-3 mt-1" />
            </label>
            {bulkAllocations.map(a => <p key={a.caseId} className="text-sm">{labCases.find(c => c.id === a.caseId)?.patientName}: {a.amount.toLocaleString()} ج.م</p>)}
            {bulkAmount && !bulkAllocations.length && <p className="text-sm text-rose-700">أدخل مبلغاً أكبر من صفر ولا يتجاوز المستحق.</p>}
            <button type="button" disabled={!bulkAllocations.length || saving} className="rounded-xl bg-teal-800 text-white px-4 py-3 disabled:opacity-40" onClick={() => {
              const amount = Number(bulkAmount);
              askConfirm({ title: 'تأكيد سداد المعمل', message: `سداد ${amount.toLocaleString()} ج.م إلى ${selectedLab.name} موزعة على ${bulkAllocations.length} حالة؟`, confirmLabel: 'تسجيل السداد', tone: 'warning', onConfirm: async () => {
                await confirmSave(() => onBulkPayment(selectedLab.id, amount), () => { setBulkAmount(''); showToast('تم تسجيل الدفعة المجمعة', 'success'); });
              }});
            }}>تسجيل الدفعة المجمعة</button>
            <details className="text-sm"><summary className="cursor-pointer font-bold">سجل المدفوعات للحالات</summary>
              {currentLabCases.flatMap(c => (c.paymentsLog || []).map(p => <div key={`${c.id}-${p.id}`} className="border-b py-2">{p.date} · {c.patientName} · {p.amount.toLocaleString()} ج.م · {p.note || 'دفعة للمعمل'}</div>))}
              <p className="text-xs text-slate-500 mt-2">الدفعات القديمة التي حُفظت كإجمالي فقط لا تملك تفاصيل إيصالات.</p>
            </details>
            </div>
          </details>}
          <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs space-y-3">
            <h3 className="text-sm font-bold text-[#0f3d3e] font-tajawal">
              {canViewFinancials ? 'كتالوج خدمات وأسعار المعمل المعتمدة' : 'خدمات المعمل المعتمدة'}
            </h3>
            {!selectedLab.services.length && <p className="text-sm text-slate-500">لم تُضف خدمات لهذا المعمل بعد.{canManagePrices && onManageLabPrices && <button type="button" className="lab-inline-link" onClick={() => onManageLabPrices(selectedLab.id)}>إضافة الخدمات والأسعار</button>}</p>}
            <div className="lab-service-list">
              {selectedLab.services.map(s => (
                <div key={s.id} className="lab-service-row">
                  <span className="font-bold text-slate-800">{s.name}<small className="block text-slate-500 font-normal">{s.unitLabel}</small></span>
                  {canViewFinancials && <strong>{s.price.toLocaleString()} <small>ج.م / {s.unitLabel}</small></strong>}
                </div>
              ))}
            </div>
          </div>

          {/* Lab Cases List */}
          <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs space-y-3">
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
                        {renderReservation(c)}
                      </div>

                      {canViewFinancials && <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between md:justify-end gap-4">
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
                      </div>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : activeTab === 'labs' ? (
        <div className="lab-overview-grid">
          {!labs.length && <div className="col-span-full"><EmptyState icon={<Microscope className="h-8 w-8" />} title="لا توجد معامل مسجلة بعد"
            description={canViewFinancials ? 'أضف المعمل، ثم حدّد خدماته وأسعاره من قسم أسعار المعامل.' : 'تظهر المعامل هنا بعد إضافتها من حساب الطبيب.'}
            ctaLabel={canViewFinancials ? 'إضافة معمل' : undefined} onCtaClick={canViewFinancials ? handleOpenAddLabModal : undefined} /></div>}
          {labs.map(lab => {
            const cases = labCases.filter(c => c.labId === lab.id);
            const total = cases.reduce((sum, c) => sum + c.labTotal, 0);
            const paid = cases.reduce((sum, c) => sum + c.labPaid, 0);
            const remain = cases.reduce((sum, c) => sum + Math.max(0, c.labTotal - c.labPaid), 0);
            return <button key={lab.id} type="button" className="lab-overview-card"
              aria-label={`عرض تفاصيل معمل ${lab.name}`} onClick={() => setSelectedLabId(lab.id)}>
              <span className="lab-card-heading">
                <span className="lab-card-icon"><Microscope className="h-5 w-5" /></span>
                <span className="min-w-0 flex-1"><span className="lab-card-name">{lab.name}</span>
                  <span className="lab-card-contact">{lab.phone || lab.address || 'لم تُسجّل بيانات تواصل'}</span></span>
                <ChevronLeft className="h-4 w-4 text-slate-400 shrink-0" />
              </span>
              <span className="lab-card-meta">{cases.length} حالة <span>·</span> {lab.services.length} خدمة</span>
              {canViewFinancials && <span className="lab-card-finances">
                <span><small>إجمالي التكلفة</small><strong>{total.toLocaleString()} <small>ج.م</small></strong></span>
                <span><small>المسدّد</small><strong>{paid.toLocaleString()} <small>ج.م</small></strong></span>
                <span><small>المتبقي</small><strong className={remain > 0 ? 'text-rose-700' : 'text-emerald-700'}>{remain.toLocaleString()} <small>ج.م</small></strong></span>
              </span>}
              <span className="lab-card-footer">عرض ملف المعمل والتفاصيل</span>
            </button>;
          })}
        </div>
      ) : (
        /* ALL LAB CASES TAB WITH PROFIT CALCULATION & FILTERS */
        <div className="space-y-5 animate-fadeIn">
          {/* Net Profit Visual Financial Card */}
          {canViewFinancials && <VisualFinancialCard
            title="المحصل بعد تكاليف المعمل"
            subtitle="تحصيل الخدمات المرتبطة − إجمالي تكلفة المعمل"
            amount={totalNetProfit}
            icon={<TrendingUp className="w-6 h-6 text-[#c9a227]" />}
            gradient="teal"
            footerInfo={`إجمالي عدد حالات التركيبات المسجلة: ${labCases.length} حالة`}
          />}

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
          <div className="flex flex-wrap items-center gap-2 pb-2 text-xs">
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

            {canViewFinancials && <>
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
            </>}
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
                          value={c.status === 'completed' ? 'delivered' : c.status === 'delayed' ? 'pending' : c.status}
                          disabled={!onUpdateLabCase || saving}
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
                    {renderReservation(c)}
                    {canViewFinancials && <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
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
                    </div>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Modal: Add/Edit Lab */}
      {isLabModalOpen && (
        <div className="clinic-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-fadeIn">
          <div id="labModal" ref={labDialogRef} role="dialog" aria-modal="true" aria-labelledby="lab-modal-title" tabIndex={-1} className="clinic-modal-panel bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4 max-h-[90dvh] overflow-y-auto modal-scroll">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h2 id="lab-modal-title" className="text-base font-bold text-[#0f3d3e] font-tajawal">
                {editingLab ? 'تعديل بيانات المعمل' : 'إضافة معمل جديد'}
              </h2>
              <button aria-label="إغلاق بيانات المعمل" onClick={() => { if (!saving) setIsLabModalOpen(false); }} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveLabForm} aria-busy={saving} className="space-y-4"><fieldset disabled={saving} className="contents">
              {labFormError && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{labFormError}</p>}
              <div>
                <label htmlFor="input-lab-name" className="block text-xs font-bold text-slate-700 mb-1">
                  اسم المعمل <span className="text-rose-500">*</span>
                </label>
                <input
                  id="input-lab-name" maxLength={100} data-dialog-autofocus
                  type="text"
                  value={labName}
                  onChange={e => setLabName(e.target.value)}
                  placeholder="مثال: معمل الأمل للأسنان"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm focus:outline-none focus:border-[#0f3d3e]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="input-lab-phone" className="block text-xs font-bold text-slate-700 mb-1">
                    رقم الهاتف
                  </label>
                  <input
                    id="input-lab-phone" type="tel" maxLength={40} value={labPhone}
                    onChange={e => setLabPhone(e.target.value)}
                    placeholder="01001122334"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-mono focus:outline-none focus:border-[#0f3d3e]"
                  />
                </div>

                <div>
                  <label htmlFor="input-lab-address" className="block text-xs font-bold text-slate-700 mb-1">
                    العنوان
                  </label>
                  <input
                    type="text"
                    id="input-lab-address" maxLength={200} value={labAddress}
                    onChange={e => setLabAddress(e.target.value)}
                    placeholder="الدقي - القاهرة"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm focus:outline-none focus:border-[#0f3d3e]"
                  />
                </div>
              </div>

              <label className="block text-xs font-bold text-slate-700">ملاحظات المعمل
                <textarea maxLength={1000} value={labNotes} onChange={event => setLabNotes(event.target.value)} rows={2}
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm" />
              </label>

              <p className="rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm leading-relaxed text-teal-900">
                خدمات المعمل وتكلفتها تُضبط من لوحة التحكم ← الخدمات والأسعار ← أسعار المعامل.
                {editingLab ? ` لهذا المعمل ${editingLab.services.length} خدمة مسجلة؛ تعديل بياناته هنا لا يغيّر أسعارها.` : ' أضف بيانات المعمل هنا أولًا، ثم حدّد خدماته وأسعاره.'}
              </p>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => { if (!saving) setIsLabModalOpen(false); }}
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
            </fieldset></form>
          </div>
        </div>
      )}

      {/* Modal: Add Case to Lab */}
      {isCaseModalOpen && selectedLab && (
        <div className="clinic-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-fadeIn">
          <div id="caseModal" ref={caseDialogRef} role="dialog" aria-modal="true" aria-labelledby="lab-case-modal-title" tabIndex={-1} className="clinic-modal-panel bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4 max-h-[90dvh] overflow-y-auto modal-scroll">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h2 id="lab-case-modal-title" className="text-base font-bold text-[#0f3d3e] font-tajawal">
                إضافة حالة جديدة لمعمل ({selectedLab.name})
              </h2>
              <button aria-label="إغلاق إضافة الحالة" onClick={() => { if (!saving) setIsCaseModalOpen(false); }} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveLabCase} aria-busy={saving} className="space-y-4"><fieldset disabled={saving} className="contents">
              <label className="block text-xs font-bold">الخدمة المسجلة في ملف المريض
                <select value={caseSessionId} onChange={e => setCaseSessionId(e.target.value)} className="w-full border rounded-xl p-3 mt-1">
                  <option value="">ربط الخدمة لاحقاً</option>
                  {(patients.find(p => p.id === casePatientId)?.sessions || []).filter(s => !labCases.some(c => c.patientId === casePatientId && c.linkedSessionId === s.id)).map(s => <option key={s.id} value={s.id}>{s.type} — {s.date} — {s.toothLabel || 'عام'}</option>)}
                </select>
                <span className="block mt-1 font-normal text-slate-500">الربط يتابع الدفعات الموجودة ولا يضيف تكلفة جديدة للمريض.</span>
              </label>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  اختر المريض
                </label>
                <select
                  id="select-case-patient"
                  value={casePatientId}
                  onChange={e => { setCasePatientId(e.target.value); setCaseSessionId(''); }}
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
                      {s.name}{canViewFinancials ? ` (تكلفة المعمل: ${s.price} ج.م/${s.unitLabel})` : ` (${s.unitLabel})`}
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
                  onChange={e => setCaseUnits(e.target.value === '' ? '' : Number(e.target.value))}
                  min={1}
                  step={1}
                  required
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
                  onClick={() => { if (!saving) setIsCaseModalOpen(false); }}
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
            </fieldset></form>
          </div>
        </div>
      )}

      {/* Modal: Pay Lab */}
      {isPaymentModalOpen && selectedCaseForPayment && canViewFinancials && (
        <div className="clinic-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-fadeIn">
          <div id="labPaymentModal" ref={paymentDialogRef} role="dialog" aria-modal="true" aria-labelledby="lab-payment-modal-title" tabIndex={-1} className="clinic-modal-panel bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4 max-h-[90dvh] overflow-y-auto modal-scroll">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h2 id="lab-payment-modal-title" className="text-base font-bold text-[#0f3d3e] font-tajawal">
                تسديد دفعة للمعمل
              </h2>
              <button aria-label="إغلاق تسديد الدفعة" onClick={() => { if (!saving) setIsPaymentModalOpen(false); }} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveLabPayment} aria-busy={saving} className="space-y-4"><fieldset disabled={saving} className="contents">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  المبلغ المسدد للمعمل (ج.م)
                </label>
                <input
                  id="input-lab-payment"
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  value={paymentAmount}
                  onChange={e => setPaymentAmount(e.target.value === '' ? '' : parseFloat(e.target.value))}
                  placeholder="أكتب المبلغ"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-mono"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => { if (!saving) setIsPaymentModalOpen(false); }}
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
            </fieldset></form>
          </div>
        </div>
      )}
    </div>
  );
};
