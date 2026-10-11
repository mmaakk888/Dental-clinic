import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { CLOUD_CATALOG_UI_STAGE, createCloudCatalogUiPreview } from './cloudCatalogUiStage';

test('catalog readiness stays frozen false and has no runtime opt-in', async () => {
  assert.equal(CLOUD_CATALOG_UI_STAGE.available, false); assert.equal(Object.isFrozen(CLOUD_CATALOG_UI_STAGE), true);
  assert.match(CLOUD_CATALOG_UI_STAGE.reason, /غير مفعّل/);
  const source = await readFile('src/utils/cloudCatalogUiStage.ts', 'utf8');
  assert.doesNotMatch(source, /import\.meta|process\.env|URLSearchParams|localStorage|sessionStorage/);
});
test('catalog preview is exactly empty and every data/draft/history/recovery action is inert', async () => {
  const preview = createCloudCatalogUiPreview(() => true), initial = preview.getState();
  assert.deepEqual(initial, { snapshot: null, loaded: false, loading: false, draft: null, saveStatus: 'idle',
    pendingOperationId: null, error: '', notice: '', closed: false, history: [], historyLoaded: false,
    historyLoading: false, historyNextAfterId: null });
  assert.equal(await preview.load(), false); assert.equal(preview.beginEdit(), false);
  assert.equal(preview.updateDraft({ examinationCents: 10000, services: [] }), false);
  assert.equal(preview.cancelDraft(), false); assert.equal(await preview.save(), false);
  assert.equal(await preview.retry(), false); assert.equal(await preview.cancelPending(), false);
  assert.equal(await preview.resume('90000000-0000-4000-8000-000000000001'), false);
  assert.equal(await preview.loadHistory(), undefined); assert.equal(await preview.loadMoreHistory(), undefined);
  assert.equal(preview.getState(), initial);
  assert.equal(Object.isFrozen(preview), true); assert.equal(Object.isFrozen(initial.history), true);
});
test('preview disposal notifies once, clears listeners and retained actions cannot reopen it', async () => {
  const preview = createCloudCatalogUiPreview(() => true); let notices = 0;
  preview.subscribe(state => { assert.equal(state.closed, true); notices++; });
  preview.subscribe(() => { throw new Error('PRIVATE_VIEW'); });
  const load = preview.load, edit = preview.beginEdit;
  preview.dispose(); preview.dispose(); assert.equal(notices, 1);
  assert.equal(await load(), false); assert.equal(edit(), false); assert.equal(preview.getState().closed, true);
  preview.subscribe(() => { notices++; }); preview.dispose(); assert.equal(notices, 1);
});
test('preview lifetime loss is permanent even after the same view becomes active again', () => {
  let active = true; const preview = createCloudCatalogUiPreview(() => active); let notices = 0;
  preview.subscribe(() => { notices++; }); active = false;
  assert.equal(preview.getState().closed, true); active = true;
  assert.equal(preview.getState().closed, true); assert.equal(preview.beginEdit(), false); assert.equal(notices, 1);
});
test('hostile or non-boolean lifetime callbacks fail closed without private exceptions', () => {
  for (const callback of [() => { throw new Error('PRIVATE_LIFETIME'); }, () => 'yes' as any, () => undefined as any]) {
    const preview = createCloudCatalogUiPreview(callback);
    assert.equal(preview.getState().closed, true); assert.equal(preview.beginEdit(), false);
  }
});
test('preview unsubscribe and reentrant lifetime callbacks do not fabricate a catalog', () => {
  let active = true, notices = 0;
  const preview = createCloudCatalogUiPreview(() => { if (typeof preview !== 'undefined') preview.getState(); return active; });
  const unsubscribe = preview.subscribe(() => { notices++; }); unsubscribe(); active = false;
  assert.equal(preview.getState().closed, true); assert.equal(notices, 0); assert.equal(preview.getState().snapshot, null);
});
test('preview graph cannot initialize a controller, SDK, storage, random ID, clock or provider', async () => {
  const result = await build({ entryPoints: ['src/utils/cloudCatalogUiStage.ts'], bundle: true, write: false,
    metafile: true, platform: 'browser', format: 'esm', logLevel: 'silent' });
  assert.deepEqual(Object.keys(result.metafile!.inputs), ['src/utils/cloudCatalogUiStage.ts']);
  assert.doesNotMatch(result.outputFiles[0].text, /firebase|initializeApp|localStorage|sessionStorage|fetch\(|randomUUID|new Date|createCloudCatalogWorkspaceController/);
});
