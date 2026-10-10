import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import CloudOperatingPage from '../components/auth/CloudOperatingPage';
import type { createCloudContactWorkspaceController } from './cloudContactWorkspaceController';
import type { CloudPatientWorkspaceController } from './cloudPatientWorkspaceController';

type Workspace = ReturnType<typeof createCloudContactWorkspaceController>;
type Element = { type: unknown; props: Record<string, any> };
function elements(node: any): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  return node && typeof node === 'object' && node.props ? [node, ...elements(node.props.children)] : [];
}
function content(node: any): string {
  if (Array.isArray(node)) return node.map(content).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return node?.props ? content(node.props.children) : '';
}

/** Hook/action contract harness, NOT a real browser or live Auth test. */
async function withPage(check: (page: {
  render: () => Element;
  button: (label: string) => Element;
  preview: () => Element;
  unmount: () => void;
}) => Promise<void> | void) {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousFetch = globalThis.fetch;
  let unexpectedReads = 0;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    location: { hostname: '127.0.0.1', search: '?clinic-cloud=1', assign() {} },
    get localStorage() { unexpectedReads++; throw new Error('Synthetic isolation failure'); },
    get sessionStorage() { unexpectedReads++; throw new Error('Synthetic isolation failure'); },
    confirm() { throw new Error('No confirmation expected for empty preview'); },
  } });
  globalThis.fetch = async () => { unexpectedReads++; throw new Error('No request expected in preview'); };
  const internals = (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  const slots: any[] = [], effects: Array<() => void | (() => void)> = [], cleanup: Array<() => void> = [];
  let cursor = 0, tree: Element, unmounted = false;
  function render() {
    cursor = 0;
    const previous = internals.H;
    internals.H = {
      useState(initial: any) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
        return [slots[index], (value: any) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
      },
      useRef(initial: any) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = { current: initial };
        return slots[index];
      },
      useEffect(effect: () => void | (() => void)) {
        const index = cursor++;
        if (!(index in slots)) { slots[index] = true; effects.push(effect); }
      },
    };
    try { tree = CloudOperatingPage() as unknown as Element; }
    finally { internals.H = previous; }
    for (const effect of effects.splice(0)) { const stop = effect(); if (stop) cleanup.push(stop); }
    return tree;
  }
  function button(label: string) {
    const match = elements(render()).find(item => item.type === 'button' && content(item) === label);
    assert.ok(match, `Missing button ${label}`); return match;
  }
  function preview() {
    const match = elements(render()).find(item => item.props.previewOnly === true && item.props.controller);
    assert.ok(match, 'Missing read-only preview component'); return match;
  }
  function unmount() { if (unmounted) return; unmounted = true; cleanup.splice(0).forEach(stop => stop()); }
  try {
    render();
    await check({ render, button, preview, unmount });
    assert.equal(unexpectedReads, 0, 'Preview must not read local records, sessions or network');
  } finally {
    unmount();
    await Promise.resolve();
    globalThis.fetch = previousFetch;
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
}

test('operating entry opens only an empty inert preview without sign-in, local storage or requests', async () => {
  await withPage(async page => {
    const open = page.button('معاينة واجهة جهات الاتصال');
    assert.equal(open.props.disabled, false);
    open.props.onClick();
    const view = page.preview(), controller = view.props.controller as Workspace;
    assert.equal(view.props.previewOnly, true);
    assert.deepEqual(controller.getState().records, []);
    assert.equal(controller.getState().draft, null);
    assert.equal(controller.getState().loaded, false);
    assert.equal(controller.beginCreate(), false);
    await controller.loadFirst(); await controller.loadMore(); await controller.save();
    assert.deepEqual(controller.getState().records, []);
    assert.equal(controller.getState().error, '');
  });
});

test('closing/reopening uses a fresh preview and a retained old close cannot close the current one', async () => {
  await withPage(page => {
    page.button('معاينة واجهة جهات الاتصال').props.onClick();
    const old = page.preview(), oldController = old.props.controller as Workspace;
    old.props.onClose();
    assert.equal(oldController.getState().closed, true);
    page.button('معاينة واجهة جهات الاتصال').props.onClick();
    const fresh = page.preview(), freshController = fresh.props.controller as Workspace;
    assert.notEqual(freshController, oldController);
    old.props.onClose();
    assert.equal(page.preview().props.controller, freshController);
    assert.equal(freshController.getState().closed, false);
  });
});

test('repeated retained preview-open handlers keep one instance and cannot reopen after unmount', async () => {
  await withPage(page => {
    const open = page.button('معاينة واجهة جهات الاتصال');
    open.props.onClick(); const first = page.preview().props.controller as Workspace;
    open.props.onClick();
    assert.equal(page.preview().props.controller, first);
    page.unmount();
    assert.equal(first.getState().closed, true);
    open.props.onClick();
    assert.equal(first.getState().closed, true);
    assert.deepEqual(first.getState().records, []);
  });
});

test('return-to-local action disposes the preview before awaiting session cleanup', async () => {
  await withPage(page => {
    page.button('معاينة واجهة جهات الاتصال').props.onClick();
    const controller = page.preview().props.controller as Workspace;
    page.button(' العودة للنسخة المحلية').props.onClick();
    assert.equal(controller.getState().closed, true);
    assert.equal(controller.getState().draft, null);
  });
});

test('patient preview opens explicitly without Auth, data reads or a draft and all actions remain inert', async () => {
  await withPage(async page => {
    const open = page.button('معاينة واجهة ملفات المرضى');
    assert.equal(open.props.disabled, false);
    open.props.onClick();
    const view = page.preview(), controller = view.props.controller as CloudPatientWorkspaceController;
    assert.equal(view.props.previewOnly, true);
    assert.deepEqual(controller.getState().records, []);
    assert.equal(controller.getState().selected, null);
    assert.equal(controller.getState().draft, null);
    assert.equal(controller.getState().loaded, false);
    assert.equal(controller.beginCreate(), false);
    assert.equal(controller.updateProfile({ name: 'Synthetic preview' }), false);
    await controller.refresh(); await controller.loadMore(); await controller.save();
    await controller.findByFileNo(1); await controller.findByPhone({ mobile: '01000000001' });
    assert.deepEqual(controller.getState().records, []);
    assert.equal(controller.getState().error, '');
  });
});

test('patient preview close/reopen isolates lifetimes and retained close cannot affect a fresh preview', async () => {
  await withPage(page => {
    const retainedOpen = page.button('معاينة واجهة ملفات المرضى');
    retainedOpen.props.onClick();
    const old = page.preview(), oldController = old.props.controller as CloudPatientWorkspaceController;
    retainedOpen.props.onClick();
    assert.equal(page.preview().props.controller, oldController);
    old.props.onClose();
    assert.equal(oldController.getState().closed, true);
    page.button('معاينة واجهة ملفات المرضى').props.onClick();
    const fresh = page.preview(), freshController = fresh.props.controller as CloudPatientWorkspaceController;
    assert.notEqual(freshController, oldController);
    old.props.onClose();
    assert.equal(page.preview().props.controller, freshController);
    assert.equal(freshController.getState().closed, false);
    page.unmount();
    assert.equal(freshController.getState().closed, true);
    retainedOpen.props.onClick();
    assert.equal(freshController.getState().closed, true);
  });
});

test('retained preview opens cannot put patient and contact previews in competing workspaces', async () => {
  await withPage(page => {
    const contactOpen = page.button('معاينة واجهة جهات الاتصال');
    const patientOpen = page.button('معاينة واجهة ملفات المرضى');
    patientOpen.props.onClick();
    const patients = page.preview();
    contactOpen.props.onClick();
    assert.equal(page.preview().props.controller, patients.props.controller);
    patients.props.onClose();
    contactOpen.props.onClick();
    const contacts = page.preview();
    patientOpen.props.onClick();
    assert.equal(page.preview().props.controller, contacts.props.controller);
    contacts.props.onClose();
    patientOpen.props.onClick();
    assert.notEqual(page.preview().props.controller, contacts.props.controller);
  });
});

test('return-to-local disposes the patient preview before asynchronous session cleanup', async () => {
  await withPage(page => {
    page.button('معاينة واجهة ملفات المرضى').props.onClick();
    const controller = page.preview().props.controller as CloudPatientWorkspaceController;
    page.button(' العودة للنسخة المحلية').props.onClick();
    assert.equal(controller.getState().closed, true);
    assert.equal(controller.getState().draft, null);
    assert.deepEqual(controller.getState().records, []);
  });
});
