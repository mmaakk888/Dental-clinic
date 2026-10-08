import { CLOUD_CLINIC_ID, type CloudOwnerIdentity } from './cloudIdentity';

export const CLOUD_OWNER_MEMBERSHIP_SCHEMA_VERSION = 1;

/** Trusted canonical metadata only. No clinical permissions are represented by v1. */
export interface CloudOwnerMembership {
  schemaVersion: typeof CLOUD_OWNER_MEMBERSHIP_SCHEMA_VERSION;
  clinicId: typeof CLOUD_CLINIC_ID;
  uid: string;
  role: 'owner';
  status: 'active' | 'disabled';
  identityVersion: number;
  verifiedAfter: number;
}

export interface CloudOwnerMembershipAssessment {
  status: 'membership-confirmed';
  identityVersion: number;
  verifiedAfter: number;
}

const MEMBERSHIP_KEYS = [
  'schemaVersion', 'clinicId', 'uid', 'role', 'status', 'identityVersion', 'verifiedAfter',
] as const;
const IDENTITY_KEYS = ['uid', 'email', 'status'] as const;
const MEMBERSHIP_ERROR = 'تعذر التحقق من عضوية مالك العيادة.';

function invalidMembership(): never {
  throw new Error(MEMBERSHIP_ERROR);
}

/** Read exact plain own data properties without evaluating an input getter. */
function exactDataRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalidMembership();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalidMembership();
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some(key => typeof key !== 'string' || !keys.includes(key))) {
    invalidMembership();
  }
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) invalidMembership();
    result[key] = descriptor.value;
  }
  return result;
}

function isUid(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128
    && value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value);
}

function isTimestampSeconds(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Validate and copy the exact v1 canonical record. Disabled records are valid
 * metadata but cannot pass assessment. This parser does not establish trust in
 * a client-supplied record or authorize application/data access.
 */
export function parseCloudOwnerMembership(value: unknown): CloudOwnerMembership {
  try {
    const fields = exactDataRecord(value, MEMBERSHIP_KEYS);
    if (fields.schemaVersion !== CLOUD_OWNER_MEMBERSHIP_SCHEMA_VERSION
      || fields.clinicId !== CLOUD_CLINIC_ID || !isUid(fields.uid)
      || fields.role !== 'owner' || (fields.status !== 'active' && fields.status !== 'disabled')
      || typeof fields.identityVersion !== 'number' || !Number.isSafeInteger(fields.identityVersion)
      || fields.identityVersion <= 0 || !isTimestampSeconds(fields.verifiedAfter)) {
      invalidMembership();
    }
    return {
      schemaVersion: CLOUD_OWNER_MEMBERSHIP_SCHEMA_VERSION,
      clinicId: CLOUD_CLINIC_ID,
      uid: fields.uid,
      role: 'owner',
      status: fields.status,
      identityVersion: fields.identityVersion,
      verifiedAfter: fields.verifiedAfter,
    };
  } catch {
    // Malformed descriptors and Proxy traps must not leak input/error details.
    return invalidMembership();
  }
}

/**
 * Diagnostic only, after the SDK identity and a trusted membership read.
 * Server/rules enforcement is still required. authTime is the original sign-in
 * time in integer seconds, not token issue/refresh time or the local clock.
 */
export function assessCloudOwnerMembership(
  identity: CloudOwnerIdentity,
  value: unknown,
  authTime: number,
): CloudOwnerMembershipAssessment {
  try {
    const checkedIdentity = exactDataRecord(identity, IDENTITY_KEYS);
    const membership = parseCloudOwnerMembership(value);
    if (checkedIdentity.status !== 'owner-confirmed' || !isUid(checkedIdentity.uid)
      || typeof checkedIdentity.email !== 'string' || checkedIdentity.email.trim().length === 0
      || checkedIdentity.email !== checkedIdentity.email.trim()
      || membership.uid !== checkedIdentity.uid || membership.status !== 'active'
      || !isTimestampSeconds(authTime) || authTime < membership.verifiedAfter) {
      invalidMembership();
    }
    return {
      status: 'membership-confirmed',
      identityVersion: membership.identityVersion,
      verifiedAfter: membership.verifiedAfter,
    };
  } catch {
    return invalidMembership();
  }
}
