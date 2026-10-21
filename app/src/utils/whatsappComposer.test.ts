import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { WhatsappSettings } from '../types';
import { WhatsAppComposer } from '../components/patient/WhatsAppComposer';
import { ToastAndConfirmProvider } from '../components/common/ToastAndConfirm';

const settings: WhatsappSettings = {
  apiKey: '', webhookUrl: '', senderNumber: '',
  autoConfirmOnAppt: false, autoRemind24h: false, autoPostOpOnAttended: false,
  templates: { reminderTomorrow: '', newAppt: '', postOp: '', accountBalance: '' },
};
const recipient = { id: 'contact-only', name: 'اسم تجريبي بدون ملف', mobile: '٠١٠١٢٣٤٥٦٧٨', source: 'contact' as const };
const renderCampaign = (consent: WhatsappSettings['campaignConsent'], message = 'أهلًا {patientName} من {clinicName}') => renderToStaticMarkup(React.createElement(ToastAndConfirmProvider,{children:React.createElement(WhatsAppComposer, {
  campaignRecipient: recipient,
  settings: { ...settings, campaignConsent: consent }, clinicName: 'عيادة تجريبية', onClose: () => {},
  campaign: { template: 'greeting', message, link: '', attachment: null, onOpened: () => {} },
})}));

test('campaign composer renders a contact identity without creating or reading a clinical patient', () => {
  const html = renderCampaign({ '201012345678': 'allowed' });
  assert.ok(html.includes('رسالة إلى اسم تجريبي بدون ملف'));
  assert.ok(html.includes('+201012345678'));
  assert.ok(html.includes('أهلًا اسم تجريبي بدون ملف من عيادة تجريبية'));
  assert.match(html, /<button type="button" class="[^"]*">فتح الرسالة في واتساب<\/button>/);
  assert.ok(!html.includes('نوع الرسالة'));
  assert.ok(!html.includes('تحديد موعد يدوياً'));
});

test('contact campaign composer blocks opening with unknown or declined consent', () => {
  for (const consent of [undefined, { '201012345678': 'declined' as const }]) {
    const html = renderCampaign(consent);
    assert.ok(html.includes('قبل تسجيل موافقة صاحب الرقم الفعلية'));
    assert.match(html, /<button type="button" disabled="" class="[^"]*">فتح الرسالة في واتساب<\/button>/);
  }
});

test('contact campaign composer cannot populate a fabricated file number or financial balance', () => {
  const html = renderCampaign({ '201012345678': 'allowed' }, '{patientName} — {fileNo} — {remainingBalance}');
  assert.ok(html.includes('{fileNo}'));
  assert.ok(html.includes('{remainingBalance}'));
  assert.ok(html.includes('لا تُستخدم بيانات حساب المريض في الحملات العامة.'));
  assert.match(html, /<button type="button" disabled="" class="[^"]*">فتح الرسالة في واتساب<\/button>/);
});
