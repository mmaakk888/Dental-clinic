import type { Patient, DrugCatalogItem } from '../types';
import { loadCloudClinicalPatient } from './cloudClinicalPatientProjection';
import { parseCloudPatientRecord, type CloudPatientRecord } from './cloudPatientRepository';
import { parseCloudClinicSettingsRecord, parseCloudClinicLogoRecord,
  type CloudClinicSettingsRecord, type CloudClinicLogoRecord } from './cloudClinicSettingsRepository';
import type { CloudClinicalCapability } from './cloudClinicalWorkspaceController';
import type { FirebaseCloudClinicSettingsCapability } from './firebaseCloudClinicSettings';

export interface CloudPrescriptionDocumentContext {
  patientRecordId: string; patient: Patient; clinicName: string; clinicLogo: string | null;
  header: { doctorName: string; phone: string; address: string }; medications: DrugCatalogItem[];
}
export interface CloudPrescriptionWorkspaceState {
  document: CloudPrescriptionDocumentContext | null; loading: boolean; outputPending: boolean; error: string; closed: boolean;
}
function fail(): never { throw new Error('تعذر تأكيد بيانات الروشتة أو صلاحية إخراجها.'); }
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value;
}
const uuid = (value: unknown): value is string => typeof value === 'string' && value.length === 36
  && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);

/** Existing memory-only Rx editor, not a new prescription archive. Protected
 * settings/patient identity replace local defaults. The shared A5 document is
 * still the sole print and PNG source. All data/output actions are explicit. */
export function createCloudPrescriptionWorkspaceController(options: {
  isActive(): boolean; getClinical(): Promise<CloudClinicalCapability>;
  getSettings(): Promise<FirebaseCloudClinicSettingsCapability>;
}) {
  const empty = (closed = false): CloudPrescriptionWorkspaceState => ({ document: null, loading: false, outputPending: false, error: '', closed });
  let state = freeze(empty()), closed = false, epoch = 0, checking = false;
  let profile: CloudPatientRecord | null = null, settings: CloudClinicSettingsRecord | null = null, logo: CloudClinicLogoRecord | null = null;
  const listeners = new Set<(state: CloudPrescriptionWorkspaceState) => void>();
  function publish(value: CloudPrescriptionWorkspaceState) {
    const next = freeze(value); state = next;
    for (const listener of [...listeners]) { try { listener(next); } catch { /* No authority from a view. */ } }
  }
  function dispose() {
    if (closed) return;
    closed = true; ++epoch; profile = null; settings = null; logo = null;
    publish(empty(true)); listeners.clear();
  }
  function active(ticket = epoch) {
    if (closed || checking || ticket !== epoch) return false;
    let result = false; checking = true;
    try { result = options.isActive() === true; } catch { /* Fail closed. */ }
    finally { checking = false; }
    if (closed || ticket !== epoch) return false;
    if (!result) { dispose(); return false; } return true;
  }
  const assertActive = (ticket: number) => { if (!active(ticket)) fail(); };
  async function call<T>(ticket: number, work: () => T | Promise<T>): Promise<T> {
    assertActive(ticket); const result = await Promise.resolve().then(() => { assertActive(ticket); return work(); });
    assertActive(ticket); return result;
  }
  return {
    getState: () => { active(); return state; },
    subscribe(listener: (value: CloudPrescriptionWorkspaceState) => void) {
      if (!active()) return () => undefined;
      listeners.add(listener); return () => { listeners.delete(listener); };
    },
    async load(patientId: string): Promise<boolean> {
      if (!active() || state.loading || state.outputPending || state.document || !uuid(patientId)) return false;
      const ticket = ++epoch; publish({ ...empty(), loading: true });
      try {
        const settingsCap = await call(ticket, () => options.getSettings());
        const raw = await call(ticket, () => settingsCap.repository.get()); if (raw === null) fail();
        const confirmed = parseCloudClinicSettingsRecord(raw);
        const rawLogo = confirmed.data.identity.logoRecordId === null ? null : await call(ticket, () => settingsCap.repository.getLogo());
        const confirmedLogo = rawLogo === null ? null : parseCloudClinicLogoRecord(rawLogo);
        if (confirmed.data.identity.logoRecordId !== null && !confirmedLogo?.data) fail();
        const clinical = await call(ticket, () => options.getClinical());
        const file = await call(ticket, () => loadCloudClinicalPatient(clinical.repository, patientId, () => assertActive(ticket)));
        const latestRaw = await call(ticket, () => settingsCap.repository.get());
        if (latestRaw === null || JSON.stringify(parseCloudClinicSettingsRecord(latestRaw)) !== JSON.stringify(confirmed)) fail();
        if (confirmedLogo) {
          const latestLogo = await call(ticket, () => settingsCap.repository.getLogo());
          if (latestLogo === null || JSON.stringify(parseCloudClinicLogoRecord(latestLogo)) !== JSON.stringify(confirmedLogo)) fail();
        }
        assertActive(ticket);
        profile = freeze(file.profile); settings = freeze(confirmed); logo = freeze(confirmedLogo);
        const document = freeze({ patientRecordId: patientId,
          // Rx does not need or expose the patient's financial sessions.
          patient: { id: String(file.profile.fileNo), ...file.profile.data, sessions: [], payments: [] },
          clinicName: confirmed.data.identity.clinicName,
          clinicLogo: confirmedLogo?.data ? `data:${confirmedLogo.data.mimeType};base64,${confirmedLogo.data.base64}` : null,
          header: { doctorName: confirmed.data.identity.doctorName, phone: confirmed.data.identity.phone, address: confirmed.data.identity.address },
          medications: confirmed.data.medications.filter(item => item.active).map(item => ({ id: item.medicationId,
            name: item.name, category: item.category, defaultDosage: item.defaultDosage, defaultDuration: item.defaultDuration })),
        });
        publish({ ...empty(), document }); return active(ticket) && state.document === document;
      } catch {
        if (active(ticket)) publish({ ...empty(), error: 'تعذر قراءة بيانات المريض والهوية والشعار والأدوية. لم نستخدم بيانات أو شعارًا محليًا بديلًا.' }); return false;
      }
    },
    async authorizeOutput(expectedDocument: CloudPrescriptionDocumentContext): Promise<void> {
      if (!active() || state.loading || state.outputPending || state.document !== expectedDocument || !profile || !settings) fail();
      const ticket = epoch, expectedProfile = profile, expectedSettings = settings, expectedLogo = logo;
      publish({ ...state, outputPending: true, error: '' });
      try {
        const settingsCap = await call(ticket, () => options.getSettings());
        const raw = await call(ticket, () => settingsCap.repository.get());
        if (raw === null || JSON.stringify(parseCloudClinicSettingsRecord(raw)) !== JSON.stringify(expectedSettings)) fail();
        const clinical = await call(ticket, () => options.getClinical());
        const currentProfile = await call(ticket, () => clinical.repository.getProfile(expectedDocument.patientRecordId));
        if (JSON.stringify(parseCloudPatientRecord(currentProfile)) !== JSON.stringify(expectedProfile)) fail();
        if (expectedLogo) {
          const currentLogo = await call(ticket, () => settingsCap.repository.getLogo());
          if (currentLogo === null || JSON.stringify(parseCloudClinicLogoRecord(currentLogo)) !== JSON.stringify(expectedLogo)) fail();
        }
        assertActive(ticket); if (state.document !== expectedDocument) fail();
        publish({ ...state, outputPending: false }); assertActive(ticket);
      } catch {
        if (active(ticket)) publish({ ...state, outputPending: false,
          error: 'تعذر تأكيد الإخراج أو تغيرت بيانات المريض/العيادة. أغلق المسودة واقرأ أحدث البيانات قبل الطباعة أو المشاركة.' });
        fail();
      }
    },
    assertOutputActive(expectedDocument: CloudPrescriptionDocumentContext): void {
      if (!active() || state.loading || state.outputPending || state.document !== expectedDocument) fail();
    },
    discard(expectedDocument: CloudPrescriptionDocumentContext): boolean {
      if (!active() || state.loading || state.outputPending || state.document !== expectedDocument) return false;
      ++epoch; profile = null; settings = null; logo = null; publish(empty()); return active();
    },
    canClose: () => active() && !state.loading && !state.outputPending && state.document === null,
    dispose,
  };
}
export type CloudPrescriptionWorkspaceController = ReturnType<typeof createCloudPrescriptionWorkspaceController>;
