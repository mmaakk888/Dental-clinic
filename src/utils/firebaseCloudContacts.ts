import type { Auth } from 'firebase/auth';
import type { QueryConstraint, DocumentSnapshot, Transaction } from 'firebase/firestore/lite';
import { assessCloudOwnerIdentity, CLOUD_PROJECT_ID } from './cloudIdentity';
import { assessCloudOwnerMembership } from './cloudMembership';
import { createJournaledCloudContactRepository, prepareCloudContactCommand, CloudContactError,
  type CloudContactTransaction, type CloudContactRepository } from './cloudContactRepository';
import { createCloudOperationIntentRepository, parseCloudOperationIntent, prepareCloudIntentCommand,
  CloudOperationIntentError, type CloudOperationIntent, type CloudOperationIntentRepository,
  type CloudOperationKind } from './cloudOperationIntent';
import { isLocalClinicHost } from './localRuntime';

/** Source preparation only. Existing live Rules deny this entire domain.
 * The caller owns the isolated operating Auth app and its lifetime. */
export interface FirebaseCloudContactsOptions { isActive?: () => boolean }
export type FirebaseCloudContactsCapability = CloudContactRepository & { readonly journal: CloudOperationIntentRepository };

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const END = '(?![\\s\\S])';
const ID = new RegExp(`^${UUID}${END}`);
const APP = new RegExp(`^clinic-operating-${UUID}${END}`);
const RECORD = new RegExp(`^clinics/main/contactRecords/${UUID}${END}`);
const OPERATION = new RegExp(`^clinics/main/contactOperations/${UUID}${END}`);
const PHONE = /^clinics\/main\/contactPhones\/[0-9a-f]{64}(?![\s\S])/;
const INTENT = new RegExp(`^clinics/main/operationIntents/${UUID}${END}`);
const contactKind = (kind: CloudOperationKind) => { if (kind !== 'contact') throw new CloudOperationIntentError('invalid'); };

export async function createFirebaseCloudContacts(auth: Auth, options: FirebaseCloudContactsOptions = {}): Promise<FirebaseCloudContactsCapability> {
  let revoked = false;
  let user: Auth['currentUser'], app: Auth['app'], uid: string | undefined;
  try { user = auth?.currentUser; app = auth?.app; uid = user?.uid; }
  catch { throw new CloudContactError('unavailable'); }
  const requireRuntime = () => {
    try {
      if (revoked || options.isActive && options.isActive() !== true
        || typeof window === 'undefined' || !isLocalClinicHost(window.location.hostname)
        || !auth || !user || typeof uid !== 'string' || !uid || auth.currentUser !== user || user.uid !== uid || auth.app !== app
        || auth.app.options.projectId !== CLOUD_PROJECT_ID
        || auth.app.options.authDomain !== `${CLOUD_PROJECT_ID}.firebaseapp.com`
        || !APP.test(auth.app.name) || auth.emulatorConfig) throw new Error();
    } catch { revoked = true; throw new CloudContactError('unavailable'); }
  };
  const sdkCall = <T>(work: () => T): T => { requireRuntime(); const result = work(); requireRuntime(); return result; };
  const sdkAwait = async <T>(work: () => Promise<T>): Promise<T> => {
    requireRuntime(); const pending = work();
    try { requireRuntime(); } catch (error) { void pending.catch(() => undefined); throw error; }
    try { const result = await pending; requireRuntime(); return result; }
    catch (error) { requireRuntime(); throw error; }
  };
  // Run BEFORE generic cancellation can stage a write, not merely after return.
  // Contact commands have no operation timestamp: journal createdAt is separate.
  const checkedIntent = (value: unknown, path?: string): CloudOperationIntent => {
    requireRuntime();
    let intent: CloudOperationIntent;
    try {
      intent = parseCloudOperationIntent(value);
      const command = prepareCloudContactCommand(intent.command);
      if (intent.kind !== 'contact' || intent.actorUid !== uid
        || path !== undefined && path !== `clinics/main/operationIntents/${intent.operationId}`
        || JSON.stringify(prepareCloudIntentCommand(command)) !== JSON.stringify(intent.command)) throw new Error();
    } catch { throw new CloudOperationIntentError('invalid'); }
    requireRuntime(); return intent;
  };
  try {
    requireRuntime();
    const [sdk, store] = await Promise.all([import('firebase/auth'), import('firebase/firestore/lite')]);
    requireRuntime();
    // Named operating app and Lite: no default app or offline enqueue fallback.
    const database = sdkCall(() => store.getFirestore(auth.app, '(default)'));
    const authorizeOwner = async () => {
      requireRuntime();
      const token = await sdkAwait(() => sdk.getIdTokenResult(user!));
      const identity = sdkCall(() => assessCloudOwnerIdentity({ uid: user!.uid, email: user!.email,
        emailVerified: user!.emailVerified, token }));
      if (identity.status !== 'owner-confirmed') throw new CloudContactError('unavailable');
      const authTime = sdkCall(() => Object.getOwnPropertyDescriptor(token.claims, 'auth_time')?.value);
      const target = sdkCall(() => store.doc(database, 'clinics', 'main', 'members', identity.uid));
      const snapshot = await sdkAwait(() => store.getDoc(target));
      if (!sdkCall(() => snapshot.exists())) throw new CloudContactError('unavailable');
      const member = sdkCall(() => snapshot.data());
      sdkCall(() => assessCloudOwnerMembership(identity, member, authTime));
      requireRuntime(); return identity.uid;
    };
    const reference = (path: string) => {
      requireRuntime();
      if (typeof path !== 'string' || !(RECORD.test(path) || OPERATION.test(path) || PHONE.test(path) || INTENT.test(path))) {
        throw new CloudContactError('invalid');
      }
      return sdkCall(() => store.doc(database, path));
    };
    const readSnapshot = (path: string, snapshot: DocumentSnapshot) => {
      const value = sdkCall(() => snapshot.exists()) ? sdkCall(() => snapshot.data()) : null;
      if (value !== null && INTENT.test(path)) return checkedIntent(value, path);
      requireRuntime(); return value;
    };
    const readRecord = async (path: string) => {
      requireRuntime();
      if (typeof path !== 'string' || !(RECORD.test(path) || INTENT.test(path))) throw new CloudContactError('invalid');
      return readSnapshot(path, await sdkAwait(() => store.getDoc(reference(path))));
    };
    const runTransaction = async <T>(work: (transaction: CloudContactTransaction) => Promise<T>): Promise<T> => {
      const result = await sdkAwait(() => store.runTransaction(database, async (transaction: Transaction) => {
        requireRuntime();
        const result = await work({
          get: async path => readSnapshot(path, await sdkAwait(() => transaction.get(reference(path)))),
          set: (path, value) => {
            const target = reference(path);
            if (INTENT.test(path)) checkedIntent(value, path);
            sdkCall(() => transaction.set(target, value));
          },
          delete: path => {
            requireRuntime();
            if (typeof path !== 'string' || !PHONE.test(path)) throw new CloudContactError('invalid');
            sdkCall(() => transaction.delete(reference(path)));
          },
        });
        requireRuntime(); return result;
      }, { maxAttempts: 5 }));
      requireRuntime(); return result;
    };
    const page = async (collectionName: 'contactRecords' | 'operationIntents', afterId: string | null, count: number, preparedOnly = true) => {
      requireRuntime();
      if (afterId !== null && (typeof afterId !== 'string' || !ID.test(afterId))
        || !Number.isSafeInteger(count) || count < 1 || count > 50) throw new CloudContactError('invalid');
      const constraints: QueryConstraint[] = [];
      if (collectionName === 'operationIntents') {
        constraints.push(sdkCall(() => store.where('actorUid', '==', uid)));
        constraints.push(sdkCall(() => store.where('kind', '==', 'contact')));
        if (preparedOnly) constraints.push(sdkCall(() => store.where('status', '==', 'prepared')));
      }
      constraints.push(sdkCall(() => store.orderBy(sdkCall(() => store.documentId()))));
      if (afterId !== null) constraints.push(sdkCall(() => store.startAfter(afterId)));
      constraints.push(sdkCall(() => store.limit(count)));
      const target = sdkCall(() => store.collection(database, 'clinics', 'main', collectionName));
      const query = sdkCall(() => store.query(target, ...constraints));
      const snapshot = await sdkAwait(() => store.getDocs(query));
      const documents = sdkCall(() => snapshot.docs);
      const rows = documents.map(document => ({ id: sdkCall(() => document.id), data: sdkCall(() => document.data()) }));
      requireRuntime(); return rows;
    };
    const repository = createJournaledCloudContactRepository({ authorizeOwner, runTransaction,
      readRecord: path => {
        if (typeof path !== 'string' || !RECORD.test(path)) throw new CloudContactError('invalid');
        return readRecord(path);
      },
      listRecordsPage: (afterId, count) => page('contactRecords', afterId, count),
    });
    const journalRepository = createCloudOperationIntentRepository({ authorizeOwner, runTransaction,
      readRecord: path => {
        if (typeof path !== 'string' || !INTENT.test(path)) throw new CloudOperationIntentError('invalid');
        return readRecord(path);
      },
      listPreparedPage: (kind, actorUid, afterId, count) => {
        contactKind(kind); requireRuntime();
        if (actorUid !== uid) throw new CloudOperationIntentError('invalid');
        return page('operationIntents', afterId, count);
      },
      listHistoryPage: (kind, actorUid, afterId, count) => {
        contactKind(kind); requireRuntime();
        if (actorUid !== uid) throw new CloudOperationIntentError('invalid');
        return page('operationIntents', afterId, count, false);
      },
    });
    const journal = Object.freeze({
      prepare: (async (kind, input, createdAt) => {
        requireRuntime(); contactKind(kind);
        let command;
        try { command = prepareCloudContactCommand(input); }
        catch { throw new CloudOperationIntentError('invalid'); }
        return checkedIntent(await journalRepository.prepare(kind, command, createdAt));
      }) as typeof journalRepository.prepare,
      get: (async id => {
        const result = await journalRepository.get(id);
        return result === null ? null : checkedIntent(result);
      }) as typeof journalRepository.get,
      listPreparedPage: (async (kind, input) => {
        requireRuntime(); contactKind(kind);
        const result = await journalRepository.listPreparedPage(kind, input);
        return { records: result.records.map(intent => checkedIntent(intent)), nextAfterId: result.nextAfterId };
      }) as typeof journalRepository.listPreparedPage,
      listHistoryPage: (async (kind, input) => {
        requireRuntime(); contactKind(kind);
        const result = await journalRepository.listHistoryPage(kind, input);
        return { records: result.records.map(intent => checkedIntent(intent)), nextAfterId: result.nextAfterId };
      }) as typeof journalRepository.listHistoryPage,
      cancel: (async id => checkedIntent(await journalRepository.cancel(id))) as typeof journalRepository.cancel,
    });
    requireRuntime(); return Object.freeze({ ...repository, journal });
  } catch {
    // Never expose provider errors, credentials or account/contact payloads.
    throw new CloudContactError('unavailable');
  }
}
