import type { ClinicContact } from '../types';
import { clinicContactValidationError } from './clinicContacts';
import { CloudContactError, parseCloudContactRecord, type CloudContactCommand,
  type CloudContactRecord, type CloudContactRepository } from './cloudContactRepository';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PAGE_SIZE = 25;
const MAX_LOADED = 500;

export type CloudContactWorkspaceDraft = Readonly<{
  action: CloudContactCommand['action'];
  recordId: string;
  expectedRevision: number;
  contact: Readonly<ClinicContact> | null;
}>;

export type CloudContactWorkspaceState = Readonly<{
  records: readonly CloudContactRecord[];
  nextAfterId: string | null;
  loaded: boolean;
  loading: boolean;
  saveStatus: 'idle' | 'saving' | 'retry-required' | 'refresh-required';
  draft: CloudContactWorkspaceDraft | null;
  error: string;
  notice: string;
  closed: boolean;
}>;

function frozenRecord(value: CloudContactRecord): CloudContactRecord {
  const checked = parseCloudContactRecord(value);
  if (checked.data) Object.freeze(checked.data);
  return Object.freeze(checked);
}

function safeCode(error: unknown): CloudContactError['code'] {
  try {
    if (error instanceof CloudContactError && ['invalid', 'conflict', 'duplicate', 'unavailable'].includes(error.code)) return error.code;
  } catch { /* Untrusted error. */ }
  return 'unavailable';
}

/**
 * Prepared, NOT mounted or activated. One owner-view lifetime, no storage/SDK
 * work on construction. The parent must dispose synchronously on Auth loss.
 * An uncertain command stays immutable in memory for exact same-ID retries;
 * reload/logout loses this draft and never claims to undo a server commit.
 */
export function createCloudContactWorkspaceController(options: {
  getRepository: () => Promise<CloudContactRepository>;
  /** Identity/view lifetime, not the temporary owner-checking UI phase. */
  isActive: () => boolean;
  newId?: () => string;
  now?: () => string;
}) {
  let state: CloudContactWorkspaceState = Object.freeze({ records: Object.freeze([]),
    nextAfterId: null, loaded: false, loading: false, saveStatus: 'idle', draft: null,
    error: '', notice: '', closed: false });
  let epoch = 0;
  let closed = false;
  let repository: CloudContactRepository | null = null;
  let command: Readonly<CloudContactCommand> | null = null;
  let acknowledged = false;
  const listeners = new Set<(value: CloudContactWorkspaceState) => void>();

  function publish(next: CloudContactWorkspaceState) {
    state = Object.freeze(next);
    for (const listener of [...listeners]) {
      try { listener(state); } catch { /* A view cannot retain authority. */ }
    }
  }

  function dispose() {
    if (closed) return;
    closed = true;
    ++epoch;
    repository = null;
    command = null;
    acknowledged = false;
    publish({ records: Object.freeze([]), nextAfterId: null, loaded: false,
      loading: false, saveStatus: 'idle', draft: null, error: '', notice: '', closed: true });
    listeners.clear();
  }

  function active(ticket = epoch) {
    if (closed || ticket !== epoch) return false;
    let valid = false;
    try { valid = options.isActive() === true; } catch { /* Fail closed. */ }
    if (closed || ticket !== epoch) return false;
    if (valid) return true;
    dispose();
    return false;
  }

  const busy = () => state.loading || state.saveStatus === 'saving';

  async function getRepository(ticket: number) {
    if (!active(ticket)) return null;
    if (repository) return repository;
    const candidate = await options.getRepository();
    if (!active(ticket)) return null;
    repository = candidate;
    return candidate;
  }

  async function load(more: boolean): Promise<void> {
    if (!active() || busy() || command) return;
    if (more && (!state.loaded || !state.nextAfterId)) return;
    const ticket = ++epoch;
    const afterId = more ? state.nextAfterId : null;
    publish({ ...state, loading: true, error: '', notice: '' });
    try {
      const repo = await getRepository(ticket);
      if (!repo || !active(ticket)) return;
      const page = await repo.listPage({ afterId, limit: PAGE_SIZE });
      if (!active(ticket)) return;
      const records = page.records.map(frozenRecord);
      const combined = more ? [...state.records, ...records] : records;
      publish({ ...state, records: Object.freeze(combined.slice(-MAX_LOADED)),
        nextAfterId: page.nextAfterId, loaded: true, loading: false,
        notice: combined.length > MAX_LOADED
          ? 'نعرض آخر ٥٠٠ سجل تم تحميلها للحفاظ على السرعة. يمكنك مواصلة الصفحات أو الرجوع للبداية؛ لم تُحذف سجلات من الخادم.' : '' });
    } catch {
      if (active(ticket)) publish({ ...state, loading: false,
        error: 'تعذر تحديث جهات الاتصال من الخادم. أعد المحاولة؛ لا نستخدم نسخة محلية بديلة.' });
    }
  }

  function begin(action: CloudContactCommand['action'], value?: CloudContactRecord): boolean {
    if (!active() || busy() || command || state.draft) return false;
    try {
      let draft: CloudContactWorkspaceDraft;
      if (action === 'create') {
        const id = (options.newId ?? (() => crypto.randomUUID()))();
        const createdAt = (options.now ?? (() => new Date().toISOString()))();
        if (!UUID.test(id)) throw new CloudContactError('invalid');
        draft = { action, recordId: id, expectedRevision: 0,
          contact: Object.freeze({ id, name: '', mobile: '', createdAt }) };
      } else {
        const current = frozenRecord(value!);
        if (current.deleted || !current.data) throw new CloudContactError('invalid');
        draft = { action, recordId: current.recordId, expectedRevision: current.revision,
          contact: action === 'delete' ? null : Object.freeze({ ...current.data }) };
      }
      if (!active()) return false;
      publish({ ...state, draft: Object.freeze(draft), error: '', notice: '' });
      return true;
    } catch {
      if (active()) publish({ ...state, error: 'تعذر فتح مسودة صالحة. حدّث جهة الاتصال ثم حاول من جديد.' });
      return false;
    }
  }

  async function save(): Promise<void> {
    if (!active() || busy() || !state.draft) return;
    if (!command) {
      const draft = state.draft;
      try {
        if (draft.contact && clinicContactValidationError(draft.contact)) throw new CloudContactError('invalid');
        const operationId = (options.newId ?? (() => crypto.randomUUID()))();
        if (!UUID.test(operationId)) throw new CloudContactError('invalid');
        if (!active()) return;
        command = Object.freeze({ ...draft, operationId,
          contact: draft.contact ? Object.freeze({ ...draft.contact }) : null });
        acknowledged = false;
      } catch {
        if (active()) publish({ ...state, error: 'راجع اسم جهة الاتصال ورقم الموبايل قبل الحفظ.' });
        return;
      }
    }
    const submitted = command;
    const ticket = ++epoch;
    publish({ ...state, saveStatus: 'saving', error: '', notice: '' });
    try {
      const repo = await getRepository(ticket);
      if (!repo || !active(ticket)) return;
      if (!acknowledged) {
        const result = await repo.commit(submitted);
        if (!active(ticket)) return;
        if (!['committed', 'already-committed'].includes(result.status)
          || result.recordId !== submitted.recordId || result.revision !== submitted.expectedRevision + 1) {
          throw new CloudContactError('unavailable');
        }
        acknowledged = true;
      }
      // Receipt acknowledgement is historical. Never publish submitted data as
      // current: another owner device may already have edited/deleted the row.
      const current = await repo.get(submitted.recordId);
      if (!active(ticket)) return;
      if (!current || current.recordId !== submitted.recordId
        || current.revision < submitted.expectedRevision + 1) throw new CloudContactError('unavailable');
      frozenRecord(current);
      const firstPage = await repo.listPage({ afterId: null, limit: PAGE_SIZE });
      if (!active(ticket)) return;
      const records = firstPage.records.map(frozenRecord);
      command = null;
      acknowledged = false;
      publish({ ...state, records: Object.freeze(records), nextAfterId: firstPage.nextAfterId,
        loaded: true, loading: false, saveStatus: 'idle', draft: null, error: '',
        notice: 'تم تأكيد العملية وتحديث القائمة من الخادم. قد تتضمن القراءة تعديلات أحدث من جهاز آخر.' });
    } catch (error) {
      if (!active(ticket)) return;
      const code = safeCode(error);
      if (!acknowledged && code !== 'unavailable') {
        command = null;
        publish({ ...state, saveStatus: 'idle', error: new CloudContactError(code).message });
      } else {
        publish({ ...state, saveStatus: acknowledged ? 'refresh-required' : 'retry-required',
          error: acknowledged
            ? 'الحفظ مؤكد، لكن تعذر تحديث العرض. أعد التحقق دون تسجيل عملية جديدة.'
            : 'لم يصل تأكيد الحفظ؛ ربما وصلت العملية للخادم. أعد المحاولة بنفس المسودة دون تغييرها.' });
      }
    }
  }

  return {
    getState: () => { active(); return state; },
    subscribe: (listener: (value: CloudContactWorkspaceState) => void) => {
      if (closed) return () => undefined;
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    loadFirst: () => load(false),
    loadMore: () => load(true),
    beginCreate: () => begin('create'),
    beginEdit: (record: CloudContactRecord) => begin('update', record),
    beginDelete: (record: CloudContactRecord) => begin('delete', record),
    changeDraft: (fields: Pick<ClinicContact, 'name' | 'mobile'> & Pick<Partial<ClinicContact>, 'notes'>): boolean => {
      if (!active() || busy() || command || !state.draft?.contact) return false;
      const ticket = epoch, draft = state.draft;
      try {
        if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return false;
        const proto = Object.getPrototypeOf(fields);
        if (proto !== Object.prototype && proto !== null) return false;
        const keys = Reflect.ownKeys(fields);
        if (!keys.includes('name') || !keys.includes('mobile')
          || keys.some(key => !['name', 'mobile', 'notes'].includes(key as string))) return false;
        const values: Record<string, unknown> = {};
        for (const key of keys as string[]) {
          const descriptor = Object.getOwnPropertyDescriptor(fields, key);
          if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return false;
          values[key] = descriptor.value;
        }
        if (typeof values.name !== 'string' || typeof values.mobile !== 'string'
          || values.notes !== undefined && typeof values.notes !== 'string') return false;
        const contact = { ...draft.contact, name: values.name, mobile: values.mobile,
          ...(values.notes === undefined ? {} : { notes: values.notes as string }) };
        if (!active(ticket) || state.draft !== draft) return false;
        publish({ ...state, draft: Object.freeze({ ...draft, contact: Object.freeze(contact) }), error: '' });
        return true;
      } catch { return false; }
    },
    cancelDraft: (): boolean => {
      if (!active() || busy() || command) return false;
      publish({ ...state, draft: null, error: '', notice: '' });
      return true;
    },
    save,
    dispose,
  };
}
