import test from 'node:test';
import assert from 'node:assert/strict';
import type { DrugCatalogItem } from '../types';
import { DRUG_FIELD_LIMITS, drugCatalogChanged, drugCatalogDraft, drugCatalogSnapshot, filterDrugCatalog, getDrugCategories, normalizeDrugLookup, upsertDrugCatalogItem, validateDrugCatalogDraft } from './drugCatalog';

const makeItems = (): DrugCatalogItem[] => [
  { id: 'a', name: 'أموكس ٥٠٠', category: 'مضاد حيوي', defaultDosage: 'نص كتبه الطبيب', defaultDuration: 'مدة يحددها الطبيب' },
  { id: 'b', name: 'Drug 2', category: 'مسكن', defaultDosage: '', defaultDuration: '' },
  { id: 'c', name: 'Drug 10', category: '', defaultDosage: '', defaultDuration: '' },
];

test('lookup folds Arabic/Latin marks, alef, tatweel, and both Arabic numeral styles without altering source', () => {
  const input = '  أَمُـوكس ٥٠٠  ';
  assert.equal(normalizeDrugLookup(input), 'اموكس 500');
  assert.equal(normalizeDrugLookup('AMÓX ۵۰۰'), 'amox 500');
  assert.equal(normalizeDrugLookup('إ آ ٱ'), 'ا ا ا');
  assert.equal(input, '  أَمُـوكس ٥٠٠  ');
  assert.equal(normalizeDrugLookup(null), '');
});

test('search uses name/category and all query terms, numeric sorting and blank classification', () => {
  const items = makeItems();
  const snapshot = JSON.stringify(items);
  assert.deepEqual(filterDrugCatalog(items, { query: 'اموكس 500' }).map(item => item.id), ['a']);
  assert.deepEqual(filterDrugCatalog(items, { query: 'مضاد اموكس' }).map(item => item.id), ['a']);
  assert.deepEqual(filterDrugCatalog(items, { query: 'drug' }).map(item => item.id), ['b', 'c']);
  assert.deepEqual(filterDrugCatalog(items, { category: '' }).map(item => item.id), ['c']);
  assert.deepEqual(filterDrugCatalog(items, { category: ' مُضاد حيوي ' }).map(item => item.id), ['a']);
  assert.deepEqual(filterDrugCatalog(items, { query: 'غير موجود' }), []);
  assert.equal(JSON.stringify(items), snapshot);
});

test('categories omit blank, deduplicate normalized spelling and preserve first human-written label', () => {
  const items = [...makeItems(), { ...makeItems()[0], id: 'd', category: 'مُضاد حيوي' }];
  assert.deepEqual(getDrugCategories(items), ['مسكن', 'مضاد حيوي']);
});

test('name is required and duplicates normalize Arabic, Latin, digits and exclude own ID', () => {
  const items = makeItems();
  assert.equal(validateDrugCatalogDraft(drugCatalogDraft({ name: ' ' }), items).valid, false);
  assert.ok(validateDrugCatalogDraft(drugCatalogDraft({ name: 'اموكس 500' }), items).errors.name);
  assert.equal(validateDrugCatalogDraft(drugCatalogDraft({ name: 'أموكس ٥٠٠' }), items, 'a').valid, true);
  assert.equal(validateDrugCatalogDraft(drugCatalogDraft({ name: 'أموكس ٢٥٠' }), items).valid, true);
  assert.ok(validateDrugCatalogDraft(drugCatalogDraft({ name: 'DRUG ٢' }), items).errors.name);
});

test('validation trims authored fields, permits blank dose/category/duration and never generates a regimen', () => {
  const input = drugCatalogDraft({ name: '  دواء جديد  ', category: '  تصنيف خاص  ', defaultDosage: ' ', defaultDuration: '' });
  const checked = validateDrugCatalogDraft(input, makeItems());
  assert.equal(checked.valid, true);
  assert.deepEqual(checked.value, { name: 'دواء جديد', category: 'تصنيف خاص', defaultDosage: '', defaultDuration: '' });
  assert.equal(input.name, '  دواء جديد  ');
});

test('all field bounds count Unicode characters and reject control/newline characters', () => {
  for (const key of Object.keys(DRUG_FIELD_LIMITS) as Array<keyof typeof DRUG_FIELD_LIMITS>) {
    const draft = drugCatalogDraft({ name: 'دواء جديد' });
    draft[key] = 'أ'.repeat(DRUG_FIELD_LIMITS[key]);
    assert.equal(validateDrugCatalogDraft(draft, []).valid, true, key);
    draft[key] += 'أ';
    assert.ok(validateDrugCatalogDraft(draft, []).errors[key], key);
    draft[key] = 'نص\nآخر';
    assert.ok(validateDrugCatalogDraft(draft, []).errors[key], key);
    draft[key] = 'نص\u0000آخر';
    assert.ok(validateDrugCatalogDraft(draft, []).errors[key], key);
  }
});

test('editing preserves IDs and unknown extra fields while leaving unrelated items and input untouched', () => {
  const items = makeItems();
  (items[0] as any).extra = { source: 'clinic' };
  const baseline = JSON.stringify(items);
  const updated = upsertDrugCatalogItem(items, { ...drugCatalogDraft(items[0]), name: 'اسم جديد', defaultDosage: '' }, 'a', 'unused');
  assert.equal(updated[0].id, 'a');
  assert.deepEqual((updated[0] as any).extra, { source: 'clinic' });
  assert.equal(updated[0].defaultDosage, '');
  assert.equal(updated[0].defaultDuration, items[0].defaultDuration);
  assert.equal(updated[1], items[1]);
  assert.equal(JSON.stringify(items), baseline);
});

test('adding preserves existing ordering and refuses conflicting or empty IDs and removed edit targets', () => {
  const items = makeItems();
  const draft = drugCatalogDraft({ name: 'دواء جديد' });
  const updated = upsertDrugCatalogItem(items, draft, undefined, 'new');
  assert.deepEqual(updated.map(item => item.id), ['a', 'b', 'c', 'new']);
  assert.equal(updated[3].defaultDosage, '');
  assert.throws(() => upsertDrugCatalogItem(items, draft, undefined, 'a'));
  assert.throws(() => upsertDrugCatalogItem(items, draft, undefined, ''));
  assert.throws(() => upsertDrugCatalogItem(items, draft, 'removed', 'unused'));
});

test('snapshot detects prop-list changes, including another drug and unknown metadata, without mutating', () => {
  const items = makeItems();
  const snapshot = drugCatalogSnapshot(items);
  assert.equal(drugCatalogChanged(snapshot, items.map(item => ({ ...item }))), false);
  assert.equal(drugCatalogChanged(snapshot, [...items].reverse()), true);
  assert.equal(drugCatalogChanged(snapshot, items.map(item => item.id === 'b' ? { ...item, defaultDuration: 'تعديل جديد' } : item)), true);
  assert.equal(drugCatalogChanged(snapshot, [...items, { ...items[0], id: 'new' }]), true);
});
