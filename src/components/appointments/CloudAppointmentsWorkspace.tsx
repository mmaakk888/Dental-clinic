import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { CalendarDays, Check, History, MessageCircle, Pencil, Phone, Plus, RefreshCw, X } from 'lucide-react';
import type { AppointmentStatus } from '../../types';
import type { CloudAppointmentWorkspaceController, CloudAppointmentWorkspaceDraft } from '../../utils/cloudAppointmentWorkspaceController';
import { normalizeContactPhone } from '../../utils/clinicContacts';

const labels: Record<AppointmentStatus, string> = { scheduled: 'محجوز', confirmed: 'مؤكد', waiting: 'في الانتظار', attended: 'حضر',
  cancelled: 'ملغي', apologized: 'اعتذر', no_show: 'لم يحضر' };
const button = 'min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 disabled:opacity-40';
const primary = `${button} !bg-indigo-600 !text-white !border-indigo-600`;
const input = 'w-full min-h-[44px] rounded-xl border border-slate-200 bg-white p-3 text-base text-slate-900';

/** Protected controller owns every action. Mounting this view performs no
 * read or Auth work. All links are manual; opening WhatsApp is not delivery. */
export interface CloudAppointmentsWorkspaceProps {
  controller: CloudAppointmentWorkspaceController; onClose(): void; disabled?: boolean;
}
export default function CloudAppointmentsWorkspace({ controller, onClose, disabled = false }: CloudAppointmentsWorkspaceProps) {
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  const [query, setQuery] = useState('');
  const lease = { controller, state, disabled, onClose };
  const latest = useRef<typeof lease | null>(lease); latest.current = lease;
  useEffect(() => {
    if (latest.current === null) latest.current = lease;
    return () => { if (latest.current?.controller === controller) latest.current = null; };
  }, [controller]);
  const busy = disabled || state.closed || state.loading || state.historyLoading || ['preparing', 'saving'].includes(state.saveStatus);
  const locked = busy || state.saveStatus !== 'idle';
  const draft = state.draft, snapshot = state.loaded ? state.snapshot : null;
  const rows = (snapshot?.records ?? []).filter(record => !query.trim() || `${record.data.patientName} ${record.data.phone} ${record.data.reason}`.includes(query.trim()));
  const allowed = () => {
    const current = latest.current;
    return current?.controller === controller && !current.disabled && current.state === state && controller.getState() === state
      && latest.current === current && !state.closed && !state.loading && !state.historyLoading && !['preparing', 'saving'].includes(state.saveStatus);
  };
  const browse = () => allowed() && controller.canClose();
  function update(source: CloudAppointmentWorkspaceDraft, patch: Partial<CloudAppointmentWorkspaceDraft['data']>) {
    if (allowed() && !locked && controller.getState().draft === source) controller.updateDraft({ ...source, data: { ...source.data, ...patch } }, source);
  }
  const field = (label: string, key: keyof CloudAppointmentWorkspaceDraft['data'], type = 'text') => draft && <label className="space-y-2 text-sm font-bold text-slate-600">{label}<input className={input} type={type}
    value={String(draft.data[key] ?? '')} disabled={locked} onChange={event => update(draft, { [key]: event.target.value })} /></label>;
  return <section className="mx-auto w-full max-w-6xl space-y-4 pb-24" dir="rtl" aria-label="مواعيد العيادة">
    <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-3"><CalendarDays className="text-indigo-600" size={25} /><div><h2 className="font-extrabold text-lg text-slate-900">مواعيد العيادة</h2><p className="text-sm text-slate-500">جدول اليوم كاملًا، بما فيه الحجوزات الملغاة</p></div></div>
      <div className="flex flex-wrap gap-2"><button className={button} disabled={busy || !controller.canClose()} onClick={() => { if (browse()) void controller.refresh(); }}><RefreshCw size={18} />تحديث</button>
        <button className={button} disabled={busy || !controller.canClose()} onClick={() => { if (browse()) latest.current?.onClose(); }}><X size={18} />إغلاق</button></div>
    </header>
    <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-[auto_1fr_auto]">
      <label className="text-sm font-bold text-slate-600">اليوم<input aria-label="تاريخ جدول المواعيد" type="date" className={`${input} mt-2`} value={controller.getSelectedDate()} disabled={busy || !controller.canClose()}
        onChange={event => { if (browse()) void controller.selectDate(event.target.value); }} /></label>
      <label className="text-sm font-bold text-slate-600">ابحث في هذا اليوم<input className={`${input} mt-2`} value={query} disabled={busy} onChange={event => { if (allowed()) setQuery(event.target.value); }} placeholder="اسم المريض أو الهاتف" /></label>
      <button className={`${primary} self-end`} disabled={busy || !state.loaded || !controller.canClose()} onClick={() => { if (browse() && state.loaded) controller.beginNew(); }}><Plus size={19} />حجز موعد</button>
    </div>
    {state.loading && <p role="status" className="rounded-xl bg-blue-50 p-3 text-sm text-blue-800">جارٍ التحقق من اليوم كاملًا…</p>}
    {state.error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{state.error}</p>}
    {state.notice && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{state.notice}</p>}
    {state.pendingOperationId && <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-4"><p className="font-bold text-amber-900">تحقّق من نفس العملية، لا تسجّل موعدًا بديلًا</p><p className="break-all font-mono text-xs" dir="ltr">{state.pendingOperationId}</p>
      <div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={() => { if (allowed()) void controller.retry(); }}><RefreshCw size={18} />{state.saveStatus === 'refresh-required' ? 'تحديث النتيجة — قراءة فقط' : 'إعادة نفس المحاولة'}</button>
        {state.saveStatus === 'retry-required' && <button className={button} disabled={busy} onClick={() => { if (allowed()) void controller.cancelPending(); }}>التحقق من الإلغاء</button>}</div></div>}
    {draft && <form className="space-y-4 rounded-2xl border border-indigo-200 bg-indigo-50/40 p-4" onSubmit={event => { event.preventDefault(); if (allowed() && !locked && controller.getState().draft === draft) void controller.save(draft); }}>
      <h3 className="font-extrabold text-slate-900">{draft.expectedRevision === 0 ? 'حجز جديد' : 'تعديل الموعد'}</h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{field('اسم المريض', 'patientName')}{field('الهاتف', 'phone', 'tel')}{field('التاريخ', 'date', 'date')}{field('الوقت', 'time', 'time')}{field('المدة بالدقائق', 'durationMinutes', 'text')}
        <label className="space-y-2 text-sm font-bold text-slate-600">الحالة<select className={input} value={draft.data.status} disabled={locked} onChange={event => update(draft, { status: event.target.value as AppointmentStatus })}>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        {field('سبب الزيارة', 'reason')}{field('نوع الموعد', 'appointmentType')}{field('الطبيب', 'doctorName')}</div>
      <label className="block space-y-2 text-sm font-bold text-slate-600">ملاحظات<textarea className={input} rows={2} value={draft.data.notes} disabled={locked} onChange={event => update(draft, { notes: event.target.value })} /></label>
      <div className="flex flex-wrap gap-4">{(['isFollowUp', 'isWalkIn'] as const).map(key => <label key={key} className="flex min-h-[44px] items-center gap-2 text-sm font-bold"><input type="checkbox" checked={draft.data[key]} disabled={locked} onChange={event => update(draft, { [key]: event.target.checked })} />{key === 'isFollowUp' ? 'متابعة' : 'زيارة بدون موعد مسبق'}</label>)}</div>
      {draft.data.patientRecordId && <p className="text-sm text-indigo-800">مرتبط بملف المريض. تغيير الاسم أو الهاتف هنا يعدّل بيانات الموعد فقط.</p>}
      <div className="flex flex-wrap gap-2"><button type="submit" className={primary} disabled={locked}><Check size={18} />حفظ الموعد</button><button type="button" className={button} disabled={locked} onClick={() => { if (allowed() && !locked && controller.getState().draft === draft) controller.cancelDraft(draft); }}>إلغاء المسودة</button></div>
    </form>}
    {!draft && snapshot && <div className="space-y-3" aria-label="حجوزات اليوم">{rows.length === 0 ? <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">{snapshot.records.length ? 'لا توجد نتيجة للبحث في هذا اليوم.' : 'لا توجد حجوزات في اليوم المحدد.'}</p> : rows.map(record => {
      const phone = normalizeContactPhone(record.data.phone);
      return <article key={record.recordId} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex min-w-0 items-start gap-3"><div className="shrink-0 rounded-xl bg-indigo-50 p-3 text-center text-indigo-800"><p className="text-lg font-extrabold" dir="ltr">{record.data.time}</p><p className="text-xs">{record.data.durationMinutes} دقيقة</p></div>
          <div className="min-w-0 space-y-1"><h3 className="break-words font-extrabold text-slate-900">{record.data.patientName}</h3><p className="text-sm text-slate-500">{record.data.reason || 'بدون وصف'} · {labels[record.data.status]}</p>{record.data.notes && <p className="whitespace-pre-wrap break-words text-sm text-slate-600">{record.data.notes}</p>}</div></div>
        <div className="flex flex-wrap gap-2"><button className={button} disabled={locked || !controller.canClose()} onClick={() => { if (browse() && controller.getState().snapshot?.records.includes(record)) controller.beginEdit(record); }}><Pencil size={17} />تعديل</button>
          {phone && !locked && controller.canClose() && <><a className={button} href={`tel:+${phone}`} aria-label={`اتصال ${record.data.patientName}`} onClick={event => { if (!browse() || !controller.getState().snapshot?.records.includes(record)) event.preventDefault(); }}><Phone size={18} />اتصال</a><a className={button} href={`https://wa.me/${phone}`} target="_blank" rel="noopener noreferrer" aria-label={`واتساب ${record.data.patientName}`} onClick={event => { if (!browse() || !controller.getState().snapshot?.records.includes(record)) event.preventDefault(); }}><MessageCircle size={18} />واتساب</a></>}</div>
      </article>;
    })}</div>}
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="inline-flex items-center gap-2 font-bold"><History size={19} />استرجاع عمليات المواعيد</h3><button className={button} disabled={busy || !controller.canClose()} onClick={() => { if (browse()) void controller.loadHistory(); }}>قراءة سجل العمليات</button></div>
      <p className="text-xs leading-6 text-slate-500">يشمل العمليات المحضرة والمؤكدة والملغاة. الاسترجاع يعيد العملية الأصلية ولا ينشئ حجزًا جديدًا.</p>
      {state.history.map(intent => <div key={intent.operationId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 p-3"><div className="min-w-0"><p className="text-sm">{intent.createdAt.slice(0, 10)} · {intent.status === 'committed' ? 'مؤكدة' : intent.status === 'cancelled' ? 'ملغاة' : 'تحتاج تحقق'}</p><p className="break-all font-mono text-xs" dir="ltr">{intent.operationId}</p></div><button className={button} disabled={busy || intent.status === 'cancelled' || !controller.canClose()} onClick={() => { if (browse() && intent.status !== 'cancelled' && controller.getState().history.includes(intent)) void controller.resume(intent.operationId); }}>تحقق من الأصل</button></div>)}
      {state.historyNextAfterId && <button className={button} disabled={busy || !controller.canClose()} onClick={() => { if (browse()) void controller.loadMoreHistory(); }}>تحميل المزيد</button>}
    </section>
  </section>;
}
