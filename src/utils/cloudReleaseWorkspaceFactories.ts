import type { CloudOperatingAdditionalContext } from './cloudOperatingPageController';
import type { CloudAppointmentWorkspaceController } from './cloudAppointmentWorkspaceController';
import type { CloudClinicSettingsWorkspaceController } from './cloudClinicSettingsWorkspaceController';
import type { createCloudProstheticWorkspaceController } from './cloudProstheticWorkspaceController';
import type { CloudPrescriptionWorkspaceController } from './cloudPrescriptionWorkspaceController';
import type { CloudExpenseWorkspaceController } from './cloudExpenseWorkspaceController';
import type { CloudClinicOverviewController } from './cloudClinicOverviewController';
import type { CloudTransferWorkspaceController } from './cloudTransferWorkspaceController';

/** A closed release gate, not user permission or a URL/env override. Remains
 * false until complete integration/Rules/empty-start acceptance is recorded
 * in RELEASE-CHECKLIST.ar.md. Existing local App is never its fallback. */
export { CLOUD_COMPLETE_RELEASE_UI } from './cloudReleaseReadiness';
type Controller = CloudAppointmentWorkspaceController | CloudClinicSettingsWorkspaceController
  | ReturnType<typeof createCloudProstheticWorkspaceController> | CloudPrescriptionWorkspaceController | CloudExpenseWorkspaceController
  | CloudClinicOverviewController | CloudTransferWorkspaceController;
export type CloudReleaseWorkspace = (
  | { kind: 'appointments'; controller: CloudAppointmentWorkspaceController }
  | { kind: 'settings'; controller: CloudClinicSettingsWorkspaceController }
  | { kind: 'prosthetics'; controller: ReturnType<typeof createCloudProstheticWorkspaceController> }
  | { kind: 'prescription'; controller: CloudPrescriptionWorkspaceController; patientRecordId: string }
  | { kind: 'expenses'; controller: CloudExpenseWorkspaceController }
  | { kind: 'home' | 'directory' | 'finance' | 'export'; controller: CloudClinicOverviewController }
  | { kind: 'transfer'; controller: CloudTransferWorkspaceController }
) & { canClose(): boolean; dispose(): void };
const wrap = <T extends { kind: string; controller: Controller }>(value: T): T & { canClose(): boolean; dispose(): void } =>
  Object.freeze({ ...value, canClose: () => value.controller.canClose(), dispose: () => value.controller.dispose() });

/** Explicit section construction only. Domain controllers stay inert until a
 * user action; no SDK/data access, ID/clock or local configuration on mount. */
export async function createCloudReleaseWorkspace(context: CloudOperatingAdditionalContext,
  request: { kind: 'appointments'; initialDate: string } | { kind: 'settings' | 'prosthetics' | 'expenses' }
    | { kind: 'home' | 'directory' | 'finance' | 'export'; initialDate: string } | { kind: 'transfer' }
    | { kind: 'prescription'; patientRecordId: string }): Promise<CloudReleaseWorkspace> {
  const requireActive = () => { if (!context.isActive()) throw new Error('تعذر فتح القسم في هذه الجلسة.'); };
  requireActive();
  if (request.kind === 'home' || request.kind === 'directory' || request.kind === 'finance' || request.kind === 'export') {
    const module = await import('./cloudClinicOverviewController'); requireActive();
    const controller = module.createCloudClinicOverviewController({ getSnapshot: context.getClinicSnapshot,
      isActive: context.isActive, initialDate: request.initialDate });
    controller.setTab(request.kind === 'export' ? 'export' : request.kind);
    return wrap({ kind: request.kind, controller });
  }
  if (request.kind === 'transfer') {
    const module = await import('./cloudTransferWorkspaceController'); requireActive();
    return wrap({ kind: 'transfer' as const, controller: module.createCloudTransferWorkspaceController({ ownerUid: context.ownerUid,
      isActive: context.isActive, getPatients: context.getPatients, getContacts: context.getContacts, getSnapshot: context.getClinicSnapshot }) });
  }
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
