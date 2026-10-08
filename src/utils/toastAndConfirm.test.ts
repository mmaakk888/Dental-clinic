import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { ToastAndConfirmProvider, type ConfirmOptions } from '../components/common/ToastAndConfirm';

type Element = { type: unknown; props: Record<string, any> };
const children = (node: any): any[] => node == null ? [] : Array.isArray(node) ? node.flatMap(children) : [node];
const all = (node: any): Element[] => children(node).flatMap(item => item && typeof item === 'object' && item.props
  ? [item, ...all(item.props.children)] : []);
const text = (node: any): string => children(node).map(item => typeof item === 'string' || typeof item === 'number' ? String(item)
  : item?.props ? text(item.props.children) : '').join('');
const deferred = () => {
  let resolve!: () => void, reject!: (reason: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

/** Exercise the real component's callbacks/effects using deterministic hook slots.
 * No browser, site DOM, storage, data records or reimplementation of its state logic.
 * React 19's dispatcher is swapped only while synchronously calling the component.
 * Synthetic focus/event objects test wiring, not browser layout or accessibility QA.
 */
function harness() {
  const internals = (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  assert.ok(internals && 'H' in internals, 'React 19 test dispatcher must be available');
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const originalTimeout = globalThis.setTimeout;
  const slots: any[] = [], effects: number[] = [];
  let cursor = 0, tree: Element;
  const keys = new Set<(event: any) => void>();
  const trigger = { isConnected: true, focus: () => { fakeDocument.activeElement = trigger; } };
  const fakeDocument = { activeElement: trigger as any, body: { style: { overflow: '' } },
    addEventListener: (name: string, handler: any, capture: boolean) => { if (name === 'keydown') { assert.equal(capture, true); keys.add(handler); } },
    removeEventListener: (name: string, handler: any) => { if (name === 'keydown') keys.delete(handler); },
  };
  let currentControls: any[] = [];
  const sheet = { focusCount: 0, isConnected: true,
    focus() { this.focusCount++; fakeDocument.activeElement = this; },
    querySelectorAll: () => currentControls.filter(control => !control.disabled),
    contains: (element: unknown) => element === sheet || currentControls.includes(element),
  };
  const equalDeps = (a: any[] | undefined, b: any[] | undefined) => !!a && !!b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const dispatcher = {
    useState(initial: any) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, (next: any) => { slots[index].value = typeof next === 'function' ? next(slots[index].value) : next; }];
    },
    useRef(initial: any) { const index = cursor++; return slots[index] ||= { current: initial }; },
    useCallback(callback: any, deps: any[]) {
      const index = cursor++;
      if (!slots[index] || !equalDeps(slots[index].deps, deps)) slots[index] = { value: callback, deps };
      return slots[index].value;
    },
    useEffect(effect: any, deps: any[]) {
      const index = cursor++;
      if (!slots[index] || !equalDeps(slots[index].deps, deps)) {
        slots[index] = { effect, deps, cleanup: slots[index]?.cleanup }; effects.push(index);
      }
    },
  };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: fakeDocument });
  // Toast dismissal timers are irrelevant here and must not delay test completion.
  globalThis.setTimeout = (() => 0) as unknown as typeof setTimeout;
  const render = () => {
    cursor = 0; const previous = internals.H; internals.H = dispatcher;
    try { tree = ToastAndConfirmProvider({ children: null }) as Element; }
    finally { internals.H = previous; }
    const dialog = all(tree).find(element => element.props.role === 'alertdialog');
    currentControls = dialog ? all(dialog).filter(element => element.type === 'button').map(element => ({
      disabled: element.props.disabled, element, isConnected: true,
      focus() { fakeDocument.activeElement = this; },
    })) : [];
    if (dialog?.props.ref) dialog.props.ref.current = sheet;
    while (effects.length) {
      const slot = slots[effects.shift()!]; slot.cleanup?.(); slot.cleanup = slot.effect();
    }
    return dialog;
  };
  render();
  return {
    render,
    askConfirm: (options: ConfirmOptions) => { tree.props.value.askConfirm(options); return render(); },
    cancelConfirm: () => tree.props.value.cancelConfirm(),
    button: (label: string) => {
      const dialog = all(tree).find(element => element.props.role === 'alertdialog');
      const button = all(dialog).find(element => element.type === 'button' && text(element) === label);
      assert.ok(button, `missing confirmation button: ${label}`); return button;
    },
    key: (key: string, shiftKey = false) => {
      const event = { key, shiftKey, prevented: 0, stopped: 0, preventDefault() { this.prevented++; }, stopImmediatePropagation() { this.stopped++; } };
      [...keys].forEach(handler => handler(event)); return event;
    },
    get content() { return text(tree); },
    get document() { return fakeDocument; },
    get sheet() { return sheet; },
    get trigger() { return trigger; },
    get listenerCount() { return keys.size; },
    close: () => {
      slots.forEach(slot => slot?.cleanup?.());
      if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument); else Reflect.deleteProperty(globalThis, 'document');
      globalThis.setTimeout = originalTimeout;
    },
  };
}

test('real confirmation blocks stale Cancel, Escape and duplicate submit while awaiting destructive action, then closes only on success', async () => {
  const h = harness(), pending = deferred(); let calls = 0;
  try {
    h.askConfirm({ title: 'استعادة وهمية', message: 'لا بيانات فعلية', onConfirm: () => { calls++; return pending.promise; } });
    const cancelBeforeBusy = h.button('إلغاء'), confirmBeforeBusy = h.button('تأكيد');
    const first = confirmBeforeBusy.props.onClick();
    // These occur before a re-render: the ref must guard them, not only disabled UI.
    cancelBeforeBusy.props.onClick();
    const escape = h.key('Escape');
    await confirmBeforeBusy.props.onClick();
    const dialog = h.render();
    assert.equal(calls, 1); assert.ok(dialog); assert.equal(dialog.props['aria-busy'], true);
    assert.equal(escape.prevented, 1); assert.equal(escape.stopped, 1);
    assert.equal(h.button('إلغاء').props.disabled, true);
    assert.equal(h.button('جارٍ التنفيذ…').props.disabled, true);
    assert.ok(h.content.includes('بدأ التنفيذ'));
    pending.resolve(); await first;
    assert.equal(h.render(), undefined); assert.equal(h.listenerCount, 0);
    assert.equal(h.document.body.style.overflow, ''); assert.equal(h.document.activeElement, h.trigger);
  } finally { h.close(); }
});

test('real confirmation retains pending request after async error, displays error and permits retry', async () => {
  const h = harness(), failure = deferred(); let calls = 0;
  try {
    h.askConfirm({ title: 'حفظ وهمي', message: 'مسودة محفوظة للمراجعة', onConfirm: () => ++calls === 1 ? failure.promise : Promise.resolve() });
    const first = h.button('تأكيد').props.onClick(); h.render();
    failure.reject(new Error('فشل تخزين تجريبي')); await first;
    const dialog = h.render();
    assert.ok(dialog); assert.equal(dialog.props['aria-busy'], false);
    assert.equal(h.button('إلغاء').props.disabled, false); assert.equal(h.button('تأكيد').props.disabled, false);
    assert.ok(h.content.includes('فشل تخزين تجريبي')); assert.ok(h.content.includes('مسودة محفوظة للمراجعة'));
    await h.button('تأكيد').props.onClick();
    assert.equal(h.render(), undefined); assert.equal(calls, 2);
  } finally { h.close(); }
});

test('real confirmation allows Cancel/Escape before execution without invoking the action', () => {
  const h = harness(); let calls = 0;
  const options = { title: 'اختبار', message: 'بدون كتابة', onConfirm: () => { calls++; } };
  try {
    h.askConfirm(options); h.button('إلغاء').props.onClick(); assert.equal(h.render(), undefined);
    h.askConfirm(options); h.key('Escape'); assert.equal(h.render(), undefined);
    assert.equal(calls, 0); assert.equal(h.document.body.style.overflow, ''); assert.equal(h.listenerCount, 0);
  } finally { h.close(); }
});

test('real confirmation traps Tab on dialog while busy with no enabled controls and restores after external cancellation', async () => {
  const h = harness(), pending = deferred();
  try {
    h.askConfirm({ title: 'عملية وهمية', message: 'اختبار التركيز', onConfirm: () => pending.promise });
    const action = h.button('تأكيد').props.onClick(); h.render();
    h.document.activeElement = h.trigger;
    for (const shift of [false, true]) {
      const event = h.key('Tab', shift);
      assert.equal(event.prevented, 1); assert.equal(event.stopped, 1); assert.equal(h.document.activeElement, h.sheet);
    }
    assert.equal(h.sheet.focusCount, 2);
    // Security invalidation still has an explicit programmatic dismissal path.
    h.cancelConfirm(); assert.equal(h.render(), undefined); assert.equal(h.listenerCount, 0);
    pending.resolve(); await action; assert.equal(h.render(), undefined);
  } finally { h.close(); }
});

test('completion of an older action cannot dismiss a replacement confirmation', async () => {
  const h = harness(), pending = deferred();
  try {
    h.askConfirm({ title: 'قديم', message: 'عملية أولى', onConfirm: () => pending.promise });
    const old = h.button('تأكيد').props.onClick(); h.render();
    h.cancelConfirm(); h.render();
    h.askConfirm({ title: 'جديد', message: 'تأكيد مستقل', onConfirm: () => {} });
    pending.resolve(); await old;
    assert.ok(h.render()); assert.ok(h.content.includes('تأكيد مستقل'));
    h.button('إلغاء').props.onClick(); assert.equal(h.render(), undefined);
  } finally { h.close(); }
});
