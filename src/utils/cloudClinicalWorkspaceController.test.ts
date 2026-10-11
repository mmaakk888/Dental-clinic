import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { createCloudClinicalWorkspaceController, type CloudClinicalCapability } from './cloudClinicalWorkspaceController';
import { CloudClinicalError, prepareCloudClinicalCommand, type CloudClinicalAccount, type CloudClinicalCommand,
  type CloudClinicalSession, type CloudClinicalReceipt, type CloudClinicalSessionData } from './cloudClinicalRepository';
import { CloudOperationIntentError, prepareCloudIntentCommand, type CloudOperationIntent } from './cloudOperationIntent';
import type { CloudPatientRecord } from './cloudPatientRepository';

// Controller/lifecycle fakes only. Actual domain+journal atomic composition is
// tested separately; neither harness contacts Firebase or browser storage.
const PATIENT = '10000000-0000-4000-8000-000000000001', OTHER = '10000000-0000-4000-8000-000000000002';
const id = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const DAY = '2026-10-11', WHEN = `${DAY}T00:00:00.000Z`;
const visitData = (): CloudClinicalSessionData => ({ type: 'حشو عادي', date: DAY, teethIds: ['ur5'],
  services: [{ id: id(9000), name: 'حشو عادي', priceCents: 30_000, tooth: 'ur5' }], examinationCents: 10_000,
  notes: '', treatmentStage: 'single', rootCanalStatus: '', visitStatus: 'completed' });
function deferred() { let resolve!: () => void; const promise = new Promise<void>(accept => { resolve = accept; }); return { resolve, promise }; }
function harness() {
  const profile: CloudPatientRecord = { schemaVersion: 1, clinicId: 'main', recordId: PATIENT, fileNo: 451,
    revision: 1, lastOperationId: id(999), phoneKey: null,
    data: { name: 'مريض مصطنع', mobile: '', age: 30, gender: '', firstVisit: DAY, notes: '', allergy: '' } };
  let account: CloudClinicalAccount | null = null, active = true, next = 1, capCalls = 0;
  const sessions = new Map<string, CloudClinicalSession>(), receipts = new Map<string, CloudClinicalReceipt>();
  const intents = new Map<string, CloudOperationIntent>(), accepted = new Map<string, any>();
  const calls: string[] = [], submitted: CloudClinicalCommand[] = [];
  const hooks: { read?: (kind: string) => Promise<void> | void; prepare?: () => Promise<void> | void;
    commit?: () => Promise<void> | void; cap?: () => Promise<void> | void; onAccepted?: () => void } = {};
  const faults = { lostPrepare: false, lostCommit: false, commitBefore: false, wrongReceipt: false };
  async function read(kind: string) { calls.push(kind); await hooks.read?.(kind); }
  const capability: CloudClinicalCapability = {
    journal: {
      prepare: async (kind, input, createdAt) => {
        calls.push('prepare'); const command = prepareCloudIntentCommand(input); await hooks.prepare?.();
        const operationId = command.operationId as string;
        let stored = intents.get(operationId);
        if (!stored) {
          stored = { schemaVersion: 1, clinicId: 'main', recordId: operationId, operationId,
            actorUid: 'synthetic-clinical-owner', kind, command, createdAt, status: 'prepared', revision: 1,
            requestHash: createHash('sha256').update(JSON.stringify(['clinic-operation-intent-v1', 'synthetic-clinical-owner', kind, command])).digest('hex') };
          intents.set(operationId, stored);
        }
        if (JSON.stringify(stored.command) !== JSON.stringify(command)) throw new CloudOperationIntentError('conflict');
        if (faults.lostPrepare) { faults.lostPrepare = false; throw new Error('PRIVATE_ACK'); }
        return structuredClone(stored);
      },
      get: async operationId => { calls.push('intent-get'); return structuredClone(intents.get(operationId) ?? null); },
      cancel: async operationId => {
        calls.push('cancel'); const intent = intents.get(operationId);
        if (!intent || intent.status === 'committed') throw new CloudOperationIntentError('conflict');
        intent.status = 'cancelled'; intent.revision = 2; return structuredClone(intent);
      },
      listPreparedPage: async () => ({ records: [], nextAfterId: null }),
    },
    repository: {
      getProfile: async patientId => { await read('profile'); if (patientId !== PATIENT) throw new CloudClinicalError('invalid'); return structuredClone(profile); },
      getAccount: async () => { await read('account'); return structuredClone(account); },
      getSession: async sessionId => structuredClone(sessions.get(sessionId) ?? null),
      listSessions: async () => { await read('sessions'); return { records: structuredClone([...sessions.values()]), nextAfterId: null }; },
      listReceipts: async () => { await read('receipts'); return { records: structuredClone([...receipts.values()]), nextAfterId: null }; },
      commit: async input => {
        const command = prepareCloudClinicalCommand(input); calls.push('commit'); submitted.push(structuredClone(command));
        await hooks.commit?.();
        if (faults.commitBefore) throw new CloudClinicalError('unavailable');
        const old = accepted.get(command.operationId);
        if (old) return { ...structuredClone(old), status: 'already-committed' };
        if (command.expectedRevision !== (account?.revision ?? 0)) throw new CloudClinicalError('conflict');
        const intent = intents.get(command.operationId);
        if (intent?.status !== 'prepared') throw new CloudClinicalError('conflict');
        const current = sessions.get(command.sessionId);
        const charged = command.action === 'visit' ? command.data.examinationCents + command.data.services.reduce((sum, row) => sum + row.priceCents, 0) : 0;
        const cash = command.action === 'visit' ? command.paidCents : command.action === 'payment' ? command.amountCents : 0;
        if (command.action !== 'visit' && !current || command.action === 'payment' && cash > current!.totalCents - current!.paidCents) throw new CloudClinicalError('conflict');
        account = { schemaVersion: 1, clinicId: 'main', patientId: PATIENT, fileNo: 451,
          revision: command.expectedRevision + 1, lastOperationId: command.operationId,
          totalCents: (account?.totalCents ?? 0) + charged, paidCents: (account?.paidCents ?? 0) + cash,
          sessionCount: (account?.sessionCount ?? 0) + (command.action === 'visit' ? 1 : 0) };
        const session: CloudClinicalSession = command.action === 'visit'
          ? { schemaVersion: 1, clinicId: 'main', patientId: PATIENT, fileNo: 451, sessionId: command.sessionId,
            revision: 1, lastOperationId: command.operationId, totalCents: charged, paidCents: cash, data: command.data }
          : { ...current!, revision: current!.revision + 1, paidCents: current!.paidCents + cash, lastOperationId: command.operationId,
            data: command.action === 'progress' ? { ...current!.data, ...command.changes } : current!.data };
        sessions.set(command.sessionId, session);
        if (cash) receipts.set(command.operationId, { schemaVersion: 1, clinicId: 'main', patientId: PATIENT,
          fileNo: 451, sessionId: command.sessionId, receiptId: command.operationId, amountCents: cash,
          date: command.action === 'visit' ? command.data.date : command.action === 'payment' ? command.date : DAY,
          note: command.action === 'payment' ? command.note : '', createdAt: command.createdAt,
          actorUid: 'synthetic-clinical-owner', paymentMethod: 'cash' });
        intent.status = 'committed'; intent.revision = 2;
        const result = { status: 'committed' as const, patientId: PATIENT, fileNo: 451, sessionId: command.sessionId, revision: account.revision };
        accepted.set(command.operationId, result); hooks.onAccepted?.();
        if (faults.lostCommit) { faults.lostCommit = false; throw new Error('PRIVATE_ACK'); }
        return faults.wrongReceipt ? { ...result, fileNo: 452 } : result;
      },
    },
  };
  const options = { getCapability: async () => { capCalls++; await hooks.cap?.(); return capability; },
    isActive: () => active, newId: () => id(next++), now: () => WHEN };
  return { calls, submitted, hooks, faults, profile, sessions, receipts, intents, capability,
    controller: createCloudClinicalWorkspaceController(options), fresh: () => createCloudClinicalWorkspaceController(options),
    active: (value: boolean) => { active = value; }, capCalls: () => capCalls };
}

test('clinical controller constructs inertly and opens only a fully verified selected cloud UUID', async () => {
  const h = harness(); assert.deepEqual(h.calls, []); assert.equal(h.capCalls(), 0);
  assert.equal(h.controller.getState().snapshot, null);
  assert.equal(await h.controller.open('451'), false); assert.equal(h.capCalls(), 0);
  assert.equal(await h.controller.open(PATIENT), true); assert.equal(h.controller.getState().snapshot?.patient.id, '451');
  assert.equal(h.controller.getState().snapshot?.accountRevision, 0); assert.equal(h.capCalls(), 1);
});
test('visit prepares one durable command, commits once and publishes only fresh verified finances', async () => {
  const h = harness(); await h.controller.open(PATIENT);
  assert.equal(await h.controller.saveVisit(PATIENT, visitData(), 10_000), true);
  const state = h.controller.getState(); assert.equal(state.saveStatus, 'idle'); assert.equal(state.pendingOperationId, null);
  assert.equal(state.snapshot!.totalCents, 40_000); assert.equal(state.snapshot!.paidCents, 10_000);
  assert.equal(state.snapshot!.patient.sessions.length, 1); assert.equal(h.intents.get(id(1))?.status, 'committed');
  assert.equal(h.calls.filter(value => value === 'commit').length, 1);
});
test('later receipt and clinical progress use the current account revision without another visit charge', async () => {
  const h = harness(); await h.controller.open(PATIENT); await h.controller.saveVisit(PATIENT, visitData(), 10_000);
  assert.equal(await h.controller.addReceipt(PATIENT, id(1), { amountCents: 5000, date: DAY, note: 'دفعة مصطنعة' }), true);
  assert.equal(await h.controller.saveProgress(PATIENT, id(1), { notes: '', treatmentStage: 'second', rootCanalStatus: 'working_length', visitStatus: 'follow_up' }), true);
  const snapshot = h.controller.getState().snapshot!;
  assert.equal(snapshot.accountRevision, 3); assert.equal(snapshot.totalCents, 40_000); assert.equal(snapshot.paidCents, 15_000);
  assert.equal(snapshot.patient.sessions.length, 1); assert.equal(snapshot.patient.sessions[0].paymentsLog.length, 2);
  assert.equal(snapshot.patient.sessions[0].treatmentStage, 'second');
  assert.deepEqual(h.submitted.map(command => command.expectedRevision), [0, 1, 2]);
});
test('unloaded, wrong-patient, missing-session and invalid/fractional drafts cannot prepare writes', async () => {
  const h = harness(); assert.equal(await h.controller.saveVisit(PATIENT, visitData(), 0), false);
  await h.controller.open(PATIENT);
  assert.equal(await h.controller.saveVisit(OTHER, visitData(), 0), false);
  assert.equal(await h.controller.addReceipt(PATIENT, id(99), { amountCents: 100, date: DAY, note: '' }), false);
  assert.equal(await h.controller.saveVisit(PATIENT, visitData(), 0.5), false);
  assert.equal(h.calls.includes('prepare'), false); assert.equal(h.controller.getState().saveStatus, 'idle');
});
test('caller mutation cannot change a pending visit after its first await', async () => {
  const h = harness(); await h.controller.open(PATIENT); const data = visitData();
  const saving = h.controller.saveVisit(PATIENT, data, 10_000); data.services[0].priceCents = 1; data.notes = 'changed';
  assert.equal(await saving, true); assert.equal(h.controller.getState().snapshot!.totalCents, 40_000);
  assert.equal(h.controller.getState().snapshot!.patient.sessions[0].visitNotes, '');
});
test('uncertain preparation retains exact operation and blocks every replacement/edit/read action', async () => {
  const h = harness(); await h.controller.open(PATIENT); h.faults.lostPrepare = true;
  assert.equal(await h.controller.saveVisit(PATIENT, visitData(), 10_000), false);
  assert.equal(h.controller.getState().saveStatus, 'retry-required'); assert.equal(h.controller.getState().pendingOperationId, id(1));
  assert.equal(h.calls.includes('commit'), false);
  assert.equal(await h.controller.saveVisit(PATIENT, visitData(), 0), false); assert.equal(await h.controller.open(OTHER), false);
  assert.equal(await h.controller.refresh(), false); assert.equal(await h.controller.resume(id(2)), false);
  assert.equal(await h.controller.retry(), true); assert.equal(h.intents.size, 1); assert.equal(h.submitted[0].operationId, id(1));
});
test('lost clinical acknowledgement retries the same immutable command and never adds another receipt', async () => {
  const h = harness(); await h.controller.open(PATIENT); h.faults.lostCommit = true;
  assert.equal(await h.controller.saveVisit(PATIENT, visitData(), 10_000), false);
  assert.equal(h.controller.getState().saveStatus, 'retry-required');
  assert.equal(await h.controller.retry(), true); assert.equal(h.receipts.size, 1); assert.equal(h.sessions.size, 1);
  assert.deepEqual(h.submitted[0], h.submitted[1]); assert.equal(h.controller.getState().snapshot!.paidCents, 10_000);
});
test('acknowledged save with failed refresh retries reads only, never prepare/commit again', async () => {
  const h = harness(); await h.controller.open(PATIENT);
  h.hooks.onAccepted = () => { h.hooks.read = () => { throw new Error('PRIVATE_REFRESH'); }; };
  assert.equal(await h.controller.saveVisit(PATIENT, visitData(), 10_000), false);
  assert.equal(h.controller.getState().saveStatus, 'refresh-required'); assert.equal(await h.controller.cancelPending(), false);
  h.hooks.read = undefined; assert.equal(await h.controller.retry(), true);
  assert.equal(h.calls.filter(value => value === 'prepare').length, 1); assert.equal(h.submitted.length, 1);
});
test('same-revision conflict retains original command until server-confirmed cancellation, without rebasing', async () => {
  const h = harness(); await h.controller.open(PATIENT); h.faults.commitBefore = true;
  assert.equal(await h.controller.saveVisit(PATIENT, visitData(), 10_000), false);
  h.faults.commitBefore = false;
  h.hooks.commit = () => { throw new CloudClinicalError('conflict'); };
  assert.equal(await h.controller.retry(), false);
  assert.deepEqual(h.submitted.map(command => command.expectedRevision), [0, 0]);
  assert.equal(await h.controller.cancelPending(), true);
  assert.equal(h.controller.getState().snapshot, null); assert.equal(h.controller.getState().loaded, false);
  assert.equal(await h.controller.saveVisit(PATIENT, visitData(), 0), false);
  assert.equal(h.intents.get(id(1))?.status, 'cancelled');
  h.hooks.commit = undefined; await h.controller.refresh(); assert.equal(await h.controller.saveVisit(PATIENT, visitData(), 0), true);
  assert.equal(h.submitted.at(-1)?.operationId, id(2));
});
test('cancellation cannot discard an already accepted but unacknowledged write', async () => {
  const h = harness(); await h.controller.open(PATIENT); h.faults.lostCommit = true;
  await h.controller.saveVisit(PATIENT, visitData(), 10_000);
  assert.equal(await h.controller.cancelPending(), false); assert.equal(h.controller.getState().pendingOperationId, id(1));
  assert.equal(await h.controller.retry(), true); assert.equal(h.receipts.size, 1);
});
test('new controller after page disposal resumes a prepared operation with its original ID and revision', async () => {
  const h = harness(); await h.controller.open(PATIENT); h.faults.lostPrepare = true;
  await h.controller.saveVisit(PATIENT, visitData(), 10_000); h.controller.dispose();
  const fresh = h.fresh(); assert.equal(await fresh.resume(id(1)), true);
  assert.equal(fresh.getState().snapshot!.patientRecordId, PATIENT); assert.equal(h.intents.size, 1);
  assert.equal(h.submitted[0].operationId, id(1)); assert.equal(h.submitted[0].expectedRevision, 0);
});
test('new controller can verify an accepted operation after lost acknowledgement without a new payment', async () => {
  const h = harness(); await h.controller.open(PATIENT); h.faults.lostCommit = true;
  await h.controller.saveVisit(PATIENT, visitData(), 10_000); h.controller.dispose();
  const fresh = h.fresh(); assert.equal(await fresh.resume(id(1)), true);
  assert.equal(fresh.getState().snapshot!.paidCents, 10_000); assert.equal(h.receipts.size, 1); assert.equal(h.sessions.size, 1);
});
test('malformed/missing/cancelled recovery record cannot invent an operation or payment', async () => {
  const h = harness(); assert.equal(await h.controller.resume(id(99)), false);
  await h.controller.open(PATIENT); h.faults.lostPrepare = true; await h.controller.saveVisit(PATIENT, visitData(), 0);
  await h.controller.cancelPending(); const fresh = h.fresh();
  assert.equal(await fresh.resume(id(1)), false); assert.equal(fresh.getState().pendingOperationId, null);
  assert.equal(h.submitted.length, 0); assert.equal(h.receipts.size, 0);
});
test('dispose during delayed capability creation cannot read, write or resurrect the closed workspace', async () => {
  const h = harness(), gate = deferred(); h.hooks.cap = () => gate.promise;
  const opening = h.controller.open(PATIENT); h.controller.dispose(); gate.resolve();
  assert.equal(await opening, false); assert.deepEqual(h.calls, []); assert.equal(h.controller.getState().closed, true);
  assert.equal(await h.controller.open(PATIENT), false);
});
test('dispose during a delayed read or server-accepted write ignores late results and clears medical display', async () => {
  for (const stage of ['read', 'write']) {
    const h = harness(), gate = deferred(), started = deferred();
    if (stage === 'read') h.hooks.read = async kind => { if (kind === 'sessions') { started.resolve(); await gate.promise; } };
    else { await h.controller.open(PATIENT); h.hooks.commit = async () => { started.resolve(); await gate.promise; }; }
    const pending = stage === 'read' ? h.controller.open(PATIENT) : h.controller.saveVisit(PATIENT, visitData(), 10_000);
    await started.promise; h.controller.dispose(); gate.resolve(); assert.equal(await pending, false);
    const state = h.controller.getState(); assert.equal(state.closed, true); assert.equal(state.snapshot, null); assert.equal(state.pendingOperationId, null);
    if (stage === 'write') { assert.equal(h.receipts.size, 1); assert.equal(h.intents.get(id(1))?.status, 'committed'); }
  }
});
test('actual lease loss synchronously closes view and retained callbacks cannot save after reactivation', async () => {
  const h = harness(); await h.controller.open(PATIENT); h.active(false);
  assert.equal(h.controller.getState().closed, true); h.active(true);
  assert.equal(await h.controller.saveVisit(PATIENT, visitData(), 0), false); assert.equal(h.intents.size, 0);
});
test('repeated save/retry callbacks are exclusive while a command or read is in flight', async () => {
  const h = harness(), gate = deferred(), started = deferred(); await h.controller.open(PATIENT);
  h.hooks.prepare = async () => { started.resolve(); await gate.promise; };
  const saving = h.controller.saveVisit(PATIENT, visitData(), 0); await started.promise;
  assert.equal(await h.controller.saveVisit(PATIENT, visitData(), 0), false); assert.equal(await h.controller.retry(), false);
  assert.equal(await h.controller.cancelPending(), false); gate.resolve(); assert.equal(await saving, true); assert.equal(h.intents.size, 1);
});
test('failed or incomplete fresh file reads clear previous details instead of displaying another file or false zero', async () => {
  const h = harness(); await h.controller.open(PATIENT); await h.controller.saveVisit(PATIENT, visitData(), 10_000);
  h.hooks.read = kind => { if (kind === 'receipts') throw new Error('PRIVATE'); };
  assert.equal(await h.controller.refresh(), false); assert.equal(h.controller.getState().snapshot, null);
  assert.equal(h.controller.getState().loaded, false); assert.doesNotMatch(h.controller.getState().error, /PRIVATE/);
});
test('wrong acknowledged public file number stays unresolved and cannot publish the submitted draft as current', async () => {
  const h = harness(); await h.controller.open(PATIENT); h.faults.wrongReceipt = true;
  assert.equal(await h.controller.saveVisit(PATIENT, visitData(), 10_000), false);
  assert.equal(h.controller.getState().saveStatus, 'retry-required'); assert.equal(h.controller.getState().snapshot!.accountRevision, 0);
  h.faults.wrongReceipt = false; assert.equal(await h.controller.retry(), true); assert.equal(h.receipts.size, 1);
});
test('listener errors and disposal during generated-command callbacks cannot resurrect pending drafts', async () => {
  const h = harness(); h.controller.subscribe(() => { throw new Error('PRIVATE_VIEW'); }); await h.controller.open(PATIENT);
  assert.equal(await h.controller.saveVisit(PATIENT, visitData(), 0), true);
  let controller!: ReturnType<typeof createCloudClinicalWorkspaceController>;
  controller = createCloudClinicalWorkspaceController({ getCapability: async () => h.capability, isActive: () => true,
    now: () => WHEN, newId: () => { controller.dispose(); return id(55); } });
  await controller.open(PATIENT); assert.equal(await controller.saveVisit(PATIENT, visitData(), 0), false);
  assert.equal(controller.getState().closed, true); assert.equal(controller.getState().pendingOperationId, null);
});
test('clinical controller dependency graph remains SDK/Auth/browser storage/App-free', async () => {
  const result = await build({ entryPoints: ['src/utils/cloudClinicalWorkspaceController.ts'], bundle: true,
    platform: 'browser', write: false, metafile: true, logLevel: 'silent' });
  for (const path of Object.keys(result.metafile!.inputs)) assert.doesNotMatch(path, /firebase|storage\.ts|App\.tsx|cloudOperatingAuth/i);
});

test('ordinary clinical drafts bind the loaded patient UUID and block read/navigation/recovery until explicitly cancelled', async () => {
  const h = harness(); assert.equal(h.controller.getState().draftDirty, false);
  assert.equal(h.controller.setDraftDirty(PATIENT, true), false);
  await h.controller.open(PATIENT);
  assert.equal(h.controller.setDraftDirty(OTHER, true), false);
  assert.equal(h.controller.setDraftDirty(PATIENT, 'true' as never), false);
  assert.equal(h.controller.setDraftDirty(PATIENT, true), true);
  const before = [...h.calls];
  assert.equal(await h.controller.open(OTHER), false); assert.equal(await h.controller.open(PATIENT), false);
  assert.equal(await h.controller.refresh(), false); assert.equal(await h.controller.resume(id(99)), false);
  assert.deepEqual(h.calls, before); assert.equal(h.controller.getState().draftDirty, true);
  assert.equal(h.controller.setDraftDirty(OTHER, false), false);
  assert.equal(h.controller.setDraftDirty(PATIENT, false), true);
  assert.equal(await h.controller.refresh(), true); assert.equal(h.controller.getState().draftDirty, false);
});
test('a dirty form may submit, while validation failure preserves the form and full verified success clears it', async () => {
  const h = harness(); await h.controller.open(PATIENT); h.controller.setDraftDirty(PATIENT, true);
  assert.equal(await h.controller.saveVisit(PATIENT, visitData(), 0.5), false);
  assert.equal(h.controller.getState().draftDirty, true); assert.equal(h.intents.size, 0);
  assert.equal(await h.controller.saveVisit(PATIENT, visitData(), 10_000), true);
  assert.equal(h.controller.getState().draftDirty, false);
});
test('uncertain or failed saves and cancellations keep dirty state immutable until server-confirmed cancellation', async () => {
  const h = harness(); await h.controller.open(PATIENT); h.controller.setDraftDirty(PATIENT, true); h.faults.lostPrepare = true;
  assert.equal(await h.controller.saveVisit(PATIENT, visitData(), 10_000), false);
  assert.equal(h.controller.getState().draftDirty, true); assert.equal(h.controller.setDraftDirty(PATIENT, false), false);
  const originalCancel = h.capability.journal.cancel;
  h.capability.journal.cancel = async () => { throw new Error('PRIVATE_CANCEL'); };
  assert.equal(await h.controller.cancelPending(), false); assert.equal(h.controller.getState().draftDirty, true);
  h.capability.journal.cancel = originalCancel;
  assert.equal(await h.controller.cancelPending(), true); assert.equal(h.controller.getState().draftDirty, false);
  assert.equal(h.controller.getState().loaded, false);
});
test('acknowledged save does not clear ordinary dirty state until full read-only refresh succeeds', async () => {
  const h = harness(); await h.controller.open(PATIENT); h.controller.setDraftDirty(PATIENT, true);
  h.hooks.onAccepted = () => { h.hooks.read = () => { throw new Error('PRIVATE_REFRESH'); }; };
  assert.equal(await h.controller.saveVisit(PATIENT, visitData(), 10_000), false);
  assert.equal(h.controller.getState().saveStatus, 'refresh-required'); assert.equal(h.controller.getState().draftDirty, true);
  assert.equal(h.controller.setDraftDirty(PATIENT, false), false);
  h.hooks.read = undefined; assert.equal(await h.controller.retry(), true);
  assert.equal(h.controller.getState().draftDirty, false); assert.equal(h.submitted.length, 1);
});
test('in-flight dirty save cannot be cleared through a retained setter and is cleared only after success', async () => {
  const h = harness(), gate = deferred(), started = deferred(); await h.controller.open(PATIENT); h.controller.setDraftDirty(PATIENT, true);
  h.hooks.prepare = async () => { started.resolve(); await gate.promise; };
  const saving = h.controller.saveVisit(PATIENT, visitData(), 10_000); await started.promise;
  assert.equal(h.controller.setDraftDirty(PATIENT, false), false); assert.equal(h.controller.getState().draftDirty, true);
  gate.resolve(); assert.equal(await saving, true); assert.equal(h.controller.getState().draftDirty, false);
});
test('dirty setters fail closed after callback disposal or actual lease loss and cannot resurrect a draft', async () => {
  const h = harness(); await h.controller.open(PATIENT); h.controller.setDraftDirty(PATIENT, true); h.active(false);
  assert.equal(h.controller.setDraftDirty(PATIENT, false), false); assert.equal(h.controller.getState().draftDirty, false);
  h.active(true); assert.equal(h.controller.setDraftDirty(PATIENT, true), false);
  let controller!: ReturnType<typeof createCloudClinicalWorkspaceController>, closeOnCheck = false;
  controller = createCloudClinicalWorkspaceController({ getCapability: async () => h.capability,
    isActive: () => { if (closeOnCheck) controller.dispose(); return true; } });
  await controller.open(PATIENT); closeOnCheck = true;
  assert.equal(controller.setDraftDirty(PATIENT, true), false); assert.equal(controller.getState().closed, true);
  assert.equal(controller.getState().draftDirty, false);
});
test('dirty listener reentrancy cannot claim a live successful setter after the view has closed', async () => {
  const h = harness(); await h.controller.open(PATIENT);
  h.controller.subscribe(state => { if (state.draftDirty) h.controller.dispose(); });
  assert.equal(h.controller.setDraftDirty(PATIENT, true), false);
  assert.equal(h.controller.getState().closed, true); assert.equal(h.controller.getState().draftDirty, false);
});
