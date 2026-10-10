import test from 'node:test';
import assert from 'node:assert/strict';
import { getWalkInServiceOptions, getWalkInToothOptions, nextWalkInFileNumber, validateWalkInAmounts, walkInExaminationDefault } from './walkInDraft';
import { calculateDailyCollections } from './financials';
import type { Patient } from '../types';

test('walk-in file suggestions include Arabic digits but do not parse mixed identifiers', () => {
  assert.equal(nextWalkInFileNumber([{ id: '٤٠١' }, { id: '500-old' }, { id: '00402' }]), '403');
  assert.equal(nextWalkInFileNumber([]), '1');
  assert.equal(nextWalkInFileNumber([{ id: String(Number.MAX_SAFE_INTEGER) }]), '9007199254740992');
});

test('a free walk-in visit with no procedure creates no fictional service income or cash', () => {
  const patient = { id: 'qa', name: 'مريض تجريبي', mobile: '', sessions: [{ id: 'visit', type: 'زيارة بدون إجراء مسجل', procedurePerformed: 'زيارة بدون إجراء مسجل', date: '2026-10-07', amount: 0, paid: 0, discount: 0, examinationFee: 0, treatmentFee: 0, services: [], paymentsLog: [], isWalkIn: true }], payments: [] } as unknown as Patient;
  const result = calculateDailyCollections([patient], date => date === '2026-10-07');
  assert.equal(result.totalIncomeCollected, 0);
  assert.equal(result.examFeesCollected, 0);
  assert.equal(result.cashTotal, 0);
  assert.deepEqual(result.procedureFeesCollectedByName, {});
  assert.deepEqual(result.rows[0].servicesBreakdown, []);
  assert.equal(result.rows[0].proceduresText, 'زيارة بدون إجراء مسجل');
});

test('walk-in draft rejects invalid or excessive costs and accepts decimals and no-charge visits', () => {
  const services = [{ id: 's1', name: 'خدمة تجريبية', price: 100.25 }];
  assert.equal(validateWalkInAmounts(50, services, 100.25, 50), null);
  assert.equal(validateWalkInAmounts(0, [], 0, 0), null);
  for (const value of [-1, Infinity, NaN]) assert.ok(validateWalkInAmounts(value, services, 0, 0));
  assert.ok(validateWalkInAmounts(0, services, 101, 0));
  assert.ok(validateWalkInAmounts(0, [{ ...services[0], name: ' ' }], 0, 0));
});

test('walk-in money is cent-safe before any patient visit or cash entry can be created', () => {
  for (const value of [0.001, 1.999, Number.MAX_SAFE_INTEGER]) {
    assert.match(validateWalkInAmounts(value, [], 0, 0) || '', /منزلتين عشريتين/);
    assert.match(validateWalkInAmounts(0, [{ id: 'test', name: 'خدمة اختبار', price: value }], 0, 0) || '', /منزلتين عشريتين/);
    assert.match(validateWalkInAmounts(100, [], value, 0) || '', /منزلتين عشريتين/);
    assert.match(validateWalkInAmounts(100, [], 0, value) || '', /منزلتين عشريتين/);
  }
  assert.equal(validateWalkInAmounts(0.3, [], 0.1, 0.2), null);
  assert.equal(validateWalkInAmounts(0.1, [{ id: 'test', name: 'خدمة اختبار', price: 0.2 }], 0.1 + 0.2, 0), null);
  assert.ok(validateWalkInAmounts(0.3, [], 0.31, 0));
});

test('walk-in service options come only from active clinical catalog and use configured prices including zero', () => {
  assert.deepEqual(getWalkInServiceOptions(), []);
  assert.deepEqual(getWalkInServiceOptions(['خدمة اختبار', 'تركيبات - ثابتة', 'خدمة بدون سعر', 'خدمة مجانية', 'خدمة اختبار'], {
    'خدمة اختبار': 450.5, 'تركيبات - ثابتة': 9000, 'خدمة مجانية': 0, 'اسم قديم': 800,
  }), [{ name: 'خدمة اختبار', price: 450.5 }, { name: 'خدمة بدون سعر', price: 0 }, { name: 'خدمة مجانية', price: 0 }]);
});

test('walk-in examination default is 100 but preserves explicit free price and never accepts invalid settings', () => {
  assert.equal(walkInExaminationDefault(), 100);
  assert.equal(walkInExaminationDefault(0), 0);
  assert.equal(walkInExaminationDefault(125.5), 125.5);
  for (const value of [NaN, Infinity, -1, '100', null]) assert.equal(walkInExaminationDefault(value), 100);
});

test('walk-in teeth use canonical chart IDs for all permanent and primary quadrants without fake labels', () => {
  const adult = getWalkInToothOptions('adult').flatMap(group => group.options);
  const pediatric = getWalkInToothOptions('pediatric').flatMap(group => group.options);
  assert.equal(adult.length, 32); assert.equal(pediatric.length, 20);
  assert.equal(new Set([...adult, ...pediatric].map(item => item.value)).size, 52);
  assert.ok(adult.some(item => item.value === 'lr8' && item.label.includes('سن 8')));
  assert.ok(pediatric.some(item => item.value === 'ulA' && item.label.includes('لبني (A)')));
  for (const tooth of [undefined, null, 'ur6', 'llE']) assert.equal(validateWalkInAmounts(0, [{ id: 'fake', name: 'خدمة اختبار', price: 0, tooth }], 0, 0), null);
  for (const tooth of ['', 'ur0', 'ul9', 'ur6junk', 'zz2', 'llf', 'ur1.2', 'lrA\n']) assert.match(validateWalkInAmounts(0, [{ id: 'fake', name: 'خدمة اختبار', price: 0, tooth }], 0, 0) || '', /سنًا صحيحًا/);
});
