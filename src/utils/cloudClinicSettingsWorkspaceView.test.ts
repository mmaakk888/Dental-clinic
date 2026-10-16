import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import type { CloudClinicSettingsData, CloudLabDefinitionData, CloudSettingsRecord, CloudSettingsTarget } from './cloudClinicSettingsRepository';
import type { CloudClinicSettingsWorkspaceController, CloudClinicSettingsWorkspaceDraft, CloudClinicSettingsWorkspaceState } from './cloudClinicSettingsWorkspaceController';
import type { CloudClinicSettingsWorkspaceViewProps } from '../components/settings/CloudClinicSettingsWorkspace';
import type { CloudOperationIntent } from './cloudOperationIntent';

// Fabricated settings, synthetic hooks and SSR only. Not browser/mobile visual
// QA, actual owner/Auth/Firebase/Rules, uploads or cross-device acceptance.
const compiled = await build({ entryPoints: ['src/components/settings/CloudClinicSettingsWorkspace.tsx'], bundle: true,
  write: false, metafile: true, platform: 'node', format: 'cjs', logLevel: 'silent', external: ['react', 'react-dom', 'lucide-react'], loader: { '.css': 'empty' } });
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { default: Workspace, CloudClinicSettingsWorkspaceView: View, emptyCloudClinicSettingsEditor, buildCloudSettingsEditorData } = module.exports as typeof import('../components/settings/CloudClinicSettingsWorkspace');
const id = (number: number) => `60000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const LAB = id(1), MATERIAL = id(2), SERVICE = id(3), OP = id(90), WHEN = '2026-10-12T00:00:00.000Z';
const envelope = (recordId: string, data: unknown): CloudSettingsRecord => ({ schemaVersion: 1, clinicId: 'main', recordId,
  revision: 3, lastOperationId: OP, data } as CloudSettingsRecord);
function settings(): CloudClinicSettingsData {
  const value = emptyCloudClinicSettingsEditor();
  value.identity.clinicName = 'PRIVATE_SYNTHETIC_CLINIC';
  value.theme = { primary: '#2563eb', secondary: '#1d4ed8', accent: '#f59e0b', background: '#f8fafc', fontFamily: "'Cairo', sans-serif", customFontUrl: null };
  for (const key of Object.keys(value.content.navigationLabels) as Array<keyof typeof value.content.navigationLabels>) value.content.navigationLabels[key] = `قسم ${key}`;
  for (const tile of Object.values(value.content.tiles)) tile.title = 'عنوان مصطنع';
  value.content.tabs = { info: 'البيانات', chart: 'الأسنان', sessions: 'الجلسات', finance: 'الحساب', lab: 'المعمل' };
  value.medications = [{ medicationId: id(10), name: 'دواء مصطنع', category: '', defaultDosage: '', defaultDuration: '', active: true }];
  value.whatsapp.templates = [{ templateId: id(11), key: 'newAppt', title: 'موعد مصطنع', text: 'أهلًا {patientName} 🌷' }];
  return value;
}
function lab(): CloudLabDefinitionData { return { name: 'PRIVATE_SYNTHETIC_LAB', phone: '', address: '', notes: '', active: true,
  costs: [{ materialId: MATERIAL, name: 'مادة مصطنعة', category: 'fixed', unitLabel: 'تاج', billingBasis: 'per-unit', unitCostCents: 12345, active: true }] }; }
const png = () => ({ mimeType: 'image/png' as const, base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZNsAAAAASUVORK5CYII=', width: 1, height: 1 });
function draft(target: CloudSettingsTarget = 'clinicSettings', data: unknown = settings()): CloudClinicSettingsWorkspaceDraft {
  return { target, recordId: target === 'lab' ? LAB : target, expectedRevision: 3, data: data as any };
}
function state(changes: Partial<CloudClinicSettingsWorkspaceState> = {}): CloudClinicSettingsWorkspaceState {
  return { selection: { target: 'clinicSettings', recordId: 'clinicSettings' }, snapshot: null, loaded: false, loading: false,
    draft: null, pendingOperationId: null, saveStatus: 'idle', error: '', notice: '', closed: false, labs: [], labsLoaded: false,
    labsNextAfterId: null, catalog: null, referencesLoaded: false, history: [], historyLoaded: false, historyLoading: false, historyNextAfterId: null, ...changes };
}
function intent(status: CloudOperationIntent['status'], operationId = OP): CloudOperationIntent {
  return { schemaVersion: 1, clinicId: 'main', recordId: operationId, operationId, actorUid: 'synthetic-settings-owner', kind: 'settings',
    requestHash: 'a'.repeat(64), createdAt: WHEN, revision: status === 'prepared' ? 1 : 2, status,
    command: { target: 'clinicSettings', recordId: 'clinicSettings', operationId, expectedRevision: 3, createdAt: WHEN, data: settings() as any } };
}
function viewProps(changes: Partial<CloudClinicSettingsWorkspaceViewProps> = {}) {
  const calls: any[][] = [];
  const props: CloudClinicSettingsWorkspaceViewProps = { state: state(), section: 'identity', onSection: value => calls.push(['section', value]),
    onClose: () => calls.push(['close']), onLoad: () => calls.push(['load']), onBegin: () => calls.push(['begin']),
    onUpdate: (value, expected) => calls.push(['update', value, expected]), onSave: expected => calls.push(['save', expected]),
    onCancel: expected => calls.push(['cancel', expected]), onRetry: () => calls.push(['retry']), onCancelPending: () => calls.push(['cancel-pending']),
    onHistory: value => calls.push(['history', value]), onResume: value => calls.push(['resume', value]), onLabs: value => calls.push(['labs', value]),
    onSelectLab: value => calls.push(['select-lab', value]), onNewLab: () => calls.push(['new-lab']), onReferences: () => calls.push(['references']),
    onAddId: (work, expected) => calls.push(['add-id', work, expected]), onLogo: (file, expected) => calls.push(['logo', file, expected]), ...changes };
  return { props, calls, html: () => renderToStaticMarkup(React.createElement(View, props)) };
}
type Element = { type: unknown; props: Record<string, any> };
const children = (node: any): any[] => node == null ? [] : Array.isArray(node) ? node.flatMap(children) : [node];
const all = (node: any): Element[] => children(node).flatMap(item => item && typeof item === 'object' && item.props ? [item, ...all(item.props.children)] : []);
const text = (node: any): string => children(node).map(item => typeof item === 'string' || typeof item === 'number' ? String(item) : item?.props ? text(item.props.children) : '').join('');
interface Slots { refs: Array<{ current: any }>; states: any[] }
const slots = (): Slots => ({ refs: [], states: [] });
function invoke(component: (props: any) => any, props: any, memory = slots()) {
  const internals = (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE, previous = internals.H;
  let refIndex = 0, stateIndex = 0;
  internals.H = { useId: () => 'synthetic-settings', useCallback: (fn: unknown) => fn,
    useRef: (value: unknown) => { const index = refIndex++; return memory.refs[index] ?? (memory.refs[index] = { current: value }); },
    useState: (initial: unknown) => { const index = stateIndex++; if (!(index in memory.states)) memory.states[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      return [memory.states[index], (value: unknown) => { memory.states[index] = typeof value === 'function' ? (value as (old: unknown) => unknown)(memory.states[index]) : value; }]; },
    useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot() };
  try { return component(props); } finally { internals.H = previous; }
}
function rendered(props: CloudClinicSettingsWorkspaceViewProps, memory = slots()) {
  const tree = invoke(View, props, memory), elements = all(tree);
  const button = (label: string) => { const found = elements.find(item => item.type === 'button' && text(item) === label); assert.ok(found, label); return found; };
  const field = (label: string) => { const found = elements.find(item => item.type === 'label' && text(item).startsWith(label)); assert.ok(found, label);
    const input = all(found).find(item => ['input', 'textarea', 'select'].includes(item.type as string)); assert.ok(input, label); return input; };
  return { tree, elements, button, field, content: text(tree) };
}
function harness(initial = state({ loaded: true, snapshot: envelope('clinicSettings', settings()) })) {
  let value = initial; const calls: any[][] = [];
  const controller: CloudClinicSettingsWorkspaceController = {
    getState: () => value, subscribe: () => () => {}, canClose: () => !value.loading && !value.draft && !value.pendingOperationId,
    load: async (target = 'clinicSettings', recordId = target) => { calls.push(['load', target, recordId]); value = { ...value, selection: { target, recordId }, loaded: true, snapshot: null }; return true; },
    beginEdit: () => { calls.push(['begin']); if (!value.loaded || value.draft || value.closed) return false;
      value = { ...value, draft: { target: value.selection.target, recordId: value.selection.recordId, expectedRevision: value.snapshot?.revision ?? 0, data: structuredClone(value.snapshot?.data ?? null) as any } }; return true; },
    updateDraft: (data, expected = value.draft) => { if (value.draft !== expected) return false; calls.push(['update', data]); value = { ...value, draft: { ...value.draft!, data: structuredClone(data) as any } }; return true; },
    cancelDraft: expected => { if (value.draft !== expected) return false; calls.push(['cancel']); value = { ...value, draft: null }; return true; },
    save: async expected => { if (value.draft !== expected) return false; calls.push(['save', expected]); return true; },
    retry: async () => { calls.push(['retry']); return true; }, cancelPending: async () => { calls.push(['cancel-pending']); return true; },
    resume: async operationId => { calls.push(['resume', operationId]); return true; },
    loadLabs: async () => { calls.push(['labs']); return true; }, loadMoreLabs: async () => { calls.push(['more-labs']); return true; },
    loadRoutingReferences: async () => { calls.push(['references']); return true; },
    loadHistory: async () => { calls.push(['history']); return true; }, loadMoreHistory: async () => { calls.push(['more-history']); return true; },
    dispose: () => { value = state({ closed: true }); },
  };
  return { controller, calls, replace: (changes: Partial<CloudClinicSettingsWorkspaceState>) => { value = { ...value, ...changes }; } };
}
function wrapper(h: ReturnType<typeof harness>, memory = slots(), changes: Record<string, unknown> = {}) {
  const tree = invoke(Workspace, { controller: h.controller, onClose() {}, ...changes }, memory);
  const view = all(tree).find(item => item.type === View); assert.ok(view); return view.props as CloudClinicSettingsWorkspaceViewProps;
}
const tick = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

test('settings workspace mount is inert and missing data is not seeded', () => {
  const h = harness(state()), html = renderToStaticMarkup(React.createElement(Workspace, { controller: h.controller, onClose() {} }));
  assert.deepEqual(h.calls, []); assert.match(html, /فتح مساحة الإعدادات لا يقرأ بيانات تلقائيًا/);
  assert.doesNotMatch(html, /PRIVATE_|value="100"|value="#2563eb"|data:image|تم الحفظ/);
  assert.ok(Object.keys(compiled.metafile!.inputs).every(path => !/firebase|StorageService|localStorage|firebaseAuth/i.test(path)));
});

test('preview and closed views mask supplied identity, cost, logo, history and errors', () => {
  for (const mode of ['preview', 'closed']) for (const section of ['identity', 'labs', 'logo'] as const) {
    const target = section === 'labs' ? 'lab' : section === 'logo' ? 'clinicLogo' : 'clinicSettings';
    const data = section === 'labs' ? lab() : section === 'logo' ? png() : settings();
    const h = viewProps({ previewOnly: mode === 'preview', section, state: state({ closed: mode === 'closed', loaded: true,
      selection: { target, recordId: target === 'lab' ? LAB : target }, snapshot: envelope(target, data), draft: draft(target, data),
      history: [intent('prepared')], error: 'PRIVATE_ERROR', notice: 'PRIVATE_NOTICE', labs: [envelope(LAB, lab()) as any] }) });
    assert.doesNotMatch(h.html(), /PRIVATE_|60000000|data:image|123\.45|<input|<textarea|متابعة نفس العملية/);
    const view = rendered(h.props); for (const button of view.elements.filter(item => item.type === 'button' && text(item) !== 'إلغاء وإغلاق')) { assert.equal(button.props.disabled, true); button.props.onClick?.(); }
    assert.deepEqual(h.calls, []); view.button('إلغاء وإغلاق').props.onClick(); assert.deepEqual(h.calls, [['close']]);
  }
});

test('eight explicit sections; unloaded lab management remains reachable without beginning wrong target', () => {
  const h = viewProps({ section: 'labs' }), view = rendered(h.props);
  for (const label of ['بيانات العيادة', 'المظهر', 'المحتوى والشريط', 'الأدوية', 'قوالب واتساب', 'المعامل وأسعارها', 'توجيه التركيبات', 'الشعار']) assert.ok(view.button(label));
  view.button('تحميل المعامل').props.onClick(); view.button('معمل جديد').props.onClick(); assert.deepEqual(h.calls, [['labs', false], ['new-lab']]);
  assert.equal(view.button('إعداد القسم صراحة').props.disabled, true);
});

test('blank required settings cannot save; choices remain explicit editable draft only', () => {
  const empty = emptyCloudClinicSettingsEditor(); assert.equal(empty.identity.clinicName, ''); assert.equal(empty.theme.primary, ''); assert.equal(empty.content.navigationLabels.patients, '');
  const raw = draft('clinicSettings', empty), h = viewProps({ state: state({ loaded: true, draft: raw }), section: 'appearance' }), view = rendered(h.props);
  assert.equal(buildCloudSettingsEditorData(raw), undefined); assert.equal(view.button('حفظ القسم').props.disabled, true);
  view.button('اختيار أزرق وخط القاهرة').props.onClick(); assert.equal(h.calls[0][0], 'update'); assert.equal(h.calls[0][1].theme.primary, '#2563eb');
  assert.equal(h.calls[0][1].identity.clinicName, ''); assert.equal(h.calls.some(call => call[0] === 'save'), false); assert.equal(empty.theme.primary, '');
});

test('ordinary drafts preserve raw input and block close/read/history/target switches, not same-record tabs', () => {
  const data = settings(); data.identity.clinicName = ''; const raw = draft('clinicSettings', data);
  const h = viewProps({ state: state({ loaded: true, draft: raw }) }), view = rendered(h.props);
  assert.equal(view.field('اسم العيادة').props.value, ''); assert.equal(view.button('حفظ القسم').props.disabled, true);
  for (const label of ['إلغاء وإغلاق', 'تحميل / تحديث القسم', 'تحميل سجل العمليات', 'المعامل وأسعارها', 'توجيه التركيبات', 'الشعار']) {
    const button = view.button(label); assert.equal(button.props.disabled, true); button.props.onClick();
  }
  assert.deepEqual(h.calls, []); view.button('المظهر').props.onClick(); assert.deepEqual(h.calls, [['section', 'appearance']]);
  view.button('إلغاء المسودة').props.onClick(); assert.equal(h.calls.at(-1)?.[1], raw);
});

test('content exposes independent mobile/desktop order and more only for mobile', () => {
  const data = settings(); data.content.desktop.order.reverse(); const raw = draft('clinicSettings', data);
  const h = viewProps({ state: state({ loaded: true, draft: raw }), section: 'content' }), view = rendered(h.props);
  assert.match(h.html(), /شريط الموبايل|شريط الكمبيوتر|عدد الروابط المباشرة/);
  assert.equal(view.elements.filter(item => item.type === 'label' && text(item) === 'في المزيد').length, 6);
  const lists = view.elements.filter(item => item.type === 'fieldset');
  assert.equal(text(lists[0]).indexOf('المرضى') < text(lists[0]).indexOf('الإعدادات'), true);
  assert.equal(text(lists[1]).indexOf('الإعدادات') < text(lists[1]).indexOf('المرضى'), true);
});

test('lab cost parsing preserves unknown/zero/exact Arabic cents and rejects unfinished or invalid prices', () => {
  for (const [text, cents] of [['', null], ['٠', 0], ['١٢٣٫٤٥', 12345], ['12.3', 1230], [' 5 ', 500]] as const) {
    const data = lab() as any; data.costs[0].unitCostCents = text; const converted = buildCloudSettingsEditorData(draft('lab', data)) as CloudLabDefinitionData;
    assert.equal(converted.costs[0].unitCostCents, cents, text); assert.equal(data.costs[0].unitCostCents, text);
  }
  for (const text of ['12.', '1e3', '-1', '1.234', 'NaN', '١٠ ج', '1,23', '.']) {
    const data = lab() as any; data.costs[0].unitCostCents = text; assert.equal(buildCloudSettingsEditorData(draft('lab', data)), undefined, text);
  }
  const h = viewProps({ section: 'labs', state: state({ loaded: true, selection: { target: 'lab', recordId: LAB }, draft: draft('lab', lab()) }) });
  assert.match(h.html(), /تكلفة المعمل بالجنيه|لكل تاج \/ وحدة|للحالة كاملة|أسعار المريض والكشف من قسم الخدمات/);
  assert.doesNotMatch(h.html(), /سعر المريض بالجنيه|قيمة الكشف|priceCents/);
});

test('routing requires explicit reference load and does not guess a service, lab or material', () => {
  const raw = draft('prostheticRouting', { routes: [] }), h = viewProps({ section: 'routing', state: state({ loaded: true,
    selection: { target: 'prostheticRouting', recordId: 'prostheticRouting' }, draft: raw }) });
  assert.equal(rendered(h.props).button('توجيه جديد').props.disabled, true); assert.equal(rendered(h.props).button('تحميل الخدمات والمعامل للتوجيه').props.disabled, true);
  h.props.state = state({ loaded: true, selection: { target: 'prostheticRouting', recordId: 'prostheticRouting' }, snapshot: envelope('prostheticRouting', { routes: [] }) });
  rendered(h.props).button('تحميل الخدمات والمعامل للتوجيه').props.onClick(); assert.deepEqual(h.calls, [['references']]);
  h.props.state = state({ ...h.props.state, draft: raw, referencesLoaded: true }); rendered(h.props).button('توجيه جديد').props.onClick();
  assert.deepEqual(h.calls[1][1], { routes: [{ serviceId: '', labId: '', materialId: '' }] }); assert.equal(h.calls[1][2], raw);
});

test('WhatsApp existing templates/preferences are editable without credentials or consent inference', () => {
  const h = viewProps({ section: 'whatsapp', state: state({ loaded: true, draft: draft() }) });
  assert.match(h.html(), /موعد مصطنع|patientName|لا يربط API|موافقة الحملات لا تُستنتج|غير مفعّلة دون مزوّد/);
  assert.doesNotMatch(h.html(), /type="password"|مفتاح API|accessToken|webhookSecret|providerToken/);
  assert.equal(rendered(h.props).field('نص القالب').props.value, 'أهلًا {patientName} 🌷');
});

test('logo clearing draft does not fall back to stored bytes; invalid raw images are never rendered', () => {
  const selection = { target: 'clinicLogo' as const, recordId: 'clinicLogo' }, saved = envelope('clinicLogo', png());
  const h = viewProps({ section: 'logo', state: state({ loaded: true, selection, snapshot: saved }) });
  assert.match(h.html(), /data:image\/png;base64,/);
  h.props.state = state({ loaded: true, selection, snapshot: saved, draft: draft('clinicLogo', null) }); assert.doesNotMatch(h.html(), /data:image/);
  h.props.state = state({ loaded: true, selection, snapshot: saved, draft: draft('clinicLogo', { ...png(), mimeType: 'text/html' }) }); assert.doesNotMatch(h.html(), /data:text|data:image/);
  h.props.state = state({ loaded: true, selection: { target: 'clinicSettings', recordId: 'clinicSettings' }, snapshot: envelope('clinicSettings', settings()) }); h.props.section = 'identity';
  assert.doesNotMatch(h.html(), /data:image/);
});

test('retained view handlers recheck preview, disposal, pending state and exact draft identity', () => {
  for (const changes of [{ previewOnly: true }, { state: state({ closed: true }) }, { state: state({ loading: true }) },
    { state: state({ saveStatus: 'retry-required', pendingOperationId: OP }) }, { state: state({ loaded: true, draft: draft() }) }]) {
    const raw = draft(), h = viewProps({ state: state({ loaded: true, draft: raw }) }), memory = slots(), retained = rendered(h.props, memory);
    invoke(View, { ...h.props, ...changes }, memory);
    retained.field('اسم العيادة').props.onChange({ target: { value: 'STALE' } }); retained.button('حفظ القسم').props.onClick(); retained.button('إلغاء المسودة').props.onClick();
    assert.deepEqual(h.calls, []);
  }
});

test('history retains operation UUID and all statuses; cancelled or replaced history entries cannot resume', () => {
  const records = [intent('prepared'), intent('committed', id(91)), intent('cancelled', id(92))];
  const h = viewProps({ state: state({ history: records, historyLoaded: true, historyNextAfterId: id(92) }) }), memory = slots(), view = rendered(h.props, memory);
  const buttons = view.elements.filter(item => item.type === 'button' && text(item) === 'متابعة نفس العملية'); assert.equal(buttons.length, 3);
  assert.equal(buttons[2].props.disabled, true); buttons.forEach(button => button.props.onClick()); assert.deepEqual(h.calls, [['resume', records[0]], ['resume', records[1]]]);
  assert.match(h.html(), /60000000-0000-4000-8000-000000000090|2026-10-12T00:00:00.000Z|ليس ترتيب الأحدث عالميًا/);
  invoke(View, { ...h.props, state: state({ history: records.map(value => structuredClone(value)) }) }, memory); buttons[0].props.onClick(); assert.equal(h.calls.length, 2);
});

test('retry-required versus acknowledged read-only refresh have separate cancellation policies', () => {
  const h = viewProps({ state: state({ saveStatus: 'retry-required', pendingOperationId: OP }) });
  let view = rendered(h.props); view.button('إعادة التحقق').props.onClick(); view.button('التحقق من الإلغاء').props.onClick(); assert.deepEqual(h.calls, [['retry'], ['cancel-pending']]);
  h.props.state = state({ saveStatus: 'refresh-required', pendingOperationId: OP }); view = rendered(h.props);
  assert.match(h.html(), /الحفظ مؤكد — التحديث بالقراءة فقط/); assert.doesNotMatch(h.html(), /التحقق من الإلغاء/); view.button('إعادة التحقق').props.onClick(); assert.equal(h.calls.at(-1)?.[0], 'retry');
});

test('wrapper preview blocks direct reads/writes/IDs/files and still allows close', async () => {
  const h = harness(), memory = slots(); let closed = 0; const props = wrapper(h, memory, { previewOnly: true, onClose: () => closed++ }), raw = draft(); let generated = 0;
  props.onSection('labs'); props.onLoad(); props.onBegin(); props.onUpdate(settings(), raw); props.onSave(raw); props.onCancel(raw); props.onRetry(); props.onCancelPending();
  props.onHistory(false); props.onResume(intent('prepared')); props.onLabs(false); props.onSelectLab(LAB); props.onNewLab(); props.onReferences();
  props.onAddId(() => { generated++; return settings(); }, raw); props.onLogo({ type: 'image/png', size: 1 } as File, raw);
  await tick(); assert.deepEqual(h.calls, []); assert.equal(generated, 0); props.onClose(); assert.equal(closed, 1);
});

test('wrapper raw draft exists before edit, invalid save cannot use prior snapshot, and exact save passes normalized draft', async () => {
  const h = harness(), memory = slots(); let closes = 0; let props = wrapper(h, memory, { onClose: () => closes++ }); props.onBegin();
  props = wrapper(h, memory, { onClose: () => closes++ }); const raw = h.controller.getState().draft!;
  props.onUpdate({ ...settings(), identity: { ...settings().identity, clinicName: '' } }, raw); props = wrapper(h, memory, { onClose: () => closes++ });
  props.onSave(h.controller.getState().draft!); props.onClose(); assert.equal(closes, 0); assert.equal(h.calls.some(call => call[0] === 'save'), false);
  props.onUpdate(settings(), h.controller.getState().draft!); props = wrapper(h, memory); props.onSave(h.controller.getState().draft!); await tick();
  assert.equal(h.calls.at(-1)?.[0], 'save'); assert.equal(h.calls.at(-1)?.[1], h.controller.getState().draft);
});

test('retained wrapper callbacks cannot switch target after a draft starts, consume another ID or resume a replaced history entry', async () => {
  const h = harness(), memory = slots(), old = wrapper(h, memory); old.onBegin(); const raw = h.controller.getState().draft!;
  old.onSection('labs'); wrapper(h, memory); assert.equal(memory.states[0], 'identity');
  let used = 0; old.onAddId(value => { used++; return { ...settings(), medications: [{ medicationId: value, name: 'مصطنع', category: '', defaultDosage: '', defaultDuration: '', active: true }] }; }, raw);
  old.onAddId(() => { used++; return settings(); }, raw); assert.equal(used, 1); assert.equal(h.controller.getState().draft?.data && (h.controller.getState().draft!.data as any).medications.length, 1);
  const previous = intent('prepared'); h.replace({ draft: null, history: [structuredClone(previous)] }); old.onResume(previous); await tick(); assert.equal(h.calls.some(call => call[0] === 'resume'), false);
});

test('wrapper exact-draft logo async result is discarded after preview/controller revocation', async () => {
  const originalReader = (globalThis as any).FileReader, originalImage = (globalThis as any).Image;
  let reader: any, decoded = 0;
  (globalThis as any).FileReader = class { result = ''; onload!: () => void; onerror!: () => void; constructor() { reader = this; } readAsDataURL() {} };
  (globalThis as any).Image = class { naturalWidth = 1; naturalHeight = 1; src = ''; decode() { decoded++; return Promise.resolve(); } };
  try {
    const raw = draft('clinicLogo', null), h = harness(state({ loaded: true, selection: { target: 'clinicLogo', recordId: 'clinicLogo' }, draft: raw })), memory = slots();
    const props = wrapper(h, memory); props.onLogo({ type: 'image/png', size: 68 } as File, raw); assert.ok(reader);
    wrapper(h, memory, { previewOnly: true }); reader.result = `data:image/png;base64,${png().base64}`; reader.onload(); await tick();
    assert.equal(decoded, 0); assert.deepEqual(h.calls, []);
  } finally { (globalThis as any).FileReader = originalReader; (globalThis as any).Image = originalImage; }
});

test('settings responsive CSS uses bounded grids/touch targets and no logo mirroring or animation requirement', async () => {
  const css = await readFile('src/components/settings/CloudClinicSettingsWorkspace.css', 'utf8');
  assert.match(css, /repeat\(4,minmax\(0,1fr\)\)/); assert.match(css, /repeat\(2,minmax\(0,1fr\)\)/); assert.match(css, /max-width:520px/);
  assert.match(css, /min-height:46px/); assert.match(css, /font-size:16px/); assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(css, /\.csettings-logo\{[^}]*direction:ltr;transform:none/); assert.doesNotMatch(css, /scaleX\(-1\)|width:100vw|white-space:nowrap/);
});

test('temporary checking disables retained settings handlers without clearing an owned draft', () => {
  const h = harness(), memory = slots(); const old = wrapper(h, memory); wrapper(h, memory, { disabled: true });
  old.onLoad(); old.onBegin(); old.onHistory(false); old.onLabs(false); old.onReferences(); assert.deepEqual(h.calls, []);
  const current = wrapper(h, memory); current.onBegin(); assert.ok(h.controller.getState().draft);
  const drafted = wrapper(h, memory), before = h.calls.length; wrapper(h, memory, { disabled: true });
  drafted.onSave(drafted.state.draft!); drafted.onCancel(drafted.state.draft!); assert.equal(h.calls.length, before);
  assert.ok(h.controller.getState().draft); assert.equal(h.controller.getState().closed, false);
});
