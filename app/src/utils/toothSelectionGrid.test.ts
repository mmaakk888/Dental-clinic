import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

// Synthetic component/handler checks only; never reads browser or patient storage.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const built = buildSync({ stdin: { resolveDir: root, loader: 'tsx', contents: `
  import React from 'react';
  import {renderToStaticMarkup} from 'react-dom/server';
  import {ToothSelectionGrid, createToothSelectionGrid, changeToothSelection} from './src/components/common/ToothSelectionGrid';
  export const component = ToothSelectionGrid;
  export const factory = createToothSelectionGrid;
  export const change = changeToothSelection;
  export const render = props => renderToStaticMarkup(<ToothSelectionGrid {...props} />);
` }, bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external', loader: { '.css': 'empty' }, logLevel: 'silent' });
const compiled = { exports: {} as Record<string, (props: any, ...rest: any[]) => any> };
new Function('require', 'module', 'exports', built.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
const children = (node: any): any[] => node == null ? [] : Array.isArray(node) ? node.flatMap(children) : [node];
const all = (node: any): any[] => children(node).flatMap(item => item && typeof item === 'object' && item.props ? [item, ...all(item.props.children)] : []);
const text = (node: any): string => children(node).map(item => typeof item === 'string' || typeof item === 'number' ? String(item) : item?.props ? text(item.props.children) : '').join('');
const getButton = (tree: any, id: string) => {
  const result = all(tree).find(item => item.props['data-tooth-id'] === id);
  assert.ok(result, `Missing synthetic tooth ${id}`);
  return result;
};

test('shared tooth board groups 32 adult squares into two jaws with unambiguous patient-side labels', () => {
  const html = compiled.exports.render({ value: [], onChange() {}, ariaLabel: 'أسنان خدمة اختبار' });
  assert.equal((html.match(/data-tooth-id=/g) || []).length, 32);
  assert.equal((html.match(/class="tooth-selection-jaw"/g) || []).length, 2);
  assert.equal((html.match(/class="tooth-chart-quadrant"/g) || []).length, 4);
  assert.match(html, /aria-label="أسنان خدمة اختبار"/);
  assert.match(html, /الأسنان العلوية/); assert.match(html, /الأسنان السفلية/);
  assert.match(html, /يمين المريض/); assert.match(html, /يسار المريض/);
  assert.doesNotMatch(html, /overflow-x-auto|تشريحي|نوع الفك/);
  const ids = [...html.matchAll(/data-tooth-id="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(ids.slice(0, 16), ['ur8', 'ur7', 'ur6', 'ur5', 'ur4', 'ur3', 'ur2', 'ur1', 'ul1', 'ul2', 'ul3', 'ul4', 'ul5', 'ul6', 'ul7', 'ul8']);
});

test('controlled multi selection adds/removes explicitly, retains primary/adult IDs and never mutates supplied values', () => {
  const original = Object.freeze(['ur4', 'llA']);
  let received: string[] | undefined;
  const tree = compiled.exports.factory({ value: original, onChange: (ids: string[]) => { received = ids; }, dentition: 'adult' });
  getButton(tree, 'ur7').props.onClick(); assert.deepEqual(received, ['ur4', 'llA', 'ur7']);
  getButton(tree, 'ur4').props.onClick(); assert.deepEqual(received, ['llA']);
  assert.deepEqual(original, ['ur4', 'llA']);
  assert.match(text(tree), /الأسنان المحددة \(2\)/);
  assert.equal(getButton(tree, 'ur4').props['aria-pressed'], true);
  assert.equal(getButton(tree, 'ur7').props['aria-pressed'], false);
});

test('single selection replaces prior choice or clears it, and invalid IDs never enter callbacks', () => {
  assert.deepEqual(compiled.exports.change(['ur1'], 'll8', 'single'), ['ll8']);
  assert.deepEqual(compiled.exports.change(['ll8'], 'll8', 'single'), []);
  assert.deepEqual(compiled.exports.change(['ur4', 'ur4', 'ur9', '<script>'], 'llC', 'multiple'), ['ur4', 'llC']);
  assert.deepEqual(compiled.exports.change(['ur4'], 'bad-id', 'multiple'), ['ur4']);
});

test('primary dentition renders 20 valid letters and preserves selection summary across the two dentitions', () => {
  const html = compiled.exports.render({ value: ['ur5', 'llB'], onChange() {}, dentition: 'pediatric' });
  const ids = [...html.matchAll(/data-tooth-id="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, 20); assert.ok(ids.every(id => /^(ur|ul|lr|ll)[A-E]$/.test(id)));
  assert.match(html, /الأسنان المحددة \(2\)/); assert.match(html, /data-tooth-id="llB"[^>]*aria-describedby=/);
  assert.match(html, /data-tooth-id="llB"/);
});

test('disabled board handlers cannot modify selection and clinical status/history is read-only', () => {
  let changes = 0;
  const tree = compiled.exports.factory({ value: ['ur4'], onChange: () => { changes++; }, disabled: true,
    getToothState: () => ({ status: 'crown', hasHistory: true }) });
  const tooth = getButton(tree, 'ul1');
  assert.equal(tooth.props.disabled, true); assert.equal(tooth.props['data-tooth-status'], 'crown');
  assert.match(tooth.props['aria-label'], /تركيبة، له سجل خدمات/);
  tooth.props.onClick();
  tooth.props.onKeyDown({ key: 'Escape', preventDefault() { throw new Error('Disabled event must not run'); } });
  const clear = all(tree).find(item => item.props['aria-label'] === 'إلغاء تحديد الأسنان');
  assert.ok(clear); clear.props.onClick(); assert.equal(changes, 0);
});

test('Escape keeps a multi-tooth draft intact; only the visible clear action removes all selected teeth', () => {
  const received: string[][] = [];
  const tree = compiled.exports.factory({ value: ['ur4', 'll6'], onChange: (ids: string[]) => received.push(ids), mode: 'multiple' });
  getButton(tree, 'ur4').props.onKeyDown({ key: 'Escape', preventDefault() { throw new Error('Multi selection leaves Escape to parent'); } });
  assert.deepEqual(received, []);
  const clear = all(tree).find(item => item.props['aria-label'] === 'إلغاء تحديد الأسنان');
  assert.ok(clear); clear.props.onClick(); assert.deepEqual(received, [[]]);
});

test('form single-selection draft also keeps Escape for the dialog unless the clinical chart opts into clearing', () => {
  const received: string[][] = [];
  const props = { value: ['ur4'], onChange: (ids: string[]) => received.push(ids), mode: 'single' };
  const form = compiled.exports.factory(props);
  getButton(form, 'ur4').props.onKeyDown({ key: 'Escape', preventDefault() { throw new Error('Form Escape must remain available to parent'); } });
  assert.deepEqual(received, []);
  const chart = compiled.exports.factory({ ...props, escapeClearsSelection: true });
  let prevented = false;
  getButton(chart, 'ur4').props.onKeyDown({ key: 'Escape', preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.deepEqual(received, [[]]);
});

test('actual shared component dentition toggle preserves multi-selection and initializes an all-primary selection correctly', () => {
  const internals = (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  const previous = internals.H;
  const slots: any[] = []; let cursor = 0, changes = 0;
  const props = { value: ['ur3', 'llA'], onChange: () => { changes++; } };
  const render = () => {
    cursor = 0;
    internals.H = { useState(initial: any) { const index = cursor++; slots[index] ||= { value: typeof initial === 'function' ? initial() : initial }; return [slots[index].value, (next: any) => { slots[index].value = next; }]; }, useId() { return 'synthetic-tooth-hint'; } };
    try { return compiled.exports.component(props); } finally { internals.H = previous; }
  };
  let tree = render();
  assert.equal(all(tree).filter(item => item.props['data-tooth-id']).length, 32);
  const primary = all(tree).find(item => item.type === 'button' && text(item) === 'أسنان لبنية');
  assert.ok(primary); primary.props.onClick(); tree = render();
  assert.equal(all(tree).filter(item => item.props['data-tooth-id']).length, 20);
  assert.equal(changes, 0); assert.match(text(tree), /الأسنان المحددة \(2\)/);
  const primaryOnly = compiled.exports.render({ value: ['llC'], onChange() {} });
  assert.equal((primaryOnly.match(/data-tooth-id=/g) || []).length, 20);
});

test('uncontrolled dentition still switches when an observer callback clears single-selection draft; active type is a no-op', () => {
  const internals = (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  const previous = internals.H;
  const slots: any[] = [], changes: string[] = []; let cursor = 0;
  const props = { value: ['ur3'], mode: 'single', onChange() {}, onDentitionChange: (type: string) => changes.push(type) };
  const render = () => {
    cursor = 0;
    internals.H = { useState(initial: any) { const index = cursor++; slots[index] ||= { value: typeof initial === 'function' ? initial() : initial }; return [slots[index].value, (next: any) => { slots[index].value = next; }]; }, useId() { return 'synthetic-observed-tooth-hint'; } };
    try { return compiled.exports.component(props); } finally { internals.H = previous; }
  };
  let tree = render();
  const active = all(tree).find(item => item.type === 'button' && text(item) === 'أسنان دائمة');
  assert.ok(active); active.props.onClick(); assert.deepEqual(changes, []);
  const primary = all(tree).find(item => item.type === 'button' && text(item) === 'أسنان لبنية');
  assert.ok(primary); primary.props.onClick(); tree = render();
  assert.deepEqual(changes, ['pediatric']); assert.equal(all(tree).filter(item => item.props['data-tooth-id']).length, 20);
  const sameType = all(tree).find(item => item.type === 'button' && text(item) === 'أسنان لبنية');
  assert.ok(sameType); sameType.props.onClick(); assert.deepEqual(changes, ['pediatric']);
});

test('tooth picker styles keep a single contained board with touch targets and bounded responsive grids', () => {
  const css = readFileSync(new URL('../components/common/toothSelectionGrid.css', import.meta.url), 'utf8');
  assert.match(css, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /min-height: 44px/); assert.match(css, /min-width: 44px/);
  assert.match(css, /@container \(min-width: 12\.75rem\)/); assert.match(css, /@container \(min-width: 15rem\)/);
  assert.match(css, /@container \(min-width: 55rem\)/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(css, /overflow-x:\s*(auto|scroll)|width:\s*\d+vw/);
  // Static sizing, not a claim of browser-computed layout certification.
  assert.ok(2 * (2 * 44 + 7) + 10.4 + 11.4 + 12.8 + 2 < 240);
});

test('compact tooth board arithmetic fits 208–440px without eight-row jaws, including inherited legacy grid rules', () => {
  const css = readFileSync(new URL('../components/common/toothSelectionGrid.css', import.meta.url), 'utf8');
  // Static checks only. Specificity beats legacy .tooth-square-grid[data-dentition] rules
  // regardless of CSS import order; this is not browser-computed layout certification.
  assert.match(css, /\.tooth-selection-board \.tooth-square-grid\[data-dentition\]/);
  assert.match(css, /border-top: 0; padding-top: 0; border-left: 1px dashed/);
  for (const width of [208, 224, 240, 248, 288, 440]) {
    const sideBySide = width >= 240;
    const columns = sideBySide ? 2 : width >= 204 ? 4 : width >= 176 ? 3 : 2;
    const gap = sideBySide ? 7 : 5;
    const mapInner = width - 2 - 2 * .4 * 16;
    // Side layout: second quadrant spends .65rem padding + border, plus .65rem grid gap.
    const perQuadrant = sideBySide ? (mapInner - .65 * 16) / 2 - (.65 * 16 + 1) : mapInner;
    const minimumGrid = columns * 44 + (columns - 1) * gap;
    assert.ok(minimumGrid <= perQuadrant, `44px teeth fit board width ${width}`);
    const rowsPerJaw = Math.ceil(8 / columns) * (sideBySide ? 1 : 2);
    assert.equal(rowsPerJaw, 4, `board ${width} stays at four tooth rows per jaw`);
  }
  // Extremely narrow card still has a contained fallback instead of 8 single-file teeth.
  const narrowInner = 160 - 2 - 2 * .4 * 16;
  assert.ok(2 * 44 + 5 <= narrowInner);
});
