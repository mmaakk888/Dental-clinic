import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanEgyptianPhone, fillMessageTemplate, getWhatsAppUrl, extraMessageTemplates } from './whatsappUtils';

test('normalizes local, international and Arabic phone digits', () => {
  for (const phone of ['01012345678', '+20 101 234 5678', '00201012345678', '٠١٠١٢٣٤٥٦٧٨', '۰۱۰۱۲۳۴۵۶۷۸']) {
    assert.equal(cleanEgyptianPhone(phone), '201012345678');
  }
  assert.equal(cleanEgyptianPhone(''), '');
});

test('fills all occurrences without altering unknown placeholders or patient text', () => {
  assert.equal(fillMessageTemplate('{patientName}: {patientName} {unknown}', { patientName: '$& أحمد' }), '$& أحمد: $& أحمد {unknown}');
});

test('WhatsApp link encodes message text, links and line breaks', () => {
  const text = 'أهلاً أحمد\nhttps://example.com/?a=1&b=2';
  const url = new URL(getWhatsAppUrl('01012345678', text));
  assert.equal(url.pathname, '/201012345678');
  assert.equal(url.searchParams.get('text'), text);
});

test('clinical templates require clinician completion', () => {
  for (const key of ['extraction', 'filling', 'rootCanal'] as const) {
    assert.match(extraMessageTemplates[key].text, /\[[^\]]+\]/);
  }
});
