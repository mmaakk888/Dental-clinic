import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createCloudTransferWorkspaceController } from './cloudTransferWorkspaceController';
import { createJournaledCloudPatientRepository } from './cloudPatientRepository';
import { createJournaledCloudContactRepository } from './cloudContactRepository';
import { createCloudOperationIntentRepository } from './cloudOperationIntent';
import { createCloudClinicSnapshotReader } from './cloudClinicSnapshot';
import { makeClinicSnapshotFixture, snapshotId, SNAPSHOT_OWNER, snapshotDigest, SNAPSHOT_WHEN, snapshotPath } from './testing/cloudClinicSnapshotFixtures';
import type { PatientImportRow } from './patientSpreadsheets';

const row = (fileNo: number, index = 0, mobile = ''): PatientImportRow => ({ rowNumber: index + 2, id: String(fileNo), name: `مريض مصطنع ${fileNo}`, mobile,
  patient: { id: String(fileNo), name: `مريض مصطنع ${fileNo}`, mobile, age: 30, firstVisit: '', gender: undefined, notes: '', allergy: '', sessions: [], payments: [] } });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
async function harness() {
  const fixture = await makeClinicSnapshotFixture(false), calls: string[] = [];
  let active = true, nextId = 1, lostPrepare = false, lostCommit = false, failRefresh = false, rejectCommit = false;
  let pauseCommit: ReturnType<typeof deferred<void>> | null = null, pauseSnapshot: ReturnType<typeof deferred<void>> | null = null;
  let tail = Promise.resolve();
  const adapter: any = { authorizeOwner: async () => { calls.push('auth'); return SNAPSHOT_OWNER; },
    readRecord: async (path: string) => { calls.push(`read:${path}`); if (failRefresh) throw new Error('PRIVATE_READ_DETAIL'); return structuredClone(fixture.docs.get(path) ?? null); },
    runTransaction: async (work: any) => {
      const previous = tail; let release!: () => void; tail = new Promise<void>(resolve => { release = resolve; }); await previous;
      try { const staged = structuredClone(fixture.docs), writes: string[] = []; let wrote = false;
        const result = await work({ get: async (path: string) => { assert.equal(wrote, false); calls.push(`get:${path}`); return structuredClone(staged.get(path) ?? null); },
          set: (path: string, value: unknown) => { wrote = true; calls.push(`set:${path}`); writes.push(path); staged.set(path, structuredClone(value)); },
          delete: (path: string) => { wrote = true; writes.push(path); staged.delete(path); } });
        const commit = writes.some(path => /patientProfiles|contactRecords/.test(path));
        if (commit && pauseCommit) await pauseCommit.promise;
        if (commit && rejectCommit) throw new Error('PRIVATE_REJECT_DETAIL');
        fixture.docs.clear(); staged.forEach((value: unknown, path: string) => fixture.docs.set(path, value));
        if (commit && lostCommit) { lostCommit = false; throw new Error('PRIVATE_ACK_LOST'); }
        if (!commit && lostPrepare && writes.length) { lostPrepare = false; throw new Error('PRIVATE_PREPARE_LOST'); }
        return result;
      } finally { release(); }
    } };
  const journal = createCloudOperationIntentRepository(adapter, { digest: snapshotDigest });
  const patients = { ...createJournaledCloudPatientRepository(adapter, { digest: snapshotDigest }), journal };
  const contacts = { ...createJournaledCloudContactRepository(adapter, { digest: snapshotDigest }), journal };
  const options = { ownerUid: SNAPSHOT_OWNER, isActive: () => active,
    getPatients: async () => { calls.push('patients'); return patients; }, getContacts: async () => { calls.push('contacts'); return contacts; },
    getSnapshot: async () => { calls.push('snapshot'); if (pauseSnapshot) await pauseSnapshot.promise; return createCloudClinicSnapshotReader(fixture.adapter); },
    newId: () => { calls.push('id'); return snapshotId(nextId++); }, now: () => { calls.push('now'); return SNAPSHOT_WHEN; } };
  const controller = createCloudTransferWorkspaceController(options);
  return { ...fixture, calls, patients, contacts, controller, options,
    losePrepare: () => { lostPrepare = true; }, loseCommit: () => { lostCommit = true; }, failRefresh: (value: boolean) => { failRefresh = value; },
    rejectCommit: (value: boolean) => { rejectCommit = value; }, active: (value: boolean) => { active = value; },
    pauseCommit: () => { pauseCommit = deferred<void>(); return pauseCommit; }, pauseSnapshot: () => { pauseSnapshot = deferred<void>(); return pauseSnapshot; } };
}
test('transfer controller is inert and never reads SDK/files/snapshot or allocates IDs on construction', async () => {
  const h = await harness(); assert.deepEqual(h.calls, []); assert.equal(h.controller.getState().preview, null); assert.equal(h.controller.canClose(), true); assert.deepEqual(h.calls, []);
});

test('explicit CSV file pipeline uses bounded existing parser and requires confirmation before any writes', async () => {
  const h = await harness(), file = new File(['\uFEFFرقم الملف,اسم المريض,الموبايل\n450,مصطنع من CSV,\n'], 'patients.csv', { type: 'text/csv' });
  assert.equal(await h.controller.readFile('patients', file), true); assert.equal(h.controller.getState().preview?.readyCount, 1);
  assert.equal(h.controller.getState().preview?.rows[0].profile?.firstVisit, ''); assert.equal(h.docs.size, 4); assert.equal(h.calls.includes('id'), false);
  assert.equal(await h.controller.confirm(h.controller.getState().preview!), true); assert.equal(h.docs.has(snapshotPath('patientFiles', 450)), true);
});

test('malformed or oversize files reject; formula-like CSV rows remain invalid and never become writes', async () => {
  for (const file of [new File([''], 'empty.csv'), new File(['x'], 'bad.txt'),
    new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.csv')]) {
    const h = await harness(); assert.equal(await h.controller.readFile('patients', file), false);
    assert.equal(h.calls.includes('snapshot'), false); assert.equal(h.docs.size, 4); assert.equal(h.controller.getState().preview, null);
    assert.doesNotMatch(h.controller.getState().error, /SECRET/);
  }
  const h = await harness(); await h.controller.readFile('patients', new File(['رقم الملف,اسم المريض\n450,=SECRET()\n'], 'formula.csv'));
  const preview = h.controller.getState().preview!; assert.equal(preview.invalidCount, 1); assert.equal(preview.readyCount, 0);
  assert.equal(await h.controller.confirm(preview), false); assert.equal(h.docs.size, 4); assert.equal(h.calls.includes('id'), false);
});
test('confirmed historical rows save sequentially with original file numbers, empty dates and next creation max+1', async () => {
  const h = await harness(); await h.controller.previewRows('patients', [row(450), row(12, 1), row(700, 2)]);
  const preview = h.controller.getState().preview!; assert.equal(h.controller.canClose(), false); assert.equal(h.docs.size, 4);
  assert.equal(await h.controller.confirm(preview), true); assert.equal(h.controller.getState().results.length, 3); assert.equal(h.controller.canClose(), true);
  assert.equal(h.docs.get(snapshotPath('counters', 'patientFiles')).lastFileNo, 700);
  for (const fileNo of [12, 450, 700]) { const index = h.docs.get(snapshotPath('patientFiles', fileNo)); assert.equal(h.docs.get(snapshotPath('patientProfiles', index.recordId)).data.firstVisit, ''); }
  const command = { operationId: snapshotId(100), recordId: snapshotId(101), expectedRevision: 0, action: 'create' as const, profile: row(1).patient! };
  const { id: _id, sessions: _sessions, payments: _payments, ...profile } = command.profile;
  const prepared = { ...command, profile: { ...profile, gender: '' } }; await h.patients.journal.prepare('patient-profile', prepared, SNAPSHOT_WHEN);
  assert.equal((await h.patients.commit(prepared)).fileNo, 701);
});
test('lost preparation ACK stops later rows and exact retry reuses IDs and command', async () => {
  const h = await harness(); await h.controller.previewRows('patients', [row(450), row(451, 1)]); const preview = h.controller.getState().preview!;
  h.losePrepare(); assert.equal(await h.controller.confirm(preview), false); const pending = h.controller.getState().pending!, ids = h.calls.filter(c => c === 'id').length;
  assert.equal(h.controller.getState().saveStatus, 'retry-required'); assert.equal(h.docs.has(snapshotPath('patientFiles', 450)), false); assert.equal(h.docs.has(snapshotPath('patientFiles', 451)), false);
  assert.equal(await h.controller.previewRows('patients', [row(999)]), false); assert.equal(h.controller.discardPreview(preview), false);
  assert.equal(await h.controller.retry(pending.operationId), true); assert.equal(h.calls.filter(c => c === 'id').length, ids + 2); assert.equal(h.controller.getState().results[0].operationId, pending.operationId);
});
test('lost commit ACK is recovered by a fresh controller using exact ID with no replacement number or money', async () => {
  const h = await harness(); await h.controller.previewRows('patients', [row(450)]); h.loseCommit(); await h.controller.confirm(h.controller.getState().preview!);
  const pending = h.controller.getState().pending!, intents = [...h.docs.values()].filter(v => v.kind === 'patient-profile'); assert.equal(intents[0].status, 'committed');
  const before = structuredClone(h.docs), idCount = h.calls.filter(c => c === 'id').length; h.controller.dispose();
  const fresh = createCloudTransferWorkspaceController(h.options); assert.equal(await fresh.resume('patients', pending.operationId), true);
  assert.deepEqual(h.docs, before); assert.equal(h.calls.filter(c => c === 'id').length, idCount); assert.equal(fresh.getState().results[0].fileNo, 450);
  await fresh.previewRows('patients', [row(450), row(451, 1)]); assert.equal(fresh.getState().preview?.duplicateCount, 1); assert.equal(fresh.getState().preview?.readyCount, 1);
  assert.equal([...h.docs.keys()].some(key => /patientAccounts|patientSessions|patientReceipts/.test(key)), false);
});
test('acknowledged refresh retry performs reads only and cannot cancel or duplicate the row', async () => {
  const h = await harness(); await h.controller.previewRows('patients', [row(450)]); h.failRefresh(true); await h.controller.confirm(h.controller.getState().preview!);
  const pending = h.controller.getState().pending!, writes = h.calls.filter(c => c.startsWith('set:')).length;
  assert.equal(h.controller.getState().saveStatus, 'refresh-required'); assert.equal(await h.controller.cancelPending(pending.operationId), false);
  h.failRefresh(false); assert.equal(await h.controller.retry(pending.operationId), true); assert.equal(h.calls.filter(c => c.startsWith('set:')).length, writes);
});
test('confirmed cancellation cancels one uncommitted row only and never undoes earlier saved rows', async () => {
  const h = await harness(); await h.controller.previewRows('patients', [row(450), row(451, 1)]); const preview = h.controller.getState().preview!;
  h.controller.subscribe(value => { if (value.results.length === 1 && !value.pending) h.rejectCommit(true); });
  await h.controller.confirm(preview); const pending = h.controller.getState().pending!; assert.equal(pending.fileNo, 451);
  assert.equal(await h.controller.cancelPending(pending.operationId), true); assert.equal(h.docs.has(snapshotPath('patientFiles', 450)), true); assert.equal(h.docs.has(snapshotPath('patientFiles', 451)), false);
  assert.deepEqual(h.controller.getState().results.map(r => r.status), ['committed', 'cancelled']); assert.equal(h.controller.canClose(), true);
});
test('cancelling an already committed lost-ACK row fails without removing its data', async () => {
  const h = await harness(); await h.controller.previewRows('patients', [row(450)]); h.loseCommit(); await h.controller.confirm(h.controller.getState().preview!);
  const pending = h.controller.getState().pending!, before = structuredClone(h.docs); assert.equal(await h.controller.cancelPending(pending.operationId), false); assert.deepEqual(h.docs, before); assert.equal(h.controller.getState().pending, pending);
});
test('manual stop waits for current accepted row and leaves remaining rows for explicit continuation', async () => {
  const h = await harness(); await h.controller.previewRows('patients', [row(450), row(451, 1)]); const preview = h.controller.getState().preview!, pause = h.pauseCommit();
  const pending = h.controller.confirm(preview); for (let i = 0; i < 1000 && !h.calls.some(c => c.startsWith('set:clinics/main/patientProfiles/')); i++) await Promise.resolve();
  assert.equal(h.controller.stopAfterCurrent(), true); pause.resolve(); assert.equal(await pending, true);
  assert.equal(h.controller.getState().results.length, 1); assert.equal(h.controller.getState().stopped, true); assert.equal(h.docs.has(snapshotPath('patientFiles', 451)), false);
  assert.equal(await h.controller.confirm(preview), true); assert.equal(h.controller.getState().results.length, 2);
});
test('logout during accepted import clears private memory without claiming server undo or starting next row', async () => {
  const h = await harness(); await h.controller.previewRows('patients', [row(450), row(451, 1)]); const pause = h.pauseCommit();
  const pending = h.controller.confirm(h.controller.getState().preview!); for (let i = 0; i < 1000 && !h.calls.some(c => c.startsWith('set:clinics/main/patientProfiles/')); i++) await Promise.resolve();
  h.active(false); assert.equal(h.controller.getState().closed, true); pause.resolve(); await pending;
  assert.equal(h.controller.getState().preview, null); assert.equal(h.controller.getState().pending, null); assert.deepEqual(h.controller.getState().results, []);
  assert.equal(h.docs.has(snapshotPath('patientFiles', 450)), true); assert.equal(h.docs.has(snapshotPath('patientFiles', 451)), false);
});
test('preview snapshots source before authorization yields and cannot be replaced by stale confirmation', async () => {
  const h = await harness(), input = row(450), pause = h.pauseSnapshot(); const pending = h.controller.previewRows('patients', [input]); input.patient!.name = 'تغيير غير مقبول';
  assert.equal(await h.controller.previewRows('patients', [row(999)]), false); pause.resolve(); await pending;
  const first = h.controller.getState().preview!; assert.equal(first.rows[0].profile?.name, 'مريض مصطنع 450');
  assert.equal(h.controller.discardPreview(first), true); await h.controller.previewRows('patients', [row(451)]); assert.equal(await h.controller.confirm(first), false); assert.equal(h.docs.size, 4);
});
test('contact imports reuse phone-unique owner journal and expose linked patient file without creating another profile', async () => {
  const h = await harness(); await h.controller.previewRows('patients', [row(450, 0, '01000000001')]); await h.controller.confirm(h.controller.getState().preview!);
  h.controller.discardPreview(h.controller.getState().preview!);
  await h.controller.previewRows('contacts', [{ rowNumber: 2, name: 'جهة مصطنعة', mobile: '+201000000001', notes: '' }, { rowNumber: 3, name: 'مكرر', mobile: '01000000001', notes: '' }]);
  const preview = h.controller.getState().preview!; assert.equal(preview.readyCount, 1); assert.equal(preview.duplicateCount, 1); assert.equal(preview.rows[0].matchingFiles[0].fileNo, 450);
  assert.equal(await h.controller.confirm(preview), true); assert.equal([...h.docs.keys()].filter(path => path.includes('/patientProfiles/')).length, 1); assert.equal([...h.docs.keys()].filter(path => path.includes('/contactRecords/')).length, 1);
});
test('resume rejects another owner/domain/create-patient/tampered or cancelled intent without new IDs or writes', async () => {
  for (const variant of ['owner', 'kind', 'action', 'fileNo', 'cancelled']) {
    const h = await harness(); await h.controller.previewRows('patients', [row(450)]); h.losePrepare(); await h.controller.confirm(h.controller.getState().preview!);
    const pending = h.controller.getState().pending!, path = snapshotPath('operationIntents', pending.operationId), intent = h.docs.get(path);
    if (variant === 'owner') intent.actorUid = 'other-owner'; if (variant === 'kind') intent.kind = 'contact'; if (variant === 'action') intent.command.action = 'create';
    if (variant === 'fileNo') intent.command.fileNo = 0; if (variant === 'cancelled') { intent.status = 'cancelled'; intent.revision = 2; }
    const before = structuredClone(h.docs), ids = h.calls.filter(c => c === 'id').length; h.controller.dispose();
    const fresh = createCloudTransferWorkspaceController(h.options); assert.equal(await fresh.resume('patients', pending.operationId), false); assert.deepEqual(h.docs, before); assert.equal(h.calls.filter(c => c === 'id').length, ids);
  }
});
test('synchronous subscribers cannot duplicate a row/save, replace locked import or resurrect after dispose', async () => {
  const h = await harness(); await h.controller.previewRows('patients', [row(450)]); const preview = h.controller.getState().preview!;
  h.controller.subscribe(value => { if (value.running) { void h.controller.confirm(preview); void h.controller.previewRows('patients', [row(999)]); if (value.pending) void h.controller.retry(value.pending.operationId); } });
  await h.controller.confirm(preview); assert.equal(h.controller.getState().results.length, 1); assert.equal([...h.docs.keys()].filter(path => path.includes('/patientProfiles/')).length, 1);
  h.controller.dispose(); const before = h.calls.length; await h.controller.confirm(preview); await h.controller.resume('patients', snapshotId(1)); assert.equal(h.calls.length, before);
});
test('import controller graph has no SDK/Auth/App/storage/network implementation or eager spreadsheet load', async () => {
  const built = await build({ entryPoints: ['src/utils/cloudTransferWorkspaceController.ts'], bundle: true, write: false, metafile: true, platform: 'browser', format: 'esm', logLevel: 'silent' });
  const paths = Object.keys(built.metafile!.inputs).join('\n'); assert.doesNotMatch(paths, /firebaseCloud|cloudOperatingAuth|storage\.ts|App\.tsx|firebaseService\.ts/);
  const source = built.outputFiles[0].text; assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|signInWith|initializeApp/);
});
