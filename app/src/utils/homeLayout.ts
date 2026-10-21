import type { HomeLayoutSettings, HomeSectionKey } from '../types';

export const HOME_SECTIONS: readonly { key: HomeSectionKey; label: string; description: string }[] = [
  { key: 'actions', label: 'إجراءات اليوم', description: 'الزيارة والحجز والتحصيل والاختصارات المتاحة للحساب.' },
  { key: 'metrics', label: 'مؤشرات اليوم', description: 'المواعيد والتحصيل والأرصدة وحالات المعمل حسب الصلاحيات.' },
  { key: 'schedule', label: 'جدول اليوم', description: 'المواعيد المسجلة مع الوقت وحالة الحضور.' },
  { key: 'followUp', label: 'تنبيهات المتابعة', description: 'الحالات المفتوحة وعدم الحضور ومصروفات اليوم للمصرّح له.' },
];
const keys = HOME_SECTIONS.map(section => section.key);
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Read-time fallback only. Missing legacy settings retain the existing home. */
export function getHomeLayout(labels: unknown): HomeLayoutSettings {
  const value = isRecord(labels) && isRecord(labels.homeLayout) ? labels.homeLayout : {};
  const sectionOrder: HomeSectionKey[] = [];
  if (Array.isArray(value.sectionOrder)) value.sectionOrder.forEach(key => {
    if (keys.includes(key) && !sectionOrder.includes(key)) sectionOrder.push(key);
  });
  keys.forEach(key => { if (!sectionOrder.includes(key)) sectionOrder.push(key); });
  const hiddenSections = Array.isArray(value.hiddenSections) ? value.hiddenSections : [];
  return {
    sectionOrder,
    hiddenSections: keys.filter(key => hiddenSections.includes(key)),
    density: value.density === 'compact' ? 'compact' : 'comfortable',
    appointmentLimit: value.appointmentLimit === 3 || value.appointmentLimit === 10 ? value.appointmentLimit : 6,
  };
}

/** Explicit settings must be complete and bounded; unknown keys cannot carry behavior. */
export function isValidHomeLayout(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value) || Object.keys(value).length !== 4
    || Object.keys(value).some(key => !['sectionOrder', 'hiddenSections', 'density', 'appointmentLimit'].includes(key))) return false;
  const validKeys = (list: unknown) => Array.isArray(list) && list.length <= keys.length
    && list.every(key => keys.includes(key)) && new Set(list).size === list.length;
  return validKeys(value.sectionOrder) && (value.sectionOrder as unknown[]).length === keys.length
    && validKeys(value.hiddenSections) && ['comfortable', 'compact'].includes(value.density as string)
    && [3, 6, 10].includes(value.appointmentLimit as number);
}

export function moveHomeSection(settings: HomeLayoutSettings, key: HomeSectionKey, direction: 'up' | 'down'): HomeLayoutSettings {
  const next = getHomeLayout({ homeLayout: settings });
  const index = next.sectionOrder.indexOf(key);
  const target = index + (direction === 'up' ? -1 : 1);
  if (index >= 0 && target >= 0 && target < next.sectionOrder.length) {
    [next.sectionOrder[index], next.sectionOrder[target]] = [next.sectionOrder[target], next.sectionOrder[index]];
  }
  return next;
}
