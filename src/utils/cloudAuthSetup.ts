import config from '../../firebase.cloud-config.json';
import { assessCloudOwnerIdentity, CLOUD_PROJECT_ID, type CloudOwnerIdentity } from './cloudIdentity';
import { isLocalClinicHost } from './localRuntime';

class SetupError extends Error {}
class IdentityError extends SetupError {}

export function cloudSetupNeedsSignIn(error: unknown): boolean {
  return error instanceof IdentityError;
}

/** Never expose Firebase's raw errors, credentials, token, or request payload. */
export function cloudSetupErrorMessage(error: unknown): string {
  let code: unknown = null;
  try {
    if (error instanceof SetupError) return error.message;
    // Provider errors use an own data property; never invoke unknown getters.
    if (error && typeof error === 'object') {
      const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
      code = descriptor && 'value' in descriptor ? descriptor.value : null;
    }
  } catch { /* Even a malformed/Proxy error must produce a fixed safe message. */ }
  if (code === 'auth/network-request-failed') return 'تعذر الاتصال بـ Firebase. راجع الإنترنت وحاول مرة أخرى.';
  if (code === 'auth/too-many-requests') return 'طلبات كثيرة خلال وقت قصير. انتظر قليلًا وحاول مرة أخرى.';
  return 'تعذر إكمال العملية. راجع البريد وكلمة السر والاتصال بالإنترنت.';
}

export interface CloudSetupAdapter {
  signIn(email: string, password: string): Promise<void>;
  readIdentity(): Promise<CloudOwnerIdentity>;
  sendVerification(): Promise<void>;
  signOut(): Promise<void>;
  destroy(): Promise<void>;
}

/** Single-flight lifecycle, independently testable without a real account. */
export function createCloudSetupSession(adapter: CloudSetupAdapter) {
  let disposed = false;
  let pending: Promise<unknown> | null = null;
  let disposal: Promise<void> | null = null;

  function perform<T>(action: () => Promise<T>): Promise<T> {
    if (disposed) return Promise.reject(new SetupError('أُغلقت جلسة التجهيز. افتح الصفحة من جديد.'));
    if (pending) return Promise.reject(new SetupError('انتظر انتهاء العملية الحالية.'));
    const work = Promise.resolve().then(action).then(result => {
      if (disposed) throw new SetupError('أُغلقت جلسة التجهيز.');
      return result;
    });
    pending = work;
    return work.finally(() => { if (pending === work) pending = null; });
  }

  return {
    signIn: (email: string, password: string) => perform(async () => {
      if (typeof email !== 'string' || email.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email.trim())
        || typeof password !== 'string' || !password.length || password.length > 4096) {
        throw new SetupError('اكتب البريد الإلكتروني وكلمة السر الخاصة بحساب Firebase.');
      }
      try {
        await adapter.signIn(email.trim(), password);
        return await adapter.readIdentity();
      } catch (error) {
        await adapter.signOut().catch(() => undefined);
        throw error;
      }
    }),
    refresh: () => perform(async () => {
      try { return await adapter.readIdentity(); }
      catch (error) { await adapter.signOut().catch(() => undefined); throw error; }
    }),
    sendVerification: () => perform(async () => {
      let identity: CloudOwnerIdentity;
      try { identity = await adapter.readIdentity(); }
      catch {
        await adapter.signOut().catch(() => undefined);
        throw new IdentityError('تعذر التحقق من صلاحية الحساب. سجّل الدخول من جديد.');
      }
      if (identity.status !== 'verification-required') throw new SetupError('البريد مؤكد بالفعل. حدّث الحالة بدل إرسال رسالة جديدة.');
      await adapter.sendVerification();
    }),
    signOut: () => perform(() => adapter.signOut()),
    dispose: () => {
      if (disposal) return disposal;
      disposed = true;
      const prior = pending;
      disposal = (async () => {
        await prior?.catch(() => undefined);
        try { await adapter.signOut(); } finally { await adapter.destroy(); }
      })();
      return disposal;
    },
  };
}

export type CloudSetupSession = ReturnType<typeof createCloudSetupSession>;

/** Explicit local diagnostic only: no clinic storage, Firestore or old backup app. */
export async function createCloudAuthSetupService(): Promise<CloudSetupSession> {
  if (typeof window === 'undefined' || !isLocalClinicHost(window.location.hostname)) throw new SetupError('التجهيز متاح على نفس اللاب فقط.');
  if (config.projectId !== CLOUD_PROJECT_ID || config.authDomain !== `${CLOUD_PROJECT_ID}.firebaseapp.com`) throw new SetupError('إعداد مشروع العيادة غير مطابق.');
  const [apps, sdk] = await Promise.all([import('firebase/app'), import('firebase/auth')]);
  // Separate per-page app: an old pending cleanup cannot sign out a new page.
  const app = apps.initializeApp(config, `clinic-owner-setup-${crypto.randomUUID()}`);
  try {
    const auth = sdk.initializeAuth(app, { persistence: sdk.inMemoryPersistence });
    auth.languageCode = 'ar';
    if (auth.emulatorConfig) throw new SetupError('لا يُستخدم محاكي الدخول لتجهيز حساب حقيقي.');
    const readIdentity = async () => {
      const user = auth.currentUser;
      if (!user) throw new SetupError('سجّل الدخول أولًا.');
      await sdk.reload(user);
      const token = await sdk.getIdTokenResult(user, true);
      if (auth.currentUser?.uid !== user.uid) throw new SetupError('تغيرت جلسة الدخول. حاول مرة أخرى.');
      try { return assessCloudOwnerIdentity({ uid: user.uid, email: user.email, emailVerified: user.emailVerified, token }); }
      catch { throw new SetupError('الحساب لا يحمل هوية مالك معتمدة لهذا المشروع. راجع مسؤول التجهيز.'); }
    };
    return createCloudSetupSession({
      signIn: async (email, password) => { await sdk.signInWithEmailAndPassword(auth, email, password); },
      readIdentity,
      sendVerification: async () => {
        if (!auth.currentUser) throw new SetupError('سجّل الدخول أولًا.');
        await sdk.sendEmailVerification(auth.currentUser);
      },
      signOut: () => sdk.signOut(auth),
      destroy: () => apps.deleteApp(app),
    });
  } catch (error) { await apps.deleteApp(app).catch(() => undefined); throw error; }
}
