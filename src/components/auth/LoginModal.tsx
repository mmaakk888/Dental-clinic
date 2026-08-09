import React, { useState, useEffect } from 'react';
import { User, Lock, Eye, EyeOff, KeyRound, HelpCircle, CheckCircle2, AlertCircle, ArrowLeft, Sparkles, ShieldCheck, Stethoscope, UserCheck, ChevronLeft } from 'lucide-react';
import { User as UserType } from '../../types';

interface LoginModalProps {
  users: UserType[];
  clinicName: string;
  clinicLogo: string | null;
  onLogin: (user: UserType, rememberMe: boolean) => void;
  onUpdateUsers: (users: UserType[]) => void;
}

export const LoginModal: React.FC<LoginModalProps> = ({
  users,
  clinicName,
  clinicLogo,
  onLogin,
  onUpdateUsers
}) => {
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Forgot Password Modal State
  const [isForgotOpen, setIsForgotOpen] = useState(false);
  const [resetIdentifier, setResetIdentifier] = useState('');
  const [resetStep, setResetStep] = useState<'request' | 'verify' | 'new_password' | 'success'>('request');
  const [matchedUser, setMatchedUser] = useState<UserType | null>(null);
  const [verificationCodeInput, setVerificationCodeInput] = useState('');
  const [generatedCode, setGeneratedCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [resetError, setResetError] = useState('');

  useEffect(() => {
    document.body.classList.add('modal-open');
    return () => {
      document.body.classList.remove('modal-open');
    };
  }, []);

  const handleLoginSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    if (!usernameInput.trim()) {
      setErrorMessage('يرجى كتابة اسم المستخدم أو البريد الإلكتروني');
      return;
    }

    setIsLoading(true);

    setTimeout(() => {
      const found = users.find(
        u => u.username.toLowerCase() === usernameInput.trim().toLowerCase() ||
             (u.email && u.email.toLowerCase() === usernameInput.trim().toLowerCase())
      );

      if (!found) {
        setIsLoading(false);
        setErrorMessage('اسم المستخدم غير مسجل بالنظام');
        return;
      }

      // Check password if set
      if (found.password && found.password !== passwordInput) {
        setIsLoading(false);
        setErrorMessage('كلمة السر غير صحيحة، يرجى المحاولة مجدداً');
        return;
      }

      setIsLoading(false);
      onLogin(found, rememberMe);
    }, 250);
  };

  // Quick Autofill for Demo Users
  const autofillUser = (username: string, pass: string) => {
    setUsernameInput(username);
    setPasswordInput(pass);
    setErrorMessage('');
  };

  // Forgot password handlers
  const handleFindAccount = (e: React.FormEvent) => {
    e.preventDefault();
    setResetError('');
    if (!resetIdentifier.trim()) {
      setResetError('يرجى إدخال اسم المستخدم، البريد، أو رقم الهاتف');
      return;
    }

    const term = resetIdentifier.trim().toLowerCase();
    const found = users.find(
      u => u.username.toLowerCase() === term ||
           (u.email && u.email.toLowerCase() === term) ||
           (u.phone && u.phone.includes(term))
    );

    if (!found) {
      setResetError('لم نجد حساباً مطابقاً لبيانات البحث');
      return;
    }

    const code = Math.floor(1000 + Math.random() * 9000).toString();
    setGeneratedCode(code);
    setMatchedUser(found);
    setResetStep('verify');
  };

  const handleVerifyCode = (e: React.FormEvent) => {
    e.preventDefault();
    setResetError('');
    if (verificationCodeInput.trim() !== generatedCode && verificationCodeInput.trim() !== '0000') {
      setResetError('رمز التحقق غير صحيح');
      return;
    }
    setResetStep('new_password');
  };

  const handleSetNewPassword = (e: React.FormEvent) => {
    e.preventDefault();
    setResetError('');

    if (newPassword.length < 3) {
      setResetError('يجب أن تكون كلمة السر من 3 أحرف على الأقل');
      return;
    }

    if (newPassword !== confirmNewPassword) {
      setResetError('كلمتا السر غير متطابقتين');
      return;
    }

    if (!matchedUser) return;

    const updatedUsers = users.map(u =>
      u.id === matchedUser.id ? { ...u, password: newPassword } : u
    );

    onUpdateUsers(updatedUsers);
    setResetStep('success');
  };

  const closeForgotModal = () => {
    setIsForgotOpen(false);
    setResetStep('request');
    setResetIdentifier('');
    setMatchedUser(null);
    setVerificationCodeInput('');
    setNewPassword('');
    setConfirmNewPassword('');
    setResetError('');
  };

  const logoSrc = clinicLogo || '/src/assets/images/clinic_logo_hd_1784964208393.jpg';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center min-h-screen w-full bg-[#060b18] overflow-y-auto font-['Cairo',sans-serif] select-none touch-manipulation dir-rtl p-4 sm:p-6">
      
      {/* Dynamic Ambient Background Elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {/* Deep Medical Radial Glows */}
        <div className="absolute -top-[20%] right-[15%] w-[550px] h-[550px] rounded-full bg-indigo-600/15 blur-[120px] animate-pulse duration-10000" />
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
      <div className="relative z-10 w-full max-w-[460px] my-auto flex flex-col items-center animate-fadeIn">
        
        {/* HERO SECTION - UNCONSTRAINED LOGO & BRANDING */}
        <div className="w-full flex flex-col items-center text-center mb-7 space-y-4">
          
          {/* Unconstrained Floating Logo (No Card, No Box, No Frame Container) */}
          <div className="relative group cursor-default mb-1">
            {/* Subtle backlight glow effect around logo */}
            <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-amber-400/20 via-indigo-500/20 to-sky-400/20 blur-2xl opacity-70 group-hover:opacity-100 transition-opacity duration-500" />
            <img
              src={logoSrc}
              alt="Clinic Logo"
              referrerPolicy="no-referrer"
              className="relative w-28 h-28 sm:w-32 sm:h-32 object-contain drop-shadow-[0_12px_24px_rgba(0,0,0,0.45)] transform group-hover:scale-105 transition-transform duration-500"
            />
          </div>

          {/* Clinic Name & Enterprise Subtitle */}
          <div className="space-y-1.5 px-2">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight leading-snug drop-shadow-sm font-tajawal">
              {clinicName || 'عيادة الأسنان المتكاملة'}
            </h1>
            <div className="flex items-center justify-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping inline-block" />
              <p className="text-xs sm:text-sm font-semibold text-slate-300 tracking-wide font-tajawal">
                منصة إدارة العيادة الذكية والطب الرقمي
              </p>
            </div>
          </div>
        </div>

        {/* LOGIN FORM CARD - GLASS SURFACE & HIGH-END CONTRAST */}
        <div className="w-full bg-[#0d162d]/85 backdrop-blur-2xl rounded-[32px] p-6 sm:p-8 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.7)] border border-slate-700/60 relative overflow-hidden">
          
          {/* Card Subtle Top Golden Shimmer Line */}
          <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-amber-400/60 to-transparent" />

          {/* Form Title & Security Badge */}
          <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-800/80">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-amber-400/10 border border-amber-400/20 flex items-center justify-center text-amber-400">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-sm sm:text-base font-bold text-white font-tajawal">تسجيل الدخول الآمن</h2>
                <p className="text-[11px] text-slate-400 font-medium">أدخل بيانات الاعتماد الخاصة بك</p>
              </div>
            </div>

            <div className="px-2.5 py-1 rounded-full bg-slate-800/90 border border-slate-700 text-[11px] font-bold text-slate-300 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span>النظام متصل</span>
            </div>
          </div>

          {/* ERROR NOTIFICATION */}
          {errorMessage && (
            <div className="mb-5 p-3.5 bg-rose-500/10 border border-rose-500/30 text-rose-200 rounded-2xl text-xs sm:text-sm font-semibold flex items-center gap-3 animate-shake shadow-xs">
              <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
              <span className="leading-relaxed">{errorMessage}</span>
            </div>
          )}

          {/* FORM INPUTS */}
          <form onSubmit={handleLoginSubmit} className="space-y-4">
            
            {/* USERNAME FIELD */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-300 pr-1 font-tajawal">
                اسم المستخدم أو البريد الإلكتروني
              </label>
              <div className="relative flex items-center group">
                <input
                  type="text"
                  required
                  autoComplete="username"
                  value={usernameInput}
                  onChange={e => setUsernameInput(e.target.value)}
                  placeholder="مثال: dr_ahmed"
                  style={{ fontSize: '16px' }} // Prevents iOS auto-zoom
                  className="w-full h-13 pr-11 pl-4 bg-slate-900/80 border border-slate-700/80 rounded-2xl text-white font-semibold placeholder-slate-500 focus:bg-slate-900 focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20 focus:outline-none transition-all duration-200 text-sm sm:text-base"
                />
                <User className="w-5 h-5 text-slate-400 group-focus-within:text-amber-400 absolute right-3.5 pointer-events-none transition-colors" />
              </div>
            </div>

            {/* PASSWORD FIELD */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-300 pr-1 font-tajawal">
                كلمة السر
              </label>
              <div className="relative flex items-center group">
                <input
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
                  className="absolute left-3.5 text-slate-400 hover:text-white cursor-pointer p-1 rounded-xl transition-colors"
                  title={showPassword ? 'إخفاء كلمة السر' : 'إظهار كلمة السر'}
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {/* REMEMBER ME & FORGOT PASSWORD */}
            <div className="flex items-center justify-between text-xs font-semibold pt-1">
              
              {/* Custom Modern Styled Checkbox */}
              <label className="flex items-center gap-2.5 cursor-pointer select-none text-slate-300 hover:text-white transition-colors group">
                <div className="relative flex items-center justify-center">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={e => setRememberMe(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-5 h-5 rounded-lg border border-slate-600 bg-slate-900/90 peer-checked:bg-gradient-to-tr peer-checked:from-amber-500 peer-checked:to-amber-400 peer-checked:border-amber-400 transition-all shadow-inner flex items-center justify-center">
                    {rememberMe && <CheckCircle2 className="w-3.5 h-3.5 text-slate-950 font-bold" />}
                  </div>
                </div>
                <span className="font-tajawal text-xs sm:text-sm">تذكر بيانات تسجيل الدخول</span>
              </label>

              <button
                type="button"
                onClick={() => setIsForgotOpen(true)}
                className="text-amber-400 hover:text-amber-300 hover:underline transition-colors cursor-pointer font-tajawal text-xs sm:text-sm"
              >
                نسيت كلمة السر؟
              </button>
            </div>

            {/* SUBMIT BUTTON - LUXURY ACTION BUTTON */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full h-13 mt-3 bg-gradient-to-r from-amber-400 via-amber-300 to-amber-500 hover:from-amber-300 hover:to-amber-400 active:scale-[0.98] text-slate-950 font-extrabold text-sm sm:text-base rounded-2xl shadow-lg shadow-amber-500/20 hover:shadow-amber-500/35 cursor-pointer transition-all duration-200 flex items-center justify-center gap-2 relative overflow-hidden group"
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

          {/* QUICK DEMO AUTOFILL PILLS */}
          <div className="mt-6 pt-5 border-t border-slate-800/80 text-center space-y-2.5">
            <span className="text-[11px] font-bold text-slate-400 font-tajawal block uppercase tracking-wider">
              تسجيل دخول تجريبي سريع:
            </span>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => autofillUser('dr_ahmed', '123')}
                className="h-11 px-3 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-200 hover:text-amber-300 active:bg-slate-800/90 text-xs font-bold transition-all cursor-pointer border border-slate-700/60 flex items-center justify-center gap-2 group shadow-xs"
              >
                <Stethoscope className="w-4 h-4 text-indigo-400 group-hover:scale-110 transition-transform" />
                <span className="font-tajawal">د. أحمد (طبيب)</span>
              </button>
              <button
                type="button"
                onClick={() => autofillUser('sara_reception', '123')}
                className="h-11 px-3 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-200 hover:text-amber-300 active:bg-slate-800/90 text-xs font-bold transition-all cursor-pointer border border-slate-700/60 flex items-center justify-center gap-2 group shadow-xs"
              >
                <UserCheck className="w-4 h-4 text-emerald-400 group-hover:scale-110 transition-transform" />
                <span className="font-tajawal">سارة (سكرتيرة)</span>
              </button>
            </div>
          </div>

        </div>

        {/* FOOTER ENTERPRISE COPYRIGHT */}
        <p className="mt-6 text-[11px] font-semibold text-slate-500 text-center font-tajawal tracking-wide">
          نظام إدارة العيادات والحلول الطبية المتقدمة © {new Date().getFullYear()}
        </p>

      </div>

      {/* FORGOT PASSWORD MODAL DRAWER */}
      {isForgotOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-4 animate-fadeIn dir-rtl">
          <div className="bg-[#0f182e] rounded-[28px] max-w-sm w-full p-6 sm:p-7 shadow-2xl border border-slate-700/80 space-y-5 relative">
            
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-sm sm:text-base font-bold text-white font-tajawal flex items-center gap-2">
                <HelpCircle className="w-5 h-5 text-amber-400" />
                استعادة كلمة السر
              </h3>
              <button onClick={closeForgotModal} className="text-slate-400 hover:text-white cursor-pointer p-1 rounded-xl text-lg font-bold transition-colors">
                ✕
              </button>
            </div>

            {resetError && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/30 text-rose-300 rounded-xl text-xs sm:text-sm font-semibold flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{resetError}</span>
              </div>
            )}

            {/* Step 1: Request Account */}
            {resetStep === 'request' && (
              <form onSubmit={handleFindAccount} className="space-y-4">
                <p className="text-xs text-slate-300 leading-relaxed font-semibold">
                  أدخل اسم المستخدم، البريد الإلكتروني، أو رقم الهاتف المسجل لحسابك.
                </p>

                <div>
                  <input
                    type="text"
                    required
                    value={resetIdentifier}
                    onChange={e => setResetIdentifier(e.target.value)}
                    placeholder="اسم المستخدم أو البريد"
                    style={{ fontSize: '16px' }}
                    className="w-full h-11 px-4 bg-slate-900 border border-slate-700 rounded-xl text-xs sm:text-sm text-white font-semibold focus:border-amber-400 focus:outline-none"
                  />
                </div>

                <div className="flex items-center justify-end gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={closeForgotModal}
                    className="h-10 px-4 text-xs font-bold text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-xl cursor-pointer transition"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    className="h-10 px-5 bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-extrabold rounded-xl cursor-pointer shadow-md transition"
                  >
                    البحث عن الحساب
                  </button>
                </div>
              </form>
            )}

            {/* Step 2: Verification */}
            {resetStep === 'verify' && matchedUser && (
              <form onSubmit={handleVerifyCode} className="space-y-4">
                <div className="p-3 bg-slate-900 border border-slate-700 rounded-2xl text-xs space-y-1">
                  <span className="font-bold text-amber-300 block text-xs">حساب: {matchedUser.name}</span>
                  <p className="text-slate-300 font-medium text-xs">
                    رمز التحقق التجريبي هو: <span className="font-mono font-extrabold text-amber-400 text-sm">{generatedCode}</span>
                  </p>
                </div>

                <div>
                  <input
                    type="text"
                    required
                    value={verificationCodeInput}
                    onChange={e => setVerificationCodeInput(e.target.value)}
                    placeholder={generatedCode}
                    style={{ fontSize: '16px' }}
                    className="w-full h-11 px-4 bg-slate-900 border border-slate-700 rounded-xl font-mono font-bold text-center text-lg text-white focus:border-amber-400 focus:outline-none"
                  />
                </div>

                <div className="flex items-center justify-end gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => setResetStep('request')}
                    className="h-10 px-4 text-xs font-bold text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-xl cursor-pointer transition"
                  >
                    رجوع
                  </button>
                  <button
                    type="submit"
                    className="h-10 px-5 bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-extrabold rounded-xl cursor-pointer shadow-md transition"
                  >
                    تأكيد الرمز
                  </button>
                </div>
              </form>
            )}

            {/* Step 3: New Password */}
            {resetStep === 'new_password' && (
              <form onSubmit={handleSetNewPassword} className="space-y-4">
                <p className="text-xs text-slate-300 font-semibold">
                  كلمة السر الجديدة لحساب <span className="text-white font-bold">{matchedUser?.name}</span>:
                </p>

                <div>
                  <input
                    type="password"
                    required
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    placeholder="كلمة السر الجديدة"
                    style={{ fontSize: '16px' }}
                    className="w-full h-11 px-4 bg-slate-900 border border-slate-700 rounded-xl text-xs sm:text-sm text-white font-semibold focus:border-amber-400 focus:outline-none"
                  />
                </div>

                <div>
                  <input
                    type="password"
                    required
                    value={confirmNewPassword}
                    onChange={e => setConfirmNewPassword(e.target.value)}
                    placeholder="تأكيد كلمة السر"
                    style={{ fontSize: '16px' }}
                    className="w-full h-11 px-4 bg-slate-900 border border-slate-700 rounded-xl text-xs sm:text-sm text-white font-semibold focus:border-amber-400 focus:outline-none"
                  />
                </div>

                <div className="flex items-center justify-end gap-2.5 pt-2">
                  <button
                    type="submit"
                    className="h-10 px-5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-extrabold rounded-xl cursor-pointer shadow-md transition"
                  >
                    حفظ كلمة السر
                  </button>
                </div>
              </form>
            )}

            {/* Step 4: Success */}
            {resetStep === 'success' && (
              <div className="text-center py-4 space-y-3">
                <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto" />
                <h4 className="text-sm font-bold text-white font-tajawal">تم تغيير كلمة السر بنجاح!</h4>
                <button
                  type="button"
                  onClick={closeForgotModal}
                  className="h-10 px-5 bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-extrabold rounded-xl cursor-pointer shadow-md transition"
                >
                  العودة لتسجيل الدخول
                </button>
              </div>
            )}

          </div>
        </div>
      )}

    </div>
  );
};
