/** Local account/record storage is not a secure cloud authentication boundary. */
export function isLocalClinicHost(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname.toLowerCase());
}
