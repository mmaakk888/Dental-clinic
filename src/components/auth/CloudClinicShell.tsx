import React, { useEffect, useRef, useState } from 'react';
import { CalendarDays, CircleDollarSign, ContactRound, Home, Layers, LogOut, Menu, RefreshCw, Settings2, ShieldCheck, UserRound, UsersRound, X, Eye, EyeOff } from 'lucide-react';
import { ClinicLogo } from '../common/ClinicLogo';
import type { CloudClinicContent, CloudClinicIdentity, CloudClinicTheme, CloudNavigationSection } from '../../utils/cloudClinicSettingsRepository';
import { splitMobileNavigation } from '../../utils/dockAppearance';
import './CloudClinicShell.css';

export type CloudShellSection = 'home' | CloudNavigationSection;
export interface CloudShellBranding { identity: CloudClinicIdentity; theme: CloudClinicTheme; content: CloudClinicContent; readTime: string; logo?: string | null }
export interface CloudClinicShellProps {
  branding: CloudShellBranding | null; section: CloudShellSection; accountEmail: string; disabled?: boolean;
  checking?: boolean; error?: string; patientDisplayActive: boolean; patientDisplay?: React.ReactNode;
  onPatientDisplay(): void; onNavigate(section: CloudShellSection): void; onSignOut(): void; onRefreshSession(): void;
  children: React.ReactNode;
}
const baseOrder: CloudNavigationSection[] = ['patients','contacts','appointments','lab','summary','settings'];
const icons = { home: Home, patients: UsersRound, contacts: ContactRound, appointments: CalendarDays, lab: Layers, summary: CircleDollarSign, settings: Settings2 };
const labels = { home:'الرئيسية',patients:'المرضى',contacts:'جهات الاتصال',appointments:'المواعيد',lab:'التركيبات',summary:'الماليات',settings:'الإعدادات' };

/** Presentation only. No SDK, storage, user mapping, reads or authorization.
 * Private workspaces are unmounted from the DOM in patient-display mode, not
 * merely blurred/hidden with CSS. Their owned controllers keep their drafts. */
export function CloudClinicShell(props: CloudClinicShellProps) {
  const latest = useRef(props); latest.current=props;
  const dialog = useRef<HTMLDialogElement>(null);
  const [moreOpen,setMoreOpen]=useState(false);
  const brand=props.branding, mobile=brand?.content.mobile, desktop=brand?.content.desktop;
  const title=brand?.identity.clinicName || 'إدارة العيادة';
  const mobileItems=[{key:'home' as CloudShellSection},...(mobile?.order || baseOrder).map(key=>({key}))];
  const desktopItems=[{key:'home' as CloudShellSection},...(desktop?.order || baseOrder).map(key=>({key}))];
  const split=splitMobileNavigation(mobileItems,{size:mobile?.size || 'comfortable',showLabels:mobile?.showLabels ?? true,
    mobileVisibleCount:mobile?.visibleCount || 4,moreSections:mobile?.moreSections || []});
  const label=(key:CloudShellSection)=>brand?.content.navigationLabels[key] || labels[key];
  function navigate(key:CloudShellSection) { const current=latest.current;
    if(current.disabled || current.checking || current.patientDisplayActive)return;
    setMoreOpen(false);dialog.current?.close();current.onNavigate(key);
  }
  useEffect(()=>{if(!moreOpen || props.disabled || props.checking || props.patientDisplayActive){dialog.current?.close();return;}
    const element=dialog.current;if(element && !element.open)element.showModal();
    return()=>element?.close();},[moreOpen,props.disabled,props.checking,props.patientDisplayActive]);
  useEffect(()=>{const media=window.matchMedia('(min-width:768px)');const close=()=>{if(media.matches){dialog.current?.close();setMoreOpen(false);}};
    media.addEventListener('change',close);return()=>media.removeEventListener('change',close);},[]);
  useEffect(()=>{const url=brand?.theme.customFontUrl;if(!url)return;
    const link=document.createElement('link');link.rel='stylesheet';link.href=url;link.referrerPolicy='no-referrer';document.head.append(link);
    return()=>link.remove();},[brand?.theme.customFontUrl]);
  const style={ '--cloud-primary':brand?.theme.primary || '#2563eb', '--cloud-background':brand?.theme.background || '#f8fafc',
    ...(brand ? {fontFamily:brand.theme.fontFamily}: {}) } as React.CSSProperties;
  const item=(key:CloudShellSection)=>{const Icon=icons[key];return <button key={key} type="button" className="cloud-dock-item" aria-label={label(key)}
    aria-current={props.section===key?'page':undefined} disabled={props.disabled || props.checking}
    onClick={()=>navigate(key)}><Icon aria-hidden="true"/><span>{label(key)}</span></button>;};
  return <main dir="rtl" className="cloud-clinic-shell" style={style} data-mobile-size={mobile?.size || 'comfortable'}
    data-desktop-size={desktop?.size || 'comfortable'} data-mobile-labels={mobile?.showLabels ?? true} data-desktop-labels={desktop?.showLabels ?? true}>
    <header className="cloud-clinic-header"><div className="cloud-clinic-brand">{brand?.logo ? <img src={brand.logo} alt="شعار العيادة" width={48} height={48} className="h-12 w-12 shrink-0 object-contain"/> : <ClinicLogo layout="icon-only" size="header" showText={false}/>}<div><strong>{title}</strong>
      {brand?.identity.doctorName && <small>{brand.identity.doctorName}</small>}</div></div>
      <div className="cloud-header-actions"><button type="button" className="cloud-shell-button" aria-pressed={props.patientDisplayActive}
        onClick={()=>{const current=latest.current;if(!current.disabled && !current.checking)current.onPatientDisplay();}} disabled={props.disabled || props.checking}>
        {props.patientDisplayActive?<EyeOff size={20}/>:<Eye size={20}/>}<span>{props.patientDisplayActive?'العودة للعمل':'عرض للمريض'}</span></button>
        {!props.patientDisplayActive && !props.checking && <details className="cloud-account"><summary aria-label="حساب المالك"><UserRound size={22}/><span>حسابي</span></summary>
          <div className="cloud-account-menu"><strong><ShieldCheck size={18}/> حساب المالك</strong><bdi>{props.accountEmail}</bdi>
            <p>{props.checking?'جارٍ التحقق من الجلسة…':'الحفظ يُؤكّد لكل عملية من الخادم؛ اتصال الإنترنت وحده ليس تأكيدًا.'}</p>
            {brand && <small>آخر قراءة لإعدادات العرض: <bdi>{new Date(brand.readTime).toLocaleString('ar-EG',{timeZone:'Africa/Cairo'})}</bdi></small>}
            <button type="button" className="cloud-shell-button" disabled={props.disabled || props.checking} onClick={()=>{if(!latest.current.disabled && !latest.current.checking)latest.current.onRefreshSession();}}><RefreshCw size={18}/>التحقق من الجلسة</button>
            <button type="button" className="cloud-shell-button" disabled={props.disabled} onClick={()=>{if(!latest.current.disabled)latest.current.onSignOut();}}><LogOut size={18}/>تسجيل الخروج</button></div></details>}
      </div></header>
    {props.error && !props.patientDisplayActive && <p role="alert" className="cloud-shell-error">{props.error}</p>}
    {props.patientDisplayActive ? <section className="cloud-patient-display" hidden={props.checking} inert={props.checking || undefined}>{props.patientDisplay || <div><h1>{title}</h1><p>افتح ملف المريض أولًا لعرض بياناته وحسابه فقط.</p></div>}</section>
      : <>{props.checking && <section className="cloud-shell-content" role="status">جارٍ إعادة التحقق من جلسة المالك؛ إجراءات البيانات متوقفة مؤقتًا.</section>}
        {/* Keep raw UI drafts mounted during temporary checking of the SAME
            owned session. Actual identity loss is disposed by the parent;
            patient-display mode still removes private children entirely. */}
        <section className="cloud-shell-content" hidden={props.checking} inert={props.checking || undefined}>{props.children}</section></>}
    {!props.patientDisplayActive && <nav className="cloud-clinic-dock" aria-label="أقسام العيادة">
      <div className="cloud-dock-mobile">{split.visible.map(x=>item(x.key))}{split.extra.length>0 && <button type="button" className="cloud-dock-item" aria-label="المزيد من الأقسام" aria-haspopup="dialog"
        disabled={props.disabled || props.checking} onClick={()=>{if(!latest.current.disabled && !latest.current.checking)setMoreOpen(true);}}><Menu aria-hidden="true"/><span>المزيد</span></button>}</div>
      <div className="cloud-dock-desktop">{desktopItems.map(x=>item(x.key))}</div>
    </nav>}
    {!props.patientDisplayActive && <dialog ref={dialog} className="cloud-more-dialog" aria-label="المزيد من أقسام العيادة" onCancel={()=>setMoreOpen(false)} onClose={()=>setMoreOpen(false)}>
      <header><strong>أقسام العيادة</strong><button type="button" className="cloud-shell-button" aria-label="إغلاق المزيد" onClick={()=>{dialog.current?.close();setMoreOpen(false);}}><X/></button></header>
      <div>{split.extra.map(({key})=>{const Icon=icons[key];return <button type="button" key={key} onClick={()=>navigate(key)}><Icon/><span>{label(key)}</span></button>;})}</div>
    </dialog>}
  </main>;
}

/** Small isolated timer; it does not rerender the full clinic every second. */
export function CloudClinicClock(){const [now,setNow]=useState(()=>new Date());useEffect(()=>{const timer=window.setInterval(()=>setNow(new Date()),1000);return()=>window.clearInterval(timer);},[]);
  return <div className="cloud-clinic-clock"><time dateTime={now.toISOString()}>{now.toLocaleDateString('ar-EG',{weekday:'long',year:'numeric',month:'long',day:'numeric',timeZone:'Africa/Cairo'})}</time>
    <bdi>{now.toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:'Africa/Cairo'})}</bdi></div>;}
