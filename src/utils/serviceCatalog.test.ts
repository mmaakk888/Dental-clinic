import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PATIENT_CROWN_PRICES, DEFAULT_SERVICE_TYPES } from '../data/initialData';
import { cloneServiceCatalog, getServiceGroup, isProtectedServiceType, normalizeServiceName, parseCatalogPrice, PROTECTED_SERVICE_TYPES, validateServiceCatalog, validateServiceName } from './serviceCatalog';

test('name normalization combines Arabic variants, marks, spaces, digits and case only for lookup', () => {
  const original = '  إِطـْباق   عَلى ۱۲٣ ABC  ';
  assert.equal(normalizeServiceName(original), 'اطباق علي 123 abc');
  assert.equal(original, '  إِطـْباق   عَلى ۱۲٣ ABC  ');
  assert.equal(normalizeServiceName('آ إ أ ٱ ى ی'), 'ا ا ا ا ي ي');
  assert.equal(normalizeServiceName(null), '');
  assert.equal(getServiceGroup('  تَرْكيبات - ثابتة'), 'prosthetic');
  assert.equal(getServiceGroup('حشو ليزر'), 'clinical');
  assert.equal(getServiceGroup('خدمة تركيب'), 'clinical');
});

test('catalog clones preserve exact valid names and use independent defaults for invalid shapes', () => {
  const names = ['  حشو   ليزر  ', 'نوع قديم'];
  const source = { serviceTypes: names, crownPrices: { PFM: 0, 'نوع مخصص': 75.5 } };
  const copy = cloneServiceCatalog(source);
  assert.deepEqual(copy, source);
  copy.serviceTypes.reverse();
  copy.crownPrices.PFM = 600;
  assert.deepEqual(names, ['  حشو   ليزر  ', 'نوع قديم']);
  assert.equal(source.crownPrices.PFM, 0);

  for (const input of [null, undefined, [], 3, 'bad', { serviceTypes: null, crownPrices: [] }, { serviceTypes: [3], crownPrices: 'bad' }]) {
    const fallback = cloneServiceCatalog(input);
    assert.deepEqual(fallback.serviceTypes, DEFAULT_SERVICE_TYPES);
    assert.deepEqual(fallback.crownPrices, DEFAULT_PATIENT_CROWN_PRICES);
    fallback.serviceTypes.push('مسودة');
    fallback.crownPrices.PFM = 0;
    assert.notEqual(DEFAULT_SERVICE_TYPES.at(-1), 'مسودة');
    assert.equal(DEFAULT_PATIENT_CROWN_PRICES.PFM, 1200);
  }
  assert.deepEqual(cloneServiceCatalog({ serviceTypes: [], crownPrices: {} }), { serviceTypes: [], crownPrices: {} });
});

test('price map cloning copies own keys safely and retains malformed values without aliasing', () => {
  const prices: any = Object.create({ inherited: 999 });
  Object.defineProperty(prices, '__proto__', { enumerable: true, value: 50 });
  prices.constructor = 60;
  prices['نوع مخصص'] = { invalid: ['keep'] };
  prices.PFM = NaN;
  const source = { serviceTypes: ['حشو'], crownPrices: prices };
  const copy = cloneServiceCatalog(source);
  assert.equal(Object.hasOwn(copy.crownPrices, 'inherited'), false);
  assert.equal(Object.hasOwn(copy.crownPrices, '__proto__'), true);
  assert.equal(copy.crownPrices.__proto__, 50);
  assert.equal(copy.crownPrices.constructor as unknown, 60);
  assert.equal(Object.getPrototypeOf(copy.crownPrices), Object.prototype);
  assert.ok(Number.isNaN(copy.crownPrices.PFM));
  (copy.crownPrices['نوع مخصص'] as any).invalid.push('changed');
  assert.deepEqual(prices['نوع مخصص'], { invalid: ['keep'] });
});

test('name validation detects normalized duplicates and respects the edited index', () => {
  const names = ['علاج عصب', 'إزالة جير', 'PFM ١'];
  assert.equal(validateServiceName('  علاج عصب  ', names).valid, false);
  assert.equal(validateServiceName('اِزالة   جير', names).valid, false);
  assert.equal(validateServiceName('pfm ۱', names).valid, false);
  assert.deepEqual(validateServiceName('  علاج عصب  ', names, 0), { valid: true, value: 'علاج عصب', error: '' });
  assert.equal(validateServiceName('تنظيف', names).valid, true);
  for (const name of ['', '   ', 'ـَ', 'خدمة\nجديدة', '\tخدمة', 'خدمة\u0085', 'خدمة\u2028ثانية', null, 5]) {
    assert.equal(validateServiceName(name, []).valid, false, String(name));
  }
  assert.equal(validateServiceName('🦷'.repeat(80), []).valid, true);
  assert.equal(validateServiceName('🦷'.repeat(81), []).valid, false);
});

test('plain catalog prices allow zero, Arabic or Persian digits and at most two decimals', () => {
  for (const [input, expected] of [[0, 0], ['٠', 0], ['۰', 0], [' ١٢٣٫٤٥ ', 123.45], ['۱۲۳.۴۵', 123.45], [75.5, 75.5], ['0005.20', 5.2], [10_000_000, 10_000_000]] as const) {
    assert.deepEqual(parseCatalogPrice(input), { valid: true, value: expected });
  }
  for (const input of ['', ' ', -1, '-0.1', Infinity, NaN, 'Infinity', '1e3', '0x10', '+10', '1,000', '١٬٠٠٠', '1.234', '.5', '1.', '10000000.01', '\n10', null, {}, false]) {
    const result = parseCatalogPrice(input as any);
    assert.equal(result.valid, false, String(input));
    assert.equal(result.value, undefined);
    assert.ok(result.error);
  }
});

test('catalog validation retains baseline spelling and only trims changed or new names', () => {
  const baseline = { serviceTypes: ['  حشو   ليزر  ', ...PROTECTED_SERVICE_TYPES], crownPrices: { PFM: 1200, 'نوع قديم': 150 } };
  const source = { serviceTypes: [...baseline.serviceTypes].reverse().concat('  تنظيف جديد  '), crownPrices: { ...baseline.crownPrices, 'نوع مخصص': '١٠٠٫٥٠' } };
  const sourceBefore = structuredClone(source);
  const result = validateServiceCatalog(source, baseline);
  assert.equal(result.valid, true);
  assert.deepEqual(result.value.serviceTypes, ['تركيبات - متحركة', 'تركيبات - ثابتة', '  حشو   ليزر  ', 'تنظيف جديد']);
  assert.deepEqual(result.value.crownPrices, { PFM: 1200, 'نوع قديم': 150, 'نوع مخصص': 100.5 });
  assert.deepEqual(source, sourceBefore);
  assert.deepEqual(Object.keys(result.value.crownPrices), Object.keys(source.crownPrices));
});

test('protected existing service types cannot be renamed or deleted and are never added automatically', () => {
  const baseline = { serviceTypes: ['حشو', ...PROTECTED_SERVICE_TYPES], crownPrices: {} };
  assert.equal(isProtectedServiceType('تركيبات - ثابتة'), true);
  assert.equal(isProtectedServiceType('تركيبات - متحركة'), true);
  assert.equal(isProtectedServiceType('حشو'), false);
  for (const names of [['حشو'], ['حشو', 'تركيبات ثابتة', 'تركيبات - متحركة'], ['حشو', ' تركيبات - ثابتة ', 'تركيبات - متحركة']]) {
    const result = validateServiceCatalog({ serviceTypes: names, crownPrices: {} }, baseline);
    assert.equal(result.valid, false);
    assert.ok(result.errors['serviceTypes.1']);
  }
  const standalone = validateServiceCatalog({ serviceTypes: ['حشو'], crownPrices: {} });
  assert.equal(standalone.valid, true);
  assert.deepEqual(standalone.value.serviceTypes, ['حشو']);
});

test('catalog size and names are validated while an empty price map stays empty', () => {
  assert.ok(validateServiceCatalog({ serviceTypes: [], crownPrices: {} }).errors.serviceTypes);
  const names = Array.from({ length: 300 }, (_, index) => `خدمة ${index}`);
  assert.equal(validateServiceCatalog({ serviceTypes: names, crownPrices: {} }).valid, true);
  assert.ok(validateServiceCatalog({ serviceTypes: [...names, 'خدمة ٣٠٠'], crownPrices: {} }).errors.serviceTypes);
  const duplicates = validateServiceCatalog({ serviceTypes: ['إزالة', 'ازالة'], crownPrices: {} });
  assert.ok(duplicates.errors['serviceTypes.0']);
  assert.ok(duplicates.errors['serviceTypes.1']);
  assert.deepEqual(validateServiceCatalog({ serviceTypes: ['خدمة'], crownPrices: {} }).value.crownPrices, {});
});

test('invalid existing prices are reported and retained without replacing other prices or existing keys', () => {
  const malformed = { invalid: ['old'] };
  const baseline = { serviceTypes: ['حشو'], crownPrices: { PFM: 100, 'نوع مخصص': malformed, 'نوع قديم': 50 } };
  const next = { serviceTypes: ['حشو', 'تنظيف'], crownPrices: { PFM: 0, 'نوع مخصص': malformed, 'نوع قديم': 50 } };
  const result = validateServiceCatalog(next, baseline);
  assert.equal(result.valid, false);
  assert.ok(result.errors['crownPrices.نوع مخصص']);
  assert.deepEqual(result.value.crownPrices['نوع مخصص'], malformed);
  assert.equal(result.value.crownPrices.PFM, 0);
  assert.equal(result.value.crownPrices['نوع قديم'], 50);
  (result.value.crownPrices['نوع مخصص'] as any).invalid.push('draft');
  assert.deepEqual(malformed, { invalid: ['old'] });
  const deletedKey = validateServiceCatalog({ serviceTypes: ['حشو'], crownPrices: { PFM: 100 } }, baseline);
  assert.ok(deletedKey.errors['crownPrices.نوع قديم']);
});

test('catalog helpers never alter historical records attached to their input', () => {
  const history = [{ type: 'اسم خدمة قديم', amount: 550, services: [{ name: 'اسم قديم', price: 500 }], examinationFee: 50 }];
  const cases = [{ subType: 'PFM', labTotal: 400, patientTotal: 1200 }];
  const source = { serviceTypes: ['اسم خدمة جديد'], crownPrices: { PFM: 1500 }, patients: [{ sessions: history }], labCases: cases };
  const before = structuredClone(source);
  const result = validateServiceCatalog(source);
  assert.equal(result.valid, true);
  assert.deepEqual(source, before);
  assert.deepEqual(Object.keys(result.value), ['serviceTypes', 'crownPrices']);
});
