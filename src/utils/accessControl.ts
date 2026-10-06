import { User } from '../types';
import { isPasswordHash } from './passwords';

export const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;
export const REMEMBERED_SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export interface LocalSessionIdentity {
  userId: string;
  username: string;
  credentialVersion: number;
  issuedAt?: string;
  expiresAt?: string;
}

/** Time bounds are a local safeguard, not a signed/authoritative server session. */
export function isSessionFresh(session: Pick<LocalSessionIdentity, 'issuedAt' | 'expiresAt'> | null | undefined,
  now: number | Date = Date.now(), maxAgeMs = REMEMBERED_SESSION_MAX_AGE_MS): boolean {
  if (!session || typeof session.issuedAt !== 'string' || typeof session.expiresAt !== 'string') return false;
  const issued = Date.parse(session.issuedAt), expires = Date.parse(session.expiresAt);
  const current = now instanceof Date ? now.getTime() : now;
  if (!Number.isFinite(issued) || !Number.isFinite(expires) || !Number.isFinite(current)
    || !Number.isFinite(maxAgeMs) || maxAgeMs <= 0) return false;
  if (new Date(issued).toISOString() !== session.issuedAt || new Date(expires).toISOString() !== session.expiresAt) return false;
  return issued <= current && current < expires && expires > issued && expires - issued <= maxAgeMs;
}

export function matchesRememberedSession(user: User, session: LocalSessionIdentity, now: number | Date = Date.now()): boolean {
  return isPasswordHash(user.password) && matchesSessionIdentity(user, session) && isSessionFresh(session, now);
}

export interface AccessDecision {
  allowed: boolean;
  message?: string;
}

export function matchesSessionIdentity(user: User, session: LocalSessionIdentity): boolean {
  return user.isActive !== false && typeof user.id === 'string' && !!user.id
    && typeof user.username === 'string' && typeof session.username === 'string'
    && Number.isSafeInteger(session.credentialVersion) && session.credentialVersion > 0
    && (user.credentialVersion === undefined || (Number.isSafeInteger(user.credentialVersion) && user.credentialVersion > 0))
    && user.id === session.userId &&
    user.username.toLowerCase() === session.username.toLowerCase() &&
    (user.credentialVersion ?? 1) === session.credentialVersion;
}

const minutesFromTime = (value: string) => {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return NaN;
  const [hours, minutes] = value.split(':').map(Number);
  return (Number.isFinite(hours) ? hours : 0) * 60 + (Number.isFinite(minutes) ? minutes : 0);
};

export function canUserLoginNow(user: User, now = new Date()): AccessDecision {
  if (!user || !Number.isFinite(now.getTime()) || !['doctor', 'admin', 'secretary'].includes(user.role)) {
    return { allowed: false, message: 'بيانات الحساب أو الوقت غير صالحة. يرجى مراجعة مدير العيادة' };
  }
  if (user.isActive === false) {
    return { allowed: false, message: 'هذا الحساب موقوف. يرجى التواصل مع مدير العيادة' };
  }

  const schedule = user.accessSchedule;
  if (!schedule?.enabled) return { allowed: true };

  const timezone = schedule.timezone;
  const start = minutesFromTime(schedule.startTime);
  const end = minutesFromTime(schedule.endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start === end || !Array.isArray(schedule.days)
    || !schedule.days.length || schedule.days.some(day => !Number.isInteger(day) || day < 0 || day > 6)) {
    return { allowed: false, message: 'جدول العمل غير صالح. يرجى مراجعته مع مدير العيادة' };
  }
  let day = now.getDay();
  let currentMinutes = now.getHours() * 60 + now.getMinutes();
  if (timezone) {
    try {
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
    } catch {
      return { allowed: false, message: 'المنطقة الزمنية لجدول العمل غير صالحة. يرجى مراجعة مدير العيادة' };
    }
  }
  // After midnight, an overnight shift belongs to the day on which it started.
  const shiftDay = start > end && currentMinutes < end ? (day + 6) % 7 : day;
  if (!schedule.days.includes(shiftDay)) {
    return { allowed: false, message: 'الحساب غير متاح في هذا اليوم حسب جدول العمل المحدد' };
  }

  const withinHours = start <= end
    ? currentMinutes >= start && currentMinutes < end
    : currentMinutes >= start || currentMinutes < end;

  if (!withinHours) {
    return {
      allowed: false,
      message: `الحساب متاح فقط من ${schedule.startTime} إلى ${schedule.endTime}`
    };
  }

  return { allowed: true };
}
