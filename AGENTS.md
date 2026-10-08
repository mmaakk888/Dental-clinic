# Dental Clinic Management System (نظام إدارة العيادة والأسنان)

## Project Overview & Features
This application is a local Dental Clinic Management System built with React, Vite, and Tailwind CSS. Read `SECURITY-FIXES.md` and `IMPLEMENTATION-STATUS.md` before security, deployment, or data work. Do not use real patient/account records as test fixtures.

### Key Capabilities & Recent Updates:
1. **Mandatory Auth Gatekeeper & Security**:
   - The login screen (`LoginModal`) is a local UI gate, **not authoritative authentication**. A person controlling the browser/profile can read or modify local data and unsigned sessions. The application refuses non-loopback hostnames until real authentication and a protected data layer are implemented.
   - Includes a **Remember Me ("تذكرني")** feature to automatically log in valid users on trusted devices.
   - **Auto Session Invalidation**: If a user's password, username, or account is modified or deleted by an admin, any active auto-login session for that account is automatically invalidated and logged out.
   - Passwords use PBKDF2-SHA256 with randomized salts. Legacy local credentials are migrated only through explicit account saves or successful login; do not change the owner's browser data for QA. Local work-hours checks are not server enforcement or IP restriction.
   - Domain mutations use a same-origin Web Lock, fresh persisted reads, and confirmed writes with rollback attempts. This is not an atomic database transaction or multi-device synchronization. Forms must await saves before showing success or clearing drafts.
   - AI endpoints are disabled by default and require verified Firebase Auth tokens plus explicit server allowlists. Build server code into `build/`, never the public `dist/`. Do not deploy, configure cloud rules, or enable paid providers without the user's scoped request.

2. **Adaptive Responsive Layout & TV Mode (60-inch Screens)**:
   - Built to adapt dynamically across Mobile, Tablet, Desktop, and Ultra-wide displays.
   - Preserve the owner's floating bottom navigation. Settings → Content & Layout offers ordering (home pinned), compact/comfortable/large sizes, optional labels, and 3 or 4 direct mobile links; the rest remain in More. Permissions are filtered before splitting. Do not introduce a duplicate top navigation menu.
   - The top header is for account/search/privacy/notifications/local status. Network availability is not confirmation of a save, backup, or shared sync. Notification acknowledgements are tab-memory state, not a persisted cloud activity log.

3. **Invoices & Receipts Photo Attachment**:
   - Expenses (`SummaryView`) support attaching photos/scans of supply invoices and receipts directly from mobile cameras or file upload.
   - Includes an interactive high-resolution Lightbox viewer for reviewing, zooming, and downloading invoice images.

4. **Multi-User Role Access**:
   - Supports Doctor (طبيب) and Secretary (سكرتيرة) roles with granular permission levels.

5. **Financial & Operations Summary**:
   - Complete tracking for treatments, lab cases (معامل التركيبات), clinic expenses (fixed & supplies), patient balances, and daily financial metrics.

6. **Touch-First Modal Controls (زر إلغاء وإغلاق لمس لجميع النوافذ)**:
   - All modals, search overlays, popups, and lightboxes feature clear, dedicated "إلغاء وإغلاق" touch buttons, enabling effortless operation on mobile phones, tablets, and 60-inch touchscreens without requiring a physical keyboard or Esc key.

7. **Owner Guide & Local Full Backup**:
   - Read `CLINIC-OWNER-GUIDE.ar.md` for the owner's local operation, backup, deployment prerequisites, and update/rollback workflow. `firebase.hosting.example.json` is preparation only; the template does not imply live deployment or application Auth/data integration. See section 8 for the separate cloud foundation already created.
   - Settings → Import/Export provides a full local JSON download and validated restore preview. Export fresh storage under the clinic lock and reauthorize before downloading; never substitute an Excel summary for a full backup. Legacy passwords are hashed only in the exported copy. Runtime sessions and provider credentials are excluded; the file still contains sensitive medical/financial records and password hashes and is not encrypted.

8. **Firebase Foundation (2026-10-08, not application integration)**:
   - The owner authenticated privately and authorized a separate project `dental-clinic-mmaakk888`. Email/password Auth and a `(default)` Standard Firestore database in owner-approved `europe-west1` exist. Live checks confirmed billing disabled/no billing account, freeTier=true, deletion protection enabled, PITR disabled, and exact published deny-all rules. Auth reports `IDENTITY_PLATFORM` on the Spark quota; do not claim unlimited basic Auth.
   - `firebase.auth.json` and `firebase.firestore.json` are scoped configurations applied only with explicit `--project dental-clinic-mmaakk888`. Neither deploys Hosting/Functions. Reapplying the current deny-all rules after future role-rule rollout would block application access; never include rules deployment in a routine UI update.
   - The operating app still uses local auth/storage and its previous Firebase client config. The previous `zippy-dispatcher-m1ttq` project/rules/data were not changed. Do not switch its client config or remove the loopback gate until trusted membership, cloud data separation, conflict handling and permission tests are implemented. No patient data migration or Hosting deployment has occurred. CLI login is not an app user.
   - Owner created their Auth account privately. Trusted IAM setup bound the exact checked UID to `dentalClinicId=main` / `dentalClinicRole=owner` while preserving other claims; email was unverified and was NOT administratively marked verified. Never bootstrap ownership from a client email or first signup. Future clinical rules/endpoints must separately enforce verified email and canonical membership/permissions, not UI claims alone.
   - `/?firebase-setup=1` is a loopback-only standalone diagnostic selected before App imports/hydrates records. SDK initializes only on explicit submit, with a unique named app and in-memory Auth from the start. It does not authenticate into local App, access Firestore/AI, migrate records or remember sessions. Verification email is sent only on user click. Test identity mismatch, email verification, single-flight/disposal and route isolation with synthetic accounts, never owner passwords. `firebase.cloud-config.json` holds public Web SDK identifiers only; old backup config stays unchanged. Preserve the explicit `[DEFAULT]` lookup so named setup apps cannot break old backup initialization.
