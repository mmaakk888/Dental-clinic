import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import type { ActiveView, User } from '../types';
import { createSafeSecretaryPermissions } from './userAccounts';

// Render the actual dock; only this Node SSR harness omits browser-owned CSS.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const built = buildSync({
  stdin: { resolveDir: root, loader: 'tsx', contents: `
    import React from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { MobileBottomNav } from './src/components/navigation/MobileBottomNav';
    import { DEFAULT_UI_LABELS } from './src/data/initialData';
    export const renderNavigation = (currentUser, activeView = 'home') => renderToStaticMarkup(<MobileBottomNav
      activeView={activeView} currentUser={currentUser} labels={DEFAULT_UI_LABELS}
      tileOrder={['patients','appointments','lab','summary','settings']} onNavigate={()=>{}} />);
  ` }, bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external', loader: { '.css': 'empty' }, logLevel: 'silent',
});
const compiled = { exports: {} as { renderNavigation: (currentUser: User, activeView?: ActiveView) => string } };
new Function('require', 'module', 'exports', built.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
const { renderNavigation } = compiled.exports;

const user = (role: User['role'] = 'secretary'): User => ({ id: 'navigation-test', name: 'حساب تجريبي', username: 'test-only', role,
  permissions: { ...createSafeSecretaryPermissions(), patientView: false, appointments: false, lab: false, summary: false, controlPanel: false } });

test('contacts appear beside patients in the actual floating dock for legacy saved orders', () => {
  const account = user('admin');
  const html = renderNavigation(account);
  const patientsIndex = html.indexOf('title="المرضى"');
  const contactsIndex = html.indexOf('title="جهات الاتصال"');
  const appointmentsIndex = html.indexOf('title="المواعيد"');
  assert.ok(patientsIndex >= 0 && patientsIndex < contactsIndex && contactsIndex < appointmentsIndex);
  assert.ok(html.includes('lucide-contact-round'));
});

test('contacts in the floating dock follow patient access without requiring control panel', () => {
  const account = user();
  account.permissions.patientView = true;
  const html = renderNavigation(account);
  assert.ok(html.includes('title="جهات الاتصال"'));
  assert.ok(!html.includes('title="الإعدادات"'));
  account.permissions.patientView = false;
  assert.ok(!renderNavigation(account).includes('title="جهات الاتصال"'));
});

test('the contact directory is marked as the current section in the dock', () => {
  const account = user();
  account.permissions.patientView = true;
  assert.match(renderNavigation(account, 'contacts'), /aria-current="page" title="جهات الاتصال"/);
});

test('doctor and admin navigation follows centralized access despite legacy false permission flags', () => {
  for (const role of ['doctor', 'admin'] as const) {
    const html = renderNavigation(user(role));
    for (const title of ['جهات الاتصال', 'المرضى', 'المواعيد', 'التركيبات', 'الماليات', 'الإعدادات']) assert.ok(html.includes(`title="${title}"`), `${role}: ${title}`);
  }
});
