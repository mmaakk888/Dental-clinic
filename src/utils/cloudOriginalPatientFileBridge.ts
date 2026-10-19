import type { Session } from '../types';
import type { CloudClinicSnapshot } from './cloudClinicSnapshot';
import type { CloudOperatingAdditionalContext } from './cloudOperatingPageController';
import { createCloudClinicalWorkspaceController } from './cloudClinicalWorkspaceController';
import { createCloudPrescriptionWorkspaceController } from './cloudPrescriptionWorkspaceController';
export function createCloudOriginalPatientFileBridge(context: CloudOperatingAdditionalContext, onCommitted: () => Promise<unknown>) {
  const controller = createCloudClinicalWorkspaceController({ getCapability: context.getClinical, isActive: context.isActive });
  const prescription = createCloudPrescriptionWorkspaceController({ getClinical: context.getClinical, getSettings: context.getClinicSettings, isActive: context.isActive });
  let running = false, editorOpen = false, disposed = false, retained: string | null = null;
  const active = () => !disposed && context.isActive() && !controller.getState().closed;
  const fail = (message = 'تعذر تأكيد عملية الملف. راجع نفس المحاولة دون تسجيل خدمة أو دفعة بديلة.'): never => { throw new Error(message); };
  const cents = (value: number) => { const result = Math.round(value * 100);
    if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(result) || Math.abs(result / 100 - value) > 1e-8) return fail('راجع المبلغ؛ لا تقبل كسور أقل من قرش.'); return result; };
  async function execute(snapshot: CloudClinicSnapshot, id: string, key: string, work: () => Promise<boolean>) {
    if (!active() || running) return fail(); running = true;
    try {
      if (controller.getState().pendingOperationId) {
        if (key !== retained || !await controller.retry()) return fail();
      } else {
        const original = snapshot.patients.find(row => row.patientRecordId === id); if (!original) return fail();
        if (!await controller.open(id) || !active()) return fail();
        const fresh = controller.getState().snapshot;
        if (!fresh || fresh.accountRevision !== original.accountRevision || JSON.stringify(fresh.profile) !== JSON.stringify(original.profile)) return fail('تغيّر حساب المريض أو بياناته من جهاز آخر؛ حدّث الملف وراجع المبلغ.');
        retained = key; if (!await work()) return fail();
      }
      if (!active() || controller.getState().pendingOperationId || controller.getState().saveStatus !== 'idle') return fail();
      retained = null;
      try { await onCommitted(); } catch { /* Confirmed cash is not resubmitted after a report failure. */ }
      if (!active()) return fail();
    } finally { running = false; }
  }
  return Object.freeze({ getState: controller.getState, subscribe: controller.subscribe,
    setEditorOpen(open: boolean) { if (active()) editorOpen = open; },
    canClose: () => active() && !running && !editorOpen && !controller.getState().loading && !controller.getState().pendingOperationId
      && controller.getState().saveStatus === 'idle' && !prescription.getState().loading && !prescription.getState().outputPending,
    visit(snapshot: CloudClinicSnapshot, id: string, value: Omit<Session, 'id'>) {
      const items = value.services ?? [];
      const key = JSON.stringify({ kind: 'visit', id, value: { type: value.type, date: value.date, tooth: value.tooth ?? null,
        teethIds: value.teethIds ?? [], services: items.map(row => ({ name: row.name, price: row.price, tooth: row.tooth ?? null })), amount: value.amount,
        paid: value.paid, examinationFee: value.examinationFee ?? 0, treatmentStage: value.treatmentStage ?? 'single', rootCanalStatus: value.rootCanalStatus ?? '',
        notes: value.visitNotes ?? '', visitStatus: value.visitStatus ?? 'completed' } });
      return execute(snapshot, id, key, async () => {
        const catalog = await (await context.getServiceCatalog()).repository.get();
        if (!active() || JSON.stringify(catalog) !== JSON.stringify(snapshot.settings.serviceCatalog)) return fail('تغيّرت قائمة الخدمات؛ حدّث الملف وراجع الأسعار.');
        if (value.prosthetic || value.discount || !items.length) return fail('سجّل التركيبات من زر التركيبة المرتبط بالمعمل.');
        const services = items.map(row => { const catalog = snapshot.settings.serviceCatalog.data.services.filter(item => item.active && item.name === row.name && item.kind === 'clinical');
          if (catalog.length !== 1) return fail('الخدمة غير متاحة أو مكررة في فهرس الأسعار؛ حدّث الملف.');
          return { id: crypto.randomUUID(), name: row.name, priceCents: cents(row.price), tooth: row.tooth ?? null, catalogServiceId: catalog[0].serviceId }; });
        const examinationCents = cents(value.examinationFee ?? 0), paidCents = cents(value.paid);
        if (examinationCents !== 0 && examinationCents !== snapshot.settings.serviceCatalog.data.examinationCents
          || services.reduce((sum, row) => sum + row.priceCents, examinationCents) !== cents(value.amount)) return fail('راجع تجميع سعر الخدمة والكشف.');
        const teethIds = [...new Set([...(value.teethIds ?? []), ...(value.tooth ? [value.tooth] : []), ...services.flatMap(row => row.tooth ? [row.tooth] : [])])];
        return controller.saveVisit(id, { type: value.type, date: value.date, teethIds, services, examinationCents, notes: value.visitNotes ?? '',
          treatmentStage: value.treatmentStage ?? 'single', rootCanalStatus: value.rootCanalStatus ?? '', visitStatus: value.visitStatus ?? 'completed' }, paidCents);
      });
    },
    payment(snapshot: CloudClinicSnapshot, id: string, sessionId: string, value: { amount: number; date: string }) {
      return execute(snapshot, id, JSON.stringify({ kind: 'payment', id, sessionId, value }), () => controller.addReceipt(id, sessionId, { amountCents: cents(value.amount), date: value.date, note: '' }));
    },
    async recoverPending() { if (!active() || running || editorOpen || !controller.getState().pendingOperationId) return false; running = true;
      try { if (!await controller.retry() || !active()) return false; retained = null; try { await onCommitted(); } catch { /* Confirmed already. */ } return active(); } finally { running = false; } },
    async cancelPending() { if (!active() || running || editorOpen) return false; running = true;
      try { const result = await controller.cancelPending(); if (result) retained = null; return result; } finally { running = false; } },
    async prepareOutput(snapshot: CloudClinicSnapshot, id: string) {
      if (!active() || running || controller.getState().pendingOperationId) return fail();
      const previous = prescription.getState().document;
      if (previous && !prescription.discard(previous)) return fail();
      if (!await prescription.load(id) || !active()) return fail();
      const document = prescription.getState().document, original = snapshot.patients.find(row => row.patientRecordId === id);
      if (!document || !original || document.patient.name !== original.profile.data.name || document.patient.mobile !== original.profile.data.mobile
        || document.patient.age !== original.profile.data.age || document.clinicName !== snapshot.settings.clinicSettings.data.identity.clinicName) return fail('تغيّرت بيانات المريض أو العيادة؛ حدّث الملف قبل إخراج الروشتة.');
      await prescription.authorizeOutput(document); if (!active()) return fail();
    },
    assertOutputActive() { const document = prescription.getState().document; if (!active() || !document) return fail(); prescription.assertOutputActive(document); },
    dispose() { disposed = true; controller.dispose(); prescription.dispose(); },
  });
}
export type CloudOriginalPatientFileBridge = ReturnType<typeof createCloudOriginalPatientFileBridge>;
