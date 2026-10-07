import React, { useState, useEffect, useRef } from 'react';
import { Clock, Sparkles, AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { AiService, ScheduleRecommendation } from '../../services/aiService';
import { Appointment, Patient } from '../../types';
import { useToastAndConfirm } from '../common/ToastAndConfirm';
import { appointmentTimeMinutes, availableAppointmentTimes, findAppointmentConflicts, isValidAppointmentDate, localDateISO, occupiesAppointmentSlot } from './appointmentScheduling';
import { useAppointmentDialog } from './useAppointmentDialog';
import { useConfirmedAction } from '../common/useConfirmedAction';
import { createAppointmentDraftGuard } from './appointmentDraftGuard';

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
  const draftContext = JSON.stringify([selectedPatientId, patients.find(patient => patient.id === selectedPatientId), procedureType, apptDate, selectedTime, notes, durationMinutes, existingAppointments]);
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
  const dialogRef = useAppointmentDialog(isOpen, handleClose);

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
    setApptDate(localDateISO());
    setNotes('');
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
      <div id="smart-schedule-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="smart-schedule-title" tabIndex={-1} dir="rtl" className="clinic-modal-panel clinic-modal-panel--framed bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-xl max-h-[92dvh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="shrink-0 p-4 sm:p-5 bg-gradient-to-r from-indigo-900 via-indigo-950 to-slate-900 text-white flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 shrink-0 rounded-xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-300">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 id="smart-schedule-title" className="text-base font-bold">حجز موعد بمساعدة الجدول</h3>
              <p className="text-xs text-indigo-200/80">مدة تقديرية للإجراء وأوقات خالية من التعارض</p>
            </div>
          </div>
          <button type="button" disabled={saving} onClick={handleClose} aria-label="إلغاء وإغلاق" className="min-w-[44px] min-h-[44px] shrink-0 flex items-center justify-center rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition disabled:opacity-50">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <fieldset disabled={saving} className="p-4 sm:p-5 space-y-4 min-w-0 min-h-0 overflow-y-auto">
          {/* Patient select */}
          <div>
            <label htmlFor="smart-schedule-patient" className="block text-sm font-bold text-slate-700 mb-1">المريض</label>
            <select
              id="smart-schedule-patient"
              data-dialog-autofocus
              value={selectedPatientId}
              onChange={e => setSelectedPatientId(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">-- اختر المريض من القائمة --</option>
              {patients.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} (#{p.id}) - {p.mobile}
                </option>
              ))}
            </select>
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
              <p className="text-sm text-indigo-700 animate-pulse">جاري مراجعة الأوقات المتاحة...</p>
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

        {/* Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-end gap-2 shrink-0">
          <button type="button" disabled={saving} onClick={handleClose} className="px-4 py-2 min-h-[44px] text-sm font-bold text-slate-700 hover:bg-slate-200 rounded-xl transition disabled:opacity-50">
            إلغاء وإغلاق
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={handleSave}
            className="px-5 py-2 min-h-[44px] text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-xl shadow-md transition flex items-center gap-1.5"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>{saving ? 'جارٍ حفظ الموعد…' : 'تأكيد وجدولة الموعد'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
