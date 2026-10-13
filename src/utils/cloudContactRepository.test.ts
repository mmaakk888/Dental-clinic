import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createCloudContactRepository, parseCloudContactRecord, prepareCloudContactCommand, CloudContactError,
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

test('optional campaign consent binds the exact canonical phone and is absent from historical payloads', () => {
  const old = input(); assert.deepEqual(prepareCloudContactCommand(old), old);
  const consent = { status: 'allowed' as const, phone: '201000000001', recordedAt: '2026-10-13T00:00:00.000Z' };
  const prepared = prepareCloudContactCommand({ ...old, contact: { ...old.contact, campaignConsent: consent } });
  assert.deepEqual(prepared.contact?.campaignConsent, consent); assert.notEqual(prepared.contact?.campaignConsent, consent);
  for (const bad of [{ ...consent, phone: '201000000002' }, { ...consent, phone: '01000000001' },
    { ...consent, status: 'yes' }, { ...consent, recordedAt: '2026-02-30T00:00:00.000Z' },
    { ...consent, extra: true }, null, { ...consent, get phone() { return assert.fail('getter must not execute'); } }]) {
    assert.throws(() => prepareCloudContactCommand({ ...old, contact: { ...old.contact, campaignConsent: bad } }), hasCode('invalid'));
  }
});

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

test('contact UUID/cursor/hash fences reject final line terminators rather than relying on dollar anchors', async () => {
  for (const ending of ['\n', '\r', '\r\n', '\u2028', '\u2029']) {
    const h = harness();
    await assert.rejects(h.repo.get(ID + ending), hasCode('invalid'));
    await assert.rejects(h.repo.listPage({ afterId: ID + ending }), hasCode('invalid'));
    await assert.rejects(h.repo.commit(input({ operationId: OP + ending })), hasCode('invalid'));
    assert.deepEqual(h.calls, []);
  }
  const h = harness(); await h.repo.commit(input());
  const saved = h.rows.get(rPath()) as any;
  assert.throws(() => parseCloudContactRecord({ ...saved, phoneKey: saved.phoneKey + '\n' }), hasCode('invalid'));
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

function readHarness() {
  const h = harness();
  h.adapter.readRecord = async path => { h.calls.push(`read:${path}`); return h.rows.get(path) ?? null; };
  h.adapter.listRecordsPage = async (afterId, count) => {
    h.calls.push(`list:${afterId}:${count}`);
    return [...h.rows.entries()].filter(([path]) => path.startsWith('clinics/main/contactRecords/') && (!afterId || path.slice(path.lastIndexOf('/') + 1) > afterId))
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).slice(0, count)
      .map(([path, data]) => ({ id: path.slice(path.lastIndexOf('/') + 1), data }));
  };
  return h;
}

test('explicit contact reads are inert on creation and missing server-read adapters fail closed', async () => {
  const h = harness(); assert.deepEqual(h.calls, []);
  await assert.rejects(h.repo.get(ID), hasCode('unavailable'));
  await assert.rejects(h.repo.listPage(), hasCode('unavailable'));
  assert.deepEqual(h.calls, []);
});

test('get reads only its exact record, clones values, and returns null or a versioned tombstone honestly', async () => {
  const h = readHarness();
  assert.equal(await h.repo.get(ID), null);
  await h.repo.commit(input());
  const result = await h.repo.get(ID); result!.data!.name = 'تعديل نسخة القراءة'; result!.revision = 77;
  const saved = parseCloudContactRecord(h.rows.get(rPath()));
  assert.equal(saved.data!.name, input().contact!.name); assert.equal(saved.revision, 1);
  await h.repo.commit(input({ operationId: OP2, expectedRevision: 1, action: 'delete', contact: null }));
  const deleted = await h.repo.get(ID);
  assert.equal(deleted!.deleted, true); assert.equal(deleted!.revision, 2); assert.equal(deleted!.data, null);
  assert.ok(h.calls.includes(`read:${rPath()}`));
});

test('bounded contact pages default to 25 and advance only by an exact full-page final UUID', async () => {
  const h = readHarness(); await h.repo.commit(input());
  const second = input({ recordId: OTHER, operationId: OP2 }); second.contact = { ...second.contact!, id: OTHER, mobile: '01000000002' };
  await h.repo.commit(second);
  await h.repo.commit(input({ operationId: OP3, expectedRevision: 1, action: 'delete', contact: null }));
  const all = await h.repo.listPage();
  assert.deepEqual(all.records.map(row => row.recordId), [ID, OTHER]); assert.equal(all.records[0].deleted, true);
  assert.equal(all.nextAfterId, null); assert.ok(h.calls.includes('list:null:25'));
  const first = await h.repo.listPage({ limit: 1 }); assert.equal(first.nextAfterId, ID);
  const next = await h.repo.listPage({ afterId: first.nextAfterId, limit: 1 });
  assert.equal(next.records[0].recordId, OTHER); assert.equal(next.nextAfterId, OTHER);
  assert.deepEqual(await h.repo.listPage({ afterId: next.nextAfterId, limit: 1 }), { records: [], nextAfterId: null });
  assert.equal((await h.repo.listPage({ afterId: null, limit: 50 })).records.length, 2);
  all.records[1].data!.name = 'تعديل نسخة الصفحة';
  assert.equal(parseCloudContactRecord(h.rows.get(rPath(OTHER))).data!.name, second.contact!.name);
});

test('invalid record IDs, cursor inputs and page limits fail before authorization or SDK reads', async () => {
  for (const value of ['', '../patients/private', 'A0000000-0000-4000-8000-000000000001', 7, null, {}]) {
    const h = readHarness(); await assert.rejects(h.repo.get(value as any), hasCode('invalid')); assert.deepEqual(h.calls, []);
  }
  for (const value of [null, [], { afterId: '../private' }, { afterId: 1 }, { limit: 0 }, { limit: 51 }, { limit: 1.5 },
    { limit: NaN }, { limit: Infinity }, { limit: '25' }, { extra: true }]) {
    const h = readHarness(); await assert.rejects(h.repo.listPage(value as any), hasCode('invalid')); assert.deepEqual(h.calls, []);
  }
  let getterReads = 0;
  const h = readHarness(), value = Object.defineProperty({}, 'afterId', { enumerable: true, get: () => { getterReads++; return ID; } });
  await assert.rejects(h.repo.listPage(value), hasCode('invalid')); assert.equal(getterReads, 0); assert.deepEqual(h.calls, []);
});

test('pages reject sparse, oversized, accessor and extended arrays instead of silently dropping rows', async () => {
  const values: unknown[] = [new Array(1), new Array(2).fill(null), { length: 0 }, Object.assign([], { extra: true })];
  const accessor = new Array(1); let reads = 0;
  Object.defineProperty(accessor, '0', { enumerable: true, get: () => { reads++; return null; } }); values.push(accessor);
  const symbolArray: unknown[] = []; Object.defineProperty(symbolArray, Symbol('private'), { value: true }); values.push(symbolArray);
  for (const value of values) {
    const h = readHarness(); h.adapter.listRecordsPage = async () => value;
    await assert.rejects(h.repo.listPage({ limit: 1 }), hasCode('invalid'));
  }
  assert.equal(reads, 0);
});

test('pages reject malformed envelopes, wrong document IDs, duplicate or unordered UUIDs and rows before cursor', async () => {
  const h = readHarness(); await h.repo.commit(input());
  const saved = h.rows.get(rPath());
  for (const rows of [[{ id: OTHER, data: saved }], [{ id: ID, data: saved }, { id: ID, data: saved }],
    [{ id: OTHER, data: { ...(saved as object), recordId: OTHER, data: { ...input().contact!, id: OTHER } } }, { id: ID, data: saved }],
    [{ id: ID, data: { ...(saved as object), extra: 'PRIVATE' } }], [{ id: ID, data: saved, extra: 'PRIVATE' }], [{ id: '../private', data: saved }]]) {
    h.adapter.listRecordsPage = async () => rows;
    await assert.rejects(h.repo.listPage({ limit: 2 }), hasCode('invalid'));
  }
  h.adapter.listRecordsPage = async () => [{ id: ID, data: saved }];
  await assert.rejects(h.repo.listPage({ afterId: ID }), hasCode('invalid'));
  h.adapter.readRecord = async () => ({ ...(saved as object), recordId: OTHER, data: { ...input().contact!, id: OTHER } });
  await assert.rejects(h.repo.get(ID), hasCode('invalid'));
});

test('every active get and page record verifies the canonical phone SHA-256 before publishing', async () => {
  const h = readHarness(); await h.repo.commit(input());
  (h.rows.get(rPath()) as any).phoneKey = 'f'.repeat(64);
  await assert.rejects(h.repo.get(ID), hasCode('invalid')); await assert.rejects(h.repo.listPage(), hasCode('invalid'));
  const repo = createCloudContactRepository(h.adapter, { digest: async () => { throw new Error('PRIVATE_HASH_DETAIL'); } });
  await assert.rejects(repo.get(ID), error => hasCode('unavailable')(error) && !String(error).includes('PRIVATE'));
  await assert.rejects(repo.listPage(), error => hasCode('unavailable')(error) && !String(error).includes('PRIVATE'));
});

test('read authorization is checked before server access and after reading and asynchronous phone validation', async () => {
  for (const method of ['get', 'listPage'] as const) {
    for (const boundary of [1, 2]) {
      const h = readHarness(); await h.repo.commit(input()); h.calls.length = 0;
      let checks = 0; h.adapter.authorizeOwner = async () => ++checks === boundary ? 'different-synthetic-owner' : OWNER;
      if (boundary === 1) h.adapter.authorizeOwner = async () => { throw new Error('PRIVATE_AUTH_DETAIL'); };
      await assert.rejects(method === 'get' ? h.repo.get(ID) : h.repo.listPage(), hasCode('unavailable'));
      assert.equal(h.calls.some(call => call.startsWith('read:') || call.startsWith('list:')), boundary !== 1);
    }
    const h = readHarness(); await h.repo.commit(input());
    let active = true;
    h.adapter.authorizeOwner = async () => { if (!active) throw new Error('PRIVATE_REVOKED'); return OWNER; };
    const repo = createCloudContactRepository(h.adapter, { digest: async text => { const result = await digest(text); active = false; return result; } });
    await assert.rejects(method === 'get' ? repo.get(ID) : repo.listPage(), hasCode('unavailable'));
  }
});

test('read transport failures and invalid owner identities never fabricate an empty successful page', async () => {
  for (const method of ['get', 'listPage'] as const) {
    const h = readHarness();
    h.adapter.readRecord = h.adapter.listRecordsPage = async () => { throw new Error('PRIVATE_READ_DETAIL'); };
    await assert.rejects(method === 'get' ? h.repo.get(ID) : h.repo.listPage(), error => hasCode('unavailable')(error) && !String(error).includes('PRIVATE'));
    h.adapter.authorizeOwner = async () => '';
    await assert.rejects(method === 'get' ? h.repo.get(ID) : h.repo.listPage(), hasCode('invalid'));
  }
});

test('hostile and altered adapter exceptions cannot leak through fixed contact errors', async () => {
  const altered = new CloudContactError('conflict'); altered.message = 'PRIVATE_ERROR_PAYLOAD';
  const hostile = new Proxy({}, { getPrototypeOf: () => { throw new Error('PRIVATE_PROXY_PAYLOAD'); } });
  for (const value of [altered, hostile]) {
    const h = readHarness(); h.adapter.authorizeOwner = async () => { throw value; };
    for (const action of [() => h.repo.get(ID), () => h.repo.listPage(), () => h.repo.commit(input())]) {
      await assert.rejects(action(), error => error instanceof CloudContactError && !String(error).includes('PRIVATE'));
    }
  }
});
