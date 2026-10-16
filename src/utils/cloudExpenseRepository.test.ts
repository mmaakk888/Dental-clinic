import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createCloudOperationIntentRepository, type CloudIntentAdapter } from './cloudOperationIntent';
import { CloudExpenseError, createCloudExpenseRepository, prepareCloudExpenseCommand, cloudMaterialId, cloudMaterialIdV2,
  parseCloudExpenseRecord, parseCloudMaterialBalance, parseCloudExpensePayment, parseCloudMaterialUsage,
  parseCloudInvoiceImageMetadata, parseCloudInvoiceImage, prepareCloudExpensePageInput,
  type CloudExpenseAdapter, type CloudExpenseCommand, type CloudExpenseData, type CloudExpenseItem } from './cloudExpenseRepository';

// Fabricated isolated atomic data only: no owner accounts, Firebase or browser data.
const OWNER = 'synthetic-expense-owner', WHEN = '2026-10-12T00:00:00.000Z', DAY = '2026-10-12';
const id = (value: number) => `70000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const path = (collection: string, recordId: string) => `clinics/main/${collection}/${recordId}`;
const digest = async (value: string) => createHash('sha256').update(value).digest('hex');
const digestBytes = async (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
const item = (changes: Partial<CloudExpenseItem> = {}): CloudExpenseItem => ({ itemId: id(501), name: 'قفازات مصطنعة',
  unit: 'علبة', quantityMilli: 2000, unitPriceCents: 5000, discountCents: 0, taxCents: 0, totalCents: 10000, ...changes });
const data = (changes: Partial<CloudExpenseData> = {}): CloudExpenseData => ({ title: 'فاتورة مصطنعة', category: 'supplies',
  expenseType: 'supplies', date: DAY, note: '', isFixed: false, recurringPeriod: 'none', supplierName: 'مورد مصطنع',
  supplierPhone: '', supplierAddress: '', invoiceNumber: '', invoiceDate: DAY, invoiceTime: '', taxNumber: '',
  commercialRecord: '', currency: 'EGP', subtotalCents: 10000, taxCents: 0, discountCents: 0, totalCents: 10000,
  items: [item()], ...changes });
const create = (number = 1, changes: Partial<CloudExpenseData> = {}, paidCents = 0, recordId = id(101)): CloudExpenseCommand => ({
  action: 'create', operationId: id(number), createdAt: WHEN, recordId, expectedRevision: 0, data: data(changes), paidCents });
const pay = (number = 2, expectedRevision = 1, amountCents = 1000): CloudExpenseCommand => ({ action: 'pay', operationId: id(number),
  createdAt: WHEN, recordId: id(101), expectedRevision, amountCents, date: DAY, note: 'دفعة مصطنعة' });
const edit = (number = 3, expectedRevision = 2): CloudExpenseCommand => ({ action: 'edit', operationId: id(number), createdAt: WHEN,
  recordId: id(101), expectedRevision, data: { title: 'عنوان مراجع', date: DAY, note: 'ملاحظة', isFixed: false, recurringPeriod: 'none', expenseType: 'supplies' } });
const usage = (materialId: string, number = 2, expectedRevision = 1, quantityMilli = 1000, kind: 'used' | 'waste' = 'used'): CloudExpenseCommand => ({
  action: 'usage', operationId: id(number), createdAt: WHEN, materialId, expectedRevision, quantityMilli, kind, date: DAY, note: '' });
const code = (expected: CloudExpenseError['code']) => (error: unknown) => error instanceof CloudExpenseError && error.code === expected;
function jpeg(width = 320, height = 160) {
  // Deliberately structural fixture; native browser encoding is tested elsewhere.
  return Buffer.from([255,216,255,192,0,17,8,height>>8,height&255,width>>8,width&255,3,1,17,0,2,17,0,3,17,0,
    255,218,0,12,3,1,0,2,0,3,0,0,63,0,1,2,3,255,217]);
}
function attach(number = 2, expectedRevision = 1, bytes = jpeg()): CloudExpenseCommand {
  return { action: 'attach-image', operationId: id(number), createdAt: WHEN, recordId: id(101), expectedRevision,
    image: { sha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length, width: 320, height: 160, contentType: 'image/jpeg' } };
}
function harness() {
  const docs = new Map<string, any>(), calls: string[] = []; let uid = OWNER, tail = Promise.resolve(), writes = 0;
  const faults = { loseReply: false, retry: false, failWrite: 0 };
  const hooks: { read?: (path: string) => void; auth?: () => void; commit?: () => void } = {};
  const adapter: CloudExpenseAdapter & CloudIntentAdapter = {
    authorizeOwner: async () => { calls.push('auth'); hooks.auth?.(); return uid; },
    readRecord: async target => { calls.push(`read:${target}`); hooks.read?.(target); return structuredClone(docs.get(target) ?? null); },
    listPage: async (collection, ownerId, afterId, limit) => [...docs].filter(([target, value]) => target.startsWith(`clinics/main/${collection}/`)
      && (ownerId === null || value[collection === 'materialUsages' ? 'materialId' : 'expenseId'] === ownerId)
      && (afterId === null || value.recordId > afterId)).sort(([a], [b]) => a < b ? -1 : 1).slice(0, limit)
      .map(([target, value]) => ({ id: target.split('/').at(-1), data: structuredClone(value) })),
    runTransaction: async work => {
      const previous = tail; let release!: () => void; tail = new Promise<void>(accept => { release = accept; }); await previous;
      const attempt = async (publish: boolean) => { const staged = structuredClone(docs); let wrote = false, domain = false;
        const result = await work({ get: async target => { assert.equal(wrote, false, 'all reads before all writes'); calls.push(`get:${target}`);
          hooks.read?.(target); return structuredClone(staged.get(target) ?? null); }, set: (target, value) => {
          wrote = true; calls.push(`set:${target}`); if (++writes === faults.failWrite) throw new Error('PRIVATE_WRITE');
          domain ||= target.includes('/expenseRecords/') || target.includes('/materialUsages/'); staged.set(target, structuredClone(value)); } });
        if (publish) { docs.clear(); staged.forEach((value, key) => docs.set(key, value)); }
        if (publish && domain) { hooks.commit?.(); if (faults.loseReply) { faults.loseReply = false; throw new Error('PRIVATE_ACK'); } } return result; };
      try { if (faults.retry) { faults.retry = false; await attempt(false); } return await attempt(true); } finally { release(); }
    },
  };
  const repo = createCloudExpenseRepository(adapter, { digest, digestBytes });
  const journal = createCloudOperationIntentRepository(adapter, { digest });
  return { docs, calls, adapter, repo, journal, hooks, faults, owner: (value: string) => { uid = value; }, writes: () => writes,
    prepare: (command: CloudExpenseCommand) => journal.prepare('expense', prepareCloudExpenseCommand(command), command.createdAt),
    async commit(command: CloudExpenseCommand, image?: string) { await this.prepare(command); return repo.commit(command, image); } };
}
test('expense construction inert; absent records/materials unknown and no default seeds', async () => {
  const h = harness(); assert.deepEqual(h.calls, []); assert.equal(await h.repo.get(id(101)), null);
  assert.equal(await h.repo.getMaterial('a'.repeat(64)), null); assert.equal(h.docs.size, 0);
});
test('explicit charge is not cash; unpaid supplier invoice and line purchases commit atomically', async () => {
  const h = harness(); assert.deepEqual(await h.commit(create()), { status: 'committed', recordId: id(101), revision: 1 });
  const expense = await h.repo.get(id(101)); assert.equal(expense?.data.totalCents, 10000); assert.equal(expense?.paidCents, 0);
  assert.equal(expense?.paymentCount, 0); assert.equal([...h.docs.keys()].some(key => key.includes('/expensePayments/')), false);
  const material = await h.repo.getMaterial(await cloudMaterialIdV2(item().name, item().unit, { digest }));
  assert.equal(material?.purchasedMilli, 2000); assert.equal(material?.purchaseCostCents, 10000);
  assert.equal(h.docs.get(path('operationIntents', id(1))).status, 'committed');
});
test('initial actual partial payment creates immutable payment independent of total', async () => {
  const h = harness(); await h.commit(create(1, {}, 2500)); const expense = await h.repo.get(id(101));
  assert.equal(expense?.paidCents, 2500); assert.equal(expense?.paymentCount, 1);
  assert.equal(parseCloudExpensePayment(h.docs.get(path('expensePayments', id(1)))).amountCents, 2500);
});

test('an explicit unitemized amount correction preserves existing cash and creates no stock or payment', async () => {
  const h = harness(); await h.commit(create(1, { category: 'fixed', expenseType: 'electricity', items: [], taxCents: 100, totalCents: 10100 }, 2500));
  const correction = edit(3, 1); if (correction.action !== 'edit') assert.fail();
  correction.data.totalCents = 8000;
  await h.commit(correction); const after = await h.repo.get(id(101));
  assert.equal(after?.data.totalCents, 8000); assert.equal(after?.data.subtotalCents, 7900);
  assert.equal(after?.paidCents, 2500); assert.equal(after?.paymentCount, 1);
  assert.equal([...h.docs.keys()].filter(key => key.includes('/expensePayments/')).length, 1);
  assert.equal([...h.docs.keys()].some(key => key.includes('/materialBalances/')), false);
  const writes = h.writes(); assert.equal((await h.repo.commit(correction)).status, 'already-committed'); assert.equal(h.writes(), writes);
});
test('amount correction cannot reduce below cash already paid or rewrite itemized purchases', async () => {
  for (const itemized of [false, true]) {
    const h = harness(); await h.commit(create(1, itemized ? {} : { items: [] }, 2500));
    const correction = edit(3, 1); if (correction.action !== 'edit') assert.fail(); correction.data.totalCents = itemized ? 8000 : 2000;
    await h.prepare(correction); const before = structuredClone(h.docs);
    await assert.rejects(h.repo.commit(correction), code(itemized ? 'invalid' : 'conflict')); assert.deepEqual(h.docs, before);
  }
});
test('pay updates only actual paid/count/revision and preserves charges and stock', async () => {
  const h = harness(); await h.commit(create()); const before = structuredClone(h.docs.get(path('expenseRecords', id(101))));
  const stocks = [...h.docs].filter(([key]) => key.includes('/materialBalances/')); await h.commit(pay());
  const after = await h.repo.get(id(101)); assert.deepEqual(after?.data, before.data); assert.equal(after?.paidCents, 1000);
  assert.equal(after?.paymentCount, 1); assert.deepEqual([...h.docs].filter(([key]) => key.includes('/materialBalances/')), stocks);
});
test('rent/electricity/water/salary/custom categories allow explicit fixed expenses without invented inventory', async () => {
  for (const expenseType of ['rent', 'electricity', 'water', 'salary', 'other'] as const) {
    const h = harness(); await h.commit(create(1, { category: 'fixed', expenseType, isFixed: true, recurringPeriod: 'monthly', items: [] }));
    assert.equal((await h.repo.get(id(101)))?.data.expenseType, expenseType); assert.equal([...h.docs.keys()].some(key => key.includes('materialBalances')), false);
  }
});
test('metadata edit cannot submit or erase totals/items/payment state', async () => {
  const h = harness(); await h.commit(create()); await h.commit(pay()); await h.commit(edit());
  const current = await h.repo.get(id(101)); assert.equal(current?.data.title, 'عنوان مراجع'); assert.equal(current?.paidCents, 1000);
  assert.deepEqual(current?.data.items, [item()]); assert.equal(current?.data.totalCents, 10000);
  const input: any = edit(4, 3); input.data.totalCents = 0; await assert.rejects(h.repo.commit(input), code('invalid'));
});
test('stale metadata edit cannot erase payment made since form opened', async () => {
  const h = harness(); await h.commit(create()); await h.prepare(edit(3, 1)); await h.commit(pay());
  const before = structuredClone(h.docs); await assert.rejects(h.repo.commit(edit(3, 1)), code('conflict')); assert.deepEqual(h.docs, before);
});
test('overpayment/zero/negative/fractional cash refused without mutations', async () => {
  const h = harness(); await h.commit(create()); const before = structuredClone(h.docs);
  for (const amountCents of [0, -1, 1.2, NaN, Infinity]) await assert.rejects(h.repo.commit({ ...pay(), amountCents }), code('invalid'));
  assert.deepEqual(h.docs, before); const excessive = pay(2, 1, 10001); await h.prepare(excessive);
  const prepared = structuredClone(h.docs); await assert.rejects(h.repo.commit(excessive), code('conflict')); assert.deepEqual(h.docs, prepared);
});
test('two concurrent invoice writers cannot spend same expense balance', async () => {
  const h = harness(); await h.commit(create()); const a = pay(2, 1, 8000), b = pay(3, 1, 8000); await h.prepare(a); await h.prepare(b);
  const result = await Promise.allSettled([h.repo.commit(a), h.repo.commit(b)]);
  assert.equal(result.filter(value => value.status === 'fulfilled').length, 1); assert.equal((await h.repo.get(id(101)))?.paidCents, 8000);
});
test('same exact supplier and invoice reservation prevents duplicate charge/inventory without silent v1 normalization', async () => {
  const h = harness(); await h.commit(create(1, { invoiceNumber: 'INV  ١', supplierName: 'مورد' }));
  const duplicate = create(2, { invoiceNumber: 'INV  ١', supplierName: 'مورد' }, 0, id(102)); await h.prepare(duplicate);
  const before = structuredClone(h.docs); await assert.rejects(h.repo.commit(duplicate), code('conflict')); assert.deepEqual(h.docs, before);
});
test('different suppliers may use same invoice number; blank numbers reserve nothing', async () => {
  const h = harness(); await h.commit(create(1, { invoiceNumber: '1', supplierName: 'مورد أ' }));
  await h.commit(create(2, { invoiceNumber: '1', supplierName: 'مورد ب' }, 0, id(102)));
  assert.equal([...h.docs.keys()].filter(key => key.includes('/supplierInvoiceReservations/')).length, 2);
});
test('duplicate item names merge stock once; fractional quantities represented exactly', async () => {
  const h = harness(); const a = item({ quantityMilli: 1500, totalCents: 7500 }), b = item({ itemId: id(502), quantityMilli: 500, totalCents: 2500 });
  await h.commit(create(1, { items: [a, b] })); const result = await h.repo.listMaterialsPage();
  assert.equal(result.records.length, 1); assert.equal(result.records[0].purchasedMilli, 2000); assert.equal(result.records[0].purchaseCostCents, 10000);
});
test('invoice tax/discount allocation conserves every cent across line stock', async () => {
  const h = harness(); const a = item({ name: 'أ', quantityMilli: 1000, unitPriceCents: 1, totalCents: 1 }),
    b = item({ itemId: id(502), name: 'ب', quantityMilli: 1000, unitPriceCents: 2, totalCents: 2 });
  await h.commit(create(1, { items: [a, b], subtotalCents: 3, taxCents: 2, discountCents: 1, totalCents: 4 }));
  assert.equal((await h.repo.listMaterialsPage()).records.reduce((sum, row) => sum + row.purchaseCostCents, 0), 4);
});
test('usage/waste capture cost and preserve exact residual cents when depleted', async () => {
  const h = harness(); await h.commit(create(1, { items: [item({ quantityMilli: 3000, unitPriceCents: 1, totalCents: 3 })],
    subtotalCents: 3, taxCents: 0, discountCents: 1, totalCents: 2 }));
  const materialId = await cloudMaterialIdV2(item().name, item().unit, { digest });
  await h.commit(usage(materialId, 2, 1, 1000)); await h.commit(usage(materialId, 3, 2, 2000, 'waste'));
  const balance = await h.repo.getMaterial(materialId); assert.equal(balance?.usedMilli, 1000); assert.equal(balance?.wasteMilli, 2000);
  assert.equal(balance?.consumedCostCents, 2); assert.equal((await h.repo.listUsagesPage(materialId)).records.reduce((sum, row) => sum + row.costCents, 0), 2);
});
test('insufficient stock/stale stock CAS cannot make negative inventory', async () => {
  const h = harness(); await h.commit(create()); const materialId = await cloudMaterialIdV2(item().name, item().unit, { digest });
  const excessive = usage(materialId, 2, 1, 2001); await h.prepare(excessive); const before = structuredClone(h.docs);
  await assert.rejects(h.repo.commit(excessive), code('conflict')); assert.deepEqual(h.docs, before);
  await h.commit(usage(materialId, 3)); const stale = usage(materialId, 4); await h.prepare(stale);
  await assert.rejects(h.repo.commit(stale), code('conflict')); assert.equal((await h.repo.getMaterial(materialId))?.usedMilli, 1000);
});
test('additional purchase preserves all consumption and adds real quantity/cost', async () => {
  const h = harness(); await h.commit(create()); const materialId = await cloudMaterialIdV2(item().name, item().unit, { digest });
  await h.commit(usage(materialId)); await h.commit(create(3, {}, 0, id(102)));
  const balance = await h.repo.getMaterial(materialId); assert.equal(balance?.purchasedMilli, 4000); assert.equal(balance?.usedMilli, 1000);
  assert.equal(balance?.purchaseCostCents, 20000); assert.equal(balance?.consumedCostCents, 5000);
});
test('same-ID historical create/pay/usage replays read receipt+intent only, never newer state', async () => {
  const h = harness(); const original = create(); await h.commit(original); await h.commit(pay());
  const materialId = await cloudMaterialIdV2(item().name, item().unit, { digest }), u = usage(materialId, 3); await h.commit(u);
  const before = structuredClone(h.docs); h.calls.length = 0;
  for (const command of [original, pay(), u]) assert.equal((await h.repo.commit(command)).status, 'already-committed');
  assert.deepEqual(h.docs, before); assert.equal(h.calls.filter(value => value.startsWith('get:')).length, 6);
  assert.ok(h.calls.filter(value => value.startsWith('get:')).every(value => /expenseOperations|operationIntents/.test(value)));
});
test('lost accepted reply retains original operation and cannot duplicate cash/stock', async () => {
  const h = harness(); const command = create(1, {}, 2500); await h.prepare(command); h.faults.loseReply = true;
  await assert.rejects(h.repo.commit(command), code('unavailable')); const before = structuredClone(h.docs);
  assert.equal((await h.repo.commit(command)).status, 'already-committed'); assert.deepEqual(h.docs, before);
});
test('transaction rerun is atomic and deterministic with one receipt and stock addition', async () => {
  const h = harness(); await h.prepare(create()); h.faults.retry = true; await h.repo.commit(create());
  assert.equal((await h.repo.listMaterialsPage()).records[0].purchasedMilli, 2000);
  assert.equal([...h.docs.keys()].filter(key => key.includes('/expenseOperations/')).length, 1);
});
test('unprepared/cancelled/wrong owner/wrong body intent cannot write', async () => {
  const h = harness(); await assert.rejects(h.repo.commit(create()), code('invalid')); assert.equal(h.docs.size, 0);
  await h.prepare(create()); await h.journal.cancel(id(1)); const before = structuredClone(h.docs);
  await assert.rejects(h.repo.commit(create()), code('conflict')); assert.deepEqual(h.docs, before);
  const h2 = harness(); await h2.prepare(create()); h2.owner('other-owner'); await assert.rejects(h2.repo.commit(create()), code('conflict'));
  const h3 = harness(); await h3.prepare(create()); await assert.rejects(h3.repo.commit(create(1, { title: 'مختلف' })), code('conflict'));
});
test('attachment metadata only is journaled; bytes live in separate on-demand immutable doc', async () => {
  const h = harness(); await h.commit(create()); const command = attach(), base64 = jpeg().toString('base64'); await h.commit(command, base64);
  const intent = h.docs.get(path('operationIntents', id(2))); assert.equal(JSON.stringify(intent).includes(base64), false);
  assert.equal(JSON.stringify(h.docs.get(path('expenseRecords', id(101)))).includes(base64), false);
  assert.equal((await h.repo.getInvoiceImage(id(101)))?.base64, base64);
  h.calls.length = 0; await h.repo.listPage(); assert.equal(h.calls.some(value => value.includes('invoiceImages')), false);
});
test('historical attachment replay needs no payload and cannot replace newer image', async () => {
  const h = harness(); await h.commit(create()); const original = attach(); await h.commit(original, jpeg().toString('base64'));
  await h.commit(attach(3, 2), jpeg().toString('base64')); const before = structuredClone(h.docs); h.calls.length = 0;
  assert.equal((await h.repo.commit(original)).status, 'already-committed'); assert.deepEqual(h.docs, before);
  assert.equal(h.docs.get(path('expenseRecords', id(101))).imageId, id(3)); assert.equal(h.calls.some(value => value.includes('invoiceImages')), false);
});
test('new attachment cannot use missing/raw/truncated/oversized/mismatched-hash or dimensions payload', async () => {
  for (const payload of [undefined, 'data:image/jpeg;base64,' + jpeg().toString('base64'), Buffer.from('not jpeg').toString('base64'),
    jpeg().subarray(0, -2).toString('base64'), jpeg(321, 160).toString('base64'), Buffer.alloc(153601).toString('base64')]) {
    const h = harness(); await h.commit(create()); await h.prepare(attach()); const before = structuredClone(h.docs);
    await assert.rejects(h.repo.commit(attach(), payload), code('invalid')); assert.deepEqual(h.docs, before);
  }
  const h = harness(); await h.commit(create()); const altered: any = attach(); altered.image.sha256 = 'a'.repeat(64); await h.prepare(altered);
  await assert.rejects(h.repo.commit(altered, jpeg().toString('base64')), code('invalid'));
});
test('150KiB image boundary remains separate and readable without entering 128KiB journal', async () => {
  const h = harness(); await h.commit(create()); const small = jpeg();
  const bytes = Buffer.concat([small.subarray(0, -2), Buffer.alloc(150 * 1024 - small.length), small.subarray(-2)]);
  const command = attach(2, 1, bytes); await h.commit(command, bytes.toString('base64'));
  assert.equal((await h.repo.getInvoiceImage(id(101)))?.byteLength, 150 * 1024);
  assert.ok(JSON.stringify(h.docs.get(path('operationIntents', id(2)))).length < 128 * 1024);
});
test('attachment access rechecks metadata and expense fence, rejects corrupt image not stale success', async () => {
  const h = harness(); await h.commit(create()); await h.commit(attach(), jpeg().toString('base64'));
  h.docs.get(path('invoiceImages', id(2))).expenseId = id(999); await assert.rejects(h.repo.getInvoiceImage(id(101)), code('invalid'));
  h.docs.get(path('invoiceImages', id(2))).expenseId = id(101); let reads = 0;
  h.hooks.read = target => { if (target === path('expenseRecords', id(101)) && ++reads === 2) h.docs.get(target).revision++; };
  await assert.rejects(h.repo.getInvoiceImage(id(101)), code('conflict'));
});
test('material identity stable canonical name/unit; distinct unit is distinct stock', async () => {
  assert.equal(await cloudMaterialId('أداة', 'قطعة', { digest }), await cloudMaterialId('اداه', 'قطعه', { digest }));
  assert.notEqual(await cloudMaterialId('أداة', 'علبة', { digest }), await cloudMaterialId('أداة', 'قطعة', { digest }));
});
test('bounded ascending page validation includes exact filters and UUID/hash cursors', async () => {
  const h = harness(); await h.commit(create()); await h.commit(create(2, {}, 0, id(102))); await h.commit(pay(3));
  const first = await h.repo.listPage({ limit: 1 }); assert.equal(first.records.length, 1); assert.equal(first.nextAfterId, id(101));
  const second = await h.repo.listPage({ afterId: first.nextAfterId!, limit: 1 }); assert.equal(second.records[0].recordId, id(102));
  assert.equal((await h.repo.listPaymentsPage(id(101))).records.length, 1);
  assert.equal((await h.repo.listPaymentsPage(id(102))).records.length, 0);
  for (const input of [{ limit: 51 }, { afterId: '../' }, { afterId: 'a'.repeat(64) }, { limit: -0 }]) await assert.rejects(h.repo.listPage(input), code('invalid'));
  await assert.rejects(h.repo.listMaterialsPage({ afterId: id(101) }), code('invalid'));
});
test('malformed/misordered/sparse/crossfilter pages fail closed', async () => {
  const h = harness(); await h.commit(create()); await h.commit(pay()); const expense = h.docs.get(path('expenseRecords', id(101)));
  for (const bad of [[{ id: id(102), data: expense }], [{ id: id(101), data: expense }, { id: id(101), data: expense }], new Array(1)]) {
    h.adapter.listPage = async () => bad; await assert.rejects(h.repo.listPage(), code('invalid'));
  }
  h.adapter.listPage = async () => [{ id: id(2), data: h.docs.get(path('expensePayments', id(2))) }];
  await assert.rejects(h.repo.listPaymentsPage(id(999)), code('invalid'));
});
test('unknown read/list capability unavailable, invalid paths rejected before provider', async () => {
  const h = harness(); delete h.adapter.readRecord; delete h.adapter.listPage;
  await assert.rejects(h.repo.get(id(101)), code('unavailable')); await assert.rejects(h.repo.listPage(), code('unavailable'));
  await assert.rejects(h.repo.get('../secret'), code('invalid')); await assert.rejects(h.repo.getMaterial(id(1)), code('invalid'));
  await assert.rejects(h.repo.listPaymentsPage(null as any), code('invalid')); await assert.rejects(h.repo.listUsagesPage(null as any), code('invalid'));
});
test('material reads/pages reject otherwise valid balances whose hash names another material', async () => {
  const h = harness(); await h.commit(create()); const materialId = await cloudMaterialIdV2(item().name, item().unit, { digest });
  h.docs.get(path('materialBalances', materialId)).pending.candidate.name = 'اسم مزور';
  await assert.rejects(h.repo.getMaterial(materialId), code('invalid')); await assert.rejects(h.repo.listMaterialsPage(), code('invalid'));
});
test('mutable commands are snapshotted before authorization awaits', async () => {
  const h = harness(); const original: any = create(); await h.prepare(original); let mutate = true;
  h.hooks.auth = () => { if (mutate) { mutate = false; original.data.totalCents = 0; original.paidCents = 0; original.data.title = 'bad'; } };
  await h.repo.commit(original); assert.equal((await h.repo.get(id(101)))?.data.title, 'فاتورة مصطنعة');
});
test('owner loss during read/accepted commit rejects late results without claiming server undo', async () => {
  const h = harness(); await h.commit(create()); h.hooks.read = () => h.owner('different');
  await assert.rejects(h.repo.get(id(101)), code('unavailable'));
  const h2 = harness(); await h2.prepare(create()); h2.hooks.commit = () => h2.owner('different');
  await assert.rejects(h2.repo.commit(create()), code('unavailable')); assert.equal(h2.docs.get(path('expenseRecords', id(101))).revision, 1);
});
test('partial write failure rolls back stock/expense/receipt/intent transaction', async () => {
  const h = harness(); await h.prepare(create()); const before = structuredClone(h.docs); h.faults.failWrite = h.writes() + 2;
  await assert.rejects(h.repo.commit(create()), code('unavailable'));
  const publicRows = (rows: Map<string, any>) => new Map([...rows].filter(([key]) => !key.includes('/expenseInventoryProofs/')));
  assert.deepEqual(publicRows(h.docs), publicRows(before));
});
test('provider/hostile errors never disclose raw details', async () => {
  const h = harness(); h.adapter.readRecord = async () => { throw new Error('PRIVATE_PROVIDER_TOKEN'); };
  await assert.rejects(h.repo.get(id(101)), error => error instanceof CloudExpenseError && !error.message.includes('PRIVATE'));
  const proxy = new Proxy({}, { getPrototypeOf() { throw new Error('PRIVATE_PROXY'); } });
  assert.throws(() => prepareCloudExpenseCommand(proxy), error => error instanceof CloudExpenseError && error.code === 'invalid');
});
test('exact schema rejects getters/extras/bad dates/unsafe amounts/item math and sparse arrays', () => {
  const inputs: any[] = [{ ...create(), extra: true }, { ...create(), expectedRevision: 1 }, { ...create(), createdAt: '2026-02-30T00:00:00.000Z' },
    create(1, { date: '2026-02-30' }), create(1, { totalCents: -0 }), create(1, { subtotalCents: Number.MAX_SAFE_INTEGER }),
    create(1, { invoiceNumber: 'x', supplierName: '' }), create(1, { items: new Array(1) }), create(1, { items: [item({ totalCents: 10 })] })];
  const getter = create() as any; Object.defineProperty(getter, 'operationId', { enumerable: true, get() { throw new Error('getter'); } }); inputs.push(getter);
  for (const input of inputs) assert.throws(() => prepareCloudExpenseCommand(input), code('invalid'));
});
test('stored parsers enforce exact schemas/counts/stock/linked images/currency and cents', async () => {
  const h = harness(); await h.commit(create(1, {}, 1000)); const expense = h.docs.get(path('expenseRecords', id(101)));
  for (const changes of [{ paymentCount: 0 }, { paidCents: 10001 }, { imageId: id(99) }, { extra: 1 }, { invoiceKey: 'a'.repeat(64) }])
    assert.throws(() => parseCloudExpenseRecord({ ...expense, ...changes }), code('invalid'));
  const material = (await h.repo.listMaterialsPage()).records[0]; assert.throws(() => parseCloudMaterialBalance({ ...material, usedMilli: 2001 }), code('invalid'));
  assert.throws(() => parseCloudExpensePayment({ ...h.docs.get(path('expensePayments', id(1))), amountCents: 0 }), code('invalid'));
  assert.throws(() => parseCloudMaterialUsage({}), code('invalid')); assert.throws(() => parseCloudInvoiceImage({}), code('invalid'));
  assert.throws(() => parseCloudInvoiceImageMetadata({ ...(attach() as any).image, byteLength: 153601 }), code('invalid'));
  assert.deepEqual(prepareCloudExpensePageInput({}), { afterId: null, limit: 25 });
});

test('interrupted private preparation has no expense, cash or purchase until the original final commit', async () => {
  const h = harness(), command = create(1, { items: [item(), item({ itemId: id(502), name: 'خامة ثانية' })], subtotalCents: 20000, totalCents: 20000 }, 1000);
  await h.prepare(command); h.faults.failWrite = h.writes() + 14;
  await assert.rejects(h.repo.commit(command), code('unavailable'));
  assert.equal(h.docs.has(path('expenseRecords', id(101))), false); assert.equal(h.docs.has(path('expensePayments', id(1))), false);
  assert.equal(await h.repo.getMaterial(await cloudMaterialIdV2(item().name, item().unit, { digest })), null);
  assert.deepEqual((await h.repo.listMaterialsPage()).records, []);
  assert.equal(h.docs.get(path('operationIntents', id(1))).status, 'prepared');
  await h.repo.commit(command); assert.equal((await h.repo.listMaterialsPage()).records.length, 2);
  assert.equal((await h.repo.get(id(101)))?.paidCents, 1000);
});
test('cancelling an interrupted purchase resolves its private head to unchanged base and fences concurrent stock writes', async () => {
  const h = harness(); await h.commit(create());
  const materialId = await cloudMaterialIdV2(item().name, item().unit, { digest });
  const command = create(2, { items: [item(), item({ itemId: id(502), name: 'خامة ثانية' })], subtotalCents: 20000, totalCents: 20000 }, 0, id(102));
  await h.prepare(command); h.faults.failWrite = h.writes() + 14; await assert.rejects(h.repo.commit(command), code('unavailable'));
  assert.equal((await h.repo.getMaterial(materialId))?.purchasedMilli, 2000);
  const use = usage(materialId, 3); await h.prepare(use); await assert.rejects(h.repo.commit(use), code('conflict'));
  await h.journal.cancel(id(2)); await assert.rejects(h.repo.commit(command), code('conflict'));
  assert.equal((await h.repo.getMaterial(materialId))?.purchasedMilli, 2000);
  await h.repo.commit(use); assert.equal((await h.repo.getMaterial(materialId))?.usedMilli, 1000);
  await h.commit(create(4, {}, 0, id(104))); assert.equal((await h.repo.getMaterial(materialId))?.purchasedMilli, 4000);
  assert.equal(h.docs.has(path('expenseRecords', id(102))), false);
});
test('Firestore map-key reordering cannot break exact-ID proof recovery, but altered proof content does', async () => {
  const reorder = (value: any): any => Array.isArray(value) ? value.map(reorder) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reorder(item)])) : value;
  for (const tamper of [false, true]) {
    const h = harness(), command = create(1, { items: [item(), item({ itemId: id(502), name: 'ثانية' })], subtotalCents: 20000, totalCents: 20000 });
    await h.prepare(command); h.faults.failWrite = h.writes() + 14; await assert.rejects(h.repo.commit(command));
    const key = [...h.docs.keys()].find(key => key.includes('/expenseInventoryProofs/') && h.docs.get(key).summary)!;
    h.docs.set(key, reorder(h.docs.get(key))); if (tamper) h.docs.get(key).summary.costCents++;
    if (tamper) await assert.rejects(h.repo.commit(command), code('invalid'));
    else { await h.repo.commit(command); assert.equal((await h.repo.get(id(101)))?.data.totalCents, 20000); }
  }
});
test('20-row maximum allocation and zero-cost rows preserve complete immutable forests without leaking private preparations', async () => {
  for (const zero of [false, true]) {
    const h = harness(), items = Array.from({ length: 20 }, (_, index) => item({ itemId: id(600 + index), name: `خامة ${index}`,
      quantityMilli: 1000, unitPriceCents: zero ? 0 : 100, totalCents: zero ? 0 : 100 }));
    await h.commit(create(1, { items, subtotalCents: zero ? 0 : 2000, taxCents: zero ? 0 : 1, totalCents: zero ? 0 : 2001 }));
    const materials = (await h.repo.listMaterialsPage()).records;
    assert.equal(materials.length, 20); assert.equal(materials.reduce((sum, row) => sum + row.purchaseCostCents, 0), zero ? 0 : 2001);
    assert.equal([...h.docs.keys()].filter(key => key.includes('/expenseInventoryProofs/')).length, 224);
    assert.ok(materials.every(row => !('pending' in row) && !('base' in row)));
  }
});
test('new exact v2 material identity is explicit; legacy hash parsing is retained but never silently merged', async () => {
  const h = harness(); assert.notEqual(await cloudMaterialId('X', 'علبة', { digest }), await cloudMaterialIdV2('X', 'علبة', { digest }));
  await h.commit(create(1, { items: [item({ name: 'X' })] }));
  await h.commit(create(2, { items: [item({ name: 'x' })] }, 0, id(102)));
  assert.equal((await h.repo.listMaterialsPage()).records.length, 2);
});
test('legacy immutable receipt acknowledgement remains readonly before any newer head or proof lookup', async () => {
  const h = harness(), command = create(); await h.commit(command);
  const receipt = h.docs.get(path('expenseOperations', id(1))); delete receipt.inventoryVersion; delete receipt.usageMath;
  h.calls.length = 0; const writes = h.writes(); assert.equal((await h.repo.commit(command)).status, 'already-committed');
  assert.equal(h.writes(), writes); assert.equal(h.calls.filter(call => call.startsWith('get:')).length, 2);
});
