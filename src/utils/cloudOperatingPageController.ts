import { CloudOperatingAuthError, cloudOperatingAuthErrorMessage,
  type CloudOperatingAuthSession, type CloudOperatingAuthState } from './cloudOperatingAuth';

export type CloudOperatingPageState = Readonly<{
  auth: CloudOperatingAuthState;
  pending: boolean;
  closing: boolean;
  error: string;
  cleanupFailed: boolean;
}>;

const CLEANUP_ERROR = 'تعذر تأكيد إغلاق جلسة الدخول. أعد تحميل الصفحة قبل المحاولة من جديد.';
const SIGN_IN_FIRST = 'سجّل الدخول أولًا لتحديث حالة الحساب.';

function authState(phase: CloudOperatingAuthState['phase']): CloudOperatingAuthState {
  return Object.freeze({ phase, owner: null });
}

/**
 * One isolated view lifetime. No SDK work happens until an explicit sign-in.
 * The view may abandon a delayed factory, but still owns and disposes its late
 * result. An owner snapshot never opens App or authorizes clinical operations.
 */
export function createCloudOperatingPageController(
  factory: () => Promise<CloudOperatingAuthSession>,
  isRuntimeValid: () => boolean,
) {
  let state: CloudOperatingPageState = Object.freeze({ auth: authState('signed-out'),
    pending: false, closing: false, error: '', cleanupFailed: false });
  const listeners = new Set<(value: CloudOperatingPageState) => void>();
  let epoch = 0;
  let closed = false;
  let cleanupFailed = false;
  let session: CloudOperatingAuthSession | null = null;
  let creation: Promise<CloudOperatingAuthSession> | null = null;
  let unsubscribe: (() => void) | null = null;
  let closing: Promise<boolean> | null = null;
  let disposal: Promise<void> | null = null;

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

  async function getSession(ticket: number): Promise<CloudOperatingAuthSession | null> {
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
    let candidate: CloudOperatingAuthSession;
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
    try { stop?.(); } catch { /* Session disposal remains mandatory. */ }

    // Invalidate an existing Auth lifecycle synchronously. Deferring dispose()
    // would let its queued sign-in begin after a view cancelled on "checking".
    let immediateDisposal: Promise<boolean> | null = null;
    if (oldSession) {
      try { immediateDisposal = Promise.resolve(oldSession.dispose()).then(() => true, () => false); }
      catch { immediateDisposal = Promise.resolve(false); }
    }

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
    publish({ auth: authState(permanent ? 'closed' : 'signing-out'), pending: false,
      closing: true, error: cleanupFailed ? CLEANUP_ERROR : '', cleanupFailed });
    // Register completion before returning: a true result includes the final
    // confirmed UI state, not merely an initiated disposal attempt.
    void work.then(success => {
      if (closing !== work) return;
      closing = null;
      if (!success) cleanupFailed = true;
      publish({ auth: authState(closed ? 'closed' : 'signed-out'), pending: false,
        closing: false, error: cleanupFailed ? CLEANUP_ERROR : '', cleanupFailed }, !closed);
    });
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
    if (closed || closing || cleanupFailed || state.pending) return;
    if (!runtimeValid()) { await rejectRuntime(); return; }
    if (kind === 'refresh' && !session) {
      publish({ ...state, auth: authState('signed-out'), error: SIGN_IN_FIRST });
      return;
    }
    const ticket = ++epoch;
    publish({ ...state, auth: authState('checking'), pending: true, error: '' });
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

  return {
    getState: () => state,
    subscribe: (listener: (value: CloudOperatingPageState) => void) => {
      if (closed) return () => undefined;
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    signIn: (email: string, password: string) => run('sign-in', email, password),
    refresh: () => run('refresh'),
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
