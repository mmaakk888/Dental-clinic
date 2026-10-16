import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import type { CloudPrescriptionWorkspaceProps } from '../components/patient/CloudPrescriptionWorkspace';
import type { CloudPrescriptionWorkspaceState } from './cloudPrescriptionWorkspaceController';

// Actual cloud wrapper with a retained-hook harness and inert Rx child. No
// browser data, native dialogs, Firebase, credentials or external services.
const compiled = await build({ entryPoints: ['src/components/patient/CloudPrescriptionWorkspace.tsx'], bundle: true, write: false,
  platform: 'node', format: 'cjs', logLevel: 'silent', external: ['react', 'lucide-react', '../common/ToastAndConfirm', './PrescriptionAndInstructionsView'] });
const require = createRequire(import.meta.url), ID = '90000000-0000-4000-8000-000000000001';
const RxEditor = () => null, Toast = () => null;
const all = (node: any): any[] => Array.isArray(node) ? node.flatMap(all) : node && typeof node === 'object' && node.props ? [node, ...all(node.props.children)] : [];
function harness(hasDocument = true) {
  let cursor = 0; const refs: any[] = [], cleanups: (() => void)[] = [], effects: (() => undefined | (() => void))[] = [];
  const hooks = { ...React, useRef: (initial: unknown) => refs[cursor++] ??= { current: initial },
    useEffect: (work: () => undefined | (() => void)) => { effects.push(work); const cleanup = work(); if (cleanup) cleanups.push(cleanup); },
    useSyncExternalStore: (_subscribe: unknown, get: () => unknown) => get() };
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', compiled.outputFiles[0].text)((name: string) => {
    if (name === 'react') return hooks;
    if (name === '../common/ToastAndConfirm') return { ToastAndConfirmProvider: Toast };
    if (name === './PrescriptionAndInstructionsView') return { PrescriptionAndInstructionsView: RxEditor };
    return require(name);
  }, module, module.exports);
  const document = { patientRecordId: ID, patient: { id: '451', name: 'مصطنع', mobile: '', sessions: [], payments: [] },
    clinicName: 'عيادة مصطنعة', clinicLogo: null, header: { doctorName: '', phone: '', address: '' }, medications: [] };
  let state = { document: hasDocument ? document : null, loading: false, outputPending: false, error: '', closed: false } as CloudPrescriptionWorkspaceState;
  const calls: string[] = []; let beforeAuthorize: (() => Promise<void>) | null = null;
  const controller = { getState: () => state, subscribe: () => () => {},
    authorizeOutput: async (value: unknown) => { assert.equal(value, document); calls.push('prepare'); await beforeAuthorize?.(); },
    assertOutputActive: (value: unknown) => { assert.equal(value, document); calls.push('native-authorize'); },
    discard: (value: unknown) => { assert.equal(value, document); calls.push('discard'); state = { ...state, document: null }; return true; },
    canClose: () => state.document === null,
    load: async () => { calls.push('read'); return true; },
  } as unknown as CloudPrescriptionWorkspaceProps['controller'];
  let props: CloudPrescriptionWorkspaceProps = { controller, patientRecordId: ID, onClose: () => { calls.push('close'); } };
  const render = (patch: Partial<CloudPrescriptionWorkspaceProps> = {}) => { props = { ...props, ...patch }; cursor = 0; return module.exports.default(props); };
  const editor = (node = render()) => all(node).find(row => row.type === RxEditor);
  return { controller, document, calls, render, editor, revoke: () => { state = { ...state, closed: true, document: null }; },
    pending: () => { state = { ...state, outputPending: true }; },
    defer: (work: () => Promise<void>) => { beforeAuthorize = work; }, unmount: () => { cleanups.forEach(work => work()); },
    strictReplay: () => { cleanups.forEach(work => work()); effects.forEach(work => work()); } };
}
test('Rx wrapper construction stays inert and enables native actions only for its explicit loaded document', async () => {
  const h = harness(), child = h.editor(); assert.ok(child); assert.deepEqual(h.calls, []);
  assert.equal(child.props.canPrint, true); assert.equal(child.props.canSendWhatsApp, true);
  await child.props.onPrepareOutput(); child.props.onAuthorizePrint(); child.props.onAuthorizeWhatsappSend();
  assert.deepEqual(h.calls, ['prepare', 'native-authorize', 'native-authorize']);
});
test('temporary checking disables native print/share without unmounting or replacing the Rx editor draft', async () => {
  const h = harness(), before = h.editor(), during = h.editor(h.render({ disabled: true }));
  assert.equal(before.key, during.key); assert.equal(before.props.patient, during.props.patient);
  assert.equal(during.props.canPrint, false); assert.equal(during.props.canSendWhatsApp, false);
  await assert.rejects(before.props.onPrepareOutput()); assert.throws(before.props.onAuthorizePrint); assert.throws(before.props.onAuthorizeWhatsappSend);
  assert.deepEqual(h.calls, []);
  const after = h.editor(h.render({ disabled: false })); assert.equal(after.key, before.key); await after.props.onPrepareOutput();
  assert.deepEqual(h.calls, ['prepare']);
});
test('native output waits for the latest runtime guard after asynchronous preparation', async () => {
  const h = harness(); let resolve!: () => void; h.defer(() => new Promise<void>(done => { resolve = done; }));
  const child = h.editor(), pending = child.props.onPrepareOutput(); h.render({ disabled: true }); resolve();
  await assert.rejects(pending); assert.deepEqual(h.calls, ['prepare']); assert.throws(child.props.onAuthorizePrint);
});
test('retained read and close buttons cannot act during checking or close another mounted controller', () => {
  const h = harness(false), buttons = all(h.render()).filter(row => row.type === 'button'); h.render({ disabled: true });
  for (const button of buttons) button.props.onClick(); assert.deepEqual(h.calls, []);
  const other = harness(false); h.render({ disabled: false, controller: other.controller });
  for (const button of buttons) button.props.onClick(); assert.deepEqual(h.calls, []); assert.deepEqual(other.calls, []);
});
test('actual controller loss, changed target or unmounted view rejects every retained native callback', async () => {
  for (const transition of ['controller', 'target', 'unmount', 'closed'] as const) {
    const h = harness(), child = h.editor();
    if (transition === 'controller') h.render({ controller: harness().controller });
    if (transition === 'target') assert.equal(h.editor(h.render({ patientRecordId: '90000000-0000-4000-8000-000000000002' })), undefined);
    if (transition === 'unmount') h.unmount(); if (transition === 'closed') h.revoke();
    await assert.rejects(child.props.onPrepareOutput()); assert.throws(child.props.onAuthorizePrint); assert.throws(child.props.onAuthorizeWhatsappSend);
    assert.deepEqual(h.calls, []);
  }
});
test('a current output-in-progress state prevents retained buttons or duplicate preparation', async () => {
  const h = harness(), child = h.editor(), close = all(h.render()).find(row => row.type === 'button'); h.pending();
  await assert.rejects(child.props.onPrepareOutput()); assert.throws(child.props.onAuthorizePrint); close.props.onClick(); assert.deepEqual(h.calls, []);
});
test('StrictMode effect replay restores the same live Rx lease instead of disabling every action', async () => {
  const h = harness(), child = h.editor(); h.strictReplay(); await child.props.onPrepareOutput(); child.props.onAuthorizePrint();
  assert.deepEqual(h.calls, ['prepare', 'native-authorize']);
});
