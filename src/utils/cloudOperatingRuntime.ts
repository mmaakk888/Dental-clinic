import { isLocalClinicHost } from './localRuntime';
import { CLOUD_COMPLETE_RELEASE_UI } from './cloudReleaseReadiness';
import { CLOUD_PROJECT_ID } from './cloudIdentity';

export const CLOUD_OPERATING_HOST = `${CLOUD_PROJECT_ID}.web.app`;

/** Shared operating-only boundary. It never permits the local App/setup on
 * production, and remains closed there until the reviewed source gate opens.
 * No URL, environment, browser storage or caller-provided enable flag. */
export function isCloudOperatingRuntime(hostname: string, protocol: string): boolean {
  return isLocalClinicHost(hostname)
    || CLOUD_COMPLETE_RELEASE_UI.available && hostname === CLOUD_OPERATING_HOST && protocol === 'https:';
}
