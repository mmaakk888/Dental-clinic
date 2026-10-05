import test from 'node:test';
import assert from 'node:assert/strict';
import { OfflineSyncEngine } from './offlineSync';

test('unconfigured cloud sync preserves pending mutations and never reports a successful upload', async () => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) }, configurable: true });
  const mutation = OfflineSyncEngine.enqueueMutation('SAVE_PATIENT', { id: 'test' });
  const before = OfflineSyncEngine.getQueue();
  const result = await OfflineSyncEngine.processQueue();
  assert.equal(result.synced, 0);
  assert.deepEqual(OfflineSyncEngine.getQueue(), before);
  assert.equal(OfflineSyncEngine.getQueue()[0].id, mutation.id);
  assert.equal(OfflineSyncEngine.getLastSyncTime(), 0);
});
