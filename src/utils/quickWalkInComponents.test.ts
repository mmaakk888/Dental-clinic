import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const built = buildSync({ stdin: { resolveDir: root, loader: 'tsx', contents: `
  import {QuickWalkInModal} from './src/components/walkin/QuickWalkInModal';
  import {WalkInServicePicker} from './src/components/walkin/WalkInServicePicker';
  export const component = QuickWalkInModal;
  export const picker = WalkInServicePicker;
` }, bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external', loader: { '.css': 'empty' }, logLevel: 'silent' });
const compiled = { exports: {} as { component: (props: any) => any; picker: (props: any) => any } };
new Function('require', 'module', 'exports', built.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
type Element = { type: unknown; props: Record<string, any> };
const children = (node: any): any[] => node == null ? [] : Array.isArray(node) ? node.flatMap(children) : [node];
const all = (node: any): Element[] => children(node).flatMap(item => item && typeof item === 'object' && item.props ? [item, ...all(typeof item.type === 'function' && item.type.name === 'ExaminationFeeToggle' ? item.type(item.props) : item.props.children)] : []);
const text = (node: any): string => children(node).map(item => typeof item === 'string' || typeof item === 'number' ? String(item) : item?.props ? text(typeof item.type === 'function' && item.type.name === 'ExaminationFeeToggle' ? item.type(item.props) : item.props.children) : '').join('');
const patient = { id: '501', name: 'مريض اختبار مصطنع', mobile: '01000000000', age: 30, firstVisit: '2026-10-10', notes: '', allergy: '', sessions: [], payments: [] };

/** Actual component handlers with deterministic hooks. Effects do not run and
 * no browser, live storage, real patient, network or visual QA is involved. */
function harness(overrides: Record<string, unknown> = {}) {
  const internals = (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  assert.ok(internals && 'H' in internals);
  const slots: any[] = [], pickerSlots: any[] = [], saved: any[] = [], toasts: string[] = [];
  let tree: Element, closed = 0, deferSearch = false;
  const context = { showToast: (message: string) => toasts.push(message) };
  const props = { isOpen: true, patients: [patient], serviceTypes: ['حشو اختبار', 'خدمة مجانية', 'تركيبات - ثابتة'], clinicalPrices: { 'حشو اختبار': 600, 'خدمة مجانية': 0, 'تركيبات - ثابتة': 9000 }, onClose: () => { closed++; }, onSaveWalkInVisit: async (value: any) => { saved.push(value); }, ...overrides };
  const evaluate = (component: (props: any) => any, componentProps: any, slots: any[]) => {
    let cursor = 0;
    const dispatcher = {
      useState(initial: any) { const index = cursor++; slots[index] ||= { value: typeof initial === 'function' ? initial() : initial }; return [slots[index].value, (next: any) => { slots[index].value = typeof next === 'function' ? next(slots[index].value) : next; }]; },
      useRef(initial: any) { const index = cursor++; return slots[index] ||= { current: initial }; },
      useId() { return `synthetic-walkin-${cursor++}`; },
      useMemo(factory: () => any, deps: any[]) { const index = cursor++; if (!slots[index] || deps.some((value, i) => !Object.is(value, slots[index].deps[i]))) slots[index] = { value: factory(), deps }; return slots[index].value; },
      useDeferredValue(value: any) { const index = cursor++; slots[index] ||= { value }; if (!deferSearch) slots[index].value = value; return slots[index].value; },
      useEffect() { cursor++; },
      useContext() { return context; },
    };
    const prior = internals.H; internals.H = dispatcher;
    try { return component(componentProps); }
    finally { internals.H = prior; }
  };
  const expandPicker = (node: any): any => {
    if (node == null || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(expandPicker);
    if (node.type === compiled.exports.picker) return evaluate(compiled.exports.picker, node.props, pickerSlots);
    return node.props ? { ...node, props: { ...node.props, children: expandPicker(node.props.children) } } : node;
  };
  const render = () => { tree = expandPicker(evaluate(compiled.exports.component, props, slots)); return tree; };
  const find = (predicate: (item: Element) => boolean) => { const item = all(tree).find(predicate); assert.ok(item, 'Missing synthetic form control'); return item; };
  const click = (label: string) => { find(item => item.type === 'button' && text(item) === label).props.onClick(); render(); };
  const change = (label: string, value: string) => { find(item => item.props['aria-label'] === label).props.onChange({ target: { value } }); render(); };
  const addCatalogService = (name: string) => {
    click('اختيار خدمة من الفهرس');
    find(item => item.props['aria-label'] === `اختيار خدمة ${name}`).props.onClick(); render();
  };
  render();
  return { render, saved, toasts, find, click, change, addCatalogService, get closed() { return closed; }, get content() { return text(tree); },
    deferSearch: (value: boolean) => { deferSearch = value; },
    setProps: (value: Record<string, unknown>) => { Object.assign(props, value); render(); },
    searchPatient: (value: string, renderNow = true) => { find(item => item.type === 'input' && item.props.placeholder === 'اسم المريض، #رقم الملف أو الهاتف').props.onChange({ target: { value } }); if (renderNow) render(); },
    tooth: (value: string, service = 1) => { find(item => item.props.ariaLabel === `أسنان الخدمة ${service}`).props.onChange(value ? [value] : []); render(); },
    dentition: (value: string, service = 1) => { find(item => item.props.ariaLabel === `أسنان الخدمة ${service}`).props.onDentitionChange(value); render(); },
    toothValue: (service = 1) => find(item => item.props.ariaLabel === `أسنان الخدمة ${service}`).props.value as string[],
    toggleExam: () => { find(item => item.props['aria-label'] === 'تسجيل الكشف').props.onClick(); render(); },
    selectPatient: () => { find(item => item.type === 'button' && text(item).includes(patient.name)).props.onClick(); render(); },
    submit: () => find(item => item.type === 'form').props.onSubmit({ preventDefault() {} }) as Promise<void>,
    input: (label: string, value: string) => { const wrapper = find(item => item.type === 'label' && text(item).startsWith(label)); const field = all(wrapper).find(item => item.type === 'input')!; field.props.onChange({ target: { value } }); render(); },
  };
}

test('quick visit renders only active configured clinical services and starts with no exam/service/payment', () => {
  const h = harness();
  h.click('اختيار خدمة من الفهرس');
  assert.match(h.content, /حشو اختبار٦٠٠ ج\.م/); assert.doesNotMatch(h.content, /تركيبات - ثابتة|خلع|علاج عصب/);
  assert.equal(h.find(item => item.props['aria-label'] === 'تسجيل الكشف').props['aria-pressed'], false);
  assert.ok(!h.content.includes('الخدمة 1'));
  assert.ok(!h.content.includes('رسوم الكشف لهذه الزيارة (ج.م)'));
  const empty = harness({ serviceTypes: [], clinicalPrices: {} });
  assert.match(empty.content, /لا توجد خدمات علاجية في الفهرس/);
});

test('pending patient search disables old results and rejects retained selections before and after rerender', async () => {
  const h = harness();
  const staleSelect = h.find(item => item.type === 'button' && text(item).includes(patient.name)).props.onClick;
  h.deferSearch(true);
  h.searchPatient('بحث غير مطابق', false);
  staleSelect(); // An old tap during the same event batch must not select the wrong file.
  h.render();
  const staleResult = h.find(item => item.type === 'button' && text(item).includes(patient.name));
  assert.equal(staleResult.props.disabled, true);
  staleResult.props.onClick(); h.render();
  await h.submit(); assert.equal(h.saved.length, 0); assert.match(h.toasts.at(-1) || '', /اختر ملف المريض/);
  h.deferSearch(false); h.render(); staleSelect(); h.render();
  assert.match(h.content, /لا يوجد ملف مطابق/);
  h.searchPatient(patient.name); h.selectPatient(); h.addCatalogService('حشو اختبار');
  await h.submit(); assert.equal(h.saved.length, 1); assert.equal(h.saved[0].patient.id, patient.id);
});

test('retained patient search selection cannot choose a removed file or operate after dialog close', async () => {
  const h = harness();
  const staleSelect = h.find(item => item.type === 'button' && text(item).includes(patient.name)).props.onClick;
  h.setProps({ isOpen: false }); staleSelect();
  h.setProps({ isOpen: true });
  await h.submit(); assert.equal(h.saved.length, 0); assert.match(h.toasts.at(-1) || '', /اختر ملف المريض/);
  h.setProps({ patients: [] }); staleSelect(); h.render();
  assert.match(h.content, /لا يوجد ملف مطابق/);
  await h.submit(); assert.equal(h.saved.length, 0);
});

test('configured service price is proposed but does not charge examination or prefill cash and omits unselected tooth', async () => {
  const h = harness(); h.selectPatient(); h.addCatalogService('حشو اختبار');
  await h.submit();
  assert.equal(h.saved.length, 1); const visit = h.saved[0].visit;
  assert.equal(visit.totalFee, 600); assert.equal(visit.examinationFee, 0); assert.equal(visit.paidAmount, 0); assert.equal(visit.isPaid, false); assert.equal(visit.paymentMethod, 'cash');
  assert.equal(visit.services[0].price, 600); assert.ok(!Object.hasOwn(visit.services[0], 'tooth')); assert.equal(h.closed, 1);
  assert.equal(h.toasts.at(-1), 'تم حفظ الزيارة دون تسجيل دفعة.');
});

test('one examination button uses the configured price without a manual override or implicit cash and captures a permanent tooth', async () => {
  const h = harness({ defaultExamFee: 125 }); h.selectPatient(); h.toggleExam();
  assert.equal(h.find(item => item.props['aria-label'] === 'تسجيل الكشف').props['aria-pressed'], true);
  h.addCatalogService('حشو اختبار');
  h.change('سعر الخدمة 1', '550'); h.tooth('ur6'); h.input('المدفوع الآن', '150');
  await h.submit(); const visit = h.saved[0].visit;
  assert.equal(visit.examinationFee, 125); assert.equal(visit.treatmentFee, 550); assert.equal(visit.totalFee, 675); assert.equal(visit.paidAmount, 150); assert.equal(visit.discountAmount, 0); assert.equal(visit.services[0].tooth, 'ur6');
  assert.equal(h.toasts.at(-1), 'تم حفظ الزيارة والدفعة المسجلة ضمن تحصيل اليوم.');
  assert.doesNotMatch(h.content, /خصم أو إعفاء/);
});

test('switching to primary teeth clears previous selection and disabling examination removes its charge', async () => {
  const h = harness(); h.selectPatient(); h.toggleExam();
  assert.equal(h.find(item => item.props['aria-label'] === 'تسجيل الكشف').props['aria-pressed'], true);
  h.addCatalogService('حشو اختبار'); h.tooth('lr8'); h.dentition('pediatric');
  assert.deepEqual(h.toothValue(), []);
  assert.equal(h.find(item => item.props.ariaLabel === 'أسنان الخدمة 1').props.dentition, 'pediatric');
  h.tooth('ulA'); h.toggleExam(); await h.submit();
  assert.equal(h.saved[0].visit.examinationFee, 0); assert.equal(h.saved[0].visit.totalFee, 600); assert.equal(h.saved[0].visit.services[0].tooth, 'ulA');
});

test('invalid tooth and overpayment are rejected before save and retain the draft for correction', async () => {
  const h = harness(); h.selectPatient(); h.addCatalogService('حشو اختبار'); h.tooth('zz9'); await h.submit();
  assert.equal(h.saved.length, 0); assert.match(h.toasts.at(-1) || '', /سنًا صحيحًا/);
  h.tooth(''); h.input('المدفوع الآن', '601'); await h.submit(); assert.equal(h.saved.length, 0);
  h.input('المدفوع الآن', '100'); await h.submit(); assert.equal(h.saved.length, 1); assert.ok(!Object.hasOwn(h.saved[0].visit.services[0], 'tooth'));
});

test('pending save blocks duplicate submit and close, failure retains service/tooth and allows explicit retry', async () => {
  let reject!: (error: Error) => void; let calls = 0;
  const pending = new Promise<void>((_, no) => { reject = no; });
  const h = harness({ onSaveWalkInVisit: () => ++calls === 1 ? pending : Promise.resolve() });
  h.selectPatient(); h.addCatalogService('حشو اختبار'); h.tooth('ll4');
  const first = h.submit(); h.render(); await h.submit();
  h.find(item => item.props['aria-label'] === 'إلغاء وإغلاق الزيارة').props.onClick();
  assert.equal(calls, 1); assert.equal(h.closed, 0);
  assert.equal(h.find(item => item.props.role === 'dialog').props['aria-busy'], true);
  reject(new Error('synthetic save failed')); await first; h.render();
  assert.equal(h.closed, 0); assert.deepEqual(h.toothValue(), ['ll4']);
  await h.submit(); assert.equal(calls, 2); assert.equal(h.closed, 1);
});

test('one selection immediately appends without a confirmation button; stale double-click cannot duplicate or save', async () => {
  const h = harness(); h.selectPatient(); h.click('اختيار خدمة من الفهرس');
  const select = h.find(item => item.props['aria-label'] === 'اختيار خدمة حشو اختبار').props.onClick;
  select(); select(); h.render();
  assert.equal(h.find(item => item.props['aria-label'] === 'اسم الخدمة 1').props.value, 'حشو اختبار');
  assert.ok(!h.content.includes('الخدمة 2')); assert.equal(h.saved.length, 0);
  assert.doesNotMatch(h.content, /إضافة الخدمة للمسودة/);
  await h.submit(); assert.equal(h.saved.length, 1); assert.equal(h.saved[0].visit.services.length, 1);
  assert.equal(h.saved[0].visit.examinationFee, 0); assert.equal(h.saved[0].visit.paidAmount, 0); assert.equal(h.saved[0].visit.discountAmount, 0);
});

test('Enter in service search cannot implicitly select or submit the parent visit form', () => {
  const h = harness(); h.selectPatient(); h.click('اختيار خدمة من الفهرس');
  {
    const input = h.find(item => item.props['aria-label'] === 'بحث خدمات الزيارة');
    let prevented = false, stopped = false;
    h.find(item => item.props.className === 'walkin-picker-panel').props.onKeyDown({ key: 'Enter', target: { tagName: String(input.type).toUpperCase() }, preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
    assert.equal(prevented, true); assert.equal(stopped, true); assert.equal(h.saved.length, 0); assert.ok(!h.content.includes('الخدمة 1'));
  }
  h.find(item => item.props.className === 'walkin-picker-panel').props.onKeyDown({ key: 'Escape', target: { tagName: 'INPUT' }, preventDefault() {}, stopPropagation() {} }); h.render();
  assert.equal(h.closed, 0); assert.equal(h.saved.length, 0); assert.ok(!h.content.includes('الخدمة 1'));
});

test('unknown-price service appends immediately with a required blank price, not an invented free charge', async () => {
  const h = harness({ serviceTypes: ['خدمة مجانية', 'خدمة غير مسعّرة'], clinicalPrices: { 'خدمة مجانية': 0 } }); h.selectPatient();
  h.click('اختيار خدمة من الفهرس'); h.find(item => item.props['aria-label'] === 'اختيار خدمة خدمة مجانية').props.onClick(); h.render();
  assert.equal(h.find(item => item.props['aria-label'] === 'سعر الخدمة 1').props.value, 0);
  h.click('اختيار خدمة من الفهرس'); h.find(item => item.props['aria-label'] === 'اختيار خدمة خدمة غير مسعّرة').props.onClick(); h.render();
  assert.equal(h.find(item => item.props['aria-label'] === 'سعر الخدمة 2').props.value, '');
  await h.submit(); assert.equal(h.saved.length, 0); assert.match(h.toasts.at(-1) || '', /اكتب سعر كل خدمة/);
  h.change('سعر الخدمة 2', '300'); await h.submit();
  assert.deepEqual(h.saved[0].visit.services.map((service: any) => service.price), [0, 300]);
  assert.equal(h.saved[0].visit.totalFee, 300); assert.equal(h.saved[0].visit.paidAmount, 0);
});

test('rapid custom-service clicks do not create multiple empty draft rows; a completed custom row permits another intentional row', () => {
  const h = harness();
  const custom = h.find(item => item.type === 'button' && text(item) === 'خدمة أخرى').props.onClick;
  custom(); custom(); h.render();
  assert.equal(h.find(item => item.props['aria-label'] === 'اسم الخدمة 1').props.value, ''); assert.ok(!h.content.includes('الخدمة 2'));
  h.change('اسم الخدمة 1', 'خدمة مخصصة اختبار'); h.change('سعر الخدمة 1', '50'); h.click('خدمة أخرى');
  assert.equal(h.find(item => item.props['aria-label'] === 'اسم الخدمة 2').props.value, ''); assert.equal(h.saved.length, 0);
});
