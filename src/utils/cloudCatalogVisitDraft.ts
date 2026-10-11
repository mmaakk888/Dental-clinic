import { MAX_CLOUD_CLINICAL_CENTS, prepareCloudClinicalSessionData,
  type CloudClinicalProgress, type CloudClinicalSessionData } from './cloudClinicalRepository';
import { parseCloudServiceCatalogRecord, type CloudServiceCatalogRecord } from './cloudServiceCatalogRepository';
import { parseCompositeToothId } from './toothUtils';

export interface CloudCatalogVisitServiceDraft {
  readonly id: string;
  readonly catalogServiceId: string;
  readonly name: string;
  readonly priceCents: number | null;
  readonly tooth: string | null;
}
export interface CloudCatalogVisitDraftState {
  readonly catalogRevision: number;
  readonly services: readonly CloudCatalogVisitServiceDraft[];
  readonly teethIds: readonly string[];
  readonly examinationEnabled: boolean;
  /** The captured catalog fee, NOT cash collected and NOT a hard-coded default. */
  readonly examinationCents: number;
  readonly dirty: boolean;
}
export interface CloudCatalogVisitMetadata extends CloudClinicalProgress {
  date: string;
  type?: string;
}
export class CloudCatalogVisitDraftError extends Error {
  constructor() {
    super('راجع الخدمة المختارة والسعر والأسنان وبيانات الزيارة قبل الحفظ.');
    this.name = 'CloudCatalogVisitDraftError';
  }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const validId = (value: unknown): value is string => typeof value === 'string' && value.length === 36 && UUID.test(value);
const validMoney = (value: unknown): value is number => typeof value === 'number'
  && Number.isSafeInteger(value) && !Object.is(value, -0) && value >= 0 && value <= MAX_CLOUD_CLINICAL_CENTS;
function invalid(): never { throw new CloudCatalogVisitDraftError(); }
function fields(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  const keys = Reflect.ownKeys(value);
  if (required.some(key => !keys.includes(key)) || keys.some(key => typeof key !== 'string' || ![...required, ...optional].includes(key))) invalid();
  const result: Record<string, unknown> = {};
  for (const key of keys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) invalid();
    result[key] = descriptor.value;
  }
  return result;
}
function tooth(value: unknown): value is string {
  return typeof value === 'string' && value.length === 3 && parseCompositeToothId(value) !== null;
}
function teeth(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 32 || Reflect.ownKeys(value).length !== value.length + 1) invalid();
  const result: string[] = [];
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable || !tooth(descriptor.value)
      || result.includes(descriptor.value)) invalid();
    result.push(descriptor.value);
  }
  return result;
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

/** Memory-only visit editor. One intentional selection appends immediately;
 * nothing here prepares an operation, saves, loads an SDK or reads local data.
 * The caller owns the view/Auth lifetime and must not use this captured catalog
 * as proof of fresh server authorization or a current catalog revision. */
export function createCloudCatalogVisitDraft(record: unknown, options: { newId?: () => string } = {}) {
  let catalog: CloudServiceCatalogRecord, newId: () => string;
  try {
    catalog = freeze(parseCloudServiceCatalogRecord(record));
    const config = fields(options, [], ['newId']);
    if (config.newId !== undefined && typeof config.newId !== 'function') invalid();
    newId = config.newId as (() => string) | undefined ?? (() => crypto.randomUUID());
  } catch { return invalid(); }
  let state: CloudCatalogVisitDraftState = freeze({ catalogRevision: catalog.revision, services: [], teethIds: [],
    examinationEnabled: false, examinationCents: catalog.data.examinationCents, dirty: false });
  let mutating = false;
  const listeners = new Set<(value: CloudCatalogVisitDraftState) => void>();
  function mutate<T>(work: () => T): T {
    if (mutating) invalid();
    mutating = true;
    try { return work(); } catch { return invalid(); } finally { mutating = false; }
  }
  function publish(services: readonly CloudCatalogVisitServiceDraft[], teethIds: readonly string[], examinationEnabled: boolean) {
    const knownCharge = services.reduce((sum, service) => sum + (service.priceCents ?? 0), examinationEnabled ? state.examinationCents : 0);
    if (!validMoney(knownCharge)) invalid();
    state = freeze({ catalogRevision: catalog.revision, services: services.map(service => ({ ...service })),
      teethIds: [...teethIds], examinationEnabled, examinationCents: catalog.data.examinationCents,
      dirty: services.length > 0 || teethIds.length > 0 || examinationEnabled });
    for (const listener of [...listeners]) { try { listener(state); } catch { /* Views do not grant authority. */ } }
  }
  function rowIndex(id: unknown) {
    if (!validId(id)) invalid();
    const index = state.services.findIndex(service => service.id === id);
    if (index < 0) invalid();
    return index;
  }
  function buildSession(input: CloudCatalogVisitMetadata): CloudClinicalSessionData {
    try {
      const metadata = fields(input, ['date', 'notes', 'treatmentStage', 'rootCanalStatus', 'visitStatus'], ['type']);
      const services = state.services.map(row => {
        const definition = catalog.data.services.find(service => service.serviceId === row.catalogServiceId);
        if (!definition || definition.active !== true || definition.kind !== 'clinical' || definition.name !== row.name
          || row.priceCents === null) invalid();
        return { id: row.id, catalogServiceId: row.catalogServiceId, name: row.name, priceCents: row.priceCents, tooth: row.tooth };
      });
      return prepareCloudClinicalSessionData({
        type: metadata.type === undefined ? (services.length ? 'زيارة علاجية' : 'كشف') : metadata.type,
        date: metadata.date, notes: metadata.notes, treatmentStage: metadata.treatmentStage,
        rootCanalStatus: metadata.rootCanalStatus, visitStatus: metadata.visitStatus,
        teethIds: [...state.teethIds], services,
        examinationCents: state.examinationEnabled ? state.examinationCents : 0,
      });
    } catch { return invalid(); }
  }
  return {
    getCatalog: () => catalog as Readonly<CloudServiceCatalogRecord>,
    getState: () => state,
    subscribe(listener: (value: CloudCatalogVisitDraftState) => void) {
      if (typeof listener !== 'function') invalid();
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    chooseService(serviceId: string): string {
      return mutate(() => {
        if (!validId(serviceId) || state.services.length >= 64) invalid();
        const definition = catalog.data.services.find(service => service.serviceId === serviceId);
        if (!definition || !definition.active || definition.kind !== 'clinical') invalid();
        const id = newId();
        if (!validId(id) || state.services.some(service => service.id === id)) invalid();
        publish([...state.services, { id, catalogServiceId: definition.serviceId, name: definition.name,
          priceCents: definition.priceCents, tooth: null }], state.teethIds, state.examinationEnabled);
        return id;
      });
    },
    removeService(id: string): void {
      mutate(() => {
        const index = rowIndex(id);
        publish(state.services.filter((_, current) => current !== index), state.teethIds, state.examinationEnabled);
      });
    },
    setServicePrice(id: string, priceCents: number | null): void {
      mutate(() => {
        const index = rowIndex(id);
        if (priceCents !== null && !validMoney(priceCents)) invalid();
        const services = state.services.map((service, current) => current === index ? { ...service, priceCents } : service);
        publish(services, state.teethIds, state.examinationEnabled);
      });
    },
    setServiceTooth(id: string, selected: string | null): void {
      mutate(() => {
        const index = rowIndex(id);
        if (selected !== null && !tooth(selected)) invalid();
        const selectedTeeth = selected === null || state.teethIds.includes(selected) ? state.teethIds : [...state.teethIds, selected];
        if (selectedTeeth.length > 32) invalid();
        publish(state.services.map((service, current) => current === index ? { ...service, tooth: selected } : service),
          selectedTeeth, state.examinationEnabled);
      });
    },
    setTeeth(selected: readonly string[]): void {
      mutate(() => {
        const selectedTeeth = teeth(selected);
        // Do not silently detach a service from its tooth when a board changes.
        if (state.services.some(service => service.tooth !== null && !selectedTeeth.includes(service.tooth))) invalid();
        publish(state.services, selectedTeeth, state.examinationEnabled);
      });
    },
    setExaminationEnabled(enabled: boolean): void {
      mutate(() => {
        if (typeof enabled !== 'boolean') invalid();
        publish(state.services, state.teethIds, enabled);
      });
    },
    reset(): void { mutate(() => { publish([], [], false); }); },
    buildSession,
  };
}
export type CloudCatalogVisitDraft = ReturnType<typeof createCloudCatalogVisitDraft>;
