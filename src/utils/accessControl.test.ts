import test from 'node:test';
import assert from 'node:assert/strict';
import { User } from '../types';
import { canUserLoginNow } from './accessControl';

const user: User = {
  id: 'secretary', name: 'سكرتيرة', username: 'desk', role: 'secretary',
  permissions: {
    patientView: true, patientEdit: true, deletePatients: false, patientFinance: true,
    appointments: true, lab: false, labProfit: false, summary: false, controlPanel: false
  },
  isActive: true,
  accessSchedule: { enabled: true, days: [0], startTime: '09:00', endTime: '17:00' }
};

test('allows login during an enabled work period', () => {
  assert.equal(canUserLoginNow(user, new Date(2026, 8, 27, 12, 0)).allowed, true);
});

test('blocks login outside work hours or on another day', () => {
  assert.equal(canUserLoginNow(user, new Date(2026, 8, 27, 18, 0)).allowed, false);
  assert.equal(canUserLoginNow(user, new Date(2026, 8, 28, 12, 0)).allowed, false);
});

test('supports overnight schedules', () => {
  const overnight = { ...user, accessSchedule: { enabled: true, days: [0], startTime: '20:00', endTime: '02:00' } };
  assert.equal(canUserLoginNow(overnight, new Date(2026, 8, 27, 23, 0)).allowed, true);
  assert.equal(canUserLoginNow(overnight, new Date(2026, 8, 28, 1, 59)).allowed, true);
  assert.equal(canUserLoginNow(overnight, new Date(2026, 8, 27, 1, 0)).allowed, false);
  assert.equal(canUserLoginNow(overnight, new Date(2026, 8, 28, 2, 0)).allowed, false);
});

test('includes start time but closes at the exact end time', () => {
  assert.equal(canUserLoginNow(user, new Date(2026, 8, 27, 9, 0)).allowed, true);
  assert.equal(canUserLoginNow(user, new Date(2026, 8, 27, 17, 0)).allowed, false);
});

test('overnight shift wraps from Saturday to Sunday in the configured timezone', () => {
  const scheduled = { ...user, accessSchedule: { enabled: true, days: [6], startTime: '20:00', endTime: '02:00', timezone: 'UTC' } };
  assert.equal(canUserLoginNow(scheduled, new Date('2026-09-27T01:00:00Z')).allowed, true);
  assert.equal(canUserLoginNow(scheduled, new Date('2026-09-26T01:00:00Z')).allowed, false);
});

test('rejects invalid schedules and timezone without throwing', () => {
  for (const override of [{ startTime: '25:00' }, { endTime: '09:00' }, { timezone: 'Invalid/Zone' }, { days: [] }]) {
    assert.equal(canUserLoginNow({ ...user, accessSchedule: { ...user.accessSchedule!, ...override } }, new Date(2026, 8, 27, 12)).allowed, false);
  }
  assert.equal(canUserLoginNow({ ...user, isActive: false }).allowed, false);
  assert.equal(canUserLoginNow({ ...user, accessSchedule: { ...user.accessSchedule!, enabled: false } }).allowed, true);
});
