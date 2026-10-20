import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, MoreHorizontal, X, type LucideIcon } from 'lucide-react';
import type { DockAppearance } from '../../types';
import { splitMobileNavigation } from '../../utils/dockAppearance';
import {lockDialogScroll} from '../../utils/dialogLifecycle';

export interface ClinicDockItem { key: string; label: string; description?: string; icon: LucideIcon }
export interface ClinicDockProps {
  items: readonly ClinicDockItem[]; desktopItems: readonly ClinicDockItem[];
  appearance: DockAppearance; desktopAppearance: Pick<DockAppearance, 'size' | 'showLabels'>;
  selected: string; disabled?: boolean; onNavigate(key: string): void;
}

/** Shared navigation presentation. Permission/identity filtering belongs to
 * the caller; the dock never imports a storage or authentication service. */
export function ClinicDock(props: ClinicDockProps) {
  const [open, setOpen] = useState(false);
  const latest = useRef(props); latest.current = props;
  const dock = useRef<HTMLElement>(null), dialog = useRef<HTMLDialogElement>(null), more = useRef<HTMLButtonElement>(null);
  const outsideMore = useRef(false);
  const { visible, extra } = splitMobileNavigation(props.items, props.appearance);
  useEffect(() => {
    if (!open || props.disabled) return;
    const element = dialog.current, releaseScroll = lockDialogScroll(document.body);
    if (element && !element.open) element.showModal();
    return () => { element?.close(); releaseScroll(); if (more.current?.isConnected) more.current.focus(); };
  }, [open, props.disabled]);
  useEffect(() => { setOpen(false); }, [props.selected, props.items, props.disabled]);
  useEffect(() => {
    const element = dock.current; if (!element) return;
    const update = () => document.documentElement.style.setProperty('--clinic-dock-height', `${Math.ceil(element.getBoundingClientRect().height)}px`);
    update(); const observer = new ResizeObserver(update); observer.observe(element);
    return () => { observer.disconnect(); document.documentElement.style.removeProperty('--clinic-dock-height'); };
  }, []);
  useEffect(() => {
    const media = window.matchMedia('(min-width:768px)'); const close = () => { if (media.matches) setOpen(false); };
    media.addEventListener('change', close); return () => media.removeEventListener('change', close);
  }, []);
  const navigate = (key: string) => {
    const current = latest.current;
    if (current.disabled || !current.items.some(item => item.key === key) && !current.desktopItems.some(item => item.key === key)) return;
    setOpen(false); current.onNavigate(key);
  };
  const item = (row: ClinicDockItem) => <button type="button" key={row.key} className="clinic-dock-item" disabled={props.disabled}
    aria-current={props.selected === row.key ? 'page' : undefined} title={row.label} aria-label={row.label} onClick={() => navigate(row.key)}>
    <span className="clinic-dock-icon" aria-hidden="true"><row.icon /></span><span className="clinic-dock-label">{row.label}</span>
  </button>;
  return <>
    <nav ref={dock} className="clinic-dock" dir="rtl" aria-label="التنقل الرئيسي" data-dock-size={props.appearance.size} data-show-labels={props.appearance.showLabels}
      data-desktop-dock-size={props.desktopAppearance.size} data-desktop-show-labels={props.desktopAppearance.showLabels}>
      <div className="clinic-dock-mobile-set">{visible.map(item)}{extra.length > 0 && <button ref={more} type="button" className="clinic-dock-item clinic-dock-more" aria-label="المزيد من الأقسام"
        aria-haspopup="dialog" aria-expanded={open} aria-controls="clinic-more-menu" disabled={props.disabled} data-active-mobile={extra.some(row => row.key === props.selected) || undefined}
        onClick={() => { if (!latest.current.disabled) setOpen(true); }}><span className="clinic-dock-icon" aria-hidden="true"><MoreHorizontal /></span><span className="clinic-dock-label">المزيد</span></button>}</div>
      <div className="clinic-dock-web-set">{props.desktopItems.map(item)}</div>
    </nav>
    {open && !props.disabled && <dialog ref={dialog} id="clinic-more-menu" aria-label="المزيد من أقسام العيادة" className="clinic-dock-dialog" dir="rtl"
      onCancel={() => setOpen(false)} onClose={() => setOpen(false)} onPointerDown={event => { const r=event.currentTarget.getBoundingClientRect(); outsideMore.current=event.target===event.currentTarget && event.button===0 && (event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom); }} onClick={event => { if (event.target === event.currentTarget && outsideMore.current) setOpen(false); outsideMore.current=false; }}>
      <div className="p-5 space-y-4"><header className="flex items-center justify-between gap-3"><h2 className="text-lg font-bold">باقي الأقسام</h2>
        <button type="button" autoFocus aria-label="إغلاق قائمة الأقسام" className="clinic-dock-close" onClick={() => setOpen(false)}><X size={20} /></button></header>
        <div className="grid gap-2">{extra.map(row => <button type="button" key={row.key} className="clinic-dock-option" onClick={() => navigate(row.key)} aria-current={props.selected === row.key ? 'page' : undefined}>
          <row.icon aria-hidden="true" /><span><strong>{row.label}</strong>{row.description && <small className="clinic-dock-description">{row.description}</small>}</span><ChevronLeft aria-hidden="true" />
        </button>)}</div></div>
    </dialog>}
  </>;
}
