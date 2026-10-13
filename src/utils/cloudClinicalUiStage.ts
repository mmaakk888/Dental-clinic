import { CloudClinicalError } from './cloudClinicalRepository';
import { createCloudClinicalWorkspaceController, type CloudClinicalWorkspaceController } from './cloudClinicalWorkspaceController';
import { CLOUD_COMPLETE_RELEASE_UI } from './cloudReleaseReadiness';
import { createCloudClinicalRecoveryController, type CloudClinicalRecoveryController } from './cloudClinicalRecoveryController';
import type { CloudClinicalVisitWorkspaceController, CloudClinicalVisitWorkspaceState } from './cloudClinicalVisitWorkspaceController';

/** Reviewed readiness only, NOT authorization; no URL/storage/env override. */
export const CLOUD_CLINICAL_UI_STAGE = Object.freeze({
  available: CLOUD_COMPLETE_RELEASE_UI.available,
  reason: 'التشغيل السريري السحابي غير مفعّل بعد؛ يلزم اكتمال الترابط والقواعد المحمية واختبارات الاسترجاع قبل تشغيل العيادة.',
});
export type CloudClinicalWorkspaceBundle = Readonly<{
  file: CloudClinicalWorkspaceController; recovery: CloudClinicalRecoveryController;
  visit?: CloudClinicalVisitWorkspaceController;
}>;

/** No catalog/clinical capability, clock, IDs or form data in design previews. */
function createVisitPreview(isViewActive: () => boolean): CloudClinicalVisitWorkspaceController {
  const empty = (closed = false): CloudClinicalVisitWorkspaceState => Object.freeze({ phase: 'idle', snapshot: null,
    catalog: null, draft: null, error: '', closed });
  let state = empty(), checking = false;
  const listeners = new Set<(value: CloudClinicalVisitWorkspaceState) => void>();
  function dispose() {
    if (state.closed) return;
    state = empty(true);
    for (const listener of [...listeners]) { try { listener(state); } catch { /* No authority from views. */ } }
    listeners.clear();
  }
  function getState() {
    if (!state.closed && !checking) {
      checking = true;
      let active = false;
      try { active = isViewActive() === true; } catch { /* Fail closed. */ }
      finally { checking = false; }
      if (!active) dispose();
    }
    return state;
  }
  return Object.freeze({ getState, subscribe(listener) {
    if (getState().closed) return () => undefined;
    listeners.add(listener); return () => { listeners.delete(listener); };
  }, begin: async () => false, chooseService: () => false, removeService: () => false,
    setServicePrice: () => false, setServiceTooth: () => false, setTeeth: () => false,
    setExaminationEnabled: () => false, save: async () => false, cancel: () => false,
    retry: async () => false, cancelPending: async () => false, dispose });
}

/** Empty inert design preview. It cannot request Auth, an SDK, local records,
 * settings or a cloud capability, even through retained action callbacks. */
export function createCloudClinicalUiPreview(isViewActive: () => boolean): CloudClinicalWorkspaceBundle {
  const getCapability = async () => { throw new CloudClinicalError('unavailable'); };
  const file = createCloudClinicalWorkspaceController({ isActive: isViewActive, getCapability });
  const recovery = createCloudClinicalRecoveryController({ isActive: isViewActive, getCapability });
  return Object.freeze({
    file: Object.freeze({ ...file, open: async () => false, refresh: async () => false, setDraftDirty: () => false,
      saveVisit: async () => false, addReceipt: async () => false, saveProgress: async () => false,
      retry: async () => false, cancelPending: async () => false, resume: async () => false }),
    recovery: Object.freeze({ ...recovery, loadFirst: async () => undefined, loadMore: async () => undefined }),
    visit: createVisitPreview(isViewActive),
  });
}
