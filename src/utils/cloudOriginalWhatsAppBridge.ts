import type { CloudClinicSnapshot } from './cloudClinicSnapshot';
import type { CloudOperatingAdditionalContext } from './cloudOperatingPageController';
import type { ProtectedWhatsAppAction } from './whatsappSafety';
import { prepareFreshWhatsAppAction } from './whatsappSafety';
import { normalizeContactPhone } from './clinicContacts';
import { createCloudContactWorkspaceController } from './cloudContactWorkspaceController';
import { projectCloudClinicOverview } from './cloudClinicOverviewProjection';
import { parseCloudPatientRecord } from './cloudPatientRepository';
import { parseCloudClinicalAccount } from './cloudClinicalRepository';
import { parseCloudContactRecord } from './cloudContactRepository';
import type { WhatsappSettings } from '../types';
export function projectOriginalWhatsApp(snapshot: CloudClinicSnapshot): WhatsappSettings {
  const config = snapshot.settings.clinicSettings.data.whatsapp, templates = { reminderTomorrow: '', newAppt: '', postOp: '', accountBalance: '' };
  for (const row of config.templates) if (row.key !== 'custom') Object.assign(templates, { [row.key]: row.text });
  const campaignConsent: Record<string, 'allowed' | 'declined'> = {};
  for (const row of snapshot.records.contactRecords) { const consent = row.data?.campaignConsent;
    if (!row.deleted && consent && normalizeContactPhone(row.data!.mobile) === consent.phone) campaignConsent[consent.phone] = consent.status; }
  return { ...config, templates, campaignConsent, apiKey: '', webhookUrl: '', autoConfirmOnAppt: false, autoRemind24h: false, autoPostOpOnAttended: false };
}
export function createCloudOriginalWhatsAppBridge(context: CloudOperatingAdditionalContext, onCommitted: () => Promise<unknown>) {
  const consent = createCloudContactWorkspaceController({ getRepository: context.getContacts, isActive: context.isActive });
  let closed = false, preparing = false, writing = false, generation = 0;
  let output: { key: string; phone: string; text: string; from: number; until: number; snapshot: CloudClinicSnapshot } | null = null;
  let plan: { key: string; rows: [string, 'allowed' | 'declined'][]; index: number } | null = null;
  const active = () => !closed && context.isActive() && !consent.getState().closed;
  const fail = (): never => { throw Error('تعذر تأكيد الرسالة أو موافقة صاحب الرقم من الخادم.'); };
  const keyOf = (input: ProtectedWhatsAppAction) => JSON.stringify(input);
  async function prepare(snapshot: CloudClinicSnapshot, raw: ProtectedWhatsAppAction) {
    if (!active() || preparing || writing) return fail(); preparing = true; output = null; const ticket = ++generation, input = structuredClone(raw), key = keyOf(input);
    const check = () => { if (!active() || generation !== ticket) return fail(); };
    try {
      const phone = normalizeContactPhone(input.phone), patient = input.patientFileNo ? snapshot.patients.find(row => String(row.profile.fileNo) === input.patientFileNo) : null;
      if (!phone || input.patientFileNo && (!patient || normalizeContactPhone(patient.profile.data.mobile) !== phone)) return fail();
      const settings = projectOriginalWhatsApp(snapshot), payload = prepareFreshWhatsAppAction(input, () => settings, () => undefined);
      const cap = await context.getClinicSettings(); check(); const before = await cap.repository.get(); check();
      if (JSON.stringify(before) !== JSON.stringify(snapshot.settings.clinicSettings)) return fail();
      if (patient) { const clinical = await context.getClinical(); check(); const profile = await clinical.repository.getProfile(patient.patientRecordId); check();
        if (!profile || JSON.stringify(parseCloudPatientRecord(profile)) !== JSON.stringify(patient.profile)) return fail();
        if (input.canViewPatientFinance && (input.templateName === 'accountBalance' || /\{remainingBalance\}/.test(input.rawTemplate))) {
          const account = await clinical.repository.getAccount(patient.patientRecordId); check(); const original = snapshot.records.patientAccounts.find(row => row.patientId === patient.patientRecordId) ?? null;
          if (JSON.stringify(account === null ? null : parseCloudClinicalAccount(account)) !== JSON.stringify(original)) return fail();
        }
      }
      if (input.isCampaign || ['greeting', 'offer'].includes(input.templateName)) {
        const original = snapshot.records.contactRecords.find(row => !row.deleted && normalizeContactPhone(row.data!.mobile) === phone);
        if (!original) return fail(); const contacts = await context.getContacts(); check(); const raw = await contacts.get(original.recordId); check();
        const current = raw && parseCloudContactRecord(raw);
        if (!current?.data || current.deleted || normalizeContactPhone(current.data.mobile) !== phone || current.data.campaignConsent?.phone !== phone || current.data.campaignConsent.status !== 'allowed') return fail();
      }
      if (!patient && !snapshot.records.contactRecords.some(row => !row.deleted && normalizeContactPhone(row.data!.mobile) === phone)) return fail();
      const after = await cap.repository.get(); check(); if (JSON.stringify(after) !== JSON.stringify(before)) return fail();
      const from = Date.now(); output = { key, ...payload, from, until: from + 30_000, snapshot };
    } finally { preparing = false; }
  }
  return Object.freeze({ getState: consent.getState, subscribe: consent.subscribe, prepare,
    consume(snapshot: CloudClinicSnapshot, input: ProtectedWhatsAppAction) { if (!active() || preparing || writing || !output || output.snapshot !== snapshot || output.key !== keyOf(input)) return null;
      const current = output, time = Date.now(); output = null; if (time < current.from || time > current.until) return null; return { phone: current.phone, text: current.text }; },
    canClose() { const state = consent.getState(); return active() && !writing && !plan && !state.pendingOperationId && !state.draft && !state.loading && state.saveStatus === 'idle'; },
    async saveConsent(snapshot: CloudClinicSnapshot, values: Record<string, 'allowed' | 'declined'>) {
      if (!active() || writing || preparing) return fail(); writing = true; output = null;
      try {
        const key = JSON.stringify(values), existing = projectOriginalWhatsApp(snapshot).campaignConsent ?? {};
        if (plan && plan.key !== key) return fail();
        if (!plan) { const rows = Object.entries(values).filter(([phone, status]) => existing[phone] !== status) as [string, 'allowed' | 'declined'][];
          if (rows.some(([phone, status]) => normalizeContactPhone(phone) !== phone || !['allowed', 'declined'].includes(status))) return fail(); plan = { key, rows, index: 0 }; }
        const directory = projectCloudClinicOverview(snapshot, { from: snapshot.readTime.slice(0, 10), to: snapshot.readTime.slice(0, 10) }).directory;
        while (plan.index < plan.rows.length) {
          const [phone, status] = plan.rows[plan.index], state = consent.getState();
          if (!state.pendingOperationId) {
            const row = directory.find(row => row.phone === phone), original = snapshot.records.contactRecords.find(row => !row.deleted && normalizeContactPhone(row.data!.mobile) === phone);
            if (!row || !(original ? consent.beginEdit(original) : consent.beginCreate())) return fail();
            if (!original && !consent.changeDraft({ name: row.name, mobile: phone })) return fail();
            if (!consent.changeCampaignConsent(status, consent.getState().draft!)) return fail();
          }
          await consent.save(); if (!active() || consent.getState().pendingOperationId || consent.getState().draft || consent.getState().saveStatus !== 'idle') return fail(); plan.index++;
        }
        plan = null; try { await onCommitted(); } catch { /* Confirmed consent records are not created again after report failure. */ }
      } catch (error) {
        if (!consent.getState().pendingOperationId) { consent.cancelDraft(); plan = null; try { await onCommitted(); } catch { /* Confirmed prefix is not undone. */ } }
        throw error;
      } finally { writing = false; }
    },
    async recoverPending() { return false; /* Retry the same consent selection so an unfinished batch cannot appear complete. */ },
    async cancelPending() { if (!active() || writing) return false; const result = await consent.cancelPending(); if (result) plan = null; return result; },
    dispose() { closed = true; generation++; output = null; plan = null; consent.dispose(); },
  });
}
export type CloudOriginalWhatsAppBridge = ReturnType<typeof createCloudOriginalWhatsAppBridge>;
