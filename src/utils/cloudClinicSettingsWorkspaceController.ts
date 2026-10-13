import { CloudClinicSettingsError, cloudClinicSettingsPath, parseCloudClinicSettingsRecord, parseCloudLabDefinition,
  parseCloudProstheticRouting, parseCloudClinicLogoRecord, prepareCloudClinicSettingsCommand,
  type CloudSettingsTarget, type CloudSettingsRecord, type CloudClinicSettingsCommand, type CloudClinicSettingsRepository,
  type CloudLabDefinitionRecord } from './cloudClinicSettingsRepository';
import { parseCloudServiceCatalogRecord, type CloudServiceCatalogRecord } from './cloudServiceCatalogRepository';
import { parseCloudOperationIntent, prepareCloudIntentCommand, type CloudIntentJson,
  type CloudOperationIntent, type CloudOperationIntentRepository } from './cloudOperationIntent';

export interface CloudClinicSettingsWorkspaceCapability {
  repository: CloudClinicSettingsRepository; journal: CloudOperationIntentRepository;
}
export interface CloudClinicSettingsWorkspaceOptions {
  getCapability(): Promise<CloudClinicSettingsWorkspaceCapability>;
  getServiceCatalog(): Promise<{ repository: { get(): Promise<unknown> } }>;
  /** Actual owner/view lease, not transient checking/connectivity. */
  isActive(): boolean; newId?: () => string; now?: () => string;
}
export interface CloudClinicSettingsWorkspaceDraft {
  target: CloudSettingsTarget; recordId: string; expectedRevision: number; data: CloudIntentJson;
}
export interface CloudClinicSettingsSelection { target: CloudSettingsTarget; recordId: string }
export type CloudClinicSettingsWorkspaceState = Readonly<{
  selection: CloudClinicSettingsSelection; snapshot: CloudSettingsRecord | null; loaded: boolean; loading: boolean;
  draft: CloudClinicSettingsWorkspaceDraft | null; pendingOperationId: string | null;
  saveStatus: 'idle' | 'preparing' | 'saving' | 'retry-required' | 'refresh-required'; error: string; notice: string; closed: boolean;
  labs: readonly CloudLabDefinitionRecord[]; labsLoaded: boolean; labsNextAfterId: string | null;
  catalog: CloudServiceCatalogRecord | null; referencesLoaded: boolean;
  history: readonly CloudOperationIntent[]; historyLoaded: boolean; historyLoading: boolean; historyNextAfterId: string | null;
}>;
const PAGE = 25, MAX_LOADED = 2000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const validId = (value: unknown): value is string => typeof value === 'string' && value.length === 36 && UUID.test(value);
function fail(): never { throw new Error('تعذر تأكيد إعدادات العيادة.'); }
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value;
}
function exact(value: unknown, keys: readonly string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail();
  const own = Reflect.ownKeys(value); if (own.length !== keys.length || keys.some(key => !own.includes(key))) fail();
  const result: Record<string, unknown> = {};
  for (const key of keys) { const property = Object.getOwnPropertyDescriptor(value, key);
    if (!property || !('value' in property) || !property.enumerable) fail(); result[key] = property.value; }
  return result;
}
/** Raw incomplete editor fields stay in memory; only the domain parser can
 * produce a sendable command. Snapshot without getters/prototypes/secret APIs. */
function rawDraft(value: unknown): CloudIntentJson {
  const captured = prepareCloudIntentCommand({ operationId: '00000000-0000-4000-8000-000000000000', data: value });
  return captured.data;
}
function selected(target: CloudSettingsTarget, id: string): CloudClinicSettingsSelection {
  cloudClinicSettingsPath(target, id); return { target, recordId: id };
}
function parsed(target: CloudSettingsTarget, value: unknown, id: string): CloudSettingsRecord {
  if (target === 'clinicSettings') return parseCloudClinicSettingsRecord(value);
  if (target === 'lab') return parseCloudLabDefinition(value, id);
  if (target === 'prostheticRouting') return parseCloudProstheticRouting(value);
  return parseCloudClinicLogoRecord(value);
}
const empty = (closed = false): CloudClinicSettingsWorkspaceState => ({ selection: { target: 'clinicSettings', recordId: 'clinicSettings' },
  snapshot: null, loaded: false, loading: false, draft: null, pendingOperationId: null, saveStatus: 'idle', error: '', notice: '', closed,
  labs: [], labsLoaded: false, labsNextAfterId: null, catalog: null, referencesLoaded: false,
  history: [], historyLoaded: false, historyLoading: false, historyNextAfterId: null });

/** Inert, injected-session settings editor. No SDK/storage/reads/IDs/clock on
 * construction. One retained full command survives uncertain prepare/commit;
 * acknowledgement refreshes by reads only. All-status journal recovers reloads. */
export function createCloudClinicSettingsWorkspaceController(options: CloudClinicSettingsWorkspaceOptions) {
  let state = freeze(empty()), epoch = 0, closed = false, checking = false, capturing = false;
  let capability: CloudClinicSettingsWorkspaceCapability | null = null, command: CloudClinicSettingsCommand | null = null;
  let acknowledged: number | null = null, actorUid: string | null = null;
  const listeners = new Set<(state: CloudClinicSettingsWorkspaceState) => void>();
  function publish(value: CloudClinicSettingsWorkspaceState) {
    const transition = freeze(value); state = transition;
    for (const listener of [...listeners]) { try { listener(transition); } catch { /* A view grants no permission. */ } }
  }
  function dispose() {
    if (closed) return; closed = true; epoch++; capability = null; command = null; acknowledged = null; actorUid = null;
    publish(empty(true)); listeners.clear();
  }
  function active(ticket = epoch) {
    if (closed || checking || ticket !== epoch) return false;
    checking = true; let valid = false;
    try { valid = options.isActive() === true; } catch { /* Fail closed. */ } finally { checking = false; }
    if (closed || ticket !== epoch) return false;
    if (!valid) { dispose(); return false; } return true;
  }
  const busy = () => state.loading || state.historyLoading || state.saveStatus === 'preparing' || state.saveStatus === 'saving';
  const available = () => !capturing && active() && !busy();
  const clean = () => available() && !command && !state.draft;
  const assertActive = (ticket: number) => { if (!active(ticket)) fail(); };
  function capture<T>(work: () => T) { if (capturing) fail(); capturing = true; try { return work(); } finally { capturing = false; } }
  async function cap(ticket: number) {
    assertActive(ticket); if (capability) return capability;
    const result = await options.getCapability(); assertActive(ticket); capability = result; return result;
  }
  async function call<T>(ticket: number, owner: object, key: string, args: unknown[] = []): Promise<T> {
    assertActive(ticket); const method = Reflect.get(owner, key); assertActive(ticket); if (typeof method !== 'function') fail();
    const result = await Promise.resolve().then(() => { assertActive(ticket); return method.apply(owner, args) as Promise<T>; });
    assertActive(ticket); return result;
  }
  async function read(ticket: number, selection: CloudClinicSettingsSelection) {
    const repository = (await cap(ticket)).repository; assertActive(ticket);
    const method = ({ clinicSettings: 'get', lab: 'getLab', prostheticRouting: 'getRouting', clinicLogo: 'getLogo' } as const)[selection.target];
    const raw = await call<unknown>(ticket, repository, method, selection.target === 'lab' ? [selection.recordId] : []);
    const result = raw === null ? null : parsed(selection.target, raw, selection.recordId); assertActive(ticket); return result;
  }
  function checkedIntent(value: unknown, id?: string, expected?: CloudClinicSettingsCommand) {
    const intent = parseCloudOperationIntent(value), recovered = prepareCloudClinicSettingsCommand(intent.command);
    if (intent.kind !== 'settings' || intent.createdAt !== recovered.createdAt || intent.operationId !== recovered.operationId
      || id !== undefined && intent.operationId !== id || actorUid !== null && intent.actorUid !== actorUid
      || JSON.stringify(intent.command) !== JSON.stringify(prepareCloudIntentCommand(recovered))
      || expected && JSON.stringify(intent.command) !== JSON.stringify(prepareCloudIntentCommand(expected))) fail();
    return { intent, recovered };
  }
  async function load(target: CloudSettingsTarget = 'clinicSettings', recordId: string = target): Promise<boolean> {
    if (!clean()) return false; let selection: CloudClinicSettingsSelection;
    try { selection = capture(() => selected(target, recordId)); } catch { return false; }
    if (!clean()) return false; const ticket = ++epoch;
    publish({ ...state, selection, snapshot: null, loaded: false, loading: true, error: '', notice: '' });
    try {
      const snapshot = await read(ticket, selection); assertActive(ticket);
      publish({ ...state, snapshot, loaded: true, loading: false,
        notice: snapshot ? 'تمت قراءة النسخة الحالية من الخادم.' : 'لا توجد إعدادات مؤكدة لهذا القسم؛ لا نستخدم بيانات المتصفح أو نفترض أسعارًا.' }); return active(ticket);
    } catch { if (active(ticket)) publish({ ...state, loading: false, loaded: false, snapshot: null, error: 'تعذر قراءة إعدادات القسم من الخادم.' }); return false; }
  }
  async function labs(more: boolean) {
    if (!clean() || more && (!state.labsLoaded || state.labsNextAfterId === null)) return false;
    const afterId = more ? state.labsNextAfterId : null, ticket = ++epoch;
    publish({ ...state, loading: true, error: '', notice: '', referencesLoaded: false });
    try {
      const repository = (await cap(ticket)).repository;
      const page = exact(await call(ticket, repository, 'listLabsPage', [{ afterId, limit: PAGE }]), ['records', 'nextAfterId']);
      if (!Array.isArray(page.records) || page.records.length > PAGE || Reflect.ownKeys(page.records).length !== page.records.length + 1) fail();
      let previous = afterId; const records: CloudLabDefinitionRecord[] = [];
      for (let index = 0; index < page.records.length; index++) {
        const property = Object.getOwnPropertyDescriptor(page.records, String(index)); if (!property || !('value' in property) || !property.enumerable) fail();
        const record = parseCloudLabDefinition(property.value); if (previous !== null && record.recordId <= previous) fail(); previous = record.recordId; records.push(record);
      }
      if (page.nextAfterId !== (records.length === PAGE ? previous : null)) fail();
      const combined = more ? [...state.labs, ...records] : records; if (combined.length > MAX_LOADED) fail(); assertActive(ticket);
      publish({ ...state, loading: false, labs: combined, labsLoaded: true, labsNextAfterId: page.nextAfterId as string | null,
        notice: page.nextAfterId ? 'قائمة المعامل جزئية؛ حمّل الصفحة التالية.' : 'وصلت قراءة صفحات المعامل إلى نهايتها؛ الأسعار تُراجع مجددًا عند الحفظ.' }); return active(ticket);
    } catch { if (active(ticket)) publish({ ...state, loading: false, error: 'تعذر تأكيد صفحات المعامل؛ لا تعتبر الجزء المحمّل جميع المعامل.' }); return false; }
  }
  async function loadRoutingReferences() {
    if (!clean()) return false; const ticket = ++epoch;
    publish({ ...state, loading: true, referencesLoaded: false, catalog: null, error: '', notice: '' });
    try {
      const service = await options.getServiceCatalog(); assertActive(ticket);
      const firstRaw = await call<unknown>(ticket, service.repository, 'get'); if (firstRaw === null) fail();
      const first = parseCloudServiceCatalogRecord(firstRaw), repository = (await cap(ticket)).repository;
      let afterId: string | null = null; const rows: CloudLabDefinitionRecord[] = [];
      do {
        const page = exact(await call(ticket, repository, 'listLabsPage', [{ afterId, limit: PAGE }]), ['records', 'nextAfterId']);
        if (!Array.isArray(page.records) || page.records.length > PAGE || Reflect.ownKeys(page.records).length !== page.records.length + 1) fail();
        let previous = afterId;
        for (let index = 0; index < page.records.length; index++) {
          const descriptor = Object.getOwnPropertyDescriptor(page.records, String(index)); if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) fail();
          const row = parseCloudLabDefinition(descriptor.value); if (previous !== null && row.recordId <= previous) fail(); rows.push(row); previous = row.recordId;
        }
        if (page.nextAfterId !== (page.records.length === PAGE ? previous : null) || rows.length > MAX_LOADED) fail();
        afterId = page.nextAfterId as string | null;
      } while (afterId !== null);
      const last = parseCloudServiceCatalogRecord(await call(ticket, service.repository, 'get'));
      if (JSON.stringify(first) !== JSON.stringify(last)) fail(); assertActive(ticket);
      publish({ ...state, catalog: last, labs: rows, labsLoaded: true, labsNextAfterId: null, referencesLoaded: true, loading: false,
        notice: 'الاختيارات من فهرس الخدمات والمعامل المقروءين؛ المعاملة تعيد فحص الروابط الحديثة عند الحفظ، ولا تستنتج تكلفة مجهولة.' }); return active(ticket);
    } catch { if (active(ticket)) publish({ ...state, loading: false, referencesLoaded: false, catalog: null,
      error: 'تعذر تأكيد فهرس الخدمات أو المعامل. لم نستخدم أسعارًا أو توجيهًا افتراضيًا.' }); return false; }
  }
  async function execute(ticket: number): Promise<boolean> {
    const submitted = command; if (!submitted || !active(ticket)) return false;
    try {
      const capability = await cap(ticket);
      if (acknowledged === null) {
        publish({ ...state, saveStatus: 'preparing', error: '', notice: '' }); assertActive(ticket);
        const prepared = checkedIntent(await call(ticket, capability.journal, 'prepare', ['settings', submitted, submitted.createdAt]), submitted.operationId, submitted);
        if (prepared.intent.status === 'cancelled') fail(); actorUid = prepared.intent.actorUid;
        publish({ ...state, saveStatus: 'saving' }); assertActive(ticket);
        const receipt = exact(await call(ticket, capability.repository, 'commit', [submitted]), ['status', 'target', 'recordId', 'revision']);
        if (!['committed', 'already-committed'].includes(receipt.status as string) || receipt.target !== submitted.target
          || receipt.recordId !== submitted.recordId || receipt.revision !== submitted.expectedRevision + 1) fail(); acknowledged = receipt.revision as number;
      }
      publish({ ...state, loading: true, saveStatus: 'refresh-required', error: '' }); assertActive(ticket);
      const snapshot = await read(ticket, { target: submitted.target, recordId: submitted.recordId });
      if (!snapshot || snapshot.revision < acknowledged || snapshot.revision === acknowledged
        && (snapshot.lastOperationId !== submitted.operationId || JSON.stringify(snapshot.data) !== JSON.stringify(submitted.data))) fail();
      assertActive(ticket); command = null; acknowledged = null;
      publish({ ...state, snapshot, loaded: true, loading: false, draft: null, pendingOperationId: null, saveStatus: 'idle',
        history: [], historyLoaded: false, historyNextAfterId: null, referencesLoaded: false, error: '', notice: 'تم تأكيد العملية وقراءة النسخة الحالية. الأسعار السابقة للحالات لا تتغير بأثر رجعي.' }); return active(ticket);
    } catch (error) {
      let conflict = false; try { conflict = error instanceof CloudClinicSettingsError && error.code === 'conflict'; } catch { /* Fixed errors only. */ }
      if (active(ticket)) publish({ ...state, loading: false, saveStatus: acknowledged === null ? 'retry-required' : 'refresh-required',
        error: acknowledged !== null ? 'الحفظ مؤكد؛ تعذر تحديث العرض. أعد التحقق بالقراءة فقط.'
          : conflict ? 'تغيرت النسخة أو الروابط. العملية الأصلية ثابتة؛ تحقق منها أو أكد إلغاءها قبل أي تعديل آخر.' : 'تأكيد الحفظ لم يصل. أعد نفس العملية دون إنشاء نسخة بديلة.' }); return false;
    }
  }
  async function save(expected = state.draft): Promise<boolean> {
    if (!available() || command || !expected || state.draft !== expected || !state.loaded) return false;
    const before = epoch; let submitted: CloudClinicSettingsCommand;
    try { submitted = capture(() => freeze(prepareCloudClinicSettingsCommand({ target: expected.target, recordId: expected.recordId,
      operationId: (options.newId ?? (() => crypto.randomUUID()))(), expectedRevision: expected.expectedRevision,
      createdAt: (options.now ?? (() => new Date().toISOString()))(), data: expected.data }))); }
    catch { if (active(before)) publish({ ...state, error: 'أكمل بيانات القسم وراجع الأسعار والروابط قبل الحفظ؛ لم تُرسل بيانات غير مكتملة.' }); return false; }
    if (!active(before) || busy() || command || state.draft !== expected) return false;
    command = submitted; acknowledged = null; const ticket = ++epoch;
    publish({ ...state, pendingOperationId: submitted.operationId, saveStatus: 'preparing', error: '', notice: '' }); return execute(ticket);
  }
  async function retry(): Promise<boolean> {
    if (!available() || !command || !['retry-required', 'refresh-required'].includes(state.saveStatus)) return false;
    const ticket = ++epoch; publish({ ...state, loading: true, error: '' }); return execute(ticket);
  }
  async function cancelPending(): Promise<boolean> {
    if (!available() || !command || acknowledged !== null) return false;
    const submitted = command, ticket = ++epoch; publish({ ...state, loading: true, error: '', notice: '' });
    try {
      const capability = await cap(ticket), before = checkedIntent(await call(ticket, capability.journal, 'get', [submitted.operationId]), submitted.operationId, submitted);
      if (before.intent.status === 'committed') fail(); actorUid = before.intent.actorUid;
      const result = checkedIntent(await call(ticket, capability.journal, 'cancel', [submitted.operationId]), submitted.operationId, submitted);
      if (result.intent.status !== 'cancelled') fail(); assertActive(ticket); command = null; acknowledged = null;
      publish({ ...state, snapshot: null, loaded: false, loading: false, draft: null, pendingOperationId: null, saveStatus: 'idle',
        history: [], historyLoaded: false, historyNextAfterId: null, error: '', notice: 'تأكد إلغاء العملية قبل تنفيذها. اقرأ أحدث نسخة قبل تعديل جديد.' }); return active(ticket);
    } catch { if (active(ticket)) publish({ ...state, loading: false, saveStatus: 'retry-required', error: 'لم يتأكد الإلغاء؛ قد تكون العملية نُفذت. تحقق من العملية نفسها.' }); return false; }
  }
  async function resume(operationId: string): Promise<boolean> {
    if (!clean() || !validId(operationId)) return false; const ticket = ++epoch;
    publish({ ...state, loading: true, loaded: false, snapshot: null, error: '', notice: '' });
    try {
      const capability = await cap(ticket), result = checkedIntent(await call(ticket, capability.journal, 'get', [operationId]), operationId);
      if (result.intent.status === 'cancelled') fail(); assertActive(ticket); actorUid = result.intent.actorUid;
      command = freeze(result.recovered); acknowledged = null;
      const selection = selected(command.target, command.recordId);
      publish({ ...state, selection, loading: false, pendingOperationId: command.operationId, saveStatus: 'preparing',
        draft: { ...selection, expectedRevision: command.expectedRevision, data: rawDraft(command.data) } }); return execute(ticket);
    } catch { if (active(ticket)) publish({ ...state, loading: false, error: 'تعذر استرجاع العملية المحددة؛ لم ننشئ عملية بديلة.' }); return false; }
  }
  async function history(more: boolean) {
    if (!clean() || more && (!state.historyLoaded || state.historyNextAfterId === null)) return false;
    const afterId = more ? state.historyNextAfterId : null, ticket = ++epoch;
    publish({ ...state, historyLoading: true, ...(more ? {} : { history: [], historyLoaded: false, historyNextAfterId: null }), error: '', notice: '' });
    try {
      const capability = await cap(ticket), page = exact(await call(ticket, capability.journal, 'listHistoryPage', ['settings', { afterId, limit: PAGE }]), ['records', 'nextAfterId']);
      if (!Array.isArray(page.records) || page.records.length > PAGE || Reflect.ownKeys(page.records).length !== page.records.length + 1) fail();
      let previous = afterId, actor = actorUid; const records: CloudOperationIntent[] = [];
      for (let index = 0; index < page.records.length; index++) {
        const property = Object.getOwnPropertyDescriptor(page.records, String(index)); if (!property || !('value' in property) || !property.enumerable) fail();
        const { intent } = checkedIntent(property.value); if (previous !== null && intent.operationId <= previous || actor !== null && intent.actorUid !== actor) fail();
        records.push(intent); previous = intent.operationId; actor = intent.actorUid;
      }
      if (page.nextAfterId !== (records.length === PAGE ? previous : null)) fail();
      const combined = more ? [...state.history, ...records] : records; if (combined.length > MAX_LOADED) fail(); assertActive(ticket); actorUid = actor;
      publish({ ...state, history: combined, historyLoaded: true, historyLoading: false, historyNextAfterId: page.nextAfterId as string | null,
        notice: page.nextAfterId ? 'سجل العمليات جزئي؛ حمّل المزيد.' : 'نهاية الصفحات المقروءة بترتيب المعرف؛ ليست قائمة الأحدث عالميًا.' }); return active(ticket);
    } catch { if (active(ticket)) publish({ ...state, historyLoading: false, error: 'تعذر تأكيد سجل الإعدادات بالكامل؛ لم تُنفذ أو تُلغَ عملية.' }); return false; }
  }
  return {
    getState: () => { active(); return state; },
    subscribe(listener: (state: CloudClinicSettingsWorkspaceState) => void) { if (!active()) return () => undefined;
      listeners.add(listener); return () => { listeners.delete(listener); }; },
    load, loadLabs: () => labs(false), loadMoreLabs: () => labs(true), loadRoutingReferences,
    beginEdit(): boolean {
      if (!clean() || !state.loaded) return false; const ticket = epoch;
      const draft = freeze({ ...state.selection, expectedRevision: state.snapshot?.revision ?? 0, data: rawDraft(state.snapshot?.data ?? null) });
      if (!active(ticket)) return false; publish({ ...state, draft, error: '', notice: '' }); return active(ticket) && state.draft === draft;
    },
    updateDraft(value: unknown, expected = state.draft): boolean {
      if (!available() || command || !expected || state.draft !== expected) return false; const ticket = epoch; let data: CloudIntentJson;
      try { data = capture(() => rawDraft(value)); } catch { if (active(ticket)) publish({ ...state, error: 'المسودة غير صالحة أو تتجاوز حدود الحجم.' }); return false; }
      if (!active(ticket) || state.draft !== expected || command) return false;
      const draft = freeze({ ...expected, data }); publish({ ...state, draft, error: '', notice: '' }); return active(ticket) && state.draft === draft;
    },
    cancelDraft(expected = state.draft): boolean {
      if (!available() || command || !expected || state.draft !== expected) return false; const ticket = epoch;
      publish({ ...state, draft: null, error: '', notice: 'أُلغيت المسودة فقط؛ لم تتغير النسخة المحفوظة.' }); return active(ticket) && !state.draft;
    },
    canClose: () => clean(), save, retry, cancelPending, resume,
    loadHistory: () => history(false), loadMoreHistory: () => history(true), dispose,
  };
}
export type CloudClinicSettingsWorkspaceController = ReturnType<typeof createCloudClinicSettingsWorkspaceController>;
