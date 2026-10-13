import type { CloudOperatingAdditionalContext } from './cloudOperatingPageController';
import type { CloudAppointmentWorkspaceController } from './cloudAppointmentWorkspaceController';
import type { CloudClinicSettingsWorkspaceController } from './cloudClinicSettingsWorkspaceController';
import type { createCloudProstheticWorkspaceController } from './cloudProstheticWorkspaceController';
import type { CloudPrescriptionWorkspaceController } from './cloudPrescriptionWorkspaceController';
import type { CloudExpenseWorkspaceController } from './cloudExpenseWorkspaceController';

/** A closed release gate, not user permission or a URL/env override. Remains
 * false until complete integration/Rules/empty-start acceptance is recorded
 * in RELEASE-CHECKLIST.ar.md. Existing local App is never its fallback. */
export const CLOUD_COMPLETE_RELEASE_UI = Object.freeze({ available: false,
  reason: 'الربط الكامل وقواعد الحفظ المجمعة تحت الاختبار؛ التشغيل الفعلي غير مفعّل بعد.' });
type Controller = CloudAppointmentWorkspaceController | CloudClinicSettingsWorkspaceController
  | ReturnType<typeof createCloudProstheticWorkspaceController> | CloudPrescriptionWorkspaceController | CloudExpenseWorkspaceController;
export type CloudReleaseWorkspace = (
  | { kind: 'appointments'; controller: CloudAppointmentWorkspaceController }
  | { kind: 'settings'; controller: CloudClinicSettingsWorkspaceController }
  | { kind: 'prosthetics'; controller: ReturnType<typeof createCloudProstheticWorkspaceController> }
  | { kind: 'prescription'; controller: CloudPrescriptionWorkspaceController; patientRecordId: string }
  | { kind: 'expenses'; controller: CloudExpenseWorkspaceController }
) & { canClose(): boolean; dispose(): void };
const wrap = <T extends { kind: string; controller: Controller }>(value: T): T & { canClose(): boolean; dispose(): void } =>
  Object.freeze({ ...value, canClose: () => value.controller.canClose(), dispose: () => value.controller.dispose() });

/** Explicit section construction only. Domain controllers stay inert until a
 * user action; no SDK/data access, ID/clock or local configuration on mount. */
export async function createCloudReleaseWorkspace(context: CloudOperatingAdditionalContext,
  request: { kind: 'appointments'; initialDate: string } | { kind: 'settings' | 'prosthetics' | 'expenses' }
    | { kind: 'prescription'; patientRecordId: string }): Promise<CloudReleaseWorkspace> {
  const requireActive = () => { if (!context.isActive()) throw new Error('تعذر فتح القسم في هذه الجلسة.'); };
  requireActive();
  if (request.kind === 'appointments') {
    const module = await import('./cloudAppointmentWorkspaceController'); requireActive();
    return wrap({ kind: 'appointments' as const, controller: module.createCloudAppointmentWorkspaceController({
      getCapability: context.getAppointments, ownerUid: context.ownerUid, isActive: context.isActive, initialDate: request.initialDate }) });
  }
  if (request.kind === 'settings') {
    const module = await import('./cloudClinicSettingsWorkspaceController'); requireActive();
    return wrap({ kind: 'settings' as const, controller: module.createCloudClinicSettingsWorkspaceController({
      getCapability: context.getClinicSettings, getServiceCatalog: context.getServiceCatalog, isActive: context.isActive }) });
  }
  if (request.kind === 'prosthetics') {
    const module = await import('./cloudProstheticWorkspaceController'); requireActive();
    return wrap({ kind: 'prosthetics' as const, controller: module.createCloudProstheticWorkspaceController({
      getCapability: context.getProsthetics, getClinical: context.getClinical, getSettings: context.getClinicSettings,
      getCatalog: async () => { requireActive(); const cap = await context.getServiceCatalog(); requireActive();
        const record = await cap.repository.get(); requireActive(); return record; }, ownerUid: context.ownerUid, isActive: context.isActive }) });
  }
  if (request.kind === 'prescription') {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(request.patientRecordId)
      || request.patientRecordId.length !== 36) throw new Error('حدد ملف مريض صالحًا.');
    const module = await import('./cloudPrescriptionWorkspaceController'); requireActive();
    return wrap({ kind: 'prescription' as const, patientRecordId: request.patientRecordId,
      controller: module.createCloudPrescriptionWorkspaceController({ getClinical: context.getClinical,
        getSettings: context.getClinicSettings, isActive: context.isActive }) });
  }
  if (request.kind === 'expenses') {
    const module = await import('./cloudExpenseWorkspaceController'); requireActive();
    return wrap({ kind: 'expenses' as const, controller: module.createCloudExpenseWorkspaceController({
      getCapability: context.getExpenses, ownerUid: context.ownerUid, isActive: context.isActive }) });
  }
  throw new Error('القسم غير متاح.');
}
