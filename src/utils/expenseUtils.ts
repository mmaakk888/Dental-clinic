import { Expense } from '../types';

export type ExpenseType = NonNullable<Expense['expenseType']>;

const positiveAmount = (value: number | undefined) => Number.isFinite(value) ? Math.max(0, Number(value)) : 0;

/** Legacy cash expenses were saved as totals; invoice receipts may be partial. */
export function getExpensePaymentSummary(expense: Pick<Expense, 'amount' | 'paidAmount' | 'remainingAmount' | 'paymentMethod'>) {
  const total = positiveAmount(expense.amount);
  const paid = expense.paidAmount !== undefined
    ? Math.min(total, positiveAmount(expense.paidAmount))
    : expense.remainingAmount !== undefined
      ? Math.max(0, total - positiveAmount(expense.remainingAmount))
      : expense.paymentMethod === 'credit' || expense.paymentMethod === 'deferred' ? 0 : total;
  return { total, paid, remaining: Math.max(0, total - paid) };
}

// A basic editor only submits its visible fields; retain invoice metadata and items.
export function mergeExpenseUpdate(existing: Expense, update: Partial<Expense>): Expense {
  return { ...existing, ...update, id: existing.id };
}

export function inferExpenseType(expense: Pick<Expense, 'title' | 'category' | 'expenseType'>): ExpenseType {
  if (expense.expenseType) return expense.expenseType;
  const title = expense.title.toLowerCase();
  if (/إيجار|ايجار/.test(title)) return 'rent';
  if (/كهرب/.test(title)) return 'electricity';
  if (/مياه|مياة|مياه/.test(title)) return 'water';
  if (/راتب|مرتب|سكرتير|مساعد/.test(title)) return 'salary';
  if (expense.category === 'supplies') return 'supplies';
  if (expense.category === 'maintenance') return 'maintenance';
  return 'other';
}

export function expensesForMonth(expenses: Expense[], month: string | 'all') {
  if (month === 'all') return expenses;
  return expenses.filter(expense => (expense.invoiceDate || expense.date || '').slice(0, 7) === month);
}

export function expenseBreakdown(expenses: Expense[]) {
  return expenses.reduce<Record<ExpenseType, number>>((result, expense) => {
    result[inferExpenseType(expense)] += Number(expense.amount) || 0;
    return result;
  }, { rent: 0, electricity: 0, water: 0, salary: 0, supplies: 0, maintenance: 0, other: 0 });
}
