import React, { useState, useSyncExternalStore } from 'react';
interface OperationState { pendingOperationId: string | null; saveStatus: string; closed: boolean }
export function CloudOriginalOperationRecovery(props: { label: string; disabled?: boolean;
  bridge: { getState(): OperationState; subscribe(listener: () => void): () => void; recoverPending(): Promise<boolean>; cancelPending(): Promise<boolean> } }) {
  const state = useSyncExternalStore(props.bridge.subscribe, props.bridge.getState, props.bridge.getState);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  if (!state.pendingOperationId || state.closed) return null;
  const act = async (cancel: boolean) => { if (busy || props.disabled) return; setBusy(true); setMessage('');
    try { const okay = await (cancel ? props.bridge.cancelPending() : props.bridge.recoverPending());
      if (!okay) setMessage('لم يتأكد الإجراء. أغلق نافذة التحرير أولًا أو أعد حفظها بنفس القيم، ولا تنشئ عملية بديلة.');
    } catch { setMessage('تعذر التأكد من العملية الأصلية؛ لم ننشئ عملية بديلة.'); } finally { setBusy(false); } };
  return <aside dir="rtl" role="status" className="mb-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-7 text-amber-950">
    <p>{props.label}: توجد محاولة تحتاج تحققًا قبل التنقل، وليست مسودة قراءة.</p>
    <div className="mt-2 flex flex-wrap gap-2"><button type="button" disabled={busy || props.disabled} onClick={() => void act(false)} className="min-h-11 rounded-xl bg-amber-900 px-4 font-bold text-white">التحقق من نفس العملية</button>
      <button type="button" disabled={busy || props.disabled || state.saveStatus === 'refresh-required'} onClick={() => void act(true)} className="min-h-11 rounded-xl border border-amber-300 px-4 font-bold">إلغاء المحاولة إن لم تُنفّذ</button></div>{message && <p role="alert">{message}</p>}
  </aside>;
}
