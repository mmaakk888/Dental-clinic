import { createCloudCatalogVisitDraft, type CloudCatalogVisitDraft, type CloudCatalogVisitDraftState,
  type CloudCatalogVisitMetadata } from './cloudCatalogVisitDraft';
import { MAX_CLOUD_CLINICAL_CENTS } from './cloudClinicalRepository';
import type { CloudClinicalPatientSnapshot } from './cloudClinicalPatientProjection';
import type { CloudClinicalWorkspaceController, CloudClinicalWorkspaceState } from './cloudClinicalWorkspaceController';
import type { CloudServiceCatalogRecord } from './cloudServiceCatalogRepository';

export type CloudClinicalVisitWorkspaceState = Readonly<{
  phase: 'idle' | 'loading' | 'editing' | 'submitting' | 'pending';
  snapshot: CloudClinicalPatientSnapshot | null;
  catalog: CloudServiceCatalogRecord | null;
  draft: CloudCatalogVisitDraftState | null;
  error: string;
  closed: boolean;
}>;
const REVIEW = 'راجع الخدمات والأسنان والسعر والمبلغ المحصّل قبل الحفظ.';
const CHANGED = 'تغيّر الملف أو المحرر؛ افتح الزيارة من حساب المريض المحدّث.';
const RELEASE = 'تعذر تأكيد إلغاء مسودة الزيارة. ما زالت محمية؛ أعد الضغط على إلغاء قبل الانتقال.';
const empty = (closed = false, error = ''): CloudClinicalVisitWorkspaceState => Object.freeze({
  phase: 'idle', snapshot: null, catalog: null, draft: null, error, closed,
});

/** Explicit selected-file editor. No SDK, storage or reads on construction.
 * Captured catalog prices are clinical history, NOT current authorization.
 * The file controller alone owns the durable command, operation ID and retry.
 * The parent disposes this AND the file on actual Auth/view loss (not checking).
 * Disposal clears memory; it cannot cancel or undo a server-accepted visit. */
export function createCloudClinicalVisitWorkspaceController(options: {
  file: CloudClinicalWorkspaceController;
  getCatalog: () => Promise<CloudServiceCatalogRecord | null>;
  isActive: () => boolean;
  newId?: () => string;
}) {
  let state = empty(), epoch = 0, closed = false, checking = false, working = false;
  let editor: CloudCatalogVisitDraft | null = null, origin: CloudClinicalPatientSnapshot | null = null;
  let ownsDirty = false, claiming = false, launching = false, operationId: string | null = null;
  let completedTicket: number | null = null;
  let releasing = false, releaseObserved = false;
  let manualTeeth: readonly string[] = [];
  let unsubscribe: (() => void) | null = null, synchronizing = false, syncAgain = false;
  const listeners = new Set<(value: CloudClinicalVisitWorkspaceState) => void>();
  function publish(next: CloudClinicalVisitWorkspaceState) {
    const published = Object.freeze(next); state = published;
    for (const listener of [...listeners]) { try { listener(published); } catch { /* Views grant no authority. */ } }
  }
  function dispose() {
    if (closed) return;
    closed = true; ++epoch; editor = null; origin = null; ownsDirty = false; operationId = null; completedTicket = null; manualTeeth = [];
    const off = unsubscribe; unsubscribe = null;
    try { off?.(); } catch { /* Memory must still be revoked. */ }
    publish(empty(true)); listeners.clear();
  }
  function active(ticket = epoch): boolean {
    if (closed || ticket !== epoch || checking) return false;
    let allowed = false; checking = true;
    try { allowed = options.isActive() === true; } catch { /* Fail closed. */ } finally { checking = false; }
    if (closed || ticket !== epoch) return false;
    if (!allowed) { dispose(); return false; }
    return true;
  }
  function readFile(ticket = epoch): CloudClinicalWorkspaceState | null {
    if (!active(ticket)) return null;
    let value: CloudClinicalWorkspaceState;
    try { value = options.file.getState(); } catch { dispose(); return null; }
    if (!active(ticket)) return null;
    if (value.closed) { dispose(); return null; }
    return value;
  }
  const idleFile = (value: CloudClinicalWorkspaceState) => value.loaded && !!value.snapshot && !value.loading
    && value.saveStatus === 'idle' && value.pendingOperationId === null;
  function abandon(error = '', completed = false) {
    completedTicket = completed ? epoch : null;
    ++epoch; editor = null; origin = null; ownsDirty = false; operationId = null; manualTeeth = [];
    if (!closed) publish(empty(false, error));
  }
  function synchronize(observed?: CloudClinicalWorkspaceState) {
    if (closed || !origin) return;
    if (releasing && observed?.snapshot === origin && !observed.draftDirty) releaseObserved = true;
    if (!claiming && ownsDirty && operationId === null && observed?.snapshot === origin && !observed.draftDirty) {
      abandon(CHANGED); return;
    }
    if (synchronizing) { syncAgain = true; return; }
    synchronizing = true;
    try {
      let rounds = 0;
      do {
        syncAgain = false;
        const current = readFile();
        if (!current || !origin) break;
        if (releasing && releaseObserved && current.draftDirty) { abandon(CHANGED); break; }
        // A subscriber may inspect the published loading state before the
        // explicit dirty claim. No lock exists yet to invalidate or release.
        if (state.phase === 'loading' && !ownsDirty) break;
        if (current.pendingOperationId !== null) {
          if (launching && operationId === null) operationId = current.pendingOperationId;
          if (operationId !== current.pendingOperationId) { abandon(CHANGED); break; }
          const phase = !current.loading && !working
            && (current.saveStatus === 'retry-required' || current.saveStatus === 'refresh-required') ? 'pending' : 'submitting';
          if (state.phase !== phase) publish({ ...state, phase, error: current.error });
        } else if (operationId !== null && current.saveStatus === 'idle' && !current.loading && !current.draftDirty) {
          // Both confirmed save+refresh and confirmed cancellation clear the
          // file's original operation. Never turn this into another visit.
          abandon('', true); break;
        } else if (!claiming && (current.snapshot !== origin || !idleFile(current) || !current.draftDirty)) {
          abandon(CHANGED); break;
        }
        if (++rounds > 8) { dispose(); break; }
      } while (syncAgain && !closed);
    } finally { synchronizing = false; }
  }
  function ensureSubscription() {
    if (unsubscribe) return;
    const off = options.file.subscribe(synchronize);
    if (closed) { try { off(); } catch { /* Already revoked. */ } }
    else unsubscribe = off;
  }
  function sameEditor(ticket: number, expected: CloudCatalogVisitDraft | null, phase: CloudClinicalVisitWorkspaceState['phase']) {
    return active(ticket) && state.phase === phase && editor === expected && origin !== null;
  }
  const phaseIs = (phase: CloudClinicalVisitWorkspaceState['phase']) => state.phase === phase;
  function releaseDirty(ticket: number): boolean {
    const selected = origin;
    if (!ownsDirty || !selected || !active(ticket)) return false;
    const current = readFile(ticket);
    if (!current || current.snapshot !== selected || !idleFile(current) || !current.draftDirty
      || !active(ticket) || origin !== selected || !ownsDirty) return false;
    // Relinquish before invoking a callback. A stale release never touches a
    // subsequently opened editor or an unrelated pending operation.
    ownsDirty = false; claiming = true; releasing = true; releaseObserved = false;
    try { options.file.setDraftDirty(selected.patientRecordId, false); } catch { /* Do not claim successful cancellation. */ }
    finally { claiming = false; releasing = false; }
    if (!active(ticket) || origin !== selected) return false;
    const after = readFile(ticket);
    if (!after || !active(ticket) || origin !== selected || after.snapshot !== selected || !idleFile(after)) return false;
    if (!after.draftDirty) return true;
    ownsDirty = true;
    return false;
  }
  function failOpening(ticket: number, message: string) {
    if (!active(ticket)) return;
    if (ownsDirty) {
      if (!releaseDirty(ticket)) {
        if (active(ticket) && ownsDirty) publish({ ...state, error: `${message} ${RELEASE}` });
        return;
      }
    }
    if (active(ticket)) abandon(message);
  }
  async function begin(snapshot: CloudClinicalPatientSnapshot): Promise<boolean> {
    if (!active() || working || state.phase !== 'idle') return false;
    working = true;
    let ticket = epoch;
    try {
      const current = readFile(ticket);
      if (!current || !idleFile(current) || current.draftDirty || current.snapshot !== snapshot
        || current.patientRecordId !== snapshot?.patientRecordId || !active(ticket) || state.phase !== 'idle') return false;
      ticket = ++epoch; origin = snapshot; completedTicket = null;
      publish({ ...empty(), phase: 'loading', snapshot });
      if (!active(ticket) || origin !== snapshot || !phaseIs('loading')) return false;
      ensureSubscription();
      if (!active(ticket) || origin !== snapshot || !phaseIs('loading')) return false;
      claiming = true;
      let claimed = false;
      try { claimed = options.file.setDraftDirty(snapshot.patientRecordId, true) === true; }
      finally { claiming = false; }
      if (!active(ticket) || origin !== snapshot || !phaseIs('loading')) return false;
      ownsDirty = claimed;
      const locked = readFile(ticket);
      if (!claimed || !locked || locked.snapshot !== snapshot || !idleFile(locked) || !locked.draftDirty
        || !active(ticket) || origin !== snapshot) { failOpening(ticket, CHANGED); return false; }
    } catch {
      failOpening(ticket, CHANGED);
      return false;
    } finally { working = false; }
    try {
      if (!active(ticket) || origin !== snapshot || !phaseIs('loading')) return false;
      const record = await options.getCatalog();
      if (!active(ticket) || origin !== snapshot || !phaseIs('loading')) return false;
      const locked = readFile(ticket);
      if (!active(ticket) || origin !== snapshot || !phaseIs('loading')) return false;
      if (!locked || locked.snapshot !== snapshot || !idleFile(locked) || !locked.draftDirty || !ownsDirty) throw new Error('changed');
      if (record === null) throw new Error('missing');
      const created = createCloudCatalogVisitDraft(record, { newId: () => {
        if (!sameEditor(ticket, created, 'editing')) throw new Error('revoked');
        const generated = (options.newId ?? (() => crypto.randomUUID()))();
        if (!sameEditor(ticket, created, 'editing')) throw new Error('revoked');
        const current = readFile(ticket);
        if (!current || current.snapshot !== snapshot || !idleFile(current) || !current.draftDirty
          || !sameEditor(ticket, created, 'editing')) throw new Error('revoked');
        return generated;
      } });
      if (!active(ticket) || origin !== snapshot || !phaseIs('loading')) return false;
      editor = created;
      publish({ ...state, phase: 'editing', catalog: created.getCatalog(), draft: created.getState(), error: '' });
      return sameEditor(ticket, created, 'editing');
    } catch {
      failOpening(ticket, 'تعذر قراءة قائمة أسعار مؤكدة. اضبط الخدمات والكشف في الإعدادات ثم أعد المحاولة.');
      return false;
    }
  }
  function mutate(work: (draft: CloudCatalogVisitDraft) => void, manualInput?: { teeth: readonly string[] }): boolean {
    if (!active() || working || state.phase !== 'editing' || !editor) return false;
    const ticket = epoch, expected = editor;
    working = true;
    try {
      const current = readFile(ticket);
      if (!current || current.snapshot !== origin || !idleFile(current) || !current.draftDirty || !ownsDirty
        || !sameEditor(ticket, expected, 'editing')) return false;
      // Stage the entire mutation off-screen. The core intentionally retains
      // aggregate tooth selections, but this row-oriented editor must remove
      // a row-derived tooth when its last row changes or disappears. Explicit
      // setTeeth selections are tracked independently and remain selected.
      const source = expected.getState(), selected = origin;
      let nextManual = manualTeeth;
      if (manualInput !== undefined) {
        const validator = createCloudCatalogVisitDraft(expected.getCatalog());
        validator.setTeeth(manualInput.teeth);
        nextManual = validator.getState().teethIds;
      }
      let replayIndex = 0, replaying = true, building = true;
      const candidate = createCloudCatalogVisitDraft(expected.getCatalog(), { newId: () => {
        const owned = building ? expected : candidate;
        if (!sameEditor(ticket, owned, 'editing') || origin !== selected) throw new Error('revoked');
        if (replaying) return source.services[replayIndex++].id;
        const generated = (options.newId ?? (() => crypto.randomUUID()))();
        if (!sameEditor(ticket, owned, 'editing') || origin !== selected) throw new Error('revoked');
        const latest = readFile(ticket);
        if (!latest || latest.snapshot !== selected || !idleFile(latest) || !latest.draftDirty
          || !sameEditor(ticket, owned, 'editing')) throw new Error('revoked');
        return generated;
      } });
      for (const row of source.services) {
        candidate.chooseService(row.catalogServiceId);
        candidate.setServicePrice(row.id, row.priceCents);
        candidate.setServiceTooth(row.id, row.tooth);
      }
      candidate.setExaminationEnabled(source.examinationEnabled);
      replaying = false;
      work(candidate);
      const teeth = [...nextManual];
      for (const row of candidate.getState().services) if (row.tooth !== null && !teeth.includes(row.tooth)) teeth.push(row.tooth);
      candidate.setTeeth(teeth);
      if (!sameEditor(ticket, expected, 'editing')) return false;
      const after = readFile(ticket);
      if (!after || after.snapshot !== origin || !idleFile(after) || !after.draftDirty
        || !sameEditor(ticket, expected, 'editing')) return false;
      editor = candidate; manualTeeth = nextManual; building = false;
      publish({ ...state, draft: candidate.getState(), error: '' });
      return sameEditor(ticket, candidate, 'editing');
    } catch {
      if (sameEditor(ticket, expected, 'editing')) publish({ ...state, error: REVIEW });
      return false;
    } finally { working = false; }
  }
  async function save(metadata: CloudCatalogVisitMetadata, paidCents: number): Promise<boolean> {
    if (!active() || working || state.phase !== 'editing' || !editor || !origin) return false;
    const ticket = epoch, expected = editor, selected = origin;
    working = true;
    let session;
    try {
      const current = readFile(ticket);
      if (!current || current.snapshot !== selected || !idleFile(current) || !current.draftDirty || !ownsDirty
        || !sameEditor(ticket, expected, 'editing')) return false;
      session = expected.buildSession(metadata);
      const charged = session.services.reduce((sum, row) => sum + row.priceCents, session.examinationCents);
      if (!Number.isSafeInteger(paidCents) || Object.is(paidCents, -0) || paidCents < 0
        || paidCents > charged || paidCents > MAX_CLOUD_CLINICAL_CENTS) throw new Error('invalid');
      if (!sameEditor(ticket, expected, 'editing')) return false;
      publish({ ...state, phase: 'submitting', error: '' });
      if (!sameEditor(ticket, expected, 'submitting')) return false;
      const before = readFile(ticket);
      if (!before || before.snapshot !== selected || !idleFile(before) || !before.draftDirty
        || !sameEditor(ticket, expected, 'submitting')) return false;
      launching = true;
      let result: Promise<boolean>;
      try { result = options.file.saveVisit(selected.patientRecordId, session, paidCents); }
      finally { launching = false; }
      working = false;
      const saved = await result;
      if (completedTicket === ticket) return saved && active();
      if (!active(ticket)) return false;
      synchronize();
      if (completedTicket === ticket) return saved && active();
      if (!active(ticket)) return false;
      if (operationId === null && editor === expected && phaseIs('submitting')) {
        publish({ ...state, phase: 'editing', error: REVIEW });
      }
      return saved;
    } catch {
      if (active(ticket) && editor === expected && operationId === null) publish({ ...state, phase: 'editing', error: REVIEW });
      return false;
    } finally { working = false; launching = false; }
  }
  function cancel(): boolean {
    if (!active() || working || !['loading', 'editing'].includes(state.phase) || operationId !== null) return false;
    const ticket = epoch;
    working = true;
    try {
      const released = releaseDirty(ticket);
      if (!active(ticket)) return false;
      if (!released) { if (ownsDirty) publish({ ...state, error: RELEASE }); return false; }
      abandon(); return true;
    }
    finally { working = false; }
  }
  async function resolvePending(cancelled: boolean): Promise<boolean> {
    if (!active() || working || state.phase !== 'pending' || !operationId) return false;
    const ticket = epoch, submitted = operationId;
    working = true;
    try {
      const current = readFile(ticket);
      if (!current || current.pendingOperationId !== submitted || current.loading
        || !['retry-required', 'refresh-required'].includes(current.saveStatus) || !active(ticket)) return false;
      publish({ ...state, phase: 'submitting', error: '' });
      if (!active(ticket) || operationId !== submitted || !phaseIs('submitting')) return false;
      const pending = cancelled ? options.file.cancelPending() : options.file.retry();
      working = false;
      const result = await pending;
      if (closed) return false;
      synchronize();
      return result && (completedTicket === ticket ? active() : active(ticket));
    } catch {
      if (active(ticket)) publish({ ...state, phase: 'pending', error: 'تعذر التحقق من العملية الأصلية؛ لم ننشئ زيارة بديلة.' });
      return false;
    } finally { working = false; }
  }
  return {
    getState: () => { active(); synchronize(); return state; },
    subscribe(listener: (value: CloudClinicalVisitWorkspaceState) => void) {
      if (!active() || typeof listener !== 'function') return () => undefined;
      listeners.add(listener); return () => { listeners.delete(listener); };
    },
    begin,
    chooseService: (id: string) => mutate(draft => { draft.chooseService(id); }),
    removeService: (id: string) => mutate(draft => { draft.removeService(id); }),
    setServicePrice: (id: string, cents: number | null) => mutate(draft => { draft.setServicePrice(id, cents); }),
    setServiceTooth: (id: string, tooth: string | null) => mutate(draft => { draft.setServiceTooth(id, tooth); }),
    setTeeth: (teeth: readonly string[]) => mutate(() => undefined, { teeth }),
    setExaminationEnabled: (enabled: boolean) => mutate(draft => { draft.setExaminationEnabled(enabled); }),
    save, cancel, retry: () => resolvePending(false), cancelPending: () => resolvePending(true), dispose,
  };
}
export type CloudClinicalVisitWorkspaceController = ReturnType<typeof createCloudClinicalVisitWorkspaceController>;
