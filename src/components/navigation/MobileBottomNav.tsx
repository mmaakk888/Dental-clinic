import React, { useEffect, useRef, useState } from 'react';
import { Home, Users, Calendar, Landmark, MoreHorizontal, Microscope, Settings2, X, ChevronLeft } from 'lucide-react';
import { ActiveView, User, Appointment, LabCase, UILabels } from '../../types';

interface Props {
  activeView: ActiveView;
  labels: UILabels;
  currentUser: User | null;
  appointments?: Appointment[];
  labCases?: LabCase[];
  onNavigate: (view: ActiveView) => void;
}

export const MobileBottomNav = React.memo(({ activeView, labels, currentUser, onNavigate }: Props) => {
  const [open, setOpen] = useState(false);
  const dock = useRef<HTMLElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const permissions = currentUser?.permissions;
  const items = [
    { key: 'home' as ActiveView, label: labels.tabs.home || 'الرئيسية', icon: Home, allowed: true },
    { key: 'patients' as ActiveView, label: 'المرضى', icon: Users, allowed: permissions?.patientView !== false },
    { key: 'appointments' as ActiveView, label: 'المواعيد', icon: Calendar, allowed: permissions?.appointments !== false },
    { key: 'lab' as ActiveView, label: 'التركيبات', icon: Microscope, allowed: permissions?.lab !== false },
    { key: 'summary' as ActiveView, label: 'الماليات', icon: Landmark, allowed: permissions?.summary !== false },
    { key: 'settings' as ActiveView, label: 'الإعدادات', icon: Settings2, allowed: permissions?.controlPanel !== false },
  ].filter(item => item.allowed);
  const extra = items.slice(4);
  const selected = activeView === 'patient-file' ? 'patients' : activeView === 'lab-detail' ? 'lab' : activeView === 'secretary-desk' ? 'home' : activeView;

  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    const oldOverflow = document.body.style.overflow;
    if (element && !element.open) element.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      element?.close();
      document.body.style.overflow = oldOverflow;
      if (moreButton.current?.isConnected) moreButton.current.focus();
    };
  }, [open]);

  useEffect(() => { setOpen(false); }, [activeView, currentUser?.id]);

  useEffect(() => {
    const element = dock.current;
    if (!element) return;
    const updateClearance = () => document.documentElement.style.setProperty('--clinic-dock-height', `${Math.ceil(element.getBoundingClientRect().height)}px`);
    updateClearance();
    const observer = new ResizeObserver(updateClearance);
    observer.observe(element);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty('--clinic-dock-height');
    };
  }, [currentUser?.id]);

  useEffect(() => {
    const wideWindow = window.matchMedia('(min-width: 768px)');
    const closeMoreOnDesktop = () => { if (wideWindow.matches) setOpen(false); };
    wideWindow.addEventListener('change', closeMoreOnDesktop);
    return () => wideWindow.removeEventListener('change', closeMoreOnDesktop);
  }, []);

  const navigate = (view: ActiveView) => { setOpen(false); onNavigate(view); };
  if (!currentUser) return null;

  return <>
    <nav ref={dock} className="clinic-dock" aria-label="التنقل الرئيسي" dir="rtl">
      {items.map((item, index) => <button key={item.key} type="button"
        className={'clinic-dock-item ' + (index >= 4 ? 'clinic-dock-desktop' : '')}
        aria-current={selected === item.key ? 'page' : undefined} title={item.label}
        onClick={() => navigate(item.key)}>
        <span className="clinic-dock-icon" aria-hidden="true"><item.icon /></span><span className="clinic-dock-label">{item.label}</span>
      </button>)}
      {!!extra.length && <button ref={moreButton} type="button" className="clinic-dock-item clinic-dock-more"
        data-active={extra.some(item => item.key === selected) || undefined}
        aria-haspopup="dialog" aria-expanded={open} aria-controls="clinic-more-menu" onClick={() => setOpen(true)}>
        <span className="clinic-dock-icon" aria-hidden="true"><MoreHorizontal /></span><span className="clinic-dock-label">المزيد</span>
      </button>}
    </nav>
    {open && <dialog ref={dialog} id="clinic-more-menu" aria-labelledby="clinic-more-title" className="clinic-dock-dialog" dir="rtl"
      onCancel={() => setOpen(false)} onClose={() => setOpen(false)} onClick={event => { if (event.target === event.currentTarget) setOpen(false); }}>
      <div className="p-5 space-y-4">
        <div className="flex items-center justify-between gap-3"><h2 id="clinic-more-title" className="text-lg font-bold">باقي الأقسام</h2>
          <button type="button" autoFocus aria-label="إغلاق قائمة الأقسام" onClick={() => setOpen(false)} className="clinic-dock-close"><X size={20} aria-hidden="true" /></button>
        </div>
        <div className="grid gap-2">{extra.map(item => <button key={item.key} type="button" onClick={() => navigate(item.key)}
          aria-current={selected === item.key ? 'page' : undefined} className="clinic-dock-option">
          <item.icon aria-hidden="true" /><span>{item.label}</span><ChevronLeft aria-hidden="true" />
        </button>)}</div>
      </div>
    </dialog>}
  </>;
});
MobileBottomNav.displayName = 'MobileBottomNav';


