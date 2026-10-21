import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const built = buildSync({ stdin: { loader: 'tsx', resolveDir: root, contents: `
  import React from 'react';
  import { renderToStaticMarkup } from 'react-dom/server';
  import { LabView } from './src/components/lab/LabView';
  import { LabPaymentHistory } from './src/components/lab/LabPaymentHistory';
  import { ToastAndConfirmProvider } from './src/components/common/ToastAndConfirm';
  export { LabView, LabPaymentHistory };
  export const render = props => renderToStaticMarkup(<ToastAndConfirmProvider><LabView {...props} /></ToastAndConfirmProvider>);
  export const renderHistory = props => renderToStaticMarkup(<LabPaymentHistory {...props} />);
` }, bundle: true, write: false, platform: 'node', packages: 'external', format: 'cjs', loader: { '.css': 'empty' }, logLevel: 'silent' });
const compiled = { exports: {} as any };
new Function('require', 'module', 'exports', built.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
type Element = { type: any; props: Record<string, any> };
const children = (value: any): any[] => value == null ? [] : Array.isArray(value) ? value.flatMap(children) : [value];
const all = (node: any): Element[] => children(node).flatMap(item => item && typeof item === 'object' && item.props ? [item, ...all(item.props.children)] : []);
const text = (node: any): string => children(node).map(item => typeof item === 'string' || typeof item === 'number' ? String(item) : item?.props ? text(item.props.children) : '').join('');
const caseRecord = (changes: Record<string, unknown> = {}) => ({ id: 'synthetic-case', patientId: '501', patientName: 'مريض مصطنع', fileNo: '501', labId: 'synthetic-lab', labName: 'معمل مصطنع', subType: 'زيركون', type: 'ثابت', units: 2, unitLabel: 'وحدة', labTotal: 1000, labPaid: 350, patientTotal: 9000, patientPaid: 8000, date: '2026-10-01', status: 'pending', paymentsLog: [{ id: 'receipt-old', amount: 150, date: '2026-09-30' }, { id: 'receipt-month', amount: 200, date: '2026-10-10' }], ...changes });
const props = (changes: Record<string, unknown> = {}) => ({ labs: [{ id: 'synthetic-lab', name: 'معمل مصطنع', services: [] }], patients: [], labCases: [caseRecord()], crownPrices: {}, canViewFinancials: true, onBackToHome() {}, onSaveLab() {}, onDeleteLab() {}, onSaveLabCase() {}, onAddLabCasePayment: async () => {}, onBulkPayment: async () => {}, ...changes });
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function harness(changes: Record<string, unknown> = {}) {
  const internals = (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  const slots: any[] = [], saved: any[] = [], messages: string[] = [];
  const initial = props({ onAddLabCasePayment: async (...args: any[]) => { saved.push(args); }, ...changes });
  let tree: Element;
  const context = { showToast: (message: string) => messages.push(message), validationFail: (_modal: string, _field: string, message: string) => messages.push(message), askConfirm() {} };
  const render = () => {
    let cursor = 0;
    const dispatcher = {
      useState(value: any) { const index = cursor++; slots[index] ??= { value: typeof value === 'function' ? value() : value }; return [slots[index].value, (next: any) => { slots[index].value = typeof next === 'function' ? next(slots[index].value) : next; }]; },
      useRef(value: any) { const index = cursor++; return slots[index] ??= { current: value }; },
      useMemo(factory: () => any, deps: any[]) { const index = cursor++; if (!slots[index] || deps.some((dep, j) => !Object.is(dep, slots[index].deps[j]))) slots[index] = { value: factory(), deps }; return slots[index].value; },
      useEffect() { cursor++; }, useContext() { return context; },
    };
    const old = internals.H; internals.H = dispatcher;
    try { tree = compiled.exports.LabView(initial); } finally { internals.H = old; } return tree;
  };
  const find = (predicate: (item: Element) => boolean, scope?: any) => { const match = all(scope ?? tree).find(predicate); assert.ok(match, 'Missing invented lab control'); return match; };
  const click = (label: string) => { find(item => item.type === 'button' && text(item).trim() === label).props.onClick(); render(); };
  const modal = () => find(item => item.props.id === 'labPaymentModal');
  const amount = () => find(item => item.props.id === 'input-lab-payment', modal());
  render();
  return { initial, saved, messages, render, find, click, modal, amount, get tree() { return tree; },
    open() { find(item => item.props.className === 'lab-overview-card').props.onClick(); render(); click('سجل دفعات المعمل'); },
    change(value: string) { amount().props.onChange({ target: { value } }); render(); },
    async submit() { find(item => item.type === 'form', modal()).props.onSubmit({ preventDefault() {} }); await flush(); render(); },
    get hasModal() { return all(tree).some(item => item.props.id === 'labPaymentModal'); },
  };
}

test('actual history SSR shows exact print-safe amounts/date, file context and separate month/cumulative summaries', () => {
  const html = compiled.exports.renderHistory({ cases: [caseRecord()], currentMonth: '2026-10', showCaseDetails: true });
  assert.match(html, /وصل للمعمل حتى الآن/); assert.match(html, /المدفوع هذا الشهر/); assert.match(html, /٣٥٠/); assert.match(html, /٢٠٠/);
  assert.match(html, /dateTime="2026-10-10"/); assert.match(html, /#501/); assert.match(html, /مريض مصطنع/); assert.doesNotMatch(html, /٩٬٠٠٠|٨٬٠٠٠/);
  assert.ok(html.indexOf('2026-10-10') < html.indexOf('2026-09-30'));
});

test('case payment opens with blank explicit cash, current context and real per-case history component', () => {
  const h = harness(); h.open(); assert.equal(h.amount().props.value, ''); assert.equal(h.amount().props.max, 650);
  assert.match(text(h.modal()), /مريض مصطنع.*#501.*زيركون.*معمل مصطنع/);
  const history = h.find(item => item.type === compiled.exports.LabPaymentHistory, h.modal()); assert.equal(history.props.cases[0].id, 'synthetic-case');
});

test('opened case dialog rereads updated props instead of stale paid snapshot', () => {
  const h = harness(); h.open(); h.initial.labCases = [caseRecord({ labPaid: 900 })]; h.render();
  assert.equal(h.amount().props.max, 100);
  const history = h.find(item => item.type === compiled.exports.LabPaymentHistory, h.modal()); assert.equal(history.props.cases[0].labPaid, 900);
});

test('reservation presentation separates whole-file debt settled by general receipts from service-only remainder', () => {
  const patient = { id: '501', sessions: [{ id: 'synthetic-session', amount: 1000, paymentsLog: [{ id: 'session-receipt', amount: 200, date: '2026-10-10' }] }], payments: [{ id: 'general-receipt', amount: 800, date: '2026-10-10', createdAt: '2026-10-10T12:00:00Z' }] };
  const h = harness({ patients: [patient], labCases: [caseRecord({ linkedSessionId: 'synthetic-session' })] });
  h.find(item => item.props.className === 'lab-overview-card').props.onClick(); h.render();
  assert.match(text(h.tree), /متبقي هذه الخدمة قبل الدفعات العامة: 800 ج.م/);
  assert.match(text(h.tree), /المتبقي بإجمالي ملف المريض: 0 ج.م/);
  assert.doesNotMatch(text(h.tree), /المتبقي على المريض:/);
});

test('fully paid cases still expose history, without cash entry or submit controls', () => {
  const h = harness({ labCases: [caseRecord({ labPaid: 1000 })] }); h.open();
  assert.match(text(h.modal()), /تم سداد تكلفة المعمل/); assert.equal(all(h.modal()).some(item => item.props.id === 'input-lab-payment'), false);
  assert.equal(all(h.modal()).some(item => item.type === 'form'), false);
});

test('financially restricted/privacy props never construct history, supplier sums or payment controls', () => {
  const html = compiled.exports.render(props({ canViewFinancials: false }));
  assert.doesNotMatch(html, /سجل دفعات المعمل|وصل للمعمل|المسدّد|٩٬٠٠٠|٨٬٠٠٠|input-lab-payment|lab-payment-history/);
  const h = harness(); h.open(); h.initial.canViewFinancials = false; h.render();
  assert.equal(h.hasModal, false); assert.equal(all(h.tree).some(item => item.type === compiled.exports.LabPaymentHistory), false);
});

test('invalid/subcent and over-remainder submissions retain draft and never call supplier payment callback', async () => {
  const h = harness(); h.open(); h.change('0.001'); await h.submit(); assert.equal(h.saved.length, 0); assert.match(h.messages.at(-1)!, /منزلتين/);
  h.change('651'); await h.submit(); assert.equal(h.saved.length, 0); assert.match(h.messages.at(-1)!, /أكبر/); assert.equal(h.amount().props.value, 651);
  h.change('125'); await h.submit(); assert.equal(h.saved[0][0],'synthetic-case');assert.equal(h.saved[0][1],125);assert.match(h.saved[0][2],/^\d{4}-\d{2}-\d{2}$/);assert.equal(h.saved[0][3],''); assert.equal(h.hasModal, false);
});

test('pending supplier save blocks duplicate submit and close; rejected save retains explicit amount and history', async () => {
  let reject!: (error: Error) => void, calls = 0;
  const pending = new Promise<void>((_, no) => { reject = no; });
  const h = harness({ onAddLabCasePayment: () => ++calls === 1 ? pending : Promise.resolve() });
  h.open(); h.change('75'); await h.submit(); await h.submit(); assert.equal(calls, 1);
  h.click('إلغاء'); assert.equal(h.hasModal, true); reject(new Error('synthetic-save-failed')); await flush(); h.render();
  assert.equal(h.amount().props.value, 75); assert.equal(h.hasModal, true); assert.ok(h.messages.includes('synthetic-save-failed'));
  await h.submit(); assert.equal(calls, 2); assert.equal(h.hasModal, false);
});

test('legacy amount and conflicting log notices stay visible even when full lab history is collapsed', () => {
  const html = compiled.exports.renderHistory({ cases: [caseRecord({ labPaid: 550 })], currentMonth: '2026-10', collapsible: true });
  assert.match(html, /٢٠٠ ج.م من الإجمالي بدون تاريخ/); assert.ok(html.indexOf('بدون تاريخ') < html.indexOf('<details'));
  const conflict = compiled.exports.renderHistory({ cases: [caseRecord({ labPaid: 10 })], currentMonth: '2026-10', collapsible: true }); assert.match(conflict, /role="alert"/);
});
