import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloneServiceCatalog } from './serviceCatalog';

// Exercise actual component markup and save handlers with synthetic hooks/settings.
// No browser, saved clinic records, downloaded files or visual QA.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const built = buildSync({ stdin: { resolveDir: root, loader: 'tsx', contents: `
  import React from 'react';
  import { renderToStaticMarkup } from 'react-dom/server';
  import { ServiceCatalogManagement } from './src/components/settings/ServiceCatalogManagement';
  import { ToastAndConfirmProvider } from './src/components/common/ToastAndConfirm';
  export const component = ServiceCatalogManagement;
  export const render = props => renderToStaticMarkup(<ToastAndConfirmProvider><ServiceCatalogManagement {...props} /></ToastAndConfirmProvider>);
` }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', loader: { '.css': 'empty' }, logLevel: 'silent' });
const compiled = { exports: {} as { component: (props: any) => any; render: (props: any) => string } };
new Function('require', 'module', 'exports', built.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
const props = (save: (value: any) => void | Promise<void> = () => {}) => ({
  ...cloneServiceCatalog({ serviceTypes: ['حشو عادي', 'تركيبات - ثابتة'], crownPrices: { PFM: 1200 }, clinicalPrices: { 'حشو عادي': 350 }, examinationFee: 100 }),
  canManagePrices: true, onSaveServiceCatalog: save, labs: [], canViewLabCosts: false, canManageLabPrices: false, onSaveLabPricing: () => {},
});
const nodes = (element: any): any[] => !element || typeof element !== 'object' ? [] : [element,
  ...(Array.isArray(element.props?.children) ? element.props.children.flat(Infinity) : [element.props?.children]).flatMap(nodes)];
const text = (node: any): string => typeof node === 'string' || typeof node === 'number' ? String(node)
  : Array.isArray(node) ? node.map(text).join('') : node?.props ? text(node.props.children) : '';

function harness(initial: any) {
  const internals = (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  const states: any[] = [], refs: any[] = [], toasts: { message: string; type: string }[] = [];
  let stateIndex = 0, refIndex = 0;
  const dispatcher = {
    useState: (value: any) => {
      const index = stateIndex++;
      if (!(index in states)) states[index] = typeof value === 'function' ? value() : value;
      return [states[index], (next: any) => { states[index] = typeof next === 'function' ? next(states[index]) : next; }];
    },
    useRef: (value: any) => { const index = refIndex++; return refs[index] ??= { current: value }; },
    useId: () => 'synthetic-catalog', useEffect: () => {},
    useContext: () => ({ showToast: (message: string, type: string) => toasts.push({ message, type }), askConfirm: () => {} }),
  };
  const render = () => {
    stateIndex = 0; refIndex = 0;
    const previous = internals.H; internals.H = dispatcher;
    try { return nodes(compiled.exports.component(initial)); } finally { internals.H = previous; }
  };
  return { render, states, toasts };
}

test('catalog exposes separate clinical prices, exam default and addable patient crowns without lab costs', () => {
  const html = compiled.exports.render(props());
  for (const phrase of ['خدمات وأسعار', 'رسوم الكشف', 'تركيبات المريض', 'إضافة نوع تركيبة', 'السعر الافتراضي لخدمة حشو عادي', 'قيمة الكشف']) assert.ok(html.includes(phrase), phrase);
  assert.match(html, /value="350"/); assert.match(html, /value="100"/);
  assert.doesNotMatch(html, /السعر الافتراضي لخدمة تركيبات - ثابتة/);
  assert.match(html, /ليست تكلفة المعمل/);
  const readonly = compiled.exports.render({ ...props(), canManagePrices: false });
  assert.match(readonly, /حسابك يمكنه عرض الفهرس فقط/);
  assert.doesNotMatch(readonly, /type="submit"/);
});

test('new defaults appear as unpriced review and a configured zero exam is not replaced by100', () => {
  const html = compiled.exports.render({ ...props(), clinicalPrices: undefined, examinationFee: 0 });
  assert.match(html, /غير مسعّر — راجع المبلغ عند التسجيل/);
  assert.match(html, /لا يعني أن العلاج مجاني/);
  assert.match(html, /id="[^"]+-exam"[^>]*value="0"/);
});

test('catalog save awaits acknowledgement, ignores duplicate submits, and does not claim success early', async () => {
  let finish!: () => void, calls = 0, received: any;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const h = harness(props(value => { calls++; received = value; return pending; }));
  h.render().find(node => node.props?.['aria-label'] === 'السعر الافتراضي لخدمة حشو عادي')!.props.onChange({ target: { value: '٤٥٠' } });
  const submit = h.render().find(node => node.type === 'form')!.props.onSubmit;
  const saving = submit({ preventDefault() {} });
  assert.equal(calls, 1); assert.equal(received.clinicalPrices['حشو عادي'], 450);
  assert.equal(h.toasts.some(item => item.type === 'success'), false);
  await submit({ preventDefault() {} }); assert.equal(calls, 1);
  assert.ok(h.render().find(node => node.type === 'button' && text(node).includes('جارٍ الحفظ'))!.props.disabled);
  finish(); await saving;
  assert.equal(h.toasts.filter(item => item.type === 'success').length, 1);
  assert.equal(h.states[0].clinicalPrices['حشو عادي'], 450);
});

test('failed catalog acknowledgement keeps the edited draft and avoids success', async () => {
  const h = harness(props(async () => { throw new Error('synthetic save failure'); }));
  h.render().find(node => node.props?.['aria-label'] === 'السعر الافتراضي لخدمة حشو عادي')!.props.onChange({ target: { value: '550' } });
  await h.render().find(node => node.type === 'form')!.props.onSubmit({ preventDefault() {} });
  assert.equal(h.states[0].clinicalPrices['حشو عادي'], '550');
  assert.equal(h.toasts.some(item => item.type === 'success'), false);
  assert.ok(h.render().some(node => node.props?.role === 'alert' && text(node).includes('synthetic save failure')));
});
