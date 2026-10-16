import { CloudOperationIntentError, readCloudOperationIntentForCommit,
  markCloudOperationIntentCommitted } from './cloudOperationIntent';
import { parseCloudOperationIntent } from './cloudOperationIntent';
import { buildExpenseInventoryProofs, cloudMaterialIdentityV2, cloudSupplierInvoiceIdentityV2,
  expenseProofId, expenseRatioProof,
  type CloudExpenseInventoryProof, type CloudExpenseRatioProof } from './cloudExpenseInventoryProofs';

/** Pure owner-only expenses/inventory contract. Amounts are piastres, physical
 * quantities are thousandths of a unit. No local store, clock, IDs, OCR, Storage
 * or defaults are read here. Combined server Rules must enforce all coupling. */
export interface CloudExpenseItem {
  itemId: string; name: string; unit: string; quantityMilli: number; unitPriceCents: number;
  discountCents: number; taxCents: number; totalCents: number;
}
export interface CloudExpenseData {
  title: string; category: 'supplies' | 'fixed' | 'maintenance' | 'other';
  expenseType: 'rent' | 'electricity' | 'water' | 'salary' | 'supplies' | 'maintenance' | 'other';
  date: string; note: string; isFixed: boolean; recurringPeriod: 'monthly' | 'yearly' | 'none';
  supplierName: string; supplierPhone: string; supplierAddress: string; invoiceNumber: string;
  invoiceDate: string; invoiceTime: string; taxNumber: string; commercialRecord: string;
  currency: 'EGP'; subtotalCents: number; taxCents: number; discountCents: number; totalCents: number;
  items: CloudExpenseItem[];
}
export interface CloudExpenseEditable {
  title: string; date: string; note: string; isFixed: boolean;
  recurringPeriod: CloudExpenseData['recurringPeriod']; expenseType: CloudExpenseData['expenseType'];
  /** Explicit correction of an unitemized amount, never a cash payment. */
  totalCents?: number;
}
export interface CloudInvoiceImageMetadata {
  sha256: string; byteLength: number; width: number; height: number; contentType: 'image/jpeg';
}
export interface CloudExpenseRecord {
  schemaVersion: 1; clinicId: 'main'; recordId: string; revision: number; lastOperationId: string;
  data: CloudExpenseData; paidCents: number; paymentCount: number;
  invoiceKey: string | null; imageId: string | null; image: CloudInvoiceImageMetadata | null;
  inventoryVersion?: 2;
}
interface BaseCommand { operationId: string; createdAt: string }
export type CloudExpenseCommand =
  | (BaseCommand & { action: 'create'; recordId: string; expectedRevision: 0; data: CloudExpenseData; paidCents: number })
  | (BaseCommand & { action: 'edit'; recordId: string; expectedRevision: number; data: CloudExpenseEditable })
  | (BaseCommand & { action: 'pay'; recordId: string; expectedRevision: number; amountCents: number; date: string; note: string })
  | (BaseCommand & { action: 'usage'; materialId: string; expectedRevision: number; quantityMilli: number;
      kind: 'used' | 'waste'; date: string; note: string })
  | (BaseCommand & { action: 'attach-image'; recordId: string; expectedRevision: number; image: CloudInvoiceImageMetadata });
export interface CloudMaterialBalance {
  schemaVersion: 1; clinicId: 'main'; recordId: string; revision: number; lastOperationId: string;
  name: string; unit: string; purchasedMilli: number; purchaseCostCents: number;
  usedMilli: number; wasteMilli: number; consumedCostCents: number;
  identityVersion?: 2;
}
export interface CloudMaterialHead {
  schemaVersion: 2; clinicId: 'main'; recordId: string; base: CloudMaterialBalance | null;
  pending: null | { operationId: string; indexes: number[]; lastProofRank: number; candidate: CloudMaterialBalance };
}
export interface CloudExpensePayment {
  schemaVersion: 1; clinicId: 'main'; recordId: string; expenseId: string; amountCents: number;
  date: string; note: string; actorUid: string; createdAt: string;
}
export interface CloudMaterialUsage {
  schemaVersion: 1; clinicId: 'main'; recordId: string; materialId: string; name: string; unit: string;
  quantityMilli: number; costCents: number; kind: 'used' | 'waste'; date: string; note: string;
  actorUid: string; createdAt: string;
}
export interface CloudInvoiceImage extends CloudInvoiceImageMetadata {
  schemaVersion: 1; clinicId: 'main'; recordId: string; expenseId: string; actorUid: string;
  createdAt: string; base64: string;
}
export interface CloudExpenseCommit { status: 'committed' | 'already-committed'; recordId: string; revision: number }
export interface CloudExpensePageInput { afterId?: string | null; limit?: number }
export interface CloudExpenseTransaction { get(path: string): Promise<unknown | null>; set(path: string, value: object): void }
export type CloudExpenseCollection = 'expenseRecords' | 'expensePayments' | 'materialBalances' | 'materialUsages';
export interface CloudExpenseAdapter {
  authorizeOwner(): Promise<string>;
  runTransaction<T>(work: (transaction: CloudExpenseTransaction) => Promise<T>): Promise<T>;
  readRecord?(path: string): Promise<unknown | null>;
  listPage?(collection: CloudExpenseCollection, ownerId: string | null, afterId: string | null, limit: number): Promise<unknown>;
}
export interface CloudExpenseOptions { digest?: (text: string) => Promise<string>; digestBytes?: (bytes: Uint8Array) => Promise<string> }
export const MAX_CLOUD_INVOICE_IMAGE_BYTES = 150 * 1024;
export const MAX_CLOUD_EXPENSE_ITEMS = 20;
export class CloudExpenseError extends Error {
  constructor(public readonly code: 'invalid' | 'conflict' | 'unavailable') {
    super(({ invalid: 'بيانات المصروف أو المخزون أو صورة الفاتورة غير صالحة.',
      conflict: 'تغيّرت الفاتورة أو المخزون؛ أعد القراءة قبل الحفظ.',
      unavailable: 'تعذر تأكيد المصروف أو المخزون من الخادم.' })[code]); this.name = 'CloudExpenseError';
  }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/, MAX = 1_000_000_000_000, REVISION = 2_000_000_000;
const path = (collection: string, id: string) => `clinics/main/${collection}/${id}`;
function invalid(): never { throw new CloudExpenseError('invalid'); }
function conflict(): never { throw new CloudExpenseError('conflict'); }
function unavailable(): never { throw new CloudExpenseError('unavailable'); }
function safeError(error: unknown): CloudExpenseError {
  try { if ((error instanceof CloudExpenseError || error instanceof CloudOperationIntentError)
    && ['invalid', 'conflict', 'unavailable'].includes(error.code)) return new CloudExpenseError(error.code); } catch { /* fixed only */ }
  return new CloudExpenseError('unavailable');
}
function fields(value: unknown, keys: readonly string[]): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  const actual = Reflect.ownKeys(value); if (actual.length !== keys.length || keys.some(key => !actual.includes(key))) invalid();
  const result: Record<string, unknown> = {};
  for (const key of keys) { const property = Object.getOwnPropertyDescriptor(value, key);
    if (!property || !('value' in property) || !property.enumerable) invalid(); result[key] = property.value; }
  return result;
}
function optionalFields(value: unknown, required: readonly string[], optional: readonly string[]) {
  if (!value || typeof value !== 'object') invalid();
  const extra = optional.filter(key => Object.prototype.hasOwnProperty.call(value, key));
  return fields(value, [...required, ...extra]);
}
/** Firestore map ordering is unspecified. Compare detached JSON values by
 * their exact key sets, never by insertion order or coercion. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  if (!Array.isArray(a) && (![Object.prototype, null].includes(Object.getPrototypeOf(a)) || ![Object.prototype, null].includes(Object.getPrototypeOf(b)))) return false;
  const ak = Reflect.ownKeys(a), bk = Reflect.ownKeys(b);
  if (ak.length !== bk.length || ak.some(key => typeof key !== 'string' || !bk.includes(key))) return false;
  return ak.every(key => { const av = Object.getOwnPropertyDescriptor(a, key), bv = Object.getOwnPropertyDescriptor(b, key);
    return !!av && !!bv && 'value' in av && 'value' in bv && av.enumerable === bv.enumerable && sameValue(av.value, bv.value); });
}
const uuid = (value: unknown): value is string => typeof value === 'string' && value.length === 36 && UUID.test(value);
const hash = (value: unknown): value is string => typeof value === 'string' && value.length === 64 && HASH.test(value);
const integer = (value: unknown, min = 0, max = MAX): value is number => typeof value === 'number'
  && Number.isSafeInteger(value) && !Object.is(value, -0) && value >= min && value <= max;
const actor = (value: unknown): value is string => typeof value === 'string' && value.length > 0
  && value.length <= 128 && value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value);
function text(value: unknown, max: number, multiline = false): value is string {
  return typeof value === 'string' && [...value].length <= max && (multiline || value === value.trim())
    && !(multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u
      : /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u).test(value);
}
function day(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01' || value > '9999-12-31') return false;
  const parsed = new Date(`${value}T00:00:00.000Z`); return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function timestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.length !== 24 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    || value < '1900-01-01T00:00:00.000Z' || value > '9999-12-31T23:59:59.999Z') return false;
  const parsed = new Date(value); return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}
function array<T>(value: unknown, max: number, parse: (row: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > max || Reflect.ownKeys(value).length !== value.length + 1) invalid();
  return Array.from({ length: value.length }, (_, index) => { const property = Object.getOwnPropertyDescriptor(value, String(index));
    if (!property || !('value' in property) || !property.enumerable) invalid(); return parse(property.value); });
}
const TYPES = ['rent', 'electricity', 'water', 'salary', 'supplies', 'maintenance', 'other'];
const roundRatio = (numerator: bigint, denominator: bigint) => Number((numerator + denominator / 2n) / denominator);
function item(value: unknown): CloudExpenseItem {
  const row = fields(value, ['itemId', 'name', 'unit', 'quantityMilli', 'unitPriceCents', 'discountCents', 'taxCents', 'totalCents']);
  if (!uuid(row.itemId) || !text(row.name, 200) || !row.name || !text(row.unit, 40) || !row.unit
    || !integer(row.quantityMilli, 1) || !integer(row.unitPriceCents) || !integer(row.discountCents)
    || !integer(row.taxCents) || !integer(row.totalCents)) invalid();
  const base = roundRatio(BigInt(row.quantityMilli) * BigInt(row.unitPriceCents), 1000n);
  if (!integer(base) || row.discountCents > base || row.totalCents !== base - row.discountCents + row.taxCents) invalid();
  return row as CloudExpenseItem;
}
function editable(value: unknown): CloudExpenseEditable {
  const row = optionalFields(value, ['title', 'date', 'note', 'isFixed', 'recurringPeriod', 'expenseType'], ['totalCents']);
  if (!text(row.title, 200) || !row.title || !day(row.date) || !text(row.note, 4000, true)
    || typeof row.isFixed !== 'boolean' || !['monthly', 'yearly', 'none'].includes(row.recurringPeriod) || !TYPES.includes(row.expenseType)
    || 'totalCents' in row && !integer(row.totalCents)) invalid();
  return row as CloudExpenseEditable;
}
function expenseData(value: unknown): CloudExpenseData {
  const row = fields(value, ['title', 'category', 'expenseType', 'date', 'note', 'isFixed', 'recurringPeriod', 'supplierName',
    'supplierPhone', 'supplierAddress', 'invoiceNumber', 'invoiceDate', 'invoiceTime', 'taxNumber', 'commercialRecord', 'currency',
    'subtotalCents', 'taxCents', 'discountCents', 'totalCents', 'items']);
  editable(Object.fromEntries(['title', 'date', 'note', 'isFixed', 'recurringPeriod', 'expenseType'].map(key => [key, row[key]])));
  if (!['supplies', 'fixed', 'maintenance', 'other'].includes(row.category) || !text(row.supplierName, 200)
    || !text(row.supplierPhone, 40) || !text(row.supplierAddress, 500) || !text(row.invoiceNumber, 100)
    || row.invoiceNumber && !row.supplierName || !day(row.invoiceDate) || typeof row.invoiceTime !== 'string'
    || row.invoiceTime !== '' && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(row.invoiceTime)
    || !text(row.taxNumber, 100) || !text(row.commercialRecord, 100) || row.currency !== 'EGP'
    || !integer(row.subtotalCents) || !integer(row.taxCents) || !integer(row.discountCents) || !integer(row.totalCents)
    || row.discountCents > row.subtotalCents || row.totalCents !== row.subtotalCents + row.taxCents - row.discountCents) invalid();
  const items = array(row.items, MAX_CLOUD_EXPENSE_ITEMS, item);
  if (new Set(items.map(entry => entry.itemId)).size !== items.length || items.length && (row.category !== 'supplies'
    || items.reduce((sum, entry) => sum + entry.totalCents, 0) !== row.subtotalCents
    || row.subtotalCents === 0 && row.totalCents !== 0)) invalid();
  return { ...row, items } as CloudExpenseData;
}
export function parseCloudInvoiceImageMetadata(value: unknown): CloudInvoiceImageMetadata {
  try { const row = fields(value, ['sha256', 'byteLength', 'width', 'height', 'contentType']);
    if (!hash(row.sha256) || !integer(row.byteLength, 16, MAX_CLOUD_INVOICE_IMAGE_BYTES) || !integer(row.width, 160, 1600)
      || !integer(row.height, 160, 1600) || Math.max(row.width, row.height) < 320
      || Math.max(row.width, row.height) / Math.min(row.width, row.height) > 6 || row.contentType !== 'image/jpeg') invalid();
    return row as CloudInvoiceImageMetadata; } catch { return invalid(); }
}
export function prepareCloudExpenseCommand(value: unknown): CloudExpenseCommand {
  try {
    const action = Object.getOwnPropertyDescriptor(value, 'action')?.value;
    const suffix = action === 'create' ? ['recordId', 'expectedRevision', 'data', 'paidCents']
      : action === 'edit' ? ['recordId', 'expectedRevision', 'data']
      : action === 'pay' ? ['recordId', 'expectedRevision', 'amountCents', 'date', 'note']
      : action === 'usage' ? ['materialId', 'expectedRevision', 'quantityMilli', 'kind', 'date', 'note']
      : action === 'attach-image' ? ['recordId', 'expectedRevision', 'image'] : invalid();
    const row = fields(value, ['operationId', 'createdAt', 'action', ...suffix]);
    if (!uuid(row.operationId) || !timestamp(row.createdAt) || !integer(row.expectedRevision, action === 'create' ? 0 : 1, REVISION - 1)
      || (action === 'usage' ? !hash(row.materialId) : !uuid(row.recordId))) invalid();
    if (action === 'create') { if (row.expectedRevision !== 0 || !integer(row.paidCents)) invalid();
      const data = expenseData(row.data); if (row.paidCents > data.totalCents) invalid(); return { ...row, data } as CloudExpenseCommand; }
    if (action === 'edit') return { ...row, data: editable(row.data) } as CloudExpenseCommand;
    if (action === 'attach-image') return { ...row, image: parseCloudInvoiceImageMetadata(row.image) } as CloudExpenseCommand;
    if (!day(row.date) || !text(row.note, 2000, true)) invalid();
    if (action === 'pay' ? !integer(row.amountCents, 1) : !integer(row.quantityMilli, 1) || !['used', 'waste'].includes(row.kind)) invalid();
    return row as CloudExpenseCommand;
  } catch { return invalid(); }
}
export function parseCloudExpenseRecord(value: unknown): CloudExpenseRecord {
  try {
    const row = optionalFields(value, ['schemaVersion', 'clinicId', 'recordId', 'revision', 'lastOperationId', 'data', 'paidCents',
      'paymentCount', 'invoiceKey', 'imageId', 'image'], ['inventoryVersion']);
    if (row.schemaVersion !== 1 || row.clinicId !== 'main' || !uuid(row.recordId) || !uuid(row.lastOperationId)
      || !integer(row.revision, 1, REVISION) || !integer(row.paidCents) || !integer(row.paymentCount, 0, REVISION)
      || row.invoiceKey !== null && !hash(row.invoiceKey) || row.imageId !== null && !uuid(row.imageId)
      || (row.imageId === null) !== (row.image === null) || 'inventoryVersion' in row && row.inventoryVersion !== 2) invalid();
    const data = expenseData(row.data), image = row.image === null ? null : parseCloudInvoiceImageMetadata(row.image);
    if (row.paidCents > data.totalCents || row.paymentCount > row.revision || (row.paidCents === 0) !== (row.paymentCount === 0)
      || (data.invoiceNumber === '') !== (row.invoiceKey === null)) invalid();
    return { ...row, data, image } as CloudExpenseRecord;
  } catch { return invalid(); }
}
export function parseCloudMaterialBalance(value: unknown): CloudMaterialBalance {
  try { const row = optionalFields(value, ['schemaVersion', 'clinicId', 'recordId', 'revision', 'lastOperationId', 'name', 'unit',
    'purchasedMilli', 'purchaseCostCents', 'usedMilli', 'wasteMilli', 'consumedCostCents'], ['identityVersion']);
    if (row.schemaVersion !== 1 || row.clinicId !== 'main' || !hash(row.recordId) || !uuid(row.lastOperationId)
      || !integer(row.revision, 1, REVISION) || !text(row.name, 200) || !row.name || !text(row.unit, 40) || !row.unit
      || !integer(row.purchasedMilli, 1) || !integer(row.purchaseCostCents) || !integer(row.usedMilli) || !integer(row.wasteMilli)
      || !integer(row.consumedCostCents) || row.usedMilli + row.wasteMilli > row.purchasedMilli
      || row.consumedCostCents > row.purchaseCostCents || 'identityVersion' in row && row.identityVersion !== 2) invalid(); return row as CloudMaterialBalance;
  } catch { return invalid(); }
}
export function parseCloudMaterialHead(value: unknown): CloudMaterialHead | CloudMaterialBalance {
  try {
    if (Object.getOwnPropertyDescriptor(value, 'schemaVersion')?.value !== 2) return parseCloudMaterialBalance(value);
    const row = fields(value, ['schemaVersion', 'clinicId', 'recordId', 'base', 'pending']);
    if (row.clinicId !== 'main' || !hash(row.recordId)) invalid();
    const base = row.base === null ? null : parseCloudMaterialBalance(row.base);
    if (base && (base.recordId !== row.recordId || base.identityVersion !== 2)) invalid();
    const pending = row.pending === null ? null : fields(row.pending, ['operationId', 'indexes', 'lastProofRank', 'candidate']);
    if (!base && !pending) invalid();
    if (pending) {
      const indexes = array(pending.indexes, 20, value => { if (!integer(value, 0, 19)) invalid(); return value; });
      const candidate = parseCloudMaterialBalance(pending.candidate);
      if (!uuid(pending.operationId) || !integer(pending.lastProofRank, 0, 19) || !indexes.length || new Set(indexes).size !== indexes.length
        || candidate.recordId !== row.recordId || candidate.identityVersion !== 2
        || candidate.revision !== (base?.revision ?? 0) + 1 || candidate.lastOperationId !== pending.operationId
        || base && (candidate.name !== base.name || candidate.unit !== base.unit || candidate.usedMilli !== base.usedMilli
          || candidate.wasteMilli !== base.wasteMilli || candidate.consumedCostCents !== base.consumedCostCents
          || candidate.purchasedMilli <= base.purchasedMilli || candidate.purchaseCostCents < base.purchaseCostCents)
        || !base && (candidate.usedMilli !== 0 || candidate.wasteMilli !== 0 || candidate.consumedCostCents !== 0)) invalid();
      return { ...row, base, pending: { ...pending, indexes, candidate } } as CloudMaterialHead;
    }
    return { ...row, base, pending: null } as CloudMaterialHead;
  } catch { return invalid(); }
}
export function parseCloudExpensePayment(value: unknown): CloudExpensePayment {
  try { const row = fields(value, ['schemaVersion', 'clinicId', 'recordId', 'expenseId', 'amountCents', 'date', 'note', 'actorUid', 'createdAt']);
    if (row.schemaVersion !== 1 || row.clinicId !== 'main' || !uuid(row.recordId) || !uuid(row.expenseId) || !integer(row.amountCents, 1)
      || !day(row.date) || !text(row.note, 2000, true) || !actor(row.actorUid) || !timestamp(row.createdAt)) invalid();
    return row as CloudExpensePayment; } catch { return invalid(); }
}
export function parseCloudMaterialUsage(value: unknown): CloudMaterialUsage {
  try { const row = fields(value, ['schemaVersion', 'clinicId', 'recordId', 'materialId', 'name', 'unit', 'quantityMilli', 'costCents',
    'kind', 'date', 'note', 'actorUid', 'createdAt']);
    if (row.schemaVersion !== 1 || row.clinicId !== 'main' || !uuid(row.recordId) || !hash(row.materialId)
      || !text(row.name, 200) || !row.name || !text(row.unit, 40) || !row.unit || !integer(row.quantityMilli, 1)
      || !integer(row.costCents) || !['used', 'waste'].includes(row.kind) || !day(row.date) || !text(row.note, 2000, true)
      || !actor(row.actorUid) || !timestamp(row.createdAt)) invalid(); return row as CloudMaterialUsage;
  } catch { return invalid(); }
}
function decodeJpeg(value: unknown): { bytes: Uint8Array; width: number; height: number } {
  if (typeof value !== 'string' || value.length > Math.ceil(MAX_CLOUD_INVOICE_IMAGE_BYTES / 3) * 4
    || value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) invalid();
  const binary = atob(value); if (btoa(binary) !== value || binary.length > MAX_CLOUD_INVOICE_IMAGE_BYTES || binary.length < 16) invalid();
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  if (bytes[0] !== 255 || bytes[1] !== 216 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) invalid();
  let offset = 2, width = 0, height = 0, scan = false;
  for (let count = 0; count < 4096 && offset < bytes.length - 2; count++) {
    if (bytes[offset++] !== 255) invalid(); while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++]; if (!marker || marker === 216 || marker === 217 || marker >= 208 && marker <= 215) invalid();
    if (offset + 2 > bytes.length) invalid(); const length = bytes[offset] * 256 + bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length - 2) invalid();
    if ([192, 193, 194].includes(marker)) {
      if (width || length < 11 || bytes[offset + 2] !== 8) invalid();
      height = bytes[offset + 3] * 256 + bytes[offset + 4]; width = bytes[offset + 5] * 256 + bytes[offset + 6];
      const channels = bytes[offset + 7]; if (![1, 3, 4].includes(channels) || length !== 8 + 3 * channels) invalid();
    }
    if (marker === 218) { if (!width || length < 6 || offset + length >= bytes.length - 2) invalid(); scan = true; break; }
    offset += length;
  }
  if (!scan) invalid(); return { bytes, width, height };
}
export function parseCloudInvoiceImage(value: unknown): CloudInvoiceImage {
  try { const row = fields(value, ['schemaVersion', 'clinicId', 'recordId', 'expenseId', 'actorUid', 'createdAt',
    'sha256', 'byteLength', 'width', 'height', 'contentType', 'base64']);
    if (row.schemaVersion !== 1 || row.clinicId !== 'main' || !uuid(row.recordId) || !uuid(row.expenseId)
      || !actor(row.actorUid) || !timestamp(row.createdAt)) invalid();
    const metadata = parseCloudInvoiceImageMetadata(Object.fromEntries(['sha256', 'byteLength', 'width', 'height', 'contentType'].map(key => [key, row[key]])));
    const jpeg = decodeJpeg(row.base64);
    if (jpeg.bytes.length !== metadata.byteLength || jpeg.width !== metadata.width || jpeg.height !== metadata.height) invalid();
    return row as CloudInvoiceImage;
  } catch { return invalid(); }
}
export function prepareCloudExpensePageInput(value: unknown = {}): { afterId: string | null; limit: number } {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
    const keys = Reflect.ownKeys(value); if (keys.some(key => !['afterId', 'limit'].includes(key as string))) invalid();
    const row = fields(value, keys as string[]), afterId = row.afterId === undefined ? null : row.afterId, limit = row.limit === undefined ? 25 : row.limit;
    if (afterId !== null && !uuid(afterId) && !hash(afterId) || !integer(limit, 1, 50)) invalid(); return { afterId, limit };
  } catch { return invalid(); }
}
async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const buffer = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, '0')).join('');
}
const normalize = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase('ar-EG')
  .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ');
/** Historical v1 identity for unchanged reads/replay, not new purchases.
 * New writes deliberately use cloudMaterialIdV2; neither hash is secrecy. */
export async function cloudMaterialId(name: string, unit: string, options: CloudExpenseOptions = {}): Promise<string> {
  try { if (!text(name, 200) || !name || !text(unit, 40) || !unit) invalid();
    const result = await (options.digest ?? (value => sha256Bytes(new TextEncoder().encode(value))))(JSON.stringify(['clinic-material-v1', normalize(name), normalize(unit)]));
    if (!hash(result)) invalid(); return result; } catch (error) { throw safeError(error); }
}
export async function cloudMaterialIdV2(name: string, unit: string, options: CloudExpenseOptions = {}): Promise<string> {
  try { if (!text(name, 200) || !name || !text(unit, 40) || !unit) invalid();
    const result = await (options.digest ?? (value => sha256Bytes(new TextEncoder().encode(value))))(cloudMaterialIdentityV2(name, unit));
    if (!hash(result)) invalid(); return result;
  } catch (error) { throw safeError(error); }
}
export interface CloudExpenseOperation {
  schemaVersion: 1; clinicId: 'main'; operationId: string; recordId: string; actorUid: string;
  action: CloudExpenseCommand['action']; expectedRevision: number; resultRevision: number; createdAt: string; requestHash: string;
  inventoryVersion?: 2; usageMath?: CloudExpenseRatioProof | null;
}
export function parseCloudExpenseOperation(value: unknown): CloudExpenseOperation {
  const row = optionalFields(value, ['schemaVersion', 'clinicId', 'operationId', 'recordId', 'actorUid', 'action',
    'expectedRevision', 'resultRevision', 'createdAt', 'requestHash'], ['inventoryVersion', 'usageMath']);
  if (row.schemaVersion !== 1 || row.clinicId !== 'main' || !uuid(row.operationId) || !actor(row.actorUid)
    || !['create', 'edit', 'pay', 'usage', 'attach-image'].includes(row.action)
    || (row.action === 'usage' ? !hash(row.recordId) : !uuid(row.recordId))
    || !integer(row.expectedRevision, row.action === 'create' ? 0 : 1, REVISION - 1)
    || row.resultRevision !== row.expectedRevision + 1 || !timestamp(row.createdAt) || !hash(row.requestHash)
    || ('inventoryVersion' in row) !== ('usageMath' in row) || 'inventoryVersion' in row && row.inventoryVersion !== 2
    || 'inventoryVersion' in row && ((row.action === 'usage') !== (row.usageMath !== null))) invalid();
  if (row.usageMath !== undefined && row.usageMath !== null) {
    const math = fields(row.usageMath, ['quotient', 'remainder', 'right', 'denominator', 'product', 'productCarry', 'quotientCarry', 'operands']);
    if (!integer(math.quotient) || !integer(math.remainder) || !integer(math.right) || !integer(math.denominator,1)) invalid();
    array(math.product, 5, value => { if (!integer(value, 0, 999999)) invalid(); return value; });
    if (math.product.length !== 5) invalid();
    for (const key of ['productCarry', 'quotientCarry']) {
      array(math[key], 4, value => { if (!integer(value, 0, 2_000_000)) invalid(); return value; });
      if (math[key].length !== 4) invalid();
    }
    const operands = fields(math.operands, ['a', 'b', 'q', 'd', 'r']);
    for (const key of ['a', 'b', 'q', 'd', 'r']) {
      const digits = array(operands[key], 3, value => { if (!integer(value, 0, 999999)) invalid(); return value; });
      if (digits.length !== 3) invalid();
    }
  }
  return row as CloudExpenseOperation;
}
/** Private head resolution is usable by the same-readTime snapshot reader.
 * Its receipt/intent must be fetched at that exact instant, never the latest. */
export async function resolveCloudMaterialHead(value: unknown, readPrivate: (collection: 'expenseOperations' | 'operationIntents', id: string) => Promise<unknown | null>,
  options: CloudExpenseOptions = {}, allowPrepared = true): Promise<CloudMaterialBalance | null> {
  const parsed = parseCloudMaterialHead(value);
  if (parsed.schemaVersion === 1) {
    if (await cloudMaterialId(parsed.name, parsed.unit, options) !== parsed.recordId) invalid(); return parsed;
  }
  const base = parsed.base;
  if (base && await cloudMaterialIdV2(base.name, base.unit, options) !== base.recordId) invalid();
  if (!parsed.pending) return base;
  const pending = parsed.pending, candidate = pending.candidate;
  if (await cloudMaterialIdV2(candidate.name, candidate.unit, options) !== candidate.recordId) invalid();
  const rawIntent = await readPrivate('operationIntents', pending.operationId);
  if (rawIntent === null) invalid();
  const intent = parseCloudOperationIntent(rawIntent), command = prepareCloudExpenseCommand(intent.command);
  if (intent.kind !== 'expense' || intent.operationId !== pending.operationId || command.action !== 'create'
    || command.operationId !== pending.operationId || command.createdAt !== intent.createdAt) invalid();
  const digest = options.digest ?? (value => sha256Bytes(new TextEncoder().encode(value)));
  if (intent.requestHash !== await digest(JSON.stringify(['clinic-operation-intent-v1', intent.actorUid, 'expense', intent.command]))) invalid();
  const rawReceipt = await readPrivate('expenseOperations', pending.operationId);
  if (intent.status !== 'committed') {
    if (rawReceipt !== null) invalid();
    if (intent.status === 'prepared' && !allowPrepared) conflict();
    return base;
  }
  if (rawReceipt === null) invalid(); const receipt = parseCloudExpenseOperation(rawReceipt);
  if (receipt.inventoryVersion !== 2 || receipt.operationId !== command.operationId || receipt.actorUid !== intent.actorUid
    || receipt.recordId !== command.recordId || receipt.action !== 'create' || receipt.expectedRevision !== 0
    || receipt.createdAt !== command.createdAt || receipt.usageMath !== null
    || receipt.requestHash !== await digest(JSON.stringify(['clinic-expense-v1', intent.actorUid, command]))) invalid();
  const costs = allocatedCosts(command.data), indexes: number[] = [];
  let quantity = 0, cost = 0;
  for (let index = 0; index < command.data.items.length; index++) {
    const item = command.data.items[index];
    if (await cloudMaterialIdV2(item.name, item.unit, options) !== parsed.recordId) continue;
    if (item.name !== candidate.name || item.unit !== candidate.unit) invalid();
    indexes.push(index); quantity += item.quantityMilli; cost += costs[index];
  }
  if (JSON.stringify([...pending.indexes].sort((a, b) => a - b)) !== JSON.stringify(indexes)
    || candidate.purchasedMilli !== (base?.purchasedMilli ?? 0) + quantity
    || candidate.purchaseCostCents !== (base?.purchaseCostCents ?? 0) + cost) invalid();
  return candidate;
}
function allocatedCosts(data: CloudExpenseData): number[] {
  if (!data.items.length) return [];
  if (data.subtotalCents === 0) return data.items.map(() => 0);
  const total = BigInt(data.totalCents), subtotal = BigInt(data.subtotalCents);
  const values = data.items.map((row, index) => ({ index, id: row.itemId,
    cost: Number(BigInt(row.totalCents) * total / subtotal), remainder: BigInt(row.totalCents) * total % subtotal }));
  let remaining = data.totalCents - values.reduce((sum, row) => sum + row.cost, 0);
  const ranked = [...values].sort((a, b) => a.remainder === b.remainder ? a.id < b.id ? -1 : 1 : a.remainder > b.remainder ? -1 : 1);
  for (const row of ranked) { if (remaining-- <= 0) break; row.cost++; }
  return values.map(row => row.cost);
}
export function createCloudExpenseRepository(adapter: CloudExpenseAdapter, options: CloudExpenseOptions = {}) {
  const digestBytes = options.digestBytes ?? sha256Bytes;
  const digest = options.digest ?? (value => digestBytes(new TextEncoder().encode(value)));
  const authorize = async () => { const uid = await adapter.authorizeOwner(); if (!actor(uid)) invalid(); return uid; };
  const reauthorize = async (uid: string) => { if (await authorize() !== uid) unavailable(); };
  const privateRead = async (uid: string, collection: 'expenseOperations' | 'operationIntents', id: string) => {
    if (!adapter.readRecord) unavailable();
    await reauthorize(uid); const value = await adapter.readRecord(path(collection, id)); await reauthorize(uid); return value;
  };
  const read = async <T>(collection: string, id: string, parse: (raw: unknown) => T): Promise<T | null> => {
    if (collection === 'materialBalances' ? !hash(id) : !uuid(id)) invalid();
    const uid = await authorize(); if (!adapter.readRecord) unavailable();
    const raw = await adapter.readRecord(path(collection, id)); await reauthorize(uid);
    const result = raw === null ? null : parse(raw); if (result && (result as any).recordId !== id) invalid();
    await reauthorize(uid); return result;
  };
  const list = async <T>(collection: CloudExpenseCollection, ownerId: string | null, input: CloudExpensePageInput,
    parse: (raw: unknown) => T) => {
    const query = prepareCloudExpensePageInput(input);
    if (query.afterId !== null && (collection === 'materialBalances' ? !hash(query.afterId) : !uuid(query.afterId))
      || ownerId !== null && (collection === 'materialUsages' ? !hash(ownerId) : !uuid(ownerId))) invalid();
    const uid = await authorize(); if (!adapter.listPage) unavailable();
    const raw = await adapter.listPage(collection, ownerId, query.afterId, query.limit); await reauthorize(uid);
    const rows = array(raw, query.limit, value => fields(value, ['id', 'data'])); let previous = query.afterId;
    const records = rows.map(row => { if (collection === 'materialBalances' ? !hash(row.id) : !uuid(row.id)) invalid();
      if (previous !== null && row.id <= previous) invalid(); previous = row.id;
      const result = parse(row.data); if ((result as any).recordId !== row.id
        || ownerId !== null && (result as any)[collection === 'materialUsages' ? 'materialId' : 'expenseId'] !== ownerId) invalid(); return result; });
    await reauthorize(uid); return { records, nextAfterId: records.length === query.limit ? previous : null };
  };
  return {
    async get(recordId: string): Promise<CloudExpenseRecord | null> { try { return await read('expenseRecords', recordId, parseCloudExpenseRecord); } catch (error) { throw safeError(error); } },
    async getMaterial(materialId: string): Promise<CloudMaterialBalance | null> {
      try { const uid = await authorize(), raw = await read('materialBalances', materialId, parseCloudMaterialHead);
        const result = raw === null ? null : await resolveCloudMaterialHead(raw, (collection, id) => privateRead(uid, collection, id), { digest });
        const fence = await read('materialBalances', materialId, parseCloudMaterialHead);
        if (!sameValue(fence, raw)) conflict();
        await reauthorize(uid); return result; } catch (error) { throw safeError(error); }
    },
    async getInvoiceImage(expenseId: string): Promise<CloudInvoiceImage | null> {
      try {
        const uid = await authorize(); const expense = await read('expenseRecords', expenseId, parseCloudExpenseRecord);
        if (!expense) conflict(); if (!expense.imageId) { await reauthorize(uid); return null; }
        const image = await read('invoiceImages', expense.imageId, parseCloudInvoiceImage); if (!image || image.expenseId !== expenseId) invalid();
        for (const key of ['sha256', 'byteLength', 'width', 'height', 'contentType'] as const) if (image[key] !== expense.image![key]) invalid();
        if (await digestBytes(decodeJpeg(image.base64).bytes) !== image.sha256) invalid();
        const fence = await read('expenseRecords', expenseId, parseCloudExpenseRecord);
        if (!fence || !sameValue(fence, expense)) conflict(); await reauthorize(uid); return image;
      } catch (error) { throw safeError(error); }
    },
    async listPage(input: CloudExpensePageInput = {}) { try { return await list('expenseRecords', null, input, parseCloudExpenseRecord); } catch (error) { throw safeError(error); } },
    async listMaterialsPage(input: CloudExpensePageInput = {}) {
      try { const uid = await authorize(), query = prepareCloudExpensePageInput(input), records: CloudMaterialBalance[] = [];
        let after = query.afterId, visited = 0;
        do {
          const result = await list('materialBalances', null, { afterId: after, limit: query.limit - records.length }, parseCloudMaterialHead);
          for (const head of result.records) { if (++visited > 20_000) unavailable();
            const material = await resolveCloudMaterialHead(head, (collection, id) => privateRead(uid, collection, id), { digest });
            if (material) records.push(material); }
          after = result.nextAfterId;
        } while (after !== null && records.length < query.limit);
        await reauthorize(uid); return { records, nextAfterId: records.length === query.limit ? after : null };
      } catch (error) { throw safeError(error); }
    },
    async listPaymentsPage(expenseId: string, input: CloudExpensePageInput = {}) { try { if (!uuid(expenseId)) invalid();
      return await list('expensePayments', expenseId, input, parseCloudExpensePayment); } catch (error) { throw safeError(error); } },
    async listUsagesPage(materialId: string, input: CloudExpensePageInput = {}) { try { if (!hash(materialId)) invalid();
      return await list('materialUsages', materialId, input, parseCloudMaterialUsage); } catch (error) { throw safeError(error); } },
    /** attach-image journals contain metadata ONLY. The separately supplied
     * compressed payload is required only for a first commit; historical replay
     * can acknowledge without bytes and cannot restore an old image pointer. */
    async commit(input: unknown, imageBase64?: string): Promise<CloudExpenseCommit> {
      try {
        const command = prepareCloudExpenseCommand(input), uid = await authorize();
        const requestHash = await digest(JSON.stringify(['clinic-expense-v1', uid, command])); if (!hash(requestHash)) invalid();
        await reauthorize(uid);
        const recordId = command.action === 'usage' ? command.materialId : command.recordId;
        const receipt: CloudExpenseOperation = { schemaVersion: 1, clinicId: 'main', operationId: command.operationId, recordId,
          actorUid: uid, action: command.action, expectedRevision: command.expectedRevision, resultRevision: command.expectedRevision + 1,
          createdAt: command.createdAt, requestHash, inventoryVersion: 2, usageMath: null };
        const checkedTransaction = (transaction: CloudExpenseTransaction): CloudExpenseTransaction => ({
          get: async target => { await reauthorize(uid); const value = await transaction.get(target); await reauthorize(uid); return value; },
          set: (target, value) => transaction.set(target, value),
        });
        const historical = async (checked: CloudExpenseTransaction) => {
          const old = await checked.get(path('expenseOperations', command.operationId));
          const intent = await readCloudOperationIntentForCommit(checked, { actorUid: uid, kind: 'expense', command }, { digest });
          if (intent.createdAt !== command.createdAt || intent.status !== (old === null ? 'prepared' : 'committed')) conflict();
          if (old !== null) {
            const previous = parseCloudExpenseOperation(old);
            for (const key of ['schemaVersion', 'clinicId', 'operationId', 'recordId', 'actorUid', 'action', 'expectedRevision', 'resultRevision', 'createdAt', 'requestHash'] as const)
              if (previous[key] !== receipt[key]) conflict();
            return { intent, acknowledged: true };
          }
          return { intent, acknowledged: false };
        };
        const prepareRatio = async (kind: 'item' | 'allocation' | 'usage', rowIndex: number, ratio: CloudExpenseRatioProof,
          basis: { quantityMilli: number; costCents: number } | null = null) => {
          for (const part of [0, 1, 2, 3]) await adapter.runTransaction(async transaction => {
            const checked = checkedTransaction(transaction), { intent, acknowledged } = await historical(checked);
            if (acknowledged) return;
            const value = { schemaVersion: 2, clinicId: 'main', operationId: command.operationId, actorUid: uid,
              intentRequestHash: intent.requestHash, createdAt: command.createdAt, kind, rowIndex, part, ratio, basis: part === 0 ? basis : null };
            const target = path('expenseInventoryProofs', `${command.operationId}-math-${kind}-${rowIndex}-${part}`), previous = await checked.get(target);
            if (previous !== null) { if (!sameValue(previous, value)) invalid(); return; }
            if (part > 0 && !sameValue(await checked.get(path('expenseInventoryProofs', `${command.operationId}-math-${kind}-${rowIndex}-${part - 1}`)),
              { ...value, part: part - 1, basis: part === 1 ? basis : null })) invalid();
            await reauthorize(uid); transaction.set(target, value);
          });
        };
        let proofLevels: CloudExpenseInventoryProof[][] = [];
        let headerProof: object | null = null;
        let completeProof: object | null = null;
        if (command.action === 'create') {
          const first = await adapter.runTransaction(async transaction => {
            const checked = checkedTransaction(transaction), state = await historical(checked);
            if (state.acknowledged) return state;
            // Reject already-known duplicate targets before taking any private
            // stock locks. The final atomic commit still rechecks both names.
            if (await checked.get(path('expenseRecords', command.recordId)) !== null) conflict();
            if (command.data.invoiceNumber) {
              const key = await digest(cloudSupplierInvoiceIdentityV2(command.data.supplierName, command.data.invoiceNumber));
              if (!hash(key)) invalid();
              if (await checked.get(path('supplierInvoiceReservations', key)) !== null) conflict();
            }
            return state;
          });
          if (first.acknowledged) { await reauthorize(uid); return { status: 'already-committed', recordId, revision: receipt.resultRevision }; }
          for (const part of [0, 1]) {
            const currentHeader = { schemaVersion: 2, clinicId: 'main', operationId: command.operationId, actorUid: uid,
              intentRequestHash: first.intent.requestHash, createdAt: command.createdAt, part };
            headerProof = currentHeader;
            await adapter.runTransaction(async transaction => {
            const checked = checkedTransaction(transaction), state = await historical(checked);
            if (state.acknowledged) return;
            const target = path('expenseInventoryProofs', `${command.operationId}-header-${part}`), previous = await checked.get(target);
            if (previous !== null) { if (!sameValue(previous, currentHeader)) invalid(); return; }
            if (part > 0) {
              const prior = await checked.get(path('expenseInventoryProofs', `${command.operationId}-header-${part - 1}`));
              if (!sameValue(prior, { ...currentHeader, part: part - 1 })) invalid();
            }
            await reauthorize(uid); transaction.set(target, currentHeader);
            });
          }
          proofLevels = await buildExpenseInventoryProofs(command.data, { schemaVersion: 2, clinicId: 'main', operationId: command.operationId,
            actorUid: uid, requestHash, intentRequestHash: first.intent.requestHash, createdAt: command.createdAt }, digest);
          for (const level of proofLevels) for (const proof of level) {
            if (proof.leaf) {
              await prepareRatio('item', proof.leaf.rowIndex, proof.leaf.itemBase);
              await prepareRatio('allocation', proof.leaf.rowIndex, proof.leaf.allocation);
            }
            const itemProof = proof.leaf ? { schemaVersion: 2, clinicId: 'main', operationId: command.operationId, actorUid: uid,
              intentRequestHash: first.intent.requestHash, createdAt: command.createdAt,
              rowIndex: proof.leaf.rowIndex, itemBase: proof.leaf.itemBase } : null;
            if (itemProof) await adapter.runTransaction(async transaction => {
              const checked = checkedTransaction(transaction), state = await historical(checked);
              if (state.acknowledged) return;
              const target = path('expenseInventoryProofs', `${command.operationId}-item-${itemProof.rowIndex}`), previous = await checked.get(target);
              if (previous !== null) { if (!sameValue(previous, itemProof)) invalid(); return; }
              await reauthorize(uid); transaction.set(target, itemProof);
            });
            await adapter.runTransaction(async transaction => {
              const checked = checkedTransaction(transaction), state = await historical(checked);
              if (state.acknowledged) return;
              const proofPath = path('expenseInventoryProofs', expenseProofId(command.operationId, proof.level, proof.index));
              const previous = await checked.get(proofPath);
              if (previous !== null) { if (!sameValue(previous, proof)) invalid(); return; }
              let headWrite: [string, CloudMaterialHead] | null = null;
              if (proof.leaf) {
                const leaf = proof.leaf, row = command.data.items[leaf.rowIndex], materialPath = path('materialBalances', leaf.materialId);
                if (!sameValue(await checked.get(path('expenseInventoryProofs', `${command.operationId}-item-${leaf.rowIndex}`)), itemProof)) invalid();
                const raw = await checked.get(materialPath), old = raw === null ? null : parseCloudMaterialHead(raw);
                let base: CloudMaterialBalance | null = null, candidate: CloudMaterialBalance | null = null, indexes: number[] = [];
                if (old?.schemaVersion === 2 && old.pending?.operationId === command.operationId) {
                  base = old.base; candidate = old.pending.candidate; indexes = old.pending.indexes;
                  if (indexes.includes(leaf.rowIndex)) invalid();
                } else if (old) {
                  base = await resolveCloudMaterialHead(old, (collection, id) => checked.get(path(collection, id)), { digest }, false);
                  if (base && base.identityVersion !== 2) invalid(); candidate = base;
                }
                if (candidate && (candidate.name !== row.name || candidate.unit !== row.unit || candidate.recordId !== leaf.materialId)) invalid();
                const next = parseCloudMaterialBalance({ schemaVersion: 1, clinicId: 'main', recordId: leaf.materialId,
                  identityVersion: 2, revision: (base?.revision ?? 0) + 1, lastOperationId: command.operationId,
                  name: row.name, unit: row.unit, purchasedMilli: (candidate?.purchasedMilli ?? 0) + row.quantityMilli,
                  purchaseCostCents: (candidate?.purchaseCostCents ?? 0) + proof.summary.costCents,
                  usedMilli: base?.usedMilli ?? 0, wasteMilli: base?.wasteMilli ?? 0, consumedCostCents: base?.consumedCostCents ?? 0 });
                headWrite = [materialPath, parseCloudMaterialHead({ schemaVersion: 2, clinicId: 'main', recordId: leaf.materialId, base,
                  pending: { operationId: command.operationId, indexes: [...indexes, leaf.rowIndex], lastProofRank: leaf.rank, candidate: next } }) as CloudMaterialHead];
              } else {
                const children = proofLevels[proof.level - 1].slice(proof.index * 2, proof.index * 2 + 2);
                for (const child of children) if (!sameValue(await checked.get(path('expenseInventoryProofs', expenseProofId(command.operationId, child.level, child.index))), child)) invalid();
              }
              await reauthorize(uid);
              if (headWrite) transaction.set(...headWrite);
              transaction.set(proofPath, proof);
            });
          }
          if (command.data.items.length) {
            const root = proofLevels.at(-1)![0];
            completeProof = { schemaVersion: 2, clinicId: 'main', operationId: command.operationId, actorUid: uid,
              intentRequestHash: first.intent.requestHash, createdAt: command.createdAt, summary: root.summary };
            await adapter.runTransaction(async transaction => {
              const checked = checkedTransaction(transaction), state = await historical(checked); if (state.acknowledged) return;
              const target = path('expenseInventoryProofs', `${command.operationId}-complete`), previous = await checked.get(target);
              if (previous !== null) { if (!sameValue(previous, completeProof)) invalid(); return; }
              if (!sameValue(await checked.get(path('expenseInventoryProofs', expenseProofId(command.operationId, root.level, root.index))), root)) invalid();
              await reauthorize(uid); transaction.set(target, completeProof!);
            });
          }
        }
        if (command.action === 'usage') {
          const prepared = await adapter.runTransaction(async transaction => {
            const checked = checkedTransaction(transaction), state = await historical(checked);
            if (state.acknowledged) return { acknowledged: true as const, ratio: null };
            const raw = await checked.get(path('materialBalances', command.materialId)); if (raw === null) conflict();
            const balance = await resolveCloudMaterialHead(raw, (collection, id) => checked.get(path(collection, id)), { digest }, false);
            if (!balance || balance.identityVersion !== 2 || balance.revision !== command.expectedRevision) conflict();
            const available = balance.purchasedMilli - balance.usedMilli - balance.wasteMilli;
            if (command.quantityMilli > available) conflict();
            const target = path('expenseInventoryProofs', `${command.operationId}-usage`), previous = await checked.get(target);
            const source = { balance, quantityMilli: available, costCents: balance.purchaseCostCents - balance.consumedCostCents };
            const proof = { schemaVersion: 2, clinicId: 'main', operationId: command.operationId, actorUid: uid,
              intentRequestHash: state.intent.requestHash, createdAt: command.createdAt, source };
            if (previous !== null && !sameValue(previous, proof)) conflict();
            await reauthorize(uid); if (previous === null) transaction.set(target, proof);
            return { acknowledged: false as const, basis: { quantityMilli: available, costCents: source.costCents }, ratio: expenseRatioProof(source.costCents, command.quantityMilli, available) };
          });
          if (prepared.acknowledged) { await reauthorize(uid); return { status: 'already-committed', recordId, revision: receipt.resultRevision }; }
          await prepareRatio('usage', 0, prepared.ratio, prepared.basis);
        }
        let editProof: object | null = null;
        if (command.action === 'edit') {
          const acknowledged = await adapter.runTransaction(async transaction => {
            const checked = checkedTransaction(transaction), state = await historical(checked); if (state.acknowledged) return true;
            const currentRaw = await checked.get(path('expenseRecords', command.recordId)); if (currentRaw === null) conflict();
            const current = parseCloudExpenseRecord(currentRaw); if (current.revision !== command.expectedRevision) conflict();
            if (command.data.totalCents !== undefined) {
              if (current.data.items.length) invalid(); if (command.data.totalCents < current.paidCents) conflict();
            }
            editProof = { schemaVersion: 2, clinicId: 'main', operationId: command.operationId, actorUid: uid,
              intentRequestHash: state.intent.requestHash, createdAt: command.createdAt };
            const target = path('expenseInventoryProofs', `${command.operationId}-edit`), previous = await checked.get(target);
            if (previous !== null) { if (!sameValue(previous, editProof)) invalid(); return false; }
            await reauthorize(uid); transaction.set(target, editProof); return false;
          });
          if (acknowledged) { await reauthorize(uid); return { status: 'already-committed', recordId, revision: receipt.resultRevision }; }
        }
        const result = await adapter.runTransaction<CloudExpenseCommit>(async transaction => {
          const checked = checkedTransaction(transaction), { intent, acknowledged } = await historical(checked);
          if (acknowledged) {
            await reauthorize(uid); return { status: 'already-committed', recordId, revision: receipt.resultRevision }; }
          const writes: [string, object][] = [];
          if (command.action === 'usage') {
            const raw = await checked.get(path('materialBalances', command.materialId)); if (raw === null) conflict();
            const balance = await resolveCloudMaterialHead(raw, (collection, id) => checked.get(path(collection, id)), { digest }, false);
            if (!balance || balance.recordId !== command.materialId || balance.identityVersion !== 2) invalid();
            if (balance.revision !== command.expectedRevision || command.quantityMilli > balance.purchasedMilli - balance.usedMilli - balance.wasteMilli) conflict();
            if (await cloudMaterialIdV2(balance.name, balance.unit, { digest }) !== command.materialId) invalid();
            const availableQuantity = balance.purchasedMilli - balance.usedMilli - balance.wasteMilli;
            const availableCost = balance.purchaseCostCents - balance.consumedCostCents;
            const costCents = command.quantityMilli === availableQuantity ? availableCost
              : roundRatio(BigInt(availableCost) * BigInt(command.quantityMilli), BigInt(availableQuantity));
            receipt.usageMath = expenseRatioProof(availableCost, command.quantityMilli, availableQuantity);
            const ratioProof = await checked.get(path('expenseInventoryProofs', `${command.operationId}-math-usage-0-3`));
            if (!ratioProof || !sameValue((ratioProof as any).ratio, receipt.usageMath)) invalid();
            const usage = parseCloudMaterialUsage({ schemaVersion: 1, clinicId: 'main', recordId: command.operationId,
              materialId: command.materialId, name: balance.name, unit: balance.unit, quantityMilli: command.quantityMilli,
              costCents, kind: command.kind, date: command.date, note: command.note, actorUid: uid, createdAt: command.createdAt });
            if (await checked.get(path('materialUsages', command.operationId)) !== null) conflict();
            const changed = parseCloudMaterialBalance({ ...balance,
              revision: receipt.resultRevision, lastOperationId: command.operationId,
              usedMilli: balance.usedMilli + (command.kind === 'used' ? command.quantityMilli : 0),
              wasteMilli: balance.wasteMilli + (command.kind === 'waste' ? command.quantityMilli : 0), consumedCostCents: balance.consumedCostCents + costCents });
            writes.push([path('materialBalances', balance.recordId), { schemaVersion: 2, clinicId: 'main', recordId: balance.recordId, base: changed, pending: null }],
              [path('materialUsages', command.operationId), usage]);
          } else {
            if (command.action === 'edit' && !sameValue(await checked.get(path('expenseInventoryProofs', `${command.operationId}-edit`)), editProof)) invalid();
            const raw = await checked.get(path('expenseRecords', command.recordId));
            const current = raw === null ? null : parseCloudExpenseRecord(raw); if (current && current.recordId !== command.recordId) invalid();
            if ((current?.revision ?? 0) !== command.expectedRevision) conflict();
            let next: CloudExpenseRecord;
            if (command.action === 'create') {
              if (!sameValue(await checked.get(path('expenseInventoryProofs', `${command.operationId}-header-1`)), headerProof)) invalid();
              const invoiceKey = command.data.invoiceNumber ? await digest(cloudSupplierInvoiceIdentityV2(command.data.supplierName, command.data.invoiceNumber)) : null;
              if (invoiceKey !== null && !hash(invoiceKey)) invalid();
              if (invoiceKey !== null) { if (await checked.get(path('supplierInvoiceReservations', invoiceKey)) !== null) conflict();
                writes.push([path('supplierInvoiceReservations', invoiceKey), { schemaVersion: 1, clinicId: 'main', recordId: invoiceKey,
                  expenseId: command.recordId, operationId: command.operationId }]); }
              if (completeProof !== null && !sameValue(await checked.get(path('expenseInventoryProofs', `${command.operationId}-complete`)), completeProof)) invalid();
              next = parseCloudExpenseRecord({ schemaVersion: 1, clinicId: 'main', recordId: command.recordId,
                revision: 1, lastOperationId: command.operationId, data: command.data, paidCents: command.paidCents,
                paymentCount: command.paidCents > 0 ? 1 : 0, invoiceKey, imageId: null, image: null, inventoryVersion: 2 });
            } else {
              if (!current) conflict();
              next = { ...current, revision: receipt.resultRevision, lastOperationId: command.operationId };
              if (command.action === 'edit') {
                if ('totalCents' in command.data) {
                  if (current.data.items.length) invalid();
                  if (command.data.totalCents! < current.paidCents) conflict();
                  const subtotalCents = command.data.totalCents! - current.data.taxCents + current.data.discountCents;
                  if (!integer(subtotalCents)) invalid();
                  next.data = { ...current.data, ...command.data, subtotalCents };
                } else next.data = { ...current.data, ...command.data };
              }
              if (command.action === 'pay') { if (command.amountCents > current.data.totalCents - current.paidCents) conflict();
                next.paidCents += command.amountCents; next.paymentCount++; }
              if (command.action === 'attach-image') {
                const jpeg = decodeJpeg(imageBase64);
                if (jpeg.bytes.length !== command.image.byteLength || jpeg.width !== command.image.width || jpeg.height !== command.image.height
                  || await digestBytes(jpeg.bytes) !== command.image.sha256) invalid();
                if (await checked.get(path('invoiceImages', command.operationId)) !== null) conflict();
                writes.push([path('invoiceImages', command.operationId), parseCloudInvoiceImage({ schemaVersion: 1, clinicId: 'main',
                  recordId: command.operationId, expenseId: command.recordId, actorUid: uid, createdAt: command.createdAt,
                  ...command.image, base64: imageBase64 })]); next.imageId = command.operationId; next.image = command.image;
              }
            }
            const amountCents = command.action === 'create' ? command.paidCents : command.action === 'pay' ? command.amountCents : 0;
            if (amountCents > 0) {
              if (await checked.get(path('expensePayments', command.operationId)) !== null) conflict();
              writes.push([path('expensePayments', command.operationId), parseCloudExpensePayment({ schemaVersion: 1, clinicId: 'main',
                recordId: command.operationId, expenseId: command.recordId, amountCents,
                date: command.action === 'pay' ? command.date : command.action === 'create' ? command.data.date : invalid(),
                note: command.action === 'pay' ? command.note : '', actorUid: uid, createdAt: command.createdAt })]);
            }
            writes.push([path('expenseRecords', command.recordId), parseCloudExpenseRecord(next)]);
          }
          // All reservation/expense/stock/image/ledger/receipt/intent reads precede writes.
          await reauthorize(uid); for (const [target, value] of writes) transaction.set(target, value);
          transaction.set(path('expenseOperations', command.operationId), receipt); markCloudOperationIntentCommitted(transaction, intent);
          return { status: 'committed', recordId, revision: receipt.resultRevision };
        });
        await reauthorize(uid); const ack = fields(result, ['status', 'recordId', 'revision']);
        if (!['committed', 'already-committed'].includes(ack.status) || ack.recordId !== recordId || ack.revision !== receipt.resultRevision) invalid();
        return { status: ack.status, recordId, revision: receipt.resultRevision };
      } catch (error) { throw safeError(error); }
    },
  };
}
export type CloudExpenseRepository = ReturnType<typeof createCloudExpenseRepository>;
