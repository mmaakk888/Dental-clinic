import type { CloudCatalogWorkspaceController, CloudCatalogWorkspaceState } from './cloudCatalogWorkspaceController';
import { CLOUD_COMPLETE_RELEASE_UI } from './cloudReleaseReadiness';

/** Reviewed readiness only, NOT authorization; no URL/storage/env override. */
export const CLOUD_CATALOG_UI_STAGE = Object.freeze({
  available: CLOUD_COMPLETE_RELEASE_UI.available,
  reason: 'فهرس الخدمات السحابي غير مفعّل؛ يلزم اكتمال الترابط والقواعد المحمية واختبارات الاسترجاع قبل التشغيل.',
});

/** Empty design controller. It has no capability factory, SDK, browser storage,
 * clock, random ID generator or default catalog, even through retained actions. */
export function createCloudCatalogUiPreview(isViewActive: () => boolean): CloudCatalogWorkspaceController {
  const empty = (closed = false): CloudCatalogWorkspaceState => Object.freeze({ snapshot: null,
    loaded: false, loading: false, draft: null, saveStatus: 'idle', pendingOperationId: null,
    error: '', notice: '', closed, history: Object.freeze([]), historyLoaded: false, historyLoading: false, historyNextAfterId: null });
  let state = empty(), checking = false;
  const listeners = new Set<(value: CloudCatalogWorkspaceState) => void>();
  function dispose() {
    if (state.closed) return;
    state = empty(true);
    for (const listener of [...listeners]) { try { listener(state); } catch { /* A view grants no authority. */ } }
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
  }, load: async () => false, beginEdit: () => false, updateDraft: () => false,
  cancelDraft: () => false, save: async () => false, retry: async () => false,
  cancelPending: async () => false, resume: async () => false,
  loadHistory: async () => undefined, loadMoreHistory: async () => undefined, dispose });
}
