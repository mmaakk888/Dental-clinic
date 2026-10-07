import React, { useState, useMemo } from 'react';
import { Bell, Calendar, DollarSign, Microscope, AlertCircle, CheckCircle, X, ArrowLeft, Clock } from 'lucide-react';
import { Patient, Appointment, LabCase, ActiveView, NavigationOrigin } from '../../types';
import { getPatientFinancialSummary } from '../../utils/financials';
import { useAppointmentDialog } from '../appointments/useAppointmentDialog';

export interface NotificationItem {
  id: string;
  type: 'appointment' | 'finance' | 'lab' | 'system';
  title: string;
  message: string;
  date: string;
  isRead: boolean;
  actionPayload?: {
    patientId?: string;
    view?: ActiveView;
  };
}

interface NotificationCenterModalProps {
  isOpen: boolean;
  onClose: () => void;
  patients: Patient[];
  appointments: Appointment[];
  labCases: LabCase[];
  onSelectPatient: (patientId: string, origin: NavigationOrigin) => void;
  onNavigate: (view: ActiveView) => void;
}

export const NotificationCenterModal: React.FC<NotificationCenterModalProps> = ({
  isOpen,
  onClose,
  patients,
  appointments,
  labCases,
  onSelectPatient,
  onNavigate
}) => {
  const [filterType, setFilterType] = useState<'all' | 'appointment' | 'finance' | 'lab'>('all');
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const dialogRef = useAppointmentDialog(isOpen, onClose);

  const now = new Date();
  const todayStr = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

  // Dynamically compute notification items
  const notifications = useMemo(() => {
    const list: NotificationItem[] = [];
    if (!isOpen) return list;

    // 1. Today's appointments
    const todayAppts = appointments.filter(a => a.date === todayStr);
    todayAppts.forEach(a => {
      list.push({
        id: `notif-appt-${a.id}`,
        type: 'appointment',
        title: `موعد اليوم: ${a.patientName}`,
        message: `الموعد الساعة ${a.time} - ${a.note || 'متابعة'}`,
        date: 'اليوم',
        isRead: readIds.has(`notif-appt-${a.id}`),
        actionPayload: { view: 'appointments' }
      });
    });

    // 2. Overdue patient balances (> 0)
    patients.forEach(p => {
      const balance = getPatientFinancialSummary(p).totalRemaining;

      if (balance > 500) {
        list.push({
          id: `notif-fin-${p.id}`,
          type: 'finance',
          title: `رصيد متبقٍ: ${p.name}`,
          message: `يوجد متبقي مالي بقيمة ${balance.toLocaleString()} ج.م على المريض (ملف #${p.id})`,
          date: 'مستحق',
          isRead: readIds.has(`notif-fin-${p.id}`),
          actionPayload: { patientId: p.id }
        });
      }
    });

    // 3. Lab cases ready or pending delivery
    labCases.forEach(l => {
      if (l.status === 'pending') {
        list.push({
          id: `notif-lab-${l.id}`,
          type: 'lab',
          title: `حالة معمل منتظرة: ${l.patientName}`,
          message: `حالة (${l.type}) مع معمل "${l.labName}" قيد التجهيز والتسليم`,
          date: l.date,
          isRead: readIds.has(`notif-lab-${l.id}`),
          actionPayload: { view: 'lab' }
        });
      }
    });

    return list;
  }, [isOpen, patients, appointments, labCases, todayStr, readIds]);

  const unreadCount = notifications.filter(n => !n.isRead).length;

  const filteredNotifications = notifications.filter(n => {
    if (filterType === 'all') return true;
    return n.type === filterType;
  });

  const handleMarkAllRead = () => {
    const allIds = new Set(notifications.map(n => n.id));
    setReadIds(allIds);
  };

  const handleItemClick = (notif: NotificationItem) => {
    setReadIds(prev => new Set([...prev, notif.id]));
    if (notif.actionPayload?.patientId) {
      onSelectPatient(notif.actionPayload.patientId, 'patients');
      onClose();
    } else if (notif.actionPayload?.view) {
      onNavigate(notif.actionPayload.view);
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="clinic-modal-overlay fixed inset-0 z-50 flex items-start sm:items-center justify-end p-3 sm:p-4 bg-slate-900/40">
      <div
        ref={dialogRef} id="clinic-notifications-dialog" role="dialog" aria-modal="true" aria-labelledby="clinic-notifications-title" tabIndex={-1}
        className="clinic-modal-panel clinic-modal-panel--framed bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden font-tajawal flex flex-col max-h-[90dvh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between gap-3 bg-slate-50/80">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold">
              <Bell className="w-5 h-5" />
            </div>
            <div>
              <h3 id="clinic-notifications-title" className="font-extrabold text-slate-900 text-lg flex items-center gap-2">
                مركز التنبيهات
                {unreadCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-rose-500 text-white text-xs font-bold">
                    {unreadCount} جديد
                  </span>
                )}
              </h3>
              <p className="text-xs text-slate-500">متابعة المواعيد، المتأخرات وحالات المعمل</p>
            </div>
          </div>
          <button
            type="button" aria-label="إغلاق التنبيهات"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] p-2 rounded-xl hover:bg-slate-200 text-slate-500 hover:text-slate-700"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Action controls & filter tabs */}
        <div className="shrink-0 p-3 bg-white border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5 text-sm font-bold">
            <button
              onClick={() => setFilterType('all')}
              className={`px-3 py-1.5 rounded-xl transition-all cursor-pointer ${
                filterType === 'all' ? 'bg-indigo-600 text-white shadow-xs' : 'bg-slate-100 text-slate-600'
              }`}
            >
              الكل ({notifications.length})
            </button>
            <button
              onClick={() => setFilterType('appointment')}
              className={`px-3 py-1.5 rounded-xl transition-all cursor-pointer ${
                filterType === 'appointment' ? 'bg-amber-600 text-white shadow-xs' : 'bg-slate-100 text-slate-600'
              }`}
            >
              المواعيد
            </button>
            <button
              onClick={() => setFilterType('finance')}
              className={`px-3 py-1.5 rounded-xl transition-all cursor-pointer ${
                filterType === 'finance' ? 'bg-rose-600 text-white shadow-xs' : 'bg-slate-100 text-slate-600'
              }`}
            >
              المالية
            </button>
            <button
              onClick={() => setFilterType('lab')}
              className={`px-3 py-1.5 rounded-xl transition-all cursor-pointer ${
                filterType === 'lab' ? 'bg-purple-600 text-white shadow-xs' : 'bg-slate-100 text-slate-600'
              }`}
            >
              المعمل
            </button>
          </div>

          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              className="text-xs font-bold text-indigo-600 hover:text-indigo-800 transition-colors shrink-0"
            >
              قراءة الكل
            </button>
          )}
        </div>

        {/* Notifications List */}
        <div className="min-h-0 p-3 overflow-y-auto space-y-2 flex-1">
          {filteredNotifications.length === 0 ? (
            <div className="py-12 text-center text-slate-400 space-y-2">
              <CheckCircle className="w-12 h-12 mx-auto text-emerald-400 stroke-1" />
              <p className="font-bold text-sm text-slate-700">لا توجد تنبيهات جديدة حالياً</p>
              <p className="text-sm text-slate-500">لا توجد عناصر للعرض في هذا القسم.</p>
            </div>
          ) : (
            filteredNotifications.map(n => {
              let bg = 'bg-slate-50 border-slate-200';
              let icon = <Bell className="w-4 h-4 text-indigo-600" />;

              if (n.type === 'appointment') {
                bg = 'bg-amber-50/70 border-amber-200/80 hover:bg-amber-100/80';
                icon = <Calendar className="w-4 h-4 text-amber-600" />;
              } else if (n.type === 'finance') {
                bg = 'bg-rose-50/70 border-rose-200/80 hover:bg-rose-100/80';
                icon = <DollarSign className="w-4 h-4 text-rose-600" />;
              } else if (n.type === 'lab') {
                bg = 'bg-purple-50/70 border-purple-200/80 hover:bg-purple-100/80';
                icon = <Microscope className="w-4 h-4 text-purple-600" />;
              }

              return (
                <button type="button"
                  key={n.id}
                  onClick={() => handleItemClick(n)}
                  className={`w-full text-start p-3.5 rounded-xl border cursor-pointer flex items-start gap-3 relative ${bg} ${
                    !n.isRead ? 'border-indigo-300' : 'opacity-85'
                  }`}
                >
                  <div className="p-2 rounded-xl bg-white shadow-xs shrink-0 mt-0.5">
                    {icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="font-extrabold text-sm text-slate-900">
                        {n.title}
                      </span>
                      <span className="text-[10px] font-bold text-slate-400 shrink-0">
                        {n.date}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      {n.message}
                    </p>
                  </div>
                  <ArrowLeft className="w-4 h-4 text-slate-400 shrink-0 self-center opacity-60" />
                </button>
              );
            })
          )}
        </div>

        <div className="p-3 bg-slate-50 border-t border-slate-100 text-center text-xs text-slate-500 font-bold">
          يتم تحديث التنبيهات تلقائياً مع جميع حركات العيادة
        </div>
      </div>
    </div>
  );
};
