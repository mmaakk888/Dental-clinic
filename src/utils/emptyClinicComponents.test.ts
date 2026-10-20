import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EmptyClinicCard } from '../components/settings/EmptyClinicCard';
import { ToastAndConfirmProvider, type ConfirmOptions } from '../components/common/ToastAndConfirm';

type Element = { type: unknown; props: Record<string, any> };
const children = (node: any): any[] => node == null ? [] : Array.isArray(node) ? node.flatMap(children) : [node];
const all = (node: any): Element[] => children(node).flatMap(item => item && typeof item === 'object' && item.props ? [item, ...all(item.props.children)] : []);
const text = (node: any): string => children(node).map(item => typeof item === 'string' || typeof item === 'number' ? String(item) : item?.props ? text(item.props.children) : '').join('');
const deferred = () => {
  let resolve!: () => void, reject!: (reason: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const openLabel = 'مراجعة وتأكيد البدء فارغًا';
const confirmLabel = 'حذف بيانات التشغيل المحلية والبدء فارغًا';

/** Render actual card and confirmation-provider callbacks with deterministic
 * hook slots. Effects are not run: no DOM/browser/storage/cloud is accessed.
 * This checks behavior and markup only, not visual layout or real persistence.
 */
function harness(props: { onAuthorize: () => void; onClear: () => Promise<void> }) {
  const internals = (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  assert.ok(internals && 'H' in internals, 'React 19 deterministic hooks must be available');
  const providerSlots: any[] = [], cardSlots: any[] = [];
  let context: any, provider: Element, card: Element, latest: ConfirmOptions | undefined;
  const previousTimeout = globalThis.setTimeout;
  // Do not wait for toast-dismissal timers or alter production provider code.
  globalThis.setTimeout = (() => 0) as unknown as typeof setTimeout;
  const invoke = (component: (props: any) => any, input: any, slots: any[]) => {
    let cursor = 0;
    const dispatcher = {
      useState(initial: any) {
        const index = cursor++;
        if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
        return [slots[index].value, (next: any) => { slots[index].value = typeof next === 'function' ? next(slots[index].value) : next; }];
      },
      useRef(initial: any) { const index = cursor++; return slots[index] ||= { current: initial }; },
      useCallback(callback: any) { cursor++; return callback; },
      useEffect() { cursor++; },
      useContext() { return context; },
    };
    const previous = internals.H; internals.H = dispatcher;
    try { return component(input) as Element; }
    finally { internals.H = previous; }
  };
  const render = () => {
    provider = invoke(ToastAndConfirmProvider, { children: null }, providerSlots);
    const actual = provider.props.value;
    context = { ...actual, askConfirm: (options: ConfirmOptions) => { latest = options; actual.askConfirm(options); } };
    card = invoke(EmptyClinicCard, props, cardSlots);
    return all(provider).find(element => element.props.role === 'alertdialog');
  };
  const button = (label: string, node: any = provider) => {
    const match = all(node).find(element => element.type === 'button' && text(element) === label);
    assert.ok(match, `missing synthetic card/confirmation button: ${label}`); return match;
  };
  render();
  return {
    render,
    open: () => { button(openLabel, card).props.onClick(); return render(); },
    cardButton: () => all(card).find(element => element.type === 'button')!,
    confirmButton: () => button(confirmLabel),
    get confirmation() { return latest; },
    get content() { return text(provider) + text(card); },
    close: () => { globalThis.setTimeout = previousTimeout; },
  };
}

test('empty clinic card is explicit, compact and inert until separately confirmed', () => {
  let authorizationCalls = 0, clearCalls = 0;
  const card = React.createElement(EmptyClinicCard, { onAuthorize: () => { authorizationCalls++; }, onClear: async () => { clearCalls++; } });
  const markup = renderToStaticMarkup(React.createElement(ToastAndConfirmProvider, { children: card }));
  assert.match(markup, /بدء عيادة فارغة/); assert.match(markup, /جهات الاتصال/); assert.match(markup, /المعامل وحالاتها/);
  assert.match(markup, /الجلسات والتحصيلات/); assert.match(markup, /المصروفات وحركات الخامات/);
  assert.match(markup, /حسابات الدخول وكلمات السر/); assert.match(markup, /اسم العيادة وشعارها ومظهرها/);
  assert.match(markup, /فهارس الخدمات والأدوية والأسعار وقوالب الرسائل/);
  assert.match(markup, /نزّل نسخة JSON كاملة أولًا/); assert.match(markup, /لا يكتشف النظام البيانات التجريبية تلقائيًا/);
  assert.match(markup, /الحذف يشمل كل بيانات التشغيل المحلية/); assert.match(markup, /لا يتم الحذف بمجرد فتح هذه البطاقة/);
  assert.match(markup, /لا تُنقل بيانات إلى خدمة خارجية/); assert.match(markup, /min-h-\[44px\]/); assert.match(markup, /w-full/); assert.match(markup, /sm:w-auto/);
  assert.doesNotMatch(markup, /استعادة الضبط الافتراضي|إعادة ضبط البيانات للافتراضي|role="alertdialog"/);
  assert.equal(authorizationCalls, 0); assert.equal(clearCalls, 0);
});

test('opening confirmation reauthorizes without clearing and offers an unambiguous danger action', () => {
  let authorizationCalls = 0, clearCalls = 0;
  const h = harness({ onAuthorize: () => { authorizationCalls++; }, onClear: async () => { clearCalls++; } });
  try {
    assert.ok(h.open()); assert.equal(authorizationCalls, 1); assert.equal(clearCalls, 0);
    assert.equal(h.confirmation?.tone, 'danger'); assert.equal(h.confirmation?.confirmLabel, confirmLabel);
    assert.equal(h.confirmation?.cancelLabel, 'إلغاء والاحتفاظ بالبيانات');
    assert.match(h.confirmation!.message, /سواء كانت تجريبية أو حقيقية/);
    assert.match(h.confirmation!.message, /لا يمكن التراجع إلا باستعادة نسخة محفوظة/);
    assert.match(h.confirmation!.message, /لا تمسح بيانات سحابية/);
  } finally { h.close(); }
});

test('authorization failure when opening prevents both confirmation and clearing without exposing raw errors', () => {
  let clearCalls = 0;
  const h = harness({ onAuthorize: () => { throw new Error('PRIVATE_AUTH_ERROR'); }, onClear: async () => { clearCalls++; } });
  try {
    assert.equal(h.open(), undefined); assert.equal(h.confirmation, undefined); assert.equal(clearCalls, 0);
    assert.match(h.content, /هذه العملية غير متاحة/); assert.doesNotMatch(h.content, /PRIVATE_AUTH_ERROR/);
  } finally { h.close(); }
});

test('confirmation rechecks changed authorization and retains its request on failure', async () => {
  let authorized = true, clearCalls = 0, authorizationCalls = 0;
  const h = harness({ onAuthorize: () => { authorizationCalls++; if (!authorized) throw new Error('PRIVATE_REVOKED_PERMISSION'); }, onClear: async () => { clearCalls++; } });
  try {
    h.open(); authorized = false;
    await h.confirmButton().props.onClick(); assert.ok(h.render());
    assert.equal(authorizationCalls, 2); assert.equal(clearCalls, 0);
    assert.match(h.content, /تعذر تأكيد بدء عيادة فارغة/); assert.doesNotMatch(h.content, /PRIVATE_REVOKED_PERMISSION|تم بدء عيادة فارغة محليًا/);
    authorized = true; await h.confirmButton().props.onClick();
    assert.equal(h.render(), undefined); assert.equal(clearCalls, 1); assert.equal(authorizationCalls, 3);
  } finally { h.close(); }
});

test('real provider and card guard duplicate clicks, await persistence and show success only afterwards', async () => {
  const pending = deferred(); let clearCalls = 0, authorizationCalls = 0;
  const h = harness({ onAuthorize: () => { authorizationCalls++; }, onClear: () => { clearCalls++; return pending.promise; } });
  try {
    const staleOpen = h.cardButton(); h.open(); const staleConfirm = h.confirmButton();
    const first = staleConfirm.props.onClick();
    await staleConfirm.props.onClick(); staleOpen.props.onClick();
    const dialog = h.render();
    assert.ok(dialog); assert.equal(dialog.props['aria-busy'], true); assert.equal(h.cardButton().props.disabled, true);
    assert.equal(clearCalls, 1); assert.equal(authorizationCalls, 2);
    assert.doesNotMatch(h.content, /تم بدء عيادة فارغة محليًا/);
    pending.resolve(); await first;
    assert.equal(h.render(), undefined); assert.equal(h.cardButton().props.disabled, false);
    assert.match(h.content, /تم بدء عيادة فارغة محليًا مع الاحتفاظ بالحسابات والإعدادات والفهارس/);
    assert.equal(clearCalls, 1);
  } finally { h.close(); }
});

test('failed persistence shows no false success, retains confirmation and allows explicit retry', async () => {
  const pending = deferred(); let clearCalls = 0;
  const h = harness({ onAuthorize() {}, onClear: () => ++clearCalls === 1 ? pending.promise : Promise.resolve() });
  try {
    h.open(); const first = h.confirmButton().props.onClick(); h.render();
    pending.reject(new Error('PRIVATE_STORAGE_ERROR')); await first;
    assert.ok(h.render()); assert.equal(h.cardButton().props.disabled, false);
    assert.match(h.content, /لم يُؤكد اكتمال الحذف/); assert.doesNotMatch(h.content, /PRIVATE_STORAGE_ERROR|تم بدء عيادة فارغة محليًا/);
    await h.confirmButton().props.onClick();
    assert.equal(h.render(), undefined); assert.equal(clearCalls, 2); assert.match(h.content, /تم بدء عيادة فارغة محليًا/);
  } finally { h.close(); }
});

test('a synchronous persistence failure also retains the shared confirmation without success', async () => {
  const h = harness({ onAuthorize() {}, onClear: () => { throw new Error('PRIVATE_SYNC_ERROR'); } });
  try {
    h.open(); await h.confirmButton().props.onClick();
    assert.ok(h.render()); assert.match(h.content, /تعذر تأكيد بدء عيادة فارغة/);
    assert.doesNotMatch(h.content, /PRIVATE_SYNC_ERROR|تم بدء عيادة فارغة محليًا/);
  } finally { h.close(); }
});
