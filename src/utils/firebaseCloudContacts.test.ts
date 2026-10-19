import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';

const ID = '10000000-0000-4000-8000-000000000001';
const OP = '20000000-0000-4000-8000-000000000001';
const UID = 'synthetic-owner';
const TIME = '2026-10-12T10:00:00.000Z';
const project = 'osama-clinic-38706';
const entry = 'src/utils/firebaseCloudContacts.ts';
const bundle = build({ entryPoints: [entry], bundle: true, write: false, metafile: true, platform: 'node', format: 'cjs',
  external: ['firebase/*'], supported: { 'dynamic-import': false }, logLevel: 'silent' });

async function harness(options: { hostname?: string; projectId?: string; appName?: string; verified?: boolean;
  memberDisabled?: boolean; staleAuthTime?: boolean; swapDuringMemberRead?: boolean; denyWrite?: boolean; denyRead?: boolean;
  stopAt?: 'database' | 'token' | 'member' | 'record' | 'page' | 'transaction-read' | 'transaction-ack' } = {}) {
  const compiled = await bundle, module = { exports: {} as any }, calls: string[] = [];
  const user = { uid: UID, email: 'owner@example.invalid', emailVerified: options.verified ?? true };
  const auth = { app: { name: options.appName ?? `clinic-operating-${ID}`, options: { projectId: options.projectId ?? project, authDomain: `${project}.firebaseapp.com` } },
    emulatorConfig: null, currentUser: user as typeof user | null };
  const rows = new Map<string, any>();
  let transactionTail = Promise.resolve();
  const active = { value: true };
  const faults = { stopAt: options.stopAt, denyWrite: options.denyWrite, lostReply: false };
  const hooks: Record<string, (() => void) | undefined> = {};
  const stop = (boundary: string) => { hooks[boundary]?.(); if (faults.stopAt === boundary) active.value = false; };
  let copyToServiceRealm!: (value: unknown) => any;
  const scope = { module, exports: module.exports, TextEncoder, crypto: webcrypto,
    window: { location: { hostname: options.hostname ?? '127.0.0.1' } },
    get localStorage() { throw new Error('Local clinic storage forbidden'); },
    get sessionStorage() { throw new Error('Local sessions forbidden'); },
    fetch: () => { throw new Error('Real network forbidden'); },
    require: (name: string) => {
      calls.push(`import:${name}`);
      if (name === 'firebase/auth') return {
        getIdTokenResult: async (target: unknown) => { assert.equal(target, user); calls.push('token'); stop('token'); return { signInProvider: 'password', claims: {
          sub: UID, aud: project, iss: `https://securetoken.google.com/${project}`, email: user.email, email_verified: true,
          dentalClinicId: 'main', dentalClinicRole: 'owner', auth_time: options.staleAuthTime ? 99 : 100,
        } }; },
      };
      if (name === 'firebase/firestore/lite') return {
        getFirestore: (app: unknown) => { assert.equal(app, auth.app); calls.push('database:named-default'); stop('database'); return 'synthetic-database'; },
        doc: (_db: unknown, ...parts: string[]) => parts.join('/'),
        getDoc: async (path: string) => {
          if (path.startsWith('clinics/main/contactRecords/') || path.startsWith('clinics/main/operationIntents/')) {
            calls.push(`record:${path}`); if (options.denyRead) throw new Error('PRIVATE_READ_DENIED'); stop('record');
            return { exists: () => { stop('record-exists'); return rows.has(path); }, data: () => { stop('record-data'); return rows.get(path); } };
          }
          assert.equal(path, `clinics/main/members/${UID}`); calls.push(`member:${path}`); stop('member');
          if (options.swapDuringMemberRead) auth.currentUser = { ...user };
          return { exists: () => { stop('member-exists'); return true; }, data: () => { stop('member-data'); return copyToServiceRealm({ schemaVersion: 1, clinicId: 'main', uid: UID, role: 'owner',
            status: options.memberDisabled ? 'disabled' : 'active', identityVersion: 1, verifiedAfter: 100 }); } };
        },
        collection: (_db: unknown, ...parts: string[]) => parts.join('/'),
        documentId: () => '__name__', orderBy: (field: string) => ({ kind: 'order', field }),
        startAfter: (id: string) => ({ kind: 'after', id }), limit: (count: number) => ({ kind: 'limit', count }),
        where: (field: string, operator: string, value: string) => ({ kind: 'where', field, operator, value }),
        query: (path: string, ...constraints: any[]) => ({ path, constraints }),
        getDocs: async (query: any) => {
          assert.ok(['clinics/main/contactRecords', 'clinics/main/operationIntents'].includes(query.path));
          assert.deepEqual(query.constraints.find((value: any) => value.kind === 'order'), { kind: 'order', field: '__name__' });
          assert.equal(query.constraints.at(-1).kind, 'limit');
          calls.push(`page:${JSON.stringify(query.constraints)}`);
          if (options.denyRead) throw new Error('PRIVATE_READ_DENIED'); stop('page');
          const after = query.constraints.find((value: any) => value.kind === 'after')?.id;
          return { docs: [...rows.entries()].filter(([path, data]) => path.startsWith(`${query.path}/`) && (!after || path.split('/').at(-1)! > after)
              && query.constraints.filter((value: any) => value.kind === 'where').every((value: any) => data[value.field] === value.value))
            .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).slice(0, query.constraints.at(-1).count)
            .map(([path, data]) => ({ id: path.split('/').at(-1), data: () => { stop('page-data'); return data; } })) };
        },
        runTransaction: async (_db: unknown, work: any, settings: any) => {
          assert.equal(settings.maxAttempts, 5); calls.push('transaction');
          const previous = transactionTail; let release!: () => void;
          transactionTail = new Promise<void>(resolve => { release = resolve; }); await previous;
          try {
            const staged = new Map(rows); let wrote = false;
            const result = await work({
            get: async (path: string) => { assert.equal(wrote, false); calls.push(`get:${path}`); stop('transaction-read'); return { exists: () => { stop('transaction-exists'); return staged.has(path); }, data: () => { stop('transaction-data'); return staged.get(path); } }; },
            set: (path: string, data: unknown) => { wrote = true; if (faults.denyWrite) throw new Error('PRIVATE_PERMISSION_DENIED'); calls.push(`set:${path}`); stop('transaction-set'); staged.set(path, data); },
            delete: (path: string) => { wrote = true; calls.push(`delete:${path}`); staged.delete(path); },
          });
          rows.clear(); for (const [key, value] of staged) rows.set(key, value); stop('transaction-ack');
          if (faults.lostReply) { faults.lostReply = false; throw new Error('PRIVATE_LOST_ACK'); }
          return result;
          } finally { release(); }
        },
      };
      throw new Error(`Unexpected SDK import ${name}`);
    },
  };
  runInNewContext(compiled.outputFiles[0].text, scope);
  copyToServiceRealm = runInNewContext('(value) => JSON.parse(JSON.stringify(value))', scope);
  // Construct payload in the bundle's own realm for its plain-object guard.
  const payload = runInNewContext(`({ operationId:'${OP}', recordId:'${ID}', expectedRevision:0, action:'create',
    contact:{ id:'${ID}',name:'جهة اختبار وهمية',mobile:'01000000001',createdAt:'2026-10-08T10:00:00.000Z' } })`, scope);
  return { service: module.exports, auth, calls, rows, payload, compiled, active, faults, hooks, user, toRealm: copyToServiceRealm };
}

test('prepared Firebase contact adapter does not load SDK or clinic storage on import', async () => {
  const h = await harness(); assert.deepEqual(h.calls, []);
  const inputs = Object.keys(h.compiled.metafile!.inputs);
  assert.equal(inputs.some(path => /utils\/(?:storage|localClinicBackup|firebaseService|offlineSync)|App\.tsx|components\//.test(path)), false);
});

test('adapter requires loopback, exact new project and isolated operating app before SDK imports', async () => {
  for (const options of [{ hostname: 'public.example.invalid' }, { projectId: 'zippy-dispatcher-m1ttq' },
    { appName: '[DEFAULT]' }, { appName: `clinic-owner-setup-${ID}` }]) {
    const h = await harness(options);
    await assert.rejects(h.service.createFirebaseCloudContacts(h.auth), /تعذّر تأكيد الحفظ السحابي/);
    assert.deepEqual(h.calls, []); assert.equal(h.rows.size, 0);
  }
});

test('explicit commit uses named-app Lite transaction only after verified canonical owner checks', async () => {
  const h = await harness(), repo = await h.service.createFirebaseCloudContacts(h.auth);
  assert.equal(h.calls.some(call => call.startsWith('member:') || call === 'transaction'), false, 'creating adapter does not read/write records');
  await repo.journal.prepare('contact', h.payload, TIME);
  const result = await repo.commit(h.payload); assert.equal(result.status, 'committed'); assert.equal(h.rows.size, 4);
  assert.ok(h.calls.indexOf(`member:clinics/main/members/${UID}`) < h.calls.indexOf('transaction'));
  assert.ok(h.calls.includes('import:firebase/firestore/lite')); assert.equal(h.calls.includes('import:firebase/firestore'), false);
  assert.equal(h.calls.some(call => /patients|backup|expenses|labCosts/.test(call)), false);
});

test('unverified, disabled, stale-cutoff or replaced owner cannot schedule contact writes', async () => {
  for (const options of [{ verified: false }, { memberDisabled: true }, { staleAuthTime: true }, { swapDuringMemberRead: true }]) {
    const h = await harness(options), repo = await h.service.createFirebaseCloudContacts(h.auth);
    await assert.rejects(repo.commit(h.payload), /تعذّر تأكيد الحفظ السحابي/);
    assert.equal(h.rows.size, 0); assert.equal(h.calls.some(call => call.startsWith('set:') || call === 'transaction'), false);
  }
});

test('server permission denial remains a fixed failed save with no local fallback or partial records', async () => {
  const h = await harness(), repo = await h.service.createFirebaseCloudContacts(h.auth);
  await repo.journal.prepare('contact', h.payload, TIME); h.faults.denyWrite = true;
  await assert.rejects(repo.commit(h.payload), (error: unknown) => /تعذّر تأكيد الحفظ السحابي/.test(String(error)) && !String(error).includes('PRIVATE'));
  assert.equal(h.rows.size, 1);
});

const OTHER = '10000000-0000-4000-8000-000000000002';
function syntheticRecord(id = ID, deleted = false) {
  return { schemaVersion: 1, clinicId: 'main', recordId: id, revision: deleted ? 2 : 1,
    deleted, lastOperationId: OP,
    phoneKey: deleted ? null : createHash('sha256').update('contact-phone-v1:201000000001').digest('hex'),
    data: deleted ? null : { id, name: 'جهة قراءة وهمية', mobile: '01000000001', createdAt: '2026-10-08T10:00:00.000Z' } };
}

test('SDK get uses only a fresh exact contact document and rechecks membership after its result', async () => {
  const h = await harness(), repo = await h.service.createFirebaseCloudContacts(h.auth);
  h.rows.set(`clinics/main/contactRecords/${ID}`, h.toRealm(syntheticRecord()));
  const value = await repo.get(ID);
  assert.equal(value.data.name, 'جهة قراءة وهمية'); assert.equal(value.recordId, ID);
  const recordCall = h.calls.indexOf(`record:clinics/main/contactRecords/${ID}`);
  assert.ok(recordCall > h.calls.indexOf(`member:clinics/main/members/${UID}`));
  assert.ok(h.calls.lastIndexOf(`member:clinics/main/members/${UID}`) > recordCall);
  assert.equal(h.calls.includes('transaction'), false); assert.equal(await repo.get(OTHER), null);
  assert.equal(h.calls.some(call => /patients|backup|expenses|labCosts/.test(call)), false);
});

test('SDK pages use document-ID ordering, an exclusive cursor and bounded limits including tombstones', async () => {
  const h = await harness(), repo = await h.service.createFirebaseCloudContacts(h.auth);
  h.rows.set(`clinics/main/contactRecords/${ID}`, h.toRealm(syntheticRecord()));
  h.rows.set(`clinics/main/contactRecords/${OTHER}`, h.toRealm(syntheticRecord(OTHER, true)));
  const all = await repo.listPage();
  assert.equal(all.records.length, 2); assert.equal(all.records[1].deleted, true); assert.equal(all.nextAfterId, null);
  assert.ok(h.calls.some(call => call.startsWith('page:') && call.includes('"count":25')));
  const first = await repo.listPage(h.toRealm({ limit: 1 })); assert.equal(first.nextAfterId, ID);
  const next = await repo.listPage(h.toRealm({ afterId: ID, limit: 1 }));
  assert.equal(next.records[0].recordId, OTHER); assert.equal(next.nextAfterId, OTHER);
  assert.ok(h.calls.some(call => call.startsWith('page:') && call.includes(`"kind":"after","id":"${ID}"`)));
  assert.equal(h.calls.includes('transaction'), false);
});

test('SDK read denial never becomes an empty successful result or exposes raw provider details', async () => {
  const h = await harness({ denyRead: true }), repo = await h.service.createFirebaseCloudContacts(h.auth);
  for (const read of [() => repo.get(ID), () => repo.listPage()]) {
    await assert.rejects(read(), (error: unknown) => /تعذّر تأكيد الحفظ السحابي/.test(String(error)) && !String(error).includes('PRIVATE'));
  }
  assert.equal(h.rows.size, 0);
});

test('optional lifecycle binding refuses an inactive factory without loading any SDK', async () => {
  for (const isActive of [() => false, () => { throw new Error('PRIVATE_LIFETIME_DETAIL'); }]) {
    const h = await harness();
    await assert.rejects(h.service.createFirebaseCloudContacts(h.auth, { isActive }), (error: unknown) => /تعذّر تأكيد الحفظ السحابي/.test(String(error)) && !String(error).includes('PRIVATE'));
    assert.deepEqual(h.calls, []);
  }
});

test('lifecycle invalidation after synchronous database initialization also refuses the factory', async () => {
  const h = await harness({ stopAt: 'database' });
  await assert.rejects(h.service.createFirebaseCloudContacts(h.auth, { isActive: () => h.active.value }), /تعذّر تأكيد الحفظ السحابي/);
  assert.equal(h.calls.some(call => call.startsWith('member:') || call.startsWith('page:') || call.startsWith('record:')), false);
});

test('owner get and page cannot publish data after lifecycle invalidation at token, membership or record boundaries', async () => {
  for (const method of ['get', 'listPage'] as const) {
    for (const stopAt of ['token', 'member', method === 'get' ? 'record' : 'page'] as const) {
      const h = await harness({ stopAt }), repo = await h.service.createFirebaseCloudContacts(h.auth, { isActive: () => h.active.value });
      h.rows.set(`clinics/main/contactRecords/${ID}`, h.toRealm(syntheticRecord()));
      await assert.rejects(method === 'get' ? repo.get(ID) : repo.listPage(), /تعذّر تأكيد الحفظ السحابي/);
      assert.equal(h.calls.some(call => call.startsWith('set:') || call === 'transaction'), false);
      if (stopAt === 'token') assert.equal(h.calls.some(call => call.startsWith('member:')), false);
      if (stopAt === 'member') assert.equal(h.calls.some(call => call.startsWith('record:') || call.startsWith('page:')), false);
    }
  }
});

test('lifecycle invalidation fences transaction reads and a lost lifetime after commit never confirms success', async () => {
  for (const stopAt of ['transaction-read', 'transaction-ack'] as const) {
    const h = await harness(), repo = await h.service.createFirebaseCloudContacts(h.auth, { isActive: () => h.active.value });
    await repo.journal.prepare('contact', h.payload, TIME); h.faults.stopAt = stopAt;
    const setCount = h.calls.filter(call => call.startsWith('set:')).length;
    await assert.rejects(repo.commit(h.payload), /تعذّر تأكيد الحفظ السحابي/);
    assert.equal(h.rows.size, stopAt === 'transaction-read' ? 1 : 4);
    if (stopAt === 'transaction-read') assert.equal(h.calls.filter(call => call.startsWith('set:')).length, setCount);
  }
});

test('inactive lifecycle blocks every new operation before token or data reads without local fallback', async () => {
  const h = await harness(), repo = await h.service.createFirebaseCloudContacts(h.auth, { isActive: () => h.active.value });
  h.active.value = false; const before = [...h.calls];
  for (const action of [() => repo.get(ID), () => repo.listPage(), () => repo.commit(h.payload)]) await assert.rejects(action(), /تعذّر تأكيد الحفظ السحابي/);
  assert.deepEqual(h.calls, before); assert.equal(h.rows.size, 0);
});

test('operating contact capability exposes frozen contact-only journal with mandatory commit coupling', async () => {
  const h = await harness(), repo = await h.service.createFirebaseCloudContacts(h.auth);
  assert.deepEqual(Object.keys(repo).sort(), ['commit', 'get', 'journal', 'listPage']);
  assert.equal(Object.isFrozen(repo), true); assert.equal(Object.isFrozen(repo.journal), true);
  await assert.rejects(repo.commit(h.payload)); assert.equal(h.rows.size, 0);
  const before = [...h.calls];
  for (const kind of ['clinical', 'patient-profile', 'catalog', 'other']) {
    await assert.rejects(repo.journal.prepare(kind, h.payload, TIME));
    await assert.rejects(repo.journal.listPreparedPage(kind));
    await assert.rejects(repo.journal.listHistoryPage(kind));
  }
  assert.deepEqual(h.calls, before);
  const intent = await repo.journal.prepare('contact', h.payload, TIME);
  assert.equal(intent.createdAt, TIME); assert.equal(Object.hasOwn(intent.command, 'createdAt'), false);
  assert.equal((await repo.commit(h.payload)).status, 'committed');
  assert.equal(h.rows.get(`clinics/main/operationIntents/${OP}`).status, 'committed');
});

test('journal uses explicit envelope time, snapshots contact command, and rejects malformed preparation before any write', async () => {
  const h = await harness(), repo = await h.service.createFirebaseCloudContacts(h.auth);
  for (const value of [h.toRealm({ ...h.payload, extra: true }), h.toRealm({ ...h.payload, createdAt: TIME }),
    h.toRealm({ ...h.payload, expectedRevision: 1 }), h.toRealm({ ...h.payload, contact: { ...h.payload.contact, mobile: 'bad' } })]) {
    const before = [...h.calls]; await assert.rejects(repo.journal.prepare('contact', value, TIME)); assert.deepEqual(h.calls, before);
  }
  for (const createdAt of ['', '2026-02-30T10:00:00.000Z', TIME + '\n']) {
    const before = [...h.calls]; await assert.rejects(repo.journal.prepare('contact', h.payload, createdAt)); assert.deepEqual(h.calls, before);
  }
  const original = h.payload.contact.name;
  const pending = repo.journal.prepare('contact', h.payload, TIME); h.payload.contact.name = 'اسم مختلف مصطنع';
  const prepared = await pending; assert.equal(prepared.command.contact.name, original); assert.equal(h.rows.size, 1);
});

test('all-status journal history is bounded owner/kind-filtered and includes committed and cancelled operations', async () => {
  const h = await harness(), repo = await h.service.createFirebaseCloudContacts(h.auth);
  await repo.journal.prepare('contact', h.payload, TIME); await repo.commit(h.payload);
  const second = '20000000-0000-4000-8000-000000000002';
  const command = h.toRealm({ ...h.payload, operationId: second, expectedRevision: 1, action: 'update' });
  await repo.journal.prepare('contact', command, TIME); await repo.journal.cancel(second);
  const all = await repo.journal.listHistoryPage('contact');
  assert.deepEqual(Array.from(all.records, (row: any) => row.status), ['committed', 'cancelled']);
  assert.equal((await repo.journal.listPreparedPage('contact')).records.length, 0);
  const first = await repo.journal.listHistoryPage('contact', h.toRealm({ limit: 1 })); assert.equal(first.nextAfterId, OP);
  const next = await repo.journal.listHistoryPage('contact', h.toRealm({ limit: 1, afterId: OP })); assert.equal(next.records[0].operationId, second);
  const queries = h.calls.filter(call => call.startsWith('page:')).map(call => JSON.parse(call.slice(5)));
  for (const query of queries) {
    assert.ok(query.some((c: any) => c.kind === 'where' && c.field === 'actorUid' && c.value === UID));
    assert.ok(query.some((c: any) => c.kind === 'where' && c.field === 'kind' && c.value === 'contact'));
    assert.equal(query.at(-1).kind, 'limit');
  }
  assert.equal(queries[0].some((c: any) => c.field === 'status'), false);
  assert.equal(queries[1].some((c: any) => c.field === 'status' && c.value === 'prepared'), true);
});

test('lost SDK prepare and commit acknowledgements recover original UUID through a new capability', async () => {
  const h = await harness(); let repo = await h.service.createFirebaseCloudContacts(h.auth);
  h.faults.lostReply = true; await assert.rejects(repo.journal.prepare('contact', h.payload, TIME));
  assert.equal(h.rows.size, 1); repo = await h.service.createFirebaseCloudContacts(h.auth);
  assert.equal((await repo.journal.listHistoryPage('contact')).records[0].status, 'prepared');
  await repo.journal.prepare('contact', h.payload, TIME);
  h.faults.lostReply = true; await assert.rejects(repo.commit(h.payload)); assert.equal(h.rows.size, 4);
  repo = await h.service.createFirebaseCloudContacts(h.auth);
  const intent = (await repo.journal.listHistoryPage('contact')).records[0]; assert.equal(intent.status, 'committed');
  const before = structuredClone(h.rows), writes = h.calls.filter(call => call.startsWith('set:')).length;
  assert.equal((await repo.commit(intent.command)).status, 'already-committed');
  assert.deepEqual(structuredClone(h.rows), before); assert.equal(h.calls.filter(call => call.startsWith('set:')).length, writes);
});

function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function fingerprint(intent: any) {
  return createHash('sha256').update(JSON.stringify(['clinic-operation-intent-v1', intent.actorUid, intent.kind, canonical(intent.command)])).digest('hex');
}

test('SDK cancellation validates complete domain intent before any hidden write', async () => {
  const mutations: Array<(intent: any) => void> = [
    intent => { intent.command.contact.mobile = 'bad'; },
    intent => { intent.command.contact.extra = 'forbidden'; },
    intent => { intent.command.createdAt = TIME; },
    intent => { intent.command.expectedRevision = 1; },
    intent => { intent.kind = 'patient-profile'; },
    intent => { intent.actorUid = 'other-synthetic-owner'; },
    intent => { intent.operationId = '20000000-0000-4000-8000-000000000002'; intent.recordId = intent.operationId; intent.command.operationId = intent.operationId; },
    intent => { intent.createdAt = '2026-02-30T10:00:00.000Z'; },
  ];
  for (const mutate of mutations) {
    const h = await harness(), repo = await h.service.createFirebaseCloudContacts(h.auth);
    await repo.journal.prepare('contact', h.payload, TIME);
    const invalid = JSON.parse(JSON.stringify(h.rows.get(`clinics/main/operationIntents/${OP}`)));
    mutate(invalid); invalid.requestHash = fingerprint(invalid);
    h.rows.set(`clinics/main/operationIntents/${OP}`, h.toRealm(invalid));
    const before = structuredClone(h.rows), writeCount = h.calls.filter(call => call.startsWith('set:')).length;
    await assert.rejects(repo.journal.cancel(OP)); assert.deepEqual(structuredClone(h.rows), before);
    assert.equal(h.calls.filter(call => call.startsWith('set:')).length, writeCount, 'no mutation before rejecting malformed command');
    await assert.rejects(repo.journal.get(OP)); await assert.rejects(repo.commit(h.payload)); assert.deepEqual(structuredClone(h.rows), before);
  }
});

test('SDK committed cancellation fails and historical replay requires the exact domain receipt envelope', async () => {
  const h = await harness(), repo = await h.service.createFirebaseCloudContacts(h.auth);
  await repo.journal.prepare('contact', h.payload, TIME); await repo.commit(h.payload); const before = structuredClone(h.rows);
  await assert.rejects(repo.journal.cancel(OP)); assert.deepEqual(structuredClone(h.rows), before);
  const intent = h.rows.get(`clinics/main/operationIntents/${OP}`);
  h.rows.set(`clinics/main/operationIntents/${OP}`, h.toRealm({ ...intent, createdAt: '2026-10-12T11:00:00.000Z' }));
  const corrupt = structuredClone(h.rows); await assert.rejects(repo.commit(h.payload)); assert.deepEqual(structuredClone(h.rows), corrupt);
});

test('exact Auth user/app and lifetime loss permanently revoke retained contact journal and repository', async () => {
  for (const lose of ['user', 'app', 'active'] as const) {
    const h = await harness(), repo = await h.service.createFirebaseCloudContacts(h.auth, { isActive: () => h.active.value });
    const originalApp = h.auth.app;
    if (lose === 'user') h.auth.currentUser = { ...h.user };
    if (lose === 'app') h.auth.app = { ...originalApp };
    if (lose === 'active') h.active.value = false;
    await assert.rejects(repo.get(ID)); h.auth.currentUser = h.user; h.auth.app = originalApp; h.active.value = true;
    const before = [...h.calls];
    for (const action of [() => repo.get(ID), () => repo.commit(h.payload), () => repo.journal.prepare('contact', h.payload, TIME),
      () => repo.journal.get(OP), () => repo.journal.cancel(OP), () => repo.journal.listHistoryPage('contact')]) await assert.rejects(action());
    assert.deepEqual(h.calls, before); assert.equal(h.rows.size, 0);
  }
});

test('snapshot callbacks cannot replace same-UID user and then schedule another SDK action', async () => {
  for (const boundary of ['member-exists', 'member-data', 'record-exists', 'record-data', 'page-data', 'transaction-exists', 'transaction-data']) {
    const h = await harness(), repo = await h.service.createFirebaseCloudContacts(h.auth);
    await repo.journal.prepare('contact', h.payload, TIME); h.rows.set(`clinics/main/contactRecords/${ID}`, h.toRealm(syntheticRecord()));
    h.hooks[boundary] = () => { h.auth.currentUser = { ...h.user }; };
    const writes = h.calls.filter(call => call.startsWith('set:')).length;
    const action = boundary === 'page-data' ? () => repo.listPage()
      : boundary.startsWith('transaction') ? () => repo.journal.cancel(OP) : () => repo.get(ID);
    await assert.rejects(action()); assert.equal(h.calls.filter(call => call.startsWith('set:')).length, writes);
    h.auth.currentUser = h.user; delete h.hooks[boundary]; const before = [...h.calls];
    await assert.rejects(repo.journal.get(OP)); assert.deepEqual(h.calls, before);
  }
});

test('strict operating app and UUID fences reject invalid versions and trailing line terminators before SDK calls', async () => {
  for (const appName of [`clinic-operating-${ID}\n`, 'clinic-operating-10000000-0000-1000-8000-000000000001',
    'clinic-operating-10000000-0000-4000-0000-000000000001']) {
    const h = await harness({ appName }); await assert.rejects(h.service.createFirebaseCloudContacts(h.auth)); assert.deepEqual(h.calls, []);
  }
  const h = await harness(), repo = await h.service.createFirebaseCloudContacts(h.auth);
  for (const suffix of ['\n', '\r', '\u2028']) {
    const before = [...h.calls]; await assert.rejects(repo.journal.get(OP + suffix)); await assert.rejects(repo.journal.cancel(OP + suffix));
    await assert.rejects(repo.journal.listHistoryPage('contact', h.toRealm({ afterId: OP + suffix })));
    assert.deepEqual(h.calls, before);
  }
});

test('SDK cancellation race has one atomic winner and leaves no orphan reservation or receipt', async () => {
  for (const reverse of [false, true]) {
    const h = await harness(), repo = await h.service.createFirebaseCloudContacts(h.auth);
    await repo.journal.prepare('contact', h.payload, TIME);
    const actions = [() => repo.commit(h.payload), () => repo.journal.cancel(OP)]; if (reverse) actions.reverse();
    const results = await Promise.allSettled(actions.map(action => action()));
    assert.equal(results.filter(value => value.status === 'fulfilled').length, 1);
    const committed = h.rows.get(`clinics/main/operationIntents/${OP}`).status === 'committed';
    assert.equal(h.rows.has(`clinics/main/contactOperations/${OP}`), committed);
    assert.equal(h.rows.has(`clinics/main/contactRecords/${ID}`), committed);
    assert.equal([...h.rows.keys()].some(path => path.startsWith('clinics/main/contactPhones/')), committed);
  }
});

test('SDK historical replay after newer update and tombstone never reclaims a phone now held by another contact', async () => {
  const h = await harness(), repo = await h.service.createFirebaseCloudContacts(h.auth);
  const updateId = '20000000-0000-4000-8000-000000000002', deleteId = '20000000-0000-4000-8000-000000000003';
  const otherId = '20000000-0000-4000-8000-000000000004';
  await repo.journal.prepare('contact', h.payload, TIME); await repo.commit(h.payload);
  const update = h.toRealm({ ...h.payload, operationId: updateId, expectedRevision: 1, action: 'update',
    contact: { ...h.payload.contact, mobile: '01000000002' } });
  await repo.journal.prepare('contact', update, TIME); await repo.commit(update);
  const remove = h.toRealm({ ...h.payload, operationId: deleteId, expectedRevision: 2, action: 'delete', contact: null });
  await repo.journal.prepare('contact', remove, TIME); await repo.commit(remove);
  const other = h.toRealm({ ...h.payload, operationId: otherId, recordId: OTHER,
    contact: { ...h.payload.contact, id: OTHER, mobile: '01000000002' } });
  await repo.journal.prepare('contact', other, TIME); await repo.commit(other);
  const before = structuredClone(h.rows), callStart = h.calls.length;
  assert.equal((await repo.commit(update)).status, 'already-committed');
  assert.deepEqual(structuredClone(h.rows), before);
  assert.equal(h.rows.get(`clinics/main/contactRecords/${ID}`).deleted, true);
  const lastCalls = h.calls.slice(callStart);
  assert.equal(lastCalls.some(call => call.startsWith('set:') || call.startsWith('delete:')
    || call.startsWith('get:clinics/main/contactPhones/') || call.startsWith('get:clinics/main/contactRecords/')), false);
});
