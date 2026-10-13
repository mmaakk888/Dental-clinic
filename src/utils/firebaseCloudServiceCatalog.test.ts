import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';

// Actual pure repositories with a synthetic SDK only: no IAM, network, browser
// clinic data, live Rules, owner password or two-device acceptance.
const ID = '10000000-0000-4000-8000-000000000001';
const OP = '20000000-0000-4000-8000-000000000001';
const OP2 = '20000000-0000-4000-8000-000000000002';
const ITEM = '30000000-0000-4000-8000-000000000001';
const UID = 'synthetic-catalog-sdk-owner';
const PROJECT = 'dental-clinic-mmaakk888';
const WHEN = '2026-10-11T00:00:00.000Z';
const CATALOG = 'clinics/main/settings/serviceCatalog';
const path = (kind: string, id: string = OP) => `clinics/main/${kind}/${id}`;
let bundle: ReturnType<typeof build> | undefined, rawBundle: ReturnType<typeof build> | undefined;
function compiled(raw: boolean) {
  const options = { entryPoints: ['src/utils/firebaseCloudServiceCatalog.ts'], bundle: true, write: false, metafile: true,
    platform: 'node' as const, format: 'cjs' as const, supported: { 'dynamic-import': false }, logLevel: 'silent' as const };
  if (raw) return rawBundle ??= build({ ...options, external: ['firebase/*', './cloudServiceCatalogRepository', './cloudOperationIntent'] });
  return bundle ??= build({ ...options, external: ['firebase/*'] });
}
type Boundary = 'database' | 'token' | 'member-doc' | 'member' | 'member-exists' | 'member-data'
  | 'record-doc' | 'record' | 'record-exists' | 'record-data' | 'where' | 'document-id' | 'order' | 'after'
  | 'limit' | 'collection' | 'query' | 'page' | 'page-docs' | 'page-id' | 'page-data'
  | 'transaction-start' | 'transaction-read' | 'transaction-exists' | 'transaction-data' | 'transaction-write' | 'transaction-ack';
type Options = {
  hostname?: string; projectId?: string; authDomain?: string; appName?: string; emulator?: boolean;
  verified?: boolean; tokenVerified?: boolean; claims?: Record<string, unknown>; provider?: string;
  member?: Record<string, unknown>; missingMember?: boolean; denyRead?: boolean; denyWrite?: boolean;
  lostReply?: boolean; retryOnce?: boolean; stopAt?: Boundary; swapAt?: Boundary; raw?: boolean; tokenGate?: Promise<void>;
};
async function harness(options: Options = {}) {
  const output = await compiled(!!options.raw), module = { exports: {} as any }, calls: string[] = [];
  const user = { uid: UID, email: 'catalog-owner@example.invalid', emailVerified: options.verified ?? true };
  const location = { hostname: options.hostname ?? '127.0.0.1' };
  const auth = { app: { name: options.appName ?? `clinic-operating-${ID}`, options: {
    projectId: options.projectId ?? PROJECT, authDomain: options.authDomain ?? `${PROJECT}.firebaseapp.com` } },
    emulatorConfig: options.emulator ? {} : null, currentUser: user as typeof user | null };
  const rows = new Map<string, any>(), active = { value: true };
  const rawAdapters: { catalog?: any; journal?: any } = {};
  let copy!: (value: unknown) => any;
  const step = (boundary: Boundary) => {
    calls.push(boundary);
    if (options.stopAt === boundary) active.value = false;
    if (options.swapAt === boundary) auth.currentUser = { ...user };
  };
  const snapshot = (key: string, kind: 'record' | 'transaction', source = rows) => ({
    exists: () => { step(`${kind}-exists`); return source.has(key); },
    data: () => { step(`${kind}-data`); return source.get(key); },
  });
  const scope = { module, exports: module.exports, TextEncoder, crypto: webcrypto,
    window: { location,
      get localStorage() { throw new Error('PRIVATE_LOCAL_CLINIC_READ'); },
      get sessionStorage() { throw new Error('PRIVATE_LOCAL_SESSION_READ'); } },
    get localStorage() { throw new Error('PRIVATE_LOCAL_CLINIC_READ'); },
    get sessionStorage() { throw new Error('PRIVATE_LOCAL_SESSION_READ'); },
    fetch: () => { throw new Error('PRIVATE_REAL_NETWORK_FORBIDDEN'); },
    require: (name: string) => {
      calls.push(`import:${name}`);
      if (name === './cloudServiceCatalogRepository' && options.raw) return {
        createCloudServiceCatalogRepository: (adapter: unknown) => { rawAdapters.catalog = adapter; return adapter; },
        CloudServiceCatalogError: class extends Error { constructor(public code: string) { super(`SAFE_CATALOG_${code}`); } },
      };
      if (name === './cloudOperationIntent' && options.raw) return {
        createCloudOperationIntentRepository: (adapter: unknown) => { rawAdapters.journal = adapter; return adapter; },
        CloudOperationIntentError: class extends Error { constructor(public code: string) { super(`SAFE_INTENT_${code}`); } },
      };
      if (name === 'firebase/auth') return {
        getIdTokenResult: async (target: unknown) => {
          assert.equal(target, user); step('token'); await options.tokenGate;
          return { signInProvider: options.provider ?? 'password', claims: copy({
            sub: UID, aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, email: user.email,
            email_verified: options.tokenVerified ?? true, dentalClinicId: 'main', dentalClinicRole: 'owner', auth_time: 100,
            ...options.claims,
          }) };
        },
      };
      if (name === 'firebase/firestore/lite') return {
        getFirestore: (app: unknown, databaseId: string) => {
          assert.equal(app, auth.app); assert.equal(databaseId, '(default)'); step('database'); return 'synthetic-catalog-db';
        },
        doc: (db: unknown, ...parts: string[]) => {
          assert.equal(db, 'synthetic-catalog-db'); const key = parts.join('/');
          step(key.startsWith('clinics/main/members/') ? 'member-doc' : 'record-doc'); calls.push(`doc:${key}`); return key;
        },
        getDoc: async (key: string) => {
          if (!key.startsWith('clinics/main/members/')) {
            calls.push(`read:${key}`); step('record');
            if (options.denyRead) throw new Error('PRIVATE_SDK_READ_DENIED');
            return snapshot(key, 'record');
          }
          assert.equal(key, path('members', UID)); step('member');
          return { exists: () => { step('member-exists'); return !options.missingMember; },
            data: () => { step('member-data'); return copy({ schemaVersion: 1, clinicId: 'main', uid: UID,
              role: 'owner', status: 'active', identityVersion: 1, verifiedAfter: 100, ...options.member }); } };
        },
        collection: (db: unknown, ...parts: string[]) => { assert.equal(db, 'synthetic-catalog-db'); step('collection'); return parts.join('/'); },
        documentId: () => { step('document-id'); return '__name__'; },
        orderBy: (field: string) => { step('order'); return { kind: 'order', field }; },
        where: (field: string, operator: string, value: string) => { step('where'); return { kind: 'where', field, operator, value }; },
        startAfter: (id: string) => { step('after'); return { kind: 'after', id }; },
        limit: (count: number) => { step('limit'); return { kind: 'limit', count }; },
        query: (key: string, ...constraints: any[]) => { calls.push(`query:${key}:${JSON.stringify(constraints)}`); step('query'); return { key, constraints }; },
        getDocs: async (request: any) => {
          assert.equal(request.key, 'clinics/main/operationIntents');
          const predicates = request.constraints.filter((value: any) => value.kind === 'where');
          assert.deepEqual(predicates, [
            { kind: 'where', field: 'actorUid', operator: '==', value: UID },
            { kind: 'where', field: 'kind', operator: '==', value: 'catalog' },
            ...(predicates.length === 2 ? [] : [{ kind: 'where', field: 'status', operator: '==', value: 'prepared' }]),
          ]);
          assert.deepEqual(request.constraints.find((value: any) => value.kind === 'order'), { kind: 'order', field: '__name__' });
          assert.equal(request.constraints.at(-1).kind, 'limit');
          const count = request.constraints.at(-1).count;
          assert.ok(Number.isSafeInteger(count) && count >= 1 && count <= 50);
          const after = request.constraints.find((value: any) => value.kind === 'after')?.id;
          step('page'); if (options.denyRead) throw new Error('PRIVATE_SDK_PAGE_DENIED');
          const values = [...rows].filter(([key, value]) => key.startsWith(`${request.key}/`)
            && (!after || key.split('/').at(-1)! > after) && predicates.every((p: any) => value[p.field] === p.value))
            .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).slice(0, count);
          return { get docs() { step('page-docs'); return values.map(([key, value]) => ({
            get id() { step('page-id'); return key.split('/').at(-1); },
            data: () => { step('page-data'); return value; },
          })); } };
        },
        runTransaction: async (db: unknown, work: any, settings: any) => {
          assert.equal(db, 'synthetic-catalog-db'); assert.equal(settings.maxAttempts, 5); step('transaction-start');
          const attempt = async (publish: boolean) => {
            const staged = new Map(rows); let wrote = false;
            const result = await work({
              get: async (key: string) => { assert.equal(wrote, false, 'all reads precede writes'); calls.push(`get:${key}`); step('transaction-read'); return snapshot(key, 'transaction', staged); },
              set: (key: string, value: unknown) => {
                wrote = true; if (options.denyWrite) throw new Error('PRIVATE_SDK_WRITE_DENIED');
                calls.push(`set:${key}`); staged.set(key, value); step('transaction-write');
              },
            });
            if (publish) { rows.clear(); for (const [key, value] of staged) rows.set(key, value); }
            return result;
          };
          if (options.retryOnce) { options.retryOnce = false; await attempt(false); }
          const result = await attempt(true); step('transaction-ack');
          if (options.lostReply) { options.lostReply = false; throw new Error('PRIVATE_SDK_LOST_REPLY'); }
          return result;
        },
      };
      throw new Error(`PRIVATE_UNEXPECTED_IMPORT_${name}`);
    },
  };
  runInNewContext(output.outputFiles![0].text, scope);
  copy = runInNewContext('(value) => JSON.parse(JSON.stringify(value))', scope);
  const payload = copy({ mutationVersion: 2, action: 'examination', operationId: OP, expectedRevision: 0, createdAt: WHEN, examinationCents: 10_000 });
  return { service: module.exports, auth, user, calls, rows, payload, compiled: output, active, copy, location, options, rawAdapters };
}
const failed = (error: any) => ['invalid', 'unavailable', 'conflict'].includes(error?.code) && !String(error).includes('PRIVATE');
const safe = (error: unknown) => /SAFE_(CATALOG|INTENT)_(invalid|unavailable|conflict)/.test(String(error)) && !String(error).includes('PRIVATE');
async function capability(h: Awaited<ReturnType<typeof harness>>) {
  return h.service.createFirebaseCloudServiceCatalog(h.auth, { isActive: () => h.active.value });
}
async function prepared(h: Awaited<ReturnType<typeof harness>>, value?: any) {
  const service = await capability(h); await service.journal.prepare('catalog', value ?? h.payload, WHEN); return service;
}

test('catalog SDK import is inert and its graph excludes App, UI, clinical records, local storage and backup configuration', async () => {
  const h = await harness(); assert.deepEqual(h.calls, []); assert.equal(h.rows.size, 0);
  assert.equal(Object.keys(h.compiled.metafile!.inputs).some(key => /utils\/(?:storage|localClinicBackup|firebaseService|offlineSync|cloudClinicalRepository)|App\.tsx|components\//.test(key)), false);
});

test('catalog factory requires an active lease, exact operating app/project/domain and loopback without an Auth emulator', async () => {
  for (const options of [{ hostname: 'public.example.invalid' }, { projectId: 'zippy-dispatcher-m1ttq' },
    { authDomain: 'other.firebaseapp.com' }, { appName: '[DEFAULT]' }, { appName: `clinic-owner-setup-${ID}` },
    { appName: `clinic-operating-${ID}\n` }, { appName: 'clinic-operating-00000000-0000-0000-0000-000000000000' }, { emulator: true }]) {
    const h = await harness(options); await assert.rejects(capability(h), failed); assert.deepEqual(h.calls, []);
  }
  for (const options of [undefined, {}, { isActive: () => false }, { isActive: () => { throw new Error('PRIVATE_LEASE'); } }]) {
    const h = await harness(); await assert.rejects(h.service.createFirebaseCloudServiceCatalog(h.auth, options), failed); assert.deepEqual(h.calls, []);
  }
});

test('catalog construction imports Lite lazily in the named default db but never authorizes, reads, creates defaults or writes', async () => {
  const h = await harness(), service = await capability(h);
  assert.deepEqual(h.calls, ['import:firebase/auth', 'import:firebase/firestore/lite', 'database']);
  assert.deepEqual(Object.keys(service).sort(), ['journal', 'repository']);
  assert.deepEqual(Object.keys(service.repository).sort(), ['commit', 'get']); assert.equal(h.rows.size, 0);
  assert.equal(Object.isFrozen(service), true); assert.equal(Object.isFrozen(service.repository), true);
});

test('missing catalog is null rather than guessed prices or a default write, with fresh authorization around every read', async () => {
  const h = await harness(), service = await capability(h);
  assert.equal(await service.repository.get(), null); assert.equal(h.rows.size, 0);
  assert.equal(h.calls.filter(call => call === 'token').length, 3);
  assert.equal(h.calls.filter(call => call === 'member').length, 3);
  assert.deepEqual(h.calls.filter(call => call.startsWith('read:')), [`read:${CATALOG}`]);
});

test('catalog commit requires a durable intent, atomically writes only settings/receipt/intent, and replay never duplicates', async () => {
  const h = await harness(), service = await capability(h);
  await assert.rejects(service.repository.commit(h.payload), failed); assert.equal(h.rows.size, 0);
  await service.journal.prepare('catalog', h.payload, WHEN);
  assert.equal((await service.repository.commit(h.payload)).status, 'committed');
  assert.deepEqual([...h.rows.keys()].sort(), [CATALOG, path('catalogOperations'), path('operationIntents')].sort());
  assert.equal(h.rows.get(CATALOG).revision, 1); assert.equal(h.rows.get(CATALOG).data.examinationCents, 10_000);
  assert.equal(h.rows.get(path('operationIntents')).status, 'committed');
  const writes = h.calls.filter(call => call.startsWith('set:')).length;
  assert.equal((await service.repository.commit(h.payload)).status, 'already-committed');
  assert.equal(h.calls.filter(call => call.startsWith('set:')).length, writes);
  assert.deepEqual((await service.repository.get()).data.services, h.copy([]));
});

test('owner authorization rejects unverified/nonpassword/wrong claims or malformed canonical membership without data reads', async () => {
  for (const options of [{ verified: false }, { tokenVerified: false }, { provider: 'google.com' },
    { claims: { dentalClinicRole: 'secretary' } }, { claims: { dentalClinicId: 'other' } },
    { claims: { sub: 'another-owner' } }, { claims: { aud: 'another-project' } },
    { claims: { auth_time: 99 } }, { missingMember: true }, { member: { status: 'disabled' } },
    { member: { uid: 'another-owner' } }, { member: { role: 'secretary' } },
    { member: { verifiedAfter: 101 } }, { member: { extra: true } }]) {
    const h = await harness(options), service = await capability(h);
    await assert.rejects(service.repository.get(), failed);
    assert.equal(h.calls.some(call => call.startsWith('read:') || call.startsWith('get:') || call.startsWith('set:')), false);
  }
});

test('catalog input snapshots before an awaited owner check and never commits later edits from the caller', async () => {
  const h = await harness(), service = await prepared(h);
  let release!: () => void; h.options.tokenGate = new Promise<void>(resolve => { release = resolve; });
  const pending = service.repository.commit(h.payload);
  h.payload.examinationCents = 999; release();
  assert.equal((await pending).status, 'committed');
  assert.equal(h.rows.get(CATALOG).data.examinationCents, 10_000);
  assert.equal(h.rows.get(CATALOG).data.services.length, 0);
});

test('journal preparation snapshots the complete catalog command and rejects generic/wrong-domain/timestamp input before SDK access', async () => {
  const h = await harness(), service = await capability(h), before = [...h.calls];
  for (const value of [{ operationId: OP }, { ...h.payload, unknown: true }, { ...h.payload, expectedRevision: -1 },
    { ...h.payload, examinationCents: -1 }]) await assert.rejects(service.journal.prepare('catalog', h.copy(value), WHEN), failed);
  for (const kind of ['clinical', 'contact', 'patient-profile', 'unknown']) await assert.rejects(service.journal.prepare(kind, h.payload, WHEN), failed);
  await assert.rejects(service.journal.prepare('catalog', h.payload, '2026-10-11T00:00:01.000Z'), failed);
  assert.deepEqual(h.calls, before);
  let release!: () => void; h.options.tokenGate = new Promise<void>(resolve => { release = resolve; });
  const pending = service.journal.prepare('catalog', h.payload, WHEN);
  h.payload.examinationCents = 123; release();
  assert.equal((await pending).command.examinationCents, 10_000);
});

test('catalog compare-and-swap rejects stale new commands without changing current prices, receipts or prepared intent', async () => {
  const h = await harness(), service = await prepared(h); await service.repository.commit(h.payload);
  const stale = h.copy({ ...h.payload, operationId: OP2, examinationCents: 50_000 });
  await service.journal.prepare('catalog', stale, WHEN); const writes = h.calls.filter(call => call.startsWith('set:')).length;
  await assert.rejects(service.repository.commit(stale), (error: any) => error.code === 'conflict');
  assert.equal(h.calls.filter(call => call.startsWith('set:')).length, writes);
  assert.equal(h.rows.get(CATALOG).data.examinationCents, 10_000);
  assert.equal(h.rows.get(path('operationIntents', OP2)).status, 'prepared'); assert.equal(h.rows.has(path('catalogOperations', OP2)), false);
});

test('catalog recovery queries bind actor/kind/prepared status with bounded exclusive UUID cursors and default25', async () => {
  const h = await harness(), service = await prepared(h);
  await service.journal.prepare('catalog', h.copy({ ...h.payload, operationId: OP2 }), WHEN);
  const first = await service.journal.listPreparedPage('catalog', h.copy({ limit: 1 }));
  assert.equal(first.records[0].operationId, OP); assert.equal(first.nextAfterId, OP);
  const second = await service.journal.listPreparedPage('catalog', h.copy({ afterId: OP, limit: 1 })); assert.equal(second.records[0].operationId, OP2);
  await service.journal.cancel(OP2); await service.repository.commit(h.payload);
  assert.equal((await service.journal.listPreparedPage('catalog')).records.length, 0);
  assert.ok(h.calls.some(call => call.startsWith('query:') && call.includes('"count":25')));
});

test('all-status history rediscovers accepted lost-ACK catalog commits after a new capability and replays the original operation', async () => {
  const h = await harness(), first = await prepared(h); h.options.lostReply = true;
  await assert.rejects(first.repository.commit(h.payload), failed);
  const fresh = await capability(h); assert.equal((await fresh.journal.listPreparedPage('catalog')).records.length, 0);
  const history = await fresh.journal.listHistoryPage('catalog', h.copy({ limit: 1 }));
  assert.equal(history.records[0].status, 'committed'); assert.equal(history.records[0].operationId, OP);
  assert.equal(history.nextAfterId, OP);
  const writes = h.calls.filter(call => call.startsWith('set:')).length;
  assert.equal((await fresh.repository.commit(history.records[0].command)).status, 'already-committed');
  assert.equal(h.calls.filter(call => call.startsWith('set:')).length, writes); assert.equal(h.rows.get(CATALOG).revision, 1);
  assert.equal((await fresh.journal.listHistoryPage('catalog', h.copy({ afterId: OP, limit: 1 }))).records.length, 0);
});

test('catalog history includes cancelled commands but excludes other owners/domains without any private data query', async () => {
  const h = await harness(), service = await prepared(h); await service.journal.cancel(OP);
  for (const [id, actorUid, kind] of [[OP2, 'other-owner', 'catalog'], [ITEM, UID, 'clinical']]) {
    h.rows.set(path('operationIntents', id), h.copy({ ...h.rows.get(path('operationIntents')), recordId: id, operationId: id, actorUid, kind }));
  }
  const history = await service.journal.listHistoryPage('catalog');
  assert.equal(history.records.length, 1); assert.equal(history.records[0].status, 'cancelled');
  assert.equal(h.calls.some(call => /doc:.*(?:clinicalOperations|patientOperations|contactOperations|patientAccounts|labCosts)/.test(call)), false);
});

test('catalog history and prepared-page query arguments are snapshotted before authorization and malformed pages fail closed', async () => {
  const h = await harness(), service = await prepared(h);
  for (const method of ['listPreparedPage', 'listHistoryPage']) {
    const input = h.copy({ afterId: null, limit: 1 }); let release!: () => void;
    h.options.tokenGate = new Promise<void>(resolve => { release = resolve; });
    const pending = service.journal[method]('catalog', input); input.limit = 50; input.afterId = OP; release();
    assert.equal((await pending).records.length, 1);
  }
  const before = [...h.calls];
  for (const method of ['listPreparedPage', 'listHistoryPage']) {
    for (const input of [{ limit: 0 }, { limit: 51 }, { limit: 1.5 }, { afterId: OP + '\n' }, { unexpected: true }]) {
      await assert.rejects(service.journal[method]('catalog', h.copy(input)), failed);
    }
    for (const kind of ['contact', 'clinical', 'patient-profile']) await assert.rejects(service.journal[method](kind), failed);
  }
  assert.deepEqual(h.calls, before);
});

test('lost preparation acknowledgement remains server-discoverable and a fresh capability resumes that exact command', async () => {
  const h = await harness({ lostReply: true }), first = await capability(h);
  await assert.rejects(first.journal.prepare('catalog', h.payload, WHEN), failed);
  assert.equal(h.rows.get(path('operationIntents')).status, 'prepared'); assert.equal(h.rows.has(CATALOG), false);
  const fresh = await capability(h), recovered = (await fresh.journal.listHistoryPage('catalog')).records[0];
  assert.equal((await fresh.repository.commit(recovered.command)).status, 'committed'); assert.equal(h.rows.get(CATALOG).revision, 1);
});

test('transaction callback retry plus new-capability replay cannot increment the catalog revision twice', async () => {
  const h = await harness(), first = await prepared(h); h.options.retryOnce = true;
  await first.repository.commit(h.payload);
  const fresh = await capability(h), recovered = await fresh.journal.get(OP);
  assert.equal(recovered.status, 'committed'); assert.equal((await fresh.repository.commit(recovered.command)).status, 'already-committed');
  assert.equal(h.rows.get(CATALOG).revision, 1); assert.equal([...h.rows.keys()].filter(key => key.startsWith('clinics/main/catalogOperations/')).length, 1);
});

test('catalog cancellation validates exact domain receipt and cannot cancel a committed operation', async () => {
  const h = await harness(), service = await prepared(h); await service.repository.commit(h.payload);
  const writes = h.calls.filter(call => call.startsWith('set:')).length;
  await assert.rejects(service.journal.cancel(OP), failed);
  assert.equal(h.calls.filter(call => call.startsWith('set:')).length, writes);
  assert.equal(h.rows.get(path('operationIntents')).status, 'committed');
  assert.equal(h.calls.some(call => call === `get:${path('catalogOperations')}`), true);
});

test('stored generic/foreign/malformed catalog intents are never exposed or cancelled as hidden writes', async () => {
  for (const mutation of ['command', 'createdAt', 'kind', 'actorUid', 'path']) {
    for (const action of ['get', 'prepared', 'history', 'cancel']) {
      const h = await harness(), service = await prepared(h), intent = h.rows.get(path('operationIntents'));
      if (mutation === 'command') intent.command = h.copy({ operationId: OP, invalid: true });
      if (mutation === 'createdAt') intent.command.createdAt = '2026-10-11T00:00:01.000Z';
      if (mutation === 'kind') intent.kind = 'clinical';
      if (mutation === 'actorUid') intent.actorUid = 'other-owner';
      if (mutation === 'path') { intent.recordId = OP2; intent.operationId = OP2; intent.command.operationId = OP2; }
      intent.requestHash = createHash('sha256').update(JSON.stringify(['clinic-operation-intent-v1', intent.actorUid, intent.kind, intent.command])).digest('hex');
      const writes = h.calls.filter(call => call.startsWith('set:')).length;
      // Other-kind/owner records are query-filtered out, never returned as catalog history.
      if (['prepared', 'history'].includes(action) && ['kind', 'actorUid'].includes(mutation)) {
        assert.equal((await service.journal[action === 'prepared' ? 'listPreparedPage' : 'listHistoryPage']('catalog')).records.length, 0);
      } else await assert.rejects(action === 'get' ? service.journal.get(OP) : action === 'cancel' ? service.journal.cancel(OP)
        : service.journal[action === 'prepared' ? 'listPreparedPage' : 'listHistoryPage']('catalog'), failed);
      assert.equal(h.calls.filter(call => call.startsWith('set:')).length, writes); assert.equal(intent.status, 'prepared');
    }
  }
});

test('malformed persisted catalog prices never become null, guessed defaults or a successful commit', async () => {
  const h = await harness(), service = await prepared(h); await service.repository.commit(h.payload);
  h.rows.get(CATALOG).data.examinationCents = -1;
  await assert.rejects(service.repository.get(), failed);
  const newer = h.copy({ ...h.payload, operationId: OP2, expectedRevision: 1 }); await service.journal.prepare('catalog', newer, WHEN);
  const writes = h.calls.filter(call => call.startsWith('set:')).length; await assert.rejects(service.repository.commit(newer), failed);
  assert.equal(h.calls.filter(call => call.startsWith('set:')).length, writes);
});

test('SDK read/write denials expose fixed errors without local fallback or successful empty results', async () => {
  const h = await harness({ denyRead: true }), service = await capability(h);
  for (const action of [() => service.repository.get(), () => service.journal.get(OP),
    () => service.journal.listPreparedPage('catalog'), () => service.journal.listHistoryPage('catalog')]) await assert.rejects(action(), failed);
  const denied = await harness({ denyWrite: true }), writer = await capability(denied);
  await assert.rejects(writer.journal.prepare('catalog', denied.payload, WHEN), failed); assert.equal(denied.rows.size, 0);
});

test('catalog read checks every owner/read snapshot boundary and permanently revokes after lease loss', async () => {
  for (const stopAt of ['token', 'member-doc', 'member', 'member-exists', 'member-data', 'record-doc', 'record', 'record-exists', 'record-data'] as Boundary[]) {
    const h = await harness(), service = await prepared(h); await service.repository.commit(h.payload); h.options.stopAt = stopAt;
    await assert.rejects(service.repository.get(), failed);
    h.active.value = true; h.options.stopAt = undefined; const before = [...h.calls];
    await assert.rejects(service.repository.get(), failed); assert.deepEqual(h.calls, before);
  }
});

test('catalog recovery page stops at every query/snapshot boundary before any subsequent SDK operation', async () => {
  for (const method of ['listPreparedPage', 'listHistoryPage']) {
    for (const stopAt of ['where', 'document-id', 'order', 'after', 'limit', 'collection', 'query', 'page', 'page-docs', 'page-id', 'page-data'] as Boundary[]) {
      const h = await harness(), service = await prepared(h); h.options.stopAt = stopAt;
      await assert.rejects(service.journal[method]('catalog', h.copy({ afterId: ID })), failed);
      const stop = h.calls.lastIndexOf(stopAt); assert.ok(stop !== -1, stopAt); assert.equal(h.calls.length, stop + 1);
    }
  }
});

test('catalog transactions guard all read/write/ack boundaries and never claim server undo after accepted writes', async () => {
  for (const stopAt of ['transaction-start', 'transaction-read', 'transaction-exists', 'transaction-data', 'transaction-write', 'transaction-ack'] as Boundary[]) {
    const h = await harness(), service = await prepared(h); h.options.stopAt = stopAt;
    await assert.rejects(service.repository.commit(h.payload), failed);
    assert.equal(h.rows.has(CATALOG), stopAt === 'transaction-ack');
    assert.equal(h.rows.get(path('operationIntents')).status, stopAt === 'transaction-ack' ? 'committed' : 'prepared');
  }
});

test('promises scheduled immediately before revocation own their rejection without leaking an unhandled private SDK error', async () => {
  for (const stopAt of ['record', 'page'] as Boundary[]) {
    const h = await harness({ denyRead: true, stopAt }), service = await capability(h);
    await assert.rejects(stopAt === 'record' ? service.repository.get() : service.journal.listHistoryPage('catalog'), failed);
    await Promise.resolve(); await Promise.resolve(); assert.equal(h.rows.size, 0);
  }
});

test('every retained catalog/journal action permanently stops SDK work after logout/runtime/lease loss', async () => {
  for (const change of ['logout', 'runtime', 'lease']) {
    const h = await harness(), service = await prepared(h), before = [...h.calls];
    if (change === 'logout') h.auth.currentUser = null;
    if (change === 'runtime') h.location.hostname = 'public.example.invalid';
    if (change === 'lease') h.active.value = false;
    for (const action of [() => service.repository.get(), () => service.repository.commit(h.payload),
      () => service.journal.prepare('catalog', h.payload, WHEN), () => service.journal.get(OP),
      () => service.journal.listPreparedPage('catalog'), () => service.journal.listHistoryPage('catalog'),
      () => service.journal.cancel(OP)]) await assert.rejects(action(), failed);
    assert.deepEqual(h.calls, before);
  }
});

test('same-UID identity replacement permanently revokes at authorization/read/page/transaction boundaries', async () => {
  for (const swapAt of ['token', 'member-doc', 'member', 'member-exists', 'member-data', 'record-doc', 'record', 'record-exists', 'record-data',
    'query', 'page-docs', 'page-id', 'page-data', 'transaction-read', 'transaction-data', 'transaction-write', 'transaction-ack'] as Boundary[]) {
    const h = await harness(), service = await prepared(h); h.options.swapAt = swapAt;
    const action = swapAt.startsWith('transaction') ? () => service.repository.commit(h.payload)
      : ['query', 'page-docs', 'page-id', 'page-data'].includes(swapAt) ? () => service.journal.listHistoryPage('catalog') : () => service.journal.get(OP);
    await assert.rejects(action(), failed); assert.equal(h.rows.has(CATALOG), swapAt === 'transaction-ack');
    h.auth.currentUser = h.user; h.options.swapAt = undefined; const before = [...h.calls];
    await assert.rejects(service.repository.get(), failed); assert.deepEqual(h.calls, before);
  }
});

test('exact app object and UID remain captured even when a replacement has identical visible project/domain/UID', async () => {
  for (const change of ['app-object', 'project', 'uid']) {
    const h = await harness(), service = await capability(h), originalApp = h.auth.app;
    if (change === 'app-object') h.auth.app = { ...originalApp, options: { ...originalApp.options } };
    if (change === 'project') h.auth.app.options.projectId = 'another-project';
    if (change === 'uid') h.user.uid = 'another-owner';
    const before = [...h.calls]; await assert.rejects(service.repository.get(), failed);
    h.auth.app = originalApp; originalApp.options.projectId = PROJECT; h.user.uid = UID;
    await assert.rejects(service.journal.get(OP), failed); assert.deepEqual(h.calls, before);
  }
  const stopped = await harness({ stopAt: 'database' }); await assert.rejects(capability(stopped), failed);
});

test('initial Auth getter failures expose fixed factory errors without importing SDK or retaining private details', async () => {
  for (const key of ['currentUser', 'app']) {
    const h = await harness(); Object.defineProperty(h.auth, key, { get() { throw new Error('PRIVATE_AUTH_GETTER'); } });
    await assert.rejects(capability(h), failed); assert.deepEqual(h.calls, []);
  }
});

test('raw transaction fences reject every patient/contact/clinical/lab/counter/member/arbitrary settings path before SDK document access', async () => {
  const h = await harness({ raw: true }); await capability(h); const adapter = h.rawAdapters.catalog;
  const forbidden = [path('members', UID), path('patientProfiles', ID), path('patientFiles', '451'), path('patientAccounts', ID),
    path('patientSessions', ID), path('patientReceipts', ID), path('clinicalOperations'), path('patientOperations'),
    path('contactRecords', ID), path('contactOperations'), path('labs', ID), path('labCosts', ID), path('counters', 'patientFiles'),
    path('expenses', ID), path('settings', 'identity'), CATALOG + '/extra', CATALOG + '\n',
    'clinics/other/settings/serviceCatalog', path('catalogOperations') + '\n', path('operationIntents') + '\n'];
  for (const key of forbidden) await assert.rejects(adapter.runTransaction((tx: any) => tx.get(key)), safe);
  for (const key of forbidden) await assert.rejects(adapter.runTransaction((tx: any) => tx.set(key, h.copy({}))), safe);
  assert.equal(h.calls.some(call => call.startsWith('get:') || call.startsWith('set:')), false);
});

test('raw direct-read fences expose only the catalog singleton or exact journal UUID, never domain operation receipts', async () => {
  const h = await harness({ raw: true }); await capability(h); const before = [...h.calls];
  for (const key of [path('operationIntents'), path('catalogOperations'), path('patientAccounts', ID), CATALOG + '\n', path('settings', 'other')]) {
    await assert.rejects(async () => h.rawAdapters.catalog.readRecord(key), safe);
  }
  for (const key of [CATALOG, path('catalogOperations'), path('patientProfiles', ID), path('operationIntents') + '\n']) {
    await assert.rejects(async () => h.rawAdapters.journal.readRecord(key), safe);
  }
  assert.deepEqual(h.calls, before);
});

test('raw query seams reject foreign kind/actor, malformed cursor and invalid bounds without constructing queries', async () => {
  const h = await harness({ raw: true }); await capability(h); const before = [...h.calls];
  for (const method of ['listPreparedPage', 'listHistoryPage']) {
    for (const args of [['clinical', UID, null, 25], ['catalog', 'another-owner', null, 25], ['catalog', UID, OP + '\n', 25],
      ['catalog', UID, null, 0], ['catalog', UID, null, 51], ['catalog', UID, null, 1.5], ['catalog', UID, undefined, 25]]) {
      await assert.rejects(async () => h.rawAdapters.journal[method](...args), safe);
    }
  }
  assert.deepEqual(h.calls, before);
});

test('raw intent transaction fence rejects foreign/malformed complete intent reads and writes before any mutation', async () => {
  const h = await harness({ raw: true }); await capability(h); h.rows.set(path('operationIntents'), h.copy({ kind: 'clinical' }));
  await assert.rejects(h.rawAdapters.catalog.runTransaction((tx: any) => tx.get(path('operationIntents'))), safe);
  for (const value of [{ kind: 'clinical' }, { kind: 'contact' }, { kind: 'patient-profile' }, {}]) {
    await assert.rejects(h.rawAdapters.catalog.runTransaction((tx: any) => tx.set(path('operationIntents'), h.copy(value))), safe);
  }
  assert.equal(h.calls.some(call => call.startsWith('set:')), false);
});

test('service mutation uses only exact ID/name reservation companions, preserves unrelated catalog data and retries historically', async () => {
  const h = await harness(), service = await prepared(h); await service.repository.commit(h.payload);
  const input = h.copy({ mutationVersion: 2, action: 'service', operationId: OP2, expectedRevision: 1, createdAt: WHEN, index: 0,
    service: { serviceId: ITEM, name: 'حشو عادي', kind: 'clinical', priceCents: 30000, active: true } });
  await service.journal.prepare('catalog', input, WHEN); await service.repository.commit(input);
  const key = createHash('sha256').update('catalog-service-name-v2:حشو عادي').digest('hex');
  assert.equal(h.rows.get(path('catalogServiceIds', ITEM)).index, 0);
  assert.equal(h.rows.get(path('catalogServiceNames', key)).serviceId, ITEM);
  assert.equal(h.rows.get(CATALOG).data.examinationCents, 10000);
  assert.equal(h.rows.get(CATALOG).data.services.length, 1);
  h.rows.delete(path('catalogServiceIds', ITEM)); h.rows.delete(path('catalogServiceNames', key));
  const before = h.calls.filter(call => call.startsWith('set:')).length;
  assert.equal((await service.repository.commit(input)).status, 'already-committed');
  assert.equal(h.calls.filter(call => call.startsWith('set:')).length, before);
});

test('SDK denies fresh legacy replacement, but exact trusted committed legacy history stays read-only', async () => {
  const h = await harness(), service = await capability(h);
  const legacy = h.copy({ operationId: OP, expectedRevision: 0, createdAt: WHEN, data: { examinationCents: 0, services: [] } });
  await assert.rejects(service.journal.prepare('catalog', legacy, WHEN), failed); assert.equal(h.rows.size, 0);
  const command = h.copy({ createdAt: WHEN, data: { examinationCents: 0, services: [] }, expectedRevision: 0, operationId: OP });
  h.rows.set(path('operationIntents'), h.copy({ schemaVersion: 1, clinicId: 'main', recordId: OP, operationId: OP, actorUid: UID,
    kind: 'catalog', status: 'committed', revision: 2, createdAt: WHEN, command,
    requestHash: createHash('sha256').update(JSON.stringify(['clinic-operation-intent-v1', UID, 'catalog', command])).digest('hex') }));
  h.rows.set(path('catalogOperations'), h.copy({ schemaVersion: 1, clinicId: 'main', operationId: OP, recordId: 'serviceCatalog', actorUid: UID,
    expectedRevision: 0, resultRevision: 1, createdAt: WHEN,
    requestHash: createHash('sha256').update(JSON.stringify(['clinic-service-catalog-v1', UID, legacy])).digest('hex') }));
  const before = h.calls.filter(call => call.startsWith('set:')).length;
  assert.equal((await service.journal.prepare('catalog', legacy, WHEN)).status, 'committed');
  assert.equal((await service.repository.commit(legacy)).status, 'already-committed');
  assert.equal(h.calls.filter(call => call.startsWith('set:')).length, before); assert.equal(h.rows.has(CATALOG), false);
});

test('routing remains read-only and reservation paths reject trailing text, noncanonical IDs and every arbitrary collection', async () => {
  const h = await harness({ raw: true }); await capability(h); const adapter = h.rawAdapters.catalog;
  for (const key of [path('settings', 'prostheticRouting'), path('catalogServiceIds', ITEM + '\n'),
    path('catalogServiceNames', 'a'.repeat(64) + '\n'), path('catalogServiceNames', 'a'.repeat(63)), path('serviceDefinitions', ITEM)]) {
    await assert.rejects(adapter.runTransaction((tx: any) => tx.set(key, {})), safe);
  }
  assert.equal(h.calls.some(call => call.startsWith('set:')), false);
});
