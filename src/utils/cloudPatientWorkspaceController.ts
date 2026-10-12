import { normalizeContactPhone } from './clinicContacts';
import { CloudPatientError, parseCloudPatientRecord, prepareCloudPatientCommand,
  prepareCloudPatientPhoneInput, type CloudPatientCommand, type CloudPatientPage,
  type CloudPatientPhoneInput, type CloudPatientProfile, type CloudPatientRecord,
  type CloudPatientRepository } from './cloudPatientRepository';
import { CloudOperationIntentError, parseCloudOperationIntent, prepareCloudIntentCommand,
  type CloudOperationIntentRepository } from './cloudOperationIntent';
import { createCloudProfileContactRecoveryController } from './cloudProfileContactRecoveryController';

export type CloudPatientWorkspaceCapability = CloudPatientRepository & { readonly journal?: CloudOperationIntentRepository };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PAGE_SIZE = 25;
const MAX_LOADED = 500;
const MAX_NUMBER = 2_000_000_000;
const validId = (value: unknown): value is string => typeof value === 'string' && value.length === 36 && UUID.test(value);
const validNumber = (value: unknown): value is number => typeof value === 'number'
  && Number.isSafeInteger(value) && value > 0 && value <= MAX_NUMBER;

export type CloudPatientWorkspaceDraft = Readonly<{
  action: CloudPatientCommand['action']; recordId: string; expectedRevision: number;
  profile: Readonly<CloudPatientProfile>;
}>;
export type CloudPatientWorkspaceQuery = Readonly<{ kind: 'all' }
  | { kind: 'phone'; mobile: string } | { kind: 'file'; fileNo: number }>;
export type CloudPatientWorkspaceState = Readonly<{
  records: readonly CloudPatientRecord[]; nextAfterId: string | null;
  loaded: boolean; loading: boolean; recoveryLoading: boolean;
  saveStatus: 'idle' | 'preparing' | 'saving' | 'retry-required' | 'refresh-required'; pendingOperationId: string | null;
  selected: CloudPatientRecord | null; draft: CloudPatientWorkspaceDraft | null;
  query: CloudPatientWorkspaceQuery; error: string; notice: string; closed: boolean;
}>;

function frozenRecord(value: unknown): CloudPatientRecord {
  const record = parseCloudPatientRecord(value);
  Object.freeze(record.data);
  return Object.freeze(record);
}
function safeCode(error: unknown): CloudPatientError['code'] {
  try {
    if (error instanceof CloudPatientError && ['invalid', 'conflict', 'unavailable'].includes(error.code)) return error.code;
    if (error instanceof CloudOperationIntentError && ['invalid', 'conflict', 'unavailable'].includes(error.code)) return error.code;
  } catch { /* No provider details or hostile error getters. */ }
  return 'unavailable';
}
function ownFields(value: unknown, allowed: readonly string[], required: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CloudPatientError('invalid');
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) throw new CloudPatientError('invalid');
  const keys = Reflect.ownKeys(value);
  if (required.some(key => !keys.includes(key)) || keys.some(key => typeof key !== 'string' || !allowed.includes(key))) throw new CloudPatientError('invalid');
  const result: Record<string, unknown> = {};
  for (const key of keys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) throw new CloudPatientError('invalid');
    result[key] = descriptor.value;
  }
  return result;
}
function checkedPage(value: CloudPatientPage, afterId: string | null, limit: number, mobile?: string) {
  const page = ownFields(value, ['records', 'nextAfterId'], ['records', 'nextAfterId']);
  if (!Array.isArray(page.records) || page.records.length > limit
    || Reflect.ownKeys(page.records).length !== page.records.length + 1) throw new CloudPatientError('unavailable');
  const records: CloudPatientRecord[] = [], files = new Set<number>();
  let previous = afterId;
  for (let index = 0; index < page.records.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(page.records, String(index));
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) throw new CloudPatientError('unavailable');
    const record = frozenRecord(descriptor.value);
    if (previous !== null && record.recordId <= previous || files.has(record.fileNo)
      || mobile !== undefined && normalizeContactPhone(record.data.mobile) !== mobile) throw new CloudPatientError('unavailable');
    files.add(record.fileNo); records.push(record); previous = record.recordId;
  }
  const nextAfterId = records.length === limit ? previous : null;
  if (page.nextAfterId !== nextAfterId) throw new CloudPatientError('unavailable');
  return { records, nextAfterId };
}
function localDay() {
  const value = new Date();
  return `${String(value.getFullYear()).padStart(4, '0')}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}
function validDay(value: unknown): value is string {
  if (typeof value !== 'string' || value.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || value < '1900-01-01' || value > '9999-12-31') return false;
  const day = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === value;
}
function validTime(value: unknown): value is string {
  if (typeof value !== 'string' || value.length !== 24 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    || value < '1900-01-01T00:00:00.000Z' || value > '9999-12-31T23:59:59.999Z') return false;
  const date = new Date(value); return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

/** Prepared, owner-view-scoped profile controller, not a complete clinical file.
 * Construction is inert. It has no SDK, browser storage or local fallback.
 * Original commands are prepared durably before domain writes. Disposing clears
 * this view only; a fresh lifetime may recover the same server journal command.
 * The parent must synchronously dispose on actual Auth/view loss, NOT while
 * the same owner session performs its temporary authorization check. */
export function createCloudPatientWorkspaceController(options: {
  getRepository: () => Promise<CloudPatientWorkspaceCapability>;
  isActive: () => boolean;
  newId?: () => string;
  today?: () => string;
  now?: () => string;
}) {
  let state: CloudPatientWorkspaceState = Object.freeze({ records: Object.freeze([]), nextAfterId: null,
    loaded: false, loading: false, recoveryLoading: false, saveStatus: 'idle', pendingOperationId: null, selected: null, draft: null,
    query: Object.freeze({ kind: 'all' }), error: '', notice: '', closed: false });
  let epoch = 0, closed = false, checkingActive = false, capturing = false;
  let repository: CloudPatientWorkspaceCapability | null = null;
  let command: Readonly<CloudPatientCommand> | null = null;
  let createdAt: string | null = null, actorUid: string | null = null, intentHash: string | null = null;
  let acknowledgedFileNo: number | null = null;
  let originalFileNo: number | null = null;
  let queryLimit = PAGE_SIZE;
  const listeners = new Set<(value: CloudPatientWorkspaceState) => void>();

  function publish(value: CloudPatientWorkspaceState) {
    const published = Object.freeze(value); state = published;
    for (const listener of [...listeners]) {
      try { listener(published); } catch { /* A view callback grants no authority. */ }
    }
  }
  function dispose() {
    if (closed) return;
    closed = true; ++epoch; repository = null; command = null;
    acknowledgedFileNo = null; originalFileNo = null; createdAt = null; actorUid = null; intentHash = null;
    recovery.dispose();
    publish({ records: Object.freeze([]), nextAfterId: null, loaded: false, loading: false, recoveryLoading: false,
      saveStatus: 'idle', pendingOperationId: null, selected: null, draft: null, query: Object.freeze({ kind: 'all' }),
      error: '', notice: '', closed: true });
    listeners.clear();
  }
  function active(ticket = epoch) {
    if (closed || ticket !== epoch || checkingActive) return false;
    let valid = false;
    checkingActive = true;
    try { valid = options.isActive() === true; } catch { /* Fail closed. */ }
    finally { checkingActive = false; }
    if (closed || ticket !== epoch) return false;
    if (valid) return true;
    dispose(); return false;
  }
  const busy = () => state.loading || state.recoveryLoading || state.saveStatus === 'preparing' || state.saveStatus === 'saving';
  const canRead = () => !capturing && !busy() && !command && !state.draft;
  const assertActive = (ticket: number) => { if (!active(ticket)) throw new CloudPatientError('unavailable'); };
  async function getRepository(ticket: number) {
    if (!active(ticket)) return null;
    if (repository) return repository;
    const candidate = await options.getRepository();
    if (!active(ticket)) return null;
    repository = candidate; return candidate;
  }
  async function call<T>(ticket: number, owner: object, key: string, args: unknown[] = []): Promise<T> {
    assertActive(ticket); const method = Reflect.get(owner, key); assertActive(ticket);
    if (typeof method !== 'function') throw new CloudPatientError('unavailable');
    const result = await Promise.resolve().then(() => { assertActive(ticket); return method.apply(owner, args) as Promise<T>; });
    assertActive(ticket); return result;
  }
  function journal(repo: CloudPatientWorkspaceCapability, ticket: number) {
    assertActive(ticket); const value = repo.journal; assertActive(ticket);
    if (!value) throw new CloudPatientError('unavailable'); return value;
  }
  const history = createCloudProfileContactRecoveryController({ kind: 'patient-profile', isActive: () => active(),
    getJournal: async () => {
      const ticket = epoch;
      if (!active(ticket) || state.loading || command || state.draft || state.saveStatus !== 'idle') throw new CloudPatientError('unavailable');
      const repo = await getRepository(ticket); assertActive(ticket);
      if (!repo || state.loading || command || state.draft || state.saveStatus !== 'idle') throw new CloudPatientError('unavailable');
      return journal(repo, ticket);
    },
  });
  const recovery = Object.freeze({ ...history,
    loadFirst: async () => { if (active() && canRead()) await history.loadFirst(); },
    loadMore: async () => { if (active() && canRead()) await history.loadMore(); },
  });
  history.subscribe(value => {
    if (!closed && state.recoveryLoading !== value.loading) publish({ ...state, recoveryLoading: value.loading });
  });
  function checkedIntent(value: unknown, id: string, expected?: Readonly<CloudPatientCommand>, time?: string) {
    const intent = parseCloudOperationIntent(value), recovered = prepareCloudPatientCommand(intent.command);
    if (intent.kind !== 'patient-profile' || intent.operationId !== id || recovered.operationId !== id
      || actorUid !== null && intent.actorUid !== actorUid || intentHash !== null && intent.requestHash !== intentHash
      || time !== undefined && intent.createdAt !== time
      || JSON.stringify(intent.command) !== JSON.stringify(prepareCloudIntentCommand(recovered))
      || expected !== undefined && JSON.stringify(intent.command) !== JSON.stringify(prepareCloudIntentCommand(expected))) throw new CloudPatientError('invalid');
    return { intent, recovered };
  }
  async function load(more: boolean, phone?: CloudPatientPhoneInput, phoneLookup = false): Promise<void> {
    if (!active() || !canRead()) return;
    if (more && (!state.loaded || !state.nextAfterId || state.query.kind === 'file')) return;
    const before = epoch;
    let query: CloudPatientWorkspaceQuery, limit: number, afterId: string | null;
    try {
      if (phoneLookup) {
        const prepared = prepareCloudPatientPhoneInput(phone);
        query = Object.freeze({ kind: 'phone', mobile: prepared.mobile });
        limit = prepared.limit; afterId = prepared.afterId;
      } else if (more) {
        query = state.query; limit = queryLimit; afterId = state.nextAfterId;
      } else {
        query = Object.freeze({ kind: 'all' }); limit = PAGE_SIZE; afterId = null;
      }
    } catch {
      if (active(before)) publish({ ...state, error: 'اكتب رقم موبايل كاملًا وصحيحًا للبحث.' });
      return;
    }
    if (!active(before) || !canRead()) return;
    const ticket = ++epoch;
    publish({ ...state, loading: true, error: '', notice: '' });
    try {
      const repo = await getRepository(ticket);
      if (!repo || !active(ticket)) return;
      const response = query.kind === 'phone'
        ? await call<CloudPatientPage>(ticket, repo, 'findByPhone', [{ mobile: query.mobile, afterId, limit }])
        : await call<CloudPatientPage>(ticket, repo, 'listPage', [{ afterId, limit }]);
      if (!active(ticket)) return;
      const page = checkedPage(response, afterId, limit, query.kind === 'phone' ? query.mobile : undefined);
      if (!active(ticket)) return;
      const combined = more ? [...state.records, ...page.records] : page.records;
      if (new Set(combined.map(record => record.fileNo)).size !== combined.length) throw new CloudPatientError('unavailable');
      queryLimit = limit;
      publish({ ...state, records: Object.freeze(combined.slice(-MAX_LOADED)), nextAfterId: page.nextAfterId,
        loaded: true, loading: false, selected: null, query,
        notice: combined.length > MAX_LOADED
          ? 'نعرض آخر ٥٠٠ ملف تم تحميلها للحفاظ على السرعة. يمكنك مواصلة الصفحات؛ لم تُحذف ملفات من الخادم.'
          : query.kind === 'phone' ? 'مطابقة الرقم الكامل فقط. قد يستخدم أفراد الأسرة رقمًا واحدًا؛ لا ندمج ملفاتهم.' : '' });
    } catch {
      if (active(ticket)) publish({ ...state, loading: false,
        error: 'تعذر قراءة ملفات المرضى من الخادم. أعد المحاولة؛ لا نستخدم نسخة محلية بديلة.' });
    }
  }
  async function readOne(value: string | number, byFileNo: boolean): Promise<void> {
    if (!active() || !canRead()) return;
    if (byFileNo ? !validNumber(value) : !validId(value)) {
      publish({ ...state, error: byFileNo ? 'اكتب رقم ملف صحيحًا أكبر من صفر.' : 'معرّف الملف غير صالح؛ حدّث القائمة.' });
      return;
    }
    const ticket = ++epoch;
    publish({ ...state, loading: true, error: '', notice: '' });
    try {
      const repo = await getRepository(ticket);
      if (!repo || !active(ticket)) return;
      const response = await call<CloudPatientRecord | null>(ticket, repo, byFileNo ? 'getByFileNo' : 'get', [value]);
      if (!active(ticket)) return;
      const selected = response === null ? null : frozenRecord(response);
      if (selected && (byFileNo ? selected.fileNo !== value : selected.recordId !== value)) throw new CloudPatientError('unavailable');
      if (!active(ticket)) return;
      publish({ ...state, loading: false, selected,
        ...(byFileNo ? { records: Object.freeze(selected ? [selected] : []), loaded: true, nextAfterId: null,
          query: Object.freeze({ kind: 'file' as const, fileNo: value as number }) } : {}),
        notice: selected ? '' : 'لم نجد ملفًا مطابقًا في الخادم. لم يتم إنشاء ملف أو دمج أي بيانات.' });
    } catch {
      if (active(ticket)) publish({ ...state, loading: false,
        error: 'تعذر فتح أحدث نسخة من الملف. أعد المحاولة قبل التعديل.' });
    }
  }
  function beginCreate(): boolean {
    if (!active() || !canRead()) return false;
    const ticket = epoch;
    try {
      const recordId = (options.newId ?? (() => crypto.randomUUID()))();
      const firstVisit = (options.today ?? localDay)();
      if (!validId(recordId) || !validDay(firstVisit)) throw new CloudPatientError('invalid');
      if (!active(ticket) || !canRead()) return false;
      originalFileNo = null;
      publish({ ...state, draft: Object.freeze({ action: 'create', recordId, expectedRevision: 0,
        profile: Object.freeze({ name: '', mobile: '', age: 0, gender: '', firstVisit, notes: '', allergy: '' }) }),
        error: '', notice: '' });
      return true;
    } catch {
      if (active(ticket)) publish({ ...state, error: 'تعذر فتح مسودة ملف صالحة. أعد المحاولة.' });
      return false;
    }
  }
  function beginEdit(record: CloudPatientRecord): boolean {
    if (!active() || !canRead() || state.selected !== record) return false;
    const ticket = epoch;
    try {
      const current = frozenRecord(record);
      if (!active(ticket) || !canRead() || state.selected !== record) return false;
      originalFileNo = current.fileNo;
      publish({ ...state, draft: Object.freeze({ action: 'update', recordId: current.recordId,
        expectedRevision: current.revision, profile: Object.freeze({ ...current.data }) }), error: '', notice: '' });
      return true;
    } catch {
      if (active(ticket)) publish({ ...state, error: 'تعذر فتح مسودة التعديل. اقرأ أحدث ملف ثم حاول من جديد.' });
      return false;
    }
  }
  function updateProfile(patch: Partial<CloudPatientProfile>): boolean {
    if (!active() || capturing || busy() || command || !state.draft) return false;
    const ticket = epoch, draft = state.draft;
    try {
      const values = ownFields(patch, ['name', 'mobile', 'age', 'gender', 'firstVisit', 'notes', 'allergy']);
      const limits: Record<string, number> = { name: 200, mobile: 60, gender: 40, firstVisit: 10, notes: 4000, allergy: 1000 };
      for (const [key, value] of Object.entries(values)) {
        if (key === 'age' ? typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 120
          : typeof value !== 'string' || value.length > limits[key]) return false;
      }
      if (!active(ticket) || state.draft !== draft) return false;
      publish({ ...state, draft: Object.freeze({ ...draft, profile: Object.freeze({ ...draft.profile, ...values }) as CloudPatientProfile }), error: '' });
      return true;
    } catch { return false; }
  }
  async function save(): Promise<void> {
    if (!active() || capturing || busy() || !state.draft) return;
    if (!command) {
      const before = epoch, draft = state.draft;
      try {
        capturing = true;
        let prepared: CloudPatientCommand, time: string;
        try {
          const operationId = (options.newId ?? (() => crypto.randomUUID()))();
          time = (options.now ?? (() => new Date().toISOString()))();
          prepared = prepareCloudPatientCommand({ ...draft, operationId });
          if (!validTime(time)) throw new CloudPatientError('invalid');
        } finally { capturing = false; }
        if (!active(before) || state.draft !== draft || busy() || command) return;
        command = Object.freeze({ ...prepared, profile: Object.freeze(prepared.profile) });
        createdAt = time; intentHash = null; acknowledgedFileNo = null;
      } catch {
        if (active(before)) publish({ ...state, error: 'راجع الاسم ورقم الموبايل والعمر وتاريخ أول زيارة قبل الحفظ.' });
        return;
      }
    }
    const submitted = command, ticket = ++epoch;
    publish({ ...state, saveStatus: acknowledgedFileNo === null ? 'preparing' : 'refresh-required',
      loading: acknowledgedFileNo !== null, pendingOperationId: submitted.operationId, error: '', notice: '' });
    await execute(ticket);
  }
  async function execute(ticket: number): Promise<void> {
    const submitted = command;
    if (!submitted || !active(ticket)) return;
    try {
      const repo = await getRepository(ticket);
      if (!repo || !active(ticket)) return;
      if (acknowledgedFileNo === null) {
        if (!createdAt) throw new CloudPatientError('unavailable');
        const log = journal(repo, ticket);
        const prepared = checkedIntent(await call(ticket, log, 'prepare', ['patient-profile', submitted, createdAt]), submitted.operationId, submitted, createdAt);
        if (!active(ticket)) return;
        if (prepared.intent.status === 'cancelled') throw new CloudPatientError('conflict');
        actorUid = prepared.intent.actorUid; intentHash = prepared.intent.requestHash;
        publish({ ...state, saveStatus: 'saving' }); assertActive(ticket);
        const result = ownFields(await call(ticket, repo, 'commit', [submitted]), ['status', 'recordId', 'fileNo', 'revision'], ['status', 'recordId', 'fileNo', 'revision']);
        if (!active(ticket)) return;
        if (!['committed', 'already-committed'].includes(result.status as string) || result.recordId !== submitted.recordId
          || result.revision !== submitted.expectedRevision + 1 || !validNumber(result.fileNo)
          || originalFileNo !== null && result.fileNo !== originalFileNo) throw new CloudPatientError('unavailable');
        acknowledgedFileNo = result.fileNo;
      }
      // Claim the refresh ticket and busy state BEFORE notifying subscribers;
      // a synchronous retry must not steal the initial acknowledged read.
      publish({ ...state, loading: true, saveStatus: 'refresh-required', error: '' }); assertActive(ticket);
      // An operation receipt is historical, not a patient snapshot. Only fresh
      // server reads may be published, including any newer device's edits.
      const response = await call(ticket, repo, 'get', [submitted.recordId]);
      if (!active(ticket)) return;
      const current = frozenRecord(response);
      if (current.recordId !== submitted.recordId || current.fileNo !== acknowledgedFileNo
        || current.revision < submitted.expectedRevision + 1) throw new CloudPatientError('unavailable');
      if (!active(ticket)) return;
      const responsePage = await call<CloudPatientPage>(ticket, repo, 'listPage', [{ afterId: null, limit: PAGE_SIZE }]);
      if (!active(ticket)) return;
      const page = checkedPage(responsePage, null, PAGE_SIZE);
      let selected = current;
      const records = page.records.map(record => {
        if (record.fileNo === current.fileNo && record.recordId !== current.recordId) throw new CloudPatientError('unavailable');
        if (record.recordId !== current.recordId) return record;
        if (record.fileNo !== current.fileNo) throw new CloudPatientError('unavailable');
        if (record.revision === current.revision && JSON.stringify(record) !== JSON.stringify(current)) throw new CloudPatientError('unavailable');
        if (record.revision >= current.revision) selected = record;
        return record.revision < current.revision ? current : record;
      });
      if (!active(ticket)) return;
      command = null; createdAt = null; intentHash = null; acknowledgedFileNo = null; originalFileNo = null; queryLimit = PAGE_SIZE;
      publish({ ...state, records: Object.freeze(records), nextAfterId: page.nextAfterId,
        loaded: true, loading: false, saveStatus: 'idle', pendingOperationId: null, selected, draft: null,
        query: Object.freeze({ kind: 'all' }), error: '',
        notice: 'تم تأكيد العملية وقراءة الملف من الخادم. رقم الملف ثابت؛ وقد تتضمن القراءة تعديلًا أحدث من جهاز آخر.' });
    } catch (error) {
      if (!active(ticket)) return;
      const code = safeCode(error);
      publish({ ...state, loading: false, saveStatus: acknowledgedFileNo === null ? 'retry-required' : 'refresh-required',
        error: acknowledgedFileNo !== null ? 'الحفظ مؤكد، لكن تعذر تحديث العرض. أعد التحقق بالقراءة فقط دون إنشاء عملية جديدة.'
          : code === 'conflict' ? 'تغيّر الملف أو حالة العملية. الأمر الأصلي ثابت؛ أعد المحاولة أو أكد إلغاء العملية قبل التعديل.'
            : 'لم يصل تأكيد الحفظ؛ ربما وصلت العملية للخادم. أعد المحاولة بنفس العملية دون تغييرها.' });
    }
  }
  async function cancelPending(): Promise<boolean> {
    if (!active() || capturing || busy() || !command || !createdAt || acknowledgedFileNo !== null) return false;
    const submitted = command, time = createdAt, ticket = ++epoch;
    publish({ ...state, loading: true, error: '', notice: '' });
    try {
      const repo = await getRepository(ticket); if (!repo || !active(ticket)) return false;
      const log = journal(repo, ticket);
      const current = checkedIntent(await call(ticket, log, 'get', [submitted.operationId]), submitted.operationId, submitted, time);
      assertActive(ticket); if (current.intent.status === 'committed') throw new CloudPatientError('conflict');
      actorUid = current.intent.actorUid; intentHash = current.intent.requestHash;
      const cancelled = checkedIntent(await call(ticket, log, 'cancel', [submitted.operationId]), submitted.operationId, submitted, time);
      assertActive(ticket); if (cancelled.intent.status !== 'cancelled') throw new CloudPatientError('conflict');
      command = null; createdAt = null; intentHash = null; acknowledgedFileNo = null; originalFileNo = null;
      publish({ ...state, loading: false, saveStatus: 'idle', pendingOperationId: null, draft: null, selected: null,
        records: Object.freeze([]), loaded: false, nextAfterId: null, query: Object.freeze({ kind: 'all' }), error: '',
        notice: 'تم تأكيد إلغاء العملية قبل تنفيذها. اقرأ أحدث ملف قبل أي تعديل جديد.' });
      return active(ticket);
    } catch {
      if (active(ticket)) publish({ ...state, loading: false, saveStatus: 'retry-required',
        error: 'تعذر تأكيد إلغاء العملية؛ قد تكون نُفذت. احتفظنا بالأمر الأصلي لإعادة التحقق دون إنشاء بديل.' });
      return false;
    }
  }
  async function resume(operationId: string): Promise<boolean> {
    if (!active() || !canRead() || !validId(operationId)) return false;
    const ticket = ++epoch;
    publish({ ...state, loading: true, error: '', notice: '' });
    try {
      const repo = await getRepository(ticket); if (!repo || !active(ticket)) return false;
      const result = checkedIntent(await call(ticket, journal(repo, ticket), 'get', [operationId]), operationId);
      assertActive(ticket); if (result.intent.status === 'cancelled') throw new CloudPatientError('conflict');
      const known = state.selected?.recordId === result.recovered.recordId ? state.selected
        : state.records.find(record => record.recordId === result.recovered.recordId) ?? null;
      originalFileNo = result.recovered.action === 'update' ? known?.fileNo ?? null : null;
      command = Object.freeze({ ...result.recovered, profile: Object.freeze(result.recovered.profile) });
      createdAt = result.intent.createdAt; actorUid = result.intent.actorUid; intentHash = result.intent.requestHash; acknowledgedFileNo = null;
      publish({ ...state, loading: false, pendingOperationId: operationId, saveStatus: 'preparing',
        draft: Object.freeze({ action: command.action, recordId: command.recordId, expectedRevision: command.expectedRevision, profile: command.profile }),
        error: '', notice: 'استرجعنا الأمر الأصلي؛ لم ننشئ عملية أو رقم ملف بديلًا.' });
      assertActive(ticket); await execute(ticket);
      return active() && state.pendingOperationId === null && state.saveStatus === 'idle';
    } catch {
      if (active(ticket)) publish({ ...state, loading: false, error: 'تعذر استرجاع العملية المطلوبة؛ لم ننشئ أمرًا بديلًا أو رقم ملف آخر.' });
      return false;
    }
  }
  return {
    getState: () => { active(); return state; },
    subscribe: (listener: (value: CloudPatientWorkspaceState) => void) => {
      if (!active()) return () => undefined;
      listeners.add(listener); return () => { listeners.delete(listener); };
    },
    refresh: () => load(false), loadMore: () => load(true),
    select: (recordId: string) => readOne(recordId, false),
    findByFileNo: (fileNo: number) => readOne(fileNo, true),
    findByPhone: (input: CloudPatientPhoneInput) => load(false, input, true),
    beginCreate, beginEdit, updateProfile,
    cancelDraft: (): boolean => {
      if (!active() || capturing || busy() || command) return false;
      originalFileNo = null;
      publish({ ...state, draft: null, error: '', notice: '' }); return true;
    },
    save, cancelPending, resume, recovery, dispose,
  };
}
export type CloudPatientWorkspaceController = ReturnType<typeof createCloudPatientWorkspaceController>;
