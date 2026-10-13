import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import type { CloudProstheticWorkspaceController, CloudProstheticWorkspaceState, CloudProstheticWorkspaceDraft } from './cloudProstheticWorkspaceController';
import type { CloudProstheticWorkspaceProps } from '../components/labs/CloudProstheticWorkspace';

// Synthetic hooks and SSR only. This is not visual mobile/desktop, Firebase,
// real Auth, deployed Rules, two-device or provider-delivery acceptance.
const compiled = await build({ entryPoints: ['src/components/labs/CloudProstheticWorkspace.tsx'], bundle: true, write: false,
  metafile: true, platform: 'node', format: 'cjs', logLevel: 'silent', external: ['react', 'react-dom', 'lucide-react'], loader: { '.css': 'empty' } });
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { CloudProstheticWorkspace } = module.exports as typeof import('../components/labs/CloudProstheticWorkspace');
const id = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const LAB = id(901), SERVICE = id(902), WHEN = '2026-10-12T00:00:00.000Z';
const state = (changes: Partial<CloudProstheticWorkspaceState> = {}): CloudProstheticWorkspaceState => ({ labs: [], labsLoaded: false, labsCursor: null,
  selectedLab: null, month: null, ledger: null, loaded: false, loading: false, draft: null, saveStatus: 'idle', pendingOperationId: null,
  history: [], historyLoaded: false, historyCursor: null, historyLoading: false, error: '', notice: '', closed: false, ...changes });
function order(): CloudProstheticWorkspaceDraft { return { type: 'order', handle: 1, patientId: id(900), patientName: 'مريض اختبار مصطنع', fileNo: 451,
  choices: [{ serviceId: SERVICE, name: 'تركيبة مصطنعة', priceCents: 100_000, kind: 'fixed' }], serviceId: SERVICE, kind: 'fixed',
  units: '٣', unitPrice: '1000', paid: '', examinationCents: 10_000, includeExamination: false, teethIds: ['ur4', 'ur5', 'ur6'], date: '2026-10-12', deliveryDate: '', note: '' }; }
function lab(): any { return { schemaVersion: 1, clinicId: 'main', recordId: LAB, revision: 1, lastOperationId: id(999),
  data: { name: 'PRIVATE_LAB_NAME', phone: '', address: '', notes: '', active: true, costs: [{ materialId: id(903), name: 'PRIVATE_MATERIAL',
    category: 'fixed', unitLabel: 'كراون', billingBasis: 'per-unit', unitCostCents: 20_000, active: true }] } }; }
function ledger(): any { return { account: { labId: LAB, revision: 1 }, month: '2026-10', totalCostCents: 60_000, paidCostCents: 20_000, remainingCents: 40_000,
  monthPaidCents: 20_000, reservedForLabCents: 30_000, availableToClinicCents: 0, patientCollectedCents: 50_000, patientRemainingCents: 260_000,
  cases: [{ recordId: id(1), patientId: id(900), fileNo: 451, labId: LAB, status: 'ready', totalCostCents: 60_000, paidCostCents: 20_000,
    snapshot: { serviceName: 'تركيبة مصطنعة', units: 3, date: '2026-10-12' } }],
  caseFinancials: [{ caseId: id(1), fileNo: 451, patientName: 'مريض اختبار مصطنع', labRemainingCents: 40_000, reservedForLabCents: 30_000 }],
  payments: [{ receiptId: id(2), date: '2026-10-13', note: 'دفعة مصطنعة', amountCents: 20_000, allocations: [{ caseId: id(1), amountCents: 20_000 }] }] }; }
function history(status: 'prepared' | 'committed' | 'cancelled' = 'committed'): any { return { operationId: id(1), createdAt: WHEN, status }; }
type Element = { type: unknown; props: Record<string, any> };
const children = (node: any): any[] => node == null ? [] : Array.isArray(node) ? node.flatMap(children) : [node];
const all = (node: any): Element[] => children(node).flatMap(item => item && typeof item === 'object' && item.props ? [item, ...all(item.props.children)] : []);
const text = (node: any): string => children(node).map(item => typeof item === 'string' || typeof item === 'number' ? String(item) : item?.props ? text(item.props.children) : '').join('');
interface Slots { refs: { current: any }[]; states: any[] }
function invoke(props: CloudProstheticWorkspaceProps, slots: Slots) {
  const internals = (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE, before = internals.H;
  let r = 0, s = 0;
  internals.H = { useCallback: (fn: unknown) => fn, useRef: (value: unknown) => { const index = r++; return slots.refs[index] ?? (slots.refs[index] = { current: value }); },
    useState: (initial: unknown) => { const index = s++; if (!(index in slots.states)) slots.states[index] = initial;
      return [slots.states[index], (value: unknown) => { slots.states[index] = typeof value === 'function' ? (value as any)(slots.states[index]) : value; }]; },
    useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot() };
  try { return CloudProstheticWorkspace(props); } finally { internals.H = before; }
}
function harness(changes: Partial<CloudProstheticWorkspaceState> = {}) {
  let current = state(changes); const calls: any[][] = [], slots: Slots = { refs: [], states: [] };
  const controller: CloudProstheticWorkspaceController = { getState: () => current, subscribe: () => () => undefined,
    loadLabs: async more => { calls.push(['labs', more]); return true; }, openLab: async (...args) => { calls.push(['open', ...args]); return true; },
    beginOrder: async (...args) => { calls.push(['begin-order', ...args]); return true; }, selectService: (...args) => { calls.push(['service', ...args]); return true; },
    updateDraft: (...args) => { calls.push(['update', ...args]); return true; }, beginProgress: (...args) => { calls.push(['progress', ...args]); return true; },
    beginPayment: (...args) => { calls.push(['payment', ...args]); return true; }, saveDraft: async (...args) => { calls.push(['save', ...args]); return true; },
    cancelDraft: (...args) => { calls.push(['cancel-draft', ...args]); return true; }, retry: async (...args) => { calls.push(['retry', ...args]); return true; },
    cancelPending: async (...args) => { calls.push(['cancel-pending', ...args]); return true; }, loadHistory: async (...args) => { calls.push(['history', ...args]); return true; },
    resume: async (...args) => { calls.push(['resume', ...args]); return true; }, refresh: async () => { calls.push(['refresh']); return true; },
    canClose: () => !current.closed && !current.draft && !current.loading && !current.historyLoading && current.saveStatus === 'idle' && !current.pendingOperationId,
    dispose: () => { current = state({ closed: true }); } };
  const props: CloudProstheticWorkspaceProps = { controller, onClose: () => calls.push(['close']), onChoosePatient: () => calls.push(['patient-selector']) };
  const render = (patch: Partial<CloudProstheticWorkspaceProps> = {}) => { const tree = invoke({ ...props, ...patch }, slots), elements = all(tree);
    return { tree, elements, content: text(tree), button(label: string) { const item = elements.find(row => row.type === 'button' && text(row) === label); assert.ok(item, label); return item; } }; };
  return { calls, controller, props, render, html: (patch: Partial<CloudProstheticWorkspaceProps> = {}) => renderToStaticMarkup(React.createElement(CloudProstheticWorkspace, { ...props, ...patch })),
    replace: (patch: Partial<CloudProstheticWorkspaceState>) => { current = { ...current, ...patch }; } };
}
test('prosthetic UI renders unloaded without data requests, SDK, defaults or fake financial zeroes', () => {
  const h = harness(), html = h.html(); assert.deepEqual(h.calls, []); assert.match(html, /تحميل المعامل|لا نعرض رصيدًا افتراضيًا/);
  assert.doesNotMatch(html, /PRIVATE_|مصطنع|وصل للمعمل إجمالًا|<form|<nav/);
});
test('preview masks accidentally supplied lab cost, patient, draft, history, error and pending operation; all actions inert', () => {
  const h = harness({ labs: [lab()], selectedLab: lab(), ledger: ledger(), draft: order(), history: [history()], error: 'PRIVATE_ERROR', notice: 'PRIVATE_NOTICE',
    saveStatus: 'retry-required', pendingOperationId: id(1), month: '2026-10' });
  const html = h.html({ previewOnly: true }); assert.doesNotMatch(html, /PRIVATE_|مصطنع|30000000|451|2026-10|<form/); assert.match(html, /معاينة تصميم فارغة/);
  const view = h.render({ previewOnly: true }); for (const button of view.elements.filter(item => item.type === 'button' && text(item) !== 'إلغاء وإغلاق')) { assert.equal(button.props.disabled, true); button.props.onClick?.(); }
  view.button('إلغاء وإغلاق').props.onClick(); assert.deepEqual(h.calls, [['close']]);
});
test('closed workspace masks retained patient/lab records even without preview flag', () => {
  const h = harness({ closed: true, labs: [lab()], selectedLab: lab(), ledger: ledger(), draft: order(), history: [history()] });
  assert.doesNotMatch(h.html(), /PRIVATE_|مصطنع|30000000|451|<form/);
});
test('order editor displays patient selling prices/exam/teeth only, not supplier identity or private costs', () => {
  const h = harness({ labs: [lab()], selectedLab: lab(), ledger: ledger(), draft: order(), loaded: true });
  const html = h.html(); assert.match(html, /مريض اختبار مصطنع|سعر الوحدة للمريض|المحصّل الآن|خريطة اختيار الأسنان|تسجيل الكشف|٣٬٠٠٠/);
  assert.doesNotMatch(html, /PRIVATE_|وصل للمعمل|تكلفة المعمل|استرجاع العمليات|دفعة مجمّعة/);
  const view = h.render(); assert.equal(view.button('إلغاء وإغلاق').props.disabled, true);
  const board = view.elements.find(item => typeof item.type === 'function' && (item.type as any).name === 'ToothSelectionGrid'); assert.ok(board); board.props.onChange(['ur4']);
  assert.deepEqual(h.calls.at(-1), ['update', 1, { teethIds: ['ur4'] }]);
});
test('service selection updates draft immediately; save is explicit and no extra append confirmation exists', () => {
  const h = harness({ draft: order() }), view = h.render(); const choice = view.elements.find(item => item.type === 'button' && item.props['aria-pressed'] === true)!;
  choice.props.onClick(); assert.deepEqual(h.calls, [['service', 1, SERVICE]]); assert.doesNotMatch(view.content, /إضافة الخدمة للمسودة/);
  const form = view.elements.find(item => item.type === 'form')!; form.props.onSubmit({ preventDefault() {} }); assert.deepEqual(h.calls.at(-1), ['save', 1]);
});
test('stale editor callbacks cannot edit/save/cancel a replacement draft, preview or controller', () => {
  const h = harness({ draft: order() }), old = h.render(), form = old.elements.find(item => item.type === 'form')!, input = old.elements.find(item => item.type === 'input' && item.props.inputMode === 'decimal')!;
  h.replace({ draft: { ...order(), handle: 2 } }); input.props.onChange({ target: { value: '900' } }); form.props.onSubmit({ preventDefault() {} }); old.button('إلغاء المسودة').props.onClick(); assert.deepEqual(h.calls, []);
  h.replace({ draft: order() }); const second = h.render(); h.render({ previewOnly: true }); second.button('إلغاء المسودة').props.onClick(); assert.deepEqual(h.calls, []);
  h.render(); const retained = h.render(), other = harness(); h.render({ controller: other.controller }); retained.button('إلغاء المسودة').props.onClick(); assert.deepEqual(h.calls, []);
});
test('retained loaded row and history callbacks recheck fresh controller locks', () => {
  const h = harness({ labs: [lab()], selectedLab: lab(), ledger: ledger(), history: [history()], loaded: true, month: '2026-10' }), view = h.render();
  h.replace({ loading: true }); view.button('دفع للمعمل').props.onClick(); view.button('تحديث الحالة').props.onClick(); view.button('تحقق من نفس العملية').props.onClick(); view.button('إلغاء وإغلاق').props.onClick();
  assert.deepEqual(h.calls, []); h.replace({ loading: false, draft: order() }); view.button('تحميل المعامل').props.onClick(); assert.deepEqual(h.calls, []);
});
test('retained lab/ledger rows cannot act on replacement snapshots even when the same IDs remain', () => {
  const h = harness({ labs: [lab()], selectedLab: lab(), ledger: ledger(), loaded: true, month: '2026-10' }), view = h.render();
  const labButton = view.elements.find(item => item.type === 'button' && text(item).includes('PRIVATE_LAB_NAME'))!;
  h.replace({ labs: [lab()], selectedLab: lab(), ledger: ledger() });
  labButton.props.onClick(); view.button('دفع للمعمل').props.onClick(); view.button('تحديث الحالة').props.onClick(); view.button('دفعة مجمّعة').props.onClick(); view.button('تحديث الحساب').props.onClick();
  assert.deepEqual(h.calls, []);
});
test('private ledger labels lifetime/month, reserved/available and per-case dated allocation history', () => {
  const h = harness({ labs: [lab()], selectedLab: lab(), ledger: ledger(), loaded: true, month: '2026-10' }), html = h.html();
  assert.match(html, /وصل للمعمل إجمالًا|وصل هذا الشهر|محجوز للمعمل|ليس صافي الربح|تاريخ دفعات هذه الحالة|2026-10-13|دفعة مصطنعة/);
  const view = h.render(); view.button('دفع للمعمل').props.onClick(); view.button('تحديث الحالة').props.onClick(); assert.deepEqual(h.calls, [['payment', id(1)], ['progress', id(1)]]);
});
test('retry and cancellation are bound to displayed original operation and ACK refresh is clearly read-only', () => {
  const h = harness({ saveStatus: 'refresh-required', pendingOperationId: id(1) }), view = h.render(); assert.match(view.content, /تقرأ السجل فقط/);
  view.button('إعادة التحقق بالقراءة').props.onClick(); assert.deepEqual(h.calls, [['retry', id(1)]]);
  h.replace({ pendingOperationId: id(2) }); view.button('إعادة التحقق بالقراءة').props.onClick(); assert.equal(h.calls.length, 1);
  const retry = harness({ saveStatus: 'retry-required', pendingOperationId: id(1) }), pending = retry.render(); pending.button('التحقق من إلغاء العملية').props.onClick();
  assert.deepEqual(retry.calls, [['cancel-pending', id(1)]]);
});
test('all-status recovery renders committed/cancelled entries and never silently offers cancelled replay', () => {
  const cancelled = { ...history('cancelled'), operationId: id(2) }, h = harness({ history: [history('committed'), cancelled], historyLoaded: true });
  const view = h.render(); assert.match(view.content, /ملتزمة|ملغاة|الترتيب بالمعرّف/);
  const buttons = view.elements.filter(item => item.type === 'button' && text(item) === 'تحقق من نفس العملية'); assert.equal(buttons[0].props.disabled, false); assert.equal(buttons[1].props.disabled, true);
  buttons[0].props.onClick(); assert.deepEqual(h.calls, [['resume', id(1)]]); h.replace({ history: [] }); buttons[0].props.onClick(); assert.equal(h.calls.length, 1);
});
test('disabled/checking prop preserves editor content but blocks retained actions; loading renders no fake success', () => {
  const h = harness({ draft: order() }), old = h.render(); const next = h.render({ disabled: true }); assert.match(next.content, /مريض اختبار/);
  old.button('إلغاء المسودة').props.onClick(); old.elements.find(item => item.type === 'form')!.props.onSubmit({ preventDefault() {} }); assert.deepEqual(h.calls, []);
});
test('responsive source uses shared teeth/examination and no local records, Auth SDK, animation loop or horizontal carousel', async () => {
  const source = await readFile('src/components/labs/CloudProstheticWorkspace.tsx', 'utf8'), css = await readFile('src/components/labs/CloudProstheticWorkspace.css', 'utf8');
  assert.match(source, /ToothSelectionGrid|ExaminationFeeToggle/); assert.match(css, /min-height:44px|@media\(max-width:640px\)/);
  assert.doesNotMatch(source, /localStorage|Storage\.get|FirebaseAuth|setInterval|requestAnimationFrame/); assert.doesNotMatch(css, /overflow-x:\s*(auto|scroll)|animation:/);
  assert.ok(!Object.keys(compiled.metafile!.inputs).some(file => /firebaseCloud|firebase[/\\](auth|firestore)|utils[/\\](Storage|auth)/.test(file)));
});
