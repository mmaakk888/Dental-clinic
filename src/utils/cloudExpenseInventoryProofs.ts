import type { CloudExpenseData } from './cloudExpenseRepository';

/** Private, immutable nonfinancial preparations. A purchase is authoritative
 * only after its matching expense receipt AND intent are committed. */
export const CLOUD_EXPENSE_PROOF_BRANCH = 2;
export const CLOUD_EXPENSE_PROOF_BASE = 1_000_000;
export interface CloudExpenseRatioProof { quotient: number; remainder: number; right: number; denominator: number; product: number[]; productCarry: number[]; quotientCarry: number[];
  operands: { a: number[]; b: number[]; q: number[]; d: number[]; r: number[] } }
export interface CloudExpenseProofSummary {
  count: number; indexes: number[]; itemIds: string[]; firstRank: number; lastRank: number;
  firstRemainder: number; lastRemainder: number; firstItemId: string; lastItemId: string;
  firstBonus: boolean; lastBonus: boolean; subtotalCents: number; costCents: number;
}
export interface CloudExpenseInventoryProof {
  schemaVersion: 2; clinicId: 'main'; operationId: string; actorUid: string; requestHash: string;
  intentRequestHash: string; createdAt: string; level: number; index: number;
  summary: CloudExpenseProofSummary;
  leaf: null | { rowIndex: number; rank: number; materialId: string; bonus: boolean;
    itemBase: CloudExpenseRatioProof; allocation: CloudExpenseRatioProof };
}
const MAX = 1_000_000_000_000;
const safe = (value: number) => Number.isSafeInteger(value) && value >= 0 && value <= MAX;
function fail(): never { throw new Error('Invalid expense preparation.'); }
export function expenseProductDigits(a: number, b: number): number[] {
  if (!safe(a) || !safe(b)) fail();
  let product = BigInt(a) * BigInt(b); const digits: number[] = [];
  for (let index = 0; index < 5; index++) { digits.push(Number(product % 1_000_000n)); product /= 1_000_000n; }
  if (product) fail(); return digits;
}
export function expenseRatioProof(a: number, b: number, denominator: number): CloudExpenseRatioProof {
  if (!safe(a) || !safe(b) || !safe(denominator) || !denominator) fail();
  const product = BigInt(a) * BigInt(b), divisor = BigInt(denominator);
  const quotient = Number(product / divisor), remainder = Number(product % divisor);
  if (!safe(quotient) || !safe(remainder)) fail();
  return { quotient, remainder, right: b, denominator, product: expenseProductDigits(a, b), productCarry: expenseProductCarry(a, b), quotientCarry: expenseProductCarry(quotient, denominator, remainder),
    operands: { a: expenseOperandDigits(a), b: expenseOperandDigits(b), q: expenseOperandDigits(quotient),
      d: expenseOperandDigits(denominator), r: expenseOperandDigits(remainder) } };
}
function expenseOperandDigits(value: number): number[] {
  let n = BigInt(value); const base = 1_000_000n;
  return [Number(n % base), Number(n / base % base), Number(n / (base * base))];
}
function expenseProductCarry(a: number, b: number, r = 0): number[] {
  const base = 1_000_000n, split = (value: number) => { let n = BigInt(value); return [n % base, n / base % base, n / (base * base)]; };
  const x = split(a), y = split(b), z = split(r), carry: number[] = []; let previous = 0n;
  for (let n = 0; n < 4; n++) { let coefficient = previous + (z[n] ?? 0n);
    for (let k = 0; k < 3; k++) if (n - k >= 0 && n - k < 3) coefficient += x[k] * y[n - k];
    previous = coefficient / base; carry.push(Number(previous)); }
  return carry;
}
/** Rules use exactly these base-1e6 chunks; no intermediate exceeds 3e12,
 * unlike multiplying two allowed 1e12 inputs directly in signed int64. */
export function verifyExpenseRatioProof(value: CloudExpenseRatioProof, a: number, b: number, denominator: number): boolean {
  try {
    if (!value || Object.keys(value).sort().join(',') !== 'denominator,operands,product,productCarry,quotient,quotientCarry,remainder,right'
      || value.right !== b || value.denominator !== denominator
      || !safe(value.quotient) || !safe(value.remainder) || value.remainder >= denominator
      || !Array.isArray(value.product) || value.product.length !== 5
      || value.product.some(digit => !Number.isInteger(digit) || digit < 0 || digit >= CLOUD_EXPENSE_PROOF_BASE)) return false;
    const expected = expenseRatioProof(a, b, denominator);
    if (!value.operands || Object.keys(value.operands).sort().join(',') !== 'a,b,d,q,r'
      || (['a', 'b', 'q', 'd', 'r'] as const).some(key => !Array.isArray(value.operands[key])
        || value.operands[key].length !== 3 || value.operands[key].some((digit, index) => digit !== expected.operands[key][index]))) return false;
    return value.quotient === expected.quotient && value.remainder === expected.remainder
      && value.product.every((digit, index) => digit === expected.product[index])
      && [value.productCarry, value.quotientCarry].every((carry, index) => Array.isArray(carry) && carry.length === 4
        && carry.every((digit, n) => digit === [expected.productCarry, expected.quotientCarry][index][n]));
  } catch { return false; }
}
/** Version 2 deliberately hashes the exact displayed material name and unit,
 * separated by a forbidden-in-input NUL. No locale/NFKC/JSON implementation is
 * assumed in Rules, and existing v1 identities are never silently remapped. */
export const cloudMaterialIdentityV2 = (name: string, unit: string) => `clinic-material-v2\u0000${name}\u0000${unit}`;
export const cloudSupplierInvoiceIdentityV2 = (supplier: string, invoice: string) => `clinic-supplier-invoice-v2\u0000${supplier}\u0000${invoice}`;
export function expenseAllocatedCosts(data: CloudExpenseData) {
  if (!data.items.length) return [];
  if (!data.subtotalCents) return data.items.map(() => ({ costCents: 0, remainder: 0, rank: 0, bonus: false,
    allocation: expenseRatioProof(0, 0, 1) }));
  const values = data.items.map((row, rowIndex) => ({ rowIndex, itemId: row.itemId,
    allocation: expenseRatioProof(row.totalCents, data.totalCents, data.subtotalCents) }));
  const remaining = data.totalCents - values.reduce((sum, value) => sum + value.allocation.quotient, 0);
  const ranked = [...values].sort((a, b) => b.allocation.remainder - a.allocation.remainder || (a.itemId < b.itemId ? -1 : 1));
  const ranks = new Map(ranked.map((value, rank) => [value.rowIndex, rank]));
  return values.map(value => ({ costCents: value.allocation.quotient + (ranks.get(value.rowIndex)! < remaining ? 1 : 0),
    remainder: value.allocation.remainder, rank: ranks.get(value.rowIndex)!, bonus: ranks.get(value.rowIndex)! < remaining, allocation: value.allocation }));
}
export function expenseProofId(operationId: string, level: number, index: number) { return `${operationId}-${level}-${index}`; }
export function expenseProofRootLocations(count: number): { level: number; index: number }[] {
  if (!Number.isInteger(count) || count < 0 || count > 20) fail();
  let level = 0, size = count;
  while (size > 1) { size = Math.ceil(size / CLOUD_EXPENSE_PROOF_BRANCH); level++; }
  return Array.from({ length: size }, (_, index) => ({ level, index }));
}
export function joinExpenseProofSummaries(children: CloudExpenseProofSummary[]): CloudExpenseProofSummary {
  if (!children.length || children.length > 4) fail();
  for (let i = 1; i < children.length; i++) {
    const a = children[i - 1], b = children[i];
    if (a.lastRank + 1 !== b.firstRank || a.lastRemainder < b.firstRemainder
      || a.lastRemainder === b.firstRemainder && a.lastItemId >= b.firstItemId
      || !a.lastBonus && b.firstBonus) fail();
  }
  const first = children[0], last = children.at(-1)!;
  const indexes = children.flatMap(value => value.indexes), itemIds = children.flatMap(value => value.itemIds);
  if (new Set(indexes).size !== indexes.length || new Set(itemIds).size !== itemIds.length) fail();
  const subtotalCents = children.reduce((sum, child) => sum + child.subtotalCents, 0), costCents = children.reduce((sum, child) => sum + child.costCents, 0);
  if (!safe(subtotalCents) || !safe(costCents)) fail();
  return { count: indexes.length, indexes, itemIds, firstRank: first.firstRank, lastRank: last.lastRank,
    firstRemainder: first.firstRemainder, lastRemainder: last.lastRemainder,
    firstItemId: first.firstItemId, lastItemId: last.lastItemId, firstBonus: first.firstBonus, lastBonus: last.lastBonus, subtotalCents, costCents };
}
export async function buildExpenseInventoryProofs(data: CloudExpenseData, envelope: Omit<CloudExpenseInventoryProof, 'level' | 'index' | 'summary' | 'leaf'>,
  digest: (text: string) => Promise<string>): Promise<CloudExpenseInventoryProof[][]> {
  const allocations = expenseAllocatedCosts(data);
  const leaves: CloudExpenseInventoryProof[] = [];
  for (let rowIndex = 0; rowIndex < data.items.length; rowIndex++) {
    const item = data.items[rowIndex], allocation = allocations[rowIndex];
    const rank = data.subtotalCents ? allocation.rank : [...data.items].sort((a, b) => a.itemId < b.itemId ? -1 : 1).findIndex(row => row.itemId === item.itemId);
    leaves.push({ ...envelope, level: 0, index: rank,
      summary: { count: 1, indexes: [rowIndex], itemIds: [item.itemId], firstRank: rank, lastRank: rank,
        firstRemainder: allocation.remainder, lastRemainder: allocation.remainder,
        firstItemId: item.itemId, lastItemId: item.itemId, firstBonus: allocation.bonus, lastBonus: allocation.bonus,
        subtotalCents: item.totalCents, costCents: allocation.costCents },
      leaf: { rowIndex, rank, materialId: await digest(cloudMaterialIdentityV2(item.name, item.unit)), bonus: allocation.bonus,
        itemBase: expenseRatioProof(item.quantityMilli, item.unitPriceCents, 1000), allocation: allocation.allocation } });
  }
  leaves.sort((a, b) => a.index - b.index); const levels = [leaves];
  while (levels.at(-1)!.length > 1) {
    const children = levels.at(-1)!, groups: CloudExpenseInventoryProof[] = [];
    for (let index = 0; index < Math.ceil(children.length / CLOUD_EXPENSE_PROOF_BRANCH); index++) groups.push({ ...envelope, level: levels.length, index,
      summary: joinExpenseProofSummaries(children.slice(index * CLOUD_EXPENSE_PROOF_BRANCH, index * CLOUD_EXPENSE_PROOF_BRANCH + CLOUD_EXPENSE_PROOF_BRANCH).map(child => child.summary)), leaf: null });
    levels.push(groups);
  }
  return levels;
}
