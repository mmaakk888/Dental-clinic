import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createCloudExpenseWorkspaceController, buildCloudExpenseCreate, parseCloudExpenseMoney, parseCloudExpenseQuantity,
  type CloudExpenseWorkspaceDraft } from './cloudExpenseWorkspaceController';
import { createCloudExpenseRepository, type CloudExpenseAdapter } from './cloudExpenseRepository';
import { createCloudOperationIntentRepository } from './cloudOperationIntent';

const OWNER = 'synthetic-expense-workspace-owner', WHEN = '2026-10-12T00:00:00.000Z', DAY = '2026-10-12';
const id = (n: number) => `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const path = (collection: string, key: string) => `clinics/main/${collection}/${key}`;
const digest = async (value: string) => createHash('sha256').update(value).digest('hex');
const digestBytes = async (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
function deferred() { let resolve!: () => void; const promise = new Promise<void>(accept => { resolve = accept; }); return { promise, resolve }; }
function jpeg() { const bytes = Uint8Array.from([255,216,255,192,0,17,8,0,160,1,64,3,1,17,0,2,17,0,3,17,0,255,218,0,12,3,1,0,2,0,3,0,0,63,0,1,2,3,255,217]);
  return { base64: Buffer.from(bytes).toString('base64'), image: { sha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length, width: 320, height: 160, contentType: 'image/jpeg' as const } }; }
/** Real pure repository/journal over fabricated atomic documents. No live
 * accounts, browser storage, Firebase, external AI or native image work. */
function harness() {
  const docs = new Map<string, any>(), calls: string[] = [], commands: any[] = []; let active = true, next = 1, ids = 0, times = 0;
  const hooks: { read?: (key: string) => void; accepted?: () => void; capability?: () => Promise<void> } = {};
  const faults = { lostPrepare: false, lostCommit: false, beforeCommit: false, failRead: false, wrongAck: false };
  const adapter: CloudExpenseAdapter = {
    authorizeOwner: async () => OWNER,
    readRecord: async key => { calls.push(`read:${key}`); hooks.read?.(key); if (faults.failRead) { faults.failRead = false; throw new Error('PRIVATE_READ'); } return structuredClone(docs.get(key) ?? null); },
    listPage: async (collection, owner, after, limit) => [...docs].filter(([key, value]) => key.startsWith(path(collection, ''))
      && (owner === null || value[collection === 'materialUsages' ? 'materialId' : 'expenseId'] === owner) && (!after || value.recordId > after))
      .sort(([a], [b]) => a.localeCompare(b)).slice(0, limit).map(([, data]) => ({ id: data.recordId, data: structuredClone(data) })),
    runTransaction: async work => { const staged = structuredClone(docs); let write = false;
      const result = await work({ get: async key => { assert.equal(write, false, 'all reads before writes'); return structuredClone(staged.get(key) ?? null); },
        set: (key, value) => { write = true; staged.set(key, structuredClone(value)); } }); docs.clear(); staged.forEach((value, key) => docs.set(key, value)); return result; },
  };
  const core = createCloudExpenseRepository(adapter, { digest, digestBytes });
  const journalCore = createCloudOperationIntentRepository({ ...adapter, listHistoryPage: async (kind, owner, after, limit) => [...docs]
    .filter(([key, value]) => key.startsWith(path('operationIntents', '')) && value.kind === kind && value.actorUid === owner && (!after || value.operationId > after))
    .sort(([a], [b]) => a.localeCompare(b)).slice(0, limit).map(([, data]) => ({ id: data.operationId, data: structuredClone(data) })),
  }, { digest });
  const journal = { ...journalCore, prepare: async (...args: Parameters<typeof journalCore.prepare>) => { calls.push('prepare'); const result = await journalCore.prepare(...args);
    if (faults.lostPrepare) { faults.lostPrepare = false; throw new Error('PRIVATE_PREPARE_ACK'); } return result; } };
  const capability = { journal, repository: { ...core, commit: async (command: unknown, image?: string) => { calls.push('commit'); commands.push(structuredClone(command));
    if (faults.beforeCommit) throw new Error('PRIVATE_COMMIT'); const result = await core.commit(command, image); hooks.accepted?.();
    if (faults.lostCommit) { faults.lostCommit = false; throw new Error('PRIVATE_COMMIT_ACK'); } return faults.wrongAck ? { ...result, revision: result.revision + 1 } : result; } } };
  const options = { ownerUid: OWNER, isActive: () => active, getCapability: async () => { calls.push('capability'); await hooks.capability?.(); return capability; },
    newId: () => { ids++; return id(next++); }, now: () => { times++; return WHEN; }, digestBytes };
  return { docs, calls, commands, hooks, faults, core, journal, capability, options, controller: createCloudExpenseWorkspaceController(options),
    fresh: () => createCloudExpenseWorkspaceController(options), active: (value: boolean) => { active = value; }, ids: () => ids, times: () => times };
}
async function draft(h: ReturnType<typeof harness>, paid = '25') {
  assert.equal(await h.controller.beginCreate(), true); const source = h.controller.getState().draft!;
  assert.equal(source.action, 'create'); if (source.action !== 'create') throw new Error();
  h.controller.updateDraft({ ...source, header: { ...source.header, title: 'فاتورة مصطنعة', category: 'supplies', expenseType: 'supplies', supplierName: 'مورد مصطنع' },
    subtotal: '100', paid, items: [{ key: 1, name: 'قفازات مصطنعة', unit: 'علبة', quantity: '2', unitPrice: '50', discount: '0', tax: '0' }] }, source);
  return h.controller.getState().draft!;
}
async function saved(h: ReturnType<typeof harness>, paid = '25') { const value = await draft(h, paid); assert.equal(await h.controller.save(value), true); }

test('expense controller construction is inert and blank cash never becomes a default payment', async () => {
  const h = harness(); assert.deepEqual(h.calls, []); assert.equal(h.ids(), 0); assert.equal(h.times(), 0);
  const value = await draft(h, ''); assert.equal(await h.controller.save(value), false); assert.equal(h.ids(), 0); assert.equal(h.docs.size, 0);
});
test('manual reviewed invoice atomically creates purchases plus actual partial payment and complete fenced history', async () => {
  const h = harness(); await saved(h); const state = h.controller.getState(), selection = state.snapshot!.selection!;
  assert.equal(selection.kind, 'expense'); if (selection.kind !== 'expense') throw new Error();
  assert.equal(selection.record.data.totalCents, 10_000); assert.equal(selection.record.paidCents, 2500); assert.equal(selection.payments.length, 1);
  assert.equal(state.snapshot!.materials[0].purchasedMilli, 2000); assert.equal(h.ids(), 2); assert.equal(h.docs.get(path('operationIntents', id(2))).status, 'committed');
  assert.equal(state.pendingOperationId, null); assert.equal(h.controller.canClose(), true);
});
test('fixed electricity/rent/salary expenses work without inventory or assumed cash', async () => {
  for (const expenseType of ['electricity', 'rent', 'salary'] as const) {
    const h = harness(); await h.controller.beginCreate(); const source = h.controller.getState().draft!; if (source.action !== 'create') throw new Error();
    h.controller.updateDraft({ ...source, header: { ...source.header, title: expenseType, category: 'fixed', expenseType, isFixed: true, recurringPeriod: 'monthly' }, subtotal: '500', paid: '0' }, source);
    assert.equal(await h.controller.save(h.controller.getState().draft!), true); const selection = h.controller.getState().snapshot!.selection!; if (selection.kind !== 'expense') throw new Error();
    assert.equal(selection.record.paidCents, 0); assert.equal(selection.payments.length, 0); assert.deepEqual(h.controller.getState().snapshot!.materials, []);
  }
});
test('invalid quantities/prices/overpayment validation never consumes another operation ID', async () => {
  for (const patch of [{ paid: '999' }, { paid: '1.001' }, { tax: '' }]) { const h = harness(), value = await draft(h); h.controller.updateDraft({ ...value, ...patch }, value);
    assert.equal(await h.controller.save(h.controller.getState().draft!), false); assert.equal(h.ids(), 0); }
  const h = harness(), value = await draft(h); if (value.action !== 'create') throw new Error();
  h.controller.updateDraft({ ...value, items: [{ ...value.items[0], quantity: '0' }] }, value); assert.equal(await h.controller.save(h.controller.getState().draft!), false); assert.equal(h.ids(), 0);
});
test('later actual supplier cash never duplicates stock and metadata edit never changes money', async () => {
  const h = harness(); await saved(h); const material = structuredClone(h.controller.getState().snapshot!.materials[0]);
  const expected = h.controller.getState().snapshot!.selection!; assert.equal(h.controller.beginPayment(expected), true);
  let source = h.controller.getState().draft!; h.controller.updateDraft({ ...source, amount: '30' }, source); assert.equal(await h.controller.save(h.controller.getState().draft!), true);
  assert.deepEqual(h.controller.getState().snapshot!.materials[0], material); let selected = h.controller.getState().snapshot!.selection!; if (selected.kind !== 'expense') throw new Error();
  assert.equal(selected.record.paidCents, 5500); assert.equal(selected.payments.length, 2);
  assert.equal(h.controller.beginEdit(selected), true); source = h.controller.getState().draft!; if (source.action !== 'edit') throw new Error();
  h.controller.updateDraft({ ...source, data: { ...source.data, title: 'عنوان معدل' } }, source); assert.equal(await h.controller.save(h.controller.getState().draft!), true);
  selected = h.controller.getState().snapshot!.selection!; if (selected.kind !== 'expense') throw new Error(); assert.equal(selected.record.paidCents, 5500); assert.equal(selected.record.data.totalCents, 10_000);
});
test('material use/waste keeps exact bounded quantity/cost and complete usage history', async () => {
  const h = harness(); await saved(h); const material = h.controller.getState().snapshot!.materials[0]; assert.equal(await h.controller.openMaterial(material.recordId), true);
  assert.equal(h.controller.beginUsage(h.controller.getState().snapshot!.selection!), true); let source = h.controller.getState().draft!;
  h.controller.updateDraft({ ...source, quantity: '0.5' }, source); assert.equal(await h.controller.save(h.controller.getState().draft!), true);
  let selection = h.controller.getState().snapshot!.selection!; if (selection.kind !== 'material') throw new Error();
  assert.equal(selection.record.usedMilli, 500); assert.equal(selection.record.consumedCostCents, 2500); assert.equal(selection.usages.length, 1);
  h.controller.beginUsage(selection); source = h.controller.getState().draft!; h.controller.updateDraft({ ...source, quantity: '1.5', kind: 'waste' }, source);
  assert.equal(await h.controller.save(h.controller.getState().draft!), true); selection = h.controller.getState().snapshot!.selection!; if (selection.kind !== 'material') throw new Error();
  assert.equal(selection.record.wasteMilli, 1500); assert.equal(selection.record.consumedCostCents, 10_000); assert.equal(selection.usages.length, 2);
});
test('lost prepare and commit ACK retain original operation/price/payment/items, never another stock purchase', async () => {
  for (const fault of ['lostPrepare', 'lostCommit'] as const) {
    const h = harness(), value = await draft(h); h.faults[fault] = true; assert.equal(await h.controller.save(value), false);
    const original = h.controller.getState(), ids = h.ids(), times = h.times(); assert.equal(original.saveStatus, 'retry-required'); assert.equal(h.controller.canClose(), false);
    assert.equal(h.controller.cancelDraft(value), false); assert.equal(await h.controller.beginCreate(), false); assert.equal(await h.controller.loadMaterials(), false);
    assert.equal(await h.controller.retry(), true); assert.equal(h.ids(), ids); assert.equal(h.times(), times);
    assert.equal(h.controller.getState().snapshot!.materials[0].purchasedMilli, 2000); assert.equal(h.controller.getState().snapshot!.expenses.length, 1);
  }
});
test('acknowledged read failure retries reads only and wrong acknowledgement remains original pending operation', async () => {
  const h = harness(), value = await draft(h); h.hooks.accepted = () => { h.faults.failRead = true; h.hooks.accepted = undefined; };
  assert.equal(await h.controller.save(value), false); assert.equal(h.controller.getState().saveStatus, 'refresh-required');
  const commits = h.calls.filter(value => value === 'commit').length; assert.equal(await h.controller.retry(), true); assert.equal(h.calls.filter(value => value === 'commit').length, commits);
  const other = harness(), source = await draft(other); other.faults.wrongAck = true; assert.equal(await other.controller.save(source), false);
  assert.equal(other.controller.getState().saveStatus, 'retry-required'); other.faults.wrongAck = false; assert.equal(await other.controller.retry(), true); assert.equal(other.ids(), 2);
});
test('confirmed pending cancellation never discards a committed original receipt', async () => {
  const h = harness(), value = await draft(h); h.faults.beforeCommit = true; await h.controller.save(value); assert.equal(await h.controller.cancelPending(), true);
  assert.equal(h.controller.getState().loaded, false); assert.equal(h.docs.get(path('operationIntents', id(2))).status, 'cancelled'); assert.equal(h.controller.getState().draft, null);
  const accepted = harness(), source = await draft(accepted); accepted.faults.lostCommit = true; await accepted.controller.save(source); assert.equal(await accepted.controller.cancelPending(), false); assert.equal(await accepted.controller.retry(), true);
});
test('full selected payment/usage histories reject missing rows or changed fences instead of partial balances', async () => {
  const h = harness(); await saved(h); const recordId = h.controller.getState().snapshot!.selection!.record.recordId;
  h.docs.delete(path('expensePayments', id(2))); assert.equal(await h.controller.openExpense(recordId), false); assert.equal(h.controller.getState().snapshot, null);
  const other = harness(); await saved(other); let reads = 0; const expenseId = other.controller.getState().snapshot!.selection!.record.recordId;
  other.hooks.read = key => { if (key === path('expenseRecords', expenseId) && ++reads === 2) other.docs.get(key).revision++; };
  assert.equal(await other.controller.openExpense(expenseId), false); assert.equal(other.controller.getState().snapshot, null);
});
test('whole-list pages never claim a global total and stale selected/draft references cannot write elsewhere', async () => {
  const h = harness(); await saved(h); const selection = h.controller.getState().snapshot!.selection!;
  await h.controller.openExpense(selection.record.recordId); assert.equal(h.controller.beginPayment(selection), false);
  assert.equal(h.controller.beginPayment(h.controller.getState().snapshot!.selection!), true); const old = h.controller.getState().draft!; h.controller.cancelDraft(old); h.controller.beginPayment(h.controller.getState().snapshot!.selection!);
  assert.equal(h.controller.updateDraft({ ...old, amount: '20' }, old), false); assert.equal(await h.controller.save(old), false);
  assert.ok(!Object.keys(h.controller.getState().snapshot!).some(key => /total|paid/i.test(key)));
});
test('all-status recovery survives disposal, uses original historical command, and never creates another receipt or stock row', async () => {
  const h = harness(), value = await draft(h); h.faults.lostCommit = true; await h.controller.save(value); h.controller.dispose();
  const fresh = h.fresh(); assert.equal(await fresh.loadHistory(), true); assert.equal(fresh.getState().history[0].status, 'committed');
  const ids = h.ids(), times = h.times(); assert.equal(await fresh.resume(id(2)), true); assert.equal(h.ids(), ids); assert.equal(h.times(), times);
  assert.equal(fresh.getState().snapshot!.materials[0].purchasedMilli, 2000); assert.equal(fresh.getState().snapshot!.expenses.length, 1);
});
test('usage recovery retains exact original quantity/date and can replay committed history after reload', async () => {
  const h = harness(); await saved(h); await h.controller.openMaterial(h.controller.getState().snapshot!.materials[0].recordId); h.controller.beginUsage(h.controller.getState().snapshot!.selection!);
  const source = h.controller.getState().draft!; h.controller.updateDraft({ ...source, quantity: '0.5' }, source); assert.equal(await h.controller.save(h.controller.getState().draft!), true);
  h.controller.dispose(); const fresh = h.fresh(); assert.equal(await fresh.resume(id(3)), true); const selected = fresh.getState().snapshot!.selection!; assert.equal(selected.kind, 'material');
  if (selected.kind !== 'material') throw new Error(); assert.equal(selected.record.usedMilli, 500); assert.equal(selected.usages.length, 1);
});
test('image preparation reserves navigation before awaits; image bytes stay out of durable journal', async () => {
  const h = harness(); await saved(h); const wait = deferred(), source = h.controller.getState().snapshot!.selection!;
  const preparing = h.controller.prepareImage(async () => { await wait.promise; return jpeg(); }, source);
  assert.equal(h.controller.getState().imageLoading, true); assert.equal(h.controller.canClose(), false); assert.equal(await h.controller.loadExpenses(), false);
  wait.resolve(); assert.equal(await preparing, true); const expected = h.controller.getState().draft!; assert.equal(h.controller.getState().imageBytesReady, true);
  assert.deepEqual(h.controller.getPreparedImage(expected), { base64: jpeg().base64, contentType: 'image/jpeg' }); assert.equal(await h.controller.save(expected), true);
  const intent = h.docs.get(path('operationIntents', id(3))); assert.equal(intent.command.action, 'attach-image'); assert.doesNotMatch(JSON.stringify(intent), /base64|\/9j/);
  assert.equal(h.docs.get(path('invoiceImages', id(3))).base64, jpeg().base64); assert.equal(h.controller.getState().imageBytesReady, false);
});
test('on-demand image read verifies current expense pointer/metadata/hash; no image read on ordinary list/open', async () => {
  const h = harness(); await saved(h); await h.controller.beginImage(jpeg(), h.controller.getState().snapshot!.selection!); await h.controller.save(h.controller.getState().draft!);
  const imageReads = () => h.calls.filter(call => call.startsWith('read:') && call.includes('/invoiceImages/')).length;
  assert.equal(imageReads(), 0); assert.equal(await h.controller.loadImage(h.controller.getState().snapshot!.selection!), true); assert.ok(h.controller.getState().image);
  h.controller.hideImage(); assert.equal(h.controller.getState().image, null); h.docs.get(path('invoiceImages', id(3))).sha256 = 'a'.repeat(64);
  assert.equal(await h.controller.loadImage(h.controller.getState().snapshot!.selection!), false); assert.equal(h.controller.getState().image, null);
});
test('prepared image recovery after reload requires exact matching compressed bytes; committed replay needs none', async () => {
  const h = harness(); await saved(h); await h.controller.beginImage(jpeg(), h.controller.getState().snapshot!.selection!); h.faults.beforeCommit = true;
  await h.controller.save(h.controller.getState().draft!); h.controller.dispose(); h.faults.beforeCommit = false;
  const fresh = h.fresh(); assert.equal(await fresh.resume(id(3)), false); assert.equal(fresh.getState().requiresImageBytes, true);
  assert.equal(await fresh.provideRecoveryImage(jpeg().base64.slice(0, -4) + 'AAAA', id(3)), false); assert.equal(fresh.getState().requiresImageBytes, true);
  assert.equal(await fresh.provideRecoveryImage(jpeg().base64, id(3)), true); assert.equal(await fresh.retry(), true); assert.equal(fresh.getState().requiresImageBytes, false);
  fresh.dispose(); const committed = h.fresh(); assert.equal(await committed.resume(id(3)), true); assert.equal(committed.getState().imageBytesReady, false);
  assert.equal(h.ids(), 3);
});
test('wrong image hash or stale selection fails without image writes, IDs, or raw-image fallback', async () => {
  const h = harness(); await saved(h); const expected = h.controller.getState().snapshot!.selection!, invalid = jpeg(); invalid.image.sha256 = 'a'.repeat(64);
  assert.equal(await h.controller.beginImage(invalid, expected), false); assert.equal(h.ids(), 2); assert.equal(h.controller.getState().imageBytesReady, false);
  assert.equal(await h.controller.save(h.controller.getState().draft!), false); assert.equal(h.ids(), 2); h.controller.cancelDraft(h.controller.getState().draft!);
  await h.controller.openExpense(expected.record.recordId); assert.equal(await h.controller.beginImage(jpeg(), expected), false);
});
test('actual lifetime loss rejects late data/image work, clears bytes and cannot revive old capability state', async () => {
  const h = harness(); await saved(h); const wait = deferred(); const preparing = h.controller.prepareImage(async () => { await wait.promise; return jpeg(); }, h.controller.getState().snapshot!.selection!);
  h.active(false); assert.equal(h.controller.canClose(), false); assert.equal(h.controller.getState().closed, true); wait.resolve(); assert.equal(await preparing, false);
  assert.equal(h.controller.getState().imageBytesReady, false); assert.equal(h.controller.getState().snapshot, null); h.active(true); assert.equal(await h.controller.beginCreate(), false);
});
test('explicit money/quantity parsers preserve blank unknown and reject fractional piastres', () => {
  assert.equal(parseCloudExpenseMoney(''), null); assert.equal(parseCloudExpenseMoney('٠'), 0); assert.equal(parseCloudExpenseMoney('١٫٢٣'), 123);
  assert.equal(parseCloudExpenseMoney('1.001'), null); assert.equal(parseCloudExpenseQuantity('٠٫١٢٥'), 125); assert.equal(parseCloudExpenseQuantity('1.0001'), null);
});
test('raw create conversion is side-effect free and separates item/overall adjustments and actual cash', async () => {
  const h = harness(), source = await draft(h); if (source.action !== 'create') throw new Error(); const ids = h.ids(), times = h.times();
  const reviewed = buildCloudExpenseCreate({ ...source, tax: '10', discount: '5', paid: '0' }, [id(800)]);
  assert.equal(reviewed.data.totalCents, 10_500); assert.equal(reviewed.paidCents, 0); assert.equal(h.ids(), ids); assert.equal(h.times(), times);
});
test('unitemized correction preserves raw amount, rejects below paid before ID creation and recovers original lost ACK', async () => {
  const h = harness(); await h.controller.beginCreate(); const initial = h.controller.getState().draft!;
  if (initial.action !== 'create') assert.fail();
  h.controller.updateDraft({ ...initial, header: { ...initial.header, title: 'كهرباء', category: 'fixed', expenseType: 'electricity' }, subtotal: '500', paid: '100' }, initial);
  assert.equal(await h.controller.save(h.controller.getState().draft!), true);
  assert.equal(h.controller.beginEdit(h.controller.getState().snapshot!.selection!), true);
  let value = h.controller.getState().draft!; if (value.action !== 'edit') assert.fail(); assert.equal(value.amount, '500');
  h.controller.updateDraft({ ...value, amount: '99' }, value); const ids = h.ids();
  assert.equal(await h.controller.save(h.controller.getState().draft!), false); assert.equal(h.ids(), ids);
  value = h.controller.getState().draft!; h.controller.updateDraft({ ...value, amount: '400.25' }, value); h.faults.lostCommit = true;
  assert.equal(await h.controller.save(h.controller.getState().draft!), false); assert.equal(h.controller.getState().pendingOperationId, id(2));
  h.controller.dispose(); const fresh = h.fresh(); assert.equal(await fresh.resume(id(2)), true);
  const selection = fresh.getState().snapshot!.selection!; if (selection.kind !== 'expense') assert.fail();
  assert.equal(selection.record.data.totalCents, 40025); assert.equal(selection.record.paidCents, 10000);
  assert.equal(selection.payments.length, 1); assert.deepEqual(fresh.getState().snapshot!.materials, []);
});
test('itemized edit exposes no amount correction and injected amount cannot alter purchases or consume an ID', async () => {
  const h = harness(); await saved(h); h.controller.beginEdit(h.controller.getState().snapshot!.selection!);
  const value = h.controller.getState().draft!; if (value.action !== 'edit') assert.fail(); assert.equal('amount' in value, false);
  h.controller.updateDraft({ ...value, amount: '30' }, value); const ids = h.ids();
  assert.equal(await h.controller.save(h.controller.getState().draft!), false); assert.equal(h.ids(), ids);
  assert.equal(h.controller.getState().snapshot!.materials[0].purchaseCostCents, 10000);
});
