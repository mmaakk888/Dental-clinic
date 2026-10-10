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

/** Invalid rows must not crash the activity screen. Reading never repairs or
 * overwrites storage, and an empty/corrupt log never invents clinic activity. */
export function parseAuditLogs(value: unknown): AuditLogItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is AuditLogItem => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const record = item as Record<string, unknown>;
    return ['id', 'timestamp', 'userName', 'userRole', 'recordName', 'details'].every(key => typeof record[key] === 'string')
      && !!record.id && Number.isFinite(Date.parse(record.timestamp as string))
      && ['create', 'edit', 'delete', 'payment', 'login', 'logout'].includes(record.action as string)
      && ['patient', 'appointment', 'lab', 'expense', 'user', 'system'].includes(record.entity as string)
      && ['prevValue', 'newValue', 'device'].every(key => record[key] === undefined || typeof record[key] === 'string');
  });
}

export function getAuditLogs(): AuditLogItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? parseAuditLogs(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

export function logAuditAction(item: Omit<AuditLogItem, 'id' | 'timestamp'>): void {
  try {
    const currentLogs = getAuditLogs();
    const newLog: AuditLogItem = {
      ...item,
      id: 'log-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
      timestamp: new Date().toISOString(),
      device: typeof window === 'undefined' ? 'غير محدد' : window.innerWidth >= 1920 ? 'شاشة كبيرة' : window.innerWidth < 768 ? 'موبايل' : 'كمبيوتر'
    };

    // Keep up to 500 recent logs
    const updated = [newLog, ...currentLogs].slice(0, 500);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    console.error('Failed to save audit log');
  }
}

