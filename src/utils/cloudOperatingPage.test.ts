import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'esbuild';
import CloudOperatingPage from '../components/auth/CloudOperatingPage';
import CloudUnavailablePage from '../components/auth/CloudUnavailablePage';

function renderAt(hostname: string, search: string): string {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    location: { hostname, search },
    get localStorage() { throw new Error('No local clinical records may be read.'); },
    get sessionStorage() { throw new Error('No local session may be read.'); },
  } });
  try { return renderToStaticMarkup(React.createElement(CloudOperatingPage)); }
  finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  }
}

test('operating entry initially renders an accessible explicit login, not a cloud clinic or remembered session', () => {
  const html = renderAt('127.0.0.1', '?clinic-cloud=1');
  assert.match(html, /دخول التشغيل/u);
  assert.match(html, /id="operating-email"/u);
  assert.match(html, /type="email"/u);
  assert.match(html, /type="password"/u);
  assert.match(html, /autoComplete="current-password"/u);
  assert.match(html, /مؤقت في الذاكرة/u);
  assert.match(html, /لم يُنشر الموقع بعد/u);
  assert.match(html, /لا تدخل بيانات مرضى حقيقية/u);
  assert.doesNotMatch(html, /type="checkbox"|تم تأكيد الدخول وعضوية المالك|operating-remember/u);
  assert.match(html, /min-h-12/u);
  assert.match(html, /text-base/u);
  assert.match(html, /min-w-0/u);
  assert.match(html, /معاينة واجهة جهات الاتصال/u);
  assert.match(html, /معاينة واجهة ملفات المرضى/u);
  assert.match(html, /معاينة الملف السريري وسجل الاسترجاع/u);
  assert.match(html, /بلا بيانات أو اتصال بقاعدة البيانات/u);
  assert.match(html, /الحفظ السحابي غير مفعّل بعد/u);
  assert.doesNotMatch(html, /فتح جهات الاتصال من الخادم|فتح ملفات المرضى من الخادم|فتح الملف السريري وسجل الاسترجاع|cloud-contact-name|cloud-patient-name/u);
});

test('operating page independently blocks external, malformed, conflicting and duplicate routes', () => {
  for (const [host, search] of [['clinic.web.app', '?clinic-cloud=1'],
    ['127.0.0.1', ''], ['127.0.0.1', '?clinic-cloud=1&clinic-cloud=1'],
    ['127.0.0.1', '?clinic-cloud=1&firebase-setup=1'], ['127.0.0.1', '?clinic-cloud=%FF']]) {
    const html = renderAt(host, search);
    assert.match(html, /التشغيل السحابي لم يُفعّل بعد/u);
    assert.doesNotMatch(html, /<form|operating-password/u);
  }
});

test('operating entry graph excludes App, clinic records, local authentication, AI and previous backup client', async () => {
  const result = await build({ entryPoints: ['src/components/auth/CloudOperatingPage.tsx'], bundle: true,
    write: false, outdir: 'synthetic-bundle-only', metafile: true, platform: 'browser', logLevel: 'silent',
    external: ['react', 'react-dom', 'lucide-react', 'firebase/*'] });
  const inputs = Object.keys(result.metafile!.inputs);
  assert.ok(inputs.includes('src/utils/cloudOperatingAuth.ts'));
  assert.ok(inputs.includes('src/utils/cloudOperatingPageController.ts'));
  assert.ok(inputs.includes('firebase.cloud-config.json'));
  for (const input of inputs) {
    assert.doesNotMatch(input, /src\/App\.tsx|storage\.ts|firebaseService|offlineSync|aiService|LoginModal|firebase-applet-config/iu);
  }
  const imports = Object.values(result.metafile!.outputs).flatMap(output => output.imports.map(item => item.path));
  assert.equal(imports.includes('firebase/firestore'), false);
  assert.doesNotMatch(imports.join('\n'), /firebase\/storage|firebase-admin/iu);
});

test('closed cloud entry is static, has no account form, and imports no Auth or clinical code', async () => {
  const html = renderToStaticMarkup(React.createElement(CloudUnavailablePage));
  assert.match(html, /لم تُفتح ملفات المرضى/u);
  assert.doesNotMatch(html, /<form|type="password"/u);
  const result = await build({ entryPoints: ['src/components/auth/CloudUnavailablePage.tsx'], bundle: true,
    write: false, metafile: true, platform: 'browser', logLevel: 'silent', external: ['react', 'lucide-react'] });
  for (const input of Object.keys(result.metafile!.inputs)) {
    assert.doesNotMatch(input, /firebase|storage\.ts|src\/App\.tsx|cloudOperatingAuth|cloudAuthSetup/iu);
  }
});
