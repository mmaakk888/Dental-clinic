import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { AlertCircle, ContactRound, Database, Download, FileSpreadsheet, Search, Upload, Users, X } from 'lucide-react';
import type { ClinicContact, Patient } from '../../types';
import type { ContactImportInput, ContactImportSummary } from '../../utils/contactTransfer';
import { createContactSearchEntry, createPhoneDirectoryIndex, findRecordsByPhone, indexedContactMatchesSearch, prepareContactSearchQuery } from '../../utils/clinicContacts';
import { PATIENT_COLUMNS, downloadPatientSpreadsheet, previewPatientImport, readPatientSpreadsheet, type PatientExportColumns, type PatientImportRow } from '../../utils/patientSpreadsheets';
import { ContactExportDialog, ContactImportDialog } from './ContactTransferDialog';
import { useAppointmentDialog } from '../appointments/useAppointmentDialog';
import { useConfirmedAction } from '../common/useConfirmedAction';
import { useToastAndConfirm } from '../common/ToastAndConfirm';
import { downloadLocalClinicBackup, localBackupSectionSummary, readLocalClinicBackup, type LocalBackupPreview } from '../../utils/localClinicBackup';
import './ClinicContacts.css';
import './DataTransferManagement.css';

type AuthorizationKind = 'patients' | 'patient_finance' | 'financial_report' | 'full_backup';
const defaultColumns: PatientExportColumns = { id: true, name: true, mobile: true, age: true, firstVisit: true, allergy: false, notes: false, gender: false, totalRequired: false, totalPaid: false, totalRemain: false };
const templateColumns = { ...defaultColumns, allergy: true, notes: true, gender: true };
function PatientImportDialog({ patients, onImport, onAuthorize, onAuthorizeExport, onClose }: {
  patients: Patient[]; onImport: (patients: Patient[]) => Promise<void>; onAuthorize: () => void; onAuthorizeExport: () => void; onClose: () => void;
}) {
  const id = `patient-import-${useId().replace(/[^\w-]/g, '')}`;
  const { showToast } = useToastAndConfirm(), { saving, run } = useConfirmedAction();
  const mounted = useRef(true), version = useRef(0), committing = useRef(false);
  const [operation, setOperation] = useState<'read' | 'template' | 'import' | null>(null);
  const [inputs, setInputs] = useState<PatientImportRow[] | null>(null), [fileName, setFileName] = useState(''), [page, setPage] = useState(0);
  const preview = useMemo(() => inputs ? previewPatientImport(inputs, patients) : null, [inputs, patients]);
  const pages = Math.max(1, Math.ceil((preview?.rows.length || 0) / 20)), currentPage = Math.min(page, pages - 1);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; version.current++; }; }, []);
  const close = () => { if (committing.current) return; version.current++; onClose(); };
  const dialogRef = useAppointmentDialog(true, close);
  const read = async (file: File | undefined) => {
    if (!file || saving) return; const token = ++version.current; setOperation('read');
    await run(async () => {
      try {
        onAuthorize(); const rows = await readPatientSpreadsheet(file);
        if (!mounted.current || token !== version.current) return;
        onAuthorize(); setInputs(rows); setFileName(file.name); setPage(0);
      } catch (error) { if (mounted.current && token === version.current) throw error; }
    });
    if (mounted.current && token === version.current) setOperation(null);
  };
  const template = async () => {
    if (saving) return; const token = ++version.current; setOperation('template');
    const authorize = () => { if (!mounted.current || token !== version.current) throw new Error('تم إلغاء تنزيل القالب.'); onAuthorizeExport(); };
    await run(async () => { try { await downloadPatientSpreadsheet([], templateColumns, false, 'xlsx', authorize); } catch (error) { if (mounted.current && token === version.current) throw error; } });
    if (mounted.current && token === version.current) setOperation(null);
  };
  const apply = async () => {
    if (saving || committing.current || !preview?.newCount) return;
    committing.current = true; setOperation('import');
    try { await run(async () => { onAuthorize(); await onImport(preview.newPatients); if (!mounted.current) return; showToast(`تمت إضافة ${preview.newCount} ملف مريض جديد دون دمج ملفات موجودة.`, 'success'); onClose(); }); }
    finally { committing.current = false; if (mounted.current) setOperation(null); }
  };
  return <div className="clinic-modal-overlay ct-overlay" dir="rtl" onClick={event => { if (event.target === event.currentTarget) close(); }}><div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} tabIndex={-1} className="clinic-modal-panel clinic-modal-panel--framed ct-dialog">
    <header className="ct-header"><span className="ct-icon"><Upload aria-hidden="true" /></span><div><h2 id={`${id}-title`}>استيراد ملفات المرضى</h2><p>راجع الصفوف أولًا، ثم أكّد إضافة الملفات الجديدة.</p></div><button type="button" className="cc-icon-button" disabled={operation === 'import'} onClick={close} aria-label="إلغاء وإغلاق استيراد المرضى"><X aria-hidden="true" /></button></header>
    <div className="ct-body overflow-y-auto"><section className="ct-upload-section"><h3>ملف Excel أو CSV</h3><p className="ct-hint">الورقة الأولى فقط · حتى ٥ ميجابايت و٥٠٠٠ صف · رقم الملف والاسم مطلوبان. احفظ الموبايل ورقم الملف كنص؛ التاريخ YYYY-MM-DD أو يوم/شهر/سنة.</p><label className={`ct-file-picker${saving ? ' ct-disabled' : ''}`} htmlFor={`${id}-file`}><Upload aria-hidden="true" />{operation === 'read' ? 'جارٍ قراءة الملف…' : fileName ? 'اختيار ملف آخر' : 'اختيار ملف المرضى'}</label><input id={`${id}-file`} type="file" className="ct-file-input" accept=".xlsx,.xls,.csv" disabled={saving} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void read(file); }} /><button type="button" className="cc-button cc-button-quiet" disabled={saving} onClick={() => void template()}><Download aria-hidden="true" />{operation === 'template' ? 'جارٍ تجهيز القالب…' : 'تنزيل قالب المرضى'}</button></section>
      <div className="ct-notice"><AlertCircle aria-hidden="true" /><p>هذا الاستيراد للبيانات الأساسية فقط. لن نستنتج جلسات أو دفعات من إجماليات مالية، ولن نستبدل ملفًا موجودًا. لاستعادة تاريخ العلاج والإيصالات استخدم النسخة الكاملة من قسم النسخ الاحتياطي.</p></div>
      {preview && <section className="ct-preview"><div className="ct-preview-title"><h3>معاينة قبل الحفظ</h3><p dir="auto">{fileName}</p></div><div className="ct-counts"><div className="ct-count-new"><strong>{preview.newCount}</strong><span>ملف جديد</span></div><div className="ct-count-duplicate"><strong>{preview.duplicateCount}</strong><span>مكرر · يُتجاهل</span></div><div className="ct-count-invalid"><strong>{preview.invalidCount}</strong><span>يحتاج تصحيحًا</span></div></div><div className="ct-preview-list">{preview.rows.slice(currentPage * 20, (currentPage + 1) * 20).map(row => <article key={row.rowNumber} className={`ct-preview-row ct-preview-row-${row.status}`}><div className="ct-row-heading"><span>صف {row.rowNumber}</span><strong>{row.status === 'new' ? 'جاهز للإضافة' : row.status === 'duplicate' ? 'رقم ملف مكرر' : 'غير صالح'}</strong></div><h4 dir="auto">{row.name || 'بدون اسم'}</h4><p>ملف #{row.id || '—'}</p><p className="ct-row-phone" dir="ltr">{row.mobile || 'بدون موبايل'}</p>{row.patient && <p className="ct-row-message">السن: {row.patient.age} · أول زيارة: <bdi dir="ltr">{row.patient.firstVisit || 'غير محدد'}</bdi></p>}{row.patient && (row.patient.notes || row.patient.allergy) && <details className="dt-import-details"><summary>مراجعة الملاحظات والمعلومات الإضافية</summary>{row.patient.notes && <p dir="auto">{row.patient.notes}</p>}{row.patient.allergy && <p dir="auto">معلومة طبية: {row.patient.allergy}</p>}</details>}<p className="ct-row-message">{row.message}</p></article>)}</div>{pages > 1 && <nav className="ct-pagination" aria-label="صفحات معاينة ملفات المرضى"><button type="button" className="cc-button" disabled={saving || currentPage === 0} onClick={() => setPage(currentPage - 1)}>السابق</button><span>{currentPage + 1} / {pages}</span><button type="button" className="cc-button" disabled={saving || currentPage === pages - 1} onClick={() => setPage(currentPage + 1)}>التالي</button></nav>}{!preview.rows.length && <p role="status">الملف لا يحتوي على صفوف مرضى.</p>}</section>}
    </div><footer className="ct-footer"><button type="button" className="cc-button" disabled={operation === 'import'} onClick={close}>إلغاء وإغلاق</button><button type="button" className="cc-button cc-button-primary" disabled={saving || !preview?.newCount} onClick={() => void apply()}><Upload aria-hidden="true" />{operation === 'import' ? 'جارٍ الحفظ…' : `إضافة ${preview?.newCount || 0} ملف جديد`}</button></footer>
  </div></div>;
}

export function LocalBackupRestoreDialog({ onAuthorize, onRestore, onClose }: {
  onAuthorize: () => void; onRestore: (input: unknown) => Promise<void>; onClose: () => void;
}) {
  const id = `local-backup-${useId().replace(/[^\w-]/g, '')}`;
  const { showToast, askConfirm, cancelConfirm } = useToastAndConfirm();
  const { saving, run } = useConfirmedAction();
  const mounted = useRef(true), version = useRef(0), committing = useRef(false);
  const [preview, setPreview] = useState<LocalBackupPreview | null>(null), [fileName, setFileName] = useState('');
  const [accepted, setAccepted] = useState(false), [error, setError] = useState('');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; version.current++; cancelConfirm(); }; }, [cancelConfirm]);
  const close = () => { if (committing.current) return; version.current++; cancelConfirm(); onClose(); };
  const dialogRef = useAppointmentDialog(true, close);
  const read = async (file: File | undefined) => {
    if (!file || saving) return;
    const token = ++version.current; setAccepted(false); setError(''); setPreview(null); setFileName('');
    await run(async () => {
      try {
        onAuthorize(); const next = await readLocalClinicBackup(file);
        if (!mounted.current || token !== version.current) return;
        onAuthorize(); setPreview(next); setFileName(file.name);
      } catch (failure) {
        if (!mounted.current || token !== version.current) return;
        setError(failure instanceof Error ? failure.message : 'تعذّر قراءة النسخة؛ لم تبدأ الاستعادة.'); throw failure;
      }
    });
  };
  const confirmRestore = () => {
    if (!preview || !accepted || saving || committing.current) return;
    try { onAuthorize(); } catch (failure) { showToast(failure instanceof Error ? failure.message : 'الاستعادة غير مصرح بها.', 'error'); return; }
    const token = version.current, selected = preview;
    askConfirm({ title: 'تأكيد استبدال البيانات من النسخة المحلية',
      message: `استعادة «${fileName}» ستستبدل الأقسام الموجودة فيه فقط، ولن تدمج الملفات أو الإيصالات. قد تتغير حسابات الدخول وتحتاج تسجيل الدخول مجددًا. احتفظ بنسخة حديثة من البيانات الحالية أولًا.`,
      confirmLabel: 'استعادة الأقسام المعروضة', tone: 'danger', onConfirm: async () => {
        if (!mounted.current || token !== version.current || committing.current) throw new Error('أُلغيت هذه المعاينة؛ اختر النسخة وراجعها من جديد.');
        committing.current = true; setError('');
        try {
          await run(async () => {
            try {
              onAuthorize(); await onRestore(selected.data);
              if (!mounted.current || token !== version.current) return;
              showToast('تم تأكيد استعادة الأقسام الموجودة في النسخة المحلية.', 'success'); onClose();
            } catch (failure) {
              if (mounted.current && token === version.current) setError(failure instanceof Error ? failure.message : 'تعذّرت الاستعادة؛ المعاينة محفوظة للمراجعة وإعادة المحاولة.');
              throw failure;
            }
          });
        } finally { committing.current = false; }
      } });
  };
  return <div className="clinic-modal-overlay ct-overlay" dir="rtl" onClick={event => { if (event.target === event.currentTarget) close(); }}><div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} tabIndex={-1} className="clinic-modal-panel clinic-modal-panel--framed ct-dialog">
    <header className="ct-header"><span className="ct-icon"><Database aria-hidden="true" /></span><div><h2 id={`${id}-title`}>استعادة نسخة محلية كاملة</h2><p>اختيار الملف ومعاينته لا يغيّر أي بيانات.</p></div><button type="button" className="cc-icon-button" disabled={saving && committing.current} onClick={close} aria-label="إلغاء وإغلاق استعادة النسخة"><X aria-hidden="true" /></button></header>
    <div className="ct-body overflow-y-auto"><section className="ct-upload-section"><h3>نسخة العيادة بصيغة JSON</h3><p className="ct-hint">حتى ٦٤ ميجابايت · النسخة الكاملة، وليست ملخص Excel أو CSV.</p><label className={`ct-file-picker${saving ? ' ct-disabled' : ''}`} htmlFor={`${id}-file`}><Upload aria-hidden="true" />{saving && !committing.current ? 'جارٍ فحص النسخة…' : preview ? 'اختيار نسخة أخرى' : 'اختيار النسخة المحلية'}</label><input id={`${id}-file`} type="file" className="ct-file-input" accept=".json,application/json" disabled={saving} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void read(file); }} /></section>
      {error && <p className="dt-backup-error" role="alert">{error}</p>}
      {preview && <section className="dt-backup-preview" aria-labelledby={`${id}-preview`}><div><h3 id={`${id}-preview`}>معاينة قبل الاستعادة</h3><p dir="auto">{fileName}</p><p>{preview.exportedAt ? `تاريخ النسخة: ${new Date(preview.exportedAt).toLocaleString('ar-EG')}` : 'نسخة قديمة دون تاريخ إنشاء موثّق.'}</p>{preview.data.clinicName && <p>العيادة: {preview.data.clinicName}</p>}</div><dl className="dt-backup-counts">{localBackupSectionSummary(preview.data).map(item => <div key={item.key}><dt>{item.label}</dt><dd>{item.count === null ? 'غير موجود · يبقى الحالي' : `${item.count} سجل`}</dd></div>)}</dl><p className="ct-hint">تُستعاد الهوية والمظهر وترتيب الشريط والأسعار وإعدادات الرسائل إذا كانت موجودة بالملف. الأقسام الغائبة تبقى كما هي، ومفاتيح مزودي الخدمة لا تُستورد.</p><div className="dt-notice dt-notice-warning"><AlertCircle aria-hidden="true" /><p>الاستعادة استبدال وليست دمجًا. أي تعديلات أحدث داخل الأقسام الموجودة بالنسخة ستُستبدل، بما فيها تاريخ العلاج والتحصيلات والحسابات.</p></div><label className="dt-backup-consent"><input type="checkbox" checked={accepted} disabled={saving} onChange={event => setAccepted(event.target.checked)} /><span>احتفظت بنسخة حديثة وأفهم أن الأقسام المعروضة ستستبدل البيانات الحالية.</span></label></section>}
    </div><footer className="ct-footer"><button type="button" className="cc-button" disabled={saving && committing.current} onClick={close}>إلغاء وإغلاق</button><button type="button" className="cc-button cc-button-primary" disabled={saving || !preview || !accepted} onClick={confirmRestore}><Upload aria-hidden="true" />{saving && committing.current ? 'جارٍ الاستعادة…' : 'مراجعة وتأكيد الاستعادة'}</button></footer>
  </div></div>;
}

export function DataTransferManagement({ patients, contacts, canViewPatients, canImportPatients, canManageContacts, canExportPatientFinance, canExportFinancialReports, canManageFullBackup = false, onGetFullBackupSnapshot, onRestoreFullData, onImportPatients, onAuthorizePatientImport, onImportContacts, onAuthorizeContactExport, onAuthorizeDataExport, onExportFinancialReport }: {
  patients: Patient[]; contacts: ClinicContact[]; canViewPatients: boolean; canImportPatients: boolean; canManageContacts: boolean; canExportPatientFinance: boolean; canExportFinancialReports: boolean;
  onImportPatients: (patients: Patient[]) => Promise<void>; onAuthorizePatientImport: () => void; onImportContacts: (rows: ContactImportInput[]) => Promise<ContactImportSummary>;
  onAuthorizeContactExport: () => void; onAuthorizeDataExport: (kind: AuthorizationKind) => void; onExportFinancialReport: () => void;
  canManageFullBackup?: boolean; onGetFullBackupSnapshot: () => Promise<unknown>; onRestoreFullData: (input: unknown) => Promise<void>;
}) {
  const id = `data-transfer-${useId().replace(/[^\w-]/g, '')}`;
  const [section, setSection] = useState<'patients' | 'contacts' | 'reports' | 'backup'>('patients'), [dialog, setDialog] = useState<'patients-import' | 'contacts-import' | 'contacts-export' | 'backup-restore' | null>(null);
  const [columns, setColumns] = useState(defaultColumns), [query, setQuery] = useState(''), [filter, setFilter] = useState('all');
  const { showToast } = useToastAndConfirm();
  const { saving, run } = useConfirmedAction(); const mounted = useRef(true), version = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; version.current++; }; }, []);
  useEffect(() => { if (!canViewPatients || dialog === 'patients-import' && !canImportPatients || dialog === 'contacts-import' && !canManageContacts || dialog === 'backup-restore' && !canManageFullBackup) setDialog(null); }, [canViewPatients, canImportPatients, canManageContacts, canManageFullBackup, dialog]);
  useEffect(() => { if (section === 'backup' && !canManageFullBackup || section === 'reports' && !canExportFinancialReports) setSection('patients'); }, [section, canManageFullBackup, canExportFinancialReports]);
  const patientPhoneIndex = useMemo(() => createPhoneDirectoryIndex<Patient>(patients), [patients]);
  const contactRows = useMemo(() => contacts.map(contact => ({ ...contact, search: createContactSearchEntry(contact), matches: findRecordsByPhone<Patient>(patientPhoneIndex, contact.mobile) })), [contacts, patientPhoneIndex]);
  const filtered = useMemo(() => {
    const preparedQuery = prepareContactSearchQuery(query);
    return contactRows.filter(row => indexedContactMatchesSearch(row.search, preparedQuery) && (filter === 'all' || (filter === 'with-file' ? row.matches.length > 0 : !row.matches.length)));
  }, [contactRows, query, filter]);
  const toExport = (rows: typeof contactRows) => rows.map(row => ({ name: row.name, mobile: row.mobile, notes: row.notes || '', patientIds: row.matches.map(patient => patient.id) }));
  const exportPatients = async (format: 'xlsx' | 'csv') => {
    if (saving || !patients.length) return; const token = ++version.current;
    const containsFinance = canExportPatientFinance && (columns.totalRequired || columns.totalPaid || columns.totalRemain);
    const authorize = () => { if (!mounted.current || token !== version.current) throw new Error('تم إلغاء التصدير.'); onAuthorizeDataExport(containsFinance ? 'patient_finance' : 'patients'); };
    await run(async () => { try { await downloadPatientSpreadsheet(patients, columns, canExportPatientFinance, format, authorize); } catch (error) { if (mounted.current && token === version.current) throw error; } });
  };
  const exportBackup = async () => {
    if (saving || !canManageFullBackup) return;
    const token = ++version.current;
    const authorize = () => { if (!mounted.current || token !== version.current) throw new Error('تم إلغاء تنزيل النسخة.'); onAuthorizeDataExport('full_backup'); };
    await run(async () => {
      try { await downloadLocalClinicBackup(onGetFullBackupSnapshot, authorize); if (mounted.current && token === version.current) showToast('تم تجهيز تنزيل النسخة؛ تأكد من وجود ملف JSON في التنزيلات واحفظه في مكان آمن.', 'success'); }
      catch (failure) { if (mounted.current && token === version.current) throw failure; }
    });
  };
  if (!canViewPatients) return <p role="status" className="dt-notice">استيراد وتصدير الملفات غير متاح دون صلاحية عرض المرضى.</p>;
  return <section className="data-transfer" dir="rtl" aria-labelledby={`${id}-title`}><header className="dt-header"><span><FileSpreadsheet aria-hidden="true" /></span><div><h2 id={`${id}-title`}>التصدير والاستيراد</h2><p>أدوات البيانات في مكان واحد، مع مراجعة قبل أي إضافة.</p></div></header>
    <nav className="dt-tabs" aria-label="أقسام التصدير والاستيراد">{[{ key: 'patients', label: 'ملفات المرضى', icon: Users }, { key: 'contacts', label: 'جهات الاتصال', icon: ContactRound }, ...(canExportFinancialReports ? [{ key: 'reports', label: 'التقارير المالية', icon: FileSpreadsheet }] : []), ...(canManageFullBackup ? [{ key: 'backup', label: 'نسخة محلية كاملة', icon: Database }] : [])].map(item => <button key={item.key} type="button" aria-pressed={section === item.key} onClick={() => { version.current++; setSection(item.key as typeof section); }}><item.icon aria-hidden="true" />{item.label}</button>)}</nav>
    {section === 'patients' && <div className="dt-section"><div className="dt-section-heading"><div><h3>ملفات المرضى</h3><p>{patients.length} ملف · اختيار الأعمدة ثم تنزيل Excel أو CSV</p></div>{canImportPatients && <button type="button" className="cc-button cc-button-primary" disabled={saving} onClick={() => setDialog('patients-import')}><Upload aria-hidden="true" />استيراد ملفات المرضى</button>}</div><div className="dt-notice"><AlertCircle aria-hidden="true" /><p>التصدير هنا بيانات أساسية وملخص حساب اختياري، وليس نسخة احتياطية قابلة لاستعادة الجلسات والإيصالات. استخدم النسخة الكاملة لحفظ تاريخ العلاج. الملفات المنزلة تحتوي بيانات خاصة؛ احفظها في مكان آمن.</p></div><fieldset className="dt-columns" disabled={saving}><legend>الأعمدة المطلوبة</legend>{(Object.keys(PATIENT_COLUMNS) as Array<keyof PatientExportColumns>).filter(key => canExportPatientFinance || !['totalRequired', 'totalPaid', 'totalRemain'].includes(key)).map(key => <label key={key}><input type="checkbox" checked={columns[key]} onChange={event => setColumns(value => ({ ...value, [key]: event.target.checked }))} />{PATIENT_COLUMNS[key]}</label>)}</fieldset><div className="dt-actions"><button type="button" className="cc-button cc-button-primary" disabled={saving || !patients.length} onClick={() => void exportPatients('xlsx')}><Download aria-hidden="true" />{saving ? 'جارٍ التجهيز…' : 'تنزيل Excel'}</button><button type="button" className="cc-button" disabled={saving || !patients.length} onClick={() => void exportPatients('csv')}><Download aria-hidden="true" />تنزيل CSV</button></div></div>}
    {section === 'contacts' && <div className="dt-section"><div className="dt-section-heading"><div><h3>جهات الاتصال</h3><p>{contacts.length} جهة اتصال · أسماء وأرقام فقط، بدون حسابات أو بيانات علاج</p></div>{canManageContacts && <button type="button" className="cc-button cc-button-primary" onClick={() => setDialog('contacts-import')}><Upload aria-hidden="true" />استيراد جهات الاتصال</button>}</div><div className="dt-contact-filters"><label htmlFor={`${id}-query`}>بحث بالاسم أو الموبايل<div><Search aria-hidden="true" /><input id={`${id}-query`} type="search" dir="auto" value={query} onChange={event => setQuery(event.target.value)} placeholder="ابحث لتصدير نتائج محددة…" /></div></label><label htmlFor={`${id}-filter`}>تصفية التصدير<select id={`${id}-filter`} value={filter} onChange={event => setFilter(event.target.value)}><option value="all">كل جهات الاتصال</option><option value="with-file">أرقام لها ملفات</option><option value="without-file">بدون ملف مطابق</option></select></label></div><p className="dt-result" role="status">{query || filter !== 'all' ? `${filtered.length} نتيجة من ${contacts.length} جهة اتصال` : `${contacts.length} جهة اتصال متاحة للتصدير`}</p><div className="dt-actions"><button type="button" className="cc-button" disabled={!contacts.length} onClick={() => setDialog('contacts-export')}><Download aria-hidden="true" />تصدير جهات الاتصال</button>{(query || filter !== 'all') && <button type="button" className="cc-button cc-button-quiet" onClick={() => { setQuery(''); setFilter('all'); }}>مسح التصفية</button>}</div><div className="dt-notice"><AlertCircle aria-hidden="true" /><p>يمكن تنزيل القائمة كلها أو نتائج البحث والتصفية مع أرقام الملفات المطابقة. الاستيراد يضيف الأرقام الجديدة فقط ولا يفتح ملفات أو يغيّر الموافقة على الحملات.</p></div></div>}
    {section === 'reports' && canExportFinancialReports && <div className="dt-section"><h3>التقرير المالي والتحصيلات</h3><p>سجل التحصيلات المسموح لهذا الحساب، بصيغة CSV. ليس نسخة كاملة لسجلات المرضى.</p><div className="dt-actions"><button type="button" className="cc-button" onClick={onExportFinancialReport}><Download aria-hidden="true" />تنزيل التقرير المالي CSV</button></div></div>}
    {section === 'backup' && canManageFullBackup && <div className="dt-section"><div><h3>نسخة محلية كاملة للعيادة</h3><p>تحفظ المرضى والجلسات والإيصالات والمواعيد والمعامل والمصروفات والخامات والحسابات والفهارس والهوية وترتيب الشريط في ملف JSON.</p></div><div className="dt-notice dt-notice-warning"><AlertCircle aria-hidden="true" /><p>الملف غير مشفّر ويحتوي بيانات طبية ومالية وبيانات دخول مجزّأة. لا ترسله في المحادثات أو ترفعه إلى GitHub. مفاتيح الخدمات والجلسة وتذكر الدخول ليست ضمن النسخة. لا رفع إلى السحابة ولا مزامنة أجهزة من هذه الأدوات.</p></div><div className="dt-actions"><button type="button" className="cc-button cc-button-primary" disabled={saving} onClick={() => void exportBackup()}><Download aria-hidden="true" />{saving ? 'جارٍ تجهيز النسخة…' : 'تنزيل نسخة كاملة JSON'}</button><button type="button" className="cc-button" disabled={saving} onClick={() => setDialog('backup-restore')}><Upload aria-hidden="true" />اختيار نسخة للاستعادة</button></div><p>نزّل نسخة قبل تحديث البرنامج أو الاستعادة. لا تمسح بيانات المتصفح؛ قد تكون النسخة الوحيدة للعيادة.</p></div>}
    {dialog === 'patients-import' && canImportPatients && <PatientImportDialog patients={patients} onImport={onImportPatients} onAuthorize={onAuthorizePatientImport} onAuthorizeExport={() => onAuthorizeDataExport('patients')} onClose={() => setDialog(null)} />}
    {dialog === 'contacts-import' && canManageContacts && <ContactImportDialog contacts={contacts} patients={patients} onImport={onImportContacts} onAuthorizeExport={onAuthorizeContactExport} onClose={() => setDialog(null)} />}
    {dialog === 'contacts-export' && <ContactExportDialog allRows={toExport(contactRows)} filteredRows={toExport(filtered)} filterActive={!!query || filter !== 'all'} onAuthorizeExport={onAuthorizeContactExport} onClose={() => setDialog(null)} />}
    {dialog === 'backup-restore' && canManageFullBackup && <LocalBackupRestoreDialog onAuthorize={() => onAuthorizeDataExport('full_backup')} onRestore={onRestoreFullData} onClose={() => setDialog(null)} />}
  </section>;
}
