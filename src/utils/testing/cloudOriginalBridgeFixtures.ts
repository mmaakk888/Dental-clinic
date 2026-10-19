import { makeClinicSnapshotFixture, SNAPSHOT_OWNER, snapshotDigest, snapshotPath } from './cloudClinicSnapshotFixtures';
import { createCloudClinicSnapshotReader } from '../cloudClinicSnapshot';
import { createCloudOperationIntentRepository } from '../cloudOperationIntent';
import { createJournaledCloudPatientRepository } from '../cloudPatientRepository';
import { createCloudAppointmentRepository } from '../cloudAppointmentRepository';
import { createCloudProstheticRepository } from '../cloudProstheticRepository';
import { createCloudClinicalRepository } from '../cloudClinicalRepository';
import { createCloudClinicSettingsRepository } from '../cloudClinicSettingsRepository';
import { createCloudServiceCatalogRepository } from '../cloudServiceCatalogRepository';
import { createJournaledCloudContactRepository } from '../cloudContactRepository';
import type { CloudOperatingAdditionalContext } from '../cloudOperatingPageController';

/** TEST ONLY: fabricated Map records with the real pure domain/journal cores.
 * No credentials, SDK, local clinic data, network or cloud side effects. */
export async function originalBridgeFixture(full = true) {
  const fixture = await makeClinicSnapshotFixture(full), docs = fixture.docs;
  let active = true, lostReply = false, writes = 0, refreshes = 0;
  const page = (collection: string, after: string | null, limit: number, predicate = (_row: any) => true) => [...docs]
    .filter(([path, value]) => path.startsWith(snapshotPath(collection, '')) && (!after || path.split('/').at(-1)! > after) && predicate(value))
    .sort(([a], [b]) => a.localeCompare(b)).slice(0, limit).map(([path, data]) => ({ id: path.split('/').at(-1)!, data: structuredClone(data) }));
  const adapter: any = { authorizeOwner: async () => { if (!active) throw Error('SYNTHETIC_REVOKED'); return SNAPSHOT_OWNER; },
    readRecord: async (path: string) => structuredClone(docs.get(path) ?? null),
    listRecordsPage: (after: string | null, limit: number) => Promise.resolve(page('patientProfiles', after, limit)),
    findRecordsByPhone: (phoneKey: string, after: string | null, limit: number) => Promise.resolve(page('patientProfiles', after, limit, row => row.phoneKey === phoneKey)),
    listDayPage: (date: string, after: string | null, limit: number) => Promise.resolve(page('appointmentRecords', after, limit, row => row.data.date === date)),
    listCasesPage: (lab: string, after: string | null, limit: number) => Promise.resolve(page('labCases', after, limit, row => row.labId === lab)),
    listPaymentsPage: (lab: string, after: string | null, limit: number) => Promise.resolve(page('labPayments', after, limit, row => row.labId === lab)),
    listSessionsPage: (patient: string, after: string | null, limit: number) => Promise.resolve(page('patientSessions', after, limit, row => row.patientId === patient)),
    listReceiptsPage: (patient: string, after: string | null, limit: number) => Promise.resolve(page('patientReceipts', after, limit, row => row.patientId === patient)),
    listLabsPage: (after: string | null, limit: number) => Promise.resolve(page('labDefinitions', after, limit)),
    runTransaction: async (work: any) => { const staged = structuredClone(docs); let domain = false, written = false;
      const result = await work({ get: async (path: string) => { if (written) throw Error('READ_AFTER_WRITE'); return structuredClone(staged.get(path) ?? null); },
        set: (path: string, value: any) => { written = true; domain ||= path.includes('Operations/'); staged.set(path, structuredClone(value)); } });
      docs.clear(); staged.forEach((value: any, key: string) => docs.set(key, value)); if (domain) { writes++; if (lostReply) { lostReply = false; throw Error('SYNTHETIC_LOST_REPLY'); } } return result;
    } };
  const journal = createCloudOperationIntentRepository(adapter, { digest: snapshotDigest });
  const patient = { ...createJournaledCloudPatientRepository(adapter, { digest: snapshotDigest }), journal };
  const appointments = { repository: createCloudAppointmentRepository(adapter, { digest: snapshotDigest }), journal };
  const prosthetics = { repository: createCloudProstheticRepository(adapter, { digest: snapshotDigest }), journal };
  const clinical = { repository: createCloudClinicalRepository(adapter, { digest: snapshotDigest }), journal };
  const settings = { repository: createCloudClinicSettingsRepository(adapter, { digest: snapshotDigest }), journal };
  const catalog = { repository: createCloudServiceCatalogRepository(adapter, { digest: snapshotDigest }), journal };
  const contacts = { ...createJournaledCloudContactRepository({ ...adapter,
    listRecordsPage: async (after: string | null, limit: number) => page('contactRecords', after, limit) }, { digest: snapshotDigest }), journal };
  const reader = createCloudClinicSnapshotReader(fixture.adapter, { digest: snapshotDigest });
  const unavailable = async (): Promise<never> => { throw Error('SYNTHETIC_UNREQUESTED_CAPABILITY'); };
  const context: CloudOperatingAdditionalContext = { ownerUid: SNAPSHOT_OWNER, isActive: () => active, getPatients: async () => patient,
    getAppointments: async () => appointments, getProsthetics: async () => prosthetics, getClinical: async () => clinical,
    getClinicSettings: async () => settings, getServiceCatalog: async () => catalog,
    getClinicSnapshot: async () => reader, getExpenses: unavailable, getContacts: async () => contacts };
  return { ...fixture, context, patient, appointments, prosthetics, clinical, settings, catalog, contacts, reader,
    snapshot: () => reader.readFull(), refresh: async () => { refreshes++; }, loseReply: () => { lostReply = true; },
    counts: () => ({ writes, refreshes }), revoke: () => { active = false; } };
}
