import { createHash } from 'node:crypto';
import { createCloudOperationIntentRepository } from '../cloudOperationIntent';
import { createCloudClinicalRepository } from '../cloudClinicalRepository';
import { createCloudProstheticRepository } from '../cloudProstheticRepository';
import { createCloudExpenseRepository, cloudMaterialIdV2 } from '../cloudExpenseRepository';
import { createCloudAppointmentRepository } from '../cloudAppointmentRepository';
import type { CloudClinicSettingsData } from '../cloudClinicSettingsRepository';
import type { CloudSnapshotQuery } from '../cloudClinicSnapshot';

// TEST FIXTURES ONLY. Never imported by application/runtime entry points.
export const SNAPSHOT_OWNER = 'synthetic-whole-clinic-owner';
export const snapshotId = (n: number) => `90000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const SNAPSHOT_WHEN = '2026-10-13T00:00:00.000Z', SNAPSHOT_TIME = '2026-10-13T00:00:00.123456Z';
export const snapshotPath = (collection: string, id: string | number) => `clinics/main/${collection}/${id}`;
export const snapshotDigest = async (value: string) => createHash('sha256').update(value).digest('hex');
const sections = ['patients', 'contacts', 'appointments', 'lab', 'summary', 'settings'] as const;
export function syntheticSnapshotSettings(): CloudClinicSettingsData { return {
  identity: { clinicName: 'عيادة مصطنعة للاختبار فقط', doctorName: '', phone: '', address: '', logoRecordId: null },
  theme: { primary: '#2563eb', secondary: '#1d4ed8', accent: '#f59e0b', background: '#f8fafc', fontFamily: "'Cairo', sans-serif", customFontUrl: null },
  content: { homeSubtitle: '', welcomeText: '', tiles: Object.fromEntries(sections.map(key => [key, { title: key, desc: '' }])) as CloudClinicSettingsData['content']['tiles'],
    tabs: { info: 'بيانات', chart: 'أسنان', sessions: 'جلسات', finance: 'حساب', lab: 'معمل' },
    navigationLabels: Object.fromEntries(['home', ...sections].map(key => [key, key])) as CloudClinicSettingsData['content']['navigationLabels'],
    mobile: { order: [...sections], size: 'comfortable', showLabels: true, visibleCount: 4, moreSections: ['settings'] },
    desktop: { order: [...sections], size: 'large', showLabels: true },
    homeLayout: { sectionOrder: ['actions', 'metrics', 'schedule', 'followUp'], hiddenSections: [], density: 'compact', appointmentLimit: 6 } },
  medications: [], whatsapp: { senderNumber: '', autoConfirmOnAppt: false, autoRemind24h: false, autoPostOpOnAttended: false, templates: [] },
}; }
export function encodeSnapshotValue(value: any): any {
  if (value === null) return { nullValue: null }; if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value }; if (typeof value === 'number') return { integerValue: String(value) };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeSnapshotValue) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, value]) => [key, encodeSnapshotValue(value)])) } };
}
export function snapshotRestDocument(collection: string, id: string | number, data: unknown) {
  return { name: `projects/dental-clinic-mmaakk888/databases/(default)/documents/clinics/main/${collection}/${id}`, fields: encodeSnapshotValue(data).mapValue.fields };
}
export async function makeClinicSnapshotFixture(full = true) {
  const envelope = (recordId: string, data: unknown) => ({ schemaVersion: 1, clinicId: 'main', recordId, revision: 1, lastOperationId: snapshotId(999), data });
  const docs = new Map<string, any>([
    [snapshotPath('settings', 'serviceCatalog'), envelope('serviceCatalog', { examinationCents: 10_000, services: [] })],
    [snapshotPath('settings', 'clinicSettings'), envelope('clinicSettings', syntheticSnapshotSettings())],
    [snapshotPath('settings', 'prostheticRouting'), envelope('prostheticRouting', { routes: [] })],
    [snapshotPath('counters', 'patientFiles'), { schemaVersion: 1, clinicId: 'main', lastFileNo: 0, lastOperationId: null }],
  ]);
  const adapter: any = { authorizeOwner: async () => SNAPSHOT_OWNER,
    runTransaction: async (work: any) => { const staged = structuredClone(docs); let wrote = false;
      const result = await work({ get: async (key: string) => { if (wrote) throw new Error('SYNTHETIC_READ_AFTER_WRITE'); return structuredClone(staged.get(key) ?? null); },
        set: (key: string, value: unknown) => { wrote = true; staged.set(key, structuredClone(value)); } }); docs.clear(); staged.forEach((value: unknown, key: string) => docs.set(key, value)); return result; } };
  const journal = createCloudOperationIntentRepository(adapter, { digest: snapshotDigest });
  async function commit(kind: Parameters<typeof journal.prepare>[0], repository: { commit(value: any): Promise<unknown> }, command: any) {
    await journal.prepare(kind, command, command.createdAt); return repository.commit(command);
  }
  if (full) {
    const patient = snapshotId(900), lab = snapshotId(901), service = snapshotId(902), material = snapshotId(903), day = '2026-10-13';
    docs.set(snapshotPath('patientProfiles', patient), { schemaVersion: 1, clinicId: 'main', recordId: patient, fileNo: 451, revision: 1, lastOperationId: snapshotId(999), phoneKey: null,
      data: { name: 'مريض مصطنع فقط', mobile: '', age: 30, gender: '', firstVisit: day, notes: '', allergy: '' } });
    docs.set(snapshotPath('patientFiles', 451), { schemaVersion: 1, clinicId: 'main', fileNo: 451, recordId: patient });
    docs.set(snapshotPath('counters', 'patientFiles'), { schemaVersion: 1, clinicId: 'main', lastFileNo: 451, lastOperationId: snapshotId(999) });
    docs.set(snapshotPath('settings', 'serviceCatalog'), envelope('serviceCatalog', { examinationCents: 10_000,
      services: [{ serviceId: service, name: 'تركيبة زيركون مصطنعة', kind: 'prosthetic', priceCents: 100_000, active: true }] }));
    docs.set(snapshotPath('settings', 'prostheticRouting'), envelope('prostheticRouting', { routes: [{ serviceId: service, labId: lab, materialId: material }] }));
    docs.set(snapshotPath('labDefinitions', lab), envelope(lab, { name: 'معمل مصطنع', phone: '', address: '', notes: '', active: true,
      costs: [{ materialId: material, name: 'مادة مصطنعة', category: 'fixed', unitLabel: 'كراون', billingBasis: 'per-unit', unitCostCents: 20_000, active: true }] }));
    const clinical = createCloudClinicalRepository(adapter, { digest: snapshotDigest }), prosthetic = createCloudProstheticRepository(adapter, { digest: snapshotDigest });
    await commit('clinical', clinical, { action: 'visit', operationId: snapshotId(10), sessionId: snapshotId(10), patientId: patient, expectedRevision: 0, createdAt: SNAPSHOT_WHEN,
      paidCents: 5000, data: { type: 'حشو مصطنع', date: day, teethIds: ['ur4'], services: [{ id: snapshotId(2), name: 'حشو مصطنع', priceCents: 30_000, tooth: 'ur4' }], examinationCents: 10_000,
        notes: '', treatmentStage: 'single', rootCanalStatus: '', visitStatus: 'completed' } });
    await commit('prosthetic', prosthetic, { action: 'create', operationId: snapshotId(11), labId: lab, expectedLabAccountRevision: 0, createdAt: SNAPSHOT_WHEN,
      patientId: patient, expectedPatientRevision: 1, serviceId: service, expectedCatalogRevision: 1, expectedRoutingRevision: 1, expectedLabRevision: 1,
      kind: 'fixed', units: 3, teethIds: ['ur1', 'ur2', 'ur3'], date: day, deliveryExpectedDate: null, patientUnitPriceCents: 100_000, includeExamination: true, paidCents: 50_000, note: '' });
    await commit('prosthetic', prosthetic, { action: 'lab-payment', operationId: snapshotId(12), labId: lab, expectedLabAccountRevision: 1, createdAt: SNAPSHOT_WHEN,
      date: day, note: '', allocations: [{ caseId: snapshotId(11), expectedRevision: 1, amountCents: 10_000 }] });
    await commit('clinical', clinical, { action: 'payment', operationId: snapshotId(13), sessionId: snapshotId(11), patientId: patient, expectedRevision: 2,
      createdAt: SNAPSHOT_WHEN, date: day, amountCents: 20_000, note: '' });
    const expense = createCloudExpenseRepository(adapter, { digest: snapshotDigest });
    await commit('expense', expense, { action: 'create', operationId: snapshotId(14), recordId: snapshotId(14), expectedRevision: 0, createdAt: SNAPSHOT_WHEN, paidCents: 2500,
      data: { title: 'فاتورة مصطنعة', category: 'supplies', expenseType: 'supplies', date: day, note: '', isFixed: false, recurringPeriod: 'none', supplierName: 'مورد مصطنع',
        supplierPhone: '', supplierAddress: '', invoiceNumber: '', invoiceDate: day, invoiceTime: '', taxNumber: '', commercialRecord: '', currency: 'EGP',
        subtotalCents: 10_000, taxCents: 0, discountCents: 0, totalCents: 10_000,
        items: [{ itemId: snapshotId(15), name: 'قفازات مصطنعة', unit: 'علبة', quantityMilli: 2000, unitPriceCents: 5000, discountCents: 0, taxCents: 0, totalCents: 10_000 }] } });
    await commit('expense', expense, { action: 'pay', operationId: snapshotId(16), recordId: snapshotId(14), expectedRevision: 1, amountCents: 1000, date: day, note: '', createdAt: SNAPSHOT_WHEN });
    await commit('expense', expense, { action: 'usage', operationId: snapshotId(17), materialId: await cloudMaterialIdV2('قفازات مصطنعة', 'علبة', { digest: snapshotDigest }),
      expectedRevision: 1, quantityMilli: 500, kind: 'used', date: day, note: '', createdAt: SNAPSHOT_WHEN });
    const appointments = createCloudAppointmentRepository(adapter, { digest: snapshotDigest });
    await commit('appointment', appointments, { operationId: snapshotId(18), recordId: snapshotId(19), expectedRevision: 0, createdAt: SNAPSHOT_WHEN,
      data: { patientRecordId: patient, patientName: 'اسم موعد مصطنع', phone: '', date: day, time: '10:00', durationMinutes: 30, status: 'scheduled', reason: '', notes: '', doctorName: '', appointmentType: '', isFollowUp: false, isWalkIn: false } });
  }
  const calls: CloudSnapshotQuery[] = []; let probes = 0, active = true;
  const readerAdapter = { assertActive: () => { if (!active) throw new Error('SYNTHETIC_LEASE'); },
    probeReadTime: async () => { probes++; return [{ readTime: SNAPSHOT_TIME }]; },
    query: async (query: CloudSnapshotQuery) => { calls.push(structuredClone(query));
      const values = [...docs].filter(([key]) => key.startsWith(snapshotPath(query.collection, '')) && (!query.documentId || key.endsWith(`/${query.documentId}`))
        && (!query.afterId || key.split('/').at(-1)! > query.afterId)).sort(([a], [b]) => a.localeCompare(b)).slice(0, query.limit);
      return values.length ? values.map(([key, value]) => ({ readTime: query.readTime, document: snapshotRestDocument(query.collection, key.split('/').at(-1)!, value) })) : [{ readTime: query.readTime }];
    } };
  return { docs, calls, adapter: readerAdapter, active: (value: boolean) => { active = value; }, probes: () => probes };
}
