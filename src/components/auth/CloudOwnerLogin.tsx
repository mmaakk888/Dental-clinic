import React, { useState } from 'react';
import { Eye, EyeOff, KeyRound, LoaderCircle, Lock, Mail, ChevronLeft } from 'lucide-react';
import { ClinicLoginFrame } from './ClinicLoginFrame';

export function CloudOwnerLogin({ email, password, busy, blocked, closing, cleanupFailed, error, onEmail, onPassword, onSubmit, onCancel }: {
  email: string; password: string; busy: boolean; blocked: boolean; closing: boolean; cleanupFailed: boolean; error: string;
  onEmail(value: string): void; onPassword(value: string): void; onSubmit(): void; onCancel(): void;
}) {
  const [showPassword, setShowPassword] = useState(false);
  const field = 'w-full min-h-[52px] pr-11 pl-11 bg-slate-900/80 border border-slate-700/80 rounded-2xl text-white placeholder-slate-500 focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20 outline-none text-base disabled:opacity-60';
  return <ClinicLoginFrame clinicName="إدارة عيادة الأسنان" badge="دخول المالك">
    {error && <p role="alert" className="mb-5 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-sm leading-7 text-rose-200">{error}</p>}
    <form className="space-y-4" aria-busy={busy} onSubmit={event => { event.preventDefault(); if (!blocked) onSubmit(); }}>
      <label className="block space-y-1.5"><span className="block text-sm font-bold text-slate-300">البريد الإلكتروني</span>
        <span className="relative flex items-center"><input name="email" type="email" dir="ltr" autoComplete="username" required maxLength={254} disabled={blocked} value={email}
          onChange={event => onEmail(event.target.value)} className={field} placeholder="name@example.com" />
          <Mail className="absolute right-3.5 h-5 w-5 text-slate-400 pointer-events-none" aria-hidden="true" /></span></label>
      <label className="block space-y-1.5"><span className="block text-sm font-bold text-slate-300">كلمة سر حساب الموقع</span>
        <span className="relative flex items-center"><input name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required maxLength={4096} disabled={blocked} value={password}
          onChange={event => onPassword(event.target.value)} className={field} placeholder="••••••••" />
          <Lock className="absolute right-3.5 h-5 w-5 text-slate-400 pointer-events-none" aria-hidden="true" />
          <button type="button" aria-label={showPassword ? 'إخفاء كلمة السر' : 'إظهار كلمة السر'} aria-pressed={showPassword} disabled={blocked}
            className="absolute left-1 min-w-11 min-h-11 grid place-items-center rounded-xl text-slate-400 hover:text-white" onClick={() => setShowPassword(value => !value)}>
            {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}</button></span></label>
      <button type="submit" disabled={blocked} className="w-full min-h-[52px] mt-3 bg-gradient-to-r from-amber-400 via-amber-300 to-amber-500 rounded-2xl text-slate-950 font-extrabold shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2 disabled:opacity-60">
        {busy ? <LoaderCircle size={20} aria-hidden="true" /> : <KeyRound size={20} aria-hidden="true" />}{busy ? 'جارٍ التحقق…' : 'دخول العيادة'}<ChevronLeft size={17} aria-hidden="true" />
      </button>
    </form>
    {busy && <button type="button" disabled={closing || cleanupFailed} className="mt-3 min-h-11 w-full rounded-xl border border-slate-700 p-3 text-sm font-bold text-slate-300" onClick={onCancel}>{closing ? 'جارٍ إغلاق الجلسة…' : 'إلغاء وتسجيل الخروج'}</button>}
    <p className="mt-5 text-xs leading-6 text-slate-400">اكتب كلمة سر الموقع، وليس حساب Google. الجلسة في الذاكرة فقط؛ لا تُحمّل بيانات المرضى قبل تسجيل الدخول.</p>
  </ClinicLoginFrame>;
}
