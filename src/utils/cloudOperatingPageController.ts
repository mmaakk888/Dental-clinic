import { CloudOperatingAuthError, cloudOperatingAuthErrorMessage,
  type CloudOperatingAuthSession, type CloudOperatingAuthState,
  type CloudOperatingFirebaseSession } from './cloudOperatingAuth';
import type { createCloudContactWorkspaceController } from './cloudContactWorkspaceController';

export type CloudOperatingContactsWorkspace = ReturnType<typeof createCloudContactWorkspaceController>;
export type CloudOperatingPageSession = CloudOperatingAuthSession & Partial<Pick<CloudOperatingFirebaseSession, 'getContacts'>>;
export type CloudOperatingContactsState = Readonly<{
  phase: 'closed' | 'opening' | 'open';
  error: string;
}>;

export type CloudOperatingPageState = Readonly<{
  auth: CloudOperatingAuthState;
  pending: boolean;
  closing: boolean;
  error: string;
  cleanupFailed: boolean;
  contacts: CloudOperatingContactsState;
}>;

const CLEANUP_ERROR = 'تعذر تأكيد إغلاق جلسة الدخول. أعد تحميل الصفحة قبل المحاولة من جديد.';
const SIGN_IN_FIRST = 'سجّل الدخول أولًا لتحديث حالة الحساب.';
const CONTACTS_ERROR = 'تعذر فتح مساحة جهات الاتصال. لم نستخدم بيانات محلية بديلة.';
const CONTACTS_UNAVAILABLE = 'مساحة جهات الاتصال غير متاحة في جلسة الدخول الحالية.';
const CONTACTS_CLOSE_ERROR = 'أكمل المسودة أو ألغها أولًا؛ العملية غير المؤكدة تحتاج إعادة التحقق قبل الإغلاق.';

function contactsState(phase: CloudOperatingContactsState['phase'], error = ''): CloudOperatingContactsState {
  return Object.freeze({ phase, error });
}

function authState(phase: CloudOperatingAuthState['phase']): CloudOperatingAuthState {
  return Object.freeze({ phase, owner: null });
}

/**
 * One isolated view lifetime. No SDK work happens until an explicit sign-in.
 * The view may abandon a delayed factory, but still owns and disposes its late
 * result. An owner snapshot never opens App or authorizes clinical operations.
 */
export function createCloudOperatingPageController(
  factory: () => Promise<CloudOperatingPageSession>,
  isRuntimeValid: () => boolean,
) {
  let state: CloudOperatingPageState = Object.freeze({ auth: authState('signed-out'),
    pending: false, closing: false, error: '', cleanupFailed: false, contacts: contactsState('closed') });
  const listeners = new Set<(value: CloudOperatingPageState) => void>();
  let epoch = 0;
  let closed = false;
  let cleanupFailed = false;
  let session: CloudOperatingPageSession | null = null;
  let creation: Promise<CloudOperatingPageSession> | null = null;
  let unsubscribe: (() => void) | null = null;
  let closing: Promise<boolean> | null = null;
  let disposal: Promise<void> | null = null;
  let contactsLease = 0;
  let contactsWorkspace: CloudOperatingContactsWorkspace | null = null;
  let contactsOpening: Promise<CloudOperatingContactsWorkspace | null> | null = null;
  let contactsIdentity: { session: CloudOperatingPageSession; uid: string } | null = null;
  let contactsInvalidating = false;

  function publish(next: CloudOperatingPageState, notify = true) {
    state = Object.freeze(next);
    if (!notify) return;
    for (const listener of [...listeners]) {
      try { listener(state); } catch { /* A view cannot interrupt cleanup. */ }
    }
  }

  function runtimeValid(): boolean {
    try { return isRuntimeValid() === true; } catch { return false; }
  }

  const active = (ticket: number) => !closed && !closing && !cleanupFailed && ticket === epoch;

  function revokeContacts() {
    ++contactsLease;
    const previous = contactsWorkspace;
    contactsWorkspace = null;
    contactsOpening = null;
    contactsIdentity = null;
    publish({ ...state, contacts: contactsState('closed') }, false);
    const wasInvalidating = contactsInvalidating;
    contactsInvalidating = true;
    try { previous?.dispose(); } finally { contactsInvalidating = wasInvalidating; }
  }

  function contactsActive(ticket: number, candidate: CloudOperatingPageSession, uid: string): boolean {
    const owned = () => !closed && !closing && !cleanupFailed && !contactsInvalidating
      && contactsLease === ticket && session === candidate;
    if (!owned()) return false;
    if (!runtimeValid()) { void rejectRuntime(); return false; }
    // Injected runtime/session boundaries can synchronously close this lease.
    // A true return value must not revive an opening cancelled inside them.
    if (!owned()) return false;
    const auth = candidate.getState();
    if (!owned()) return false;
    if (auth.phase === 'signed-out' || auth.phase === 'signing-out' || auth.phase === 'closed'
      || auth.phase === 'owner-checked' && auth.owner?.uid !== uid) {
      revokeContacts();
      if (!closed && !closing && !cleanupFailed && session === candidate) publish({ ...state, auth });
      return false;
    }
    // Canonical reauthorization legitimately publishes checking with no owner.
    // The exact session + lease, not that transient UI snapshot, owns drafts.
    return true;
  }

  async function getSession(ticket: number): Promise<CloudOperatingPageSession | null> {
    if (!active(ticket)) return null;
    if (session) return session;
    if (!creation) {
      // Assign ownership before invoking a factory that may synchronously call
      // a view callback, throw, or return a delayed result.
      creation = Promise.resolve().then(() => {
        if (!active(ticket)) throw new CloudOperatingAuthError('changed');
        if (!runtimeValid()) throw new CloudOperatingAuthError('unavailable');
        return factory();
      });
    }
    const started = creation;
    let candidate: CloudOperatingPageSession;
    try { candidate = await started; }
    catch (error) {
      if (creation === started) creation = null;
      throw error;
    }
    if (!active(ticket)) return null;
    session = candidate;
    const stop = candidate.subscribe(auth => {
      if (closed || closing || cleanupFailed || session !== candidate) return;
      if (!runtimeValid()) { void rejectRuntime(); return; }
      if (auth.phase === 'signed-out' || auth.phase === 'signing-out' || auth.phase === 'closed'
        || auth.phase === 'owner-checked' && contactsIdentity && auth.owner?.uid !== contactsIdentity.uid) {
        publish({ ...state, auth }, false);
        revokeContacts();
        if (closed || closing || cleanupFailed || session !== candidate) return;
      }
      publish({ ...state, auth });
    });
    // A synthetic synchronous subscription notification may close this view.
    if (active(ticket) && session === candidate) unsubscribe = stop;
    else { try { stop(); } catch { /* Disposal still owns the SDK session. */ } }
    return active(ticket) ? candidate : null;
  }

  function beginClose(permanent: boolean): Promise<boolean> {
    if (closing) return closing;
    ++epoch;
    const oldSession = session;
    const oldCreation = creation;
    session = null;
    creation = null;
    const stop = unsubscribe;
    unsubscribe = null;

    // Invalidate an existing Auth lifecycle synchronously. Deferring dispose()
    // would let its queued sign-in begin after a view cancelled on "checking".
    let immediateDisposal: Promise<boolean> | null = null;
    const work = Promise.resolve().then(async () => {
      if (cleanupFailed) return false;
      if (immediateDisposal) return immediateDisposal;
      let candidate = oldSession;
      if (!candidate && oldCreation) {
        try { candidate = await oldCreation; }
        catch { return true; } // No returned SDK session to clean up.
      }
      if (!candidate) return true;
      try { await candidate.dispose(); return true; }
      catch { return false; }
    });
    closing = work;
    // Register completion before returning: a true result includes the final
    // confirmed UI state, not merely an initiated disposal attempt.
    void work.then(success => {
      if (closing !== work) return;
      closing = null;
      if (!success) cleanupFailed = true;
      publish({ auth: authState(closed ? 'closed' : 'signed-out'), pending: false,
        closing: false, error: cleanupFailed ? CLEANUP_ERROR : '', cleanupFailed,
        contacts: contactsState('closed') }, !closed);
    });
    // Establish closing ownership/state before workspace disposal callbacks can
    // synchronously attempt another close, open, sign-in or view disposal.
    publish({ auth: authState(permanent ? 'closed' : 'signing-out'), pending: false,
      closing: true, error: cleanupFailed ? CLEANUP_ERROR : '', cleanupFailed,
      contacts: contactsState('closed') }, false);
    revokeContacts();
    try { stop?.(); } catch { /* Session disposal remains mandatory. */ }
    if (oldSession) {
      try { immediateDisposal = Promise.resolve(oldSession.dispose()).then(() => true, () => false); }
      catch { immediateDisposal = Promise.resolve(false); }
    }
    publish(state);
    return work;
  }

  async function rejectRuntime() {
    const work = beginClose(false);
    const ticket = epoch;
    await work;
    if (!closed && ticket === epoch && !cleanupFailed) {
      publish({ ...state, error: cloudOperatingAuthErrorMessage(new CloudOperatingAuthError('unavailable')) });
    }
  }

  async function run(kind: 'sign-in' | 'refresh', email?: string, password?: string): Promise<void> {
    if (closed || closing || cleanupFailed || state.pending || contactsInvalidating || contactsOpening
      || session?.getState().phase === 'checking') return;
    if (!runtimeValid()) { await rejectRuntime(); return; }
    if (kind === 'refresh' && !session) {
      publish({ ...state, auth: authState('signed-out'), error: SIGN_IN_FIRST });
      return;
    }
    const ticket = ++epoch;
    publish({ ...state, auth: authState('checking'), pending: true, error: '' }, false);
    if (kind === 'sign-in') revokeContacts();
    publish(state);
    try {
      const current = await getSession(ticket);
      if (!current || !active(ticket)) return;
      if (!runtimeValid()) { await rejectRuntime(); return; }
      if (kind === 'sign-in') await current.signIn(email!, password!);
      else await current.authorizeOwner();
      if (!active(ticket)) return;
      if (!runtimeValid()) { await rejectRuntime(); return; }
      // Never resurrect the returned owner: SDK invalidation may already have
      // replaced it with signed-out while this continuation was queued.
      publish({ ...state, auth: current.getState(), error: '' });
    } catch (error) {
      if (active(ticket)) {
        const message = cloudOperatingAuthErrorMessage(error);
        // Core authorization failure may also have failed SDK sign-out. Do
        // not retain that ambiguous session or offer a misleading retry.
        const work = beginClose(false);
        const closingTicket = epoch;
        await work;
        if (!closed && closingTicket === epoch && !cleanupFailed) {
          publish({ ...state, error: message });
        }
      }
    } finally {
      if (active(ticket)) publish({ ...state, pending: false });
      else if (closing) await closing;
    }
  }

  function getContactsWorkspace(): CloudOperatingContactsWorkspace | null {
    const identity = contactsIdentity;
    if (!identity || !contactsActive(contactsLease, identity.session, identity.uid)) return null;
    return contactsWorkspace;
  }

  function openContacts(): Promise<CloudOperatingContactsWorkspace | null> {
    if (closed || closing || cleanupFailed || contactsInvalidating) return Promise.resolve(null);
    if (!runtimeValid()) { void rejectRuntime(); return Promise.resolve(null); }
    if (contactsOpening) return contactsOpening;
    const existing = getContactsWorkspace();
    if (existing) return Promise.resolve(existing);
    const candidate = session;
    const owner = candidate?.getState().owner;
    if (!candidate || state.pending || state.auth.phase !== 'owner-checked'
      || candidate.getState().phase !== 'owner-checked' || !owner) {
      publish({ ...state, contacts: contactsState('closed', CONTACTS_UNAVAILABLE) });
      return Promise.resolve(null);
    }
    if (typeof candidate.getContacts !== 'function') {
      publish({ ...state, contacts: contactsState('closed', CONTACTS_UNAVAILABLE) });
      return Promise.resolve(null);
    }
    const ticket = ++contactsLease;
    contactsIdentity = { session: candidate, uid: owner.uid };
    const work: Promise<CloudOperatingContactsWorkspace | null> = Promise.resolve().then(async () => {
      try {
        if (!contactsActive(ticket, candidate, owner.uid)) return null;
        const repository = await candidate.getContacts!();
        if (!contactsActive(ticket, candidate, owner.uid)) return null;
        const workspace = await import('./cloudContactWorkspaceController');
        if (!contactsActive(ticket, candidate, owner.uid)) return null;
        const controller = workspace.createCloudContactWorkspaceController({
          getRepository: async () => {
            if (!contactsActive(ticket, candidate, owner.uid)) throw new CloudOperatingAuthError('changed');
            return repository;
          },
          isActive: () => contactsActive(ticket, candidate, owner.uid),
        });
        if (!contactsActive(ticket, candidate, owner.uid)) { controller.dispose(); return null; }
        contactsWorkspace = controller;
        publish({ ...state, contacts: contactsState('open') });
        // A subscriber may synchronously sign out or dispose on open.
        return contactsActive(ticket, candidate, owner.uid) && contactsWorkspace === controller ? controller : null;
      } catch {
        if (closed || closing || cleanupFailed || session !== candidate) return null;
        const phase = candidate.getState().phase;
        if (contactsLease !== ticket && phase !== 'signed-out' && phase !== 'signing-out' && phase !== 'closed') return null;
        const cleanup = beginClose(false);
        const closingTicket = epoch;
        await cleanup;
        if (!closed && closingTicket === epoch && !cleanupFailed) {
          publish({ ...state, contacts: contactsState('closed', CONTACTS_ERROR) });
        }
        return null;
      } finally {
        if (contactsOpening === work) contactsOpening = null;
      }
    });
    contactsOpening = work;
    publish({ ...state, contacts: contactsState('opening') });
    return work;
  }

  function closeContacts(): boolean {
    if (closed || closing || contactsInvalidating) return false;
    if (!runtimeValid()) { void rejectRuntime(); return false; }
    const workspace = getContactsWorkspace();
    if (workspace) {
      const current = workspace.getState();
      if (current.draft || current.saveStatus !== 'idle') {
        publish({ ...state, contacts: contactsState('open', CONTACTS_CLOSE_ERROR) });
        return false;
      }
    }
    revokeContacts();
    publish(state);
    return true;
  }

  return {
    getState: () => {
      if (contactsIdentity && !runtimeValid()) void rejectRuntime();
      return state;
    },
    subscribe: (listener: (value: CloudOperatingPageState) => void) => {
      if (closed) return () => undefined;
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    signIn: (email: string, password: string) => run('sign-in', email, password),
    refresh: () => run('refresh'),
    openContacts,
    getContactsWorkspace,
    closeContacts,
    signOut: (): Promise<boolean> => closed ? Promise.resolve(false) : beginClose(false),
    dispose: (): Promise<void> => {
      if (disposal) return disposal;
      closed = true;
      ++epoch;
      // Assign before the closing notification so re-entrant view cleanup is
      // idempotent, including during an earlier explicit sign-out.
      let finish!: () => void;
      disposal = new Promise<void>(resolve => { finish = resolve; });
      const wasClosing = closing !== null;
      const work = beginClose(true);
      if (wasClosing) publish({ ...state, auth: authState('closed'), pending: false });
      listeners.clear();
      void work.then(() => finish(), () => finish());
      return disposal;
    },
  };
}

export type CloudOperatingPageController = ReturnType<typeof createCloudOperatingPageController>;
