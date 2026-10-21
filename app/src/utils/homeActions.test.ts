import test from 'node:test';
import assert from 'node:assert/strict';
import type { User } from '../types';
import { getHomeActionAccess } from './homeActions';
import { getDefaultPermissionsForRole } from './rbac';
import { buildHomePatientSearch, searchHomePatients } from './homePatientSearch';

const secretary = (permissions = {}) => ({ id: 'qa', role: 'secretary', isActive: true, permissions: { ...getDefaultPermissionsForRole('secretary'), ...permissions } }) as User;

test('home actions expose today details without granting historical reports or clinic expenses', () => {
  assert.deepEqual(getHomeActionAccess(secretary()), { walkIn: true, schedule: true, payment: true, invoice: false, report: true });
});

test('home actions require all permissions needed by their dialog and writes', () => {
  assert.equal(getHomeActionAccess(secretary({ patientEdit: false })).walkIn, false);
  assert.equal(getHomeActionAccess(secretary({ registerPayment: false })).payment, false);
  assert.equal(getHomeActionAccess(secretary({ registerPayment: false })).walkIn, false);
  assert.equal(getHomeActionAccess(secretary({ patientView: false })).schedule, false);
  assert.equal(getHomeActionAccess(secretary({ patientView: false })).report, false);
  assert.equal(getHomeActionAccess(secretary({ appointments: false })).schedule, false);
  assert.equal(getHomeActionAccess(secretary({ viewTodayCollections: false })).report, false);
  assert.equal(getHomeActionAccess(secretary({ summary: true, viewExpenses: false })).invoice, false);
  assert.equal(getHomeActionAccess(secretary({ summary: true, viewExpenses: true })).invoice, true);
  assert.deepEqual(getHomeActionAccess(null), { walkIn: false, schedule: false, payment: false, invoice: false, report: false });
});

const patients = [
  { id: '11', name: 'أحمد إبراهيم', mobile: '+20 1012345678' },
  { id: '011', name: 'منى أحمد', mobile: '01012345678' },
  { id: '22', name: 'نادر', mobile: '01298765432' },
];

test('indexed home search supports Arabic names, both digit sets and Egyptian phone formats', () => {
  const index = buildHomePatientSearch(patients);
  assert.deepEqual(searchHomePatients(index, 'احمد', 6), patients.slice(0, 2));
  assert.deepEqual(searchHomePatients(index, '٠١٠١٢٣٤٥٦٧٨', 6), patients.slice(0, 2));
  assert.deepEqual(searchHomePatients(index, '00201012345678', 6), patients.slice(0, 2));
  assert.deepEqual(searchHomePatients(index, '#۲۲', 6), [patients[2]]);
  assert.deepEqual(searchHomePatients(index, 'abc22', 6), []);
});

test('indexed home search preserves file zeroes and returns exact files before partials', () => {
  const index = buildHomePatientSearch(patients);
  assert.deepEqual(searchHomePatients(index, '#011', 1), [patients[1]]);
  assert.deepEqual(searchHomePatients(index, '', 2), []);
  assert.deepEqual(searchHomePatients(index, '', 2, true), patients.slice(0, 2));
  assert.deepEqual(searchHomePatients(index, '#', 2, true), []);
  assert.deepEqual(searchHomePatients(index, '11', 0), []);
});

test('home search keeps rendered results bounded for a large fake directory', () => {
  const data = Array.from({ length: 5000 }, (_, i) => ({ id: String(i + 1), name: `مريض تجريبي ${i + 1}`, mobile: '' }));
  const index = buildHomePatientSearch(data);
  assert.equal(searchHomePatients(index, 'مريض', 20).length, 20);
  assert.deepEqual(searchHomePatients(index, '#٥٠٠٠', 6), [data[4999]]);
  assert.equal(data[0].name, 'مريض تجريبي 1');
});
