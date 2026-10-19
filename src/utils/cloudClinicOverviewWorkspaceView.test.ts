import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { createCloudClinicOverviewController } from './cloudClinicOverviewController';
import { createCloudClinicSnapshotReader } from './cloudClinicSnapshot';
import { makeClinicSnapshotFixture, snapshotDigest, snapshotId, SNAPSHOT_WHEN } from './testing/cloudClinicSnapshotFixtures';
import type { CloudClinicOverviewWorkspaceViewProps } from '../components/summary/CloudClinicOverviewWorkspace';

const compiled = await build({ entryPoints: ['src/components/summary/CloudClinicOverviewWorkspace.tsx'], bundle: true, write: false,
  metafile: true, platform: 'node', format: 'cjs', logLevel: 'silent', external: ['react', 'react-dom', 'lucide-react'], loader: { '.css': 'empty' } });
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { CloudClinicOverviewWorkspace, CloudClinicOverviewWorkspaceView } = module.exports as typeof import('../components/summary/CloudClinicOverviewWorkspace');
const DAY = '2026-10-13';
async function view(tab: 'home' | 'directory' | 'finance' | 'export' = 'home') {
  const fixture = await makeClinicSnapshotFixture(), snapshot = await createCloudClinicSnapshotReader(fixture.adapter, { digest: snapshotDigest }).readFull();
  // Separate synthetic display records: no production reads/writes.
  const withPhone = structuredClone(snapshot); withPhone.records.patientProfiles[0].data.mobile = '01000000001';
  withPhone.records.contactRecords.push({ schemaVersion: 1, clinicId: 'main', recordId: snapshotId(100), revision: 1, lastOperationId: snapshotId(999),
    deleted: false, phoneKey: 'a'.repeat(64), data: { id: snapshotId(100), name: 'جهة اتصال بلا ملف مصطنعة', mobile: '01100000002', createdAt: SNAPSHOT_WHEN } });
  let calls = 0; const controller = createCloudClinicOverviewController({ initialDate: DAY, isActive: () => true,
    getSnapshot: async () => { calls++; return { readFull: async () => withPhone }; } });
  await controller.refresh(); controller.setTab(tab);
  const events: string[] = [], props: CloudClinicOverviewWorkspaceViewProps = { state: controller.getState(),
    onRefresh: () => events.push('refresh'), onTab: value => events.push(value), onRange: (from, to) => events.push(`${from}/${to}`),
    onQuery: value => events.push(`query:${value}`), onFilter: value => events.push(`filter:${value}`), onMoreDirectory: () => events.push('more-directory'),
    onMoreCash: () => events.push('more-cash'), onExport: value => events.push(value), onClose: () => events.push('close'),
    onOpenPatient: value => events.push(`patient:${value}`), onNavigate: value => events.push(`navigate:${value}`), onContact: () => events.push('contact') };
  return { controller, props, events, calls: () => calls, html: () => renderToStaticMarkup(React.createElement(CloudClinicOverviewWorkspaceView, props)) };
}
type Element = { type: unknown; props: Record<string, any> };
const all = (node: any): Element[] => Array.isArray(node) ? node.flatMap(all) : node && typeof node === 'object' && node.props ? [node, ...all(node.props.children)] : [];
const text = (node: any): string => Array.isArray(node) ? node.map(text).join('') : typeof node === 'string' || typeof node === 'number' ? String(node) : node?.props ? text(node.props.children) : '';
test('SSR constructor/mount remain inert and do not initialize any data adapter', () => {
  let calls = 0; const controller = createCloudClinicOverviewController({ initialDate: DAY, isActive: () => true,
    getSnapshot: async () => { calls++; throw new Error('MUST_NOT_RUN'); } });
  const html = renderToStaticMarkup(React.createElement(CloudClinicOverviewWorkspace, { controller, onOpenPatient: () => {} }));
  assert.equal(calls, 0); assert.match(html, /ابدأ بتحديث البيانات/); assert.match(html, /فتح الصفحة لا يقرأ البيانات تلقائيًا/);
  assert.doesNotMatch(html, /0\.00 ج.م/);
});
test('home has clear complete snapshot date, cash-not-profit labels and existing quick routes', async () => {
  const h = await view(), html = h.html(); assert.match(html, /آخر نسخة مؤكدة/); assert.match(html, /بتوقيت القاهرة/);
  assert.match(html, /ليس صافي الربح/); assert.match(html, /ملف مريض جديد/); assert.match(html, /زيارة بدون موعد/);
  assert.match(html, /الاستيراد والتصدير/); assert.match(html, /رسائل واتساب/); assert.match(html, /750\.00 ج.م/);
  assert.doesNotMatch(html, /synthetic-whole-clinic-owner|lastOperationId|password/);
});
test('directory shows public file number with exact internal callback and manual call/WhatsApp links', async () => {
  const h = await view('directory'), html = h.html(); assert.match(html, /451/); assert.match(html, /بدون ملف/);
  assert.match(html, /tel:\+201000000001/); assert.match(html, /https:\/\/wa.me\/201000000001/); assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /البحث يشمل النسخة كاملة/); assert.match(html, /بحث كامل في الدليل/);
  const tree = CloudClinicOverviewWorkspaceView(h.props), elements = all(tree);
  const fileButton = elements.find(row => row.type === 'button' && text(row).includes('ملف 451'))!; assert.ok(fileButton); fileButton.props.onClick();
  assert.equal(h.events.at(-1), `patient:${snapshotId(900)}`);
});
test('finance displays receipt-level rows once and cumulative balances separately from range', async () => {
  const h = await view('finance'), html = h.html();
  assert.match(html, /تفاصيل الحركة النقدية/); assert.match(html, /كل إيصال مرة واحدة/); assert.match(html, /استهلاك الخامات ليس دفعة نقدية إضافية/);
  assert.match(html, /أرصدة تراكمية حتى النسخة/); assert.equal((html.match(/دفعة معمل · 1 حالة/g) ?? []).length, 1);
  assert.match(html, /جميع الإيصالات داخلة في الإجماليات/);
});
test('owner export clearly disclaims complete restore, excludes credentials and uses explicit buttons', async () => {
  const h = await view('export'), html = h.html(); assert.match(html, /ليس نسخة استعادة كاملة/); assert.match(html, /غير مشفّر/);
  assert.match(html, /لا ترفعه إلى GitHub/); assert.match(html, /JSON/); assert.match(html, /CSV/); assert.match(html, /بصرف النظر عن فلاتر البحث/);
  assert.doesNotMatch(html, /type="file"|SYNTHETIC_SECRET|password/);
});
test('preview hides accidentally provided private snapshot, counts, query, notices and contact/export actions', async () => {
  const h = await view('directory'); h.props.previewOnly = true;
  h.props.state = { ...h.props.state, directoryQuery: 'PRIVATE_QUERY', error: 'PRIVATE_ERROR', notice: 'PRIVATE_NOTICE' };
  const html = h.html(); assert.match(html, /معاينة تصميم فارغة وخاملة/); assert.doesNotMatch(html, /مريض مصطنع|451|01000000001|PRIVATE_|tel:|wa.me/);
  for (const button of all(CloudClinicOverviewWorkspaceView(h.props)).filter(row => row.type === 'button')) { button.props.onClick?.(); assert.equal(button.props.disabled, true); }
  assert.deepEqual(h.events, []);
});
test('disabled or loading render callbacks cannot navigate/refresh/export/open files', async () => {
  const h = await view('directory'); h.props.disabled = true;
  const elements = all(CloudClinicOverviewWorkspaceView(h.props)); for (const row of elements.filter(row => row.type === 'button')) row.props.onClick?.(); assert.deepEqual(h.events, []);
  h.props.disabled = false; h.props.state = { ...h.props.state, loading: true };
  for (const row of all(CloudClinicOverviewWorkspaceView(h.props)).filter(row => row.type === 'button')) row.props.onClick?.(); assert.deepEqual(h.events, []);
});
test('source dependency graph never pulls local Storage/User mapping, SDK initialization or old full backup', () => {
  const paths = Object.keys(compiled.metafile!.inputs).join('\n');
  assert.doesNotMatch(paths, /(?:^|\/)(?:storage|firebaseService|authService|App)\.(?:ts|tsx)/m);
  assert.doesNotMatch(paths, /firebase(?:\/|Cloud)|node_modules\/firebase/);
});
test('CSS preserves touch targets/16px fields, responsive stacked cards and reduced-motion support', async () => {
  const css = await readFile('src/components/summary/CloudClinicOverviewWorkspace.css', 'utf8');
  assert.match(css, /min-height:44px/); assert.match(css, /font-size:16px/); assert.match(css, /max-width:520px/); assert.match(css, /prefers-reduced-motion:reduce/);
  assert.doesNotMatch(css, /overflow-x:\s*(?:auto|scroll)|animation:\s*\S+\s+infinite|position:fixed/);
});
test('protected home layout hides/reorders sections without mutating any settings', async () => {
  const h = await view(), snapshot = structuredClone(h.props.state.snapshot!);
  snapshot.settings.clinicSettings.data.content.homeLayout.sectionOrder = ['schedule', 'metrics', 'actions', 'followUp'];
  snapshot.settings.clinicSettings.data.content.homeLayout.hiddenSections = ['actions'];
  h.props.state = { ...h.props.state, snapshot };
  const html = h.html(); assert.doesNotMatch(html, /إجراءات اليوم/); assert.ok(html.indexOf('جدول اليوم') < html.indexOf('تحصيل اليوم'));
  assert.deepEqual(snapshot.settings.clinicSettings.data.content.homeLayout.hiddenSections, ['actions']);
});
