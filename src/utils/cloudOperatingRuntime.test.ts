import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { isCloudOperatingRuntime, CLOUD_OPERATING_HOST } from './cloudOperatingRuntime';
import { CLOUD_COMPLETE_RELEASE_UI } from './cloudReleaseReadiness';

test('actual operating production boundary follows only the reviewed source gate and never widens local host access', () => {
  assert.equal(isCloudOperatingRuntime(CLOUD_OPERATING_HOST, 'https:'), CLOUD_COMPLETE_RELEASE_UI.available);
  for (const host of ['localhost', 'LOCALHOST', '127.0.0.1', '::1', '[::1]']) assert.equal(isCloudOperatingRuntime(host, 'http:'), true);
  for (const host of ['example.invalid', `${CLOUD_OPERATING_HOST}.evil.invalid`, `${CLOUD_OPERATING_HOST}.`, 'dental-clinic-mmaakk888.firebaseapp.com', '192.168.1.2']) {
    assert.equal(isCloudOperatingRuntime(host, 'https:'), false);
  }
  for (const protocol of ['', 'http:', 'file:', 'HTTPS:']) assert.equal(isCloudOperatingRuntime(CLOUD_OPERATING_HOST, protocol), false);
});

test('qualified production entry defaults to isolated operating only, never local App/setup or a malformed preparation route', async () => {
  // Synthetic build only: this cannot change the actual source gate or host.
  const output = await build({ entryPoints: ['src/utils/clinicEntryRoute.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', logLevel: 'silent',
    plugins: [{ name: 'synthetic-reviewed-release', setup(builder) { builder.onLoad({ filter: /cloudReleaseReadiness\.ts$/ }, () => ({
      contents: 'export const CLOUD_COMPLETE_RELEASE_UI = Object.freeze({ available: true });', loader: 'ts',
    })); } }] });
  const module = { exports: {} as any };
  runInNewContext(output.outputFiles[0].text, { module, exports: module.exports, URLSearchParams });
  const route = module.exports.resolveClinicEntry;
  for (const query of ['', '?unrelated=ok', '?clinic-cloud=1']) assert.equal(route(CLOUD_OPERATING_HOST, query, 'https:'), 'operating');
  for (const query of ['?firebase-setup=1', '?firebase-setup=1&clinic-cloud=1', '?clinic-cloud=1&clinic-cloud=1', '?clinic-cloud=0', '?clinic-cloud=%FF', '?other=%']) {
    assert.equal(route(CLOUD_OPERATING_HOST, query, 'https:'), 'blocked', query);
  }
  assert.equal(route(CLOUD_OPERATING_HOST, '', 'http:'), 'blocked');
  assert.equal(route('localhost', '', 'http:'), 'local');
  assert.equal(route('localhost', '?firebase-setup=1', 'http:'), 'setup');
  assert.equal(route('foreign.example.invalid', '', 'https:'), 'blocked');
});
