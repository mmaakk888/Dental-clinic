import type { CloudOperatingAdditionalContext } from './cloudOperatingPageController';
import type { CloudClinicSnapshot } from './cloudClinicSnapshot';
import { createCloudClinicSettingsWorkspaceController } from './cloudClinicSettingsWorkspaceController';
import { createCloudCatalogWorkspaceController } from './cloudCatalogWorkspaceController';
import { captureOriginalCatalog, captureOriginalContent } from './cloudOriginalSettingsProjection';
import type { CloudClinicSettingsData, CloudClinicLogoData, CloudSettingsTarget } from './cloudClinicSettingsRepository';
import type { CloudServiceCatalogData } from './cloudServiceCatalogRepository';
import type { ContentDraft } from './clinicContent';
import type { ServiceCatalogValues } from './serviceCatalog';
import type { DrugCatalogItem, Lab, LabService, WhatsappSettings } from '../types';
import type { ProstheticRoutingSettings } from './prostheticRouting';
import { projectOriginalRouting } from './cloudOriginalSettingsProjection';
import { projectOriginalClinicViews } from './cloudOriginalViewProjection';
import { normalizeServiceName } from './serviceCatalog';

export function createCloudOriginalSettingsBridge(context: CloudOperatingAdditionalContext, onCommitted: () => Promise<unknown>) {
  const controller = createCloudClinicSettingsWorkspaceController({ getCapability: context.getClinicSettings,
    getServiceCatalog: context.getServiceCatalog, isActive: context.isActive });
  const catalog = createCloudCatalogWorkspaceController({ getCapability: context.getServiceCatalog, isActive: context.isActive });
  const dirty = new Set<string>(); let running = false, disposed = false, retained: string | null = null;
  let batch: { desired: CloudServiceCatalogData; expected: CloudServiceCatalogData; next?: CloudServiceCatalogData } | null = null;
  const plans = new Map<string, { baseline: unknown; data: unknown; ack: unknown }>();
  const active = () => !disposed && context.isActive() && !controller.getState().closed && !catalog.getState().closed;
  const fail = (message = 'تعذر تأكيد الإعدادات. راجع المحاولة الأصلية قبل تغييرها.'): never => { throw new Error(message); };
  const clean = () => { const s = catalog.getState(); return controller.canClose() && !s.loading && !s.historyLoading && !s.draft && !s.pendingOperationId && s.saveStatus === 'idle'; };
  async function execute(key: string, work: () => Promise<void>) {
    if (!active() || running) return fail(); running = true;
    try {
      if (retained && retained !== key) return fail('توجد محاولة إعدادات محفوظة. أعد نفس القيم أو تحقّق من العملية قبل تغييرها.');
      retained = key;
      if (controller.getState().pendingOperationId) { if (!await controller.retry()) return fail(); }
      else if (catalog.getState().pendingOperationId) { if (!await catalog.retry()) return fail(); }
      await work();
      if (!active() || !clean()) return fail(); retained = null; dirty.clear(); plans.clear();
      try { await onCommitted(); } catch { /* A confirmed setting is not written twice after a failed report refresh. */ }
      if (!active()) return fail();
    } catch (error) {
      if (!controller.getState().pendingOperationId && !catalog.getState().pendingOperationId && !batch && ![...plans.values()].some(row => row.ack)) {
        controller.cancelDraft(); catalog.cancelDraft(); retained = null; plans.clear(); }
      throw error;
    } finally { running = false; }
  }
  async function setting(target: CloudSettingsTarget, recordId: string, baseline: unknown, data: unknown) {
    const key = `${target}:${recordId}`;
    let plan = plans.get(key);
    const continuing = !!plan;
    if (!plan) { plan = { baseline: structuredClone(baseline), data: structuredClone(data), ack: null }; plans.set(key, plan); }
    baseline = plan.baseline; data = plan.data;
    const current = controller.getState();
    if (continuing && current.loaded && current.selection.target === target && current.selection.recordId === recordId && current.snapshot
      && JSON.stringify(current.snapshot.data) === JSON.stringify(data)) { plan.ack = current.snapshot; return; }
    if (!await controller.load(target, recordId) || !active()) return fail();
    if (plan.ack) { if (JSON.stringify(controller.getState().snapshot) !== JSON.stringify(plan.ack)) return fail('تغيّر الجزء المحفوظ من الإعدادات؛ حدّث البيانات.'); return; }
    if (JSON.stringify(controller.getState().snapshot) !== JSON.stringify(baseline)) return fail('تغيّرت الإعدادات من جهاز آخر؛ حدّث البيانات وراجع التعديل.');
    if (!controller.beginEdit() || !controller.updateDraft(data) || !await controller.save()) return fail();
    plan.ack = controller.getState().snapshot;
  }
  const clinic = (snapshot: CloudClinicSnapshot, key: string, change: (data: CloudClinicSettingsData) => CloudClinicSettingsData) =>
    execute(key, () => setting('clinicSettings', 'clinicSettings', snapshot.settings.clinicSettings, change(structuredClone(snapshot.settings.clinicSettings.data))));
  return Object.freeze({ getState: controller.getState, subscribe: controller.subscribe, getCatalogState: catalog.getState, subscribeCatalog: catalog.subscribe,
    setDirty(key: string, value: boolean) { if (active()) { if (value) dirty.add(key); else dirty.delete(key); } },
    canClose: () => active() && !running && !dirty.size && !batch && !retained && clean(),
    content(snapshot: CloudClinicSnapshot, value: ContentDraft) { return clinic(snapshot, JSON.stringify({ kind: 'content', value }), data => ({ ...data, content: captureOriginalContent(value, data.content) })); },
    identity(snapshot: CloudClinicSnapshot, value: { clinicName: string; theme: CloudClinicSettingsData['theme']; logo: CloudClinicLogoData | null | undefined }, logoBaseline?: unknown) {
      return execute(JSON.stringify({ kind: 'identity', value }), async () => {
        if (value.logo !== undefined) { const cap = await context.getClinicSettings();
          const baseline = logoBaseline === undefined ? await cap.repository.getLogo() : logoBaseline;
          if (!active()) return fail(); await setting('clinicLogo', 'clinicLogo', baseline, value.logo); }
        await setting('clinicSettings', 'clinicSettings', snapshot.settings.clinicSettings, { ...structuredClone(snapshot.settings.clinicSettings.data),
          identity: { ...snapshot.settings.clinicSettings.data.identity, clinicName: value.clinicName,
            logoRecordId: value.logo === undefined ? snapshot.settings.clinicSettings.data.identity.logoRecordId : value.logo === null ? null : 'clinicLogo' }, theme: value.theme });
      });
    },
    drugs(snapshot: CloudClinicSnapshot, value: DrugCatalogItem[]) {
      return clinic(snapshot, JSON.stringify({ kind: 'drugs', value: value.map(row => ({ ...row, id: row.id.startsWith('drug_') ? 'new-drug' : row.id })) }), data => { const used = new Set<string>();
        const medications = value.map(row => { const previous = data.medications.find(item => item.medicationId === row.id); const medicationId = previous?.medicationId ?? crypto.randomUUID();
          if (used.has(medicationId)) return fail(); used.add(medicationId); return { medicationId, name: row.name, category: row.category,
            defaultDosage: row.defaultDosage, defaultDuration: row.defaultDuration, active: true }; });
        return { ...data, medications: [...medications, ...data.medications.filter(row => !used.has(row.medicationId)).map(row => ({ ...row, active: false }))] }; });
    },
    whatsapp(snapshot: CloudClinicSnapshot, value: WhatsappSettings) {
      return clinic(snapshot, JSON.stringify({ kind: 'whatsapp', value }), data => {
        if (value.apiKey || value.webhookUrl || value.autoConfirmOnAppt || value.autoRemind24h || value.autoPostOpOnAttended) return fail('الاتصال الحالي يدوي؛ إعداد API والأتمتة غير مفعّل في هذه النسخة.');
        return { ...data, whatsapp: { ...data.whatsapp, senderNumber: value.senderNumber,
          templates: Object.entries(value.templates).filter(([, text]) => typeof text === 'string').map(([key, text]) => {
            const previous = data.whatsapp.templates.find(row => row.key === key);
            return { templateId: previous?.templateId ?? crypto.randomUUID(), key: key as typeof data.whatsapp.templates[number]['key'], title: previous?.title ?? key, text: text! }; }) } };
      });
    },
    labPricing(snapshot: CloudClinicSnapshot, id: string, services: LabService[], baseline: Lab) {
      return execute(JSON.stringify({ kind: 'lab-prices', id, services, baseline }), async () => {
        const original = snapshot.records.labDefinitions.find(row => row.recordId === id);
        if (!original || JSON.stringify(projectOriginalClinicViews(snapshot).labs.find(row => row.id === id)) !== JSON.stringify(baseline)) return fail();
        const used = new Set<string>(), costs = services.map(row => { const old = original.data.costs.find(cost => cost.materialId === row.id), materialId = old?.materialId ?? crypto.randomUUID();
          used.add(materialId); return { materialId, name: row.name, category: row.category, unitLabel: row.unitLabel,
            billingBasis: old?.billingBasis ?? 'per-unit', unitCostCents: Math.round(row.price * 100), active: true }; });
        const data = { ...structuredClone(original.data), costs: [...costs, ...original.data.costs.filter(row => !used.has(row.materialId)).map(row => ({ ...row, active: false }))] };
        await setting('lab', id, original, data);
      });
    },
    routing(snapshot: CloudClinicSnapshot, value: ProstheticRoutingSettings, baseline: ProstheticRoutingSettings) {
      return execute(JSON.stringify({ kind: 'routing', value, baseline }), async () => {
        if (JSON.stringify(projectOriginalRouting(snapshot)) !== JSON.stringify(baseline)) return fail();
        const routes = snapshot.settings.serviceCatalog.data.services.filter(row => row.active && row.kind === 'prosthetic').flatMap(service => {
          const override = value.overrides.filter(row => normalizeServiceName(row.material) === normalizeServiceName(service.name));
          if (override.length > 1) return fail('اختر مسار معمل واحدًا لكل خامة.');
          if (override.length) return [{ serviceId: service.serviceId, labId: override[0].labId, materialId: override[0].labServiceId }];
          const candidates = snapshot.records.labDefinitions.filter(lab => Object.values(value.defaultLabs).includes(lab.recordId)).flatMap(lab => lab.data.costs.filter(cost => cost.active
            && normalizeServiceName(cost.name) === normalizeServiceName(service.name) && cost.category !== 'other' && value.defaultLabs[cost.category] === lab.recordId)
            .map(cost => ({ serviceId: service.serviceId, labId: lab.recordId, materialId: cost.materialId })));
          if (candidates.length > 1) return fail('يوجد أكثر من مسار مناسب؛ حدد تكلفة الخامة صراحة.'); return candidates;
        });
        await setting('prostheticRouting', 'prostheticRouting', snapshot.settings.prostheticRouting, { routes });
      });
    },
    prices(snapshot: CloudClinicSnapshot, value: ServiceCatalogValues) {
      return execute(JSON.stringify({ kind: 'prices', value }), async () => {
        if (!batch) {
          const desired = captureOriginalCatalog(value, snapshot.settings.serviceCatalog.data, () => crypto.randomUUID());
          for (const route of snapshot.settings.prostheticRouting.data.routes) if (!desired.services.find(row => row.serviceId === route.serviceId)?.active) return fail('ألغِ توجيه الخدمة إلى المعمل قبل حذفها أو تغيير اسمها.');
          if (!await catalog.load() || JSON.stringify(catalog.getState().snapshot) !== JSON.stringify(snapshot.settings.serviceCatalog)) return fail('تغيّر فهرس الأسعار؛ حدّث البيانات.');
          batch = { desired, expected: structuredClone(snapshot.settings.serviceCatalog.data) };
        }
        if (batch.next) { if (JSON.stringify(catalog.getState().snapshot?.data) !== JSON.stringify(batch.next)) return fail('تغيّرت الأسعار أثناء الحفظ؛ راجع التعديلات المؤكدة.'); batch.expected = batch.next; delete batch.next; }
        while (JSON.stringify(batch.expected) !== JSON.stringify(batch.desired)) {
          const next = structuredClone(batch.expected);
          if (next.examinationCents !== batch.desired.examinationCents) next.examinationCents = batch.desired.examinationCents;
          else { const index = batch.desired.services.findIndex((row, index) => JSON.stringify(row) !== JSON.stringify(next.services[index]));
            if (index < 0) return fail(); next.services[index] = structuredClone(batch.desired.services[index]); }
          batch.next = next;
          if (!catalog.beginEdit() || !catalog.updateDraft(next) || !await catalog.save()) return fail('لم يكتمل حفظ كل الأسعار. أعد نفس الحفظ لاستكمال الباقي؛ التعديلات المؤكدة لا تتكرر.');
          if (JSON.stringify(catalog.getState().snapshot?.data) !== JSON.stringify(next)) return fail('تغيّر الفهرس أثناء الحفظ.');
          batch.expected = next; delete batch.next;
        }
        batch = null;
      });
    },
    async cancelPending() { if (!active() || running) return false; const result = controller.getState().pendingOperationId ? await controller.cancelPending() : await catalog.cancelPending();
      if (result) { batch = null; retained = null; plans.clear(); } return result; },
    discardUnsentContinuation() { if (!active() || running || controller.getState().pendingOperationId || catalog.getState().pendingOperationId) return false;
      controller.cancelDraft(); catalog.cancelDraft(); batch = null; retained = null; plans.clear(); return true; },
    async recoverPending() { return false; /* Continue from the original editor so a multi-step identity/catalog save cannot report partial success. */ },
    dispose() { disposed = true; batch = null; retained = null; plans.clear(); dirty.clear(); controller.dispose(); catalog.dispose(); },
  });
}
export type CloudOriginalSettingsBridge = ReturnType<typeof createCloudOriginalSettingsBridge>;
