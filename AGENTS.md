# Dental Clinic Management System (نظام إدارة العيادة والأسنان)

## Project Overview & Features
This application is a full-featured Dental Clinic Management System built with React, Vite, and Tailwind CSS.

### Key Capabilities & Recent Updates:
1. **Mandatory Auth Gatekeeper & Security**:
   - The login screen (`LoginModal`) acts as an immediate guard on load. Anyone opening the app URL without a session cannot view clinic data or patient details.
   - Includes a **Remember Me ("تذكرني")** feature to automatically log in valid users on trusted devices.
   - **Auto Session Invalidation**: If a user's password, username, or account is modified or deleted by an admin, any active auto-login session for that account is automatically invalidated and logged out.

2. **Adaptive Responsive Layout & TV Mode (60-inch Screens)**:
   - Built to adapt dynamically across Mobile, Tablet, Desktop, and Ultra-wide displays.
   - Features a dedicated **"وضع الشاشات الكبيرة 60 بوصة" (TV Mode)** toggle in the top navigation bar (`HeaderNavbar`), which automatically scales fonts, touch targets, and icons (`.tv-mode`) for seamless visibility from a distance in clinic rooms or waiting area displays.

3. **Invoices & Receipts Photo Attachment**:
   - Expenses (`SummaryView`) support attaching photos/scans of supply invoices and receipts directly from mobile cameras or file upload.
   - Includes an interactive high-resolution Lightbox viewer for reviewing, zooming, and downloading invoice images.

4. **Multi-User Role Access**:
   - Supports Doctor (طبيب) and Secretary (سكرتيرة) roles with granular permission levels.

5. **Financial & Operations Summary**:
   - Complete tracking for treatments, lab cases (معامل التركيبات), clinic expenses (fixed & supplies), patient balances, and daily financial metrics.

6. **Touch-First Modal Controls (زر إلغاء وإغلاق لمس لجميع النوافذ)**:
   - All modals, search overlays, popups, and lightboxes feature clear, dedicated "إلغاء وإغلاق" touch buttons, enabling effortless operation on mobile phones, tablets, and 60-inch touchscreens without requiring a physical keyboard or Esc key.

