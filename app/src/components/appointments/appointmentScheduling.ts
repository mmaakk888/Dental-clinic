import type { Appointment } from '../../types';

export function localDateISO(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function isValidAppointmentDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00`);
  return Number.isFinite(date.getTime()) && localDateISO(date) === value;
}

export function appointmentTimeMinutes(value: string): number | null {
  if (!/^\d{2}:\d{2}$/.test(value)) return null;
  const [hour, minute] = value.split(':').map(Number);
  return hour <= 23 && minute <= 59 ? hour * 60 + minute : null;
}

export function appointmentDuration(value?: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 30;
}

export function occupiesAppointmentSlot(appointment: Appointment): boolean {
  return !['cancelled', 'apologized', 'no_show'].includes(appointment.status);
}

export function findAppointmentConflicts(
  appointments: Appointment[],
  date: string,
  time: string,
  duration = 30,
  excludeId?: string,
): Appointment[] {
  const start = appointmentTimeMinutes(time);
  if (start === null) return [];
  const end = start + appointmentDuration(duration);
  return appointments.filter(appointment => {
    if (appointment.id === excludeId || appointment.date !== date || !occupiesAppointmentSlot(appointment)) return false;
    const otherStart = appointmentTimeMinutes(appointment.time);
    if (otherStart === null) return false;
    const otherEnd = otherStart + appointmentDuration(appointment.durationMinutes);
    return start < otherEnd && end > otherStart;
  });
}

// Default suggestion window; the user can choose any valid time manually.
export function availableAppointmentTimes(
  appointments: Appointment[],
  date: string,
  duration = 30,
  now = new Date(),
): string[] {
  if (!isValidAppointmentDate(date)) return [];
  const nowDate = localDateISO(now);
  if (date < nowDate) return [];
  const slots: string[] = [];
  for (let minute = 16 * 60; minute + appointmentDuration(duration) <= 22 * 60; minute += 30) {
    if (date === nowDate && minute <= now.getHours() * 60 + now.getMinutes()) continue;
    const time = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
    if (!findAppointmentConflicts(appointments, date, time, duration).length) slots.push(time);
  }
  return slots;
}

export function adjacentCalendarMonth(date: Date, direction: -1 | 1): Date {
  return new Date(date.getFullYear(), date.getMonth() + direction, 1);
}
