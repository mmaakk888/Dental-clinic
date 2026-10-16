import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { CLOUD_CLINICAL_UI_STAGE, createCloudClinicalUiPreview } from './cloudClinicalUiStage';
import { CLOUD_COMPLETE_RELEASE_UI } from './cloudReleaseReadiness';

const ID = '10000000-0000-4000-8000-000000000001';
test('clinical readiness follows the immutable central source flag, not authorization', () => {
  assert.equal(CLOUD_CLINICAL_UI_STAGE.available, CLOUD_COMPLETE_RELEASE_UI.available); assert.equal(Object.isFrozen(CLOUD_CLINICAL_UI_STAGE), true);
  assert.throws(() => { (CLOUD_CLINICAL_UI_STAGE as { available: boolean }).available = !CLOUD_CLINICAL_UI_STAGE.available; });
});
test('clinical file/history preview remains empty and every retained action is inert', async () => {
  let alive = true; const preview = createCloudClinicalUiPreview(() => alive), file = { ...preview.file }, history = { ...preview.recovery };
  assert.equal(Object.isFrozen(preview), true); assert.equal(Object.isFrozen(preview.file), true); assert.equal(Object.isFrozen(preview.recovery), true);
  assert.equal(file.getState().snapshot, null); assert.equal(file.getState().draftDirty, false);
  assert.equal(file.getState().patientRecordId, null); assert.deepEqual(history.getState().records, []);
  const malicious = new Proxy({}, { ownKeys() { throw new Error('Preview must not even inspect input.'); } });
  assert.equal(await file.open(ID), false); assert.equal(await file.refresh(), false);
  assert.equal(file.setDraftDirty(ID, true), false); assert.equal(await file.saveVisit(ID, malicious as never, 100), false);
  assert.equal(await file.addReceipt(ID, ID, malicious as never), false); assert.equal(await file.saveProgress(ID, ID, malicious as never), false);
  assert.equal(await file.retry(), false); assert.equal(await file.resume(ID), false); assert.equal(await file.cancelPending(), false);
  await history.loadFirst(); await history.loadMore();
  assert.equal(file.getState().loaded, false); assert.equal(file.getState().error, ''); assert.equal(file.getState().pendingOperationId, null);
  assert.equal(history.getState().loaded, false); assert.equal(history.getState().error, ''); assert.deepEqual(history.getState().records, []);
  alive = false; assert.equal(file.getState().closed, true); assert.equal(history.getState().closed, true);
  alive = true; assert.equal(await file.open(ID), false); await history.loadFirst();
  assert.equal(file.getState().closed, true); assert.equal(history.getState().closed, true);
  preview.file.dispose(); preview.recovery.dispose();
});
test('preview disposal publishes only empty closed state and clears both controllers without reads', async () => {
  const preview = createCloudClinicalUiPreview(() => true), states: unknown[] = [];
  preview.file.subscribe(value => states.push(value)); preview.recovery.subscribe(value => states.push(value));
  preview.file.dispose(); preview.recovery.dispose(); preview.file.dispose(); preview.recovery.dispose();
  assert.equal(states.length, 2); assert.equal(preview.file.getState().closed, true); assert.equal(preview.recovery.getState().closed, true);
  assert.deepEqual(preview.recovery.getState().records, []); assert.equal(preview.file.getState().snapshot, null);
});
test('clinical preview graph excludes SDK/Auth/local clinic storage and prior backup configuration', async () => {
  const result = await build({ entryPoints: ['src/utils/cloudClinicalUiStage.ts'], bundle: true,
    platform: 'browser', write: false, metafile: true, logLevel: 'silent' });
  for (const path of Object.keys(result.metafile!.inputs)) assert.doesNotMatch(path, /firebase|storage\.ts|App\.tsx|cloudOperatingAuth|offlineSync|aiService/i);
});

test('priced visit design preview is empty and all retained actions ignore even hostile inputs', async () => {
  let active = true; const bundle = createCloudClinicalUiPreview(() => active), visit = bundle.visit!;
  assert.ok(visit); assert.equal(Object.isFrozen(visit), true);
  assert.deepEqual(visit.getState(), { phase: 'idle', snapshot: null, catalog: null, draft: null, error: '', closed: false });
  const hostile = new Proxy({}, { get() { throw new Error('Do not inspect preview input'); }, ownKeys() { throw new Error('Do not inspect preview input'); } });
  assert.equal(await visit.begin(hostile as never), false); assert.equal(visit.chooseService(ID), false);
  assert.equal(visit.removeService(ID), false); assert.equal(visit.setServicePrice(ID, 10000), false);
  assert.equal(visit.setServiceTooth(ID, 'ur5'), false); assert.equal(visit.setTeeth(hostile as never), false);
  assert.equal(visit.setExaminationEnabled(true), false); assert.equal(await visit.save(hostile as never, 10000), false);
  assert.equal(visit.cancel(), false); assert.equal(await visit.retry(), false); assert.equal(await visit.cancelPending(), false);
  active = false; assert.equal(visit.getState().closed, true); active = true;
  assert.equal(visit.getState().closed, true); assert.equal(await visit.begin(hostile as never), false);
  bundle.file.dispose(); bundle.recovery.dispose(); visit.dispose();
});

test('visit preview disposal notifies once with empty closed state, including invalid runtime callback', () => {
  let fail = false; const preview = createCloudClinicalUiPreview(() => { if (fail) throw new Error('PRIVATE'); return true; });
  const states: unknown[] = []; preview.visit!.subscribe(value => states.push(value));
  fail = true; assert.equal(preview.visit!.getState().closed, true); preview.visit!.dispose();
  assert.equal(states.length, 1); assert.deepEqual(states[0], { phase: 'idle', snapshot: null, catalog: null, draft: null, error: '', closed: true });
  preview.file.dispose(); preview.recovery.dispose();
});
