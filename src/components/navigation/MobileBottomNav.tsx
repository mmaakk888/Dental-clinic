import React, { useState, useMemo } from 'react';
import { ActiveView, User as UserType, Appointment, LabCase, UILabels } from '../../types';
import { 
  Home, Users, Calendar, Landmark, MoreHorizontal, Smartphone, 
  Microscope, Sliders, X, ChevronLeft, CreditCard 
} from 'lucide-react';

interface MobileBottomNavProps {
  activeView: ActiveView;
  labels: UILabels;
  currentUser: UserType | null;
  appointments?: Appointment[];
  labCases?: LabCase[];
  onNavigate: (view: ActiveView) => void;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = React.memo(({
  activeView,
  labels,
  currentUser,
  appointments = [],
  labCases = [],
  onNavigate,
}) => {
  const [isMoreOpen, setIsMoreOpen] = useState(false);

  const { todayApptsCount, pendingLabCount } = useMemo(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    return {
      todayApptsCount: appointments.filter(a => a.date === todayStr).length,
      pendingLabCount: labCases.filter(l => l.status === 'pending').length,
    };
  }, [appointments, labCases]);

  const main5Items = useMemo(() => {
    const isReceptionist = currentUser?.role === 'secretary' || currentUser?.role === 'receptionist';

    const homeItem = {
      key: 'home' as ActiveView,
      label: labels.tabs.home || 'الرئيسية',
      icon: <Home className="w-5.5 h-5.5 shrink-0" />,
      allowed: true,
    };

    const patientsItem = {
      key: 'patients' as ActiveView,
      label: labels.tiles.patients?.title || 'المرضى',
      icon: <Users className="w-5.5 h-5.5 shrink-0" />,
      allowed: currentUser ? currentUser.permissions.patientView : true,
    };

    const apptsItem = {
      key: 'appointments' as ActiveView,
      label: labels.tiles.appointments?.title || 'المواعيد',
      icon: <Calendar className="w-5.5 h-5.5 shrink-0" />,
      badge: todayApptsCount,
      allowed: currentUser ? currentUser.permissions.appointments : true,
    };

    const collectionsItem = {
      key: 'secretary-desk' as ActiveView,
      label: labels.tabs['secretary-desk'] || 'التحصيل',
      icon: <CreditCard className="w-5.5 h-5.5 shrink-0 text-emerald-600" />,
      allowed: true,
    };

    const financeItem = {
      key: 'summary' as ActiveView,
      label: labels.tiles.summary?.title || 'المالية',
      icon: <Landmark className="w-5.5 h-5.5 shrink-0 text-indigo-600" />,
      allowed: currentUser ? currentUser.permissions.summary : true,
    };

    const moreItem = {
      key: 'more' as any,
      label: 'المزيد',
      icon: <MoreHorizontal className="w-5.5 h-5.5 shrink-0" />,
      allowed: true,
      badge: pendingLabCount,
    };

    // Secretary Bottom Nav: Home -> Patients -> Appointments -> Collections -> More
    // Doctor Bottom Nav: Home -> Patients -> Appointments -> Finance -> More
    const rawItems = isReceptionist
      ? [homeItem, patientsItem, apptsItem, collectionsItem, moreItem]
      : [homeItem, patientsItem, apptsItem, financeItem, moreItem];

    return rawItems.filter(i => i.allowed);
  }, [currentUser, todayApptsCount, pendingLabCount, labels]);

  const extraNavItems = useMemo(() => {
    return [
      {
        key: 'secretary-desk' as ActiveView,
        label: labels.tabs['secretary-desk'] || 'مكتب الاستقبال والتحصيل',
        desc: 'إدارة المرضى والحجوزات السريعة',
        icon: <Smartphone className="w-5.5 h-5.5 text-emerald-600" />,
        allowed: true,
      },
      {
        key: 'lab' as ActiveView,
        label: labels.tiles.lab?.title || 'التركيبات',
        desc: 'متابعة طلبات وتكاليف التركيبات',
        icon: <Microscope className="w-5.5 h-5.5 text-purple-600" />,
        badge: pendingLabCount,
        allowed: currentUser ? currentUser.permissions.lab : true,
      },
      {
        key: 'settings' as ActiveView,
        label: labels.tiles.settings?.title || 'إعدادات النظام والتحكم',
        desc: 'ضبط الأسعار، الأطباء والنسخ',
        icon: <Sliders className="w-5.5 h-5.5 text-slate-600" />,
        allowed: currentUser ? currentUser.permissions.controlPanel : true,
      },
    ].filter(i => i.allowed);
  }, [currentUser, pendingLabCount, labels]);

  const handleSelectTab = (key: string) => {
    if (key === 'more') {
      setIsMoreOpen(true);
    } else {
      setIsMoreOpen(false);
      onNavigate(key as ActiveView);
    }
  };

  const handleExtraSelect = (view: ActiveView) => {
    setIsMoreOpen(false);
    onNavigate(view);
  };

  return (
    <>
      {/* 5-ITEM THUMB-FRIENDLY BOTTOM BAR */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-lg border-t border-slate-200/90 shadow-lg px-2 h-17 flex items-center justify-between font-['Cairo',sans-serif] select-none touch-manipulation dir-rtl">
        {main5Items.map(item => {
          const isMoreActive = item.key === 'more' && ['secretary-desk', 'lab', 'settings'].includes(activeView);
          const isActive = activeView === item.key || (activeView === 'patient-file' && item.key === 'patients') || isMoreActive;

          return (
            <button
              key={item.key}
              type="button"
              onClick={() => handleSelectTab(item.key)}
              className="flex-1 h-full min-h-[52px] flex flex-col items-center justify-center py-1 px-1 transition-all cursor-pointer relative touch-manipulation active:scale-95 text-center group"
            >
              {/* Material 3 Active Indicator Pill */}
              <div
                className={`relative flex items-center justify-center px-4 py-1 rounded-full transition-all duration-200 ${
                  isActive
                    ? 'bg-indigo-100 text-indigo-700 shadow-2xs font-bold scale-105'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                <span className={`transition-transform duration-200 ${isActive ? 'scale-110' : ''}`}>
                  {item.icon}
                </span>

                {item.badge && item.badge > 0 ? (
                  <span className="absolute -top-1 -right-1.5 px-1.5 min-w-[18px] h-4.5 rounded-full bg-rose-600 text-white text-[10px] font-black flex items-center justify-center shadow-2xs border border-white">
                    {item.badge > 9 ? '9+' : item.badge}
                  </span>
                ) : null}
              </div>

              {/* Label */}
              <span
                className={`text-[11px] mt-0.5 truncate w-full text-center font-tajawal transition-colors ${
                  isActive ? 'font-black text-indigo-700' : 'font-semibold text-slate-500'
                }`}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </nav>

      {/* MORE MODULES BOTTOM SHEET MODAL */}
      {isMoreOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex flex-col justify-end font-['Cairo',sans-serif] dir-rtl">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs transition-opacity animate-fadeIn"
            onClick={() => setIsMoreOpen(false)}
          />

          {/* Sheet Drawer */}
          <div className="relative w-full bg-white rounded-t-3xl border-t border-slate-200 p-5 shadow-2xl z-10 animate-slideUp space-y-4 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center font-black">
                  <MoreHorizontal className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900 font-tajawal">الأقسام والخدمات الإضافية</h3>
                  <p className="text-[11px] text-slate-500 font-medium">وصول سريع لكافة وحدات العيادة</p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsMoreOpen(false)}
                className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2">
              {extraNavItems.map(extra => (
                <button
                  key={extra.key}
                  type="button"
                  onClick={() => handleExtraSelect(extra.key)}
                  className={`w-full p-3.5 rounded-2xl border transition-all cursor-pointer flex items-center justify-between text-right active:scale-98 ${
                    activeView === extra.key
                      ? 'bg-indigo-50 border-indigo-200 shadow-2xs'
                      : 'bg-slate-50 hover:bg-slate-100 border-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 shadow-2xs flex items-center justify-center shrink-0">
                      {extra.icon}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-black text-slate-900 font-tajawal truncate">{extra.label}</span>
                        {extra.badge && extra.badge > 0 ? (
                          <span className="px-1.5 py-0.5 rounded-full bg-rose-500 text-white text-[10px] font-black">
                            {extra.badge}
                          </span>
                        ) : null}
                      </div>
                      <p className="text-[11px] text-slate-500 truncate font-medium mt-0.5">{extra.desc}</p>
                    </div>
                  </div>

                  <ChevronLeft className="w-4 h-4 text-slate-400 shrink-0" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
});

MobileBottomNav.displayName = 'MobileBottomNav';


