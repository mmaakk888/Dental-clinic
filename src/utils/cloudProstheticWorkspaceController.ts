import { CloudProstheticError, prepareCloudProstheticCommand, parseCloudProstheticCommit, parseCloudLabAccount,
  MAX_CLOUD_LAB_PAYMENT_ALLOCATIONS, MAX_CLOUD_PROSTHETIC_CENTS, type CloudProstheticCommand,
  type CloudProstheticCommit, type CloudProstheticStatus } from './cloudProstheticRepository';
import { loadCloudProstheticLedger, type CloudProstheticLedger } from './cloudProstheticLedgerProjection';
import type { FirebaseCloudProstheticsCapability } from './firebaseCloudProsthetics';
import { parseCloudLabDefinition, parseCloudProstheticRouting, type CloudLabDefinitionRecord,
  type CloudClinicSettingsRepository, type CloudProstheticRoutingRecord } from './cloudClinicSettingsRepository';
import { parseCloudServiceCatalogRecord, type CloudServiceCatalogRecord } from './cloudServiceCatalogRepository';
import { loadCloudClinicalPatient, type CloudClinicalPatientSnapshot } from './cloudClinicalPatientProjection';
import type { CloudClinicalCapability } from './cloudClinicalWorkspaceController';
import { parseCloudOperationIntent, prepareCloudIntentCommand, type CloudOperationIntent } from './cloudOperationIntent';
import { normalizeDirectoryDigits } from './patientDirectory';
import { parseCompositeToothId } from './toothUtils';

export interface CloudProstheticOrderChoice { serviceId: string; name: string; priceCents: number; kind: 'fixed' | 'removable' | null }
export type CloudProstheticWorkspaceDraft =
  | { type: 'order'; handle: number; patientId: string; patientName: string; fileNo: number; choices: CloudProstheticOrderChoice[];
    serviceId: string | null; kind: 'fixed' | 'removable' | null; units: string; unitPrice: string; paid: string;
    examinationCents: number; includeExamination: boolean; teethIds: string[]; date: string; deliveryDate: string; note: string }
  | { type: 'progress'; handle: number; caseId: string; status: CloudProstheticStatus; note: string }
  | { type: 'payment'; handle: number; caseId: string | null; amount: string; date: string; note: string };
export type CloudProstheticWorkspaceState = Readonly<{
  labs: CloudLabDefinitionRecord[]; labsLoaded: boolean; labsCursor: string | null;
  selectedLab: CloudLabDefinitionRecord | null; month: string | null; ledger: CloudProstheticLedger | null;
  loaded: boolean; loading: boolean; draft: CloudProstheticWorkspaceDraft | null;
  saveStatus: 'idle' | 'preparing' | 'saving' | 'retry-required' | 'refresh-required'; pendingOperationId: string | null;
  history: CloudOperationIntent[]; historyLoaded: boolean; historyCursor: string | null; historyLoading: boolean;
  error: string; notice: string; closed: boolean;
}>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const validId = (value: unknown): value is string => typeof value === 'string' && value.length === 36 && UUID.test(value);
const validMonth = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && value >= '1900-01' && value <= '9999-12';
function fail(): never { throw new CloudProstheticError('unavailable'); }
function invalid(): never { throw new CloudProstheticError('invalid'); }
function freeze<T>(value: T): T { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
const clone = <T>(value: T): T => structuredClone(value);
function own(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  const result: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') invalid(); const property = Object.getOwnPropertyDescriptor(value, key);
    if (!property || !('value' in property) || !property.enumerable) invalid(); result[key] = property.value;
  } return result;
}
function dense(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max || Reflect.ownKeys(value).length !== value.length + 1) invalid();
  return Array.from({ length: value.length }, (_, index) => {
    const property = Object.getOwnPropertyDescriptor(value, String(index));
    if (!property || !('value' in property) || !property.enumerable) invalid(); return property.value;
  });
}
/** Blank remains unknown. Explicit 0 is accepted; fractional piastres are not. */
export function parseCloudProstheticMoney(value: unknown): number | null {
  if (typeof value !== 'string' || value.length > 32) return null;
  const normalized = normalizeDirectoryDigits(value.trim()).replace(/[٫,]/g, '.');
  if (!/^\d{1,11}(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ''] = normalized.split('.'), cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents <= MAX_CLOUD_PROSTHETIC_CENTS ? cents : null;
}
type OrderContext = { patient: CloudClinicalPatientSnapshot; catalog: CloudServiceCatalogRecord; routing: CloudProstheticRoutingRecord;
  labs: Map<string, CloudLabDefinitionRecord>; revisions: Map<string, number> };
/** Owner-only prepared workspace. Inert construction. No local records/defaults,
 * SDK, storage or implicit fetch. Original commands survive uncertain replies;
 * fresh CAS conflicts never silently rebase a draft or allocate another ID.
 * Parent must dispose synchronously on actual Auth/view loss. */
export function createCloudProstheticWorkspaceController(options: {
  getCapability: () => Promise<FirebaseCloudProstheticsCapability>;
  getClinical: () => Promise<CloudClinicalCapability>;
  getSettings: () => Promise<{ repository: CloudClinicSettingsRepository }>;
  getCatalog: () => Promise<CloudServiceCatalogRecord | null>;
  ownerUid: string; isActive: () => boolean; newId?: () => string; now?: () => string;
}) {
  let state: CloudProstheticWorkspaceState = freeze({ labs: [], labsLoaded: false, labsCursor: null, selectedLab: null, month: null, ledger: null,
    loaded: false, loading: false, draft: null, saveStatus: 'idle', pendingOperationId: null,
    history: [], historyLoaded: false, historyCursor: null, historyLoading: false, error: '', notice: '', closed: false });
  let closed = false, checking = false, epoch = 0, nextHandle = 0;
  let capability: FirebaseCloudProstheticsCapability | null = null, clinical: CloudClinicalCapability | null = null;
  let settings: { repository: CloudClinicSettingsRepository } | null = null, context: OrderContext | null = null;
  let command: CloudProstheticCommand | null = null, acknowledged: CloudProstheticCommit | null = null;
  const listeners = new Set<(value: CloudProstheticWorkspaceState) => void>();
  function publish(value: CloudProstheticWorkspaceState) {
    const published = freeze(value); state = published;
    for (const listener of [...listeners]) { try { listener(published); } catch { /* View is not authorization. */ } }
  }
  function dispose() {
    if (closed) return; closed = true; ++epoch; capability = null; clinical = null; settings = null; context = null; command = null; acknowledged = null;
    publish({ labs: [], labsLoaded: false, labsCursor: null, selectedLab: null, month: null, ledger: null, loaded: false, loading: false,
      draft: null, saveStatus: 'idle', pendingOperationId: null, history: [], historyLoaded: false, historyCursor: null, historyLoading: false,
      error: '', notice: '', closed: true }); listeners.clear();
  }
  function active(ticket = epoch): boolean {
    if (closed || ticket !== epoch) return false;
    if (checking) return true;
    checking = true; let allowed = false; try { allowed = options.isActive() === true; } catch { /* Fail closed. */ } finally { checking = false; }
    if (closed || ticket !== epoch) return false; if (!allowed) { dispose(); return false; } return true;
  }
  const assert = (ticket: number) => () => { if (!active(ticket)) fail(); };
  const busy = () => state.loading || state.historyLoading || state.saveStatus === 'preparing' || state.saveStatus === 'saving';
  const idle = () => !busy() && !command && state.saveStatus === 'idle' && !state.draft;
  async function cap(ticket: number) { assert(ticket)(); if (!capability) { const value = await options.getCapability(); assert(ticket)(); capability = value; } return capability; }
  async function clinic(ticket: number) { assert(ticket)(); if (!clinical) { const value = await options.getClinical(); assert(ticket)(); clinical = value; } return clinical; }
  async function config(ticket: number) { assert(ticket)(); if (!settings) { const value = await options.getSettings(); assert(ticket)(); settings = value; } return settings; }
  async function readLedger(ticket: number, labId: string, month: string) {
    const repo = (await cap(ticket)).repository, clinicalRepo = (await clinic(ticket)).repository;
    const raw = await (await config(ticket)).repository.getLab(labId); assert(ticket)();
    if (raw === null) fail(); const lab = parseCloudLabDefinition(raw, labId);
    const ledger = await loadCloudProstheticLedger(repo, clinicalRepo, { labId, month }, assert(ticket));
    return { lab, ledger };
  }
  function message(error: unknown): string {
    let conflict = false; try { conflict = !!error && typeof error === 'object' && 'code' in error && error.code === 'conflict'; } catch { /* No raw error. */ }
    return conflict ? 'تغيّر حساب أو سعر أثناء العمل. لم نُغيّر المحاولة؛ تحقق منها أو ألغِها ثم حمّل السجل مجددًا.' : 'تعذر تأكيد السجل كاملًا من الخادم. لم نعرض حسابًا جزئيًا.';
  }
  async function loadLabs(more = false): Promise<boolean> {
    if (!active() || !idle() || more && (!state.labsLoaded || !state.labsCursor)) return false;
    const after = more ? state.labsCursor : null, previous = more ? state.labs : [], ticket = ++epoch;
    publish({ ...state, loading: true, error: '', notice: '' });
    try {
      const raw = own(await (await config(ticket)).repository.listLabsPage({ afterId: after, limit: 50 })); assert(ticket)();
      if (Object.keys(raw).length !== 2 || !Object.hasOwn(raw, 'records') || !Object.hasOwn(raw, 'nextAfterId')) fail();
      let last = after;
      const records = dense(raw.records, 50).map(value => { const lab = parseCloudLabDefinition(value); if (last && lab.recordId <= last) fail(); last = lab.recordId; return lab; });
      if (raw.nextAfterId !== (records.length === 50 ? last : null) || previous.length + records.length > 2000) fail();
      publish({ ...state, labs: [...previous, ...records], labsLoaded: true, labsCursor: raw.nextAfterId as string | null, loading: false }); return true;
    } catch (error) { if (active(ticket)) publish({ ...state, loading: false, error: message(error) }); return false; }
  }
  async function openLab(labId: string, month: string): Promise<boolean> {
    if (!active() || !idle()) return false;
    if (!validId(labId) || !validMonth(month)) { publish({ ...state, error: 'اختر معملًا وشهرًا صالحين.' }); return false; }
    const ticket = ++epoch; publish({ ...state, selectedLab: null, month, ledger: null, loaded: false, loading: true, error: '', notice: '' });
    try { const loaded = await readLedger(ticket, labId, month); assert(ticket)();
      publish({ ...state, selectedLab: loaded.lab, ledger: loaded.ledger, loaded: true, loading: false }); return true;
    } catch (error) { if (active(ticket)) publish({ ...state, loading: false, error: message(error) }); return false; }
  }
  async function beginOrder(patientId: string): Promise<boolean> {
    if (!active() || !idle()) return false;
    if (!validId(patientId)) { publish({ ...state, error: 'اختر ملف المريض من قائمة المرضى، وليس رقم الملف الظاهر.' }); return false; }
    const ticket = ++epoch; publish({ ...state, loading: true, error: '', notice: '' });
    try {
      const patient = await loadCloudClinicalPatient((await clinic(ticket)).repository, patientId, assert(ticket));
      const catalog = parseCloudServiceCatalogRecord(await options.getCatalog()); assert(ticket)();
      const routing = parseCloudProstheticRouting(await (await config(ticket)).repository.getRouting()); assert(ticket)();
      const labs = new Map<string, CloudLabDefinitionRecord>(), revisions = new Map<string, number>();
      for (const labId of new Set(routing.data.routes.map(route => route.labId))) {
        const lab = parseCloudLabDefinition(await (await config(ticket)).repository.getLab(labId), labId); assert(ticket)(); labs.set(labId, lab);
        const raw = await (await cap(ticket)).repository.getLabAccount(labId); assert(ticket)();
        const account = raw === null ? null : parseCloudLabAccount(raw); if (account && account.labId !== labId) fail(); revisions.set(labId, account?.revision ?? 0);
      }
      const choices: CloudProstheticOrderChoice[] = [];
      for (const service of catalog.data.services) {
        if (!service.active || service.kind !== 'prosthetic' || service.priceCents === null) continue;
        const route = routing.data.routes.find(row => row.serviceId === service.serviceId), lab = route && labs.get(route.labId);
        const material = lab?.data.costs.find(row => row.materialId === route?.materialId);
        if (!lab?.data.active || !material?.active || material.unitCostCents === null) continue;
        choices.push({ serviceId: service.serviceId, name: service.name, priceCents: service.priceCents,
          kind: material.category === 'other' ? null : material.category });
      }
      if (!choices.length) { publish({ ...state, loading: false, error: 'لا توجد خدمة تركيب نشطة بسعر مريض ومسار معمل وتكلفة مؤكدة. أكمل إعداد الخدمات والمعامل أولًا.' }); return false; }
      const when = (options.now ?? (() => new Date().toISOString()))();
      // Validate supplied clock without creating an operation or setting a price.
      if (typeof when !== 'string' || when.length !== 24 || new Date(when).toISOString() !== when) invalid();
      context = { patient, catalog, routing, labs, revisions };
      const draft: CloudProstheticWorkspaceDraft = { type: 'order', handle: ++nextHandle, patientId, patientName: patient.profile.data.name,
        fileNo: patient.profile.fileNo, choices, serviceId: null, kind: null, units: '1', unitPrice: '', paid: '',
        examinationCents: catalog.data.examinationCents, includeExamination: false, teethIds: [], date: when.slice(0, 10), deliveryDate: '', note: '' };
      publish({ ...state, loading: false, draft }); return active(ticket) && state.draft === draft;
    } catch (error) { if (active(ticket)) { context = null; publish({ ...state, loading: false, error: message(error) }); } return false; }
  }
  function edit(handle: number): CloudProstheticWorkspaceDraft | null {
    return active() && !busy() && !command && state.saveStatus === 'idle' && state.draft?.handle === handle ? state.draft : null;
  }
  function selectService(handle: number, serviceId: string): boolean {
    const draft = edit(handle); if (draft?.type !== 'order') return false;
    const choice = draft.choices.find(row => row.serviceId === serviceId); if (!choice) return false;
    const next = { ...draft, serviceId, kind: choice.kind, unitPrice: String(choice.priceCents / 100) };
    publish({ ...state, draft: next, error: '' }); return active() && state.draft === next;
  }
  function updateDraft(handle: number, input: unknown): boolean {
    const draft = edit(handle); if (!draft) return false;
    try {
      const patch = own(input), allowed = draft.type === 'order'
        ? ['kind', 'units', 'unitPrice', 'paid', 'includeExamination', 'teethIds', 'date', 'deliveryDate', 'note']
        : draft.type === 'progress' ? ['status', 'note'] : ['amount', 'date', 'note'];
      if (Object.keys(patch).some(key => !allowed.includes(key))) invalid();
      for (const [key, value] of Object.entries(patch)) {
        if (key === 'includeExamination') { if (typeof value !== 'boolean') invalid(); }
        else if (key === 'kind') { if (!['fixed', 'removable'].includes(value as string)) invalid(); }
        else if (key === 'status') { if (!['pending', 'in_progress', 'ready', 'delivered'].includes(value as string)) invalid(); }
        else if (key === 'teethIds') {
          const ids = dense(value, 32); if (ids.some(id => typeof id !== 'string' || !parseCompositeToothId(id)) || new Set(ids).size !== ids.length) invalid(); patch[key] = [...ids];
        } else if (typeof value !== 'string' || value.length > (key === 'note' ? 2000 : 32)) invalid();
      }
      const next = { ...draft, ...patch } as CloudProstheticWorkspaceDraft;
      publish({ ...state, draft: next, error: '' }); return active() && state.draft === next;
    } catch { publish({ ...state, error: 'راجع القيم المدخلة؛ لم تتغير المسودة.' }); return false; }
  }
  function beginProgress(caseId: string): boolean {
    if (!active() || !idle() || !state.ledger) return false;
    const item = state.ledger.cases.find(row => row.recordId === caseId); if (!item) return false;
    publish({ ...state, draft: { type: 'progress', handle: ++nextHandle, caseId, status: item.status, note: item.note }, error: '', notice: '' }); return true;
  }
  function beginPayment(caseId: string | null = null): boolean {
    if (!active() || !idle() || !state.ledger || caseId !== null && !state.ledger.cases.some(row => row.recordId === caseId)) return false;
    const when = (options.now ?? (() => new Date().toISOString()))();
    try { if (typeof when !== 'string' || when.length !== 24 || new Date(when).toISOString() !== when) invalid(); }
    catch { publish({ ...state, error: 'تعذر تحديد تاريخ الدفعة.' }); return false; }
    publish({ ...state, draft: { type: 'payment', handle: ++nextHandle, caseId, amount: '', date: when.slice(0, 10), note: '' }, error: '', notice: '' }); return true;
  }
  function build(draft: CloudProstheticWorkspaceDraft): Omit<CloudProstheticCommand, 'operationId' | 'createdAt'> {
    if (draft.type === 'order') {
      if (!context || !draft.serviceId || !draft.kind) invalid();
      const choice = draft.choices.find(row => row.serviceId === draft.serviceId), route = context.routing.data.routes.find(row => row.serviceId === draft.serviceId);
      const lab = route && context.labs.get(route.labId);
      const unitPrice = parseCloudProstheticMoney(draft.unitPrice), paid = parseCloudProstheticMoney(draft.paid);
      const unitsText = normalizeDirectoryDigits(draft.units.trim());
      if (!choice || !route || !lab || unitPrice === null || paid === null || !/^\d{1,3}$/.test(unitsText)) invalid();
      const units = Number(unitsText), total = units * unitPrice + (draft.includeExamination ? draft.examinationCents : 0);
      if (paid > total || total > MAX_CLOUD_PROSTHETIC_CENTS || choice.kind && choice.kind !== draft.kind) invalid();
      return { action: 'create', labId: route.labId, expectedLabAccountRevision: context.revisions.get(route.labId)!,
        patientId: draft.patientId, expectedPatientRevision: context.patient.accountRevision, serviceId: draft.serviceId,
        expectedCatalogRevision: context.catalog.revision, expectedRoutingRevision: context.routing.revision, expectedLabRevision: lab.revision,
        kind: draft.kind, units, teethIds: [...draft.teethIds], date: draft.date, deliveryExpectedDate: draft.deliveryDate || null,
        patientUnitPriceCents: unitPrice, includeExamination: draft.includeExamination, paidCents: paid, note: draft.note } as Omit<CloudProstheticCommand, 'operationId' | 'createdAt'>;
    }
    const ledger = state.ledger; if (!ledger) invalid();
    const base = { labId: ledger.account.labId, expectedLabAccountRevision: ledger.account.revision };
    if (draft.type === 'progress') {
      const item = ledger.cases.find(row => row.recordId === draft.caseId); if (!item) invalid();
      return { ...base, action: 'progress', caseId: draft.caseId, expectedCaseRevision: item.revision, status: draft.status, note: draft.note } as Omit<CloudProstheticCommand, 'operationId' | 'createdAt'>;
    }
    let remaining = parseCloudProstheticMoney(draft.amount); if (remaining === null || remaining <= 0) invalid();
    const allocations: { caseId: string; expectedRevision: number; amountCents: number }[] = [];
    const unpaid = ledger.cases.filter(row => (!draft.caseId || row.recordId === draft.caseId) && row.totalCostCents > row.paidCostCents)
      .sort((a, b) => a.snapshot.date.localeCompare(b.snapshot.date) || a.recordId.localeCompare(b.recordId));
    for (const item of unpaid) {
      if (!remaining) break; const amountCents = Math.min(remaining, item.totalCostCents - item.paidCostCents);
      allocations.push({ caseId: item.recordId, expectedRevision: item.revision, amountCents }); remaining -= amountCents;
    }
    if (remaining || !allocations.length || allocations.length > MAX_CLOUD_LAB_PAYMENT_ALLOCATIONS) invalid();
    return { ...base, action: 'lab-payment', date: draft.date, note: draft.note, allocations } as Omit<CloudProstheticCommand, 'operationId' | 'createdAt'>;
  }
  function checkedIntent(value: unknown, submitted?: CloudProstheticCommand): CloudOperationIntent {
    const intent = parseCloudOperationIntent(value), original = prepareCloudProstheticCommand(intent.command);
    if (!options.ownerUid || intent.actorUid !== options.ownerUid || intent.kind !== 'prosthetic' || intent.createdAt !== original.createdAt
      || submitted && (intent.operationId !== submitted.operationId || JSON.stringify(prepareCloudIntentCommand(original)) !== JSON.stringify(prepareCloudIntentCommand(submitted)))) fail();
    return intent;
  }
  async function refreshAcknowledged(ticket: number): Promise<boolean> {
    const submitted = command, ack = acknowledged; if (!submitted || !ack) return false;
    try {
      const month = state.month ?? (submitted.action === 'progress' ? submitted.createdAt : submitted.date).slice(0, 7);
      const loaded = await readLedger(ticket, submitted.labId, month); assert(ticket)();
      if (!loaded.ledger || loaded.ledger.account.revision < ack.labRevision) fail();
      if (submitted.action === 'create') {
        const item = loaded.ledger.cases.find(row => row.recordId === submitted.operationId);
        if (!item || item.patientId !== submitted.patientId || item.fileNo !== ack.fileNo) fail();
      }
      command = null; acknowledged = null; context = null;
      publish({ ...state, selectedLab: loaded.lab, ledger: loaded.ledger, month, loaded: true, draft: null, loading: false,
        saveStatus: 'idle', pendingOperationId: null, error: '', notice: 'تم تأكيد العملية وتحديث الحساب كاملًا من الخادم.' }); return true;
    } catch (error) { if (active(ticket)) publish({ ...state, loading: false, saveStatus: 'refresh-required', error: message(error) }); return false; }
  }
  async function execute(ticket: number): Promise<boolean> {
    const submitted = command; if (!submitted || !active(ticket)) return false;
    try {
      const adapter = await cap(ticket);
      const intent = checkedIntent(await adapter.journal.prepare('prosthetic', submitted, submitted.createdAt), submitted); assert(ticket)();
      if (intent.status === 'cancelled') fail();
      publish({ ...state, saveStatus: 'saving' }); assert(ticket)();
      const ack = parseCloudProstheticCommit(await adapter.repository.commit(submitted), submitted); assert(ticket)();
      if (submitted.action === 'create' && context && ack.fileNo !== context.patient.profile.fileNo) fail();
      acknowledged = ack;
      // Claim the read ticket before notifying listeners: no reentrant retry or
      // navigation can resubmit an acknowledged write.
      publish({ ...state, draft: null, ledger: null, loaded: false, saveStatus: 'refresh-required', loading: true, error: '' });
      return refreshAcknowledged(ticket);
    } catch (error) { if (active(ticket)) publish({ ...state, loading: false, saveStatus: 'retry-required', error: message(error),
      notice: 'المحاولة الأصلية محفوظة. لا تسجّل دفعة بديلة قبل التحقق منها.' }); return false; }
  }
  async function saveDraft(handle: number): Promise<boolean> {
    const draft = edit(handle); if (!draft) return false;
    try {
      const data = build(draft);
      // Validate the complete body BEFORE consuming the single retained ID/time.
      prepareCloudProstheticCommand({ ...data, operationId: '00000000-0000-4000-8000-000000000000', createdAt: '2000-01-01T00:00:00.000Z' });
      const operationId = (options.newId ?? (() => crypto.randomUUID()))(), createdAt = (options.now ?? (() => new Date().toISOString()))();
      const prepared = freeze(prepareCloudProstheticCommand({ ...data, operationId, createdAt }));
      if (!active() || state.draft !== draft || busy() || command) return false;
      command = prepared; acknowledged = null; const ticket = ++epoch;
      publish({ ...state, saveStatus: 'preparing', pendingOperationId: prepared.operationId, error: '', notice: '' });
      return execute(ticket);
    } catch { if (active()) publish({ ...state, error: 'راجع الخدمة والعدد والأسنان والسعر والتحصيل والتاريخ. الدفعة المجمّعة لا تتجاوز ٨ حالات؛ لم يُحفظ شيء.' }); return false; }
  }
  async function retry(expectedOperationId: string): Promise<boolean> {
    if (!active() || busy() || !command || command.operationId !== expectedOperationId) return false;
    const ticket = ++epoch;
    if (acknowledged && state.saveStatus === 'refresh-required') {
      publish({ ...state, loading: true, error: '' }); return refreshAcknowledged(ticket);
    }
    if (state.saveStatus !== 'retry-required') return false;
    publish({ ...state, saveStatus: 'preparing', error: '', notice: '' }); return execute(ticket);
  }
  async function cancelPending(expectedOperationId: string): Promise<boolean> {
    if (!active() || busy() || !command || acknowledged || state.saveStatus !== 'retry-required' || command.operationId !== expectedOperationId) return false;
    const submitted = command, ticket = ++epoch; publish({ ...state, loading: true, error: '' });
    try {
      const adapter = await cap(ticket), intent = checkedIntent(await adapter.journal.get(submitted.operationId), submitted); assert(ticket)();
      if (intent.status === 'committed') { publish({ ...state, loading: false, error: 'العملية ملتزمة على الخادم؛ أعد نفس المحاولة لتأكيدها، ولا تسجّل بديلًا.' }); return false; }
      const cancelled = checkedIntent(await adapter.journal.cancel(submitted.operationId), submitted); assert(ticket)();
      if (cancelled.status !== 'cancelled') fail();
      command = null; acknowledged = null; context = null;
      publish({ ...state, draft: null, ledger: null, loaded: false, loading: false, saveStatus: 'idle', pendingOperationId: null,
        error: '', notice: 'تأكد إلغاء العملية غير الملتزمة. حمّل الحساب مجددًا قبل أي تعديل.' }); return true;
    } catch (error) { if (active(ticket)) publish({ ...state, loading: false, error: message(error) }); return false; }
  }
  async function loadHistory(more = false): Promise<boolean> {
    if (!active() || !idle() || more && (!state.historyLoaded || !state.historyCursor)) return false;
    const after = more ? state.historyCursor : null, previous = more ? state.history : [], ticket = ++epoch;
    publish({ ...state, historyLoading: true, error: '', notice: '' });
    try {
      const journal = (await cap(ticket)).journal; if (typeof journal.listHistoryPage !== 'function') fail();
      const raw = own(await journal.listHistoryPage('prosthetic', { afterId: after, limit: 25 })); assert(ticket)();
      if (Object.keys(raw).length !== 2 || !Object.hasOwn(raw, 'records') || !Object.hasOwn(raw, 'nextAfterId')) fail();
      let last = after;
      const records = dense(raw.records, 25).map(value => { const intent = checkedIntent(value); if (last && intent.operationId <= last) fail(); last = intent.operationId; return intent; });
      if (raw.nextAfterId !== (records.length === 25 ? last : null) || previous.length + records.length > 2000) fail();
      publish({ ...state, history: [...previous, ...records], historyLoaded: true, historyCursor: raw.nextAfterId as string | null, historyLoading: false,
        notice: 'السجل بترتيب معرّف العملية، وليس الأحدث زمنيًا؛ يشمل العمليات الملتزمة وغير الملتزمة والملغاة.' }); return true;
    } catch { if (active(ticket)) publish({ ...state, historyLoading: false, error: 'تعذر تأكيد سجل الاسترجاع كاملًا. الحد ٢٠٠٠ عملية؛ لم نستخدم قائمة العمليات المنتظرة كبديل.' }); return false; }
  }
  async function resume(operationId: string): Promise<boolean> {
    if (!active() || !idle() || !validId(operationId)) return false;
    const ticket = ++epoch; publish({ ...state, loading: true, error: '', notice: '' });
    try {
      const intent = checkedIntent(await (await cap(ticket)).journal.get(operationId)); assert(ticket)();
      if (intent.operationId !== operationId || intent.status === 'cancelled') fail();
      command = freeze(prepareCloudProstheticCommand(intent.command)); acknowledged = null; context = null;
      publish({ ...state, loading: false, pendingOperationId: operationId, saveStatus: 'preparing', ledger: null, loaded: false });
      return execute(ticket);
    } catch (error) { if (active(ticket)) publish({ ...state, loading: false, error: message(error) }); return false; }
  }
  return Object.freeze({ getState: () => state,
    subscribe(listener: (value: CloudProstheticWorkspaceState) => void) { if (closed) return () => undefined; listeners.add(listener); return () => listeners.delete(listener); },
    loadLabs, openLab, beginOrder, selectService, updateDraft, beginProgress, beginPayment, saveDraft, retry, cancelPending, loadHistory, resume,
    refresh: () => state.selectedLab && state.month ? openLab(state.selectedLab.recordId, state.month) : Promise.resolve(false),
    cancelDraft(handle: number) { if (!edit(handle)) return false; context = null; publish({ ...state, draft: null, error: '', notice: 'أُلغيت المسودة فقط؛ لم تُسجّل عملية.' }); return true; },
    canClose: () => active() && idle(), dispose });
}
export type CloudProstheticWorkspaceController = ReturnType<typeof createCloudProstheticWorkspaceController>;
