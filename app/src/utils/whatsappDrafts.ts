import type { WhatsappSettings } from '../types';

type Templates = WhatsappSettings['templates'];
/** Merge independent changes without overwriting a locally edited template. */
export function mergeWhatsAppTemplateDraft(current: Templates, baseline: Templates, incoming: Templates) {
  const templates = { ...incoming };
  const conflicts: string[] = [];
  for (const key of new Set([...Object.keys(baseline), ...Object.keys(current), ...Object.keys(incoming)])) {
    const name = key as keyof Templates;
    if (current[name] === baseline[name]) continue;
    if (incoming[name] !== baseline[name] && incoming[name] !== current[name]) conflicts.push(name);
    if (current[name] === undefined) delete templates[name];
    else templates[name] = current[name]!;
  }
  return { templates, conflicts };
}

export function hasIndividualWhatsAppDraft(input: { edited: string | null; link: string; image: unknown; patientId: string; date: string; time: string }) {
  return input.edited !== null || !!input.link.trim() || !!input.image || (!!input.patientId && (!!input.date || !!input.time));
}
