import { CloudAppointmentError, prepareCloudAppointmentCommand, parseCloudAppointmentRecord,
  parseCloudAppointmentDay, prepareCloudAppointmentDayPageInput, type CloudAppointmentRepository } from './cloudAppointmentRepository';
import { CloudOperationIntentError, parseCloudOperationIntent, prepareCloudIntentCommand,
  type CloudOperationIntentRepository } from './cloudOperationIntent';

/** Bound operating-session facade. No SDK, clock, IDs, storage or automatic reads.
 * Construction is inert; every action snapshots inputs before authorization.
 * Caller supplies the exact uninterrupted session lease, not a cached UID flag. */
export interface CloudAppointmentCapability {
  repository: CloudAppointmentRepository; journal: CloudOperationIntentRepository;
}
export function createCloudAppointmentOperatingCapability(options: {
  capability: CloudAppointmentCapability; actorUid: string;
  requireActive(): void; authorizeOwner(): Promise<void>;
}): CloudAppointmentCapability {
  const { capability, actorUid, requireActive, authorizeOwner } = options;
  const invalid = (): never => { throw new CloudOperationIntentError('invalid'); };
  const uuid = (value: unknown): value is string => typeof value === 'string' && value.length === 36
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
  const id = (value: unknown) => { if (!uuid(value)) return invalid(); return value; };
  const kind = (value: unknown) => { if (value !== 'appointment') invalid(); };
  const day = (value: unknown): string => {
    if (typeof value !== 'string' || value.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(value)
      || value < '1900-01-01' || value > '9999-12-31') return invalid();
    const date = new Date(`${value}T12:00:00.000Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return invalid();
    return value;
  };
  const run = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      requireActive(); await authorizeOwner(); requireActive();
      const result = await work(); requireActive();
      await authorizeOwner(); requireActive(); return result;
    } catch (error) {
      let safe: Error = new CloudAppointmentError('unavailable');
      try {
        if (error instanceof CloudAppointmentError && ['invalid', 'conflict', 'unavailable'].includes(error.code)) {
          safe = new CloudAppointmentError(error.code);
        }
        if (error instanceof CloudOperationIntentError && ['invalid', 'conflict', 'unavailable'].includes(error.code)) {
          safe = new CloudOperationIntentError(error.code);
        }
      } catch { /* Do not reflect provider objects or arbitrary Proxy failures. */ }
      throw safe;
    }
  };
  const checkedIntent = (value: unknown, expectedId?: string, expectedCommand?: object) => {
    const intent = parseCloudOperationIntent(value);
    const command = prepareCloudAppointmentCommand(intent.command);
    if (intent.kind !== 'appointment' || intent.actorUid !== actorUid || expectedId !== undefined && intent.operationId !== expectedId
      || command.createdAt !== intent.createdAt || JSON.stringify(prepareCloudIntentCommand(command)) !== JSON.stringify(intent.command)
      || expectedCommand !== undefined && JSON.stringify(expectedCommand) !== JSON.stringify(intent.command)) invalid();
    return intent;
  };
  const pageInput = (value: unknown) => {
    try {
      const source = value === undefined ? {} : value;
      if (!source || typeof source !== 'object' || Array.isArray(source)
        || ![Object.prototype, null].includes(Object.getPrototypeOf(source))) return invalid();
      const keys = Reflect.ownKeys(source), copy: Record<string, unknown> = {};
      if (keys.some(key => typeof key !== 'string' || !['afterId', 'limit'].includes(key))) return invalid();
      for (const key of keys as string[]) {
        const descriptor = Object.getOwnPropertyDescriptor(source, key);
        if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return invalid();
        copy[key] = descriptor.value;
      }
      const afterId = copy.afterId === undefined ? null : copy.afterId, limit = copy.limit === undefined ? 25 : copy.limit;
      if (afterId !== null && !uuid(afterId) || typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 50) return invalid();
      return { afterId: afterId as string | null, limit };
    } catch { return invalid(); }
  };
  const repository = Object.freeze({
    get: async (recordId: string) => {
      const prepared = id(recordId);
      return run(async () => {
        const raw = await capability.repository.get(prepared);
        if (raw === null) return null;
        const record = parseCloudAppointmentRecord(raw);
        if (record.recordId !== prepared) invalid(); return record;
      });
    },
    getDay: async (date: string) => {
      const prepared = day(date);
      return run(async () => {
        const raw = await capability.repository.getDay(prepared);
        if (raw === null) return null;
        const record = parseCloudAppointmentDay(raw);
        if (record.recordId !== prepared) invalid(); return record;
      });
    },
    listDayPage: async input => {
      const query = prepareCloudAppointmentDayPageInput(input);
      return run(async () => {
        const page = await capability.repository.listDayPage(query);
        if (!page || !Array.isArray(page.records) || page.records.length > query.limit
          || Reflect.ownKeys(page.records).length !== page.records.length + 1) return invalid();
        let previous = query.afterId;
        const records = Array.from({ length: page.records.length }, (_, index) => {
          const property = Object.getOwnPropertyDescriptor(page.records, String(index));
          if (!property || !('value' in property) || !property.enumerable) return invalid();
          const record = parseCloudAppointmentRecord(property.value);
          if (record.data.date !== query.date || previous !== null && record.recordId <= previous) return invalid();
          previous = record.recordId; return record;
        });
        if (page.nextAfterId !== (records.length === query.limit ? previous : null)) return invalid();
        return { records, nextAfterId: page.nextAfterId };
      });
    },
    commit: async (input: unknown) => {
      const command = prepareCloudAppointmentCommand(input);
      return run(async () => {
        const raw = await capability.repository.commit(command);
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)
          || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) return invalid();
        const keys = Reflect.ownKeys(raw);
        if (keys.length !== 3 || keys.some(key => !['status', 'recordId', 'revision'].includes(key as string))) return invalid();
        const copy: Record<string, unknown> = {};
        for (const key of keys as string[]) {
          const property = Object.getOwnPropertyDescriptor(raw, key);
          if (!property || !('value' in property) || !property.enumerable) return invalid();
          copy[key] = property.value;
        }
        if (!['committed', 'already-committed'].includes(copy.status as string) || copy.recordId !== command.recordId
          || copy.revision !== command.expectedRevision + 1) return invalid();
        return { status: copy.status as 'committed' | 'already-committed', recordId: command.recordId, revision: command.expectedRevision + 1 };
      });
    },
  } satisfies CloudAppointmentRepository);
  const list = async (requestedKind: unknown, input: unknown, history: boolean) => {
    kind(requestedKind); const prepared = pageInput(input);
    return run(async () => {
      const method = history ? capability.journal.listHistoryPage : capability.journal.listPreparedPage;
      if (typeof method !== 'function') throw new CloudOperationIntentError('unavailable');
      const page = await method.call(capability.journal, 'appointment', prepared);
      if (!page || !Array.isArray(page.records) || page.records.length > prepared.limit
        || Reflect.ownKeys(page.records).length !== page.records.length + 1) invalid();
      let previous = prepared.afterId;
      const records = Array.from({ length: page.records.length }, (_, index) => {
        const descriptor = Object.getOwnPropertyDescriptor(page.records, String(index));
        if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return invalid();
        const intent = checkedIntent(descriptor.value);
        if (previous !== null && intent.operationId <= previous || !history && intent.status !== 'prepared') invalid();
        previous = intent.operationId; return intent;
      });
      if (page.nextAfterId !== (records.length === prepared.limit ? previous : null)) invalid();
      return { records, nextAfterId: page.nextAfterId };
    });
  };
  const journal = Object.freeze({
    prepare: async (requestedKind, input, createdAt) => {
      kind(requestedKind); const command = prepareCloudAppointmentCommand(input), prepared = prepareCloudIntentCommand(command);
      if (createdAt !== command.createdAt) invalid();
      return run(async () => checkedIntent(await capability.journal.prepare('appointment', prepared, createdAt), command.operationId, prepared));
    },
    get: async operationId => {
      const prepared = id(operationId);
      return run(async () => {
        const value = await capability.journal.get(prepared);
        return value === null ? null : checkedIntent(value, prepared);
      });
    },
    cancel: async operationId => {
      const prepared = id(operationId);
      return run(async () => checkedIntent(await capability.journal.cancel(prepared), prepared));
    },
    listPreparedPage: (requestedKind, input) => list(requestedKind, input, false),
    listHistoryPage: (requestedKind, input) => list(requestedKind, input, true),
  } satisfies CloudOperationIntentRepository);
  return Object.freeze({ repository, journal });
}
