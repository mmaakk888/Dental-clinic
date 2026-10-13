import { prepareCloudTransferRows, previewCloudTransfer, type CloudTransferKind, type CloudTransferPreview, type CloudTransferPreviewRow } from './cloudTransferProjection';
import { parseCloudOperationIntent, prepareCloudIntentCommand, type CloudOperationIntent, type CloudOperationIntentRepository } from './cloudOperationIntent';
import { prepareCloudPatientCommand, parseCloudPatientRecord, type CloudPatientWriteCommand, type CloudPatientRepository } from './cloudPatientRepository';
import { prepareCloudContactCommand, parseCloudContactRecord, type CloudContactCommand, type CloudContactRepository } from './cloudContactRepository';
import type { CloudClinicSnapshot } from './cloudClinicSnapshot';
import type { PatientImportRow } from './patientSpreadsheets';
import type { ContactImportInput } from './contactTransfer';

type Patients = CloudPatientRepository & { readonly journal?: CloudOperationIntentRepository };
type Contacts = CloudContactRepository & { readonly journal?: CloudOperationIntentRepository };
type Command = CloudPatientWriteCommand | CloudContactCommand;
export interface CloudTransferResult { rowNumber: number; kind: CloudTransferKind; operationId: string; status: 'committed' | 'cancelled'; fileNo: number | null }
export interface CloudTransferWorkspaceState {
  preview: CloudTransferPreview | null; loading: boolean; running: boolean;
  saveStatus: 'idle' | 'preparing' | 'saving' | 'retry-required' | 'refresh-required';
  pending: Readonly<{ kind: CloudTransferKind; rowNumber: number; operationId: string; fileNo: number | null }> | null;
  results: readonly CloudTransferResult[]; stopped: boolean; error: string; notice: string; closed: boolean;
}
const validId = (value: unknown): value is string => typeof value === 'string' && value.length === 36 && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
function fail(): never { throw new Error('تعذر تأكيد الاستيراد من الخادم.'); }
function freeze<T>(value: T): T { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function timestamp(value: unknown): string { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  || value < '1900-01-01' || !Number.isFinite(new Date(value).getTime()) || new Date(value).toISOString() !== value) fail(); return value; }
function exact(value: unknown, keys: readonly string[]): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail();
  const found = Reflect.ownKeys(value), output: Record<string, any> = {};
  if (found.length !== keys.length || found.some(key => typeof key !== 'string' || !keys.includes(key))) fail();
  for (const key of keys) { const d = Object.getOwnPropertyDescriptor(value, key); if (!d || !('value' in d) || !d.enumerable) fail(); output[key] = d.value; } return output;
}

/** Owner-only per-row import, NOT an atomic whole-file restore. No work occurs
 * on construction. Only one retained row may be uncertain; later rows never
 * start until its original journal/receipt is confirmed or cancelled. */
export function createCloudTransferWorkspaceController(options: {
  ownerUid: string; isActive(): boolean;
  getPatients(): Promise<Patients>; getContacts(): Promise<Contacts>;
  getSnapshot(): Promise<{ readFull(): Promise<CloudClinicSnapshot> }>;
  newId?: () => string; now?: () => string;
}) {
  if (typeof options.ownerUid !== 'string' || !options.ownerUid || options.ownerUid.length > 128 || options.ownerUid !== options.ownerUid.trim() || /[\u0000-\u001f\u007f]/u.test(options.ownerUid)) fail();
  const empty = (closed = false): CloudTransferWorkspaceState => ({ preview: null, loading: false, running: false, saveStatus: 'idle', pending: null,
    results: [], stopped: false, error: '', notice: '', closed });
  let state = freeze(empty()), closed = false, epoch = 0, checking = false, capturing = false, stopRequested = false;
  let command: Command | null = null, createdAt: string | null = null, acknowledgement: { recordId: string; revision: number; fileNo: number | null } | null = null;
  let patients: Patients | null = null, contacts: Contacts | null = null;
  const listeners = new Set<(value: CloudTransferWorkspaceState) => void>();
  function publish(value: CloudTransferWorkspaceState) { const next = freeze(value); state = next; for (const listener of [...listeners]) { try { listener(next); } catch { /* Views do not grant permission. */ } } }
  function dispose() { if (closed) return; closed = true; ++epoch; command = null; createdAt = null; acknowledgement = null; patients = null; contacts = null;
    publish(empty(true)); listeners.clear(); }
  function active(ticket = epoch): boolean { if (closed || ticket !== epoch || checking) return false; checking = true; let allowed = false;
    try { allowed = options.isActive() === true; } catch { /* Fail closed. */ } finally { checking = false; }
    if (closed || ticket !== epoch) return false; if (!allowed) { dispose(); return false; } return true; }
  const assertActive = (ticket: number) => { if (!active(ticket)) fail(); };
  const busy = () => state.loading || state.running || ['preparing', 'saving'].includes(state.saveStatus);
  const available = () => !capturing && active() && !busy() && !command;
  async function call<T>(ticket: number, work: () => T | Promise<T>): Promise<T> { assertActive(ticket); const value = await Promise.resolve().then(() => { assertActive(ticket); return work(); }); assertActive(ticket); return value; }
  async function source(kind: CloudTransferKind, ticket: number): Promise<Patients | Contacts> {
    assertActive(ticket);
    if (kind === 'patients') { if (!patients) patients = await call(ticket, () => options.getPatients()); return patients; }
    if (!contacts) contacts = await call(ticket, () => options.getContacts()); return contacts;
  }
  function log(cap: Patients | Contacts): CloudOperationIntentRepository { if (!cap.journal || typeof cap.journal.get !== 'function' || typeof cap.journal.prepare !== 'function' || typeof cap.journal.cancel !== 'function') fail(); return cap.journal; }
  const domainKind = (kind: CloudTransferKind) => kind === 'patients' ? 'patient-profile' as const : 'contact' as const;
  function checkedIntent(value: unknown, kind: CloudTransferKind, operationId: string, expected?: Command, expectedTime?: string): { intent: CloudOperationIntent; recovered: Command } {
    const intent = parseCloudOperationIntent(value), recovered = kind === 'patients' ? prepareCloudPatientCommand(intent.command) : prepareCloudContactCommand(intent.command);
    if (intent.kind !== domainKind(kind) || intent.actorUid !== options.ownerUid || intent.operationId !== operationId || recovered.operationId !== operationId
      || (kind === 'patients' ? recovered.action !== 'import' : recovered.action !== 'create')
      || JSON.stringify(intent.command) !== JSON.stringify(prepareCloudIntentCommand(recovered))
      || expected !== undefined && JSON.stringify(intent.command) !== JSON.stringify(prepareCloudIntentCommand(expected))
      || expectedTime !== undefined && intent.createdAt !== expectedTime) fail();
    return { intent, recovered };
  }
  async function previewRows(kind: CloudTransferKind, inputs: readonly PatientImportRow[] | readonly ContactImportInput[], expected: CloudTransferPreview | null = state.preview): Promise<boolean> {
    if (!available() || state.preview !== expected) return false;
    let captured: PatientImportRow[] | ContactImportInput[];
    try { capturing = true; captured = prepareCloudTransferRows(kind, inputs); } catch { return false; } finally { capturing = false; }
    if (!available() || state.preview !== expected) return false;
    const ticket = ++epoch; publish({ ...empty(), loading: true });
    try { const reader = await call(ticket, () => options.getSnapshot()), snapshot = await call(ticket, () => reader.readFull());
      const preview = previewCloudTransfer(kind, captured, snapshot); assertActive(ticket);
      publish({ ...state, preview, loading: false, notice: 'راجع الصفوف. المطابقات للتنبيه فقط؛ لن تُستورد مبالغ أو جلسات أو موافقة تسويقية.' }); return active(ticket);
    } catch { if (active(ticket)) publish({ ...state, loading: false, error: 'تعذرت معاينة الملف مع أحدث بيانات سحابية كاملة؛ لم يبدأ الاستيراد.' }); return false; }
  }
  async function readFile(kind: CloudTransferKind, file: File, expected: CloudTransferPreview | null = state.preview): Promise<boolean> {
    if (!available() || state.preview !== expected || !['patients', 'contacts'].includes(kind)) return false;
    const ticket = ++epoch; publish({ ...empty(), loading: true });
    try {
      const rows = kind === 'patients'
        ? await call(ticket, async () => (await import('./patientSpreadsheets')).readPatientSpreadsheet(file))
        : await call(ticket, async () => (await import('./contactSpreadsheets')).readContactSpreadsheet(file));
      const reader = await call(ticket, () => options.getSnapshot()), snapshot = await call(ticket, () => reader.readFull());
      const preview = previewCloudTransfer(kind, rows, snapshot); assertActive(ticket);
      publish({ ...state, preview, loading: false, notice: 'لم يُحفظ شيء بعد. تاريخ أول زيارة المجهول يبقى غير مسجل؛ لا استيراد للحسابات أو العلاج.' }); return active(ticket);
    } catch { if (active(ticket)) publish({ ...state, loading: false, error: 'تعذرت قراءة الملف أو مطابقة بيانات الخادم. استخدم ملف Excel/CSV غير مشفر حتى ٥ ميجابايت و٥٠٠٠ صف، دون معادلات؛ لم يبدأ الحفظ.' }); return false; }
  }
  function build(row: CloudTransferPreviewRow, kind: CloudTransferKind): { command: Command; createdAt: string } {
    capturing = true;
    try { const operationId = (options.newId ?? (() => crypto.randomUUID()))(), recordId = (options.newId ?? (() => crypto.randomUUID()))(), time = timestamp((options.now ?? (() => new Date().toISOString()))());
      if (!validId(operationId) || !validId(recordId) || operationId === recordId) fail();
      const prepared = kind === 'patients'
        ? prepareCloudPatientCommand({ operationId, recordId, expectedRevision: 0, action: 'import', fileNo: row.fileNo, profile: row.profile })
        : prepareCloudContactCommand({ operationId, recordId, expectedRevision: 0, action: 'create', contact: { ...row.contact, id: recordId, createdAt: time } });
      return { command: freeze(prepared), createdAt: time };
    } finally { capturing = false; }
  }
  async function execute(ticket: number): Promise<boolean> {
    const submitted = command, pending = state.pending, time = createdAt;
    if (!submitted || !pending || !time || !active(ticket)) return false;
    try {
      const cap = await source(pending.kind, ticket);
      if (!acknowledgement) {
        publish({ ...state, saveStatus: 'preparing', error: '' }); assertActive(ticket);
        const prepared = checkedIntent(await call(ticket, () => log(cap).prepare(domainKind(pending.kind), submitted, time)), pending.kind, pending.operationId, submitted, time);
        if (prepared.intent.status === 'cancelled') fail();
        publish({ ...state, saveStatus: 'saving' }); assertActive(ticket);
        const value = pending.kind === 'patients'
          ? await call(ticket, () => (cap as Patients).commit(submitted as CloudPatientWriteCommand))
          : await call(ticket, () => (cap as Contacts).commit(submitted as CloudContactCommand));
        const ack = exact(value, pending.kind === 'patients' ? ['status', 'recordId', 'fileNo', 'revision'] : ['status', 'recordId', 'revision']);
        if (!['committed', 'already-committed'].includes(ack.status) || ack.recordId !== submitted.recordId || ack.revision !== 1
          || pending.kind === 'patients' && ack.fileNo !== pending.fileNo) fail();
        acknowledgement = { recordId: ack.recordId, revision: ack.revision, fileNo: pending.fileNo };
      }
      publish({ ...state, saveStatus: 'refresh-required', loading: true }); assertActive(ticket);
      const raw = await call<unknown>(ticket, () => cap.get(submitted.recordId));
      if (pending.kind === 'patients') { const current = parseCloudPatientRecord(raw); if (current.recordId !== submitted.recordId || current.fileNo !== acknowledgement.fileNo || current.revision < 1) fail(); }
      else { const current = parseCloudContactRecord(raw); if (current.recordId !== submitted.recordId || current.revision < 1) fail(); }
      assertActive(ticket);
      const result: CloudTransferResult = { ...pending, status: 'committed' };
      command = null; createdAt = null; acknowledgement = null;
      publish({ ...state, loading: false, saveStatus: 'idle', pending: null, results: [...state.results, result], error: '', notice: 'تأكد حفظ الصف وقراءة نسخته الحالية من الخادم.' });
      return active(ticket);
    } catch { if (active(ticket)) publish({ ...state, loading: false, running: false,
      saveStatus: acknowledgement ? 'refresh-required' : 'retry-required', error: acknowledgement
        ? 'حفظ الصف مؤكد. تعذر تحديثه؛ أعد التحقق بالقراءة فقط.'
        : 'توقف الاستيراد عند الصف الحالي؛ ربما وصل للخادم. احتفظ بمعرف العملية وأعدها نفسها أو أكّد إلغاءها، دون بدء بديل.' }); return false; }
  }
  async function process(ticket: number, preview: CloudTransferPreview): Promise<boolean> {
    for (const row of preview.rows) {
      if (!active(ticket) || state.preview !== preview) return false;
      if (row.status !== 'ready' || state.results.some(result => result.rowNumber === row.rowNumber)) continue;
      if (stopRequested) { publish({ ...state, running: false, stopped: true, notice: 'توقفنا بعد الصف المؤكد. الصفوف السابقة محفوظة؛ أكّد المتابعة أو أغلق الملف.' }); return true; }
      try { const built = build(row, preview.kind); assertActive(ticket); if (state.preview !== preview || command) fail();
        command = built.command; createdAt = built.createdAt; acknowledgement = null;
        publish({ ...state, pending: { kind: preview.kind, rowNumber: row.rowNumber, operationId: command.operationId, fileNo: row.fileNo }, saveStatus: 'preparing' }); assertActive(ticket);
      } catch { if (active(ticket)) publish({ ...state, running: false, error: 'تعذر تثبيت أمر الصف؛ لم يبدأ صف جديد.' }); return false; }
      if (!await execute(ticket)) return false;
    }
    if (active(ticket)) publish({ ...state, running: false, stopped: false, notice: 'اكتمل حفظ الصفوف الصالحة. المكرر وغير الصالح لم يُستورد. هذه عمليات منفصلة وليست استعادة مالية أو معاملة ملف واحدة.' });
    return active(ticket);
  }
  async function confirm(expected: CloudTransferPreview): Promise<boolean> {
    if (!available() || state.preview !== expected || !expected.readyCount) return false;
    const ticket = ++epoch; stopRequested = false; publish({ ...state, running: true, stopped: false, error: '' }); assertActive(ticket);
    return process(ticket, expected);
  }
  async function retry(operationId: string): Promise<boolean> {
    if (!active() || capturing || busy() || !command || state.pending?.operationId !== operationId) return false;
    const preview = state.preview, ticket = ++epoch; publish({ ...state, running: true, error: '' });
    if (!await execute(ticket)) return false;
    if (preview && state.preview === preview) return process(ticket, preview);
    if (active(ticket)) publish({ ...state, running: false, notice: 'تم تأكيد العملية الأصلية؛ أعد اختيار الملف لمعاينة الصفوف المتبقية دون استبدال الموجود.' }); return active(ticket);
  }
  async function cancelPending(operationId: string): Promise<boolean> {
    if (!active() || capturing || busy() || !command || !createdAt || acknowledgement || state.pending?.operationId !== operationId) return false;
    const submitted = command, pending = state.pending, time = createdAt, ticket = ++epoch;
    publish({ ...state, loading: true, error: '' });
    try { const cap = await source(pending.kind, ticket), journal = log(cap);
      let raw = await call(ticket, () => journal.get(operationId));
      if (raw === null) raw = await call(ticket, () => journal.prepare(domainKind(pending.kind), submitted, time));
      const current = checkedIntent(raw, pending.kind, operationId, submitted, time); if (current.intent.status === 'committed') fail();
      const cancelled = checkedIntent(await call(ticket, () => journal.cancel(operationId)), pending.kind, operationId, submitted, time); if (cancelled.intent.status !== 'cancelled') fail(); assertActive(ticket);
      command = null; createdAt = null; acknowledgement = null; stopRequested = true;
      publish({ ...state, loading: false, running: false, saveStatus: 'idle', pending: null, stopped: true,
        results: [...state.results, { ...pending, status: 'cancelled' }], notice: 'تأكد إلغاء هذا الصف فقط. الصفوف السابقة محفوظة ولم نتراجع عنها.' }); return active(ticket);
    } catch { if (active(ticket)) publish({ ...state, loading: false, error: 'لم يتأكد الإلغاء؛ قد تكون العملية حُفظت. بقي الأمر الأصلي ثابتًا لإعادة التحقق.' }); return false; }
  }
  async function resume(kind: CloudTransferKind, operationId: string): Promise<boolean> {
    if (!available() || state.preview || !['patients', 'contacts'].includes(kind) || !validId(operationId)) return false;
    const ticket = ++epoch; publish({ ...empty(), loading: true });
    try { const cap = await source(kind, ticket), result = checkedIntent(await call(ticket, () => log(cap).get(operationId)), kind, operationId);
      if (result.intent.status === 'cancelled') fail(); assertActive(ticket);
      command = freeze(result.recovered); createdAt = result.intent.createdAt; acknowledgement = null;
      const fileNo = 'fileNo' in command ? command.fileNo : null;
      publish({ ...state, loading: false, running: true, pending: { kind, operationId, rowNumber: 0, fileNo }, saveStatus: 'preparing',
        notice: 'نسترجع الصف الأصلي بمعرفه ورقمه، لا ننشئ عملية أخرى.' });
      const done = await execute(ticket); if (active(ticket) && done) publish({ ...state, running: false, notice: 'تأكدت العملية الأصلية. يمكنك إعادة اختيار الملف؛ الموجود سيظهر مكررًا دون دمج.' }); return done;
    } catch { if (active(ticket)) publish({ ...state, loading: false, running: false, error: 'تعذر استرجاع عملية الاستيراد؛ راجع النوع ومعرف العملية. لم ننشئ بديلًا.' }); return false; }
  }
  return Object.freeze({ getState: () => { active(); return state; }, subscribe: (listener: (value: CloudTransferWorkspaceState) => void) => { if (closed) return () => undefined; listeners.add(listener); return () => { listeners.delete(listener); }; },
    readFile, previewRows, confirm, retry, cancelPending, resume,
    stopAfterCurrent: () => { if (!active() || !state.running) return false; stopRequested = true; publish({ ...state, notice: 'سنوقف الصفوف التالية بعد تأكيد الصف الحالي؛ لا نلغي طلبًا وصل للخادم.' }); return true; },
    discardPreview: (expected: CloudTransferPreview) => { if (!available() || state.preview !== expected) return false; publish(empty()); return active(); },
    canClose: () => active() && !busy() && !command && (!state.preview || state.preview.rows.every(row => row.status !== 'ready' || state.results.some(result => result.rowNumber === row.rowNumber))),
    dispose });
}
export type CloudTransferWorkspaceController = ReturnType<typeof createCloudTransferWorkspaceController>;
