import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import { LOCAL_BACKUP_FORMAT, downloadLocalClinicBackup, localBackupSectionSummary, parseLocalClinicBackup, readLocalClinicBackup, serializeLocalClinicBackup } from './localClinicBackup';
import { MAX_BACKUP_BYTES } from './backupValidation';
import { Storage } from './storage';
import { isPasswordHash, verifyPassword } from './passwords';
import { DEFAULT_DRUG_CATALOG, DEFAULT_PATIENT_CROWN_PRICES, DEFAULT_SERVICE_TYPES, DEFAULT_THEME, DEFAULT_TILE_ORDER, DEFAULT_UI_LABELS, DEFAULT_USERS, DEFAULT_WHATSAPP_SETTINGS, INITIAL_APPOINTMENTS, INITIAL_EXPENSES, INITIAL_LAB_CASES, INITIAL_LABS, INITIAL_PATIENTS } from '../data/initialData';

const fixture = () => structuredClone({ patients: INITIAL_PATIENTS, contacts: [], appointments: INITIAL_APPOINTMENTS, labs: INITIAL_LABS,
  labCases: INITIAL_LAB_CASES, expenses: INITIAL_EXPENSES, materialUsages: [], users: DEFAULT_USERS,
  serviceTypes: DEFAULT_SERVICE_TYPES, crownPrices: DEFAULT_PATIENT_CROWN_PRICES, drugCatalog: DEFAULT_DRUG_CATALOG,
  whatsappSettings: DEFAULT_WHATSAPP_SETTINGS, clinicName: 'عيادة اختبار النسخ', clinicLogo: null,
  theme: DEFAULT_THEME, labels: { ...DEFAULT_UI_LABELS, dockAppearance: { size: 'large', showLabels: false, mobileVisibleCount: 3 } }, tileOrder: DEFAULT_TILE_ORDER });

test('full local JSON round trip keeps history/settings and hashes credentials only in the exported copy', async () => {
  const input = fixture();
  input.users[0].password = 'synthetic backup passphrase only';
  const before = structuredClone(input), date = new Date('2026-10-08T09:00:00Z');
  const text = await serializeLocalClinicBackup(input, date), result = parseLocalClinicBackup(text);
  assert.equal(result.exportedAt, date.toISOString()); assert.equal(result.legacy, false);
  assert.deepEqual(result.data.patients, before.patients); assert.deepEqual(result.data.labCases, before.labCases);
  assert.deepEqual(result.data.expenses, before.expenses); assert.deepEqual(result.data.labels, before.labels);
  assert.deepEqual(result.data.tileOrder, before.tileOrder); assert.deepEqual(result.data.contacts, []);
  assert.equal(result.data.clinicName, before.clinicName); assert.deepEqual(input, before, 'export does not mutate persisted-account input');
  for (let i = 0; i < result.data.users!.length; i++) {
    assert.ok(isPasswordHash(result.data.users![i].password));
    if (isPasswordHash(before.users[i].password)) assert.equal(result.data.users![i].password, before.users[i].password);
    else assert.ok(await verifyPassword(result.data.users![i].password, before.users[i].password));
  }
});

test('local backup allowlist excludes runtime/session roots and provider secrets while retaining templates and consent', async () => {
  const input: any = { contacts: [], clinicName: 'اختبار', whatsappSettings: structuredClone(DEFAULT_WHATSAPP_SETTINGS),
    currentUser: { secret: 'PRIVATE_SESSION' }, rememberedSession: 'PRIVATE_REMEMBER', pendingMutations: 'PRIVATE_QUEUE', env: 'PRIVATE_ENV' };
  Object.assign(input.whatsappSettings, { apiKey: 'PRIVATE_PROVIDER', apiToken: 'PRIVATE_TOKEN', access_token: 'PRIVATE_ACCESS', clientSecret: 'PRIVATE_CLIENT', webhookUrl: 'https://PRIVATE_USER:PRIVATE_PASSWORD@example.invalid/hook?token=PRIVATE_URL_TOKEN', nestedConfig: { mode: 'keep', authorization: 'PRIVATE_AUTH' }, campaignConsent: { '201012345678': 'allowed' } });
  const text = await serializeLocalClinicBackup(input);
  assert.doesNotMatch(text, /PRIVATE_/); assert.doesNotMatch(text, /currentUser|rememberedSession|pendingMutations/);
  const preview = parseLocalClinicBackup(text);
  assert.equal(preview.data.whatsappSettings?.apiKey, '');
  assert.equal(preview.data.whatsappSettings?.webhookUrl, '');
  assert.deepEqual(preview.data.whatsappSettings?.templates, input.whatsappSettings.templates);
  assert.deepEqual(preview.data.whatsappSettings?.campaignConsent, input.whatsappSettings.campaignConsent);
  assert.deepEqual((preview.data.whatsappSettings as any).nestedConfig, { mode: 'keep' });
  assert.equal(input.whatsappSettings.apiKey, 'PRIVATE_PROVIDER', 'secret filtering changes only a clone');
});

test('legacy plain JSON is supported without inventing omitted sections and summaries do not expose records', () => {
  const preview = parseLocalClinicBackup('\uFEFF' + JSON.stringify({ contacts: [], clinicName: 'قديم' }));
  assert.equal(preview.legacy, true); assert.equal(preview.exportedAt, null); assert.equal('users' in preview.data, false);
  const summary = localBackupSectionSummary(preview.data);
  assert.equal(summary.find(item => item.key === 'contacts')?.count, 0);
  assert.equal(summary.find(item => item.key === 'patients')?.count, null);
  assert.equal(summary.length, 10);
});

test('corrupt/unknown-version/unsafe/invalid backups are rejected before any write', () => {
  for (const text of ['', 'broken', '[]', 'null', '{}', '{"contacts":{},"clinicName":"x"}', '{"contacts":[],"__proto__":{"polluted":true}}',
    JSON.stringify({ format: LOCAL_BACKUP_FORMAT, version: 9, exportedAt: '2026-10-08T09:00:00Z', data: { contacts: [] } }),
    JSON.stringify({ format: LOCAL_BACKUP_FORMAT, version: 1, exportedAt: 'bad date', data: { contacts: [] } })]) {
    assert.throws(() => parseLocalClinicBackup(text));
  }
  assert.equal(({} as any).polluted, undefined);
});

test('file parsing enforces JSON/UTF-8/declared and actual sizes before retaining preview', async () => {
  const file = new File([JSON.stringify({ contacts: [] })], 'backup.json');
  assert.deepEqual((await readLocalClinicBackup(file)).data.contacts, []);
  await assert.rejects(readLocalClinicBackup(new File([], 'empty.json')), /٦٤ ميجابايت/);
  await assert.rejects(readLocalClinicBackup(new File(['{}'], 'backup.csv')), /JSON/);
  await assert.rejects(readLocalClinicBackup(new File([new Uint8Array([0xff])], 'invalid.json')), /UTF-8/);
  await assert.rejects(readLocalClinicBackup({ name: 'large.json', size: MAX_BACKUP_BYTES + 1, arrayBuffer: () => { throw new Error('must not read'); } } as any), /٦٤ ميجابايت/);
  await assert.rejects(readLocalClinicBackup({ name: 'mismatch.json', size: 2, arrayBuffer: async () => new TextEncoder().encode('{"contacts":[]}').buffer } as any), /غير مطابق/);
});

test('fresh full snapshot ignores stale cache, excludes sessions and rejects malformed persisted sections without writes', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map<string, string>(); let writes = 0;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => values.get(key) ?? null, setItem: () => { writes++; } } });
  try {
    values.set('dental_clinic_name_v2', JSON.stringify('قبل')); assert.equal(Storage.getClinicName(), 'قبل');
    values.set('dental_clinic_name_v2', JSON.stringify('بعد')); values.set('dental_remembered_session_v2', 'PRIVATE_REMEMBER');
    // Fresh clinics no longer inject demo patients. Install an explicit synthetic
    // saved record to test deep-clone isolation, not a runtime fallback.
    values.set('dental_patients_v2', JSON.stringify([INITIAL_PATIENTS[0]]));
    const snapshot = Storage.getBackupDataFresh(); assert.equal(snapshot.clinicName, 'بعد'); assert.equal(Object.keys(snapshot).length, 20);
    assert.equal('rememberedSession' in snapshot, false); assert.equal('currentUser' in snapshot, false);
    (snapshot.patients as any[])[0].name = 'changed clone'; assert.notEqual((Storage.getBackupDataFresh().patients as any[])[0].name, 'changed clone');
    values.set('dental_theme_v2', '{broken'); assert.throws(() => Storage.getBackupDataFresh(), /نسخة ناقصة/);
    assert.equal(values.get('dental_theme_v2'), '{broken'); assert.equal(writes, 0);
  } finally { if (original) Object.defineProperty(globalThis, 'localStorage', original); else Reflect.deleteProperty(globalThis, 'localStorage'); }
});

test('validated JSON uses confirmed restore with rollback on failure and keeps the parsed draft for retry', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map<string, string>([['dental_clinic_name_v2', JSON.stringify('البيانات السابقة')]]);
  let failOnce = true;
  const adapter = { getItem: (key: string) => values.get(key) ?? null, removeItem: (key: string) => values.delete(key), setItem: (key: string, value: string) => {
    if (key === 'dental_theme_v2' && failOnce) { failOnce = false; throw new Error('synthetic quota'); }
    values.set(key, value);
  } };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: adapter });
  try {
    const input = fixture(), draft = parseLocalClinicBackup(await serializeLocalClinicBackup(input));
    const before = new Map(values), unchangedDraft = structuredClone(draft);
    assert.throws(() => Storage.saveBackupConfirmed(draft.data as Record<string, unknown>), /لم تكتمل الاستعادة/);
    assert.deepEqual(values, before); assert.deepEqual(draft, unchangedDraft, 'failed restore does not consume or clear the selected draft');
    Storage.saveBackupConfirmed(draft.data as Record<string, unknown>);
    const restored = Storage.getBackupDataFresh();
    assert.deepEqual(restored.patients, draft.data.patients); assert.deepEqual(restored.contacts, []);
    assert.deepEqual(restored.labels, draft.data.labels); assert.deepEqual(restored.labs, draft.data.labs);
    assert.equal(restored.clinicName, input.clinicName);
    assert.equal(values.has('dental_remembered_session_v2'), false); assert.equal(values.has('dental_current_user_v2'), false);
  } finally { if (original) Object.defineProperty(globalThis, 'localStorage', original); else Reflect.deleteProperty(globalThis, 'localStorage'); }
});

test('download reauthorizes after snapshot/asynchronous credential processing and never clicks after revocation', async () => {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document'), create = URL.createObjectURL, revoke = URL.revokeObjectURL;
  let clicks = 0, calls = 0, snapshots = 0;
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({ click: () => { clicks++; }, remove: () => {} }) } });
  URL.createObjectURL = () => 'blob:synthetic-backup'; URL.revokeObjectURL = () => {};
  const getSnapshot = async () => { snapshots++; return { contacts: [] }; };
  try {
    await assert.rejects(downloadLocalClinicBackup(getSnapshot, () => { throw new Error('denied'); }), /denied/);
    assert.equal(snapshots, 0); assert.equal(clicks, 0);
    await assert.rejects(downloadLocalClinicBackup(getSnapshot, () => { if (++calls === 3) throw new Error('revoked'); }), /revoked/);
    assert.equal(clicks, 0); calls = 0;
    await downloadLocalClinicBackup(getSnapshot, () => { calls++; }); assert.equal(clicks, 1); assert.ok(calls >= 4);
  } finally {
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument); else Reflect.deleteProperty(globalThis, 'document');
    URL.createObjectURL = create; URL.revokeObjectURL = revoke;
  }
});

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const bundle = buildSync({ stdin: { contents: `import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server';
  import {ToastAndConfirmProvider} from './src/components/common/ToastAndConfirm';
  import {DataTransferManagement, LocalBackupRestoreDialog} from './src/components/settings/DataTransferManagement';
  const render=(Component,props)=>renderToStaticMarkup(<ToastAndConfirmProvider><Component {...props}/></ToastAndConfirmProvider>);
  export const renderTransfer=props=>render(DataTransferManagement,props); export const renderRestore=props=>render(LocalBackupRestoreDialog,props);`,
  resolveDir: sourceRoot, sourcefile: 'localBackup.fixture.tsx', loader: 'tsx' }, bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external', loader: { '.css': 'empty' }, logLevel: 'silent' });
const compiled = { exports: {} as { renderTransfer: (props: unknown) => string; renderRestore: (props: unknown) => string } };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);

test('backup controls require full-backup access and restore starts disabled without writes/downloads', () => {
  let operations = 0; const operation = async () => { operations++; };
  const props = { patients: [], contacts: [], canTransferData: true, canViewPatients: true, canManageFullBackup: false, onGetFullBackupSnapshot: operation, onRestoreFullData: operation, onAuthorizeDataExport: operation };
  assert.doesNotMatch(compiled.exports.renderTransfer(props), /نسخة محلية كاملة/);
  assert.match(compiled.exports.renderTransfer({ ...props, canManageFullBackup: true }), /نسخة محلية كاملة/);
  assert.doesNotMatch(compiled.exports.renderTransfer({ ...props, canManageFullBackup: true, canViewPatients: false }), /نسخة محلية كاملة/);
  const markup = compiled.exports.renderRestore({ onAuthorize: operation, onRestore: operation, onClose: operation });
  assert.match(markup, /اختيار الملف ومعاينته لا يغيّر أي بيانات/); assert.match(markup, /accept=".json,application\/json"/);
  assert.match(markup, /disabled=""[^>]*>[\s\S]*?مراجعة وتأكيد الاستعادة/); assert.equal(operations, 0);
});
