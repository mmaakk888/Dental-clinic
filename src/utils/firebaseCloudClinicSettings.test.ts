import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';

// Synthetic SDK composition only, not live Auth/Rules/visual/device acceptance.
const UUID = '10000000-0000-4000-8000-000000000001', OP = '20000000-0000-4000-8000-000000000001';
const LAB = '30000000-0000-4000-8000-000000000001', MATERIAL = '40000000-0000-4000-8000-000000000001';
const UID = 'synthetic-settings-sdk-owner', PROJECT = 'dental-clinic-mmaakk888', WHEN = '2026-10-12T00:00:00.000Z';
const ROUTING = 'clinics/main/settings/prostheticRouting', SETTINGS = 'clinics/main/settings/clinicSettings';
const INTENT = `clinics/main/operationIntents/${OP}`, RECEIPT = `clinics/main/settingsOperations/${OP}`;
let output: ReturnType<typeof build> | undefined, rawOutput: ReturnType<typeof build> | undefined;
function compiled(raw = false) {
  const options = { entryPoints: ['src/utils/firebaseCloudClinicSettings.ts'], bundle: true, write: false, metafile: true,
    platform: 'node' as const, format: 'cjs' as const, supported: { 'dynamic-import': false }, logLevel: 'silent' as const };
  return raw ? rawOutput ??= build({ ...options, external: ['firebase/*', './cloudClinicSettingsRepository', './cloudOperationIntent'] })
    : output ??= build({ ...options, external: ['firebase/*'] });
}
interface Options {
  hostname?: string; appName?: string; projectId?: string; authDomain?: string; emulator?: boolean; missingUser?: boolean;
  verified?: boolean; tokenVerified?: boolean; provider?: string; member?: Record<string, unknown>; missingMember?: boolean;
  claims?: Record<string, unknown>; lostReply?: boolean; retry?: boolean; denied?: 'read' | 'write'; raw?: boolean;
  lossAt?: string; swapAt?: string; tokenGate?: Promise<void>;
}
async function harness(options: Options = {}) {
  const bundled = await compiled(options.raw), module = { exports: {} as any }, calls: string[] = [], docs = new Map<string, any>();
  const user = { uid: UID, email: 'settings-owner@example.invalid', emailVerified: options.verified ?? true };
  const auth = { app: { name: options.appName ?? `clinic-operating-${UUID}`, options: { projectId: options.projectId ?? PROJECT,
    authDomain: options.authDomain ?? `${PROJECT}.firebaseapp.com` } }, emulatorConfig: options.emulator ? {} : null,
    currentUser: options.missingUser ? null : user as typeof user | null };
  const active = { value: true }, location = { hostname: options.hostname ?? '127.0.0.1' }, rawAdapters = { settings: undefined as any, journal: undefined as any };
  let copy!: (value: unknown) => any;
  const step = (name: string) => { calls.push(name); if (options.lossAt === name) active.value = false; if (options.swapAt === name) auth.currentUser = { ...user }; };
  const snapshot = (key: string, kind: 'record' | 'transaction', source = docs) => ({
    exists: () => { step(`${kind}-exists`); return source.has(key); }, data: () => { step(`${kind}-data`); return source.get(key); },
  });
  const scope = { module, exports: module.exports, TextEncoder, crypto: webcrypto, atob, btoa, URL,
    window: { location, get localStorage() { throw new Error('PRIVATE_LOCAL_STORAGE'); } },
    get localStorage() { throw new Error('PRIVATE_LOCAL_STORAGE'); }, get sessionStorage() { throw new Error('PRIVATE_SESSION_STORAGE'); },
    fetch: () => { throw new Error('PRIVATE_NETWORK'); },
    require: (name: string) => {
      calls.push(`import:${name}`);
      if (name === './cloudClinicSettingsRepository' && options.raw) return {
        CLOUD_CLINIC_SETTINGS_PATH: SETTINGS, CLOUD_CLINIC_LOGO_PATH: 'clinics/main/settings/clinicLogo', CLOUD_PROSTHETIC_ROUTING_PATH: ROUTING,
        createCloudClinicSettingsRepository: (adapter: unknown) => { rawAdapters.settings = adapter; return adapter; },
        CloudClinicSettingsError: class extends Error { constructor(public code: string) { super(`SAFE_SETTINGS_${code}`); } },
      };
      if (name === './cloudOperationIntent' && options.raw) return {
        createCloudOperationIntentRepository: (adapter: unknown) => { rawAdapters.journal = adapter; return adapter; },
        CloudOperationIntentError: class extends Error { constructor(public code: string) { super(`SAFE_INTENT_${code}`); } },
      };
      if (name === 'firebase/auth') return { getIdTokenResult: async (target: unknown) => {
        assert.equal(target, user); step('token'); await options.tokenGate;
        return { signInProvider: options.provider ?? 'password', claims: copy({ sub: UID, aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`,
          email: user.email, email_verified: options.tokenVerified ?? true, dentalClinicId: 'main', dentalClinicRole: 'owner', auth_time: 100, ...options.claims }) };
      } };
      if (name === 'firebase/firestore/lite') return {
        getFirestore: (app: unknown, database: string) => { assert.equal(app, auth.app); assert.equal(database, '(default)'); step('database'); return 'synthetic-settings-db'; },
        doc: (db: unknown, ...parts: string[]) => { assert.equal(db, 'synthetic-settings-db'); const key = parts.join('/'); step(key.includes('/members/') ? 'member-doc' : 'record-doc'); calls.push(`doc:${key}`); return key; },
        getDoc: async (key: string) => {
          if (key === `clinics/main/members/${UID}`) {
            step('member'); return { exists: () => { step('member-exists'); return !options.missingMember; }, data: () => {
              step('member-data'); return copy({ schemaVersion: 1, clinicId: 'main', uid: UID, role: 'owner', status: 'active', identityVersion: 1, verifiedAfter: 100, ...options.member }); } };
          }
          step('record'); calls.push(`read:${key}`); if (options.denied === 'read') throw new Error('PRIVATE_DENIED_READ'); return snapshot(key, 'record');
        },
        collection: (db: unknown, ...parts: string[]) => { assert.equal(db, 'synthetic-settings-db'); step('collection'); return parts.join('/'); },
        documentId: () => { step('document-id'); return '__name__'; },
        orderBy: (field: string) => { step('order'); return { kind: 'order', field }; },
        where: (field: string, operator: string, value: string) => { step('where'); return { kind: 'where', field, operator, value }; },
        startAfter: (value: string) => { step('after'); return { kind: 'after', value }; },
        limit: (count: number) => { step('limit'); return { kind: 'limit', count }; },
        query: (key: string, ...constraints: any[]) => { step('query'); calls.push(`query:${key}:${JSON.stringify(constraints)}`); return { key, constraints }; },
        getDocs: async ({ key, constraints }: any) => {
          assert.ok(['clinics/main/labDefinitions', 'clinics/main/operationIntents'].includes(key));
          assert.deepEqual(constraints.find((value: any) => value.kind === 'order'), { kind: 'order', field: '__name__' });
          const count = constraints.at(-1).count; assert.ok(count >= 1 && count <= 50); assert.equal(constraints.at(-1).kind, 'limit');
          const filters = constraints.filter((value: any) => value.kind === 'where');
          if (key.endsWith('labDefinitions')) assert.deepEqual(filters, []);
          else assert.deepEqual(filters, [{ kind: 'where', field: 'actorUid', operator: '==', value: UID },
            { kind: 'where', field: 'kind', operator: '==', value: 'settings' },
            ...(filters.length === 2 ? [] : [{ kind: 'where', field: 'status', operator: '==', value: 'prepared' }])]);
          const after = constraints.find((value: any) => value.kind === 'after')?.value;
          const rows = [...docs].filter(([path, value]) => path.startsWith(`${key}/`) && (!after || path.split('/').at(-1)! > after)
            && filters.every((filter: any) => value[filter.field] === filter.value)).sort(([a], [b]) => a < b ? -1 : 1).slice(0, count);
          step('page'); if (options.denied === 'read') throw new Error('PRIVATE_DENIED_PAGE');
          return { get docs() { step('page-docs'); return rows.map(([path, value]) => ({ get id() { step('page-id'); return path.split('/').at(-1); },
            data: () => { step('page-data'); return value; } })); } };
        },
        runTransaction: async (db: unknown, work: any, settings: any) => {
          assert.equal(db, 'synthetic-settings-db'); assert.equal(settings.maxAttempts, 5); step('transaction-start');
          const attempt = async (publish: boolean) => {
            const staged = new Map(docs); let wrote = false;
            const result = await work({ get: async (key: string) => { assert.equal(wrote, false); step('transaction-read'); calls.push(`get:${key}`); return snapshot(key, 'transaction', staged); },
              set: (key: string, value: unknown) => { wrote = true; step('transaction-write'); if (options.denied === 'write') throw new Error('PRIVATE_DENIED_WRITE');
                calls.push(`set:${key}`); staged.set(key, value); } });
            if (publish) { docs.clear(); for (const [key, value] of staged) docs.set(key, value); } return result;
          };
          if (options.retry) { options.retry = false; await attempt(false); }
          const result = await attempt(true); step('transaction-ack');
          if (options.lostReply) { options.lostReply = false; throw new Error('PRIVATE_LOST_REPLY'); } return result;
        },
      };
      throw new Error('PRIVATE_UNEXPECTED_IMPORT');
    },
  };
  runInNewContext(bundled.outputFiles![0].text, scope); copy = runInNewContext('(value) => JSON.parse(JSON.stringify(value))', scope);
  const payload = copy({ target: 'prostheticRouting', recordId: 'prostheticRouting', operationId: OP, expectedRevision: 0, createdAt: WHEN, data: { routes: [] } });
  const capability = () => module.exports.createFirebaseCloudClinicSettings(auth, { isActive: () => active.value });
  return { bundled, exports: module.exports, auth, user, active, location, docs, calls, rawAdapters, copy, payload, options, capability };
}
const safe = (value: any) => ['invalid', 'conflict', 'unavailable'].includes(value?.code) && !String(value).includes('PRIVATE');
const lab = () => ({ schemaVersion: 1, clinicId: 'main', recordId: LAB, revision: 1, lastOperationId: OP,
  data: { name: 'معمل مصطنع', phone: '', address: '', notes: '', active: true,
    costs: [{ materialId: MATERIAL, name: 'مادة تجريبية', category: 'fixed', unitLabel: 'تاج', billingBasis: 'per-unit', unitCostCents: 12000, active: true }] } });

test('settings SDK import and capability construction never authenticate, read records/local data or initialize default/setup Auth', async () => {
  const h = await harness(); assert.deepEqual(h.calls, []); const capability = await h.capability();
  assert.ok(Object.isFrozen(capability)); assert.ok(Object.isFrozen(capability.repository)); assert.ok(Object.isFrozen(capability.journal));
  assert.deepEqual(h.calls, ['import:firebase/auth', 'import:firebase/firestore/lite', 'database']);
  assert.equal('auth' in capability, false); assert.equal('app' in capability, false);
  const inputs = Object.keys(h.bundled.metafile!.inputs); assert.equal(inputs.some(path => /storage|initialData|firebaseService|App\.tsx/.test(path)), false);
});
test('factory rejects external host wrong/default/setup app emulator absent user and mismatched project before SDK imports', async () => {
  for (const options of [{ hostname: 'dental-clinic-mmaakk888.web.app' }, { hostname: '127.0.0.1.evil.invalid' }, { appName: '[DEFAULT]' },
    { appName: `clinic-setup-${UUID}` }, { appName: `clinic-operating-${UUID}\n` }, { projectId: 'wrong-project' },
    { authDomain: 'wrong.invalid' }, { emulator: true }, { missingUser: true }]) {
    const h = await harness(options); await assert.rejects(h.capability(), safe); assert.deepEqual(h.calls, []);
  }
});
test('owner authorization validates password identity verified email and exact fresh canonical membership before settings reads', async () => {
  for (const options of [{ verified: false }, { tokenVerified: false }, { provider: 'anonymous' }, { missingMember: true },
    { claims: { dentalClinicRole: 'secretary' } }, { member: { role: 'secretary' } }, { member: { status: 'disabled' } },
    { member: { verifiedAfter: 101 } }, { member: { extra: 'PRIVATE' } }]) {
    const h = await harness(options), capability = await h.capability(); await assert.rejects(capability.repository.get(), safe);
    assert.equal(h.calls.some(call => call.startsWith(`read:${SETTINGS}`)), false);
  }
});
test('named owner SDK atomically commits explicit routing with receipt+intent and repeats only original historical acknowledgement', async () => {
  const h = await harness(), capability = await h.capability(); await capability.journal.prepare('settings', h.payload, WHEN);
  assert.equal((await capability.repository.commit(h.payload)).status, 'committed');
  assert.equal(h.docs.get(ROUTING).revision, 1); assert.equal(h.docs.get(INTENT).status, 'committed'); assert.equal(h.docs.has(RECEIPT), true);
  const before = h.calls.length; assert.equal((await capability.repository.commit(h.payload)).status, 'already-committed');
  assert.equal(h.calls.slice(before).some(call => call.startsWith('set:')), false);
  assert.equal(h.calls.slice(before).includes(`get:${ROUTING}`), false);
});
test('lost SDK reply retains accepted command for history+same-ID replay without another settings revision', async () => {
  const h = await harness(), capability = await h.capability(); await capability.journal.prepare('settings', h.payload, WHEN);
  h.options.lostReply = true; await assert.rejects(capability.repository.commit(h.payload), safe); assert.equal(h.docs.get(ROUTING).revision, 1);
  const history = await capability.journal.listHistoryPage('settings'); assert.equal(history.records[0].status, 'committed');
  const second = await h.capability(); assert.equal((await second.repository.commit(history.records[0].command)).status, 'already-committed');
  assert.equal(h.docs.get(ROUTING).revision, 1); assert.equal(h.docs.size, 3);
});
test('SDK callback retries and write denial never publish duplicate revisions or partial companions', async () => {
  const h = await harness(), capability = await h.capability(); await capability.journal.prepare('settings', h.payload, WHEN);
  h.options.retry = true; await capability.repository.commit(h.payload); assert.equal(h.docs.size, 3); assert.equal(h.docs.get(ROUTING).revision, 1);
  const x = await harness(), second = await x.capability(); await second.journal.prepare('settings', x.payload, WHEN); x.options.denied = 'write';
  await assert.rejects(second.repository.commit(x.payload), safe); assert.equal(x.docs.has(ROUTING), false); assert.equal(x.docs.get(INTENT).status, 'prepared');
});
test('SDK lists explicit bounded lab pages independent from logo/settings records and journal queries bind owner/kind/status', async () => {
  const h = await harness(), capability = await h.capability(); h.docs.set(`clinics/main/labDefinitions/${LAB}`, h.copy(lab()));
  const rows = await capability.repository.listLabsPage(h.copy({ limit: 1 })); assert.equal(rows.records[0].recordId, LAB); assert.equal(rows.nextAfterId, LAB);
  assert.equal((await capability.repository.listLabsPage(h.copy({ afterId: LAB, limit: 1 }))).records.length, 0);
  await capability.journal.prepare('settings', h.payload, WHEN); assert.equal((await capability.journal.listPreparedPage('settings')).records.length, 1);
  await capability.repository.commit(h.payload); assert.equal((await capability.journal.listPreparedPage('settings')).records.length, 0);
  assert.equal((await capability.journal.listHistoryPage('settings')).records.length, 1);
  assert.equal(h.calls.some(call => call.includes('clinicLogo')), false);
});
test('catalog is transaction-readonly and adapters reject arbitrary paths lists receipt gets and direct writes to catalog/counters/profiles', async () => {
  const h = await harness({ raw: true }); await h.capability(); const adapter = h.rawAdapters.settings;
  for (const path of ['clinics/main/settings/serviceCatalog', 'clinics/main/patientCounters/main', 'clinics/main/patientProfiles/' + LAB,
    'clinics/other/settings/clinicSettings', 'clinics/main/settings/clinicSettings/extra', `clinics/main/labDefinitions/${LAB}\n`, RECEIPT, INTENT])
    await assert.rejects(async () => adapter.readRecord(path), safe);
  for (const path of ['clinics/main/settings/serviceCatalog', 'clinics/main/patientCounters/main', 'clinics/main/patientProfiles/' + LAB])
    await assert.rejects(adapter.runTransaction((transaction: any) => transaction.set(path, {})), safe);
  const count = h.calls.length; await adapter.runTransaction(async (transaction: any) => assert.equal(await transaction.get('clinics/main/settings/serviceCatalog'), null));
  assert.equal(h.calls.slice(count).includes('get:clinics/main/settings/serviceCatalog'), true);
});
test('domain kind full command time target and unsupported settings secrets fail before journal creates a document', async () => {
  const h = await harness(), capability = await h.capability();
  for (const action of [() => capability.journal.prepare('catalog', h.payload, WHEN),
    () => capability.journal.prepare('settings', h.payload, '2026-10-12T00:00:00.001Z'),
    () => capability.journal.prepare('settings', h.copy({ ...h.payload, data: { routes: [], apiKey: 'PRIVATE' } }), WHEN),
    () => capability.journal.prepare('settings', h.copy({ ...h.payload, target: 'patient-profile' }), WHEN)]) await assert.rejects(action(), safe);
  assert.equal(h.docs.size, 0); assert.equal(h.calls.some(call => call.startsWith('set:')), false);
});
test('journal cancellation validates entire stored settings command before it can stage any hidden mutation', async () => {
  const h = await harness(), capability = await h.capability(); await capability.journal.prepare('settings', h.payload, WHEN);
  const value = h.docs.get(INTENT); value.command.data.routes.push(h.copy({ serviceId: 'bad', labId: LAB, materialId: MATERIAL }));
  value.requestHash = createHash('sha256').update(JSON.stringify(['clinic-operation-intent-v1', UID, 'settings', WHEN, value.command])).digest('hex');
  const before = h.calls.length; await assert.rejects(capability.journal.cancel(OP), safe);
  assert.equal(h.calls.slice(before).some(call => call.startsWith('set:')), false); assert.equal(h.docs.get(INTENT).status, 'prepared');
});
test('all SDK read/query boundaries reject late lease loss and permanently revoke retained settings capability', async () => {
  for (const lossAt of ['token', 'member-doc', 'member', 'member-exists', 'member-data', 'record-doc', 'record', 'record-exists']) {
    const h = await harness(), capability = await h.capability(); h.options.lossAt = lossAt;
    await assert.rejects(capability.repository.get(), safe); h.options.lossAt = undefined; h.active.value = true;
    const before = h.calls.length; await assert.rejects(capability.repository.get(), safe); assert.equal(h.calls.length, before);
  }
  for (const lossAt of ['document-id', 'order', 'after', 'limit', 'collection', 'query', 'page', 'page-docs', 'page-id', 'page-data']) {
    const h = await harness(), capability = await h.capability(); h.docs.set(`clinics/main/labDefinitions/${LAB}`, h.copy(lab())); h.options.lossAt = lossAt;
    await assert.rejects(capability.repository.listLabsPage(h.copy({ afterId: lossAt === 'after' ? UUID : null })), safe);
    assert.equal(h.calls.includes(lossAt), true, `synthetic SDK reached ${lossAt}`);
  }
});
test('exact captured Auth user object is required even when replacement has the same UID', async () => {
  for (const swapAt of ['token', 'member-data', 'record-exists']) {
    const h = await harness(), capability = await h.capability(); h.options.swapAt = swapAt; await assert.rejects(capability.repository.get(), safe);
    h.options.swapAt = undefined; h.auth.currentUser = h.user; await assert.rejects(capability.repository.get(), safe);
  }
});
test('actual host/app/runtime loss is permanent while late SDK failures expose no provider details', async () => {
  for (const change of [(h: Awaited<ReturnType<typeof harness>>) => h.location.hostname = 'evil.invalid',
    (h: Awaited<ReturnType<typeof harness>>) => h.auth.app = { ...h.auth.app },
    (h: Awaited<ReturnType<typeof harness>>) => h.auth.emulatorConfig = {}]) {
    const h = await harness(), capability = await h.capability(); change(h); await assert.rejects(capability.repository.getRouting(), safe);
  }
  const h = await harness(), capability = await h.capability(); h.options.denied = 'read'; await assert.rejects(capability.repository.get(), safe);
});
test('journal and command UUID cursors reject trailing newlines, arbitrary owner filters and unknown query fields', async () => {
  const h = await harness(), capability = await h.capability();
  for (const action of [() => capability.repository.getLab(`${LAB}\n`), () => capability.repository.listLabsPage({ limit: 51 }),
    () => capability.repository.listLabsPage({ afterId: `${LAB}\n` }), () => capability.repository.listLabsPage({ owner: 'other' }),
    () => capability.journal.get(`${OP}\n`), () => capability.journal.listHistoryPage('settings', { actorUid: 'other' })])
    await assert.rejects(action(), safe);
  assert.equal(h.calls.some(call => call.startsWith('read:') || call.startsWith('get:') || call.startsWith('set:')), false);
});
