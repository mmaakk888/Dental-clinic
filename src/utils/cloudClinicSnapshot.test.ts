import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudClinicSnapshotReader, CloudClinicSnapshotError, decodeFirestoreSnapshotValue, parseCloudSnapshotReadTime,
  parseCloudSnapshotQueryResponse, CLOUD_SNAPSHOT_COLLECTIONS } from './cloudClinicSnapshot';
import { makeClinicSnapshotFixture, snapshotId as id, snapshotPath as path, SNAPSHOT_TIME, snapshotDigest as digest, snapshotRestDocument, encodeSnapshotValue } from './testing/cloudClinicSnapshotFixtures';

test('snapshot reader constructs inertly; empty clinic is confirmed only with all pages and required singletons/counter', async () => {
  const h = await makeClinicSnapshotFixture(false), reader = createCloudClinicSnapshotReader(h.adapter, { digest }); assert.deepEqual(h.calls, []); assert.equal(h.probes(), 0);
  const result = await reader.readFull(); assert.equal(result.readTime, SNAPSHOT_TIME); assert.deepEqual(result.patients, []); assert.equal(result.counter.lastFileNo, 0);
  assert.equal(h.calls.length, CLOUD_SNAPSHOT_COLLECTIONS.length + 4); assert.ok(h.calls.every(query => query.readTime === SNAPSHOT_TIME && query.limit <= 50));
  assert.ok(Object.isFrozen(result.records.patientProfiles)); assert.ok(!Object.keys(result.records).some(key => /image|intent|operation|member|secret/i.test(key)));
});
test('complete one-time snapshot reconciles patients, linked lab cash, expenses, stock and appointment slots from actual pure writes', async () => {
  const h = await makeClinicSnapshotFixture(), result = await createCloudClinicSnapshotReader(h.adapter, { digest }).readFull();
  assert.equal(result.patients.length, 1); assert.equal(result.patients[0].totalCents, 350_000); assert.equal(result.patients[0].paidCents, 75_000);
  assert.equal(result.records.labCases[0].paidCostCents, 10_000); assert.equal(result.records.labPayments.length, 1);
  assert.equal(result.records.expenseRecords[0].paidCents, 3500); assert.equal(result.records.materialBalances[0].usedMilli, 500);
  assert.equal(result.records.appointmentDays[0].slots.length, 1); assert.doesNotMatch(JSON.stringify(result.patients), /unitCostCents|معمل مصطنع|paidCostCents/);
});
test('initial increasing probe read times are accepted but its catalog data is discarded and reread at final time', async () => {
  const h = await makeClinicSnapshotFixture(false); h.adapter.probeReadTime = async () => [
    { readTime: '2026-10-13T00:00:00.100000Z', document: snapshotRestDocument('settings', 'serviceCatalog', { PROBE_ONLY: true }) }, { readTime: SNAPSHOT_TIME }];
  const result = await createCloudClinicSnapshotReader(h.adapter, { digest }).readFull(); assert.equal(result.readTime, SNAPSHOT_TIME); assert.equal(result.settings.serviceCatalog.data.examinationCents, 10_000);
  assert.doesNotMatch(JSON.stringify(result), /PROBE_ONLY/);
});
test('later page timestamp drift or wrong project/path/cursor cannot publish a partial snapshot', async () => {
  for (const mutate of [(value: any[]) => { value[0].readTime = '2026-10-13T00:00:00.999999Z'; },
    (value: any[]) => { value[0].document.name = value[0].document.name.replace('dental-clinic-mmaakk888', 'foreign-project'); },
    (value: any[]) => { value[0].document.name += '/child/hidden'; }]) {
    const h = await makeClinicSnapshotFixture(); const query = h.adapter.query;
    h.adapter.query = async input => { const value = await query(input); if (input.collection === 'patientProfiles') mutate(value as any); return value; };
    await assert.rejects(createCloudClinicSnapshotReader(h.adapter, { digest }).readFull(), CloudClinicSnapshotError);
  }
});
test('readTime parser preserves microseconds, rejects local offsets, malformed dates and nanosecond precision not accepted by read selector', () => {
  assert.equal(parseCloudSnapshotReadTime(SNAPSHOT_TIME), SNAPSHOT_TIME); assert.equal(parseCloudSnapshotReadTime('2026-10-13T00:00:00.123456000Z'), '2026-10-13T00:00:00.123456000Z');
  for (const value of ['2026-02-30T00:00:00Z', '2026-10-13T24:00:00Z', '2026-10-13T00:00:00.123456789Z', '2026-10-13T00:00:00+00:00', `${SNAPSHOT_TIME}\n`]) assert.throws(() => parseCloudSnapshotReadTime(value));
});
test('REST Value decoding rejects bytes/provider references, unsafe integers, accessor/sparse/prototype and excessive depth', () => {
  assert.deepEqual(decodeFirestoreSnapshotValue(encodeSnapshotValue({ id: 'a', enabled: true, optional: null, values: [1, 2] })), { id: 'a', enabled: true, optional: null, values: [1, 2] });
  for (const value of [{ bytesValue: 'SECRET' }, { referenceValue: 'foreign' }, { integerValue: '9007199254740992' }, { integerValue: '-0' },
    { stringValue: 'a', integerValue: '1' }, { arrayValue: { values: new Array(1) } }, Object.defineProperty({}, 'stringValue', { enumerable: true, get() { throw new Error('PRIVATE_GETTER'); } })]) assert.throws(() => decodeFirestoreSnapshotValue(value), CloudClinicSnapshotError);
  let deep: any = { stringValue: 'x' }; for (let i = 0; i < 14; i++) deep = { arrayValue: { values: [deep] } }; assert.throws(() => decodeFirestoreSnapshotValue(deep));
});
test('probe/query framing rejects backward time, skipped progress, nonterminal done and document count overflow', () => {
  const scope = { collection: 'settings' as const, documentId: 'serviceCatalog', afterId: null, limit: 1 };
  for (const value of [[{ readTime: SNAPSHOT_TIME, skippedResults: 1 }], [{ readTime: SNAPSHOT_TIME, done: true }, { readTime: SNAPSHOT_TIME }],
    [{ readTime: SNAPSHOT_TIME }, { readTime: '2026-10-13T00:00:00.100000Z' }], []]) assert.throws(() => parseCloudSnapshotQueryResponse(value, scope));
});
test('missing required catalog/settings/routing/counter is unknown and never synthesized from defaults', async () => {
  for (const key of [path('counters', 'patientFiles'), path('settings', 'serviceCatalog'), path('settings', 'clinicSettings'), path('settings', 'prostheticRouting')]) {
    const h = await makeClinicSnapshotFixture(false); h.docs.delete(key); await assert.rejects(createCloudClinicSnapshotReader(h.adapter, { digest }).readFull());
  }
});
test('profile/file index/counter/phone-key mismatches and orphan clinical records reject complete export', async () => {
  for (const mutate of [(h: any) => { h.docs.get(path('patientFiles', 451)).recordId = id(800); },
    (h: any) => { h.docs.get(path('counters', 'patientFiles')).lastFileNo = 452; },
    (h: any) => { h.docs.get(path('patientProfiles', id(900))).phoneKey = 'a'.repeat(64); },
    (h: any) => { h.docs.get(path('patientSessions', id(10))).patientId = id(800); },
    (h: any) => { h.docs.delete(path('patientReceipts', id(10))); }]) {
    const h = await makeClinicSnapshotFixture(); mutate(h); await assert.rejects(createCloudClinicSnapshotReader(h.adapter, { digest }).readFull());
  }
});
test('lab allocation/session link/account revision and appointment slot conflicts reject all financial output', async () => {
  for (const mutate of [(h: any) => { h.docs.get(path('labAccounts', id(901))).revision++; },
    (h: any) => { h.docs.delete(path('labPayments', id(12))); },
    (h: any) => { h.docs.get(path('labCases', id(11))).snapshot.patientUnitPriceCents++; },
    (h: any) => { h.docs.get(path('appointmentDays', '2026-10-13')).slots[0].startMinute++; }]) {
    const h = await makeClinicSnapshotFixture(); mutate(h); await assert.rejects(createCloudClinicSnapshotReader(h.adapter, { digest }).readFull());
  }
});
test('supplier cash/purchase/stock/usage mismatches and orphan materials reject rather than summing partial costs', async () => {
  for (const mutate of [(h: any) => { h.docs.delete(path('expensePayments', id(16))); },
    (h: any) => { const key = [...h.docs.keys()].find((key: any) => key.includes('/materialBalances/')); h.docs.get(key).purchaseCostCents++; },
    (h: any) => { h.docs.delete(path('materialUsages', id(17))); },
    (h: any) => { h.docs.get(path('expenseRecords', id(14))).data.items = []; }]) {
    const h = await makeClinicSnapshotFixture(); mutate(h); await assert.rejects(createCloudClinicSnapshotReader(h.adapter, { digest }).readFull());
  }
});
test('full collections use ascending name cursor pages and verify terminal empty page when exactly50 records', async () => {
  const h = await makeClinicSnapshotFixture(false);
  for (let i = 1; i <= 50; i++) { h.docs.set(path('patientProfiles', id(i)), { schemaVersion: 1, clinicId: 'main', recordId: id(i), fileNo: i, revision: 1, lastOperationId: id(999), phoneKey: null,
    data: { name: `مصطنع ${i}`, mobile: '', age: 30, gender: '', firstVisit: '2026-10-13', notes: '', allergy: '' } });
    h.docs.set(path('patientFiles', i), { schemaVersion: 1, clinicId: 'main', fileNo: i, recordId: id(i) }); }
  h.docs.set(path('counters', 'patientFiles'), { schemaVersion: 1, clinicId: 'main', lastFileNo: 50, lastOperationId: id(999) });
  const result = await createCloudClinicSnapshotReader(h.adapter, { digest }).readFull(); assert.equal(result.patients.length, 50);
  const pages = h.calls.filter(row => row.collection === 'patientProfiles'); assert.equal(pages.length, 2); assert.equal(pages[1].afterId, id(50));
});
test('actual lease loss during one page rejects late results and no bytes/records are cached for reuse', async () => {
  const h = await makeClinicSnapshotFixture(false), query = h.adapter.query;
  h.adapter.query = async input => { const value = await query(input); h.active(false); return value; };
  await assert.rejects(createCloudClinicSnapshotReader(h.adapter, { digest }).readFull(), CloudClinicSnapshotError);
});
test('per-collection and aggregate byte bounds fail explicitly instead of returning a truncated clinic', async () => {
  for (const notes of ['', 'أ'.repeat(2000)]) {
    const h = await makeClinicSnapshotFixture(false), query = h.adapter.query; let pages = 0;
    h.adapter.query = async input => {
      if (input.collection !== 'patientProfiles') return query(input); pages++;
      const start = input.afterId ? Number(input.afterId.slice(-12)) + 1 : 1;
      return Array.from({ length: 50 }, (_, index) => { const number = start + index;
        return { readTime: input.readTime, document: snapshotRestDocument('patientProfiles', id(number), { schemaVersion: 1, clinicId: 'main', recordId: id(number), fileNo: number,
          revision: 1, lastOperationId: id(999), phoneKey: null, data: { name: 'مصطنع فقط', mobile: '', age: 30, gender: '', firstVisit: '2026-10-13', notes, allergy: '' } }) };
      });
    };
    await assert.rejects(createCloudClinicSnapshotReader(h.adapter, { digest }).readFull(), CloudClinicSnapshotError);
    if (!notes) assert.equal(pages, 401); else assert.ok(pages < 401, '64MiB bound rejects before collection cap');
  }
});
