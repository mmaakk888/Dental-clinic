import { User } from '../types';

export interface AccessDecision {
  allowed: boolean;
  message?: string;
}

const minutesFromTime = (value: string) => {
  const [hours, minutes] = value.split(':').map(Number);
  return (Number.isFinite(hours) ? hours : 0) * 60 + (Number.isFinite(minutes) ? minutes : 0);
};

export function canUserLoginNow(user: User, now = new Date()): AccessDecision {
  if (user.isActive === false) {
    return { allowed: false, message: 'هذا الحساب موقوف. يرجى التواصل مع مدير العيادة' };
  }

  const schedule = user.accessSchedule;
  if (!schedule?.enabled) return { allowed: true };

  const timezone = schedule.timezone;
  let day = now.getDay();
  let currentMinutes = now.getHours() * 60 + now.getMinutes();
  if (timezone) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(now);
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value || '';
    const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    day = weekdays[part('weekday')] ?? day;
    currentMinutes = Number(part('hour')) * 60 + Number(part('minute'));
  }
  if (!schedule.days.includes(day)) {
    return { allowed: false, message: 'الحساب غير متاح في هذا اليوم حسب جدول العمل المحدد' };
  }

  const start = minutesFromTime(schedule.startTime);
  const end = minutesFromTime(schedule.endTime);
  const withinHours = start <= end
    ? currentMinutes >= start && currentMinutes <= end
    : currentMinutes >= start || currentMinutes <= end;

  if (!withinHours) {
    return {
      allowed: false,
      message: `الحساب متاح فقط من ${schedule.startTime} إلى ${schedule.endTime}`
    };
  }

  return { allowed: true };
}
