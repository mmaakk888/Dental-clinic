import type { User } from '../types';

// WebCrypto is available on HTTPS and localhost. This hardens a local demo;
// it does not replace authoritative server authentication or protect localStorage
// from somebody who controls this browser/profile.
// OWASP Password Storage Cheat Sheet: PBKDF2-HMAC-SHA256 >= 600,000 iterations.
export const PASSWORD_HASH_PREFIX = 'pbkdf2-sha256';
export const PASSWORD_HASH_ITERATIONS = 600_000;
const MAX_HASH_ITERATIONS = 2_000_000;
const SALT_BYTES = 16;
const DERIVED_BYTES = 32;
const INVALID_LOGIN = 'اسم الدخول أو كلمة السر غير صحيحة، أو الحساب غير متاح الآن.';
const hex = (bytes: Uint8Array) => Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
const fromHex = (value: string) => Uint8Array.from(value.match(/.{2}/g) || [], byte => parseInt(byte, 16));
const validPasswordInput = (value: unknown): value is string => typeof value === 'string'
  && Array.from(value).length > 0 && Array.from(value).length <= 128 && !/[\u0000-\u001f\u007f]/.test(value);

function parseHash(value: unknown): { iterations: number; salt: Uint8Array; derived: Uint8Array } | null {
  if (typeof value !== 'string') return null;
  const match = /^pbkdf2-sha256\$([1-9]\d{0,6})\$([a-f0-9]{32})\$([a-f0-9]{64})$/.exec(value);
  if (!match) return null;
  const iterations = Number(match[1]);
  if (iterations < PASSWORD_HASH_ITERATIONS || iterations > MAX_HASH_ITERATIONS) return null;
  return { iterations, salt: fromHex(match[2]), derived: fromHex(match[3]) };
}

export function isPasswordHash(value: unknown): boolean { return !!parseHash(value); }

export function hasPasswordCredential(user: Pick<User, 'password'>): boolean {
  if (isPasswordHash(user.password)) return true;
  // A malformed/unknown versioned credential must never become a legacy password.
  return validPasswordInput(user.password) && !user.password.startsWith(PASSWORD_HASH_PREFIX);
}

export function getSecureCredentialVersion(user: Pick<User, 'credentialVersion'>): number {
  if (user.credentialVersion === undefined) return 1;
  if (!Number.isSafeInteger(user.credentialVersion) || user.credentialVersion! < 1) {
    throw new Error('إصدار بيانات دخول الحساب غير صالح؛ راجع مدير العيادة.');
  }
  return user.credentialVersion!;
}

export function validateNewPassword(value: unknown): string | null {
  if (!validPasswordInput(value) || Array.from(value).length < 12 || !value.trim()) {
    return 'اكتب كلمة سر من 12 إلى 128 حرفًا؛ يمكنك استخدام عبارة طويلة، دون أسطر جديدة.';
  }
  return null;
}

function cryptoApi(): Crypto {
  if (!globalThis.crypto?.subtle || typeof globalThis.crypto.getRandomValues !== 'function') {
    throw new Error('يلزم اتصال HTTPS أو المعاينة المحلية لتأمين كلمة السر. لم تُحفظ بيانات الدخول.');
  }
  return globalThis.crypto;
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const api = cryptoApi();
  const material = await api.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await api.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material, DERIVED_BYTES * 8);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  if (!validPasswordInput(password)) throw new Error('كلمة سر الحساب غير صالحة؛ لم تُحفظ بيانات الدخول.');
  const salt = cryptoApi().getRandomValues(new Uint8Array(SALT_BYTES));
  const derived = await derive(password, salt, PASSWORD_HASH_ITERATIONS);
  return `${PASSWORD_HASH_PREFIX}$${PASSWORD_HASH_ITERATIONS}$${hex(salt)}$${hex(derived)}`;
}

const equalBytes = (left: Uint8Array, right: Uint8Array): boolean => {
  let difference = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index++) difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return difference === 0;
};

export async function verifyPassword(stored: unknown, password: string): Promise<boolean> {
  if (!validPasswordInput(password)) return false;
  const parsed = parseHash(stored);
  if (parsed) return equalBytes(await derive(password, parsed.salt, parsed.iterations), parsed.derived);
  if (!validPasswordInput(stored) || stored.startsWith(PASSWORD_HASH_PREFIX)) return false;
  // Legacy plaintext is accepted only to migrate it after successful verification.
  // Never write or expose that value again; persistence belongs to the caller.
  return equalBytes(new TextEncoder().encode(stored), new TextEncoder().encode(password));
}

export async function secureUserAccountsForStorage(users: User[], baseline?: User[]): Promise<User[]> {
  const secured: User[] = [];
  for (const user of users) {
    const copy = structuredClone(user);
    if (copy.password && !isPasswordHash(copy.password)) {
      if (!hasPasswordCredential(copy)) throw new Error('بيانات دخول أحد الحسابات غير صالحة؛ لم تُحفظ الحسابات.');
      copy.password = await hashPassword(copy.password);
      const original = baseline?.find(item => item.id === user.id);
      // A password replacement is already versioned by the account validator.
      // With a supplied baseline, a new account starts at one and an existing
      // credential replacement/migration advances exactly once, not twice.
      copy.credentialVersion = baseline !== undefined && !original ? 1
        : getSecureCredentialVersion(original || user) + 1;
      if (!Number.isSafeInteger(copy.credentialVersion)) throw new Error('تعذّر تجديد إصدار بيانات الدخول؛ لم تُحفظ الحسابات.');
    }
    secured.push(copy);
  }
  return secured;
}

export interface LocalAuthenticationResult { user: User; users: User[]; migrated: boolean; }

export async function authenticateLocalAccount(users: User[], username: string, password: string): Promise<LocalAuthenticationResult> {
  const identity = typeof username === 'string' ? username.trim().toLocaleLowerCase() : '';
  const matches = users.filter(user => typeof user?.username === 'string'
    && (user.username.trim().toLocaleLowerCase() === identity
      || (typeof user.email === 'string' && user.email.trim().toLocaleLowerCase() === identity)));
  if (!identity || matches.length !== 1) throw new Error(INVALID_LOGIN);
  const user = matches[0];
  if (typeof user.id !== 'string' || !user.id || users.filter(item => item.id === user.id).length !== 1) throw new Error(INVALID_LOGIN);
  if (user.isActive === false || !['doctor', 'admin', 'secretary'].includes(user.role)
    || !hasPasswordCredential(user) || !await verifyPassword(user.password, password)) throw new Error(INVALID_LOGIN);
  getSecureCredentialVersion(user);
  const migrated = !isPasswordHash(user.password);
  const nextUser = migrated ? (await secureUserAccountsForStorage([user]))[0] : structuredClone(user);
  const nextUsers = users.map(item => item.id === user.id ? nextUser : structuredClone(item));
  return { user: nextUser, users: nextUsers, migrated };
}
