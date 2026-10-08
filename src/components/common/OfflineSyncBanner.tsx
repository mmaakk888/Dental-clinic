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
      <p>{pending ? `توجد ${pending} عملية في الطابور المحلي؛ الربط السحابي المشترك غير مفعّل ولم تُرفع هذه العمليات. احتفظ بنسخة احتياطية مؤكدة.` : 'المتصفح يبلغ بعدم توفر شبكة. النسخة تعمل بالتخزين المحلي؛ راجع تأكيد كل حفظ واحتفظ بنسخة احتياطية. المزامنة بين الأجهزة غير مفعّلة.'}</p>
    </div>
  </div>;
};

