import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createHash } from 'node:crypto';
import CloudProfileContactRecoveryPanel from '../components/shared/CloudProfileContactRecoveryPanel';
import { createCloudProfileContactRecoveryController } from './cloudProfileContactRecoveryController';
import { prepareCloudIntentCommand, type CloudOperationIntent } from './cloudOperationIntent';

const OP = '10000000-0000-4000-8000-000000000001', RECORD = '20000000-0000-4000-8000-000000000001';
const TIME = '2026-10-12T12:00:00.000Z';
function intent(status: CloudOperationIntent['status'], kind: 'contact' | 'patient-profile' = 'contact') {
  const command = prepareCloudIntentCommand({ action: 'create', operationId: OP, recordId: RECORD, expectedRevision: 0,
    ...(kind === 'contact' ? { contact: { id: RECORD, name: 'اسم مصطنع طويل للاختبار فقط', mobile: '01000000001', createdAt: '2026-10-01T12:00:00.000Z' } }
      : { profile: { name: 'مريض مصطنع', mobile: '', age: 30, gender: '', firstVisit: '2026-10-12', notes: '', allergy: '' } }) });
  return { schemaVersion: 1 as const, clinicId: 'main' as const, recordId: OP, operationId: OP,
    actorUid: 'synthetic-panel-owner', kind, command, status, revision: (status === 'prepared' ? 1 : 2) as 1 | 2,
    createdAt: TIME, requestHash: createHash('sha256').update(JSON.stringify(['clinic-operation-intent-v1', 'synthetic-panel-owner', kind, command])).digest('hex') };
}
function fixture(status: CloudOperationIntent['status'] = 'prepared', kind: 'contact' | 'patient-profile' = 'contact') {
  const calls: string[] = []; let alive = true, parentAllows = true;
  const controller = createCloudProfileContactRecoveryController({ kind, isActive: () => alive,
    getJournal: async () => { calls.push('journal'); return {
      prepare: async () => { throw new Error('No writes from panel.'); }, get: async () => { throw new Error('No per-record reads from panel.'); },
      cancel: async () => { throw new Error('No cancellation from panel.'); }, listPreparedPage: async () => { throw new Error('No prepared-only fallback.'); },
      listHistoryPage: async () => { calls.push('history'); return { records: [intent(status, kind)], nextAfterId: null }; },
    }; } });
  const props = { controller, onResume: (id: string) => calls.push(`resume:${id}`), disabled: false,
    canAct: () => parentAllows };
  return { controller, props, calls, alive: (value: boolean) => { alive = value; }, allow: (value: boolean) => { parentAllows = value; } };
}
type Element = { type: unknown; props: Record<string, any> };
const all = (node: any): Element[] => Array.isArray(node) ? node.flatMap(all)
  : node && typeof node === 'object' && node.props ? [node, ...all(node.props.children)] : [];
const text = (node: any): string => Array.isArray(node) ? node.map(text).join('')
  : typeof node === 'string' || typeof node === 'number' ? String(node) : node?.props ? text(node.props.children) : '';
function renderer() {
  const refs: any[] = [], effects: Array<() => void> = []; let index = 0;
  return {
    render: (props: React.ComponentProps<typeof CloudProfileContactRecoveryPanel>) => {
      index = 0;
      const internals = (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE, previous = internals.H;
      internals.H = { useId: () => 'synthetic-recovery-panel', useCallback: (callback: unknown) => callback,
        useRef: (initial: unknown) => { const position = index++; return refs[position] ??= { current: initial }; },
        useEffect: (effect: () => () => void) => { effects.push(effect()); },
        useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot() };
      try { return CloudProfileContactRecoveryPanel(props); } finally { internals.H = previous; }
    },
    unmount: () => { effects.forEach(cleanup => cleanup?.()); },
  };
}
function button(tree: unknown, pattern: RegExp) {
  const found = all(tree).find(item => item.type === 'button' && pattern.test(text(item)));
  assert.ok(found); return found;
}

test('recovery panel renders empty and subscribes without acquiring a journal or reading records', () => {
  const h = fixture(); const html = renderToStaticMarkup(React.createElement(CloudProfileContactRecoveryPanel, h.props));
  assert.deepEqual(h.calls, []); assert.match(html, /سجل الحفظ والاسترجاع/); assert.match(html, /تحميل سجل العمليات/);
  assert.doesNotMatch(html, /اسم مصطنع/); assert.match(html, /min-h-11/); assert.match(html, /motion-reduce/);
});

test('recovery history labels imported historical file numbers as imports, never ordinary allocation', async () => {
  const base = intent('prepared', 'patient-profile'), command = prepareCloudIntentCommand({ ...base.command, action: 'import', fileNo: 450,
    profile: { ...(base.command.profile as object), firstVisit: '' } });
  const imported: CloudOperationIntent = { ...base, command, requestHash: createHash('sha256').update(JSON.stringify(['clinic-operation-intent-v1', base.actorUid, base.kind, command])).digest('hex') };
  const controller = createCloudProfileContactRecoveryController({ kind: 'patient-profile', isActive: () => true, getJournal: async () => ({
    prepare: async () => { throw new Error(); }, get: async () => imported, cancel: async () => { throw new Error(); },
    listPreparedPage: async () => ({ records: [imported], nextAfterId: null }), listHistoryPage: async () => ({ records: [imported], nextAfterId: null }) }) });
  await controller.loadFirst(); const html = renderToStaticMarkup(React.createElement(CloudProfileContactRecoveryPanel, { controller, onResume() {}, disabled: false }));
  assert.match(html, /استيراد ملف مريض #450/); assert.doesNotMatch(html, /إنشاء ملف مريض|تعديل ملف مريض/);
});
for (const status of ['prepared', 'committed', 'cancelled'] as const) {
  test(`panel displays ${status} explicitly and never creates or cancels a domain operation`, async () => {
    const h = fixture(status); await h.controller.loadFirst(); const r = renderer(), tree = r.render(h.props);
    assert.match(text(tree), status === 'prepared' ? /محضّرة/ : status === 'committed' ? /تم الحفظ/ : /ملغاة/);
    assert.ok(text(tree).includes(OP)); assert.match(text(tree), /2026-10-12/);
    if (status !== 'cancelled') button(tree, status === 'prepared' ? /استئناف العملية/ : /عرض النتيجة/).props.onClick();
    assert.deepEqual(h.calls, status === 'cancelled' ? ['journal', 'history'] : ['journal', 'history', `resume:${OP}`]);
    assert.equal(all(tree).some(item => item.type === 'button' && /إلغاء العملية/.test(text(item))), false);
  });
}
test('preview masks supplied live history and blocks retained load/resume callbacks', async () => {
  const h = fixture(); await h.controller.loadFirst(); const r = renderer();
  const old = r.render(h.props), oldLoad = button(old, /تحديث السجل/).props.onClick, oldResume = button(old, /استئناف العملية/).props.onClick;
  const preview = r.render({ ...h.props, previewOnly: true }); oldLoad(); oldResume();
  assert.doesNotMatch(text(preview), /اسم مصطنع/); assert.ok(!text(preview).includes(OP));
  assert.deepEqual(h.calls, ['journal', 'history']);
  assert.ok(all(preview).filter(item => item.type === 'button').every(item => item.props.disabled));
});
test('retained callbacks recheck parent draft lock, disposal and actual lifetime loss', async () => {
  for (const action of ['draft', 'closed', 'lease'] as const) {
    const h = fixture(); await h.controller.loadFirst(); const r = renderer(), tree = r.render(h.props);
    const load = button(tree, /تحديث السجل/).props.onClick, resume = button(tree, /استئناف العملية/).props.onClick;
    if (action === 'draft') h.allow(false); else if (action === 'closed') h.controller.dispose(); else h.alive(false);
    load(); resume(); assert.deepEqual(h.calls, ['journal', 'history']);
  }
});
test('old panel callbacks cannot act after controller replacement or component unmount', async () => {
  for (const action of ['replacement', 'unmount'] as const) {
    const h = fixture(); await h.controller.loadFirst(); const r = renderer(), tree = r.render(h.props);
    const load = button(tree, /تحديث السجل/).props.onClick, resume = button(tree, /استئناف العملية/).props.onClick;
    if (action === 'replacement') r.render(fixture().props); else r.unmount();
    load(); resume(); assert.deepEqual(h.calls, ['journal', 'history']);
  }
});
test('a retained row cannot resume after a new explicit history refresh removes that exact row object', async () => {
  const h = fixture(); await h.controller.loadFirst(); const r = renderer(), tree = r.render(h.props);
  const resume = button(tree, /استئناف العملية/).props.onClick; await h.controller.loadFirst(); resume();
  assert.deepEqual(h.calls, ['journal', 'history', 'history']);
});
test('patient profile history uses clinical-safe labels, wrapping and explicit UTC operation time', async () => {
  const h = fixture('committed', 'patient-profile'); await h.controller.loadFirst();
  const html = renderToStaticMarkup(React.createElement(CloudProfileContactRecoveryPanel, h.props));
  assert.match(html, /إنشاء ملف مريض/); assert.match(html, /overflow-wrap:anywhere/); assert.match(html, /2026-10-12.*12:00.*UTC/);
  assert.doesNotMatch(html, /href=|تكلفة المعمل|المكسب/); assert.deepEqual(h.calls, ['journal', 'history']);
});

test('reentrant preview change inside final snapshot boundary cannot execute a retained resume action', async () => {
  const h = fixture(); await h.controller.loadFirst(); const r = renderer(); let revoke = false;
  const controller = { ...h.controller, getState: () => {
    if (revoke) { revoke = false; r.render({ ...h.props, controller, previewOnly: true }); }
    return h.controller.getState();
  } };
  const tree = r.render({ ...h.props, controller }), resume = button(tree, /استئناف العملية/).props.onClick;
  revoke = true; resume(); assert.deepEqual(h.calls, ['journal', 'history']);
});
