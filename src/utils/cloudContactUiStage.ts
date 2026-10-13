import { CloudContactError } from './cloudContactRepository';
import { createCloudContactWorkspaceController } from './cloudContactWorkspaceController';
import { CLOUD_COMPLETE_RELEASE_UI } from './cloudReleaseReadiness';

/**
 * A reviewed release boundary, NOT authorization. Neither URLs, storage nor
 * environment variables can activate a clinical feature while live Rules and
 * the patient-derived directory are still unintegrated. Keep server checks.
 */
export const CLOUD_CONTACTS_UI_STAGE = Object.freeze({
  available: CLOUD_COMPLETE_RELEASE_UI.available,
  reason: 'الحفظ السحابي غير مفعّل بعد. يلزم ربط جهات الاتصال بملفات المرضى وبقية سجلات العيادة واختبار الصلاحيات قبل التشغيل.',
});

/** Empty, read-only design preview. Even a mistaken handler has no data adapter. */
export function createCloudContactUiPreview(isViewActive: () => boolean): ReturnType<typeof createCloudContactWorkspaceController> {
  const controller = createCloudContactWorkspaceController({
    isActive: isViewActive,
    getRepository: async () => { throw new CloudContactError('unavailable'); },
  });
  // Defense against a retained or mistakenly wired action: the preview cannot
  // even construct a contact draft, and never acquires a repository.
  return Object.freeze({ ...controller,
    recovery: Object.freeze({ ...controller.recovery,
      loadFirst: async () => undefined,
      loadMore: async () => undefined,
    }),
    loadFirst: async () => undefined,
    loadMore: async () => undefined,
    beginCreate: () => false,
    beginEdit: () => false,
    beginDelete: () => false,
    changeDraft: () => false,
    cancelDraft: () => false,
    save: async () => undefined,
    changeCampaignConsent: () => false,
    resume: async () => false,
    cancelPending: async () => false,
  });
}
