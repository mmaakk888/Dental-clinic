import test from 'node:test';
import assert from 'node:assert/strict';
import { isCloudOperatingRequest, resolveClinicEntry } from './clinicEntryRoute';

test('local clinic remains the default, with isolated setup and operating routes on loopback only', () => {
  for (const host of ['localhost', 'LOCALHOST', '127.0.0.1', '::1', '[::1]']) {
    assert.equal(resolveClinicEntry(host, ''), 'local');
    assert.equal(resolveClinicEntry(host, '?unrelated=ok'), 'local');
    assert.equal(resolveClinicEntry(host, '?firebase-setup=1'), 'setup');
    assert.equal(resolveClinicEntry(host, '?clinic-cloud=1'), 'operating');
    assert.equal(isCloudOperatingRequest(host, '?clinic-cloud=1'), true);
  }
});

test('external entries never select App or SDK preparation even with a valid query', () => {
  for (const host of ['dental-clinic-mmaakk888.web.app', 'example.invalid', 'localhost.evil.invalid',
    '127.0.0.1.evil.invalid', '192.168.1.1', '', 'localhost.', '127.1', '0.0.0.0']) {
    for (const query of ['', '?firebase-setup=1', '?clinic-cloud=1']) {
      assert.equal(resolveClinicEntry(host, query), 'blocked');
      assert.equal(isCloudOperatingRequest(host, query), false);
    }
  }
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
