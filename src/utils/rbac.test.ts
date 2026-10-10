import test from 'node:test';
import assert from 'node:assert/strict';
import type { ActiveView, User } from '../types';
import { canAccessView, canPerformAction, type RBACAction } from './rbac';
import { createSafeSecretaryPermissions } from './userAccounts';

const user = (role: User['role'] = 'secretary'): User => ({ id: 'synthetic', name: 'اختبار', username: 'synthetic', role, permissions: createSafeSecretaryPermissions() });
const views: ActiveView[] = ['home', 'secretary-desk', 'patients', 'contacts', 'patient-file', 'appointments', 'lab', 'lab-detail', 'summary', 'settings'];
const actions: RBACAction[] = ['view_patients', 'add_patient', 'edit_patient', 'delete_patient', 'add_session', 'delete_session',
  'view_patient_finance', 'collect_payment', 'register_payment', 'view_remaining_balance', 'view_today_collections',
  'edit_payment', 'delete_payment', 'manage_appointments', 'manage_lab', 'view_lab_costs', 'view_summary_reports',
  'view_expenses', 'view_profits', 'manage_prices', 'financial_reports', 'access_control_panel', 'manage_users', 'backup_restore', 'data_import', 'data_export', 'print_prescription'];

test('contact directory follows patient-view permission without requiring access to control panel', () => {
  const secretary = user();
  secretary.permissions.patientView = true;
  secretary.permissions.controlPanel = false;
  assert.equal(canAccessView(secretary, 'contacts'), true);
  assert.equal(canAccessView(secretary, 'settings'), false);
  secretary.permissions.patientView = false;
  assert.equal(canAccessView(secretary, 'contacts'), false);
});

test('doctor and admin have centralized full access despite legacy false flags', () => {
  for (const role of ['doctor', 'admin'] as const) {
    const promoted = user(role);
    assert.equal(promoted.permissions.controlPanel, false);
    for (const view of views) assert.equal(canAccessView(promoted, view), true, `${role}: ${view}`);
    for (const action of actions) assert.equal(canPerformAction(promoted, action), true, `${role}: ${action}`);
  }
});

test('inactive, absent and unknown-role accounts fail closed for all actions and views', () => {
  for (const denied of [null, { ...user('admin'), isActive: false }, { ...user('admin'), role: 'unknown' } as unknown as User]) {
    for (const view of views) assert.equal(canAccessView(denied, view), false);
    for (const action of actions) assert.equal(canPerformAction(denied, action), false);
  }
});

test('secretary can never transfer data, manage backups or promote accounts, even with every flag enabled', () => {
  const secretary = user();
  for (const key of Object.keys(secretary.permissions)) secretary.permissions[key] = true;
  Object.assign(secretary.permissions, { dataImport: true, dataExport: true, backupRestore: true, manageUsers: true });
  assert.equal(canAccessView(secretary, 'settings'), true);
  assert.equal(canPerformAction(secretary, 'access_control_panel'), true);
  assert.equal(canPerformAction(secretary, 'add_patient'), true);
  for (const action of ['data_import', 'data_export', 'backup_restore', 'manage_users'] as const) {
    assert.equal(canPerformAction(secretary, action), false, action);
  }
});

test('secretary permissions require real booleans, retaining only intentional undefined legacy fallbacks', () => {
  const malformed = { ...user(), permissions: { patientView: 'true', patientEdit: 1, patientFinance: 'false',
    appointments: {}, lab: [], labProfit: 'true', summary: 'false', controlPanel: 'true' } } as unknown as User;
  for (const view of views.filter(item => !['home', 'secretary-desk'].includes(item))) assert.equal(canAccessView(malformed, view), false);
  for (const action of actions) assert.equal(canPerformAction(malformed, action), false);
  const legacy = user(); legacy.permissions.patientFinance = true; delete legacy.permissions.registerPayment;
  assert.equal(canPerformAction(legacy, 'register_payment'), true);
  legacy.permissions.registerPayment = false;
  assert.equal(canPerformAction(legacy, 'register_payment'), false);
  (legacy.permissions as any).registerPayment = 'true';
  assert.equal(canPerformAction(legacy, 'register_payment'), false);
});
