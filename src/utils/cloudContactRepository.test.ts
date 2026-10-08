import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createCloudContactRepository, parseCloudContactRecord, CloudContactError,
  type CloudContactAdapter, type CloudContactCommand, type CloudContactTransaction } from './cloudContactRepository';

const ID = '10000000-0000-4000-8000-000000000001';
const OTHER = '10000000-0000-4000-8000-000000000002';
const OP = '20000000-0000-4000-8000-000000000001';
const OP2 = '20000000-0000-4000-8000-000000000002';
const OP3 = '20000000-0000-4000-8000-000000000003';
const OWNER = 'synthetic-owner';
const digest = async (value: string) => createHash('sha256').update(value).digest('hex');
const rPath = (id = ID) => `clinics/main/contactRecords/${id}`;
const pPath = (phone: string) => `clinics/main/contactPhones/${createHash('sha256').update(`contact-phone-v1:${phone}`).digest('hex')}`;
const oPath = (id = OP) => `clinics/main/contactOperations/${id}`;
const input = (changes: Partial<CloudContactCommand> = {}): CloudContactCommand => ({ operationId: OP, recordId: ID, expectedRevision: 0, action: 'create',
  contact: { id: ID, name: 'جهة اختبار وهمية', mobile: '01000000001', notes: 'ملاحظة وهمية', createdAt: '2026-10-08T10:00:00.000Z' }, ...changes });
const hasCode = (code: CloudContactError['code']) => (error: unknown) => error instanceof CloudContactError && error.code === code;

// In-memory *synthetic* atomic adapter: failed callbacks never publish staged
// writes. Serialization is only a deterministic test aid, not a Firestore test.
function harness(options: { retryOnce?: boolean; lostReplyOnce?: boolean; failWrite?: boolean } = {}) {
  const rows = new Map<string, object>();
  const calls: string[] = [];
  let actor = OWNER, tail = Promise.resolve(), authChecks = 0, failAuthAt = 0;
  const adapter: CloudContactAdapter = {
    authorizeOwner: async () => { calls.push('authorize'); if (++authChecks === failAuthAt) throw new Error('PRIVATE_AUTH_DETAIL'); return actor; },
    runTransaction: async work => {
      const prior = tail;
      let release!: () => void;
      tail = new Promise<void>(resolve => { release = resolve; });
      await prior;
      const attempt = async (publish: boolean) => {
        const staged = new Map(rows); let wrote = false;
        const transaction: CloudContactTransaction = {
          get: async path => { assert.equal(wrote, false, 'every read must precede every write'); calls.push(`get:${path}`); return structuredClone(staged.get(path) ?? null); },
          set: (path, value) => { wrote = true; calls.push(`set:${path}`); if (options.failWrite) throw new Error('PRIVATE_WRITE_DETAIL'); staged.set(path, structuredClone(value)); },
          delete: path => { wrote = true; calls.push(`delete:${path}`); staged.delete(path); },
        };
        const result = await work(transaction);
        if (publish) { rows.clear(); for (const [key, value] of staged) rows.set(key, value); }
        return result;
      };
      try {
        if (options.retryOnce) { options.retryOnce = false; await attempt(false); }
        const result = await attempt(true);
        if (options.lostReplyOnce) { options.lostReplyOnce = false; throw new Error('PRIVATE_LOST_REPLY'); }
        return result;
      } finally { release(); }
    },
  };
  return { rows, calls, adapter, repo: createCloudContactRepository(adapter, { digest }),
    setActor: (value: string) => { actor = value; }, failAuthorizationAt: (value: number) => { failAuthAt = value; },
    get authChecks() { return authChecks; } };
}

test('contact transaction core is inert until explicit commit and has no local/default fallback', () => {
  const h = harness(); assert.deepEqual(h.calls, []); assert.equal(h.rows.size, 0);
});

test('create commits record, unique canonical phone and data-free receipt together', async () => {
  const h = harness(), command = input();
  assert.deepEqual(await h.repo.commit(command), { status: 'committed', recordId: ID, revision: 1 });
  const saved = parseCloudContactRecord(h.rows.get(rPath()));
  assert.deepEqual(saved.data, command.contact); assert.equal(saved.deleted, false); assert.equal(saved.lastOperationId, OP);
  assert.equal(h.rows.size, 3); assert.equal((h.rows.get(pPath('201000000001')) as any).recordId, ID);
  const receipt = JSON.stringify(h.rows.get(oPath()));
  assert.doesNotMatch(receipt, /جهة اختبار|01000000001|ملاحظة وهمية/);
  assert.equal(h.calls.filter(call => call === 'authorize').length, 4);
});

test('retrying the same operation does not create another contact or reserve the phone twice', async () => {
  const h = harness(); await h.repo.commit(input()); const before = structuredClone(h.rows);
  assert.deepEqual(await h.repo.commit(input()), { status: 'already-committed', recordId: ID, revision: 1 });
  assert.deepEqual(h.rows, before);
});

test('transaction callback retries retain IDs, payload and fingerprint without side effects', async () => {
  const h = harness({ retryOnce: true });
  assert.equal((await h.repo.commit(input())).status, 'committed');
  assert.equal(h.rows.size, 3); assert.equal(h.calls.filter(call => call === `set:${rPath()}`).length, 2);
  assert.equal((h.rows.get(oPath()) as any).resultRevision, 1);
});

test('a server commit with a lost reply is resolved by retrying the same operation ID', async () => {
  const h = harness({ lostReplyOnce: true });
  await assert.rejects(h.repo.commit(input()), hasCode('unavailable')); assert.equal(h.rows.size, 3);
  assert.equal((await h.repo.commit(input())).status, 'already-committed'); assert.equal(h.rows.size, 3);
});

test('reusing an operation ID for changed content is a conflict, not a false success', async () => {
  const h = harness(); await h.repo.commit(input()); const before = structuredClone(h.rows);
  const changed = input(); changed.contact!.name = 'اسم اختبار مختلف';
  await assert.rejects(h.repo.commit(changed), hasCode('conflict')); assert.deepEqual(h.rows, before);
});

test('equivalent phone formats cannot be inserted by two different contact operations', async () => {
  const h = harness(); const other = input({ recordId: OTHER, operationId: OP2 });
  other.contact = { ...other.contact!, id: OTHER, mobile: '+201000000001' };
  const results = await Promise.allSettled([h.repo.commit(input()), h.repo.commit(other)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected' && hasCode('duplicate')(result.reason)).length, 1);
  assert.equal(h.rows.size, 3);
});

test('update compares revision and moves the phone reservation atomically', async () => {
  const h = harness(); await h.repo.commit(input()); const update = input({ operationId: OP2, action: 'update', expectedRevision: 1 });
  update.contact = { ...update.contact!, mobile: '01000000002', name: 'تعديل وهمي' };
  assert.equal((await h.repo.commit(update)).revision, 2);
  assert.equal(h.rows.has(pPath('201000000001')), false); assert.equal(h.rows.has(pPath('201000000002')), true);
  assert.equal(parseCloudContactRecord(h.rows.get(rPath())).data!.mobile, '01000000002');
  await assert.rejects(h.repo.commit({ ...update, operationId: OP3 }), hasCode('conflict'));
});

test('update cannot change original creation identity/date or steal another reserved phone', async () => {
  const h = harness(); await h.repo.commit(input()); const other = input({ operationId: OP2, recordId: OTHER });
  other.contact = { ...other.contact!, id: OTHER, mobile: '01000000002' }; await h.repo.commit(other);
  const before = structuredClone(h.rows), update = input({ operationId: OP3, action: 'update', expectedRevision: 1 });
  update.contact = { ...update.contact!, mobile: '01000000002' };
  await assert.rejects(h.repo.commit(update), hasCode('duplicate'));
  update.contact = { ...input().contact!, createdAt: '2026-10-09T10:00:00.000Z' };
  await assert.rejects(h.repo.commit(update), hasCode('conflict')); assert.deepEqual(h.rows, before);
});

test('delete keeps a versioned tombstone to prevent ABA recreation and frees the phone', async () => {
  const h = harness(); await h.repo.commit(input());
  const remove = input({ operationId: OP2, expectedRevision: 1, action: 'delete', contact: null });
  await h.repo.commit(remove);
  assert.equal(h.rows.has(pPath('201000000001')), false);
  assert.deepEqual(parseCloudContactRecord(h.rows.get(rPath())).data, null);
  assert.equal(parseCloudContactRecord(h.rows.get(rPath())).revision, 2);
  assert.equal((await h.repo.commit(remove)).status, 'already-committed');
  await assert.rejects(h.repo.commit(input({ operationId: OP3 })), hasCode('conflict'));
  await assert.rejects(h.repo.commit(input({ operationId: OP3, expectedRevision: 2, action: 'update' })), hasCode('conflict'));
});

test('an old receipt confirms only a historical operation, never rewrites a newer record', async () => {
  const h = harness(); await h.repo.commit(input());
  const update = input({ operationId: OP2, expectedRevision: 1, action: 'update' }); update.contact!.name = 'الأحدث الوهمي';
  await h.repo.commit(update); const before = structuredClone(h.rows);
  assert.equal((await h.repo.commit(input())).revision, 1); assert.deepEqual(h.rows, before);
  assert.equal(parseCloudContactRecord(h.rows.get(rPath())).revision, 2);
});

test('malformed commands/extra fields/credentials/path IDs fail before transaction or authentication', async () => {
  for (const change of [{ recordId: '../patients/private' }, { operationId: 'not-uuid' }, { action: 'upsert' },
    { expectedRevision: 0.5 }, { expectedRevision: Number.MAX_SAFE_INTEGER }, { contact: null }, { users: [] },
    { contact: { ...input().contact, apiKey: 'PRIVATE_PROVIDER' } }, { contact: { ...input().contact, id: OTHER } },
    { contact: { ...input().contact, mobile: 'invalid' } }, { contact: { ...input().contact, createdAt: '2026-02-31T00:00:00Z' } }]) {
    const h = harness(); await assert.rejects(h.repo.commit({ ...input(), ...change } as any), hasCode('invalid'));
    assert.deepEqual(h.calls, []); assert.equal(h.rows.size, 0);
  }
});

test('record parsing rejects malformed/unknown envelopes and never runs input getters', () => {
  const valid = { schemaVersion: 1, clinicId: 'main', recordId: ID, revision: 1, deleted: false, lastOperationId: OP,
    phoneKey: createHash('sha256').update('contact-phone-v1:201000000001').digest('hex'), data: input().contact };
  assert.deepEqual(parseCloudContactRecord(valid).data, input().contact);
  for (const value of [null, [], { ...valid, clinicId: 'other' }, { ...valid, revision: 0 }, { ...valid, deleted: true },
    { ...valid, phoneKey: null }, { ...valid, phoneKey: 'invalid' }, { ...valid, data: { ...input().contact, id: OTHER } }, { ...valid, accessToken: 'PRIVATE' }]) {
    assert.throws(() => parseCloudContactRecord(value), hasCode('invalid'));
  }
  let reads = 0; const getter = { ...valid }; Object.defineProperty(getter, 'data', { enumerable: true, get: () => { reads++; throw new Error('PRIVATE'); } });
  assert.throws(() => parseCloudContactRecord(getter), hasCode('invalid')); assert.equal(reads, 0);
});

test('a stored derived phone key inconsistent with the actual phone fails closed', async () => {
  const h = harness(); await h.repo.commit(input());
  (h.rows.get(rPath()) as any).phoneKey = 'f'.repeat(64); const before = structuredClone(h.rows);
  await assert.rejects(h.repo.commit(input({ operationId: OP2, action: 'update', expectedRevision: 1 })), hasCode('invalid'));
  assert.deepEqual(h.rows, before);
});

test('authorization loss before reads or writes fails closed without committed changes', async () => {
  for (const check of [1, 2, 3]) {
    const h = harness(); h.failAuthorizationAt(check);
    await assert.rejects(h.repo.commit(input()), hasCode('unavailable')); assert.equal(h.rows.size, 0);
  }
});

test('authorization loss after server acknowledgement returns uncertain status, not success to the old session', async () => {
  const h = harness(); h.failAuthorizationAt(4);
  await assert.rejects(h.repo.commit(input()), hasCode('unavailable')); assert.equal(h.rows.size, 3);
  assert.equal((await h.repo.commit(input())).status, 'already-committed');
});

test('write/transport failures expose fixed messages, no fabricated local save or partial rows', async () => {
  const h = harness({ failWrite: true });
  await assert.rejects(h.repo.commit(input()), error => hasCode('unavailable')(error) && !String(error).includes('PRIVATE'));
  assert.equal(h.rows.size, 0);
});

test('corrupt phone/operation indexes fail closed instead of overwriting evidence', async () => {
  for (const [path, value] of [[pPath('201000000001'), { recordId: OTHER }], [oPath(), { arbitrary: 'PRIVATE' }]] as [string, object][]) {
    const h = harness(); h.rows.set(path, value); const before = structuredClone(h.rows);
    await assert.rejects(h.repo.commit(input()), hasCode('invalid')); assert.deepEqual(h.rows, before);
  }
});

test('command values are snapshotted before asynchronous authorization and hashing', async () => {
  const h = harness(), original = input(); const before = structuredClone(original.contact);
  const pending = h.repo.commit(original); original.contact!.name = 'تغيير متزامن وهمي';
  await pending; assert.deepEqual(parseCloudContactRecord(h.rows.get(rPath())).data, before);
});

test('production SHA-256 default produces the same stable request and phone fingerprints', async () => {
  const h = harness(); const realDigestRepo = createCloudContactRepository(h.adapter);
  await realDigestRepo.commit(input()); assert.equal(h.rows.has(pPath('201000000001')), true);
  assert.match((h.rows.get(oPath()) as any).requestHash, /^[a-f0-9]{64}$/);
});

test('switching owner identity at async boundaries never confirms the old caller session', async () => {
  for (const boundary of [2, 3, 4]) {
    const h = harness(); let checks = 0;
    h.adapter.authorizeOwner = async () => ++checks >= boundary ? 'different-synthetic-owner' : OWNER;
    await assert.rejects(h.repo.commit(input()), hasCode('unavailable'));
    assert.equal(h.rows.size, boundary === 4 ? 3 : 0);
  }
});

test('another owner cannot reuse an earlier caller operation receipt as its own', async () => {
  const h = harness(); await h.repo.commit(input()); const before = structuredClone(h.rows);
  h.setActor('different-synthetic-owner');
  await assert.rejects(h.repo.commit(input()), hasCode('conflict')); assert.deepEqual(h.rows, before);
});

test('failed or malformed fingerprints never enter a transaction or expose input text', async () => {
  for (const hash of [async () => 'invalid', async () => { throw new Error('PRIVATE_HASH_DETAIL'); }]) {
    const h = harness(), repo = createCloudContactRepository(h.adapter, { digest: hash });
    await assert.rejects(repo.commit(input()), error => error instanceof CloudContactError && !String(error).includes('PRIVATE'));
    assert.equal(h.rows.size, 0); assert.equal(h.calls.some(call => call.startsWith('get:') || call.startsWith('set:')), false);
  }
});
