import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { CLOUD_BOOTSTRAP_EMPTY_COLLECTIONS, CloudBootstrapError, createCloudEmptyClinicBootstrap,
  type CloudBootstrapAdapter, type CloudBootstrapAuthority } from './cloudEmptyClinicBootstrap';
import { createCloudOperationIntentRepository } from './cloudOperationIntent';
import { createCloudServiceCatalogRepository } from './cloudServiceCatalogRepository';

const OWNER = 'synthetic-bootstrap-owner';
const OP = '10000000-0000-4000-8000-000000000001';
const OP2 = '10000000-0000-4000-8000-000000000002';
const WHEN = '2026-10-12T00:00:00.000Z';
const command = () => ({ operationId: OP, routingOperationId: OP2, createdAt: WHEN });
const path = (collection: string, id: string) => `clinics/main/${collection}/${id}`;
const digest = async (value: string) => createHash('sha256').update(value).digest('hex');
const code = (expected: CloudBootstrapError['code']) => (value: unknown) => value instanceof CloudBootstrapError && value.code === expected;
const authority = (): CloudBootstrapAuthority => ({ projectId: 'dental-clinic-mmaakk888', databaseId: '(default)',
  location: 'europe-west1', billingEnabled: false, membershipOnlyRules: true, ownerUid: OWNER,
  ownerActive: true, ownerEmailVerified: true, ownerClaimsVerified: true });
function harness() {
  const docs = new Map<string, any>([[path('members', OWNER), { schemaVersion: 1, clinicId: 'main', uid: OWNER,
    role: 'owner', status: 'active', identityVersion: 1, verifiedAfter: 0 }]]);
  const calls: string[] = [];
  const faults = { writeAt: 0, loseReply: false, authAt: 0, wrongResult: false, malformedList: false };
  let authCalls = 0, writes = 0, tail = Promise.resolve();
  const current: { value: unknown } = { value: authority() };
  const adapter: CloudBootstrapAdapter = {
    authorizeBootstrap: async () => {
      calls.push('authorize');
      if (++authCalls === faults.authAt) throw new Error('PRIVATE_PROVIDER');
      return structuredClone(current.value) as CloudBootstrapAuthority;
    },
    runTransaction: async work => {
      const before = tail; let release!: () => void;
      tail = new Promise<void>(resolve => { release = resolve; }); await before;
      const staged = structuredClone(docs); let wrote = false;
      try {
        const result = await work({
          get: async key => { assert.equal(wrote, false); calls.push(`get:${key}`); return structuredClone(staged.get(key) ?? null); },
          listFirst: async key => {
            assert.equal(wrote, false); calls.push(`query:${key}`);
            if (faults.malformedList) return new Array(1);
            const found = [...staged.keys()].find(name => name.startsWith(`${key}/`));
            return found ? [{ id: found.split('/').at(-1) }] : [];
          },
          create: (key, value) => {
            wrote = true; calls.push(`create:${key}`);
            assert.equal(staged.has(key), false, 'server create-only precondition');
            if (++writes === faults.writeAt) throw new Error('PRIVATE_WRITE_FAILURE');
            staged.set(key, structuredClone(value));
          },
        });
        docs.clear(); for (const [key, value] of staged) docs.set(key, value);
        if (faults.loseReply) { faults.loseReply = false; throw new Error('PRIVATE_LOST_ACK'); }
        return faults.wrongResult ? {} as any : result;
      } finally { release(); }
    },
  };
  return { docs, calls, faults, current, adapter, bootstrap: createCloudEmptyClinicBootstrap(adapter, { digest }), writes: () => writes };
}

test('trusted bootstrap construction is inert and never imports local account/clinical storage', () => {
  const h = harness(); assert.deepEqual(h.calls, []);
  const source = readFileSync(new URL('./cloudEmptyClinicBootstrap.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /from ['"].*(?:storage|firebaseService|passwords)['"]|localStorage|sessionStorage|Date\.now|randomUUID/);
});
test('bootstrap atomically creates eight metadata/counter/catalog/routing records, no operational or account data', async () => {
  const h = harness();
  assert.deepEqual(await h.bootstrap.initialize(command()), { status: 'created', clinicalRecordsCreated: 0 });
  assert.equal(h.writes(), 8); assert.equal(h.docs.size, 9);
  assert.deepEqual(h.docs.get(path('counters', 'patientFiles')), { schemaVersion: 1, clinicId: 'main', lastFileNo: 0, lastOperationId: null });
  assert.deepEqual(h.docs.get(path('settings', 'serviceCatalog')).data, { examinationCents: 10_000, services: [] });
  assert.equal(h.docs.get(path('operationIntents', OP)).status, 'committed');
  for (const name of ['patientProfiles', 'contactRecords', 'appointmentRecords', 'labCases', 'expenseRecords', 'materialUsages']) {
    assert.equal([...h.docs.keys()].some(key => key.startsWith(`clinics/main/${name}/`)), false);
  }
  assert.equal(h.calls.filter(call => call.startsWith('query:')).length, CLOUD_BOOTSTRAP_EMPTY_COLLECTIONS.length);
});
test('lost acknowledgement retries same bootstrap without a reset or another write', async () => {
  const h = harness(); h.faults.loseReply = true;
  await assert.rejects(h.bootstrap.initialize(command()), code('unavailable'));
  const accepted = structuredClone(h.docs), count = h.writes();
  assert.equal((await h.bootstrap.initialize(command())).status, 'already-initialized');
  assert.deepEqual(h.docs, accepted); assert.equal(h.writes(), count);
});
test('same bootstrap retry preserves later counter, catalog and clinical records exactly', async () => {
  const h = harness(); await h.bootstrap.initialize(command());
  h.docs.set(path('counters', 'patientFiles'), { schemaVersion: 1, clinicId: 'main', lastFileNo: 451, lastOperationId: OP2 });
  const updated = h.docs.get(path('settings', 'serviceCatalog'));
  updated.revision = 2; updated.lastOperationId = OP2; updated.data.examinationCents = 20_000;
  h.docs.set(path('patientProfiles', OP2), { synthetic: true });
  const before = structuredClone(h.docs), count = h.writes();
  assert.equal((await h.bootstrap.initialize(command())).status, 'already-initialized');
  assert.deepEqual(h.docs, before); assert.equal(h.writes(), count);
});
test('bootstrap seed receipt is acknowledged by the normal catalog repository and journal', async () => {
  const h = harness(); await h.bootstrap.initialize(command());
  const adapter = { authorizeOwner: async () => OWNER,
    readRecord: async (key: string) => structuredClone(h.docs.get(key) ?? null),
    runTransaction: async <T>(work: (transaction: any) => Promise<T>): Promise<T> => work({
      get: async (key: string) => structuredClone(h.docs.get(key) ?? null),
      set: () => { assert.fail('historical replay must never write'); },
    }),
  };
  const journal = createCloudOperationIntentRepository(adapter, { digest });
  const catalog = createCloudServiceCatalogRepository(adapter, { digest });
  const original = { operationId: OP, createdAt: WHEN, expectedRevision: 0, data: { examinationCents: 10_000, services: [] } };
  assert.equal((await journal.prepare('catalog', original, WHEN)).status, 'committed');
  assert.deepEqual(await catalog.commit(original), { status: 'already-committed', recordId: 'serviceCatalog', revision: 1 });
});
test('concurrent same-command bootstrap creates only once', async () => {
  const h = harness();
  const results = await Promise.all([h.bootstrap.initialize(command()), h.bootstrap.initialize(command())]);
  assert.deepEqual(results.map(item => item.status), ['created', 'already-initialized']); assert.equal(h.writes(), 8);
});
for (const collection of CLOUD_BOOTSTRAP_EMPTY_COLLECTIONS) {
  test(`bootstrap refuses nonempty ${collection} without deleting or overwriting anything`, async () => {
    const h = harness(); h.docs.set(path(collection, 'synthetic-existing'), { existing: true });
    const before = structuredClone(h.docs);
    await assert.rejects(h.bootstrap.initialize(command()), code('conflict'));
    assert.deepEqual(h.docs, before); assert.equal(h.writes(), 0);
  });
}
test('existing counter/catalog without matching completed bootstrap marker is never adopted or reset', async () => {
  for (const key of [path('counters', 'patientFiles'), path('settings', 'serviceCatalog')]) {
    const h = harness(); h.docs.set(key, {}); const before = structuredClone(h.docs);
    await assert.rejects(h.bootstrap.initialize(command()), code('conflict')); assert.deepEqual(h.docs, before); assert.equal(h.writes(), 0);
  }
});
test('partial or mutated seed history and a different initialization command fail closed', async () => {
  for (const change of ['counter', 'catalog', 'receipt', 'intent', 'hash', 'command', 'actor', 'time', 'new-operation']) {
    const h = harness(); await h.bootstrap.initialize(command());
    let retry = command();
    if (change === 'counter') h.docs.get(path('counters', 'patientFiles')).lastFileNo = -1;
    if (change === 'catalog') h.docs.delete(path('settings', 'serviceCatalog'));
    if (change === 'receipt') h.docs.delete(path('catalogOperations', OP));
    if (change === 'intent') h.docs.delete(path('operationIntents', OP));
    if (change === 'hash') h.docs.get(path('operationIntents', OP)).requestHash = '0'.repeat(64);
    if (change === 'command') h.docs.get(path('operationIntents', OP)).command.data.examinationCents = 0;
    if (change === 'actor') h.docs.get(path('bootstrap', 'initialRelease')).actorUid = 'other-synthetic-owner';
    if (change === 'time') retry = { ...retry, createdAt: '2026-10-12T00:00:01.000Z' };
    if (change === 'new-operation') retry = { ...retry, operationId: OP2 };
    const before = structuredClone(h.docs), count = h.writes();
    await assert.rejects(h.bootstrap.initialize(retry)); assert.deepEqual(h.docs, before); assert.equal(h.writes(), count);
  }
});
test('wrong project/database/region/billing/Rules or noncanonical owner never starts seeding', async () => {
  for (const patch of [{ projectId: 'zippy-dispatcher-m1ttq' }, { databaseId: 'other' }, { location: 'us-central1' },
    { billingEnabled: true }, { membershipOnlyRules: false }, { ownerUid: '' }, { ownerActive: false },
    { ownerEmailVerified: false }, { ownerClaimsVerified: false }, { credential: 'never-accepted' }]) {
    const h = harness(); h.current.value = { ...authority(), ...patch };
    await assert.rejects(h.bootstrap.initialize(command())); assert.equal(h.writes(), 0);
  }
  for (const change of ['missing', 'secretary', 'suspended', 'different-uid', 'extra-field']) {
    const h = harness(); const member = h.docs.get(path('members', OWNER));
    if (change === 'missing') h.docs.delete(path('members', OWNER));
    if (change === 'secretary') member.role = 'secretary';
    if (change === 'suspended') member.status = 'suspended';
    if (change === 'different-uid') member.uid = 'other';
    if (change === 'extra-field') member.extra = true;
    await assert.rejects(h.bootstrap.initialize(command())); assert.equal(h.writes(), 0);
  }
});
test('invalid commands, accessors and array-hole queries never write', async () => {
  for (const input of [null, {}, { ...command(), operationId: OP + '\n' }, { ...command(), createdAt: '2026-02-30T00:00:00.000Z' },
    { ...command(), createdAt: WHEN + '\n' }, { ...command(), data: [] }, { ...command(), get operationId() { throw new Error('PRIVATE_GETTER'); } }]) {
    const h = harness(); await assert.rejects(h.bootstrap.initialize(input), code('invalid')); assert.equal(h.writes(), 0);
  }
  const h = harness(); h.faults.malformedList = true;
  await assert.rejects(h.bootstrap.initialize(command()), code('unavailable')); assert.equal(h.writes(), 0);
});
test('failed write rolls back atomic initialization and never leaks provider details', async () => {
  for (let index = 1; index <= 8; index++) {
    const h = harness(); h.faults.writeAt = index; const before = structuredClone(h.docs);
    await assert.rejects(h.bootstrap.initialize(command()), value => {
      assert.ok(code('unavailable')(value)); assert.doesNotMatch(String(value), /PRIVATE/); return true;
    });
    assert.deepEqual(h.docs, before);
  }
});
test('authorization loss before transaction or after accepted commit never claims a rollback', async () => {
  const h = harness(); h.faults.authAt = 3;
  await assert.rejects(h.bootstrap.initialize(command()), code('unavailable')); assert.equal(h.writes(), 0);
  const accepted = harness(); accepted.faults.authAt = 5;
  await assert.rejects(accepted.bootstrap.initialize(command()), code('unavailable')); assert.equal(accepted.docs.size, 9);
  accepted.faults.authAt = 0;
  assert.equal((await accepted.bootstrap.initialize(command())).status, 'already-initialized'); assert.equal(accepted.writes(), 8);
});
