import { prepareCloudClinicalCommand } from './cloudClinicalRepository';
import { parseCloudOperationIntent, prepareCloudIntentCommand, type CloudOperationIntent } from './cloudOperationIntent';
import type { CloudClinicalCapability } from './cloudClinicalWorkspaceController';

export type CloudClinicalRecoveryState = Readonly<{
  records: readonly CloudOperationIntent[]; loaded: boolean; loading: boolean;
  nextAfterId: string | null; error: string; notice: string; closed: boolean;
}>;
const PAGE_SIZE = 25;
export const MAX_CLOUD_CLINICAL_RECOVERY_RECORDS = 2000;
const validId = (value: unknown): value is string => typeof value === 'string' && value.length === 36
  && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error();
  const found = Reflect.ownKeys(value);
  if (found.length !== keys.length || found.some(key => typeof key !== 'string' || !keys.includes(key))) throw new Error();
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) throw new Error();
    result[key] = descriptor.value;
  }
  return result;
}
function checkedPage(value: unknown, afterId: string | null, actorUid: string | null) {
  const page = exact(value, ['records', 'nextAfterId']);
  if (!Array.isArray(page.records) || page.records.length > PAGE_SIZE
    || Reflect.ownKeys(page.records).length !== page.records.length + 1) throw new Error();
  const records: CloudOperationIntent[] = []; let previous = afterId, actor = actorUid;
  for (let index = 0; index < page.records.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(page.records, String(index));
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) throw new Error();
    const intent = parseCloudOperationIntent(descriptor.value);
    const command = prepareCloudClinicalCommand(intent.command);
    if (intent.kind !== 'clinical' || intent.createdAt !== command.createdAt
      || intent.operationId !== command.operationId || previous !== null && intent.operationId <= previous
      || actor !== null && intent.actorUid !== actor
      || JSON.stringify(intent.command) !== JSON.stringify(prepareCloudIntentCommand(command))) throw new Error();
    records.push(intent); previous = intent.operationId; actor = intent.actorUid;
  }
  const expectedAfterId = records.length === PAGE_SIZE ? previous : null;
  if (page.nextAfterId !== expectedAfterId || page.nextAfterId !== null && !validId(page.nextAfterId)) throw new Error();
  return { records, nextAfterId: page.nextAfterId as string | null, actorUid: actor };
}

/** Read-only clinical operation history, INCLUDING committed lost-ACK records.
 * It is UUID ordered, not globally recent. SDK checks exact owner and
 * current membership; this view additionally validates every complete clinical
 * command and ordered page. No cancellation, replay or financial writes here. */
export function createCloudClinicalRecoveryController(options: {
  getCapability: () => Promise<CloudClinicalCapability>; isActive: () => boolean;
}) {
  let state: CloudClinicalRecoveryState = freeze({ records: [], loaded: false, loading: false,
    nextAfterId: null, error: '', notice: '', closed: false });
  let epoch = 0, closed = false, capability: CloudClinicalCapability | null = null, actorUid: string | null = null;
  const listeners = new Set<(value: CloudClinicalRecoveryState) => void>();
  function publish(value: CloudClinicalRecoveryState) {
    state = freeze(value);
    for (const listener of [...listeners]) { try { listener(state); } catch { /* Views grant no authority. */ } }
  }
  function dispose() {
    if (closed) return;
    closed = true; ++epoch; capability = null; actorUid = null;
    publish({ records: [], loaded: false, loading: false, nextAfterId: null, error: '', notice: '', closed: true });
    listeners.clear();
  }
  function active(ticket = epoch) {
    if (closed || ticket !== epoch) return false;
    let allowed = false; try { allowed = options.isActive() === true; } catch { /* Fail closed. */ }
    if (closed || ticket !== epoch) return false;
    if (!allowed) { dispose(); return false; }
    return true;
  }
  async function load(more: boolean): Promise<void> {
    if (!active() || state.loading || more && (!state.loaded || state.nextAfterId === null)) return;
    const afterId = more ? state.nextAfterId : null, ticket = ++epoch;
    if (!more) actorUid = null;
    publish({ ...state, ...(more ? {} : { records: [], loaded: false, nextAfterId: null }), loading: true, error: '', notice: '' });
    try {
      if (!active(ticket)) return;
      if (!capability) {
        const created = await options.getCapability(); if (!active(ticket)) return; capability = created;
      }
      const journal = capability.journal; if (!active(ticket)) return;
      const list = journal.listHistoryPage; if (!active(ticket)) return;
      if (typeof list !== 'function') throw new Error(); // No prepared-only fallback.
      const raw = await list.call(journal, 'clinical', { afterId, limit: PAGE_SIZE }); if (!active(ticket)) return;
      const page = checkedPage(raw, afterId, actorUid); if (!active(ticket)) return;
      const records = more ? [...state.records, ...page.records] : page.records;
      if (records.length > MAX_CLOUD_CLINICAL_RECOVERY_RECORDS) {
        publish({ ...state, loading: false, error: 'تجاوزت قائمة العمليات حد العرض البالغ ٢٠٠٠ عملية؛ القائمة غير مكتملة ولم تُحذف أو تُنفذ أي عملية.',
          notice: 'المعروض هو الجزء المحمّل فقط، وليس جميع عمليات العيادة.' });
        return;
      }
      actorUid = page.actorUid;
      publish({ ...state, records, loaded: true, loading: false, nextAfterId: page.nextAfterId, error: '',
        notice: page.nextAfterId === null ? 'وصلنا إلى نهاية الصفحات المقروءة بترتيب المعرف، وليس ترتيب الأحدث. حدّث القائمة لالتقاط عمليات جديدة وراجع حالتها قبل استئنافها.'
          : `تم تحميل ${records.length} عملية. القائمة جزئية؛ حمّل المزيد لعرض العمليات التالية.` });
    } catch {
      if (active(ticket)) publish({ ...state, loading: false, error: 'تعذر قراءة عمليات الاسترجاع المؤكدة. أعد المحاولة؛ لم تُنفذ أو تُلغَ أي عملية.',
        notice: more && state.records.length ? 'المعروض هو الجزء المحمّل فقط، وليس جميع عمليات العيادة.' : '' });
    }
  }
  return {
    getState: () => { active(); return state; },
    subscribe: (listener: (value: CloudClinicalRecoveryState) => void) => {
      if (!active()) return () => undefined;
      listeners.add(listener); return () => { listeners.delete(listener); };
    },
    loadFirst: () => load(false), loadMore: () => load(true), dispose,
  };
}
export type CloudClinicalRecoveryController = ReturnType<typeof createCloudClinicalRecoveryController>;
