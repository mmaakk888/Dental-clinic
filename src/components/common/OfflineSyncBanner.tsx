import React from 'react';
import { WifiOff, CloudOff } from 'lucide-react';
import { useOfflineSyncStatus } from '../../hooks/useOfflineSyncStatus';

interface OfflineSyncBannerProps { onSyncComplete?: () => void; }
export const OfflineSyncBanner: React.FC<OfflineSyncBannerProps> = () => {
  const { online, queued: pending } = useOfflineSyncStatus();
  if (online && !pending) return null;
  return <div role="status" className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900" dir="rtl">
    <div className="max-w-7xl mx-auto flex items-start gap-2">
      {online ? <CloudOff size={18} className="shrink-0" /> : <WifiOff size={18} className="shrink-0" />}
      <p>{pending ? `توجد ${pending} عملية محلية تنتظر تفعيل الربط السحابي. احتفظ بنسخة احتياطية من الإعدادات.` : 'الاتصال بالإنترنت غير متاح. البيانات محفوظة على هذا الجهاز؛ النسخ السحابي يحتاج اتصالًا.'}</p>
    </div>
  </div>;
};

