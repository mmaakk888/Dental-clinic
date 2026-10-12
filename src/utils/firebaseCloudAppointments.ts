import type { Auth } from 'firebase/auth';
import type { DocumentSnapshot, QueryConstraint, Transaction } from 'firebase/firestore/lite';
import { assessCloudOwnerIdentity, CLOUD_PROJECT_ID } from './cloudIdentity';
import { assessCloudOwnerMembership } from './cloudMembership';
import { isLocalClinicHost } from './localRuntime';
import { CloudAppointmentError, createCloudAppointmentRepository, prepareCloudAppointmentCommand,
  type CloudAppointmentRepository, type CloudAppointmentTransaction } from './cloudAppointmentRepository';
import { CloudOperationIntentError, createCloudOperationIntentRepository, parseCloudOperationIntent, prepareCloudIntentCommand,
  type CloudOperationIntent, type CloudOperationIntentRepository, type CloudOperationKind } from './cloudOperationIntent';

/** Source-only owner capability. Construction never authorizes, reads or seeds
 * appointments, and remains loopback-only until the complete release gates. */
export interface FirebaseCloudAppointmentsOptions { isActive: () => boolean }
export interface FirebaseCloudAppointmentsCapability {
  repository: CloudAppointmentRepository;
  journal: CloudOperationIntentRepository;
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const END = '(?![\\s\\S])';
const ID = new RegExp(`^${UUID}${END}`);
const APP = new RegExp(`^clinic-operating-${UUID}${END}`);
const RECORD = new RegExp(`^clinics/main/appointmentRecords/${UUID}${END}`);
const DAY = /^clinics\/main\/appointmentDays\/(\d{4}-\d{2}-\d{2})(?![\s\S])/;
const OPERATION = new RegExp(`^clinics/main/appointmentOperations/${UUID}${END}`);
const INTENT = new RegExp(`^clinics/main/operationIntents/${UUID}${END}`);
const PROFILE = new RegExp(`^clinics/main/patientProfiles/${UUID}${END}`);
const appointmentKind = (kind: CloudOperationKind) => {
  if (kind !== 'appointment') throw new CloudOperationIntentError('invalid');
};
function dayPath(path: string): boolean {
  const match = DAY.exec(path);
  if (!match || match[1] < '1900-01-01' || match[1] > '9999-12-31') return false;
  const date = new Date(`${match[1]}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === match[1];
}

export async function createFirebaseCloudAppointments(auth: Auth,
  options: FirebaseCloudAppointmentsOptions): Promise<FirebaseCloudAppointmentsCapability> {
  let revoked = false;
  let user: Auth['currentUser'], app: Auth['app'], uid: string | undefined;
  try { user = auth?.currentUser; app = auth?.app; uid = user?.uid; }
  catch { throw new CloudAppointmentError('unavailable'); }
  const requireRuntime = () => {
    try {
      if (revoked || !options || typeof options.isActive !== 'function' || options.isActive() !== true
        || typeof window === 'undefined' || !isLocalClinicHost(window.location.hostname)
        || !auth || !user || typeof uid !== 'string' || !uid || auth.currentUser !== user || user.uid !== uid || auth.app !== app
        || auth.app.options.projectId !== CLOUD_PROJECT_ID
        || auth.app.options.authDomain !== `${CLOUD_PROJECT_ID}.firebaseapp.com`
        || !APP.test(auth.app.name) || auth.emulatorConfig) throw new Error();
    } catch {
      revoked = true;
      throw new CloudAppointmentError('unavailable');
    }
  };
  const sdkCall = <T>(work: () => T): T => { requireRuntime(); const value = work(); requireRuntime(); return value; };
  const sdkAwait = async <T>(work: () => Promise<T>): Promise<T> => {
    requireRuntime(); const pending = work();
    try { requireRuntime(); }
    catch (error) { void pending.catch(() => undefined); throw error; }
    try { const value = await pending; requireRuntime(); return value; }
    catch (error) { requireRuntime(); throw error; }
  };
  const checkedIntent = (value: unknown, path?: string): CloudOperationIntent => {
    requireRuntime();
    let intent: CloudOperationIntent;
    try {
      intent = parseCloudOperationIntent(value);
      const command = prepareCloudAppointmentCommand(intent.command);
      if (intent.kind !== 'appointment' || intent.actorUid !== uid || command.createdAt !== intent.createdAt
        || path !== undefined && path !== `clinics/main/operationIntents/${intent.operationId}`
        || JSON.stringify(prepareCloudIntentCommand(command)) !== JSON.stringify(intent.command)) throw new Error();
    } catch { throw new CloudOperationIntentError('invalid'); }
    requireRuntime(); return intent;
  };
  try {
    requireRuntime();
    const [sdk, store] = await Promise.all([import('firebase/auth'), import('firebase/firestore/lite')]);
    requireRuntime();
    // Lite uses the exact named operating app, never a setup/default app or an
    // offline/cached write queue. No SDK object escapes this capability.
    const database = sdkCall(() => store.getFirestore(auth.app, '(default)'));
    const authorizeOwner = async () => {
      requireRuntime();
      const token = await sdkAwait(() => sdk.getIdTokenResult(user!));
      const identity = sdkCall(() => assessCloudOwnerIdentity({ uid: user!.uid, email: user!.email,
        emailVerified: user!.emailVerified, token }));
      if (identity.status !== 'owner-confirmed') throw new CloudAppointmentError('unavailable');
      const authTime = sdkCall(() => Object.getOwnPropertyDescriptor(token.claims, 'auth_time')?.value);
      const reference = sdkCall(() => store.doc(database, 'clinics', 'main', 'members', identity.uid));
      const snapshot = await sdkAwait(() => store.getDoc(reference));
      if (!sdkCall(() => snapshot.exists())) throw new CloudAppointmentError('unavailable');
      const member = sdkCall(() => snapshot.data());
      sdkCall(() => assessCloudOwnerMembership(identity, member, authTime));
      requireRuntime(); return identity.uid;
    };
    const reference = (path: string, write = false) => {
      requireRuntime();
      if (typeof path !== 'string' || !(RECORD.test(path) || dayPath(path) || OPERATION.test(path)
        || INTENT.test(path) || !write && PROFILE.test(path))) throw new CloudAppointmentError('invalid');
      return sdkCall(() => store.doc(database, path));
    };
    const readSnapshot = (path: string, snapshot: DocumentSnapshot) => {
      const value = sdkCall(() => snapshot.exists()) ? sdkCall(() => snapshot.data()) : null;
      // Validate the complete appointment command inside the transaction read,
      // BEFORE generic journal cancellation is allowed to stage any write.
      if (value !== null && INTENT.test(path)) return checkedIntent(value, path);
      requireRuntime(); return value;
    };
    const readRecord = async (path: string) => {
      requireRuntime();
      if (typeof path !== 'string' || !(RECORD.test(path) || dayPath(path) || INTENT.test(path))) {
        throw new CloudAppointmentError('invalid');
      }
      return readSnapshot(path, await sdkAwait(() => store.getDoc(reference(path))));
    };
    const runTransaction = async <T>(work: (transaction: CloudAppointmentTransaction) => Promise<T>): Promise<T> => {
      const result = await sdkAwait(() => store.runTransaction(database, async (transaction: Transaction) => {
        requireRuntime();
        const result = await work({
          get: async path => readSnapshot(path, await sdkAwait(() => transaction.get(reference(path)))),
          set: (path, value) => {
            const target = reference(path, true);
            if (INTENT.test(path)) checkedIntent(value, path);
            sdkCall(() => transaction.set(target, value));
          },
        });
        requireRuntime(); return result;
      }, { maxAttempts: 5 }));
      requireRuntime(); return result;
    };
    const page = async (actorUid: string, afterId: string | null, count: number, preparedOnly: boolean) => {
      requireRuntime();
      if (actorUid !== uid || afterId !== null && (typeof afterId !== 'string' || !ID.test(afterId))
        || !Number.isSafeInteger(count) || count < 1 || count > 50) throw new CloudOperationIntentError('invalid');
      const constraints: QueryConstraint[] = [
        sdkCall(() => store.where('actorUid', '==', uid)),
        sdkCall(() => store.where('kind', '==', 'appointment')),
      ];
      if (preparedOnly) constraints.push(sdkCall(() => store.where('status', '==', 'prepared')));
      constraints.push(sdkCall(() => store.orderBy(sdkCall(() => store.documentId()))));
      if (afterId !== null) constraints.push(sdkCall(() => store.startAfter(afterId)));
      constraints.push(sdkCall(() => store.limit(count)));
      const collection = sdkCall(() => store.collection(database, 'clinics', 'main', 'operationIntents'));
      const query = sdkCall(() => store.query(collection, ...constraints));
      const snapshot = await sdkAwait(() => store.getDocs(query));
      const documents = sdkCall(() => snapshot.docs);
      const rows = documents.map(document => ({ id: sdkCall(() => document.id), data: sdkCall(() => document.data()) }));
      requireRuntime(); return rows;
    };
    const listDayPage = async (date: string, afterId: string | null, count: number) => {
      requireRuntime();
      if (typeof date !== 'string' || !dayPath(`clinics/main/appointmentDays/${date}`)
        || afterId !== null && (typeof afterId !== 'string' || !ID.test(afterId))
        || !Number.isSafeInteger(count) || count < 1 || count > 50) throw new CloudAppointmentError('invalid');
      const constraints: QueryConstraint[] = [
        sdkCall(() => store.where('data.date', '==', date)),
        sdkCall(() => store.orderBy(sdkCall(() => store.documentId()))),
      ];
      if (afterId !== null) constraints.push(sdkCall(() => store.startAfter(afterId)));
      constraints.push(sdkCall(() => store.limit(count)));
      const collection = sdkCall(() => store.collection(database, 'clinics', 'main', 'appointmentRecords'));
      const query = sdkCall(() => store.query(collection, ...constraints));
      const snapshot = await sdkAwait(() => store.getDocs(query));
      const documents = sdkCall(() => snapshot.docs);
      const rows = documents.map(document => ({ id: sdkCall(() => document.id), data: sdkCall(() => document.data()) }));
      requireRuntime(); return rows;
    };
    const repository = createCloudAppointmentRepository({ authorizeOwner, runTransaction,
      readRecord: path => {
        if (typeof path !== 'string' || !(RECORD.test(path) || dayPath(path))) throw new CloudAppointmentError('invalid');
        return readRecord(path);
      },
      listDayPage,
    });
    const journalRepository = createCloudOperationIntentRepository({ authorizeOwner, runTransaction,
      readRecord: path => {
        if (typeof path !== 'string' || !INTENT.test(path)) throw new CloudOperationIntentError('invalid');
        return readRecord(path);
      },
      listPreparedPage: (kind, actorUid, afterId, count) => { appointmentKind(kind); return page(actorUid, afterId, count, true); },
      listHistoryPage: (kind, actorUid, afterId, count) => { appointmentKind(kind); return page(actorUid, afterId, count, false); },
    });
    const journal = Object.freeze({
      prepare: (async (kind, input, createdAt) => {
        appointmentKind(kind);
        let command;
        try { command = prepareCloudAppointmentCommand(input); }
        catch { throw new CloudOperationIntentError('invalid'); }
        if (createdAt !== command.createdAt) throw new CloudOperationIntentError('invalid');
        return checkedIntent(await journalRepository.prepare(kind, command, createdAt));
      }) as typeof journalRepository.prepare,
      get: (async id => {
        const result = await journalRepository.get(id);
        return result === null ? null : checkedIntent(result);
      }) as typeof journalRepository.get,
      listPreparedPage: (async (kind, input) => {
        appointmentKind(kind);
        const result = await journalRepository.listPreparedPage(kind, input);
        return { records: result.records.map(intent => checkedIntent(intent)), nextAfterId: result.nextAfterId };
      }) as typeof journalRepository.listPreparedPage,
      listHistoryPage: (async (kind, input) => {
        appointmentKind(kind);
        const result = await journalRepository.listHistoryPage(kind, input);
        return { records: result.records.map(intent => checkedIntent(intent)), nextAfterId: result.nextAfterId };
      }) as typeof journalRepository.listHistoryPage,
      cancel: (async id => checkedIntent(await journalRepository.cancel(id))) as typeof journalRepository.cancel,
    });
    requireRuntime(); return Object.freeze({ repository: Object.freeze(repository), journal });
  } catch {
    throw new CloudAppointmentError('unavailable');
  }
}
