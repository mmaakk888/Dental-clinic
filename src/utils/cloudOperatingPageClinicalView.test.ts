import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import CloudOperatingPage from '../components/auth/CloudOperatingPage';
import type { CloudOperatingPageController } from './cloudOperatingPageController';
import type { CloudClinicalWorkspaceBundle } from './cloudClinicalUiStage';

// Synthetic hook/state invocation only: no DOM, real identity, Firebase calls,
// storage, browser visual QA or multi-device claims.
type Element = { type: unknown; props: Record<string, any> };
const children = (node: any): any[] => node == null ? [] : Array.isArray(node) ? node.flatMap(children) : [node];
const all = (node: any): Element[] => children(node).flatMap(item => item && typeof item === 'object' && item.props
  ? [item, ...all(item.props.children)] : []);
const text = (node: any): string => children(node).map(item => typeof item === 'string' || typeof item === 'number'
  ? String(item) : item?.props ? text(item.props.children) : '').join('');

function hookHarness() {
  const slots: any[] = [], effects: Array<() => void | (() => void)> = [], cleanups: Array<() => void> = [];
  let cursor = 0, tree: any;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const runtime = { hostname: '127.0.0.1', search: '?clinic-cloud=1', assign: () => assert.fail('Unexpected navigation') };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: runtime,
    confirm: () => assert.fail('Empty preview has no clinical draft to discard'),
    get localStorage() { return assert.fail('Operating preview must not read local records'); },
    get sessionStorage() { return assert.fail('Operating preview must not read remembered sessions'); },
  } });
  function render() {
    cursor = 0;
    const internals = (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
    const previous = internals.H;
    internals.H = {
      useState(initial: unknown) { const at = cursor++; if (!slots[at]) slots[at] = { value: typeof initial === 'function' ? (initial as () => unknown)() : initial };
        return [slots[at].value, (value: unknown) => { slots[at].value = typeof value === 'function' ? (value as (old: unknown) => unknown)(slots[at].value) : value; }]; },
      useRef(initial: unknown) { const at = cursor++; if (!slots[at]) slots[at] = { current: initial }; return slots[at]; },
      useEffect(effect: () => void | (() => void)) { const at = cursor++; if (!slots[at]) { slots[at] = {}; effects.push(effect); } },
    };
    try { tree = CloudOperatingPage(); return tree; } finally { internals.H = previous; }
  }
  const elements = () => all(tree);
  const button = (label: string) => { const result = elements().find(item => item.type === 'button' && text(item) === label);
    assert.ok(result, `Missing button ${label}`); return result; };
  const displayed = () => elements().find(item => item.props.controller?.file && item.props.controller?.recovery);
  render(); effects.splice(0).forEach(effect => { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); }); render();
  return { render, button, displayed, elements, runtime,
    parent: () => slots.map(slot => slot?.current).find(value => value?.getClinicalWorkspace) as CloudOperatingPageController,
    ownerView() { const slot = slots.find(value => value?.value?.auth && 'clinical' in value.value);
      assert.ok(slot); slot.value = { ...slot.value, auth: { phase: 'owner-checked', owner: {
        uid: 'synthetic-page-owner', email: 'synthetic-page@example.invalid', clinicId: 'main', role: 'owner' } } }; render(); },
    cleanup() { cleanups.splice(0).forEach(cleanup => cleanup());
      if (descriptor) Object.defineProperty(globalThis, 'window', descriptor); else Reflect.deleteProperty(globalThis, 'window'); },
  };
}

test('operating clinical preview opens without Auth or UUID and retained actions stay empty/inert', async () => {
  const h = hookHarness();
  try {
    assert.equal(h.parent().getState().auth.phase, 'signed-out');
    h.button('معاينة الملف السريري وسجل الاسترجاع').props.onClick(); h.render();
    const displayed = h.displayed(); assert.ok(displayed);
    assert.equal(displayed.props.previewOnly, true);
    const bundle = displayed.props.controller as CloudClinicalWorkspaceBundle;
    assert.equal(bundle.file.getState().snapshot, null); assert.deepEqual(bundle.recovery.getState().records, []);
    assert.equal(await bundle.file.open('10000000-0000-4000-8000-000000000001'), false);
    assert.equal(await bundle.file.refresh(), false); assert.equal(await bundle.file.retry(), false);
    assert.equal(await bundle.file.resume('20000000-0000-4000-8000-000000000001'), false);
    await bundle.recovery.loadFirst(); await bundle.recovery.loadMore();
    assert.equal(bundle.file.getState().loaded, false); assert.equal(bundle.recovery.getState().loaded, false);
    assert.equal(h.parent().getClinicalWorkspace(), null);
    assert.equal(h.parent().getState().auth.phase, 'signed-out');
    displayed.props.onClose(); h.render(); assert.equal(h.displayed(), undefined);
    assert.equal(bundle.file.getState().closed, true); assert.equal(bundle.recovery.getState().closed, true);
  } finally { h.cleanup(); }
});

test('clinical design preview is exclusive and its stale close cannot dismiss a fresh preview', () => {
  const h = hookHarness();
  try {
    const openClinical = h.button('معاينة الملف السريري وسجل الاسترجاع').props.onClick;
    const openPatient = h.button('معاينة واجهة ملفات المرضى').props.onClick;
    const openContact = h.button('معاينة واجهة جهات الاتصال').props.onClick;
    openClinical(); h.render(); const old = h.displayed(); assert.ok(old);
    openPatient(); openContact(); openClinical(); h.render();
    assert.equal(h.displayed()?.props.controller, old.props.controller);
    old.props.onClose(); h.render(); openClinical(); h.render();
    const fresh = h.displayed(); assert.ok(fresh); assert.notEqual(fresh.props.controller, old.props.controller);
    old.props.onClose(); h.render(); assert.equal(h.displayed()?.props.controller, fresh.props.controller);
    h.cleanup(); assert.equal(fresh.props.controller.file.getState().closed, true);
    assert.equal(fresh.props.controller.recovery.getState().closed, true);
  } finally { h.cleanup(); }
});

test('source-disabled functional clinical opening rejects manually invoked disabled callbacks', async () => {
  const h = hookHarness();
  try {
    h.ownerView();
    const open = h.button('التشغيل السريري غير مفعّل بعد');
    assert.equal(open.props.disabled, true);
    open.props.onClick(); await Promise.resolve(); h.render();
    assert.equal(h.parent().getClinicalWorkspace(), null);
    assert.equal(h.parent().getState().auth.phase, 'signed-out');
    assert.equal(h.displayed(), undefined);
    assert.equal(h.parent().getState().clinical.phase, 'closed');
  } finally { h.cleanup(); }
});

test('clinical preview callbacks cannot open after actual view disposal or a lost loopback route', () => {
  const h = hookHarness();
  try {
    const open = h.button('معاينة الملف السريري وسجل الاسترجاع').props.onClick;
    h.runtime.hostname = 'clinic.example.invalid'; open(); h.render();
    assert.equal(h.displayed(), undefined);
    h.runtime.hostname = '127.0.0.1'; h.cleanup(); open(); h.render();
    assert.equal(h.displayed(), undefined);
  } finally { h.cleanup(); }
});
