import React, { useState, useMemo, useDeferredValue, useEffect } from 'react';
import { 
  Search, 
  UserPlus, 
  Edit3, 
  MessageCircle, 
  Trash2, 
  Phone, 
  X, 
  MoreVertical, 
  Calendar, 
  DollarSign, 
  Activity, 
  PhoneCall, 
  FileText, 
  Plus,
  Copy,
  Microscope,
  CreditCard,
  SlidersHorizontal,
  ChevronDown
} from 'lucide-react';
import { Patient, NavigationOrigin, Appointment, LabCase, User } from '../../types';
import { useToastAndConfirm } from '../common/ToastAndConfirm';
import { EmptyState } from '../common/EmptyState';
import { getPatientFinancialSummary } from '../../utils/financials';
import { cleanEgyptianPhone, getWhatsAppUrl as buildWhatsAppUrl } from '../../utils/whatsappUtils';
import { appointmentTimeMinutes, findAppointmentConflicts, isValidAppointmentDate } from '../appointments/appointmentScheduling';
import { normalizeDirectoryDigits, getPatientMatchScore, sortDirectoryPatients, type PatientDirectorySort } from '../../utils/patientDirectory';
import './patientDirectory.css';

const clinicToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const normalizeDigits = normalizeDirectoryDigits;

interface PatientsViewProps {
  patients: Patient[];
  appointments?: Appointment[];
  labCases?: LabCase[];
  isPrivacyMode?: boolean;
  currentUser?: User | null;
  onSelectPatient: (patientId: string, origin: NavigationOrigin) => void;
  onSavePatient: (patientData: Omit<Patient, 'sessions' | 'payments'>) => void;
  onDeletePatient: (patientId: string) => void;
  onSaveAppointment?: (appt: Omit<Appointment, 'id'> & { id?: string }) => void;
  onBackToHome: () => void;
}

type FilterChip = 'all' | 'todayAppt' | 'ongoing' | 'debt' | 'allergy' | 'lab' | 'noAppt';

// Utility for highlighting matching search substrings
const highlightText = (text: string, query: string) => {
  if (!query || !query.trim() || !text) return text;
  const q = normalizeDigits(query.trim().replace(/^#\s*/, '')).toLowerCase();
  const lower = normalizeDigits(text).toLowerCase();
  const index = lower.indexOf(q);
  if (index === -1) return text;

  const before = text.substring(0, index);
  const match = text.substring(index, index + q.length);
  const after = text.substring(index + q.length);

  return (
    <>
      {before}
      <mark className="bg-amber-200/90 text-amber-950 font-black rounded px-0.5 py-0 leading-none">
        {match}
      </mark>
      {after}
    </>
  );
};

export const PatientsView: React.FC<PatientsViewProps> = React.memo(({
  patients,
  appointments = [],
  labCases = [],
  isPrivacyMode = true,
  currentUser,
  onSelectPatient,
  onSavePatient,
  onDeletePatient,
  onSaveAppointment
}) => {
  const { showToast, askConfirm, validationFail } = useToastAndConfirm();
  const canViewRemainingBalance = !currentUser || Boolean(currentUser.permissions.viewRemainingBalance ?? currentUser.permissions.patientFinance);
  
  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [activeFilter, setActiveFilter] = useState<FilterChip>('all');
  const [sortOrder, setSortOrder] = useState<PatientDirectorySort>('fileDesc');
  const showAmounts = !isPrivacyMode && canViewRemainingBalance;
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  useEffect(() => { if (!canViewRemainingBalance && activeFilter === 'debt') setActiveFilter('all'); }, [canViewRemainingBalance, activeFilter]);

  // Modals & Bottom Sheets State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPatient, setEditingPatient] = useState<Patient | null>(null);

  // Progressive list rendering / Virtualization state for smooth 60FPS scrolling
  const [visibleCount, setVisibleCount] = useState(30);

  useEffect(() => {
    setVisibleCount(30);
  }, [deferredSearchQuery, activeFilter, sortOrder]);

  // Options Bottom Sheet State
  const [activeBottomSheetPatient, setActiveBottomSheetPatient] = useState<Patient | null>(null);

  // Quick Appointment Modal State
  const [quickApptPatient, setQuickApptPatient] = useState<Patient | null>(null);
  const [quickApptDate, setQuickApptDate] = useState<string>(clinicToday());
  const [quickApptTime, setQuickApptTime] = useState<string>('10:00');
  const [quickApptService, setQuickApptService] = useState<string>('كشف واستشارة أسنان');

  // Lock body scroll when modals or bottom sheet are open
  useEffect(() => {
    if (isModalOpen || activeBottomSheetPatient || quickApptPatient) {
      document.body.classList.add('modal-open');
    } else {
      document.body.classList.remove('modal-open');
    }
    return () => {
      document.body.classList.remove('modal-open');
    };
  }, [isModalOpen, activeBottomSheetPatient, quickApptPatient]);

  // Form State for Add / Edit Patient
  const [fileNo, setFileNo] = useState('');
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [age, setAge] = useState<number | ''>('');
  const [allergy, setAllergy] = useState('');
  const [showMedicalField, setShowMedicalField] = useState(false);
  const [notes, setNotes] = useState('');

  // Auto suggest next file number
  const getNextFileNo = () => {
    const numericIds = patients
      .map(p => {
        const match = normalizeDigits(p.id).match(/^\d+$/);
        return match ? parseInt(match[0], 10) : NaN;
      })
      .filter(n => !isNaN(n));
    if (numericIds.length === 0) return '101';
    return (Math.max(...numericIds) + 1).toString();
  };

  const handleOpenAddModal = () => {
    setEditingPatient(null);
    setFileNo(getNextFileNo());
    setName('');
    setMobile('');
    setAge('');
    setAllergy('');
    setShowMedicalField(false);
    setNotes('');
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (p: Patient, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setActiveBottomSheetPatient(null);
    setEditingPatient(p);
    setFileNo(p.id);
    setName(p.name);
    setMobile(p.mobile);
    setAge(p.age);
    setAllergy(p.allergy || '');
    setShowMedicalField(false);
    setNotes(p.notes || '');
    setIsModalOpen(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();

    if (!fileNo.trim()) {
      validationFail('patientModal', 'input-fileNo', 'يرجى إدخال رقم الملف');
      return;
    }

    if (!name.trim()) {
      validationFail('patientModal', 'input-name', 'يرجى إدخال اسم المريض الثلاثي');
      return;
    }

    const savedFileNo = editingPatient?.id || normalizeDigits(fileNo.trim());
    const isDuplicate = patients.some(
      p => normalizeDigits(p.id.trim()) === normalizeDigits(savedFileNo) && (!editingPatient || editingPatient.id !== p.id)
    );
    if (isDuplicate) {
      validationFail('patientModal', 'input-fileNo', `رقم الملف (${savedFileNo}) مستخدم بالفعل لحالة أخرى`);
      return;
    }

    const normalizedPhone = cleanEgyptianPhone(mobile);
    const savedMobile = normalizedPhone.startsWith('20') ? `0${normalizedPhone.slice(2)}` : normalizedPhone;
    if (mobile.trim() && !/^01[0125]\d{8}$/.test(savedMobile)) {
      validationFail('patientModal', 'input-mobile', 'رقم الموبايل يجب أن يتكون من 11 رقمًا ويبدأ بـ 01 (مثل 01012345678)');
      return;
    }

    const parsedAge = typeof age === 'number' ? age : parseInt(age as string, 10);
    if (!Number.isInteger(parsedAge) || parsedAge < 0 || parsedAge > 120) {
      validationFail('patientModal', 'input-age', 'يرجى إدخال سن صحيح (بين 0 و 120)');
      return;
    }

    const todayStr = clinicToday();

    onSavePatient({
      id: savedFileNo,
      name: name.trim(),
      mobile: savedMobile,
      age: parsedAge,
      gender: editingPatient?.gender,
      firstVisit: editingPatient ? editingPatient.firstVisit : todayStr,
      allergy: allergy.trim(),
      notes: notes.trim()
    });

    setIsModalOpen(false);
    showToast(editingPatient ? 'تم تحديث بيانات الحالة بنجاح' : 'تم حفظ الحالة والدخول للملف مباشرة', 'success');
    onSelectPatient(savedFileNo, 'patients');
  };

  const handleDelete = (p: Patient, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setActiveBottomSheetPatient(null);
    askConfirm({
      title: 'حذف ملف الحالة',
      message: `هل أنت متأكد من حذف ملف المريض (${p.name}) رقم (${p.id}) بكل جلساته ومدفوعاته؟ لن يتم إعادة ترقيم باقي الملفات.`,
      confirmLabel: 'حذف الملف',
      tone: 'danger',
      onConfirm: () => {
        try { onDeletePatient(p.id); } catch (error) {
          showToast(error instanceof Error ? error.message : 'تعذر حذف الملف.', 'warning');
          return;
        }
        showToast(`تم حذف ملف المريض ${p.name}`, 'warning');
      }
    });
  };

  const getWhatsAppUrl = (mobileNum: string, patientName: string) => {
    return buildWhatsAppUrl(mobileNum, `أهلاً ${patientName}، نتواصل معك من عيادة الأسنان لمتابعة حالتك. نتمنى لك دوام الصحة والعافية.`);
  };

  const handleCopyPhone = async (mobileNum: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!mobileNum) return;
    try {
      await navigator.clipboard.writeText(mobileNum);
      showToast(`تم نسخ رقم الهاتف (${mobileNum})`, 'info');
    } catch {
      showToast('تعذر نسخ رقم الهاتف. يمكنك نسخه من ملف المريض.', 'warning');
    }
  };

  const handleSaveQuickAppt = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickApptPatient || !onSaveAppointment) return;
    if (!isValidAppointmentDate(quickApptDate) || appointmentTimeMinutes(quickApptTime) === null) {
      showToast('حدد تاريخًا ووقتًا صحيحين للموعد', 'warning');
      return;
    }

    const appointment: Omit<Appointment, 'id'> = {
      patientId: quickApptPatient.id,
      fileNo: quickApptPatient.id,
      patientName: quickApptPatient.name,
      mobile: quickApptPatient.mobile,
      date: quickApptDate,
      time: quickApptTime,
      durationMinutes: 30,
      appointmentType: quickApptService,
      status: 'scheduled',
      note: 'حجز سريع من فهرس المرضى',
      isFollowUp: false,
      isWalkIn: false
    };

    const saveAppointment = () => {
      try {
        onSaveAppointment(appointment);
        showToast(`تم حجز موعد للمريض (${quickApptPatient.name}) بتاريخ ${quickApptDate}`, 'success');
        setQuickApptPatient(null);
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'تعذّر حفظ الموعد. راجع البيانات وحاول مرة أخرى.', 'error');
      }
    };
    if (findAppointmentConflicts(appointments, quickApptDate, quickApptTime).length) {
      askConfirm({ title: 'موعد متعارض', message: 'يتداخل وقت الحجز مع موعد آخر مسجل. هل تريد تأكيد الحجز رغم التعارض؟', confirmLabel: 'تأكيد الحجز', tone: 'warning', onConfirm: saveAppointment });
    } else saveAppointment();
  };

  const todayStr = clinicToday();

  // Compute summaries once per update instead of repeatedly scanning 400+ files.
  const patientMetrics = useMemo(() => {
    const todayPatients = new Set(appointments.filter(a => a.date === todayStr && !['cancelled', 'no_show', 'apologized'].includes(a.status)).flatMap(a => [a.patientId, a.fileNo].filter(Boolean)));
    const labPatients = new Set(labCases.filter(c => c.status !== 'completed').map(c => c.patientId));
    return new Map(patients.map(p => {
      const financial = getPatientFinancialSummary(p);
      const totalRequired = Math.max(0, financial.totalRequired - financial.totalDiscounts);
      const totalPaid = financial.totalCollected;
      const totalRemain = financial.totalRemaining;
      const hasAllergy = Boolean(p.allergy && p.allergy.trim());
      const hasTodayAppointment = todayPatients.has(p.id);
      const hasIncompleteTreatment = p.sessions ? p.sessions.some(s => s.visitStatus === 'follow_up' || (s.treatmentStage && s.treatmentStage !== 'single')) : false;
      const hasLabCase = labPatients.has(p.id);
      const lastSessionDate = (p.sessions || []).map(session => session.date).filter(Boolean).sort().at(-1);

      return [p.id, {
        totalRequired,
        totalPaid,
        totalRemain,
        hasAllergy,
        hasTodayAppointment,
        hasIncompleteTreatment,
        hasLabCase,
        lastSessionDate,
        sessionCount: p.sessions?.length || 0
      }] as const;
    }));
  }, [patients, appointments, labCases, todayStr]);
  const getPatientMetrics = (p: Patient) => patientMetrics.get(p.id)!;

  // Compute dynamic counters for all filter chips
  const filterCounts = useMemo(() => {
    let todayAppt = 0;
    let ongoing = 0;
    let debt = 0;
    let allergy = 0;
    let lab = 0;
    let noAppt = 0;

    patients.forEach(p => {
      const m = getPatientMetrics(p);
      if (m.hasTodayAppointment) todayAppt++;
      else noAppt++;

      if (m.hasIncompleteTreatment) ongoing++;
      if (m.totalRemain > 0) debt++;
      if (m.hasAllergy) allergy++;
      if (m.hasLabCase) lab++;
    });

    return {
      all: patients.length,
      todayAppt,
      ongoing,
      debt,
      allergy,
      lab,
      noAppt
    };
  }, [patients, patientMetrics]);

  // Filtered and ranked patients with debounced search & filter chip support
  const filteredPatients = useMemo(() => {
    const q = deferredSearchQuery.trim();

    const matchingPatients = patients
      .filter(p => {
        const metrics = getPatientMetrics(p);
        if (activeFilter === 'todayAppt' && !metrics.hasTodayAppointment) return false;
        if (activeFilter === 'ongoing' && !metrics.hasIncompleteTreatment) return false;
        if (activeFilter === 'debt' && canViewRemainingBalance && metrics.totalRemain <= 0) return false;
        if (activeFilter === 'allergy' && !metrics.hasAllergy) return false;
        if (activeFilter === 'lab' && !metrics.hasLabCase) return false;
        if (activeFilter === 'noAppt' && metrics.hasTodayAppointment) return false;

        return true;
      })
      .filter(p => getPatientMatchScore(p, q) > 0);
    return sortDirectoryPatients(matchingPatients, q, sortOrder);
  }, [patients, deferredSearchQuery, activeFilter, patientMetrics, canViewRemainingBalance, sortOrder]);

  const isDoctor = currentUser?.role === 'doctor' || !currentUser?.role;
  const canEditPatient = !currentUser || currentUser.permissions.patientEdit === true;
  const canBookAppointment = Boolean(onSaveAppointment) && (!currentUser || currentUser.permissions.appointments === true);
  const canDeletePatient = currentUser ? currentUser.permissions?.deletePatients === true : isDoctor;
  const openQuickAppointment = (patient: Patient) => {
    setActiveBottomSheetPatient(null);
    setQuickApptDate(clinicToday());
    setQuickApptTime('10:00');
    setQuickApptService('كشف واستشارة أسنان');
    setQuickApptPatient(patient);
  };
  const primaryFilters: { id: FilterChip; label: string; icon?: React.ReactNode }[] = [
    { id: 'all', label: 'الكل' },
    { id: 'todayAppt', label: 'مواعيد اليوم', icon: <Calendar /> }
  ];
  const extraFilters: { id: FilterChip; label: string; icon: React.ReactNode }[] = [
    { id: 'ongoing', label: 'علاج جارٍ', icon: <Activity /> },
    { id: 'debt', label: 'رصيد متبقٍ', icon: <DollarSign /> },
    { id: 'lab', label: 'تركيبات', icon: <Microscope /> },
    { id: 'noAppt', label: 'بدون موعد اليوم', icon: <Calendar /> },
    { id: 'allergy', label: 'معلومات طبية مسجّلة', icon: <FileText /> }
  ];
  const renderFilter = (filter: { id: FilterChip; label: string; icon?: React.ReactNode }) => (
    <button key={filter.id} type="button" onClick={() => setActiveFilter(filter.id)}
      aria-pressed={activeFilter === filter.id}
      className={'patients-filter' + (activeFilter === filter.id ? ' patients-filter--active' : '')}>
      {filter.icon}<span>{filter.label}</span><span className="patients-filter-count">{filterCounts[filter.id]}</span>
    </button>
  );

  return (
    <div
      className="patients-directory max-w-7xl mx-auto font-['Cairo',sans-serif] dir-rtl"
    >
      <header className="patients-page-header">
        <div className="patients-page-heading">
          <div>
            <h1>فهرس المرضى</h1>
            <p>{patients.length.toLocaleString('ar-EG')} ملف مسجّل في العيادة</p>
          </div>
        </div>
        <div className="patients-page-actions">
          {canEditPatient && <button type="button" onClick={handleOpenAddModal} className="patients-add-button"><UserPlus /><span>إضافة مريض</span></button>}
        </div>
      </header>

      <section className="patients-search-panel" aria-label="البحث في المرضى">
        <div className="patients-search-heading">
          <label htmlFor="patients-directory-search" className="patients-search-label">البحث في الملفات</label>
          <p id="patients-search-hint">بالاسم أو رقم الملف أو الهاتف</p>
        </div>
        <div className={'patients-search-control' + (isSearchFocused ? ' patients-search-control--focused' : '')}>
          <Search aria-hidden="true" className="patients-search-icon" />
          <input id="patients-directory-search" type="search" autoComplete="off"
            value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            onFocus={() => setIsSearchFocused(true)} onBlur={() => setIsSearchFocused(false)}
            placeholder="الاسم، رقم الملف، أو الهاتف"
            aria-describedby="patients-search-hint patients-search-results" />
          {searchQuery && <button type="button" onClick={() => setSearchQuery('')} className="patients-search-clear" aria-label="مسح البحث"><X /></button>}
        </div>
        <div className="patients-filter-toolbar">
          <div className="patients-filters-row" aria-label="الفلاتر الرئيسية">{primaryFilters.filter(filter => filter.id !== 'debt' || canViewRemainingBalance).map(renderFilter)}</div>
          <details className="patients-extra-filters">
          <summary><SlidersHorizontal /><span>فلاتر إضافية</span>
            {extraFilters.some(filter => filter.id === activeFilter) && <span className="patients-selected-filter">{extraFilters.find(filter => filter.id === activeFilter)?.label}</span>}
            <ChevronDown className="patients-extra-chevron" />
          </summary>
          <div className="patients-filters-row" aria-label="الفلاتر الإضافية">{extraFilters.filter(filter => filter.id !== 'debt' || canViewRemainingBalance).map(renderFilter)}</div>
          </details>
          {(searchQuery || activeFilter !== 'all') && <button type="button" onClick={() => { setSearchQuery(''); setActiveFilter('all'); }} className="patients-reset-button">مسح البحث والفلاتر</button>}
        </div>
      </section>

      <div className="patients-results-line">
        <p id="patients-search-results" role="status" aria-live="polite"><strong>{filteredPatients.length.toLocaleString('ar-EG')}</strong> {searchQuery || activeFilter !== 'all' ? 'ملف مطابق' : 'ملفات المرضى'}</p>
        <div className="patients-sort-control"><label htmlFor="patients-directory-sort">الترتيب</label>
          <select id="patients-directory-sort" value={sortOrder} onChange={e => setSortOrder(e.target.value as PatientDirectorySort)}>
            <option value="fileDesc">رقم الملف: الأكبر أولًا</option>
            <option value="fileAsc">رقم الملف: الأصغر أولًا</option>
            <option value="name">اسم المريض</option>
          </select>
        </div>
      </div>

      <section className="patients-list" aria-label="قائمة المرضى">
        {filteredPatients.length === 0 ? (
          <EmptyState
            message={searchQuery || activeFilter !== 'all' ? 'لا يوجد مرضى مطابقون للبحث' : 'لا توجد ملفات مرضى بعد'}
            description={searchQuery || activeFilter !== 'all' ? 'جرّب اسمًا أو رقم ملف أو هاتفًا مختلفًا، أو امسح الفلاتر.' : 'أضف أول مريض لبدء تنظيم ملفات العيادة.'}
            ctaLabel={searchQuery || activeFilter !== 'all' ? 'مسح البحث والفلاتر' : canEditPatient ? 'إضافة مريض' : undefined}
            onCtaClick={searchQuery || activeFilter !== 'all' ? () => { setSearchQuery(''); setActiveFilter('all'); } : canEditPatient ? handleOpenAddModal : undefined}
          />
        ) : (
          <>
            <div className="patients-list-body">
              {filteredPatients.slice(0, visibleCount).map(p => {
                const metrics = getPatientMetrics(p);
                return (
                  <article key={p.id} className="patient-directory-row" aria-labelledby={'patient-name-' + p.id}>
                    <button type="button" className="patient-card-open" onClick={() => onSelectPatient(p.id, 'patients')} aria-label={'فتح ملف ' + p.name + '، رقم ' + p.id} />
                    <div className="patient-row-identity">
                      <span className="patient-file-number"><span className="patient-file-number-label">ملف</span><b dir="ltr">{highlightText(p.id, searchQuery)}</b></span>
                      <div className="patient-row-name-group"><h2 id={'patient-name-' + p.id} className="patient-row-name">{highlightText(p.name, searchQuery)}</h2><span className="patient-row-age">{p.age} سنة</span></div>
                    </div>
                    <div className="patient-row-details"><div className="patient-row-contact">
                      {p.mobile ? <a href={'tel:' + p.mobile} dir="ltr" onClick={e => e.stopPropagation()} aria-label={'الاتصال بـ ' + p.name} className="patient-row-phone"><Phone />{highlightText(p.mobile, searchQuery)}</a> : <span className="patient-row-muted">بدون رقم هاتف</span>}
                    </div>
                    <div className="patient-row-visit"><div><span className="patient-row-mobile-label">{metrics.lastSessionDate ? 'آخر جلسة' : 'أول زيارة'}</span><time dateTime={metrics.lastSessionDate || p.firstVisit || undefined} dir="ltr">{metrics.lastSessionDate || p.firstVisit || 'غير مسجّلة'}</time></div><span className="patient-row-session-count">{metrics.sessionCount ? `${metrics.sessionCount.toLocaleString('ar-EG')} جلسة مسجّلة` : 'لا توجد جلسات بعد'}</span></div></div>
                    <div className="patient-row-status">
                      {metrics.hasTodayAppointment && <span className="patient-status patient-status--today"><Calendar />موعد اليوم</span>}
                      {metrics.hasIncompleteTreatment && <span className="patient-status">علاج جارٍ</span>}
                      {metrics.hasLabCase && <span className="patient-status">تركيبات</span>}
                      {canViewRemainingBalance && metrics.totalRemain > 0 && <span className="patient-status patient-status--balance">{showAmounts ? 'متبقٍ ' + metrics.totalRemain.toLocaleString('ar-EG') + ' ج.م' : 'رصيد متبقٍ'}</span>}
                      {metrics.hasAllergy && <span className="patient-status patient-status--medical" title="توجد معلومات طبية مسجّلة داخل الملف"><FileText />ملاحظة طبية</span>}
                    </div>
                    <button type="button" onClick={e => { e.stopPropagation(); setActiveBottomSheetPatient(p); }} className="patients-icon-button patient-row-options" aria-label={'خيارات ملف ' + p.name}><MoreVertical /></button>
                  </article>
                );
              })}
            </div>
            {visibleCount < filteredPatients.length && <div className="patients-show-more"><button type="button" onClick={() => setVisibleCount(prev => prev + 30)} className="patients-secondary-button">عرض المزيد ({filteredPatients.length - visibleCount} مريض)</button></div>}
          </>
        )}
      </section>

      {/* 5. Touch Options Bottom Sheet (قائمة الخيارات السريعة للمريض) */}
      {activeBottomSheetPatient && (
        <>
          <div 
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 animate-fadeIn transition-opacity cursor-pointer"
            onClick={() => setActiveBottomSheetPatient(null)}
          />

          <div className="clinic-modal-sheet fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-3xl shadow-2xl border-t border-slate-200/90 p-4 sm:p-5 max-w-lg mx-auto animate-slideUp font-cairo dir-rtl max-h-[90dvh] overflow-y-auto pb-[max(1.25rem,env(safe-area-inset-bottom))] space-y-3">
            {/* Drag Handle & Patient Header */}
            <div className="relative pb-2 border-b border-slate-100">
              <div className="w-12 h-1 bg-slate-200 rounded-full mx-auto mb-3" />
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-black text-base sm:text-lg text-slate-900 font-tajawal">
                      {activeBottomSheetPatient.name}
                    </h3>
                    <span className="px-2 py-0.5 bg-purple-100 text-purple-800 font-mono font-bold text-xs rounded-md border border-purple-200">
                      #{activeBottomSheetPatient.id}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 font-medium mt-0.5">
                    {activeBottomSheetPatient.mobile || 'بدون رقم هاتف'} • {activeBottomSheetPatient.age} سنة
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setActiveBottomSheetPatient(null)}
                  className="w-8.5 h-8.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center transition-all active:scale-95 shrink-0 min-h-[44px] sm:min-h-0 cursor-pointer"
                  title="إغلاق"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Bottom Sheet Actions List */}
            <div className="space-y-1.5 pt-1">
              {/* 1. Open Patient File */}
              <button
                type="button"
                onClick={() => {
                  const id = activeBottomSheetPatient.id;
                  setActiveBottomSheetPatient(null);
                  onSelectPatient(id, 'patients');
                }}
                className="w-full text-right p-3 rounded-2xl bg-slate-50 hover:bg-purple-50 text-slate-900 hover:text-purple-900 flex items-center gap-3 transition-colors cursor-pointer font-bold text-xs sm:text-sm font-tajawal min-h-[48px] active:scale-[0.99] border border-slate-200/60"
              >
                <div className="w-9 h-9 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center shrink-0">
                  <FileText className="w-4.5 h-4.5" />
                </div>
                <span>فتح الملف الطبي الكامل</span>
              </button>

              {/* 2. Edit Patient Info */}
              {canEditPatient && <button
                type="button"
                onClick={() => handleOpenEditModal(activeBottomSheetPatient)}
                className="w-full text-right p-3 rounded-2xl bg-slate-50 hover:bg-slate-100 text-slate-900 flex items-center gap-3 transition-colors cursor-pointer font-bold text-xs sm:text-sm font-tajawal min-h-[48px] active:scale-[0.99] border border-slate-200/60"
              >
                <div className="w-9 h-9 rounded-xl bg-slate-200 text-slate-700 flex items-center justify-center shrink-0">
                  <Edit3 className="w-4.5 h-4.5" />
                </div>
                <span>تعديل البيانات الأساسية</span>
              </button>}

              {/* 3. Book New Appointment */}
              {canBookAppointment && <button
                type="button"
                onClick={() => {
                  openQuickAppointment(activeBottomSheetPatient);
                }}
                className="w-full text-right p-3 rounded-2xl bg-slate-50 hover:bg-sky-50 text-slate-900 hover:text-sky-900 flex items-center gap-3 transition-colors cursor-pointer font-bold text-xs sm:text-sm font-tajawal min-h-[48px] active:scale-[0.99] border border-slate-200/60"
              >
                <div className="w-9 h-9 rounded-xl bg-sky-100 text-sky-700 flex items-center justify-center shrink-0">
                  <Calendar className="w-4.5 h-4.5" />
                </div>
                <span>حجز موعد جديد</span>
              </button>}

              {/* 4. Record Payment / Account */}
              <button
                type="button"
                onClick={() => {
                  const id = activeBottomSheetPatient.id;
                  setActiveBottomSheetPatient(null);
                  onSelectPatient(id, 'patients');
                }}
                className="w-full text-right p-3 rounded-2xl bg-slate-50 hover:bg-emerald-50 text-slate-900 hover:text-emerald-900 flex items-center gap-3 transition-colors cursor-pointer font-bold text-xs sm:text-sm font-tajawal min-h-[48px] active:scale-[0.99] border border-slate-200/60"
              >
                <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                  <CreditCard className="w-4.5 h-4.5" />
                </div>
                <span>فتح الملف لمراجعة الحساب</span>
              </button>

              {/* 5. Phone Call & WhatsApp options if mobile exists */}
              {activeBottomSheetPatient.mobile && (
                <>
                  <a
                    href={`tel:${activeBottomSheetPatient.mobile}`}
                    onClick={() => setActiveBottomSheetPatient(null)}
                    className="w-full text-right p-3 rounded-2xl bg-slate-50 hover:bg-blue-50 text-slate-900 hover:text-blue-900 flex items-center gap-3 transition-colors cursor-pointer font-bold text-xs sm:text-sm font-tajawal min-h-[48px] active:scale-[0.99] border border-slate-200/60"
                  >
                    <div className="w-9 h-9 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
                      <PhoneCall className="w-4.5 h-4.5" />
                    </div>
                    <span>اتصال هاتفي ({activeBottomSheetPatient.mobile})</span>
                  </a>

                  <a
                    href={getWhatsAppUrl(activeBottomSheetPatient.mobile, activeBottomSheetPatient.name)}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setActiveBottomSheetPatient(null)}
                    className="w-full text-right p-3 rounded-2xl bg-slate-50 hover:bg-emerald-50 text-slate-900 hover:text-emerald-900 flex items-center gap-3 transition-colors cursor-pointer font-bold text-xs sm:text-sm font-tajawal min-h-[48px] active:scale-[0.99] border border-slate-200/60"
                  >
                    <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                      <MessageCircle className="w-4.5 h-4.5" />
                    </div>
                    <span>مراسلة عبر واتساب</span>
                  </a>

                  <button
                    type="button"
                    onClick={() => {
                      handleCopyPhone(activeBottomSheetPatient.mobile);
                      setActiveBottomSheetPatient(null);
                    }}
                    className="w-full text-right p-3 rounded-2xl bg-slate-50 hover:bg-slate-100 text-slate-900 flex items-center gap-3 transition-colors cursor-pointer font-bold text-xs sm:text-sm font-tajawal min-h-[48px] active:scale-[0.99] border border-slate-200/60"
                  >
                    <div className="w-9 h-9 rounded-xl bg-slate-200 text-slate-700 flex items-center justify-center shrink-0">
                      <Copy className="w-4.5 h-4.5" />
                    </div>
                    <span>نسخ رقم الهاتف</span>
                  </button>
                </>
              )}

              {/* 6. Delete Patient (Only visible for doctor role) */}
              {canDeletePatient && (
                <button
                  type="button"
                  onClick={() => handleDelete(activeBottomSheetPatient)}
                  className="w-full text-right p-3 rounded-2xl bg-rose-50 hover:bg-rose-100 text-rose-700 flex items-center gap-3 transition-colors cursor-pointer font-bold text-xs sm:text-sm font-tajawal min-h-[48px] active:scale-[0.99] border border-rose-200/80 mt-2"
                >
                  <div className="w-9 h-9 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
                    <Trash2 className="w-4.5 h-4.5" />
                  </div>
                  <span>حذف ملف الحالة كلياً</span>
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {/* 6. Quick Appointment Modal */}
      {quickApptPatient && (
        <div className="clinic-modal-overlay fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-xs p-0 sm:p-4 animate-fadeIn" role="dialog" aria-modal="true" aria-labelledby="patient-quick-appointment-title">
          <div className="clinic-modal-panel bg-white rounded-t-3xl sm:rounded-3xl max-w-md w-full p-5 shadow-2xl border border-slate-200 space-y-4 relative font-cairo dir-rtl max-h-[90dvh] overflow-y-auto modal-scroll">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 id="patient-quick-appointment-title" className="font-black text-base text-slate-900 font-tajawal">
                  حجز موعد للمريض: {quickApptPatient.name}
                </h3>
                <span className="text-xs text-slate-500 font-medium">رقم الملف: #{quickApptPatient.id}</span>
              </div>
              <button
                type="button"
                onClick={() => setQuickApptPatient(null)}
                aria-label="إغلاق حجز الموعد"
                className="w-11 h-11 shrink-0 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveQuickAppt} className="space-y-3">
              <div>
                <label htmlFor="patient-quick-appointment-date" className="block text-sm font-bold text-slate-700 mb-1">تاريخ الموعد</label>
                <input
                  id="patient-quick-appointment-date"
                  type="date"
                  value={quickApptDate}
                  onChange={e => setQuickApptDate(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono font-bold"
                  required
                />
              </div>

              <div>
                <label htmlFor="patient-quick-appointment-time" className="block text-sm font-bold text-slate-700 mb-1">وقت الموعد</label>
                <input
                  id="patient-quick-appointment-time"
                  type="time"
                  value={quickApptTime}
                  onChange={e => setQuickApptTime(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono font-bold"
                  required
                />
              </div>

              <div>
                <label htmlFor="patient-quick-appointment-service" className="block text-sm font-bold text-slate-700 mb-1">نوع الإجراء أو الخدمة</label>
                <input
                  id="patient-quick-appointment-service"
                  type="text"
                  value={quickApptService}
                  onChange={e => setQuickApptService(e.target.value)}
                  placeholder="مثال: كشف، حشو، خلع، متابعة..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold"
                  required
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setQuickApptPatient(null)}
                  className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors cursor-pointer min-h-[44px]"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold shadow-md transition-all cursor-pointer min-h-[44px]"
                >
                  تأكيد الحجز
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 7. Patient Add/Edit Modal */}
      {isModalOpen && (
        <div className="clinic-modal-overlay fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-xs p-0 sm:p-4 animate-fadeIn">
          <div
            id="patientModal"
            className="clinic-modal-panel bg-white rounded-t-3xl sm:rounded-3xl max-w-lg w-full p-5 sm:p-6 shadow-2xl border border-slate-200 space-y-4 relative max-h-[92dvh] sm:max-h-[90dvh] overflow-y-auto modal-scroll font-cairo dir-rtl"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h2 className="text-base sm:text-lg font-black text-purple-950 font-tajawal">
                {editingPatient ? `تعديل ملف المريض #${editingPatient.id}` : 'إضافة مريض'}
              </h2>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-colors cursor-pointer min-h-[44px]"
              >
                إلغاء وإغلاق
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    رقم الملف الورقي <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="input-fileNo"
                    type="text"
                    readOnly={Boolean(editingPatient)}
                    inputMode="numeric"
                    value={fileNo}
                    onChange={e => setFileNo(e.target.value)}
                    placeholder="مثال: 106"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono font-bold focus:outline-none focus:border-purple-600 focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    تاريخ الدخول
                  </label>
                  <input
                    type="text"
                    disabled
                    value={editingPatient ? editingPatient.firstVisit : clinicToday()}
                    className="w-full px-3.5 py-2.5 bg-slate-100 border border-slate-200 rounded-xl text-xs font-mono font-bold text-slate-500 cursor-not-allowed"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  الاسم الثلاثي للمريض <span className="text-rose-500">*</span>
                </label>
                <input
                  id="input-name"
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="مثال: أحمد عبد الله محمود"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs sm:text-sm font-bold focus:outline-none focus:border-purple-600 focus:bg-white"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    رقم الموبايل (مصر)
                  </label>
                  <input
                    id="input-mobile"
                    type="tel"
                    value={mobile}
                    onChange={e => setMobile(e.target.value)}
                    placeholder="01012345678"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono font-bold focus:outline-none focus:border-purple-600 focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    السن (بالسنوات) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="input-age"
                    type="number"
                    min="0"
                    max="120"
                    step="1"
                    value={age}
                    onChange={e => setAge(e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="مثال: 32"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono font-bold focus:outline-none focus:border-purple-600 focus:bg-white"
                  />
                </div>
              </div>

              <div className="optional-medical-field">
                <button type="button" onClick={() => setShowMedicalField(value => !value)} aria-expanded={showMedicalField} aria-controls="patient-optional-medical-field" className="optional-medical-trigger">
                  <Plus aria-hidden="true" /><span>{allergy.trim() ? 'عرض أو تعديل المعلومة الطبية المسجّلة' : 'إضافة حساسية أو ملاحظة طبية'}</span><small>اختياري</small><ChevronDown aria-hidden="true" />
                </button>
                {!showMedicalField && allergy.trim() && <p className="optional-medical-saved">توجد معلومة طبية محفوظة في الملف.</p>}
                {showMedicalField && <div id="patient-optional-medical-field" className="optional-medical-content">
                  <label htmlFor="input-allergy">الحساسية أو الملاحظة الطبية</label>
                  <textarea id="input-allergy" value={allergy} onChange={e => setAllergy(e.target.value)} rows={2}
                    placeholder="اكتب المعلومة التي تحتاج مراعاتها أثناء العلاج" />
                  <button type="button" onClick={() => setShowMedicalField(false)} className="optional-medical-hide">إخفاء الحقل</button>
                </div>}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  ملاحظات عامة عن الحالة
                </label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={2}
                  placeholder="أكتب أي ملاحظات إضافية يفضل تذكرها..."
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs sm:text-sm font-medium focus:outline-none focus:border-purple-600 focus:bg-white"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors cursor-pointer min-h-[44px]"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-purple-700 hover:bg-purple-800 text-white text-xs font-bold shadow-md shadow-purple-900/20 transition-all cursor-pointer min-h-[44px]"
                >
                  {editingPatient ? 'حفظ التعديلات' : 'إنشاء الملف'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
});

PatientsView.displayName = 'PatientsView';
