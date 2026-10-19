import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { DEFAULT_UI_LABELS, DEFAULT_WHATSAPP_SETTINGS } from '../data/initialData';
import { resolveClinicEntry } from './clinicEntryRoute';

test('documented local command pins the original loopback origin and never silently selects a different port', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts['preview:local'], 'vite preview --host 127.0.0.1 --port 4173 --strictPort');
  assert.equal(resolveClinicEntry('127.0.0.1', '', 'http:'), 'local');
  assert.equal(resolveClinicEntry('127.0.0.1', '?clinic-cloud=1', 'http:'), 'operating');
  const guide = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
  assert.ok(guide.includes('http://127.0.0.1:4173/'));
  assert.ok(guide.includes('لم يُنجز بعد خادم PHP/MySQL مستقل'));
  assert.ok(guide.includes('صلاحيات السكرتيرة وساعات العمل فيها ضوابط للواجهة المحلية'));
  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  assert.ok(app.includes('!isLocalClinicHost(window.location.hostname)'), 'provider independence must not open local records on a public hostname');
  assert.ok(app.includes('ولا تتطلب شركة استضافة بعينها'));
  assert.ok(!app.includes('تحتاج إكمال Firebase Authentication'));
});

test('fresh local messaging does not invent a clinic sender or pretend unconfigured automation is enabled', () => {
  assert.equal(DEFAULT_WHATSAPP_SETTINGS.senderNumber, '');
  assert.equal(DEFAULT_WHATSAPP_SETTINGS.autoConfirmOnAppt, false);
  assert.equal(DEFAULT_WHATSAPP_SETTINGS.autoRemind24h, false);
  assert.equal(DEFAULT_WHATSAPP_SETTINGS.autoPostOpOnAttended, false);
  assert.equal(DEFAULT_WHATSAPP_SETTINGS.apiKey, '');
  assert.equal(DEFAULT_WHATSAPP_SETTINGS.webhookUrl, '');
});

test('local contacts navigation describes the same unified patient and standalone directory', () => {
  assert.equal(DEFAULT_UI_LABELS.tiles.contacts.desc, 'كل أرقام العيادة، مع توضيح الأرقام المرتبطة بملفات المرضى');
});
