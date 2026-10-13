import { normalizeContactPhone } from './clinicContacts';
import { normalizeDirectoryDigits } from './patientDirectory';
import { createCloudDurableWorkspaceController } from './cloudDurableWorkspaceController';
import { loadCloudAppointmentDay, type CloudAppointmentDaySnapshot } from './cloudAppointmentDaySnapshot';
import { prepareCloudAppointmentCommand, prepareCloudAppointmentDayPageInput,
  parseCloudAppointmentRecord, type CloudAppointmentCommand, type CloudAppointmentData, type CloudAppointmentRecord } from './cloudAppointmentRepository';
import type { CloudAppointmentCapability } from './cloudAppointmentOperatingCapability';

export interface CloudAppointmentWorkspaceDraft {
  recordId: string; expectedRevision: number;
  data: Omit<CloudAppointmentData, 'durationMinutes'> & { durationMinutes: string };
}
function fail(): never { throw new Error('بيانات الموعد غير صالحة.'); }
const uuid = (value: unknown): value is string => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value) && value.length === 36;
const textKeys = ['patientName', 'phone', 'date', 'time', 'durationMinutes', 'status', 'reason', 'notes', 'doctorName', 'appointmentType'] as const;
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail();
  const found = Reflect.ownKeys(value);
  if (found.length !== keys.length || found.some(key => typeof key !== 'string' || !keys.includes(key))) fail();
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) fail();
    result[key] = descriptor.value;
  }
  return result;
}
function parseDraft(value: unknown): CloudAppointmentWorkspaceDraft {
  const item = exact(value, ['recordId', 'expectedRevision', 'data']);
  if (!uuid(item.recordId) || typeof item.expectedRevision !== 'number'
    || !Number.isInteger(item.expectedRevision) || item.expectedRevision < 0 || item.expectedRevision >= 2_000_000_000
    || Object.is(item.expectedRevision, -0)) fail();
  const data = exact(item.data, [...textKeys, 'patientRecordId', 'isFollowUp', 'isWalkIn']);
  if (textKeys.some(key => typeof data[key] !== 'string' || (data[key] as string).length > (key === 'notes' ? 4000 : 200))
    || data.patientRecordId !== null && !uuid(data.patientRecordId)
    || typeof data.isFollowUp !== 'boolean' || typeof data.isWalkIn !== 'boolean') fail();
  return { recordId: item.recordId, expectedRevision: item.expectedRevision, data: data as unknown as CloudAppointmentWorkspaceDraft['data'] };
}
const draftFromRecord = (record: CloudAppointmentRecord): CloudAppointmentWorkspaceDraft => ({
  recordId: record.recordId, expectedRevision: record.revision,
  data: { ...record.data, durationMinutes: String(record.data.durationMinutes) },
});

/** Existing schedule workflow over the protected appointment contract. The
 * selected date is memory only; changing it is blocked by drafts/operations.
 * An appointment's contact is a snapshot, never a patient identity merge. */
export function createCloudAppointmentWorkspaceController(options: {
  ownerUid: string; isActive(): boolean; getCapability(): Promise<CloudAppointmentCapability>;
  initialDate: string; newId?: () => string; now?: () => string;
}) {
  let selectedDate = prepareCloudAppointmentDayPageInput({ date: options.initialDate }).date;
  const controller = createCloudDurableWorkspaceController<CloudAppointmentCommand, CloudAppointmentDaySnapshot,
    CloudAppointmentWorkspaceDraft, CloudAppointmentCapability, number>({
    kind: 'appointment', ownerUid: options.ownerUid, isActive: options.isActive, getCapability: options.getCapability,
    parseCommand: prepareCloudAppointmentCommand, parseDraft,
    draftFromCommand: command => ({ recordId: command.recordId, expectedRevision: command.expectedRevision,
      data: { ...command.data, durationMinutes: String(command.data.durationMinutes) } }),
    createCommand: (_snapshot, draft) => {
      const duration = normalizeDirectoryDigits(draft.data.durationMinutes.trim());
      if (!/^[1-9]\d{0,3}$/.test(duration)) fail();
      return prepareCloudAppointmentCommand({ operationId: (options.newId ?? (() => crypto.randomUUID()))(),
        recordId: draft.recordId, expectedRevision: draft.expectedRevision,
        createdAt: (options.now ?? (() => new Date().toISOString()))(), data: { ...draft.data,
          patientName: draft.data.patientName.trim(), phone: draft.data.phone.trim() ? normalizeContactPhone(draft.data.phone) : '',
          durationMinutes: Number(duration), reason: draft.data.reason.trim(), doctorName: draft.data.doctorName.trim(),
          appointmentType: draft.data.appointmentType.trim() } });
    },
    readSnapshot: async (cap, assertActive, command) => {
      let current: CloudAppointmentRecord | null = null;
      if (command) {
        assertActive(); const raw = await cap.repository.get(command.recordId); assertActive();
        if (raw === null) fail(); current = parseCloudAppointmentRecord(raw);
        if (current.recordId !== command.recordId) fail();
      }
      const date = current?.data.date ?? selectedDate;
      const snapshot = await loadCloudAppointmentDay(cap.repository, date, assertActive); assertActive();
      if (current && !snapshot.records.some(record => JSON.stringify(record) === JSON.stringify(current))) fail();
      selectedDate = snapshot.date; return snapshot;
    },
    commit: (cap, command) => cap.repository.commit(command),
    parseAcknowledgement: (value, command) => {
      const ack = exact(value, ['status', 'recordId', 'revision']);
      if (!['committed', 'already-committed'].includes(ack.status as string)
        || ack.recordId !== command.recordId || ack.revision !== command.expectedRevision + 1) fail();
      return ack.revision as number;
    },
    reconcile: (snapshot, command, revision) => {
      const current = snapshot.records.find(record => record.recordId === command.recordId);
      if (!current || current.revision < revision || current.revision === revision
        && (current.lastOperationId !== command.operationId || JSON.stringify(current.data) !== JSON.stringify(command.data))) fail();
    },
  });
  return {
    ...controller,
    getSelectedDate: () => selectedDate,
    async selectDate(value: string) {
      if (!controller.canClose()) return false;
      let date: string;
      try { date = prepareCloudAppointmentDayPageInput({ date: value }).date; } catch { return false; }
      if (!controller.canClose()) return false;
      selectedDate = date; return controller.refresh();
    },
    beginNew(patient?: { recordId: string; name: string; mobile: string }): boolean {
      if (!controller.canClose() || !controller.getState().loaded) return false;
      if (patient && (!uuid(patient.recordId) || typeof patient.name !== 'string' || typeof patient.mobile !== 'string')) return false;
      const draft: CloudAppointmentWorkspaceDraft = { recordId: (options.newId ?? (() => crypto.randomUUID()))(), expectedRevision: 0,
        data: { patientRecordId: patient?.recordId ?? null, patientName: patient?.name ?? '', phone: patient?.mobile ?? '',
          date: selectedDate, time: '', durationMinutes: '30', status: 'scheduled', reason: '', notes: '', doctorName: '',
          appointmentType: '', isFollowUp: false, isWalkIn: false } };
      return controller.beginDraft(draft);
    },
    beginEdit(expectedRecord: CloudAppointmentRecord): boolean {
      const snapshot = controller.getState().snapshot;
      if (!controller.canClose() || !snapshot || !snapshot.records.includes(expectedRecord)) return false;
      return controller.beginDraft(draftFromRecord(expectedRecord));
    },
  };
}
export type CloudAppointmentWorkspaceController = ReturnType<typeof createCloudAppointmentWorkspaceController>;
