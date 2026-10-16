import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import * as icons from 'lucide-react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'esbuild';
import { runInNewContext, runInThisContext } from 'node:vm';
import { createRequire } from 'node:module';
import { CLOUD_COMPLETE_RELEASE_UI } from './cloudReleaseReadiness';
import CloudOperatingPage from '../components/auth/CloudOperatingPage';
import CloudUnavailablePage from '../components/auth/CloudUnavailablePage';

/** Historical preparation UI in an explicit TEST-ONLY closed source build.
 * Evaluate in this test's realm so inert preview arrays keep normal prototypes.
 * This never changes the real release flag, runtime or application props. */
const closedPageOutput = await build({ entryPoints: ['src/components/auth/CloudOperatingPage.tsx'], bundle: true,
  write: false, platform: 'node', format: 'cjs', logLevel: 'silent', supported: { 'dynamic-import': false },
  external: ['react', 'react/jsx-runtime', 'lucide-react', 'firebase/*'],
  plugins: [{ name: 'historical-closed-preparation-only', setup(builder) {
    builder.onLoad({ filter: /cloudReleaseReadiness\.ts$/ }, () => ({
      contents: 'export const CLOUD_COMPLETE_RELEASE_UI = Object.freeze({ available: false, reason: "Synthetic historical preparation" });', loader: 'ts',
    }));
    builder.onLoad({ filter: /\.css$/ }, () => ({ contents: '', loader: 'js' }));
  } }] });
const closedPageModule = { exports: {} as { default: typeof CloudOperatingPage } };
const closedPageRequire = createRequire(import.meta.url);
runInThisContext('(function(module, exports, require) {' + closedPageOutput.outputFiles[0].text + '\n})')(
  closedPageModule, closedPageModule.exports, (name: string) => {
    assert.ok(['react', 'react/jsx-runtime', 'lucide-react'].includes(name), 'Preparation render must not import SDK/native/provider modules: ' + name);
    return closedPageRequire(name);
  });
assert.match(closedPageOutput.outputFiles[0].text, /Synthetic historical preparation/);
const ClosedOperatingPage = closedPageModule.exports.default;


function renderAt(hostname: string, search: string, protocol = 'http:', Page = ClosedOperatingPage): string {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    location: { hostname, search, protocol },
    get localStorage() { throw new Error('No local clinical records may be read.'); },
    get sessionStorage() { throw new Error('No local session may be read.'); },
  } });
  try { return renderToStaticMarkup(React.createElement(Page)); }
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

test('actual operating component follows real central readiness on approved HTTPS, never on HTTP or a foreign host', () => {
  const html = renderAt('dental-clinic-mmaakk888.web.app', '', 'https:', CloudOperatingPage);
  if (CLOUD_COMPLETE_RELEASE_UI.available) {
    assert.match(html, /<form|دخول العيادة/u); assert.match(html, /type="password"/u);
  } else {
    assert.doesNotMatch(html, /<form|type="password"/u);
  }
  for (const [host, protocol] of [['dental-clinic-mmaakk888.web.app','http:'],['foreign.example.invalid','https:']]) {
    assert.doesNotMatch(renderAt(host, '?clinic-cloud=1', protocol, CloudOperatingPage), /<form|type="password"/u);
  }
});

test('qualified actual operating component accepts only the approved HTTPS entry without SDK, storage or requests on construction/render', async () => {
  // Only this in-memory build has a synthetic qualified gate. The actual
  // source flag stays unchanged; this is not live Auth/Hosting acceptance.
  const result = await build({ entryPoints: ['src/components/auth/CloudOperatingPage.tsx'], bundle: true,
    write: false, platform: 'node', format: 'cjs', logLevel: 'silent', supported: { 'dynamic-import': false },
    external: ['react', 'react/jsx-runtime', 'react-dom', 'lucide-react', 'firebase/*'],
    plugins: [{ name: 'synthetic-qualified-operating-component', setup(builder) {
      builder.onLoad({ filter: /cloudReleaseReadiness\.ts$/ }, () => ({
        contents: 'export const CLOUD_COMPLETE_RELEASE_UI = Object.freeze({ available: true, reason: "Synthetic qualification only" });', loader: 'ts',
      }));
      builder.onLoad({ filter: /\.css$/ }, () => ({ contents: '', loader: 'js' }));
    } }] });
  for (const [hostname, protocol, search, approved] of [
    ['dental-clinic-mmaakk888.web.app', 'https:', '', true],
    ['dental-clinic-mmaakk888.web.app', 'https:', '?clinic-cloud=1', true],
    ['dental-clinic-mmaakk888.web.app', 'http:', '', false],
    ['foreign.example.invalid', 'https:', '?clinic-cloud=1', false],
    ['dental-clinic-mmaakk888.web.app.evil.invalid', 'https:', '', false],
    ['dental-clinic-mmaakk888.web.app', 'https:', '?firebase-setup=1', false],
    ['dental-clinic-mmaakk888.web.app', 'https:', '?clinic-cloud=1&clinic-cloud=1', false],
    ['dental-clinic-mmaakk888.web.app', 'https:', '?clinic-cloud=%FF', false],
  ] as const) {
    let forbiddenAccess = 0;
    const deny = () => { forbiddenAccess++; throw new Error('No SDK, local records, session, requests or navigation during SSR.'); };
    const module = { exports: {} as any };
    const scope = { module, exports: module.exports, URLSearchParams,
      window: { location: { hostname, protocol, search, assign: deny },
        get localStorage() { return deny(); }, get sessionStorage() { return deny(); }, get indexedDB() { return deny(); } },
      get fetch() { return deny(); },
      require(name: string) {
        if (name === 'react') return React;
        if (name === 'react/jsx-runtime') return jsxRuntime;
        if (name === 'lucide-react') return icons;
        return deny();
      },
    };
    runInNewContext(result.outputFiles[0].text, scope);
    const html = renderToStaticMarkup(React.createElement(module.exports.default));
    assert.equal(forbiddenAccess, 0, `${hostname}${search}`);
    if (approved) {
      assert.match(html, /<form/u);
      assert.match(html, /name="email"/u);
      assert.match(html, /type="password"/u);
      assert.match(html, /دخول العيادة/u);
      assert.doesNotMatch(html, /التشغيل السحابي لم يُفعّل بعد/u);
    } else {
      assert.match(html, /التشغيل السحابي لم يُفعّل بعد/u);
      assert.doesNotMatch(html, /<form|type="password"/u);
    }
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
