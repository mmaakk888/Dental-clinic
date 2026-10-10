import config from '../../firebase.cloud-config.json';
import { assessCloudOwnerIdentity, CLOUD_PROJECT_ID, type CloudOwnerIdentity } from './cloudIdentity';
import { assessCloudOwnerMembership, type CloudOwnerMembership } from './cloudMembership';
import { isLocalClinicHost } from './localRuntime';

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

/**
 * Explicit invocation only. Remains loopback-only until the clinical backend
 * and its Rules are integrated/tested. This factory does not publish Hosting,
 * create accounts, enable providers, read lists or write any document.
 */
export async function createFirebaseOperatingAuth(): Promise<CloudOperatingAuthSession> {
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
        if (!snapshot.exists()) throw new CloudOperatingAuthError('unavailable');
        const membership = snapshot.data() as CloudOwnerMembership;
        // The rules enforce this on the server too. Never substitute local
        // account flags, cached metadata or the previous setup diagnostic.
        assessCloudOwnerMembership(identity, membership, authTime);
        return { identity, membership, authTime };
      },
      signOut: async () => { trackedUser = null; await sdk.signOut(auth); },
      destroy: async () => {
        trackedUser = null;
        try { unsubscribe(); } finally { await apps.deleteApp(app); }
      },
    });
    try {
      unsubscribe = sdk.onAuthStateChanged(auth, user => {
        if (trackedUser && user !== trackedUser) { trackedUser = null; session.invalidate(); }
      }, () => session.invalidate());
    } catch {
      destroy = null;
      await session.dispose().catch(() => undefined);
      throw new CloudOperatingAuthError('unavailable');
    }
    destroy = null; // The returned lifecycle now owns this isolated SDK app.
    return session;
  } catch {
    await destroy?.().catch(() => undefined);
    throw new CloudOperatingAuthError('unavailable');
  }
}
