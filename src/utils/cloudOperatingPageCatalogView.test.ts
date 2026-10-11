import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import CloudOperatingPage from '../components/auth/CloudOperatingPage';
import type { CloudOperatingPageController } from './cloudOperatingPageController';
import type { CloudCatalogWorkspaceController } from './cloudCatalogWorkspaceController';

// Synthetic hook/state contracts only: no browser visual QA, real account,
// Firebase, local clinic storage, patient data or multi-device acceptance.
type Element = { type: unknown; props: Record<string, any> };
const children = (node: any): any[] => node == null ? [] : Array.isArray(node) ? node.flatMap(children) : [node];
const all = (node: any): Element[] => children(node).flatMap(item => item && typeof item === 'object' && item.props
  ? [item, ...all(item.props.children)] : []);
const text = (node: any): string => children(node).map(item => typeof item === 'string' || typeof item === 'number'
  ? String(item) : item?.props ? text(item.props.children) : '').join('');
const OP = '20000000-0000-4000-8000-000000000001';
const LABEL = 'معاينة الخدمات والأسعار';

function hookHarness() {
  const slots: any[] = [], effects: Array<() => void | (() => void)> = [], cleanups: Array<() => void> = [];
  let cursor = 0, tree: any;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const runtime = { hostname: '127.0.0.1', search: '?clinic-cloud=1', assign: () => assert.fail('Unexpected navigation') };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: runtime,
    confirm: () => assert.fail('Empty catalog preview has no draft to discard'),
    get localStorage() { return assert.fail('Catalog preview must not read local prices or records'); },
    get sessionStorage() { return assert.fail('Catalog preview must not read local sessions'); },
  } });
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {
    randomUUID: () => assert.fail('Inert catalog preview must not allocate an operation or service UUID'),
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
  const displayed = () => elements().find(item => typeof item.props.controller?.loadHistory === 'function');
  render(); effects.splice(0).forEach(effect => { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); }); render();
  return { render, button, displayed, elements, runtime,
    parent: () => slots.map(slot => slot?.current).find(value => value?.getCatalogWorkspace) as CloudOperatingPageController,
    ownerView() { const slot = slots.find(value => value?.value?.auth && 'catalog' in value.value);
      assert.ok(slot); slot.value = { ...slot.value, auth: { phase: 'owner-checked', owner: {
        uid: 'synthetic-catalog-page-owner', email: 'catalog-page@example.invalid', identityVersion: 1, verifiedAfter: 100 } } }; render(); },
    cleanup() { cleanups.splice(0).forEach(cleanup => cleanup());
      if (descriptor) Object.defineProperty(globalThis, 'window', descriptor); else Reflect.deleteProperty(globalThis, 'window');
      if (cryptoDescriptor) Object.defineProperty(globalThis, 'crypto', cryptoDescriptor); else Reflect.deleteProperty(globalThis, 'crypto'); },
  };
}

test('catalog design preview opens explicitly without Auth/data/UUID and every retained read/edit/save/recovery action stays inert', async () => {
  const h = hookHarness();
  try {
    assert.equal(h.parent().getState().auth.phase, 'signed-out');
    h.button(LABEL).props.onClick(); h.render(); const displayed = h.displayed(); assert.ok(displayed);
    assert.equal(displayed.props.previewOnly, true);
    const controller = displayed.props.controller as CloudCatalogWorkspaceController;
    assert.equal(controller.getState().snapshot, null); assert.equal(controller.getState().draft, null);
    assert.deepEqual(controller.getState().history, []); assert.equal(controller.getState().loaded, false);
    assert.equal(await controller.load(), false); assert.equal(controller.beginEdit(), false);
    assert.equal(controller.updateDraft({ examinationCents: 10000, services: [] }), false);
    assert.equal(controller.cancelDraft(), false); assert.equal(await controller.save(), false);
    assert.equal(await controller.retry(), false); assert.equal(await controller.cancelPending(), false);
    assert.equal(await controller.resume(OP), false); await controller.loadHistory(); await controller.loadMoreHistory();
    assert.equal(controller.getState().snapshot, null); assert.equal(controller.getState().draft, null);
    assert.equal(controller.getState().loaded, false); assert.equal(controller.getState().historyLoaded, false);
    assert.deepEqual(controller.getState().history, []); assert.equal(h.parent().getCatalogWorkspace(), null);
    assert.equal(h.parent().getState().auth.phase, 'signed-out');
    displayed.props.onClose(); h.render(); assert.equal(h.displayed(), undefined); assert.equal(controller.getState().closed, true);
  } finally { h.cleanup(); }
});

test('catalog design preview is exclusive with all three previews and its stale close cannot dismiss a fresh preview', () => {
  const h = hookHarness();
  try {
    const open = h.button(LABEL).props.onClick;
    const other = ['معاينة الملف السريري وسجل الاسترجاع', 'معاينة واجهة ملفات المرضى', 'معاينة واجهة جهات الاتصال'].map(label => h.button(label).props.onClick);
    open(); h.render(); const old = h.displayed(); assert.ok(old);
    for (const handler of other) handler(); open(); h.render();
    assert.equal(h.displayed()?.props.controller, old.props.controller);
    old.props.onClose(); h.render(); open(); h.render(); const fresh = h.displayed(); assert.ok(fresh);
    assert.notEqual(fresh.props.controller, old.props.controller); old.props.onClose(); h.render();
    assert.equal(h.displayed()?.props.controller, fresh.props.controller); assert.equal(fresh.props.controller.getState().closed, false);
    h.cleanup(); assert.equal(fresh.props.controller.getState().closed, true);
  } finally { h.cleanup(); }
});

test('other design previews also block a retained catalog-preview handler until their own explicit close', () => {
  for (const label of ['معاينة الملف السريري وسجل الاسترجاع', 'معاينة واجهة ملفات المرضى', 'معاينة واجهة جهات الاتصال']) {
    const h = hookHarness();
    try {
      const openCatalog = h.button(LABEL).props.onClick; h.button(label).props.onClick(); h.render();
      const current = h.elements().find(item => item.props.previewOnly && item.props.controller); assert.ok(current);
      openCatalog(); h.render(); assert.equal(h.displayed(), undefined);
      assert.equal(h.elements().find(item => item.props.previewOnly && item.props.controller)?.props.controller, current.props.controller);
      current.props.onClose(); h.render(); openCatalog(); h.render(); assert.ok(h.displayed());
    } finally { h.cleanup(); }
  }
});

test('source-disabled catalog functional callback cannot load a capability even when a disabled button is invoked manually', async () => {
  const h = hookHarness();
  try {
    h.ownerView(); const open = h.button('الخدمات والأسعار غير مفعّلة بعد'); assert.equal(open.props.disabled, true);
    open.props.onClick(); await Promise.resolve(); h.render();
    assert.equal(h.parent().getCatalogWorkspace(), null); assert.equal(h.parent().getState().catalog.phase, 'closed');
    assert.equal(h.parent().getState().auth.phase, 'signed-out'); assert.equal(h.displayed(), undefined);
  } finally { h.cleanup(); }
});

test('catalog preview route fences reject retained handlers after nonloopback/conflicting route and after actual view disposal', () => {
  const h = hookHarness();
  try {
    const open = h.button(LABEL).props.onClick;
    h.runtime.hostname = 'clinic.example.invalid'; open(); h.render(); assert.equal(h.displayed(), undefined);
    h.runtime.hostname = '127.0.0.1'; h.runtime.search = '?clinic-cloud=1&firebase-setup=1'; open(); h.render(); assert.equal(h.displayed(), undefined);
    h.runtime.search = '?clinic-cloud=1'; h.cleanup(); open(); h.render(); assert.equal(h.displayed(), undefined);
  } finally { h.cleanup(); }
});

test('retained sign-in submit cannot initialize Auth underneath an active catalog preview', () => {
  const h = hookHarness();
  try {
    const submit = h.elements().find(item => item.type === 'form')?.props.onSubmit; assert.equal(typeof submit, 'function');
    h.button(LABEL).props.onClick(); h.render(); let prevented = false;
    submit({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true); assert.equal(h.parent().getState().auth.phase, 'signed-out');
    assert.equal(h.parent().getState().pending, false); assert.ok(h.displayed());
  } finally { h.cleanup(); }
});
