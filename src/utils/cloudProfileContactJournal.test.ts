import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudProfileContactJournal } from './cloudProfileContactJournal';
import { CloudOperationIntentError, prepareCloudIntentCommand,
  type CloudOperationIntent, type CloudOperationIntentRepository } from './cloudOperationIntent';
import type { CloudContactCommand } from './cloudContactRepository';
import type { CloudPatientCommand } from './cloudPatientRepository';

// Pure capability-boundary fixtures only. No SDK, browser storage, live Auth,
// clinical data, Rules or accepted server mutation is exercised by these tests.
const OWNER = 'synthetic-profile-contact-journal-owner';
const id = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OP = id(1), RECORD = id(101), WHEN = '2026-10-12T09:00:00.000Z';
type Kind = 'contact' | 'patient-profile';
function contactCommand(): CloudContactCommand {
  return { operationId: OP, recordId: RECORD, expectedRevision: 0, action: 'create',
    contact: { id: RECORD, name: 'جهة مصطنعة للاختبار', mobile: '01000000001', createdAt: '2026-10-08T10:00:00.000Z' } };
}
function patientCommand(): CloudPatientCommand {
  return { operationId: OP, recordId: RECORD, expectedRevision: 0, action: 'create',
    profile: { name: 'ملف مصطنع للاختبار', mobile: '01000000001', age: 30, gender: '',
      firstVisit: '2026-10-12', notes: '', allergy: '' } };
}
const commandFor = (kind: Kind) => kind === 'contact' ? contactCommand() : patientCommand();
function intent(kind: Kind, command: unknown = commandFor(kind), status: CloudOperationIntent['status'] = 'prepared'): CloudOperationIntent {
  const canonical = prepareCloudIntentCommand(command);
  return { schemaVersion: 1, clinicId: 'main', recordId: canonical.operationId as string,
    operationId: canonical.operationId as string, actorUid: OWNER, kind, requestHash: 'a'.repeat(64),
    status, revision: status === 'prepared' ? 1 : 2, createdAt: WHEN, command: canonical };
}
function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(accept => { resolve = accept; }); return { promise, resolve };
}
const fixed = (code?: CloudOperationIntentError['code']) => (error: unknown) => error instanceof CloudOperationIntentError
  && (code === undefined || error.code === code) && !String(error).includes('SYNTHETIC_PRIVATE');
function harness(kind: Kind = 'contact') {
  const calls: string[] = [], values = { returned: intent(kind), active: true };
  const hooks: { beforeRun?: () => Promise<void>; afterMethod?: () => void } = {};
  let page: unknown = { records: [], nextAfterId: null };
  let failure: unknown = null;
  const received: { kind?: unknown; command?: unknown; time?: unknown; id?: unknown; input?: unknown } = {};
  function response() { if (failure !== null) throw failure; hooks.afterMethod?.(); return values.returned; }
  const journal: CloudOperationIntentRepository = {
    prepare: async (which, command, createdAt) => {
      calls.push('prepare'); received.kind = which; received.command = command; received.time = createdAt; return response();
    },
    get: async key => { calls.push('get'); received.id = key; return response(); },
    cancel: async key => { calls.push('cancel'); received.id = key; return response(); },
    listPreparedPage: async (which, input) => {
      calls.push('prepared'); received.kind = which; received.input = input; response();
      return page as Awaited<ReturnType<CloudOperationIntentRepository['listPreparedPage']>>;
    },
    listHistoryPage: async (which, input) => {
      calls.push('history'); received.kind = which; received.input = input; response();
      return page as Awaited<ReturnType<NonNullable<CloudOperationIntentRepository['listHistoryPage']>>>;
    },
  };
  const run = async <T>(work: () => Promise<T>): Promise<T> => {
    calls.push('run'); await hooks.beforeRun?.();
    if (!values.active) throw new Error('SYNTHETIC_PRIVATE_LEASE');
    const result = await work();
    if (!values.active) throw new Error('SYNTHETIC_PRIVATE_LEASE');
    return result;
  };
  const guarded = createCloudProfileContactJournal({ kind, actorUid: OWNER, journal, run });
  return { guarded, journal, calls, values, hooks, received, run,
    setPage: (value: unknown) => { page = value; }, setFailure: (value: unknown) => { failure = value; } };
}

test('profile/contact journal construction is inert and returns a frozen narrow journal', () => {
  for (const kind of ['contact', 'patient-profile'] as const) {
    const h = harness(kind); assert.deepEqual(h.calls, []); assert.equal(Object.isFrozen(h.guarded), true);
    assert.deepEqual(Object.keys(h.guarded).sort(), ['cancel', 'get', 'listHistoryPage', 'listPreparedPage', 'prepare']);
  }
});

test('invalid owner/kind/run binding is rejected without reading a journal', () => {
  const h = harness();
  for (const actorUid of ['', ' owner ', 'synthetic\nowner', 'x'.repeat(129)]) {
    assert.throws(() => createCloudProfileContactJournal({ kind: 'contact', actorUid, journal: h.journal, run: h.run }), fixed('invalid'));
  }
  assert.throws(() => createCloudProfileContactJournal({ kind: 'clinical' as Kind, actorUid: OWNER,
    journal: h.journal, run: h.run }), fixed('invalid'));
  assert.throws(() => createCloudProfileContactJournal({ kind: 'contact', actorUid: OWNER,
    journal: h.journal, run: null as never }), fixed('invalid'));
  assert.deepEqual(h.calls, []);
});

test('both domains prepare their complete canonical command with an explicit independent operation timestamp', async () => {
  for (const kind of ['contact', 'patient-profile'] as const) {
    const h = harness(kind), input = commandFor(kind);
    const saved = await h.guarded.prepare(kind, input, WHEN);
    assert.deepEqual(saved, intent(kind)); assert.deepEqual(h.calls, ['run', 'prepare']);
    assert.equal(h.received.kind, kind); assert.equal(h.received.time, WHEN);
    assert.deepEqual(h.received.command, prepareCloudIntentCommand(input));
    if (kind === 'contact') assert.notEqual((saved.command.contact as { createdAt: string }).createdAt, saved.createdAt);
  }
});

test('prepare snapshots domain input before a lease await and never sends later caller mutations', async () => {
  for (const kind of ['contact', 'patient-profile'] as const) {
    const h = harness(kind), gate = deferred(), input = commandFor(kind), before = structuredClone(input);
    h.hooks.beforeRun = () => gate.promise;
    const pending = h.guarded.prepare(kind, input, WHEN);
    if ('contact' in input && input.contact) input.contact.name = 'تغيير لاحق';
    if ('profile' in input) input.profile.notes = 'تغيير لاحق';
    input.operationId = id(999); gate.resolve(); await pending;
    assert.deepEqual(h.received.command, prepareCloudIntentCommand(before));
    assert.equal(h.received.time, WHEN);
  }
});

test('valid updates and contact tombstone commands retain the original CAS revision and action', async () => {
  for (const kind of ['contact', 'patient-profile'] as const) {
    const h = harness(kind), update = { ...commandFor(kind), action: 'update', expectedRevision: 9 };
    h.values.returned = intent(kind, update);
    assert.equal((await h.guarded.prepare(kind, update, WHEN)).command.expectedRevision, 9);
    assert.equal((h.received.command as { action: string }).action, 'update');
  }
  const h = harness(), remove: CloudContactCommand = { operationId: OP, recordId: RECORD,
    expectedRevision: 9, action: 'delete', contact: null };
  h.values.returned = intent('contact', remove);
  assert.equal((await h.guarded.prepare('contact', remove, WHEN)).command.contact, null);
  assert.deepEqual(h.received.command, prepareCloudIntentCommand(remove));
});

test('absent legacy contact notes are not injected or accepted as equivalent to explicit empty notes', async () => {
  const h = harness(), input = contactCommand();
  const saved = await h.guarded.prepare('contact', input, WHEN);
  assert.equal(Object.hasOwn(saved.command.contact as object, 'notes'), false);
  assert.equal(Object.hasOwn((h.received.command as { contact: object }).contact, 'notes'), false);
  h.values.returned = intent('contact', { ...input, contact: { ...input.contact, notes: '' } });
  await assert.rejects(h.guarded.prepare('contact', input, WHEN), fixed('invalid'));
});

test('wrong kinds, malformed timestamps and domain commands fail before the run boundary', async () => {
  for (const kind of ['contact', 'patient-profile'] as const) {
    const h = harness(kind), input = commandFor(kind);
    for (const which of [kind === 'contact' ? 'patient-profile' : 'contact', 'clinical', 'catalog']) {
      await assert.rejects(async () => h.guarded.prepare(which as Kind, input, WHEN), fixed('invalid'));
    }
    for (const when of ['', '2026-10-12', '2026-02-30T09:00:00.000Z', WHEN + '\n', '2026-10-12T09:00:00Z']) {
      await assert.rejects(async () => h.guarded.prepare(kind, input, when), fixed('invalid'));
    }
    for (const value of [{ ...input, unexpected: true }, { ...input, operationId: OP + '\n' },
      { ...input, expectedRevision: 2 }, { operationId: OP }, commandFor(kind === 'contact' ? 'patient-profile' : 'contact')]) {
      await assert.rejects(async () => h.guarded.prepare(kind, value, WHEN), fixed('invalid'));
    }
    assert.deepEqual(h.calls, []);
  }
});

test('input accessors and extra domain fields are rejected without executing getters or calling run', async () => {
  for (const kind of ['contact', 'patient-profile'] as const) {
    const h = harness(kind); let getterReads = 0;
    const input = commandFor(kind), key = kind === 'contact' ? 'contact' : 'profile';
    Object.defineProperty(input, key, { enumerable: true, get: () => { getterReads++; throw new Error('SYNTHETIC_PRIVATE_GETTER'); } });
    await assert.rejects(async () => h.guarded.prepare(kind, input, WHEN), fixed('invalid'));
    assert.equal(getterReads, 0); assert.deepEqual(h.calls, []);
  }
});

test('prepare binds its returned operation ID, command and timestamp and refuses cancelled preparation', async () => {
  for (const kind of ['contact', 'patient-profile'] as const) {
    const h = harness(kind), changed = commandFor(kind);
    if ('contact' in changed && changed.contact) changed.contact.name = 'محتوى مختلف';
    if ('profile' in changed) changed.profile.notes = 'محتوى مختلف';
    for (const value of [intent(kind, changed), intent(kind, { ...commandFor(kind), operationId: id(2) }),
      { ...intent(kind), createdAt: '2026-10-12T09:01:00.000Z' }]) {
      h.values.returned = value; await assert.rejects(h.guarded.prepare(kind, commandFor(kind), WHEN), fixed('invalid'));
    }
    h.values.returned = intent(kind, commandFor(kind), 'cancelled');
    await assert.rejects(h.guarded.prepare(kind, commandFor(kind), WHEN), fixed('conflict'));
    h.values.returned = intent(kind, commandFor(kind), 'committed');
    assert.equal((await h.guarded.prepare(kind, commandFor(kind), WHEN)).status, 'committed');
  }
});

test('get accepts all journal states and null, but detaches both the envelope and nested domain payload', async () => {
  for (const kind of ['contact', 'patient-profile'] as const) {
    const h = harness(kind);
    for (const status of ['prepared', 'committed', 'cancelled'] as const) {
      h.values.returned = intent(kind, commandFor(kind), status);
      const result = (await h.guarded.get(OP))!;
      assert.deepEqual(result, h.values.returned); assert.notEqual(result, h.values.returned);
      assert.notEqual(result.command, h.values.returned.command);
      if (kind === 'contact') assert.notEqual(result.command.contact, h.values.returned.command.contact);
      else assert.notEqual(result.command.profile, h.values.returned.command.profile);
      h.values.returned.command.operationId = id(2); assert.equal(result.command.operationId, OP);
    }
    h.values.returned = null as unknown as CloudOperationIntent;
    assert.equal(await h.guarded.get(OP), null);
  }
});

test('get/cancel reject noncanonical IDs before authorization or journal calls', async () => {
  const h = harness();
  for (const value of ['', OP + '\n', '../' + OP, 'A' + OP.slice(1), 1, null]) {
    await assert.rejects(async () => h.guarded.get(value as string), fixed('invalid'));
    await assert.rejects(async () => h.guarded.cancel(value as string), fixed('invalid'));
  }
  assert.deepEqual(h.calls, []);
});

test('returns reject foreign actor/kind, malformed envelopes, extra schema fields and malformed domain commands', async () => {
  for (const kind of ['contact', 'patient-profile'] as const) {
    const h = harness(kind), good = intent(kind);
    const extras = kind === 'contact' ? { ...contactCommand(), contact: { ...contactCommand().contact, consent: true } }
      : { ...patientCommand(), profile: { ...patientCommand().profile, sessions: [] } };
    const candidates = [{ ...good, actorUid: 'foreign-synthetic-owner' },
      { ...good, kind: kind === 'contact' ? 'patient-profile' : 'contact' }, { ...good, operationId: id(2), recordId: id(2) },
      { ...good, extra: true }, { ...good, requestHash: 'a'.repeat(63) }, { ...good, revision: 2 },
      { ...good, command: prepareCloudIntentCommand(extras) },
      { ...good, command: prepareCloudIntentCommand({ operationId: OP, name: 'ليس أمر مجال' }) }];
    for (const value of candidates) {
      h.values.returned = value as CloudOperationIntent;
      await assert.rejects(h.guarded.get(OP), fixed('invalid'));
    }
  }
});

test('returned envelope/domain accessors cannot execute hidden getters', async () => {
  const h = harness(); let getterReads = 0;
  const item = intent('contact');
  Object.defineProperty(item, 'command', { enumerable: true, get: () => { getterReads++; throw new Error('SYNTHETIC_PRIVATE_GETTER'); } });
  h.values.returned = item; await assert.rejects(h.guarded.get(OP), fixed('invalid'));
  assert.equal(getterReads, 0);
  const nested = intent('contact');
  Object.defineProperty(nested.command.contact, 'name', { enumerable: true,
    get: () => { getterReads++; throw new Error('SYNTHETIC_PRIVATE_GETTER'); } });
  h.values.returned = nested; await assert.rejects(h.guarded.get(OP), fixed('invalid'));
  assert.equal(getterReads, 0);
});

test('cancel returns only the same domain/actor/ID in cancelled state and does not imply server undo', async () => {
  for (const kind of ['contact', 'patient-profile'] as const) {
    const h = harness(kind); h.values.returned = intent(kind, commandFor(kind), 'cancelled');
    const result = await h.guarded.cancel(OP); assert.equal(result.status, 'cancelled');
    assert.deepEqual(h.calls, ['run', 'cancel']); assert.equal(h.received.id, OP);
    for (const status of ['prepared', 'committed'] as const) {
      h.values.returned = intent(kind, commandFor(kind), status);
      await assert.rejects(h.guarded.cancel(OP), error => fixed('invalid')(error) || fixed('conflict')(error));
    }
  }
});

test('history uses its all-status method, accepts ordered complete envelopes, and never calls the prepared queue', async () => {
  for (const kind of ['contact', 'patient-profile'] as const) {
    const h = harness(kind), records = (['prepared', 'committed', 'cancelled'] as const).map((status, index) =>
      intent(kind, { ...commandFor(kind), operationId: id(index + 1) }, status));
    h.setPage({ records, nextAfterId: id(3) });
    const page = await h.guarded.listHistoryPage!(kind, { limit: 3 });
    assert.deepEqual(page.records.map(value => value.status), ['prepared', 'committed', 'cancelled']);
    assert.equal(page.nextAfterId, id(3)); assert.deepEqual(h.calls, ['run', 'history']);
    assert.notEqual(page.records[0], records[0]); assert.notEqual(page.records[0].command, records[0].command);
    records[0].actorUid = 'later-mutation'; assert.equal(page.records[0].actorUid, OWNER);
  }
});

test('list defaults and explicit bounds are captured before a lease await', async () => {
  const h = harness(), gate = deferred(); h.hooks.beforeRun = () => gate.promise;
  const bounds = { afterId: id(4), limit: 2 }, pending = h.guarded.listHistoryPage!('contact', bounds);
  bounds.afterId = id(99); bounds.limit = 50; gate.resolve(); await pending;
  assert.deepEqual(h.received.input, { afterId: id(4), limit: 2 });
  delete h.hooks.beforeRun; await h.guarded.listPreparedPage('contact');
  assert.deepEqual(h.received.input, { afterId: null, limit: 25 });
});

test('prepared-only list rejects committed and cancelled rows even when history would accept them', async () => {
  const h = harness();
  for (const status of ['committed', 'cancelled'] as const) {
    h.setPage({ records: [intent('contact', contactCommand(), status)], nextAfterId: null });
    await assert.rejects(h.guarded.listPreparedPage('contact'), fixed('invalid'));
  }
});

test('lists reject wrong kind and invalid/hostile bounds before run or provider reads', async () => {
  const h = harness(); let getters = 0;
  const accessor = Object.defineProperty({}, 'limit', { enumerable: true, get: () => { getters++; return 1; } });
  for (const input of [{ limit: 0 }, { limit: 51 }, { limit: null }, { afterId: OP + '\n' }, { unexpected: true }, accessor]) {
    await assert.rejects(h.guarded.listHistoryPage!('contact', input as never), fixed('invalid'));
    await assert.rejects(h.guarded.listPreparedPage('contact', input as never), fixed('invalid'));
  }
  await assert.rejects(h.guarded.listHistoryPage!('patient-profile'), fixed('invalid'));
  assert.equal(getters, 0); assert.deepEqual(h.calls, []);
});

test('pages require dense ascending IDs beyond cursor, bounded size and an exact continuation cursor', async () => {
  const h = harness(), a = intent('contact'), b = intent('contact', { ...contactCommand(), operationId: id(2) });
  const sparse = new Array(1);
  for (const value of [
    { records: sparse, nextAfterId: null }, { records: [a, a], nextAfterId: id(1) },
    { records: [b, a], nextAfterId: id(1) }, { records: [a, b], nextAfterId: null },
    { records: [a], nextAfterId: OP }, { records: [], nextAfterId: OP },
    { records: [a], nextAfterId: null, private: true }, { records: [a, b, b], nextAfterId: id(2) },
  ]) {
    h.setPage(value); await assert.rejects(h.guarded.listHistoryPage!('contact', { limit: 2 }), fixed('invalid'));
  }
  h.setPage({ records: [a], nextAfterId: OP });
  await assert.rejects(h.guarded.listHistoryPage!('contact', { afterId: OP, limit: 1 }), fixed('invalid'));
  h.setPage({ records: [b], nextAfterId: id(2) });
  assert.equal((await h.guarded.listHistoryPage!('contact', { afterId: OP, limit: 1 })).nextAfterId, id(2));
});

test('malformed page and row getters are rejected without evaluating them', async () => {
  const h = harness(); let getters = 0;
  const page = Object.defineProperty({ nextAfterId: null }, 'records', { enumerable: true,
    get: () => { getters++; throw new Error('SYNTHETIC_PRIVATE_GETTER'); } });
  h.setPage(page); await assert.rejects(h.guarded.listHistoryPage!('contact'), fixed('invalid'));
  const records = [intent('contact')];
  Object.defineProperty(records, '0', { enumerable: true, get: () => { getters++; throw new Error('SYNTHETIC_PRIVATE_GETTER'); } });
  h.setPage({ records, nextAfterId: null }); await assert.rejects(h.guarded.listHistoryPage!('contact'), fixed('invalid'));
  assert.equal(getters, 0);
});

test('missing journal and missing history fail closed without substituting memory or prepared-only history', async () => {
  const h = harness();
  const absent = createCloudProfileContactJournal({ kind: 'contact', actorUid: OWNER, run: h.run });
  for (const call of [() => absent.prepare('contact', contactCommand(), WHEN), () => absent.get(OP), () => absent.cancel(OP),
    () => absent.listPreparedPage('contact'), () => absent.listHistoryPage!('contact')]) {
    await assert.rejects(call(), fixed('unavailable'));
  }
  assert.equal(h.calls.some(value => ['get', 'cancel', 'prepare', 'prepared', 'history'].includes(value)), false);
  const narrow = { ...h.journal }; delete narrow.listHistoryPage;
  const withoutHistory = createCloudProfileContactJournal({ kind: 'contact', actorUid: OWNER, journal: narrow, run: h.run });
  h.calls.length = 0;
  await assert.rejects(withoutHistory.listHistoryPage!('contact'), fixed('unavailable'));
  assert.equal(h.calls.includes('prepared'), false); assert.equal(h.calls.includes('history'), false);
});

test('provider and lease errors are fixed, while safe journal error codes are retained', async () => {
  const h = harness();
  for (const value of [new Error('SYNTHETIC_PRIVATE_PROVIDER'), { token: 'SYNTHETIC_PRIVATE_TOKEN' },
    Object.create(null), new Proxy({}, { get: () => { throw new Error('SYNTHETIC_PRIVATE_PROXY'); } })]) {
    h.setFailure(value); await assert.rejects(h.guarded.get(OP), fixed('unavailable'));
  }
  for (const code of ['invalid', 'conflict', 'unavailable'] as const) {
    h.setFailure(new CloudOperationIntentError(code)); await assert.rejects(h.guarded.get(OP), fixed(code));
  }
  h.setFailure(null); h.values.active = false;
  await assert.rejects(h.guarded.get(OP), fixed('unavailable'));
});

test('every retained method re-enters the supplied lease boundary and suppresses late revoked results', async () => {
  const h = harness(), retained = [() => h.guarded.prepare('contact', contactCommand(), WHEN), () => h.guarded.get(OP),
    () => h.guarded.cancel(OP), () => h.guarded.listPreparedPage('contact'), () => h.guarded.listHistoryPage!('contact')];
  h.values.active = false;
  for (const call of retained) await assert.rejects(call(), fixed('unavailable'));
  assert.equal(h.calls.filter(value => value === 'run').length, 5);
  assert.equal(h.calls.filter(value => value !== 'run').length, 0);
  h.values.active = true; h.hooks.afterMethod = () => { h.values.active = false; };
  await assert.rejects(h.guarded.get(OP), fixed('unavailable'));
  assert.equal(h.calls.filter(value => value === 'get').length, 1);
});
