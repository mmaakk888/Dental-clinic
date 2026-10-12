/** OCR is a suggestion, never evidence that the supplier has been paid.
 * Keep unknown values blank and reconcile only explicitly supplied amounts.
 * This helper neither reads storage nor records an expense/payment. */
export type InvoiceDraftAmount = number | '';
export interface InvoiceFinancialInput {
  subtotal?: number; discount?: number; tax?: number; totalAmount?: number;
  paidAmount?: number; remainingAmount?: number;
}
export interface InvoiceFinancialDraft {
  subtotal: InvoiceDraftAmount; discount: InvoiceDraftAmount; tax: InvoiceDraftAmount;
  totalAmount: InvoiceDraftAmount; paidAmount: InvoiceDraftAmount; remainingAmount: InvoiceDraftAmount;
}

function invalid(): never {
  throw new Error('مبالغ الفاتورة المقروءة غير متوافقة. راجع الإجمالي والمسدّد والمتبقي وأدخلها يدويًا.');
}

function cents(value: unknown): number | null {
  if (value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 10_000_000_000) invalid();
  const scaled = value * 100, rounded = Math.round(scaled);
  if (!Number.isSafeInteger(rounded) || Math.abs(scaled - rounded) > Math.max(1, Math.abs(scaled)) * Number.EPSILON * 4) invalid();
  return rounded;
}

export function invoiceFinancialDraft(input: InvoiceFinancialInput): InvoiceFinancialDraft {
  const subtotal = cents(input.subtotal), discount = cents(input.discount), tax = cents(input.tax);
  const total = cents(input.totalAmount);
  let paid = cents(input.paidAmount), remaining = cents(input.remainingAmount);
  if (total !== null) {
    if (paid !== null && paid > total || remaining !== null && remaining > total) invalid();
    if (paid !== null && remaining !== null && paid + remaining !== total) invalid();
    if (paid === null && remaining !== null) paid = total - remaining;
    else if (paid !== null && remaining === null) remaining = total - paid;
  }
  const amount = (value: number | null): InvoiceDraftAmount => value === null ? '' : value / 100;
  return { subtotal: amount(subtotal), discount: amount(discount), tax: amount(tax),
    totalAmount: amount(total), paidAmount: amount(paid), remainingAmount: amount(remaining) };
}
