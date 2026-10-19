import React, { useEffect, useRef } from 'react';
import { Calendar, Landmark, ContactRound, Home, Microscope, LogOut, RefreshCw, Settings2, ShieldCheck, UserRound, Users, Eye, EyeOff, Search, ChevronDown } from 'lucide-react';
import { useHomeClock } from '../../hooks/useHomeClock';
import type { CloudClinicContent, CloudClinicIdentity, CloudClinicTheme, CloudNavigationSection } from '../../utils/cloudClinicSettingsRepository';
import { ClinicDock } from '../navigation/ClinicDock';

export type CloudShellSection = 'home' | CloudNavigationSection;
export interface CloudShellBranding { identity: CloudClinicIdentity; theme: CloudClinicTheme; content: CloudClinicContent; readTime: string; logo?: string | null }
export interface CloudClinicShellProps {
  branding: CloudShellBranding | null; section: CloudShellSection; accountEmail: string; disabled?: boolean;
  checking?: boolean; error?: string; patientDisplayActive: boolean; patientDisplay?: React.ReactNode;
  onPatientDisplay(): void; onNavigate(section: CloudShellSection): void; onSignOut(): void; onRefreshSession(): void;
  children: React.ReactNode;
}
const baseOrder: CloudNavigationSection[] = ['patients','contacts','appointments','lab','summary','settings'];
const icons = { home: Home, patients: Users, contacts: ContactRound, appointments: Calendar, lab: Microscope, summary: Landmark, settings: Settings2 };
const labels = { home:'الرئيسية',patients:'المرضى',contacts:'جهات الاتصال',appointments:'المواعيد',lab:'التركيبات',summary:'الماليات',settings:'الإعدادات' };

/** Presentation only. No SDK, storage, user mapping, reads or authorization.
 * Private workspaces are unmounted from the DOM in patient-display mode, not
 * merely blurred/hidden with CSS. Their owned controllers keep their drafts. */
export function CloudClinicShell(props: CloudClinicShellProps) {
  const latest = useRef(props); latest.current=props;
  const brand=props.branding, mobile=brand?.content.mobile, desktop=brand?.content.desktop;
  const title=brand?.identity.clinicName || 'إدارة العيادة';
  const mobileItems=[{key:'home' as CloudShellSection},...(mobile?.order || baseOrder).map(key=>({key}))];
  const desktopItems=[{key:'home' as CloudShellSection},...(desktop?.order || baseOrder).map(key=>({key}))];
  const label=(key:CloudShellSection)=>brand?.content.navigationLabels[key] || labels[key];
  function navigate(key:CloudShellSection) { const current=latest.current;
    if(current.disabled || current.patientDisplayActive)return;
    current.onNavigate(key);
  }
  useEffect(()=>{const url=brand?.theme.customFontUrl;if(!url)return;
    const link=document.createElement('link');link.rel='stylesheet';link.href=url;link.referrerPolicy='no-referrer';document.head.append(link);
    return()=>link.remove();},[brand?.theme.customFontUrl]);
  const style={ '--cloud-primary':brand?.theme.primary || '#2563eb', '--cloud-background':brand?.theme.background || '#f8fafc',
    '--primary':brand?.theme.primary || '#4f46e5', '--secondary':brand?.theme.secondary || '#4338ca', '--accent':brand?.theme.accent || '#6366f1',
    '--bg-main':brand?.theme.background || '#f8fafc', ...(brand ? {fontFamily:brand.theme.fontFamily}: {}) } as React.CSSProperties;
  return <main dir="rtl" className="cloud-clinic-shell" style={style} data-mobile-size={mobile?.size || 'comfortable'}
    data-desktop-size={desktop?.size || 'comfortable'} data-mobile-labels={mobile?.showLabels ?? true} data-desktop-labels={desktop?.showLabels ?? true}>
    <header className="clinic-topbar cloud-clinic-header"><div className="clinic-topbar-inner">
      {!props.patientDisplayActive && !props.checking ? <details className="cloud-account">
        <summary className="clinic-topbar-account" aria-label="حساب المالك">
          <span className="clinic-topbar-avatar" aria-hidden="true"><UserRound size={20}/></span>
          <span className="clinic-topbar-account-text"><strong className="clinic-topbar-name">{brand?.identity.doctorName || title}</strong>
            <span className="clinic-topbar-meta">حساب المالك · {title}</span></span><ChevronDown size={16} aria-hidden="true"/>
        </summary>
        <div className="cloud-account-menu"><strong><ShieldCheck size={18}/> حساب المالك</strong><bdi>{props.accountEmail}</bdi>
          <p>الحفظ يُؤكّد لكل عملية من الخادم؛ اتصال الإنترنت وحده ليس تأكيدًا.</p>
          {brand && <small>آخر قراءة لإعدادات العرض: <bdi>{new Date(brand.readTime).toLocaleString('ar-EG',{timeZone:'Africa/Cairo'})}</bdi></small>}
          <button type="button" className="cloud-shell-button" disabled={props.disabled || props.checking} onClick={()=>{if(!latest.current.disabled && !latest.current.checking)latest.current.onRefreshSession();}}><RefreshCw size={18}/>التحقق من الجلسة</button>
          <button type="button" className="cloud-shell-button" disabled={props.disabled} onClick={()=>{if(!latest.current.disabled)latest.current.onSignOut();}}><LogOut size={18}/>تسجيل الخروج</button>
        </div>
      </details> : <strong className="clinic-topbar-name">{title}</strong>}
      <div className="clinic-topbar-tools" role="group" aria-label="الأدوات السريعة">
        {!props.patientDisplayActive && <button type="button" className="clinic-topbar-tool" aria-label="البحث الشامل" title="البحث بالاسم أو رقم الملف أو الهاتف"
          disabled={props.disabled || props.checking} onClick={()=>navigate('contacts')}><Search aria-hidden="true"/><span className="clinic-topbar-tool-label">بحث</span></button>}
        <button type="button" className="clinic-topbar-tool" aria-pressed={props.patientDisplayActive} aria-label={props.patientDisplayActive?'العودة للعمل':'عرض للمريض'}
          disabled={props.disabled || props.checking} onClick={()=>{const current=latest.current;if(!current.disabled && !current.checking)current.onPatientDisplay();}}>
          {props.patientDisplayActive?<EyeOff aria-hidden="true"/>:<Eye aria-hidden="true"/>}<span className="clinic-topbar-tool-label">{props.patientDisplayActive?'العودة للعمل':'عرض للمريض'}</span>
        </button>
      </div>
    </div></header>
    {props.error && !props.patientDisplayActive && <p role="alert" className="cloud-shell-error">{props.error}</p>}
    {props.patientDisplayActive ? <section className="cloud-patient-display" hidden={props.checking} inert={props.checking || undefined}>{props.patientDisplay || <div><h1>{title}</h1><p>افتح ملف المريض أولًا لعرض بياناته وحسابه فقط.</p></div>}</section>
      : <>{props.checking && <p className="cloud-shell-verification" role="status">جارٍ إعادة التحقق من جلسة المالك؛ إجراءات البيانات متوقفة مؤقتًا.</p>}
        {/* Keep raw UI drafts mounted during temporary checking of the SAME
            owned session. Actual identity loss is disposed by the parent;
            patient-display mode still removes private children entirely. */}
        <section className="cloud-shell-content" aria-busy={props.checking || undefined} inert={props.checking || undefined}>{props.children}</section></>}
    {!props.patientDisplayActive && <ClinicDock items={mobileItems.map(({key}) => ({key, label:label(key), icon:icons[key]}))}
      desktopItems={desktopItems.map(({key}) => ({key, label:label(key), icon:icons[key]}))}
      appearance={{size:mobile?.size || 'comfortable',showLabels:mobile?.showLabels ?? true,mobileVisibleCount:mobile?.visibleCount || 4,moreSections:mobile?.moreSections || []}}
      desktopAppearance={{size:desktop?.size || 'comfortable',showLabels:desktop?.showLabels ?? true}} selected={props.section}
      disabled={props.disabled} onNavigate={key => navigate(key as CloudShellSection)} />}

  </main>;
}

/** Small isolated timer; it does not rerender the full clinic every second. */
export function CloudClinicClock(){
  const now = useHomeClock();
  const date = now.toLocaleDateString('ar-EG',{weekday:'long',year:'numeric',month:'long',day:'numeric',timeZone:'Africa/Cairo'});
  const time = now.toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit',timeZone:'Africa/Cairo'});
  return <section className="home-today-strip cloud-clinic-clock" aria-label="تاريخ اليوم والوقت المحلي">
    <div><Calendar aria-hidden="true"/><time dateTime={now.toISOString()}>{date}</time></div>
    <div><time dateTime={now.toISOString()} aria-label={`الساعة ${time}`}>{time}</time></div>
  </section>;
}
