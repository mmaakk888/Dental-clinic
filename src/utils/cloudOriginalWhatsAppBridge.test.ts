import test from 'node:test';
import assert from 'node:assert/strict';
import { originalBridgeFixture } from './testing/cloudOriginalBridgeFixtures';
import { snapshotId, snapshotPath, snapshotDigest } from './testing/cloudClinicSnapshotFixtures';
import { createCloudOriginalWhatsAppBridge } from './cloudOriginalWhatsAppBridge';
import type { ProtectedWhatsAppAction } from './whatsappSafety';
async function harness() { const h = await originalBridgeFixture();
  const profile = h.docs.get(snapshotPath('patientProfiles', snapshotId(900))); profile.data.mobile = '01000000001'; profile.phoneKey = await snapshotDigest('patient-phone-v1:201000000001');
  return { ...h, bridge: createCloudOriginalWhatsAppBridge(h.context, h.refresh) }; }
const action = (): ProtectedWhatsAppAction => ({ templateName: 'custom', rawTemplate: '', editedText: 'أهلًا، نتمنى لك يومًا طيبًا.', values: {}, phone: '01000000001',
  isCampaign: false, canViewPatientFinance: false, appointmentReady: true, link: '', patientFileNo: '451' });
test('original WhatsApp prepares from protected clinic records and consumes one exact native-gesture ticket, not browser settings', async () => {
  const h = await harness(), snapshot = await h.snapshot(), value = action(); assert.equal(h.bridge.consume(snapshot, value), null);
  await h.bridge.prepare(snapshot, value); assert.equal(h.bridge.consume(snapshot, { ...value, editedText: 'تعديل بعد التحقق' }), null);
  const output = h.bridge.consume(snapshot, value); assert.equal(output?.phone, '201000000001'); assert.equal(output?.text, value.editedText);
  assert.equal(h.bridge.consume(snapshot, value), null); assert.equal(h.counts().writes, 0);
});
test('changed patient, settings, snapshot identity or actual Auth lease cannot reuse an original message approval', async () => {
  const h = await harness(), snapshot = await h.snapshot(); await h.bridge.prepare(snapshot, action());
  assert.equal(h.bridge.consume(structuredClone(snapshot), action()), null);
  h.docs.get(snapshotPath('patientProfiles', snapshotId(900))).data.name = 'تعديل من جهاز مصطنع';
  await assert.rejects(h.bridge.prepare(snapshot, action())); assert.equal(h.bridge.consume(snapshot, action()), null);
  const other = await harness(), current = await other.snapshot(); await other.bridge.prepare(current, action()); other.revoke(); assert.equal(other.bridge.consume(current, action()), null);
});
test('campaign consent is explicit, journaled and safe to retry after lost ACK without changing patient identities or duplicating contacts', async () => {
  const h = await harness(), snapshot = await h.snapshot(), profiles = structuredClone(snapshot.records.patientProfiles);
  h.loseReply(); await assert.rejects(h.bridge.saveConsent(snapshot, { '201000000001': 'allowed' })); const id = h.bridge.getState().pendingOperationId; assert.ok(id);
  await assert.rejects(h.bridge.saveConsent(snapshot, { '201000000001': 'declined' })); assert.equal(h.bridge.getState().pendingOperationId, id);
  await h.bridge.saveConsent(snapshot, { '201000000001': 'allowed' }); const next = await h.snapshot();
  assert.equal(next.records.contactRecords.length, 1); assert.equal(next.records.contactRecords[0].data?.campaignConsent?.status, 'allowed');
  assert.deepEqual(next.records.patientProfiles, profiles); assert.equal(h.bridge.canClose(), true);
});
test('original greeting campaigns require current phone-bound consent and reject its revocation before preparing output', async () => {
  const h = await harness(); await h.bridge.saveConsent(await h.snapshot(), { '201000000001': 'allowed' }); const snapshot = await h.snapshot();
  const value: ProtectedWhatsAppAction = { ...action(), templateName: 'greeting', rawTemplate: 'كل سنة وأنت طيب {patientName}', editedText: null,
    values: { patientName: 'اسم مصطنع' }, isCampaign: true, patientFileNo: null };
  await h.bridge.prepare(snapshot, value); assert.ok(h.bridge.consume(snapshot, value));
  const contact = h.docs.get(snapshotPath('contactRecords', snapshot.records.contactRecords[0].recordId)); contact.data.campaignConsent.status = 'declined';
  await assert.rejects(h.bridge.prepare(snapshot, value)); assert.equal(h.bridge.consume(snapshot, value), null);
});
