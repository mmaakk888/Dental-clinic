import React from 'react';
import { Lock } from 'lucide-react';
import { ClinicLogo } from '../common/ClinicLogo';

/** Cloud presentation based on the original local login design.
 * Authentication, form state and recovery stay with the owning runtime. */
export function ClinicLoginFrame({ clinicName, clinicLogo, badge, hidden, children }: {
  clinicName: string; clinicLogo?: string | null; badge: string; hidden?: boolean; children: React.ReactNode;
}) {
  return <div dir="rtl" className="clinic-login-frame min-h-dvh w-full bg-[#060b18] overflow-y-auto font-['Cairo',sans-serif] p-4 sm:p-6 flex items-center justify-center relative"
    style={{ backgroundImage: 'radial-gradient(ellipse at 70% 10%, #312e8140, transparent 60%), radial-gradient(ellipse at 20% 90%, #d9770612, transparent 55%)' }}>
    <div aria-hidden={hidden} className="relative z-10 w-full max-w-[460px] my-auto flex flex-col items-center">
      <div className="w-full flex flex-col items-center text-center mb-7 space-y-4">
        <ClinicLogo size="xl" layout="icon-only" showText={false} variant="light" customLogoUrl={clinicLogo} />
        <div className="space-y-1.5 px-2"><h1 className="text-2xl sm:text-3xl font-extrabold text-white leading-snug font-tajawal">{clinicName || 'إدارة عيادة الأسنان'}</h1>
          <p className="text-xs sm:text-sm font-semibold text-slate-300 font-tajawal">نظام إدارة العيادة</p></div>
      </div>
      <section className="w-full bg-[#0d162d]/85 rounded-[32px] p-6 sm:p-8 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.7)] border border-slate-700/60 relative overflow-hidden">
        <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-amber-400/60 to-transparent" />
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6 pb-4 border-b border-slate-800/80">
          <div className="flex items-center gap-2.5"><span className="w-9 h-9 rounded-xl bg-amber-400/10 border border-amber-400/20 grid place-items-center text-amber-400"><Lock className="w-5 h-5" aria-hidden="true" /></span>
            <div><h2 className="text-sm sm:text-base font-bold text-white font-tajawal">تسجيل الدخول</h2><p className="text-[11px] text-slate-400">أدخل بيانات حسابك في العيادة</p></div></div>
          <span className="px-2.5 py-1 rounded-full bg-slate-800/90 border border-slate-700 text-[11px] font-bold text-slate-300">{badge}</span>
        </div>
        {children}
      </section>
      <p className="mt-6 text-[11px] font-semibold text-slate-500 text-center font-tajawal">نظام إدارة العيادة © {new Date().getFullYear()}</p>
    </div>
  </div>;
}
