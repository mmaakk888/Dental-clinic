import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import CloudSetupPage from '../components/auth/CloudSetupPage';

function renderAt(hostname: string, search: string): string {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { hostname, search } } });
  try { return renderToStaticMarkup(React.createElement(CloudSetupPage)); }
  finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  }
}

test('isolated setup initially renders accessible private entry with no remembered session or clinical access claims', () => {
  const html = renderAt('127.0.0.1', '?firebase-setup=1');
  assert.match(html, /تأكيد حساب مالك العيادة/u);
  assert.match(html, /id="cloud-setup-email"/u);
  assert.match(html, /type="email"/u);
  assert.match(html, /type="password"/u);
  assert.match(html, /autoComplete="current-password"/u);
  assert.match(html, /لا تحمل ملفات المرضى أو ترفعها/u);
  assert.match(html, /لا يشغّل المزامنة/u);
  assert.match(html, /مؤقت في الذاكرة/u);
  assert.doesNotMatch(html, /type="checkbox"/u);
  assert.doesNotMatch(html, /إرسال رسالة تأكيد البريد/u);
  assert.doesNotMatch(html, /هوية المالك والبريد مؤكدان/u);
});

test('setup component independently refuses nonloopback and invalid or duplicate setup queries', () => {
  for (const [host, search] of [
    ['clinic.web.app', '?firebase-setup=1'],
    ['localhost.attacker.invalid', '?firebase-setup=1'],
    ['127.0.0.1', ''],
    ['127.0.0.1', '?firebase-setup=1&firebase-setup=1'],
  ]) {
    const html = renderAt(host, search);
    assert.match(html, /نفس اللاب فقط/u);
    assert.doesNotMatch(html, /<form/u);
    assert.doesNotMatch(html, /cloud-setup-password/u);
  }
});
