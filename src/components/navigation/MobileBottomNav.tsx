import React, { useEffect, useRef, useState } from 'react';
import { Home, Users, ContactRound, Calendar, Landmark, MoreHorizontal, Microscope, Settings2, X, ChevronLeft } from 'lucide-react';
import { ActiveView, User, Appointment, LabCase, UILabels } from '../../types';
import { getNavigationItems } from '../../utils/clinicContent';
import { canAccessView } from '../../utils/rbac';

interface Props {
  activeView: ActiveView;
  labels: UILabels;
  tileOrder: string[];
  currentUser: User | null;
  appointments?: Appointment[];
  labCases?: LabCase[];
  onNavigate: (view: ActiveView) => void;
}

const navigationIcons = { home: Home, patients: Users, contacts: ContactRound, appointments: Calendar, lab: Microscope, summary: Landmark, settings: Settings2 };

export const MobileBottomNav = React.memo(({ activeView, labels, tileOrder, currentUser, onNavigate }: Props) => {
  const [open, setOpen] = useState(false);
  const dock = useRef<HTMLElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const items = getNavigationItems(labels, tileOrder).filter(item => canAccessView(currentUser, item.key))
    .map(item => ({ ...item, icon: navigationIcons[item.key] }));
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
  useEffect(() => { setOpen(false); }, [tileOrder, labels]);

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
          <item.icon aria-hidden="true" /><span><strong>{item.label}</strong>{item.description && <small className="clinic-dock-description">{item.description}</small>}</span><ChevronLeft aria-hidden="true" />
        </button>)}</div>
      </div>
    </dialog>}
  </>;
});
MobileBottomNav.displayName = 'MobileBottomNav';

