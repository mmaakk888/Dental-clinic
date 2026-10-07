import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { AlertCircle, ChevronLeft, ChevronRight, Download, FileCheck2, FileSpreadsheet, Upload, X } from 'lucide-react';
import type { ClinicContact, Patient } from '../../types';
import type { ContactImportInput } from '../../utils/contactTransfer';
import { previewContactImport } from '../../utils/contactTransfer';
import type { ContactExportRow } from '../../utils/contactSpreadsheets';
import { useAppointmentDialog } from '../appointments/useAppointmentDialog';
import { useToastAndConfirm } from '../common/ToastAndConfirm';
import { useConfirmedAction } from '../common/useConfirmedAction';
import './ContactTransferDialog.css';

export interface ContactImportResult { addedCount: number; duplicateCount: number; invalidCount: number }
type PreviewStatus = 'all' | 'new' | 'duplicate' | 'invalid';
const statusLabels: Record<Exclude<PreviewStatus, 'all'>, string> = { new: 'جاهز للإضافة', duplicate: 'رقم مكرر', invalid: 'يحتاج تصحيحًا' };
const PREVIEW_PAGE_SIZE = 20;

export function ContactImportDialog({ contacts, patients, onImport, onAuthorizeExport, onClose }: {
  contacts: ClinicContact[];
  patients: Patient[];
  onImport: (rows: ContactImportInput[]) => Promise<ContactImportResult>;
  onAuthorizeExport?: () => void;
  onClose: () => void;
}) {
  const id = `contact-import-${useId().replace(/[^\w-]/g, '')}`;
  const { showToast } = useToastAndConfirm();
  const { saving, run } = useConfirmedAction();
  const generation = useRef(0);
  const mounted = useRef(true);
  const committing = useRef(false);
  const [operation, setOperation] = useState<'read' | 'template' | 'import' | null>(null);
  const [inputs, setInputs] = useState<ContactImportInput[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [status, setStatus] = useState<PreviewStatus>('all');
  const [page, setPage] = useState(0);
  const { preview, previewError } = useMemo(() => {
    try { return { preview: inputs ? previewContactImport(inputs, contacts, patients) : null, previewError: '' }; }
    catch (error) { return { preview: null, previewError: error instanceof Error ? error.message : 'تعذّرت معاينة الملف. راجع البيانات وحاول اختيار الملف مرة أخرى.' }; }
  }, [inputs, contacts, patients]);
  const rows = preview?.rows.filter(row => status === 'all' || row.status === status) || [];
  const pages = Math.max(1, Math.ceil(rows.length / PREVIEW_PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const visible = rows.slice(currentPage * PREVIEW_PAGE_SIZE, (currentPage + 1) * PREVIEW_PAGE_SIZE);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current += 1; }; }, []);
  useEffect(() => { setPage(0); }, [status, inputs]);
  const requestClose = () => {
    if (committing.current) return;
    generation.current += 1;
    onClose();
  };
  const dialogRef = useAppointmentDialog(true, requestClose);
  const readFile = async (file: File | undefined) => {
    if (!file || saving) return;
    const version = ++generation.current;
    setOperation('read');
    await run(async () => {
      try {
        onAuthorizeExport?.();
        if (!/\.(xlsx|xls|csv)$/i.test(file.name)) throw new Error('اختَر ملف Excel بصيغة XLSX أو XLS، أو ملف CSV.');
        if (file.size > 5 * 1024 * 1024) throw new Error('حجم الملف أكبر من ٥ ميجابايت. قسّمه إلى ملفات أصغر ثم حاول مرة أخرى.');
        const { readContactSpreadsheet } = await import('../../utils/contactSpreadsheets');
        if (!mounted.current || generation.current !== version) return;
        const next = await readContactSpreadsheet(file);
        if (!mounted.current || generation.current !== version) return;
        onAuthorizeExport?.();
        // Validate shape/expanded payload before state can cause a render.
        previewContactImport(next, contacts, patients);
        setInputs(next);
        setFileName(file.name);
        setStatus('all');
        setPage(0);
      } catch (error) { if (mounted.current && generation.current === version) throw error; }
    });
    if (mounted.current && generation.current === version) setOperation(null);
  };
  const template = async () => {
    if (saving) return;
    const version = ++generation.current;
    setOperation('template');
    const authorize = () => {
      if (!mounted.current || generation.current !== version) throw new Error('تم إلغاء تنزيل القالب.');
      onAuthorizeExport?.();
    };
    await run(async () => {
      try {
        authorize();
        const { downloadContactTemplate } = await import('../../utils/contactSpreadsheets');
        authorize();
        await downloadContactTemplate(authorize);
      } catch (error) { if (mounted.current && generation.current === version) throw error; }
    });
    if (mounted.current && generation.current === version) setOperation(null);
  };
  const apply = async () => {
    if (saving || committing.current || !inputs || !preview?.newCount) return;
    committing.current = true;
    setOperation('import');
    try {
      await run(async () => {
        const result = await onImport(inputs);
        if (!mounted.current) return;
        showToast(`تمت إضافة ${result.addedCount} جهة اتصال، وتجاهل ${result.duplicateCount} رقم مكرر و${result.invalidCount} صف غير صالح. لم تُنشأ ملفات مرضى.`, 'success', { duration: 8000 });
        onClose();
      });
    } finally {
      committing.current = false;
      if (mounted.current) setOperation(null);
    }
  };

  return <div className="clinic-modal-overlay ct-overlay" dir="rtl" onClick={event => { if (event.target === event.currentTarget) requestClose(); }}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-intro`} tabIndex={-1} className="clinic-modal-panel clinic-modal-panel--framed ct-dialog">
      <header className="ct-header"><span className="ct-icon"><Upload aria-hidden="true" /></span><div><h2 id={`${id}-title`}>استيراد جهات الاتصال</h2><p id={`${id}-intro`}>ارفع الملف، راجع الأسماء والأرقام، ثم أكّد الإضافة.</p></div><button type="button" className="cc-icon-button" aria-label="إلغاء وإغلاق استيراد جهات الاتصال" disabled={operation === 'import'} onClick={requestClose}><X aria-hidden="true" /></button></header>
      <div className="ct-body overflow-y-auto">
        <section className="ct-upload-section" aria-label="اختيار ملف جهات الاتصال">
          <div className="ct-upload-heading"><FileSpreadsheet aria-hidden="true" /><div><h3>ملف Excel أو CSV</h3><p>أول ورقة فقط · حتى ٥ ميجابايت و٥٠٠٠ صف</p></div></div>
          <label className={`ct-file-picker${saving ? ' ct-disabled' : ''}`} htmlFor={`${id}-file`}><Upload aria-hidden="true" /><span>{operation === 'read' ? 'جارٍ قراءة الملف…' : fileName ? 'اختيار ملف آخر' : 'اختيار ملف'}</span></label>
          <input id={`${id}-file`} className="ct-file-input" type="file" accept=".xlsx,.xls,.csv" disabled={saving} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void readFile(file); }} />
          <p className="ct-hint">الأعمدة المطلوبة: الاسم ورقم الموبايل. الملاحظات اختيارية. احفظ عمود الموبايل كنص للحفاظ على الصفر الأول؛ لن نخمّن الأرقام الناقصة.</p>
          <button type="button" className="cc-button cc-button-quiet" disabled={saving} onClick={() => void template()}><Download aria-hidden="true" />{operation === 'template' ? 'جارٍ تجهيز القالب…' : 'تنزيل قالب فارغ'}</button>
        </section>
        {previewError && <div className="ct-notice ct-notice-error" role="alert"><AlertCircle aria-hidden="true" /><p>{previewError} لم يُحفظ أي تغيير؛ أعد اختيار ملف صالح أو أغلق النافذة وراجع القائمة.</p></div>}
        {preview && <section className="ct-preview" aria-labelledby={`${id}-preview-title`}>
          <div className="ct-preview-title"><h3 id={`${id}-preview-title`}>معاينة قبل الحفظ</h3><p dir="auto">{fileName}</p></div>
          <div className="ct-counts" aria-label="نتيجة فحص الملف"><div className="ct-count-new"><strong>{preview.newCount}</strong><span>جاهز للإضافة</span></div><div className="ct-count-duplicate"><strong>{preview.duplicateCount}</strong><span>رقم مكرر · يُتجاهل</span></div><div className="ct-count-invalid"><strong>{preview.invalidCount}</strong><span>غير صالح · يُتجاهل</span></div></div>
          <div className="ct-preview-filter"><label htmlFor={`${id}-status`}>الصفوف المعروضة</label><select id={`${id}-status`} value={status} disabled={saving} onChange={event => setStatus(event.target.value as PreviewStatus)}><option value="all">كل الصفوف ({preview.rows.length})</option><option value="new">جاهز للإضافة ({preview.newCount})</option><option value="duplicate">الأرقام المكررة ({preview.duplicateCount})</option><option value="invalid">يحتاج تصحيحًا ({preview.invalidCount})</option></select></div>
          <div className="ct-preview-list">{visible.map((row, index) => <article key={`${row.rowNumber}-${index}`} className={`ct-preview-row ct-preview-row-${row.status}`}><div className="ct-row-heading"><span>صف {row.rowNumber}</span><strong className={`ct-row-status ct-row-status-${row.status}`}>{statusLabels[row.status]}</strong></div><h4 dir="auto">{row.name || 'بدون اسم'}</h4><p className="ct-row-phone" dir="ltr">{row.mobile || 'بدون رقم'}</p><p className="ct-row-message">{row.message}</p>{row.patientIds.length > 0 && <div className="ct-row-files" aria-label="ملفات مسجلة بنفس الرقم">{row.patientIds.map(patientId => <span key={patientId}><FileCheck2 aria-hidden="true" />ملف #{patientId}</span>)}</div>}</article>)}{!visible.length && <p className="ct-no-rows">لا توجد صفوف في هذا الاختيار.</p>}</div>
          {pages > 1 && <nav className="ct-pagination" aria-label="صفحات معاينة الاستيراد"><button type="button" className="cc-button" disabled={saving || currentPage === 0} onClick={() => setPage(Math.max(0, currentPage - 1))}><ChevronRight aria-hidden="true" />السابق</button><span aria-live="polite">{currentPage + 1} / {pages}</span><button type="button" className="cc-button" disabled={saving || currentPage === pages - 1} onClick={() => setPage(Math.min(pages - 1, currentPage + 1))}>التالي<ChevronLeft aria-hidden="true" /></button></nav>}
        </section>}
        <div className="ct-notice"><AlertCircle aria-hidden="true" /><p>هنضيف الصفوف الجديدة الصالحة فقط ونتجاهل المكرر وغير الصالح. جهات الاتصال الموجودة مش هتتعدّل، ومش هنفتح ملفات مرضى أو نسجّل موافقة على الحملات. الأرقام المرتبطة بملفات تظهر للتنبيه فقط، من غير دمج.</p></div>
        {preview && !preview.newCount && <p className="ct-hint" role="status">لا توجد جهات اتصال جديدة صالحة للإضافة. صحّح الملف أو اختَر ملفًا آخر؛ لم يُحفظ أي تغيير.</p>}
      </div>
      <footer className="ct-footer"><button type="button" className="cc-button" disabled={operation === 'import'} onClick={requestClose}>إلغاء وإغلاق</button><button type="button" className="cc-button cc-button-primary" disabled={saving || !preview?.newCount} onClick={() => void apply()}><Upload aria-hidden="true" />{operation === 'import' ? 'جارٍ الاستيراد…' : `استيراد ${preview?.newCount || 0} جهة اتصال`}</button></footer>
    </div>
  </div>;
}

export function ContactExportDialog({ allRows, filteredRows, filterActive, onAuthorizeExport, onClose }: {
  allRows: ContactExportRow[];
  filteredRows: ContactExportRow[];
  filterActive: boolean;
  onAuthorizeExport: () => void;
  onClose: () => void;
}) {
  const id = `contact-export-${useId().replace(/[^\w-]/g, '')}`;
  const { saving, run } = useConfirmedAction();
  const { showToast } = useToastAndConfirm();
  const [scope, setScope] = useState<'all' | 'filtered'>(filterActive ? 'filtered' : 'all');
  const [format, setFormat] = useState<'xlsx' | 'csv'>('xlsx');
  const generation = useRef(0);
  const mounted = useRef(true);
  const rows = scope === 'all' ? allRows : filteredRows;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current += 1; }; }, []);
  const requestClose = () => { generation.current += 1; onClose(); };
  const dialogRef = useAppointmentDialog(true, requestClose);
  const download = async () => {
    if (saving || !rows.length) return;
    const version = ++generation.current;
    const authorize = () => {
      if (!mounted.current || version !== generation.current) throw new Error('تم إلغاء تصدير جهات الاتصال.');
      onAuthorizeExport();
    };
    await run(async () => {
      try {
        authorize();
        const { downloadContactSpreadsheet } = await import('../../utils/contactSpreadsheets');
        authorize();
        await downloadContactSpreadsheet(rows, format, authorize);
        if (!mounted.current || version !== generation.current) return;
        showToast('تم تجهيز الملف وطلب تنزيله من المتصفح. احتفظ به في مكان آمن.', 'success');
        onClose();
      } catch (error) { if (mounted.current && version === generation.current) throw error; }
    });
  };

  return <div className="clinic-modal-overlay ct-overlay" dir="rtl" onClick={event => { if (event.target === event.currentTarget) requestClose(); }}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-intro`} tabIndex={-1} className="clinic-modal-panel clinic-modal-panel--framed ct-dialog ct-dialog-export">
      <header className="ct-header"><span className="ct-icon"><Download aria-hidden="true" /></span><div><h2 id={`${id}-title`}>تصدير جهات الاتصال</h2><p id={`${id}-intro`}>اختَر الأسماء المطلوبة وصيغة الملف.</p></div><button type="button" className="cc-icon-button" aria-label="إلغاء وإغلاق تصدير جهات الاتصال" onClick={requestClose}><X aria-hidden="true" /></button></header>
      <div className="ct-body overflow-y-auto"><fieldset className="ct-export-scope" disabled={saving}><legend>الأسماء المطلوب تصديرها</legend><label><input type="radio" name={`${id}-scope`} value="all" checked={scope === 'all'} onChange={() => setScope('all')} /><span><strong>كل جهات الاتصال</strong><small>{allRows.length} جهة اتصال</small></span></label><label><input type="radio" name={`${id}-scope`} value="filtered" checked={scope === 'filtered'} onChange={() => setScope('filtered')} /><span><strong>نتائج البحث والتصفية الحالية</strong><small>{filteredRows.length} جهة اتصال · كل النتائج، مش الصفحة الظاهرة فقط</small></span></label></fieldset>
        <div className="ct-format-field"><label htmlFor={`${id}-format`}>صيغة الملف</label><select id={`${id}-format`} disabled={saving} value={format} onChange={event => setFormat(event.target.value as 'xlsx' | 'csv')}><option value="xlsx">Excel (.xlsx)</option><option value="csv">CSV (.csv)</option></select></div>
        <p className="ct-export-count" role="status">سيحتوي الملف على {rows.length} جهة اتصال.</p><p className="ct-hint">المحتوى: الاسم والموبايل والملاحظة وأرقام الملفات المطابقة فقط، بدون جلسات أو دفعات أو بيانات مالية.</p><div className="ct-notice"><AlertCircle aria-hidden="true" /><p>الملف يحتوي أسماء وأرقام خاصة بالعيادة. صدّره للحاجة فقط، واحفظه في مكان آمن ولا تشاركه بدون صلاحية.</p></div>
      </div><footer className="ct-footer"><button type="button" className="cc-button" onClick={requestClose}>إلغاء وإغلاق</button><button type="button" className="cc-button cc-button-primary" disabled={saving || !rows.length} onClick={() => void download()}><Download aria-hidden="true" />{saving ? 'جارٍ تجهيز الملف…' : 'تنزيل الملف'}</button></footer>
    </div>
  </div>;
}
