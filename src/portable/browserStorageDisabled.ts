// The production application never initializes local/demo medical records.
export const STORAGE_FAILURE_EVENT='dental-storage-failure';
export const CLINIC_CONTENT_STORAGE_KEYS:readonly string[]=[];
export const SERVICE_CATALOG_STORAGE_KEYS:readonly string[]=[];
export const CLINIC_DOMAIN_STORAGE_KEYS:readonly string[]=[];
export const USER_ACCOUNTS_STORAGE_KEY='portable-no-local-users';
export const DRUG_CATALOG_STORAGE_KEY='portable-no-local-drugs';
export const LABS_STORAGE_KEY='portable-no-local-labs';
export const WHATSAPP_SETTINGS_STORAGE_KEY='portable-no-local-whatsapp';
export const PRIVACY_MODE_STORAGE_KEY='portable-no-local-privacy';
export const PROSTHETIC_ROUTING_STORAGE_KEY='portable-no-local-routing';
export const Storage=new Proxy({}, {get(){throw Error('الحفظ المحلي معطّل؛ استخدم اتصال PHP الموثق.');}});
