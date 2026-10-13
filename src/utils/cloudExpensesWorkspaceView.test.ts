import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import type { CloudExpenseWorkspaceController, CloudExpenseWorkspaceState, CloudExpenseWorkspaceDraft } from './cloudExpenseWorkspaceController';
import type { CloudExpensesWorkspaceProps } from '../components/summary/CloudExpensesWorkspace';

// Fabricated SSR/hooks only, not visual iPhone/desktop, actual Firebase/Auth,
// native compression/AI/provider, deployed Rules or two-device acceptance.
const compiled = await build({ entryPoints: ['src/components/summary/CloudExpensesWorkspace.tsx'], bundle: true, write: false,
  metafile: true, platform: 'node', format: 'cjs', logLevel: 'silent', external: ['react', 'react-dom', 'lucide-react'], loader: { '.css': 'empty' } });
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { CloudExpensesWorkspace } = module.exports as typeof import('../components/summary/CloudExpensesWorkspace');
const id = (n: number) => `60000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const state = (changes: Partial<CloudExpenseWorkspaceState> = {}): CloudExpenseWorkspaceState => ({ snapshot: null, loaded: false, loading: false, draft: null,
  saveStatus: 'idle', pendingOperationId: null, error: '', notice: '', closed: false, history: [], historyLoaded: false, historyLoading: false, historyNextAfterId: null,
  image: null, imageLoading: false, imageError: '', imageBytesReady: false, requiresImageBytes: false, ...changes });
function createDraft(): CloudExpenseWorkspaceDraft { return { action: 'create', header: { title: 'فاتورة مصطنعة', category: 'supplies', expenseType: 'supplies',
  date: '2026-10-12', note: '', isFixed: false, recurringPeriod: 'none', supplierName: 'مورد مصطنع', supplierPhone: '', supplierAddress: '',
  invoiceNumber: '', invoiceDate: '2026-10-12', invoiceTime: '', taxNumber: '', commercialRecord: '', currency: 'EGP' }, subtotal: '100', tax: '0', discount: '0', paid: '',
  items: [{ key: 1, name: 'قفازات مصطنعة', unit: 'علبة', quantity: '2', unitPrice: '50', discount: '0', tax: '0' }] }; }
function snapshot(): any {
  const expense = { recordId: id(1), revision: 1, paidCents: 2500, imageId: id(4), data: { title: 'فاتورة مصطنعة', supplierName: 'مورد مصطنع', expenseType: 'supplies',
    totalCents: 10_000, date: '2026-10-12', items: [{ itemId: id(9), name: 'قفازات مصطنعة', quantityMilli: 2000, unit: 'علبة', totalCents: 10_000 }] } };
  const material = { recordId: 'a'.repeat(64), revision: 1, name: 'قفازات مصطنعة', unit: 'علبة', purchasedMilli: 2000, usedMilli: 500, wasteMilli: 0,
    purchaseCostCents: 10_000, consumedCostCents: 2500 };
  return { expenses: [expense], expensesLoaded: true, expenseCursor: null, materials: [material], materialsLoaded: true, materialCursor: null,
    selection: { kind: 'expense', record: expense, payments: [{ recordId: id(2), amountCents: 2500, date: '2026-10-13', note: 'دفعة مصطنعة' }] } };
}
type Element = { type: unknown; props: Record<string, any> };
const children = (node: any): any[] => node == null ? [] : Array.isArray(node) ? node.flatMap(children) : [node];
const all = (node: any): Element[] => children(node).flatMap(item => item && typeof item === 'object' && item.props ? [item, ...all(item.props.children)] : []);
const text = (node: any): string => children(node).map(item => typeof item === 'string' || typeof item === 'number' ? String(item) : item?.props ? text(item.props.children) : '').join('');
function harness(changes: Partial<CloudExpenseWorkspaceState> = {}) {
  let value = state(changes); const calls: any[][] = [], refs: { current: any }[] = [];
  const concrete = { getState: () => value, subscribe: () => () => undefined,
    canClose: () => !value.closed && !value.draft && !value.loading && !value.historyLoading && !value.imageLoading && !value.pendingOperationId && value.saveStatus === 'idle' };
  const controller = new Proxy(concrete, { get(target, key) { if (key in target) return target[key as keyof typeof target]; return (...args: unknown[]) => { calls.push([key, ...args]); return true; }; } }) as unknown as CloudExpenseWorkspaceController;
  const props: CloudExpensesWorkspaceProps = { controller, onClose: () => calls.push(['close']) };
  function render(patch: Partial<CloudExpensesWorkspaceProps> = {}) {
    const internals = (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE, before = internals.H; let index = 0;
    internals.H = { useCallback: (fn: unknown) => fn, useRef: (initial: unknown) => { const slot = index++; return refs[slot] ?? (refs[slot] = { current: initial }); },
      useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot() };
    let tree: any; try { tree = CloudExpensesWorkspace({ ...props, ...patch }); } finally { internals.H = before; }
    const elements = all(tree); return { tree, elements, content: text(tree), button(label: string) {
      const element = elements.find(item => item.type === 'button' && text(item) === label); assert.ok(element, label); return element; } };
  }
  return { props, controller, calls, render, replace: (patch: Partial<CloudExpenseWorkspaceState>) => { value = { ...value, ...patch }; },
    html: (patch: Partial<CloudExpensesWorkspaceProps> = {}) => renderToStaticMarkup(React.createElement(CloudExpensesWorkspace, { ...props, ...patch })) };
}
test('expense UI mount is inert with no fake list totals, defaults or seeded data', () => {
  const h = harness(), html = h.html(); assert.deepEqual(h.calls, []); assert.match(html, /تحميل المصروفات|ليست الأحدث أو إجمالي الشهر/);
  assert.doesNotMatch(html, /مصطنع|60000000|<form|قيمة الفاتورة<\/span>/);
});
test('preview and closed modes hide supplied invoices, names, cash, draft, image bytes, recovery, errors and actions', () => {
  const h = harness({ snapshot: snapshot(), loaded: true, draft: createDraft(), history: [{ operationId: id(8), createdAt: '2026-10-12T00:00:00.000Z', status: 'committed' } as any],
    error: 'PRIVATE_ERROR', imageError: 'PRIVATE_IMAGE_ERROR', notice: 'PRIVATE_NOTICE', image: { base64: 'PRIVATE_IMAGE_BYTES' } as any });
  assert.doesNotMatch(h.html({ previewOnly: true }), /PRIVATE_|مصطنع|60000000|<form|<img/); assert.match(h.html({ previewOnly: true }), /معاينة فارغة/);
  const view = h.render({ previewOnly: true }); for (const button of view.elements.filter(item => item.type === 'button' && text(item) !== 'إلغاء وإغلاق')) { assert.equal(button.props.disabled, true); button.props.onClick?.(); }
  view.button('إلغاء وإغلاق').props.onClick(); assert.deepEqual(h.calls, [['close']]); h.replace({ closed: true }); assert.doesNotMatch(h.html(), /PRIVATE_|مصطنع|60000000|<form|<img/);
});
test('manual invoice editor preserves blank paid value, items and adjustable totals without pretending OCR is enabled', () => {
  const h = harness({ loaded: true, snapshot: snapshot(), draft: createDraft() }), html = h.html();
  assert.match(html, /ما دفعته فعلًا|الاستخراج الآلي غير مُهيّأ|أصناف|مصروف ثابت|راتب السكرتيرة|الكهرباء|المياه|الإيجار/);
  const view = h.render(); assert.equal(view.button('إلغاء وإغلاق').props.disabled, true);
  const paid = view.elements.find(item => item.type === 'input' && item.props.placeholder === 'اكتب ٠ إن لم تدفع')!; assert.equal(paid.props.value, '');
  paid.props.onChange({ target: { value: '0' } }); assert.equal(h.calls[0][0], 'updateDraft'); assert.equal(h.calls[0][1].paid, '0');
  view.button('إضافة صنف').props.onClick(); assert.equal(h.calls.at(-1)![0], 'addItem');
});
test('stale editor/save/item callbacks cannot affect replacement drafts, preview, disabled state or another controller', () => {
  const h = harness({ loaded: true, snapshot: snapshot(), draft: createDraft() }), view = h.render(), form = view.elements.find(item => item.type === 'form')!;
  h.replace({ draft: createDraft() }); view.button('إلغاء المسودة').props.onClick(); view.button('إضافة صنف').props.onClick(); form.props.onSubmit({ preventDefault() {} }); assert.deepEqual(h.calls, []);
  const next = h.render(); h.render({ disabled: true }); next.button('إلغاء المسودة').props.onClick(); assert.deepEqual(h.calls, []);
  h.render(); const old = h.render(), other = harness(); h.render({ controller: other.controller }); old.button('إلغاء المسودة').props.onClick(); assert.deepEqual(h.calls, []);
});
test('selected invoice displays full dated actual cash history, remaining and on-demand image action', () => {
  const h = harness({ loaded: true, snapshot: snapshot() }), html = h.html(); assert.match(html, /المدفوع فعلًا|المتبقي|تاريخ الدفعات — كامل ومؤكد|2026-10-13|دفعة مصطنعة/);
  assert.doesNotMatch(html, /<img/); const view = h.render(); view.button('تسجيل دفعة').props.onClick(); view.button('عرض صورة الفاتورة').props.onClick(); assert.equal(h.calls[0][0], 'beginPayment'); assert.equal(h.calls[1][0], 'loadImage');
});
test('selected material renders complete usage history and precise quantities without claiming clinic-wide totals', () => {
  const value = snapshot(); value.selection = { kind: 'material', record: value.materials[0], usages: [{ recordId: id(7), date: '2026-10-14', kind: 'used', quantityMilli: 500, costCents: 2500, note: 'مصطنع' }] };
  const h = harness({ loaded: true, snapshot: value }), html = h.html(); assert.match(html, /حركات الاستهلاك والهالك — كاملة ومؤكدة|تكلفة المستهلك والهالك|2026-10-14/);
  h.render().button('استهلاك أو هالك').props.onClick(); assert.equal(h.calls[0][0], 'beginUsage');
});
test('old expense/material rows and selected actions cannot act after replacement snapshot or loading transition', () => {
  const h = harness({ loaded: true, snapshot: snapshot() }), view = h.render(); h.replace({ snapshot: snapshot() });
  const rows = view.elements.filter(item => item.type === 'button' && item.props.className === 'cexp-row'); rows.forEach(row => row.props.onClick()); view.button('تسجيل دفعة').props.onClick(); view.button('تعديل الوصف').props.onClick(); assert.deepEqual(h.calls, []);
  h.replace({ loading: true }); view.button('تحميل المصروفات').props.onClick(); view.button('إلغاء وإغلاق').props.onClick(); assert.deepEqual(h.calls, []);
});
test('ACK-refresh and uncertain retry use retained pending identity; replacement operation blocks old callbacks', () => {
  const h = harness({ saveStatus: 'refresh-required', pendingOperationId: id(3) }), view = h.render(); assert.match(view.content, /قراءة فقط/);
  view.button('إعادة التحقق بالقراءة').props.onClick(); assert.deepEqual(h.calls, [['retry']]); h.replace({ pendingOperationId: id(4) }); view.button('إعادة التحقق بالقراءة').props.onClick(); assert.equal(h.calls.length, 1);
});
test('prepared image recovery requires matching compressed JPEG and disables commit retry until supplied', () => {
  const h = harness({ saveStatus: 'retry-required', pendingOperationId: id(3), requiresImageBytes: true }), html = h.html(); assert.match(html, /نفس JPEG المضغوط|لا يُعاد ضغطه/);
  assert.equal(h.render().button('إعادة نفس المحاولة').props.disabled, true);
});
test('all-status history renders committed/cancelled and exact retained history object guards stale resume', () => {
  const row = { operationId: id(3), status: 'committed', createdAt: '2026-10-12T00:00:00.000Z' } as any;
  const h = harness({ history: [row, { ...row, operationId: id(4), status: 'cancelled' }] }), view = h.render(); assert.match(view.content, /ملتزمة|ملغاة|بترتيب المعرّف لا الأحدث/);
  const buttons = view.elements.filter(item => item.type === 'button' && text(item) === 'التحقق من نفس العملية'); assert.equal(buttons[1].props.disabled, true);
  buttons[0].props.onClick(); assert.equal(h.calls[0][0], 'resume'); h.replace({ history: [] }); buttons[0].props.onClick(); assert.equal(h.calls.length, 1);
});
test('mobile/desktop source reuses bounded compression, no local OCR/Storage/Auth/default provider and no scrolling carousel', async () => {
  const source = await readFile('src/components/summary/CloudExpensesWorkspace.tsx', 'utf8'), css = await readFile('src/components/summary/CloudExpensesWorkspace.css', 'utf8');
  assert.match(source, /import\('\.\.\/\.\.\/utils\/invoiceImageCompression'\)|prepareImage|provideRecoveryImage/); assert.match(css, /min-height:44px|@media\(max-width:640px\)/);
  assert.doesNotMatch(source, /localStorage|Storage\.get|AiService|InvoiceOcrModal|setInterval|requestAnimationFrame/); assert.doesNotMatch(css, /overflow-x:\s*(auto|scroll)|animation:/);
  assert.ok(!Object.keys(compiled.metafile!.inputs).some(file => /firebaseCloud|services[/\\]aiService|utils[/\\]Storage/.test(file)));
});
