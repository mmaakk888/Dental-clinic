import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudOperatingAuthSession, type CloudOperatingAuthAdapter, type CloudServiceCatalogCapability } from './cloudOperatingAuth';
import { createCloudOperatingPageController, type CloudOperatingPageSession } from './cloudOperatingPageController';
import { CloudServiceCatalogError } from './cloudServiceCatalogRepository';
import type { CloudContactRepository } from './cloudContactRepository';
import type { CloudPatientRepository } from './cloudPatientRepository';
import type { CloudClinicalCapability } from './cloudClinicalWorkspaceController';

// Synthetic Auth lifecycle + actual pure workspace controllers. No SDK, live
// user, patient/account data, browser storage, Rules or Hosting is exercised.
const EMAIL = 'catalog-page@example.invalid', PASSWORD = 'synthetic-catalog-page-password';
const AUTH_TIME = 1_700_000_000, PATIENT = '10000000-0000-4000-8000-000000000001';
const OP = '20000000-0000-4000-8000-000000000001';
function record(): Awaited<ReturnType<CloudOperatingAuthAdapter['readOwner']>> {
  return { identity: { uid: 'synthetic-catalog-owner', email: EMAIL, status: 'owner-confirmed' },
    membership: { schemaVersion: 1, clinicId: 'main', uid: 'synthetic-catalog-owner', role: 'owner',
      status: 'active', identityVersion: 1, verifiedAfter: AUTH_TIME }, authTime: AUTH_TIME };
}
function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, decline) => { resolve = accept; reject = decline; }); return { promise, resolve, reject };
}
function fixture(options: {
  adapter?: Partial<CloudOperatingAuthAdapter>;
  factory?: (session: CloudOperatingPageSession) => Promise<CloudOperatingPageSession>;
  runtime?: () => boolean;
  getServiceCatalog?: () => Promise<CloudServiceCatalogCapability>;
  getContacts?: () => Promise<CloudContactRepository>;
  getPatients?: () => Promise<CloudPatientRepository>;
  getClinical?: () => Promise<CloudClinicalCapability>;
} = {}) {
  const calls: string[] = []; let runtime = true;
  const session = createCloudOperatingAuthSession({
    signIn: async (email, password) => { calls.push('signIn'); await options.adapter?.signIn?.(email, password); },
    readOwner: async () => { calls.push('readOwner'); return options.adapter?.readOwner ? options.adapter.readOwner() : record(); },
    signOut: async () => { calls.push('signOut'); await options.adapter?.signOut?.(); },
    destroy: async () => { calls.push('destroy'); await options.adapter?.destroy?.(); },
  });
  const controller = createCloudOperatingPageController(async () => {
    calls.push('factory');
    const candidate: CloudOperatingPageSession = { ...session,
      ...(options.getServiceCatalog ? { getServiceCatalog: async () => { calls.push('getServiceCatalog'); return options.getServiceCatalog!(); } } : {}),
      ...(options.getContacts ? { getContacts: async () => { calls.push('getContacts'); return options.getContacts!(); } } : {}),
      ...(options.getPatients ? { getPatients: async () => { calls.push('getPatients'); return options.getPatients!(); } } : {}),
      ...(options.getClinical ? { getClinical: async () => { calls.push('getClinical'); return options.getClinical!(); } } : {}),
    };
    return options.factory ? options.factory(candidate) : candidate;
  }, options.runtime ?? (() => runtime));
  return { controller, session, calls, setRuntime: (value: boolean) => { runtime = value; } };
}
function catalogCapability() {
  const calls: string[] = [], hooks: { read?: () => Promise<void> } = {};
  const capability: CloudServiceCatalogCapability = {
    repository: {
      get: async () => { calls.push('get'); await hooks.read?.(); return null; },
      commit: async () => { calls.push('commit'); throw new CloudServiceCatalogError('unavailable'); },
    },
    journal: {
      prepare: async () => { calls.push('prepare'); throw new Error('SYNTHETIC_PRIVATE_CATALOG_PROVIDER'); },
      get: async () => { calls.push('intent'); await hooks.read?.(); return null; },
      cancel: async () => { calls.push('cancel'); throw new Error('SYNTHETIC_PRIVATE_CATALOG_PROVIDER'); },
      listPreparedPage: async () => { calls.push('prepared'); await hooks.read?.(); return { records: [], nextAfterId: null }; },
      listHistoryPage: async () => { calls.push('history'); await hooks.read?.(); return { records: [], nextAfterId: null }; },
    },
  };
  return { capability, calls, hooks };
}
function otherCapabilities() {
  const calls: string[] = [];
  const contacts: CloudContactRepository = {
    commit: async () => { calls.push('contact-commit'); throw new Error('synthetic'); },
    get: async () => { calls.push('contact-get'); return null; },
    listPage: async () => { calls.push('contact-list'); return { records: [], nextAfterId: null }; },
  };
  const patients: CloudPatientRepository = {
    commit: async () => { calls.push('patient-commit'); throw new Error('synthetic'); },
    get: async () => { calls.push('patient-get'); return null; },
    getByFileNo: async () => { calls.push('patient-file'); return null; },
    findByPhone: async () => { calls.push('patient-phone'); return { records: [], nextAfterId: null }; },
    listPage: async () => { calls.push('patient-list'); return { records: [], nextAfterId: null }; },
  };
  const clinical: CloudClinicalCapability = {
    repository: {
      getProfile: async () => { calls.push('clinical-profile'); return {
        schemaVersion: 1, clinicId: 'main', recordId: PATIENT, fileNo: 451, revision: 1, lastOperationId: OP, phoneKey: null,
        data: { name: 'ملف مصطنع', mobile: '', age: 30, gender: '', firstVisit: '2026-10-11', notes: '', allergy: '' },
      }; },
      getAccount: async () => { calls.push('clinical-account'); return null; },
      getSession: async () => { calls.push('clinical-session'); return null; },
      listSessions: async () => { calls.push('clinical-sessions'); return { records: [], nextAfterId: null }; },
      listReceipts: async () => { calls.push('clinical-receipts'); return { records: [], nextAfterId: null }; },
      commit: async () => { calls.push('clinical-commit'); throw new Error('synthetic'); },
    },
    journal: {
      prepare: async () => { throw new Error('synthetic'); }, get: async () => null, cancel: async () => { throw new Error('synthetic'); },
      listPreparedPage: async () => ({ records: [], nextAfterId: null }), listHistoryPage: async () => ({ records: [], nextAfterId: null }),
    },
  };
  return { contacts, patients, clinical, calls };
}

function pricedCatalog() {
  return { schemaVersion: 1 as const, clinicId: 'main' as const, recordId: 'serviceCatalog' as const,
    revision: 1, lastOperationId: OP, data: { examinationCents: 10000,
      services: [{ serviceId: OP, name: 'خدمة مصطنعة', kind: 'clinical' as const, priceCents: 25000, active: true }] } };
}

test('clinical bundle acquires catalog only on explicit visit begin and locks all workspace switches until cancelled', async () => {
  const domains = otherCapabilities(), catalog = catalogCapability();
  catalog.capability.repository.get = async () => { catalog.calls.push('get'); return pricedCatalog(); };
  const h = fixture({ getClinical: async () => domains.clinical, getServiceCatalog: async () => catalog.capability,
    getContacts: async () => domains.contacts, getPatients: async () => domains.patients });
  await h.controller.signIn(EMAIL, PASSWORD); const bundle = await h.controller.openClinical(); assert.ok(bundle?.visit);
  assert.equal(h.calls.includes('getServiceCatalog'), false); assert.deepEqual(domains.calls, []); assert.deepEqual(catalog.calls, []);
  assert.equal(await bundle.file.open(PATIENT), true); const snapshot = bundle.file.getState().snapshot!;
  assert.equal(await bundle.visit.begin(snapshot), true); assert.deepEqual(catalog.calls, ['get']);
  assert.equal(bundle.file.getState().draftDirty, true); assert.equal(bundle.visit.chooseService(OP), true);
  assert.equal(bundle.visit.getState().draft?.services.length, 1);
  assert.equal(h.controller.closeClinical(bundle), false); assert.equal(await h.controller.openContacts(), null);
  assert.equal(await h.controller.openPatients(), null); assert.equal(await h.controller.openCatalog(), null);
  assert.equal(bundle.visit.cancel(), true); assert.equal(bundle.file.getState().draftDirty, false);
  assert.equal(h.controller.closeClinical(bundle), true); assert.equal(bundle.visit.getState().closed, true);
  await h.controller.dispose();
});

test('late catalog capability after logout cannot read pricing or resurrect visit draft', async () => {
  const gate = deferred<CloudServiceCatalogCapability>(), domains = otherCapabilities(), catalog = catalogCapability();
  const h = fixture({ getClinical: async () => domains.clinical, getServiceCatalog: () => gate.promise });
  await h.controller.signIn(EMAIL, PASSWORD); const bundle = (await h.controller.openClinical())!;
  await bundle.file.open(PATIENT); const pending = bundle.visit!.begin(bundle.file.getState().snapshot!);
  assert.equal(bundle.visit!.getState().phase, 'loading'); const ending = h.controller.signOut();
  assert.equal(bundle.visit!.getState().closed, true); assert.equal(bundle.file.getState().snapshot, null);
  gate.resolve(catalog.capability); assert.equal(await pending, false); await ending;
  assert.deepEqual(catalog.calls, []); assert.equal(bundle.visit!.getState().draft, null); await h.controller.dispose();
});

test('temporary owner checking preserves captured visit and does not fetch the catalog again', async () => {
  const domains = otherCapabilities(), catalog = catalogCapability(); let ownerGate: ReturnType<typeof deferred<Awaited<ReturnType<CloudOperatingAuthAdapter['readOwner']>>>> | null = null;
  catalog.capability.repository.get = async () => { catalog.calls.push('get'); return pricedCatalog(); };
  const h = fixture({ adapter: { readOwner: () => ownerGate ? ownerGate.promise : Promise.resolve(record()) },
    getClinical: async () => domains.clinical, getServiceCatalog: async () => catalog.capability });
  await h.controller.signIn(EMAIL, PASSWORD); const bundle = (await h.controller.openClinical())!; await bundle.file.open(PATIENT);
  assert.equal(await bundle.visit!.begin(bundle.file.getState().snapshot!), true); assert.equal(bundle.visit!.chooseService(OP), true);
  const draft = bundle.visit!.getState().draft; ownerGate = deferred(); const refresh = h.controller.refresh();
  assert.equal(h.controller.getState().auth.phase, 'checking'); assert.equal(bundle.visit!.getState().draft, draft);
  assert.equal(h.controller.getClinicalWorkspace(), bundle); ownerGate.resolve(record()); await refresh;
  assert.equal(bundle.visit!.getState().draft, draft); assert.deepEqual(catalog.calls, ['get']);
  assert.equal(bundle.visit!.cancel(), true); await h.controller.dispose();
});

test('missing catalog capability or record releases only its own draft lock, with no local fallback or write', async () => {
  for (const missing of ['capability', 'record']) {
    const domains = otherCapabilities(), catalog = catalogCapability();
    const h = fixture({ getClinical: async () => domains.clinical,
      ...(missing === 'record' ? { getServiceCatalog: async () => catalog.capability } : {}) });
    await h.controller.signIn(EMAIL, PASSWORD); const bundle = (await h.controller.openClinical())!; await bundle.file.open(PATIENT);
    assert.equal(await bundle.visit!.begin(bundle.file.getState().snapshot!), false);
    assert.equal(bundle.file.getState().draftDirty, false); assert.equal(bundle.visit!.getState().phase, 'idle');
    assert.equal(bundle.visit!.getState().catalog, null); assert.equal(bundle.visit!.getState().draft, null);
    assert.equal(domains.calls.includes('clinical-commit'), false); assert.equal(catalog.calls.includes('commit'), false);
    assert.equal(h.controller.closeClinical(bundle), true); await h.controller.dispose();
  }
});

test('catalog seam is inert before explicit checked-owner open and absent capability never initializes data', async () => {
  const h = fixture(); assert.equal(Object.isFrozen(h.controller.getState().catalog), true);
  assert.equal(h.controller.getCatalogWorkspace(), null); assert.equal(await h.controller.openCatalog(), null); assert.deepEqual(h.calls, []);
  await h.controller.signIn(EMAIL, PASSWORD); assert.equal(await h.controller.openCatalog(), null);
  assert.ok(h.controller.getState().catalog.error); assert.equal(h.controller.getState().auth.phase, 'owner-checked');
  assert.equal(h.calls.includes('destroy'), false); await h.controller.dispose();
});

test('catalog opening shares one lazy acquisition and never reads current prices or history until explicit actions', async () => {
  const cap = catalogCapability(), gate = deferred<CloudServiceCatalogCapability>(), started = deferred();
  const h = fixture({ getServiceCatalog: async () => { started.resolve(); return gate.promise; } });
  await h.controller.signIn(EMAIL, PASSWORD); assert.equal(h.calls.includes('getServiceCatalog'), false);
  const opening = h.controller.openCatalog(); assert.equal(opening, h.controller.openCatalog());
  assert.equal(h.controller.getState().catalog.phase, 'opening'); await started.promise; gate.resolve(cap.capability);
  const workspace = await opening; assert.ok(workspace); assert.equal(workspace, h.controller.getCatalogWorkspace());
  assert.equal(workspace, await h.controller.openCatalog()); assert.deepEqual(cap.calls, []);
  assert.equal(workspace.getState().snapshot, null); assert.equal(workspace.getState().loaded, false); assert.equal(workspace.getState().historyLoaded, false);
  assert.equal(await workspace.load(), true); assert.deepEqual(cap.calls, ['get']);
  assert.equal(workspace.getState().loaded, true); assert.equal(workspace.getState().snapshot, null);
  await workspace.loadHistory(); assert.deepEqual(cap.calls, ['get', 'history']);
  assert.equal(h.controller.closeCatalog(workspace), true); assert.equal(workspace.getState().closed, true); await h.controller.dispose();
});

test('catalog delayed acquisition is revoked on close, logout, disposal, identity and runtime loss', async () => {
  for (const mode of ['close', 'signOut', 'dispose', 'identity', 'runtime'] as const) {
    const cap = catalogCapability(), gate = deferred<CloudServiceCatalogCapability>(), started = deferred();
    const h = fixture({ getServiceCatalog: async () => { started.resolve(); return gate.promise; } }); await h.controller.signIn(EMAIL, PASSWORD);
    const opening = h.controller.openCatalog(); await started.promise; let cleanup: Promise<unknown> = Promise.resolve();
    if (mode === 'close') assert.equal(h.controller.closeCatalog(), true);
    else if (mode === 'signOut') cleanup = h.controller.signOut();
    else if (mode === 'dispose') cleanup = h.controller.dispose();
    else if (mode === 'identity') h.session.invalidate();
    else { h.setRuntime(false); h.controller.getState(); }
    gate.resolve(cap.capability); assert.equal(await opening, null); await cleanup;
    assert.equal(h.controller.getCatalogWorkspace(), null); assert.equal(h.controller.getState().catalog.phase, 'closed');
    assert.deepEqual(cap.calls, []); await h.controller.dispose();
  }
});

test('immediate catalog close prevents acquisition and an old expected close cannot revoke a fresh workspace', async () => {
  const cap = catalogCapability(), h = fixture({ getServiceCatalog: async () => cap.capability }); await h.controller.signIn(EMAIL, PASSWORD);
  const opening = h.controller.openCatalog(); assert.equal(h.controller.closeCatalog(), true); assert.equal(await opening, null);
  assert.equal(h.calls.includes('getServiceCatalog'), false);
  const old = await h.controller.openCatalog(); assert.ok(old); assert.equal(h.controller.closeCatalog(old), true);
  const fresh = await h.controller.openCatalog(); assert.ok(fresh); assert.notEqual(old, fresh);
  assert.equal(h.controller.closeCatalog(old), false); assert.equal(h.controller.getCatalogWorkspace(), fresh);
  assert.equal(fresh.getState().closed, false); await h.controller.dispose();
});

test('checking preserves the exact catalog lease/draft; unresolved saves block close and logout clears memory synchronously', async () => {
  const gate = deferred<ReturnType<typeof record>>(), started = deferred(); let delay = false; const cap = catalogCapability();
  const h = fixture({ getServiceCatalog: async () => cap.capability,
    adapter: { readOwner: async () => { if (delay) { started.resolve(); return gate.promise; } return record(); } } });
  await h.controller.signIn(EMAIL, PASSWORD); const workspace = await h.controller.openCatalog(); assert.ok(workspace);
  await workspace.load(); assert.equal(workspace.beginEdit(), true);
  assert.equal(workspace.updateDraft({ examinationCents: 10000, services: [] }), true); const draft = workspace.getState().draft;
  delay = true; const checking = h.controller.refresh(); await started.promise;
  assert.equal(h.controller.getState().auth.phase, 'checking'); assert.equal(h.controller.getCatalogWorkspace(), workspace);
  assert.equal(workspace.getState().draft, draft); gate.resolve(record()); await checking;
  assert.equal(h.controller.closeCatalog(workspace), false); assert.equal(await workspace.save(), false);
  assert.equal(workspace.getState().saveStatus, 'retry-required'); assert.ok(workspace.getState().pendingOperationId);
  assert.equal(h.controller.closeCatalog(workspace), false); assert.equal(workspace.cancelDraft(), false);
  const logout = h.controller.signOut(); assert.equal(workspace.getState().closed, true); assert.equal(workspace.getState().snapshot, null);
  assert.equal(workspace.getState().draft, null); assert.deepEqual(workspace.getState().history, []);
  assert.equal(h.controller.getCatalogWorkspace(), null); await logout; await h.controller.dispose();
});

test('catalog document or history reads block all ordinary closes/switches; logout abandons late results without publishing', async () => {
  for (const domain of ['load', 'history'] as const) {
    const cap = catalogCapability(), other = otherCapabilities(), gate = deferred(), started = deferred();
    const h = fixture({ getServiceCatalog: async () => cap.capability, getContacts: async () => other.contacts,
      getPatients: async () => other.patients, getClinical: async () => other.clinical }); await h.controller.signIn(EMAIL, PASSWORD);
    const workspace = await h.controller.openCatalog(); assert.ok(workspace);
    cap.hooks.read = async () => { started.resolve(); await gate.promise; };
    const loading = domain === 'load' ? workspace.load() : workspace.loadHistory(); await started.promise;
    assert.equal(h.controller.closeCatalog(workspace), false);
    assert.equal(await h.controller.openContacts(), null); assert.equal(await h.controller.openPatients(), null); assert.equal(await h.controller.openClinical(), null);
    for (const method of ['getContacts', 'getPatients', 'getClinical']) assert.equal(h.calls.includes(method), false);
    const logout = h.controller.signOut(); assert.equal(workspace.getState().closed, true); gate.resolve(); await loading; await logout;
    assert.equal(workspace.getState().snapshot, null); assert.deepEqual(workspace.getState().history, []); await h.controller.dispose();
  }
});

test('all four workspace switches preserve ordinary drafts and clean switches revoke outgoing catalog/clinical/contact/patient leases', async () => {
  const cap = catalogCapability(), other = otherCapabilities();
  const h = fixture({ getServiceCatalog: async () => cap.capability, getContacts: async () => other.contacts,
    getPatients: async () => other.patients, getClinical: async () => other.clinical }); await h.controller.signIn(EMAIL, PASSWORD);
  const contact = await h.controller.openContacts(); assert.ok(contact); contact.beginCreate();
  assert.equal(await h.controller.openCatalog(), null); assert.equal(h.calls.includes('getServiceCatalog'), false); contact.cancelDraft();
  const patient = await h.controller.openPatients(); assert.ok(patient); patient.beginCreate(); assert.equal(await h.controller.openCatalog(), null); patient.cancelDraft();
  const clinical = await h.controller.openClinical(); assert.ok(clinical); await clinical.file.open(PATIENT); clinical.file.setDraftDirty(PATIENT, true);
  assert.equal(await h.controller.openCatalog(), null); clinical.file.setDraftDirty(PATIENT, false);
  const catalog = await h.controller.openCatalog(); assert.ok(catalog); assert.equal(clinical.file.getState().closed, true); assert.equal(clinical.recovery.getState().closed, true);
  assert.equal(contact.getState().closed, true); assert.equal(patient.getState().closed, true); await catalog.load(); catalog.beginEdit();
  assert.equal(await h.controller.openContacts(), null); assert.equal(await h.controller.openPatients(), null); assert.equal(await h.controller.openClinical(), null);
  catalog.cancelDraft(); const freshClinical = await h.controller.openClinical(); assert.ok(freshClinical); assert.equal(catalog.getState().closed, true);
  assert.equal(h.controller.getCatalogWorkspace(), null); await h.controller.dispose();
});

test('switching away from pending catalog acquisition cancels ownership and late capability cannot replace any newer workspace', async () => {
  for (const target of ['contacts', 'patients', 'clinical'] as const) {
    const cap = catalogCapability(), other = otherCapabilities(), gate = deferred<CloudServiceCatalogCapability>(), started = deferred();
    const h = fixture({ getServiceCatalog: async () => { started.resolve(); return gate.promise; }, getContacts: async () => other.contacts,
      getPatients: async () => other.patients, getClinical: async () => other.clinical }); await h.controller.signIn(EMAIL, PASSWORD);
    const opening = h.controller.openCatalog(); await started.promise;
    const fresh = target === 'contacts' ? await h.controller.openContacts() : target === 'patients' ? await h.controller.openPatients() : await h.controller.openClinical();
    assert.ok(fresh); gate.resolve(cap.capability); assert.equal(await opening, null); assert.equal(h.controller.getCatalogWorkspace(), null);
    assert.equal(h.controller.getState()[target === 'clinical' ? 'clinical' : target].phase, 'open'); assert.deepEqual(cap.calls, []); await h.controller.dispose();
  }
});

test('catalog opening cancels a pending acquisition in any other domain without accepting that late outgoing result', async () => {
  for (const source of ['contacts', 'patients', 'clinical'] as const) {
    const cap = catalogCapability(), other = otherCapabilities(), gate = deferred<any>(), started = deferred();
    const h = fixture({ getServiceCatalog: async () => cap.capability,
      getContacts: async () => { if (source === 'contacts') { started.resolve(); return gate.promise; } return other.contacts; },
      getPatients: async () => { if (source === 'patients') { started.resolve(); return gate.promise; } return other.patients; },
      getClinical: async () => { if (source === 'clinical') { started.resolve(); return gate.promise; } return other.clinical; } }); await h.controller.signIn(EMAIL, PASSWORD);
    const opening = source === 'contacts' ? h.controller.openContacts() : source === 'patients' ? h.controller.openPatients() : h.controller.openClinical(); await started.promise;
    const fresh = await h.controller.openCatalog(); assert.ok(fresh); gate.resolve(other[source]); assert.equal(await opening, null);
    assert.equal(h.controller.getCatalogWorkspace(), fresh); assert.equal(fresh.getState().closed, false); assert.deepEqual(cap.calls, []); await h.controller.dispose();
  }
});

test('catalog capability failure returns a fixed safe error and owns full Auth cleanup exactly once', async () => {
  const h = fixture({ getServiceCatalog: async () => { throw new Error(PASSWORD); } }); await h.controller.signIn(EMAIL, PASSWORD);
  assert.equal(await h.controller.openCatalog(), null); assert.ok(h.controller.getState().catalog.error);
  assert.equal(h.controller.getState().catalog.error.includes(PASSWORD), false); assert.equal(h.controller.getState().auth.owner, null);
  assert.equal(h.calls.filter(value => value === 'destroy').length, 1); await h.controller.dispose();
});

test('catalog opening and external boundary callbacks cannot resurrect cancelled ownership or duplicate cleanup', async () => {
  for (const mode of ['opening', 'open', 'runtime', 'session-state'] as const) {
    const cap = catalogCapability(); let cancel = false, closing: Promise<boolean> | null = null; let h!: ReturnType<typeof fixture>;
    const cancelInside = () => { if (cancel) { cancel = false; assert.equal(h.controller.closeCatalog(), true); } };
    h = fixture({ getServiceCatalog: async () => cap.capability, runtime: () => { if (mode === 'runtime') cancelInside(); return true; },
      factory: async session => ({ ...session, getState: () => { if (mode === 'session-state') cancelInside(); return session.getState(); } }) });
    await h.controller.signIn(EMAIL, PASSWORD); h.controller.subscribe(value => {
      if (value.catalog.phase === mode) closing = h.controller.signOut();
      else if (value.catalog.phase === 'opening' && (mode === 'runtime' || mode === 'session-state')) cancel = true;
    });
    assert.equal(await h.controller.openCatalog(), null); if (closing) await closing;
    assert.equal(h.controller.getCatalogWorkspace(), null); assert.deepEqual(cap.calls, []); await h.controller.dispose();
  }
});

test('synchronous catalog disposal callbacks cannot reopen a revoked workspace and repeated logout owns one cleanup', async () => {
  const cap = catalogCapability(), h = fixture({ getServiceCatalog: async () => cap.capability }); await h.controller.signIn(EMAIL, PASSWORD);
  const workspace = await h.controller.openCatalog(); assert.ok(workspace);
  let secondLogout: Promise<boolean> | null = null, reopen: Promise<unknown> | null = null;
  workspace.subscribe(value => { if (!value.closed) return; assert.equal(h.controller.getCatalogWorkspace(), null);
    secondLogout = h.controller.signOut(); reopen = h.controller.openCatalog(); void workspace.loadHistory(); });
  const logout = h.controller.signOut(); assert.equal(logout, secondLogout); assert.equal(await reopen, null); await logout;
  assert.deepEqual(cap.calls, []); assert.equal(h.calls.filter(value => value === 'destroy').length, 1); await h.controller.dispose();
});

test('catalog exact UID lease rejects a different checked owner even when the parent session object is unchanged', async () => {
  const cap = catalogCapability(); let changed = false;
  const h = fixture({ getServiceCatalog: async () => cap.capability, factory: async candidate => ({ ...candidate, getState: () => {
    const state = candidate.getState(); return changed && state.owner ? { ...state, owner: { ...state.owner, uid: 'another-synthetic-owner' } } : state;
  } }) }); await h.controller.signIn(EMAIL, PASSWORD);
  const workspace = await h.controller.openCatalog(); assert.ok(workspace); await workspace.load(); changed = true;
  assert.equal(h.controller.getCatalogWorkspace(), null); assert.equal(workspace.getState().closed, true); assert.equal(workspace.getState().snapshot, null);
  await h.controller.dispose();
});

test('late catalog capability cannot replace a newer exact Auth session after the same owner logs in again', async () => {
  const oldGate = deferred<CloudServiceCatalogCapability>(), oldStarted = deferred(), oldCap = catalogCapability(), freshCap = catalogCapability();
  const old = fixture(), fresh = fixture(); let factories = 0;
  const controller = createCloudOperatingPageController(async () => ++factories === 1
    ? { ...old.session, getServiceCatalog: async () => { oldStarted.resolve(); return oldGate.promise; } }
    : { ...fresh.session, getServiceCatalog: async () => freshCap.capability }, () => true);
  await controller.signIn(EMAIL, PASSWORD); const opening = controller.openCatalog(); await oldStarted.promise;
  assert.equal(await controller.signOut(), true); await controller.signIn(EMAIL, PASSWORD); const current = await controller.openCatalog(); assert.ok(current);
  oldGate.resolve(oldCap.capability); assert.equal(await opening, null); assert.equal(controller.getCatalogWorkspace(), current);
  assert.equal(current.getState().closed, false); assert.deepEqual(oldCap.calls, []); assert.deepEqual(freshCap.calls, []);
  await controller.dispose(); await old.controller.dispose(); await fresh.controller.dispose();
});

test('catalog ordinary switch disposal callbacks cannot reopen the outgoing workspace or another competing domain', async () => {
  const cap = catalogCapability(), other = otherCapabilities();
  const h = fixture({ getServiceCatalog: async () => cap.capability, getContacts: async () => other.contacts,
    getPatients: async () => other.patients, getClinical: async () => other.clinical }); await h.controller.signIn(EMAIL, PASSWORD);
  const old = await h.controller.openCatalog(); assert.ok(old); const attempted: Promise<unknown>[] = [];
  old.subscribe(value => { if (!value.closed) return;
    attempted.push(h.controller.openCatalog(), h.controller.openContacts(), h.controller.openPatients(), h.controller.openClinical()); });
  const current = await h.controller.openContacts(); assert.ok(current); assert.deepEqual(await Promise.all(attempted), [null, null, null, null]);
  assert.equal(h.controller.getContactsWorkspace(), current); assert.equal(h.controller.getCatalogWorkspace(), null);
  assert.equal(h.calls.filter(call => call === 'getServiceCatalog').length, 1); await h.controller.dispose();
});

test('retained catalog close cannot cancel a fresh opening created inside its final workspace-state boundary', async () => {
  const cap = catalogCapability(); let armed = false, boundaries = 0, freshOpening: Promise<unknown> | null = null;
  let h!: ReturnType<typeof fixture>; let old!: NonNullable<Awaited<ReturnType<typeof h.controller.openCatalog>>>;
  h = fixture({ getServiceCatalog: async () => cap.capability, runtime: () => {
    if (armed && ++boundaries === 3) {
      armed = false; assert.equal(h.controller.closeCatalog(old), true); freshOpening = h.controller.openCatalog();
    }
    return true;
  } });
  await h.controller.signIn(EMAIL, PASSWORD); old = (await h.controller.openCatalog())!; assert.ok(old);
  armed = true; h.controller.closeCatalog(old); const fresh = await freshOpening; assert.ok(fresh);
  assert.equal(h.controller.getCatalogWorkspace(), fresh); assert.equal(old.getState().closed, true);
  await h.controller.dispose();
});

test('contact/patient/clinical owned closes also retain a fresh acquisition created inside outgoing state callbacks', async () => {
  for (const source of ['contacts', 'patients', 'clinical-file', 'clinical-recovery'] as const) {
    const other = otherCapabilities(); let armed = false, boundaries = 0, freshOpening: Promise<unknown> | null = null;
    let h!: ReturnType<typeof fixture>, old: unknown;
    const open = () => source === 'contacts' ? h.controller.openContacts()
      : source === 'patients' ? h.controller.openPatients() : h.controller.openClinical();
    const close = () => source === 'contacts' ? h.controller.closeContacts(old as any)
      : source === 'patients' ? h.controller.closePatients(old as any) : h.controller.closeClinical(old as any);
    h = fixture({ getContacts: async () => other.contacts, getPatients: async () => other.patients, getClinical: async () => other.clinical,
      runtime: () => {
        if (armed && ++boundaries === (source === 'clinical-recovery' ? 4 : 3)) {
          armed = false; assert.equal(close(), true); freshOpening = open();
        }
        return true;
      } });
    await h.controller.signIn(EMAIL, PASSWORD); old = await open(); assert.ok(old);
    armed = true; close(); const fresh = await freshOpening; assert.ok(fresh, source);
    const current = source === 'contacts' ? h.controller.getContactsWorkspace()
      : source === 'patients' ? h.controller.getPatientsWorkspace() : h.controller.getClinicalWorkspace();
    assert.equal(current, fresh); await h.controller.dispose();
  }
});
