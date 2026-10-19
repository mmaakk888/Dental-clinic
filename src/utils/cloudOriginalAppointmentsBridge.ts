import type { Appointment, AppointmentStatus } from '../types';
import type { CloudClinicSnapshot } from './cloudClinicSnapshot';
import { createCloudAppointmentWorkspaceController } from './cloudAppointmentWorkspaceController';
import type { CloudAppointmentCapability } from './cloudAppointmentOperatingCapability';
import { projectOriginalClinicViews } from './cloudOriginalViewProjection';

export function createCloudOriginalAppointmentsBridge(options: { ownerUid: string; initialDate: string; isActive(): boolean;
  getCapability(): Promise<CloudAppointmentCapability>; onCommitted(): Promise<unknown> }) {
  const controller = createCloudAppointmentWorkspaceController(options);
  let running = false, editorOpen = false, disposed = false, retained: string | null = null;
  const active = () => !disposed && options.isActive() && !controller.getState().closed;
  const fail = (message = 'تعذر تأكيد الموعد؛ أعد نفس المحاولة دون إنشاء حجز بديل.'): never => { throw new Error(message); };
  async function save(snapshot: CloudClinicSnapshot, value: Omit<Appointment, 'id'> & { id?: string }) {
    if (!active() || running) return fail();
    running = true;
    try {
      const original = value.id ? snapshot.records.appointmentRecords.find(row => row.recordId === value.id) : null;
      if (value.id && !original) return fail();
      const patient = value.patientId ? snapshot.patients.find(row => String(row.profile.fileNo) === value.patientId) : null;
      if (value.patientId && !patient) return fail();
      const data = { patientRecordId: patient?.patientRecordId ?? null, patientName: value.patientName, phone: value.mobile,
        date: value.date, time: value.time, durationMinutes: String(value.durationMinutes ?? 30), status: value.status,
        reason: original?.data.reason ?? '', notes: value.note, doctorName: value.doctorName ?? '', appointmentType: value.appointmentType ?? '',
        isFollowUp: value.isFollowUp, isWalkIn: value.isWalkIn };
      const fingerprint = JSON.stringify({ originalId: value.id ?? null, data });
      let state = controller.getState();
      if (state.pendingOperationId) {
        if (retained !== fingerprint || !await controller.retry()) return fail();
      } else {
        if (state.draft && controller.cancelDraft(state.draft)) { state = controller.getState(); retained = null; }
        if (state.draft) {
          if (retained !== fingerprint) return fail('ألغِ المسودة السابقة قبل تغيير الحجز.');
        } else {
          if (!await controller.selectDate(original?.data.date ?? value.date) || !active()) return fail();
          if (original) {
            const fresh = controller.getState().snapshot?.records.find(row => row.recordId === original.recordId);
            if (!fresh || JSON.stringify(fresh) !== JSON.stringify(original)) return fail('تغيّر الموعد من جهاز آخر. حدّث الجدول وراجع التعديل.');
            if (!controller.beginEdit(fresh)) return fail();
          } else if (!controller.beginNew(patient ? { recordId: patient.patientRecordId, name: patient.profile.data.name, mobile: patient.profile.data.mobile } : undefined)) return fail();
          const draft = controller.getState().draft;
          if (!draft || !controller.updateDraft({ ...draft, data }, draft)) return fail();
          retained = fingerprint;
        }
        state = controller.getState();
        if (!state.draft || !await controller.save(state.draft)) return fail();
      }
      if (!active() || !controller.canClose()) return fail();
      retained = null; editorOpen = false;
      try { await options.onCommitted(); } catch { /* A report refresh cannot undo the acknowledged reservation. */ }
      if (!active()) return fail();
    } finally { running = false; }
  }
  return Object.freeze({ getState: controller.getState, subscribe: controller.subscribe, save,
    async recoverPending() { if (!active() || running || editorOpen || !controller.getState().pendingOperationId) return false;
      running = true; try { if (!await controller.retry() || !active()) return false; retained = null;
        try { await options.onCommitted(); } catch { /* Already acknowledged. */ } return active(); } finally { running = false; } },
    async cancelPending() { if (!active() || running || editorOpen) return false; running = true;
      try { const result = await controller.cancelPending(); if (result) retained = null; return result; } finally { running = false; } },
    setStatus(snapshot: CloudClinicSnapshot, id: string, status: AppointmentStatus) {
      const original = projectOriginalClinicViews(snapshot).appointments.find(row => row.id === id);
      if (!original) return Promise.reject(new Error('لم يعد الموعد موجودًا في النسخة المعروضة.'));
      return save(snapshot, { ...original, status });
    },
    setEditorOpen(open: boolean) { if (!active()) return; editorOpen = open;
      const state = controller.getState(); if (!open && !running && !state.pendingOperationId && state.draft) { controller.cancelDraft(state.draft); retained = null; } },
    canClose: () => active() && !running && !editorOpen && controller.canClose(),
    dispose() { disposed = true; controller.dispose(); },
  });
}
export type CloudOriginalAppointmentsBridge = ReturnType<typeof createCloudOriginalAppointmentsBridge>;
