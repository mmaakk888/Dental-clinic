import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import config from '../../firebase.cloud-config.json';
import { CLOUD_PROJECT_ID } from './cloudIdentity';
import { CLOUD_OPERATING_HOST, isCloudOperatingRuntime } from './cloudOperatingRuntime';
import { resolveClinicEntry } from './clinicEntryRoute';

test('web config, identity boundary, exact HTTPS host and Hosting site target the same replacement project', () => {
  const hosting = JSON.parse(readFileSync(new URL('../../firebase.hosting.json', import.meta.url), 'utf8')).hosting;
  assert.equal(CLOUD_PROJECT_ID, 'osama-clinic-38706');
  assert.equal(config.projectId, CLOUD_PROJECT_ID);
  assert.equal(config.authDomain, `${CLOUD_PROJECT_ID}.firebaseapp.com`);
  assert.equal(config.appId, '1:439834788117:web:6f1c19d4fe06f342f0e91c');
  assert.match(config.apiKey, /^AIza[\w-]{35}$/u);
  assert.deepEqual(Object.keys(config).sort(), ['apiKey', 'appId', 'authDomain', 'projectId']);
  assert.equal(CLOUD_OPERATING_HOST, `${CLOUD_PROJECT_ID}.web.app`);
  assert.equal(hosting.site, CLOUD_PROJECT_ID);
  assert.equal(hosting.public, 'dist');
  assert.ok(hosting.ignore.includes('**/*.key'));
  assert.ok(hosting.ignore.includes('**/.*'));
});

test('a replacement-project build never opens on the previous project, aliases or lookalike hosts', () => {
  for (const host of ['dental-clinic-mmaakk888.web.app', 'dental-clinic-mmaakk888.firebaseapp.com',
    `${CLOUD_PROJECT_ID}.firebaseapp.com`, `${CLOUD_OPERATING_HOST}.evil.invalid`]) {
    assert.equal(isCloudOperatingRuntime(host, 'https:'), false);
    assert.equal(resolveClinicEntry(host, '', 'https:'), 'blocked');
    assert.equal(resolveClinicEntry(host, '?clinic-cloud=1', 'https:'), 'blocked');
  }
});

test('manual operating Rules configuration targets only the default database, never Hosting, Auth or Storage', () => {
  const config = JSON.parse(readFileSync(new URL('../../firebase.operating-rules.json', import.meta.url), 'utf8'));
  assert.deepEqual(config, { firestore: { database: '(default)', rules: 'firestore.release.rules' } });
});
