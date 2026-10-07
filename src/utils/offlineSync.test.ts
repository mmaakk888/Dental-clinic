import test from 'node:test';
import assert from 'node:assert/strict';
import { OfflineSyncEngine, subscribeOfflineSyncStatus } from './offlineSync';

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

test('offline status notifies same-tab and relevant cross-tab changes and unsubscribes without polling', () => {
  const values = new Map<string, string>();
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const windowTarget = new EventTarget();
  const local = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
  Object.defineProperty(globalThis, 'window', { value: windowTarget, configurable: true });
  Object.defineProperty(globalThis, 'localStorage', { value: local, configurable: true });
  let changes = 0;
  const stop = subscribeOfflineSyncStatus(() => changes++);
  try {
    OfflineSyncEngine.enqueueMutation('SAVE_PATIENT', { id: 'synthetic' });
    OfflineSyncEngine.saveLastSyncTime(1);
    OfflineSyncEngine.clearQueue();
    assert.equal(changes, 3);
    const storageEvent = (key: string | null, storageArea = local) => Object.assign(new Event('storage'), { key, storageArea });
    windowTarget.dispatchEvent(storageEvent('unrelated-key'));
    windowTarget.dispatchEvent(storageEvent('dental_clinic_pending_mutations', {} as typeof local));
    assert.equal(changes, 3);
    windowTarget.dispatchEvent(storageEvent('dental_clinic_pending_mutations'));
    windowTarget.dispatchEvent(storageEvent('dental_clinic_last_sync_time'));
    windowTarget.dispatchEvent(storageEvent(null));
    assert.equal(changes, 6);
    stop();
    OfflineSyncEngine.clearQueue();
    windowTarget.dispatchEvent(storageEvent(null));
    assert.equal(changes, 6);
  } finally {
    stop();
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('offline queue ignores corrupt non-array status without fabricating a cloud upload', () => {
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try {
    for (const raw of ['{}', 'null', 'broken']) {
      Object.defineProperty(globalThis, 'localStorage', { value: { getItem: () => raw }, configurable: true });
      assert.deepEqual(OfflineSyncEngine.getQueue(), []);
    }
  } finally {
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
