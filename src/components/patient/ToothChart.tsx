import React, { useState } from 'react';
import { getToothLabel, getToothStatusForPatient, ToothStatusType } from '../../utils/toothUtils';
import { Patient } from '../../types';
import { Plus, X } from 'lucide-react';

export interface ToothChartProps {
  patient: Patient;
  onOpenAddSessionModal: (compositeToothId: string) => void;
  selectedToothId?: string | null;
  onSelectTooth?: (toothId: string | null) => void;
}

const STATUS_LABELS: Record<ToothStatusType, string> = {
  normal: 'سليم', filled: 'حشو', crown: 'تركيبة', endodontic: 'علاج عصب', extracted: 'مخلوع / مفقود'
};
const STATUS_COLORS: Record<ToothStatusType, string> = {
  normal: 'bg-white text-slate-800 border-slate-300',
  filled: 'bg-amber-100 text-amber-950 border-amber-300',
  crown: 'bg-teal-700 text-white border-teal-800',
  endodontic: 'bg-rose-700 text-white border-rose-800',
  extracted: 'bg-slate-100 text-slate-500 border-slate-300 line-through'
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
  const [dentitionType, setDentitionType] = useState<'adult' | 'pediatric'>('adult');
  const [internalSelectedToothId, setInternalSelectedToothId] = useState<string | null>(null);
  const selectedToothId = externalSelectedToothId !== undefined ? externalSelectedToothId : internalSelectedToothId;
  const selectTooth = (id: string | null) => {
    if (onSelectTooth) onSelectTooth(id);
    else setInternalSelectedToothId(id);
  };
  const items: (string | number)[] = dentitionType === 'adult' ? [1, 2, 3, 4, 5, 6, 7, 8] : ['A', 'B', 'C', 'D', 'E'];

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-4 space-y-3">
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 max-w-sm mx-auto" aria-label="الأسنان المعروضة">
          {(['adult', 'pediatric'] as const).map(type => (
            <button key={type} type="button" aria-pressed={dentitionType === type}
              onClick={() => { setDentitionType(type); selectTooth(null); }}
              className={`min-h-[44px] rounded-lg px-3 text-sm font-bold transition-colors ${dentitionType === type ? 'bg-[#0f3d3e] text-white shadow-sm' : 'text-slate-600 hover:bg-white'}`}>
              {type === 'adult' ? 'أسنان دائمة' : 'أسنان لبنية'}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs text-slate-600">
          {(Object.keys(STATUS_LABELS) as ToothStatusType[]).map(status => (
            <span key={status} className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className={`h-3 w-3 rounded border ${STATUS_COLORS[status]}`} />{STATUS_LABELS[status]}
            </span>
          ))}
        </div>
      </div>
      <p className="text-xs text-slate-500">اختر السن لعرض سجله وتسجيل خدمة. اليمين واليسار حسب جهة المريض.</p>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        {QUADRANTS.map(quadrant => (
          <section key={quadrant.id} className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:p-4" aria-label={quadrant.label}>
            <h3 className="text-xs font-bold text-slate-600 mb-3">{quadrant.label}</h3>
            <div dir="ltr" className={`grid gap-1.5 ${dentitionType === 'adult' ? 'grid-cols-4 sm:grid-cols-8' : 'grid-cols-5'}`}>
              {(quadrant.reverse ? [...items].reverse() : items).map(item => {
                const id = `${quadrant.id}${item}`;
                const status = getToothStatusForPatient(patient.sessions, id);
                const selected = selectedToothId === id;
                return <button key={id} type="button" aria-pressed={selected}
                  aria-label={`${getToothLabel(id)}، ${STATUS_LABELS[status.status]}${status.hasHistory ? '، له سجل خدمات' : ''}`}
                  onClick={() => selectTooth(selected ? null : id)}
                  className={`relative min-h-[44px] min-w-0 rounded-xl border text-sm font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 ${STATUS_COLORS[status.status]} ${selected ? 'ring-2 ring-amber-500 ring-offset-2' : 'hover:border-teal-700'}`}>
                  {item}
                  {status.hasHistory && <span aria-hidden="true" className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-amber-400 ring-1 ring-white" />}
                </button>;
              })}
            </div>
          </section>
        ))}
      </div>
      {!onSelectTooth && selectedToothId && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-teal-200 bg-teal-50 p-4">
          <span className="text-sm font-bold text-teal-900">{getToothLabel(selectedToothId)}</span>
          <div className="flex gap-2">
            <button type="button" onClick={() => onOpenAddSessionModal(selectedToothId)} className="flex items-center gap-2 min-h-[44px] rounded-xl bg-[#0f3d3e] px-3 text-sm font-bold text-white"><Plus className="w-4 h-4" />تسجيل خدمة</button>
            <button type="button" onClick={() => selectTooth(null)} aria-label="إلغاء تحديد السن" className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-white text-slate-600"><X className="w-4 h-4" /></button>
          </div>
        </div>
      )}
    </div>
  );
};

