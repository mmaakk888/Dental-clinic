import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { createCloudWhatsAppWorkspaceController } from './cloudWhatsAppWorkspaceController';
import { createCloudClinicSnapshotReader } from './cloudClinicSnapshot';
import { makeClinicSnapshotFixture, snapshotDigest } from './testing/cloudClinicSnapshotFixtures';

const compiled = await build({ entryPoints: ['src/components/settings/CloudWhatsAppWorkspace.tsx'], bundle: true, write: false,
  metafile: true, platform: 'node', format: 'cjs', logLevel: 'silent', external: ['react', 'react-dom', 'lucide-react'], loader: { '.css': 'empty' } });
const require = createRequire(import.meta.url);
function load(mockHooks = false) {
  const module = { exports: {} };
  const hooks = { ...React, useEffect: () => {}, useRef: (value: unknown) => ({ current: value }),
    useState: (value: unknown) => [typeof value === 'function' ? value() : value, () => {}],
    useSyncExternalStore: (_subscribe: unknown, get: () => unknown) => get() };
  new Function('require', 'module', 'exports', compiled.outputFiles[0].text)((name: string) => mockHooks && name === 'react' ? hooks : require(name), module, module.exports);
  return module.exports as typeof import('../components/settings/CloudWhatsAppWorkspace');
}
const real = load(), direct = load(true);
const all = (node: any): any[] => Array.isArray(node) ? node.flatMap(all) : node && typeof node === 'object' && node.props ? [node, ...all(node.props.children)] : [];
const text = (node: any): string => Array.isArray(node) ? node.map(text).join('') : typeof node === 'string' || typeof node === 'number' ? String(node) : node?.props ? text(node.props.children) : '';
async function harness(loadData = true) {
  const fixture = await makeClinicSnapshotFixture();
  const snapshot = structuredClone(await createCloudClinicSnapshotReader(fixture.adapter, { digest: snapshotDigest }).readFull());
  snapshot.records.patientProfiles[0].data.mobile = '01000000001';
  let reads = 0;
  const controller = createCloudWhatsAppWorkspaceController({ ownerUid: 'synthetic-view-owner', isActive: () => true,
    getSnapshot: async () => { reads++; return { readFull: async () => snapshot }; },
    getSettings: async () => ({ repository: { get: async () => snapshot.settings.clinicSettings } } as any),
    getContacts: async () => { throw Error('NO_WRITES_ON_RENDER'); }, getClinical: async () => { throw Error('NO_CLINICAL_IN_GENERIC'); }, nowMs: () => 1000 });
  if (loadData) await controller.refresh();
  return { controller, snapshot, reads: () => reads };
}

test('SSR is inert; manual API limitations are clear and no delivery success is invented', async () => {
  const h = await harness(false), html = renderToStaticMarkup(React.createElement(real.CloudWhatsAppWorkspace, { controller: h.controller }));
  assert.equal(h.reads(), 0); assert.match(html, /API غير مربوط/); assert.match(html, /لا إرسال تلقائي أو بوت/);
  assert.match(html, /رسائل المرضى/); assert.match(html, /الحملات والمعايدات/); assert.match(html, /موافقات الأرقام/);
  assert.doesNotMatch(html, /تم الإرسال|تم الوصول/);
});

test('unified directory exposes file distinction plus manual call/compose, not hidden financial balances', async () => {
  const h = await harness(), html = renderToStaticMarkup(React.createElement(real.CloudWhatsAppWorkspace, { controller: h.controller }));
  assert.match(html, /ملف 451/); assert.match(html, /رسالة بدون حساب/); assert.match(html, /tel:\+201000000001/);
  assert.match(html, /رسالة ملف/); assert.doesNotMatch(html, /2750\.00|تكلفة المعمل|requestHash/);
});

test('preview hides mistakenly supplied private data and all retained actions stay inert', async () => {
  const h = await harness(); const props = { controller: h.controller, previewOnly: true, onClose: () => { throw Error('NO_PREVIEW_ACTION'); } };
  const html = renderToStaticMarkup(React.createElement(real.CloudWhatsAppWorkspace, props));
  assert.doesNotMatch(html, /مريض مصطنع|451|01000000001|tel:\+|wa.me/);
  for (const row of all(direct.CloudWhatsAppWorkspace(props)).filter(row => row.type === 'button')) row.props.onClick?.();
  assert.equal(h.reads(), 1); assert.equal(h.controller.getState().draft, null);
});

test('old rendered compose callbacks cannot choose a patient after the manager state changes', async () => {
  const h = await harness(), rows = all(direct.CloudWhatsAppWorkspace({ controller: h.controller }));
  const button = rows.find(row => row.type === 'button' && text(row) === 'رسالة بدون حساب'); assert.ok(button);
  h.controller.setQuery('متغير'); button.props.onClick(); assert.equal(h.controller.getState().draft, null);
});

test('native open happens synchronously in its own gesture and consumes exact prepared output once', async () => {
  const h = await harness(); assert.equal(h.controller.beginMessage({ phone: '201000000001', patientRecordId: null, mode: 'individual', templateId: null }), true);
  h.controller.updateDraft({ text: 'تعليمات تمت مراجعتها' }, h.controller.getState().draft!);
  assert.ok(await h.controller.prepareOutput(h.controller.getState().draft!));
  const before = Object.getOwnPropertyDescriptor(globalThis, 'window'); const opened: unknown[][] = [];
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { open: (...args: unknown[]) => { opened.push(args); return {}; } } });
  try {
    const elements = all(direct.CloudWhatsAppWorkspace({ controller: h.controller })), button = elements.find(row => row.type === 'button' && text(row) === 'فتح واتساب'); assert.ok(button);
    button.props.onClick(); assert.equal(opened.length, 1); assert.match(String(opened[0][0]), /^https:\/\/wa.me\/201000000001\?text=/);
    assert.deepEqual(opened[0].slice(1), ['_blank', 'noopener,noreferrer']); button.props.onClick(); assert.equal(opened.length, 1);
  } finally { if (before) Object.defineProperty(globalThis, 'window', before); else Reflect.deleteProperty(globalThis, 'window'); }
});

test('responsive styling uses contained wrapping and respects reduced motion', async () => {
  const css = await readFile('src/components/settings/CloudWhatsAppWorkspace.css', 'utf8');
  assert.match(css, /min-width:0/); assert.match(css, /prefers-reduced-motion/);
  assert.doesNotMatch(css, /overflow-x:\s*(?:auto|scroll)|animation:\s*\S+\s+infinite/);
  assert.doesNotMatch(Object.keys(compiled.metafile!.inputs).join('\n'), /(?:^|\/)(?:storage|firebaseService|authService|App)\.(?:ts|tsx)/m);
});

test('temporary checking blocks a retained native click without consuming the output or disposing its draft', async () => {
  const h = await harness(); h.controller.beginMessage({ phone: '201000000001', patientRecordId: null, mode: 'individual', templateId: null });
  h.controller.updateDraft({ text: 'رسالة' }, h.controller.getState().draft!);
  const output = await h.controller.prepareOutput(h.controller.getState().draft!); assert.ok(output);
  const props = { controller: h.controller, disabled: false };
  const button = all(direct.CloudWhatsAppWorkspace(props)).find(row => row.type === 'button' && text(row) === 'فتح واتساب'); assert.ok(button);
  props.disabled = true; button.props.onClick(); assert.equal(h.controller.getState().output, output); assert.equal(h.controller.getState().closed, false);
  assert.match(renderToStaticMarkup(React.createElement(real.CloudWhatsAppWorkspace, props)), /رسالة/);
});
