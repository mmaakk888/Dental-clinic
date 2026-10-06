import React, { useState, useMemo } from 'react';
import { Patient, Session, Appointment, DrugCatalogItem, SessionServiceItem } from '../../types';
import { 
  X, UserCheck, UserPlus, Search, Stethoscope, DollarSign, CreditCard, 
  CheckCircle, AlertCircle, FileText, Calendar, Plus, Phone, Clock, Sparkles, Check,
  Trash2, ShieldAlert, Tag, Percent
} from 'lucide-react';
import { useToastAndConfirm } from '../common/ToastAndConfirm';
import { STANDARD_SERVICES_CATALOG } from '../../utils/financials';

interface QuickWalkInModalProps {
  isOpen: boolean;
  onClose: () => void;
  patients: Patient[];
  drugCatalog?: DrugCatalogItem[];
  defaultExamFee?: number;
  onSaveWalkInVisit: (data: {
    patient: {
      isNew: boolean;
      id: string;
      name: string;
      mobile: string;
      age: number;
      gender?: string;
    };
    visit: {
      chiefComplaint: string;
      diagnosis: string;
      procedurePerformed: string;
      services?: SessionServiceItem[];
      prescriptionNotes: string;
      visitNotes: string;
      visitStatus: 'completed' | 'follow_up';
      examinationFee: number;
      treatmentFee: number;
      totalFee: number;
      paidAmount: number;
      discountAmount?: number;
      paymentMethod: 'cash' | 'card' | 'transfer';
      isPaid: boolean;
    };
  }) => void;
  onSelectPatientFile?: (patientId: string) => void;
}

const CHIEF_COMPLAINT_PRESETS = [
  'ألم حاد في الضرس',
  'تورم في اللثة',
  'كسر في السن',
  'سقوط حشوة قديمة',
  'حساسية أسنان',
  'فحص وكشف دوري',
  'تنظيف وتلميع أسنان',
  'نزيف اللثة'
];

export const QuickWalkInModal: React.FC<QuickWalkInModalProps> = ({
  isOpen,
  onClose,
  patients,
  drugCatalog = [],
  defaultExamFee = 50,
  onSaveWalkInVisit,
  onSelectPatientFile
}) => {
  const { showToast, validationFail, askConfirm } = useToastAndConfirm();

  // Mode: 'select' (choose existing vs new) | 'form'
  const [patientMode, setPatientMode] = useState<'existing' | 'new'>('existing');

  // Search & Select Existing Patient State
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);

  // New Patient Form State
  const autoNextFileNo = useMemo(() => {
    const ids = patients.map(p => parseInt(p.id, 10)).filter(n => !isNaN(n));
    const maxId = ids.length > 0 ? Math.max(...ids) : 100;
    return String(maxId + 1);
  }, [patients]);

  const [newFileNo, setNewFileNo] = useState(autoNextFileNo);
  const [newName, setNewName] = useState('');
  const [newMobile, setNewMobile] = useState('');
  const [newAge, setNewAge] = useState<number | ''>('');
  const [newGender, setNewGender] = useState<'ذكر' | 'أنثى'>('ذكر');

  // Visit Clinical Details
  const [chiefComplaint, setChiefComplaint] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [procedurePerformed, setProcedurePerformed] = useState('');
  const [prescriptionNotes, setPrescriptionNotes] = useState('');
  const [visitNotes, setVisitNotes] = useState('');
  const [visitStatus, setVisitStatus] = useState<'completed' | 'follow_up'>('completed');

  // Multi-procedure Items Selection
  const [selectedServices, setSelectedServices] = useState<SessionServiceItem[]>([
    { id: `s_${Date.now()}_1`, name: 'خلع أسنان', price: 200 }
  ]);

  // Financial Details
  const [examinationFee, setExaminationFee] = useState<number | ''>(defaultExamFee);
  const [isPaid, setIsPaid] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'transfer'>('cash');
  const [paidAmount, setPaidAmount] = useState<number | ''>(defaultExamFee + 200);
  const [discountAmount, setDiscountAmount] = useState<number | ''>(0);

  // Calculate totals dynamically
  const examVal = typeof examinationFee === 'number' ? examinationFee : 0;
  const proceduresSum = selectedServices.reduce((acc, item) => acc + (typeof item.price === 'number' ? item.price : 0), 0);
  const totalFee = examVal + proceduresSum;
  const paidVal = typeof paidAmount === 'number' ? paidAmount : 0;
  const discountVal = typeof discountAmount === 'number' ? discountAmount : 0;
  const remainingBalance = Math.max(0, totalFee - paidVal - discountVal);

  // Handle adding service preset
  const handleAddPresetService = (preset: typeof STANDARD_SERVICES_CATALOG[0]) => {
    if (preset.id === 'exam') {
      setExaminationFee(preset.defaultPrice);
      showToast(`تم تعيين رسوم الكشف والمعاينة (${preset.defaultPrice} ج.م)`, 'info');
      return;
    }
    const newItem: SessionServiceItem = {
      id: `srv_${Date.now()}_${Math.random()}`,
      name: preset.name,
      price: preset.defaultPrice
    };
    const updated = [...selectedServices, newItem];
    setSelectedServices(updated);
    showToast(`تم إضافة خدمتكم: ${preset.name}`, 'info');
  };

  // Handle removing a procedure item
  const handleRemoveService = (id: string) => {
    setSelectedServices(prev => prev.filter(s => s.id !== id));
  };

  // Handle changing service item price
  const handleServicePriceChange = (id: string, newPrice: number) => {
    setSelectedServices(prev => prev.map(s => s.id === id ? { ...s, price: newPrice } : s));
  };

  // Handle Exemption / Discount Button
  const handleApplyDiscountExemption = () => {
    const unPaid = Math.max(0, totalFee - paidVal);
    if (unPaid <= 0) {
      showToast('لا يوجد مبلغ متبقي لتطبيق خصم أو إعفاء عليه', 'warning');
      return;
    }
    setDiscountAmount(unPaid);
    showToast(`تم تسجيل إعفاء / خصم بقيمة (${unPaid} ج.م) وتصفير المتبقي`, 'success');
  };

  // Filter existing patients
  const filteredPatients = useMemo(() => {
    if (!searchTerm.trim()) return patients.slice(0, 8);
    const q = searchTerm.trim().toLowerCase();
    return patients.filter(p => 
      p.name.toLowerCase().includes(q) ||
      p.mobile.includes(q) ||
      p.id.toLowerCase().includes(q)
    ).slice(0, 8);
  }, [patients, searchTerm]);

  // Handle Paid Toggle change
  const handleTogglePaid = (paid: boolean) => {
    setIsPaid(paid);
    if (paid) {
      setPaidAmount(totalFee);
    } else {
      setPaidAmount(0);
    }
  };

  // Keep paid amount updated if totalFee changes while isPaid is true
  React.useEffect(() => {
    if (isPaid) {
      setPaidAmount(totalFee);
    }
  }, [totalFee, isPaid]);

  if (!isOpen) return null;

  const handleSelectExistingPatient = (patient: Patient) => {
    setSelectedPatient(patient);
    setSearchTerm('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (patientMode === 'existing') {
      if (!selectedPatient) {
        validationFail('يرجى اختيار مريض من القائمة أولاً');
        return;
      }
    } else {
      if (!newName.trim()) {
        validationFail('يرجى إدخال اسم المريض الجديد');
        return;
      }
      if (!newMobile.trim()) {
        validationFail('يرجى إدخال رقم هاتف المريض');
        return;
      }
    }

    const patientInfo = patientMode === 'existing' && selectedPatient ? {
      isNew: false,
      id: selectedPatient.id,
      name: selectedPatient.name,
      mobile: selectedPatient.mobile,
      age: selectedPatient.age || 0,
      gender: selectedPatient.gender
    } : {
      isNew: true,
      id: newFileNo.trim() || autoNextFileNo,
      name: newName.trim(),
      mobile: newMobile.trim(),
      age: typeof newAge === 'number' ? newAge : 25,
      gender: newGender
    };

    const procSummary = selectedServices.map(s => s.name).join(' + ') || procedurePerformed.trim() || 'كشف واستشارة طبية';

    onSaveWalkInVisit({
      patient: patientInfo,
      visit: {
        chiefComplaint: chiefComplaint.trim(),
        diagnosis: diagnosis.trim(),
        procedurePerformed: procSummary,
        services: selectedServices,
        prescriptionNotes: prescriptionNotes.trim(),
        visitNotes: visitNotes.trim(),
        visitStatus,
        examinationFee: examVal,
        treatmentFee: proceduresSum,
        totalFee,
        paidAmount: paidVal,
        discountAmount: discountVal,
        paymentMethod,
        isPaid: remainingBalance === 0
      }
    });

    showToast(`تم تسجيل الكشف السريع للزائر (${patientInfo.name}) بنجاح ⚡`, 'success');
    
    // Reset state & close
    setSelectedPatient(null);
    setNewName('');
    setNewMobile('');
    setChiefComplaint('');
    setDiagnosis('');
    setProcedurePerformed('');
    setPrescriptionNotes('');
    setVisitNotes('');
    onClose();
  };

  return (
    <div className="clinic-modal-overlay fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 overflow-y-auto animate-fadeIn dir-rtl font-['Cairo',sans-serif]">
      <div className="clinic-modal-panel clinic-modal-panel--framed bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-2xl overflow-hidden my-auto flex flex-col max-h-[92dvh]">
        
        {/* Modal Header */}
        <div className="bg-linear-to-r from-indigo-600 via-indigo-700 to-purple-700 text-white p-4 sm:p-5 flex items-center justify-between shrink-0 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-white/15 backdrop-blur-md flex items-center justify-center text-white shrink-0 border border-white/20">
              <Stethoscope className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-black font-tajawal leading-tight flex items-center gap-2">
                كشف سريع / زائر بدون موعد
                <span className="bg-amber-400 text-slate-900 text-[10px] font-black px-2 py-0.5 rounded-full shadow-2xs">
                  مباشر ⚡
                </span>
              </h3>
              <p className="text-xs text-indigo-100 font-medium">
                تسجيل زيارة وتوثيق الكشفية والمالية بسرعة وسهولة
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

        {/* Modal Scrollable Form Body */}
        <form onSubmit={handleSubmit} className="min-h-0 p-4 sm:p-6 overflow-y-auto space-y-5 flex-1">
          
          {/* STEP 1: PATIENT SELECTION MODE TOGGLE */}
          <div className="bg-slate-50 p-1.5 rounded-2xl border border-slate-200 flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setPatientMode('existing');
                setSelectedPatient(null);
              }}
              className={`flex-1 py-2.5 px-3 rounded-xl font-bold text-xs sm:text-sm transition-all flex items-center justify-center gap-2 cursor-pointer touch-manipulation ${
                patientMode === 'existing'
                  ? 'bg-indigo-600 text-white shadow-md font-black'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
              }`}
            >
              <UserCheck className="w-4 h-4 shrink-0" />
              <span>مريض سابق (مسجل)</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setPatientMode('new');
                setSelectedPatient(null);
              }}
              className={`flex-1 py-2.5 px-3 rounded-xl font-bold text-xs sm:text-sm transition-all flex items-center justify-center gap-2 cursor-pointer touch-manipulation ${
                patientMode === 'new'
                  ? 'bg-indigo-600 text-white shadow-md font-black'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
              }`}
            >
              <UserPlus className="w-4 h-4 shrink-0" />
              <span>مريض جديد (تسجيل سريع)</span>
            </button>
          </div>

          {/* MODE A: EXISTING PATIENT SEARCH & SELECT */}
          {patientMode === 'existing' && (
            <div className="space-y-3 bg-indigo-50/50 border border-indigo-100 p-3.5 sm:p-4 rounded-2xl">
              <label className="block text-xs font-black text-slate-800 font-tajawal mb-1">
                البحث عن مريض مسجل (الاسم، الهاتف، أو رقم الملف):
              </label>

              {selectedPatient ? (
                <div className="bg-white p-3 rounded-xl border-2 border-indigo-500 shadow-2xs flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-700 font-black flex items-center justify-center text-sm shrink-0">
                      #{selectedPatient.id}
                    </div>
                    <div>
                      <h4 className="text-sm font-black text-slate-900 font-tajawal">
                        {selectedPatient.name}
                      </h4>
                      <p className="text-xs text-slate-500 font-mono dir-ltr text-right">
                        {selectedPatient.mobile}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setSelectedPatient(null)}
                    className="px-2.5 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-50 rounded-lg transition-colors border border-rose-200"
                  >
                    تغيير المريض
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-3.5" />
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="ابحث باسم المريض، الهواتف، أو رقم الملف..."
                      className="w-full pl-3 pr-10 py-2.5 bg-white border border-slate-300 rounded-xl text-sm font-medium focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                      autoFocus
                    />
                  </div>

                  {/* Search Results Dropdown/List */}
                  <div className="max-h-48 overflow-y-auto space-y-1 bg-white rounded-xl border border-slate-200 p-1 divide-y divide-slate-100">
                    {filteredPatients.length > 0 ? (
                      filteredPatients.map(p => (
                        <div
                          key={p.id}
                          onClick={() => handleSelectExistingPatient(p)}
                          className="p-2.5 hover:bg-indigo-50 rounded-lg cursor-pointer transition-colors flex items-center justify-between group active:scale-98"
                        >
                          <div className="flex items-center gap-2.5">
                            <span className="text-xs font-mono font-bold bg-slate-100 group-hover:bg-indigo-100 text-slate-700 group-hover:text-indigo-700 px-2 py-0.5 rounded-md">
                              #{p.id}
                            </span>
                            <span className="text-xs sm:text-sm font-bold text-slate-900 group-hover:text-indigo-900 font-tajawal">
                              {p.name}
                            </span>
                          </div>
                          <span className="text-xs font-mono text-slate-500 dir-ltr">
                            {p.mobile}
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="p-4 text-center text-xs text-slate-500 font-medium">
                        لم يتم العثور على مريض بهذا الاسم. اضغط على "مريض جديد" لتسجيله فوراً.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* MODE B: NEW PATIENT FORM */}
          {patientMode === 'new' && (
            <div className="space-y-3 bg-emerald-50/50 border border-emerald-100 p-3.5 sm:p-4 rounded-2xl">
              <h4 className="text-xs font-black text-emerald-900 font-tajawal flex items-center gap-1.5">
                <UserPlus className="w-4 h-4 text-emerald-600" />
                بيانات المريض الجديد:
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Name */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    اسم المريض <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="الاسم الثلاثي للمريض..."
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-sm font-bold text-slate-900 focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                </div>

                {/* Phone */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    رقم الهاتف / الواتساب <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="tel"
                    required
                    value={newMobile}
                    onChange={(e) => setNewMobile(e.target.value)}
                    placeholder="07XXXXXXXXX"
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-sm font-bold font-mono text-slate-900 focus:ring-2 focus:ring-emerald-500 outline-none dir-ltr text-right"
                  />
                </div>

                {/* File Number */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    رقم الملف (تلقائي)
                  </label>
                  <input
                    type="text"
                    value={newFileNo}
                    onChange={(e) => setNewFileNo(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-100 border border-slate-300 rounded-xl text-sm font-bold font-mono text-slate-700 outline-none"
                  />
                </div>

                {/* Age & Gender */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      العمر
                    </label>
                    <input
                      type="number"
                      value={newAge}
                      onChange={(e) => setNewAge(e.target.value ? parseInt(e.target.value, 10) : '')}
                      placeholder="العمر"
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-sm font-bold font-mono text-slate-900 focus:ring-2 focus:ring-emerald-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      الجنس
                    </label>
                    <select
                      value={newGender}
                      onChange={(e) => setNewGender(e.target.value as any)}
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-sm font-bold text-slate-900 focus:ring-2 focus:ring-emerald-500 outline-none"
                    >
                      <option value="ذكر">ذكر</option>
                      <option value="أنثى">أنثى</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: CLINICAL VISIT DETAILS */}
          <div className="space-y-4 border-t border-slate-200 pt-4">
            <h4 className="text-xs sm:text-sm font-black text-slate-800 font-tajawal flex items-center gap-1.5">
              <Stethoscope className="w-4 h-4 text-indigo-600" />
              تفاصيل الكشف والزيارة الطبية:
            </h4>

            {/* Chief Complaint */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                الشكوى الرئيسية (Chief Complaint):
              </label>
              <input
                type="text"
                value={chiefComplaint}
                onChange={(e) => setChiefComplaint(e.target.value)}
                placeholder="مثال: ألم شديد في الضرس العلوي الأيمن..."
                className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-sm font-medium focus:ring-2 focus:ring-indigo-500 outline-none"
              />
              {/* Presets */}
              <div className="flex flex-wrap gap-1.5 mt-2">
                {CHIEF_COMPLAINT_PRESETS.map((preset, idx) => (
                  <button
                    type="button"
                    key={idx}
                    onClick={() => setChiefComplaint(preset)}
                    className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-indigo-100 text-slate-700 hover:text-indigo-800 transition-colors border border-slate-200 cursor-pointer touch-manipulation"
                  >
                    + {preset}
                  </button>
                ))}
              </div>
            </div>

            {/* Diagnosis & Procedure */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  التشخيص (Diagnosis):
                </label>
                <input
                  type="text"
                  value={diagnosis}
                  onChange={(e) => setDiagnosis(e.target.value)}
                  placeholder="مثال: تسوس عميق، التهاب عصب..."
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-sm font-medium focus:ring-2 focus:ring-indigo-500 outline-none"
                />
              </div>

              {/* Services & Procedures Selector */}
              <div className="sm:col-span-2 space-y-2">
                <label className="block text-xs font-bold text-slate-800 font-tajawal">
                  الخدمات والإجراءات في هذه الزيارة:
                </label>

                {/* Catalog Quick Add Pills */}
                <div className="flex flex-wrap gap-1.5 pb-1">
                  {STANDARD_SERVICES_CATALOG.map((catItem) => (
                    <button
                      type="button"
                      key={catItem.id}
                      onClick={() => handleAddPresetService(catItem)}
                      className="text-xs font-bold px-2.5 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 transition-colors border border-indigo-200/80 cursor-pointer touch-manipulation flex items-center gap-1 active:scale-95"
                    >
                      <Plus className="w-3.5 h-3.5 shrink-0" />
                      <span>{catItem.name}</span>
                      <span className="text-[10px] text-indigo-500 font-mono">({catItem.defaultPrice} ج.م)</span>
                    </button>
                  ))}
                </div>

                {/* Selected Services List */}
                <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden shadow-2xs">
                  {selectedServices.length > 0 ? (
                    selectedServices.map((srv, idx) => (
                      <div key={srv.id} className="p-2.5 sm:p-3 flex items-center justify-between gap-3 hover:bg-slate-50 transition-colors">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 text-xs font-black flex items-center justify-center shrink-0">
                            {idx + 1}
                          </span>
                          <input
                            type="text"
                            value={srv.name}
                            onChange={(e) => {
                              const newName = e.target.value;
                              setSelectedServices(prev => prev.map(s => s.id === srv.id ? { ...s, name: newName } : s));
                            }}
                            className="text-xs sm:text-sm font-bold text-slate-900 bg-transparent border-b border-dashed border-slate-300 focus:border-indigo-500 outline-none flex-1 min-w-0"
                            placeholder="اسم الخدمة..."
                          />
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs font-bold text-slate-500">السعر:</span>
                          <input
                            type="number"
                            min="0"
                            value={srv.price}
                            onChange={(e) => handleServicePriceChange(srv.id, e.target.value ? parseInt(e.target.value, 10) : 0)}
                            className="w-20 px-2 py-1 bg-slate-50 border border-slate-300 rounded-lg text-xs font-black font-mono text-slate-900 focus:ring-2 focus:ring-indigo-500 outline-none text-center"
                          />
                          <span className="text-xs font-bold text-slate-600">ج.م</span>

                          <button
                            type="button"
                            onClick={() => handleRemoveService(srv.id)}
                            className="w-7 h-7 rounded-lg text-rose-500 hover:bg-rose-50 flex items-center justify-center transition-colors cursor-pointer"
                            title="حذف الخدمة"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="p-4 text-center text-xs text-slate-500 font-medium">
                      لم يتم إضافة خدمات تفصيلية بعد. اضغط على الأزرار أعلاه للإضافة.
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Prescription & Notes */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  الوصفة الطبية / العلاج المصروف:
                </label>
                <textarea
                  rows={2}
                  value={prescriptionNotes}
                  onChange={(e) => setPrescriptionNotes(e.target.value)}
                  placeholder="مثال: Augmentin 1g كبسولة كل 12 ساعة..."
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-medium focus:ring-2 focus:ring-indigo-500 outline-none resize-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  ملاحظات وحالة الزيارة:
                </label>
                <textarea
                  rows={2}
                  value={visitNotes}
                  onChange={(e) => setVisitNotes(e.target.value)}
                  placeholder="ملاحظات الجلسة أو المتابعة القادمة..."
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-medium focus:ring-2 focus:ring-indigo-500 outline-none resize-none"
                />
              </div>
            </div>

            {/* Visit Status selector */}
            <div className="flex items-center gap-3 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
              <span className="text-xs font-bold text-slate-700">حالة الزيارة:</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setVisitStatus('completed')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                    visitStatus === 'completed'
                      ? 'bg-emerald-600 text-white shadow-2xs'
                      : 'bg-white text-slate-600 border border-slate-200'
                  }`}
                >
                  <CheckCircle className="w-3.5 h-3.5" />
                  مكتملة بالكامل
                </button>

                <button
                  type="button"
                  onClick={() => setVisitStatus('follow_up')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                    visitStatus === 'follow_up'
                      ? 'bg-amber-600 text-white shadow-2xs'
                      : 'bg-white text-slate-600 border border-slate-200'
                  }`}
                >
                  <Clock className="w-3.5 h-3.5" />
                  تحتاج جلسة متابعة
                </button>
              </div>
            </div>
          </div>

          {/* STEP 3: FINANCIAL SECTION */}
          <div className="space-y-4 border-t border-slate-200 pt-4 bg-emerald-50/30 p-3.5 sm:p-4 rounded-2xl border border-emerald-200">
            <div className="flex items-center justify-between">
              <h4 className="text-xs sm:text-sm font-black text-emerald-950 font-tajawal flex items-center gap-1.5">
                <DollarSign className="w-4 h-4 text-emerald-600" />
                الحساب المالي والتحصيل اليومي (بدون فكرة خزنة):
              </h4>

              {/* Action Buttons for quick resolution */}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setPaidAmount(totalFee);
                    setDiscountAmount(0);
                    setIsPaid(true);
                    showToast('تم تسديد المبلغ بالكامل بنجاح', 'success');
                  }}
                  className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black transition-all flex items-center gap-1 cursor-pointer shadow-2xs active:scale-95"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>تم التسديد بالكامل</span>
                </button>

                <button
                  type="button"
                  onClick={handleApplyDiscountExemption}
                  className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-black transition-all flex items-center gap-1 cursor-pointer shadow-2xs active:scale-95"
                >
                  <Percent className="w-3.5 h-3.5" />
                  <span>إعفاء / خصم</span>
                </button>
              </div>
            </div>

            {/* Fee Inputs Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              {/* Examination Fee */}
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  رسوم الكشفية (ج.م):
                </label>
                <input
                  type="number"
                  min="0"
                  value={examinationFee}
                  onChange={(e) => setExaminationFee(e.target.value ? parseInt(e.target.value, 10) : '')}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-sm font-black font-mono text-slate-900 focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>

              {/* Total Procedures Value */}
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  إجمالي الخدمات ({selectedServices.length}):
                </label>
                <div className="w-full px-3 py-2 bg-slate-100 border border-slate-200 rounded-xl text-sm font-black font-mono text-slate-800">
                  {proceduresSum.toLocaleString()} ج.م
                </div>
              </div>

              {/* Paid Amount */}
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  المبلغ المدفوع (ج.م):
                </label>
                <input
                  type="number"
                  min="0"
                  value={paidAmount}
                  onChange={(e) => {
                    const val = e.target.value ? parseInt(e.target.value, 10) : 0;
                    setPaidAmount(val);
                    setIsPaid(val >= totalFee && totalFee > 0);
                  }}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-sm font-black font-mono text-emerald-700 focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>

              {/* Discount / Exemption Amount */}
              <div>
                <label className="block text-[11px] font-bold text-amber-800 mb-1 flex items-center gap-1">
                  <Tag className="w-3 h-3 text-amber-600" />
                  الخصم / الإعفاء (ج.م):
                </label>
                <input
                  type="number"
                  min="0"
                  value={discountAmount}
                  onChange={(e) => setDiscountAmount(e.target.value ? parseInt(e.target.value, 10) : 0)}
                  className="w-full px-3 py-2 bg-amber-50 border border-amber-300 rounded-xl text-sm font-black font-mono text-amber-900 focus:ring-2 focus:ring-amber-500 outline-none"
                />
              </div>
            </div>

            {/* Payment Method Selector & Summary Box */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  طريقة الدفع:
                </label>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('cash')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                      paymentMethod === 'cash'
                        ? 'bg-slate-900 text-white font-black'
                        : 'bg-white text-slate-700 border border-slate-300'
                    }`}
                  >
                    💵 نقدًا (Cash)
                  </button>

                  <button
                    type="button"
                    onClick={() => setPaymentMethod('card')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                      paymentMethod === 'card'
                        ? 'bg-indigo-600 text-white font-black'
                        : 'bg-white text-slate-700 border border-slate-300'
                    }`}
                  >
                    💳 بطاقة (Card)
                  </button>

                  <button
                    type="button"
                    onClick={() => setPaymentMethod('transfer')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                      paymentMethod === 'transfer'
                        ? 'bg-purple-600 text-white font-black'
                        : 'bg-white text-slate-700 border border-slate-300'
                    }`}
                  >
                    📲 تحويل إلكتروني
                  </button>
                </div>
              </div>

              {/* Summary Calculation Badge */}
              <div className="bg-white p-3 rounded-2xl border border-slate-200 text-left sm:text-right shrink-0 font-mono shadow-2xs space-y-0.5">
                <div className="text-[11px] text-slate-500 font-bold flex items-center justify-between gap-4">
                  <span>إجمالي المطلوبة:</span>
                  <span className="text-slate-900 font-black text-xs">{totalFee.toLocaleString()} ج.م</span>
                </div>
                <div className="text-[11px] text-emerald-600 font-bold flex items-center justify-between gap-4">
                  <span>المدفوع المستحصل:</span>
                  <span className="font-black text-xs">{paidVal.toLocaleString()} ج.م</span>
                </div>
                {discountVal > 0 && (
                  <div className="text-[11px] text-amber-700 font-bold flex items-center justify-between gap-4">
                    <span>قيمة الخصم/الإعفاء:</span>
                    <span className="font-black text-xs">{discountVal.toLocaleString()} ج.م</span>
                  </div>
                )}
                <div className={`text-[11px] font-black pt-1 border-t border-slate-100 flex items-center justify-between gap-4 ${remainingBalance > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                  <span>المتبقي المطلوب:</span>
                  <span>{remainingBalance.toLocaleString()} ج.م</span>
                </div>
              </div>
            </div>
          </div>

          {/* Touch-Friendly Action Buttons */}
          <div className="pt-2 flex items-center gap-3 shrink-0">
            <button
              type="submit"
              className="flex-1 py-3.5 px-4 rounded-2xl bg-linear-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800 text-white font-black text-sm shadow-md transition-all active:scale-98 cursor-pointer touch-manipulation flex items-center justify-center gap-2"
            >
              <CheckCircle className="w-5 h-5 shrink-0" />
              <span>حفظ وإنهاء الكشف السريع ⚡</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="px-5 py-3.5 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-black text-sm transition-all active:scale-95 cursor-pointer touch-manipulation border border-slate-200 shrink-0"
            >
              إلغاء وإغلاق
            </button>
          </div>

        </form>
      </div>
    </div>
  );
};
