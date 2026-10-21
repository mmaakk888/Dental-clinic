import type { Lab, LabService } from '../types';
import { normalizeServiceName } from './serviceCatalog';

export type ProstheticKind = 'fixed' | 'removable';
export interface ProstheticRoutingSettings {
  defaultLabs: { fixed?: string; removable?: string };
  overrides: { kind: ProstheticKind; material: string; labId: string; labServiceId: string }[];
}
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const text = (value: unknown, limit = 200): value is string => typeof value === 'string' && value.trim() === value
  && value.length > 0 && Array.from(value).length <= limit && !/[\p{Cc}\u2028\u2029]/u.test(value)
  && !['__proto__', 'constructor', 'prototype'].includes(value);
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every(key => keys.includes(key));
const invalid = () => new Error('راجع إعدادات المعامل الافتراضية وتخصيص أنواع التركيبات.');

export function cloneProstheticRouting(input?: unknown): ProstheticRoutingSettings {
  if (input === undefined) return { defaultLabs: {}, overrides: [] };
  return validateProstheticRouting(input);
}

/** Optional references are checked only when the caller supplies the fresh catalogs. */
export function validateProstheticRouting(input: unknown, labs?: readonly Lab[], materials?: readonly string[]): ProstheticRoutingSettings {
  if (!isRecord(input) || !exact(input, ['defaultLabs', 'overrides']) || !isRecord(input.defaultLabs)
    || !exact(input.defaultLabs, ['fixed', 'removable']) || !Array.isArray(input.overrides) || input.overrides.length > 300) throw invalid();
  const defaultLabs: ProstheticRoutingSettings['defaultLabs'] = {};
  for (const kind of ['fixed', 'removable'] as const) {
    const labId = input.defaultLabs[kind];
    if (labId !== undefined) {
      if (!text(labId) || (labs && labs.filter(lab => lab.id === labId).length !== 1)) throw invalid();
      defaultLabs[kind] = labId;
    }
  }
  const seen = new Set<string>();
  const overrides: ProstheticRoutingSettings['overrides'] = [];
  for (const row of input.overrides) {
    if (!isRecord(row) || !exact(row, ['kind', 'material', 'labId', 'labServiceId'])
      || !['fixed', 'removable'].includes(row.kind as string) || !text(row.material, 80) || !normalizeServiceName(row.material)
      || !text(row.labId) || !text(row.labServiceId)) throw invalid();
    const kind = row.kind as ProstheticKind;
    const key = `${kind}|${normalizeServiceName(row.material)}`;
    if (seen.has(key) || (materials && !materials.some(name => normalizeServiceName(name) === normalizeServiceName(row.material)))) throw invalid();
    seen.add(key);
    if (labs) {
      const matches = labs.filter(lab => lab.id === row.labId);
      const services = matches[0]?.services.filter(service => service.id === row.labServiceId && service.category === kind);
      if (matches.length !== 1 || services?.length !== 1) throw invalid();
    }
    overrides.push({ kind, material: row.material, labId: row.labId, labServiceId: row.labServiceId });
  }
  return { defaultLabs, overrides };
}

/** This resolves private supplier data internally; never pass its result into a patient form. */
export function resolveProstheticLab(settings: ProstheticRoutingSettings, labs: readonly Lab[], kind: ProstheticKind, material: string): { lab: Lab; service: LabService } {
  const safe = validateProstheticRouting(settings);
  const override = safe.overrides.find(row => row.kind === kind && normalizeServiceName(row.material) === normalizeServiceName(material));
  const labId = override?.labId ?? safe.defaultLabs[kind];
  const candidates = labs.filter(lab => lab.id === labId);
  const services = candidates[0]?.services.filter(service => service.category === kind && (override
    ? service.id === override.labServiceId : normalizeServiceName(service.name) === normalizeServiceName(material))) ?? [];
  if (candidates.length !== 1 || services.length !== 1) {
    throw new Error('توجيه هذه التركيبة غير مكتمل. اطلب من الطبيب مراجعة المعمل الافتراضي وربط النوع بخدمة المعمل في الإعدادات.');
  }
  return { lab: candidates[0], service: services[0] };
}
