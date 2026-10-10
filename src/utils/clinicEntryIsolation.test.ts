import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';

const compiledEntry = build({ entryPoints: ['src/main.tsx'], bundle: true, write: false,
  platform: 'node', format: 'cjs', logLevel: 'silent', supported: { 'dynamic-import': false },
  external: ['react', 'react/jsx-runtime', 'react-dom/client'], plugins: [{ name: 'synthetic-entry-pages', setup(builder) {
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
    builder.onLoad({ filter: /index\.css$/ }, () => ({ contents: '', loader: 'js' }));
  } }] });

test('actual entry resolves before loading App: external and preparation entries import only their own page', async () => {
  const compiled = await compiledEntry;
  for (const [hostname, search, expected] of [
    ['127.0.0.1', '', 'local'], ['localhost', '?x=1', 'local'],
    ['127.0.0.1', '?firebase-setup=1', 'setup'], ['127.0.0.1', '?clinic-cloud=1', 'operating'],
    ['dental-clinic-mmaakk888.web.app', '', 'blocked'],
    ['dental-clinic-mmaakk888.web.app', '?clinic-cloud=1', 'blocked'],
    ['localhost', '?firebase-setup=1&clinic-cloud=1', 'blocked'],
    ['localhost', '?clinic-cloud=1&clinic-cloud=1', 'blocked'],
    ['localhost', '?firebase-setup=0', 'blocked'], ['localhost', '?clinic-cloud=%FF', 'blocked'],
  ]) {
    const loaded: string[] = [];
    const loaders: (() => Promise<unknown>)[] = [];
    let roots = 0;
    const module = { exports: {} };
    const jsx = (type: unknown, props: unknown) => ({ type, props });
    runInNewContext(compiled.outputFiles[0].text, {
      module, exports: module.exports, __loadedPages: loaded,
      window: { location: { hostname, search },
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
});
