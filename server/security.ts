import type { Request, RequestHandler, Response } from 'express';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

export type TokenVerifier = (token: string) => Promise<{ uid: string }>;
export interface AiSecurityOptions {
  env?: NodeJS.ProcessEnv;
  verifyToken?: TokenVerifier;
  now?: () => number;
  requestLimit?: number;
  userMinuteLimit?: number;
  userHourLimit?: number;
  globalHourLimit?: number;
  maxConcurrent?: number;
}

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const IMAGE_PATHS = new Set(['/extract-invoice', '/endodontic-helper']);
const API_PATHS = new Set([...IMAGE_PATHS, '/smart-search', '/schedule-assistant', '/financial-insights', '/clinical-summary']);
const unavailable = 'التحليل السحابي غير مفعّل بحساب موثوق. يمكنك استخدام البحث المحلي والإدخال اليدوي.';

// Bounded, expiring, process-local limits; a shared gateway is still required
// before running several server instances. Never trust X-Forwarded-For by default.
class WindowLimiter {
  private entries = new Map<string, { count: number; until: number }>();
  constructor(private readonly limit: number, private readonly windowMs: number, private readonly now: () => number) {}
  take(key: string): boolean {
    const currentTime = this.now();
    for (const [id, entry] of this.entries) if (entry.until <= currentTime) this.entries.delete(id);
    let entry = this.entries.get(key);
    if (!entry) {
      if (this.entries.size >= 4096) return false;
      entry = { count: 0, until: currentTime + this.windowMs };
      this.entries.set(key, entry);
    }
    if (entry.count >= this.limit) return false;
    entry.count++;
    return true;
  }
}

function readOrigins(value: string | undefined): Set<string> {
  const origins = new Set<string>();
  for (const item of (value || '').split(',')) {
    const text = item.trim();
    if (!text) continue;
    try {
      const url = new URL(text);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash
        || url.pathname !== '/' || (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) return new Set();
      origins.add(url.origin);
    } catch { return new Set(); }
  }
  return origins;
}

function firebaseVerifier(projectId: string): TokenVerifier {
  return async token => {
    const name = `dental-ai-${projectId}`;
    const app = getApps().find(existing => existing.name === name)
      || initializeApp({ projectId, credential: applicationDefault() }, name);
    // Also reject disabled users and revoked credentials, not just a valid signature.
    const decoded = await getAuth(app).verifyIdToken(token, true);
    return { uid: decoded.uid };
  };
}

export function createAiSecurity(options: AiSecurityOptions = {}) {
  const env = options.env || process.env;
  const origins = readOrigins(env.AI_ALLOWED_ORIGINS);
  const allowedUids = new Set((env.AI_ALLOWED_UIDS || '').split(',').map(value => value.trim()).filter(value => value.length > 0 && value.length <= 128 && !/[\x00-\x20]/.test(value)));
  const projectId = env.AI_FIREBASE_PROJECT_ID || '';
  const configured = env.AI_AUTH_ENABLED === 'true' && /^[a-z][a-z0-9-]{3,62}$/.test(projectId)
    && allowedUids.size > 0 && origins.size > 0 && Boolean(env.GEMINI_API_KEY?.trim())
    && Boolean(env.GOOGLE_APPLICATION_CREDENTIALS || env.AI_USE_APPLICATION_DEFAULT_CREDENTIALS === 'true')
    && !env.FIREBASE_AUTH_EMULATOR_HOST;
  const verify = options.verifyToken || firebaseVerifier(projectId);
  const now = options.now || Date.now;
  const incoming = new WindowLimiter(options.requestLimit ?? 30, 60_000, now);
  const perMinute = new WindowLimiter(options.userMinuteLimit ?? 6, 60_000, now);
  const perHour = new WindowLimiter(options.userHourLimit ?? 30, 3_600_000, now);
  const global = new WindowLimiter(options.globalHourLimit ?? 100, 3_600_000, now);
  let active = 0;
  const userActive = new Set<string>();
  const authorize: RequestHandler = async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST' || !API_PATHS.has(req.path)) return void res.status(404).json({ error: 'المسار غير متاح.' });
    if (!incoming.take(req.socket.remoteAddress || 'unknown')) {
      res.setHeader('Retry-After', '60');
      return void res.status(429).json({ error: 'طلبات كثيرة. انتظر دقيقة ثم حاول مجددًا.' });
    }
    if (!configured) return void res.status(503).json({ error: unavailable });
    const origin = req.get('Origin');
    if (!origin || !origins.has(origin) || req.get('Sec-Fetch-Site') === 'cross-site') return void res.status(403).json({ error: 'مصدر الطلب غير مسموح.' });
    if (!req.is('application/json') || req.get('Content-Encoding') && req.get('Content-Encoding') !== 'identity') return void res.status(415).json({ error: 'أرسل بيانات JSON غير مضغوطة.' });
    const authorization = req.get('Authorization') || '';
    if (authorization.length > 8192 || !/^Bearer [A-Za-z0-9_.-]+$/.test(authorization)) return void res.status(401).json({ error: 'سجّل الدخول بحساب موثوق قبل استخدام التحليل السحابي.' });
    try {
      const identity = await verify(authorization.slice(7));
      if (!allowedUids.has(identity.uid)) return void res.status(403).json({ error: 'الحساب غير مصرح له باستخدام التحليل السحابي.' });
      res.locals.aiUid = identity.uid;
      next();
    } catch {
      // Never disclose a token, secret, raw SDK response, or credential error.
      res.status(401).json({ error: 'جلسة التحليل السحابي غير صالحة. سجّل الدخول مرة أخرى.' });
    }
  };
  const admit: RequestHandler = (req, res, next) => {
    try { req.body = validateAiPayload(req.path, req.body); }
    catch { return void res.status(400).json({ error: 'راجع البيانات المرسلة وحجم الصورة والتاريخ والمبالغ.' }); }
    const uid = res.locals.aiUid;
    if (typeof uid !== 'string') return void res.status(401).json({ error: 'جلسة التحليل غير صالحة.' });
    if (!perMinute.take(uid) || !perHour.take(uid) || !global.take('all')) {
      res.setHeader('Retry-After', '60');
      return void res.status(429).json({ error: 'وصلت إلى حد التحليل المؤقت. استخدم الإدخال اليدوي أو حاول لاحقًا.' });
    }
    if (active >= (options.maxConcurrent ?? 2) || userActive.has(uid)) return void res.status(429).json({ error: 'انتظر حتى ينتهي التحليل الحالي قبل إرسال طلب جديد.' });
    active++;
    userActive.add(uid);
    let released = false;
    const release = () => { if (!released) { released = true; active--; userActive.delete(uid); } };
    // Keep the admission until the provider call settles, even if the client
    // disconnects; otherwise an attacker can evade concurrency by aborting fetch.
    res.locals.releaseAi = release;
    next();
  };
  return { authorize, admit };
}

export function releaseAiRequest(res: Response): void { res.locals.releaseAi?.(); }
export const aiBodyLimit = (path: string) => IMAGE_PATHS.has(path) ? '3mb' : '256kb';

function record(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object');
  return value as Record<string, any>;
}
function text(value: unknown, max: number, optional = false): string {
  if (value === undefined && optional) return '';
  if (typeof value !== 'string' || value.length > max || (!optional && !value.trim()) || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) throw new Error('text');
  return value.trim();
}
function amount(value: unknown, optional = false): number {
  if (value === undefined && optional) return 0;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1e12) throw new Error('number');
  return value;
}
function count(value: unknown): number { const result = amount(value); if (!Number.isInteger(result) || result > 100_000) throw new Error('count'); return result; }
function validDate(value: unknown): string {
  const date = text(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('date');
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new Error('date');
  return date;
}
function image(body: Record<string, any>) {
  let encoded = text(body.imageBase64, Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 64);
  let mimeType = body.mimeType === undefined ? 'image/jpeg' : text(body.mimeType, 20);
  const dataUrl = /^data:(image\/(?:jpeg|png|webp));base64,/.exec(encoded);
  if (dataUrl) { if (body.mimeType !== undefined && body.mimeType !== dataUrl[1]) throw new Error('mime'); mimeType = dataUrl[1]; encoded = encoded.slice(dataUrl[0].length); }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType) || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new Error('image');
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES || bytes.toString('base64') !== encoded) throw new Error('image');
  const signatureMatches = mimeType === 'image/jpeg' ? bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
    : mimeType === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  if (!signatureMatches) throw new Error('mime');
  return { imageBase64: encoded, mimeType };
}

export function validateAiPayload(route: string, input: unknown): Record<string, any> {
  const body = record(input);
  if (IMAGE_PATHS.has(route)) {
    const result = image(body);
    if (route === '/endodontic-helper') {
      const toothNumber = text(body.toothNumber, 2);
      if (!/^[1-8][1-8]$/.test(toothNumber) || (Number(toothNumber[0]) <= 4 ? Number(toothNumber[1]) > 8 : Number(toothNumber[1]) > 5)) throw new Error('tooth');
      return { ...result, toothNumber };
    }
    return result;
  }
  if (route === '/smart-search') {
    if (!Array.isArray(body.patients) || body.patients.length > 1000) throw new Error('patients');
    const ids = new Set<string>();
    const patients = body.patients.map((value: unknown) => {
      const patient = record(value);
      const id = text(patient.id, 80); if (ids.has(id)) throw new Error('duplicate'); ids.add(id);
      return { id, name: text(patient.name, 160), mobile: text(patient.mobile, 40, true), notes: text(patient.notes, 2000, true),
        recentServices: text(patient.recentServices, 2000, true) };
    });
    return { query: text(body.query, 300), patients };
  }
  if (route === '/schedule-assistant') {
    if (!Array.isArray(body.existingAppointments) || body.existingAppointments.length > 500) throw new Error('appointments');
    const date = validDate(body.date);
    const existingAppointments = body.existingAppointments.map((value: unknown) => {
      const item = record(value); const time = text(item.time, 5);
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('time');
      const durationMinutes = item.durationMinutes === undefined ? 30 : count(item.durationMinutes);
      if (durationMinutes < 1 || durationMinutes > 1440) throw new Error('duration');
      return { date: validDate(item.date), time, durationMinutes };
    }).filter(item => item.date === date);
    return { date, procedureType: text(body.procedureType, 160), existingAppointments };
  }
  if (route === '/financial-insights') {
    const categoryTotals = record(body.categoryTotals);
    if (Object.keys(categoryTotals).length > 20) throw new Error('categories');
    const totals = Object.fromEntries(Object.entries(categoryTotals).map(([key, value]) => [text(key, 80), amount(value)]));
    return { currentMonthRevenue: amount(body.currentMonthRevenue), currentMonthExpenses: amount(body.currentMonthExpenses),
      previousMonthRevenue: amount(body.previousMonthRevenue, true), previousMonthExpenses: amount(body.previousMonthExpenses, true), categoryTotals: totals };
  }
  if (route === '/clinical-summary') return { appointmentsCount: count(body.appointmentsCount), totalRevenue: amount(body.totalRevenue),
    pendingFollowUps: count(body.pendingFollowUps), totalDebt: amount(body.totalDebt), newPatientsCount: count(body.newPatientsCount) };
  throw new Error('route');
}
