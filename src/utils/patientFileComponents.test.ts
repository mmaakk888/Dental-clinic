import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { DEFAULT_WHATSAPP_SETTINGS } from '../data/initialData';

// Real component handlers and SSR only. No browser, storage, live account,
// patient records, downloads, cloud calls or visual/device QA.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const built = buildSync({ stdin: { resolveDir: root, loader: 'tsx', contents: `
  import React from 'react';
  import { renderToStaticMarkup } from 'react-dom/server';
  import { PatientFileView } from './src/components/patient/PatientFileView';
  import { PatientFinancialOverview } from './src/components/patient/PatientFinancialOverview';
  import { ToastAndConfirmProvider } from './src/components/common/ToastAndConfirm';
  export const component = PatientFileView.type;
  export const render = props => renderToStaticMarkup(<ToastAndConfirmProvider><PatientFileView {...props} /></ToastAndConfirmProvider>);
  export const renderOverview = props => renderToStaticMarkup(<PatientFinancialOverview {...props} onOpenDetails={()=>{}} />);
` }, bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external', loader: { '.css': 'empty' }, logLevel: 'silent' });
const compiled = { exports: {} as {
  component: (props: any) => any; render: (props: any) => string; renderOverview: (props: any) => string;
} };
new Function('require', 'module', 'exports', built.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
type Element = { type: unknown; props: Record<string, any> };
const children = (value: any): any[] => value == null ? [] : Array.isArray(value) ? value.flatMap(children) : [value];
const all = (node: any): Element[] => children(node).flatMap(item => item && typeof item === 'object' && item.props ? [item, ...all(item.props.children)] : []);
const text = (node: any): string => children(node).map(item => typeof item === 'string' || typeof item === 'number' ? String(item) : item?.props ? text(item.props.children) : '').join('');
const fakePatient = () => ({ id: '501', name: 'مريض اختبار مصطنع', mobile: '01000000000', age: 30, firstVisit: '2026-10-10', notes: '', allergy: '', sessions: [], payments: [] });
const props = (overrides: Record<string, unknown> = {}) => ({ patient: fakePatient(), origin: 'patients',
  serviceTypes: ['تركيبات - ثابتة', 'حشو اختبار', 'علاج عصب اختبار'], clinicalPrices: { 'حشو اختبار': 600, 'علاج عصب اختبار': 900, 'تركيبات - ثابتة': 9999 }, examinationFee: 100,
  crownPrices: { PFM: 1200 }, labs: [], whatsappSettings: structuredClone(DEFAULT_WHATSAPP_SETTINGS),
  capabilities: { patientEdit: true, registerPayment: true, appointments: true, deletePatients: false, rx: true, whatsapp: true, viewRemainingBalance: true, exportData: false },
  onSaveSession: async () => {}, onAddPaymentInstallment: async () => {}, onUpdatePatient: async () => {}, onDeletePatient: async () => {}, onSaveAppointment: async () => {}, onBack: () => {}, ...overrides });
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

/** Invoke the actual memo component with stable deterministic hooks. Effects
 * deliberately do not run: this cannot inspect real browser or persisted data. */
function harness(overrides: Record<string, unknown> = {}) {
  const internals = (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  assert.ok(internals && 'H' in internals);
  const slots: any[] = [], saved: any[] = [], toasts: { message: string; type?: string }[] = [], validations: string[] = [];
  let tree: Element;
  const context = { showToast: (message: string, type?: string) => toasts.push({ message, type }), askConfirm: () => {},
    validationFail: (_modal: string, _field: string, message: string) => validations.push(message) };
  const initial = props({ onSaveSession: async (patientId: string, session: any) => { saved.push({ patientId, session }); }, ...overrides });
  const render = () => {
    let cursor = 0;
    const dispatcher = {
      useState(value: any) { const index = cursor++; slots[index] ??= { value: typeof value === 'function' ? value() : value }; return [slots[index].value, (next: any) => { slots[index].value = typeof next === 'function' ? next(slots[index].value) : next; }]; },
      useRef(value: any) { const index = cursor++; return slots[index] ??= { current: value }; },
      useMemo(factory: () => any, deps: any[]) { const index = cursor++; if (!slots[index] || deps.some((value, index2) => !Object.is(value, slots[index].deps[index2]))) slots[index] = { value: factory(), deps }; return slots[index].value; },
      useEffect() { cursor++; }, useContext() { return context; }, useId() { cursor++; return 'synthetic-patient-file'; },
    };
    const prior = internals.H; internals.H = dispatcher;
    try { tree = compiled.exports.component(initial); } finally { internals.H = prior; }
    return tree;
  };
  const find = (predicate: (item: Element) => boolean, scope?: any) => {
    const found = all(scope ?? tree).find(predicate); assert.ok(found, 'Missing synthetic patient-file control'); return found;
  };
  const modal = () => find(item => item.props.id === 'serviceModal' || item.props.id === 'toothServiceModal');
  const field = (id: string) => find(item => item.props.id === id, modal());
  const change = (id: string, value: string) => { field(id).props.onChange({ target: { value } }); render(); };
  const click = (label: string, scope?: any) => { find(item => item.type === 'button' && text(item).trim() === label, scope).props.onClick(); render(); };
  render();
  return { render, saved, toasts, validations, find, modal, field, change, click, initial,
    open: () => { click('تسجيل خدمة'); },
    openTooth: (tooth: string) => { find(item => typeof item.props.onOpenAddSessionModal === 'function').props.onOpenAddSessionModal(tooth); render(); },
    submit: async () => { find(item => item.type === 'form', modal()).props.onSubmit({ preventDefault() {} }); await flush(); render(); },
    get content() { return text(tree); }, get hasModal() { return all(tree).some(item => item.props.id === 'serviceModal' || item.props.id === 'toothServiceModal'); },
  };
}

test('patient service opens first configured clinical service, with editable suggested price and no automatic exam/payment', async () => {
  const h = harness(); h.open();
  assert.equal(h.field('input-service-type').props.value, 'حشو اختبار');
  assert.equal(h.field('input-service-amount').props.value, 600);
  assert.equal(h.field('input-paid-now').props.value, '');
  assert.match(text(h.modal()), /بدون كشف/);
  assert.ok(!all(h.modal()).some(item => item.props.id === 'input-examination-fee'));
  await h.submit();
  assert.equal(h.saved.length, 1); const session = h.saved[0].session;
  assert.equal(session.type, 'حشو اختبار'); assert.equal(session.amount, 600);
  assert.equal(session.examinationFee, 0); assert.equal(session.paid, 0); assert.equal(session.remain, 600);
  assert.equal(session.paymentMethod, 'cash'); assert.deepEqual(session.paymentsLog, []);
  assert.ok(!Object.hasOwn(session.services[0], 'tooth')); assert.equal(h.hasModal, false);
});

test('changing clinical selection resets the proposed price and manual price/cash overrides are saved explicitly', async () => {
  const h = harness(); h.open(); h.change('input-service-type', 'علاج عصب اختبار');
  assert.equal(h.field('input-service-amount').props.value, 900);
  h.change('input-service-amount', '850'); h.change('input-paid-now', '250');
  await h.submit(); const session = h.saved[0].session;
  assert.equal(session.treatmentFee, 850); assert.equal(session.paid, 250); assert.equal(session.remain, 600);
  assert.equal(session.services[0].price, 850); assert.equal(session.paymentsLog.length, 1);
  assert.equal(session.paymentsLog[0].paymentMethod, 'cash');
});

test('exam is opt-in with configured default100, accepts explicit override, and retains saved zero', async () => {
  const h = harness({ examinationFee: undefined }); h.open(); h.click('إضافة كشف', h.modal());
  assert.equal(h.field('input-examination-fee').props.value, 100);
  h.change('input-examination-fee', '125'); await h.submit();
  assert.equal(h.saved[0].session.examinationFee, 125); assert.equal(h.saved[0].session.amount, 725);
  const zero = harness({ examinationFee: 0 }); zero.open(); zero.click('إضافة كشف', zero.modal());
  assert.equal(zero.field('input-examination-fee').props.value, 0);
  await zero.submit(); assert.equal(zero.saved[0].session.examinationFee, 0); assert.equal(zero.saved[0].session.amount, 600);
});

test('overpayment is rejected without saving or clearing service price', async () => {
  const h = harness(); h.open(); h.change('input-paid-now', '601'); await h.submit();
  assert.equal(h.saved.length, 0); assert.match(h.validations.at(-1) || '', /أكبر من إجمالي/);
  assert.equal(h.field('input-service-amount').props.value, 600); assert.equal(h.hasModal, true);
  h.change('input-paid-now', '100'); await h.submit(); assert.equal(h.saved.length, 1);
});

test('tooth service records its own tooth alongside legacy tooth without altering historical multi-tooth services', async () => {
  const historical = { id: 'history-session', type: 'خدمات متعددة', date: '2026-10-01', amount: 300, paid: 100, tooth: null,
    services: [{ id: 'history-one', name: 'حشو قديم', price: 150, tooth: 'ur2' }, { id: 'history-two', name: 'خلع قديم', price: 150, tooth: 'll4' }] };
  const patient = { ...fakePatient(), sessions: [historical] }, before = structuredClone(patient);
  const h = harness({ patient }); h.openTooth('ulA');
  assert.equal(h.field('input-service-amount').props.value, 600);
  await h.submit(); const session = h.saved[0].session;
  assert.equal(session.tooth, 'ulA'); assert.equal(session.services[0].tooth, 'ulA');
  assert.deepEqual(patient, before);
});

test('pending service save blocks duplicate submit and close; failure retains draft and permits explicit retry', async () => {
  let reject!: (reason: Error) => void, calls = 0;
  const pending = new Promise<void>((_, no) => { reject = no; });
  const h = harness({ onSaveSession: () => ++calls === 1 ? pending : Promise.resolve() }); h.open(); h.change('input-service-amount', '550');
  await h.submit(); await h.submit(); assert.equal(calls, 1);
  assert.equal(h.find(item => item.type === 'fieldset', h.modal()).props.disabled, true);
  h.click('إلغاء وإغلاق', h.modal()); assert.equal(h.hasModal, true);
  reject(new Error('synthetic save rejection')); await flush(); h.render();
  assert.equal(h.hasModal, true); assert.equal(h.field('input-service-amount').props.value, 550);
  assert.equal(h.toasts.some(item => item.type === 'success'), false);
  assert.ok(h.toasts.some(item => item.message === 'synthetic save rejection'));
  await h.submit(); assert.equal(calls, 2); assert.equal(h.hasModal, false);
});

test('patient header has one balance overview, explicit phone links and permission-filtered responsive navigation', () => {
  const html = compiled.exports.render(props());
  assert.equal((html.match(/class="patient-balance"/g) || []).length, 1);
  assert.match(html, /href="tel:01000000000"/);
  assert.match(html, /class="patient-file-tabs" aria-label="أقسام ملف المريض"/);
  assert.doesNotMatch(html, /overflow-x-auto.*patient-file-tabs|ملخص إجمالي العيادة|تكلفة المعمل/);
  const restricted = compiled.exports.render(props({ capabilities: { patientEdit: false, registerPayment: false, appointments: false, rx: false, whatsapp: false, viewRemainingBalance: false } }));
  assert.doesNotMatch(restricted, /class="patient-file-action|class="patient-file-whatsapp|>الروشتات</);
  assert.match(restricted, /المتبقي غير متاح لهذا الحساب/);
});

test('single financial overview hides all totals/progress in privacy and hides debt progress without balance permission', () => {
  const summary = { total: 9731, paid: 3142, remaining: 6589, isPrivacyMode: true, canViewRemainingBalance: true };
  const privacy = compiled.exports.renderOverview(summary);
  assert.match(privacy, /المبالغ مخفية/); assert.doesNotMatch(privacy, /٩|9731|3142|6589|progressbar|aria-valuenow/);
  const restricted = compiled.exports.renderOverview({ ...summary, isPrivacyMode: false, canViewRemainingBalance: false });
  assert.match(restricted, /المتبقي غير متاح لهذا الحساب/); assert.doesNotMatch(restricted, /٦٬٥٨٩|progressbar|aria-valuenow/);
});

test('patient communication buttons stay explicit on mobile and normalize Arabic or international phones without empty links', () => {
  const arabic = compiled.exports.render(props({ patient: { ...fakePatient(), mobile: '٠١٠١٢٣٤٥٦٧٨' } }));
  assert.match(arabic, /href="tel:01012345678"[^>]*class="patient-file-call"/);
  assert.match(arabic, /aria-label="فتح محادثة واتساب مع المريض"/);
  assert.match(arabic, />اتصال<|>واتساب<|>رسالة جاهزة</);
  const international = compiled.exports.render(props({ patient: { ...fakePatient(), mobile: '+447700900123' } }));
  assert.match(international, /href="tel:\+447700900123"/);
  const invalid = compiled.exports.render(props({ patient: { ...fakePatient(), mobile: '٠١٠' } }));
  assert.match(invalid, /رقم التواصل غير مكتمل/);
  assert.doesNotMatch(invalid, /href="tel:|class="patient-file-whatsapp|class="patient-file-message/);
  const empty = compiled.exports.render(props({ patient: { ...fakePatient(), mobile: '' } }));
  assert.match(empty, /لا يوجد رقم تواصل مسجّل/); assert.doesNotMatch(empty, /href="tel:/);
});

test('direct patient WhatsApp chat checks fresh authorization, opens only the canonical phone and does not send clinical data', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const opened: unknown[][] = [];
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { open: (...args: unknown[]) => { opened.push(args); } } });
  try {
    let authorizations = 0;
    const h = harness({ patient: { ...fakePatient(), mobile: '٠١٠١٢٣٤٥٦٧٨' }, onAuthorizeWhatsappSend: (request: unknown) => {
      authorizations++; assert.deepEqual(request, { isCampaign: false, requiresFinance: false });
    } });
    h.find(item => item.props['aria-label'] === 'فتح محادثة واتساب مع المريض').props.onClick();
    assert.equal(authorizations, 1); assert.deepEqual(opened, [['https://wa.me/201012345678', '_blank', 'noopener,noreferrer']]);
    const revoked = harness({ onAuthorizeWhatsappSend: () => { throw new Error('synthetic revoked authorization'); } });
    revoked.find(item => item.props['aria-label'] === 'فتح محادثة واتساب مع المريض').props.onClick();
    assert.equal(opened.length, 1); assert.ok(revoked.toasts.some(item => item.message === 'synthetic revoked authorization'));
    const missingGuard = harness(); missingGuard.find(item => item.props['aria-label'] === 'فتح محادثة واتساب مع المريض').props.onClick();
    assert.equal(opened.length, 1); assert.ok(missingGuard.toasts.some(item => item.type === 'error'));
    const denied = compiled.exports.render(props({ capabilities: { whatsapp: false } }));
    assert.doesNotMatch(denied, /فتح محادثة واتساب|رسالة جاهزة/); assert.match(denied, /href="tel:/);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'window', descriptor); else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('prepared-message action remains available separately and read-only file cannot open a prosthetic mutation from callback presence alone', () => {
  const h = harness(); h.click('رسالة جاهزة');
  assert.ok(h.find(item => item.props.onAuthorizeSend !== undefined || item.props.canViewPatientFinance === true));
  const restricted = compiled.exports.render(props({ onSaveProstheticOrder: async () => {}, capabilities: { patientEdit: false, whatsapp: true } }));
  assert.doesNotMatch(restricted, /تركيبة جديدة|>تسجيل خدمة<|>تحصيل دفعة</);
});

test('file layout pairs identity/account on desktop without fixed heights and keeps labeled touch contact actions on mobile', () => {
  const css = readFileSync(resolve(root, 'src/components/patient/patientFile.css'), 'utf8');
  const html = compiled.exports.render(props());
  assert.match(html, /class="patient-file-overview"[\s\S]*class="patient-file-header"[\s\S]*class="patient-balance"/);
  assert.match(css, /@media \(min-width: 1100px\)[\s\S]*\.patient-file-overview \{ grid-template-columns: minmax\(0, 1\.5fr\) minmax\(340px, \.85fr\)/);
  assert.match(css, /\.patient-file-chart-layout--selected \{ grid-template-columns:/);
  assert.doesNotMatch(css, /\.patient-file-whatsapp span\s*\{\s*display:\s*none/);
  assert.match(css, /\.patient-file-contact-actions > \* \{ min-width: 0; flex: 1 1 0/);
});
