import { CloudClinicalError, prepareCloudClinicalCommand, type CloudClinicalCommand,
  type CloudClinicalProgress, type CloudClinicalRepository, type CloudClinicalSessionData } from './cloudClinicalRepository';
import { loadCloudClinicalPatient, type CloudClinicalPatientSnapshot } from './cloudClinicalPatientProjection';
import { CloudOperationIntentError, parseCloudOperationIntent, prepareCloudIntentCommand,
  type CloudOperationIntentRepository } from './cloudOperationIntent';

export interface CloudClinicalCapability {
  repository: CloudClinicalRepository;
  journal: CloudOperationIntentRepository;
}
export type CloudClinicalWorkspaceState = Readonly<{
  patientRecordId: string | null; snapshot: CloudClinicalPatientSnapshot | null;
  loaded: boolean; loading: boolean;
  saveStatus: 'idle' | 'preparing' | 'saving' | 'retry-required' | 'refresh-required';
  pendingOperationId: string | null; error: string; notice: string; closed: boolean;
}>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const validId = (value: unknown): value is string => typeof value === 'string' && value.length === 36 && UUID.test(value);
function fail(): never { throw new CloudClinicalError('unavailable'); }
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function errorCode(error: unknown): CloudClinicalError['code'] {
  try {
    if ((error instanceof CloudClinicalError || error instanceof CloudOperationIntentError)
      && ['invalid', 'conflict', 'unavailable'].includes(error.code)) return error.code;
  } catch { /* Never expose provider or hostile error details. */ }
  return 'unavailable';
}

/** Prepared, explicitly opened selected-file controller, not mounted/activated.
 * Owns no SDK/local records. The parent MUST synchronously dispose on actual
 * Auth/view loss, not temporary authorization checking. Preparation is durable
 * on the future server journal; memory disposal cannot undo accepted writes.
 * Recovery uses the original command/revision, never a freshly invented receipt.
 * Full history is verified before publishing; this is NOT a clinic aggregate. */
export function createCloudClinicalWorkspaceController(options: {
  getCapability: () => Promise<CloudClinicalCapability>;
  isActive: () => boolean;
  newId?: () => string;
  now?: () => string;
}) {
  let state: CloudClinicalWorkspaceState = Object.freeze({ patientRecordId: null, snapshot: null,
    loaded: false, loading: false, saveStatus: 'idle', pendingOperationId: null, error: '', notice: '', closed: false });
  let epoch = 0, closed = false, capability: CloudClinicalCapability | null = null;
  let command: CloudClinicalCommand | null = null;
  let acknowledged: { revision: number; fileNo: number } | null = null;
  const listeners = new Set<(value: CloudClinicalWorkspaceState) => void>();
  function publish(value: CloudClinicalWorkspaceState) {
    state = Object.freeze(value);
    for (const listener of [...listeners]) { try { listener(state); } catch { /* View grants no authority. */ } }
  }
  function dispose() {
    if (closed) return;
    closed = true; ++epoch; capability = null; command = null; acknowledged = null;
    publish({ patientRecordId: null, snapshot: null, loaded: false, loading: false,
      saveStatus: 'idle', pendingOperationId: null, error: '', notice: '', closed: true });
    listeners.clear();
  }
  function active(ticket = epoch) {
    if (closed || ticket !== epoch) return false;
    let allowed = false; try { allowed = options.isActive() === true; } catch { /* Fail closed. */ }
    if (closed || ticket !== epoch) return false;
    if (!allowed) { dispose(); return false; }
    return true;
  }
  const busy = () => state.loading || state.saveStatus === 'preparing' || state.saveStatus === 'saving';
  const assertActive = (ticket: number) => () => { if (!active(ticket)) fail(); };
  async function getCapability(ticket: number) {
    assertActive(ticket)();
    if (capability) return capability;
    const created = await options.getCapability(); assertActive(ticket)();
    capability = created; return created;
  }
  async function readSnapshot(ticket: number, patientId: string) {
    const cap = await getCapability(ticket); assertActive(ticket)();
    return loadCloudClinicalPatient(cap.repository, patientId, assertActive(ticket));
  }
  async function open(patientId: string): Promise<boolean> {
    if (!active() || busy() || command) return false;
    if (!validId(patientId)) { publish({ ...state, error: 'اختر ملفًا صحيحًا من قائمة المرضى.' }); return false; }
    const ticket = ++epoch;
    publish({ ...state, patientRecordId: patientId, snapshot: null, loaded: false, loading: true, error: '', notice: '' });
    try {
      const snapshot = await readSnapshot(ticket, patientId); if (!active(ticket)) return false;
      publish({ ...state, snapshot, loaded: true, loading: false }); return true;
    } catch (error) {
      if (active(ticket)) publish({ ...state, snapshot: null, loaded: false, loading: false, error: errorCode(error) === 'conflict'
        ? 'تغيّر الملف أثناء القراءة. أعد تحديثه لعرض حساب كامل ومؤكد.' : 'تعذر قراءة سجل الملف كاملًا؛ لم نعرض حسابًا جزئيًا.' });
      return false;
    }
  }
  async function execute(ticket: number): Promise<boolean> {
    const submitted = command;
    if (!submitted || !active(ticket)) return false;
    try {
      const cap = await getCapability(ticket); assertActive(ticket)();
      if (!acknowledged) {
        publish({ ...state, saveStatus: 'preparing', error: '', notice: '' });
        const intent = parseCloudOperationIntent(await cap.journal.prepare('clinical', submitted, submitted.createdAt));
        assertActive(ticket)();
        if (intent.kind !== 'clinical' || intent.operationId !== submitted.operationId || intent.createdAt !== submitted.createdAt
          || JSON.stringify(intent.command) !== JSON.stringify(prepareCloudIntentCommand(submitted)) || intent.status === 'cancelled') {
          throw new CloudClinicalError('conflict');
        }
        publish({ ...state, saveStatus: 'saving' });
        const receipt = await cap.repository.commit(submitted); assertActive(ticket)();
        if (!receipt || !['committed', 'already-committed'].includes(receipt.status)
          || receipt.patientId !== submitted.patientId || receipt.sessionId !== submitted.sessionId
          || receipt.revision !== submitted.expectedRevision + 1 || !Number.isSafeInteger(receipt.fileNo) || receipt.fileNo <= 0
          || state.snapshot && state.snapshot.patient.id !== String(receipt.fileNo)) fail();
        acknowledged = { revision: receipt.revision, fileNo: receipt.fileNo };
      }
      publish({ ...state, saveStatus: 'refresh-required', error: '' });
      const snapshot = await readSnapshot(ticket, submitted.patientId); assertActive(ticket)();
      if (snapshot.accountRevision < acknowledged.revision || snapshot.patient.id !== String(acknowledged.fileNo)) fail();
      command = null; acknowledged = null;
      publish({ ...state, snapshot, patientRecordId: snapshot.patientRecordId, loaded: true, loading: false,
        saveStatus: 'idle', pendingOperationId: null, error: '', notice: 'تم تأكيد العملية وقراءة حساب المريض كاملًا من الخادم.' });
      return true;
    } catch (error) {
      if (!active(ticket)) return false;
      publish({ ...state, saveStatus: acknowledged ? 'refresh-required' : 'retry-required',
        error: acknowledged ? 'الحفظ مؤكد؛ تعذر تحديث العرض. أعد التحقق بالقراءة فقط دون تسجيل دفعة أخرى.'
          : errorCode(error) === 'conflict' ? 'تغيّر الملف أو حالة العملية. المسودة الأصلية محفوظة؛ أعد التحقق أو ألغِ العملية من سجلها قبل تعديلها.'
            : 'لم يصل تأكيد العملية. أعد المحاولة بنفس معرّف العملية؛ لا تسجلها كدفعة جديدة.' });
      return false;
    }
  }
  function start(patientId: string, build: (operationId: string, snapshot: CloudClinicalPatientSnapshot, createdAt: string) => unknown) {
    if (!active() || busy() || command || !state.loaded || !state.snapshot || patientId !== state.patientRecordId) return Promise.resolve(false);
    const before = epoch;
    try {
      const id = (options.newId ?? (() => crypto.randomUUID()))();
      const createdAt = (options.now ?? (() => new Date().toISOString()))();
      const prepared = freeze(prepareCloudClinicalCommand(build(id, state.snapshot, createdAt)));
      if (!active(before) || busy() || command) return Promise.resolve(false);
      command = prepared;
      acknowledged = null;
    } catch {
      if (active(before)) publish({ ...state, error: 'راجع بيانات الجلسة أو الدفعة والمبالغ قبل الحفظ.' }); return Promise.resolve(false);
    }
    const ticket = ++epoch;
    publish({ ...state, saveStatus: 'preparing', pendingOperationId: command.operationId, error: '', notice: '' });
    return execute(ticket);
  }
  async function retry(): Promise<boolean> {
    if (!active() || busy() || !command || !['retry-required', 'refresh-required'].includes(state.saveStatus)) return false;
    const ticket = ++epoch;
    // Read refresh is also exclusive, including retained/repeated callbacks.
    publish({ ...state, loading: true, error: '' });
    const result = await execute(ticket);
    if (active(ticket) && state.loading) publish({ ...state, loading: false });
    return result;
  }
  async function cancelPending(): Promise<boolean> {
    if (!active() || busy() || !command || acknowledged) return false;
    const ticket = ++epoch, submitted = command;
    publish({ ...state, loading: true, error: '' });
    try {
      const cap = await getCapability(ticket), cancelled = parseCloudOperationIntent(await cap.journal.cancel(submitted.operationId));
      assertActive(ticket)();
      if (cancelled.operationId !== submitted.operationId || cancelled.kind !== 'clinical' || cancelled.status !== 'cancelled'
        || JSON.stringify(cancelled.command) !== JSON.stringify(prepareCloudIntentCommand(submitted))) fail();
      command = null; acknowledged = null;
      // Old loaded totals are invalidated after resolving an uncertain attempt.
      publish({ ...state, snapshot: null, loaded: false, loading: false, pendingOperationId: null, saveStatus: 'idle',
        error: '', notice: 'تم تأكيد إلغاء العملية قبل تنفيذها. حدّث الملف قبل تسجيل أي تغيير جديد.' });
      return true;
    } catch {
      if (active(ticket)) publish({ ...state, loading: false, saveStatus: 'retry-required',
        error: 'تعذر تأكيد إلغاء العملية؛ قد تكون نُفذت. أعد التحقق من نفس العملية قبل تسجيل غيرها.' });
      return false;
    }
  }
  async function resume(operationId: string): Promise<boolean> {
    if (!active() || busy() || command || !validId(operationId)) return false;
    const ticket = ++epoch; publish({ ...state, loading: true, snapshot: null, loaded: false, error: '', notice: '' });
    try {
      const cap = await getCapability(ticket), intent = parseCloudOperationIntent(await cap.journal.get(operationId));
      assertActive(ticket)();
      const recovered = prepareCloudClinicalCommand(intent.command);
      if (intent.kind !== 'clinical' || intent.operationId !== operationId || intent.status === 'cancelled'
        || intent.createdAt !== recovered.createdAt) throw new CloudClinicalError('invalid');
      command = freeze(recovered); acknowledged = null;
      publish({ ...state, loading: false, patientRecordId: recovered.patientId, pendingOperationId: recovered.operationId,
        saveStatus: 'preparing' });
      return execute(ticket);
    } catch {
      if (active(ticket)) publish({ ...state, loading: false, error: 'تعذر استرجاع العملية المطلوبة؛ لم ننشئ دفعة بديلة.' });
      return false;
    }
  }
  return {
    getState: () => { active(); return state; },
    subscribe: (listener: (value: CloudClinicalWorkspaceState) => void) => {
      if (!active()) return () => undefined;
      listeners.add(listener); return () => { listeners.delete(listener); };
    },
    open,
    refresh: () => state.patientRecordId && !command ? open(state.patientRecordId) : Promise.resolve(false),
    saveVisit: (patientId: string, data: CloudClinicalSessionData, paidCents: number) => start(patientId, (operationId, snapshot, createdAt) => ({
      operationId, patientId, sessionId: operationId, expectedRevision: snapshot.accountRevision, createdAt, action: 'visit', data, paidCents,
    })),
    addReceipt: (patientId: string, sessionId: string, data: { amountCents: number; date: string; note: string }) => {
      if (!state.snapshot?.patient.sessions.some(session => session.id === sessionId)) return Promise.resolve(false);
      return start(patientId, (operationId, snapshot, createdAt) => ({ operationId, patientId, sessionId,
        expectedRevision: snapshot.accountRevision, createdAt, action: 'payment', amountCents: data.amountCents, date: data.date, note: data.note }));
    },
    saveProgress: (patientId: string, sessionId: string, changes: CloudClinicalProgress) => {
      if (!state.snapshot?.patient.sessions.some(session => session.id === sessionId)) return Promise.resolve(false);
      return start(patientId, (operationId, snapshot, createdAt) => ({ operationId, patientId, sessionId,
        expectedRevision: snapshot.accountRevision, createdAt, action: 'progress', changes }));
    },
    retry, cancelPending, resume, dispose,
  };
}
export type CloudClinicalWorkspaceController = ReturnType<typeof createCloudClinicalWorkspaceController>;
