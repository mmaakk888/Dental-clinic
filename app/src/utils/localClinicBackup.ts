import { assertClinicBackup, MAX_BACKUP_BYTES, type ValidatedClinicBackup } from './backupValidation';
import { secureUserAccountsForStorage } from './passwords';
import { downloadTransferBlob } from './patientSpreadsheets';

export const LOCAL_BACKUP_FORMAT = 'dental-clinic-local-backup';
export const LOCAL_BACKUP_VERSION = 1;
export interface LocalBackupPreview {
  data: ValidatedClinicBackup;
  exportedAt: string | null;
  legacy: boolean;
}

// Provider credentials are not clinic data. Sessions, remembered accounts and
// runtime settings are excluded by the validator's known-section allowlist.
function withoutProviderSecret(data: ValidatedClinicBackup): ValidatedClinicBackup {
  const strip = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    for (const key of Object.keys(value)) {
      if (['apikey', 'apisecret', 'apitoken', 'accesstoken', 'refreshtoken', 'idtoken', 'token', 'secret', 'webhooksecret', 'clientsecret', 'privatekey', 'signingkey', 'serviceaccount', 'serviceaccountkey', 'credentials', 'authorization', 'bearertoken', 'password'].includes(key.replace(/[_-]/g, '').toLowerCase())) delete (value as Record<string, unknown>)[key];
      else strip((value as Record<string, unknown>)[key]);
    }
  };
  if (data.whatsappSettings) {
    strip(data.whatsappSettings);
    data.whatsappSettings.apiKey = '';
    // URLs may embed basic-auth credentials or secret query/path tokens. A
    // restored backup must not silently re-enable a provider connection.
    data.whatsappSettings.webhookUrl = '';
  }
  return data;
}

export async function serializeLocalClinicBackup(input: unknown, now = new Date()): Promise<string> {
  const data = withoutProviderSecret(assertClinicBackup(input));
  // An old local account may still have a plaintext credential. Hash only the
  // exported copy; never migrate the owner's saved account during export/QA.
  if (data.users) data.users = await secureUserAccountsForStorage(data.users, data.users);
  const serialized = JSON.stringify({ format: LOCAL_BACKUP_FORMAT, version: LOCAL_BACKUP_VERSION, exportedAt: now.toISOString(), data });
  if (new TextEncoder().encode(serialized).byteLength > MAX_BACKUP_BYTES) throw new Error('النسخة تتجاوز حد ٦٤ ميجابايت؛ لم يتم تنزيل ملف غير قابل للاستعادة.');
  return serialized;
}

export function parseLocalClinicBackup(text: string): LocalBackupPreview {
  if (!text.trim() || new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) throw new Error('اختر ملف JSON غير فارغ بحجم لا يتجاوز ٦٤ ميجابايت.');
  let parsed: unknown;
  try { parsed = JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch { throw new Error('ملف JSON تالف أو غير مقروء؛ لم تبدأ الاستعادة.'); }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Object.hasOwn(parsed, 'format')) {
    const envelope = parsed as Record<string, unknown>;
    if (envelope.format !== LOCAL_BACKUP_FORMAT || envelope.version !== LOCAL_BACKUP_VERSION) throw new Error('صيغة النسخة أو إصدارها غير مدعوم؛ لم تبدأ الاستعادة.');
    if (typeof envelope.exportedAt !== 'string' || !Number.isFinite(Date.parse(envelope.exportedAt))) throw new Error('تاريخ إنشاء النسخة غير صالح؛ لم تبدأ الاستعادة.');
    return { data: withoutProviderSecret(assertClinicBackup(envelope.data)), exportedAt: envelope.exportedAt, legacy: false };
  }
  return { data: withoutProviderSecret(assertClinicBackup(parsed)), exportedAt: null, legacy: true };
}

export async function readLocalClinicBackup(file: File): Promise<LocalBackupPreview> {
  if (!/\.json$/i.test(file.name) || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_BACKUP_BYTES) throw new Error('اختر ملف JSON غير فارغ بحجم لا يتجاوز ٦٤ ميجابايت.');
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength > MAX_BACKUP_BYTES || bytes.byteLength !== file.size) throw new Error('حجم ملف النسخة غير مطابق أو يتجاوز ٦٤ ميجابايت؛ لم تبدأ الاستعادة.');
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error('ترميز النسخة ليس UTF-8 صالحًا؛ لم تبدأ الاستعادة.'); }
  return parseLocalClinicBackup(text);
}

export async function downloadLocalClinicBackup(getSnapshot: () => Promise<unknown>, authorize: () => void): Promise<void> {
  authorize();
  const snapshot = await getSnapshot();
  authorize();
  const now = new Date();
  const serialized = await serializeLocalClinicBackup(snapshot, now);
  authorize();
  downloadTransferBlob(new Blob([serialized], { type: 'application/json;charset=utf-8' }), `dental-clinic-backup-${now.toISOString().replace(/[:.]/g, '-')}.json`, authorize);
}

export function localBackupSectionSummary(data: ValidatedClinicBackup): { key: string; label: string; count: number | null }[] {
  const lists = [ ['patients', 'ملفات المرضى'], ['contacts', 'جهات الاتصال'], ['appointments', 'المواعيد'],
    ['labs', 'المعامل'], ['labCases', 'حالات المعامل'], ['expenses', 'المصروفات'], ['materialUsages', 'حركات الخامات'],
    ['users', 'حسابات الدخول'], ['serviceTypes', 'الخدمات'], ['drugCatalog', 'الأدوية'] ] as const;
  return lists.map(([key, label]) => ({ key, label, count: data[key]?.length ?? null }));
}
