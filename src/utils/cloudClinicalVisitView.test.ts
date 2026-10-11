import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { createCloudCatalogVisitDraft } from './cloudCatalogVisitDraft';
import type { CloudClinicalPatientSnapshot } from './cloudClinicalPatientProjection';
import type { CloudServiceCatalogRecord } from './cloudServiceCatalogRepository';
import type { CloudClinicalVisitWorkspaceController, CloudClinicalVisitWorkspaceState } from './cloudClinicalVisitWorkspaceController';
import type { CloudClinicalVisitEditorModel, CloudClinicalVisitEditorViewProps } from '../components/patients/CloudClinicalVisitEditor';

// Synthetic hooks/SSR with fabricated records, NOT visual/mobile/live Auth,
// deployed Rules, SDK transactions or two-device acceptance verification.
const compiled = await build({ entryPoints: ['src/components/patients/CloudClinicalVisitEditor.tsx'], bundle: true,
  write: false, metafile: true, platform: 'node', format: 'cjs', logLevel: 'silent',
  external: ['react', 'react-dom', 'lucide-react'], loader: { '.css': 'empty' } });
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { default: CloudClinicalVisitEditor, CloudClinicalVisitEditorView, parseCloudClinicalVisitMoney,
  getCloudClinicalVisitTotal, buildCloudClinicalVisitSubmission } = module.exports as typeof import('../components/patients/CloudClinicalVisitEditor');
const id = (n: number) => `80000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const FIRST = id(1), SECOND = id(2), THIRD = id(3), FOURTH = id(4);
function catalog(): CloudServiceCatalogRecord {
  return { schemaVersion: 1, clinicId: 'main', recordId: 'serviceCatalog', revision: 7, lastOperationId: id(90),
    data: { examinationCents: 12_345, services: [
      { serviceId: FIRST, name: 'حشو مصطنع بلا سعر', kind: 'clinical', priceCents: null, active: true },
      { serviceId: SECOND, name: 'خلع مصطنع بسعر', kind: 'clinical', priceCents: 20_000, active: true },
      { serviceId: THIRD, name: 'اسم عام لا يكشف أنه تركيبة', kind: 'prosthetic', priceCents: 50_000, active: true },
      { serviceId: FOURTH, name: 'خدمة مصطنعة متوقفة', kind: 'clinical', priceCents: 10_000, active: false },
    ] } };
}
function snapshot(): CloudClinicalPatientSnapshot {
  return { patientRecordId: id(99), profile: { fileNo: 501, data: { name: 'مريض مصطنع سري', mobile: '01000000000' } } } as CloudClinicalPatientSnapshot;
}
function state(changes: Partial<CloudClinicalVisitWorkspaceState> = {}): CloudClinicalVisitWorkspaceState {
  return { phase: 'idle', snapshot: null, catalog: null, draft: null, error: '', closed: false, ...changes };
}
function harness() {
  let source = catalog(), patient = snapshot(), nextId = 10;
  let draft = createCloudCatalogVisitDraft(source, { newId: () => id(nextId++) });
  let value = state({ phase: 'editing', snapshot: patient, catalog: source, draft: draft.getState() });
  const calls: any[][] = [], behavior = { onPublish: null as (() => void) | null, wait: null as Promise<void> | null };
  const publish = () => { value = { ...value, draft: draft.getState() }; behavior.onPublish?.(); };
  const mutate = (name: string, action: () => void) => { calls.push([name]); try { action(); publish(); return true; } catch { return false; } };
  const controller: CloudClinicalVisitWorkspaceController = {
    getState: () => value, subscribe: () => () => {},
    begin: async () => { calls.push(['begin']); source = catalog(); patient = snapshot();
      draft = createCloudCatalogVisitDraft(source, { newId: () => id(nextId++) });
      value = state({ phase: 'editing', snapshot: patient, catalog: source, draft: draft.getState() }); return true; },
    chooseService: serviceId => mutate('choose', () => { draft.chooseService(serviceId); }),
    setServicePrice: (rowId, cents) => mutate('price', () => { draft.setServicePrice(rowId, cents); }),
    setServiceTooth: (rowId, tooth) => mutate('tooth', () => { draft.setServiceTooth(rowId, tooth); }),
    removeService: rowId => mutate('remove', () => { draft.removeService(rowId); }),
    setTeeth: ids => mutate('teeth', () => { draft.setTeeth(ids); }),
    setExaminationEnabled: selected => mutate('exam', () => { draft.setExaminationEnabled(selected); }),
    save: async (metadata, paidCents) => { calls.push(['save', metadata, paidCents]); value = { ...value, phase: 'submitting' }; await behavior.wait; return false; },
    cancel: () => { calls.push(['cancel']); value = state(); behavior.onPublish?.(); return true; },
    retry: async () => { calls.push(['retry']); return false; },
    cancelPending: async () => { calls.push(['cancelPending']); return false; },
    dispose: () => { value = state({ closed: true }); behavior.onPublish?.(); },
  };
  return { controller, calls, behavior, get: () => value,
    replace: (changes: Partial<CloudClinicalVisitWorkspaceState>) => { value = { ...value, ...changes }; },
    publish, raw: () => draft };
}
type Element = { type: unknown; props: Record<string, any> };
const children = (node: any): any[] => node == null ? [] : Array.isArray(node) ? node.flatMap(children) : [node];
const all = (node: any): Element[] => children(node).flatMap(item => item && typeof item === 'object' && item.props ? [item, ...all(item.props.children)] : []);
const text = (node: any): string => children(node).map(item => typeof item === 'string' || typeof item === 'number' ? String(item) : item?.props ? text(item.props.children) : '').join('');
interface Slots { refs: Array<{ current: any }>; states: any[] }
const slots = (): Slots => ({ refs: [], states: [] });
function invoke(component: (props: any) => any, props: any, memory = slots()) {
  const internal = (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE, before = internal.H;
  let refs = 0, states = 0;
  internal.H = { useId: () => 'synthetic-visit', useCallback: (fn: unknown) => fn,
    useRef: (value: unknown) => { const index = refs++; return memory.refs[index] ?? (memory.refs[index] = { current: value }); },
    useState: (initial: unknown) => { const index = states++; if (!(index in memory.states)) memory.states[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      return [memory.states[index], (value: any) => { memory.states[index] = typeof value === 'function' ? value(memory.states[index]) : value; }]; },
    useSyncExternalStore: (_subscribe: unknown, get: () => unknown) => get() };
  try { return component(props); } finally { internal.H = before; }
}
function mounted(h = harness()) {
  const memory = slots(), live = { controller: h.controller, previewOnly: false, closing: false };
  const render = () => invoke(CloudClinicalVisitEditor, live, memory) as { props: CloudClinicalVisitEditorViewProps };
  const props = () => render().props;
  const change = (patch: any) => { const p = props(); assert.ok(p.editor); p.onChange(p.editor, patch); };
  const choose = (serviceId = SECOND) => { const p = props(); assert.ok(p.editor); p.onChooseService(p.editor, serviceId); };
  const view = () => invoke(CloudClinicalVisitEditorView, props());
  return { h, live, render, props, change, choose, view };
}
function pureProps(h = harness()): CloudClinicalVisitEditorViewProps {
  const source = mounted(h).props();
  return { ...source, onChange: () => {}, onChooseService: () => {}, onPrice: () => {}, onRemove: () => {},
    onTooth: () => {}, onExamination: () => {}, onSave: () => {}, onCancel: () => {}, onCancelLoading: () => {} };
}
const tick = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

test('visit decimal parser uses exact piastres, Arabic/Persian digits, explicit zero and nullable blank', () => {
  for (const [raw, cents] of [['0', 0], ['٠', 0], ['۰', 0], ['١٢٫٣٤', 1234], ['۱۲.۳', 1230], [' 10.01 ', 1001], ['10000000000', 1_000_000_000_000]] as const)
    assert.deepEqual(parseCloudClinicalVisitMoney(raw), { valid: true, cents });
  assert.deepEqual(parseCloudClinicalVisitMoney(''), { valid: true, cents: null });
  assert.deepEqual(parseCloudClinicalVisitMoney('  '), { valid: true, cents: null });
});
test('visit decimal parser rejects signs, grouping, exponent, rounding, overflow and malformed decimals', () => {
  for (const raw of ['-0', '-1', '+1', '1e2', 'NaN', 'Infinity', '0.001', '.5', '2.', '1,000', '١٬٠٠٠', '1.2.3', '10000000000.01', '9'.repeat(33), '1\n0'])
    assert.deepEqual(parseCloudClinicalVisitMoney(raw), { valid: false, cents: null }, raw);
});
test('visit construction/render do not begin, read catalog, choose IDs or collect any cash', () => {
  const m = mounted(); m.render(); m.view();
  assert.deepEqual(m.h.calls, []); assert.equal(m.props().editor?.date, ''); assert.equal(m.props().editor?.paid, '');
  assert.equal(m.h.get().draft?.examinationEnabled, false); assert.equal(m.h.get().draft?.services.length, 0);
  assert.equal(Object.keys(compiled.metafile!.inputs).some(path => /firebaseCloud|firebase\/|cloudOperatingAuth|storage\.ts/.test(path)), false);
});
test('idle editor is absent and loading is read-only without automatic work', () => {
  const h = harness(); h.replace(state()); const m = mounted(h);
  assert.equal(m.render(), null); h.replace({ phase: 'loading' });
  const output = m.view(); assert.match(text(output), /جارٍ قراءة/);
  assert.equal(all(output).filter(node => node.type === 'button' && text(node) !== 'إلغاء فتح الزيارة').every(node => node.props.disabled), true);
  assert.deepEqual(h.calls, []);
});
test('functional wrapper hides idle/closed forms and keeps loading, editing, pending and submitting visible', () => {
  const m = mounted();
  for (const phase of ['loading', 'editing', 'pending', 'submitting'] as const) {
    m.h.replace({ phase }); assert.ok(m.render(), phase);
  }
  m.h.replace({ phase: 'idle', error: 'رسالة مصطنعة لا تفتح محررًا' }); assert.equal(m.render(), null);
  m.h.replace({ closed: true, phase: 'editing' }); assert.equal(m.render(), null);
});
test('explicit empty design preview remains visible when controller is idle or closed', () => {
  const m = mounted(); m.h.replace(state()); m.live.previewOnly = true;
  assert.ok(m.render()); assert.match(text(m.view()), /معاينة تصميم فارغة/);
  m.h.controller.dispose(); assert.ok(m.render()); assert.equal(m.props().editor, null);
});
test('preview masks erroneously supplied patient, catalog, draft, errors and raw financial values', () => {
  const m = mounted(); m.choose(); m.change({ notes: 'SECRET-NOTE', paid: '199', date: '2026-10-12' });
  const p = m.props(), html = renderToStaticMarkup(React.createElement(CloudClinicalVisitEditorView, {
    ...p, previewOnly: true, state: { ...p.state, error: 'SECRET-ERROR' },
  }));
  for (const forbidden of ['SECRET-NOTE', 'SECRET-ERROR', 'مريض مصطنع سري', 'خلع مصطنع بسعر', '١٢٣٫٤٥', '2026-10-12', 'value="199"']) assert.equal(html.includes(forbidden), false, forbidden);
  assert.match(html, /معاينة تصميم فارغة/); assert.match(html, /قيمة الكشف غير مقروءة/);
  assert.equal(/href=/.test(html), false);
});
test('preview retained component callbacks cannot choose, price, remove, toggle, save or cancel', () => {
  const m = mounted(); m.choose(); const old = m.props(), expected = old.editor!; const row = expected.sourceDraft.services[0];
  m.h.calls.length = 0; m.live.previewOnly = true; const preview = m.props(); assert.equal(preview.editor, null);
  old.onChooseService(expected, SECOND); old.onPrice(expected, row.id, '9'); old.onRemove(expected, row.id);
  old.onExamination(expected, true); old.onTooth(expected, row.id, 'ur5'); old.onSave(expected); old.onCancel(expected);
  assert.deepEqual(m.h.calls, []);
});
test('empty preview performs no clock or ID work even when supplied a valid dated hidden editor', () => {
  const m = mounted(); m.choose(); m.change({ date: '2026-10-12', paid: '0' }); const p = m.props();
  const OriginalDate = Date, cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  let clocks = 0, ids = 0;
  class NoCurrentClock extends OriginalDate {
    constructor(...args: any[]) {
      if (!args.length) { clocks++; throw new Error('No current clock in preview'); }
      super(args[0]);
    }
    static now(): never { clocks++; throw new Error('No current clock in preview'); }
  }
  try {
    Object.defineProperty(globalThis, 'Date', { configurable: true, writable: true, value: NoCurrentClock });
    Object.defineProperty(globalThis, 'crypto', { configurable: true, get() { ids++; throw new Error('No IDs in preview'); } });
    const html = renderToStaticMarkup(React.createElement(CloudClinicalVisitEditorView, { ...p, previewOnly: true }));
    assert.match(html, /معاينة تصميم فارغة/); assert.equal(clocks, 0); assert.equal(ids, 0);
  } finally {
    Object.defineProperty(globalThis, 'Date', { configurable: true, writable: true, value: OriginalDate });
    if (cryptoDescriptor) Object.defineProperty(globalThis, 'crypto', cryptoDescriptor); else Reflect.deleteProperty(globalThis, 'crypto');
  }
});
test('presentation retained handlers become inert after preview, closing or editor replacement', () => {
  const p = pureProps(), memory = slots(), calls: string[] = []; p.onChooseService = () => calls.push('choose');
  const output = invoke(CloudClinicalVisitEditorView, p, memory), held = all(output).find(node => node.type === 'button' && text(node).includes('خلع مصطنع بسعر'))!;
  assert.ok(held); invoke(CloudClinicalVisitEditorView, { ...p, previewOnly: true }, memory); held.props.onClick();
  invoke(CloudClinicalVisitEditorView, { ...p, closing: true }, memory); held.props.onClick();
  invoke(CloudClinicalVisitEditorView, { ...p, editor: { ...p.editor! } }, memory); held.props.onClick(); assert.deepEqual(calls, []);
});
test('service selector lists active clinical definitions only, not names guessed to be prosthetics', () => {
  const p = pureProps(), html = renderToStaticMarkup(React.createElement(CloudClinicalVisitEditorView, p));
  assert.match(html, /حشو مصطنع بلا سعر/); assert.match(html, /خلع مصطنع بسعر/);
  assert.equal(html.includes('اسم عام لا يكشف أنه تركيبة'), false); assert.equal(html.includes('خدمة مصطنعة متوقفة'), false);
});
test('large catalog choices are initially bounded and search still finds services beyond the visible page', () => {
  const p = pureProps(), source = catalog();
  source.data.services = Array.from({ length: 300 }, (_, index) => ({ serviceId: id(1000 + index),
    name: `خدمة مصطنعة ${index}`, kind: 'clinical' as const, active: true, priceCents: 10_000 }));
  p.editor = { ...p.editor!, catalog: source, choiceLimit: 8 }; p.state = { ...p.state, catalog: source };
  let output = invoke(CloudClinicalVisitEditorView, p);
  const count = () => all(output).filter(node => node.type === 'button' && node.props.className === 'ccv-service-choice').length;
  assert.equal(count(), 8); assert.match(text(output), /عرض خدمات إضافية/);
  p.editor = { ...p.editor, query: 'خدمة مصطنعة 299' }; output = invoke(CloudClinicalVisitEditorView, p);
  assert.equal(count(), 1); assert.match(text(output), /خدمة مصطنعة 299/);
});
test('show more preserves raw fields and search resets its page size without touching the controller', () => {
  const m = mounted(); m.change({ paid: '1.', date: '2026-10-12', notes: 'مسودة مصطنعة', query: 'حشو', choiceLimit: 16 });
  const p = m.props(); p.onChange(p.editor!, { choiceLimit: 24 }); let next = m.props();
  assert.equal(next.editor!.paid, '1.'); assert.equal(next.editor!.date, '2026-10-12'); assert.equal(next.editor!.notes, 'مسودة مصطنعة'); assert.equal(next.editor!.query, 'حشو');
  const output = invoke(CloudClinicalVisitEditorView, next), search = all(output).find(node => node.type === 'input' && node.props.type === 'search')!;
  search.props.onChange({ target: { value: 'خلع' } }); next = m.props(); assert.equal(next.editor!.choiceLimit, 8); assert.equal(next.editor!.query, 'خلع');
  assert.equal(next.editor!.paid, '1.'); assert.deepEqual(m.h.calls, []);
});
test('one intentional service click appends immediately and the same retained handler cannot append twice', () => {
  const m = mounted(), p = m.props(), expected = p.editor!;
  p.onChooseService(expected, SECOND); p.onChooseService(expected, SECOND);
  assert.equal(m.h.get().draft?.services.length, 1); assert.equal(m.h.calls.filter(call => call[0] === 'choose').length, 1);
  assert.equal(m.h.calls.some(call => call[0] === 'save'), false);
  assert.equal(text(m.view()).includes('إضافة الخدمة للمسودة'), false);
});
test('held service callback after actual closure or controller replacement is inert', () => {
  const m = mounted(), p = m.props(), expected = p.editor!; m.h.controller.dispose(); p.onChooseService(expected, FIRST);
  assert.deepEqual(m.h.calls, []); const next = harness(); m.live.controller = next.controller; m.props();
  p.onChooseService(expected, SECOND); assert.deepEqual(next.calls, []);
});
test('unknown service price remains blank, blocks total/save and is not silently counted as zero', () => {
  const m = mounted(); m.choose(FIRST); m.change({ date: '2026-10-12', paid: '0' });
  const p = m.props(), editor = p.editor!;
  assert.equal(editor.prices[editor.sourceDraft.services[0].id], '');
  assert.equal(getCloudClinicalVisitTotal(editor), null); assert.equal(buildCloudClinicalVisitSubmission(editor), null);
  p.onSave(editor); assert.equal(m.h.calls.some(call => call[0] === 'save'), false);
  assert.match(text(m.view()), /غير مكتملة/);
});
test('explicit zero service price and zero collected are valid but blank collected is not zero', () => {
  const m = mounted(); m.choose(FIRST); let p = m.props(); p.onPrice(p.editor!, p.editor!.sourceDraft.services[0].id, '٠');
  m.change({ date: '2026-10-12' }); assert.equal(buildCloudClinicalVisitSubmission(m.props().editor!), null);
  m.change({ paid: '۰' }); p = m.props(); assert.equal(getCloudClinicalVisitTotal(p.editor!), 0);
  assert.equal(buildCloudClinicalVisitSubmission(p.editor!)?.paidCents, 0); p.onSave(p.editor!);
  const saved = m.h.calls.find(call => call[0] === 'save'); assert.ok(saved); assert.equal(saved[2], 0);
});
test('partial invalid price is retained locally without replacing the last valid controller price', () => {
  const m = mounted(); m.choose(); let p = m.props(); const rowId = p.editor!.sourceDraft.services[0].id;
  p.onPrice(p.editor!, rowId, '2.'); p = m.props();
  assert.equal(p.editor!.prices[rowId], '2.'); assert.equal(m.h.get().draft?.services[0].priceCents, 20_000);
  assert.equal(getCloudClinicalVisitTotal(p.editor!), null); assert.equal(m.h.calls.some(call => call[0] === 'price'), false);
});
test('metadata and incomplete price survive own synchronous publication and reentrant render', () => {
  const m = mounted(); m.choose(); let p = m.props(); const rowId = p.editor!.sourceDraft.services[0].id;
  p.onPrice(p.editor!, rowId, '2.'); m.change({ paid: '1.', date: '2026-10-12', notes: 'مسودة مصطنعة لم تكتمل', treatmentStage: 'second' });
  m.h.behavior.onPublish = () => { m.render(); }; m.choose(FIRST); p = m.props();
  assert.equal(p.editor!.prices[rowId], '2.'); assert.equal(p.editor!.paid, '1.'); assert.equal(p.editor!.date, '2026-10-12');
  assert.equal(p.editor!.notes, 'مسودة مصطنعة لم تكتمل'); assert.equal(p.editor!.treatmentStage, 'second');
  assert.equal(p.editor!.sourceDraft.services.length, 2);
});
test('own synchronous mutation cannot publish a raw editor after reentrant preview or disposal', () => {
  const m = mounted(); m.change({ notes: 'سر مصطنع' }); const before = m.props();
  m.h.behavior.onPublish = () => { m.live.previewOnly = true; m.render(); };
  before.onChooseService(before.editor!, SECOND); assert.equal(m.props().editor, null);
  before.onExamination(before.editor!, true); assert.equal(m.h.calls.filter(call => call[0] === 'exam').length, 0);
  const other = mounted(); const p = other.props(); other.h.behavior.onPublish = () => { other.h.controller.dispose(); other.render(); };
  // Avoid a recursive fake dispose notification: disposal itself is not a draft publication.
  other.h.controller.dispose = () => { other.h.replace(state({ closed: true })); };
  p.onChooseService(p.editor!, SECOND); assert.equal(other.render(), null);
});
test('reentrant price/examination updates preserve raw date/cash/notes and use the new source draft', () => {
  const m = mounted(); m.choose(); m.change({ paid: '12.30', date: '2026-10-12', notes: 'متابعة مصطنعة' });
  m.h.behavior.onPublish = () => { m.render(); }; let p = m.props(); const rowId = p.editor!.sourceDraft.services[0].id;
  p.onPrice(p.editor!, rowId, '١٥٫٣٠'); p = m.props(); p.onExamination(p.editor!, true); p = m.props();
  assert.equal(p.editor!.prices[rowId], '١٥٫٣٠'); assert.equal(p.editor!.paid, '12.30'); assert.equal(p.editor!.date, '2026-10-12');
  assert.equal(p.editor!.notes, 'متابعة مصطنعة'); assert.equal(p.editor!.sourceDraft, m.h.get().draft);
  assert.equal(getCloudClinicalVisitTotal(p.editor!), 13_875);
});
test('configured examination uses the captured arbitrary fee, never hardcoded100 and never auto payment', () => {
  const m = mounted(); let p = m.props(); p.onExamination(p.editor!, true); p = m.props();
  assert.equal(p.editor!.sourceDraft.examinationCents, 12_345); assert.equal(p.editor!.paid, ''); assert.equal(getCloudClinicalVisitTotal(p.editor!), 12_345);
  const output = invoke(CloudClinicalVisitEditorView, p), toggle = all(output).find(node => typeof node.type === 'function' && (node.type as Function).name === 'ExaminationFeeToggle');
  assert.ok(toggle); assert.equal(toggle.props.fee, 123.45); assert.equal(toggle.props.selected, true);
  assert.equal(m.h.calls.some(call => call[0] === 'save'), false);
});
test('tooth picker is one shared single-selection board for the selected row, including pediatric and clear', () => {
  const m = mounted(); m.choose(); m.choose(FIRST); let p = m.props(); const rowId = p.editor!.sourceDraft.services[0].id;
  m.change({ selectedRowId: rowId, dentition: 'pediatric' }); p = m.props();
  const output = invoke(CloudClinicalVisitEditorView, p), boards = all(output).filter(node => typeof node.type === 'function' && (node.type as Function).name === 'ToothSelectionGrid');
  assert.equal(boards.length, 1); assert.equal(boards[0].props.mode, 'single'); assert.equal(boards[0].props.dentition, 'pediatric');
  boards[0].props.onChange(['urA']); assert.equal(m.h.get().draft?.services[0].tooth, 'urA');
  p = m.props(); p.onTooth(p.editor!, rowId, null); assert.equal(m.h.get().draft?.services[0].tooth, null);
  assert.equal(m.h.calls.some(call => call[0] === 'save'), false);
});
test('price changes, tooth selection, removals and exam toggles do not change the captured catalog', () => {
  const m = mounted(), original = structuredClone(m.h.get().catalog); m.choose(); let p = m.props(); const rowId = p.editor!.sourceDraft.services[0].id;
  p.onPrice(p.editor!, rowId, '15'); p = m.props(); p.onTooth(p.editor!, rowId, 'll8'); p = m.props(); p.onExamination(p.editor!, true);
  p = m.props(); p.onRemove(p.editor!, rowId); assert.deepEqual(m.h.get().catalog, original); assert.equal(m.h.get().draft?.services.length, 0);
});
test('save validation rejects too much cash, invalid dates and empty zero-fee visits', () => {
  const m = mounted(); m.choose(); m.change({ paid: '200.01', date: '2026-10-12' }); assert.equal(buildCloudClinicalVisitSubmission(m.props().editor!), null);
  m.change({ paid: '10', date: '2026-02-30' }); assert.equal(buildCloudClinicalVisitSubmission(m.props().editor!), null);
  m.change({ date: '' }); assert.equal(buildCloudClinicalVisitSubmission(m.props().editor!), null);
  const p = mounted().props(); assert.equal(buildCloudClinicalVisitSubmission({ ...p.editor!, paid: '0', date: '2026-10-12' }), null);
});
test('visit total, entered collection and remaining are separate and submission retains progress', () => {
  const m = mounted(); m.choose(); m.change({ paid: '75.25', date: '2026-10-12', treatmentStage: 'third', rootCanalStatus: 'canal_filled', visitStatus: 'follow_up', notes: 'ملاحظة مصطنعة' });
  const p = m.props(), submission = buildCloudClinicalVisitSubmission(p.editor!); assert.ok(submission);
  assert.equal(getCloudClinicalVisitTotal(p.editor!), 20_000); assert.equal(submission.paidCents, 7_525);
  assert.deepEqual(submission.metadata, { date: '2026-10-12', notes: 'ملاحظة مصطنعة', treatmentStage: 'third', rootCanalStatus: 'canal_filled', visitStatus: 'follow_up' });
  const html = renderToStaticMarkup(React.createElement(CloudClinicalVisitEditorView, p));
  assert.match(html, /قيمة الزيارة/); assert.match(html, /المحصّل المُدخل/); assert.match(html, /المتبقي بعد الحفظ/); assert.match(html, /١٢٤٫٧٥/);
});
test('pending editor is locked and points at the existing file controls without duplicate retry buttons', () => {
  const m = mounted(); m.choose(); m.h.replace({ phase: 'pending' }); const p = m.props(), output = invoke(CloudClinicalVisitEditorView, p);
  assert.match(text(output), /أزرار التحقق أعلى الملف/);
  assert.equal(all(output).filter(node => node.type === 'button').every(node => node.props.disabled), true);
  assert.equal(all(output).some(node => node.type === 'button' && /التحقق|إعادة/.test(text(node))), false);
  p.onChooseService(p.editor!, FIRST); p.onExamination(p.editor!, true); assert.equal(m.h.calls.filter(call => call[0] === 'choose').length, 1);
});
test('an old save callback is single-use and no async completion revives a disposed or previewed editor', async () => {
  const m = mounted(); m.choose(); m.change({ paid: '0', date: '2026-10-12' }); const p = m.props();
  let finish!: () => void; m.h.behavior.wait = new Promise(resolve => { finish = resolve; });
  p.onSave(p.editor!); p.onSave(p.editor!); assert.equal(m.h.calls.filter(call => call[0] === 'save').length, 1);
  m.h.controller.dispose(); m.live.previewOnly = true; assert.equal(m.props().editor, null); finish(); await tick();
  assert.equal(m.props().editor, null); assert.equal(m.h.get().closed, true);
});
test('a previous controller saving does not lock a replacement controller or clear its raw draft', async () => {
  const m = mounted(); m.choose(); m.change({ paid: '0', date: '2026-10-12' }); const old = m.props();
  let finish!: () => void; m.h.behavior.wait = new Promise(resolve => { finish = resolve; }); old.onSave(old.editor!);
  const next = harness(); m.live.controller = next.controller; m.props(); m.choose(FIRST); m.change({ notes: 'جديدة مصطنعة' });
  assert.equal(next.get().draft?.services.length, 1); finish(); await tick(); assert.equal(m.props().editor?.notes, 'جديدة مصطنعة');
});
test('cancellation and a fresh begin do not reuse old raw fields, selected tooth or cash', async () => {
  const m = mounted(); m.choose(); m.change({ paid: '90', date: '2026-10-12', notes: 'قديمة مصطنعة', selectedRowId: m.props().editor!.sourceDraft.services[0].id });
  const p = m.props(); p.onCancel(p.editor!); assert.equal(m.render(), null); await m.h.controller.begin(snapshot());
  const next = m.props().editor!; assert.equal(next.paid, ''); assert.equal(next.date, ''); assert.equal(next.notes, ''); assert.equal(next.selectedRowId, null);
  p.onChooseService(p.editor!, FIRST); assert.equal(m.h.get().draft?.services.length, 0);
});
test('source draft replacement outside an owned mutation discards incompatible raw fields', () => {
  const m = mounted(); m.choose(); m.change({ notes: 'قديمة مصطنعة', paid: '20' });
  const old = m.props(); m.h.raw().setExaminationEnabled(true); m.h.publish(); const next = m.props();
  assert.equal(next.editor!.notes, ''); assert.equal(next.editor!.paid, '');
  old.onChange(old.editor!, { notes: 'لا تعيدها' }); assert.equal(m.props().editor!.notes, '');
});
test('closing blocks component handlers even when retained before the close state', () => {
  const m = mounted(), p = m.props(); m.live.closing = true; m.props();
  p.onChooseService(p.editor!, SECOND); p.onChange(p.editor!, { notes: 'لا تغير' }); p.onCancel(p.editor!); assert.deepEqual(m.h.calls, []);
});
test('loading with a failed release exposes explicit cancellation without a draft and fences stale callbacks', () => {
  const m = mounted(); m.h.replace(state({ phase: 'loading', snapshot: snapshot(), error: 'تعذر تحرير قفل مصطنع' }));
  const p = m.props(), output = invoke(CloudClinicalVisitEditorView, p);
  assert.ok(all(output).find(node => node.type === 'button' && text(node) === 'إلغاء فتح الزيارة' && !node.props.disabled));
  p.onCancelLoading(p.state); assert.equal(m.h.calls.filter(call => call[0] === 'cancel').length, 1);
  m.h.calls.length = 0; m.h.replace(state({ phase: 'loading' })); const current = m.props();
  p.onCancelLoading(p.state); assert.deepEqual(m.h.calls, []);
  m.live.previewOnly = true; m.props(); current.onCancelLoading(current.state); assert.deepEqual(m.h.calls, []);
});
test('responsive stylesheet is scoped, single-column on mobile with44px touches,16px inputs and reduced motion', async () => {
  const css = await readFile('src/components/patients/CloudClinicalVisitEditor.css', 'utf8');
  assert.match(css, /\.cloud-clinical-visit/); assert.match(css, /min-height:\s*44px/); assert.match(css, /font-size:\s*16px/);
  assert.match(css, /@media\s*\(max-width:\s*760px\)[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/); assert.equal(/overflow-x:\s*(auto|scroll)|width:\s*100vw/.test(css), false);
});
