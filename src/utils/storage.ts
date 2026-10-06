import {
  Patient, Appointment, Lab, LabCase, ThemeSettings, UILabels, User, Expense, WhatsappSettings, DrugCatalogItem, MaterialUsage
} from '../types';
import {
  INITIAL_PATIENTS, INITIAL_APPOINTMENTS, INITIAL_LABS, INITIAL_LAB_CASES,
  DEFAULT_THEME, DEFAULT_UI_LABELS, DEFAULT_TILE_ORDER, DEFAULT_USERS,
  DEFAULT_SERVICE_TYPES, DEFAULT_PATIENT_CROWN_PRICES,
  INITIAL_EXPENSES, DEFAULT_WHATSAPP_SETTINGS, DEFAULT_DRUG_CATALOG
} from '../data/initialData';
import { cloneContentDraft, normalizeNavigationOrder } from './clinicContent';
import type { ContentDraft } from './clinicContent';
import { cloneServiceCatalog } from './serviceCatalog';
import type { ServiceCatalogValues } from './serviceCatalog';

const KEYS = {
  PATIENTS: 'dental_patients_v2',
  APPOINTMENTS: 'dental_appointments_v2',
  LABS: 'dental_labs_v2',
  LAB_CASES: 'dental_lab_cases_v2',
  THEME: 'dental_theme_v2',
  UI_LABELS: 'dental_ui_labels_v2',
  TILE_ORDER: 'dental_tile_order_v2',
  USERS: 'dental_users_v2',
  SERVICE_TYPES: 'dental_service_types_v2',
  CROWN_PRICES: 'dental_crown_prices_v2',
  CLINIC_NAME: 'dental_clinic_name_v2',
  CLINIC_LOGO: 'dental_clinic_logo_v2',
  EXPENSES: 'dental_expenses_v2',
  MATERIAL_USAGES: 'dental_material_usages_v1',
  WHATSAPP_SETTINGS: 'dental_whatsapp_settings_v2',
  DRUG_CATALOG: 'dental_drug_catalog_v2',
  PRIVACY_MODE: 'dental_privacy_mode_v2',
  CURRENT_USER: 'dental_current_user_v2',
  REMEMBERED_SESSION: 'dental_remembered_session_v2'
};

export interface RememberedSession {
  userId: string;
  username: string;
  credentialVersion: number;
  issuedAt: string;
}

function getCredentialVersion(user: User): number {
  return user.credentialVersion ?? 1;
}

function sanitizeSessionUser(user: User | null): User | null {
  if (!user) return null;
  const { password: _password, ...safeUser } = user;
  return safeUser;
}

// In-memory cache to eliminate repetitive synchronous JSON parsing on render loops
const cacheMap = new Map<string, any>();

export const STORAGE_FAILURE_EVENT = 'dental-storage-failure';
export const CLINIC_CONTENT_STORAGE_KEYS: readonly string[] = [KEYS.UI_LABELS, KEYS.TILE_ORDER];
export const SERVICE_CATALOG_STORAGE_KEYS: readonly string[] = [KEYS.SERVICE_TYPES, KEYS.CROWN_PRICES];
export const USER_ACCOUNTS_STORAGE_KEY = KEYS.USERS;
export const DRUG_CATALOG_STORAGE_KEY = KEYS.DRUG_CATALOG;
export const LABS_STORAGE_KEY = KEYS.LABS;

export interface ClinicIdentitySettings {
  clinicName: string;
  clinicLogo: string | null;
  theme: ThemeSettings;
}

// Settings changes are explicit saves, not the best-effort domain autosaves below.
// Keep the legacy keys for backups, but publish to the cache only after every
// write succeeds. A failed write restores the previous persisted values.
function saveConfirmedSettings(entries: [string, unknown][], retryHint: string): void {
  const previous = new Map<string, string | null>();
  const attempted: string[] = [];
  try {
    const serialized = entries.map(([key, value]) => [key, JSON.stringify(value)] as const);
    for (const [key] of entries) previous.set(key, localStorage.getItem(key));
    for (const [key, value] of serialized) {
      attempted.push(key);
      localStorage.setItem(key, value);
      if (localStorage.getItem(key) !== value) throw new Error('Settings write was not persisted');
    }
    for (const [key, value] of entries) cacheMap.set(key, value);
  } catch {
    let restored = true;
    for (const key of attempted.reverse()) {
      try {
        const value = previous.get(key);
        if (value == null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
        if (localStorage.getItem(key) !== (value ?? null)) restored = false;
      } catch { restored = false; }
    }
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(STORAGE_FAILURE_EVENT));
    throw new Error(restored
      ? `لم تُحفظ التغييرات. الإعدادات السابقة كما هي؛ ${retryHint}`
      : 'تعذّر حفظ الإعدادات واستعادة بعض الإعدادات السابقة. لا تغلق الصفحة؛ راجع مساحة التخزين وحاول الحفظ مرة أخرى.');
  }
}

function saveClinicIdentity(values: ClinicIdentitySettings): void {
  saveConfirmedSettings([
    [KEYS.CLINIC_LOGO, values.clinicLogo],
    [KEYS.CLINIC_NAME, values.clinicName],
    [KEYS.THEME, { ...values.theme }],
  ], 'جرّب شعارًا أصغر أو تأكد أن المتصفح يسمح بالتخزين.');
}

function saveClinicContent(values: ContentDraft): void {
  const next = cloneContentDraft(values);
  saveConfirmedSettings([
    [KEYS.UI_LABELS, next.labels],
    [KEYS.TILE_ORDER, normalizeNavigationOrder(next.tileOrder)],
  ], 'تأكد أن المتصفح يسمح بالتخزين ثم أعد المحاولة.');
}

function cloneStoredValue<T>(value: T, seen = new WeakMap<object, any>()): T {
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  if (value instanceof Date) return new Date(value.getTime()) as T;
  const copy: any = Array.isArray(value) ? new Array(value.length) : {};
  seen.set(value, copy);
  Object.entries(value).forEach(([key, item]) => Object.defineProperty(copy, key,
    { value: cloneStoredValue(item, seen), writable: true, configurable: true, enumerable: true }));
  return copy;
}

function freshCatalogList<T>(key: string, fallback: T[]): T[] {
  const stored = safeGet(key, fallback, true);
  return cloneStoredValue(Array.isArray(stored) ? stored : fallback);
}

function getServiceCatalog(): ServiceCatalogValues {
  return cloneServiceCatalog({
    serviceTypes: safeGet(KEYS.SERVICE_TYPES, DEFAULT_SERVICE_TYPES, true),
    crownPrices: safeGet(KEYS.CROWN_PRICES, DEFAULT_PATIENT_CROWN_PRICES, true),
  });
}

function saveServiceCatalog(values: ServiceCatalogValues): void {
  const next = cloneServiceCatalog(values);
  saveConfirmedSettings([[KEYS.SERVICE_TYPES, next.serviceTypes], [KEYS.CROWN_PRICES, next.crownPrices]],
    'تأكد أن المتصفح يسمح بالتخزين ثم أعد المحاولة.');
}

export interface RestoredCatalogs {
  users?: User[];
  serviceTypes?: string[];
  crownPrices?: Record<string, number>;
  drugCatalog?: DrugCatalogItem[];
  labs?: Lab[];
}

function saveRestoredCatalogs(values: RestoredCatalogs): void {
  const entries: [string, unknown][] = [];
  if (values.serviceTypes !== undefined || values.crownPrices !== undefined) {
    const previous = getServiceCatalog();
    const next = cloneServiceCatalog({ serviceTypes: values.serviceTypes ?? previous.serviceTypes,
      crownPrices: values.crownPrices ?? previous.crownPrices });
    entries.push([KEYS.SERVICE_TYPES, next.serviceTypes], [KEYS.CROWN_PRICES, next.crownPrices]);
  }
  if (values.labs !== undefined) entries.push([KEYS.LABS, cloneStoredValue(values.labs)]);
  if (values.drugCatalog !== undefined) entries.push([KEYS.DRUG_CATALOG, cloneStoredValue(values.drugCatalog)]);
  if (values.users !== undefined) entries.push([KEYS.USERS, cloneStoredValue(values.users)]);
  if (entries.length) saveConfirmedSettings(entries, 'لم تبدأ استعادة بيانات العيادة؛ راجع مساحة التخزين وحاول مرة أخرى.');
}

function safeGet<T>(key: string, fallback: T, forceFresh = false): T {
  // Account changes made in another tab must be visible to access checks immediately.
  if (!forceFresh && key !== KEYS.USERS && cacheMap.has(key)) {
    return cacheMap.get(key) as T;
  }
  try {
    const item = localStorage.getItem(key);
    const parsed = item ? JSON.parse(item) : fallback;
    cacheMap.set(key, parsed);
    return parsed;
  } catch (err) {
    console.warn(`Error reading localStorage key "${key}":`, err);
    cacheMap.set(key, fallback);
    return fallback;
  }
}

function safeSet<T>(key: string, value: T, _immediate: boolean = false): void {
  cacheMap.set(key, value);
  // Complete the write before returning; idle writes can be lost on tab close.
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.error(`Error writing to localStorage key "${key}":`, err);
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(STORAGE_FAILURE_EVENT));
  }
}

function normalizeOriginalDemoPatients(patients: Patient[]): Patient[] {
  return patients.map(patient => {
    const fixture = INITIAL_PATIENTS.find(original => original.id === patient.id);
    if (!fixture) return patient;
    const stripMarker = (record: Patient) => ({ ...record, payments: (record.payments || []).map(({ legacyAggregate: _marker, ...payment }) => payment) });
    // Only an exact, untouched bundled demo record can be identified safely.
    // Never infer summary payments from real/customized patients or money totals.
    if (JSON.stringify(stripMarker(patient)) !== JSON.stringify(stripMarker(fixture))) return patient;
    return { ...patient, payments: patient.payments.map(payment => ({ ...payment, legacyAggregate: true })) };
  });
}

export const Storage = {
  saveClinicIdentity,
  saveClinicContent,
  getClinicContent: (): ContentDraft => cloneContentDraft({
    labels: safeGet(KEYS.UI_LABELS, DEFAULT_UI_LABELS, true),
    tileOrder: safeGet(KEYS.TILE_ORDER, DEFAULT_TILE_ORDER, true),
  }),
  getServiceCatalog,
  saveServiceCatalog,
  saveRestoredCatalogs,
  getPatients: (): Patient[] => normalizeOriginalDemoPatients(safeGet(KEYS.PATIENTS, INITIAL_PATIENTS)),
  savePatients: (patients: Patient[]) => safeSet(KEYS.PATIENTS, patients),

  getAppointments: (): Appointment[] => safeGet(KEYS.APPOINTMENTS, INITIAL_APPOINTMENTS),
  saveAppointments: (appointments: Appointment[]) => safeSet(KEYS.APPOINTMENTS, appointments),

  getLabs: (): Lab[] => safeGet(KEYS.LABS, INITIAL_LABS),
  getLabsFresh: (): Lab[] => freshCatalogList(KEYS.LABS, INITIAL_LABS),
  saveLabs: (labs: Lab[]) => safeSet(KEYS.LABS, labs),
  saveLabsConfirmed: (labs: Lab[]) => saveConfirmedSettings([[KEYS.LABS, cloneStoredValue(labs)]],
    'راجع مساحة التخزين ثم أعد حفظ بيانات المعامل.'),

  getLabCases: (): LabCase[] => safeGet(KEYS.LAB_CASES, INITIAL_LAB_CASES),
  getLabCasesFresh: (): LabCase[] => freshCatalogList(KEYS.LAB_CASES, INITIAL_LAB_CASES),
  saveLabCases: (cases: LabCase[]) => safeSet(KEYS.LAB_CASES, cases),

  getTheme: (): ThemeSettings => safeGet(KEYS.THEME, DEFAULT_THEME),
  saveTheme: (theme: ThemeSettings) => safeSet(KEYS.THEME, theme, true),

  getUILabels: (): UILabels => safeGet(KEYS.UI_LABELS, DEFAULT_UI_LABELS),
  saveUILabels: (labels: UILabels) => safeSet(KEYS.UI_LABELS, labels, true),

  getTileOrder: (): string[] => safeGet(KEYS.TILE_ORDER, DEFAULT_TILE_ORDER),
  saveTileOrder: (order: string[]) => safeSet(KEYS.TILE_ORDER, order, true),

  getUsers: (): User[] => freshCatalogList(KEYS.USERS, DEFAULT_USERS),
  saveUsers: (users: User[]) => safeSet(KEYS.USERS, users, true),
  saveUsersConfirmed: (users: User[]) => saveConfirmedSettings([[KEYS.USERS, cloneStoredValue(users)]],
    'راجع مساحة التخزين ثم أعد حفظ الحسابات.'),

  getServiceTypes: (): string[] => safeGet(KEYS.SERVICE_TYPES, DEFAULT_SERVICE_TYPES),
  saveServiceTypes: (types: string[]) => safeSet(KEYS.SERVICE_TYPES, types),

  getCrownPrices: (): Record<string, number> => safeGet(KEYS.CROWN_PRICES, DEFAULT_PATIENT_CROWN_PRICES),
  saveCrownPrices: (prices: Record<string, number>) => safeSet(KEYS.CROWN_PRICES, prices),

  getClinicName: (): string => safeGet(KEYS.CLINIC_NAME, 'عيادة د. مريم علي للأسنان'),
  saveClinicName: (name: string) => safeSet(KEYS.CLINIC_NAME, name, true),

  getClinicLogo: (): string | null => safeGet(KEYS.CLINIC_LOGO, null),
  saveClinicLogo: (logo: string | null) => safeSet(KEYS.CLINIC_LOGO, logo, true),

  getExpenses: (): Expense[] => safeGet(KEYS.EXPENSES, INITIAL_EXPENSES),
  saveExpenses: (expenses: Expense[]) => safeSet(KEYS.EXPENSES, expenses),

  getMaterialUsages: (): MaterialUsage[] => safeGet(KEYS.MATERIAL_USAGES, []),
  saveMaterialUsages: (usages: MaterialUsage[]) => safeSet(KEYS.MATERIAL_USAGES, usages),

  getWhatsappSettings: (): WhatsappSettings => safeGet(KEYS.WHATSAPP_SETTINGS, DEFAULT_WHATSAPP_SETTINGS),
  saveWhatsappSettings: (settings: WhatsappSettings) => safeSet(KEYS.WHATSAPP_SETTINGS, settings),

  getDrugCatalog: (): DrugCatalogItem[] => safeGet(KEYS.DRUG_CATALOG, DEFAULT_DRUG_CATALOG),
  getDrugCatalogFresh: (): DrugCatalogItem[] => freshCatalogList(KEYS.DRUG_CATALOG, DEFAULT_DRUG_CATALOG),
  saveDrugCatalog: (catalog: DrugCatalogItem[]) => safeSet(KEYS.DRUG_CATALOG, catalog),
  saveDrugCatalogConfirmed: (catalog: DrugCatalogItem[]) => saveConfirmedSettings([[KEYS.DRUG_CATALOG, cloneStoredValue(catalog)]],
    'راجع مساحة التخزين ثم أعد حفظ فهرس الأدوية.'),

  getPrivacyMode: (): boolean => safeGet(KEYS.PRIVACY_MODE, true),
  savePrivacyMode: (mode: boolean) => safeSet(KEYS.PRIVACY_MODE, mode, true),

  getCurrentUser: (): User | null => {
    try {
      const raw = sessionStorage.getItem(KEYS.CURRENT_USER);
      return raw ? sanitizeSessionUser(JSON.parse(raw)) : null;
    } catch { return null; }
  },
  saveCurrentUser: (user: User | null) => {
    const safeUser = sanitizeSessionUser(user);
    try {
      localStorage.removeItem(KEYS.CURRENT_USER);
      if (safeUser) sessionStorage.setItem(KEYS.CURRENT_USER, JSON.stringify(safeUser));
      else sessionStorage.removeItem(KEYS.CURRENT_USER);
    } catch {
      if (typeof window !== 'undefined') window.dispatchEvent(new Event(STORAGE_FAILURE_EVENT));
    }
  },

  getRememberedSession: (): RememberedSession | null => {
    const remembered = safeGet<RememberedSession | (Partial<RememberedSession> & { password?: string }) | null>(KEYS.REMEMBERED_SESSION, null);
    if (!remembered?.userId || !remembered.username) return null;
    return {
      userId: remembered.userId,
      username: remembered.username,
      credentialVersion: remembered.credentialVersion ?? 1,
      issuedAt: remembered.issuedAt ?? new Date(0).toISOString()
    };
  },
  saveRememberedSession: (session: RememberedSession | null) => {
    cacheMap.set(KEYS.REMEMBERED_SESSION, session);
    if (!session) {
      localStorage.removeItem(KEYS.REMEMBERED_SESSION);
    } else {
      safeSet(KEYS.REMEMBERED_SESSION, session, true);
    }
  },

  createRememberedSession: (user: User): RememberedSession => ({
    userId: user.id,
    username: user.username,
    credentialVersion: getCredentialVersion(user),
    issuedAt: new Date().toISOString()
  }),

  resetAll: () => {
    cacheMap.clear();
    Object.values(KEYS).forEach(k => localStorage.removeItem(k));
    sessionStorage.removeItem(KEYS.CURRENT_USER);
  }
};
