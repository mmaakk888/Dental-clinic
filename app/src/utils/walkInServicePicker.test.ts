import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

// Synthetic actual component handlers + SSR only. No DOM effects/browser,
// clinical records, storage, network or external messaging is involved.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const built = buildSync({ stdin: { resolveDir: root, loader: 'tsx', contents: `
  import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server';
  import {WalkInServicePicker} from './src/components/walkin/WalkInServicePicker';
  export const component = WalkInServicePicker;
  export const render = props => renderToStaticMarkup(<WalkInServicePicker {...props}/>);
` }, bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external', logLevel: 'silent' });
const compiled = { exports: {} as { component: (props: any) => any; render: (props: any) => string } };
new Function('require', 'module', 'exports', built.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
type Element = { type: unknown; props: Record<string, any> };
const children = (node: any): any[] => node == null ? [] : Array.isArray(node) ? node.flatMap(children) : [node];
const all = (node: any): Element[] => children(node).flatMap(item => item && typeof item === 'object' && item.props ? [item, ...all(item.props.children)] : []);
const text = (node: any): string => children(node).map(item => typeof item === 'string' || typeof item === 'number' ? String(item) : item?.props ? text(item.props.children) : '').join('');
const options = Object.freeze([{ name: 'حشو اختبار', price: 600 }, { name: 'خدمة اختبار صفر', price: 0 }, { name: 'خدمة اختبار بدون سعر' }, { name: 'أشعة اختبار', price: 1200.5 }]);

function harness(overrides: Record<string, any> = {}) {
  const internals = (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  const slots: any[] = [], added: { name: string; price?: number }[] = []; let tree: Element, custom = 0;
  let props = { options, onAdd: (name: string, price?: number) => added.push({ name, price }), onAddCustom: () => { custom++; }, ...overrides };
  const render = () => {
    let cursor = 0;
    const dispatcher = {
      useState(initial: any) { const index = cursor++; slots[index] ||= { value: typeof initial === 'function' ? initial() : initial }; return [slots[index].value, (next: any) => { slots[index].value = typeof next === 'function' ? next(slots[index].value) : next; }]; },
      useId() { return `synthetic-picker-${cursor++}`; },
      useRef(initial: any) { const index = cursor++; return slots[index] ||= { current: initial }; },
      useMemo(factory: () => any, deps: any[]) { const index = cursor++; if (!slots[index] || deps.some((value, i) => !Object.is(value, slots[index].deps[i]))) slots[index] = { value: factory(), deps }; return slots[index].value; },
    };
    const prior = internals.H; internals.H = dispatcher;
    try { tree = compiled.exports.component(props); } finally { internals.H = prior; }
    return tree;
  };
  const find = (predicate: (item: Element) => boolean) => { const item = all(tree).find(predicate); assert.ok(item, 'Missing synthetic service picker control'); return item; };
  render();
  return { render, find, added, get custom() { return custom; }, get content() { return text(tree); }, get elements() { return all(tree); },
    setProps(patch: Record<string, any>) { props = { ...props, ...patch }; render(); },
    click(label: string) { find(item => item.type === 'button' && text(item) === label).props.onClick(); render(); },
    clickAria(label: string) { find(item => item.props['aria-label'] === label).props.onClick(); render(); },
    change(label: string, value: string) { find(item => item.props['aria-label'] === label).props.onChange({ target: { value } }); render(); },
  };
}

test('SSR is a closed inline disclosure with accessible buttons, not a native service select or nested modal', () => {
  let added = 0;
  const html = compiled.exports.render({ options, onAdd: () => { added++; }, onAddCustom() {} });
  assert.match(html, /aria-expanded="false" aria-controls=/); assert.match(html, /اختيار خدمة من الفهرس|خدمة أخرى/);
  assert.doesNotMatch(html, /<select|role="dialog"|حشو اختبار/); assert.equal(added, 0);
  assert.match(compiled.exports.render({ options: [], onAdd() {}, onAddCustom() {} }), /disabled="" aria-expanded="false"/);
});

test('one service click immediately appends the configured draft row once, without a confirmation step or a clinic save', () => {
  const h = harness(); h.click('اختيار خدمة من الفهرس');
  const select = h.find(item => item.props['aria-label'] === 'اختيار خدمة حشو اختبار').props.onClick;
  select(); select(); h.render();
  assert.deepEqual(h.added, [{ name: 'حشو اختبار', price: 600 }]);
  assert.match(h.content, /أُضيفت حشو اختبار للزيارة — ٦٠٠ ج\.م.*يمكنك تعديل السعر أو حذف الخدمة.*لم تُحفظ الزيارة بعد/);
  assert.doesNotMatch(h.content, /إضافة الخدمة للمسودة|الخدمة المختارة قبل الإضافة/);
  assert.equal(h.find(item => item.type === 'button' && text(item) === 'اختيار خدمة من الفهرس').props['aria-expanded'], false);
});

test('search uses normalized Arabic names and Arabic/Latin public prices', () => {
  const h = harness(); h.click('اختيار خدمة من الفهرس'); h.change('بحث خدمات الزيارة', 'اشعه');
  assert.equal(h.elements.filter(item => item.props['aria-label']?.startsWith('اختيار خدمة ')).length, 0);
  h.change('بحث خدمات الزيارة', 'اشعة'); assert.equal(h.elements.filter(item => item.props['aria-label']?.startsWith('اختيار خدمة ')).length, 1);
  h.change('بحث خدمات الزيارة', '٦٠٠'); assert.match(h.content, /حشو اختبار/); assert.doesNotMatch(h.content, /أشعة اختبار/);
  h.change('بحث خدمات الزيارة', '1200.5'); assert.match(h.content, /أشعة اختبار/);
  h.change('بحث خدمات الزيارة', 'اسم غير موجود'); assert.match(h.content, /لا توجد خدمة مطابقة/);
});

test('explicit zero is a configured price, while missing or invalid prices append undefined for the parent required field', () => {
  const h = harness(); h.click('اختيار خدمة من الفهرس');
  assert.match(h.content, /خدمة اختبار صفر٠ ج\.م/); assert.match(h.content, /خدمة اختبار بدون سعرأضف السعر بعد الاختيار/);
  h.clickAria('اختيار خدمة خدمة اختبار صفر');
  assert.deepEqual(h.added[0], { name: 'خدمة اختبار صفر', price: 0 });
  h.click('اختيار خدمة من الفهرس'); h.clickAria('اختيار خدمة خدمة اختبار بدون سعر');
  assert.deepEqual(h.added[1], { name: 'خدمة اختبار بدون سعر', price: undefined });
  assert.match(h.content, /اكتب سعرها قبل الحفظ/);
  for (const price of [-1, NaN, Infinity, 10.001, 10000001]) {
    h.setProps({ options: [{ name: 'سعر غير صالح', price }] }); h.click('اختيار خدمة من الفهرس'); h.clickAria('اختيار خدمة سعر غير صالح');
    assert.deepEqual(h.added.at(-1), { name: 'سعر غير صالح', price: undefined });
  }
});

test('each intentional reopening permits a selection but old retained handlers cannot consume the new opening', () => {
  const h = harness(); h.click('اختيار خدمة من الفهرس');
  const staleFirst = h.find(item => item.props['aria-label'] === 'اختيار خدمة حشو اختبار').props.onClick;
  staleFirst(); h.render();
  h.click('اختيار خدمة من الفهرس'); staleFirst(); h.render();
  assert.equal(h.added.length, 1); h.clickAria('اختيار خدمة أشعة اختبار');
  assert.deepEqual(h.added, [{ name: 'حشو اختبار', price: 600 }, { name: 'أشعة اختبار', price: 1200.5 }]);
  h.click('اختيار خدمة من الفهرس'); h.clickAria('اختيار خدمة حشو اختبار');
  assert.deepEqual(h.added[2], { name: 'حشو اختبار', price: 600 });
});

test('close and Escape consume the opening without invoking a service callback or saving', () => {
  const h = harness(); h.click('اختيار خدمة من الفهرس');
  const stale = h.find(item => item.props['aria-label'] === 'اختيار خدمة حشو اختبار').props.onClick;
  h.clickAria('إغلاق اختيار الخدمات'); stale(); assert.equal(h.added.length, 0);
  h.click('اختيار خدمة من الفهرس');
  let prevented = false, stopped = false;
  h.find(item => item.props.className === 'walkin-picker-panel').props.onKeyDown({ key: 'Escape', preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } }); h.render();
  assert.equal(prevented, true); assert.equal(stopped, true); assert.equal(h.added.length, 0);
  assert.ok(!h.elements.some(item => item.props.className === 'walkin-picker-panel'));
});

test('Enter from search is consumed without an implicit submit, while service buttons keep native activation', () => {
  const h = harness(); h.click('اختيار خدمة من الفهرس');
  {
    const input = h.find(item => item.props['aria-label'] === 'بحث خدمات الزيارة');
    let prevented = false, stopped = false;
    h.find(item => item.props.className === 'walkin-picker-panel').props.onKeyDown({ key: 'Enter', target: { tagName: String(input.type).toUpperCase() }, preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
    assert.equal(prevented, true); assert.equal(stopped, true); assert.equal(h.added.length, 0);
  }
  let prevented = false, stopped = false;
  h.find(item => item.props.className === 'walkin-picker-panel').props.onKeyDown({ key: 'Enter', target: { tagName: 'BUTTON' }, preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
  assert.equal(prevented, false); assert.equal(stopped, false);
  h.clickAria('اختيار خدمة حشو اختبار'); assert.deepEqual(h.added, [{ name: 'حشو اختبار', price: 600 }]);
});

test('latest disabled capability and removed catalog service block retained add handlers', () => {
  const h = harness(); h.click('اختيار خدمة من الفهرس');
  const staleAdd = h.find(item => item.props['aria-label'] === 'اختيار خدمة حشو اختبار').props.onClick;
  h.setProps({ disabled: true }); staleAdd(); assert.equal(h.added.length, 0);
  h.setProps({ disabled: false, options: options.filter(item => item.name !== 'حشو اختبار') }); staleAdd(); h.render();
  assert.equal(h.added.length, 0); assert.match(h.content, /الخدمة لم تعد في الفهرس الحالي/);
});

test('a retained choice uses the latest configured price, not the displayed stale suggestion', () => {
  const h = harness(); h.click('اختيار خدمة من الفهرس');
  const retained = h.find(item => item.props['aria-label'] === 'اختيار خدمة حشو اختبار').props.onClick;
  h.setProps({ options: [{ name: 'حشو اختبار', price: 725.5 }] }); retained(); h.render();
  assert.deepEqual(h.added, [{ name: 'حشو اختبار', price: 725.5 }]);
});

test('failed draft append keeps the picker available, hides private errors and permits a service-click retry', () => {
  let calls = 0; const received: any[] = [];
  const h = harness({ onAdd: (name: string, price: number) => { calls++; if (calls === 1) throw new Error('SYNTHETIC_PRIVATE_ERROR'); received.push({ name, price }); } });
  h.click('اختيار خدمة من الفهرس'); h.clickAria('اختيار خدمة حشو اختبار');
  assert.match(h.content, /تعذّرت إضافة الخدمة للزيارة/); assert.doesNotMatch(h.content, /SYNTHETIC_PRIVATE_ERROR/);
  assert.ok(h.elements.some(item => item.props.className === 'walkin-picker-panel'));
  h.clickAria('اختيار خدمة حشو اختبار'); assert.equal(calls, 2); assert.deepEqual(received, [{ name: 'حشو اختبار', price: 600 }]);
});

test('large catalog is bounded and explicit load-more/search retain access to every configured service', () => {
  const h = harness({ options: Array.from({ length: 300 }, (_, index) => ({ name: `خدمة اختبار ${index}`, price: index })) });
  h.click('اختيار خدمة من الفهرس');
  const choices = () => h.elements.filter(item => item.props['aria-label']?.startsWith('اختيار خدمة '));
  assert.equal(choices().length, 20); h.click('عرض خدمات أخرى (280)'); assert.equal(choices().length, 40);
  h.change('بحث خدمات الزيارة', 'خدمة اختبار 299'); assert.equal(choices().length, 1); h.clickAria('اختيار خدمة خدمة اختبار 299');
  assert.deepEqual(h.added, [{ name: 'خدمة اختبار 299', price: 299 }]);
});

test('custom service action remains explicit and does not invoke catalog add', () => {
  const h = harness(); h.click('خدمة أخرى'); assert.equal(h.custom, 1); assert.equal(h.added.length, 0);
  assert.match(h.content, /سطر خدمة أخرى جاهز للتعديل/);
});

test('scoped CSS provides ≥44px controls, bounded vertical lists, narrow-screen wrapping and reduced motion', () => {
  const css = readFileSync(new URL('../components/walkin/walkInServicePicker.css', import.meta.url), 'utf8');
  assert.match(css, /min-height: 44px/); assert.match(css, /min-height: 52px/);
  assert.match(css, /max-height: 15rem; overflow-y: auto/); assert.match(css, /font-size: 1rem/);
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\) 18px/); assert.match(css, /overflow-wrap: anywhere/);
  assert.match(css, /prefers-reduced-motion: reduce/); assert.match(css, /animation: none !important/);
  assert.doesNotMatch(css, /overflow-x:\s*(?:auto|scroll)|width:\s*\d+vw/);
});
