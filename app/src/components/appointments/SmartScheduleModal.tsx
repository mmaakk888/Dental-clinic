import React, { useDeferredValue, useMemo, useState, useEffect, useRef } from 'react';
import { Clock, Sparkles, AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { AiService, ScheduleRecommendation } from '../../services/aiService';
import { Appointment, Patient } from '../../types';
import { useToastAndConfirm } from '../common/ToastAndConfirm';
import { appointmentTimeMinutes, availableAppointmentTimes, findAppointmentConflicts, isValidAppointmentDate, localDateISO, occupiesAppointmentSlot } from './appointmentScheduling';
import { useAppointmentDialog } from './useAppointmentDialog';
import { useConfirmedAction } from '../common/useConfirmedAction';
import { createAppointmentDraftGuard } from './appointmentDraftGuard';
import { useDialogCloseGuard } from '../common/useDialogCloseGuard';
import { buildHomePatientSearch, searchHomePatients } from '../../utils/homePatientSearch';
import '../common/ActionDialog.css';

interface SmartScheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  patients: Patient[];
  existingAppointments: Appointment[];
  onBookAppointment: (appt: Partial<Appointment>) => void | Promise<void>;
}

const PROCEDURES = [
  { label: 'كشف واستشارة', duration: 20 },
  { label: 'علاج عصب', duration: 60 },
  { label: 'خلع أسنان', duration: 30 },
  { label: 'تركيب طربوش', duration: 45 },
  { label: 'حشو ليزر تجميلي', duration: 35 },
  { label: 'تنظيف وتلميع أسنان', duration: 30 },
  { label: 'جلسة متابعة', duration: 15 },
];

export const SmartScheduleModal: React.FC<SmartScheduleModalProps> = ({
  isOpen,
  onClose,
  patients,
  existingAppointments,
  onBookAppointment,
}) => {
  const [selectedPatientId, setSelectedPatientId] = useState<string>('');
  const [patientQuery, setPatientQuery] = useState('');
  const deferredPatientQuery = useDeferredValue(patientQuery);
  const patientIndex = useMemo(() => buildHomePatientSearch(patients), [patients]);
  const patientResults = useMemo(() => searchHomePatients(patientIndex, deferredPatientQuery, 8, true), [patientIndex, deferredPatientQuery]);
  const selectedPatient = useMemo(() => patients.find(patient => patient.id === selectedPatientId), [patients, selectedPatientId]);
  const [procedureType, setProcedureType] = useState<string>('علاج عصب');
  const [apptDate, setApptDate] = useState<string>(localDateISO());
  const [selectedTime, setSelectedTime] = useState<string>('17:30');
  const [notes, setNotes] = useState<string>('');
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [recommendation, setRecommendation] = useState<ScheduleRecommendation | null>(null);
  const { showToast, validationFail, askConfirm, cancelConfirm } = useToastAndConfirm();
  const { saving, run } = useConfirmedAction();
  const committingRef = useRef(false);
  const mountedRef = useRef(true);
  const draftGuardRef = useRef(createAppointmentDraftGuard());
  const pendingConfirmationRef = useRef<(() => boolean) | null>(null);
  const timeWasEditedRef = useRef(false);
  const durationMinutes = recommendation?.estimatedMinutes || PROCEDURES.find(procedure => procedure.label === procedureType)?.duration || 30;
  // Immutable dataset identities invalidate pending confirmations without serializing
  // every appointment and full clinical patient history on each keystroke.
  const dataRevision = useRef({ patients, appointments: existingAppointments, version: 0 });
  if (dataRevision.current.patients !== patients || dataRevision.current.appointments !== existingAppointments) {
    dataRevision.current = { patients, appointments: existingAppointments, version: dataRevision.current.version + 1 };
  }
  const draftContext = JSON.stringify([selectedPatientId, procedureType, apptDate, selectedTime, notes, durationMinutes, dataRevision.current.version]);
  draftGuardRef.current.update(isOpen, draftContext);
  const invalidateConfirmation = () => {
    draftGuardRef.current.invalidate();
    if (pendingConfirmationRef.current) {
      pendingConfirmationRef.current = null;
      cancelConfirm();
    }
  };
  const handleClose = () => {
    if (committingRef.current) return;
    invalidateConfirmation();
    onClose();
  };
  const requestClose = useDialogCloseGuard(isOpen, !!(selectedPatientId || patientQuery.trim() || notes.trim() || procedureType !== 'علاج عصب' || apptDate !== localDateISO() || timeWasEditedRef.current), saving, handleClose);
  const dialogRef = useAppointmentDialog(isOpen, requestClose);

  useEffect(() => {
    mountedRef.current = true;
    draftGuardRef.current.update(isOpen, draftContext);
    return () => {
      mountedRef.current = false;
      draftGuardRef.current.update(false, '');
      if (pendingConfirmationRef.current) {
        pendingConfirmationRef.current = null;
        cancelConfirm();
      }
    };
  }, [cancelConfirm]);

  useEffect(() => {
    if (pendingConfirmationRef.current && !pendingConfirmationRef.current()) {
      pendingConfirmationRef.current = null;
      cancelConfirm();
    }
  }, [draftContext, isOpen, cancelConfirm]);

  useEffect(() => {
    if (!isOpen) return;
    setSelectedPatientId('');
    setPatientQuery('');
    setApptDate(localDateISO());
    setNotes('');
    setProcedureType('علاج عصب');
    setSelectedTime('17:30');
    timeWasEditedRef.current = false;
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !isValidAppointmentDate(apptDate)) {
      setRecommendation(null);
      setIsAnalyzing(false);
      return;
    }
    let isCurrentRequest = true;
    const defaultDuration = PROCEDURES.find(procedure => procedure.label === procedureType)?.duration || 30;
    setIsAnalyzing(true);
    setRecommendation(null);
    const applyRecommendation = (result: ScheduleRecommendation) => {
      if (!isCurrentRequest) return;
      const duration = Number.isFinite(result.estimatedMinutes) && result.estimatedMinutes >= 10 && result.estimatedMinutes <= 180
        ? result.estimatedMinutes : defaultDuration;
      const dayAppts = existingAppointments.filter(appointment => appointment.date === apptDate && occupiesAppointmentSlot(appointment));
      const now = new Date();
      const today = localDateISO(now);
      const validTimes = Array.isArray(result.suggestedSlots) ? result.suggestedSlots.filter(time => {
        const minute = appointmentTimeMinutes(time);
        return minute !== null && (apptDate > today || (apptDate === today && minute > now.getHours() * 60 + now.getMinutes()))
          && !findAppointmentConflicts(dayAppts, apptDate, time, duration).length;
      }) : [];
      const suggestedSlots = Array.from(new Set([...validTimes, ...availableAppointmentTimes(dayAppts, apptDate, duration, now)]));
      setRecommendation({
        estimatedMinutes: duration,
        suggestedSlots,
        workloadStatus: result.workloadStatus || 'balanced',
        recommendation: result.recommendation || `مدة الإجراء التقديرية: ${duration} دقيقة. راجع الوقت قبل الحجز.`,
        warningNote: suggestedSlots.length ? result.warningNote : 'لا توجد أوقات مقترحة متاحة. يمكنك اختيار وقت يدويًا ومراجعة تعارضه قبل الحجز.',
      });
      if (!timeWasEditedRef.current && suggestedSlots.length) setSelectedTime(suggestedSlots[0]);
      setIsAnalyzing(false);
    };
    AiService.suggestSchedule(procedureType, apptDate, existingAppointments.filter(appointment => appointment.date === apptDate && occupiesAppointmentSlot(appointment)))
      .then(applyRecommendation)
      .catch(() => applyRecommendation({ estimatedMinutes: defaultDuration, suggestedSlots: [], workloadStatus: 'balanced', recommendation: `مدة الإجراء التقديرية: ${defaultDuration} دقيقة.` }));
    return () => { isCurrentRequest = false; };
  }, [isOpen, procedureType, apptDate, existingAppointments]);

  if (!isOpen) return null;

  const handleSave = () => {
    if (committingRef.current) return;
    const patient = patients.find(p => p.id === selectedPatientId);
    if (!patient) {
      validationFail('smart-schedule-dialog', 'smart-schedule-patient', 'اختر ملف مريض موجودًا للحجز');
      return;
    }
    if (!isValidAppointmentDate(apptDate)) {
      validationFail('smart-schedule-dialog', 'smart-schedule-date', 'اختر تاريخًا صحيحًا للموعد');
      return;
    }
    if (appointmentTimeMinutes(selectedTime) === null) {
      validationFail('smart-schedule-dialog', 'smart-schedule-time', 'اختر وقتًا صحيحًا للموعد');
      return;
    }

    const appointment: Partial<Appointment> = {
      patientId: patient.id,
      fileNo: patient.id,
      patientName: patient.name,
      mobile: patient.mobile || '',
      date: apptDate,
      time: selectedTime,
      appointmentType: procedureType,
      durationMinutes,
      note: notes.trim() || procedureType,
      status: 'scheduled',
      isFollowUp: procedureType.includes('متابعة'),
      isWalkIn: false,
    };
    const isCurrentDraft = draftGuardRef.current.capture();
    const saveAppointment = async () => {
      if (committingRef.current || !isCurrentDraft()) return;
      pendingConfirmationRef.current = null;
      committingRef.current = true;
      try {
        await run(() => onBookAppointment(appointment), () => {
          if (!mountedRef.current) return;
          showToast('تم حجز الموعد بنجاح');
          onClose();
        });
      } finally { committingRef.current = false; }
    };
    if (findAppointmentConflicts(existingAppointments, apptDate, selectedTime, durationMinutes).length) {
      pendingConfirmationRef.current = isCurrentDraft;
      askConfirm({
        title: 'موعد متعارض',
        message: 'يتداخل هذا الموعد مع حجز آخر مسجل. هل تريد تأكيد الحجز رغم التعارض؟',
        confirmLabel: 'تأكيد الحجز',
        tone: 'warning',
        onConfirm: saveAppointment,
      });
      return;
    }
    void saveAppointment();
  };

  return (
    <div className="clinic-modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
      <div id="smart-schedule-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="smart-schedule-title" tabIndex={-1} dir="rtl" data-action-tone="amber" aria-busy={saving} className="clinic-modal-panel clinic-modal-panel--framed clinic-action-dialog bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="clinic-action-header">
          <div className="clinic-action-heading">
            <div className="clinic-action-symbol">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 id="smart-schedule-title">حجز موعد</h3>
              <p>اختيار ملف ووقت متاح، بدون إضافة خدمة أو دفعة.</p>
            </div>
          </div>
          <button type="button" disabled={saving} onClick={requestClose} aria-label="إلغاء وإغلاق" className="clinic-action-close">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="clinic-dialog-scroll min-h-0 flex-1 overflow-y-auto p-4 sm:p-5" role="region" aria-label="تفاصيل حجز الموعد" tabIndex={0}>
        <fieldset disabled={saving} className="space-y-4 min-w-0">
          {/* Patient select */}
          <div>
            {selectedPatient ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 flex items-center justify-between gap-3 flex-wrap"><div><strong className="block">{selectedPatient.name}</strong><small className="text-slate-600">ملف <bdi>#{selectedPatient.id}</bdi> · <bdi>{selectedPatient.mobile}</bdi></small></div><button type="button" className="clinic-action-cancel" onClick={() => setSelectedPatientId('')}>تغيير المريض</button></div> : <>
              <label htmlFor="smart-schedule-patient" className="block text-sm font-bold text-slate-700 mb-1">المريض: الاسم أو رقم الملف أو الهاتف</label>
              <input id="smart-schedule-patient" data-dialog-autofocus value={patientQuery} onChange={event => setPatientQuery(event.target.value)} autoComplete="off" placeholder="ابحث عن ملف المريض" className="w-full px-3 py-2 rounded-xl border border-slate-300" />
              <div className="walkin-results" aria-busy={patientQuery !== deferredPatientQuery}>{patientResults.map(patient => <button type="button" key={patient.id} onClick={() => setSelectedPatientId(patient.id)}><strong>{patient.name} <bdi>#{patient.id}</bdi></strong><small><bdi>{patient.mobile}</bdi></small></button>)}{!patientResults.length && <p className="p-3 text-sm text-slate-500">لا يوجد ملف مطابق. أضف ملف المريض أولًا من قسم المرضى.</p>}</div>
            </>}
          </div>

          {/* Procedure & Date */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">نوع الإجراء الطبي</label>
              <select
                value={procedureType}
                onChange={e => { timeWasEditedRef.current = false; setProcedureType(e.target.value); }}
                className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500"
              >
                {PROCEDURES.map(proc => (
                  <option key={proc.label} value={proc.label}>
                    {proc.label} (~{proc.duration} دقيقة)
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="smart-schedule-date" className="block text-sm font-bold text-slate-700 mb-1">تاريخ الحجز</label>
              <input
                id="smart-schedule-date"
                type="date"
                value={apptDate}
                onChange={e => { timeWasEditedRef.current = false; setApptDate(e.target.value); }}
                className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          {/* AI Recommendation Widget */}
          <div className="p-4 rounded-xl bg-indigo-50/70 border border-indigo-200 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-xs font-bold text-indigo-900 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-indigo-600 shrink-0" /> أوقات مقترحة للمراجعة قبل الحجز
              </span>
              {recommendation && (
                <span
                  className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${
                    recommendation.workloadStatus === 'busy'
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-emerald-100 text-emerald-800'
                  }`}
                >
                  {recommendation.workloadStatus === 'busy' ? 'إشغال مرتفع' : 'جدول متوازن'}
                </span>
              )}
            </div>

            {isAnalyzing ? (
              <p className="text-sm text-indigo-700" role="status">جارٍ مراجعة الأوقات المتاحة…</p>
            ) : (
              recommendation && (
                <div className="space-y-2 text-xs text-slate-700">
                  <p className="font-medium">{recommendation.recommendation}</p>

                  {recommendation.warningNote && (
                    <div className="p-2 rounded bg-amber-100/80 text-amber-900 border border-amber-200 flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
                      <span>{recommendation.warningNote}</span>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">الأوقات الموصى بها (انقر للاختيار):</label>
                    <div className="flex flex-wrap gap-2">
                      {recommendation.suggestedSlots.map(slot => (
                        <button
                          key={slot}
                          type="button"
                          onClick={() => { timeWasEditedRef.current = true; setSelectedTime(slot); }}
                          aria-pressed={selectedTime === slot}
                          className={`px-3 py-1.5 rounded-lg font-bold text-xs transition border ${
                            selectedTime === slot
                              ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                              : 'bg-white text-slate-700 border-slate-300 hover:border-indigo-400'
                          }`}
                        >
                          <Clock className="w-3 h-3 inline-block ml-1" />
                          {slot}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )
            )}
          </div>

          {/* Manual time selection & notes */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="smart-schedule-time" className="block text-sm font-bold text-slate-700 mb-1">وقت الموعد المختار</label>
              <input
                id="smart-schedule-time"
                type="time"
                value={selectedTime}
                onChange={e => { timeWasEditedRef.current = true; setSelectedTime(e.target.value); }}
                className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">ملاحظات حجز الموعد</label>
              <input
                type="text"
                placeholder="مثال: مريض حساسية، تجهيز طربوش..."
                value={notes}
                onChange={e => setNotes(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
        </fieldset>
        </div>

        {/* Footer */}
        <div className="clinic-action-footer">
          <button type="button" disabled={saving} onClick={requestClose} className="clinic-action-cancel">
            إلغاء وإغلاق
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={handleSave}
            className="clinic-action-primary"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>{saving ? 'جارٍ حفظ الموعد…' : 'تأكيد وجدولة الموعد'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
