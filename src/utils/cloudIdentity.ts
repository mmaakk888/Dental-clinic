export const CLOUD_PROJECT_ID = 'osama-clinic-38706';
export const CLOUD_CLINIC_ID = 'main';

export interface CloudOwnerIdentity {
  uid: string;
  email: string;
  status: 'verification-required' | 'owner-confirmed';
}

type CloudOwnerIdentityInput = {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  token: {
    claims: Record<string, unknown>;
    signInProvider: string | null;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function ownClaim(claims: Record<string, unknown>, name: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(claims, name);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

function isNonemptyEmail(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value === value.trim();
}

/**
 * Assess SDK-provided identity for the isolated setup diagnostic only.
 * This does not verify a token signature or authorize clinic data or app entry.
 */
export function assessCloudOwnerIdentity(input: CloudOwnerIdentityInput): CloudOwnerIdentity {
  if (!isRecord(input) || typeof input.uid !== 'string' || input.uid.length === 0 || input.uid.length > 128
    || input.uid !== input.uid.trim() || /[\u0000-\u001f\u007f]/u.test(input.uid)
    || !isRecord(input.token) || !isRecord(input.token.claims)) {
    throw new Error('تعذر التحقق من هوية الحساب.');
  }

  const { uid, email, emailVerified, token } = input;
  const { claims } = token;
  if (ownClaim(claims, 'sub') !== uid) {
    throw new Error('تعذر مطابقة هوية الحساب.');
  }
  if (ownClaim(claims, 'aud') !== CLOUD_PROJECT_ID
    || ownClaim(claims, 'iss') !== `https://securetoken.google.com/${CLOUD_PROJECT_ID}`) {
    throw new Error('الحساب لا يتبع مشروع العيادة.');
  }
  if (token.signInProvider !== 'password') {
    throw new Error('يلزم الدخول بالبريد وكلمة السر.');
  }
  if (ownClaim(claims, 'dentalClinicId') !== CLOUD_CLINIC_ID || ownClaim(claims, 'dentalClinicRole') !== 'owner') {
    throw new Error('الحساب غير معتمد كمالك للعيادة.');
  }

  const tokenEmail = ownClaim(claims, 'email');
  if (!isNonemptyEmail(email) || !isNonemptyEmail(tokenEmail) || email.toLowerCase() !== tokenEmail.toLowerCase()) {
    throw new Error('تعذر مطابقة بريد الحساب.');
  }

  return {
    uid,
    email,
    status: emailVerified === true && ownClaim(claims, 'email_verified') === true
      ? 'owner-confirmed'
      : 'verification-required',
  };
}
