import assert from 'node:assert/strict';
import test from 'node:test';
import type { Lab } from '../types';
import { cloneProstheticRouting, resolveProstheticLab, validateProstheticRouting } from './prostheticRouting';

const labs: Lab[] = [
  { id: 'default', name: 'معمل اختبار', services: [
    { id: 'zircon', name: 'زيركون', category: 'fixed', unitLabel: 'كراون', price: 300 },
    { id: 'denture', name: 'طقم كامل', category: 'removable', unitLabel: 'طقم', price: 700 },
  ] },
  { id: 'specific', name: 'معمل مخصص', services: [{ id: 'exact-service', name: 'اسم داخلي مختلف', category: 'fixed', unitLabel: 'وحدة', price: 400 }] },
];

test('empty routing remains unconfigured and cloned routing has independent nested records', () => {
  const empty = cloneProstheticRouting();
  assert.deepEqual(empty, { defaultLabs: {}, overrides: [] });
  assert.throws(() => resolveProstheticLab(empty, labs, 'fixed', 'زيركون'));
  const original = { defaultLabs: { fixed: 'default' }, overrides: [{ kind: 'fixed' as const, material: 'زيركون', labId: 'specific', labServiceId: 'exact-service' }] };
  const cloned = cloneProstheticRouting(original);
  assert.deepEqual(cloned, original);
  assert.notEqual(cloned.defaultLabs, original.defaultLabs);
  assert.notEqual(cloned.overrides, original.overrides);
  assert.notEqual(cloned.overrides[0], original.overrides[0]);
});

test('defaults match normalized material and category; an override instead matches exact lab and service identity', () => {
  const defaults = { defaultLabs: { fixed: 'default', removable: 'default' }, overrides: [] };
  assert.equal(resolveProstheticLab(defaults, labs, 'fixed', 'زِيـركون').service.id, 'zircon');
  assert.equal(resolveProstheticLab(defaults, labs, 'removable', 'طقم كامل').service.id, 'denture');
  assert.throws(() => resolveProstheticLab(defaults, labs, 'fixed', 'طقم كامل'));
  const custom = { ...defaults, overrides: [{ kind: 'fixed' as const, material: 'زِيـركون', labId: 'specific', labServiceId: 'exact-service' }] };
  const resolved = resolveProstheticLab(custom, labs, 'fixed', 'زيركون');
  assert.equal(resolved.lab.id, 'specific');
  assert.equal(resolved.service.id, 'exact-service');
  assert.equal(resolved.service.name, 'اسم داخلي مختلف');
});

test('routing settings reject unknown keys, malformed records, unsafe identifiers and normalized duplicate overrides', () => {
  const row = { kind: 'fixed', material: 'زيركون', labId: 'specific', labServiceId: 'exact-service' };
  const invalid: unknown[] = [null, [], {}, { defaultLabs: {}, overrides: [], unknown: true },
    { defaultLabs: { other: 'default' }, overrides: [] }, { defaultLabs: { fixed: ' default' }, overrides: [] },
    { defaultLabs: { fixed: '__proto__' }, overrides: [] }, { defaultLabs: {}, overrides: 'not-array' },
    { defaultLabs: {}, overrides: [{ ...row, kind: 'other' }] }, { defaultLabs: {}, overrides: [{ ...row, material: '' }] },
    { defaultLabs: {}, overrides: [{ ...row, material: 'زيركون\n' }] }, { defaultLabs: {}, overrides: [{ ...row, labServiceId: 'constructor' }] },
    { defaultLabs: {}, overrides: [{ ...row, extra: true }] }, { defaultLabs: {}, overrides: [row, { ...row, material: 'زِيـركون' }] },
    Object.assign(Object.create({ inherited: true }), { defaultLabs: {}, overrides: [] }),
  ];
  for (const input of invalid) assert.throws(() => validateProstheticRouting(input));
});

test('fresh reference validation rejects deleted or ambiguous catalogs instead of silently switching laboratories', () => {
  const valid = { defaultLabs: { fixed: 'default' }, overrides: [{ kind: 'fixed' as const, material: 'زيركون', labId: 'specific', labServiceId: 'exact-service' }] };
  assert.deepEqual(validateProstheticRouting(valid, labs, ['زيركون']), valid);
  assert.throws(() => validateProstheticRouting(valid, labs, ['PFM']));
  assert.throws(() => validateProstheticRouting(valid, labs.filter(lab => lab.id !== 'specific'), ['زيركون']));
  assert.throws(() => validateProstheticRouting(valid, [...labs, labs[1]], ['زيركون']));
  assert.throws(() => validateProstheticRouting(valid, labs.map(lab => lab.id === 'specific'
    ? { ...lab, services: [...lab.services, { ...lab.services[0] }] } : lab), ['زيركون']));
  assert.throws(() => validateProstheticRouting(valid, labs.map(lab => lab.id === 'specific'
    ? { ...lab, services: lab.services.map(service => ({ ...service, category: 'removable' as const })) } : lab), ['زيركون']));
  assert.throws(() => validateProstheticRouting({ defaultLabs: { fixed: 'deleted' }, overrides: [] }, labs));
  assert.deepEqual(validateProstheticRouting({ defaultLabs: {}, overrides: [] }, [], []), { defaultLabs: {}, overrides: [] });
});
