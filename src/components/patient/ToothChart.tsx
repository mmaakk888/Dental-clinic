import React, { useState } from 'react';
import { getToothLabel, getToothStatusForPatient, ToothStatusType } from '../../utils/toothUtils';
import { Patient } from '../../types';
import { Plus, History, Eye, X, Check, Sparkles, AlertCircle } from 'lucide-react';

export interface ToothChartProps {
  patient: Patient;
  onOpenAddSessionModal: (compositeToothId: string) => void;
  selectedToothId?: string | null;
  onSelectTooth?: (toothId: string | null) => void;
}

// Helper to determine tooth anatomical category
type ToothType = 'incisor' | 'canine' | 'premolar' | 'molar';

const getToothCategory = (item: string | number): ToothType => {
  const num = typeof item === 'number' ? item : parseInt(item, 10);
  if (!isNaN(num)) {
    if (num === 1 || num === 2) return 'incisor';
    if (num === 3) return 'canine';
    if (num === 4 || num === 5) return 'premolar';
    return 'molar'; // 6, 7, 8
  }
  // Pediatric A-E
  const str = String(item).toUpperCase();
  if (str === 'A' || str === 'B') return 'incisor';
  if (str === 'C') return 'canine';
  return 'molar'; // D, E
};

// SVG Tooth Component with Upper/Lower orientation
interface SVGToothProps {
  item: string | number;
  isUpper: boolean;
  status: ToothStatusType;
  isSelected: boolean;
  isDimmed: boolean;
  hasHistory: boolean;
  onClick: () => void;
}

const SVGTooth: React.FC<SVGToothProps> = ({
  item,
  isUpper,
  status,
  isSelected,
  isDimmed,
  hasHistory,
  onClick
}) => {
  const category = getToothCategory(item);

  // Status colors & strokes
  let crownFill = '#ffffff';
  let rootFill = '#f8fafc';
  let strokeColor = '#475569';
  let statusBadgeColor = '';

  if (status === 'filled') {
    crownFill = '#fef3c7';
    rootFill = '#fffbeb';
    strokeColor = '#d97706';
    statusBadgeColor = 'bg-amber-500';
  } else if (status === 'crown') {
    crownFill = '#0d9488';
    rootFill = '#115e59';
    strokeColor = '#0f766e';
    statusBadgeColor = 'bg-teal-600';
  } else if (status === 'endodontic') {
    crownFill = '#fecdd3';
    rootFill = '#be123c';
    strokeColor = '#9f1239';
    statusBadgeColor = 'bg-rose-600';
  } else if (status === 'extracted') {
    crownFill = '#f1f5f9';
    rootFill = '#e2e8f0';
    strokeColor = '#94a3b8';
  }

  // Define SVG paths according to tooth category and orientation
  const renderToothPath = () => {
    if (isUpper) {
      // Roots UP (y: 2 to 24), Crown DOWN (y: 24 to 48)
      switch (category) {
        case 'incisor':
          return (
            <g>
              <path d="M 17 22 C 16 10, 20 4, 20 4 C 20 4, 24 10, 23 22 Z" fill={rootFill} stroke={strokeColor} strokeWidth="1.5" />
              <path d="M 12 22 C 11 34, 13 46, 20 46 C 27 46, 29 34, 28 22 Z" fill={crownFill} stroke={strokeColor} strokeWidth="1.8" />
            </g>
          );
        case 'canine':
          return (
            <g>
              <path d="M 16 22 C 15 8, 20 2, 20 2 C 20 2, 25 8, 24 22 Z" fill={rootFill} stroke={strokeColor} strokeWidth="1.5" />
              <path d="M 11 22 C 10 32, 14 42, 20 47 C 26 42, 30 32, 29 22 Z" fill={crownFill} stroke={strokeColor} strokeWidth="1.8" />
            </g>
          );
        case 'premolar':
          return (
            <g>
              <path d="M 14 22 C 12 12, 16 4, 17 4 C 18 12, 19 18, 20 22 M 20 22 C 21 18, 22 12, 23 4 C 24 4, 28 12, 26 22" fill={rootFill} stroke={strokeColor} strokeWidth="1.5" />
              <path d="M 10 22 C 8 32, 13 46, 20 45 C 27 46, 32 32, 30 22 Z" fill={crownFill} stroke={strokeColor} strokeWidth="1.8" />
            </g>
          );
        case 'molar':
        default:
          return (
            <g>
              <path d="M 11 22 C 8 10, 11 3, 13 3 C 15 10, 17 18, 20 22 M 20 22 C 23 18, 25 10, 27 3 C 29 3, 32 10, 29 22" fill={rootFill} stroke={strokeColor} strokeWidth="1.5" />
              <path d="M 8 22 C 6 32, 10 46, 20 46 C 30 46, 34 32, 32 22 Z" fill={crownFill} stroke={strokeColor} strokeWidth="2" />
              <path d="M 15 22 L 15 34 M 25 22 L 25 34" stroke={strokeColor} strokeWidth="1" strokeDasharray="2 2" opacity="0.6" />
            </g>
          );
      }
    } else {
      // Lower Tooth: Crown UP (y: 8 to 32), Roots DOWN (y: 32 to 52)
      switch (category) {
        case 'incisor':
          return (
            <g>
              <path d="M 12 30 C 11 18, 13 6, 20 6 C 27 6, 29 18, 28 30 Z" fill={crownFill} stroke={strokeColor} strokeWidth="1.8" />
              <path d="M 17 30 C 16 42, 20 52, 20 52 C 20 52, 24 42, 23 30 Z" fill={rootFill} stroke={strokeColor} strokeWidth="1.5" />
            </g>
          );
        case 'canine':
          return (
            <g>
              <path d="M 11 30 C 10 20, 14 10, 20 5 C 26 10, 30 20, 29 30 Z" fill={crownFill} stroke={strokeColor} strokeWidth="1.8" />
              <path d="M 16 30 C 15 44, 20 54, 20 54 C 20 54, 25 44, 24 30 Z" fill={rootFill} stroke={strokeColor} strokeWidth="1.5" />
            </g>
          );
        case 'premolar':
          return (
            <g>
              <path d="M 10 30 C 8 20, 13 6, 20 7 C 27 6, 32 20, 30 30 Z" fill={crownFill} stroke={strokeColor} strokeWidth="1.8" />
              <path d="M 14 30 C 12 40, 16 52, 17 52 C 18 44, 19 38, 20 30 M 20 30 C 21 38, 22 44, 23 52 C 24 52, 28 40, 26 30" fill={rootFill} stroke={strokeColor} strokeWidth="1.5" />
            </g>
          );
        case 'molar':
        default:
          return (
            <g>
              <path d="M 8 30 C 6 20, 10 6, 20 6 C 30 6, 34 20, 32 30 Z" fill={crownFill} stroke={strokeColor} strokeWidth="2" />
              <path d="M 15 30 L 15 18 M 25 30 L 25 18" stroke={strokeColor} strokeWidth="1" strokeDasharray="2 2" opacity="0.6" />
              <path d="M 11 30 C 9 42, 12 53, 14 53 C 16 44, 18 36, 20 30 M 20 30 C 22 36, 24 44, 26 53 C 28 53, 31 42, 29 30" fill={rootFill} stroke={strokeColor} strokeWidth="1.5" />
            </g>
          );
      }
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative group flex flex-col items-center justify-center p-1.5 rounded-2xl transition-all cursor-pointer min-h-[44px] touch-manipulation ${
        isSelected
          ? 'scale-125 z-30 ring-4 ring-[#c9a227] bg-amber-50/95 shadow-xl border-2 border-[#c9a227]'
          : isDimmed
          ? 'opacity-40 hover:opacity-100 scale-95'
          : 'hover:scale-110 hover:bg-slate-50 active:scale-95'
      }`}
      title={`سنة رقم #${item} - ${status === 'normal' ? 'سليمة' : status}`}
    >
      <div className="relative w-10 h-14 sm:w-12 sm:h-16 flex items-center justify-center">
        <svg viewBox="0 0 40 56" className="w-full h-full overflow-visible drop-shadow-2xs">
          {renderToothPath()}

          {/* Extracted X overlay */}
          {status === 'extracted' && (
            <path
              d="M 8 8 L 32 48 M 32 8 L 8 48"
              stroke="#ef4444"
              strokeWidth="2.8"
              strokeLinecap="round"
              opacity="0.85"
            />
          )}
        </svg>

        {/* History indicator dot */}
        {hasHistory && (
          <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-rose-600 ring-2 ring-white shadow-xs animate-pulse" />
        )}
      </div>

      {/* Number Badge */}
      <span
        className={`mt-1 text-[11px] sm:text-xs font-black font-mono px-2 py-0.5 rounded-full shadow-2xs border transition-all ${
          isSelected
            ? 'bg-[#0f3d3e] text-[#c9a227] border-[#0f3d3e] ring-1 ring-[#c9a227]'
            : status === 'crown'
            ? 'bg-teal-700 text-white border-teal-800'
            : status === 'endodontic'
            ? 'bg-rose-700 text-white border-rose-800'
            : status === 'filled'
            ? 'bg-amber-100 text-amber-900 border-amber-300'
            : 'bg-slate-100 text-slate-700 border-slate-200'
        }`}
      >
        {item}
      </span>
    </button>
  );
};

export const ToothChart: React.FC<ToothChartProps> = ({
  patient,
  onOpenAddSessionModal,
  selectedToothId: externalSelectedToothId,
  onSelectTooth: externalOnSelectTooth
}) => {
  const [dentitionType, setDentitionType] = useState<'adult' | 'pediatric'>('adult');
  const [chartStyle] = useState<'anatomical' | 'boxes'>('boxes');
  const [internalSelectedToothId, setInternalSelectedToothId] = useState<string | null>(null);

  const selectedToothId = externalSelectedToothId !== undefined ? externalSelectedToothId : internalSelectedToothId;

  const handleToothClick = (compositeId: string) => {
    const nextVal = selectedToothId === compositeId ? null : compositeId;
    if (externalOnSelectTooth) {
      externalOnSelectTooth(nextVal);
    } else {
      setInternalSelectedToothId(nextVal);
    }
  };

  const getStatusColor = (status: ToothStatusType) => {
    switch (status) {
      case 'filled':
        return 'bg-[#e9d692] text-amber-950 border-amber-400/80 font-bold';
      case 'crown':
        return 'bg-[#1b5e5a] text-white border-teal-800 font-bold';
      case 'endodontic':
        return 'bg-[#8b4049] text-white border-rose-900 font-bold';
      case 'extracted':
        return 'bg-slate-200 text-slate-400 border-slate-300 line-through opacity-60';
      case 'normal':
      default:
        return 'bg-white text-slate-800 border-slate-300 hover:border-[#0f3d3e] hover:bg-[#e4ede9]/50';
    }
  };

  // Matching sessions for selected tooth
  const selectedToothSessions = selectedToothId
    ? patient.sessions.filter(s => {
        if (s.tooth === selectedToothId) return true;
        if (s.teethIds && s.teethIds.includes(selectedToothId)) return true;
        return false;
      })
    : [];

  const adultUR = [8, 7, 6, 5, 4, 3, 2, 1];
  const adultUL = [1, 2, 3, 4, 5, 6, 7, 8];
  const adultLR = [8, 7, 6, 5, 4, 3, 2, 1];
  const adultLL = [1, 2, 3, 4, 5, 6, 7, 8];

  const pedsUR = ['E', 'D', 'C', 'B', 'A'];
  const pedsUL = ['A', 'B', 'C', 'D', 'E'];
  const pedsLR = ['E', 'D', 'C', 'B', 'A'];
  const pedsLL = ['A', 'B', 'C', 'D', 'E'];

  const isPediatric = dentitionType === 'pediatric';

  return (
    <div className="space-y-6">
      {/* Dentition selector + compact status legend */}
      <div className="bg-white p-4 rounded-3xl border border-slate-200 text-xs space-y-4 shadow-2xs">
        <div className="flex items-center justify-center gap-3 border-b border-slate-100 pb-3">
          {/* Adult / Pediatric Switcher Segmented Control */}
          <div className="w-full sm:w-auto">
            <div className="grid grid-cols-2 p-1 bg-slate-100 rounded-2xl border border-slate-200/90 shadow-inner">
              <button
                type="button"
                onClick={() => setDentitionType('adult')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
                  !isPediatric ? 'bg-[#0f3d3e] text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                أسنان دائمة
              </button>
              <button
                type="button"
                onClick={() => setDentitionType('pediatric')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-black transition-all cursor-pointer ${
                  isPediatric ? 'bg-[#0f3d3e] text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                أسنان لبنية
              </button>
            </div>
          </div>
        </div>

        {/* Legend Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <span className="font-bold text-slate-700 font-tajawal">دليل ألوان الحالات والتركيبات:</span>
          <div className="flex items-center gap-3 flex-wrap text-xs">
            <div className="flex items-center gap-1.5">
              <span className="w-3.5 h-3.5 rounded-md bg-white border border-slate-400 shadow-2xs" />
              <span>سليم</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3.5 h-3.5 rounded-md bg-amber-200 border border-amber-500" />
              <span>حشو</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3.5 h-3.5 rounded-md bg-teal-700 text-white" />
              <span>تركيبة / تاج</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3.5 h-3.5 rounded-md bg-rose-600 text-white" />
              <span>علاج عصب</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3.5 h-3.5 rounded-md bg-slate-200 border border-slate-300 text-slate-400" />
              <span>مخلوع / مفقود</span>
            </div>
            <div className="flex items-center gap-1.5 border-r pr-3 border-slate-200">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
              <span>سجل خدمات</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Diagram Area */}
      <div className="bg-white rounded-3xl p-3 sm:p-5 md:p-8 border border-slate-200 shadow-sm relative overflow-hidden">
        {/* Label Top */}
        <div className="text-center font-bold text-[#0f3d3e] font-tajawal text-sm tracking-wider mb-4 flex items-center justify-center gap-2">
          <span>▲ الفك العلوي ({isPediatric ? 'أسنان لبنية' : 'أسنان دائمة'})</span>
        </div>

        {/* Cross Container */}
        <div className="relative max-w-3xl mx-auto py-2">
          {/* Vertical Cross Line */}
          <div className="hidden sm:block absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-0.5 bg-slate-200 pointer-events-none" />
          {/* Horizontal Cross Line */}
          <div className="hidden sm:block absolute left-0 right-0 top-1/2 -translate-y-1/2 h-0.5 bg-slate-200 pointer-events-none" />

          {/* Grid Layout of 4 Quadrants */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 sm:gap-x-10 gap-y-4 sm:gap-y-8 relative z-10">
            {/* Upper Right Quadrant (UR) */}
            <div className="flex items-center justify-center sm:justify-end gap-1 sm:gap-2">
              {(isPediatric ? pedsUR : adultUR).map(item => {
                const compositeId = `ur${item}`;
                const res = getToothStatusForPatient(patient.sessions, compositeId);
                const isSelected = selectedToothId === compositeId;
                const isDimmed = !!selectedToothId && !isSelected;

                if (chartStyle === 'anatomical') {
                  return (
                    <SVGTooth
                      key={compositeId}
                      item={item}
                      isUpper={true}
                      status={res.status}
                      isSelected={isSelected}
                      isDimmed={isDimmed}
                      hasHistory={res.hasHistory}
                      onClick={() => handleToothClick(compositeId)}
                    />
                  );
                }

                return (
                  <button
                    key={compositeId}
                    type="button"
                    onClick={() => handleToothClick(compositeId)}
                    className={`relative w-8 h-11 sm:w-11 sm:h-13 rounded-xl border text-sm font-bold transition-all cursor-pointer flex flex-col items-center justify-center ${getStatusColor(res.status)} ${
                      isSelected ? 'ring-3 ring-[#c9a227] scale-110 z-20 shadow-lg' : isDimmed ? 'opacity-40 scale-95' : ''
                    }`}
                  >
                    {res.hasHistory && (
                      <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-rose-500" />
                    )}
                    <span>{item}</span>
                  </button>
                );
              })}
            </div>

            {/* Upper Left Quadrant (UL) */}
            <div className="flex items-center justify-center sm:justify-start gap-1 sm:gap-2">
              {(isPediatric ? pedsUL : adultUL).map(item => {
                const compositeId = `ul${item}`;
                const res = getToothStatusForPatient(patient.sessions, compositeId);
                const isSelected = selectedToothId === compositeId;
                const isDimmed = !!selectedToothId && !isSelected;

                if (chartStyle === 'anatomical') {
                  return (
                    <SVGTooth
                      key={compositeId}
                      item={item}
                      isUpper={true}
                      status={res.status}
                      isSelected={isSelected}
                      isDimmed={isDimmed}
                      hasHistory={res.hasHistory}
                      onClick={() => handleToothClick(compositeId)}
                    />
                  );
                }

                return (
                  <button
                    key={compositeId}
                    type="button"
                    onClick={() => handleToothClick(compositeId)}
                    className={`relative w-8 h-11 sm:w-11 sm:h-13 rounded-xl border text-sm font-bold transition-all cursor-pointer flex flex-col items-center justify-center ${getStatusColor(res.status)} ${
                      isSelected ? 'ring-3 ring-[#c9a227] scale-110 z-20 shadow-lg' : isDimmed ? 'opacity-40 scale-95' : ''
                    }`}
                  >
                    {res.hasHistory && (
                      <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-rose-500" />
                    )}
                    <span>{item}</span>
                  </button>
                );
              })}
            </div>

            {/* Lower Right Quadrant (LR) */}
            <div className="flex items-center justify-center sm:justify-end gap-1 sm:gap-2">
              {(isPediatric ? pedsLR : adultLR).map(item => {
                const compositeId = `lr${item}`;
                const res = getToothStatusForPatient(patient.sessions, compositeId);
                const isSelected = selectedToothId === compositeId;
                const isDimmed = !!selectedToothId && !isSelected;

                if (chartStyle === 'anatomical') {
                  return (
                    <SVGTooth
                      key={compositeId}
                      item={item}
                      isUpper={false}
                      status={res.status}
                      isSelected={isSelected}
                      isDimmed={isDimmed}
                      hasHistory={res.hasHistory}
                      onClick={() => handleToothClick(compositeId)}
                    />
                  );
                }

                return (
                  <button
                    key={compositeId}
                    type="button"
                    onClick={() => handleToothClick(compositeId)}
                    className={`relative w-8 h-11 sm:w-11 sm:h-13 rounded-xl border text-sm font-bold transition-all cursor-pointer flex flex-col items-center justify-center ${getStatusColor(res.status)} ${
                      isSelected ? 'ring-3 ring-[#c9a227] scale-110 z-20 shadow-lg' : isDimmed ? 'opacity-40 scale-95' : ''
                    }`}
                  >
                    {res.hasHistory && (
                      <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-rose-500" />
                    )}
                    <span>{item}</span>
                  </button>
                );
              })}
            </div>

            {/* Lower Left Quadrant (LL) */}
            <div className="flex items-center justify-center sm:justify-start gap-1 sm:gap-2">
              {(isPediatric ? pedsLL : adultLL).map(item => {
                const compositeId = `ll${item}`;
                const res = getToothStatusForPatient(patient.sessions, compositeId);
                const isSelected = selectedToothId === compositeId;
                const isDimmed = !!selectedToothId && !isSelected;

                if (chartStyle === 'anatomical') {
                  return (
                    <SVGTooth
                      key={compositeId}
                      item={item}
                      isUpper={false}
                      status={res.status}
                      isSelected={isSelected}
                      isDimmed={isDimmed}
                      hasHistory={res.hasHistory}
                      onClick={() => handleToothClick(compositeId)}
                    />
                  );
                }

                return (
                  <button
                    key={compositeId}
                    type="button"
                    onClick={() => handleToothClick(compositeId)}
                    className={`relative w-8 h-11 sm:w-11 sm:h-13 rounded-xl border text-sm font-bold transition-all cursor-pointer flex flex-col items-center justify-center ${getStatusColor(res.status)} ${
                      isSelected ? 'ring-3 ring-[#c9a227] scale-110 z-20 shadow-lg' : isDimmed ? 'opacity-40 scale-95' : ''
                    }`}
                  >
                    {res.hasHistory && (
                      <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-rose-500" />
                    )}
                    <span>{item}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Label Bottom */}
        <div className="text-center font-bold text-[#0f3d3e] font-tajawal text-sm tracking-wider mt-4">
          ▼ الفك السفلي ({isPediatric ? 'أسنان لبنية' : 'أسنان دائمة'})
        </div>
      </div>

      {/* Selected Tooth Detail Panel */}
      {false && selectedToothId && (
        <div className="bg-gradient-to-br from-teal-900/5 via-slate-50 to-amber-50/20 rounded-3xl p-5 sm:p-6 border-2 border-[#0f3d3e]/20 shadow-md space-y-4 animate-fadeIn">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-200/80 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-[#0f3d3e] text-[#c9a227] font-black text-xl flex items-center justify-center shrink-0 shadow-sm border border-teal-800">
                🦷
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-black bg-[#0f3d3e] text-[#c9a227] px-2.5 py-0.5 rounded-lg">
                    سن #{selectedToothId}
                  </span>
                  <span className="text-xs font-bold text-slate-600">
                    {getToothStatusForPatient(patient.sessions, selectedToothId).status === 'normal' ? 'سليم' : getToothStatusForPatient(patient.sessions, selectedToothId).status}
                  </span>
                </div>
                <h3 className="text-base sm:text-lg font-black text-slate-900 font-tajawal mt-1">
                  {getToothLabel(selectedToothId)}
                </h3>
              </div>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                type="button"
                onClick={() => onOpenAddSessionModal(selectedToothId)}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-[#0f3d3e] hover:bg-[#134d4f] text-white text-xs font-black shadow-md transition-all cursor-pointer active:scale-95 min-h-[46px] touch-manipulation"
              >
                <Plus className="w-4 h-4 text-[#c9a227]" />
                <span>تسجيل خدمة</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (externalOnSelectTooth) {
                    externalOnSelectTooth(null);
                  } else {
                    setInternalSelectedToothId(null);
                  }
                }}
                className="px-3.5 py-3 rounded-2xl bg-slate-200/90 hover:bg-slate-300 text-slate-700 text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer active:scale-95 min-h-[46px] touch-manipulation"
                title="إلغاء التحديد وإغلاق"
              >
                <X className="w-4 h-4" />
                <span className="hidden sm:inline">إغلاق</span>
              </button>
            </div>
          </div>

          <div>
            <h4 className="text-xs font-black text-slate-800 font-tajawal mb-3 flex items-center gap-1.5">
              <History className="w-4 h-4 text-[#0f3d3e]" />
              <span>سجل الخدمات السابقة لهذه السنة ({selectedToothSessions.length})</span>
            </h4>

            {selectedToothSessions.length === 0 ? (
              <p className="text-xs text-slate-500 italic bg-white p-4 rounded-2xl border border-dashed border-slate-300 text-center">
                لا توجد أية إجراءات أو حشوات مسجلة سابقاً على هذه السنة.
              </p>
            ) : (
              <div className="space-y-2">
                {selectedToothSessions.map(s => (
                  <div
                    key={s.id}
                    className="bg-white p-3.5 rounded-2xl border border-slate-200/90 flex items-center justify-between text-xs shadow-2xs"
                  >
                    <div>
                      <span className="font-black text-[#0f3d3e] font-tajawal text-sm">{s.type}</span>
                      <p className="text-slate-500 font-mono text-[11px] mt-0.5">التاريخ: {s.date}</p>
                    </div>

                    <div className="text-left font-mono dir-ltr">
                      <div className="font-black text-slate-900">{s.amount.toLocaleString()} ج.م</div>
                      <div className={s.remain > 0 ? 'text-rose-600 font-bold text-[11px]' : 'text-emerald-600 font-bold text-[11px]'}>
                        {s.remain > 0 ? `متبقي ${s.remain} ج.م` : 'خالص السداد'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

