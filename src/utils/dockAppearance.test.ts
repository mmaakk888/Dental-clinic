import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import { DEFAULT_DOCK_APPEARANCE, getDockAppearance, isValidDockAppearance, splitMobileNavigation } from './dockAppearance';
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
    assert.deepEqual(getDockAppearance({ dockAppearance: input }), input);
    assert.notEqual(getDockAppearance({ dockAppearance: input }), input);
  }
  for (const input of [null, [], {}, { ...DEFAULT_DOCK_APPEARANCE, size: 'giant' }, { ...DEFAULT_DOCK_APPEARANCE, showLabels: 0 }, { ...DEFAULT_DOCK_APPEARANCE, mobileVisibleCount: '3' }, { ...DEFAULT_DOCK_APPEARANCE, mobileVisibleCount: 0 }]) assert.equal(isValidDockAppearance(input), false);
  assert.equal(isValidDockAppearance(undefined), true);
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
  const labels = { ...DEFAULT_UI_LABELS, dockAppearance: { size: 'large' as const, showLabels: false, mobileVisibleCount: 3 as const, future: { retained: true } } };
  const draft = { labels, tileOrder: ['lab', 'patients'] };
  const value = validateContentDraft(draft);
  assert.equal(value.valid, true);
  assert.deepEqual(value.value.labels.dockAppearance, labels.dockAppearance);
  assert.notEqual(value.value.labels.dockAppearance, labels.dockAppearance);
  assert.deepEqual(assertClinicBackup({ labels }).labels?.dockAppearance, labels.dockAppearance);
  assert.equal('dockAppearance' in assertClinicBackup({ labels: DEFAULT_UI_LABELS }).labels!, false);
  for (const invalid of [null, [], {}, { ...labels.dockAppearance, size: 'giant' }, { ...labels.dockAppearance, showLabels: 'false' }, { ...labels.dockAppearance, mobileVisibleCount: 9 }]) {
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
    import { ContentPreview } from './src/components/settings/ContentLayout';
    import { DEFAULT_UI_LABELS } from './src/data/initialData';
    import { getDefaultPermissionsForRole } from './src/utils/rbac';
    export function renderDock(appearance, restricted = false, view = 'lab-detail') {
      const user = { id:'dock-test', role: restricted ? 'secretary' : 'doctor', permissions: restricted ? {...getDefaultPermissionsForRole('secretary'), patientView:false, summary:false, lab:false, controlPanel:false} : getDefaultPermissionsForRole('doctor') };
      return renderToStaticMarkup(<MobileBottomNav activeView={view} labels={{...DEFAULT_UI_LABELS,dockAppearance:appearance}} tileOrder={['lab','settings','patients','contacts','summary','appointments']} currentUser={user} onNavigate={()=>{}} />);
    }
    export const renderControls = value => renderToStaticMarkup(<DockAppearanceControls value={value} onChange={()=>{}} />);
    export const renderPreview = (appearance, mode) => renderToStaticMarkup(<ContentPreview draft={{labels:{...DEFAULT_UI_LABELS,dockAppearance:appearance},tileOrder:[]}} clinicName='عيادة تجريبية' mode={mode} onModeChange={()=>{}} />);
  ` }, bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external', loader: { '.css': 'empty' }, logLevel: 'silent',
});
const compiled = { exports: {} as { renderDock: (appearance: DockAppearance, restricted?: boolean, view?: string) => string; renderControls: (appearance: DockAppearance) => string; renderPreview: (appearance: DockAppearance, mode: string) => string } };
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
