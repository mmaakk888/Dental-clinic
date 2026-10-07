import test from 'node:test';
import assert from 'node:assert/strict';
import type { ClinicContact, Patient } from '../types';
import { applyContactImport, MAX_CONTACT_IMPORT_CELL_CHARACTERS, MAX_CONTACT_IMPORT_ROWS, previewContactImport } from './contactTransfer';
import type { ContactImportInput } from './contactTransfer';

const timestamp = '2026-10-07T12:00:00.000Z';
const row = (changes: Partial<ContactImportInput> = {}): ContactImportInput => ({ rowNumber: 2, name: 'أحمد تجريبي', mobile: '01012345678', notes: '', ...changes });
const contact = (changes: Partial<ClinicContact> = {}): ClinicContact => ({ id: 'existing-contact', name: 'اسم محفوظ', mobile: '01112345678', notes: 'ملاحظة محفوظة', createdAt: timestamp, ...changes });
const patient = (id: string, mobile: string): Patient => ({ id, name: `مريض تجريبي ${id}`, mobile, age: 30, firstVisit: '', notes: '', allergy: '', sessions: [], payments: [] });
const options = () => { let id = 0; return { createdAt: timestamp, createId: () => `new-contact-${++id}` }; };

test('contact import preview counts new, existing, batch duplicates and invalid rows without mutation', () => {
  const existing = [contact()];
  const inputs = [row(), row({ rowNumber: 3, mobile: '+201012345678', notes: 'لا تستبدل الأول' }),
    row({ rowNumber: 4, mobile: '٠١١١٢٣٤٥٦٧٨' }), row({ rowNumber: 5, name: '' }), row({ rowNumber: 6, mobile: '01212345678' })];
  const before = structuredClone({ existing, inputs });
  const result = previewContactImport(inputs, existing, []);
  assert.deepEqual({ newCount: result.newCount, duplicateCount: result.duplicateCount, invalidCount: result.invalidCount },
    { newCount: 2, duplicateCount: 2, invalidCount: 1 });
  assert.deepEqual(result.rows.map(item => item.status), ['new', 'duplicate', 'duplicate', 'invalid', 'new']);
  assert.match(result.rows[1].message, /الصف 2/);
  assert.match(result.rows[2].message, /اسم محفوظ/);
  assert.deepEqual({ existing, inputs }, before);
});

test('preview matches all shared family files by equivalent full phone, never names or near digits', () => {
  const inputs = [row({ mobile: '٠٠٢٠١٠١٢٣٤٥٦٧٨' }), row({ rowNumber: 3, mobile: '01012345679' }), row({ rowNumber: 4, mobile: '010123' })];
  const patients = [patient('401', '01012345678'), patient('٤٠٢', '+201012345678'), patient('403', '01012345679'), patient('404', '01199999999')];
  patients[3].name = inputs[0].name;
  const before = structuredClone(patients);
  const result = previewContactImport(inputs, [], patients);
  assert.deepEqual(result.rows.map(item => item.patientIds), [['401', '٤٠٢'], ['403'], []]);
  assert.equal(result.rows[0].status, 'new', 'having a patient file does not prevent an explicit contact import');
  result.rows[0].patientIds.push('unrelated');
  assert.deepEqual(patients, before);
});

test('phone formats deduplicate Arabic, Persian, +20 and 0020 while invalid rows do not reserve phones', () => {
  const inputs = [row({ name: '' }), row({ rowNumber: 3 }), row({ rowNumber: 4, mobile: '۰۱۰۱۲۳۴۵۶۷۸' }),
    row({ rowNumber: 5, mobile: '+20 1012345678' }), row({ rowNumber: 6, mobile: '00201012345678' })];
  const preview = previewContactImport(inputs, [], []);
  assert.deepEqual(preview.rows.map(item => item.status), ['invalid', 'new', 'duplicate', 'duplicate', 'duplicate']);
  const saved = applyContactImport([], inputs, options());
  assert.equal(saved.addedCount, 1); assert.equal(saved.duplicateCount, 3); assert.equal(saved.invalidCount, 1);
  assert.equal(saved.contacts[0].name, inputs[1].name);
});

test('invalid field contents are skipped explicitly using the normal contact validation limits', () => {
  const inputs = [row({ name: 'n'.repeat(201) }), row({ rowNumber: 3, name: 'اسم\nمخفي' }), row({ rowNumber: 4, mobile: 'abc01012345678' }),
    row({ rowNumber: 5, mobile: '0101234567' }), row({ rowNumber: 6, notes: 'n'.repeat(2001) }), row({ rowNumber: 7, notes: '\u0000' }),
    row({ rowNumber: 8, mobile: '' }), row({ rowNumber: 9, name: '  ' }), row({ rowNumber: 10, notes: 'سطر أول\nثانٍ' })];
  const preview = previewContactImport(inputs, [], []);
  assert.equal(preview.invalidCount, 8); assert.equal(preview.newCount, 1);
  const saved = applyContactImport([], inputs, options());
  assert.equal(saved.invalidCount, 8); assert.equal(saved.addedCount, 1); assert.equal(saved.duplicateCount, 0);
  assert.equal(saved.contacts[0].notes, 'سطر أول\nثانٍ');
});

test('apply re-evaluates fresh saved contacts instead of trusting an older preview', () => {
  const inputs = [row()];
  assert.equal(previewContactImport(inputs, [], []).newCount, 1);
  const latest = [contact({ mobile: '+201012345678', name: 'أضيف من تبويب آخر' })];
  let idCalls = 0;
  const saved = applyContactImport(latest, inputs, { createdAt: timestamp, createId: () => { idCalls++; return 'unused'; } });
  assert.equal(saved.addedCount, 0); assert.equal(saved.duplicateCount, 1); assert.equal(idCalls, 0);
  assert.deepEqual(saved.contacts, latest);
});

test('apply appends valid contacts in source order without changing existing notes or unknown metadata', () => {
  const existing = [{ ...contact(), future: { tags: ['keep'] } }];
  const inputs = [row({ name: '  أحمد   علي  ', mobile: ' 01012345678 ', notes: '  ملاحظة مستوردة  ' }),
    row({ rowNumber: 3, mobile: '+201112345678', name: 'لا تستبدل الاسم', notes: 'لا تستبدل الملاحظة' }),
    row({ rowNumber: 4, mobile: '01212345678', name: 'اسم آخر' })];
  const before = structuredClone({ existing, inputs });
  const result = applyContactImport(existing, inputs, options());
  assert.equal(result.addedCount, 2); assert.equal(result.duplicateCount, 1); assert.equal(result.invalidCount, 0);
  assert.equal(result.contacts[0], existing[0]);
  assert.equal(result.contacts[0].notes, 'ملاحظة محفوظة');
  assert.deepEqual((result.contacts[0] as typeof existing[0]).future, { tags: ['keep'] });
  assert.deepEqual(result.contacts.slice(1).map(item => [item.id, item.name, item.mobile, item.notes, item.createdAt]), [
    ['new-contact-1', 'أحمد علي', '01012345678', 'ملاحظة مستوردة', timestamp],
    ['new-contact-2', 'اسم آخر', '01212345678', '', timestamp],
  ]);
  assert.deepEqual({ existing, inputs }, before);
  for (const record of result.contacts.slice(1)) {
    assert.equal('sessions' in record, false); assert.equal('payments' in record, false);
    assert.equal('campaignConsent' in record, false); assert.equal('patientIds' in record, false);
  }
});

test('ID conflicts with existing or earlier batch IDs reject atomically without modifying inputs', () => {
  const existing = [contact()];
  const inputs = [row(), row({ rowNumber: 3, mobile: '01212345678' })];
  const before = structuredClone({ existing, inputs });
  assert.throws(() => applyContactImport(existing, inputs, { createdAt: timestamp, createId: () => existing[0].id }), /معرّف.*مكرر/);
  assert.throws(() => applyContactImport(existing, inputs, { createdAt: timestamp, createId: () => 'same-new-id' }), /معرّف.*مكرر/);
  let calls = 0;
  assert.throws(() => applyContactImport(existing, inputs, { createdAt: timestamp, createId: () => { if (++calls === 2) throw new Error('ID failed'); return 'first-new-id'; } }), /ID failed/);
  assert.deepEqual({ existing, inputs }, before);
});

test('invalid generated IDs and import metadata fail before a result is published', () => {
  const inputs = [row()];
  for (const id of ['', 'has spaces', 'x'.repeat(201), null, 4]) {
    assert.throws(() => applyContactImport([], inputs, { createdAt: timestamp, createId: (() => id) as any }));
  }
  for (const badOptions of [null, [], { createId: 'not-function' }, { createdAt: null }, { createdAt: 'yesterday' }, { createdAt: '2026-02-31T12:00:00.000Z' }]) {
    assert.throws(() => applyContactImport([], inputs, badOptions as any));
  }
  assert.deepEqual(inputs, [row()]);
});

test('oversized, malformed or sparse payloads are rejected, not partially applied or silently coerced', () => {
  const sparse = new Array(2); sparse[1] = row();
  const badInputs: unknown[] = [null, {}, 'not rows', [null], sparse, [row({ rowNumber: 0 })], [row({ rowNumber: 1.5 })],
    [row({ rowNumber: Number.MAX_SAFE_INTEGER + 1 })], [{ ...row(), name: 4 }], [{ ...row(), mobile: 1012345678 }],
    [{ ...row(), notes: undefined }], Array.from({ length: MAX_CONTACT_IMPORT_ROWS + 1 }, () => row())];
  const existing = [contact()];
  for (const inputs of badInputs) {
    assert.throws(() => previewContactImport(inputs as any, existing, []));
    assert.throws(() => applyContactImport(existing, inputs as any, options()));
  }
  assert.deepEqual(existing, [contact()]);
});

test('maximum allowed batch and empty batch work without truncation or manufactured patient data', () => {
  const inputs = Array.from({ length: MAX_CONTACT_IMPORT_ROWS }, (_, index) => row({ rowNumber: index + 2, mobile: `010${String(index).padStart(8, '0')}` }));
  const preview = previewContactImport(inputs, [], []);
  assert.equal(preview.newCount, MAX_CONTACT_IMPORT_ROWS); assert.equal(preview.rows.length, MAX_CONTACT_IMPORT_ROWS);
  const saved = applyContactImport([], inputs, options());
  assert.equal(saved.addedCount, MAX_CONTACT_IMPORT_ROWS); assert.equal(saved.contacts.length, MAX_CONTACT_IMPORT_ROWS);
  assert.deepEqual(previewContactImport([], [], []), { rows: [], newCount: 0, duplicateCount: 0, invalidCount: 0 });
  assert.deepEqual(applyContactImport([], [], options()), { contacts: [], addedCount: 0, duplicateCount: 0, invalidCount: 0 });
});

test('extreme cell and total UTF-8 text budgets are refused before generating any ID', () => {
  const enormousCell = [row({ notes: 'x'.repeat(MAX_CONTACT_IMPORT_CELL_CHARACTERS + 1) })];
  const enormousText = Array.from({ length: 850 }, (_, index) => row({ rowNumber: index + 2,
    mobile: `010${String(index).padStart(8, '0')}`, notes: 'x'.repeat(MAX_CONTACT_IMPORT_CELL_CHARACTERS) }));
  // Arabic letters take more than one byte. The budget is bytes, not UTF-16 length.
  const enormousArabicText = Array.from({ length: 425 }, (_, index) => row({ rowNumber: index + 2,
    mobile: `010${String(index).padStart(8, '0')}`, notes: 'م'.repeat(MAX_CONTACT_IMPORT_CELL_CHARACTERS) }));
  let idCalls = 0;
  for (const inputs of [enormousCell, enormousText, enormousArabicText]) {
    assert.throws(() => previewContactImport(inputs, [], []));
    assert.throws(() => applyContactImport([], inputs, { createdAt: timestamp, createId: () => { idCalls++; return 'must-not-run'; } }));
  }
  assert.equal(idCalls, 0);
});

test('extra source columns are not persisted as clinical or consent metadata', () => {
  const source = { ...row(), patientIds: ['401'], sessions: [{ amount: 99 }], campaignConsent: 'allowed', id: 'unsafe-imported-id', createdAt: 'yesterday' };
  const saved = applyContactImport([], [source], options());
  assert.deepEqual(Object.keys(saved.contacts[0]).sort(), ['createdAt', 'id', 'mobile', 'name', 'notes']);
  assert.equal(saved.contacts[0].id, 'new-contact-1');
});
