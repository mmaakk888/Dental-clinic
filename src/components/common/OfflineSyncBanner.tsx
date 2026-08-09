import React, { useState, useEffect } from 'react';
import { Wifi, WifiOff, RefreshCw, CheckCircle, AlertTriangle, CloudOff } from 'lucide-react';
import { OfflineSyncEngine, PendingMutation } from '../../utils/offlineSync';

interface OfflineSyncBannerProps {
  onSyncComplete?: () => void;
}

export const OfflineSyncBanner: React.FC<OfflineSyncBannerProps> = ({ onSyncComplete }) => {
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [queue, setQueue] = useState<PendingMutation[]>(() => OfflineSyncEngine.getQueue());
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [syncStatusMsg, setSyncStatusMsg] = useState<string | null>(null);

  useEffect(() => {
    const handleOnline = async () => {
      setIsOnline(true);
      setSyncStatusMsg('تم استعادة الاتصال! جاري مزامنة التغييرات المحفوظة محلیاً...');
      await triggerSync();
    };

    const handleOffline = () => {
      setIsOnline(false);
      setSyncStatusMsg('أنت الآن تفضل العمل بدون إنترنت (Offline Mode). يتم حفظ كل البيانات تلقائياً على جهازك.');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Refresh queue interval
    const interval = setInterval(() => {
      setQueue(OfflineSyncEngine.getQueue());
    }, 3000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, []);

  const triggerSync = async () => {
    if (!navigator.onLine) {
      setSyncStatusMsg('تعذر المزامنة: لا يوجد اتصال بالإنترنت حالياً.');
      return;
    }
    setIsSyncing(true);
    const result = await OfflineSyncEngine.processQueue();
    setIsSyncing(false);
    setQueue(OfflineSyncEngine.getQueue());

    if (result.synced > 0) {
      setSyncStatusMsg(`تمت المزامنة بنجاح! تم رفع ${result.synced} عمليات وتحديث البيانات بنجاح.`);
      if (onSyncComplete) onSyncComplete();
    } else if (result.failed > 0) {
      setSyncStatusMsg(`فشلت مزامنة ${result.failed} عمليات. يمكنك إعادة المحاولة لاحقاً.`);
    } else {
      setSyncStatusMsg('جميع البيانات محدثة ومتزامنة بالكامل.');
    }

    setTimeout(() => {
      setSyncStatusMsg(null);
    }, 6000);
  };

  if (isOnline && queue.length === 0 && !syncStatusMsg) {
    return null; // Silent when online and no pending offline mutations
  }

  return (
    <div className="bg-slate-900 border-b border-slate-800 text-white px-3 py-2 text-xs sm:text-sm shadow-md transition-all">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {!isOnline ? (
            <span className="flex items-center gap-1.5 bg-amber-500/20 text-amber-300 font-medium px-2.5 py-1 rounded-md border border-amber-500/30">
              <WifiOff className="w-4 h-4 text-amber-400 animate-pulse" />
              <span>وضع عدم الاتصال (Offline First)</span>
            </span>
          ) : queue.length > 0 ? (
            <span className="flex items-center gap-1.5 bg-sky-500/20 text-sky-300 font-medium px-2.5 py-1 rounded-md border border-sky-500/30">
              <CloudOff className="w-4 h-4 text-sky-400" />
              <span>تغيرات معلقة للمزامنة ({queue.length})</span>
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
              <CheckCircle className="w-4 h-4" />
              <span>متصل بالمزامنة التلقائية</span>
            </span>
          )}

          {syncStatusMsg && (
            <span className="text-slate-300 text-xs hidden sm:inline-block border-r border-slate-700 pr-2 mr-2">
              {syncStatusMsg}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {queue.length > 0 && isOnline && (
            <button
              onClick={triggerSync}
              disabled={isSyncing}
              className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1 rounded-md font-medium text-xs transition disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>{isSyncing ? 'جاري المزامنة...' : 'مزامنة الآن'}</span>
            </button>
          )}

          {!isOnline && (
            <span className="text-amber-200/80 text-xs">
              جميع الإجراءات تُحفظ بأمان وتُرفَع تلقائياً فور عودة التغطية.
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
