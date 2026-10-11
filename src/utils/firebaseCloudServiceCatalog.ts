import type { Auth } from 'firebase/auth';
import type { QueryConstraint, DocumentSnapshot, Transaction } from 'firebase/firestore/lite';
import { assessCloudOwnerIdentity, CLOUD_PROJECT_ID } from './cloudIdentity';
import { assessCloudOwnerMembership } from './cloudMembership';
import { isLocalClinicHost } from './localRuntime';
import { CloudServiceCatalogError, createCloudServiceCatalogRepository, prepareCloudServiceCatalogCommand,
  type CloudServiceCatalogRepository, type CloudServiceCatalogTransaction } from './cloudServiceCatalogRepository';
import { CloudOperationIntentError, createCloudOperationIntentRepository, parseCloudOperationIntent, prepareCloudIntentCommand,
  type CloudOperationIntent, type CloudOperationIntentRepository, type CloudOperationKind } from './cloudOperationIntent';

/** Explicit preparation capability; importing or constructing it does not activate cloud settings. */
export interface FirebaseCloudServiceCatalogOptions { isActive: () => boolean }
export interface FirebaseCloudServiceCatalogCapability {
  repository: CloudServiceCatalogRepository;
  journal: CloudOperationIntentRepository;
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const END = '(?![\\s\\S])';
const ID = new RegExp(`^${UUID}${END}`);
const APP = new RegExp(`^clinic-operating-${UUID}${END}`);
const CATALOG = 'clinics/main/settings/serviceCatalog';
const OPERATION = new RegExp(`^clinics/main/catalogOperations/${UUID}${END}`);
const INTENT = new RegExp(`^clinics/main/operationIntents/${UUID}${END}`);
const catalogKind = (kind: CloudOperationKind) => { if (kind !== 'catalog') throw new CloudOperationIntentError('invalid'); };

export async function createFirebaseCloudServiceCatalog(auth: Auth,
  options: FirebaseCloudServiceCatalogOptions): Promise<FirebaseCloudServiceCatalogCapability> {
  let revoked = false;
  let user: Auth['currentUser'], app: Auth['app'], uid: string | undefined;
  try { user = auth?.currentUser; app = auth?.app; uid = user?.uid; }
  catch { throw new CloudServiceCatalogError('unavailable'); }
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
      throw new CloudServiceCatalogError('unavailable');
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
      const command = prepareCloudServiceCatalogCommand(intent.command);
      if (intent.kind !== 'catalog' || intent.actorUid !== uid || command.createdAt !== intent.createdAt
        || path !== undefined && path !== `clinics/main/operationIntents/${intent.operationId}`
        || JSON.stringify(prepareCloudIntentCommand(command)) !== JSON.stringify(intent.command)) throw new Error();
    } catch { throw new CloudOperationIntentError('invalid'); }
    requireRuntime(); return intent;
  };
  try {
    requireRuntime();
    const [sdk, store] = await Promise.all([import('firebase/auth'), import('firebase/firestore/lite')]);
    requireRuntime();
    // Named operating Auth only. Lite has no offline writes or cached-data fallback.
    const database = sdkCall(() => store.getFirestore(auth.app, '(default)'));
    const authorizeOwner = async () => {
      requireRuntime();
      const token = await sdkAwait(() => sdk.getIdTokenResult(user!));
      const identity = sdkCall(() => assessCloudOwnerIdentity({ uid: user!.uid, email: user!.email,
        emailVerified: user!.emailVerified, token }));
      if (identity.status !== 'owner-confirmed') throw new CloudServiceCatalogError('unavailable');
      const authTime = sdkCall(() => Object.getOwnPropertyDescriptor(token.claims, 'auth_time')?.value);
      const reference = sdkCall(() => store.doc(database, 'clinics', 'main', 'members', identity.uid));
      const snapshot = await sdkAwait(() => store.getDoc(reference));
      if (!sdkCall(() => snapshot.exists())) throw new CloudServiceCatalogError('unavailable');
      const member = sdkCall(() => snapshot.data());
      sdkCall(() => assessCloudOwnerMembership(identity, member, authTime));
      requireRuntime(); return identity.uid;
    };
    const reference = (path: string) => {
      requireRuntime();
      if (typeof path !== 'string' || !(path === CATALOG || OPERATION.test(path) || INTENT.test(path))) {
        throw new CloudServiceCatalogError('invalid');
      }
      return sdkCall(() => store.doc(database, path));
    };
    const readSnapshot = (path: string, snapshot: DocumentSnapshot) => {
      const value = sdkCall(() => snapshot.exists()) ? sdkCall(() => snapshot.data()) : null;
      // The common journal never grants access to another domain's commands.
      if (value !== null && INTENT.test(path)) return checkedIntent(value, path);
      requireRuntime(); return value;
    };
    const readRecord = async (path: string) => {
      requireRuntime();
      if (typeof path !== 'string' || !(path === CATALOG || INTENT.test(path))) throw new CloudServiceCatalogError('invalid');
      return readSnapshot(path, await sdkAwait(() => store.getDoc(reference(path))));
    };
    const runTransaction = async <T>(work: (transaction: CloudServiceCatalogTransaction) => Promise<T>): Promise<T> => {
      const result = await sdkAwait(() => store.runTransaction(database, async (transaction: Transaction) => {
        requireRuntime();
        const result = await work({
          get: async path => readSnapshot(path, await sdkAwait(() => transaction.get(reference(path)))),
          set: (path, value) => {
            const target = reference(path);
            // Validate the complete command before changing even its status during cancellation.
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
        sdkCall(() => store.where('kind', '==', 'catalog')),
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
    const repository = createCloudServiceCatalogRepository({ authorizeOwner, runTransaction,
      readRecord: path => {
        if (path !== CATALOG) throw new CloudServiceCatalogError('invalid');
        return readRecord(path);
      },
    });
    const journalRepository = createCloudOperationIntentRepository({ authorizeOwner, runTransaction,
      readRecord: path => {
        if (typeof path !== 'string' || !INTENT.test(path)) throw new CloudOperationIntentError('invalid');
        return readRecord(path);
      },
      listPreparedPage: (kind, actorUid, afterId, count) => { catalogKind(kind); return page(actorUid, afterId, count, true); },
      listHistoryPage: (kind, actorUid, afterId, count) => { catalogKind(kind); return page(actorUid, afterId, count, false); },
    });
    const journal = Object.freeze({
      prepare: (async (kind, input, createdAt) => {
        catalogKind(kind);
        let command;
        try { command = prepareCloudServiceCatalogCommand(input); }
        catch { throw new CloudOperationIntentError('invalid'); }
        if (createdAt !== command.createdAt) throw new CloudOperationIntentError('invalid');
        return checkedIntent(await journalRepository.prepare(kind, command, createdAt));
      }) as typeof journalRepository.prepare,
      get: (async id => {
        const result = await journalRepository.get(id);
        return result === null ? null : checkedIntent(result);
      }) as typeof journalRepository.get,
      listPreparedPage: (async (kind, input) => {
        catalogKind(kind);
        const result = await journalRepository.listPreparedPage(kind, input);
        return { records: result.records.map(intent => checkedIntent(intent)), nextAfterId: result.nextAfterId };
      }) as typeof journalRepository.listPreparedPage,
      listHistoryPage: (async (kind, input) => {
        catalogKind(kind);
        const result = await journalRepository.listHistoryPage(kind, input);
        return { records: result.records.map(intent => checkedIntent(intent)), nextAfterId: result.nextAfterId };
      }) as typeof journalRepository.listHistoryPage,
      cancel: (async id => checkedIntent(await journalRepository.cancel(id))) as typeof journalRepository.cancel,
    });
    requireRuntime(); return Object.freeze({ repository: Object.freeze(repository), journal });
  } catch {
    throw new CloudServiceCatalogError('unavailable');
  }
}
