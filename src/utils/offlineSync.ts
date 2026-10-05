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
      return val ? parseInt(val, 10) || 0 : 0;
    } catch {
      return 0;
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
    // No authenticated cloud mutation transport has been configured yet.
    // Preserve queued changes until a real upload acknowledges them.
    return { synced: 0, failed: 0, conflicts: 0 };
  },
};

