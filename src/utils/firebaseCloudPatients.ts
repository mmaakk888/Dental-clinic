import type { Auth } from 'firebase/auth';
import type { QueryConstraint } from 'firebase/firestore/lite';
import { assessCloudOwnerIdentity, CLOUD_PROJECT_ID } from './cloudIdentity';
import { assessCloudOwnerMembership } from './cloudMembership';
import { createJournaledCloudPatientRepository, prepareCloudPatientCommand, CloudPatientError, type CloudPatientRepository } from './cloudPatientRepository';
import { CloudOperationIntentError, createCloudOperationIntentRepository, prepareCloudIntentCommand, parseCloudOperationIntent,
  type CloudOperationIntent, type CloudOperationKind, type CloudOperationIntentRepository } from './cloudOperationIntent';
import { isLocalClinicHost } from './localRuntime';

/** Prepared explicit Auth capability only: no UI, live Rules or Hosting activation. */
export interface FirebaseCloudPatientsOptions { isActive?: () => boolean }
export type FirebaseCloudPatientsCapability = CloudPatientRepository & { readonly journal: CloudOperationIntentRepository };

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
// Absolute end, not JS `$` (which also matches before a trailing newline).
const END = '(?![\\s\\S])';
const OPERATING_APP = new RegExp(`^clinic-operating-${UUID}${END}`);
const PROFILE_PATH = new RegExp(`^clinics/main/patientProfiles/${UUID}${END}`);
const OPERATION_PATH = new RegExp(`^clinics/main/patientOperations/${UUID}${END}`);
const INTENT_PATH = new RegExp(`^clinics/main/operationIntents/${UUID}${END}`);
const FILE_PATH = /^clinics\/main\/patientFiles\/([1-9][0-9]{0,9})(?![\s\S])/;
const COUNTER_PATH = 'clinics/main/counters/patientFiles';
const HASH = /^[0-9a-f]{64}(?![\s\S])/;
const UUID_ID = new RegExp(`^${UUID}${END}`);

function patientFilePath(path: string) {
  const match = FILE_PATH.exec(path);
  return !!match && Number(match[1]) <= 2_000_000_000;
}

export async function createFirebaseCloudPatients(auth: Auth, options: FirebaseCloudPatientsOptions = {}): Promise<FirebaseCloudPatientsCapability> {
  let revoked = false;
  let user: Auth['currentUser'], app: Auth['app'], uid: string | undefined;
  try { user = auth?.currentUser; app = auth?.app; uid = user?.uid; }
  catch { throw new CloudPatientError('unavailable'); }
  const requireRuntime = () => {
    try {
      if (revoked || options.isActive && options.isActive() !== true
        || typeof window === 'undefined' || !isLocalClinicHost(window.location.hostname)
        || !auth || !user || typeof uid !== 'string' || !uid || auth.currentUser !== user || user.uid !== uid || auth.app !== app
        || app.options.projectId !== CLOUD_PROJECT_ID
        || app.options.authDomain !== `${CLOUD_PROJECT_ID}.firebaseapp.com`
        || !OPERATING_APP.test(app.name) || auth.emulatorConfig) throw new Error();
    } catch {
      revoked = true;
      throw new CloudPatientError('unavailable');
    }
  };
  const sdkCall = <T>(work: () => T): T => {
    requireRuntime();
    const value = work();
    requireRuntime();
    return value;
  };
  const sdkAwait = async <T>(work: () => Promise<T>): Promise<T> => {
    requireRuntime();
    const pending = work();
    try { requireRuntime(); }
    catch (error) {
      // A just-started SDK request still owns its rejection after revocation.
      // Observe it without retaining/revealing its payload or reporting success.
      void pending.catch(() => undefined);
      throw error;
    }
    try { const result = await pending; requireRuntime(); return result; }
    catch (error) { requireRuntime(); throw error; }
  };
  const patientKind = (kind: CloudOperationKind) => {
    requireRuntime(); if (kind !== 'patient-profile') throw new CloudOperationIntentError('invalid');
  };
  const checkedIntent = (value: unknown, path?: string): CloudOperationIntent => {
    requireRuntime();
    let intent: CloudOperationIntent;
    try {
      intent = parseCloudOperationIntent(value);
      const command = prepareCloudPatientCommand(intent.command);
      if (intent.kind !== 'patient-profile' || intent.actorUid !== uid
        || path !== undefined && path !== `clinics/main/operationIntents/${intent.operationId}`
        || JSON.stringify(prepareCloudIntentCommand(command)) !== JSON.stringify(intent.command)) throw new Error();
    } catch { throw new CloudOperationIntentError('invalid'); }
    requireRuntime(); return intent;
  };
  try {
    requireRuntime();
    const [sdk, store] = await Promise.all([import('firebase/auth'), import('firebase/firestore/lite')]);
    requireRuntime();
    // Explicit isolated operating app and default database. Lite has no offline
    // record cache/queued write fallback; never use the old default backup app.
    const database = sdkCall(() => store.getFirestore(auth.app, '(default)'));
    const authorizeOwner = async () => {
      requireRuntime();
      const requireSameUser = () => {
        requireRuntime();
        if (auth.currentUser !== user) throw new CloudPatientError('unavailable');
      };
      const token = await sdkAwait(() => sdk.getIdTokenResult(user!));
      requireSameUser();
      const identity = assessCloudOwnerIdentity({ uid: user!.uid, email: user!.email,
        emailVerified: user!.emailVerified, token });
      requireSameUser();
      if (identity.status !== 'owner-confirmed') throw new CloudPatientError('unavailable');
      const authTime = Object.getOwnPropertyDescriptor(token.claims, 'auth_time')?.value;
      const memberReference = sdkCall(() => store.doc(database, 'clinics', 'main', 'members', identity.uid));
      requireSameUser();
      const membership = await sdkAwait(() => store.getDoc(memberReference));
      requireSameUser();
      const exists = sdkCall(() => membership.exists());
      requireSameUser();
      if (!exists) throw new CloudPatientError('unavailable');
      const member = sdkCall(() => membership.data());
      requireSameUser();
      assessCloudOwnerMembership(identity, member, authTime);
      requireSameUser();
      return identity.uid;
    };
    const reference = (path: string) => {
      requireRuntime();
      // Receipts can only be read inside a transaction. No clinical finance,
      // local backup, contact, arbitrary membership or other clinic paths.
      if (typeof path !== 'string' || !(PROFILE_PATH.test(path) || OPERATION_PATH.test(path) || INTENT_PATH.test(path)
        || patientFilePath(path) || path === COUNTER_PATH)) throw new CloudPatientError('invalid');
      return sdkCall(() => store.doc(database, path));
    };
    const page = async (afterId: string | null, count: number, phoneKey?: string) => {
      requireRuntime();
      if (afterId !== null && (typeof afterId !== 'string' || !UUID_ID.test(afterId))
        || !Number.isSafeInteger(count) || count < 1 || count > 50
        || phoneKey !== undefined && (typeof phoneKey !== 'string' || !HASH.test(phoneKey))) {
        throw new CloudPatientError('invalid');
      }
      const constraints: QueryConstraint[] = [];
      if (phoneKey !== undefined) constraints.push(sdkCall(() => store.where('phoneKey', '==', phoneKey)));
      const documentId = sdkCall(() => store.documentId());
      constraints.push(sdkCall(() => store.orderBy(documentId)));
      if (afterId !== null) constraints.push(sdkCall(() => store.startAfter(afterId)));
      constraints.push(sdkCall(() => store.limit(count)));
      const collection = sdkCall(() => store.collection(database, 'clinics', 'main', 'patientProfiles'));
      const query = sdkCall(() => store.query(collection, ...constraints));
      const snapshot = await sdkAwait(() => store.getDocs(query));
      const rows = sdkCall(() => snapshot.docs).map(document => {
        requireRuntime();
        const id = document.id;
        const data = sdkCall(() => document.data());
        requireRuntime();
        return { id, data };
      });
      requireRuntime();
      return rows;
    };
    const readSnapshot = (path: string, snapshot: { exists(): boolean; data(): unknown }) => {
      const exists = sdkCall(() => snapshot.exists());
      const value = exists ? sdkCall(() => snapshot.data()) : null;
      if (value !== null && INTENT_PATH.test(path)) return checkedIntent(value, path);
      requireRuntime(); return value;
    };
    const runTransaction: Parameters<typeof createJournaledCloudPatientRepository>[0]['runTransaction'] = async work => {
      const result = await sdkAwait(() => store.runTransaction(database, async transaction => {
        requireRuntime();
        const value = await work({
          get: async path => readSnapshot(path, await sdkAwait(() => transaction.get(reference(path)))),
          set: (path, value) => {
            const target = reference(path);
            if (INTENT_PATH.test(path)) checkedIntent(value, path);
            sdkCall(() => transaction.set(target, value));
          },
        });
        requireRuntime(); return value;
      }, { maxAttempts: 5 }));
      requireRuntime(); return result;
    };
    const repository = createJournaledCloudPatientRepository({
      authorizeOwner,
      readRecord: async path => {
        requireRuntime();
        if (typeof path !== 'string' || !(PROFILE_PATH.test(path) || patientFilePath(path))) {
          throw new CloudPatientError('invalid');
        }
        const snapshot = await sdkAwait(() => store.getDoc(reference(path)));
        return readSnapshot(path, snapshot);
      },
      listRecordsPage: (afterId, count) => page(afterId, count),
      findRecordsByPhone: (phoneKey, afterId, count) => page(afterId, count, phoneKey),
      runTransaction,
    });
    const intentPage = async (kind: CloudOperationKind, actorUid: string, afterId: string | null, count: number, preparedOnly: boolean) => {
      patientKind(kind);
      if (actorUid !== uid || afterId !== null && (typeof afterId !== 'string' || !UUID_ID.test(afterId))
        || !Number.isSafeInteger(count) || count < 1 || count > 50) throw new CloudOperationIntentError('invalid');
      const constraints: QueryConstraint[] = [sdkCall(() => store.where('actorUid', '==', uid)),
        sdkCall(() => store.where('kind', '==', 'patient-profile'))];
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
    const journalRepository = createCloudOperationIntentRepository({ authorizeOwner, runTransaction,
      readRecord: async path => {
        requireRuntime();
        if (typeof path !== 'string' || !INTENT_PATH.test(path)) throw new CloudOperationIntentError('invalid');
        return readSnapshot(path, await sdkAwait(() => store.getDoc(reference(path))));
      },
      listPreparedPage: (kind, actorUid, afterId, count) => intentPage(kind, actorUid, afterId, count, true),
      listHistoryPage: (kind, actorUid, afterId, count) => intentPage(kind, actorUid, afterId, count, false),
    });
    const journal = Object.freeze({
      prepare: (async (kind, input, createdAt) => {
        patientKind(kind);
        let command;
        try { command = prepareCloudPatientCommand(input); }
        catch { throw new CloudOperationIntentError('invalid'); }
        return checkedIntent(await journalRepository.prepare(kind, command, createdAt));
      }) as typeof journalRepository.prepare,
      get: (async id => {
        const result = await journalRepository.get(id); return result === null ? null : checkedIntent(result);
      }) as typeof journalRepository.get,
      listPreparedPage: (async (kind, input) => {
        patientKind(kind); const result = await journalRepository.listPreparedPage(kind, input);
        return { records: result.records.map(intent => checkedIntent(intent)), nextAfterId: result.nextAfterId };
      }) as typeof journalRepository.listPreparedPage,
      listHistoryPage: (async (kind, input) => {
        patientKind(kind); const result = await journalRepository.listHistoryPage(kind, input);
        return { records: result.records.map(intent => checkedIntent(intent)), nextAfterId: result.nextAfterId };
      }) as typeof journalRepository.listHistoryPage,
      cancel: (async id => checkedIntent(await journalRepository.cancel(id))) as typeof journalRepository.cancel,
    });
    requireRuntime(); return Object.freeze({ ...Object.freeze(repository), journal });
  } catch {
    // Fixed safe error: never return provider details, tokens or patient input.
    throw new CloudPatientError('unavailable');
  }
}
