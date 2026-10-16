import { normalizeContactPhone } from './clinicContacts';
import { parseCloudPatientRecord } from './cloudPatientRepository';
import { parseCloudClinicalAccount, parseCloudClinicalReceipt, parseCloudClinicalSession,
  type CloudClinicalAccount, type CloudClinicalReceipt, type CloudClinicalSession } from './cloudClinicalRepository';
import { parseCloudServiceCatalogRecord } from './cloudServiceCatalogRepository';
import { parseCloudLabDefinition, parseCloudProstheticRouting,
  CLOUD_PROSTHETIC_ROUTING_PATH, cloudLabDefinitionPath } from './cloudClinicSettingsRepository';
import { parseCompositeToothId } from './toothUtils';
import { CloudOperationIntentError, readCloudOperationIntentForCommit,
  markCloudOperationIntentCommitted } from './cloudOperationIntent';

/** Protected owner-only laboratory ledger. The public patient session contains
 * its selling-price snapshot only. Supplier identity/cost lives in labCases,
 * never in patientReceipts or clinical session data. No local defaults/SDK. */
export type CloudProstheticStatus = 'pending' | 'in_progress' | 'ready' | 'delivered';
export interface CloudProstheticSnapshot {
  serviceId: string; serviceName: string; catalogRevision: number;
  configuredPatientUnitPriceCents: number; patientUnitPriceCents: number; examinationCents: number;
  kind: 'fixed' | 'removable'; units: number; teethIds: string[]; date: string; deliveryExpectedDate: string | null;
  labName: string; materialId: string; materialName: string; materialCategory: 'fixed' | 'removable' | 'other';
  unitLabel: string; billingBasis: 'per-unit' | 'whole-case'; labRevision: number; routingRevision: number; unitCostCents: number;
}
export interface CloudProstheticCase {
  schemaVersion: 1; clinicId: 'main'; recordId: string; patientId: string; sessionId: string; fileNo: number; labId: string;
  revision: number; lastOperationId: string; totalCostCents: number; paidCostCents: number;
  status: CloudProstheticStatus; note: string; snapshot: CloudProstheticSnapshot;
}
export interface CloudLabAccount {
  schemaVersion: 1; clinicId: 'main'; labId: string; revision: number; lastOperationId: string;
  totalCostCents: number; paidCostCents: number; caseCount: number; paymentCount: number;
}
export interface CloudLabPayment {
  schemaVersion: 1; clinicId: 'main'; receiptId: string; labId: string; amountCents: number;
  date: string; note: string; createdAt: string; actorUid: string; paymentMethod: 'cash';
  allocations: { caseId: string; amountCents: number }[];
}
interface CommandBase { operationId: string; labId: string; expectedLabAccountRevision: number; createdAt: string }
export type CloudProstheticCommand = CommandBase & (
  { action: 'create'; patientId: string; expectedPatientRevision: number; serviceId: string;
    expectedCatalogRevision: number; expectedRoutingRevision: number; expectedLabRevision: number;
    kind: 'fixed' | 'removable'; units: number; teethIds: string[]; date: string; deliveryExpectedDate: string | null;
    patientUnitPriceCents: number; includeExamination: boolean; paidCents: number; note: string }
  | { action: 'progress'; caseId: string; expectedCaseRevision: number; status: CloudProstheticStatus; note: string }
  | { action: 'lab-payment'; date: string; note: string;
    allocations: { caseId: string; expectedRevision: number; amountCents: number }[] }
);
export interface CloudProstheticCommit {
  status: 'committed' | 'already-committed'; operationId: string; action: CloudProstheticCommand['action'];
  labId: string; labRevision: number; patientId: string | null; caseId: string | null;
  fileNo: number | null; patientRevision: number | null; caseRevision: number | null;
}
export interface CloudProstheticTransaction { get(path: string): Promise<unknown | null>; set(path: string, value: object): void }
export interface CloudProstheticPageInput { labId: string; afterId?: string | null; limit?: number }
export interface CloudProstheticPage<T> { records: T[]; nextAfterId: string | null }
export interface CloudProstheticAdapter {
  authorizeOwner(): Promise<string>;
  runTransaction<T>(work: (transaction: CloudProstheticTransaction) => Promise<T>): Promise<T>;
  readRecord?(path: string): Promise<unknown | null>;
  listCasesPage?(labId: string, afterId: string | null, limit: number): Promise<unknown>;
  listPaymentsPage?(labId: string, afterId: string | null, limit: number): Promise<unknown>;
}
export interface CloudProstheticOptions { digest?: (text: string) => Promise<string> }
export interface CloudLabFinancialSummary {
  account: CloudLabAccount; month: string; totalCostCents: number; paidCostCents: number; remainingCents: number;
  monthPaidCents: number; cases: CloudProstheticCase[]; payments: CloudLabPayment[];
}
export const MAX_CLOUD_PROSTHETIC_CENTS = 1_000_000_000_000;
export const MAX_CLOUD_LAB_PAYMENT_ALLOCATIONS = 8;
/** Immutable witnesses are written in the SAME atomic payment transaction.
 * Three rows per witness keep every Rules evaluation below its ten-read
 * ceiling without reducing the existing eight-case allocation capacity. */
export const CLOUD_LAB_PAYMENT_PROOF_ROWS = 3;
export const cloudProstheticPaymentProofPath = (operationId: string, index: number) =>
  `clinics/main/prostheticPaymentProofs/${operationId}-${index}`;
export const MAX_CLOUD_LAB_HISTORY_RECORDS = 2000;
export const cloudProstheticPath = (collection: 'labCases' | 'labAccounts' | 'labPayments' | 'prostheticOperations', id: string) => `clinics/main/${collection}/${id}`;
export class CloudProstheticError extends Error {
  constructor(public readonly code: 'invalid' | 'conflict' | 'unavailable') {
    super(({ invalid: 'بيانات التركيبة أو حساب المعمل غير صالحة.',
      conflict: 'تغيرت الأسعار أو حساب المريض أو المعمل؛ راجع أحدث السجل قبل الحفظ.',
      unavailable: 'تعذر تأكيد عملية التركيبة أو المعمل من الخادم.' })[code]);
    this.name = 'CloudProstheticError';
  }
}
const MAX_REVISION = 2_000_000_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const uuid = (value: unknown): value is string => typeof value === 'string' && value.length === 36 && UUID.test(value);
const integer = (value: unknown, min = 0, max = MAX_REVISION): value is number => typeof value === 'number'
  && Number.isSafeInteger(value) && !Object.is(value, -0) && value >= min && value <= max;
const money = (value: unknown): value is number => integer(value, 0, MAX_CLOUD_PROSTHETIC_CENTS);
const actor = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128
  && value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value);
const status = (value: unknown): value is CloudProstheticStatus => ['pending', 'in_progress', 'ready', 'delivered'].includes(value as string);
const text = (value: unknown, max: number, multiline = false): value is string => typeof value === 'string'
  && value.length <= max && (multiline || value.trim() === value)
  && !(multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u : /[\u0000-\u001f\u007f]/u).test(value);
function invalid(): never { throw new CloudProstheticError('invalid'); }
function conflict(): never { throw new CloudProstheticError('conflict'); }
function unavailable(): never { throw new CloudProstheticError('unavailable'); }
function safeError(value: unknown): CloudProstheticError {
  try { if ((value instanceof CloudProstheticError || value instanceof CloudOperationIntentError)
    && ['invalid', 'conflict', 'unavailable'].includes(value.code)) return new CloudProstheticError(value.code); } catch { /* fixed errors only */ }
  return new CloudProstheticError('unavailable');
}
function fields(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  const keys = Reflect.ownKeys(value);
  if (required.some(key => !keys.includes(key)) || keys.some(key => typeof key !== 'string' || ![...required, ...optional].includes(key))) invalid();
  const result: Record<string, unknown> = {};
  for (const key of keys as string[]) {
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (!property || !('value' in property) || !property.enumerable) invalid();
    result[key] = property.value;
  }
  return result;
}
function array(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max || Reflect.ownKeys(value).length !== value.length + 1) invalid();
  return Array.from({ length: value.length }, (_, index) => {
    const property = Object.getOwnPropertyDescriptor(value, String(index));
    if (!property || !('value' in property) || !property.enumerable) invalid(); return property.value;
  });
}
function day(value: unknown): value is string {
  if (typeof value !== 'string' || value.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || value < '1900-01-01' || value > '9999-12-31') return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function timestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.length !== 24 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !day(value.slice(0, 10))) return false;
  const date = new Date(value); return Number.isFinite(date.getTime()) && date.toISOString() === value;
}
function teeth(value: unknown): string[] {
  const result = array(value, 32);
  if (result.some(id => typeof id !== 'string' || id.length > 3 || !parseCompositeToothId(id)) || new Set(result).size !== result.length) invalid();
  return result as string[];
}
function sum(values: readonly number[]) { const value = values.reduce((total, item) => total + item, 0); if (!money(value)) invalid(); return value; }
function cost(snapshot: CloudProstheticSnapshot) { const value = snapshot.unitCostCents * (snapshot.billingBasis === 'whole-case' ? 1 : snapshot.units); if (!money(value)) invalid(); return value; }
export function prepareCloudProstheticCommand(value: unknown): CloudProstheticCommand {
  try {
    const baseKeys = ['operationId', 'labId', 'expectedLabAccountRevision', 'createdAt', 'action'];
    const item = fields(value, baseKeys, ['patientId', 'expectedPatientRevision', 'serviceId', 'expectedCatalogRevision', 'expectedRoutingRevision', 'expectedLabRevision',
      'kind', 'units', 'teethIds', 'date', 'deliveryExpectedDate', 'patientUnitPriceCents', 'includeExamination', 'paidCents', 'note',
      'caseId', 'expectedCaseRevision', 'status', 'allocations']);
    if (!uuid(item.operationId) || !uuid(item.labId) || !integer(item.expectedLabAccountRevision, 0, MAX_REVISION - 1) || !timestamp(item.createdAt)) invalid();
    const base = { operationId: item.operationId, labId: item.labId, expectedLabAccountRevision: item.expectedLabAccountRevision, createdAt: item.createdAt };
    if (item.action === 'create') {
      fields(value, [...baseKeys, 'patientId', 'expectedPatientRevision', 'serviceId', 'expectedCatalogRevision', 'expectedRoutingRevision', 'expectedLabRevision',
        'kind', 'units', 'teethIds', 'date', 'deliveryExpectedDate', 'patientUnitPriceCents', 'includeExamination', 'paidCents', 'note']);
      if (!uuid(item.patientId) || !uuid(item.serviceId) || !integer(item.expectedPatientRevision, 0, MAX_REVISION - 1)
        || !integer(item.expectedCatalogRevision, 1) || !integer(item.expectedRoutingRevision, 1) || !integer(item.expectedLabRevision, 1)
        || !['fixed', 'removable'].includes(item.kind as string) || !integer(item.units, 1, 100) || !money(item.patientUnitPriceCents)
        || !money(item.patientUnitPriceCents * item.units) || typeof item.includeExamination !== 'boolean' || !money(item.paidCents)
        || !day(item.date) || item.deliveryExpectedDate !== null && (!day(item.deliveryExpectedDate) || item.deliveryExpectedDate < item.date)
        || !text(item.note, 2000, true)) invalid();
      const selected = teeth(item.teethIds);
      if (item.kind === 'fixed' && selected.length && selected.length !== item.units) invalid();
      return { ...base, action: 'create', patientId: item.patientId, expectedPatientRevision: item.expectedPatientRevision,
        serviceId: item.serviceId, expectedCatalogRevision: item.expectedCatalogRevision, expectedRoutingRevision: item.expectedRoutingRevision,
        expectedLabRevision: item.expectedLabRevision, kind: item.kind as 'fixed' | 'removable', units: item.units, teethIds: selected,
        date: item.date, deliveryExpectedDate: item.deliveryExpectedDate as string | null, patientUnitPriceCents: item.patientUnitPriceCents,
        includeExamination: item.includeExamination, paidCents: item.paidCents, note: item.note };
    }
    if (item.action === 'progress') {
      fields(value, [...baseKeys, 'caseId', 'expectedCaseRevision', 'status', 'note']);
      if (!base.expectedLabAccountRevision || !uuid(item.caseId) || !integer(item.expectedCaseRevision, 1, MAX_REVISION - 1)
        || !status(item.status) || !text(item.note, 2000, true)) invalid();
      return { ...base, action: 'progress', caseId: item.caseId, expectedCaseRevision: item.expectedCaseRevision, status: item.status, note: item.note };
    }
    if (item.action === 'lab-payment') {
      fields(value, [...baseKeys, 'date', 'note', 'allocations']);
      if (!base.expectedLabAccountRevision || !day(item.date) || !text(item.note, 1000, true)) invalid();
      const ids = new Set<string>();
      const allocations = array(item.allocations, MAX_CLOUD_LAB_PAYMENT_ALLOCATIONS).map(value => {
        const row = fields(value, ['caseId', 'expectedRevision', 'amountCents']);
        if (!uuid(row.caseId) || ids.has(row.caseId) || !integer(row.expectedRevision, 1, MAX_REVISION - 1) || !money(row.amountCents) || !row.amountCents) invalid();
        ids.add(row.caseId); return { caseId: row.caseId, expectedRevision: row.expectedRevision, amountCents: row.amountCents };
      });
      if (!allocations.length) invalid(); sum(allocations.map(item => item.amountCents));
      return { ...base, action: 'lab-payment', date: item.date, note: item.note, allocations };
    }
    return invalid();
  } catch { return invalid(); }
}
export function parseCloudProstheticCase(value: unknown): CloudProstheticCase {
  try {
    const item = fields(value, ['schemaVersion', 'clinicId', 'recordId', 'patientId', 'sessionId', 'fileNo', 'labId', 'revision', 'lastOperationId',
      'totalCostCents', 'paidCostCents', 'status', 'note', 'snapshot']);
    const snap = fields(item.snapshot, ['serviceId', 'serviceName', 'catalogRevision', 'configuredPatientUnitPriceCents', 'patientUnitPriceCents', 'examinationCents',
      'kind', 'units', 'teethIds', 'date', 'deliveryExpectedDate', 'labName', 'materialId', 'materialName', 'materialCategory', 'unitLabel', 'billingBasis',
      'labRevision', 'routingRevision', 'unitCostCents']);
    if (item.schemaVersion !== 1 || item.clinicId !== 'main' || !uuid(item.recordId) || item.sessionId !== item.recordId || !uuid(item.patientId)
      || !integer(item.fileNo, 1) || !uuid(item.labId) || !integer(item.revision, 1) || !uuid(item.lastOperationId)
      || !money(item.totalCostCents) || !money(item.paidCostCents) || item.paidCostCents > item.totalCostCents || !status(item.status) || !text(item.note, 2000, true)
      || !uuid(snap.serviceId) || !text(snap.serviceName, 200) || !snap.serviceName || !integer(snap.catalogRevision, 1)
      || !money(snap.configuredPatientUnitPriceCents) || !money(snap.patientUnitPriceCents) || !money(snap.examinationCents)
      || !['fixed', 'removable'].includes(snap.kind as string) || !integer(snap.units, 1, 100) || !day(snap.date)
      || snap.deliveryExpectedDate !== null && (!day(snap.deliveryExpectedDate) || snap.deliveryExpectedDate < snap.date)
      || !text(snap.labName, 200) || !snap.labName || !uuid(snap.materialId) || !text(snap.materialName, 200) || !snap.materialName
      || !['fixed', 'removable', 'other'].includes(snap.materialCategory as string) || snap.materialCategory !== 'other' && snap.materialCategory !== snap.kind
      || !text(snap.unitLabel, 80) || !snap.unitLabel || !['per-unit', 'whole-case'].includes(snap.billingBasis as string)
      || !integer(snap.labRevision, 1) || !integer(snap.routingRevision, 1) || !money(snap.unitCostCents)) invalid();
    const selected = teeth(snap.teethIds);
    if (snap.kind === 'fixed' && selected.length && selected.length !== snap.units) invalid();
    const snapshot: CloudProstheticSnapshot = { serviceId: snap.serviceId, serviceName: snap.serviceName, catalogRevision: snap.catalogRevision,
      configuredPatientUnitPriceCents: snap.configuredPatientUnitPriceCents, patientUnitPriceCents: snap.patientUnitPriceCents, examinationCents: snap.examinationCents,
      kind: snap.kind as 'fixed' | 'removable', units: snap.units, teethIds: selected, date: snap.date, deliveryExpectedDate: snap.deliveryExpectedDate as string | null,
      labName: snap.labName, materialId: snap.materialId, materialName: snap.materialName, materialCategory: snap.materialCategory as CloudProstheticSnapshot['materialCategory'],
      unitLabel: snap.unitLabel, billingBasis: snap.billingBasis as CloudProstheticSnapshot['billingBasis'], labRevision: snap.labRevision,
      routingRevision: snap.routingRevision, unitCostCents: snap.unitCostCents };
    if (cost(snapshot) !== item.totalCostCents) invalid(); sum([snapshot.patientUnitPriceCents * snapshot.units, snapshot.examinationCents]);
    return { schemaVersion: 1, clinicId: 'main', recordId: item.recordId, patientId: item.patientId, sessionId: item.recordId, fileNo: item.fileNo, labId: item.labId,
      revision: item.revision, lastOperationId: item.lastOperationId, totalCostCents: item.totalCostCents, paidCostCents: item.paidCostCents,
      status: item.status, note: item.note, snapshot };
  } catch { return invalid(); }
}
export function parseCloudLabAccount(value: unknown): CloudLabAccount {
  try {
    const item = fields(value, ['schemaVersion', 'clinicId', 'labId', 'revision', 'lastOperationId', 'totalCostCents', 'paidCostCents', 'caseCount', 'paymentCount']);
    if (item.schemaVersion !== 1 || item.clinicId !== 'main' || !uuid(item.labId) || !integer(item.revision, 1) || !uuid(item.lastOperationId)
      || !money(item.totalCostCents) || !money(item.paidCostCents) || item.paidCostCents > item.totalCostCents
      || !integer(item.caseCount, 1) || !integer(item.paymentCount) || item.caseCount + item.paymentCount > item.revision) invalid();
    return { schemaVersion: 1, clinicId: 'main', labId: item.labId, revision: item.revision, lastOperationId: item.lastOperationId,
      totalCostCents: item.totalCostCents, paidCostCents: item.paidCostCents, caseCount: item.caseCount, paymentCount: item.paymentCount };
  } catch { return invalid(); }
}
export function parseCloudLabPayment(value: unknown): CloudLabPayment {
  try {
    const item = fields(value, ['schemaVersion', 'clinicId', 'receiptId', 'labId', 'amountCents', 'date', 'note', 'createdAt', 'actorUid', 'paymentMethod', 'allocations']);
    if (item.schemaVersion !== 1 || item.clinicId !== 'main' || !uuid(item.receiptId) || !uuid(item.labId) || !money(item.amountCents) || !item.amountCents
      || !day(item.date) || !text(item.note, 1000, true) || !timestamp(item.createdAt) || !actor(item.actorUid) || item.paymentMethod !== 'cash') invalid();
    const ids = new Set<string>();
    const allocations = array(item.allocations, MAX_CLOUD_LAB_PAYMENT_ALLOCATIONS).map(value => {
      const row = fields(value, ['caseId', 'amountCents']);
      if (!uuid(row.caseId) || ids.has(row.caseId) || !money(row.amountCents) || !row.amountCents) invalid();
      ids.add(row.caseId); return { caseId: row.caseId, amountCents: row.amountCents };
    });
    if (!allocations.length || sum(allocations.map(item => item.amountCents)) !== item.amountCents) invalid();
    return { schemaVersion: 1, clinicId: 'main', receiptId: item.receiptId, labId: item.labId, amountCents: item.amountCents,
      date: item.date, note: item.note, createdAt: item.createdAt, actorUid: item.actorUid, paymentMethod: 'cash', allocations };
  } catch { return invalid(); }
}
export function prepareCloudProstheticPageInput(value: unknown): { labId: string; afterId: string | null; limit: number } {
  try {
    const item = fields(value, ['labId'], ['afterId', 'limit']), afterId = item.afterId ?? null, limit = item.limit === undefined ? 25 : item.limit;
    if (!uuid(item.labId) || item.afterId !== undefined && item.afterId !== null && !uuid(item.afterId) || !integer(limit, 1, 50)) invalid();
    return { labId: item.labId, afterId: afterId as string | null, limit };
  } catch { return invalid(); }
}
/** Pure view of explicitly supplied confirmed clinical records, NOT a loader
 * or snapshot fence. Callers must fence patient accounts as well as lab data
 * before aggregating this projection across the clinic. */
export function projectCloudProstheticFinancials(input: { item: CloudProstheticCase; session: CloudClinicalSession; account: CloudClinicalAccount }) {
  try {
    const request = fields(input, ['item', 'session', 'account']);
    const item = parseCloudProstheticCase(request.item), session = parseCloudClinicalSession(request.session), account = parseCloudClinicalAccount(request.account);
    assertPatientSessionLink(item, session);
    if (account.patientId !== item.patientId || account.fileNo !== item.fileNo
      || account.revision < session.revision || account.totalCents < session.totalCents || account.paidCents < session.paidCents
    ) invalid();
    return { patientTotalCents: session.totalCents, patientPaidCents: session.paidCents, patientRemainingCents: session.totalCents - session.paidCents,
      patientFileRemainingCents: account.totalCents - account.paidCents, labTotalCents: item.totalCostCents, labPaidCents: item.paidCostCents,
      labRemainingCents: item.totalCostCents - item.paidCostCents,
      reservedForLabCents: Math.max(0, Math.min(session.paidCents, item.totalCostCents) - item.paidCostCents),
      availableToClinicCents: Math.max(0, session.paidCents - item.totalCostCents) };
  } catch { return invalid(); }
}
function assertPatientSessionLink(item: CloudProstheticCase, session: CloudClinicalSession): void {
  const snapshot = item.snapshot, publicSnapshot = session.data.prosthetic;
  if (session.sessionId !== item.sessionId || session.patientId !== item.patientId || session.fileNo !== item.fileNo
    || session.data.prostheticCaseId !== item.recordId || session.data.type !== snapshot.serviceName || session.data.date !== snapshot.date
    || session.data.examinationCents !== snapshot.examinationCents || session.totalCents !== sum([snapshot.patientUnitPriceCents * snapshot.units, snapshot.examinationCents])
    || !publicSnapshot || publicSnapshot.kind !== snapshot.kind || publicSnapshot.material !== snapshot.serviceName
    || publicSnapshot.units !== snapshot.units || publicSnapshot.unitPriceCents !== snapshot.patientUnitPriceCents
    || session.data.services.length !== 1 || session.data.services[0]?.catalogServiceId !== snapshot.serviceId
    || session.data.services[0].id !== item.sessionId || session.data.services[0].name !== snapshot.serviceName
    || session.data.services[0].priceCents !== snapshot.patientUnitPriceCents * snapshot.units
    || session.data.services[0].tooth !== (snapshot.teethIds.length === 1 ? snapshot.teethIds[0] : null)
    || JSON.stringify(session.data.teethIds) !== JSON.stringify(snapshot.teethIds)) invalid();
}
export function parseCloudProstheticCommit(value: unknown, input: CloudProstheticCommand): CloudProstheticCommit {
  try {
    const command = prepareCloudProstheticCommand(input);
    const item = fields(value, ['status', 'operationId', 'action', 'labId', 'labRevision', 'patientId', 'caseId', 'fileNo', 'patientRevision', 'caseRevision']);
    if (!['committed', 'already-committed'].includes(item.status as string) || item.operationId !== command.operationId || item.action !== command.action
      || item.labId !== command.labId || item.labRevision !== command.expectedLabAccountRevision + 1
      || item.patientId !== (command.action === 'create' ? command.patientId : null)
      || item.caseId !== (command.action === 'create' ? command.operationId : command.action === 'progress' ? command.caseId : null)
      || item.patientRevision !== (command.action === 'create' ? command.expectedPatientRevision + 1 : null)
      || item.caseRevision !== (command.action === 'create' ? 1 : command.action === 'progress' ? command.expectedCaseRevision + 1 : null)
      || (command.action === 'create' ? !integer(item.fileNo, 1) : item.fileNo !== null)) invalid();
    return { status: item.status as CloudProstheticCommit['status'], operationId: command.operationId, action: command.action, labId: command.labId,
      labRevision: item.labRevision as number, patientId: item.patientId as string | null, caseId: item.caseId as string | null,
      fileNo: item.fileNo as number | null, patientRevision: item.patientRevision as number | null, caseRevision: item.caseRevision as number | null };
  } catch { return invalid(); }
}
const path = (collection: string, id: string | number) => `clinics/main/${collection}/${id}`;
async function sha256(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
export function createCloudProstheticRepository(adapter: CloudProstheticAdapter, options: CloudProstheticOptions = {}) {
  const digest = options.digest ?? sha256;
  const hash = async (value: string) => { const result = await digest(value); if (typeof result !== 'string' || result.length !== 64 || !/^[0-9a-f]{64}$/.test(result)) invalid(); return result; };
  const authorize = async () => { const uid = await adapter.authorizeOwner(); if (!actor(uid)) invalid(); return uid; };
  const reauthorize = async (uid: string) => { if (await authorize() !== uid) unavailable(); };
  const read = (key: string) => { if (!adapter.readRecord) return unavailable(); return adapter.readRecord(key); };
  function labAccount(value: unknown, labId: string) { if (value === null) return null; const result = parseCloudLabAccount(value); if (result.labId !== labId) invalid(); return result; }
  async function lab(labId: string, get: (key: string) => Promise<unknown | null>) {
    const value = await get(cloudLabDefinitionPath(labId)); if (value === null) conflict();
    return parseCloudLabDefinition(value, labId);
  }
  async function profile(patientId: string, tx: CloudProstheticTransaction, uid: string) {
    const raw = await tx.get(path('patientProfiles', patientId)); if (raw === null) conflict();
    const owner = parseCloudPatientRecord(raw);
    if (owner.recordId !== patientId || owner.phoneKey !== (owner.data.mobile ? await hash(`patient-phone-v1:${normalizeContactPhone(owner.data.mobile)}`) : null)) invalid();
    const index = fields(await tx.get(path('patientFiles', owner.fileNo)), ['schemaVersion', 'clinicId', 'fileNo', 'recordId']);
    if (index.schemaVersion !== 1 || index.clinicId !== 'main' || index.fileNo !== owner.fileNo || index.recordId !== patientId) invalid();
    await reauthorize(uid); return owner;
  }
  async function list<T extends CloudProstheticCase | CloudLabPayment>(input: CloudProstheticPageInput, kind: 'cases' | 'payments'): Promise<CloudProstheticPage<T>> {
    const prepared = prepareCloudProstheticPageInput(input), uid = await authorize();
    await lab(prepared.labId, read); await reauthorize(uid);
    const query = kind === 'cases' ? adapter.listCasesPage : adapter.listPaymentsPage;
    if (!query) unavailable();
    const raw = await query(prepared.labId, prepared.afterId, prepared.limit), records: T[] = []; let previous = prepared.afterId;
    for (const value of array(raw, prepared.limit)) {
      const row = fields(value, ['id', 'data']); if (!uuid(row.id) || previous !== null && row.id <= previous) invalid();
      const record = kind === 'cases' ? parseCloudProstheticCase(row.data) : parseCloudLabPayment(row.data);
      if (record.labId !== prepared.labId || ('recordId' in record ? record.recordId : record.receiptId) !== row.id) invalid();
      records.push(record as T); previous = row.id;
    }
    await reauthorize(uid); return { records, nextAfterId: records.length === prepared.limit ? previous : null };
  }
  return {
    async getCase(caseId: string): Promise<CloudProstheticCase | null> {
      try {
        if (!uuid(caseId)) invalid(); const uid = await authorize(), raw = await read(path('labCases', caseId));
        if (raw === null) { await reauthorize(uid); return null; }
        const result = parseCloudProstheticCase(raw); if (result.recordId !== caseId) invalid();
        const session = parseCloudClinicalSession(await read(path('patientSessions', result.sessionId)));
        assertPatientSessionLink(result, session);
        await reauthorize(uid); return result;
      } catch (error) { throw safeError(error); }
    },
    async getLabAccount(labId: string): Promise<CloudLabAccount | null> {
      try { if (!uuid(labId)) invalid(); const uid = await authorize(); await lab(labId, read);
        const result = labAccount(await read(path('labAccounts', labId)), labId); await reauthorize(uid); return result;
      } catch (error) { throw safeError(error); }
    },
    async listCases(input: CloudProstheticPageInput) { try { return await list<CloudProstheticCase>(input, 'cases'); } catch (error) { throw safeError(error); } },
    async listPayments(input: CloudProstheticPageInput) { try { return await list<CloudLabPayment>(input, 'payments'); } catch (error) { throw safeError(error); } },
    /** All pages, fenced against every case/payment/workflow mutation. Null is
     * unknown, never a zero balance. The explicit cap rejects partial totals. */
    async getLabSummary(input: { labId: string; month: string }): Promise<CloudLabFinancialSummary | null> {
      try {
        const request = fields(input, ['labId', 'month']);
        if (!uuid(request.labId) || typeof request.month !== 'string' || request.month.length !== 7 || !day(`${request.month}-01`)) invalid();
        const labId = request.labId, month = request.month, uid = await authorize(); await lab(labId, read);
        const before = labAccount(await read(path('labAccounts', labId)), labId);
        const cases: CloudProstheticCase[] = [], payments: CloudLabPayment[] = [];
        for (const kind of ['cases', 'payments'] as const) {
          let afterId: string | null = null;
          do {
            const page: CloudProstheticPage<CloudProstheticCase | CloudLabPayment> = await list({ labId, afterId, limit: 50 }, kind);
            await reauthorize(uid);
            if (kind === 'cases') cases.push(...page.records as CloudProstheticCase[]); else payments.push(...page.records as CloudLabPayment[]);
            if ((kind === 'cases' ? cases.length : payments.length) > MAX_CLOUD_LAB_HISTORY_RECORDS) unavailable();
            afterId = page.nextAfterId;
          } while (afterId !== null);
        }
        const after = labAccount(await read(path('labAccounts', labId)), labId); await reauthorize(uid);
        if (JSON.stringify(before) !== JSON.stringify(after)) conflict();
        if (before === null) { if (cases.length || payments.length) invalid(); return null; }
        const byCase = new Map(cases.map(item => [item.recordId, item]));
        const allocated = new Map<string, number>();
        for (const payment of payments) for (const row of payment.allocations) {
          if (!byCase.has(row.caseId)) invalid(); allocated.set(row.caseId, sum([allocated.get(row.caseId) ?? 0, row.amountCents]));
        }
        if (before.caseCount !== cases.length || before.paymentCount !== payments.length
          || before.totalCostCents !== sum(cases.map(item => item.totalCostCents))
          || before.paidCostCents !== sum(payments.map(item => item.amountCents))
          || cases.some(item => item.paidCostCents !== (allocated.get(item.recordId) ?? 0))) invalid();
        return { account: before, month, totalCostCents: before.totalCostCents, paidCostCents: before.paidCostCents,
          remainingCents: before.totalCostCents - before.paidCostCents, monthPaidCents: sum(payments.filter(item => item.date.startsWith(`${month}-`)).map(item => item.amountCents)),
          cases, payments };
      } catch (error) { throw safeError(error); }
    },
    async commit(input: CloudProstheticCommand): Promise<CloudProstheticCommit> {
      try {
        const command = prepareCloudProstheticCommand(input), uid = await authorize(), requestHash = await hash(JSON.stringify([uid, command]));
        const baseReceipt = { schemaVersion: 1, clinicId: 'main', operationId: command.operationId, actorUid: uid,
          action: command.action, labId: command.labId, labRevision: command.expectedLabAccountRevision + 1, createdAt: command.createdAt, requestHash,
          patientId: command.action === 'create' ? command.patientId : null, caseId: command.action === 'create' ? command.operationId : command.action === 'progress' ? command.caseId : null,
          patientRevision: command.action === 'create' ? command.expectedPatientRevision + 1 : null,
          caseRevision: command.action === 'create' ? 1 : command.action === 'progress' ? command.expectedCaseRevision + 1 : null };
        await reauthorize(uid);
        const result = await adapter.runTransaction<CloudProstheticCommit>(async tx => {
          await reauthorize(uid);
          const previous = await tx.get(path('prostheticOperations', command.operationId));
          const intent = await readCloudOperationIntentForCommit(tx, { actorUid: uid, kind: 'prosthetic', command }, { digest });
          if (intent.createdAt !== command.createdAt || intent.status !== (previous === null ? 'prepared' : 'committed')) conflict();
          if (previous !== null) {
            const receipt = fields(previous, [...Object.keys(baseReceipt), 'fileNo'],
              ['validationVersion', 'serviceIndex', 'routeIndex', 'materialIndex', 'totalAllocatedCents']);
            if (Object.keys(baseReceipt).some(key => receipt[key] !== baseReceipt[key as keyof typeof baseReceipt])
              || (command.action === 'create' ? !integer(receipt.fileNo, 1) : receipt.fileNo !== null)) conflict();
            // Historical v1 acknowledgements never read current prices/cases
            // or introduce missing witnesses. New v2 metadata is strict too.
            const metadata = Object.prototype.hasOwnProperty.call(receipt, 'validationVersion');
            if (metadata ? receipt.validationVersion !== 2
              || (command.action === 'create' ? !integer(receipt.serviceIndex, 0, 299) || !integer(receipt.routeIndex, 0, 99)
                || !integer(receipt.materialIndex, 0, 99) || receipt.totalAllocatedCents !== 0
                : receipt.serviceIndex !== null || receipt.routeIndex !== null || receipt.materialIndex !== null
                  || receipt.totalAllocatedCents !== (command.action === 'lab-payment' ? sum(command.allocations.map(row => row.amountCents)) : 0))
              : ['serviceIndex', 'routeIndex', 'materialIndex', 'totalAllocatedCents'].some(key => key in receipt)) conflict();
            await reauthorize(uid); return { status: 'already-committed', operationId: command.operationId, action: command.action, labId: command.labId,
              labRevision: baseReceipt.labRevision, patientId: baseReceipt.patientId, caseId: baseReceipt.caseId, fileNo: receipt.fileNo as number | null,
              patientRevision: baseReceipt.patientRevision, caseRevision: baseReceipt.caseRevision };
          }
          const definition = await lab(command.labId, key => tx.get(key));
          const current = labAccount(await tx.get(path('labAccounts', command.labId)), command.labId);
          if ((current?.revision ?? 0) !== command.expectedLabAccountRevision || !current && command.action !== 'create') conflict();
          if (await tx.get(path('labPayments', command.operationId)) !== null) conflict();
          const writes: [string, object][] = []; let fileNo: number | null = null;
          let serviceIndex: number | null = null, routeIndex: number | null = null, materialIndex: number | null = null;
          let charged = 0, paid = 0;
          if (command.action === 'create') {
            if (!definition.data.active || definition.revision !== command.expectedLabRevision) conflict();
            const catalogRaw = await tx.get('clinics/main/settings/serviceCatalog'), routingRaw = await tx.get(CLOUD_PROSTHETIC_ROUTING_PATH);
            if (catalogRaw === null || routingRaw === null) conflict();
            const catalog = parseCloudServiceCatalogRecord(catalogRaw), routing = parseCloudProstheticRouting(routingRaw);
            if (catalog.revision !== command.expectedCatalogRevision || routing.revision !== command.expectedRoutingRevision) conflict();
            const service = catalog.data.services.find(item => item.serviceId === command.serviceId), route = routing.data.routes.find(item => item.serviceId === command.serviceId);
            if (!service?.active || service.kind !== 'prosthetic' || service.priceCents === null || !route || route.labId !== command.labId) conflict();
            const material = definition.data.costs.find(item => item.materialId === route.materialId);
            if (!material?.active || material.unitCostCents === null || material.category !== 'other' && material.category !== command.kind) conflict();
            serviceIndex = catalog.data.services.indexOf(service); routeIndex = routing.data.routes.indexOf(route);
            materialIndex = definition.data.costs.indexOf(material);
            const owner = await profile(command.patientId, tx, uid); fileNo = owner.fileNo;
            const accountRaw = await tx.get(path('patientAccounts', command.patientId));
            const account = accountRaw === null ? null : parseCloudClinicalAccount(accountRaw);
            if (account && (account.patientId !== command.patientId || account.fileNo !== fileNo)) invalid();
            if ((account?.revision ?? 0) !== command.expectedPatientRevision) conflict();
            if (await tx.get(path('labCases', command.operationId)) !== null || await tx.get(path('patientSessions', command.operationId)) !== null
              || await tx.get(path('patientReceipts', command.operationId)) !== null || await tx.get(path('clinicalOperations', command.operationId)) !== null) conflict();
            const snapshot: CloudProstheticSnapshot = { serviceId: service.serviceId, serviceName: service.name, catalogRevision: catalog.revision,
              configuredPatientUnitPriceCents: service.priceCents, patientUnitPriceCents: command.patientUnitPriceCents,
              examinationCents: command.includeExamination ? catalog.data.examinationCents : 0, kind: command.kind, units: command.units, teethIds: [...command.teethIds],
              date: command.date, deliveryExpectedDate: command.deliveryExpectedDate, labName: definition.data.name,
              materialId: material.materialId, materialName: material.name, materialCategory: material.category, unitLabel: material.unitLabel,
              billingBasis: material.billingBasis, labRevision: definition.revision, routingRevision: routing.revision, unitCostCents: material.unitCostCents };
            charged = cost(snapshot); const patientTotal = sum([command.patientUnitPriceCents * command.units, snapshot.examinationCents]);
            if (command.paidCents > patientTotal) conflict();
            const nextCase = parseCloudProstheticCase({ schemaVersion: 1, clinicId: 'main', recordId: command.operationId, sessionId: command.operationId,
              patientId: command.patientId, fileNo, labId: command.labId, revision: 1, lastOperationId: command.operationId,
              totalCostCents: charged, paidCostCents: 0, status: 'pending', note: command.note, snapshot });
            const nextAccount: CloudClinicalAccount = parseCloudClinicalAccount({ schemaVersion: 1, clinicId: 'main', patientId: command.patientId, fileNo,
              revision: command.expectedPatientRevision + 1, lastOperationId: command.operationId, totalCents: sum([account?.totalCents ?? 0, patientTotal]),
              paidCents: sum([account?.paidCents ?? 0, command.paidCents]), sessionCount: (account?.sessionCount ?? 0) + 1 });
            const session: CloudClinicalSession = parseCloudClinicalSession({ schemaVersion: 1, clinicId: 'main', patientId: command.patientId, fileNo, sessionId: command.operationId,
              revision: 1, lastOperationId: command.operationId, totalCents: patientTotal, paidCents: command.paidCents,
              data: { type: service.name, date: command.date, teethIds: command.teethIds, services: [{ id: command.operationId, name: service.name,
                priceCents: command.patientUnitPriceCents * command.units, tooth: command.teethIds.length === 1 ? command.teethIds[0] : null, catalogServiceId: command.serviceId }],
                examinationCents: snapshot.examinationCents, notes: command.note, treatmentStage: 'first', rootCanalStatus: '', visitStatus: 'follow_up',
                prostheticCaseId: command.operationId, prosthetic: { kind: command.kind, material: service.name, units: command.units, unitPriceCents: command.patientUnitPriceCents } } });
            writes.push([path('patientAccounts', command.patientId), nextAccount], [path('patientSessions', command.operationId), session], [path('labCases', command.operationId), nextCase]);
            if (command.paidCents > 0) {
              const cash: CloudClinicalReceipt = parseCloudClinicalReceipt({ schemaVersion: 1, clinicId: 'main', receiptId: command.operationId, patientId: command.patientId,
                sessionId: command.operationId, fileNo, amountCents: command.paidCents, date: command.date, note: '', createdAt: command.createdAt, actorUid: uid, paymentMethod: 'cash' });
              writes.push([path('patientReceipts', command.operationId), cash]);
            }
          } else if (command.action === 'progress') {
            const item = parseCloudProstheticCase(await tx.get(path('labCases', command.caseId)));
            if (item.recordId !== command.caseId || item.labId !== command.labId || item.revision !== command.expectedCaseRevision) conflict();
            writes.push([path('labCases', item.recordId), parseCloudProstheticCase({ ...item, revision: item.revision + 1, lastOperationId: command.operationId, status: command.status, note: command.note })]);
          } else {
            const allocations: CloudLabPayment['allocations'] = [];
            for (const allocation of command.allocations) {
              const item = parseCloudProstheticCase(await tx.get(path('labCases', allocation.caseId)));
              if (item.recordId !== allocation.caseId || item.labId !== command.labId || item.revision !== allocation.expectedRevision
                || allocation.amountCents > item.totalCostCents - item.paidCostCents) conflict();
              allocations.push({ caseId: item.recordId, amountCents: allocation.amountCents });
              writes.push([path('labCases', item.recordId), parseCloudProstheticCase({ ...item, revision: item.revision + 1,
                lastOperationId: command.operationId, paidCostCents: sum([item.paidCostCents, allocation.amountCents]) })]);
            }
            paid = sum(allocations.map(item => item.amountCents));
            if (paid > current!.totalCostCents - current!.paidCostCents) conflict();
            writes.push([path('labPayments', command.operationId), parseCloudLabPayment({ schemaVersion: 1, clinicId: 'main', receiptId: command.operationId,
              labId: command.labId, amountCents: paid, date: command.date, note: command.note, createdAt: command.createdAt, actorUid: uid, paymentMethod: 'cash', allocations })]);
            for (let index = 0; index * CLOUD_LAB_PAYMENT_PROOF_ROWS < command.allocations.length; index++) {
              const key = cloudProstheticPaymentProofPath(command.operationId, index);
              if (await tx.get(key) !== null) conflict();
              const rows = command.allocations.slice(index * CLOUD_LAB_PAYMENT_PROOF_ROWS, (index + 1) * CLOUD_LAB_PAYMENT_PROOF_ROWS);
              writes.push([key, { schemaVersion: 1, clinicId: 'main', operationId: command.operationId, labId: command.labId,
                index, rows, caseIds: rows.map(row => row.caseId), subtotalCents: sum(rows.map(row => row.amountCents)) }]);
            }
          }
          const nextLab = parseCloudLabAccount({ schemaVersion: 1, clinicId: 'main', labId: command.labId, revision: baseReceipt.labRevision,
            lastOperationId: command.operationId, totalCostCents: sum([current?.totalCostCents ?? 0, charged]), paidCostCents: sum([current?.paidCostCents ?? 0, paid]),
            caseCount: (current?.caseCount ?? 0) + (command.action === 'create' ? 1 : 0), paymentCount: (current?.paymentCount ?? 0) + (command.action === 'lab-payment' ? 1 : 0) });
          await reauthorize(uid);
          // No read can occur below this boundary. Partial writes/receipts and
          // cross-ledger financial changes must also be rejected by Rules.
          for (const [key, value] of writes) tx.set(key, value);
          tx.set(path('labAccounts', command.labId), nextLab);
          tx.set(path('prostheticOperations', command.operationId), { ...baseReceipt, fileNo, validationVersion: 2,
            serviceIndex, routeIndex, materialIndex, totalAllocatedCents: paid });
          markCloudOperationIntentCommitted(tx, intent);
          return { status: 'committed', operationId: command.operationId, action: command.action, labId: command.labId, labRevision: nextLab.revision,
            patientId: baseReceipt.patientId, caseId: baseReceipt.caseId, fileNo, patientRevision: baseReceipt.patientRevision, caseRevision: baseReceipt.caseRevision };
        });
        await reauthorize(uid); return parseCloudProstheticCommit(result, command);
      } catch (error) { throw safeError(error); }
    },
  };
}
export type CloudProstheticRepository = ReturnType<typeof createCloudProstheticRepository>;
