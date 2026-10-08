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
    export function renderHome(role = 'doctor', privacy = false, permissions = {}) {
      const user = {id:'fake-dashboard-account', username:'qa', name:'حساب وهمي', role, isActive:true, permissions:{...getDefaultPermissionsForRole(role), ...permissions}};
      return renderToStaticMarkup(<HomeView clinicName='WELCOME_CLINIC_NAME' clinicLogo={null} labels={{homeSubtitle:'OLD_HOME_SUBTITLE',welcomeText:'OLD_HOME_WELCOME',tiles:{},tabs:{}}} tileOrder={[]} patientCount={1} todayApptCount={0} activeLabCount={2} currentUser={user} patients={patients} appointments={[]} expenses={[]} isPrivacyMode={privacy} onNavigate={noop} onSelectPatient={noop} onOpenWalkIn={noop} onOpenScheduleModal={noop} onOpenPayment={noop} onOpenDailyReport={noop} onOpenInvoiceModal={noop} />);
    }
  ` }, bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external', loader: { '.css': 'empty' }, logLevel: 'silent',
});
const compiled = { exports: {} as { renderHome: (role?: string, privacy?: boolean, permissions?: Record<string, boolean>) => string } };
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
