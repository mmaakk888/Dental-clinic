import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { createCloudTransferWorkspaceController, type CloudTransferWorkspaceState } from './cloudTransferWorkspaceController';
import type { CloudTransferPreview } from './cloudTransferProjection';
const compiled = await build({ entryPoints: ['src/components/settings/CloudTransferWorkspace.tsx'], bundle: true, write: false, platform: 'node', format: 'cjs',
  logLevel: 'silent', external: ['react', 'react-dom', 'lucide-react'], loader: { '.css': 'empty' } });
const module = { exports: {} as any }; new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { CloudTransferWorkspace: View } = module.exports as typeof import('../components/settings/CloudTransferWorkspace');
const OP = '20000000-0000-4000-8000-000000000001';
const preview = (): CloudTransferPreview => ({ kind: 'patients', readTime: '2026-10-13T00:00:00.000Z', readyCount: 1, duplicateCount: 0, invalidCount: 0,
  rows: [{ rowNumber: 2, name: 'اسم خاص مصطنع', mobile: '01000000001', fileNo: 450, status: 'ready', message: 'ملف جديد', matchingFiles: [{ fileNo: 42, name: 'اسم مطابق مصطنع', reason: 'phone' }],
    matchingFileCount: 5, contact: null, profile: { name: 'اسم خاص مصطنع', mobile: '01000000001', age: 30, gender: '', firstVisit: '', notes: '', allergy: '' } }] });
const empty = (): CloudTransferWorkspaceState => ({ preview: null, pending: null, results: [], loading: false, running: false, saveStatus: 'idle', stopped: false, error: '', notice: '', closed: false });
function fake(initial: CloudTransferWorkspaceState = empty()) {
  let state = initial; const calls: string[] = [];
  const controller: any = { getState: () => state, subscribe: () => () => undefined, canClose: () => true,
    readFile: () => { calls.push('file'); }, confirm: () => { calls.push('confirm'); }, retry: () => { calls.push('retry'); }, cancelPending: () => { calls.push('cancel'); },
    resume: () => { calls.push('resume'); }, discardPreview: () => { calls.push('discard'); }, stopAfterCurrent: () => { calls.push('stop'); } };
  return { controller, calls, set: (value: CloudTransferWorkspaceState) => { state = value; } };
}
type Element = { type: unknown; props: Record<string, any> };
const all = (node: any): Element[] => node == null ? [] : Array.isArray(node) ? node.flatMap(all) : node?.props ? [node, ...all(node.props.children)] : [];
const content = (node: any): string => node == null ? '' : Array.isArray(node) ? node.map(content).join('') : typeof node === 'string' || typeof node === 'number' ? String(node) : node?.props ? content(node.props.children) : '';
function invoke(props: Parameters<typeof View>[0], refs: Array<{ current: any }> = []) {
  const internals = (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE, previous = internals.H; let refIndex = 0;
  internals.H = { useId: () => 'synthetic-transfer', useRef: (value: unknown) => refs[refIndex] ?? (refs[refIndex++] = { current: value }),
    useState: (initial: unknown) => [typeof initial === 'function' ? (initial as () => unknown)() : initial, () => undefined],
    useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot() };
  try { return View(props); } finally { internals.H = previous; }
}
const button = (tree: any, label: string) => { const found = all(tree).find(item => item.type === 'button' && content(item) === label); assert.ok(found, `Missing ${label}`); return found; };
test('transfer UI mounts unloaded and does not call file/snapshot/data capabilities', () => {
  const calls: string[] = [], controller = createCloudTransferWorkspaceController({ ownerUid: 'synthetic-owner', isActive: () => true,
    getPatients: async () => { calls.push('patients'); throw new Error(); }, getContacts: async () => { calls.push('contacts'); throw new Error(); }, getSnapshot: async () => { calls.push('snapshot'); throw new Error(); } });
  const html = renderToStaticMarkup(React.createElement(View, { controller })); assert.deepEqual(calls, []);
  assert.match(html, /استيراد الملفات والأرقام/); assert.match(html, /ليست|كل صف كعملية مستقلة/); assert.doesNotMatch(html, /اسم خاص|01000000001|تم الحفظ|حُفظت/);
});
test('preview-only UI masks mistakenly supplied private rows/operation/notices and all data actions remain inert', () => {
  const h = fake({ ...empty(), preview: preview(), pending: { kind: 'patients', rowNumber: 2, operationId: OP, fileNo: 450 }, error: 'PRIVATE_ERROR', notice: 'PRIVATE_NOTICE' });
  const props = { controller: h.controller, previewOnly: true }, html = renderToStaticMarkup(React.createElement(View, props)), tree = invoke(props);
  assert.doesNotMatch(html, /اسم خاص|01000000001|PRIVATE_|20000000|450/);
  for (const item of all(tree)) {
    if (item.type === 'button') item.props.onClick?.();
    if (item.type === 'input' && item.props.type === 'file') item.props.onChange({ target: { files: [{ name: 'test.csv' }], value: '' } });
  }
  assert.deepEqual(h.calls, []);
});
test('preview lists fileNo and exact match count with explicit sampled warning, no financial totals', () => {
  const h = fake({ ...empty(), preview: preview() }); const html = renderToStaticMarkup(React.createElement(View, { controller: h.controller }));
  assert.match(html, /ملف #450/); assert.match(html, /#42/); assert.match(html, /مطابقات مع 5 ملف/); assert.match(html, /نعرض أول 1 مطابقة فقط/);
  assert.doesNotMatch(html, /المتبقي|المدفوع|إجمالي الديون/);
});
test('retained confirmation/file/discard buttons cannot act on a replaced preview or disabled controller', () => {
  const first = preview(), h = fake({ ...empty(), preview: first }), refs: Array<{ current: any }> = [];
  const tree = invoke({ controller: h.controller }, refs), confirm = button(tree, 'تأكيد استيراد الصفوف الصالحة'), discard = button(tree, 'إغلاق الملف دون مسح ما حُفظ');
  h.set({ ...empty(), preview: preview() }); confirm.props.onClick(); discard.props.onClick();
  const file = all(tree).find(item => item.type === 'input' && item.props.type === 'file')!; file.props.onChange({ target: { files: [{ name: 'test.csv' }], value: '' } }); assert.deepEqual(h.calls, []);
  h.set({ ...empty(), preview: first }); invoke({ controller: h.controller, disabled: true }, refs); confirm.props.onClick(); discard.props.onClick(); assert.deepEqual(h.calls, []);
});
test('retained pending retry/cancel callbacks require exact original pending object', () => {
  const pending = { kind: 'patients' as const, rowNumber: 2, operationId: OP, fileNo: 450 }, h = fake({ ...empty(), pending, saveStatus: 'retry-required' });
  const tree = invoke({ controller: h.controller }), retry = button(tree, 'إعادة التحقق بنفس العملية'), cancel = button(tree, 'إلغاء هذا الصف بعد تأكيد الخادم');
  h.set({ ...empty(), pending: { ...pending } }); retry.props.onClick(); cancel.props.onClick(); assert.deepEqual(h.calls, []);
  h.set({ ...empty(), pending, saveStatus: 'retry-required' }); retry.props.onClick(); assert.deepEqual(h.calls, ['retry']);
});
test('lost ACK UI shows a copyable exact operation ID and refuses second file/confirm while pending', () => {
  const h = fake({ ...empty(), preview: preview(), pending: { kind: 'patients', rowNumber: 2, operationId: OP, fileNo: 450 }, saveStatus: 'retry-required' });
  const tree = invoke({ controller: h.controller }), html = renderToStaticMarkup(React.createElement(View, { controller: h.controller })); assert.match(html, new RegExp(OP)); assert.match(html, /لا تبدأ عملية بديلة/);
  assert.equal(button(tree, 'تأكيد استيراد الصفوف الصالحة').props.disabled, true); assert.equal(all(tree).find(item => item.type === 'input' && item.props.type === 'file')!.props.disabled, true);
});
test('transfer CSS provides one stacked column, 44px touch controls,16px inputs, no horizontal scrollbar animation', async () => {
  const css = await readFile('src/components/settings/CloudTransferWorkspace.css', 'utf8'); assert.match(css, /min-height:44px/); assert.match(css, /font-size:16px/);
  assert.match(css, /max-width:600px/); assert.match(css, /prefers-reduced-motion/); assert.doesNotMatch(css, /overflow-x:\s*(auto|scroll)|animation:\s*infinite/);
});
