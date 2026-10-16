import { CloudOperatingAuthError, cloudOperatingAuthErrorMessage,
  type CloudOperatingAuthSession, type CloudOperatingAuthState,
  type CloudOperatingFirebaseSession } from './cloudOperatingAuth';
import type { createCloudContactWorkspaceController } from './cloudContactWorkspaceController';
import type { CloudPatientWorkspaceController } from './cloudPatientWorkspaceController';
import type { CloudClinicalWorkspaceBundle } from './cloudClinicalUiStage';
import type { CloudCatalogWorkspaceController } from './cloudCatalogWorkspaceController';

export type CloudOperatingContactsWorkspace = ReturnType<typeof createCloudContactWorkspaceController>;
type AdditionalCapabilityKey = 'getContacts' | 'getPatients' | 'getClinical' | 'getServiceCatalog'
  | 'getAppointments' | 'getClinicSettings' | 'getProsthetics' | 'getExpenses' | 'getClinicSnapshot';
export type CloudOperatingPageSession = CloudOperatingAuthSession & Partial<Pick<CloudOperatingFirebaseSession, AdditionalCapabilityKey>>;
export type CloudOperatingAdditionalKind = 'appointments' | 'prosthetics' | 'expenses' | 'settings' | 'directory' | 'finance' | 'home' | 'export' | 'whatsapp' | 'transfer' | 'prescription';
export interface CloudOperatingAdditionalWorkspace { canClose(): boolean; dispose(): void }
export type CloudOperatingAdditionalContext = Pick<CloudOperatingFirebaseSession, AdditionalCapabilityKey> & {
  readonly ownerUid: string; readonly isActive: () => boolean;
};
export type CloudOperatingPatientsWorkspace = CloudPatientWorkspaceController;
export type CloudOperatingClinicalWorkspace = CloudClinicalWorkspaceBundle;
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
  patients: CloudOperatingContactsState;
  clinical: CloudOperatingContactsState;
  catalog: CloudOperatingContactsState;
}>;

const CLEANUP_ERROR = 'تعذر تأكيد إغلاق جلسة الدخول. أعد تحميل الصفحة قبل المحاولة من جديد.';
const SIGN_IN_FIRST = 'سجّل الدخول أولًا لتحديث حالة الحساب.';
const CONTACTS_ERROR = 'تعذر فتح مساحة جهات الاتصال. لم نستخدم بيانات محلية بديلة.';
const CONTACTS_UNAVAILABLE = 'مساحة جهات الاتصال غير متاحة في جلسة الدخول الحالية.';
const CONTACTS_CLOSE_ERROR = 'أكمل المسودة أو ألغها أولًا؛ انتظر القراءة وتحقق من العملية غير المؤكدة قبل الإغلاق.';
const PATIENTS_ERROR = 'تعذر فتح مساحة ملفات المرضى. لم نستخدم بيانات محلية بديلة.';
const PATIENTS_UNAVAILABLE = 'مساحة ملفات المرضى غير متاحة في جلسة الدخول الحالية.';
const CLINICAL_ERROR = 'تعذر فتح الملف السريري وسجل الاسترجاع. لم نستخدم بيانات محلية بديلة.';
const CLINICAL_UNAVAILABLE = 'الملف السريري وسجل الاسترجاع غير متاحين في جلسة الدخول الحالية.';
const CLINICAL_CLOSE_ERROR = 'أكمل المسودة أو ألغها أولًا؛ انتظر انتهاء القراءة وتحقق من العملية المعلّقة قبل الإغلاق.';
const CATALOG_ERROR = 'تعذر فتح الخدمات والأسعار. لم نستخدم إعدادات محلية بديلة.';
const CATALOG_UNAVAILABLE = 'الخدمات والأسعار غير متاحة في جلسة الدخول الحالية.';

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
    pending: false, closing: false, error: '', cleanupFailed: false,
    contacts: contactsState('closed'), patients: contactsState('closed'), clinical: contactsState('closed'), catalog: contactsState('closed') });
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
  let patientsLease = 0;
  let patientsWorkspace: CloudOperatingPatientsWorkspace | null = null;
  let patientsOpening: Promise<CloudOperatingPatientsWorkspace | null> | null = null;
  let patientsIdentity: { session: CloudOperatingPageSession; uid: string } | null = null;
  let patientsInvalidating = false;
  let clinicalLease = 0;
  let clinicalWorkspace: CloudOperatingClinicalWorkspace | null = null;
  let clinicalOpening: Promise<CloudOperatingClinicalWorkspace | null> | null = null;
  let clinicalIdentity: { session: CloudOperatingPageSession; uid: string } | null = null;
  let clinicalInvalidating = false;
  let catalogLease = 0;
  let catalogWorkspace: CloudCatalogWorkspaceController | null = null;
  let catalogOpening: Promise<CloudCatalogWorkspaceController | null> | null = null;
  let catalogIdentity: { session: CloudOperatingPageSession; uid: string } | null = null;
  let catalogInvalidating = false;
  let workspaceSwitching = false;
  let additionalLease = 0, additionalInvalidating = false;
  let additionalWorkspace: CloudOperatingAdditionalWorkspace | null = null;
  let additionalOpening: Promise<CloudOperatingAdditionalWorkspace | null> | null = null;
  let additionalIdentity: { session: CloudOperatingPageSession; uid: string; kind: CloudOperatingAdditionalKind } | null = null;

  function revokeAdditional() {
    ++additionalLease;
    const previous = additionalWorkspace;
    additionalWorkspace = null; additionalOpening = null; additionalIdentity = null;
    const old = additionalInvalidating; additionalInvalidating = true;
    try { previous?.dispose(); } catch { /* Lease revoked before untrusted cleanup. */ }
    finally { additionalInvalidating = old; }
  }
  function additionalActive(ticket: number, candidate: CloudOperatingPageSession, uid: string): boolean {
    const owned = () => !closed && !closing && !cleanupFailed && !additionalInvalidating
      && additionalLease === ticket && session === candidate;
    if (!owned()) return false;
    if (!runtimeValid()) { void rejectRuntime(); return false; }
    if (!owned()) return false;
    const auth = candidate.getState();
    if (!owned()) return false;
    if (auth.phase === 'signed-out' || auth.phase === 'signing-out' || auth.phase === 'closed'
      || auth.phase === 'owner-checked' && auth.owner?.uid !== uid) {
      revokeAdditional();
      if (!closed && !closing && !cleanupFailed && session === candidate) publish({ ...state, auth });
      return false;
    }
    return true;
  }
  function getAdditionalWorkspace(kind?: CloudOperatingAdditionalKind): CloudOperatingAdditionalWorkspace | null {
    const identity = additionalIdentity;
    if (!identity || kind !== undefined && identity.kind !== kind || !additionalActive(additionalLease, identity.session, identity.uid)) return null;
    return additionalWorkspace;
  }
  function closeAdditional(expected?: CloudOperatingAdditionalWorkspace): boolean {
    if (closed || closing || cleanupFailed || additionalInvalidating) return false;
    const ticket = additionalLease, identity = additionalIdentity;
    if (!runtimeValid()) { void rejectRuntime(); return false; }
    const workspace = getAdditionalWorkspace();
    const owned = () => !closed && !closing && !cleanupFailed && additionalLease === ticket
      && additionalIdentity === identity && additionalWorkspace === workspace;
    if (!owned() || expected && workspace !== expected) return false;
    if (workspace) {
      let allowed = false;
      try { allowed = workspace.canClose() === true; } catch { /* Fail closed. */ }
      if (!owned()) return false;
      if (!allowed) { publish({ ...state, error: CLINICAL_CLOSE_ERROR }); return false; }
    }
    if (!owned()) return false;
    revokeAdditional(); publish(state); return true;
  }
  function closeAdditionalForSwitch(): boolean {
    if (additionalOpening || additionalInvalidating) return false;
    if (!additionalWorkspace) return true;
    workspaceSwitching = true;
    try { return closeAdditional(); } finally { workspaceSwitching = false; }
  }
  function openAdditional<T extends CloudOperatingAdditionalWorkspace>(kind: CloudOperatingAdditionalKind,
    create: (context: CloudOperatingAdditionalContext) => T | Promise<T>): Promise<T | null> {
    if (!['appointments', 'prosthetics', 'expenses', 'settings', 'directory', 'finance', 'home', 'export', 'whatsapp', 'transfer', 'prescription'].includes(kind)
      || typeof create !== 'function' || closed || closing || cleanupFailed || state.pending || workspaceSwitching
      || additionalInvalidating || contactsInvalidating || patientsInvalidating || clinicalInvalidating || catalogInvalidating) return Promise.resolve(null);
    if (!runtimeValid()) { void rejectRuntime(); return Promise.resolve(null); }
    if (additionalOpening) return additionalIdentity?.kind === kind ? additionalOpening as Promise<T | null> : Promise.resolve(null);
    if (additionalIdentity?.kind === kind && getAdditionalWorkspace()) return Promise.resolve(additionalWorkspace as T);
    const candidate = session, owner = candidate?.getState().owner;
    if (!candidate || !owner || state.auth.phase !== 'owner-checked' || candidate.getState().phase !== 'owner-checked') return Promise.resolve(null);
    workspaceSwitching = true;
    try {
      if (additionalWorkspace && !closeAdditional()) return Promise.resolve(null);
      if ((contactsWorkspace || contactsOpening) && !closeContacts()) return Promise.resolve(null);
      if ((patientsWorkspace || patientsOpening) && !closePatients()) return Promise.resolve(null);
      if ((clinicalWorkspace || clinicalOpening) && !closeClinical()) return Promise.resolve(null);
      if ((catalogWorkspace || catalogOpening) && !closeCatalog()) return Promise.resolve(null);
    } finally { workspaceSwitching = false; }
    if (closed || closing || cleanupFailed || session !== candidate || !runtimeValid()
      || candidate.getState().phase !== 'owner-checked' || candidate.getState().owner?.uid !== owner.uid) return Promise.resolve(null);
    const ticket = ++additionalLease;
    additionalIdentity = { session: candidate, uid: owner.uid, kind };
    const isActive = () => additionalActive(ticket, candidate, owner.uid);
    const requireActive = () => { if (!isActive()) throw new CloudOperatingAuthError('unavailable'); };
    const keys: AdditionalCapabilityKey[] = ['getContacts', 'getPatients', 'getClinical', 'getServiceCatalog',
      'getAppointments', 'getClinicSettings', 'getProsthetics', 'getExpenses', 'getClinicSnapshot'];
    const getters = Object.fromEntries(keys.map(key => [key, async () => {
      requireActive(); const method = candidate[key]; requireActive();
      if (typeof method !== 'function') throw new CloudOperatingAuthError('unavailable');
      const result = await Promise.resolve().then(() => { requireActive(); return method.call(candidate); });
      requireActive(); return result;
    }])) as Pick<CloudOperatingFirebaseSession, AdditionalCapabilityKey>;
    const context = Object.freeze({ ...getters, ownerUid: owner.uid, isActive });
    const opening = Promise.resolve().then(async () => {
      let created: T | null = null;
      try {
        requireActive(); created = await create(context); requireActive();
        if (!created || typeof created.dispose !== 'function' || typeof created.canClose !== 'function') throw new CloudOperatingAuthError('unavailable');
        requireActive(); additionalWorkspace = created; additionalOpening = null;
        publish({ ...state, error: '' });
        return isActive() && additionalWorkspace === created ? created : null;
      } catch {
        try { created?.dispose(); } catch { /* Lease remains closed. */ }
        if (isActive()) { revokeAdditional(); publish({ ...state, error: 'تعذر فتح القسم؛ لم نستخدم بيانات محلية بديلة.' }); }
        return null;
      }
    });
    additionalOpening = opening;
    publish({ ...state, error: '' });
    return opening;
  }

  function publish(next: CloudOperatingPageState, notify = true) {
    const published = Object.freeze(next);
    state = published;
    if (!notify) return;
    for (const listener of [...listeners]) {
      try { listener(published); } catch { /* A view cannot interrupt cleanup. */ }
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

  function revokePatients() {
    ++patientsLease;
    const previous = patientsWorkspace;
    patientsWorkspace = null;
    patientsOpening = null;
    patientsIdentity = null;
    publish({ ...state, patients: contactsState('closed') }, false);
    const wasInvalidating = patientsInvalidating;
    patientsInvalidating = true;
    try { previous?.dispose(); } finally { patientsInvalidating = wasInvalidating; }
  }

  function patientsActive(ticket: number, candidate: CloudOperatingPageSession, uid: string): boolean {
    const owned = () => !closed && !closing && !cleanupFailed && !patientsInvalidating
      && patientsLease === ticket && session === candidate;
    if (!owned()) return false;
    if (!runtimeValid()) { void rejectRuntime(); return false; }
    if (!owned()) return false;
    const auth = candidate.getState();
    if (!owned()) return false;
    if (auth.phase === 'signed-out' || auth.phase === 'signing-out' || auth.phase === 'closed'
      || auth.phase === 'owner-checked' && auth.owner?.uid !== uid) {
      revokePatients();
      if (!closed && !closing && !cleanupFailed && session === candidate) publish({ ...state, auth });
      return false;
    }
    // A metadata refresh is not a new identity/view lifetime.
    return true;
  }

  function revokeClinical() {
    ++clinicalLease;
    const previous = clinicalWorkspace;
    clinicalWorkspace = null;
    clinicalOpening = null;
    clinicalIdentity = null;
    publish({ ...state, clinical: contactsState('closed') }, false);
    const wasInvalidating = clinicalInvalidating;
    clinicalInvalidating = true;
    // Both leases are revoked before either controller notifies subscribers.
    // Actual logout hides memory, but cannot undo a server-accepted command.
    try { previous?.visit?.dispose(); }
    finally {
      try { previous?.file.dispose(); }
      finally {
        try { previous?.recovery.dispose(); }
        finally { clinicalInvalidating = wasInvalidating; }
      }
    }
  }

  function clinicalActive(ticket: number, candidate: CloudOperatingPageSession, uid: string): boolean {
    const owned = () => !closed && !closing && !cleanupFailed && !clinicalInvalidating
      && clinicalLease === ticket && session === candidate;
    if (!owned()) return false;
    if (!runtimeValid()) { void rejectRuntime(); return false; }
    if (!owned()) return false;
    const auth = candidate.getState();
    if (!owned()) return false;
    if (auth.phase === 'signed-out' || auth.phase === 'signing-out' || auth.phase === 'closed'
      || auth.phase === 'owner-checked' && auth.owner?.uid !== uid) {
      revokeClinical();
      if (!closed && !closing && !cleanupFailed && session === candidate) publish({ ...state, auth });
      return false;
    }
    // Checking is not identity loss; retain dirty and uncertain work.
    return true;
  }

  function revokeCatalog() {
    ++catalogLease;
    const previous = catalogWorkspace;
    catalogWorkspace = null; catalogOpening = null; catalogIdentity = null;
    publish({ ...state, catalog: contactsState('closed') }, false);
    const wasInvalidating = catalogInvalidating;
    catalogInvalidating = true;
    try { previous?.dispose(); } finally { catalogInvalidating = wasInvalidating; }
  }

  function catalogActive(ticket: number, candidate: CloudOperatingPageSession, uid: string): boolean {
    const owned = () => !closed && !closing && !cleanupFailed && !catalogInvalidating
      && catalogLease === ticket && session === candidate;
    if (!owned()) return false;
    if (!runtimeValid()) { void rejectRuntime(); return false; }
    if (!owned()) return false;
    const auth = candidate.getState();
    if (!owned()) return false;
    if (auth.phase === 'signed-out' || auth.phase === 'signing-out' || auth.phase === 'closed'
      || auth.phase === 'owner-checked' && auth.owner?.uid !== uid) {
      revokeCatalog();
      if (!closed && !closing && !cleanupFailed && session === candidate) publish({ ...state, auth });
      return false;
    }
    return true; // Transient checking does not discard an ordinary draft.
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
        || auth.phase === 'owner-checked' && (contactsIdentity && auth.owner?.uid !== contactsIdentity.uid
          || patientsIdentity && auth.owner?.uid !== patientsIdentity.uid
          || clinicalIdentity && auth.owner?.uid !== clinicalIdentity.uid
          || catalogIdentity && auth.owner?.uid !== catalogIdentity.uid
          || additionalIdentity && auth.owner?.uid !== additionalIdentity.uid)) {
        publish({ ...state, auth }, false);
        revokeContacts();
        revokePatients();
        revokeClinical();
        revokeCatalog();
        revokeAdditional();
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
        contacts: contactsState('closed'), patients: contactsState('closed'), clinical: contactsState('closed'), catalog: contactsState('closed') }, !closed);
    });
    // Establish closing ownership/state before workspace disposal callbacks can
    // synchronously attempt another close, open, sign-in or view disposal.
    publish({ auth: authState(permanent ? 'closed' : 'signing-out'), pending: false,
      closing: true, error: cleanupFailed ? CLEANUP_ERROR : '', cleanupFailed,
      contacts: contactsState('closed'), patients: contactsState('closed'), clinical: contactsState('closed'), catalog: contactsState('closed') }, false);
    revokeContacts();
    revokePatients();
    revokeClinical();
    revokeCatalog();
    revokeAdditional();
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
      || patientsInvalidating || patientsOpening || clinicalInvalidating || clinicalOpening || catalogInvalidating || catalogOpening || workspaceSwitching
      || additionalInvalidating || additionalOpening
      || session?.getState().phase === 'checking') return;
    if (!runtimeValid()) { await rejectRuntime(); return; }
    if (kind === 'refresh' && !session) {
      publish({ ...state, auth: authState('signed-out'), error: SIGN_IN_FIRST });
      return;
    }
    const ticket = ++epoch;
    publish({ ...state, auth: authState('checking'), pending: true, error: '' }, false);
    if (kind === 'sign-in') { revokeContacts(); revokePatients(); revokeClinical(); revokeCatalog(); revokeAdditional(); }
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
    if (closed || closing || cleanupFailed || contactsInvalidating || patientsInvalidating || clinicalInvalidating || catalogInvalidating || workspaceSwitching) return Promise.resolve(null);
    if (!runtimeValid()) { void rejectRuntime(); return Promise.resolve(null); }
    if (!closeAdditionalForSwitch()) return Promise.resolve(null);
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
    if (patientsWorkspace || patientsOpening) {
      workspaceSwitching = true;
      try { if (!closePatients()) return Promise.resolve(null); }
      finally { workspaceSwitching = false; }
    }
    if (clinicalWorkspace || clinicalOpening) {
      workspaceSwitching = true;
      try { if (!closeClinical()) return Promise.resolve(null); }
      finally { workspaceSwitching = false; }
    }
    if (catalogWorkspace || catalogOpening) {
      workspaceSwitching = true;
      try { if (!closeCatalog()) return Promise.resolve(null); }
      finally { workspaceSwitching = false; }
    }
    // Closing the other workspace notifies subscribers; they may close Auth.
    if (closed || closing || cleanupFailed || session !== candidate) return Promise.resolve(null);
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

  function closeContacts(expected?: CloudOperatingContactsWorkspace): boolean {
    if (closed || closing || contactsInvalidating || patientsInvalidating || clinicalInvalidating || catalogInvalidating) return false;
    const lease = contactsLease;
    if (!runtimeValid()) { void rejectRuntime(); return false; }
    const workspace = getContactsWorkspace();
    const stillOwned = () => !closed && !closing && !cleanupFailed && contactsLease === lease && contactsWorkspace === workspace;
    if (!stillOwned()) return false;
    if (expected && workspace !== expected) return false;
    if (workspace) {
      const current = workspace.getState();
      if (!stillOwned()) return false;
      const recovery = workspace.recovery.getState();
      if (!stillOwned()) return false;
      if (current.draft || current.loading || recovery.loading || current.pendingOperationId || current.saveStatus !== 'idle') {
        publish({ ...state, contacts: contactsState('open', CONTACTS_CLOSE_ERROR) });
        return false;
      }
    }
    if (!stillOwned()) return false;
    revokeContacts();
    publish(state);
    return true;
  }

  function getPatientsWorkspace(): CloudOperatingPatientsWorkspace | null {
    const identity = patientsIdentity;
    if (!identity || !patientsActive(patientsLease, identity.session, identity.uid)) return null;
    return patientsWorkspace;
  }

  function openPatients(): Promise<CloudOperatingPatientsWorkspace | null> {
    if (closed || closing || cleanupFailed || contactsInvalidating || patientsInvalidating || clinicalInvalidating || catalogInvalidating || workspaceSwitching) return Promise.resolve(null);
    if (!runtimeValid()) { void rejectRuntime(); return Promise.resolve(null); }
    if (!closeAdditionalForSwitch()) return Promise.resolve(null);
    if (patientsOpening) return patientsOpening;
    const existing = getPatientsWorkspace();
    if (existing) return Promise.resolve(existing);
    const candidate = session;
    const owner = candidate?.getState().owner;
    if (!candidate || state.pending || state.auth.phase !== 'owner-checked'
      || candidate.getState().phase !== 'owner-checked' || !owner || typeof candidate.getPatients !== 'function') {
      publish({ ...state, patients: contactsState('closed', PATIENTS_UNAVAILABLE) });
      return Promise.resolve(null);
    }
    if (contactsWorkspace || contactsOpening) {
      workspaceSwitching = true;
      try { if (!closeContacts()) return Promise.resolve(null); }
      finally { workspaceSwitching = false; }
    }
    if (clinicalWorkspace || clinicalOpening) {
      workspaceSwitching = true;
      try { if (!closeClinical()) return Promise.resolve(null); }
      finally { workspaceSwitching = false; }
    }
    if (catalogWorkspace || catalogOpening) {
      workspaceSwitching = true;
      try { if (!closeCatalog()) return Promise.resolve(null); }
      finally { workspaceSwitching = false; }
    }
    if (closed || closing || cleanupFailed || session !== candidate) return Promise.resolve(null);
    const ticket = ++patientsLease;
    patientsIdentity = { session: candidate, uid: owner.uid };
    const work: Promise<CloudOperatingPatientsWorkspace | null> = Promise.resolve().then(async () => {
      try {
        if (!patientsActive(ticket, candidate, owner.uid)) return null;
        const repository = await candidate.getPatients!();
        if (!patientsActive(ticket, candidate, owner.uid)) return null;
        const workspace = await import('./cloudPatientWorkspaceController');
        if (!patientsActive(ticket, candidate, owner.uid)) return null;
        const controller = workspace.createCloudPatientWorkspaceController({
          getRepository: async () => {
            if (!patientsActive(ticket, candidate, owner.uid)) throw new CloudOperatingAuthError('changed');
            return repository;
          },
          getDirectory: async () => {
            if (!patientsActive(ticket, candidate, owner.uid) || typeof candidate.getClinicSnapshot !== 'function') throw new CloudOperatingAuthError('changed');
            const directory = await candidate.getClinicSnapshot();
            if (!patientsActive(ticket, candidate, owner.uid) || typeof directory.readDirectory !== 'function') throw new CloudOperatingAuthError('changed');
            const result = await directory.readDirectory();
            if (!patientsActive(ticket, candidate, owner.uid)) throw new CloudOperatingAuthError('changed');
            return result;
          },
          isActive: () => patientsActive(ticket, candidate, owner.uid),
        });
        if (!patientsActive(ticket, candidate, owner.uid)) { controller.dispose(); return null; }
        patientsWorkspace = controller;
        publish({ ...state, patients: contactsState('open') });
        return patientsActive(ticket, candidate, owner.uid) && patientsWorkspace === controller ? controller : null;
      } catch {
        if (closed || closing || cleanupFailed || session !== candidate) return null;
        const phase = candidate.getState().phase;
        if (patientsLease !== ticket && phase !== 'signed-out' && phase !== 'signing-out' && phase !== 'closed') return null;
        const cleanup = beginClose(false);
        const closingTicket = epoch;
        await cleanup;
        if (!closed && closingTicket === epoch && !cleanupFailed) {
          publish({ ...state, patients: contactsState('closed', PATIENTS_ERROR) });
        }
        return null;
      } finally {
        if (patientsOpening === work) patientsOpening = null;
      }
    });
    patientsOpening = work;
    publish({ ...state, patients: contactsState('opening') });
    return work;
  }

  function closePatients(expected?: CloudOperatingPatientsWorkspace): boolean {
    if (closed || closing || patientsInvalidating || contactsInvalidating || clinicalInvalidating || catalogInvalidating) return false;
    const lease = patientsLease;
    if (!runtimeValid()) { void rejectRuntime(); return false; }
    const workspace = getPatientsWorkspace();
    const stillOwned = () => !closed && !closing && !cleanupFailed && patientsLease === lease && patientsWorkspace === workspace;
    if (!stillOwned()) return false;
    if (expected && workspace !== expected) return false;
    if (workspace) {
      const current = workspace.getState();
      if (!stillOwned()) return false;
      const recovery = workspace.recovery.getState();
      if (!stillOwned()) return false;
      if (current.draft || current.loading || recovery.loading || current.pendingOperationId || current.saveStatus !== 'idle') {
        publish({ ...state, patients: contactsState('open', CONTACTS_CLOSE_ERROR) });
        return false;
      }
    }
    if (!stillOwned()) return false;
    revokePatients();
    publish(state);
    return true;
  }

  function getClinicalWorkspace(): CloudOperatingClinicalWorkspace | null {
    const identity = clinicalIdentity;
    if (!identity || !clinicalActive(clinicalLease, identity.session, identity.uid)) return null;
    return clinicalWorkspace;
  }

  function openClinical(): Promise<CloudOperatingClinicalWorkspace | null> {
    if (closed || closing || cleanupFailed || contactsInvalidating || patientsInvalidating || clinicalInvalidating || catalogInvalidating || workspaceSwitching) return Promise.resolve(null);
    if (!runtimeValid()) { void rejectRuntime(); return Promise.resolve(null); }
    if (!closeAdditionalForSwitch()) return Promise.resolve(null);
    if (clinicalOpening) return clinicalOpening;
    const existing = getClinicalWorkspace();
    if (existing) return Promise.resolve(existing);
    const candidate = session;
    const owner = candidate?.getState().owner;
    if (!candidate || state.pending || state.auth.phase !== 'owner-checked'
      || candidate.getState().phase !== 'owner-checked' || !owner || typeof candidate.getClinical !== 'function') {
      publish({ ...state, clinical: contactsState('closed', CLINICAL_UNAVAILABLE) });
      return Promise.resolve(null);
    }
    workspaceSwitching = true;
    try {
      if ((contactsWorkspace || contactsOpening) && !closeContacts()) return Promise.resolve(null);
      if ((patientsWorkspace || patientsOpening) && !closePatients()) return Promise.resolve(null);
      if ((catalogWorkspace || catalogOpening) && !closeCatalog()) return Promise.resolve(null);
    } finally { workspaceSwitching = false; }
    if (closed || closing || cleanupFailed || session !== candidate) return Promise.resolve(null);
    const ticket = ++clinicalLease;
    clinicalIdentity = { session: candidate, uid: owner.uid };
    const work: Promise<CloudOperatingClinicalWorkspace | null> = Promise.resolve().then(async () => {
      try {
        if (!clinicalActive(ticket, candidate, owner.uid)) return null;
        const capability = await candidate.getClinical!();
        if (!clinicalActive(ticket, candidate, owner.uid)) return null;
        const [fileModule, recoveryModule, visitModule] = await Promise.all([
          import('./cloudClinicalWorkspaceController'), import('./cloudClinicalRecoveryController'),
          import('./cloudClinicalVisitWorkspaceController'),
        ]);
        if (!clinicalActive(ticket, candidate, owner.uid)) return null;
        const options = {
          getCapability: async () => {
            if (!clinicalActive(ticket, candidate, owner.uid)) throw new CloudOperatingAuthError('changed');
            return capability;
          },
          isActive: () => clinicalActive(ticket, candidate, owner.uid),
        };
        const file = fileModule.createCloudClinicalWorkspaceController(options);
        const controller: CloudOperatingClinicalWorkspace = Object.freeze({
          file,
          recovery: recoveryModule.createCloudClinicalRecoveryController(options),
          visit: visitModule.createCloudClinicalVisitWorkspaceController({ file, isActive: options.isActive,
            getCatalog: async () => {
              if (!clinicalActive(ticket, candidate, owner.uid) || typeof candidate.getServiceCatalog !== 'function') throw new CloudOperatingAuthError('changed');
              const catalog = await candidate.getServiceCatalog();
              if (!clinicalActive(ticket, candidate, owner.uid)) throw new CloudOperatingAuthError('changed');
              const record = await catalog.repository.get();
              if (!clinicalActive(ticket, candidate, owner.uid)) throw new CloudOperatingAuthError('changed');
              return record;
            },
          }),
        });
        if (!clinicalActive(ticket, candidate, owner.uid)) {
          controller.visit?.dispose(); controller.file.dispose(); controller.recovery.dispose(); return null;
        }
        clinicalWorkspace = controller;
        publish({ ...state, clinical: contactsState('open') });
        return clinicalActive(ticket, candidate, owner.uid) && clinicalWorkspace === controller ? controller : null;
      } catch {
        if (closed || closing || cleanupFailed || session !== candidate) return null;
        const phase = candidate.getState().phase;
        if (clinicalLease !== ticket && phase !== 'signed-out' && phase !== 'signing-out' && phase !== 'closed') return null;
        const cleanup = beginClose(false);
        const closingTicket = epoch;
        await cleanup;
        if (!closed && closingTicket === epoch && !cleanupFailed) {
          publish({ ...state, clinical: contactsState('closed', CLINICAL_ERROR) });
        }
        return null;
      } finally {
        if (clinicalOpening === work) clinicalOpening = null;
      }
    });
    clinicalOpening = work;
    publish({ ...state, clinical: contactsState('opening') });
    return work;
  }

  function closeClinical(expected?: CloudOperatingClinicalWorkspace): boolean {
    if (closed || closing || contactsInvalidating || patientsInvalidating || clinicalInvalidating || catalogInvalidating) return false;
    const lease = clinicalLease;
    if (!runtimeValid()) { void rejectRuntime(); return false; }
    const workspace = getClinicalWorkspace();
    const stillOwned = () => !closed && !closing && !cleanupFailed && clinicalLease === lease && clinicalWorkspace === workspace;
    if (!stillOwned()) return false;
    if (expected && workspace !== expected) return false;
    if (workspace) {
      const file = workspace.file.getState();
      if (!stillOwned()) return false;
      const recovery = workspace.recovery.getState();
      if (!stillOwned()) return false;
      const visit = workspace.visit?.getState();
      if (!stillOwned()) return false;
      if (file.draftDirty || file.loading || file.saveStatus !== 'idle' || file.pendingOperationId || recovery.loading || visit && visit.phase !== 'idle') {
        publish({ ...state, clinical: contactsState('open', CLINICAL_CLOSE_ERROR) });
        return false;
      }
    }
    if (!stillOwned()) return false;
    revokeClinical();
    publish(state);
    return true;
  }

  function getCatalogWorkspace(): CloudCatalogWorkspaceController | null {
    const identity = catalogIdentity;
    if (!identity || !catalogActive(catalogLease, identity.session, identity.uid)) return null;
    return catalogWorkspace;
  }

  function openCatalog(): Promise<CloudCatalogWorkspaceController | null> {
    if (closed || closing || cleanupFailed || contactsInvalidating || patientsInvalidating || clinicalInvalidating || catalogInvalidating || workspaceSwitching) return Promise.resolve(null);
    if (!runtimeValid()) { void rejectRuntime(); return Promise.resolve(null); }
    if (!closeAdditionalForSwitch()) return Promise.resolve(null);
    if (catalogOpening) return catalogOpening;
    const existing = getCatalogWorkspace();
    if (existing) return Promise.resolve(existing);
    const candidate = session, owner = candidate?.getState().owner;
    if (!candidate || state.pending || state.auth.phase !== 'owner-checked'
      || candidate.getState().phase !== 'owner-checked' || !owner || typeof candidate.getServiceCatalog !== 'function') {
      publish({ ...state, catalog: contactsState('closed', CATALOG_UNAVAILABLE) });
      return Promise.resolve(null);
    }
    workspaceSwitching = true;
    try {
      if ((contactsWorkspace || contactsOpening) && !closeContacts()) return Promise.resolve(null);
      if ((patientsWorkspace || patientsOpening) && !closePatients()) return Promise.resolve(null);
      if ((clinicalWorkspace || clinicalOpening) && !closeClinical()) return Promise.resolve(null);
    } finally { workspaceSwitching = false; }
    if (closed || closing || cleanupFailed || session !== candidate) return Promise.resolve(null);
    const ticket = ++catalogLease;
    catalogIdentity = { session: candidate, uid: owner.uid };
    const work: Promise<CloudCatalogWorkspaceController | null> = Promise.resolve().then(async () => {
      try {
        if (!catalogActive(ticket, candidate, owner.uid)) return null;
        const capability = await candidate.getServiceCatalog!();
        if (!catalogActive(ticket, candidate, owner.uid)) return null;
        const workspace = await import('./cloudCatalogWorkspaceController');
        if (!catalogActive(ticket, candidate, owner.uid)) return null;
        const controller = workspace.createCloudCatalogWorkspaceController({
          getCapability: async () => {
            if (!catalogActive(ticket, candidate, owner.uid)) throw new CloudOperatingAuthError('changed');
            return capability;
          },
          isActive: () => catalogActive(ticket, candidate, owner.uid),
        });
        if (!catalogActive(ticket, candidate, owner.uid)) { controller.dispose(); return null; }
        catalogWorkspace = controller;
        publish({ ...state, catalog: contactsState('open') });
        return catalogActive(ticket, candidate, owner.uid) && catalogWorkspace === controller ? controller : null;
      } catch {
        if (closed || closing || cleanupFailed || session !== candidate) return null;
        const phase = candidate.getState().phase;
        if (catalogLease !== ticket && phase !== 'signed-out' && phase !== 'signing-out' && phase !== 'closed') return null;
        const cleanup = beginClose(false), closingTicket = epoch;
        await cleanup;
        if (!closed && closingTicket === epoch && !cleanupFailed) publish({ ...state, catalog: contactsState('closed', CATALOG_ERROR) });
        return null;
      } finally { if (catalogOpening === work) catalogOpening = null; }
    });
    catalogOpening = work;
    publish({ ...state, catalog: contactsState('opening') });
    return work;
  }

  function closeCatalog(expected?: CloudCatalogWorkspaceController): boolean {
    if (closed || closing || contactsInvalidating || patientsInvalidating || clinicalInvalidating || catalogInvalidating) return false;
    const lease = catalogLease;
    if (!runtimeValid()) { void rejectRuntime(); return false; }
    const workspace = getCatalogWorkspace();
    const stillOwned = () => !closed && !closing && !cleanupFailed && catalogLease === lease && catalogWorkspace === workspace;
    if (!stillOwned()) return false;
    if (expected && workspace !== expected) return false;
    if (workspace) {
      const current = workspace.getState();
      if (!stillOwned()) return false;
      if (current.draft || current.loading || current.historyLoading || current.saveStatus !== 'idle' || current.pendingOperationId) {
        publish({ ...state, catalog: contactsState('open', CLINICAL_CLOSE_ERROR) }); return false;
      }
    }
    if (!stillOwned()) return false;
    revokeCatalog(); publish(state); return true;
  }

  return {
    getState: () => {
      if ((contactsIdentity || patientsIdentity || clinicalIdentity || catalogIdentity || additionalIdentity) && !runtimeValid()) void rejectRuntime();
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
    openPatients,
    getPatientsWorkspace,
    closePatients,
    openClinical,
    getClinicalWorkspace,
    closeClinical,
    openCatalog,
    getCatalogWorkspace,
    closeCatalog,
    openAdditional,
    getAdditionalWorkspace,
    closeAdditional,
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
