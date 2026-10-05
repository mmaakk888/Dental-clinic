import test from 'node:test';
import assert from 'node:assert/strict';
import type { Appointment } from '../../types';
import { adjacentCalendarMonth, appointmentTimeMinutes, availableAppointmentTimes, findAppointmentConflicts, isValidAppointmentDate, localDateISO } from './appointmentScheduling';

const appointment = (overrides: Partial<Appointment> = {}): Appointment => ({
  id: 'a1', patientId: '400', fileNo: '400', patientName: 'مريض', mobile: '',
  date: '2026-10-06', time: '16:00', note: '', isFollowUp: false, isWalkIn: false,
  status: 'scheduled', ...overrides,
});

test('appointment inputs reject impossible dates and out-of-range times', () => {
  assert.equal(isValidAppointmentDate('2026-02-30'), false);
  assert.equal(isValidAppointmentDate('2024-02-29'), true);
  assert.equal(isValidAppointmentDate(''), false);
  assert.equal(appointmentTimeMinutes('24:00'), null);
  assert.equal(appointmentTimeMinutes('12:60'), null);
  assert.equal(appointmentTimeMinutes('00:15'), 15);
});

test('occupied appointment durations conflict; cancelled slots and adjacent boundaries do not', () => {
  const appts = [appointment({ durationMinutes: 60 }), appointment({ id: 'cancelled', time: '17:00', status: 'cancelled' })];
  assert.deepEqual(findAppointmentConflicts(appts, '2026-10-06', '16:30').map(item => item.id), ['a1']);
  assert.equal(findAppointmentConflicts(appts, '2026-10-06', '17:00').length, 0);
  assert.equal(findAppointmentConflicts(appts, '2026-10-06', '16:00', 30, 'a1').length, 0);
  assert.equal(findAppointmentConflicts([appointment({ status: 'apologized' }), appointment({ status: 'no_show' })], '2026-10-06', '16:00').length, 0);
});

test('suggested times exclude past slots, duration conflicts, and appointments crossing closing time', () => {
  const now = new Date(2026, 9, 6, 16, 10);
  const appts = [appointment({ time: '17:00', durationMinutes: 60 })];
  const slots = availableAppointmentTimes(appts, localDateISO(now), 60, now);
  assert.equal(slots.includes('16:00'), false);
  assert.equal(slots.includes('16:30'), false);
  assert.equal(slots.includes('17:30'), false);
  assert.equal(slots.includes('18:00'), true);
  assert.equal(slots.includes('21:30'), false);
  assert.deepEqual(availableAppointmentTimes([], '2026-10-05', 30, now), []);
});

test('month navigation does not skip short months when viewing the 31st', () => {
  assert.equal(localDateISO(adjacentCalendarMonth(new Date(2026, 0, 31), 1)), '2026-02-01');
  assert.equal(localDateISO(adjacentCalendarMonth(new Date(2026, 2, 31), -1)), '2026-02-01');
});
