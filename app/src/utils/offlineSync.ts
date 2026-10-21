export interface PendingMutation {
  id: string;
  type: 'SAVE_PATIENT' | 'DELETE_PATIENT' | 'SAVE_APPOINTMENT' | 'SAVE_EXPENSE' | 'SAVE_LAB_CASE';
  payload: any;
  timestamp: number;
  retries: number;
  status: 'pending' | 'syncing' | 'failed' | 'conflict';
  errorNote?: string;
}

const MUTATION_QUEUE_KEY = 'dental_clinic_pending_mutations';

const LAST_SYNC_KEY = 'dental_clinic_last_sync_time';
const STATUS_CHANGED_EVENT = 'dental-clinic-offline-status-changed';

function notifyStatusChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(STATUS_CHANGED_EVENT));
}

/** React consumers subscribe to actual changes, not recurring storage polling. */
export function subscribeOfflineSyncStatus(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.storageArea && event.storageArea !== localStorage) return;
    if (event.key === null || event.key === MUTATION_QUEUE_KEY || event.key === LAST_SYNC_KEY) listener();
  };
  window.addEventListener(STATUS_CHANGED_EVENT, listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(STATUS_CHANGED_EVENT, listener);
    window.removeEventListener('storage', onStorage);
  };
}

export const OfflineSyncEngine = {
  getQueue(): PendingMutation[] {
    try {
      const raw = localStorage.getItem(MUTATION_QUEUE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  },

  saveQueue(queue: PendingMutation[]): void {
    try {
      localStorage.setItem(MUTATION_QUEUE_KEY, JSON.stringify(queue));
      notifyStatusChanged();
    } catch (e) {
      console.error('Failed to save offline mutation queue:', e);
    }
  },

  getLastSyncTime(): number {
    try {
      const val = localStorage.getItem(LAST_SYNC_KEY);
      return val ? parseInt(val, 10) || 0 : 0;
    } catch {
      return 0;
    }
  },

  saveLastSyncTime(timestamp: number = Date.now()): void {
    try {
      localStorage.setItem(LAST_SYNC_KEY, timestamp.toString());
      notifyStatusChanged();
    } catch (e) {
      console.error('Failed to save last sync time:', e);
    }
  },

  enqueueMutation(type: PendingMutation['type'], payload: any): PendingMutation {
    const queue = this.getQueue();
    const newMutation: PendingMutation = {
      id: 'mut_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      type,
      payload,
      timestamp: Date.now(),
      retries: 0,
      status: 'pending',
    };
    queue.push(newMutation);
    this.saveQueue(queue);
    return newMutation;
  },

  removeMutation(id: string): void {
    const queue = this.getQueue().filter(m => m.id !== id);
    this.saveQueue(queue);
  },

  clearQueue(): void {
    localStorage.removeItem(MUTATION_QUEUE_KEY);
    notifyStatusChanged();
  },

  // Process offline mutations queue
  async processQueue(onProgress?: (syncedCount: number, remaining: number) => void): Promise<{
    synced: number;
    failed: number;
    conflicts: number;
  }> {
    // No authenticated cloud mutation transport has been configured yet.
    // Preserve queued changes until a real upload acknowledges them.
    return { synced: 0, failed: 0, conflicts: 0 };
  },
};

