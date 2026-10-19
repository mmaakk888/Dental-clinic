import test from 'node:test';
import assert from 'node:assert/strict';
import { originalBridgeFixture } from './testing/cloudOriginalBridgeFixtures';
import { snapshotId, snapshotPath, SNAPSHOT_OWNER } from './testing/cloudClinicSnapshotFixtures';
import { createCloudOriginalPatientsBridge } from './cloudOriginalPatientsBridge';
import { createCloudOriginalAppointmentsBridge } from './cloudOriginalAppointmentsBridge';
import { createCloudOriginalLabsBridge } from './cloudOriginalLabsBridge';
import { projectOriginalClinicViews } from './cloudOriginalViewProjection';
import { createCloudOriginalPatientFileBridge } from './cloudOriginalPatientFileBridge';
import { projectOriginalContent, captureOriginalContent } from './cloudOriginalSettingsProjection';

const patientInput = () => ({ id: '452', name: 'شخص جديد مصطنع', mobile: '', age: 31, gender: '', firstVisit: '2026-10-17', notes: '', allergy: '' });
test('original patient form allocates after the actual server counter, never its editable proposed number', async () => {
  const h = await originalBridgeFixture(), bridge = createCloudOriginalPatientsBridge({ getRepository: h.context.getPatients,
    getDirectory: h.reader.readDirectory, isActive: h.context.isActive, onCommitted: h.refresh });
  bridge.setEditorOpen(true); assert.equal(bridge.canClose(), false);
  const number = await bridge.save(await h.snapshot(), { ...patientInput(), id: '9999' });
  assert.equal(number, '452'); assert.equal(h.docs.get(snapshotPath('counters', 'patientFiles')).lastFileNo, 452);
  assert.equal(bridge.canClose(), true); assert.equal(h.counts().writes, 1);
});
test('patient lost ACK keeps one number/operation; edited retry cannot silently create a second file', async () => {
  const h = await originalBridgeFixture(false), bridge = createCloudOriginalPatientsBridge({ getRepository: h.context.getPatients,
    getDirectory: h.reader.readDirectory, isActive: h.context.isActive, onCommitted: h.refresh });
  const snapshot = await h.snapshot(); h.loseReply(); await assert.rejects(bridge.save(snapshot, patientInput()));
  const operation = bridge.getState().pendingOperationId; assert.ok(operation);
  await assert.rejects(bridge.save(snapshot, { ...patientInput(), name: 'تعديل غير مسموح' }));
  assert.equal(bridge.getState().pendingOperationId, operation);
  assert.equal(await bridge.save(snapshot, patientInput()), '1');
  assert.equal(h.docs.get(snapshotPath('counters', 'patientFiles')).lastFileNo, 1);
  assert.equal([...h.docs.keys()].filter(path => path.includes('/patientOperations/')).length, 1);
});
test('registration reviews similar patients without merging, then requires an explicit identical second save', async () => {
  const h = await originalBridgeFixture(), snapshot = await h.snapshot(), bridge = createCloudOriginalPatientsBridge({ getRepository: h.context.getPatients,
    getDirectory: h.reader.readDirectory, isActive: h.context.isActive, onCommitted: h.refresh });
  const same = { ...patientInput(), name: snapshot.patients[0].patient.name };
  await assert.rejects(bridge.save(snapshot, same), /وجدنا تشابهًا/); assert.equal(h.counts().writes, 0);
  assert.ok(bridge.getState().registrationCheck); assert.equal(await bridge.save(snapshot, same), '452');
});
test('patient edit checks the displayed revision and preserves all clinical histories', async () => {
  const h = await originalBridgeFixture(), snapshot = await h.snapshot(), bridge = createCloudOriginalPatientsBridge({ getRepository: h.context.getPatients,
    getDirectory: h.reader.readDirectory, isActive: h.context.isActive, onCommitted: h.refresh });
  const history = structuredClone(snapshot.records.patientSessions);
  const current = snapshot.patients[0].patient; await bridge.save(snapshot, { ...current, notes: 'تعديل مصطنع' }, current.id);
  assert.deepEqual((await h.snapshot()).records.patientSessions, history);
  await assert.rejects(bridge.save(snapshot, { ...current, notes: 'قديم' }, current.id), /تغيّر الملف/);
});
function appointmentBridge(h: Awaited<ReturnType<typeof originalBridgeFixture>>) { return createCloudOriginalAppointmentsBridge({ getCapability: h.context.getAppointments,
  ownerUid: SNAPSHOT_OWNER, initialDate: '2026-10-17', isActive: h.context.isActive, onCommitted: h.refresh }); }
const newAppointment = { patientId: '451', fileNo: '451', patientName: 'حجز مصطنع', mobile: '', date: '2026-10-17', time: '11:00', note: 'ملاحظة مصطنعة', durationMinutes: 30,
  status: 'scheduled' as const, isFollowUp: false, isWalkIn: false };
test('original calendar creates through protected day reservation and safely confirms a lost acknowledgement once', async () => {
  const h = await originalBridgeFixture(), snapshot = await h.snapshot(), bridge = appointmentBridge(h);
  h.loseReply(); await assert.rejects(bridge.save(snapshot, newAppointment)); const id = bridge.getState().pendingOperationId; assert.ok(id);
  await assert.rejects(bridge.save(snapshot, { ...newAppointment, time: '12:00' })); assert.equal(bridge.getState().pendingOperationId, id);
  await bridge.save(snapshot, newAppointment);
  const records = (await h.snapshot()).records.appointmentRecords.filter(row => row.data.date === newAppointment.date);
  assert.equal(records.length, 1); assert.equal(records[0].data.patientRecordId, snapshotId(900)); assert.equal(bridge.canClose(), true);
});
test('original calendar updates status and rejects stale edits without undoing newer bookings', async () => {
  const h = await originalBridgeFixture(), snapshot = await h.snapshot(), bridge = appointmentBridge(h), original = snapshot.records.appointmentRecords[0];
  await bridge.setStatus(snapshot, original.recordId, 'confirmed');
  assert.equal(h.docs.get(snapshotPath('appointmentRecords', original.recordId)).data.status, 'confirmed');
  await assert.rejects(bridge.setStatus(snapshot, original.recordId, 'cancelled'), /تغيّر الموعد/);
});
test('original lab projection uses the linked patient session and immutable allocations, not invented payments', async () => {
  const h = await originalBridgeFixture(), snapshot = await h.snapshot(), view = projectOriginalClinicViews(snapshot), item = view.labCases[0];
  assert.equal(item.patientPaid, 700); assert.equal(item.labPaid, 100); assert.equal(item.labTotal, 600);
  assert.deepEqual(item.paymentsLog?.map(row => [row.date, row.amount]), [['2026-10-13', 100]]);
  assert.equal(view.appointments[0].patientId, '451'); assert.equal(item.linkedSessionId, snapshotId(11));
});
test('original lab payment preserves exact command through lost ACK and keeps patient money untouched', async () => {
  const h = await originalBridgeFixture(), snapshot = await h.snapshot(), bridge = createCloudOriginalLabsBridge(h.context, h.refresh);
  const receipts = structuredClone(snapshot.records.patientReceipts); h.loseReply();
  await assert.rejects(bridge.payment(snapshot, snapshotId(901), snapshotId(11), 50)); const operation = bridge.getState().pendingOperationId; assert.ok(operation);
  await assert.rejects(bridge.payment(snapshot, snapshotId(901), snapshotId(11), 60));
  await bridge.payment(snapshot, snapshotId(901), snapshotId(11), 50);
  const next = await h.snapshot(); assert.equal(next.records.labAccounts[0].paidCostCents, 15000);
  assert.deepEqual(next.records.patientReceipts, receipts); assert.equal(next.records.labPayments.length, 2); assert.equal(bridge.canClose(), true);
});
test('original prosthetic form creates one linked order with patient selling price, not lab cost', async () => {
  const h = await originalBridgeFixture(), snapshot = await h.snapshot(), bridge = createCloudOriginalLabsBridge(h.context, h.refresh);
  await bridge.order(snapshot, { operationId: crypto.randomUUID(), patientId: '451', kind: 'fixed', material: 'تركيبة زيركون مصطنعة', units: 2,
    teethIds: ['ul1', 'ul2'], date: '2026-10-17', expectedUnitPrice: 1000, examinationFee: 100, paid: 500 });
  const next = await h.snapshot(), added = next.records.labCases.find(row => row.recordId !== snapshotId(11))!;
  assert.equal(added.totalCostCents, 40000); assert.equal(next.records.patientSessions.find(row => row.sessionId === added.sessionId)?.totalCents, 210000);
  assert.equal(next.records.patientSessions.find(row => row.sessionId === added.sessionId)?.paidCents, 50000);
});
test('original lab name/contact edits preserve per-lab materials and reject stale definitions', async () => {
  const h = await originalBridgeFixture(), snapshot = await h.snapshot(), bridge = createCloudOriginalLabsBridge(h.context, h.refresh);
  const lab = projectOriginalClinicViews(snapshot).labs[0];
  await bridge.saveLab(snapshot, { ...lab, name: 'اسم مصطنع محدث' }, lab);
  assert.deepEqual(h.docs.get(snapshotPath('labDefinitions', lab.id)).data.costs, snapshot.records.labDefinitions[0].data.costs);
  await assert.rejects(bridge.saveLab(snapshot, { ...lab, name: 'نسخة قديمة' }, lab), /تغيّرت بيانات المعمل/);
});
test('real identity loss denies retained original-view actions without a domain write', async () => {
  const h = await originalBridgeFixture(), snapshot = await h.snapshot(), appointments = appointmentBridge(h), labs = createCloudOriginalLabsBridge(h.context, h.refresh);
  h.revoke(); await assert.rejects(appointments.save(snapshot, newAppointment)); await assert.rejects(labs.payment(snapshot, snapshotId(901), null, 50));
  assert.equal(h.counts().writes, 0);
});
test('original patient-file service preserves one clinical charge/receipt even if the local form generates new row IDs on retry', async () => {
  const h = await originalBridgeFixture();
  h.docs.get(snapshotPath('settings', 'serviceCatalog')).data.services.push({ serviceId: snapshotId(995), name: 'حشو مصطنع', kind: 'clinical', priceCents: 10000, active: true });
  const snapshot = await h.snapshot(), bridge = createCloudOriginalPatientFileBridge(h.context, h.refresh);
  const input = () => ({ type: 'حشو مصطنع', tooth: 'ur5', amount: 200, paid: 50, remain: 150, examinationFee: 100, date: '2026-10-17',
    paymentsLog: [{ id: crypto.randomUUID(), amount: 50, date: '2026-10-17' }], services: [{ id: crypto.randomUUID(), name: 'حشو مصطنع', price: 100, tooth: 'ur5' }] });
  h.loseReply(); await assert.rejects(bridge.visit(snapshot, snapshotId(900), input())); const operation = bridge.getState().pendingOperationId; assert.ok(operation);
  await assert.rejects(bridge.visit(snapshot, snapshotId(900), { ...input(), paid: 100 }));
  await bridge.visit(snapshot, snapshotId(900), input());
  const next = await h.snapshot(); assert.equal(next.records.patientSessions.length, snapshot.records.patientSessions.length + 1);
  assert.equal(next.records.patientReceipts.length, snapshot.records.patientReceipts.length + 1);
  assert.equal(next.records.patientSessions.find(row => row.sessionId === operation)?.totalCents, 20000);
  assert.equal(next.records.patientSessions.find(row => row.sessionId === operation)?.paidCents, 5000);
});
test('original patient-file collection confirms the same receipt once and rejects stale account amounts', async () => {
  const h = await originalBridgeFixture(), snapshot = await h.snapshot(), bridge = createCloudOriginalPatientFileBridge(h.context, h.refresh);
  h.loseReply(); await assert.rejects(bridge.payment(snapshot, snapshotId(900), snapshotId(11), { amount: 50, date: '2026-10-17' }));
  await bridge.payment(snapshot, snapshotId(900), snapshotId(11), { amount: 50, date: '2026-10-17' });
  assert.equal((await h.snapshot()).records.patientReceipts.length, snapshot.records.patientReceipts.length + 1);
  await assert.rejects(bridge.payment(snapshot, snapshotId(900), snapshotId(11), { amount: 20, date: '2026-10-17' }), /تغيّر حساب المريض/);
});
test('original patient-file closed-editor recovery cannot retry while a form is open and never creates an alternate operation', async () => {
  const h = await originalBridgeFixture(), snapshot = await h.snapshot(), bridge = createCloudOriginalPatientFileBridge(h.context, h.refresh);
  bridge.setEditorOpen(true); h.loseReply(); await assert.rejects(bridge.payment(snapshot, snapshotId(900), snapshotId(11), { amount: 10, date: '2026-10-17' }));
  assert.equal(await bridge.recoverPending(), false); bridge.setEditorOpen(false); assert.equal(await bridge.recoverPending(), true);
  assert.equal(bridge.canClose(), true); assert.equal((await h.snapshot()).records.patientReceipts.length, snapshot.records.patientReceipts.length + 1);
});
test('original content settings round-trip independent mobile More placement and desktop ordering without persistence', async () => {
  const h = await originalBridgeFixture(), base = structuredClone((await h.snapshot()).settings.clinicSettings.data.content);
  base.mobile.moreSections = ['lab']; base.desktop.order.reverse();
  assert.deepEqual(captureOriginalContent(projectOriginalContent(base), base), base);
});
