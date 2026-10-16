import { createCloudDurableWorkspaceController, type CloudDurableWorkspaceState } from './cloudDurableWorkspaceController';
import { prepareCloudExpenseCommand, parseCloudExpenseRecord, parseCloudMaterialBalance, parseCloudExpensePayment,
  parseCloudMaterialUsage, parseCloudInvoiceImageMetadata, parseCloudInvoiceImage, MAX_CLOUD_EXPENSE_ITEMS,
  type CloudExpenseCommand, type CloudExpenseData, type CloudExpenseEditable, type CloudExpenseRecord,
  type CloudMaterialBalance, type CloudExpensePayment, type CloudMaterialUsage, type CloudInvoiceImage,
  type CloudInvoiceImageMetadata, type CloudExpenseRepository } from './cloudExpenseRepository';
import type { FirebaseCloudExpensesCapability } from './firebaseCloudExpenses';
import { normalizeDirectoryDigits } from './patientDirectory';

type Header = Omit<CloudExpenseData, 'subtotalCents' | 'taxCents' | 'discountCents' | 'totalCents' | 'items'>;
export interface CloudExpenseItemDraft { key: number; name: string; unit: string; quantity: string; unitPrice: string; discount: string; tax: string }
export type CloudExpenseWorkspaceDraft =
  | { action: 'create'; header: Header; subtotal: string; tax: string; discount: string; paid: string; items: CloudExpenseItemDraft[] }
  | { action: 'edit'; recordId: string; expectedRevision: number; data: Omit<CloudExpenseEditable, 'totalCents'>; amount?: string }
  | { action: 'pay'; recordId: string; expectedRevision: number; amount: string; date: string; note: string }
  | { action: 'usage'; materialId: string; expectedRevision: number; quantity: string; kind: 'used' | 'waste'; date: string; note: string }
  | { action: 'attach-image'; recordId: string; expectedRevision: number; image: CloudInvoiceImageMetadata };
export type CloudExpenseSelection = { kind: 'expense'; record: CloudExpenseRecord; payments: CloudExpensePayment[] }
  | { kind: 'material'; record: CloudMaterialBalance; usages: CloudMaterialUsage[] };
export interface CloudExpenseWorkspaceSnapshot {
  expenses: CloudExpenseRecord[]; expensesLoaded: boolean; expenseCursor: string | null;
  materials: CloudMaterialBalance[]; materialsLoaded: boolean; materialCursor: string | null;
  selection: CloudExpenseSelection | null;
}
export type CloudExpenseWorkspaceState = CloudDurableWorkspaceState<CloudExpenseWorkspaceSnapshot, CloudExpenseWorkspaceDraft>
  & { imageLoading: boolean; image: CloudInvoiceImage | null; imageError: string; imageBytesReady: boolean; requiresImageBytes: boolean };
function fail(): never { throw new Error('تعذر تأكيد المصروف أو المخزون.'); }
const uuid = (value: unknown): value is string => typeof value === 'string' && value.length === 36 && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const hash = (value: unknown): value is string => typeof value === 'string' && value.length === 64 && /^[0-9a-f]{64}$/.test(value);
const moneyMax = 1_000_000_000_000;
function exact(value: unknown, keys: readonly string[]): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Reflect.ownKeys(value).length !== keys.length) fail();
  const result: Record<string, any> = {};
  for (const key of keys) { const property = Object.getOwnPropertyDescriptor(value, key);
    if (!property || !('value' in property) || !property.enumerable) fail(); result[key] = property.value; } return result;
}
function dense(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max || Reflect.ownKeys(value).length !== value.length + 1) fail();
  return Array.from({ length: value.length }, (_, i) => { const property = Object.getOwnPropertyDescriptor(value, String(i));
    if (!property || !('value' in property) || !property.enumerable) fail(); return property.value; });
}
function freeze<T>(value: T): T { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function raw(value: unknown, max = 4000): value is string { return typeof value === 'string' && value.length <= max; }
function scaled(value: unknown, places: number): number | null {
  if (typeof value !== 'string' || value.length > 32) return null;
  const text = normalizeDirectoryDigits(value.trim()).replace(/[٫,]/g, '.');
  if (!(new RegExp(`^\\d{1,11}(?:\\.\\d{1,${places}})?$`)).test(text)) return null;
  const [whole, fraction = ''] = text.split('.'), result = Number(whole) * 10 ** places + Number(fraction.padEnd(places, '0'));
  return Number.isSafeInteger(result) && result <= moneyMax ? result : null;
}
export const parseCloudExpenseMoney = (value: unknown) => scaled(value, 2);
export const parseCloudExpenseQuantity = (value: unknown) => scaled(value, 3);
const headerKeys = ['title', 'category', 'expenseType', 'date', 'note', 'isFixed', 'recurringPeriod', 'supplierName', 'supplierPhone', 'supplierAddress',
  'invoiceNumber', 'invoiceDate', 'invoiceTime', 'taxNumber', 'commercialRecord', 'currency'] as const;
const editKeys = ['title', 'date', 'note', 'isFixed', 'recurringPeriod', 'expenseType'] as const;
function parseDraft(value: unknown): CloudExpenseWorkspaceDraft {
  const action = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'action')?.value : null;
  if (action === 'create') {
    const item = exact(value, ['action', 'header', 'subtotal', 'tax', 'discount', 'paid', 'items']), header = exact(item.header, headerKeys);
    if (headerKeys.some(key => key === 'isFixed' ? typeof header[key] !== 'boolean' : !raw(header[key]))
      || !['supplies', 'fixed', 'maintenance', 'other'].includes(header.category) || header.currency !== 'EGP'
      || ['subtotal', 'tax', 'discount', 'paid'].some(key => !raw(item[key], 32))) fail();
    const seen = new Set<number>(), items = dense(item.items, MAX_CLOUD_EXPENSE_ITEMS).map(value => {
      const row = exact(value, ['key', 'name', 'unit', 'quantity', 'unitPrice', 'discount', 'tax']);
      if (!Number.isSafeInteger(row.key) || row.key < 1 || seen.has(row.key) || ['name', 'unit', 'quantity', 'unitPrice', 'discount', 'tax'].some(key => !raw(row[key], key === 'name' ? 200 : 40))) fail();
      seen.add(row.key); return row as CloudExpenseItemDraft;
    }); return { ...item, header, items } as CloudExpenseWorkspaceDraft;
  }
  const keys = action === 'edit' ? ['action', 'recordId', 'expectedRevision', 'data']
    : action === 'pay' ? ['action', 'recordId', 'expectedRevision', 'amount', 'date', 'note']
      : action === 'usage' ? ['action', 'materialId', 'expectedRevision', 'quantity', 'kind', 'date', 'note']
        : action === 'attach-image' ? ['action', 'recordId', 'expectedRevision', 'image'] : fail();
  const item = exact(value, action === 'edit' && Object.prototype.hasOwnProperty.call(value, 'amount') ? [...keys, 'amount'] : keys);
  if (action === 'usage' ? !hash(item.materialId) : !uuid(item.recordId)) fail();
  if (!Number.isInteger(item.expectedRevision) || item.expectedRevision < 1 || item.expectedRevision >= 2_000_000_000) fail();
  if (action === 'edit') { const data = exact(item.data, editKeys); if ('amount' in item && !raw(item.amount, 32)) fail();
    if (editKeys.some(key => key === 'isFixed' ? typeof data[key] !== 'boolean' : !raw(data[key]))) fail(); return { ...item, data } as CloudExpenseWorkspaceDraft; }
  if (action === 'attach-image') return { ...item, image: parseCloudInvoiceImageMetadata(item.image) } as CloudExpenseWorkspaceDraft;
  if (!raw(item.date, 32) || !raw(item.note, 2000) || !raw(item[action === 'pay' ? 'amount' : 'quantity'], 32)
    || action === 'usage' && !['used', 'waste'].includes(item.kind)) fail(); return item as CloudExpenseWorkspaceDraft;
}
function empty(): CloudExpenseWorkspaceSnapshot { return { expenses: [], expensesLoaded: false, expenseCursor: null, materials: [], materialsLoaded: false, materialCursor: null, selection: null }; }
function page<T extends { recordId: string }>(value: unknown, after: string | null, limit: number, parse: (value: unknown) => T) {
  const item = exact(value, ['records', 'nextAfterId']); let previous = after;
  const records = dense(item.records, limit).map(value => { const record = parse(value); if (previous && record.recordId <= previous) fail(); previous = record.recordId; return record; });
  if (item.nextAfterId !== (records.length === limit ? previous : null)) fail(); return { records, nextAfterId: item.nextAfterId as string | null };
}
async function selected(repository: CloudExpenseRepository, kind: 'expense' | 'material', id: string, assert: () => void): Promise<CloudExpenseSelection> {
  const read = async <T>(work: () => Promise<T>) => { assert(); const value = await work(); assert(); return value; };
  if (kind === 'expense') {
    const record = parseCloudExpenseRecord(await read(() => repository.get(id))); if (record.recordId !== id) fail();
    const payments: CloudExpensePayment[] = []; let after: string | null = null;
    do { const value = page(await read(() => repository.listPaymentsPage(id, { afterId: after, limit: 50 })), after, 50, parseCloudExpensePayment);
      if (value.records.some(row => row.expenseId !== id)) fail(); payments.push(...value.records); if (payments.length > 2000) fail(); after = value.nextAfterId; } while (after);
    const last = parseCloudExpenseRecord(await read(() => repository.get(id)));
    if (JSON.stringify(last) !== JSON.stringify(record) || payments.length !== record.paymentCount || payments.reduce((sum, item) => sum + item.amountCents, 0) !== record.paidCents) fail();
    return { kind, record, payments };
  }
  const record = parseCloudMaterialBalance(await read(() => repository.getMaterial(id))); if (record.recordId !== id) fail();
  const usages: CloudMaterialUsage[] = []; let after: string | null = null;
  do { const value = page(await read(() => repository.listUsagesPage(id, { afterId: after, limit: 50 })), after, 50, parseCloudMaterialUsage);
    if (value.records.some(row => row.materialId !== id || row.name !== record.name || row.unit !== record.unit)) fail();
    usages.push(...value.records); if (usages.length > 2000) fail(); after = value.nextAfterId; } while (after);
  const last = parseCloudMaterialBalance(await read(() => repository.getMaterial(id)));
  if (JSON.stringify(last) !== JSON.stringify(record) || usages.filter(row => row.kind === 'used').reduce((sum, row) => sum + row.quantityMilli, 0) !== record.usedMilli
    || usages.filter(row => row.kind === 'waste').reduce((sum, row) => sum + row.quantityMilli, 0) !== record.wasteMilli
    || usages.reduce((sum, row) => sum + row.costCents, 0) !== record.consumedCostCents) fail();
  return { kind, record, usages };
}
/** Pure conversion of raw reviewed fields; no IDs, time, AI or payment inference. */
export function buildCloudExpenseCreate(draft: Extract<CloudExpenseWorkspaceDraft, { action: 'create' }>, itemIds: string[]) {
  if (draft.items.length !== itemIds.length) fail();
  const items = draft.items.map((row, index) => {
    const quantityMilli = parseCloudExpenseQuantity(row.quantity), unitPriceCents = parseCloudExpenseMoney(row.unitPrice), discountCents = parseCloudExpenseMoney(row.discount), taxCents = parseCloudExpenseMoney(row.tax);
    if (quantityMilli === null || !quantityMilli || unitPriceCents === null || discountCents === null || taxCents === null) fail();
    const base = Number((BigInt(quantityMilli) * BigInt(unitPriceCents) + 500n) / 1000n);
    return { itemId: itemIds[index], name: row.name.trim(), unit: row.unit.trim(), quantityMilli, unitPriceCents, discountCents, taxCents, totalCents: base - discountCents + taxCents };
  });
  const subtotalCents = items.length ? items.reduce((sum, row) => sum + row.totalCents, 0) : parseCloudExpenseMoney(draft.subtotal);
  const taxCents = parseCloudExpenseMoney(draft.tax), discountCents = parseCloudExpenseMoney(draft.discount), paidCents = parseCloudExpenseMoney(draft.paid);
  if (subtotalCents === null || taxCents === null || discountCents === null || paidCents === null) fail();
  const data = { ...draft.header, title: draft.header.title.trim(), supplierName: draft.header.supplierName.trim(), supplierPhone: draft.header.supplierPhone.trim(),
    supplierAddress: draft.header.supplierAddress.trim(), invoiceNumber: draft.header.invoiceNumber.trim(), taxNumber: draft.header.taxNumber.trim(), commercialRecord: draft.header.commercialRecord.trim(),
    subtotalCents, taxCents, discountCents, totalCents: subtotalCents + taxCents - discountCents, items };
  // Reuse the full strict domain parser without generating an actual operation.
  return prepareCloudExpenseCommand({ action: 'create', operationId: '00000000-0000-4000-8000-000000000000', createdAt: '2000-01-01T00:00:00.000Z',
    recordId: '00000000-0000-4000-8000-000000000000', expectedRevision: 0, data, paidCents }) as Extract<CloudExpenseCommand, { action: 'create' }>;
}
export function createCloudExpenseWorkspaceController(options: {
  ownerUid: string; isActive(): boolean; getCapability(): Promise<FirebaseCloudExpensesCapability>;
  newId?: () => string; now?: () => string; digestBytes?: (bytes: Uint8Array) => Promise<string>;
}) {
  let request: { kind: 'expenses' | 'materials' | 'expense' | 'material'; more: boolean; id?: string; base: CloudExpenseWorkspaceSnapshot } = { kind: 'expenses', more: false, base: empty() };
  let imageBytes: { base64: string; sha256: string } | null = null, image: CloudInvoiceImage | null = null, imageLoading = false, imageError = '', imageEpoch = 0, disposed = false;
  let cleaned = false;
  let cachedBase: CloudDurableWorkspaceState<CloudExpenseWorkspaceSnapshot, CloudExpenseWorkspaceDraft> | null = null, cached: CloudExpenseWorkspaceState | null = null;
  const listeners = new Set<(value: CloudExpenseWorkspaceState) => void>(); let unsubscribe: (() => void) | null = null;
  const makeId = () => (options.newId ?? (() => crypto.randomUUID()))();
  const clock = () => { const when = (options.now ?? (() => new Date().toISOString()))(); if (typeof when !== 'string' || when.length !== 24 || new Date(when).toISOString() !== when) fail(); return when; };
  const base = createCloudDurableWorkspaceController<CloudExpenseCommand, CloudExpenseWorkspaceSnapshot, CloudExpenseWorkspaceDraft, FirebaseCloudExpensesCapability, number>({
    kind: 'expense', ownerUid: options.ownerUid, isActive: options.isActive, getCapability: options.getCapability, parseCommand: prepareCloudExpenseCommand, parseDraft,
    draftFromCommand: command => {
      if (command.action === 'create') { const header = Object.fromEntries(headerKeys.map(key => [key, command.data[key]])) as Header;
        return { action: 'create', header, subtotal: String(command.data.subtotalCents / 100), tax: String(command.data.taxCents / 100), discount: String(command.data.discountCents / 100),
          paid: String(command.paidCents / 100), items: command.data.items.map((item, index) => ({ key: index + 1, name: item.name, unit: item.unit, quantity: String(item.quantityMilli / 1000),
            unitPrice: String(item.unitPriceCents / 100), discount: String(item.discountCents / 100), tax: String(item.taxCents / 100) })) }; }
      if (command.action === 'pay') return { action: 'pay', recordId: command.recordId, expectedRevision: command.expectedRevision, amount: String(command.amountCents / 100), date: command.date, note: command.note };
      if (command.action === 'usage') return { action: 'usage', materialId: command.materialId, expectedRevision: command.expectedRevision,
        quantity: String(command.quantityMilli / 1000), kind: command.kind, date: command.date, note: command.note };
      return command.action === 'edit' ? { action: 'edit', recordId: command.recordId, expectedRevision: command.expectedRevision,
        data: Object.fromEntries(editKeys.map(key => [key, command.data[key]])) as Omit<CloudExpenseEditable, 'totalCents'>,
        ...('totalCents' in command.data ? { amount: String(command.data.totalCents! / 100) } : {}) }
        : { action: 'attach-image', recordId: command.recordId, expectedRevision: command.expectedRevision, image: command.image };
    },
    createCommand: (snapshot, draft) => {
      let body: Record<string, unknown>;
      if (draft.action === 'create') {
        const dummy = draft.items.map((_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`);
        buildCloudExpenseCreate(draft, dummy); const prepared = buildCloudExpenseCreate(draft, draft.items.map(() => makeId()));
        const operationId = makeId(); return { ...prepared, operationId, recordId: operationId, createdAt: clock() };
      }
      const selection = snapshot.selection;
      if (!selection || selection.kind !== (draft.action === 'usage' ? 'material' : 'expense') || selection.record.recordId !== (draft.action === 'usage' ? draft.materialId : draft.recordId)
        || selection.record.revision !== draft.expectedRevision) fail();
      if (draft.action === 'pay') { const amountCents = parseCloudExpenseMoney(draft.amount); if (amountCents === null || selection.kind !== 'expense' || amountCents > selection.record.data.totalCents - selection.record.paidCents) fail();
        body = { action: 'pay', recordId: draft.recordId, expectedRevision: draft.expectedRevision, amountCents, date: draft.date, note: draft.note }; }
      else if (draft.action === 'usage') { const quantityMilli = parseCloudExpenseQuantity(draft.quantity); if (quantityMilli === null || selection.kind !== 'material'
        || quantityMilli > selection.record.purchasedMilli - selection.record.usedMilli - selection.record.wasteMilli) fail();
        body = { action: 'usage', materialId: draft.materialId, expectedRevision: draft.expectedRevision, quantityMilli, kind: draft.kind, date: draft.date, note: draft.note }; }
      else if (draft.action === 'edit') {
        const data: CloudExpenseEditable = { ...draft.data };
        if ('amount' in draft) {
          const totalCents = parseCloudExpenseMoney(draft.amount);
          if (selection.kind !== 'expense' || selection.record.data.items.length || totalCents === null || totalCents < selection.record.paidCents) fail();
          const subtotal = totalCents - selection.record.data.taxCents + selection.record.data.discountCents;
          if (!Number.isSafeInteger(subtotal) || subtotal < selection.record.data.discountCents || subtotal > moneyMax) fail();
          data.totalCents = totalCents;
        }
        body = { action: 'edit', recordId: draft.recordId, expectedRevision: draft.expectedRevision, data };
      }
      else { if (!imageBytes || imageBytes.sha256 !== draft.image.sha256) fail(); body = { action: 'attach-image', recordId: draft.recordId, expectedRevision: draft.expectedRevision, image: draft.image }; }
      prepareCloudExpenseCommand({ ...body, operationId: '00000000-0000-4000-8000-000000000000', createdAt: '2000-01-01T00:00:00.000Z' });
      return prepareCloudExpenseCommand({ ...body, operationId: makeId(), createdAt: clock() });
    },
    readSnapshot: async (cap, assert, command) => {
      const value = { ...request.base }; assert();
      if (command) {
        value.selection = await selected(cap.repository, command.action === 'usage' ? 'material' : 'expense', command.action === 'usage' ? command.materialId : command.recordId, assert);
        const expenses = page(await cap.repository.listPage({ limit: 25 }), null, 25, parseCloudExpenseRecord); assert();
        const materials = page(await cap.repository.listMaterialsPage({ limit: 25 }), null, 25, parseCloudMaterialBalance); assert();
        value.expenses = expenses.records; value.expensesLoaded = true; value.expenseCursor = expenses.nextAfterId;
        value.materials = materials.records; value.materialsLoaded = true; value.materialCursor = materials.nextAfterId;
      } else if (request.kind === 'expense' || request.kind === 'material') {
        value.selection = await selected(cap.repository, request.kind, request.id!, assert);
      } else if (request.kind === 'expenses') {
        value.selection = null;
        const after = request.more ? value.expenseCursor : null, result = page(await cap.repository.listPage({ afterId: after, limit: 25 }), after, 25, parseCloudExpenseRecord); assert();
        const combined = request.more ? [...value.expenses, ...result.records] : result.records; if (combined.length > 2000) fail();
        value.expenses = combined; value.expensesLoaded = true; value.expenseCursor = result.nextAfterId;
      } else {
        value.selection = null;
        const after = request.more ? value.materialCursor : null, result = page(await cap.repository.listMaterialsPage({ afterId: after, limit: 25 }), after, 25, parseCloudMaterialBalance); assert();
        const combined = request.more ? [...value.materials, ...result.records] : result.records; if (combined.length > 2000) fail();
        value.materials = combined; value.materialsLoaded = true; value.materialCursor = result.nextAfterId;
      }
      assert(); return freeze(value);
    },
    commit: (cap, command) => cap.repository.commit(command, command.action === 'attach-image' && imageBytes?.sha256 === command.image.sha256 ? imageBytes.base64 : undefined),
    parseAcknowledgement: (value, command) => { const ack = exact(value, ['status', 'recordId', 'revision']);
      if (!['committed', 'already-committed'].includes(ack.status) || ack.recordId !== (command.action === 'usage' ? command.materialId : command.recordId) || ack.revision !== command.expectedRevision + 1) fail(); return ack.revision; },
    reconcile: (snapshot, command, revision) => {
      const selection = snapshot.selection; if (!selection || selection.record.recordId !== (command.action === 'usage' ? command.materialId : command.recordId) || selection.record.revision < revision) fail();
      if (selection.record.revision === revision && selection.record.lastOperationId !== command.operationId) fail();
      if (command.action === 'usage') {
        if (selection.kind !== 'material') fail(); const usage = selection.usages.find(row => row.recordId === command.operationId);
        if (!usage || usage.quantityMilli !== command.quantityMilli || usage.kind !== command.kind || usage.date !== command.date || usage.note !== command.note) fail();
      } else {
        if (selection.kind !== 'expense') fail();
        if (command.action === 'pay' || command.action === 'create' && command.paidCents > 0) {
          const payment = selection.payments.find(row => row.recordId === command.operationId);
          if (!payment || payment.amountCents !== (command.action === 'pay' ? command.amountCents : command.paidCents)
            || payment.date !== (command.action === 'pay' ? command.date : command.data.date) || payment.note !== (command.action === 'pay' ? command.note : '')) fail();
        }
        if (selection.record.revision === revision) {
          if (command.action === 'create' && (JSON.stringify(selection.record.data) !== JSON.stringify(command.data) || selection.record.paidCents !== command.paidCents)) fail();
          if (command.action === 'edit' && editKeys.some(key => selection.record.data[key] !== command.data[key])) fail();
          if (command.action === 'attach-image' && (selection.record.imageId !== command.operationId || JSON.stringify(selection.record.image) !== JSON.stringify(command.image))) fail();
        }
      }
    },
  });
  function decorate(value = base.getState()): CloudExpenseWorkspaceState {
    if (value.closed) { disposed = true; image = null; imageBytes = null; imageLoading = false; imageError = '';
      request = { kind: 'expenses', more: false, base: empty() }; ++imageEpoch; }
    if (value.saveStatus === 'idle' && !value.draft && !imageLoading) imageBytes = null;
    if (cachedBase !== value || !cached || cached.image !== image || cached.imageLoading !== imageLoading || cached.imageError !== imageError || cached.imageBytesReady !== !!imageBytes) {
      cachedBase = value; cached = freeze({ ...value, image, imageLoading, imageError, imageBytesReady: !!imageBytes,
        requiresImageBytes: value.draft?.action === 'attach-image' && value.saveStatus === 'retry-required' && !imageBytes });
    } return cached;
  }
  function emit(value = base.getState()) { const next = decorate(value); for (const listener of [...listeners]) { try { listener(next); } catch { /* View only. */ } } }
  function ready() { return !disposed && !imageLoading && base.canClose(); }
  async function navigate(kind: typeof request.kind, id?: string, more = false) {
    if (!ready()) return false; const snapshot = base.getState().snapshot ?? empty();
    if ((kind === 'expense' && !uuid(id)) || (kind === 'material' && !hash(id)) || more && !(kind === 'expenses' ? snapshot.expenseCursor : snapshot.materialCursor)) return false;
    request = { kind, id, more, base: snapshot }; image = null; imageError = ''; return base.refresh();
  }
  function freshSelection(expected?: CloudExpenseSelection) {
    if (!ready()) return null; const selection = base.getState().snapshot?.selection; return selection && (!expected || selection === expected) ? selection : null;
  }
  async function verifyBytes(metadata: CloudInvoiceImageMetadata, value: unknown): Promise<string> {
    const fake = parseCloudInvoiceImage({ schemaVersion: 1, clinicId: 'main', recordId: '00000000-0000-4000-8000-000000000000',
      expenseId: '00000000-0000-4000-8000-000000000000', actorUid: 'synthetic-image-validation', createdAt: '2000-01-01T00:00:00.000Z', ...metadata, base64: value });
    const bytes = Uint8Array.from(atob(fake.base64), char => char.charCodeAt(0));
    const fingerprint = await (options.digestBytes ?? (async data => {
      const result = await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>); return Array.from(new Uint8Array(result), value => value.toString(16).padStart(2, '0')).join('');
    }))(bytes); if (fingerprint !== metadata.sha256) fail(); return fake.base64;
  }
  async function supplyBytes(metadata: CloudInvoiceImageMetadata, bytes: unknown, expectedDraft: CloudExpenseWorkspaceDraft, expectedOperationId: string | null) {
    if (disposed || imageLoading || base.getState().draft !== expectedDraft || base.getState().pendingOperationId !== expectedOperationId) return false;
    const ticket = ++imageEpoch; imageLoading = true; imageError = ''; emit();
    try { const base64 = await verifyBytes(metadata, bytes); const current = base.getState();
      if (disposed || ticket !== imageEpoch || current.closed || current.draft !== expectedDraft || current.pendingOperationId !== expectedOperationId) return false;
      imageBytes = { base64, sha256: metadata.sha256 }; return true;
    } catch { if (!disposed && ticket === imageEpoch) imageError = 'الصورة لا تطابق بصمة المحاولة أو تتجاوز الحدود. اختر نفس JPEG المضغوط؛ لم يُرفع شيء.'; return false; }
    finally { if (!disposed && ticket === imageEpoch) { imageLoading = false; emit(); } }
  }
  return Object.freeze({
    getState: () => decorate(),
    subscribe(listener: (value: CloudExpenseWorkspaceState) => void) {
      if (disposed) return () => undefined;
      if (!unsubscribe) unsubscribe = base.subscribe(value => emit(value)); listeners.add(listener);
      return () => { listeners.delete(listener); if (!listeners.size) { unsubscribe?.(); unsubscribe = null; } };
    },
    canClose: () => ready(),
    loadExpenses: (more = false) => navigate('expenses', undefined, more), loadMaterials: (more = false) => navigate('materials', undefined, more),
    openExpense: (id: string) => navigate('expense', id), openMaterial: (id: string) => navigate('material', id),
    async beginCreate() {
      if (!ready()) return false; if (!base.getState().loaded && !await navigate('expenses')) return false;
      if (!ready()) return false; const date = clock().slice(0, 10);
      return base.beginDraft({ action: 'create', header: { title: '', category: 'other', expenseType: 'other', date, note: '', isFixed: false, recurringPeriod: 'none',
        supplierName: '', supplierPhone: '', supplierAddress: '', invoiceNumber: '', invoiceDate: date, invoiceTime: '', taxNumber: '', commercialRecord: '', currency: 'EGP' },
        subtotal: '', tax: '0', discount: '0', paid: '', items: [] });
    },
    beginPayment(expected?: CloudExpenseSelection) { const selection = freshSelection(expected); if (selection?.kind !== 'expense' || selection.record.paidCents >= selection.record.data.totalCents) return false;
      return base.beginDraft({ action: 'pay', recordId: selection.record.recordId, expectedRevision: selection.record.revision, amount: '', date: clock().slice(0, 10), note: '' }); },
    beginEdit(expected?: CloudExpenseSelection) { const selection = freshSelection(expected); if (selection?.kind !== 'expense') return false;
      return base.beginDraft({ action: 'edit', recordId: selection.record.recordId, expectedRevision: selection.record.revision,
        data: Object.fromEntries(editKeys.map(key => [key, selection.record.data[key]])),
        ...(selection.record.data.items.length ? {} : { amount: String(selection.record.data.totalCents / 100) }) }); },
    beginUsage(expected?: CloudExpenseSelection) { const selection = freshSelection(expected); if (selection?.kind !== 'material') return false;
      return base.beginDraft({ action: 'usage', materialId: selection.record.recordId, expectedRevision: selection.record.revision, quantity: '', kind: 'used', date: clock().slice(0, 10), note: '' }); },
    updateDraft: (next: unknown, expected: CloudExpenseWorkspaceDraft) => !imageLoading && base.updateDraft(next, expected),
    addItem(expected: CloudExpenseWorkspaceDraft) { if (imageLoading || expected.action !== 'create' || base.getState().draft !== expected || expected.items.length >= MAX_CLOUD_EXPENSE_ITEMS) return false;
      const key = Math.max(0, ...expected.items.map(row => row.key)) + 1;
      return base.updateDraft({ ...expected, header: { ...expected.header, category: 'supplies', expenseType: 'supplies' }, items: [...expected.items,
        { key, name: '', unit: '', quantity: '', unitPrice: '', discount: '0', tax: '0' }] }, expected); },
    removeItem(key: number, expected: CloudExpenseWorkspaceDraft) { if (imageLoading || expected.action !== 'create' || !expected.items.some(row => row.key === key)) return false;
      return base.updateDraft({ ...expected, items: expected.items.filter(row => row.key !== key) }, expected); },
    save: (expected: CloudExpenseWorkspaceDraft) => imageLoading ? Promise.resolve(false) : base.save(expected),
    retry: () => imageLoading ? Promise.resolve(false) : base.retry(), cancelPending: () => imageLoading ? Promise.resolve(false) : base.cancelPending(),
    cancelDraft: (expected: CloudExpenseWorkspaceDraft) => !imageLoading && base.cancelDraft(expected),
    loadHistory: () => imageLoading ? Promise.resolve(false) : base.loadHistory(), loadMoreHistory: () => imageLoading ? Promise.resolve(false) : base.loadMoreHistory(),
    resume: (id: string) => imageLoading ? Promise.resolve(false) : base.resume(id),
    async beginImage(input: { image: CloudInvoiceImageMetadata; base64: string }, expected?: CloudExpenseSelection) {
      const selection = freshSelection(expected); if (selection?.kind !== 'expense') return false;
      let data: ReturnType<typeof exact>, metadata: CloudInvoiceImageMetadata;
      try { data = exact(input, ['image', 'base64']); metadata = parseCloudInvoiceImageMetadata(data.image); } catch { return false; }
      if (!base.beginDraft({ action: 'attach-image', recordId: selection.record.recordId, expectedRevision: selection.record.revision, image: metadata })) return false;
      const draft = base.getState().draft!; return supplyBytes(metadata, data.base64, draft, null);
    },
    /** Reserve the workspace BEFORE browser compression/hash awaits. The caller
     * supplies a pure task; this controller imports no DOM or compression SDK. */
    async prepareImage(work: () => Promise<{ image: CloudInvoiceImageMetadata; base64: string }>, expected?: CloudExpenseSelection) {
      const selection = freshSelection(expected); if (selection?.kind !== 'expense' || typeof work !== 'function') return false;
      const ticket = ++imageEpoch; imageLoading = true; imageError = ''; emit();
      try {
        const input = exact(await work(), ['image', 'base64']), metadata = parseCloudInvoiceImageMetadata(input.image), base64 = await verifyBytes(metadata, input.base64);
        if (disposed || ticket !== imageEpoch || base.getState().closed || base.getState().snapshot?.selection !== selection) return false;
        if (!base.beginDraft({ action: 'attach-image', recordId: selection.record.recordId, expectedRevision: selection.record.revision, image: metadata })) return false;
        imageBytes = { base64, sha256: metadata.sha256 }; return true;
      } catch { if (!disposed && ticket === imageEpoch) imageError = 'تعذر تجهيز صورة واضحة ضمن ١٥٠ كيلوبايت. لم يُرفع الأصل ولم تُحفظ صورة بديلة.'; return false; }
      finally { if (!disposed && ticket === imageEpoch) { imageLoading = false; emit(); } }
    },
    getPreparedImage(expected: CloudExpenseWorkspaceDraft) {
      const state = base.getState();
      return !disposed && !imageLoading && !state.closed && state.draft === expected && expected.action === 'attach-image'
        && imageBytes?.sha256 === expected.image.sha256 ? { base64: imageBytes.base64, contentType: 'image/jpeg' as const } : null;
    },
    async provideRecoveryImage(base64: string, operationId: string) {
      const state = base.getState(), draft = state.draft;
      if (draft?.action !== 'attach-image' || state.saveStatus !== 'retry-required' || state.pendingOperationId !== operationId) return false;
      return supplyBytes(draft.image, base64, draft, operationId);
    },
    async loadImage(expected?: CloudExpenseSelection) {
      const selection = freshSelection(expected); if (selection?.kind !== 'expense' || !selection.record.imageId) return false;
      const ticket = ++imageEpoch; imageLoading = true; imageError = ''; image = null; emit();
      try { const cap = await options.getCapability(); if (disposed || ticket !== imageEpoch || base.getState().closed) fail();
        const raw = await cap.repository.getInvoiceImage(selection.record.recordId); const parsed = parseCloudInvoiceImage(raw);
        const metadata = parseCloudInvoiceImageMetadata(Object.fromEntries(['sha256', 'byteLength', 'width', 'height', 'contentType'].map(key => [key, parsed[key as keyof CloudInvoiceImage]])));
        await verifyBytes(metadata, parsed.base64);
        if (disposed || ticket !== imageEpoch || base.getState().closed || base.getState().snapshot?.selection !== selection
          || parsed.expenseId !== selection.record.recordId || parsed.recordId !== selection.record.imageId
          || JSON.stringify(metadata) !== JSON.stringify(selection.record.image)) fail();
        image = freeze(parsed); return true;
      } catch { if (!disposed && ticket === imageEpoch) imageError = 'تعذر تأكيد صورة الفاتورة من الخادم؛ لم نعرض ملفًا بديلًا.'; return false; }
      finally { if (!disposed && ticket === imageEpoch) { imageLoading = false; emit(); } }
    },
    hideImage() { if (imageLoading) return false; image = null; imageError = ''; emit(); return true; },
    dispose() { if (cleaned) return; cleaned = true; disposed = true; ++imageEpoch;
      request = { kind: 'expenses', more: false, base: empty() }; imageBytes = null; image = null; imageLoading = false; imageError = '';
      base.dispose(); emit(); unsubscribe?.(); unsubscribe = null; listeners.clear(); },
  });
}
export type CloudExpenseWorkspaceController = ReturnType<typeof createCloudExpenseWorkspaceController>;
