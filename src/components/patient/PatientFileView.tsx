import React, { useState, useMemo, useEffect } from 'react';
import {
  Patient, NavigationOrigin, Session, Lab, LabCase, PaymentInstallment,
  DrugCatalogItem, Appointment, AppointmentStatus, WhatsappSettings
} from '../../types';
import { ToothChart } from './ToothChart';
import { WhatsAppComposer } from './WhatsAppComposer';
import { PrescriptionAndInstructionsView } from './PrescriptionAndInstructionsView';
import { ProstheticOrderForm } from '../ProstheticOrderForm';
import type { ProstheticOrderInput } from '../../utils/prostheticWorkflow';
import {
  ArrowRight, Phone, MessageCircle, Edit3, Trash2, Plus,
  ChevronDown, ChevronUp, DollarSign, Microscope, Calendar, CheckCircle,
  Clock, Copy, Send, CheckCircle2, UserCheck, XCircle, Share2, Mail,
  MessageSquare, MoreHorizontal, Sparkles, Activity, FileText, Check,
  AlertTriangle, X, Wallet, History, ChevronRight, ArrowUp, Layers, Eye
} from 'lucide-react';
import { useToastAndConfirm } from '../common/ToastAndConfirm';
import { useConfirmedAction } from '../common/useConfirmedAction';
import { ExaminationFeeToggle } from '../common/ExaminationFeeToggle';
import { ToothSelectionGrid } from '../common/ToothSelectionGrid';
import {
  parseCompositeToothId, getToothLabel,
  getToothStatusForPatient, sessionIncludesTooth, getSessionToothProcedure
} from '../../utils/toothUtils';
import { BalanceProgressMeter } from '../common/FinancialBadge';
import { PatientFinancialOverview } from './PatientFinancialOverview';
import { DEFAULT_EXAMINATION_FEE, getClinicalServicePrice, getServiceGroup, parseCatalogPrice } from '../../utils/serviceCatalog';
import { buildAppointmentReminderText, cleanEgyptianPhone } from '../../utils/whatsappUtils';
import { normalizeContactPhone } from '../../utils/clinicContacts';
import { AppointmentStatusModal, APPOINTMENT_STATUS_CONFIGS } from '../appointments/AppointmentStatusModal';
import { getPatientFinancialSummary, getSessionCollected } from '../../utils/financials';
import { getPatientCollectionPresentation, getPatientSessionReceiptLimit } from '../../utils/patientCollection';
import { appointmentTimeMinutes, findAppointmentConflicts, isValidAppointmentDate } from '../appointments/appointmentScheduling';
import '../patients/patientDirectory.css';
import './patientFile.css';

const clinicToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const sessionBalance = (session: Session) => Math.max(0, session.amount - (session.discount || 0) - getSessionCollected(session));

export interface PatientFileCapabilities {
  patientEdit?: boolean;
  registerPayment?: boolean;
  appointments?: boolean;
  deletePatients?: boolean;
  rx?: boolean;
  whatsapp?: boolean;
  viewRemainingBalance?: boolean;
  exportData?: boolean;
}

interface PatientFileViewProps {
  patient: Patient;
  appointments?: Appointment[];
  origin: NavigationOrigin;
  serviceTypes: string[];
  labs: Lab[];
  crownPrices: Record<string, number>;
  clinicalPrices?: Record<string, number>;
  examinationFee?: number;
  isPrivacyMode?: boolean;
  capabilities?: PatientFileCapabilities;
  clinicName?: string;
  whatsappSettings: WhatsappSettings;
  clinicLogo?: string | null;
  drugCatalog?: DrugCatalogItem[];
  onSaveSession: (patientId: string, session: Omit<Session, 'id'>) => void | Promise<void>;
  onSaveProstheticOrder?: (input: ProstheticOrderInput) => void | Promise<void>;
  onAddPaymentInstallment: (patientId: string, sessionId: string, installment: { amount: number; date: string }) => void | Promise<void>;
  onUpdatePatient: (patientData: Omit<Patient, 'sessions' | 'payments'>, baseline?: Patient) => void | Promise<void>;
  onDeletePatient: (patientId: string) => void | Promise<void>;
  onSaveAppointment?: (appt: Omit<Appointment, 'id'> & { id?: string }, baseline?: Appointment) => void | Promise<void>;
  onUpdateApptStatus?: (apptId: string, status: AppointmentStatus) => void | Promise<void>;
  onDeleteAppointment?: (apptId: string) => void | Promise<void>;
  onAuthorizeWhatsappSend?: (request: { isCampaign: boolean; requiresFinance: boolean }) => void;
  onAuthorizePrint?: () => void;
  onBack: () => void;
}

export const PatientFileView: React.FC<PatientFileViewProps> = React.memo(({
  patient,
  appointments = [],
  origin,
  serviceTypes,
  labs,
  crownPrices,
  clinicalPrices = {},
  examinationFee = DEFAULT_EXAMINATION_FEE,
  isPrivacyMode = false,
  capabilities,
  clinicName = 'عيادة الأسنان',
  whatsappSettings,
  clinicLogo = null,
  drugCatalog = [],
  onSaveSession,
  onSaveProstheticOrder,
  onAddPaymentInstallment,
  onUpdatePatient,
  onDeletePatient,
  onSaveAppointment,
  onUpdateApptStatus,
  onDeleteAppointment,
  onAuthorizeWhatsappSend,
  onAuthorizePrint,
  onBack
}) => {
  const { showToast, askConfirm, validationFail } = useToastAndConfirm();
  const canEditPatients = capabilities?.patientEdit === true;
  const canRegisterPayment = capabilities?.registerPayment === true;
  const canManageAppointments = capabilities?.appointments === true && Boolean(onSaveAppointment);
  const canDeletePatients = capabilities?.deletePatients === true;
  const canUseRx = capabilities?.rx === true;
  const canUseWhatsApp = capabilities?.whatsapp === true;
  const canViewRemainingBalance = capabilities?.viewRemainingBalance === true;
  const canRevealRemainingBalance = canViewRemainingBalance && !isPrivacyMode;
  const contactPhone = normalizeContactPhone(patient.mobile || '');
  const telephoneNumber = contactPhone ? (contactPhone.startsWith('20') ? `0${contactPhone.slice(2)}` : `+${contactPhone}`) : '';
  const patientGender = patient.gender === 'female' || patient.gender === 'أنثى' ? 'أنثى'
    : patient.gender === 'male' || patient.gender === 'ذكر' ? 'ذكر' : '';

  // Primary Active Tab State
  const [activeTab, setActiveTab] = useState<'chart' | 'sessions' | 'appointments' | 'finance' | 'prescription' | 'info'>('chart');

  // Selected Tooth State (shared between ToothChart & SelectedToothPanel & Bottom Action Bar)
  const [selectedToothId, setSelectedToothId] = useState<string | null>(null);

  // Secondary UI Controls
  const [isWhatsAppOpen, setIsWhatsAppOpen] = useState(false);
  const [showFinancialDetails, setShowFinancialDetails] = useState(true);
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);

  // Financial Calculations
  const financialSummary = useMemo(() => getPatientFinancialSummary(patient), [patient]);
  const totalRequired = Math.max(0, financialSummary.totalRequired - financialSummary.totalDiscounts);
  const totalPaid = financialSummary.totalCollected;
  const totalRemain = financialSummary.totalRemaining;

  const maskMoney = (amount: number) => {
    if (isPrivacyMode) return '*** ج.م';
    return `${amount.toLocaleString()} ج.م`;
  };
  const maskRemaining = (amount: number) => canViewRemainingBalance ? maskMoney(amount) : '*** ج.م';

  // Demographics & Visit stats
  const firstVisitDate = useMemo(() => {
    if (patient.firstVisit) return patient.firstVisit;
    if (patient.sessions.length > 0) return [...patient.sessions.map(session => session.date)].sort()[0];
    return '—';
  }, [patient.firstVisit, patient.sessions]);

  const lastVisitDate = useMemo(() => {
    const dates: string[] = [];
    if (patient.sessions.length > 0) dates.push(...patient.sessions.map(s => s.date));
    if (appointments.length > 0) {
      appointments.filter(a => (a.fileNo === patient.id || a.patientId === patient.id) && a.status === 'attended' && a.date <= clinicToday()).forEach(a => dates.push(a.date));
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
      s.services?.forEach(service => { if (service.tooth) toothSet.add(service.tooth); });
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
    return patient.sessions.filter(s => sessionIncludesTooth(s, selectedToothId));
  }, [selectedToothId, patient.sessions]);

  const selectedToothFinancials = useMemo(() => {
    const req = selectedToothSessions.reduce((acc, s) => acc + Math.max(0, s.amount - (s.discount || 0)), 0);
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
  const [isProstheticOpen, setIsProstheticOpen] = useState(false);
  const [prostheticTooth, setProstheticTooth] = useState<string | null>(null);
  const openProstheticOrder = (tooth: string | null = null) => {
    if (!canEditPatients || !onSaveProstheticOrder) return;
    setToothSheetId(null); setIsServiceModalOpen(false);
    setProstheticTooth(tooth); setIsProstheticOpen(true);
  };
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isApptModalOpen, setIsApptModalOpen] = useState(false);
  const [isEditPatientModalOpen, setIsEditPatientModalOpen] = useState(false);
  const [selectedSessionForPayment, setSelectedSessionForPayment] = useState<Session | null>(null);

  // Tooth Quick Service Bottom Sheet State
  const [toothSheetId, setToothSheetId] = useState<string | null>(null);

  // Status Modal State
  const [patientStatusModalAppt, setPatientStatusModalAppt] = useState<Appointment | null>(null);

  const { saving, run } = useConfirmedAction();
  const handlePatientSelectStatus = async (newStatus: AppointmentStatus) => {
    if (!canManageAppointments || !patientStatusModalAppt || !onUpdateApptStatus) return;
    await run(async () => { await onUpdateApptStatus(patientStatusModalAppt.id, newStatus);
    const cfg = APPOINTMENT_STATUS_CONFIGS[newStatus];
    showToast(`تم تحديث حالة الموعد إلى (${cfg ? cfg.label : newStatus}) بنجاح`, 'success');
    setPatientStatusModalAppt(null);
    });
  };

  // Edit Patient Form State
  const [editName, setEditName] = useState(patient.name);
  const [editMobile, setEditMobile] = useState(patient.mobile || '');
  const [editAge, setEditAge] = useState<number | ''>(patient.age);
  const [editGender, setEditGender] = useState<'male' | 'female'>(patient.gender || 'male');
  const [editAllergy, setEditAllergy] = useState(patient.allergy || '');
  const [showEditMedicalField, setShowEditMedicalField] = useState(false);
  const [editNotes, setEditNotes] = useState(patient.notes || '');
  const [editPatientBaseline, setEditPatientBaseline] = useState<Patient | undefined>(undefined);

  const handleOpenEditPatient = () => {
    if (!canEditPatients) return;
    setEditName(patient.name);
    setEditMobile(patient.mobile || '');
    setEditAge(patient.age);
    setEditGender(patient.gender || 'male');
    setEditAllergy(patient.allergy || '');
    setShowEditMedicalField(false);
    setEditNotes(patient.notes || '');
    setEditPatientBaseline(patient);
    setIsEditPatientModalOpen(true);
  };

  const handleSavePatientEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEditPatients) return;
    if (!editName.trim()) {
      validationFail('editPatientModal', 'input-edit-patient-name', 'يرجى كتابة اسم المريض');
      return;
    }
    if (typeof editAge !== 'number' || !Number.isInteger(editAge) || editAge < 0 || editAge > 120) {
      validationFail('editPatientModal', 'input-edit-patient-age', 'اكتب سنًا صحيحًا بين 0 و120 سنة');
      return;
    }
    const phone = cleanEgyptianPhone(editMobile);
    const mobile = phone.startsWith('20') ? `0${phone.slice(2)}` : phone;
    if (editMobile.trim() && !/^01[0125]\d{8}$/.test(mobile)) {
      validationFail('editPatientModal', 'input-edit-patient-mobile', 'راجع رقم الموبايل المصري: 11 رقمًا يبدأ بـ 01');
      return;
    }
    void run(async () => { await onUpdatePatient({
      id: patient.id,
      name: editName.trim(),
      mobile,
      age: editAge,
      gender: editGender,
      firstVisit: patient.firstVisit,
      notes: editNotes.trim(),
      allergy: editAllergy.trim()
    }, editPatientBaseline);
    setIsEditPatientModalOpen(false);
    showToast('تم تحديث بيانات ملف المريض بنجاح', 'success');
    });
  };

  // Appointment Form State
  const [editingAppt, setEditingAppt] = useState<Appointment | null>(null);
  const [apptDate, setApptDate] = useState<string>(clinicToday());
  const [apptTime, setApptTime] = useState<string>('17:00');
  const [apptType, setApptType] = useState<string>('حشو ليزر');
  const [apptDoctor, setApptDoctor] = useState<string>('د. العيادة');
  const [apptDuration, setApptDuration] = useState<number>(30);
  const [apptNotes, setApptNotes] = useState<string>('');

  useEffect(() => {
    const isAnyModalOpen = isServiceModalOpen || isProstheticOpen || isPaymentModalOpen || isApptModalOpen || isEditPatientModalOpen || !!toothSheetId;
    if (isAnyModalOpen) {
      document.body.classList.add('modal-open');
    } else {
      document.body.classList.remove('modal-open');
    }
    return () => {
      document.body.classList.remove('modal-open');
    };
  }, [isServiceModalOpen, isProstheticOpen, isPaymentModalOpen, isApptModalOpen, isEditPatientModalOpen, toothSheetId]);

  const handleOpenAddApptModal = (apptToEdit?: Appointment) => {
    if (!canManageAppointments) return;
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
      setApptDate(clinicToday());
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
    if (!canManageAppointments || !onSaveAppointment) return;
    if (!isValidAppointmentDate(apptDate) || appointmentTimeMinutes(apptTime) === null) {
      showToast('حدد تاريخًا ووقتًا صحيحين للموعد', 'warning');
      return;
    }
    if (!Number.isFinite(apptDuration) || apptDuration <= 0 || apptDuration > 1440) {
      showToast('مدة الموعد يجب أن تكون أكبر من صفر وأقل من أو تساوي ١٤٤٠ دقيقة.', 'warning');
      return;
    }

    const appointment: Omit<Appointment, 'id'> & { id?: string } = {
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
      isFollowUp: editingAppt?.isFollowUp ?? false,
      isWalkIn: editingAppt?.isWalkIn ?? false,
      status: editingAppt ? editingAppt.status : 'scheduled'
    };

    const saveAppointment = async () => {
      try {
        await run(async () => { await onSaveAppointment(appointment, editingAppt ?? undefined);
        setIsApptModalOpen(false);
        showToast(editingAppt ? 'تم تعديل الموعد بنجاح' : 'تم إضافة الموعد بنجاح لملف المريض', 'success');
        });
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'تعذّر حفظ الموعد. راجع البيانات وحاول مرة أخرى.', 'error');
      }
    };
    if (findAppointmentConflicts(appointments, apptDate, apptTime, apptDuration, editingAppt?.id).length) {
      askConfirm({ title: 'موعد متعارض', message: 'يتداخل وقت الحجز مع موعد آخر مسجل. هل تريد تأكيد الحجز رغم التعارض؟', confirmLabel: 'تأكيد الحجز', tone: 'warning', onConfirm: saveAppointment });
    } else saveAppointment();
  };

  // Service Form State
  const clinicalServices = serviceTypes.filter(name => getServiceGroup(name) === 'clinical');
  const firstService = clinicalServices[0] || '';
  const configuredExamFee = parseCatalogPrice(examinationFee).valid ? examinationFee : DEFAULT_EXAMINATION_FEE;
  const getDefaultPrice = (name: string): number | '' => Object.prototype.hasOwnProperty.call(clinicalPrices, name)
    && typeof clinicalPrices[name] === 'number' && parseCatalogPrice(clinicalPrices[name]).valid
    ? getClinicalServicePrice(name, { serviceTypes, crownPrices, clinicalPrices }) : '';
  const [serviceType, setServiceType] = useState(firstService);

  const [manualAmount, setManualAmount] = useState<number | ''>('');
  const [paidNow, setPaidNow] = useState<number | ''>('');
  const [serviceDate, setServiceDate] = useState<string>(clinicToday());
  const [includeExaminationFee, setIncludeExaminationFee] = useState(false);
  const examinationFeeAmount = configuredExamFee;
  const [treatmentStage, setTreatmentStage] = useState<NonNullable<Session['treatmentStage']>>('single');
  const [rootCanalStatus, setRootCanalStatus] = useState<NonNullable<Session['rootCanalStatus']>>('access_cleaning');
  const [serviceNotes, setServiceNotes] = useState('');

  // Payment Installment Form State
  const [paymentAmount, setPaymentAmount] = useState<number | ''>('');
  const [isPaymentAmountDefault, setIsPaymentAmountDefault] = useState(false);
  const [paymentDate, setPaymentDate] = useState<string>(clinicToday());
  const paymentSession = patient.sessions.find(session => session.id === selectedSessionForPayment?.id);
  const paymentPresentation = getPatientCollectionPresentation(patient, paymentSession, canRevealRemainingBalance);

  useEffect(() => {
    if (!canRevealRemainingBalance && isPaymentAmountDefault) {
      setPaymentAmount('');
      setIsPaymentAmountDefault(false);
    }
  }, [canRevealRemainingBalance, isPaymentAmountDefault]);

  // Open Tooth Quick Service Bottom Sheet when a tooth is tapped on ToothChart
  const handleOpenToothSheet = (compositeToothId: string) => {
    if (!canEditPatients) return;
    setToothSheetId(compositeToothId);
    setSelectedToothId(compositeToothId);
    setServiceType(firstService);
    setManualAmount(getDefaultPrice(firstService));
    setPaidNow('');
    setServiceDate(clinicToday());
    setIncludeExaminationFee(false);
    setTreatmentStage('single');
    setRootCanalStatus('access_cleaning');
    setServiceNotes('');

  };

  // Standard modal opener
  const handleOpenServiceModal = (toothId?: string | null) => {
    if (!canEditPatients) return;
    if (toothId) {
      handleOpenToothSheet(toothId);
      return;
    }
    setSelectedToothId(null);
    setServiceType(firstService);
    setManualAmount(getDefaultPrice(firstService));
    setPaidNow('');
    setServiceDate(clinicToday());
    setIncludeExaminationFee(false);
    setTreatmentStage('single');
    setRootCanalStatus('access_cleaning');
    setServiceNotes('');
    setIsServiceModalOpen(true);
  };

  const handleOpenPaymentModal = (session?: Session) => {
    if (!canRegisterPayment) return;
    const selectedSession = session
      ? patient.sessions.find(item => item.id === session.id)
      : patient.sessions.find(item => getPatientSessionReceiptLimit(patient, item) > 0) ?? patient.sessions[0];
    setSelectedSessionForPayment(selectedSession ?? null);
    setPaymentAmount(getPatientCollectionPresentation(patient, selectedSession, canRevealRemainingBalance).initialAmount);
    setIsPaymentAmountDefault(canRevealRemainingBalance);
    setPaymentDate(clinicToday());
    setIsPaymentModalOpen(true);
  };

  const handleSaveService = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEditPatients) return;
    if (!clinicalServices.includes(serviceType)) {
      validationFail(toothSheetId ? 'toothServiceModal' : 'serviceModal', 'input-service-type', 'اختر خدمة موجودة في فهرس العيادة.');
      return;
    }

    if (manualAmount === '') {
      validationFail(toothSheetId ? 'toothServiceModal' : 'serviceModal', 'input-service-amount', 'اكتب سعر الخدمة؛ الصفر مقبول إذا كانت مجانية.');
      return;
    }
    const treatmentCost = manualAmount;

    const examFee = includeExaminationFee && typeof examinationFeeAmount === 'number'
      ? Math.max(0, examinationFeeAmount)
      : 0;
    const totalCost = treatmentCost + examFee;

    const modalId = toothSheetId ? 'toothServiceModal' : 'serviceModal';
    if (!Number.isFinite(treatmentCost) || treatmentCost < 0 || !Number.isFinite(totalCost) || totalCost < 0) {
      validationFail(modalId, 'input-service-amount', 'اكتب تكلفة صحيحة للخدمة؛ لا يمكن أن تكون سالبة');
      return;
    }
    if (includeExaminationFee && (typeof examinationFeeAmount !== 'number' || !Number.isFinite(examinationFeeAmount) || examinationFeeAmount < 0)) {
      validationFail(modalId, 'input-examination-fee', 'اكتب مبلغًا صحيحًا للكشف');
      return;
    }

    const paidVal = canRegisterPayment && typeof paidNow === 'number' ? paidNow : 0;
    if (!Number.isFinite(paidVal) || paidVal < 0) {
      validationFail(modalId, 'input-paid-now', 'اكتب مبلغًا مدفوعًا صحيحًا؛ لا يمكن أن يكون سالبًا');
      return;
    }
    if (paidVal > totalCost) {
      validationFail(modalId, 'input-paid-now', 'المبلغ المدفوع أكبر من إجمالي الزيارة');
      return;
    }
    if (!isValidAppointmentDate(serviceDate)) {
      validationFail(modalId, 'input-service-date', 'حدد تاريخًا صحيحًا للخدمة');
      return;
    }

    const remainVal = Math.max(0, totalCost - paidVal);

    const newSession: Omit<Session, 'id'> = {
      type: serviceType,
      tooth: selectedToothId || undefined,
      toothLabel: selectedToothId ? getToothLabel(selectedToothId) : 'خدمة عامة',
      amount: totalCost,
      paid: paidVal,
      remain: remainVal,
      date: serviceDate,
      payDate: serviceDate,
      paymentsLog: paidVal > 0 ? [{ id: crypto.randomUUID(), amount: paidVal, date: serviceDate, paymentMethod: 'cash', createdAt: new Date().toISOString() }] : [],
      examinationFee: examFee,
      treatmentFee: treatmentCost,
      services: [{ id: crypto.randomUUID(), name: serviceType, price: treatmentCost, ...(selectedToothId ? { tooth: selectedToothId } : {}) }],
      procedurePerformed: serviceType,
      visitNotes: serviceNotes.trim() || undefined,
      treatmentStage,
      visitStatus: treatmentStage === 'single' ? 'completed' : 'follow_up',
      rootCanalStatus: serviceType.includes('عصب') ? rootCanalStatus : undefined,
      paymentMethod: 'cash'
    };

    void run(async () => { await onSaveSession(patient.id, newSession);
    setIsServiceModalOpen(false);
    setToothSheetId(null);
    showToast('تم تسجيل الخدمة وتحديث المخطط بنجاح', 'success');
    });
  };

  const handleSavePaymentInstallment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canRegisterPayment) return;
    if (!selectedSessionForPayment) {
      showToast('يرجى اختيار الجلسة المراد تحصيل دفعة عليها', 'warning');
      return;
    }

    const amt = !canRevealRemainingBalance && isPaymentAmountDefault ? 0 : typeof paymentAmount === 'number' ? paymentAmount : 0;
    if (!Number.isFinite(amt) || amt <= 0) {
      validationFail('paymentModal', 'input-payment-amount', 'يرجى كتابة مبلغ تحصيل صحيح');
      return;
    }

    const currentSession = patient.sessions.find(session => session.id === selectedSessionForPayment.id);
    if (!currentSession) {
      showToast('لم تعد هذه الخدمة موجودة. أغلق النافذة وراجع ملف المريض.', 'warning');
      return;
    }
    const remaining = getPatientSessionReceiptLimit(patient, currentSession);
    if (amt > remaining) {
      validationFail('paymentModal', 'input-payment-amount', canRevealRemainingBalance ? `المبلغ أكبر من المستحق الحالي القابل للتحصيل (${remaining} ج.م)` : 'المبلغ أكبر من المستحق الحالي للمريض أو لهذه الخدمة');
      return;
    }
    if (!isValidAppointmentDate(paymentDate)) {
      validationFail('paymentModal', 'input-payment-date', 'حدد تاريخًا صحيحًا للتحصيل');
      return;
    }

    void run(async () => { await onAddPaymentInstallment(patient.id, selectedSessionForPayment.id, {
      amount: amt,
      date: paymentDate
    });
    setIsPaymentModalOpen(false);
    showToast('تم تسديد الدفعة المالية بنجاح', 'success');
    });
  };

  const handleDeletePatientConfirmed = () => {
    if (!canDeletePatients) return;
    askConfirm({
      title: 'حذف ملف المريض',
      message: `هل أنت متأكد من حذف ملف المريض (${patient.name}) بالكامل؟`,
      confirmLabel: 'حذف المريض',
      tone: 'danger',
      onConfirm: async () => {
        if (!canDeletePatients) return;
        try { await onDeletePatient(patient.id); } catch (error) {
          showToast(error instanceof Error ? error.message : 'تعذر حذف الملف.', 'warning');
          return;
        }
        onBack();
        showToast(`تم حذف ملف المريض ${patient.name}`, 'warning');
      }
    });
  };

  const openPatientChat = () => {
    if (!canUseWhatsApp || !contactPhone) return;
    try {
      if (!onAuthorizeWhatsappSend) throw new Error('تعذّر التحقق من صلاحية فتح واتساب. افتح الملف من جديد.');
      onAuthorizeWhatsappSend({ isCampaign: false, requiresFinance: false });
      // Chat only: no clinical text, campaign consent or delivery confirmation
      // is created by opening WhatsApp. Prepared messages keep their own guard.
      window.open(`https://wa.me/${contactPhone}`, '_blank', 'noopener,noreferrer');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذّر فتح واتساب. حاول مرة أخرى.', 'error');
    }
  };

  // Status info for currently tapped tooth in ToothQuickSheet
  const toothSheetStatusInfo = useMemo(() => {
    if (!toothSheetId) return null;
    return getToothStatusForPatient(patient.sessions, toothSheetId);
  }, [toothSheetId, patient.sessions]);

  const renderVisitDetails = () => (
    <>
      <ExaminationFeeToggle selected={includeExaminationFee} fee={configuredExamFee} onChange={setIncludeExaminationFee} />

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
          {((typeof manualAmount === 'number' && Number.isFinite(manualAmount) ? manualAmount : 0) + (includeExaminationFee && typeof examinationFeeAmount === 'number' && Number.isFinite(examinationFeeAmount) ? examinationFeeAmount : 0)).toLocaleString()} ج.م
        </strong>
      </div>
    </>
  );

  return (
    <div className="patient-file font-tajawal antialiased text-slate-800" dir="rtl">
      {canEditPatients && isProstheticOpen && onSaveProstheticOrder && <ProstheticOrderForm patient={patient} crownPrices={crownPrices} examinationFee={configuredExamFee} initialToothId={prostheticTooth} canRegisterPayment={canRegisterPayment} onSave={onSaveProstheticOrder} onClose={() => setIsProstheticOpen(false)} />}
      {canUseWhatsApp && isWhatsAppOpen && <WhatsAppComposer key={patient.id} patient={patient} appointments={appointments} settings={whatsappSettings} clinicName={clinicName} canViewPatientFinance={canRevealRemainingBalance} onAuthorizeSend={onAuthorizeWhatsappSend} onClose={() => setIsWhatsAppOpen(false)} />}

      <div className="patient-file-overview">
      <header className="patient-file-header">
        <div className="patient-file-topline">
          <button type="button" onClick={onBack} className="patient-file-back">
            <ArrowRight aria-hidden="true" />
            <span>{origin === 'contacts' ? 'جهات الاتصال' : origin === 'appointments' ? 'المواعيد' : 'المرضى'}</span>
          </button>
          <div className="patient-file-header-tools">
            <span className="patient-file-number"><FileText aria-hidden="true" />ملف <bdi dir="ltr">#{patient.id}</bdi></span>
            {canEditPatients && <button type="button" onClick={handleOpenEditPatient} aria-label="تعديل بيانات المريض" className="patient-file-icon"><Edit3 aria-hidden="true" /></button>}
            {canDeletePatients && <button type="button" onClick={handleDeletePatientConfirmed} aria-label="حذف ملف المريض" className="patient-file-icon patient-file-icon--danger"><Trash2 aria-hidden="true" /></button>}
          </div>
        </div>
        <div className="patient-file-identity">
          <div className="patient-file-avatar" aria-hidden="true">{patient.name.substring(0, 2)}</div>
          <div className="patient-file-name">
            <h1>{patient.name}</h1>
            <div className="patient-file-meta">
              <span className="patient-file-demographics"><UserCheck aria-hidden="true" />{patient.age} سنة{patientGender && ` · ${patientGender}`}</span>
              {patient.mobile && <span className="patient-file-phone"><Phone aria-hidden="true" /><bdi dir="ltr">{patient.mobile}</bdi></span>}
              <span className="patient-file-last-visit"><Calendar aria-hidden="true" />آخر زيارة <bdi dir="ltr">{lastVisitDate}</bdi></span>
            </div>
          </div>
        </div>
        {contactPhone ? <div className="patient-file-contact-actions" role="group" aria-label="التواصل مع المريض">
          <a href={`tel:${telephoneNumber}`} aria-label={`الاتصال بالمريض ${patient.mobile}`} className="patient-file-call"><Phone aria-hidden="true" /><span>اتصال</span></a>
          {canUseWhatsApp && <><button type="button" onClick={openPatientChat} className="patient-file-whatsapp" aria-label="فتح محادثة واتساب مع المريض"><MessageCircle aria-hidden="true" /><span>واتساب</span></button><button type="button" onClick={() => setIsWhatsAppOpen(true)} className="patient-file-message"><MessageSquare aria-hidden="true" /><span>رسالة جاهزة</span></button></>}
        </div> : <p className="patient-file-no-phone">{patient.mobile ? 'رقم التواصل غير مكتمل؛ راجعه من تعديل بيانات المريض.' : 'لا يوجد رقم تواصل مسجّل.'}</p>}
        {patient.allergy?.trim() && <div className="patient-medical-note">
          <FileText className="w-5 h-5 shrink-0" aria-hidden="true" />
          <div><strong>معلومة طبية مسجّلة</strong><p>{patient.allergy}</p></div>
        </div>}
        {(canEditPatients || canRegisterPayment || canManageAppointments) && <div className="patient-file-actions">
          {canEditPatients && <button type="button" onClick={() => handleOpenServiceModal()} className="patient-file-action patient-file-action--primary"><Plus aria-hidden="true" /><span>تسجيل خدمة</span></button>}
          {canEditPatients && onSaveProstheticOrder && <button type="button" onClick={() => openProstheticOrder()} className="patient-file-action patient-file-action--prosthetic"><Layers aria-hidden="true" /><span>تركيبة جديدة</span></button>}
          {canRegisterPayment && <button type="button" onClick={() => handleOpenPaymentModal()} className="patient-file-action patient-file-action--payment"><Wallet aria-hidden="true" /><span>تحصيل دفعة</span></button>}
          {canManageAppointments && <button type="button" onClick={() => handleOpenAddApptModal()} className="patient-file-action patient-file-action--appointment"><Calendar aria-hidden="true" /><span>حجز موعد</span></button>}
        </div>}
      </header>

      <PatientFinancialOverview total={totalRequired} paid={totalPaid} remaining={totalRemain}
        isPrivacyMode={isPrivacyMode} canViewRemainingBalance={canViewRemainingBalance}
        onOpenDetails={() => { setActiveTab('finance'); setShowFinancialDetails(true); }} />
      </div>

      <div className="patient-file-clinical-strip" aria-label="ملخص الزيارات">
        <span><History aria-hidden="true" /><strong>{patient.sessions.length}</strong> جلسات</span>
        <span><Layers aria-hidden="true" /><strong>{treatedTeethCount}</strong> أسنان مسجّلة</span>
        <span><Microscope aria-hidden="true" /><strong>{labCasesCount}</strong> جلسات تركيبات</span>
        {patient.notes?.trim() && <span className="patient-file-note"><FileText aria-hidden="true" />{patient.notes}</span>}
      </div>

      <nav className="patient-file-tabs" aria-label="أقسام ملف المريض">
        {[
          { key: 'chart', label: 'الأسنان', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5c-2-2-6-2-7 1-1 4 1 6 2 11 .5 3 2 4 3 0l1-4c.3-1 1.7-1 2 0l1 4c1 4 2.5 3 3 0 1-5 3-7 2-11-1-3-5-3-7-1Z" /><path d="M9 4c1 1.5 3 2 5 2" /></svg> },
          { key: 'sessions', label: 'الجلسات', icon: <History aria-hidden="true" /> },
          { key: 'appointments', label: 'المواعيد', icon: <Calendar aria-hidden="true" /> },
          { key: 'finance', label: 'الحساب', icon: <Wallet aria-hidden="true" /> },
          ...(canUseRx ? [{ key: 'prescription', label: 'الروشتات', icon: <FileText aria-hidden="true" /> }] : []),
          { key: 'info', label: 'البيانات', icon: <UserCheck aria-hidden="true" /> },
        ].map(tab => <button type="button" key={tab.key} aria-pressed={activeTab === tab.key}
          aria-controls="patient-file-content" onClick={() => setActiveTab(tab.key as typeof activeTab)}>
          {tab.icon}<span>{tab.label}</span>
        </button>)}
      </nav>

      <div className="patient-file-content-shell">
        <div id="patient-file-content" className="patient-file-content">
          {/* 5.1 Tooth Chart Tab & Selected Tooth Card */}
          {activeTab === 'chart' && (
            <div className={`patient-file-chart-layout${selectedToothId ? ' patient-file-chart-layout--selected' : ''}`}>
              <ToothChart
                patient={patient}
                onOpenAddSessionModal={handleOpenToothSheet}
                selectedToothId={selectedToothId}
                onSelectTooth={setSelectedToothId}
              />

              {/* Selected Tooth Panel Card */}
              {selectedToothId && (
                <section id="selected-tooth-panel" className="patient-tooth-panel" aria-label="تفاصيل السن المحدد">
                  <div className="patient-tooth-heading">
                    <div className="patient-tooth-identity">
                      <div className="patient-tooth-symbol" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5c-2-2-6-2-7 1-1 4 1 6 2 11 .5 3 2 4 3 0l1-4c.3-1 1.7-1 2 0l1 4c1 4 2.5 3 3 0 1-5 3-7 2-11-1-3-5-3-7-1Z" /><path d="M9 4c1 1.5 3 2 5 2" /></svg>
                      </div>
                      <div className="patient-tooth-name">
                        <div className="patient-tooth-labels">
                          <span className="patient-tooth-code">
                            سن <bdi dir="ltr">#{selectedToothId}</bdi>
                          </span>
                          <span className="patient-tooth-status">
                            {selectedToothStatus ? { normal: 'بدون علامة علاجية', filled: 'حشو', crown: 'تركيبة', endodontic: 'علاج عصب', extracted: 'مخلوع / مفقود' }[selectedToothStatus.status] : ''}
                          </span>
                        </div>
                        <h3>
                          {getToothLabel(selectedToothId)}
                        </h3>
                      </div>
                    </div>

                    {canEditPatients && (<button
                      type="button"
                      onClick={() => handleOpenServiceModal(selectedToothId)}
                      className="patient-tooth-add-service"
                    >
                      <Plus aria-hidden="true" />
                      <span>تسجيل خدمة</span>
                    </button>)}
                  </div>

                  {/* Summary Stats for Selected Tooth */}
                  <dl className="patient-tooth-stats">
                    <div>
                      <dt>الخدمات المسجّلة</dt>
                      <dd><bdi>{selectedToothSessions.length}</bdi></dd>
                    </div>

                    <div>
                      <dt>آخر إجراء</dt>
                      <dd>
                        {selectedToothStatus?.lastSessionType || 'لا يوجد'}
                      </dd>
                    </div>

                    <div className="patient-tooth-stat--paid">
                      <dt>تحصيل الجلسات المرتبطة</dt>
                      <dd><bdi>{maskMoney(selectedToothFinancials.pd)}</bdi></dd>
                    </div>

                    <div className={canRevealRemainingBalance && selectedToothFinancials.rem > 0 ? 'patient-tooth-stat--due' : undefined}>
                      <dt>متبقي الجلسات المرتبطة</dt>
                      <dd><bdi>{maskRemaining(selectedToothFinancials.rem)}</bdi></dd>
                    </div>
                  </dl>

                  {/* Timeline for services on this tooth */}
                  <p className="patient-tooth-finance-hint">حساب الجلسات المرتبطة يشمل الكشف وأي إجراءات أخرى في نفس الجلسة، وليس تكلفة هذا السن وحده.</p>
                  <div className="patient-tooth-history">
                    <h4>
                      <History aria-hidden="true" />
                      <span>سجل خدمات هذا السن ({selectedToothSessions.length}):</span>
                    </h4>

                    {selectedToothSessions.length === 0 ? (
                      <p className="patient-tooth-empty">
                        لا توجد خدمات مسجلة لهذا السن.
                      </p>
                    ) : (
                      <div className="patient-tooth-services">
                        {selectedToothSessions.map(s => (
                          <div
                            key={s.id}
                            className="patient-tooth-service"
                          >
                            <div className="patient-tooth-service-description">
                              <strong>{getSessionToothProcedure(s, selectedToothId)}</strong>
                              <time dateTime={s.date}><Calendar aria-hidden="true" /><bdi>{s.date}</bdi></time>
                            </div>

                            <div className="patient-tooth-service-balance">
                              <strong><bdi>{maskMoney(s.amount)}</bdi></strong>
                              <div className={!canRevealRemainingBalance ? 'text-slate-500 text-[11px]' : sessionBalance(s) > 0 ? 'text-rose-600 font-bold text-[11px]' : 'text-emerald-600 font-bold text-[11px]'}>
                                {!canRevealRemainingBalance ? 'الرصيد مخفي' : sessionBalance(s) > 0 ? `متبقي ${maskRemaining(sessionBalance(s))}` : 'خالص السداد'}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </section>
              )}
            </div>
          )}

          {/* 5.2 Sessions Timeline Tab */}
          {activeTab === 'sessions' && (
            <div className="bg-white rounded-3xl p-4 sm:p-6 border border-slate-200/90 shadow-sm space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                <h3 className="text-base font-black text-[#0f3d3e] flex items-center gap-2">
                  <History className="w-5 h-5 text-[#0f3d3e]" />
                  <span>سجل الجلسات والخدمات العلاجية ({patient.sessions.length})</span>
                </h3>

                {canEditPatients && (<button
                  type="button"
                  onClick={() => handleOpenServiceModal()}
                  className="px-3.5 py-2 rounded-xl bg-[#0f3d3e] hover:bg-[#134d4f] text-white font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs min-h-[44px] active:scale-95 touch-manipulation"
                >
                  <Plus className="w-4 h-4" />
                  <span>تسجيل خدمة</span>
                </button>)}
              </div>

              {patient.sessions.length === 0 ? (
                <div className="p-8 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-300 space-y-3">
                  <p className="text-xs font-bold text-slate-500">لا توجد أية خدمات علاجية مسجلة بعد لهذا المريض.</p>
                  {canEditPatients && (<button
                    type="button"
                    onClick={() => handleOpenServiceModal()}
                    className="px-4 py-2.5 rounded-xl bg-[#0f3d3e] text-white text-xs font-bold cursor-pointer min-h-[44px]"
                  >
                    تسجيل أول خدمة علاجية
                  </button>)}
                </div>
              ) : (
                <div className="patient-session-list">
                  {patient.sessions.map((s, idx) => {
                    const isExpanded = expandedSessionId === s.id;

                    return (
                      <article key={s.id} className="patient-session-card">
                        <div className="min-w-0 space-y-3">
                          <div className="patient-session-heading">
                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="patient-session-number">جلسة <bdi>{idx + 1}</bdi></span>
                                <h4 className="font-extrabold text-slate-900 text-sm sm:text-base">
                                  {s.type}
                                </h4>
                                {s.toothLabel && (
                                  <span className="text-[11px] bg-slate-200 text-slate-800 px-2 py-0.5 rounded-md font-bold">
                                    {s.toothLabel}
                                  </span>
                                )}
                              </div>
                              <time className="patient-session-date" dateTime={s.date}><Calendar aria-hidden="true" /> <bdi>{s.date}</bdi></time>
                            </div>

                            {/* Action & Meter */}
                            <div className="patient-session-actions">
                              {canRegisterPayment && sessionBalance(s) > 0 && (
                                <button
                                  type="button"
                                  onClick={() => handleOpenPaymentModal(s)}
                                  className="patient-session-collect"
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                  <span>تحصيل دفعة</span>
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={() => setExpandedSessionId(isExpanded ? null : s.id)}
                                aria-expanded={isExpanded}
                                aria-controls={`patient-session-details-${s.id}`}
                                aria-label={`تفاصيل الجلسة ${idx + 1}`}
                                className="patient-session-details-button"
                              >
                                <span>التفاصيل</span>
                                {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                              </button>
                            </div>
                          </div>

                          {s.prosthetic && <p className="patient-session-prosthetic"><span>{s.prosthetic.kind === 'fixed' ? 'تركيبة ثابتة' : 'تركيبة متحركة'} · {s.prosthetic.material}</span><span>العدد <bdi>{s.prosthetic.units}</bdi>{!isPrivacyMode && <> · سعر الوحدة <bdi>{maskMoney(s.prosthetic.unitPrice)}</bdi></>}</span></p>}

                          {/* Financial Progress Meter for Session */}
                          {!!s.services?.length && <ul className="patient-file-service-list" aria-label="تفاصيل خدمات الجلسة">
                            {s.services.map(service => <li key={service.id}>
                              <span>{service.name}<small>{service.tooth ? getToothLabel(service.tooth) : 'خدمة عامة'}</small></span>
                              {!isPrivacyMode && <bdi>{maskMoney(service.price)}</bdi>}
                            </li>)}
                          </ul>}
                          {!isPrivacyMode && canViewRemainingBalance && <BalanceProgressMeter
                            total={Math.max(0, s.amount - (s.discount || 0))}
                            paid={getSessionCollected(s)}
                            remaining={sessionBalance(s)}
                            size="sm"
                            type="patient"
                          />}

                          {/* Collapsible Payments Log */}
                          {isExpanded && (
                            <div id={`patient-session-details-${s.id}`} className="patient-session-details space-y-2">
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
                                      className="patient-session-receipt"
                                    >
                                      <span>دفعة بتاريخ <bdi>{p.date}</bdi>{p.voidedAt ? ' — ملغاة' : ''}</span>
                                      <bdi className={p.voidedAt ? 'text-slate-500 line-through' : 'text-emerald-800'}>{maskMoney(p.amount)}</bdi>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </article>
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

                {canManageAppointments && (<button
                  type="button"
                  onClick={() => handleOpenAddApptModal()}
                  className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs min-h-[44px] active:scale-95 touch-manipulation"
                >
                  <Plus className="w-4 h-4" />
                  <span>حجز موعد</span>
                </button>)}
              </div>

              {patientAppointments.length === 0 ? (
                <div className="p-8 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-300 space-y-3">
                  <p className="text-xs font-bold text-slate-500">لا توجد أية مواعيد مجدولة لهذا المريض.</p>
                  {canManageAppointments && (<button
                    type="button"
                    onClick={() => handleOpenAddApptModal()}
                    className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold cursor-pointer min-h-[44px]"
                  >
                    حجز أول موعد
                  </button>)}
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
                          {canManageAppointments && Boolean(onUpdateApptStatus) && (<button
                            type="button"
                            onClick={() => setPatientStatusModalAppt(appt)}
                            className={`px-3.5 py-2 min-h-[44px] rounded-xl text-xs font-extrabold flex items-center justify-center gap-1.5 transition-all cursor-pointer border active:scale-95 touch-manipulation shadow-2xs ${statusCfg.badgeBg}`}
                            title="تعديل حالة الموعد"
                          >
                            <StatusIcon className="w-4 h-4 shrink-0" />
                            <span>{statusCfg.label}</span>
                            <ChevronDown className="w-3.5 h-3.5 opacity-60 shrink-0" />
                          </button>)}

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

                          {canManageAppointments && (<button
                            type="button"
                            onClick={() => handleOpenAddApptModal(appt)}
                            className="px-3 py-2 min-h-[44px] rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs flex items-center justify-center gap-1 cursor-pointer active:scale-95 touch-manipulation"
                            title="تعديل تفاصيل الموعد"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            <span>تعديل</span>
                          </button>)}

                          {canManageAppointments && onDeleteAppointment && (<button
                            type="button"
                            onClick={() => {
                              askConfirm({
                                title: 'تأكيد حذف الموعد',
                                message: `هل أنت متأكد من حذف موعد يوم (${appt.date} - ${appt.time}) نهائياً؟`,
                                confirmLabel: 'حذف الموعد',
                                tone: 'danger',
                                onConfirm: async () => {
                                  if (!canManageAppointments || !onDeleteAppointment) return;
                                  await onDeleteAppointment(appt.id);
                                  showToast('تم حذف الموعد بنجاح', 'warning');
                                }
                              });
                            }}
                            className="p-2.5 min-h-[44px] min-w-[44px] rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 cursor-pointer flex items-center justify-center active:scale-95 touch-manipulation"
                            title="حذف الموعد"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>)}
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

                {canRegisterPayment && (<button
                  type="button"
                  onClick={() => handleOpenPaymentModal()}
                  className="px-3.5 py-2 rounded-xl bg-[#c9a227] hover:bg-amber-600 text-slate-950 font-black text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs min-h-[44px] active:scale-95 touch-manipulation"
                >
                  <Plus className="w-4 h-4" />
                  <span>تسديد دفعة</span>
                </button>)}
              </div>

              <p className="text-sm text-slate-600">الملخص أعلى الملف يجمع حساب المريض كله. هنا تفاصيل كل جلسة ودفعاتها، دون تكلفة المعمل.</p>

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
                  <div className="patient-file-finance-list">
                    {patient.sessions.map((s, idx) => (
                      <article
                        key={s.id || idx}
                        className="patient-file-finance-row"
                      >
                        <header><div><strong>{s.type}</strong><small>{s.toothLabel || 'خدمة عامة'}</small></div><time dateTime={s.date}><bdi dir="ltr">{s.date}</bdi></time></header>
                        <dl>
                          <div><dt>بعد الخصم</dt><dd><bdi>{maskMoney(Math.max(0, s.amount - (s.discount || 0)))}</bdi></dd></div>
                          <div><dt>المدفوع</dt><dd><bdi>{maskMoney(getSessionCollected(s))}</bdi></dd></div>
                          <div><dt>المتبقي</dt><dd><bdi>{maskRemaining(sessionBalance(s))}</bdi></dd></div>
                        </dl>
                      </article>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 5.5 Prescription & Instructions Tab */}
          {canUseRx && activeTab === 'prescription' && (
            <PrescriptionAndInstructionsView
              patient={patient}
              clinicName={clinicName}
              clinicLogo={clinicLogo}
              drugCatalog={drugCatalog}
              canSendWhatsApp={canUseWhatsApp}
              onAuthorizeWhatsappSend={onAuthorizeWhatsappSend}
              canPrint={capabilities?.exportData === true && !isPrivacyMode}
              onAuthorizePrint={onAuthorizePrint}
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
                    href={telephoneNumber ? `tel:${telephoneNumber}` : undefined}
                    aria-disabled={!telephoneNumber}
                    className={`p-3 min-h-[48px] rounded-xl flex items-center justify-center gap-2 font-bold text-xs transition-all cursor-pointer shadow-2xs active:scale-95 touch-manipulation ${
                      telephoneNumber ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'bg-slate-200 text-slate-400 pointer-events-none'
                    }`}
                  >
                    <Phone className="w-4 h-4" />
                    <span>اتصال تلفوني</span>
                  </a>

                  {canUseWhatsApp && (<button
                    type="button"
                    disabled={!contactPhone}
                    onClick={openPatientChat}
                    className={`p-3 min-h-[48px] rounded-xl flex items-center justify-center gap-2 font-bold text-xs transition-all cursor-pointer shadow-2xs active:scale-95 touch-manipulation ${
                      contactPhone ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-slate-200 text-slate-400 pointer-events-none'
                    }`}
                  >
                    <MessageCircle className="w-4 h-4" />
                    <span>واتساب</span>
                  </button>)}

                  <a
                    href={telephoneNumber ? `sms:${telephoneNumber}` : undefined}
                    aria-disabled={!telephoneNumber}
                    className={`p-3 min-h-[48px] rounded-xl flex items-center justify-center gap-2 font-bold text-xs transition-all cursor-pointer border border-slate-200 active:scale-95 touch-manipulation ${
                      telephoneNumber ? 'bg-white text-slate-800 hover:bg-slate-50' : 'bg-slate-200 text-slate-400 pointer-events-none'
                    }`}
                  >
                    <MessageSquare className="w-4 h-4 text-sky-600" />
                    <span>رسالة SMS</span>
                  </a>

                  <button
                    type="button"
                    onClick={async () => {
                      if (patient.mobile) {
                        try {
                          await navigator.clipboard.writeText(patient.mobile);
                          showToast('تم نسخ رقم الموبايل للحافظة', 'success');
                        } catch {
                          showToast('تعذر النسخ. يمكنك تحديد الرقم ونسخه يدويًا.', 'warning');
                        }
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


      {/* 8. MODALS & BOTTOM SHEETS */}

      {/* 8.1 Tooth Details & Quick Service Bottom Sheet */}
      {canEditPatients && toothSheetId && (
        <div className="clinic-modal-overlay fixed inset-0 z-50 flex flex-col justify-end md:items-center md:justify-center bg-slate-900/60 backdrop-blur-xs p-0 md:p-4 animate-fadeIn">
          <div id="toothServiceModal" role="dialog" aria-modal="true" aria-label="تسجيل خدمة" className="clinic-modal-panel bg-white rounded-t-3xl md:rounded-3xl max-w-lg w-full p-5 sm:p-6 shadow-2xl border border-slate-200 space-y-4 max-h-[90dvh] overflow-y-auto modal-scroll animate-slideUp">
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
                disabled={saving} onClick={() => { if (!saving) setToothSheetId(null); }}
                className="p-2 text-slate-400 hover:text-slate-600 cursor-pointer rounded-xl bg-slate-100 min-h-[44px] min-w-[44px] flex items-center justify-center"
              >
                ✕
              </button>
            </div>

            {/* Previous Treatment History Banner for this Tooth */}
            {toothSheetStatusInfo && (
              <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200/90 text-xs space-y-1">
                <span className="font-bold text-slate-800 block">سجل السن:</span>
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
            {canEditPatients && onSaveProstheticOrder && <button type="button" disabled={saving} onClick={() => openProstheticOrder(toothSheetId)} className="patient-file-action w-full"><Layers aria-hidden="true" />تسجيل تركيبة مرتبطة بالملف</button>}
            <div className="space-y-2">
              <span className="text-xs font-black text-slate-800 block">اختر نوع الخدمة السريعة:</span>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {clinicalServices.map(name => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => {
                      setServiceType(name);
                      setManualAmount(getDefaultPrice(name));
                    }}
                    className={`p-2.5 rounded-2xl border text-center transition-all cursor-pointer flex flex-col items-center justify-center gap-1 min-h-[64px] touch-manipulation ${
                      serviceType === name
                        ? 'bg-[#0f3d3e] text-white border-[#0f3d3e] shadow-xs'
                        : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-800'
                    }`}
                  >
                    <span className="text-[12px] font-bold leading-tight">{name}</span>
                    {getServiceGroup(name) === 'clinical' && <small className="text-[11px]">{getDefaultPrice(name) !== '' ? `${Number(getDefaultPrice(name)).toLocaleString('ar-EG')} ج.م` : 'حدد السعر'}</small>}
                  </button>
                ))}
              </div>
            </div>

            {/* Quick Service Log Form */}
            <form onSubmit={handleSaveService} className="space-y-3 pt-2 border-t border-slate-100"><fieldset disabled={saving} className="contents">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    سعر الخدمة بدون الكشف (ج.م)
                  </label>
                  <input
                    id="input-service-amount"
                    type="number"
                    min="0"
                    step="0.01"
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
                    disabled={!canRegisterPayment}
                    type="number"
                    min="0"
                    step="0.01"
                    value={canRegisterPayment ? paidNow : 0}
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
                  id="input-service-date"
                  type="date"
                  required
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
                  تسجيل خدمة
                </button>
              </div>
            </fieldset></form>
          </div>
        </div>
      )}

      {/* 8.2 Standard Service Modal */}
      {canEditPatients && isServiceModalOpen && (
        <div className="clinic-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-fadeIn">
          <div id="serviceModal" role="dialog" aria-modal="true" aria-label="تسجيل خدمة" className="clinic-modal-panel bg-white rounded-3xl max-w-lg w-full p-6 md:p-8 shadow-2xl border border-slate-200 space-y-5 max-h-[90dvh] overflow-y-auto modal-scroll">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h2 className="text-lg font-bold text-[#0f3d3e]">
                تسجيل خدمة طبية جديدة
              </h2>
              <button
                type="button"
                disabled={saving} onClick={() => { if (!saving) setIsServiceModalOpen(false); }}
                className="p-2 text-slate-400 hover:text-slate-600 cursor-pointer rounded-xl bg-slate-100 min-h-[44px] min-w-[44px] flex items-center justify-center"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveService} className="space-y-4"><fieldset disabled={saving} className="contents">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  نوع الخدمة الطبية
                </label>
                <select
                  id="input-service-type"
                  value={serviceType}
                  onChange={e => { setServiceType(e.target.value); setManualAmount(getDefaultPrice(e.target.value)); }}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-bold focus:outline-none focus:border-[#0f3d3e]"
                >
                  {!clinicalServices.length && <option value="">أضف خدمة من الإعدادات أولًا</option>}
                  {clinicalServices.map(st => (
                    <option key={st} value={st}>{st}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  سعر الخدمة بدون الكشف (ج.م) <span className="text-rose-500">*</span>
                </label>
                <input
                  id="input-service-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={manualAmount}
                  onChange={e => setManualAmount(e.target.value === '' ? '' : parseFloat(e.target.value))}
                  placeholder="أكتب المبلغ الإجمالي"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-mono focus:outline-none focus:border-[#0f3d3e]"
                />
              </div>

              <details className="patient-service-tooth-picker">
                <summary><span>{selectedToothId ? getToothLabel(selectedToothId) : 'تحديد السن (اختياري)'}</span><span>اختيار من الخريطة</span></summary>
                <ToothSelectionGrid ariaLabel="أسنان الخدمة في ملف المريض" mode="single" value={selectedToothId ? [selectedToothId] : []}
                  onChange={ids => setSelectedToothId(ids[0] || null)} onDentitionChange={() => setSelectedToothId(null)} disabled={saving} />
              </details>

              {renderVisitDetails()}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    المدفوع الآن (ج.م)
                  </label>
                  <input
                    id="input-paid-now"
                    disabled={!canRegisterPayment}
                    type="number"
                    min="0"
                    step="0.01"
                    value={canRegisterPayment ? paidNow : 0}
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
                    id="input-service-date"
                    type="date"
                    required
                    value={serviceDate}
                    onChange={e => setServiceDate(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-mono focus:outline-none focus:border-[#0f3d3e]"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  disabled={saving} onClick={() => { if (!saving) setIsServiceModalOpen(false); }}
                  className="px-4 py-2.5 text-xs font-bold text-slate-600 bg-slate-100 rounded-xl cursor-pointer min-h-[44px]"
                >
                  إلغاء وإغلاق
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-[#0f3d3e] text-white text-xs font-extrabold shadow-md cursor-pointer min-h-[44px]"
                >
                  تسجيل خدمة
                </button>
              </div>
            </fieldset></form>
          </div>
        </div>
      )}

      {/* 8.3 Payment Modal */}
      {canRegisterPayment && isPaymentModalOpen && (
        <div className="clinic-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-fadeIn">
          <div id="paymentModal" role="dialog" aria-modal="true" aria-label="تحصيل دفعة" className="clinic-modal-panel bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4 max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h2 className="text-base font-black text-[#0f3d3e]">
                تحصيل دفعة مالية جديدة
              </h2>
              <button
                type="button"
                disabled={saving} onClick={() => { if (!saving) setIsPaymentModalOpen(false); }}
                className="p-2 text-slate-400 hover:text-slate-600 cursor-pointer rounded-xl bg-slate-100 min-h-[44px] min-w-[44px] flex items-center justify-center"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSavePaymentInstallment} className="space-y-4"><fieldset disabled={saving} className="contents">
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
                      setPaymentAmount(getPatientCollectionPresentation(patient, sess, canRevealRemainingBalance).initialAmount);
                      setIsPaymentAmountDefault(canRevealRemainingBalance);
                    }
                  }}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold focus:outline-none focus:border-[#0f3d3e]"
                >
                  {patient.sessions.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.type} ({s.toothLabel || 'عام'}){getPatientCollectionPresentation(patient, s, canRevealRemainingBalance).optionSuffix}
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
                  min="0.01"
                  max={paymentPresentation.maxAmount}
                  step="0.01"
                  value={!canRevealRemainingBalance && isPaymentAmountDefault ? '' : paymentAmount}
                  onChange={e => {
                    setPaymentAmount(e.target.value === '' ? '' : parseFloat(e.target.value));
                    setIsPaymentAmountDefault(false);
                  }}
                  placeholder="أدخل مبلغ التحصيل"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-mono focus:outline-none focus:border-[#0f3d3e]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  تاريخ التحصيل
                </label>
                <input
                  id="input-payment-date"
                  type="date"
                  value={paymentDate}
                  onChange={e => setPaymentDate(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-mono focus:outline-none focus:border-[#0f3d3e]"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  disabled={saving} onClick={() => { if (!saving) setIsPaymentModalOpen(false); }}
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
            </fieldset></form>
          </div>
        </div>
      )}

      {/* 8.4 Appointment Modal */}
      {canManageAppointments && isApptModalOpen && (
        <div className="clinic-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-fadeIn">
          <div className="clinic-modal-panel bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4 max-h-[90dvh] overflow-y-auto modal-scroll">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h2 className="text-base font-black text-[#0f3d3e]">
                {editingAppt ? 'تعديل موعد العيادة' : 'حجز موعد جديد للمريض'}
              </h2>
              <button
                type="button"
                disabled={saving} onClick={() => { if (!saving) setIsApptModalOpen(false); }}
                className="p-2 text-slate-400 hover:text-slate-600 cursor-pointer rounded-xl bg-slate-100 min-h-[44px] min-w-[44px] flex items-center justify-center"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveApptSubmit} className="space-y-4 text-xs font-bold"><fieldset disabled={saving} className="contents">
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
                  disabled={saving} onClick={() => { if (!saving) setIsApptModalOpen(false); }}
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
            </fieldset></form>
          </div>
        </div>
      )}

      {/* 8.5 Edit Patient Demographics Modal */}
      {canEditPatients && isEditPatientModalOpen && (
        <div className="clinic-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-fadeIn">
          <div id="editPatientModal" className="clinic-modal-panel bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4 max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h2 className="text-base font-black text-[#0f3d3e]">
                تعديل بيانات ملف المريض #{patient.id}
              </h2>
              <button
                type="button"
                disabled={saving} onClick={() => { if (!saving) setIsEditPatientModalOpen(false); }}
                className="p-2 text-slate-400 hover:text-slate-600 cursor-pointer rounded-xl bg-slate-100 min-h-[44px] min-w-[44px] flex items-center justify-center"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSavePatientEdit} className="space-y-3 text-xs font-bold"><fieldset disabled={saving} className="contents">
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
                  id="input-edit-patient-mobile"
                  type="tel"
                  value={editMobile}
                  onChange={e => setEditMobile(e.target.value)}
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-xl font-mono dir-ltr"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 mb-1">السن (بالسنوات)</label>
                  <input
                    id="input-edit-patient-age"
                    type="number"
                    min="0"
                    max="120"
                    step="1"
                    value={editAge}
                    onChange={e => setEditAge(e.target.value === '' ? '' : Number(e.target.value))}
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

              <div className="optional-medical-field">
                <button
                  type="button"
                  className="optional-medical-trigger"
                  aria-expanded={showEditMedicalField}
                  aria-controls="patient-file-optional-medical-field"
                  onClick={() => setShowEditMedicalField(value => !value)}
                >
                  <FileText className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>{showEditMedicalField ? 'إخفاء الحقل' : editAllergy.trim() ? 'عرض أو تعديل المعلومة الطبية المسجّلة' : 'إضافة حساسية أو ملاحظة طبية'}</span>
                  <small>اختياري</small>
                  <ChevronDown className="w-4 h-4 shrink-0" aria-hidden="true" />
                </button>
                {!showEditMedicalField && editAllergy.trim() && (
                  <p className="optional-medical-saved">توجد معلومة طبية محفوظة في الملف.</p>
                )}
                {showEditMedicalField && (
                  <div id="patient-file-optional-medical-field" className="optional-medical-content">
                    <label htmlFor="input-edit-patient-allergy">الحساسية أو الملاحظة الطبية</label>
                    <textarea
                      id="input-edit-patient-allergy"
                      rows={3}
                      value={editAllergy}
                      onChange={e => setEditAllergy(e.target.value)}
                      placeholder="اكتب المعلومة الطبية عند الحاجة"
                    />
                  </div>
                )}
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
                  disabled={saving} onClick={() => { if (!saving) setIsEditPatientModalOpen(false); }}
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
            </fieldset></form>
          </div>
        </div>
      )}

      {/* Appointment Status Bottom Sheet / Modal */}
      <AppointmentStatusModal
        appointment={canManageAppointments && onUpdateApptStatus ? patientStatusModalAppt : null}
        onClose={() => setPatientStatusModalAppt(null)}
        onSelectStatus={handlePatientSelectStatus}
      />
    </div>
  );
});

PatientFileView.displayName = 'PatientFileView';
