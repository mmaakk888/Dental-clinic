import React, { useState, useMemo, useEffect } from 'react';
import {
  Patient, NavigationOrigin, Session, Lab, LabCase, PaymentInstallment,
  DrugCatalogItem, Appointment, AppointmentStatus
} from '../../types';
import { ToothChart } from './ToothChart';
import { PrescriptionAndInstructionsView } from './PrescriptionAndInstructionsView';
import {
  ArrowRight, Phone, MessageCircle, Edit3, Trash2, ShieldAlert, Plus,
  ChevronDown, ChevronUp, DollarSign, Microscope, Calendar, CheckCircle,
  Clock, Copy, Send, CheckCircle2, UserCheck, XCircle, Share2, Mail,
  MessageSquare, MoreHorizontal, Sparkles, Activity, FileText, Check,
  AlertTriangle, X, Wallet, History, ChevronRight, ArrowUp, Layers, Eye
} from 'lucide-react';
import { useToastAndConfirm } from '../common/ToastAndConfirm';
import {
  parseCompositeToothId, getToothLabel, calculateToothBridgeRange,
  getToothStatusForPatient
} from '../../utils/toothUtils';
import { BalanceProgressMeter, CompactBalanceBadge } from '../common/FinancialBadge';
import { buildAppointmentReminderText, getWhatsAppUrl as formatWhatsAppUrl } from '../../utils/whatsappUtils';
import { AppointmentStatusModal, APPOINTMENT_STATUS_CONFIGS } from '../appointments/AppointmentStatusModal';
import { getPatientFinancialSummary, getSessionCollected } from '../../utils/financials';

interface PatientFileViewProps {
  patient: Patient;
  appointments?: Appointment[];
  origin: NavigationOrigin;
  serviceTypes: string[];
  labs: Lab[];
  crownPrices: Record<string, number>;
  isPrivacyMode?: boolean;
  clinicName?: string;
  clinicLogo?: string | null;
  drugCatalog?: DrugCatalogItem[];
  onSaveSession: (patientId: string, session: Omit<Session, 'id'>) => void;
  onAddPaymentInstallment: (patientId: string, sessionId: string, installment: { amount: number; date: string }) => void;
  onUpdatePatient: (patientData: Omit<Patient, 'sessions' | 'payments'>) => void;
  onDeletePatient: (patientId: string) => void;
  onSaveAppointment?: (appt: Omit<Appointment, 'id'> & { id?: string }) => void;
  onUpdateApptStatus?: (apptId: string, status: AppointmentStatus) => void;
  onDeleteAppointment?: (apptId: string) => void;
  onBack: () => void;
}

// Quick Services Catalog Preset
const QUICK_SERVICES = [
  { id: 'consultation', name: 'كشف ومتابعة', price: 200, type: 'كشف ومتابعة', icon: '🩺' },
  { id: 'filling', name: 'حشو ليزر', price: 600, type: 'حشو ليزر', icon: '🦷' },
  { id: 'endo', name: 'علاج عصب', price: 1200, type: 'علاج عصب', icon: '🧵' },
  { id: 'crown', name: 'تركيبة / طربوش', price: 2200, type: 'تركيبات - ثابتة', icon: '👑' },
  { id: 'extraction', name: 'خلع سن', price: 400, type: 'خلع سن', icon: '🦷' },
  { id: 'scaling', name: 'تنظيف وتلميع', price: 500, type: 'تنظيف جير', icon: '🪥' },
  { id: 'xray', name: 'أشعة تشخيصية', price: 150, type: 'أشعة تشخيصية', icon: '📸' },
  { id: 'followup', name: 'متابعة دورية', price: 100, type: 'جلسة متابعة', icon: '🔄' },
  { id: 'other', name: 'خدمة أخرى', price: 0, type: 'أخرى', icon: '➕' }
];

export const PatientFileView: React.FC<PatientFileViewProps> = React.memo(({
  patient,
  appointments = [],
  origin,
  serviceTypes,
  labs,
  crownPrices,
  isPrivacyMode = false,
  clinicName = 'عيادة الأسنان',
  clinicLogo = null,
  drugCatalog = [],
  onSaveSession,
  onAddPaymentInstallment,
  onUpdatePatient,
  onDeletePatient,
  onSaveAppointment,
  onUpdateApptStatus,
  onDeleteAppointment,
  onBack
}) => {
  const { showToast, askConfirm, validationFail } = useToastAndConfirm();

  // Primary Active Tab State
  const [activeTab, setActiveTab] = useState<'chart' | 'sessions' | 'appointments' | 'finance' | 'prescription' | 'info'>('chart');

  // Selected Tooth State (shared between ToothChart & SelectedToothPanel & Bottom Action Bar)
  const [selectedToothId, setSelectedToothId] = useState<string | null>(null);

  // Secondary UI Controls
  const [isMoreTabsSheetOpen, setIsMoreTabsSheetOpen] = useState(false);
  const [showFinancialDetails, setShowFinancialDetails] = useState(false);
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);

  // Financial Calculations
  const financialSummary = useMemo(() => getPatientFinancialSummary(patient), [patient]);
  const totalRequired = Math.max(0, financialSummary.totalRequired - financialSummary.totalDiscounts);
  const totalPaid = financialSummary.totalCollected;
  const totalRemain = financialSummary.totalRemaining;

  const paidPercentage = totalRequired > 0 ? Math.min(100, Math.round((totalPaid / totalRequired) * 100)) : 100;

  const maskMoney = (amount: number) => {
    if (isPrivacyMode) return '*** ج.م';
    return `${amount.toLocaleString()} ج.م`;
  };

  // Demographics & Visit stats
  const firstVisitDate = useMemo(() => {
    if (patient.firstVisit) return patient.firstVisit;
    if (patient.sessions.length > 0) return patient.sessions[patient.sessions.length - 1].date;
    return '—';
  }, [patient.firstVisit, patient.sessions]);

  const lastVisitDate = useMemo(() => {
    const dates: string[] = [];
    if (patient.sessions.length > 0) dates.push(...patient.sessions.map(s => s.date));
    if (appointments.length > 0) {
      appointments.filter(a => a.fileNo === patient.id || a.patientId === patient.id).forEach(a => dates.push(a.date));
    }
    if (dates.length === 0) return patient.firstVisit || '—';
    dates.sort();
    return dates[dates.length - 1];
  }, [patient.sessions, appointments, patient.id, patient.firstVisit]);

  const treatedTeethCount = useMemo(() => {
    const toothSet = new Set<string>();
    patient.sessions.forEach(s => {
      if (s.tooth) toothSet.add(s.tooth);
      if (s.teethIds && Array.isArray(s.teethIds)) {
        s.teethIds.forEach(id => toothSet.add(id));
      }
    });
    return toothSet.size;
  }, [patient.sessions]);

  const labCasesCount = useMemo(() => {
    return patient.sessions.filter(s => {
      const t = s.type.toLowerCase();
      return t.includes('تركيب') || t.includes('طربوش') || t.includes('معمل') || t.includes('زيركون');
    }).length;
  }, [patient.sessions]);

  // Appointments for this patient
  const patientAppointments = useMemo(() => {
    return appointments
      .filter(a => a.fileNo === patient.id || a.patientId === patient.id)
      .sort((a, b) => {
        const dateTimeA = `${a.date}T${a.time}`;
        const dateTimeB = `${b.date}T${b.time}`;
        return dateTimeA.localeCompare(dateTimeB);
      });
  }, [appointments, patient.id]);

  // Selected Tooth Sessions & Financials
  const selectedToothSessions = useMemo(() => {
    if (!selectedToothId) return [];
    return patient.sessions.filter(s => {
      if (s.tooth === selectedToothId) return true;
      if (s.teethIds && s.teethIds.includes(selectedToothId)) return true;
      return false;
    });
  }, [selectedToothId, patient.sessions]);

  const selectedToothFinancials = useMemo(() => {
    const req = selectedToothSessions.reduce((acc, s) => acc + s.amount, 0);
    const pd = selectedToothSessions.reduce((acc, s) => acc + getSessionCollected(s), 0);
    const rem = Math.max(0, req - pd);
    return { req, pd, rem };
  }, [selectedToothSessions]);

  const selectedToothStatus = useMemo(() => {
    if (!selectedToothId) return null;
    return getToothStatusForPatient(patient.sessions, selectedToothId);
  }, [selectedToothId, patient.sessions]);

  // Modal States
  const [isServiceModalOpen, setIsServiceModalOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isApptModalOpen, setIsApptModalOpen] = useState(false);
  const [isEditPatientModalOpen, setIsEditPatientModalOpen] = useState(false);
  const [selectedSessionForPayment, setSelectedSessionForPayment] = useState<Session | null>(null);

  // Tooth Quick Service Bottom Sheet State
  const [toothSheetId, setToothSheetId] = useState<string | null>(null);

  // Status Modal State
  const [patientStatusModalAppt, setPatientStatusModalAppt] = useState<Appointment | null>(null);

  const handlePatientSelectStatus = (newStatus: AppointmentStatus) => {
    if (!patientStatusModalAppt || !onUpdateApptStatus) return;
    onUpdateApptStatus(patientStatusModalAppt.id, newStatus);
    const cfg = APPOINTMENT_STATUS_CONFIGS[newStatus];
    showToast(`تم تحديث حالة الموعد إلى (${cfg ? cfg.label : newStatus}) بنجاح`, 'success');
    setPatientStatusModalAppt(null);
  };

  // Edit Patient Form State
  const [editName, setEditName] = useState(patient.name);
  const [editMobile, setEditMobile] = useState(patient.mobile || '');
  const [editAge, setEditAge] = useState<number>(patient.age);
  const [editGender, setEditGender] = useState<'male' | 'female'>(patient.gender || 'male');
  const [editAllergy, setEditAllergy] = useState(patient.allergy || '');
  const [editNotes, setEditNotes] = useState(patient.notes || '');

  const handleOpenEditPatient = () => {
    setEditName(patient.name);
    setEditMobile(patient.mobile || '');
    setEditAge(patient.age);
    setEditGender(patient.gender || 'male');
    setEditAllergy(patient.allergy || '');
    setEditNotes(patient.notes || '');
    setIsEditPatientModalOpen(true);
  };

  const handleSavePatientEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editName.trim()) {
      validationFail('editPatientModal', 'input-edit-patient-name', 'يرجى كتابة اسم المريض');
      return;
    }
    onUpdatePatient({
      id: patient.id,
      name: editName.trim(),
      mobile: editMobile.trim(),
      age: editAge,
      gender: editGender,
      firstVisit: patient.firstVisit,
      notes: editNotes.trim(),
      allergy: editAllergy.trim()
    });
    setIsEditPatientModalOpen(false);
    showToast('تم تحديث بيانات ملف المريض بنجاح', 'success');
  };

  // Appointment Form State
  const [editingAppt, setEditingAppt] = useState<Appointment | null>(null);
  const [apptDate, setApptDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [apptTime, setApptTime] = useState<string>('17:00');
  const [apptType, setApptType] = useState<string>('حشو ليزر');
  const [apptDoctor, setApptDoctor] = useState<string>('د. العيادة');
  const [apptDuration, setApptDuration] = useState<number>(30);
  const [apptNotes, setApptNotes] = useState<string>('');

  useEffect(() => {
    const isAnyModalOpen = isServiceModalOpen || isPaymentModalOpen || isApptModalOpen || isEditPatientModalOpen || !!toothSheetId || isMoreTabsSheetOpen;
    if (isAnyModalOpen) {
      document.body.classList.add('modal-open');
    } else {
      document.body.classList.remove('modal-open');
    }
    return () => {
      document.body.classList.remove('modal-open');
    };
  }, [isServiceModalOpen, isPaymentModalOpen, isApptModalOpen, isEditPatientModalOpen, toothSheetId, isMoreTabsSheetOpen]);

  const handleOpenAddApptModal = (apptToEdit?: Appointment) => {
    if (apptToEdit) {
      setEditingAppt(apptToEdit);
      setApptDate(apptToEdit.date);
      setApptTime(apptToEdit.time);
      setApptType(apptToEdit.appointmentType || 'كشف ومتابعة');
      setApptDoctor(apptToEdit.doctorName || 'د. العيادة');
      setApptDuration(apptToEdit.durationMinutes || 30);
      setApptNotes(apptToEdit.note || '');
    } else {
      setEditingAppt(null);
      setApptDate(new Date().toISOString().split('T')[0]);
      setApptTime('17:00');
      setApptType('كشف ومتابعة');
      setApptDoctor('د. العيادة');
      setApptDuration(30);
      setApptNotes('');
    }
    setIsApptModalOpen(true);
  };

  const handleSaveApptSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!onSaveAppointment) return;

    onSaveAppointment({
      id: editingAppt ? editingAppt.id : undefined,
      patientId: patient.id,
      fileNo: patient.id,
      patientName: patient.name,
      mobile: patient.mobile,
      date: apptDate,
      time: apptTime,
      doctorName: apptDoctor.trim() || 'د. العيادة',
      durationMinutes: apptDuration,
      appointmentType: apptType,
      note: apptNotes.trim() || 'كشف ومتابعة',
      isFollowUp: false,
      isWalkIn: false,
      status: editingAppt ? editingAppt.status : 'scheduled'
    });

    setIsApptModalOpen(false);
    showToast(editingAppt ? 'تم تعديل الموعد بنجاح' : 'تم إضافة الموعد بنجاح لملف المريض', 'success');
  };

  // Service Form State
  const [serviceType, setServiceType] = useState(serviceTypes[0] || 'حشو ليزر');

  // Bridge Range fields for Fixed Crowns
  const [bridgeEndToothNum, setBridgeEndToothNum] = useState<number>(1);
  const [labId, setLabId] = useState<string>(labs[0]?.id || '');
  const [crownType, setCrownType] = useState<string>('زيركون');

  const [manualAmount, setManualAmount] = useState<number | ''>('');
  const [paidNow, setPaidNow] = useState<number | ''>('');
  const [serviceDate, setServiceDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [includeExaminationFee, setIncludeExaminationFee] = useState(false);
  const [examinationFeeAmount, setExaminationFeeAmount] = useState<number | ''>(200);
  const [treatmentStage, setTreatmentStage] = useState<NonNullable<Session['treatmentStage']>>('single');
  const [rootCanalStatus, setRootCanalStatus] = useState<NonNullable<Session['rootCanalStatus']>>('access_cleaning');
  const [serviceNotes, setServiceNotes] = useState('');

  // Payment Installment Form State
  const [paymentAmount, setPaymentAmount] = useState<number | ''>('');
  const [paymentDate, setPaymentDate] = useState<string>(new Date().toISOString().split('T')[0]);

  // Open Tooth Quick Service Bottom Sheet when a tooth is tapped on ToothChart
  const handleOpenToothSheet = (compositeToothId: string) => {
    setToothSheetId(compositeToothId);
    setSelectedToothId(compositeToothId);
    setServiceType('حشو ليزر');
    setManualAmount(600);
    setPaidNow('');
    setServiceDate(new Date().toISOString().split('T')[0]);
    setIncludeExaminationFee(false);
    setExaminationFeeAmount(200);
    setTreatmentStage('single');
    setRootCanalStatus('access_cleaning');
    setServiceNotes('');

    const parsed = parseCompositeToothId(compositeToothId);
    if (parsed) setBridgeEndToothNum(parsed.number);
  };

  // Standard modal opener
  const handleOpenServiceModal = (toothId?: string | null) => {
    if (toothId) {
      handleOpenToothSheet(toothId);
      return;
    }
    setSelectedToothId(null);
    setServiceType('حشو ليزر');
    setManualAmount('');
    setPaidNow('');
    setServiceDate(new Date().toISOString().split('T')[0]);
    setIncludeExaminationFee(false);
    setExaminationFeeAmount(200);
    setTreatmentStage('single');
    setRootCanalStatus('access_cleaning');
    setServiceNotes('');
    setIsServiceModalOpen(true);
  };

  const handleOpenPaymentModal = (session?: Session) => {
    if (session) {
      setSelectedSessionForPayment(session);
      setPaymentAmount(session.remain);
    } else {
      // Find first session with remaining balance, or default to overall remaining
      const sessWithBal = patient.sessions.find(s => s.remain > 0);
      setSelectedSessionForPayment(sessWithBal || (patient.sessions[0] || null));
      setPaymentAmount(sessWithBal ? sessWithBal.remain : totalRemain);
    }
    setPaymentDate(new Date().toISOString().split('T')[0]);
    setIsPaymentModalOpen(true);
  };

  // Fixed Crown Price & Teeth Range Calculation
  let calculatedCrownsCount = 1;
  let calculatedTeethIds: string[] = [];
  if (selectedToothId) {
    const { teethIds, count } = calculateToothBridgeRange(
      selectedToothId,
      `${selectedToothId.substring(0, 2)}${bridgeEndToothNum}`
    );
    calculatedTeethIds = teethIds;
    calculatedCrownsCount = count;
  }

  const crownUnitPrice = crownPrices[crownType] || 2200;
  const autoCrownsTotal = calculatedCrownsCount * crownUnitPrice;

  const handleSaveService = (e: React.FormEvent) => {
    e.preventDefault();

    let treatmentCost = 0;
    if (serviceType === 'تركيبات - ثابتة' && selectedToothId) {
      treatmentCost = typeof manualAmount === 'number' ? manualAmount : autoCrownsTotal;
    } else {
      treatmentCost = typeof manualAmount === 'number' ? manualAmount : 0;
    }

    const examFee = includeExaminationFee && typeof examinationFeeAmount === 'number'
      ? Math.max(0, examinationFeeAmount)
      : 0;
    const totalCost = treatmentCost + examFee;

    if (totalCost <= 0) {
      validationFail('serviceModal', 'input-service-amount', 'يرجى كتابة تكلفة الخدمة بصورة صحيحة');
      return;
    }

    const paidVal = typeof paidNow === 'number' ? paidNow : 0;
    if (paidVal > totalCost) {
      validationFail('serviceModal', 'input-paid-now', 'المبلغ المدفوع أكبر من التكلفة الكلية للخدمة');
      return;
    }

    const remainVal = Math.max(0, totalCost - paidVal);

    const newSession: Omit<Session, 'id'> = {
      type: serviceType,
      tooth: selectedToothId || undefined,
      teethIds: serviceType === 'تركيبات - ثابتة' && selectedToothId ? calculatedTeethIds : undefined,
      toothLabel: selectedToothId ? getToothLabel(selectedToothId) : 'بدون تحديد سنة',
      amount: totalCost,
      paid: paidVal,
      remain: remainVal,
      date: serviceDate,
      payDate: serviceDate,
      paymentsLog: paidVal > 0 ? [{ id: crypto.randomUUID(), amount: paidVal, date: serviceDate, paymentMethod: 'cash', createdAt: new Date().toISOString() }] : [],
      examinationFee: examFee,
      treatmentFee: treatmentCost,
      services: treatmentCost > 0 ? [{ id: crypto.randomUUID(), name: serviceType, price: treatmentCost }] : [],
      procedurePerformed: serviceType,
      visitNotes: serviceNotes.trim() || undefined,
      treatmentStage,
      rootCanalStatus: serviceType.includes('عصب') ? rootCanalStatus : undefined,
      paymentMethod: 'cash'
    };

    onSaveSession(patient.id, newSession);
    setIsServiceModalOpen(false);
    setToothSheetId(null);
    showToast('تم تسجيل الخدمة وتحديث المخطط بنجاح', 'success');
  };

  const handleSavePaymentInstallment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSessionForPayment) {
      showToast('يرجى اختيار الجلسة المراد تحصيل دفعة عليها', 'warning');
      return;
    }

    const amt = typeof paymentAmount === 'number' ? paymentAmount : 0;
    if (amt <= 0) {
      validationFail('paymentModal', 'input-payment-amount', 'يرجى كتابة مبلغ تحصيل صحيح');
      return;
    }

    if (amt > selectedSessionForPayment.remain) {
      validationFail('paymentModal', 'input-payment-amount', `المبلغ أكبر من المتبقي (${selectedSessionForPayment.remain} ج.م)`);
      return;
    }

    onAddPaymentInstallment(patient.id, selectedSessionForPayment.id, {
      amount: amt,
      date: paymentDate
    });
    setIsPaymentModalOpen(false);
    showToast('تم تسديد الدفعة المالية بنجاح', 'success');
  };

  const handleDeletePatientConfirmed = () => {
    askConfirm({
      title: 'حذف ملف المريض',
      message: `هل أنت متأكد من حذف ملف المريض (${patient.name}) بالكامل؟`,
      confirmLabel: 'حذف المريض',
      tone: 'danger',
      onConfirm: () => {
        onDeletePatient(patient.id);
        onBack();
        showToast(`تم حذف ملف المريض ${patient.name}`, 'warning');
      }
    });
  };

  const getWhatsAppUrl = () => {
    const defaultText = `مرحباً ${patient.name}، نتمنى لك دوام الصحة والعافية. عيادة ${clinicName}.`;
    return formatWhatsAppUrl(patient.mobile, defaultText);
  };

  // Status info for currently tapped tooth in ToothQuickSheet
  const toothSheetStatusInfo = useMemo(() => {
    if (!toothSheetId) return null;
    return getToothStatusForPatient(patient.sessions, toothSheetId);
  }, [toothSheetId, patient.sessions]);

  const renderVisitDetails = () => (
    <>
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <strong className="block text-xs text-slate-800">رسوم الكشف لهذه الزيارة</strong>
            <span className="text-[11px] text-slate-500">اختيارية وتُضاف مرة واحدة إلى إجمالي الزيارة</span>
          </div>
          <button
            type="button"
            onClick={() => setIncludeExaminationFee(value => !value)}
            className={`min-h-[44px] px-3 rounded-xl text-xs font-black border transition-colors ${includeExaminationFee ? 'bg-emerald-600 text-white border-emerald-700' : 'bg-white text-slate-700 border-slate-300'}`}
          >
            {includeExaminationFee ? 'تمت إضافة الكشف' : 'بدون كشف'}
          </button>
        </div>
        {includeExaminationFee && (
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">قيمة الكشف (ج.م)</label>
            <input
              type="number"
              min="0"
              value={examinationFeeAmount}
              onChange={e => setExaminationFeeAmount(e.target.value === '' ? '' : parseFloat(e.target.value))}
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-mono font-bold"
            />
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1">مرحلة العلاج</label>
          <select
            value={treatmentStage}
            onChange={e => setTreatmentStage(e.target.value as NonNullable<Session['treatmentStage']>)}
            className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold"
          >
            <option value="single">جلسة واحدة / مكتملة</option>
            <option value="first">الجلسة الأولى</option>
            <option value="second">الجلسة الثانية</option>
            <option value="third">الجلسة الثالثة</option>
            <option value="follow_up">جلسة متابعة</option>
          </select>
        </div>
        {serviceType.includes('عصب') && (
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">ما تم في علاج العصب</label>
            <select
              value={rootCanalStatus}
              onChange={e => setRootCanalStatus(e.target.value as NonNullable<Session['rootCanalStatus']>)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold"
            >
              <option value="access_cleaning">فتح وتنظيف القنوات</option>
              <option value="working_length">تحديد الأطوال وتجهيز القنوات</option>
              <option value="canal_filled">تم حشو العصب</option>
              <option value="impression">تم أخذ المقاس</option>
              <option value="final_restoration">تم الحشو / التركيب النهائي</option>
            </select>
          </div>
        )}
      </div>

      <div>
        <label className="block text-xs font-bold text-slate-700 mb-1">ملاحظات الجلسة</label>
        <textarea
          value={serviceNotes}
          onChange={e => setServiceNotes(e.target.value)}
          rows={2}
          placeholder="التشخيص، ما تم اليوم، وما المطلوب في الجلسة القادمة"
          className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs"
        />
      </div>

      <div className="flex items-center justify-between gap-3 rounded-xl bg-[#0f3d3e] px-3 py-2.5 text-white">
        <span className="text-xs font-bold">إجمالي الزيارة</span>
        <strong className="font-mono text-sm">
          {((typeof manualAmount === 'number' ? manualAmount : 0) + (includeExaminationFee && typeof examinationFeeAmount === 'number' ? examinationFeeAmount : 0)).toLocaleString()} ج.م
        </strong>
      </div>
    </>
  );

  return (
    <div className="space-y-4 pb-28 font-tajawal antialiased text-slate-800">

      {/* 1. Header & Profile Redesign (Mobile First, Desktop Grid) */}
      <div className="bg-white rounded-3xl p-4 sm:p-5 border border-slate-200/90 shadow-sm space-y-4">
        {/* Top Bar: Back Button & Quick Profile Actions */}
        <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-100">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs transition-colors cursor-pointer active:scale-95 touch-manipulation min-h-[44px]"
          >
            <ArrowRight className="w-4 h-4" />
            <span>{origin === 'appointments' ? 'جدول المواعيد' : 'فهرس الحالات'}</span>
          </button>

          <div className="flex items-center gap-2">
            <span className="text-xs font-mono font-black bg-[#0f3d3e] text-[#c9a227] px-2.5 py-1 rounded-xl shadow-2xs border border-teal-800">
              #{patient.id}
            </span>
            <button
              type="button"
              onClick={handleOpenEditPatient}
              className="p-2.5 min-h-[44px] min-w-[44px] rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition-all cursor-pointer flex items-center justify-center active:scale-95 touch-manipulation"
              title="تعديل البيانات"
            >
              <Edit3 className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleDeletePatientConfirmed}
              className="p-2.5 min-h-[44px] min-w-[44px] rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 transition-all cursor-pointer flex items-center justify-center active:scale-95 touch-manipulation"
              title="حذف الملف"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Compact Profile Identity Layout */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          {/* Avatar + Name + Demographics */}
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-[#0f3d3e] text-[#c9a227] flex items-center justify-center font-black text-xl shadow-inner shrink-0 border border-teal-800">
              {patient.name.substring(0, 2)}
            </div>

            <div className="space-y-1 min-w-0">
              <h1 className="text-lg sm:text-xl md:text-2xl font-black text-slate-900 truncate">
                {patient.name}
              </h1>

              {/* Compact Demographics Pills */}
              <div className="flex items-center gap-2 text-xs text-slate-600 flex-wrap">
                <span className="bg-slate-100 text-slate-800 px-2 py-0.5 rounded-lg border border-slate-200 font-bold">
                  {patient.age} سنة
                </span>
                <span className="bg-slate-100 text-slate-800 px-2 py-0.5 rounded-lg border border-slate-200 font-bold">
                  {patient.gender === 'female' ? 'أنثى' : 'ذكر'}
                </span>
                {patient.mobile && (
                  <span className="bg-emerald-50 text-emerald-900 px-2 py-0.5 rounded-lg border border-emerald-200 font-mono dir-ltr font-bold">
                    📱 {patient.mobile}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Quick Metrics Bar in Header (Visit info & Balance) */}
          <div className="flex items-center gap-3 bg-slate-50 p-3 rounded-2xl border border-slate-200/90 text-xs flex-wrap justify-between md:justify-end">
            <div>
              <span className="text-slate-400 block text-[11px] font-bold">أول زيارة</span>
              <span className="font-bold text-slate-800 font-mono">{firstVisitDate}</span>
            </div>
            <div className="h-6 w-px bg-slate-200" />
            <div>
              <span className="text-slate-400 block text-[11px] font-bold">آخر زيارة</span>
              <span className="font-bold text-slate-800 font-mono">{lastVisitDate}</span>
            </div>
            <div className="h-6 w-px bg-slate-200" />
            <div>
              <span className="text-slate-400 block text-[11px] font-bold">الجلسات</span>
              <span className="font-black text-[#0f3d3e]">{patient.sessions.length}</span>
            </div>
            <div className="h-6 w-px bg-slate-200" />
            <div>
              <span className="text-slate-400 block text-[11px] font-bold">المتبقي</span>
              <span className={`font-mono font-black ${totalRemain > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                {maskMoney(totalRemain)}
              </span>
            </div>
          </div>
        </div>

        {/* Medical Warning Banner if Allergy exists */}
        {patient.allergy && patient.allergy.trim() !== '' && (
          <div className="bg-rose-50 border border-rose-200 text-rose-950 p-3 rounded-2xl flex items-center gap-3 text-xs font-bold animate-fadeIn">
            <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0" />
            <span>تنبيه طبي وهام: المريض يعاني من ({patient.allergy})</span>
          </div>
        )}

        {/* 2. Quick Actions Row (4 Uniform Buttons in 1 Touch) */}
        <div className="grid grid-cols-4 gap-2 pt-1 border-t border-slate-100">
          {patient.mobile ? (
            <a
              href={`tel:${patient.mobile.replace(/\D/g, '')}`}
              className="flex flex-col sm:flex-row items-center justify-center gap-1.5 p-2.5 min-h-[44px] rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs transition-all cursor-pointer shadow-2xs active:scale-95 touch-manipulation text-center"
              title="اتصال مباشر"
            >
              <Phone className="w-4 h-4 shrink-0" />
              <span className="truncate">اتصال</span>
            </a>
          ) : (
            <button
              disabled
              className="flex flex-col sm:flex-row items-center justify-center gap-1.5 p-2.5 min-h-[44px] rounded-2xl bg-slate-200 text-slate-400 font-bold text-xs cursor-not-allowed text-center"
            >
              <Phone className="w-4 h-4 shrink-0" />
              <span className="truncate">اتصال</span>
            </button>
          )}

          {patient.mobile ? (
            <a
              href={getWhatsAppUrl()}
              target="_blank"
              rel="noreferrer"
              className="flex flex-col sm:flex-row items-center justify-center gap-1.5 p-2.5 min-h-[44px] rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs transition-all cursor-pointer shadow-2xs active:scale-95 touch-manipulation text-center"
              title="مراسلة واتساب"
            >
              <MessageCircle className="w-4 h-4 shrink-0" />
              <span className="truncate">واتساب</span>
            </a>
          ) : (
            <button
              disabled
              className="flex flex-col sm:flex-row items-center justify-center gap-1.5 p-2.5 min-h-[44px] rounded-2xl bg-slate-200 text-slate-400 font-bold text-xs cursor-not-allowed text-center"
            >
              <MessageCircle className="w-4 h-4 shrink-0" />
              <span className="truncate">واتساب</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => handleOpenAddApptModal()}
            className="flex flex-col sm:flex-row items-center justify-center gap-1.5 p-2.5 min-h-[44px] rounded-2xl bg-[#0f3d3e] hover:bg-[#134d4f] text-white font-black text-xs transition-all cursor-pointer shadow-2xs active:scale-95 touch-manipulation text-center"
          >
            <Calendar className="w-4 h-4 shrink-0" />
            <span className="truncate">حجز موعد</span>
          </button>

          <button
            type="button"
            onClick={handleOpenEditPatient}
            className="flex flex-col sm:flex-row items-center justify-center gap-1.5 p-2.5 min-h-[44px] rounded-2xl bg-[#c9a227] hover:bg-amber-600 text-slate-950 font-black text-xs transition-all cursor-pointer shadow-2xs active:scale-95 touch-manipulation text-center"
          >
            <Edit3 className="w-4 h-4 shrink-0" />
            <span className="truncate">تعديل البيانات</span>
          </button>
        </div>
      </div>

      {/* 3. Quick Summary Cards Row (Directly below Header, NO Tab required) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 sm:gap-3">
        <div className="bg-white p-3 rounded-2xl border border-slate-200/90 shadow-2xs flex flex-col justify-between">
          <span className="text-[11px] font-bold text-slate-500 block">عدد الجلسات</span>
          <span className="text-lg font-black text-[#0f3d3e] mt-1">{patient.sessions.length}</span>
        </div>

        <div className="bg-white p-3 rounded-2xl border border-slate-200/90 shadow-2xs flex flex-col justify-between">
          <span className="text-[11px] font-bold text-slate-500 block">الأسنان المعالجة</span>
          <span className="text-lg font-black text-amber-700 mt-1">{treatedTeethCount}</span>
        </div>

        <div className="bg-white p-3 rounded-2xl border border-slate-200/90 shadow-2xs flex flex-col justify-between">
          <span className="text-[11px] font-bold text-slate-500 block">حالات المعمل</span>
          <span className="text-lg font-black text-teal-700 mt-1">{labCasesCount}</span>
        </div>

        <div className="bg-white p-3 rounded-2xl border border-slate-200/90 shadow-2xs flex flex-col justify-between">
          <span className="text-[11px] font-bold text-slate-500 block">آخر زيارة</span>
          <span className="text-xs font-black text-slate-800 font-mono mt-1">{lastVisitDate}</span>
        </div>

        <div className="bg-white p-3 rounded-2xl border border-slate-200/90 shadow-2xs flex flex-col justify-between">
          <span className="text-[11px] font-bold text-slate-500 block">إجمالي المطلوب</span>
          <span className="text-xs font-mono font-black text-slate-900 mt-1">{maskMoney(totalRequired)}</span>
        </div>

        <div className="bg-white p-3 rounded-2xl border border-slate-200/90 shadow-2xs flex flex-col justify-between">
          <span className="text-[11px] font-bold text-slate-500 block">المدفوع</span>
          <span className="text-xs font-mono font-black text-emerald-700 mt-1">{maskMoney(totalPaid)}</span>
        </div>

        <div className="bg-white p-3 rounded-2xl border border-slate-200/90 shadow-2xs flex flex-col justify-between col-span-2 sm:col-span-1">
          <span className="text-[11px] font-bold text-slate-500 block">المتبقي</span>
          <span className={`text-xs font-mono font-black mt-1 ${totalRemain > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
            {maskMoney(totalRemain)}
          </span>
        </div>
      </div>

      {/* 4. Sticky Segmented Control Tabs */}
      <div className="sticky top-2 z-30 bg-white/95 backdrop-blur-md p-1.5 rounded-2xl border border-slate-200/90 shadow-md">
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5">
          <button
            type="button"
            onClick={() => setActiveTab('chart')}
            className={`px-3.5 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer min-h-[44px] touch-manipulation ${
              activeTab === 'chart'
                ? 'bg-[#0f3d3e] text-white shadow-xs'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <span>🦷</span>
            <span>المخطط الطبي</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('sessions')}
            className={`px-3.5 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer min-h-[44px] touch-manipulation ${
              activeTab === 'sessions'
                ? 'bg-[#0f3d3e] text-white shadow-xs'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <span>📝</span>
            <span>الجلسات</span>
            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold ${activeTab === 'sessions' ? 'bg-[#c9a227] text-slate-950' : 'bg-slate-200 text-slate-700'}`}>
              {patient.sessions.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('appointments')}
            className={`px-3.5 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer min-h-[44px] touch-manipulation ${
              activeTab === 'appointments'
                ? 'bg-[#0f3d3e] text-white shadow-xs'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <span>📅</span>
            <span>المواعيد</span>
            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold ${activeTab === 'appointments' ? 'bg-[#c9a227] text-slate-950' : 'bg-slate-200 text-slate-700'}`}>
              {patientAppointments.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('finance')}
            className={`px-3.5 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer min-h-[44px] touch-manipulation ${
              activeTab === 'finance'
                ? 'bg-[#0f3d3e] text-white shadow-xs'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <span>💰</span>
            <span>المالية والرصيد</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('prescription')}
            className={`px-3.5 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer min-h-[44px] touch-manipulation ${
              activeTab === 'prescription'
                ? 'bg-[#0f3d3e] text-white shadow-xs'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <span>💊</span>
            <span>الروشتة</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('info')}
            className={`px-3.5 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer min-h-[44px] touch-manipulation ${
              activeTab === 'info'
                ? 'bg-[#0f3d3e] text-white shadow-xs'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <span>👤</span>
            <span>معلومات الملف</span>
          </button>
        </div>
      </div>

      {/* 5. Main Views Grid (Desktop Multi-Column / Mobile Stacked) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6 pt-2">

        {/* Desktop Sidebar Info Column (4 Cols on LG) */}
        <div className="hidden lg:block lg:col-span-4 space-y-4">
          {/* Quick Demographics & Notes Card */}
          <div className="bg-white p-5 rounded-3xl border border-slate-200/90 shadow-sm space-y-4 sticky top-20">
            <h3 className="text-sm font-black text-[#0f3d3e] flex items-center gap-2 border-b border-slate-100 pb-2.5">
              <span>👤 ملخص بياني وسريع</span>
            </h3>

            {/* Financial Balance Progress Meter */}
            <div className="space-y-2 bg-slate-50 p-4 rounded-2xl border border-slate-200/80">
              <span className="text-xs font-black text-slate-800 block">الموقف المالي العام:</span>
              <BalanceProgressMeter
                total={totalRequired}
                paid={totalPaid}
                remaining={totalRemain}
                size="md"
                type="patient"
              />
            </div>

            {/* Quick Demographics */}
            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500 font-bold">رقم الملف:</span>
                <span className="font-mono font-bold text-slate-900">#{patient.id}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500 font-bold">تاريخ الميلاد والسن:</span>
                <span className="font-bold text-slate-900">{patient.age} سنة ({patient.gender === 'female' ? 'أنثى' : 'ذكر'})</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500 font-bold">الهاتف:</span>
                <span className="font-mono dir-ltr font-bold text-slate-900">{patient.mobile || '—'}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500 font-bold">أول زيارة:</span>
                <span className="font-mono font-bold text-slate-900">{firstVisitDate}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500 font-bold">آخر زيارة:</span>
                <span className="font-mono font-bold text-slate-900">{lastVisitDate}</span>
              </div>
            </div>

            {/* General Notes */}
            <div className="space-y-1 bg-amber-50/60 p-3 rounded-2xl border border-amber-200/80">
              <span className="text-xs font-black text-amber-900 block">ملاحظات الملف العامة:</span>
              <p className="text-xs text-amber-950 leading-relaxed">
                {patient.notes || 'لا توجد ملاحظات مدونة.'}
              </p>
            </div>

            {/* Direct Actions */}
            <div className="space-y-2 pt-2">
              <button
                type="button"
                onClick={() => handleOpenServiceModal()}
                className="w-full py-3 rounded-2xl bg-[#0f3d3e] hover:bg-[#134d4f] text-white text-xs font-black flex items-center justify-center gap-2 transition-all cursor-pointer shadow-2xs min-h-[44px]"
              >
                <Plus className="w-4 h-4" />
                <span>تسجيل خدمة عامة</span>
              </button>

              <button
                type="button"
                onClick={() => handleOpenPaymentModal()}
                className="w-full py-3 rounded-2xl bg-[#c9a227] hover:bg-amber-600 text-slate-950 text-xs font-black flex items-center justify-center gap-2 transition-all cursor-pointer shadow-2xs min-h-[44px]"
              >
                <Wallet className="w-4 h-4" />
                <span>تحصيل دفعة مالية</span>
              </button>
            </div>
          </div>
        </div>

        {/* Main Content Area (8 Cols on LG, 12 Cols on Mobile) */}
        <div className="col-span-1 lg:col-span-8 space-y-4">

          {/* 5.1 Tooth Chart Tab & Selected Tooth Card */}
          {activeTab === 'chart' && (
            <div className="space-y-4">
              <ToothChart
                patient={patient}
                onOpenAddSessionModal={handleOpenToothSheet}
                selectedToothId={selectedToothId}
                onSelectTooth={setSelectedToothId}
              />

              {/* Selected Tooth Panel Card */}
              {selectedToothId && (
                <div id="selected-tooth-panel" className="bg-white rounded-3xl p-5 sm:p-6 border-2 border-[#0f3d3e]/20 shadow-md space-y-4 animate-fadeIn">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-2xl bg-[#0f3d3e] text-[#c9a227] font-black text-lg flex items-center justify-center shrink-0 shadow-xs">
                        🦷
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono font-black bg-amber-100 text-amber-900 px-2 py-0.5 rounded-md border border-amber-300">
                            سن #{selectedToothId}
                          </span>
                          <span className="text-xs font-bold text-slate-500">
                            {selectedToothStatus?.status === 'normal' ? 'سليم' : selectedToothStatus?.status}
                          </span>
                        </div>
                        <h3 className="text-base sm:text-lg font-black text-slate-900 mt-0.5">
                          {getToothLabel(selectedToothId)}
                        </h3>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleOpenServiceModal(selectedToothId)}
                      className="px-4 py-2.5 rounded-2xl bg-[#0f3d3e] hover:bg-[#134d4f] text-white font-black text-xs flex items-center gap-2 transition-all cursor-pointer shadow-md min-h-[44px] active:scale-95 touch-manipulation w-full sm:w-auto justify-center"
                    >
                      <Plus className="w-4 h-4 text-[#c9a227]" />
                      <span>تسجيل خدمة</span>
                    </button>
                  </div>

                  {/* Summary Stats for Selected Tooth */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200">
                      <span className="text-slate-500 block">عدد الخدمات:</span>
                      <span className="font-black text-slate-900 text-sm mt-0.5 block">{selectedToothSessions.length}</span>
                    </div>

                    <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200">
                      <span className="text-slate-500 block">آخر إجراء:</span>
                      <span className="font-bold text-[#0f3d3e] text-xs truncate mt-0.5 block">
                        {selectedToothStatus?.lastSessionType || 'لا يوجد'}
                      </span>
                    </div>

                    <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200">
                      <span className="text-slate-500 block">المدفوع لها:</span>
                      <span className="font-mono font-black text-emerald-700 text-xs mt-0.5 block">
                        {maskMoney(selectedToothFinancials.pd)}
                      </span>
                    </div>

                    <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200">
                      <span className="text-slate-500 block">المتبقي لها:</span>
                      <span className={`font-mono font-black text-xs mt-0.5 block ${selectedToothFinancials.rem > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                        {maskMoney(selectedToothFinancials.rem)}
                      </span>
                    </div>
                  </div>

                  {/* Timeline for services on this tooth */}
                  <div className="pt-2">
                    <h4 className="text-xs font-black text-slate-800 mb-2.5 flex items-center gap-1.5">
                      <History className="w-4 h-4 text-[#0f3d3e]" />
                      <span>سجل خدمات هذا السن ({selectedToothSessions.length}):</span>
                    </h4>

                    {selectedToothSessions.length === 0 ? (
                      <p className="text-xs text-slate-500 italic p-4 bg-slate-50 rounded-2xl border border-dashed border-slate-300 text-center">
                        لا توجد خدمات مسجلة لهذا السن.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {selectedToothSessions.map(s => (
                          <div
                            key={s.id}
                            className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 flex items-center justify-between text-xs"
                          >
                            <div className="space-y-0.5">
                              <span className="font-black text-[#0f3d3e] text-sm">{s.type}</span>
                              <span className="text-slate-500 font-mono block text-[11px]">📅 التاريخ: {s.date}</span>
                            </div>

                            <div className="text-left font-mono space-y-0.5 dir-ltr">
                              <div className="font-black text-slate-900">{maskMoney(s.amount)}</div>
                              <div className={s.remain > 0 ? 'text-rose-600 font-bold text-[11px]' : 'text-emerald-600 font-bold text-[11px]'}>
                                {s.remain > 0 ? `متبقي ${maskMoney(s.remain)}` : 'خالص السداد'}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 5.2 Sessions Timeline Tab */}
          {activeTab === 'sessions' && (
            <div className="bg-white rounded-3xl p-4 sm:p-6 border border-slate-200/90 shadow-sm space-y-5">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="text-base font-black text-[#0f3d3e] flex items-center gap-2">
                  <History className="w-5 h-5 text-[#0f3d3e]" />
                  <span>سجل الجلسات والخدمات العلاجية ({patient.sessions.length})</span>
                </h3>

                <button
                  type="button"
                  onClick={() => handleOpenServiceModal()}
                  className="px-3.5 py-2 rounded-xl bg-[#0f3d3e] hover:bg-[#134d4f] text-white font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs min-h-[44px] active:scale-95 touch-manipulation"
                >
                  <Plus className="w-4 h-4" />
                  <span>تسجيل خدمة</span>
                </button>
              </div>

              {patient.sessions.length === 0 ? (
                <div className="p-8 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-300 space-y-3">
                  <p className="text-xs font-bold text-slate-500">لا توجد أية خدمات علاجية مسجلة بعد لهذا المريض.</p>
                  <button
                    type="button"
                    onClick={() => handleOpenServiceModal()}
                    className="px-4 py-2.5 rounded-xl bg-[#0f3d3e] text-white text-xs font-bold cursor-pointer min-h-[44px]"
                  >
                    تسجيل أول خدمة علاجية
                  </button>
                </div>
              ) : (
                /* Vertical Timeline Layout for Sessions */
                <div className="relative pl-2 sm:pl-4 pr-2 sm:pr-4 py-2 space-y-6 before:absolute before:inset-0 before:left-6 sm:before:left-8 before:w-0.5 before:bg-slate-200">
                  {patient.sessions.map((s, idx) => {
                    const isExpanded = expandedSessionId === s.id;

                    return (
                      <div key={s.id} className="relative flex items-start gap-3 sm:gap-4 group">
                        {/* Timeline Circle Bullet */}
                        <div className="relative z-10 w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-[#0f3d3e] text-[#c9a227] flex items-center justify-center font-bold text-xs shrink-0 shadow-md">
                          🦷
                        </div>

                        {/* Timeline Content Card */}
                        <div className="flex-1 bg-slate-50 hover:bg-slate-100/80 rounded-2xl p-3.5 sm:p-4 border border-slate-200/90 transition-all space-y-3 shadow-2xs">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200/60 pb-2.5">
                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <h4 className="font-extrabold text-slate-900 text-sm sm:text-base">
                                  {s.type}
                                </h4>
                                {s.toothLabel && (
                                  <span className="text-[11px] bg-slate-200 text-slate-800 px-2 py-0.5 rounded-md font-bold">
                                    {s.toothLabel}
                                  </span>
                                )}
                              </div>
                              <span className="text-[11px] text-slate-500 font-mono block mt-0.5">
                                📅 تاريخ الجلسة: {s.date}
                              </span>
                            </div>

                            {/* Action & Meter */}
                            <div className="flex items-center gap-2 justify-end pt-2 sm:pt-0">
                              {s.remain > 0 && (
                                <button
                                  type="button"
                                  onClick={() => handleOpenPaymentModal(s)}
                                  className="px-3 py-1.5 min-h-[40px] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs transition-all cursor-pointer shadow-2xs active:scale-95 touch-manipulation flex items-center gap-1"
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                  <span>تحصيل دفعة</span>
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={() => setExpandedSessionId(isExpanded ? null : s.id)}
                                className="p-2 text-slate-500 hover:text-slate-800 cursor-pointer rounded-xl bg-white border border-slate-200"
                              >
                                {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                              </button>
                            </div>
                          </div>

                          {/* Financial Progress Meter for Session */}
                          <BalanceProgressMeter
                            total={s.amount}
                            paid={s.paid}
                            remaining={s.remain}
                            size="sm"
                            type="patient"
                          />

                          {/* Collapsible Payments Log */}
                          {isExpanded && (
                            <div className="bg-white p-3 rounded-xl border border-slate-200 space-y-2 animate-fadeIn text-xs">
                              <span className="font-bold text-slate-800 block">
                                حركات التحصيل المباشرة لهذه الخدمة ({s.paymentsLog?.length || 0}):
                              </span>

                              {!s.paymentsLog || s.paymentsLog.length === 0 ? (
                                <p className="text-slate-400 italic">لا توجد أية دفعات مسجلة بعد.</p>
                              ) : (
                                <div className="space-y-1.5">
                                  {s.paymentsLog.map((p, pIdx) => (
                                    <div
                                      key={p.id || pIdx}
                                      className="p-2 bg-emerald-50/60 rounded-lg border border-emerald-100 flex items-center justify-between font-mono font-bold text-slate-800"
                                    >
                                      <span>دفعة بتاريخ {p.date}</span>
                                      <span className="text-emerald-800">+{p.amount.toLocaleString()} ج.م</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* 5.3 Appointments Tab */}
          {activeTab === 'appointments' && (
            <div className="bg-white rounded-3xl p-4 sm:p-6 border border-slate-200/90 shadow-sm space-y-5">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="text-base font-black text-[#0f3d3e] flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-[#0f3d3e]" />
                  <span>سجل المواعيد والزيارات ({patientAppointments.length})</span>
                </h3>

                <button
                  type="button"
                  onClick={() => handleOpenAddApptModal()}
                  className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs min-h-[44px] active:scale-95 touch-manipulation"
                >
                  <Plus className="w-4 h-4" />
                  <span>حجز موعد</span>
                </button>
              </div>

              {patientAppointments.length === 0 ? (
                <div className="p-8 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-300 space-y-3">
                  <p className="text-xs font-bold text-slate-500">لا توجد أية مواعيد مجدولة لهذا المريض.</p>
                  <button
                    type="button"
                    onClick={() => handleOpenAddApptModal()}
                    className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold cursor-pointer min-h-[44px]"
                  >
                    حجز أول موعد
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {patientAppointments.map(appt => {
                    const statusCfg = APPOINTMENT_STATUS_CONFIGS[appt.status] || APPOINTMENT_STATUS_CONFIGS['scheduled'];
                    const StatusIcon = statusCfg.icon;

                    return (
                      <div
                        key={appt.id}
                        className={`p-3.5 sm:p-4 rounded-2xl border transition-all flex flex-col md:flex-row md:items-center justify-between gap-3.5 ${
                          appt.status === 'attended'
                            ? 'bg-emerald-50/60 border-emerald-200'
                            : appt.status === 'no_show'
                            ? 'bg-rose-50/60 border-rose-200'
                            : appt.status === 'apologized'
                            ? 'bg-orange-50/60 border-orange-200'
                            : appt.status === 'waiting'
                            ? 'bg-amber-50/60 border-amber-200'
                            : 'bg-white hover:bg-slate-50 border-slate-200 shadow-2xs'
                        }`}
                      >
                        <div className="flex items-start gap-3 min-w-0">
                          <div
                            className={`w-12 h-12 rounded-2xl flex flex-col items-center justify-center font-extrabold text-xs shrink-0 shadow-2xs ${statusCfg.activeBg}`}
                          >
                            <span>{appt.time}</span>
                          </div>

                          <div className="space-y-1 min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-extrabold text-slate-900 text-sm">
                                📅 {appt.date} ({appt.time})
                              </span>
                              {appt.note && (
                                <span className="text-[11px] bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md font-bold">
                                  📝 {appt.note}
                                </span>
                              )}
                            </div>

                            <p className="text-xs text-slate-600 font-medium">
                              👨‍⚕️ الطبيب: {appt.doctorName || 'د. العيادة'}
                            </p>
                          </div>
                        </div>

                        {/* Quick Action Buttons */}
                        <div className="flex items-center gap-2 flex-wrap self-stretch md:self-center shrink-0 justify-end pt-2 md:pt-0 border-t md:border-t-0 border-slate-100">
                          <button
                            type="button"
                            onClick={() => setPatientStatusModalAppt(appt)}
                            className={`px-3.5 py-2 min-h-[44px] rounded-xl text-xs font-extrabold flex items-center justify-center gap-1.5 transition-all cursor-pointer border active:scale-95 touch-manipulation shadow-2xs ${statusCfg.badgeBg}`}
                            title="تعديل حالة الموعد"
                          >
                            <StatusIcon className="w-4 h-4 shrink-0" />
                            <span>{statusCfg.label}</span>
                            <ChevronDown className="w-3.5 h-3.5 opacity-60 shrink-0" />
                          </button>

                          {patient.mobile && (
                            <a
                              href={`tel:${patient.mobile.replace(/\D/g, '')}`}
                              className="px-3 py-2 min-h-[44px] rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-800 font-bold text-xs flex items-center justify-center gap-1.5 transition-all border border-indigo-200 cursor-pointer active:scale-95 touch-manipulation"
                              title="اتصال هاتفي مباشر"
                            >
                              <Phone className="w-3.5 h-3.5 text-indigo-600" />
                              <span>اتصال</span>
                            </a>
                          )}

                          <button
                            type="button"
                            onClick={() => handleOpenAddApptModal(appt)}
                            className="px-3 py-2 min-h-[44px] rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs flex items-center justify-center gap-1 cursor-pointer active:scale-95 touch-manipulation"
                            title="تعديل تفاصيل الموعد"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            <span>تعديل</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              askConfirm({
                                title: 'تأكيد حذف الموعد',
                                message: `هل أنت متأكد من حذف موعد يوم (${appt.date} - ${appt.time}) نهائياً؟`,
                                confirmLabel: 'حذف الموعد',
                                tone: 'danger',
                                onConfirm: () => {
                                  if (onDeleteAppointment) onDeleteAppointment(appt.id);
                                  showToast('تم حذف الموعد بنجاح', 'warning');
                                }
                              });
                            }}
                            className="p-2.5 min-h-[44px] min-w-[44px] rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 cursor-pointer flex items-center justify-center active:scale-95 touch-manipulation"
                            title="حذف الموعد"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* 5.4 Financial Summary Tab */}
          {activeTab === 'finance' && (
            <div className="bg-white rounded-3xl p-4 sm:p-6 border border-slate-200/90 shadow-sm space-y-5">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="text-base font-black text-[#0f3d3e] flex items-center gap-2">
                  <DollarSign className="w-5 h-5 text-[#0f3d3e]" />
                  <span>الملخص المالي والرصيد المالي للمريض</span>
                </h3>

                <button
                  type="button"
                  onClick={() => handleOpenPaymentModal()}
                  className="px-3.5 py-2 rounded-xl bg-[#c9a227] hover:bg-amber-600 text-slate-950 font-black text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs min-h-[44px] active:scale-95 touch-manipulation"
                >
                  <Plus className="w-4 h-4" />
                  <span>تسديد دفعة</span>
                </button>
              </div>

              {/* Compact Metric Summary Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-1">
                  <span className="text-xs text-slate-500 font-bold block">إجمالي تكلفة العلاج:</span>
                  <span className="text-lg sm:text-xl font-black font-mono text-slate-900">
                    {maskMoney(totalRequired)}
                  </span>
                </div>

                <div className="p-4 bg-emerald-50/70 rounded-2xl border border-emerald-200 space-y-1">
                  <span className="text-xs text-emerald-700 font-bold block">المدفوع الكلي:</span>
                  <span className="text-lg sm:text-xl font-black font-mono text-emerald-900">
                    {maskMoney(totalPaid)}
                  </span>
                </div>

                <div className="p-4 bg-rose-50/70 rounded-2xl border border-rose-200 space-y-1">
                  <span className="text-xs text-rose-700 font-bold block">المتبقي المطلوب:</span>
                  <span className="text-lg sm:text-xl font-black font-mono text-rose-900">
                    {maskMoney(totalRemain)}
                  </span>
                </div>
              </div>

              {/* Progress Bar */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs font-bold text-slate-700">
                  <span>نسبة تحصيل المبالغ: {paidPercentage}%</span>
                  <span>{maskMoney(totalPaid)} من {maskMoney(totalRequired)}</span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden border border-slate-200">
                  <div
                    className="bg-emerald-500 h-full transition-all duration-500"
                    style={{ width: `${paidPercentage}%` }}
                  />
                </div>
              </div>

              {/* View Details Toggle Button */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setShowFinancialDetails(!showFinancialDetails)}
                  className="w-full py-3 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-extrabold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer min-h-[44px]"
                >
                  <span>{showFinancialDetails ? 'إخفاء تفاصيل المعاملات المالية' : 'عرض التفاصيل المالية وحركات الدفع'}</span>
                  {showFinancialDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
              </div>

              {/* Collapsible Detailed Financial Breakdown */}
              {showFinancialDetails && (
                <div className="pt-3 border-t border-slate-100 space-y-3 animate-fadeIn">
                  <h4 className="text-xs font-black text-slate-800">تفاصيل جلسات الخدمات والمبالغ المتبقية:</h4>
                  <div className="space-y-2">
                    {patient.sessions.map((s, idx) => (
                      <div
                        key={s.id || idx}
                        className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs font-bold"
                      >
                        <div>
                          <span className="text-slate-900 block">{s.type} ({s.toothLabel || 'بدون تحديد سنة'})</span>
                          <span className="text-slate-500 font-mono text-[11px]">تاريخ: {s.date}</span>
                        </div>

                        <div className="flex items-center gap-3 font-mono dir-ltr">
                          <span className="text-slate-600">التكلفة: {maskMoney(s.amount)}</span>
                          <span className="text-emerald-700">تم دفع: {maskMoney(s.paid)}</span>
                          <span className="text-rose-700">متبقي: {maskMoney(s.remain)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 5.5 Prescription & Instructions Tab */}
          {activeTab === 'prescription' && (
            <PrescriptionAndInstructionsView
              patient={patient}
              clinicName={clinicName}
              clinicLogo={clinicLogo}
              drugCatalog={drugCatalog}
            />
          )}

          {/* 5.6 Info & Demographics Tab */}
          {activeTab === 'info' && (
            <div className="bg-white rounded-3xl p-4 sm:p-6 border border-slate-200/90 shadow-sm space-y-4">
              <h3 className="text-base font-black text-[#0f3d3e]">
                معلومات الملف والملاحظات العامة
              </h3>

              {/* Communication Hub */}
              <div className="p-4 bg-indigo-50/60 rounded-2xl border border-indigo-100 space-y-3">
                <h4 className="text-xs font-black text-indigo-950 flex items-center gap-2">
                  <Phone className="w-4 h-4 text-indigo-600" />
                  <span>وسائل التواصل المباشر مع المريض</span>
                </h4>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <a
                    href={`tel:${patient.mobile?.replace(/\D/g, '') || ''}`}
                    className={`p-3 min-h-[48px] rounded-xl flex items-center justify-center gap-2 font-bold text-xs transition-all cursor-pointer shadow-2xs active:scale-95 touch-manipulation ${
                      patient.mobile ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'bg-slate-200 text-slate-400 pointer-events-none'
                    }`}
                  >
                    <Phone className="w-4 h-4" />
                    <span>اتصال تلفوني</span>
                  </a>

                  <a
                    href={getWhatsAppUrl()}
                    target="_blank"
                    rel="noreferrer"
                    className={`p-3 min-h-[48px] rounded-xl flex items-center justify-center gap-2 font-bold text-xs transition-all cursor-pointer shadow-2xs active:scale-95 touch-manipulation ${
                      patient.mobile ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-slate-200 text-slate-400 pointer-events-none'
                    }`}
                  >
                    <MessageCircle className="w-4 h-4" />
                    <span>واتساب</span>
                  </a>

                  <a
                    href={`sms:${patient.mobile?.replace(/\D/g, '') || ''}`}
                    className={`p-3 min-h-[48px] rounded-xl flex items-center justify-center gap-2 font-bold text-xs transition-all cursor-pointer border border-slate-200 active:scale-95 touch-manipulation ${
                      patient.mobile ? 'bg-white text-slate-800 hover:bg-slate-50' : 'bg-slate-200 text-slate-400 pointer-events-none'
                    }`}
                  >
                    <MessageSquare className="w-4 h-4 text-sky-600" />
                    <span>رسالة SMS</span>
                  </a>

                  <button
                    type="button"
                    onClick={() => {
                      if (patient.mobile) {
                        navigator.clipboard.writeText(patient.mobile);
                        showToast('تم نسخ رقم الموبايل للحافظة بنجاح', 'success');
                      } else {
                        showToast('لا يوجد رقم هاتف مسجل', 'warning');
                      }
                    }}
                    className="p-3 min-h-[48px] rounded-xl bg-white hover:bg-slate-50 text-slate-800 font-bold text-xs flex items-center justify-center gap-2 border border-slate-200 cursor-pointer transition-all active:scale-95 touch-manipulation"
                  >
                    <Copy className="w-4 h-4 text-slate-600" />
                    <span>نسخ الرقم</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div className="p-4 bg-slate-50 rounded-2xl space-y-2">
                  <span className="text-slate-500 block">الاسم الكامل:</span>
                  <span className="text-sm font-bold text-slate-900">{patient.name}</span>
                </div>

                <div className="p-4 bg-slate-50 rounded-2xl space-y-2">
                  <span className="text-slate-500 block">رقم الملف:</span>
                  <span className="text-sm font-bold font-mono text-[#0f3d3e]">#{patient.id}</span>
                </div>

                <div className="p-4 bg-slate-50 rounded-2xl space-y-2">
                  <span className="text-slate-500 block">رقم الموبايل:</span>
                  <span className="text-sm font-bold font-mono dir-ltr">{patient.mobile || '—'}</span>
                </div>

                <div className="p-4 bg-slate-50 rounded-2xl space-y-2">
                  <span className="text-slate-500 block">السن وتاريخ الزيارة الأولى:</span>
                  <span className="text-sm font-bold text-slate-900">{patient.age} سنة (زيارة أولى: {firstVisitDate})</span>
                </div>
              </div>

              <div className="p-4 bg-slate-50 rounded-2xl space-y-1">
                <span className="text-xs font-bold text-slate-700 block">ملاحظات العيادة العامة:</span>
                <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-line">
                  {patient.notes || 'لا توجد ملاحظات مدونة.'}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 6. Fixed Bottom Action Bar (Appears when a Tooth is Selected) */}
      {selectedToothId && (
        <div className="fixed bottom-3 left-3 right-3 sm:left-auto sm:right-6 sm:max-w-lg z-40 bg-[#0f3d3e] text-white p-3.5 rounded-3xl shadow-2xl border border-teal-700/80 flex items-center justify-between gap-3 animate-slideUp">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-[#c9a227] text-slate-950 font-black text-sm flex items-center justify-center shrink-0 shadow-xs">
              🦷
            </div>
            <div className="min-w-0">
              <span className="text-[11px] text-amber-300 font-mono font-bold block">سن #{selectedToothId}</span>
              <h4 className="text-xs font-black truncate">{getToothLabel(selectedToothId)}</h4>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => handleOpenServiceModal(selectedToothId)}
              className="px-3 py-2 rounded-xl bg-[#c9a227] hover:bg-amber-500 text-slate-950 font-black text-xs transition-all cursor-pointer shadow-xs active:scale-95 touch-manipulation min-h-[40px] flex items-center gap-1"
            >
              <Plus className="w-4 h-4" />
              <span>تسجيل خدمة</span>
            </button>

            <button
              type="button"
              onClick={() => handleOpenPaymentModal()}
              className="px-3 py-2 rounded-xl bg-teal-800 hover:bg-teal-700 text-white font-extrabold text-xs transition-all cursor-pointer min-h-[40px] flex items-center gap-1"
            >
              <Wallet className="w-3.5 h-3.5" />
              <span>إضافة دفعة</span>
            </button>

            <button
              type="button"
              onClick={() => setSelectedToothId(null)}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all cursor-pointer min-h-[40px] min-w-[40px] flex items-center justify-center"
              title="إلغاء التحديد"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* 7. Floating Action Button (FAB) to return to Dental Chart */}
      {activeTab !== 'chart' && (
        <button
          type="button"
          onClick={() => {
            setActiveTab('chart');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          className="fixed bottom-4 right-4 z-30 px-4 py-3 rounded-2xl bg-[#0f3d3e] text-[#c9a227] font-black text-xs shadow-xl border border-teal-700 flex items-center gap-2 hover:bg-[#134d4f] transition-all cursor-pointer active:scale-95 touch-manipulation min-h-[48px]"
        >
          <span className="text-base">🦷</span>
          <span>المخطط الطبي</span>
          <ArrowUp className="w-4 h-4 text-white" />
        </button>
      )}

      {/* 8. MODALS & BOTTOM SHEETS */}

      {/* 8.1 Tooth Details & Quick Service Bottom Sheet */}
      {toothSheetId && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end md:items-center md:justify-center bg-slate-900/60 backdrop-blur-xs p-0 md:p-4 animate-fadeIn">
          <div className="bg-white rounded-t-3xl md:rounded-3xl max-w-lg w-full p-5 sm:p-6 shadow-2xl border border-slate-200 space-y-4 max-h-[90dvh] overflow-y-auto modal-scroll animate-slideUp">
            {/* Sheet Drag Handle */}
            <div className="w-12 h-1.5 bg-slate-300 rounded-full mx-auto md:hidden" />

            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="text-2xl">🦷</span>
                <div>
                  <h2 className="text-base font-black text-[#0f3d3e]">
                    {getToothLabel(toothSheetId)}
                  </h2>
                  <span className="text-[11px] text-slate-500 block font-mono">
                    رمز السن: {toothSheetId}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setToothSheetId(null)}
                className="p-2 text-slate-400 hover:text-slate-600 cursor-pointer rounded-xl bg-slate-100 min-h-[44px] min-w-[44px] flex items-center justify-center"
              >
                ✕
              </button>
            </div>

            {/* Previous Treatment History Banner for this Tooth */}
            {toothSheetStatusInfo && (
              <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200/90 text-xs space-y-1">
                <span className="font-bold text-slate-800 block">سجل هذا السن بالمستندات:</span>
                {toothSheetStatusInfo.hasHistory ? (
                  <p className="text-slate-600">
                    آخر خدمة: <span className="font-bold text-[#0f3d3e]">{toothSheetStatusInfo.lastSessionType}</span> (بتاريخ {toothSheetStatusInfo.lastDate}) • إجمالي {toothSheetStatusInfo.sessionCount} جلسات مسجلة.
                  </p>
                ) : (
                  <p className="text-slate-500 italic">لا توجد أية خدمات علاجية سابقة مسجلة على هذا السن.</p>
                )}
              </div>
            )}

            {/* Quick Service Selection Options */}
            <div className="space-y-2">
              <span className="text-xs font-black text-slate-800 block">اختر نوع الخدمة السريعة:</span>
              <div className="grid grid-cols-3 gap-2">
                {QUICK_SERVICES.map(qs => (
                  <button
                    key={qs.id}
                    type="button"
                    onClick={() => {
                      setServiceType(qs.type);
                      setManualAmount(qs.price > 0 ? qs.price : '');
                    }}
                    className={`p-2.5 rounded-2xl border text-center transition-all cursor-pointer flex flex-col items-center justify-center gap-1 min-h-[64px] touch-manipulation ${
                      serviceType === qs.type
                        ? 'bg-[#0f3d3e] text-white border-[#0f3d3e] shadow-xs'
                        : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-800'
                    }`}
                  >
                    <span className="text-base">{qs.icon}</span>
                    <span className="text-[11px] font-bold leading-tight">{qs.name}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Quick Service Log Form */}
            <form onSubmit={handleSaveService} className="space-y-3 pt-2 border-t border-slate-100">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    التكلفة الكلية (ج.م)
                  </label>
                  <input
                    id="input-service-amount"
                    type="number"
                    value={manualAmount}
                    onChange={e => setManualAmount(e.target.value === '' ? '' : parseFloat(e.target.value))}
                    placeholder="المبلغ الإجمالي"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono font-bold focus:outline-none focus:border-[#0f3d3e]"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    المدفوع الآن (ج.م)
                  </label>
                  <input
                    id="input-paid-now"
                    type="number"
                    value={paidNow}
                    onChange={e => setPaidNow(e.target.value === '' ? '' : parseFloat(e.target.value))}
                    placeholder="0"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono font-bold focus:outline-none focus:border-[#0f3d3e]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  تاريخ الإجراء
                </label>
                <input
                  type="date"
                  value={serviceDate}
                  onChange={e => setServiceDate(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono focus:outline-none focus:border-[#0f3d3e]"
                />
              </div>

              {renderVisitDetails()}

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setToothSheetId(null)}
                  className="flex-1 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold cursor-pointer min-h-[44px] touch-manipulation"
                >
                  إلغاء وإغلاق
                </button>

                <button
                  type="submit"
                  className="flex-1 py-3 rounded-xl bg-[#0f3d3e] hover:bg-[#134d4f] text-white text-xs font-black cursor-pointer shadow-md min-h-[44px] touch-manipulation"
                >
                  حفظ الخدمة وتحديث المخطط
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 8.2 Standard Service Modal */}
      {isServiceModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-fadeIn">
          <div id="serviceModal" className="bg-white rounded-3xl max-w-lg w-full p-6 md:p-8 shadow-2xl border border-slate-200 space-y-5 max-h-[90dvh] overflow-y-auto modal-scroll">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h2 className="text-lg font-bold text-[#0f3d3e]">
                تسجيل خدمة طبية جديدة
              </h2>
              <button
                type="button"
                onClick={() => setIsServiceModalOpen(false)}
                className="p-2 text-slate-400 hover:text-slate-600 cursor-pointer rounded-xl bg-slate-100 min-h-[44px] min-w-[44px] flex items-center justify-center"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveService} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  نوع الخدمة الطبية
                </label>
                <select
                  value={serviceType}
                  onChange={e => setServiceType(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-bold focus:outline-none focus:border-[#0f3d3e]"
                >
                  {serviceTypes.map(st => (
                    <option key={st} value={st}>{st}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  إجمالي سعر الخدمة (ج.م) <span className="text-rose-500">*</span>
                </label>
                <input
                  id="input-service-amount"
                  type="number"
                  value={manualAmount}
                  onChange={e => setManualAmount(e.target.value === '' ? '' : parseFloat(e.target.value))}
                  placeholder="أكتب المبلغ الإجمالي"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-mono focus:outline-none focus:border-[#0f3d3e]"
                />
              </div>

              {renderVisitDetails()}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    المدفوع الآن (ج.م)
                  </label>
                  <input
                    id="input-paid-now"
                    type="number"
                    value={paidNow}
                    onChange={e => setPaidNow(e.target.value === '' ? '' : parseFloat(e.target.value))}
                    placeholder="0"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-mono focus:outline-none focus:border-[#0f3d3e]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    تاريخ الخدمة
                  </label>
                  <input
                    type="date"
                    value={serviceDate}
                    onChange={e => setServiceDate(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-mono focus:outline-none focus:border-[#0f3d3e]"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsServiceModalOpen(false)}
                  className="px-4 py-2.5 text-xs font-bold text-slate-600 bg-slate-100 rounded-xl cursor-pointer min-h-[44px]"
                >
                  إلغاء وإغلاق
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-[#0f3d3e] text-white text-xs font-extrabold shadow-md cursor-pointer min-h-[44px]"
                >
                  حفظ الخدمة وتحديث المخطط
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 8.3 Payment Modal */}
      {isPaymentModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-fadeIn">
          <div id="paymentModal" className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h2 className="text-base font-black text-[#0f3d3e]">
                تحصيل دفعة مالية جديدة
              </h2>
              <button
                type="button"
                onClick={() => setIsPaymentModalOpen(false)}
                className="p-2 text-slate-400 hover:text-slate-600 cursor-pointer rounded-xl bg-slate-100 min-h-[44px] min-w-[44px] flex items-center justify-center"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSavePaymentInstallment} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  اختر الجلسة المستهدفة للدفعة
                </label>
                <select
                  value={selectedSessionForPayment?.id || ''}
                  onChange={e => {
                    const sess = patient.sessions.find(s => s.id === e.target.value);
                    if (sess) {
                      setSelectedSessionForPayment(sess);
                      setPaymentAmount(sess.remain);
                    }
                  }}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold focus:outline-none focus:border-[#0f3d3e]"
                >
                  {patient.sessions.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.type} ({s.toothLabel || 'عام'}) — المتبقي: {s.remain} ج.م
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  المبلغ المحصل الآن (ج.م) <span className="text-rose-500">*</span>
                </label>
                <input
                  id="input-payment-amount"
                  type="number"
                  value={paymentAmount}
                  onChange={e => setPaymentAmount(e.target.value === '' ? '' : parseFloat(e.target.value))}
                  placeholder="أدخل مبلغ التحصيل"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-mono focus:outline-none focus:border-[#0f3d3e]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  تاريخ التحصيل
                </label>
                <input
                  type="date"
                  value={paymentDate}
                  onChange={e => setPaymentDate(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-mono focus:outline-none focus:border-[#0f3d3e]"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsPaymentModalOpen(false)}
                  className="px-4 py-2.5 text-xs font-bold text-slate-600 bg-slate-100 rounded-xl cursor-pointer min-h-[44px]"
                >
                  إلغاء وإغلاق
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black shadow-md cursor-pointer min-h-[44px]"
                >
                  تأكيد التحصيل
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 8.4 Appointment Modal */}
      {isApptModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-fadeIn">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h2 className="text-base font-black text-[#0f3d3e]">
                {editingAppt ? 'تعديل موعد العيادة' : 'حجز موعد جديد للمريض'}
              </h2>
              <button
                type="button"
                onClick={() => setIsApptModalOpen(false)}
                className="p-2 text-slate-400 hover:text-slate-600 cursor-pointer rounded-xl bg-slate-100 min-h-[44px] min-w-[44px] flex items-center justify-center"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveApptSubmit} className="space-y-4 text-xs font-bold">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 mb-1">التاريخ</label>
                  <input
                    type="date"
                    value={apptDate}
                    onChange={e => setApptDate(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-mono"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 mb-1">الوقت</label>
                  <input
                    type="time"
                    value={apptTime}
                    onChange={e => setApptTime(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-700 mb-1">نوع الكشف / الزيارة</label>
                <input
                  type="text"
                  value={apptType}
                  onChange={e => setApptType(e.target.value)}
                  placeholder="مثال: حشو ليزر، كشف دوري..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                />
              </div>

              <div>
                <label className="block text-slate-700 mb-1">الطبيب المعالج</label>
                <input
                  type="text"
                  value={apptDoctor}
                  onChange={e => setApptDoctor(e.target.value)}
                  placeholder="د. العيادة"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                />
              </div>

              <div>
                <label className="block text-slate-700 mb-1">ملاحظات الموعد</label>
                <textarea
                  value={apptNotes}
                  onChange={e => setApptNotes(e.target.value)}
                  rows={2}
                  placeholder="أدخل أية تفاصيل خاصة بالزيارة..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsApptModalOpen(false)}
                  className="px-4 py-2.5 text-xs font-bold text-slate-600 bg-slate-100 rounded-xl cursor-pointer min-h-[44px]"
                >
                  إلغاء وإغلاق
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black shadow-md cursor-pointer min-h-[44px]"
                >
                  حفظ الموعد
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 8.5 Edit Patient Demographics Modal */}
      {isEditPatientModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-fadeIn">
          <div id="editPatientModal" className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4 max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h2 className="text-base font-black text-[#0f3d3e]">
                تعديل بيانات ملف المريض #{patient.id}
              </h2>
              <button
                type="button"
                onClick={() => setIsEditPatientModalOpen(false)}
                className="p-2 text-slate-400 hover:text-slate-600 cursor-pointer rounded-xl bg-slate-100 min-h-[44px] min-w-[44px] flex items-center justify-center"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSavePatientEdit} className="space-y-3 text-xs font-bold">
              <div>
                <label className="block text-slate-700 mb-1">اسم المريض</label>
                <input
                  id="input-edit-patient-name"
                  type="text"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-xl font-bold"
                />
              </div>

              <div>
                <label className="block text-slate-700 mb-1">رقم الهاتف / الموبايل</label>
                <input
                  type="text"
                  value={editMobile}
                  onChange={e => setEditMobile(e.target.value)}
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-xl font-mono dir-ltr"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 mb-1">السن (بالسنوات)</label>
                  <input
                    type="number"
                    value={editAge}
                    onChange={e => setEditAge(parseInt(e.target.value, 10) || 0)}
                    className="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-xl font-mono"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 mb-1">الجنس</label>
                  <select
                    value={editGender}
                    onChange={e => setEditGender(e.target.value as any)}
                    className="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                  >
                    <option value="male">ذكر</option>
                    <option value="female">أنثى</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-700 mb-1">التنبيه الطبي / الحساسية (إن وجد)</label>
                <input
                  type="text"
                  value={editAllergy}
                  onChange={e => setEditAllergy(e.target.value)}
                  placeholder="مثال: حساسية بنيسيلين، ضغط الدم..."
                  className="w-full px-3.5 py-2 bg-rose-50 border border-rose-200 rounded-xl text-rose-900"
                />
              </div>

              <div>
                <label className="block text-slate-700 mb-1">الملاحظات العامة</label>
                <textarea
                  value={editNotes}
                  onChange={e => setEditNotes(e.target.value)}
                  rows={2}
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsEditPatientModalOpen(false)}
                  className="px-4 py-2.5 text-xs font-bold text-slate-600 bg-slate-100 rounded-xl cursor-pointer min-h-[44px]"
                >
                  إلغاء وإغلاق
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-[#0f3d3e] hover:bg-[#134d4f] text-white text-xs font-black shadow-md cursor-pointer min-h-[44px]"
                >
                  حفظ البيانات
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Appointment Status Bottom Sheet / Modal */}
      <AppointmentStatusModal
        appointment={patientStatusModalAppt}
        onClose={() => setPatientStatusModalAppt(null)}
        onSelectStatus={handlePatientSelectStatus}
      />
    </div>
  );
});

PatientFileView.displayName = 'PatientFileView';
