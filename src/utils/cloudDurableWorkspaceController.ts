import { parseCloudOperationIntent, prepareCloudIntentCommand, type CloudOperationIntent,
  type CloudOperationIntentRepository, type CloudOperationKind } from './cloudOperationIntent';

export interface CloudDurableCommand { operationId: string; createdAt: string }
export interface CloudDurableCapability { journal: CloudOperationIntentRepository }
export interface CloudDurableWorkspaceState<S, D> {
  snapshot: S | null; loaded: boolean; loading: boolean; draft: D | null;
  saveStatus: 'idle' | 'preparing' | 'saving' | 'retry-required' | 'refresh-required';
  pendingOperationId: string | null; error: string; notice: string; closed: boolean;
  history: readonly CloudOperationIntent[]; historyLoaded: boolean; historyLoading: boolean; historyNextAfterId: string | null;
}
export interface CloudDurableWorkspaceOptions<C extends CloudDurableCommand, S, D, K extends CloudDurableCapability, A> {
  kind: CloudOperationKind; ownerUid: string; isActive(): boolean; getCapability(): Promise<K>;
  parseCommand(value: unknown): C; parseDraft(value: unknown): D;
  createCommand(snapshot: S, draft: D): C;
  draftFromCommand(command: C): D;
  readSnapshot(capability: K, assertActive: () => void, command?: C): Promise<S>;
  commit(capability: K, command: C): Promise<unknown>;
  parseAcknowledgement(value: unknown, command: C): A;
  reconcile(snapshot: S, command: C, acknowledgement: A): void;
}
const validId = (value: unknown): value is string => typeof value === 'string' && value.length === 36
  && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const fail = (): never => { throw new Error('تعذر تأكيد العملية من الخادم.'); };
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

/** Shared lifecycle, not a data store or permission grant. All amounts and
 * domain acknowledgements are checked by injected strict domain contracts.
 * No SDK, reads, IDs, clocks, local queue or defaults on construction. */
export function createCloudDurableWorkspaceController<C extends CloudDurableCommand, S, D,
  K extends CloudDurableCapability, A>(options: CloudDurableWorkspaceOptions<C, S, D, K, A>) {
  const empty = (closed = false): CloudDurableWorkspaceState<S, D> => ({ snapshot: null, loaded: false, loading: false,
    draft: null, saveStatus: 'idle', pendingOperationId: null, error: '', notice: '', closed,
    history: [], historyLoaded: false, historyLoading: false, historyNextAfterId: null });
  let state = freeze(empty()), epoch = 0, closed = false, checking = false, capturing = false;
  let capability: K | null = null, command: C | null = null, acknowledgement: A | null = null;
  const listeners = new Set<(state: CloudDurableWorkspaceState<S, D>) => void>();
  function publish(value: CloudDurableWorkspaceState<S, D>) {
    const next = freeze(value); state = next;
    for (const listener of [...listeners]) { try { listener(next); } catch { /* A view cannot grant authority. */ } }
  }
  function dispose() {
    if (closed) return;
    closed = true; ++epoch; capability = null; command = null; acknowledgement = null;
    publish(empty(true)); listeners.clear();
  }
  function active(ticket = epoch): boolean {
    if (closed || ticket !== epoch || checking) return false;
    checking = true; let allowed = false;
    try { allowed = options.isActive() === true; } catch { /* Fixed safe state only. */ }
    finally { checking = false; }
    if (closed || ticket !== epoch) return false;
    if (!allowed) { dispose(); return false; }
    return true;
  }
  const assertActive = (ticket: number) => { if (!active(ticket)) fail(); };
  const busy = () => state.loading || state.historyLoading || state.saveStatus === 'preparing' || state.saveStatus === 'saving';
  const available = () => !capturing && active() && !busy();
  function capture<T>(work: () => T): T {
    if (capturing) fail(); capturing = true;
    try { return work(); } finally { capturing = false; }
  }
  async function call<T>(ticket: number, work: () => T | Promise<T>): Promise<T> {
    assertActive(ticket);
    const result = await Promise.resolve().then(() => { assertActive(ticket); return work(); });
    assertActive(ticket); return result;
  }
  async function getCapability(ticket: number): Promise<K> {
    assertActive(ticket);
    if (capability) return capability;
    const result = await call(ticket, () => options.getCapability());
    capability = result; return result;
  }
  function checkedIntent(value: unknown, id?: string, expected?: C) {
    const intent = parseCloudOperationIntent(value), recovered = options.parseCommand(intent.command);
    if (intent.kind !== options.kind || intent.actorUid !== options.ownerUid || intent.operationId !== recovered.operationId
      || intent.createdAt !== recovered.createdAt || id !== undefined && intent.operationId !== id
      || JSON.stringify(intent.command) !== JSON.stringify(prepareCloudIntentCommand(recovered))
      || expected !== undefined && JSON.stringify(intent.command) !== JSON.stringify(prepareCloudIntentCommand(expected))) fail();
    return { intent, recovered };
  }
  async function read(ticket: number, cap: K, submitted?: C): Promise<S> {
    return call(ticket, () => options.readSnapshot(cap, () => assertActive(ticket), submitted));
  }
  async function refresh(): Promise<boolean> {
    if (!available() || command || state.draft) return false;
    const ticket = ++epoch;
    publish({ ...state, snapshot: null, loaded: false, loading: true, error: '', notice: '' });
    try {
      const cap = await getCapability(ticket), snapshot = await read(ticket, cap); assertActive(ticket);
      publish({ ...state, snapshot, loaded: true, loading: false, notice: 'تمت قراءة السجل المؤكد من الخادم.' });
      return active(ticket);
    } catch {
      if (active(ticket)) publish({ ...state, loading: false, error: 'تعذر قراءة السجل المؤكد؛ لم نستخدم بيانات محلية بديلة.' });
      return false;
    }
  }
  async function execute(ticket: number): Promise<boolean> {
    const submitted = command;
    if (!submitted || !active(ticket)) return false;
    try {
      const cap = await getCapability(ticket); assertActive(ticket);
      if (acknowledgement === null) {
        publish({ ...state, saveStatus: 'preparing', error: '', notice: '' }); assertActive(ticket);
        const prepared = checkedIntent(await call(ticket, () => cap.journal.prepare(options.kind,
          prepareCloudIntentCommand(submitted), submitted.createdAt)), submitted.operationId, submitted);
        if (prepared.intent.status === 'cancelled') fail();
        publish({ ...state, saveStatus: 'saving' }); assertActive(ticket);
        const raw = await call(ticket, () => options.commit(cap, submitted));
        const ack = capture(() => options.parseAcknowledgement(raw, submitted)); assertActive(ticket);
        if (ack === null || ack === undefined) fail(); acknowledgement = ack;
      }
      // Claim read ownership BEFORE notifying, so subscribers cannot start a
      // competing read/save between acknowledgement and refresh.
      publish({ ...state, loading: true, saveStatus: 'refresh-required', error: '' }); assertActive(ticket);
      const snapshot = await read(ticket, cap, submitted);
      capture(() => options.reconcile(snapshot, submitted, acknowledgement!)); assertActive(ticket);
      command = null; acknowledgement = null;
      publish({ ...state, snapshot, loaded: true, loading: false, draft: null, saveStatus: 'idle', pendingOperationId: null,
        history: [], historyLoaded: false, historyNextAfterId: null, error: '', notice: 'تم تأكيد الحفظ وقراءة السجل الحالي.' });
      return active(ticket);
    } catch {
      if (active(ticket)) publish({ ...state, loading: false, saveStatus: acknowledgement === null ? 'retry-required' : 'refresh-required',
        error: acknowledgement === null ? 'لم يصل تأكيد العملية. أعد نفس المحاولة أو تحقّق من إلغائها؛ لا تسجّل بديلًا.'
          : 'الحفظ مؤكد، لكن تحديث السجل لم يكتمل. إعادة المحاولة التالية قراءة فقط.' });
      return false;
    }
  }
  async function save(expectedDraft: D): Promise<boolean> {
    if (!available() || command || !state.loaded || state.snapshot === null || !state.draft || expectedDraft !== state.draft) return false;
    const before = epoch, source = state.draft, snapshot = state.snapshot;
    let prepared: C;
    try { prepared = capture(() => freeze(options.parseCommand(options.createCommand(snapshot, source)))); }
    catch { if (active(before)) publish({ ...state, error: 'راجع الحقول المطلوبة قبل حفظ العملية.' }); return false; }
    if (!active(before) || busy() || command || state.draft !== source || state.snapshot !== snapshot) return false;
    command = prepared; acknowledgement = null; const ticket = ++epoch;
    publish({ ...state, pendingOperationId: prepared.operationId, saveStatus: 'preparing', error: '', notice: '' });
    return execute(ticket);
  }
  async function retry(): Promise<boolean> {
    if (!available() || !command || !['retry-required', 'refresh-required'].includes(state.saveStatus)) return false;
    const ticket = ++epoch; publish({ ...state, loading: true, error: '' }); return execute(ticket);
  }
  async function cancelPending(): Promise<boolean> {
    if (!available() || !command || acknowledgement !== null) return false;
    const submitted = command, ticket = ++epoch;
    publish({ ...state, loading: true, error: '', notice: '' });
    try {
      const cap = await getCapability(ticket);
      const current = checkedIntent(await call(ticket, () => cap.journal.get(submitted.operationId)), submitted.operationId, submitted);
      if (current.intent.status === 'committed') fail();
      const result = checkedIntent(await call(ticket, () => cap.journal.cancel(submitted.operationId)), submitted.operationId, submitted);
      if (result.intent.status !== 'cancelled') fail(); assertActive(ticket);
      command = null; acknowledgement = null;
      publish({ ...empty(), notice: 'تم تأكيد الإلغاء قبل التنفيذ. حدّث السجل قبل إنشاء عملية أخرى.' }); return active(ticket);
    } catch {
      if (active(ticket)) publish({ ...state, loading: false, saveStatus: 'retry-required', error: 'تعذر تأكيد الإلغاء؛ تحقّق من العملية الأصلية أولًا.' });
      return false;
    }
  }
  async function resume(operationId: string): Promise<boolean> {
    if (!available() || command || state.draft || !validId(operationId)) return false;
    const ticket = ++epoch;
    publish({ ...state, loading: true, snapshot: null, loaded: false, error: '', notice: '' });
    try {
      const cap = await getCapability(ticket), result = checkedIntent(await call(ticket, () => cap.journal.get(operationId)), operationId);
      if (result.intent.status === 'cancelled') fail();
      const recovered = capture(() => freeze(options.parseCommand(result.recovered)));
      const draft = capture(() => freeze(options.parseDraft(options.draftFromCommand(recovered)))); assertActive(ticket);
      command = recovered; acknowledgement = null;
      publish({ ...state, loading: false, draft, pendingOperationId: command.operationId, saveStatus: 'preparing' });
      return execute(ticket);
    } catch {
      if (active(ticket)) publish({ ...state, loading: false, error: 'تعذر استرجاع العملية الأصلية؛ لم ننشئ عملية بديلة.' });
      return false;
    }
  }
  async function history(more: boolean): Promise<boolean> {
    if (!available() || command || state.draft || more && (!state.historyLoaded || state.historyNextAfterId === null)) return false;
    const afterId = more ? state.historyNextAfterId : null, ticket = ++epoch;
    publish({ ...state, historyLoading: true, error: '', notice: '', ...(more ? {} : { history: [], historyLoaded: false, historyNextAfterId: null }) });
    try {
      const cap = await getCapability(ticket);
      if (typeof cap.journal.listHistoryPage !== 'function') fail();
      const page = await call(ticket, () => cap.journal.listHistoryPage!(options.kind, { afterId, limit: 25 }));
      if (!page || typeof page !== 'object' || Array.isArray(page) || Reflect.ownKeys(page).length !== 2) fail();
      const rows = Object.getOwnPropertyDescriptor(page, 'records'), next = Object.getOwnPropertyDescriptor(page, 'nextAfterId');
      if (!rows || !next || !('value' in rows) || !('value' in next) || !rows.enumerable || !next.enumerable
        || !Array.isArray(rows.value) || rows.value.length > 25 || Reflect.ownKeys(rows.value).length !== rows.value.length + 1) fail();
      let previous = afterId;
      const records: CloudOperationIntent[] = [];
      for (let index = 0; index < rows.value.length; index++) {
        const property = Object.getOwnPropertyDescriptor(rows.value, String(index));
        if (!property || !('value' in property) || !property.enumerable) fail();
        const { intent } = checkedIntent(property.value);
        if (previous !== null && intent.operationId <= previous) fail();
        previous = intent.operationId; records.push(intent);
      }
      if (next.value !== (records.length === 25 ? previous : null)) fail();
      const combined = more ? [...state.history, ...records] : records;
      if (combined.length > 2000) fail(); assertActive(ticket);
      publish({ ...state, history: combined, historyLoaded: true, historyLoading: false, historyNextAfterId: next.value as string | null,
        notice: next.value === null ? 'نهاية الصفحات المقروءة بترتيب المعرف، وليس ترتيب الأحدث.' : 'القائمة جزئية؛ حمّل المزيد.' });
      return active(ticket);
    } catch {
      if (active(ticket)) publish({ ...state, historyLoading: false, historyLoaded: false,
        error: 'تعذر تأكيد سجل الاسترجاع كاملًا؛ لم تُنفذ أو تُلغَ أي عملية.' }); return false;
    }
  }
  return {
    getState: () => { active(); return state; },
    subscribe: (listener: (value: CloudDurableWorkspaceState<S, D>) => void) => {
      if (!active()) return () => undefined;
      listeners.add(listener); return () => { listeners.delete(listener); };
    },
    refresh,
    beginDraft(input: unknown): boolean {
      if (!available() || command || state.draft || !state.loaded || state.snapshot === null) return false;
      const ticket = epoch; let draft: D;
      try { draft = capture(() => freeze(options.parseDraft(input))); } catch { return false; }
      if (!active(ticket) || busy() || command || state.draft) return false;
      publish({ ...state, draft, error: '', notice: '' }); return active(ticket) && state.draft === draft;
    },
    updateDraft(input: unknown, expectedDraft: D): boolean {
      if (!available() || command || !state.draft || expectedDraft !== state.draft) return false;
      const ticket = epoch, source = state.draft; let draft: D;
      try { draft = capture(() => freeze(options.parseDraft(input))); } catch { return false; }
      if (!active(ticket) || state.draft !== source || command) return false;
      publish({ ...state, draft, error: '', notice: '' }); return active(ticket) && state.draft === draft;
    },
    cancelDraft(expectedDraft: D): boolean {
      if (!available() || command || state.draft !== expectedDraft || !state.draft) return false;
      const ticket = epoch; publish({ ...state, draft: null, error: '', notice: 'أُلغيت المسودة فقط دون تغيير السجل.' });
      return active(ticket) && state.draft === null;
    },
    save, retry, cancelPending, resume,
    loadHistory: () => history(false), loadMoreHistory: () => history(true),
    canClose: () => active() && !busy() && !command && !state.draft && state.saveStatus === 'idle', dispose,
  };
}
