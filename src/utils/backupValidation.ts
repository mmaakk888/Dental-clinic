import type { Appointment, ClinicContact, DrugCatalogItem, Expense, Lab, LabCase, MaterialUsage, Patient, ThemeSettings, UILabels, User, WhatsappSettings } from '../types';
import { appointmentTimeMinutes, isValidAppointmentDate } from '../components/appointments/appointmentScheduling';
import { cloneContentDraft } from './clinicContent';
import { isValidDockAppearance } from './dockAppearance';
import { normalizeHexColor } from './clinicIdentity';
import { normalizeServiceName } from './serviceCatalog';
import { canPerformAction } from './rbac';
import { validateAccountSchedule } from './userAccounts';
import { clinicContactValidationError, normalizeContactPhone } from './clinicContacts';
import { canonicalFileNumber } from './clinicMutations';

export interface ValidatedClinicBackup {
  patients?: Patient[]; appointments?: Appointment[]; labs?: Lab[]; labCases?: LabCase[];
  contacts?: ClinicContact[];
  expenses?: Expense[]; materialUsages?: MaterialUsage[]; users?: User[];
  serviceTypes?: string[]; crownPrices?: Record<string, number>; drugCatalog?: DrugCatalogItem[];
  whatsappSettings?: WhatsappSettings; clinicName?: string; clinicLogo?: string | null;
  theme?: ThemeSettings; labels?: UILabels; tileOrder?: string[];
}
export interface BackupValidationContext { patients?: Patient[]; labs?: Lab[]; labCases?: LabCase[]; appointments?: Appointment[] }
export type BackupValidationResult = { valid: true; value: ValidatedClinicBackup; errors: [] }
  | { valid: false; value: null; errors: string[] };

export const MAX_BACKUP_BYTES = 64 * 1024 * 1024;
const MAX_ROWS = 50_000;
const MAX_IMAGE_CHARACTERS = 12 * 1024 * 1024;
const MAX_MONEY = 1_000_000_000;
type RecordValue = Record<string, any>;
const isRecord = (value: unknown): value is RecordValue => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const knownSections = ['patients', 'contacts', 'appointments', 'labs', 'labCases', 'expenses', 'materialUsages', 'users', 'serviceTypes', 'crownPrices', 'drugCatalog', 'whatsappSettings', 'clinicName', 'clinicLogo', 'theme', 'labels', 'tileOrder'] as const;

/** Validate the entire input before the caller performs any state or storage writes.
 * Missing legacy sections stay absent; safe optional defaults do not invent charges.
 * Unknown JSON-safe record fields are retained for forward/legacy compatibility.
 */
export function validateClinicBackup(input: unknown, context: BackupValidationContext = {}): BackupValidationResult {
  const errors: string[] = [];
  const fail = (path: string, detail = 'بيانات غير صالحة') => { if (errors.length < 20) errors.push(`${detail}: ${path}`); };
  let nodes = 0;
  let bytes = 0;
  const seen = new WeakSet<object>();
  const encoder = new TextEncoder();
  const cloneJson = (value: unknown, path: string, depth = 0): any => {
    if (++nodes > 500_000 || depth > 32) { fail(path, 'النسخة كبيرة أو شديدة التداخل'); return null; }
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') { if (!Number.isFinite(value)) fail(path); return value; }
    if (typeof value === 'string') {
      bytes += encoder.encode(value).byteLength;
      if (bytes > MAX_BACKUP_BYTES || value.length > MAX_IMAGE_CHARACTERS) fail(path, 'النسخة أو أحد حقولها يتجاوز الحد المسموح');
      return value;
    }
    if (!isRecord(value) && !Array.isArray(value)) { fail(path); return null; }
    if (seen.has(value)) { fail(path, 'النسخة تحتوي مرجعًا دائريًا'); return null; }
    seen.add(value);
    if (Array.isArray(value)) {
      if (value.length > MAX_ROWS) { fail(path, 'عدد السجلات يتجاوز ٥٠ ألفًا'); seen.delete(value); return []; }
      const result = value.map((entry, index) => cloneJson(entry, `${path}[${index}]`, depth + 1));
      seen.delete(value); return result;
    }
    const result: RecordValue = {};
    for (const [key, entry] of Object.entries(value)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) { fail(path, 'النسخة تحتوي مفتاحًا غير آمن'); continue; }
      bytes += encoder.encode(key).byteLength;
      // Application state may contain undefined optional fields; JSON backups omit them.
      if (entry === undefined) continue;
      Object.defineProperty(result, key, { value: cloneJson(entry, `${path}.${key}`, depth + 1), writable: true, enumerable: true, configurable: true });
    }
    seen.delete(value); return result;
  };
  if (!isRecord(input)) return { valid: false, value: null, errors: ['ملف النسخة الاحتياطية يجب أن يحتوي كائن بيانات صالحًا.'] };
  const data = cloneJson(input, 'backup') as RecordValue;
  if (errors.length) return { valid: false, value: null, errors };
  if (!knownSections.some(key => Object.hasOwn(data, key))) fail('backup', 'لا توجد أقسام عيادة معروفة في النسخة');

  const text = (record: RecordValue, key: string, path: string, options: { required?: boolean; max?: number; defaultValue?: string; line?: boolean } = {}) => {
    if (record[key] === undefined && options.defaultValue !== undefined) record[key] = options.defaultValue;
    if (record[key] === undefined && !options.required) return;
    if (typeof record[key] !== 'string' || record[key].length > (options.max ?? 20_000)
      || options.required && !record[key].trim() || options.line && /[\u0000-\u001f\u007f]/.test(record[key])) fail(`${path}.${key}`);
  };
  const number = (record: RecordValue, key: string, path: string, options: { required?: boolean; min?: number; max?: number; integer?: boolean; defaultValue?: number } = {}) => {
    if (record[key] === undefined && options.defaultValue !== undefined) record[key] = options.defaultValue;
    if (record[key] === undefined && !options.required) return;
    const value = record[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < (options.min ?? 0) || value > (options.max ?? MAX_MONEY)
      || options.integer && !Number.isInteger(value)) fail(`${path}.${key}`);
  };
  const bool = (record: RecordValue, key: string, path: string, defaultValue?: boolean) => {
    if (record[key] === undefined && defaultValue !== undefined) record[key] = defaultValue;
    if (record[key] !== undefined && typeof record[key] !== 'boolean') fail(`${path}.${key}`);
  };
  const choice = (record: RecordValue, key: string, path: string, values: readonly string[], required = false) => {
    if (record[key] !== undefined || required) if (!values.includes(record[key])) fail(`${path}.${key}`);
  };
  const date = (record: RecordValue, key: string, path: string, required = false, emptyAllowed = false) => {
    if (record[key] === undefined && !required) return;
    if (emptyAllowed && record[key] === '') return;
    if (typeof record[key] !== 'string' || !isValidAppointmentDate(record[key])) fail(`${path}.${key}`);
  };
  const timestamp = (record: RecordValue, key: string, path: string) => {
    if (record[key] !== undefined && (typeof record[key] !== 'string' || record[key].length > 100 || !Number.isFinite(Date.parse(record[key])))) fail(`${path}.${key}`);
  };
  const list = (record: RecordValue, key: string, path: string, validator: (row: RecordValue, path: string) => void, options: { required?: boolean; defaults?: boolean; limit?: number; uniqueId?: boolean } = {}) => {
    if (record[key] === undefined && options.defaults) record[key] = [];
    if (record[key] === undefined && !options.required) return;
    const value = record[key];
    if (!Array.isArray(value) || value.length > (options.limit ?? MAX_ROWS)) { fail(`${path}.${key}`); return; }
    const ids = new Set<string>();
    value.forEach((row, index) => {
      const rowPath = `${path}.${key}[${index}]`;
      if (!isRecord(row)) { fail(rowPath); return; }
      if (options.uniqueId !== false) {
        text(row, 'id', rowPath, { required: true, line: true, max: 200 });
        if (ids.has(row.id)) fail(`${rowPath}.id`, 'معرّف سجل مكرر');
        ids.add(row.id);
      }
      validator(row, rowPath);
    });
  };
  const image = (record: RecordValue, key: string, path: string, nullable = false) => {
    const value = record[key];
    if (value === undefined || nullable && value === null) return;
    if (typeof value !== 'string' || value.length > MAX_IMAGE_CHARACTERS) { fail(`${path}.${key}`); return; }
    if (/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) return;
    try { const url = new URL(value); if (url.protocol === 'https:' && !url.username && !url.password && value.length <= 2048) return; } catch { /* rejected below */ }
    fail(`${path}.${key}`, 'رابط الصورة غير آمن أو غير صالح');
  };
  const strings = (record: RecordValue, keys: readonly string[], path: string, max = 20_000) => keys.forEach(key => text(record, key, path, { max }));
  const money = (record: RecordValue, keys: readonly string[], path: string) => keys.forEach(key => number(record, key, path));
  const receipt = (row: RecordValue, path: string) => {
    number(row, 'amount', path, { required: true }); date(row, 'date', path, true);
    choice(row, 'paymentMethod', path, ['cash', 'card', 'transfer']);
    strings(row, ['note', 'recordedBy', 'voidReason', 'linkedSessionId'], path);
    ['createdAt', 'voidedAt'].forEach(key => timestamp(row, key, path)); bool(row, 'legacyAggregate', path);
  };
  const globalSessionIds = new Set<string>();
  const canonicalPatientIds = new Set<string>();
  const patientRow = (row: RecordValue, path: string) => {
    if (typeof row.id === 'string') {
      const canonicalId = canonicalFileNumber(row.id);
      if (canonicalPatientIds.has(canonicalId)) fail(`${path}.id`, 'رقم ملف مكرر بصيغة أرقام مختلفة');
      canonicalPatientIds.add(canonicalId);
    }
    text(row, 'name', path, { required: true, max: 200 }); text(row, 'mobile', path, { defaultValue: '', max: 60, line: true });
    number(row, 'age', path, { required: true, integer: true, max: 120 });
    if (row.firstVisit === undefined) row.firstVisit = '';
    date(row, 'firstVisit', path, true, true); text(row, 'notes', path, { defaultValue: '' }); text(row, 'allergy', path, { defaultValue: '' });
    text(row, 'gender', path, { max: 60 });
    list(row, 'sessions', path, (session, sessionPath) => {
      if (globalSessionIds.has(session.id)) fail(`${sessionPath}.id`, 'معرّف جلسة مكرر بين الملفات');
      globalSessionIds.add(session.id);
      text(session, 'type', sessionPath, { defaultValue: '', max: 200 });
      if (session.tooth === undefined) session.tooth = null;
      if (session.tooth !== null) text(session, 'tooth', sessionPath, { required: true, max: 60, line: true });
      if (session.teethIds !== undefined && (!Array.isArray(session.teethIds) || session.teethIds.length > 100 || !session.teethIds.every((id: unknown) => typeof id === 'string' && id.length <= 60))) fail(`${sessionPath}.teethIds`);
      number(session, 'amount', sessionPath, { required: true }); number(session, 'paid', sessionPath, { defaultValue: 0 });
      number(session, 'remain', sessionPath, { defaultValue: Math.max(0, session.amount - (session.discount || 0) - session.paid) });
      money(session, ['discount', 'examinationFee', 'treatmentFee'], sessionPath);
      if (typeof session.discount === 'number' && session.discount > session.amount) fail(`${sessionPath}.discount`);
      date(session, 'date', sessionPath, true); date(session, 'payDate', sessionPath);
      strings(session, ['toothNum', 'toothLabel', 'chiefComplaint', 'diagnosis', 'procedurePerformed', 'prescriptionNotes', 'visitNotes', 'doctorName', 'time'], sessionPath);
      choice(session, 'paymentMethod', sessionPath, ['cash', 'card', 'transfer']); choice(session, 'visitStatus', sessionPath, ['completed', 'follow_up']);
      choice(session, 'treatmentStage', sessionPath, ['single', 'first', 'second', 'third', 'follow_up']);
      choice(session, 'rootCanalStatus', sessionPath, ['access_cleaning', 'working_length', 'canal_filled', 'impression', 'final_restoration']); bool(session, 'isWalkIn', sessionPath);
      list(session, 'paymentsLog', sessionPath, receipt, { defaults: true });
      list(session, 'services', sessionPath, (service, servicePath) => {
        text(service, 'name', servicePath, { required: true, max: 200 }); number(service, 'price', servicePath, { required: true }); money(service, ['paid', 'discount'], servicePath);
      });
    }, { defaults: true });
    list(row, 'payments', path, receipt, { defaults: true });
    const sessionIds = new Set((Array.isArray(row.sessions) ? row.sessions : []).filter(isRecord).map(session => session.id));
    (Array.isArray(row.payments) ? row.payments : []).filter(isRecord).forEach((payment, index) => {
      if (payment.linkedSessionId && !sessionIds.has(payment.linkedSessionId)) fail(`${path}.payments[${index}].linkedSessionId`, 'الدفعة مرتبطة بجلسة غير موجودة');
    });
  };
  list(data, 'patients', 'backup', patientRow);
  const contactPhones = new Set<string>();
  list(data, 'contacts', 'backup', (row, path) => {
    const error = clinicContactValidationError(row);
    if (error) fail(path, error);
    const phone = normalizeContactPhone(row.mobile);
    if (phone && contactPhones.has(phone)) fail(`${path}.mobile`, 'رقم مكرر في جهات الاتصال');
    if (phone) contactPhones.add(phone);
  });
  list(data, 'appointments', 'backup', (row, path) => {
    strings(row, ['patientId', 'fileNo', 'mobile', 'doctorName', 'appointmentType'], path, 200);
    text(row, 'patientName', path, { required: true, max: 200 }); text(row, 'note', path, { defaultValue: '' });
    bool(row, 'isFollowUp', path, false); bool(row, 'isWalkIn', path, false); bool(row, 'reminderSent', path);
    date(row, 'date', path, true); text(row, 'time', path, { required: true, max: 5 });
    if (appointmentTimeMinutes(row.time) === null) fail(`${path}.time`);
    number(row, 'durationMinutes', path, { min: 1, max: 1440 });
    choice(row, 'status', path, ['scheduled', 'waiting', 'attended', 'no_show', 'apologized', 'confirmed', 'cancelled'], true);
    if (row.patientId === undefined) row.patientId = row.fileNo || '';
    if (row.fileNo === undefined) row.fileNo = row.patientId || '';
    if (!row.patientId && !row.isWalkIn) fail(`${path}.patientId`);
    if (row.patientId && row.fileNo && row.patientId !== row.fileNo) fail(`${path}.fileNo`, 'رقم الملف لا يطابق المريض المرتبط');
    if (row.mobile === undefined) row.mobile = '';
    list(row, 'reminderLog', path, (log, logPath) => {
      timestamp(log, 'sentAt', logPath); text(log, 'sentAt', logPath, { required: true, max: 100 });
      choice(log, 'type', logPath, ['whatsapp', 'sms'], true); choice(log, 'channel', logPath, ['manual_wa', 'api_wa', 'sms'], true); choice(log, 'status', logPath, ['sent', 'pending', 'failed'], true);
    }, { uniqueId: false });
  });
  list(data, 'labs', 'backup', (row, path) => {
    text(row, 'name', path, { required: true, max: 200 }); strings(row, ['phone', 'address', 'notes'], path);
    list(row, 'services', path, (service, servicePath) => {
      text(service, 'name', servicePath, { required: true, max: 200 }); text(service, 'unitLabel', servicePath, { required: true, max: 100 });
      choice(service, 'category', servicePath, ['fixed', 'removable', 'other'], true); number(service, 'price', servicePath, { required: true });
    }, { required: true });
  });
  list(data, 'labCases', 'backup', (row, path) => {
    ['labId', 'patientId', 'fileNo', 'labName', 'patientName', 'type', 'subType', 'unitLabel'].forEach(key => text(row, key, path, { required: true, max: 200 }));
    text(row, 'linkedSessionId', path, { max: 200 }); number(row, 'units', path, { required: true, min: .000001, max: 10_000 });
    ['labTotal', 'labPaid', 'patientTotal', 'patientPaid'].forEach(key => number(row, key, path, { required: true }));
    date(row, 'date', path, true); date(row, 'deliveryExpectedDate', path); text(row, 'note', path);
    choice(row, 'status', path, ['pending', 'ready', 'delivered', 'delayed', 'completed'], true); list(row, 'paymentsLog', path, receipt);
    if (row.fileNo !== row.patientId) fail(`${path}.fileNo`, 'رقم الملف لا يطابق المريض المرتبط');
  });
  list(data, 'expenses', 'backup', (row, path) => {
    text(row, 'title', path, { required: true, max: 500 }); choice(row, 'category', path, ['supplies', 'fixed', 'maintenance', 'other'], true);
    number(row, 'amount', path, { required: true }); date(row, 'date', path, true); date(row, 'invoiceDate', path);
    money(row, ['subtotal', 'tax', 'discount', 'paidAmount', 'remainingAmount'], path);
    if (row.paidAmount !== undefined && row.paidAmount > row.amount) fail(`${path}.paidAmount`);
    bool(row, 'isFixed', path); choice(row, 'recurringPeriod', path, ['monthly', 'yearly', 'none']);
    choice(row, 'expenseType', path, ['rent', 'electricity', 'water', 'salary', 'supplies', 'maintenance', 'other']);
    choice(row, 'paymentMethod', path, ['cash', 'card', 'transfer', 'credit', 'deferred']); choice(row, 'discountType', path, ['flat', 'percentage']);
    strings(row, ['note', 'supplierName', 'supplierId', 'supplierPhone', 'supplierAddress', 'invoiceNumber', 'invoiceTime', 'taxNumber', 'commercialRecord', 'currency'], path);
    image(row, 'invoiceImageUrl', path); image(row, 'supplierLogo', path); timestamp(row, 'createdAt', path); timestamp(row, 'updatedAt', path);
    list(row, 'items', path, (item, itemPath) => {
      text(item, 'itemName', itemPath, { required: true, max: 500 }); text(item, 'unit', itemPath, { required: true, max: 100 });
      number(item, 'quantity', itemPath, { required: true, min: .000001, max: 10_000_000 }); number(item, 'unitPrice', itemPath, { required: true }); number(item, 'total', itemPath, { required: true });
      money(item, ['discount', 'tax'], itemPath); number(item, 'confidence', itemPath, { max: 100 }); strings(item, ['notes', 'expenseId'], itemPath);
    });
    if (row.confidenceScores !== undefined) {
      if (!isRecord(row.confidenceScores)) fail(`${path}.confidenceScores`);
      else Object.keys(row.confidenceScores).forEach(key => number(row.confidenceScores, key, `${path}.confidenceScores`, { required: true, max: 100 }));
    }
    list(row, 'priceVarianceAlerts', path, (alert, alertPath) => {
      text(alert, 'itemName', alertPath, { required: true }); text(alert, 'unit', alertPath, { required: true });
      money(alert, ['previousPrice', 'currentPrice'], alertPath); number(alert, 'percentageIncrease', alertPath, { required: true, min: -100, max: MAX_MONEY }); date(alert, 'lastPurchaseDate', alertPath);
    }, { uniqueId: false });
    list(row, 'auditLog', path, (log, logPath) => { ['action', 'user', 'timestamp'].forEach(key => text(log, key, logPath, { required: true })); text(log, 'details', logPath); });
  });
  list(data, 'materialUsages', 'backup', (row, path) => {
    ['materialKey', 'materialName', 'unit'].forEach(key => text(row, key, path, { required: true, max: 500 }));
    number(row, 'quantity', path, { required: true, min: .000001, max: 10_000_000 }); number(row, 'unitCostAtUse', path, { required: true });
    date(row, 'date', path, true); choice(row, 'kind', path, ['used', 'waste'], true); text(row, 'note', path);
  });
  list(data, 'users', 'backup', (row, path) => {
    text(row, 'name', path, { required: true, max: 100, line: true }); text(row, 'username', path, { required: true, max: 60, line: true });
    text(row, 'password', path, { max: 1024, line: true }); strings(row, ['email', 'phone'], path, 254);
    choice(row, 'role', path, ['doctor', 'secretary', 'admin'], true); bool(row, 'isActive', path); number(row, 'credentialVersion', path, { min: 1, integer: true });
    if (!isRecord(row.permissions)) fail(`${path}.permissions`);
    else Object.keys(row.permissions).forEach(key => bool(row.permissions, key, `${path}.permissions`));
    if (row.isActive !== false && !(typeof row.password === 'string' && row.password.trim())) fail(`${path}.password`, 'حساب نشط دون بيانات دخول صالحة');
    if (row.accessSchedule !== undefined) {
      if (!isRecord(row.accessSchedule)) fail(`${path}.accessSchedule`);
      else {
        const schedule = row.accessSchedule;
        bool(schedule, 'enabled', `${path}.accessSchedule`);
        if (typeof schedule.enabled !== 'boolean' || !Array.isArray(schedule.days) || schedule.days.some((day: unknown) => !Number.isInteger(day) || Number(day) < 0 || Number(day) > 6)) fail(`${path}.accessSchedule.days`);
        text(schedule, 'startTime', `${path}.accessSchedule`, { required: true, max: 5 }); text(schedule, 'endTime', `${path}.accessSchedule`, { required: true, max: 5 }); text(schedule, 'timezone', `${path}.accessSchedule`, { max: 100 });
        if (validateAccountSchedule(schedule as User['accessSchedule'])) fail(`${path}.accessSchedule`, 'جدول دخول الحساب غير صالح');
      }
    }
  });
  if (Array.isArray(data.users)) {
    const usernames = new Set<string>();
    data.users.filter(isRecord).forEach((user, index) => {
      const username = typeof user.username === 'string' ? user.username.trim().toLowerCase() : '';
      if (usernames.has(username)) fail(`backup.users[${index}].username`, 'اسم دخول مكرر'); usernames.add(username);
    });
    if (!data.users.filter(isRecord).some(user => user.isActive !== false && typeof user.password === 'string' && user.password.trim()
      && isRecord(user.permissions) && canPerformAction(user as User, 'access_control_panel') && !validateAccountSchedule(user.accessSchedule))) fail('backup.users', 'احتفظ بحساب إداري نشط صالح للدخول في النسخة');
  }
  list(data, 'drugCatalog', 'backup', (row, path) => {
    text(row, 'name', path, { required: true, max: 200 }); text(row, 'category', path, { defaultValue: '', max: 100 });
    text(row, 'defaultDosage', path, { defaultValue: '', max: 1000 }); text(row, 'defaultDuration', path, { defaultValue: '', max: 500 });
  });
  if (data.serviceTypes !== undefined) {
    if (!Array.isArray(data.serviceTypes) || !data.serviceTypes.length || data.serviceTypes.length > 300
      || data.serviceTypes.some((name: unknown) => typeof name !== 'string' || !name.trim() || name.length > 200 || /[\u0000-\u001f\u007f]/.test(name))) fail('backup.serviceTypes');
    else if (new Set(data.serviceTypes.map(normalizeServiceName)).size !== data.serviceTypes.length) fail('backup.serviceTypes', 'أسماء خدمات مكررة');
  }
  if (data.crownPrices !== undefined) {
    if (!isRecord(data.crownPrices) || Object.keys(data.crownPrices).length > 1000) fail('backup.crownPrices');
    else Object.keys(data.crownPrices).forEach(key => { if (!key.trim() || key.length > 200) fail('backup.crownPrices'); number(data.crownPrices, key, 'backup.crownPrices', { required: true }); });
  }
  if (data.clinicName !== undefined) text(data, 'clinicName', 'backup', { required: true, max: 100, line: true });
  image(data, 'clinicLogo', 'backup', true);
  if (data.theme !== undefined) {
    if (!isRecord(data.theme)) fail('backup.theme');
    else {
      ['primary', 'secondary', 'accent', 'background'].forEach(key => { const color = normalizeHexColor(data.theme[key]); if (!color) fail(`backup.theme.${key}`); else data.theme[key] = color; });
      if (data.theme.fontFamily !== undefined && (typeof data.theme.fontFamily !== 'string' || data.theme.fontFamily.length > 200 || !/^[A-Za-z0-9 '"_,\-]+$/.test(data.theme.fontFamily))) fail('backup.theme.fontFamily');
      if (data.theme.customFontUrl !== undefined) {
        try { const url = new URL(data.theme.customFontUrl); if (url.origin !== 'https://fonts.googleapis.com' || !['/css', '/css2'].includes(url.pathname) || url.username || url.password || url.href.length > 1000) fail('backup.theme.customFontUrl'); }
        catch { fail('backup.theme.customFontUrl'); }
      }
    }
  }
  if (data.labels !== undefined) {
    if (!isRecord(data.labels)) fail('backup.labels');
    else {
      text(data.labels, 'homeSubtitle', 'backup.labels', { defaultValue: '', max: 1000 }); text(data.labels, 'welcomeText', 'backup.labels', { defaultValue: '', max: 1000 });
      if (!isRecord(data.labels.tiles) || !isRecord(data.labels.tabs)) fail('backup.labels');
      else {
        Object.entries(data.labels.tiles).forEach(([key, tile]) => { if (!isRecord(tile)) fail(`backup.labels.tiles.${key}`); else { text(tile, 'title', `backup.labels.tiles.${key}`, { required: true, max: 200 }); text(tile, 'desc', `backup.labels.tiles.${key}`, { required: true, max: 1000 }); } });
        Object.keys(data.labels.tabs).forEach(key => text(data.labels.tabs, key, 'backup.labels.tabs', { required: true, max: 200 }));
      }
      if (data.labels.navigationLabels !== undefined) {
        if (!isRecord(data.labels.navigationLabels)) fail('backup.labels.navigationLabels');
        else Object.keys(data.labels.navigationLabels).forEach(key => text(data.labels.navigationLabels, key, 'backup.labels.navigationLabels', { required: true, max: 200 }));
      }
      if (!isValidDockAppearance(data.labels.dockAppearance)) fail('backup.labels.dockAppearance');
      if (!errors.length) data.labels = cloneContentDraft({ labels: data.labels }).labels;
    }
  }
  if (data.tileOrder !== undefined) {
    if (!Array.isArray(data.tileOrder) || data.tileOrder.length > 30 || data.tileOrder.some((key: unknown) => typeof key !== 'string' || key.length > 100)) fail('backup.tileOrder');
    else data.tileOrder = cloneContentDraft({ tileOrder: data.tileOrder }).tileOrder;
  }
  if (data.whatsappSettings !== undefined) {
    if (!isRecord(data.whatsappSettings)) fail('backup.whatsappSettings');
    else {
      const settings = data.whatsappSettings;
      ['apiKey', 'webhookUrl', 'senderNumber'].forEach(key => text(settings, key, 'backup.whatsappSettings', { defaultValue: '', max: 2048 }));
      ['autoConfirmOnAppt', 'autoRemind24h', 'autoPostOpOnAttended'].forEach(key => bool(settings, key, 'backup.whatsappSettings', false));
      if (!isRecord(settings.templates)) fail('backup.whatsappSettings.templates');
      else {
        ['reminderTomorrow', 'newAppt', 'postOp', 'accountBalance'].forEach(key => text(settings.templates, key, 'backup.whatsappSettings.templates', { defaultValue: '' }));
        Object.keys(settings.templates).forEach(key => text(settings.templates, key, 'backup.whatsappSettings.templates'));
      }
      if (settings.campaignConsent !== undefined) {
        if (!isRecord(settings.campaignConsent)) fail('backup.whatsappSettings.campaignConsent');
        else Object.keys(settings.campaignConsent).forEach(key => { if (!/^[1-9]\d{7,14}$/.test(key) || !['allowed', 'declined'].includes(settings.campaignConsent[key])) fail('backup.whatsappSettings.campaignConsent'); });
      }
    }
  }

  if (errors.length) return { valid: false, value: null, errors };
  // Verify references against the effective post-restore datasets. Partial legacy
  // backups may omit catalogs, in which case the caller supplies its fresh state.
  const effectivePatients: Patient[] | undefined = data.patients ?? context.patients;
  const effectiveLabs: Lab[] | undefined = data.labs ?? context.labs;
  const effectiveAppointments: Appointment[] = data.appointments ?? context.appointments ?? [];
  const effectiveCases: LabCase[] = data.labCases ?? context.labCases ?? [];
  const patientsById = new Map((Array.isArray(effectivePatients) ? effectivePatients : []).filter(isRecord).map(patient => [patient.id, patient]));
  const patientsByCanonicalId = new Map<string, Patient[]>();
  (Array.isArray(effectivePatients) ? effectivePatients : []).filter(isRecord).forEach(patient => {
    if (typeof patient.id !== 'string') return;
    const key = canonicalFileNumber(patient.id);
    patientsByCanonicalId.set(key, [...(patientsByCanonicalId.get(key) ?? []), patient]);
  });
  const resolvePatient = (id: unknown) => {
    if (typeof id !== 'string' || !id) return undefined;
    const exact = patientsById.get(id);
    if (exact) return exact;
    const matches = patientsByCanonicalId.get(canonicalFileNumber(id));
    return matches?.length === 1 ? matches[0] : undefined;
  };
  const labsById = new Set((Array.isArray(effectiveLabs) ? effectiveLabs : []).filter(isRecord).map(lab => lab.id));
  if (effectivePatients !== undefined) effectiveAppointments.filter(isRecord).forEach((appointment, index) => {
    const reference = appointment.patientId || appointment.fileNo;
    if (reference && !resolvePatient(reference)) fail(`backup.appointments[${index}].${appointment.patientId ? 'patientId' : 'fileNo'}`, 'الموعد مرتبط بملف غير موجود أو رقم ملتبس');
  });
  const linkedSessions = new Set<string>();
  effectiveCases.filter(isRecord).forEach((labCase, index) => {
    const path = `backup.labCases[${index}]`;
    const patient = resolvePatient(labCase.patientId || labCase.fileNo);
    if (effectivePatients !== undefined && !patient) fail(`${path}.patientId`, 'حالة المعمل مرتبطة بملف غير موجود');
    if (effectiveLabs !== undefined && !labsById.has(labCase.labId)) fail(`${path}.labId`, 'حالة المعمل مرتبطة بمعمل غير موجود');
    if (labCase.linkedSessionId) {
      if (patient && !patient.sessions?.some(session => session.id === labCase.linkedSessionId)) fail(`${path}.linkedSessionId`, 'حالة المعمل مرتبطة بجلسة غير موجودة في ملف المريض');
      const reference = labCase.patientId || labCase.fileNo;
      const key = `${patient?.id ?? (typeof reference === 'string' ? canonicalFileNumber(reference) : reference)}|${labCase.linkedSessionId}`;
      if (linkedSessions.has(key)) fail(`${path}.linkedSessionId`, 'جلسة مرتبطة بأكثر من حالة معمل'); linkedSessions.add(key);
    }
  });
  if (errors.length) return { valid: false, value: null, errors };
  const value = Object.fromEntries(knownSections.filter(key => Object.hasOwn(data, key)).map(key => [key, data[key]])) as ValidatedClinicBackup;
  return { valid: true, value, errors: [] };
}

export function assertClinicBackup(input: unknown, context: BackupValidationContext = {}): ValidatedClinicBackup {
  const result = validateClinicBackup(input, context);
  if (!result.valid) throw new Error(`لم تبدأ الاستعادة؛ النسخة غير صالحة. ${result.errors.slice(0, 3).join('؛ ')}`);
  return result.value;
}
