import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ErrorBoundary } from '../components/common/ErrorBoundary';

test('render fallback makes no save guarantee and never retains or displays raw error details', () => {
  const secret = 'synthetic-record-and-token-never-render';
  const raw = new Error(secret);
  const derived = ErrorBoundary.getDerivedStateFromError();
  assert.deepEqual(derived, { hasError: true });
  const boundary = new ErrorBoundary({ children: React.createElement('span', null, 'healthy') });
  boundary.state = derived;
  const html = renderToStaticMarkup(boundary.render());
  assert.match(html, /لا تؤكد نجاح الحفظ/u);
  assert.doesNotMatch(html, /تم حفظ بياناتك بأمان|animate-spin|synthetic-record-and-token-never-render/u);
  assert.equal(Object.values(boundary.state).includes(raw as never), false);
});

test('error diagnostics use a fixed safe message rather than the exception or React component stack', () => {
  const boundary = new ErrorBoundary({ children: null });
  const previous = console.error;
  const logged: unknown[][] = [];
  console.error = (...values: unknown[]) => { logged.push(values); };
  try {
    // React supplies these arguments at runtime. They must be ignored.
    (boundary.componentDidCatch as (...values: unknown[]) => void)(new Error('synthetic-token'), { componentStack: 'synthetic-patient' });
  } finally { console.error = previous; }
  assert.equal(logged.length, 1);
  assert.equal(logged[0].length, 1);
  assert.doesNotMatch(String(logged[0][0]), /synthetic-token|synthetic-patient/u);
});

test('healthy boundary leaves its child unchanged and does not claim a save', () => {
  const child = React.createElement('p', null, 'synthetic child');
  const boundary = new ErrorBoundary({ children: child });
  assert.equal(boundary.render(), child);
});
