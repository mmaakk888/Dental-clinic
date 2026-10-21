import test from 'node:test';
import assert from 'node:assert/strict';
import { getHomeLayout, HOME_SECTIONS, isValidHomeLayout, moveHomeSection } from './homeLayout';
import { cloneContentDraft, validateContentDraft } from './clinicContent';
import { DEFAULT_UI_LABELS } from '../data/initialData';
import { assertClinicBackup, validateClinicBackup } from './backupValidation';

const keys = HOME_SECTIONS.map(section => section.key);
test('legacy home defaults keep four sections, current spacing and six appointments without writing or aliases', () => {
  for (const labels of [undefined, null, [], '', {}, { homeLayout: null }]) {
    assert.deepEqual(getHomeLayout(labels), { sectionOrder: keys, hiddenSections: [], density: 'comfortable', appointmentLimit: 6 });
  }
  const first = getHomeLayout({}); first.sectionOrder.reverse(); first.hiddenSections.push('actions');
  assert.deepEqual(getHomeLayout({}).sectionOrder, keys);
  assert.deepEqual(getHomeLayout({}).hiddenSections, []);
});

test('read fallback bounds malformed layout, retains known order and ignores unknown hidden sections', () => {
  const source = { homeLayout: { sectionOrder: ['schedule', 'unknown', 'schedule', 'actions'], hiddenSections: ['metrics', 'metrics', 'unknown'], density: 'huge', appointmentLimit: 100000 } };
  const snapshot = structuredClone(source);
  assert.deepEqual(getHomeLayout(source), { sectionOrder: ['schedule', 'actions', 'metrics', 'followUp'], hiddenSections: ['metrics'], density: 'comfortable', appointmentLimit: 6 });
  assert.deepEqual(source, snapshot);
});

test('explicit settings require complete known fields and bounded unique section keys', () => {
  const valid = getHomeLayout({});
  assert.equal(isValidHomeLayout(undefined), true);
  assert.equal(isValidHomeLayout(valid), true);
  for (const invalid of [null, [], {}, { ...valid, extra: true }, { ...valid, sectionOrder: ['actions'] },
    { ...valid, sectionOrder: ['actions', 'actions', 'metrics', 'schedule'] }, { ...valid, hiddenSections: ['metrics', 'metrics'] },
    { ...valid, hiddenSections: ['unknown'] }, { ...valid, density: 'large' }, { ...valid, appointmentLimit: 7 },
    { ...valid, appointmentLimit: '6' }, { ...valid, hiddenSections: false }]) assert.equal(isValidHomeLayout(invalid), false);
  for (const appointmentLimit of [3, 6, 10]) assert.equal(isValidHomeLayout({ ...valid, appointmentLimit }), true);
  assert.equal(isValidHomeLayout({ ...valid, hiddenSections: [...keys] }), true);
});

test('moving home sections is pure and does not cross boundaries or change visibility', () => {
  const source = { ...getHomeLayout({}), hiddenSections: ['metrics' as const] };
  assert.deepEqual(moveHomeSection(source, 'actions', 'up'), source);
  assert.deepEqual(moveHomeSection(source, 'followUp', 'down'), source);
  const moved = moveHomeSection(source, 'schedule', 'up');
  assert.deepEqual(moved.sectionOrder, ['actions', 'schedule', 'metrics', 'followUp']);
  assert.deepEqual(moved.hiddenSections, ['metrics']);
  moved.hiddenSections.push('actions');
  assert.deepEqual(source.sectionOrder, keys);
  assert.deepEqual(source.hiddenSections, ['metrics']);
});

test('content draft validation preserves layout and rejects malformed explicit home options', () => {
  const draft = { labels: { ...DEFAULT_UI_LABELS, homeLayout: { ...getHomeLayout({}), density: 'compact' as const, hiddenSections: ['metrics' as const] } }, tileOrder: [] };
  assert.equal(validateContentDraft(draft).valid, true);
  const clone = cloneContentDraft(draft);
  clone.labels.homeLayout!.sectionOrder.reverse();
  assert.deepEqual(draft.labels.homeLayout.sectionOrder, keys);
  assert.ok(validateContentDraft({ ...draft, labels: { ...draft.labels, homeLayout: { ...draft.labels.homeLayout, unsafe: true } } }).errors.homeLayout);
  assert.equal(validateContentDraft({ labels: DEFAULT_UI_LABELS }).value.labels.homeLayout, undefined);
});

test('full backup accepts and clones home preferences, rejects unknown behavior and keeps legacy omission', () => {
  const labels = { ...DEFAULT_UI_LABELS, homeLayout: getHomeLayout({}) };
  const value = assertClinicBackup({ labels });
  assert.deepEqual(value.labels!.homeLayout, labels.homeLayout);
  value.labels!.homeLayout!.sectionOrder.reverse();
  assert.deepEqual(labels.homeLayout.sectionOrder, keys);
  assert.equal(validateClinicBackup({ labels: { ...labels, homeLayout: { ...labels.homeLayout, exportData: true } } }).valid, false);
  assert.equal(validateClinicBackup({ labels: { ...labels, homeLayout: { ...labels.homeLayout, appointmentLimit: 999 } } }).valid, false);
  assert.equal(assertClinicBackup({ labels: DEFAULT_UI_LABELS }).labels!.homeLayout, undefined);
});
