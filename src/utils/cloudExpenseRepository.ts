import { CloudOperationIntentError, readCloudOperationIntentForCommit,
  markCloudOperationIntentCommitted } from './cloudOperationIntent';

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
}
export interface CloudInvoiceImageMetadata {
  sha256: string; byteLength: number; width: number; height: number; contentType: 'image/jpeg';
}
export interface CloudExpenseRecord {
  schemaVersion: 1; clinicId: 'main'; recordId: string; revision: number; lastOperationId: string;
  data: CloudExpenseData; paidCents: number; paymentCount: number;
  invoiceKey: string | null; imageId: string | null; image: CloudInvoiceImageMetadata | null;
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
  const row = fields(value, ['title', 'date', 'note', 'isFixed', 'recurringPeriod', 'expenseType']);
  if (!text(row.title, 200) || !row.title || !day(row.date) || !text(row.note, 4000, true)
    || typeof row.isFixed !== 'boolean' || !['monthly', 'yearly', 'none'].includes(row.recurringPeriod) || !TYPES.includes(row.expenseType)) invalid();
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
    const row = fields(value, ['schemaVersion', 'clinicId', 'recordId', 'revision', 'lastOperationId', 'data', 'paidCents',
      'paymentCount', 'invoiceKey', 'imageId', 'image']);
    if (row.schemaVersion !== 1 || row.clinicId !== 'main' || !uuid(row.recordId) || !uuid(row.lastOperationId)
      || !integer(row.revision, 1, REVISION) || !integer(row.paidCents) || !integer(row.paymentCount, 0, REVISION)
      || row.invoiceKey !== null && !hash(row.invoiceKey) || row.imageId !== null && !uuid(row.imageId)
      || (row.imageId === null) !== (row.image === null)) invalid();
    const data = expenseData(row.data), image = row.image === null ? null : parseCloudInvoiceImageMetadata(row.image);
    if (row.paidCents > data.totalCents || row.paymentCount > row.revision || (row.paidCents === 0) !== (row.paymentCount === 0)
      || (data.invoiceNumber === '') !== (row.invoiceKey === null)) invalid();
    return { ...row, data, image } as CloudExpenseRecord;
  } catch { return invalid(); }
}
export function parseCloudMaterialBalance(value: unknown): CloudMaterialBalance {
  try { const row = fields(value, ['schemaVersion', 'clinicId', 'recordId', 'revision', 'lastOperationId', 'name', 'unit',
    'purchasedMilli', 'purchaseCostCents', 'usedMilli', 'wasteMilli', 'consumedCostCents']);
    if (row.schemaVersion !== 1 || row.clinicId !== 'main' || !hash(row.recordId) || !uuid(row.lastOperationId)
      || !integer(row.revision, 1, REVISION) || !text(row.name, 200) || !row.name || !text(row.unit, 40) || !row.unit
      || !integer(row.purchasedMilli, 1) || !integer(row.purchaseCostCents) || !integer(row.usedMilli) || !integer(row.wasteMilli)
      || !integer(row.consumedCostCents) || row.usedMilli + row.wasteMilli > row.purchasedMilli
      || row.consumedCostCents > row.purchaseCostCents) invalid(); return row as CloudMaterialBalance;
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
/** This is a deterministic material identity, not secrecy/anonymization. */
export async function cloudMaterialId(name: string, unit: string, options: CloudExpenseOptions = {}): Promise<string> {
  try { if (!text(name, 200) || !name || !text(unit, 40) || !unit) invalid();
    const result = await (options.digest ?? (value => sha256Bytes(new TextEncoder().encode(value))))(JSON.stringify(['clinic-material-v1', normalize(name), normalize(unit)]));
    if (!hash(result)) invalid(); return result; } catch (error) { throw safeError(error); }
}
function allocatedCosts(data: CloudExpenseData): number[] {
  if (!data.items.length) return [];
  if (data.subtotalCents === 0) return data.items.map(() => 0);
  const total = BigInt(data.totalCents), subtotal = BigInt(data.subtotalCents);
  const values = data.items.map((row, index) => ({ index, id: row.itemId,
    cost: Number(BigInt(row.totalCents) * total / subtotal), remainder: BigInt(row.totalCents) * total % subtotal }));
  let remaining = data.totalCents - values.reduce((sum, row) => sum + row.cost, 0);
  const ranked = [...values].sort((a, b) => a.remainder === b.remainder ? a.id.localeCompare(b.id) : a.remainder > b.remainder ? -1 : 1);
  for (const row of ranked) { if (remaining-- <= 0) break; row.cost++; }
  return values.map(row => row.cost);
}
export function createCloudExpenseRepository(adapter: CloudExpenseAdapter, options: CloudExpenseOptions = {}) {
  const digestBytes = options.digestBytes ?? sha256Bytes;
  const digest = options.digest ?? (value => digestBytes(new TextEncoder().encode(value)));
  const authorize = async () => { const uid = await adapter.authorizeOwner(); if (!actor(uid)) invalid(); return uid; };
  const reauthorize = async (uid: string) => { if (await authorize() !== uid) unavailable(); };
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
      try { const uid = await authorize(), result = await read('materialBalances', materialId, parseCloudMaterialBalance);
        if (result && await cloudMaterialId(result.name, result.unit, { digest }) !== materialId) invalid();
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
        if (!fence || JSON.stringify(fence) !== JSON.stringify(expense)) conflict(); await reauthorize(uid); return image;
      } catch (error) { throw safeError(error); }
    },
    async listPage(input: CloudExpensePageInput = {}) { try { return await list('expenseRecords', null, input, parseCloudExpenseRecord); } catch (error) { throw safeError(error); } },
    async listMaterialsPage(input: CloudExpensePageInput = {}) {
      try { const uid = await authorize(), result = await list('materialBalances', null, input, parseCloudMaterialBalance);
        for (const row of result.records) if (await cloudMaterialId(row.name, row.unit, { digest }) !== row.recordId) invalid();
        await reauthorize(uid); return result; } catch (error) { throw safeError(error); }
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
        const receipt = { schemaVersion: 1, clinicId: 'main', operationId: command.operationId, recordId,
          actorUid: uid, action: command.action, expectedRevision: command.expectedRevision, resultRevision: command.expectedRevision + 1,
          createdAt: command.createdAt, requestHash };
        const result = await adapter.runTransaction<CloudExpenseCommit>(async transaction => {
          const checked: CloudExpenseTransaction = { get: async target => { await reauthorize(uid);
            const result = await transaction.get(target); await reauthorize(uid); return result; }, set: (target, value) => transaction.set(target, value) };
          const oldReceipt = await checked.get(path('expenseOperations', command.operationId));
          const intent = await readCloudOperationIntentForCommit(checked, { actorUid: uid, kind: 'expense', command }, { digest });
          if (intent.createdAt !== command.createdAt || intent.status !== (oldReceipt === null ? 'prepared' : 'committed')) conflict();
          if (oldReceipt !== null) { const previous = fields(oldReceipt, Object.keys(receipt));
            if (Object.keys(receipt).some(key => previous[key] !== receipt[key as keyof typeof receipt])) conflict();
            await reauthorize(uid); return { status: 'already-committed', recordId, revision: receipt.resultRevision }; }
          const writes: [string, object][] = [];
          if (command.action === 'usage') {
            const raw = await checked.get(path('materialBalances', command.materialId)); if (raw === null) conflict();
            const balance = parseCloudMaterialBalance(raw); if (balance.recordId !== command.materialId) invalid();
            if (balance.revision !== command.expectedRevision || command.quantityMilli > balance.purchasedMilli - balance.usedMilli - balance.wasteMilli) conflict();
            if (await cloudMaterialId(balance.name, balance.unit, { digest }) !== command.materialId) invalid();
            const availableQuantity = balance.purchasedMilli - balance.usedMilli - balance.wasteMilli;
            const availableCost = balance.purchaseCostCents - balance.consumedCostCents;
            const costCents = command.quantityMilli === availableQuantity ? availableCost
              : roundRatio(BigInt(availableCost) * BigInt(command.quantityMilli), BigInt(availableQuantity));
            const usage = parseCloudMaterialUsage({ schemaVersion: 1, clinicId: 'main', recordId: command.operationId,
              materialId: command.materialId, name: balance.name, unit: balance.unit, quantityMilli: command.quantityMilli,
              costCents, kind: command.kind, date: command.date, note: command.note, actorUid: uid, createdAt: command.createdAt });
            if (await checked.get(path('materialUsages', command.operationId)) !== null) conflict();
            writes.push([path('materialBalances', balance.recordId), parseCloudMaterialBalance({ ...balance,
              revision: receipt.resultRevision, lastOperationId: command.operationId,
              usedMilli: balance.usedMilli + (command.kind === 'used' ? command.quantityMilli : 0),
              wasteMilli: balance.wasteMilli + (command.kind === 'waste' ? command.quantityMilli : 0), consumedCostCents: balance.consumedCostCents + costCents })],
            [path('materialUsages', command.operationId), usage]);
          } else {
            const raw = await checked.get(path('expenseRecords', command.recordId));
            const current = raw === null ? null : parseCloudExpenseRecord(raw); if (current && current.recordId !== command.recordId) invalid();
            if ((current?.revision ?? 0) !== command.expectedRevision) conflict();
            let next: CloudExpenseRecord;
            if (command.action === 'create') {
              const invoiceKey = command.data.invoiceNumber ? await digest(JSON.stringify(['clinic-supplier-invoice-v1',
                normalize(command.data.supplierName), normalize(command.data.invoiceNumber)])) : null;
              if (invoiceKey !== null && !hash(invoiceKey)) invalid();
              if (invoiceKey !== null) { if (await checked.get(path('supplierInvoiceReservations', invoiceKey)) !== null) conflict();
                writes.push([path('supplierInvoiceReservations', invoiceKey), { schemaVersion: 1, clinicId: 'main', recordId: invoiceKey,
                  expenseId: command.recordId, operationId: command.operationId }]); }
              const costs = allocatedCosts(command.data), materials = new Map<string, { name: string; unit: string; quantity: number; cost: number }>();
              for (let index = 0; index < command.data.items.length; index++) { const row = command.data.items[index];
                const materialId = await cloudMaterialId(row.name, row.unit, { digest }), existing = materials.get(materialId);
                materials.set(materialId, { name: existing?.name ?? row.name, unit: existing?.unit ?? row.unit,
                  quantity: (existing?.quantity ?? 0) + row.quantityMilli, cost: (existing?.cost ?? 0) + costs[index] }); }
              for (const [materialId, addition] of [...materials].sort(([a], [b]) => a.localeCompare(b))) {
                const stored = await checked.get(path('materialBalances', materialId)), balance = stored === null ? null : parseCloudMaterialBalance(stored);
                if (balance && (balance.recordId !== materialId || await cloudMaterialId(balance.name, balance.unit, { digest }) !== materialId)) invalid();
                if (balance && balance.revision >= REVISION) unavailable();
                writes.push([path('materialBalances', materialId), parseCloudMaterialBalance({ schemaVersion: 1, clinicId: 'main', recordId: materialId,
                  revision: (balance?.revision ?? 0) + 1, lastOperationId: command.operationId, name: balance?.name ?? addition.name,
                  unit: balance?.unit ?? addition.unit, purchasedMilli: (balance?.purchasedMilli ?? 0) + addition.quantity,
                  purchaseCostCents: (balance?.purchaseCostCents ?? 0) + addition.cost, usedMilli: balance?.usedMilli ?? 0,
                  wasteMilli: balance?.wasteMilli ?? 0, consumedCostCents: balance?.consumedCostCents ?? 0 })]);
              }
              next = parseCloudExpenseRecord({ schemaVersion: 1, clinicId: 'main', recordId: command.recordId,
                revision: 1, lastOperationId: command.operationId, data: command.data, paidCents: command.paidCents,
                paymentCount: command.paidCents > 0 ? 1 : 0, invoiceKey, imageId: null, image: null });
            } else {
              if (!current) conflict();
              next = { ...current, revision: receipt.resultRevision, lastOperationId: command.operationId };
              if (command.action === 'edit') next.data = { ...current.data, ...command.data };
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
