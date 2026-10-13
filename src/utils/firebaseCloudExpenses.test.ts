import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';

// Actual expense/journal contracts against a synthetic Lite SDK. No live
// Firebase, real account, patient fixture, browser storage, Rules or network.
const ID = '10000000-0000-4000-8000-000000000001';
const EARLIER = '00000000-0000-4000-8000-000000000001';
const OP = '20000000-0000-4000-8000-000000000001';
const OP2 = '20000000-0000-4000-8000-000000000002';
const OTHER = '30000000-0000-4000-8000-000000000001';
const UID = 'synthetic-expense-sdk-owner';
const PROJECT = 'dental-clinic-mmaakk888';
const WHEN = '2026-10-12T00:00:00.000Z';
const DATE = '2026-10-12';
const path = (kind: string, id = OP) => `clinics/main/${kind}/${id}`;
const RECORD = path('expenseRecords', ID);
let bundle: ReturnType<typeof build> | undefined, rawBundle: ReturnType<typeof build> | undefined;
function compiled(raw: boolean) {
  const options = { entryPoints: ['src/utils/firebaseCloudExpenses.ts'], bundle: true, write: false, metafile: true,
    platform: 'node' as const, format: 'cjs' as const, supported: { 'dynamic-import': false }, logLevel: 'silent' as const };
  if (raw) return rawBundle ??= build({ ...options, external: ['firebase/*', './cloudExpenseRepository', './cloudOperationIntent'] });
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
  const user = { uid: UID, email: 'expense-owner@example.invalid', emailVerified: options.verified ?? true };
  const location = { hostname: options.hostname ?? '127.0.0.1' };
  const auth = { app: { name: options.appName ?? `clinic-operating-${ID}`, options: {
    projectId: options.projectId ?? PROJECT, authDomain: options.authDomain ?? `${PROJECT}.firebaseapp.com` } },
    emulatorConfig: options.emulator ? {} : null, currentUser: user as typeof user | null };
  const rows = new Map<string, any>(), active = { value: true };
  const rawAdapters: { expenses?: any; journal?: any } = {};
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
  const scope = { module, exports: module.exports, TextEncoder, crypto: webcrypto, atob, btoa, Uint8Array,
    window: { location,
      get localStorage() { throw new Error('PRIVATE_LOCAL_CLINIC_READ'); },
      get sessionStorage() { throw new Error('PRIVATE_LOCAL_SESSION_READ'); } },
    get localStorage() { throw new Error('PRIVATE_LOCAL_CLINIC_READ'); },
    get sessionStorage() { throw new Error('PRIVATE_LOCAL_SESSION_READ'); },
    fetch: () => { throw new Error('PRIVATE_REAL_NETWORK_FORBIDDEN'); },
    require: (name: string) => {
      calls.push(`import:${name}`);
      if (name === './cloudExpenseRepository' && options.raw) return {
        createCloudExpenseRepository: (adapter: unknown) => { rawAdapters.expenses = adapter; return adapter; },
        CloudExpenseError: class extends Error { constructor(public code: string) { super(`SAFE_EXPENSE_${code}`); } },
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
          assert.equal(app, auth.app); assert.equal(databaseId, '(default)'); step('database'); return 'synthetic-expense-db';
        },
        doc: (db: unknown, ...parts: string[]) => {
          assert.equal(db, 'synthetic-expense-db'); const key = parts.join('/');
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
        collection: (db: unknown, ...parts: string[]) => { assert.equal(db, 'synthetic-expense-db'); step('collection'); return parts.join('/'); },
        documentId: () => { step('document-id'); return '__name__'; },
        orderBy: (field: string) => { step('order'); return { kind: 'order', field }; },
        where: (field: string, operator: string, value: string) => { step('where'); return { kind: 'where', field, operator, value }; },
        startAfter: (id: string) => { step('after'); return { kind: 'after', id }; },
        limit: (count: number) => { step('limit'); return { kind: 'limit', count }; },
        query: (key: string, ...constraints: any[]) => { calls.push(`query:${key}:${JSON.stringify(constraints)}`); step('query'); return { key, constraints }; },
        getDocs: async (request: any) => {
          const collection = request.key.split('/').at(-1);
          assert.ok(['expenseRecords', 'materialBalances', 'expensePayments', 'materialUsages', 'operationIntents'].includes(collection));
          const predicates = request.constraints.filter((value: any) => value.kind === 'where');
          if (collection === 'operationIntents') assert.deepEqual(predicates, [
            { kind: 'where', field: 'actorUid', operator: '==', value: UID },
            { kind: 'where', field: 'kind', operator: '==', value: 'expense' },
            ...(predicates.length === 2 ? [] : [{ kind: 'where', field: 'status', operator: '==', value: 'prepared' }]),
          ]);
          else if (collection === 'expensePayments' || collection === 'materialUsages') {
            assert.equal(predicates.length, 1); assert.equal(predicates[0].field, collection === 'expensePayments' ? 'expenseId' : 'materialId');
            assert.equal(predicates[0].operator, '==');
          } else assert.deepEqual(predicates, []);
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
          assert.equal(db, 'synthetic-expense-db'); assert.equal(settings.maxAttempts, 5); step('transaction-start');
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
  const payload = copy({ action: 'create', operationId: OP, recordId: ID, expectedRevision: 0, createdAt: WHEN, paidCents: 0, data: {
    title: 'مصروف مصطنع', category: 'fixed', expenseType: 'rent', date: DATE, note: '', isFixed: true, recurringPeriod: 'monthly',
    supplierName: '', supplierPhone: '', supplierAddress: '', invoiceNumber: '', invoiceDate: DATE, invoiceTime: '',
    taxNumber: '', commercialRecord: '', currency: 'EGP', subtotalCents: 10000, taxCents: 0, discountCents: 0,
    totalCents: 10000, items: [],
  } });
  return { service: module.exports, auth, user, calls, rows, payload, compiled: output, active, copy, location, options, rawAdapters };
}
const failed = (error: any) => ['invalid', 'unavailable', 'conflict'].includes(error?.code) && !String(error).includes('PRIVATE');
const safe = (error: unknown) => /SAFE_(EXPENSE|INTENT)_(invalid|unavailable|conflict)/.test(String(error)) && !String(error).includes('PRIVATE');
async function capability(h: Awaited<ReturnType<typeof harness>>) {
  return h.service.createFirebaseCloudExpenses(h.auth, { isActive: () => h.active.value });
}
async function prepared(h: Awaited<ReturnType<typeof harness>>, value?: any) {
  const service = await capability(h); await service.journal.prepare('expense', value ?? h.payload, WHEN); return service;
}

test('expense SDK import and construction inert; no App/storage/data/provider imports or reads', async () => {
  const h = await harness(); assert.deepEqual(h.calls, []); const service = await capability(h);
  assert.deepEqual(h.calls, ['import:firebase/auth', 'import:firebase/firestore/lite', 'database']);
  assert.equal(Object.keys(h.compiled.metafile!.inputs).some(key => /utils\/(?:storage|localClinicBackup|firebaseService|offlineSync)|App\.tsx|components\//.test(key)), false);
  assert.deepEqual(Object.keys(service).sort(), ['journal', 'repository']); assert.equal(h.rows.size, 0);
  for (const target of [service, service.repository, service.journal]) assert.equal(Object.isFrozen(target), true);
});
test('expense factory requires exact operating app/project/domain/loopback/lifetime with no emulators', async () => {
  for (const options of [{ hostname: 'public.invalid' }, { projectId: 'old-project' }, { authDomain: 'bad.firebaseapp.com' },
    { appName: '[DEFAULT]' }, { appName: `clinic-owner-setup-${ID}` }, { appName: `clinic-operating-${ID}\n` }, { emulator: true }]) {
    const h = await harness(options); await assert.rejects(capability(h), failed); assert.deepEqual(h.calls, []);
  }
  const h = await harness(); h.active.value = false; await assert.rejects(capability(h), failed); assert.deepEqual(h.calls, []);
});
test('empty expense/material read null; never invent stock or cash', async () => {
  const h = await harness(), service = await capability(h); assert.equal(await service.repository.get(ID), null);
  assert.equal(await service.repository.getMaterial('a'.repeat(64)), null); assert.equal(h.rows.size, 0);
  assert.equal(h.calls.filter(value => value === 'token').length, 8);
});
test('actual expense/journal core requires prepared intent and atomically preserves charge separate from cash', async () => {
  const h = await harness(), service = await capability(h);
  await assert.rejects(service.repository.commit(h.payload), failed); assert.equal(h.rows.size, 0);
  await service.journal.prepare('expense', h.payload, WHEN); assert.equal((await service.repository.commit(h.payload)).status, 'committed');
  assert.deepEqual([...h.rows.keys()].sort(), [RECORD, path('expenseOperations'), path('operationIntents')].sort());
  const record = await service.repository.get(ID); assert.equal(record.paidCents, 0); assert.equal(record.data.totalCents, 10000);
  const writes = h.calls.filter(value => value.startsWith('set:')).length;
  assert.equal((await service.repository.commit(h.payload)).status, 'already-committed');
  assert.equal(h.calls.filter(value => value.startsWith('set:')).length, writes);
});
test('SDK payment retry preserves historical receipt even after newer payment; no double cash', async () => {
  const h = await harness(), service = await prepared(h); await service.repository.commit(h.payload);
  const a = h.copy({ action: 'pay', operationId: OP2, recordId: ID, expectedRevision: 1, createdAt: WHEN, amountCents: 1000, date: DATE, note: '' });
  await service.journal.prepare('expense', a, WHEN); await service.repository.commit(a);
  const b = h.copy({ ...a, operationId: OTHER, expectedRevision: 2, amountCents: 2000 }); await service.journal.prepare('expense', b, WHEN); await service.repository.commit(b);
  h.calls.length = 0; assert.equal((await service.repository.commit(a)).status, 'already-committed');
  assert.equal(h.rows.get(RECORD).paidCents, 3000); assert.equal(h.calls.some(value => value.startsWith('get:') && value.includes('expenseRecords')), false);
  assert.equal((await service.repository.listPaymentsPage(ID)).records.length, 2);
});
test('supplier reservation and material purchases remain within explicit scoped paths', async () => {
  const h = await harness(), input = h.copy({ ...h.payload, data: { ...h.payload.data, category: 'supplies', expenseType: 'supplies',
    supplierName: 'مورد مصطنع', invoiceNumber: '1', items: [{ itemId: OTHER, name: 'خامة مصطنعة', unit: 'علبة', quantityMilli: 2000,
      unitPriceCents: 5000, discountCents: 0, taxCents: 0, totalCents: 10000 }] } });
  const service = await prepared(h, input); await service.repository.commit(input);
  const materials = await service.repository.listMaterialsPage(h.copy({ limit: 1 })); assert.equal(materials.records[0].purchasedMilli, 2000);
  const u = h.copy({ action: 'usage', operationId: OP2, createdAt: WHEN, materialId: materials.records[0].recordId, expectedRevision: 1,
    quantityMilli: 1000, kind: 'used', date: DATE, note: '' }); await service.journal.prepare('expense', u, WHEN); await service.repository.commit(u);
  assert.equal((await service.repository.listUsagesPage(u.materialId)).records[0].costCents, 5000);
  assert.ok(h.calls.filter(value => value.startsWith('set:')).every(value => /expenseRecords|expenseOperations|operationIntents|supplierInvoiceReservations|materialBalances|materialUsages/.test(value)));
});
test('invoice image bytes separate from journal; on-demand read and no image list query', async () => {
  const h = await harness(), service = await prepared(h); await service.repository.commit(h.payload);
  const bytes = Buffer.from([255,216,255,192,0,17,8,0,160,1,64,3,1,17,0,2,17,0,3,17,0,255,218,0,12,3,1,0,2,0,3,0,0,63,0,1,2,3,255,217]);
  const a = h.copy({ action: 'attach-image', operationId: OP2, createdAt: WHEN, recordId: ID, expectedRevision: 1,
    image: { sha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length, width: 320, height: 160, contentType: 'image/jpeg' } });
  await service.journal.prepare('expense', a, WHEN); await service.repository.commit(a, bytes.toString('base64'));
  assert.equal((await service.repository.getInvoiceImage(ID)).base64, bytes.toString('base64'));
  assert.equal(JSON.stringify(h.rows.get(path('operationIntents', OP2))).includes(bytes.toString('base64')), false);
  assert.equal((await service.repository.commit(a)).status, 'already-committed'); h.calls.length = 0;
  await service.repository.listPage(); assert.equal(h.calls.some(value => value.includes('invoiceImages')), false);
});
test('wrong journal kind/schema/time rejected before mutation, including cancellation read', async () => {
  const h = await harness(), service = await prepared(h); const before = h.calls.filter(value => value.startsWith('set:')).length;
  await assert.rejects(service.journal.prepare('appointment', h.payload, WHEN), failed);
  await assert.rejects(service.journal.prepare('expense', h.copy({ ...h.payload, extra: true }), WHEN), failed);
  await assert.rejects(service.journal.prepare('expense', h.payload, '2026-10-13T00:00:00.000Z'), failed);
  assert.equal(h.calls.filter(value => value.startsWith('set:')).length, before);
  const intent = h.rows.get(path('operationIntents')); intent.command = h.copy({ ...intent.command, paidCents: -1 });
  intent.requestHash = createHash('sha256').update(JSON.stringify(['clinic-operation-intent-v1', UID, 'expense', intent.command])).digest('hex');
  await assert.rejects(service.journal.cancel(OP), failed); assert.equal(h.calls.filter(value => value.startsWith('set:')).length, before);
});
test('journal history includes committed with owner/kind filters, ascending cursor and bounded limit', async () => {
  const h = await harness(), service = await prepared(h); await service.repository.commit(h.payload);
  const result = await service.journal.listHistoryPage('expense', h.copy({ afterId: EARLIER, limit: 2 }));
  assert.equal(result.records.length, 1); assert.equal(result.records[0].status, 'committed');
  assert.equal((await service.journal.listPreparedPage('expense', h.copy({ limit: 2 }))).records.length, 0);
  for (const query of [{ limit: 51 }, { afterId: '../x' }]) await assert.rejects(service.repository.listPage(h.copy(query)), failed);
});
test('unauthorized email/provider/claims/disabled membership fail before expense records', async () => {
  for (const options of [{ verified: false }, { tokenVerified: false }, { provider: 'anonymous' }, { missingMember: true },
    { claims: { dentalClinicRole: 'secretary' } }, { member: { status: 'suspended' } }]) {
    const h = await harness(options), service = await capability(h); await assert.rejects(service.repository.get(ID), failed);
    assert.equal(h.calls.some(value => value.startsWith('read:')), false);
  }
});
test('retained SDK capability permanently revoked after same-UID object swap or lease loss', async () => {
  for (const swap of [true, false]) { const h = await harness(), service = await capability(h);
    if (swap) h.auth.currentUser = { ...h.user }; else h.active.value = false;
    await assert.rejects(service.repository.get(ID), failed); h.auth.currentUser = h.user; h.active.value = true;
    await assert.rejects(service.repository.get(ID), failed);
  }
});
test('runtime boundaries cannot publish late expense reads or revive capability', async () => {
  for (const boundary of ['token','member-doc','member','member-exists','member-data','record-doc','record','record-exists','record-data'] as Boundary[]) {
    const h = await harness(), service = await capability(h); h.rows.set(RECORD, h.copy({}));
    h.options.stopAt = boundary; await assert.rejects(service.repository.get(ID), failed);
    h.options.stopAt = undefined; h.active.value = true; await assert.rejects(service.repository.get(ID), failed);
  }
});
test('query boundaries revoke before exposing partial report data', async () => {
  for (const boundary of ['document-id','order','limit','collection','query','page','page-docs'] as Boundary[]) {
    const h = await harness(), service = await capability(h); h.options.stopAt = boundary;
    await assert.rejects(service.repository.listPage(), failed); h.options.stopAt = undefined; h.active.value = true;
    await assert.rejects(service.repository.listPage(), failed);
  }
});
test('transaction boundaries revoke before late ACK; accepted write may persist but is never claimed undone', async () => {
  for (const boundary of ['transaction-start','transaction-read','transaction-exists','transaction-data','transaction-write','transaction-ack'] as Boundary[]) {
    const h = await harness(), service = await prepared(h); h.options.stopAt = boundary;
    await assert.rejects(service.repository.commit(h.payload), failed);
    h.options.stopAt = undefined; h.active.value = true; await assert.rejects(service.repository.get(ID), failed);
  }
});
test('Lite lost reply/retry and provider failure never disclose raw details or duplicate records', async () => {
  const h = await harness(), service = await prepared(h); h.options.lostReply = true;
  await assert.rejects(service.repository.commit(h.payload), failed); assert.equal(h.rows.get(RECORD).revision, 1);
  assert.equal((await service.repository.commit(h.payload)).status, 'already-committed');
  const h2 = await harness({ retryOnce: true }), service2 = await prepared(h2); await service2.repository.commit(h2.payload);
  assert.equal(h2.rows.get(RECORD).revision, 1);
  h2.options.denyRead = true; await assert.rejects(service2.repository.get(ID), failed);
});
test('raw scoped adapter refuses arbitrary and newline-tainted paths and image collection lists', async () => {
  const h = await harness({ raw: true }); await capability(h); const adapter = h.rawAdapters.expenses;
  for (const bad of ['clinics/main/members/owner', 'clinics/main/patientProfiles/' + ID, RECORD + '\n', 'clinics/other/expenseRecords/' + ID]) {
    await assert.rejects(async () => adapter.readRecord(bad), safe);
    await assert.rejects(adapter.runTransaction(async (tx: any) => tx.set(bad, {})), safe);
  }
  for (const args of [['invoiceImages', null, null, 25], ['expensePayments', null, null, 25], ['materialBalances', null, ID, 25],
    ['expenseRecords', null, 'a'.repeat(64), 25], ['expenseRecords', null, null, 51]]) await assert.rejects(adapter.listPage(...args), safe);
});

