import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { expenseProductDigits, expenseRatioProof, verifyExpenseRatioProof, expenseAllocatedCosts,
  buildExpenseInventoryProofs, expenseProofRootLocations, cloudMaterialIdentityV2 } from './cloudExpenseInventoryProofs';
import { prepareCloudExpenseCommand, type CloudExpenseData } from './cloudExpenseRepository';

// Nonfinancial proof primitives only. The v2 stock transition/Rules are not yet
// implemented; these tests never claim a successful inventory transaction.
const id = (n: number) => `70000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const digest = async (value: string) => createHash('sha256').update(value).digest('hex');
function data(count: number): CloudExpenseData {
  const command = prepareCloudExpenseCommand({ action: 'create', operationId: id(1), recordId: id(2), expectedRevision: 0,
    createdAt: '2026-10-13T00:00:00.000Z', paidCents: 0, data: { title: 'خامات مصطنعة', category: 'supplies', expenseType: 'supplies',
      date: '2026-10-13', note: '', isFixed: false, recurringPeriod: 'none', supplierName: '', supplierPhone: '', supplierAddress: '',
      invoiceNumber: '', invoiceDate: '2026-10-13', invoiceTime: '', taxNumber: '', commercialRecord: '', currency: 'EGP',
      subtotalCents: count * 100, taxCents: 1, discountCents: 0, totalCents: count * 100 + 1,
      items: Array.from({ length: count }, (_, n) => ({ itemId: id(100 + n), name: `خامة ${n}`, unit: 'علبة', quantityMilli: 1000,
        unitPriceCents: 100, discountCents: 0, taxCents: 0, totalCents: 100 })) } });
  assert.equal(command.action, 'create'); return command.data as CloudExpenseData;
}
test('five base-1e6 chunks preserve maximum1e24 product without Number precision loss', () => {
  const digits = expenseProductDigits(1_000_000_000_000, 1_000_000_000_000);
  const decoded = digits.reduceRight((value, digit) => value * 1_000_000n + BigInt(digit), 0n);
  assert.equal(decoded, 1_000_000_000_000n ** 2n);
  const proof = expenseRatioProof(1_000_000_000_000, 1_000_000_000_000, 1_000_000_000_000);
  assert.equal(proof.quotient, 1_000_000_000_000); assert.equal(proof.remainder, 0);
  assert.equal(verifyExpenseRatioProof({ product: proof.product, remainder: 0, quotient: proof.quotient }, 1e12, 1e12, 1e12), true);
});
test('ratio evidence rejects altered quotient/remainder/chunk, zero divisor and unsafe numbers', () => {
  const proof = expenseRatioProof(101, 3, 2);
  assert.equal(proof.quotient, 151); assert.equal(proof.remainder, 1);
  for (const bad of [{ ...proof, quotient: 152 }, { ...proof, remainder: 2 }, { ...proof, product: [304, 0, 0, 0, 0] },
    { ...proof, product: [303] }, { ...proof, extra: true }]) assert.equal(verifyExpenseRatioProof(bad, 101, 3, 2), false);
  for (const input of [-1, 1.1, Number.MAX_SAFE_INTEGER, NaN]) assert.throws(() => expenseProductDigits(input, 1));
  assert.throws(() => expenseRatioProof(1, 1, 0));
});
test('largest-remainder allocation conserves every cent with deterministic item UUID ties', () => {
  const original = data(20), rows = expenseAllocatedCosts(original);
  assert.equal(rows.reduce((sum, row) => sum + row.costCents, 0), original.totalCents);
  assert.equal(rows.filter(row => row.bonus).length, 1); assert.equal(rows[0].bonus, true);
  const reversed = { ...original, items: [...original.items].reverse() }, again = expenseAllocatedCosts(reversed);
  assert.equal(again[19].bonus, true); assert.equal(again[0].bonus, false);
});
test('20-row forest remains bounded, preserves all row identities and sums; no business data is produced', async () => {
  for (const count of [1, 2, 4, 5, 16, 20]) {
    const original = data(count), levels = await buildExpenseInventoryProofs(original, { schemaVersion: 2, clinicId: 'main',
      operationId: id(1), actorUid: 'synthetic-owner', requestHash: 'a'.repeat(64), intentRequestHash: 'b'.repeat(64), createdAt: '2026-10-13T00:00:00.000Z' }, digest);
    const roots = expenseProofRootLocations(count).map(({ level, index }) => levels[level][index]);
    assert.ok(roots.length <= 4); assert.equal(roots.reduce((sum, row) => sum + row.summary.count, 0), count);
    assert.equal(roots.reduce((sum, row) => sum + row.summary.costCents, 0), original.totalCents);
    assert.equal(new Set(roots.flatMap(row => row.summary.indexes)).size, count);
    assert.ok(levels.length <= 3); assert.equal('expenseRecord' in levels[0][0], false);
  }
  assert.throws(() => expenseProofRootLocations(21));
});
test('new exact identity is explicitly versioned and does not silently normalize a historical name', () => {
  assert.notEqual(cloudMaterialIdentityV2('X', 'علبة'), cloudMaterialIdentityV2('x', 'علبة'));
  assert.notEqual(cloudMaterialIdentityV2('X', 'علبة'), cloudMaterialIdentityV2('X', 'كرتونة'));
  assert.match(cloudMaterialIdentityV2('X', 'علبة'), /^clinic-material-v2\u0000/);
});
