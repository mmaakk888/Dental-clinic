import type { DrugCatalogItem } from '../types';

export type DrugCatalogDraft = Pick<DrugCatalogItem, 'name' | 'category' | 'defaultDosage' | 'defaultDuration'>;
export type DrugCatalogSort = 'name' | 'category';
export const DRUG_FIELD_LIMITS = { name: 120, category: 60, defaultDosage: 200, defaultDuration: 120 } as const;
const collator = new Intl.Collator('ar', { numeric: true, sensitivity: 'base' });
const singleLineControls = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const text = (value: unknown): string => typeof value === 'string' ? value : '';

/** Lookup normalization only: never rewrites a stored drug name or regimen. */
export function normalizeDrugLookup(value: unknown): string {
  return text(value).normalize('NFKD').replace(/\p{M}/gu, '').replace(/ـ/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي')
    .replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x6f0))
    .toLocaleLowerCase('en').trim().replace(/\s+/g, ' ');
}

export function drugCatalogDraft(item?: Partial<DrugCatalogItem>): DrugCatalogDraft {
  return {
    name: text(item?.name), category: text(item?.category),
    defaultDosage: text(item?.defaultDosage), defaultDuration: text(item?.defaultDuration),
  };
}

export function getDrugCategories(items: readonly DrugCatalogItem[]): string[] {
  const categories = new Map<string, string>();
  items.forEach(item => {
    const label = text(item.category).trim();
    const key = normalizeDrugLookup(label);
    if (key && !categories.has(key)) categories.set(key, label);
  });
  return [...categories.values()].sort(collator.compare);
}

export function filterDrugCatalog(items: readonly DrugCatalogItem[], options: { query?: string; category?: string | null; sort?: DrugCatalogSort } = {}): DrugCatalogItem[] {
  const terms = normalizeDrugLookup(options.query).split(' ').filter(Boolean);
  const category = options.category == null ? null : normalizeDrugLookup(options.category);
  return items.filter(item => {
    if (category !== null && normalizeDrugLookup(item.category) !== category) return false;
    const searchable = normalizeDrugLookup(`${text(item.name)} ${text(item.category)}`);
    return terms.every(term => searchable.includes(term));
  }).sort((left, right) => {
    const categoryOrder = options.sort === 'category' ? collator.compare(text(left.category), text(right.category)) : 0;
    return categoryOrder || collator.compare(text(left.name), text(right.name));
  });
}

export function validateDrugCatalogDraft(draft: DrugCatalogDraft, items: readonly DrugCatalogItem[], editingId?: string): { valid: boolean; value: DrugCatalogDraft; errors: Partial<Record<keyof DrugCatalogDraft, string>> } {
  const value = drugCatalogDraft(draft);
  const errors: Partial<Record<keyof DrugCatalogDraft, string>> = {};
  const labels: Record<keyof DrugCatalogDraft, string> = { name: 'اسم الدواء', category: 'التصنيف', defaultDosage: 'نص الجرعة', defaultDuration: 'مدة العلاج' };
  (Object.keys(DRUG_FIELD_LIMITS) as Array<keyof DrugCatalogDraft>).forEach(key => {
    value[key] = value[key].trim();
    if (singleLineControls.test(text(draft[key]))) errors[key] = `${labels[key]} يجب أن يكون في سطر واحد بدون رموز تحكم.`;
    else if (Array.from(value[key]).length > DRUG_FIELD_LIMITS[key]) errors[key] = `${labels[key]} لا يتجاوز ${DRUG_FIELD_LIMITS[key]} حرفًا.`;
  });
  if (!value.name) errors.name = 'اكتب اسم الدواء والتركيز.';
  else if (!errors.name && items.some(item => item.id !== editingId && normalizeDrugLookup(item.name) === normalizeDrugLookup(value.name))) {
    errors.name = 'الدواء موجود بالفعل بهذا الاسم والتركيز. عدّل الدواء الموجود بدل تكراره.';
  }
  return { valid: Object.keys(errors).length === 0, value, errors };
}

/** Unknown fields and existing IDs survive editing; unrelated items are never mutated. */
export function upsertDrugCatalogItem(items: readonly DrugCatalogItem[], draft: DrugCatalogDraft, editingId: string | undefined, newId: string): DrugCatalogItem[] {
  const checked = validateDrugCatalogDraft(draft, items, editingId);
  if (!checked.valid) throw new Error(Object.values(checked.errors)[0]);
  if (editingId !== undefined) {
    if (!items.some(item => item.id === editingId)) throw new Error('لم يعد الدواء موجودًا. أغلق النافذة وأعد فتح القائمة.');
    return items.map(item => item.id === editingId ? { ...item, ...checked.value } : item);
  }
  if (!newId || items.some(item => item.id === newId)) throw new Error('تعذّر إنشاء رقم للدواء. أعد المحاولة.');
  return [...items, { id: newId, ...checked.value }];
}

export const drugCatalogSnapshot = (items: readonly DrugCatalogItem[]): string => JSON.stringify(items);
export const drugCatalogChanged = (baseline: string, items: readonly DrugCatalogItem[]): boolean => baseline !== drugCatalogSnapshot(items);
