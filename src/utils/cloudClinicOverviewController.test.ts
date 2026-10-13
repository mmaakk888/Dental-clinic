import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudClinicOverviewController } from './cloudClinicOverviewController';
import { createCloudClinicSnapshotReader, type CloudClinicSnapshot } from './cloudClinicSnapshot';
import { makeClinicSnapshotFixture, snapshotDigest } from './testing/cloudClinicSnapshotFixtures';

const DAY = '2026-10-13';
const deferred = <T>() => { let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
async function harness() {
  const fixture = await makeClinicSnapshotFixture(), snapshot = await createCloudClinicSnapshotReader(fixture.adapter, { digest: snapshotDigest }).readFull();
  let active = true, authorized = 0, reads = 0;
  let get: (() => Promise<{ readFull(): Promise<CloudClinicSnapshot> }>) | null = null;
  const capability = { readFull: async () => { reads++; return snapshot; } };
  const controller = createCloudClinicOverviewController({ initialDate: DAY, isActive: () => active,
    getSnapshot: async () => { authorized++; return get ? get() : capability; } });
  return { controller, snapshot, capability, counts: () => ({ authorized, reads }), active: (value: boolean) => { active = value; },
    get: (value: typeof get) => { get = value; } };
}
test('construction, subscription, tab/range/query changes remain inert until explicit refresh', async () => {
  const h = await harness(); const unsubscribe = h.controller.subscribe(() => {});
  assert.equal(h.controller.getState().snapshot, null); assert.equal(h.controller.canClose(), true);
  h.controller.setTab('directory'); h.controller.setDirectoryQuery('أحمد'); h.controller.setRange({ from: DAY, to: '2026-10-14' });
  assert.deepEqual(h.counts(), { authorized: 0, reads: 0 }); unsubscribe();
  assert.equal(await h.controller.refresh(), true); assert.deepEqual(h.counts(), { authorized: 1, reads: 1 });
  assert.equal(h.controller.getState().snapshot, h.snapshot); assert.equal(h.controller.getState().projection?.readTime, h.snapshot.readTime);
});
test('refresh claims its lock before subscribers and blocks competing reads, navigation, export and closure', async () => {
  const h = await harness(), gate = deferred<{ readFull(): Promise<CloudClinicSnapshot> }>(); h.get(() => gate.promise);
  const results: boolean[] = []; let attempted = false;
  h.controller.subscribe(state => { if (state.loading && !attempted) { attempted = true; results.push(h.controller.setTab('finance'), h.controller.canClose()); void h.controller.refresh(); } });
  const work = h.controller.refresh(); assert.equal(h.controller.canClose(), false); assert.equal(h.controller.setDirectoryQuery('ignored'), false);
  assert.equal(await h.controller.prepareExport('contacts-csv', h.snapshot), null); assert.deepEqual(results, [false, false]);
  assert.deepEqual(h.counts(), { authorized: 1, reads: 0 }); gate.resolve(h.capability); assert.equal(await work, true);
  assert.equal(h.controller.getState().directoryQuery, ''); assert.equal(h.controller.canClose(), true);
});
test('changing display range/filter/page never rereads and invalid calendar input preserves last valid state', async () => {
  const h = await harness(); await h.controller.refresh(); const snapshot = h.controller.getState().snapshot;
  assert.equal(h.controller.setRange({ from: '2026-10-14', to: '2026-10-14' }), true);
  assert.equal(h.controller.getState().projection!.totals.collectedCents, '0');
  assert.equal(h.controller.setRange({ from: '2026-02-30', to: DAY }), false); assert.equal(h.controller.getState().range.from, '2026-10-14');
  h.controller.setDirectoryFilter('files'); h.controller.showMoreCash(); h.controller.showMoreDirectory();
  assert.equal(h.controller.getState().snapshot, snapshot); assert.deepEqual(h.counts(), { authorized: 1, reads: 1 });
});
test('failed refresh retains a clearly dated last confirmed snapshot, not a partial new one', async () => {
  const h = await harness(); await h.controller.refresh(); h.get(async () => { throw new Error('PRIVATE_PROVIDER_SECRET'); });
  assert.equal(await h.controller.refresh(), false); assert.equal(h.controller.getState().snapshot, h.snapshot);
  assert.match(h.controller.getState().notice, /آخر نسخة مؤكدة/); assert.doesNotMatch(h.controller.getState().error, /PRIVATE/);
  assert.equal(h.controller.getState().loading, false);
});
test('dispose during pending authorization rejects late data and clears all private buffers', async () => {
  const h = await harness(), gate = deferred<{ readFull(): Promise<CloudClinicSnapshot> }>(); h.get(() => gate.promise);
  const work = h.controller.refresh(); h.controller.dispose(); gate.resolve(h.capability);
  assert.equal(await work, false); assert.equal(h.controller.getState().snapshot, null); assert.equal(h.controller.getState().closed, true);
  assert.equal(h.counts().reads, 0); assert.equal(await h.controller.refresh(), false);
});
test('actual lifetime loss during the full read never publishes the result', async () => {
  const h = await harness(), gate = deferred<CloudClinicSnapshot>(); h.get(async () => ({ readFull: () => gate.promise }));
  const work = h.controller.refresh(); await Promise.resolve(); await Promise.resolve(); h.active(false); gate.resolve(h.snapshot);
  assert.equal(await work, false); assert.equal(h.controller.getState().snapshot, null);
});
test('export authorizes before/after packaging the exact visible snapshot without rereading all records', async () => {
  const h = await harness(); await h.controller.refresh();
  const ticket = await h.controller.prepareExport('operational-json', h.snapshot); assert.ok(ticket);
  assert.deepEqual(h.counts(), { authorized: 3, reads: 1 }); assert.equal(ticket.readTime, h.snapshot.readTime);
  assert.equal(JSON.parse(ticket.text).records.patientReceipts.length, 3);
  assert.equal(h.controller.consumeExport(ticket), ticket); assert.equal(h.controller.consumeExport(ticket), null);
});
test('export is snapshot/reference-bound and rejects a stale or forged ticket', async () => {
  const h = await harness(); await h.controller.refresh();
  assert.equal(await h.controller.prepareExport('contacts-csv', structuredClone(h.snapshot)), null);
  const ticket = (await h.controller.prepareExport('contacts-csv', h.snapshot))!;
  assert.equal(h.controller.consumeExport({ ...ticket }), null);
  h.controller.setDirectoryQuery('new view'); assert.equal(h.controller.consumeExport(ticket), null);
  const ticket2 = (await h.controller.prepareExport('contacts-csv', h.snapshot))!;
  h.controller.setTab('finance'); assert.equal(h.controller.consumeExport(ticket2), null);
});
test('export packaging is locked before notifications and blocks tab/refresh actions', async () => {
  const h = await harness(); await h.controller.refresh(); const gate = deferred<{ readFull(): Promise<CloudClinicSnapshot> }>(); h.get(() => gate.promise);
  const work = h.controller.prepareExport('contacts-csv', h.snapshot);
  assert.equal(h.controller.canClose(), false); assert.equal(h.controller.setTab('home'), false); assert.equal(await h.controller.refresh(), false);
  gate.resolve(h.capability); const ticket = await work; assert.ok(ticket); assert.equal(h.controller.canClose(), true);
});
test('authorization loss after packaging refuses output and never leaks raw error details', async () => {
  const h = await harness(); await h.controller.refresh(); let requests = 0;
  h.get(async () => { if (++requests === 2) { h.active(false); throw new Error('PRIVATE_TOKEN'); } return h.capability; });
  assert.equal(await h.controller.prepareExport('contacts-csv', h.snapshot), null);
  assert.equal(h.controller.consumeExport({ filename: '', mime: '', text: '', readTime: '' }), null);
  assert.doesNotMatch(h.controller.getState().error, /PRIVATE_TOKEN/);
});
test('reentrant subscriber changes invalidate a newly prepared export before its ticket can escape', async () => {
  const h = await harness(); await h.controller.refresh(); let changed = false;
  h.controller.subscribe(state => { if (!state.exporting && state.notice.startsWith('التصدير') && !changed) { changed = true; h.controller.setTab('directory'); } });
  assert.equal(await h.controller.prepareExport('contacts-csv', h.snapshot), null);
});
test('captured subscriber transitions remain ordered even when an earlier observer changes the state', async () => {
  const h = await harness(), seen: string[] = []; let altered = false;
  h.controller.subscribe(state => { if (state.tab === 'directory' && !altered) { altered = true; h.controller.setTab('finance'); } });
  h.controller.subscribe(state => seen.push(state.tab)); h.controller.setTab('directory');
  assert.deepEqual(seen, ['finance', 'directory']); assert.equal(h.controller.getState().tab, 'finance');
});
test('invalid initial day fails without obtaining capabilities', () => {
  let calls = 0; assert.throws(() => createCloudClinicOverviewController({ initialDate: '2026-02-30', isActive: () => true, getSnapshot: async () => { calls++; throw new Error(); } })); assert.equal(calls, 0);
});

test('actual lifetime revocation clears a loaded snapshot and retained export without a new data read', async () => {
  const h = await harness(); await h.controller.refresh();
  const ticket = await h.controller.prepareExport('operational-json', h.snapshot); assert.ok(ticket);
  h.active(false); assert.equal(h.controller.canClose(), false);
  assert.equal(h.controller.getState().closed, true); assert.equal(h.controller.getState().snapshot, null);
  assert.equal(h.controller.consumeExport(ticket), null);
  h.active(true); assert.equal(await h.controller.refresh(), false, 'revoked controller cannot reopen');
});
test('reentrant lifetime callbacks cannot recurse or initiate reads during getState', async () => {
  let calls = 0, active = true;
  const controller = createCloudClinicOverviewController({ initialDate: '2026-10-13', isActive: () => {
    controller.getState(); return active;
  }, getSnapshot: async () => { calls++; throw new Error(); } });
  assert.equal(controller.getState().closed, false); assert.equal(calls, 0);
  active = false; assert.equal(controller.getState().closed, true); assert.equal(calls, 0);
});
