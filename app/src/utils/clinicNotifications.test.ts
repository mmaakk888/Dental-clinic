import test from 'node:test';
import assert from 'node:assert/strict';
import type { Appointment, LabCase, Patient } from '../types';
import { buildClinicNotifications, countUnreadNotifications, getLocalNotificationDay, markNotificationsRead } from './clinicNotifications';

const day = '2026-10-08';
const appointment = (id: string, status: Appointment['status'], date = day, time = '10:00') => ({
  id, status, date, time, patientName: 'اسم تجريبي', note: '',
} as Appointment);
const build = (appointments: Appointment[] = [], patients: Patient[] = [], labCases: LabCase[] = []) =>
  buildClinicNotifications({ appointments, patients, labCases, today: day });

test('notifications include only actionable appointments today and sort by time', () => {
  const notifications = build([
    appointment('1', 'scheduled', day, '14:00'), appointment('2', 'confirmed', day, '09:00'),
    appointment('3', 'waiting'), appointment('4', 'attended'), appointment('5', 'no_show'),
    appointment('6', 'apologized'), appointment('7', 'cancelled'), appointment('8', 'scheduled', '2026-10-09'),
  ]);
  assert.deepEqual(notifications.map(item => item.id), ['notif-appt-2', 'notif-appt-3', 'notif-appt-1']);
  assert.match(notifications[1].title, /في الانتظار/);
});

test('reading all and individual items produces the same badge state without mutating inputs', () => {
  const notifications = build([appointment('1', 'scheduled'), appointment('2', 'waiting')]);
  const original = new Set<string>();
  const firstRead = markNotificationsRead(original, notifications.slice(0, 1));
  assert.equal(original.size, 0);
  assert.equal(countUnreadNotifications(notifications, firstRead), 1);
  const allRead = markNotificationsRead(firstRead, notifications);
  assert.equal(countUnreadNotifications(notifications, allRead), 0);
  assert.equal(countUnreadNotifications(build([appointment('1', 'cancelled')]), allRead), 0);
});

test('changed appointments and new-day recurrence become unread again', () => {
  const original = build([appointment('1', 'scheduled')]);
  const read = markNotificationsRead(new Set(), original);
  assert.equal(countUnreadNotifications(build([appointment('1', 'scheduled')]), read), 0);
  assert.equal(countUnreadNotifications(build([appointment('1', 'waiting')]), read), 1);
  assert.equal(countUnreadNotifications(build([appointment('1', 'scheduled', day, '11:00')]), read), 1);
  const nextDay = buildClinicNotifications({ patients: [], labCases: [], today: '2026-10-09', appointments: [appointment('1', 'scheduled', '2026-10-09')] });
  assert.equal(countUnreadNotifications(nextDay, read), 1);
});

test('balance notifications retain threshold but do not claim a debt is overdue', () => {
  const patient = (balance: number) => ({ id: '101', name: 'اسم تجريبي', payments: [], sessions: [{ id: 's1', amount: balance, paid: 0, discount: 0 }] } as Patient);
  assert.equal(build([], [patient(500)]).length, 0);
  const notifications = build([], [patient(600)]);
  assert.equal(notifications[0].type, 'finance');
  assert.equal(notifications[0].date, 'متبقٍ');
  const read = markNotificationsRead(new Set(), notifications);
  assert.equal(countUnreadNotifications(build([], [patient(700)]), read), 1);
  assert.deepEqual(build(), []); // Permission/privacy filtering supplies no restricted records.
});

test('active lab status changes are unread but delivered and completed records do not notify', () => {
  const lab = (status: LabCase['status']) => ({ id: '1', status, patientName: 'اسم تجريبي', type: 'تركيبة', labName: 'معمل تجريبي', date: day } as LabCase);
  const read = markNotificationsRead(new Set(), build([], [], [lab('pending')]));
  assert.equal(countUnreadNotifications(build([], [], [lab('ready')]), read), 1);
  assert.equal(build([], [], [lab('delivered'), lab('completed')]).length, 0);
  assert.equal(build([], [], [lab('delayed')]).length, 1);
});

test('notification dates use local calendar components, not UTC slicing', () => {
  const local = new Date(2026, 9, 8, 0, 1);
  assert.equal(getLocalNotificationDay(local), day);
});
