import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Real component markup, without a browser or storage writes. CSS is omitted
// only in this test: this does not certify responsive layout or focus behavior.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const built = buildSync({
  stdin: { resolveDir: root, loader: 'tsx', contents: `
    import React from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { HeaderNavbar } from './src/components/common/HeaderNavbar';
    import { NotificationCenterModal } from './src/components/common/NotificationCenterModal';
    import { getDefaultPermissionsForRole } from './src/utils/rbac';
    import { buildClinicNotifications, getLocalNotificationDay } from './src/utils/clinicNotifications';
    const noop = () => {};
    const patient = {id:'fake-patient', name:'سجل تجريبي', mobile:'01012345678', sessions:[{id:'fake-session', amount:600, paid:0}], payments:[]};
    const appointments = ['scheduled','confirmed','cancelled','apologized','attended'].map((status, index) => ({id:String(index), patientName:'موعد تجريبي', status, date:getLocalNotificationDay(), time:'10:00', note:''}));
    export function renderHeader(privacy = false, restricted = false) {
      const user = {id:'fake-account', username:'qa', name:'حساب تجريبي', role:'secretary', permissions:{...getDefaultPermissionsForRole('secretary'), patientView:!restricted, patientFinance:!restricted, viewRemainingBalance:!restricted}};
      return renderToStaticMarkup(<HeaderNavbar activeView='patients' labels={{}} clinicName='عيادة تجريبية' clinicLogo={null} currentUser={user} patients={[patient]} appointments={appointments} labCases={[]} expenses={[]} isPrivacyMode={privacy} onTogglePrivacyMode={noop} onNavigate={noop} onSelectPatient={noop} onLogout={noop} />);
    }
    export function renderNotifications(read = false, count = 1) {
      const notifications = buildClinicNotifications({patients:[], labCases:[], today:getLocalNotificationDay(), appointments:Array.from({length:count}, (_, index) => ({id:'fake-'+index, status:'scheduled', date:getLocalNotificationDay(), time:'10:00', patientName:'سطر_تجريبي_'+index, note:''}))});
      return renderToStaticMarkup(<NotificationCenterModal isOpen onClose={noop} notifications={notifications} readKeys={new Set(read ? notifications.map(item => item.readKey) : [])} onMarkRead={noop} onSelectPatient={noop} onNavigate={noop} />);
    }
  ` },
  bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external', loader: { '.css': 'empty' }, logLevel: 'silent',
});
const compiled = { exports: {} as { renderHeader: (privacy?: boolean, restricted?: boolean) => string; renderNotifications: (read?: boolean, count?: number) => string } };
new Function('require', 'module', 'exports', built.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);

test('header exposes touch-accessible search, privacy state and honest local status without duplicate home navigation', () => {
  const markup = compiled.exports.renderHeader();
  assert.match(markup, /aria-label="البحث الشامل"/);
  assert.match(markup, /aria-keyshortcuts="Control\+k Meta\+k"/);
  assert.match(markup, /aria-label="إخفاء المبالغ المالية" aria-pressed="false"|aria-pressed="false" aria-label="إخفاء المبالغ المالية"/);
  assert.match(markup, /حالة الموقع: تخزين محلي/);
  assert.doesNotMatch(markup, /البيانات محفوظة|آخر مزامنة ناجحة|العودة للشاشة الرئيسية|animate-bounce|animate-pulse/);
});

test('header badge excludes completed/cancelled appointments and restricted or hidden balances', () => {
  assert.match(compiled.exports.renderHeader(), /3 غير مقروء/);
  assert.match(compiled.exports.renderHeader(true), /2 غير مقروء/);
  assert.match(compiled.exports.renderHeader(false, true), /2 غير مقروء/);
  assert.match(compiled.exports.renderHeader(true), /aria-pressed="true"/);
});

test('notification markup reads shared acknowledgements, exposes an accessible dialog and bounds the list', () => {
  const unread = compiled.exports.renderNotifications(false, 100);
  assert.match(unread, /role="dialog" aria-modal="true" aria-labelledby="clinic-notifications-title"/);
  assert.match(unread, /قراءة الكل/);
  assert.equal((unread.match(/سطر_تجريبي_/g) || []).length, 50);
  assert.match(unread, /عرض المزيد \(50\)/);
  const read = compiled.exports.renderNotifications(true);
  assert.doesNotMatch(read, /قراءة الكل|1 جديد/);
  assert.match(read, /كل التنبيهات مقروءة/);
});
