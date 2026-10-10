import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAuditLogs, logAuditAction, parseAuditLogs, type AuditLogItem } from '../services/auditLogger';
import { AUDIT_ACTIONS, AUDIT_ENTITIES, auditActionLabel, auditEntityLabel, filterAuditLogs, formatAuditDateTime, serializeAuditCsv } from './auditTrailPresentation';
import type { AuditTrailViewProps } from '../components/settings/AuditTrailView';

const sample = (overrides: Partial<AuditLogItem> = {}): AuditLogItem => ({ id: 'synthetic-audit-1', timestamp: '2026-01-10T22:30:00.000Z', userName: 'مستخدم تجريبي', userRole: 'طبيب', action: 'payment', entity: 'patient', recordName: 'سجل تجريبي (ملف #٤٠١)', details: 'تفاصيل تجريبية فقط\nدفعة 500 ج.م', newValue: '500 ج.م', device: 'كمبيوتر', ...overrides });
function withStorage<T>(raw: string | null, action: (writes: string[]) => T): T {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const writes: string[] = [];
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => raw, setItem: (_key: string, value: string) => writes.push(value) } });
  try { return action(writes); } finally { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete (globalThis as any).localStorage; }
}

test('audit reads missing, malformed and non-array storage as empty without fabricating or writing activity', () => {
  for (const raw of [null, '', '{broken', '{}', 'null', '[null,1,"text",{},[]]']) {
    withStorage(raw, writes => { assert.deepEqual(getAuditLogs(), []); assert.deepEqual(writes, []); });
  }
});
test('audit parsing retains valid existing rows but rejects unsafe fields without storage mutation', () => {
  const valid = sample();
  const invalid = [null, { ...valid, timestamp: 'bad-date' }, { ...valid, action: 'unknown' }, { ...valid, entity: 'unknown' }, { ...valid, userName: {} }, { ...valid, newValue: 0 }, { ...valid, device: [] }];
  assert.deepEqual(parseAuditLogs([valid, ...invalid]), [valid]);
  withStorage(JSON.stringify([valid, ...invalid]), writes => { assert.deepEqual(getAuditLogs(), [valid]); assert.deepEqual(writes, []); });
});
test('audit writes without a window use an honest device fallback and retain a bounded valid history', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  delete (globalThis as any).window;
  try {
    withStorage(JSON.stringify(Array.from({ length: 500 }, (_, index) => sample({ id: `synthetic-${index}` }))), writes => {
      logAuditAction({ userName: 'حساب تجريبي', userRole: 'طبيب', action: 'logout', entity: 'system', recordName: 'خروج تجريبي', details: '' });
      assert.equal(writes.length, 1);
      const saved = JSON.parse(writes[0]);
      assert.equal(saved.length, 500); assert.equal(saved[0].device, 'غير محدد'); assert.equal(saved[0].action, 'logout');
      assert.equal(saved[1].id, 'synthetic-0');
    });
  } finally { if (original) Object.defineProperty(globalThis, 'window', original); }
});
test('audit filters cover all recorded action/entity types and Arabic/Persian file-number search', () => {
  assert.equal(AUDIT_ACTIONS.length, 6); assert.equal(AUDIT_ENTITIES.length, 6);
  assert.equal(auditActionLabel('logout'), 'تسجيل خروج'); assert.equal(auditEntityLabel('user'), 'المستخدمون');
  const logs = [sample(), sample({ id: 'synthetic-2', action: 'logout', entity: 'user', recordName: 'خروج تجريبي' })];
  for (const query of ['401', '٤٠١', '۴۰۱']) assert.equal(filterAuditLogs(logs, query).length, 1);
  assert.deepEqual(filterAuditLogs(logs, '', 'logout', 'user').map(log => log.id), ['synthetic-2']);
  assert.equal(filterAuditLogs(logs, 'غير موجود').length, 0);
});
test('audit orders newest first without mutating source records and separates Cairo date/time', () => {
  const earlier = sample({ id: 'synthetic-old', timestamp: '2026-01-09T12:00:00.000Z' }), newer = sample();
  const logs = [earlier, newer];
  assert.deepEqual(filterAuditLogs(logs, '').map(log => log.id), [newer.id, earlier.id]); assert.equal(logs[0], earlier);
  const stamp = formatAuditDateTime(newer.timestamp);
  assert.match(stamp.date, /١١ يناير ٢٠٢٦/); assert.match(stamp.time, /١٢:٣٠/); assert.equal(stamp.iso, newer.timestamp);
  assert.deepEqual(formatAuditDateTime('invalid'), { date: 'تاريخ غير متاح', time: 'وقت غير متاح' });
});
test('audit CSV includes every result, Arabic labels and safe formula/text quoting', () => {
  const logs = Array.from({ length: 65 }, (_, index) => sample({ id: `synthetic-export-${index}`, recordName: '=HYPERLINK("https://invalid.test")' }));
  const csv = serializeAuditCsv(logs);
  assert.equal((csv.match(/synthetic-export-/g) || []).length, 65);
  assert.match(csv, /تحصيل مالي/); assert.match(csv, /ملفات المرضى/); assert.match(csv, /القيمة المسجلة/); assert.match(csv, /'=HYPERLINK/);
});

// Render actual React markup with fabricated storage only. CSS is deliberately
// omitted: these tests verify structure/wiring, not browser or iPhone layout.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const bundle = buildSync({ stdin: { resolveDir: root, loader: 'tsx', contents: `
  import React from 'react';
  import {renderToStaticMarkup} from 'react-dom/server';
  import {AuditTrailView} from './src/components/settings/AuditTrailView';
  import {ToastAndConfirmProvider} from './src/components/common/ToastAndConfirm';
  export const component = AuditTrailView;
  export const render = props => renderToStaticMarkup(<ToastAndConfirmProvider><AuditTrailView {...props}/></ToastAndConfirmProvider>);
` }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', loader: { '.css': 'empty' }, logLevel: 'silent' });
const compiled = { exports: {} as { render: (props: AuditTrailViewProps) => string; component: (props: AuditTrailViewProps) => any } };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
const render = (logs: AuditLogItem[], props: AuditTrailViewProps = {}) => withStorage(JSON.stringify(logs), () => compiled.exports.render(props));

test('audit markup uses responsive labeled cards, isolated dates/values and accessible complete filters', () => {
  const markup = render([sample({ recordName: 'ملف #401 <script>synthetic</script>' })]);
  assert.doesNotMatch(markup, /<table|overflow-x-auto|dir-ltr/);
  assert.match(markup, /class="audit-trail-entry"/); assert.match(markup, /<time[^>]*dateTime="2026-01-10T22:30:00.000Z"/);
  assert.match(markup, /<bdi dir="auto">500 ج.م<\/bdi>/); assert.match(markup, /&lt;script&gt;synthetic&lt;\/script&gt;/);
  assert.match(markup, /<label[^>]*for="audit-[^"]*-search"/); assert.match(markup, /تسجيل خروج/); assert.match(markup, /المستخدمون/);
  assert.doesNotMatch(markup, /تصدير CSV|>طباعة</);
});
test('audit default-denied controls require both permission and callback; rendering never authorizes or downloads', () => {
  let calls = 0;
  assert.doesNotMatch(render([sample()], { canExport: true }), /تصدير CSV|>طباعة</);
  assert.doesNotMatch(render([sample()], { onAuthorizeExport: () => calls++ }), /تصدير CSV|>طباعة</);
  const allowed = render([sample()], { canExport: true, onAuthorizeExport: () => calls++ });
  assert.match(allowed, /تصدير CSV/); assert.match(allowed, />طباعة</); assert.equal(calls, 0);
});
test('audit empty state is truthful and large lists render the first fifty without dropping CSV results', () => {
  assert.match(render([]), /لا توجد نشاطات مسجلة/);
  const markup = render(Array.from({ length: 65 }, (_, index) => sample({ id: `synthetic-${index}`, recordName: `synthetic-visible-${index}` })));
  assert.equal((markup.match(/synthetic-visible-/g) || []).length, 50); assert.match(markup, /عرض المزيد/);
});

type Tree = { type: any; props: any };
const children = (node: any): any[] => node == null ? [] : Array.isArray(node) ? node.flatMap(children) : [node];
const nodes = (node: any): Tree[] => children(node).flatMap(item => item && typeof item === 'object' && item.props ? [item, ...nodes(item.props.children)] : []);
const content = (node: any): string => children(node).map(item => typeof item === 'string' || typeof item === 'number' ? String(item) : item?.props ? content(item.props.children) : '').join('');
function exerciseAuditAction(props: AuditTrailViewProps, label: string, count = 1) {
  const internals = (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  assert.ok(internals && 'H' in internals);
  const oldDispatcher = internals.H, oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window'), oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const oldCreate = URL.createObjectURL, oldRevoke = URL.revokeObjectURL, oldTimeout = globalThis.setTimeout;
  const outcome = { clicks: 0, prints: 0, blobs: 0, messages: [] as string[] };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { print: () => outcome.prints++ } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({ click: () => outcome.clicks++, remove: () => {} }) } });
  URL.createObjectURL = () => { outcome.blobs++; return 'blob:synthetic-audit'; }; URL.revokeObjectURL = () => {};
  globalThis.setTimeout = ((callback: () => void) => { callback(); return 0; }) as unknown as typeof setTimeout;
  internals.H = { useState: (initial: any) => [typeof initial === 'function' ? initial() : initial, () => {}], useMemo: (factory: () => unknown) => factory(), useId: () => 'synthetic-id', useContext: () => ({ showToast: (message: string) => outcome.messages.push(message) }) };
  try {
    withStorage(JSON.stringify(Array.from({ length: count }, (_, index) => sample({ id: `synthetic-${index}` }))), () => {
      const tree = compiled.exports.component(props);
      const button = nodes(tree).find(node => node.type === 'button' && content(node.props.children) === label);
      assert.ok(button, `Missing synthetic button ${label}`); button.props.onClick();
    });
  } finally {
    internals.H = oldDispatcher; URL.createObjectURL = oldCreate; URL.revokeObjectURL = oldRevoke; globalThis.setTimeout = oldTimeout;
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow); else delete (globalThis as any).window;
    if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument); else delete (globalThis as any).document;
  }
  return outcome;
}
test('audit download reauthorizes immediately before the click and revoked permission blocks the file', () => {
  let allowedCalls = 0;
  const allowed = exerciseAuditAction({ canExport: true, onAuthorizeExport: () => { allowedCalls++; } }, 'تصدير CSV');
  assert.equal(allowedCalls, 2); assert.equal(allowed.clicks, 1); assert.equal(allowed.messages.length, 0);
  let revokedCalls = 0;
  const revoked = exerciseAuditAction({ canExport: true, onAuthorizeExport: () => { if (++revokedCalls === 2) throw new Error('synthetic-revoked'); } }, 'تصدير CSV');
  assert.equal(revokedCalls, 2); assert.equal(revoked.clicks, 0); assert.equal(revoked.messages.length, 1);
  const denied = exerciseAuditAction({ canExport: true, onAuthorizeExport: () => { throw new Error('synthetic-denied'); } }, 'تصدير CSV');
  assert.equal(denied.blobs, 0); assert.equal(denied.clicks, 0);
});
test('audit print reauthorizes and refuses silent partial-list printing', () => {
  let allowedCalls = 0;
  const allowed = exerciseAuditAction({ canExport: true, onAuthorizeExport: () => { allowedCalls++; } }, 'طباعة');
  assert.equal(allowedCalls, 2); assert.equal(allowed.prints, 1);
  let revokedCalls = 0;
  const denied = exerciseAuditAction({ canExport: true, onAuthorizeExport: () => { if (++revokedCalls === 2) throw new Error('synthetic-revoked'); } }, 'طباعة');
  assert.equal(denied.prints, 0); assert.equal(denied.messages.length, 1);
  const partial = exerciseAuditAction({ canExport: true, onAuthorizeExport: () => {} }, 'طباعة', 65);
  assert.equal(partial.prints, 0); assert.match(partial.messages[0], /بقية النتائج/);
});
