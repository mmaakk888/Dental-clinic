import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { CLOUD_COMPLETE_RELEASE_UI, createCloudReleaseWorkspace } from './cloudReleaseWorkspaceFactories';
import type { CloudOperatingAdditionalContext } from './cloudOperatingPageController';
const ID = '90000000-0000-4000-8000-000000000001';
function context() {
  let active = true; const calls: string[] = [];
  const get = async () => { calls.push('capability'); throw new Error('No data reads on section construction'); };
  const value: CloudOperatingAdditionalContext = { ownerUid: 'synthetic-release-owner', isActive: () => active,
    getPatients: get, getContacts: get, getClinical: get, getServiceCatalog: get, getAppointments: get,
    getClinicSettings: get, getProsthetics: get, getExpenses: get, getClinicSnapshot: get };
  return { value, calls, close: () => { active = false; } };
}
test('complete-release UI is frozen source readiness; no partial module can change it', () => {
  assert.equal(typeof CLOUD_COMPLETE_RELEASE_UI.available, 'boolean'); assert.equal(Object.isFrozen(CLOUD_COMPLETE_RELEASE_UI), true);
  assert.throws(() => { (CLOUD_COMPLETE_RELEASE_UI as { available: boolean }).available = !CLOUD_COMPLETE_RELEASE_UI.available; });
});
for (const request of [{ kind: 'appointments', initialDate: '2026-10-13' }, { kind: 'settings' }, { kind: 'prosthetics' },
  { kind: 'prescription', patientRecordId: ID }, { kind: 'expenses' }, { kind: 'transfer' }, { kind: 'whatsapp' },
  { kind: 'home', initialDate: '2026-10-13' }, { kind: 'directory', initialDate: '2026-10-13' },
  { kind: 'finance', initialDate: '2026-10-13' }, { kind: 'export', initialDate: '2026-10-13' }] as const) {
  test(`${request.kind} section construction binds scoped context but never initializes capabilities or reads on opening`, async () => {
    const h = context(), section = await createCloudReleaseWorkspace(h.value, request);
    assert.equal(section.kind, request.kind); assert.deepEqual(h.calls, []); assert.equal(Object.isFrozen(section), true);
    assert.equal(section.canClose(), true); assert.equal(section.controller.getState().closed, false);
    h.close(); assert.equal(section.canClose(), false); assert.equal(section.controller.getState().closed, true);
    section.dispose(); assert.deepEqual(h.calls, []);
  });
}
test('revoked context, invalid Rx target and invalid schedule date never acquire a data capability', async () => {
  const h = context();
  await assert.rejects(createCloudReleaseWorkspace(h.value, { kind: 'prescription', patientRecordId: '451' }));
  await assert.rejects(createCloudReleaseWorkspace(h.value, { kind: 'appointments', initialDate: '2026-02-30' }));
  h.close(); await assert.rejects(createCloudReleaseWorkspace(h.value, { kind: 'settings' })); assert.deepEqual(h.calls, []);
});
test('section factory graph contains no local clinic Storage/App, Auth initialization, backup or migration', async () => {
  const result = await build({ entryPoints: ['src/utils/cloudReleaseWorkspaceFactories.ts'], bundle: true, write: false,
    format: 'esm', platform: 'browser', packages: 'external', metafile: true, logLevel: 'silent' });
  const inputs = Object.keys(result.metafile!.inputs);
  for (const name of ['App.tsx', 'storage.ts', 'firebaseService.ts', 'firebaseCloud', 'cloudOperatingAuth.ts', 'cloudAuthSetup.ts']) {
    assert.equal(inputs.some(path => path.includes(name)), false, name);
  }
});
