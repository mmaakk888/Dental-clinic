import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTrustedBootstrapRequestOptions } from '../../scripts/bootstrap-empty-clinic';
import { CLOUD_BOOTSTRAP_DATABASE_LOCATION } from './cloudEmptyClinicBootstrap';

test('trusted infrastructure inspection and pure bootstrap share the exact owner-accepted replacement database location', () => {
  assert.equal(CLOUD_BOOTSTRAP_DATABASE_LOCATION, 'nam5');
  const source = readFileSync(new URL('../../scripts/bootstrap-empty-clinic.ts', import.meta.url), 'utf8');
  assert.match(source, /store\.locationId !== CLOUD_BOOTSTRAP_DATABASE_LOCATION/u);
  assert.match(source, /location: CLOUD_BOOTSTRAP_DATABASE_LOCATION/u);
  assert.doesNotMatch(source, /location(?:Id)?:?\s*(?:!==|===)?\s*['"]europe-west1['"]/u);
});

test('trusted REST options stay fresh after Firebase CLI mutates a prior POST request', () => {
  const post = createTrustedBootstrapRequestOptions();
  Object.assign(post, { method: 'POST', path: '/synthetic:beginTransaction', body: { options: { readWrite: {} } } });
  const get = createTrustedBootstrapRequestOptions();
  assert.notEqual(get, post);
  assert.notEqual(get.skipLog, post.skipLog);
  assert.deepEqual(get, { skipLog: { body: true, resBody: true } });
  assert.ok(!Object.hasOwn(get, 'body'));
  assert.ok(!Object.isFrozen(get), 'CLI must be able to add method/path to its private request options');
});

test('parallel trusted inventory calls cannot inherit another call body, transaction or URL', () => {
  const requests = Array.from({ length: 4 }, () => createTrustedBootstrapRequestOptions());
  requests.forEach((options, index) => Object.assign(options, { method: 'POST', path: `/synthetic/${index}`, body: { index } }));
  assert.equal(new Set(requests).size, 4);
  assert.equal(new Set(requests.map(options => options.skipLog)).size, 4);
  assert.deepEqual(createTrustedBootstrapRequestOptions(), { skipLog: { body: true, resBody: true } });
});
