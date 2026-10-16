import type { Auth } from 'firebase/auth';
import type { DocumentSnapshot, QueryConstraint, Transaction } from 'firebase/firestore/lite';
import { assessCloudOwnerIdentity, CLOUD_PROJECT_ID } from './cloudIdentity';
import { assessCloudOwnerMembership } from './cloudMembership';
import { isCloudOperatingRuntime } from './cloudOperatingRuntime';
import { CLOUD_CLINIC_SETTINGS_PATH, CLOUD_CLINIC_LOGO_PATH, CLOUD_PROSTHETIC_ROUTING_PATH,
  CloudClinicSettingsError, createCloudClinicSettingsRepository, prepareCloudClinicSettingsCommand,
  parseCloudClinicSettingsRecord, parseCloudClinicLogoRecord, parseCloudProstheticRouting, parseCloudLabDefinition,
  type CloudClinicSettingsRepository, type CloudClinicSettingsTransaction } from './cloudClinicSettingsRepository';
import { CloudOperationIntentError, createCloudOperationIntentRepository, parseCloudOperationIntent, prepareCloudIntentCommand,
  type CloudOperationIntent, type CloudOperationIntentRepository, type CloudOperationKind } from './cloudOperationIntent';

/** Explicit owner capability. Construction is not UI activation or provider configuration. */
export interface FirebaseCloudClinicSettingsOptions { isActive: () => boolean }
export interface FirebaseCloudClinicSettingsCapability {
  repository: CloudClinicSettingsRepository; journal: CloudOperationIntentRepository;
}
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const END = '(?![\\s\\S])';
const ID = new RegExp(`^${UUID}${END}`), APP = new RegExp(`^clinic-operating-${UUID}${END}`);
const LAB = new RegExp(`^clinics/main/labDefinitions/(${UUID})${END}`);
const OPERATION = new RegExp(`^clinics/main/settingsOperations/${UUID}${END}`);
const INTENT = new RegExp(`^clinics/main/operationIntents/${UUID}${END}`);
const PROOF = new RegExp(`^clinics/main/settingsValidationProofs/${UUID}-((scalar|routes)(-shape)?|(medications|costs)-unique-(ids|names)|routes-unique-ids|routing-refs-shape|(medications|templates|costs)(-(shape|text))?|dependencies)-[0-4]-([0-9]|[1-9][0-9]|[12][0-9][0-9])${END}`);
const CATALOG = 'clinics/main/settings/serviceCatalog';
const domain = (path: string) => path === CLOUD_CLINIC_SETTINGS_PATH || path === CLOUD_CLINIC_LOGO_PATH || path === CLOUD_PROSTHETIC_ROUTING_PATH || LAB.test(path);
const settingsKind = (kind: CloudOperationKind) => { if (kind !== 'settings') throw new CloudOperationIntentError('invalid'); };

export async function createFirebaseCloudClinicSettings(auth: Auth,
  options: FirebaseCloudClinicSettingsOptions): Promise<FirebaseCloudClinicSettingsCapability> {
  let revoked = false;
  let user: Auth['currentUser'], app: Auth['app'], uid: string | undefined;
  try { user = auth?.currentUser; app = auth?.app; uid = user?.uid; } catch { throw new CloudClinicSettingsError('unavailable'); }
  const requireRuntime = () => {
    try {
      if (revoked || !options || typeof options.isActive !== 'function' || options.isActive() !== true
        || typeof window === 'undefined' || !isCloudOperatingRuntime(window.location.hostname, window.location.protocol)
        || !auth || !user || typeof uid !== 'string' || !uid || auth.currentUser !== user || user.uid !== uid || auth.app !== app
        || auth.app.options.projectId !== CLOUD_PROJECT_ID || auth.app.options.authDomain !== `${CLOUD_PROJECT_ID}.firebaseapp.com`
        || !APP.test(auth.app.name) || auth.emulatorConfig) throw new Error();
    } catch { revoked = true; throw new CloudClinicSettingsError('unavailable'); }
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
      intent = parseCloudOperationIntent(value); const command = prepareCloudClinicSettingsCommand(intent.command);
      if (intent.kind !== 'settings' || intent.actorUid !== uid || command.createdAt !== intent.createdAt
        || path !== undefined && path !== `clinics/main/operationIntents/${intent.operationId}`
        || JSON.stringify(prepareCloudIntentCommand(command)) !== JSON.stringify(intent.command)) throw new Error();
    } catch { throw new CloudOperationIntentError('invalid'); }
    requireRuntime(); return intent;
  };
  try {
    requireRuntime();
    const [sdk, store] = await Promise.all([import('firebase/auth'), import('firebase/firestore/lite')]); requireRuntime();
    const database = sdkCall(() => store.getFirestore(auth.app, '(default)'));
    const authorizeOwner = async () => {
      requireRuntime(); const token = await sdkAwait(() => sdk.getIdTokenResult(user!));
      const identity = sdkCall(() => assessCloudOwnerIdentity({ uid: user!.uid, email: user!.email, emailVerified: user!.emailVerified, token }));
      if (identity.status !== 'owner-confirmed') throw new CloudClinicSettingsError('unavailable');
      const authTime = sdkCall(() => Object.getOwnPropertyDescriptor(token.claims, 'auth_time')?.value);
      const reference = sdkCall(() => store.doc(database, 'clinics', 'main', 'members', identity.uid));
      const snapshot = await sdkAwait(() => store.getDoc(reference));
      if (!sdkCall(() => snapshot.exists())) throw new CloudClinicSettingsError('unavailable');
      sdkCall(() => assessCloudOwnerMembership(identity, sdkCall(() => snapshot.data()), authTime));
      requireRuntime(); return identity.uid;
    };
    const reference = (path: string, writing = false) => {
      requireRuntime();
      if (typeof path !== 'string' || !(domain(path) || OPERATION.test(path) || INTENT.test(path) || PROOF.test(path) || !writing && path === CATALOG))
        throw new CloudClinicSettingsError('invalid');
      return sdkCall(() => store.doc(database, path));
    };
    const readSnapshot = (path: string, snapshot: DocumentSnapshot) => {
      const value = sdkCall(() => snapshot.exists()) ? sdkCall(() => snapshot.data()) : null;
      if (value !== null && INTENT.test(path)) return checkedIntent(value, path);
      requireRuntime(); return value;
    };
    const readRecord = async (path: string) => {
      if (typeof path !== 'string' || !(domain(path) || INTENT.test(path))) throw new CloudClinicSettingsError('invalid');
      return readSnapshot(path, await sdkAwait(() => store.getDoc(reference(path))));
    };
    const runTransaction = async <T>(work: (transaction: CloudClinicSettingsTransaction) => Promise<T>): Promise<T> => {
      const result = await sdkAwait(() => store.runTransaction(database, async (transaction: Transaction) => {
        requireRuntime();
        const result = await work({
          get: async path => readSnapshot(path, await sdkAwait(() => transaction.get(reference(path)))),
          set: (path, value) => {
            const target = reference(path, true);
            // Every complete journal command is checked during reads too, before cancellation can stage a write.
            if (INTENT.test(path)) checkedIntent(value, path);
            if (path === CLOUD_CLINIC_SETTINGS_PATH) parseCloudClinicSettingsRecord(value);
            else if (path === CLOUD_CLINIC_LOGO_PATH) parseCloudClinicLogoRecord(value);
            else if (path === CLOUD_PROSTHETIC_ROUTING_PATH) parseCloudProstheticRouting(value);
            else if (LAB.test(path)) parseCloudLabDefinition(value, path.split('/').at(-1));
            sdkCall(() => transaction.set(target, value));
          },
        });
        requireRuntime(); return result;
      }, { maxAttempts: 5 }));
      requireRuntime(); return result;
    };
    const labPage = async (afterId: string | null, count: number) => {
      requireRuntime(); if (afterId !== null && (typeof afterId !== 'string' || !ID.test(afterId)) || !Number.isSafeInteger(count) || count < 1 || count > 50)
        throw new CloudClinicSettingsError('invalid');
      const constraints: QueryConstraint[] = [sdkCall(() => store.orderBy(sdkCall(() => store.documentId())))];
      if (afterId !== null) constraints.push(sdkCall(() => store.startAfter(afterId)));
      constraints.push(sdkCall(() => store.limit(count)));
      const collection = sdkCall(() => store.collection(database, 'clinics', 'main', 'labDefinitions'));
      const query = sdkCall(() => store.query(collection, ...constraints));
      const snapshot = await sdkAwait(() => store.getDocs(query)); const documents = sdkCall(() => snapshot.docs);
      const rows = documents.map(document => ({ id: sdkCall(() => document.id), data: sdkCall(() => document.data()) }));
      requireRuntime(); return rows;
    };
    const intentPage = async (actorUid: string, afterId: string | null, count: number, preparedOnly: boolean) => {
      requireRuntime();
      if (actorUid !== uid || afterId !== null && (typeof afterId !== 'string' || !ID.test(afterId))
        || !Number.isSafeInteger(count) || count < 1 || count > 50) throw new CloudOperationIntentError('invalid');
      const constraints: QueryConstraint[] = [sdkCall(() => store.where('actorUid', '==', uid)), sdkCall(() => store.where('kind', '==', 'settings'))];
      if (preparedOnly) constraints.push(sdkCall(() => store.where('status', '==', 'prepared')));
      constraints.push(sdkCall(() => store.orderBy(sdkCall(() => store.documentId()))));
      if (afterId !== null) constraints.push(sdkCall(() => store.startAfter(afterId)));
      constraints.push(sdkCall(() => store.limit(count)));
      const collection = sdkCall(() => store.collection(database, 'clinics', 'main', 'operationIntents'));
      const query = sdkCall(() => store.query(collection, ...constraints));
      const snapshot = await sdkAwait(() => store.getDocs(query)); const documents = sdkCall(() => snapshot.docs);
      const rows = documents.map(document => ({ id: sdkCall(() => document.id), data: sdkCall(() => document.data()) }));
      requireRuntime(); return rows;
    };
    const repository = createCloudClinicSettingsRepository({ authorizeOwner, runTransaction, listLabsPage: labPage,
      readRecord: path => { if (!domain(path)) throw new CloudClinicSettingsError('invalid'); return readRecord(path); } });
    const baseJournal = createCloudOperationIntentRepository({ authorizeOwner, runTransaction,
      readRecord: path => { if (typeof path !== 'string' || !INTENT.test(path)) throw new CloudOperationIntentError('invalid'); return readRecord(path); },
      listPreparedPage: (kind, actorUid, after, count) => { settingsKind(kind); return intentPage(actorUid, after, count, true); },
      listHistoryPage: (kind, actorUid, after, count) => { settingsKind(kind); return intentPage(actorUid, after, count, false); },
    });
    const journal = Object.freeze({
      prepare: (async (kind, input, createdAt) => {
        settingsKind(kind); let command;
        try { command = prepareCloudClinicSettingsCommand(input); } catch { throw new CloudOperationIntentError('invalid'); }
        if (command.createdAt !== createdAt) throw new CloudOperationIntentError('invalid');
        return checkedIntent(await baseJournal.prepare(kind, command, createdAt));
      }) as typeof baseJournal.prepare,
      get: (async id => { const result = await baseJournal.get(id); return result === null ? null : checkedIntent(result); }) as typeof baseJournal.get,
      listPreparedPage: (async (kind, input) => {
        settingsKind(kind); const result = await baseJournal.listPreparedPage(kind, input);
        return { records: result.records.map(intent => checkedIntent(intent)), nextAfterId: result.nextAfterId };
      }) as typeof baseJournal.listPreparedPage,
      listHistoryPage: (async (kind, input) => {
        settingsKind(kind); const result = await baseJournal.listHistoryPage(kind, input);
        return { records: result.records.map(intent => checkedIntent(intent)), nextAfterId: result.nextAfterId };
      }) as typeof baseJournal.listHistoryPage,
      cancel: (async id => checkedIntent(await baseJournal.cancel(id))) as typeof baseJournal.cancel,
    });
    requireRuntime(); return Object.freeze({ repository: Object.freeze(repository), journal });
  } catch { throw new CloudClinicSettingsError('unavailable'); }
}
