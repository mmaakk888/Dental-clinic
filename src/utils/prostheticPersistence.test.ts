import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import type { Lab, Patient, User } from '../types';
import { Storage, PROSTHETIC_ROUTING_STORAGE_KEY, type ClinicDomainData } from './storage';
import { cloneProstheticRouting, validateProstheticRouting, type ProstheticRoutingSettings } from './prostheticRouting';
import { createProstheticOrder, validateProstheticOrder, type ProstheticOrderInput } from './prostheticWorkflow';
import { canonicalFileNumber, savePatientRecord } from './clinicMutations';
import { getNextPatientFileNo } from './patientRegistration';

// Run the real App boundaries, not App hydration or a browser. Every read/write
// below targets an isolated in-memory adapter populated with invented records.
const source = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const callbacks = new Map<string, ts.Expression>();
const visit = (node: ts.Node) => {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) callbacks.set(node.name.text, node.initializer);
  ts.forEachChild(node, visit);
};
visit(parsed);
function appCallback(name: string, dependencies: Record<string, unknown>): any {
  const expression = callbacks.get(name); assert.ok(expression, `${name} exists in App`);
  const executable = ts.transpileModule(`return (${expression.getText(parsed)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function(...Object.keys(dependencies), executable)(...Object.values(dependencies));
}
const patient = (id = '401'): Patient => ({ id, name: `ملف اختبار مصطنع ${id}`, mobile: '01000000000', age: 30,
  firstVisit: '2026-10-10', notes: '', allergy: '', sessions: [], payments: [] });
const labs: Lab[] = [{ id: 'synthetic-lab', name: 'معمل اختبار مصطنع', services: [
  { id: 'synthetic-zircon', name: 'زيركون', category: 'fixed', unitLabel: 'وحدة', price: 300 },
] }];
const routing = (): ProstheticRoutingSettings => ({ defaultLabs: { fixed: labs[0].id }, overrides: [] });
const order = (changes: Partial<ProstheticOrderInput> = {}): ProstheticOrderInput => ({
  operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', patientId: '401', kind: 'fixed', material: 'زيركون',
  units: 3, teethIds: ['ur1', 'ur2', 'ur3'], date: '2026-10-10', expectedUnitPrice: 1500, examinationFee: 0, paid: 0, ...changes,
});
const domainKeys: Record<keyof ClinicDomainData, string> = { patients: 'dental_patients_v2', contacts: 'dental_contacts',
  appointments: 'dental_appointments_v2', labCases: 'dental_lab_cases_v2', expenses: 'dental_expenses_v2', materialUsages: 'dental_material_usages_v1' };

async function withHarness(run: (h: ReturnType<typeof harness>) => Promise<void>) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const h = harness();
  try { await run(h); }
  finally { if (original) Object.defineProperty(globalThis, 'localStorage', original); else Reflect.deleteProperty(globalThis, 'localStorage'); }
}
function harness() {
  const values = new Map<string, string>(), events: string[] = [], actions: string[] = [];
  let locked = false, queue = Promise.resolve(), beforeNextLock: (() => void) | undefined;
  let failKey: string | undefined, failureUsed = false, denyAction: string | undefined, denyOwnerCheck = 0, ownerChecks = 0;
  let role: User['role'] = 'doctor', present = true;
  const seed = (key: string, value: unknown) => values.set(key, JSON.stringify(value));
  for (const [field, key] of Object.entries(domainKeys)) seed(key, field === 'patients' ? [patient()] : []);
  seed('dental_labs_v2', labs); seed(PROSTHETIC_ROUTING_STORAGE_KEY, routing());
  seed('dental_service_types_v2', ['حشو', 'تركيبات - ثابتة', 'تركيبات - متحركة']);
  seed('dental_crown_prices_v2', { 'زيركون': 1500 }); seed('dental_clinical_prices_v1', { 'حشو': 500 });
  seed('dental_examination_fee_v1', 100); seed('dental_privacy_mode_v2', false);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      events.push(`write:${key}`);
      if (key === failKey && !failureUsed) { failureUsed = true; throw new Error('synthetic-quota'); }
      values.set(key, value);
    }, removeItem: (key: string) => values.delete(key),
  } });
  const underLock = <T>(name: string, read: () => T): T => { assert.equal(locked, true, `${name} executes under lock`); events.push(name); return read(); };
  const runtimeStorage = { ...Storage,
    getDomainData: () => underLock('read:domain', Storage.getDomainData),
    getLabsFresh: () => underLock('read:labs', Storage.getLabsFresh),
    getServiceCatalog: () => underLock('read:catalog', Storage.getServiceCatalog),
    getProstheticRouting: () => underLock('read:routing', Storage.getProstheticRouting),
    saveDomainDataConfirmed: (next: ClinicDomainData, previous: ClinicDomainData) => {
      underLock('confirm:domain', () => Storage.saveDomainDataConfirmed(next, previous)); events.push('confirmed:domain');
    },
    saveProstheticRouting: (next: ProstheticRoutingSettings) => {
      underLock('confirm:routing', () => Storage.saveProstheticRouting(next)); events.push('confirmed:routing');
    },
  };
  const dependencies: Record<string, unknown> = {
    Storage: runtimeStorage, currentUser: { id: 'synthetic-owner', role: 'doctor' },
    withClinicWriteLock: (operation: () => void | Promise<void>) => {
      const result = queue.then(async () => {
        const pending = beforeNextLock; beforeNextLock = undefined; pending?.();
        locked = true; events.push('lock');
        try { return await operation(); } finally { locked = false; events.push('unlock'); }
      });
      queue = result.then(() => undefined, () => undefined); return result;
    },
    requireFreshSettingsPermission: (action: string) => {
      assert.equal(locked, true); actions.push(action); events.push(`authorize:${action}`);
      if (action === denyAction || (action === 'access_control_panel' && ++ownerChecks === denyOwnerCheck)) throw new Error('synthetic-access-revoked');
      return present ? [{ id: 'synthetic-owner', role }] : [];
    },
    publishDomain: () => events.push('publish:domain'),
    setProstheticRouting: () => events.push('publish:routing'),
    cloneProstheticRouting, validateProstheticRouting, validateProstheticOrder, createProstheticOrder,
    canonicalFileNumber, savePatientRecord, getNextPatientFileNo,
  };
  dependencies.commitDomain = appCallback('commitDomain', dependencies);
  return {
    saveOrder: appCallback('handleSaveProstheticOrder', dependencies),
    saveRouting: appCallback('handleSaveProstheticRouting', dependencies),
    savePatient: appCallback('handleSavePatient', dependencies),
    current: () => Storage.getDomainData(), currentRouting: () => Storage.getProstheticRouting(), events, actions, seed,
    snapshot: () => new Map(values),
    beforeLock: (operation: () => void) => { beforeNextLock = operation; },
    failWrite: (key: string) => { failKey = key; failureUsed = false; },
    deny: (action: string) => { denyAction = action; },
    denySecondOwnerCheck: () => { denyOwnerCheck = 2; },
    role: (value: User['role']) => { role = value; },
    removeOwner: () => { present = false; },
  };
}

test('actual prosthetic boundary reads fresh catalogs under the clinic lock and publishes only after a coupled confirmed write', async () => withHarness(async h => {
  await h.saveOrder(order());
  assert.deepEqual(h.actions, ['view_patients', 'add_session']);
  const data = h.current(), session = data.patients[0].sessions[0], item = data.labCases[0];
  assert.equal(session.amount, 4500); assert.equal(session.paid, 0); assert.equal(session.paymentsLog.length, 0);
  assert.equal(item.linkedSessionId, session.id); assert.equal(item.labTotal, 900); assert.equal(item.labPaid, 0);
  assert.deepEqual(data.expenses, []);
  for (const read of ['read:domain', 'read:routing', 'read:labs', 'read:catalog']) assert.ok(h.events.includes(read));
  assert.ok(h.events.indexOf('confirmed:domain') < h.events.indexOf('publish:domain'));
  assert.equal(h.actions.includes('view_lab_costs'), false, 'clinical registration does not grant supplier-price access');
}));

test('actual paid order records one cash receipt and same-ID retry performs no storage writes after settings change', async () => withHarness(async h => {
  const input = order({ paid: 500, examinationFee: 100 }); await h.saveOrder(input);
  assert.deepEqual(h.actions, ['view_patients', 'add_session', 'register_payment']);
  h.seed('dental_crown_prices_v2', { 'زيركون': 3000 }); h.seed(PROSTHETIC_ROUTING_STORAGE_KEY, { defaultLabs: {}, overrides: [] });
  const before = h.snapshot(), writes = h.events.filter(event => event.startsWith('write:')).length;
  await h.saveOrder(input);
  assert.deepEqual(h.snapshot(), before); assert.equal(h.events.filter(event => event.startsWith('write:')).length, writes);
  assert.equal(h.current().patients[0].sessions.length, 1); assert.equal(h.current().labCases.length, 1);
  assert.equal(h.current().patients[0].sessions[0].paymentsLog.length, 1);
}));

test('settings changed while waiting for the lock are used, and stale patient prices reject the entire new order', async () => withHarness(async h => {
  h.beforeLock(() => h.seed('dental_labs_v2', [{ ...labs[0], services: [{ ...labs[0].services[0], price: 425 }] }]));
  await h.saveOrder(order()); assert.equal(h.current().labCases[0].labTotal, 1275);
  h.seed('dental_crown_prices_v2', { 'زيركون': 1600 }); const before = h.snapshot();
  await assert.rejects(h.saveOrder(order({ operationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' })), /السعر/);
  assert.deepEqual(h.snapshot(), before); assert.equal(h.current().patients[0].sessions.length, 1);
}));

test('fresh authorization revocation while queued rejects before any domain read or write', async () => withHarness(async h => {
  h.beforeLock(() => h.deny('add_session'));
  await assert.rejects(h.saveOrder(order()), /synthetic-access-revoked/);
  assert.equal(h.events.includes('read:domain'), false); assert.equal(h.events.includes('publish:domain'), false);
  assert.equal(h.events.some(event => event.startsWith('write:')), false);
}));

test('failure writing the coupled lab case restores the already-written clinical record and never publishes success', async () => withHarness(async h => {
  const before = h.snapshot(); h.failWrite(domainKeys.labCases);
  await assert.rejects(h.saveOrder(order({ paid: 500 })), /لم تُحفظ/);
  assert.deepEqual(h.snapshot(), before); assert.equal(h.current().patients[0].sessions.length, 0); assert.equal(h.current().labCases.length, 0);
  assert.equal(h.events.includes('publish:domain'), false); assert.equal(h.events.includes('confirmed:domain'), false);
}));

test('routing save validates fresh supplier/material references and reauthorizes before confirmed persistence', async () => withHarness(async h => {
  const next: ProstheticRoutingSettings = { ...routing(), overrides: [{ kind: 'fixed', material: 'زيركون', labId: labs[0].id, labServiceId: labs[0].services[0].id }] };
  await h.saveRouting(next, routing()); assert.deepEqual(h.currentRouting(), next);
  assert.deepEqual(h.actions, ['access_control_panel', 'manage_prices', 'manage_lab', 'view_lab_costs', 'access_control_panel', 'manage_prices', 'manage_lab', 'view_lab_costs']);
  assert.ok(h.events.indexOf('confirmed:routing') < h.events.indexOf('publish:routing'));
}));

test('routing editing denies a fresh secretary, missing owner and privacy mode even when the opening account was a doctor', async () => {
  for (const restriction of ['secretary', 'missing', 'privacy'] as const) await withHarness(async h => {
    h.beforeLock(() => {
      if (restriction === 'secretary') h.role('secretary');
      if (restriction === 'missing') h.removeOwner();
      if (restriction === 'privacy') h.seed('dental_privacy_mode_v2', true);
    });
    await assert.rejects(h.saveRouting(routing(), routing()), /خاص بالطبيب/);
    assert.equal(h.events.some(event => event.startsWith('write:')), false); assert.equal(h.events.includes('publish:routing'), false);
  });
});

test('routing rejects stale baselines without replacing persisted settings and refreshes the visible baseline only', async () => withHarness(async h => {
  const latest: ProstheticRoutingSettings = { defaultLabs: {}, overrides: [] }; h.seed(PROSTHETIC_ROUTING_STORAGE_KEY, latest);
  await assert.rejects(h.saveRouting(routing(), routing()), /تبويب آخر/);
  assert.deepEqual(h.currentRouting(), latest); assert.equal(h.events.some(event => event.startsWith('write:')), false);
  assert.equal(h.events.filter(event => event === 'publish:routing').length, 1);
}));

test('routing rejects deleted supplier services, removed patient materials and authorization lost before write', async () => {
  for (const failure of ['service', 'material', 'authorization'] as const) await withHarness(async h => {
    const next: ProstheticRoutingSettings = { defaultLabs: {}, overrides: [{ kind: 'fixed', material: 'زيركون', labId: labs[0].id, labServiceId: labs[0].services[0].id }] };
    if (failure === 'service') h.seed('dental_labs_v2', [{ ...labs[0], services: [] }]);
    if (failure === 'material') h.seed('dental_crown_prices_v2', {});
    if (failure === 'authorization') h.denySecondOwnerCheck();
    const before = h.snapshot(); await assert.rejects(h.saveRouting(next, routing()));
    assert.deepEqual(h.snapshot(), before); assert.equal(h.events.includes('publish:routing'), false);
  });
});

test('routing storage failure preserves the prior configuration and does not publish the new draft', async () => withHarness(async h => {
  h.failWrite(PROSTHETIC_ROUTING_STORAGE_KEY); const before = h.snapshot();
  await assert.rejects(h.saveRouting({ defaultLabs: {}, overrides: [] }, routing()), /لم تُحفظ/);
  assert.deepEqual(h.snapshot(), before); assert.equal(h.events.includes('publish:routing'), false);
}));

test('concurrent patient creation ignores stale suggested IDs and returns sequential numbers from fresh Arabic/numeric IDs', async () => withHarness(async h => {
  h.seed(domainKeys.patients, [patient('٤٠٤'), patient('00099'), patient('legacy-file')]);
  const first = patient('402'), second = { ...patient('402'), name: 'ملف مصطنع آخر' };
  const saved = await Promise.all([h.savePatient(first), h.savePatient(second)]);
  assert.deepEqual(saved, ['405', '406']); assert.deepEqual(h.current().patients.map(record => record.id), ['406', '405', '٤٠٤', '00099', 'legacy-file']);
}));

test('patient edit preserves a stored Arabic ID and returns that actual ID for opening the saved file', async () => withHarness(async h => {
  const baseline = patient('٤٠١'); h.seed(domainKeys.patients, [baseline]);
  const saved = await h.savePatient({ ...baseline, id: '401', name: 'اسم مصطنع بعد تعديل' }, '401', baseline);
  assert.equal(h.current().patients[0].id, '٤٠١'); assert.equal(saved, '٤٠١');
}));

test('patient creation failure never returns a saved ID or publishes an unpersisted file', async () => withHarness(async h => {
  const before = h.snapshot(); h.failWrite(domainKeys.patients);
  await assert.rejects(h.savePatient(patient('402')), /لم تُحفظ/); assert.deepEqual(h.snapshot(), before);
  assert.equal(h.events.includes('publish:domain'), false);
}));
