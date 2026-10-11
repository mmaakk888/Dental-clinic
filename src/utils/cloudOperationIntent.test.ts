import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { CloudOperationIntentError, createCloudOperationIntentRepository, parseCloudOperationIntent,
  prepareCloudIntentCommand, readCloudOperationIntentForCommit, markCloudOperationIntentCommitted,
  type CloudIntentAdapter, type CloudOperationKind } from './cloudOperationIntent';
import { CloudClinicalError, createCloudClinicalRepository, type CloudClinicalCommand } from './cloudClinicalRepository';

// Atomic fabricated server, NOT Rules-engine/Auth/SDK or live device testing.
const OWNER = 'synthetic-recovery-owner', PATIENT = '10000000-0000-4000-8000-000000000001';
const id = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const DAY = '2026-10-11', WHEN = `${DAY}T00:00:00.000Z`, OP = id(1);
const path = (kind: string, key = OP) => `clinics/main/${kind}/${key}`;
const digest = async (value: string) => createHash('sha256').update(value).digest('hex');
const check = (code: CloudOperationIntentError['code']) => (value: unknown) => value instanceof CloudOperationIntentError && value.code === code;
const clinical = (code: CloudClinicalError['code']) => (value: unknown) => value instanceof CloudClinicalError && value.code === code;
const visit = (): CloudClinicalCommand => ({ operationId: OP, patientId: PATIENT, sessionId: OP, expectedRevision: 0,
  action: 'visit', createdAt: WHEN, paidCents: 10_000, data: { type: 'حشو', date: DAY,
    teethIds: ['ur5'], services: [{ id: id(9000), name: 'حشو', priceCents: 30_000, tooth: 'ur5' }],
    examinationCents: 10_000, notes: '', treatmentStage: 'single', rootCanalStatus: '', visitStatus: 'completed' } });
function harness() {
  const docs = new Map<string, any>([
    [path('patientProfiles', PATIENT), { schemaVersion: 1, clinicId: 'main', recordId: PATIENT, fileNo: 451,
      revision: 1, lastOperationId: id(99), phoneKey: null,
      data: { name: 'مريض مصطنع', mobile: '', age: 30, gender: '', firstVisit: DAY, notes: '', allergy: '' } }],
    [path('patientFiles', '451'), { schemaVersion: 1, clinicId: 'main', fileNo: 451, recordId: PATIENT }],
  ]);
  const calls: string[] = []; let actor = OWNER, tail = Promise.resolve(), writes = 0;
  const faults = { failAt: 0, lostPrepareReply: false, lostCommitReply: false, retryTransaction: false };
  const hooks: { auth?: () => void; list?: () => unknown } = {};
  const adapter: CloudIntentAdapter = {
    authorizeOwner: async () => { calls.push('auth'); hooks.auth?.(); return actor; },
    readRecord: async key => { calls.push(`read:${key}`); return structuredClone(docs.get(key) ?? null); },
    listPreparedPage: async (kind, uid, after, count) => {
      calls.push(`list:${kind}:${uid}:${after}:${count}`);
      if (hooks.list) return hooks.list();
      return [...docs].filter(([key, value]) => key.startsWith(path('operationIntents', '')) && value.kind === kind
        && value.actorUid === uid && value.status === 'prepared' && (!after || value.recordId > after))
        .sort(([a], [b]) => a.localeCompare(b)).slice(0, count).map(([key, data]) => ({ id: key.split('/').at(-1), data: structuredClone(data) }));
    },
    listHistoryPage: async (kind, uid, after, count) => {
      calls.push(`history:${kind}:${uid}:${after}:${count}`);
      if (hooks.list) return hooks.list();
      return [...docs].filter(([key, value]) => key.startsWith(path('operationIntents', '')) && value.kind === kind
        && value.actorUid === uid && (!after || value.recordId > after))
        .sort(([a], [b]) => a.localeCompare(b)).slice(0, count).map(([key, data]) => ({ id: key.split('/').at(-1), data: structuredClone(data) }));
    },
    runTransaction: async work => {
      const previous = tail; let release!: () => void; tail = new Promise<void>(accept => { release = accept; }); await previous;
      const attempt = async (publish: boolean) => {
        const staged = structuredClone(docs); let written = false, isPrepare = false, isCommit = false;
        const result = await work({ get: async key => { assert.equal(written, false, 'transaction reads before writes');
          calls.push(`get:${key}`); return structuredClone(staged.get(key) ?? null); },
        set: (key, value) => { written = true; calls.push(`set:${key}`);
          if (++writes === faults.failAt) throw new Error('PRIVATE_PROVIDER');
          if (key.startsWith(path('operationIntents', '')) && (value as any).status === 'prepared') isPrepare = true;
          if (key.startsWith(path('clinicalOperations', ''))) isCommit = true;
          staged.set(key, structuredClone(value)); } });
        if (publish) {
          docs.clear(); for (const [key, value] of staged) docs.set(key, value);
          if (isPrepare && faults.lostPrepareReply) { faults.lostPrepareReply = false; throw new Error('PRIVATE_ACK'); }
          if (isCommit && faults.lostCommitReply) { faults.lostCommitReply = false; throw new Error('PRIVATE_ACK'); }
        }
        return result;
      };
      try { if (faults.retryTransaction) { faults.retryTransaction = false; await attempt(false); } return await attempt(true); }
      finally { release(); }
    },
  };
  return { docs, calls, faults, hooks, adapter, journal: createCloudOperationIntentRepository(adapter, { digest }),
    clinical: createCloudClinicalRepository(adapter, { digest }), owner: (value: string) => { actor = value; },
    writes: () => writes, resetWrites: () => { writes = 0; } };
}

test('intent repository is inert until explicit prepare and stores an owner-bound immutable canonical command', async () => {
  const h = harness(); assert.deepEqual(h.calls, []); const command = visit();
  const result = await h.journal.prepare('clinical', command, WHEN);
  assert.equal(result.status, 'prepared'); assert.equal(result.revision, 1); assert.equal(result.actorUid, OWNER);
  assert.equal(result.operationId, OP); assert.equal(result.recordId, OP);
  assert.equal(h.writes(), 1); assert.equal(h.docs.has(path('patientAccounts', PATIENT)), false);
  if (command.action === 'visit') command.data.notes = 'changed';
  assert.equal((await h.journal.get(OP))!.command.data && (await h.journal.get(OP))!.command.createdAt, WHEN);
  assert.doesNotMatch(JSON.stringify(await h.journal.get(OP)), /changed/);
});
test('canonical fingerprints ignore object key order but bind actor, kind, complete body and creation time', async () => {
  const h = harness(), command = visit(); await h.journal.prepare('clinical', command, WHEN);
  const previous = structuredClone(h.docs);
  const reordered = Object.fromEntries(Object.entries(command).reverse());
  assert.equal((await h.journal.prepare('clinical', reordered, WHEN)).status, 'prepared'); assert.deepEqual(h.docs, previous);
  for (const [kind, body, when] of [['contact', command, WHEN], ['clinical', { ...command, paidCents: 0 }, WHEN],
    ['clinical', command, `${DAY}T00:00:01.000Z`]] as const) {
    await assert.rejects(h.journal.prepare(kind, body, when), check('conflict'));
  }
  h.owner('other-synthetic-owner'); await assert.rejects(h.journal.prepare('clinical', command, WHEN), check('conflict'));
  assert.deepEqual(h.docs, previous);
});
test('prepare snapshots the complete command before its first authorization await', async () => {
  const h = harness(), command = visit(); const saving = h.journal.prepare('clinical', command, WHEN);
  if (command.action === 'visit') command.data.services[0].priceCents = 1;
  const stored = await saving; assert.equal(((stored.command.data as any).services[0]).priceCents, 30_000);
});
test('lost preparation acknowledgement is discoverable after a new journal instance and same-ID retry adds nothing', async () => {
  const h = harness(); h.faults.lostPrepareReply = true;
  await assert.rejects(h.journal.prepare('clinical', visit(), WHEN), check('unavailable'));
  const newPage = createCloudOperationIntentRepository(h.adapter, { digest });
  assert.equal((await newPage.listPreparedPage('clinical')).records[0].operationId, OP);
  const before = structuredClone(h.docs); await newPage.prepare('clinical', visit(), WHEN);
  assert.deepEqual(h.docs, before); assert.equal(h.writes(), 1);
});
test('clinical commit requires durable preparation; absent intent cannot write a session or receipt', async () => {
  const h = harness(), before = structuredClone(h.docs);
  await assert.rejects(h.clinical.commit(visit()), clinical('invalid'));
  assert.deepEqual(h.docs, before); assert.equal(h.writes(), 0);
});
test('clinical commit atomically closes its intent with the session, account, cash and historical receipt', async () => {
  const h = harness(); await h.journal.prepare('clinical', visit(), WHEN);
  await h.clinical.commit(visit()); assert.equal((await h.journal.get(OP))!.status, 'committed');
  assert.equal((await h.journal.get(OP))!.revision, 2); assert.equal(h.docs.has(path('clinicalOperations')), true);
  assert.equal(h.docs.has(path('patientReceipts')), true); assert.equal(h.writes(), 6);
  assert.deepEqual((await h.journal.listPreparedPage('clinical')).records, []);
  const before = structuredClone(h.docs); assert.equal((await h.clinical.commit(visit())).status, 'already-committed');
  assert.equal((await h.journal.prepare('clinical', visit(), WHEN)).status, 'committed'); assert.deepEqual(h.docs, before);
});
test('lost clinical acknowledgement can be inspected after reload without creating another collection', async () => {
  const h = harness(); await h.journal.prepare('clinical', visit(), WHEN); h.faults.lostCommitReply = true;
  await assert.rejects(h.clinical.commit(visit()), clinical('unavailable'));
  const journal = createCloudOperationIntentRepository(h.adapter, { digest });
  const saved = await journal.get(OP); assert.equal(saved?.status, 'committed');
  const core = createCloudClinicalRepository(h.adapter, { digest });
  assert.equal((await core.commit(visit())).status, 'already-committed');
  assert.equal(h.docs.get(path('patientAccounts', PATIENT)).paidCents, 10_000);
  assert.equal([...h.docs.keys()].filter(key => key.startsWith(path('patientReceipts', ''))).length, 1);
});

test('all-status history rediscovers an accepted lost-ACK command after reload without knowing its operation ID', async () => {
  const h = harness(); await h.journal.prepare('clinical', visit(), WHEN); h.faults.lostCommitReply = true;
  await assert.rejects(h.clinical.commit(visit()), clinical('unavailable'));
  const fresh = createCloudOperationIntentRepository(h.adapter, { digest });
  assert.deepEqual((await fresh.listPreparedPage('clinical')).records, []);
  const [recovered] = (await fresh.listHistoryPage('clinical')).records;
  assert.equal(recovered.status, 'committed'); assert.equal(recovered.operationId, OP);
  const before = structuredClone(h.docs);
  assert.equal((await createCloudClinicalRepository(h.adapter, { digest }).commit(recovered.command as unknown as CloudClinicalCommand)).status, 'already-committed');
  assert.deepEqual(h.docs, before); assert.equal(h.docs.get(path('patientAccounts', PATIENT)).paidCents, 10_000);
  assert.equal([...h.docs.keys()].filter(key => key.startsWith(path('patientReceipts', ''))).length, 1);
});

test('history is explicitly bounded, actor/kind scoped, ordered and includes cancelled and prepared operations', async () => {
  const h = harness();
  for (const n of [3, 1, 2]) await h.journal.prepare('clinical', { ...visit(), operationId: id(n), sessionId: id(n) }, WHEN);
  await h.journal.cancel(id(2));
  await h.journal.prepare('contact', { operationId: id(4), name: 'جهة مصطنعة' }, WHEN);
  const first = await h.journal.listHistoryPage('clinical', { limit: 2 });
  assert.deepEqual(first.records.map(value => [value.operationId, value.status]), [[id(1), 'prepared'], [id(2), 'cancelled']]);
  assert.equal(first.nextAfterId, id(2));
  const second = await h.journal.listHistoryPage('clinical', { afterId: first.nextAfterId, limit: 2 });
  assert.deepEqual(second.records.map(value => value.operationId), [id(3)]); assert.equal(second.nextAfterId, null);
  h.owner('another-owner'); assert.deepEqual((await h.journal.listHistoryPage('clinical')).records, []);
});

test('history fails closed without a history adapter and never substitutes the prepared queue', async () => {
  const h = harness(); delete h.adapter.listHistoryPage;
  await assert.rejects(h.journal.listHistoryPage('clinical'), check('unavailable'));
  assert.equal(h.calls.some(value => value.startsWith('list:')), false);
});

test('history snapshots bounds before authorization and rejects malformed, foreign or unordered rows', async () => {
  const h = harness(); await h.journal.prepare('clinical', visit(), WHEN);
  const bounds = { afterId: null as string | null, limit: 1 };
  h.hooks.auth = () => { bounds.afterId = id(99); bounds.limit = 50; };
  const page = await h.journal.listHistoryPage('clinical', bounds);
  assert.equal(page.records.length, 1); assert.ok(h.calls.includes(`history:clinical:${OWNER}:null:1`));
  delete h.hooks.auth;
  const intent = await h.journal.get(OP);
  for (const rows of [[{ id: OP, data: { ...intent, actorUid: 'other-owner' } }],
    [{ id: OP, data: { ...intent, requestHash: '0'.repeat(64) } }],
    [{ id: OP, data: intent }, { id: OP, data: intent }],
    [{ id: OP, data: { ...intent, status: 'committed', revision: 1 } }]]) {
    h.hooks.list = () => rows; await assert.rejects(h.journal.listHistoryPage('clinical'), error => check('invalid')(error) || check('conflict')(error));
  }
  delete h.hooks.list;
  for (const input of [{ limit: 0 }, { limit: 51 }, { afterId: `${OP}\n` }, { unexpected: true }]) {
    await assert.rejects(h.journal.listHistoryPage('clinical', input as never), check('invalid'));
  }
});
test('failure at any clinical write leaves intent prepared and no partially published finance', async () => {
  for (const failAt of [1, 2, 3, 4, 5]) {
    const h = harness(); await h.journal.prepare('clinical', visit(), WHEN); const before = structuredClone(h.docs);
    h.resetWrites(); h.faults.failAt = failAt;
    await assert.rejects(h.clinical.commit(visit()), clinical('unavailable')); assert.deepEqual(h.docs, before);
    assert.equal((await h.journal.get(OP))!.status, 'prepared');
  }
});
test('transaction callback retries never duplicate preparation or the clinical operation', async () => {
  const h = harness(); h.faults.retryTransaction = true; await h.journal.prepare('clinical', visit(), WHEN);
  h.faults.retryTransaction = true; await h.clinical.commit(visit());
  assert.equal(h.docs.size, 7); assert.equal((await h.journal.get(OP))!.status, 'committed');
  assert.equal(h.docs.get(path('patientAccounts', PATIENT)).sessionCount, 1);
});
test('cancellation checks absence of the domain receipt atomically and permanently rejects later commit', async () => {
  const h = harness(); await h.journal.prepare('clinical', visit(), WHEN);
  assert.equal((await h.journal.cancel(OP)).status, 'cancelled');
  const before = structuredClone(h.docs); assert.equal((await h.journal.cancel(OP)).status, 'cancelled');
  assert.equal((await h.journal.prepare('clinical', visit(), WHEN)).status, 'cancelled');
  await assert.rejects(h.clinical.commit(visit()), clinical('conflict')); assert.deepEqual(h.docs, before);
});
test('committed operations cannot be cancelled, even when the UI has not received the acknowledgement', async () => {
  const h = harness(); await h.journal.prepare('clinical', visit(), WHEN); await h.clinical.commit(visit());
  const before = structuredClone(h.docs); await assert.rejects(h.journal.cancel(OP), check('conflict')); assert.deepEqual(h.docs, before);
});
test('concurrent cancellation and commit have one winner and never leave cash behind a cancelled intent', async () => {
  for (const cancelFirst of [false, true]) {
    const h = harness(); await h.journal.prepare('clinical', visit(), WHEN);
    const actions = cancelFirst ? [() => h.journal.cancel(OP), () => h.clinical.commit(visit())]
      : [() => h.clinical.commit(visit()), () => h.journal.cancel(OP)];
    const results = await Promise.allSettled(actions.map(work => work()));
    assert.equal(results.filter(value => value.status === 'fulfilled').length, 1);
    const intent = await h.journal.get(OP); const paid = h.docs.has(path('patientReceipts'));
    assert.equal(paid, intent!.status === 'committed');
  }
});
test('missing receipt for committed intent or receipt for prepared/cancelled intent is rejected as inconsistent', async () => {
  for (const status of ['prepared', 'cancelled', 'committed']) {
    const h = harness(); await h.journal.prepare('clinical', visit(), WHEN);
    const stored = h.docs.get(path('operationIntents')); stored.status = status; stored.revision = status === 'prepared' ? 1 : 2;
    if (status !== 'committed') h.docs.set(path('clinicalOperations'), { synthetic: true });
    await assert.rejects(h.journal.prepare('clinical', visit(), WHEN), check('conflict'));
    await assert.rejects(h.journal.cancel(OP), check('conflict'));
    await assert.rejects(h.clinical.commit(visit()), clinical('conflict'));
  }
});
test('same operation ID from the wrong kind/body/hash/time cannot acknowledge or commit another command', async () => {
  for (const changes of [{ kind: 'contact' }, { requestHash: 'a'.repeat(64) }, { createdAt: `${DAY}T00:00:01.000Z` }]) {
    const h = harness(); await h.journal.prepare('clinical', visit(), WHEN); Object.assign(h.docs.get(path('operationIntents')), changes);
    const before = structuredClone(h.docs); await assert.rejects(h.clinical.commit(visit())); assert.deepEqual(h.docs, before);
  }
});
test('all prepared intent kinds resolve only their exact corresponding domain receipt path', async () => {
  for (const [kind, collection] of [['patient-profile', 'patientOperations'], ['contact', 'contactOperations'], ['clinical', 'clinicalOperations']] as const) {
    const h = harness(); await h.journal.prepare(kind, { operationId: OP }, WHEN);
    h.docs.set(path(collection), { synthetic: true }); await assert.rejects(h.journal.cancel(OP), check('conflict'));
    assert.equal(h.calls.includes(`get:${path(collection)}`), true);
  }
});
test('prepared recovery lists are bounded, UUID-ordered, kind/owner-scoped and exclude terminal entries', async () => {
  const h = harness(); await h.journal.prepare('clinical', { operationId: OP }, WHEN);
  await h.journal.prepare('clinical', { operationId: id(2) }, WHEN); await h.journal.prepare('contact', { operationId: id(3) }, WHEN);
  const page = await h.journal.listPreparedPage('clinical', { limit: 1 }); assert.equal(page.nextAfterId, OP);
  assert.deepEqual((await h.journal.listPreparedPage('clinical', { afterId: OP })).records.map(value => value.operationId), [id(2)]);
  await h.journal.cancel(OP); assert.deepEqual((await h.journal.listPreparedPage('clinical')).records.map(value => value.operationId), [id(2)]);
  assert.match(h.calls.find(value => value.includes(`list:clinical:${OWNER}:null:25`))!, /:25$/);
  const read = await h.journal.get(id(2)); read!.command.changed = true;
  assert.equal((await h.journal.get(id(2)))!.command.changed, undefined);
});
test('recovery rejects malformed, cross-owner, wrong-kind, duplicate or unordered listing rows', async () => {
  const h = harness(); await h.journal.prepare('clinical', { operationId: OP }, WHEN);
  const stored = h.docs.get(path('operationIntents'));
  for (const rows of [[{ id: OP, data: { ...stored, actorUid: 'other' } }], [{ id: OP, data: { ...stored, kind: 'contact' } }],
    [{ id: id(2), data: stored }], [{ id: OP, data: stored }, { id: OP, data: stored }], new Array(1),
    [{ id: OP, data: stored, extra: true }], [{ id: OP, data: { ...stored, status: 'cancelled', revision: 2 } }]]) {
    h.hooks.list = () => rows; await assert.rejects(h.journal.listPreparedPage('clinical'));
  }
  for (const input of [{ limit: 0 }, { limit: 51 }, { limit: 1.5 }, { afterId: `${OP}\n` }, { extra: true }]) {
    await assert.rejects(h.journal.listPreparedPage('clinical', input as any), check('invalid'));
  }
});
test('strict bounded JSON excludes accessors, symbols, prototypes, sparse arrays, cycles and invalid numbers', () => {
  let getters = 0; const getter = Object.defineProperty({ operationId: OP }, 'data', { enumerable: true, get() { getters++; return 1; } });
  const cycle: any = { operationId: OP }; cycle.data = cycle;
  const deep: any = { operationId: OP }; let current = deep; for (let i = 0; i < 10; i++) current = current.next = {};
  for (const value of [getter, Object.create({ operationId: OP }), { operationId: OP, [Symbol('private')]: 1 },
    { operationId: OP, data: new Array(1) }, cycle, deep, { operationId: OP, value: NaN },
    { operationId: OP, value: Infinity }, { operationId: OP, value: -0 }, { operationId: OP, value: undefined },
    { operationId: OP, value: 1n }, { operationId: OP, value: 'ع'.repeat(70_000) },
    { operationId: `${OP}\n` }, JSON.parse(`{"operationId":"${OP}","__proto__":{}}`)]) {
    assert.throws(() => prepareCloudIntentCommand(value), check('invalid'));
  }
  assert.equal(getters, 0);
});
test('malformed intent envelopes and hashes fail without trusting status/revision from a client', async () => {
  const h = harness(); const stored = await h.journal.prepare('clinical', visit(), WHEN);
  for (const changes of [{ extra: true }, { clinicId: 'other' }, { recordId: id(2) }, { revision: 2 }, { actorUid: ' bad ' },
    { requestHash: 'a'.repeat(64) + '\n' }, { createdAt: '2026-02-30T00:00:00.000Z' }, { status: 'unknown' }]) {
    assert.throws(() => parseCloudOperationIntent({ ...stored, ...changes }), check('invalid'));
  }
  h.docs.get(path('operationIntents')).requestHash = '0'.repeat(64);
  await assert.rejects(h.journal.get(OP), check('invalid'));
});
test('invalid prepare parameters fail before authorization or any provider call', async () => {
  const h = harness();
  for (const [kind, command, when] of [['other', { operationId: OP }, WHEN], ['clinical', { operationId: `${OP}\n` }, WHEN],
    ['clinical', visit(), '2026-02-30T00:00:00.000Z'], ['clinical', visit(), WHEN + '\n']] as const) {
    await assert.rejects(h.journal.prepare(kind as CloudOperationKind, command, when), check('invalid'));
  }
  assert.deepEqual(h.calls, []);
});
test('owner changes cannot discover, cancel or overwrite the previous owner recovery record', async () => {
  const h = harness(); await h.journal.prepare('clinical', visit(), WHEN); const before = structuredClone(h.docs);
  h.owner('another-synthetic-owner'); await assert.rejects(h.journal.get(OP), check('conflict'));
  await assert.rejects(h.journal.cancel(OP), check('conflict')); assert.deepEqual(h.docs, before);
  assert.deepEqual((await h.journal.listPreparedPage('clinical')).records, []);
});
test('missing read/query adapters fail closed and exceptions are fixed without provider payloads', async () => {
  const h = harness(), missing = createCloudOperationIntentRepository({ authorizeOwner: h.adapter.authorizeOwner, runTransaction: h.adapter.runTransaction }, { digest });
  await assert.rejects(missing.get(OP), check('unavailable'));
  await assert.rejects(missing.listPreparedPage('clinical'), check('unavailable'));
  h.hooks.auth = () => { throw new Error('PRIVATE_PROVIDER_TOKEN'); };
  await assert.rejects(h.journal.prepare('clinical', visit(), WHEN), value => check('unavailable')(value) && !String(value).includes('PRIVATE'));
});
test('transaction helper validates the whole canonical command and cannot revive terminal cancellation', async () => {
  const h = harness(); await h.journal.prepare('clinical', visit(), WHEN);
  await assert.rejects(h.adapter.runTransaction(tx => readCloudOperationIntentForCommit(tx,
    { actorUid: OWNER, kind: 'clinical', command: { ...visit(), paidCents: 0 } }, { digest })), check('conflict'));
  await h.journal.cancel(OP);
  assert.throws(() => markCloudOperationIntentCommitted({ get: async () => null, set: () => assert.fail('must not write') },
    h.docs.get(path('operationIntents'))), check('conflict'));
});
test('recovery/clinical journal dependency graph has no SDK, local storage, global App or credentials', async () => {
  const result = await build({ entryPoints: ['src/utils/cloudOperationIntent.ts'], bundle: true, platform: 'browser',
    write: false, metafile: true, logLevel: 'silent' });
  assert.equal(Object.keys(result.metafile!.inputs).length, 1);
});
