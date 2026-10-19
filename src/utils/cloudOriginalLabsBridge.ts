import type { Lab, LabCase } from '../types';
import type { CloudClinicSnapshot } from './cloudClinicSnapshot';
import type { CloudOperatingAdditionalContext } from './cloudOperatingPageController';
import { createCloudProstheticWorkspaceController } from './cloudProstheticWorkspaceController';
import { createCloudClinicSettingsWorkspaceController } from './cloudClinicSettingsWorkspaceController';
import { projectOriginalClinicViews } from './cloudOriginalViewProjection';
import { validateProstheticOrder, type ProstheticOrderInput } from './prostheticWorkflow';

/** The original LabView owns presentation. All mutations go through existing
 * protected journal/CAS workflows, not local callbacks or guessed ledgers. */
export function createCloudOriginalLabsBridge(context: CloudOperatingAdditionalContext, onCommitted: () => Promise<unknown>) {
  const controller = createCloudProstheticWorkspaceController({ getCapability: context.getProsthetics, getClinical: context.getClinical,
    getSettings: context.getClinicSettings, ownerUid: context.ownerUid, isActive: context.isActive,
    getCatalog: async () => { const value = await (await context.getServiceCatalog()).repository.get();
      if (!context.isActive() || !value) throw new Error('تعذر قراءة الأسعار.'); return value; } });
  const settings = createCloudClinicSettingsWorkspaceController({ getCapability: context.getClinicSettings,
    getServiceCatalog: context.getServiceCatalog, isActive: context.isActive });
  let disposed = false, running = false, editorOpen = false, retained: string | null = null;
  const active = () => !disposed && context.isActive() && !controller.getState().closed && !settings.getState().closed;
  const fail = (message = 'تعذر تأكيد عملية المعمل؛ راجع نفس المحاولة ولا تسجّل دفعة أو تركيبة بديلة.'): never => { throw new Error(message); };
  const clean = () => controller.canClose() && settings.canClose();
  async function execute(fingerprint: string, work: () => Promise<void>) {
    if (!active() || running) return fail();
    running = true;
    try {
      if (retained !== null && retained !== fingerprint) return fail('توجد محاولة محفوظة؛ أعدها بنفس القيم أو ألغِ العملية الأصلية قبل تغييرها.');
      retained = fingerprint;
      if (controller.getState().pendingOperationId) { if (!await controller.retry(controller.getState().pendingOperationId!)) return fail(); }
      else if (settings.getState().pendingOperationId) { if (!await settings.retry()) return fail(); }
      else await work();
      if (!active() || !clean()) return fail();
      retained = null; editorOpen = false;
      try { await onCommitted(); } catch { /* No duplicate write after a confirmed domain acknowledgement. */ }
      if (!active()) return fail();
    } catch (error) {
      if (!controller.getState().pendingOperationId && !settings.getState().pendingOperationId) {
        const draft = controller.getState().draft; if (draft) controller.cancelDraft(draft.handle);
        if (settings.getState().draft) settings.cancelDraft(); retained = null;
      }
      throw error;
    } finally { running = false; }
  }
  async function openLedger(snapshot: CloudClinicSnapshot, labId: string) {
    const parts = new Intl.DateTimeFormat('en', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
    const month = `${parts.find(row => row.type === 'year')!.value}-${parts.find(row => row.type === 'month')!.value}`;
    if (!await controller.openLab(labId, month) || !active()) return fail();
    const original = snapshot.records.labAccounts.find(row => row.labId === labId), fresh = controller.getState().ledger?.account;
    if (!original || JSON.stringify(original) !== JSON.stringify(fresh)) return fail('تغيّر حساب المعمل؛ حدّث القائمة وراجع الرصيد والدفعات قبل الحفظ.');
  }
  return Object.freeze({ getState: controller.getState, subscribe: controller.subscribe,
    getSettingsState: settings.getState, subscribeSettings: settings.subscribe,
    async recoverPending() { if (!active() || running || editorOpen) return false; running = true;
      try { const id = controller.getState().pendingOperationId; const result = id ? await controller.retry(id) : settings.getState().pendingOperationId ? await settings.retry() : false;
        if (!result || !active()) return false; retained = null;
        try { await onCommitted(); } catch { /* Already acknowledged. */ } return active(); } finally { running = false; } },
    async cancelPending() { if (!active() || running || editorOpen) return false; running = true;
      try { const id = controller.getState().pendingOperationId; const result = id ? await controller.cancelPending(id) : await settings.cancelPending();
        if (result) retained = null; return result; } finally { running = false; } },
    canClose: () => active() && !running && !editorOpen && clean(),
    setEditorOpen(open: boolean) { if (!active()) return; editorOpen = open; },
    order(snapshot: CloudClinicSnapshot, input: ProstheticOrderInput) {
      return execute(JSON.stringify({ kind: 'order', input }), async () => {
        validateProstheticOrder(input);
        const patient = snapshot.patients.find(row => String(row.profile.fileNo) === input.patientId);
        const services = snapshot.settings.serviceCatalog.data.services.filter(row => row.active && row.kind === 'prosthetic' && row.name === input.material);
        if (!patient || services.length !== 1 || !await controller.beginOrder(patient.patientRecordId) || !active()) return fail();
        let draft = controller.getState().draft;
        if (draft?.type !== 'order') return fail();
        const choice = draft.choices.find(row => row.serviceId === services[0].serviceId);
        if (!choice || choice.priceCents !== Math.round(input.expectedUnitPrice * 100)
          || input.examinationFee !== 0 && Math.round(input.examinationFee * 100) !== draft.examinationCents) return fail('تغيّرت أسعار التركيبة أو الكشف؛ حدّث الفهرس وراجع السعر.');
        if (!controller.selectService(draft.handle, choice.serviceId)) return fail();
        draft = controller.getState().draft;
        if (!draft || !controller.updateDraft(draft.handle, { kind: input.kind, units: String(input.units), paid: String(input.paid),
          teethIds: [...input.teethIds], date: input.date, deliveryDate: input.deliveryExpectedDate ?? '', note: input.note ?? '', includeExamination: input.examinationFee !== 0 })) return fail();
        if (!await controller.saveDraft(draft.handle)) return fail();
      });
    },
    payment(snapshot: CloudClinicSnapshot, labId: string, caseId: string | null, amount: number) {
      return execute(JSON.stringify({ kind: 'payment', labId, caseId, amount }), async () => {
        await openLedger(snapshot, labId);
        if (caseId && snapshot.records.labCases.find(row => row.recordId === caseId)?.labId !== labId || !controller.beginPayment(caseId)) return fail();
        const draft = controller.getState().draft;
        if (!draft || !controller.updateDraft(draft.handle, { amount: String(amount) }) || !await controller.saveDraft(draft.handle)) return fail();
      });
    },
    progress(snapshot: CloudClinicSnapshot, value: LabCase) {
      return execute(JSON.stringify({ kind: 'progress', value }), async () => {
        const original = projectOriginalClinicViews(snapshot).labCases.find(row => row.id === value.id);
        if (!original || JSON.stringify({ ...value, status: original.status, note: original.note }) !== JSON.stringify(original)
          || !['pending', 'ready', 'delivered'].includes(value.status)) return fail('تغيير الربط أو مبالغ الحالة ليس تعديل حالة تسليم.');
        await openLedger(snapshot, original.labId);
        const fresh = controller.getState().ledger?.cases.find(row => row.recordId === value.id), baseline = snapshot.records.labCases.find(row => row.recordId === value.id);
        if (!fresh || JSON.stringify(fresh) !== JSON.stringify(baseline) || !controller.beginProgress(value.id)) return fail('تغيّرت الحالة؛ حدّث السجل.');
        const draft = controller.getState().draft;
        if (!draft || !controller.updateDraft(draft.handle, { status: value.status, note: value.note ?? '' }) || !await controller.saveDraft(draft.handle)) return fail();
      });
    },
    saveLab(snapshot: CloudClinicSnapshot, value: Omit<Lab, 'id'> & { id?: string }, baseline?: Lab, deactivate = false) {
      return execute(JSON.stringify({ kind: 'lab', value, baseline, deactivate }), async () => {
        const original = baseline ? snapshot.records.labDefinitions.find(row => row.recordId === baseline.id) : null;
        if (baseline && (!original || JSON.stringify(projectOriginalClinicViews(snapshot).labs.find(row => row.id === baseline.id)) !== JSON.stringify(baseline))) return fail();
        if (deactivate && (!original || snapshot.records.labCases.some(row => row.labId === original.recordId)
          || snapshot.settings.prostheticRouting.data.routes.some(row => row.labId === original.recordId))) return fail('لا يمكن إيقاف معمل مرتبط بحالات أو مسارات تسعير.');
        const recordId = original?.recordId ?? crypto.randomUUID();
        if (!await settings.load('lab', recordId) || !active() || JSON.stringify(settings.getState().snapshot) !== JSON.stringify(original)) return fail('تغيّرت بيانات المعمل؛ حدّث القائمة.');
        if (!settings.beginEdit() || !settings.updateDraft({ name: value.name, phone: value.phone ?? '', address: value.address ?? '', notes: value.notes ?? '',
          active: !deactivate, costs: original?.data.costs ?? [] }) || !await settings.save()) return fail();
      });
    },
    dispose() { disposed = true; controller.dispose(); settings.dispose(); },
  });
}
export type CloudOriginalLabsBridge = ReturnType<typeof createCloudOriginalLabsBridge>;
