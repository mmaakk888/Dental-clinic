import test from 'node:test';
import assert from 'node:assert/strict';
import { cloudImportFileNo, prepareCloudTransferRows, previewCloudTransfer } from './cloudTransferProjection';
import type { PatientImportRow } from './patientSpreadsheets';
import type { CloudClinicSnapshot } from './cloudClinicSnapshot';
import { snapshotId } from './testing/cloudClinicSnapshotFixtures';

const row = (id = '450', name = 'اسم مصطنع', mobile = ''): PatientImportRow => ({ rowNumber: 2, id, name, mobile,
  patient: { id, name, mobile, age: 30, firstVisit: '', gender: undefined, notes: '', allergy: '', sessions: [], payments: [] } });
function snapshot(profiles: Array<{ fileNo: number; name: string; mobile: string }> = [], phones: string[] = []): CloudClinicSnapshot {
  return { readTime: '2026-10-13T00:00:00.123456Z', records: { patientProfiles: profiles.map((p, index) => ({ schemaVersion: 1, clinicId: 'main', recordId: snapshotId(index + 1), fileNo: p.fileNo,
    revision: 1, lastOperationId: snapshotId(999), phoneKey: null, data: { name: p.name, mobile: p.mobile, age: 30, gender: '', firstVisit: '', notes: '', allergy: '' } })),
    contactRecords: phones.map((phone, index) => ({ schemaVersion: 1, clinicId: 'main', recordId: snapshotId(index + 500), revision: 1, deleted: false, lastOperationId: snapshotId(999), phoneKey: 'a'.repeat(64), data: {
      id: snapshotId(index + 500), name: 'جهة مصطنعة', mobile: phone, notes: '', createdAt: '2026-10-13T00:00:00.000Z' } })) } } as CloudClinicSnapshot;
}
test('cloud historical numeric file IDs preserve value and reject identity-changing coercions', () => {
  for (const [source, expected] of [['450', 450], ['٤٥٠', 450], ['۴۵۰', 450], ['2000000000', 2_000_000_000]] as const) assert.equal(cloudImportFileNo(source), expected);
  for (const source of ['', '0', '0450', ' 450', '450 ', 'A450', '4.5', '4e2', '+450', '450\n', '2000000001', 450]) assert.throws(() => cloudImportFileNo(source));
});
test('preview keeps explicit unknown visit date and does not invent sessions money or consent', () => {
  const original = row(), result = previewCloudTransfer('patients', [original], snapshot());
  assert.equal(result.rows[0].profile?.firstVisit, ''); assert.equal(result.rows[0].fileNo, 450); assert.equal(result.readyCount, 1);
  assert.deepEqual(Object.keys(result.rows[0].profile!).sort(), ['age', 'allergy', 'firstVisit', 'gender', 'mobile', 'name', 'notes']);
  assert.equal(Object.isFrozen(result.rows[0].profile), true); assert.equal(Object.isFrozen(original.patient), false);
});
test('patient imported number duplicates skip but same family phone/name warns without merging', () => {
  const first = row('451', 'أحمد', '01000000001'), second = { ...row('451', 'آخر', ''), rowNumber: 3 }, existing = { ...row('450'), rowNumber: 4 };
  const result = previewCloudTransfer('patients', [first, second, existing], snapshot([{ fileNo: 450, name: 'احمد', mobile: '+201000000001' }, { fileNo: 42, name: 'اسم آخر', mobile: '01000000001' }]));
  assert.equal(result.readyCount, 1); assert.equal(result.duplicateCount, 2); assert.deepEqual(result.rows[0].matchingFiles.map(x => x.fileNo), [42, 450]);
  assert.equal(result.rows[0].matchingFiles[1].reason, 'phone-and-name'); assert.equal(result.rows[0].status, 'ready');
});
test('contact preview skips existing/batch canonical phone duplicates and shows linked file numbers', () => {
  const rows = [{ rowNumber: 2, name: 'جديد', mobile: '01000000002', notes: '' }, { rowNumber: 3, name: 'مكرر', mobile: '+201000000002', notes: '' }, { rowNumber: 4, name: 'قديم', mobile: '01000000001', notes: '' }];
  const result = previewCloudTransfer('contacts', rows, snapshot([{ fileNo: 451, name: 'جديد', mobile: '01000000002' }], ['+201000000001']));
  assert.equal(result.readyCount, 1); assert.equal(result.duplicateCount, 2); assert.equal(result.rows[0].matchingFiles[0].fileNo, 451);
  assert.equal(result.rows[0].contact?.notes, ''); assert.match(result.rows[0].message, /دون إنشاء ملف أو دمج/);
});
test('cloud incompatible limits/dates/clinical payloads are rejected rather than truncated or inferred', () => {
  for (const change of [{ notes: 'a'.repeat(4001) }, { allergy: 'a'.repeat(1001) }, { firstVisit: '2026-02-30' }, { sessions: [{}] }, { payments: [{}] }, { age: 121 }]) {
    const input = row(); Object.assign(input.patient!, change); const result = previewCloudTransfer('patients', [input], snapshot());
    assert.equal(result.invalidCount, 1); assert.equal(result.rows[0].profile, null);
  }
});
test('prepare captures detached rows and rejects sparse/getter/prototype/extreme payload inputs without executing accessors', () => {
  const input = row(), copy = prepareCloudTransferRows('patients', [input]) as PatientImportRow[]; input.patient!.name = 'changed';
  assert.equal(copy[0].patient!.name, 'اسم مصطنع'); assert.equal(Object.isFrozen(copy[0].patient), true);
  let touched = false; const hostile = { ...row() }; Object.defineProperty(hostile, 'name', { enumerable: true, get: () => { touched = true; return ''; } });
  for (const values of [[hostile], new Array(1), Array.from({ length: 5001 }, () => row()), [Object.assign(Object.create({}), row())]]) assert.throws(() => prepareCloudTransferRows('patients', values));
  assert.equal(touched, false);
  assert.throws(() => prepareCloudTransferRows('contacts', Array.from({ length: 1000 }, (_, index) => ({ rowNumber: index + 1, name: 'a'.repeat(10_000), mobile: '', notes: '' }))));
});
test('many family file matches have exact count and an explicitly bounded preview sample', () => {
  const result = previewCloudTransfer('patients', [row('999', 'جديد', '01000000001')], snapshot(Array.from({ length: 100 }, (_, i) => ({ fileNo: i + 1, name: `مصطنع ${i}`, mobile: '01000000001' }))));
  assert.equal(result.rows[0].matchingFileCount, 100); assert.equal(result.rows[0].matchingFiles.length, 20); assert.equal(result.readyCount, 1);
});
test('duplicate row identities and imported financial/account fields fail strict source shape checks', () => {
  assert.throws(() => previewCloudTransfer('patients', [row(), row()], snapshot()));
  assert.throws(() => prepareCloudTransferRows('patients', [{ ...row(), balance: 100 }] as any));
  const input = row(); (input.patient as any).totalPaid = 100; assert.throws(() => prepareCloudTransferRows('patients', [input]));
});
