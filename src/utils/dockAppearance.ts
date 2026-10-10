import type { DockAppearance } from '../types';

export const DEFAULT_DOCK_APPEARANCE: Readonly<DockAppearance> = Object.freeze({
  size: 'comfortable', showLabels: true, mobileVisibleCount: 4, moreSections: [],
});
Object.freeze(DEFAULT_DOCK_APPEARANCE.moreSections);
const configurableSections = ['patients', 'contacts', 'appointments', 'lab', 'summary', 'settings'];
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const readMoreSections = (value: unknown): string[] => Array.isArray(value)
  ? [...new Set(value.filter((key): key is string => typeof key === 'string' && configurableSections.includes(key)))] : [];

/** Safe read-time fallback only; it never writes or changes persisted settings. */
export function getDockAppearance(labels: unknown): DockAppearance {
  const value = isRecord(labels) && isRecord(labels.dockAppearance) ? labels.dockAppearance : {};
  return {
    size: ['compact', 'comfortable', 'large'].includes(value.size as string) ? value.size as DockAppearance['size'] : DEFAULT_DOCK_APPEARANCE.size,
    showLabels: typeof value.showLabels === 'boolean' ? value.showLabels : DEFAULT_DOCK_APPEARANCE.showLabels,
    mobileVisibleCount: value.mobileVisibleCount === 3 || value.mobileVisibleCount === 4 ? value.mobileVisibleCount : DEFAULT_DOCK_APPEARANCE.mobileVisibleCount,
    moreSections: readMoreSections(value.moreSections),
  };
}

/** Missing legacy preferences are valid. Explicit malformed preferences are not. */
export function isValidDockAppearance(value: unknown): boolean {
  return value === undefined || (isRecord(value)
    && ['compact', 'comfortable', 'large'].includes(value.size as string)
    && typeof value.showLabels === 'boolean'
    && (value.mobileVisibleCount === 3 || value.mobileVisibleCount === 4)
    && (value.moreSections === undefined || Array.isArray(value.moreSections)
      && value.moreSections.every(key => typeof key === 'string' && configurableSections.includes(key))
      && new Set(value.moreSections).size === value.moreSections.length));
}

/** Permission filtering happens first. Forced More items never backfill direct links. */
export function splitDesktopNavigation<T extends { key: string }>(items: readonly T[], _preferences: DockAppearance): { visible: T[]; extra: T[] } {
  // Placement is mobile-only; desktop retains every permitted direct link.
  return { visible: [...items], extra: [] };
}

export function splitMobileNavigation<T extends { key: string }>(items: readonly T[], preferences: DockAppearance): { visible: T[]; extra: T[] } {
  // Count is deliberately bounded: at 320px even large icons retain 44px targets.
  const count = preferences.mobileVisibleCount === 3 ? 3 : 4;
  const forcedMore = new Set(readMoreSections(preferences.moreSections));
  const direct = items.filter(item => item.key === 'home' || !forcedMore.has(item.key));
  const visible = direct.slice(0, count), visibleKeys = new Set(visible.map(item => item.key));
  return { visible, extra: items.filter(item => !visibleKeys.has(item.key)) };
}
