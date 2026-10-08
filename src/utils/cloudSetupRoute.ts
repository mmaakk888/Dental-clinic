import { isLocalClinicHost } from './localRuntime';

/** Select the isolated Auth setup page without reading any clinic storage. */
export function isCloudSetupRequest(hostname: string, search: string): boolean {
  if (!isLocalClinicHost(hostname)) return false;

  try {
    // URLSearchParams tolerates malformed escapes; reject them before parsing.
    decodeURIComponent(search);
    const values = new URLSearchParams(search).getAll('firebase-setup');
    return values.length === 1 && values[0] === '1';
  } catch {
    return false;
  }
}
