import type { DockAppearance } from '../types';

export const DEFAULT_DOCK_APPEARANCE: Readonly<DockAppearance> = Object.freeze({
  size: 'comfortable', showLabels: true, mobileVisibleCount: 4,
});
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Safe read-time fallback only; it never writes or changes persisted settings. */
export function getDockAppearance(labels: unknown): DockAppearance {
  const value = isRecord(labels) && isRecord(labels.dockAppearance) ? labels.dockAppearance : {};
  return {
    size: ['compact', 'comfortable', 'large'].includes(value.size as string) ? value.size as DockAppearance['size'] : DEFAULT_DOCK_APPEARANCE.size,
    showLabels: typeof value.showLabels === 'boolean' ? value.showLabels : DEFAULT_DOCK_APPEARANCE.showLabels,
    mobileVisibleCount: value.mobileVisibleCount === 3 || value.mobileVisibleCount === 4 ? value.mobileVisibleCount : DEFAULT_DOCK_APPEARANCE.mobileVisibleCount,
  };
}

/** Missing legacy preferences are valid. Explicit malformed preferences are not. */
export function isValidDockAppearance(value: unknown): boolean {
  return value === undefined || (isRecord(value)
    && ['compact', 'comfortable', 'large'].includes(value.size as string)
    && typeof value.showLabels === 'boolean'
    && (value.mobileVisibleCount === 3 || value.mobileVisibleCount === 4));
}

export function splitMobileNavigation<T>(items: readonly T[], preferences: DockAppearance): { visible: T[]; extra: T[] } {
  // Count is deliberately bounded: at 320px even large icons retain 44px targets.
  const count = preferences.mobileVisibleCount === 3 ? 3 : 4;
  return { visible: items.slice(0, count), extra: items.slice(count) };
}
