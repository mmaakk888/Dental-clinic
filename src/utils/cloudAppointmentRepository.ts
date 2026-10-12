import type { AppointmentStatus } from '../types';
import { normalizeContactPhone } from './clinicContacts';
import { CloudPatientError, parseCloudPatientRecord } from './cloudPatientRepository';
import { CloudOperationIntentError, readCloudOperationIntentForCommit,
  markCloudOperationIntentCommitted } from './cloudOperationIntent';

/** Prepared owner-only appointment contract, not an activated schedule. A day
 * index is one bounded atomic reservation set, never a partial financial/file
 * projection. Future Rules must enforce its receipt/intent/record coupling. */
export interface CloudAppointmentData {
  /** Contact/display snapshots may deliberately differ from a linked profile.
   * They are never identity proof, consent, or authoritative live file data. */
  patientRecordId: string | null; patientName: string; phone: string;
  date: string; time: string; durationMinutes: number; status: AppointmentStatus;
  reason: string; notes: string; doctorName: string; appointmentType: string;
  isFollowUp: boolean; isWalkIn: boolean;
}
export interface CloudAppointmentCommand {
  operationId: string; recordId: string; expectedRevision: number; createdAt: string; data: CloudAppointmentData;
}
export interface CloudAppointmentRecord {
  schemaVersion: 1; clinicId: 'main'; recordId: string; revision: number;
  lastOperationId: string; data: CloudAppointmentData;
}
export interface CloudAppointmentSlot { recordId: string; startMinute: number; endMinute: number }
export interface CloudAppointmentDay {
  schemaVersion: 1; clinicId: 'main'; recordId: string; revision: number;
  lastOperationId: string; slots: CloudAppointmentSlot[];
}
export interface CloudAppointmentCommit {
  status: 'committed' | 'already-committed'; recordId: string; revision: number;
}
export interface CloudAppointmentDayPageInput { date: string; afterId?: string | null; limit?: number }
export interface CloudAppointmentDayPage { records: CloudAppointmentRecord[]; nextAfterId: string | null }
export interface CloudAppointmentTransaction {
  get(path: string): Promise<unknown | null>; set(path: string, value: object): void;
}
export interface CloudAppointmentAdapter {
  authorizeOwner(): Promise<string>;
  runTransaction<T>(work: (transaction: CloudAppointmentTransaction) => Promise<T>): Promise<T>;
  readRecord?(path: string): Promise<unknown | null>;
  listDayPage?(date: string, afterId: string | null, limit: number): Promise<unknown>;
}
export interface CloudAppointmentOptions { digest?: (text: string) => Promise<string> }
export class CloudAppointmentError extends Error {
  constructor(public readonly code: 'invalid' | 'conflict' | 'unavailable') {
    super(({ invalid: 'بيانات الموعد أو جدول الحجز غير صالحة.',
      conflict: 'تغيّر الموعد أو الوقت محجوز؛ أعد قراءة الجدول قبل الحفظ.',
      unavailable: 'تعذر تأكيد الموعد من الخادم.' })[code]);
    this.name = 'CloudAppointmentError';
  }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_REVISION = 2_000_000_000;
export const MAX_CLOUD_APPOINTMENT_DAY_SLOTS = 200;
const STATES: AppointmentStatus[] = ['scheduled', 'confirmed', 'waiting', 'attended', 'cancelled', 'apologized', 'no_show'];
const OCCUPIED: AppointmentStatus[] = ['scheduled', 'confirmed', 'waiting', 'attended'];
const recordPath = (id: string) => `clinics/main/appointmentRecords/${id}`;
const dayPath = (day: string) => `clinics/main/appointmentDays/${day}`;
const receiptPath = (id: string) => `clinics/main/appointmentOperations/${id}`;
function invalid(): never { throw new CloudAppointmentError('invalid'); }
function conflict(): never { throw new CloudAppointmentError('conflict'); }
function unavailable(): never { throw new CloudAppointmentError('unavailable'); }
function safeError(value: unknown): CloudAppointmentError {
  try {
    if ((value instanceof CloudAppointmentError || value instanceof CloudOperationIntentError || value instanceof CloudPatientError)
      && ['invalid', 'conflict', 'unavailable'].includes(value.code)) return new CloudAppointmentError(value.code);
  } catch { /* Provider or hostile object details must never leave this module. */ }
  return new CloudAppointmentError('unavailable');
}
function fields(value: unknown, required: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== required.length || required.some(key => !keys.includes(key))) invalid();
  const result: Record<string, unknown> = {};
  for (const key of required) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) invalid();
    result[key] = descriptor.value;
  }
  return result;
}
const uuid = (value: unknown): value is string => typeof value === 'string' && value.length === 36 && UUID.test(value);
const integer = (value: unknown, min: number, max: number): value is number => typeof value === 'number'
  && Number.isSafeInteger(value) && !Object.is(value, -0) && value >= min && value <= max;
const actor = (value: unknown): value is string => typeof value === 'string' && value.length > 0
  && value.length <= 128 && value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value);
function text(value: unknown, max: number, multiline = false): value is string {
  return typeof value === 'string' && [...value].length <= max && (multiline || value === value.trim())
    && !(multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u
      : /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u).test(value);
}
function calendarDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01' || value > '9999-12-31') return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function timestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.length !== 24 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    || value < '1900-01-01T00:00:00.000Z' || value > '9999-12-31T23:59:59.999Z') return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}
const startMinute = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
function data(value: unknown): CloudAppointmentData {
  const item = fields(value, ['patientRecordId', 'patientName', 'phone', 'date', 'time', 'durationMinutes', 'status',
    'reason', 'notes', 'doctorName', 'appointmentType', 'isFollowUp', 'isWalkIn']);
  if (item.patientRecordId !== null && !uuid(item.patientRecordId) || !text(item.patientName, 200) || !item.patientName
    || typeof item.phone !== 'string' || item.phone !== '' && (!/^[1-9]\d{7,14}$/.test(item.phone) || normalizeContactPhone(item.phone) !== item.phone)
    || !calendarDay(item.date) || typeof item.time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(item.time)
    || !integer(item.durationMinutes, 1, 1440) || startMinute(item.time) + item.durationMinutes > 1440
    || !STATES.includes(item.status as AppointmentStatus) || !text(item.reason, 200) || !text(item.notes, 4000, true)
    || !text(item.doctorName, 200) || !text(item.appointmentType, 80)
    || typeof item.isFollowUp !== 'boolean' || typeof item.isWalkIn !== 'boolean') invalid();
  return { patientRecordId: item.patientRecordId as string | null, patientName: item.patientName, phone: item.phone,
    date: item.date, time: item.time, durationMinutes: item.durationMinutes, status: item.status as AppointmentStatus,
    reason: item.reason, notes: item.notes, doctorName: item.doctorName, appointmentType: item.appointmentType,
    isFollowUp: item.isFollowUp, isWalkIn: item.isWalkIn };
}
export function prepareCloudAppointmentCommand(value: unknown): CloudAppointmentCommand {
  try {
    const item = fields(value, ['operationId', 'recordId', 'expectedRevision', 'createdAt', 'data']);
    if (!uuid(item.operationId) || !uuid(item.recordId) || !integer(item.expectedRevision, 0, MAX_REVISION - 1) || !timestamp(item.createdAt)) invalid();
    return { operationId: item.operationId, recordId: item.recordId, expectedRevision: item.expectedRevision,
      createdAt: item.createdAt, data: data(item.data) };
  } catch { return invalid(); }
}
export function parseCloudAppointmentRecord(value: unknown): CloudAppointmentRecord {
  try {
    const item = fields(value, ['schemaVersion', 'clinicId', 'recordId', 'revision', 'lastOperationId', 'data']);
    if (item.schemaVersion !== 1 || item.clinicId !== 'main' || !uuid(item.recordId)
      || !integer(item.revision, 1, MAX_REVISION) || !uuid(item.lastOperationId)) invalid();
    return { schemaVersion: 1, clinicId: 'main', recordId: item.recordId, revision: item.revision,
      lastOperationId: item.lastOperationId, data: data(item.data) };
  } catch { return invalid(); }
}
export function parseCloudAppointmentDay(value: unknown): CloudAppointmentDay {
  try {
    const item = fields(value, ['schemaVersion', 'clinicId', 'recordId', 'revision', 'lastOperationId', 'slots']);
    if (item.schemaVersion !== 1 || item.clinicId !== 'main' || !calendarDay(item.recordId)
      || !integer(item.revision, 1, MAX_REVISION) || !uuid(item.lastOperationId) || !Array.isArray(item.slots)
      || item.slots.length > MAX_CLOUD_APPOINTMENT_DAY_SLOTS || Reflect.ownKeys(item.slots).length !== item.slots.length + 1) invalid();
    const rawSlots = item.slots; let previous = '';
    const slots = Array.from({ length: rawSlots.length }, (_, index): CloudAppointmentSlot => {
      const descriptor = Object.getOwnPropertyDescriptor(rawSlots, String(index));
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) invalid();
      const slot = fields(descriptor.value, ['recordId', 'startMinute', 'endMinute']);
      if (!uuid(slot.recordId) || slot.recordId <= previous || !integer(slot.startMinute, 0, 1439)
        || !integer(slot.endMinute, 1, 1440) || slot.endMinute <= slot.startMinute) invalid();
      previous = slot.recordId;
      return { recordId: slot.recordId, startMinute: slot.startMinute, endMinute: slot.endMinute };
    });
    const ordered = [...slots].sort((a, b) => a.startMinute - b.startMinute);
    if (ordered.some((slot, index) => index > 0 && ordered[index - 1].endMinute > slot.startMinute)) invalid();
    return { schemaVersion: 1, clinicId: 'main', recordId: item.recordId, revision: item.revision,
      lastOperationId: item.lastOperationId, slots };
  } catch { return invalid(); }
}
/** Full day history is distinct from occupied slots and includes inactive
 * appointments. A bounded page is never the complete schedule by itself. */
export function prepareCloudAppointmentDayPageInput(value: unknown): { date: string; afterId: string | null; limit: number } {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
    const keys = Reflect.ownKeys(value);
    if (!keys.includes('date') || keys.some(key => typeof key !== 'string' || !['date', 'afterId', 'limit'].includes(key))) invalid();
    const item: Record<string, unknown> = {};
    for (const key of keys as string[]) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) invalid(); item[key] = descriptor.value;
    }
    const afterId = item.afterId === undefined ? null : item.afterId, limit = item.limit === undefined ? 25 : item.limit;
    if (!calendarDay(item.date) || afterId !== null && !uuid(afterId) || !integer(limit, 1, 50)) invalid();
    return { date: item.date, afterId: afterId as string | null, limit };
  } catch { return invalid(); }
}
async function sha256(value: string) {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, '0')).join('');
}
const occupied = (item: CloudAppointmentData) => OCCUPIED.includes(item.status);
const slotFor = (id: string, item: CloudAppointmentData): CloudAppointmentSlot => ({ recordId: id,
  startMinute: startMinute(item.time), endMinute: startMinute(item.time) + item.durationMinutes });
export function createCloudAppointmentRepository(adapter: CloudAppointmentAdapter, options: CloudAppointmentOptions = {}) {
  const digest = options.digest ?? sha256;
  const authorize = async () => { const uid = await adapter.authorizeOwner(); if (!actor(uid)) invalid(); return uid; };
  const reauthorize = async (uid: string) => { if (await authorize() !== uid) unavailable(); };
  return {
    async get(recordId: string): Promise<CloudAppointmentRecord | null> {
      try {
        if (!uuid(recordId)) invalid(); const uid = await authorize(); if (!adapter.readRecord) unavailable();
        const raw = await adapter.readRecord(recordPath(recordId)); await reauthorize(uid);
        const result = raw === null ? null : parseCloudAppointmentRecord(raw);
        if (result && result.recordId !== recordId) invalid(); await reauthorize(uid); return result;
      } catch (error) { throw safeError(error); }
    },
    /** A null index is unknown/no stored reservations, not a verified schedule
     * or an implicit empty appointment collection. Read individual records. */
    async getDay(date: string): Promise<CloudAppointmentDay | null> {
      try {
        if (!calendarDay(date)) invalid(); const uid = await authorize(); if (!adapter.readRecord) unavailable();
        const raw = await adapter.readRecord(dayPath(date)); await reauthorize(uid);
        const result = raw === null ? null : parseCloudAppointmentDay(raw);
        if (result && result.recordId !== date) invalid(); await reauthorize(uid); return result;
      } catch (error) { throw safeError(error); }
    },
    async listDayPage(input: CloudAppointmentDayPageInput): Promise<CloudAppointmentDayPage> {
      try {
        const query = prepareCloudAppointmentDayPageInput(input), uid = await authorize();
        if (!adapter.listDayPage) unavailable();
        const raw = await adapter.listDayPage(query.date, query.afterId, query.limit); await reauthorize(uid);
        if (!Array.isArray(raw) || raw.length > query.limit || Reflect.ownKeys(raw).length !== raw.length + 1) invalid();
        const records: CloudAppointmentRecord[] = []; let previous = query.afterId;
        for (let index = 0; index < raw.length; index++) {
          const descriptor = Object.getOwnPropertyDescriptor(raw, String(index));
          if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) invalid();
          const row = fields(descriptor.value, ['id', 'data']);
          if (!uuid(row.id) || previous !== null && row.id <= previous) invalid();
          const record = parseCloudAppointmentRecord(row.data);
          if (record.recordId !== row.id || record.data.date !== query.date) invalid();
          records.push(record); previous = row.id;
        }
        await reauthorize(uid); return { records, nextAfterId: records.length === query.limit ? previous : null };
      } catch (error) { throw safeError(error); }
    },
    async commit(input: unknown): Promise<CloudAppointmentCommit> {
      try {
        const command = prepareCloudAppointmentCommand(input), uid = await authorize();
        const requestHash = await digest(JSON.stringify(['clinic-appointment-v1', uid, command]));
        await reauthorize(uid);
        if (typeof requestHash !== 'string' || !/^[0-9a-f]{64}$/.test(requestHash) || requestHash.length !== 64) invalid();
        const receipt = { schemaVersion: 1, clinicId: 'main', operationId: command.operationId, recordId: command.recordId,
          actorUid: uid, expectedRevision: command.expectedRevision, resultRevision: command.expectedRevision + 1,
          createdAt: command.createdAt, requestHash };
        const result = await adapter.runTransaction<CloudAppointmentCommit>(async transaction => {
          await reauthorize(uid);
          const checked: CloudAppointmentTransaction = {
            get: async path => { await reauthorize(uid); const raw = await transaction.get(path); await reauthorize(uid); return raw; },
            set: (path, value) => transaction.set(path, value),
          };
          const oldReceipt = await checked.get(receiptPath(command.operationId));
          const intent = await readCloudOperationIntentForCommit(checked, { actorUid: uid, kind: 'appointment', command }, { digest });
          await reauthorize(uid);
          if (intent.createdAt !== command.createdAt || intent.status !== (oldReceipt === null ? 'prepared' : 'committed')) conflict();
          if (oldReceipt !== null) {
            const old = fields(oldReceipt, Object.keys(receipt));
            if (Object.keys(receipt).some(key => old[key] !== receipt[key as keyof typeof receipt])) conflict();
            await reauthorize(uid);
            // Historical acknowledgement never reads or rewrites newer slots,
            // appointments or linked patient profiles.
            return { status: 'already-committed', recordId: command.recordId, revision: receipt.resultRevision };
          }
          const rawCurrent = await checked.get(recordPath(command.recordId));
          const current = rawCurrent === null ? null : parseCloudAppointmentRecord(rawCurrent);
          if (current && current.recordId !== command.recordId) invalid();
          if ((current?.revision ?? 0) !== command.expectedRevision) conflict();
          const dates = [...new Set([...(current ? [current.data.date] : []), command.data.date])].sort();
          const days = new Map<string, CloudAppointmentDay | null>();
          for (const date of dates) {
            const raw = await checked.get(dayPath(date)), day = raw === null ? null : parseCloudAppointmentDay(raw);
            if (day && day.recordId !== date) invalid(); days.set(date, day);
          }
          if (command.data.patientRecordId !== null) {
            const raw = await checked.get(`clinics/main/patientProfiles/${command.data.patientRecordId}`);
            if (raw === null) conflict();
            if (parseCloudPatientRecord(raw).recordId !== command.data.patientRecordId) invalid();
          }
          const oldOccupied = !!current && occupied(current.data), newOccupied = occupied(command.data);
          for (const [date, day] of days) {
            const own = day?.slots.find(slot => slot.recordId === command.recordId);
            if (current && date === current.data.date && oldOccupied) {
              const expected = slotFor(command.recordId, current.data);
              if (!own || own.startMinute !== expected.startMinute || own.endMinute !== expected.endMinute) invalid();
            } else if (own) invalid();
          }
          const nextDays: CloudAppointmentDay[] = [];
          for (const date of dates) {
            if (!(oldOccupied && current!.data.date === date || newOccupied && command.data.date === date)) continue;
            const previous = days.get(date)!;
            if (previous && previous.revision >= MAX_REVISION) unavailable();
            const slots = (previous?.slots ?? []).filter(slot => slot.recordId !== command.recordId);
            if (newOccupied && command.data.date === date) {
              const nextSlot = slotFor(command.recordId, command.data);
              if (slots.some(slot => slot.startMinute < nextSlot.endMinute && nextSlot.startMinute < slot.endMinute)) conflict();
              if (slots.length >= MAX_CLOUD_APPOINTMENT_DAY_SLOTS) conflict(); slots.push(nextSlot);
            }
            slots.sort((a, b) => a.recordId < b.recordId ? -1 : 1);
            nextDays.push(parseCloudAppointmentDay({ schemaVersion: 1, clinicId: 'main', recordId: date,
              revision: (previous?.revision ?? 0) + 1, lastOperationId: command.operationId, slots }));
          }
          const next = parseCloudAppointmentRecord({ schemaVersion: 1, clinicId: 'main', recordId: command.recordId,
            revision: receipt.resultRevision, lastOperationId: command.operationId, data: command.data });
          // Every record/day/profile/receipt/intent read precedes all writes.
          // Empty released days persist; no physical deletion or hidden seed.
          await reauthorize(uid);
          transaction.set(recordPath(command.recordId), next);
          for (const day of nextDays) transaction.set(dayPath(day.recordId), day);
          transaction.set(receiptPath(command.operationId), receipt);
          markCloudOperationIntentCommitted(transaction, intent);
          return { status: 'committed', recordId: command.recordId, revision: next.revision };
        });
        await reauthorize(uid);
        const ack = fields(result, ['status', 'recordId', 'revision']);
        if (!['committed', 'already-committed'].includes(ack.status as string) || ack.recordId !== command.recordId
          || ack.revision !== receipt.resultRevision) invalid();
        return { status: ack.status as CloudAppointmentCommit['status'], recordId: command.recordId, revision: receipt.resultRevision };
      } catch (error) { throw safeError(error); }
    },
  };
}
export type CloudAppointmentRepository = ReturnType<typeof createCloudAppointmentRepository>;
