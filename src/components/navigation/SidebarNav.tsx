import React, { useState, useEffect } from 'react';
import { ActiveView, User as UserType, Appointment, LabCase, Patient } from '../../types';
import { 
  Home, Smartphone, Users, ContactRound, Calendar, Microscope, Landmark, Sliders,
  ChevronRight, ChevronLeft, X, Palette, Layout, MessageCircle, Pill, 
  Cloud, ShieldAlert, FileSpreadsheet, Server, LogOut, UserCheck, Sparkles, Compass
} from 'lucide-react';
import { ClinicLogo } from '../common/ClinicLogo';
import { canAccessView } from '../../utils/rbac';

interface SidebarNavProps {
  activeView: ActiveView;
  activeSubTab?: string;
  clinicName: string;
  clinicLogo: string | null;
  currentUser: UserType | null;
  appointments?: Appointment[];
  labCases?: LabCase[];
  patients?: Patient[];
  isMobileOpen: boolean;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onCloseMobile: () => void;
  onNavigate: (view: ActiveView, subTab?: string) => void;
  onLogout: () => void;
}

export const SidebarNav: React.FC<SidebarNavProps> = React.memo(({
  activeView,
  activeSubTab = 'identity',
  clinicName,
  clinicLogo,
  currentUser,
  appointments = [],
  labCases = [],
  patients = [],
  isMobileOpen,
  isCollapsed,
  onToggleCollapse,
  onCloseMobile,
  onNavigate,
  onLogout
}) => {
  // Badges calculations
  const { todayApptsCount, pendingLabCount } = React.useMemo(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    return {
      todayApptsCount: appointments.filter(a => a.date === todayStr).length,
      pendingLabCount: labCases.filter(l => l.status === 'pending').length
    };
  }, [appointments, labCases]);

  // Navigation Items Definition
  const mainNavItems = [
    { 
      key: 'home' as ActiveView, 
      label: 'الرئيسية', 
      desc: 'لوحة القيادة الرئيسية',
      icon: <Home className="w-5 h-5" />, 
      allowed: canAccessView(currentUser, 'home')
    },
    { 
      key: 'patients' as ActiveView, 
      label: 'فهرس المرضى', 
      desc: 'السجلات الطبية والشخصية',
      icon: <Users className="w-5 h-5 text-sky-400" />, 
      allowed: canAccessView(currentUser, 'patients')
    },
    {
      key: 'contacts' as ActiveView,
      label: 'جهات الاتصال',
      desc: 'أسماء وأرقام بدون ملفات مرضى',
      icon: <ContactRound className="w-5 h-5 text-emerald-400" />,
      allowed: canAccessView(currentUser, 'contacts')
    },
    {
      key: 'appointments' as ActiveView,
      label: 'المواعيد والحجوزات', 
      desc: 'جدول العيادة اليومي والشهري',
      icon: <Calendar className="w-5 h-5 text-amber-400" />, 
      badge: todayApptsCount,
      allowed: canAccessView(currentUser, 'appointments')
    },
    { 
      key: 'lab' as ActiveView, 
      label: 'التركيبات', 
      desc: 'تتبع حالات ومستحقات التركيبات',
      icon: <Microscope className="w-5 h-5 text-teal-400" />, 
      badge: pendingLabCount,
      allowed: canAccessView(currentUser, 'lab')
    },
    { 
      key: 'summary' as ActiveView, 
      label: 'المالية والتقارير', 
      desc: 'سجل المصروفات والإيرادات',
      icon: <Landmark className="w-5 h-5 text-indigo-400" />, 
      allowed: canAccessView(currentUser, 'summary')
    },
    { 
      key: 'settings' as ActiveView, 
      label: 'لوحة التحكم والإعدادات', 
      desc: 'ضبط الهوية، الأسعار والنسخ',
      icon: <Sliders className="w-5 h-5 text-purple-400" />, 
      allowed: canAccessView(currentUser, 'settings')
    },
  ].filter(item => item.allowed);

  // Settings Sub-Tabs
  const settingsSubTabs = [
    { key: 'identity', label: 'الهوية والمظهر', icon: <Palette className="w-4 h-4 text-amber-400" /> },
    { key: 'layout', label: 'المحتوى والترتيب', icon: <Layout className="w-4 h-4 text-sky-400" /> },
    { key: 'services', label: 'الخدمات والأسعار', icon: <Sliders className="w-4 h-4 text-emerald-400" /> },
    { key: 'whatsapp', label: 'إدارة واتساب', icon: <MessageCircle className="w-4 h-4 text-green-400" /> },
    { key: 'drugs', label: 'فهرس الأدوية', icon: <Pill className="w-4 h-4 text-purple-400" /> },
    { key: 'backup', label: 'النسخ الاحتياطي', icon: <Cloud className="w-4 h-4 text-blue-400" /> },
    { key: 'users', label: 'المستخدمين والصلاحيات', icon: <Users className="w-4 h-4 text-amber-300" /> },
    { key: 'audit', label: 'سجل النشاطات', icon: <ShieldAlert className="w-4 h-4 text-rose-400" /> },
    { key: 'excel', label: 'تصدير واستيراد Excel', icon: <FileSpreadsheet className="w-4 h-4 text-teal-300" /> },
    { key: 'system', label: 'عرض النظام', icon: <Server className="w-4 h-4 text-indigo-300" /> },
  ];

  useEffect(() => {
    if (isMobileOpen) {
      document.body.classList.add('modal-open');
    } else {
      document.body.classList.remove('modal-open');
    }
    return () => {
      document.body.classList.remove('modal-open');
    };
  }, [isMobileOpen]);

  const handleNavClick = (view: ActiveView, subTab?: string) => {
    onNavigate(view, subTab);
    onCloseMobile();
  };

  const sidebarContent = (
    <div className="flex flex-col h-full font-['Cairo',sans-serif] text-slate-100 select-none">
      {/* 1. Header & Clinic Brand */}
      <div className={`p-4 border-b border-slate-800/80 flex items-center ${isCollapsed ? 'justify-center' : 'justify-between'} gap-3 transition-all duration-300`}>
        <div 
          onClick={() => handleNavClick('home')}
          className="flex items-center gap-3 cursor-pointer group shrink-0"
          title="الصفحة الرئيسية للعيادة"
        >
          <ClinicLogo
            size="header"
            showText={false}
            customLogoUrl={clinicLogo}
          />
          {!isCollapsed && (
            <div className="animate-fadeIn overflow-hidden">
              <h2 className="font-bold text-sm text-white font-tajawal truncate leading-tight group-hover:text-amber-300 transition-colors">
                {clinicName || 'عيادة الأسنان الرقمية'}
              </h2>
              <span className="text-[10px] text-emerald-400 font-medium flex items-center gap-1 mt-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                نظام إدارة متكامل
              </span>
            </div>
          )}
        </div>

        {/* Mobile Close Button */}
        <button
          type="button"
          onClick={onCloseMobile}
          className="lg:hidden p-1.5 rounded-xl bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* 2. Main Scrollable Navigation Menu */}
      <div className="flex-1 overflow-y-auto px-2.5 py-4 space-y-6 scrollbar-thin scrollbar-thumb-slate-700">
        {/* Main Section Group */}
        <div>
          {!isCollapsed && (
            <div className="px-3 mb-2 flex items-center justify-between text-[11px] font-bold text-slate-400 uppercase tracking-wider font-tajawal">
              <span>القائمة الرئيسية</span>
              <Compass className="w-3.5 h-3.5 text-slate-500" />
            </div>
          )}

          <nav className="space-y-1.5">
            {mainNavItems.map(item => {
              const isActive = activeView === item.key || (activeView === 'patient-file' && item.key === 'patients');

              return (
                <div key={item.key} className="relative group">
                  <button
                    type="button"
                    onClick={() => handleNavClick(item.key)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl text-xs font-extrabold transition-all duration-200 cursor-pointer text-right ${
                      isActive
                        ? 'bg-gradient-to-r from-amber-500/20 via-indigo-600/30 to-indigo-600/10 text-white border-r-4 border-amber-400 shadow-md shadow-amber-500/10 ring-1 ring-amber-400/30 font-bold'
                        : 'text-slate-300 hover:text-white hover:bg-slate-800/70 hover:translate-x-[-2px]'
                    } ${isCollapsed ? 'justify-center px-0' : ''}`}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <span className={`transition-transform duration-200 ${isActive ? 'scale-110 text-amber-400' : 'group-hover:scale-105'}`}>
                      {item.icon}
                    </span>

                    {!isCollapsed && (
                      <div className="flex-1 min-w-0">
                        <span className="block truncate font-tajawal text-xs">{item.label}</span>
                        <span className="block truncate text-[10px] text-slate-400 font-normal mt-0.5">{item.desc}</span>
                      </div>
                    )}

                    {/* Badge Pill */}
                    {item.badge && item.badge > 0 ? (
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-black font-mono shadow-2xs ${
                        isActive ? 'bg-amber-400 text-slate-950' : 'bg-rose-500/80 text-white'
                      }`}>
                        {item.badge}
                      </span>
                    ) : null}
                  </button>

                  {/* Collapsed Tooltip */}
                  {isCollapsed && (
                    <div className="hidden lg:block opacity-0 group-hover:opacity-100 pointer-events-none absolute right-full top-1/2 -translate-y-1/2 mr-3 px-3 py-1.5 bg-slate-950 text-white text-xs font-bold font-tajawal rounded-xl shadow-xl whitespace-nowrap z-50 border border-slate-700 transition-opacity duration-200">
                      {item.label}
                      <div className="absolute left-full top-1/2 -translate-y-1/2 border-4 border-transparent border-l-slate-950" />
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
        </div>

        {/* Control Panel Sub-sections (shown if inside settings view) */}
        {activeView === 'settings' && !isCollapsed && (
          <div className="pt-3 border-t border-slate-800/80 space-y-2 animate-fadeIn">
            <div className="px-3 flex items-center justify-between text-[11px] font-bold text-amber-400 font-tajawal">
              <span>أقسام لوحة التحكم والتخصيص</span>
              <Sliders className="w-3.5 h-3.5" />
            </div>

            <div className="space-y-1 pr-1">
              {settingsSubTabs.map(sub => {
                const isSubActive = activeSubTab === sub.key;

                return (
                  <button
                    key={sub.key}
                    type="button"
                    onClick={() => handleNavClick('settings', sub.key)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs transition-all cursor-pointer text-right ${
                      isSubActive
                        ? 'bg-amber-400/20 text-amber-300 font-black border-r-2 border-amber-400 pr-2.5'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                    }`}
                  >
                    <span>{sub.icon}</span>
                    <span className="truncate font-tajawal">{sub.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* 3. Footer User Profile & Collapse Toggle */}
      <div className="p-3 border-t border-slate-800/80 bg-slate-950/60 space-y-2">
        {currentUser && !isCollapsed && (
          <div className="flex items-center justify-between p-2 rounded-2xl bg-slate-900 border border-slate-800 text-xs">
            <div className="flex items-center gap-2 overflow-hidden">
              <div className="w-8 h-8 rounded-xl bg-indigo-600/80 text-white flex items-center justify-center font-bold text-xs shrink-0">
                <UserCheck className="w-4 h-4 text-amber-300" />
              </div>
              <div className="min-w-0">
                <span className="font-bold text-white block truncate text-xs">{currentUser.name}</span>
                <span className="text-[10px] text-amber-400 block font-mono">
                  {currentUser.role === 'doctor' ? '👨‍⚕️ طبيب' : currentUser.role === 'admin' ? '🛡️ مدير' : '👩‍💼 استقبال'}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={onLogout}
              className="p-1.5 rounded-xl hover:bg-rose-900/40 text-slate-400 hover:text-rose-300 cursor-pointer transition-colors"
              title="تسجيل الخروج"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Desktop Collapse Toggle Button */}
        <button
          type="button"
          onClick={onToggleCollapse}
          className="hidden lg:flex w-full items-center justify-center gap-2 py-2 px-3 rounded-xl bg-slate-800/80 hover:bg-slate-800 text-slate-300 hover:text-white text-xs font-bold transition-colors cursor-pointer border border-slate-700/60"
          title={isCollapsed ? 'توسيع القائمة الجانبية' : 'تصغير القائمة الجانبية'}
        >
          {isCollapsed ? (
            <ChevronLeft className="w-4 h-4 text-amber-400 animate-pulse" />
          ) : (
            <>
              <ChevronRight className="w-4 h-4 text-amber-400" />
              <span className="font-tajawal text-xs">طـي القائمـة الجانبيـة</span>
            </>
          )}
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sticky Right Sidebar */}
      <aside 
        className={`hidden lg:block fixed top-0 right-0 h-screen z-40 bg-slate-900/95 backdrop-blur-md border-l border-slate-800 shadow-2xl transition-all duration-300 ease-in-out ${
          isCollapsed ? 'w-20' : 'w-72'
        }`}
      >
        {sidebarContent}
      </aside>

      {/* Mobile Slide-in Drawer with Backdrop Blur */}
      {isMobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div 
            className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs transition-opacity animate-fadeIn"
            onClick={onCloseMobile}
          />

          {/* Drawer Body (Right to Left Slide) */}
          <div className="relative w-72 max-w-[85vw] bg-slate-900 h-full shadow-2xl flex flex-col z-10 border-l border-slate-800 animate-slideLeft">
            {sidebarContent}
          </div>
        </div>
      )}
    </>
  );
});

SidebarNav.displayName = 'SidebarNav';
