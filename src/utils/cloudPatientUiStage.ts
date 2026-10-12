import { CloudPatientError } from './cloudPatientRepository';
import { createCloudPatientWorkspaceController, type CloudPatientWorkspaceController } from './cloudPatientWorkspaceController';

/** Reviewed release boundary, not authorization. No URL, storage or env override. */
export const CLOUD_PATIENTS_UI_STAGE = Object.freeze({
  available: false,
  reason: 'حفظ ملفات المرضى السحابي غير مفعّل بعد. يلزم ربط الجلسات والتحصيلات والتركيبات وبقية سجلات العيادة واختبار الاسترجاع قبل التشغيل.',
});

/** Empty design preview: even a mistaken/retained action cannot obtain an adapter. */
export function createCloudPatientUiPreview(isViewActive: () => boolean): CloudPatientWorkspaceController {
  const controller = createCloudPatientWorkspaceController({
    isActive: isViewActive,
    getRepository: async () => { throw new CloudPatientError('unavailable'); },
  });
  return Object.freeze({ ...controller,
    refresh: async () => undefined,
    loadMore: async () => undefined,
    select: async () => undefined,
    beginCreate: () => false,
    beginEdit: () => false,
    updateProfile: () => false,
    cancelDraft: () => false,
    save: async () => undefined,
    cancelPending: async () => false,
    resume: async () => false,
    recovery: Object.freeze({ ...controller.recovery, loadFirst: async () => undefined, loadMore: async () => undefined }),
    findByFileNo: async () => undefined,
    findByPhone: async () => undefined,
  });
}
