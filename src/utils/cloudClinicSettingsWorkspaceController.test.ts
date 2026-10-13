import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createCloudClinicSettingsWorkspaceController, type CloudClinicSettingsWorkspaceController,
  type CloudClinicSettingsWorkspaceCapability } from './cloudClinicSettingsWorkspaceController';
import { createCloudClinicSettingsRepository, prepareCloudClinicSettingsCommand, CLOUD_PROSTHETIC_ROUTING_PATH,
  type CloudClinicSettingsAdapter, type CloudClinicSettingsCommand } from './cloudClinicSettingsRepository';
import { createCloudOperationIntentRepository, type CloudIntentAdapter } from './cloudOperationIntent';

// Synthetic full repository+journal composition only. No SDK/live Auth/Rules,
// browser files, patient data, owner credentials or device acceptance.
const OWNER = 'synthetic-settings-workspace-owner', WHEN = '2026-10-12T00:00:00.000Z';
const id = (number: number) => `60000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const LAB = '70000000-0000-4000-8000-000000000001', MATERIAL = '80000000-0000-4000-8000-000000000001', SERVICE = '90000000-0000-4000-8000-000000000001';
const digest = async (value: string) => createHash('sha256').update(value).digest('hex');
const envelope = (recordId: string, data: unknown, revision = 1, operationId = id(99)) => ({ schemaVersion: 1, clinicId: 'main', recordId, revision, lastOperationId: operationId, data });
const catalog = () => envelope('serviceCatalog', { examinationCents: 10000,
  services: [{ serviceId: SERVICE, name: 'خدمة مصطنعة', kind: 'prosthetic', priceCents: 30000, active: true }] });
const lab = () => envelope(LAB, { name: 'معمل مصطنع', phone: '', address: '', notes: '', active: true,
  costs: [{ materialId: MATERIAL, name: 'مادة مصطنعة', category: 'fixed', unitLabel: 'تاج', billingBasis: 'per-unit', unitCostCents: 10000, active: true }] });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(accept => { resolve = accept; }); return { promise, resolve }; }
function harness() {
  const docs = new Map<string, any>(), calls: string[] = []; let tail = Promise.resolve(), writes = 0;
  const faults = { lostPrepare: false, lostCommit: false, failRefresh: false };
  const hooks: { read?: (path: string) => Promise<void> | void; getCatalog?: () => Promise<unknown>; capability?: () => Promise<CloudClinicSettingsWorkspaceCapability> } = {};
  const adapter: CloudClinicSettingsAdapter & CloudIntentAdapter = {
    authorizeOwner: async () => OWNER,
    readRecord: async path => { calls.push(`read:${path}`); await hooks.read?.(path);
      if (faults.failRefresh && path === CLOUD_PROSTHETIC_ROUTING_PATH) throw new Error('PRIVATE_REFRESH'); return structuredClone(docs.get(path) ?? null); },
    listLabsPage: async (after, count) => [...docs].filter(([path]) => path.startsWith('clinics/main/labDefinitions/') && (!after || path.split('/').at(-1)! > after))
      .sort(([a], [b]) => a < b ? -1 : 1).slice(0, count).map(([path, data]) => ({ id: path.split('/').at(-1), data: structuredClone(data) })),
    listHistoryPage: async (kind, actor, after, count) => [...docs].filter(([path, value]) => path.startsWith('clinics/main/operationIntents/') && value.kind === kind
      && value.actorUid === actor && (!after || value.operationId > after)).sort(([a], [b]) => a < b ? -1 : 1).slice(0, count)
      .map(([path, data]) => ({ id: path.split('/').at(-1), data: structuredClone(data) })),
    runTransaction: async work => {
      const previous = tail; let release!: () => void; tail = new Promise<void>(accept => { release = accept; }); await previous;
      try {
        const staged = structuredClone(docs); let wrote = false, prepare = false, commit = false;
        const result = await work({ get: async path => { assert.equal(wrote, false); calls.push(`get:${path}`); return structuredClone(staged.get(path) ?? null); },
          set: (path, value: any) => { wrote = true; writes++; prepare ||= path.includes('/operationIntents/') && value.status === 'prepared';
            commit ||= path.startsWith('clinics/main/settings/') || path.startsWith('clinics/main/labDefinitions/'); staged.set(path, structuredClone(value)); } });
        docs.clear(); for (const [path, value] of staged) docs.set(path, value);
        if (prepare && faults.lostPrepare) { faults.lostPrepare = false; throw new Error('PRIVATE_PREPARE'); }
        if (commit && faults.lostCommit) { faults.lostCommit = false; throw new Error('PRIVATE_COMMIT'); } return result;
      } finally { release(); }
    },
  };
  const capability = () => ({ repository: createCloudClinicSettingsRepository(adapter, { digest }), journal: createCloudOperationIntentRepository(adapter, { digest }) });
  function client(start = 1) {
    let number = start - 1, active = true, ids = 0, times = 0;
    const controller = createCloudClinicSettingsWorkspaceController({ getCapability: async () => { calls.push('capability'); return hooks.capability ? hooks.capability() : capability(); },
      getServiceCatalog: async () => { calls.push('catalog-capability'); return { repository: { get: async () => { calls.push('catalog-get'); return hooks.getCatalog ? hooks.getCatalog() : structuredClone(docs.get('clinics/main/settings/serviceCatalog') ?? null); } } }; },
      isActive: () => active, newId: () => { ids++; return id(++number); }, now: () => { times++; return WHEN; } });
    return { controller, deactivate: () => { active = false; }, reactivate: () => { active = true; }, ids: () => ids, times: () => times };
  }
  return { docs, calls, faults, hooks, adapter, client, capability, writes: () => writes };
}
async function edit(controller: CloudClinicSettingsWorkspaceController, data: unknown = { routes: [] }) {
  assert.equal(await controller.load('prostheticRouting'), true); assert.equal(controller.beginEdit(), true); assert.equal(controller.updateDraft(data), true);
}

test('settings workspace construction/mount snapshot is inert, frozen and unknown without defaults/IDs/clock', () => {
  const h = harness(), c = h.client(); assert.deepEqual(h.calls, []); const state = c.controller.getState();
  assert.equal(Object.isFrozen(state), true); assert.equal(state.loaded, false); assert.equal(state.snapshot, null); assert.equal(state.draft, null);
  assert.equal(c.controller.beginEdit(), false); assert.equal(c.ids(), 0); assert.equal(c.times(), 0); assert.deepEqual(h.calls, []);
});
test('explicit null read starts unknown raw draft and invalid save never sends or seeds a replacement', async () => {
  const h = harness(), c = h.client(); await c.controller.load(); assert.equal(c.controller.beginEdit(), true); assert.equal(c.controller.getState().draft?.data, null);
  assert.equal(await c.controller.save(), false); assert.equal(h.docs.size, 0); assert.equal(c.controller.canClose(), false);
  assert.equal(c.controller.cancelDraft(), true); assert.equal(c.controller.canClose(), true);
});
test('incomplete raw editor fields survive updates and lock every navigation/read until explicitly cancelled', async () => {
  const h = harness(), c = h.client(); await edit(c.controller); const before = c.controller.getState().draft!;
  assert.equal(c.controller.updateDraft({ routes: [{ serviceId: '', labId: LAB, materialId: '' }] }, before), true);
  const draft = c.controller.getState().draft; assert.equal(Object.isFrozen(draft?.data), true); assert.equal(c.controller.canClose(), false);
  const count = h.calls.length; assert.equal(await c.controller.load(), false); assert.equal(await c.controller.loadLabs(), false);
  assert.equal(await c.controller.loadRoutingReferences(), false); assert.equal(await c.controller.loadHistory(), false); assert.equal(await c.controller.resume(id(1)), false);
  assert.equal(h.calls.length, count); assert.equal(c.controller.cancelDraft(before), false); assert.equal(c.controller.cancelDraft(draft), true);
});
test('raw drafts reject accessors/prototypes/sparse arrays and excessive journal bytes without changing current draft', async () => {
  const h = harness(), c = h.client(); await edit(c.controller); const before = c.controller.getState().draft; let getters = 0;
  const accessor = Object.defineProperty({}, 'routes', { enumerable: true, get() { getters++; return []; } });
  for (const data of [accessor, Object.assign(Object.create({}), { routes: [] }), new Array(1), { notes: 'a'.repeat(129 * 1024) }]) {
    assert.equal(c.controller.updateDraft(data), false); assert.equal(c.controller.getState().draft, before);
  }
  assert.equal(getters, 0);
});
test('owner save prepares and commits exact original command then refreshes only current protected record', async () => {
  const h = harness(), c = h.client(); await edit(c.controller); assert.equal(await c.controller.save(), true);
  assert.equal(h.docs.get(CLOUD_PROSTHETIC_ROUTING_PATH).revision, 1); assert.equal(h.docs.get(`clinics/main/operationIntents/${id(1)}`).status, 'committed');
  assert.equal(c.controller.getState().draft, null); assert.equal(c.controller.getState().saveStatus, 'idle'); assert.equal(c.controller.canClose(), true);
  assert.equal(c.ids(), 1); assert.equal(c.times(), 1);
});
test('lost durable preparation retains operation/time and exact retry does not allocate a new ID', async () => {
  const h = harness(), c = h.client(); await edit(c.controller); h.faults.lostPrepare = true;
  assert.equal(await c.controller.save(), false); const state = c.controller.getState(); assert.equal(state.saveStatus, 'retry-required'); assert.equal(state.pendingOperationId, id(1));
  assert.equal(state.draft?.expectedRevision, 0); assert.equal(c.controller.cancelDraft(), false); assert.equal(c.controller.updateDraft({ routes: [] }), false);
  assert.equal(await c.controller.retry(), true); assert.equal(c.ids(), 1); assert.equal(c.times(), 1); assert.equal(h.docs.get(CLOUD_PROSTHETIC_ROUTING_PATH).revision, 1);
});
test('lost commit acknowledgement retries historical receipt without a second version', async () => {
  const h = harness(), c = h.client(); await edit(c.controller); h.faults.lostCommit = true;
  assert.equal(await c.controller.save(), false); assert.equal(h.docs.get(CLOUD_PROSTHETIC_ROUTING_PATH).revision, 1); const writes = h.writes();
  assert.equal(await c.controller.retry(), true); assert.equal(h.writes(), writes); assert.equal(c.ids(), 1);
});
test('acknowledged save with failed refresh retries reads only, never journal prepare/commit/cancel', async () => {
  const h = harness(), c = h.client(); await edit(c.controller); h.faults.failRefresh = true;
  assert.equal(await c.controller.save(), false); assert.equal(c.controller.getState().saveStatus, 'refresh-required');
  assert.equal(await c.controller.cancelPending(), false); const writes = h.writes(), before = h.calls.length; h.faults.failRefresh = false;
  assert.equal(await c.controller.retry(), true); assert.equal(h.writes(), writes); assert.equal(h.calls.slice(before).some(call => call.startsWith('get:')), false);
});
test('all-status history and new controller resume recover accepted original operation after later newer settings without overwrite', async () => {
  const h = harness(), first = h.client(); await edit(first.controller); h.faults.lostCommit = true; await first.controller.save(); first.controller.dispose();
  const next = h.client(2); await edit(next.controller); assert.equal(await next.controller.save(), true); assert.equal(h.docs.get(CLOUD_PROSTHETIC_ROUTING_PATH).revision, 2);
  const restored = h.client(99); assert.equal(await restored.controller.loadHistory(), true); assert.equal(restored.controller.getState().history[0].status, 'committed');
  const before = structuredClone(h.docs), writes = h.writes(); assert.equal(await restored.controller.resume(id(1)), true);
  assert.equal(restored.controller.getState().snapshot?.revision, 2); assert.deepEqual(h.docs, before); assert.equal(h.writes(), writes); assert.equal(restored.ids(), 0);
});
test('CAS conflict retains stale command until confirmed cancellation and fresh reload, without rebase', async () => {
  const h = harness(), a = h.client(), b = h.client(2); await edit(a.controller); await edit(b.controller);
  assert.equal(await a.controller.save(), true); assert.equal(await b.controller.save(), false); assert.equal(b.controller.getState().saveStatus, 'retry-required');
  assert.equal(b.controller.updateDraft({ routes: [] }), false); assert.equal(await b.controller.cancelPending(), true); assert.equal(b.controller.getState().loaded, false);
  assert.equal(h.docs.get(`clinics/main/operationIntents/${id(2)}`).status, 'cancelled'); assert.equal(h.docs.has(`clinics/main/settingsOperations/${id(2)}`), false);
  assert.equal(await b.controller.load('prostheticRouting'), true); assert.equal(b.controller.getState().snapshot?.revision, 1);
});
test('cancellation cannot discard an already accepted lost-ACK command and ordinary navigation stays locked', async () => {
  const h = harness(), c = h.client(); await edit(c.controller); h.faults.lostCommit = true; await c.controller.save();
  assert.equal(await c.controller.cancelPending(), false); assert.equal(c.controller.getState().saveStatus, 'retry-required'); assert.equal(c.controller.canClose(), false);
  assert.equal(await c.controller.retry(), true); assert.equal(h.docs.get(CLOUD_PROSTHETIC_ROUTING_PATH).revision, 1);
});
test('actual lease loss clears all memory permanently and rejects late reads even after same session reactivation', async () => {
  const h = harness(), c = h.client(); const gate = deferred<void>(); h.hooks.read = () => gate.promise;
  const loading = c.controller.load(); await Promise.resolve(); await Promise.resolve(); c.deactivate(); assert.equal(c.controller.getState().closed, true);
  gate.resolve(); assert.equal(await loading, false); c.reactivate(); assert.equal(await c.controller.load(), false); assert.equal(c.controller.getState().snapshot, null);
});
test('explicit disposal during accepted commit hides results and never claims server rollback', async () => {
  const h = harness(), c = h.client(); await edit(c.controller);
  const real = h.adapter.runTransaction; h.adapter.runTransaction = async work => { const result = await real(work);
    if (h.docs.has(CLOUD_PROSTHETIC_ROUTING_PATH)) c.controller.dispose(); return result; };
  assert.equal(await c.controller.save(), false); assert.equal(c.controller.getState().closed, true); assert.equal(h.docs.get(CLOUD_PROSTHETIC_ROUTING_PATH).revision, 1);
});
test('first loading ticket prevents reentrant retry or navigation before acknowledged refresh finishes', async () => {
  const h = harness(), c = h.client(); await edit(c.controller); const nested: Promise<boolean>[] = [];
  c.controller.subscribe(state => { if (state.saveStatus === 'refresh-required' && state.loading) nested.push(c.controller.retry(), c.controller.load(), c.controller.loadHistory()); });
  assert.equal(await c.controller.save(), true); assert.deepEqual(await Promise.all(nested), [false, false, false]); assert.equal(c.ids(), 1);
});
test('captured publish transition is delivered consistently even when an earlier subscriber cancels draft synchronously', async () => {
  const h = harness(), c = h.client(); await c.controller.load('prostheticRouting'); const seen: boolean[] = [];
  c.controller.subscribe(state => { if (state.draft) c.controller.cancelDraft(state.draft); }); c.controller.subscribe(state => seen.push(!!state.draft));
  assert.equal(c.controller.beginEdit(), false); assert.deepEqual(seen, [false, true]); assert.equal(c.controller.getState().draft, null);
});
test('lab lists are explicit bounded UUID pages and catalog references are separately loaded with before/after catalog fence', async () => {
  const h = harness(), c = h.client(); h.docs.set(`clinics/main/labDefinitions/${LAB}`, lab()); h.docs.set('clinics/main/settings/serviceCatalog', catalog());
  assert.equal(await c.controller.loadLabs(), true); assert.equal(c.controller.getState().labs[0].data.name, 'معمل مصطنع'); assert.equal(c.controller.getState().catalog, null);
  assert.equal(await c.controller.loadRoutingReferences(), true); assert.equal(c.controller.getState().referencesLoaded, true);
  assert.equal(c.controller.getState().catalog?.data.examinationCents, 10000); assert.equal(h.calls.filter(call => call === 'catalog-get').length, 2);
});
test('missing/changing catalog refuses routing references without fallback while protected lab selection remains independent', async () => {
  const h = harness(), c = h.client(); assert.equal(await c.controller.loadRoutingReferences(), false); assert.equal(c.controller.getState().referencesLoaded, false);
  let reads = 0; h.hooks.getCatalog = async () => ({ ...catalog(), revision: ++reads }); assert.equal(await c.controller.loadRoutingReferences(), false);
  h.docs.set(`clinics/main/labDefinitions/${LAB}`, lab()); assert.equal(await c.controller.load('lab', LAB), true); assert.equal(c.controller.getState().snapshot?.recordId, LAB);
});
test('invalid target paths and stale draft identities do not start reads, writes or replacement commands', async () => {
  const h = harness(), c = h.client(); assert.equal(await c.controller.load('lab', 'bad'), false); assert.deepEqual(h.calls, []);
  await edit(c.controller); const old = c.controller.getState().draft!; c.controller.updateDraft({ routes: [] }, old);
  assert.equal(c.controller.updateDraft({ routes: [] }, old), false); assert.equal(c.controller.cancelDraft(old), false); assert.equal(await c.controller.save(old), false); assert.equal(c.ids(), 0);
});
test('malformed/missing history capability cannot fall back to prepared-only queue or execute records automatically', async () => {
  const h = harness(), c = h.client(); const capability = h.capability(); (capability.journal as any).listHistoryPage = undefined;
  let fallback = 0; capability.journal.listPreparedPage = async () => { fallback++; return { records: [], nextAfterId: null }; };
  h.hooks.capability = async () => capability; assert.equal(await c.controller.loadHistory(), false); assert.equal(fallback, 0); assert.equal(h.docs.size, 0);
});
test('history refuses a valid generic settings intent with invalid full domain body before resume/cancel mutation', async () => {
  const h = harness(), capability = h.capability(), c = h.client(); const command: CloudClinicSettingsCommand = { target: 'prostheticRouting', recordId: 'prostheticRouting',
    operationId: id(1), expectedRevision: 0, createdAt: WHEN, data: { routes: [] } };
  await capability.journal.prepare('settings', prepareCloudClinicSettingsCommand(command), WHEN); const raw = h.docs.get(`clinics/main/operationIntents/${id(1)}`);
  raw.command.data.routes.push({ serviceId: 'bad', labId: LAB, materialId: MATERIAL });
  assert.equal(await c.controller.loadHistory(), false); assert.equal(await c.controller.resume(id(1)), false); assert.equal(h.docs.has(CLOUD_PROSTHETIC_ROUTING_PATH), false);
});
