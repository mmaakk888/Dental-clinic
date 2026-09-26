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
});
