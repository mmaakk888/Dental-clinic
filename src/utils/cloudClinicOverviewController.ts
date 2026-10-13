import type { CloudClinicSnapshot } from './cloudClinicSnapshot';
import { CloudClinicOverviewError, filterCloudOverviewDirectory, packageCloudOverviewExport, projectCloudClinicOverview,
  validateCloudOverviewDay, validateCloudOverviewRange, type CloudClinicOverviewProjection, type CloudOverviewDirectoryFilter,
  type CloudOverviewExportFormat, type CloudOverviewRange } from './cloudClinicOverviewProjection';

export type CloudClinicOverviewTab = 'home' | 'directory' | 'finance' | 'export';
export interface CloudClinicOverviewState {
  tab: CloudClinicOverviewTab; range: Readonly<CloudOverviewRange>; directoryQuery: string; directoryFilter: CloudOverviewDirectoryFilter;
  directoryLimit: number; cashLimit: number; snapshot: CloudClinicSnapshot | null; projection: CloudClinicOverviewProjection | null;
  loading: boolean; exporting: boolean; error: string; notice: string; closed: boolean;
}
export interface CloudClinicOverviewExportTicket {
  readonly filename: string; readonly mime: string; readonly text: string; readonly readTime: string;
}
export interface CloudClinicOverviewOptions {
  getSnapshot(): Promise<{ readFull(): Promise<CloudClinicSnapshot> }>;
  isActive(): boolean;
  initialDate: string;
}
/** A full-snapshot view lease, not a storage/auth adapter. Construction, subscribe,
 * tab switches and rendering never initialize SDK or fetch data. */
export function createCloudClinicOverviewController(options: CloudClinicOverviewOptions) {
  const day = validateCloudOverviewDay(options.initialDate);
  let disposed = false, checkingLifetime = false, sequence = 0, viewVersion = 0;
  let state: Readonly<CloudClinicOverviewState> = Object.freeze({ tab: 'home', range: Object.freeze({ from: day, to: day }),
    directoryQuery: '', directoryFilter: 'all', directoryLimit: 50, cashLimit: 50, snapshot: null, projection: null,
    loading: false, exporting: false, error: '', notice: '', closed: false });
  const subscribers = new Set<(value: Readonly<CloudClinicOverviewState>) => void>();
  let exportTicket: { value: Readonly<CloudClinicOverviewExportTicket>; snapshot: CloudClinicSnapshot; viewVersion: number } | null = null;
  function dispose() {
    if (disposed) return;
    disposed = true; sequence++; invalidateTicket();
    publish({ snapshot: null, projection: null, loading: false, exporting: false, error: '', notice: '', closed: true }); subscribers.clear();
  }
  const active = () => { if (disposed || checkingLifetime) return false;
    checkingLifetime = true;
    let allowed = false; try { allowed = options.isActive() === true; } catch { /* A view callback grants no authority. */ }
    finally { checkingLifetime = false; }
    if (!allowed) dispose(); return !disposed && allowed;
  };
  const assert = () => { if (!active()) throw new CloudClinicOverviewError(); };
  function publish(changes: Partial<CloudClinicOverviewState>) {
    state = Object.freeze({ ...state, ...changes });
    const transition = state;
    for (const subscriber of [...subscribers]) { try { subscriber(transition); } catch { /* Observers cannot interrupt the owned transition. */ } }
  }
  const invalidateTicket = () => { exportTicket = null; viewVersion++; };
  const idle = () => active() && !state.loading && !state.exporting;
  function change(work: () => Partial<CloudClinicOverviewState>) {
    if (!idle()) return false;
    try { const next = work(); assert(); invalidateTicket(); publish({ ...next, error: '', notice: '' }); return active(); }
    catch { if (active()) publish({ error: new CloudClinicOverviewError().message }); return false; }
  }
  return Object.freeze({
    getState: () => { active(); return state; },
    subscribe(listener: (value: Readonly<CloudClinicOverviewState>) => void) { if (!active()) return () => undefined; subscribers.add(listener); return () => { subscribers.delete(listener); }; },
    canClose: () => active() && !state.loading && !state.exporting,
    async refresh() {
      if (!idle()) return false;
      invalidateTicket(); const ticket = ++sequence;
      publish({ loading: true, error: '', notice: '' });
      try {
        assert(); const capability = await options.getSnapshot(); assert();
        if (ticket !== sequence) throw new CloudClinicOverviewError();
        const snapshot = await capability.readFull(); assert();
        if (ticket !== sequence) throw new CloudClinicOverviewError();
        const projection = projectCloudClinicOverview(snapshot, state.range); assert();
        publish({ snapshot, projection, loading: false, directoryLimit: 50, cashLimit: 50,
          notice: 'تم تحميل نسخة كاملة ومتسقة. لا تتغير هذه الأرقام تلقائيًا؛ استخدم تحديث البيانات لقراءة أحدث نسخة.' });
        return active() && state.snapshot === snapshot;
      } catch {
        if (active() && ticket === sequence) publish({ loading: false, error: new CloudClinicOverviewError().message,
          notice: state.snapshot ? 'المعروض هو آخر نسخة مؤكدة بتاريخها، وليس نتيجة التحديث الذي فشل.' : '' });
        return false;
      }
    },
    setTab(tab: CloudClinicOverviewTab) { return change(() => {
      if (!['home', 'directory', 'finance', 'export'].includes(tab)) throw new CloudClinicOverviewError(); return { tab };
    }); },
    setRange(range: CloudOverviewRange) { return change(() => {
      const checked = validateCloudOverviewRange(range);
      return { range: checked, cashLimit: 50, projection: state.snapshot ? projectCloudClinicOverview(state.snapshot, checked) : null };
    }); },
    setDirectoryQuery(query: string) { return change(() => {
      if (typeof query !== 'string' || query.length > 200) throw new CloudClinicOverviewError(); return { directoryQuery: query, directoryLimit: 50 };
    }); },
    setDirectoryFilter(filter: CloudOverviewDirectoryFilter) { return change(() => {
      if (!['all', 'files', 'nofiles'].includes(filter)) throw new CloudClinicOverviewError(); return { directoryFilter: filter, directoryLimit: 50 };
    }); },
    showMoreDirectory() { return change(() => ({ directoryLimit: Math.min(state.directoryLimit + 50,
      state.projection ? filterCloudOverviewDirectory(state.projection, state.directoryQuery, state.directoryFilter).length : 50) })); },
    showMoreCash() { return change(() => ({ cashLimit: Math.min(state.cashLimit + 50, state.projection?.cash.length ?? 50) })); },
    async prepareExport(format: CloudOverviewExportFormat, expectedSnapshot: CloudClinicSnapshot): Promise<Readonly<CloudClinicOverviewExportTicket> | null> {
      if (!idle() || !state.snapshot || state.snapshot !== expectedSnapshot || !state.projection) return null;
      const snapshot = state.snapshot, projection = state.projection, version = viewVersion, ticket = ++sequence;
      exportTicket = null; publish({ exporting: true, error: '', notice: '' });
      const valid = () => { assert(); if (sequence !== ticket || viewVersion !== version || state.snapshot !== snapshot || state.projection !== projection) throw new CloudClinicOverviewError(); };
      try {
        valid(); await options.getSnapshot(); valid(); // Fresh owner authorization, not another complete database scan.
        const packaged = packageCloudOverviewExport(snapshot, projection, format); valid();
        if (new TextEncoder().encode(packaged.text).byteLength > 128 * 1024 * 1024) throw new CloudClinicOverviewError();
        await options.getSnapshot(); valid();
        const value = Object.freeze({ ...packaged, readTime: snapshot.readTime });
        exportTicket = { value, snapshot, viewVersion: version };
        publish({ exporting: false, notice: 'التصدير من النسخة المؤكدة الظاهرة، وليس نسخة استعادة كاملة.' });
        valid(); if (exportTicket?.value !== value) throw new CloudClinicOverviewError(); return value;
      } catch {
        exportTicket = null;
        if (active() && ticket === sequence) publish({ exporting: false, error: 'تعذر تفويض التصدير أو تغيّرت النسخة؛ لم يبدأ تنزيل الملف.' });
        return null;
      }
    },
    /** The UI calls this synchronously immediately before clicking its download anchor. */
    consumeExport(expectedTicket: Readonly<CloudClinicOverviewExportTicket>) {
      if (!idle() || !exportTicket || expectedTicket !== exportTicket.value || state.snapshot !== exportTicket.snapshot || viewVersion !== exportTicket.viewVersion) return null;
      const result = exportTicket.value; exportTicket = null; return result;
    },
    dispose,
  });
}
export type CloudClinicOverviewController = ReturnType<typeof createCloudClinicOverviewController>;
