import React, { useId, useState } from 'react';
import { Check, X } from 'lucide-react';
import { getToothLabel, parseCompositeToothId, ToothStatusType } from '../../utils/toothUtils';
import './toothSelectionGrid.css';

export type DentitionType = 'adult' | 'pediatric';
export type ToothSelectionMode = 'single' | 'multiple';

export const TOOTH_STATUS_LABELS: Record<ToothStatusType, string> = {
  normal: 'بدون علامة علاجية', filled: 'حشو', crown: 'تركيبة', endodontic: 'علاج عصب', extracted: 'مخلوع / مفقود'
};

export interface ToothSelectionGridProps {
  value: readonly string[];
  onChange: (toothIds: string[]) => void;
  mode?: ToothSelectionMode;
  disabled?: boolean;
  dentition?: DentitionType;
  onDentitionChange?: (dentition: DentitionType) => void;
  showSummary?: boolean;
  showDentitionToggle?: boolean;
  escapeClearsSelection?: boolean;
  ariaDescribedBy?: string;
  ariaLabel?: string;
  getToothState?: (toothId: string) => { status: ToothStatusType; hasHistory: boolean };
}

const JAWS = [
  { id: 'upper', label: 'الأسنان العلوية', quadrants: [{ id: 'ur', label: 'العلوي الأيمن', side: 'يمين المريض', reverse: true }, { id: 'ul', label: 'العلوي الأيسر', side: 'يسار المريض', reverse: false }] },
  { id: 'lower', label: 'الأسنان السفلية', quadrants: [{ id: 'lr', label: 'السفلي الأيمن', side: 'يمين المريض', reverse: true }, { id: 'll', label: 'السفلي الأيسر', side: 'يسار المريض', reverse: false }] }
] as const;

/** Selection is a draft only: this component never creates services or changes clinical data. */
export function changeToothSelection(value: readonly string[], toothId: string, mode: ToothSelectionMode): string[] {
  const valid = [...new Set(value.filter(id => parseCompositeToothId(id)))];
  if (!parseCompositeToothId(toothId)) return valid;
  if (valid.includes(toothId)) return valid.filter(id => id !== toothId);
  return mode === 'single' ? [toothId] : [...valid, toothId];
}

function moveToothFocus(event: React.KeyboardEvent<HTMLButtonElement>, clear?: () => void) {
  if (event.key === 'Escape') { if (clear) { event.preventDefault(); clear(); } return; }
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
  const grid = event.currentTarget.parentElement;
  if (!grid) return;
  const buttons: HTMLButtonElement[] = Array.from(grid.querySelectorAll<HTMLButtonElement>('button[data-tooth-id]'));
  const current = buttons.indexOf(event.currentTarget);
  const columns = Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(/\s+/).filter(Boolean).length);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
    : current + (event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' ? -columns : columns);
  event.preventDefault();
  buttons[Math.max(0, Math.min(buttons.length - 1, next))]?.focus();
}

/** Pure shared board also used by the clinical chart, which owns its dentition/selection state. */
export function createToothSelectionGrid({
  value, onChange, mode = 'multiple', disabled = false, dentition = 'adult',
  onDentitionChange, showSummary = true, showDentitionToggle = true, escapeClearsSelection = false,
  ariaDescribedBy, ariaLabel = 'اختيار الأسنان', getToothState
}: ToothSelectionGridProps) {
  const selectedIds = [...new Set(value.filter(id => parseCompositeToothId(id)))];
  const items = dentition === 'adult' ? ['1', '2', '3', '4', '5', '6', '7', '8'] : ['A', 'B', 'C', 'D', 'E'];
  return (
    <div className="tooth-selection-board" dir="rtl" role="group" aria-label={ariaLabel} data-selection-mode={mode}>
      {showDentitionToggle && onDentitionChange && (
        <div className="tooth-dentition-toggle" role="group" aria-label="الأسنان المعروضة">
          {(['adult', 'pediatric'] as const).map(type => (
            <button key={type} type="button" disabled={disabled} aria-pressed={dentition === type}
              onClick={() => { if (!disabled && type !== dentition) onDentitionChange(type); }} className="tooth-dentition-button">
              {type === 'adult' ? 'أسنان دائمة' : 'أسنان لبنية'}
            </button>
          ))}
        </div>
      )}
      <div className="tooth-selection-map" aria-label="خريطة اختيار الأسنان">
        {JAWS.map(jaw => (
          <section key={jaw.id} className="tooth-selection-jaw" aria-label={jaw.label}>
            <h3 className="tooth-selection-jaw-heading">{jaw.label}</h3>
            <div className="tooth-selection-sides" dir="ltr">
              {jaw.quadrants.map(quadrant => (
                <section key={quadrant.id} className="tooth-chart-quadrant" dir="rtl" aria-label={quadrant.label}>
                  <h4>{quadrant.side}</h4>
                  <div dir="ltr" className="tooth-square-grid" data-dentition={dentition}>
                    {(quadrant.reverse ? [...items].reverse() : items).map(item => {
                      const id = `${quadrant.id}${item}`;
                      const selected = selectedIds.includes(id);
                      const state = getToothState?.(id);
                      return <button key={id} type="button" disabled={disabled} aria-pressed={selected}
                        data-tooth-id={id} data-tooth-status={state?.status} aria-describedby={ariaDescribedBy}
                        aria-label={`${getToothLabel(id)}${state ? `، ${TOOTH_STATUS_LABELS[state.status]}${state.hasHistory ? '، له سجل خدمات' : ''}` : ''}`}
                        onClick={() => { if (!disabled) onChange(changeToothSelection(selectedIds, id, mode)); }}
                        onKeyDown={event => { if (!disabled) moveToothFocus(event, mode === 'single' && escapeClearsSelection ? () => onChange([]) : undefined); }} className="tooth-square">
                        <span>{item}</span>
                        {selected ? <Check aria-hidden="true" className="tooth-selected-mark" /> : state?.hasHistory && <span aria-hidden="true" className="tooth-history-mark" />}
                      </button>;
                    })}
                  </div>
                </section>
              ))}
            </div>
          </section>
        ))}
      </div>
      {showSummary && (
        <div className="tooth-grid-summary">
          <div role="status" aria-live="polite">
            <strong>{selectedIds.length ? `الأسنان المحددة (${selectedIds.length})` : 'لم تُحدّد أسنان بعد'}</strong>
            <p>{selectedIds.length ? selectedIds.map(getToothLabel).join(' • ') : mode === 'single' ? 'اضغط على مربع السن لاختياره.' : 'اضغط على الأسنان المطلوبة. اضغط مرة أخرى لإلغاء الاختيار.'}</p>
          </div>
          {selectedIds.length > 0 && <button type="button" disabled={disabled} onClick={() => { if (!disabled) onChange([]); }} aria-label="إلغاء تحديد الأسنان"><X aria-hidden="true" />مسح التحديد</button>}
        </div>
      )}
    </div>
  );
}

export const ToothSelectionGrid: React.FC<ToothSelectionGridProps> = props => {
  const [internalDentition, setInternalDentition] = useState<DentitionType>(() =>
    props.value.length > 0 && props.value.every(id => parseCompositeToothId(id)?.isPediatric) ? 'pediatric' : 'adult');
  const hintId = useId();
  const changeDentition = (dentition: DentitionType) => {
    if (props.disabled || dentition === (props.dentition ?? internalDentition)) return;
    if (props.dentition === undefined) setInternalDentition(dentition);
    props.onDentitionChange?.(dentition);
  };
  return <div className="tooth-selection-control">
    <p id={hintId} className="tooth-selection-hint">اليمين واليسار حسب جهة المريض. الاختيار لا يحفظ الخدمة تلقائيًا.</p>
    {createToothSelectionGrid({ ...props, dentition: props.dentition ?? internalDentition, onDentitionChange: changeDentition, ariaDescribedBy: props.ariaDescribedBy ?? hintId })}
  </div>;
};
