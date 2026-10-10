import React, { useId, useState } from 'react';
import { getToothLabel, getToothStatusForPatient, ToothStatusType } from '../../utils/toothUtils';
import { Patient } from '../../types';
import { ChevronDown, Plus, X } from 'lucide-react';
import { createToothSelectionGrid, TOOTH_STATUS_LABELS } from '../common/ToothSelectionGrid';
import './patientClinicalTools.css';
import './toothChart.css';

export interface ToothChartProps {
  patient: Patient;
  onOpenAddSessionModal: (compositeToothId: string) => void;
  selectedToothId?: string | null;
  onSelectTooth?: (toothId: string | null) => void;
}

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
      </div>
      <p id={hintId} className="tooth-chart-hint">اختر السن لعرض سجله وتسجيل خدمة. اليمين واليسار حسب جهة المريض.</p>
      {createToothSelectionGrid({ value: selectedToothId ? [selectedToothId] : [], onChange: ids => selectTooth(ids[0] ?? null),
        mode: 'single', dentition: dentitionType, showSummary: false, showDentitionToggle: false, escapeClearsSelection: true, ariaDescribedBy: hintId,
        getToothState: id => getToothStatusForPatient(patient.sessions, id) })}
      {selectedToothId && (
        <div className="tooth-selection-strip">
          <span role="status">{getToothLabel(selectedToothId)}</span>
          <div className="tooth-selection-actions">
            {!onSelectTooth && <button type="button" onClick={() => onOpenAddSessionModal(selectedToothId)} className="tooth-register-service"><Plus aria-hidden="true" />تسجيل خدمة</button>}
            <button type="button" onClick={() => selectTooth(null)} aria-label="إلغاء تحديد السن" className="tooth-clear-selection"><X aria-hidden="true" /><span>إلغاء التحديد</span></button>
          </div>
        </div>
      )}
      <details className="tooth-chart-legend-panel">
        <summary>دليل ألوان وسجل الأسنان<ChevronDown aria-hidden="true" /></summary>
        <div className="tooth-chart-legend" aria-label="دليل ألوان الأسنان">
          {(Object.keys(TOOTH_STATUS_LABELS) as ToothStatusType[]).map(status => (
            <span key={status}><i aria-hidden="true" data-tooth-status={status} />{TOOTH_STATUS_LABELS[status]}</span>
          ))}
          <span><i aria-hidden="true" className="tooth-legend-history" />النقطة تعني وجود سجل خدمات</span>
        </div>
      </details>
    </div>
  );
};

