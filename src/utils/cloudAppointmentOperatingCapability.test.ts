import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudAppointmentOperatingCapability, type CloudAppointmentCapability } from './cloudAppointmentOperatingCapability';
import { CloudAppointmentError, type CloudAppointmentCommand } from './cloudAppointmentRepository';
import { CloudOperationIntentError, prepareCloudIntentCommand, type CloudOperationIntent } from './cloudOperationIntent';

const OP = '00000000-0000-4000-8000-000000000001', ID = '00000000-0000-4000-8000-000000000002';
const DATE = '2026-10-12', WHEN = `${DATE}T12:00:00.000Z`, UID = 'synthetic-owner';
function command(): CloudAppointmentCommand {
  return { operationId: OP, recordId: ID, expectedRevision: 0, createdAt: WHEN,
    data: { patientRecordId: null, patientName: 'Synthetic appointment', phone: '', date: DATE, time: '16:00',
      durationMinutes: 30, status: 'scheduled', reason: '', notes: '', doctorName: '', appointmentType: '', isFollowUp: false, isWalkIn: false } };
}
function intent(input = command(), status: CloudOperationIntent['status'] = 'prepared'): CloudOperationIntent {
  return { schemaVersion: 1, clinicId: 'main', recordId: input.operationId, operationId: input.operationId, actorUid: UID,
    kind: 'appointment', requestHash: 'a'.repeat(64), status, revision: status === 'prepared' ? 1 : 2, createdAt: input.createdAt,
    command: prepareCloudIntentCommand(input) };
}
function record() { return { schemaVersion: 1 as const, clinicId: 'main' as const, recordId: ID, revision: 1, lastOperationId: OP, data: command().data }; }
function day() { return { schemaVersion: 1 as const, clinicId: 'main' as const, recordId: DATE, revision: 1, lastOperationId: OP,
  slots: [{ recordId: ID, startMinute: 960, endMinute: 990 }] }; }
function deferred() {
  let resolve!: () => void; const promise = new Promise<void>(accept => { resolve = accept; }); return { promise, resolve };
}
function fixture() {
  let active = true, auth = 0;
  const calls: Array<{ method: string; input?: unknown }> = [];
  const state: { before?: () => Promise<void>; after?: () => Promise<void>; reply?: (value: any) => any } = {};
  async function action<T>(method: string, input: unknown, result: T): Promise<T> {
    calls.push({ method, input }); await state.after?.(); return state.reply ? state.reply(result) : result;
  }
  const raw: CloudAppointmentCapability = {
    repository: {
      get: key => action('get', key, record()), getDay: date => action('getDay', date, day()),
      listDayPage: input => action('listDayPage', input, { records: [record()], nextAfterId: input.limit === 1 ? ID : null }),
      commit: input => action('commit', input, { status: 'committed' as const, recordId: ID, revision: 1 }),
    },
    journal: {
      prepare: (kind, input, createdAt) => action('prepare', { kind, input, createdAt }, intent(input as unknown as CloudAppointmentCommand)),
      get: key => action('intentGet', key, intent()), cancel: key => action('cancel', key, intent(undefined, 'cancelled')),
      listPreparedPage: (kind, input) => action('prepared', { kind, input }, { records: [intent()], nextAfterId: input?.limit === 1 ? OP : null }),
      listHistoryPage: (kind, input) => action('history', { kind, input }, { records: [intent(undefined, 'committed')], nextAfterId: input?.limit === 1 ? OP : null }),
    },
  };
  const cap = createCloudAppointmentOperatingCapability({ capability: raw, actorUid: UID,
    requireActive: () => { if (!active) throw new Error('private-provider-message'); },
    authorizeOwner: async () => { auth++; await state.before?.(); } });
  return { cap, raw, calls, state, auth: () => auth, revoke: () => { active = false; } };
}
test('appointment operating facade is inert and exposes frozen bounded actions only', async () => {
  const h = fixture(); assert.equal(h.auth(), 0); assert.deepEqual(h.calls, []);
  assert.ok(Object.isFrozen(h.cap) && Object.isFrozen(h.cap.repository) && Object.isFrozen(h.cap.journal));
  await h.cap.repository.get(ID); await h.cap.repository.getDay(DATE); await h.cap.repository.listDayPage({ date: DATE });
  await h.cap.repository.commit(command()); await h.cap.journal.prepare('appointment', command(), WHEN);
  await h.cap.journal.get(OP); await h.cap.journal.cancel(OP); await h.cap.journal.listPreparedPage('appointment');
  await h.cap.journal.listHistoryPage!('appointment');
  assert.equal(h.auth(), 18); assert.equal(h.calls.length, 9);
});
test('command, nested data and bounded day queries are copied before delayed authorization', async () => {
  for (const method of ['commit', 'prepare', 'listDayPage', 'history'] as const) {
    const h = fixture(), gate = deferred(), input = command(), bounds = { date: DATE, limit: 2, afterId: null };
    h.state.before = () => gate.promise;
    const pending = method === 'commit' ? h.cap.repository.commit(input) : method === 'prepare' ? h.cap.journal.prepare('appointment', input, WHEN)
      : method === 'listDayPage' ? h.cap.repository.listDayPage(bounds) : h.cap.journal.listHistoryPage!('appointment', { limit: bounds.limit });
    input.data.notes = 'mutated'; input.expectedRevision = 90; bounds.date = '2026-10-13'; bounds.limit = 50;
    gate.resolve(); await pending;
    const captured = h.calls[0].input as any;
    if (method === 'commit' || method === 'prepare') assert.equal((method === 'prepare' ? captured.input : captured).data.notes, '');
    if (method === 'listDayPage') { assert.equal(captured.date, DATE); assert.equal(captured.limit, 2); }
    if (method === 'history') assert.equal(captured.input.limit, 2);
  }
});
test('retained actions deny current lease loss before adapters, and mask accepted late results', async () => {
  const h = fixture(); h.revoke();
  await assert.rejects(h.cap.repository.get(ID), /تعذر/); assert.deepEqual(h.calls, []);
  const late = fixture(), gate = deferred(); late.state.after = () => gate.promise;
  const pending = late.cap.repository.commit(command()), rejected = assert.rejects(pending, /تعذر/);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(late.calls.length, 1);
  late.revoke(); gate.resolve(); await rejected; // Accepted work is not claimed undone.
});
test('invalid commands, IDs, dates, kinds and hostile descriptors reject before authorization', async () => {
  const h = fixture(), proxy = new Proxy({}, { ownKeys() { throw new Error('private-provider-message'); } });
  for (const input of [{}, proxy]) {
    await assert.rejects(h.cap.repository.commit(input), error => !String(error).includes('private-provider-message'));
    await assert.rejects(h.cap.journal.prepare('appointment', input, WHEN));
  }
  for (const key of ['', OP + '\n']) { await assert.rejects(h.cap.repository.get(key)); await assert.rejects(h.cap.journal.cancel(key)); }
  for (const date of ['', '2026-02-30', DATE + '\n']) {
    await assert.rejects(h.cap.repository.getDay(date)); await assert.rejects(h.cap.repository.listDayPage({ date }));
  }
  for (const kind of ['contact', 'clinical', 'catalog'] as const) {
    await assert.rejects(h.cap.journal.prepare(kind, command(), WHEN)); await assert.rejects(h.cap.journal.listHistoryPage!(kind));
  }
  await assert.rejects(h.cap.journal.prepare('appointment', command(), `${DATE}T13:00:00.000Z`));
  for (const limit of [0, 51, 1.5]) await assert.rejects(h.cap.repository.listDayPage({ date: DATE, limit }));
  assert.equal(h.auth(), 0); assert.deepEqual(h.calls, []);
});
test('output records and day indices are detached and bound to requested paths', async () => {
  const h = fixture(), source = record(); h.state.reply = () => source;
  const copy = await h.cap.repository.get(ID); source.data.notes = 'changed-after-reply'; assert.equal(copy?.data.notes, '');
  for (const reply of [{ ...record(), recordId: OP }, { ...day(), recordId: '2026-10-13' }]) {
    h.state.reply = () => reply;
    await assert.rejects('slots' in reply ? h.cap.repository.getDay(DATE) : h.cap.repository.get(ID));
  }
});
test('commit acknowledgements cannot substitute another record, revision, schema or private provider error', async () => {
  for (const reply of [{ status: 'committed', recordId: OP, revision: 1 }, { status: 'committed', recordId: ID, revision: 2 },
    { status: 'committed', recordId: ID, revision: 1, secret: true }, null]) {
    const h = fixture(); h.state.reply = () => reply; await assert.rejects(h.cap.repository.commit(command()));
  }
  for (const error of [new Error('private-provider-message'), new Proxy({}, { getPrototypeOf() { throw new Error('private-provider-message'); } }),
    new CloudAppointmentError('conflict'), new CloudOperationIntentError('conflict')]) {
    const h = fixture(); h.state.after = async () => { throw error; };
    await assert.rejects(h.cap.repository.commit(command()), value => !String(value).includes('private-provider-message'));
  }
});
test('journal replies bind complete command, actor, kind, operation and timestamp before returning', async () => {
  for (const reply of [{ ...intent(), actorUid: 'other' }, { ...intent(), kind: 'clinical' }, { ...intent(), createdAt: `${DATE}T11:00:00.000Z` },
    intent({ ...command(), data: { ...command().data, notes: 'another-command' } }), { ...intent(), command: { operationId: OP } }]) {
    const h = fixture(); h.state.reply = () => reply; await assert.rejects(h.cap.journal.prepare('appointment', command(), WHEN));
  }
});
test('history cannot silently fall back to prepared-only when all-status recovery is missing', async () => {
  const h = fixture(); delete h.raw.journal.listHistoryPage;
  await assert.rejects(h.cap.journal.listHistoryPage!('appointment')); assert.deepEqual(h.calls, []);
});
test('history/day pages reject sparse, duplicate, cross-date, unbounded and incorrect cursor results', async () => {
  for (const method of ['history', 'listDayPage'] as const) {
    const item = method === 'history' ? intent() : record();
    const rows = [new Array(1), [item, item], [item], Array(51).fill(item)];
    for (const records of rows) {
      const h = fixture(); h.state.reply = () => ({ records, nextAfterId: OP });
      await assert.rejects(method === 'history' ? h.cap.journal.listHistoryPage!('appointment', { limit: 2 }) : h.cap.repository.listDayPage({ date: DATE, limit: 2 }));
    }
  }
  const h = fixture(); h.state.reply = () => ({ records: [intent(undefined, 'committed')], nextAfterId: null });
  await assert.rejects(h.cap.journal.listPreparedPage('appointment'));
  const page = fixture(); page.state.reply = () => ({ records: [{ ...record(), data: { ...record().data, date: '2026-10-13' } }], nextAfterId: null });
  await assert.rejects(page.cap.repository.listDayPage({ date: DATE }));
});
