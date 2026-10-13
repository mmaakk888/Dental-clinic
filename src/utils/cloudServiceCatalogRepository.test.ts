import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createCloudOperationIntentRepository, type CloudIntentAdapter } from './cloudOperationIntent';
import { CloudServiceCatalogError, createCloudServiceCatalogRepository, parseCloudServiceCatalogData,
  parseCloudServiceCatalogRecord, prepareCloudServiceCatalogCommand, MAX_CLOUD_SERVICE_CATALOG_BYTES,
  prepareCloudServiceCatalogMutationCommand, applyCloudServiceCatalogMutation, normalizedCloudServiceName, cloudCatalogServiceIdPath, cloudCatalogServiceNamePath,
  type CloudServiceCatalogAdapter, type CloudServiceCatalogCommand, type CloudServiceCatalogData,
  type CloudServiceCatalogWriteCommand, type CloudServiceCatalogMutationCommand, type CloudServiceDefinition } from './cloudServiceCatalogRepository';

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
    prepare: (value: CloudServiceCatalogWriteCommand) => journal.prepare('catalog', prepareCloudServiceCatalogCommand(value), value.createdAt),
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

const exam = (number = 1, revision = 0, examinationCents = 10000): CloudServiceCatalogMutationCommand => ({
  mutationVersion: 2, action: 'examination', operationId: id(number), expectedRevision: revision, createdAt: WHEN, examinationCents });
const service = (number = 2, revision = 1, index = 0, changes: Partial<CloudServiceDefinition> = {}): CloudServiceCatalogMutationCommand => ({
  mutationVersion: 2, action: 'service', operationId: id(number), expectedRevision: revision, createdAt: WHEN, index,
  service: { ...data().services[0], ...changes } });
async function commit(h: ReturnType<typeof harness>, value: CloudServiceCatalogWriteCommand) { await h.prepare(value); return h.repo.commit(value); }
async function initialized() { const h=harness(); await commit(h,exam()); return h; }
async function populated() { const h=await initialized(); await commit(h,service()); return h; }
const nameKey = (name: string) => createHash('sha256').update(`catalog-service-name-v2:${normalizedCloudServiceName(name)}`).digest('hex');

test('explicit examination initializes the unknown catalog without creating services or patient charges', async () => {
  const h=harness(); assert.deepEqual(await commit(h,exam()), {status:'committed',recordId:'serviceCatalog',revision:1});
  assert.deepEqual((await h.repo.get())?.data,{examinationCents:10000,services:[]}); assert.equal(h.docs.size,3);
  assert.equal(h.docs.get(intent(1)).status,'committed');
  assert.equal([...h.docs.keys()].some(key=>/patient|lab|catalogService/.test(key)),false);
});
test('service append and price edit preserve examination, all other services and permanent identity/name reservations', async () => {
  const h=await populated(); await commit(h,service(3,2,1,{serviceId:serviceId(2),name:'زيركون',kind:'prosthetic',priceCents:null}));
  const other=structuredClone((await h.repo.get())!.data.services[1]);
  await commit(h,service(4,3,0,{priceCents:0}));
  const current=(await h.repo.get())!; assert.equal(current.data.examinationCents,10000);
  assert.equal(current.data.services[0].priceCents,0); assert.deepEqual(current.data.services[1],other);
  assert.equal(h.docs.get(cloudCatalogServiceIdPath(serviceId(1))).revision,2);
  assert.equal(h.docs.get(cloudCatalogServiceNamePath(nameKey('حشو عادي'))).serviceId,serviceId(1));
});
test('renames retain old reservation ownership; normalized names cannot move to another service UUID', async () => {
  const h=await populated(); await commit(h,service(3,2,0,{name:'حشو تجميلي'}));
  assert.equal(h.docs.has(cloudCatalogServiceNamePath(nameKey('حشو عادي'))),true);
  const duplicate=service(4,3,1,{serviceId:serviceId(2),name:'حشو عَادي'});
  await h.prepare(duplicate); const before=structuredClone(h.docs); await assert.rejects(h.repo.commit(duplicate),code('conflict')); assert.deepEqual(h.docs,before);
  await commit(h,service(5,3,0,{name:'حشو عادي'})); assert.equal((await h.repo.get())?.data.services[0].name,'حشو عادي');
});
test('stable indexes cannot replace another UUID, jump, reorder or physically remove services', async () => {
  const h=await populated();
  for(const value of [service(3,2,0,{serviceId:serviceId(2)}),service(4,2,2,{serviceId:serviceId(2),name:'خدمة أخرى'})]) {
    await h.prepare(value); const before=structuredClone(h.docs); await assert.rejects(h.repo.commit(value),code('conflict')); assert.deepEqual(h.docs,before);
  }
  assert.throws(()=>prepareCloudServiceCatalogMutationCommand({...service(),action:'remove'}),code('invalid'));
  const empty=harness(), value=service(9,0); await empty.prepare(value); await assert.rejects(empty.repo.commit(value),code('conflict')); assert.equal(empty.docs.has(CATALOG),false);
});
test('missing or corrupt service and name reservations cannot be silently recreated for existing rows', async () => {
  for(const change of [
    (h:ReturnType<typeof harness>)=>h.docs.delete(cloudCatalogServiceIdPath(serviceId(1))),
    (h:ReturnType<typeof harness>)=>h.docs.get(cloudCatalogServiceIdPath(serviceId(1))).index=1,
    (h:ReturnType<typeof harness>)=>h.docs.delete(cloudCatalogServiceNamePath(nameKey('حشو عادي'))),
    (h:ReturnType<typeof harness>)=>h.docs.get(cloudCatalogServiceNamePath(nameKey('حشو عادي'))).serviceId=serviceId(2),
  ]) { const h=await populated(); change(h); const value=service(3,2,0,{priceCents:1}); await h.prepare(value);
    const before=structuredClone(h.docs); await assert.rejects(h.repo.commit(value)); assert.deepEqual(h.docs,before); }
});
test('deactivation or kind change rejects routed services; explicit unlinked deactivation retains the historical row', async () => {
  for(const change of [{active:false},{kind:'prosthetic' as const}]) {
    const h=await populated(); h.docs.set('clinics/main/settings/prostheticRouting',{schemaVersion:1,clinicId:'main',recordId:'prostheticRouting',
      revision:1,lastOperationId:id(99),data:{routes:[{serviceId:serviceId(1),labId:id(80),materialId:id(81)}]}});
    const value=service(3,2,0,change); await h.prepare(value); const before=structuredClone(h.docs);
    await assert.rejects(h.repo.commit(value),code('conflict')); assert.deepEqual(h.docs,before);
  }
  const h=await populated(); h.docs.set('clinics/main/settings/prostheticRouting',{schemaVersion:1,clinicId:'main',recordId:'prostheticRouting',
    revision:1,lastOperationId:id(99),data:{routes:[]}}); await commit(h,service(3,2,0,{active:false}));
  assert.equal((await h.repo.get())?.data.services.length,1); assert.equal((await h.repo.get())?.data.services[0].active,false);
});
test('legacy full replacements are read-only historical acknowledgements, never ordinary client first writes', async () => {
  const h=harness(), old=command(90,0,{data:{examinationCents:0,services:[]}});
  await h.prepare(old); const before=structuredClone(h.docs); await assert.rejects(h.repo.commit(old),code('invalid')); assert.deepEqual(h.docs,before);
  const prepared=h.docs.get(intent(90)); h.docs.set(intent(90),{...prepared,status:'committed',revision:2});
  h.docs.set(operation(90),{schemaVersion:1,clinicId:'main',operationId:id(90),recordId:'serviceCatalog',actorUid:OWNER,
    expectedRevision:0,resultRevision:1,createdAt:WHEN,requestHash:await digest(JSON.stringify(['clinic-service-catalog-v1',OWNER,old]))});
  h.docs.set(CATALOG,{schemaVersion:1,clinicId:'main',recordId:'serviceCatalog',revision:8,lastOperationId:id(88),data:data()});
  const history=structuredClone(h.docs); assert.equal((await h.repo.commit(old)).status,'already-committed'); assert.deepEqual(h.docs,history);
});
test('same-ID retries acknowledge only history without reading or restoring newer catalogs, reservations or routing', async () => {
  const h=await populated(), first=service(); await commit(h,exam(3,2,20000));
  h.docs.delete(cloudCatalogServiceIdPath(serviceId(1))); h.calls.length=0;
  const before=structuredClone(h.docs); assert.deepEqual(await h.client().commit(first),{status:'already-committed',recordId:'serviceCatalog',revision:2});
  assert.deepEqual(h.docs,before); assert.deepEqual(h.calls.filter(key=>key.startsWith('get:')).sort(),[`get:${operation(2)}`,`get:${intent(2)}`].sort());
});
test('lost acknowledgement recovers original small mutation from history without new IDs or replacement payloads', async () => {
  const h=await initialized(), value=service(); await h.prepare(value); h.faults.lostCommitReply=true;
  await assert.rejects(h.repo.commit(value),code('unavailable')); const before=structuredClone(h.docs);
  const recovered=(await h.journal.listHistoryPage('catalog')).records.find(row=>row.operationId===id(2))!;
  assert.equal((await h.repo.commit(prepareCloudServiceCatalogCommand(recovered.command))).status,'already-committed');
  assert.deepEqual(h.docs,before); assert.equal('data' in recovered.command,false);
});
test('missing, cancelled or mismatched exact durable intent never writes a catalog mutation', async () => {
  const h=harness(), value=exam(); await assert.rejects(h.repo.commit(value),code('invalid')); assert.equal(h.docs.size,0);
  await h.prepare(value); await h.journal.cancel(id(1)); const before=structuredClone(h.docs);
  await assert.rejects(h.repo.commit(value),code('conflict')); assert.deepEqual(h.docs,before);
  for(const modify of [(i:any)=>i.actorUid='other',(i:any)=>i.kind='clinical',(i:any)=>i.command.examinationCents++,
    (i:any)=>i.requestHash='0'.repeat(64),(i:any)=>i.createdAt='2026-10-11T00:00:00.001Z']) {
    const x=harness(); await x.prepare(value); modify(x.docs.get(intent(1))); const state=structuredClone(x.docs);
    await assert.rejects(x.repo.commit(value)); assert.deepEqual(x.docs,state);
  }
});
test('same-ID changed body, time, expected revision or actor cannot become a fresh successful save', async () => {
  const h=await initialized(), before=structuredClone(h.docs);
  for(const value of [exam(1,1),exam(1,0,0),{...exam(),createdAt:'2026-10-11T00:00:00.001Z'}]) await assert.rejects(h.repo.commit(value),code('conflict'));
  h.owner('another-owner'); await assert.rejects(h.repo.commit(exam()),code('conflict')); assert.deepEqual(h.docs,before);
});
test('concurrent examinations use CAS, never overwrite or rebase the other owner operation', async () => {
  const h=harness(), a=exam(), b=exam(2,0,0); await h.prepare(a); await h.prepare(b);
  const results=await Promise.allSettled([h.repo.commit(a),h.client().commit(b)]);
  assert.equal(results.filter(row=>row.status==='fulfilled').length,1);
  assert.equal((await h.repo.get())?.revision,1); assert.equal([...h.docs.keys()].filter(key=>key.includes('/catalogOperations/')).length,1);
});
test('stale mutation, missing singleton at nonzero revision and corrupt existing singleton fail closed', async () => {
  const h=await initialized(), stale=exam(2,0); await h.prepare(stale); const before=structuredClone(h.docs);
  await assert.rejects(h.repo.commit(stale),code('conflict')); assert.deepEqual(h.docs,before);
  for(const raw of [null,{revision:1},{schemaVersion:1,clinicId:'other',recordId:'serviceCatalog',revision:1,lastOperationId:id(9),data:data()}]) {
    const x=harness(); if(raw!==null)x.docs.set(CATALOG,raw); const value=exam(4,1); await x.prepare(value); const state=structuredClone(x.docs);
    await assert.rejects(x.repo.commit(value)); assert.deepEqual(x.docs,state);
  }
});
test('corrupt historical receipt or journal cannot acknowledge, repair or overwrite a previous mutation', async () => {
  for(const modify of [(h:ReturnType<typeof harness>)=>h.docs.delete(intent(1)),(h:ReturnType<typeof harness>)=>h.docs.delete(operation(1)),
    (h:ReturnType<typeof harness>)=>h.docs.get(operation(1)).requestHash='0'.repeat(64),
    (h:ReturnType<typeof harness>)=>h.docs.get(operation(1)).extra=true,
    (h:ReturnType<typeof harness>)=>Object.assign(h.docs.get(intent(1)),{status:'prepared',revision:1})]) {
    const h=await initialized(); modify(h); const before=structuredClone(h.docs); await assert.rejects(h.repo.commit(exam())); assert.deepEqual(h.docs,before);
  }
});
test('transaction callback retries publish one service index/name reservation, not duplicate rows or revisions', async () => {
  const h=await initialized(), value=service(); await h.prepare(value); h.faults.retry=true; await h.repo.commit(value);
  assert.equal((await h.repo.get())?.revision,2); assert.equal((await h.repo.get())?.data.services.length,1);
  assert.equal([...h.docs.keys()].filter(key=>key.includes('/catalogServiceIds/')).length,1);
});
test('failure at every five-write service transition is atomic and original retry succeeds', async () => {
  for(const position of [1,2,3,4,5]) { const h=await initialized(), value=service(); await h.prepare(value);
    const before=structuredClone(h.docs); h.faults.failWriteAt=h.writes()+position; await assert.rejects(h.repo.commit(value),code('unavailable'));
    assert.deepEqual(h.docs,before); h.faults.failWriteAt=0; await h.repo.commit(value); assert.equal((await h.repo.get())?.revision,2); }
});
test('owner loss before a write denies it; late loss hides acknowledgement without reversing an accepted operation', async () => {
  const h=await initialized(), value=service(); await h.prepare(value); const before=structuredClone(h.docs);
  h.hooks.read=target=>{if(target===CATALOG)h.owner('changed-owner');}; await assert.rejects(h.repo.commit(value),code('unavailable')); assert.deepEqual(h.docs,before);
  const x=harness(); await x.prepare(exam()); x.hooks.afterCommit=()=>x.owner('changed-owner');
  await assert.rejects(x.repo.commit(exam()),code('unavailable')); assert.equal(x.docs.get(CATALOG).revision,1);
  x.hooks.afterCommit=undefined;x.owner(OWNER);assert.equal((await x.repo.commit(exam())).status,'already-committed');
});
test('mutation body snapshots before authorization await and never invokes field accessors', async () => {
  const h=await initialized(), input=service(), saved=structuredClone(input); await h.prepare(saved);
  const started=deferred(),gate=deferred();let first=true;h.hooks.auth=async()=>{if(first){first=false;started.resolve();await gate.promise;}};
  const pending=h.repo.commit(input);await started.promise;if(input.action==='service'){input.service.name='تعديل متأخر';input.service.priceCents=0;}
  input.expectedRevision=9;input.operationId=id(99);gate.resolve();await pending;
  assert.deepEqual((await h.repo.get())?.data.services[0],(saved as Extract<CloudServiceCatalogMutationCommand,{action:'service'}>).service);
  let executions=0; const getter=Object.defineProperty({...service()},'service',{enumerable:true,get(){executions++;return data().services[0];}});
  assert.throws(()=>prepareCloudServiceCatalogMutationCommand(getter),code('invalid'));assert.equal(executions,0);
});
test('canonical new names and exact mutation schemas reject compatibility, controls, arbitrary Unicode and full-list replacement fields', () => {
  for(const name of ['Ｓｅｒｖｉｃｅ','😀','ٵ','حشو\u202e']) assert.throws(()=>prepareCloudServiceCatalogMutationCommand(service(2,1,0,{name})),code('invalid'));
  for(const change of [{mutationVersion:1},{index:-1},{index:300},{index:0.5},{extra:true},{data:data()}])
    assert.throws(()=>prepareCloudServiceCatalogMutationCommand({...service(),...change}),code('invalid'));
  assert.deepEqual(applyCloudServiceCatalogMutation(null,exam(1,0,0)),{examinationCents:0,services:[]});
});
test('get reauthorizes after server reads and malformed providers expose fixed errors only', async () => {
  const h=harness();h.hooks.read=()=>h.owner('changed-owner');await assert.rejects(h.repo.get(),code('unavailable'));
  const x=harness();x.docs.set(CATALOG,{schemaVersion:1});await assert.rejects(x.repo.get(),code('invalid'));
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
  const input = exam(1, 1_999_999_999); await h.prepare(input); await h.repo.commit(input);
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
