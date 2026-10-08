import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';

test('setup bundle cannot import clinical App, local record storage, old backups, full Firestore or AI', async () => {
  const result = await build({
    entryPoints: ['src/components/auth/CloudSetupPage.tsx'], bundle: true, write: false,
    metafile: true, platform: 'browser', logLevel: 'silent',
    external: ['react', 'react-dom', 'lucide-react', 'firebase/*'],
  });
  const inputs = Object.keys(result.metafile!.inputs);
  assert.ok(inputs.includes('src/utils/cloudAuthSetup.ts'));
  assert.ok(inputs.includes('firebase.cloud-config.json'));
  for (const input of inputs) assert.doesNotMatch(input, /src\/App\.tsx|storage\.ts|firebaseService|offlineSync|aiService|firebase-applet-config/iu);
  const imports = Object.values(result.metafile!.outputs).flatMap(output => output.imports.map(item => item.path));
  assert.ok(imports.includes('firebase/firestore/lite'));
  assert.equal(imports.includes('firebase/firestore'), false);
  assert.doesNotMatch(imports.join('\n'), /firebase\/storage|firebase-admin/iu);
});

test('legacy backup initializer does not mistake a named setup app for the default app', async () => {
  const result = await build({
    entryPoints: ['src/utils/firebaseService.ts'], bundle: true, write: false,
    platform: 'node', format: 'cjs', logLevel: 'silent', external: ['firebase/*'],
  });
  for (const hasDefault of [false, true]) {
    const defaultApp = { name: '[DEFAULT]' };
    let initialized = 0, defaultLookups = 0;
    const exports = {};
    runInNewContext(result.outputFiles[0].text, {
      module: { exports }, exports,
      require: (name: string) => {
        if (name === 'firebase/app') return {
          getApps: () => [{ name: 'clinic-owner-setup-synthetic' }, ...(hasDefault ? [defaultApp] : [])],
          getApp: () => { defaultLookups++; assert.equal(hasDefault, true); return defaultApp; },
          initializeApp: (config: { projectId: string }) => {
            initialized++; assert.equal(config.projectId, 'zippy-dispatcher-m1ttq'); return defaultApp;
          },
        };
        if (name === 'firebase/firestore') return { getFirestore: (app: unknown, database: string) => {
          assert.equal(app, defaultApp);
          assert.equal(database, 'ai-studio-f89a6778-0b16-474c-a5bf-0d90f6245265');
          return {};
        } };
        throw new Error('Unexpected dependency in synthetic initializer test.');
      },
    });
    assert.equal(initialized, hasDefault ? 0 : 1);
    assert.equal(defaultLookups, hasDefault ? 1 : 0);
  }
});
