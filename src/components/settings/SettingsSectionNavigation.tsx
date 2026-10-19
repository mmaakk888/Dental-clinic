import React, { useId, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronLeft, Sliders, X } from 'lucide-react';
import { useAppointmentDialog } from '../appointments/useAppointmentDialog';
import './settingsNavigation.css';
import './SettingsSectionNavigation.css';

export interface SettingsNavigationSection {
  key: string; label: string; description: string; group: string; icon: React.ReactNode; disabled?: boolean;
}
interface Props {
  sections: readonly SettingsNavigationSection[];
  groups: readonly { key: string; label: string }[];
  activeSection: string; disabled?: boolean; onSelect(key: string): void;
}

function SectionPicker({ sections, groups, activeSection, onSelect, onClose, id }: Props & { id: string; onClose(): void }) {
  const dialogRef = useAppointmentDialog(true, onClose);
  return <div className="clinic-modal-overlay settings-picker-overlay" dir="rtl" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialogRef} id={id} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} tabIndex={-1} className="clinic-modal-panel clinic-modal-panel--framed settings-picker-dialog">
      <div className="settings-picker-header"><div><h2 id={`${id}-title`}>أقسام الإعدادات</h2><p>اختَر القسم الذي تريد تعديله.</p></div>
        <button type="button" onClick={onClose} aria-label="إغلاق أقسام الإعدادات" className="settings-picker-close"><X aria-hidden="true" /></button></div>
      <div className="settings-picker-groups">{groups.filter(group => sections.some(section => section.group === group.key)).map(group => <section key={group.key} aria-label={group.label} className="settings-picker-group">
        <h3>{group.label}</h3><div className="settings-picker-options">{sections.filter(section => section.group === group.key).map(section => <button key={section.key} type="button" className="settings-picker-option"
          aria-label={section.label} aria-current={section.key === activeSection ? 'page' : undefined} disabled={section.disabled} data-dialog-autofocus={section.key === activeSection ? true : undefined} onClick={() => onSelect(section.key)}>
          <span className="settings-picker-icon" aria-hidden="true">{section.icon}</span><span className="settings-picker-label"><strong>{section.label}</strong><small>{section.description}</small></span>
          {section.key === activeSection ? <Check className="settings-picker-indicator" aria-hidden="true" /> : <ChevronLeft className="settings-picker-indicator" aria-hidden="true" />}
        </button>)}</div></section>)}</div>
    </div>
  </div>;
}

/** The original settings navigation styling, without local accounts, storage,
 * data access or save behavior. Mobile opens one grouped, keyboard-safe picker. */
export function SettingsSectionNavigation(props: Props) {
  const id = useId(), [open, setOpen] = useState(false), latest = useRef(props); latest.current = props;
  const selected = props.sections.find(section => section.key === props.activeSection) ?? props.sections[0];
  const choose = (key: string) => {
    const current = latest.current;
    if (current.disabled || !current.sections.some(section => section.key === key && !section.disabled)) return;
    current.onSelect(key); setOpen(false);
  };
  if (!selected) return null;
  return <div className="settings-section-navigation">
    <div className="settings-mobile-nav-anchor"><div className="settings-mobile-nav">
      <span className="settings-mobile-nav-icon" aria-hidden="true">{selected.icon}</span><div className="settings-mobile-nav-title"><small>القسم الحالي</small><strong aria-live="polite">{selected.label}</strong></div>
      <button type="button" className="settings-mobile-nav-change" disabled={props.disabled} aria-haspopup="dialog" aria-expanded={open && !props.disabled} aria-controls={id}
        onClick={() => { if (!latest.current.disabled) setOpen(true); }}>تغيير القسم <ChevronDown aria-hidden="true" /></button>
    </div></div>
    <nav className="settings-desktop-nav csettings-sidebar" aria-label="أقسام لوحة التحكم">
      <div className="csettings-sidebar-heading"><span><Sliders size={16} aria-hidden="true" />أقسام لوحة التحكم</span><small>{props.sections.length.toLocaleString('ar-EG')} أقسام</small></div>
      {props.groups.filter(group => props.sections.some(section => section.group === group.key)).map(group => <div className="csettings-sidebar-group" key={group.key}><h3>{group.label}</h3>
        {props.sections.filter(section => section.group === group.key).map(section => <button key={section.key} type="button" aria-label={section.label} disabled={props.disabled || section.disabled} aria-current={props.activeSection === section.key ? 'page' : undefined} onClick={() => choose(section.key)}>
          <span className="csettings-sidebar-icon" aria-hidden="true">{section.icon}</span><span className="csettings-sidebar-copy"><strong>{section.label}</strong><small>{section.description}</small></span><ChevronLeft size={16} aria-hidden="true" />
        </button>)}</div>)}
    </nav>
    {open && !props.disabled && <SectionPicker {...props} id={id} onSelect={choose} onClose={() => setOpen(false)} />}
  </div>;
}
