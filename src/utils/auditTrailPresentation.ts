import type { AuditLogItem } from '../services/auditLogger';
import { normalizeContactSearch } from './clinicContacts';
import { serializeClinicCsv } from './csvExport';

export const AUDIT_ACTIONS = [
  { value: 'create', label: 'إضافة' }, { value: 'edit', label: 'تعديل' },
  { value: 'delete', label: 'حذف' }, { value: 'payment', label: 'تحصيل مالي' },
  { value: 'login', label: 'تسجيل دخول' }, { value: 'logout', label: 'تسجيل خروج' },
] as const;
export const AUDIT_ENTITIES = [
  { value: 'patient', label: 'ملفات المرضى' }, { value: 'appointment', label: 'المواعيد' },
  { value: 'lab', label: 'المعامل' }, { value: 'expense', label: 'المصروفات' },
  { value: 'user', label: 'المستخدمون' }, { value: 'system', label: 'النظام' },
] as const;
export const auditActionLabel = (value: string) => AUDIT_ACTIONS.find(action => action.value === value)?.label || 'عملية أخرى';
export const auditEntityLabel = (value: string) => AUDIT_ENTITIES.find(entity => entity.value === value)?.label || 'قسم آخر';
const dateFormatter = new Intl.DateTimeFormat('ar-EG', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'long', year: 'numeric' });
const timeFormatter = new Intl.DateTimeFormat('ar-EG', { timeZone: 'Africa/Cairo', hour: 'numeric', minute: '2-digit', hour12: true });

/** Split date and time so Arabic text, file IDs and punctuation cannot reorder them. */
export function formatAuditDateTime(value: string): { date: string; time: string; iso?: string } {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return { date: 'تاريخ غير متاح', time: 'وقت غير متاح' };
  return { date: dateFormatter.format(date), time: timeFormatter.format(date), iso: date.toISOString() };
}

export function filterAuditLogs(logs: readonly AuditLogItem[], search: string, action = 'all', entity = 'all'): AuditLogItem[] {
  const query = normalizeContactSearch(search);
  return logs.filter(log => (action === 'all' || log.action === action) && (entity === 'all' || log.entity === entity)
    && (!query || [log.userName, log.recordName, log.details].some(value => normalizeContactSearch(value).includes(query))))
    .slice().sort((left, right) => (Date.parse(right.timestamp) || 0) - (Date.parse(left.timestamp) || 0));
}

export function serializeAuditCsv(logs: readonly AuditLogItem[]): string {
  return serializeClinicCsv(['المعرف', 'التاريخ', 'الوقت (القاهرة)', 'المستخدم', 'الدور', 'العملية', 'القسم', 'السجل', 'التفاصيل', 'القيمة المسجلة', 'الجهاز'], logs.map(log => {
    const stamp = formatAuditDateTime(log.timestamp);
    return [log.id, stamp.date, stamp.time, log.userName, log.userRole, auditActionLabel(log.action), auditEntityLabel(log.entity), log.recordName, log.details, log.newValue ?? '', log.device || 'غير محدد'];
  }));
}
