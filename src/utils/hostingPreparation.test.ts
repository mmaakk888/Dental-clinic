import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const configuration = JSON.parse(readFileSync(new URL('../../firebase.hosting.example.json', import.meta.url), 'utf8'));

test('hosting preparation publishes only static dist and never configures cloud data or server deployment', () => {
  assert.deepEqual(Object.keys(configuration), ['hosting']);
  assert.equal(configuration.hosting.public, 'dist');
  assert.equal(configuration.hosting.rewrites, undefined);
  for (const pattern of ['**/.*', '**/build/**', '**/server/**', '**/src/**', '**/review-proofs/**', '**/*.map', '**/*.cjs', '**/*.pem', '**/*.key', '**/*.br', '**/*.gz']) {
    assert.ok(configuration.hosting.ignore.includes(pattern), pattern);
  }
});

test('hosting preparation keeps HTML fresh and only fingerprinted client scripts/styles immutable', () => {
  const allHeaders = configuration.hosting.headers.find((entry: { source?: string }) => entry.source === '**').headers;
  const find = (key: string) => allHeaders.find((header: { key: string }) => header.key === key)?.value;
  assert.equal(find('Cache-Control'), 'no-cache');
  assert.equal(find('X-Content-Type-Options'), 'nosniff');
  assert.equal(find('X-Frame-Options'), 'DENY');
  assert.ok(find('Content-Security-Policy').includes("frame-ancestors 'none'"));
  const fingerprintHeader = configuration.hosting.headers.find((entry: { regex?: string }) => entry.regex);
  const fingerprint = new RegExp(fingerprintHeader.regex);
  assert.equal(fingerprint.test('/assets/index-Abcd1234.js'), true);
  assert.equal(fingerprint.test('/assets/SettingsView-Abcd_123.css'), true);
  for (const path of ['/index.html', '/assets/index.js', '/api/ai/search', '/server.cjs', '/assets/notes.txt']) {
    assert.equal(fingerprint.test(path), false, path);
  }
  assert.equal(fingerprintHeader.headers[0].value, 'public, max-age=31536000, immutable');
});
