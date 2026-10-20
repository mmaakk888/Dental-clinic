import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { invoiceFinancialDraft } from './invoiceFinancialDraft';
import { assertUniqueSupplierInvoice } from './expenseUtils';
import { isValidAppointmentDate } from '../components/appointments/appointmentScheduling';

const summary = new URL('../components/summary/SummaryView.tsx', import.meta.url);
const ocr = new URL('../components/summary/InvoiceOcrModal.tsx', import.meta.url);
// Run actual view callbacks against synthetic deferred adapters; no browser/profile/data/AI calls.
function callback(file: URL, name: string, dependencies: Record<string, unknown>): any {
  const source = readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) expression = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(ast); assert.ok(expression, `missing callback ${name}`);
  const code = ts.transpileModule(`return (${expression.getText(ast)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function('runtime', 'portable', ...Object.keys(dependencies), code)(undefined, null, ...Object.values(dependencies));
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const image = { dataUrl: 'data:image/jpeg;base64,c21hbGw=', mimeType: 'image/jpeg' as const,
  byteLength: 5, originalBytes: 1200, width: 800, height: 1000 };
function uploadEvent(type = 'image/png') {
  return { currentTarget: { files: [new Blob(['synthetic bytes'], { type })], value: 'selected-file' } };
}
function summaryHarness() {
  const state: Record<string, any> = { image: 'persisted-original', size: null, busy: false };
  const messages: string[] = [], calls: any[] = [], jobs: Array<ReturnType<typeof deferred<typeof image>>> = [];
  const invoiceUploadRef = { current: { request: 0, editor: 1, controller: null as AbortController | null, pending: false } };
  const invoiceAccessRef = { current: { mounted: true, canViewExpenses: true, expenseOpen: true, saving: false } };
  const dependencies: Record<string, any> = { invoiceUploadRef, invoiceAccessRef, invoiceEditor: 1, AbortController,
    setIsCompressingInvoice: (value: boolean) => { state.busy = value; },
    setInvoiceImageSize: (value: number | null) => { state.size = value; },
    setExpenseInvoiceImage: (value: string | undefined) => { state.image = value; },
    showToast: (message: string) => { messages.push(message); },
    require: (path: string) => {
      assert.equal(path, '../../utils/invoiceImageCompression');
      return { compressInvoiceImage: (...args: any[]) => { calls.push(args); const job = deferred<typeof image>(); jobs.push(job); return job.promise; } };
    } };
  dependencies.invalidateInvoiceUpload = callback(summary, 'invalidateInvoiceUpload', dependencies);
  dependencies.canEditExpenseInvoice = callback(summary, 'canEditExpenseInvoice', dependencies);
  return { state, messages, calls, jobs, invoiceUploadRef, invoiceAccessRef, dependencies,
    upload: callback(summary, 'handleInvoiceFileChange', dependencies),
    remove: callback(summary, 'handleRemoveInvoiceImage', dependencies),
    invalidate: dependencies.invalidateInvoiceUpload };
}
test('basic expense upload is explicit/lazy, stores only compressed copy in draft and resets same-file input', async () => {
  const h = summaryHarness(); assert.deepEqual(h.calls, []);
  const event = uploadEvent(), pending = h.upload(event); assert.equal(event.currentTarget.value, '');
  assert.equal(h.state.busy, true); assert.equal(h.state.image, 'persisted-original');
  await tick(); assert.equal(h.calls.length, 1); h.jobs[0].resolve(image); await pending;
  assert.equal(h.state.image, image.dataUrl); assert.equal(h.state.size, 5); assert.equal(h.state.busy, false);
  assert.equal(h.invoiceUploadRef.current.pending, false); assert.equal(h.calls[0][1].signal.aborted, false);
});
for (const loss of ['close', 'different-editor', 'permission', 'unmount', 'remove'] as const) {
  test(`basic expense rejects late upload after ${loss}`, async () => {
    const h = summaryHarness(), pending = h.upload(uploadEvent()); await tick();
    if (loss === 'close') h.invoiceAccessRef.current.expenseOpen = false;
    if (loss === 'different-editor') h.invoiceUploadRef.current.editor += 1;
    if (loss === 'permission') h.invoiceAccessRef.current.canViewExpenses = false;
    if (loss === 'unmount') h.invoiceAccessRef.current.mounted = false;
    if (loss === 'remove') h.remove(); else h.invalidate();
    assert.equal(h.calls[0][1].signal.aborted, true);
    h.jobs[0].resolve(image); await pending;
    assert.equal(h.state.image, loss === 'remove' ? undefined : 'persisted-original'); assert.deepEqual(h.messages, []);
  });
}
test('basic expense new selection supersedes old result and compression error has no original fallback', async () => {
  const h = summaryHarness(), first = h.upload(uploadEvent()); await tick();
  const second = h.upload(uploadEvent()); await tick(); assert.equal(h.calls[0][1].signal.aborted, true);
  h.jobs[0].resolve(image); await first; assert.equal(h.state.image, 'persisted-original');
  h.jobs[1].reject(new Error('synthetic failure')); await second;
  assert.equal(h.state.image, 'persisted-original'); assert.equal(h.state.busy, false); assert.equal(h.messages.length, 1);
});
test('invalid new file cancels pending basic image and permits same-file retry', async () => {
  const h = summaryHarness(), first = h.upload(uploadEvent()); await tick();
  const bad = uploadEvent('text/plain'); await h.upload(bad);
  assert.equal(bad.currentTarget.value, ''); assert.equal(h.state.busy, false); assert.equal(h.calls.length, 1);
  h.jobs[0].resolve(image); await first; assert.equal(h.state.image, 'persisted-original');
});
function summarySaveHarness(before: () => void = () => {}) {
  const h = summaryHarness(), saved: any[] = [];
  const persistence = deferred<void>();
  const dependencies = { ...h.dependencies, expenseTitle: 'مصروف مصطنع', expenseAmount: 100,
    expenseDate: '2026-10-12', isInvoiceTotalLocked: false, editingExpense: null,
    expenseCategory: 'supplies', expenseType: 'supplies', expenseNote: '', isFixedExpense: false,
    expenseInvoiceImage: 'persisted-original',
    onSaveExpense: (expense: any) => { saved.push(expense); return persistence.promise; },
    onAddExpense: () => { throw new Error('unexpected fallback'); },
    setIsExpenseModalOpen: (value: boolean) => { h.state.open = value; },
    onCloseAddExpenseModal: () => { h.state.closed = true; },
    confirmSave: async (operation: () => any, success: () => void) => {
      h.invoiceAccessRef.current.saving = true; before();
      try { await operation(); success(); } finally { h.invoiceAccessRef.current.saving = false; }
    } };
  const resetInvoiceUpload = callback(summary, 'resetInvoiceUpload', dependencies);
  return { ...h, saved, persistence, save: callback(summary, 'handleSaveExpenseForm', { ...dependencies, resetInvoiceUpload }),
    close: callback(summary, 'handleCloseExpenseModal', { ...dependencies, resetInvoiceUpload }) };
}
test('basic save accepted after busy rerender closes only its own draft and retains compressed-only payload', async () => {
  const h = summarySaveHarness(), pending = h.save({ preventDefault() {} });
  assert.equal(h.invoiceAccessRef.current.saving, true); assert.equal(h.saved.length, 1);
  h.persistence.resolve(); await pending;
  assert.equal(h.state.open, false); assert.equal(h.state.closed, true); assert.equal(h.messages.length, 1);
  assert.equal(h.saved[0].invoiceImageUrl, 'persisted-original');
});
test('basic save rejects pending image and rechecks permission immediately before persistence', async () => {
  const pendingImage = summarySaveHarness(); pendingImage.invoiceUploadRef.current.pending = true;
  await pendingImage.save({ preventDefault() {} }); assert.deepEqual(pendingImage.saved, []);
  let denied!: ReturnType<typeof summarySaveHarness>;
  denied = summarySaveHarness(() => { denied.invoiceAccessRef.current.canViewExpenses = false; });
  await assert.rejects(denied.save({ preventDefault() {} }), /صلاحية/); assert.deepEqual(denied.saved, []);
});
for (const loss of ['permission', 'new-editor', 'unmount'] as const) {
  test(`basic accepted write does not close another draft or publish late success after ${loss}`, async () => {
    const h = summarySaveHarness(), pending = h.save({ preventDefault() {} }); assert.equal(h.saved.length, 1);
    if (loss === 'permission') h.invoiceAccessRef.current.canViewExpenses = false;
    if (loss === 'new-editor') h.invoiceUploadRef.current.editor += 1;
    if (loss === 'unmount') h.invoiceAccessRef.current.mounted = false;
    h.persistence.resolve(); await pending; assert.equal(h.state.closed, undefined); assert.deepEqual(h.messages, []);
  });
}
test('retained basic close cannot close a newly opened expense editor', () => {
  const h = summarySaveHarness(); h.invoiceUploadRef.current.editor += 1; h.close();
  assert.equal(h.state.closed, undefined); assert.equal(h.invoiceAccessRef.current.expenseOpen, true);
});
function ocrHarness() {
  const state: Record<string, any> = {}, messages: string[] = [], compressionCalls: any[] = [], aiCalls: any[] = [];
  const compression = deferred<typeof image>(), extraction = deferred<any>();
  const uploadRef = { current: { request: 0, epoch: 1, controller: null as AbortController | null, pending: false } };
  const accessRef = { current: { mounted: true, isOpen: true, canUseInvoice: () => true, onClose: () => { state.closed = true; }, onSaveExpense: (_expense: unknown): void => {} } };
  const dependencies: Record<string, any> = { uploadRef, accessRef, viewEpoch: 1, committingRef: { current: false },
    AbortController, localDateISO: () => '2026-10-12', invoiceFinancialDraft,
    showToast: (message: string) => { messages.push(message); },
    require: (path: string) => { assert.equal(path, '../../utils/invoiceImageCompression'); return {
      compressInvoiceImage: (...args: any[]) => { compressionCalls.push(args); return compression.promise; } }; },
    AiService: { extractInvoice: (...args: any[]) => { aiCalls.push(args); return extraction.promise; } } };
  const names = new Set([...readFileSync(ocr, 'utf8').matchAll(/\b(set[A-Z]\w+)\(/g)].map(match => match[1]));
  for (const name of names) dependencies[name] = (value: any) => { state[name] = value; };
  dependencies.canAct = callback(ocr, 'canAct', dependencies);
  dependencies.invalidateUpload = callback(ocr, 'invalidateUpload', dependencies);
  dependencies.resetInvoiceDraft = callback(ocr, 'resetInvoiceDraft', dependencies);
  return { state, messages, compressionCalls, aiCalls, compression, extraction, uploadRef, accessRef, dependencies,
    upload: callback(ocr, 'handleImageUpload', dependencies), stop: callback(ocr, 'handleStopReading', dependencies),
    close: callback(ocr, 'handleClose', dependencies), remove: callback(ocr, 'handleRemoveImage', dependencies) };
}
test('OCR receives only compressed JPEG matching declared MIME, failed existing endpoint keeps manual draft', async () => {
  const h = ocrHarness(), event = uploadEvent(), pending = h.upload(event);
  assert.equal(event.currentTarget.value, ''); assert.deepEqual(h.aiCalls, []); await tick();
  h.compression.resolve(image); await tick(); assert.deepEqual(h.aiCalls, [[image.dataUrl, 'image/jpeg']]);
  assert.equal(h.state.setImagePreview, image.dataUrl); h.extraction.reject(new Error('disabled service')); await pending;
  assert.equal(h.state.setImagePreview, image.dataUrl); assert.equal(h.state.setPaidAmount, '');
  assert.equal(h.state.setIsExtracting, false); assert.equal(h.uploadRef.current.pending, false);
});
test('OCR compression failure retains a manual-entry path, no AI request, image or guessed cash', async () => {
  const h = ocrHarness(), pending = h.upload(uploadEvent()); await tick(); h.compression.reject(new Error('unreadable')); await pending;
  assert.equal(h.state.setHasInvoiceDraft, true); assert.equal(h.state.setImagePreview, null);
  assert.deepEqual(h.aiCalls, []); assert.equal(h.state.setPaidAmount, ''); assert.equal(h.state.setIsCompressing, false);
});
for (const loss of ['close', 'remove', 'stop', 'permission', 'unmount', 'new-view'] as const) {
  test(`OCR rejects late extraction after ${loss}`, async () => {
    const h = ocrHarness(), pending = h.upload(uploadEvent()); await tick(); h.compression.resolve(image); await tick();
    if (loss === 'close') h.close();
    else if (loss === 'remove') h.remove();
    else if (loss === 'stop') h.stop();
    else if (loss === 'permission') h.accessRef.current.canUseInvoice = () => false;
    else if (loss === 'unmount') h.accessRef.current.mounted = false;
    else h.uploadRef.current.epoch += 1;
    h.extraction.resolve({ supplierName: 'late supplier', totalAmount: 900, paidAmount: 900 }); await pending;
    assert.notEqual(h.state.setSupplierName, 'late supplier'); assert.equal(h.state.setPaidAmount, ''); assert.deepEqual(h.messages, []);
    if (loss === 'close') {
      assert.equal(h.state.setHasInvoiceDraft, false); assert.equal(h.state.setImagePreview, null);
      assert.deepEqual(h.state.setLineItems, []); assert.equal(h.state.setTotalAmount, '');
    }
  });
}
test('OCR keeps unknown total and cash blank; explicit total plus remainder may derive paid', async () => {
  for (const input of [{ paymentMethod: 'cash' }, { totalAmount: 100, remainingAmount: 30 }]) {
    const h = ocrHarness(), pending = h.upload(uploadEvent()); await tick(); h.compression.resolve(image); await tick();
    h.extraction.resolve(input); await pending;
    assert.equal(h.state.setTotalAmount, input.totalAmount ?? ''); assert.equal(h.state.setPaidAmount, input.totalAmount ? 70 : '');
  }
});
test('OCR classification or inconsistent financial suggestion cannot populate a guessed expense', async () => {
  for (const input of [{ category: 'forged', totalAmount: 100, paidAmount: 100 },
    { totalAmount: 100, paidAmount: 80, remainingAmount: 50 }]) {
    const h = ocrHarness(), pending = h.upload(uploadEvent()); await tick(); h.compression.resolve(image); await tick();
    h.extraction.resolve(input); await pending; assert.equal(h.state.setPaidAmount, ''); assert.equal(h.state.setExtractedData, null);
  }
});
function saveHarness(changes: Record<string, any> = {}) {
  const h = ocrHarness(), saved: any[] = [];
  h.accessRef.current.onSaveExpense = (expense: any) => { saved.push(expense); };
  const deps = { ...h.dependencies, isExtracting: false, isCompressing: false, invoiceDate: '2026-10-12', invoiceTime: '12:00',
    totalAmount: 100, paidAmount: 0, subtotal: '', discount: '', tax: '', lineItems: [], itemsSum: 100,
    supplierName: 'مورد مصطنع', title: '', existingExpenses: [], invoiceNumber: '', supplierPhone: '', supplierAddress: '',
    taxNumber: '', commercialRecord: '', paymentMethod: 'cash', category: 'supplies', currency: 'ج.م', notes: '',
    imagePreview: image.dataUrl, fieldConfidence: {}, priceVarianceAlerts: [], extractedData: null,
    isValidAppointmentDate, assertUniqueSupplierInvoice,
    confirmSave: async (operation: () => any, success: () => void) => { await operation(); success(); }, ...changes };
  return { ...h, saved, save: callback(ocr, 'handleSave', deps) };
}
test('actual OCR save requires explicit total and actual payment, including zero, before persistence', async () => {
  for (const changes of [{ totalAmount: '' }, { paidAmount: '' }, { paidAmount: 0.005 }, { tax: -1 }]) {
    const h = saveHarness(changes); await h.save(); assert.deepEqual(h.saved, []); assert.equal(h.state.closed, undefined);
  }
  const h = saveHarness(); await h.save(); assert.equal(h.saved.length, 1);
  assert.equal(h.saved[0].paidAmount, 0); assert.equal(h.saved[0].remainingAmount, 100);
  assert.equal(h.saved[0].invoiceImageUrl, image.dataUrl); assert.equal(h.state.closed, true);
  assert.equal(h.state.setPaidAmount, ''); assert.equal(h.state.setHasInvoiceDraft, false);
});
test('retained OCR save has fresh account/view/pending guards and never auto-saves an upload', async () => {
  for (const loss of ['permission', 'unmount', 'new-view', 'pending'] as const) {
    const h = saveHarness();
    if (loss === 'permission') h.accessRef.current.canUseInvoice = () => false;
    if (loss === 'unmount') h.accessRef.current.mounted = false;
    if (loss === 'new-view') h.uploadRef.current.epoch += 1;
    if (loss === 'pending') h.uploadRef.current.pending = true;
    await h.save(); assert.deepEqual(h.saved, []);
  }
});
