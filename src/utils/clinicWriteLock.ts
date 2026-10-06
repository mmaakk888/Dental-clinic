// Serializes same-origin clinic mutations across tabs, not across devices.
// Remote multi-user storage still requires a database transaction/server policy.
export interface ClinicLockManager {
  request<T>(name: string, callback: () => T | Promise<T>): Promise<T>;
}

export function withClinicWriteLock<T>(operation: () => T | Promise<T>, manager?: ClinicLockManager): Promise<T> {
  const locks = manager ?? (typeof navigator !== 'undefined' ? navigator.locks : undefined);
  if (!locks) return Promise.reject(new Error('المتصفح لا يدعم الحفظ الآمن بين التبويبات. افتح الموقع عبر HTTPS أو محليًا باستخدام متصفح حديث؛ لم يتم حفظ أي تغيير.'));
  return locks.request('dental-clinic-write-v1', operation);
}
