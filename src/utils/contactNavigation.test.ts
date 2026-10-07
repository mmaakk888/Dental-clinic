import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ActiveView, User } from '../types';
import { DEFAULT_UI_LABELS } from '../data/initialData';
import { MobileBottomNav } from '../components/navigation/MobileBottomNav';
import { createSafeSecretaryPermissions } from './userAccounts';

const user = (role: User['role'] = 'secretary'): User => ({ id: 'navigation-test', name: 'حساب تجريبي', username: 'test-only', role,
  permissions: { ...createSafeSecretaryPermissions(), patientView: false, appointments: false, lab: false, summary: false, controlPanel: false } });
const renderNavigation = (currentUser: User, activeView: ActiveView = 'home') => renderToStaticMarkup(React.createElement(MobileBottomNav, {
  activeView, currentUser, labels: DEFAULT_UI_LABELS,
  tileOrder: ['patients', 'appointments', 'lab', 'summary', 'settings'], onNavigate: () => {},
}));

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
