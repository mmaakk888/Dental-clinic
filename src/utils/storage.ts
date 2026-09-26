import {
  Patient, Appointment, Lab, LabCase, ThemeSettings, UILabels, User, Expense, WhatsappSettings, DrugCatalogItem
} from '../types';
import {
  INITIAL_PATIENTS, INITIAL_APPOINTMENTS, INITIAL_LABS, INITIAL_LAB_CASES,
  DEFAULT_THEME, DEFAULT_UI_LABELS, DEFAULT_TILE_ORDER, DEFAULT_USERS,
  DEFAULT_SERVICE_TYPES, DEFAULT_PATIENT_CROWN_PRICES,
  INITIAL_EXPENSES, DEFAULT_WHATSAPP_SETTINGS, DEFAULT_DRUG_CATALOG
} from '../data/initialData';

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

// Timers map for debounced non-blocking background persistence
const writeTimers = new Map<string, number>();

function safeGet<T>(key: string, fallback: T): T {
  if (cacheMap.has(key)) {
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

function safeSet<T>(key: string, value: T, immediate: boolean = false): void {
  // Update in-memory cache instantly so subsequent getters see it without latency
  cacheMap.set(key, value);

  const doWrite = () => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      console.error(`Error writing to localStorage key "${key}":`, err);
    }
  };

  if (immediate) {
    doWrite();
    return;
  }

  // Debounce storage writes to background idle frame to prevent UI micro-stutters/lag
  if (writeTimers.has(key)) {
    clearTimeout(writeTimers.get(key));
  }

  const timerId = window.setTimeout(() => {
    writeTimers.delete(key);
    if ('requestIdleCallback' in window) {
      (window as any).requestIdleCallback(() => doWrite(), { timeout: 1000 });
    } else {
      doWrite();
    }
  }, 150);

  writeTimers.set(key, timerId);
}

export const Storage = {
  getPatients: (): Patient[] => safeGet(KEYS.PATIENTS, INITIAL_PATIENTS),
  savePatients: (patients: Patient[]) => safeSet(KEYS.PATIENTS, patients),

  getAppointments: (): Appointment[] => safeGet(KEYS.APPOINTMENTS, INITIAL_APPOINTMENTS),
  saveAppointments: (appointments: Appointment[]) => safeSet(KEYS.APPOINTMENTS, appointments),

  getLabs: (): Lab[] => safeGet(KEYS.LABS, INITIAL_LABS),
  saveLabs: (labs: Lab[]) => safeSet(KEYS.LABS, labs),

  getLabCases: (): LabCase[] => safeGet(KEYS.LAB_CASES, INITIAL_LAB_CASES),
  saveLabCases: (cases: LabCase[]) => safeSet(KEYS.LAB_CASES, cases),

  getTheme: (): ThemeSettings => safeGet(KEYS.THEME, DEFAULT_THEME),
  saveTheme: (theme: ThemeSettings) => safeSet(KEYS.THEME, theme, true),

  getUILabels: (): UILabels => safeGet(KEYS.UI_LABELS, DEFAULT_UI_LABELS),
  saveUILabels: (labels: UILabels) => safeSet(KEYS.UI_LABELS, labels, true),

  getTileOrder: (): string[] => safeGet(KEYS.TILE_ORDER, DEFAULT_TILE_ORDER),
  saveTileOrder: (order: string[]) => safeSet(KEYS.TILE_ORDER, order, true),

  getUsers: (): User[] => safeGet(KEYS.USERS, DEFAULT_USERS),
  saveUsers: (users: User[]) => safeSet(KEYS.USERS, users, true),

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

  getWhatsappSettings: (): WhatsappSettings => safeGet(KEYS.WHATSAPP_SETTINGS, DEFAULT_WHATSAPP_SETTINGS),
  saveWhatsappSettings: (settings: WhatsappSettings) => safeSet(KEYS.WHATSAPP_SETTINGS, settings),

  getDrugCatalog: (): DrugCatalogItem[] => safeGet(KEYS.DRUG_CATALOG, DEFAULT_DRUG_CATALOG),
  saveDrugCatalog: (catalog: DrugCatalogItem[]) => safeSet(KEYS.DRUG_CATALOG, catalog),

  getPrivacyMode: (): boolean => safeGet(KEYS.PRIVACY_MODE, true),
  savePrivacyMode: (mode: boolean) => safeSet(KEYS.PRIVACY_MODE, mode, true),

  getCurrentUser: (): User | null => sanitizeSessionUser(safeGet<User | null>(KEYS.CURRENT_USER, null)),
  saveCurrentUser: (user: User | null) => safeSet(KEYS.CURRENT_USER, sanitizeSessionUser(user), true),

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
    writeTimers.forEach(timer => clearTimeout(timer));
    writeTimers.clear();
    Object.values(KEYS).forEach(k => localStorage.removeItem(k));
  }
};

