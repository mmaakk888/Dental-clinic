import type { UILabels, UserPermission } from '../types';
import { DEFAULT_UI_LABELS } from '../data/initialData';
import { isValidDockAppearance } from './dockAppearance';
import { isValidHomeLayout } from './homeLayout';

export type NavigationSectionKey = 'patients' | 'contacts' | 'appointments' | 'lab' | 'summary' | 'settings';
export type NavigationKey = 'home' | NavigationSectionKey;
export interface ContentDraft { labels: UILabels; tileOrder: string[] }
export interface NavigationItem { key: NavigationKey; label: string; description: string }
export interface ContentValidation { valid: boolean; value: ContentDraft; errors: Record<string, string> }
type NavigationLabels = Partial<Record<NavigationKey, string>>;
type LabelsWithNavigation = UILabels & { navigationLabels?: NavigationLabels };

export const NAVIGATION_SECTIONS: readonly { key: NavigationSectionKey; label: string; description: string }[] = [
  { key: 'patients', label: 'المرضى', description: DEFAULT_UI_LABELS.tiles.patients.desc },
  { key: 'contacts', label: 'الأرقام', description: DEFAULT_UI_LABELS.tiles.contacts.desc },
  { key: 'appointments', label: 'المواعيد', description: DEFAULT_UI_LABELS.tiles.appointments.desc },
  { key: 'lab', label: 'التركيبات', description: DEFAULT_UI_LABELS.tiles.lab.desc },
  { key: 'summary', label: 'الماليات', description: DEFAULT_UI_LABELS.tiles.summary.desc },
  { key: 'settings', label: 'الإعدادات', description: DEFAULT_UI_LABELS.tiles.settings.desc },
];
const canonicalKeys = NAVIGATION_SECTIONS.map(section => section.key);
const navigationKeys: readonly NavigationKey[] = ['home', ...canonicalKeys];
const nonblank = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const record = (value: unknown): Record<string, unknown> => isRecord(value) ? value : {};
export const DEFAULT_HOME_SUBTITLE = 'مواعيد اليوم والمهام الأساسية في مكان واحد.';
export const DEFAULT_HOME_WELCOME = 'اختر الإجراء المطلوب للمتابعة';

// The home link is not part of the configurable section order; consumers always pin it first.
export function normalizeNavigationOrder(input: unknown): NavigationSectionKey[] {
  const result: NavigationSectionKey[] = [];
  if (Array.isArray(input)) input.forEach(key => {
    if (canonicalKeys.includes(key as NavigationSectionKey) && !result.includes(key as NavigationSectionKey)) result.push(key as NavigationSectionKey);
  });
  // Introduce contacts next to patients in legacy orders without rearranging
  // any existing sections. An explicitly saved contacts position stays put.
  if (!result.includes('contacts') && result.includes('patients')) result.splice(result.indexOf('patients') + 1, 0, 'contacts');
  canonicalKeys.forEach(key => { if (!result.includes(key)) result.push(key); });
  return result;
}

/** Missing desktop order inherits the old shared order without persisting it. */
export function getDeviceNavigationOrder(labels: unknown, tileOrder: unknown, device: 'mobile' | 'desktop'): NavigationSectionKey[] {
  const desktop = record(record(record(labels).dockAppearance).desktop);
  return normalizeNavigationOrder(device === 'desktop' && Array.isArray(desktop.order) ? desktop.order : tileOrder);
}

export function getNavigationLabel(input: unknown, key: NavigationKey): string {
  const labels = record(input);
  const explicit = nonblank(record(labels.navigationLabels)[key]);
  if (explicit) return key === 'contacts' && explicit === 'جهات الاتصال' ? 'الأرقام' : explicit;
  if (key === 'home') return nonblank(record(labels.tabs).home) || 'الرئيسية';
  const customizedTitle = nonblank(record(record(labels.tiles)[key]).title);
  if (key === 'contacts' && customizedTitle === 'جهات الاتصال') return 'الأرقام';
  if (customizedTitle && customizedTitle !== nonblank(DEFAULT_UI_LABELS.tiles[key]?.title)) return customizedTitle;
  return NAVIGATION_SECTIONS.find(section => section.key === key)?.label || 'الرئيسية';
}

export function getNavigationDescription(input: unknown, key: NavigationKey): string {
  if (key === 'home') return '';
  const labels = record(input);
  return nonblank(record(record(labels.tiles)[key]).desc) || DEFAULT_UI_LABELS.tiles[key]?.desc || '';
}
export function getHomeSubtitle(input: unknown): string {
  const value = nonblank(record(input).homeSubtitle);
  return value && value !== nonblank(DEFAULT_UI_LABELS.homeSubtitle) ? value : DEFAULT_HOME_SUBTITLE;
}
export function getHomeWelcome(input: unknown): string {
  const value = nonblank(record(input).welcomeText);
  return value && value !== nonblank(DEFAULT_UI_LABELS.welcomeText) ? value : DEFAULT_HOME_WELCOME;
}

export function getNavigationItems(labels: unknown, tileOrder: unknown, permissions?: Partial<UserPermission>): NavigationItem[] {
  const permissionFields: Record<NavigationSectionKey, keyof UserPermission> = { patients: 'patientView', contacts: 'patientView', appointments: 'appointments', lab: 'lab', summary: 'summary', settings: 'controlPanel' };
  const keys: NavigationKey[] = ['home', ...normalizeNavigationOrder(tileOrder).filter(key => permissions?.[permissionFields[key]] !== false)];
  return keys.map(key => ({ key, label: getNavigationLabel(labels, key), description: getNavigationDescription(labels, key) }));
}

// Copies nested imported/legacy fields too, including unknown entries, without JSON's loss of undefined.
function cloneValue<T>(value: T, seen = new WeakMap<object, any>()): T {
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  if (value instanceof Date) return new Date(value.getTime()) as T;
  const cloned: any = Array.isArray(value) ? new Array(value.length) : {};
  seen.set(value, cloned);
  Object.entries(value).forEach(([key, item]) => Object.defineProperty(cloned, key, { value: cloneValue(item, seen), writable: true, configurable: true, enumerable: true }));
  return cloned;
}
function cloneSafeLabels(input: unknown): LabelsWithNavigation {
  if (!isRecord(input)) return cloneValue(DEFAULT_UI_LABELS);
  const labels = cloneValue(input);
  labels.homeSubtitle = typeof labels.homeSubtitle === 'string' ? labels.homeSubtitle : DEFAULT_UI_LABELS.homeSubtitle;
  labels.welcomeText = typeof labels.welcomeText === 'string' ? labels.welcomeText : DEFAULT_UI_LABELS.welcomeText;
  const tiles = isRecord(labels.tiles) ? labels.tiles : cloneValue(DEFAULT_UI_LABELS.tiles);
  canonicalKeys.forEach(key => {
    const entry = record(tiles[key]);
    tiles[key] = { ...entry, title: typeof entry.title === 'string' ? entry.title : DEFAULT_UI_LABELS.tiles[key].title,
      desc: typeof entry.desc === 'string' ? entry.desc : DEFAULT_UI_LABELS.tiles[key].desc };
  });
  labels.tiles = tiles;
  const tabs = isRecord(labels.tabs) ? labels.tabs : cloneValue(DEFAULT_UI_LABELS.tabs);
  Object.keys(DEFAULT_UI_LABELS.tabs).forEach(key => { if (typeof tabs[key] !== 'string') tabs[key] = DEFAULT_UI_LABELS.tabs[key]; });
  if ('home' in tabs && typeof tabs.home !== 'string') delete tabs.home;
  labels.tabs = tabs;
  if ('navigationLabels' in labels) {
    if (!isRecord(labels.navigationLabels)) delete labels.navigationLabels;
    else {
      const navigation = labels.navigationLabels;
      navigationKeys.forEach(key => { if (key in navigation && typeof navigation[key] !== 'string') delete navigation[key]; });
    }
  }
  return labels as unknown as LabelsWithNavigation;
}
export function cloneContentDraft(input: unknown): ContentDraft {
  const draft = record(input);
  return { labels: cloneSafeLabels(draft.labels), tileOrder: normalizeNavigationOrder(draft.tileOrder) };
}

export function moveNavigationSection(input: unknown, key: NavigationSectionKey, direction: 'up' | 'down'): NavigationSectionKey[] {
  const order = normalizeNavigationOrder(input);
  const index = order.indexOf(key);
  if (index < 0 || (direction !== 'up' && direction !== 'down')) return order;
  const target = index + (direction === 'up' ? -1 : 1);
  if (target < 0 || target >= order.length) return order;
  [order[index], order[target]] = [order[target], order[index]];
  return order;
}

export function validateContentDraft(input: unknown, baseline?: unknown): ContentValidation {
  const draft = cloneContentDraft(input);
  const value = cloneContentDraft(draft);
  const baselineDraft = baseline === undefined ? undefined : cloneContentDraft(baseline);
  const errors: Record<string, string> = {};
  if (!isValidDockAppearance(record(record(input).labels).dockAppearance)) errors.dockAppearance = 'اختَر إعدادات صحيحة للشريط العائم.';
  if (!isValidHomeLayout(record(record(input).labels).homeLayout)) errors.homeLayout = 'راجع ترتيب الرئيسية وخيارات عرضها قبل الحفظ.';
  const validateLine = (raw: unknown, key: string, max: number, required: boolean): string => {
    if (typeof raw !== 'string') { errors[key] = 'اكتب نصًا صحيحًا لهذا الحقل.'; return ''; }
    const trimmed = raw.trim();
    if (required && !trimmed) errors[key] = 'هذا الاسم مطلوب.';
    else if (Array.from(trimmed).length > max) errors[key] = `النص يجب ألا يتجاوز ${max} حرفًا.`;
    else if (/[\u0000-\u001f\u007f]/.test(trimmed)) errors[key] = 'اكتب النص في سطر واحد دون رموز تحكم.';
    return trimmed;
  };
  const currentLabels = draft.labels as LabelsWithNavigation;
  const outputLabels = value.labels as LabelsWithNavigation;
  const baselineLabels = baselineDraft?.labels as LabelsWithNavigation | undefined;
  navigationKeys.forEach(key => {
    const raw = currentLabels.navigationLabels?.[key];
    const normalized = validateLine(raw === undefined ? getNavigationLabel(draft.labels, key) : raw, `navigationLabels.${key}`, 20, true);
    // Legacy drafts can be validated without creating a new mapping just by being read.
    if (raw !== undefined && (!baselineDraft || raw !== baselineLabels?.navigationLabels?.[key])) {
      outputLabels.navigationLabels = { ...outputLabels.navigationLabels, [key]: normalized };
    }
  });
  canonicalKeys.forEach(key => {
    const raw = draft.labels.tiles?.[key]?.desc;
    if (raw === undefined) return; // Do not invent missing legacy tile entries on validation.
    const normalized = validateLine(raw, `tiles.${key}.desc`, 140, false);
    if (!baselineDraft || raw !== baselineDraft.labels.tiles?.[key]?.desc) outputLabels.tiles[key] = { ...outputLabels.tiles[key], desc: normalized };
  });
  const homeFields = [{ key: 'homeSubtitle' as const, max: 180 }, { key: 'welcomeText' as const, max: 120 }];
  homeFields.forEach(({ key, max }) => {
    const normalized = validateLine(draft.labels[key], key, max, false);
    if (!baselineDraft || draft.labels[key] !== baselineDraft.labels[key]) value.labels[key] = normalized;
  });
  return { valid: Object.keys(errors).length === 0, value, errors };
}
