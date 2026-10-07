import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_UI_LABELS } from '../data/initialData';
import { NAVIGATION_SECTIONS, cloneContentDraft, getHomeSubtitle, getHomeWelcome, getNavigationDescription, getNavigationItems, getNavigationLabel, moveNavigationSection, normalizeNavigationOrder, validateContentDraft, type ContentDraft } from './clinicContent';

const keys = ['patients', 'contacts', 'appointments', 'lab', 'summary', 'settings'];
const makeDraft = (): ContentDraft => {
  const labels: any = { ...DEFAULT_UI_LABELS, tiles: Object.fromEntries(Object.entries(DEFAULT_UI_LABELS.tiles).map(([key, entry]) => [key, { ...entry }])), tabs: { ...DEFAULT_UI_LABELS.tabs }, navigationLabels: { home: 'الرئيسية', patients: 'المرضى', contacts: 'جهات الاتصال', appointments: 'المواعيد', lab: 'التركيبات', summary: 'الماليات', settings: 'الإعدادات' } };
  return { labels, tileOrder: [...keys] };
};
test('order ignores unknown/legacy keys and duplicates, preserves first known occurrences and appends missing', () => {
  const input = ['summary', 'home', 'secretary-desk', 'patients', 'summary', 'lab', 'unknown', 'patients'];
  assert.deepEqual(normalizeNavigationOrder(input), ['summary', 'patients', 'contacts', 'lab', 'appointments', 'settings']);
  assert.deepEqual(input, ['summary', 'home', 'secretary-desk', 'patients', 'summary', 'lab', 'unknown', 'patients']);
  for (const input of [null, undefined, {}, 'patients', 0]) assert.deepEqual(normalizeNavigationOrder(input), keys);
});

test('legacy order adds contacts beside patients without disturbing custom sections or an explicit contacts position', () => {
  const legacy = ['settings', 'summary', 'patients', 'lab', 'appointments'];
  assert.deepEqual(normalizeNavigationOrder(legacy), ['settings', 'summary', 'patients', 'contacts', 'lab', 'appointments']);
  assert.deepEqual(legacy, ['settings', 'summary', 'patients', 'lab', 'appointments']);
  const explicit = ['contacts', 'settings', 'summary', 'patients', 'lab', 'appointments'];
  assert.deepEqual(normalizeNavigationOrder(explicit), explicit);
  assert.deepEqual(normalizeNavigationOrder(['summary', 'settings']), ['summary', 'settings', 'patients', 'contacts', 'appointments', 'lab']);
});
test('legacy default tile names resolve to canonical short navigation labels, not patient tab names', () => {
  assert.deepEqual(NAVIGATION_SECTIONS.map(section => getNavigationLabel(DEFAULT_UI_LABELS, section.key)), ['المرضى', 'جهات الاتصال', 'المواعيد', 'التركيبات', 'الماليات', 'الإعدادات']);
  assert.equal(getNavigationLabel(DEFAULT_UI_LABELS, 'lab'), 'التركيبات');
  assert.equal(DEFAULT_UI_LABELS.tabs.lab, 'حالات المعمل');
  assert.equal(getNavigationLabel(DEFAULT_UI_LABELS, 'home'), 'الرئيسية');
});
test('explicit navigation labels beat custom tile titles and home uses its dedicated fallback', () => {
  const draft = makeDraft();
  const labels: any = draft.labels;
  labels.tiles.patients.title = 'ملفات العيادة';
  delete labels.navigationLabels.patients;
  assert.equal(getNavigationLabel(labels, 'patients'), 'ملفات العيادة');
  labels.navigationLabels.patients = '  مراجعين  ';
  assert.equal(getNavigationLabel(labels, 'patients'), 'مراجعين');
  labels.navigationLabels.home = ' ';
  labels.tabs.home = '  البداية  ';
  assert.equal(getNavigationLabel(labels, 'home'), 'البداية');
  labels.navigationLabels.home = 'لوحة اليوم';
  assert.equal(getNavigationLabel(labels, 'home'), 'لوحة اليوم');
});
test('navigation descriptions and home texts preserve custom content with legacy/blank fallbacks', () => {
  const draft = makeDraft();
  draft.labels.tiles.lab.desc = '  أعمال التركيبات  ';
  assert.equal(getNavigationDescription(draft.labels, 'lab'), 'أعمال التركيبات');
  draft.labels.tiles.lab.desc = '  ';
  assert.equal(getNavigationDescription(draft.labels, 'lab'), DEFAULT_UI_LABELS.tiles.lab.desc);
  assert.equal(getNavigationDescription(draft.labels, 'home'), '');
  assert.equal(getHomeSubtitle(DEFAULT_UI_LABELS), 'مواعيد اليوم والمهام الأساسية في مكان واحد.');
  assert.equal(getHomeWelcome(DEFAULT_UI_LABELS), 'اختر الإجراء المطلوب للمتابعة');
  draft.labels.homeSubtitle = '  شاشة العيادة  ';
  draft.labels.welcomeText = '  أهلاً بك  ';
  assert.equal(getHomeSubtitle(draft.labels), 'شاشة العيادة');
  assert.equal(getHomeWelcome(draft.labels), 'أهلاً بك');
});
test('clone preserves unknown entries and nested fields without aliasing editable saved data', () => {
  const draft = makeDraft();
  const labels: any = draft.labels;
  labels.extra = { nested: ['محفوظ'], optional: undefined };
  labels.tiles.legacy = { title: 'قديم', desc: 'وصف قديم', metadata: { color: 'blue' } };
  labels.navigationLabels.legacy = 'لا يُعدل';
  labels.tabs.lab = 'اسم تبويب المريض';
  const copy = cloneContentDraft(draft);
  assert.deepEqual(copy, draft);
  (copy.labels as any).extra.nested[0] = 'تجربة';
  (copy.labels as any).tiles.legacy.metadata.color = 'red';
  copy.labels.tabs.lab = 'تغيير';
  copy.tileOrder.reverse();
  assert.equal(labels.extra.nested[0], 'محفوظ');
  assert.equal(labels.tiles.legacy.metadata.color, 'blue');
  assert.equal(labels.tabs.lab, 'اسم تبويب المريض');
  assert.deepEqual(draft.tileOrder, keys);
});
test('moves are pure, normalized, and do not cross boundaries or add home to order', () => {
  const input = ['patients', 'lab'];
  assert.deepEqual(moveNavigationSection(input, 'patients', 'up'), ['patients', 'contacts', 'lab', 'appointments', 'summary', 'settings']);
  assert.deepEqual(moveNavigationSection(input, 'lab', 'up'), ['patients', 'lab', 'contacts', 'appointments', 'summary', 'settings']);
  assert.deepEqual(moveNavigationSection(keys, 'settings', 'down'), keys);
  assert.deepEqual(moveNavigationSection(keys, 'patients', 'down'), ['contacts', 'patients', 'appointments', 'lab', 'summary', 'settings']);
  assert.deepEqual(input, ['patients', 'lab']);
});
test('navigation pins home, respects allowed order, and permission denial applies before More splitting', () => {
  const order = ['settings', 'summary', 'lab', 'patients', 'contacts', 'appointments'];
  const items = getNavigationItems(DEFAULT_UI_LABELS, order);
  assert.deepEqual(items.map(item => item.key), ['home', ...order]);
  assert.deepEqual(items.slice(4).map(item => item.key), ['patients', 'contacts', 'appointments']);
  const limited = getNavigationItems(DEFAULT_UI_LABELS, order, { patientView: false, lab: false });
  assert.deepEqual(limited.map(item => item.key), ['home', 'settings', 'summary', 'appointments']);
  assert.deepEqual(limited.slice(4), []);
  assert.deepEqual(getNavigationItems(DEFAULT_UI_LABELS, order, { patientView: false, appointments: false, lab: false, summary: false, controlPanel: false }).map(item => item.key), ['home']);
  assert.deepEqual(order, ['settings', 'summary', 'lab', 'patients', 'contacts', 'appointments']);
});
test('validation trims changed editable fields and preserves tabs, titles, unknown fields and baseline', () => {
  const baseline = makeDraft();
  const baseLabels: any = baseline.labels;
  baseLabels.navigationLabels.lab = '  التركيبات  ';
  baseLabels.navigationLabels.extra = '  قديم  ';
  baseLabels.tiles.patients.title = '  عنوان لم يغيره المستخدم  ';
  baseLabels.tiles.extra = { title: '  قديم  ', desc: '  وصف قديم  ' };
  baseline.labels.tabs.lab = '  حالات المعمل  ';
  const edited = cloneContentDraft(baseline);
  (edited.labels as any).navigationLabels.patients = '  ملفات المرضى  ';
  edited.labels.tiles.patients.desc = '  تفاصيل الملفات  ';
  edited.labels.homeSubtitle = '  شاشة العمل  ';
  const result = validateContentDraft(edited, baseline);
  assert.equal(result.valid, true);
  assert.equal((result.value.labels as any).navigationLabels.patients, 'ملفات المرضى');
  assert.equal((result.value.labels as any).navigationLabels.lab, '  التركيبات  ');
  assert.equal((result.value.labels as any).navigationLabels.extra, '  قديم  ');
  assert.equal(result.value.labels.tiles.patients.title, '  عنوان لم يغيره المستخدم  ');
  assert.equal(result.value.labels.tiles.patients.desc, 'تفاصيل الملفات');
  assert.deepEqual(result.value.labels.tabs, baseline.labels.tabs);
  assert.deepEqual(result.value.labels.tiles.extra, baseline.labels.tiles.extra);
  assert.equal(result.value.labels.homeSubtitle, 'شاشة العمل');
  assert.equal((baseline.labels as any).navigationLabels.patients, 'المرضى');
});
test('navigation labels require one to twenty Unicode characters, including Arabic and home', () => {
  const draft = makeDraft();
  const labels: any = draft.labels;
  labels.navigationLabels.home = ' ';
  labels.navigationLabels.patients = 'أ'.repeat(21);
  labels.navigationLabels.lab = 'قسم\nالتركيبات';
  const invalid = validateContentDraft(draft);
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors['navigationLabels.home']);
  assert.ok(invalid.errors['navigationLabels.patients']);
  assert.ok(invalid.errors['navigationLabels.lab']);
  labels.navigationLabels.home = 'أ';
  labels.navigationLabels.patients = 'أ'.repeat(20);
  labels.navigationLabels.lab = 'التركيبات';
  assert.equal(validateContentDraft(draft).valid, true);
});
test('optional description and home text bounds reject control/newline and accept blank or exact limits', () => {
  const draft = makeDraft();
  draft.labels.tiles.patients.desc = 'أ'.repeat(140);
  draft.labels.homeSubtitle = 'أ'.repeat(180);
  draft.labels.welcomeText = 'أ'.repeat(120);
  assert.equal(validateContentDraft(draft).valid, true);
  draft.labels.tiles.patients.desc += 'أ';
  draft.labels.homeSubtitle += 'أ';
  draft.labels.welcomeText = 'أهلاً\tبك';
  const invalid = validateContentDraft(draft);
  assert.ok(invalid.errors['tiles.patients.desc']);
  assert.ok(invalid.errors.homeSubtitle);
  assert.ok(invalid.errors.welcomeText);
  draft.labels.tiles.patients.desc = '';
  draft.labels.homeSubtitle = '';
  draft.labels.welcomeText = '';
  assert.equal(validateContentDraft(draft).valid, true);
  draft.labels.homeSubtitle = '\n شاشة العمل \n';
  const normalized = validateContentDraft(draft);
  assert.equal(normalized.valid, true);
  assert.equal(normalized.value.labels.homeSubtitle, 'شاشة العمل');
});
test('legacy validation does not invent mapping entries or change patient tabs and fills only order', () => {
  const draft: ContentDraft = { labels: { ...DEFAULT_UI_LABELS, tiles: { ...DEFAULT_UI_LABELS.tiles }, tabs: { ...DEFAULT_UI_LABELS.tabs } }, tileOrder: ['lab', 'secretary-desk', 'lab'] };
  const result = validateContentDraft(draft);
  assert.equal(result.valid, true);
  assert.equal((result.value.labels as any).navigationLabels, undefined);
  assert.deepEqual(result.value.labels.tabs, DEFAULT_UI_LABELS.tabs);
  assert.deepEqual(result.value.tileOrder, ['lab', 'patients', 'contacts', 'appointments', 'summary', 'settings']);
  assert.deepEqual(draft.tileOrder, ['lab', 'secretary-desk', 'lab']);
});
test('all getters safely fall back for null, array, primitive or malformed persisted labels', () => {
  const malformed = [null, undefined, [], ['bad'], 'bad', 0, { tiles: null, tabs: null, navigationLabels: null }, { tiles: [], tabs: [], navigationLabels: [] }, { tiles: { patients: null, lab: 7, summary: { title: {}, desc: false } }, tabs: { home: [] }, navigationLabels: { home: {}, patients: 9 } }];
  for (const labels of malformed) {
    assert.equal(getNavigationLabel(labels, 'patients'), 'المرضى');
    assert.equal(getNavigationLabel(labels, 'home'), 'الرئيسية');
    assert.equal(getNavigationDescription(labels, 'patients'), DEFAULT_UI_LABELS.tiles.patients.desc);
    assert.equal(getHomeSubtitle(labels), 'مواعيد اليوم والمهام الأساسية في مكان واحد.');
    assert.equal(getHomeWelcome(labels), 'اختر الإجراء المطلوب للمتابعة');
    assert.equal(getNavigationItems(labels, null).length, 7);
  }
});
test('clone and validation recover malformed shape in memory without writing or mutating the source', () => {
  for (const input of [null, undefined, [], 'bad', { labels: null, tileOrder: null }, { labels: [], tileOrder: {} }, { labels: { tiles: null, tabs: 'bad', navigationLabels: 7 }, tileOrder: ['lab', null, 'lab'] }]) {
    assert.doesNotThrow(() => cloneContentDraft(input));
    const clone = cloneContentDraft(input);
    assert.equal(getNavigationLabel(clone.labels, 'patients'), 'المرضى');
    assert.equal(typeof clone.labels.tiles.patients.title, 'string');
    assert.equal(clone.tileOrder.length, 6);
    const checked = validateContentDraft(input, null);
    assert.equal(checked.valid, true);
    assert.equal(checked.value.tileOrder.length, 6);
  }
  const source = { labels: { homeSubtitle: null, welcomeText: [], extra: { nested: ['unchanged'] }, tiles: { patients: { title: null, desc: 42, metadata: { original: true } }, extra: { title: 'legacy', desc: 'legacy desc' } }, tabs: { lab: 'custom patient tab', home: 42, custom: 'untouched' }, navigationLabels: { patients: {}, extra: 'legacy mapping' } }, tileOrder: ['settings', 'settings', 42] };
  const snapshot = JSON.stringify(source);
  const checked = validateContentDraft(source);
  assert.equal(checked.valid, true);
  assert.equal(JSON.stringify(source), snapshot);
  assert.equal(checked.value.labels.tabs.lab, 'custom patient tab');
  assert.equal(checked.value.labels.tabs.custom, 'untouched');
  assert.equal((checked.value.labels as any).navigationLabels.extra, 'legacy mapping');
  assert.deepEqual((checked.value.labels as any).extra, source.labels.extra);
  assert.deepEqual((checked.value.labels.tiles.patients as any).metadata, { original: true });
  assert.equal(checked.value.labels.tiles.patients.desc, DEFAULT_UI_LABELS.tiles.patients.desc);
  assert.equal(checked.value.labels.tiles.extra.desc, 'legacy desc');
  (checked.value.labels as any).extra.nested[0] = 'preview';
  assert.equal(source.labels.extra.nested[0], 'unchanged');
});
