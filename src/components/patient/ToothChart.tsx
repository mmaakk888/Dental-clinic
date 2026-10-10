import React, { useId, useState } from 'react';
import { getToothLabel, getToothStatusForPatient, ToothStatusType } from '../../utils/toothUtils';
import { Patient } from '../../types';
import { Check, Plus, X } from 'lucide-react';
import './patientClinicalTools.css';

export interface ToothChartProps {
  patient: Patient;
  onOpenAddSessionModal: (compositeToothId: string) => void;
  selectedToothId?: string | null;
  onSelectTooth?: (toothId: string | null) => void;
}

const STATUS_LABELS: Record<ToothStatusType, string> = {
  normal: 'بدون علامة علاجية', filled: 'حشو', crown: 'تركيبة', endodontic: 'علاج عصب', extracted: 'مخلوع / مفقود'
};
const QUADRANTS = [
  { id: 'ur', label: 'العلوي الأيمن', reverse: true },
  { id: 'ul', label: 'العلوي الأيسر', reverse: false },
  { id: 'lr', label: 'السفلي الأيمن', reverse: true },
  { id: 'll', label: 'السفلي الأيسر', reverse: false }
];

export const ToothChart: React.FC<ToothChartProps> = ({
  patient, onOpenAddSessionModal, selectedToothId: externalSelectedToothId, onSelectTooth
}) => {
  const hintId = useId();
  const [dentitionType, setDentitionType] = useState<'adult' | 'pediatric'>('adult');
  const [internalSelectedToothId, setInternalSelectedToothId] = useState<string | null>(null);
  const selectedToothId = externalSelectedToothId !== undefined ? externalSelectedToothId : internalSelectedToothId;
  const selectTooth = (id: string | null) => {
    if (onSelectTooth) onSelectTooth(id);
    else setInternalSelectedToothId(id);
  };
  const items: (string | number)[] = dentitionType === 'adult' ? [1, 2, 3, 4, 5, 6, 7, 8] : ['A', 'B', 'C', 'D', 'E'];
  const moveFocus = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Escape') { selectTooth(null); return; }
    const grid = event.currentTarget.parentElement;
    if (!grid || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const buttons: HTMLButtonElement[] = Array.from(grid.querySelectorAll<HTMLButtonElement>('button[data-tooth-id]'));
    const current = buttons.indexOf(event.currentTarget);
    const columns = Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(/\s+/).filter(Boolean).length);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : current + (event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' ? -columns : columns);
    event.preventDefault();
    buttons[Math.max(0, Math.min(buttons.length - 1, next))]?.focus();
  };

  return (
    <div className="tooth-chart" dir="rtl">
      <div className="tooth-chart-toolbar">
        <div className="tooth-dentition-toggle" role="group" aria-label="الأسنان المعروضة">
          {(['adult', 'pediatric'] as const).map(type => (
            <button key={type} type="button" aria-pressed={dentitionType === type}
              onClick={() => { setDentitionType(type); selectTooth(null); }}
              className="tooth-dentition-button">
              {type === 'adult' ? 'أسنان دائمة' : 'أسنان لبنية'}
            </button>
          ))}
        </div>
        <div className="tooth-chart-legend" aria-label="دليل ألوان الأسنان">
          {(Object.keys(STATUS_LABELS) as ToothStatusType[]).map(status => (
            <span key={status}>
              <i aria-hidden="true" data-tooth-status={status} />{STATUS_LABELS[status]}
            </span>
          ))}
        </div>
      </div>
      <p id={hintId} className="tooth-chart-hint">اختر السن لعرض سجله وتسجيل خدمة. اليمين واليسار حسب جهة المريض.</p>
      <div className="tooth-chart-quadrants">
        {QUADRANTS.map(quadrant => (
          <section key={quadrant.id} className="tooth-chart-quadrant" aria-label={quadrant.label}>
            <h3>{quadrant.label}</h3>
            <div dir="ltr" className="tooth-square-grid" data-dentition={dentitionType}>
              {(quadrant.reverse ? [...items].reverse() : items).map(item => {
                const id = `${quadrant.id}${item}`;
                const status = getToothStatusForPatient(patient.sessions, id);
                const selected = selectedToothId === id;
                return <button key={id} type="button" aria-pressed={selected} data-tooth-id={id} data-tooth-status={status.status} aria-describedby={hintId}
                  aria-label={`${getToothLabel(id)}، ${STATUS_LABELS[status.status]}${status.hasHistory ? '، له سجل خدمات' : ''}`}
                  onClick={() => selectTooth(selected ? null : id)}
                  onKeyDown={moveFocus} className="tooth-square">
                  {item}
                  {selected ? <Check aria-hidden="true" className="tooth-selected-mark" /> : status.hasHistory && <span aria-hidden="true" className="tooth-history-mark" />}
                </button>;
              })}
            </div>
          </section>
        ))}
      </div>
      {selectedToothId && (
        <div className="tooth-selection-strip">
          <span role="status">{getToothLabel(selectedToothId)}</span>
          <div className="tooth-selection-actions">
            {!onSelectTooth && <button type="button" onClick={() => onOpenAddSessionModal(selectedToothId)} className="tooth-register-service"><Plus aria-hidden="true" />تسجيل خدمة</button>}
            <button type="button" onClick={() => selectTooth(null)} aria-label="إلغاء تحديد السن" className="tooth-clear-selection"><X aria-hidden="true" /><span>إلغاء التحديد</span></button>
          </div>
        </div>
      )}
    </div>
  );
};

