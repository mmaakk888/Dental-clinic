import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import CloudContactsWorkspace, { CloudContactsWorkspaceView, type CloudContactsWorkspaceViewProps } from '../components/contacts/CloudContactsWorkspace';
import { createCloudContactWorkspaceController, type CloudContactWorkspaceState } from './cloudContactWorkspaceController';
import type { CloudContactRecord, CloudContactRepository } from './cloudContactRepository';

const ID = '10000000-0000-4000-8000-000000000001';
const OP = '20000000-0000-4000-8000-000000000001';
const TIME = '2026-10-10T10:00:00.000Z';
const record = (changes: Partial<CloudContactRecord> = {}): CloudContactRecord => ({ schemaVersion: 1, clinicId: 'main', recordId: ID,
  revision: 1, deleted: false, lastOperationId: OP,
  phoneKey: createHash('sha256').update('contact-phone-v1:201000000001').digest('hex'),
  data: { id: ID, name: 'أحمد اختبار', mobile: '٠١٠٠٠٠٠٠٠٠١', createdAt: TIME, notes: 'للتواصل التجريبي فقط' }, ...changes });
const state = (changes: Partial<CloudContactWorkspaceState> = {}): CloudContactWorkspaceState => ({ records: [], nextAfterId: null,
  loaded: false, loading: false, saveStatus: 'idle', draft: null, error: '', notice: '', closed: false, ...changes });

function viewProps(changes: Partial<CloudContactsWorkspaceViewProps> = {}) {
  const calls: string[] = [];
  const props: CloudContactsWorkspaceViewProps = { state: state(), query: '', onQueryChange: () => calls.push('search'),
    onClose: () => calls.push('close'), onCreate: () => calls.push('create'), onEdit: () => calls.push('edit'),
    onDelete: () => calls.push('delete'), onContact: () => { calls.push('contact'); return true; },
    onChangeDraft: () => calls.push('change'), onSave: () => calls.push('save'), onCancel: () => calls.push('cancel'),
    onLoadFirst: () => calls.push('first'), onLoadMore: () => calls.push('more'), ...changes };
  return { props, calls, html: () => renderToStaticMarkup(React.createElement(CloudContactsWorkspaceView, props)) };
}

type Element = { type: unknown; props: Record<string, any> };
const children = (node: any): any[] => node == null ? [] : Array.isArray(node) ? node.flatMap(children) : [node];
const all = (node: any): Element[] => children(node).flatMap(item => item && typeof item === 'object' && item.props ? [item, ...all(item.props.children)] : []);
const text = (node: any): string => children(node).map(item => typeof item === 'string' || typeof item === 'number' ? String(item) : item?.props ? text(item.props.children) : '').join('');

/** Deterministic hook invocation only; no DOM, browser storage or live SDK. */
function invoke(component: (props: any) => any, props: any, subscriptions?: Array<(notify: () => void) => () => void>) {
  const internals = (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  const previous = internals.H;
  internals.H = { useId: () => 'synthetic-cloud-contacts', useMemo: (factory: () => unknown) => factory(),
    useCallback: (callback: unknown) => callback,
    useState: (initial: unknown) => [typeof initial === 'function' ? (initial as () => unknown)() : initial, () => undefined],
    useSyncExternalStore: (subscribe: (notify: () => void) => () => void, snapshot: () => unknown) => { subscriptions?.push(subscribe); return snapshot(); } };
  try { return component(props); } finally { internals.H = previous; }
}
function rendered(props: CloudContactsWorkspaceViewProps) {
  const tree = invoke(CloudContactsWorkspaceView, props);
  const elements = all(tree);
  const button = (label: string) => { const match = elements.find(item => item.type === 'button' && text(item) === label); assert.ok(match, `Missing button ${label}`); return match; };
  return { tree, elements, button, content: text(tree) };
}
function controllerHarness() {
  const calls: string[] = [], ids = [ID, OP];
  let page = { records: [record()], nextAfterId: null as string | null };
  const repository: CloudContactRepository = {
    listPage: async () => { calls.push('list'); return page; },
    get: async () => { calls.push('get'); return page.records[0] ?? null; },
    commit: async command => { calls.push('commit'); return { status: 'committed', recordId: command.recordId, revision: command.expectedRevision + 1 }; },
  };
  const controller = createCloudContactWorkspaceController({ getRepository: async () => { calls.push('factory'); return repository; },
    isActive: () => true, newId: () => ids.shift()!, now: () => TIME });
  return { controller, calls, setPage: (value: typeof page) => { page = value; } };
}

test('cloud workspace SSR is unloaded and inert, with no clinical total, imports, exports or fake records', () => {
  const h = controllerHarness();
  const html = renderToStaticMarkup(React.createElement(CloudContactsWorkspace, { controller: h.controller, onClose() {} }));
  assert.deepEqual(h.calls, []);
  assert.match(html, /لم تُحمّل جهات الاتصال بعد|ليس إجمالي العيادة|البحث في الأرقام المحمّلة/);
  assert.match(html, /آخر ٥٠٠ سجل محمّل|حتى ٢٥ سجلًا/);
  assert.doesNotMatch(html, /أحمد اختبار|٠١٠٠٠٠٠٠٠٠١|استيراد|تصدير|type="checkbox"|تم الحفظ/);
});

test('previewOnly masks any supplied data/draft and disables every data control without invoking it', () => {
  const data = record(), h = viewProps({ previewOnly: true, state: state({ records: [data], loaded: true, nextAfterId: ID,
    draft: { action: 'update', recordId: ID, expectedRevision: 1, contact: data.data } }) });
  const html = h.html(), view = rendered(h.props);
  assert.match(html, /معاينة تصميم فقط|القراءة والحفظ غير مفعّلين|بلا سجلات افتراضية أو حقيقية/);
  assert.doesNotMatch(html, /أحمد اختبار|٠١٠٠٠٠٠٠٠٠١|tel:|wa\.me|<form|تعديل جهة الاتصال/);
  for (const item of view.elements.filter(item => item.type === 'button')) {
    if (text(item) === 'إلغاء وإغلاق') continue;
    assert.equal(item.props.disabled, true); item.props.onClick?.();
  }
  assert.deepEqual(h.calls, []);
  view.button('إلغاء وإغلاق').props.onClick(); assert.deepEqual(h.calls, ['close']);
});

test('wrapper preview guards reject retained callbacks even when invoked outside disabled controls', async () => {
  const h = controllerHarness(); let closes = 0;
  const wrapper = invoke(CloudContactsWorkspace, { controller: h.controller, previewOnly: true, onClose: () => closes++ });
  const props = wrapper.props as CloudContactsWorkspaceViewProps, data = record();
  const expected = { action: 'update' as const, recordId: ID, expectedRevision: 1, contact: data.data };
  props.onCreate(); props.onEdit(data); props.onDelete(data); props.onLoadFirst(); props.onLoadMore();
  props.onSave(expected); props.onCancel(expected); props.onChangeDraft({ name: 'تغيير', mobile: '01000000001' }, expected);
  assert.equal(props.onContact(data), false); await Promise.resolve();
  assert.deepEqual(h.calls, []); assert.equal(h.controller.getState().draft, null);
  props.onClose(); assert.equal(closes, 1);
});

test('loaded-only search normalizes Arabic names and phone digits, hides tombstones and does not query a repository', () => {
  const data = record(), h = viewProps({ query: 'احمد', state: state({ loaded: true, records: [data,
    record({ recordId: '10000000-0000-4000-8000-000000000002', deleted: true, phoneKey: null, data: null })] }) });
  assert.match(h.html(), /أحمد اختبار/); assert.match(h.html(), /١ جهة نشطة/);
  h.props.query = '+٢٠١٠٠٠٠٠٠٠٠١'; assert.match(h.html(), /أحمد اختبار/);
  h.props.query = 'غير موجود'; assert.doesNotMatch(h.html(), /أحمد اختبار/); assert.match(h.html(), /ضمن الأرقام المحمّلة/);
  assert.deepEqual(h.calls, []);
});

test('names, notes and phone values remain escaped React text; canonical call/WhatsApp links contain no clinical payload', () => {
  const data = record(); data.data = { ...data.data!, name: '<img src=x onerror=alert(1)>', notes: '<script>PRIVATE_TEST</script>' };
  const h = viewProps({ state: state({ loaded: true, records: [data] }) }), html = h.html();
  assert.match(html, /&lt;img|&lt;script/); assert.doesNotMatch(html, /<script|<img src=x|dangerouslySetInnerHTML/);
  assert.match(html, /href="tel:\+201000000001"/); assert.match(html, /href="https:\/\/wa.me\/201000000001\?text="/);
  assert.match(html, /rel="noopener noreferrer"/); assert.match(html, /فتح واتساب لا يؤكد إرسال/);
  const links = rendered(h.props).elements.filter(item => item.type === 'a');
  assert.equal(links.length, 2); assert.ok(links.every(item => !item.props.href.includes('PRIVATE_TEST')));
  const malformed = record(); malformed.data = { ...malformed.data!, mobile: 'javascript:alert(1)' };
  h.props.state = state({ loaded: true, records: [malformed] }); assert.doesNotMatch(h.html(), /href=/);
});

test('manual communication checks current controller state and rejects stale rows or a closed owner view', async () => {
  const h = controllerHarness(); await h.controller.loadFirst();
  const old = invoke(CloudContactsWorkspace, { controller: h.controller, onClose() {} }).props as CloudContactsWorkspaceViewProps;
  const displayed = old.state.records[0]; assert.equal(old.onContact(displayed), true);
  await h.controller.loadFirst(); assert.equal(old.onContact(displayed), false, 'old callback must not contact a replaced row');
  h.controller.dispose(); assert.equal(old.onContact(displayed), false);
  old.onEdit(displayed); old.onDelete(displayed); assert.equal(h.controller.getState().draft, null);
});

test('editing requires explicit save; old draft callbacks cannot alter, cancel or save a different draft', () => {
  const h = controllerHarness(); h.controller.beginCreate();
  const old = invoke(CloudContactsWorkspace, { controller: h.controller, onClose() {} }).props as CloudContactsWorkspaceViewProps;
  const expected = old.state.draft!;
  old.onChangeDraft({ name: 'تصحيح وهمي', mobile: '01000000001', notes: 'ملاحظة' }, expected);
  assert.deepEqual(h.calls, []); assert.equal(h.controller.getState().draft?.contact?.name, 'تصحيح وهمي');
  const current = h.controller.getState().draft;
  old.onChangeDraft({ name: 'مسودة قديمة', mobile: '01000000002' }, expected); old.onCancel(expected); old.onSave(expected);
  assert.equal(h.controller.getState().draft, current); assert.deepEqual(h.calls, []);
});

test('retry-required locks fields/cancel/close and offers only the same-command retry', () => {
  const data = record(), h = viewProps({ state: state({ records: [data], loaded: true, saveStatus: 'retry-required',
    draft: { action: 'update', recordId: ID, expectedRevision: 1, contact: data.data } }) });
  const view = rendered(h.props);
  assert.equal(view.button('إلغاء وإغلاق').props.disabled, true); view.button('إلغاء وإغلاق').props.onClick();
  assert.equal(view.button('إلغاء المسودة').props.disabled, true); view.button('إلغاء المسودة').props.onClick();
  assert.equal(view.elements.find(item => item.type === 'fieldset')?.props.disabled, true);
  const save = view.button('إعادة نفس المحاولة'); assert.equal(save.props.disabled, false);
  view.elements.find(item => item.type === 'form')!.props.onSubmit({ preventDefault() {} });
  assert.deepEqual(h.calls, ['save']); assert.match(h.html(), /قد تكون العملية وصلت بالفعل|لا تغيّر المسودة/);
});

test('acknowledged refresh-required state says read-only verification, never a new save or optimistic data', () => {
  const data = record(), h = viewProps({ state: state({ saveStatus: 'refresh-required', draft: { action: 'create', recordId: ID, expectedRevision: 0, contact: data.data } }) });
  const view = rendered(h.props);
  assert.ok(view.button('إعادة التحقق من النتيجة')); assert.match(h.html(), /تقرأ النتيجة فقط، دون إرسال عملية حفظ جديدة/);
  assert.equal(view.elements.filter(item => item.type === 'article').length, 0);
  assert.equal(view.button('إلغاء المسودة').props.disabled, true);
});

test('busy state disables submit, editable fields and close even if retained handlers are invoked', () => {
  const data = record(), h = viewProps({ state: state({ saveStatus: 'saving', draft: { action: 'update', recordId: ID, expectedRevision: 1, contact: data.data } }) });
  const view = rendered(h.props);
  view.button('إلغاء وإغلاق').props.onClick(); view.button('إلغاء المسودة').props.onClick();
  view.elements.find(item => item.type === 'form')!.props.onSubmit({ preventDefault() {} });
  assert.deepEqual(h.calls, []); assert.equal(view.button('جارٍ التحقق…').props.disabled, true);
});

test('ordinary unsaved draft blocks close visibly and the wrapper rejects a retained close handler', () => {
  const h = controllerHarness(); let closed = 0;
  h.controller.beginCreate();
  const props = invoke(CloudContactsWorkspace, { controller: h.controller, onClose: () => closed++ }).props as CloudContactsWorkspaceViewProps;
  const view = rendered(props), button = view.button('إلغاء وإغلاق');
  assert.equal(button.props.disabled, true); assert.ok(button.props['aria-describedby']);
  assert.match(view.content, /ألغِ المسودة قبل إغلاق الشاشة/);
  button.props.onClick(); props.onClose(); assert.equal(closed, 0);
  props.onCancel(props.state.draft!); props.onClose(); assert.equal(closed, 1);
});

test('locked communication anchors have no URL to open by context menu and are excluded from keyboard order', () => {
  const h = viewProps({ state: state({ records: [record()], loaded: true, loading: true }) });
  const links = rendered(h.props).elements.filter(item => item.type === 'a');
  assert.equal(links.length, 2);
  for (const link of links) {
    assert.equal(link.props.href, undefined); assert.equal(link.props['aria-disabled'], true); assert.equal(link.props.tabIndex, -1);
    let prevented = false; link.props.onClick({ preventDefault: () => { prevented = true; } }); assert.equal(prevented, true);
  }
  assert.deepEqual(h.calls, []);
});

test('delete opens a distinct confirmation form and never writes on selection alone', async () => {
  const h = controllerHarness(); await h.controller.loadFirst();
  const initial = invoke(CloudContactsWorkspace, { controller: h.controller, onClose() {} }).props as CloudContactsWorkspaceViewProps;
  initial.onDelete(initial.state.records[0]); assert.deepEqual(h.calls, ['factory', 'list']);
  const current = invoke(CloudContactsWorkspace, { controller: h.controller, onClose() {} }).props as CloudContactsWorkspaceViewProps;
  const view = rendered(current);
  assert.ok(view.button('تأكيد الحذف')); assert.match(view.content, /هل تريد حذف|أحمد اختبار/);
  assert.equal(view.elements.some(item => item.type === 'input' && item.props.type === 'tel'), false);
});

test('normal draft markup has associated labels, bounded fields, mobile touch sizes and no floating navigation', () => {
  const data = record(), h = viewProps({ state: state({ draft: { action: 'update', recordId: ID, expectedRevision: 1, contact: data.data } }) });
  const html = h.html();
  assert.match(html, /dir="rtl"|text-base|min-h-11|min-h-12|motion-reduce:transition-none|min-w-0/);
  assert.match(html, /maxLength="200"/); assert.match(html, /maxLength="60"/); assert.match(html, /maxLength="2000"/);
  assert.match(html, /type="tel" inputMode="tel"/); assert.match(html, /htmlFor=|for="/);
  assert.doesNotMatch(html, /<nav|position:fixed|type="checkbox"/);
  const view = rendered(h.props), inputs = view.elements.filter(item => ['input', 'textarea'].includes(item.type as string));
  for (const input of inputs) assert.ok(view.elements.some(item => item.type === 'label' && item.props.htmlFor === input.props.id));
});

test('subscription cleanup is isolated and never disposes the parent-owned controller or starts cloud reads', () => {
  const h = controllerHarness(), subscriptions: Array<(notify: () => void) => () => void> = [];
  invoke(CloudContactsWorkspace, { controller: h.controller, onClose() {} }, subscriptions);
  assert.equal(subscriptions.length, 1); let notifications = 0;
  const unsubscribe = subscriptions[0](() => notifications++);
  h.controller.beginCreate(); assert.equal(notifications, 1);
  unsubscribe(); h.controller.cancelDraft(); assert.equal(notifications, 1);
  assert.equal(h.controller.getState().closed, false); assert.deepEqual(h.calls, []);
});

test('cloud workspace dependency graph excludes local clinic UI/storage, Firebase/Auth SDK and patient-financial code', async () => {
  const compiled = await build({ entryPoints: ['src/components/contacts/CloudContactsWorkspace.tsx'], bundle: true, write: false,
    metafile: true, platform: 'browser', logLevel: 'silent', external: ['react', 'react-dom', 'lucide-react'] });
  for (const input of Object.keys(compiled.metafile!.inputs)) {
    assert.doesNotMatch(input, /(?:App\.tsx|components\/settings|utils\/(?:storage|localClinicBackup|firebaseService|offlineSync|cloudOperatingAuth|firebaseCloudContacts)|firebase(?:-admin)?\/|financial|patientFinancial)/i);
  }
});
