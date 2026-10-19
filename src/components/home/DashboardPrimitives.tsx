import React from 'react';

export type DashboardTone = 'indigo' | 'emerald' | 'amber' | 'rose' | 'purple' | 'teal';
const tones: Record<DashboardTone, { icon: string; hover: string }> = {
  indigo: { icon: 'bg-indigo-100 text-indigo-700', hover: 'hover:border-indigo-300' },
  emerald: { icon: 'bg-emerald-100 text-emerald-700', hover: 'hover:border-emerald-300' },
  amber: { icon: 'bg-amber-100 text-amber-700', hover: 'hover:border-amber-300' },
  rose: { icon: 'bg-rose-100 text-rose-700', hover: 'hover:border-rose-300' },
  purple: { icon: 'bg-purple-100 text-purple-700', hover: 'hover:border-purple-300' },
  teal: { icon: 'bg-teal-100 text-teal-700', hover: 'hover:border-teal-300' },
};

/** Shared presentation for the local and Firebase dashboards. Data and actions
 * are supplied by each runtime; these components never read or save records. */
export const DashboardActionButton: React.FC<{
  title: string; note: string; icon: React.ReactNode; tone: DashboardTone;
  onClick(): void; disabled?: boolean; dialog?: boolean; className?: string;
}> = ({ title, note, icon, tone, onClick, disabled, dialog, className = '' }) => {
  return <button type="button" className={`home-action-button ${className}`} disabled={disabled}
    onClick={() => { if (!disabled) onClick(); }} aria-haspopup={dialog ? 'dialog' : undefined}>
    <span aria-hidden="true" className={`home-action-icon ${tones[tone].icon}`}>{icon}</span>
    <strong>{title}</strong><small>{note}</small>
  </button>;
};

export const DashboardMetricCard: React.FC<{
  title: string; value: React.ReactNode; note: string; icon: React.ReactNode;
  tone: DashboardTone; onClick?: () => void; disabled?: boolean;
}> = ({ title, value, note, icon, tone, onClick, disabled }) => {
  const content = <>
    <span aria-hidden="true" className={`dashboard-icon ${tones[tone].icon}`}>{icon}</span>
    <span className="mt-4 block text-2xl font-black text-slate-950 sm:text-3xl">{value}</span>
    <span className="mt-1 block text-sm font-extrabold text-slate-800">{title}</span>
    <span className="mt-1 block text-xs font-medium text-slate-500">{note}</span>
  </>;
  return onClick
    ? <button type="button" disabled={disabled} onClick={() => { if (!disabled) onClick(); }} className={`dashboard-card text-start ${tones[tone].hover}`}>{content}</button>
    : <div className="dashboard-card text-start">{content}</div>;
};
