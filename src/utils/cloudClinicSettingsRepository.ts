import { CloudOperationIntentError, readCloudOperationIntentForCommit,
  markCloudOperationIntentCommitted } from './cloudOperationIntent';
import { parseCloudServiceCatalogRecord } from './cloudServiceCatalogRepository';

/** Protected clinic configuration only. No local defaults, credentials, SDK,
 * clock, generated IDs, patient prices or financial aggregates live here.
 * The service catalog remains the only examination/patient-price authority. */
export const CLOUD_CLINIC_SETTINGS_PATH = 'clinics/main/settings/clinicSettings';
export const CLOUD_PROSTHETIC_ROUTING_PATH = 'clinics/main/settings/prostheticRouting';
export const CLOUD_CLINIC_LOGO_PATH = 'clinics/main/settings/clinicLogo';
export const MAX_CLOUD_CLINIC_SETTINGS_BYTES = 96 * 1024;
export const MAX_CLOUD_CLINIC_LOGO_BYTES = 48 * 1024;
export const MAX_CLOUD_PROSTHETIC_ROUTES = 100;
export const MAX_CLOUD_ROUTING_LABS = 6;
const CATALOG = 'clinics/main/settings/serviceCatalog';
const SECTIONS = ['patients', 'contacts', 'appointments', 'lab', 'summary', 'settings'] as const;
const HOME_SECTIONS = ['actions', 'metrics', 'schedule', 'followUp'] as const;
const TABS = ['info', 'chart', 'sessions', 'finance', 'lab'] as const;
export type CloudNavigationSection = typeof SECTIONS[number];
export type CloudSettingsTarget = 'clinicSettings' | 'lab' | 'prostheticRouting' | 'clinicLogo';
export interface CloudClinicIdentity {
  clinicName: string; doctorName: string; phone: string; address: string; logoRecordId: 'clinicLogo' | null;
}
export interface CloudClinicTheme {
  primary: string; secondary: string; accent: string; background: string; fontFamily: string; customFontUrl: string | null;
}
export interface CloudClinicContent {
  homeSubtitle: string; welcomeText: string;
  tiles: Record<CloudNavigationSection, { title: string; desc: string }>;
  tabs: Record<typeof TABS[number], string>;
  navigationLabels: Record<CloudNavigationSection | 'home', string>;
  mobile: { order: CloudNavigationSection[]; size: 'compact' | 'comfortable' | 'large'; showLabels: boolean;
    visibleCount: 3 | 4; moreSections: CloudNavigationSection[] };
  desktop: { order: CloudNavigationSection[]; size: 'compact' | 'comfortable' | 'large'; showLabels: boolean };
  homeLayout: { sectionOrder: typeof HOME_SECTIONS[number][]; hiddenSections: typeof HOME_SECTIONS[number][];
    density: 'compact' | 'comfortable'; appointmentLimit: 3 | 6 | 10 };
}
export interface CloudClinicMedication {
  medicationId: string; name: string; category: string; defaultDosage: string; defaultDuration: string; active: boolean;
}
export type CloudMessageTemplateKey = 'reminderTomorrow' | 'newAppt' | 'postOp' | 'accountBalance'
  | 'greeting' | 'offer' | 'extraction' | 'filling' | 'rootCanal' | 'custom';
export interface CloudClinicMessageTemplate { templateId: string; key: CloudMessageTemplateKey; title: string; text: string }
export interface CloudClinicWhatsApp {
  senderNumber: string; autoConfirmOnAppt: boolean; autoRemind24h: boolean; autoPostOpOnAttended: boolean;
  templates: CloudClinicMessageTemplate[];
}
export interface CloudClinicSettingsData {
  identity: CloudClinicIdentity; theme: CloudClinicTheme; content: CloudClinicContent;
  medications: CloudClinicMedication[]; whatsapp: CloudClinicWhatsApp;
}
export interface CloudLabMaterial {
  materialId: string; name: string; category: 'fixed' | 'removable' | 'other'; unitLabel: string;
  billingBasis: 'per-unit' | 'whole-case'; unitCostCents: number | null; active: boolean;
}
export interface CloudLabDefinitionData {
  name: string; phone: string; address: string; notes: string; active: boolean; costs: CloudLabMaterial[];
}
export interface CloudProstheticRoute { serviceId: string; labId: string; materialId: string }
export interface CloudProstheticRoutingData { routes: CloudProstheticRoute[] }
export interface CloudClinicLogoData { mimeType: 'image/png' | 'image/jpeg'; base64: string; width: number; height: number }
type SettingsData = CloudClinicSettingsData | CloudLabDefinitionData | CloudProstheticRoutingData | CloudClinicLogoData | null;
interface Envelope<T, I extends string = string> {
  schemaVersion: 1; clinicId: 'main'; recordId: I; revision: number; lastOperationId: string; data: T;
}
export type CloudClinicSettingsRecord = Envelope<CloudClinicSettingsData, 'clinicSettings'>;
export type CloudLabDefinitionRecord = Envelope<CloudLabDefinitionData>;
export type CloudProstheticRoutingRecord = Envelope<CloudProstheticRoutingData, 'prostheticRouting'>;
export type CloudClinicLogoRecord = Envelope<CloudClinicLogoData | null, 'clinicLogo'>;
export type CloudSettingsRecord = CloudClinicSettingsRecord | CloudLabDefinitionRecord | CloudProstheticRoutingRecord | CloudClinicLogoRecord;
interface CommandBase { operationId: string; expectedRevision: number; createdAt: string }
export type CloudClinicSettingsCommand = CommandBase & (
  { target: 'clinicSettings'; recordId: 'clinicSettings'; data: CloudClinicSettingsData }
  | { target: 'lab'; recordId: string; data: CloudLabDefinitionData }
  | { target: 'prostheticRouting'; recordId: 'prostheticRouting'; data: CloudProstheticRoutingData }
  | { target: 'clinicLogo'; recordId: 'clinicLogo'; data: CloudClinicLogoData | null });
export interface CloudClinicSettingsCommit {
  status: 'committed' | 'already-committed'; target: CloudSettingsTarget; recordId: string; revision: number;
}
export interface CloudClinicSettingsTransaction { get(path: string): Promise<unknown | null>; set(path: string, value: object): void }
export interface CloudClinicSettingsAdapter {
  authorizeOwner(): Promise<string>;
  runTransaction<T>(work: (transaction: CloudClinicSettingsTransaction) => Promise<T>): Promise<T>;
  readRecord?(path: string): Promise<unknown | null>;
  listLabsPage?(afterId: string | null, limit: number): Promise<unknown>;
}
export interface CloudClinicSettingsOptions { digest?: (text: string) => Promise<string> }
export class CloudClinicSettingsError extends Error {
  constructor(public readonly code: 'invalid' | 'conflict' | 'unavailable') {
    super(({ invalid: 'بيانات إعدادات العيادة أو المعمل غير صالحة.',
      conflict: 'تغيرت الإعدادات أو روابط المعامل؛ راجع أحدث نسخة قبل الحفظ.',
      unavailable: 'تعذر تأكيد إعدادات العيادة من الخادم.' })[code]);
    this.name = 'CloudClinicSettingsError';
  }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_REVISION = 2_000_000_000, MAX_CENTS = 1_000_000_000_000;
const uuid = (value: unknown): value is string => typeof value === 'string' && value.length === 36 && UUID.test(value);
const integer = (value: unknown, min: number, max: number): value is number => typeof value === 'number'
  && Number.isSafeInteger(value) && !Object.is(value, -0) && value >= min && value <= max;
const actor = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128
  && value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value);
function invalid(): never { throw new CloudClinicSettingsError('invalid'); }
function conflict(): never { throw new CloudClinicSettingsError('conflict'); }
function unavailable(): never { throw new CloudClinicSettingsError('unavailable'); }
function safeError(value: unknown): CloudClinicSettingsError {
  try { if ((value instanceof CloudClinicSettingsError || value instanceof CloudOperationIntentError)
    && ['invalid', 'conflict', 'unavailable'].includes(value.code)) return new CloudClinicSettingsError(value.code); }
  catch { /* Hostile provider objects are not error messages. */ }
  return new CloudClinicSettingsError('unavailable');
}
function fields(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || keys.some(key => !own.includes(key))) invalid();
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (!property || !('value' in property) || !property.enumerable) invalid();
    result[key] = property.value;
  }
  return result;
}
function list<T>(value: unknown, max: number, parse: (item: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > max || Reflect.ownKeys(value).length !== value.length + 1) invalid();
  return Array.from({ length: value.length }, (_, index) => {
    const property = Object.getOwnPropertyDescriptor(value, String(index));
    if (!property || !('value' in property) || !property.enumerable) invalid();
    return parse(property.value);
  });
}
function text(value: unknown, max: number, required = false, multiline = false): string {
  if (typeof value !== 'string' || [...value].length > max || value !== value.trim() || required && !value
    || (multiline ? /[\u0000-\u0008\u000b-\u001f\u007f\p{Cf}\p{Cs}]/u : /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u).test(value)) invalid();
  return value;
}
function unique<T>(values: T[], key: (value: T) => unknown = value => value): T[] {
  if (new Set(values.map(key)).size !== values.length) invalid(); return values;
}
function phone(value: unknown) { return value === '' || typeof value === 'string' && value === value.trim()
  && value.length >= 8 && value.length <= 15 && /^[1-9]\d{7,14}$/.test(value) ? value as string : invalid(); }
function nameKey(value: string) {
  return value.normalize('NFKC').replace(/[٠-٩۰-۹]/g, digit => String(digit.charCodeAt(0) - (digit >= '۰' ? 0x06f0 : 0x0660)))
    .replace(/[\u064b-\u065f\u0670\u06d6-\u06edـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/[ىی]/g, 'ي')
    .replace(/\s+/gu, ' ').trim().toLowerCase();
}
function name(value: unknown, max: number) {
  const result = text(value, max, true), key = nameKey(result);
  if (!key || ['__proto__', 'prototype', 'constructor'].includes(key)) invalid(); return result;
}
function timestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.length !== 24 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    || value < '1900-01-01T00:00:00.000Z' || value > '9999-12-31T23:59:59.999Z') return false;
  const parsed = new Date(value); return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}
function boolean(value: unknown): boolean { if (typeof value !== 'boolean') invalid(); return value; }
function choice<T extends string | number>(value: unknown, allowed: readonly T[]): T {
  if (!allowed.includes(value as T)) invalid(); return value as T;
}
function order<T extends string>(value: unknown, allowed: readonly T[], complete: boolean): T[] {
  const result = unique(list(value, allowed.length, item => choice(item, allowed)));
  if (complete && result.length !== allowed.length) invalid(); return result;
}
function mapping<T>(value: unknown, keys: readonly string[], parse: (item: unknown) => T): Record<string, T> {
  const item = fields(value, keys); return Object.fromEntries(keys.map(key => [key, parse(item[key])]));
}
function content(value: unknown): CloudClinicContent {
  const item = fields(value, ['homeSubtitle', 'welcomeText', 'tiles', 'tabs', 'navigationLabels', 'mobile', 'desktop', 'homeLayout']);
  const mobile = fields(item.mobile, ['order', 'size', 'showLabels', 'visibleCount', 'moreSections']);
  const desktop = fields(item.desktop, ['order', 'size', 'showLabels']);
  const home = fields(item.homeLayout, ['sectionOrder', 'hiddenSections', 'density', 'appointmentLimit']);
  return {
    homeSubtitle: text(item.homeSubtitle, 180), welcomeText: text(item.welcomeText, 180),
    tiles: mapping(item.tiles, SECTIONS, value => { const tile = fields(value, ['title', 'desc']);
      return { title: text(tile.title, 80, true), desc: text(tile.desc, 400) }; }) as CloudClinicContent['tiles'],
    tabs: mapping(item.tabs, TABS, value => text(value, 80, true)) as CloudClinicContent['tabs'],
    navigationLabels: mapping(item.navigationLabels, ['home', ...SECTIONS], value => text(value, 80, true)) as CloudClinicContent['navigationLabels'],
    mobile: { order: order(mobile.order, SECTIONS, true), size: choice(mobile.size, ['compact', 'comfortable', 'large']),
      showLabels: boolean(mobile.showLabels), visibleCount: choice(mobile.visibleCount, [3, 4]), moreSections: order(mobile.moreSections, SECTIONS, false) },
    desktop: { order: order(desktop.order, SECTIONS, true), size: choice(desktop.size, ['compact', 'comfortable', 'large']), showLabels: boolean(desktop.showLabels) },
    homeLayout: { sectionOrder: order(home.sectionOrder, HOME_SECTIONS, true), hiddenSections: order(home.hiddenSections, HOME_SECTIONS, false),
      density: choice(home.density, ['compact', 'comfortable']), appointmentLimit: choice(home.appointmentLimit, [3, 6, 10]) },
  };
}
export function parseCloudClinicSettingsData(value: unknown): CloudClinicSettingsData {
  try {
    const item = fields(value, ['identity', 'theme', 'content', 'medications', 'whatsapp']);
    const identity = fields(item.identity, ['clinicName', 'doctorName', 'phone', 'address', 'logoRecordId']);
    const theme = fields(item.theme, ['primary', 'secondary', 'accent', 'background', 'fontFamily', 'customFontUrl']);
    const colors = ['primary', 'secondary', 'accent', 'background'].map(key => {
      if (typeof theme[key] !== 'string' || theme[key].length !== 7 || !/^#[0-9a-f]{6}$/.test(theme[key])) invalid(); return theme[key];
    });
    const fontFamily = text(theme.fontFamily, 200, true);
    if (!/^[A-Za-z0-9 '"_,\-]+$/.test(fontFamily)) invalid();
    let customFontUrl: string | null = null;
    if (theme.customFontUrl !== null) {
      const raw = text(theme.customFontUrl, 1000, true), url = new URL(raw);
      if (url.origin !== 'https://fonts.googleapis.com' || !['/css', '/css2'].includes(url.pathname)
        || url.username || url.password || url.hash || url.href !== raw) invalid(); customFontUrl = raw;
    }
    const medications = unique(list(item.medications, 300, value => {
      const row = fields(value, ['medicationId', 'name', 'category', 'defaultDosage', 'defaultDuration', 'active']);
      if (!uuid(row.medicationId)) invalid();
      return { medicationId: row.medicationId, name: name(row.name, 160), category: text(row.category, 80),
        defaultDosage: text(row.defaultDosage, 500, false, true), defaultDuration: text(row.defaultDuration, 200), active: boolean(row.active) };
    }), row => row.medicationId);
    unique(medications, row => nameKey(row.name));
    const wa = fields(item.whatsapp, ['senderNumber', 'autoConfirmOnAppt', 'autoRemind24h', 'autoPostOpOnAttended', 'templates']);
    const templates = unique(list(wa.templates, 60, value => {
      const row = fields(value, ['templateId', 'key', 'title', 'text']); if (!uuid(row.templateId)) invalid();
      return { templateId: row.templateId, key: choice(row.key, ['reminderTomorrow', 'newAppt', 'postOp', 'accountBalance',
        'greeting', 'offer', 'extraction', 'filling', 'rootCanal', 'custom'] as const), title: text(row.title, 80, true), text: text(row.text, 4000, false, true) };
    }), row => row.templateId);
    unique(templates.filter(row => row.key !== 'custom'), row => row.key);
    const result: CloudClinicSettingsData = {
      identity: { clinicName: name(identity.clinicName, 100), doctorName: text(identity.doctorName, 100), phone: phone(identity.phone),
        address: text(identity.address, 400, false, true), logoRecordId: identity.logoRecordId === null ? null : choice(identity.logoRecordId, ['clinicLogo']) },
      theme: { primary: colors[0], secondary: colors[1], accent: colors[2], background: colors[3], fontFamily, customFontUrl },
      content: content(item.content), medications,
      // These are preferences only. They do not prove/configure a provider or activate automatic messages.
      whatsapp: { senderNumber: phone(wa.senderNumber), autoConfirmOnAppt: boolean(wa.autoConfirmOnAppt), autoRemind24h: boolean(wa.autoRemind24h),
        autoPostOpOnAttended: boolean(wa.autoPostOpOnAttended), templates },
    };
    if (new TextEncoder().encode(JSON.stringify(result)).byteLength > MAX_CLOUD_CLINIC_SETTINGS_BYTES) invalid(); return result;
  } catch { return invalid(); }
}
export function parseCloudLabDefinitionData(value: unknown): CloudLabDefinitionData {
  try {
    const item = fields(value, ['name', 'phone', 'address', 'notes', 'active', 'costs']);
    const costs = unique(list(item.costs, 100, value => {
      const row = fields(value, ['materialId', 'name', 'category', 'unitLabel', 'billingBasis', 'unitCostCents', 'active']);
      if (!uuid(row.materialId) || row.unitCostCents !== null && !integer(row.unitCostCents, 0, MAX_CENTS)) invalid();
      return { materialId: row.materialId, name: name(row.name, 80), category: choice(row.category, ['fixed', 'removable', 'other'] as const),
        unitLabel: text(row.unitLabel, 40, true), billingBasis: choice(row.billingBasis, ['per-unit', 'whole-case'] as const),
        unitCostCents: row.unitCostCents as number | null, active: boolean(row.active) };
    }), row => row.materialId);
    unique(costs, row => nameKey(row.name));
    return { name: name(item.name, 100), phone: phone(item.phone), address: text(item.address, 400, false, true),
      notes: text(item.notes, 2000, false, true), active: boolean(item.active), costs };
  } catch { return invalid(); }
}
export function parseCloudProstheticRoutingData(value: unknown): CloudProstheticRoutingData {
  try {
    const item = fields(value, ['routes']);
    const routes = unique(list(item.routes, MAX_CLOUD_PROSTHETIC_ROUTES, value => {
      const row = fields(value, ['serviceId', 'labId', 'materialId']);
      if (!uuid(row.serviceId) || !uuid(row.labId) || !uuid(row.materialId)) invalid();
      return { serviceId: row.serviceId, labId: row.labId, materialId: row.materialId };
    }), row => row.serviceId);
    if (new Set(routes.map(row => row.labId)).size > MAX_CLOUD_ROUTING_LABS) invalid(); return { routes };
  } catch { return invalid(); }
}
/** Logos are a separately requested protected record, never fetched with reports.
 * <=48KiB binary keeps its complete command below the unchanged128KiB journal.
 * Structural raster checks are not a replacement for browser decode validation. */
export function parseCloudClinicLogoData(value: unknown): CloudClinicLogoData | null {
  try {
    if (value === null) return null;
    const item = fields(value, ['mimeType', 'base64', 'width', 'height']);
    const mimeType = choice(item.mimeType, ['image/png', 'image/jpeg'] as const);
    if (!integer(item.width, 1, 2048) || !integer(item.height, 1, 2048) || item.width * item.height > 4_000_000
      || typeof item.base64 !== 'string' || !item.base64 || item.base64.length > Math.ceil(MAX_CLOUD_CLINIC_LOGO_BYTES / 3) * 4
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(item.base64)) invalid();
    const decoded = atob(item.base64); if (decoded.length > MAX_CLOUD_CLINIC_LOGO_BYTES || btoa(decoded) !== item.base64) invalid();
    const bytes = Uint8Array.from(decoded, char => char.charCodeAt(0));
    const be16 = (at: number) => bytes[at] * 256 + bytes[at + 1];
    const be32 = (at: number) => ((bytes[at] * 0x1000000) + (bytes[at + 1] << 16) + (bytes[at + 2] << 8) + bytes[at + 3]);
    let width = 0, height = 0;
    if (mimeType === 'image/png') {
      if (bytes.length < 57 || bytes.slice(0, 8).some((byte, i) => byte !== [137, 80, 78, 71, 13, 10, 26, 10][i])) invalid();
      let offset = 8, image = false, ended = false;
      while (offset + 12 <= bytes.length) {
        const length = be32(offset), kind = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
        if (length > bytes.length - offset - 12 || kind === 'acTL') invalid();
        if (offset === 8) {
          if (kind !== 'IHDR' || length !== 13) invalid(); width = be32(offset + 8); height = be32(offset + 12);
        } else if (kind === 'IHDR') invalid();
        if (kind === 'IDAT') image = true;
        offset += length + 12;
        if (kind === 'IEND') { if (length !== 0 || offset !== bytes.length) invalid(); ended = true; break; }
      }
      if (!image || !ended) invalid();
    } else {
      if (bytes.length < 16 || bytes[0] !== 255 || bytes[1] !== 216 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) invalid();
      let offset = 2;
      while (offset + 4 <= bytes.length) {
        if (bytes[offset++] !== 255) invalid();
        while (bytes[offset] === 255) offset++;
        const marker = bytes[offset++];
        if (marker === 218 || marker === 217) break;
        const length = be16(offset); if (length < 2 || offset + length > bytes.length) invalid();
        if ([192, 193, 194].includes(marker)) {
          if (length < 8) invalid(); height = be16(offset + 3); width = be16(offset + 5);
        }
        offset += length;
      }
    }
    if (width !== item.width || height !== item.height) invalid();
    return { mimeType, base64: item.base64, width, height };
  } catch { return invalid(); }
}
export function cloudLabDefinitionPath(recordId: string): string {
  if (!uuid(recordId)) invalid(); return `clinics/main/labDefinitions/${recordId}`;
}
export function cloudClinicSettingsPath(target: CloudSettingsTarget, recordId: string): string {
  if (target === 'lab') return cloudLabDefinitionPath(recordId);
  if (target !== recordId || !['clinicSettings', 'prostheticRouting', 'clinicLogo'].includes(target)) invalid();
  return `clinics/main/settings/${recordId}`;
}
function data(target: CloudSettingsTarget, value: unknown): SettingsData {
  if (target === 'clinicSettings') return parseCloudClinicSettingsData(value);
  if (target === 'lab') return parseCloudLabDefinitionData(value);
  if (target === 'prostheticRouting') return parseCloudProstheticRoutingData(value);
  if (target === 'clinicLogo') return parseCloudClinicLogoData(value); return invalid();
}
function record(target: CloudSettingsTarget, value: unknown, expectedId?: string): CloudSettingsRecord {
  try {
    const item = fields(value, ['schemaVersion', 'clinicId', 'recordId', 'revision', 'lastOperationId', 'data']);
    if (item.schemaVersion !== 1 || item.clinicId !== 'main' || typeof item.recordId !== 'string'
      || expectedId !== undefined && item.recordId !== expectedId || !integer(item.revision, 1, MAX_REVISION)
      || !uuid(item.lastOperationId)) invalid();
    cloudClinicSettingsPath(target, item.recordId);
    return { schemaVersion: 1, clinicId: 'main', recordId: item.recordId, revision: item.revision,
      lastOperationId: item.lastOperationId, data: data(target, item.data) } as CloudSettingsRecord;
  } catch { return invalid(); }
}
export const parseCloudClinicSettingsRecord = (value: unknown) => record('clinicSettings', value) as CloudClinicSettingsRecord;
export const parseCloudLabDefinition = (value: unknown, recordId?: string) => record('lab', value, recordId) as CloudLabDefinitionRecord;
export const parseCloudProstheticRouting = (value: unknown) => record('prostheticRouting', value) as CloudProstheticRoutingRecord;
export const parseCloudClinicLogoRecord = (value: unknown) => record('clinicLogo', value) as CloudClinicLogoRecord;
export function prepareCloudClinicSettingsCommand(value: unknown): CloudClinicSettingsCommand {
  try {
    const item = fields(value, ['target', 'recordId', 'operationId', 'expectedRevision', 'createdAt', 'data']);
    const target = choice(item.target, ['clinicSettings', 'lab', 'prostheticRouting', 'clinicLogo'] as const);
    if (typeof item.recordId !== 'string' || !uuid(item.operationId) || !integer(item.expectedRevision, 0, MAX_REVISION - 1)
      || !timestamp(item.createdAt)) invalid();
    cloudClinicSettingsPath(target, item.recordId);
    const result = { target, recordId: item.recordId, operationId: item.operationId, expectedRevision: item.expectedRevision,
      createdAt: item.createdAt, data: data(target, item.data) } as CloudClinicSettingsCommand;
    if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 120 * 1024) invalid(); return result;
  } catch { return invalid(); }
}
export function prepareCloudLabPageInput(value: unknown = {}): { afterId: string | null; limit: number } {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
    const keys = Reflect.ownKeys(value);
    if (keys.some(key => key !== 'afterId' && key !== 'limit')) invalid();
    const input = fields(value, keys as string[]);
    const afterId = input.afterId === undefined || input.afterId === null ? null : input.afterId;
    const limit = input.limit === undefined ? 25 : input.limit;
    if (afterId !== null && !uuid(afterId) || !integer(limit, 1, 50)) invalid(); return { afterId: afterId as string | null, limit };
  } catch { return invalid(); }
}
async function sha256(value: string) {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, '0')).join('');
}
export function createCloudClinicSettingsRepository(adapter: CloudClinicSettingsAdapter, options: CloudClinicSettingsOptions = {}) {
  const digest = options.digest ?? sha256;
  const authorize = async () => { const uid = await adapter.authorizeOwner(); if (!actor(uid)) invalid(); return uid; };
  const reauthorize = async (uid: string) => { if (await authorize() !== uid) unavailable(); };
  const read = async <T extends CloudSettingsRecord>(target: CloudSettingsTarget, recordId: string): Promise<T | null> => {
    try {
      const path = cloudClinicSettingsPath(target, recordId), uid = await authorize(); if (!adapter.readRecord) unavailable();
      const raw = await adapter.readRecord(path); await reauthorize(uid);
      const result = raw === null ? null : record(target, raw, recordId); await reauthorize(uid); return result as T | null;
    } catch (error) { throw safeError(error); }
  };
  return {
    get: () => read<CloudClinicSettingsRecord>('clinicSettings', 'clinicSettings'),
    getLab: (id: string) => read<CloudLabDefinitionRecord>('lab', id),
    getRouting: () => read<CloudProstheticRoutingRecord>('prostheticRouting', 'prostheticRouting'),
    getLogo: () => read<CloudClinicLogoRecord>('clinicLogo', 'clinicLogo'),
    async listLabsPage(input: unknown = {}): Promise<{ records: CloudLabDefinitionRecord[]; nextAfterId: string | null }> {
      try {
        const query = prepareCloudLabPageInput(input), uid = await authorize(); if (!adapter.listLabsPage) unavailable();
        const raw = await adapter.listLabsPage(query.afterId, query.limit); await reauthorize(uid);
        const rows = list(raw, query.limit, value => {
          const row = fields(value, ['id', 'data']); if (!uuid(row.id)) invalid(); return parseCloudLabDefinition(row.data, row.id);
        });
        let previous = query.afterId;
        for (const row of rows) { if (previous !== null && row.recordId <= previous) invalid(); previous = row.recordId; }
        await reauthorize(uid); return { records: rows, nextAfterId: rows.length === query.limit ? previous : null };
      } catch (error) { throw safeError(error); }
    },
    async commit(input: unknown): Promise<CloudClinicSettingsCommit> {
      try {
        const command = prepareCloudClinicSettingsCommand(input), uid = await authorize();
        const path = cloudClinicSettingsPath(command.target, command.recordId);
        const requestHash = await digest(JSON.stringify(['clinic-settings-v1', uid, command]));
        if (typeof requestHash !== 'string' || !/^[0-9a-f]{64}$/.test(requestHash) || requestHash.length !== 64) invalid();
        const receiptPath = `clinics/main/settingsOperations/${command.operationId}`;
        const receipt = { schemaVersion: 1, clinicId: 'main', operationId: command.operationId, target: command.target, recordId: command.recordId,
          actorUid: uid, expectedRevision: command.expectedRevision, resultRevision: command.expectedRevision + 1, createdAt: command.createdAt, requestHash };
        await reauthorize(uid);
        const result = await adapter.runTransaction<CloudClinicSettingsCommit>(async transaction => {
          await reauthorize(uid);
          const oldReceipt = await transaction.get(receiptPath);
          const intent = await readCloudOperationIntentForCommit(transaction, { actorUid: uid, kind: 'settings', command }, { digest });
          if (intent.createdAt !== command.createdAt || intent.status !== (oldReceipt === null ? 'prepared' : 'committed')) conflict();
          if (oldReceipt !== null) {
            const old = fields(oldReceipt, Object.keys(receipt));
            if (Object.keys(receipt).some(key => old[key] !== receipt[key as keyof typeof receipt])) conflict();
            await reauthorize(uid);
            // Original receipt is historical evidence, never today's settings/lab or permission to restore it.
            return { status: 'already-committed', target: command.target, recordId: command.recordId, revision: receipt.resultRevision };
          }
          const raw = await transaction.get(path), current = raw === null ? null : record(command.target, raw, command.recordId);
          if ((current?.revision ?? 0) !== command.expectedRevision) conflict();
          if (command.target === 'prostheticRouting' && command.data.routes.length) {
            const catalogRaw = await transaction.get(CATALOG); if (catalogRaw === null) invalid();
            const catalog = parseCloudServiceCatalogRecord(catalogRaw);
            const labs = new Map<string, CloudLabDefinitionRecord>();
            for (const id of new Set(command.data.routes.map(route => route.labId))) {
              const labRaw = await transaction.get(cloudLabDefinitionPath(id)); if (labRaw === null) invalid();
              labs.set(id, parseCloudLabDefinition(labRaw, id));
            }
            for (const route of command.data.routes) {
              const service = catalog.data.services.find(service => service.serviceId === route.serviceId);
              const lab = labs.get(route.labId)!, material = lab.data.costs.find(cost => cost.materialId === route.materialId);
              if (!service || !service.active || service.kind !== 'prosthetic' || !lab.data.active || !material || !material.active) invalid();
            }
          }
          if (command.target === 'lab') {
            const routingRaw = await transaction.get(CLOUD_PROSTHETIC_ROUTING_PATH);
            // Bootstrap must explicitly create empty routing; absence is unknown, not an inferred empty list.
            if (routingRaw === null) invalid();
            const routing = parseCloudProstheticRouting(routingRaw);
            for (const route of routing.data.routes.filter(route => route.labId === command.recordId)) {
              const material = command.data.costs.find(cost => cost.materialId === route.materialId);
              if (!command.data.active || !material || !material.active) conflict();
            }
          }
          if (command.target === 'clinicSettings' && command.data.identity.logoRecordId !== null) {
            const logoRaw = await transaction.get(CLOUD_CLINIC_LOGO_PATH);
            if (logoRaw === null || parseCloudClinicLogoRecord(logoRaw).data === null) invalid();
          }
          if (command.target === 'clinicLogo' && command.data === null) {
            const settingsRaw = await transaction.get(CLOUD_CLINIC_SETTINGS_PATH);
            if (settingsRaw !== null && parseCloudClinicSettingsRecord(settingsRaw).data.identity.logoRecordId !== null) conflict();
          }
          const next = record(command.target, { schemaVersion: 1, clinicId: 'main', recordId: command.recordId,
            revision: receipt.resultRevision, lastOperationId: command.operationId, data: command.data }, command.recordId);
          await reauthorize(uid); // Every transaction read occurs before any write.
          transaction.set(path, next); transaction.set(receiptPath, receipt); markCloudOperationIntentCommitted(transaction, intent);
          return { status: 'committed', target: command.target, recordId: command.recordId, revision: next.revision };
        });
        await reauthorize(uid);
        const checked = fields(result, ['status', 'target', 'recordId', 'revision']);
        if (!['committed', 'already-committed'].includes(checked.status as string) || checked.target !== command.target
          || checked.recordId !== command.recordId || checked.revision !== command.expectedRevision + 1) invalid();
        return { status: checked.status as CloudClinicSettingsCommit['status'], target: command.target,
          recordId: command.recordId, revision: checked.revision as number };
      } catch (error) { throw safeError(error); }
    },
  };
}
export type CloudClinicSettingsRepository = ReturnType<typeof createCloudClinicSettingsRepository>;
