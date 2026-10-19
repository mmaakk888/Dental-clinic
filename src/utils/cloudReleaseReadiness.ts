/** A reviewed source-release boundary, never a user permission. No URL,
 * environment or browser setting can override it. Auth and server Rules are
 * independently required. The replacement project's Auth, canonical owner,
 * empty bootstrap and exact compatible published Rules are now verified.
 * This enables a candidate build; it does not attest visual parity, live saves
 * or Hosting publication. There is no qualification inherited from the old project. */
export const CLOUD_COMPLETE_RELEASE_UI = Object.freeze({ available: true,
  reason: 'ربط المالك وقواعد التشغيل مؤكدان؛ النسخة متاحة للمراجعة قبل نشر ملفات الموقع.' });
