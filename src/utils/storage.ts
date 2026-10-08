import {
  Patient, Appointment, Lab, LabCase, ThemeSettings, UILabels, User, Expense, WhatsappSettings, DrugCatalogItem, MaterialUsage, ClinicContact
} from '../types';
import {
  INITIAL_PATIENTS,
  DEFAULT_THEME, DEFAULT_UI_LABELS, DEFAULT_TILE_ORDER, DEFAULT_USERS,
  DEFAULT_SERVICE_TYPES, DEFAULT_PATIENT_CROWN_PRICES,
  DEFAULT_WHATSAPP_SETTINGS, DEFAULT_DRUG_CATALOG
} from '../data/initialData';
import { cloneContentDraft, normalizeNavigationOrder } from './clinicContent';
import type { ContentDraft } from './clinicContent';
import { cloneServiceCatalog } from './serviceCatalog';
import type { ServiceCatalogValues } from './serviceCatalog';
import { isSessionFresh, SESSION_MAX_AGE_MS, REMEMBERED_SESSION_MAX_AGE_MS } from './accessControl';

const KEYS = {
  PATIENTS: 'dental_patients_v2',
  CONTACTS: 'dental_contacts',
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
  expiresAt: string;
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
export const WHATSAPP_SETTINGS_STORAGE_KEY = KEYS.WHATSAPP_SETTINGS;
export const PRIVACY_MODE_STORAGE_KEY = KEYS.PRIVACY_MODE;
export const CLINIC_DOMAIN_STORAGE_KEYS = [KEYS.PATIENTS, KEYS.APPOINTMENTS, KEYS.LAB_CASES, KEYS.EXPENSES, KEYS.MATERIAL_USAGES, KEYS.CONTACTS] as const;

export interface ClinicDomainData {
  patients: Patient[];
  contacts: ClinicContact[];
  appointments: Appointment[];
  labCases: LabCase[];
  expenses: Expense[];
  materialUsages: MaterialUsage[];
}

export interface ClinicIdentitySettings {
  clinicName: string;
  clinicLogo: string | null;
  theme: ThemeSettings;
}

// Changes are explicit confirmed saves. Keep the legacy keys for backups,
// but publish to the cache only after every
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
  // Never publish an unpersisted value or report success after a quota failure.
  saveConfirmedSettings([[key, cloneStoredValue(value)]], 'راجع مساحة التخزين ثم أعد الحفظ.');
}

function readDomainArray<T>(key: string, fallback: T[]): T[] {
  try {
    const raw = localStorage.getItem(key);
    const value = raw === null ? fallback : JSON.parse(raw);
    if (!Array.isArray(value)) throw new Error('invalid-domain-data');
    cacheMap.set(key, value);
    return cloneStoredValue(value);
  } catch {
    throw new Error('تعذّر قراءة بيانات العيادة المحفوظة. لم يتم استبدالها؛ احتفظ بنسخة احتياطية وراجع البيانات قبل الحفظ.');
  }
}

function getDomainData(): ClinicDomainData {
  return {
    patients: normalizeOriginalDemoPatients(readDomainArray<Patient>(KEYS.PATIENTS, [])),
    contacts: readDomainArray(KEYS.CONTACTS, []),
    appointments: readDomainArray<Appointment>(KEYS.APPOINTMENTS, []),
    labCases: readDomainArray<LabCase>(KEYS.LAB_CASES, []),
    expenses: readDomainArray<Expense>(KEYS.EXPENSES, []),
    materialUsages: readDomainArray(KEYS.MATERIAL_USAGES, []),
  };
}

// Explicitly empty the seven operational lists, not the saved account/config
// keys. Persist [] instead of deleting keys so no fallback can revive records.
// Call under the clinic lock after fresh full-backup authorization.
function clearOperationalDataConfirmed(): void {
  saveConfirmedSettings([
    [KEYS.PATIENTS, [] as Patient[]], [KEYS.CONTACTS, [] as ClinicContact[]],
    [KEYS.APPOINTMENTS, [] as Appointment[]], [KEYS.LABS, [] as Lab[]],
    [KEYS.LAB_CASES, [] as LabCase[]], [KEYS.EXPENSES, [] as Expense[]],
    [KEYS.MATERIAL_USAGES, [] as MaterialUsage[]],
  ], 'لم تكتمل بداية العيادة الفارغة؛ راجع مساحة التخزين ثم أعد المحاولة.');
}

function saveDomainDataConfirmed(next: ClinicDomainData, previous: ClinicDomainData): void {
  const pairs: [keyof ClinicDomainData, string][] = [
    ['patients', KEYS.PATIENTS], ['appointments', KEYS.APPOINTMENTS], ['labCases', KEYS.LAB_CASES],
    ['expenses', KEYS.EXPENSES], ['materialUsages', KEYS.MATERIAL_USAGES],
    ['contacts', KEYS.CONTACTS],
  ];
  const entries = pairs.filter(([field]) => JSON.stringify(next[field]) !== JSON.stringify(previous[field]))
    .map(([field, key]) => [key, cloneStoredValue(next[field])] as [string, unknown]);
  if (entries.length) saveConfirmedSettings(entries, 'لم تكتمل العملية؛ راجع مساحة التخزين ثم أعد المحاولة.');
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
  getDomainData,
  clearOperationalDataConfirmed,
  // Call under the clinic lock: export persisted values, never a stale React/cache
  // snapshot. A malformed saved section must not silently become demo/default data.
  getBackupDataFresh: (): Record<string, unknown> => {
    const sections: [string, string, unknown][] = [
      ['patients', KEYS.PATIENTS, [] as Patient[]], ['contacts', KEYS.CONTACTS, [] as ClinicContact[]],
      ['appointments', KEYS.APPOINTMENTS, [] as Appointment[]], ['labs', KEYS.LABS, [] as Lab[]],
      ['labCases', KEYS.LAB_CASES, [] as LabCase[]], ['expenses', KEYS.EXPENSES, [] as Expense[]],
      ['materialUsages', KEYS.MATERIAL_USAGES, []], ['users', KEYS.USERS, DEFAULT_USERS],
      ['serviceTypes', KEYS.SERVICE_TYPES, DEFAULT_SERVICE_TYPES], ['crownPrices', KEYS.CROWN_PRICES, DEFAULT_PATIENT_CROWN_PRICES],
      ['drugCatalog', KEYS.DRUG_CATALOG, DEFAULT_DRUG_CATALOG], ['whatsappSettings', KEYS.WHATSAPP_SETTINGS, DEFAULT_WHATSAPP_SETTINGS],
      ['clinicName', KEYS.CLINIC_NAME, 'عيادة د. مريم علي للأسنان'], ['clinicLogo', KEYS.CLINIC_LOGO, null],
      ['theme', KEYS.THEME, DEFAULT_THEME], ['labels', KEYS.UI_LABELS, DEFAULT_UI_LABELS], ['tileOrder', KEYS.TILE_ORDER, DEFAULT_TILE_ORDER],
    ];
    try {
      return Object.fromEntries(sections.map(([section, key, fallback]) => {
        const raw = localStorage.getItem(key);
        const value = raw === null ? cloneStoredValue(fallback) : JSON.parse(raw);
        return [section, section === 'patients' && Array.isArray(value) ? normalizeOriginalDemoPatients(value) : value];
      }));
    } catch {
      throw new Error('تعذّر قراءة إحدى بيانات العيادة المحفوظة؛ لم يتم تنزيل نسخة ناقصة أو استبدال البيانات.');
    }
  },
  saveDomainDataConfirmed,
  saveBackupConfirmed: (data: Record<string, unknown>) => {
    const fields: [string, string][] = [
      ['patients', KEYS.PATIENTS], ['appointments', KEYS.APPOINTMENTS], ['labs', KEYS.LABS], ['labCases', KEYS.LAB_CASES],
      ['contacts', KEYS.CONTACTS],
      ['expenses', KEYS.EXPENSES], ['materialUsages', KEYS.MATERIAL_USAGES], ['users', KEYS.USERS],
      ['serviceTypes', KEYS.SERVICE_TYPES], ['crownPrices', KEYS.CROWN_PRICES], ['drugCatalog', KEYS.DRUG_CATALOG],
      ['whatsappSettings', KEYS.WHATSAPP_SETTINGS], ['clinicName', KEYS.CLINIC_NAME], ['clinicLogo', KEYS.CLINIC_LOGO],
      ['theme', KEYS.THEME], ['labels', KEYS.UI_LABELS], ['tileOrder', KEYS.TILE_ORDER],
    ];
    const entries = fields.filter(([field]) => Object.prototype.hasOwnProperty.call(data, field))
      .map(([field, key]) => [key, cloneStoredValue(data[field])] as [string, unknown]);
    saveConfirmedSettings(entries, 'لم تكتمل الاستعادة؛ البيانات السابقة محفوظة. راجع مساحة التخزين ثم أعد المحاولة.');
  },
  saveClinicIdentity,
  saveClinicContent,
  getClinicContent: (): ContentDraft => cloneContentDraft({
    labels: safeGet(KEYS.UI_LABELS, DEFAULT_UI_LABELS, true),
    tileOrder: safeGet(KEYS.TILE_ORDER, DEFAULT_TILE_ORDER, true),
  }),
  getServiceCatalog,
  saveServiceCatalog,
  saveRestoredCatalogs,
  getPatients: (): Patient[] => normalizeOriginalDemoPatients(safeGet<Patient[]>(KEYS.PATIENTS, [])),
  savePatients: (patients: Patient[]) => safeSet(KEYS.PATIENTS, patients),

  getContacts: (): ClinicContact[] => readDomainArray(KEYS.CONTACTS, []),
  getContactsFresh: (): ClinicContact[] => readDomainArray(KEYS.CONTACTS, []),

  getAppointments: (): Appointment[] => safeGet<Appointment[]>(KEYS.APPOINTMENTS, []),
  saveAppointments: (appointments: Appointment[]) => safeSet(KEYS.APPOINTMENTS, appointments),

  getLabs: (): Lab[] => safeGet<Lab[]>(KEYS.LABS, []),
  getLabsFresh: (): Lab[] => freshCatalogList<Lab>(KEYS.LABS, []),
  saveLabs: (labs: Lab[]) => safeSet(KEYS.LABS, labs),
  saveLabsConfirmed: (labs: Lab[]) => saveConfirmedSettings([[KEYS.LABS, cloneStoredValue(labs)]],
    'راجع مساحة التخزين ثم أعد حفظ بيانات المعامل.'),

  getLabCases: (): LabCase[] => safeGet<LabCase[]>(KEYS.LAB_CASES, []),
  getLabCasesFresh: (): LabCase[] => freshCatalogList<LabCase>(KEYS.LAB_CASES, []),
  saveLabCases: (cases: LabCase[]) => safeSet(KEYS.LAB_CASES, cases),

  getTheme: (): ThemeSettings => safeGet(KEYS.THEME, DEFAULT_THEME),
  saveTheme: (theme: ThemeSettings) => safeSet(KEYS.THEME, theme, true),

  getUILabels: (): UILabels => safeGet(KEYS.UI_LABELS, DEFAULT_UI_LABELS),
  saveUILabels: (labels: UILabels) => safeSet(KEYS.UI_LABELS, labels, true),

  getTileOrder: (): string[] => safeGet(KEYS.TILE_ORDER, DEFAULT_TILE_ORDER),
  saveTileOrder: (order: string[]) => safeSet(KEYS.TILE_ORDER, order, true),

  getUsers: (): User[] => {
    // A corrupt stored account list must never resurrect privileged demo users.
    const raw = localStorage.getItem(KEYS.USERS);
    if (raw === null) return cloneStoredValue(DEFAULT_USERS);
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) && parsed.every(user => user && typeof user.id === 'string' && typeof user.username === 'string' && user.permissions && typeof user.permissions === 'object')
        ? cloneStoredValue(parsed) : [];
    } catch { return []; }
  },
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

  getExpenses: (): Expense[] => safeGet<Expense[]>(KEYS.EXPENSES, []),
  saveExpenses: (expenses: Expense[]) => safeSet(KEYS.EXPENSES, expenses),

  getMaterialUsages: (): MaterialUsage[] => safeGet(KEYS.MATERIAL_USAGES, []),
  saveMaterialUsages: (usages: MaterialUsage[]) => safeSet(KEYS.MATERIAL_USAGES, usages),

  getWhatsappSettings: (): WhatsappSettings => safeGet(KEYS.WHATSAPP_SETTINGS, DEFAULT_WHATSAPP_SETTINGS),
  getWhatsappSettingsFresh: (): WhatsappSettings => cloneStoredValue(safeGet(KEYS.WHATSAPP_SETTINGS, DEFAULT_WHATSAPP_SETTINGS, true)),
  saveWhatsappSettings: (settings: WhatsappSettings) => safeSet(KEYS.WHATSAPP_SETTINGS, settings),

  getDrugCatalog: (): DrugCatalogItem[] => safeGet(KEYS.DRUG_CATALOG, DEFAULT_DRUG_CATALOG),
  getDrugCatalogFresh: (): DrugCatalogItem[] => freshCatalogList(KEYS.DRUG_CATALOG, DEFAULT_DRUG_CATALOG),
  saveDrugCatalog: (catalog: DrugCatalogItem[]) => safeSet(KEYS.DRUG_CATALOG, catalog),
  saveDrugCatalogConfirmed: (catalog: DrugCatalogItem[]) => saveConfirmedSettings([[KEYS.DRUG_CATALOG, cloneStoredValue(catalog)]],
    'راجع مساحة التخزين ثم أعد حفظ فهرس الأدوية.'),

  getPrivacyMode: (): boolean => safeGet(KEYS.PRIVACY_MODE, true),
  getPrivacyModeFresh: (): boolean => safeGet<boolean>(KEYS.PRIVACY_MODE, true, true) !== false,
  savePrivacyMode: (mode: boolean) => safeSet(KEYS.PRIVACY_MODE, mode, true),

  getCurrentUser: (): User | null => {
    try {
      const raw = sessionStorage.getItem(KEYS.CURRENT_USER);
      if (!raw) return null;
      const stored = JSON.parse(raw);
      return isSessionFresh(stored, Date.now(), SESSION_MAX_AGE_MS) ? sanitizeSessionUser(stored) : null;
    } catch { return null; }
  },
  saveCurrentUser: (user: User | null) => {
    const safeUser = sanitizeSessionUser(user);
    try {
      localStorage.removeItem(KEYS.CURRENT_USER);
      if (safeUser) {
        const existing = sessionStorage.getItem(KEYS.CURRENT_USER);
        const previous = existing ? JSON.parse(existing) : null;
        const retainExpiry = previous?.id === safeUser.id && previous?.credentialVersion === safeUser.credentialVersion && isSessionFresh(previous, Date.now(), SESSION_MAX_AGE_MS);
        const now = Date.now();
        const encoded = JSON.stringify({ ...safeUser,
          issuedAt: retainExpiry ? previous.issuedAt : new Date(now).toISOString(),
          expiresAt: retainExpiry ? previous.expiresAt : new Date(now + SESSION_MAX_AGE_MS).toISOString(),
        });
        sessionStorage.setItem(KEYS.CURRENT_USER, encoded);
        if (sessionStorage.getItem(KEYS.CURRENT_USER) !== encoded) throw new Error('session-write-failed');
      }
      else sessionStorage.removeItem(KEYS.CURRENT_USER);
    } catch {
      if (typeof window !== 'undefined') window.dispatchEvent(new Event(STORAGE_FAILURE_EVENT));
      throw new Error('تعذّر حفظ جلسة الدخول. تأكد أن المتصفح يسمح بالتخزين ثم أعد المحاولة.');
    }
  },

  getRememberedSession: (): RememberedSession | null => {
    const remembered = safeGet<RememberedSession | (Partial<RememberedSession> & { password?: string }) | null>(KEYS.REMEMBERED_SESSION, null);
    if (!remembered?.userId || !remembered.username || !isSessionFresh(remembered, Date.now(), REMEMBERED_SESSION_MAX_AGE_MS)) return null;
    return {
      userId: remembered.userId,
      username: remembered.username,
      credentialVersion: remembered.credentialVersion ?? 1,
      issuedAt: remembered.issuedAt,
      expiresAt: remembered.expiresAt!,
    };
  },
  saveRememberedSession: (session: RememberedSession | null) => {
    if (!session) {
      localStorage.removeItem(KEYS.REMEMBERED_SESSION);
      if (localStorage.getItem(KEYS.REMEMBERED_SESSION) !== null) throw new Error('تعذّر إلغاء تذكر الدخول.');
      cacheMap.set(KEYS.REMEMBERED_SESSION, null);
    } else {
      safeSet(KEYS.REMEMBERED_SESSION, session, true);
    }
  },

  createRememberedSession: (user: User): RememberedSession => {
    const now = Date.now();
    return {
    userId: user.id,
    username: user.username,
    credentialVersion: getCredentialVersion(user),
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + REMEMBERED_SESSION_MAX_AGE_MS).toISOString(),
  }; },

  resetAll: () => {
    const previous = new Map<string, string | null>();
    const attempted: string[] = [];
    let previousSession: string | null = null;
    try {
      previousSession = sessionStorage.getItem(KEYS.CURRENT_USER);
      Object.values(KEYS).forEach(key => previous.set(key, localStorage.getItem(key)));
      Object.values(KEYS).forEach(key => {
        attempted.push(key);
        localStorage.removeItem(key);
        if (localStorage.getItem(key) !== null) throw new Error('reset-write-failed');
      });
      sessionStorage.removeItem(KEYS.CURRENT_USER);
      if (sessionStorage.getItem(KEYS.CURRENT_USER) !== null) throw new Error('reset-session-failed');
      cacheMap.clear();
    } catch {
      let restored = true;
      for (const key of attempted.reverse()) {
        try {
          const value = previous.get(key) ?? null;
          if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value);
          if (localStorage.getItem(key) !== value) restored = false;
        } catch { restored = false; }
      }
      try { if (previousSession !== null) sessionStorage.setItem(KEYS.CURRENT_USER, previousSession); }
      catch { restored = false; }
      if (typeof window !== 'undefined') window.dispatchEvent(new Event(STORAGE_FAILURE_EVENT));
      throw new Error(restored ? 'لم تتم إعادة الضبط؛ البيانات السابقة كما هي.' : 'تعذّرت إعادة الضبط واستعادة بعض البيانات. لا تغلق الصفحة وراجع التخزين.');
    }
  }
};
