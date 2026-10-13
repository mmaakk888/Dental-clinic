import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudClinicSnapshotReader, type CloudClinicSnapshot } from './cloudClinicSnapshot';
import { projectCloudClinicOverview, filterCloudOverviewDirectory, formatCloudClinicCents, packageCloudOverviewExport,
  validateCloudOverviewRange } from './cloudClinicOverviewProjection';
import { makeClinicSnapshotFixture, snapshotDigest, snapshotId, SNAPSHOT_WHEN } from './testing/cloudClinicSnapshotFixtures';

async function full() { const fixture = await makeClinicSnapshotFixture(); return createCloudClinicSnapshotReader(fixture.adapter, { digest: snapshotDigest }).readFull(); }
const range = { from: '2026-10-13', to: '2026-10-13' };
function withDirectory(snapshot: CloudClinicSnapshot) {
  const value = structuredClone(snapshot), original = value.records.patientProfiles[0];
  value.records.patientProfiles = [{ ...original, data: { ...original.data, name: 'أحمد مصطنع', mobile: '01000000001' } },
    { ...original, recordId: snapshotId(904), fileNo: 452, data: { ...original.data, name: 'إيمان مصطنعة', mobile: '+201000000001' } },
    { ...original, recordId: snapshotId(905), fileNo: 453, data: { ...original.data, name: 'علي مصطنع', mobile: '01100000002' } }];
  const contact = (n: number, name: string, mobile: string) => ({ schemaVersion: 1 as const, clinicId: 'main' as const, recordId: snapshotId(n), revision: 1,
    deleted: false, lastOperationId: snapshotId(999), phoneKey: 'a'.repeat(64), data: { id: snapshotId(n), name, mobile, createdAt: SNAPSHOT_WHEN, notes: '' } });
  value.records.contactRecords = [contact(906, 'جهة اتصال العائلة', '01000000001'), contact(907, 'رقم بدون ملف', '01200000003'),
    { ...contact(908, 'محذوف', '01500000004'), deleted: true, phoneKey: null, data: null }];
  return value;
}
test('whole-clinic finance counts real receipts once and keeps cash separate from charges/material use', async () => {
  const projection = projectCloudClinicOverview(await full(), range);
  assert.deepEqual(projection.totals, { collectedCents: '75000', labPaidCents: '10000', expensePaidCents: '3500', netCashCents: '61500',
    chargedCents: '350000', expenseChargedCents: '10000', materialUsedCents: '2500', materialWasteCents: '0',
    outstandingPatientCents: '275000', outstandingLabCents: '50000', outstandingExpenseCents: '6500', reservedForLabCents: '50000' });
  assert.equal(projection.cash.length, 6); assert.equal(projection.cash.filter(row => row.kind === 'lab').length, 1);
  assert.equal(projection.cash.filter(row => row.kind === 'patient').length, 3);
  assert.equal(projection.cash.find(row => row.kind === 'patient')!.patientRecordId, snapshotId(900));
});
test('range filters cash, charges, usages and appointments but cumulative balances remain explicitly all-time', async () => {
  const projection = projectCloudClinicOverview(await full(), { from: '2026-10-14', to: '2026-10-15' });
  assert.equal(projection.cash.length, 0); assert.equal(projection.appointments.length, 0);
  for (const key of ['collectedCents', 'labPaidCents', 'expensePaidCents', 'netCashCents', 'chargedCents', 'expenseChargedCents', 'materialUsedCents'] as const) assert.equal(projection.totals[key], '0');
  assert.equal(projection.totals.outstandingPatientCents, '275000'); assert.equal(projection.totals.reservedForLabCents, '50000');
});
test('unified directory preserves family-file matches, standalone phones, tombstones and internal UUID/public number distinction', async () => {
  const projection = projectCloudClinicOverview(withDirectory(await full()), range);
  assert.deepEqual(projection.counts, { patients: 3, entries: 3, phones: 3, phonesWithFiles: 2, phonesWithoutFiles: 1 });
  const family = projection.directory.find(row => row.files.length === 2)!;
  assert.deepEqual(family.files.map(row => row.fileNo), [451, 452]); assert.equal(family.files[0].patientRecordId, snapshotId(900));
  assert.equal(filterCloudOverviewDirectory(projection, 'ايمان', 'files')[0], family);
  assert.equal(filterCloudOverviewDirectory(projection, '٠١٠٠٠', 'all')[0], family);
  assert.equal(filterCloudOverviewDirectory(projection, '٤٥٢', 'all')[0], family);
  assert.equal(filterCloudOverviewDirectory(projection, '', 'nofiles')[0].name, 'رقم بدون ملف');
  assert.equal(filterCloudOverviewDirectory(projection, 'محذوف', 'all').length, 0);
});

test('whole file search retains patients without a mobile and never invents a dialable contact', async () => {
  const snapshot = withDirectory(await full()); snapshot.records.patientProfiles[2].data.mobile = '';
  const projection = projectCloudClinicOverview(snapshot, range);
  const byName = filterCloudOverviewDirectory(projection, 'علي', 'files'), byNumber = filterCloudOverviewDirectory(projection, '٤٥٣', 'all');
  assert.equal(byName.length, 1); assert.equal(byName[0], byNumber[0]); assert.equal(byName[0].phone, '');
  assert.equal(byName[0].files[0].patientRecordId, snapshotId(905));
  assert.equal(projection.counts.entries, 3); assert.equal(projection.counts.phones, 2);
});
test('a nearby phone fragment never creates a file link or campaign consent', async () => {
  const snapshot = withDirectory(await full()); snapshot.records.contactRecords[1].data!.mobile = '01000000002';
  const projection = projectCloudClinicOverview(snapshot, range);
  const row = projection.directory.find(row => row.name === 'رقم بدون ملف')!;
  assert.equal(row.files.length, 0); assert.equal('consent' in row, false);
});
test('safe individual amounts aggregate above Number precision without rounding', async () => {
  const value = structuredClone(await full());
  value.records.patientReceipts = Array.from({ length: 20_000 }, (_, i) => ({ ...value.records.patientReceipts[0], receiptId: snapshotId(i + 1000), amountCents: 1_000_000_000_000 }));
  const projection = projectCloudClinicOverview(value, range);
  assert.equal(projection.totals.collectedCents, '20000000000000000');
  assert.equal(projection.totals.netCashCents, '19999999999986500');
  assert.equal(formatCloudClinicCents(projection.totals.collectedCents), '200,000,000,000,000.00 ج.م');
  assert.equal(formatCloudClinicCents('-105'), '−1.05 ج.م');
});
test('duplicate receipts, invalid cents, missing linked files or negative balances fail rather than produce a partial report', async () => {
  const original = await full();
  const duplicate = structuredClone(original); duplicate.records.patientReceipts.push(duplicate.records.patientReceipts[0]); assert.throws(() => projectCloudClinicOverview(duplicate, range));
  const unsafe = structuredClone(original); unsafe.records.patientReceipts[0].amountCents = Number.MAX_SAFE_INTEGER + 1; assert.throws(() => projectCloudClinicOverview(unsafe, range));
  const missing = structuredClone(original); missing.records.patientProfiles = []; assert.throws(() => projectCloudClinicOverview(missing, range));
  const negative = structuredClone(original); negative.records.labAccounts[0].paidCostCents = negative.records.labAccounts[0].totalCostCents + 1; assert.throws(() => projectCloudClinicOverview(negative, range));
});
test('readTime, calendar ranges and formatting reject malformed values', async () => {
  assert.throws(() => validateCloudOverviewRange({ from: '2026-02-30', to: range.to }));
  assert.throws(() => validateCloudOverviewRange({ from: range.to, to: '2026-10-12' }));
  for (const value of ['1.2', '-0', '01', '1e3', '', 'Infinity']) assert.throws(() => formatCloudClinicCents(value));
  const snapshot = await full(); assert.throws(() => projectCloudClinicOverview({ ...snapshot, readTime: 'bad' }, range));
});
test('projection and nested public result containers are immutable', async () => {
  const projection = projectCloudClinicOverview(withDirectory(await full()), range);
  assert.ok(Object.isFrozen(projection)); assert.ok(Object.isFrozen(projection.totals)); assert.ok(Object.isFrozen(projection.directory[0])); assert.ok(Object.isFrozen(projection.directory[0].files));
});
test('operational JSON includes the complete fixed snapshot, excludes top-level secrets/images/journals and does not masquerade as restore backup', async () => {
  const snapshot = await full(), projection = projectCloudClinicOverview(snapshot, { from: '2026-10-14', to: '2026-10-14' });
  const output = packageCloudOverviewExport({ ...snapshot, users: [{ password: 'SYNTHETIC_SECRET' }], invoiceImages: ['SYNTHETIC_IMAGE'], journal: ['SYNTHETIC_JOURNAL'] } as any, projection, 'operational-json');
  const data = JSON.parse(output.text); assert.equal(data.format, 'dental-clinic-operational-export');
  assert.equal(data.records.patientReceipts.length, snapshot.records.patientReceipts.length); assert.equal(data.readTime, snapshot.readTime);
  assert.match(data.notice, /ليس نسخة استعادة/); assert.doesNotMatch(output.text, /SYNTHETIC_SECRET|SYNTHETIC_IMAGE|SYNTHETIC_JOURNAL/);
  assert.equal('patients' in data, false); assert.equal('users' in data, false); assert.equal('clinicLogo' in data.settings, false);
});
test('CSV is full unified directory regardless of filters, includes file numbers, BOM and formula-safe quoted cells', async () => {
  const snapshot = withDirectory(await full()); snapshot.records.contactRecords[1].data!.name = '=SUM(1,2)';
  const projection = projectCloudClinicOverview(snapshot, range), result = packageCloudOverviewExport(snapshot, projection, 'contacts-csv');
  assert.ok(result.text.startsWith('\uFEFF')); assert.match(result.text, /451 \| 452/); assert.match(result.text, /"'=SUM\(1,2\)"/);
  assert.equal(result.text.split('\r\n').length, 5); assert.doesNotMatch(result.text, /patientAccounts|totalCostCents|synthetic-whole-clinic-owner/);
  assert.throws(() => packageCloudOverviewExport({ ...snapshot, readTime: '2026-10-14T00:00:00.000Z' }, projection, 'contacts-csv'));
});
