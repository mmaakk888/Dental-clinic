import React, { useState, useEffect, useRef } from 'react';
import { User, Lock, Eye, EyeOff, HelpCircle, Check, AlertCircle, ArrowLeft, ShieldCheck, LoaderCircle } from 'lucide-react';
import { User as UserType } from '../../types';
import { canUserLoginNow } from '../../utils/accessControl';
import { ClinicLogo } from '../common/ClinicLogo';
import {useAppointmentDialog} from '../appointments/useAppointmentDialog';
import './LoginModal.css';

interface LoginModalProps {
  users: UserType[];
  clinicName: string;
  clinicLogo: string | null;
  onLogin: (user: UserType, rememberMe: boolean) => void | Promise<void>;
  onAuthenticate: (username: string, password: string) => Promise<UserType>;
  onUpdateUsers?: (users: UserType[]) => void | Promise<void>;
}

export const LoginModal: React.FC<LoginModalProps> = ({clinicName, clinicLogo, onLogin, onAuthenticate}) => {
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
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
      // Authentication stays with the existing server-backed parent callbacks.
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
  const checkCapsLock = (event: React.KeyboardEvent<HTMLInputElement>) => setCapsLock(event.getModifierState('CapsLock'));

  return (
    <div className="clinic-login" dir="rtl">
      <div className="clinic-login-ambient" aria-hidden="true" />
      <main className="clinic-login-frame" aria-hidden={isForgotOpen} inert={isForgotOpen}>
        <header className="clinic-login-brand">
          <ClinicLogo size="lg" layout="icon-only" showText={false} variant="light" customLogoUrl={clinicLogo} className="clinic-login-logo" />
          <div>
            <h1>{clinicName || 'عيادة الأسنان المتكاملة'}</h1>
            <p>نظام إدارة العيادة</p>
          </div>
        </header>

        <section className="clinic-login-card" aria-labelledby="login-title">
          <div className="clinic-login-card-heading">
            <span className="clinic-login-lock" aria-hidden="true"><Lock size={22} strokeWidth={1.7} /></span>
            <div>
              <p className="clinic-login-eyebrow">تسجيل الدخول</p>
              <h2 id="login-title">مرحبًا بعودتك</h2>
            </div>
          </div>
          <p className="clinic-login-intro" id="login-description">أدخل بيانات حسابك للمتابعة إلى العيادة.</p>

          {errorMessage && (
            <div id="login-error" role="alert" className="clinic-login-error">
              <AlertCircle size={19} aria-hidden="true" />
              <span>{errorMessage}</span>
            </div>
          )}

          <form onSubmit={handleLoginSubmit} className="clinic-login-form" aria-describedby="login-description" aria-busy={isLoading}>
            <div className="clinic-login-field">
              <label htmlFor="login-username">اسم المستخدم أو البريد الإلكتروني</label>
              <div className="clinic-login-input-wrap">
                <User size={20} className="clinic-login-field-icon" aria-hidden="true" />
                <input id="login-username" name="username" type="text" required autoComplete="username"
                  autoCapitalize="none" autoCorrect="off" spellCheck={false} dir="auto" disabled={isLoading}
                  value={usernameInput} onChange={e => setUsernameInput(e.target.value)}
                  placeholder="اكتب اسم المستخدم أو البريد" aria-describedby={errorMessage ? 'login-error' : undefined} />
              </div>
            </div>

            <div className="clinic-login-field">
              <label htmlFor="login-password">كلمة السر</label>
              <div className="clinic-login-input-wrap">
                <Lock size={20} className="clinic-login-field-icon" aria-hidden="true" />
                <input id="login-password" name="password" className="clinic-login-password" type={showPassword ? 'text' : 'password'}
                  required autoComplete="current-password" autoCapitalize="none" autoCorrect="off" spellCheck={false} dir="ltr" disabled={isLoading}
                  value={passwordInput} onChange={e => setPasswordInput(e.target.value)}
                  onKeyDown={checkCapsLock} onKeyUp={checkCapsLock} onBlur={() => setCapsLock(false)}
                  placeholder="••••••••" aria-describedby={[errorMessage ? 'login-error' : '', capsLock ? 'login-caps-lock' : ''].filter(Boolean).join(' ') || undefined} />
                <button type="button" className="clinic-login-password-toggle" disabled={isLoading}
                  onClick={() => setShowPassword(!showPassword)} aria-controls="login-password"
                  aria-label={showPassword ? 'إخفاء كلمة السر' : 'إظهار كلمة السر'} aria-pressed={showPassword}
                  title={showPassword ? 'إخفاء كلمة السر' : 'إظهار كلمة السر'}>
                  {showPassword ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
                </button>
              </div>
              {capsLock && <p id="login-caps-lock" className="clinic-login-caps-lock" role="status">زر الحروف الكبيرة (Caps Lock) مفعّل.</p>}
            </div>

            <div className="clinic-login-options">
              <label className="clinic-login-remember">
                <input name="remember" type="checkbox" checked={rememberMe} disabled={isLoading}
                  onChange={e => setRememberMe(e.target.checked)} />
                <span className="clinic-login-check" aria-hidden="true">{rememberMe && <Check size={13} strokeWidth={3} />}</span>
                <span>تذكرني على هذا الجهاز</span>
              </label>
              <button type="button" className="clinic-login-help" disabled={isLoading} onClick={() => setIsForgotOpen(true)}>نسيت كلمة السر؟</button>
            </div>

            <button type="submit" className="clinic-login-submit" disabled={isLoading} aria-busy={isLoading}
              aria-label={isLoading ? 'جاري تسجيل الدخول' : 'تسجيل الدخول'}>
              {isLoading ? <LoaderCircle size={20} className="clinic-login-spinner" aria-hidden="true" /> : <span />}
              <span>{isLoading ? 'جاري تسجيل الدخول…' : 'تسجيل الدخول'}</span>
              {isLoading ? <span /> : <ArrowLeft size={20} aria-hidden="true" />}
            </button>
          </form>

          <p className="clinic-login-privacy"><ShieldCheck size={16} aria-hidden="true" /><span>حسابك شخصي للحفاظ على خصوصية بيانات العيادة.</span></p>
        </section>

        <footer className="clinic-login-footer">نظام إدارة العيادة <span aria-hidden="true">·</span> {new Date().getFullYear()}</footer>
      </main>

      {isForgotOpen && (
        <div className="clinic-modal-overlay fixed inset-0 z-60 flex items-center justify-center bg-slate-950/85 p-4" dir="rtl">
          <div ref={recoveryRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="login-recovery-title" aria-describedby="login-recovery-description"
            className="clinic-modal-panel clinic-login-recovery">
            <span className="clinic-login-lock" aria-hidden="true"><HelpCircle size={24} /></span>
            <h3 id="login-recovery-title">نسيت كلمة السر؟</h3>
            <p id="login-recovery-description">استعادة كلمة السر بالبريد غير مفعّلة في النسخة الحالية. يمكن لمدير العيادة تغيير كلمة سر حسابك من الإعدادات ثم المستخدمون.</p>
            <p>إذا كنت المدير وفقدت الوصول، استخدم أداة الاستعادة الخاصة وفق دليل التثبيت.</p>
            <button type="button" onClick={closeForgotModal} className="clinic-login-submit">العودة لتسجيل الدخول</button>
          </div>
        </div>
      )}
    </div>
  );
};
