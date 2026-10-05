import React, { useRef, useState } from 'react';
import { Appointment, AppointmentStatus } from '../../types';
import { CheckCircle2, Clock, Calendar as CalendarIcon, AlertCircle, XCircle } from 'lucide-react';
import { appointmentTimeMinutes } from './appointmentScheduling';
import { useAppointmentDialog } from './useAppointmentDialog';
import { useToastAndConfirm } from '../common/ToastAndConfirm';

interface AppointmentStatusModalProps {
  appointment: Appointment | null;
  onClose: () => void;
  onSelectStatus: (status: AppointmentStatus) => Promise<void> | void;
}

export interface StatusOptionConfig {
  key: AppointmentStatus;
  label: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
  badgeBg: string;
  activeBg: string;
  dotColor: string;
  iconBg: string;
}

export const APPOINTMENT_STATUS_CONFIGS: Record<AppointmentStatus, StatusOptionConfig> = {
  attended: {
    key: 'attended',
    label: 'حضر',
    desc: 'حضر المريض وبدأت الجلسة أو الكشف',
    icon: CheckCircle2,
    badgeBg: 'bg-emerald-50 text-emerald-800 border-emerald-200/90 hover:bg-emerald-100',
    activeBg: 'bg-emerald-600 text-white',
    dotColor: 'bg-emerald-500',
    iconBg: 'bg-emerald-500 text-white',
  },
  waiting: {
    key: 'waiting',
    label: 'في الانتظار',
    desc: 'وصل المريض ومتواجد حالياً في صالة الانتظار',
    icon: Clock,
    badgeBg: 'bg-amber-50 text-amber-900 border-amber-200/90 hover:bg-amber-100',
    activeBg: 'bg-amber-500 text-white',
    dotColor: 'bg-amber-500',
    iconBg: 'bg-amber-500 text-white',
  },
  scheduled: {
    key: 'scheduled',
    label: 'موعد محجوز',
    desc: 'حجز مسجل وبانتظار حضور المريض',
    icon: CalendarIcon,
    badgeBg: 'bg-indigo-50 text-indigo-800 border-indigo-200/90 hover:bg-indigo-100',
    activeBg: 'bg-indigo-600 text-white',
    dotColor: 'bg-indigo-500',
    iconBg: 'bg-indigo-600 text-white',
  },
  apologized: {
    key: 'apologized',
    label: 'اعتذر',
    desc: 'قام المريض بالاعتذار مسبقاً وتفريغ وقت الموعد',
    icon: AlertCircle,
    badgeBg: 'bg-orange-50 text-orange-800 border-orange-200/90 hover:bg-orange-100',
    activeBg: 'bg-orange-600 text-white',
    dotColor: 'bg-orange-500',
    iconBg: 'bg-orange-500 text-white',
  },
  no_show: {
    key: 'no_show',
    label: 'لم يحضر',
    desc: 'تخلف المريض عن الحضور في الموعد المحدد',
    icon: XCircle,
    badgeBg: 'bg-rose-50 text-rose-800 border-rose-200/90 hover:bg-rose-100',
    activeBg: 'bg-rose-600 text-white',
    dotColor: 'bg-rose-500',
    iconBg: 'bg-rose-500 text-white',
  },
  confirmed: {
    key: 'confirmed',
    label: 'أكد الحضور',
    desc: 'موعد مؤكد وبانتظار الحضور',
    icon: CalendarIcon,
    badgeBg: 'bg-indigo-50 text-indigo-800 border-indigo-200/90 hover:bg-indigo-100',
    activeBg: 'bg-indigo-600 text-white',
    dotColor: 'bg-indigo-500',
    iconBg: 'bg-indigo-600 text-white',
  },
  cancelled: {
    key: 'cancelled',
    label: 'ملغي',
    desc: 'إلغاء الموعد وإتاحة وقته لحجز آخر',
    icon: XCircle,
    badgeBg: 'bg-orange-50 text-orange-800 border-orange-200/90 hover:bg-orange-100',
    activeBg: 'bg-orange-600 text-white',
    dotColor: 'bg-orange-500',
    iconBg: 'bg-orange-500 text-white',
  },
};

export const format12HourTime = (time24: string): string => {
  if (appointmentTimeMinutes(time24) === null) return 'وقت غير محدد';
  const [hStr, mStr] = time24.split(':');
  let h = parseInt(hStr, 10);
  const period = h >= 12 ? 'م' : 'ص';
  h = h % 12 || 12;
  return `${h}:${mStr || '00'} ${period}`;
};

export const AppointmentStatusModal: React.FC<AppointmentStatusModalProps> = ({
  appointment,
  onClose,
  onSelectStatus,
}) => {
  const [selectedUpdatingKey, setSelectedUpdatingKey] = useState<AppointmentStatus | null>(null);
  const updatingRef = useRef(false);
  const { showToast } = useToastAndConfirm();
  const closeDialog = () => { if (!updatingRef.current) onClose(); };
  const dialogRef = useAppointmentDialog(Boolean(appointment), closeDialog);

  if (!appointment) return null;

  const handleChoose = async (statusKey: AppointmentStatus) => {
    if (updatingRef.current) return;
    if (appointment.status === statusKey) {
      onClose();
      return;
    }
    updatingRef.current = true;
    setSelectedUpdatingKey(statusKey);
    try {
      await onSelectStatus(statusKey);
    } catch {
      showToast('تعذّر تحديث حالة الموعد. حاول مرة أخرى.', 'error');
    } finally {
      updatingRef.current = false;
      setSelectedUpdatingKey(null);
    }
  };

  const statusList: AppointmentStatus[] = ['scheduled', 'confirmed', 'waiting', 'attended', 'apologized', 'no_show', 'cancelled'];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-xs p-0 sm:p-4 animate-fadeIn"
      onClick={closeDialog}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="appointment-status-title"
        tabIndex={-1}
        dir="rtl"
        className="bg-white rounded-t-3xl sm:rounded-3xl max-w-md w-full p-5 sm:p-6 shadow-2xl border border-slate-200 space-y-4 max-h-[90dvh] overflow-y-auto modal-scroll font-tajawal"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div>
            <h3 id="appointment-status-title" className="text-base font-extrabold text-slate-900 leading-tight">
              تحديد حالة الموعد
            </h3>
            <p className="text-xs text-slate-500 font-bold mt-0.5">
              {appointment.patientName} • {format12HourTime(appointment.time)}
            </p>
          </div>
          <button
            type="button"
            onClick={closeDialog}
            disabled={selectedUpdatingKey !== null}
            className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-colors cursor-pointer min-h-[44px] touch-manipulation flex items-center justify-center"
          >
            إلغاء وإغلاق
          </button>
        </div>

        {/* Options */}
        <div className="space-y-2.5 pt-1">
          {statusList.map((statusKey) => {
            const config = APPOINTMENT_STATUS_CONFIGS[statusKey];
            const isCurrent = appointment.status === statusKey;
            const isLoading = selectedUpdatingKey === statusKey;
            const StatusIcon = config.icon;

            return (
              <button
                key={statusKey}
                type="button"
                disabled={selectedUpdatingKey !== null}
                onClick={() => handleChoose(statusKey)}
                aria-pressed={isCurrent}
                className={`w-full p-3.5 rounded-2xl border text-right transition-all flex items-center justify-between gap-3 cursor-pointer min-h-[56px] active:scale-[0.98] touch-manipulation ${
                  isCurrent
                    ? 'bg-slate-900 text-white border-slate-900 shadow-md ring-2 ring-slate-400/30'
                    : 'bg-white hover:bg-slate-50 text-slate-800 border-slate-200/90'
                } ${selectedUpdatingKey !== null && !isLoading ? 'opacity-50' : ''}`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${config.iconBg}`}
                  >
                    <StatusIcon className="w-5 h-5 text-white" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-extrabold text-sm block leading-tight">
                        {config.label}
                      </span>
                      {isCurrent && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/20 text-white font-bold">
                          الحالية
                        </span>
                      )}
                    </div>
                    <span
                      className={`text-xs block mt-1 leading-relaxed ${
                        isCurrent ? 'text-slate-300' : 'text-slate-500'
                      }`}
                    >
                      {config.desc}
                    </span>
                  </div>
                </div>

                {isLoading ? (
                  <div className="w-5 h-5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin shrink-0" />
                ) : (
                  <div
                    className={`w-3 h-3 rounded-full shrink-0 ${
                      isCurrent ? 'bg-emerald-400' : 'bg-slate-300'
                    }`}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

