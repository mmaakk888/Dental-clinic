import assert from 'node:assert/strict';
import test from 'node:test';
import type { WhatsappSettings } from '../types';
import { getWhatsAppDraftTemplate, prepareFreshWhatsAppAction, prepareSafeWhatsAppMessage, whatsAppComposerContextKey } from './whatsappSafety';

const base = { templateName: 'postOp', rawTemplate: 'أهلاً {patientName} من {clinicName}', phone: '01012345678', values: { patientName: 'مريض تجريبي', clinicName: 'عيادة تجريبية', remainingBalance: '735' } };

test('financial values are denied by default even in a custom nonfinancial template', () => {
  const result = prepareSafeWhatsAppMessage({ ...base, rawTemplate: 'المتبقي {remainingBalance}' });
  assert.equal(result.message, 'المتبقي {remainingBalance}');
  assert.equal(result.financeAllowed, false);
  assert.equal(result.unfinished, true);
  assert.ok(!result.message.includes('735'));
});
test('financial permission is explicit and permits an individual balance message', () => {
  const result = prepareSafeWhatsAppMessage({ ...base, templateName: 'accountBalance', rawTemplate: 'المتبقي {remainingBalance}', canViewPatientFinance: true });
  assert.equal(result.message, 'المتبقي 735');
  assert.equal(result.financeAllowed, true);
  assert.equal(result.unfinished, false);
});
test('campaigns never substitute a balance or other individual variables even with financial permission', () => {
  const result = prepareSafeWhatsAppMessage({ ...base, isCampaign: true, canViewPatientFinance: true, rawTemplate: '{patientName}: {remainingBalance} / {fileNo}', values: { ...base.values, fileNo: '401' }, campaignConsent: { '201012345678': 'allowed' } });
  assert.equal(result.message, 'مريض تجريبي: {remainingBalance} / {fileNo}');
  assert.equal(result.financeAllowed, false);
  assert.deepEqual(result.unsupportedVariables, ['{remainingBalance}', '{fileNo}']);
});
test('an edited financial draft is discarded rather than exposed without permission', () => {
  const result = prepareSafeWhatsAppMessage({ ...base, rawTemplate: 'المتبقي {remainingBalance}', editedText: 'المتبقي 735' });
  assert.equal(result.message, 'المتبقي {remainingBalance}');
  assert.equal(result.financeAllowed, false);
});
test('greetings and offers require actual normalized-phone consent', () => {
  for (const templateName of ['greeting', 'offer']) {
    assert.equal(prepareSafeWhatsAppMessage({ ...base, templateName }).consentAllowed, false);
    assert.equal(prepareSafeWhatsAppMessage({ ...base, templateName, campaignConsent: { '201012345678': 'declined' } }).consentAllowed, false);
    assert.equal(prepareSafeWhatsAppMessage({ ...base, templateName, campaignConsent: { '201012345678': 'allowed' } }).consentAllowed, true);
  }
});
test('all campaign contexts require consent, regardless of selected template label', () => {
  assert.equal(prepareSafeWhatsAppMessage({ ...base, isCampaign: true }).consentAllowed, false);
  assert.equal(prepareSafeWhatsAppMessage(base).consentAllowed, true);
});
test('a campaign edited to contain unsupported variables cannot bypass its raw-template guard', () => {
  const result = prepareSafeWhatsAppMessage({ ...base, isCampaign: true, editedText: 'ملف {fileNo}', campaignConsent: { '201012345678': 'allowed' } });
  assert.deepEqual(result.unsupportedVariables, ['{fileNo}']);
  assert.equal(result.unfinished, true);
});
test('removing a protected token in an edited draft cannot bypass a protected campaign template', () => {
  const result = prepareSafeWhatsAppMessage({ ...base, isCampaign: true, rawTemplate: '{patientName} {remainingBalance}', editedText: 'نص مكتمل', canViewPatientFinance: true });
  assert.equal(result.financeAllowed, false);
  assert.equal(result.message, 'مريض تجريبي {remainingBalance}');
});
test('composer context remounts for a different patient, phone, permission, or campaign mode', () => {
  const initial = whatsAppComposerContextKey('401', '01012345678', false);
  assert.equal(initial, whatsAppComposerContextKey('401', '+201012345678', false));
  assert.notEqual(initial, whatsAppComposerContextKey('402', '01012345678', false));
  assert.notEqual(initial, whatsAppComposerContextKey('401', '01012345679', false));
  assert.notEqual(initial, whatsAppComposerContextKey('401', '01012345678', true));
  assert.notEqual(initial, whatsAppComposerContextKey('401', '01012345678', false, 'greeting'));
});

const launchSettings: WhatsappSettings = {
  apiKey: '', webhookUrl: '', senderNumber: '', autoConfirmOnAppt: false, autoRemind24h: false, autoPostOpOnAttended: false,
  templates: { reminderTomorrow: '', newAppt: '', postOp: base.rawTemplate, accountBalance: 'المتبقي {remainingBalance}' },
  campaignConsent: { '201012345678': 'allowed' },
};
const launchInput = { ...base, link: '', appointmentReady: true };

test('a previously ready campaign rechecks persisted consent for every open or share action', () => {
  let latest = structuredClone(launchSettings);
  let reads = 0;
  let authorized = 0;
  const readSettings = () => { reads++; return latest; };
  const input = { ...launchInput, isCampaign: true, campaignConsent: { '201012345678': 'allowed' as const } };
  assert.equal(prepareSafeWhatsAppMessage(input).consentAllowed, true);
  assert.equal(prepareFreshWhatsAppAction(input, readSettings, () => authorized++).text, 'أهلاً مريض تجريبي من عيادة تجريبية');
  latest = { ...latest, campaignConsent: { '201012345678': 'declined' } };
  assert.throws(() => prepareFreshWhatsAppAction(input, readSettings, () => authorized++), /أحدث الإعدادات/);
  latest = { ...latest, campaignConsent: {} };
  assert.throws(() => prepareFreshWhatsAppAction(input, readSettings, () => authorized++), /أحدث الإعدادات/);
  assert.equal(reads, 3);
  assert.equal(authorized, 1);
});

test('launch checks current account authorization and financial access rather than a ready snapshot', () => {
  const requests: unknown[] = [];
  const input = { ...launchInput, templateName: 'accountBalance', rawTemplate: 'المتبقي {remainingBalance}', canViewPatientFinance: true };
  assert.equal(prepareSafeWhatsAppMessage(input).financeAllowed, true);
  const authorize = (request: unknown) => { requests.push(request); throw new Error('session expired or access revoked'); };
  assert.throws(() => prepareFreshWhatsAppAction(input, () => launchSettings, authorize), /access revoked/);
  assert.deepEqual(requests, [{ isCampaign: false, requiresFinance: true }]);
  assert.throws(() => prepareFreshWhatsAppAction(launchInput, () => launchSettings), /صلاحية فتح واتساب/);
});

test('opening or sharing rejects a changed individual template until it has been reviewed again', () => {
  const changed = { ...launchSettings, templates: { ...launchSettings.templates, postOp: 'نص محدّث' } };
  let authorized = 0;
  assert.throws(() => prepareFreshWhatsAppAction(launchInput, () => changed, () => authorized++), /تغيّر قالب الرسالة/);
  assert.equal(authorized, 0);
  assert.equal(prepareFreshWhatsAppAction({ ...launchInput, rawTemplate: 'نص محدّث' }, () => changed, () => authorized++).text, 'نص محدّث');
});

test('fresh launch validates phone, appointment, text and link before exposing a payload', () => {
  for (const invalid of [
    { phone: '123' }, { appointmentReady: false }, { editedText: '[أكمل التعليمات]' },
    { link: 'javascript:alert(1)' }, { link: 'https://example.test/{missing}' }, { editedText: '' },
  ]) {
    assert.throws(() => prepareFreshWhatsAppAction({ ...launchInput, ...invalid }, () => launchSettings, () => {}));
  }
  const allowed = prepareFreshWhatsAppAction({ ...launchInput, link: ' https://example.test/info ' }, () => launchSettings, () => {});
  assert.equal(allowed.phone, '201012345678');
  assert.ok(allowed.text.endsWith('\nhttps://example.test/info'));
});

test('fresh campaigns retain token restrictions and request campaign authorization', () => {
  assert.throws(() => prepareFreshWhatsAppAction({ ...launchInput, isCampaign: true, rawTemplate: '{patientName} {fileNo}', editedText: 'نص بلا متغيرات' }, () => launchSettings, () => {}), /راجع نص الرسالة/);
  const requests: unknown[] = [];
  prepareFreshWhatsAppAction({ ...launchInput, isCampaign: true }, () => launchSettings, request => { requests.push(request); });
  assert.deepEqual(requests, [{ isCampaign: true, requiresFinance: false }]);
  assert.equal(getWhatsAppDraftTemplate('reminderTomorrow', { ...launchSettings, templates: { ...launchSettings.templates, reminderTomorrow: 'غداً {date}' } }), 'يوم {date}');
});
