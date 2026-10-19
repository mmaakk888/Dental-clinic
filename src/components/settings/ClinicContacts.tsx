import React, { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from 'react';
import { AlertCircle, BookUser, ChevronLeft, ChevronRight, FileCheck2, Megaphone, Pencil, Phone, Plus, Save, Search, Trash2, UserRound, X } from 'lucide-react';
import type { ClinicContact, Patient } from '../../types';
import { buildClinicContactDirectory, clinicDirectoryRowMatchesSearch, createPhoneDirectoryIndex, findRecordsByPhone,
  normalizeContactPhone, prepareContactSearchQuery, type ContactPatientFile, type PhoneDirectoryIndex } from '../../utils/clinicContacts';
import { useAppointmentDialog } from '../appointments/useAppointmentDialog';
import { useToastAndConfirm } from '../common/ToastAndConfirm';
import { useConfirmedAction } from '../common/useConfirmedAction';
import './ClinicContacts.css';

export interface ClinicContactsProps {
  contacts: ClinicContact[];
  patients: Patient[];
  onSave: (contact: ClinicContact, original?: ClinicContact) => void | Promise<void>;
  onDelete: (original: ClinicContact) => void | Promise<void>;
  onOpenPatient?: (patientId: string) => void;
  canManageContacts?: boolean;
  onOpenCampaigns?: () => void;
  onEditorChange?: (open: boolean) => void;
}

type ContactFilter = 'all' | 'without-file' | 'with-file';
const PAGE_SIZE = 25;
const nameCollator = new Intl.Collator('ar-EG', { sensitivity: 'base', numeric: true });

function MatchingFiles({ matches, onOpenPatient }: { matches: readonly ContactPatientFile[]; onOpenPatient?: (patientId: string) => void }) {
  return <div className="cc-matching-files">{matches.map(patient => onOpenPatient
    ? <button type="button" className="cc-file-link" key={patient.id} onClick={() => onOpenPatient(patient.id)}><FileCheck2 aria-hidden="true" /><span>ملف #{patient.id} · {patient.name}</span><ChevronLeft aria-hidden="true" /></button>
    : <span className="cc-file-label" key={patient.id}><FileCheck2 aria-hidden="true" /><span>ملف #{patient.id} · {patient.name}</span></span>)}</div>;
}

function ContactName({ name, matches }: { name: string; matches: readonly ContactPatientFile[] }) {
  return <div className="cc-contact-name"><h3 dir="auto">{name}</h3>{matches.length > 0 && <div className="cc-name-file-badges" aria-label="أرقام الملفات المسجلة بنفس الموبايل">{matches.map(patient => <span key={patient.id}><FileCheck2 aria-hidden="true" />ملف #{patient.id}</span>)}</div>}</div>;
}

function ContactEditor({ original, contacts, patientPhoneIndex, onSave, onClose, onOpenPatient }: Omit<ClinicContactsProps, 'onDelete' | 'patients'> & { original?: ClinicContact; patientPhoneIndex: PhoneDirectoryIndex<Patient>; onClose: () => void }) {
  const id = `contact-editor-${useId().replace(/[^\w-]/g, '')}`;
  const { showToast } = useToastAndConfirm();
  const { saving, run } = useConfirmedAction();
  const busy = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);
  const [draft, setDraft] = useState(() => ({ name: original?.name || '', mobile: original?.mobile || '', notes: original?.notes || '' }));
  const [errors, setErrors] = useState<{ name?: string; mobile?: string }>({});
  const [discardPrompt, setDiscardPrompt] = useState(false);
  const changed = draft.name !== (original?.name || '') || draft.mobile !== (original?.mobile || '') || draft.notes !== (original?.notes || '');
  const contactPhoneIndex = useMemo(() => createPhoneDirectoryIndex(contacts), [contacts]);
  const contactsById = useMemo(() => new Map(contacts.map(contact => [contact.id, contact])), [contacts]);
  const currentOriginal = original ? contactsById.get(original.id) : undefined;
  const conflict = !!original && JSON.stringify(currentOriginal) !== JSON.stringify(original);
  const phone = normalizeContactPhone(draft.mobile);
  const duplicate = phone ? contactPhoneIndex.get(phone)?.find(contact => contact.id !== original?.id) : undefined;
  const matches = findRecordsByPhone(patientPhoneIndex, draft.mobile);
  const requestClose = () => {
    if (busy.current) return;
    if (discardPrompt) { setDiscardPrompt(false); return; }
    if (!changed) { onClose(); return; }
    setDiscardPrompt(true);
    requestAnimationFrame(() => continueRef.current?.focus());
  };
  const dialogRef = useAppointmentDialog(true, requestClose);
  const update = (key: keyof typeof draft, value: string) => {
    setDraft(current => ({ ...current, [key]: value }));
    setErrors(current => ({ ...current, [key]: undefined }));
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy.current || conflict || discardPrompt) return;
    const nextErrors = {
      name: draft.name.trim() ? undefined : 'اكتب اسم جهة الاتصال.',
      mobile: !phone ? 'اكتب رقم موبايل كاملًا وصحيحًا، مثل 01012345678 أو +201012345678.' : duplicate ? `الرقم محفوظ بالفعل باسم «${duplicate.name}». عدّل جهة الاتصال الموجودة بدل تكرارها.` : undefined,
    };
    setErrors(nextErrors);
    if (nextErrors.name || nextErrors.mobile) {
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    busy.current = true;
    try {
      await run(async () => {
        await onSave({ ...original, id: original?.id || `contact_${crypto.randomUUID()}`, name: draft.name.trim(), mobile: draft.mobile.trim(), notes: draft.notes.trim(), createdAt: original?.createdAt || new Date().toISOString() }, original);
      }, () => { showToast(original ? 'تم حفظ تعديلات جهة الاتصال.' : 'تمت إضافة جهة الاتصال دون إنشاء ملف مريض.', 'success'); onClose(); });
    } finally { busy.current = false; }
  };

  return <div className="clinic-modal-overlay cc-overlay" dir="rtl" onClick={event => { if (event.target === event.currentTarget) requestClose(); }}>
    <div ref={dialogRef} className="clinic-modal-panel clinic-modal-panel--framed cc-dialog" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-intro`} tabIndex={-1}>
      <header className="cc-dialog-header"><span className="cc-icon"><BookUser aria-hidden="true" /></span><div><h2 id={`${id}-title`}>{original ? 'تعديل جهة اتصال' : 'إضافة جهة اتصال'}</h2><p id={`${id}-intro`}>اسم ورقم للتواصل فقط، من غير رقم ملف أو حساب مالي.</p></div><button type="button" className="cc-icon-button" aria-label="إلغاء وإغلاق جهة الاتصال" disabled={saving} onClick={requestClose}><X aria-hidden="true" /></button></header>
      <form ref={formRef} onSubmit={save} className="cc-editor-form" noValidate>
        <div className="cc-editor-body overflow-y-auto">
          {discardPrompt ? <section className="cc-discard"><AlertCircle aria-hidden="true" /><h3>إغلاق من غير حفظ؟</h3><p>التعديلات دي لسه ما اتحفظتش. تقدر ترجع تكملها، أو تقفل من غير تغيير القائمة.</p><div><button type="button" ref={continueRef} className="cc-button cc-button-primary" onClick={() => setDiscardPrompt(false)}>متابعة التعديل</button><button type="button" className="cc-button" onClick={onClose}>إغلاق بدون حفظ</button></div></section> : <>
            {conflict && <div className="cc-notice cc-notice-warning" role="alert"><AlertCircle aria-hidden="true" /><p>جهة الاتصال اتعدّلت أو اتحذفت في تبويب آخر. المسودة محفوظة هنا، لكن لازم تقفل النافذة وتفتح السجل الحالي قبل الحفظ.</p></div>}
            <fieldset disabled={saving} className="cc-fields">
              <div className="cc-field"><label htmlFor={`${id}-name`}>الاسم</label><input id={`${id}-name`} data-dialog-autofocus type="text" dir="auto" autoComplete="name" maxLength={200} value={draft.name} required aria-invalid={!!errors.name} aria-describedby={errors.name ? `${id}-name-error` : undefined} onChange={event => update('name', event.target.value)} />{errors.name && <p id={`${id}-name-error`} role="alert" className="cc-error">{errors.name}</p>}</div>
              <div className="cc-field"><label htmlFor={`${id}-mobile`}>رقم الموبايل</label><input id={`${id}-mobile`} type="tel" dir="ltr" inputMode="tel" autoComplete="tel" maxLength={60} placeholder="01012345678" value={draft.mobile} required aria-invalid={!!errors.mobile} aria-describedby={`${id}-phone-hint${errors.mobile ? ` ${id}-mobile-error` : ''}`} onChange={event => update('mobile', event.target.value)} /><p id={`${id}-phone-hint`} className="cc-hint">بنطابق الرقم كاملًا، سواء مكتوب 01 أو +20 أو بأرقام عربية.</p>{errors.mobile && <p id={`${id}-mobile-error`} role="alert" className="cc-error">{errors.mobile}</p>}</div>
              {duplicate && !errors.mobile && <div className="cc-notice cc-notice-warning" role="status"><AlertCircle aria-hidden="true" /><p>الرقم موجود في جهات الاتصال باسم «{duplicate.name}». لن نضيف نسخة مكررة.</p></div>}
              {matches.length > 0 && <div className="cc-match-notice" role="status"><div><FileCheck2 aria-hidden="true" /><strong>{matches.length === 1 ? 'الرقم ده مسجل في ملف مريض بالفعل' : `الرقم ده مسجل في ${matches.length} ملفات`}</strong></div><MatchingFiles matches={matches} onOpenPatient={onOpenPatient ? patientId => { if (!changed) onOpenPatient(patientId); else showToast('احفظ المسودة أو أغلقها أولًا، ثم افتح الملف من بطاقة جهة الاتصال.', 'warning'); } : undefined} /><p>ده تطابق رقم فقط، مش تأكيد إنهم نفس الشخص. مش هنعمل دمج أو ننشئ ملف تلقائيًا.</p></div>}
              <div className="cc-field"><label htmlFor={`${id}-notes`}>ملاحظة <span>اختياري · بدون تفاصيل طبية</span></label><textarea id={`${id}-notes`} dir="auto" maxLength={2000} rows={3} value={draft.notes} placeholder="مثل: الاسم المتعارف عليه أو أفضل وقت للتواصل" onChange={event => update('notes', event.target.value)} /></div>
            </fieldset>
            <p className="cc-hint">إضافة الرقم مش معناها موافقة على الدعاية. موافقة الحملات بتتحدد بشكل منفصل من قسم الحملات.</p>
          </>}
        </div>
        {!discardPrompt && <footer className="cc-dialog-footer"><button type="button" className="cc-button" disabled={saving} onClick={requestClose}>إلغاء وإغلاق</button><button type="submit" className="cc-button cc-button-primary" disabled={saving || conflict || (!!original && !changed)}><Save aria-hidden="true" />{saving ? 'جارٍ الحفظ…' : 'حفظ جهة الاتصال'}</button></footer>}
      </form>
    </div>
  </div>;
}

export function ClinicContacts({ contacts, patients, onSave, onDelete, onOpenPatient, canManageContacts = false, onOpenCampaigns, onEditorChange }: ClinicContactsProps) {
  const id = `clinic-contacts-${useId().replace(/[^\w-]/g, '')}`;
  const { showToast, askConfirm } = useToastAndConfirm();
  const { saving, run } = useConfirmedAction();
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [filter, setFilter] = useState<ContactFilter>('all');
  const [page, setPage] = useState(0);
  const [editor, setEditor] = useState<{ original?: ClinicContact } | null>(null);
  useEffect(() => { onEditorChange?.(!!editor); return () => onEditorChange?.(false); }, [editor, onEditorChange]);
  const patientPhoneIndex: PhoneDirectoryIndex<Patient> = useMemo(() => createPhoneDirectoryIndex(patients), [patients]);
  const rows = useMemo(() => buildClinicContactDirectory(contacts, patients).sort((left, right) => nameCollator.compare(left.name, right.name)), [contacts, patients]);
  const searched = useMemo(() => {
    const preparedQuery = prepareContactSearchQuery(deferredQuery);
    return rows.filter(row => clinicDirectoryRowMatchesSearch(row, preparedQuery));
  }, [rows, deferredQuery]);
  const withFileRows = useMemo(() => searched.filter(row => row.matches.length > 0), [searched]);
  const withoutFileRows = useMemo(() => searched.filter(row => row.matches.length === 0), [searched]);
  // Group first, then paginate. A family number is one phone row, with every
  // matching file retained; these categories never merge or create records.
  const filtered = filter === 'with-file' ? withFileRows : filter === 'without-file' ? withoutFileRows : [...withFileRows, ...withoutFileRows];
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const visible = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const queryMatches = findRecordsByPhone(patientPhoneIndex, query);
  const groups = [
    { key: 'with-file', label: 'أرقام لها ملفات', total: withFileRows.length, rows: visible.filter(row => row.matches.length > 0) },
    { key: 'without-file', label: 'أرقام بدون ملفات', total: withoutFileRows.length, rows: visible.filter(row => row.matches.length === 0) },
  ];
  useEffect(() => { setPage(0); }, [deferredQuery, filter]);
  useEffect(() => { if (!canManageContacts) setEditor(null); }, [canManageContacts]);
  const resetFilters = () => { setQuery(''); setFilter('all'); setPage(0); };
  const remove = (contact: ClinicContact) => {
    if (saving || !canManageContacts) return;
    askConfirm({ title: `حذف جهة الاتصال «${contact.name}»؟`, message: 'هنحذف الاسم والرقم من قائمة جهات الاتصال فقط. أي ملف مريض موجود بنفس الرقم، وجلساته وحساباته، مش هيتغير. موافقة الحملات لهذا الرقم لا تتغير بالحذف.', confirmLabel: 'حذف جهة الاتصال فقط', tone: 'danger', onConfirm: async () => { await run(async () => { await onDelete(contact); }, () => showToast('تم حذف جهة الاتصال فقط، دون تغيير أي ملف مريض.', 'success')); } });
  };

  return <section className="clinic-contacts" dir="rtl" aria-labelledby={`${id}-title`}>
    <header className="cc-header"><div><span className="cc-eyebrow">دليل التواصل</span><h2 id={`${id}-title`}>جهات الاتصال</h2><p>كل أرقام المرضى وجهات الاتصال في مكان واحد، مع أرقام الملفات المرتبطة بها.</p></div>{(canManageContacts || onOpenCampaigns) && <div className="cc-header-actions">{onOpenCampaigns && <button type="button" className="cc-button" onClick={onOpenCampaigns}><Megaphone aria-hidden="true" />تجهيز حملة</button>}{canManageContacts && <button type="button" className="cc-button cc-button-primary" disabled={saving} onClick={() => setEditor({})}><Plus aria-hidden="true" />إضافة جهة اتصال</button>}</div>}</header>
    <div className="cc-scope-note"><BookUser aria-hidden="true" /><p>أرقام ملفات المرضى تظهر هنا تلقائيًا للعرض فقط. جهات الاتصال المستقلة تظل منفصلة؛ تطابق رقم الأسرة لا يدمج الملفات أو يسجّل موافقة على الحملات.</p></div>
    <section className="cc-directory" aria-label="دليل جهات الاتصال" aria-busy={query !== deferredQuery}>
      <div className="cc-toolbar"><div className="cc-search"><label htmlFor={`${id}-search`}>البحث بالاسم أو الموبايل</label><div><Search aria-hidden="true" /><input id={`${id}-search`} type="search" dir="auto" placeholder="اكتب اسمًا أو رقمًا…" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} /><button type="button" className="cc-icon-button" aria-label="مسح البحث في جهات الاتصال" disabled={!query} onClick={() => { setQuery(''); setPage(0); }}><X aria-hidden="true" /></button></div></div></div>
      <div className="cc-sections" role="group" aria-label="تصنيف أرقام التواصل">
        {([
          { key: 'all', label: 'الكل', count: searched.length, description: 'دليل موحد' },
          { key: 'with-file', label: 'لهم ملفات', count: withFileRows.length, description: 'مع أرقام الملفات' },
          { key: 'without-file', label: 'بدون ملفات', count: withoutFileRows.length, description: 'جهات اتصال فقط' },
        ] as const).map(section => <button key={section.key} type="button" aria-pressed={filter === section.key} aria-controls={`${id}-results`} onClick={() => { setFilter(section.key); setPage(0); }}><span>{section.label}<bdi>{section.count}</bdi></span><small>{section.description}</small></button>)}
      </div>
      {queryMatches.length > 0 && <div className="cc-search-match" role="status"><div className="cc-inline-heading"><FileCheck2 aria-hidden="true" /><strong>الرقم اللي بتبحث عنه له ملف بالفعل</strong></div><MatchingFiles matches={queryMatches} onOpenPatient={onOpenPatient} /><p>تطابق الرقم لا يثبت هوية الشخص؛ بعض الأسر بتستخدم رقمًا واحدًا.</p></div>}
      <div className="cc-results"><p role="status">{query || filter !== 'all' ? `عرض ${filtered.length} من ${rows.length} رقم تواصل` : `${rows.length} رقم تواصل`}<span> · مرتبة بالاسم داخل كل قسم{query && ' · أعداد الأقسام حسب البحث'}</span></p>{(query || filter !== 'all') && <button type="button" className="cc-button cc-button-quiet" onClick={resetFilters}>عرض الكل</button>}</div>
      <div id={`${id}-results`}>
      {visible.length > 0 ? <div className="cc-groups">{groups.filter(group => group.rows.length > 0).map(group => <section key={group.key} className="cc-group" aria-labelledby={`${id}-${group.key}`}><header className="cc-group-heading"><h3 id={`${id}-${group.key}`}>{group.label}</h3><span><bdi>{group.total}</bdi> رقم{group.rows.length < group.total && <> · <bdi>{group.rows.length}</bdi> في هذه الصفحة</>}</span></header><div className="cc-list">{group.rows.map(({ id: rowId, contact, name, mobile, matches }) => <article className="cc-contact" key={rowId} data-contact-source={contact ? 'contact' : 'patient'}><div className="cc-contact-main"><span className="cc-avatar" aria-hidden="true"><UserRound /></span><div className="cc-contact-details"><ContactName name={name} matches={matches} /><div className="cc-contact-meta"><span className="cc-phone"><Phone aria-hidden="true" /><bdi dir="ltr">{mobile}</bdi></span><span className={`cc-status${matches.length ? ' cc-status-matched' : ''}`}>{!contact ? 'من ملفات المرضى' : matches.length ? 'رقم له ملف' : 'جهة اتصال فقط'}</span></div>{contact?.notes && <details className="cc-note-details"><summary>ملاحظة محفوظة</summary><p className="cc-contact-notes" dir="auto">{contact.notes}</p></details>}</div>{canManageContacts && contact && <div className="cc-contact-actions"><button type="button" className="cc-icon-button" aria-label={`تعديل جهة الاتصال ${contact.name}`} title="تعديل" disabled={saving} onClick={() => setEditor({ original: { ...contact } })}><Pencil aria-hidden="true" /></button><button type="button" className="cc-icon-button cc-delete" aria-label={`حذف جهة الاتصال ${contact.name}`} title="حذف جهة الاتصال فقط" disabled={saving} onClick={() => remove(contact)}><Trash2 aria-hidden="true" /></button></div>}</div>{matches.length > 0 && <div className="cc-contact-files"><MatchingFiles matches={matches} onOpenPatient={onOpenPatient} /><small>{contact ? 'تطابق رقم فقط · بدون دمج تلقائي' : 'الرقم من ملف المريض · تعديل بياناته من الملف'}</small></div>}</article>)}</div></section>)}</div> : <div className="cc-empty"><BookUser aria-hidden="true" /><h3>{rows.length ? filter === 'with-file' ? 'لا توجد أرقام لها ملفات ضمن الاختيار' : filter === 'without-file' ? 'لا توجد أرقام بدون ملفات ضمن الاختيار' : 'مفيش أرقام مطابقة' : canManageContacts ? 'ابدأ بقائمة الأسماء والأرقام' : 'لا توجد أرقام تواصل بعد'}</h3><p>{rows.length ? 'جرّب اسمًا أو رقمًا آخر، أو اعرض القائمة كلها.' : canManageContacts ? 'أضف جهة اتصال مستقلة، أو سجّل هاتفًا في ملف مريض ليظهر هنا تلقائيًا.' : 'أرقام المرضى وجهات الاتصال المحفوظة هتظهر هنا مع الملفات المرتبطة بها.'}</p>{(rows.length > 0 || canManageContacts) && <button type="button" className="cc-button" onClick={rows.length ? resetFilters : () => setEditor({})}>{rows.length ? 'عرض الكل' : 'إضافة أول جهة اتصال'}</button>}</div>}
      </div>
      {pages > 1 && <nav className="cc-pagination" aria-label="صفحات جهات الاتصال"><button type="button" className="cc-button" disabled={currentPage === 0} onClick={() => setPage(value => Math.max(0, value - 1))}><ChevronRight aria-hidden="true" />السابق</button><span aria-live="polite">{currentPage + 1} / {pages}</span><button type="button" className="cc-button" disabled={currentPage === pages - 1} onClick={() => setPage(value => Math.min(pages - 1, value + 1))}>التالي<ChevronLeft aria-hidden="true" /></button></nav>}
    </section>
    <p className="cc-footer-note">الحملات بتجمع جهات الاتصال والمرضى بدون تكرار نفس الرقم، وبشرط وجود موافقة مسجّلة على رسائل الحملات.</p>
    {canManageContacts && editor && <ContactEditor original={editor.original} contacts={contacts} patientPhoneIndex={patientPhoneIndex} onSave={onSave} onClose={() => setEditor(null)} onOpenPatient={onOpenPatient ? patientId => { setEditor(null); onOpenPatient(patientId); } : undefined} />}
  </section>;
}
