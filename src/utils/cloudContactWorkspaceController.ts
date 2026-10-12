import type { ClinicContact } from '../types';
import { CloudContactError, parseCloudContactRecord, prepareCloudContactCommand, type CloudContactCommand,
  type CloudContactRecord, type CloudContactRepository } from './cloudContactRepository';
import { parseCloudOperationIntent, prepareCloudIntentCommand, type CloudOperationIntentRepository } from './cloudOperationIntent';
import { createCloudProfileContactRecoveryController } from './cloudProfileContactRecoveryController';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const validId = (value: unknown): value is string => typeof value === 'string' && value.length === 36 && UUID.test(value);
const PAGE_SIZE = 25;
const MAX_LOADED = 500;
export type CloudContactWorkspaceCapability = CloudContactRepository & { readonly journal?: CloudOperationIntentRepository };
export type CloudContactWorkspaceDraft = Readonly<{
  action: CloudContactCommand['action']; recordId: string; expectedRevision: number; contact: Readonly<ClinicContact> | null;
}>;
export type CloudContactWorkspaceState = Readonly<{
  records: readonly CloudContactRecord[]; nextAfterId: string | null; loaded: boolean; loading: boolean; recoveryLoading: boolean;
  saveStatus: 'idle' | 'preparing' | 'saving' | 'retry-required' | 'refresh-required';
  pendingOperationId: string | null; draft: CloudContactWorkspaceDraft | null;
  error: string; notice: string; closed: boolean;
}>;
function frozenRecord(value: CloudContactRecord): CloudContactRecord {
  const checked = parseCloudContactRecord(value);
  if (checked.data) Object.freeze(checked.data);
  return Object.freeze(checked);
}
function fail(): never { throw new CloudContactError('unavailable'); }
function timestamp(value: unknown): string {
  if (typeof value !== 'string' || value.length !== 24 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    || value < '1900-01-01T00:00:00.000Z' || value > '9999-12-31T23:59:59.999Z') fail();
  const date = new Date(value); if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) fail();
  return value;
}
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail();
  const found = Reflect.ownKeys(value), result: Record<string, unknown> = {};
  if (found.length !== keys.length || found.some(key => typeof key !== 'string' || !keys.includes(key))) fail();
  for (const key of keys) {
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (!property || !('value' in property) || !property.enumerable) fail(); result[key] = property.value;
  }
  return result;
}
function empty(closed = false): CloudContactWorkspaceState {
  return { records: Object.freeze([]), nextAfterId: null, loaded: false, loading: false, recoveryLoading: false, saveStatus: 'idle',
    pendingOperationId: null, draft: null, error: '', notice: '', closed };
}

/** Inert owner-view controller. Durable preparation, exact retry/cancellation
 * and historical recovery require a journal; no memory-only save fallback. */
export function createCloudContactWorkspaceController(options: {
  getRepository: () => Promise<CloudContactWorkspaceCapability>;
  isActive: () => boolean; newId?: () => string; now?: () => string;
}) {
  let state = Object.freeze(empty()), epoch = 0, closed = false, checkingActive = false, capturing = false;
  let ownLoading = false, historyLoading = false;
  let repository: CloudContactWorkspaceCapability | null = null;
  let command: Readonly<CloudContactCommand> | null = null, commandTime: string | null = null;
  let acknowledged = false, actorUid: string | null = null, intentHash: string | null = null;
  const listeners = new Set<(value: CloudContactWorkspaceState) => void>();
  function publish(next: CloudContactWorkspaceState) {
    const published = Object.freeze({ ...next, loading: closed ? false : ownLoading, recoveryLoading: closed ? false : historyLoading });
    state = published;
    for (const listener of [...listeners]) { try { listener(published); } catch { /* Views grant no authority. */ } }
  }
  function dispose() {
    if (closed) return;
    closed = true; ++epoch; repository = null; command = null; commandTime = null;
    acknowledged = false; actorUid = null; intentHash = null; ownLoading = false; historyLoading = false;
    recovery.dispose(); publish(empty(true)); listeners.clear();
  }
  function active(ticket = epoch) {
    if (closed || ticket !== epoch || checkingActive) return false;
    let allowed = false; checkingActive = true;
    try { allowed = options.isActive() === true; } catch { /* Fail closed. */ }
    finally { checkingActive = false; }
    if (closed || ticket !== epoch) return false;
    if (!allowed) { dispose(); return false; } return true;
  }
  const busy = () => state.loading || state.recoveryLoading || state.saveStatus === 'preparing' || state.saveStatus === 'saving';
  const available = () => !capturing && active() && !busy();
  const assertActive = (ticket: number) => { if (!active(ticket)) fail(); };
  function capture<T>(work: () => T): T {
    if (capturing) fail(); capturing = true;
    try { return work(); } finally { capturing = false; }
  }
  async function getRepository(ticket: number) {
    assertActive(ticket); if (repository) return repository;
    const candidate = await options.getRepository(); assertActive(ticket);
    repository = candidate; return candidate;
  }
  async function call<T>(ticket: number, owner: object, key: string, args: unknown[] = []): Promise<T> {
    assertActive(ticket); const method = Reflect.get(owner, key); assertActive(ticket);
    if (typeof method !== 'function') fail();
    const result = await Promise.resolve().then(() => { assertActive(ticket); return method.apply(owner, args) as Promise<T>; });
    assertActive(ticket); return result;
  }
  function journal(capability: CloudContactWorkspaceCapability, ticket: number) {
    assertActive(ticket); const value = capability.journal; assertActive(ticket);
    if (!value || typeof value !== 'object') fail(); return value;
  }
  const recovery = createCloudProfileContactRecoveryController({ kind: 'contact',
    isActive: () => !closed && options.isActive() === true,
    getJournal: async () => {
      const ticket = epoch;
      if (ownLoading || command || state.draft || state.saveStatus !== 'idle') fail();
      const cap = await getRepository(ticket); assertActive(ticket); return journal(cap, ticket);
    },
  });
  recovery.subscribe(value => {
    if (closed) return;
    if (value.closed) { dispose(); return; }
    const observedActor = value.records[0]?.actorUid;
    if (observedActor) {
      if (actorUid !== null && observedActor !== actorUid) { dispose(); return; }
      actorUid = observedActor;
    }
    if (historyLoading !== value.loading) { historyLoading = value.loading; publish(state); }
  });
  function checkedIntent(value: unknown, id: string, expected?: CloudContactCommand, time?: string) {
    const intent = parseCloudOperationIntent(value), recovered = prepareCloudContactCommand(intent.command);
    if (intent.kind !== 'contact' || intent.operationId !== id || recovered.operationId !== id
      || actorUid !== null && intent.actorUid !== actorUid || intentHash !== null && intent.requestHash !== intentHash
      || time !== undefined && intent.createdAt !== time
      || JSON.stringify(intent.command) !== JSON.stringify(prepareCloudIntentCommand(recovered))
      || expected && JSON.stringify(intent.command) !== JSON.stringify(prepareCloudIntentCommand(expected))) fail();
    return { intent, recovered };
  }
  function checkedPage(raw: unknown, afterId: string | null) {
    const value = exact(raw, ['records', 'nextAfterId']);
    if (!Array.isArray(value.records) || value.records.length > PAGE_SIZE
      || Reflect.ownKeys(value.records).length !== value.records.length + 1
      || value.nextAfterId !== null && !validId(value.nextAfterId)) fail();
    const records: CloudContactRecord[] = []; let previous = afterId;
    for (let index = 0; index < value.records.length; index++) {
      const property = Object.getOwnPropertyDescriptor(value.records, String(index));
      if (!property || !('value' in property) || !property.enumerable) fail();
      const record = frozenRecord(property.value);
      if (previous !== null && record.recordId <= previous) fail(); records.push(record); previous = record.recordId;
    }
    if (value.nextAfterId !== null && value.nextAfterId !== previous) fail();
    return { records, nextAfterId: value.nextAfterId as string | null };
  }
  async function load(more: boolean): Promise<void> {
    if (!available() || command || state.draft || more && (!state.loaded || !state.nextAfterId)) return;
    const ticket = ++epoch, afterId = more ? state.nextAfterId : null;
    ownLoading = true; publish({ ...state, error: '', notice: '' });
    try {
      assertActive(ticket); const repo = await getRepository(ticket);
      const page = checkedPage(await call(ticket, repo, 'listPage', [{ afterId, limit: PAGE_SIZE }]), afterId); assertActive(ticket);
      const combined = more ? [...state.records, ...page.records] : page.records;
      ownLoading = false; publish({ ...state, records: Object.freeze(combined.slice(-MAX_LOADED)), nextAfterId: page.nextAfterId, loaded: true,
        notice: combined.length > MAX_LOADED ? 'نعرض آخر ٥٠٠ سجل تم تحميلها للحفاظ على السرعة. يمكنك مواصلة الصفحات أو الرجوع للبداية؛ لم تُحذف سجلات من الخادم.' : '' });
    } catch { if (active(ticket)) { ownLoading = false; publish({ ...state,
      error: 'تعذر تحديث جهات الاتصال من الخادم. أعد المحاولة؛ لا نستخدم نسخة محلية بديلة.' }); } }
  }
  function begin(action: CloudContactCommand['action'], value?: CloudContactRecord): boolean {
    if (!available() || command || state.draft) return false;
    const ticket = epoch;
    try {
      const draft = capture((): CloudContactWorkspaceDraft => {
        if (action === 'create') {
          const id = (options.newId ?? (() => crypto.randomUUID()))();
          const createdAt = timestamp((options.now ?? (() => new Date().toISOString()))());
          if (!validId(id)) fail(); return Object.freeze({ action, recordId: id, expectedRevision: 0,
            contact: Object.freeze({ id, name: '', mobile: '', createdAt }) });
        }
        const current = frozenRecord(value!); if (current.deleted || !current.data) fail();
        return Object.freeze({ action, recordId: current.recordId, expectedRevision: current.revision,
          contact: action === 'delete' ? null : Object.freeze({ ...current.data }) });
      });
      if (!active(ticket) || busy() || command || state.draft) return false;
      publish({ ...state, draft, error: '', notice: '' }); return active(ticket) && state.draft === draft;
    } catch { if (active(ticket)) publish({ ...state, error: 'تعذر فتح مسودة صالحة. حدّث جهة الاتصال ثم حاول من جديد.' }); return false; }
  }
  async function execute(ticket: number): Promise<boolean> {
    const submitted = command, submittedTime = commandTime; if (!submitted || !submittedTime || !active(ticket)) return false;
    try {
      const repo = await getRepository(ticket); assertActive(ticket);
      if (!acknowledged) {
        publish({ ...state, saveStatus: 'preparing', error: '', notice: '' }); assertActive(ticket);
        const source = journal(repo, ticket);
        const prepared = checkedIntent(await call(ticket, source, 'prepare', ['contact', submitted, submittedTime]), submitted.operationId, submitted, submittedTime);
        assertActive(ticket); if (prepared.intent.status === 'cancelled') fail();
        actorUid = prepared.intent.actorUid; intentHash = prepared.intent.requestHash;
        publish({ ...state, saveStatus: 'saving' }); assertActive(ticket);
        const result = exact(await call(ticket, repo, 'commit', [submitted]), ['status', 'recordId', 'revision']); assertActive(ticket);
        if (!['committed', 'already-committed'].includes(result.status as string)
          || result.recordId !== submitted.recordId || result.revision !== submitted.expectedRevision + 1) fail();
        acknowledged = true;
      }
      // Own the read/loading ticket BEFORE notifying subscribers. A reentrant
      // save during post-ACK refresh must not steal the only refresh attempt.
      ownLoading = true; publish({ ...state, saveStatus: 'refresh-required', error: '' }); assertActive(ticket);
      const current = frozenRecord(await call(ticket, repo, 'get', [submitted.recordId])); assertActive(ticket);
      if (current.recordId !== submitted.recordId || current.revision < submitted.expectedRevision + 1
        || current.revision === submitted.expectedRevision + 1 && (current.lastOperationId !== submitted.operationId
          || current.deleted !== (submitted.action === 'delete') || JSON.stringify(current.data) !== JSON.stringify(submitted.contact))) fail();
      const first = checkedPage(await call(ticket, repo, 'listPage', [{ afterId: null, limit: PAGE_SIZE }]), null); assertActive(ticket);
      const records = first.records.map(record => {
        if (record.recordId !== current.recordId) return record;
        if (record.revision === current.revision && JSON.stringify(record) !== JSON.stringify(current)) fail();
        return record.revision < current.revision ? current : record;
      });
      command = null; commandTime = null; intentHash = null; acknowledged = false; ownLoading = false;
      publish({ ...state, records: Object.freeze(records), nextAfterId: first.nextAfterId, loaded: true,
        saveStatus: 'idle', pendingOperationId: null, draft: null, error: '',
        notice: 'تم تأكيد العملية وتحديث القائمة من الخادم. قد تتضمن القراءة تعديلات أحدث من جهاز آخر.' });
      return active(ticket);
    } catch {
      if (active(ticket)) { ownLoading = false; publish({ ...state, saveStatus: acknowledged ? 'refresh-required' : 'retry-required',
        error: acknowledged ? 'الحفظ مؤكد، لكن تعذر تحديث العرض. أعد التحقق دون تسجيل عملية جديدة.'
          : 'لم يصل تأكيد الحفظ أو تغير السجل. العملية الأصلية ثابتة؛ أعد التحقق أو أكد إلغاءها قبل أي تعديل جديد.' }); }
      return false;
    }
  }
  async function save(): Promise<void> {
    if (!available() || !state.draft) return;
    if (!command) {
      const ticket = epoch, source = state.draft;
      try {
        const prepared = capture(() => {
          const operationId = (options.newId ?? (() => crypto.randomUUID()))();
          const time = timestamp((options.now ?? (() => new Date().toISOString()))());
          const captured = prepareCloudContactCommand({ ...source, operationId });
          if (captured.contact) Object.freeze(captured.contact);
          return { captured: Object.freeze(captured), time };
        });
        if (!active(ticket) || busy() || command || state.draft !== source) return;
        command = prepared.captured; commandTime = prepared.time; intentHash = null; acknowledged = false;
      } catch { if (active(ticket)) publish({ ...state, error: 'راجع اسم جهة الاتصال ورقم الموبايل ووقت العملية قبل الحفظ.' }); return; }
    }
    const ticket = ++epoch;
    if (acknowledged) ownLoading = true;
    publish({ ...state, saveStatus: acknowledged ? 'refresh-required' : 'preparing', pendingOperationId: command.operationId, error: '', notice: '' });
    await execute(ticket);
  }
  async function cancelPending(): Promise<boolean> {
    if (!available() || !command || !commandTime || acknowledged) return false;
    const submitted = command, time = commandTime, ticket = ++epoch;
    ownLoading = true; publish({ ...state, error: '', notice: '' });
    try {
      const repo = await getRepository(ticket), source = journal(repo, ticket);
      const current = checkedIntent(await call(ticket, source, 'get', [submitted.operationId]), submitted.operationId, submitted, time);
      assertActive(ticket); if (current.intent.status === 'committed') fail();
      actorUid = current.intent.actorUid; intentHash = current.intent.requestHash;
      const cancelled = checkedIntent(await call(ticket, source, 'cancel', [submitted.operationId]), submitted.operationId, submitted, time);
      assertActive(ticket); if (cancelled.intent.status !== 'cancelled') fail();
      command = null; commandTime = null; intentHash = null; acknowledged = false; ownLoading = false;
      publish({ ...empty(), notice: 'تم تأكيد إلغاء العملية قبل تنفيذها. اقرأ أحدث قائمة قبل إضافة أو تعديل جديد.' });
      return active(ticket);
    } catch { if (active(ticket)) { ownLoading = false; publish({ ...state, saveStatus: 'retry-required',
      error: 'تعذر تأكيد إلغاء العملية؛ قد تكون نُفذت. أعد التحقق من نفس العملية قبل إنشاء تعديل آخر.' }); } return false; }
  }
  async function resume(operationId: string): Promise<boolean> {
    if (!available() || command || state.draft || !validId(operationId)) return false;
    const ticket = ++epoch; ownLoading = true; publish({ ...state, error: '', notice: '' });
    try {
      const repo = await getRepository(ticket), source = journal(repo, ticket);
      const recovered = checkedIntent(await call(ticket, source, 'get', [operationId]), operationId); assertActive(ticket);
      if (recovered.intent.status === 'cancelled') fail();
      const prepared = recovered.recovered; if (prepared.contact) Object.freeze(prepared.contact);
      command = Object.freeze(prepared); commandTime = recovered.intent.createdAt; intentHash = recovered.intent.requestHash;
      acknowledged = false; actorUid = recovered.intent.actorUid;
      const { operationId: _operationId, ...draft } = command;
      ownLoading = false; publish({ ...state, draft: Object.freeze(draft), saveStatus: 'preparing', pendingOperationId: operationId });
      return execute(ticket);
    } catch { if (active(ticket)) { ownLoading = false; publish({ ...state, error: 'تعذر استرجاع عملية صالحة لهذا الحساب. لم تُنشأ عملية بديلة.' }); } return false; }
  }
  return {
    getState: () => { active(); return state; },
    subscribe: (listener: (value: CloudContactWorkspaceState) => void) => {
      if (closed) return () => undefined; listeners.add(listener); return () => { listeners.delete(listener); };
    },
    recovery: Object.freeze({ ...recovery,
      loadFirst: async () => { if (available() && !command && !state.draft) await recovery.loadFirst(); },
      loadMore: async () => { if (available() && !command && !state.draft) await recovery.loadMore(); },
    }), loadFirst: () => load(false), loadMore: () => load(true),
    beginCreate: () => begin('create'), beginEdit: (record: CloudContactRecord) => begin('update', record),
    beginDelete: (record: CloudContactRecord) => begin('delete', record),
    changeDraft: (fields: Pick<ClinicContact, 'name' | 'mobile'> & Pick<Partial<ClinicContact>, 'notes'>): boolean => {
      if (!available() || command || !state.draft?.contact) return false;
      const ticket = epoch, draft = state.draft;
      try {
        const contact = capture(() => {
          if (!fields || typeof fields !== 'object' || Array.isArray(fields)
            || ![Object.prototype, null].includes(Object.getPrototypeOf(fields))) fail();
          const keys = Reflect.ownKeys(fields), values: Record<string, unknown> = {};
          if (!keys.includes('name') || !keys.includes('mobile') || keys.some(key => !['name', 'mobile', 'notes'].includes(key as string))) fail();
          for (const key of keys as string[]) { const property = Object.getOwnPropertyDescriptor(fields, key);
            if (!property || !('value' in property) || !property.enumerable) fail(); values[key] = property.value; }
          if (typeof values.name !== 'string' || typeof values.mobile !== 'string' || values.notes !== undefined && typeof values.notes !== 'string') fail();
          return Object.freeze({ ...draft.contact!, name: values.name, mobile: values.mobile,
            ...(values.notes === undefined ? {} : { notes: values.notes as string }) });
        });
        if (!active(ticket) || busy() || command || state.draft !== draft) return false;
        publish({ ...state, draft: Object.freeze({ ...draft, contact }), error: '' }); return active(ticket);
      } catch { return false; }
    },
    cancelDraft: (): boolean => {
      if (!available() || command) return false; const ticket = epoch;
      publish({ ...state, draft: null, error: '', notice: '' }); return active(ticket) && state.draft === null;
    },
    save, cancelPending, resume, dispose,
  };
}
