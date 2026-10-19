import type { WhatsappSettings } from '../types';
import { cleanEgyptianPhone, extraMessageTemplates, fillMessageTemplate } from './whatsappUtils';

interface MessageSafetyInput {
  templateName: string;
  rawTemplate: string;
  editedText?: string | null;
  values: Record<string, string>;
  phone: string;
  campaignConsent?: Record<string, 'allowed' | 'declined'>;
  isCampaign?: boolean;
  canViewPatientFinance?: boolean;
}
const templateTokens = (text: string) => Array.from(new Set(text.match(/\{[^{}]+\}/g) || []));
const personalVariables = ['patientName', 'clinicName', 'fileNo', 'date', 'time'];
const campaignVariables = ['patientName', 'clinicName'];

// Do not substitute protected values merely because a saved custom template asks for them.
export function prepareSafeWhatsAppMessage(input: MessageSafetyInput) {
  const isCampaign = input.isCampaign === true;
  const financialTokens = [...templateTokens(input.rawTemplate), ...templateTokens(input.editedText || '')];
  const requestsFinance = input.templateName === 'accountBalance' || financialTokens.includes('{remainingBalance}');
  const allowFinancialValues = input.canViewPatientFinance === true && !isCampaign;
  const financeAllowed = !requestsFinance || allowFinancialValues;
  const allowedVariables = isCampaign ? campaignVariables : [...personalVariables, ...(allowFinancialValues ? ['remainingBalance'] : [])];
  const safeValues = Object.fromEntries(Object.entries(input.values).filter(([key]) => allowedVariables.includes(key)));
  const generated = fillMessageTemplate(input.rawTemplate, safeValues);
  // A protected rendered draft must not remain visible after its financial access is removed.
  const message = financeAllowed ? input.editedText ?? generated : generated;
  const unsupportedVariables = Array.from(new Set([...(isCampaign ? templateTokens(input.rawTemplate) : []), ...templateTokens(message)]))
    .filter(token => !allowedVariables.some(key => token === `{${key}}`));
  const requiresConsent = isCampaign || input.templateName === 'greeting' || input.templateName === 'offer';
  const consentAllowed = !requiresConsent || input.campaignConsent?.[cleanEgyptianPhone(input.phone)] === 'allowed';
  const unfinished = /\[[^\]]+\]/.test(message) || templateTokens(message).length > 0;
  return { message, requestsFinance, financeAllowed, consentAllowed, unsupportedVariables, unfinished };
}

export interface WhatsAppSendAuthorization {
  isCampaign: boolean;
  requiresFinance: boolean;
}

export function getWhatsAppDraftTemplate(templateName: string, settings: WhatsappSettings, campaignMessage?: string) {
  const stored = campaignMessage ?? settings.templates[templateName as keyof typeof settings.templates]
    ?? extraMessageTemplates[templateName as keyof typeof extraMessageTemplates]?.text ?? '';
  return templateName === 'reminderTomorrow' ? stored.replace('غداً {date}', 'يوم {date}') : stored;
}

export interface WhatsAppActionInput extends MessageSafetyInput {
  link: string;
  appointmentReady: boolean;
}
export interface ProtectedWhatsAppAction extends WhatsAppActionInput { patientFileNo: string | null }
export interface ProtectedWhatsAppActions {
  prepare(input: ProtectedWhatsAppAction): Promise<void>;
  consume(input: ProtectedWhatsAppAction): { phone: string; text: string } | null;
}

/** Run synchronously at the open/share click, never from a rendered `ready` snapshot. */
export function prepareFreshWhatsAppAction(
  input: WhatsAppActionInput,
  readSettings: () => WhatsappSettings,
  authorize?: (request: WhatsAppSendAuthorization) => void,
) {
  if (!authorize) throw new Error('تعذّر التحقق من صلاحية فتح واتساب. أعد فتح الرسالة وحاول مرة أخرى.');
  const latest = readSettings();
  if (!input.isCampaign && getWhatsAppDraftTemplate(input.templateName, latest) !== input.rawTemplate) {
    throw new Error('تغيّر قالب الرسالة في تبويب آخر. أعد فتح الرسالة وراجع النص المحدّث قبل المتابعة.');
  }
  const safety = prepareSafeWhatsAppMessage({ ...input, campaignConsent: latest.campaignConsent });
  const phone = cleanEgyptianPhone(input.phone);
  const link = input.link.trim();
  const text = safety.message + (link ? `\n${link}` : '');
  if (!/^[1-9]\d{7,14}$/.test(phone)) throw new Error('راجع رقم هاتف المستلم.');
  if (!input.appointmentReady) throw new Error('حدد تاريخ الموعد ووقته.');
  if (!safety.financeAllowed) throw new Error('هذه الرسالة تحتاج صلاحية الاطلاع على حساب المريض، ولا تُستخدم بيانات الحساب في الحملات.');
  if (!safety.consentAllowed) throw new Error('موافقة صاحب الرقم على رسائل الحملات غير متاحة في أحدث الإعدادات. راجع الموافقة قبل المتابعة.');
  if (safety.unfinished || safety.unsupportedVariables.length || /\[[^\]]+\]|\{[^{}]+\}/.test(text) || !safety.message.trim()) {
    throw new Error('راجع نص الرسالة وأكمل المتغيرات والأقواس قبل فتح واتساب.');
  }
  if (link) {
    let valid = false;
    try { const url = new URL(link); valid = ['https:', 'http:'].includes(url.protocol) && Boolean(url.hostname) && !/\s/.test(link); } catch { /* Invalid links are rejected below. */ }
    if (!valid) throw new Error('اكتب رابطاً كاملاً يبدأ بـ https://');
  }
  authorize({ isCampaign: input.isCampaign === true, requiresFinance: safety.requestsFinance });
  return { phone, text };
}

export function whatsAppComposerContextKey(patientId: string, phone: string, canViewPatientFinance = false, campaignTemplate?: string) {
  return JSON.stringify([patientId, cleanEgyptianPhone(phone), canViewPatientFinance, campaignTemplate ?? 'individual']);
}
