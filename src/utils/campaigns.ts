import { ClinicContact, Patient } from '../types';
import { normalizeContactPhone, normalizeContactSearch } from './clinicContacts';
import {hasPatientFile} from './patientFileIdentity';

// A campaign never needs sessions, payments, notes, or fabricated clinical files.
export type CampaignRecipient = {
  id: string;
  name: string;
  mobile: string;
  phone: string;
  patientIds: string[];
  searchNames: string[];
} & ({ source: 'patient'; fileNo: string } | { source: 'contact'; fileNo?: never });

const normalizedText = normalizeContactSearch;

// One recipient per phone. A real patient file takes precedence over a contact,
// and all files sharing the phone remain visible without duplicating a message.
export function campaignRecipients(patients: Patient[], contacts: ClinicContact[] = []): CampaignRecipient[] {
  const byPhone = new Map<string, CampaignRecipient>();
  for (const patient of patients) {
    if(!hasPatientFile(patient))continue;
    const phone = normalizeContactPhone(patient.mobile);
    if (!phone) continue;
    const existing = byPhone.get(phone);
    if (existing) { existing.patientIds.push(patient.id); existing.searchNames.push(patient.name); continue; }
    byPhone.set(phone, { id: patient.id, name: patient.name, mobile: patient.mobile, phone, source: 'patient', fileNo: patient.id, patientIds: [patient.id], searchNames: [patient.name] });
  }
  for (const contact of contacts) {
    const phone = normalizeContactPhone(contact.mobile);
    if (!phone) continue;
    const existing = byPhone.get(phone);
    if (existing) { existing.searchNames.push(contact.name); continue; }
    byPhone.set(phone, { id: contact.id, name: contact.name, mobile: contact.mobile, phone, source: 'contact', patientIds: [], searchNames: [contact.name] });
  }
  const contactsById=new Map(contacts.map(c=>[c.id,c]));for(const patient of patients)if(!hasPatientFile(patient)&&patient.contactId){const contact=contactsById.get(patient.contactId);const recipient=contact?byPhone.get(normalizeContactPhone(contact.mobile)):undefined;if(recipient&&!recipient.searchNames.includes(patient.name))recipient.searchNames.push(patient.name);}
  return [...byPhone.values()];
}

export function campaignRecipientLabel(recipient: CampaignRecipient): string {
  return recipient.source === 'contact' ? 'جهة اتصال بدون ملف' : recipient.patientIds.length > 1
    ? `ملفات ${recipient.patientIds.map(id => `#${id}`).join('، ')}` : `ملف #${recipient.fileNo}`;
}

export function matchesCampaignRecipient(recipient: CampaignRecipient, search: string): boolean {
  const query = normalizedText(search);
  if (!query) return true;
  if (query.startsWith('#')) return recipient.patientIds.some(id => normalizedText(id) === query.slice(1).trim());
  if (recipient.searchNames.some(name => normalizedText(name).includes(query))) return true;
  if (recipient.patientIds.some(id => normalizedText(id).includes(query))) return true;
  // Do not turn letters or internal contact IDs into a phone-number search.
  if (!/^[+\d\s()-]+$/.test(query) || !/\d/.test(query)) return false;
  const normalizedPhone = normalizeContactPhone(query);
  const digits = query.replace(/\D/g, '');
  return recipient.phone.includes(normalizedPhone || digits)
    || recipient.phone.startsWith('201') && `0${recipient.phone.slice(2)}`.includes(digits);
}

export function campaignRecipientCanReceive(recipient: CampaignRecipient, consent?: Record<string, 'allowed' | 'declined'>): boolean {
  return consent?.[recipient.phone] === 'allowed';
}
