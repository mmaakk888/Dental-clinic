import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { CLOUD_CONTACTS_UI_STAGE, createCloudContactUiPreview } from './cloudContactUiStage';

test('cloud contacts stage cannot be enabled by mutable UI flags or ambient browser settings', () => {
  assert.equal(CLOUD_CONTACTS_UI_STAGE.available, false);
  assert.equal(Object.isFrozen(CLOUD_CONTACTS_UI_STAGE), true);
  assert.throws(() => { (CLOUD_CONTACTS_UI_STAGE as { available: boolean }).available = true; });
  assert.match(CLOUD_CONTACTS_UI_STAGE.reason, /غير مفعّل/u);
  assert.match(CLOUD_CONTACTS_UI_STAGE.reason, /ملفات المرضى/u);
});

test('empty design preview initializes no SDK, has no records, and cannot obtain a data adapter', async () => {
  let alive = true;
  const preview = createCloudContactUiPreview(() => alive);
  assert.deepEqual(preview.getState().records, []);
  assert.equal(preview.getState().loaded, false);
  assert.equal(preview.getState().draft, null);
  await preview.loadFirst();
  await preview.loadMore();
  await preview.save();
  assert.equal(preview.beginCreate(), false);
  assert.equal(preview.changeDraft({ name: 'Synthetic preview', mobile: '01000000000' }), false);
  assert.equal(preview.cancelDraft(), false);
  assert.deepEqual(preview.getState().records, []);
  assert.equal(preview.getState().loaded, false);
  assert.equal(preview.getState().error, '');
  assert.equal(preview.getState().draft, null);
  alive = false;
  assert.equal(preview.getState().closed, true);
  assert.equal(preview.beginCreate(), false);
});

test('preview disposal is idempotent and clears all temporary view state', () => {
  const preview = createCloudContactUiPreview(() => true);
  preview.dispose();
  preview.dispose();
  assert.equal(preview.getState().closed, true);
  assert.equal(preview.getState().draft, null);
  assert.deepEqual(preview.getState().records, []);
});

test('preview dependency graph excludes Auth, SDK, local storage, records and provider clients', async () => {
  const output = await build({ entryPoints: ['src/utils/cloudContactUiStage.ts'], bundle: true,
    write: false, metafile: true, platform: 'browser', logLevel: 'silent' });
  for (const input of Object.keys(output.metafile!.inputs)) {
    assert.doesNotMatch(input, /node_modules\/firebase|cloudOperatingAuth|firebaseCloudContacts|storage\.ts|src\/App\.tsx|firebaseService|offlineSync|aiService|firebase-applet-config/iu);
  }
});
