import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareSafeWhatsAppMessage, whatsAppComposerContextKey } from './whatsappSafety';

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
