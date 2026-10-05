import test from 'node:test';
import assert from 'node:assert/strict';
import { Expense, MaterialUsage } from '../types';
import { getInventory, getMonthlyMaterials, materialKey } from './inventory';

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
  assert.equal(row.consumedCost, 20);
});

test('monthly report separates purchases, consumption and waste with stable recorded costs', () => {
  const expenses: Expense[] = [
    { id: 'e1', title: 'خامات', category: 'supplies', amount: 1000, date: '2026-09-01', items: [{ id: 'i1', itemName: 'قفازات', quantity: 10, unit: 'علبة', unitPrice: 100, total: 1000 }] },
    { id: 'e2', title: 'خامات', category: 'supplies', amount: 2000, date: '2026-10-01', items: [{ id: 'i2', itemName: 'قفازات', quantity: 10, unit: 'علبة', unitPrice: 200, total: 2000 }] },
    { id: 'e3', title: 'إيجار', category: 'fixed', amount: 3000, date: '2026-09-01' },
  ];
  const usage: MaterialUsage = { id: 'u1', materialKey: materialKey('قفازات', 'علبة'), materialName: 'قفازات', quantity: 2, unit: 'علبة', date: '2026-09-02', kind: 'used', unitCostAtUse: 100 };
  const usages: MaterialUsage[] = [usage, { ...usage, id: 'u2', quantity: 1, kind: 'waste' }, { ...usage, id: 'u3', date: '2026-10-02', unitCostAtUse: 150 }];
  const report = getMonthlyMaterials(expenses, usages, '2026-09');
  assert.equal(report.purchases, 1000);
  assert.equal(report.usedCost, 200);
  assert.equal(report.wasteCost, 100);
  assert.equal(report.movements.length, 2);
  assert.equal(report.estimatedCount, 0);
  assert.equal(getInventory(expenses, usages)[0].consumedCost, 600);
  assert.equal(getMonthlyMaterials(expenses, usages, '2026-08').usedCost, 0);
});

test('legacy missing costs are marked estimated while zero recorded cost is retained', () => {
  const usage: MaterialUsage = { id: 'u', materialKey: materialKey('خامة', 'فاتورة'), materialName: 'خامة', quantity: 1, unit: 'فاتورة', date: '2026-09-02', kind: 'used', unitCostAtUse: 0 };
  const expenses: Expense[] = [{ id: 'e', title: 'خامة', category: 'supplies', amount: 50, date: '2026-08-01', invoiceDate: '2026-09-01', items: [{ id: 'i', itemName: 'خامة', quantity: 1, unit: 'فاتورة', unitPrice: 50, total: 50 }] }];
  const report = getMonthlyMaterials(expenses, [usage, { ...usage, id: 'old', unitCostAtUse: undefined } as unknown as MaterialUsage], '2026-09');
  assert.equal(report.estimatedCount, 1);
  assert.equal(report.usedCost, 50);
  assert.equal(report.purchases, 50);
});

test('unitemized invoices count as purchases but never create consumable stock', () => {
  const expenses: Expense[] = [{ id: 'e', title: 'فاتورة خامات', category: 'supplies', amount: 500, date: '2026-10-05' }];
  assert.deepEqual(getInventory(expenses, []), []);
  assert.equal(getMonthlyMaterials(expenses, [], '2026-10').purchases, 500);
});

test('zero-cost items remain free and nonfinite quantities are excluded', () => {
  const expenses: Expense[] = [{ id: 'e', title: 'خامات', category: 'supplies', amount: 0, date: '2026-10-05', items: [
    { id: 'free', itemName: 'عينة مجانية', quantity: 2, unit: 'قطعة', unitPrice: 100, total: 0 },
    { id: 'bad', itemName: 'غير صالح', quantity: Infinity, unit: 'قطعة', unitPrice: 1, total: 10 }
  ] }];
  const rows = getInventory(expenses, []);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].remaining, 2);
  assert.equal(rows[0].averageUnitCost, 0);
});
