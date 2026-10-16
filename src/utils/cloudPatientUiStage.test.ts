import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { CLOUD_PATIENTS_UI_STAGE, createCloudPatientUiPreview } from './cloudPatientUiStage';
import { CLOUD_COMPLETE_RELEASE_UI } from './cloudReleaseReadiness';

test('patient UI availability is frozen source-only readiness and never authorization', () => {
  assert.equal(CLOUD_PATIENTS_UI_STAGE.available, CLOUD_COMPLETE_RELEASE_UI.available);
  assert.equal(Object.isFrozen(CLOUD_PATIENTS_UI_STAGE), true);
  assert.throws(() => { (CLOUD_PATIENTS_UI_STAGE as { available: boolean }).available = !CLOUD_PATIENTS_UI_STAGE.available; });
});

test('patient preview is empty and all retained read/draft/save callbacks are inert', async () => {
  let alive = true;
  const preview = createCloudPatientUiPreview(() => alive);
  const actions = { ...preview };
  assert.deepEqual(preview.getState().records, []);
  assert.equal(preview.getState().selected, null);
  assert.equal(preview.getState().draft, null);
  assert.equal(preview.getState().loaded, false);
  await actions.refresh(); await actions.loadMore(); await actions.save();
  assert.equal(await actions.cancelPending(), false); assert.equal(await actions.resume('20000000-0000-4000-8000-000000000001'), false);
  await actions.recovery.loadFirst(); await actions.recovery.loadMore();
  await actions.findByFileNo(1); await actions.findByPhone({ mobile: '01000000001' });
  await actions.select('00000000-0000-4000-8000-000000000001');
  assert.equal(actions.beginCreate(), false);
  assert.equal(actions.updateProfile({ name: 'Synthetic preview' }), false);
  assert.equal(actions.cancelDraft(), false);
  assert.deepEqual(preview.getState().records, []);
  assert.equal(preview.getState().draft, null);
  assert.equal(preview.getState().error, '');
  assert.equal(preview.getState().loaded, false);
  assert.equal(preview.getState().pendingOperationId, null); assert.equal(preview.getState().recoveryLoading, false);
  assert.deepEqual(preview.recovery.getState().records, []); assert.equal(preview.recovery.getState().error, '');
  alive = false;
  assert.equal(preview.getState().closed, true);
  assert.equal(preview.recovery.getState().closed, true);
  await actions.refresh(); await actions.findByFileNo(1); await actions.save();
  assert.equal(actions.beginCreate(), false);
  preview.dispose(); preview.dispose();
  assert.deepEqual(preview.getState().records, []);
});

test('patient preview dependency graph excludes Auth, SDK, old backup and local clinical storage', async () => {
  const output = await build({ entryPoints: ['src/utils/cloudPatientUiStage.ts'], bundle: true,
    write: false, metafile: true, platform: 'browser', logLevel: 'silent' });
  for (const input of Object.keys(output.metafile!.inputs)) {
    assert.doesNotMatch(input, /node_modules\/firebase|cloudOperatingAuth|firebaseCloudPatients|storage\.ts|src\/App\.tsx|firebaseService|offlineSync|aiService|firebase-applet-config/iu);
  }
});
