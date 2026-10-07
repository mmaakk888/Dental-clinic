import test from 'node:test';
import assert from 'node:assert/strict';
import { ClinicContact, Patient } from '../types';
import { campaignRecipientCanReceive, campaignRecipientLabel, campaignRecipients, matchesCampaignRecipient } from './campaigns';

const patient = (id: string, mobile: string) => ({ id, name: `مريض ${id}`, mobile } as Patient);
const contact = (id: string, mobile: string, name = 'جهة اتصال تجريبية'): ClinicContact => ({ id, name, mobile, createdAt: '2026-10-07T09:00:00.000Z' });

test('campaign recipients include valid phones once in their first patient order', () => {
  const result = campaignRecipients([
    patient('401', '01012345678'),
    patient('402', '+20 101 234 5678'),
    patient('403', '01123456789'),
    patient('404', 'بدون رقم')
  ]);
  assert.deepEqual(result.map(item => [item.id, item.phone]), [
    ['401', '201012345678'],
    ['403', '201123456789']
  ]);
});

test('standalone contacts join campaigns without clinical or financial records', () => {
  const result = campaignRecipients([], [contact('contact-1', '٠١٠١٢٣٤٥٦٧٨'), contact('contact-2', '+20 101 234 5678'), contact('invalid', 'بدون رقم')]);
  assert.deepEqual(result, [{ id: 'contact-1', name: 'جهة اتصال تجريبية', mobile: '٠١٠١٢٣٤٥٦٧٨', phone: '201012345678', source: 'contact', patientIds: [], searchNames: ['جهة اتصال تجريبية', 'جهة اتصال تجريبية'] }]);
  assert.equal(campaignRecipientLabel(result[0]), 'جهة اتصال بدون ملف');
  assert.equal('sessions' in result[0], false);
  assert.equal('payments' in result[0], false);
  assert.equal('fileNo' in result[0], false);
});

test('a patient file wins over matching contacts and records all shared files once', () => {
  const result = campaignRecipients([patient('401', '01012345678'), patient('402', '+٢٠١٠١٢٣٤٥٦٧٨')], [contact('external', '00201012345678', 'اسم آخر'), contact('independent', '01123456789')]);
  assert.deepEqual(result.map(item => [item.id, item.source, item.patientIds]), [['401', 'patient', ['401', '402']], ['independent', 'contact', []]]);
  assert.equal(campaignRecipientLabel(result[0]), 'ملفات #401، #402');
  assert.equal(matchesCampaignRecipient(result[0], 'اسم آخر'), true);
  assert.equal(matchesCampaignRecipient(result[0], 'مريض 402'), true);
  assert.equal(campaignRecipientLabel(campaignRecipients([patient('401', '01012345678')])[0]), 'ملف #401');
});

test('campaign recipient matching accepts names and phone formats but not internal contact IDs', () => {
  const recipient = campaignRecipients([], [contact('hidden-contact-key', '01012345678', 'أحمد مُحَمَّد')])[0];
  for (const query of ['احمد محمد', '٠١٠١٢٣٤٥٦٧٨', '+20 101 234 5678', '12345678', '']) assert.equal(matchesCampaignRecipient(recipient, query), true, query);
  for (const query of ['hidden-contact-key', '#hidden-contact-key', '#401', 'abc12345678']) assert.equal(matchesCampaignRecipient(recipient, query), false, query);
});

test('all shared file numbers are searchable while similar phone numbers stay independent', () => {
  const recipients = campaignRecipients([patient('٤٠١', '01012345678'), patient('402', '+201012345678')], [contact('another', '01012345679')]);
  assert.equal(recipients.length, 2);
  for (const query of ['#٤٠١', '#401', '#٤٠٢']) assert.equal(matchesCampaignRecipient(recipients[0], query), true);
  assert.equal(matchesCampaignRecipient(recipients[1], '#401'), false);
});

test('contact-only campaign eligibility needs explicit opt-in on the canonical phone', () => {
  const recipient = campaignRecipients([], [contact('external', '01012345678')])[0];
  assert.equal(campaignRecipientCanReceive(recipient), false);
  assert.equal(campaignRecipientCanReceive(recipient, { '201012345678': 'declined' }), false);
  assert.equal(campaignRecipientCanReceive(recipient, { '01012345678': 'allowed' }), false);
  assert.equal(campaignRecipientCanReceive(recipient, { '201012345678': 'allowed' }), true);
});

test('malformed phones never become campaign recipients after stripping letters or extensions', () => {
  const result = campaignRecipients([patient('401', '01012345678 ext. 2')], [contact('label', 'محمول 01123456789'), contact('short', '0101234567'), contact('valid', '+44 7700 900123')]);
  assert.deepEqual(result.map(recipient => recipient.id), ['valid']);
});
