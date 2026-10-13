import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudPrescriptionWorkspaceController } from './cloudPrescriptionWorkspaceController';
import type { CloudClinicalCapability } from './cloudClinicalWorkspaceController';
import type { FirebaseCloudClinicSettingsCapability } from './firebaseCloudClinicSettings';

const ID = '90000000-0000-4000-8000-000000000001', OP = '90000000-0000-4000-8000-000000000002';
const sections = ['patients', 'contacts', 'appointments', 'lab', 'summary', 'settings'];
function settings() { return { schemaVersion: 1, clinicId: 'main', recordId: 'clinicSettings', revision: 1, lastOperationId: OP,
  data: { identity: { clinicName: 'عيادة مصطنعة', doctorName: 'طبيب مصطنع', phone: '201012345678', address: 'عنوان مصطنع', logoRecordId: null },
    theme: { primary: '#2563eb', secondary: '#1d4ed8', accent: '#f59e0b', background: '#f8fafc', fontFamily: "'Cairo', sans-serif", customFontUrl: null },
    content: { homeSubtitle: '', welcomeText: '', tiles: Object.fromEntries(sections.map(key => [key, { title: key, desc: '' }])),
      tabs: { info: 'البيانات', chart: 'الأسنان', sessions: 'الجلسات', finance: 'الحساب', lab: 'المعمل' },
      navigationLabels: Object.fromEntries(['home', ...sections].map(key => [key, key])),
      mobile: { order: sections, size: 'comfortable', showLabels: true, visibleCount: 4, moreSections: ['settings'] },
      desktop: { order: sections, size: 'large', showLabels: true },
      homeLayout: { sectionOrder: ['actions', 'metrics', 'schedule', 'followUp'], hiddenSections: [], density: 'compact', appointmentLimit: 6 } },
    medications: [{ medicationId: OP, name: 'دواء مصطنع غير طبي', category: '', defaultDosage: '', defaultDuration: '', active: true },
      { medicationId: ID, name: 'دواء غير نشط', category: '', defaultDosage: '', defaultDuration: '', active: false }],
    whatsapp: { senderNumber: '', autoConfirmOnAppt: false, autoRemind24h: false, autoPostOpOnAttended: false, templates: [] } } }; }
function deferred() { let resolve!: () => void; const promise = new Promise<void>(accept => { resolve = accept; }); return { promise, resolve }; }
function harness() {
  let active = true;
  const state: { settings: any; profile: any; logo: any } = { settings: settings(), logo: null,
    profile: { schemaVersion: 1, clinicId: 'main', recordId: ID, fileNo: 451, revision: 1, lastOperationId: OP, phoneKey: null,
      data: { name: 'مريض مصطنع', mobile: '', age: 30, gender: '', firstVisit: '2026-10-13', notes: '', allergy: '' } } };
  const calls: string[] = [], hooks: { read?: (key: string) => Promise<void> | void } = {};
  const read = async (key: string, data: () => unknown) => { calls.push(key); await hooks.read?.(key); return structuredClone(data()); };
  const clinical = { repository: { getProfile: () => read('profile', () => state.profile), getAccount: () => read('account', () => null),
    listSessions: () => read('sessions', () => ({ records: [], nextAfterId: null })), listReceipts: () => read('receipts', () => ({ records: [], nextAfterId: null })) },
  } as unknown as CloudClinicalCapability;
  const config = { repository: { get: () => read('settings', () => state.settings), getLogo: () => read('logo', () => state.logo) } } as unknown as FirebaseCloudClinicSettingsCapability;
  const controller = createCloudPrescriptionWorkspaceController({ isActive: () => active,
    getClinical: async () => { calls.push('clinical-cap'); return clinical; }, getSettings: async () => { calls.push('settings-cap'); return config; } });
  return { controller, state, calls, hooks, close: () => { active = false; } };
}
test('Rx controller construction is inert and requires explicit UUID load without local defaults', async () => {
  const h = harness(); h.controller.subscribe(() => undefined); assert.deepEqual(h.calls, []);
  assert.equal(await h.controller.load('451'), false); assert.deepEqual(h.calls, []);
  assert.equal(await h.controller.load(ID), true); const doc = h.controller.getState().document!;
  assert.equal(doc.clinicName, 'عيادة مصطنعة'); assert.equal(doc.header.doctorName, 'طبيب مصطنع');
  assert.equal(doc.patient.id, '451'); assert.deepEqual(doc.patient.sessions, []); assert.equal(doc.medications.length, 1);
  assert.equal(doc.clinicLogo, null); assert.equal(Object.isFrozen(doc.header), true);
});
test('unknown settings, missing referenced logo and changed metadata fence produce no Rx or invented identity', async () => {
  for (const scenario of ['unknown', 'logo', 'changed'] as const) {
    const h = harness();
    if (scenario === 'unknown') h.state.settings = null;
    if (scenario === 'logo') h.state.settings.data.identity.logoRecordId = 'clinicLogo';
    if (scenario === 'changed') { let once = true; h.hooks.read = key => { if (key === 'profile' && once) { once = false; h.state.settings.revision++; } }; }
    assert.equal(await h.controller.load(ID), false); assert.equal(h.controller.getState().document, null);
    assert.doesNotMatch(h.controller.getState().error, /عبدالكريم|4338/);
  }
});
test('same explicit protected logo bytes feed canonical Rx without mirroring or remote asset substitution', async () => {
  const h = harness(); h.state.settings.data.identity.logoRecordId = 'clinicLogo';
  h.state.logo = { schemaVersion: 1, clinicId: 'main', recordId: 'clinicLogo', revision: 1, lastOperationId: OP,
    data: { mimeType: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZNsAAAAASUVORK5CYII=', width: 1, height: 1 } };
  assert.equal(await h.controller.load(ID), true);
  assert.equal(h.controller.getState().document!.clinicLogo, `data:image/png;base64,${h.state.logo.data.base64}`);
});
test('each output freshly reads protected identity/settings; changed state denies output rather than using old props', async () => {
  const h = harness(); await h.controller.load(ID); const doc = h.controller.getState().document!; h.calls.length = 0;
  await h.controller.authorizeOutput(doc); assert.ok(h.calls.includes('settings')); assert.ok(h.calls.includes('profile'));
  h.state.profile.revision++;
  await assert.rejects(h.controller.authorizeOutput(doc)); assert.equal(h.controller.getState().outputPending, false);
});
test('output preflight owns navigation and deduplicates concurrent gestures before any provider call', async () => {
  const h = harness(); await h.controller.load(ID); const doc = h.controller.getState().document!, gate = deferred();
  h.hooks.read = key => key === 'settings' ? gate.promise : undefined;
  const pending = h.controller.authorizeOutput(doc); assert.equal(h.controller.getState().outputPending, true);
  await assert.rejects(h.controller.authorizeOutput(doc)); assert.equal(h.controller.canClose(), false);
  assert.equal(h.controller.discard(doc), false); gate.resolve(); await pending;
  h.controller.assertOutputActive(doc); assert.equal(h.controller.discard(doc), true); assert.equal(h.controller.canClose(), true);
  assert.throws(() => h.controller.assertOutputActive(doc));
});
test('old document handles cannot discard or authorize a freshly reopened Rx', async () => {
  const h = harness(); await h.controller.load(ID); const old = h.controller.getState().document!;
  assert.equal(await h.controller.load(ID), false); assert.equal(h.controller.discard(old), true);
  await h.controller.load(ID); const next = h.controller.getState().document!; assert.notEqual(next, old);
  assert.equal(h.controller.discard(old), false); await assert.rejects(h.controller.authorizeOutput(old));
  h.controller.assertOutputActive(next);
});
test('real view loss during load or output suppresses late results and permanently clears the Rx context', async () => {
  for (const phase of ['load', 'output'] as const) {
    const h = harness(), gate = deferred(); if (phase === 'output') await h.controller.load(ID);
    h.hooks.read = key => key === 'settings' ? gate.promise : undefined;
    const work = phase === 'load' ? h.controller.load(ID) : h.controller.authorizeOutput(h.controller.getState().document!);
    void work.catch(() => undefined); h.close(); gate.resolve();
    if (phase === 'load') assert.equal(await work, false); else await assert.rejects(work);
    assert.equal(h.controller.getState().document, null); assert.equal(h.controller.getState().closed, true);
    assert.equal(await h.controller.load(ID), false);
  }
});
test('Rx disposal cannot erase a server document or preserve patient memory after logout', async () => {
  const h = harness(); await h.controller.load(ID); const original = structuredClone(h.state);
  h.controller.dispose(); h.controller.dispose(); assert.equal(h.controller.getState().closed, true);
  assert.equal(h.controller.getState().document, null); assert.deepEqual(h.state, original);
  assert.ok(h.calls.every(call => !/commit|write|delete|intent/.test(call)));
});
