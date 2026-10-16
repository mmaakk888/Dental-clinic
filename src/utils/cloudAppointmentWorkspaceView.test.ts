import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import type { CloudAppointmentsWorkspaceProps } from '../components/appointments/CloudAppointmentsWorkspace';

const compiled = await build({ entryPoints: ['src/components/appointments/CloudAppointmentsWorkspace.tsx'], bundle: true, write: false,
  platform: 'node', format: 'cjs', logLevel: 'silent', external: ['react', 'lucide-react'] });
const require = createRequire(import.meta.url), ID = '90000000-0000-4000-8000-000000000001';
const all = (node: any): any[] => Array.isArray(node) ? node.flatMap(all) : node && typeof node === 'object' && node.props ? [node, ...all(node.props.children)] : [];
const text = (node: any): string => Array.isArray(node) ? node.map(text).join('') : typeof node === 'string' || typeof node === 'number' ? String(node) : node?.props ? text(node.props.children) : '';
function harness(draft = false, pending = false) {
  let cursor = 0; const refs: any[] = [], cleanups: (() => void)[] = [], calls: string[] = [], effects: (() => undefined | (() => void))[] = [];
  const hooks = { ...React, useRef: (value: unknown) => refs[cursor++] ??= { current: value },
    useState: (value: unknown) => [value, () => { calls.push('query'); }],
    useEffect: (work: () => undefined | (() => void)) => { effects.push(work); const cleanup = work(); if (cleanup) cleanups.push(cleanup); },
    useSyncExternalStore: (_subscribe: unknown, get: () => unknown) => get() };
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', compiled.outputFiles[0].text)((name: string) => name === 'react' ? hooks : require(name), module, module.exports);
  const data = { patientRecordId: null, patientName: 'موعد مصطنع', phone: '201000000001', date: '2026-10-14', time: '10:00', durationMinutes: 30,
    status: 'scheduled', reason: '', notes: '', doctorName: '', appointmentType: '', isFollowUp: false, isWalkIn: false };
  const record = { schemaVersion: 1, clinicId: 'main', recordId: ID, revision: 1, lastOperationId: ID, data };
  let state: any = { snapshot: { date: data.date, revision: 1, index: null, records: [record] }, loaded: true, loading: false, historyLoading: false,
    draft: draft ? { recordId: ID, expectedRevision: 1, data: { ...data, durationMinutes: '30' } } : null,
    saveStatus: pending ? 'retry-required' : 'idle', pendingOperationId: pending ? ID : null, error: '', notice: '', closed: false,
    history: [{ operationId: ID, createdAt: '2026-10-14T00:00:00.000Z', status: 'prepared' }], historyNextAfterId: ID };
  const action = (name: string) => (..._args: unknown[]) => { calls.push(name); return true; };
  const controller = { getState: () => state, subscribe: () => () => {}, getSelectedDate: () => data.date,
    canClose: () => !state.closed && !state.loading && !state.historyLoading && !state.draft && !state.pendingOperationId,
    refresh: action('refresh'), selectDate: action('date'), beginNew: action('new'), beginEdit: action('edit'), updateDraft: action('update'),
    save: action('save'), cancelDraft: action('cancel'), retry: action('retry'), cancelPending: action('cancel-pending'),
    loadHistory: action('history'), loadMoreHistory: action('more'), resume: action('resume') } as unknown as CloudAppointmentsWorkspaceProps['controller'];
  let props: CloudAppointmentsWorkspaceProps = { controller, onClose: () => { calls.push('close'); } };
  const render = (patch: Partial<CloudAppointmentsWorkspaceProps> = {}) => { props = { ...props, ...patch }; cursor = 0; return module.exports.default(props); };
  return { controller, calls, render, state: () => state, patch: (patch: object) => { state = { ...state, ...patch }; },
    unmount: () => cleanups.forEach(work => work()), strictReplay: () => { cleanups.forEach(work => work()); effects.forEach(work => work()); } };
}
test('appointment view is inert and exposes only its explicit day manual phone/WhatsApp links', () => {
  const h = harness(), nodes = all(h.render()); assert.deepEqual(h.calls, []);
  assert.deepEqual(nodes.filter(row => row.type === 'a').map(row => row.props.href), ['tel:+201000000001', 'https://wa.me/201000000001']);
  nodes.find(row => row.type === 'button' && text(row) === 'تحديث').props.onClick(); assert.deepEqual(h.calls, ['refresh']);
});
test('checking removes native hrefs and every retained appointment handler respects latest disabled props', () => {
  const h = harness(), before = all(h.render()), during = all(h.render({ disabled: true }));
  assert.equal(during.filter(row => row.type === 'a').length, 0);
  for (const node of before.filter(row => row.type === 'button')) node.props.onClick?.();
  for (const node of before.filter(row => row.type === 'input')) node.props.onChange?.({ target: { value: '2026-10-15' } });
  let prevented = 0; for (const node of before.filter(row => row.type === 'a')) node.props.onClick({ preventDefault: () => { prevented++; } });
  assert.equal(prevented, 2); assert.deepEqual(h.calls, []);
});
test('retained rows cannot navigate or edit after a new day state, controller replacement or unmount', () => {
  for (const transition of ['state', 'controller', 'unmount'] as const) {
    const h = harness(), before = all(h.render());
    if (transition === 'state') h.patch({ snapshot: { ...h.state().snapshot, records: [] } });
    if (transition === 'controller') h.render({ controller: harness().controller });
    if (transition === 'unmount') h.unmount();
    let prevented = 0; for (const node of before.filter(row => row.type === 'a')) node.props.onClick({ preventDefault: () => { prevented++; } });
    for (const node of before.filter(row => row.type === 'button')) node.props.onClick?.();
    assert.equal(prevented, 2); assert.deepEqual(h.calls, []);
  }
});
test('temporary checking retains the raw appointment draft but prevents stale submit, update and cancellation', () => {
  const h = harness(true), before = all(h.render()), expected = h.state().draft, during = all(h.render({ disabled: true }));
  assert.equal(h.state().draft, expected); assert.equal(during.find(row => row.type === 'input' && row.props.value === 'موعد مصطنع').props.disabled, true);
  before.find(row => row.type === 'form').props.onSubmit({ preventDefault() {} });
  for (const node of before.filter(row => row.type === 'input')) node.props.onChange?.({ target: { value: 'تعديل قديم', checked: true } });
  before.find(row => row.type === 'button' && text(row) === 'إلغاء المسودة').props.onClick(); assert.deepEqual(h.calls, []);
  const after = all(h.render({ disabled: false })); after.find(row => row.type === 'input' && row.props.value === 'موعد مصطنع').props.onChange({ target: { value: 'اسم حديث' } });
  assert.deepEqual(h.calls, ['update']);
});
test('retry and cancellation never target a newer pending operation from an old render', () => {
  const h = harness(false, true), before = all(h.render()); h.patch({ pendingOperationId: '90000000-0000-4000-8000-000000000002' });
  for (const row of before.filter(row => row.type === 'button')) row.props.onClick?.(); assert.deepEqual(h.calls, []);
});
test('closed/busy current controller state blocks native links even before a React rerender', () => {
  for (const patch of [{ closed: true }, { loading: true }, { historyLoading: true }]) {
    const h = harness(), anchors = all(h.render()).filter(row => row.type === 'a'); h.patch(patch);
    let prevented = 0; for (const anchor of anchors) anchor.props.onClick({ preventDefault: () => { prevented++; } }); assert.equal(prevented, 2);
  }
});
test('StrictMode effect replay restores same-day action and native-link guards', () => {
  const h = harness(), nodes = all(h.render()); h.strictReplay();
  nodes.find(row => row.type === 'button' && text(row) === 'تحديث').props.onClick(); let prevented = false;
  nodes.find(row => row.type === 'a').props.onClick({ preventDefault: () => { prevented = true; } });
  assert.deepEqual(h.calls, ['refresh']); assert.equal(prevented, false);
});
