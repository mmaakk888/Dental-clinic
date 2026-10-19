import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createCloudOriginalContactsBridge } from './cloudOriginalContactsBridge';
import { createJournaledCloudContactRepository, type CloudContactAdapter } from './cloudContactRepository';
import { createCloudOperationIntentRepository } from './cloudOperationIntent';
import { createCloudClinicSnapshotReader } from './cloudClinicSnapshot';
import { makeClinicSnapshotFixture, snapshotDigest } from './testing/cloudClinicSnapshotFixtures';

async function harness() {
  const fixture = await makeClinicSnapshotFixture(false), snapshot = await createCloudClinicSnapshotReader(fixture.adapter, { digest: snapshotDigest }).readFull();
  const docs = new Map<string, any>(); let active = true, commits = 0, refreshes = 0, loseReply = false, failRefresh = false;
  const adapter: CloudContactAdapter = { authorizeOwner: async () => 'synthetic-original-contact-owner',
    readRecord: async path => structuredClone(docs.get(path) ?? null),
    listRecordsPage: async (afterId, limit) => [...docs].filter(([path]) => path.startsWith('clinics/main/contactRecords/') && (!afterId || path.split('/').at(-1)! > afterId))
      .sort(([a], [b]) => a.localeCompare(b)).slice(0, limit).map(([path, data]) => ({ id: path.split('/').at(-1)!, data: structuredClone(data) })),
    runTransaction: async work => { const pending = structuredClone(docs); const result = await work({ get: async path => structuredClone(pending.get(path) ?? null),
      set: (path, value) => { pending.set(path, structuredClone(value)); }, delete: path => { pending.delete(path); } }); docs.clear(); pending.forEach((value, key) => docs.set(key, value)); return result; } };
  const repository = createJournaledCloudContactRepository(adapter, { digest: snapshotDigest });
  const journal = createCloudOperationIntentRepository(adapter, { digest: snapshotDigest });
  const bridge = createCloudOriginalContactsBridge({ isActive: () => active, getRepository: async () => ({ ...repository, journal,
    commit: async command => { commits++; const result = await repository.commit(command); if (loseReply) { loseReply = false; throw new Error('SYNTHETIC_LOST_ACK'); } return result; } }),
    onCommitted: async () => { refreshes++; if (failRefresh) throw new Error('SYNTHETIC_REPORT_UNAVAILABLE'); } });
  return { bridge, snapshot, docs, counts: () => ({ commits, refreshes }), loseReply: () => { loseReply = true; }, failRefresh: () => { failRefresh = true; }, revoke: () => { active = false; } };
}
const input = () => ({ id: 'contact_original-ui-draft', name: 'جهة مصطنعة للربط', mobile: '01000000001', notes: 'اختبار فقط', createdAt: '2026-10-17T00:00:00.000Z' });
test('original contact bridge remains inert until explicit save and uses protected UUID records, not local editor IDs', async () => {
  const h = await harness(); assert.deepEqual(h.counts(), { commits: 0, refreshes: 0 }); assert.equal(h.bridge.canClose(), true);
  await h.bridge.save(h.snapshot, input());
  const records = [...h.docs].filter(([path]) => path.startsWith('clinics/main/contactRecords/'));
  assert.equal(records.length, 1); assert.notEqual(records[0][1].recordId, input().id); assert.equal(records[0][1].data.name, input().name);
  assert.equal(h.bridge.canClose(), true); assert.deepEqual(h.counts(), { commits: 1, refreshes: 1 });
});
test('lost acknowledgement retains one exact command and rejects edited values instead of duplicating a contact', async () => {
  const h = await harness(); h.loseReply(); await assert.rejects(h.bridge.save(h.snapshot, input()));
  const operation = h.bridge.getState().pendingOperationId; assert.ok(operation); assert.equal(h.bridge.canClose(), false);
  await assert.rejects(h.bridge.save(h.snapshot, { ...input(), name: 'تعديل غير مسموح أثناء الشك' }));
  assert.equal(h.bridge.getState().pendingOperationId, operation); assert.equal(h.counts().commits, 1);
  await h.bridge.save(h.snapshot, input()); assert.equal(h.bridge.canClose(), true);
  assert.equal([...h.docs.keys()].filter(path => path.startsWith('clinics/main/contactRecords/')).length, 1);
  assert.equal([...h.docs.keys()].filter(path => path.startsWith('clinics/main/contactOperations/')).length, 1);
});
test('report failure after a confirmed contact write is not reported as a new failed create', async () => {
  const h = await harness(); h.failRefresh(); await h.bridge.save(h.snapshot, input());
  assert.equal(h.bridge.getState().saveStatus, 'idle'); assert.equal(h.bridge.getState().pendingOperationId, null);
  assert.equal(h.counts().commits, 1);
});
test('actual bridge identity loss or disposal denies every retained mutation', async () => {
  for (const mode of ['revoke', 'dispose']) {
    const h = await harness(); if (mode === 'revoke') h.revoke(); else h.bridge.dispose();
    await assert.rejects(h.bridge.save(h.snapshot, input())); assert.equal(h.counts().commits, 0);
  }
});
test('the four original render trees retain the confirmed GitHub designs; only protected callback/capability seams change', async () => {
  for (const [path, sha] of [
    ['src/components/patients/PatientsView.tsx', '9f954f0edb131d8d1dcf6b91a9ecb1616d974dd5006c55d56613191b9f3a88d2'],
    ['src/components/appointments/AppointmentsView.tsx', 'aa7928b5f4584a333c6f824c227f792447d8c80e92573fad6e1ff581c4c1bfde'],
    ['src/components/settings/ClinicContacts.tsx', 'bf034d487ccf6b681774eb4ff2b3bfc4d254b3b56a97e7792273c02bfe950958'],
    ['src/components/lab/LabView.tsx', '356360f75f3e0aee378f16ed6cc214584ef1e6cab53625856401c604ed924e29'],
  ]) {
    let source = (await readFile(path, 'utf8')).replaceAll('\r\n', '\n');
    source = source.replace("(capabilities ? capabilities.viewPatients : canPerformAction(currentUser ?? null, 'view_patients'))", "canPerformAction(currentUser ?? null, 'view_patients')");
    const marker = path.includes('ClinicContacts') ? '\n  return <section className="clinic-contacts"' : '\n  return (';
    const render = source.slice(source.lastIndexOf(marker));
    assert.equal(createHash('sha256').update(render).digest('hex'), sha, path);
  }
});
