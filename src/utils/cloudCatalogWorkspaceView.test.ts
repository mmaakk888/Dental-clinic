import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { parseCloudServiceCatalogData, type CloudServiceCatalogRecord } from './cloudServiceCatalogRepository';
import type { CloudCatalogWorkspaceController, CloudCatalogWorkspaceDraft, CloudCatalogWorkspaceState } from './cloudCatalogWorkspaceController';
import type { CloudOperationIntent } from './cloudOperationIntent';
import type { CloudCatalogEditor, CloudServiceCatalogWorkspaceViewProps } from '../components/settings/CloudServiceCatalogWorkspace';

// Synthetic hooks, SSR and fabricated settings only. Not visual browser/mobile,
// actual Auth, Firebase, deployed Rules or two-device acceptance testing.
const compiled = await build({ entryPoints: ['src/components/settings/CloudServiceCatalogWorkspace.tsx'], bundle: true,
  write: false, metafile: true, platform: 'node', format: 'cjs', logLevel: 'silent',
  external: ['react', 'react-dom', 'lucide-react'], loader: { '.css': 'empty' } });
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { default: CloudServiceCatalogWorkspace, CloudServiceCatalogWorkspaceView, parseCloudCatalogMoneyText,
  buildCloudCatalogEditorData, cloudCatalogEditorSaveTarget } = module.exports as typeof import('../components/settings/CloudServiceCatalogWorkspace');
const id = (value: number) => `90000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const FIRST = id(1), SECOND = id(2), OP = id(90), WHEN = '2026-10-11T00:00:00.000Z';
function record(): CloudServiceCatalogRecord {
  return { schemaVersion: 1, clinicId: 'main', recordId: 'serviceCatalog', revision: 3, lastOperationId: OP,
    data: { examinationCents: 10_000, services: [
      { serviceId: FIRST, name: 'حشو اختبار مصطنع', kind: 'clinical', priceCents: null, active: true },
      { serviceId: SECOND, name: 'تركيبة اختبار مصطنعة', kind: 'prosthetic', priceCents: 0, active: false },
    ] } };
}
function state(changes: Partial<CloudCatalogWorkspaceState> = {}): CloudCatalogWorkspaceState {
  return { snapshot: null, loaded: false, loading: false, draft: null, saveStatus: 'idle', pendingOperationId: null,
    error: '', notice: '', closed: false, history: [], historyLoaded: false, historyLoading: false, historyNextAfterId: null, ...changes };
}
function editor(sourceDraft: CloudCatalogWorkspaceDraft): CloudCatalogEditor {
  return { sourceDraft, examination: sourceDraft.examinationCents === null ? '' : String(sourceDraft.examinationCents / 100),
    selectedServiceId: sourceDraft.services[0]?.serviceId ?? null,
    rows: sourceDraft.services.map(row => ({ serviceId: row.serviceId, name: row.name, price: row.priceCents === null ? '' : String(row.priceCents / 100), kind: row.kind, active: row.active })) };
}
function intent(status: CloudOperationIntent['status'], operationId = OP): CloudOperationIntent {
  return { schemaVersion: 1, clinicId: 'main', recordId: operationId, operationId, actorUid: 'synthetic-catalog-owner',
    kind: 'catalog', requestHash: 'a'.repeat(64), createdAt: WHEN, revision: status === 'prepared' ? 1 : 2, status,
    command: { operationId, expectedRevision: 3, action: 'save', createdAt: WHEN, data: record().data as any } };
}
function viewProps(changes: Partial<CloudServiceCatalogWorkspaceViewProps> = {}) {
  const calls: any[][] = [];
  const props: CloudServiceCatalogWorkspaceViewProps = { state: state(), editor: null, query: '', filter: 'all',
    onClose: () => calls.push(['close']), onLoad: () => calls.push(['load']), onBeginEdit: () => calls.push(['begin']),
    onQuery: value => calls.push(['query', value]), onFilter: value => calls.push(['filter', value]),
    onUseExamination100: expected => calls.push(['exam100', expected]),
    onChangeEditor: (next, expected) => calls.push(['change', next, expected]), onAddService: value => calls.push(['add', value]),
    onSave: value => calls.push(['save', value]), onCancelEditor: value => calls.push(['cancel', value]),
    onRetry: () => calls.push(['retry']), onCancelPending: () => calls.push(['cancel-pending']),
    onHistoryLoad: () => calls.push(['history']), onHistoryMore: () => calls.push(['more']), onResume: value => calls.push(['resume', value]), ...changes };
  return { props, calls, html: () => renderToStaticMarkup(React.createElement(CloudServiceCatalogWorkspaceView, props)) };
}
type Element = { type: unknown; props: Record<string, any> };
const children = (node: any): any[] => node == null ? [] : Array.isArray(node) ? node.flatMap(children) : [node];
const all = (node: any): Element[] => children(node).flatMap(item => item && typeof item === 'object' && item.props ? [item, ...all(item.props.children)] : []);
const text = (node: any): string => children(node).map(item => typeof item === 'string' || typeof item === 'number' ? String(item) : item?.props ? text(item.props.children) : '').join('');
interface Slots { refs: Array<{ current: any }>; states: any[]; subscriptions: Array<(notify: () => void) => () => void> }
const slots = (): Slots => ({ refs: [], states: [], subscriptions: [] });
function invoke(component: (props: any) => any, props: any, memory = slots()) {
  const internals = (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE, before = internals.H;
  let refIndex = 0, stateIndex = 0;
  internals.H = { useId: () => 'synthetic-catalog', useMemo: (work: () => unknown) => work(), useCallback: (fn: unknown) => fn,
    useRef: (value: unknown) => { const index = refIndex++; return memory.refs[index] ?? (memory.refs[index] = { current: value }); },
    useState: (initial: unknown) => { const index = stateIndex++; if (!(index in memory.states)) memory.states[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      return [memory.states[index], (value: unknown) => { memory.states[index] = typeof value === 'function' ? (value as (old: unknown) => unknown)(memory.states[index]) : value; }]; },
    useSyncExternalStore: (subscribe: (notify: () => void) => () => void, snapshot: () => unknown) => { memory.subscriptions.push(subscribe); return snapshot(); } };
  try { return component(props); } finally { internals.H = before; }
}
function rendered(props: CloudServiceCatalogWorkspaceViewProps, memory = slots()) {
  const tree = invoke(CloudServiceCatalogWorkspaceView, props, memory), elements = all(tree);
  const button = (label: string) => { const found = elements.find(item => item.type === 'button' && text(item) === label); assert.ok(found, label); return found; };
  const input = (suffix: string) => { const found = elements.find(item => ['input', 'select'].includes(item.type as string) && item.props.id?.endsWith(suffix)); assert.ok(found, suffix); return found; };
  return { tree, elements, button, input, content: text(tree) };
}
function harness(loaded = true) {
  let value = loaded ? state({ loaded: true, snapshot: record() }) : state();
  const calls: any[][] = [], behavior = { wait: null as Promise<void> | null, success: true };
  const listeners = new Set<(value: CloudCatalogWorkspaceState) => void>();
  const controller: CloudCatalogWorkspaceController = {
    getState: () => value, subscribe: notify => { listeners.add(notify); return () => { listeners.delete(notify); }; },
    load: async () => { calls.push(['load']); value = { ...value, loaded: true, snapshot: record() }; return true; },
    beginEdit: () => { calls.push(['begin']); if (value.draft || value.closed || value.saveStatus !== 'idle') return false;
      value = { ...value, draft: structuredClone(value.snapshot?.data ?? { examinationCents: null, services: [] }) }; return true; },
    updateDraft: input => { calls.push(['update', input]); try { value = { ...value, draft: parseCloudServiceCatalogData(input) }; return true; } catch { return false; } },
    cancelDraft: () => { calls.push(['cancel']); value = { ...value, draft: null }; return true; },
    save: async () => { calls.push(['save']); value = { ...value, saveStatus: 'saving', pendingOperationId: OP }; await behavior.wait;
      value = { ...value, saveStatus: behavior.success ? 'idle' : 'retry-required', draft: behavior.success ? null : value.draft, pendingOperationId: behavior.success ? null : OP }; return behavior.success; },
    retry: async () => { calls.push(['retry']); await behavior.wait; value = { ...value, saveStatus: 'idle', draft: null, pendingOperationId: null }; return true; },
    cancelPending: async () => { calls.push(['cancel-pending']); return true; },
    resume: async operationId => { calls.push(['resume', operationId]); return true; },
    loadHistory: async () => { calls.push(['history']); }, loadMoreHistory: async () => { calls.push(['more']); },
    dispose: () => { value = state({ closed: true }); },
  };
  return { controller, calls, behavior, replace: (changes: Partial<CloudCatalogWorkspaceState>) => { value = { ...value, ...changes }; }, listeners };
}
const tick = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

test('catalog renders unloaded without reading, editing, SDK, seeded price or fake services', () => {
  const h = harness(false), html = renderToStaticMarkup(React.createElement(CloudServiceCatalogWorkspace, { controller: h.controller, onClose() {} }));
  assert.deepEqual(h.calls, []); assert.match(html, /تحميل الفهرس|لا أسعار افتراضية|حمّل الفهرس أولًا/);
  assert.doesNotMatch(html, /مصطنع|١٠٠ ج.م|value="100"|تم الحفظ|<nav/);
});
test('preview masks supplied snapshot, draft, editor, history, search, error and notice', () => {
  const source = record().data, h = viewProps({ previewOnly: true, query: 'PRIVATE_QUERY',
    state: state({ loaded: true, snapshot: record(), draft: source, history: [intent('committed')], historyLoaded: true,
      pendingOperationId: OP, saveStatus: 'retry-required', error: 'PRIVATE_ERROR', notice: 'PRIVATE_NOTICE' }), editor: editor(source) });
  const html = h.html(), view = rendered(h.props);
  assert.match(html, /معاينة تصميم فقط|لا توجد بيانات في المعاينة/);
  assert.doesNotMatch(html, /مصطنع|PRIVATE_|90000000|value="100"|<form|متابعة نفس العملية/);
  for (const button of view.elements.filter(item => item.type === 'button' && text(item) !== 'إلغاء وإغلاق')) { assert.equal(button.props.disabled, true); button.props.onClick?.(); }
  view.input('-search').props.onChange({ target: { value: 'attempt' } }); assert.deepEqual(h.calls, []);
  view.button('إلغاء وإغلاق').props.onClick(); assert.deepEqual(h.calls, [['close']]);
});
test('closed catalog hides stale supplied settings and actions even without preview flag', () => {
  const h = viewProps({ state: state({ closed: true, loaded: true, snapshot: record(), draft: record().data,
    history: [intent('prepared')], notice: 'PRIVATE_NOTICE' }), editor: editor(record().data) });
  assert.doesNotMatch(h.html(), /مصطنع|PRIVATE_|90000000|value="100"|<form/);
});
test('one vertical catalog distinguishes nullable unknown price, explicit zero, active state and patient prosthetic pricing', () => {
  const h = viewProps({ state: state({ loaded: true, snapshot: record() }) });
  assert.match(h.html(), /حشو اختبار|السعر غير محدد|٠ ج.م|موقوفة|ccat-service-list/);
  h.props.filter = 'prosthetic'; assert.doesNotMatch(h.html(), /حشو اختبار/);
  assert.match(h.html(), /سعر المريض، وليست تكلفة المعمل/);
  h.props.filter = 'clinical'; assert.doesNotMatch(h.html(), /تركيبة اختبار/);
  h.props.filter = 'all'; h.props.query = 'حشو'; assert.doesNotMatch(h.html(), /تركيبة اختبار/);
});
test('Arabic money input is exact integer piastres; blank is null and malformed/fractional-cent/exponent prices are invalid', () => {
  for (const [value, cents] of [['', null], ['٠', 0], ['١٠٠', 10000], ['12.34', 1234], ['١٢٫٣', 1230], ['12,34', 1234], [' 5 ', 500]] as const) {
    assert.deepEqual(parseCloudCatalogMoneyText(value), { valid: true, cents });
  }
  for (const value of ['1e3', '-1', '1.234', '1,000', 'NaN', '١٠ ج', '10000000001', '.', 'Infinity', '1 000']) {
    assert.equal(parseCloudCatalogMoneyText(value).valid, false, value);
  }
});
test('missing exam stays blank; explicit 100 button changes only the open draft and does not save', () => {
  const source = { examinationCents: null, services: [] }, raw = editor(source);
  const h = viewProps({ state: state({ loaded: true, draft: source }), editor: raw }), view = rendered(h.props);
  assert.equal(view.input('-exam-input').props.value, ''); assert.equal(view.button('حفظ قيمة الكشف').props.disabled, true);
  assert.equal(view.button('حفظ الخدمة المحددة').props.disabled, true); assert.equal(view.button('إضافة خدمة').props.disabled, true);
  view.button('استخدام ١٠٠ ج.م للكشف').props.onClick(); assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0][0], 'exam100'); assert.equal(h.calls[0][1], raw);
  assert.equal(source.examinationCents, null);
});
test('editor validates names, explicit kinds and nullable prices; missing exam or duplicate normalized names cannot save', () => {
  const source = record().data, raw = editor(source), h = viewProps({ state: state({ loaded: true, snapshot: record(), draft: source }), editor: raw });
  assert.equal(buildCloudCatalogEditorData(raw)?.services[0].priceCents, null);
  raw.rows[0].price = '0'; assert.equal(buildCloudCatalogEditorData(raw)?.services[0].priceCents, 0);
  raw.examination = ''; assert.equal(buildCloudCatalogEditorData(raw), null);
  raw.examination = '100'; raw.rows[1].name = raw.rows[0].name; assert.equal(buildCloudCatalogEditorData(raw), null);
  assert.equal(rendered(h.props).button('حفظ الخدمة المحددة').props.disabled, true);
});
test('editor ordinary draft blocks close/load/history and requires explicit cancellation', () => {
  const source = record().data, raw = editor(source), h = viewProps({ state: state({ loaded: true, snapshot: record(), draft: source }), editor: raw });
  const view = rendered(h.props);
  assert.equal(view.button('إلغاء وإغلاق').props.disabled, true); view.button('إلغاء وإغلاق').props.onClick();
  assert.equal(view.button('تحديث الفهرس').props.disabled, true); view.button('تحديث الفهرس').props.onClick();
  assert.equal(view.button('تحميل سجل العمليات').props.disabled, true); view.button('تحميل سجل العمليات').props.onClick();
  assert.deepEqual(h.calls, []); view.button('إلغاء المسودة').props.onClick(); assert.deepEqual(h.calls, [['cancel', raw]]);
});
test('retry and acknowledged-refresh show distinct actions; no cancellation after acknowledgement', () => {
  const h = viewProps({ state: state({ saveStatus: 'retry-required', pendingOperationId: OP }) });
  let view = rendered(h.props); assert.match(h.html(), /قد يكون التعديل وصل/);
  view.button('إعادة نفس المحاولة').props.onClick(); view.button('التحقق من إلغاء العملية').props.onClick();
  assert.deepEqual(h.calls, [['retry'], ['cancel-pending']]);
  h.props.state = state({ saveStatus: 'refresh-required', pendingOperationId: OP }); view = rendered(h.props);
  assert.match(h.html(), /تقرأ الفهرس فقط/); assert.doesNotMatch(h.html(), /التحقق من إلغاء العملية/);
  view.button('إعادة التحقق بالقراءة').props.onClick(); assert.equal(h.calls.at(-1)?.[0], 'retry');
});
test('all-status history shows original UUID/date, resumes prepared and committed, never cancelled', () => {
  const records = [intent('prepared'), intent('committed', id(91)), intent('cancelled', id(92))];
  const h = viewProps({ state: state({ history: records, historyLoaded: true, historyNextAfterId: id(92) }) });
  const view = rendered(h.props), buttons = view.elements.filter(item => item.type === 'button' && text(item).startsWith('متابعة نفس العملية'));
  assert.equal(buttons.length, 3); assert.equal(buttons[2].props.disabled, true);
  buttons.forEach(button => button.props.onClick()); assert.deepEqual(h.calls, [['resume', records[0]], ['resume', records[1]]]);
  assert.match(h.html(), /datetime="2026-10-11T00:00:00.000Z"|90000000-0000-4000-8000-000000000090/);
  assert.match(h.html(), /ليست قائمة الأحدث عالميًا/); view.button('تحميل الصفحة التالية').props.onClick(); assert.equal(h.calls.at(-1)?.[0], 'more');
});
test('retained view actions recheck preview, disposal, pending state, current draft and history object identity', () => {
  for (const change of [{ previewOnly: true }, { state: state({ closed: true }) }, { state: state({ loading: true }) }, { state: state({ saveStatus: 'saving' }) }]) {
    const source = record().data, h = viewProps({ state: state({ loaded: true, draft: source }), editor: editor(source) }), memory = slots();
    const old = rendered(h.props, memory);
    invoke(CloudServiceCatalogWorkspaceView, { ...h.props, ...change }, memory);
    old.input('-name').props.onChange({ target: { value: 'stale' } }); old.button('إلغاء المسودة').props.onClick(); old.button('إضافة خدمة').props.onClick();
    old.elements.find(item => item.type === 'form')!.props.onSubmit({ preventDefault() {} }); assert.deepEqual(h.calls, []);
  }
  const item = intent('committed'), h = viewProps({ state: state({ history: [item] }) }), memory = slots();
  const retained = rendered(h.props, memory).elements.find(item => item.type === 'button' && text(item).startsWith('متابعة نفس العملية'))!;
  invoke(CloudServiceCatalogWorkspaceView, { ...h.props, state: state({ history: [structuredClone(item)] }) }, memory);
  retained.props.onClick(); assert.deepEqual(h.calls, []);
});
test('wrapper preview prevents all direct data/draft/save/history callbacks and consumes no random ID', async () => {
  const h = harness(), memory = slots(); let closes = 0;
  const props = invoke(CloudServiceCatalogWorkspace, { controller: h.controller, previewOnly: true, onClose: () => closes++ }, memory).props;
  const raw = editor(record().data);
  props.onLoad(); props.onBeginEdit(); props.onAddService(raw); props.onChangeEditor(raw, raw); props.onCancelEditor(raw); props.onSave(raw);
  props.onUseExamination100(raw);
  props.onRetry(); props.onCancelPending(); props.onHistoryLoad(); props.onHistoryMore(); props.onResume(intent('committed'));
  await tick(); assert.deepEqual(h.calls, []); props.onClose(); assert.equal(closes, 1);
});
test('wrapper marks draft before fields are edited; invalid local input cannot close or silently save the old value', () => {
  const h = harness(), memory = slots(); let closes = 0; const props = { controller: h.controller, onClose: () => closes++ };
  let view = invoke(CloudServiceCatalogWorkspace, props, memory).props;
  view.onBeginEdit(); assert.ok(h.controller.getState().draft);
  view = invoke(CloudServiceCatalogWorkspace, props, memory).props;
  const raw = view.editor as CloudCatalogEditor;
  view.onChangeEditor({ ...raw, examination: '' }, raw);
  view = invoke(CloudServiceCatalogWorkspace, props, memory).props;
  assert.equal(view.editor.examination, ''); view.onSave(view.editor); view.onClose();
  assert.equal(closes, 0); assert.deepEqual(h.calls, [['begin']]);
  view.onCancelEditor(view.editor); assert.equal(h.controller.getState().draft, null); assert.equal(h.calls.at(-1)?.[0], 'cancel');
});
test('explicit owner 100 button updates only examination draft piastres, preserves incomplete inputs and never saves', () => {
  const h = harness(), memory = slots(), props = { controller: h.controller, onClose() {} };
  invoke(CloudServiceCatalogWorkspace, props, memory).props.onBeginEdit();
  let view = invoke(CloudServiceCatalogWorkspace, props, memory).props;
  const raw = view.editor as CloudCatalogEditor;
  view.onChangeEditor({ ...raw, rows: raw.rows.map((row, index) => index === 0 ? { ...row, name: '' } : row) }, raw);
  view = invoke(CloudServiceCatalogWorkspace, props, memory).props;
  view.onUseExamination100(view.editor);
  view = invoke(CloudServiceCatalogWorkspace, props, memory).props;
  assert.equal(h.controller.getState().draft?.examinationCents, 10000);
  assert.equal(view.editor.examination, '100'); assert.equal(view.editor.rows[0].name, '');
  assert.equal(h.controller.getState().draft?.services[0].name, 'حشو اختبار مصطنع');
  assert.equal(h.calls.filter(call => call[0] === 'save').length, 0);
});
test('one retained add callback cannot duplicate a new stable UUID row and incomplete new service does not overwrite the catalog', () => {
  const h = harness(), memory = slots(), props = { controller: h.controller, onClose() {} };
  invoke(CloudServiceCatalogWorkspace, props, memory).props.onBeginEdit();
  let view = invoke(CloudServiceCatalogWorkspace, props, memory).props;
  const before = view.editor as CloudCatalogEditor;
  view.onAddService(before); view.onAddService(before);
  view = invoke(CloudServiceCatalogWorkspace, props, memory).props;
  assert.equal(view.editor.rows.length, 3); assert.equal(view.editor.rows[2].name, ''); assert.equal(view.editor.rows[2].price, '');
  assert.match(view.editor.rows[2].serviceId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  view.onSave(view.editor); assert.equal(h.calls.filter(call => ['save', 'update'].includes(call[0])).length, 0);
  assert.equal(h.controller.getState().snapshot?.data.services.length, 2);
});
test('a reentrant random ID provider cannot publish a new row after disposal or entry into preview', t => {
  let supplier: () => string = () => id(3000);
  t.mock.method(globalThis.crypto, 'randomUUID', () => supplier());
  for (const mode of ['closed', 'preview']) {
    const h = harness(), memory = slots(), props = { controller: h.controller, onClose() {} };
    invoke(CloudServiceCatalogWorkspace, props, memory).props.onBeginEdit();
    const view = invoke(CloudServiceCatalogWorkspace, props, memory).props, raw = view.editor as CloudCatalogEditor;
    supplier = () => { if (mode === 'closed') h.controller.dispose();
      else invoke(CloudServiceCatalogWorkspace, { ...props, previewOnly: true }, memory); return id(3000); };
    view.onAddService(raw);
    assert.equal(memory.states[2], raw, mode);
    assert.equal(raw.rows.length, 2);
    assert.equal(h.calls.filter(call => call[0] === 'update' || call[0] === 'save').length, 0);
  }
});
test('wrapper complete save updates one validated draft, awaits result and suppresses duplicate submits', async () => {
  const h = harness(), memory = slots(); let release!: () => void;
  h.behavior.wait = new Promise<void>(resolve => { release = resolve; });
  const props = { controller: h.controller, onClose() {} };
  invoke(CloudServiceCatalogWorkspace, props, memory).props.onBeginEdit();
  let view = invoke(CloudServiceCatalogWorkspace, props, memory).props, raw = view.editor;
  view.onChangeEditor({ ...raw, examination: '200' }, raw);
  view = invoke(CloudServiceCatalogWorkspace, props, memory).props; raw = view.editor;
  view.onSave(raw); view.onSave(raw); view.onCancelEditor(raw); view.onLoad();
  assert.equal(h.calls.filter(call => call[0] === 'update').length, 1); assert.equal(h.calls.filter(call => call[0] === 'save').length, 1);
  view = invoke(CloudServiceCatalogWorkspace, props, memory).props; assert.ok(view.editor); assert.equal(view.state.saveStatus, 'saving');
  release(); await tick(); view = invoke(CloudServiceCatalogWorkspace, props, memory).props; assert.equal(view.editor, null);
});
test('wrapper failed save retains raw draft with the same source revision and delegates retries only', async () => {
  const h = harness(), memory = slots(); h.behavior.success = false; const props = { controller: h.controller, onClose() {} };
  invoke(CloudServiceCatalogWorkspace, props, memory).props.onBeginEdit();
  let view = invoke(CloudServiceCatalogWorkspace, props, memory).props;
  view.onChangeEditor({ ...view.editor, examination: '200' }, view.editor);
  view = invoke(CloudServiceCatalogWorkspace, props, memory).props; view.onSave(view.editor); await tick();
  view = invoke(CloudServiceCatalogWorkspace, props, memory).props; assert.ok(view.editor); assert.equal(view.state.saveStatus, 'retry-required');
  view.onSave(view.editor); view.onLoad(); view.onBeginEdit(); assert.equal(h.calls.filter(call => call[0] === 'save').length, 1);
  view.onRetry(); await tick(); assert.equal(h.calls.filter(call => call[0] === 'retry').length, 1);
});
test('late accepted save on replaced controller cannot clear the new controller editor', async () => {
  const h = harness(), next = harness(), memory = slots(); let release!: () => void;
  h.behavior.wait = new Promise<void>(resolve => { release = resolve; });
  const props = { controller: h.controller, onClose() {} };
  invoke(CloudServiceCatalogWorkspace, props, memory).props.onBeginEdit();
  let view = invoke(CloudServiceCatalogWorkspace, props, memory).props;
  view.onChangeEditor({ ...view.editor, examination: '200' }, view.editor);
  view = invoke(CloudServiceCatalogWorkspace, props, memory).props; view.onSave(view.editor);
  // A replacement must not become actionable while an old local action is
  // running; after that promise settles it still must not erase another draft.
  const replacement = { ...props, controller: next.controller };
  invoke(CloudServiceCatalogWorkspace, replacement, memory);
  release(); await tick();
  invoke(CloudServiceCatalogWorkspace, replacement, memory).props.onBeginEdit();
  view = invoke(CloudServiceCatalogWorkspace, replacement, memory).props;
  assert.ok(view.editor); assert.equal(view.editor.rows[0].name, 'حشو اختبار مصطنع');
  assert.equal(next.controller.getState().draft, view.editor.sourceDraft);
});
test('retained wrapper editor callbacks cannot act after preview, controller replacement, draft replacement or disposal', () => {
  for (const mode of ['preview', 'replacement', 'draft', 'closed']) {
    const h = harness(), memory = slots(), props = { controller: h.controller, onClose() {} };
    invoke(CloudServiceCatalogWorkspace, props, memory).props.onBeginEdit();
    const retained = invoke(CloudServiceCatalogWorkspace, props, memory).props;
    if (mode === 'draft') h.replace({ draft: structuredClone(h.controller.getState().draft) });
    if (mode === 'closed') h.controller.dispose();
    invoke(CloudServiceCatalogWorkspace, mode === 'preview' ? { ...props, previewOnly: true }
      : mode === 'replacement' ? { ...props, controller: harness().controller } : props, memory);
    const before = h.calls.length;
    retained.onChangeEditor({ ...retained.editor, examination: '200' }, retained.editor);
    retained.onSave(retained.editor); retained.onCancelEditor(retained.editor); retained.onAddService(retained.editor);
    assert.equal(h.calls.length, before, mode);
  }
});
test('wrapper resumes only a freshly present exact history record UUID and never a cancelled or cloned one', async () => {
  const h = harness(), memory = slots(), item = intent('committed'); h.replace({ history: [item] });
  const props = invoke(CloudServiceCatalogWorkspace, { controller: h.controller, onClose() {} }, memory).props;
  props.onResume(structuredClone(item)); assert.deepEqual(h.calls, []); props.onResume(item); await tick();
  assert.deepEqual(h.calls, [['resume', OP]]);
  h.replace({ history: [intent('cancelled')] }); props.onResume(item); assert.equal(h.calls.length, 1);
});
test('loaded server text is React escaped rather than injected into names or notices', () => {
  const data = record(); data.data.services[0].name = '<script>PRIVATE_NAME</script>';
  const h = viewProps({ state: state({ loaded: true, snapshot: data, notice: '<img onerror=1>' }) });
  assert.match(h.html(), /&lt;script&gt;|&lt;img/); assert.doesNotMatch(h.html(), /<script>|<img onerror/);
});
test('scoped CSS supplies compact responsive columns, wrapping, 44px controls, 16px inputs and reduced motion without horizontal carousels', async () => {
  const css = await readFile('src/components/settings/CloudServiceCatalogWorkspace.css', 'utf8');
  assert.match(css, /\.cloud-catalog-workspace/); assert.match(css, /min-height:44px/); assert.match(css, /font-size:16px/);
  assert.match(css, /grid-template-columns:minmax\(0,1\.65fr\)/); assert.match(css, /@media\(max-width:480px\)/);
  assert.match(css, /overflow-wrap:anywhere/); assert.match(css, /prefers-reduced-motion:reduce/);
  assert.doesNotMatch(css, /overflow-x:\s*(auto|scroll)|position:\s*fixed|transition:\s*all/);
});
test('view dependency graph excludes SDK, local settings/catalog, persistence and provider modules', () => {
  const inputs = Object.keys(compiled.metafile!.inputs);
  for (const fragment of ['firebase/', 'firebaseCloud', 'serviceCatalog.ts', 'initialData', 'storage.ts', 'WhatsAppComposer']) {
    assert.equal(inputs.some(input => input.includes(fragment)), false, fragment);
  }
});

test('view has explicit examination and selected-service saves, and refuses mixed changes instead of dropping edits', () => {
  const saved = record(), source = structuredClone(saved.data), initial = editor(source);
  assert.equal(cloudCatalogEditorSaveTarget(initial, saved), null);
  const fee = { ...initial, examination: '200' }; assert.equal(cloudCatalogEditorSaveTarget(fee, saved), 'examination');
  const changed = { ...initial, rows: initial.rows.map((row, index) => index === 0 ? { ...row, price: '125' } : row) };
  assert.equal(cloudCatalogEditorSaveTarget(changed, saved), FIRST);
  assert.equal(cloudCatalogEditorSaveTarget({ ...changed, examination: '200' }, saved), null);
  const h = viewProps({ state: state({ loaded: true, snapshot: saved, draft: source }), editor: changed });
  const view = rendered(h.props); assert.ok(view.button('حفظ قيمة الكشف')); assert.ok(view.button('حفظ الخدمة المحددة'));
  assert.equal(view.button('حفظ الخدمة المحددة').props.disabled, false);
  assert.equal(view.button('حفظ قيمة الكشف').props.disabled, true);
});

test('temporary checking rejects retained catalog actions and preserves the raw editor for the same lease', () => {
  const h = harness(), memory = slots(), props = { controller: h.controller, onClose() {} };
  const old = invoke(CloudServiceCatalogWorkspace, props, memory).props;
  invoke(CloudServiceCatalogWorkspace, { ...props, disabled: true }, memory);
  old.onLoad(); old.onBeginEdit(); old.onHistoryLoad(); old.onHistoryMore(); assert.deepEqual(h.calls, []);
  const enabled = invoke(CloudServiceCatalogWorkspace, props, memory).props; enabled.onBeginEdit();
  const edited = invoke(CloudServiceCatalogWorkspace, props, memory).props, before = h.calls.length;
  invoke(CloudServiceCatalogWorkspace, { ...props, disabled: true }, memory); edited.onSave(edited.editor); edited.onCancelEditor(edited.editor);
  assert.equal(h.calls.length, before); assert.ok(h.controller.getState().draft); assert.equal(h.controller.getState().closed, false);
});
