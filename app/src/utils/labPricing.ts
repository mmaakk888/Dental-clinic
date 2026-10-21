import type { Lab, LabService } from '../types';
import { normalizeServiceName, parseCatalogPrice } from './serviceCatalog';

export type LabPricingDraftRow = Omit<LabService, 'price'> & { price: string };
export interface LabPricingValidation {
  valid: boolean;
  services: LabService[];
  errors: Record<string, string>;
}

function cloneValue<T>(value: T, seen = new WeakMap<object, any>()): T {
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  if (value instanceof Date) return new Date(value.getTime()) as T;
  const copy: any = Array.isArray(value) ? new Array(value.length) : {};
  seen.set(value, copy);
  Object.entries(value).forEach(([key, entry]) => Object.defineProperty(copy, key, {
    value: cloneValue(entry, seen), writable: true, configurable: true, enumerable: true,
  }));
  return copy;
}

/** Keep the complete lab snapshot, including metadata outside the pricing editor. */
export function cloneLab(lab: Lab): Lab {
  return cloneValue(lab);
}

/** Internal comparison token; never render this snapshot in the interface. */
export function snapshotLab(lab: Lab): string {
  return JSON.stringify(lab);
}

export function createLabPricingDraft(lab: Lab): LabPricingDraftRow[] {
  return (Array.isArray(lab.services) ? lab.services : []).map(service => {
    const copy = cloneValue(service) as unknown as LabPricingDraftRow;
    copy.price = service.price === undefined || service.price === null ? '' : String(service.price);
    return copy;
  });
}

const hasLineOrControl = (value: string) => /[\p{Cc}\u2028\u2029]/u.test(value);
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function validateLabel(value: unknown, limit: number, field: string): string {
  if (typeof value !== 'string' || !value.trim() || !normalizeServiceName(value)) return `${field} مطلوب.`;
  if (hasLineOrControl(value)) return `اكتب ${field} في سطر واحد دون رموز تحكم.`;
  if (Array.from(value.trim()).length > limit) return `${field} يجب ألا يتجاوز ${limit === 80 ? '٨٠' : '٤٠'} حرفًا.`;
  return '';
}

export function validateLabPricingDraft(
  rows: readonly LabPricingDraftRow[],
  baselineServices: readonly LabService[] = [],
): LabPricingValidation {
  const errors: Record<string, string> = {};
  if (!Array.isArray(rows)) return { valid: false, services: [], errors: { services: 'قائمة خدمات المعمل غير صحيحة.' } };
  const baseline = Array.isArray(baselineServices) ? baselineServices : [];
  const ids = rows.map(row => isRecord(row) && typeof row.id === 'string' ? row.id : '');
  const names = rows.map(row => isRecord(row) ? normalizeServiceName(row.name) : '');
  const services = rows.map((entry, index) => {
    const row = isRecord(entry) ? entry : {};
    const previous = baseline.find(service => typeof row.id === 'string' && service.id === row.id);
    const copy = cloneValue(previous || {}) as unknown as LabService;
    Object.entries(cloneValue(row)).forEach(([key, value]) => Object.defineProperty(copy, key, {
      value, writable: true, configurable: true, enumerable: true,
    }));
    const key = `services.${index}`;
    if (typeof row.id !== 'string' || !row.id.trim() || hasLineOrControl(row.id)) errors[`${key}.id`] = 'معرّف الخدمة غير صحيح.';
    else if (ids.some((id, other) => other !== index && id === row.id)) errors[`${key}.id`] = 'معرّف الخدمة مكرر.';
    const nameError = validateLabel(row.name, 80, 'اسم الخدمة');
    if (nameError) errors[`${key}.name`] = nameError;
    else if (names.some((name, other) => other !== index && name === names[index])) errors[`${key}.name`] = 'اسم الخدمة موجود بالفعل في هذا المعمل.';
    const unitError = validateLabel(row.unitLabel, 40, 'اسم الوحدة');
    if (unitError) errors[`${key}.unitLabel`] = unitError;
    if (!['fixed', 'removable', 'other'].includes(row.category as string)) errors[`${key}.category`] = 'اختر تصنيفًا صحيحًا للخدمة.';
    const price = parseCatalogPrice(row.price as string);
    if (!price.valid) errors[`${key}.price`] = price.error || 'اكتب تكلفة صحيحة للمعمل.';
    else copy.price = price.value!;
    // Unchanged labels retain the original spelling; only new or edited labels are trimmed.
    if (!nameError && typeof row.name === 'string') copy.name = previous?.name === row.name ? previous.name : row.name.trim();
    if (!unitError && typeof row.unitLabel === 'string') copy.unitLabel = previous?.unitLabel === row.unitLabel ? previous.unitLabel : row.unitLabel.trim();
    return copy;
  });
  return { valid: Object.keys(errors).length === 0, services, errors };
}
