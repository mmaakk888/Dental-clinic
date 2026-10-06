import test from 'node:test';
import assert from 'node:assert/strict';
import { withClinicWriteLock, type ClinicLockManager } from './clinicWriteLock';

test('same-origin saves serialize fresh reads and release the lock after failures', async () => {
  let tail = Promise.resolve();
  const names: string[] = [];
  const manager: ClinicLockManager = { request<T>(name: string, callback: () => T | Promise<T>): Promise<T> {
    names.push(name);
    const result = tail.then(callback);
    tail = result.then(() => undefined, () => undefined);
    return result;
  } };
  const records: string[] = [];
  let unblock!: () => void;
  const blocked = new Promise<void>(resolve => { unblock = resolve; });
  const first = withClinicWriteLock(async () => { const fresh = [...records]; await blocked; records.splice(0, records.length, ...fresh, 'receipt-1'); }, manager);
  const second = withClinicWriteLock(() => { const fresh = [...records]; records.splice(0, records.length, ...fresh, 'receipt-2'); }, manager);
  await Promise.resolve(); unblock(); await Promise.all([first, second]);
  assert.deepEqual(records, ['receipt-1', 'receipt-2']);
  assert.equal(new Set(names).size, 1);
  await assert.rejects(withClinicWriteLock(() => { throw new Error('quota'); }, manager), /quota/);
  await withClinicWriteLock(() => { records.push('receipt-3'); }, manager);
  assert.equal(records.length, 3);
});

test('unsupported locks fail closed without calling the mutation', async () => {
  let invoked = false;
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  try {
    await assert.rejects(withClinicWriteLock(() => { invoked = true; }), /لم يتم حفظ أي تغيير/);
    assert.equal(invoked, false);
  } finally { if (previous) Object.defineProperty(globalThis, 'navigator', previous); else Reflect.deleteProperty(globalThis, 'navigator'); }
});
