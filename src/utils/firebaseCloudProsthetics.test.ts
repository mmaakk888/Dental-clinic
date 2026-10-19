import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';

// Actual prosthetic/journal contracts over a fabricated Lite SDK. No network,
// live Firebase, owner password, real records, browser data or Rules engine.
const APP_ID = '10000000-0000-4000-8000-000000000001', PATIENT = '10000000-0000-4000-8000-000000000002';
const LAB = '10000000-0000-4000-8000-000000000003', SERVICE = '10000000-0000-4000-8000-000000000004', MATERIAL = '10000000-0000-4000-8000-000000000005';
const OP = '20000000-0000-4000-8000-000000000001', OP2 = '20000000-0000-4000-8000-000000000002';
const UID = 'synthetic-prosthetic-sdk-owner', PROJECT = 'osama-clinic-38706', WHEN = '2026-10-12T00:00:00.000Z', DAY = '2026-10-12';
const path = (kind: string, id: string | number = OP) => `clinics/main/${kind}/${id}`;
let bundle: ReturnType<typeof build> | undefined, rawBundle: ReturnType<typeof build> | undefined;
function compiled(raw = false) {
  const options = { entryPoints: ['src/utils/firebaseCloudProsthetics.ts'], bundle: true, write: false, metafile: true,
    platform: 'node' as const, format: 'cjs' as const, supported: { 'dynamic-import': false }, logLevel: 'silent' as const };
  if (raw) return rawBundle ??= build({ ...options, external: ['firebase/*', './cloudProstheticRepository', './cloudOperationIntent'] });
  return bundle ??= build({ ...options, external: ['firebase/*'] });
}
type Options = { raw?: boolean; hostname?: string; projectId?: string; appName?: string; authDomain?: string; emulator?: boolean;
  verified?: boolean; tokenVerified?: boolean; provider?: string; claims?: object; member?: object; missingMember?: boolean;
  stopAt?: string; swapAt?: string; denyRead?: boolean; denyWrite?: boolean; lostReply?: boolean; retry?: boolean };
async function harness(options: Options = {}) {
  const output = await compiled(options.raw), module = { exports: {} as any }, calls: string[] = [], rows = new Map<string, any>();
  const user = { uid: UID, email: 'prosthetic-owner@example.invalid', emailVerified: options.verified ?? true };
  const auth = { app: { name: options.appName ?? `clinic-operating-${APP_ID}`, options: { projectId: options.projectId ?? PROJECT,
    authDomain: options.authDomain ?? `${PROJECT}.firebaseapp.com` } }, currentUser: user as typeof user | null, emulatorConfig: options.emulator ? {} : null };
  const active = { value: true }, location = { hostname: options.hostname ?? '127.0.0.1' }, rawAdapters: { core?: any; journal?: any } = {};
  let copy!: (value: unknown) => any;
  const step = (name: string) => { calls.push(name); if (options.stopAt === name) active.value = false; if (options.swapAt === name) auth.currentUser = { ...user }; };
  const snapshot = (key: string, prefix: string, source = rows) => ({ exists: () => { step(`${prefix}-exists`); return source.has(key); },
    data: () => { step(`${prefix}-data`); return source.get(key); } });
  const scope = { module, exports: module.exports, TextEncoder, crypto: webcrypto, window: { location,
    get localStorage() { throw new Error('PRIVATE_LOCAL'); }, get sessionStorage() { throw new Error('PRIVATE_LOCAL'); } },
    fetch: () => { throw new Error('PRIVATE_NETWORK'); },
    require: (name: string) => {
      calls.push(`import:${name}`);
      if (options.raw && name === './cloudProstheticRepository') return {
        createCloudProstheticRepository: (adapter: unknown) => { rawAdapters.core = adapter; return adapter; },
        CloudProstheticError: class extends Error { constructor(public code: string) { super(`SAFE_PROSTHETIC_${code}`); } },
      };
      if (options.raw && name === './cloudOperationIntent') return {
        createCloudOperationIntentRepository: (adapter: unknown) => { rawAdapters.journal = adapter; return adapter; },
        CloudOperationIntentError: class extends Error { constructor(public code: string) { super(`SAFE_INTENT_${code}`); } },
      };
      if (name === 'firebase/auth') return { getIdTokenResult: async (target: unknown) => {
        assert.equal(target, user); step('token'); return { signInProvider: options.provider ?? 'password', claims: copy({ sub: UID, aud: PROJECT,
          iss: `https://securetoken.google.com/${PROJECT}`, email: user.email, email_verified: options.tokenVerified ?? true,
          dentalClinicId: 'main', dentalClinicRole: 'owner', auth_time: 100, ...options.claims }) };
      } };
      if (name === 'firebase/firestore/lite') return {
        getFirestore: (app: unknown, databaseId: string) => { assert.equal(app, auth.app); assert.equal(databaseId, '(default)'); step('database'); return 'fake-prosthetic-db'; },
        doc: (db: unknown, ...parts: string[]) => { assert.equal(db, 'fake-prosthetic-db'); const key = parts.join('/');
          calls.push(`doc:${key}`); step(key.startsWith('clinics/main/members/') ? 'member-doc' : 'record-doc'); return key; },
        getDoc: async (key: string) => {
          if (!key.startsWith('clinics/main/members/')) { calls.push(`read:${key}`); step('record'); if (options.denyRead) throw new Error('PRIVATE_READ'); return snapshot(key, 'record'); }
          assert.equal(key, path('members', UID)); step('member'); return { exists: () => { step('member-exists'); return !options.missingMember; },
            data: () => { step('member-data'); return copy({ schemaVersion: 1, clinicId: 'main', uid: UID, role: 'owner', status: 'active',
              identityVersion: 1, verifiedAfter: 100, ...options.member }); } };
        },
        collection: (db: unknown, ...parts: string[]) => { assert.equal(db, 'fake-prosthetic-db'); step('collection'); return parts.join('/'); },
        documentId: () => { step('document-id'); return '__name__'; },
        where: (field: string, operator: string, value: unknown) => { step('where'); return { kind: 'where', field, operator, value }; },
        orderBy: (field: string) => { step('order'); return { kind: 'order', field }; },
        startAfter: (id: string) => { step('after'); return { kind: 'after', id }; },
        limit: (count: number) => { step('limit'); return { kind: 'limit', count }; },
        query: (key: string, ...constraints: any[]) => { step('query'); calls.push(`query:${key}:${JSON.stringify(constraints)}`); return { key, constraints }; },
        getDocs: async (request: any) => {
          step('page'); if (options.denyRead) throw new Error('PRIVATE_PAGE');
          assert.ok(['clinics/main/labCases', 'clinics/main/labPayments', 'clinics/main/operationIntents'].includes(request.key));
          const predicates = request.constraints.filter((value: any) => value.kind === 'where');
          const isJournal = request.key.endsWith('/operationIntents');
          assert.deepEqual(predicates, isJournal ? [{ kind: 'where', field: 'actorUid', operator: '==', value: UID },
            { kind: 'where', field: 'kind', operator: '==', value: 'prosthetic' },
            ...(predicates.length === 2 ? [] : [{ kind: 'where', field: 'status', operator: '==', value: 'prepared' }])]
            : [{ kind: 'where', field: 'labId', operator: '==', value: LAB }]);
          assert.deepEqual(request.constraints.find((value: any) => value.kind === 'order'), { kind: 'order', field: '__name__' });
          assert.equal(request.constraints.at(-1).kind, 'limit'); const count = request.constraints.at(-1).count;
          assert.ok(count >= 1 && count <= 50 && Number.isSafeInteger(count));
          const after = request.constraints.find((value: any) => value.kind === 'after')?.id;
          const values = [...rows].filter(([key, value]) => key.startsWith(`${request.key}/`) && (!after || key.split('/').at(-1)! > after)
            && predicates.every((predicate: any) => value[predicate.field] === predicate.value)).sort(([a], [b]) => a < b ? -1 : 1).slice(0, count);
          return { get docs() { step('page-docs'); return values.map(([key, value]) => ({ get id() { step('page-id'); return key.split('/').at(-1); },
            data: () => { step('page-data'); return value; } })); } };
        },
        runTransaction: async (db: unknown, work: any, settings: any) => {
          assert.equal(db, 'fake-prosthetic-db'); assert.equal(settings.maxAttempts, 5); step('transaction-start');
          const attempt = async (publish: boolean) => {
            const staged = new Map(rows); let wrote = false;
            const result = await work({ get: async (key: string) => { assert.equal(wrote, false, 'all reads precede writes'); calls.push(`get:${key}`); step('transaction-read'); return snapshot(key, 'transaction', staged); },
              set: (key: string, value: unknown) => { wrote = true; if (options.denyWrite) throw new Error('PRIVATE_WRITE'); calls.push(`set:${key}`); staged.set(key, value); step('transaction-write'); } });
            if (publish) { rows.clear(); for (const [key, value] of staged) rows.set(key, value); } return result;
          };
          if (options.retry) { options.retry = false; await attempt(false); }
          const result = await attempt(true); step('transaction-ack'); if (options.lostReply) { options.lostReply = false; throw new Error('PRIVATE_LOST_ACK'); } return result;
        },
      };
      throw new Error(`PRIVATE_IMPORT_${name}`);
    },
  };
  runInNewContext(output.outputFiles![0].text, scope); copy = runInNewContext('(value) => JSON.parse(JSON.stringify(value))', scope);
  const initial: [string, unknown][] = [
    [path('patientProfiles', PATIENT), { schemaVersion: 1, clinicId: 'main', recordId: PATIENT, fileNo: 451, revision: 1, lastOperationId: OP2, phoneKey: null,
      data: { name: 'مريض مصطنع', mobile: '', age: 30, gender: '', firstVisit: DAY, notes: '', allergy: '' } }],
    [path('patientFiles', 451), { schemaVersion: 1, clinicId: 'main', fileNo: 451, recordId: PATIENT }],
    [path('settings', 'serviceCatalog'), { schemaVersion: 1, clinicId: 'main', recordId: 'serviceCatalog', revision: 1, lastOperationId: OP2,
      data: { examinationCents: 10_000, services: [{ serviceId: SERVICE, name: 'تركيبة مصطنعة', kind: 'prosthetic', priceCents: 100_000, active: true }] } }],
    [path('settings', 'prostheticRouting'), { schemaVersion: 1, clinicId: 'main', recordId: 'prostheticRouting', revision: 1, lastOperationId: OP2,
      data: { routes: [{ serviceId: SERVICE, labId: LAB, materialId: MATERIAL }] } }],
    [path('labDefinitions', LAB), { schemaVersion: 1, clinicId: 'main', recordId: LAB, revision: 1, lastOperationId: OP2,
      data: { name: 'معمل مصطنع', phone: '', address: '', notes: '', active: true,
        costs: [{ materialId: MATERIAL, name: 'خامة مصطنعة', category: 'fixed', unitLabel: 'كراون', billingBasis: 'per-unit', unitCostCents: 20_000, active: true }] } }],
  ];
  for (const [key, value] of initial) rows.set(key, copy(value));
  const payload = copy({ action: 'create', operationId: OP, labId: LAB, expectedLabAccountRevision: 0, createdAt: WHEN, patientId: PATIENT,
    expectedPatientRevision: 0, serviceId: SERVICE, expectedCatalogRevision: 1, expectedRoutingRevision: 1, expectedLabRevision: 1,
    kind: 'fixed', units: 3, teethIds: ['ur4', 'ur5', 'ur6'], date: DAY, deliveryExpectedDate: null, patientUnitPriceCents: 100_000,
    includeExamination: true, paidCents: 50_000, note: '' });
  return { service: module.exports, calls, rows, auth, user, active, location, copy, payload, options, rawAdapters, output };
}
const failed = (error: any) => ['invalid', 'unavailable', 'conflict'].includes(error?.code) && !String(error).includes('PRIVATE');
const capability = (h: Awaited<ReturnType<typeof harness>>) => h.service.createFirebaseCloudProsthetics(h.auth, { isActive: () => h.active.value });
async function prepared(h: Awaited<ReturnType<typeof harness>>) { const result = await capability(h); await result.journal.prepare('prosthetic', h.payload, WHEN); return result; }
test('prosthetic SDK import is inert and never imports local storage, backup, App or UI', async () => {
  const h = await harness(); assert.deepEqual(h.calls, []);
  assert.equal(Object.keys(h.output.metafile!.inputs).some(key => /utils\/(?:storage|firebaseService|localClinicBackup|offlineSync)|App\.tsx|components\//.test(key)), false);
});
test('factory accepts only exact active named operating app, loopback project/domain and no emulator', async () => {
  for (const options of [{ hostname: 'public.example.invalid' }, { projectId: 'zippy-dispatcher-m1ttq' }, { authDomain: 'wrong.invalid' },
    { appName: '[DEFAULT]' }, { appName: `clinic-owner-setup-${APP_ID}` }, { appName: `clinic-operating-${APP_ID}\n` }, { emulator: true }]) {
    const h = await harness(options); await assert.rejects(capability(h), failed); assert.deepEqual(h.calls, []);
  }
  for (const options of [undefined, {}, { isActive: () => false }, { isActive: () => { throw new Error('PRIVATE_LEASE'); } }]) {
    const h = await harness(); await assert.rejects(h.service.createFirebaseCloudProsthetics(h.auth, options), failed); assert.deepEqual(h.calls, []);
  }
});
test('factory loads exact Lite app but performs no authorization, clinical reads, writes or seeds', async () => {
  const h = await harness(), service = await capability(h);
  assert.deepEqual(h.calls, ['import:firebase/auth', 'import:firebase/firestore/lite', 'database']);
  assert.deepEqual(Object.keys(service.repository).sort(), ['commit', 'getCase', 'getLabAccount', 'getLabSummary', 'listCases', 'listPayments']);
  assert.ok(Object.isFrozen(service) && Object.isFrozen(service.repository) && Object.isFrozen(service.journal));
});
test('actual SDK/core/journal create is coupled and historical replay cannot duplicate charge or cash', async () => {
  const h = await harness(), service = await prepared(h); await service.repository.commit(h.payload);
  const before = [...h.rows]; h.calls.length = 0; assert.equal((await service.repository.commit(h.payload)).status, 'already-committed');
  assert.deepEqual([...h.rows], before); assert.equal(h.calls.some(call => call.startsWith('set:')), false);
  assert.deepEqual(h.calls.filter(call => call.startsWith('get:')), [`get:${path('prostheticOperations')}`, `get:${path('operationIntents')}`]);
  assert.equal(h.rows.get(path('patientAccounts', PATIENT)).totalCents, 310_000); assert.equal(h.rows.get(path('patientReceipts')).amountCents, 50_000);
  assert.equal((await service.repository.getCase(OP)).totalCostCents, 60_000);
});
test('private supplier payment SDK keeps patient receipts unchanged and returns accurate dated summary', async () => {
  const h = await harness(), service = await prepared(h); await service.repository.commit(h.payload);
  const payment = h.copy({ action: 'lab-payment', operationId: OP2, labId: LAB, expectedLabAccountRevision: 1, createdAt: WHEN,
    date: DAY, note: 'دفعة مصطنعة', allocations: [{ caseId: OP, expectedRevision: 1, amountCents: 10_000 }] });
  await service.journal.prepare('prosthetic', payment, WHEN); await service.repository.commit(payment);
  const summary = await service.repository.getLabSummary(h.copy({ labId: LAB, month: '2026-10' }));
  assert.equal(summary.paidCostCents, 10_000); assert.equal(summary.monthPaidCents, 10_000); assert.equal(summary.remainingCents, 50_000);
  assert.equal(h.rows.get(path('patientAccounts', PATIENT)).paidCents, 50_000);
  assert.equal((await service.repository.listPayments(h.copy({ labId: LAB, limit: 1 }))).nextAfterId, OP2);
  assert.equal((await service.repository.listPayments(h.copy({ labId: LAB, afterId: OP2, limit: 1 }))).records.length, 0);
});
test('all-status history is owner/kind bounded, includes committed and respects explicit UUID cursor', async () => {
  const h = await harness(), service = await prepared(h); await service.repository.commit(h.payload);
  const page = await service.journal.listHistoryPage('prosthetic', h.copy({ limit: 1 })); assert.equal(page.records[0].status, 'committed'); assert.equal(page.nextAfterId, OP);
  assert.equal((await service.journal.listHistoryPage('prosthetic', h.copy({ afterId: OP, limit: 1 }))).records.length, 0);
  assert.equal((await service.journal.listPreparedPage('prosthetic', h.copy({ limit: 50 }))).records.length, 0);
  await assert.rejects(service.journal.listHistoryPage('clinical', h.copy({})), failed);
});
test('full command validation precedes journal preparation, including mismatched envelope time', async () => {
  const h = await harness(), service = await capability(h), before = [...h.rows];
  for (const command of [h.copy({ ...h.payload, units: 0 }), h.copy({ ...h.payload, privateCost: 1 }), h.copy({ ...h.payload, paidCents: 0.5 })]) {
    await assert.rejects(service.journal.prepare('prosthetic', command, WHEN), failed);
  }
  await assert.rejects(service.journal.prepare('prosthetic', h.payload, '2026-10-13T00:00:00.000Z'), failed);
  assert.deepEqual([...h.rows], before); assert.equal(h.calls.some(call => call.startsWith('set:')), false);
});
test('forged generic JSON/hash intent is rejected before cancellation stages a hidden write', async () => {
  const h = await harness(), service = await capability(h);
  const command = h.copy({ ...h.payload, units: 0 }), canonical = Object.fromEntries(Object.entries(command).sort(([a], [b]) => a < b ? -1 : 1));
  const requestHash = createHash('sha256').update(JSON.stringify(['clinic-operation-intent-v1', UID, 'prosthetic', canonical])).digest('hex');
  h.rows.set(path('operationIntents'), h.copy({ schemaVersion: 1, clinicId: 'main', recordId: OP, operationId: OP, actorUid: UID,
    kind: 'prosthetic', requestHash, status: 'prepared', revision: 1, createdAt: WHEN, command: canonical }));
  const before = [...h.rows]; await assert.rejects(service.journal.cancel(OP), failed);
  assert.deepEqual([...h.rows], before); assert.equal(h.calls.some(call => call.startsWith('set:')), false);
});
test('journal cancellation cannot erase committed execution and cancelled intent cannot execute', async () => {
  const h = await harness(), service = await prepared(h); await service.journal.cancel(OP);
  await assert.rejects(service.repository.commit(h.payload), failed); assert.equal(h.rows.has(path('patientAccounts', PATIENT)), false);
  const second = await harness(), committed = await prepared(second); await committed.repository.commit(second.payload);
  await assert.rejects(committed.journal.cancel(OP), failed); assert.equal(second.rows.get(path('operationIntents')).status, 'committed');
});
test('lost server acknowledgement and SDK transaction retry keep one debt and one cash receipt', async () => {
  const h = await harness(), service = await prepared(h); h.options.retry = true; h.options.lostReply = true;
  await assert.rejects(service.repository.commit(h.payload), failed); assert.equal((await service.repository.commit(h.payload)).status, 'already-committed');
  assert.equal(h.rows.get(path('patientAccounts', PATIENT)).sessionCount, 1);
  assert.equal([...h.rows.keys()].filter(key => key.startsWith('clinics/main/patientReceipts/')).length, 1);
});
test('unverified, non-password, wrong claims, inactive and stale memberships fail without clinical access', async () => {
  for (const options of [{ verified: false }, { tokenVerified: false }, { provider: 'google.com' }, { claims: { dentalClinicRole: 'secretary' } },
    { member: { status: 'disabled' } }, { member: { role: 'secretary' } }, { member: { verifiedAfter: 101 } }, { missingMember: true }]) {
    const h = await harness(options), service = await capability(h); await assert.rejects(service.repository.getCase(OP), failed);
    assert.equal(h.calls.some(call => call.startsWith('read:') || call.startsWith('set:')), false);
  }
});
for (const boundary of ['token', 'member-doc', 'member', 'member-exists', 'member-data', 'record-doc', 'record', 'record-exists',
  'record-data', 'where', 'document-id', 'order', 'limit', 'collection', 'query', 'page', 'page-docs', 'page-id', 'page-data',
  'transaction-start', 'transaction-read', 'transaction-exists', 'transaction-data', 'transaction-write', 'transaction-ack']) {
  test(`actual SDK boundary ${boundary} permanently invalidates capability on identity/lifetime loss`, async () => {
    const h = await harness(), service = await prepared(h); await service.repository.commit(h.payload);
    h.options.stopAt = boundary;
    const action = boundary.startsWith('transaction') ? () => service.journal.cancel(OP)
      : ['where', 'document-id', 'order', 'limit', 'collection', 'query', 'page', 'page-docs', 'page-id', 'page-data'].includes(boundary)
        ? () => service.repository.listCases(h.copy({ labId: LAB })) : () => service.repository.getCase(OP);
    // committed cancellation does not write; select a prepared second command
    // for transaction-write/ack so the requested boundary is actually reached.
    if (['transaction-write', 'transaction-ack'].includes(boundary)) {
      h.options.stopAt = undefined;
      const second = h.copy({ ...h.payload, operationId: OP2, expectedPatientRevision: 1, expectedLabAccountRevision: 1 });
      await service.journal.prepare('prosthetic', second, WHEN); h.options.stopAt = boundary;
      await assert.rejects(service.journal.cancel(OP2), failed);
    } else await assert.rejects(action(), failed);
    assert.ok(h.calls.includes(boundary)); h.active.value = true; h.options.stopAt = undefined;
    const before = h.calls.length; await assert.rejects(service.repository.getCase(OP), failed); assert.equal(h.calls.length, before);
  });
}
test('same-UID replacement user object and restored external runtime never revive an old capability', async () => {
  const h = await harness(), service = await capability(h); h.auth.currentUser = { ...h.user };
  await assert.rejects(service.repository.getCase(OP), failed); h.auth.currentUser = h.user;
  await assert.rejects(service.repository.getCase(OP), failed);
  const second = await harness(), next = await capability(second); second.location.hostname = 'public.example.invalid';
  await assert.rejects(next.repository.getCase(OP), failed); second.location.hostname = '127.0.0.1'; await assert.rejects(next.repository.getCase(OP), failed);
});
test('strict SDK adapters restrict reads/writes to owned paths and forbid settings/counter/profile mutations', async () => {
  const h = await harness({ raw: true }); await capability(h); const adapter = h.rawAdapters.core;
  for (const key of [path('patientProfiles', PATIENT), path('patientFiles', 451), path('clinicalOperations'), path('settings', 'serviceCatalog'),
    path('settings', 'prostheticRouting'), path('counters', 'patients'), path('members', UID), `${path('labCases')}\n`, 'clinics/other/labCases/' + OP]) {
    await assert.rejects(async () => adapter.readRecord(key), failed);
    await assert.rejects(adapter.runTransaction(async (tx: any) => tx.set(key, {})), failed);
  }
  for (const key of [path('labDefinitions', LAB), path('patientProfiles', PATIENT), path('patientFiles', 451), path('settings', 'serviceCatalog'), path('settings', 'prostheticRouting')]) {
    await adapter.runTransaction(async (tx: any) => assert.notEqual(await tx.get(key), null));
  }
  for (const key of [path('members', UID), path('counters', 'patients'), path('patientFiles', 0), path('patientFiles', 2_000_000_001), `${path('labDefinitions', LAB)}\n`]) {
    await assert.rejects(adapter.runTransaction(async (tx: any) => tx.get(key)), failed);
  }
  assert.equal(h.calls.some(call => call.startsWith('set:')), false);
});
test('provider failure is fixed-safe and never becomes cache/local fallback or false success', async () => {
  const h = await harness(), service = await prepared(h); h.options.denyWrite = true;
  await assert.rejects(service.repository.commit(h.payload), failed); assert.equal(h.rows.has(path('patientAccounts', PATIENT)), false);
  h.options.denyRead = true; await assert.rejects(service.repository.getCase(OP), failed);
});
