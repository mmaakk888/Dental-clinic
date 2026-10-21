import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import React from 'react';
import type { Lab } from '../types';
import type { ProstheticRoutingSettings } from './prostheticRouting';

// Fabricated catalogs only. Import the real component without App hydration,
// browser access, local storage, accounts, Firebase or a real clinical save.
const labs: Lab[] = [
  { id: 'synthetic-lab-a', name: 'معمل اختبار أ', services: [
    { id: 'fixed-pfm', name: 'بورسلين على معدن', category: 'fixed', unitLabel: 'وحدة', price: 250 },
    { id: 'fixed-zircon', name: 'Zircon custom', category: 'fixed', unitLabel: 'وحدة', price: 500 },
    { id: 'removable-a', name: 'طقم تجريبي', category: 'removable', unitLabel: 'طقم', price: 900 },
    { id: 'other-a', name: 'خدمة أخرى مصطنعة', category: 'other', unitLabel: 'وحدة', price: 40 },
  ] },
  { id: 'synthetic-lab-b', name: 'معمل اختبار ب', services: [
    { id: 'fixed-b', name: 'PFM B', category: 'fixed', unitLabel: 'وحدة', price: 300 },
  ] },
];
const materials = ['PFM', 'زيركون', 'طقم كامل'];
const empty = (): ProstheticRoutingSettings => ({ defaultLabs: {}, overrides: [] });
const routed = (): ProstheticRoutingSettings => ({ defaultLabs: { fixed: labs[0].id }, overrides: [{ kind: 'fixed', material: 'PFM', labId: labs[0].id, labServiceId: 'fixed-pfm' }] });
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const built = buildSync({
  stdin: { resolveDir: root, loader: 'tsx', contents: `
    import React from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { ProstheticRoutingManagement } from './src/components/settings/ProstheticRoutingManagement';
    export const component = ProstheticRoutingManagement;
    export const render = props => renderToStaticMarkup(<ProstheticRoutingManagement {...props} />);
  ` }, bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external', loader: { '.css': 'empty' }, logLevel: 'silent',
});
type Props = { value: ProstheticRoutingSettings; labs: Lab[]; materials: string[]; onSave: (value: ProstheticRoutingSettings, baseline: ProstheticRoutingSettings) => void | Promise<void> };
const compiled = { exports: {} as { component: (props: Props) => any; render: (props: Props) => string } };
new Function('require', 'module', 'exports', built.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
const all = (node: any): any[] => node == null ? [] : Array.isArray(node) ? node.flatMap(all) : node?.props ? [node, ...all(node.props.children)] : [];
const text = (node: any): string => node == null ? '' : Array.isArray(node) ? node.map(text).join('') : typeof node === 'string' || typeof node === 'number' ? String(node) : node?.props ? text(node.props.children) : '';

async function withComponent(props: Props, run: (harness: {
  render: () => any;
  setProps: (next: Partial<Props>) => void;
  change: (suffix: string, value: string) => void;
  button: (label: string) => any;
  submit: () => Promise<void>;
}) => void | Promise<void>) {
  const internals = (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  assert.ok(internals && 'H' in internals);
  const previous = internals.H, slots: any[] = [];
  let cursor = 0, updated = false, effects: Array<() => void> = [], current = props, tree: any;
  internals.H = {
    useState(initial: any) { const index = cursor++; if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[index].value, (next: any) => { const value = typeof next === 'function' ? next(slots[index].value) : next; if (!Object.is(value, slots[index].value)) updated = true; slots[index].value = value; }]; },
    useRef(initial: any) { return slots[cursor++] ||= { current: initial }; },
    useId() { cursor++; return 'synthetic-routing'; },
    useEffect(effect: () => void, deps: any[]) { const index = cursor++; const old = slots[index]; if (!old || deps.some((value, key) => !Object.is(value, old.deps[key]))) { slots[index] = { deps }; effects.push(effect); } },
  };
  const render = () => {
    let rounds = 0;
    do { updated = false; cursor = 0; effects = []; tree = compiled.exports.component(current); const pending = effects; effects = []; pending.forEach(effect => effect()); assert.ok(++rounds < 10); } while (updated);
    return tree;
  };
  const button = (label: string) => {
    const found = all(render()).find(node => node.type === 'button' && (node.props['aria-label'] === label || text(node.props.children) === label));
    assert.ok(found, `Missing synthetic button ${label}`); return found;
  };
  const change = (suffix: string, value: string) => {
    const select = all(render()).find(node => node.type === 'select' && node.props.id.endsWith(suffix));
    assert.ok(select, `Missing synthetic select ${suffix}`); select.props.onChange({ target: { value } });
  };
  try { await run({ render, setProps: next => { current = { ...current, ...next }; render(); }, change, button, submit: () => render().props.onSubmit({ preventDefault() {} }) }); }
  finally { internals.H = previous; }
}

test('routing SSR provides labeled private administration, exact category choices and no automatic saves', () => {
  let saves = 0;
  const markup = compiled.exports.render({ value: routed(), labs, materials, onSave: () => { saves++; } });
  assert.equal(saves, 0);
  assert.match(markup, /إدارة خاصة/); assert.match(markup, /لا تغيّر المعمل أو تكلفة أي حالة قديمة/);
  assert.match(markup, /أسعار بيع المريض مستقلة/); assert.match(markup, /لن تُفترض تكلفة صفرية/);
  assert.match(markup, /<label[^>]*for="prosthetic-routing-[^"]*-default-fixed"/);
  assert.match(markup, /value="fixed-pfm" selected=""/); assert.match(markup, /بورسلين على معدن/);
  assert.doesNotMatch(markup, /value="removable-a"|value="other-a"|<table|overflow-x-auto/);
  assert.match(markup, /تكلفة الوحدة الحالية عند المعمل/); assert.match(markup, /<bdi>٢٥٠<\/bdi>/);
});

test('actual default and incomplete override edits stay local until validated awaited save with an isolated baseline', async () => {
  const value = empty(), saves: Array<{ next: ProstheticRoutingSettings; baseline: ProstheticRoutingSettings }> = [];
  await withComponent({ value, labs, materials, onSave: async (next, baseline) => { saves.push({ next: structuredClone(next), baseline: structuredClone(baseline) }); next.defaultLabs.fixed = 'mutated-callback-copy'; } }, async h => {
    h.change('-default-fixed', labs[0].id);
    h.button('إضافة ربط خاص').props.onClick();
    h.change('-0-material', 'PFM'); h.change('-0-lab', labs[0].id); h.change('-0-service', 'fixed-pfm');
    assert.equal(saves.length, 0); assert.deepEqual(value, empty());
    await h.submit(); assert.equal(saves.length, 1);
    assert.deepEqual(saves[0].next, routed()); assert.deepEqual(saves[0].baseline, empty());
    const tree = h.render(); assert.match(text(tree), /تم حفظ ربط التركيبات/);
    assert.equal(all(tree).find(node => node.type === 'select' && node.props.id.endsWith('-default-fixed')).props.value, labs[0].id);
    assert.equal(h.button('حفظ الربط').props.disabled, true);
  });
});

test('actual changing kind or lab clears stale service IDs and filters the new category without guessing a price', async () => {
  await withComponent({ value: routed(), labs, materials, onSave: () => { throw new Error('must-not-save'); } }, async h => {
    h.change('-0-kind', 'removable');
    let tree = h.render();
    let service = all(tree).find(node => node.type === 'select' && node.props.id.endsWith('-0-service'));
    assert.equal(service.props.value, ''); assert.match(text(service), /طقم تجريبي/); assert.doesNotMatch(text(service), /بورسلين/);
    h.change('-0-service', 'removable-a'); h.change('-0-lab', labs[1].id);
    tree = h.render(); service = all(tree).find(node => node.type === 'select' && node.props.id.endsWith('-0-service'));
    assert.equal(service.props.value, ''); assert.equal(service.props.disabled, true);
    assert.match(text(tree), /أضف خدمة من نوع التركيبات المتحركة/);
    await h.submit(); assert.match(text(h.render()), /راجع إعدادات/);
  });
});

test('blank, duplicate and category-mismatched overrides fail before invoking a save', async () => {
  let saves = 0;
  await withComponent({ value: routed(), labs, materials, onSave: () => { saves++; } }, async h => {
    h.button('إضافة ربط خاص').props.onClick(); await h.submit(); assert.equal(saves, 0);
    h.change('-1-material', 'PFM'); h.change('-1-lab', labs[0].id); h.change('-1-service', 'fixed-pfm');
    await h.submit(); assert.equal(saves, 0);
    h.change('-1-material', 'زيركون'); h.change('-1-service', 'removable-a');
    await h.submit(); assert.equal(saves, 0);
    assert.match(text(h.render()), /راجع إعدادات/);
  });
});

test('actual save awaits confirmation, blocks repeated clicks/edits and retains a failed draft for retry', async () => {
  let finish: (() => void) | undefined, fail: ((reason: Error) => void) | undefined, saves = 0;
  const deferred = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
  await withComponent({ value: empty(), labs, materials, onSave: () => { saves++; return saves === 1 ? deferred : Promise.resolve(); } }, async h => {
    h.change('-default-fixed', labs[0].id);
    const first = h.submit(); await h.submit(); assert.equal(saves, 1);
    assert.equal(h.render().props['aria-busy'], true); assert.doesNotMatch(text(h.render()), /تم حفظ ربط/);
    h.change('-default-fixed', labs[1].id);
    assert.equal(all(h.render()).find(node => node.type === 'select' && node.props.id.endsWith('-default-fixed')).props.value, labs[0].id);
    fail!(new Error('synthetic-storage-error')); await first;
    assert.match(text(h.render()), /المسودة موجودة كما هي/); assert.equal(h.button('حفظ الربط').props.disabled, false);
    await h.submit(); assert.equal(saves, 2); assert.match(text(h.render()), /تم حفظ ربط/);
  });
  assert.ok(finish);
});

test('actual incoming settings refresh a clean draft but preserve and block an edited conflicting draft until explicit reload', async () => {
  let saves = 0;
  await withComponent({ value: empty(), labs, materials, onSave: () => { saves++; } }, async h => {
    const latest = { defaultLabs: { removable: labs[0].id }, overrides: [] };
    h.setProps({ value: latest });
    assert.equal(all(h.render()).find(node => node.type === 'select' && node.props.id.endsWith('-default-removable')).props.value, labs[0].id);
    h.change('-default-fixed', labs[0].id);
    h.setProps({ value: { defaultLabs: { fixed: labs[1].id, removable: labs[0].id }, overrides: [] } });
    assert.match(text(h.render()), /مسودتك محفوظة هنا/);
    assert.equal(all(h.render()).find(node => node.type === 'select' && node.props.id.endsWith('-default-fixed')).props.value, labs[0].id);
    await h.submit(); assert.equal(saves, 0); assert.equal(h.button('حفظ الربط').props.disabled, true);
    h.button('تحميل النسخة المحفوظة').props.onClick();
    assert.equal(all(h.render()).find(node => node.type === 'select' && node.props.id.endsWith('-default-fixed')).props.value, labs[1].id);
    assert.doesNotMatch(text(h.render()), /مسودتك محفوظة هنا/);
  });
});

test('incoming newer settings during an awaited save are not replaced with the submitted draft', async () => {
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  await withComponent({ value: empty(), labs, materials, onSave: () => pending }, async h => {
    h.change('-default-fixed', labs[0].id); const saving = h.submit();
    h.setProps({ value: { defaultLabs: { fixed: labs[1].id }, overrides: [] } });
    finish(); await saving; assert.match(text(h.render()), /وصلت إعدادات أحدث أثناء الحفظ/);
    assert.equal(h.button('حفظ الربط').props.disabled, true);
    h.button('تحميل النسخة المحفوظة').props.onClick();
    assert.equal(all(h.render()).find(node => node.type === 'select' && node.props.id.endsWith('-default-fixed')).props.value, labs[1].id);
  });
});

test('routing empty catalogs expose honest blocked choices and scoped mobile-safe CSS', () => {
  const markup = compiled.exports.render({ value: empty(), labs: [], materials: [], onSave: () => {} });
  assert.match(markup, /لا توجد معامل بعد/); assert.match(markup, /أضف خامات التركيبات/);
  assert.match(markup, /disabled=""[^>]*>[^<]*<svg[^>]*[\s\S]*?إضافة ربط خاص/);
  const css = readFileSync(new URL('../components/settings/prostheticRouting.css', import.meta.url), 'utf8');
  assert.match(css, /min-height: 44px/); assert.match(css, /font-size: 16px/);
  assert.match(css, /@media \(max-width: 559px\)/); assert.match(css, /grid-template-columns: minmax\(0, 1fr\)/);
  assert.doesNotMatch(css, /overflow-x:\s*(auto|scroll)|position:\s*fixed|min-width:\s*\d{3}px/);
});
