import { DEFAULT_PATIENT_CROWN_PRICES, DEFAULT_SERVICE_TYPES } from '../data/initialData';

export interface ServiceCatalogValues {
  serviceTypes: string[];
  crownPrices: Record<string, number>;
}
export interface ServiceNameValidation { valid: boolean; value: string; error: string }
export interface CatalogPriceValidation { valid: boolean; value: number | undefined; error?: string }
export interface ServiceCatalogValidation { valid: boolean; value: ServiceCatalogValues; errors: Record<string, string> }

export const PROTECTED_SERVICE_TYPES: readonly string[] = ['تركيبات - ثابتة', 'تركيبات - متحركة'];
const MAX_SERVICES = 300;
const MAX_PRICE = 10_000_000;
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const record = (value: unknown): Record<string, unknown> => isRecord(value) ? value : {};
const hasOwn = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const hasLineOrControl = (value: string) => /[\p{Cc}\u2028\u2029]/u.test(value);
const normalizeDigits = (value: string) => value.replace(/[٠-٩۰-۹]/g,
  digit => String('٠١٢٣٤٥٦٧٨٩'.includes(digit) ? '٠١٢٣٤٥٦٧٨٩'.indexOf(digit) : '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));

// Lookups use normalized names, while the persisted labels retain their spelling.
export function normalizeServiceName(value: unknown): string {
  if (typeof value !== 'string') return '';
  return normalizeDigits(value.normalize('NFKC'))
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
    .replace(/ـ/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/[ىی]/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function getServiceGroup(name: unknown): 'clinical' | 'prosthetic' {
  return normalizeServiceName(name).startsWith('تركيب') ? 'prosthetic' : 'clinical';
}

export function isProtectedServiceType(name: unknown): boolean {
  return typeof name === 'string' && PROTECTED_SERVICE_TYPES.includes(name);
}

function cloneValue<T>(value: T, seen = new WeakMap<object, any>()): T {
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  if (value instanceof Date) return new Date(value.getTime()) as T;
  const copy: any = Array.isArray(value) ? new Array(value.length) : {};
  seen.set(value, copy);
  Object.entries(value).forEach(([key, entry]) => Object.defineProperty(copy, key,
    { value: cloneValue(entry, seen), writable: true, configurable: true, enumerable: true }));
  return copy;
}

// Invalid price entries remain present so the editor can report them and retain its draft.
export function cloneServiceCatalog(input: unknown): ServiceCatalogValues {
  const source = record(input);
  const serviceTypes = Array.isArray(source.serviceTypes) && source.serviceTypes.every(name => typeof name === 'string')
    ? [...source.serviceTypes] : [...DEFAULT_SERVICE_TYPES];
  const prices = isRecord(source.crownPrices) ? source.crownPrices : DEFAULT_PATIENT_CROWN_PRICES;
  return { serviceTypes, crownPrices: cloneValue(prices) as Record<string, number> };
}

export function validateServiceName(value: unknown, list: readonly string[], excludedIndex?: number): ServiceNameValidation {
  const failure = (error: string): ServiceNameValidation => ({ valid: false, value: typeof value === 'string' ? value.trim() : '', error });
  if (typeof value !== 'string') return failure('اكتب اسمًا صحيحًا للخدمة.');
  if (hasLineOrControl(value)) return failure('اكتب الاسم في سطر واحد دون رموز تحكم.');
  const trimmed = value.trim();
  if (!trimmed || !normalizeServiceName(trimmed)) return failure('اسم الخدمة مطلوب.');
  if (Array.from(trimmed).length > 80) return failure('اسم الخدمة يجب ألا يتجاوز ٨٠ حرفًا.');
  const normalized = normalizeServiceName(trimmed);
  if (list.some((name, index) => index !== excludedIndex && normalizeServiceName(name) === normalized)) {
    return failure('اسم الخدمة موجود بالفعل في الفهرس.');
  }
  return { valid: true, value: trimmed, error: '' };
}

export function parseCatalogPrice(value: string | number): CatalogPriceValidation {
  const failure = (error: string): CatalogPriceValidation => ({ valid: false, value: undefined, error });
  if (typeof value !== 'string' && typeof value !== 'number') return failure('اكتب سعرًا صحيحًا.');
  const raw = String(value);
  if (hasLineOrControl(raw)) return failure('اكتب السعر كرقم في سطر واحد.');
  const normalized = normalizeDigits(raw.trim()).replace(/٫/g, '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return failure('اكتب سعرًا غير سالب، وبحد أقصى منزلتين عشريتين.');
  const price = Number(normalized);
  if (!Number.isFinite(price) || price > MAX_PRICE) return failure('السعر يجب ألا يتجاوز ١٠٬٠٠٠٬٠٠٠ ج.م.');
  return { valid: true, value: price };
}

export function validateServiceCatalog(input: unknown, baseline?: unknown): ServiceCatalogValidation {
  const value = cloneServiceCatalog(input);
  const suppliedNames = [...value.serviceTypes];
  const previous = baseline === undefined ? undefined : cloneServiceCatalog(baseline);
  const errors: Record<string, string> = {};
  if (!value.serviceTypes.length) errors.serviceTypes = 'احتفظ بخدمة واحدة على الأقل في الفهرس.';
  else if (value.serviceTypes.length > MAX_SERVICES) errors.serviceTypes = 'الفهرس يجب ألا يتجاوز ٣٠٠ خدمة.';

  value.serviceTypes.forEach((name, index) => {
    const result = validateServiceName(name, value.serviceTypes, index);
    if (!result.valid) errors[`serviceTypes.${index}`] = result.error;
    // Moving an existing entry does not alter its original spelling or spaces.
    else if (!previous || !previous.serviceTypes.includes(name)) value.serviceTypes[index] = result.value;
  });

  if (previous) PROTECTED_SERVICE_TYPES.forEach(name => {
    const index = previous.serviceTypes.indexOf(name);
    if (index >= 0 && !suppliedNames.includes(name)) {
      errors[`serviceTypes.${index}`] = 'هذا النوع مرتبط بتسجيل التركيبات؛ احتفظ باسمه كما هو.';
    }
  });

  Object.keys(value.crownPrices).forEach(key => {
    const result = parseCatalogPrice(value.crownPrices[key]);
    if (!result.valid) errors[`crownPrices.${key}`] = result.error!;
    else Object.defineProperty(value.crownPrices, key,
      { value: result.value!, writable: true, configurable: true, enumerable: true });
  });
  // Existing crown keys are labels, not rename targets or generic treatment prices.
  if (previous) Object.keys(previous.crownPrices).forEach(key => {
    if (!hasOwn(value.crownPrices, key)) errors[`crownPrices.${key}`] = 'احتفظ بنوع التركيبة الحالي وسعره في الفهرس.';
  });
  return { valid: Object.keys(errors).length === 0, value, errors };
}
