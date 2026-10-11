import { prepareCloudContactCommand } from './cloudContactRepository';
import { prepareCloudPatientCommand } from './cloudPatientRepository';
import { CloudOperationIntentError, parseCloudOperationIntent, prepareCloudIntentCommand,
  type CloudOperationIntentRepository, type CloudOperationKind } from './cloudOperationIntent';

type Kind = Extract<CloudOperationKind, 'contact' | 'patient-profile'>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function invalid(): never { throw new CloudOperationIntentError('invalid'); }
function unavailable(): never { throw new CloudOperationIntentError('unavailable'); }
function id(value: unknown): string {
  if (typeof value !== 'string' || value.length !== 36 || !UUID.test(value)) invalid();
  return value;
}
function fields(value: unknown, required: readonly string[], optional: readonly string[] = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  const keys = Reflect.ownKeys(value), result: Record<string, unknown> = {};
  if (required.some(key => !keys.includes(key)) || keys.some(key => typeof key !== 'string'
    || ![...required, ...optional].includes(key))) invalid();
  for (const key of keys as string[]) {
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (!property || !('value' in property) || !property.enumerable) invalid();
    result[key] = property.value;
  }
  return result;
}
function timestamp(value: unknown): string {
  if (typeof value !== 'string' || value.length !== 24 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    || value < '1900-01-01T00:00:00.000Z' || value > '9999-12-31T23:59:59.999Z') invalid();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) invalid();
  return value;
}
function pageInput(value: unknown) {
  const item = value === undefined ? {} : fields(value, [], ['afterId', 'limit']);
  const afterId = item.afterId === undefined || item.afterId === null ? null : id(item.afterId);
  const limit = item.limit === undefined ? 25 : item.limit;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 50) invalid();
  return { afterId, limit };
}

/** Pure outer Auth boundary, not a journal writer or deployment switch.
 * The SDK capability MUST validate domain envelopes inside transaction reads
 * before cancellation writes. Output validation here cannot undo such a write.
 * Commands retain legacy fingerprints; operation time is a separate envelope.
 * The supplied run owns fresh authorization and permanent lifetime revocation. */
export function createCloudProfileContactJournal(options: {
  kind: Kind; actorUid: string; journal?: CloudOperationIntentRepository;
  run: <T>(work: () => Promise<T>) => Promise<T>;
}): CloudOperationIntentRepository {
  const { kind, actorUid, journal, run } = options;
  if (!['contact', 'patient-profile'].includes(kind) || typeof actorUid !== 'string'
    || !actorUid || actorUid.length > 128 || actorUid !== actorUid.trim()
    || /[\u0000-\u001f\u007f]/u.test(actorUid) || typeof run !== 'function') invalid();
  const requireKind = (value: CloudOperationKind) => { if (value !== kind) invalid(); };
  const command = (value: unknown) => {
    try { return prepareCloudIntentCommand(kind === 'contact'
      ? prepareCloudContactCommand(value) : prepareCloudPatientCommand(value)); }
    catch { return invalid(); }
  };
  const checked = (value: unknown, expectedId?: string, expectedCommand?: object, expectedTime?: string) => {
    const intent = parseCloudOperationIntent(value);
    if (intent.kind !== kind || intent.actorUid !== actorUid || expectedId !== undefined && intent.operationId !== expectedId
      || expectedTime !== undefined && intent.createdAt !== expectedTime
      || JSON.stringify(command(intent.command)) !== JSON.stringify(intent.command)
      || expectedCommand !== undefined && JSON.stringify(intent.command) !== JSON.stringify(expectedCommand)) invalid();
    return intent;
  };
  const safe = async <T>(work: () => Promise<T>): Promise<T> => {
    try { return await work(); }
    catch (error) {
      let code: CloudOperationIntentError['code'] = 'unavailable';
      try {
        if (error instanceof CloudOperationIntentError && ['invalid', 'conflict', 'unavailable'].includes(error.code)) {
          code = error.code;
        }
      } catch { /* No provider or hostile accessor details escape. */ }
      throw new CloudOperationIntentError(code);
    }
  };
  const source = () => { if (!journal) unavailable(); return journal; };
  const list = (requestedKind: CloudOperationKind, input: unknown, history: boolean) => safe(async () => {
    requireKind(requestedKind); const prepared = pageInput(input);
    return run(async () => {
      const repository = source(), method = history ? repository.listHistoryPage : repository.listPreparedPage;
      if (!method) unavailable();
      const page = fields(await method.call(repository, kind, prepared), ['records', 'nextAfterId']);
      if (!Array.isArray(page.records) || page.records.length > prepared.limit
        || Reflect.ownKeys(page.records).length !== page.records.length + 1) invalid();
      let previous = prepared.afterId;
      const records = [];
      for (let index = 0; index < page.records.length; index++) {
        const property = Object.getOwnPropertyDescriptor(page.records, String(index));
        if (!property || !('value' in property) || !property.enumerable) invalid();
        const intent = checked(property.value);
        if (previous !== null && intent.operationId <= previous || !history && intent.status !== 'prepared') invalid();
        records.push(intent); previous = intent.operationId;
      }
      const nextAfterId = records.length === prepared.limit ? previous : null;
      if (page.nextAfterId !== nextAfterId) invalid();
      return { records, nextAfterId };
    });
  });
  return Object.freeze({
    prepare: (requestedKind, input, createdAt) => safe(async () => {
      requireKind(requestedKind); const prepared = command(input), time = timestamp(createdAt);
      return run(async () => {
        const intent = checked(await source().prepare(kind, prepared, time), prepared.operationId as string, prepared, time);
        if (intent.status === 'cancelled') throw new CloudOperationIntentError('conflict');
        return intent;
      });
    }),
    get: operationId => safe(async () => {
      const prepared = id(operationId);
      return run(async () => { const value = await source().get(prepared); return value === null ? null : checked(value, prepared); });
    }),
    listPreparedPage: (requestedKind, input) => list(requestedKind, input, false),
    listHistoryPage: (requestedKind, input) => list(requestedKind, input, true),
    cancel: operationId => safe(async () => {
      const prepared = id(operationId);
      return run(async () => {
        const result = checked(await source().cancel(prepared), prepared);
        if (result.status !== 'cancelled') throw new CloudOperationIntentError('conflict');
        return result;
      });
    }),
  });
}
