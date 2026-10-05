import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  Search, Users, Calendar, Microscope, DollarSign, X, ArrowLeft, 
  ChevronLeft, FileText, Phone, Clock, ShieldAlert
} from 'lucide-react';
import { Patient, Appointment, LabCase, Expense, ActiveView, NavigationOrigin } from '../../types';
import { getPatientFinancialSummary } from '../../utils/financials';

interface GlobalSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  patients: Patient[];
  appointments: Appointment[];
  labCases: LabCase[];
  expenses: Expense[];
  showFinancials?: boolean;
  showLabCosts?: boolean;
  onSelectPatient: (patientId: string, origin: NavigationOrigin) => void;
  onNavigate: (view: ActiveView) => void;
}

// Utility for highlighting matching search substrings
const highlightText = (text: string, query: string) => {
  if (!query || !query.trim() || !text) return text;
  const q = query.trim().toLowerCase();
  const lower = text.toLowerCase();
  const index = lower.indexOf(q);
  if (index === -1) return text;

  const before = text.substring(0, index);
  const match = text.substring(index, index + q.length);
  const after = text.substring(index + q.length);

  return (
    <>
      {before}
      <mark className="bg-amber-200 text-amber-950 font-black rounded px-0.5 py-0 leading-none">
        {match}
      </mark>
      {after}
    </>
  );
};

// Calculate match score for ranking search results
const getPatientScore = (patient: Patient, q: string): number => {
  if (!q) return 0;
  const cleanQ = q.toLowerCase();
  const id = (patient.id || '').toLowerCase();
  const name = (patient.name || '').toLowerCase();
  const mobile = (patient.mobile || (patient as any).phone || '').replace(/\D/g, '');
  const cleanQMobile = cleanQ.replace(/\D/g, '');

  if (id === cleanQ) return 100;
  if (id.startsWith(cleanQ)) return 90;
  if (name === cleanQ) return 85;
  if (name.startsWith(cleanQ)) return 80;
  if (cleanQMobile && mobile === cleanQMobile) return 75;
  if (cleanQMobile && mobile.includes(cleanQMobile)) return 70;
  if (name.includes(cleanQ)) return 60;
  if (id.includes(cleanQ)) return 50;
  if (patient.notes && patient.notes.toLowerCase().includes(cleanQ)) return 30;

  return 0;
};

export const GlobalSearchModal: React.FC<GlobalSearchModalProps> = ({
  isOpen,
  onClose,
  patients,
  appointments,
  labCases,
  expenses,
  onSelectPatient,
  onNavigate,
  showFinancials = true,
  showLabCosts = false
}) => {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<'all' | 'patients' | 'appointments' | 'lab' | 'expenses'>('all');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      document.body.classList.add('modal-open');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      document.body.classList.remove('modal-open');
      setQuery('');
      setSelectedIndex(0);
    }
    return () => {
      document.body.classList.remove('modal-open');
    };
  }, [isOpen]);

  // Reset selected index when query or category changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query, category]);

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return { patients: [], appointments: [], labCases: [], expenses: [] };

    // Ranked & Filtered Patients
    const rankedPatients = patients
      .map(p => ({ patient: p, score: getPatientScore(p, q) }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(item => item.patient)
      .slice(0, 8);

    const filteredAppts = appointments.filter(
      a => a.patientName.toLowerCase().includes(q) ||
           a.fileNo.includes(q) ||
           a.date.includes(q) ||
           a.mobile.includes(q) ||
           (a.note && a.note.toLowerCase().includes(q))
    ).slice(0, 6);

    const filteredLab = labCases.filter(
      l => l.patientName.toLowerCase().includes(q) ||
           l.labName.toLowerCase().includes(q) ||
           l.type.toLowerCase().includes(q) ||
           l.fileNo.includes(q)
    ).slice(0, 6);

    const filteredExp = expenses.filter(
      e => e.title.toLowerCase().includes(q) ||
           e.amount.toString().includes(q) ||
           (e.note && e.note.toLowerCase().includes(q))
    ).slice(0, 6);

    return {
      patients: rankedPatients,
      appointments: filteredAppts,
      labCases: filteredLab,
      expenses: filteredExp
    };
  }, [query, patients, appointments, labCases, expenses]);

  // Flatten active result items for keyboard arrow navigation
  const activeResultsList = useMemo(() => {
    const list: Array<{ type: 'patient' | 'appt' | 'lab' | 'exp'; data: any }> = [];

    if (category === 'all' || category === 'patients') {
      searchResults.patients.forEach(p => list.push({ type: 'patient', data: p }));
    }
    if (category === 'all' || category === 'appointments') {
      searchResults.appointments.forEach(a => list.push({ type: 'appt', data: a }));
    }
    if (category === 'all' || category === 'lab') {
      searchResults.labCases.forEach(l => list.push({ type: 'lab', data: l }));
    }
    if (category === 'all' || category === 'expenses') {
      searchResults.expenses.forEach(e => list.push({ type: 'exp', data: e }));
    }

    return list;
  }, [searchResults, category]);

  // Keyboard Navigation Handler
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }

    if (activeResultsList.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev + 1) % activeResultsList.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev - 1 + activeResultsList.length) % activeResultsList.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const currentItem = activeResultsList[selectedIndex] || activeResultsList[0];
      if (!currentItem) return;

      if (currentItem.type === 'patient') {
        onSelectPatient(currentItem.data.id, 'patients');
        onClose();
      } else if (currentItem.type === 'appt') {
        onNavigate('appointments');
        onClose();
      } else if (currentItem.type === 'lab') {
        onNavigate('lab');
        onClose();
      } else if (currentItem.type === 'exp') {
        onNavigate('summary');
        onClose();
      }
    }
  };

  if (!isOpen) return null;

  const totalResults =
    searchResults.patients.length +
    searchResults.appointments.length +
    searchResults.labCases.length +
    searchResults.expenses.length;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-end sm:items-start justify-center bg-slate-900/60 backdrop-blur-xs p-0 sm:p-4 pt-0 sm:pt-16 animate-fadeIn"
      onClick={onClose}
    >
      <div
        id="globalSearchModal"
        className="bg-white rounded-t-3xl sm:rounded-3xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden font-tajawal flex flex-col max-h-[92dvh] sm:max-h-[85vh] dir-rtl transition-all"
        onClick={e => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Mobile Handle Bar Indicator */}
        <div className="sm:hidden flex justify-center pt-2.5 pb-1">
          <div className="w-10 h-1.5 rounded-full bg-slate-300" />
        </div>

        {/* Search Input Bar */}
        <div className="p-3.5 sm:p-4 border-b border-slate-100 flex items-center gap-3 bg-slate-50/90">
          <Search className="w-5 h-5 text-indigo-600 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="بحث بالاسم، رقم الهاتف، رقم الملف، موعد أو معمل..."
            className="w-full bg-transparent text-slate-900 placeholder:text-slate-400 text-base font-bold outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="p-2 rounded-full hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center"
              title="مسح النص"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2.5 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold transition-colors cursor-pointer shrink-0 flex items-center gap-1 min-h-[44px] active:scale-95 touch-manipulation"
          >
            إلغاء وإغلاق
          </button>
        </div>

        {/* Filter Pills */}
        <div className="p-2.5 bg-white border-b border-slate-100 flex items-center gap-1.5 overflow-x-auto text-xs font-bold">
          <button
            type="button"
            onClick={() => setCategory('all')}
            className={`px-3 py-1.5 rounded-xl transition-all cursor-pointer shrink-0 ${
              category === 'all' ? 'bg-indigo-600 text-white shadow-2xs' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            الكل ({totalResults})
          </button>
          <button
            type="button"
            onClick={() => setCategory('patients')}
            className={`px-3 py-1.5 rounded-xl transition-all cursor-pointer shrink-0 flex items-center gap-1.5 ${
              category === 'patients' ? 'bg-indigo-600 text-white shadow-2xs' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <Users className="w-3.5 h-3.5" /> المرضى ({searchResults.patients.length})
          </button>
          <button
            type="button"
            onClick={() => setCategory('appointments')}
            className={`px-3 py-1.5 rounded-xl transition-all cursor-pointer shrink-0 flex items-center gap-1.5 ${
              category === 'appointments' ? 'bg-indigo-600 text-white shadow-2xs' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <Calendar className="w-3.5 h-3.5" /> المواعيد ({searchResults.appointments.length})
          </button>
          <button
            type="button"
            onClick={() => setCategory('lab')}
            className={`px-3 py-1.5 rounded-xl transition-all cursor-pointer shrink-0 flex items-center gap-1.5 ${
              category === 'lab' ? 'bg-indigo-600 text-white shadow-2xs' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <Microscope className="w-3.5 h-3.5" /> المعمل ({searchResults.labCases.length})
          </button>
          <button
            type="button"
            onClick={() => setCategory('expenses')}
            className={`px-3 py-1.5 rounded-xl transition-all cursor-pointer shrink-0 flex items-center gap-1.5 ${
              category === 'expenses' ? 'bg-indigo-600 text-white shadow-2xs' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <DollarSign className="w-3.5 h-3.5" /> المصروفات ({searchResults.expenses.length})
          </button>
        </div>

        {/* Results Body */}
        <div className="p-3.5 sm:p-4 overflow-y-auto space-y-4 flex-1">
          {!query.trim() ? (
            <div className="py-6 space-y-6">
              <div className="text-center text-slate-400 space-y-2">
                <Search className="w-10 h-10 mx-auto text-indigo-500/80 stroke-1" />
                <p className="font-bold text-sm text-slate-700">اكتب للبحث السريع في كافة سجلات العيادة</p>
                <p className="text-xs text-slate-400">ابحث باسم المريض، رقم الهاتف، رقم الملف الورقي، أو تاريخ الموعد</p>
              </div>

              {/* Quick Jump Shortcuts */}
              <div className="border-t border-slate-100 pt-4">
                <p className="text-xs font-bold text-slate-400 mb-3 px-1">انتقال سريع إلى أقسام النظام:</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      onNavigate('patients');
                      onClose();
                    }}
                    className="p-3 rounded-2xl bg-indigo-50 hover:bg-indigo-100 border border-indigo-200/80 text-right text-indigo-900 transition-all cursor-pointer group"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Users className="w-4 h-4 text-indigo-600" />
                      <span className="font-extrabold text-xs">سجلات المرضى</span>
                    </div>
                    <span className="text-[10px] text-indigo-600 font-bold block">انتقال للفهرس (F2)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      onNavigate('home');
                      onClose();
                    }}
                    className="p-3 rounded-2xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-200/80 text-right text-emerald-900 transition-all cursor-pointer group"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <FileText className="w-4 h-4 text-emerald-600" />
                      <span className="font-extrabold text-xs">الرئيسية</span>
                    </div>
                    <span className="text-[10px] text-emerald-600 font-bold block">تسجيل وحضور اليوم</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      onNavigate('appointments');
                      onClose();
                    }}
                    className="p-3 rounded-2xl bg-amber-50 hover:bg-amber-100 border border-amber-200/80 text-right text-amber-900 transition-all cursor-pointer group"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Calendar className="w-4 h-4 text-amber-600" />
                      <span className="font-extrabold text-xs">جدول المواعيد</span>
                    </div>
                    <span className="text-[10px] text-amber-600 font-bold block">إدارة الأجندة والحجوزات</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      onNavigate('lab');
                      onClose();
                    }}
                    className="p-3 rounded-2xl bg-purple-50 hover:bg-purple-100 border border-purple-200/80 text-right text-purple-900 transition-all cursor-pointer group"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Microscope className="w-4 h-4 text-purple-600" />
                      <span className="font-extrabold text-xs">حالات المعمل</span>
                    </div>
                    <span className="text-[10px] text-purple-600 font-bold block">التركيبات والموردين</span>
                  </button>
                </div>
              </div>
            </div>
          ) : totalResults === 0 ? (
            <div className="py-12 text-center text-slate-500 space-y-2">
              <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
                <Users className="w-6 h-6 stroke-1.5" />
              </div>
              <p className="font-bold text-base text-slate-800">لا توجد نتائج مطابقة لـ "{query}"</p>
              <p className="text-xs text-slate-400">تأكد من كتابة الكلمة بشكل صحيح أو جرب البحث برقم الموبايل أو رقم الملف</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* PATIENTS GROUP WITH MODERN CLICKABLE CARDS */}
              {(category === 'all' || category === 'patients') && searchResults.patients.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between px-1">
                    <div className="text-xs font-bold text-slate-500 flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5 text-indigo-600" />
                      نتائج المرضى ({searchResults.patients.length})
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        onNavigate('patients');
                        onClose();
                      }}
                      className="text-xs font-extrabold text-indigo-600 hover:text-indigo-800 hover:underline cursor-pointer flex items-center gap-1 active:scale-95 transition-all"
                    >
                      <span>الفهرس الكامل</span>
                      <ArrowLeft className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="grid gap-2">
                    {searchResults.patients.map((p, idx) => {
                      const globalIdx = activeResultsList.findIndex(
                        item => item.type === 'patient' && item.data.id === p.id
                      );
                      const isFocused = globalIdx === selectedIndex;

                      const financial = getPatientFinancialSummary(p);
                      const totalReq = Math.max(0, financial.totalRequired - financial.totalDiscounts);
                      const totalPaid = financial.totalCollected;
                      const remain = financial.totalRemaining;

                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            onSelectPatient(p.id, 'patients');
                            onClose();
                          }}
                          className={`w-full text-right p-3 sm:p-3.5 rounded-2xl transition-all duration-200 ease-out flex items-center justify-between gap-3 cursor-pointer group active:scale-[0.98] touch-manipulation ${
                            isFocused
                              ? 'bg-indigo-50/90 border-2 border-indigo-500 shadow-md translate-x-[-2px]'
                              : 'bg-white hover:bg-indigo-50/50 border border-slate-200/90 hover:border-indigo-300 shadow-2xs hover:shadow-md hover:-translate-y-0.5'
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            {/* File # Badge Avatar */}
                            <div className="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-800 font-mono font-black flex items-center justify-center text-xs shrink-0 group-hover:bg-indigo-600 group-hover:text-white transition-colors shadow-2xs">
                              #{p.id}
                            </div>

                            <div className="min-w-0 space-y-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-extrabold text-sm text-slate-900 group-hover:text-indigo-900 transition-colors">
                                  {highlightText(p.name, query)}
                                </span>
                                {p.allergy && (
                                  <span className="text-[10px] font-extrabold bg-rose-50 text-rose-700 px-1.5 py-0.5 rounded-md border border-rose-200/60 flex items-center gap-1">
                                    <ShieldAlert className="w-3 h-3 text-rose-600" />
                                    حساسية
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center gap-3 text-xs text-slate-500 font-medium flex-wrap">
                                <span className="flex items-center gap-1 font-mono dir-ltr">
                                  <Phone className="w-3 h-3 text-slate-400 shrink-0" />
                                  {highlightText(p.mobile || '—', query)}
                                </span>

                                {p.firstVisit && (
                                  <span className="flex items-center gap-1 text-[11px] text-slate-400">
                                    <Clock className="w-3 h-3 text-slate-400 shrink-0" />
                                    <span>زيارة: {p.firstVisit}</span>
                                  </span>
                                )}

                                {showFinancials && (remain > 0 ? (
                                  <span className="text-[10px] font-extrabold bg-rose-50 text-rose-700 px-2 py-0.5 rounded-md font-mono border border-rose-200/60">
                                    متبقي: {remain.toLocaleString()} ج.م
                                  </span>
                                ) : (
                                  <span className="text-[10px] font-bold bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-md font-mono border border-emerald-200/60">
                                    خالص الحساب
                                  </span>
                                ))}
                              </div>
                            </div>
                          </div>

                          {/* Chevron Icon for Click Indication */}
                          <div className="flex items-center text-slate-400 group-hover:text-indigo-600 transition-colors shrink-0">
                            <ChevronLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* APPOINTMENTS GROUP */}
              {(category === 'all' || category === 'appointments') && searchResults.appointments.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-bold text-slate-500 flex items-center gap-1.5 px-1">
                    <Calendar className="w-3.5 h-3.5 text-amber-600" />
                    نتائج المواعيد ({searchResults.appointments.length})
                  </div>
                  <div className="grid gap-2">
                    {searchResults.appointments.map(a => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => {
                          onNavigate('appointments');
                          onClose();
                        }}
                        className="w-full text-right p-3 rounded-2xl bg-amber-50/50 hover:bg-amber-100/70 border border-amber-200/60 hover:border-amber-300 transition-all flex items-center justify-between group cursor-pointer active:scale-[0.98]"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-extrabold text-sm text-slate-900">{highlightText(a.patientName, query)}</span>
                            <span className="text-[11px] px-2 py-0.5 rounded-md bg-amber-200/60 text-amber-900 font-bold font-mono">
                              {a.date} | {a.time}
                            </span>
                          </div>
                          <span className="text-xs text-slate-500 block mt-0.5">{a.note}</span>
                        </div>
                        <ChevronLeft className="w-5 h-5 text-amber-600 group-hover:-translate-x-1 transition-transform shrink-0" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* LAB CASES GROUP */}
              {(category === 'all' || category === 'lab') && searchResults.labCases.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-bold text-slate-500 flex items-center gap-1.5 px-1">
                    <Microscope className="w-3.5 h-3.5 text-purple-600" />
                    نتائج المعمل ({searchResults.labCases.length})
                  </div>
                  <div className="grid gap-2">
                    {searchResults.labCases.map(l => (
                      <button
                        key={l.id}
                        type="button"
                        onClick={() => {
                          onNavigate('lab');
                          onClose();
                        }}
                        className="w-full text-right p-3 rounded-2xl bg-purple-50/50 hover:bg-purple-100/70 border border-purple-200/60 hover:border-purple-300 transition-all flex items-center justify-between group cursor-pointer active:scale-[0.98]"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-extrabold text-sm text-slate-900">{highlightText(l.patientName, query)}</span>
                            <span className="text-[11px] px-2 py-0.5 rounded-md bg-purple-200/60 text-purple-900 font-bold">
                              {l.labName} - {l.type}
                            </span>
                          </div>
                          {showLabCosts && <span className="text-xs text-slate-500 block mt-0.5">إجمالي المعمل: {l.labTotal} ج.م</span>}
                        </div>
                        <ChevronLeft className="w-5 h-5 text-purple-600 group-hover:-translate-x-1 transition-transform shrink-0" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* EXPENSES GROUP */}
              {(category === 'all' || category === 'expenses') && searchResults.expenses.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-bold text-slate-500 flex items-center gap-1.5 px-1">
                    <DollarSign className="w-3.5 h-3.5 text-rose-600" />
                    المصروفات ({searchResults.expenses.length})
                  </div>
                  <div className="grid gap-2">
                    {searchResults.expenses.map(e => (
                      <button
                        key={e.id}
                        type="button"
                        onClick={() => {
                          onNavigate('summary');
                          onClose();
                        }}
                        className="w-full text-right p-3 rounded-2xl bg-slate-50 hover:bg-slate-100 border border-slate-200 transition-all flex items-center justify-between group cursor-pointer active:scale-[0.98]"
                      >
                        <div>
                          <span className="font-extrabold text-sm text-slate-900 block">{highlightText(e.title, query)}</span>
                          <span className="text-xs text-slate-500">{e.date} | {e.amount} ج.م</span>
                        </div>
                        <ChevronLeft className="w-5 h-5 text-slate-400 group-hover:-translate-x-1 transition-transform shrink-0" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Helper Bar */}
        <div className="p-3 bg-slate-100 border-t border-slate-200/80 flex items-center justify-between text-[11px] text-slate-500 font-bold">
          <span className="flex items-center gap-2">
            <span>↑↓ للتنقل</span>
            <span>|</span>
            <span>Enter لفتح الملف</span>
            <span>|</span>
            <span>Esc لإغلاق البحث</span>
          </span>
          <span className="text-indigo-600">نظام عيادة الأسنان المتقدم</span>
        </div>
      </div>
    </div>
  );
};
