import { CloudProstheticError, parseCloudLabAccount, parseCloudLabPayment, parseCloudProstheticCase,
  projectCloudProstheticFinancials, MAX_CLOUD_LAB_HISTORY_RECORDS, MAX_CLOUD_PROSTHETIC_CENTS,
  type CloudProstheticRepository, type CloudLabFinancialSummary } from './cloudProstheticRepository';
import { parseCloudClinicalAccount, parseCloudClinicalSession, type CloudClinicalRepository } from './cloudClinicalRepository';
import { loadCloudClinicalPatient } from './cloudClinicalPatientProjection';
import { parseCloudPatientRecord } from './cloudPatientRepository';

export interface CloudProstheticLedger extends CloudLabFinancialSummary {
  caseFinancials: (ReturnType<typeof projectCloudProstheticFinancials> & { caseId: string; patientName: string; fileNo: number })[];
  patientCollectedCents: number; patientRemainingCents: number; reservedForLabCents: number; availableToClinicCents: number;
}
function fail(): never { throw new CloudProstheticError('unavailable'); }
function changed(): never { throw new CloudProstheticError('conflict'); }
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value;
}
const sum = (values: number[]) => {
  const value = values.reduce((a, b) => a + b, 0);
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_CLOUD_PROSTHETIC_CENTS) fail(); return value;
};
function fields(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).length !== keys.length) fail();
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (!property || !('value' in property) || !property.enumerable) fail(); result[key] = property.value;
  } return result;
}
function rows(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > MAX_CLOUD_LAB_HISTORY_RECORDS || Reflect.ownKeys(value).length !== value.length + 1) fail();
  return Array.from({ length: value.length }, (_, index) => {
    const property = Object.getOwnPropertyDescriptor(value, String(index));
    if (!property || !('value' in property) || !property.enumerable) fail(); return property.value;
  });
}
/** Complete private ledger, not a total over the currently displayed page.
 * Lab fences alone cannot detect patient receipts. Every linked patient is
 * fully reconciled, then ALL captured profile/account fences are re-read before
 * the final lab fence. No copied patientPaid field or estimated profit is used.
 * availableToClinic means collected cash above the full supplier obligation;
 * it is NOT net profit and excludes unrelated clinic expenses. */
export async function loadCloudProstheticLedger(prosthetics: CloudProstheticRepository, clinical: CloudClinicalRepository,
  input: { labId: string; month: string }, assertActive: () => void = () => undefined): Promise<CloudProstheticLedger | null> {
  try {
    const request = fields(input, ['labId', 'month']), labId = request.labId, month = request.month;
    if (typeof labId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(labId)
      || typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month < '1900-01' || month > '9999-12') fail();
    const read = async <T>(work: () => Promise<T>) => { assertActive(); const value = await work(); assertActive(); return value; };
    const raw = await read(() => prosthetics.getLabSummary({ labId, month }));
    if (raw === null) return null; // Repository verified both complete histories empty.
    const value = fields(raw, ['account', 'month', 'totalCostCents', 'paidCostCents', 'remainingCents', 'monthPaidCents', 'cases', 'payments']);
    const account = parseCloudLabAccount(value.account), cases = rows(value.cases).map(parseCloudProstheticCase), payments = rows(value.payments).map(parseCloudLabPayment);
    if (account.labId !== labId || value.month !== month || account.caseCount !== cases.length || account.paymentCount !== payments.length) fail();
    const caseIds = new Set<string>(), paymentIds = new Set<string>(), allocated = new Map<string, number>();
    for (const item of cases) { if (item.labId !== labId || caseIds.has(item.recordId)) fail(); caseIds.add(item.recordId); }
    for (const payment of payments) {
      if (payment.labId !== labId || paymentIds.has(payment.receiptId)) fail(); paymentIds.add(payment.receiptId);
      for (const row of payment.allocations) {
        if (!caseIds.has(row.caseId)) fail(); allocated.set(row.caseId, sum([allocated.get(row.caseId) ?? 0, row.amountCents]));
      }
    }
    const totalCostCents = sum(cases.map(item => item.totalCostCents)), paidCostCents = sum(payments.map(item => item.amountCents));
    const monthPaidCents = sum(payments.filter(item => item.date.startsWith(`${month}-`)).map(item => item.amountCents));
    if (account.totalCostCents !== totalCostCents || account.paidCostCents !== paidCostCents
      || value.totalCostCents !== totalCostCents || value.paidCostCents !== paidCostCents
      || value.remainingCents !== totalCostCents - paidCostCents || value.monthPaidCents !== monthPaidCents
      || cases.some(item => item.paidCostCents !== (allocated.get(item.recordId) ?? 0))) fail();
    const fences: { patientId: string; account: ReturnType<typeof parseCloudClinicalAccount>; profile: ReturnType<typeof parseCloudPatientRecord> }[] = [];
    const caseFinancials: CloudProstheticLedger['caseFinancials'] = [];
    for (const patientId of new Set(cases.map(item => item.patientId))) {
      const before = parseCloudClinicalAccount(await read(() => clinical.getAccount(patientId)));
      if (before.patientId !== patientId) fail();
      const patient = await loadCloudClinicalPatient(clinical, patientId, assertActive);
      if (patient.accountRevision !== before.revision || patient.totalCents !== before.totalCents || patient.paidCents !== before.paidCents) changed();
      for (const item of cases.filter(item => item.patientId === patientId)) {
        const session = parseCloudClinicalSession(await read(() => clinical.getSession(item.sessionId)));
        caseFinancials.push({ caseId: item.recordId, patientName: patient.profile.data.name, fileNo: item.fileNo,
          ...projectCloudProstheticFinancials({ item, session, account: before }) });
      }
      fences.push({ patientId, account: before, profile: patient.profile });
    }
    for (const fence of fences) {
      const latest = parseCloudClinicalAccount(await read(() => clinical.getAccount(fence.patientId)));
      const profile = parseCloudPatientRecord(await read(() => clinical.getProfile(fence.patientId)));
      if (JSON.stringify(latest) !== JSON.stringify(fence.account) || JSON.stringify(profile) !== JSON.stringify(fence.profile)) changed();
    }
    const last = parseCloudLabAccount(await read(() => prosthetics.getLabAccount(labId)));
    if (JSON.stringify(last) !== JSON.stringify(account)) changed();
    assertActive(); return freeze({ account, month, totalCostCents, paidCostCents, remainingCents: totalCostCents - paidCostCents, monthPaidCents,
      cases, payments, caseFinancials, patientCollectedCents: sum(caseFinancials.map(item => item.patientPaidCents)),
      patientRemainingCents: sum(caseFinancials.map(item => item.patientRemainingCents)),
      reservedForLabCents: sum(caseFinancials.map(item => item.reservedForLabCents)),
      availableToClinicCents: sum(caseFinancials.map(item => item.availableToClinicCents)) });
  } catch (error) {
    let conflict = false;
    try { conflict = !!error && typeof error === 'object' && 'code' in error && error.code === 'conflict'; } catch { /* Fixed errors. */ }
    throw new CloudProstheticError(conflict ? 'conflict' : 'unavailable');
  }
}
