import { CloudAppointmentError, parseCloudAppointmentDay, parseCloudAppointmentRecord,
  prepareCloudAppointmentDayPageInput, type CloudAppointmentDay, type CloudAppointmentRecord,
  type CloudAppointmentRepository } from './cloudAppointmentRepository';

export interface CloudAppointmentDaySnapshot {
  date: string; revision: number; index: CloudAppointmentDay | null;
  records: readonly CloudAppointmentRecord[];
}
export const MAX_CLOUD_APPOINTMENT_DAY_HISTORY = 2000;
const occupied = new Set(['scheduled', 'confirmed', 'waiting', 'attended']);
const fail = (): never => { throw new CloudAppointmentError('unavailable'); };
const freeze = <T>(value: T): T => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};

/** Complete server-backed day, not one page or the occupied slot index. Every
 * record mutation MUST advance the affected day revision (including inactive
 * bookings) in the same transaction. Combined Rules must enforce that fence. */
export async function loadCloudAppointmentDay(repository: CloudAppointmentRepository, date: string,
  assertActive: () => void = () => undefined): Promise<CloudAppointmentDaySnapshot> {
  try {
    const query = prepareCloudAppointmentDayPageInput({ date, limit: 50 });
    const read = async <T>(work: () => Promise<T>): Promise<T> => {
      assertActive(); const result = await work(); assertActive(); return result;
    };
    const firstRaw = await read(() => repository.getDay(query.date));
    const first = firstRaw === null ? null : parseCloudAppointmentDay(firstRaw);
    if (first && first.recordId !== query.date) fail();
    const records: CloudAppointmentRecord[] = [];
    let afterId: string | null = null;
    do {
      const page = await read(() => repository.listDayPage({ date: query.date, afterId, limit: 50 }));
      if (!page || typeof page !== 'object' || Array.isArray(page)
        || ![Object.prototype, null].includes(Object.getPrototypeOf(page))) fail();
      const keys = Reflect.ownKeys(page);
      if (keys.length !== 2 || !keys.includes('records') || !keys.includes('nextAfterId')) fail();
      const rows = Object.getOwnPropertyDescriptor(page, 'records'), cursor = Object.getOwnPropertyDescriptor(page, 'nextAfterId');
      if (!rows || !cursor || !('value' in rows) || !('value' in cursor) || !rows.enumerable || !cursor.enumerable
        || !Array.isArray(rows.value) || rows.value.length > 50 || Reflect.ownKeys(rows.value).length !== rows.value.length + 1) fail();
      let previous = afterId;
      for (let i = 0; i < rows.value.length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(rows.value, String(i));
        if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) fail();
        const record = parseCloudAppointmentRecord(descriptor.value);
        if (record.data.date !== query.date || previous !== null && record.recordId <= previous) fail();
        records.push(record); previous = record.recordId;
        if (records.length > MAX_CLOUD_APPOINTMENT_DAY_HISTORY) fail();
      }
      const next = rows.value.length === 50 ? previous : null;
      if (cursor.value !== next) fail();
      afterId = next;
    } while (afterId !== null);
    const lastRaw = await read(() => repository.getDay(query.date));
    const last = lastRaw === null ? null : parseCloudAppointmentDay(lastRaw);
    if (JSON.stringify(first) !== JSON.stringify(last)) throw new CloudAppointmentError('conflict');
    if (last === null && records.length > 0) fail();
    const slots = records.filter(record => occupied.has(record.data.status)).map(record => {
      const startMinute = Number(record.data.time.slice(0, 2)) * 60 + Number(record.data.time.slice(3, 5));
      return { recordId: record.recordId, startMinute, endMinute: startMinute + record.data.durationMinutes };
    });
    if (last?.slotIndexVersion === 2) slots.sort((a, b) => a.startMinute - b.startMinute);
    if (JSON.stringify(slots) !== JSON.stringify(last?.slots ?? [])) fail();
    assertActive();
    return freeze({ date: query.date, revision: last?.revision ?? 0, index: last,
      records: [...records].sort((a, b) => a.data.time.localeCompare(b.data.time) || a.recordId.localeCompare(b.recordId)) });
  } catch (error) {
    let changed = false;
    try { changed = error instanceof CloudAppointmentError && error.code === 'conflict'; } catch { /* No provider detail. */ }
    if (changed) throw new CloudAppointmentError('conflict');
    return fail();
  }
}
