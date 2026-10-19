import test from 'node:test';
import assert from 'node:assert/strict';
import { originalBridgeFixture } from './testing/cloudOriginalBridgeFixtures';
import { snapshotPath } from './testing/cloudClinicSnapshotFixtures';
import { createCloudOriginalSettingsBridge } from './cloudOriginalSettingsBridge';
import { projectOriginalContent } from './cloudOriginalSettingsProjection';
import { projectOriginalClinicViews } from './cloudOriginalViewProjection';

test('original content editor saves independent mobile/desktop settings through the existing atomic protected settings record', async () => {
  const h = await originalBridgeFixture(false), snapshot = await h.snapshot(), bridge = createCloudOriginalSettingsBridge(h.context, h.refresh);
  const value = projectOriginalContent(snapshot.settings.clinicSettings.data.content); value.labels.dockAppearance!.moreSections = ['lab'];
  value.labels.dockAppearance!.desktop!.order.reverse(); await bridge.content(snapshot, value);
  const current = h.docs.get(snapshotPath('settings', 'clinicSettings')); assert.deepEqual(current.data.content.mobile.moreSections, ['lab']);
  assert.deepEqual(current.data.content.desktop.order, value.labels.dockAppearance!.desktop!.order); assert.equal(h.counts().writes, 1);
  assert.equal(bridge.canClose(), true);
});
test('original identity editor retains its original setting command on lost ACK and rejects changed submitted values', async () => {
  const h = await originalBridgeFixture(false), snapshot = await h.snapshot(), bridge = createCloudOriginalSettingsBridge(h.context, h.refresh);
  const value = { clinicName: 'عيادة اختبار جديدة', theme: snapshot.settings.clinicSettings.data.theme, logo: undefined };
  h.loseReply(); await assert.rejects(bridge.identity(snapshot, value)); const operation = bridge.getState().pendingOperationId; assert.ok(operation);
  await assert.rejects(bridge.identity(snapshot, { ...value, clinicName: 'تعديل أثناء الشك' }));
  await bridge.identity(snapshot, value); assert.equal(h.docs.get(snapshotPath('settings', 'clinicSettings')).data.identity.clinicName, value.clinicName);
  assert.equal([...h.docs.keys()].filter(path => path.includes('/settingsOperations/')).length, 1); assert.equal(bridge.canClose(), true);
});
test('original drug editor new local draft IDs do not allocate duplicate medications on a repeated save', async () => {
  const h = await originalBridgeFixture(false), snapshot = await h.snapshot(), bridge = createCloudOriginalSettingsBridge(h.context, h.refresh);
  const input = () => [{ id: `drug_${crypto.randomUUID()}`, name: 'دواء مصطنع فقط', category: 'فئة اختبار', defaultDosage: '', defaultDuration: '' }];
  h.loseReply(); await assert.rejects(bridge.drugs(snapshot, input())); await bridge.drugs(snapshot, input());
  const current = h.docs.get(snapshotPath('settings', 'clinicSettings')); assert.equal(current.data.medications.length, 1);
  assert.match(current.data.medications[0].medicationId, /^[0-9a-f-]{36}$/); assert.equal(current.data.medications[0].active, true);
});
test('original bulk pricing editor uses one retained protected mutation per step and never repeats an acknowledged prefix', async () => {
  const h = await originalBridgeFixture(false), snapshot = await h.snapshot(), bridge = createCloudOriginalSettingsBridge(h.context, h.refresh);
  const value = { examinationFee: 125, serviceTypes: ['خدمة أولى مصطنعة', 'خدمة ثانية مصطنعة'], clinicalPrices: { 'خدمة أولى مصطنعة': 100, 'خدمة ثانية مصطنعة': 200 }, crownPrices: {} };
  h.loseReply(); await assert.rejects(bridge.prices(snapshot, value)); const operation = bridge.getCatalogState().pendingOperationId; assert.ok(operation);
  await assert.rejects(bridge.prices(snapshot, { ...value, examinationFee: 150 })); await bridge.prices(snapshot, value);
  const current = h.docs.get(snapshotPath('settings', 'serviceCatalog')); assert.equal(current.data.examinationCents, 12500);
  assert.deepEqual(current.data.services.map((row: any) => row.priceCents), [10000, 20000]);
  assert.equal([...h.docs.keys()].filter(path => path.includes('/catalogOperations/')).length, 3); assert.equal(bridge.canClose(), true);
});
test('per-lab original pricing changes preserve costs of other labs and use the configured billing basis', async () => {
  const h = await originalBridgeFixture(), snapshot = await h.snapshot(), bridge = createCloudOriginalSettingsBridge(h.context, h.refresh);
  const lab = projectOriginalClinicViews(snapshot).labs[0]; await bridge.labPricing(snapshot, lab.id, lab.services.map(row => ({ ...row, price: 250 })), lab);
  const current = h.docs.get(snapshotPath('labDefinitions', lab.id)); assert.equal(current.data.costs[0].unitCostCents, 25000);
  assert.equal(current.data.costs[0].billingBasis, snapshot.records.labDefinitions[0].data.costs[0].billingBasis);
  assert.deepEqual((await h.snapshot()).records.labCases, snapshot.records.labCases);
});
test('original settings never overwrite a newer device revision and dirty state blocks only real unsaved edits', async () => {
  const h = await originalBridgeFixture(false), snapshot = await h.snapshot(), bridge = createCloudOriginalSettingsBridge(h.context, h.refresh);
  assert.equal(bridge.canClose(), true); bridge.setDirty('identity', true); assert.equal(bridge.canClose(), false); bridge.setDirty('identity', false);
  h.docs.get(snapshotPath('settings', 'clinicSettings')).revision++;
  await assert.rejects(bridge.content(snapshot, projectOriginalContent(snapshot.settings.clinicSettings.data.content)), /تغيّرت الإعدادات/);
  assert.equal(h.counts().writes, 0); bridge.dispose(); await assert.rejects(bridge.drugs(snapshot, []));
});
