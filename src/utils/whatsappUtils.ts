// WhatsApp & Reminder Utilities for Dental Clinic Management

import { Appointment } from '../types';

export function format12HourAr(time24: string): string {
  if (!time24) return '';
  const [hStr, mStr] = time24.split(':');
  let h = parseInt(hStr, 10);
  if (isNaN(h)) return time24;
  const period = h >= 12 ? 'مساءً' : 'صباحاً';
  h = h % 12 || 12;
  return `${h}:${mStr || '00'} ${period}`;
}

export function formatArabicDate(dateStr: string): string {
  if (!dateStr) return '';
  try {
    const [y, m, d] = dateStr.split('-');
    if (!y || !m || !d) return dateStr;
    const dateObj = new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10));
    const dayName = dateObj.toLocaleDateString('ar-EG', { weekday: 'long' });
    return `${dayName} (${d}/${m}/${y})`;
  } catch (e) {
    return dateStr;
  }
}

export function buildAppointmentReminderText(appt: {
  patientName: string;
  date: string;
  time: string;
  doctorName?: string;
  appointmentType?: string;
  clinicName?: string;
}): string {
  const doctor = appt.doctorName || 'طبيب العيادة';
  const visitType = appt.appointmentType || 'مراجعة واستشارة';
  const formattedDate = formatArabicDate(appt.date);
  const formattedTime = format12HourAr(appt.time);

  return `السلام عليكم ورحمة الله وبركاته،
أهلاً بك أ. ${appt.patientName}، نذكركم بموعدكم القادم في العيادة.

📅 التاريخ: ${formattedDate}
🕒 الوقت: ${formattedTime}
👨‍⚕️ الطبيب: ${doctor}
🦷 نوع الزيارة: ${visitType}

يرجى الحضور قبل الموعد بـ 10 دقائق.
نتمنى لكم دوام الصحة والعافية.`;
}

export function cleanEgyptianPhone(phone: string): string {
  if (!phone) return '';
  let cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('01')) {
    cleaned = '20' + cleaned;
  }
  return cleaned;
}

export function getWhatsAppUrl(phone: string, text: string): string {
  const cleanPhone = cleanEgyptianPhone(phone);
  const encodedText = encodeURIComponent(text);
  if (cleanPhone) {
    return `https://wa.me/${cleanPhone}?text=${encodedText}`;
  }
  return `https://wa.me/?text=${encodedText}`;
}

// Future-ready webhook payload generator for WhatsApp Business API / SMS gateway integration
export interface FutureAutomatedReminderPayload {
  recipientPhone: string;
  recipientName: string;
  appointmentId: string;
  scheduledTimeISO: string; // Combined ISO timestamp
  templateName: 'appointment_reminder_24h' | 'appointment_reminder_2h' | 'post_op_feedback';
  parameters: {
    patient_name: string;
    appointment_date: string;
    appointment_time: string;
    doctor_name: string;
    visit_type: string;
  };
}

export function buildAutomatedWebhookPayload(
  appt: Appointment,
  template: 'appointment_reminder_24h' | 'appointment_reminder_2h' | 'post_op_feedback'
): FutureAutomatedReminderPayload {
  const timeFormatted = format12HourAr(appt.time);
  const dateFormatted = formatArabicDate(appt.date);

  return {
    recipientPhone: cleanEgyptianPhone(appt.mobile),
    recipientName: appt.patientName,
    appointmentId: appt.id,
    scheduledTimeISO: `${appt.date}T${appt.time}:00`,
    templateName: template,
    parameters: {
      patient_name: appt.patientName,
      appointment_date: dateFormatted,
      appointment_time: timeFormatted,
      doctor_name: appt.doctorName || 'د. العيادة',
      visit_type: appt.appointmentType || 'كشف ومتابعة'
    }
  };
}
