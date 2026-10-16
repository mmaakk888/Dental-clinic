import React, { useCallback, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowDown, ArrowRight, Check, ChevronLeft, FileSearch, FolderHeart, FolderOpen, MessageCircle, Pencil, Phone, Plus, RefreshCw, Search, ShieldCheck, UserRound, X } from 'lucide-react';
import { normalizeContactPhone } from '../../utils/clinicContacts';
import { normalizeDirectoryDigits, normalizeDirectoryName } from '../../utils/patientDirectory';
import { getWhatsAppUrl } from '../../utils/whatsappUtils';
import type { CloudPatientProfile, CloudPatientRecord } from '../../utils/cloudPatientRepository';
import type { CloudPatientRegistrationCheck, CloudPatientWorkspaceController, CloudPatientWorkspaceDraft, CloudPatientWorkspaceState } from '../../utils/cloudPatientWorkspaceController';
import type { CloudProfileContactRecoveryController } from '../../utils/cloudProfileContactRecoveryController';
import CloudProfileContactRecoveryPanel from '../shared/CloudProfileContactRecoveryPanel';
import './CloudPatientsWorkspace.css';

const buttonClass = 'cpw-button';
const secondaryClass = `${buttonClass} cpw-button-secondary`;
const primaryClass = `${buttonClass} cpw-button-primary`;
const locked = (state: CloudPatientWorkspaceState) => state.loading || state.recoveryLoading || state.saveStatus !== 'idle' || Boolean(state.pendingOperationId);
const fileNumber = (value: number) => value.toLocaleString('ar-EG', { useGrouping: false });

export interface CloudPatientsWorkspaceViewProps {
  state: CloudPatientWorkspaceState;
  previewOnly?: boolean;
  closing?: boolean;
  loadedQuery: string;
  fileQuery: string;
  phoneQuery: string;
  ageQuery: string | null;
  onLoadedQueryChange: (value: string) => void;
  onFileQueryChange: (value: string) => void;
  onPhoneQueryChange: (value: string) => void;
  onAgeQueryChange: (value: string, expected: CloudPatientWorkspaceDraft) => void;
  onFindFile: (value: string) => void;
  onFindPhone: (value: string) => void;
  onClose: () => void;
  onCreate: () => void;
  onSelect: (record: CloudPatientRecord) => void;
  onEdit: (record: CloudPatientRecord) => void;
  onContact: (record: CloudPatientRecord) => boolean;
  /** Explicit selected-file seam. Absence means clinical opening is unavailable. */
  onOpenClinical?: (record: CloudPatientRecord) => void;
  onChangeDraft: (patch: Partial<CloudPatientProfile>, expected: CloudPatientWorkspaceDraft) => void;
  onSave: (expected: CloudPatientWorkspaceDraft) => void;
  onConfirmSeparate?: (check: Readonly<CloudPatientRegistrationCheck>, expected: CloudPatientWorkspaceDraft) => void;
  onCancel: (expected: CloudPatientWorkspaceDraft) => void;
  onRefresh: () => void;
  onLoadMore: () => void;
  recoveryController?: CloudProfileContactRecoveryController;
  onResume?: (operationId: string) => void;
  onCancelPending?: (expected: CloudPatientWorkspaceDraft) => void;
  recoveryCanAct?: () => boolean;
}

/** Profile-only presentation. Rendering never creates Auth, a repository or a read. */
export function CloudPatientsWorkspaceView(props: CloudPatientsWorkspaceViewProps) {
  const { state, previewOnly = false, closing = false } = props;
  const prefix = useId();
  const latest = useRef(props);
  latest.current = props;
  const unavailable = previewOnly || state.closed;
  const isLocked = locked(state) || closing;
  const disabled = unavailable || isLocked;
  const draft = unavailable ? null : state.draft;
  const registration = draft?.action === 'create' && state.registrationCheck?.draft === draft ? state.registrationCheck : null;
  const selected = unavailable || draft ? null : state.selected;
  const closeBlocked = closing || !previewOnly && !state.closed && (isLocked || Boolean(draft));
  const listDisabled = disabled || Boolean(draft);
  const query = normalizeDirectoryName(props.loadedQuery);
  const records = useMemo(() => unavailable ? [] : state.records, [state.records, unavailable]);
  const matches = useMemo(() => records.filter(record => normalizeDirectoryName(record.data.name).includes(query)), [records, query]);
  const retry = state.saveStatus === 'retry-required', refresh = state.saveStatus === 'refresh-required';
  const fileDigits = normalizeDirectoryDigits(props.fileQuery.trim());
  const invalidFile = !unavailable && Boolean(props.fileQuery.trim()) && (!/^[0-9]{1,10}$/.test(fileDigits) || Number(fileDigits) < 1 || Number(fileDigits) > 2_000_000_000);
  const ageText = draft ? props.ageQuery ?? String(draft.profile.age) : '';
  const ageDigits = normalizeDirectoryDigits(ageText);
  const invalidAge = Boolean(draft) && (!/^[0-9]{1,3}$/.test(ageDigits) || Number(ageDigits) > 120);
  const guard = (action: () => void, block = disabled) => { if (!block) action(); };
  const save = () => {
    if (!unavailable && !closing && !state.loading && !state.recoveryLoading && !['saving', 'preparing'].includes(state.saveStatus) && draft && !invalidAge) props.onSave(draft);
  };
  const context = unavailable || state.query.kind === 'all' ? 'صفحات الملفات المحمّلة'
    : state.query.kind === 'phone' ? 'نتائج البحث برقم الموبايل الكامل' : `نتيجة البحث عن ملف ${fileNumber(state.query.fileNo)}`;

  return <section className="cloud-patients-workspace" dir="rtl" aria-labelledby={`${prefix}-title`}>
    <header className="cpw-header cpw-surface">
      <div className="cpw-heading"><span className="cpw-heading-icon"><FolderOpen size={24} aria-hidden="true" /></span>
        <div><h2 id={`${prefix}-title`}>ملفات المرضى</h2><p>{props.onOpenClinical && !unavailable ? 'بيانات الملف والوصول إلى سجل الجلسات والتحصيل الكامل.' : 'بيانات الملف الأساسية — الجلسات والحسابات غير متاحة في هذا العرض.'}</p></div>
      </div>
      <div><button type="button" className={secondaryClass} disabled={closeBlocked} aria-describedby={closeBlocked ? `${prefix}-close-help` : undefined}
        onClick={() => { if (!closeBlocked) props.onClose(); }}><ArrowRight size={18} aria-hidden="true" />إلغاء وإغلاق</button>
        {closeBlocked && <p id={`${prefix}-close-help`} className="cpw-help cpw-close-help">{isLocked ? 'انتظر اكتمال التحقق من العملية قبل إغلاق الشاشة.' : 'ألغِ المسودة قبل إغلاق الشاشة.'}</p>}</div>
    </header>

    {previewOnly ? <div role="status" className="cpw-message cpw-warning"><strong>معاينة تصميم فقط — القراءة والحفظ غير مفعّلين</strong>
      شاشة فارغة لمراجعة الترتيب، بلا بيانات افتراضية أو حقيقية. لا تُحمّل الملفات ولا تُرسل عمليات حفظ.</div>
      : state.closed ? <p role="status" className="cpw-message">أُغلقت مساحة العمل. لا توجد ملفات معروضة أو عملية جديدة متاحة هنا.</p> : null}
    {!unavailable && (retry || refresh) && <div role="status" className="cpw-message cpw-warning"><strong>{refresh ? 'الحفظ مؤكّد — العرض يحتاج تحديثًا' : 'عملية الحفظ تحتاج تأكيدًا من الخادم'}</strong>
      {refresh ? 'إعادة التحقق تقرأ النتيجة فقط، دون إرسال عملية حفظ جديدة.' : 'قد تكون العملية وصلت بالفعل. أعد نفس المحاولة دون تغيير المسودة أو إنشاء ملف آخر.'}
      <p>العملية الأصلية محفوظة في سجل الاسترجاع بعد تأكيد التحضير. الخروج يمسح العرض فقط ولا يُلغي كتابة قبلها الخادم.</p>
      {state.pendingOperationId && <p className="cpw-operation-id">معرّف العملية: <bdi dir="ltr">{state.pendingOperationId}</bdi></p>}</div>}
    {!unavailable && state.error && <p role="alert" className="cpw-message cpw-error">{state.error}</p>}
    {!unavailable && state.notice && <p role="status" className="cpw-message cpw-info">{state.notice}</p>}

    <div className={`cpw-layout${draft || selected ? ' cpw-layout-detail' : ''}`}>
      <div className="cpw-list-column">
        <section className="cpw-surface cpw-search" aria-labelledby={`${prefix}-search-title`}>
          <div className="cpw-section-heading"><div><h3 id={`${prefix}-search-title`}>البحث والوصول للملف</h3><p className="cpw-help">افتح البطاقة مباشرة لقراءة أحدث بيانات الملف.</p></div>
            <button type="button" className={primaryClass} disabled={listDisabled} onClick={() => guard(props.onCreate, listDisabled)}><Plus size={18} aria-hidden="true" />ملف جديد</button></div>
          <div className="cpw-server-searches">
            <form onSubmit={event => { event.preventDefault(); if (!invalidFile) guard(() => props.onFindFile(props.fileQuery), listDisabled); }}>
              <label htmlFor={`${prefix}-file-search`}>رقم الملف — بحث في الخادم</label>
              <div className="cpw-input-action"><input id={`${prefix}-file-search`} className="cpw-input" type="text" inputMode="numeric" maxLength={10} value={previewOnly ? '' : props.fileQuery} placeholder="مثال: ٤٠١" disabled={listDisabled} aria-invalid={invalidFile || undefined} aria-describedby={invalidFile ? `${prefix}-file-error` : undefined}
                onChange={event => guard(() => props.onFileQueryChange(event.target.value), listDisabled)} /><button type="submit" className={secondaryClass} disabled={listDisabled || !props.fileQuery.trim()} aria-label="البحث برقم الملف"><FileSearch size={20} aria-hidden="true" /></button></div>
              {invalidFile && <p id={`${prefix}-file-error`} className="cpw-field-error" role="alert">اكتب رقم ملف صحيحًا من ١ إلى ٢٠٠٠٠٠٠٠٠٠، بدون حروف.</p>}
            </form>
            <form onSubmit={event => { event.preventDefault(); guard(() => props.onFindPhone(props.phoneQuery), listDisabled); }}>
              <label htmlFor={`${prefix}-phone-search`}>الموبايل الكامل — بحث في الخادم</label>
              <div className="cpw-input-action"><input id={`${prefix}-phone-search`} className="cpw-input" type="tel" inputMode="tel" dir="ltr" maxLength={60} value={previewOnly ? '' : props.phoneQuery} placeholder="010…" disabled={listDisabled}
                onChange={event => guard(() => props.onPhoneQueryChange(event.target.value), listDisabled)} /><button type="submit" className={secondaryClass} disabled={listDisabled || !props.phoneQuery.trim()} aria-label="البحث برقم الموبايل"><Search size={20} aria-hidden="true" /></button></div>
            </form>
          </div>
          <p className="cpw-help">البحث بالموبايل قد يعرض أكثر من ملف للأسرة؛ تشابه الرقم لا يثبت هوية المريض.</p>
          <label htmlFor={`${prefix}-loaded-search`}>تصفية الأسماء المحمّلة</label>
          <input id={`${prefix}-loaded-search`} className="cpw-input" type="search" inputMode="search" maxLength={200} value={previewOnly ? '' : props.loadedQuery} placeholder="اسم المريض في الصفحات المعروضة" disabled={listDisabled}
            onChange={event => guard(() => props.onLoadedQueryChange(event.target.value), listDisabled)} aria-describedby={`${prefix}-loaded-help`} />
          <p id={`${prefix}-loaded-help`} className="cpw-help">تصفية الأسماء تخص الصفحات المحمّلة فقط، وليست بحثًا شاملًا. العرض يحتفظ بآخر ٥٠٠ ملف محمّل.</p>
          <div className="cpw-section-heading cpw-list-toolbar"><div><h3>{context}</h3><p className="cpw-help">{records.length.toLocaleString('ar-EG')} ملفًا في هذا العرض — ليس إجمالي العيادة</p></div>
            <button type="button" className={secondaryClass} disabled={listDisabled} onClick={() => guard(props.onRefresh, listDisabled)}><RefreshCw size={17} aria-hidden="true" />{state.loaded && !unavailable ? 'عرض الملفات من البداية' : 'تحميل أول صفحة'}</button></div>
        </section>

        <div className="cpw-record-list" aria-busy={!unavailable && state.loading}>
          {!unavailable && state.loading && <p role="status" className="cpw-help">جارٍ قراءة البيانات من الخادم…</p>}
          {matches.map(record => <article key={record.recordId} className={`cpw-patient-card${selected?.recordId === record.recordId ? ' cpw-patient-selected' : ''}`}>
            <button type="button" className="cpw-patient-open" disabled={listDisabled} onClick={() => guard(() => props.onSelect(record), listDisabled)} aria-label={`فتح بيانات ملف ${record.fileNo} — ${record.data.name}`}>
              <span className="cpw-file-number"><small>ملف</small><b>{fileNumber(record.fileNo)}</b></span>
              <span className="cpw-patient-summary"><strong>{record.data.name}</strong><span className="cpw-patient-meta">{record.data.mobile ? <bdi dir="ltr">{record.data.mobile}</bdi> : <span>لا يوجد رقم موبايل</span>}<span>{record.data.age.toLocaleString('ar-EG')} سنة</span></span></span>
              <ChevronLeft className="cpw-card-chevron" size={20} aria-hidden="true" />
            </button>
          </article>)}
          {!matches.length && <div className="cpw-empty"><FolderOpen size={28} aria-hidden="true" /><p>{unavailable ? 'لا توجد بيانات في هذه المعاينة' : !state.loaded ? 'لم تُحمّل ملفات المرضى بعد' : query ? 'لا توجد أسماء مطابقة ضمن الملفات المحمّلة' : 'لا توجد نتائج في هذا العرض'}</p>
            <span>{unavailable ? 'هذه معاينة للشكل فقط، بلا سجلات افتراضية أو حقيقية.' : 'عدم ظهور ملف هنا لا يثبت عدم وجوده. استخدم رقم الملف أو الموبايل الكامل للبحث في الخادم.'}</span></div>}
        </div>
        <button type="button" className={`${secondaryClass} cpw-load-more`} disabled={listDisabled || !state.nextAfterId} onClick={() => guard(props.onLoadMore, listDisabled)}><ArrowDown size={18} aria-hidden="true" />تحميل الصفحة التالية — حتى ٢٥ ملفًا</button>
      </div>

      {selected && <section className="cpw-surface cpw-detail cpw-panel" aria-labelledby={`${prefix}-detail-title`}>
        <div className="cpw-section-heading"><span className="cpw-detail-kicker">ملف {fileNumber(selected.fileNo)}</span><button type="button" className={secondaryClass} disabled={disabled} onClick={() => guard(() => props.onEdit(selected))}><Pencil size={17} aria-hidden="true" />تعديل البيانات</button></div>
        <h3 id={`${prefix}-detail-title`} className="cpw-patient-name">{selected.data.name}</h3>
        <p className="cpw-help">بيانات الملف الأساسية فقط؛ هذا العرض لا يتضمن العلاج أو الحسابات.</p>
        {props.onOpenClinical && <button type="button" className={primaryClass} disabled={disabled} onClick={() => {
          const current = latest.current;
          if (!current.previewOnly && !current.closing && !current.state.closed && !locked(current.state)
            && !current.state.draft && current.state.selected === selected) current.onOpenClinical?.(selected);
        }}><FolderHeart size={18} aria-hidden="true" />فتح الجلسات وحساب الملف</button>}
        <dl className="cpw-facts"><div><dt>رقم الموبايل</dt><dd>{selected.data.mobile ? <bdi dir="ltr">{selected.data.mobile}</bdi> : 'غير مسجل'}</dd></div><div><dt>العمر</dt><dd>{selected.data.age.toLocaleString('ar-EG')} سنة</dd></div><div><dt>النوع</dt><dd>{selected.data.gender || 'غير محدد'}</dd></div><div><dt>أول زيارة</dt><dd><bdi dir="ltr">{selected.data.firstVisit || 'غير مسجل'}</bdi></dd></div></dl>
        {normalizeContactPhone(selected.data.mobile) && <div className="cpw-communication">
          <a className={secondaryClass} href={disabled ? undefined : `tel:+${normalizeContactPhone(selected.data.mobile)}`} aria-disabled={disabled} tabIndex={disabled ? -1 : undefined} aria-label={`اتصال بـ${selected.data.name}`} onClick={event => { if (disabled || !props.onContact(selected)) event.preventDefault(); }}><Phone size={18} aria-hidden="true" />اتصال</a>
          <a className={`${buttonClass} cpw-button-whatsapp`} href={disabled ? undefined : getWhatsAppUrl(normalizeContactPhone(selected.data.mobile), '')} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" aria-disabled={disabled} tabIndex={disabled ? -1 : undefined} aria-label={`فتح واتساب ${selected.data.name}`} onClick={event => { if (disabled || !props.onContact(selected)) event.preventDefault(); }}><MessageCircle size={18} aria-hidden="true" />واتساب يدوي</a>
        </div>}
        {selected.data.notes && <div className="cpw-note"><h4>ملاحظات الملف</h4><p>{selected.data.notes}</p></div>}
        {selected.data.allergy && <details className="cpw-optional"><summary>معلومة صحية إضافية</summary><p>{selected.data.allergy}</p></details>}
      </section>}

      {draft && <section className="cpw-surface cpw-detail cpw-panel" aria-labelledby={`${prefix}-editor-title`}>
        <h3 id={`${prefix}-editor-title`} className="cpw-editor-title"><UserRound size={21} aria-hidden="true" />{draft.action === 'create' ? 'ملف مريض جديد' : draft.action === 'import' ? `استرجاع استيراد ملف #${draft.fileNo}` : 'تعديل بيانات الملف'}</h3>
        <p className="cpw-help">{draft.action === 'create' ? 'رقم الملف يُخصص تلقائيًا عند تأكيد الحفظ من الخادم، ولا يُحجز بفتح هذه المسودة.' : draft.action === 'import' ? 'الرقم التاريخي والأمر الأصلي ثابتان؛ الاسترجاع لا يخصص رقمًا جديدًا.' : 'التعديل يحتفظ برقم الملف الحالي. كتابة البيانات وحدها لا تحفظها.'}</p>
        <form onSubmit={event => { event.preventDefault(); save(); }}>
          <fieldset disabled={disabled} className="cpw-fields">
            <div><label htmlFor={`${prefix}-name`}>اسم المريض</label><input id={`${prefix}-name`} className="cpw-input" type="text" autoComplete="name" maxLength={200} required value={draft.profile.name} onChange={event => guard(() => props.onChangeDraft({ name: event.target.value }, draft))} /></div>
            <div><label htmlFor={`${prefix}-mobile`}>رقم الموبايل <span>— اختياري</span></label><input id={`${prefix}-mobile`} className="cpw-input" type="tel" inputMode="tel" autoComplete="tel" dir="ltr" maxLength={60} value={draft.profile.mobile} onChange={event => guard(() => props.onChangeDraft({ mobile: event.target.value }, draft))} /></div>
            <div className="cpw-field-pair"><div><label htmlFor={`${prefix}-age`}>العمر بالسنوات</label><input id={`${prefix}-age`} className="cpw-input" type="text" inputMode="numeric" maxLength={3} pattern="[0-9٠-٩۰-۹]{1,3}" required value={ageText} aria-invalid={invalidAge || undefined} aria-describedby={invalidAge ? `${prefix}-age-error` : undefined} onChange={event => guard(() => props.onAgeQueryChange(event.target.value, draft))} />
              {invalidAge && <p id={`${prefix}-age-error`} className="cpw-field-error">اكتب العمر من ٠ إلى ١٢٠ قبل الحفظ.</p>}</div>
              <div><label htmlFor={`${prefix}-gender`}>النوع <span>— اختياري</span></label><input id={`${prefix}-gender`} className="cpw-input" type="text" maxLength={40} value={draft.profile.gender} list={`${prefix}-gender-options`} onChange={event => guard(() => props.onChangeDraft({ gender: event.target.value }, draft))} /><datalist id={`${prefix}-gender-options`}><option value="ذكر" /><option value="أنثى" /></datalist></div></div>
            <div><label htmlFor={`${prefix}-first-visit`}>تاريخ أول زيارة — اختياري</label><input id={`${prefix}-first-visit`} className="cpw-input" type="date" dir="ltr" min="1900-01-01" max="9999-12-31" value={draft.profile.firstVisit} onChange={event => guard(() => props.onChangeDraft({ firstVisit: event.target.value }, draft))} /></div>
            <div><label htmlFor={`${prefix}-notes`}>ملاحظات الملف <span>— اختياري</span></label><textarea id={`${prefix}-notes`} className="cpw-input" rows={3} maxLength={4000} value={draft.profile.notes} onChange={event => guard(() => props.onChangeDraft({ notes: event.target.value }, draft))} /></div>
            <details className="cpw-optional"><summary>معلومة صحية إضافية — اختياري</summary><div><label htmlFor={`${prefix}-allergy`}>الحساسية أو ملاحظة صحية</label><textarea id={`${prefix}-allergy`} className="cpw-input" rows={2} maxLength={1000} value={draft.profile.allergy} onChange={event => guard(() => props.onChangeDraft({ allergy: event.target.value }, draft))} /></div></details>
          </fieldset>
          {registration && <aside className="cpw-registration" aria-label="مراجعة التشابه قبل إنشاء ملف" role="status"><h4>الاسم أو الهاتف موجود من قبل — راجع النتائج</h4><p>قد يكون الرقم لأفراد الأسرة أو الاسم متشابهًا. لن ندمج البيانات أو نستخدم ملفًا قديمًا تلقائيًا.</p>
            <ul>{registration.matches.map(match => <li key={`${match.source}:${match.recordId}`}><strong>{match.name}</strong><span>{match.fileNo !== null ? `له ملف #${fileNumber(match.fileNo)}` : 'موجود بجهات الاتصال — بدون اختيار ملف'}</span><small>{match.reason === 'phone-and-name' ? 'نفس الهاتف واسم مشابه' : match.reason === 'phone' ? 'نفس الهاتف الكامل' : 'اسم مشابه'}{match.mobile && <> · <bdi dir="ltr">{match.mobile}</bdi></>}</small></li>)}</ul>
            {registration.matchCount > registration.matches.length && <p>نعرض أول {registration.matches.length} من {registration.matchCount} مطابقة؛ راجع الدليل لكل النتائج.</p>}
            <small>المراجعة من قراءة الخادم: <bdi dir="ltr">{registration.readTime}</bdi></small><p>لو هو نفس المريض، ألغِ المسودة وافتح رقم الملف الموجود. لو شخص مختلف، أكّد إنشاء ملف منفصل.</p>
            <button type="button" className={primaryClass} disabled={disabled || invalidAge || !props.onConfirmSeparate} onClick={() => {
              const current = latest.current;
              if (!current.previewOnly && !current.closing && !current.state.closed && !locked(current.state)
                && current.state.draft === draft && current.state.registrationCheck === registration && !invalidAge) current.onConfirmSeparate?.(registration, draft);
            }}>راجعت التشابه — إنشاء ملف منفصل</button></aside>}
          <div className="cpw-editor-actions"><button type="submit" className={primaryClass} disabled={unavailable || closing || state.loading || state.recoveryLoading || ['saving', 'preparing'].includes(state.saveStatus) || invalidAge || Boolean(registration)}>{refresh ? <RefreshCw size={18} aria-hidden="true" /> : <Check size={18} aria-hidden="true" />}{state.saveStatus === 'preparing' ? 'جارٍ تحضير العملية…' : state.saveStatus === 'saving' ? 'جارٍ التحقق…' : refresh ? 'إعادة التحقق من النتيجة' : retry ? 'إعادة نفس المحاولة' : registration ? 'راجع التشابه وأكّد الاختيار' : 'حفظ بيانات الملف'}</button>
            {state.pendingOperationId ? <button type="button" className={secondaryClass} disabled={unavailable || closing || state.loading || state.recoveryLoading || state.saveStatus !== 'retry-required' || !props.onCancelPending}
              onClick={() => { const current = latest.current; if (!current.previewOnly && !current.closing && !current.state.closed
                && !current.state.loading && !current.state.recoveryLoading && current.state.saveStatus === 'retry-required'
                && current.state.draft === draft && current.state.pendingOperationId) current.onCancelPending?.(draft); }}><X size={18} aria-hidden="true" />تأكيد إلغاء العملية</button>
              : <button type="button" className={secondaryClass} disabled={disabled} onClick={() => guard(() => props.onCancel(draft))}><X size={18} aria-hidden="true" />إلغاء المسودة</button>}</div>
        </form>
      </section>}
    </div>
    {props.recoveryController && <CloudProfileContactRecoveryPanel controller={props.recoveryController}
      previewOnly={unavailable} disabled={closing || isLocked || Boolean(draft)} canAct={() => {
        const current = latest.current;
        return !current.previewOnly && !current.closing && !current.state.closed && !locked(current.state) && !current.state.draft
          && (!current.recoveryCanAct || current.recoveryCanAct());
      }} onResume={operationId => {
        const current = latest.current;
        if (!current.previewOnly && !current.closing && !current.state.closed && !locked(current.state) && !current.state.draft) current.onResume?.(operationId);
      }} />}
    <footer className="cpw-footer"><ShieldCheck size={18} aria-hidden="true" /><p>لا استيراد أو تصدير هنا، ولا دمج تلقائي للملفات. تشابه الموبايل ليس موافقة على الحملات. فتح واتساب لا يؤكد إرسال رسالة.</p></footer>
  </section>;
}

/** Subscription only. The parent owns capability/view lifetime and disposal. */
export default function CloudPatientsWorkspace({ controller, onClose, onOpenClinical, previewOnly = false, closing = false }: {
  controller: CloudPatientWorkspaceController; onClose: () => void; onOpenClinical?: (patientRecordId: string) => void;
  previewOnly?: boolean; closing?: boolean;
}) {
  const subscribe = useCallback((notify: () => void) => controller.subscribe(() => notify()), [controller]);
  const getSnapshot = useCallback(() => controller.getState(), [controller]);
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [loadedQuery, setLoadedQuery] = useState(''), [fileQuery, setFileQuery] = useState(''), [phoneQuery, setPhoneQuery] = useState('');
  const [ageQuery, setAgeQuery] = useState<string | null>(null);
  const ageQueryRef = useRef<string | null>(null);
  ageQueryRef.current = ageQuery;
  const clinicalProps = useRef({ controller, onOpenClinical, onClose, previewOnly, closing });
  clinicalProps.current = { controller, onOpenClinical, onClose, previewOnly, closing };
  const live = () => { const current = clinicalProps.current; return current.controller === controller && !current.previewOnly && !current.closing; };
  const fresh = () => { if (!live()) return null; const value = controller.getState(); return live() && !value.closed && !locked(value) ? value : null; };
  const listsAvailable = () => { const value = fresh(); return value && !value.draft ? value : null; };
  const sameDraft = (expected: CloudPatientWorkspaceDraft, retry = false) => {
    if (!live()) return false;
    const value = controller.getState(); return live() && !value.closed && !value.loading && !value.recoveryLoading && !['saving', 'preparing'].includes(value.saveStatus)
      && (retry || value.saveStatus === 'idle') && value.draft === expected;
  };
  return <CloudPatientsWorkspaceView state={state} previewOnly={previewOnly} closing={closing} loadedQuery={loadedQuery} fileQuery={fileQuery} phoneQuery={phoneQuery} ageQuery={ageQuery}
    onLoadedQueryChange={value => { if (listsAvailable()) setLoadedQuery(value); }} onFileQueryChange={value => { if (listsAvailable()) setFileQuery(value); }} onPhoneQueryChange={value => { if (listsAvailable()) setPhoneQuery(value); }}
    onAgeQueryChange={(value, expected) => { if (!sameDraft(expected)) return; ageQueryRef.current = value; setAgeQuery(value); const digits = normalizeDirectoryDigits(value); if (/^[0-9]{1,3}$/.test(digits) && Number(digits) <= 120) controller.updateProfile({ age: Number(digits) }); }}
    onFindFile={value => { if (!listsAvailable()) return; const digits = normalizeDirectoryDigits(value.trim()); if (/^[0-9]{1,10}$/.test(digits) && Number(digits) >= 1 && Number(digits) <= 2_000_000_000) void controller.findByFileNo(Number(digits)); }}
    onFindPhone={value => { if (listsAvailable()) void controller.findByPhone({ mobile: value }); }}
    onClose={() => { const current = clinicalProps.current; if (current.controller !== controller || current.closing) return;
      const value = controller.getState(); if (clinicalProps.current !== current) return;
      if (current.previewOnly || value.closed || !locked(value) && !value.draft) current.onClose(); }}
    onCreate={() => { if (listsAvailable() && controller.beginCreate()) { ageQueryRef.current = null; setAgeQuery(null); } }}
    onSelect={record => { if (listsAvailable()?.records.includes(record)) void controller.select(record.recordId); }}
    onEdit={record => { if (listsAvailable()?.selected === record && controller.beginEdit(record)) { ageQueryRef.current = null; setAgeQuery(null); } }}
    onContact={record => { const value = listsAvailable(); return Boolean(value && value.selected === record && normalizeContactPhone(record.data.mobile)); }}
    onOpenClinical={onOpenClinical && !previewOnly ? record => {
      const current = clinicalProps.current;
      if (current.controller !== controller || current.previewOnly || current.closing || !current.onOpenClinical) return;
      const value = listsAvailable();
      if (value?.selected === record) current.onOpenClinical(record.recordId);
    } : undefined}
    onChangeDraft={(patch, expected) => { if (sameDraft(expected)) controller.updateProfile(patch); }}
    onSave={expected => { const digits = ageQueryRef.current === null ? null : normalizeDirectoryDigits(ageQueryRef.current); if (sameDraft(expected, true) && (digits === null || /^[0-9]{1,3}$/.test(digits) && Number(digits) <= 120)) void controller.save(); }}
    onConfirmSeparate={(check, expected) => { const digits = ageQueryRef.current === null ? null : normalizeDirectoryDigits(ageQueryRef.current);
      if (sameDraft(expected) && controller.getState().registrationCheck === check && (digits === null || /^[0-9]{1,3}$/.test(digits) && Number(digits) <= 120)) void controller.confirmSeparateFile(check); }}
    onCancel={expected => { if (sameDraft(expected) && controller.cancelDraft()) { ageQueryRef.current = null; setAgeQuery(null); } }}
    onCancelPending={expected => { const value = live() ? controller.getState() : null;
      if (live() && value && !value.closed && !value.loading && !value.recoveryLoading && value.saveStatus === 'retry-required' && value.draft === expected && value.pendingOperationId) void controller.cancelPending(); }}
    recoveryController={controller.recovery} recoveryCanAct={() => Boolean(listsAvailable())} onResume={operationId => { if (listsAvailable()) { ageQueryRef.current = null; setAgeQuery(null); void controller.resume(operationId); } }}
    onRefresh={() => { if (listsAvailable()) void controller.refresh(); }} onLoadMore={() => { if (listsAvailable()) void controller.loadMore(); }} />;
}
