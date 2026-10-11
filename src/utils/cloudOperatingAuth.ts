import config from '../../firebase.cloud-config.json';
import { assessCloudOwnerIdentity, CLOUD_PROJECT_ID, type CloudOwnerIdentity } from './cloudIdentity';
import { assessCloudOwnerMembership, type CloudOwnerMembership } from './cloudMembership';
import { isLocalClinicHost } from './localRuntime';
import type { CloudContactRepository } from './cloudContactRepository';
import type { CloudPatientRepository } from './cloudPatientRepository';
import type { CloudClinicalRepository } from './cloudClinicalRepository';
import type { CloudOperationIntentRepository } from './cloudOperationIntent';
import type { CloudClinicalCapability } from './cloudClinicalWorkspaceController';
import type { CloudServiceCatalogRepository } from './cloudServiceCatalogRepository';
export type { CloudClinicalCapability } from './cloudClinicalWorkspaceController';
export interface CloudServiceCatalogCapability {
  repository: CloudServiceCatalogRepository; journal: CloudOperationIntentRepository;
}

type OperatingErrorCode = 'invalid-input' | 'busy' | 'unavailable' | 'changed' | 'closed';

export class CloudOperatingAuthError extends Error {
  constructor(readonly code: OperatingErrorCode) {
    super('تعذر إكمال دخول التشغيل السحابي.');
    this.name = 'CloudOperatingAuthError';
  }
}

/** Fixed messages only: SDK failures can include account/request details. */
export function cloudOperatingAuthErrorMessage(error: unknown): string {
  try {
    if (error instanceof CloudOperatingAuthError) {
      switch (error.code) {
        case 'invalid-input': return 'اكتب البريد وكلمة السر الخاصة بحساب الموقع.';
        case 'busy': return 'انتظر انتهاء العملية الحالية.';
        case 'changed': return 'تغيرت جلسة الدخول. سجّل الدخول من جديد.';
        case 'closed': return 'أُغلقت جلسة التشغيل. افتح الصفحة من جديد.';
      }
    }
  } catch { /* Malformed provider/Proxy errors must not escape. */ }
  return 'تعذر تأكيد حساب المالك وعضويته. راجع الاتصال وسجّل الدخول من جديد.';
}

export type CloudOperatingOwner = Readonly<{
  uid: string;
  email: string;
  identityVersion: number;
  verifiedAfter: number;
}>;

export type CloudOperatingAuthState = Readonly<{
  phase: 'signed-out' | 'checking' | 'owner-checked' | 'signing-out' | 'closed';
  owner: CloudOperatingOwner | null;
}>;

export interface CloudOperatingAuthAdapter {
  signIn(email: string, password: string): Promise<void>;
  readOwner(): Promise<{
    identity: CloudOwnerIdentity;
    membership: CloudOwnerMembership;
    authTime: number;
  }>;
  signOut(): Promise<void>;
  destroy(): Promise<void>;
}

/**
 * Prepared operating lifecycle, NOT wired to App and NOT clinical permission.
 * No local account fallback, records, remembered credentials or migration.
 * Every authorizeOwner() repeats the server membership read; owner-checked is
 * only a UI snapshot and must never authorize a subsequent data operation.
 */
export function createCloudOperatingAuthSession(adapter: CloudOperatingAuthAdapter) {
  let state: CloudOperatingAuthState = Object.freeze({ phase: 'signed-out', owner: null });
  const listeners = new Set<(value: CloudOperatingAuthState) => void>();
  let epoch = 0;
  let pending: Promise<CloudOperatingOwner> | null = null;
  let stopping: Promise<void> | null = null;
  let disposal: Promise<void> | null = null;
  let disposed = false;
  let cleanupRequired = false;

  function publish(phase: CloudOperatingAuthState['phase'], owner: CloudOperatingOwner | null = null) {
    state = Object.freeze({ phase, owner });
    for (const listener of [...listeners]) {
      try { listener(state); } catch { /* A broken view cannot preserve authorization. */ }
    }
  }

  async function perform(email?: string, password?: string): Promise<CloudOperatingOwner> {
    if (disposed) throw new CloudOperatingAuthError('closed');
    if (pending || stopping) throw new CloudOperatingAuthError('busy');
    if (cleanupRequired) throw new CloudOperatingAuthError('unavailable');
    const ticket = ++epoch;
    // Defer adapter work until pending has been assigned, including callbacks
    // that synchronously attempt another operation from the adapter boundary.
    const work = Promise.resolve().then(async () => {
      try {
        if (disposed || ticket !== epoch) throw new CloudOperatingAuthError('changed');
        if (email !== undefined) await adapter.signIn(email, password!);
        if (disposed || ticket !== epoch) throw new CloudOperatingAuthError('changed');
        const value = await adapter.readOwner();
        const membership = assessCloudOwnerMembership(value.identity, value.membership, value.authTime);
        if (disposed || ticket !== epoch) throw new CloudOperatingAuthError('changed');
        const owner = Object.freeze({ uid: value.identity.uid, email: value.identity.email,
          identityVersion: membership.identityVersion, verifiedAfter: membership.verifiedAfter });
        publish('owner-checked', owner);
        if (disposed || ticket !== epoch) throw new CloudOperatingAuthError('changed');
        return owner;
      } catch (error) {
        // Close the UI immediately; cleanup failure never enables a fallback.
        if (!disposed && ticket === epoch) publish('signed-out');
        cleanupRequired = true;
        try { await adapter.signOut(); cleanupRequired = false; } catch { /* Retry explicit sign-out. */ }
        if (disposed || ticket !== epoch) throw new CloudOperatingAuthError('changed');
        let safeError: CloudOperatingAuthError;
        try { safeError = error instanceof CloudOperatingAuthError ? error : new CloudOperatingAuthError('unavailable'); }
        catch { safeError = new CloudOperatingAuthError('unavailable'); }
        throw safeError;
      }
    });
    pending = work;
    publish('checking');
    try { return await work; }
    finally { if (pending === work) pending = null; }
  }

  function stop(): Promise<void> {
    if (stopping) return stopping;
    ++epoch;
    cleanupRequired = true;
    const prior = pending;
    const work = Promise.resolve().then(async () => {
      await prior?.catch(() => undefined);
      try { await adapter.signOut(); cleanupRequired = false; }
      catch { throw new CloudOperatingAuthError('unavailable'); }
      finally { if (!disposed) publish('signed-out'); }
    });
    stopping = work;
    publish(disposed ? 'closed' : 'signing-out');
    void work.finally(() => { if (stopping === work) stopping = null; }).catch(() => undefined);
    return work;
  }

  return {
    getState: () => state,
    subscribe: (listener: (value: CloudOperatingAuthState) => void) => {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    signIn: (email: string, password: string): Promise<CloudOperatingOwner> => {
      if (typeof email !== 'string' || email.trim().length > 254
        || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email.trim())
        || typeof password !== 'string' || !password.length || password.length > 4096) {
        return Promise.reject(new CloudOperatingAuthError('invalid-input'));
      }
      return perform(email.trim(), password);
    },
    authorizeOwner: () => perform(),
    /** SDK identity changes clear the snapshot and invalidate in-flight reads. */
    invalidate: () => {
      if (disposed) return;
      ++epoch;
      publish('signed-out');
    },
    signOut: () => disposed ? Promise.reject(new CloudOperatingAuthError('closed')) : stop(),
    dispose: () => {
      if (disposal) return disposal;
      disposed = true;
      ++epoch;
      disposal = Promise.resolve().then(async () => {
        try { await stop(); }
        finally {
          try { await adapter.destroy(); }
          catch { throw new CloudOperatingAuthError('unavailable'); }
        }
      });
      publish('closed');
      listeners.clear();
      return disposal;
    },
  };
}

export type CloudOperatingAuthSession = ReturnType<typeof createCloudOperatingAuthSession>;
export type CloudOperatingFirebaseSession = CloudOperatingAuthSession & {
  /** Explicit, owner-authorized capability. No SDK app/Auth object escapes. */
  getContacts(): Promise<CloudContactRepository>;
  /** Prepared profile-only capability; does not activate patient UI or Rules. */
  getPatients(): Promise<CloudPatientRepository>;
  /** Prepared clinical-only capability; no UI, Rules or Hosting activation. */
  getClinical(): Promise<CloudClinicalCapability>;
  /** Explicit catalog/settings capability. No default prices or UI activation. */
  getServiceCatalog(): Promise<CloudServiceCatalogCapability>;
};

/**
 * Explicit invocation only. Remains loopback-only until the clinical backend
 * and its Rules are integrated/tested. This factory does not publish Hosting,
 * create accounts, enable providers, read lists or write any document.
 */
export async function createFirebaseOperatingAuth(): Promise<CloudOperatingFirebaseSession> {
  const requireRuntime = () => {
    if (typeof window === 'undefined' || !isLocalClinicHost(window.location.hostname)
      || config.projectId !== CLOUD_PROJECT_ID || config.authDomain !== `${CLOUD_PROJECT_ID}.firebaseapp.com`) {
      throw new CloudOperatingAuthError('unavailable');
    }
  };
  let destroy: (() => Promise<void>) | null = null;
  try {
    requireRuntime();
    const [apps, sdk] = await Promise.all([import('firebase/app'), import('firebase/auth')]);
    requireRuntime();
    const instanceId = crypto.randomUUID();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(instanceId)) {
      throw new CloudOperatingAuthError('unavailable');
    }
    const app = apps.initializeApp(config, `clinic-operating-${instanceId}`);
    destroy = () => apps.deleteApp(app);
    const auth = sdk.initializeAuth(app, { persistence: sdk.inMemoryPersistence });
    if (auth.emulatorConfig) throw new CloudOperatingAuthError('unavailable');
    auth.languageCode = 'ar';
    let trackedUser: typeof auth.currentUser = null;
    let unsubscribe = () => undefined;
    const session = createCloudOperatingAuthSession({
      signIn: async (email, password) => {
        requireRuntime();
        trackedUser = null;
        await sdk.signInWithEmailAndPassword(auth, email, password);
        requireRuntime();
      },
      readOwner: async () => {
        requireRuntime();
        const user = auth.currentUser;
        if (!user) throw new CloudOperatingAuthError('unavailable');
        trackedUser = user;
        const requireSameUser = () => {
          requireRuntime();
          if (auth.currentUser !== user || auth.emulatorConfig) throw new CloudOperatingAuthError('changed');
        };
        await sdk.reload(user);
        requireSameUser();
        const token = await sdk.getIdTokenResult(user, true);
        requireSameUser();
        const identity = assessCloudOwnerIdentity({ uid: user.uid, email: user.email,
          emailVerified: user.emailVerified, token });
        const authTime = Object.getOwnPropertyDescriptor(token.claims, 'auth_time')?.value;
        if (identity.status !== 'owner-confirmed' || !Number.isSafeInteger(authTime) || authTime < 0) {
          throw new CloudOperatingAuthError('unavailable');
        }
        const store = await import('firebase/firestore/lite');
        requireSameUser();
        const database = store.getFirestore(app, '(default)');
        const snapshot = await store.getDoc(store.doc(database, 'clinics', 'main', 'members', user.uid));
        requireSameUser();
        const exists = snapshot.exists();
        requireSameUser();
        if (!exists) throw new CloudOperatingAuthError('unavailable');
        const membership = snapshot.data() as CloudOwnerMembership;
        requireSameUser();
        // The rules enforce this on the server too. Never substitute local
        // account flags, cached metadata or the previous setup diagnostic.
        assessCloudOwnerMembership(identity, membership, authTime);
        requireSameUser();
        return { identity, membership, authTime };
      },
      signOut: async () => { trackedUser = null; await sdk.signOut(auth); },
      destroy: async () => {
        trackedUser = null;
        try { unsubscribe(); } finally { await apps.deleteApp(app); }
      },
    });
    // A capability belongs to one uninterrupted signed-in identity, not a UID
    // string or the temporary UI checking phase. Retained methods must never
    // become valid again after logout/relogin, even for the same owner.
    let capabilityGeneration = 0;
    let contactsCreation: Promise<CloudContactRepository> | null = null;
    let patientsCreation: Promise<CloudPatientRepository> | null = null;
    let clinicalCreation: Promise<CloudClinicalCapability> | null = null;
    let catalogCreation: Promise<CloudServiceCatalogCapability> | null = null;
    const revokeCapabilities = () => { ++capabilityGeneration; contactsCreation = null; patientsCreation = null; clinicalCreation = null; catalogCreation = null; };
    session.subscribe(value => {
      if (value.phase === 'signed-out' || value.phase === 'signing-out' || value.phase === 'closed') revokeCapabilities();
    });
    const operating: CloudOperatingFirebaseSession = Object.freeze({
      ...session,
      signIn: (email: string, password: string) => { revokeCapabilities(); return session.signIn(email, password); },
      invalidate: () => { revokeCapabilities(); session.invalidate(); },
      signOut: () => { revokeCapabilities(); return session.signOut(); },
      dispose: () => { revokeCapabilities(); return session.dispose(); },
      getContacts: async (): Promise<CloudContactRepository> => {
        try {
          const checked = session.getState();
          const user = auth.currentUser;
          if (checked.phase !== 'owner-checked' || !checked.owner || !user || checked.owner.uid !== user.uid) {
            throw new CloudOperatingAuthError('changed');
          }
          const generation = capabilityGeneration;
          const uid = checked.owner.uid;
          const requireActive = () => {
            try { requireRuntime(); }
            catch { revokeCapabilities(); throw new CloudOperatingAuthError('changed'); }
            const phase = session.getState().phase;
            if (generation !== capabilityGeneration || auth.currentUser !== user || user.uid !== uid || auth.emulatorConfig
              || phase === 'signed-out' || phase === 'signing-out' || phase === 'closed') {
              // A missed/delayed SDK observer must not allow later resurrection.
              if (generation === capabilityGeneration) revokeCapabilities();
              throw new CloudOperatingAuthError('changed');
            }
          };
          const authorize = async () => {
            requireActive();
            const owner = await session.authorizeOwner();
            requireActive();
            if (owner.uid !== uid) { revokeCapabilities(); throw new CloudOperatingAuthError('changed'); }
          };
          await authorize();
          requireActive();
          if (!contactsCreation) {
            // Assign ownership before deferred imports/factory callbacks. A
            // cancelled load cannot initialize a data adapter after closure.
            const creation = Promise.resolve().then(async () => {
              requireActive();
              const [contacts, contract] = await Promise.all([
                import('./firebaseCloudContacts'), import('./cloudContactRepository'),
              ]);
              requireActive();
              const repository = await contacts.createFirebaseCloudContacts(auth, {
                isActive: () => { try { requireActive(); return true; } catch { return false; } },
              });
              requireActive();
              const run = async <T>(work: () => Promise<T>): Promise<T> => {
                try {
                  await authorize();
                  requireActive();
                  const result = await work();
                  // A server-accepted write may still commit after logout. We
                  // reject its late UI result, not claim a server-side undo.
                  requireActive();
                  return result;
                } catch (error) {
                  let safe: Error = new CloudOperatingAuthError('unavailable');
                  try {
                    if (error instanceof CloudOperatingAuthError) safe = new CloudOperatingAuthError(error.code);
                    if (error instanceof contract.CloudContactError
                      && ['invalid', 'conflict', 'duplicate', 'unavailable'].includes(error.code)) {
                      safe = new contract.CloudContactError(error.code);
                    }
                  } catch { /* Malformed SDK/Proxy failures remain fixed errors. */ }
                  throw safe;
                }
              };
              return Object.freeze({
                commit: async input => {
                  let prepared: ReturnType<typeof contract.prepareCloudContactCommand>;
                  try { prepared = contract.prepareCloudContactCommand(input); }
                  catch { throw new contract.CloudContactError('invalid'); }
                  return run(() => repository.commit(prepared));
                },
                get: recordId => run(() => repository.get(recordId)),
                listPage: async input => {
                  let prepared: ReturnType<typeof contract.prepareCloudContactPageInput>;
                  try { prepared = contract.prepareCloudContactPageInput(input); }
                  catch { throw new contract.CloudContactError('invalid'); }
                  return run(() => repository.listPage(prepared));
                },
              } satisfies CloudContactRepository);
            });
            contactsCreation = creation;
            void creation.catch(() => { if (contactsCreation === creation) contactsCreation = null; });
          }
          const repository = await contactsCreation;
          requireActive();
          return repository;
        } catch {
          // Initialization/authorization errors never expose provider payloads.
          throw new CloudOperatingAuthError('unavailable');
        }
      },
      getPatients: async (): Promise<CloudPatientRepository> => {
        try {
          const checked = session.getState(), user = auth.currentUser;
          if (checked.phase !== 'owner-checked' || !checked.owner || !user || checked.owner.uid !== user.uid) {
            throw new CloudOperatingAuthError('changed');
          }
          const generation = capabilityGeneration, uid = checked.owner.uid;
          const requireActive = () => {
            try { requireRuntime(); }
            catch { revokeCapabilities(); throw new CloudOperatingAuthError('changed'); }
            const phase = session.getState().phase;
            if (generation !== capabilityGeneration || auth.currentUser !== user || user.uid !== uid || auth.emulatorConfig
              || phase === 'signed-out' || phase === 'signing-out' || phase === 'closed') {
              if (generation === capabilityGeneration) revokeCapabilities();
              throw new CloudOperatingAuthError('changed');
            }
          };
          const authorize = async () => {
            requireActive();
            const owner = await session.authorizeOwner();
            requireActive();
            if (owner.uid !== uid) { revokeCapabilities(); throw new CloudOperatingAuthError('changed'); }
          };
          await authorize(); requireActive();
          if (!patientsCreation) {
            const creation = Promise.resolve().then(async () => {
              requireActive();
              const [patients, contract] = await Promise.all([
                import('./firebaseCloudPatients'), import('./cloudPatientRepository'),
              ]);
              requireActive();
              const repository = await patients.createFirebaseCloudPatients(auth, {
                isActive: () => { try { requireActive(); return true; } catch { return false; } },
              });
              requireActive();
              const run = async <T>(work: () => Promise<T>): Promise<T> => {
                try {
                  await authorize(); requireActive();
                  const result = await work(); requireActive(); return result;
                } catch (error) {
                  let safe: Error = new CloudOperatingAuthError('unavailable');
                  try {
                    if (error instanceof CloudOperatingAuthError) safe = new CloudOperatingAuthError(error.code);
                    if (error instanceof contract.CloudPatientError && ['invalid', 'conflict', 'unavailable'].includes(error.code)) {
                      safe = new contract.CloudPatientError(error.code);
                    }
                  } catch { /* Fixed errors, never provider/clinical payloads. */ }
                  throw safe;
                }
              };
              return Object.freeze({
                commit: async input => {
                  const prepared = contract.prepareCloudPatientCommand(input);
                  return run(() => repository.commit(prepared));
                },
                get: recordId => run(() => repository.get(recordId)),
                getByFileNo: fileNo => run(() => repository.getByFileNo(fileNo)),
                listPage: async input => {
                  const prepared = contract.prepareCloudPatientPageInput(input);
                  return run(() => repository.listPage(prepared));
                },
                findByPhone: async input => {
                  const prepared = contract.prepareCloudPatientPhoneInput(input);
                  return run(() => repository.findByPhone(prepared));
                },
              } satisfies CloudPatientRepository);
            });
            patientsCreation = creation;
            void creation.catch(() => { if (patientsCreation === creation) patientsCreation = null; });
          }
          const repository = await patientsCreation; requireActive(); return repository;
        } catch { throw new CloudOperatingAuthError('unavailable'); }
      },
      getClinical: async (): Promise<CloudClinicalCapability> => {
        try {
          const checked = session.getState(), user = auth.currentUser;
          if (checked.phase !== 'owner-checked' || !checked.owner || !user || checked.owner.uid !== user.uid) {
            throw new CloudOperatingAuthError('changed');
          }
          const generation = capabilityGeneration, uid = checked.owner.uid;
          const requireActive = () => {
            try { requireRuntime(); }
            catch { revokeCapabilities(); throw new CloudOperatingAuthError('changed'); }
            const phase = session.getState().phase;
            if (generation !== capabilityGeneration || auth.currentUser !== user || user.uid !== uid || auth.emulatorConfig
              || phase === 'signed-out' || phase === 'signing-out' || phase === 'closed') {
              if (generation === capabilityGeneration) revokeCapabilities();
              throw new CloudOperatingAuthError('changed');
            }
          };
          const authorize = async () => {
            requireActive();
            const owner = await session.authorizeOwner();
            requireActive();
            if (owner.uid !== uid) { revokeCapabilities(); throw new CloudOperatingAuthError('changed'); }
          };
          await authorize(); requireActive();
          if (!clinicalCreation) {
            const creation = Promise.resolve().then(async () => {
              requireActive();
              const [clinical, contract, intents] = await Promise.all([
                import('./firebaseCloudClinical'), import('./cloudClinicalRepository'), import('./cloudOperationIntent'),
              ]);
              requireActive();
              const capability = await clinical.createFirebaseCloudClinical(auth, {
                isActive: () => { try { requireActive(); return true; } catch { return false; } },
              });
              requireActive();
              const run = async <T>(work: () => Promise<T>): Promise<T> => {
                try {
                  await authorize(); requireActive();
                  const result = await work(); requireActive();
                  // A completed server request is not rolled back by logout.
                  // Recheck current membership before publishing its result.
                  await authorize(); requireActive(); return result;
                } catch (error) {
                  let safe: Error = new CloudOperatingAuthError('unavailable');
                  try {
                    if (error instanceof CloudOperatingAuthError) safe = new CloudOperatingAuthError(error.code);
                    if (error instanceof contract.CloudClinicalError && ['invalid', 'conflict', 'unavailable'].includes(error.code)) {
                      safe = new contract.CloudClinicalError(error.code);
                    }
                    if (error instanceof intents.CloudOperationIntentError && ['invalid', 'conflict', 'unavailable'].includes(error.code)) {
                      safe = new intents.CloudOperationIntentError(error.code);
                    }
                  } catch { /* No raw provider, clinical or hostile Proxy errors. */ }
                  throw safe;
                }
              };
              const uuid = (value: unknown): value is string => typeof value === 'string' && value.length === 36
                && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
              const clinicalId = (value: unknown) => { if (!uuid(value)) throw new contract.CloudClinicalError('invalid'); return value; };
              const intentId = (value: unknown) => { if (!uuid(value)) throw new intents.CloudOperationIntentError('invalid'); return value; };
              const clinicalKind = (kind: unknown) => { if (kind !== 'clinical') throw new intents.CloudOperationIntentError('invalid'); };
              const pageInput = (value: unknown): { afterId: string | null; limit: number } => {
                try {
                  const input = value === undefined ? {} : value;
                  if (!input || typeof input !== 'object' || Array.isArray(input)
                    || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new Error();
                  const keys = Reflect.ownKeys(input);
                  if (keys.some(key => typeof key !== 'string' || !['afterId', 'limit'].includes(key))) throw new Error();
                  const copy: Record<string, unknown> = {};
                  for (const key of keys as string[]) {
                    const property = Object.getOwnPropertyDescriptor(input, key);
                    if (!property || !('value' in property) || !property.enumerable) throw new Error();
                    copy[key] = property.value;
                  }
                  const afterId = copy.afterId === undefined ? null : copy.afterId, limit = copy.limit === undefined ? 25 : copy.limit;
                  if (afterId !== null && !uuid(afterId) || typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error();
                  return { afterId: afterId as string | null, limit };
                } catch { throw new intents.CloudOperationIntentError('invalid'); }
              };
              const checkedIntent = (value: unknown, id?: string, expectedCommand?: object) => {
                const result = intents.parseCloudOperationIntent(value);
                if (result.kind !== 'clinical' || result.actorUid !== uid || id !== undefined && result.operationId !== id) {
                  throw new intents.CloudOperationIntentError('invalid');
                }
                const command = contract.prepareCloudClinicalCommand(result.command);
                if (command.createdAt !== result.createdAt || JSON.stringify(intents.prepareCloudIntentCommand(command)) !== JSON.stringify(result.command)
                  || expectedCommand !== undefined && JSON.stringify(result.command) !== JSON.stringify(expectedCommand)) {
                  throw new intents.CloudOperationIntentError('invalid');
                }
                return result;
              };
              const repository = Object.freeze({
                commit: async input => {
                  const prepared = contract.prepareCloudClinicalCommand(input);
                  return run(() => capability.repository.commit(prepared));
                },
                getProfile: async patientId => {
                  const prepared = clinicalId(patientId);
                  return run(() => capability.repository.getProfile(prepared));
                },
                getAccount: async patientId => {
                  const prepared = clinicalId(patientId);
                  return run(() => capability.repository.getAccount(prepared));
                },
                getSession: async sessionId => {
                  const prepared = clinicalId(sessionId);
                  return run(() => capability.repository.getSession(prepared));
                },
                listSessions: async input => {
                  const prepared = contract.prepareCloudClinicalPageInput(input);
                  return run(() => capability.repository.listSessions(prepared));
                },
                listReceipts: async input => {
                  const prepared = contract.prepareCloudClinicalPageInput(input);
                  return run(() => capability.repository.listReceipts(prepared));
                },
              } satisfies CloudClinicalRepository);
              const journal = Object.freeze({
                prepare: async (kind, input, createdAt) => {
                  clinicalKind(kind);
                  const clinicalCommand = contract.prepareCloudClinicalCommand(input);
                  const prepared = intents.prepareCloudIntentCommand(clinicalCommand);
                  if (createdAt !== clinicalCommand.createdAt) throw new intents.CloudOperationIntentError('invalid');
                  return run(async () => checkedIntent(await capability.journal.prepare('clinical', prepared, createdAt), clinicalCommand.operationId, prepared));
                },
                get: async id => {
                  const prepared = intentId(id);
                  return run(async () => {
                    const result = await capability.journal.get(prepared);
                    return result === null ? null : checkedIntent(result, prepared);
                  });
                },
                listPreparedPage: async (kind, input) => {
                  clinicalKind(kind); const prepared = pageInput(input);
                  return run(async () => {
                    const page = await capability.journal.listPreparedPage('clinical', prepared);
                    // The repository validates cursor/schema; this capability
                    // additionally fences kind and actor before returning it.
                    return { records: page.records.map(value => checkedIntent(value)), nextAfterId: page.nextAfterId };
                  });
                },
                listHistoryPage: async (kind, input) => {
                  clinicalKind(kind); const prepared = pageInput(input);
                  return run(async () => {
                    if (!capability.journal.listHistoryPage) throw new intents.CloudOperationIntentError('unavailable');
                    const page = await capability.journal.listHistoryPage('clinical', prepared);
                    return { records: page.records.map(value => checkedIntent(value)), nextAfterId: page.nextAfterId };
                  });
                },
                cancel: async id => {
                  const prepared = intentId(id);
                  return run(async () => checkedIntent(await capability.journal.cancel(prepared), prepared));
                },
              } satisfies CloudOperationIntentRepository);
              return Object.freeze({ repository, journal });
            });
            clinicalCreation = creation;
            void creation.catch(() => { if (clinicalCreation === creation) clinicalCreation = null; });
          }
          const capability = await clinicalCreation;
          requireActive(); await authorize(); requireActive(); return capability;
        } catch { throw new CloudOperatingAuthError('unavailable'); }
      },
      getServiceCatalog: async (): Promise<CloudServiceCatalogCapability> => {
        try {
          const checked = session.getState(), user = auth.currentUser;
          if (checked.phase !== 'owner-checked' || !checked.owner || !user || checked.owner.uid !== user.uid) {
            throw new CloudOperatingAuthError('changed');
          }
          const generation = capabilityGeneration, uid = checked.owner.uid;
          const requireActive = () => {
            try { requireRuntime(); }
            catch { revokeCapabilities(); throw new CloudOperatingAuthError('changed'); }
            const phase = session.getState().phase;
            if (generation !== capabilityGeneration || auth.currentUser !== user || user.uid !== uid || auth.emulatorConfig
              || phase === 'signed-out' || phase === 'signing-out' || phase === 'closed') {
              if (generation === capabilityGeneration) revokeCapabilities();
              throw new CloudOperatingAuthError('changed');
            }
          };
          const authorize = async () => {
            requireActive(); const owner = await session.authorizeOwner(); requireActive();
            if (owner.uid !== uid) { revokeCapabilities(); throw new CloudOperatingAuthError('changed'); }
          };
          await authorize(); requireActive();
          if (!catalogCreation) {
            const creation = Promise.resolve().then(async () => {
              requireActive();
              const [catalog, contract, intents] = await Promise.all([
                import('./firebaseCloudServiceCatalog'), import('./cloudServiceCatalogRepository'), import('./cloudOperationIntent'),
              ]);
              requireActive();
              const capability = await catalog.createFirebaseCloudServiceCatalog(auth, {
                isActive: () => { try { requireActive(); return true; } catch { return false; } },
              });
              requireActive();
              const run = async <T>(work: () => Promise<T>): Promise<T> => {
                try {
                  await authorize(); requireActive();
                  const result = await work(); requireActive();
                  await authorize(); requireActive(); return result;
                } catch (error) {
                  let safe: Error = new CloudOperatingAuthError('unavailable');
                  try {
                    if (error instanceof CloudOperatingAuthError) safe = new CloudOperatingAuthError(error.code);
                    if (error instanceof contract.CloudServiceCatalogError && ['invalid', 'conflict', 'unavailable'].includes(error.code)) safe = new contract.CloudServiceCatalogError(error.code);
                    if (error instanceof intents.CloudOperationIntentError && ['invalid', 'conflict', 'unavailable'].includes(error.code)) safe = new intents.CloudOperationIntentError(error.code);
                  } catch { /* Only fixed errors escape. */ }
                  throw safe;
                }
              };
              const uuid = (value: unknown): value is string => typeof value === 'string' && value.length === 36
                && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
              const intentId = (value: unknown) => { if (!uuid(value)) throw new intents.CloudOperationIntentError('invalid'); return value; };
              const kindOnly = (value: unknown) => { if (value !== 'catalog') throw new intents.CloudOperationIntentError('invalid'); };
              const pageInput = (value: unknown) => {
                try {
                  const source = value === undefined ? {} : value;
                  if (!source || typeof source !== 'object' || Array.isArray(source)
                    || ![Object.prototype, null].includes(Object.getPrototypeOf(source))) throw new Error();
                  const keys = Reflect.ownKeys(source), copy: Record<string, unknown> = {};
                  if (keys.some(key => typeof key !== 'string' || !['afterId', 'limit'].includes(key))) throw new Error();
                  for (const key of keys as string[]) {
                    const descriptor = Object.getOwnPropertyDescriptor(source, key);
                    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) throw new Error();
                    copy[key] = descriptor.value;
                  }
                  const afterId = copy.afterId === undefined ? null : copy.afterId, limit = copy.limit === undefined ? 25 : copy.limit;
                  if (afterId !== null && !uuid(afterId) || typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error();
                  return { afterId: afterId as string | null, limit };
                } catch { throw new intents.CloudOperationIntentError('invalid'); }
              };
              const checkedIntent = (value: unknown, id?: string, expectedCommand?: object) => {
                const result = intents.parseCloudOperationIntent(value);
                const command = contract.prepareCloudServiceCatalogCommand(result.command);
                if (result.kind !== 'catalog' || result.actorUid !== uid || id !== undefined && result.operationId !== id
                  || command.createdAt !== result.createdAt || JSON.stringify(intents.prepareCloudIntentCommand(command)) !== JSON.stringify(result.command)
                  || expectedCommand !== undefined && JSON.stringify(expectedCommand) !== JSON.stringify(result.command)) throw new intents.CloudOperationIntentError('invalid');
                return result;
              };
              const repository = Object.freeze({
                get: () => run(async () => {
                  const result = await capability.repository.get();
                  return result === null ? null : contract.parseCloudServiceCatalogRecord(result);
                }),
                commit: async input => {
                  const prepared = contract.prepareCloudServiceCatalogCommand(input);
                  return run(() => capability.repository.commit(prepared));
                },
              } satisfies CloudServiceCatalogRepository);
              const list = async (kind: unknown, input: unknown, history: boolean) => {
                kindOnly(kind); const prepared = pageInput(input);
                return run(async () => {
                  const method = history ? capability.journal.listHistoryPage : capability.journal.listPreparedPage;
                  if (typeof method !== 'function') throw new intents.CloudOperationIntentError('unavailable');
                  const page = await method.call(capability.journal, 'catalog', prepared);
                  return { records: page.records.map(value => checkedIntent(value)), nextAfterId: page.nextAfterId };
                });
              };
              const journal = Object.freeze({
                prepare: async (kind, input, createdAt) => {
                  kindOnly(kind); const command = contract.prepareCloudServiceCatalogCommand(input), prepared = intents.prepareCloudIntentCommand(command);
                  if (createdAt !== command.createdAt) throw new intents.CloudOperationIntentError('invalid');
                  return run(async () => checkedIntent(await capability.journal.prepare('catalog', prepared, createdAt), command.operationId, prepared));
                },
                get: async id => { const prepared = intentId(id); return run(async () => { const result = await capability.journal.get(prepared); return result === null ? null : checkedIntent(result, prepared); }); },
                listPreparedPage: (kind, input) => list(kind, input, false),
                listHistoryPage: (kind, input) => list(kind, input, true),
                cancel: async id => { const prepared = intentId(id); return run(async () => checkedIntent(await capability.journal.cancel(prepared), prepared)); },
              } satisfies CloudOperationIntentRepository);
              return Object.freeze({ repository, journal });
            });
            catalogCreation = creation;
            void creation.catch(() => { if (catalogCreation === creation) catalogCreation = null; });
          }
          const capability = await catalogCreation;
          requireActive(); await authorize(); requireActive(); return capability;
        } catch { throw new CloudOperatingAuthError('unavailable'); }
      },
    });
    try {
      unsubscribe = sdk.onAuthStateChanged(auth, user => {
        if (trackedUser && user !== trackedUser) { trackedUser = null; operating.invalidate(); }
      }, () => operating.invalidate());
    } catch {
      destroy = null;
      await session.dispose().catch(() => undefined);
      throw new CloudOperatingAuthError('unavailable');
    }
    destroy = null; // The returned lifecycle now owns this isolated SDK app.
    return operating;
  } catch {
    await destroy?.().catch(() => undefined);
    throw new CloudOperatingAuthError('unavailable');
  }
}
