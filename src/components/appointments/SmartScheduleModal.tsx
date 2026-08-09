import React, { useState, useEffect } from 'react';
import { Calendar, Clock, Sparkles, AlertTriangle, CheckCircle2, User, X } from 'lucide-react';
import { AiService, ScheduleRecommendation } from '../../services/aiService';
import { Appointment, Patient } from '../../types';

interface SmartScheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  patients: Patient[];
  existingAppointments: Appointment[];
  onBookAppointment: (appt: Partial<Appointment>) => void;
}

const PROCEDURES = [
  { label: 'كشف واستشارة', duration: 20 },
  { label: 'علاج عصب (Root Canal)', duration: 60 },
  { label: 'خلع أسنان', duration: 30 },
  { label: 'طربوش زيركون / PFM', duration: 45 },
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
  const [procedureType, setProcedureType] = useState<string>('علاج عصب (Root Canal)');
  const [apptDate, setApptDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [selectedTime, setSelectedTime] = useState<string>('17:30');
  const [notes, setNotes] = useState<string>('');
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [recommendation, setRecommendation] = useState<ScheduleRecommendation | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetchRecommendation();
    }
  }, [isOpen, procedureType, apptDate]);

  if (!isOpen) return null;

  const fetchRecommendation = async () => {
    setIsAnalyzing(true);
    const dayAppts = existingAppointments.filter(a => a.date === apptDate);
    const res = await AiService.suggestSchedule(procedureType, apptDate, dayAppts);
    setRecommendation(res);
    if (res.suggestedSlots && res.suggestedSlots.length > 0) {
      setSelectedTime(res.suggestedSlots[0]);
    }
    setIsAnalyzing(false);
  };

  const handleSave = () => {
    const patient = patients.find(p => p.id === selectedPatientId);
    if (!patient && !selectedPatientId) return;

    onBookAppointment({
      patientId: patient?.id || 'new',
      fileNo: patient?.id || '101',
      patientName: patient?.name || 'مريض جديد',
      mobile: patient?.mobile || '',
      date: apptDate,
      time: selectedTime,
      appointmentType: procedureType,
      durationMinutes: recommendation?.estimatedMinutes || 30,
      note: notes,
      status: 'scheduled',
      isFollowUp: procedureType.includes('متابعة'),
      isWalkIn: false,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 sm:p-5 bg-gradient-to-r from-indigo-900 via-indigo-950 to-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-300">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold">جدولة المواعيد موازنة جهد العيادة الذكية</h3>
              <p className="text-xs text-indigo-200/80">حساب مدة الإجراء تلقائياً واقتراح الأوقات المثالية</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* Patient select */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">المريض</label>
            <select
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
                onChange={e => setProcedureType(e.target.value)}
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
              <label className="block text-xs font-bold text-slate-700 mb-1">تاريخ الحجز</label>
              <input
                type="date"
                value={apptDate}
                onChange={e => setApptDate(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          {/* AI Recommendation Widget */}
          <div className="p-4 rounded-xl bg-indigo-50/70 border border-indigo-200 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-indigo-900 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-indigo-600" /> اقتراح الذكاء الاصطناعي لموازنة عبء العمل
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
              <p className="text-xs text-indigo-700 animate-pulse">جاري تحليل جدول الطبيب وتوقع المدة الأنسب...</p>
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
                          onClick={() => setSelectedTime(slot)}
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
              <label className="block text-xs font-bold text-slate-700 mb-1">وقت الموعد المختار</label>
              <input
                type="time"
                value={selectedTime}
                onChange={e => setSelectedTime(e.target.value)}
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
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-200 rounded-xl transition">
            إلغاء وإغلاق
          </button>
          <button
            onClick={handleSave}
            disabled={!selectedPatientId}
            className="px-5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-xl shadow-md transition flex items-center gap-1.5"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>تأكيد وجدولة الموعد</span>
          </button>
        </div>
      </div>
    </div>
  );
};
