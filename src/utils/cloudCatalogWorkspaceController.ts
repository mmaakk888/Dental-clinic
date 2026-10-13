import { CloudServiceCatalogError, parseCloudServiceCatalogData, parseCloudServiceCatalogRecord,
  prepareCloudServiceCatalogCommand, prepareCloudServiceCatalogMutationCommand, applyCloudServiceCatalogMutation,
  type CloudServiceCatalogWriteCommand, type CloudServiceCatalogData, type CloudServiceCatalogRecord,
  type CloudServiceCatalogRepository, type CloudServiceDefinition } from './cloudServiceCatalogRepository';
import { parseCloudOperationIntent, prepareCloudIntentCommand,
  type CloudOperationIntent, type CloudOperationIntentRepository } from './cloudOperationIntent';

export interface CloudCatalogWorkspaceCapability {
  repository: CloudServiceCatalogRepository; journal: CloudOperationIntentRepository;
}
export interface CloudCatalogWorkspaceDraft { examinationCents: number | null; services: CloudServiceDefinition[] }
export interface CloudCatalogWorkspaceOptions {
  getCapability: () => Promise<CloudCatalogWorkspaceCapability>; isActive: () => boolean;
  newId?: () => string; now?: () => string;
}
export type CloudCatalogWorkspaceState = Readonly<{
  snapshot: CloudServiceCatalogRecord | null; loaded: boolean; loading: boolean; draft: CloudCatalogWorkspaceDraft | null;
  saveStatus: 'idle' | 'preparing' | 'saving' | 'retry-required' | 'refresh-required';
  pendingOperationId: string | null; error: string; notice: string; closed: boolean;
  history: readonly CloudOperationIntent[]; historyLoaded: boolean; historyLoading: boolean; historyNextAfterId: string | null;
}>;
const PAGE_SIZE = 25;
export const MAX_CLOUD_CATALOG_HISTORY_RECORDS = 2000;
const validId = (value: unknown): value is string => typeof value === 'string' && value.length === 36
  && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function fail(): never { throw new Error('تعذر تأكيد بيانات الفهرس.'); }
function exact(value: unknown, keys: readonly string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail();
  const found = Reflect.ownKeys(value);
  if (found.length !== keys.length || found.some(key => typeof key !== 'string' || !keys.includes(key))) fail();
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) fail();
    result[key] = descriptor.value;
  }
  return result;
}
function draft(value: unknown): CloudCatalogWorkspaceDraft {
  const item = exact(value, ['examinationCents', 'services']);
  const parsed = parseCloudServiceCatalogData({ examinationCents: item.examinationCents === null ? 0 : item.examinationCents,
    services: item.services });
  return { examinationCents: item.examinationCents === null ? null : parsed.examinationCents, services: parsed.services };
}
function conflict(error: unknown) {
  try { return error instanceof CloudServiceCatalogError && error.code === 'conflict'; } catch { return false; }
}
const empty = (closed = false): CloudCatalogWorkspaceState => ({ snapshot: null, loaded: false, loading: false, draft: null,
  saveStatus: 'idle', pendingOperationId: null, error: '', notice: '', closed,
  history: [], historyLoaded: false, historyLoading: false, historyNextAfterId: null });

/** Pure owner catalog editor and durable-operation recovery. Construction is
 * inert. The parent owns the actual Auth/view lease, not a transient checking
 * indicator; this controller never reads local settings or enables cloud UI. */
export function createCloudCatalogWorkspaceController(options: CloudCatalogWorkspaceOptions) {
  let state = freeze(empty()), epoch = 0, closed = false, checkingActive = false, capturing = false;
  let capability: CloudCatalogWorkspaceCapability | null = null, command: CloudServiceCatalogWriteCommand | null = null;
  let expectedData: CloudServiceCatalogData | null = null;
  let acknowledged: number | null = null, actorUid: string | null = null;
  const listeners = new Set<(value: CloudCatalogWorkspaceState) => void>();
  function publish(value: CloudCatalogWorkspaceState) {
    state = freeze(value);
    for (const listener of [...listeners]) { try { listener(value); } catch { /* A view grants no authority. */ } }
  }
  function dispose() {
    if (closed) return;
    closed = true; ++epoch; capability = null; command = null; expectedData = null; acknowledged = null; actorUid = null;
    publish(empty(true)); listeners.clear();
  }
  function active(ticket = epoch) {
    if (closed || ticket !== epoch || checkingActive) return false;
    let allowed = false;
    checkingActive = true;
    try { allowed = options.isActive() === true; } catch { /* Fixed, closed state only. */ }
    finally { checkingActive = false; }
    if (closed || ticket !== epoch) return false;
    if (!allowed) { dispose(); return false; }
    return true;
  }
  const busy = () => state.loading || state.historyLoading || state.saveStatus === 'preparing' || state.saveStatus === 'saving';
  const available = () => !capturing && active() && !busy();
  const assertActive = (ticket: number) => { if (!active(ticket)) fail(); };
  function capture<T>(work: () => T): T {
    if (capturing) fail(); capturing = true;
    try { return work(); } finally { capturing = false; }
  }
  async function getCapability(ticket: number) {
    assertActive(ticket);
    if (capability) return capability;
    const created = await options.getCapability(); assertActive(ticket);
    capability = created; return created;
  }
  async function call<T>(ticket: number, owner: object, key: string, args: unknown[] = []): Promise<T> {
    assertActive(ticket);
    const method = Reflect.get(owner, key); assertActive(ticket);
    if (typeof method !== 'function') fail();
    // Defer invocation to retain ownership even if a provider callback closes
    // the lease synchronously immediately before returning a rejected promise.
    const result = await Promise.resolve().then(() => { assertActive(ticket); return method.apply(owner, args) as Promise<T>; });
    assertActive(ticket); return result;
  }
  async function readSnapshot(ticket: number) {
    const cap = await getCapability(ticket); assertActive(ticket);
    const owner = cap.repository; assertActive(ticket);
    const raw = await call<unknown>(ticket, owner, 'get'); assertActive(ticket);
    const result = raw === null ? null : parseCloudServiceCatalogRecord(raw);
    assertActive(ticket); return result;
  }
  function checkedIntent(value: unknown, id?: string, expected?: CloudServiceCatalogWriteCommand) {
    const intent = parseCloudOperationIntent(value), recovered = prepareCloudServiceCatalogCommand(intent.command);
    if (intent.kind !== 'catalog' || intent.operationId !== recovered.operationId || id !== undefined && intent.operationId !== id
      || intent.createdAt !== recovered.createdAt || actorUid !== null && intent.actorUid !== actorUid
      || JSON.stringify(intent.command) !== JSON.stringify(prepareCloudIntentCommand(recovered))
      || expected !== undefined && JSON.stringify(intent.command) !== JSON.stringify(prepareCloudIntentCommand(expected))) fail();
    return { intent, recovered };
  }
  async function load(): Promise<boolean> {
    if (!available() || command || state.draft) return false;
    const ticket = ++epoch;
    publish({ ...state, snapshot: null, loaded: false, loading: true, error: '', notice: '' });
    try {
      const snapshot = await readSnapshot(ticket); assertActive(ticket);
      publish({ ...state, snapshot, loaded: true, loading: false,
        notice: snapshot ? 'تمت قراءة فهرس الأسعار من الخادم.' : 'لم يُحفظ فهرس أسعار بعد. حدد قيمة الكشف والخدمات صراحة قبل أول حفظ.' });
      return active(ticket);
    } catch {
      if (active(ticket)) publish({ ...state, snapshot: null, loaded: false, loading: false,
        error: 'تعذر قراءة فهرس الأسعار؛ لم نستخدم أسعارًا افتراضية أو بيانات من المتصفح.' });
      return false;
    }
  }
  async function execute(ticket: number): Promise<boolean> {
    const submitted = command;
    if (!submitted || !active(ticket)) return false;
    try {
      const cap = await getCapability(ticket); assertActive(ticket);
      if (acknowledged === null) {
        if ('mutationVersion' in submitted) {
          publish({ ...state, saveStatus: 'preparing', error: '', notice: '' }); assertActive(ticket);
          const journal = cap.journal; assertActive(ticket);
          const prepared = checkedIntent(await call(ticket, journal, 'prepare', ['catalog', submitted, submitted.createdAt]), submitted.operationId, submitted);
          assertActive(ticket);
          if (prepared.intent.status === 'cancelled') fail();
          actorUid = prepared.intent.actorUid;
        }
        // Legacy commands enter only through a confirmed committed journal.
        // The repository verifies their original receipt; never prepare a new
        // full replacement or replay an uncommitted legacy command.
        publish({ ...state, saveStatus: 'saving' }); assertActive(ticket);
        const repository = cap.repository; assertActive(ticket);
        const receipt = exact(await call(ticket, repository, 'commit', [submitted]), ['status', 'recordId', 'revision']);
        assertActive(ticket);
        if (!['committed', 'already-committed'].includes(receipt.status as string) || receipt.recordId !== 'serviceCatalog'
          || receipt.revision !== submitted.expectedRevision + 1) fail();
        acknowledged = receipt.revision as number;
      }
      publish({ ...state, loading: true, saveStatus: 'refresh-required', error: '' }); assertActive(ticket);
      const snapshot = await readSnapshot(ticket); assertActive(ticket);
      const matches = snapshot && (expectedData !== null
        ? JSON.stringify(snapshot.data) === JSON.stringify(expectedData)
        : 'mutationVersion' in submitted
          ? submitted.action === 'examination' ? snapshot.data.examinationCents === submitted.examinationCents
            : JSON.stringify(snapshot.data.services[submitted.index]) === JSON.stringify(submitted.service)
          : JSON.stringify(snapshot.data) === JSON.stringify(submitted.data));
      if (!snapshot || snapshot.revision < acknowledged
        || snapshot.revision === acknowledged && (snapshot.lastOperationId !== submitted.operationId
          || !matches)) fail();
      command = null; expectedData = null; acknowledged = null;
      publish({ ...state, snapshot, loaded: true, loading: false, draft: null, pendingOperationId: null, saveStatus: 'idle',
        history: [], historyLoaded: false, historyNextAfterId: null, error: '',
        notice: 'تم تأكيد حفظ العملية وقراءة الأسعار الحالية من الخادم. لا يؤثر التعديل في أسعار الجلسات السابقة.' });
      return active(ticket);
    } catch (error) {
      if (active(ticket)) publish({ ...state, loading: false, saveStatus: acknowledged === null ? 'retry-required' : 'refresh-required',
        error: acknowledged !== null ? 'الحفظ مؤكد؛ تعذر تحديث الأسعار الحالية. أعد التحقق بالقراءة فقط دون عملية حفظ جديدة.'
          : conflict(error) ? 'تغير الفهرس أو حالة العملية. المسودة الأصلية ثابتة؛ أعد التحقق أو أكد إلغاء العملية قبل تعديلها.'
            : 'لم يصل تأكيد الحفظ. أعد المحاولة بنفس العملية الأصلية؛ لا تنشئ نسخة أخرى منها.' });
      return false;
    }
  }
  async function save(): Promise<boolean> {
    if (!available() || command || !state.loaded || !state.draft) return false;
    const before = epoch, source = state.draft, snapshot = state.snapshot;
    let prepared: CloudServiceCatalogWriteCommand, nextData: CloudServiceCatalogData;
    try {
      prepared = capture(() => {
        const data = parseCloudServiceCatalogData(source), previous = snapshot?.data ?? null;
        const examinationChanged = previous === null || data.examinationCents !== previous.examinationCents;
        const oldRows = previous?.services ?? [], changed: number[] = [];
        if (data.services.length < oldRows.length || data.services.length > oldRows.length + 1) fail();
        for (let index = 0; index < data.services.length; index++) {
          if (index < oldRows.length && data.services[index].serviceId !== oldRows[index].serviceId) fail();
          if (JSON.stringify(data.services[index]) !== JSON.stringify(oldRows[index])) changed.push(index);
        }
        if (examinationChanged ? changed.length !== 0 : changed.length !== 1 || previous === null) fail();
        const mutation = prepareCloudServiceCatalogMutationCommand({ mutationVersion: 2,
          operationId: (options.newId ?? (() => crypto.randomUUID()))(), expectedRevision: snapshot?.revision ?? 0,
          createdAt: (options.now ?? (() => new Date().toISOString()))(),
          ...(examinationChanged ? { action: 'examination', examinationCents: data.examinationCents }
            : { action: 'service', index: changed[0], service: data.services[changed[0]] }),
        });
        nextData = freeze(applyCloudServiceCatalogMutation(previous, mutation));
        return freeze(mutation);
      });
    } catch {
      if (active(before)) publish({ ...state, error: 'احفظ تعديل قيمة الكشف أو خدمة واحدة فقط في كل عملية. لا يمكن حذف الخدمات أو إعادة ترتيبها؛ يمكن إيقاف الخدمة.' });
      return false;
    }
    if (!active(before) || busy() || command || state.draft !== source || state.snapshot !== snapshot) return false;
    command = prepared; expectedData = nextData!; acknowledged = null;
    const ticket = ++epoch;
    publish({ ...state, saveStatus: 'preparing', pendingOperationId: prepared.operationId, error: '', notice: '' });
    return execute(ticket);
  }
  async function retry(): Promise<boolean> {
    if (!available() || !command || !['retry-required', 'refresh-required'].includes(state.saveStatus)) return false;
    const ticket = ++epoch;
    publish({ ...state, loading: true, error: '' });
    return execute(ticket);
  }
  async function cancelPending(): Promise<boolean> {
    if (!available() || !command || acknowledged !== null) return false;
    const submitted = command, ticket = ++epoch;
    publish({ ...state, loading: true, error: '', notice: '' });
    try {
      const cap = await getCapability(ticket); assertActive(ticket);
      const journal = cap.journal; assertActive(ticket);
      // Validate the complete matching command BEFORE requesting cancellation,
      // not just after a potentially mutating adapter call.
      const current = checkedIntent(await call(ticket, journal, 'get', [submitted.operationId]), submitted.operationId, submitted);
      assertActive(ticket); if (current.intent.status === 'committed') fail();
      actorUid = current.intent.actorUid;
      const result = checkedIntent(await call(ticket, journal, 'cancel', [submitted.operationId]), submitted.operationId, submitted);
      assertActive(ticket); if (result.intent.status !== 'cancelled') fail();
      command = null; expectedData = null; acknowledged = null;
      publish({ ...state, snapshot: null, loaded: false, loading: false, draft: null, pendingOperationId: null, saveStatus: 'idle',
        history: [], historyLoaded: false, historyNextAfterId: null, error: '',
        notice: 'تم تأكيد إلغاء العملية قبل تنفيذها. اقرأ أحدث فهرس قبل أي تعديل جديد.' });
      return active(ticket);
    } catch {
      if (active(ticket)) publish({ ...state, loading: false, saveStatus: 'retry-required',
        error: 'تعذر تأكيد إلغاء العملية؛ قد تكون نُفذت. أعد التحقق من نفس العملية قبل إنشاء تعديل آخر.' });
      return false;
    }
  }
  async function resume(operationId: string): Promise<boolean> {
    if (!available() || command || state.draft || !validId(operationId)) return false;
    const ticket = ++epoch;
    publish({ ...state, loading: true, snapshot: null, loaded: false, error: '', notice: '' });
    try {
      const cap = await getCapability(ticket); assertActive(ticket);
      const journal = cap.journal; assertActive(ticket);
      const result = checkedIntent(await call(ticket, journal, 'get', [operationId]), operationId);
      assertActive(ticket); if (result.intent.status === 'cancelled'
        || !('mutationVersion' in result.recovered) && result.intent.status !== 'committed') fail();
      actorUid = result.intent.actorUid; command = freeze(result.recovered); expectedData = null; acknowledged = null;
      // A resumed mutation is not a full catalog snapshot. Do not invent empty
      // services/default examination values while its acknowledgement is unknown.
      publish({ ...state, loading: false, draft: 'mutationVersion' in command ? null : freeze(draft(command.data)),
        pendingOperationId: command.operationId, saveStatus: 'preparing' });
      return execute(ticket);
    } catch {
      if (active(ticket)) publish({ ...state, loading: false, error: 'تعذر استرجاع عملية الأسعار المطلوبة؛ لم ننشئ عملية بديلة.' });
      return false;
    }
  }
  async function history(more: boolean): Promise<void> {
    if (!available() || command || state.draft || more && (!state.historyLoaded || state.historyNextAfterId === null)) return;
    const afterId = more ? state.historyNextAfterId : null, ticket = ++epoch;
    publish({ ...state, ...(more ? {} : { history: [], historyLoaded: false, historyNextAfterId: null }), historyLoading: true, error: '', notice: '' });
    try {
      const cap = await getCapability(ticket); assertActive(ticket);
      const journal = cap.journal; assertActive(ticket);
      const page = exact(await call(ticket, journal, 'listHistoryPage', ['catalog', { afterId, limit: PAGE_SIZE }]), ['records', 'nextAfterId']);
      assertActive(ticket);
      if (!Array.isArray(page.records) || page.records.length > PAGE_SIZE || Reflect.ownKeys(page.records).length !== page.records.length + 1) fail();
      const records: CloudOperationIntent[] = []; let previous = afterId, actor = actorUid;
      for (let index = 0; index < page.records.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(page.records, String(index));
        if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) fail();
        const { intent } = checkedIntent(descriptor.value);
        if (previous !== null && intent.operationId <= previous || actor !== null && intent.actorUid !== actor) fail();
        records.push(intent); previous = intent.operationId; actor = intent.actorUid;
      }
      if (page.nextAfterId !== (records.length === PAGE_SIZE ? previous : null)) fail();
      const combined = more ? [...state.history, ...records] : records; assertActive(ticket);
      if (combined.length > MAX_CLOUD_CATALOG_HISTORY_RECORDS) {
        publish({ ...state, historyLoaded: false, historyLoading: false, historyNextAfterId: null,
          error: 'تجاوز سجل الأسعار حد العرض البالغ ٢٠٠٠ عملية. القائمة غير مكتملة؛ لم تُحذف أو تُنفذ أي عملية.',
          notice: 'المعروض هو الجزء المحمّل فقط، وليس جميع العمليات.' }); return;
      }
      actorUid = actor;
      publish({ ...state, history: combined, historyLoaded: true, historyLoading: false, historyNextAfterId: page.nextAfterId as string | null,
        notice: page.nextAfterId === null ? 'وصلنا إلى نهاية الصفحات المقروءة بترتيب المعرف، وليس ترتيب الأحدث. حدّث السجل لالتقاط عمليات جديدة.'
          : `تم تحميل ${combined.length} عملية. القائمة جزئية؛ حمّل المزيد.` });
    } catch {
      if (active(ticket)) publish({ ...state, historyLoading: false,
        error: 'تعذر قراءة سجل عمليات الأسعار المؤكد؛ لم تُنفذ أو تُلغَ أي عملية.',
        notice: more && state.history.length ? 'المعروض هو الجزء المحمّل فقط، وليس جميع العمليات.' : '' });
    }
  }
  return {
    getState: () => { active(); return state; },
    subscribe: (listener: (value: CloudCatalogWorkspaceState) => void) => {
      if (!active()) return () => undefined;
      listeners.add(listener); return () => { listeners.delete(listener); };
    },
    load,
    beginEdit(): boolean {
      if (!available() || command || state.draft || !state.loaded) return false;
      const ticket = epoch, created = freeze(draft(state.snapshot?.data ?? { examinationCents: null, services: [] }));
      if (!active(ticket)) return false;
      publish({ ...state, draft: created, error: '', notice: '' });
      return active(ticket) && state.draft === created;
    },
    updateDraft(input: unknown): boolean {
      if (!available() || command || !state.draft) return false;
      const ticket = epoch, before = state.draft; let prepared: CloudCatalogWorkspaceDraft;
      try { prepared = capture(() => freeze(draft(input))); }
      catch { if (active(ticket)) publish({ ...state, error: 'راجع أسماء الخدمات وأنواعها والأسعار قبل تعديل المسودة.' }); return false; }
      if (!active(ticket) || state.draft !== before || command) return false;
      publish({ ...state, draft: prepared, error: '', notice: '' }); return active(ticket) && state.draft === prepared;
    },
    cancelDraft(): boolean {
      if (!available() || command || !state.draft) return false;
      const ticket = epoch;
      publish({ ...state, draft: null, error: '', notice: 'أُلغيت المسودة فقط، ولم تتغير الأسعار المحفوظة.' });
      return active(ticket) && state.draft === null;
    },
    save, retry, cancelPending, resume, loadHistory: () => history(false), loadMoreHistory: () => history(true), dispose,
  };
}
export type CloudCatalogWorkspaceController = ReturnType<typeof createCloudCatalogWorkspaceController>;
