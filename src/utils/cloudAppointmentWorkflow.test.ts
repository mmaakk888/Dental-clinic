import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createCloudAppointmentRepository, type CloudAppointmentAdapter, type CloudAppointmentCommand } from './cloudAppointmentRepository';
import { createCloudOperationIntentRepository, type CloudIntentAdapter } from './cloudOperationIntent';
import { loadCloudAppointmentDay } from './cloudAppointmentDaySnapshot';
import { createCloudAppointmentWorkspaceController } from './cloudAppointmentWorkspaceController';

const OWNER = 'synthetic-workflow-owner', DAY = '2026-10-12', OTHER_DAY = '2026-10-13', WHEN = '2026-10-12T08:00:00.000Z';
const id = (n: number) => `80000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const recordPath = (n = 1) => `clinics/main/appointmentRecords/${id(n)}`;
const dayPath = (date = DAY) => `clinics/main/appointmentDays/${date}`;
const command = (n = 1, revision = 0, patch: Partial<CloudAppointmentCommand['data']> = {}): CloudAppointmentCommand => ({
  operationId: id(100 + n), recordId: id(1), expectedRevision: revision, createdAt: WHEN,
  data: { patientRecordId: null, patientName: 'شخص مصطنع', phone: '201012345678', date: DAY, time: '10:00', durationMinutes: 30,
    status: 'scheduled', reason: '', notes: '', doctorName: '', appointmentType: '', isFollowUp: false, isWalkIn: false, ...patch },
});
function deferred() { let resolve!: () => void; const promise = new Promise<void>(accept => { resolve = accept; }); return { promise, resolve }; }
function harness() {
  const docs = new Map<string, any>(), calls: string[] = [];
  let active = true, serial = 400, tail = Promise.resolve();
  const fault = { lostPrepare: false, lostCommit: false, read: false };
  const hook: { read?: (path: string) => Promise<void> | void; beforeFactory?: () => Promise<void> | void; id?: () => void } = {};
  const adapter: CloudAppointmentAdapter & CloudIntentAdapter = {
    authorizeOwner: async () => { calls.push('authorize'); if (!active) throw new Error('PRIVATE_TOKEN'); return OWNER; },
    readRecord: async path => { calls.push(`read:${path}`); await hook.read?.(path); if (fault.read) throw new Error('PRIVATE_READ'); return structuredClone(docs.get(path) ?? null); },
    listDayPage: async (date, after, limit) => {
      calls.push(`page:${date}`); await hook.read?.(`page:${date}`);
      return [...docs].filter(([path, value]) => path.startsWith('clinics/main/appointmentRecords/') && value.data.date === date
        && (!after || value.recordId > after)).sort(([a], [b]) => a.localeCompare(b)).slice(0, limit)
        .map(([path, data]) => ({ id: path.split('/').at(-1), data: structuredClone(data) }));
    },
    listHistoryPage: async (kind, actor, after, limit) => [...docs]
      .filter(([path, value]) => path.startsWith('clinics/main/operationIntents/') && value.kind === kind && value.actorUid === actor
        && (!after || value.operationId > after)).sort(([a], [b]) => a.localeCompare(b)).slice(0, limit)
      .map(([path, data]) => ({ id: path.split('/').at(-1), data: structuredClone(data) })),
    runTransaction: async work => {
      const old = tail; let release!: () => void; tail = new Promise<void>(accept => { release = accept; }); await old;
      const staged = structuredClone(docs); let written = false, domain = false;
      try {
        const result = await work({ get: async path => { assert.equal(written, false); return structuredClone(staged.get(path) ?? null); },
          set: (path, value) => { written = true; domain ||= path.startsWith('clinics/main/appointmentRecords/'); staged.set(path, structuredClone(value)); calls.push(`write:${path}`); } });
        docs.clear(); for (const [path, value] of staged) docs.set(path, value);
        if (written && (domain ? fault.lostCommit : fault.lostPrepare)) {
          if (domain) fault.lostCommit = false; else fault.lostPrepare = false;
          throw new Error('PRIVATE_LOST_REPLY');
        }
        return result;
      } finally { release(); }
    },
  };
  const digest = async (text: string) => createHash('sha256').update(text).digest('hex');
  const repository = createCloudAppointmentRepository(adapter, { digest }), journal = createCloudOperationIntentRepository(adapter, { digest });
  const capability = { repository, journal };
  const controller = () => createCloudAppointmentWorkspaceController({ ownerUid: OWNER, initialDate: DAY,
    isActive: () => active, getCapability: async () => { calls.push('factory'); await hook.beforeFactory?.(); return capability; },
    newId: () => { hook.id?.(); calls.push('id'); return id(++serial); }, now: () => { calls.push('clock'); return WHEN; } });
  const seed = async (value = command()) => { await journal.prepare('appointment', value, value.createdAt); await repository.commit(value); };
  return { docs, calls, repository, journal, capability, fault, hook, controller, seed, close: () => { active = false; } };
}
test('appointment workspace construction and subscriptions are inert; explicit refresh proves empty day without seeds', async () => {
  const h = harness(), c = h.controller(); c.subscribe(() => undefined); assert.deepEqual(h.calls, []);
  assert.equal(await c.refresh(), true); assert.equal(c.getState().snapshot!.revision, 0);
  assert.deepEqual(c.getState().snapshot!.records, []); assert.equal(h.docs.size, 0);
  assert.equal(Object.isFrozen(c.getState().snapshot), true);
});
test('whole-day snapshot includes inactive bookings and reconciles only occupied slots', async () => {
  const h = harness(); await h.seed();
  await h.seed({ ...command(2, 0, { status: 'cancelled', time: '09:00' }), recordId: id(2) });
  const snapshot = await loadCloudAppointmentDay(h.repository, DAY);
  assert.equal(snapshot.revision, 2); assert.equal(snapshot.records.length, 2); assert.equal(snapshot.index!.slots.length, 1);
  assert.deepEqual(snapshot.records.map(record => record.data.status), ['cancelled', 'scheduled']);
});
test('complete loader traverses pages, not just first50 or reservation count', async () => {
  const h = harness();
  for (let i = 1; i <= 51; i++) await h.seed({ ...command(i, 0, { status: 'cancelled' }), recordId: id(i) });
  h.calls.length = 0; const snapshot = await loadCloudAppointmentDay(h.repository, DAY);
  assert.equal(snapshot.records.length, 51); assert.equal(snapshot.revision, 51);
  assert.equal(h.calls.filter(call => call === `page:${DAY}`).length, 2);
});
test('inactive edit or move during pagination advances fence and rejects mixed snapshot', async () => {
  for (const move of [false, true]) {
    const h = harness(); await h.seed(command(1, 0, { status: 'cancelled' }));
    let once = true;
    h.hook.read = async path => { if (once && path.startsWith('page:')) { once = false; await h.seed(command(2, 1,
      { status: 'cancelled', notes: 'تغيير أثناء القراءة', date: move ? OTHER_DAY : DAY })); } };
    await assert.rejects(loadCloudAppointmentDay(h.repository, DAY), error => error instanceof Error && 'code' in error && error.code === 'conflict');
  }
});
test('orphan histories, wrong reservations, malformed cursors and duplicate rows never become confirmed schedules', async () => {
  for (const scenario of ['missing-index', 'bad-slot', 'cursor', 'duplicate'] as const) {
    const h = harness(); await h.seed();
    if (scenario === 'missing-index') h.docs.delete(dayPath());
    if (scenario === 'bad-slot') h.docs.get(dayPath()).slots[0].startMinute++;
    const repo = scenario === 'cursor' ? { ...h.repository, listDayPage: async () => ({ records: [], nextAfterId: id(1) }) }
      : scenario === 'duplicate' ? { ...h.repository, listDayPage: async () => ({ records: [h.docs.get(recordPath()), h.docs.get(recordPath())], nextAfterId: null }) } : h.repository;
    await assert.rejects(loadCloudAppointmentDay(repo, DAY));
  }
});
test('draft appends nothing to server; raw incomplete fields survive failed save; stale edit callbacks are rejected', async () => {
  const h = harness(), c = h.controller(); await c.refresh(); assert.equal(c.beginNew(), true);
  const draft = c.getState().draft!; assert.equal(h.docs.size, 0); assert.equal(await c.save(draft), false);
  assert.equal(c.getState().draft, draft); assert.equal(c.updateDraft({ ...draft, data: { ...draft.data, patientName: 'جديد', time: '10:00', durationMinutes: '' } }, draft), true);
  assert.equal(c.updateDraft(draft, draft), false); assert.equal(c.cancelDraft(draft), false);
  assert.equal(await c.selectDate(OTHER_DAY), false); assert.equal(await c.refresh(), false);
  assert.equal(c.getState().draft!.data.durationMinutes, ''); assert.equal(h.docs.size, 0);
});
test('one save uses one retained ID/time, explicit normalized contact, journal and coherent full-day reload', async () => {
  const h = harness(), c = h.controller(); await c.refresh(); c.beginNew(); const draft = c.getState().draft!;
  c.updateDraft({ ...draft, data: { ...draft.data, patientName: ' اسم مصطنع ', phone: '01012345678', time: '10:00', durationMinutes: '٣٠' } }, draft);
  const source = c.getState().draft!; assert.equal(await c.save(source), true);
  assert.equal(c.getState().snapshot!.records.length, 1); assert.equal(c.getState().snapshot!.records[0].data.phone, '201012345678');
  assert.equal(c.getState().snapshot!.records[0].data.patientName, 'اسم مصطنع');
  assert.equal(c.getState().draft, null); assert.equal(h.calls.filter(call => call === 'id').length, 2);
  assert.equal(h.calls.filter(call => call === 'clock').length, 1); assert.equal(await c.save(source), false);
});
test('lost prepare or commit acknowledgement retains exact command and retry cannot duplicate records/slots/receipts', async () => {
  for (const phase of ['lostPrepare', 'lostCommit'] as const) {
    const h = harness(), c = h.controller(); await c.refresh(); c.beginNew(); const initial = c.getState().draft!;
    c.updateDraft({ ...initial, data: { ...initial.data, patientName: 'اسم مصطنع', time: '10:00' } }, initial);
    h.fault[phase] = true; assert.equal(await c.save(c.getState().draft!), false);
    const op = c.getState().pendingOperationId, count = h.calls.filter(call => call === 'id').length;
    assert.equal(c.getState().saveStatus, 'retry-required'); assert.equal(c.canClose(), false); assert.equal(c.beginNew(), false);
    assert.equal(await c.retry(), true); assert.equal(h.calls.filter(call => call === 'id').length, count);
    assert.equal(h.docs.get(dayPath()).slots.length, 1);
    assert.equal([...h.docs.keys()].filter(path => path.includes('/appointmentOperations/')).length, 1);
    assert.equal(h.docs.get(`clinics/main/operationIntents/${op}`).status, 'committed');
  }
});
test('acknowledged refresh retries only reads and preserves a later reschedule', async () => {
  const h = harness(), c = h.controller(); await c.refresh(); c.beginNew(); const initial = c.getState().draft!;
  c.updateDraft({ ...initial, data: { ...initial.data, patientName: 'اسم مصطنع', time: '10:00' } }, initial);
  h.fault.read = true; assert.equal(await c.save(c.getState().draft!), false);
  assert.equal(c.getState().saveStatus, 'refresh-required'); const writes = h.calls.filter(call => call.startsWith('write:')).length;
  assert.equal(await c.cancelPending(), false); h.fault.read = false;
  assert.equal(await c.retry(), true); assert.equal(h.calls.filter(call => call.startsWith('write:')).length, writes);
});
test('fresh controller finds committed lost reply and replays history without resurrecting newer moved appointment', async () => {
  const h = harness(); await h.seed(); await h.seed(command(2, 1, { date: OTHER_DAY, time: '12:00' }));
  const c = h.controller(), writes = h.calls.filter(call => call.startsWith('write:')).length;
  await c.loadHistory(); assert.equal(c.getState().history.length, 2);
  assert.equal(await c.resume(id(101)), true); assert.equal(c.getSelectedDate(), OTHER_DAY);
  assert.equal(c.getState().snapshot!.records[0].revision, 2);
  assert.equal(h.calls.filter(call => call.startsWith('write:')).length, writes);
  assert.deepEqual(h.docs.get(dayPath()).slots, []);
});
test('CAS conflict retains the original draft until confirmed cancel; no auto-rebase or replacement ID', async () => {
  const h = harness(); await h.seed(); const c = h.controller(); await c.refresh(); c.beginEdit(c.getState().snapshot!.records[0]);
  const draft = c.getState().draft!; c.updateDraft({ ...draft, data: { ...draft.data, notes: 'مسودة قديمة' } }, draft);
  await h.seed(command(2, 1, { notes: 'تعديل جهاز آخر' }));
  assert.equal(await c.save(c.getState().draft!), false); assert.equal(c.getState().draft!.expectedRevision, 1);
  assert.equal(await c.cancelPending(), true); assert.equal(c.getState().loaded, false);
  await c.refresh(); assert.equal(c.getState().snapshot!.records[0].data.notes, 'تعديل جهاز آخر');
});
test('logout/disposal rejects delayed refresh results forever, including same-owner re-entry', async () => {
  const h = harness(), gate = deferred(), c = h.controller(); h.hook.beforeFactory = () => gate.promise;
  const pending = c.refresh(); h.close(); gate.resolve(); assert.equal(await pending, false);
  assert.equal(c.getState().closed, true); assert.equal(c.getState().snapshot, null); assert.equal(await c.refresh(), false);
});
test('reentrant subscribers receive captured transition and cannot close during acknowledged refresh', async () => {
  const h = harness(), c = h.controller(), delivered: string[] = []; await c.refresh();
  c.subscribe(state => { if (state.draft) c.dispose(); });
  c.subscribe(state => delivered.push(state.closed ? 'closed' : state.draft ? 'draft' : 'idle'));
  assert.equal(c.beginNew(), false); assert.deepEqual(delivered, ['closed', 'draft']); assert.equal(c.getState().closed, true);
});
test('identity loss during injected ID generation cannot publish or save a late draft', async () => {
  const h = harness(), c = h.controller(); await c.refresh(); h.hook.id = h.close;
  assert.equal(c.beginNew(), false); assert.equal(c.getState().closed, true); assert.equal(h.docs.size, 0);
});
