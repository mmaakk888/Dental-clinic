import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';

// Actual appointment/journal contracts against a synthetic Lite SDK. No live
// Firebase, real account, patient fixture, browser storage, Rules or network.
const ID = '10000000-0000-4000-8000-000000000001';
const EARLIER = '00000000-0000-4000-8000-000000000001';
const OP = '20000000-0000-4000-8000-000000000001';
const OP2 = '20000000-0000-4000-8000-000000000002';
const OTHER = '30000000-0000-4000-8000-000000000001';
const UID = 'synthetic-appointment-sdk-owner';
const PROJECT = 'dental-clinic-mmaakk888';
const WHEN = '2026-10-12T00:00:00.000Z';
const DATE = '2026-10-12';
const path = (kind: string, id = OP) => `clinics/main/${kind}/${id}`;
const RECORD = path('appointmentRecords', ID), DAY = path('appointmentDays', DATE);
let bundle: ReturnType<typeof build> | undefined, rawBundle: ReturnType<typeof build> | undefined;
function compiled(raw: boolean) {
  const options = { entryPoints: ['src/utils/firebaseCloudAppointments.ts'], bundle: true, write: false, metafile: true,
    platform: 'node' as const, format: 'cjs' as const, supported: { 'dynamic-import': false }, logLevel: 'silent' as const };
  if (raw) return rawBundle ??= build({ ...options, external: ['firebase/*', './cloudAppointmentRepository', './cloudOperationIntent'] });
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
  const user = { uid: UID, email: 'appointment-owner@example.invalid', emailVerified: options.verified ?? true };
  const location = { hostname: options.hostname ?? '127.0.0.1' };
  const auth = { app: { name: options.appName ?? `clinic-operating-${ID}`, options: {
    projectId: options.projectId ?? PROJECT, authDomain: options.authDomain ?? `${PROJECT}.firebaseapp.com` } },
    emulatorConfig: options.emulator ? {} : null, currentUser: user as typeof user | null };
  const rows = new Map<string, any>(), active = { value: true };
  const rawAdapters: { appointments?: any; journal?: any } = {};
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
      if (name === './cloudAppointmentRepository' && options.raw) return {
        createCloudAppointmentRepository: (adapter: unknown) => { rawAdapters.appointments = adapter; return adapter; },
        CloudAppointmentError: class extends Error { constructor(public code: string) { super(`SAFE_APPOINTMENT_${code}`); } },
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
          assert.equal(app, auth.app); assert.equal(databaseId, '(default)'); step('database'); return 'synthetic-appointment-db';
        },
        doc: (db: unknown, ...parts: string[]) => {
          assert.equal(db, 'synthetic-appointment-db'); const key = parts.join('/');
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
        collection: (db: unknown, ...parts: string[]) => { assert.equal(db, 'synthetic-appointment-db'); step('collection'); return parts.join('/'); },
        documentId: () => { step('document-id'); return '__name__'; },
        orderBy: (field: string) => { step('order'); return { kind: 'order', field }; },
        where: (field: string, operator: string, value: string) => { step('where'); return { kind: 'where', field, operator, value }; },
        startAfter: (id: string) => { step('after'); return { kind: 'after', id }; },
        limit: (count: number) => { step('limit'); return { kind: 'limit', count }; },
        query: (key: string, ...constraints: any[]) => { calls.push(`query:${key}:${JSON.stringify(constraints)}`); step('query'); return { key, constraints }; },
        getDocs: async (request: any) => {
          const appointmentPage = request.key === 'clinics/main/appointmentRecords';
          assert.ok(appointmentPage || request.key === 'clinics/main/operationIntents');
          const predicates = request.constraints.filter((value: any) => value.kind === 'where');
          if (appointmentPage) assert.deepEqual(predicates, [{ kind: 'where', field: 'data.date', operator: '==', value: DATE }]);
          else assert.deepEqual(predicates, [
            { kind: 'where', field: 'actorUid', operator: '==', value: UID },
            { kind: 'where', field: 'kind', operator: '==', value: 'appointment' },
            ...(predicates.length === 2 ? [] : [{ kind: 'where', field: 'status', operator: '==', value: 'prepared' }]),
          ]);
          assert.deepEqual(request.constraints.find((value: any) => value.kind === 'order'), { kind: 'order', field: '__name__' });
          assert.equal(request.constraints.at(-1).kind, 'limit');
          const count = request.constraints.at(-1).count;
          assert.ok(Number.isSafeInteger(count) && count >= 1 && count <= 50);
          const after = request.constraints.find((value: any) => value.kind === 'after')?.id;
          step('page'); if (options.denyRead) throw new Error('PRIVATE_SDK_PAGE_DENIED');
          const values = [...rows].filter(([key, value]) => key.startsWith(`${request.key}/`)
            && (!after || key.split('/').at(-1)! > after)
            && predicates.every((p: any) => (p.field === 'data.date' ? value.data?.date : value[p.field]) === p.value))
            .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).slice(0, count);
          return { get docs() { step('page-docs'); return values.map(([key, value]) => ({
            get id() { step('page-id'); return key.split('/').at(-1); },
            data: () => { step('page-data'); return value; },
          })); } };
        },
        runTransaction: async (db: unknown, work: any, settings: any) => {
          assert.equal(db, 'synthetic-appointment-db'); assert.equal(settings.maxAttempts, 5); step('transaction-start');
          const attempt = async (publish: boolean) => {
            const staged = new Map(rows); let wrote = false;
            const result = await work({
              get: async (key: string) => {
                assert.equal(wrote, false, 'all reads precede writes'); calls.push(`get:${key}`); step('transaction-read');
                return snapshot(key, 'transaction', staged);
              },
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
  const payload = copy({ operationId: OP, recordId: ID, expectedRevision: 0, createdAt: WHEN, data: {
    patientRecordId: null, patientName: 'مريض موعد مصطنع', phone: '201000000001', date: DATE, time: '10:00',
    durationMinutes: 30, status: 'scheduled', reason: 'متابعة', notes: '', doctorName: 'طبيب مصطنع',
    appointmentType: 'كشف', isFollowUp: false, isWalkIn: false,
  } });
  return { service: module.exports, auth, user, calls, rows, payload, compiled: output, active, copy, location, options, rawAdapters };
}
const failed = (error: any) => ['invalid', 'unavailable', 'conflict'].includes(error?.code) && !String(error).includes('PRIVATE');
const safe = (error: unknown) => /SAFE_(APPOINTMENT|INTENT)_(invalid|unavailable|conflict)/.test(String(error)) && !String(error).includes('PRIVATE');
async function capability(h: Awaited<ReturnType<typeof harness>>) {
  return h.service.createFirebaseCloudAppointments(h.auth, { isActive: () => h.active.value });
}
async function prepared(h: Awaited<ReturnType<typeof harness>>, value?: any) {
  const service = await capability(h); await service.journal.prepare('appointment', value ?? h.payload, WHEN); return service;
}

test('appointment SDK import is inert and excludes App/UI/local storage/backup/clinical finance dependencies', async () => {
  const h = await harness(); assert.deepEqual(h.calls, []); assert.equal(h.rows.size, 0);
  assert.equal(Object.keys(h.compiled.metafile!.inputs).some(key => /utils\/(?:storage|localClinicBackup|firebaseService|offlineSync|cloudClinicalRepository)|App\.tsx|components\//.test(key)), false);
});

test('appointment factory demands exact active operating app/project/domain and loopback without emulators', async () => {
  for (const options of [{ hostname: 'public.example.invalid' }, { projectId: 'zippy-dispatcher-m1ttq' },
    { authDomain: 'other.firebaseapp.com' }, { appName: '[DEFAULT]' }, { appName: `clinic-owner-setup-${ID}` },
    { appName: `clinic-operating-${ID}\n` }, { appName: 'clinic-operating-00000000-0000-0000-0000-000000000000' }, { emulator: true }]) {
    const h = await harness(options); await assert.rejects(capability(h), failed); assert.deepEqual(h.calls, []);
  }
  for (const options of [undefined, {}, { isActive: () => false }, { isActive: () => { throw new Error('PRIVATE_LEASE'); } }]) {
    const h = await harness(); await assert.rejects(h.service.createFirebaseCloudAppointments(h.auth, options), failed); assert.deepEqual(h.calls, []);
  }
});

test('appointment construction lazily imports Lite without reading, authorizing, writing or allocating data', async () => {
  const h = await harness(), service = await capability(h);
  assert.deepEqual(h.calls, ['import:firebase/auth', 'import:firebase/firestore/lite', 'database']);
  assert.deepEqual(Object.keys(service).sort(), ['journal', 'repository']);
  assert.deepEqual(Object.keys(service.repository).sort(), ['commit', 'get', 'getDay', 'listDayPage']); assert.equal(h.rows.size, 0);
  assert.equal(Object.isFrozen(service), true); assert.equal(Object.isFrozen(service.repository), true); assert.equal(Object.isFrozen(service.journal), true);
});

test('missing appointment and day are unknown null with fresh authorization, never seeded empty records', async () => {
  const h = await harness(), service = await capability(h);
  assert.equal(await service.repository.get(ID), null); assert.equal(await service.repository.getDay(DATE), null);
  assert.equal(h.rows.size, 0); assert.equal(h.calls.filter(call => call === 'token').length, 6);
  assert.deepEqual(h.calls.filter(call => call.startsWith('read:')), [`read:${RECORD}`, `read:${DAY}`]);
});

test('appointment requires prepared intent then atomically writes only its record/day/receipt/intent; replay is read-only', async () => {
  const h = await harness(), service = await capability(h);
  await assert.rejects(service.repository.commit(h.payload), failed); assert.equal(h.rows.size, 0);
  await service.journal.prepare('appointment', h.payload, WHEN);
  assert.equal((await service.repository.commit(h.payload)).status, 'committed');
  assert.deepEqual([...h.rows.keys()].sort(), [RECORD, DAY, path('appointmentOperations'), path('operationIntents')].sort());
  assert.equal(h.rows.get(RECORD).revision, 1); assert.equal(h.rows.get(DAY).slots[0].recordId, ID);
  assert.equal(h.rows.get(path('operationIntents')).status, 'committed');
  const writes = h.calls.filter(call => call.startsWith('set:')).length;
  assert.equal((await service.repository.commit(h.payload)).status, 'already-committed');
  assert.equal(h.calls.filter(call => call.startsWith('set:')).length, writes);
  assert.equal((await service.repository.get(ID)).data.patientName, 'مريض موعد مصطنع');
  assert.equal((await service.repository.getDay(DATE)).slots.length, 1);
});

test('linked appointment requires a freshly validated patient UUID inside its transaction and never changes the profile', async () => {
  const h = await harness(), linked = h.copy({ ...h.payload, data: { ...h.payload.data, patientRecordId: OTHER } });
  const service = await prepared(h, linked);
  await assert.rejects(service.repository.commit(linked), (error: any) => error.code === 'conflict');
  assert.equal(h.rows.has(RECORD), false); assert.equal(h.rows.get(path('operationIntents')).status, 'prepared');
  const profile = h.copy({ schemaVersion: 1, clinicId: 'main', recordId: OTHER, fileNo: 451, revision: 1,
    lastOperationId: OTHER, phoneKey: createHash('sha256').update('patient-phone-v1:201000000001').digest('hex'),
    data: { name: 'ملف مصطنع', mobile: '01000000001', age: 30, gender: '', firstVisit: DATE, notes: '', allergy: '' } });
  h.rows.set(path('patientProfiles', OTHER), profile);
  const before = JSON.stringify(profile); assert.equal((await service.repository.commit(linked)).status, 'committed');
  assert.equal(JSON.stringify(h.rows.get(path('patientProfiles', OTHER))), before);
  assert.ok(h.calls.includes(`get:${path('patientProfiles', OTHER)}`));
  assert.equal(h.calls.includes(`read:${path('patientProfiles', OTHER)}`), false);
  assert.equal(h.calls.includes(`set:${path('patientProfiles', OTHER)}`), false);
  // An accepted historical booking does not depend on newer/current profile
  // contents or rewrite the reservation to fit them.
  h.rows.delete(path('patientProfiles', OTHER)); const calls = h.calls.length;
  assert.equal((await service.repository.commit(linked)).status, 'already-committed');
  assert.equal(h.calls.slice(calls).includes(`get:${path('patientProfiles', OTHER)}`), false);
});

test('appointment move atomically transfers old/new day slots; replay of the old booking cannot resurrect its previous slot', async () => {
  const h = await harness(), service = await prepared(h); await service.repository.commit(h.payload);
  const moved = h.copy({ ...h.payload, operationId: OP2, expectedRevision: 1,
    data: { ...h.payload.data, date: '2026-10-13', time: '14:00' } });
  await service.journal.prepare('appointment', moved, WHEN); assert.equal((await service.repository.commit(moved)).status, 'committed');
  assert.equal(h.rows.get(DAY).slots.length, 0);
  assert.equal(h.rows.get(path('appointmentDays', '2026-10-13')).slots[0].startMinute, 840);
  assert.equal(h.rows.get(RECORD).revision, 2); assert.equal(h.rows.get(RECORD).data.date, '2026-10-13');
  const before = JSON.stringify([...h.rows]), writes = h.calls.filter(call => call.startsWith('set:')).length;
  assert.equal((await service.repository.commit(h.payload)).status, 'already-committed');
  assert.equal(h.calls.filter(call => call.startsWith('set:')).length, writes); assert.equal(JSON.stringify([...h.rows]), before);
});

test('appointment owner rejects unverified/nonpassword/foreign claims and disabled malformed membership before data reads', async () => {
  for (const options of [{ verified: false }, { tokenVerified: false }, { provider: 'google.com' },
    { claims: { dentalClinicRole: 'secretary' } }, { claims: { dentalClinicId: 'other' } },
    { claims: { sub: 'another-owner' } }, { claims: { aud: 'another-project' } }, { claims: { auth_time: 99 } },
    { missingMember: true }, { member: { status: 'disabled' } }, { member: { uid: 'another-owner' } },
    { member: { role: 'secretary' } }, { member: { verifiedAfter: 101 } }, { member: { extra: true } }]) {
    const h = await harness(options), service = await capability(h);
    await assert.rejects(service.repository.getDay(DATE), failed);
    assert.equal(h.calls.some(call => call.startsWith('read:') || call.startsWith('get:') || call.startsWith('set:')), false);
  }
});

test('appointment command and journal prepare snapshot before owner awaits; caller edits cannot change a retained operation', async () => {
  const h = await harness(), service = await prepared(h);
  let release!: () => void; h.options.tokenGate = new Promise<void>(resolve => { release = resolve; });
  const pending = service.repository.commit(h.payload); h.payload.data.time = '15:00'; h.payload.data.patientName = 'تعديل متأخر'; release();
  assert.equal((await pending).status, 'committed'); assert.equal(h.rows.get(RECORD).data.time, '10:00');
  const fresh = await harness(), writer = await capability(fresh);
  fresh.options.tokenGate = new Promise<void>(resolve => { release = resolve; });
  const preparing = writer.journal.prepare('appointment', fresh.payload, WHEN); fresh.payload.data.time = '16:00'; release();
  assert.equal((await preparing).command.data.time, '10:00');
});

test('appointment malformed/generic/foreign-kind journal input or unequal envelope time fails before SDK access', async () => {
  const h = await harness(), service = await capability(h), before = [...h.calls];
  for (const value of [{ operationId: OP }, { ...h.payload, unknown: true }, { ...h.payload, expectedRevision: -1 },
    { ...h.payload, data: { ...h.payload.data, date: '2026-02-30' } }, { ...h.payload, data: { ...h.payload.data, durationMinutes: 0 } }]) {
    await assert.rejects(service.journal.prepare('appointment', h.copy(value), WHEN), failed);
  }
  for (const kind of ['catalog', 'clinical', 'contact', 'patient-profile', 'unknown']) await assert.rejects(service.journal.prepare(kind, h.payload, WHEN), failed);
  await assert.rejects(service.journal.prepare('appointment', h.payload, '2026-10-12T00:00:01.000Z'), failed);
  assert.deepEqual(h.calls, before);
});

test('appointment stale CAS never updates record/day or converts prepared intent to a receipt', async () => {
  const h = await harness(), service = await prepared(h); await service.repository.commit(h.payload);
  const stale = h.copy({ ...h.payload, operationId: OP2, data: { ...h.payload.data, time: '12:00' } });
  await service.journal.prepare('appointment', stale, WHEN); const writes = h.calls.filter(call => call.startsWith('set:')).length;
  await assert.rejects(service.repository.commit(stale), (error: any) => error.code === 'conflict');
  assert.equal(h.calls.filter(call => call.startsWith('set:')).length, writes);
  assert.equal(h.rows.get(RECORD).data.time, '10:00'); assert.equal(h.rows.get(path('operationIntents', OP2)).status, 'prepared');
  assert.equal(h.rows.has(path('appointmentOperations', OP2)), false);
});

test('appointment history uses bounded actor/kind queries, explicit UUID cursors and default25, including cancelled records', async () => {
  const h = await harness(), service = await prepared(h);
  await service.journal.prepare('appointment', h.copy({ ...h.payload, operationId: OP2 }), WHEN);
  const first = await service.journal.listPreparedPage('appointment', h.copy({ limit: 1 }));
  assert.equal(first.records[0].operationId, OP); assert.equal(first.nextAfterId, OP);
  const second = await service.journal.listPreparedPage('appointment', h.copy({ afterId: OP, limit: 1 }));
  assert.equal(second.records[0].operationId, OP2);
  await service.journal.cancel(OP2); await service.repository.commit(h.payload);
  assert.equal((await service.journal.listPreparedPage('appointment')).records.length, 0);
  const history = await service.journal.listHistoryPage('appointment');
  assert.equal(history.records.length, 2); assert.equal(history.records[1].status, 'cancelled');
  assert.ok(h.calls.some(call => call.startsWith('query:') && call.includes('"count":25')));
});

test('appointment lost commit acknowledgement remains discoverable and exact new-capability replay never rebooks', async () => {
  const h = await harness(), first = await prepared(h); h.options.lostReply = true;
  await assert.rejects(first.repository.commit(h.payload), failed);
  const fresh = await capability(h); assert.equal((await fresh.journal.listPreparedPage('appointment')).records.length, 0);
  const history = await fresh.journal.listHistoryPage('appointment', h.copy({ limit: 1 }));
  assert.equal(history.records[0].status, 'committed'); assert.equal(history.records[0].operationId, OP);
  const writes = h.calls.filter(call => call.startsWith('set:')).length;
  assert.equal((await fresh.repository.commit(history.records[0].command)).status, 'already-committed');
  assert.equal(h.calls.filter(call => call.startsWith('set:')).length, writes); assert.equal(h.rows.get(DAY).slots.length, 1);
});

test('appointment lost prepare acknowledgement and transaction callback retry preserve one original booking', async () => {
  const h = await harness({ lostReply: true }), first = await capability(h);
  await assert.rejects(first.journal.prepare('appointment', h.payload, WHEN), failed);
  assert.equal(h.rows.get(path('operationIntents')).status, 'prepared'); assert.equal(h.rows.has(RECORD), false);
  const fresh = await capability(h), recovered = (await fresh.journal.listHistoryPage('appointment')).records[0];
  h.options.retryOnce = true; assert.equal((await fresh.repository.commit(recovered.command)).status, 'committed');
  assert.equal((await fresh.repository.commit(recovered.command)).status, 'already-committed');
  assert.equal(h.rows.get(DAY).revision, 1); assert.equal(h.rows.get(DAY).slots.length, 1);
});

test('appointment history excludes other owners/domains and exposes no lab, finance or profile query', async () => {
  const h = await harness(), service = await prepared(h);
  for (const [id, actorUid, kind] of [[OP2, 'other-owner', 'appointment'], [OTHER, UID, 'clinical']]) {
    h.rows.set(path('operationIntents', id), h.copy({ ...h.rows.get(path('operationIntents')), recordId: id, operationId: id, actorUid, kind }));
  }
  assert.equal((await service.journal.listHistoryPage('appointment')).records.length, 1);
  assert.equal(h.calls.some(call => /doc:.*(?:clinicalOperations|patientOperations|contactOperations|patientAccounts|labCosts)/.test(call)), false);
});

test('appointment history page inputs snapshot before awaits and invalid cursors/bounds/kinds fail before query construction', async () => {
  const h = await harness(), service = await prepared(h);
  for (const method of ['listPreparedPage', 'listHistoryPage']) {
    const input = h.copy({ afterId: null, limit: 1 }); let release!: () => void;
    h.options.tokenGate = new Promise<void>(resolve => { release = resolve; });
    const pending = service.journal[method]('appointment', input); input.limit = 50; input.afterId = OP; release();
    assert.equal((await pending).records.length, 1);
  }
  const before = [...h.calls];
  for (const method of ['listPreparedPage', 'listHistoryPage']) {
    for (const input of [{ limit: 0 }, { limit: 51 }, { limit: 1.5 }, { afterId: OP + '\n' }, { unexpected: true }]) {
      await assert.rejects(service.journal[method]('appointment', h.copy(input)), failed);
    }
    for (const kind of ['contact', 'clinical', 'patient-profile', 'catalog']) await assert.rejects(service.journal[method](kind), failed);
  }
  assert.deepEqual(h.calls, before);
});

test('appointment date pages explicitly query all statuses in one date with bounded exclusive UUID ordering', async () => {
  const h = await harness(), service = await prepared(h); await service.repository.commit(h.payload);
  const cancelled = h.copy({ ...h.payload, operationId: OP2, recordId: OTHER, data: { ...h.payload.data, status: 'cancelled' } });
  await service.journal.prepare('appointment', cancelled, WHEN); await service.repository.commit(cancelled);
  const first = await service.repository.listDayPage(h.copy({ date: DATE, limit: 1 }));
  assert.equal(first.records.length, 1); assert.equal(first.records[0].recordId, ID); assert.equal(first.nextAfterId, ID);
  const second = await service.repository.listDayPage(h.copy({ date: DATE, afterId: ID, limit: 1 }));
  assert.equal(second.records[0].recordId, OTHER); assert.equal(second.records[0].data.status, 'cancelled');
  assert.equal((await service.repository.getDay(DATE)).slots.length, 1, 'cancelled appointments are not active reservations');
  assert.equal((await service.repository.listDayPage(h.copy({ date: DATE }))).records.length, 2);
  assert.ok(h.calls.some(call => call.startsWith('query:clinics/main/appointmentRecords:') && call.includes('"count":25')));
});

test('appointment date-page input snapshots before authorization and malformed query controls cause no SDK access', async () => {
  const h = await harness(), service = await prepared(h); await service.repository.commit(h.payload);
  const input = h.copy({ date: DATE, limit: 1, afterId: null }); let release!: () => void;
  h.options.tokenGate = new Promise<void>(resolve => { release = resolve; });
  const pending = service.repository.listDayPage(input); input.date = '2026-10-13'; input.limit = 50; input.afterId = ID; release();
  assert.equal((await pending).records[0].recordId, ID);
  const before = [...h.calls];
  for (const query of [{ date: '2026-02-30' }, { date: DATE + '\n' }, { date: DATE, limit: 51 }, { date: DATE, limit: 0 },
    { date: DATE, limit: 1.5 }, { date: DATE, afterId: ID + '\n' }, { date: DATE, arbitrary: true }, {}]) {
    await assert.rejects(service.repository.listDayPage(h.copy(query)), failed);
  }
  assert.deepEqual(h.calls, before);
});

test('appointment date pages permanently revoke at query/document iterator boundaries, including same-UID replacement', async () => {
  for (const change of ['stopAt', 'swapAt'] as const) {
    for (const boundary of ['where', 'document-id', 'order', 'after', 'limit', 'collection', 'query', 'page', 'page-docs', 'page-id', 'page-data'] as Boundary[]) {
      const h = await harness(), service = await prepared(h); await service.repository.commit(h.payload); h.options[change] = boundary;
      await assert.rejects(service.repository.listDayPage(h.copy({ date: DATE, afterId: EARLIER })), failed);
      h.options[change] = undefined; h.active.value = true; h.auth.currentUser = h.user; const before = [...h.calls];
      await assert.rejects(service.repository.listDayPage(h.copy({ date: DATE })), failed); assert.deepEqual(h.calls, before);
    }
  }
});

test('appointment cancellation reads its exact immutable receipt and cannot cancel an accepted booking', async () => {
  const h = await harness(), service = await prepared(h); await service.repository.commit(h.payload);
  const writes = h.calls.filter(call => call.startsWith('set:')).length;
  await assert.rejects(service.journal.cancel(OP), failed);
  assert.equal(h.calls.filter(call => call.startsWith('set:')).length, writes);
  assert.equal(h.rows.get(path('operationIntents')).status, 'committed');
  assert.ok(h.calls.includes(`get:${path('appointmentOperations')}`));
});

test('appointment malformed full-domain intents cannot hide cancellation writes even with a recomputed generic hash', async () => {
  for (const mutation of ['command', 'createdAt', 'kind', 'actorUid', 'path', 'date', 'extra']) {
    for (const action of ['get', 'prepared', 'history', 'cancel']) {
      const h = await harness(), service = await prepared(h), intent = h.rows.get(path('operationIntents'));
      if (mutation === 'command') intent.command = h.copy({ operationId: OP, invalid: true });
      if (mutation === 'createdAt') intent.command.createdAt = '2026-10-12T00:00:01.000Z';
      if (mutation === 'kind') intent.kind = 'clinical';
      if (mutation === 'actorUid') intent.actorUid = 'other-owner';
      if (mutation === 'path') { intent.recordId = OP2; intent.operationId = OP2; intent.command.operationId = OP2; }
      if (mutation === 'date') intent.command.data.date = '2026-02-30';
      if (mutation === 'extra') intent.command.data.hidden = true;
      intent.requestHash = createHash('sha256').update(JSON.stringify(['clinic-operation-intent-v1', intent.actorUid, intent.kind, intent.command])).digest('hex');
      const writes = h.calls.filter(call => call.startsWith('set:')).length;
      if (['prepared', 'history'].includes(action) && ['kind', 'actorUid'].includes(mutation)) {
        assert.equal((await service.journal[action === 'prepared' ? 'listPreparedPage' : 'listHistoryPage']('appointment')).records.length, 0);
      } else await assert.rejects(action === 'get' ? service.journal.get(OP) : action === 'cancel' ? service.journal.cancel(OP)
        : service.journal[action === 'prepared' ? 'listPreparedPage' : 'listHistoryPage']('appointment'), failed);
      assert.equal(h.calls.filter(call => call.startsWith('set:')).length, writes); assert.equal(intent.status, 'prepared');
    }
  }
});

test('malformed persisted appointment/day returns no successful empty booking or guessed data', async () => {
  for (const target of ['record', 'day']) {
    const h = await harness(), service = await prepared(h); await service.repository.commit(h.payload);
    if (target === 'record') h.rows.get(RECORD).data.durationMinutes = -1;
    else h.rows.get(DAY).slots[0].endMinute = -1;
    await assert.rejects(target === 'record' ? service.repository.get(ID) : service.repository.getDay(DATE), failed);
  }
});

test('appointment SDK denials return fixed errors without local fallback or successful missing results', async () => {
  const h = await harness({ denyRead: true }), service = await capability(h);
  for (const action of [() => service.repository.get(ID), () => service.repository.getDay(DATE), () => service.journal.get(OP),
    () => service.journal.listPreparedPage('appointment'), () => service.journal.listHistoryPage('appointment')]) await assert.rejects(action(), failed);
  const denied = await harness({ denyWrite: true }), writer = await capability(denied);
  await assert.rejects(writer.journal.prepare('appointment', denied.payload, WHEN), failed); assert.equal(denied.rows.size, 0);
});

test('appointment reads check every owner/doc/snapshot boundary and permanently revoke after lease loss', async () => {
  for (const method of ['get', 'getDay']) {
    for (const stopAt of ['token', 'member-doc', 'member', 'member-exists', 'member-data', 'record-doc', 'record', 'record-exists', 'record-data'] as Boundary[]) {
      const h = await harness(), service = await prepared(h); await service.repository.commit(h.payload); h.options.stopAt = stopAt;
      await assert.rejects(service.repository[method](method === 'get' ? ID : DATE), failed);
      h.active.value = true; h.options.stopAt = undefined; const before = [...h.calls];
      await assert.rejects(service.repository[method](method === 'get' ? ID : DATE), failed); assert.deepEqual(h.calls, before);
    }
  }
});

test('appointment recovery pages stop at each query/snapshot SDK boundary before subsequent SDK calls', async () => {
  for (const method of ['listPreparedPage', 'listHistoryPage']) {
    for (const stopAt of ['where', 'document-id', 'order', 'after', 'limit', 'collection', 'query', 'page', 'page-docs', 'page-id', 'page-data'] as Boundary[]) {
      const h = await harness(), service = await prepared(h); h.options.stopAt = stopAt;
      await assert.rejects(service.journal[method]('appointment', h.copy({ afterId: ID })), failed);
      const stop = h.calls.lastIndexOf(stopAt); assert.notEqual(stop, -1, stopAt); assert.equal(h.calls.length, stop + 1);
    }
  }
});

test('appointment transactions fence every read/write/ack and reject late results without claiming server undo', async () => {
  for (const stopAt of ['transaction-start', 'transaction-read', 'transaction-exists', 'transaction-data', 'transaction-write', 'transaction-ack'] as Boundary[]) {
    const h = await harness(), service = await prepared(h); h.options.stopAt = stopAt;
    await assert.rejects(service.repository.commit(h.payload), failed);
    assert.equal(h.rows.has(RECORD), stopAt === 'transaction-ack');
    assert.equal(h.rows.get(path('operationIntents')).status, stopAt === 'transaction-ack' ? 'committed' : 'prepared');
  }
});

test('SDK promises own rejection when revocation occurs immediately after scheduling a denied read/page', async () => {
  for (const stopAt of ['record', 'page'] as Boundary[]) {
    const h = await harness({ denyRead: true, stopAt }), service = await capability(h);
    await assert.rejects(stopAt === 'record' ? service.repository.getDay(DATE) : service.journal.listHistoryPage('appointment'), failed);
    await Promise.resolve(); await Promise.resolve(); assert.equal(h.rows.size, 0);
  }
});

test('all retained appointment/journal methods permanently stop after logout/runtime/lease loss', async () => {
  for (const change of ['logout', 'runtime', 'lease']) {
    const h = await harness(), service = await prepared(h), before = [...h.calls];
    if (change === 'logout') h.auth.currentUser = null;
    if (change === 'runtime') h.location.hostname = 'public.example.invalid';
    if (change === 'lease') h.active.value = false;
    for (const action of [() => service.repository.get(ID), () => service.repository.getDay(DATE), () => service.repository.commit(h.payload),
      () => service.repository.listDayPage(h.copy({ date: DATE })),
      () => service.journal.prepare('appointment', h.payload, WHEN), () => service.journal.get(OP),
      () => service.journal.listPreparedPage('appointment'), () => service.journal.listHistoryPage('appointment'),
      () => service.journal.cancel(OP)]) await assert.rejects(action(), failed);
    assert.deepEqual(h.calls, before);
  }
});

test('same-UID replacement permanently revokes during owner/read/query/transaction work even when the original returns', async () => {
  for (const swapAt of ['token', 'member-doc', 'member', 'member-exists', 'member-data', 'record-doc', 'record', 'record-exists', 'record-data',
    'query', 'page-docs', 'page-id', 'page-data', 'transaction-read', 'transaction-data', 'transaction-write', 'transaction-ack'] as Boundary[]) {
    const h = await harness(), service = await prepared(h); h.options.swapAt = swapAt;
    const action = swapAt.startsWith('transaction') ? () => service.repository.commit(h.payload)
      : ['query', 'page-docs', 'page-id', 'page-data'].includes(swapAt) ? () => service.journal.listHistoryPage('appointment') : () => service.journal.get(OP);
    await assert.rejects(action(), failed); assert.equal(h.rows.has(RECORD), swapAt === 'transaction-ack');
    h.auth.currentUser = h.user; h.options.swapAt = undefined; const before = [...h.calls];
    await assert.rejects(service.repository.getDay(DATE), failed); assert.deepEqual(h.calls, before);
  }
});

test('appointment exact app object and UID cannot be replaced or mutated then restored to revive retained capabilities', async () => {
  for (const change of ['app-object', 'project', 'uid']) {
    const h = await harness(), service = await capability(h), originalApp = h.auth.app;
    if (change === 'app-object') h.auth.app = { ...originalApp, options: { ...originalApp.options } };
    if (change === 'project') h.auth.app.options.projectId = 'another-project';
    if (change === 'uid') h.user.uid = 'another-owner';
    const before = [...h.calls]; await assert.rejects(service.repository.getDay(DATE), failed);
    h.auth.app = originalApp; originalApp.options.projectId = PROJECT; h.user.uid = UID;
    await assert.rejects(service.journal.get(OP), failed); assert.deepEqual(h.calls, before);
  }
  const stopped = await harness({ stopAt: 'database' }); await assert.rejects(capability(stopped), failed);
});

test('appointment initial Auth accessor failures expose fixed errors without SDK imports', async () => {
  for (const key of ['currentUser', 'app']) {
    const h = await harness(); Object.defineProperty(h.auth, key, { get() { throw new Error('PRIVATE_AUTH_GETTER'); } });
    await assert.rejects(capability(h), failed); assert.deepEqual(h.calls, []);
  }
});

test('raw appointment transaction permits only exact record/day/receipt/intent paths and profile reads, never profile writes', async () => {
  const h = await harness({ raw: true }); await capability(h); const adapter = h.rawAdapters.appointments;
  const forbidden = [path('members', UID), path('patientFiles', '451'), path('patientAccounts', ID), path('patientSessions', ID),
    path('patientReceipts', ID), path('clinicalOperations'), path('patientOperations'), path('contactRecords', ID),
    path('contactOperations'), path('labs', ID), path('labCosts', ID), path('counters', 'patientFiles'), path('expenses', ID),
    path('settings', 'identity'), path('settings', 'serviceCatalog'), RECORD + '/extra', RECORD + '\n', DAY + '\n',
    path('appointmentDays', '2026-02-30'), path('appointmentDays', '2026-1-2'), path('appointmentDays', '0000-01-01'),
    'clinics/other/appointmentRecords/' + ID, path('appointmentOperations') + '\n', path('operationIntents') + '\n'];
  for (const key of forbidden) await assert.rejects(adapter.runTransaction((tx: any) => tx.get(key)), safe);
  for (const key of [...forbidden, path('patientProfiles', ID)]) await assert.rejects(adapter.runTransaction((tx: any) => tx.set(key, h.copy({}))), safe);
  assert.equal(h.calls.some(call => call.startsWith('get:') || call.startsWith('set:')), false);
  assert.equal(await adapter.runTransaction((tx: any) => tx.get(path('patientProfiles', ID))), null);
  assert.ok(h.calls.includes(`get:${path('patientProfiles', ID)}`));
});

test('raw direct reads expose only appointment record/day or journal UUID, no operation/profile/private reads', async () => {
  const h = await harness({ raw: true }); await capability(h); const before = [...h.calls];
  for (const key of [path('operationIntents'), path('appointmentOperations'), path('patientProfiles', ID), RECORD + '\n', DAY + '\n',
    path('appointmentDays', '2026-02-30'), path('settings', 'other')]) {
    await assert.rejects(async () => h.rawAdapters.appointments.readRecord(key), safe);
  }
  for (const key of [RECORD, DAY, path('appointmentOperations'), path('patientProfiles', ID), path('operationIntents') + '\n']) {
    await assert.rejects(async () => h.rawAdapters.journal.readRecord(key), safe);
  }
  assert.deepEqual(h.calls, before);
});

test('raw appointment query seams reject foreign kind/actor, malformed cursors and invalid bounds before constructing queries', async () => {
  const h = await harness({ raw: true }); await capability(h); const before = [...h.calls];
  for (const method of ['listPreparedPage', 'listHistoryPage']) {
    for (const args of [['clinical', UID, null, 25], ['appointment', 'another-owner', null, 25], ['appointment', UID, OP + '\n', 25],
      ['appointment', UID, null, 0], ['appointment', UID, null, 51], ['appointment', UID, null, 1.5], ['appointment', UID, undefined, 25]]) {
      await assert.rejects(async () => h.rawAdapters.journal[method](...args), safe);
    }
  }
  assert.deepEqual(h.calls, before);
});

test('raw appointment date-page seam refuses arbitrary dates, malformed cursors and unbounded lists before SDK access', async () => {
  const h = await harness({ raw: true }); await capability(h); const before = [...h.calls];
  for (const args of [['2026-02-30', null, 25], [DATE + '\n', null, 25], [DATE, OP + '\n', 25],
    [DATE, null, 0], [DATE, null, 51], [DATE, null, 1.5], [DATE, undefined, 25], [undefined, null, 25]]) {
    await assert.rejects(async () => h.rawAdapters.appointments.listDayPage(...args), safe);
  }
  assert.deepEqual(h.calls, before);
});

test('raw intent transaction fence validates full domain before any read exposure or cancellation-status mutation', async () => {
  const h = await harness({ raw: true }); await capability(h); h.rows.set(path('operationIntents'), h.copy({ kind: 'clinical' }));
  await assert.rejects(h.rawAdapters.appointments.runTransaction((tx: any) => tx.get(path('operationIntents'))), safe);
  for (const value of [{ kind: 'clinical' }, { kind: 'contact' }, { kind: 'patient-profile' }, { kind: 'appointment' }, {}]) {
    await assert.rejects(h.rawAdapters.appointments.runTransaction((tx: any) => tx.set(path('operationIntents'), h.copy(value))), safe);
  }
  assert.equal(h.calls.some(call => call.startsWith('set:')), false);
});
