import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { CloudPatientError, createCloudPatientRepository, createJournaledCloudPatientRepository, parseCloudPatientRecord, prepareCloudPatientCommand,
  prepareCloudPatientPageInput, prepareCloudPatientPhoneInput, type CloudPatientAdapter, type CloudPatientCommand,
  type CloudPatientTransaction } from './cloudPatientRepository';
import { createCloudOperationIntentRepository } from './cloudOperationIntent';

const ID = '10000000-0000-4000-8000-000000000001';
const OTHER = '10000000-0000-4000-8000-000000000002';
const OP = '20000000-0000-4000-8000-000000000001';
const OP2 = '20000000-0000-4000-8000-000000000002';
const OP3 = '20000000-0000-4000-8000-000000000003';
const OWNER = 'synthetic-owner';
const root = 'clinics/main/';
const counterPath = `${root}counters/patientFiles`;
const recordPath = (id = ID) => `${root}patientProfiles/${id}`;
const operationPath = (id = OP) => `${root}patientOperations/${id}`;
const filePath = (n = 1) => `${root}patientFiles/${n}`;
const digest = async (text: string) => createHash('sha256').update(text).digest('hex');
const code = (expected: CloudPatientError['code']) => (value: unknown) => value instanceof CloudPatientError && value.code === expected;
const command = (changes: Partial<CloudPatientCommand> = {}): CloudPatientCommand => ({ operationId: OP, recordId: ID,
  expectedRevision: 0, action: 'create', profile: { name: 'مريض اختبار مصطنع', mobile: '01000000001', age: 30,
    gender: '', firstVisit: '2026-10-10', notes: '', allergy: '' }, ...changes });
const CREATED = '2026-10-12T09:00:00.000Z';
const intentPath = (id = OP) => `${root}operationIntents/${id}`;

/** Atomic in-memory synthetic adapter. Serialization is a test aid, NOT a
 * real two-device or Firestore Rules verification. */
function harness(options: { lostReply?: boolean; retry?: boolean; failWrite?: number } = {}) {
  const documents = new Map<string, any>([[counterPath, { schemaVersion: 1, clinicId: 'main', lastFileNo: 0, lastOperationId: null }]]);
  const calls: string[] = [];
  let tail = Promise.resolve(), uid = OWNER, writes = 0;
  const adapter: CloudPatientAdapter = {
    authorizeOwner: async () => { calls.push('auth'); return uid; },
    readRecord: async path => { calls.push(`read:${path}`); return structuredClone(documents.get(path) ?? null); },
    listRecordsPage: async (afterId, limit) => {
      calls.push('list'); return [...documents].filter(([path]) => path.startsWith(`${root}patientProfiles/`) && (!afterId || path.slice(path.lastIndexOf('/') + 1) > afterId))
        .sort(([a], [b]) => a < b ? -1 : 1).slice(0, limit).map(([path, data]) => ({ id: path.slice(path.lastIndexOf('/') + 1), data: structuredClone(data) }));
    },
    findRecordsByPhone: async (key, afterId, limit) => {
      calls.push(`phone:${key}`); return (await adapter.listRecordsPage!(afterId, 50) as any[]).filter(row => row.data.phoneKey === key).slice(0, limit);
    },
    runTransaction: async work => {
      const previous = tail; let release!: () => void;
      tail = new Promise<void>(resolve => { release = resolve; }); await previous;
      const attempt = async (publish: boolean) => {
        const staged = structuredClone(documents); let wrote = false;
        const transaction: CloudPatientTransaction = {
          get: async path => { assert.equal(wrote, false, 'read after write'); calls.push(`get:${path}`); return structuredClone(staged.get(path) ?? null); },
          set: (path, value) => { wrote = true; calls.push(`set:${path}`); if (++writes === options.failWrite) throw new Error('SECRET_PROVIDER_DETAIL'); staged.set(path, structuredClone(value)); },
        };
        const result = await work(transaction);
        if (publish) { documents.clear(); for (const [key, value] of staged) documents.set(key, value); }
        return result;
      };
      try {
        if (options.retry) { options.retry = false; await attempt(false); }
        const result = await attempt(true);
        if (options.lostReply) { options.lostReply = false; throw new Error('SECRET_LOST_REPLY'); }
        return result;
      } finally { release(); }
    },
  };
  return { documents, calls, adapter, repo: createCloudPatientRepository(adapter, { digest }), actor: (value: string) => { uid = value; } };
}

function journalHarness(options: Parameters<typeof harness>[0] = {}) {
  const h = harness(options);
  return { ...h, repo: createJournaledCloudPatientRepository(h.adapter, { digest }),
    journal: createCloudOperationIntentRepository(h.adapter, { digest }) };
}

test('journaled patient factory is inert and has no option to fall back to unprepared commit', async () => {
  const h = journalHarness(); assert.deepEqual(h.calls, []);
  await assert.rejects(h.repo.commit(command()), code('invalid'));
  assert.equal(h.documents.size, 1); assert.equal(h.calls.some(value => value.startsWith('set:')), false);
  const attemptedBypass = createJournaledCloudPatientRepository(h.adapter, { digest, journalRequired: false } as any);
  await assert.rejects(attemptedBypass.commit(command()), code('invalid'));
});

test('journaled patient creation writes profile number receipt and committed intent atomically', async () => {
  const h = journalHarness(); await h.journal.prepare('patient-profile', command(), CREATED);
  assert.equal(h.documents.get(counterPath).lastFileNo, 0); assert.equal(h.documents.size, 2);
  assert.equal((await h.repo.commit(command())).fileNo, 1);
  assert.equal(h.documents.size, 5); assert.equal(h.documents.get(intentPath()).status, 'committed');
  assert.equal(h.documents.get(intentPath()).revision, 2);
  const receipt = h.documents.get(operationPath());
  assert.equal(receipt.intentCreatedAt, CREATED);
  assert.equal(receipt.intentRequestHash, h.documents.get(intentPath()).requestHash);
  assert.equal(receipt.requestHash, await digest(JSON.stringify([OWNER, OP, ID, 0, 'create', command().profile])));
});

test('journaled patient commit rejects wrong actor kind command fingerprint and cancelled intent before writes', async () => {
  const cases = [
    (intent: any) => { intent.actorUid = 'other-owner'; },
    (intent: any) => { intent.kind = 'contact'; },
    (intent: any) => { intent.requestHash = 'f'.repeat(64); },
    (intent: any) => { intent.command.profile.notes = 'altered'; },
    (intent: any) => { intent.status = 'cancelled'; intent.revision = 2; },
  ];
  for (const alter of cases) {
    const h = journalHarness(); await h.journal.prepare('patient-profile', command(), CREATED);
    alter(h.documents.get(intentPath())); const before = structuredClone(h.documents), count = h.calls.length;
    await assert.rejects(h.repo.commit(command()), error => error instanceof CloudPatientError);
    assert.deepEqual(h.documents, before); assert.equal(h.calls.slice(count).some(value => value.startsWith('set:')), false);
  }
});

test('journaled patient receipt and intent statuses must agree in both directions', async () => {
  for (const mismatch of ['prepared-with-receipt', 'committed-without-receipt']) {
    const h = journalHarness(); await h.journal.prepare('patient-profile', command(), CREATED); await h.repo.commit(command());
    if (mismatch === 'prepared-with-receipt') Object.assign(h.documents.get(intentPath()), { status: 'prepared', revision: 1 });
    else h.documents.delete(operationPath());
    const before = structuredClone(h.documents);
    await assert.rejects(h.repo.commit(command()), code('conflict')); assert.deepEqual(h.documents, before);
  }
});

test('journaled patient old receipt cannot replay under a replaced preparation time or missing bound envelope', async () => {
  for (const alter of [(h: ReturnType<typeof journalHarness>) => { h.documents.get(intentPath()).createdAt = '2026-10-12T10:00:00.000Z'; },
    (h: ReturnType<typeof journalHarness>) => { delete h.documents.get(operationPath()).intentCreatedAt; },
    (h: ReturnType<typeof journalHarness>) => { h.documents.get(operationPath()).intentRequestHash = '0'.repeat(64); }]) {
    const h = journalHarness(); await h.journal.prepare('patient-profile', command(), CREATED); await h.repo.commit(command());
    alter(h); const before = structuredClone(h.documents);
    await assert.rejects(h.repo.commit(command()), error => error instanceof CloudPatientError);
    assert.deepEqual(h.documents, before);
  }
});

test('journaled patient lost prepare and commit replies recover original identifiers without another allocation', async () => {
  const flags = { lostReply: true }, h = journalHarness(flags);
  await assert.rejects(h.journal.prepare('patient-profile', command(), CREATED));
  assert.equal((await h.journal.get(OP))?.status, 'prepared');
  assert.equal((await h.journal.prepare('patient-profile', command(), CREATED)).status, 'prepared');
  flags.lostReply = true; await assert.rejects(h.repo.commit(command()), code('unavailable'));
  const after = structuredClone(h.documents), fresh = createJournaledCloudPatientRepository(h.adapter, { digest });
  assert.equal((await fresh.commit(command())).status, 'already-committed'); assert.deepEqual(h.documents, after);
  assert.equal(h.documents.get(counterPath).lastFileNo, 1);
});

test('journaled patient historical replay never reads a newer profile or counter or replaces current details', async () => {
  const h = journalHarness(); await h.journal.prepare('patient-profile', command(), CREATED); await h.repo.commit(command());
  const update = command({ operationId: OP2, action: 'update', expectedRevision: 1, profile: { ...command().profile, name: 'newer synthetic' } });
  await h.journal.prepare('patient-profile', update, CREATED); await h.repo.commit(update);
  const other = command({ recordId: OTHER, operationId: OP3 });
  await h.journal.prepare('patient-profile', other, CREATED); await h.repo.commit(other);
  const before = structuredClone(h.documents), count = h.calls.length;
  assert.deepEqual(await h.repo.commit(command()), { status: 'already-committed', recordId: ID, fileNo: 1, revision: 1 });
  assert.deepEqual(h.documents, before);
  assert.equal(h.calls.slice(count).some(value => value === `get:${counterPath}` || value === `get:${recordPath()}` || value.startsWith('set:')), false);
  assert.equal((await h.repo.get(ID))?.data.name, 'newer synthetic');
});

test('journaled patient cancellation and commit race have one winner and no partial allocation', async () => {
  for (const cancelFirst of [true, false]) {
    const h = journalHarness(); await h.journal.prepare('patient-profile', command(), CREATED);
    const results = await Promise.allSettled(cancelFirst
      ? [h.journal.cancel(OP), h.repo.commit(command())] : [h.repo.commit(command()), h.journal.cancel(OP)]);
    assert.equal(results.filter(value => value.status === 'fulfilled').length, 1);
    const committed = h.documents.get(intentPath()).status === 'committed';
    assert.equal(h.documents.get(counterPath).lastFileNo, committed ? 1 : 0);
    assert.equal(h.documents.has(recordPath()), committed);
  }
  const h = journalHarness(); await h.journal.prepare('patient-profile', command(), CREATED); await h.repo.commit(command());
  await assert.rejects(h.journal.cancel(OP)); assert.equal(h.documents.get(intentPath()).status, 'committed');
});

test('journaled patient domain failure and SDK callback replay preserve prepared intent atomically', async () => {
  const flags = { failWrite: 4, retry: false }, h = journalHarness(flags);
  await h.journal.prepare('patient-profile', command(), CREATED); const before = structuredClone(h.documents);
  await assert.rejects(h.repo.commit(command()), code('unavailable')); assert.deepEqual(h.documents, before);
  const retry = journalHarness({ retry: true }); await retry.journal.prepare('patient-profile', command(), CREATED);
  assert.equal((await retry.repo.commit(command())).fileNo, 1); assert.equal(retry.documents.size, 5);
});

test('journaled patient missing or exhausted trusted counter never seeds or consumes a prepared intent', async () => {
  for (const missing of [true, false]) {
    const h = journalHarness(); await h.journal.prepare('patient-profile', command(), CREATED);
    if (missing) h.documents.delete(counterPath);
    else Object.assign(h.documents.get(counterPath), { lastFileNo: 2_000_000_000, lastOperationId: OP3 });
    const before = structuredClone(h.documents); await assert.rejects(h.repo.commit(command()), code('unavailable'));
    assert.deepEqual(h.documents, before); assert.equal(h.documents.get(intentPath()).status, 'prepared');
  }
});

test('patient repository construction is inert, profile-only and has no implicit counter bootstrap', async () => {
  const h = harness(); assert.deepEqual(h.calls, []);
  h.documents.delete(counterPath);
  await assert.rejects(h.repo.commit(command()), code('unavailable')); assert.equal(h.documents.size, 0);
});
test('create atomically assigns the first file number, profile, index and data-free operation receipt', async () => {
  const h = harness();
  assert.deepEqual(await h.repo.commit(command()), { status: 'committed', recordId: ID, fileNo: 1, revision: 1 });
  assert.equal(h.documents.size, 4); assert.equal(h.documents.get(counterPath).lastFileNo, 1);
  assert.equal(h.documents.get(filePath()).recordId, ID);
  assert.deepEqual(parseCloudPatientRecord(h.documents.get(recordPath())).data, command().profile);
  assert.equal(h.documents.get(recordPath()).phoneKey, await digest('patient-phone-v1:201000000001'));
  assert.doesNotMatch(JSON.stringify(h.documents.get(operationPath())), /مصطنع|01000000001|notes|allergy/);
});
test('concurrent synthetic clients allocate different sequential numbers even with a shared family phone', async () => {
  const h = harness(), second = createCloudPatientRepository(h.adapter, { digest });
  const results = await Promise.all([h.repo.commit(command()), second.commit(command({ recordId: OTHER, operationId: OP2 }))]);
  assert.deepEqual(results.map(value => value.fileNo).sort(), [1, 2]);
  assert.equal(h.documents.get(counterPath).lastFileNo, 2);
  assert.equal(h.documents.get(recordPath()).phoneKey, h.documents.get(recordPath(OTHER)).phoneKey);
  assert.equal(h.documents.size, 7);
});
test('allocation continues from a trusted existing counter rather than local rows or client file number', async () => {
  const h = harness(); h.documents.set(counterPath, { schemaVersion: 1, clinicId: 'main', lastFileNo: 450, lastOperationId: OP3 });
  assert.equal((await h.repo.commit(command())).fileNo, 451);
  await assert.rejects(h.repo.commit({ ...command({ operationId: OP2, recordId: OTHER }), fileNo: 999 } as any), code('invalid'));
});
test('same operation retry and a lost reply allocate once, including after a newer profile update', async () => {
  const h = harness({ lostReply: true }); await assert.rejects(h.repo.commit(command()), code('unavailable'));
  const afterCommit = structuredClone(h.documents);
  assert.deepEqual(await h.repo.commit(command()), { status: 'already-committed', recordId: ID, fileNo: 1, revision: 1 });
  assert.deepEqual(h.documents, afterCommit);
  const update = command({ operationId: OP2, action: 'update', expectedRevision: 1 }); update.profile.name = 'اسم أحدث مصطنع';
  await h.repo.commit(update); const afterUpdate = structuredClone(h.documents);
  assert.equal((await h.repo.commit(command())).revision, 1); assert.deepEqual(h.documents, afterUpdate);
  assert.equal((await h.repo.get(ID))?.data.name, 'اسم أحدث مصطنع');
});
test('SDK callback retries keep the same command and only publish the successful transaction', async () => {
  const h = harness({ retry: true }); await h.repo.commit(command());
  assert.equal(h.documents.get(counterPath).lastFileNo, 1); assert.equal(h.documents.size, 4);
  assert.equal(h.calls.filter(value => value === `set:${counterPath}`).length, 2);
});
test('reused operation IDs with changed identity, expected revision or content reject as conflict', async () => {
  const h = harness(); await h.repo.commit(command()); const before = structuredClone(h.documents);
  for (const changed of [command({ recordId: OTHER }), command({ action: 'update', expectedRevision: 1 }),
    { ...command(), profile: { ...command().profile, name: 'اسم مختلف' } }]) {
    await assert.rejects(h.repo.commit(changed), code('conflict')); assert.deepEqual(h.documents, before);
  }
  h.actor('different-owner'); await assert.rejects(h.repo.commit(command()), code('conflict'));
});
test('update CAS preserves allocated number and never replaces the counter or file index', async () => {
  const h = harness(); await h.repo.commit(command()); h.calls.length = 0;
  const update = command({ action: 'update', expectedRevision: 1, operationId: OP2 }); update.profile.mobile = ''; update.profile.notes = 'ملاحظة\nاختبار';
  assert.deepEqual(await h.repo.commit(update), { status: 'committed', recordId: ID, fileNo: 1, revision: 2 });
  assert.equal(h.documents.get(recordPath()).phoneKey, null);
  assert.equal(h.calls.some(value => value === `set:${counterPath}` || value === `set:${filePath()}`), false);
  const before = structuredClone(h.documents);
  await assert.rejects(h.repo.commit({ ...update, operationId: OP3 }), code('conflict')); assert.deepEqual(h.documents, before);
});
test('two synthetic edits based on the same revision cannot silently overwrite one another', async () => {
  const h = harness(); await h.repo.commit(command());
  const results = await Promise.allSettled([h.repo.commit(command({ action: 'update', expectedRevision: 1, operationId: OP2 })),
    h.repo.commit(command({ action: 'update', expectedRevision: 1, operationId: OP3 }))]);
  assert.equal(results.filter(value => value.status === 'fulfilled').length, 1);
  assert.equal(results.filter(value => value.status === 'rejected' && code('conflict')(value.reason)).length, 1);
});
test('a failed write never publishes a partial allocation/profile/index/receipt in the synthetic atomic adapter', async () => {
  for (const failWrite of [1, 2, 3, 4]) {
    const h = harness({ failWrite }), before = structuredClone(h.documents);
    await assert.rejects(h.repo.commit(command()), code('unavailable')); assert.deepEqual(h.documents, before);
  }
});
test('occupied next file number is a conflict, never skipped or overwritten', async () => {
  const h = harness(); h.documents.set(filePath(), { schemaVersion: 1, clinicId: 'main', fileNo: 1, recordId: OTHER });
  const before = structuredClone(h.documents);
  await assert.rejects(h.repo.commit(command()), code('conflict')); assert.deepEqual(h.documents, before);
});
test('missing or malformed allocation state, exhaustion and orphan indexes fail closed', async () => {
  for (const value of [null, {}, { schemaVersion: 1, clinicId: 'main', lastFileNo: -1, lastOperationId: OP },
    { schemaVersion: 1, clinicId: 'main', lastFileNo: 1, lastOperationId: null },
    { schemaVersion: 1, clinicId: 'main', lastFileNo: 0, lastOperationId: OP },
    { schemaVersion: 1, clinicId: 'main', lastFileNo: 2_000_000_000, lastOperationId: OP }]) {
    const h = harness(); if (value === null) h.documents.delete(counterPath); else h.documents.set(counterPath, value);
    const before = structuredClone(h.documents); await assert.rejects(h.repo.commit(command()), error => code('invalid')(error) || code('unavailable')(error));
    assert.deepEqual(h.documents, before);
  }
  const h = harness(); await h.repo.commit(command()); h.documents.set(filePath(), { schemaVersion: 1, clinicId: 'main', fileNo: 1, recordId: OTHER });
  await assert.rejects(h.repo.commit(command({ action: 'update', expectedRevision: 1, operationId: OP2 })), code('invalid'));
});
test('profile-only command rejects clinical arrays, caller-assigned file number, paths, malformed values and invalid dates before authorization', async () => {
  const badProfiles = [ { ...command().profile, sessions: [] }, { ...command().profile, payments: [] },
    { ...command().profile, name: '' }, { ...command().profile, name: ' leading' }, { ...command().profile, mobile: 'abc123' },
    { ...command().profile, age: 121 }, { ...command().profile, age: 2.5 }, { ...command().profile, gender: ' '.repeat(41) },
    { ...command().profile, firstVisit: '2026-02-31' }, { ...command().profile, firstVisit: '1899-12-31' },
    { ...command().profile, notes: 'x'.repeat(4001) }, { ...command().profile, allergy: '\u0000' } ];
  for (const value of [ ...badProfiles.map(profile => ({ ...command(), profile })), { ...command(), fileNo: 1 },
    command({ recordId: '../private' }), command({ expectedRevision: 1 }), command({ expectedRevision: 0, action: 'update' }),
    command({ expectedRevision: 2_000_000_000, action: 'update' }) ]) {
    const h = harness(); await assert.rejects(h.repo.commit(value as any), code('invalid')); assert.deepEqual(h.calls, []);
  }
});
test('input snapshots detach before authorization waits and do not execute getters or preserve custom prototypes', async () => {
  const value = command(), prepared = prepareCloudPatientCommand(value); value.profile.name = 'تغيير'; assert.notEqual(prepared.profile.name, value.profile.name);
  let touched = false;
  const getter = { ...command() }; Object.defineProperty(getter, 'profile', { enumerable: true, get: () => { touched = true; throw new Error('PRIVATE'); } });
  assert.throws(() => prepareCloudPatientCommand(getter), code('invalid')); assert.equal(touched, false);
  assert.throws(() => prepareCloudPatientCommand(Object.assign(Object.create({}), command())), code('invalid'));
  assert.throws(() => prepareCloudPatientCommand(new Proxy({}, { ownKeys() { throw new Error('PRIVATE'); } })), code('invalid'));
  const h = harness(), input = command(); let resolve!: () => void, entered!: () => void;
  const gate = new Promise<void>(accept => { resolve = accept; }), reached = new Promise<void>(accept => { entered = accept; });
  const original = h.adapter.authorizeOwner; let first = true;
  h.adapter.authorizeOwner = async () => { if (first) { first = false; entered(); await gate; } return original(); };
  const pending = h.repo.commit(input); await reached; input.profile.name = 'تغيير متأخر'; resolve(); await pending;
  assert.notEqual(h.documents.get(recordPath()).data.name, input.profile.name);
});
test('get and file lookup return detached validated current records with exact cross-links', async () => {
  const h = harness(); assert.equal(await h.repo.get(ID), null); assert.equal(await h.repo.getByFileNo(1), null);
  await h.repo.commit(command());
  const result = await h.repo.getByFileNo(1); assert.equal(result?.recordId, ID); result!.data.name = 'تغيير الخارج';
  assert.notEqual((await h.repo.get(ID))?.data.name, result!.data.name);
  h.documents.get(recordPath()).fileNo = 2; await assert.rejects(h.repo.getByFileNo(1), code('invalid'));
  h.documents.delete(recordPath()); await assert.rejects(h.repo.getByFileNo(1), code('invalid'));
});
test('stored phone-key mismatches and malformed envelopes reject reads and writes without raw details', async () => {
  const h = harness(); await h.repo.commit(command()); h.documents.get(recordPath()).phoneKey = 'a'.repeat(64);
  await assert.rejects(h.repo.get(ID), code('invalid'));
  await assert.rejects(h.repo.commit(command({ operationId: OP2, action: 'update', expectedRevision: 1 })), code('invalid'));
  for (const extra of [{ sessions: [] }, { fileNo: '1' }, { clinicId: 'other' }, { revision: 0 }]) assert.throws(() => parseCloudPatientRecord({ ...h.documents.get(recordPath()), ...extra }), code('invalid'));
});
test('bounded UUID cursor pages include every household phone match without making it unique or merging', async () => {
  const h = harness(); await h.repo.commit(command()); await h.repo.commit(command({ operationId: OP2, recordId: OTHER }));
  const first = await h.repo.listPage({ limit: 1 }); assert.equal(first.nextAfterId, ID); assert.equal(first.records.length, 1);
  const second = await h.repo.listPage({ limit: 1, afterId: first.nextAfterId }); assert.equal(second.records[0].fileNo, 2);
  assert.deepEqual(await h.repo.listPage({ afterId: second.nextAfterId, limit: 1 }), { records: [], nextAfterId: null });
  const matches = await h.repo.findByPhone({ mobile: '+٢٠١٠٠٠٠٠٠٠٠١' }); assert.deepEqual(matches.records.map(value => value.fileNo), [1, 2]);
  assert.equal((await h.repo.findByPhone({ mobile: '01000000002' })).records.length, 0);
});
test('query validation rejects fragments, extra fields, null limit and malformed cursors before auth', async () => {
  assert.deepEqual(prepareCloudPatientPageInput(undefined), { afterId: null, limit: 25 });
  assert.deepEqual(prepareCloudPatientPhoneInput({ mobile: '01000000001', limit: 50 }), { mobile: '201000000001', afterId: null, limit: 50 });
  for (const value of [null, { limit: null }, { limit: 51 }, { limit: 0 }, { limit: 1.5 }, { afterId: '' }, { afterId: false }, { extra: 1 }]) {
    const h = harness(); await assert.rejects(h.repo.listPage(value as any), code('invalid')); assert.deepEqual(h.calls, []);
  }
  for (const value of [{ mobile: '010' }, { mobile: '' }, { mobile: 'abc123' }, { mobile: '01000000001', extra: 1 }]) {
    const h = harness(); await assert.rejects(h.repo.findByPhone(value), code('invalid')); assert.deepEqual(h.calls, []);
  }
});
test('invalid page rows, ordering, repeated file numbers and wrong phone search results never reach consumers', async () => {
  const h = harness(); await h.repo.commit(command()); const data = structuredClone(h.documents.get(recordPath()));
  const first = { id: ID, data }, second = { id: OTHER, data: { ...data, recordId: OTHER } };
  const sparse = new Array(1);
  for (const value of [sparse, [first, first], [second, first], [first, second], [{ id: OTHER, data }], [{ ...first, extra: 1 }]]) {
    h.adapter.listRecordsPage = async () => value; await assert.rejects(h.repo.listPage(), code('invalid'));
  }
  h.adapter.findRecordsByPhone = async () => [first]; await assert.rejects(h.repo.findByPhone({ mobile: '01000000002' }), code('invalid'));
});
test('identity loss during reads/hash/transaction and after server acknowledgment rejects publication', async () => {
  const h = harness(); await h.repo.commit(command());
  const read = h.adapter.readRecord!; h.adapter.readRecord = async path => { const result = await read(path); h.actor('other'); return result; };
  await assert.rejects(h.repo.get(ID), code('unavailable'));
  const fresh = harness(), run = fresh.adapter.runTransaction;
  fresh.adapter.runTransaction = async work => { const result = await run(work); fresh.actor('other'); return result; };
  await assert.rejects(fresh.repo.commit(command()), code('unavailable')); assert.equal(fresh.documents.size, 4, 'rejecting UI result is not undoing server acceptance');
});
test('missing read/query methods, provider errors and hostile failures use fixed errors with no local fallback', async () => {
  const h = harness(); delete h.adapter.readRecord; delete h.adapter.listRecordsPage; delete h.adapter.findRecordsByPhone;
  await assert.rejects(h.repo.get(ID), code('unavailable')); await assert.rejects(h.repo.getByFileNo(1), code('unavailable'));
  await assert.rejects(h.repo.listPage(), code('unavailable')); await assert.rejects(h.repo.findByPhone({ mobile: '01000000001' }), code('unavailable'));
  h.adapter.authorizeOwner = async () => { throw new Proxy({}, { getPrototypeOf() { throw new Error('PRIVATE_TOKEN'); } }); };
  await assert.rejects(h.repo.commit(command()), error => code('unavailable')(error) && !String(error).includes('PRIVATE'));
});

test('UUID and derived hash fences reject final newlines rather than relying on the JavaScript dollar anchor', async () => {
  for (const ending of ['\n', '\r', '\r\n', '\u2028', '\u2029']) {
    const h = harness();
    await assert.rejects(h.repo.commit(command({ recordId: ID + ending })), code('invalid'));
    await assert.rejects(h.repo.commit(command({ operationId: OP + ending })), code('invalid'));
    await assert.rejects(h.repo.get(ID + ending), code('invalid'));
    await assert.rejects(h.repo.listPage({ afterId: ID + ending }), code('invalid'));
    assert.deepEqual(h.calls, []);
  }
  const h = harness(); await h.repo.commit(command()); const saved = h.documents.get(recordPath());
  assert.throws(() => parseCloudPatientRecord({ ...saved, phoneKey: saved.phoneKey + '\n' }), code('invalid'));
  const invalidDigest = createCloudPatientRepository(h.adapter, { digest: async () => 'a'.repeat(64) + '\n' });
  await assert.rejects(invalidDigest.commit(command({ operationId: OP2, recordId: OTHER })), code('invalid'));
});

test('counter cannot reuse its last operation without the corresponding immutable receipt', async () => {
  const h = harness(); h.documents.set(counterPath, { schemaVersion: 1, clinicId: 'main', lastFileNo: 450, lastOperationId: OP });
  const before = structuredClone(h.documents);
  await assert.rejects(h.repo.commit(command()), code('conflict')); assert.deepEqual(h.documents, before);
});
