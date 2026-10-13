import { useCallback, useEffect, useId, useRef, useSyncExternalStore } from 'react';
import { ArrowDown, History, RefreshCw, RotateCcw } from 'lucide-react';
import type { CloudOperationIntent } from '../../utils/cloudOperationIntent';
import type { CloudProfileContactRecoveryController } from '../../utils/cloudProfileContactRecoveryController';

const button = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition-colors duration-150 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-45 motion-reduce:transition-none';
const label = { prepared: 'محضّرة — تحتاج مراجعة', committed: 'تم الحفظ — راجع النتيجة', cancelled: 'ملغاة' } as const;
const color = { prepared: 'bg-amber-50 text-amber-900', committed: 'bg-emerald-50 text-emerald-900', cancelled: 'bg-slate-100 text-slate-600' } as const;
function title(intent: CloudOperationIntent) {
  const data = intent.kind === 'contact' ? intent.command.contact : intent.command.profile;
  const name = data && typeof data === 'object' && !Array.isArray(data) && typeof data.name === 'string' ? data.name : '';
  const action = intent.command.action === 'import' ? 'استيراد' : intent.command.action === 'create' ? 'إنشاء' : intent.command.action === 'delete' ? 'حذف' : 'تعديل';
  const file = intent.kind === 'patient-profile' && intent.command.action === 'import' && typeof intent.command.fileNo === 'number' ? ` #${intent.command.fileNo}` : '';
  return `${action} ${intent.kind === 'contact' ? 'جهة اتصال' : 'ملف مريض'}${file}${name ? ` — ${name}` : ''}`;
}

/** Explicit read-only history; rendering/subscribing never reads the server.
 * Preview hides even mistakenly supplied rows and disables retained actions. */
export default function CloudProfileContactRecoveryPanel({ controller, onResume, disabled, previewOnly = false, canAct }: {
  controller: CloudProfileContactRecoveryController;
  onResume: (id: string) => void;
  disabled: boolean;
  previewOnly?: boolean;
  /** Recheck parent draft/lifetime for retained callbacks, not just render props. */
  canAct: () => boolean;
}) {
  const prefix = useId();
  const subscribe = useCallback((notify: () => void) => controller.subscribe(() => notify()), [controller]);
  const getState = useCallback(() => controller.getState(), [controller]);
  const state = useSyncExternalStore(subscribe, getState, getState);
  const lease = { controller, previewOnly, disabled, canAct, onResume };
  const latest = useRef<typeof lease | null>(lease);
  latest.current = lease;
  useEffect(() => {
    if (latest.current === null) latest.current = lease;
    return () => { if (latest.current?.controller === controller) latest.current = null; };
  }, [controller]);
  const unavailable = previewOnly || state.closed;
  const rows = unavailable ? [] : state.records;
  const blocked = unavailable || disabled || state.loading;
  const allowed = () => {
    if (latest.current !== lease || previewOnly || disabled) return null;
    let parentAllows = false;
    try { parentAllows = canAct() === true; } catch { /* Fail closed. */ }
    const current = controller.getState();
    return latest.current === lease && parentAllows && !current.closed && !current.loading ? current : null;
  };
  return <section dir="rtl" aria-labelledby={`${prefix}-title`} className="min-w-0 space-y-3 rounded-2xl border border-slate-200 bg-white p-3 sm:p-4">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0"><h3 id={`${prefix}-title`} className="flex items-center gap-2 font-bold text-slate-900"><History aria-hidden="true" size={20} />سجل الحفظ والاسترجاع</h3>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">لو انقطع تأكيد الحفظ أو فتحت الصفحة من جديد، راجع العملية الأصلية هنا. الاستئناف لا ينشئ رقم ملف أو عملية بديلة.</p></div>
      <button type="button" className={button} disabled={blocked} onClick={() => { if (allowed()) void controller.loadFirst(); }}><RefreshCw aria-hidden="true" size={17} />{state.loaded && !unavailable ? 'تحديث السجل' : 'تحميل سجل العمليات'}</button>
    </div>
    <p className="text-xs leading-6 text-slate-500">القائمة تخص حسابك ونوع السجل الحالي، بترتيب المعرف وليس الأحدث. قد تكون جزئية حتى تحميل بقية الصفحات. فتحها لا ينفذ أو يلغي أي عملية.</p>
    {!unavailable && state.error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm leading-7 text-rose-900">{state.error}</p>}
    {!unavailable && state.notice && <p role="status" className="rounded-xl bg-blue-50 p-3 text-sm leading-7 text-blue-950">{state.notice}</p>}
    {!unavailable && state.loading && <p role="status" className="text-sm text-slate-600">جارٍ قراءة حالة العمليات…</p>}
    <div className="min-w-0 space-y-2" aria-busy={!unavailable && state.loading}>
      {rows.map(intent => <article key={intent.operationId} className="min-w-0 rounded-xl border border-slate-200 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0 flex-1"><p className="break-words text-sm font-semibold text-slate-900 [overflow-wrap:anywhere]">{title(intent)}</p>
          <time dateTime={intent.createdAt} dir="ltr" className="mt-1 block text-right text-xs tabular-nums text-slate-500">{intent.createdAt.slice(0, 10)} · {intent.createdAt.slice(11, 16)} UTC</time></div>
          <span className={`rounded-lg px-2 py-1 text-xs font-semibold ${color[intent.status]}`}>{label[intent.status]}</span></div>
        <bdi dir="ltr" className="mt-2 block break-all text-xs tabular-nums text-slate-500">{intent.operationId}</bdi>
        {intent.status !== 'cancelled' && <button type="button" className={`${button} mt-2 w-full sm:w-auto`} disabled={blocked} onClick={() => {
          const current = allowed();
          if (current?.records.includes(intent)) onResume(intent.operationId);
        }}><RotateCcw aria-hidden="true" size={17} />{intent.status === 'committed' ? 'التحقق من العملية وعرض النتيجة' : 'مراجعة واستئناف العملية الأصلية'}</button>}
      </article>)}
      {!rows.length && !state.loading && <p className="rounded-xl border border-dashed border-slate-200 p-4 text-sm leading-7 text-slate-500">{unavailable ? 'معاينة فارغة — تحميل السجل والاستئناف غير مفعّلين.' : state.loaded ? 'لا توجد عمليات في الصفحات المقروءة. حدّث السجل لالتقاط عمليات جديدة.' : 'اضغط تحميل السجل لقراءة العمليات من الخادم.'}</p>}
    </div>
    <button type="button" className={`${button} w-full`} disabled={blocked || !state.nextAfterId} onClick={() => { if (allowed()?.nextAfterId) void controller.loadMore(); }}><ArrowDown aria-hidden="true" size={17} />تحميل ٢٥ عملية أخرى</button>
  </section>;
}
