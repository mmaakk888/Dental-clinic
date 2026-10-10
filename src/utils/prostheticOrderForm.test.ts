import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import type { ProstheticOrderInput } from './prostheticWorkflow';

// Exercise actual form rendering/callbacks, without mounting a browser, running
// DOM effects, accessing browser storage or loading any clinic records.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const built = buildSync({ stdin: { resolveDir: root, loader: 'tsx', contents: `
  import React from 'react';
  import {renderToStaticMarkup} from 'react-dom/server';
  import {ProstheticOrderForm} from './src/components/ProstheticOrderForm';
  import {ToastAndConfirmProvider} from './src/components/common/ToastAndConfirm';
  export const component = ProstheticOrderForm;
  export const render = props => renderToStaticMarkup(<ToastAndConfirmProvider><ProstheticOrderForm {...props}/></ToastAndConfirmProvider>);
` }, bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external', loader: { '.css': 'empty' }, logLevel: 'silent' });
const compiled = { exports: {} as { component: (props: any) => any; render: (props: any) => string } };
new Function('require', 'module', 'exports', built.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);

type Element = { type: unknown; props: Record<string, any> };
const children = (node: any): any[] => node == null ? [] : Array.isArray(node) ? node.flatMap(children) : [node];
const all = (node: any): Element[] => children(node).flatMap(item => item && typeof item === 'object' && item.props ? [item, ...all(item.props.children)] : []);
const text = (node: any): string => children(node).map(item => typeof item === 'string' || typeof item === 'number' ? String(item) : item?.props ? text(item.props.children) : '').join('');
const patient = Object.freeze({ id: '501', name: 'اسم اختبار مصطنع', mobile: '01000000000', age: 30, firstVisit: '2026-10-10', notes: '', allergy: '', sessions: [], payments: [] });
const prices = Object.freeze({ 'خامة اختبار أ': 600, 'خامة اختبار مجانية': 0, 'خامة اختبار ب': 1250.5 });
const props = { patient, crownPrices: prices, canRegisterPayment: true, onSave() {}, onClose() {} };

function harness(initialProps: Record<string, any> = props) {
  const internals = (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  assert.ok(internals && 'H' in internals);
  const slots: any[] = [], toasts: string[] = []; let tree: Element, currentProps = initialProps;
  const context = { showToast: (message: string) => toasts.push(message) };
  const render = () => {
    let cursor = 0;
    const dispatcher = {
      useState(initial: any) { const index = cursor++; slots[index] ||= { value: typeof initial === 'function' ? initial() : initial }; return [slots[index].value, (next: any) => { slots[index].value = typeof next === 'function' ? next(slots[index].value) : next; }]; },
      useId() { return `synthetic-prosthetic-${cursor++}`; },
      useRef(initial: any) { const index = cursor++; return slots[index] ||= { current: initial }; },
      useMemo(factory: () => any, deps: any[]) { const index = cursor++; if (!slots[index] || deps.some((value, i) => !Object.is(value, slots[index].deps[i]))) slots[index] = { value: factory(), deps }; return slots[index].value; },
      useDeferredValue(value: any) { cursor++; return value; }, useEffect() { cursor++; }, useContext() { return context; },
    };
    const prior = internals.H; internals.H = dispatcher;
    try { tree = compiled.exports.component(currentProps); } finally { internals.H = prior; }
    return tree;
  };
  const find = (predicate: (item: Element) => boolean) => { const item = all(tree).find(predicate); assert.ok(item, 'Missing synthetic prosthetic control'); return item; };
  render();
  return { render, find, toasts, get elements() { return all(tree); }, get content() { return text(tree); },
    setProps(patch: Record<string, any>) { currentProps = { ...currentProps, ...patch }; render(); },
    clickLabel(label: string) { find(item => item.type === 'button' && text(item).trim() === label).props.onClick(); render(); },
    clickAria(label: string) { find(item => item.type === 'button' && item.props['aria-label'] === label).props.onClick(); render(); },
    change(label: string, value: string) { find(item => item.props['aria-label'] === label).props.onChange({ target: { value } }); render(); },
    async submit() { await find(item => item.type === 'form').props.onSubmit({ preventDefault() {} }); render(); },
  };
}

test('SSR form exposes only public patient prices, bounded dialog and explicit unpaid defaults', () => {
  const html = compiled.exports.render(props);
  assert.match(html, /role="dialog" aria-modal="true"/);
  assert.match(html, /خامة اختبار أ|عدد الكراونات|بدون كشف|المبلغ المحصّل للتركيبة/);
  assert.doesNotMatch(html, /تكلفة المعمل|ربح|اسم المعمل|labTotal|labPaid|labServiceId/);
  const h = harness();
  assert.equal(h.find(item => item.props['aria-label'] === 'المبلغ المحصّل للتركيبة').props.value, '');
  assert.equal(h.find(item => item.type === 'button' && text(item) === 'بدون كشف').props['aria-pressed'], true);
  assert.ok(!h.elements.some(item => item.props['aria-label'] === 'رسوم كشف التركيبة'));
  const empty = harness({ ...props, crownPrices: {} });
  assert.equal(empty.find(item => item.type === 'button' && text(item).includes('حفظ التركيبة')).props.disabled, true);
  assert.match(empty.content, /جهّز أسعار التركيبات/);
});

test('actual save uses catalog unit price and chosen units, without inventing exam, cash or tooth', async () => {
  const saved: ProstheticOrderInput[] = []; let closed = 0;
  const h = harness({ ...props, onSave: (input: ProstheticOrderInput) => { saved.push(input); }, onClose: () => { closed++; } });
  h.change('خامة التركيبة', 'خامة اختبار أ'); h.change('عدد وحدات التركيبة', '2');
  await h.submit();
  assert.equal(saved.length, 1); assert.equal(closed, 1);
  assert.deepEqual({ ...saved[0], operationId: '', date: '' }, { operationId: '', patientId: '501', kind: 'fixed', material: 'خامة اختبار أ', units: 2, teethIds: [], date: '', expectedUnitPrice: 600, examinationFee: 0, paid: 0 });
  assert.match(saved[0].operationId, /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i);
  assert.match(saved[0].date, /^\d{4}-\d{2}-\d{2}$/);
});

test('explicit examination, actual partial cash, removable type and optional dates/notes reach the callback', async () => {
  const saved: ProstheticOrderInput[] = [];
  const h = harness({ ...props, examinationFee: 100, initialKind: 'removable', onSave: (input: ProstheticOrderInput) => { saved.push(input); } });
  h.change('خامة التركيبة', 'خامة اختبار ب'); h.clickLabel('بكشف');
  assert.equal(h.find(item => item.props['aria-label'] === 'رسوم كشف التركيبة').props.value, '100');
  h.change('رسوم كشف التركيبة', '125'); h.change('المبلغ المحصّل للتركيبة', '150');
  h.change('تاريخ تسجيل التركيبة', '2026-10-10'); h.change('تاريخ استلام التركيبة المتوقع', '2026-10-20'); h.change('ملاحظات التركيبة', '  ملاحظة مصطنعة للطبيب  ');
  await h.submit();
  assert.equal(saved[0].kind, 'removable'); assert.equal(saved[0].examinationFee, 125); assert.equal(saved[0].paid, 150);
  assert.equal(saved[0].expectedUnitPrice, 1250.5); assert.equal(saved[0].deliveryExpectedDate, '2026-10-20'); assert.equal(saved[0].note, 'ملاحظة مصطنعة للطبيب');
});

test('payment capability revocation hides cash and forces zero instead of submitting a stale cash draft', async () => {
  const saved: ProstheticOrderInput[] = [];
  const h = harness({ ...props, onSave: (input: ProstheticOrderInput) => { saved.push(input); } });
  h.change('خامة التركيبة', 'خامة اختبار أ'); h.change('المبلغ المحصّل للتركيبة', '100');
  h.setProps({ canRegisterPayment: false });
  assert.ok(!h.elements.some(item => item.props['aria-label'] === 'المبلغ المحصّل للتركيبة'));
  await h.submit(); assert.equal(saved[0].paid, 0);
});

test('fixed optional teeth validate unit count, deduplicate canonical IDs and support explicit clear', async () => {
  const saved: ProstheticOrderInput[] = [];
  const h = harness({ ...props, initialToothId: 'ur1', onSave: (input: ProstheticOrderInput) => { saved.push(input); } });
  h.change('خامة التركيبة', 'خامة اختبار أ'); h.change('عدد وحدات التركيبة', '2');
  await h.submit(); assert.equal(saved.length, 0); assert.match(h.toasts.at(-1) || '', /عدد المواضع/);
  h.change('إضافة سن للتركيبة', 'ur2'); h.change('إضافة سن للتركيبة', 'ur2');
  await h.submit(); assert.deepEqual(saved[0].teethIds, ['ur1', 'ur2']);
  h.clickLabel('إلغاء تحديد الأسنان'); await h.submit(); assert.deepEqual(saved[1].teethIds, []);
  assert.equal(saved[0].operationId, saved[1].operationId);
});

test('primary teeth keep canonical letters and invalid initial tooth is not persisted or displayed as a selected tooth', async () => {
  const saved: ProstheticOrderInput[] = [];
  const h = harness({ ...props, initialToothId: 'ulA', onSave: (input: ProstheticOrderInput) => { saved.push(input); } });
  assert.equal(h.find(item => item.props['aria-label'] === 'نوع الأسنان للتركيبة').props.value, 'pediatric');
  assert.equal(h.elements.filter(item => item.type === 'option' && /^(?:ur|ul|lr|ll)[A-E]$/.test(item.props.value)).length, 20);
  h.change('خامة التركيبة', 'خامة اختبار أ'); await h.submit(); assert.deepEqual(saved[0].teethIds, ['ulA']);
  const invalid = harness({ ...props, initialToothId: 'ur99' });
  assert.ok(!invalid.elements.some(item => item.type === 'button' && /^إزالة /.test(item.props['aria-label'] || '')));
});

test('invalid counts, overpayment, malformed money and backwards delivery never call onSave and preserve correction', async () => {
  const saved: ProstheticOrderInput[] = []; const h = harness({ ...props, onSave: (input: ProstheticOrderInput) => { saved.push(input); } });
  h.change('خامة التركيبة', 'خامة اختبار أ');
  for (const value of ['0', '1.5', '101', 'not-a-number']) { h.change('عدد وحدات التركيبة', value); await h.submit(); }
  h.change('عدد وحدات التركيبة', '1'); h.change('المبلغ المحصّل للتركيبة', '601'); await h.submit();
  h.change('المبلغ المحصّل للتركيبة', '-1'); await h.submit();
  h.change('المبلغ المحصّل للتركيبة', '0'); h.change('تاريخ تسجيل التركيبة', '2026-02-30'); await h.submit();
  h.change('تاريخ تسجيل التركيبة', '2026-10-10'); h.change('تاريخ استلام التركيبة المتوقع', '2026-10-09'); await h.submit();
  assert.equal(saved.length, 0); assert.ok(h.toasts.length >= 8);
  h.change('تاريخ استلام التركيبة المتوقع', '2026-10-11'); await h.submit(); assert.equal(saved.length, 1);
});

test('large patient directory is bounded and searchable by file number/name without creating a patient', async () => {
  const saved: ProstheticOrderInput[] = [];
  const patients = Array.from({ length: 1000 }, (_, index) => ({ ...patient, id: String(index + 1), name: `اختبار مصطنع ${index + 1}` }));
  const h = harness({ ...props, patient: undefined, patients, onSave: (input: ProstheticOrderInput) => { saved.push(input); } });
  const resultButtons = () => all(h.find(item => item.props.className === 'prosthetic-order-patient-results')).filter(item => item.type === 'button');
  assert.equal(resultButtons().length, 8);
  h.change('البحث عن مريض للتركيبة', '#٩٨٧'); assert.equal(resultButtons().length, 1); assert.match(text(resultButtons()[0]), /#987/);
  resultButtons()[0].props.onClick(); h.render(); h.change('خامة التركيبة', 'خامة اختبار أ'); await h.submit(); assert.equal(saved[0].patientId, '987');
  h.clickLabel('تغيير المريض'); h.change('البحث عن مريض للتركيبة', 'اختبار مصطنع 654'); assert.ok(resultButtons().some(item => text(item).includes('#654')));
  assert.equal(patients.length, 1000);
});

test('async save prevents duplicate submits and all close paths until confirmation, while failures retain retry identity/draft', async () => {
  const saved: ProstheticOrderInput[] = []; let closed = 0, resolveSave: () => void = () => {}, rejectSave: (error: Error) => void = () => {};
  let fail = true;
  const h = harness({ ...props, onClose: () => { closed++; }, onSave: (input: ProstheticOrderInput) => {
    saved.push(input); return fail ? new Promise<void>((resolve, reject) => { resolveSave = resolve; rejectSave = reject; }) : Promise.resolve();
  } });
  h.change('خامة التركيبة', 'خامة اختبار أ'); h.change('عدد وحدات التركيبة', '2'); h.change('المبلغ المحصّل للتركيبة', '100');
  const staleSubmit = h.find(item => item.type === 'form').props.onSubmit;
  const pending = staleSubmit({ preventDefault() {} }); h.render();
  assert.equal(h.find(item => item.type === 'fieldset').props.disabled, true);
  await staleSubmit({ preventDefault() {} });
  h.clickAria('إلغاء وإغلاق تسجيل التركيبة'); h.clickLabel('إلغاء وإغلاق');
  const overlay = h.find(item => item.props.className === 'clinic-modal-overlay prosthetic-order-overlay');
  const marker = {}; overlay.props.onClick({ target: marker, currentTarget: marker });
  assert.equal(saved.length, 1); assert.equal(closed, 0); assert.ok(!h.toasts.some(message => message.includes('تم حفظ')));
  rejectSave(new Error('تعذّر الحفظ في اختبار مصطنع')); await pending; h.render();
  assert.equal(closed, 0); assert.equal(h.find(item => item.props['aria-label'] === 'عدد وحدات التركيبة').props.value, '2');
  assert.equal(h.find(item => item.props['aria-label'] === 'المبلغ المحصّل للتركيبة').props.value, '100');
  fail = false; await h.submit(); assert.equal(saved.length, 2); assert.equal(saved[0].operationId, saved[1].operationId); assert.equal(closed, 1);
  assert.deepEqual(saved[0], saved[1]);
  // The first resolve remains deliberately unused: failure was explicitly awaited.
  assert.equal(typeof resolveSave, 'function');
});

test('valid zero price is not replaced and invalid catalog prices are excluded rather than invented', async () => {
  const saved: ProstheticOrderInput[] = [];
  const h = harness({ ...props, crownPrices: { ...prices, 'خامة غير صالحة': -10, 'خامة غير رقمية': Number.NaN }, examinationFee: 0, onSave: (input: ProstheticOrderInput) => { saved.push(input); } });
  assert.ok(!h.elements.some(item => item.type === 'option' && item.props.value === 'خامة غير صالحة'));
  assert.ok(!h.elements.some(item => item.type === 'option' && item.props.value === 'خامة غير رقمية'));
  h.change('خامة التركيبة', 'خامة اختبار مجانية'); h.clickLabel('بكشف');
  assert.equal(h.find(item => item.props['aria-label'] === 'رسوم كشف التركيبة').props.value, '0');
  await h.submit(); assert.equal(saved[0].expectedUnitPrice, 0); assert.equal(saved[0].examinationFee, 0); assert.equal(saved[0].paid, 0);
});

test('modal CSS confines scrolling, wraps narrow-screen content and respects reduced motion', () => {
  const css = readFileSync(new URL('../components/ProstheticOrderForm.css', import.meta.url), 'utf8');
  assert.match(css, /width: min\(100%, 44rem\)/); assert.match(css, /max-height: min\(92dvh, 60rem\)/);
  assert.match(css, /\.prosthetic-order-body[^}]+min-height: 0; overflow-y: auto/);
  assert.match(css, /@media \(max-width: 480px\)/); assert.match(css, /grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /min-height: 44px/); assert.match(css, /font-size: 1rem/); assert.match(css, /overflow-wrap: anywhere/);
  assert.match(css, /prefers-reduced-motion: reduce/); assert.match(css, /animation: none !important/);
  assert.doesNotMatch(css, /overflow-x:\s*(?:auto|scroll)|width:\s*\d+vw/);
});
