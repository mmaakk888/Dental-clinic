import type { Auth } from 'firebase/auth';
import type { DocumentSnapshot, QueryConstraint, Transaction } from 'firebase/firestore/lite';
import { assessCloudOwnerIdentity, CLOUD_PROJECT_ID } from './cloudIdentity';
import { assessCloudOwnerMembership } from './cloudMembership';
import { isCloudOperatingRuntime } from './cloudOperatingRuntime';
import { CloudExpenseError, createCloudExpenseRepository, prepareCloudExpenseCommand, parseCloudInvoiceImage,
  type CloudExpenseCollection, type CloudExpenseRepository, type CloudExpenseTransaction } from './cloudExpenseRepository';
import { CloudOperationIntentError, createCloudOperationIntentRepository, parseCloudOperationIntent, prepareCloudIntentCommand,
  type CloudOperationIntent, type CloudOperationIntentRepository, type CloudOperationKind } from './cloudOperationIntent';

/** Source-only owner capability. Construction never authorizes, reads or seeds
 * expenses, and remains loopback-only until the complete release gates. */
export interface FirebaseCloudExpensesOptions { isActive: () => boolean }
export interface FirebaseCloudExpensesCapability {
  repository: CloudExpenseRepository;
  journal: CloudOperationIntentRepository;
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const END = '(?![\\s\\S])';
const ID = new RegExp(`^${UUID}${END}`);
const APP = new RegExp(`^clinic-operating-${UUID}${END}`);
const HASH = /^[0-9a-f]{64}(?![\s\S])/;
const RECORD = new RegExp(`^clinics/main/expenseRecords/${UUID}${END}`);
const PAYMENT = new RegExp(`^clinics/main/expensePayments/${UUID}${END}`);
const USAGE = new RegExp(`^clinics/main/materialUsages/${UUID}${END}`);
const IMAGE = new RegExp(`^clinics/main/invoiceImages/${UUID}${END}`);
const MATERIAL = /^clinics\/main\/materialBalances\/[0-9a-f]{64}(?![\s\S])/;
const RESERVATION = /^clinics\/main\/supplierInvoiceReservations\/[0-9a-f]{64}(?![\s\S])/;
const OPERATION = new RegExp(`^clinics/main/expenseOperations/${UUID}${END}`);
const PROOF = new RegExp(`^clinics/main/expenseInventoryProofs/${UUID}-(?:usage|edit|complete|header-[01]|math-(?:item|allocation|usage)-(?:[0-9]|1[0-9])-[0-3]|item-(?:[0-9]|1[0-9])|[0-5]-(?:[0-9]|1[0-9]))${END}`);
const INTENT = new RegExp(`^clinics/main/operationIntents/${UUID}${END}`);
const expenseKind = (kind: CloudOperationKind) => {
  if (kind !== 'expense') throw new CloudOperationIntentError('invalid');
};

export async function createFirebaseCloudExpenses(auth: Auth,
  options: FirebaseCloudExpensesOptions): Promise<FirebaseCloudExpensesCapability> {
  let revoked = false;
  let user: Auth['currentUser'], app: Auth['app'], uid: string | undefined;
  try { user = auth?.currentUser; app = auth?.app; uid = user?.uid; }
  catch { throw new CloudExpenseError('unavailable'); }
  const requireRuntime = () => {
    try {
      if (revoked || !options || typeof options.isActive !== 'function' || options.isActive() !== true
        || typeof window === 'undefined' || !isCloudOperatingRuntime(window.location.hostname, window.location.protocol)
        || !auth || !user || typeof uid !== 'string' || !uid || auth.currentUser !== user || user.uid !== uid || auth.app !== app
        || auth.app.options.projectId !== CLOUD_PROJECT_ID
        || auth.app.options.authDomain !== `${CLOUD_PROJECT_ID}.firebaseapp.com`
        || !APP.test(auth.app.name) || auth.emulatorConfig) throw new Error();
    } catch {
      revoked = true;
      throw new CloudExpenseError('unavailable');
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
      const command = prepareCloudExpenseCommand(intent.command);
      if (intent.kind !== 'expense' || intent.actorUid !== uid || command.createdAt !== intent.createdAt
        || path !== undefined && path !== `clinics/main/operationIntents/${intent.operationId}`
        || JSON.stringify(prepareCloudIntentCommand(command)) !== JSON.stringify(intent.command)) throw new Error();
    } catch { throw new CloudOperationIntentError('invalid'); }
    requireRuntime(); return intent;
  };
  try {
    requireRuntime();
    const [sdk, store] = await Promise.all([import('firebase/auth'), import('firebase/firestore/lite')]);
    requireRuntime();
    // Lite uses the exact named operating app, never a setup/default app or an
    // offline/cached write queue. No SDK object escapes this capability.
    const database = sdkCall(() => store.getFirestore(auth.app, '(default)'));
    const authorizeOwner = async () => {
      requireRuntime();
      const token = await sdkAwait(() => sdk.getIdTokenResult(user!));
      const identity = sdkCall(() => assessCloudOwnerIdentity({ uid: user!.uid, email: user!.email,
        emailVerified: user!.emailVerified, token }));
      if (identity.status !== 'owner-confirmed') throw new CloudExpenseError('unavailable');
      const authTime = sdkCall(() => Object.getOwnPropertyDescriptor(token.claims, 'auth_time')?.value);
      const reference = sdkCall(() => store.doc(database, 'clinics', 'main', 'members', identity.uid));
      const snapshot = await sdkAwait(() => store.getDoc(reference));
      if (!sdkCall(() => snapshot.exists())) throw new CloudExpenseError('unavailable');
      const member = sdkCall(() => snapshot.data());
      sdkCall(() => assessCloudOwnerMembership(identity, member, authTime));
      requireRuntime(); return identity.uid;
    };
    const reference = (path: string) => {
      requireRuntime();
      if (typeof path !== 'string' || !(RECORD.test(path) || PAYMENT.test(path) || USAGE.test(path) || MATERIAL.test(path)
        || IMAGE.test(path) || RESERVATION.test(path) || OPERATION.test(path) || INTENT.test(path) || PROOF.test(path))) throw new CloudExpenseError('invalid');
      return sdkCall(() => store.doc(database, path));
    };
    const readSnapshot = (path: string, snapshot: DocumentSnapshot) => {
      const value = sdkCall(() => snapshot.exists()) ? sdkCall(() => snapshot.data()) : null;
      // Validate the complete expense command inside the transaction read,
      // BEFORE generic journal cancellation is allowed to stage any write.
      if (value !== null && INTENT.test(path)) return checkedIntent(value, path);
      if (value !== null && IMAGE.test(path)) {
        const keys = ['schemaVersion', 'clinicId', 'recordId', 'expenseId', 'actorUid', 'createdAt', 'sha256', 'byteLength', 'width', 'height', 'contentType', 'bytes'];
        if (Reflect.ownKeys(value).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(value, key))) throw new CloudExpenseError('invalid');
        const bytes = sdkCall(() => value.bytes);
        if (!sdkCall(() => bytes instanceof store.Bytes)) throw new CloudExpenseError('invalid');
        const base64 = sdkCall(() => bytes.toBase64());
        const { bytes: ignored, ...metadata } = value;
        return sdkCall(() => parseCloudInvoiceImage({ ...metadata, base64 }));
      }
      requireRuntime(); return value;
    };
    const readRecord = async (path: string) => {
      requireRuntime();
      if (typeof path !== 'string' || !(RECORD.test(path) || MATERIAL.test(path) || IMAGE.test(path) || INTENT.test(path) || OPERATION.test(path))) {
        throw new CloudExpenseError('invalid');
      }
      return readSnapshot(path, await sdkAwait(() => store.getDoc(reference(path))));
    };
    const runTransaction = async <T>(work: (transaction: CloudExpenseTransaction) => Promise<T>): Promise<T> => {
      const result = await sdkAwait(() => store.runTransaction(database, async (transaction: Transaction) => {
        requireRuntime();
        const result = await work({
          get: async path => readSnapshot(path, await sdkAwait(() => transaction.get(reference(path)))),
          set: (path, value) => {
            const target = reference(path);
            if (INTENT.test(path)) checkedIntent(value, path);
            if (IMAGE.test(path)) {
              const image = sdkCall(() => parseCloudInvoiceImage(value)), { base64, ...metadata } = image;
              const bytes = sdkCall(() => store.Bytes.fromBase64String(base64));
              sdkCall(() => transaction.set(target, { ...metadata, bytes }));
            } else sdkCall(() => transaction.set(target, value));
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
        sdkCall(() => store.where('kind', '==', 'expense')),
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
    const listPage = async (collectionName: CloudExpenseCollection, ownerId: string | null, afterId: string | null, count: number) => {
      requireRuntime();
      if (!['expenseRecords', 'expensePayments', 'materialBalances', 'materialUsages'].includes(collectionName)
        || afterId !== null && !(collectionName === 'materialBalances' ? HASH.test(afterId) : ID.test(afterId))
        || ownerId !== null && !(collectionName === 'materialUsages' ? HASH.test(ownerId) : ID.test(ownerId))
        || (['expensePayments', 'materialUsages'].includes(collectionName) ? ownerId === null : ownerId !== null)
        || !Number.isSafeInteger(count) || count < 1 || count > 50) throw new CloudExpenseError('invalid');
      const constraints: QueryConstraint[] = [];
      if (ownerId !== null) constraints.push(sdkCall(() => store.where(collectionName === 'materialUsages' ? 'materialId' : 'expenseId', '==', ownerId)));
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
    const repository = createCloudExpenseRepository({ authorizeOwner, runTransaction,
      readRecord: target => {
        if (typeof target !== 'string' || !(RECORD.test(target) || MATERIAL.test(target) || IMAGE.test(target) || OPERATION.test(target) || INTENT.test(target))) throw new CloudExpenseError('invalid');
        return readRecord(target);
      }, listPage,
    });
    const journalRepository = createCloudOperationIntentRepository({ authorizeOwner, runTransaction,
      readRecord: path => {
        if (typeof path !== 'string' || !INTENT.test(path)) throw new CloudOperationIntentError('invalid');
        return readRecord(path);
      },
      listPreparedPage: (kind, actorUid, afterId, count) => { expenseKind(kind); return page(actorUid, afterId, count, true); },
      listHistoryPage: (kind, actorUid, afterId, count) => { expenseKind(kind); return page(actorUid, afterId, count, false); },
    });
    const journal = Object.freeze({
      prepare: (async (kind, input, createdAt) => {
        expenseKind(kind);
        let command;
        try { command = prepareCloudExpenseCommand(input); }
        catch { throw new CloudOperationIntentError('invalid'); }
        if (createdAt !== command.createdAt) throw new CloudOperationIntentError('invalid');
        return checkedIntent(await journalRepository.prepare(kind, command, createdAt));
      }) as typeof journalRepository.prepare,
      get: (async id => {
        const result = await journalRepository.get(id);
        return result === null ? null : checkedIntent(result);
      }) as typeof journalRepository.get,
      listPreparedPage: (async (kind, input) => {
        expenseKind(kind);
        const result = await journalRepository.listPreparedPage(kind, input);
        return { records: result.records.map(intent => checkedIntent(intent)), nextAfterId: result.nextAfterId };
      }) as typeof journalRepository.listPreparedPage,
      listHistoryPage: (async (kind, input) => {
        expenseKind(kind);
        const result = await journalRepository.listHistoryPage(kind, input);
        return { records: result.records.map(intent => checkedIntent(intent)), nextAfterId: result.nextAfterId };
      }) as typeof journalRepository.listHistoryPage,
      cancel: (async id => checkedIntent(await journalRepository.cancel(id))) as typeof journalRepository.cancel,
    });
    requireRuntime(); return Object.freeze({ repository: Object.freeze(repository), journal });
  } catch {
    throw new CloudExpenseError('unavailable');
  }
}


