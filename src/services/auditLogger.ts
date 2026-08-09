export interface AuditLogItem {
  id: string;
  timestamp: string; // ISO date string
  userName: string;
  userRole: string;
  action: 'create' | 'edit' | 'delete' | 'payment' | 'login' | 'logout';
  entity: 'patient' | 'appointment' | 'lab' | 'expense' | 'user' | 'system';
  recordName: string;
  details: string;
  prevValue?: string;
  newValue?: string;
  device?: string;
}

const STORAGE_KEY = 'dental_audit_logs';

export function getAuditLogs(): AuditLogItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return getInitialDefaultLogs();
    return JSON.parse(raw);
  } catch (e) {
    console.error('Failed to parse audit logs', e);
    return getInitialDefaultLogs();
  }
}

export function logAuditAction(item: Omit<AuditLogItem, 'id' | 'timestamp'>): void {
  try {
    const currentLogs = getAuditLogs();
    const newLog: AuditLogItem = {
      ...item,
      id: 'log-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
      timestamp: new Date().toISOString(),
      device: typeof window !== 'undefined' && window.innerWidth >= 1920 ? 'شاشة كبيرة (TV)' : window.innerWidth < 768 ? 'جوال' : 'كمبيوتر'
    };

    // Keep up to 500 recent logs
    const updated = [newLog, ...currentLogs].slice(0, 500);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (e) {
    console.error('Failed to save audit log', e);
  }
}

function getInitialDefaultLogs(): AuditLogItem[] {
  const now = new Date();
  return [
    {
      id: 'log-1',
      timestamp: new Date(now.getTime() - 3600000 * 2).toISOString(),
      userName: 'د. أحمد محمود',
      userRole: 'طبيب',
      action: 'login',
      entity: 'system',
      recordName: 'تسجيل دخول النظام',
      details: 'تم تسجيل الدخول بنجاح من جهاز العيادة الرئيسي',
      device: 'كمبيوتر'
    },
    {
      id: 'log-2',
      timestamp: new Date(now.getTime() - 3600000 * 1.5).toISOString(),
      userName: 'مريم (سعادة)',
      userRole: 'سكرتيرة',
      action: 'create',
      entity: 'patient',
      recordName: 'محمد علي حسن (ملف #101)',
      details: 'تم إنشاء ملف مريض جديد وتسجيل بيانات التواصل',
      device: 'جوال'
    },
    {
      id: 'log-3',
      timestamp: new Date(now.getTime() - 3600000 * 1).toISOString(),
      userName: 'مريم (سعادة)',
      userRole: 'سكرتيرة',
      action: 'payment',
      entity: 'patient',
      recordName: 'تحصيل نقدية - ملف #101',
      details: 'تم تحصيل دفعة مالية بقيمة 500 ج.م على حشو عصب',
      newValue: '500 ج.م',
      device: 'جوال'
    }
  ];
}
