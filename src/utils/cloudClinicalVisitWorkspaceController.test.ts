import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createCloudClinicalVisitWorkspaceController } from './cloudClinicalVisitWorkspaceController';
import type { CloudClinicalWorkspaceController, CloudClinicalWorkspaceState } from './cloudClinicalWorkspaceController';
import { projectCloudClinicalPatient, type CloudClinicalPatientSnapshot } from './cloudClinicalPatientProjection';
import type { CloudClinicalSessionData } from './cloudClinicalRepository';
import type { CloudServiceCatalogRecord } from './cloudServiceCatalogRepository';

// Fabricated controller/lifetime fakes only. Atomic repository+journal tests
// live separately; these tests never access SDKs, accounts or browser storage.
const PATIENT = '10000000-0000-4000-8000-000000000001';
const id = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const metadata = () => ({ date: '2026-10-12', notes: '', treatmentStage: 'single' as const,
  rootCanalStatus: '' as const, visitStatus: 'completed' as const });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
}
function snapshot(): CloudClinicalPatientSnapshot {
  return projectCloudClinicalPatient({ schemaVersion: 1, clinicId: 'main', recordId: PATIENT, fileNo: 451,
    revision: 1, lastOperationId: id(999), phoneKey: null,
    data: { name: 'ملف مصطنع', mobile: '', age: 30, gender: '', firstVisit: '2026-10-12', notes: '', allergy: '' } }, null, [], []);
}
function catalog(): CloudServiceCatalogRecord {
  return { schemaVersion: 1, clinicId: 'main', recordId: 'serviceCatalog', revision: 1, lastOperationId: id(998),
    data: { examinationCents: 10_000, services: [
      { serviceId: id(10), name: 'حشو مصطنع', kind: 'clinical', priceCents: 30_000, active: true },
      { serviceId: id(11), name: 'سعر غير محدد', kind: 'clinical', priceCents: null, active: true },
      { serviceId: id(12), name: 'خدمة دون مقابل', kind: 'clinical', priceCents: 0, active: true },
      { serviceId: id(13), name: 'خدمة غير مفعلة', kind: 'clinical', priceCents: 20_000, active: false },
      { serviceId: id(14), name: 'منتج مصطنع', kind: 'prosthetic', priceCents: 90_000, active: true },
    ] } };
}
function harness() {
  const selected = snapshot(), listeners = new Set<(value: CloudClinicalWorkspaceState) => void>();
  let fileState: CloudClinicalWorkspaceState = Object.freeze({ patientRecordId: PATIENT, snapshot: selected,
    loaded: true, loading: false, draftDirty: false, saveStatus: 'idle', pendingOperationId: null,
    error: '', notice: '', closed: false });
  let active = true, next = 100, catalogValue: CloudServiceCatalogRecord | null = catalog();
  let acknowledged = false, accepted = false;
  const calls: string[] = [], saves: { patientId: string; data: CloudClinicalSessionData; paid: number }[] = [];
  const faults = { lostAck: false, refresh: false, rejectStart: false, dirtyRelease: false, cancel: false };
  const hooks: { catalog?: () => Promise<CloudServiceCatalogRecord | null>; get?: () => void; id?: () => string;
    dirty?: (value: boolean) => void; saving?: () => Promise<void> | void; active?: () => boolean } = {};
  function emit(patch: Partial<CloudClinicalWorkspaceState>) {
    const published = Object.freeze({ ...fileState, ...patch }); fileState = published;
    for (const listener of [...listeners]) listener(published);
  }
  async function complete() {
    await hooks.saving?.();
    if (!accepted) { accepted = true; calls.push('commit'); }
    if (faults.lostAck) { faults.lostAck = false; emit({ saveStatus: 'retry-required', error: 'لم يصل التأكيد' }); return false; }
    acknowledged = true; emit({ saveStatus: 'refresh-required', loading: true }); calls.push('refresh');
    if (faults.refresh) { emit({ loading: false, error: 'فشل التحديث' }); return false; }
    emit({ snapshot: Object.freeze({ ...selected, accountRevision: selected.accountRevision + 1 }),
      saveStatus: 'idle', loading: false, pendingOperationId: null, draftDirty: false });
    return true;
  }
  const file: CloudClinicalWorkspaceController = {
    getState: () => { hooks.get?.(); return fileState; },
    subscribe: listener => { calls.push('subscribe'); listeners.add(listener); return () => { calls.push('unsubscribe'); listeners.delete(listener); }; },
    setDraftDirty: (patientId, dirty) => {
      calls.push(`dirty:${dirty}`); hooks.dirty?.(dirty);
      if (fileState.closed || fileState.patientRecordId !== patientId || !fileState.loaded || fileState.loading
        || fileState.saveStatus !== 'idle' || fileState.pendingOperationId !== null || !dirty && faults.dirtyRelease) return false;
      emit({ draftDirty: dirty }); return true;
    },
    saveVisit: async (patientId, data, paid) => {
      calls.push('save');
      if (faults.rejectStart) return false;
      saves.push({ patientId, data: structuredClone(data), paid });
      emit({ saveStatus: 'preparing', pendingOperationId: id(500) });
      return complete();
    },
    retry: async () => {
      calls.push('retry');
      if (fileState.loading || fileState.saveStatus === 'idle' || !fileState.pendingOperationId) return false;
      emit({ loading: true });
      if (!acknowledged) return complete();
      calls.push('refresh');
      if (faults.refresh) { emit({ loading: false }); return false; }
      emit({ snapshot: Object.freeze({ ...selected, accountRevision: 1 }), saveStatus: 'idle', loading: false,
        pendingOperationId: null, draftDirty: false }); return true;
    },
    cancelPending: async () => {
      calls.push('cancel-pending');
      if (acknowledged || fileState.loading || faults.cancel) return false;
      emit({ loading: true });
      emit({ snapshot: null, loaded: false, loading: false, saveStatus: 'idle', pendingOperationId: null, draftDirty: false });
      return true;
    },
    dispose: () => emit({ closed: true, snapshot: null, loaded: false, draftDirty: false, saveStatus: 'idle', pendingOperationId: null }),
    open: async () => false, refresh: async () => false, resume: async () => false,
    addReceipt: async () => false, saveProgress: async () => false,
  };
  const controller = createCloudClinicalVisitWorkspaceController({ file,
    getCatalog: async () => { calls.push('catalog'); return hooks.catalog ? hooks.catalog() : catalogValue; },
    isActive: () => hooks.active ? hooks.active() : active,
    newId: () => { calls.push('id'); return hooks.id ? hooks.id() : id(next++); },
  });
  return { controller, file, selected, calls, saves, hooks, faults, emit,
    state: () => fileState, active: (value: boolean) => { active = value; },
    catalog: (value: CloudServiceCatalogRecord | null) => { catalogValue = value; } };
}

test('visit construction and inspection are inert; beginning requires the exact verified file snapshot', async () => {
  const h = harness(); assert.deepEqual(h.calls, []); assert.equal(h.controller.getState().phase, 'idle');
  assert.deepEqual(h.calls, []);
  assert.equal(await h.controller.begin(structuredClone(h.selected)), false);
  assert.deepEqual(h.calls, []); assert.equal(await h.controller.begin(h.selected), true);
  assert.deepEqual(h.calls, ['subscribe', 'dirty:true', 'catalog']);
  assert.equal(h.controller.getState().phase, 'editing'); assert.equal(h.controller.getState().draft?.examinationEnabled, false);
  assert.equal(h.state().draftDirty, true); assert.equal(Object.isFrozen(h.controller.getState()), true);
});
test('begin owns the ordinary dirty lock before awaiting catalog and rejects overlap', async () => {
  const h = harness(), delayed = deferred<CloudServiceCatalogRecord | null>(); h.hooks.catalog = () => delayed.promise;
  const opening = h.controller.begin(h.selected);
  assert.equal(h.controller.getState().phase, 'loading'); assert.equal(h.state().draftDirty, true);
  assert.equal(await h.controller.begin(h.selected), false); assert.equal(await h.controller.save(metadata(), 0), false);
  assert.equal(h.controller.chooseService(id(10)), false); assert.equal(h.calls.includes('save'), false);
  delayed.resolve(catalog()); assert.equal(await opening, true); assert.equal(h.controller.getState().phase, 'editing');
});
test('missing or malformed catalog fails closed without default prices and releases only its own ordinary lock', async () => {
  for (const value of [null, { ...catalog(), revision: 0 }]) {
    const h = harness(); h.catalog(value);
    assert.equal(await h.controller.begin(h.selected), false); assert.equal(h.state().draftDirty, false);
    assert.equal(h.controller.getState().phase, 'idle'); assert.equal(h.controller.getState().catalog, null);
    assert.equal(h.controller.getState().draft, null); assert.match(h.controller.getState().error, /قائمة أسعار/);
    assert.deepEqual(h.calls, ['subscribe', 'dirty:true', 'catalog', 'dirty:false']);
  }
});
test('preexisting dirty editors, payment attempts, reads and closed files cannot start a visit or request catalog', async () => {
  const patches: Partial<CloudClinicalWorkspaceState>[] = [{ draftDirty: true }, { loading: true }, { loaded: false },
    { pendingOperationId: id(501), saveStatus: 'retry-required' }, { closed: true }, { snapshot: null }];
  for (const patch of patches) {
    const h = harness(); h.emit(patch); assert.equal(await h.controller.begin(h.selected), false);
    assert.equal(h.calls.includes('catalog'), false); assert.equal(h.calls.includes('dirty:true'), false);
  }
});
test('one service click immediately appends; captured catalog prices and optional 100 EGP examination do not collect cash', async () => {
  const h = harness(); await h.controller.begin(h.selected);
  assert.equal(h.controller.chooseService(id(10)), true);
  assert.equal(h.controller.getState().draft?.services.length, 1); assert.equal(h.calls.includes('save'), false);
  const changed = catalog(); changed.data.examinationCents = 50_000; changed.data.services[0].priceCents = 90_000;
  h.catalog(changed);
  assert.equal(h.controller.setExaminationEnabled(true), true);
  assert.equal(h.controller.getState().draft?.examinationCents, 10_000);
  assert.equal(await h.controller.save(metadata(), 15_000), true);
  assert.equal(h.saves[0].data.services[0].priceCents, 30_000); assert.equal(h.saves[0].data.examinationCents, 10_000);
  assert.equal(h.saves[0].paid, 15_000); assert.equal(h.controller.getState().phase, 'idle');
  assert.equal(h.controller.getState().draft, null); assert.equal(h.state().draftDirty, false);
});
test('examination is opt-in, not inferred from visiting or choosing a service', async () => {
  const h = harness(); await h.controller.begin(h.selected); h.controller.chooseService(id(10));
  assert.equal(await h.controller.save(metadata(), 0), true); assert.equal(h.saves[0].data.examinationCents, 0);
  assert.equal(h.saves[0].paid, 0);
});
test('exam-only visit is allowed only after enabling the configured fee', async () => {
  const h = harness(); await h.controller.begin(h.selected);
  assert.equal(await h.controller.save(metadata(), 0), false); assert.equal(h.calls.includes('save'), false);
  assert.equal(h.controller.setExaminationEnabled(true), true);
  assert.equal(await h.controller.save(metadata(), 10_000), true); assert.equal(h.saves[0].data.services.length, 0);
  assert.equal(h.saves[0].data.type, 'كشف');
});
test('blank price is not zero; explicit zero remains valid and is never auto-charged', async () => {
  const h = harness(); await h.controller.begin(h.selected); assert.equal(h.controller.chooseService(id(11)), true);
  const row = h.controller.getState().draft!.services[0]; assert.equal(row.priceCents, null);
  assert.equal(await h.controller.save(metadata(), 0), false); assert.equal(h.calls.includes('save'), false);
  assert.equal(h.controller.setServicePrice(row.id, 0), true); assert.equal(await h.controller.save(metadata(), 0), true);
  assert.equal(h.saves[0].data.services[0].priceCents, 0); assert.equal(h.saves[0].data.services[0].catalogServiceId, id(11));
});
test('each service tooth belongs to the single canonical board, with explicit manual selections retained separately', async () => {
  const h = harness(); await h.controller.begin(h.selected); h.controller.chooseService(id(10));
  const row = h.controller.getState().draft!.services[0].id;
  assert.equal(h.controller.setServiceTooth(row, 'ur5'), true);
  assert.deepEqual(h.controller.getState().draft!.teethIds, ['ur5']);
  assert.equal(h.controller.setTeeth(['ul6']), true);
  assert.deepEqual(h.controller.getState().draft!.teethIds, ['ul6', 'ur5']);
  assert.equal(h.controller.setTeeth(['ur5', 'ul6']), true);
  assert.equal(h.controller.setServiceTooth(row, '99'), false);
  assert.equal(await h.controller.save(metadata(), 0), true); assert.equal(h.saves[0].data.services[0].tooth, 'ur5');
  assert.deepEqual(h.saves[0].data.teethIds, ['ur5', 'ul6']);
});
test('changing or clearing a row tooth removes its obsolete derived selection without affecting the captured row ID', async () => {
  const h = harness(); await h.controller.begin(h.selected); h.controller.chooseService(id(10));
  const row = h.controller.getState().draft!.services[0].id, generated = h.calls.filter(call => call === 'id').length;
  assert.equal(h.controller.setServiceTooth(row, 'ur5'), true); assert.equal(h.controller.setServiceTooth(row, 'ul2'), true);
  assert.deepEqual(h.controller.getState().draft!.teethIds, ['ul2']);
  assert.equal(h.controller.setServiceTooth(row, null), true); assert.deepEqual(h.controller.getState().draft!.teethIds, []);
  assert.equal(h.controller.getState().draft!.services[0].id, row);
  assert.equal(h.calls.filter(call => call === 'id').length, generated);
});
test('removing the last tooth-linked row leaves no hidden teeth in an examination-only save', async () => {
  const h = harness(); await h.controller.begin(h.selected); h.controller.chooseService(id(10));
  const row = h.controller.getState().draft!.services[0].id;
  h.controller.setServiceTooth(row, 'ur5'); h.controller.setExaminationEnabled(true);
  assert.equal(h.controller.removeService(row), true); assert.deepEqual(h.controller.getState().draft!.teethIds, []);
  assert.equal(await h.controller.save(metadata(), 0), true); assert.deepEqual(h.saves[0].data.teethIds, []);
});
test('explicit manual teeth survive row changes and removal, while clearing manual teeth retains teeth still used by rows', async () => {
  const h = harness(); await h.controller.begin(h.selected); h.controller.chooseService(id(10));
  const row = h.controller.getState().draft!.services[0].id;
  assert.equal(h.controller.setTeeth(['ur5', 'lr3']), true); assert.equal(h.controller.setServiceTooth(row, 'ur5'), true);
  assert.equal(h.controller.setServiceTooth(row, 'ul2'), true); assert.deepEqual(h.controller.getState().draft!.teethIds, ['ur5', 'lr3', 'ul2']);
  assert.equal(h.controller.setTeeth([]), true); assert.deepEqual(h.controller.getState().draft!.teethIds, ['ul2']);
  assert.equal(h.controller.setTeeth(['lr3']), true); assert.equal(h.controller.removeService(row), true);
  assert.deepEqual(h.controller.getState().draft!.teethIds, ['lr3']);
});
test('a shared row tooth stays selected until its final using row is cleared or removed', async () => {
  const h = harness(); await h.controller.begin(h.selected); h.controller.chooseService(id(10)); h.controller.chooseService(id(12));
  const [first, second] = h.controller.getState().draft!.services;
  h.controller.setServiceTooth(first.id, 'ul2'); h.controller.setServiceTooth(second.id, 'ul2');
  assert.equal(h.controller.removeService(first.id), true); assert.deepEqual(h.controller.getState().draft!.teethIds, ['ul2']);
  assert.equal(h.controller.setServiceTooth(second.id, null), true); assert.deepEqual(h.controller.getState().draft!.teethIds, []);
});
test('a rejected staged row or manual-teeth change never publishes a partially changed clinical draft', async () => {
  const h = harness(); await h.controller.begin(h.selected); h.controller.chooseService(id(10));
  const row = h.controller.getState().draft!.services[0].id; h.controller.setServiceTooth(row, 'ur5');
  const before = h.controller.getState().draft, drafts: unknown[] = [];
  h.controller.subscribe(value => { drafts.push(value.draft); });
  assert.equal(h.controller.setServiceTooth(row, 'invalid'), false);
  assert.equal(h.controller.setServicePrice(row, 0.5), false);
  assert.equal(h.controller.setTeeth(['ur5', 'ur5']), false);
  assert.equal(h.controller.setTeeth(undefined as unknown as readonly string[]), false);
  assert.equal(h.controller.getState().draft, before); assert.equal(drafts.every(value => value === before), true);
  assert.equal(h.calls.filter(call => call === 'id').length, 1);
});
test('later subscribers receive the original visit transition when an earlier listener triggers a nested invalidation', async () => {
  const h = harness(); await h.controller.begin(h.selected); const observed: string[] = []; let invalidated = false;
  h.controller.subscribe(value => {
    if (value.phase === 'editing' && value.draft?.services.length === 1 && !invalidated) {
      invalidated = true; h.emit({ draftDirty: false });
    }
  });
  h.controller.subscribe(value => { observed.push(value.phase); });
  assert.equal(h.controller.chooseService(id(10)), false);
  assert.deepEqual(observed, ['idle', 'editing']); assert.equal(h.controller.getState().phase, 'idle');
});
test('removing a selected service is memory-only and allows a deliberate different selection', async () => {
  const h = harness(); await h.controller.begin(h.selected); h.controller.chooseService(id(10));
  const row = h.controller.getState().draft!.services[0].id;
  assert.equal(h.controller.removeService(row), true); assert.equal(h.controller.removeService(row), false);
  assert.equal(h.controller.getState().draft!.services.length, 0); assert.equal(h.calls.includes('save'), false);
  assert.equal(h.controller.chooseService(id(12)), true);
});
test('inactive, prosthetic and unknown services cannot enter the ordinary clinical editor', async () => {
  const h = harness(); await h.controller.begin(h.selected);
  for (const service of [id(13), id(14), id(998), '451']) assert.equal(h.controller.chooseService(service), false);
  assert.equal(h.controller.getState().draft!.services.length, 0); assert.equal(h.calls.includes('id'), false);
});
test('explicit amounts are bounded integer piastres and collected cash cannot exceed the visit charge', async () => {
  const h = harness(); await h.controller.begin(h.selected); h.controller.chooseService(id(10));
  const row = h.controller.getState().draft!.services[0].id;
  for (const amount of [-1, -0, 0.1, NaN, Infinity, 1_000_000_000_001]) assert.equal(h.controller.setServicePrice(row, amount), false);
  for (const paid of [-1, -0, 0.1, NaN, Infinity, 30_001]) assert.equal(await h.controller.save(metadata(), paid), false);
  assert.equal(h.calls.includes('save'), false); assert.equal(h.controller.getState().phase, 'editing');
});
test('invalid or accessor metadata never reaches the file controller or exposes exception text', async () => {
  const h = harness(); await h.controller.begin(h.selected); h.controller.chooseService(id(10));
  const invalid = { ...metadata(), date: '2026-02-31' }; assert.equal(await h.controller.save(invalid, 0), false);
  const hostile = { ...metadata() }; Object.defineProperty(hostile, 'notes', { get() { throw new Error('PRIVATE_VALUE'); }, enumerable: true });
  assert.equal(await h.controller.save(hostile, 0), false); assert.equal(h.calls.includes('save'), false);
  assert.equal(h.controller.getState().error.includes('PRIVATE_VALUE'), false);
});
test('an unsettled submission locks edits, normal cancel and duplicate save until the original operation resolves', async () => {
  const h = harness(), delayed = deferred<void>(); await h.controller.begin(h.selected); h.controller.chooseService(id(10));
  h.hooks.saving = () => delayed.promise; const saving = h.controller.save(metadata(), 5000);
  assert.equal(h.controller.getState().phase, 'submitting'); assert.equal(h.controller.cancel(), false);
  assert.equal(h.controller.chooseService(id(12)), false); assert.equal(h.controller.setExaminationEnabled(true), false);
  assert.equal(await h.controller.save(metadata(), 100), false); assert.equal(await h.controller.retry(), false);
  delayed.resolve(); assert.equal(await saving, true); assert.equal(h.saves.length, 1);
});
test('lost acknowledgement delegates retry to the original file operation, not a replacement save', async () => {
  const h = harness(); await h.controller.begin(h.selected); h.controller.chooseService(id(10)); h.faults.lostAck = true;
  assert.equal(await h.controller.save(metadata(), 5000), false); assert.equal(h.controller.getState().phase, 'pending');
  assert.equal(h.controller.cancel(), false); assert.equal(h.controller.setExaminationEnabled(true), false);
  assert.equal(await h.controller.save(metadata(), 5000), false); assert.equal(await h.controller.retry(), true);
  assert.equal(h.controller.getState().phase, 'idle'); assert.equal(h.saves.length, 1);
  assert.equal(h.calls.filter(call => call === 'commit').length, 1);
});
test('acknowledged save with failed refresh only retries reads and cannot be cancelled as an ordinary draft', async () => {
  const h = harness(); await h.controller.begin(h.selected); h.controller.chooseService(id(10)); h.faults.refresh = true;
  assert.equal(await h.controller.save(metadata(), 5000), false); assert.equal(h.controller.getState().phase, 'pending');
  assert.equal(await h.controller.cancelPending(), false); assert.equal(h.controller.getState().phase, 'pending');
  assert.equal(h.controller.cancel(), false); h.faults.refresh = false;
  assert.equal(await h.controller.retry(), true); assert.equal(h.saves.length, 1);
  assert.equal(h.calls.filter(call => call === 'commit').length, 1); assert.equal(h.controller.getState().phase, 'idle');
});
test('external file retry completion also clears the editor without requiring a second visit action', async () => {
  const h = harness(); await h.controller.begin(h.selected); h.controller.chooseService(id(10)); h.faults.lostAck = true;
  await h.controller.save(metadata(), 5000); assert.equal(h.controller.getState().phase, 'pending');
  assert.equal(await h.file.retry(), true); assert.equal(h.controller.getState().phase, 'idle');
  assert.equal(h.controller.getState().draft, null); assert.equal(h.saves.length, 1);
});
test('confirmed pending cancellation discards only the original command and requires a fresh verified file', async () => {
  const h = harness(); await h.controller.begin(h.selected); h.controller.chooseService(id(10)); h.faults.lostAck = true;
  await h.controller.save(metadata(), 5000);
  assert.equal(await h.controller.cancelPending(), true); assert.equal(h.controller.getState().phase, 'idle');
  assert.equal(await h.controller.begin(h.selected), false); assert.equal(h.state().loaded, false);
});
test('ordinary cancel releases only its exact snapshot lock and a late catalog read cannot resurrect it', async () => {
  const h = harness(), delayed = deferred<CloudServiceCatalogRecord | null>(); h.hooks.catalog = () => delayed.promise;
  const opening = h.controller.begin(h.selected); assert.equal(h.controller.cancel(), true);
  assert.equal(h.state().draftDirty, false); assert.equal(h.controller.getState().phase, 'idle');
  delayed.resolve(catalog()); assert.equal(await opening, false); assert.equal(h.controller.getState().draft, null);
});
test('a refused dirty release retains the original editor and does not falsely report cancellation', async () => {
  const h = harness(); await h.controller.begin(h.selected); h.controller.chooseService(id(10));
  const draft = h.controller.getState().draft; h.faults.dirtyRelease = true;
  assert.equal(h.controller.cancel(), false); assert.equal(h.state().draftDirty, true);
  assert.equal(h.controller.getState().phase, 'editing'); assert.equal(h.controller.getState().draft, draft);
  assert.match(h.controller.getState().error, /تعذر تأكيد إلغاء/); h.faults.dirtyRelease = false;
  assert.equal(h.controller.cancel(), true); assert.equal(h.state().draftDirty, false); assert.equal(h.controller.getState().phase, 'idle');
});
test('a throwing dirty release retains ownership for an explicit retry without leaking its exception', async () => {
  const h = harness(); await h.controller.begin(h.selected);
  h.hooks.dirty = value => { if (!value) throw new Error('PRIVATE_RELEASE'); };
  assert.equal(h.controller.cancel(), false); assert.equal(h.controller.getState().phase, 'editing');
  assert.equal(h.controller.getState().error.includes('PRIVATE_RELEASE'), false); assert.equal(h.state().draftDirty, true);
  h.hooks.dirty = undefined; assert.equal(h.controller.cancel(), true);
});
test('catalog failure with a refused release keeps the protected lock reachable by cancel rather than forgetting it', async () => {
  const h = harness(); h.catalog(null); h.faults.dirtyRelease = true;
  assert.equal(await h.controller.begin(h.selected), false); assert.equal(h.controller.getState().phase, 'loading');
  assert.equal(h.controller.getState().snapshot, h.selected); assert.equal(h.controller.getState().draft, null);
  assert.match(h.controller.getState().error, /تعذر تأكيد إلغاء/); assert.equal(h.state().draftDirty, true);
  assert.equal(h.controller.cancel(), false); h.faults.dirtyRelease = false;
  assert.equal(h.controller.cancel(), true); assert.equal(h.state().draftDirty, false); assert.equal(h.controller.getState().phase, 'idle');
});
test('a reentrant replacement after ordinary release is not mistaken for the old lock or released a second time', async () => {
  const h = harness(); let reacquired = false;
  h.file.subscribe(value => {
    if (!value.draftDirty && !reacquired) { reacquired = true; h.file.setDraftDirty(PATIENT, true); }
  });
  await h.controller.begin(h.selected); assert.equal(h.controller.cancel(), false);
  assert.equal(h.state().draftDirty, true); assert.equal(h.controller.getState().phase, 'idle');
  assert.equal(h.calls.filter(call => call === 'dirty:false').length, 1); assert.equal(h.controller.cancel(), false);
  assert.equal(h.calls.filter(call => call === 'dirty:false').length, 1);
});
test('outside reset and reacquisition before the visit subscriber cannot hide lost ownership', async () => {
  const h = harness(); let reacquired = false;
  h.file.subscribe(value => {
    if (!value.draftDirty && !reacquired) { reacquired = true; h.file.setDraftDirty(PATIENT, true); }
  });
  await h.controller.begin(h.selected); h.emit({ draftDirty: false });
  assert.equal(h.controller.getState().phase, 'idle'); assert.equal(h.state().draftDirty, true);
  assert.equal(h.controller.cancel(), false); assert.equal(h.calls.includes('dirty:false'), false);
});
test('catalog failure never releases a replacement editor or unrelated pending payment', async () => {
  for (const replacement of [{ snapshot: snapshot(), draftDirty: true },
    { saveStatus: 'retry-required' as const, pendingOperationId: id(501), draftDirty: true }]) {
    const h = harness(), delayed = deferred<CloudServiceCatalogRecord | null>(); h.hooks.catalog = () => delayed.promise;
    const opening = h.controller.begin(h.selected); h.emit(replacement); delayed.resolve(null);
    assert.equal(await opening, false); assert.equal(h.state().draftDirty, true);
    assert.equal(h.calls.includes('dirty:false'), false); assert.equal(h.controller.getState().draft, null);
  }
});
test('outside file changes invalidate the editor without stealing dirty state or cancelling a foreign operation', async () => {
  const h = harness(); await h.controller.begin(h.selected); h.controller.chooseService(id(10));
  h.emit({ pendingOperationId: id(501), saveStatus: 'preparing' });
  assert.equal(h.controller.getState().phase, 'idle'); assert.equal(h.controller.getState().draft, null);
  assert.equal(h.controller.cancel(), false); assert.equal(await h.controller.retry(), false);
  assert.equal(h.calls.includes('cancel-pending'), false); assert.equal(h.calls.includes('dirty:false'), false);
});
test('external dirty reset then reacquisition does not grant the old editor ownership of the new lock', async () => {
  const h = harness(); await h.controller.begin(h.selected); h.emit({ draftDirty: false }); h.emit({ draftDirty: true });
  assert.equal(h.controller.getState().phase, 'idle'); assert.equal(h.controller.setExaminationEnabled(true), false);
  assert.equal(h.controller.cancel(), false); assert.equal(h.state().draftDirty, true);
});
test('temporary auth checking retains the draft, while actual identity loss immediately clears memory', async () => {
  const h = harness(); await h.controller.begin(h.selected); h.controller.chooseService(id(10));
  const before = h.controller.getState().draft; assert.equal(h.controller.getState().draft, before);
  h.active(false); assert.equal(h.controller.getState().closed, true); assert.equal(h.controller.getState().draft, null);
  assert.equal(h.controller.getState().snapshot, null); assert.equal(h.controller.getState().catalog, null);
  assert.equal(h.calls.includes('unsubscribe'), true); assert.equal(h.calls.includes('cancel-pending'), false);
});
test('file disposal synchronously clears the editor; late save completion cannot republish or undo the accepted write', async () => {
  const h = harness(), delayed = deferred<void>(); await h.controller.begin(h.selected); h.controller.chooseService(id(10));
  h.hooks.saving = () => delayed.promise; const saving = h.controller.save(metadata(), 5000);
  h.file.dispose(); assert.equal(h.controller.getState().closed, true); assert.equal(h.controller.getState().draft, null);
  delayed.resolve(); assert.equal(await saving, false); assert.equal(h.controller.getState().snapshot, null);
  assert.equal(h.calls.filter(call => call === 'commit').length, 1); assert.equal(h.calls.includes('cancel-pending'), false);
});
test('disposal from the UUID callback cannot append or resurrect the old editor', async () => {
  const h = harness(); await h.controller.begin(h.selected);
  h.hooks.id = () => { h.controller.dispose(); return id(101); };
  assert.equal(h.controller.chooseService(id(10)), false); assert.equal(h.controller.getState().closed, true);
  assert.equal(h.controller.getState().draft, null); assert.equal(h.calls.includes('save'), false);
});
test('UUID callback cannot reenter selection or saving and create duplicate service rows', async () => {
  const h = harness(); await h.controller.begin(h.selected); let nested: boolean | null = null;
  h.hooks.id = () => { nested = h.controller.chooseService(id(12)); return id(101); };
  assert.equal(h.controller.chooseService(id(10)), true); assert.equal(nested, false);
  assert.equal(h.controller.getState().draft!.services.length, 1); assert.equal(h.calls.filter(call => call === 'id').length, 1);
});
test('subscriber inspecting loading and every later state does not invalidate the dirty claim or duplicate submission', async () => {
  const h = harness(); const phases: string[] = [];
  h.controller.subscribe(value => { phases.push(value.phase); h.controller.getState(); });
  assert.equal(await h.controller.begin(h.selected), true); h.controller.chooseService(id(10));
  assert.equal(await h.controller.save(metadata(), 5000), true); assert.equal(h.saves.length, 1);
  assert.equal(phases[0], 'loading'); assert.equal(phases.at(-1), 'idle');
});
test('synchronous retry subscribers cannot create a second retry while the original refresh owns its lock', async () => {
  const h = harness(); await h.controller.begin(h.selected); h.controller.chooseService(id(10)); h.faults.lostAck = true;
  await h.controller.save(metadata(), 5000); let attempted = false, nested: Promise<boolean> | null = null;
  h.controller.subscribe(value => {
    if (value.phase === 'submitting' && !attempted) { attempted = true; h.controller.getState(); nested = h.controller.retry(); }
  });
  assert.equal(await h.controller.retry(), true); assert.equal(await nested, false);
  assert.equal(h.calls.filter(call => call === 'retry').length, 1); assert.equal(h.saves.length, 1);
});
test('a start rejected before preparing preserves the ordinary editor and its prices', async () => {
  const h = harness(); await h.controller.begin(h.selected); h.controller.chooseService(id(10)); h.faults.rejectStart = true;
  assert.equal(await h.controller.save(metadata(), 0), false); assert.equal(h.controller.getState().phase, 'editing');
  assert.equal(h.controller.getState().draft!.services[0].priceCents, 30_000); assert.equal(h.state().draftDirty, true);
});
test('controller bundle cannot depend on SDKs, browser storage or local clinic defaults', async () => {
  const output = await build({ entryPoints: ['src/utils/cloudClinicalVisitWorkspaceController.ts'], bundle: true,
    write: false, platform: 'browser', format: 'esm', metafile: true });
  assert.equal(Object.keys(output.metafile!.inputs).some(path => /firebase|storage|defaultSettings|localStorage/i.test(path)), false);
});
