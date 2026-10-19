import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudClinicSnapshotReader, CLOUD_SNAPSHOT_COLLECTIONS, CLOUD_SNAPSHOT_READ_CONCURRENCY, CloudClinicSnapshotError } from './cloudClinicSnapshot';
import { createCloudClinicOverviewController } from './cloudClinicOverviewController';
import { reuseCloudOverviewTab, type CloudReleaseWorkspace } from './cloudReleaseWorkspaceFactories';
import { makeClinicSnapshotFixture, snapshotDigest, SNAPSHOT_TIME } from './testing/cloudClinicSnapshotFixtures';

const pause = () => new Promise<void>(resolve => setTimeout(resolve, 2));

test('full snapshot reads in bounded parallel groups, with one server time and stable collection order', async () => {
  const fixture = await makeClinicSnapshotFixture(false);
  let running = 0, peak = 0;
  const adapter = { ...fixture.adapter, query: async (input: Parameters<typeof fixture.adapter.query>[0]) => {
    running++; peak = Math.max(peak, running);
    try { await pause(); return await fixture.adapter.query(input); } finally { running--; }
  } };
  const reader = createCloudClinicSnapshotReader(adapter, { digest: snapshotDigest });
  assert.equal(fixture.probes(), 0);
  const result = await reader.readFull();
  assert.equal(peak, CLOUD_SNAPSHOT_READ_CONCURRENCY);
  assert.equal(running, 0);
  assert.equal(fixture.probes() + fixture.calls.length, 21);
  assert.ok(fixture.calls.every(query => query.readTime === SNAPSHOT_TIME));
  assert.deepEqual(Object.keys(result.records), CLOUD_SNAPSHOT_COLLECTIONS);
  assert.equal(result.counter.lastFileNo, 0);
});

test('a failed concurrent page cannot turn into a partial financial snapshot', async () => {
  const fixture = await makeClinicSnapshotFixture(false);
  const adapter = { ...fixture.adapter, query: async (input: Parameters<typeof fixture.adapter.query>[0]) => {
    await pause();
    if (input.collection === 'patientAccounts') throw new Error('synthetic-unavailable-page');
    return fixture.adapter.query(input);
  } };
  await assert.rejects(createCloudClinicSnapshotReader(adapter, { digest: snapshotDigest }).readFull(), CloudClinicSnapshotError);
});

test('bounded concurrent pages still reject an actual owner/view lease loss', async () => {
  const fixture = await makeClinicSnapshotFixture(false);
  const adapter = { ...fixture.adapter, query: async (input: Parameters<typeof fixture.adapter.query>[0]) => {
    await pause(); fixture.active(false); return fixture.adapter.query(input);
  } };
  await assert.rejects(createCloudClinicSnapshotReader(adapter, { digest: snapshotDigest }).readFull(), CloudClinicSnapshotError);
});

test('overview tab navigation preserves the same coherent snapshot without another capability/read', async () => {
  const fixture = await makeClinicSnapshotFixture(false), snapshot = await createCloudClinicSnapshotReader(fixture.adapter, { digest: snapshotDigest }).readFull();
  let reads = 0, authorizations = 0, active = true;
  const controller = createCloudClinicOverviewController({ initialDate: '2026-10-13', isActive: () => active,
    getSnapshot: async () => { authorizations++; return { readFull: async () => { reads++; return snapshot; } }; } });
  const workspace: CloudReleaseWorkspace = { kind: 'home', controller, canClose: controller.canClose, dispose: controller.dispose };
  assert.equal(reuseCloudOverviewTab(workspace, 'finance', '2026-10-13'), false);
  assert.equal(await controller.refresh(), true);
  for (const tab of ['finance', 'directory', 'patients', 'patient-file', 'appointments', 'labs', 'settings', 'export', 'home'] as const) {
    assert.equal(reuseCloudOverviewTab(workspace, tab, '2026-10-13'), true);
    assert.equal(controller.getState().tab, tab);
    assert.equal(controller.getState().snapshot, snapshot);
  }
  assert.equal(reads, 1); assert.equal(authorizations, 1);
  assert.equal(reuseCloudOverviewTab(workspace, 'expenses', '2026-10-13'), false,
    'a workspace outside the coherent overview cannot reuse its navigation lease');
  controller.setRange({ from: '2026-10-01', to: '2026-10-13' });
  assert.equal(reuseCloudOverviewTab(workspace, 'home', '2026-10-13'), true);
  assert.deepEqual(controller.getState().range, { from: '2026-10-13', to: '2026-10-13' });
  assert.equal(reads, 1, 'returning home resets the finance date range without a data reread');
  // The explicit refresh is never swallowed by the navigation optimization.
  assert.equal(await controller.refresh(), true); assert.equal(reads, 2);
  active = false;
  assert.equal(reuseCloudOverviewTab(workspace, 'finance', '2026-10-13'), false);
  assert.equal(controller.getState().snapshot, null);
});

test('no extra settings capability is acquired when coherent branding has no configured logo', async () => {
  const fixture = await makeClinicSnapshotFixture(false), snapshot = await createCloudClinicSnapshotReader(fixture.adapter, { digest: snapshotDigest }).readFull();
  let settingsReads = 0;
  const controller = createCloudClinicOverviewController({ initialDate: '2026-10-13', isActive: () => true,
    getSnapshot: async () => ({ readFull: async () => snapshot }),
    getSettings: async () => { settingsReads++; throw new Error('not-required-without-logo'); } });
  assert.equal(await controller.refresh(), true);
  assert.equal(settingsReads, 0);
  assert.equal(controller.getState().snapshot, snapshot);
});
