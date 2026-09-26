import test from 'node:test';
import assert from 'node:assert/strict';
import { Expense } from '../types';
import { expenseBreakdown, expensesForMonth, inferExpenseType } from './expenseUtils';

const expense = (id: string, title: string, category: Expense['category'], amount: number, date: string): Expense => ({ id, title, category, amount, date });

test('classifies legacy operating expenses without changing stored records', () => {
  assert.equal(inferExpenseType(expense('1', 'إيجار العيادة', 'fixed', 1, '2026-09-01')), 'rent');
  assert.equal(inferExpenseType(expense('2', 'مرتب السكرتيرة', 'fixed', 1, '2026-09-01')), 'salary');
  assert.equal(inferExpenseType(expense('3', 'فاتورة كهرباء', 'fixed', 1, '2026-09-01')), 'electricity');
  assert.equal(inferExpenseType(expense('4', 'فاتورة مياه', 'fixed', 1, '2026-09-01')), 'water');
});

test('filters by invoice month and totals each expense once', () => {
  const rows = [
    expense('1', 'خامات', 'supplies', 500, '2026-09-01'),
    { ...expense('2', 'إيجار', 'fixed', 2000, '2026-08-01'), invoiceDate: '2026-09-03' }
  ];
  const september = expensesForMonth(rows, '2026-09');
  assert.equal(september.length, 2);
  assert.deepEqual(expenseBreakdown(september), { rent: 2000, electricity: 0, water: 0, salary: 0, supplies: 500, maintenance: 0, other: 0 });
});
