import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HomeLayoutSettings } from '../types';
import { getHomeLayout } from './homeLayout';

// Real components, synthetic settings only. Event inspection is not browser layout QA.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const built = buildSync({
  stdin: { resolveDir: root, loader: 'tsx', contents: `
    import React from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { HomeLayoutControls } from './src/components/settings/HomeLayoutControls';
    import { ContentPreview } from './src/components/settings/ContentLayout';
    import { DEFAULT_UI_LABELS } from './src/data/initialData';
    export const renderControls = (value, disabled = false) => renderToStaticMarkup(<HomeLayoutControls value={value} disabled={disabled} onChange={()=>{}} />);
    export const controls = (value, onChange) => HomeLayoutControls({value, onChange});
    export const preview = (value, mode) => renderToStaticMarkup(<ContentPreview draft={{labels:{...DEFAULT_UI_LABELS,homeLayout:value},tileOrder:[]}} clinicName='عيادة وهمية' mode={mode} onModeChange={()=>{}} />);
  ` }, bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external', loader: { '.css': 'empty' }, logLevel: 'silent',
});
const actualRequire = createRequire(import.meta.url);
const compiled = { exports: {} as {
  renderControls: (value: HomeLayoutSettings, disabled?: boolean) => string;
  controls: (value: HomeLayoutSettings, onChange: (value: HomeLayoutSettings) => void) => any;
  preview: (value: HomeLayoutSettings, mode: 'mobile' | 'desktop') => string;
} };
new Function('require', 'module', 'exports', built.outputFiles[0].text)((name: string) => name === 'react'
  ? { ...actualRequire('react'), useId: () => 'synthetic-home-controls' } : actualRequire(name), compiled, compiled.exports);
const nodes = (element: any): any[] => !element || typeof element !== 'object' ? []
  : [element, ...(Array.isArray(element.props?.children) ? element.props.children.flat(Infinity) : [element.props?.children]).flatMap(nodes)];

test('home controls expose four toggles, bounded spacing/limit choices and safe fixed content explanation', () => {
  const html = compiled.exports.renderControls(getHomeLayout({}));
  assert.equal((html.match(/type="checkbox"/g) || []).length, 4);
  assert.equal((html.match(/checked=""/g) || []).length, 4);
  assert.equal((html.match(/aria-pressed="true"/g) || []).length, 2);
  for (const text of ['إجراءات اليوم', 'مؤشرات اليوم', 'جدول اليوم', 'تنبيهات المتابعة', 'مريحة', 'مدمجة', '٣ مواعيد', '٦ مواعيد', '١٠ مواعيد', 'ثابتان في البداية', 'على هذا المتصفح']) assert.ok(html.includes(text), text);
  assert.equal((compiled.exports.renderControls(getHomeLayout({}), true).match(/disabled=""/g) || []).length >= 3, true);
});

test('home control events produce independent toggle, reorder, density and count drafts', () => {
  const original = getHomeLayout({});
  let next: HomeLayoutSettings | undefined;
  const tree = nodes(compiled.exports.controls(original, value => { next = value; }));
  tree.find(node => node.type === 'input')!.props.onChange();
  assert.deepEqual(next!.hiddenSections, ['actions']);
  assert.deepEqual(original.hiddenSections, []);
  tree.find(node => node.props?.['aria-label'] === 'تقديم جدول اليوم في الرئيسية')!.props.onClick();
  assert.deepEqual(next!.sectionOrder, ['actions', 'schedule', 'metrics', 'followUp']);
  assert.deepEqual(original.sectionOrder, ['actions', 'metrics', 'schedule', 'followUp']);
  tree.find(node => node.type === 'button' && node.props?.children === 'مدمجة')!.props.onClick();
  assert.equal(next!.density, 'compact');
  tree.find(node => node.type === 'button' && Array.isArray(node.props.children) && node.props.children[0] === '١٠')!.props.onClick();
  assert.equal(next!.appointmentLimit, 10);
});

test('preview follows saved display order, hides selected sections and preserves fixed header/search in either size', () => {
  const value: HomeLayoutSettings = { sectionOrder: ['schedule', 'actions', 'metrics', 'followUp'], hiddenSections: ['metrics', 'followUp'], density: 'compact', appointmentLimit: 3 };
  for (const mode of ['mobile', 'desktop'] as const) {
    const html = compiled.exports.preview(value, mode);
    assert.deepEqual([...html.matchAll(/data-home-section="([^"]+)"/g)].map(match => match[1]), ['schedule', 'actions']);
    assert.match(html, /data-home-density="compact"/);
    assert.match(html, /حتى ٣ مواعيد/);
    assert.ok(html.indexOf('بحث بالاسم') < html.indexOf('data-home-section="schedule"'));
    assert.match(html, /بدون بيانات مرضى/);
    assert.match(html, /cl-demo-dock/);
  }
  const minimal = compiled.exports.renderControls({ ...value, hiddenSections: ['actions', 'metrics', 'schedule', 'followUp'] });
  assert.match(minimal, /role="status"/);
  assert.match(minimal, /باقي الوظائف من الشريط العائم/);
});
