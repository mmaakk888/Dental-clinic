import {lazy, StrictMode, Suspense} from 'react';
import {createRoot} from 'react-dom/client';
import { ErrorBoundary } from './components/common/ErrorBoundary.tsx';
import { resolveClinicEntry } from './utils/clinicEntryRoute';
import './index.css';
import './components/home/HomeView.css';
import './components/common/HeaderNavbar.css';
import './components/auth/CloudClinicShell.css';
import './components/navigation/dockAppearance.css';

// Resolve before App import: neither preparation nor a closed external entry
// may initialize local accounts or hydrate clinical/financial records.
const entry = resolveClinicEntry(window.location.hostname, window.location.search, window.location.protocol);
const RootPage = lazy(() => {
  if (entry === 'setup') return import('./components/auth/CloudSetupPage.tsx');
  if (entry === 'operating') return import('./components/auth/CloudOperatingPage.tsx');
  if (entry === 'blocked') return import('./components/auth/CloudUnavailablePage.tsx');
  return import('./App.tsx');
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <Suspense fallback={<main dir="rtl" className="min-h-screen grid place-items-center bg-slate-50 p-6" role="status">جاري فتح الصفحة…</main>}>
        <RootPage />
      </Suspense>
    </ErrorBoundary>
  </StrictMode>,
);


