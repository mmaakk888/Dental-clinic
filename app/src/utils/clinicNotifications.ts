import type { ActiveView, Appointment, LabCase, Patient } from '../types';
import { getPatientFinancialSummary } from './financials';

export interface ClinicNotification {
  id: string;
  /** A read acknowledgement applies to this version, not every future change. */
  readKey: string;
  type: 'appointment' | 'finance' | 'lab';
  title: string;
  message: string;
  date: string;
  actionPayload: { patientId?: string; view?: ActiveView };
}

export function getLocalNotificationDay(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Callers supply only records permitted by the active account and privacy mode. */
export function buildClinicNotifications({ patients, appointments, labCases, today }: {
  patients: readonly Patient[];
  appointments: readonly Appointment[];
  labCases: readonly LabCase[];
  today: string;
}): ClinicNotification[] {
  const result: ClinicNotification[] = [];
  appointments.filter(appointment => appointment.date === today
    && ['scheduled', 'confirmed', 'waiting'].includes(appointment.status))
    .sort((left, right) => left.time.localeCompare(right.time))
    .forEach(appointment => {
      const id = `notif-appt-${appointment.id}`;
      result.push({
        id,
        readKey: JSON.stringify([id, appointment.date, appointment.time, appointment.status, appointment.patientName, appointment.note]),
        type: 'appointment',
        title: appointment.status === 'waiting' ? `في الانتظار: ${appointment.patientName}` : `موعد اليوم: ${appointment.patientName}`,
        message: `الموعد الساعة ${appointment.time} — ${appointment.note || 'متابعة'}`,
        date: 'اليوم',
        actionPayload: { view: 'appointments' },
      });
    });

  patients.forEach(patient => {
    const balance = getPatientFinancialSummary(patient).totalRemaining;
    // A remaining balance is not necessarily overdue; keep the existing threshold.
    if (balance <= 500) return;
    const id = `notif-fin-${patient.id}`;
    result.push({
      id,
      readKey: JSON.stringify([id, balance]),
      type: 'finance',
      title: `رصيد متبقٍ: ${patient.name}`,
      message: `متبقي ${balance.toLocaleString('ar-EG')} ج.م على ${patient.withoutFile || patient.id.startsWith('unfiled:') ? 'زيارة بدون ملف' : `الملف #${patient.id}`}؛ ليس إشعار تأخر عن موعد سداد.`,
      date: 'متبقٍ',
      actionPayload: { patientId: patient.id },
    });
  });

  labCases.forEach(labCase => {
    if (!['pending', 'ready', 'delayed'].includes(labCase.status)) return;
    const id = `notif-lab-${labCase.id}`;
    const status = labCase.status === 'ready' ? 'جاهزة للاستلام' : labCase.status === 'delayed' ? 'متأخرة' : 'قيد التجهيز';
    result.push({
      id,
      readKey: JSON.stringify([id, labCase.status, labCase.date, labCase.deliveryExpectedDate, labCase.patientName, labCase.type, labCase.labName]),
      type: 'lab',
      title: `حالة معمل ${status}: ${labCase.patientName}`,
      message: `حالة (${labCase.type}) مع معمل «${labCase.labName}» ${status}.`,
      date: labCase.deliveryExpectedDate || labCase.date,
      actionPayload: { view: 'lab' },
    });
  });
  return result;
}

export function countUnreadNotifications(notifications: readonly ClinicNotification[], readKeys: ReadonlySet<string>): number {
  return notifications.reduce((count, notification) => count + (readKeys.has(notification.readKey) ? 0 : 1), 0);
}

export function markNotificationsRead(readKeys: ReadonlySet<string>, notifications: readonly ClinicNotification[]): Set<string> {
  return new Set([...readKeys, ...notifications.map(notification => notification.readKey)]);
}
