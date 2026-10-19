import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { CLOUD_COMPLETE_RELEASE_UI } from './cloudReleaseReadiness';

function buildEntry(stage: 'source' | 'closed' | 'qualified' = 'source') { return build({ entryPoints: ['src/main.tsx'], bundle: true, write: false,
  platform: 'node', format: 'cjs', logLevel: 'silent', supported: { 'dynamic-import': false },
  external: ['react', 'react/jsx-runtime', 'react-dom/client'], plugins: [{ name: 'synthetic-entry-pages', setup(builder) {
    if (stage !== 'source') builder.onLoad({ filter: /cloudReleaseReadiness\.ts$/ }, () => ({
      contents: `export const CLOUD_COMPLETE_RELEASE_UI = Object.freeze({ available: ${stage === 'qualified'} });`, loader: 'ts',
    }));
    builder.onResolve({ filter: /(?:App|CloudSetupPage|CloudOperatingPage|CloudUnavailablePage)\.tsx$/ }, args => {
      if (!args.importer.replaceAll('\\', '/').endsWith('/src/main.tsx')) return;
      const name = args.path.includes('CloudSetupPage') ? 'setup' : args.path.includes('CloudOperatingPage') ? 'operating'
        : args.path.includes('CloudUnavailablePage') ? 'blocked' : 'local';
      return { path: name, namespace: 'synthetic-page' };
    });
    builder.onLoad({ filter: /.*/, namespace: 'synthetic-page' }, args => ({
      contents: `globalThis.__loadedPages.push(${JSON.stringify(args.path)}); export default function Page() { return null; }`, loader: 'js',
    }));
    builder.onResolve({ filter: /ErrorBoundary\.tsx$/ }, () => ({ path: 'boundary', namespace: 'synthetic-boundary' }));
    builder.onLoad({ filter: /.*/, namespace: 'synthetic-boundary' }, () => ({
      contents: 'export function ErrorBoundary() { return null; }', loader: 'js',
    }));
    builder.onLoad({ filter: /\.css$/ }, () => ({ contents: '', loader: 'js' }));
  } }] }); }
const compiledEntry = buildEntry();

async function assertEntry(compiled: Awaited<ReturnType<typeof buildEntry>>, hostname: string, search: string, protocol: string, expected: string) {
    const loaded: string[] = [];
    const loaders: (() => Promise<unknown>)[] = [];
    let roots = 0;
    const module = { exports: {} };
    const jsx = (type: unknown, props: unknown) => ({ type, props });
    runInNewContext(compiled.outputFiles[0].text, {
      module, exports: module.exports, __loadedPages: loaded,
      window: { location: { hostname, search, protocol },
        get localStorage() { throw new Error('Root must not hydrate clinic records.'); },
        get sessionStorage() { throw new Error('Root must not read local accounts.'); } },
      document: { getElementById: () => ({ synthetic: 'root' }) }, URLSearchParams,
      require: (name: string) => {
        if (name === 'react') return { lazy: (loader: () => Promise<unknown>) => { loaders.push(loader); return 'lazy-page'; },
          StrictMode: 'strict-mode', Suspense: 'suspense' };
        if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
        if (name === 'react-dom/client') return { createRoot: () => ({ render: () => { roots++; } }) };
        throw new Error(`Entry must not import SDK, storage or App dependencies: ${name}`);
      },
    });
    assert.equal(roots, 1); assert.equal(loaders.length, 1);
    assert.deepEqual(loaded, []);
    await loaders[0]();
    assert.deepEqual(loaded, [expected], `${hostname}${search}`);
}

test('actual entry resolves before loading App and follows central readiness for approved HTTPS only', async () => {
  const compiled = await compiledEntry;
  for (const [hostname, search, protocol, expected] of [
    ['127.0.0.1', '', 'http:', 'local'], ['localhost', '?x=1', 'http:', 'local'],
    ['127.0.0.1', '?firebase-setup=1', 'http:', 'setup'], ['127.0.0.1', '?clinic-cloud=1', 'http:', 'operating'],
    ['osama-clinic-38706.web.app', '', 'https:', CLOUD_COMPLETE_RELEASE_UI.available ? 'operating' : 'blocked'],
    ['osama-clinic-38706.web.app', '?clinic-cloud=1', 'https:', CLOUD_COMPLETE_RELEASE_UI.available ? 'operating' : 'blocked'],
    ['osama-clinic-38706.web.app', '', 'http:', 'blocked'], ['foreign.example.invalid', '?clinic-cloud=1', 'https:', 'blocked'],
    ['localhost', '?firebase-setup=1&clinic-cloud=1', 'http:', 'blocked'],
    ['localhost', '?clinic-cloud=1&clinic-cloud=1', 'http:', 'blocked'],
    ['localhost', '?firebase-setup=0', 'http:', 'blocked'], ['localhost', '?clinic-cloud=%FF', 'http:', 'blocked'],
  ]) {
    await assertEntry(compiled, hostname, search, protocol, expected);
  }
});

test('explicit closed and qualified test builds preserve entry isolation without changing the real source gate', async () => {
  for (const stage of ['closed', 'qualified'] as const) {
    const compiled = await buildEntry(stage);
    for (const search of ['', '?clinic-cloud=1', '?release=1&enabled=true&clinic-cloud=1']) {
      await assertEntry(compiled, 'osama-clinic-38706.web.app', search, 'https:', stage === 'qualified' ? 'operating' : 'blocked');
    }
    for (const search of ['?firebase-setup=1', '?clinic-cloud=1&clinic-cloud=1', '?clinic-cloud=%FF']) {
      await assertEntry(compiled, 'osama-clinic-38706.web.app', search, 'https:', 'blocked');
    }
    await assertEntry(compiled, 'osama-clinic-38706.web.app', '', 'http:', 'blocked');
    await assertEntry(compiled, 'foreign.example.invalid', '?clinic-cloud=1', 'https:', 'blocked');
  }
});
