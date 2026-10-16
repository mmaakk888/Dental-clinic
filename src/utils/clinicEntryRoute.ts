import { isCloudSetupRequest } from './cloudSetupRoute';
import { isLocalClinicHost } from './localRuntime';
import { isCloudOperatingRuntime } from './cloudOperatingRuntime';

export type ClinicEntryRoute = 'local' | 'setup' | 'operating' | 'blocked';

/** Resolve before importing App: closed cloud entries must not hydrate records. */
export function resolveClinicEntry(hostname: string, search: string, protocol = ''): ClinicEntryRoute {
  const local = isLocalClinicHost(hostname);
  if (!isCloudOperatingRuntime(hostname, protocol)) return 'blocked';
  try {
    decodeURIComponent(search);
    const parameters = new URLSearchParams(search);
    const operating = parameters.getAll('clinic-cloud');
    const setup = parameters.getAll('firebase-setup');
    if (operating.length && setup.length) return 'blocked';
    if (operating.length) return operating.length === 1 && operating[0] === '1' ? 'operating' : 'blocked';
    if (setup.length) return local && isCloudSetupRequest(hostname, search) ? 'setup' : 'blocked';
    return local ? 'local' : 'operating';
  } catch {
    return 'blocked';
  }
}

export function isCloudOperatingRequest(hostname: string, search: string, protocol = ''): boolean {
  return resolveClinicEntry(hostname, search, protocol) === 'operating';
}
