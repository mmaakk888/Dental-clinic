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

export function useOfflineSyncStatus(enabled=true) {
  const current=()=>enabled?readStatus():{online:navigator.onLine,queued:0,pending:0,failed:0};
  const [status, setStatus] = useState(current);
  useEffect(() => {
    const update = () => {
      const next = current();
      setStatus(previous => previous.online === next.online && previous.queued === next.queued
        && previous.pending === next.pending && previous.failed === next.failed ? previous : next);
    };
    const unsubscribe = enabled?subscribeOfflineSyncStatus(update):()=>{};
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    // A change between render and subscription must not be missed.
    update();
    return () => {
      unsubscribe();
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, [enabled]);
  return status;
}
