import { Storage } from './storage';

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

export const OfflineSyncEngine = {
  getQueue(): PendingMutation[] {
    try {
      const raw = localStorage.getItem(MUTATION_QUEUE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  },

  saveQueue(queue: PendingMutation[]): void {
    try {
      localStorage.setItem(MUTATION_QUEUE_KEY, JSON.stringify(queue));
    } catch (e) {
      console.error('Failed to save offline mutation queue:', e);
    }
  },

  getLastSyncTime(): number {
    try {
      const val = localStorage.getItem(LAST_SYNC_KEY);
      return val ? parseInt(val, 10) : Date.now();
    } catch {
      return Date.now();
    }
  },

  saveLastSyncTime(timestamp: number = Date.now()): void {
    try {
      localStorage.setItem(LAST_SYNC_KEY, timestamp.toString());
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
  },

  // Process offline mutations queue
  async processQueue(onProgress?: (syncedCount: number, remaining: number) => void): Promise<{
    synced: number;
    failed: number;
    conflicts: number;
  }> {
    if (!navigator.onLine) {
      return { synced: 0, failed: 0, conflicts: 0 };
    }

    const queue = this.getQueue();
    if (queue.length === 0) {
      this.saveLastSyncTime(Date.now());
      return { synced: 0, failed: 0, conflicts: 0 };
    }

    let synced = 0;
    let failed = 0;
    let conflicts = 0;

    for (let i = 0; i < queue.length; i++) {
      const mutation = queue[i];
      try {
        mutation.status = 'syncing';
        this.saveQueue(queue);

        // Simulate cloud push or sync verification
        await new Promise(res => setTimeout(res, 200));

        // Delete processed mutation
        this.removeMutation(mutation.id);
        synced++;
        if (onProgress) onProgress(synced, queue.length - (i + 1));
      } catch (err: any) {
        mutation.retries += 1;
        if (mutation.retries >= 3) {
          mutation.status = 'failed';
          mutation.errorNote = err.message || 'فشل الاتصال الخادم';
          failed++;
        } else {
          mutation.status = 'pending';
        }
        this.saveQueue(queue);
      }
    }

    this.saveLastSyncTime(Date.now());
    return { synced, failed, conflicts };
  },
};
