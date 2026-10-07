import test from 'node:test';
import assert from 'node:assert/strict';
import { nextWalkInFileNumber, validateWalkInAmounts } from './walkInDraft';
import { calculateDailyCollections } from './financials';
import type { Patient } from '../types';

test('walk-in file suggestions include Arabic digits but do not parse mixed identifiers', () => {
  assert.equal(nextWalkInFileNumber([{ id: '٤٠١' }, { id: '500-old' }, { id: '00402' }]), '403');
  assert.equal(nextWalkInFileNumber([]), '101');
  assert.equal(nextWalkInFileNumber([{ id: String(Number.MAX_SAFE_INTEGER) }]), '');
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
