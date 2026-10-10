import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { DEFAULT_WHATSAPP_SETTINGS } from '../data/initialData';

// Actual file-rendering handlers with fabricated records only. This does not
// open a browser, inspect persisted data or assert device/pixel-perfect QA.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const built = buildSync({ stdin: { resolveDir: root, loader: 'tsx', contents: `
  import { PatientFileView } from './src/components/patient/PatientFileView';
  export const component = PatientFileView.type;
` }, bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external', loader: { '.css': 'empty' }, logLevel: 'silent' });
const compiled = { exports: {} as { component: (props: any) => any } };
new Function('require', 'module', 'exports', built.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
const flatten = (value: any): any[] => value == null ? [] : Array.isArray(value) ? value.flatMap(flatten) : [value];
const all = (node: any): any[] => flatten(node).flatMap(item => item && typeof item === 'object' && item.props ? [item, ...all(item.props.children)] : []);
const text = (node: any): string => flatten(node).map(item => typeof item === 'string' || typeof item === 'number' ? String(item) : item?.props ? text(item.props.children) : '').join('');

function selectedPanel(overrides: Record<string, unknown> = {}) {
  const slots: any[] = [];
  const internals = (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  assert.ok(internals && 'H' in internals);
  const longProcedure = 'إجراء اختبار مصطنع طويل يحتاج عرض النص كاملًا دون قص تفاصيل الخدمة';
  const props = {
    patient: { id: '99901', name: 'ملف مصطنع لتجربة التصميم', mobile: '01000000000', age: 36, gender: 'male', notes: '', allergy: '',
      sessions: [{ id: 'fake-layout-session', date: '2026-10-10', type: longProcedure, tooth: 'ur2', amount: 600, paid: 200,
        services: [{ id: 'fake-layout-service', name: longProcedure, price: 600, tooth: 'ur2' }] }], payments: [] },
    origin: 'patients', serviceTypes: ['خدمة اختبار'], labs: [], crownPrices: {}, whatsappSettings: DEFAULT_WHATSAPP_SETTINGS,
    capabilities: { patientEdit: true, viewRemainingBalance: true }, onSaveSession() {}, onAddPaymentInstallment() {},
    onUpdatePatient() {}, onDeletePatient() {}, onBack() {}, ...overrides,
  };
  const render = () => {
    let cursor = 0;
    const prior = internals.H;
    internals.H = {
      useState(initial: any) { const i = cursor++; slots[i] ??= { value: typeof initial === 'function' ? initial() : initial }; return [slots[i].value, (next: any) => { slots[i].value = typeof next === 'function' ? next(slots[i].value) : next; }]; },
      useRef(initial: any) { return slots[cursor++] ??= { current: initial }; },
      useMemo(factory: () => any, deps: any[]) { const i = cursor++; if (!slots[i] || deps.some((dep, index) => !Object.is(dep, slots[i].deps[index]))) slots[i] = { value: factory(), deps }; return slots[i].value; },
      useEffect() { cursor++; }, useId() { cursor++; return 'fabricated-file-layout'; },
      useContext() { return { showToast() {}, askConfirm() {}, validationFail() {} }; },
    };
    try { return compiled.exports.component(props); } finally { internals.H = prior; }
  };
  const tree = render();
  const chart = all(tree).find(item => typeof item.props.onSelectTooth === 'function');
  assert.ok(chart); chart.props.onSelectTooth('ur2');
  const updated = render();
  const panel = all(updated).find(item => item.props.id === 'selected-tooth-panel');
  assert.ok(panel);
  return { tree: updated, panel, longProcedure };
}

test('selected tooth uses one semantic details panel with a real icon and complete procedure/date text', () => {
  const { panel, longProcedure } = selectedPanel();
  assert.equal(panel.type, 'section'); assert.equal(panel.props['aria-label'], 'تفاصيل السن المحدد');
  assert.ok(all(panel).some(item => item.type === 'svg'));
  assert.ok(all(panel).some(item => item.type === 'dl' && item.props.className === 'patient-tooth-stats'));
  assert.ok(all(panel).some(item => item.type === 'time' && item.props.dateTime === '2026-10-10'));
  assert.match(text(panel), new RegExp(longProcedure));
  assert.doesNotMatch(text(panel), /🦷|📅/);
  assert.ok(!all(panel).some(item => /truncate/.test(item.props.className || '')));
  assert.match(text(panel), /ليس تكلفة هذا السن وحده/);
});

test('new tooth design keeps read-only service controls absent and privacy amounts hidden', () => {
  const { panel } = selectedPanel({ isPrivacyMode: true, capabilities: { patientEdit: false, viewRemainingBalance: false } });
  assert.ok(!all(panel).some(item => item.type === 'button' && text(item) === 'تسجيل خدمة'));
  assert.match(text(panel), /الرصيد مخفي/);
  assert.doesNotMatch(text(panel), /٦٠٠|٢٠٠|٤٠٠/);
});

test('selected tooth statistics stay in two columns inside the desktop sidebar and expand only while full width', () => {
  const css = readFileSync(resolve(root, 'src/components/patient/patientFile.css'), 'utf8');
  assert.match(css, /\.patient-tooth-stats \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(min-width: 640px\) and \(max-width: 1279px\)[\s\S]*\.patient-tooth-stats \{ grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.patient-file-action svg \{ width: 20px; height: 20px/);
  assert.match(css, /@media \(prefers-reduced-motion: no-preference\)/);
  assert.doesNotMatch(css, /\.patient-file-action \{ flex-direction: column/);
});
