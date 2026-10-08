import {lazy, StrictMode, Suspense} from 'react';
import {createRoot} from 'react-dom/client';
import { ErrorBoundary } from './components/common/ErrorBoundary.tsx';
import { isCloudSetupRequest } from './utils/cloudSetupRoute';
import './index.css';

// Select before importing/mounting AppContent: setup must never hydrate clinic data.
const RootPage = lazy(() => isCloudSetupRequest(window.location.hostname, window.location.search)
  ? import('./components/auth/CloudSetupPage.tsx')
  : import('./App.tsx'));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <Suspense fallback={<main dir="rtl" className="min-h-screen grid place-items-center bg-slate-50 p-6" role="status">جاري فتح الصفحة…</main>}>
        <RootPage />
      </Suspense>
    </ErrorBoundary>
  </StrictMode>,
);


