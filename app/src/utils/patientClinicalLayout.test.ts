import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

// Actual components rendered with synthetic inputs and deterministic callbacks.
// CSS is ignored only for Node SSR. No browser, cloud, live data or visual QA.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const built = buildSync({ stdin: { resolveDir: root, loader: 'tsx', contents: `
  import React from 'react';
  import {renderToStaticMarkup} from 'react-dom/server';
  import {ToothChart} from './src/components/patient/ToothChart';
  import {PrescriptionAndInstructionsView} from './src/components/patient/PrescriptionAndInstructionsView';
  import {ToastAndConfirmProvider} from './src/components/common/ToastAndConfirm';
  export const chart = ToothChart;
  export const rx = PrescriptionAndInstructionsView;
  export const renderChart = props => renderToStaticMarkup(<ToothChart {...props} />);
  export const renderRx = props => renderToStaticMarkup(<ToastAndConfirmProvider><PrescriptionAndInstructionsView {...props} /></ToastAndConfirmProvider>);
` }, bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external', loader: { '.css': 'empty' }, logLevel: 'silent' });
const compiled = { exports: {} as Record<'chart' | 'rx', (props: any) => any> & Record<'renderChart' | 'renderRx', (props: any) => string> };
new Function('require', 'module', 'exports', built.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
type Element = { type: unknown; props: Record<string, any> };
const children = (node: any): any[] => node == null ? [] : Array.isArray(node) ? node.flatMap(children) : [node];
const all = (node: any): Element[] => children(node).flatMap(item => item && typeof item === 'object' && item.props ? [item, ...all(item.props.children)] : []);
const text = (node: any): string => children(node).map(item => typeof item === 'string' || typeof item === 'number' ? String(item) : item?.props ? text(item.props.children) : '').join('');
const patient = { id: '501', name: 'اسم اختبار مصطنع', mobile: '01000000000', age: 30, firstVisit: '2026-10-10', notes: '', allergy: '', sessions: [], payments: [] };
const drugs = Array.from({ length: 30 }, (_, index) => Object.freeze({ id: `fake-drug-${index}`, name: `دواء اختبار ${String(index).padStart(2, '0')}`, category: index % 2 ? 'تصنيف ب' : 'تصنيف أ', defaultDosage: `جرعة اختبار ${index}`, defaultDuration: `مدة اختبار ${index}` }));
const rxProps = { patient, clinicName: 'عيادة اختبار', clinicLogo: null, drugCatalog: drugs, canSendWhatsApp: false };

function harness(component: (props: any) => any, initialProps: Record<string, any>) {
  const internals = (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  assert.ok(internals && 'H' in internals);
  const slots: any[] = [], toasts: string[] = []; let tree: Element, props = initialProps;
  const context = { showToast: (message: string) => toasts.push(message) };
  const render = () => {
    let cursor = 0;
    const dispatcher = {
      useState(initial: any) { const index = cursor++; slots[index] ||= { value: typeof initial === 'function' ? initial() : initial }; return [slots[index].value, (next: any) => { slots[index].value = typeof next === 'function' ? next(slots[index].value) : next; }]; },
      useId() { return `synthetic-clinical-${cursor++}`; },
      useRef(initial: any) { const index = cursor++; return slots[index] ||= { current: initial }; },
      useMemo(factory: () => any, deps: any[]) { const index = cursor++; if (!slots[index] || deps.some((value, i) => !Object.is(value, slots[index].deps[i]))) slots[index] = { value: factory(), deps }; return slots[index].value; },
      useDeferredValue(value: any) { cursor++; return value; }, useEffect() { cursor++; }, useContext() { return context; },
    };
    const prior = internals.H; internals.H = dispatcher;
    try { tree = component(props); } finally { internals.H = prior; }
    return tree;
  };
  const find = (predicate: (item: Element) => boolean) => { const item = all(tree).find(predicate); assert.ok(item, 'Missing synthetic clinical control'); return item; };
  render();
  return { render, find, toasts, get elements() { return all(tree); }, get content() { return text(tree); },
    setProps(patch: Record<string, any>) { props = { ...props, ...patch }; render(); },
    clickLabel(label: string) { find(item => item.type === 'button' && text(item).trim() === label).props.onClick(); render(); },
    clickAria(label: string) { find(item => item.type === 'button' && item.props['aria-label'] === label).props.onClick(); render(); },
    change(label: string, value: string) { find(item => item.props['aria-label'] === label).props.onChange({ target: { value } }); render(); },
  };
}

test('tooth chart uses 32 accessible permanent squares without anatomical mode or a healthy diagnosis', () => {
  const html = compiled.exports.renderChart({ patient, onOpenAddSessionModal() {} });
  assert.equal((html.match(/data-tooth-id=/g) || []).length, 32);
  assert.equal((html.match(/class="tooth-chart-quadrant"/g) || []).length, 4);
  assert.match(html, /أسنان دائمة|أسنان لبنية/); assert.match(html, /بدون علامة علاجية/);
  assert.doesNotMatch(html, /تشريحي|نوع الفك|سليم|overflow-x-auto/);
  assert.match(html, /data-tooth-id="ur8"/); assert.match(html, /aria-describedby=/);
});

test('chart preserves controlled IDs and explicit clear while primary toggle clears stale permanent selection', () => {
  const selected: (string | null)[] = []; let registered = 0;
  const h = harness(compiled.exports.chart, { patient, selectedToothId: 'ur6', onSelectTooth: (id: string | null) => selected.push(id), onOpenAddSessionModal: () => { registered++; } });
  assert.equal(h.find(item => item.props['data-tooth-id'] === 'ur6').props['aria-pressed'], true);
  assert.ok(!h.elements.some(item => item.props.className === 'tooth-register-service'));
  h.clickAria('إلغاء تحديد السن'); assert.deepEqual(selected, [null]);
  h.setProps({ selectedToothId: null });
  h.find(item => item.props['data-tooth-id'] === 'll4').props.onClick(); assert.equal(selected.at(-1), 'll4');
  h.setProps({ selectedToothId: 'll4' }); h.clickLabel('أسنان لبنية'); assert.equal(selected.at(-1), null);
  h.setProps({ selectedToothId: null });
  const teeth = h.elements.filter(item => item.props['data-tooth-id']); assert.equal(teeth.length, 20);
  assert.ok(teeth.every(item => /^(ur|ul|lr|ll)[A-E]$/.test(item.props['data-tooth-id'])));
  assert.equal(registered, 0);
});

test('uncontrolled selection registers only after explicit service action and can toggle off', () => {
  const registered: string[] = [];
  const h = harness(compiled.exports.chart, { patient, onOpenAddSessionModal: (id: string) => registered.push(id) });
  h.find(item => item.props['data-tooth-id'] === 'ul3').props.onClick(); h.render(); assert.deepEqual(registered, []);
  h.clickLabel('تسجيل خدمة'); assert.deepEqual(registered, ['ul3']);
  h.find(item => item.props['data-tooth-id'] === 'ul3').props.onClick(); h.render();
  assert.ok(!h.elements.some(item => item.props.className === 'tooth-selection-strip'));
});

test('actual tooth keyboard handler supports arrows/Home/End and Escape without changing tooth IDs by focusing', () => {
  const h = harness(compiled.exports.chart, { patient, onOpenAddSessionModal() {} });
  const handler = h.find(item => item.props['data-tooth-id'] === 'ur8').props.onKeyDown;
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'getComputedStyle');
  const focused: number[] = [];
  const buttons = Array.from({ length: 8 }, (_, index) => ({ focus: () => focused.push(index), parentElement: null as any }));
  const grid = { querySelectorAll: () => buttons }; buttons.forEach(button => { button.parentElement = grid; });
  Object.defineProperty(globalThis, 'getComputedStyle', { configurable: true, value: () => ({ gridTemplateColumns: '48px 48px 48px 48px' }) });
  try {
    for (const [key, expected] of [['ArrowRight', 1], ['ArrowDown', 4], ['End', 7], ['Home', 0], ['ArrowLeft', 0], ['ArrowUp', 0]] as const) {
      let prevented = false; handler({ key, currentTarget: buttons[0], preventDefault() { prevented = true; } });
      assert.equal(prevented, true); assert.equal(focused.at(-1), expected);
    }
    h.find(item => item.props['data-tooth-id'] === 'ur8').props.onClick(); h.render();
    handler({ key: 'Escape', currentTarget: buttons[0], preventDefault() {} }); h.render();
    assert.ok(!h.elements.some(item => item.props.className === 'tooth-selection-strip'));
  } finally { if (previous) Object.defineProperty(globalThis, 'getComputedStyle', previous); else Reflect.deleteProperty(globalThis, 'getComputedStyle'); }
});

test('Rx catalog is bounded/searchable and the draft editor preserves exact source medication text', () => {
  const original = JSON.stringify(drugs);
  const h = harness(compiled.exports.rx, rxProps);
  assert.equal(h.elements.filter(item => item.props.className === 'rx-catalog-drug').length, 12);
  h.clickLabel('عرض أدوية أخرى (18)'); assert.equal(h.elements.filter(item => item.props.className === 'rx-catalog-drug').length, 24);
  h.change('بحث في فهرس الأدوية', 'دواء اختبار 04');
  assert.equal(h.elements.filter(item => item.props.className === 'rx-catalog-drug').length, 1);
  h.clickAria('إضافة دواء اختبار 04 إلى الروشتة');
  assert.equal(h.find(item => item.props['aria-label'] === 'جرعة الدواء 1').props.value, 'جرعة اختبار 4');
  assert.equal(h.find(item => item.props['aria-label'] === 'مدة الدواء 1').props.value, 'مدة اختبار 4');
  h.change('جرعة الدواء 1', 'جرعة عدّلها الطبيب'); h.change('مدة الدواء 1', 'مدة عدّلها الطبيب');
  const preview = h.find(item => item.props.id === 'printable-prescription');
  assert.match(text(preview), /جرعة عدّلها الطبيب|مدة عدّلها الطبيب/);
  assert.ok(!all(preview).some(item => item.type === 'input' || item.type === 'button'));
  assert.equal(JSON.stringify(drugs), original);
  h.clickAria('حذف الدواء 1'); assert.ok(!h.elements.some(item => item.props['aria-label'] === 'اسم الدواء 1'));
});

test('Rx instructions and template tools do not erase the medication draft or modify clinical template wording', () => {
  const h = harness(compiled.exports.rx, rxProps); h.clickAria('إضافة دواء اختبار 00 إلى الروشتة');
  h.clickLabel('تعليمات بعد العلاج');
  const instruction = h.find(item => item.props['aria-label'] === 'نص تعليمات العلاج للمريض');
  assert.match(instruction.props.value, /الضغط المباشر على الشاش فوق موضع الخلع لمدة ساعة كاملة وعدم التحدث\./);
  h.change('نص تعليمات العلاج للمريض', 'تعليمات اختبار كتبها الطبيب');
  h.clickLabel('الروشتة الطبية'); assert.equal(h.find(item => item.props['aria-label'] === 'اسم الدواء 1').props.value, 'دواء اختبار 00');
  h.clickLabel('بيانات ورقة الروشتة'); h.change('اسم الطبيب بالعربي', 'طبيب اختبار');
  assert.match(text(h.find(item => item.props.id === 'printable-prescription')), /طبيب اختبار/);
  h.clickLabel('تعليمات بعد العلاج'); assert.equal(h.find(item => item.props['aria-label'] === 'نص تعليمات العلاج للمريض').props.value, 'تعليمات اختبار كتبها الطبيب');
});

test('Rx image workflow is the primary output, explicit two-step sharing and bounded text alternative', () => {
  const h = harness(compiled.exports.rx, { ...rxProps, canPrint: true, onAuthorizePrint() {}, canSendWhatsApp: true, onAuthorizeWhatsappSend() {} });
  const output = h.find(item => item.props['aria-label'] === 'معاينة الروشتة وخيارات الصورة والطباعة');
  const navigation: string[] = [];
  output.props.ref.current = { scrollIntoView(options: any) { assert.equal(options.behavior, 'auto'); navigation.push('scroll'); }, focus(options: any) { assert.equal(options.preventScroll, true); navigation.push('focus'); } };
  h.clickLabel('صورة الروشتة والطباعة');
  assert.deepEqual(navigation, ['scroll', 'focus']);
  const initial = h.find(item => item.props['aria-label'] === 'تجهيز صورة الروشتة');
  assert.equal(initial.props.className, 'rx-primary-button');
  assert.equal(initial.props.disabled, true);
  h.clickAria('إضافة دواء اختبار 00 إلى الروشتة');
  assert.equal(h.find(item => item.props['aria-label'] === 'تجهيز صورة الروشتة').props.disabled, false);
  const workflow = h.find(item => item.props['aria-label'] === 'إرسال الروشتة كصورة');
  assert.match(text(workflow), /بنفس تصميم الطباعة|جهّز الصورة وراجعها/);
  assert.match(text(workflow), /لا ترسل تلقائيًا|تنزيل الصورة وإرفاقها يدويًا/);
  const alternative = h.find(item => item.type === 'details' && item.props.className === 'rx-text-alternative');
  assert.match(text(alternative), /خيارات الرسالة النصية|واتساب كنص/);
  assert.equal(alternative.props.open, undefined);
  const html = compiled.exports.renderRx({ ...rxProps, canPrint: false, onAuthorizePrint() {} });
  assert.doesNotMatch(html, /class="rx-image-workflow"|aria-label="إرسال الروشتة كصورة"|class="rx-primary-button"/);
});

test('Rx print and WhatsApp controls respect denied/privacy-derived capabilities and fresh print revocation', () => {
  for (const props of [{}, { canPrint: false, onAuthorizePrint() {} }, { canPrint: true }]) {
    const html = compiled.exports.renderRx({ ...rxProps, ...props });
    assert.doesNotMatch(html, /طباعة الروشتة \(A5\)|فتح الروشتة في واتساب|تجهيز صورة الروشتة|تنزيل الصورة|مشاركة الصورة — واتساب/);
  }
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window'); let printed = 0, checks = 0, allowed = true;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { print: () => { printed++; } } });
  try {
    const h = harness(compiled.exports.rx, { ...rxProps, canPrint: true, onAuthorizePrint: () => { checks++; if (!allowed) throw new Error('PRIVATE_SYNTHETIC_ERROR'); } });
    const button = h.find(item => item.type === 'button' && text(item).includes('طباعة الروشتة (A5)'));
    button.props.onClick(); assert.equal(printed, 1); assert.equal(checks, 1);
    allowed = false; button.props.onClick(); assert.equal(printed, 1); assert.equal(checks, 2);
    assert.match(h.toasts.at(-1) || '', /تعذّرت الطباعة/); assert.ok(!h.toasts.join(' ').includes('PRIVATE_SYNTHETIC_ERROR'));
    h.clickAria('إضافة دواء اختبار 00 إلى الروشتة'); h.change('اسم الدواء 1', ' '); allowed = true;
    h.clickLabel('طباعة الروشتة (A5)'); assert.equal(printed, 1); assert.match(h.toasts.at(-1) || '', /راجع أسماء الأدوية/);
  } finally { if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window'); }
});

test('Rx WhatsApp text and instructions reauthorize immediately before opening the current patient chat', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const opened: string[] = []; let allowed = true, checks = 0;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { open: (url: string) => opened.push(url) } });
  try {
    const denied = compiled.exports.renderRx({ ...rxProps, canSendWhatsApp: true });
    assert.doesNotMatch(denied, /واتساب كنص|فتح التعليمات في واتساب/);
    const h = harness(compiled.exports.rx, { ...rxProps, canSendWhatsApp: true, onAuthorizeWhatsappSend(request: any) { checks++; assert.deepEqual(request, { isCampaign: false, requiresFinance: false }); if (!allowed) throw new Error('SYNTHETIC_PRIVATE'); } });
    h.clickAria('إضافة دواء اختبار 00 إلى الروشتة'); h.clickLabel('واتساب كنص');
    assert.equal(checks, 1); assert.equal(opened.length, 1); assert.match(opened[0], /^https:\/\/wa.me\/201000000000/);
    allowed = false; h.clickLabel('واتساب كنص'); assert.equal(opened.length, 1);
    h.clickLabel('تعليمات بعد العلاج'); h.clickLabel('فتح التعليمات في واتساب'); assert.equal(opened.length, 1);
    assert.equal(checks, 3); assert.ok(!h.toasts.join(' ').includes('SYNTHETIC_PRIVATE'));
  } finally { if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window'); }
});

test('clinical layout CSS uses bounded square grids, wrapping controls, reduced motion and nonclipping print rules', () => {
  const css = readFileSync(new URL('../components/patient/patientClinicalTools.css', import.meta.url), 'utf8');
  assert.match(css, /grid-template-columns: repeat\(4, minmax\(0, 48px\)\)/);
  assert.match(css, /aspect-ratio: 1/); assert.match(css, /min-height: 44px/);
  assert.match(css, /prefers-reduced-motion: reduce/); assert.match(css, /animation: none !important/);
  assert.match(css, /\.rx-dose-grid[^}]+grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /height: auto !important; min-height: 210mm/);
  assert.doesNotMatch(css, /overflow-x:\s*(?:auto|scroll)|width:\s*\d+vw/);
  // Static sizing check only, not browser-computed overflow certification.
  const adultMinimumWidth = 4 * 48 + 3 * 6 + 2 * .7 * 16;
  assert.ok(adultMinimumWidth < 360 - 2 * 32);
});
