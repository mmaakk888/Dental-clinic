import React, { useCallback, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowDown, ArrowRight, Check, ContactRound, MessageCircle, Pencil, Phone, Plus, RefreshCw, Search, ShieldCheck, Trash2, X } from 'lucide-react';
import type { ClinicContact } from '../../types';
import { CONTACT_MOBILE_MAX_LENGTH, CONTACT_NAME_MAX_LENGTH, CONTACT_NOTES_MAX_LENGTH,
  createContactSearchEntry, indexedContactMatchesSearch, normalizeContactPhone, prepareContactSearchQuery } from '../../utils/clinicContacts';
import { getWhatsAppUrl } from '../../utils/whatsappUtils';
import type { CloudContactRecord } from '../../utils/cloudContactRepository';
import type { CloudContactWorkspaceDraft, CloudContactWorkspaceState, createCloudContactWorkspaceController } from '../../utils/cloudContactWorkspaceController';
import type { CloudProfileContactRecoveryController } from '../../utils/cloudProfileContactRecoveryController';
import CloudProfileContactRecoveryPanel from '../shared/CloudProfileContactRecoveryPanel';

export type CloudContactsWorkspaceController = ReturnType<typeof createCloudContactWorkspaceController>;
type DraftFields = Pick<ClinicContact, 'name' | 'mobile'> & Pick<Partial<ClinicContact>, 'notes'>;
const buttonClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-45';
const secondaryClass = `${buttonClass} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50`;
const primaryClass = `${buttonClass} bg-blue-700 text-white hover:bg-blue-800`;
const inputClass = 'min-h-12 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-500';

function locked(state: CloudContactWorkspaceState): boolean {
  return state.loading || state.recoveryLoading || state.saveStatus !== 'idle' || Boolean(state.pendingOperationId);
}

export interface CloudContactsWorkspaceViewProps {
  state: CloudContactWorkspaceState;
  previewOnly?: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  onClose: () => void;
  onCreate: () => void;
  onEdit: (record: CloudContactRecord) => void;
  onDelete: (record: CloudContactRecord) => void;
  onContact: (record: CloudContactRecord) => boolean;
  onChangeDraft: (fields: DraftFields, expected: CloudContactWorkspaceDraft) => void;
  onSave: (expected: CloudContactWorkspaceDraft) => void;
  onCancel: (expected: CloudContactWorkspaceDraft) => void;
  onLoadFirst: () => void;
  onLoadMore: () => void;
  recoveryController?: CloudProfileContactRecoveryController;
  onResume?: (id: string) => void;
  onCancelPending?: (expected: CloudContactWorkspaceDraft, operationId: string) => void;
  canRecover?: () => boolean;
}

/** Pure presentation; never initializes Auth, obtains a capability or reads records. */
export function CloudContactsWorkspaceView(props: CloudContactsWorkspaceViewProps) {
  const { state, previewOnly = false, query } = props;
  const prefix = useId();
  const unavailable = previewOnly || state.closed;
  const isLocked = locked(state);
  const disabled = unavailable || isLocked;
  const draft = unavailable ? null : state.draft;
  const entries = useMemo(() => unavailable ? [] : state.records.filter(record => !record.deleted && record.data)
    .map(record => ({ record, search: createContactSearchEntry(record.data!) })), [state.records, unavailable]);
  const search = useMemo(() => prepareContactSearchQuery(query), [query]);
  const matches = useMemo(() => entries.filter(entry => indexedContactMatchesSearch(entry.search, search)), [entries, search]);
  const deletion = draft?.action === 'delete';
  const deletingRecord = deletion ? entries.find(entry => entry.record.recordId === draft.recordId)?.record : null;
  const retry = state.saveStatus === 'retry-required';
  const refresh = state.saveStatus === 'refresh-required';
  const closeBlocked = !previewOnly && !state.closed && (isLocked || Boolean(draft));
  const guarded = (action: () => void) => { if (!disabled) action(); };
  const saving = state.saveStatus === 'preparing' || state.saveStatus === 'saving';
  const runSave = () => { if (!unavailable && !state.loading && !state.recoveryLoading && !saving && draft) props.onSave(draft); };

  return <section dir="rtl" aria-labelledby={`${prefix}-title`} className="cloud-contacts-workspace mx-auto w-full min-w-0 max-w-6xl space-y-4 text-slate-900">
    <header className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700"><ContactRound aria-hidden="true" size={24} /></span>
        <div className="min-w-0"><h2 id={`${prefix}-title`} className="text-xl font-bold sm:text-2xl">جهات الاتصال السحابية</h2>
          <p className="mt-1 max-w-xl text-sm leading-6 text-slate-600">أسماء وأرقام للتواصل، وليست ملفات علاج أو حسابات مرضى.</p></div>
      </div>
      <div className="min-w-0"><button type="button" className={secondaryClass} disabled={closeBlocked} aria-describedby={closeBlocked ? `${prefix}-close-help` : undefined}
        onClick={() => { if (!closeBlocked) props.onClose(); }}><ArrowRight size={18} aria-hidden="true" />إلغاء وإغلاق</button>
        {closeBlocked && <p id={`${prefix}-close-help`} className="mt-1 max-w-56 text-xs leading-5 text-slate-500">{isLocked ? 'أكمل التحقق من العملية قبل إغلاق الشاشة.' : 'ألغِ المسودة قبل إغلاق الشاشة.'}</p>}</div>
    </header>

    {previewOnly ? <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-7 text-amber-950">
      <strong className="block">معاينة تصميم فقط — القراءة والحفظ غير مفعّلين</strong>
      هذه شاشة فارغة لمراجعة الترتيب على الهاتف والكمبيوتر. لا تُحمّل أي سجلات ولا تُحفظ بيانات. تشغيل العيادة السحابي لم يكتمل بعد.
    </div> : state.closed ? <p role="status" className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">أُغلقت مساحة العمل. لا توجد بيانات معروضة أو عملية جديدة متاحة هنا.</p> : null}

    {!unavailable && (retry || refresh) && <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-7 text-amber-950">
      <strong className="block">{refresh ? 'الحفظ مؤكّد — العرض يحتاج تحديثًا' : 'العملية تحتاج تأكيدًا من الخادم'}</strong>
      {refresh ? 'إعادة التحقق تقرأ النتيجة فقط، دون إرسال عملية حفظ جديدة.' : 'قد تكون العملية وصلت بالفعل. احتفظ بهذه الشاشة وأعد نفس المحاولة؛ لا تغيّر المسودة أو تنشئ عملية أخرى.'}
      <p>العملية مرتبطة بسجل دائم على الخادم إذا وصل التحضير. بعد إعادة فتح الصفحة راجع سجل الاسترجاع بنفس المعرف؛ الخروج لا يلغي كتابة وصلت للخادم.</p>
      {state.pendingOperationId && <bdi dir="ltr" className="block break-all text-xs tabular-nums">{state.pendingOperationId}</bdi>}
      {retry && draft && state.pendingOperationId && props.onCancelPending && <button type="button" className={`${secondaryClass} mt-2`} disabled={state.loading || state.recoveryLoading}
        onClick={() => { if (!unavailable && !state.loading && !state.recoveryLoading && state.saveStatus === 'retry-required') props.onCancelPending?.(draft, state.pendingOperationId!); }}><X aria-hidden="true" size={18} />التحقق وإلغاء العملية قبل تنفيذها</button>}
    </div>}
    {!unavailable && state.error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm leading-7 text-rose-900">{state.error}</p>}
    {!unavailable && state.notice && <p role="status" className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-sm leading-7 text-blue-950">{state.notice}</p>}

    <div className={`grid min-w-0 gap-4 ${draft ? 'lg:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)]' : ''}`}>
      <div className="min-w-0 space-y-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><h3 className="font-bold">الأرقام المحمّلة</h3><p className="mt-1 text-xs leading-5 text-slate-500">{unavailable ? '٠' : entries.length.toLocaleString('ar-EG')} جهة نشطة في العرض الحالي — ليس إجمالي العيادة</p></div>
            <button type="button" className={primaryClass} disabled={disabled || Boolean(draft)} onClick={() => guarded(props.onCreate)}><Plus aria-hidden="true" size={18} />إضافة جهة اتصال</button>
          </div>
          <label htmlFor={`${prefix}-search`} className="mb-1 mt-3 block text-sm font-medium">البحث في الأرقام المحمّلة</label>
          <div className="relative"><Search aria-hidden="true" size={19} className="pointer-events-none absolute right-3 top-3.5 text-slate-400" />
            <input id={`${prefix}-search`} type="search" inputMode="search" value={unavailable ? '' : query} maxLength={200} className={`${inputClass} pr-10`} disabled={unavailable}
              onChange={event => { if (!unavailable) props.onQueryChange(event.target.value); }} placeholder="الاسم أو رقم الموبايل" aria-describedby={`${prefix}-search-help`} /></div>
          <p id={`${prefix}-search-help`} className="mt-2 text-xs leading-6 text-slate-500">البحث هنا في الصفحات التي حمّلتها فقط، وليس بحثًا شاملًا في قاعدة البيانات. العرض يحتفظ بآخر ٥٠٠ سجل محمّل.</p>
          <div className="mt-3 flex flex-wrap gap-2"><button type="button" className={secondaryClass} disabled={disabled || Boolean(draft)} onClick={() => guarded(props.onLoadFirst)}><RefreshCw aria-hidden="true" size={17} />{state.loaded ? 'تحديث من البداية' : 'تحميل أول صفحة'}</button>
            {!unavailable && state.loading && <span role="status" className="self-center text-sm text-slate-600">جارٍ التحقق من الخادم…</span>}</div>
        </div>

        <div className="space-y-2" aria-busy={!unavailable && state.loading}>
          {matches.map(({ record }) => {
            const contact = record.data!, phone = normalizeContactPhone(contact.mobile);
            return <article key={record.recordId} className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex items-start gap-2"><button type="button" disabled={disabled || Boolean(draft)} className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-lg text-right focus-visible:outline-2 focus-visible:outline-blue-600 disabled:cursor-default"
                aria-label={`تعديل ${contact.name}`} onClick={() => guarded(() => props.onEdit(record))}>
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600"><ContactRound aria-hidden="true" size={20} /></span>
                <span className="min-w-0"><span className="block break-words text-base font-bold [overflow-wrap:anywhere]">{contact.name}</span><bdi dir="ltr" className="mt-0.5 block break-all text-sm text-slate-600">{contact.mobile}</bdi></span>
                <Pencil aria-hidden="true" size={16} className="mr-auto shrink-0 text-slate-400" />
              </button>
                <button type="button" className={`${buttonClass} shrink-0 px-3 text-rose-700 hover:bg-rose-50`} disabled={disabled || Boolean(draft)} aria-label={`حذف ${contact.name}`} onClick={() => guarded(() => props.onDelete(record))}><Trash2 aria-hidden="true" size={18} /></button>
              </div>
              {contact.notes && <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-600 [overflow-wrap:anywhere]">{contact.notes}</p>}
              {phone && <div className="mt-2 flex flex-wrap gap-2 border-t border-slate-100 pt-2">
                <a className={`${secondaryClass} px-3`} href={disabled ? undefined : `tel:+${phone}`} aria-disabled={disabled} tabIndex={disabled ? -1 : undefined} onClick={event => { if (disabled || !props.onContact(record)) event.preventDefault(); }} aria-label={`اتصال بـ${contact.name}`}><Phone aria-hidden="true" size={17} />اتصال</a>
                <a className={`${buttonClass} border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100`} href={disabled ? undefined : getWhatsAppUrl(phone, '')} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"
                  aria-disabled={disabled} tabIndex={disabled ? -1 : undefined} onClick={event => { if (disabled || !props.onContact(record)) event.preventDefault(); }} aria-label={`فتح واتساب ${contact.name}`}><MessageCircle aria-hidden="true" size={18} />واتساب يدوي</a>
              </div>}
            </article>;
          })}
          {!matches.length && <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center">
            <ContactRound aria-hidden="true" size={30} className="mx-auto mb-3 text-slate-400" />
            <p className="font-semibold">{unavailable ? 'لا توجد بيانات في هذه المعاينة' : !state.loaded ? 'لم تُحمّل جهات الاتصال بعد' : search.text ? 'لا توجد نتائج ضمن الأرقام المحمّلة' : 'لا توجد جهات اتصال نشطة في هذه الصفحات'}</p>
            <p className="mt-2 text-sm leading-6 text-slate-500">{unavailable ? 'هذه معاينة للشكل فقط، بلا سجلات افتراضية أو حقيقية.' : 'يمكنك تحميل الصفحات التالية أو الرجوع للبداية. عدم ظهور رقم هنا لا يثبت عدم وجوده في العيادة.'}</p>
          </div>}
        </div>
        <button type="button" className={`${secondaryClass} w-full`} disabled={disabled || Boolean(draft) || !state.nextAfterId} onClick={() => guarded(props.onLoadMore)}><ArrowDown aria-hidden="true" size={18} />تحميل الصفحة التالية — حتى ٢٥ سجلًا</button>
      </div>

      {draft && <section aria-labelledby={`${prefix}-editor-title`} className="order-first min-w-0 self-start rounded-2xl border border-blue-200 bg-white p-4 lg:order-none lg:sticky lg:top-4">
        <h3 id={`${prefix}-editor-title`} className="flex items-center gap-2 text-lg font-bold">{deletion ? <Trash2 aria-hidden="true" size={20} /> : <Pencil aria-hidden="true" size={20} />}{deletion ? 'تأكيد حذف جهة الاتصال' : draft.action === 'create' ? 'جهة اتصال جديدة' : 'تعديل جهة الاتصال'}</h3>
        <p className="mb-4 mt-2 text-sm leading-6 text-slate-500">{deletion ? 'يُسجّل الحذف بإصدار محفوظ. لا تُحذف أي ملفات مرضى، ولا يمكن إعادة هذه الهوية من مسودة قديمة.' : 'عدّل البيانات ثم احفظ صراحة. فتح المسودة أو كتابة البيانات لا يسجّلان حفظًا.'}</p>
        <form onSubmit={event => { event.preventDefault(); runSave(); }}>
          {deletion ? <div className="mb-4 rounded-xl border border-rose-100 bg-rose-50 p-3 text-sm leading-7 text-rose-900">هل تريد حذف <strong className="break-words [overflow-wrap:anywhere]">{deletingRecord?.data?.name ?? 'جهة الاتصال المحددة'}</strong>؟<br />تأكد من الاختيار قبل تأكيد الحذف.</div> : draft.contact && <fieldset disabled={disabled} className="min-w-0 space-y-3">
            <div><label htmlFor={`${prefix}-name`} className="mb-1 block text-sm font-semibold">الاسم</label><input id={`${prefix}-name`} type="text" autoComplete="name" required maxLength={CONTACT_NAME_MAX_LENGTH} className={inputClass} value={draft.contact.name}
              onChange={event => { if (!disabled) props.onChangeDraft({ ...draft.contact!, name: event.target.value }, draft); }} /></div>
            <div><label htmlFor={`${prefix}-phone`} className="mb-1 block text-sm font-semibold">رقم الموبايل</label><input id={`${prefix}-phone`} type="tel" inputMode="tel" autoComplete="tel" required maxLength={CONTACT_MOBILE_MAX_LENGTH} dir="ltr" className={`${inputClass} text-left`} value={draft.contact.mobile}
              onChange={event => { if (!disabled) props.onChangeDraft({ ...draft.contact!, mobile: event.target.value }, draft); }} /></div>
            <div><label htmlFor={`${prefix}-notes`} className="mb-1 block text-sm font-semibold">ملاحظة تواصل <span className="font-normal text-slate-500">— اختياري</span></label><textarea id={`${prefix}-notes`} rows={3} maxLength={CONTACT_NOTES_MAX_LENGTH} className={`${inputClass} resize-y py-3`} value={draft.contact.notes ?? ''}
              onChange={event => { if (!disabled) props.onChangeDraft({ ...draft.contact!, notes: event.target.value }, draft); }} /><p className="mt-1 text-xs leading-5 text-slate-500">للتواصل فقط؛ لا تكتب معلومات علاجية هنا.</p></div>
          </fieldset>}
          <div className="mt-4 flex flex-wrap gap-2"><button type="submit" className={deletion && !retry && !refresh ? `${buttonClass} bg-rose-700 text-white hover:bg-rose-800` : primaryClass} disabled={unavailable || state.loading || state.recoveryLoading || saving}>
            {refresh ? <RefreshCw aria-hidden="true" size={18} /> : <Check aria-hidden="true" size={18} />}{saving ? 'جارٍ التحقق…' : refresh ? 'إعادة التحقق من النتيجة' : retry ? 'إعادة نفس المحاولة' : deletion ? 'تأكيد الحذف' : 'حفظ جهة الاتصال'}</button>
            <button type="button" className={secondaryClass} disabled={disabled} onClick={() => { if (!disabled) props.onCancel(draft); }}><X aria-hidden="true" size={18} />إلغاء المسودة</button></div>
        </form>
      </section>}
    </div>
    {props.recoveryController && <CloudProfileContactRecoveryPanel controller={props.recoveryController}
      disabled={isLocked || Boolean(draft)} previewOnly={unavailable} canAct={props.canRecover ?? (() => false)}
      onResume={id => { if (!disabled && !draft) props.onResume?.(id); }} />}
    <footer className="flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-xs leading-6 text-slate-500"><ShieldCheck aria-hidden="true" size={18} className="mt-1 shrink-0" /><p>الربط بملفات المرضى وموافقة الحملات غير متاحين في هذه المرحلة. تشابه رقم الهاتف لا يثبت هوية المريض، وإضافة الرقم ليست موافقة تسويقية. فتح واتساب لا يؤكد إرسال رسالة.</p></footer>
  </section>;
}

/** Subscription only; the parent owns Auth/view invalidation and controller disposal. */
export default function CloudContactsWorkspace({ controller, onClose, previewOnly = false }: {
  controller: CloudContactsWorkspaceController;
  onClose: () => void;
  previewOnly?: boolean;
}) {
  const subscribe = useCallback((notify: () => void) => controller.subscribe(() => notify()), [controller]);
  const getSnapshot = useCallback(() => controller.getState(), [controller]);
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [query, setQuery] = useState('');
  const owner = useRef({ controller, previewOnly }); owner.current = { controller, previewOnly };
  const live = () => owner.current.controller === controller && owner.current.previewOnly === previewOnly && !previewOnly;
  const fresh = () => { if (!live()) return null; const value = controller.getState(); return live() && !value.closed && !locked(value) ? value : null; };
  const sameDraft = (expected: CloudContactWorkspaceDraft, allowRetry = false) => {
    if (!live()) return false; const value = controller.getState();
    return live() && !value.closed && !value.loading && !value.recoveryLoading && !['saving', 'preparing'].includes(value.saveStatus)
      && (allowRetry || value.saveStatus === 'idle') && value.draft === expected;
  };
  const currentRow = (record: CloudContactRecord) => fresh()?.records.find(value => value === record && !value.deleted && value.data) ?? null;
  return <CloudContactsWorkspaceView state={state} query={query} onQueryChange={setQuery} previewOnly={previewOnly}
    onClose={() => { if (owner.current.controller !== controller || owner.current.previewOnly !== previewOnly) return;
      const value = controller.getState(); if (owner.current.controller !== controller || owner.current.previewOnly !== previewOnly) return;
      if (previewOnly || value.closed || !locked(value) && !value.draft) onClose(); }}
    onCreate={() => { if (fresh()) controller.beginCreate(); }}
    onEdit={record => { const current = currentRow(record); if (current) controller.beginEdit(current); }}
    onDelete={record => { const current = currentRow(record); if (current) controller.beginDelete(current); }}
    onContact={record => Boolean(currentRow(record) && normalizeContactPhone(record.data!.mobile))}
    onChangeDraft={(fields, expected) => { if (sameDraft(expected)) controller.changeDraft({ name: fields.name, mobile: fields.mobile, ...(fields.notes === undefined ? {} : { notes: fields.notes }) }); }}
    onSave={expected => { if (sameDraft(expected, true)) void controller.save(); }}
    onCancel={expected => { if (sameDraft(expected)) controller.cancelDraft(); }}
    onLoadFirst={() => { const value = fresh(); if (value && !value.draft) void controller.loadFirst(); }}
    onLoadMore={() => { const value = fresh(); if (value && !value.draft) void controller.loadMore(); }}
    recoveryController={controller.recovery} canRecover={() => { const value = fresh(); return Boolean(value && !value.draft); }}
    onResume={id => { const value = fresh(); if (value && !value.draft) void controller.resume(id); }}
    onCancelPending={(expected, operationId) => { if (!live()) return; const value = controller.getState();
      if (live() && !value.closed && !value.loading && !value.recoveryLoading && value.saveStatus === 'retry-required'
        && value.pendingOperationId === operationId && value.draft === expected) void controller.cancelPending(); }} />;
}
