import { useEffect, useState } from 'react';
import { OfflineSyncEngine, subscribeOfflineSyncStatus } from '../utils/offlineSync';

function readStatus() {
  const queue = OfflineSyncEngine.getQueue();
  return {
    online: navigator.onLine,
    queued: queue.length,
    pending: queue.filter(item => item?.status === 'pending' || item?.status === 'syncing').length,
    failed: queue.filter(item => item?.status === 'failed').length,
  };
}

export function useOfflineSyncStatus() {
  const [status, setStatus] = useState(readStatus);
  useEffect(() => {
    const update = () => {
      const next = readStatus();
      setStatus(previous => previous.online === next.online && previous.queued === next.queued
        && previous.pending === next.pending && previous.failed === next.failed ? previous : next);
    };
    const unsubscribe = subscribeOfflineSyncStatus(update);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    // A change between render and subscription must not be missed.
    update();
    return () => {
      unsubscribe();
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return status;
}
