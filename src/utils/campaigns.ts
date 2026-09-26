import { Patient } from '../types';
import { cleanEgyptianPhone } from './whatsappUtils';

// One recipient per normalized phone, including families sharing a number.
export function campaignRecipients(patients: Patient[]) {
  const seen = new Set<string>();
  return patients.flatMap(patient => {
    const phone = cleanEgyptianPhone(patient.mobile);
    if (!/^[1-9]\d{7,14}$/.test(phone) || seen.has(phone)) return [];
    seen.add(phone);
    return [{ patient, phone }];
  });
}
