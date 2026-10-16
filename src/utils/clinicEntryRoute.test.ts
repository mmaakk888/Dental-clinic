import test from 'node:test';
import assert from 'node:assert/strict';
import { isCloudOperatingRequest, resolveClinicEntry } from './clinicEntryRoute';
import { CLOUD_COMPLETE_RELEASE_UI } from './cloudReleaseReadiness';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';

test('local clinic remains the default, with isolated setup and operating routes on loopback only', () => {
  for (const host of ['localhost', 'LOCALHOST', '127.0.0.1', '::1', '[::1]']) {
    assert.equal(resolveClinicEntry(host, ''), 'local');
    assert.equal(resolveClinicEntry(host, '?unrelated=ok'), 'local');
    assert.equal(resolveClinicEntry(host, '?firebase-setup=1'), 'setup');
    assert.equal(resolveClinicEntry(host, '?clinic-cloud=1'), 'operating');
    assert.equal(isCloudOperatingRequest(host, '?clinic-cloud=1'), true);
  }
});

test('foreign entries never select App or SDK preparation even with valid HTTPS and a query', () => {
  for (const host of ['example.invalid', 'localhost.evil.invalid',
    '127.0.0.1.evil.invalid', '192.168.1.1', '', 'localhost.', '127.1', '0.0.0.0']) {
    for (const query of ['', '?firebase-setup=1', '?clinic-cloud=1']) {
      assert.equal(resolveClinicEntry(host, query, 'https:'), 'blocked');
      assert.equal(isCloudOperatingRequest(host, query, 'https:'), false);
    }
  }
});

test('actual approved HTTPS route follows only central source readiness, never local App or setup', () => {
  const host = 'dental-clinic-mmaakk888.web.app';
  for (const search of ['', '?other=ok', '?clinic-cloud=1']) {
    assert.equal(resolveClinicEntry(host, search, 'https:'), CLOUD_COMPLETE_RELEASE_UI.available ? 'operating' : 'blocked');
    assert.equal(isCloudOperatingRequest(host, search, 'https:'), CLOUD_COMPLETE_RELEASE_UI.available);
  }
  for (const protocol of ['', 'http:', 'file:', 'HTTPS:']) assert.equal(resolveClinicEntry(host, '', protocol), 'blocked');
  for (const search of ['?firebase-setup=1', '?clinic-cloud=1&firebase-setup=1', '?clinic-cloud=1&clinic-cloud=1', '?clinic-cloud=%FF']) {
    assert.equal(resolveClinicEntry(host, search, 'https:'), 'blocked');
  }
});

test('historical closed source fixture stays blocked even when URL flags try to opt in', async () => {
  const output = await build({ entryPoints: ['src/utils/clinicEntryRoute.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', logLevel: 'silent',
    plugins: [{ name: 'explicit-closed-route-test-only', setup(builder) { builder.onLoad({ filter: /cloudReleaseReadiness\.ts$/ }, () => ({
      contents: 'export const CLOUD_COMPLETE_RELEASE_UI = Object.freeze({ available: false });', loader: 'ts',
    })); } }] });
  const module = { exports: {} as any };
  runInNewContext(output.outputFiles[0].text, { module, exports: module.exports, URLSearchParams });
  for (const search of ['', '?clinic-cloud=1', '?clinic-cloud=1&release=1&enabled=true']) {
    assert.equal(module.exports.resolveClinicEntry('dental-clinic-mmaakk888.web.app', search, 'https:'), 'blocked');
  }
  assert.equal(module.exports.resolveClinicEntry('localhost', '', 'http:'), 'local');
});

test('conflicting, duplicate or invalid preparation flags fail closed without loading local records', () => {
  for (const query of ['?firebase-setup=1&clinic-cloud=1', '?firebase-setup=0&clinic-cloud=1',
    '?clinic-cloud=1&clinic-cloud=1', '?clinic-cloud=1&%63linic-cloud=1', '?firebase-setup=1&firebase-setup=1',
    '?clinic-cloud=', '?clinic-cloud=0', '?clinic-cloud=true', '?clinic-cloud=01', '?clinic-cloud=1+',
    '?firebase-setup=', '?firebase-setup=2', '?clinic-cloud=1%20', '?clinic-cloud=1#fragment']) {
    assert.equal(resolveClinicEntry('localhost', query), 'blocked', query);
  }
});

test('route parsing accepts canonical decoded keys but rejects all malformed encodings', () => {
  for (const query of ['?clinic-cloud=%31', '?%63linic-cloud=1', '?other=ok&clinic-cloud=1']) {
    assert.equal(resolveClinicEntry('127.0.0.1', query), 'operating');
  }
  for (const query of ['?clinic-cloud=%', '?clinic-cloud=%FF', '?clinic-cloud=1&other=%ED%A0%80', '?other=%']) {
    assert.equal(resolveClinicEntry('127.0.0.1', query), 'blocked');
  }
});
