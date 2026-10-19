import { CLOUD_PROJECT_ID } from './cloudIdentity';
import { parseCloudServiceCatalogRecord, prepareCloudServiceCatalogCommand } from './cloudServiceCatalogRepository';
import { parseCloudOperationIntent, prepareCloudIntentCommand } from './cloudOperationIntent';
import { CLOUD_PROSTHETIC_ROUTING_PATH, CLOUD_CLINIC_SETTINGS_PATH, parseCloudProstheticRouting, parseCloudClinicSettingsRecord, prepareCloudClinicSettingsCommand } from './cloudClinicSettingsRepository';
import { createCloudInitialClinicSettings } from './cloudInitialClinicSettings';

/** Exact provisioned location accepted by the owner for the replacement project. */
export const CLOUD_BOOTSTRAP_DATABASE_LOCATION = 'nam5';

/** Trusted administrative initialisation only. Never imported by an app entry,
 * supplied to a browser data capability or used as a migration/reset action.
 * The IAM adapter must verify the actual owner, free-plan database and exact
 * membership-only deployed Rules before calling this transaction. */
export interface CloudBootstrapAuthority {
  projectId: typeof CLOUD_PROJECT_ID; databaseId: '(default)'; location: typeof CLOUD_BOOTSTRAP_DATABASE_LOCATION;
  billingEnabled: false; membershipOnlyRules: true; ownerUid: string;
  ownerActive: true; ownerEmailVerified: true; ownerClaimsVerified: true;
}
export interface CloudBootstrapTransaction {
  get(path: string): Promise<unknown | null>;
  /** Server query with limit(1), inside this same read-write transaction. */
  listFirst(collectionPath: string): Promise<unknown[]>;
  /** Must use a server-side exists:false precondition, never set/upsert. */
  create(path: string, value: object): void;
}
export interface CloudBootstrapAdapter {
  authorizeBootstrap(): Promise<CloudBootstrapAuthority>;
  runTransaction<T>(work: (transaction: CloudBootstrapTransaction) => Promise<T>): Promise<T>;
}
export interface CloudBootstrapCommand { operationId: string; routingOperationId: string; settingsOperationId: string; createdAt: string }
export interface CloudBootstrapResult { status: 'created' | 'already-initialized'; clinicalRecordsCreated: 0 }
export class CloudBootstrapError extends Error {
  constructor(public readonly code: 'invalid' | 'conflict' | 'unavailable') {
    super(({ invalid: 'بيانات تهيئة العيادة غير صالحة.', conflict: 'العيادة ليست فارغة أو سبق تهيئتها بإعداد مختلف؛ لم تُستبدل بيانات.',
      unavailable: 'تعذر تأكيد التهيئة الموثوقة للعيادة.' })[code]);
    this.name = 'CloudBootstrapError';
  }
}
const COUNTER = 'clinics/main/counters/patientFiles';
const CATALOG = 'clinics/main/settings/serviceCatalog';
const MARKER = 'clinics/main/bootstrap/initialRelease';
/** Include all prepared domain paths, not merely patients. New cloud domains
 * must extend this inventory before their adapters can be activated. */
export const CLOUD_BOOTSTRAP_EMPTY_COLLECTIONS = Object.freeze([
  'patientProfiles', 'patientFiles', 'patientOperations', 'patientAccounts', 'patientSessions', 'patientReceipts',
  'clinicalOperations', 'clinicalSessionProofs', 'contactRecords', 'contactPhones', 'contactOperations', 'operationIntents', 'catalogOperations',
  'catalogServiceIds', 'catalogServiceNames',
  'appointmentRecords', 'appointmentDays', 'appointmentOperations', 'labDefinitions', 'labCases', 'labAccounts',
  'labPayments', 'prostheticOperations', 'prostheticPaymentProofs', 'expenseRecords', 'expensePayments', 'expenseOperations', 'expenseInventoryProofs', 'materialBalances',
  'materialUsages', 'supplierInvoiceReservations', 'invoiceImages', 'settingsOperations', 'settingsValidationProofs', 'settings', 'counters', 'bootstrap',
] as const);
function invalid(): never { throw new CloudBootstrapError('invalid'); }
function conflict(): never { throw new CloudBootstrapError('conflict'); }
function unavailable(): never { throw new CloudBootstrapError('unavailable'); }
const uuid = (value: unknown): value is string => typeof value === 'string' && value.length === 36
  && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const actor = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128
  && value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value);
function fields(value: unknown, names: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== names.length || names.some(key => !keys.includes(key))) invalid();
  const copy: Record<string, unknown> = {};
  for (const key of names) {
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (!property || !('value' in property) || !property.enumerable) invalid();
    copy[key] = property.value;
  }
  return copy;
}
function timestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.length !== 24 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    || value < '1900-01-01T00:00:00.000Z' || value > '9999-12-31T23:59:59.999Z') return false;
  const time = new Date(value);
  return Number.isFinite(time.getTime()) && time.toISOString() === value;
}
function command(value: unknown): CloudBootstrapCommand {
  const item = fields(value, ['operationId', 'routingOperationId', 'settingsOperationId', 'createdAt']);
  if (!uuid(item.operationId) || !uuid(item.routingOperationId) || !uuid(item.settingsOperationId)
    || new Set([item.operationId, item.routingOperationId, item.settingsOperationId]).size !== 3 || !timestamp(item.createdAt)) invalid();
  return { operationId: item.operationId, routingOperationId: item.routingOperationId, settingsOperationId: item.settingsOperationId, createdAt: item.createdAt };
}
function authority(value: unknown): CloudBootstrapAuthority {
  const item = fields(value, ['projectId', 'databaseId', 'location', 'billingEnabled', 'membershipOnlyRules', 'ownerUid',
    'ownerActive', 'ownerEmailVerified', 'ownerClaimsVerified']);
  if (item.projectId !== CLOUD_PROJECT_ID || item.databaseId !== '(default)' || item.location !== CLOUD_BOOTSTRAP_DATABASE_LOCATION
    || item.billingEnabled !== false || item.membershipOnlyRules !== true || !actor(item.ownerUid)
    || item.ownerActive !== true || item.ownerEmailVerified !== true || item.ownerClaimsVerified !== true) unavailable();
  return item as unknown as CloudBootstrapAuthority;
}
function membership(value: unknown, uid: string) {
  const member = fields(value, ['schemaVersion', 'clinicId', 'uid', 'role', 'status', 'identityVersion', 'verifiedAfter']);
  if (member.schemaVersion !== 1 || member.clinicId !== 'main' || member.uid !== uid || member.role !== 'owner'
    || member.status !== 'active' || typeof member.identityVersion !== 'number' || !Number.isSafeInteger(member.identityVersion)
    || member.identityVersion < 1 || typeof member.verifiedAfter !== 'number' || !Number.isSafeInteger(member.verifiedAfter)
    || member.verifiedAfter < 0) unavailable();
}
function checkedCounter(value: unknown) {
  const item = fields(value, ['schemaVersion', 'clinicId', 'lastFileNo', 'lastOperationId']);
  if (item.schemaVersion !== 1 || item.clinicId !== 'main' || typeof item.lastFileNo !== 'number'
    || !Number.isSafeInteger(item.lastFileNo) || item.lastFileNo < 0 || item.lastFileNo > 2_000_000_000
    || (item.lastFileNo === 0 ? item.lastOperationId !== null : !uuid(item.lastOperationId))) conflict();
}
async function sha256(value: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** One atomic create-only seed of an empty file counter and the explicitly
 * owner-approved100 EGP exam catalog, plus its immutable receipt and journal.
 * No patients, contacts, appointments, labs, expenses, users or passwords. */
export function createCloudEmptyClinicBootstrap(adapter: CloudBootstrapAdapter,
  options: { digest?: (text: string) => Promise<string> } = {}) {
  const hash = async (value: string) => {
    const result = await (options.digest ?? sha256)(value);
    if (typeof result !== 'string' || result.length !== 64 || !/^[0-9a-f]{64}$/.test(result)) invalid();
    return result;
  };
  return Object.freeze({
    async initialize(input: unknown): Promise<CloudBootstrapResult> {
      try {
        const prepared = command(input), first = authority(await adapter.authorizeBootstrap());
        const authorize = async () => {
          if (JSON.stringify(authority(await adapter.authorizeBootstrap())) !== JSON.stringify(first)) unavailable();
        };
        const catalogCommand = prepareCloudServiceCatalogCommand({ operationId: prepared.operationId, createdAt: prepared.createdAt, expectedRevision: 0,
          data: { examinationCents: 10_000, services: [] } });
        if (!('data' in catalogCommand)) invalid();
        const routingCommand = prepareCloudClinicSettingsCommand({ target: 'prostheticRouting', recordId: 'prostheticRouting',
          operationId: prepared.routingOperationId, createdAt: prepared.createdAt, expectedRevision: 0, data: { routes: [] } });
        const settingsCommand = prepareCloudClinicSettingsCommand({ target: 'clinicSettings', recordId: 'clinicSettings',
          operationId: prepared.settingsOperationId, createdAt: prepared.createdAt, expectedRevision: 0, data: createCloudInitialClinicSettings() });
        const canonical = prepareCloudIntentCommand(catalogCommand);
        const routingCanonical = prepareCloudIntentCommand(routingCommand);
        const settingsCanonical = prepareCloudIntentCommand(settingsCommand);
        const requestHash = await hash(JSON.stringify(['clinic-service-catalog-v1', first.ownerUid, catalogCommand]));
        const intentHash = await hash(JSON.stringify(['clinic-operation-intent-v1', first.ownerUid, 'catalog', canonical]));
        const routingHash = await hash(JSON.stringify(['clinic-settings-v1', first.ownerUid, routingCommand]));
        const routingIntentHash = await hash(JSON.stringify(['clinic-operation-intent-v1', first.ownerUid, 'settings', routingCanonical]));
        const settingsHash = await hash(JSON.stringify(['clinic-settings-v1', first.ownerUid, settingsCommand]));
        const settingsIntentHash = await hash(JSON.stringify(['clinic-operation-intent-v1', first.ownerUid, 'settings', settingsCanonical]));
        const marker = { schemaVersion: 1, clinicId: 'main', recordId: 'initialRelease', operationId: prepared.operationId,
          routingOperationId: prepared.routingOperationId, settingsOperationId: prepared.settingsOperationId,
          actorUid: first.ownerUid, createdAt: prepared.createdAt, examinationCents: 10_000 };
        await authorize();
        const result = await adapter.runTransaction<CloudBootstrapResult>(async transaction => {
          await authorize();
          membership(await transaction.get(`clinics/main/members/${first.ownerUid}`), first.ownerUid);
          const existing = await transaction.get(MARKER);
          const counter = await transaction.get(COUNTER);
          const catalog = await transaction.get(CATALOG);
          const routing = await transaction.get(CLOUD_PROSTHETIC_ROUTING_PATH);
          const settings = await transaction.get(CLOUD_CLINIC_SETTINGS_PATH);
          if (existing !== null) {
            const stored = fields(existing, Object.keys(marker));
            // An explicit same-command retry may observe normal later work.
            // It must never reset a counter, prices or any existing record.
            if (Object.keys(marker).some(key => stored[key] !== marker[key as keyof typeof marker])) conflict();
            checkedCounter(counter);
            parseCloudServiceCatalogRecord(catalog);
            parseCloudProstheticRouting(routing);
            parseCloudClinicSettingsRecord(settings);
            const receipt = fields(await transaction.get(`clinics/main/catalogOperations/${prepared.operationId}`),
              ['schemaVersion', 'clinicId', 'operationId', 'recordId', 'actorUid', 'expectedRevision', 'resultRevision', 'createdAt', 'requestHash']);
            if (receipt.schemaVersion !== 1 || receipt.clinicId !== 'main' || receipt.operationId !== prepared.operationId
              || receipt.recordId !== 'serviceCatalog' || receipt.actorUid !== first.ownerUid || receipt.expectedRevision !== 0
              || receipt.resultRevision !== 1 || receipt.createdAt !== prepared.createdAt || receipt.requestHash !== requestHash) conflict();
            const intent = parseCloudOperationIntent(await transaction.get(`clinics/main/operationIntents/${prepared.operationId}`));
            if (intent.actorUid !== first.ownerUid || intent.kind !== 'catalog' || intent.status !== 'committed'
              || intent.requestHash !== intentHash || intent.createdAt !== prepared.createdAt
              || JSON.stringify(intent.command) !== JSON.stringify(canonical)) conflict();
            const routingReceipt = fields(await transaction.get(`clinics/main/settingsOperations/${prepared.routingOperationId}`),
              ['schemaVersion', 'clinicId', 'operationId', 'target', 'recordId', 'actorUid', 'expectedRevision', 'resultRevision', 'createdAt', 'requestHash']);
            if (routingReceipt.schemaVersion !== 1 || routingReceipt.clinicId !== 'main' || routingReceipt.operationId !== prepared.routingOperationId
              || routingReceipt.target !== 'prostheticRouting' || routingReceipt.recordId !== 'prostheticRouting' || routingReceipt.actorUid !== first.ownerUid
              || routingReceipt.expectedRevision !== 0 || routingReceipt.resultRevision !== 1 || routingReceipt.createdAt !== prepared.createdAt
              || routingReceipt.requestHash !== routingHash) conflict();
            const routingIntent = parseCloudOperationIntent(await transaction.get(`clinics/main/operationIntents/${prepared.routingOperationId}`));
            if (routingIntent.actorUid !== first.ownerUid || routingIntent.kind !== 'settings' || routingIntent.status !== 'committed'
              || routingIntent.requestHash !== routingIntentHash || routingIntent.createdAt !== prepared.createdAt
              || JSON.stringify(routingIntent.command) !== JSON.stringify(routingCanonical)) conflict();
            const settingsReceipt = fields(await transaction.get(`clinics/main/settingsOperations/${prepared.settingsOperationId}`),
              ['schemaVersion', 'clinicId', 'operationId', 'target', 'recordId', 'actorUid', 'expectedRevision', 'resultRevision', 'createdAt', 'requestHash']);
            if (settingsReceipt.schemaVersion !== 1 || settingsReceipt.clinicId !== 'main' || settingsReceipt.operationId !== prepared.settingsOperationId
              || settingsReceipt.target !== 'clinicSettings' || settingsReceipt.recordId !== 'clinicSettings' || settingsReceipt.actorUid !== first.ownerUid
              || settingsReceipt.expectedRevision !== 0 || settingsReceipt.resultRevision !== 1 || settingsReceipt.createdAt !== prepared.createdAt
              || settingsReceipt.requestHash !== settingsHash) conflict();
            const settingsIntent = parseCloudOperationIntent(await transaction.get(`clinics/main/operationIntents/${prepared.settingsOperationId}`));
            if (settingsIntent.actorUid !== first.ownerUid || settingsIntent.kind !== 'settings' || settingsIntent.status !== 'committed'
              || settingsIntent.requestHash !== settingsIntentHash || settingsIntent.createdAt !== prepared.createdAt
              || JSON.stringify(settingsIntent.command) !== JSON.stringify(settingsCanonical)) conflict();
            await authorize(); return { status: 'already-initialized', clinicalRecordsCreated: 0 };
          }
          if (counter !== null || catalog !== null || routing !== null || settings !== null) conflict();
          // Bounded parallel server queries share this transaction's snapshot;
          // avoid dozens of sequential cross-region round trips under its lock.
          for (let start = 0; start < CLOUD_BOOTSTRAP_EMPTY_COLLECTIONS.length; start += 4) {
            const results = await Promise.all(CLOUD_BOOTSTRAP_EMPTY_COLLECTIONS.slice(start, start + 4)
              .map(collection => transaction.listFirst(`clinics/main/${collection}`)));
            for (const found of results) {
              if (!Array.isArray(found) || Reflect.ownKeys(found).length !== found.length + 1 || found.length > 1) unavailable();
              if (found.length !== 0) conflict();
            }
          }
          await authorize();
          transaction.create(COUNTER, { schemaVersion: 1, clinicId: 'main', lastFileNo: 0, lastOperationId: null });
          transaction.create(CATALOG, { schemaVersion: 1, clinicId: 'main', recordId: 'serviceCatalog', revision: 1,
            lastOperationId: prepared.operationId, data: catalogCommand.data });
          transaction.create(`clinics/main/catalogOperations/${prepared.operationId}`, { schemaVersion: 1, clinicId: 'main',
            operationId: prepared.operationId, recordId: 'serviceCatalog', actorUid: first.ownerUid, expectedRevision: 0,
            resultRevision: 1, createdAt: prepared.createdAt, requestHash });
          transaction.create(`clinics/main/operationIntents/${prepared.operationId}`, { schemaVersion: 1, clinicId: 'main',
            recordId: prepared.operationId, operationId: prepared.operationId, actorUid: first.ownerUid, kind: 'catalog',
            requestHash: intentHash, status: 'committed', revision: 2, createdAt: prepared.createdAt, command: canonical });
          transaction.create(CLOUD_PROSTHETIC_ROUTING_PATH, { schemaVersion: 1, clinicId: 'main', recordId: 'prostheticRouting',
            revision: 1, lastOperationId: prepared.routingOperationId, data: { routes: [] } });
          transaction.create(`clinics/main/settingsOperations/${prepared.routingOperationId}`, { schemaVersion: 1, clinicId: 'main',
            operationId: prepared.routingOperationId, target: 'prostheticRouting', recordId: 'prostheticRouting', actorUid: first.ownerUid,
            expectedRevision: 0, resultRevision: 1, createdAt: prepared.createdAt, requestHash: routingHash });
          transaction.create(`clinics/main/operationIntents/${prepared.routingOperationId}`, { schemaVersion: 1, clinicId: 'main',
            recordId: prepared.routingOperationId, operationId: prepared.routingOperationId, actorUid: first.ownerUid, kind: 'settings',
            requestHash: routingIntentHash, status: 'committed', revision: 2, createdAt: prepared.createdAt, command: routingCanonical });
          transaction.create(CLOUD_CLINIC_SETTINGS_PATH, { schemaVersion: 1, clinicId: 'main', recordId: 'clinicSettings',
            revision: 1, lastOperationId: prepared.settingsOperationId, data: settingsCommand.data });
          transaction.create(`clinics/main/settingsOperations/${prepared.settingsOperationId}`, { schemaVersion: 1, clinicId: 'main',
            operationId: prepared.settingsOperationId, target: 'clinicSettings', recordId: 'clinicSettings', actorUid: first.ownerUid,
            expectedRevision: 0, resultRevision: 1, createdAt: prepared.createdAt, requestHash: settingsHash });
          transaction.create(`clinics/main/operationIntents/${prepared.settingsOperationId}`, { schemaVersion: 1, clinicId: 'main',
            recordId: prepared.settingsOperationId, operationId: prepared.settingsOperationId, actorUid: first.ownerUid, kind: 'settings',
            requestHash: settingsIntentHash, status: 'committed', revision: 2, createdAt: prepared.createdAt, command: settingsCanonical });
          transaction.create(MARKER, marker);
          return { status: 'created', clinicalRecordsCreated: 0 };
        });
        await authorize();
        const checked = fields(result, ['status', 'clinicalRecordsCreated']);
        if (!['created', 'already-initialized'].includes(checked.status as string) || checked.clinicalRecordsCreated !== 0) unavailable();
        return { status: checked.status as CloudBootstrapResult['status'], clinicalRecordsCreated: 0 };
      } catch (error) {
        try { if (error instanceof CloudBootstrapError && ['invalid', 'conflict', 'unavailable'].includes(error.code)) throw new CloudBootstrapError(error.code); }
        catch (safe) { if (safe instanceof CloudBootstrapError) throw safe; }
        throw new CloudBootstrapError('unavailable');
      }
    },
  });
}
