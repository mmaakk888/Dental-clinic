import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import type { Session } from '../types';
import type { CloudClinicalPatientSnapshot } from './cloudClinicalPatientProjection';
import type { CloudClinicalWorkspaceState } from './cloudClinicalWorkspaceController';
import type { CloudClinicalRecoveryState } from './cloudClinicalRecoveryController';
import type { CloudClinicalWorkspaceBundle } from './cloudClinicalUiStage';
import { createCloudClinicalUiPreview, CLOUD_CLINICAL_UI_STAGE } from './cloudClinicalUiStage';
import { CLOUD_COMPLETE_RELEASE_UI } from './cloudReleaseReadiness';
import type { CloudOperationIntent } from './cloudOperationIntent';
import type { CloudClinicalEditor, CloudClinicalWorkspaceViewProps } from '../components/patients/CloudClinicalWorkspace';

// Fabricated records and synthetic React hooks/SSR only. This is not browser
// visual QA and never initializes Firebase, storage, network or owner sign-in.
const compiled = await build({ entryPoints: ['src/components/patients/CloudClinicalWorkspace.tsx'], bundle: true,
  write: false, metafile: true, platform: 'node', format: 'cjs', logLevel: 'silent',
  external: ['react', 'react-dom', 'lucide-react'], loader: { '.css': 'empty' } });
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { default: CloudClinicalWorkspace, CloudClinicalWorkspaceView } = module.exports as typeof import('../components/patients/CloudClinicalWorkspace');
const ID = '10000000-0000-4000-8000-000000000001', SESSION = '20000000-0000-4000-8000-000000000001';
const OP = '30000000-0000-4000-8000-000000000001', DAY = '2026-10-11', WHEN = `${DAY}T00:00:00.000Z`;
function session(changes: Partial<Session> = {}): Session {
  return { id: SESSION, type: 'حشو اختبار مصطنع', tooth: 'ur5', teethIds: ['ur5'], amount: 400, paid: 100,
    remain: 300, date: DAY, treatmentStage: 'first', rootCanalStatus: 'working_length', visitStatus: 'follow_up',
    visitNotes: 'ملاحظة علاج مصطنعة', services: [{ id: SESSION, name: 'خدمة مصطنعة', price: 300, tooth: 'ur5' }],
    examinationFee: 100, paymentMethod: 'cash', paymentsLog: [{ id: OP, amount: 100, date: DAY, note: 'دفعة مصطنعة', paymentMethod: 'cash' }], ...changes };
}
function snapshot(changes: Partial<CloudClinicalPatientSnapshot> = {}): CloudClinicalPatientSnapshot {
  const profile = { schemaVersion: 1 as const, clinicId: 'main' as const, recordId: ID, fileNo: 451, revision: 1,
    lastOperationId: OP, phoneKey: null,
    data: { name: 'مريض اختبار مصطنع', mobile: '٠١٠٠٠٠٠٠٠٠١', age: 30, gender: '', firstVisit: DAY, notes: '', allergy: '' } };
  return { profile, patientRecordId: ID, accountRevision: 2, totalCents: 40_000, paidCents: 10_000,
    patient: { id: '451', ...profile.data, sessions: [session()], payments: [] }, ...changes };
}
function fileState(changes: Partial<CloudClinicalWorkspaceState> = {}): CloudClinicalWorkspaceState {
  return { patientRecordId: null, snapshot: null, loaded: false, loading: false, draftDirty: false,
    saveStatus: 'idle', pendingOperationId: null, error: '', notice: '', closed: false, ...changes };
}
function recoveryState(changes: Partial<CloudClinicalRecoveryState> = {}): CloudClinicalRecoveryState {
  return { records: [], loaded: false, loading: false, nextAfterId: null, error: '', notice: '', closed: false, ...changes };
}
function intent(status: CloudOperationIntent['status'] = 'prepared', operationId = OP): CloudOperationIntent {
  return { schemaVersion: 1, clinicId: 'main', recordId: operationId, operationId, actorUid: 'synthetic-owner',
    kind: 'clinical', command: { action: 'payment', operationId, patientId: ID, sessionId: SESSION, expectedRevision: 2,
      amountCents: 1000, date: DAY, note: 'PRIVATE_INTENT_NOTE', createdAt: WHEN },
    requestHash: 'a'.repeat(64), createdAt: WHEN, revision: status === 'prepared' ? 1 : 2, status };
}
function editor(value: CloudClinicalPatientSnapshot, changes: Partial<CloudClinicalEditor> = {}): CloudClinicalEditor {
  return { mode: 'payment', snapshot: value, session: value.patient.sessions[0], amount: '', date: DAY, note: '',
    progress: { notes: 'ملاحظة علاج مصطنعة', treatmentStage: 'first', rootCanalStatus: 'working_length', visitStatus: 'follow_up' }, ...changes };
}
function viewProps(changes: Partial<CloudClinicalWorkspaceViewProps> = {}) {
  const calls: string[] = [];
  const props: CloudClinicalWorkspaceViewProps = { state: fileState(), recovery: recoveryState(), editor: null,
    onClose: () => calls.push('close'), onRefresh: () => calls.push('refresh'), onRetry: () => calls.push('retry'),
    onCancelPending: () => calls.push('cancel-pending'), onStartEdit: (_s, _t, mode) => calls.push(`edit:${mode}`),
    onChangeEditor: () => calls.push('change'), onSave: () => calls.push('save'), onCancelEditor: () => calls.push('cancel-editor'),
    onContact: () => { calls.push('contact'); return true; }, onRecoveryLoad: () => calls.push('history'),
    onRecoveryMore: () => calls.push('more'), onResume: value => calls.push(`resume:${value.operationId}`), ...changes };
  return { props, calls, html: () => renderToStaticMarkup(React.createElement(CloudClinicalWorkspaceView, props)) };
}
type Element = { type: unknown; props: Record<string, any> };
const children = (node: any): any[] => node == null ? [] : Array.isArray(node) ? node.flatMap(children) : [node];
const all = (node: any): Element[] => children(node).flatMap(item => item && typeof item === 'object' && item.props ? [item, ...all(item.props.children)] : []);
const text = (node: any): string => children(node).map(item => typeof item === 'string' || typeof item === 'number' ? String(item) : item?.props ? text(item.props.children) : '').join('');
interface Hooks { refs: Array<{ current: any }>; states: any[]; subscriptions: Array<(notify: () => void) => () => void> }
const hooks = (): Hooks => ({ refs: [], states: [], subscriptions: [] });
function invoke(component: (props: any) => any, props: any, slots = hooks()) {
  const internals = (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE, previous = internals.H;
  let refIndex = 0, stateIndex = 0;
  internals.H = { useId: () => 'synthetic-clinical', useCallback: (fn: unknown) => fn,
    useRef: (value: unknown) => { const index = refIndex++; return slots.refs[index] ?? (slots.refs[index] = { current: value }); },
    useState: (initial: unknown) => { const index = stateIndex++; if (!(index in slots.states)) slots.states[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      return [slots.states[index], (value: unknown) => { slots.states[index] = typeof value === 'function' ? (value as (old: unknown) => unknown)(slots.states[index]) : value; }]; },
    useSyncExternalStore: (subscribe: (notify: () => void) => () => void, getSnapshot: () => unknown) => { slots.subscriptions.push(subscribe); return getSnapshot(); } };
  try { return component(props); } finally { internals.H = previous; }
}
function rendered(props: CloudClinicalWorkspaceViewProps) {
  const tree = invoke(CloudClinicalWorkspaceView, props), elements = all(tree);
  const button = (label: string) => { const found = elements.find(item => item.type === 'button' && text(item) === label); assert.ok(found, `Missing ${label}`); return found; };
  return { elements, button, content: text(tree) };
}
function harness(loaded = true) {
  let state = loaded ? fileState({ patientRecordId: ID, snapshot: snapshot(), loaded: true }) : fileState();
  let recovery = recoveryState(); const calls: any[][] = [];
  const fileListeners = new Set<(value: CloudClinicalWorkspaceState) => void>(), historyListeners = new Set<(value: CloudClinicalRecoveryState) => void>();
  const behavior = { save: true, retry: true, cancel: true, wait: null as Promise<void> | null };
  const file = { getState: () => state, subscribe: (notify: (value: CloudClinicalWorkspaceState) => void) => { fileListeners.add(notify); return () => { fileListeners.delete(notify); }; },
    setDraftDirty: (id: string, dirty: boolean) => { calls.push(['dirty', id, dirty]); if (state.closed || state.saveStatus !== 'idle' || id !== state.patientRecordId) return false; state = { ...state, draftDirty: dirty }; return true; },
    open: async (id: string) => { calls.push(['open', id]); return true; }, refresh: async () => { calls.push(['refresh']); await behavior.wait; return true; },
    saveVisit: async () => { calls.push(['unexpected-visit']); return false; },
    addReceipt: async (...args: unknown[]) => { calls.push(['payment', ...args]); await behavior.wait; if (behavior.save) state = { ...state, draftDirty: false }; return behavior.save; },
    saveProgress: async (...args: unknown[]) => { calls.push(['progress', ...args]); await behavior.wait; if (behavior.save) state = { ...state, draftDirty: false }; return behavior.save; },
    retry: async () => { calls.push(['retry', state.pendingOperationId]); await behavior.wait; if (behavior.retry) state = { ...state, saveStatus: 'idle', pendingOperationId: null, draftDirty: false }; return behavior.retry; },
    cancelPending: async () => { calls.push(['cancel-pending', state.pendingOperationId]); await behavior.wait; if (behavior.cancel) state = { ...state, saveStatus: 'idle', pendingOperationId: null, draftDirty: false }; return behavior.cancel; },
    resume: async (id: string) => { calls.push(['resume', id]); await behavior.wait; return true; }, dispose: () => { state = fileState({ closed: true }); } };
  const history = { getState: () => recovery, subscribe: (notify: (value: CloudClinicalRecoveryState) => void) => { historyListeners.add(notify); return () => { historyListeners.delete(notify); }; },
    loadFirst: async () => { calls.push(['history']); await behavior.wait; }, loadMore: async () => { calls.push(['more']); await behavior.wait; },
    dispose: () => { recovery = recoveryState({ closed: true }); } };
  const bundle: CloudClinicalWorkspaceBundle = { file, recovery: history };
  const slots = hooks(); let closes = 0;
  const render = (changes: { controller?: CloudClinicalWorkspaceBundle; previewOnly?: boolean; closing?: boolean;
    onStartProsthetic?: (patientRecordId: string) => void; onOpenPrescription?: (patientRecordId: string) => void } = {}) => invoke(CloudClinicalWorkspace,
    { controller: bundle, onClose: () => closes++, ...changes }, slots).props as CloudClinicalWorkspaceViewProps;
  return { bundle, calls, behavior, slots, render, closes: () => closes, state: () => state,
    setState: (changes: Partial<CloudClinicalWorkspaceState>) => { state = { ...state, ...changes }; for (const notify of fileListeners) notify(state); },
    setRecovery: (changes: Partial<CloudClinicalRecoveryState>) => { recovery = { ...recovery, ...changes }; for (const notify of historyListeners) notify(recovery); },
    listeners: () => [fileListeners.size, historyListeners.size] };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve!: () => void; return { promise: new Promise<void>(accept => { resolve = accept; }), resolve: () => resolve() }; }
function start(h: ReturnType<typeof harness>, mode: CloudClinicalEditor['mode'] = 'payment') {
  const first = h.render(), data = first.state.snapshot!; first.onStartEdit(data, data.patient.sessions[0], mode); return h.render();
}

test('clinical render is read-free with unknown balance instead of a fabricated zero', () => {
  const h = harness(false), html = renderToStaticMarkup(React.createElement(CloudClinicalWorkspace, { controller: h.bundle, onClose() {} }));
  assert.deepEqual(h.calls, []); assert.match(html, /الحساب غير المقروء لا يعني أن الرصيد صفر|لا تُقرأ ملفات تلقائيًا/);
  assert.doesNotMatch(html, /ccw-totals|مريض اختبار|ج\.م|href=|تأكيد تسجيل الدفعة/);
});

test('preview masks mistakenly supplied file, editor, balances, phone, errors and all history statuses', () => {
  const data = snapshot(), h = viewProps({ previewOnly: true, editor: editor(data, { amount: '123', note: 'PRIVATE_DRAFT' }),
    state: fileState({ snapshot: data, patientRecordId: ID, loaded: true, draftDirty: true, saveStatus: 'retry-required', pendingOperationId: OP, error: 'PRIVATE_ERROR', notice: 'PRIVATE_NOTICE' }),
    recovery: recoveryState({ loaded: true, records: [intent(), intent('committed'), intent('cancelled')], nextAfterId: OP, error: 'PRIVATE_HISTORY' }) });
  assert.match(h.html(), /معاينة تصميم فقط|القراءة والحفظ غير مفعّلين/);
  assert.doesNotMatch(h.html(), /PRIVATE_|مريض اختبار|٠١٠٠٠٠٠٠٠٠١|30000000|ccw-totals|href=|<form/);
  const view = rendered(h.props);
  for (const button of view.elements.filter(item => item.type === 'button' && text(item) !== 'إلغاء وإغلاق')) { assert.equal(button.props.disabled, true); button.props.onClick?.(); }
  assert.deepEqual(h.calls, []); view.button('إلغاء وإغلاق').props.onClick(); assert.deepEqual(h.calls, ['close']);
});

test('closed bundle masks retained clinical data and notices independently of preview mode', () => {
  for (const target of ['file', 'history']) {
    const data = snapshot(), h = viewProps({ state: fileState({ loaded: true, snapshot: data, closed: target === 'file', error: 'PRIVATE_ERROR', notice: 'PRIVATE_NOTICE' }),
      recovery: recoveryState({ closed: target === 'history', loaded: true, records: [intent()] }) });
    assert.doesNotMatch(h.html(), /مريض اختبار|PRIVATE_|30000000|href=|ccw-totals/);
  }
});

test('verified account displays charges and actual cash separately with full-session details and receipt history', () => {
  const data = snapshot(), h = viewProps({ state: fileState({ patientRecordId: ID, loaded: true, snapshot: data }) }), view = rendered(h.props);
  assert.match(h.html(), /رقم الملف ٤٥١|إجمالي الخدمات|المحصّل فعليًا|المتبقي|٤٠٠٫٠٠|١٠٠٫٠٠|٣٠٠٫٠٠/);
  assert.match(view.content, /سجل المدفوعات الفعلية|دفعة مصطنعة|تحديد طول القنوات|تاريخ الجلسة/);
  assert.equal(view.elements.find(item => item.type === 'details')!.props.open, undefined);
  view.button('تسجيل دفعة').props.onClick(); view.button('تحديث المتابعة').props.onClick(); assert.deepEqual(h.calls, ['edit:payment', 'edit:progress']);
  assert.doesNotMatch(h.html(), /جلسة 1|تكلفة المعمل|اسم المعمل|تسجيل زيارة جديدة|type="checkbox"/);
});

test('manual contact links are canonical and no notes, financial balance or private actor leak into URL', () => {
  const data = snapshot(); data.profile.data.name = '<script>NAME</script>'; data.patient.sessions[0].visitNotes = '<img src=x onerror=1>';
  const h = viewProps({ state: fileState({ loaded: true, snapshot: data }) }), view = rendered(h.props), html = h.html();
  assert.match(html, /href="tel:\+201000000001"/); assert.match(html, /href="https:\/\/wa.me\/201000000001"/);
  assert.match(html, /referrerPolicy="no-referrer"/); assert.match(html, /&lt;script|&lt;img/); assert.doesNotMatch(html, /<script>|<img src=x/);
  for (const link of view.elements.filter(item => item.type === 'a')) { assert.doesNotMatch(link.props.href, /note|balance|text=/); link.props.onClick({ preventDefault() { assert.fail('unexpected prevent'); } }); }
  assert.deepEqual(h.calls, ['contact', 'contact']); data.profile.data.mobile = 'javascript:alert(1)'; assert.doesNotMatch(h.html(), /href=/);
});

test('dirty, busy and closing views remove contact href/context-menu access and guard retained visual handlers', () => {
  const data = snapshot();
  for (const changes of [{ draftDirty: true }, { loading: true }, { saveStatus: 'retry-required' as const }, {}]) {
    const h = viewProps({ state: fileState({ loaded: true, snapshot: data, ...changes }), closing: Object.keys(changes).length === 0 }), view = rendered(h.props);
    for (const link of view.elements.filter(item => item.type === 'a')) { assert.equal(link.props.href, undefined); assert.equal(link.props.tabIndex, -1); assert.equal(link.props['aria-disabled'], true);
      let prevented = false; link.props.onClick({ preventDefault: () => { prevented = true; } }); assert.equal(prevented, true); }
    assert.deepEqual(h.calls, []);
  }
});

test('payment editor starts blank, has associated accessible fields and validates explicit positive cents/balance', () => {
  const data = snapshot();
  for (const amount of ['', '0', '-1', '1e2', '10.001', 'Infinity', '300.01', '999999999999']) {
    const h = viewProps({ state: fileState({ loaded: true, snapshot: data, draftDirty: true }), editor: editor(data, { amount }) }), view = rendered(h.props);
    assert.equal(view.button('تأكيد تسجيل الدفعة').props.disabled, true);
    view.elements.find(item => item.type === 'form')!.props.onSubmit({ preventDefault() {} }); assert.deepEqual(h.calls, []);
  }
  const h = viewProps({ state: fileState({ loaded: true, snapshot: data, draftDirty: true }), editor: editor(data, { amount: '٢٥٫٥٠' }) }), view = rendered(h.props);
  assert.equal(view.button('تأكيد تسجيل الدفعة').props.disabled, false);
  for (const input of view.elements.filter(item => ['input', 'textarea'].includes(item.type as string))) assert.ok(view.elements.some(item => item.type === 'label' && item.props.htmlFor === input.props.id));
  assert.match(h.html(), /inputMode="decimal"|أقصى تحصيل متاح|لا مبلغ تلقائي/);
  view.elements.find(item => item.type === 'form')!.props.onSubmit({ preventDefault() {} }); assert.deepEqual(h.calls, ['save']);
});

test('progress editor exposes only treatment state and clinical notes, without new charges or receipts', () => {
  const data = snapshot(), h = viewProps({ state: fileState({ loaded: true, snapshot: data, draftDirty: true }), editor: editor(data, { mode: 'progress' }) }), view = rendered(h.props);
  assert.equal(view.elements.filter(item => item.type === 'select').length, 3);
  assert.equal(view.elements.filter(item => item.type === 'input').length, 0); assert.match(h.html(), /المتابعة لا تضيف خدمة أو مبلغًا أو إيصالًا جديدًا/);
  view.elements.find(item => item.type === 'form')!.props.onSubmit({ preventDefault() {} }); assert.deepEqual(h.calls, ['save']);
});

test('synchronous dirty protection blocks refresh, recovery, contact and close until explicit ordinary cancel', () => {
  const h = harness(), first = h.render(), data = first.state.snapshot!;
  first.onStartEdit(data, data.patient.sessions[0], 'payment'); first.onClose(); first.onRefresh(); first.onRecoveryLoad(); first.onRecoveryMore();
  assert.equal(first.onContact(data), false); assert.equal(h.closes(), 0); assert.deepEqual(h.calls, [['dirty', ID, true]]);
  const current = h.render(); assert.equal(current.editor!.amount, ''); current.onCancelEditor(current.editor!); h.render().onClose();
  assert.deepEqual(h.calls, [['dirty', ID, true], ['dirty', ID, false]]); assert.equal(h.closes(), 1); assert.equal(h.render().editor, null);
});

test('stale snapshot/session and forged equal-data editor cannot initiate or mutate clinical commands', () => {
  const h = harness(), p = h.render(), data = p.state.snapshot!;
  p.onStartEdit(structuredClone(data), data.patient.sessions[0], 'payment'); p.onStartEdit(data, structuredClone(data.patient.sessions[0]), 'payment'); assert.deepEqual(h.calls, []);
  const current = start(h), expected = current.editor!; current.onChangeEditor({ ...expected }, { amount: '20' }); current.onSave({ ...expected }); current.onCancelEditor({ ...expected });
  assert.equal(h.render().editor, expected); assert.equal(h.calls.filter(call => call[0] === 'payment').length, 0);
  h.setState({ snapshot: snapshot({ accountRevision: 3 }) }); current.onChangeEditor(expected, { amount: '30' }); current.onCancelEditor(expected); current.onSave(expected);
  assert.equal(h.calls.filter(call => call[0] === 'dirty').length, 1);
});

test('retained callbacks for an old draft cannot replace, save or cancel the freshly edited draft', () => {
  const h = harness(), old = start(h), original = old.editor!;
  old.onChangeEditor(original, { amount: '15.25' }); const next = h.render().editor!; assert.notEqual(next, original);
  old.onChangeEditor(original, { amount: '90' }); old.onSave(original); old.onCancelEditor(original); assert.equal(h.render().editor, next);
  assert.equal(next.amount, '15.25'); assert.equal(h.calls.filter(call => call[0] === 'payment').length, 0);
});

test('explicit Arabic payment creates one integer-cent callback on selected UUID/session and clears only after success', async () => {
  const h = harness(), initial = start(h); initial.onChangeEditor(initial.editor!, { amount: '٢٥٫٥٠', date: DAY, note: 'دفعة جديدة' });
  const saving = h.render(), held = deferred(); h.behavior.wait = held.promise;
  saving.onSave(saving.editor!); saving.onSave(saving.editor!); saving.onCancelEditor(saving.editor!); saving.onClose();
  assert.equal(h.calls.filter(call => call[0] === 'payment').length, 1); assert.equal(h.closes(), 0); assert.equal(h.state().draftDirty, true);
  assert.deepEqual(h.calls.find(call => call[0] === 'payment'), ['payment', ID, SESSION, { amountCents: 2550, date: DAY, note: 'دفعة جديدة' }]);
  assert.equal(h.calls.some(call => call[0] === 'dirty' && call[2] === false), false); held.resolve(); await flush(); assert.equal(h.render().editor, null); assert.equal(h.state().draftDirty, false);
});

test('invalid payment wrapper callbacks cannot send zero, fractions below piastre or exceed session/file remaining', async () => {
  for (const amount of ['', '0', '-1', '2.111', '300.01', '1e2']) {
    const h = harness(), first = start(h); first.onChangeEditor(first.editor!, { amount }); const next = h.render(); next.onSave(next.editor!); await flush();
    assert.equal(h.calls.some(call => call[0] === 'payment'), false); assert.equal(h.state().draftDirty, true);
  }
  const h = harness(); h.setState({ snapshot: snapshot({ totalCents: 15_000, paidCents: 10_000 }) }); const first = start(h);
  first.onChangeEditor(first.editor!, { amount: '50.01' }); const next = h.render(); next.onSave(next.editor!); await flush(); assert.equal(h.calls.some(call => call[0] === 'payment'), false);
});

test('failed or rejected saves preserve editor and dirty state without optimistic success or cancellation', async () => {
  const h = harness(), first = start(h); first.onChangeEditor(first.editor!, { amount: '10' }); h.behavior.save = false;
  const next = h.render(); next.onSave(next.editor!); await flush(); assert.equal(h.render().editor, next.editor); assert.equal(h.state().draftDirty, true);
  h.bundle.file.addReceipt = async () => { throw new Error('PRIVATE_PROVIDER_ERROR'); }; h.render().onSave(next.editor!); await flush();
  assert.equal(h.render().editor, next.editor); assert.equal(h.state().draftDirty, true); assert.doesNotMatch(renderToStaticMarkup(React.createElement(CloudClinicalWorkspaceView, h.render())), /PRIVATE_PROVIDER_ERROR|تم الحفظ/);
});

test('progress save preserves financial action separation and never calls visit or receipt callbacks', async () => {
  const h = harness(), first = start(h, 'progress'); assert.equal(first.editor!.progress.rootCanalStatus, 'working_length');
  const progress = { notes: 'اكتمل الإجراء', treatmentStage: 'second' as const, rootCanalStatus: 'canal_filled' as const, visitStatus: 'completed' as const };
  first.onChangeEditor(first.editor!, { progress }); const current = h.render(); current.onSave(current.editor!); await flush();
  assert.deepEqual(h.calls.find(call => call[0] === 'progress'), ['progress', ID, SESSION, progress]); assert.equal(h.calls.some(call => ['payment', 'unexpected-visit'].includes(call[0])), false);
  assert.equal(h.render().editor, null);
});

test('pending commands lock editor, contact, close and ordinary cancel; retry uses original command and preserves dirty on failure', async () => {
  const h = harness(), first = start(h); h.setState({ saveStatus: 'retry-required', pendingOperationId: OP });
  const current = h.render(), view = rendered(current); assert.equal(view.elements.find(item => item.type === 'fieldset')!.props.disabled, true);
  for (const label of ['إلغاء وإغلاق', 'إلغاء المسودة', 'تسجيل دفعة', 'تحديث المتابعة', 'تحميل سجل العمليات']) assert.equal(view.button(label).props.disabled, true);
  current.onCancelEditor(first.editor!); current.onSave(first.editor!); current.onRefresh(); current.onClose(); assert.equal(current.onContact(first.state.snapshot!), false);
  h.behavior.retry = false; current.onRetry(); await flush(); assert.deepEqual(h.calls.find(call => call[0] === 'retry'), ['retry', OP]); assert.equal(h.state().draftDirty, true); assert.equal(h.render().editor, first.editor);
  h.behavior.retry = true; h.render().onRetry(); await flush(); assert.equal(h.render().editor, null); assert.equal(h.state().draftDirty, false); assert.equal(h.closes(), 0);
});

test('acknowledged refresh-required shows read-only recovery and disallows cancellation or another payment', async () => {
  const h = harness(); h.setState({ saveStatus: 'refresh-required', pendingOperationId: OP }); const current = h.render(), view = rendered(current);
  assert.equal(view.button('تحديث النتيجة — قراءة فقط').props.disabled, false);
  assert.equal(view.elements.some(item => item.type === 'button' && text(item).includes('إمكانية إلغاء')), false);
  current.onCancelPending(); current.onRefresh(); current.onRetry(); await flush(); assert.deepEqual(h.calls, [['retry', OP]]);
});

test('confirmed pending cancellation clears editor only after controller confirmation, not on a failed attempt', async () => {
  const h = harness(), first = start(h); h.setState({ saveStatus: 'retry-required', pendingOperationId: OP }); h.behavior.cancel = false;
  h.render().onCancelPending(); await flush(); assert.equal(h.render().editor, first.editor); assert.equal(h.state().draftDirty, true);
  h.behavior.cancel = true; h.render().onCancelPending(); await flush(); assert.equal(h.render().editor, null); assert.equal(h.state().draftDirty, false);
  assert.deepEqual(h.calls.filter(call => call[0] === 'cancel-pending'), [['cancel-pending', OP], ['cancel-pending', OP]]);
});

test('operation history explicitly distinguishes prepared, committed and cancelled, not global recent activity', () => {
  const prepared = intent(), committed = intent('committed', OP.replace(/1$/, '2')), cancelled = intent('cancelled', OP.replace(/1$/, '3'));
  const h = viewProps({ recovery: recoveryState({ loaded: true, records: [prepared, committed, cancelled], nextAfterId: cancelled.operationId }) }), view = rendered(h.props);
  assert.match(h.html(), /بترتيب المعرف|وليس الأحدث|الصفحات المحمّلة|محضّرة|حُفظت|أُلغيت/); assert.doesNotMatch(h.html(), /PRIVATE_INTENT_NOTE|synthetic-owner/);
  view.button('استرجاع ومتابعة العملية الأصلية').props.onClick(); view.button('التحقق من نتيجة العملية الأصلية').props.onClick();
  assert.equal(view.button('عملية ملغاة').props.disabled, true); view.button('عملية ملغاة').props.onClick(); view.button('تحميل المزيد من العمليات').props.onClick();
  assert.deepEqual(h.calls, [`resume:${prepared.operationId}`, `resume:${committed.operationId}`, 'more']);
});

test('history load/pagination/resume are explicit, synchronous deduped, identity-checked and cancelled operations never resume', async () => {
  const h = harness(), records = [intent(), intent('committed', OP.replace(/1$/, '2')), intent('cancelled', OP.replace(/1$/, '3'))];
  h.setRecovery({ loaded: true, records, nextAfterId: OP }); const p = h.render(); assert.deepEqual(h.calls, []);
  p.onResume({ ...records[0] }); p.onResume(records[2]); assert.deepEqual(h.calls, []);
  p.onResume(records[0]); p.onResume(records[0]); await flush(); h.render().onResume(records[1]); await flush();
  assert.deepEqual(h.calls, [['resume', records[0].operationId], ['resume', records[1].operationId]]);
  h.render().onRecoveryMore(); await flush(); h.render().onRecoveryLoad(); await flush(); assert.deepEqual(h.calls.slice(-2), [['more'], ['history']]);
  h.setRecovery({ nextAfterId: null }); h.render().onRecoveryMore(); assert.equal(h.calls.filter(call => call[0] === 'more').length, 1);
});

test('loaded history errors preserve visible partial context without claiming complete global state', () => {
  const h = viewProps({ recovery: recoveryState({ loaded: true, records: [intent()], error: 'تعذر تحميل المزيد', notice: 'القائمة جزئية', nextAfterId: OP }) });
  assert.match(h.html(), /role="alert"|تعذر تحميل المزيد|القائمة جزئية|30000000/); assert.doesNotMatch(h.html(), /لا عمليات في الصفحات/);
});

test('retained handlers revoke after closed controller, replacement bundle, closing or preview transition', async () => {
  for (const mode of ['closed', 'replacement', 'closing', 'preview']) {
    const h = harness(), old = h.render(), data = old.state.snapshot!; h.setRecovery({ records: [intent()], loaded: true, nextAfterId: OP });
    const retained = h.render();
    if (mode === 'closed') h.bundle.file.dispose();
    else h.render(mode === 'replacement' ? { controller: harness().bundle } : mode === 'closing' ? { closing: true } : { previewOnly: true });
    retained.onRefresh(); retained.onStartEdit(data, data.patient.sessions[0], 'payment'); retained.onRecoveryLoad(); retained.onRecoveryMore(); retained.onResume(intent()); retained.onRetry(); retained.onCancelPending();
    assert.equal(retained.onContact(data), false); await flush(); assert.deepEqual(h.calls, []);
  }
});

test('old rendered contact links prevent navigation after preview, closing, bundle replacement or selected snapshot change', () => {
  for (const mode of ['preview', 'closing', 'bundle', 'snapshot']) {
    const h = harness(), props = h.render(), links = rendered(props).elements.filter(item => item.type === 'a'); assert.equal(links.length, 2);
    if (mode === 'snapshot') h.setState({ snapshot: snapshot({ accountRevision: 3 }) });
    else h.render(mode === 'preview' ? { previewOnly: true } : mode === 'closing' ? { closing: true } : { controller: harness().bundle });
    for (const link of links) { let prevented = false; link.props.onClick({ preventDefault: () => { prevented = true; } }); assert.equal(prevented, true); }
    assert.deepEqual(h.calls, []);
  }
});

test('late successful save or retry cannot clear an editor belonging to a replacement bundle', async () => {
  for (const action of ['save', 'retry', 'cancel']) {
    const h = harness(), first = start(h), gate = deferred(); h.behavior.wait = gate.promise;
    if (action === 'save') { first.onChangeEditor(first.editor!, { amount: '10' }); const saving = h.render(); saving.onSave(saving.editor!); }
    else { h.setState({ saveStatus: 'retry-required', pendingOperationId: OP }); const pending = h.render(); if (action === 'retry') pending.onRetry(); else pending.onCancelPending(); }
    const retained = h.slots.states[0]; h.render({ controller: harness().bundle }); gate.resolve(); await flush(); assert.equal(h.slots.states[0], retained);
  }
});

test('explicit preview bundle stays subscription-only and inert independently of central readiness', async () => {
  assert.equal(CLOUD_CLINICAL_UI_STAGE.available, CLOUD_COMPLETE_RELEASE_UI.available);
  assert.equal(Object.isFrozen(CLOUD_CLINICAL_UI_STAGE), true);
  assert.throws(() => { (CLOUD_CLINICAL_UI_STAGE as { available: boolean }).available = !CLOUD_CLINICAL_UI_STAGE.available; }); let active = true;
  const bundle = createCloudClinicalUiPreview(() => active), h = hooks(), p = invoke(CloudClinicalWorkspace, { controller: bundle, previewOnly: true, onClose() {} }, h).props as CloudClinicalWorkspaceViewProps;
  assert.equal(h.subscriptions.length, 2); assert.equal(bundle.file.getState().snapshot, null); assert.equal(bundle.recovery.getState().records.length, 0);
  await bundle.file.open(ID); await bundle.file.refresh(); await bundle.file.addReceipt(ID, SESSION, { amountCents: 100, date: DAY, note: '' });
  await bundle.file.saveProgress(ID, SESSION, editor(snapshot()).progress); await bundle.file.retry(); await bundle.file.cancelPending(); await bundle.file.resume(OP);
  assert.equal(bundle.file.setDraftDirty(ID, true), false); await bundle.recovery.loadFirst(); await bundle.recovery.loadMore(); p.onRefresh(); p.onRecoveryLoad(); p.onRecoveryMore();
  assert.equal(bundle.file.getState().loaded, false); assert.equal(bundle.recovery.getState().loaded, false); active = false; assert.equal(bundle.file.getState().closed, true);
});

test('subscription cleanup unsubscribes both streams without performing reads or disposing parent-owned controllers', () => {
  const h = harness(false); h.render(); assert.equal(h.slots.subscriptions.length, 2); let notices = 0;
  const cleanups = h.slots.subscriptions.map(subscribe => subscribe(() => notices++)); assert.deepEqual(h.listeners(), [1, 1]);
  h.setState({ notice: 'تحديث' }); h.setRecovery({ notice: 'تحديث' }); assert.equal(notices, 2); cleanups.forEach(cleanup => cleanup());
  h.setState({ notice: '' }); h.setRecovery({ notice: '' }); assert.equal(notices, 2); assert.deepEqual(h.listeners(), [0, 0]);
  assert.equal(h.bundle.file.getState().closed, false); assert.deepEqual(h.calls, []);
});

test('scoped layout supports narrow wrapping, desktop columns, 44px targets, 16px inputs and reduced motion without floating menus', async () => {
  const css = await readFile('src/components/patients/CloudClinicalWorkspace.css', 'utf8');
  assert.match(css, /min-height:44px/); assert.match(css, /font-size:16px/); assert.match(css, /min-width:0/); assert.match(css, /overflow-wrap:anywhere/);
  assert.match(css, /min-width:1000px/); assert.match(css, /max-width:480px/); assert.match(css, /prefers-reduced-motion:reduce/);
  assert.doesNotMatch(css, /overflow-x:\s*(auto|scroll)|position:\s*fixed|@keyframes|\.cloud-clinical-workspace\s*\{[^}]*width:\s*\d+px/);
});

test('view bundle contains no SDK, local App/data stores, prescriptions, lab accounts, bulk messaging or import/export graph', () => {
  const inputs = Object.keys(compiled.metafile!.inputs).join('\n');
  // The new visit editor imports pure clinical schema validators. Their graph
  // is not a data capability: the rendered view still has no SDK/auth/store.
  assert.doesNotMatch(inputs, /firebase|cloudOperatingAuth|cloudClinicalPatientProjection|localStorage|dataStore|App\.tsx|Rx|Prescription|WhatsAppComposer|cloudBackup/i);
  const source = compiled.outputFiles[0].text;
  assert.doesNotMatch(source, /createCloudClinicalRepository\(|createCloudOperationIntentRepository\(/);
  const h = harness(), html = renderToStaticMarkup(React.createElement(CloudClinicalWorkspaceView, h.render()));
  assert.match(html, /تسجيل زيارة أو خدمة جديدة غير متاح|بدون تكاليف المعامل أو استيراد أو تصدير/);
  assert.doesNotMatch(html, /<nav|download=|إضافة زيارة|استيراد ملف|تصدير ملف/);
});

function withVisit(h: ReturnType<typeof harness>) {
  const emptyPreview = createCloudClinicalUiPreview(() => true), calls: string[] = [];
  let phase: 'idle' | 'loading' | 'editing' | 'submitting' | 'pending' = 'idle';
  const visit = { ...emptyPreview.visit!, getState: () => ({ phase, snapshot: null, catalog: null, draft: null, error: '', closed: false }),
    begin: async (value: CloudClinicalPatientSnapshot) => { calls.push(`begin:${value.patientRecordId}`); phase = 'editing'; h.bundle.file.setDraftDirty(value.patientRecordId, true); return true; },
    retry: async () => { calls.push('visit-retry'); return true; }, cancelPending: async () => { calls.push('visit-cancel'); return true; } };
  const bundle = { ...h.bundle, visit };
  const render = (changes: { controller?: CloudClinicalWorkspaceBundle; previewOnly?: boolean; closing?: boolean } = {}) => h.render({ controller: bundle, ...changes });
  return { bundle, visit, calls, render, setPhase: (value: typeof phase) => { phase = value; } };
}

test('visit begins explicitly with the exact verified file and immediate repeat cannot begin twice', async () => {
  const h = harness(), v = withVisit(h), props = v.render(), selected = props.state.snapshot!;
  assert.deepEqual(v.calls, []); assert.deepEqual(h.calls, []);
  props.onStartVisit!({ ...selected }); assert.deepEqual(v.calls, []);
  props.onStartVisit!(selected); props.onStartVisit!(selected); await flush();
  assert.deepEqual(v.calls, [`begin:${ID}`]); assert.equal(h.state().draftDirty, true);
  v.render().onStartEdit(selected, selected.patient.sessions[0], 'payment');
  assert.equal(v.render().editor, null); assert.equal(h.calls.some(call => call[0] === 'payment'), false);
});

test('retained visit begin callbacks are inert after preview, closing, replacement and actual file disposal', async () => {
  for (const mode of ['preview', 'closing', 'replacement', 'closed']) {
    const h = harness(), v = withVisit(h), retained = v.render(), selected = retained.state.snapshot!;
    if (mode === 'closed') h.bundle.file.dispose();
    else v.render(mode === 'replacement' ? { controller: harness().bundle } : mode === 'closing' ? { closing: true } : { previewOnly: true });
    retained.onStartVisit!(selected); await flush(); assert.deepEqual(v.calls, []); assert.deepEqual(h.calls, []);
  }
});

test('active visit state blocks payment/progress/close even if an unrelated caller cleared the dirty bit', () => {
  const h = harness(), v = withVisit(h); v.setPhase('loading');
  const props = v.render(), selected = props.state.snapshot!;
  props.onStartEdit(selected, selected.patient.sessions[0], 'payment');
  props.onStartEdit(selected, selected.patient.sessions[0], 'progress'); props.onClose();
  assert.equal(v.render().editor, null); assert.equal(h.closes(), 0); assert.deepEqual(h.calls, []);
});

test('one shared pending panel delegates original visit retry/cancellation to the visit controller only', async () => {
  const h = harness(), v = withVisit(h); v.setPhase('pending');
  h.setState({ saveStatus: 'retry-required', pendingOperationId: OP, draftDirty: true });
  const props = v.render(); props.onRetry(); await flush(); v.render().onCancelPending(); await flush();
  assert.deepEqual(v.calls, ['visit-retry', 'visit-cancel']); assert.deepEqual(h.calls, []);
  h.setState({ saveStatus: 'refresh-required' }); v.render().onCancelPending(); await flush();
  assert.deepEqual(v.calls, ['visit-retry', 'visit-cancel']);
});

test('visit start affordance requires a loaded file and is disabled for a dirty editor or closing page', () => {
  const h = harness(), v = withVisit(h), first = v.render();
  assert.equal(rendered(first).button('تسجيل زيارة أو خدمة').props.disabled, false);
  h.setState({ draftDirty: true }); assert.equal(rendered(v.render()).button('تسجيل زيارة أو خدمة').props.disabled, true);
  h.setState({ draftDirty: false }); assert.equal(rendered(v.render({ closing: true })).button('تسجيل زيارة أو خدمة').props.disabled, true);
  h.setState({ loaded: false, snapshot: null }); assert.equal(rendered(v.render()).elements.some(item => item.type === 'button' && text(item) === 'تسجيل زيارة أو خدمة'), false);
});

test('state getter reentrancy cannot start a visit after the wrapper changed to preview', async () => {
  const h = harness(), v = withVisit(h), props = v.render(), selected = props.state.snapshot!;
  const original = h.bundle.file.getState; let once = true;
  h.bundle.file.getState = () => { if (once) { once = false; v.render({ previewOnly: true }); } return original(); };
  props.onStartVisit!(selected); await flush(); assert.deepEqual(v.calls, []); assert.deepEqual(h.calls, []);
});
