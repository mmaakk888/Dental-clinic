import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createCloudContactRepository, createJournaledCloudContactRepository, CloudContactError,
  type CloudContactCommand, type CloudContactAdapter, type CloudContactTransaction } from './cloudContactRepository';
import { createCloudOperationIntentRepository, prepareCloudIntentCommand, type CloudIntentAdapter } from './cloudOperationIntent';

const ID = '10000000-0000-4000-8000-000000000001';
const ID2 = '10000000-0000-4000-8000-000000000002';
const OP = '20000000-0000-4000-8000-000000000001';
const OP2 = '20000000-0000-4000-8000-000000000002';
const OP3 = '20000000-0000-4000-8000-000000000003';
const OP4 = '20000000-0000-4000-8000-000000000004';
const UID = 'synthetic-owner';
const TIME = '2026-10-12T10:00:00.000Z';
const digest = async (value: string) => createHash('sha256').update(value).digest('hex');
const rPath = (id = ID) => `clinics/main/contactRecords/${id}`;
const iPath = (id = OP) => `clinics/main/operationIntents/${id}`;
const oPath = (id = OP) => `clinics/main/contactOperations/${id}`;
const pPath = (phone: string) => `clinics/main/contactPhones/${createHash('sha256').update(`contact-phone-v1:${phone}`).digest('hex')}`;
const input = (changes: Partial<CloudContactCommand> = {}): CloudContactCommand => ({ operationId: OP,
  recordId: ID, expectedRevision: 0, action: 'create', contact: { id: ID, name: 'جهة مصطنعة', mobile: '01000000001',
    createdAt: '2026-10-08T10:00:00.000Z' }, ...changes });
const code = (value: CloudContactError['code']) => (error: unknown) => error instanceof CloudContactError && error.code === value;

/** Serialized clone-and-publish fixture, not Firestore or Rules verification. */
function harness() {
  const rows = new Map<string, any>(), calls: string[] = [];
  const controls = { actor: UID, lostReply: false, failAtWrite: 0 };
  let tail = Promise.resolve();
  const runTransaction = async <T>(work: (transaction: CloudContactTransaction) => Promise<T>) => {
    const prior = tail; let release!: () => void;
    tail = new Promise<void>(resolve => { release = resolve; }); await prior;
    try {
      const staged = structuredClone(rows); let wrote = false, writes = 0;
      const result = await work({
        get: async path => { assert.equal(wrote, false, 'all reads precede writes'); calls.push(`get:${path}`); return structuredClone(staged.get(path) ?? null); },
        set: (path, value) => { wrote = true; calls.push(`set:${path}`);
          if (++writes === controls.failAtWrite) throw new Error('PRIVATE_WRITE_FAILURE'); staged.set(path, structuredClone(value)); },
        delete: path => { wrote = true; calls.push(`delete:${path}`); staged.delete(path); },
      });
      rows.clear(); for (const [key, value] of staged) rows.set(key, value);
      if (controls.lostReply) { controls.lostReply = false; throw new Error('PRIVATE_LOST_ACK'); }
      return result;
    } finally { release(); }
  };
  const adapter: CloudContactAdapter & CloudIntentAdapter = {
    authorizeOwner: async () => controls.actor, runTransaction,
    readRecord: async path => structuredClone(rows.get(path) ?? null),
    listHistoryPage: async (kind, actorUid, after, limit) => [...rows.entries()]
      .filter(([path, value]) => path.startsWith('clinics/main/operationIntents/') && value.kind === kind
        && value.actorUid === actorUid && (!after || value.operationId > after))
      .sort(([left], [right]) => left.localeCompare(right)).slice(0, limit).map(([path, data]) => ({ id: path.split('/').at(-1), data })),
  };
  return { rows, calls, controls, adapter, repo: createJournaledCloudContactRepository(adapter, { digest }),
    journal: createCloudOperationIntentRepository(adapter, { digest }) };
}

test('journaled contact factory is inert and cannot opt out of preparation', async () => {
  const h = harness(); assert.deepEqual(h.calls, []);
  await assert.rejects(h.repo.commit(input()), code('invalid')); assert.equal(h.rows.size, 0);
  const rogue = createJournaledCloudContactRepository(h.adapter, { digest, journaled: false } as any);
  await assert.rejects(rogue.commit(input()), code('invalid')); assert.equal(h.rows.size, 0);
});

test('legacy standalone contact receipt and fingerprint remain exact and independent', async () => {
  const h = harness(), command = input(), repo = createCloudContactRepository(h.adapter, { digest });
  await repo.commit(command); assert.equal(h.rows.size, 3);
  assert.deepEqual(Object.keys(h.rows.get(oPath())).sort(), ['schemaVersion', 'clinicId', 'operationId', 'actorUid',
    'recordId', 'action', 'expectedRevision', 'resultRevision', 'requestHash'].sort());
  assert.equal(h.rows.get(oPath()).requestHash, await digest(JSON.stringify([UID, OP, ID, 0, 'create', command.contact])));
});

test('prepared contact commit atomically binds full journal envelope, receipt and reservation', async () => {
  const h = harness(), command = input(); const intent = await h.journal.prepare('contact', command, TIME);
  assert.equal(h.rows.size, 1); assert.equal(h.rows.get(rPath()), undefined);
  assert.equal((await h.repo.commit(command)).status, 'committed'); assert.equal(h.rows.size, 4);
  const receipt = h.rows.get(oPath());
  assert.equal(receipt.intentCreatedAt, TIME); assert.equal(receipt.intentRequestHash, intent.requestHash);
  assert.equal(h.rows.get(iPath()).status, 'committed'); assert.equal(h.rows.get(iPath()).revision, 2);
  assert.equal(h.rows.get(pPath('201000000001')).recordId, ID);
  assert.equal(receipt.requestHash, await digest(JSON.stringify([UID, OP, ID, 0, 'create', command.contact])));
});

test('lost preparation acknowledgement is rediscovered with same command and creates no domain data', async () => {
  const h = harness(); h.controls.lostReply = true;
  await assert.rejects(h.journal.prepare('contact', input(), TIME)); assert.equal(h.rows.size, 1);
  const fresh = createCloudOperationIntentRepository(h.adapter, { digest });
  assert.equal((await fresh.listHistoryPage('contact')).records[0].status, 'prepared');
  assert.equal((await fresh.prepare('contact', input(), TIME)).operationId, OP);
  assert.equal((await h.repo.commit(input())).revision, 1);
});

test('lost commit acknowledgement survives new repository and all-status history without duplicate', async () => {
  const h = harness(); await h.journal.prepare('contact', input(), TIME); h.controls.lostReply = true;
  await assert.rejects(h.repo.commit(input()), code('unavailable')); assert.equal(h.rows.size, 4);
  const journal = createCloudOperationIntentRepository(h.adapter, { digest });
  const record = (await journal.listHistoryPage('contact')).records[0]; assert.equal(record.status, 'committed');
  const before = structuredClone(h.rows); const repo = createJournaledCloudContactRepository(h.adapter, { digest });
  assert.equal((await repo.commit(record.command as unknown as CloudContactCommand)).status, 'already-committed');
  assert.deepEqual(h.rows, before);
});

test('historical create replay cannot restore old phone after update and reassignment', async () => {
  const h = harness(), first = input(); await h.journal.prepare('contact', first, TIME); await h.repo.commit(first);
  const update = input({ operationId: OP2, expectedRevision: 1, action: 'update', contact: { ...first.contact!, mobile: '01000000002' } });
  await h.journal.prepare('contact', update, TIME); await h.repo.commit(update);
  const other = input({ operationId: OP3, recordId: ID2, contact: { ...first.contact!, id: ID2 } });
  await h.journal.prepare('contact', other, TIME); await h.repo.commit(other); const before = structuredClone(h.rows);
  assert.equal((await h.repo.commit(first)).status, 'already-committed'); assert.deepEqual(h.rows, before);
  assert.equal(h.rows.get(pPath('201000000001')).recordId, ID2); assert.equal(h.rows.get(rPath()).data.mobile, '01000000002');
});

test('historical update replay after tombstone cannot resurrect a record or steal reassigned phone', async () => {
  const h = harness(), first = input(); await h.journal.prepare('contact', first, TIME); await h.repo.commit(first);
  const update = input({ operationId: OP2, expectedRevision: 1, action: 'update', contact: { ...first.contact!, mobile: '01000000002' } });
  await h.journal.prepare('contact', update, TIME); await h.repo.commit(update);
  const remove = input({ operationId: OP3, expectedRevision: 2, action: 'delete', contact: null });
  await h.journal.prepare('contact', remove, TIME); await h.repo.commit(remove);
  const other = input({ operationId: OP4, recordId: ID2, contact: { ...first.contact!, id: ID2, mobile: '01000000002' } });
  await h.journal.prepare('contact', other, TIME); await h.repo.commit(other); const before = structuredClone(h.rows);
  assert.equal((await h.repo.commit(update)).revision, 2); assert.deepEqual(h.rows, before);
  assert.equal(h.rows.get(rPath()).deleted, true); assert.equal(h.rows.get(pPath('201000000002')).recordId, ID2);
});

test('journaled receipt cannot be replayed against changed envelope timestamp or fingerprint', async () => {
  for (const changes of [{ createdAt: '2026-10-12T11:00:00.000Z' }, { requestHash: 'a'.repeat(64) }]) {
    const h = harness(); await h.journal.prepare('contact', input(), TIME); await h.repo.commit(input());
    h.rows.set(iPath(), { ...h.rows.get(iPath()), ...changes }); const before = structuredClone(h.rows);
    await assert.rejects(h.repo.commit(input()), (error: unknown) => error instanceof CloudContactError);
    assert.deepEqual(h.rows, before);
  }
});

test('journaled commit rejects actor, kind, command or path mismatches before domain writes', async () => {
  for (const mutate of [
    (h: ReturnType<typeof harness>) => { h.controls.actor = 'other-synthetic-owner'; },
    (h: ReturnType<typeof harness>) => { h.rows.set(iPath(), { ...h.rows.get(iPath()), kind: 'clinical' }); },
    (h: ReturnType<typeof harness>) => { h.rows.set(iPath(), { ...h.rows.get(iPath()), command: { ...h.rows.get(iPath()).command, recordId: ID2 } }); },
    (h: ReturnType<typeof harness>) => { h.rows.set(iPath(), { ...h.rows.get(iPath()), operationId: OP2, recordId: OP2 }); },
  ]) {
    const h = harness(); await h.journal.prepare('contact', input(), TIME); mutate(h);
    const before = structuredClone(h.rows), writes = h.calls.filter(value => value.startsWith('set:')).length;
    await assert.rejects(h.repo.commit(input())); assert.deepEqual(h.rows, before);
    assert.equal(h.calls.filter(value => value.startsWith('set:')).length, writes);
  }
});

test('cancelled, prepared-with-receipt and committed-without-receipt never commit/replay', async () => {
  for (const stage of ['cancelled', 'prepared-receipt', 'committed-missing', 'legacy-receipt'] as const) {
    const h = harness(); await h.journal.prepare('contact', input(), TIME);
    if (stage === 'cancelled') await h.journal.cancel(OP);
    else if (stage === 'prepared-receipt') h.rows.set(oPath(), { fake: true });
    else {
      await h.repo.commit(input());
      if (stage === 'committed-missing') h.rows.delete(oPath());
      else { const { intentCreatedAt: _at, intentRequestHash: _hash, ...legacy } = h.rows.get(oPath()); h.rows.set(oPath(), legacy); }
    }
    const before = structuredClone(h.rows); await assert.rejects(h.repo.commit(input())); assert.deepEqual(h.rows, before);
  }
});

test('partial staging failure rolls back journal transition, receipt and all contact/phone writes', async () => {
  for (const failAtWrite of [1, 2, 3, 4]) {
    const h = harness(); await h.journal.prepare('contact', input(), TIME); h.controls.failAtWrite = failAtWrite;
    await assert.rejects(h.repo.commit(input()), code('unavailable')); assert.equal(h.rows.size, 1);
    assert.equal(h.rows.get(iPath()).status, 'prepared');
  }
});

test('cancel-versus-contact-commit race has exactly one durable winner', async () => {
  for (const cancelFirst of [false, true]) {
    const h = harness(); await h.journal.prepare('contact', input(), TIME);
    const actions = cancelFirst ? [() => h.journal.cancel(OP), () => h.repo.commit(input())]
      : [() => h.repo.commit(input()), () => h.journal.cancel(OP)];
    const result = await Promise.allSettled(actions.map(action => action()));
    assert.equal(result.filter(value => value.status === 'fulfilled').length, 1);
    const committed = h.rows.get(iPath()).status === 'committed';
    const commitResult = result[cancelFirst ? 1 : 0]; assert.equal(committed, commitResult.status === 'fulfilled');
    assert.equal(h.rows.has(oPath()), committed); assert.equal(h.rows.has(rPath()), committed);
  }
});

test('concurrent prepared contacts with equivalent numbers produce only one domain record', async () => {
  const h = harness(), other = input({ operationId: OP2, recordId: ID2,
    contact: { ...input().contact!, id: ID2, mobile: '+201000000001' } });
  await h.journal.prepare('contact', input(), TIME); await h.journal.prepare('contact', other, TIME);
  const results = await Promise.allSettled([h.repo.commit(input()), h.repo.commit(other)]);
  assert.equal(results.filter(value => value.status === 'fulfilled').length, 1);
  assert.equal(results.filter(value => value.status === 'rejected' && code('duplicate')(value.reason)).length, 1);
  assert.equal(h.rows.get(iPath(OP2)).status, 'prepared'); assert.equal(h.rows.get(pPath('201000000001')).recordId, ID);
});

test('contact preparation timestamp remains explicit and outside canonical command', async () => {
  const h = harness(), command = input(); const prepared = await h.journal.prepare('contact', command, TIME);
  assert.equal(Object.hasOwn(prepared.command, 'createdAt'), false); assert.equal(prepared.createdAt, TIME);
  assert.deepEqual(prepared.command, prepareCloudIntentCommand(command));
  const altered = input(); altered.contact!.createdAt = '2026-10-09T10:00:00.000Z';
  await assert.rejects(h.repo.commit(altered), code('conflict')); assert.equal(h.rows.size, 1);
});
