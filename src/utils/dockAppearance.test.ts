import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import React from 'react';
import { DEFAULT_DOCK_APPEARANCE, getDockAppearance, isValidDockAppearance, splitDesktopNavigation, splitMobileNavigation } from './dockAppearance';
import { cloneContentDraft, getNavigationItems, validateContentDraft } from './clinicContent';
import { DEFAULT_UI_LABELS } from '../data/initialData';
import { assertClinicBackup, validateClinicBackup } from './backupValidation';
import type { DockAppearance } from '../types';

test('legacy or malformed dock reads use safe defaults without adding settings or mutating input', () => {
  for (const labels of [undefined, null, [], 1, {}, { dockAppearance: null }, { dockAppearance: [] }, { dockAppearance: { size: 'huge', showLabels: 'false', mobileVisibleCount: 100 } }]) {
    const before = JSON.stringify(labels);
    assert.deepEqual(getDockAppearance(labels), DEFAULT_DOCK_APPEARANCE);
    assert.equal(JSON.stringify(labels), before);
  }
  const defaults = getDockAppearance({});
  defaults.size = 'large';
  assert.equal(getDockAppearance({}).size, 'comfortable');
  const legacy = cloneContentDraft({ labels: DEFAULT_UI_LABELS, tileOrder: [] });
  assert.equal('dockAppearance' in legacy.labels, false);
});

test('dock supports all bounded sizes, labels states and mobile counts, with independent copies', () => {
  for (const size of ['compact', 'comfortable', 'large'] as const) for (const showLabels of [false, true]) for (const mobileVisibleCount of [3, 4] as const) {
    const input = { size, showLabels, mobileVisibleCount };
    assert.equal(isValidDockAppearance(input), true);
    assert.deepEqual(getDockAppearance({ dockAppearance: input }), { ...input, moreSections: [] });
    assert.notEqual(getDockAppearance({ dockAppearance: input }), input);
  }
  for (const input of [null, [], {}, { ...DEFAULT_DOCK_APPEARANCE, size: 'giant' }, { ...DEFAULT_DOCK_APPEARANCE, showLabels: 0 }, { ...DEFAULT_DOCK_APPEARANCE, mobileVisibleCount: '3' }, { ...DEFAULT_DOCK_APPEARANCE, mobileVisibleCount: 0 }]) assert.equal(isValidDockAppearance(input), false);
  assert.equal(isValidDockAppearance(undefined), true);
});

test('explicit More preferences accept empty legacy state and known unique keys only, with independent safe read copies', () => {
  assert.equal(isValidDockAppearance({ ...DEFAULT_DOCK_APPEARANCE, moreSections: [] }), true);
  const value = { ...DEFAULT_DOCK_APPEARANCE, moreSections: ['patients', 'summary'] };
  assert.equal(isValidDockAppearance(value), true);
  const parsed = getDockAppearance({ dockAppearance: value });
  assert.deepEqual(parsed.moreSections, ['patients', 'summary']);
  parsed.moreSections!.push('lab'); assert.deepEqual(value.moreSections, ['patients', 'summary']);
  for (const moreSections of [null, 'lab', ['home'], ['secretary-desk'], ['lab', 'lab'], [1], ['unknown']]) {
    assert.equal(isValidDockAppearance({ ...DEFAULT_DOCK_APPEARANCE, moreSections }), false);
  }
  const malformed = { dockAppearance: { ...DEFAULT_DOCK_APPEARANCE, moreSections: ['home', 'lab', 'lab', 'unknown', 1] } };
  assert.deepEqual(getDockAppearance(malformed).moreSections, ['lab']);
  assert.deepEqual(malformed.dockAppearance.moreSections, ['home', 'lab', 'lab', 'unknown', 1]);
});

test('forced More placement applies only on mobile and never backfills explicit More after permission filtering', () => {
  const items = getNavigationItems(DEFAULT_UI_LABELS, []);
  const appearance = { ...DEFAULT_DOCK_APPEARANCE, moreSections: ['patients', 'summary'] };
  const desktop = splitDesktopNavigation(items, appearance), mobile = splitMobileNavigation(items, appearance);
  assert.deepEqual(desktop.extra, []);
  assert.deepEqual(desktop.visible, items);
  assert.deepEqual(mobile.visible.map(item => item.key), ['home', 'contacts', 'appointments', 'lab']);
  assert.deepEqual(mobile.extra.map(item => item.key), ['patients', 'summary', 'settings']);
  assert.equal(new Set([...mobile.visible, ...mobile.extra].map(item => item.key)).size, items.length);
  const restricted = getNavigationItems(DEFAULT_UI_LABELS, [], { controlPanel: false, lab: false, summary: false });
  const restrictedSplit = splitMobileNavigation(restricted, { ...appearance, moreSections: ['patients', 'contacts'] });
  assert.deepEqual(restrictedSplit.visible.map(item => item.key), ['home', 'appointments']);
  assert.deepEqual(restrictedSplit.extra.map(item => item.key), ['patients', 'contacts']);
});

test('all configurable sections can move to More without moving home or losing an allowed link', () => {
  const items = getNavigationItems(DEFAULT_UI_LABELS, []);
  const allMore = { ...DEFAULT_DOCK_APPEARANCE, moreSections: items.filter(item => item.key !== 'home').map(item => item.key) };
  assert.deepEqual(splitMobileNavigation(items, allMore).visible.map(item => item.key), ['home']);
  assert.equal(splitMobileNavigation(items, allMore).extra.length, 6);
  assert.deepEqual(splitDesktopNavigation(items, allMore).visible, items);
  // The safe getter strips a tampered home placement instead of hiding the home link.
  assert.deepEqual(splitMobileNavigation(items, getDockAppearance({ dockAppearance: { ...allMore, moreSections: ['home'] } })).visible.map(item => item.key), items.slice(0, 4).map(item => item.key));
});

test('mobile splitting follows saved order after permission filtering, without dropping any allowed section', () => {
  const order = ['settings', 'lab', 'patients', 'contacts', 'summary', 'appointments'];
  const all = getNavigationItems(DEFAULT_UI_LABELS, order);
  for (const count of [3, 4] as const) {
    const { visible, extra } = splitMobileNavigation(all, { ...DEFAULT_DOCK_APPEARANCE, mobileVisibleCount: count });
    assert.equal(visible[0].key, 'home');
    assert.equal(visible.length, count);
    assert.deepEqual([...visible, ...extra], all);
  }
  const restricted = getNavigationItems(DEFAULT_UI_LABELS, order, { controlPanel: false, lab: false, summary: false, patientView: false });
  assert.deepEqual(splitMobileNavigation(restricted, DEFAULT_DOCK_APPEARANCE), { visible: restricted, extra: [] });
  assert.deepEqual(restricted.map(item => item.key), ['home', 'appointments']);
  assert.equal(all.length, 7);
});

test('content validation and backup preserve dock choices and unknown legacy fields, but reject malformed preferences', () => {
  const labels = { ...DEFAULT_UI_LABELS, dockAppearance: { size: 'large' as const, showLabels: false, mobileVisibleCount: 3 as const, moreSections: ['summary', 'settings'], future: { retained: true } } };
  const draft = { labels, tileOrder: ['lab', 'patients'] };
  const value = validateContentDraft(draft);
  assert.equal(value.valid, true);
  assert.deepEqual(value.value.labels.dockAppearance, labels.dockAppearance);
  assert.notEqual(value.value.labels.dockAppearance, labels.dockAppearance);
  assert.deepEqual(assertClinicBackup({ labels }).labels?.dockAppearance, labels.dockAppearance);
  assert.equal('dockAppearance' in assertClinicBackup({ labels: DEFAULT_UI_LABELS }).labels!, false);
  for (const invalid of [null, [], {}, { ...labels.dockAppearance, size: 'giant' }, { ...labels.dockAppearance, showLabels: 'false' }, { ...labels.dockAppearance, mobileVisibleCount: 9 }, { ...labels.dockAppearance, moreSections: ['home'] }, { ...labels.dockAppearance, moreSections: ['lab', 'lab'] }]) {
    const input = { labels: { ...DEFAULT_UI_LABELS, dockAppearance: invalid }, tileOrder: [] };
    assert.equal(validateContentDraft(input).valid, false);
    assert.ok(validateContentDraft(input).errors.dockAppearance);
    assert.equal(validateClinicBackup({ labels: input.labels }).valid, false);
  }
});

// Actual React markup with CSS ignored only by this test: no browser or stored clinic records.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const built = buildSync({
  stdin: { resolveDir: root, loader: 'tsx', contents: `
    import React from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { MobileBottomNav } from './src/components/navigation/MobileBottomNav';
    import { DockAppearanceControls } from './src/components/settings/DockAppearanceControls';
    import { ContentPreview, ContentLayout } from './src/components/settings/ContentLayout';
    import { ToastAndConfirmProvider } from './src/components/common/ToastAndConfirm';
    import { DEFAULT_UI_LABELS } from './src/data/initialData';
    import { getDefaultPermissionsForRole } from './src/utils/rbac';
    export function renderDock(appearance, restricted = false, view = 'lab-detail') {
      const user = { id:'dock-test', role: restricted ? 'secretary' : 'doctor', permissions: restricted ? {...getDefaultPermissionsForRole('secretary'), patientView:false, summary:false, lab:false, controlPanel:false} : getDefaultPermissionsForRole('doctor') };
      return renderToStaticMarkup(<MobileBottomNav activeView={view} labels={{...DEFAULT_UI_LABELS,dockAppearance:appearance}} tileOrder={['lab','settings','patients','contacts','summary','appointments']} currentUser={user} onNavigate={()=>{}} />);
    }
    export const renderControls = value => renderToStaticMarkup(<DockAppearanceControls value={value} onChange={()=>{}} />);
    export const renderPreview = (appearance, mode) => renderToStaticMarkup(<ContentPreview draft={{labels:{...DEFAULT_UI_LABELS,dockAppearance:appearance},tileOrder:[]}} clinicName='عيادة تجريبية' mode={mode} onModeChange={()=>{}} />);
    export const renderContent = appearance => renderToStaticMarkup(<ToastAndConfirmProvider><ContentLayout labels={{...DEFAULT_UI_LABELS,dockAppearance:appearance}} tileOrder={[]} clinicName='عيادة تجريبية' onSaveContent={()=>{}} /></ToastAndConfirmProvider>);
    export const contentComponent = ContentLayout;
  ` }, bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external', loader: { '.css': 'empty' }, logLevel: 'silent',
});
const compiled = { exports: {} as { renderDock: (appearance: DockAppearance, restricted?: boolean, view?: string) => string; renderControls: (appearance: DockAppearance) => string; renderPreview: (appearance: DockAppearance, mode: string) => string; renderContent: (appearance: DockAppearance) => string; contentComponent: (props: any) => any } };
new Function('require', 'module', 'exports', built.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);

test('real dock applies custom size, labels and count while preserving accessible names and active patient/lab aliases', () => {
  const markup = compiled.exports.renderDock({ size: 'large', showLabels: false, mobileVisibleCount: 3 });
  assert.match(markup, /data-dock-size="large" data-show-labels="false"/);
  assert.equal((markup.match(/clinic-dock-desktop/g) || []).length, 4);
  assert.match(markup, /aria-label="المزيد من الأقسام"/);
  assert.match(markup, /aria-current="page" title="التركيبات" aria-label="التركيبات"/);
  const patientFile = compiled.exports.renderDock(DEFAULT_DOCK_APPEARANCE, false, 'patient-file');
  assert.match(patientFile, /aria-current="page" title="المرضى" aria-label="المرضى"/);
  assert.equal((patientFile.match(/clinic-dock-desktop/g) || []).length, 3);
  const restricted = compiled.exports.renderDock(DEFAULT_DOCK_APPEARANCE, true);
  assert.doesNotMatch(restricted, /clinic-dock-more|title="المرضى"|title="الإعدادات"|title="التركيبات"|title="الماليات"/);
  assert.match(restricted, /aria-label="المواعيد"/);
});

test('real appearance controls expose selected size, checked label toggle and both bounded mobile choices', () => {
  const markup = compiled.exports.renderControls({ size: 'large', showLabels: true, mobileVisibleCount: 3 });
  assert.equal((markup.match(/aria-pressed="true"/g) || []).length, 2);
  assert.match(markup, /type="checkbox" checked=""/);
  for (const text of ['مدمج', 'متوازن', 'كبير', '٣ أقسام + المزيد', '٤ أقسام + المزيد', 'هذا المتصفح']) assert.ok(markup.includes(text), text);
});

test('real dock keeps desktop links and only the mobile preview moves configured links to More', () => {
  const appearance = { ...DEFAULT_DOCK_APPEARANCE, moreSections: ['patients', 'lab'] };
  const dock = compiled.exports.renderDock(appearance);
  assert.doesNotMatch(dock, /clinic-dock-forced-more|has-desktop-more|data-active-desktop="true"/);
  assert.match(dock, /aria-label="المرضى"/); assert.match(dock, /aria-label="التركيبات"/);
  const mobile = compiled.exports.renderPreview(appearance, 'mobile');
  assert.match(mobile, /class="cl-demo-more"/); assert.match(mobile.split('class="cl-demo-more"')[1], /المرضى/);
  assert.doesNotMatch(compiled.exports.renderPreview(appearance, 'desktop'), /class="cl-demo-more"/);
  const restricted = compiled.exports.renderDock(appearance, true);
  assert.doesNotMatch(restricted, /has-desktop-more|clinic-dock-forced-more/);
});

test('content editor exposes explicit location choices per section and a clear rename action without changing permissions', () => {
  const markup = compiled.exports.renderContent({ ...DEFAULT_DOCK_APPEARANCE, moreSections: ['patients'] });
  assert.match(markup, /aria-label="مكان ظهور المرضى"/);
  assert.match(markup, /aria-pressed="true" aria-label="المرضى: داخل المزيد"/);
  assert.match(markup, /aria-label="تغيير اسم المرضى"/);
  assert.match(markup, /داخل المزيد على الموبايل فقط/);
  assert.match(markup, /تغيير الاسم أو الترتيب لا يمنح صلاحيات جديدة/);
});

test('real content placement and rename callbacks keep drafts local until save and persist both More directions', async () => {
  // Deterministic React hook slots, not browser automation or a real storage save.
  const internals = (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  assert.ok(internals && 'H' in internals);
  const previous = internals.H, slots: any[] = [], saved: any[] = [];
  let cursor = 0;
  internals.H = {
    useState(initial: any) { const index = cursor++; if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[index].value, (next: any) => { slots[index].value = typeof next === 'function' ? next(slots[index].value) : next; }]; },
    useRef(initial: any) { return slots[cursor++] ||= { current: initial }; },
    useEffect() {}, useId: () => 'synthetic-content', useContext: () => ({ showToast() {}, askConfirm() {} }),
  };
  const all = (node: any): any[] => node == null ? [] : Array.isArray(node) ? node.flatMap(all) : node?.props ? [node, ...all(node.props.children)] : [];
  const props = { labels: { ...DEFAULT_UI_LABELS, futureSetting: { preserved: true } }, tileOrder: ['patients', 'contacts', 'appointments', 'lab', 'summary', 'settings'], clinicName: 'عيادة تجريبية', onSaveContent: async (value: any) => { saved.push(value); } };
  const render = () => { cursor = 0; return compiled.exports.contentComponent(props); };
  try {
    let tree = render();
    all(tree).find(node => node.props['aria-label'] === 'المرضى: داخل المزيد').props.onClick();
    assert.equal(saved.length, 0);
    tree = render();
    assert.equal(all(tree).find(node => node.props['aria-label'] === 'المرضى: داخل المزيد').props['aria-pressed'], true);
    all(tree).find(node => node.type === 'input' && node.props.id.endsWith('navigationLabels-patients')).props.onChange({ target: { value: 'ملفات العيادة' } });
    tree = render();
    await tree.props.onSubmit({ preventDefault() {} });
    assert.deepEqual(saved[0].labels.dockAppearance.moreSections, ['patients']);
    assert.equal(saved[0].labels.navigationLabels.patients, 'ملفات العيادة');
    assert.deepEqual(saved[0].labels.futureSetting, { preserved: true });
    assert.deepEqual(saved[0].tileOrder, props.tileOrder);
    tree = render();
    all(tree).find(node => node.props['aria-label'] === 'ملفات العيادة: في الشريط').props.onClick();
    tree = render(); await tree.props.onSubmit({ preventDefault() {} });
    assert.deepEqual(saved[1].labels.dockAppearance.moreSections, []);
  } finally { internals.H = previous; }
});

test('real preview reflects both mobile counts, the desktop complete dock and icons-only state', () => {
  const appearance: DockAppearance = { size: 'compact', showLabels: false, mobileVisibleCount: 3 };
  const mobile = compiled.exports.renderPreview(appearance, 'mobile');
  assert.match(mobile, /تاريخ اليوم/);
  assert.match(mobile, /بحث بالاسم أو رقم الملف أو الموبايل/);
  assert.match(mobile, /إجراءات اليوم/);
  assert.doesNotMatch(mobile, /cl-demo-hero|cl-demo-footer/);
  const dock = mobile.match(/class="cl-demo-dock"[\s\S]*?<\/div>/)![0];
  assert.match(dock, /data-dock-size="compact" data-show-labels="false"/);
  assert.equal((dock.match(/<svg /g) || []).length, 4); // 3 direct links + More
  assert.equal((compiled.exports.renderPreview({ ...appearance, mobileVisibleCount: 4 }, 'mobile').match(/class="cl-demo-dock"[\s\S]*?<\/div>/)![0].match(/<svg /g) || []).length, 5);
  const desktop = compiled.exports.renderPreview(appearance, 'desktop');
  assert.equal((desktop.match(/class="cl-demo-dock"[\s\S]*?<\/div>/)![0].match(/<svg /g) || []).length, 7);
  assert.doesNotMatch(desktop, /class="cl-demo-more"/);
});
