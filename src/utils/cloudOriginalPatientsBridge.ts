import type { Patient } from '../types';
import type { CloudClinicSnapshot } from './cloudClinicSnapshot';
import { createCloudPatientWorkspaceController, type CloudPatientWorkspaceCapability, type CloudPatientRegistrationDirectory } from './cloudPatientWorkspaceController';
import type { CloudPatientProfile } from './cloudPatientRepository';

export function createCloudOriginalPatientsBridge(options: {
  getRepository(): Promise<CloudPatientWorkspaceCapability>; getDirectory(): Promise<CloudPatientRegistrationDirectory>;
  isActive(): boolean; onCommitted(): Promise<unknown>;
}) {
  const controller = createCloudPatientWorkspaceController(options);
  let running = false, editorOpen = false, disposed = false;
  const fail = (message = 'تعذر تأكيد حفظ الملف؛ راجع العملية الأصلية ولا تنشئ ملفًا بديلًا.'): never => { throw new Error(message); };
  const active = () => !disposed && options.isActive() && !controller.getState().closed;
  const profile = (value: Omit<Patient, 'sessions' | 'payments'>): CloudPatientProfile => ({ name: value.name, mobile: value.mobile, age: value.age,
    gender: value.gender ?? '', firstVisit: value.firstVisit, notes: value.notes, allergy: value.allergy });
  async function save(snapshot: CloudClinicSnapshot, value: Omit<Patient, 'sessions' | 'payments'>, originalId?: string) {
    if (!active() || running) return fail();
    running = true;
    try {
      const data = profile(value), record = originalId ? snapshot.records.patientProfiles.find(row => String(row.fileNo) === originalId) : null;
      if (originalId && !record) return fail();
      let state = controller.getState();
      if (state.pendingOperationId) {
        if (!state.draft || state.draft.action !== (originalId ? 'update' : 'create') || record && state.draft.recordId !== record.recordId
          || JSON.stringify(state.draft.profile) !== JSON.stringify(data)) return fail();
      } else {
        if (!state.draft) {
          if (record) {
            await controller.select(record.recordId); if (!active()) return fail();
            const current = controller.getState().selected;
            if (!current || current.revision !== record.revision || JSON.stringify(current.data) !== JSON.stringify(record.data)) return fail('تغيّر الملف من جهاز آخر. حدّث القائمة ثم راجع التعديل قبل الحفظ.');
            if (!controller.beginEdit(current)) return fail();
          } else if (!controller.beginCreate()) return fail();
        }
        state = controller.getState();
        if (!state.draft || state.draft.action !== (originalId ? 'update' : 'create')) return fail();
        if (JSON.stringify(state.draft.profile) !== JSON.stringify(data) && !controller.updateProfile(data)) return fail();
      }
      state = controller.getState();
      if (state.registrationCheck) await controller.confirmSeparateFile(state.registrationCheck);
      else await controller.save();
      if (!active()) return fail();
      state = controller.getState();
      if (state.registrationCheck) {
        const matches = state.registrationCheck.matches.slice(0, 5).map(row => `${row.name}${row.fileNo ? ` — ملف ${row.fileNo}` : ' — جهة اتصال'}`).join('، ');
        return fail(`وجدنا تشابهًا: ${matches}. راجع الملفات الموجودة. إذا كان شخصًا مختلفًا، اضغط حفظ مرة أخرى بنفس البيانات لتأكيد إنشاء ملف منفصل.`);
      }
      if (state.saveStatus !== 'idle' || state.pendingOperationId || state.draft || !state.selected) return fail();
      const fileNo = String(state.selected.fileNo);
      editorOpen = false;
      try { await options.onCommitted(); } catch { /* A confirmed file must not be created again on report failure. */ }
      if (!active()) return fail();
      return fileNo;
    } finally { running = false; }
  }
  return Object.freeze({ getState: controller.getState, subscribe: controller.subscribe, save,
    async recoverPending() { if (!active() || running || editorOpen || !controller.getState().pendingOperationId) return false;
      running = true; try { await controller.save(); const state = controller.getState(); if (!active() || state.pendingOperationId || state.saveStatus !== 'idle') return false;
        try { await options.onCommitted(); } catch { /* Already acknowledged. */ } return active(); } finally { running = false; } },
    async cancelPending() { if (!active() || running || editorOpen) return false; running = true;
      try { return await controller.cancelPending(); } finally { running = false; } },
    setEditorOpen(open: boolean) { if (active()) { editorOpen = open; if (!open && !running && !controller.getState().pendingOperationId) controller.cancelDraft(); } },
    canClose() { const state = controller.getState(); return active() && !running && !editorOpen && !state.loading && !state.recoveryLoading
      && !state.draft && !state.pendingOperationId && state.saveStatus === 'idle'; },
    dispose() { disposed = true; controller.dispose(); },
  });
}
export type CloudOriginalPatientsBridge = ReturnType<typeof createCloudOriginalPatientsBridge>;
