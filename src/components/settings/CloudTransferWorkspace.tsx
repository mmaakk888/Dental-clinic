import React, { useId, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowRight, CheckCircle2, Copy, FileSpreadsheet, Pause, RefreshCw, Upload, X } from 'lucide-react';
import type { CloudTransferWorkspaceController, CloudTransferResult } from '../../utils/cloudTransferWorkspaceController';
import type { CloudTransferKind } from '../../utils/cloudTransferProjection';
import './CloudTransferWorkspace.css';

/** Explicit actions only. Mounting this owner workspace never reads files,
 * cloud data, prices, local storage or journal history. */
export function CloudTransferWorkspace({ controller, previewOnly = false, disabled = false, onClose }: {
  controller: CloudTransferWorkspaceController; previewOnly?: boolean; disabled?: boolean; onClose?: () => void;
}) {
  const raw = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  const state = previewOnly ? { ...raw, preview: null, pending: null, results: [], loading: false, running: false, saveStatus: 'idle' as const, error: '', notice: '' } : raw;
  const id = `cloud-transfer-${useId().replace(/[^\w-]/g, '')}`;
  const [kind, setKind] = useState<CloudTransferKind>('patients'), [page, setPage] = useState(0), [resumeId, setResumeId] = useState(''), [copied, setCopied] = useState('');
  const live = useRef({ controller, previewOnly, disabled }); live.current = { controller, previewOnly, disabled };
  const allowed = () => live.current.controller === controller && !live.current.previewOnly && !live.current.disabled && !controller.getState().closed;
  const busy = disabled || previewOnly || state.closed || state.loading || state.running || !!state.pending;
  const preview = state.preview, pages = Math.max(1, Math.ceil((preview?.rows.length ?? 0) / 20)), shownPage = Math.min(page, pages - 1);
  const completed = new Map<number, CloudTransferResult>(state.results.map(result => [result.rowNumber, result]));
  const guardPreview = () => allowed() && controller.getState().preview === preview;
  const pending = state.pending;
  const pendingCurrent = () => allowed() && pending !== null && controller.getState().pending === pending;
  return <section className="cloud-transfer" dir="rtl" aria-labelledby={`${id}-title`}>
    <header className="ctw-heading"><div><h2 id={`${id}-title`}><FileSpreadsheet aria-hidden="true" />استيراد الملفات والأرقام</h2><p>للـمالك فقط · من ملف تختاره أنت، وليس من بيانات المتصفح</p></div>
      {onClose && <button type="button" className="ctw-button" disabled={!previewOnly && (disabled || !controller.canClose())} onClick={() => { if (live.current.controller === controller && (live.current.previewOnly || allowed() && controller.canClose())) onClose(); }}><ArrowRight aria-hidden="true" />رجوع</button>}</header>
    <div className="ctw-note">يُحفظ كل صف كعملية مستقلة. التوقف أو الإغلاق لا يمسح ما حُفظ سابقًا. لا تُستورد جلسات أو مبالغ أو كلمات سر أو موافقة تسويقية، ولا تُستبدل ملفات موجودة.</div>
    <section className="ctw-panel"><h3>١. اختر الملف وراجع المعاينة</h3><div className="ctw-controls">
      <label htmlFor={`${id}-kind`}>نوع البيانات<select id={`${id}-kind`} value={kind} disabled={busy || !!preview} onChange={event => { if (allowed() && !controller.getState().preview) setKind(event.target.value as CloudTransferKind); }}><option value="patients">ملفات المرضى التاريخية</option><option value="contacts">جهات الاتصال</option></select></label>
      <label className={`ctw-upload${busy ? ' is-disabled' : ''}`} htmlFor={`${id}-file`}><Upload aria-hidden="true" />{state.loading ? 'جارٍ قراءة الملف ومطابقة السحابة…' : 'اختيار Excel أو CSV'}<input id={`${id}-file`} type="file" accept=".xlsx,.xls,.csv" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file && allowed() && controller.getState().preview === preview) { setPage(0); void controller.readFile(kind, file, preview); } }} /></label>
    </div><p className="ctw-help">الورقة الأولى فقط · حتى ٥ ميجابايت و٥٠٠٠ صف · الهاتف كنص · أرقام الملفات التاريخية تبقى نفسها. التاريخ الفارغ يظهر «غير مسجل»، ولا يُستبدل بتاريخ اليوم.</p></section>
    {state.error && <p className="ctw-error" role="alert">{state.error}</p>}{state.notice && <p className="ctw-note" role="status">{state.notice}</p>}
    {pending && <section className="ctw-pending" aria-label="عملية الاستيراد الحالية"><h3>{state.saveStatus === 'refresh-required' ? 'الحفظ مؤكد — تحديث القراءة فقط' : 'لا تبدأ عملية بديلة لهذا الصف'}</h3>
      <p>الصف {pending.rowNumber || 'المسترجع'}{pending.fileNo !== null ? ` · ملف #${pending.fileNo}` : ''}</p><label htmlFor={`${id}-operation`}>احتفظ بمعرف العملية لاسترجاعها بعد إعادة التحميل</label>
      <div className="ctw-operation"><input id={`${id}-operation`} readOnly dir="ltr" value={pending.operationId} onFocus={event => event.target.select()} /><button type="button" className="ctw-button" onClick={() => { if (!pendingCurrent() || !navigator.clipboard) return; void navigator.clipboard.writeText(pending.operationId).then(() => { if (pendingCurrent()) setCopied(pending.operationId); }).catch(() => undefined); }}><Copy aria-hidden="true" />{copied === pending.operationId ? 'تم النسخ' : 'نسخ'}</button></div>
      <div className="ctw-actions"><button type="button" className="ctw-button is-primary" disabled={disabled || state.loading || state.running} onClick={() => { if (pendingCurrent()) void controller.retry(pending.operationId); }}><RefreshCw aria-hidden="true" />إعادة التحقق بنفس العملية</button>
        <button type="button" className="ctw-button" disabled={disabled || state.loading || state.running || state.saveStatus === 'refresh-required'} onClick={() => { if (pendingCurrent()) void controller.cancelPending(pending.operationId); }}><X aria-hidden="true" />إلغاء هذا الصف بعد تأكيد الخادم</button></div></section>}
    {preview && <section className="ctw-panel"><h3>٢. راجع ثم أكّد</h3><div className="ctw-counts"><span><b>{preview.readyCount}</b>صالح</span><span><b>{preview.duplicateCount}</b>مكرر · يُتجاهل</span><span><b>{preview.invalidCount}</b>يحتاج تصحيحًا</span><span><b>{state.results.filter(result => result.status === 'committed').length}</b>محفوظ ومؤكد</span></div>
      <p className="ctw-help">المطابقة بتاريخ <bdi dir="ltr">{preview.readTime}</bdi>. الأرقام أو الأسماء المشتركة تنبيه وليست إثباتًا أن الشخص واحد.</p>
      <div className="ctw-rows">{preview.rows.slice(shownPage * 20, (shownPage + 1) * 20).map(row => { const done = completed.get(row.rowNumber); return <article key={row.rowNumber} className={`ctw-row is-${done?.status ?? row.status}`}><div className="ctw-row-title"><strong>{row.name || 'بدون اسم'}</strong><span>صف {row.rowNumber} · {done?.status === 'committed' ? 'حُفظ' : done?.status === 'cancelled' ? 'أُلغي' : row.status === 'ready' ? 'صالح للإضافة' : row.status === 'duplicate' ? 'مكرر' : 'غير صالح'}</span></div>
        <div className="ctw-row-details">{row.fileNo !== null && <b>ملف #{row.fileNo}</b>}<bdi dir="ltr">{row.mobile || 'بدون هاتف'}</bdi></div><p>{row.message}</p>
        {!!row.matchingFileCount && <details><summary>مطابقات مع {row.matchingFileCount} ملف — لا دمج تلقائي</summary><ul>{row.matchingFiles.map(match => <li key={match.fileNo}>#{match.fileNo} · {match.name} · {match.reason === 'phone' ? 'نفس الهاتف' : match.reason === 'name' ? 'اسم مطابق بعد التنسيق' : 'هاتف واسم مطابقان'}</li>)}</ul>{row.matchingFileCount > row.matchingFiles.length && <p>نعرض أول {row.matchingFiles.length} مطابقة فقط. راجع الدليل لجميع الملفات؛ لم نستنتج هوية من رقم الأسرة.</p>}</details>}
      </article>; })}</div>
      {pages > 1 && <nav className="ctw-actions" aria-label="صفحات معاينة الاستيراد"><button type="button" className="ctw-button" disabled={shownPage === 0} onClick={() => setPage(Math.max(0, shownPage - 1))}>السابق</button><span>{shownPage + 1} / {pages}</span><button type="button" className="ctw-button" disabled={shownPage === pages - 1} onClick={() => setPage(Math.min(pages - 1, shownPage + 1))}>التالي</button></nav>}
      <div className="ctw-actions"><button type="button" className="ctw-button is-primary" disabled={busy || !preview.readyCount || preview.rows.every(row => row.status !== 'ready' || completed.has(row.rowNumber))} onClick={() => { if (guardPreview()) void controller.confirm(preview); }}><CheckCircle2 aria-hidden="true" />{state.stopped ? 'متابعة الصفوف المتبقية' : 'تأكيد استيراد الصفوف الصالحة'}</button>
        {state.running && <button type="button" className="ctw-button" disabled={disabled} onClick={() => { if (guardPreview()) controller.stopAfterCurrent(); }}><Pause aria-hidden="true" />توقف بعد الصف الحالي</button>}
        <button type="button" className="ctw-button" disabled={busy} onClick={() => { if (guardPreview()) controller.discardPreview(preview); }}>إغلاق الملف دون مسح ما حُفظ</button></div></section>}
    {!preview && !pending && <section className="ctw-panel"><h3>استرجاع صف بعد إعادة التحميل</h3><p className="ctw-help">استخدم نوع البيانات ومعرف العملية التي احتفظت بها. بعد تأكيدها، أعد اختيار الملف؛ الأرقام والملفات الموجودة ستظهر مكررة دون استبدال.</p><div className="ctw-controls"><label htmlFor={`${id}-resume`}>معرف العملية<input id={`${id}-resume`} dir="ltr" value={resumeId} maxLength={36} disabled={busy} onChange={event => setResumeId(event.target.value)} /></label><button type="button" className="ctw-button" disabled={busy || !resumeId} onClick={() => { if (allowed() && !controller.getState().preview && !controller.getState().pending) void controller.resume(kind, resumeId); }}><RefreshCw aria-hidden="true" />استرجاع نفس العملية</button></div></section>}
  </section>;
}
