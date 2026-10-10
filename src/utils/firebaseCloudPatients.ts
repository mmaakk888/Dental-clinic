import type { Auth } from 'firebase/auth';
import type { QueryConstraint } from 'firebase/firestore/lite';
import { assessCloudOwnerIdentity, CLOUD_PROJECT_ID } from './cloudIdentity';
import { assessCloudOwnerMembership } from './cloudMembership';
import { createCloudPatientRepository, CloudPatientError } from './cloudPatientRepository';
import { isLocalClinicHost } from './localRuntime';

/** Prepared explicit Auth capability only: no UI, live Rules or Hosting activation. */
export interface FirebaseCloudPatientsOptions { isActive?: () => boolean }

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
// Absolute end, not JS `$` (which also matches before a trailing newline).
const END = '(?![\\s\\S])';
const OPERATING_APP = new RegExp(`^clinic-operating-${UUID}${END}`);
const PROFILE_PATH = new RegExp(`^clinics/main/patientProfiles/${UUID}${END}`);
const OPERATION_PATH = new RegExp(`^clinics/main/patientOperations/${UUID}${END}`);
const FILE_PATH = /^clinics\/main\/patientFiles\/([1-9][0-9]{0,9})(?![\s\S])/;
const COUNTER_PATH = 'clinics/main/counters/patientFiles';
const HASH = /^[0-9a-f]{64}(?![\s\S])/;
const UUID_ID = new RegExp(`^${UUID}${END}`);

function patientFilePath(path: string) {
  const match = FILE_PATH.exec(path);
  return !!match && Number(match[1]) <= 2_000_000_000;
}

export async function createFirebaseCloudPatients(auth: Auth, options: FirebaseCloudPatientsOptions = {}) {
  const requireRuntime = () => {
    if (options.isActive && options.isActive() !== true
      || typeof window === 'undefined' || !isLocalClinicHost(window.location.hostname)
      || !auth || auth.app.options.projectId !== CLOUD_PROJECT_ID
      || auth.app.options.authDomain !== `${CLOUD_PROJECT_ID}.firebaseapp.com`
      || !OPERATING_APP.test(auth.app.name) || auth.emulatorConfig) {
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
    const result = await pending;
    requireRuntime();
    return result;
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
      const user = auth.currentUser;
      if (!user) throw new CloudPatientError('unavailable');
      const requireSameUser = () => {
        requireRuntime();
        if (auth.currentUser !== user) throw new CloudPatientError('unavailable');
      };
      const token = await sdkAwait(() => sdk.getIdTokenResult(user));
      requireSameUser();
      const identity = assessCloudOwnerIdentity({ uid: user.uid, email: user.email,
        emailVerified: user.emailVerified, token });
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
      if (typeof path !== 'string' || !(PROFILE_PATH.test(path) || OPERATION_PATH.test(path)
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
      const rows = snapshot.docs.map(document => {
        requireRuntime();
        const id = document.id;
        const data = sdkCall(() => document.data());
        requireRuntime();
        return { id, data };
      });
      requireRuntime();
      return rows;
    };
    return createCloudPatientRepository({
      authorizeOwner,
      readRecord: async path => {
        requireRuntime();
        if (typeof path !== 'string' || !(PROFILE_PATH.test(path) || patientFilePath(path))) {
          throw new CloudPatientError('invalid');
        }
        const snapshot = await sdkAwait(() => store.getDoc(reference(path)));
        const exists = sdkCall(() => snapshot.exists());
        const value = exists ? sdkCall(() => snapshot.data()) : null;
        requireRuntime();
        return value;
      },
      listRecordsPage: (afterId, count) => page(afterId, count),
      findRecordsByPhone: (phoneKey, afterId, count) => page(afterId, count, phoneKey),
      runTransaction: async work => {
        const result = await sdkAwait(() => store.runTransaction(database, async transaction => {
          requireRuntime();
          const value = await work({
            get: async path => {
              const snapshot = await sdkAwait(() => transaction.get(reference(path)));
              const exists = sdkCall(() => snapshot.exists());
              const data = exists ? sdkCall(() => snapshot.data()) : null;
              requireRuntime();
              return data;
            },
            set: (path, value) => { sdkCall(() => transaction.set(reference(path), value)); },
          });
          requireRuntime();
          return value;
        }, { maxAttempts: 5 }));
        requireRuntime();
        return result;
      },
    });
  } catch {
    // Fixed safe error: never return provider details, tokens or patient input.
    throw new CloudPatientError('unavailable');
  }
}
