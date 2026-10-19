import type { CloudOperatingAdditionalContext } from './cloudOperatingPageController';
import type { CloudAppointmentWorkspaceController } from './cloudAppointmentWorkspaceController';
import type { CloudClinicSettingsWorkspaceController } from './cloudClinicSettingsWorkspaceController';
import type { createCloudProstheticWorkspaceController } from './cloudProstheticWorkspaceController';
import type { CloudPrescriptionWorkspaceController } from './cloudPrescriptionWorkspaceController';
import type { CloudExpenseWorkspaceController } from './cloudExpenseWorkspaceController';
import type { CloudClinicOverviewController } from './cloudClinicOverviewController';
import type { CloudClinicOverviewTab } from './cloudClinicOverviewController';
import type { CloudTransferWorkspaceController } from './cloudTransferWorkspaceController';
import type { CloudWhatsAppWorkspaceController } from './cloudWhatsAppWorkspaceController';
import { createCloudOriginalContactsBridge, type CloudOriginalContactsBridge } from './cloudOriginalContactsBridge';
import { createCloudOriginalPatientsBridge, type CloudOriginalPatientsBridge } from './cloudOriginalPatientsBridge';
import { createCloudOriginalAppointmentsBridge, type CloudOriginalAppointmentsBridge } from './cloudOriginalAppointmentsBridge';
import { createCloudOriginalLabsBridge, type CloudOriginalLabsBridge } from './cloudOriginalLabsBridge';
import { createCloudOriginalPatientFileBridge, type CloudOriginalPatientFileBridge } from './cloudOriginalPatientFileBridge';
import { createCloudOriginalSettingsBridge, type CloudOriginalSettingsBridge } from './cloudOriginalSettingsBridge';
import { createCloudOriginalWhatsAppBridge, type CloudOriginalWhatsAppBridge } from './cloudOriginalWhatsAppBridge';

/** A closed release gate, not user permission or a URL/env override. Remains
 * false until complete integration/Rules/empty-start acceptance is recorded
 * in RELEASE-CHECKLIST.ar.md. Existing local App is never its fallback. */
export { CLOUD_COMPLETE_RELEASE_UI } from './cloudReleaseReadiness';
type Controller = CloudAppointmentWorkspaceController | CloudClinicSettingsWorkspaceController
  | ReturnType<typeof createCloudProstheticWorkspaceController> | CloudPrescriptionWorkspaceController | CloudExpenseWorkspaceController
  | CloudClinicOverviewController | CloudTransferWorkspaceController | CloudWhatsAppWorkspaceController;
export type CloudReleaseWorkspace = (
  | { kind: 'appointments'; controller: CloudAppointmentWorkspaceController }
  | { kind: 'settings'; controller: CloudClinicSettingsWorkspaceController }
  | { kind: 'prosthetics'; controller: ReturnType<typeof createCloudProstheticWorkspaceController> }
  | { kind: 'prescription'; controller: CloudPrescriptionWorkspaceController; patientRecordId: string }
  | { kind: 'expenses'; controller: CloudExpenseWorkspaceController }
  | { kind: 'home' | 'directory' | 'finance' | 'export'; controller: CloudClinicOverviewController; contactsBridge?: CloudOriginalContactsBridge; patientsBridge?: CloudOriginalPatientsBridge; appointmentsBridge?: CloudOriginalAppointmentsBridge; labsBridge?: CloudOriginalLabsBridge; patientFileBridge?: CloudOriginalPatientFileBridge; settingsBridge?: CloudOriginalSettingsBridge; whatsAppBridge?: CloudOriginalWhatsAppBridge }
  | { kind: 'transfer'; controller: CloudTransferWorkspaceController }
  | { kind: 'whatsapp'; controller: CloudWhatsAppWorkspaceController }
) & { canClose(): boolean; canNavigate?(): boolean; dispose(): void };
const wrap = <T extends { kind: string; controller: Controller }>(value: T): T & { canClose(): boolean; dispose(): void } =>
  Object.freeze({ ...value, canClose: () => value.controller.canClose(),
    canNavigate: () => {
      // A switch may dispose an unfinished READ and reject its late result.
      // Do not confuse that with abandoning a draft, write or acknowledgement.
      if (!['appointments', 'settings', 'prosthetics', 'expenses'].includes(value.kind)) return value.controller.canClose();
      const state = value.controller.getState();
      return !state.closed && 'saveStatus' in state && state.saveStatus === 'idle'
        && !('draft' in state && state.draft) && !('pendingOperationId' in state && state.pendingOperationId);
    }, dispose: () => value.controller.dispose() });

/** Tabs of one already authorized coherent view, not another database scan or
 * cached authorization. The page must still own the exact workspace lease.
 * Writes/exports keep their independent fresh server authorization. */
export function reuseCloudOverviewTab(workspace: CloudReleaseWorkspace, kind: string, today: string): kind is CloudClinicOverviewTab {
  if (!['home', 'directory', 'patients', 'patient-file', 'appointments', 'labs', 'settings', 'finance', 'export'].includes(kind)
    || !(workspace.kind === 'home' || workspace.kind === 'directory' || workspace.kind === 'finance' || workspace.kind === 'export')) return false;
  const state = workspace.controller.getState();
  if (!state.snapshot || state.closed || state.loading || state.exporting || !workspace.canClose()) return false;
  // A month selected in Finance must never be labelled "today" on Home.
  // Reproject the same complete snapshot; this does not trigger another scan.
  if (kind === 'home' && (state.range.from !== today || state.range.to !== today)
    && !workspace.controller.setRange({ from: today, to: today })) return false;
  return workspace.controller.setTab(kind as CloudClinicOverviewTab);
}

/** Explicit section construction only. Domain controllers stay inert until a
 * user action; no SDK/data access, ID/clock or local configuration on mount. */
export async function createCloudReleaseWorkspace(context: CloudOperatingAdditionalContext,
  request: { kind: 'appointments'; initialDate: string } | { kind: 'settings' | 'prosthetics' | 'expenses' }
    | { kind: 'home' | 'directory' | 'finance' | 'export'; initialDate: string } | { kind: 'transfer' | 'whatsapp' }
    | { kind: 'prescription'; patientRecordId: string }): Promise<CloudReleaseWorkspace> {
  const requireActive = () => { if (!context.isActive()) throw new Error('تعذر فتح القسم في هذه الجلسة.'); };
  requireActive();
  if (request.kind === 'whatsapp') {
    const module = await import('./cloudWhatsAppWorkspaceController'); requireActive();
    return wrap({ kind: 'whatsapp' as const, controller: module.createCloudWhatsAppWorkspaceController({ ownerUid: context.ownerUid,
      isActive: context.isActive, getSnapshot: context.getClinicSnapshot, getContacts: context.getContacts,
      getSettings: context.getClinicSettings, getClinical: context.getClinical }) });
  }
  if (request.kind === 'home' || request.kind === 'directory' || request.kind === 'finance' || request.kind === 'export') {
    const module = await import('./cloudClinicOverviewController'); requireActive();
    const controller = module.createCloudClinicOverviewController({ getSnapshot: context.getClinicSnapshot, getSettings: context.getClinicSettings,
      isActive: context.isActive, initialDate: request.initialDate });
    controller.setTab(request.kind === 'export' ? 'export' : request.kind);
    const contactsBridge = createCloudOriginalContactsBridge({ getRepository: context.getContacts, isActive: context.isActive,
      onCommitted: () => controller.refresh() });
    const patientsBridge = createCloudOriginalPatientsBridge({ getRepository: context.getPatients, isActive: context.isActive,
      getDirectory: async () => { requireActive(); const cap = await context.getClinicSnapshot(); requireActive(); const value = await cap.readDirectory(); requireActive(); return value; },
      onCommitted: () => controller.refresh() });
    const appointmentsBridge = createCloudOriginalAppointmentsBridge({ getCapability: context.getAppointments, ownerUid: context.ownerUid,
      initialDate: request.initialDate, isActive: context.isActive, onCommitted: () => controller.refresh() });
    const labsBridge = createCloudOriginalLabsBridge(context, () => controller.refresh());
    const patientFileBridge = createCloudOriginalPatientFileBridge(context, () => controller.refresh());
    const settingsBridge = createCloudOriginalSettingsBridge(context, () => controller.refresh());
    const whatsAppBridge = createCloudOriginalWhatsAppBridge(context, () => controller.refresh());
    const canCloseEditors = () => contactsBridge.canClose() && patientsBridge.canClose() && appointmentsBridge.canClose() && labsBridge.canClose() && patientFileBridge.canClose() && settingsBridge.canClose() && whatsAppBridge.canClose();
    return Object.freeze({ kind: request.kind, controller, contactsBridge, patientsBridge, appointmentsBridge, labsBridge, patientFileBridge, settingsBridge, whatsAppBridge,
      canClose: () => controller.canClose() && canCloseEditors(),
      canNavigate: () => { const state = controller.getState(); return !state.closed && !state.exporting && canCloseEditors(); },
      dispose() { contactsBridge.dispose(); patientsBridge.dispose(); appointmentsBridge.dispose(); labsBridge.dispose(); patientFileBridge.dispose(); settingsBridge.dispose(); whatsAppBridge.dispose(); controller.dispose(); } });
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
