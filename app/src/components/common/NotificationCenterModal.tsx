import React, { useState, useEffect } from 'react';
import { Bell, Calendar, DollarSign, Microscope, CheckCircle, X, ArrowLeft } from 'lucide-react';
import type { ActiveView, NavigationOrigin } from '../../types';
import { countUnreadNotifications, type ClinicNotification } from '../../utils/clinicNotifications';
import { useAppointmentDialog } from '../appointments/useAppointmentDialog';

interface NotificationCenterModalProps {
  isOpen: boolean;
  onClose: () => void;
  notifications: readonly ClinicNotification[];
  readKeys: ReadonlySet<string>;
  onMarkRead: (keys: string[]) => void;
  onSelectPatient: (patientId: string, origin: NavigationOrigin) => void;
  onNavigate: (view: ActiveView) => void;
}

export const NotificationCenterModal: React.FC<NotificationCenterModalProps> = ({
  isOpen,
  onClose,
  notifications,
  readKeys,
  onMarkRead,
  onSelectPatient,
  onNavigate
}) => {
  const [filterType, setFilterType] = useState<'all' | 'appointment' | 'finance' | 'lab'>('all');
  const [visibleCount, setVisibleCount] = useState(50);
  const dialogRef = useAppointmentDialog(isOpen, onClose);
  useEffect(() => { setVisibleCount(50); }, [isOpen, filterType, notifications]);
  useEffect(() => {
    if (filterType !== 'all' && !notifications.some(notification => notification.type === filterType)) setFilterType('all');
  }, [filterType, notifications]);
  const unreadCount = countUnreadNotifications(notifications, readKeys);

  const filteredNotifications = notifications.filter(n => {
    if (filterType === 'all') return true;
    return n.type === filterType;
  });

  const handleMarkAllRead = () => {
    onMarkRead(notifications.map(notification => notification.readKey));
  };

  const handleItemClick = (notif: ClinicNotification) => {
    onMarkRead([notif.readKey]);
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
    <div className="clinic-modal-overlay fixed inset-0 z-50 flex items-start sm:items-center justify-center p-3 sm:p-4 bg-slate-900/40" dir="rtl"
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
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
              <p className="text-xs text-slate-500">مواعيد تحتاج متابعة، أرصدة متبقية وحالات المعمل</p>
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
              type="button" aria-pressed={filterType === 'all'}
              onClick={() => setFilterType('all')}
              className={`min-h-[44px] px-3 py-1.5 rounded-xl transition-colors cursor-pointer ${
                filterType === 'all' ? 'bg-indigo-600 text-white shadow-xs' : 'bg-slate-100 text-slate-600'
              }`}
            >
              الكل ({notifications.length})
            </button>
            <button
              type="button" aria-pressed={filterType === 'appointment'}
              onClick={() => setFilterType('appointment')}
              className={`min-h-[44px] px-3 py-1.5 rounded-xl transition-colors cursor-pointer ${
                filterType === 'appointment' ? 'bg-amber-600 text-white shadow-xs' : 'bg-slate-100 text-slate-600'
              }`}
            >
              المواعيد
            </button>
            {notifications.some(notification => notification.type === 'finance') && <button
              type="button" aria-pressed={filterType === 'finance'}
              onClick={() => setFilterType('finance')}
              className={`min-h-[44px] px-3 py-1.5 rounded-xl transition-colors cursor-pointer ${
                filterType === 'finance' ? 'bg-rose-600 text-white shadow-xs' : 'bg-slate-100 text-slate-600'
              }`}
            >
              المالية
            </button>}
            {notifications.some(notification => notification.type === 'lab') && <button
              type="button" aria-pressed={filterType === 'lab'}
              onClick={() => setFilterType('lab')}
              className={`min-h-[44px] px-3 py-1.5 rounded-xl transition-colors cursor-pointer ${
                filterType === 'lab' ? 'bg-purple-600 text-white shadow-xs' : 'bg-slate-100 text-slate-600'
              }`}
            >
              المعمل
            </button>}
          </div>

          {unreadCount > 0 && (
            <button
              type="button"
              onClick={handleMarkAllRead}
              className="min-h-[44px] px-3 text-xs font-bold text-indigo-600 hover:text-indigo-800 transition-colors shrink-0"
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
            filteredNotifications.slice(0, visibleCount).map(n => {
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
                    !readKeys.has(n.readKey) ? 'border-indigo-300' : 'opacity-85'
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
          {filteredNotifications.length > visibleCount && <button type="button" onClick={() => setVisibleCount(count => count + 50)}
            className="w-full min-h-[44px] rounded-xl bg-slate-100 px-4 py-3 text-sm font-bold text-slate-700">
            عرض المزيد ({filteredNotifications.length - visibleCount})
          </button>}
        </div>

        <div className="p-3 bg-slate-50 border-t border-slate-100 text-center text-xs text-slate-500 font-bold">
          <span role="status">{unreadCount ? `${unreadCount} تنبيه غير مقروء` : 'كل التنبيهات مقروءة'}</span>
          <p className="mt-1 font-normal">حالة القراءة لهذا الحساب في التبويب الحالي حتى إعادة التحميل.</p>
        </div>
      </div>
    </div>
  );
};
