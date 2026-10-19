import type { ClinicContact } from '../types';
import type { CloudClinicSnapshot } from './cloudClinicSnapshot';
import { createCloudContactWorkspaceController, type CloudContactWorkspaceCapability } from './cloudContactWorkspaceController';

/** Connects the ORIGINAL contact editor to the existing protected durable
 * controller. No local database/session, replacement UI or invented records. */
export function createCloudOriginalContactsBridge(options: {
  getRepository(): Promise<CloudContactWorkspaceCapability>;
  isActive(): boolean;
  onCommitted(): Promise<unknown>;
}) {
  const controller = createCloudContactWorkspaceController({ getRepository: options.getRepository, isActive: options.isActive });
  let running = false, editorOpen = false, disposed = false;
  const fail = (): never => { throw new Error('تعذر تأكيد الحفظ. أعد نفس المحاولة أو راجع العملية الأصلية، دون إنشاء جهة اتصال أخرى.'); };
  const active = () => !disposed && options.isActive() && !controller.getState().closed;
  const fields = (value: ClinicContact) => ({ name: value.name, mobile: value.mobile, notes: value.notes ?? '' });
  const equal = (a: ClinicContact, b: ClinicContact) => JSON.stringify(fields(a)) === JSON.stringify(fields(b));
  async function execute(snapshot: CloudClinicSnapshot, value: ClinicContact, original: ClinicContact | undefined, deleting: boolean) {
    if (!active() || running) return fail();
    running = true;
    try {
      let state = controller.getState();
      const record = original ? snapshot.records.contactRecords.find(row => row.recordId === original.id && !row.deleted && row.data) : null;
      if (original && (!record?.data || !equal(record.data, original))) return fail();
      if (state.pendingOperationId) {
        // A retry may confirm ONLY the retained original command, never a new
        // ID or different values after an uncertain server response.
        if (!state.draft || state.draft.action !== (deleting ? 'delete' : original ? 'update' : 'create')
          || original && state.draft.recordId !== original.id
          || !deleting && (!state.draft.contact || !equal(state.draft.contact, value))) return fail();
      } else {
        if (state.draft && (state.draft.action !== (deleting ? 'delete' : original ? 'update' : 'create')
          || original && state.draft.recordId !== original.id)) return fail();
        const begun = !!state.draft || (deleting ? controller.beginDelete(record!) : original ? controller.beginEdit(record!) : controller.beginCreate());
        if (!begun || !deleting && !controller.changeDraft(fields(value))) return fail();
      }
      await controller.save();
      if (!active()) return fail();
      state = controller.getState();
      if (state.saveStatus !== 'idle' || state.pendingOperationId || state.draft) return fail();
      editorOpen = false;
      // Domain acknowledgement is already confirmed. A failed report refresh
      // must not turn it into a new create on the original form's next submit.
      try { await options.onCommitted(); } catch { /* A confirmed write is not undone by a failed report refresh. */ }
      if (!active()) return fail();
    } finally { running = false; }
  }
  return Object.freeze({
    getState: controller.getState, subscribe: controller.subscribe,
    async recoverPending() { if (!active() || running || editorOpen || !controller.getState().pendingOperationId) return false;
      running = true; try { await controller.save(); const state = controller.getState(); if (!active() || state.pendingOperationId || state.saveStatus !== 'idle') return false;
        try { await options.onCommitted(); } catch { /* Already acknowledged. */ } return active(); } finally { running = false; } },
    async cancelPending() { if (!active() || running || editorOpen) return false; running = true;
      try { return await controller.cancelPending(); } finally { running = false; } },
    setEditorOpen(open: boolean) { if (active()) { editorOpen = open; if (!open && !running && !controller.getState().pendingOperationId) controller.cancelDraft(); } },
    canClose() { const state = controller.getState(); return active() && !running && !editorOpen && !state.draft && !state.pendingOperationId
      && !state.loading && !state.recoveryLoading && state.saveStatus === 'idle'; },
    save: (snapshot: CloudClinicSnapshot, value: ClinicContact, original?: ClinicContact) => execute(snapshot, value, original, false),
    remove: (snapshot: CloudClinicSnapshot, original: ClinicContact) => execute(snapshot, original, original, true),
    dispose() { disposed = true; controller.dispose(); },
  });
}
export type CloudOriginalContactsBridge = ReturnType<typeof createCloudOriginalContactsBridge>;
