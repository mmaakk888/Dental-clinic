import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createCloudOperationIntentRepository, type CloudIntentAdapter } from './cloudOperationIntent';
import { CloudServiceCatalogError, createCloudServiceCatalogRepository, parseCloudServiceCatalogData,
  parseCloudServiceCatalogRecord, prepareCloudServiceCatalogCommand, MAX_CLOUD_SERVICE_CATALOG_BYTES,
  type CloudServiceCatalogAdapter, type CloudServiceCatalogCommand, type CloudServiceCatalogData } from './cloudServiceCatalogRepository';

// Fabricated atomic server only: no Firebase SDK, Rules, browser data, IAM,
// clinical charges or owner credentials are used by these contract tests.
const OWNER = 'synthetic-catalog-owner', WHEN = '2026-10-11T00:00:00.000Z';
const id = (value: number) => `20000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const serviceId = (value: number) => `30000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const CATALOG = 'clinics/main/settings/serviceCatalog';
const operation = (value: number) => `clinics/main/catalogOperations/${id(value)}`;
const intent = (value: number) => `clinics/main/operationIntents/${id(value)}`;
const digest = async (value: string) => createHash('sha256').update(value).digest('hex');
const data = (): CloudServiceCatalogData => ({ examinationCents: 10_000, services: [
  { serviceId: serviceId(1), name: 'حشو عادي', kind: 'clinical', priceCents: 30_000, active: true },
  { serviceId: serviceId(2), name: 'زيركون', kind: 'prosthetic', priceCents: null, active: false },
] });
const command = (number = 1, revision = 0, changes: Record<string, unknown> = {}): CloudServiceCatalogCommand => ({
  operationId: id(number), expectedRevision: revision, createdAt: WHEN, data: data(), ...changes,
} as CloudServiceCatalogCommand);
const code = (expected: CloudServiceCatalogError['code']) => (error: unknown) => error instanceof CloudServiceCatalogError && error.code === expected;
function deferred() { let resolve!: () => void; const promise = new Promise<void>(accept => { resolve = accept; }); return { resolve, promise }; }
function harness() {
  const docs = new Map<string, any>(), calls: string[] = [];
  let uid = OWNER, tail = Promise.resolve(), writes = 0, authCount = 0;
  const faults = { lostCommitReply: false, retry: false, failWriteAt: 0 };
  const hooks: { auth?: (count: number) => Promise<void> | void; read?: (path: string) => void; afterCommit?: () => void } = {};
  const adapter: CloudServiceCatalogAdapter & CloudIntentAdapter = {
    authorizeOwner: async () => { calls.push('auth'); await hooks.auth?.(++authCount); return uid; },
    readRecord: async path => { calls.push(`read:${path}`); hooks.read?.(path); return structuredClone(docs.get(path) ?? null); },
    listHistoryPage: async (kind, actorUid, after, limit) => [...docs]
      .filter(([path, value]) => path.startsWith('clinics/main/operationIntents/') && value.kind === kind
        && value.actorUid === actorUid && (!after || value.operationId > after))
      .sort(([a], [b]) => a < b ? -1 : 1).slice(0, limit)
      .map(([path, value]) => ({ id: path.split('/').at(-1), data: structuredClone(value) })),
    runTransaction: async work => {
      const previous = tail; let release!: () => void;
      tail = new Promise<void>(accept => { release = accept; }); await previous;
      const attempt = async (publish: boolean) => {
        const staged = structuredClone(docs); let wrote = false, isCommit = false;
        const result = await work({
          get: async path => { assert.equal(wrote, false, 'all reads precede every write'); calls.push(`get:${path}`);
            hooks.read?.(path); return structuredClone(staged.get(path) ?? null); },
          set: (path, value) => { wrote = true; calls.push(`set:${path}`); if (++writes === faults.failWriteAt) throw new Error('PRIVATE_WRITE_DETAILS');
            isCommit ||= path === CATALOG; staged.set(path, structuredClone(value)); },
        });
        if (publish) { docs.clear(); for (const [path, value] of staged) docs.set(path, value); }
        if (publish && isCommit) {
          hooks.afterCommit?.();
          if (faults.lostCommitReply) { faults.lostCommitReply = false; throw new Error('PRIVATE_LOST_ACK_DETAILS'); }
        }
        return result;
      };
      try {
        if (faults.retry) { faults.retry = false; await attempt(false); }
        return await attempt(true);
      } finally { release(); }
    },
  };
  const repo = createCloudServiceCatalogRepository(adapter, { digest });
  const journal = createCloudOperationIntentRepository(adapter, { digest });
  return { docs, calls, faults, hooks, adapter, repo, journal, owner: (value: string) => { uid = value; }, writes: () => writes,
    prepare: (value: CloudServiceCatalogCommand) => journal.prepare('catalog', prepareCloudServiceCatalogCommand(value), value.createdAt),
    client: () => createCloudServiceCatalogRepository(adapter, { digest }) };
}

test('catalog construction is inert, missing document stays unknown and no fee/list is auto seeded', async () => {
  const h = harness(); assert.deepEqual(h.calls, []); assert.equal(await h.repo.get(), null);
  assert.equal(h.docs.size, 0); assert.equal(h.writes(), 0);
  assert.deepEqual(h.calls.filter(call => call.startsWith('read:')), [`read:${CATALOG}`]);
});
test('catalog get fails closed without a read capability and never substitutes a default price', async () => {
  const h = harness(); delete h.adapter.readRecord; await assert.rejects(h.repo.get(), code('unavailable'));
  assert.equal(h.docs.size, 0); assert.equal(h.calls.some(call => call.startsWith('get:')), false);
});
test('first explicit owner save atomically writes catalog, immutable operation and committed intent', async () => {
  const h = harness(), input = command(); await h.prepare(input); const before = h.writes();
  assert.deepEqual(await h.repo.commit(input), { status: 'committed', recordId: 'serviceCatalog', revision: 1 });
  assert.equal(h.writes() - before, 3); assert.equal(h.docs.size, 3);
  assert.deepEqual(await h.repo.get(), { schemaVersion: 1, clinicId: 'main', recordId: 'serviceCatalog', revision: 1,
    lastOperationId: id(1), data: data() });
  assert.equal(h.docs.get(intent(1)).status, 'committed'); assert.equal(h.docs.get(intent(1)).revision, 2);
  assert.equal(h.docs.get(operation(1)).resultRevision, 1); assert.equal(h.docs.get(operation(1)).actorUid, OWNER);
  assert.doesNotMatch(JSON.stringify(h.docs.get(operation(1))), /حشو|زيركون|priceCents|services/);
  assert.equal([...h.docs.keys()].some(path => /patient|lab|supplier/i.test(path)), false);
});
test('empty list and explicit free examination are valid owner configuration, not automatic seeding', async () => {
  const h = harness(), input = command(1, 0, { data: { examinationCents: 0, services: [] } });
  await h.prepare(input); await h.repo.commit(input);
  assert.deepEqual((await h.repo.get())?.data, { examinationCents: 0, services: [] });
});
test('full replacement retains declared unknown versus explicit zero and permits deactivation/removal', async () => {
  const h = harness(), first = command(); await h.prepare(first); await h.repo.commit(first);
  const next = command(2, 1, { data: { examinationCents: 25_000, services: [
    { serviceId: serviceId(1), name: 'خدمة مجانية', kind: 'clinical', priceCents: 0, active: false },
  ] } });
  await h.prepare(next); await h.repo.commit(next);
  assert.deepEqual((await h.repo.get())?.data, next.data); assert.equal((await h.repo.get())?.revision, 2);
  assert.equal(h.docs.get(operation(1)).resultRevision, 1);
});
test('same-ID replay acknowledges historical revision without overwriting or publishing newer prices', async () => {
  const h = harness(), first = command(); await h.prepare(first); await h.repo.commit(first);
  const next = command(2, 1, { data: { examinationCents: 20_000, services: [] } });
  await h.prepare(next); await h.repo.commit(next); const before = structuredClone(h.docs), writes = h.writes();
  assert.deepEqual(await h.client().commit(first), { status: 'already-committed', recordId: 'serviceCatalog', revision: 1 });
  assert.deepEqual(h.docs, before); assert.equal(h.writes(), writes);
  assert.deepEqual((await h.repo.get())?.data, next.data);
});
test('lost commit acknowledgement is discovered in all-status history and replayed with original ID', async () => {
  const h = harness(), input = command(); await h.prepare(input); h.faults.lostCommitReply = true;
  await assert.rejects(h.repo.commit(input), code('unavailable')); assert.equal((await h.repo.get())?.revision, 1);
  const before = structuredClone(h.docs), freshJournal = createCloudOperationIntentRepository(h.adapter, { digest });
  const records = (await freshJournal.listHistoryPage('catalog')).records;
  assert.equal(records.length, 1); assert.equal(records[0].status, 'committed');
  assert.equal((await h.client().commit(prepareCloudServiceCatalogCommand(records[0].command))).status, 'already-committed');
  assert.deepEqual(h.docs, before); assert.equal(h.docs.get(CATALOG).revision, 1);
});
test('commit requires a real prepared owner-bound durable intent; missing intent never writes settings', async () => {
  const h = harness(); await assert.rejects(h.repo.commit(command()), code('invalid'));
  assert.equal(h.docs.size, 0); assert.equal(h.writes(), 0);
});
test('cancelled durable intent cannot commit or be repurposed as a new price save', async () => {
  const h = harness(), input = command(); await h.prepare(input); await h.journal.cancel(input.operationId);
  const before = structuredClone(h.docs); await assert.rejects(h.repo.commit(input), code('conflict'));
  assert.deepEqual(h.docs, before); assert.equal(h.docs.has(CATALOG), false);
});
test('committed receipt and intent must coexist; inconsistent historical states never replay or rewrite', async () => {
  for (const corrupt of ['missingReceipt', 'missingIntent', 'preparedIntent', 'cancelledIntent'] as const) {
    const h = harness(), input = command(); await h.prepare(input); await h.repo.commit(input);
    if (corrupt === 'missingReceipt') h.docs.delete(operation(1));
    if (corrupt === 'missingIntent') h.docs.delete(intent(1));
    if (corrupt === 'preparedIntent') Object.assign(h.docs.get(intent(1)), { status: 'prepared', revision: 1 });
    if (corrupt === 'cancelledIntent') Object.assign(h.docs.get(intent(1)), { status: 'cancelled', revision: 2 });
    const before = structuredClone(h.docs); await assert.rejects(h.repo.commit(input)); assert.deepEqual(h.docs, before);
  }
});
test('intent kind, actor, request hash, createdAt and exact command must agree before a domain write', async () => {
  for (const modify of [
    (value: any) => { value.kind = 'clinical'; },
    (value: any) => { value.actorUid = 'another-synthetic-owner'; },
    (value: any) => { value.requestHash = '0'.repeat(64); },
    (value: any) => { value.createdAt = '2026-10-11T00:00:00.001Z'; },
    (value: any) => { value.command.data.examinationCents++; },
  ]) {
    const h = harness(), input = command(); await h.prepare(input); modify(h.docs.get(intent(1)));
    const before = structuredClone(h.docs); await assert.rejects(h.repo.commit(input)); assert.deepEqual(h.docs, before);
    assert.equal(h.docs.has(CATALOG), false);
  }
});
test('same operation cannot change owner, price, time, expected revision or full body', async () => {
  const h = harness(), first = command(); await h.prepare(first); await h.repo.commit(first);
  const before = structuredClone(h.docs);
  for (const input of [command(1, 1), command(1, 0, { createdAt: '2026-10-11T00:00:00.001Z' }),
    command(1, 0, { data: { examinationCents: 0, services: [] } })]) await assert.rejects(h.repo.commit(input), code('conflict'));
  h.owner('another-synthetic-owner'); await assert.rejects(h.repo.commit(first), code('conflict')); assert.deepEqual(h.docs, before);
});
test('concurrent clients with the same expected revision cannot silently overwrite each other', async () => {
  const h = harness(), a = command(), b = command(2, 0, { data: { examinationCents: 5000, services: [] } });
  await h.prepare(a); await h.prepare(b);
  const results = await Promise.allSettled([h.repo.commit(a), h.client().commit(b)]);
  assert.equal(results.filter(value => value.status === 'fulfilled').length, 1);
  const failed = results.find(value => value.status === 'rejected') as PromiseRejectedResult;
  assert.equal(code('conflict')(failed.reason), true); assert.equal((await h.repo.get())?.revision, 1);
  assert.equal([...h.docs.keys()].filter(path => path.startsWith('clinics/main/catalogOperations/')).length, 1);
});
test('stale expected revision is not rebased, and a missing singleton is never treated as an old revision', async () => {
  const h = harness(), a = command(); await h.prepare(a); await h.repo.commit(a);
  const stale = command(2, 0); await h.prepare(stale); const before = structuredClone(h.docs);
  await assert.rejects(h.repo.commit(stale), code('conflict')); assert.deepEqual(h.docs, before);
  const x = harness(), missing = command(3, 1); await x.prepare(missing);
  await assert.rejects(x.repo.commit(missing), code('conflict')); assert.equal(x.docs.has(CATALOG), false);
});
test('corrupt existing singleton cannot be reset or replaced even with the expected numeric revision', async () => {
  for (const raw of [undefined, { revision: 1 }, { schemaVersion: 1, clinicId: 'other', recordId: 'serviceCatalog',
    revision: 1, lastOperationId: id(3), data: data() }]) {
    const h = harness(); h.docs.set(CATALOG, raw); const input = command(1, 1); await h.prepare(input);
    const before = structuredClone(h.docs); await assert.rejects(h.repo.commit(input)); assert.deepEqual(h.docs, before);
  }
});
test('receipt collisions, unknown fields and changed historical fingerprints never overwrite an operation', async () => {
  for (const change of [
    (value: any) => { value.requestHash = '0'.repeat(64); }, (value: any) => { value.resultRevision++; },
    (value: any) => { value.actorUid = 'other'; }, (value: any) => { value.extra = true; },
    (value: any) => { delete value.createdAt; },
  ]) {
    const h = harness(), input = command(); await h.prepare(input); await h.repo.commit(input); change(h.docs.get(operation(1)));
    const before = structuredClone(h.docs); await assert.rejects(h.repo.commit(input)); assert.deepEqual(h.docs, before);
  }
});
test('transaction callback retries publish one revision and one immutable operation only', async () => {
  const h = harness(), input = command(); await h.prepare(input); h.faults.retry = true;
  await h.repo.commit(input); assert.equal(h.docs.size, 3); assert.equal((await h.repo.get())?.revision, 1);
});
test('failure at any of the three catalog transaction writes publishes no partial state', async () => {
  for (const position of [1, 2, 3]) {
    const h = harness(), input = command(); await h.prepare(input); const before = structuredClone(h.docs);
    h.faults.failWriteAt = h.writes() + position; await assert.rejects(h.repo.commit(input), code('unavailable'));
    assert.deepEqual(h.docs, before); assert.equal(h.docs.get(intent(1)).status, 'prepared');
    h.faults.failWriteAt = 0; await h.repo.commit(input); assert.equal(h.docs.size, 3);
  }
});
test('owner identity loss before writes denies the mutation; late loss hides acknowledgement but cannot undo acceptance', async () => {
  const h = harness(), input = command(); await h.prepare(input); const before = structuredClone(h.docs);
  h.hooks.read = path => { if (path === CATALOG) h.owner('changed-owner'); };
  await assert.rejects(h.repo.commit(input), code('unavailable')); assert.deepEqual(h.docs, before);
  const x = harness(); await x.prepare(input); x.hooks.afterCommit = () => x.owner('changed-owner');
  await assert.rejects(x.repo.commit(input), code('unavailable')); assert.equal(x.docs.get(CATALOG).revision, 1);
  x.hooks.afterCommit = undefined; x.owner(OWNER); assert.equal((await x.repo.commit(input)).status, 'already-committed');
});
test('get reauthorizes after server reads and never returns another owner or malformed catalog data', async () => {
  const h = harness(); h.hooks.read = () => h.owner('changed-owner'); await assert.rejects(h.repo.get(), code('unavailable'));
  const x = harness(); x.docs.set(CATALOG, { schemaVersion: 1 }); await assert.rejects(x.repo.get(), code('invalid'));
});
test('command data is deeply snapshotted before the first authorization await', async () => {
  const h = harness(), input = command(), saved = structuredClone(input); await h.prepare(saved);
  const started = deferred(), gate = deferred(); let first = true;
  h.hooks.auth = async () => { if (first) { first = false; started.resolve(); await gate.promise; } };
  const pending = h.repo.commit(input); await started.promise;
  input.data.services[0].name = 'تعديل متأخر'; input.data.services[0].priceCents = 0; input.data.examinationCents = 0;
  input.createdAt = '2026-10-11T00:00:00.001Z'; input.expectedRevision = 7; input.operationId = id(99); gate.resolve();
  await pending; assert.deepEqual((await h.repo.get())?.data, saved.data); assert.equal(h.docs.has(operation(99)), false);
});
test('parser snapshots output rather than retaining nested input objects or arrays', () => {
  const input = command(), parsed = prepareCloudServiceCatalogCommand(input); assert.deepEqual(parsed, input);
  input.data.services[0].name = 'تغيير'; input.data.services.push({ ...input.data.services[0], serviceId: serviceId(99) });
  assert.equal(parsed.data.services[0].name, 'حشو عادي'); assert.equal(parsed.data.services.length, 2);
  const record = { schemaVersion: 1, clinicId: 'main', recordId: 'serviceCatalog', revision: 1, lastOperationId: id(1), data: data() };
  const snapshot = parseCloudServiceCatalogRecord(record); record.data.services[0].active = false;
  assert.equal(snapshot.data.services[0].active, true);
});
test('money accepts integer piastres including explicit zero and max, while null means unknown service price only', () => {
  for (const priceCents of [null, 0, 1, 1_000_000_000_000]) {
    const input = data(); input.services[0].priceCents = priceCents;
    assert.equal(parseCloudServiceCatalogData(input).services[0].priceCents, priceCents);
  }
  for (const value of [null, -0, -1, 0.1, NaN, Infinity, 1_000_000_000_001, '10000', undefined]) {
    assert.throws(() => parseCloudServiceCatalogData({ ...data(), examinationCents: value }), code('invalid'));
    if (value !== null) assert.throws(() => parseCloudServiceCatalogData({ ...data(), services: [{ ...data().services[0], priceCents: value }] }), code('invalid'));
  }
});
test('catalog supports exactly 300 dense unique services, never silently truncates or ignores array properties', () => {
  const rows = Array.from({ length: 300 }, (_, index) => ({ ...data().services[0], serviceId: serviceId(index + 1), name: `خدمة ${index + 1}` }));
  assert.equal(parseCloudServiceCatalogData({ examinationCents: 0, services: rows }).services.length, 300);
  assert.throws(() => parseCloudServiceCatalogData({ examinationCents: 0, services: [...rows, { ...rows[0], serviceId: serviceId(999), name: 'إضافية' }] }), code('invalid'));
  const sparse = new Array(1); assert.throws(() => parseCloudServiceCatalogData({ examinationCents: 0, services: sparse }), code('invalid'));
  const extra: any[] & { extra?: boolean } = [data().services[0]]; extra.extra = true;
  assert.throws(() => parseCloudServiceCatalogData({ examinationCents: 0, services: extra }), code('invalid'));
});
test('overall UTF-8 catalog budget bounds heavy Unicode atomically with no truncation', () => {
  assert.equal(MAX_CLOUD_SERVICE_CATALOG_BYTES, 120 * 1024);
  const rows = Array.from({ length: 300 }, (_, index) => ({ ...data().services[0], serviceId: serviceId(index + 1),
    name: `${index + 1}${'😀'.repeat(77)}` }));
  const input = { examinationCents: 0, services: rows };
  assert.ok(new TextEncoder().encode(JSON.stringify(input)).byteLength > MAX_CLOUD_SERVICE_CATALOG_BYTES);
  assert.throws(() => parseCloudServiceCatalogData(input), code('invalid'));
  assert.equal(input.services.length, 300);
});
test('duplicate UUIDs and equivalent normalized Arabic names are rejected across clinical/prosthetic kinds', () => {
  const first = data().services[0];
  for (const pair of [
    [first, { ...first, name: 'اسم مختلف' }],
    [{ ...first, name: 'إجراء عادي' }, { ...first, serviceId: serviceId(2), kind: 'prosthetic', name: 'اجـراء  عَادي' }],
    [{ ...first, name: 'خدمة ١' }, { ...first, serviceId: serviceId(2), name: 'خدمة 1' }],
    [{ ...first, name: 'حشو ي' }, { ...first, serviceId: serviceId(2), name: 'حشو ى' }],
    [{ ...first, name: 'Service' }, { ...first, serviceId: serviceId(2), name: 'Ｓｅｒｖｉｃｅ' }],
  ]) assert.throws(() => parseCloudServiceCatalogData({ examinationCents: 0, services: pair }), code('invalid'));
});
test('names are trimmed nonempty single values up to80 Unicode code points without controls or prototype-reserved names', () => {
  const first = data().services[0];
  assert.equal(parseCloudServiceCatalogData({ examinationCents: 0, services: [{ ...first, name: '😀'.repeat(80) }] }).services[0].name.length, 160);
  for (const name of ['', ' ', ' حشو', 'حشو ', 'أ'.repeat(81), '😀'.repeat(81), 'حشو\nعادي', 'حشو\u0000', 'حشو\u202e', 'حشو\u2028عادي', '\ud800',
    '__proto__', 'Constructor', 'prototype', 'ـَ']) {
    assert.throws(() => parseCloudServiceCatalogData({ examinationCents: 0, services: [{ ...first, name }] }), code('invalid'));
  }
});
test('service exact fields and kind/active/UUID types reject unknown data rather than infer an Arabic label', () => {
  const first = data().services[0];
  assert.equal(parseCloudServiceCatalogData({ examinationCents: 0, services: [{ ...first, name: 'تركيبة', kind: 'clinical' }] }).services[0].kind, 'clinical');
  for (const change of [{ serviceId: 'not-a-uuid' }, { serviceId: 'A0000000-0000-4000-8000-000000000001' }, { kind: 'unknown' }, { active: 1 },
    { active: 'true' }, { laboratoryCostCents: 1000 }, { priceCents: undefined }]) {
    const input = { ...first, ...change };
    assert.throws(() => parseCloudServiceCatalogData({ examinationCents: 0, services: [input] }), code('invalid'));
  }
});
test('unknown schema/clinic/record fields and invalid/exhausted revisions fail closed', () => {
  const record = { schemaVersion: 1, clinicId: 'main', recordId: 'serviceCatalog', revision: 1, lastOperationId: id(1), data: data() };
  for (const change of [{ schemaVersion: 2 }, { clinicId: 'other' }, { recordId: 'anotherCatalog' }, { revision: 0 },
    { revision: 2_000_000_001 }, { revision: 0.5 }, { lastOperationId: 'bad' }, { extra: true }]) {
    assert.throws(() => parseCloudServiceCatalogRecord({ ...record, ...change }), code('invalid'));
  }
  for (const expectedRevision of [-0, -1, 0.5, 2_000_000_000, Number.MAX_SAFE_INTEGER, '0']) {
    assert.throws(() => prepareCloudServiceCatalogCommand(command(1, expectedRevision as number)), code('invalid'));
  }
  assert.equal(parseCloudServiceCatalogRecord({ ...record, revision: 2_000_000_000 }).revision, 2_000_000_000);
});
test('createdAt must be real canonical UTC millisecond timestamp, never local or date-only', () => {
  for (const createdAt of ['2026-10-11', '2026-02-30T00:00:00.000Z', '2026-10-11T00:00:00Z', '2026-10-11T00:00:00.000+00:00',
    '1899-12-31T00:00:00.000Z', '2026-10-11T24:00:00.000Z', null]) {
    assert.throws(() => prepareCloudServiceCatalogCommand(command(1, 0, { createdAt })), code('invalid'));
  }
});
test('getters, prototypes, symbols, sparse array accessors and throwing proxies are never executed as data', () => {
  let executions = 0;
  const accessor = Object.defineProperty({ ...data() }, 'examinationCents', { enumerable: true, get() { executions++; return 10000; } });
  const services = [data().services[0]]; Object.defineProperty(services, '0', { enumerable: true, get() { executions++; return data().services[0]; } });
  const hidden = Object.defineProperty({ ...data() }, 'examinationCents', { value: 10000, enumerable: false });
  for (const value of [accessor, hidden, Object.assign(Object.create({}), data()), { ...data(), [Symbol('extra')]: true },
    new Proxy(data(), { ownKeys() { throw new Error('PRIVATE_PROXY_DETAILS'); } }), { examinationCents: 0, services }]) {
    assert.throws(() => parseCloudServiceCatalogData(value), code('invalid'));
  }
  assert.equal(executions, 0);
  const commandGetter = Object.defineProperty(command(), 'data', { enumerable: true, get() { executions++; return data(); } });
  assert.throws(() => prepareCloudServiceCatalogCommand(commandGetter), code('invalid')); assert.equal(executions, 0);
});
test('invalid input fails before authorization, while provider/digest failures expose fixed safe errors only', async () => {
  const h = harness(); await assert.rejects(h.repo.commit({ ...command(), extra: true }), code('invalid')); assert.deepEqual(h.calls, []);
  const bad = createCloudServiceCatalogRepository(h.adapter, { digest: async () => 'INVALID_HASH' });
  await assert.rejects(bad.commit(command()), code('invalid')); assert.equal(h.docs.size, 0);
  h.adapter.authorizeOwner = async () => { throw new Error('PRIVATE_ACCOUNT_TOKEN'); };
  for (const action of [() => h.repo.get(), () => h.repo.commit(command())]) {
    await assert.rejects(action(), value => code('unavailable')(value) && !/PRIVATE/.test(String(value)));
  }
});
test('max revision advances once then rejects further changes rather than resetting the catalog', async () => {
  const h = harness(); h.docs.set(CATALOG, { schemaVersion: 1, clinicId: 'main', recordId: 'serviceCatalog',
    revision: 1_999_999_999, lastOperationId: id(2), data: data() });
  const input = command(1, 1_999_999_999); await h.prepare(input); await h.repo.commit(input);
  assert.equal((await h.repo.get())?.revision, 2_000_000_000);
  const before = structuredClone(h.docs); await assert.rejects(h.repo.commit(command(3, 2_000_000_000)), code('invalid'));
  assert.deepEqual(h.docs, before);
});
test('malformed adapter acknowledgements never become a successful catalog result', async () => {
  for (const result of [null, { status: 'committed', recordId: 'another', revision: 1 },
    { status: 'committed', recordId: 'serviceCatalog', revision: 2 },
    { status: 'committed', recordId: 'serviceCatalog', revision: 1, rawToken: 'PRIVATE' }]) {
    const h = harness(); h.adapter.runTransaction = async () => result as any;
    await assert.rejects(h.repo.commit(command()), code('invalid')); assert.equal(h.docs.size, 0);
  }
});
