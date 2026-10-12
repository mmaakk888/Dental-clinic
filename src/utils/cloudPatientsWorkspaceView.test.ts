import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { createCloudPatientWorkspaceController, type CloudPatientWorkspaceState } from './cloudPatientWorkspaceController';
import type { CloudPatientRecord, CloudPatientRepository } from './cloudPatientRepository';
import type { CloudPatientsWorkspaceViewProps } from '../components/patients/CloudPatientsWorkspace';

// Compile only the view for deterministic synthetic hooks/SSR. CSS is checked
// separately; no browser, Auth SDK, storage, network or real patient is used.
const compiled = await build({ entryPoints: ['src/components/patients/CloudPatientsWorkspace.tsx'], bundle: true, write: false,
  platform: 'node', format: 'cjs', logLevel: 'silent', external: ['react', 'react-dom', 'lucide-react'], loader: { '.css': 'empty' } });
const viewModule = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), viewModule, viewModule.exports);
const { default: CloudPatientsWorkspace, CloudPatientsWorkspaceView } = viewModule.exports as typeof import('../components/patients/CloudPatientsWorkspace');

const ID = '10000000-0000-4000-8000-000000000001', OP = '20000000-0000-4000-8000-000000000001';
const record = (changes: Partial<CloudPatientRecord> = {}): CloudPatientRecord => ({ schemaVersion: 1, clinicId: 'main', recordId: ID,
  fileNo: 401, revision: 1, lastOperationId: OP, phoneKey: createHash('sha256').update('patient-phone-v1:201000000001').digest('hex'),
  data: { name: 'أحمد اختبار مصطنع', mobile: '٠١٠٠٠٠٠٠٠٠١', age: 30, gender: 'ذكر', firstVisit: '2026-10-10', notes: 'ملاحظة مصطنعة', allergy: 'معلومة اختيارية مصطنعة' }, ...changes });
const state = (changes: Partial<CloudPatientWorkspaceState> = {}): CloudPatientWorkspaceState => ({ records: [], nextAfterId: null,
  loaded: false, loading: false, recoveryLoading: false, saveStatus: 'idle', pendingOperationId: null, selected: null, draft: null, query: { kind: 'all' }, error: '', notice: '', closed: false, ...changes });
function viewProps(changes: Partial<CloudPatientsWorkspaceViewProps> = {}) {
  const calls: string[] = [];
  const props: CloudPatientsWorkspaceViewProps = { state: state(), loadedQuery: '', fileQuery: '', phoneQuery: '', ageQuery: null,
    onLoadedQueryChange: () => calls.push('filter'), onFileQueryChange: () => calls.push('file-input'), onPhoneQueryChange: () => calls.push('phone-input'),
    onAgeQueryChange: () => calls.push('age-input'), onFindFile: () => calls.push('file'), onFindPhone: () => calls.push('phone'), onClose: () => calls.push('close'), onCreate: () => calls.push('create'),
    onSelect: () => calls.push('select'), onEdit: () => calls.push('edit'), onContact: () => { calls.push('contact'); return true; },
    onChangeDraft: () => calls.push('change'), onSave: () => calls.push('save'), onCancel: () => calls.push('cancel'),
    onRefresh: () => calls.push('refresh'), onLoadMore: () => calls.push('more'), ...changes };
  return { props, calls, html: () => renderToStaticMarkup(React.createElement(CloudPatientsWorkspaceView, props)) };
}
type Element = { type: unknown; props: Record<string, any> };
const children = (node: any): any[] => node == null ? [] : Array.isArray(node) ? node.flatMap(children) : [node];
const all = (node: any): Element[] => children(node).flatMap(item => item && typeof item === 'object' && item.props ? [item, ...all(item.props.children)] : []);
const text = (node: any): string => children(node).map(item => typeof item === 'string' || typeof item === 'number' ? String(item) : item?.props ? text(item.props.children) : '').join('');
function invoke(component: (props: any) => any, props: any, subscriptions?: Array<(notify: () => void) => () => void>, refSlots?: Array<{ current: any }>) {
  const internals = (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE, previous = internals.H;
  let refIndex = 0;
  internals.H = { useId: () => 'synthetic-cloud-patients', useMemo: (factory: () => unknown) => factory(), useCallback: (callback: unknown) => callback,
    useRef: (value: unknown) => { const index = refIndex++; return refSlots ? refSlots[index] ?? (refSlots[index] = { current: value }) : { current: value }; },
    useState: (initial: unknown) => [typeof initial === 'function' ? (initial as () => unknown)() : initial, () => undefined],
    useSyncExternalStore: (subscribe: (notify: () => void) => () => void, snapshot: () => unknown) => { subscriptions?.push(subscribe); return snapshot(); } };
  try { return component(props); } finally { internals.H = previous; }
}
function rendered(props: CloudPatientsWorkspaceViewProps) {
  const tree = invoke(CloudPatientsWorkspaceView, props), elements = all(tree);
  const button = (label: string) => { const found = elements.find(item => item.type === 'button' && text(item) === label); assert.ok(found, `Missing ${label}`); return found; };
  return { tree, elements, button, content: text(tree) };
}
function harness() {
  const calls: string[] = [], ids = [ID, OP]; let data = record();
  const repository: CloudPatientRepository = { listPage: async () => { calls.push('list'); return { records: [data], nextAfterId: null }; },
    get: async () => { calls.push('get'); return data; }, getByFileNo: async value => { calls.push(`file:${value}`); return data; },
    findByPhone: async value => { calls.push(`phone:${value.mobile}`); return { records: [data], nextAfterId: null }; },
    commit: async command => { calls.push('commit'); return { status: 'committed', recordId: command.recordId, fileNo: data.fileNo, revision: command.expectedRevision + 1 }; } };
  const controller = createCloudPatientWorkspaceController({ getRepository: async () => { calls.push('factory'); return repository; }, isActive: () => true, newId: () => ids.shift()!, today: () => '2026-10-10' });
  return { controller, calls, replace: () => { data = record({ revision: data.revision + 1 }); } };
}

test('patient view starts unloaded with no SDK/read on render, clinical totals, fake records or action on mount', () => {
  const h = harness(), html = renderToStaticMarkup(React.createElement(CloudPatientsWorkspace, { controller: h.controller, onClose() {} }));
  assert.deepEqual(h.calls, []); assert.match(html, /لم تُحمّل ملفات المرضى بعد|ليس إجمالي العيادة/);
  assert.match(html, /بيانات الملف الأساسية — الجلسات والحسابات غير متاحة في هذا العرض/);
  assert.doesNotMatch(html, /أحمد اختبار|المتبقي|المدفوع|رصيد|تم الحفظ|<nav/);
});

test('preview masks supplied records, selected, draft, query inputs and raw notices, and guards all data handlers', () => {
  const data = record(), h = viewProps({ previewOnly: true, loadedQuery: 'PRIVATE_FILTER', fileQuery: '401', phoneQuery: 'PRIVATE_PHONE',
    state: state({ loaded: true, records: [data], selected: data, nextAfterId: ID, error: 'PRIVATE_ERROR', notice: 'PRIVATE_NOTICE', query: { kind: 'phone', mobile: 'PRIVATE_QUERY' },
      draft: { action: 'update', recordId: ID, expectedRevision: 1, profile: data.data } }) });
  const html = h.html(), view = rendered(h.props);
  assert.match(html, /معاينة تصميم فقط — القراءة والحفظ غير مفعّلين|بلا سجلات افتراضية أو حقيقية/);
  assert.doesNotMatch(html, /أحمد اختبار|٠١٠٠٠٠٠٠٠٠١|PRIVATE_|href=|<fieldset|تعديل بيانات الملف/);
  for (const button of view.elements.filter(item => item.type === 'button')) { if (text(button) === 'إلغاء وإغلاق') continue; assert.equal(button.props.disabled, true); button.props.onClick?.(); }
  for (const input of view.elements.filter(item => item.type === 'input')) { assert.equal(input.props.disabled, true); input.props.onChange({ target: { value: 'attempt' } }); }
  for (const form of view.elements.filter(item => item.type === 'form')) form.props.onSubmit({ preventDefault() {} });
  assert.deepEqual(h.calls, []); view.button('إلغاء وإغلاق').props.onClick(); assert.deepEqual(h.calls, ['close']);
});

test('wrapper preview rejects direct retained data callbacks, including save and exact queries', async () => {
  const h = harness(); let closes = 0;
  const props = invoke(CloudPatientsWorkspace, { controller: h.controller, previewOnly: true, onClose: () => closes++ }).props as CloudPatientsWorkspaceViewProps;
  const data = record(), draft = { action: 'update' as const, recordId: ID, expectedRevision: 1, profile: data.data };
  props.onCreate(); props.onSelect(data); props.onEdit(data); props.onRefresh(); props.onLoadMore(); props.onFindFile('٤٠١'); props.onFindPhone('01000000001');
  props.onChangeDraft({ name: 'attempt' }, draft); props.onSave(draft); props.onCancel(draft); assert.equal(props.onContact(data), false);
  await Promise.resolve(); assert.deepEqual(h.calls, []); assert.equal(h.controller.getState().draft, null);
  props.onClose(); assert.equal(closes, 1);
});

test('compact stacked cards open by whole-card button and loaded name normalization never claims global name search', () => {
  const data = record(), h = viewProps({ loadedQuery: 'احمد', state: state({ loaded: true, records: [data] }) });
  assert.match(h.html(), /أحمد اختبار مصطنع|تصفية الأسماء المحمّلة|ليست بحثًا شاملًا|آخر ٥٠٠ ملف/);
  const card = rendered(h.props).elements.find(item => item.type === 'button' && item.props['aria-label']?.startsWith('فتح بيانات ملف'))!;
  assert.ok(card); assert.match(text(card), /٤٠١|أحمد اختبار|٣٠ سنة/); card.props.onClick(); assert.deepEqual(h.calls, ['select']);
  h.props.loadedQuery = 'غير موجود'; assert.doesNotMatch(h.html(), /أحمد اختبار مصطنع/); assert.match(h.html(), /ضمن الملفات المحمّلة/);
});

test('file and phone search are explicit submit actions and their result context is distinguished', () => {
  const h = viewProps({ fileQuery: '٤٠١', phoneQuery: '01000000001', state: state({ loaded: true, query: { kind: 'phone', mobile: '201000000001' } }) });
  const view = rendered(h.props), forms = view.elements.filter(item => item.type === 'form');
  assert.equal(forms.length, 2); assert.deepEqual(h.calls, []);
  forms[0].props.onSubmit({ preventDefault() {} }); forms[1].props.onSubmit({ preventDefault() {} }); assert.deepEqual(h.calls, ['file', 'phone']);
  assert.match(h.html(), /نتائج البحث برقم الموبايل الكامل|قد يعرض أكثر من ملف للأسرة/);
  h.props.state = state({ loaded: true, query: { kind: 'file', fileNo: 401 } }); assert.match(h.html(), /نتيجة البحث عن ملف ٤٠١/);
});

test('invalid file query has associated visible feedback and never issues a lookup', () => {
  for (const value of ['ملف', '0', '-1', '2.5', '2000000001', '٤٠١abc']) {
    const h = viewProps({ fileQuery: value }), view = rendered(h.props);
    const input = view.elements.find(item => item.type === 'input' && item.props.id.endsWith('-file-search'))!;
    assert.equal(input.props['aria-invalid'], true); assert.ok(input.props['aria-describedby']); assert.match(h.html(), /بدون حروف/);
    view.elements.find(item => item.type === 'form')!.props.onSubmit({ preventDefault() {} }); assert.deepEqual(h.calls, []);
  }
  const valid = viewProps({ fileQuery: '٤٠١' }); assert.doesNotMatch(valid.html(), /aria-invalid="true"|بدون حروف/);
});

test('empty or invalid age remains editable locally but cannot silently save the old age or a coerced zero', () => {
  const data = record();
  for (const value of ['', '121', '-1', 'x']) {
    const h = viewProps({ ageQuery: value, state: state({ draft: { action: 'create', recordId: ID, expectedRevision: 0, profile: data.data } }) }), view = rendered(h.props);
    const input = view.elements.find(item => item.type === 'input' && item.props.id.endsWith('-age'))!;
    assert.equal(input.props.value, value); assert.equal(input.props['aria-invalid'], true); assert.equal(view.button('حفظ بيانات الملف').props.disabled, true);
    view.elements.filter(item => item.type === 'form')[2].props.onSubmit({ preventDefault() {} }); assert.deepEqual(h.calls, []);
  }
  const h = viewProps({ ageQuery: '٣٥', state: state({ draft: { action: 'create', recordId: ID, expectedRevision: 0, profile: data.data } }) });
  assert.equal(rendered(h.props).button('حفظ بيانات الملف').props.disabled, false);
});

test('profile detail has manual canonical call/WhatsApp links, escaped notes, collapsed optional allergy and no financial placeholders', () => {
  const data = record(); data.data = { ...data.data, name: '<img src=x onerror=1>', notes: '<script>PRIVATE_NOTE</script>' };
  const h = viewProps({ state: state({ loaded: true, records: [data], selected: data }) }), html = h.html(), view = rendered(h.props);
  assert.match(html, /&lt;img|&lt;script/); assert.doesNotMatch(html, /<script|<img src=x|رصيد|المتبقي|المدفوع/);
  assert.match(html, /href="tel:\+201000000001"|href="https:\/\/wa.me\/201000000001\?text="/);
  assert.match(html, /rel="noopener noreferrer"|referrerPolicy="no-referrer"|فتح واتساب لا يؤكد إرسال/);
  assert.equal(view.elements.find(item => item.type === 'details')!.props.open, undefined);
  const links = view.elements.filter(item => item.type === 'a'); assert.equal(links.length, 2); assert.ok(links.every(item => !item.props.href.includes('PRIVATE_NOTE')));
  data.data = { ...data.data, mobile: 'javascript:alert(1)' }; assert.doesNotMatch(h.html(), /href=/);
});

test('selected detail stays independent from loaded page and links lose href/context-menu access while busy', () => {
  const h = viewProps({ state: state({ selected: record(), records: [], loaded: true, loading: true }) });
  const view = rendered(h.props); assert.match(view.content, /أحمد اختبار مصطنع/); assert.equal(view.elements.filter(item => item.type === 'article').length, 0);
  for (const link of view.elements.filter(item => item.type === 'a')) { assert.equal(link.props.href, undefined); assert.equal(link.props.tabIndex, -1); assert.equal(link.props['aria-disabled'], true);
    let prevented = false; link.props.onClick({ preventDefault: () => { prevented = true; } }); assert.equal(prevented, true); }
  assert.deepEqual(h.calls, []);
});

test('wrapper fresh selection performs GET before edit; stale rows and retained contact callbacks fail closed', async () => {
  const h = harness(); await h.controller.refresh();
  const old = invoke(CloudPatientsWorkspace, { controller: h.controller, onClose() {} }).props as CloudPatientsWorkspaceViewProps, row = old.state.records[0];
  old.onEdit(row); assert.equal(h.controller.getState().draft, null); old.onSelect(row);
  await new Promise(resolve => setImmediate(resolve)); assert.ok(h.calls.includes('get')); const selected = h.controller.getState().selected!;
  const details = invoke(CloudPatientsWorkspace, { controller: h.controller, onClose() {} }).props as CloudPatientsWorkspaceViewProps;
  assert.equal(details.onContact(selected), true); await h.controller.refresh(); assert.equal(details.onContact(selected), false);
  old.onSelect(row); assert.equal(h.controller.getState().selected, null); h.controller.dispose(); details.onEdit(selected); assert.equal(h.controller.getState().draft, null);
});

test('ordinary draft needs explicit save/cancel, blocks close and stale draft callbacks cannot change a replacement', () => {
  const h = harness(); let closes = 0; h.controller.beginCreate();
  const props = invoke(CloudPatientsWorkspace, { controller: h.controller, onClose: () => closes++ }).props as CloudPatientsWorkspaceViewProps, draft = props.state.draft!;
  const view = rendered(props); assert.equal(view.button('إلغاء وإغلاق').props.disabled, true); assert.match(view.content, /ألغِ المسودة|رقم الملف يُخصص تلقائيًا/);
  props.onClose(); props.onRefresh(); props.onFindFile('401'); assert.equal(closes, 0); assert.deepEqual(h.calls, []);
  props.onChangeDraft({ name: 'تغيير مصطنع' }, draft); const replacement = h.controller.getState().draft;
  props.onCancel(draft); props.onSave(draft); props.onChangeDraft({ name: 'old' }, draft); assert.equal(h.controller.getState().draft, replacement); assert.deepEqual(h.calls, []);
  props.onCancel(replacement!); props.onClose(); assert.equal(closes, 1);
});

test('clearing age rejects a retained save callback immediately, before any React rerender', async () => {
  const h = harness(); h.controller.beginCreate(); h.controller.updateProfile({ name: 'عمر مصطنع' });
  const props = invoke(CloudPatientsWorkspace, { controller: h.controller, onClose() {} }).props as CloudPatientsWorkspaceViewProps, draft = props.state.draft!;
  props.onAgeQueryChange('', draft); props.onSave(draft); await Promise.resolve();
  assert.deepEqual(h.calls, []); assert.equal(h.controller.getState().saveStatus, 'idle'); assert.equal(h.controller.getState().draft?.profile.age, 0);
});

test('retry locks editor, selection, lists, queries and close; only same-command submit remains enabled', () => {
  const data = record(), h = viewProps({ fileQuery: '401', phoneQuery: '01000000001', state: state({ loaded: true, records: [data], selected: data, saveStatus: 'retry-required',
    draft: { action: 'update', recordId: ID, expectedRevision: 1, profile: data.data } }) });
  const view = rendered(h.props); assert.equal(view.elements.find(item => item.type === 'fieldset')!.props.disabled, true);
  assert.equal(view.button('إلغاء وإغلاق').props.disabled, true); assert.equal(view.button('إلغاء المسودة').props.disabled, true);
  view.button('إلغاء وإغلاق').props.onClick(); view.button('إلغاء المسودة').props.onClick(); view.button('ملف جديد').props.onClick();
  const forms = view.elements.filter(item => item.type === 'form'); forms[0].props.onSubmit({ preventDefault() {} }); forms[1].props.onSubmit({ preventDefault() {} });
  assert.deepEqual(h.calls, []); assert.equal(view.button('إعادة نفس المحاولة').props.disabled, false); forms[2].props.onSubmit({ preventDefault() {} });
  assert.deepEqual(h.calls, ['save']); assert.match(view.content, /قد تكون العملية وصلت بالفعل|لا يُلغيان كتابة وصلت للخادم/);
});

test('refresh-required offers only acknowledged read verification, and saving/closing states block submit', () => {
  const data = record(), h = viewProps({ state: state({ saveStatus: 'refresh-required', draft: { action: 'create', recordId: ID, expectedRevision: 0, profile: data.data } }) });
  assert.match(h.html(), /تقرأ النتيجة فقط، دون إرسال عملية حفظ جديدة/); assert.equal(rendered(h.props).button('إعادة التحقق من النتيجة').props.disabled, false);
  h.props.state = { ...h.props.state, saveStatus: 'saving' }; let view = rendered(h.props); assert.equal(view.button('جارٍ التحقق…').props.disabled, true);
  view.elements.filter(item => item.type === 'form')[2].props.onSubmit({ preventDefault() {} }); assert.deepEqual(h.calls, []);
  h.props.state = { ...h.props.state, saveStatus: 'idle' }; h.props.closing = true; view = rendered(h.props);
  assert.equal(view.button('حفظ بيانات الملف').props.disabled, true); view.button('إلغاء وإغلاق').props.onClick(); assert.deepEqual(h.calls, []);
});

test('editor labels/limits are associated, allergy is collapsed and file number is never editable', () => {
  const data = record(), h = viewProps({ state: state({ draft: { action: 'create', recordId: ID, expectedRevision: 0, profile: data.data } }) }), view = rendered(h.props), html = h.html();
  assert.match(html, /maxLength="200"|maxLength="60"|maxLength="4000"|maxLength="1000"/);
  const fieldset = view.elements.find(item => item.type === 'fieldset')!, fields = all(fieldset).filter(item => ['input', 'textarea'].includes(item.type as string));
  assert.equal(fields.length, 7); for (const input of fields) assert.ok(view.elements.some(item => item.type === 'label' && item.props.htmlFor === input.props.id));
  assert.equal(all(fieldset).find(item => item.type === 'details')!.props.open, undefined); assert.ok(fields.every(item => !item.props.id.includes('file-search')));
  assert.doesNotMatch(html, /type="checkbox"|<nav|position:fixed/);
});

test('Arabic numeric file lookup is normalized but no automatic creation or read happens through local filter', async () => {
  const h = harness(), props = invoke(CloudPatientsWorkspace, { controller: h.controller, onClose() {} }).props as CloudPatientsWorkspaceViewProps;
  props.onLoadedQueryChange('احمد'); assert.deepEqual(h.calls, []); props.onFindFile('٤٠١'); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.calls, ['factory', 'file:401']); assert.equal(h.controller.getState().selected?.fileNo, 401); assert.equal(h.controller.getState().draft, null);
});

test('subscription cleanup only unsubscribes; parent still owns disposal and there are no implicit reads', () => {
  const h = harness(), subscriptions: Array<(notify: () => void) => () => void> = [];
  invoke(CloudPatientsWorkspace, { controller: h.controller, onClose() {} }, subscriptions); assert.equal(subscriptions.length, 1);
  let notifications = 0; const unsubscribe = subscriptions[0](() => notifications++); h.controller.beginCreate(); assert.equal(notifications, 1);
  unsubscribe(); h.controller.cancelDraft(); assert.equal(notifications, 1); assert.equal(h.controller.getState().closed, false); assert.deepEqual(h.calls, []);
});

test('scoped stylesheet has touch/16px fields, stacked cards, contained responsive details and reduced motion', async () => {
  const css = await readFile('src/components/patients/CloudPatientsWorkspace.css', 'utf8');
  assert.match(css, /min-height: 44px|font-size: 16px|min-height: 48px/);
  assert.match(css, /prefers-reduced-motion: reduce|prefers-reduced-motion: no-preference/);
  assert.match(css, /\.cloud-patients-workspace \.cpw-record-list \{ display: grid; gap: \.5rem/);
  assert.match(css, /min-width: 1024px|grid-template-columns: minmax\(0,1\.35fr\)/);
  assert.doesNotMatch(css, /position:\s*fixed|animation:.*infinite|backdrop-filter/);
});

test('patient view dependency graph excludes local UI/storage, SDK/Auth and all financial domains', async () => {
  const output = await build({ entryPoints: ['src/components/patients/CloudPatientsWorkspace.tsx'], bundle: true, write: false,
    metafile: true, platform: 'browser', logLevel: 'silent', external: ['react', 'react-dom', 'lucide-react'], loader: { '.css': 'empty' } });
  for (const input of Object.keys(output.metafile!.inputs)) assert.doesNotMatch(input, /(?:App\.tsx|components\/settings|utils\/(?:storage|localClinicBackup|firebaseService|offlineSync|cloudOperatingAuth|firebaseCloudPatients)|firebase(?:-admin)?\/|financial|patientFinancial)/i);
});

test('clinical opening is absent without an explicit capability and is masked in preview despite supplied selection', () => {
  const data = record();
  const missing = viewProps({ state: state({ loaded: true, selected: data }) });
  assert.doesNotMatch(missing.html(), /فتح الجلسات وحساب الملف/);
  let opened = 0;
  const preview = viewProps({ previewOnly: true, state: state({ loaded: true, selected: data }), onOpenClinical: () => opened++ });
  assert.doesNotMatch(preview.html(), /فتح الجلسات وحساب الملف|أحمد اختبار/);
  assert.equal(opened, 0);
});

test('clinical selected-file action is explicit and refuses busy, closing, stale or preview callbacks', () => {
  const data = record(), opened: CloudPatientRecord[] = [];
  const h = viewProps({ state: state({ loaded: true, selected: data }), onOpenClinical: value => opened.push(value) });
  const refs: Array<{ current: any }> = [];
  const tree = invoke(CloudPatientsWorkspaceView, h.props, undefined, refs);
  const retained = all(tree).find(item => item.type === 'button' && text(item) === 'فتح الجلسات وحساب الملف')!;
  assert.ok(retained); retained.props.onClick(); assert.deepEqual(opened, [data]);
  for (const changed of [
    { ...h.props, previewOnly: true }, { ...h.props, closing: true },
    { ...h.props, state: state({ selected: data, loading: true }) },
    { ...h.props, state: state({ selected: data, saveStatus: 'retry-required' }) },
    { ...h.props, state: state({ selected: record() }) }, { ...h.props, onOpenClinical: undefined },
  ]) {
    invoke(CloudPatientsWorkspaceView, changed, undefined, refs);
    retained.props.onClick(); assert.equal(opened.length, 1);
  }
});

test('clinical wrapper sends internal UUID only after a fresh selected profile, never public file number', async () => {
  const h = harness(), opened: string[] = [];
  await h.controller.refresh(); const row = h.controller.getState().records[0]; await h.controller.select(row.recordId);
  const props = invoke(CloudPatientsWorkspace, { controller: h.controller, onClose() {}, onOpenClinical: (value: string) => opened.push(value) }).props as CloudPatientsWorkspaceViewProps;
  const selected = props.state.selected!;
  props.onOpenClinical!(record()); assert.deepEqual(opened, []);
  props.onOpenClinical!(selected); assert.deepEqual(opened, [ID]);
  await h.controller.refresh(); props.onOpenClinical!(selected); assert.deepEqual(opened, [ID]);
  h.controller.dispose(); props.onOpenClinical!(selected); assert.deepEqual(opened, [ID]);
});

test('retained clinical wrapper cannot bypass a later preview/closing state or replaced controller', async () => {
  const h = harness(), opened: string[] = [], refs: Array<{ current: any }> = [];
  await h.controller.refresh(); await h.controller.select(ID);
  const base = { controller: h.controller, onClose() {}, onOpenClinical: (value: string) => opened.push(value) };
  const props = invoke(CloudPatientsWorkspace, base, undefined, refs).props as CloudPatientsWorkspaceViewProps;
  const retained = props.onOpenClinical!, selected = props.state.selected!;
  for (const changed of [{ ...base, previewOnly: true }, { ...base, closing: true },
    { ...base, onOpenClinical: undefined }, { ...base, controller: harness().controller }]) {
    invoke(CloudPatientsWorkspace, changed, undefined, refs); retained(selected); assert.deepEqual(opened, []);
  }
  invoke(CloudPatientsWorkspace, base, undefined, refs); retained(selected); assert.deepEqual(opened, [ID]);
  h.controller.dispose();
});

test('patient preparing and history reads block navigation editor and duplicate saves while pending UUID is not a file number', () => {
  const data = record(), draft = { action: 'update' as const, recordId: ID, expectedRevision: 1, profile: data.data };
  for (const change of [{ saveStatus: 'preparing' as const, pendingOperationId: OP }, { recoveryLoading: true }]) {
    const h = viewProps({ state: state({ draft, ...change }) }), view = rendered(h.props);
    assert.equal(view.button('إلغاء وإغلاق').props.disabled, true);
    assert.equal(view.elements.find(item => item.type === 'fieldset')!.props.disabled, true);
    for (const form of view.elements.filter(item => item.type === 'form')) form.props.onSubmit({ preventDefault() {} });
    assert.deepEqual(h.calls, []);
  }
});

test('patient pending recovery action explicitly confirms cancellation and acknowledged state cannot cancel', () => {
  const data = record(), draft = { action: 'update' as const, recordId: ID, expectedRevision: 1, profile: data.data };
  let cancellations = 0;
  const h = viewProps({ state: state({ draft, pendingOperationId: OP, saveStatus: 'retry-required' }), onCancelPending: () => cancellations++ });
  const view = rendered(h.props);
  assert.match(h.html(), /معرّف العملية|سجل الاسترجاع/); assert.doesNotMatch(h.html(), /ذاكرة هذه الشاشة فقط/);
  assert.equal(view.button('تأكيد إلغاء العملية').props.disabled, false); view.button('تأكيد إلغاء العملية').props.onClick(); assert.equal(cancellations, 1);
  h.props.state = state({ draft, pendingOperationId: OP, saveStatus: 'refresh-required' });
  const acknowledged = rendered(h.props); assert.equal(acknowledged.button('تأكيد إلغاء العملية').props.disabled, true);
  acknowledged.button('تأكيد إلغاء العملية').props.onClick(); assert.equal(cancellations, 1);
  h.props.previewOnly = true; assert.doesNotMatch(h.html(), new RegExp(OP));
});

test('patient retained resume cancel and history callbacks recheck current parent props and live pending state', () => {
  const h = harness(), data = record(), draft = { action: 'update' as const, recordId: ID, expectedRevision: 1, profile: data.data };
  let current = state(), resumes = 0, cancels = 0;
  const controller = { ...h.controller, getState: () => current, resume: async () => { resumes++; return true; }, cancelPending: async () => { cancels++; return true; } };
  const refs: Array<{ current: any }> = [], base = { controller, onClose() {} };
  const initial = invoke(CloudPatientsWorkspace, base, undefined, refs).props as CloudPatientsWorkspaceViewProps;
  assert.equal(initial.recoveryCanAct?.(), true); initial.onResume?.(OP); assert.equal(resumes, 1);
  current = state({ draft, pendingOperationId: OP, saveStatus: 'retry-required' });
  assert.equal(initial.recoveryCanAct?.(), false); initial.onResume?.(OP); assert.equal(resumes, 1);
  initial.onCancelPending?.(draft); assert.equal(cancels, 1);
  current = state({ draft, pendingOperationId: OP, saveStatus: 'refresh-required' }); initial.onCancelPending?.(draft); assert.equal(cancels, 1);
  for (const changed of [{ previewOnly: true }, { closing: true }, { controller: harness().controller }]) {
    current = state({ draft, pendingOperationId: OP, saveStatus: 'retry-required' });
    invoke(CloudPatientsWorkspace, { ...base, ...changed }, undefined, refs);
    initial.onResume?.(OP); initial.onCancelPending?.(draft); assert.equal(initial.recoveryCanAct?.(), false);
  }
  assert.equal(resumes, 1); assert.equal(cancels, 1);
});

test('patient view history panel fresh guard masks supplied data and rejects retained callbacks on preview or ordinary drafts', () => {
  const h = viewProps({ recoveryController: harness().controller.recovery, onResume: () => h.calls.push('resume') });
  const refs: Array<{ current: any }> = [];
  const first = invoke(CloudPatientsWorkspaceView, h.props, undefined, refs);
  const panel = all(first).find(item => item.props.controller === h.props.recoveryController)!;
  assert.ok(panel); assert.equal(panel.props.canAct(), true); panel.props.onResume(OP); assert.deepEqual(h.calls, ['resume']);
  const data = record();
  invoke(CloudPatientsWorkspaceView, { ...h.props, state: state({ draft: { action: 'create', recordId: ID, expectedRevision: 0, profile: data.data } }) }, undefined, refs);
  assert.equal(panel.props.canAct(), false); panel.props.onResume(OP);
  invoke(CloudPatientsWorkspaceView, { ...h.props, previewOnly: true }, undefined, refs);
  assert.equal(panel.props.canAct(), false); panel.props.onResume(OP); assert.deepEqual(h.calls, ['resume']);
});
