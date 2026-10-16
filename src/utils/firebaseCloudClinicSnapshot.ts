import type { Auth } from 'firebase/auth';
import { assessCloudOwnerIdentity, CLOUD_PROJECT_ID } from './cloudIdentity';
import { assessCloudOwnerMembership } from './cloudMembership';
import { isCloudOperatingRuntime } from './cloudOperatingRuntime';
import { createCloudClinicSnapshotReader, CloudClinicSnapshotError, CLOUD_SNAPSHOT_COLLECTIONS, CLOUD_SNAPSHOT_LIMITS,
  parseCloudSnapshotReadTime, type CloudSnapshotQuery, type CloudClinicSnapshot, type CloudClinicDirectorySnapshot } from './cloudClinicSnapshot';

export interface FirebaseCloudClinicSnapshotCapability {
  readFull(): Promise<CloudClinicSnapshot>;
  readDirectory(): Promise<CloudClinicDirectorySnapshot>;
}
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const APP = new RegExp(`^clinic-operating-${UUID}(?![\\s\\S])`);
const ID = new RegExp(`^${UUID}(?![\\s\\S])`);
const ROOT = `projects/${CLOUD_PROJECT_ID}/databases/(default)/documents/clinics/main`;
const URL = `https://firestore.googleapis.com/v1/${ROOT}:runQuery`;
const PRIVATE_URL = `https://firestore.googleapis.com/v1/projects/${CLOUD_PROJECT_ID}/databases/(default)/documents:batchGet`;
const fail = (): never => { throw new CloudClinicSnapshotError(); };
/** Explicit read-only, coherent operational snapshot. No REST URL, token,
 * user-selected readTime, query builder or SDK object escapes this capability.
 * Construction/sign-in alone never reads data. Fixed named operating Auth and
 * fresh canonical owner membership are required before AND after each request.
 * Initial probe data is discarded by the pure reader. No default/setup app,
 * cache/offline store, IAM/CLI token, journal/image collection scan, or writes.
 * Exact referenced expense receipts/intents use batchGet at snapshot readTime;
 * their content is resolved privately and never included in the export. */
export async function createFirebaseCloudClinicSnapshot(auth: Auth, options: { isActive(): boolean }): Promise<FirebaseCloudClinicSnapshotCapability> {
  let revoked = false;
  let user: Auth['currentUser'], app: Auth['app'], uid: string | undefined;
  try { user = auth?.currentUser; app = auth?.app; uid = user?.uid; } catch { return fail(); }
  function runtime() {
    try {
      if (revoked || !options || typeof options.isActive !== 'function' || options.isActive() !== true || typeof window === 'undefined'
        || !isCloudOperatingRuntime(window.location.hostname, window.location.protocol) || !user || !app || auth.currentUser !== user || auth.app !== app || user.uid !== uid
        || !APP.test(app.name) || app.options.projectId !== CLOUD_PROJECT_ID || app.options.authDomain !== `${CLOUD_PROJECT_ID}.firebaseapp.com`
        || auth.emulatorConfig || typeof user.uid !== 'string' || !user.uid || typeof fetch !== 'function') throw new Error();
    } catch { revoked = true; fail(); }
  }
  const sdkCall = <T>(work: () => T): T => { runtime(); const result = work(); runtime(); return result; };
  const sdkAwait = async <T>(work: () => Promise<T>): Promise<T> => {
    runtime(); const pending = work();
    try { runtime(); } catch (error) { void pending.catch(() => undefined); throw error; }
    try { const value = await pending; runtime(); return value; } catch (error) { runtime(); throw error; }
  };
  try {
    runtime(); const [sdk, store] = await Promise.all([import('firebase/auth'), import('firebase/firestore/lite')]); runtime();
    const database = sdkCall(() => store.getFirestore(app, '(default)'));
    async function authorize(): Promise<string> {
      runtime(); const token = await sdkAwait(() => sdk.getIdTokenResult(user!));
      let identity: ReturnType<typeof assessCloudOwnerIdentity>;
      try { identity = sdkCall(() => assessCloudOwnerIdentity({ uid: user!.uid, email: user!.email, emailVerified: user!.emailVerified, token }));
        if (identity.status !== 'owner-confirmed' || typeof token.token !== 'string' || !token.token || token.token.length > 16 * 1024 || /[\u0000-\u0020\u007f]/.test(token.token)) throw new Error(); }
      catch { revoked = true; return fail(); }
      const reference = sdkCall(() => store.doc(database, 'clinics', 'main', 'members', identity.uid));
      const member = await sdkAwait(() => store.getDoc(reference));
      try {
        if (!sdkCall(() => member.exists())) throw new Error();
        const value = sdkCall(() => member.data());
        sdkCall(() => assessCloudOwnerMembership(identity, value, Object.getOwnPropertyDescriptor(token.claims, 'auth_time')?.value));
      } catch { revoked = true; return fail(); }
      runtime(); return token.token;
    }
    function body(input: CloudSnapshotQuery | null) {
      runtime();
      let collection = 'settings', documentId: string | null = 'serviceCatalog', afterId: string | null = null, limit = 1;
      if (input !== null) {
        if (!input || typeof input !== 'object' || Array.isArray(input) || Reflect.ownKeys(input).length !== 5) fail();
        const keys = ['collection', 'documentId', 'afterId', 'limit', 'readTime'];
        const values: Record<string, unknown> = {};
        for (const key of keys) { const property = Object.getOwnPropertyDescriptor(input, key); if (!property || !('value' in property) || !property.enumerable) fail(); values[key] = property.value; }
        if (typeof values.collection !== 'string' || ![...CLOUD_SNAPSHOT_COLLECTIONS, 'settings', 'counters', 'expenseOperations', 'operationIntents'].includes(values.collection as any)
          || !Number.isInteger(values.limit) || (values.limit as number) < 1 || (values.limit as number) > 50) fail();
        collection = values.collection as string; documentId = values.documentId as string | null; afterId = values.afterId as string | null; limit = values.limit as number;
        parseCloudSnapshotReadTime(values.readTime);
        if (collection === 'settings' ? !['serviceCatalog', 'clinicSettings', 'prostheticRouting'].includes(documentId!) || afterId !== null || limit !== 1
          : collection === 'counters' ? documentId !== 'patientFiles' || afterId !== null || limit !== 1
            : ['expenseOperations', 'operationIntents'].includes(collection) ? !ID.test(documentId!) || afterId !== null || limit !== 1
            : documentId !== null || afterId !== null && (collection === 'patientFiles' ? typeof afterId !== 'string' || !/^[1-9]\d{0,9}$/.test(afterId)
              : collection === 'appointmentDays' ? typeof afterId !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(afterId)
                : collection === 'materialBalances' ? typeof afterId !== 'string' || !/^[0-9a-f]{64}$/.test(afterId) : !ID.test(afterId))) fail();
      }
      if (input !== null && ['expenseOperations', 'operationIntents'].includes(collection)) return { documents: [`${ROOT}/${collection}/${documentId}`], readTime: input.readTime };
      const structuredQuery: Record<string, unknown> = { from: [{ collectionId: collection }], orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }], limit };
      if (documentId !== null) structuredQuery.where = { fieldFilter: { field: { fieldPath: '__name__' }, op: 'EQUAL', value: { referenceValue: `${ROOT}/${collection}/${documentId}` } } };
      if (afterId !== null) structuredQuery.startAt = { values: [{ referenceValue: `${ROOT}/${collection}/${afterId}` }], before: false };
      return input === null ? { structuredQuery } : { structuredQuery, readTime: input.readTime };
    }
    async function request(input: CloudSnapshotQuery | null): Promise<unknown> {
      const payload = body(input), token = await authorize(); runtime();
      const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 30_000);
      try {
        const privateRequest = 'documents' in payload;
        const response = await sdkAwait(() => fetch(privateRequest ? PRIVATE_URL : URL, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload), cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal: abort.signal }));
        if (!sdkCall(() => response.ok) || sdkCall(() => response.status) !== 200 || sdkCall(() => response.redirected)) fail();
        const declared = sdkCall(() => response.headers.get('content-length'));
        if (declared !== null && (!/^\d{1,10}$/.test(declared) || Number(declared) > CLOUD_SNAPSHOT_LIMITS.responseBytes)) fail();
        const stream = sdkCall(() => response.body); if (!stream) fail(); const reader = sdkCall(() => stream.getReader());
        let text = '', bytes = 0; const decoder = new TextDecoder('utf-8', { fatal: true });
        try {
          while (true) {
            const chunk = await sdkAwait(() => reader.read());
            if (chunk.done) break; const value = sdkCall(() => chunk.value);
            if (!(value instanceof Uint8Array) || (bytes += value.byteLength) > CLOUD_SNAPSHOT_LIMITS.responseBytes) fail(); text += sdkCall(() => decoder.decode(value, { stream: true }));
          }
          text += sdkCall(() => decoder.decode());
        } finally { try { await reader.cancel(); } catch { /* No fallback. */ } try { reader.releaseLock(); } catch { /* Best effort resource cleanup. */ } }
        runtime(); const value = sdkCall(() => JSON.parse(text)); await authorize(); runtime();
        if (!privateRequest) return value;
        // batchGet is an individually authorized get, not an unrestricted
        // private collection query. Require one exact name and confirmed time.
        if (!Array.isArray(value) || value.length !== 1) fail();
        const row = value[0], keys = row && typeof row === 'object' && !Array.isArray(row) ? Object.keys(row) : [];
        if (keys.length !== 2 || !keys.includes('readTime') || keys.some(key => !['readTime', 'found', 'missing'].includes(key))) fail();
        parseCloudSnapshotReadTime(row.readTime);
        const expectedName = (payload as { documents: string[] }).documents[0];
        if ('found' in row) { if (row.found?.name !== expectedName) fail(); return [{ readTime: row.readTime, document: row.found }]; }
        if (row.missing !== expectedName) fail(); return [{ readTime: row.readTime }];
      } finally { clearTimeout(timer); abort.abort(); }
    }
    const reader = createCloudClinicSnapshotReader({ probeReadTime: () => request(null), query: input => request(input), assertActive: runtime });
    return Object.freeze({
      async readFull() { runtime(); try { const snapshot = await reader.readFull(); runtime(); return snapshot; } catch { runtime(); return fail(); } },
      async readDirectory() { runtime(); try { const snapshot = await reader.readDirectory(); runtime(); return snapshot; } catch { runtime(); return fail(); } },
    });
  } catch { runtime(); return fail(); }
}
