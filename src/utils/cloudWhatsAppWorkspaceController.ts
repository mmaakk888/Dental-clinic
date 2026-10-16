import type { CloudClinicSnapshot } from './cloudClinicSnapshot';
import type { CloudClinicalCapability } from './cloudClinicalWorkspaceController';
import type { CloudClinicSettingsWorkspaceCapability } from './cloudClinicSettingsWorkspaceController';
import { parseCloudClinicSettingsRecord } from './cloudClinicSettingsRepository';
import { parseCloudPatientRecord } from './cloudPatientRepository';
import { parseCloudClinicalAccount } from './cloudClinicalRepository';
import { createCloudContactWorkspaceController, type CloudContactWorkspaceCapability } from './cloudContactWorkspaceController';
import { parseCloudContactRecord } from './cloudContactRepository';
import { normalizeContactPhone } from './clinicContacts';
import { projectCloudClinicOverview, filterCloudOverviewDirectory, validateCloudOverviewDay,
  type CloudClinicOverviewProjection } from './cloudClinicOverviewProjection';
import { prepareSafeWhatsAppMessage } from './whatsappSafety';
import { fillMessageTemplate } from './whatsappUtils';

export interface CloudWhatsAppDraft {
  phone: string; patientRecordId: string | null; mode: 'individual' | 'campaign';
  templateId: string | null; templateKey: string; templateText: string; text: string; link: string;
  date: string; time: string; appointmentId: string | null; attachment: File | null;
}
export interface CloudWhatsAppOutput { phone: string; text: string; url: string; file: File | null; expiresAt: number }
export interface CloudWhatsAppState {
  snapshot: CloudClinicSnapshot | null; projection: CloudClinicOverviewProjection | null;
  tab: 'messages' | 'campaigns' | 'consent'; query: string; directoryLimit: number;
  selectedPhones: readonly string[]; draft: Readonly<CloudWhatsAppDraft> | null; output: Readonly<CloudWhatsAppOutput> | null;
  loading: boolean; preparing: boolean; error: string; notice: string; closed: boolean;
}
export interface CloudWhatsAppOptions {
  ownerUid: string; isActive(): boolean;
  getSnapshot(): Promise<{ readFull(): Promise<CloudClinicSnapshot> }>;
  getContacts(): Promise<CloudContactWorkspaceCapability>;
  getSettings(): Promise<CloudClinicSettingsWorkspaceCapability>;
  getClinical(): Promise<CloudClinicalCapability>;
  newId?: () => string; now?: () => string; nowMs?: () => number;
}
const fail = (): never => { throw Error('تعذر تأكيد بيانات الرسالة أو صلاحية إخراجها.'); };
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v) && v.length === 36;
function fields(value: unknown, allowed: string[], required = allowed): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail();
  const keys = Reflect.ownKeys(value as object); if (required.some(k => !keys.includes(k)) || keys.some(k => typeof k !== 'string' || !allowed.includes(k))) fail();
  return Object.fromEntries(keys.map(key => { const d = Object.getOwnPropertyDescriptor(value as object, key)!;
    if (!('value' in d) || !d.enumerable) fail(); return [key, d.value]; }));
}
const equal = (a: unknown, b: unknown): boolean => {
  if (a === b) return true; if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const ak = Object.keys(a).sort(), bk = Object.keys(b).sort();
  return ak.length === bk.length && ak.every((k, i) => k === bk[i] && equal((a as any)[k], (b as any)[k]));
};
const consentFor = (snapshot: CloudClinicSnapshot, phone: string) => snapshot.records.contactRecords.find(row =>
  !row.deleted && row.data && normalizeContactPhone(row.data.mobile) === phone);
export function cloudWhatsAppConsentAllowed(snapshot: CloudClinicSnapshot, phone: string): boolean {
  const consent = consentFor(snapshot, phone)?.data?.campaignConsent;
  return consent?.phone === phone && consent.status === 'allowed';
}
export function renderCloudWhatsAppDraft(snapshot: CloudClinicSnapshot, draft: Readonly<CloudWhatsAppDraft>) {
  const file = draft.patientRecordId ? snapshot.patients.find(row => row.patientRecordId === draft.patientRecordId) : null;
  if (draft.patientRecordId && (!file || normalizeContactPhone(file.profile.data.mobile) !== draft.phone) || draft.mode === 'campaign' && file) fail();
  const contact = consentFor(snapshot, draft.phone), name = file?.profile.data.name || contact?.data?.name
    || snapshot.records.patientProfiles.find(row => normalizeContactPhone(row.data.mobile) === draft.phone)?.data.name || '';
  const values: Record<string, string> = { patientName: name, clinicName: snapshot.settings.clinicSettings.data.identity.clinicName };
  if (draft.mode === 'individual') {
    values.date = draft.date; values.time = draft.time;
    if (file) { values.fileNo = String(file.profile.fileNo); values.remainingBalance = `${((file.totalCents - file.paidCents) / 100).toFixed(2)} ج.م`; }
  }
  const generated = fillMessageTemplate(draft.text, values);
  const safety = prepareSafeWhatsAppMessage({ templateName: draft.templateKey, rawTemplate: draft.templateText,
    editedText: generated, values, phone: draft.phone, isCampaign: draft.mode === 'campaign', canViewPatientFinance: Boolean(file),
    campaignConsent: cloudWhatsAppConsentAllowed(snapshot, draft.phone) ? { [draft.phone]: 'allowed' } : {} });
  return { ...safety, message: safety.message + (draft.link ? `\n${draft.link}` : '') };
}

/** Manual messaging only. No provider/API, local storage, automatic sends or
 * delivery claims. Full directory is read explicitly once; each output then
 * freshly fences only settings, selected profile/account and consent records. */
export function createCloudWhatsAppWorkspaceController(options: CloudWhatsAppOptions) {
  const empty = (closed = false): Readonly<CloudWhatsAppState> => Object.freeze({ snapshot: null, projection: null, tab: 'messages', query: '',
    directoryLimit: 50, selectedPhones: Object.freeze([]), draft: null, output: null, loading: false, preparing: false, error: '', notice: '', closed });
  let state = empty(), closed = false, epoch = 0, checking = false, capturing = false, readingOutputClock = false;
  let outputBinding: { value: Readonly<CloudWhatsAppOutput>; draft: Readonly<CloudWhatsAppDraft>; issuedAt: number } | null = null;
  const listeners = new Set<(state: Readonly<CloudWhatsAppState>) => void>();
  function publish(patch: Partial<CloudWhatsAppState>) { state = Object.freeze({ ...state, ...patch }); const next = state;
    for (const listener of [...listeners]) { try { listener(next); } catch { /* Views do not grant authority. */ } } }
  function active(ticket = epoch) {
    if (closed || checking || ticket !== epoch) return false; checking = true; let valid = false;
    try { valid = options.isActive() === true; } catch { /* Fail closed. */ } finally { checking = false; }
    if (!valid) dispose(); return !closed && ticket === epoch && valid;
  }
  const consent = createCloudContactWorkspaceController({ getRepository: options.getContacts, isActive: () => active(), newId: options.newId, now: options.now });
  function dispose() { if (closed) return; closed = true; epoch++; outputBinding = null;
    publish({ ...empty(true) }); consent.dispose(); listeners.clear(); }
  const consentClean = () => { const s = consent.getState(); return !s.draft && !s.loading && !s.recoveryLoading && s.saveStatus === 'idle'; };
  const idle = () => active() && !capturing && !state.loading && !state.preparing && consentClean();
  const assert = (ticket: number) => { if (!active(ticket)) fail(); };
  async function call<T>(ticket: number, work: () => Promise<T>): Promise<T> { assert(ticket); const value = await Promise.resolve().then(() => { assert(ticket); return work(); }); assert(ticket); return value; }
  const invalidate = () => { outputBinding = null; };
  const capture = <T>(work: () => T): T => { if (capturing) fail(); capturing = true; try { return work(); } finally { capturing = false; } };
  return Object.freeze({
    getState: () => { active(); return state; },
    subscribe(listener: (state: Readonly<CloudWhatsAppState>) => void) { if (!active()) return () => undefined; listeners.add(listener); return () => { listeners.delete(listener); }; },
    consent,
    canClose: () => idle() && state.draft === null,
    async refresh() {
      if (!idle() || state.draft) return false; const ticket = ++epoch; invalidate(); publish({ loading: true, output: null, error: '', notice: '' });
      try { const capability = await call(ticket, options.getSnapshot), snapshot = await call(ticket, () => capability.readFull());
        const day = snapshot.readTime.slice(0, 10), projection = projectCloudClinicOverview(snapshot, { from: day, to: day }); assert(ticket);
        publish({ snapshot, projection, loading: false, selectedPhones: Object.freeze([]), directoryLimit: 50, notice: 'تم تحديث الدليل والقوالب من الخادم. الإرسال يدوي؛ لم تُرسل أي رسالة.' }); return active(ticket);
      } catch { if (active(ticket)) publish({ loading: false, error: 'تعذر تحديث دليل واتساب كاملًا؛ لا بيانات محلية بديلة.' }); return false; }
    },
    setTab(tab: CloudWhatsAppState['tab']) { if (!idle() || state.draft || !['messages', 'campaigns', 'consent'].includes(tab)) return false; invalidate(); publish({ tab, output: null }); return active(); },
    setQuery(query: string) { if (!idle() || state.draft || typeof query !== 'string' || query.length > 200) return false; publish({ query, directoryLimit: 50 }); return active(); },
    showMore() { if (!idle() || state.draft) return false; publish({ directoryLimit: state.directoryLimit + 50 }); return active(); },
    selectCampaignPhones(phones: readonly string[]) {
      if (!idle() || state.draft || !state.snapshot || !Array.isArray(phones) || phones.length > 20_000) return false;
      try { const selected = capture(() => Array.from(new Set(phones))); if (!selected.every(phone => typeof phone === 'string' && normalizeContactPhone(phone) === phone && cloudWhatsAppConsentAllowed(state.snapshot!, phone))) fail();
        if (!idle() || state.draft) return false; publish({ selectedPhones: Object.freeze(selected) }); return active(); } catch { return false; }
    },
    beginMessage(input: Pick<CloudWhatsAppDraft, 'phone' | 'patientRecordId' | 'mode' | 'templateId'>) {
      if (!idle() || state.draft || !state.snapshot || !state.projection) return false;
      try { const value = capture(() => fields(input, ['phone', 'patientRecordId', 'mode', 'templateId']));
        const phone = normalizeContactPhone(value.phone as string);
        if (!phone || value.phone !== phone || !['individual', 'campaign'].includes(value.mode as string)
          || value.patientRecordId !== null && !uuid(value.patientRecordId) || value.templateId !== null && !uuid(value.templateId)) fail();
        const row = state.projection.directory.find(row => row.phone === phone); if (!row) fail();
        if (value.patientRecordId && !row.files.some(file => file.patientRecordId === value.patientRecordId) || value.mode === 'campaign' && value.patientRecordId !== null) fail();
        const template = value.templateId === null ? null : state.snapshot.settings.clinicSettings.data.whatsapp.templates.find(row => row.templateId === value.templateId);
        if (value.templateId !== null && !template) fail();
        const draft: Readonly<CloudWhatsAppDraft> = Object.freeze({ phone, patientRecordId: value.patientRecordId as string | null, mode: value.mode as CloudWhatsAppDraft['mode'],
          templateId: template?.templateId ?? null, templateKey: template?.key || 'custom', templateText: template?.text || '', text: template?.text || '', link: '', date: '', time: '', appointmentId: null, attachment: null });
        renderCloudWhatsAppDraft(state.snapshot, draft); if (!idle() || state.draft) return false; invalidate(); publish({ draft, output: null, error: '', notice: '' }); return active();
      } catch { if (active()) publish({ error: 'اختر رقمًا وملفًا مطابقين من الدليل. أرقام العائلة ليست هوية واحدة.' }); return false; }
    },
    updateDraft(patch: Partial<Pick<CloudWhatsAppDraft, 'text' | 'link' | 'date' | 'time'>>, expected: Readonly<CloudWhatsAppDraft>) {
      if (!idle() || state.draft !== expected) return false;
      try { const value = capture(() => fields(patch, ['text', 'link', 'date', 'time'], []));
        for (const [key, text] of Object.entries(value)) if (typeof text !== 'string' || text.length > (key === 'text' ? 4000 : key === 'link' ? 2048 : 10)) fail();
        if (!idle() || state.draft !== expected) return false; invalidate(); publish({ draft: Object.freeze({ ...expected, ...value, appointmentId: 'date' in value || 'time' in value ? null : expected.appointmentId }), output: null, error: '' }); return active();
      } catch { return false; }
    },
    chooseTemplate(templateId: string | null, expected: Readonly<CloudWhatsAppDraft>) {
      if (!idle() || state.draft !== expected || !state.snapshot) return false;
      const template = templateId === null ? null : state.snapshot.settings.clinicSettings.data.whatsapp.templates.find(row => row.templateId === templateId);
      if (templateId !== null && !template) return false; invalidate(); publish({ draft: Object.freeze({ ...expected, templateId, templateKey: template?.key || 'custom', templateText: template?.text || '', text: template?.text || '' }), output: null }); return active();
    },
    chooseAppointment(appointmentId: string, expected: Readonly<CloudWhatsAppDraft>) {
      if (!idle() || state.draft !== expected || !state.snapshot || expected.mode === 'campaign') return false;
      const appointment = state.snapshot.records.appointmentRecords.find(row => row.recordId === appointmentId);
      if (!appointment || ['cancelled', 'no_show', 'apologized'].includes(appointment.data.status)
        || (expected.patientRecordId ? appointment.data.patientRecordId !== expected.patientRecordId : appointment.data.patientRecordId !== null || normalizeContactPhone(appointment.data.phone) !== expected.phone)) return false;
      invalidate(); publish({ draft: Object.freeze({ ...expected, appointmentId, date: appointment.data.date, time: appointment.data.time }), output: null }); return active();
    },
    setAttachment(file: File | null, expected: Readonly<CloudWhatsAppDraft>) {
      if (!idle() || state.draft !== expected) return false;
      try { const copy = capture(() => { if (file === null) return null;
        if (typeof File === 'undefined' || !(file instanceof File) || file.type !== 'image/jpeg' || file.size < 16 || file.size > 150 * 1024) fail();
        return new File([file], 'clinic-message.jpg', { type: 'image/jpeg' }); });
        if (!idle() || state.draft !== expected) return false; invalidate(); publish({ draft: Object.freeze({ ...expected, attachment: copy }), output: null }); return active();
      } catch { return false; }
    },
    cancelDraft(expected: Readonly<CloudWhatsAppDraft>) { if (!idle() || state.draft !== expected) return false; invalidate(); publish({ draft: null, output: null, error: '' }); return active(); },
    beginConsent(phone: string, status: 'allowed' | 'declined') {
      if (!idle() || state.draft || !state.snapshot || !state.projection || !['allowed', 'declined'].includes(status) || normalizeContactPhone(phone) !== phone) return false;
      const row = state.projection.directory.find(row => row.phone === phone); if (!row) return false;
      const existing = consentFor(state.snapshot, phone);
      const begun = existing ? consent.beginEdit(existing) : consent.beginCreate(); if (!begun) return false;
      if (!existing && !consent.changeDraft({ name: row.name, mobile: phone })) { consent.cancelDraft(); return false; }
      return consent.changeCampaignConsent(status, consent.getState().draft!);
    },
    async prepareOutput(expected: Readonly<CloudWhatsAppDraft>) {
      if (!idle() || state.draft !== expected || !state.snapshot) return null;
      const snapshot = state.snapshot, ticket = epoch; invalidate(); publish({ preparing: true, output: null, error: '', notice: '' });
      try {
        if (expected.date || expected.time || ['newAppt', 'reminderTomorrow'].includes(expected.templateKey) || /\{(?:date|time)\}/.test(expected.text)) {
          validateCloudOverviewDay(expected.date); if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(expected.time)) fail(); }
        if (expected.link) { const url = new URL(expected.link); if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || /\s/.test(expected.link)) fail(); }
        if (/[\u0000-\u0008\u000b-\u001f\u007f\p{Cf}\p{Cs}]/u.test(expected.text)) fail();
        const rendered = renderCloudWhatsAppDraft(snapshot, expected);
        if (!rendered.financeAllowed || !rendered.consentAllowed || rendered.unfinished || rendered.unsupportedVariables.length || !rendered.message.trim() || /\{[^{}]+\}|\[[^\]]+\]/.test(rendered.message)) fail();
        const settings = await call(ticket, options.getSettings), latest = await call(ticket, () => settings.repository.get());
        if (!latest || !equal(parseCloudClinicSettingsRecord(latest), snapshot.settings.clinicSettings)) fail();
        if (expected.patientRecordId) {
          const file = snapshot.patients.find(row => row.patientRecordId === expected.patientRecordId); if (!file) fail();
          const clinical = await call(ticket, options.getClinical), profile = await call(ticket, () => clinical.repository.getProfile(expected.patientRecordId!));
          if (!profile || !equal(parseCloudPatientRecord(profile), file.profile)) fail();
          const account = await call(ticket, () => clinical.repository.getAccount(expected.patientRecordId!));
          const beforeAccount = snapshot.records.patientAccounts.find(row => row.patientId === expected.patientRecordId) ?? null;
          if (account === null ? beforeAccount !== null || file.accountRevision !== 0 : !equal(parseCloudClinicalAccount(account), beforeAccount)) fail();
        }
        if (expected.appointmentId) {
          // A recorded appointment is a mutable scheduling record. A fresh full
          // snapshot is needed ONLY for this case; manual dates need no scan.
          const cap = await call(ticket, options.getSnapshot), current = await call(ticket, () => cap.readFull());
          const before = snapshot.records.appointmentRecords.find(row => row.recordId === expected.appointmentId), after = current.records.appointmentRecords.find(row => row.recordId === expected.appointmentId);
          if (!before || !equal(before, after)) fail();
        }
        if (expected.mode === 'campaign' || ['greeting', 'offer'].includes(expected.templateKey)) {
          const original = consentFor(snapshot, expected.phone); if (!original) fail();
          const contacts = await call(ticket, options.getContacts), current = await call(ticket, () => contacts.get(original.recordId));
          const checked = current && parseCloudContactRecord(current);
          if (!checked || checked.deleted || normalizeContactPhone(checked.data!.mobile) !== expected.phone
            || checked.data!.campaignConsent?.phone !== expected.phone || checked.data!.campaignConsent?.status !== 'allowed') fail();
        }
        const finalSettings = await call(ticket, () => settings.repository.get()); if (!finalSettings || !equal(finalSettings, latest)) fail();
        assert(ticket); if (state.draft !== expected) fail(); const ms = (options.nowMs ?? Date.now)();
        assert(ticket); if (state.draft !== expected || !Number.isSafeInteger(ms) || ms < 0 || ms > Number.MAX_SAFE_INTEGER - 30_000) fail();
        const output = Object.freeze({ phone: expected.phone, text: rendered.message, url: `https://wa.me/${expected.phone}?text=${encodeURIComponent(rendered.message)}`, file: expected.attachment, expiresAt: ms + 30_000 });
        outputBinding = { value: output, draft: expected, issuedAt: ms }; publish({ preparing: false, output, notice: 'تم التحقق. افتح واتساب أو شارك خلال30 ثانية. هذا لا يؤكد الإرسال أو الوصول.' });
        assert(ticket); return state.draft === expected && outputBinding?.value === output ? output : null;
      } catch { invalidate(); if (active(ticket)) publish({ preparing: false, output: null, error: 'تعذر تفويض الرسالة أو تغيّرت البيانات/الموافقة. راجع النص والتاريخ وحدّث البيانات قبل المحاولة.' }); return null; }
    },
    consumeOutput(expected: Readonly<CloudWhatsAppOutput>) {
      if (readingOutputClock || !idle() || !outputBinding || outputBinding.value !== expected || state.output !== expected || state.draft !== outputBinding.draft) return null;
      const binding = outputBinding; let ms: number;
      readingOutputClock = true;
      try { ms = (options.nowMs ?? Date.now)(); }
      catch { invalidate(); if (active()) publish({ output: null }); return null; }
      finally { readingOutputClock = false; }
      if (!active() || outputBinding !== binding || state.output !== expected || state.draft !== binding.draft) return null;
      if (!Number.isSafeInteger(ms) || ms < binding.issuedAt || ms > expected.expiresAt) { invalidate(); publish({ output: null }); return null; }
      invalidate(); publish({ output: null, notice: 'أُخرجت الرسالة يدويًا؛ راجع المستلم داخل واتساب قبل الإرسال. لم نسجلها كرسالة وصلت.' });
      return active() && state.draft === binding.draft ? expected : null;
    },
    dispose,
  });
}
export type CloudWhatsAppWorkspaceController = ReturnType<typeof createCloudWhatsAppWorkspaceController>;
