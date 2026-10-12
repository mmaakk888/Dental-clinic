import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createCloudOperationIntentRepository, type CloudIntentAdapter } from './cloudOperationIntent';
import { CloudAppointmentError, createCloudAppointmentRepository, prepareCloudAppointmentCommand,
  parseCloudAppointmentRecord, parseCloudAppointmentDay, prepareCloudAppointmentDayPageInput, MAX_CLOUD_APPOINTMENT_DAY_SLOTS,
  type CloudAppointmentAdapter, type CloudAppointmentCommand, type CloudAppointmentData } from './cloudAppointmentRepository';

// Isolated fabricated atomic store. These tests never access Firebase/Auth,
// production data, patient credentials, local browser storage or real clocks.
const OWNER = 'synthetic-appointment-owner', WHEN = '2026-10-12T00:00:00.000Z', DAY = '2026-10-13', OTHER_DAY = '2026-10-14';
const id = (value: number) => `40000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const recordPath = (recordId = id(101)) => `clinics/main/appointmentRecords/${recordId}`;
const dayPath = (date = DAY) => `clinics/main/appointmentDays/${date}`;
const operation = (number: number) => `clinics/main/appointmentOperations/${id(number)}`;
const intentPath = (number: number) => `clinics/main/operationIntents/${id(number)}`;
const digest = async (value: string) => createHash('sha256').update(value).digest('hex');
const data = (changes: Partial<CloudAppointmentData> = {}): CloudAppointmentData => ({ patientRecordId: null,
  patientName: 'مريض مصطنع', phone: '201012345678', date: DAY, time: '10:00', durationMinutes: 30,
  status: 'scheduled', reason: 'متابعة', notes: '', doctorName: '', appointmentType: 'متابعة',
  isFollowUp: true, isWalkIn: false, ...changes });
const command = (number = 1, expectedRevision = 0, changes: Partial<CloudAppointmentData> = {}, recordId = id(101)): CloudAppointmentCommand => ({
  operationId: id(number), recordId, expectedRevision, createdAt: WHEN, data: data(changes),
});
const record = (changes: Record<string, unknown> = {}) => ({ schemaVersion: 1, clinicId: 'main', recordId: id(101),
  revision: 1, lastOperationId: id(1), data: data(), ...changes });
const day = (changes: Record<string, unknown> = {}) => ({ schemaVersion: 1, clinicId: 'main', recordId: DAY,
  revision: 1, lastOperationId: id(1), slots: [{ recordId: id(101), startMinute: 600, endMinute: 630 }], ...changes });
const profile = (recordId = id(501), changes: Record<string, unknown> = {}) => ({ schemaVersion: 1, clinicId: 'main', recordId,
  fileNo: 401, revision: 1, lastOperationId: id(500), phoneKey: null,
  data: { name: 'مريض مصطنع', mobile: '', age: 30, gender: '', firstVisit: '2026-10-12', notes: '', allergy: '' }, ...changes });
const code = (expected: CloudAppointmentError['code']) => (value: unknown) => value instanceof CloudAppointmentError && value.code === expected;
function deferred() { let resolve!: () => void; const promise = new Promise<void>(accept => { resolve = accept; }); return { resolve, promise }; }
function harness() {
  const docs = new Map<string, any>(), calls: string[] = [];
  let uid = OWNER, tail = Promise.resolve(), writes = 0, authCount = 0;
  const faults = { lostCommitReply: false, retry: false, failWriteAt: 0 };
  const hooks: { auth?: (count: number) => Promise<void> | void; read?: (path: string) => void; afterCommit?: () => void } = {};
  const adapter: CloudAppointmentAdapter & CloudIntentAdapter = {
    authorizeOwner: async () => { calls.push('auth'); await hooks.auth?.(++authCount); return uid; },
    readRecord: async path => { calls.push(`read:${path}`); hooks.read?.(path); return structuredClone(docs.get(path) ?? null); },
    listDayPage: async (date, afterId, limit) => {
      calls.push(`list:${date}:${afterId}:${limit}`); hooks.read?.(`list:${date}`);
      return [...docs].filter(([path, value]) => path.startsWith('clinics/main/appointmentRecords/') && value.data.date === date
        && (!afterId || value.recordId > afterId)).sort(([a], [b]) => a < b ? -1 : 1).slice(0, limit)
        .map(([path, value]) => ({ id: path.split('/').at(-1), data: structuredClone(value) }));
    },
    runTransaction: async work => {
      const previous = tail; let release!: () => void;
      tail = new Promise<void>(accept => { release = accept; }); await previous;
      const attempt = async (publish: boolean) => {
        const staged = structuredClone(docs); let wrote = false, isDomainCommit = false;
        const result = await work({
          get: async path => { assert.equal(wrote, false, 'all reads precede all writes'); calls.push(`get:${path}`);
            hooks.read?.(path); return structuredClone(staged.get(path) ?? null); },
          set: (path, value) => { wrote = true; calls.push(`set:${path}`);
            if (++writes === faults.failWriteAt) throw new Error('PRIVATE_WRITE_DETAILS');
            isDomainCommit ||= path.startsWith('clinics/main/appointmentRecords/'); staged.set(path, structuredClone(value)); },
        });
        if (publish) { docs.clear(); for (const [path, value] of staged) docs.set(path, value); }
        if (publish && isDomainCommit) {
          hooks.afterCommit?.();
          if (faults.lostCommitReply) { faults.lostCommitReply = false; throw new Error('PRIVATE_LOST_ACK'); }
        }
        return result;
      };
      try { if (faults.retry) { faults.retry = false; await attempt(false); } return await attempt(true); }
      finally { release(); }
    },
  };
  const repo = createCloudAppointmentRepository(adapter, { digest }), journal = createCloudOperationIntentRepository(adapter, { digest });
  return { docs, calls, adapter, repo, journal, hooks, faults, owner: (value: string) => { uid = value; }, writes: () => writes,
    prepare: (value: CloudAppointmentCommand) => journal.prepare('appointment', prepareCloudAppointmentCommand(value), value.createdAt),
    client: () => createCloudAppointmentRepository(adapter, { digest }),
    async commit(value: CloudAppointmentCommand) { await this.prepare(value); return repo.commit(value); } };
}

test('appointment repository construction is inert and missing records/days stay unknown without seeding', async () => {
  const h = harness(); assert.deepEqual(h.calls, []);
  assert.equal(await h.repo.get(id(101)), null); assert.equal(await h.repo.getDay(DAY), null);
  assert.equal(h.docs.size, 0); assert.equal(h.writes(), 0);
});
test('get and getDay fail closed without read capability and accept only UUID/canonical date paths', async () => {
  const h = harness(); delete h.adapter.readRecord;
  await assert.rejects(h.repo.get(id(101)), code('unavailable')); await assert.rejects(h.repo.getDay(DAY), code('unavailable'));
  for (const value of ['bad', '../patients', 'A0000000-0000-4000-8000-000000000001', '', '2026-02-30', '2026-10-13T00:00:00.000Z']) {
    await assert.rejects(h.repo.get(value), code('invalid')); await assert.rejects(h.repo.getDay(value), code('invalid'));
  }
  assert.equal(h.docs.size, 0);
});
test('first explicit reservation atomically writes appointment/day/immutable receipt/committed intent only', async () => {
  const h = harness(), input = command(); await h.prepare(input); const before = h.writes();
  assert.deepEqual(await h.repo.commit(input), { status: 'committed', recordId: id(101), revision: 1 });
  assert.equal(h.writes() - before, 4); assert.equal(h.docs.size, 4);
  assert.deepEqual(await h.repo.get(id(101)), record()); assert.deepEqual(await h.repo.getDay(DAY), day());
  assert.equal(h.docs.get(intentPath(1)).status, 'committed'); assert.equal(h.docs.get(operation(1)).actorUid, OWNER);
  assert.doesNotMatch(JSON.stringify(h.docs.get(operation(1))), /patientName|phone|duration|notes|fileNo|price|payment/);
});
test('all occupied states reserve time and all inactive states preserve record without inventing a day', async () => {
  for (const status of ['scheduled', 'confirmed', 'waiting', 'attended'] as const) {
    const h = harness(); await h.commit(command(1, 0, { status })); assert.equal(h.docs.get(dayPath()).slots.length, 1);
  }
  for (const status of ['cancelled', 'apologized', 'no_show'] as const) {
    const h = harness(); await h.commit(command(1, 0, { status })); assert.equal(h.docs.has(dayPath()), false);
    assert.equal(h.docs.get(recordPath()).data.status, status); assert.equal(h.docs.size, 3);
  }
});
test('lost acknowledgement retries the identical receipt without changing day revision or duplicating a reservation', async () => {
  const h = harness(), input = command(); await h.prepare(input); h.faults.lostCommitReply = true;
  await assert.rejects(h.repo.commit(input), code('unavailable')); assert.equal(h.docs.get(dayPath()).revision, 1);
  const before = structuredClone(h.docs), writes = h.writes();
  assert.deepEqual(await h.repo.commit(input), { status: 'already-committed', recordId: id(101), revision: 1 });
  assert.deepEqual(h.docs, before); assert.equal(h.writes(), writes);
});
test('historical replay reads only receipt and matching committed intent, never newer appointment/day/profile', async () => {
  const h = harness(), original = command(); await h.commit(original);
  await h.commit(command(2, 1, { date: OTHER_DAY, time: '11:00' }));
  await h.commit(command(3, 2, { date: OTHER_DAY, status: 'cancelled' }));
  h.docs.delete(recordPath()); h.docs.delete(dayPath()); h.docs.delete(dayPath(OTHER_DAY));
  const before = structuredClone(h.docs); h.calls.length = 0;
  assert.deepEqual(await h.repo.commit(original), { status: 'already-committed', recordId: id(101), revision: 1 });
  assert.deepEqual(h.calls.filter(value => value.startsWith('get:')), [`get:${operation(1)}`, `get:${intentPath(1)}`]);
  assert.deepEqual(h.docs, before);
});
test('same operation cannot change time, data, target, expected revision, owner or independent journal time', async () => {
  const h = harness(), input = command(); await h.commit(input); const before = structuredClone(h.docs);
  for (const changed of [{ ...command(), createdAt: '2026-10-12T00:00:00.001Z' }, command(1, 1),
    command(1, 0, { time: '11:00' }), command(1, 0, {}, id(102)), command(1, 0, { notes: 'تغيير' })]) {
    await assert.rejects(h.repo.commit(changed), code('conflict'));
  }
  h.owner('another-synthetic-owner'); await assert.rejects(h.repo.commit(input), code('conflict')); assert.deepEqual(h.docs, before);
  const x = harness(); await x.journal.prepare('appointment', input, '2026-10-12T00:00:00.001Z');
  await assert.rejects(x.repo.commit(input), code('conflict')); assert.equal(x.docs.has(recordPath()), false);
});
test('prepared exact owner/kind/body journal is mandatory and a committed intent alone is not proof of save', async () => {
  const h = harness(); await assert.rejects(h.repo.commit(command())); assert.equal(h.docs.size, 0);
  for (const change of [
    (value: any) => { value.status = 'cancelled'; value.revision = 2; },
    (value: any) => { value.status = 'committed'; value.revision = 2; },
    (value: any) => { value.kind = 'contact'; }, (value: any) => { value.actorUid = 'another-owner'; },
    (value: any) => { value.requestHash = '0'.repeat(64); }, (value: any) => { value.command.data.durationMinutes++; },
  ]) {
    const x = harness(); await x.prepare(command()); change(x.docs.get(intentPath(1))); const before = structuredClone(x.docs);
    await assert.rejects(x.repo.commit(command())); assert.deepEqual(x.docs, before);
  }
});
test('receipt collision, missing intent or changed historical envelope is never overwritten', async () => {
  for (const change of [
    (h: ReturnType<typeof harness>) => { h.docs.get(operation(1)).extra = true; },
    (h: ReturnType<typeof harness>) => { h.docs.get(operation(1)).resultRevision++; },
    (h: ReturnType<typeof harness>) => { h.docs.get(operation(1)).requestHash = '0'.repeat(64); },
    (h: ReturnType<typeof harness>) => { h.docs.get(operation(1)).createdAt = '2026-10-12T00:00:00.001Z'; },
    (h: ReturnType<typeof harness>) => { h.docs.delete(intentPath(1)); },
    (h: ReturnType<typeof harness>) => { h.docs.get(intentPath(1)).status = 'prepared'; h.docs.get(intentPath(1)).revision = 1; },
  ]) {
    const h = harness(); await h.commit(command()); change(h); const before = structuredClone(h.docs);
    await assert.rejects(h.repo.commit(command())); assert.deepEqual(h.docs, before);
  }
});
test('two competing clients cannot both reserve overlapping times on the same day', async () => {
  const h = harness(), a = command(), b = command(2, 0, { time: '10:15' }, id(102)); await h.prepare(a); await h.prepare(b);
  const results = await Promise.allSettled([h.repo.commit(a), h.client().commit(b)]);
  assert.equal(results.filter(value => value.status === 'fulfilled').length, 1);
  assert.equal(code('conflict')((results.find(value => value.status === 'rejected') as PromiseRejectedResult).reason), true);
  assert.equal(h.docs.get(dayPath()).slots.length, 1); assert.equal([...h.docs.keys()].filter(path => path.includes('/appointmentOperations/')).length, 1);
});
test('adjacent intervals and same clock time on different days are allowed; overlapping containment is rejected', async () => {
  const h = harness(); await h.commit(command()); await h.commit(command(2, 0, { time: '10:30' }, id(102)));
  await h.commit(command(3, 0, { date: OTHER_DAY }, id(103))); assert.equal(h.docs.get(dayPath()).slots.length, 2);
  for (const [index, time, durationMinutes] of [[4, '09:50', 15], [5, '10:00', 90], [6, '10:15', 1], [7, '09:00', 180]] as const) {
    const input = command(index, 0, { time, durationMinutes }, id(100 + index)); await h.prepare(input); const before = structuredClone(h.docs);
    await assert.rejects(h.repo.commit(input), code('conflict')); assert.deepEqual(h.docs, before);
  }
});
test('same-day rescheduling releases the original slot and updates the index once with exact new interval', async () => {
  const h = harness(); await h.commit(command()); const before = h.writes();
  await h.commit(command(2, 1, { time: '11:00', durationMinutes: 45 }));
  assert.equal(h.writes() - before, 5); // intent preparation + four atomic domain writes
  assert.deepEqual(h.docs.get(dayPath()).slots, [{ recordId: id(101), startMinute: 660, endMinute: 705 }]);
  assert.equal(h.docs.get(dayPath()).revision, 2); assert.equal(h.docs.get(recordPath()).revision, 2);
  await h.commit(command(3, 0, { time: '10:00' }, id(102)));
});
test('moving between days releases/reserves both indices atomically and retains the empty old day', async () => {
  const h = harness(); await h.commit(command()); const before = h.writes();
  await h.commit(command(2, 1, { date: OTHER_DAY }));
  assert.equal(h.writes() - before, 6); assert.deepEqual(h.docs.get(dayPath()).slots, []);
  assert.equal(h.docs.get(dayPath()).revision, 2); assert.equal(h.docs.get(dayPath(OTHER_DAY)).revision, 1);
  assert.deepEqual(h.docs.get(dayPath(OTHER_DAY)).slots, [{ recordId: id(101), startMinute: 600, endMinute: 630 }]);
});
test('conflicting reschedule does not release the old day or change either appointment/index', async () => {
  const h = harness(); await h.commit(command()); await h.commit(command(2, 0, { date: OTHER_DAY }, id(102)));
  const input = command(3, 1, { date: OTHER_DAY }); await h.prepare(input); const before = structuredClone(h.docs);
  await assert.rejects(h.repo.commit(input), code('conflict')); assert.deepEqual(h.docs, before);
});
test('cancellation/no-show/apology releases existing reservation and reactivation reserves it again', async () => {
  for (const status of ['cancelled', 'apologized', 'no_show'] as const) {
    const h = harness(); await h.commit(command()); await h.commit(command(2, 1, { status }));
    assert.deepEqual(h.docs.get(dayPath()).slots, []); assert.equal(h.docs.get(dayPath()).revision, 2);
    await h.commit(command(3, 2, { status: 'confirmed' })); assert.equal(h.docs.get(dayPath()).revision, 3);
    assert.equal(h.docs.get(dayPath()).slots.length, 1);
  }
});
test('editing inactive appointment changes no day, while changing occupied metadata advances one day revision', async () => {
  const h = harness(); await h.commit(command(1, 0, { status: 'cancelled' }));
  await h.commit(command(2, 1, { status: 'cancelled', date: OTHER_DAY, notes: 'ملاحظة' }));
  assert.equal([...h.docs.keys()].some(path => path.includes('/appointmentDays/')), false);
  const x = harness(); await x.commit(command()); await x.commit(command(2, 1, { notes: 'ملاحظة' }));
  assert.equal(x.docs.get(dayPath()).revision, 2);
});
test('record revision CAS rejects stale edits and does not recreate a missing update target', async () => {
  const h = harness(); await h.commit(command()); const stale = command(2, 0); await h.prepare(stale); const before = structuredClone(h.docs);
  await assert.rejects(h.repo.commit(stale), code('conflict')); assert.deepEqual(h.docs, before);
  const x = harness(), missing = command(2, 1); await x.prepare(missing); const empty = structuredClone(x.docs);
  await assert.rejects(x.repo.commit(missing), code('conflict')); assert.deepEqual(x.docs, empty);
});
test('occupied old reservation must exist and match date, UUID, start/end exactly before replacement', async () => {
  for (const corrupt of [
    (h: ReturnType<typeof harness>) => { h.docs.delete(dayPath()); },
    (h: ReturnType<typeof harness>) => { h.docs.get(dayPath()).slots = []; },
    (h: ReturnType<typeof harness>) => { h.docs.get(dayPath()).slots[0].startMinute++; },
    (h: ReturnType<typeof harness>) => { h.docs.get(dayPath()).slots[0].endMinute++; },
    (h: ReturnType<typeof harness>) => { h.docs.get(dayPath()).slots[0].recordId = id(102); },
    (h: ReturnType<typeof harness>) => { h.docs.get(dayPath()).recordId = OTHER_DAY; },
  ]) {
    const h = harness(); await h.commit(command()); corrupt(h); const input = command(2, 1, { date: OTHER_DAY }); await h.prepare(input);
    const before = structuredClone(h.docs); await assert.rejects(h.repo.commit(input), code('invalid')); assert.deepEqual(h.docs, before);
  }
});
test('stray own reservations on inactive/new/wrong-day targets are corruption, not silently repaired', async () => {
  for (const scenario of ['create', 'inactive', 'other-day'] as const) {
    const h = harness(); let input = command();
    if (scenario === 'inactive') { await h.commit(command(1, 0, { status: 'cancelled' })); input = command(2, 1); }
    if (scenario === 'other-day') { await h.commit(command()); input = command(2, 1, { date: OTHER_DAY }); }
    const date = scenario === 'other-day' ? OTHER_DAY : DAY; h.docs.set(dayPath(date), day({ recordId: date }));
    await h.prepare(input); const before = structuredClone(h.docs);
    await assert.rejects(h.repo.commit(input), code('invalid')); assert.deepEqual(h.docs, before);
  }
});
test('optional linked UUID must name a fresh valid profile; no profile/counter/file number is created or updated', async () => {
  const h = harness(), input = command(1, 0, { patientRecordId: id(501) }); await h.prepare(input); const before = structuredClone(h.docs);
  await assert.rejects(h.repo.commit(input), code('conflict')); assert.deepEqual(h.docs, before);
  h.docs.set(`clinics/main/patientProfiles/${id(501)}`, profile()); await h.repo.commit(input);
  assert.equal(h.docs.get(`clinics/main/patientProfiles/${id(501)}`).revision, 1);
  assert.equal(h.calls.filter(call => call.startsWith('set:') && /patient|counter/i.test(call)).length, 0);
  for (const raw of [profile(id(502)), { revision: 1 }, profile(id(501), { fileNo: '401' }), profile(id(501), { clinicId: 'other' })]) {
    const x = harness(); x.docs.set(`clinics/main/patientProfiles/${id(501)}`, raw); await x.prepare(input); const state = structuredClone(x.docs);
    await assert.rejects(x.repo.commit(input), code('invalid')); assert.deepEqual(x.docs, state);
  }
});
test('profile-linked historical replay still succeeds after the linked profile is no longer readable', async () => {
  const h = harness(), input = command(1, 0, { patientRecordId: id(501) }); h.docs.set(`clinics/main/patientProfiles/${id(501)}`, profile());
  await h.commit(input); h.docs.delete(`clinics/main/patientProfiles/${id(501)}`); h.calls.length = 0;
  assert.equal((await h.repo.commit(input)).status, 'already-committed');
  assert.equal(h.calls.some(call => /get:.*patientProfiles/.test(call)), false);
});
test('linked profile changes do not rewrite explicit historical name or alternate appointment contact snapshots', async () => {
  const h = harness(), input = command(1, 0, { patientRecordId: id(501), patientName: 'اسم وقت الحجز', phone: '12025550123' });
  h.docs.set(`clinics/main/patientProfiles/${id(501)}`, profile()); await h.commit(input);
  const currentProfile = h.docs.get(`clinics/main/patientProfiles/${id(501)}`); currentProfile.data.name = 'اسم أحدث'; currentProfile.revision++;
  const saved = await h.repo.get(id(101)); assert.equal(saved?.data.patientName, 'اسم وقت الحجز'); assert.equal(saved?.data.phone, '12025550123');
  assert.equal(saved?.data.patientRecordId, id(501)); assert.equal(Object.hasOwn(saved!.data, 'fileNo'), false);
});
test('callback retries publish one reservation/revision and immutable receipt only', async () => {
  const h = harness(), input = command(); await h.prepare(input); h.faults.retry = true; await h.repo.commit(input);
  assert.equal(h.docs.size, 4); assert.equal(h.docs.get(recordPath()).revision, 1); assert.equal(h.docs.get(dayPath()).revision, 1);
});
test('failure at every create or cross-day write leaves all domain state and prepared intent unchanged', async () => {
  for (const position of [1, 2, 3, 4]) {
    const h = harness(), input = command(); await h.prepare(input); const before = structuredClone(h.docs);
    h.faults.failWriteAt = h.writes() + position; await assert.rejects(h.repo.commit(input), code('unavailable')); assert.deepEqual(h.docs, before);
  }
  for (const position of [1, 2, 3, 4, 5]) {
    const h = harness(); await h.commit(command()); const input = command(2, 1, { date: OTHER_DAY }); await h.prepare(input);
    const before = structuredClone(h.docs); h.faults.failWriteAt = h.writes() + position;
    await assert.rejects(h.repo.commit(input), code('unavailable')); assert.deepEqual(h.docs, before);
  }
});
test('owner loss after any domain read denies all writes; after acceptance it hides ACK but does not claim rollback', async () => {
  for (const path of [operation(1), intentPath(1), recordPath(), dayPath(), `clinics/main/patientProfiles/${id(501)}`]) {
    const h = harness(), input = command(1, 0, { patientRecordId: id(501) }); h.docs.set(`clinics/main/patientProfiles/${id(501)}`, profile());
    await h.prepare(input); const before = structuredClone(h.docs); h.hooks.read = current => { if (current === path) h.owner('changed-owner'); };
    await assert.rejects(h.repo.commit(input), code('unavailable')); assert.deepEqual(h.docs, before);
  }
  const x = harness(), input = command(); await x.prepare(input); x.hooks.afterCommit = () => x.owner('changed-owner');
  await assert.rejects(x.repo.commit(input), code('unavailable')); assert.equal(x.docs.get(recordPath()).revision, 1);
  x.hooks.afterCommit = undefined; x.owner(OWNER); assert.equal((await x.repo.commit(input)).status, 'already-committed');
});
test('get/getDay reauthorize server reads and return detached validated snapshots with matching path IDs', async () => {
  const h = harness(); h.docs.set(recordPath(), record()); h.docs.set(dayPath(), day());
  const snapshot = await h.repo.get(id(101)), index = await h.repo.getDay(DAY);
  snapshot!.data.notes = 'تعديل'; index!.slots[0].startMinute++;
  assert.equal(h.docs.get(recordPath()).data.notes, ''); assert.equal(h.docs.get(dayPath()).slots[0].startMinute, 600);
  for (const read of [() => h.repo.get(id(101)), () => h.repo.getDay(DAY)]) {
    h.owner(OWNER); h.hooks.read = () => h.owner('changed-owner'); await assert.rejects(read(), code('unavailable'));
  }
  const x = harness(); x.docs.set(recordPath(), record({ recordId: id(102) })); x.docs.set(dayPath(), day({ recordId: OTHER_DAY }));
  await assert.rejects(x.repo.get(id(101)), code('invalid')); await assert.rejects(x.repo.getDay(DAY), code('invalid'));
});
test('commands are deeply snapshotted before first authorization await and no caller mutation changes a commit', async () => {
  const h = harness(), input = command(), expected = structuredClone(input); await h.prepare(expected);
  const started = deferred(), gate = deferred(); let first = true;
  h.hooks.auth = async () => { if (first) { first = false; started.resolve(); await gate.promise; } };
  const pending = h.repo.commit(input); await started.promise;
  input.data.time = '11:00'; input.data.date = OTHER_DAY; input.data.notes = 'تغيير'; input.operationId = id(99); input.expectedRevision = 8;
  gate.resolve(); await pending; assert.deepEqual((await h.repo.get(id(101)))?.data, expected.data); assert.equal(h.docs.has(operation(99)), false);
});
test('record/command/day parsers detach input, preserve explicit fields and never infer file identity or status', () => {
  const input = command(), snapshot = prepareCloudAppointmentCommand(input); input.data.notes = 'تغيير'; assert.equal(snapshot.data.notes, '');
  const stored = record(), parsed = parseCloudAppointmentRecord(stored); stored.data.status = 'cancelled'; assert.equal(parsed.data.status, 'scheduled');
  const slots = day(), parsedDay = parseCloudAppointmentDay(slots); slots.slots[0].endMinute++; assert.equal(parsedDay.slots[0].endMinute, 630);
  assert.equal(prepareCloudAppointmentCommand(command(1, 0, { phone: '', doctorName: '', appointmentType: '', reason: '', notes: '\n' })).data.phone, '');
});
test('canonical time/day and duration bounds accept end-at-midnight/full day but reject overflow and impossible dates', () => {
  for (const value of [{ time: '00:00', durationMinutes: 1440 }, { time: '23:59', durationMinutes: 1 }, { date: '2028-02-29' }]) {
    assert.doesNotThrow(() => prepareCloudAppointmentCommand(command(1, 0, value)));
  }
  for (const value of [{ time: '24:00' }, { time: '9:00' }, { time: '09:60' }, { time: '23:59', durationMinutes: 2 },
    { time: '00:01', durationMinutes: 1440 }, { durationMinutes: 0 }, { durationMinutes: -0 }, { durationMinutes: 1.5 },
    { durationMinutes: '30' }, { durationMinutes: NaN }, { date: '2026-02-29' }, { date: '2026-02-30' },
    { date: '2026-10-13T00:00:00Z' }, { date: '1899-12-31' }]) {
    assert.throws(() => prepareCloudAppointmentCommand(command(1, 0, value as any)), code('invalid'));
  }
});
test('command UTC time is exact, revision cannot exhaust/reset and identifiers are strict lowercase UUIDv4', () => {
  for (const createdAt of ['2026-10-12', '2026-10-12T00:00:00Z', '2026-10-12T00:00:00.000+00:00', '2026-02-30T00:00:00.000Z', '1899-01-01T00:00:00.000Z']) {
    assert.throws(() => prepareCloudAppointmentCommand({ ...command(), createdAt }), code('invalid'));
  }
  for (const expectedRevision of [-0, -1, 0.5, '0', NaN, 2_000_000_000]) {
    assert.throws(() => prepareCloudAppointmentCommand({ ...command(), expectedRevision }), code('invalid'));
  }
  for (const value of ['bad', id(1).replace('-4000-', '-1000-'), id(1).replace('-8000-', '-0000-')]) {
    assert.throws(() => prepareCloudAppointmentCommand({ ...command(), operationId: value }), code('invalid'));
    assert.throws(() => prepareCloudAppointmentCommand({ ...command(), recordId: value }), code('invalid'));
    assert.throws(() => prepareCloudAppointmentCommand(command(1, 0, { patientRecordId: value })), code('invalid'));
  }
});
test('canonical phone is validated rather than silently reformatted or linked to another file', () => {
  for (const phone of ['', '201012345678', '12025550123']) assert.equal(prepareCloudAppointmentCommand(command(1, 0, { phone })).data.phone, phone);
  for (const phone of ['01012345678', '+201012345678', '2010 12345678', '٢٠١٠١٢٣٤٥٦٧٨', '2010123', '2010123456789', 123, null]) {
    assert.throws(() => prepareCloudAppointmentCommand(command(1, 0, { phone } as any)), code('invalid'));
  }
});
test('bounded text/enums/booleans and exact fields reject controls, unknown coercions and privacy data', () => {
  assert.equal(prepareCloudAppointmentCommand(command(1, 0, { patientName: 'أ'.repeat(200), notes: 'أ'.repeat(4000) })).data.notes.length, 4000);
  for (const changes of [{ patientName: '' }, { patientName: ' اسم' }, { patientName: 'أ'.repeat(201) }, { notes: 'أ'.repeat(4001) },
    { notes: 'نص\u202e' }, { patientName: '\ud800' }, { doctorName: 'أ'.repeat(201) }, { appointmentType: 'أ'.repeat(81) },
    { reason: 'أ'.repeat(201) }, { status: 'unknown' }, { status: 1 }, { isWalkIn: 0 }, { isFollowUp: 'false' },
    { fileNo: 401 }, { laboratoryCost: 100 }, { reminderSent: true }]) {
    assert.throws(() => prepareCloudAppointmentCommand({ ...command(), data: { ...data(), ...changes } }), code('invalid'));
  }
  for (const change of [{ schemaVersion: 2 }, { clinicId: 'other' }, { revision: 0 }, { revision: 2_000_000_001 }, { extra: true }, { lastOperationId: 'bad' }]) {
    assert.throws(() => parseCloudAppointmentRecord({ ...record(), ...change }), code('invalid'));
  }
});
test('day index accepts exactly 200 UUID-sorted non-overlapping slots, never truncates capacity', async () => {
  const slots = Array.from({ length: 200 }, (_, index) => ({ recordId: id(1000 + index), startMinute: index * 2, endMinute: index * 2 + 1 }));
  assert.equal(MAX_CLOUD_APPOINTMENT_DAY_SLOTS, 200); assert.equal(parseCloudAppointmentDay(day({ slots })).slots.length, 200);
  assert.throws(() => parseCloudAppointmentDay(day({ slots: [...slots, { recordId: id(1200), startMinute: 500, endMinute: 501 }] })), code('invalid'));
  const h = harness(); h.docs.set(dayPath(), day({ slots })); const input = command(); await h.prepare(input); const before = structuredClone(h.docs);
  await assert.rejects(h.repo.commit(input), code('conflict')); assert.deepEqual(h.docs, before);
});
test('day index rejects duplicate/reversed UUIDs, overlaps, sparse/accessor arrays and malformed slot envelopes', () => {
  const own = day().slots[0], other = { recordId: id(102), startMinute: 630, endMinute: 640 };
  assert.doesNotThrow(() => parseCloudAppointmentDay(day({ slots: [own, other] })));
  for (const slots of [[own, own], [other, own], [own, { ...other, startMinute: 629 }], [{ ...own, endMinute: 600 }],
    [{ ...own, startMinute: -0 }], [{ ...own, startMinute: 0.5 }], [{ ...own, endMinute: 1441 }], [{ ...own, extra: true }],
    new Array(1), Object.assign([own], { extra: true })]) assert.throws(() => parseCloudAppointmentDay(day({ slots })), code('invalid'));
  for (const changes of [{ recordId: '2026-02-30' }, { revision: 0 }, { schemaVersion: 2 }, { clinicId: 'other' }, { lastOperationId: null }, { extra: true }]) {
    assert.throws(() => parseCloudAppointmentDay(day(changes)), code('invalid'));
  }
});
test('getters/hidden/symbol/prototype data and proxies never execute as record values', () => {
  let executions = 0;
  const getter = Object.defineProperty(command(), 'data', { enumerable: true, get() { executions++; return data(); } });
  const hidden = Object.defineProperty(command(), 'createdAt', { value: WHEN, enumerable: false });
  for (const value of [getter, hidden, { ...command(), [Symbol('extra')]: true }, Object.assign(Object.create({}), command()),
    new Proxy(command(), { ownKeys() { throw new Error('PRIVATE_PROXY'); } })]) {
    assert.throws(() => prepareCloudAppointmentCommand(value), code('invalid'));
  }
  const slots = [day().slots[0]]; Object.defineProperty(slots, '0', { enumerable: true, get() { executions++; return day().slots[0]; } });
  assert.throws(() => parseCloudAppointmentDay(day({ slots })), code('invalid')); assert.equal(executions, 0);
});
test('record/day revision may reach terminal maximum once and cannot reset after exhaustion', async () => {
  const h = harness(); h.docs.set(recordPath(), record({ revision: 1_999_999_999 })); h.docs.set(dayPath(), day());
  await h.commit(command(2, 1_999_999_999)); assert.equal(h.docs.get(recordPath()).revision, 2_000_000_000);
  await assert.rejects(h.repo.commit(command(3, 2_000_000_000)), code('invalid'));
  const x = harness(); x.docs.set(recordPath(), record()); x.docs.set(dayPath(), day({ revision: 2_000_000_000 }));
  const input = command(2, 1); await x.prepare(input); const before = structuredClone(x.docs);
  await assert.rejects(x.repo.commit(input), code('unavailable')); assert.deepEqual(x.docs, before);
});
test('invalid inputs fail before authorization and malformed ACK/provider/digest errors remain fixed safe messages', async () => {
  const h = harness(); await assert.rejects(h.repo.commit({ ...command(), extra: true }), code('invalid')); assert.deepEqual(h.calls, []);
  for (const result of [null, { status: 'committed', recordId: id(102), revision: 1 }, { status: 'committed', recordId: id(101), revision: 2 },
    { status: 'committed', recordId: id(101), revision: 1, privateToken: 'PRIVATE' }]) {
    const x = harness(); x.adapter.runTransaction = async () => result as any;
    await assert.rejects(x.repo.commit(command()), code('invalid')); assert.equal(x.docs.size, 0);
  }
  const bad = createCloudAppointmentRepository(h.adapter, { digest: async () => 'invalid' }); await assert.rejects(bad.commit(command()), code('invalid'));
  const provider = createCloudAppointmentRepository(h.adapter, { digest: async () => { throw new Error('PRIVATE_PROVIDER_SECRET'); } });
  await assert.rejects(provider.commit(command()), value => code('unavailable')(value) && !/PRIVATE/.test(String(value)));
  h.adapter.authorizeOwner = async () => { throw new Error('PRIVATE_ACCOUNT_TOKEN'); };
  for (const action of [() => h.repo.get(id(101)), () => h.repo.getDay(DAY), () => h.repo.commit(command())]) {
    await assert.rejects(action(), value => code('unavailable')(value) && !/PRIVATE/.test(String(value)));
  }
});
test('bounded day history includes inactive appointments and returns explicit ascending cursor pages, never just reservations', async () => {
  const h = harness(); await h.commit(command(1, 0, { status: 'cancelled' }, id(101)));
  await h.commit(command(2, 0, { status: 'apologized' }, id(102))); await h.commit(command(3, 0, { status: 'no_show' }, id(103)));
  await h.commit(command(4, 0, {}, id(104))); await h.commit(command(5, 0, { date: OTHER_DAY }, id(105)));
  const first = await h.repo.listDayPage({ date: DAY, limit: 2 });
  assert.deepEqual(first.records.map(record => record.recordId), [id(101), id(102)]); assert.equal(first.nextAfterId, id(102));
  const second = await h.repo.listDayPage({ date: DAY, afterId: first.nextAfterId, limit: 2 });
  assert.deepEqual(second.records.map(record => record.data.status), ['no_show', 'scheduled']); assert.equal(second.nextAfterId, id(104));
  assert.deepEqual(await h.repo.listDayPage({ date: DAY, afterId: second.nextAfterId, limit: 2 }), { records: [], nextAfterId: null });
  assert.equal((await h.repo.getDay(DAY))?.slots.length, 1);
  first.records[0].data.patientName = 'تغيير'; assert.equal(h.docs.get(recordPath(id(101))).data.patientName, 'مريض مصطنع');
  assert.deepEqual(prepareCloudAppointmentDayPageInput({ date: DAY }), { date: DAY, afterId: null, limit: 25 });
});
test('day page input is strict and snapshotted before awaiting authorization', async () => {
  for (const value of [null, [], {}, { date: '2026-02-30' }, { date: DAY, afterId: 'bad' }, { date: DAY, limit: 0 },
    { date: DAY, limit: 51 }, { date: DAY, limit: -0 }, { date: DAY, limit: '25' }, { date: DAY, limit: 0.5 },
    { date: DAY, clinicId: 'other' }, { date: DAY, [Symbol('extra')]: true }]) {
    assert.throws(() => prepareCloudAppointmentDayPageInput(value), code('invalid'));
  }
  const h = harness(), input = { date: DAY, afterId: null as string | null, limit: 2 };
  const started = deferred(), gate = deferred(); h.hooks.auth = async count => { if (count === 1) { started.resolve(); await gate.promise; } };
  const pending = h.repo.listDayPage(input); await started.promise; input.date = OTHER_DAY; input.afterId = id(999); input.limit = 50;
  gate.resolve(); assert.deepEqual(await pending, { records: [], nextAfterId: null });
  assert.ok(h.calls.includes(`list:${DAY}:null:2`)); assert.equal(h.calls.some(value => value.includes(`list:${OTHER_DAY}`)), false);
});
test('day pages reject missing capability, late owner loss, malformed/unordered/mismatched/oversized server rows', async () => {
  const h = harness(); delete h.adapter.listDayPage;
  await assert.rejects(h.repo.listDayPage({ date: DAY }), code('unavailable'));
  const x = harness(); x.hooks.read = () => x.owner('changed-owner');
  await assert.rejects(x.repo.listDayPage({ date: DAY }), code('unavailable'));
  const a = { id: id(101), data: record() }, b = { id: id(102), data: record({ recordId: id(102) }) };
  for (const rows of [null, [a, a], [b, a], [{ ...a, id: id(102) }], [{ ...a, data: record({ data: data({ date: OTHER_DAY }) }) }],
    [{ ...a, extra: true }], [{ data: record() }], new Array(1), Object.assign([a], { extra: true }), [a, b]]) {
    const y = harness(); y.adapter.listDayPage = async () => rows;
    await assert.rejects(y.repo.listDayPage({ date: DAY, limit: 1 }), code('invalid'));
  }
  const z = harness(); z.adapter.listDayPage = async () => [a];
  await assert.rejects(z.repo.listDayPage({ date: DAY, afterId: id(101) }), code('invalid'));
});
test('day page query and response accessors are rejected without executing them', async () => {
  let executions = 0;
  const query = Object.defineProperty({ date: DAY }, 'date', { enumerable: true, get() { executions++; return DAY; } });
  assert.throws(() => prepareCloudAppointmentDayPageInput(query), code('invalid'));
  const h = harness(), rows = [{ id: id(101), data: record() }];
  Object.defineProperty(rows, '0', { enumerable: true, get() { executions++; return { id: id(101), data: record() }; } });
  h.adapter.listDayPage = async () => rows; await assert.rejects(h.repo.listDayPage({ date: DAY }), code('invalid'));
  assert.equal(executions, 0);
});
