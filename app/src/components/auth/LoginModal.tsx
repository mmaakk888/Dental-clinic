import React, { useState, useEffect, useRef } from 'react';
import { User, Lock, Eye, EyeOff, KeyRound, HelpCircle, CheckCircle2, AlertCircle, ChevronLeft } from 'lucide-react';
import { User as UserType } from '../../types';
import { canUserLoginNow } from '../../utils/accessControl';
import { ClinicLogo } from '../common/ClinicLogo';
import {usePortableRuntime} from '../../portable/runtime';
import {useAppointmentDialog} from '../appointments/useAppointmentDialog';

interface LoginModalProps {
  users: UserType[];
  clinicName: string;
  clinicLogo: string | null;
  onLogin: (user: UserType, rememberMe: boolean) => void | Promise<void>;
  onAuthenticate: (username: string, password: string) => Promise<UserType>;
  onUpdateUsers?: (users: UserType[]) => void | Promise<void>;
}

export const LoginModal: React.FC<LoginModalProps> = ({
  clinicName,
  clinicLogo,
  onLogin,
  onAuthenticate
}) => {
  const portable=usePortableRuntime();
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);

  // Forgot Password Modal State
  const [isForgotOpen, setIsForgotOpen] = useState(false);
  const recoveryRef = useAppointmentDialog(isForgotOpen, () => setIsForgotOpen(false));

  useEffect(() => {
    mountedRef.current = true;
    document.body.classList.add('modal-open');
    return () => {
      mountedRef.current = false;
      document.body.classList.remove('modal-open');
    };
  }, []);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busyRef.current) return;
    setErrorMessage('');

    if (!usernameInput.trim()) {
      setErrorMessage('يرجى كتابة اسم المستخدم أو البريد الإلكتروني');
      return;
    }

    if (!passwordInput) {
      setErrorMessage('اكتب كلمة السر؛ الدخول دون كلمة سر غير مسموح.'); return;
    }
    busyRef.current = true; setIsLoading(true);
    try {
      // Parent verifies against freshly persisted accounts and confirms any
      // legacy credential migration before a session can be created.
      const found = await onAuthenticate(usernameInput.trim(), passwordInput);
      if (!mountedRef.current) return;
      const accessDecision = canUserLoginNow(found);
      if (!accessDecision.allowed) {
        setErrorMessage(accessDecision.message || 'هذا الحساب غير متاح الآن');
        return;
      }
      await onLogin(found, rememberMe);
      if (mountedRef.current) setPasswordInput('');
    } catch (error) {
      if (mountedRef.current) setErrorMessage(error instanceof Error && error.message ? error.message : 'تعذّر تسجيل الدخول. راجع بيانات الحساب وحاول مرة أخرى.');
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setIsLoading(false);
    }
  };

  const closeForgotModal = () => setIsForgotOpen(false);


  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center min-h-screen w-full bg-[#060b18] overflow-y-auto font-['Cairo',sans-serif] select-none touch-manipulation dir-rtl p-4 sm:p-6">
      
      {/* Dynamic Ambient Background Elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {/* Deep Medical Radial Glows */}
        <div className="absolute -top-[20%] right-[15%] w-[550px] h-[550px] rounded-full bg-indigo-600/15 blur-[120px]" />
        <div className="absolute -bottom-[20%] left-[10%] w-[600px] h-[600px] rounded-full bg-amber-500/10 blur-[140px]" />
        <div className="absolute top-[40%] left-[50%] -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] rounded-full bg-sky-500/8 blur-[160px]" />
        {/* Geometric Grid Mesh Pattern */}
        <div 
          className="absolute inset-0 opacity-[0.03]" 
          style={{
            backgroundImage: `radial-gradient(rgba(255, 255, 255, 0.4) 1px, transparent 1px)`,
            backgroundSize: '28px 28px'
          }}
        />
      </div>

      {/* Main Container Layer */}
      <div aria-hidden={isForgotOpen} className="relative z-10 w-full max-w-[460px] my-auto flex flex-col items-center">
        
        {/* HERO SECTION - UNCONSTRAINED LOGO & BRANDING */}
        <div className="w-full flex flex-col items-center text-center mb-7 space-y-4">
          
          {/* Unconstrained Floating Logo (No Card, No Box, No Frame Container) */}
          <div className="relative group cursor-default mb-1">
            {/* Subtle backlight glow effect around logo */}
            <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-amber-400/20 via-indigo-500/20 to-sky-400/20 blur-2xl opacity-70 group-hover:opacity-100 transition-opacity duration-500" />
            <ClinicLogo size="xl" layout="icon-only" showText={false} variant="light" customLogoUrl={clinicLogo} className="relative" />
          </div>

          {/* Clinic Name & Enterprise Subtitle */}
          <div className="space-y-1.5 px-2">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight leading-snug drop-shadow-sm font-tajawal">
              {clinicName || 'عيادة الأسنان المتكاملة'}
            </h1>
            <div className="flex items-center justify-center gap-2">
              <span className="w-2 h-2 rounded-full bg-slate-400 inline-block" />
              <p className="text-xs sm:text-sm font-semibold text-slate-300 tracking-wide font-tajawal">
                نظام إدارة العيادة
              </p>
            </div>
          </div>
        </div>

        {/* LOGIN FORM CARD - GLASS SURFACE & HIGH-END CONTRAST */}
        <div className="w-full bg-[#0d162d]/85 backdrop-blur-2xl rounded-[32px] p-6 sm:p-8 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.7)] border border-slate-700/60 relative overflow-hidden">
          
          {/* Card Subtle Top Golden Shimmer Line */}
          <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-amber-400/60 to-transparent" />

          {/* Form Title & Security Badge */}
          <div className="flex flex-wrap items-center justify-between gap-3 mb-6 pb-4 border-b border-slate-800/80">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-amber-400/10 border border-amber-400/20 flex items-center justify-center text-amber-400">
                <Lock className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-sm sm:text-base font-bold text-white font-tajawal">تسجيل الدخول</h2>
                <p className="text-[11px] text-slate-400 font-medium">أدخل بيانات حسابك في العيادة</p>
              </div>
            </div>

            <div className="px-2.5 py-1 rounded-full bg-slate-800/90 border border-slate-700 text-[11px] font-bold text-slate-300 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
              <span>{portable?'خادم العيادة':'نسخة محلية'}</span>
            </div>
          </div>

          {/* ERROR NOTIFICATION */}
          {errorMessage && (
            <div role="alert" className="mb-5 p-3.5 bg-rose-500/10 border border-rose-500/30 text-rose-200 rounded-2xl text-xs sm:text-sm font-semibold flex items-center gap-3 animate-shake shadow-xs">
              <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
              <span className="leading-relaxed">{errorMessage}</span>
            </div>
          )}

          {/* FORM INPUTS */}
          <form onSubmit={handleLoginSubmit} className="space-y-4">
            
            {/* USERNAME FIELD */}
            <div className="space-y-1.5">
              <label htmlFor="login-username" className="block text-xs font-bold text-slate-300 pr-1 font-tajawal">
                اسم المستخدم أو البريد الإلكتروني
              </label>
              <div className="relative flex items-center group">
                <input
                  id="login-username"
                  type="text"
                  required
                  autoComplete="username"
                  value={usernameInput}
                  onChange={e => setUsernameInput(e.target.value)}
                  placeholder="اكتب اسم المستخدم أو البريد"
                  style={{ fontSize: '16px' }} // Prevents iOS auto-zoom
                  className="w-full h-13 pr-11 pl-4 bg-slate-900/80 border border-slate-700/80 rounded-2xl text-white font-semibold placeholder-slate-500 focus:bg-slate-900 focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20 focus:outline-none transition-all duration-200 text-sm sm:text-base"
                />
                <User className="w-5 h-5 text-slate-400 group-focus-within:text-amber-400 absolute right-3.5 pointer-events-none transition-colors" />
              </div>
            </div>

            {/* PASSWORD FIELD */}
            <div className="space-y-1.5">
              <label htmlFor="login-password" className="block text-xs font-bold text-slate-300 pr-1 font-tajawal">
                كلمة السر
              </label>
              <div className="relative flex items-center group">
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={passwordInput}
                  onChange={e => setPasswordInput(e.target.value)}
                  placeholder="••••••••"
                  style={{ fontSize: '16px' }} // Prevents iOS auto-zoom
                  className="w-full h-13 pr-11 pl-11 bg-slate-900/80 border border-slate-700/80 rounded-2xl text-white font-semibold placeholder-slate-500 focus:bg-slate-900 focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20 focus:outline-none transition-all duration-200 text-sm sm:text-base"
                />
                <Lock className="w-5 h-5 text-slate-400 group-focus-within:text-amber-400 absolute right-3.5 pointer-events-none transition-colors" />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute left-1.5 min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-400 hover:text-white cursor-pointer p-1 rounded-xl transition-colors"
                  aria-label={showPassword ? 'إخفاء كلمة السر' : 'إظهار كلمة السر'}
                  aria-pressed={showPassword}
                  title={showPassword ? 'إخفاء كلمة السر' : 'إظهار كلمة السر'}
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {/* REMEMBER ME & FORGOT PASSWORD */}
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold pt-1">
              
              {/* Custom Modern Styled Checkbox */}
              <label className="flex items-center gap-2.5 min-h-[44px] cursor-pointer select-none text-slate-300 hover:text-white transition-colors group">
                <div className="relative flex items-center justify-center">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={e => setRememberMe(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-5 h-5 rounded-lg border border-slate-600 peer-focus-visible:ring-2 peer-focus-visible:ring-amber-400 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-slate-900 bg-slate-900/90 peer-checked:bg-gradient-to-tr peer-checked:from-amber-500 peer-checked:to-amber-400 peer-checked:border-amber-400 transition-all shadow-inner flex items-center justify-center">
                    {rememberMe && <CheckCircle2 className="w-3.5 h-3.5 text-slate-950 font-bold" />}
                  </div>
                </div>
                <span className="font-tajawal text-xs sm:text-sm">تذكرني على هذا الجهاز</span>
              </label>

              <button
                type="button"
                onClick={() => setIsForgotOpen(true)}
                className="min-h-[44px] text-amber-400 hover:text-amber-300 hover:underline transition-colors cursor-pointer font-tajawal text-xs sm:text-sm"
              >
                نسيت كلمة السر؟
              </button>
            </div>

            {/* SUBMIT BUTTON - LUXURY ACTION BUTTON */}
            <button
              type="submit"
              disabled={isLoading}
              aria-busy={isLoading}
              aria-label={isLoading ? 'جاري تسجيل الدخول' : 'تسجيل الدخول'}
              className="w-full min-h-[52px] mt-3 disabled:opacity-60 disabled:cursor-wait bg-gradient-to-r from-amber-400 via-amber-300 to-amber-500 hover:from-amber-300 hover:to-amber-400 active:scale-[0.98] text-slate-950 font-extrabold text-sm sm:text-base rounded-2xl shadow-lg shadow-amber-500/20 hover:shadow-amber-500/35 cursor-pointer transition-all duration-200 flex items-center justify-center gap-2 relative overflow-hidden group"
            >
              {isLoading ? (
                <span className="inline-block w-5 h-5 border-2 border-slate-950/30 border-t-slate-950 rounded-full animate-spin" />
              ) : (
                <>
                  <KeyRound className="w-5 h-5 text-slate-950 group-hover:rotate-12 transition-transform duration-300" />
                  <span className="font-tajawal tracking-wide">تسجيل الدخول للنظام</span>
                  <ChevronLeft className="w-4 h-4 text-slate-950 group-hover:-translate-x-1 transition-transform" />
                </>
              )}
            </button>
          </form>

        </div>

        {/* FOOTER ENTERPRISE COPYRIGHT */}
        <p className="mt-6 text-[11px] font-semibold text-slate-500 text-center font-tajawal tracking-wide">
          نظام إدارة العيادة © {new Date().getFullYear()}
        </p>

      </div>

      {isForgotOpen && (
        <div className="clinic-modal-overlay fixed inset-0 z-60 flex items-center justify-center bg-slate-950/85 p-4" dir="rtl">
          <div ref={recoveryRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="login-recovery-title"
            onKeyDown={e => {
              if (e.key === 'Escape') { e.stopPropagation(); closeForgotModal(); return; }
              if (e.key !== 'Tab') return;
              const buttons = Array.from(recoveryRef.current?.querySelectorAll('button') || []) as HTMLButtonElement[];
              const first = buttons[0], last = buttons[buttons.length - 1];
              if (e.shiftKey && (document.activeElement === first || document.activeElement === recoveryRef.current)) { e.preventDefault(); last?.focus(); }
              else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
            }}
            className="clinic-modal-panel bg-[#0f182e] rounded-2xl max-w-sm w-full p-6 shadow-xl border border-slate-700 space-y-4 max-h-[90dvh] overflow-y-auto">
            <h3 id="login-recovery-title" className="flex items-center gap-2 text-base font-bold text-white">
              <HelpCircle className="w-5 h-5 text-amber-400" />نسيت كلمة السر؟
            </h3>
            <p className="text-sm text-slate-300 leading-relaxed">
              استعادة كلمة السر بالبريد غير مفعّلة في النسخة الحالية. يمكن لمدير العيادة تغيير كلمة سر حسابك من الإعدادات ثم المستخدمون.
            </p>
            <button type="button" onClick={closeForgotModal} className="w-full min-h-[44px] rounded-xl bg-amber-400 px-4 py-3 text-sm font-bold text-slate-950 hover:bg-amber-300">
              العودة لتسجيل الدخول
            </button>
          </div>
        </div>
      )}

    </div>
  );
};
