import type { Expense, LabCase, Patient } from '../types';
import { getPatientFinancialSummary, sumFinancialAmounts } from './financials';
import { getExpensePaymentSummary } from './expenseUtils';

const positive = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;
/** Read-only, exact-cent totals. Supplier reserves are not payments or expenses. */
export function buildClinicFinanceOverview(patients: readonly Patient[], labCases: readonly LabCase[], expenses: readonly Expense[]) {
  const balances = patients.map(patient => ({ patient, financial: getPatientFinancialSummary(patient) }));
  const debtors = balances.filter(row => row.financial.totalRemaining > 0)
    .sort((a, b) => b.financial.totalRemaining - a.financial.totalRemaining || a.patient.name.localeCompare(b.patient.name, 'ar'));
  const totalRequired = sumFinancialAmounts(balances.map(row => Math.max(0, sumFinancialAmounts([row.financial.totalRequired, -row.financial.totalDiscounts]))));
  const totalPaid = sumFinancialAmounts(balances.map(row => row.financial.totalCollected));
  const totalRemain = sumFinancialAmounts(balances.map(row => row.financial.totalRemaining));
  const totalLabCosts = sumFinancialAmounts(labCases.map(row => positive(row.labTotal)));
  const totalLabPaid = sumFinancialAmounts(labCases.map(row => positive(row.labPaid)));
  const totalLabRemaining = sumFinancialAmounts(labCases.map(row => Math.max(0, sumFinancialAmounts([positive(row.labTotal), -positive(row.labPaid)]))));
  const supplier = expenses.map(getExpensePaymentSummary);
  const totalExpensesAmount = sumFinancialAmounts(supplier.map(row => row.total));
  const totalExpensesPaid = sumFinancialAmounts(supplier.map(row => row.paid));
  const totalExpenseRemaining = sumFinancialAmounts(supplier.map(row => row.remaining));
  return { totalRequired, totalPaid, totalRemain, totalLabCosts, totalLabPaid, totalLabRemaining,
    totalExpensesAmount, totalExpensesPaid, totalExpenseRemaining, cashBalance: sumFinancialAmounts([totalPaid, -totalLabPaid, -totalExpensesPaid]), debtors };
}
