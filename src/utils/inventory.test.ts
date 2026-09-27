import test from 'node:test';
import assert from 'node:assert/strict';
import { Expense, MaterialUsage } from '../types';
import { getInventory, materialKey } from './inventory';

test('inventory uses supply invoice lines and subtracts usage once', () => {
  const expenses = [{ id: 'e1', title: 'مورد', category: 'supplies', amount: 1000, date: '2026-09-01', items: [
    { id: 'i1', itemName: 'جوانتي', quantity: 10, unit: 'علبة', unitPrice: 100, total: 1000 }
  ] }, { id: 'e2', title: 'إيجار', category: 'fixed', amount: 2000, date: '2026-09-01' }] as Expense[];
  const usages = [{ id: 'u1', materialKey: materialKey('جوانتي', 'علبة'), materialName: 'جوانتي', quantity: 3, unit: 'علبة', date: '2026-09-02', kind: 'used', unitCostAtUse: 100 }] as MaterialUsage[];
  assert.deepEqual(getInventory(expenses, usages).map(row => ({ name: row.name, purchased: row.purchased, remaining: row.remaining, cost: row.consumedCost })), [
    { name: 'جوانتي', purchased: 10, remaining: 7, cost: 300 }
  ]);
});

test('material key normalizes common Arabic spelling forms but keeps units separate', () => {
  assert.equal(materialKey('إبر  ', 'علبة'), materialKey('ابر', 'علبة'));
  assert.notEqual(materialKey('إبر', 'علبة'), materialKey('إبر', 'قطعة'));
});

test('keeps orphan usage visible as an inventory warning after its purchase is removed', () => {
  const usage = { id: 'u1', materialKey: materialKey('بنچ', 'علبة'), materialName: 'بنچ', quantity: 1, unit: 'علبة', date: '2026-09-02', kind: 'used', unitCostAtUse: 20 } as MaterialUsage;
  const [row] = getInventory([], [usage]);
  assert.equal(row.rawRemaining, -1);
  assert.equal(row.remaining, 0);
});
