import { cleanEgyptianPhone, fillMessageTemplate } from './whatsappUtils';

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
  return { message, financeAllowed, consentAllowed, unsupportedVariables, unfinished };
}

export function whatsAppComposerContextKey(patientId: string, phone: string, canViewPatientFinance = false, campaignTemplate?: string) {
  return JSON.stringify([patientId, cleanEgyptianPhone(phone), canViewPatientFinance, campaignTemplate ?? 'individual']);
}
