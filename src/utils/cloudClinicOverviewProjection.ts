import type { CloudClinicSnapshot } from './cloudClinicSnapshot';
import { parseCloudSnapshotReadTime } from './cloudClinicSnapshot';
import { buildClinicContactDirectory, clinicDirectoryRowMatchesSearch, prepareContactSearchQuery,
  normalizeContactPhone, createContactSearchEntry, type ClinicContactDirectoryRow } from './clinicContacts';

export type CloudOverviewDirectoryFilter = 'all' | 'files' | 'nofiles';
export interface CloudOverviewRange { from: string; to: string }
export interface CloudOverviewFile { patientRecordId: string; fileNo: number; name: string }
export interface CloudOverviewDirectoryRow {
  id: string; name: string; mobile: string; phone: string; files: readonly CloudOverviewFile[];
  /** Derived full-number matches are not identity or marketing consent. */
  searchSource: ClinicContactDirectoryRow;
}
export interface CloudOverviewCashRow {
  id: string; kind: 'patient' | 'lab' | 'expense'; date: string; createdAt: string;
  title: string; detail: string; amountCents: string; patientRecordId: string | null; fileNo: number | null;
}
export interface CloudClinicOverviewProjection {
  readTime: string; range: Readonly<CloudOverviewRange>;
  directory: readonly CloudOverviewDirectoryRow[];
  cash: readonly CloudOverviewCashRow[];
  totals: Readonly<{
    collectedCents: string; labPaidCents: string; expensePaidCents: string; netCashCents: string;
    chargedCents: string; expenseChargedCents: string; materialUsedCents: string; materialWasteCents: string;
    outstandingPatientCents: string; outstandingLabCents: string; outstandingExpenseCents: string;
    reservedForLabCents: string;
  }>;
  counts: Readonly<{ patients: number; entries: number; phones: number; phonesWithFiles: number; phonesWithoutFiles: number }>;
  appointments: readonly CloudClinicSnapshot['records']['appointmentRecords'][number][];
}
export class CloudClinicOverviewError extends Error {
  constructor() { super('تعذر تأكيد العرض الكامل للعيادة. حدّث البيانات وأعد المحاولة.'); this.name = 'CloudClinicOverviewError'; }
}
const fail = (): never => { throw new CloudClinicOverviewError(); };
export function validateCloudOverviewDay(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01') fail();
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fail();
  return value as string;
}
export function validateCloudOverviewRange(value: CloudOverviewRange): Readonly<CloudOverviewRange> {
  const from = validateCloudOverviewDay(value.from), to = validateCloudOverviewDay(value.to);
  if (from > to) fail(); return Object.freeze({ from, to });
}
const cent = (value: number) => { if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) fail(); return BigInt(value); };
const sum = <T>(values: readonly T[], amount: (value: T) => number) => values.reduce((total, value) => total + cent(amount(value)), 0n);
const frozen = <T>(value: T): T => { if (value && typeof value === 'object') { Object.values(value).forEach(frozen); Object.freeze(value); } return value; };
/** Never convert clinic-wide sums back to Number: multiple valid accounts can exceed its precision. */
export function formatCloudClinicCents(value: string): string {
  if (!/^-?(?:0|[1-9]\d*)$/.test(value) || value === '-0' || value.length > 100) fail();
  const amount = BigInt(value), absolute = amount < 0n ? -amount : amount;
  return `${amount < 0n ? '−' : ''}${(absolute / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${(absolute % 100n).toString().padStart(2, '0')} ج.م`;
}

/** Input is the protected reader's COMPLETE, reconciled, single-readTime snapshot.
 * Display pagination happens later and never changes the underlying totals. */
export function projectCloudClinicOverview(snapshot: CloudClinicSnapshot, input: CloudOverviewRange): CloudClinicOverviewProjection {
  const readTime = parseCloudSnapshotReadTime(snapshot.readTime), range = validateCloudOverviewRange(input);
  const inRange = (date: string) => date >= range.from && date <= range.to;
  const records = snapshot.records;
  const profiles = new Map(records.patientProfiles.map(row => [row.recordId, row]));
  const sessions = new Map(records.patientSessions.map(row => [row.sessionId, row]));
  const labs = new Map(records.labDefinitions.map(row => [row.recordId, row]));
  const expenses = new Map(records.expenseRecords.map(row => [row.recordId, row]));
  const contacts = records.contactRecords.flatMap(row => row.data ? [row.data] : []);
  const directorySource = buildClinicContactDirectory(contacts, records.patientProfiles.map(row => ({ id: row.recordId, name: row.data.name, mobile: row.data.mobile })));
  // A global file search must not lose patients who have no mobile yet. These
  // rows never become contact records, dial targets, or campaign recipients.
  for (const row of records.patientProfiles) if (!row.data.mobile.trim()) directorySource.push({ id: `patient:${row.recordId}`,
    name: row.data.name, mobile: '', matches: [{ id: row.recordId, name: row.data.name }],
    search: [createContactSearchEntry({ name: row.data.name, mobile: '' })] });
  const directory = directorySource
    .map(row => ({ id: row.id, name: row.name, mobile: row.mobile, phone: normalizeContactPhone(row.mobile),
      files: row.matches.map(file => { const profile = profiles.get(file.id); if (!profile) fail();
        return { patientRecordId: profile.recordId, fileNo: profile.fileNo, name: profile.data.name }; }), searchSource: row }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ar') || a.id.localeCompare(b.id));
  const patientCash = records.patientReceipts.filter(row => inRange(row.date));
  const labCash = records.labPayments.filter(row => inRange(row.date));
  const expenseCash = records.expensePayments.filter(row => inRange(row.date));
  const cash: CloudOverviewCashRow[] = [
    ...patientCash.map(row => { const profile = profiles.get(row.patientId), session = sessions.get(row.sessionId); if (!profile || !session) fail();
      return { id: `patient:${row.receiptId}`, kind: 'patient' as const, date: row.date, createdAt: row.createdAt,
        title: profile.data.name, detail: session.data.type, amountCents: String(row.amountCents), patientRecordId: row.patientId, fileNo: row.fileNo }; }),
    ...labCash.map(row => { const lab = labs.get(row.labId); if (!lab) fail();
      return { id: `lab:${row.receiptId}`, kind: 'lab' as const, date: row.date, createdAt: row.createdAt,
        title: lab.data.name, detail: `دفعة معمل · ${row.allocations.length} حالة`, amountCents: String(row.amountCents), patientRecordId: null, fileNo: null }; }),
    ...expenseCash.map(row => { const expense = expenses.get(row.expenseId); if (!expense) fail();
      return { id: `expense:${row.recordId}`, kind: 'expense' as const, date: row.date, createdAt: row.createdAt,
        title: expense.data.title, detail: expense.data.supplierName, amountCents: String(row.amountCents), patientRecordId: null, fileNo: null }; }),
  ].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  if (new Set(cash.map(row => row.id)).size !== cash.length) fail();
  const collected = sum(patientCash, row => row.amountCents), labPaid = sum(labCash, row => row.amountCents), expensePaid = sum(expenseCash, row => row.amountCents);
  const reserved = records.labCases.reduce((total, item) => {
    const session = sessions.get(item.sessionId); if (!session || session.patientId !== item.patientId) fail();
    const available = (cent(session.paidCents) < cent(item.totalCostCents) ? cent(session.paidCents) : cent(item.totalCostCents)) - cent(item.paidCostCents);
    return total + (available > 0n ? available : 0n);
  }, 0n);
  const outstanding = <T>(rows: readonly T[], charge: (row: T) => number, paid: (row: T) => number) => rows.reduce((total, row) => {
    const balance = cent(charge(row)) - cent(paid(row)); if (balance < 0n) fail(); return total + balance;
  }, 0n).toString();
  return frozen({ readTime, range, directory, cash,
    totals: { collectedCents: collected.toString(), labPaidCents: labPaid.toString(), expensePaidCents: expensePaid.toString(), netCashCents: (collected - labPaid - expensePaid).toString(),
      chargedCents: sum(records.patientSessions.filter(row => inRange(row.data.date)), row => row.totalCents).toString(),
      expenseChargedCents: sum(records.expenseRecords.filter(row => inRange(row.data.date)), row => row.data.totalCents).toString(),
      materialUsedCents: sum(records.materialUsages.filter(row => inRange(row.date) && row.kind === 'used'), row => row.costCents).toString(),
      materialWasteCents: sum(records.materialUsages.filter(row => inRange(row.date) && row.kind === 'waste'), row => row.costCents).toString(),
      outstandingPatientCents: outstanding(records.patientAccounts, row => row.totalCents, row => row.paidCents),
      outstandingLabCents: outstanding(records.labAccounts, row => row.totalCostCents, row => row.paidCostCents),
      outstandingExpenseCents: outstanding(records.expenseRecords, row => row.data.totalCents, row => row.paidCents), reservedForLabCents: reserved.toString() },
    counts: { patients: records.patientProfiles.length, entries: directory.length, phones: directory.filter(row => row.phone).length,
      phonesWithFiles: directory.filter(row => row.phone && row.files.length).length,
      phonesWithoutFiles: directory.filter(row => row.phone && !row.files.length).length },
    appointments: records.appointmentRecords.filter(row => inRange(row.data.date)).sort((a, b) => a.data.date.localeCompare(b.data.date) || a.data.time.localeCompare(b.data.time) || a.recordId.localeCompare(b.recordId)) });
}
export function filterCloudOverviewDirectory(projection: CloudClinicOverviewProjection, query: string, filter: CloudOverviewDirectoryFilter) {
  if (typeof query !== 'string' || query.length > 200 || !['all', 'files', 'nofiles'].includes(filter)) fail();
  const prepared = prepareContactSearchQuery(query);
  return projection.directory.filter(row => (filter === 'all' || (filter === 'files' ? row.files.length > 0 : row.files.length === 0))
    && (clinicDirectoryRowMatchesSearch(row.searchSource, prepared) || Boolean(prepared.digits && row.files.some(file => String(file.fileNo).includes(prepared.digits)))));
}

export type CloudOverviewExportFormat = 'operational-json' | 'contacts-csv';
const csvCell = (value: string) => `"${(/^[\s\uFEFF]*[=+\-@\t\r]/.test(value) ? "'" : '') + value.replace(/"/g, '""')}"`;
/** Owner download only; not a journal/image/auth backup or a supported restore codec. */
export function packageCloudOverviewExport(snapshot: CloudClinicSnapshot, projection: CloudClinicOverviewProjection, format: CloudOverviewExportFormat) {
  if (snapshot.readTime !== projection.readTime) fail();
  const day = snapshot.readTime.slice(0, 10);
  if (format === 'contacts-csv') {
    const rows = [['الاسم', 'الموبايل', 'له ملف', 'أرقام الملفات', 'أسماء أصحاب الملفات'], ...projection.directory.map(row =>
      [row.name, row.mobile, row.files.length ? 'نعم' : 'لا', row.files.map(file => String(file.fileNo)).join(' | '), row.files.map(file => file.name).join(' | ')])];
    return Object.freeze({ filename: `clinic-contacts-${day}.csv`, mime: 'text/csv;charset=utf-8', text: `\uFEFF${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n` });
  }
  if (format !== 'operational-json') fail();
  const records = Object.fromEntries(['patientProfiles', 'patientFiles', 'patientAccounts', 'patientSessions', 'patientReceipts', 'contactRecords',
    'appointmentRecords', 'appointmentDays', 'labDefinitions', 'labCases', 'labAccounts', 'labPayments', 'expenseRecords', 'expensePayments', 'materialBalances', 'materialUsages']
    .map(key => [key, snapshot.records[key as keyof CloudClinicSnapshot['records']]]));
  // Export from the fixed protected contract, never an account/local-backup object.
  const output = { format: 'dental-clinic-operational-export', version: 1, readTime: snapshot.readTime,
    notice: 'تصدير تشغيلي حساس للمالك، وليس نسخة استعادة كاملة. لا يشمل حسابات الدخول أو الأسرار أو journal أو صور الفواتير والشعار.',
    records, counter: snapshot.counter, settings: { serviceCatalog: snapshot.settings.serviceCatalog,
      clinicSettings: snapshot.settings.clinicSettings, prostheticRouting: snapshot.settings.prostheticRouting } };
  return Object.freeze({ filename: `clinic-operational-${day}.json`, mime: 'application/json;charset=utf-8', text: JSON.stringify(output, null, 2) });
}
