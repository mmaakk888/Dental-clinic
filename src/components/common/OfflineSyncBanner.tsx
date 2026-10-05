import React, { useEffect, useState } from 'react';
import { WifiOff, CloudOff } from 'lucide-react';
import { OfflineSyncEngine } from '../../utils/offlineSync';

interface OfflineSyncBannerProps { onSyncComplete?: () => void; }
export const OfflineSyncBanner: React.FC<OfflineSyncBannerProps> = () => {
  const [online, setOnline] = useState(navigator.onLine);
  const [pending, setPending] = useState(() => OfflineSyncEngine.getQueue().length);
  useEffect(() => {
    const update = () => { setOnline(navigator.onLine); setPending(OfflineSyncEngine.getQueue().length); };
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    const timer = window.setInterval(update, 3000);
    return () => { window.clearInterval(timer); window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  if (online && !pending) return null;
  return <div role="status" className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900" dir="rtl">
    <div className="max-w-7xl mx-auto flex items-start gap-2">
      {online ? <CloudOff size={18} className="shrink-0" /> : <WifiOff size={18} className="shrink-0" />}
      <p>{pending ? `توجد ${pending} عملية محلية تنتظر تفعيل الربط السحابي. احتفظ بنسخة احتياطية من الإعدادات.` : 'الاتصال بالإنترنت غير متاح. البيانات محفوظة على هذا الجهاز؛ النسخ السحابي يحتاج اتصالًا.'}</p>
    </div>
  </div>;
};

