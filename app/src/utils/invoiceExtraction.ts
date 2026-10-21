import type { ExtractedInvoice } from '../services/aiService';
import { invoiceFinancialDraft } from './invoiceFinancialDraft';
import { isValidAppointmentDate } from '../components/appointments/appointmentScheduling';

/** Bound and validate untrusted OCR suggestions before rendering/editing them.
 * No saving, inferred payment, account access, or provider activation here. */
export function parseInvoiceExtraction(value: unknown): ExtractedInvoice {
  function invalid(): never { throw new Error('نتيجة قراءة الفاتورة غير صالحة. أدخل البيانات يدويًا وراجع المبالغ قبل الحفظ.'); }
  const record = (value: unknown, allowed?: readonly string[]): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
    const keys = Reflect.ownKeys(value as object);
    if (keys.length > 64 || keys.some(key => typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key)
      || allowed !== undefined && !allowed.includes(key))) invalid();
    const result: Record<string, unknown> = {};
    for (const key of keys as string[]) {
      const property = Object.getOwnPropertyDescriptor(value as object, key);
      if (!property || !('value' in property) || !property.enumerable) invalid();
      result[key] = property.value;
    }
    return result;
  };
  const text = (value: unknown, max: number, multiline = false): string => {
    if (typeof value !== 'string' || value.length > max ||
      (multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u : /[\u0000-\u001f\u007f]/u).test(value)) invalid();
    return (value as string).trim();
  };
  const money = (value: unknown): number => {
    if (typeof value !== 'number') invalid();
    const parsed = invoiceFinancialDraft({ totalAmount: value as number }).totalAmount;
    if (parsed === '') invalid();
    return parsed as number;
  };
  const score = (value: unknown): number => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) invalid();
    return value as number;
  };
  const strings = ['supplierName', 'invoiceNumber', 'invoiceDate', 'invoiceTime', 'supplierAddress', 'supplierPhone',
    'taxNumber', 'commercialRecord', 'currency', 'notes'] as const;
  const amounts = ['subtotal', 'discount', 'tax', 'totalAmount', 'paidAmount', 'remainingAmount'] as const;
  const input = record(value, [...strings, ...amounts, 'paymentMethod', 'category', 'lineItems', 'fieldConfidence']);
  const result: ExtractedInvoice = {};
  for (const key of strings) if (Object.hasOwn(input, key)) {
    result[key] = text(input[key], key === 'notes' ? 4000 : key === 'supplierAddress' ? 1000 : 300,
      key === 'notes' || key === 'supplierAddress');
  }
  if (result.invoiceDate && !isValidAppointmentDate(result.invoiceDate)) invalid();
  if (result.invoiceTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(result.invoiceTime)) invalid();
  for (const key of amounts) if (Object.hasOwn(input, key)) result[key] = money(input[key]);
  invoiceFinancialDraft(result); // Reject conflicting explicit cash/balance, without filling unknown values.
  if (Object.hasOwn(input, 'paymentMethod')) {
    if (!['cash', 'card', 'transfer', 'credit', 'deferred'].includes(input.paymentMethod as string)) invalid();
    result.paymentMethod = input.paymentMethod as ExtractedInvoice['paymentMethod'];
  }
  if (Object.hasOwn(input, 'category')) {
    if (!['supplies', 'fixed', 'maintenance', 'other'].includes(input.category as string)) invalid();
    result.category = input.category as ExtractedInvoice['category'];
  }
  if (Object.hasOwn(input, 'lineItems')) {
    if (!Array.isArray(input.lineItems) || input.lineItems.length > 200 ||
      Reflect.ownKeys(input.lineItems).length !== input.lineItems.length + 1) invalid();
    const items = input.lineItems as unknown[];
    result.lineItems = Array.from({ length: items.length }, (_, index) => {
      const property = Object.getOwnPropertyDescriptor(items, String(index));
      if (!property || !('value' in property) || !property.enumerable) invalid();
      const item = record(property.value, ['itemName', 'quantity', 'unit', 'unitPrice', 'discount', 'tax', 'total', 'notes', 'confidence']);
      const itemName = text(item.itemName, 300);
      if (!itemName || typeof item.quantity !== 'number' || !Number.isFinite(item.quantity) || item.quantity <= 0 || item.quantity > 1_000_000) invalid();
      return { itemName, quantity: item.quantity as number, unitPrice: money(item.unitPrice), total: money(item.total),
        ...(Object.hasOwn(item, 'unit') ? { unit: text(item.unit, 100) } : {}),
        ...(Object.hasOwn(item, 'notes') ? { notes: text(item.notes, 1000, true) } : {}),
        ...(Object.hasOwn(item, 'discount') ? { discount: money(item.discount) } : {}),
        ...(Object.hasOwn(item, 'tax') ? { tax: money(item.tax) } : {}),
        ...(Object.hasOwn(item, 'confidence') ? { confidence: score(item.confidence) } : {}) };
    });
  }
  if (Object.hasOwn(input, 'fieldConfidence')) {
    result.fieldConfidence = {};
    for (const [key, value] of Object.entries(record(input.fieldConfidence))) {
      if (!key || key.length > 100) invalid();
      result.fieldConfidence[key] = score(value);
    }
  }
  return result;
}
