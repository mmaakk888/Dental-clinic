import type { Auth } from 'firebase/auth';
import type { QueryConstraint, DocumentSnapshot, Transaction } from 'firebase/firestore/lite';
import { assessCloudOwnerIdentity, CLOUD_PROJECT_ID } from './cloudIdentity';
import { assessCloudOwnerMembership } from './cloudMembership';
import { isLocalClinicHost } from './localRuntime';
import { CloudClinicalError, createCloudClinicalRepository, prepareCloudClinicalCommand, type CloudClinicalTransaction } from './cloudClinicalRepository';
import { CloudOperationIntentError, createCloudOperationIntentRepository, prepareCloudIntentCommand, parseCloudOperationIntent,
  type CloudOperationIntent, type CloudOperationKind } from './cloudOperationIntent';
import type { CloudClinicalCapability } from './cloudClinicalWorkspaceController';

/** Explicit preparation capability, NOT permission to enable the cloud UI or Rules. */
export interface FirebaseCloudClinicalOptions { isActive: () => boolean }

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const END = '(?![\\s\\S])';
const ID = new RegExp(`^${UUID}${END}`);
const APP = new RegExp(`^clinic-operating-${UUID}${END}`);
const PROFILE = new RegExp(`^clinics/main/patientProfiles/${UUID}${END}`);
const FILE = /^clinics\/main\/patientFiles\/([1-9][0-9]{0,9})(?![\s\S])/;
const ACCOUNT = new RegExp(`^clinics/main/patientAccounts/${UUID}${END}`);
const SESSION = new RegExp(`^clinics/main/patientSessions/${UUID}${END}`);
const RECEIPT = new RegExp(`^clinics/main/patientReceipts/${UUID}${END}`);
const OPERATION = new RegExp(`^clinics/main/clinicalOperations/${UUID}${END}`);
const INTENT = new RegExp(`^clinics/main/operationIntents/${UUID}${END}`);
const filePath = (path: string) => { const match = FILE.exec(path); return !!match && Number(match[1]) <= 2_000_000_000; };
const clinicalKind = (kind: CloudOperationKind) => { if (kind !== 'clinical') throw new CloudOperationIntentError('invalid'); };

export async function createFirebaseCloudClinical(auth: Auth, options: FirebaseCloudClinicalOptions): Promise<CloudClinicalCapability> {
  let revoked = false;
  let user: Auth['currentUser'], app: Auth['app'], uid: string | undefined;
  try { user = auth?.currentUser; app = auth?.app; uid = user?.uid; }
  catch { throw new CloudClinicalError('unavailable'); }
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
      throw new CloudClinicalError('unavailable');
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
      const command = prepareCloudClinicalCommand(intent.command);
      if (intent.kind !== 'clinical' || intent.actorUid !== uid || command.createdAt !== intent.createdAt
        || path !== undefined && path !== `clinics/main/operationIntents/${intent.operationId}`
        || JSON.stringify(prepareCloudIntentCommand(command)) !== JSON.stringify(intent.command)) throw new Error();
    } catch { throw new CloudOperationIntentError('invalid'); }
    requireRuntime(); return intent;
  };
  try {
    requireRuntime();
    const [sdk, store] = await Promise.all([import('firebase/auth'), import('firebase/firestore/lite')]);
    requireRuntime();
    // Named operating Auth only; Lite provides no offline write queue/cache fallback.
    const database = sdkCall(() => store.getFirestore(auth.app, '(default)'));
    const authorizeOwner = async () => {
      requireRuntime();
      const token = await sdkAwait(() => sdk.getIdTokenResult(user!));
      const identity = sdkCall(() => assessCloudOwnerIdentity({ uid: user!.uid, email: user!.email,
        emailVerified: user!.emailVerified, token }));
      if (identity.status !== 'owner-confirmed') throw new CloudClinicalError('unavailable');
      const authTime = sdkCall(() => Object.getOwnPropertyDescriptor(token.claims, 'auth_time')?.value);
      const reference = sdkCall(() => store.doc(database, 'clinics', 'main', 'members', identity.uid));
      const snapshot = await sdkAwait(() => store.getDoc(reference));
      if (!sdkCall(() => snapshot.exists())) throw new CloudClinicalError('unavailable');
      const member = sdkCall(() => snapshot.data());
      sdkCall(() => assessCloudOwnerMembership(identity, member, authTime));
      requireRuntime(); return identity.uid;
    };
    const reference = (path: string, write = false) => {
      requireRuntime();
      if (typeof path !== 'string' || !(ACCOUNT.test(path) || SESSION.test(path) || RECEIPT.test(path)
        || OPERATION.test(path) || INTENT.test(path) || !write && (PROFILE.test(path) || filePath(path)))) {
        throw new CloudClinicalError('invalid');
      }
      return sdkCall(() => store.doc(database, path));
    };
    const readSnapshot = (path: string, snapshot: DocumentSnapshot) => {
      const value = sdkCall(() => snapshot.exists()) ? sdkCall(() => snapshot.data()) : null;
      // This capability never recovers/changes a contact or profile intent.
      if (value !== null && INTENT.test(path)) return checkedIntent(value, path);
      requireRuntime(); return value;
    };
    const readRecord = async (path: string) => {
      requireRuntime();
      if (typeof path !== 'string' || !(PROFILE.test(path) || filePath(path) || ACCOUNT.test(path)
        || SESSION.test(path) || INTENT.test(path))) throw new CloudClinicalError('invalid');
      return readSnapshot(path, await sdkAwait(() => store.getDoc(reference(path))));
    };
    const runTransaction = async <T>(work: (transaction: CloudClinicalTransaction) => Promise<T>): Promise<T> => {
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
    const page = async (collectionName: 'patientSessions' | 'patientReceipts' | 'operationIntents',
      patientId: string | null, afterId: string | null, count: number) => {
      requireRuntime();
      if (afterId !== null && (typeof afterId !== 'string' || !ID.test(afterId))
        || !Number.isSafeInteger(count) || count < 1 || count > 50
        || collectionName !== 'operationIntents' && (typeof patientId !== 'string' || !ID.test(patientId))) {
        throw new CloudClinicalError('invalid');
      }
      const constraints: QueryConstraint[] = [];
      if (collectionName === 'operationIntents') {
        constraints.push(sdkCall(() => store.where('actorUid', '==', uid)));
        constraints.push(sdkCall(() => store.where('kind', '==', 'clinical')));
        constraints.push(sdkCall(() => store.where('status', '==', 'prepared')));
      } else constraints.push(sdkCall(() => store.where('patientId', '==', patientId)));
      constraints.push(sdkCall(() => store.orderBy(sdkCall(() => store.documentId()))));
      if (afterId !== null) constraints.push(sdkCall(() => store.startAfter(afterId)));
      constraints.push(sdkCall(() => store.limit(count)));
      const collection = sdkCall(() => store.collection(database, 'clinics', 'main', collectionName));
      const query = sdkCall(() => store.query(collection, ...constraints));
      const snapshot = await sdkAwait(() => store.getDocs(query));
      const documents = sdkCall(() => snapshot.docs);
      const rows = documents.map(document => ({ id: sdkCall(() => document.id), data: sdkCall(() => document.data()) }));
      requireRuntime(); return rows;
    };
    const repository = createCloudClinicalRepository({ authorizeOwner, runTransaction,
      readRecord: path => {
        if (typeof path !== 'string' || INTENT.test(path)) throw new CloudClinicalError('invalid');
        return readRecord(path);
      },
      listSessionsPage: (patientId, afterId, count) => page('patientSessions', patientId, afterId, count),
      listReceiptsPage: (patientId, afterId, count) => page('patientReceipts', patientId, afterId, count),
    });
    const journalRepository = createCloudOperationIntentRepository({ authorizeOwner, runTransaction,
      readRecord: path => {
        if (typeof path !== 'string' || !INTENT.test(path)) throw new CloudOperationIntentError('invalid');
        return readRecord(path);
      },
      listPreparedPage: (kind, actorUid, afterId, count) => {
        clinicalKind(kind); requireRuntime();
        if (actorUid !== uid) throw new CloudOperationIntentError('invalid');
        return page('operationIntents', null, afterId, count);
      },
    });
    const journal = Object.freeze({
      prepare: (async (kind, input, createdAt) => {
        clinicalKind(kind);
        let command;
        try { command = prepareCloudClinicalCommand(input); }
        catch { throw new CloudOperationIntentError('invalid'); }
        if (createdAt !== command.createdAt) throw new CloudOperationIntentError('invalid');
        return checkedIntent(await journalRepository.prepare(kind, command, createdAt));
      }) as typeof journalRepository.prepare,
      get: (async id => {
        const result = await journalRepository.get(id);
        return result === null ? null : checkedIntent(result);
      }) as typeof journalRepository.get,
      listPreparedPage: (async (kind, input) => {
        clinicalKind(kind);
        const result = await journalRepository.listPreparedPage(kind, input);
        return { records: result.records.map(intent => checkedIntent(intent)), nextAfterId: result.nextAfterId };
      }) as typeof journalRepository.listPreparedPage,
      cancel: (async id => checkedIntent(await journalRepository.cancel(id))) as typeof journalRepository.cancel,
    });
    requireRuntime(); return Object.freeze({ repository: Object.freeze(repository), journal });
  } catch {
    throw new CloudClinicalError('unavailable');
  }
}
