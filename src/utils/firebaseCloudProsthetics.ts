import type { Auth } from 'firebase/auth';
import type { DocumentSnapshot, QueryConstraint, Transaction } from 'firebase/firestore/lite';
import { assessCloudOwnerIdentity, CLOUD_PROJECT_ID } from './cloudIdentity';
import { assessCloudOwnerMembership } from './cloudMembership';
import { isLocalClinicHost } from './localRuntime';
import { CloudProstheticError, createCloudProstheticRepository, prepareCloudProstheticCommand,
  type CloudProstheticRepository, type CloudProstheticTransaction } from './cloudProstheticRepository';
import { CloudOperationIntentError, createCloudOperationIntentRepository, parseCloudOperationIntent, prepareCloudIntentCommand,
  type CloudOperationIntent, type CloudOperationIntentRepository, type CloudOperationKind } from './cloudOperationIntent';

/** Source-only owner capability; no construction-time reads and no SDK/Auth
 * object escapes. Production activation belongs to the combined release. */
export interface FirebaseCloudProstheticsOptions { isActive: () => boolean }
export interface FirebaseCloudProstheticsCapability { repository: CloudProstheticRepository; journal: CloudOperationIntentRepository }
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const END = '(?![\\s\\S])';
const ID = new RegExp(`^${UUID}${END}`), APP = new RegExp(`^clinic-operating-${UUID}${END}`);
const LAB_CASE = new RegExp(`^clinics/main/labCases/${UUID}${END}`);
const LAB_ACCOUNT = new RegExp(`^clinics/main/labAccounts/${UUID}${END}`);
const LAB_PAYMENT = new RegExp(`^clinics/main/labPayments/${UUID}${END}`);
const OPERATION = new RegExp(`^clinics/main/prostheticOperations/${UUID}${END}`);
const INTENT = new RegExp(`^clinics/main/operationIntents/${UUID}${END}`);
const DEFINITION = new RegExp(`^clinics/main/labDefinitions/${UUID}${END}`);
const PROFILE = new RegExp(`^clinics/main/patientProfiles/${UUID}${END}`);
const PATIENT_ACCOUNT = new RegExp(`^clinics/main/patientAccounts/${UUID}${END}`);
const SESSION = new RegExp(`^clinics/main/patientSessions/${UUID}${END}`);
const CASH = new RegExp(`^clinics/main/patientReceipts/${UUID}${END}`);
const CLINICAL_OPERATION = new RegExp(`^clinics/main/clinicalOperations/${UUID}${END}`);
const FILE = /^clinics\/main\/patientFiles\/([1-9][0-9]{0,9})(?![\s\S])/;
const SETTINGS = new Set(['clinics/main/settings/serviceCatalog', 'clinics/main/settings/prostheticRouting']);
const prostheticKind = (kind: CloudOperationKind) => { if (kind !== 'prosthetic') throw new CloudOperationIntentError('invalid'); };
const filePath = (path: string) => { const match = FILE.exec(path); return !!match && Number(match[1]) <= 2_000_000_000; };

export async function createFirebaseCloudProsthetics(auth: Auth, options: FirebaseCloudProstheticsOptions): Promise<FirebaseCloudProstheticsCapability> {
  let revoked = false;
  let user: Auth['currentUser'], app: Auth['app'], uid: string | undefined;
  try { user = auth?.currentUser; app = auth?.app; uid = user?.uid; } catch { throw new CloudProstheticError('unavailable'); }
  const requireRuntime = () => {
    try {
      if (revoked || !options || typeof options.isActive !== 'function' || options.isActive() !== true
        || typeof window === 'undefined' || !isLocalClinicHost(window.location.hostname)
        || !auth || !user || typeof uid !== 'string' || !uid || auth.currentUser !== user || user.uid !== uid || auth.app !== app
        || auth.app.options.projectId !== CLOUD_PROJECT_ID || auth.app.options.authDomain !== `${CLOUD_PROJECT_ID}.firebaseapp.com`
        || !APP.test(auth.app.name) || auth.emulatorConfig) throw new Error();
    } catch { revoked = true; throw new CloudProstheticError('unavailable'); }
  };
  const sdkCall = <T>(work: () => T): T => { requireRuntime(); const value = work(); requireRuntime(); return value; };
  const sdkAwait = async <T>(work: () => Promise<T>): Promise<T> => {
    requireRuntime(); const pending = work();
    try { requireRuntime(); } catch (error) { void pending.catch(() => undefined); throw error; }
    try { const value = await pending; requireRuntime(); return value; } catch (error) { requireRuntime(); throw error; }
  };
  const checkedIntent = (value: unknown, path?: string): CloudOperationIntent => {
    requireRuntime(); let intent: CloudOperationIntent;
    try {
      intent = parseCloudOperationIntent(value); const command = prepareCloudProstheticCommand(intent.command);
      if (intent.kind !== 'prosthetic' || intent.actorUid !== uid || command.createdAt !== intent.createdAt
        || path !== undefined && path !== `clinics/main/operationIntents/${intent.operationId}`
        || JSON.stringify(prepareCloudIntentCommand(command)) !== JSON.stringify(intent.command)) throw new Error();
    } catch { throw new CloudOperationIntentError('invalid'); }
    requireRuntime(); return intent;
  };
  try {
    requireRuntime(); const [sdk, store] = await Promise.all([import('firebase/auth'), import('firebase/firestore/lite')]); requireRuntime();
    const database = sdkCall(() => store.getFirestore(auth.app, '(default)'));
    const authorizeOwner = async () => {
      requireRuntime(); const token = await sdkAwait(() => sdk.getIdTokenResult(user!));
      const identity = sdkCall(() => assessCloudOwnerIdentity({ uid: user!.uid, email: user!.email, emailVerified: user!.emailVerified, token }));
      if (identity.status !== 'owner-confirmed') throw new CloudProstheticError('unavailable');
      const authTime = sdkCall(() => Object.getOwnPropertyDescriptor(token.claims, 'auth_time')?.value);
      const reference = sdkCall(() => store.doc(database, 'clinics', 'main', 'members', identity.uid));
      const snapshot = await sdkAwait(() => store.getDoc(reference));
      if (!sdkCall(() => snapshot.exists())) throw new CloudProstheticError('unavailable');
      sdkCall(() => assessCloudOwnerMembership(identity, sdkCall(() => snapshot.data()), authTime));
      requireRuntime(); return identity.uid;
    };
    const writable = (path: string) => LAB_CASE.test(path) || LAB_ACCOUNT.test(path) || LAB_PAYMENT.test(path) || OPERATION.test(path)
      || INTENT.test(path) || PATIENT_ACCOUNT.test(path) || SESSION.test(path) || CASH.test(path);
    const reference = (path: string, write = false) => {
      requireRuntime();
      if (typeof path !== 'string' || !(writable(path) || !write && (DEFINITION.test(path) || PROFILE.test(path)
        || filePath(path) || CLINICAL_OPERATION.test(path) || SETTINGS.has(path)))) throw new CloudProstheticError('invalid');
      return sdkCall(() => store.doc(database, path));
    };
    const readSnapshot = (path: string, snapshot: DocumentSnapshot) => {
      const value = sdkCall(() => snapshot.exists()) ? sdkCall(() => snapshot.data()) : null;
      // Full command validation is inside the read, before journal cancellation
      // can stage a write. A valid generic JSON hash is insufficient.
      if (value !== null && INTENT.test(path)) return checkedIntent(value, path);
      requireRuntime(); return value;
    };
    const readRecord = async (path: string) => {
      requireRuntime();
      if (typeof path !== 'string' || !(LAB_CASE.test(path) || LAB_ACCOUNT.test(path) || DEFINITION.test(path) || SESSION.test(path) || INTENT.test(path))) throw new CloudProstheticError('invalid');
      return readSnapshot(path, await sdkAwait(() => store.getDoc(reference(path))));
    };
    const runTransaction = async <T>(work: (transaction: CloudProstheticTransaction) => Promise<T>): Promise<T> => {
      const result = await sdkAwait(() => store.runTransaction(database, async (transaction: Transaction) => {
        requireRuntime();
        const result = await work({
          get: async path => readSnapshot(path, await sdkAwait(() => transaction.get(reference(path)))),
          set: (path, value) => { const target = reference(path, true); if (INTENT.test(path)) checkedIntent(value, path); sdkCall(() => transaction.set(target, value)); },
        });
        requireRuntime(); return result;
      }, { maxAttempts: 5 }));
      requireRuntime(); return result;
    };
    const queryRows = async (collection: 'labCases' | 'labPayments' | 'operationIntents', constraints: QueryConstraint[]) => {
      const source = sdkCall(() => store.collection(database, 'clinics', 'main', collection));
      const request = sdkCall(() => store.query(source, ...constraints)), snapshot = await sdkAwait(() => store.getDocs(request));
      const documents = sdkCall(() => snapshot.docs);
      const rows = documents.map(document => ({ id: sdkCall(() => document.id), data: sdkCall(() => document.data()) }));
      requireRuntime(); return rows;
    };
    const cursor = (afterId: string | null, count: number) => {
      requireRuntime();
      if (afterId !== null && (typeof afterId !== 'string' || !ID.test(afterId)) || !Number.isSafeInteger(count) || count < 1 || count > 50) throw new CloudProstheticError('invalid');
      const constraints: QueryConstraint[] = [sdkCall(() => store.orderBy(sdkCall(() => store.documentId())))];
      if (afterId !== null) constraints.push(sdkCall(() => store.startAfter(afterId))); constraints.push(sdkCall(() => store.limit(count)));
      return constraints;
    };
    const labPage = (collection: 'labCases' | 'labPayments', labId: string, afterId: string | null, count: number) => {
      requireRuntime(); if (typeof labId !== 'string' || !ID.test(labId)) throw new CloudProstheticError('invalid');
      return queryRows(collection, [sdkCall(() => store.where('labId', '==', labId)), ...cursor(afterId, count)]);
    };
    const history = (actorUid: string, afterId: string | null, count: number, preparedOnly: boolean) => {
      requireRuntime(); if (actorUid !== uid) throw new CloudOperationIntentError('invalid');
      const constraints = [sdkCall(() => store.where('actorUid', '==', uid)), sdkCall(() => store.where('kind', '==', 'prosthetic'))];
      if (preparedOnly) constraints.push(sdkCall(() => store.where('status', '==', 'prepared')));
      return queryRows('operationIntents', [...constraints, ...cursor(afterId, count)]);
    };
    const repository = createCloudProstheticRepository({ authorizeOwner, runTransaction,
      readRecord: path => {
        if (typeof path !== 'string' || !(LAB_CASE.test(path) || LAB_ACCOUNT.test(path) || DEFINITION.test(path) || SESSION.test(path))) throw new CloudProstheticError('invalid');
        return readRecord(path);
      }, listCasesPage: (labId, afterId, count) => labPage('labCases', labId, afterId, count),
      listPaymentsPage: (labId, afterId, count) => labPage('labPayments', labId, afterId, count),
    });
    const journalRepository = createCloudOperationIntentRepository({ authorizeOwner, runTransaction,
      readRecord: path => { if (typeof path !== 'string' || !INTENT.test(path)) throw new CloudOperationIntentError('invalid'); return readRecord(path); },
      listPreparedPage: (kind, actorUid, afterId, count) => { prostheticKind(kind); return history(actorUid, afterId, count, true); },
      listHistoryPage: (kind, actorUid, afterId, count) => { prostheticKind(kind); return history(actorUid, afterId, count, false); },
    });
    const journal = Object.freeze({
      prepare: (async (kind, input, createdAt) => {
        prostheticKind(kind); let command;
        try { command = prepareCloudProstheticCommand(input); } catch { throw new CloudOperationIntentError('invalid'); }
        if (createdAt !== command.createdAt) throw new CloudOperationIntentError('invalid');
        return checkedIntent(await journalRepository.prepare(kind, command, createdAt));
      }) as typeof journalRepository.prepare,
      get: (async id => { const result = await journalRepository.get(id); return result === null ? null : checkedIntent(result); }) as typeof journalRepository.get,
      listPreparedPage: (async (kind, input) => { prostheticKind(kind); const result = await journalRepository.listPreparedPage(kind, input);
        return { records: result.records.map(intent => checkedIntent(intent)), nextAfterId: result.nextAfterId }; }) as typeof journalRepository.listPreparedPage,
      listHistoryPage: (async (kind, input) => { prostheticKind(kind); const result = await journalRepository.listHistoryPage(kind, input);
        return { records: result.records.map(intent => checkedIntent(intent)), nextAfterId: result.nextAfterId }; }) as typeof journalRepository.listHistoryPage,
      cancel: (async id => checkedIntent(await journalRepository.cancel(id))) as typeof journalRepository.cancel,
    });
    requireRuntime(); return Object.freeze({ repository: Object.freeze(repository), journal });
  } catch { throw new CloudProstheticError('unavailable'); }
}
