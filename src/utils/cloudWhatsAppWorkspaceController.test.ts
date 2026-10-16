import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudClinicSnapshotReader } from './cloudClinicSnapshot';
import { makeClinicSnapshotFixture, snapshotDigest, snapshotId, SNAPSHOT_WHEN } from './testing/cloudClinicSnapshotFixtures';
import { createCloudWhatsAppWorkspaceController, renderCloudWhatsAppDraft } from './cloudWhatsAppWorkspaceController';

const PHONE = '201000000001', PATIENT = snapshotId(900), CONTACT = snapshotId(101);
async function harness() {
  const fixture = await makeClinicSnapshotFixture();
  const snapshot = structuredClone(await createCloudClinicSnapshotReader(fixture.adapter, { digest: snapshotDigest }).readFull());
  for (const profile of [snapshot.records.patientProfiles[0], snapshot.patients[0].profile]) {
    profile.data.mobile = '01000000001'; profile.phoneKey = 'a'.repeat(64);
  }
  snapshot.patients[0].patient.mobile = '01000000001';
  snapshot.settings.clinicSettings.data.whatsapp.templates = [
    { templateId: snapshotId(102), key: 'accountBalance', title: 'الحساب', text: 'أهلًا {patientName}، ملف {fileNo}، المتبقي {remainingBalance}' },
    { templateId: snapshotId(103), key: 'newAppt', title: 'الموعد', text: 'موعدك {date} الساعة {time}' },
    { templateId: snapshotId(104), key: 'greeting', title: 'معايدة', text: 'أهلًا {patientName} من {clinicName}' },
  ];
  snapshot.records.contactRecords.push({ schemaVersion: 1, clinicId: 'main', recordId: CONTACT, revision: 1, deleted: false,
    lastOperationId: snapshotId(999), phoneKey: 'b'.repeat(64), data: { id: CONTACT, name: 'اسم موافقة مصطنع', mobile: '01000000001', createdAt: SNAPSHOT_WHEN,
      campaignConsent: { status: 'allowed', phone: PHONE, recordedAt: SNAPSHOT_WHEN } } });
  let active = true, ms = 1000; const calls: string[] = [];
  let current = snapshot, settings = structuredClone(snapshot.settings.clinicSettings), profile = structuredClone(snapshot.patients[0].profile);
  let account = structuredClone(snapshot.records.patientAccounts[0]), contact = structuredClone(snapshot.records.contactRecords[0]);
  let onClock: (() => void) | null = null;
  const controller = createCloudWhatsAppWorkspaceController({ ownerUid: 'synthetic-wa-owner', isActive: () => active,
    newId: () => snapshotId(110), now: () => SNAPSHOT_WHEN, nowMs: () => { onClock?.(); return ms; },
    getSnapshot: async () => { calls.push('snapshot-cap'); return { readFull: async () => { calls.push('snapshot-read'); return current; } }; },
    getSettings: async () => { calls.push('settings-cap'); return { repository: { get: async () => { calls.push('settings-read'); return settings; } } } as any; },
    getClinical: async () => { calls.push('clinical-cap'); return { repository: { getProfile: async () => { calls.push('profile-read'); return profile; }, getAccount: async () => { calls.push('account-read'); return account; } } } as any; },
    getContacts: async () => { calls.push('contacts-cap'); return { get: async () => { calls.push('contact-read'); return contact; } } as any; },
  });
  const begin = (patientRecordId: string | null = PATIENT, templateId: string | null = null, mode: 'individual' | 'campaign' = 'individual') => {
    assert.equal(controller.beginMessage({ phone: PHONE, patientRecordId, templateId, mode }), true);
    return controller.getState().draft!;
  };
  return { controller, snapshot, calls, begin, active: (value: boolean) => { active = value; }, clock: (value: number) => { ms = value; },
    onClock: (value: (() => void) | null) => { onClock = value; }, settings: () => settings, profile: () => profile, account: () => account, contact: () => contact,
    current: (value: typeof snapshot) => { current = value; } };
}

test('construction/subscription/render helpers do not initialize capabilities or read storage', async () => {
  const h = await harness(), unsub = h.controller.subscribe(() => {});
  h.controller.setTab('campaigns'); h.controller.setQuery('اسم'); assert.equal(h.controller.canClose(), true);
  assert.deepEqual(h.calls, []); unsub(); assert.equal(await h.controller.refresh(), true);
  assert.deepEqual(h.calls, ['snapshot-cap', 'snapshot-read']); assert.equal(h.controller.getState().projection!.counts.patients, 1);
});

test('explicit file message resolves account tokens, freshly fences settings/profile/account, emits one-use manual output', async () => {
  const h = await harness(); await h.controller.refresh(); const draft = h.begin(PATIENT, snapshotId(102));
  const output = await h.controller.prepareOutput(draft); assert.ok(output); assert.match(output.text, /451/); assert.match(output.text, /2750\.00 ج.م/);
  assert.match(output.url, /^https:\/\/wa.me\/201000000001\?text=/); assert.equal(h.calls.filter(v => v === 'snapshot-read').length, 1);
  assert.deepEqual(h.calls.slice(2), ['settings-cap', 'settings-read', 'clinical-cap', 'profile-read', 'account-read', 'settings-read']);
  assert.equal(h.controller.consumeOutput({ ...output }), null); assert.equal(h.controller.consumeOutput(output), output); assert.equal(h.controller.consumeOutput(output), null);
  assert.doesNotMatch(h.controller.getState().notice, /تم الإرسال|تم الوصول/);
});

test('standalone and campaign messages never inherit file identity or financial values', async () => {
  const h = await harness(); await h.controller.refresh();
  assert.equal(h.controller.beginMessage({ phone: PHONE, patientRecordId: null, templateId: snapshotId(102), mode: 'individual' }), true);
  const draft = h.controller.getState().draft!; assert.equal(await h.controller.prepareOutput(draft), null);
  assert.equal(h.controller.cancelDraft(draft), true);
  assert.equal(h.controller.beginMessage({ phone: PHONE, patientRecordId: PATIENT, templateId: null, mode: 'campaign' }), false);
  const campaign = h.begin(null, null, 'campaign'); h.controller.updateDraft({ text: 'رصيد {remainingBalance} ملف {fileNo}' }, campaign);
  assert.equal(await h.controller.prepareOutput(h.controller.getState().draft!), null);
});

test('a shared number requires the exact explicit file ID; display name or public number is not authority', async () => {
  const h = await harness(); await h.controller.refresh();
  for (const patientRecordId of ['451', snapshotId(999)]) assert.equal(h.controller.beginMessage({ phone: PHONE, patientRecordId, templateId: null, mode: 'individual' }), false);
  assert.equal(h.controller.beginMessage({ phone: '01000000001', patientRecordId: PATIENT, templateId: null, mode: 'individual' }), false);
  assert.equal(h.controller.beginMessage({ phone: '201000000002', patientRecordId: PATIENT, templateId: null, mode: 'individual' }), false);
});

for (const domain of ['settings', 'profile', 'account'] as const) test(`changed ${domain} invalidates output before any native action`, async () => {
  const h = await harness(); await h.controller.refresh(); const draft = h.begin(PATIENT, snapshotId(102));
  h[domain]().revision++; assert.equal(await h.controller.prepareOutput(draft), null); assert.equal(h.controller.getState().output, null);
});

test('campaign and greeting re-read explicit phone-bound consent and reject revocation', async () => {
  const h = await harness(); await h.controller.refresh(); const draft = h.begin(null, snapshotId(104), 'campaign');
  assert.ok(await h.controller.prepareOutput(draft)); assert.equal(h.calls.filter(v => v === 'contact-read').length, 1);
  h.contact().data!.campaignConsent!.status = 'declined'; assert.equal(await h.controller.prepareOutput(draft), null);
});

test('manual reminders require a real complete date/time, not unresolved or bracketed template text', async () => {
  const h = await harness(); await h.controller.refresh(); let draft = h.begin(null, snapshotId(103));
  assert.equal(await h.controller.prepareOutput(draft), null);
  h.controller.updateDraft({ date: '2026-02-30', time: '25:00' }, draft); draft = h.controller.getState().draft!;
  assert.equal(await h.controller.prepareOutput(draft), null);
  h.controller.updateDraft({ date: '2026-10-14', time: '10:30' }, draft); draft = h.controller.getState().draft!;
  assert.ok(await h.controller.prepareOutput(draft));
});

test('recorded appointment is fenced by a fresh complete read; manual date needs no whole read', async () => {
  const h = await harness(); await h.controller.refresh(); let draft = h.begin(PATIENT, snapshotId(103));
  assert.equal(h.controller.chooseAppointment(snapshotId(19), draft), true); draft = h.controller.getState().draft!;
  const changed = structuredClone(h.snapshot); changed.records.appointmentRecords[0].revision++; h.current(changed);
  assert.equal(await h.controller.prepareOutput(draft), null);
  assert.equal(h.calls.filter(v => v === 'snapshot-read').length, 2);
});

for (const patch of [{ text: 'قيمة {unknown}' }, { text: 'أكمل [المعلومة]' }, { text: 'نص\u202eخفي' }, { text: 'رسالة', link: 'javascript:alert(1)' }, { text: 'رسالة', link: 'https://user:pass@example.com' }]) {
  test(`invalid or unfinished manual message is not output: ${JSON.stringify(patch)}`, async () => {
    const h = await harness(); await h.controller.refresh(); const draft = h.begin(null); h.controller.updateDraft(patch, draft);
    assert.equal(await h.controller.prepareOutput(h.controller.getState().draft!), null);
  });
}

test('ordinary manual text permits a valid URL without inventing an API send or campaign consent', async () => {
  const h = await harness(); await h.controller.refresh(); const draft = h.begin(null);
  h.controller.updateDraft({ text: 'تعليمات الطبيب المراجعة', link: 'https://example.com/info' }, draft);
  const output = await h.controller.prepareOutput(h.controller.getState().draft!); assert.ok(output); assert.match(output.text, /https:\/\/example.com\/info$/);
  assert.equal(h.calls.includes('clinical-cap'), false); assert.equal(h.calls.includes('contacts-cap'), false);
});

for (const ms of [999, 31_001, NaN]) test(`expired/backward/invalid clock never releases prepared output (${ms})`, async () => {
  const h = await harness(); await h.controller.refresh(); const draft = h.begin(null); h.controller.updateDraft({ text: 'رسالة' }, draft);
  const output = await h.controller.prepareOutput(h.controller.getState().draft!); assert.ok(output); h.clock(ms);
  assert.equal(h.controller.consumeOutput(output), null);
});

test('stale draft callbacks and reentrant output observers cannot mutate or release a different draft', async () => {
  const h = await harness(); await h.controller.refresh(); const original = h.begin(null); h.controller.updateDraft({ text: 'رسالة' }, original);
  const draft = h.controller.getState().draft!; assert.equal(h.controller.updateDraft({ text: 'قديم' }, original), false);
  let changed = false; h.controller.subscribe(state => { if (state.output && !changed) { changed = true; h.controller.updateDraft({ text: 'جديد' }, draft); } });
  assert.equal(await h.controller.prepareOutput(draft), null); assert.equal(h.controller.getState().output, null);
});

test('reentrant clock and actual lifetime loss permanently revoke private output', async () => {
  const h = await harness(); await h.controller.refresh(); const original = h.begin(null); h.controller.updateDraft({ text: 'رسالة' }, original);
  const draft = h.controller.getState().draft!, output = await h.controller.prepareOutput(draft); assert.ok(output);
  h.onClock(() => { h.controller.cancelDraft(draft); }); assert.equal(h.controller.consumeOutput(output), null);
  h.active(false); assert.equal(h.controller.getState().closed, true); assert.equal(h.controller.getState().snapshot, null);
  h.active(true); assert.equal(await h.controller.refresh(), false); assert.equal(h.controller.consent.getState().closed, true);
});

test('throwing or reentrant output clocks do not leak output or recurse', async () => {
  const h = await harness(); await h.controller.refresh(); const original = h.begin(null); h.controller.updateDraft({ text: 'رسالة' }, original);
  const draft = h.controller.getState().draft!, output = await h.controller.prepareOutput(draft); assert.ok(output);
  h.onClock(() => { assert.equal(h.controller.consumeOutput(output), null); });
  assert.equal(h.controller.consumeOutput(output), output);
  h.onClock(null); const second = await h.controller.prepareOutput(draft); assert.ok(second);
  h.onClock(() => { throw Error('PRIVATE_CLOCK_FAILURE'); }); assert.equal(h.controller.consumeOutput(second), null);
  assert.equal(h.controller.getState().output, null); assert.doesNotMatch(h.controller.getState().error, /PRIVATE_CLOCK_FAILURE/);
});

test('explicit consent creates a contact draft only; it does not create a patient, infer identity, or write on selection', async () => {
  const h = await harness(); h.snapshot.records.contactRecords = []; await h.controller.refresh();
  assert.equal(h.controller.beginConsent(PHONE, 'allowed'), true); const consent = h.controller.consent.getState().draft!;
  assert.equal(consent.action, 'create'); assert.equal(consent.contact!.campaignConsent!.phone, PHONE);
  assert.equal(consent.contact!.campaignConsent!.status, 'allowed'); assert.equal(h.calls.includes('contacts-cap'), false);
  assert.equal(h.controller.canClose(), false); assert.equal(h.controller.beginMessage({ phone: PHONE, patientRecordId: PATIENT, mode: 'individual', templateId: null }), false);
  assert.equal(h.snapshot.records.patientProfiles.length, 1); assert.equal(h.controller.consent.cancelDraft(), true); assert.equal(h.controller.canClose(), true);
});

test('attachment is bounded in-memory only and discarded on cancel/dispose', async () => {
  const h = await harness(); await h.controller.refresh(); let draft = h.begin(null);
  assert.equal(h.controller.setAttachment(new File([new Uint8Array(17)], 'private.jpg', { type: 'image/png' }), draft), false);
  assert.equal(h.controller.setAttachment(new File([new Uint8Array(150 * 1024 + 1)], 'private.jpg', { type: 'image/jpeg' }), draft), false);
  assert.equal(h.controller.setAttachment(new File([new Uint8Array(17)], 'private.jpg', { type: 'image/jpeg' }), draft), true);
  draft = h.controller.getState().draft!; assert.equal(draft.attachment!.name, 'clinic-message.jpg'); h.controller.cancelDraft(draft);
  assert.equal(h.controller.getState().draft, null); assert.equal(h.calls.includes('contacts-cap'), false);
});

test('rendering without a selected file cannot resolve financial tokens', async () => {
  const h = await harness(); await h.controller.refresh(); const draft = h.begin(null);
  const result = renderCloudWhatsAppDraft(h.snapshot, { ...draft, text: '{remainingBalance}' });
  assert.equal(result.financeAllowed, false); assert.match(result.message, /\{remainingBalance\}|^$/);
});
