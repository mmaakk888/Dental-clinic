import { CloudClinicalError } from './cloudClinicalRepository';
import { createCloudClinicalWorkspaceController, type CloudClinicalWorkspaceController } from './cloudClinicalWorkspaceController';
import { createCloudClinicalRecoveryController, type CloudClinicalRecoveryController } from './cloudClinicalRecoveryController';

/** Reviewed readiness only, NOT authorization; no URL/storage/env override. */
export const CLOUD_CLINICAL_UI_STAGE = Object.freeze({
  available: false,
  reason: 'التشغيل السريري السحابي غير مفعّل بعد؛ يلزم اكتمال الترابط والقواعد المحمية واختبارات الاسترجاع قبل تشغيل العيادة.',
});
export type CloudClinicalWorkspaceBundle = Readonly<{
  file: CloudClinicalWorkspaceController; recovery: CloudClinicalRecoveryController;
}>;

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
  });
}
