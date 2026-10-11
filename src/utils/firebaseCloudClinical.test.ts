import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';

// SDK stubs and fabricated identities only. No IAM, real Auth, browser records,
// network, production Rules or two-device acceptance is exercised here.
const ID = '10000000-0000-4000-8000-000000000001';
const OTHER = '10000000-0000-4000-8000-000000000002';
const OP = '20000000-0000-4000-8000-000000000001';
const OP2 = '20000000-0000-4000-8000-000000000002';
const ITEM = '30000000-0000-4000-8000-000000000001';
const UID = 'synthetic-clinical-sdk-owner';
const PROJECT = 'dental-clinic-mmaakk888';
const WHEN = '2026-10-11T00:00:00.000Z';
const DAY = '2026-10-11';
const path = (kind: string, id: string | number = ID) => `clinics/main/${kind}/${id}`;
const entry = 'src/utils/firebaseCloudClinical.ts';
let bundle: ReturnType<typeof build> | undefined;
let rawBundle: ReturnType<typeof build> | undefined;
function compiled(raw: boolean) {
  const options = { entryPoints: [entry], bundle: true, write: false, metafile: true,
    platform: 'node' as const, format: 'cjs' as const, supported: { 'dynamic-import': false }, logLevel: 'silent' as const };
  if (raw) return rawBundle ??= build({ ...options, external: ['firebase/*', './cloudClinicalRepository', './cloudOperationIntent'] });
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
  lostReply?: boolean; retryOnce?: boolean; stopAt?: Boundary; swapAt?: Boundary; raw?: boolean;
};
async function harness(options: Options = {}) {
  const output = await compiled(!!options.raw), module = { exports: {} as any }, calls: string[] = [];
  const user = { uid: UID, email: 'owner@example.invalid', emailVerified: options.verified ?? true };
  const location = { hostname: options.hostname ?? '127.0.0.1' };
  const auth = { app: { name: options.appName ?? `clinic-operating-${ID}`, options: {
    projectId: options.projectId ?? PROJECT, authDomain: options.authDomain ?? `${PROJECT}.firebaseapp.com` } },
    emulatorConfig: options.emulator ? {} : null, currentUser: user as typeof user | null };
  const rows = new Map<string, any>(), active = { value: true };
  const rawAdapters: { clinical?: any; journal?: any } = {};
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
      if (name === './cloudClinicalRepository' && options.raw) return {
        createCloudClinicalRepository: (adapter: unknown) => { rawAdapters.clinical = adapter; return adapter; },
        CloudClinicalError: class extends Error { constructor(public code: string) { super(`SAFE_CLINICAL_${code}`); } },
      };
      if (name === './cloudOperationIntent' && options.raw) return {
        createCloudOperationIntentRepository: (adapter: unknown) => { rawAdapters.journal = adapter; return adapter; },
        CloudOperationIntentError: class extends Error { constructor(public code: string) { super(`SAFE_INTENT_${code}`); } },
      };
      if (name === 'firebase/auth') return {
        getIdTokenResult: async (target: unknown) => {
          assert.equal(target, user); step('token');
          return { signInProvider: options.provider ?? 'password', claims: copy({
            sub: UID, aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, email: user.email,
            email_verified: options.tokenVerified ?? true, dentalClinicId: 'main', dentalClinicRole: 'owner', auth_time: 100,
            ...options.claims,
          }) };
        },
      };
      if (name === 'firebase/firestore/lite') return {
        getFirestore: (app: unknown, databaseId: string) => {
          assert.equal(app, auth.app); assert.equal(databaseId, '(default)'); step('database'); return 'synthetic-clinical-db';
        },
        doc: (db: unknown, ...parts: string[]) => {
          assert.equal(db, 'synthetic-clinical-db'); const key = parts.join('/');
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
        collection: (db: unknown, ...parts: string[]) => { assert.equal(db, 'synthetic-clinical-db'); step('collection'); return parts.join('/'); },
        documentId: () => { step('document-id'); return '__name__'; },
        orderBy: (field: string) => { step('order'); return { kind: 'order', field }; },
        where: (field: string, operator: string, value: string) => { step('where'); return { kind: 'where', field, operator, value }; },
        startAfter: (id: string) => { step('after'); return { kind: 'after', id }; },
        limit: (count: number) => { step('limit'); return { kind: 'limit', count }; },
        query: (key: string, ...constraints: any[]) => { calls.push(`query:${key}:${JSON.stringify(constraints)}`); step('query'); return { key, constraints }; },
        getDocs: async (request: any) => {
          assert.ok(['patientSessions', 'patientReceipts', 'operationIntents'].some(kind => request.key === path(kind, '').slice(0, -1)));
          const predicates = request.constraints.filter((value: any) => value.kind === 'where');
          assert.deepEqual(request.constraints.find((value: any) => value.kind === 'order'), { kind: 'order', field: '__name__' });
          assert.equal(request.constraints.at(-1).kind, 'limit');
          if (request.key === path('operationIntents', '').slice(0, -1)) assert.deepEqual(predicates, [
            { kind: 'where', field: 'actorUid', operator: '==', value: UID },
            { kind: 'where', field: 'kind', operator: '==', value: 'clinical' },
            { kind: 'where', field: 'status', operator: '==', value: 'prepared' },
          ]);
          else assert.deepEqual(predicates, [{ kind: 'where', field: 'patientId', operator: '==', value: ID }]);
          const after = request.constraints.find((value: any) => value.kind === 'after')?.id;
          step('page'); if (options.denyRead) throw new Error('PRIVATE_SDK_PAGE_DENIED');
          const values = [...rows].filter(([key, value]) => key.startsWith(`${request.key}/`)
            && (!after || key.split('/').at(-1)! > after) && predicates.every((p: any) => value[p.field] === p.value))
            .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).slice(0, request.constraints.at(-1).count);
          return { get docs() { step('page-docs'); return values.map(([key, value]) => ({
            get id() { step('page-id'); return key.split('/').at(-1); },
            data: () => { step('page-data'); return value; },
          })); } };
        },
        runTransaction: async (db: unknown, work: any, settings: any) => {
          assert.equal(db, 'synthetic-clinical-db'); assert.equal(settings.maxAttempts, 5); step('transaction-start');
          const attempt = async (publish: boolean) => {
            const staged = new Map(rows); let wrote = false;
            const result = await work({
              get: async (key: string) => { assert.equal(wrote, false, 'all reads precede writes'); calls.push(`get:${key}`); step('transaction-read'); return snapshot(key, 'transaction', staged); },
              set: (key: string, value: unknown) => { wrote = true;
                if (options.denyWrite) throw new Error('PRIVATE_SDK_WRITE_DENIED');
                calls.push(`set:${key}`); staged.set(key, value); step('transaction-write'); },
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
  const payload = copy({ operationId: OP, patientId: ID, sessionId: OP, expectedRevision: 0, action: 'visit', createdAt: WHEN,
    data: { type: 'حشو عادي', date: DAY, teethIds: ['ur5'], services: [{ id: ITEM, name: 'حشو عادي', priceCents: 30_000, tooth: 'ur5' }],
      examinationCents: 10_000, notes: '', treatmentStage: 'single', rootCanalStatus: '', visitStatus: 'completed' }, paidCents: 10_000 });
  rows.set(path('patientProfiles'), copy({ schemaVersion: 1, clinicId: 'main', recordId: ID, fileNo: 451, revision: 1,
    lastOperationId: OP2, phoneKey: createHash('sha256').update('patient-phone-v1:201000000001').digest('hex'),
    data: { name: 'ملف اختبار مصطنع', mobile: '01000000001', age: 30, gender: '', firstVisit: DAY, notes: '', allergy: '' } }));
  rows.set(path('patientFiles', 451), copy({ schemaVersion: 1, clinicId: 'main', recordId: ID, fileNo: 451 }));
  return { service: module.exports, auth, user, calls, rows, payload, compiled: output, active, copy, location, options, rawAdapters };
}
const failed = (error: unknown) => /تعذر تأكيد|تعذر التحقق/.test(String(error)) && !String(error).includes('PRIVATE');
const safe = (error: unknown) => /SAFE_(CLINICAL|INTENT)_(invalid|unavailable|conflict)/.test(String(error)) && !String(error).includes('PRIVATE');
async function capability(h: Awaited<ReturnType<typeof harness>>) {
  return h.service.createFirebaseCloudClinical(h.auth, { isActive: () => h.active.value });
}
async function prepared(h: Awaited<ReturnType<typeof harness>>, value?: any) {
  const service = await capability(h);
  await service.journal.prepare('clinical', value ?? h.payload, WHEN);
  return service;
}

test('clinical SDK import is inert and graph excludes App, storage, default backup and UI', async () => {
  const h = await harness(); assert.deepEqual(h.calls, []); assert.equal(h.rows.size, 2);
  assert.equal(Object.keys(h.compiled.metafile!.inputs).some(key => /utils\/(?:storage|localClinicBackup|firebaseService|offlineSync)|App\.tsx|components\//.test(key)), false);
});

test('clinical factory requires active lease, exact isolated app/project/domain and loopback without an Auth emulator', async () => {
  for (const options of [{ hostname: 'public.example.invalid' }, { projectId: 'zippy-dispatcher-m1ttq' },
    { authDomain: 'other.firebaseapp.com' }, { appName: '[DEFAULT]' }, { appName: `clinic-owner-setup-${ID}` },
    { appName: `clinic-operating-${ID}\n` }, { appName: 'clinic-operating-00000000-0000-0000-0000-000000000000' }, { emulator: true }]) {
    const h = await harness(options); await assert.rejects(capability(h), failed); assert.deepEqual(h.calls, []);
  }
  for (const options of [undefined, {}, { isActive: () => false }, { isActive: () => { throw new Error('PRIVATE_LEASE'); } }]) {
    const h = await harness(); await assert.rejects(h.service.createFirebaseCloudClinical(h.auth, options), failed); assert.deepEqual(h.calls, []);
  }
});

test('clinical factory imports Lite lazily into the named default db without authorizing or reading on construction', async () => {
  const h = await harness(); const service = await capability(h);
  assert.deepEqual(h.calls, ['import:firebase/auth', 'import:firebase/firestore/lite', 'database']);
  assert.deepEqual(Object.keys(service).sort(), ['journal', 'repository']); assert.equal(h.rows.size, 2);
});

test('clinical journal prepares server-side, commits session/account/cash/operation/intent atomically, and replays without writes', async () => {
  const h = await harness(), service = await prepared(h);
  assert.equal(h.rows.get(path('operationIntents', OP)).status, 'prepared');
  assert.equal((await service.repository.commit(h.payload)).status, 'committed');
  assert.equal(h.rows.get(path('patientAccounts')).totalCents, 40_000);
  assert.equal(h.rows.get(path('patientAccounts')).paidCents, 10_000);
  assert.equal(h.rows.get(path('operationIntents', OP)).status, 'committed');
  const writes = h.calls.filter(call => call.startsWith('set:')).length;
  assert.equal((await service.repository.commit(h.payload)).status, 'already-committed');
  assert.equal(h.calls.filter(call => call.startsWith('set:')).length, writes);
  assert.equal(h.calls.some(call => /^set:.*(?:patientProfiles|patientFiles|lab|backup|contact)/.test(call)), false);
});

test('clinical SDK refuses commit without durable preparation; journal cancellation remains final', async () => {
  const h = await harness(), service = await capability(h);
  await assert.rejects(service.repository.commit(h.payload)); assert.equal(h.rows.size, 2);
  await service.journal.prepare('clinical', h.payload, WHEN);
  assert.equal((await service.journal.cancel(OP)).status, 'cancelled');
  await assert.rejects(service.repository.commit(h.payload));
  assert.equal(h.rows.has(path('patientReceipts', OP)), false); assert.equal(h.rows.has(path('patientAccounts')), false);
});

test('clinical capability refuses other journal kinds and never reads or cancels a foreign-kind stored intent', async () => {
  const h = await harness(), service = await prepared(h);
  for (const kind of ['contact', 'patient-profile', 'other']) {
    await assert.rejects(async () => service.journal.prepare(kind, h.payload, WHEN));
    await assert.rejects(async () => service.journal.listPreparedPage(kind));
  }
  const stored = h.rows.get(path('operationIntents', OP)); stored.kind = 'contact';
  stored.requestHash = createHash('sha256').update(JSON.stringify(['clinic-operation-intent-v1', UID, 'contact', stored.command])).digest('hex');
  await assert.rejects(service.journal.get(OP)); await assert.rejects(service.journal.cancel(OP));
  assert.equal(h.calls.some(call => /doc:.*contactOperations|doc:.*patientOperations/.test(call)), false);
});

test('clinical owner checks reject malformed claims and absent/disabled/stale/wrong canonical membership before transactions', async () => {
  for (const options of [{ verified: false }, { tokenVerified: false }, { missingMember: true },
    { member: { status: 'disabled' } }, { member: { role: 'secretary' } }, { member: { uid: 'another-owner' } },
    { member: { clinicId: 'other' } }, { member: { extra: true } }, { member: { verifiedAfter: 101 } },
    { claims: { sub: 'another-owner' } }, { claims: { aud: 'other-project' } }, { claims: { dentalClinicRole: 'secretary' } },
    { claims: { dentalClinicId: 'other' } }, { provider: 'custom' }, { claims: { auth_time: '100' } }]) {
    const h = await harness(options), service = await capability(h);
    await assert.rejects(service.journal.prepare('clinical', h.payload, WHEN), failed);
    assert.equal(h.calls.includes('transaction-start'), false); assert.equal(h.rows.size, 2);
  }
});

test('clinical SDK reads exact profile/index/account/session paths and never invents an absent account balance', async () => {
  const h = await harness(), service = await capability(h);
  assert.equal((await service.repository.getProfile(ID)).fileNo, 451);
  assert.equal(await service.repository.getAccount(ID), null); assert.equal(await service.repository.getSession(OP), null);
  assert.ok(h.calls.includes(`read:${path('patientProfiles')}`)); assert.ok(h.calls.includes(`read:${path('patientFiles', 451)}`));
  assert.equal(h.calls.includes('transaction-start'), false);
});

test('clinical session/receipt queries enforce patientId equality, UUID order and bounded exclusive cursor', async () => {
  const h = await harness(), service = await prepared(h); await service.repository.commit(h.payload);
  for (const method of ['listSessions', 'listReceipts']) {
    const page = await service.repository[method](h.copy({ patientId: ID, limit: 1 }));
    assert.equal(page.records.length, 1); assert.equal(page.nextAfterId, OP);
    assert.equal((await service.repository[method](h.copy({ patientId: ID, afterId: OP, limit: 1 }))).records.length, 0);
    await service.repository[method](h.copy({ patientId: ID }));
  }
  assert.ok(h.calls.some(call => call.startsWith('query:') && call.includes('"count":25')));
});

test('clinical recovery queries constrain actor, kind and prepared status and retain bounded UUID pagination', async () => {
  const h = await harness(), service = await prepared(h);
  await service.journal.prepare('clinical', h.copy({ ...h.payload, operationId: OP2, sessionId: OP2 }), WHEN);
  const first = await service.journal.listPreparedPage('clinical', h.copy({ limit: 1 }));
  assert.equal(first.records[0].operationId, OP); assert.equal(first.nextAfterId, OP);
  const second = await service.journal.listPreparedPage('clinical', h.copy({ afterId: OP, limit: 1 }));
  assert.equal(second.records[0].operationId, OP2);
  await service.journal.cancel(OP2); await service.repository.commit(h.payload);
  assert.equal((await service.journal.listPreparedPage('clinical')).records.length, 0);
});

test('clinical SDK read/write denials expose fixed errors without fallback or successful empty results', async () => {
  const h = await harness({ denyRead: true }), service = await capability(h);
  for (const read of [() => service.repository.getAccount(ID), () => service.repository.getSession(OP),
    () => service.repository.listSessions(h.copy({ patientId: ID })), () => service.journal.get(OP),
    () => service.journal.listPreparedPage('clinical')]) await assert.rejects(read(), failed);
  assert.equal(h.rows.size, 2);
  const denied = await harness({ denyWrite: true }), writer = await capability(denied);
  await assert.rejects(writer.journal.prepare('clinical', denied.payload, WHEN), failed); assert.equal(denied.rows.size, 2);
});

test('lost SDK acknowledgement retries the original prepared intent and original domain operation without duplicate cash', async () => {
  const h = await harness(), service = await prepared(h);
  h.options.lostReply = true;
  await assert.rejects(service.repository.commit(h.payload), failed);
  assert.equal(h.rows.get(path('operationIntents', OP)).status, 'committed');
  const before = h.calls.filter(call => call.startsWith('set:')).length;
  assert.equal((await service.repository.commit(h.payload)).status, 'already-committed');
  assert.equal(h.calls.filter(call => call.startsWith('set:')).length, before);
  assert.equal([...h.rows.keys()].filter(key => key.startsWith(path('patientReceipts', ''))).length, 1);
});

test('same-UID identity replacement revokes the clinical capability permanently at every owner authorization boundary', async () => {
  for (const swapAt of ['token', 'member-doc', 'member', 'member-exists', 'member-data'] as Boundary[]) {
    const h = await harness({ swapAt }), service = await capability(h);
    await assert.rejects(service.repository.getAccount(ID), failed);
    h.auth.currentUser = h.user; h.options.swapAt = undefined; const before = [...h.calls];
    await assert.rejects(service.repository.getAccount(ID), failed); assert.deepEqual(h.calls, before);
  }
});

test('clinical factory checks lifetime after database creation and permanently binds the original user object', async () => {
  const stopped = await harness({ stopAt: 'database' }); await assert.rejects(capability(stopped), failed);
  const h = await harness(), service = await capability(h); h.auth.currentUser = { ...h.user };
  const before = [...h.calls]; await assert.rejects(service.repository.getAccount(ID), failed);
  h.auth.currentUser = h.user; await assert.rejects(service.journal.get(OP), failed); assert.deepEqual(h.calls, before);
});

test('clinical read lifecycle checks every asynchronous/snapshot boundary and never resurrects after lease loss', async () => {
  for (const stopAt of ['token', 'member-doc', 'member', 'member-exists', 'member-data', 'record-doc', 'record', 'record-exists', 'record-data'] as Boundary[]) {
    const h = await harness({ stopAt }), service = await capability(h);
    await assert.rejects(service.repository.getProfile(ID), failed);
    h.active.value = true; h.options.stopAt = undefined; const before = [...h.calls];
    await assert.rejects(service.repository.getProfile(ID), failed); assert.deepEqual(h.calls, before);
  }
});

test('clinical query construction/docs/id/data callbacks stop before any subsequent SDK call on revocation', async () => {
  for (const stopAt of ['where', 'document-id', 'order', 'after', 'limit', 'collection', 'query', 'page', 'page-docs', 'page-id', 'page-data'] as Boundary[]) {
    const h = await harness(), service = await prepared(h); h.options.stopAt = stopAt;
    await assert.rejects(service.journal.listPreparedPage('clinical', h.copy({ afterId: ID })), failed);
    const stop = h.calls.lastIndexOf(stopAt); assert.ok(stop !== -1, stopAt);
    assert.equal(h.calls.length, stop + 1, `no SDK call after ${stopAt}`);
  }
});

test('clinical domain transaction checks every read/write/ack boundary without claiming server undo', async () => {
  for (const stopAt of ['transaction-start', 'transaction-read', 'transaction-exists', 'transaction-data', 'transaction-write', 'transaction-ack'] as Boundary[]) {
    const h = await harness(), service = await prepared(h); h.options.stopAt = stopAt;
    await assert.rejects(service.repository.commit(h.payload), failed);
    assert.equal(h.rows.has(path('patientAccounts')), stopAt === 'transaction-ack');
    assert.equal(h.rows.get(path('operationIntents', OP)).status, stopAt === 'transaction-ack' ? 'committed' : 'prepared');
  }
});

test('SDK promises scheduled just before revocation own their rejections and expose no unhandled private error', async () => {
  for (const stopAt of ['record', 'page'] as Boundary[]) {
    const h = await harness({ denyRead: true, stopAt }), service = await capability(h);
    await assert.rejects(stopAt === 'record' ? service.journal.get(OP) : service.journal.listPreparedPage('clinical'), failed);
    await Promise.resolve(); await Promise.resolve(); assert.equal(h.rows.size, 2);
  }
});

test('retained clinical and journal capabilities stop all SDK operations after logout/runtime/lease loss', async () => {
  for (const change of ['logout', 'runtime', 'lease']) {
    const h = await harness(), service = await capability(h), before = [...h.calls];
    if (change === 'logout') h.auth.currentUser = null;
    if (change === 'runtime') h.location.hostname = 'public.example.invalid';
    if (change === 'lease') h.active.value = false;
    for (const action of [() => service.repository.getProfile(ID), () => service.repository.getAccount(ID),
      () => service.repository.getSession(OP), () => service.repository.commit(h.payload),
      () => service.repository.listSessions(h.copy({ patientId: ID })), () => service.repository.listReceipts(h.copy({ patientId: ID })),
      () => service.journal.prepare('clinical', h.payload, WHEN), () => service.journal.get(OP),
      () => service.journal.listPreparedPage('clinical'), () => service.journal.cancel(OP)]) await assert.rejects(action(), failed);
    assert.deepEqual(h.calls, before);
  }
});

test('raw clinical transaction fence permits profile/file reads but never writes them or any unrelated/private domain', async () => {
  const h = await harness({ raw: true }); await capability(h); const adapter = h.rawAdapters.clinical;
  assert.ok(adapter);
  const forbidden = [path('members', UID), path('contactRecords'), path('contactOperations', OP), path('patientOperations', OP),
    path('labCosts'), path('expenses'), path('backups'), 'clinics/other/patientAccounts/' + ID,
    path('patientProfiles') + '/extra', path('patientAccounts') + '\n', path('patientFiles', '0451'), path('patientFiles', '٠١'),
    path('patientFiles', 0), path('patientFiles', 2000000001), path('patientFiles', '451.0')];
  for (const key of forbidden) await assert.rejects(adapter.runTransaction(async (tx: any) => tx.get(key)), safe);
  for (const key of [...forbidden, path('patientProfiles'), path('patientFiles', 451)]) {
    await assert.rejects(adapter.runTransaction(async (tx: any) => tx.set(key, h.copy({}))), safe);
  }
  assert.equal(h.calls.some(call => call.startsWith('get:') || call.startsWith('set:')), false);
});

test('raw SDK query seams reject malformed patient/cursor/limit/actor/kind before constructing queries', async () => {
  const h = await harness({ raw: true }); await capability(h); const adapter = h.rawAdapters.clinical, journal = h.rawAdapters.journal;
  const before = [...h.calls];
  for (const method of ['listSessionsPage', 'listReceiptsPage']) {
    for (const args of [[ID, null, 0], [ID, null, 51], [ID, null, 1.5], [ID, undefined, 1], [ID, `${OP}\n`, 1], [`${ID}\n`, null, 1]]) {
      await assert.rejects(adapter[method](...args), safe);
    }
  }
  for (const args of [['contact', UID, null, 25], ['clinical', 'another-owner', null, 25], ['clinical', UID, OP + '\n', 25], ['clinical', UID, null, 51]]) {
    await assert.rejects(async () => journal.listPreparedPage(...args), safe);
  }
  assert.deepEqual(h.calls, before);
});

test('server preparation survives lost acknowledgement and a fresh capability resumes exactly that command', async () => {
  const h = await harness({ lostReply: true }), first = await capability(h);
  await assert.rejects(first.journal.prepare('clinical', h.payload, WHEN), failed);
  assert.equal(h.rows.get(path('operationIntents', OP)).status, 'prepared');
  const reopened = await capability(h), recovered = await reopened.journal.get(OP);
  assert.equal(recovered.operationId, OP);
  assert.equal((await reopened.repository.commit(recovered.command)).status, 'committed');
  assert.equal(h.rows.get(path('patientAccounts')).paidCents, 10_000);
  assert.equal(h.rows.get(path('patientAccounts')).revision, 1);
});

test('clinical transaction SDK callback retry and new-capability replay cannot duplicate a cash receipt', async () => {
  const h = await harness(), first = await prepared(h); h.options.retryOnce = true;
  await first.repository.commit(h.payload);
  const reopened = await capability(h), recovered = await reopened.journal.get(OP);
  assert.equal(recovered.status, 'committed');
  assert.equal((await reopened.repository.commit(recovered.command)).status, 'already-committed');
  assert.equal(h.rows.get(path('patientAccounts')).revision, 1);
  assert.equal([...h.rows.keys()].filter(key => key.startsWith(path('patientReceipts', ''))).length, 1);
});

test('same-UID replacement during reads/pages/transactions rejects late results and permanently revokes old capability', async () => {
  for (const swapAt of ['record-doc', 'record', 'record-exists', 'record-data', 'query', 'page-docs', 'page-id', 'page-data',
    'transaction-read', 'transaction-data', 'transaction-write', 'transaction-ack'] as Boundary[]) {
    const h = await harness(), service = await prepared(h); h.options.swapAt = swapAt;
    const operation = swapAt.startsWith('transaction') ? () => service.repository.commit(h.payload)
      : ['query', 'page-docs', 'page-id', 'page-data'].includes(swapAt) ? () => service.journal.listPreparedPage('clinical')
        : () => service.journal.get(OP);
    await assert.rejects(operation(), failed);
    assert.equal(h.rows.has(path('patientAccounts')), swapAt === 'transaction-ack');
    h.auth.currentUser = h.user; h.options.swapAt = undefined;
    const before = [...h.calls]; await assert.rejects(service.repository.getAccount(ID), failed); assert.deepEqual(h.calls, before);
  }
});

test('raw one-record read fences forbid receipt/operation and cross-journal access outside domain transaction', async () => {
  const h = await harness({ raw: true }); await capability(h);
  const before = [...h.calls];
  for (const key of [path('operationIntents', OP), path('clinicalOperations', OP), path('patientReceipts', OP),
    path('contactRecords'), path('members', UID), path('patientAccounts') + '\n']) {
    await assert.rejects(async () => h.rawAdapters.clinical.readRecord(key), safe);
  }
  for (const key of [path('patientProfiles'), path('patientAccounts'), path('clinicalOperations', OP),
    path('patientFiles', 451), path('operationIntents', OP) + '\n']) {
    await assert.rejects(async () => h.rawAdapters.journal.readRecord(key), safe);
  }
  assert.deepEqual(h.calls, before);
});

test('raw transaction intent fence rejects non-clinical intent reads and writes before any mutation', async () => {
  const h = await harness({ raw: true }); await capability(h);
  h.rows.set(path('operationIntents', OP), h.copy({ kind: 'contact' }));
  await assert.rejects(h.rawAdapters.clinical.runTransaction((tx: any) => tx.get(path('operationIntents', OP))), safe);
  for (const value of [{ kind: 'contact' }, { kind: 'patient-profile' }, {}]) {
    await assert.rejects(h.rawAdapters.clinical.runTransaction((tx: any) => tx.set(path('operationIntents', OP), h.copy(value))), safe);
  }
  assert.equal(h.calls.some(call => call.startsWith('set:')), false);
});

test('malformed stored session/receipt or owner-bound intent never becomes a successful empty history', async () => {
  for (const kind of ['patientSessions', 'patientReceipts', 'operationIntents']) {
    const h = await harness(), service = await prepared(h); await service.repository.commit(h.payload);
    if (kind === 'operationIntents') {
      const intent = h.rows.get(path(kind, OP)); intent.actorUid = 'another-owner';
      await assert.rejects(service.journal.get(OP));
    } else {
      h.rows.get(path(kind, OP)).fileNo = 452;
      await assert.rejects(kind === 'patientSessions' ? service.repository.listSessions(h.copy({ patientId: ID }))
        : service.repository.listReceipts(h.copy({ patientId: ID })));
    }
    assert.equal(h.rows.get(path('patientAccounts')).paidCents, 10_000);
  }
});

test('clinical journal rejects generic or mismatched-timestamp commands before SDK authorization or preparation', async () => {
  const h = await harness(), service = await capability(h), before = [...h.calls];
  for (const value of [{ operationId: OP }, { operationId: OP, secret: 'not a clinical command' },
    { ...h.payload, unknown: true }, { ...h.payload, expectedRevision: -1 }]) {
    await assert.rejects(service.journal.prepare('clinical', h.copy(value), WHEN));
  }
  await assert.rejects(service.journal.prepare('clinical', h.payload, '2026-10-11T00:00:01.000Z'));
  assert.deepEqual(h.calls, before); assert.equal(h.rows.size, 2);
});

test('malformed clinical command in a stored generic intent is neither exposed nor cancelled as a hidden side effect', async () => {
  for (const action of ['get', 'list', 'cancel']) {
    const h = await harness(), service = await prepared(h), intent = h.rows.get(path('operationIntents', OP));
    intent.command = h.copy({ invalid: true, operationId: OP });
    intent.requestHash = createHash('sha256').update(JSON.stringify(['clinic-operation-intent-v1', UID, 'clinical', intent.command])).digest('hex');
    const writes = h.calls.filter(call => call.startsWith('set:')).length;
    await assert.rejects(action === 'get' ? service.journal.get(OP) : action === 'list'
      ? service.journal.listPreparedPage('clinical') : service.journal.cancel(OP));
    assert.equal(h.calls.filter(call => call.startsWith('set:')).length, writes, action);
    assert.equal(h.rows.get(path('operationIntents', OP)).status, 'prepared');
  }
});

test('same-config app replacement or observed app/UID mutation permanently revokes the exact original capability', async () => {
  for (const change of ['app-object', 'project', 'uid']) {
    const h = await harness(), service = await capability(h), originalApp = h.auth.app;
    if (change === 'app-object') h.auth.app = { ...originalApp, options: { ...originalApp.options } };
    if (change === 'project') h.auth.app.options.projectId = 'another-project';
    if (change === 'uid') h.user.uid = 'another-owner';
    const before = [...h.calls]; await assert.rejects(service.repository.getAccount(ID), failed);
    h.auth.app = originalApp; originalApp.options.projectId = PROJECT; h.user.uid = UID;
    await assert.rejects(service.journal.get(OP), failed); assert.deepEqual(h.calls, before);
  }
});

test('initial Auth property getter failures produce fixed factory errors without SDK imports', async () => {
  for (const key of ['currentUser', 'app']) {
    const h = await harness(); Object.defineProperty(h.auth, key, { get() { throw new Error('PRIVATE_AUTH_GETTER'); } });
    await assert.rejects(capability(h), failed); assert.deepEqual(h.calls, []);
  }
});
