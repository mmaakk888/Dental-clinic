import type { Auth } from 'firebase/auth';
import { assessCloudOwnerIdentity, CLOUD_PROJECT_ID } from './cloudIdentity';
import { assessCloudOwnerMembership } from './cloudMembership';
import { createCloudContactRepository, CloudContactError } from './cloudContactRepository';
import { isLocalClinicHost } from './localRuntime';

/**
 * Prepared adapter, not connected to App or the diagnostic setup page.
 * Live rules still prohibit these writes. Do not remove that protection or
 * expose this adapter until owner/contact Rules and integration tests pass.
 * Caller owns the isolated operating Auth app and its sign-out/disposal.
 */
export async function createFirebaseCloudContacts(auth: Auth) {
  const requireRuntime = () => {
    if (typeof window === 'undefined' || !isLocalClinicHost(window.location.hostname)
      || !auth || auth.app.options.projectId !== CLOUD_PROJECT_ID
      || auth.app.options.authDomain !== `${CLOUD_PROJECT_ID}.firebaseapp.com`
      || !/^clinic-operating-[0-9a-f-]{36}$/.test(auth.app.name) || auth.emulatorConfig) {
      throw new CloudContactError('unavailable');
    }
  };
  try {
    requireRuntime();
    const [sdk, store] = await Promise.all([import('firebase/auth'), import('firebase/firestore/lite')]);
    requireRuntime();
    // Explicit named operating app; never the old backup/default app. Lite
    // does not enqueue offline writes or persist clinical records to IndexedDB.
    const database = store.getFirestore(auth.app);
    const authorizeOwner = async () => {
      requireRuntime();
      const user = auth.currentUser;
      if (!user) throw new CloudContactError('unavailable');
      const token = await sdk.getIdTokenResult(user);
      if (auth.currentUser !== user) throw new CloudContactError('unavailable');
      const identity = assessCloudOwnerIdentity({ uid: user.uid, email: user.email,
        emailVerified: user.emailVerified, token });
      if (identity.status !== 'owner-confirmed') throw new CloudContactError('unavailable');
      const authTime = Object.getOwnPropertyDescriptor(token.claims, 'auth_time')?.value;
      const membership = await store.getDoc(store.doc(database, 'clinics', 'main', 'members', identity.uid));
      requireRuntime();
      if (auth.currentUser !== user || !membership.exists()) throw new CloudContactError('unavailable');
      assessCloudOwnerMembership(identity, membership.data(), authTime);
      return identity.uid;
    };
    const reference = (path: string) => {
      // Keep a second path fence at the adapter boundary. No reads/writes of
      // patients, costs, memberships, old backups, or arbitrary cloud paths.
      if (!/^clinics\/main\/(?:contactRecords\/[0-9a-f-]{36}|contactOperations\/[0-9a-f-]{36}|contactPhones\/[0-9a-f]{64})$/.test(path)) {
        throw new CloudContactError('invalid');
      }
      return store.doc(database, path);
    };
    return createCloudContactRepository({
      authorizeOwner,
      runTransaction: work => {
        requireRuntime();
        return store.runTransaction(database, transaction => work({
          get: async path => { const snapshot = await transaction.get(reference(path)); return snapshot.exists() ? snapshot.data() : null; },
          set: (path, value) => { transaction.set(reference(path), value); },
          delete: path => { transaction.delete(reference(path)); },
        }), { maxAttempts: 5 });
      },
    });
  } catch {
    // No SDK/provider errors, tokens, account details, or payloads in UI errors.
    throw new CloudContactError('unavailable');
  }
}
