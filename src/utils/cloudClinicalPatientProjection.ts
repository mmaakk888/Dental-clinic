import type { Patient, Session } from '../types';
import { parseCloudPatientRecord, type CloudPatientRecord } from './cloudPatientRepository';
import { CloudClinicalError, parseCloudClinicalAccount, parseCloudClinicalReceipt, parseCloudClinicalSession,
  type CloudClinicalAccount, type CloudClinicalPage, type CloudClinicalReceipt, type CloudClinicalRepository,
  type CloudClinicalSession } from './cloudClinicalRepository';

export interface CloudClinicalPatientSnapshot {
  profile: CloudPatientRecord;
  /** Public file number is presentation only. Commands use patientRecordId. */
  patient: Patient;
  patientRecordId: string;
  accountRevision: number;
  totalCents: number;
  paidCents: number;
}
function fail(): never { throw new CloudClinicalError('unavailable'); }
function invalid(): never { throw new CloudClinicalError('invalid'); }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const validId = (value: unknown): value is string => typeof value === 'string' && value.length === 36 && UUID.test(value);
const MAX_RECORDS = 2000;
const PAGE_SIZE = 50;
function dense(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > MAX_RECORDS || Reflect.ownKeys(value).length !== value.length + 1) invalid();
  return Array.from({ length: value.length }, (_, index) => {
    const property = Object.getOwnPropertyDescriptor(value, String(index));
    if (!property || !('value' in property) || !property.enumerable) invalid();
    return property.value;
  });
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

/** Pure presentation projection, NOT authorization or proof of query coverage.
 * Caller must supply COMPLETE, fenced history (loadCloudClinicalPatient does
 * this). Never pass a profile or one loaded page with invented empty history.
 * All amounts originate in validated integer piastres; cash is receipts only.
 * No SDK, local storage, private lab fields or historical fallback is used. */
export function projectCloudClinicalPatient(profileValue: unknown, accountValue: unknown,
  sessionsValue: unknown, receiptsValue: unknown): CloudClinicalPatientSnapshot {
  try {
    const profile = parseCloudPatientRecord(profileValue);
    const account = accountValue === null ? null : parseCloudClinicalAccount(accountValue);
    const sessions = dense(sessionsValue).map(parseCloudClinicalSession);
    const receipts = dense(receiptsValue).map(parseCloudClinicalReceipt);
    if (account && (account.patientId !== profile.recordId || account.fileNo !== profile.fileNo)) invalid();
    // A null account is unknown by itself. Only a fully read, empty session AND
    // receipt history may be projected as a genuinely new clinical file.
    if (!account && (sessions.length || receipts.length)) invalid();
    const byId = new Map<string, CloudClinicalSession>();
    let charged = 0, collected = 0, revisions = 0;
    for (const session of sessions) {
      if (session.patientId !== profile.recordId || session.fileNo !== profile.fileNo || byId.has(session.sessionId)) invalid();
      byId.set(session.sessionId, session);
      charged += session.totalCents; collected += session.paidCents; revisions += session.revision;
    }
    if (account && (sessions.length !== account.sessionCount || charged !== account.totalCents
      || collected !== account.paidCents || revisions !== account.revision
      || !sessions.some(session => session.lastOperationId === account.lastOperationId))) invalid();
    const receiptIds = new Set<string>(), bySession = new Map<string, CloudClinicalReceipt[]>();
    for (const receipt of receipts) {
      if (receipt.patientId !== profile.recordId || receipt.fileNo !== profile.fileNo
        || receiptIds.has(receipt.receiptId) || !byId.has(receipt.sessionId)) invalid();
      receiptIds.add(receipt.receiptId);
      const list = bySession.get(receipt.sessionId) ?? [];
      list.push(receipt); bySession.set(receipt.sessionId, list);
    }
    const projected: Session[] = sessions.map((session): Session => {
      const cash = (bySession.get(session.sessionId) ?? []).sort((a, b) =>
        a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt) || a.receiptId.localeCompare(b.receiptId));
      if (cash.reduce((sum, receipt) => sum + receipt.amountCents, 0) !== session.paidCents) invalid();
      return {
        id: session.sessionId, type: session.data.type, date: session.data.date,
        tooth: session.data.teethIds.length === 1 ? session.data.teethIds[0] : null,
        teethIds: [...session.data.teethIds],
        amount: session.totalCents / 100, paid: session.paidCents / 100,
        remain: (session.totalCents - session.paidCents) / 100,
        examinationFee: session.data.examinationCents / 100,
        treatmentFee: (session.totalCents - session.data.examinationCents) / 100,
        services: session.data.services.map(row => ({ id: row.id, name: row.name, price: row.priceCents / 100, tooth: row.tooth,
          ...('catalogServiceId' in row ? { catalogServiceId: row.catalogServiceId } : {}) })),
        visitNotes: session.data.notes, treatmentStage: session.data.treatmentStage,
        ...(session.data.rootCanalStatus ? { rootCanalStatus: session.data.rootCanalStatus } : {}),
        visitStatus: session.data.visitStatus, paymentMethod: 'cash',
        ...(cash.length ? { payDate: cash[cash.length - 1].date } : {}),
        paymentsLog: cash.map(receipt => ({ id: receipt.receiptId, amount: receipt.amountCents / 100,
          date: receipt.date, note: receipt.note, paymentMethod: 'cash', recordedBy: receipt.actorUid, createdAt: receipt.createdAt })),
      };
    }).sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
    return freeze({ profile, patientRecordId: profile.recordId, accountRevision: account?.revision ?? 0,
      totalCents: charged, paidCents: collected,
      patient: { id: String(profile.fileNo), ...profile.data, sessions: projected, payments: [] } });
  } catch { return invalid(); }
}

function pageRows<T extends CloudClinicalSession | CloudClinicalReceipt>(value: CloudClinicalPage<T>,
  after: string | null, kind: 'sessions' | 'receipts'): { records: T[]; next: string | null } {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 2 || !keys.includes('records') || !keys.includes('nextAfterId')) fail();
  const properties = ['records', 'nextAfterId'].map(key => Object.getOwnPropertyDescriptor(value, key));
  if (properties.some(property => !property || !('value' in property) || !property.enumerable)) fail();
  const records = dense(properties[0]!.value);
  if (records.length > PAGE_SIZE) fail();
  let previous = after;
  const parsed = records.map(item => {
    const result = kind === 'sessions' ? parseCloudClinicalSession(item) : parseCloudClinicalReceipt(item);
    const id = kind === 'sessions' ? (result as CloudClinicalSession).sessionId : (result as CloudClinicalReceipt).receiptId;
    if (previous !== null && id <= previous) fail();
    previous = id; return result as T;
  });
  const next = parsed.length === PAGE_SIZE ? previous : null;
  if (properties[1]!.value !== next) fail();
  return { records: parsed, next };
}

/** Full selected-file read only, never a clinic-wide financial aggregate.
 * Repeated profile/account fences detect concurrent changes; correctness also
 * requires future Rules to couple every session/receipt to its account revision
 * and forbid deletion. No such Rules are live yet. Oversized histories fail
 * explicitly instead of showing partial financial totals. */
export async function loadCloudClinicalPatient(repository: CloudClinicalRepository, patientId: string,
  assertActive: () => void = () => undefined): Promise<CloudClinicalPatientSnapshot> {
  try {
    if (!validId(patientId)) invalid();
    const read = async <T>(work: () => Promise<T>) => {
      assertActive(); const result = await work(); assertActive(); return result;
    };
    const profile = parseCloudPatientRecord(await read(() => repository.getProfile(patientId)));
    if (profile.recordId !== patientId) fail();
    const firstValue = await read(() => repository.getAccount(patientId));
    const first: CloudClinicalAccount | null = firstValue === null ? null : parseCloudClinicalAccount(firstValue);
    async function all<T extends CloudClinicalSession | CloudClinicalReceipt>(kind: 'sessions' | 'receipts') {
      const records: T[] = []; let after: string | null = null;
      do {
        const result = await read<CloudClinicalPage<CloudClinicalSession | CloudClinicalReceipt>>(() => kind === 'sessions'
          ? repository.listSessions({ patientId, afterId: after, limit: PAGE_SIZE })
          : repository.listReceipts({ patientId, afterId: after, limit: PAGE_SIZE }));
        const page = pageRows(result as CloudClinicalPage<T>, after, kind);
        records.push(...page.records);
        if (records.length > MAX_RECORDS) fail();
        after = page.next;
      } while (after !== null);
      return records;
    }
    const sessions = await all<CloudClinicalSession>('sessions');
    const receipts = await all<CloudClinicalReceipt>('receipts');
    const lastValue = await read(() => repository.getAccount(patientId));
    const last = lastValue === null ? null : parseCloudClinicalAccount(lastValue);
    const latestProfile = parseCloudPatientRecord(await read(() => repository.getProfile(patientId)));
    if (JSON.stringify(profile) !== JSON.stringify(latestProfile) || JSON.stringify(first) !== JSON.stringify(last)) {
      throw new CloudClinicalError('conflict');
    }
    assertActive(); return projectCloudClinicalPatient(latestProfile, last, sessions, receipts);
  } catch (error) {
    let changed = false;
    try { changed = error instanceof CloudClinicalError && error.code === 'conflict'; } catch { /* Safe fixed error only. */ }
    if (changed) throw new CloudClinicalError('conflict');
    throw new CloudClinicalError('unavailable');
  }
}
