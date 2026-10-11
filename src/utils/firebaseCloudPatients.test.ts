import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';

const ID = '10000000-0000-4000-8000-000000000001';
const OTHER = '10000000-0000-4000-8000-000000000002';
const OP = '20000000-0000-4000-8000-000000000001';
const UID = 'synthetic-owner';
const CREATED = '2026-10-12T09:00:00.000Z';
const PROJECT = 'dental-clinic-mmaakk888';
const COUNTER = 'clinics/main/counters/patientFiles';
const PHONE_KEY = createHash('sha256').update('patient-phone-v1:201000000001').digest('hex');
const entry = 'src/utils/firebaseCloudPatients.ts';
const bundle = build({ entryPoints: [entry], bundle: true, write: false, metafile: true, platform: 'node', format: 'cjs',
  external: ['firebase/*'], supported: { 'dynamic-import': false }, logLevel: 'silent' });
const rawBundle = build({ entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'cjs',
  external: ['firebase/*', './cloudPatientRepository'], supported: { 'dynamic-import': false }, logLevel: 'silent' });

type Boundary = 'database' | 'token' | 'member-doc' | 'member' | 'member-exists' | 'member-data'
  | 'record-doc' | 'record' | 'record-exists' | 'record-data' | 'where' | 'document-id' | 'order' | 'after' | 'limit'
  | 'collection' | 'query' | 'page' | 'page-data' | 'transaction-read' | 'transaction-exists' | 'transaction-data'
  | 'transaction-write' | 'transaction-ack';

async function harness(options: { hostname?: string; projectId?: string; appName?: string; authDomain?: string;
  verified?: boolean; emulator?: boolean; memberDisabled?: boolean; missingMember?: boolean; staleAuthTime?: boolean;
  swapAt?: Boundary; stopAt?: Boundary; denyWrite?: boolean; denyRead?: boolean; raw?: boolean; loseAck?: boolean } = {}) {
  const compiled = await (options.raw ? rawBundle : bundle), module = { exports: {} as any }, calls: string[] = [];
  const user = { uid: UID, email: 'owner@example.invalid', emailVerified: options.verified ?? true };
  const location = { hostname: options.hostname ?? '127.0.0.1' };
  const auth = { app: { name: options.appName ?? `clinic-operating-${ID}`, options: {
    projectId: options.projectId ?? PROJECT, authDomain: options.authDomain ?? `${PROJECT}.firebaseapp.com` } },
    emulatorConfig: options.emulator ? {} : null, currentUser: user as typeof user | null };
  const rows = new Map<string, any>(), active = { value: true };
  let copy!: (value: unknown) => any;
  const step = (boundary: Boundary) => {
    calls.push(boundary);
    if (options.stopAt === boundary) active.value = false;
    if (options.swapAt === boundary) auth.currentUser = { ...user };
  };
  const snapshot = (path: string, kind: 'record' | 'transaction', source = rows) => ({
    exists: () => { step(`${kind}-exists` as Boundary); return source.has(path); },
    data: () => { step(`${kind}-data` as Boundary); return source.get(path); },
  });
  const scope = { module, exports: module.exports, TextEncoder, crypto: webcrypto,
    window: { location,
      get localStorage() { throw new Error('No local clinic records allowed'); },
      get sessionStorage() { throw new Error('No local account session allowed'); } },
    get localStorage() { throw new Error('No local clinic records allowed'); },
    get sessionStorage() { throw new Error('No local account session allowed'); },
    fetch: () => { throw new Error('Synthetic SDK test forbids real network'); },
    require: (name: string) => {
      calls.push(`import:${name}`);
      if (name === './cloudPatientRepository' && options.raw) return {
        createJournaledCloudPatientRepository: (adapter: unknown) => adapter,
        prepareCloudPatientCommand: (input: unknown) => input,
        CloudPatientError: class extends Error {
          constructor(public code: string) { super(`SAFE_PATIENT_${code}`); }
        },
      };
      if (name === 'firebase/auth') return {
        getIdTokenResult: async (target: unknown) => {
          assert.equal(target, user); step('token');
          return { signInProvider: 'password', claims: {
            sub: UID, aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, email: user.email,
            email_verified: true, dentalClinicId: 'main', dentalClinicRole: 'owner', auth_time: options.staleAuthTime ? 99 : 100,
          } };
        },
      };
      if (name === 'firebase/firestore/lite') return {
        getFirestore: (app: unknown, databaseId: string) => {
          assert.equal(app, auth.app); assert.equal(databaseId, '(default)'); step('database'); return 'synthetic-default-db';
        },
        doc: (db: unknown, ...parts: string[]) => {
          assert.equal(db, 'synthetic-default-db');
          const path = parts.join('/');
          step(path.startsWith('clinics/main/members/') ? 'member-doc' : 'record-doc');
          calls.push(`doc:${path}`); return path;
        },
        getDoc: async (path: string) => {
          if (!path.startsWith('clinics/main/members/')) {
            calls.push(`read:${path}`); step('record');
            if (options.denyRead) throw new Error('PRIVATE_SDK_READ_DENIED');
            return snapshot(path, 'record');
          }
          assert.equal(path, `clinics/main/members/${UID}`); step('member');
          return {
            exists: () => { step('member-exists'); return !options.missingMember; },
            data: () => {
              step('member-data');
              return copy({ schemaVersion: 1, clinicId: 'main', uid: UID, role: 'owner',
                status: options.memberDisabled ? 'disabled' : 'active', identityVersion: 1, verifiedAfter: 100 });
            },
          };
        },
        collection: (db: unknown, ...parts: string[]) => {
          assert.equal(db, 'synthetic-default-db'); step('collection'); return parts.join('/');
        },
        documentId: () => { step('document-id'); return '__name__'; },
        orderBy: (field: string) => { step('order'); return { kind: 'order', field }; },
        where: (field: string, operator: string, value: string) => { step('where'); return { kind: 'where', field, operator, value }; },
        startAfter: (id: string) => { step('after'); return { kind: 'after', id }; },
        limit: (count: number) => { step('limit'); return { kind: 'limit', count }; },
        query: (path: string, ...constraints: any[]) => {
          calls.push(`query:${JSON.stringify(constraints)}`); step('query'); return { path, constraints };
        },
        getDocs: async (query: any) => {
          const predicates = query.constraints.filter((value: any) => value.kind === 'where');
          if (query.path === 'clinics/main/patientProfiles') {
            assert.equal(predicates.length <= 1, true);
            if (predicates.length) assert.deepEqual(predicates[0], { kind: 'where', field: 'phoneKey', operator: '==', value: PHONE_KEY });
          } else {
            assert.equal(query.path, 'clinics/main/operationIntents');
            assert.equal(predicates.length === 2 || predicates.length === 3, true);
            assert.deepEqual(predicates[0], { kind: 'where', field: 'actorUid', operator: '==', value: UID });
            assert.deepEqual(predicates[1], { kind: 'where', field: 'kind', operator: '==', value: 'patient-profile' });
            if (predicates[2]) assert.deepEqual(predicates[2], { kind: 'where', field: 'status', operator: '==', value: 'prepared' });
          }
          assert.deepEqual(query.constraints.find((value: any) => value.kind === 'order'), { kind: 'order', field: '__name__' });
          assert.equal(query.constraints.at(-1).kind, 'limit');
          const after = query.constraints.find((value: any) => value.kind === 'after')?.id;
          step('page'); if (options.denyRead) throw new Error('PRIVATE_SDK_PAGE_DENIED');
          return { docs: [...rows.entries()].filter(([path, data]) => path.startsWith(`${query.path}/`)
            && (!after || path.split('/').at(-1)! > after) && predicates.every((item: any) => data[item.field] === item.value))
            .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).slice(0, query.constraints.at(-1).count)
            .map(([path, data]) => ({ id: path.split('/').at(-1), data: () => { step('page-data'); return data; } })) };
        },
        runTransaction: async (db: unknown, work: any, settings: any) => {
          assert.equal(db, 'synthetic-default-db'); assert.equal(settings.maxAttempts, 5); calls.push('transaction');
          const staged = new Map(rows);
          const result = await work({
            get: async (path: string) => {
              calls.push(`get:${path}`); step('transaction-read'); return snapshot(path, 'transaction', staged);
            },
            set: (path: string, data: unknown) => {
              if (options.denyWrite) throw new Error('PRIVATE_SDK_WRITE_DENIED');
              calls.push(`set:${path}`); staged.set(path, data); step('transaction-write');
            },
          });
          rows.clear(); for (const [key, value] of staged) rows.set(key, value);
          step('transaction-ack');
          if (options.loseAck) { options.loseAck = false; throw new Error('PRIVATE_ACK_LOST'); }
          return result;
        },
      };
      throw new Error(`Unexpected SDK import ${name}`);
    },
  };
  runInNewContext(compiled.outputFiles[0].text, scope);
  copy = runInNewContext('(value) => JSON.parse(JSON.stringify(value))', scope);
  const payload = copy({ operationId: OP, recordId: ID, expectedRevision: 0, action: 'create', profile: {
    name: 'مريض مصطنع', mobile: '01000000001', age: 30, gender: '', firstVisit: '2026-10-10', notes: '', allergy: '',
  } });
  rows.set(COUNTER, copy({ schemaVersion: 1, clinicId: 'main', lastFileNo: 0, lastOperationId: null }));
  return { service: module.exports, auth, calls, rows, payload, compiled, active, copy, location };
}

function seedIntent(h: Awaited<ReturnType<typeof harness>>, command = h.payload, createdAt = CREATED,
  kind = 'patient-profile', actorUid = UID) {
  const canonical = (value: any): any => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  const normalized = canonical(command);
  const intent = { schemaVersion: 1, clinicId: 'main', recordId: command.operationId, operationId: command.operationId,
    actorUid, kind, requestHash: createHash('sha256').update(JSON.stringify(['clinic-operation-intent-v1', actorUid, kind, normalized])).digest('hex'),
    status: 'prepared', revision: 1, createdAt, command: normalized };
  h.rows.set(`clinics/main/operationIntents/${command.operationId}`, h.copy(intent)); return intent;
}

function syntheticRecord(id = ID, fileNo = 1, mobile = '01000000001') {
  return { schemaVersion: 1, clinicId: 'main', recordId: id, fileNo, revision: 1, lastOperationId: OP,
    phoneKey: mobile ? PHONE_KEY : null, data: { name: 'ملف مصطنع', mobile, age: 30, gender: '',
      firstVisit: '2026-10-10', notes: '', allergy: '' } };
}
function seedProfile(h: Awaited<ReturnType<typeof harness>>, id = ID, fileNo = 1, mobile = '01000000001') {
  h.rows.set(`clinics/main/patientProfiles/${id}`, h.copy(syntheticRecord(id, fileNo, mobile)));
  h.rows.set(`clinics/main/patientFiles/${fileNo}`, h.copy({ schemaVersion: 1, clinicId: 'main', recordId: id, fileNo }));
}
const failed = (error: unknown) => /تعذر تأكيد عملية ملف المريض من الخادم/.test(String(error)) && !String(error).includes('PRIVATE');

test('prepared patient SDK module imports no SDK, storage or clinic App and reads nothing on import', async () => {
  const h = await harness(); assert.deepEqual(h.calls, []);
  assert.equal(Object.keys(h.compiled.metafile!.inputs).some(path => /utils\/(?:storage|localClinicBackup|firebaseService|offlineSync)|App\.tsx|components\//.test(path)), false);
});

test('patient factory rejects external host, wrong project/domain, setup/default app, malformed UUID and Auth emulator before SDK imports', async () => {
  for (const options of [{ hostname: 'public.example.invalid' }, { projectId: 'zippy-dispatcher-m1ttq' },
    { authDomain: 'other.firebaseapp.com' }, { appName: '[DEFAULT]' }, { appName: `clinic-owner-setup-${ID}` },
    { appName: 'clinic-operating-00000000-0000-0000-0000-000000000000' }, { appName: `clinic-operating-${ID}\n` }, { emulator: true }]) {
    const h = await harness(options);
    await assert.rejects(h.service.createFirebaseCloudPatients(h.auth), failed);
    assert.deepEqual(h.calls, []); assert.equal(h.rows.size, 1);
  }
});

test('patient adapter is explicit, lazy and isolated with no data read when factory is created', async () => {
  const h = await harness(); await h.service.createFirebaseCloudPatients(h.auth);
  assert.deepEqual(h.calls, ['import:firebase/auth', 'import:firebase/firestore/lite', 'database']);
  assert.equal(h.calls.includes('import:firebase/firestore'), false);
});

test('patient create uses one named default Lite transaction after canonical owner check', async () => {
  const h = await harness(), repo = await h.service.createFirebaseCloudPatients(h.auth);
  seedIntent(h);
  const result = await repo.commit(h.payload);
  assert.equal(result.status, 'committed'); assert.equal(result.fileNo, 1); assert.equal(h.rows.size, 5);
  assert.ok(h.calls.indexOf('member') < h.calls.indexOf('transaction'));
  for (const path of [COUNTER, `clinics/main/patientFiles/1`, `clinics/main/patientProfiles/${ID}`, `clinics/main/patientOperations/${OP}`]) {
    assert.ok(h.calls.includes(`set:${path}`));
  }
  assert.equal(h.calls.some(call => /contactRecords|backup|labCosts|sessions|expenses/.test(call)), false);
});

test('same patient operation retry returns historical receipt without allocating or writing twice', async () => {
  const h = await harness(), repo = await h.service.createFirebaseCloudPatients(h.auth);
  seedIntent(h);
  await repo.commit(h.payload); const writes = h.calls.filter(call => call.startsWith('set:')).length;
  assert.equal((await repo.commit(h.payload)).status, 'already-committed');
  assert.equal(h.calls.filter(call => call.startsWith('set:')).length, writes);
  assert.equal(h.rows.get(COUNTER).lastFileNo, 1);
});

test('unverified, missing/disabled membership or old password-auth cutoff never schedules a patient transaction', async () => {
  for (const options of [{ verified: false }, { memberDisabled: true }, { missingMember: true }, { staleAuthTime: true }]) {
    const h = await harness(options), repo = await h.service.createFirebaseCloudPatients(h.auth);
    await assert.rejects(repo.commit(h.payload), failed);
    assert.equal(h.calls.includes('transaction'), false); assert.equal(h.rows.size, 1);
  }
});

test('same-UID user-object replacement at token, membership reference/snapshot callbacks denies all patient access', async () => {
  for (const swapAt of ['token', 'member-doc', 'member', 'member-exists', 'member-data'] as Boundary[]) {
    const h = await harness({ swapAt }), repo = await h.service.createFirebaseCloudPatients(h.auth);
    await assert.rejects(repo.commit(h.payload), failed);
    assert.equal(h.calls.includes('transaction'), false); assert.equal(h.rows.size, 1);
  }
});

test('patient get and numeric-file lookup read exact fresh documents and reauthorize after the result', async () => {
  const h = await harness(), repo = await h.service.createFirebaseCloudPatients(h.auth); seedProfile(h);
  assert.equal((await repo.get(ID)).fileNo, 1);
  assert.equal((await repo.getByFileNo(1)).recordId, ID);
  assert.equal(await repo.get(OTHER), null); assert.equal(await repo.getByFileNo(2), null);
  const read = h.calls.indexOf(`read:clinics/main/patientProfiles/${ID}`);
  assert.ok(h.calls.indexOf('member') < read); assert.ok(h.calls.lastIndexOf('member') > read);
  assert.ok(h.calls.includes('read:clinics/main/patientFiles/1')); assert.equal(h.calls.includes('transaction'), false);
});

test('patient pages keep docID ordering, explicit exclusive cursor and bounded limits', async () => {
  const h = await harness(), repo = await h.service.createFirebaseCloudPatients(h.auth); seedProfile(h); seedProfile(h, OTHER, 2);
  const all = await repo.listPage(); assert.equal(all.records.length, 2); assert.equal(all.nextAfterId, null);
  assert.ok(h.calls.some(call => call.startsWith('query:') && call.includes('"count":25')));
  const first = await repo.listPage(h.copy({ limit: 1 })); assert.equal(first.nextAfterId, ID);
  const next = await repo.listPage(h.copy({ afterId: ID, limit: 1 })); assert.equal(next.records[0].recordId, OTHER);
  assert.ok(h.calls.some(call => call.startsWith('query:') && call.includes(`"kind":"after","id":"${ID}"`)));
});

test('patient phone lookup uses canonical hashed full number and paginates shared family files without uniqueness', async () => {
  const h = await harness(), repo = await h.service.createFirebaseCloudPatients(h.auth); seedProfile(h); seedProfile(h, OTHER, 2);
  const first = await repo.findByPhone(h.copy({ mobile: '+20 100 000 0001', limit: 1 }));
  assert.equal(first.records[0].recordId, ID); assert.equal(first.nextAfterId, ID);
  const second = await repo.findByPhone(h.copy({ mobile: '٠١٠٠٠٠٠٠٠٠١', afterId: ID, limit: 1 }));
  assert.equal(second.records[0].recordId, OTHER);
  assert.ok(h.calls.some(call => call.startsWith('query:') && call.includes(PHONE_KEY) && call.includes('"kind":"where"')));
  assert.equal(h.calls.some(call => call.includes('patientPhones/')), false);
});

test('SDK read errors never become successful empty patient/profile pages and expose no raw details', async () => {
  const h = await harness({ denyRead: true }), repo = await h.service.createFirebaseCloudPatients(h.auth);
  for (const read of [() => repo.get(ID), () => repo.getByFileNo(1), () => repo.listPage(),
    () => repo.findByPhone(h.copy({ mobile: '01000000001' }))]) await assert.rejects(read(), failed);
  assert.equal(h.rows.size, 1); assert.equal(h.calls.includes('transaction'), false);
});

test('SDK write denial leaves patient allocation unconfirmed without fallback or partial synthetic transaction writes', async () => {
  const h = await harness({ denyWrite: true }), repo = await h.service.createFirebaseCloudPatients(h.auth);
  seedIntent(h);
  await assert.rejects(repo.commit(h.payload), failed); assert.equal(h.rows.size, 2); assert.equal(h.rows.get(COUNTER).lastFileNo, 0);
});

test('revocation while a newly scheduled SDK request rejects consumes the request rejection without exposing it', async () => {
  for (const stopAt of ['record', 'page'] as Boundary[]) {
    const h = await harness({ stopAt, denyRead: true }), repo = await h.service.createFirebaseCloudPatients(h.auth, { isActive: () => h.active.value });
    await assert.rejects(stopAt === 'record' ? repo.get(ID) : repo.listPage(), failed);
    // Let rejected SDK microtasks settle; node:test would flag an unhandled
    // provider rejection after this test rather than silently accepting it.
    await Promise.resolve(); await Promise.resolve();
    assert.equal(h.rows.size, 1);
  }
});

test('inactive/throwing lifecycle refuses patient factory without SDK imports or raw lifetime errors', async () => {
  for (const isActive of [() => false, () => { throw new Error('PRIVATE_LIFETIME'); }]) {
    const h = await harness(); await assert.rejects(h.service.createFirebaseCloudPatients(h.auth, { isActive }), failed);
    assert.deepEqual(h.calls, []);
  }
});

test('patient factory rechecks lifetime immediately after default-database initialization', async () => {
  const h = await harness({ stopAt: 'database' });
  await assert.rejects(h.service.createFirebaseCloudPatients(h.auth, { isActive: () => h.active.value }), failed);
  assert.equal(h.calls.includes('token'), false);
});

test('patient lifecycle blocks late owner snapshot and profile reads at every asynchronous and snapshot callback boundary', async () => {
  for (const stopAt of ['token', 'member-doc', 'member', 'member-exists', 'member-data', 'record-doc', 'record', 'record-exists', 'record-data'] as Boundary[]) {
    const h = await harness({ stopAt }), repo = await h.service.createFirebaseCloudPatients(h.auth, { isActive: () => h.active.value }); seedProfile(h);
    await assert.rejects(repo.get(ID), failed);
    assert.equal(h.calls.includes('transaction'), false);
    if (stopAt === 'record-doc') assert.equal(h.calls.some(call => call.startsWith('read:')), false);
    if (stopAt === 'record-exists') assert.equal(h.calls.includes('record-data'), false);
  }
});

test('patient page lifecycle rechecks every query construction and snapshot callback boundary before scheduling another SDK call', async () => {
  const boundaries: Boundary[] = ['where', 'document-id', 'order', 'after', 'limit', 'collection', 'query', 'page', 'page-data'];
  for (const stopAt of boundaries) {
    const h = await harness({ stopAt }), repo = await h.service.createFirebaseCloudPatients(h.auth, { isActive: () => h.active.value });
    seedProfile(h, OTHER, 2);
    await assert.rejects(repo.findByPhone(h.copy({ mobile: '01000000001', afterId: ID })), failed);
    const stop = h.calls.indexOf(stopAt);
    assert.ok(stop !== -1); assert.equal(h.calls.length, stop + 1, `No SDK call after ${stopAt}`);
  }
});

test('patient transaction lifecycle rejects reads/writes and late acknowledgement without claiming server rollback', async () => {
  for (const stopAt of ['transaction-read', 'transaction-exists', 'transaction-data', 'transaction-write', 'transaction-ack'] as Boundary[]) {
    const h = await harness({ stopAt }), repo = await h.service.createFirebaseCloudPatients(h.auth, { isActive: () => h.active.value });
    seedIntent(h);
    await assert.rejects(repo.commit(h.payload), failed);
    assert.equal(h.rows.size, stopAt === 'transaction-ack' ? 5 : 2);
    if (stopAt === 'transaction-read' || stopAt === 'transaction-exists' || stopAt === 'transaction-data') {
      assert.equal(h.calls.some(call => call.startsWith('set:')), false);
    }
  }
});

test('all patient operations stop before SDK reads when retained lifecycle is inactive', async () => {
  const h = await harness(), repo = await h.service.createFirebaseCloudPatients(h.auth, { isActive: () => h.active.value });
  h.active.value = false; const before = [...h.calls];
  for (const action of [() => repo.get(ID), () => repo.getByFileNo(1), () => repo.listPage(),
    () => repo.findByPhone(h.copy({ mobile: '01000000001' })), () => repo.commit(h.payload)]) await assert.rejects(action(), failed);
  assert.deepEqual(h.calls, before); assert.equal(h.rows.size, 1);
});

test('adapter path fence independently rejects clinical costs, other clinics, receipts outside transactions and noncanonical file paths', async () => {
  const h = await harness({ raw: true }), adapter = await h.service.createFirebaseCloudPatients(h.auth);
  const forbidden = ['clinics/other/patientFiles/1', 'clinics/main/patientFiles/01', 'clinics/main/patientFiles/0',
    'clinics/main/patientFiles/2000000001', 'clinics/main/patientFiles/1.0', 'clinics/main/patientFiles/١',
    `clinics/main/patientProfiles/${ID}/extra`, 'clinics/main/labCosts/private', `clinics/main/members/${UID}`,
    'clinics/main/contactRecords/' + ID, `clinics/main/patientProfiles/${ID}\n`, 'clinics/main/patientFiles/1\n',
    `clinics/main/patientOperations/${OP}\n`];
  const before = h.calls.length;
  for (const path of [...forbidden, COUNTER, `clinics/main/patientOperations/${OP}`]) {
    await assert.rejects(adapter.readRecord(path), /SAFE_PATIENT_invalid/);
  }
  assert.equal(h.calls.length, before);
  for (const path of forbidden) await assert.rejects(adapter.runTransaction(async (tx: any) => tx.get(path)), /SAFE_PATIENT_invalid/);
  assert.equal(h.calls.some(call => call.startsWith('get:') || call.startsWith('set:')), false);
});

test('adapter raw query seam independently rejects malformed cursor/hash/limit before constructing SDK queries', async () => {
  const h = await harness({ raw: true }), adapter = await h.service.createFirebaseCloudPatients(h.auth), before = [...h.calls];
  for (const args of [[null, 0], [null, 51], [null, 1.5], ['not-a-uuid', 1], [`${ID}\n`, 1], [undefined, 1]]) {
    await assert.rejects(adapter.listRecordsPage(...args), /SAFE_PATIENT_invalid/);
  }
  for (const key of ['', 'hash', 'A'.repeat(64), `${PHONE_KEY}\n`]) await assert.rejects(adapter.findRecordsByPhone(key, null, 25), /SAFE_PATIENT_invalid/);
  assert.deepEqual(h.calls, before);
});

test('journaled patient SDK refuses unprepared domain writes and exposes a frozen bounded journal capability', async () => {
  const h = await harness(), repo = await h.service.createFirebaseCloudPatients(h.auth);
  assert.equal(Object.isFrozen(repo), true); assert.equal(Object.isFrozen(repo.journal), true);
  assert.deepEqual(Object.keys(repo.journal).sort(), ['cancel', 'get', 'listHistoryPage', 'listPreparedPage', 'prepare']);
  await assert.rejects(repo.commit(h.payload));
  assert.equal(h.calls.some(call => call.startsWith('set:')), false); assert.equal(h.rows.size, 1);
  assert.equal('auth' in repo || 'app' in repo || 'repository' in repo, false);
});

test('patient journal prepare keeps envelope time separate and validates the complete command before SDK access', async () => {
  const h = await harness(), repo = await h.service.createFirebaseCloudPatients(h.auth), baseline = [...h.calls];
  for (const input of [{ ...h.payload, createdAt: CREATED }, { ...h.payload, profile: { ...h.payload.profile, age: 999 } },
    { ...h.payload, fileNo: 500 }, { ...h.payload, profile: { ...h.payload.profile, sessions: [] } }]) {
    await assert.rejects(repo.journal.prepare('patient-profile', h.copy(input), CREATED));
  }
  for (const kind of ['clinical', 'contact', 'catalog', 'invalid']) await assert.rejects(repo.journal.prepare(kind, h.payload, CREATED));
  for (const time of ['', '2026-02-30T09:00:00.000Z', `${CREATED}\n`]) await assert.rejects(repo.journal.prepare('patient-profile', h.payload, time));
  assert.deepEqual(h.calls, baseline);
  const intent = await repo.journal.prepare('patient-profile', h.payload, CREATED);
  assert.equal(intent.createdAt, CREATED); assert.equal('createdAt' in intent.command, false);
  assert.equal(intent.status, 'prepared'); assert.equal(h.rows.size, 2); assert.equal(h.rows.get(COUNTER).lastFileNo, 0);
  await repo.commit(h.payload);
  const receipt = h.rows.get(`clinics/main/patientOperations/${OP}`);
  assert.equal(receipt.intentCreatedAt, CREATED); assert.equal(receipt.intentRequestHash, intent.requestHash);
  assert.equal(h.rows.get(`clinics/main/operationIntents/${OP}`).status, 'committed');
});

test('patient journal snapshots command and query arguments before authorization yields', async () => {
  const h = await harness(), repo = await h.service.createFirebaseCloudPatients(h.auth);
  const original = h.copy(h.payload), pending = repo.journal.prepare('patient-profile', h.payload, CREATED);
  h.payload.profile.name = 'mutated after click'; h.payload.recordId = OTHER;
  const saved = await pending;
  assert.equal(saved.command.recordId, original.recordId); assert.equal(saved.command.profile.name, original.profile.name);
  const query = h.copy({ limit: 1 }), page = repo.journal.listHistoryPage('patient-profile', query); query.limit = 999;
  assert.equal((await page).records.length, 1);
  assert.ok(h.calls.some(call => call.startsWith('query:') && call.includes('"count":1')));
});

test('patient journal prepare rejects malicious getters without invoking them or scheduling a transaction', async () => {
  const h = await harness(), repo = await h.service.createFirebaseCloudPatients(h.auth), before = [...h.calls];
  const malicious = h.copy(h.payload); let invoked = 0;
  Object.defineProperty(malicious.profile, 'name', { enumerable: true, get() { invoked++; return 'unsafe'; } });
  await assert.rejects(repo.journal.prepare('patient-profile', malicious, CREATED));
  assert.equal(invoked, 0); assert.deepEqual(h.calls, before);
});

test('patient journal cancellation validates domain command actor kind path and envelope before any hidden write', async () => {
  const corruptions = [
    (h: Awaited<ReturnType<typeof harness>>) => seedIntent(h, h.copy({ ...h.payload, createdAt: CREATED })),
    (h: Awaited<ReturnType<typeof harness>>) => seedIntent(h, h.copy({ ...h.payload, profile: { ...h.payload.profile, age: 999 } })),
    (h: Awaited<ReturnType<typeof harness>>) => seedIntent(h, h.payload, CREATED, 'contact'),
    (h: Awaited<ReturnType<typeof harness>>) => seedIntent(h, h.payload, CREATED, 'patient-profile', 'different-owner'),
    (h: Awaited<ReturnType<typeof harness>>) => seedIntent(h, h.payload, 'bad time'),
    (h: Awaited<ReturnType<typeof harness>>) => { const saved = seedIntent(h); saved.operationId = OTHER; saved.recordId = OTHER;
      saved.command.operationId = OTHER; h.rows.set(`clinics/main/operationIntents/${OP}`, h.copy(saved)); },
  ];
  for (const corrupt of corruptions) {
    const h = await harness(), repo = await h.service.createFirebaseCloudPatients(h.auth); corrupt(h);
    const before = JSON.stringify([...h.rows]);
    await assert.rejects(repo.journal.cancel(OP));
    assert.equal(JSON.stringify([...h.rows]), before); assert.equal(h.calls.some(call => call.startsWith('set:')), false);
  }
});

test('patient journal all-status history is owner-kind bounded UUID paged without losing committed acknowledgements', async () => {
  const h = await harness(), repo = await h.service.createFirebaseCloudPatients(h.auth);
  const second = h.copy({ ...h.payload, operationId: OTHER });
  await repo.journal.prepare('patient-profile', h.payload, CREATED); await repo.commit(h.payload);
  await repo.journal.prepare('patient-profile', second, CREATED);
  const history = await repo.journal.listHistoryPage('patient-profile', h.copy({ limit: 1 }));
  assert.equal(history.records[0].operationId, OTHER); assert.equal(history.nextAfterId, OTHER);
  const tail = await repo.journal.listHistoryPage('patient-profile', h.copy({ afterId: OTHER, limit: 1 }));
  assert.equal(tail.records[0].status, 'committed'); assert.equal(tail.records[0].operationId, OP);
  const prepared = await repo.journal.listPreparedPage('patient-profile'); assert.equal(prepared.records.length, 1);
  assert.equal(prepared.records[0].operationId, OTHER);
  const cancelled = await repo.journal.cancel(OTHER); assert.equal(cancelled.status, 'cancelled');
  assert.equal((await repo.journal.listHistoryPage('patient-profile')).records.length, 2);
  assert.equal((await repo.journal.listPreparedPage('patient-profile')).records.length, 0);
  await assert.rejects(repo.journal.cancel(OP));
});

test('patient journal page bounds and unrelated kinds reject before another SDK query', async () => {
  const h = await harness(), repo = await h.service.createFirebaseCloudPatients(h.auth), before = [...h.calls];
  for (const kind of ['contact', 'clinical', 'catalog']) {
    await assert.rejects(repo.journal.listPreparedPage(kind)); await assert.rejects(repo.journal.listHistoryPage(kind));
  }
  for (const input of [{ limit: 0 }, { limit: 51 }, { limit: 1.5 }, { afterId: `${ID}\n` }, { unexpected: true }]) {
    await assert.rejects(repo.journal.listHistoryPage('patient-profile', h.copy(input)));
  }
  assert.deepEqual(h.calls, before);
});

test('patient journal lost prepare and commit ACKs recover after capability recreation without another file number', async () => {
  const flags = { loseAck: true }, h = await harness(flags), repo = await h.service.createFirebaseCloudPatients(h.auth);
  await assert.rejects(repo.journal.prepare('patient-profile', h.payload, CREATED));
  const fresh = await h.service.createFirebaseCloudPatients(h.auth);
  assert.equal((await fresh.journal.get(OP)).status, 'prepared');
  await fresh.journal.prepare('patient-profile', h.payload, CREATED);
  flags.loseAck = true; await assert.rejects(fresh.commit(h.payload), failed);
  const next = await h.service.createFirebaseCloudPatients(h.auth), writes = h.calls.filter(call => call.startsWith('set:')).length;
  assert.equal((await next.journal.listHistoryPage('patient-profile')).records[0].status, 'committed');
  assert.equal((await next.commit(h.payload)).status, 'already-committed');
  assert.equal(h.calls.filter(call => call.startsWith('set:')).length, writes); assert.equal(h.rows.get(COUNTER).lastFileNo, 1);
});

test('patient SDK historical replay preserves a newer profile and counter without reading or rewriting either', async () => {
  const h = await harness(), repo = await h.service.createFirebaseCloudPatients(h.auth);
  await repo.journal.prepare('patient-profile', h.payload, CREATED); await repo.commit(h.payload);
  const update = h.copy({ ...h.payload, operationId: OTHER, expectedRevision: 1, action: 'update',
    profile: { ...h.payload.profile, name: 'newer synthetic patient' } });
  await repo.journal.prepare('patient-profile', update, CREATED); await repo.commit(update);
  h.rows.get(COUNTER).lastFileNo = 450;
  const count = h.calls.length, before = JSON.stringify([...h.rows]);
  assert.equal((await repo.commit(h.payload)).revision, 1); assert.equal(JSON.stringify([...h.rows]), before);
  assert.equal(h.calls.slice(count).some(call => call === `get:${COUNTER}` || call === `get:clinics/main/patientProfiles/${ID}` || call.startsWith('set:')), false);
});

test('retained patient capability permanently revokes across same-UID identity app and runtime restoration', async () => {
  for (const loss of ['user', 'app', 'host', 'active']) {
    const h = await harness(), repo = await h.service.createFirebaseCloudPatients(h.auth, { isActive: () => h.active.value });
    const originalUser = h.auth.currentUser, originalApp = h.auth.app;
    if (loss === 'user') h.auth.currentUser = { ...originalUser! };
    if (loss === 'app') h.auth.app = { ...originalApp };
    if (loss === 'host') h.location.hostname = 'public.invalid';
    if (loss === 'active') h.active.value = false;
    await assert.rejects(repo.journal.get(OP));
    h.auth.currentUser = originalUser; h.auth.app = originalApp; h.location.hostname = '127.0.0.1'; h.active.value = true;
    const before = [...h.calls];
    for (const action of [() => repo.get(ID), () => repo.commit(h.payload), () => repo.journal.get(OP),
      () => repo.journal.prepare('patient-profile', h.payload, CREATED), () => repo.journal.cancel(OP),
      () => repo.journal.listHistoryPage('patient-profile')]) await assert.rejects(action());
    assert.deepEqual(h.calls, before);
  }
});

test('patient journal lifecycle checks every query and cancellation snapshot boundary before writes', async () => {
  for (const stopAt of ['where', 'document-id', 'order', 'after', 'limit', 'collection', 'query', 'page', 'page-data'] as Boundary[]) {
    const h = await harness({ stopAt }), repo = await h.service.createFirebaseCloudPatients(h.auth, { isActive: () => h.active.value });
    seedIntent(h);
    await assert.rejects(repo.journal.listHistoryPage('patient-profile', h.copy({ afterId: OTHER })));
    const stop = h.calls.indexOf(stopAt); assert.ok(stop !== -1); assert.equal(h.calls.length, stop + 1);
  }
  for (const stopAt of ['transaction-read', 'transaction-exists', 'transaction-data'] as Boundary[]) {
    const h = await harness({ stopAt }), repo = await h.service.createFirebaseCloudPatients(h.auth, { isActive: () => h.active.value }); seedIntent(h);
    await assert.rejects(repo.journal.cancel(OP)); assert.equal(h.calls.some(call => call.startsWith('set:')), false);
    assert.equal(h.rows.get(`clinics/main/operationIntents/${OP}`).status, 'prepared');
  }
});
