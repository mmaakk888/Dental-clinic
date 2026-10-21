import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Render real components with fake records, no browser or writes. CSS is omitted
// only for SSR; these tests do not certify visual layout or live timer events.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const built = buildSync({
  stdin: { resolveDir: root, loader: 'tsx', contents: `
    import React from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { HomeView } from './src/components/home/HomeView';
    import { getDefaultPermissionsForRole } from './src/utils/rbac';
    import { getHomeClockDisplay } from './src/utils/homeClock';
    const noop = () => {};
    const patients = [{id:'101', name:'بيانات وهمية', mobile:'01012345678', age:0, firstVisit:'2026-10-01', notes:'HIDDEN_CLINICAL_NOTE', allergy:'', sessions:[{id:'fake-session', date:getHomeClockDisplay(new Date()).day, amount:600, paid:100}], payments:[]}];
    export function renderHome(role = 'doctor', privacy = false, permissions = {}, layout, appointmentCount = 0) {
      const user = {id:'fake-dashboard-account', username:'qa', name:'حساب وهمي', role, isActive:true, permissions:{...getDefaultPermissionsForRole(role), ...permissions}};
      const appointments = Array.from({length:appointmentCount}, (_, index) => ({id:'appt-'+index,patientId:'101',patientName:'مريض موعد وهمي '+index,time:'10:00',date:getHomeClockDisplay(new Date()).day,status:'scheduled',note:''}));
      return renderToStaticMarkup(<HomeView clinicName='WELCOME_CLINIC_NAME' clinicLogo={null} labels={{homeSubtitle:'OLD_HOME_SUBTITLE',welcomeText:'OLD_HOME_WELCOME',tiles:{},tabs:{},homeLayout:layout}} tileOrder={[]} patientCount={1} todayApptCount={0} activeLabCount={2} currentUser={user} patients={patients} appointments={appointments} expenses={[]} isPrivacyMode={privacy} onNavigate={noop} onSelectPatient={noop} onOpenWalkIn={noop} onOpenScheduleModal={noop} onOpenPayment={noop} onOpenDailyReport={noop} onOpenInvoiceModal={noop} />);
    }
  ` }, bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external', loader: { '.css': 'empty' }, logLevel: 'silent',
});
const compiled = { exports: {} as { renderHome: (role?: string, privacy?: boolean, permissions?: Record<string, boolean>, layout?: unknown, appointmentCount?: number) => string } };
new Function('require', 'module', 'exports', built.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);

test('home starts with compact live date/time and search instead of welcome or duplicate navigation panels', () => {
  const html = compiled.exports.renderHome();
  assert.match(html, /aria-label="تاريخ اليوم والوقت المحلي"/);
  assert.equal((html.match(/<time /g) || []).length, 2);
  assert.match(html, /role="combobox" aria-autocomplete="list"/);
  assert.doesNotMatch(html, /dashboard-hero|dashboard-footer-strip|dashboard-modules|WELCOME_CLINIC_NAME|OLD_HOME_SUBTITLE|OLD_HOME_WELCOME|HIDDEN_CLINICAL_NOTE/);
  assert.ok(html.indexOf('home-today-strip') < html.indexOf('dashboard-search-panel'));
  assert.ok(html.indexOf('dashboard-search-panel') < html.indexOf('home-actions-panel'));
  assert.ok(html.indexOf('home-actions-panel') < html.indexOf('dashboard-metrics'));
  assert.ok(html.indexOf('dashboard-metrics') < html.indexOf('جدول اليوم'));
});

test('daily operations are a single prioritized action list shared by doctor and secretary permissions', () => {
  const doctor = compiled.exports.renderHome();
  for (const title of ['زيارة بدون موعد', 'حجز موعد', 'تسجيل دفعة', 'التقرير اليومي', 'إضافة فاتورة مصروف']) assert.equal(doctor.split(`<strong>${title}</strong>`).length - 1, 1, title);
  assert.ok(doctor.indexOf('home-action-walkin') < doctor.indexOf('home-action-schedule'));
  assert.ok(doctor.indexOf('home-action-payment') < doctor.indexOf('home-action-invoice'));
  const secretary = compiled.exports.renderHome('secretary');
  for (const title of ['زيارة بدون موعد', 'حجز موعد', 'تسجيل دفعة', 'التقرير اليومي']) assert.ok(secretary.includes(`<strong>${title}</strong>`), title);
  assert.doesNotMatch(secretary, /إضافة فاتورة مصروف/);
  assert.doesNotMatch(compiled.exports.renderHome('secretary', false, {lab:false}), /حالات المعمل/);
});

test('privacy hides money and expense actions while permission revocation removes patient workflows', () => {
  const visible = compiled.exports.renderHome();
  assert.match(visible, /٥٠٠ ج\.م/);
  assert.match(visible, /١٠٠ ج\.م/);
  const privateHtml = compiled.exports.renderHome('doctor', true);
  assert.doesNotMatch(privateHtml, /٥٠٠ ج\.م|١٠٠ ج\.م|إضافة فاتورة مصروف/);
  assert.match(privateHtml, /••••••/);
  const restricted = compiled.exports.renderHome('secretary', false, {patientView:false});
  assert.doesNotMatch(restricted, /role="combobox"|زيارة بدون موعد|حجز موعد|تسجيل دفعة|التقرير اليومي/);
});

test('home preferences change actual DOM order and visibility below fixed date/search without duplicate sections', () => {
  const layout = { sectionOrder: ['schedule', 'followUp', 'actions', 'metrics'], hiddenSections: ['metrics'], density: 'compact', appointmentLimit: 3 };
  const html = compiled.exports.renderHome('doctor', false, {}, layout, 8);
  assert.match(html, /data-home-density="compact"/);
  assert.doesNotMatch(html, /data-home-section="metrics"/);
  const sections = [...html.matchAll(/data-home-section="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(sections, ['schedule', 'followUp', 'actions']);
  assert.ok(html.indexOf('dashboard-search-panel') < html.indexOf('data-home-section="schedule"'));
});

test('all optional home sections may be hidden while fixed search and date stay available', () => {
  const html = compiled.exports.renderHome('doctor', false, {}, { sectionOrder: ['actions', 'metrics', 'schedule', 'followUp'], hiddenSections: ['actions', 'metrics', 'schedule', 'followUp'], density: 'comfortable', appointmentLimit: 6 });
  assert.match(html, /home-today-strip|role="combobox"/);
  assert.doesNotMatch(html, /data-home-section=/);
});

test('appointment preview limits apply to rendered rows without changing all-day metrics', () => {
  for (const limit of [3, 6, 10]) {
    const html = compiled.exports.renderHome('doctor', false, {}, { sectionOrder: ['actions', 'metrics', 'schedule', 'followUp'], hiddenSections: [], density: 'comfortable', appointmentLimit: limit }, 12);
    assert.equal((html.match(/class="dashboard-appointment"/g) || []).length, limit);
    assert.match(html, />12<\/span>/);
    assert.match(html, /باقي المواعيد في الجدول الكامل/);
  }
});

test('showing every home section never overrides revoked permissions or privacy', () => {
  const layout = { sectionOrder: ['metrics', 'schedule', 'followUp', 'actions'], hiddenSections: [], density: 'compact', appointmentLimit: 10 };
  const restricted = compiled.exports.renderHome('secretary', false, { patientView:false, appointments:false, lab:false, summary:false, viewTodayCollections:false, viewRemainingBalance:false }, layout, 12);
  assert.doesNotMatch(restricted, /data-home-section=|role="combobox"|ج\.م/);
  const privacy = compiled.exports.renderHome('doctor', true, {}, layout, 12);
  assert.doesNotMatch(privacy, /٥٠٠ ج\.م|١٠٠ ج\.م|إضافة فاتورة مصروف/);
});
