import test from 'node:test';
import assert from 'node:assert/strict';
import { isCloudSetupRequest } from './cloudSetupRoute';

test('Auth setup is available only on existing loopback hosts', () => {
  for (const hostname of ['localhost', 'LOCALHOST', '127.0.0.1', '::1', '[::1]']) {
    assert.equal(isCloudSetupRequest(hostname, '?firebase-setup=1'), true, hostname);
  }
  for (const hostname of ['', 'clinic.web.app', 'x.trycloudflare.com', '192.168.1.2',
    'localhost.attacker.invalid', '127.0.0.1.attacker.invalid', 'localhost.',
    'localhost:4173', '127.1', '0.0.0.0']) {
    assert.equal(isCloudSetupRequest(hostname, '?firebase-setup=1'), false, hostname);
  }
});

test('Auth setup requires one exact decoded firebase-setup=1 parameter', () => {
  for (const search of ['?firebase-setup=1', '?other=ok&firebase-setup=1',
    '?firebase-setup=1&other=ok', '?firebase-setup=%31', '?%66irebase-setup=1']) {
    assert.equal(isCloudSetupRequest('localhost', search), true, search);
  }
  for (const search of ['', '?', '?other=1', '?firebase-setup', '?firebase-setup=',
    '?firebase-setup=0', '?firebase-setup=true', '?firebase-setup=01',
    '?firebase-setup=1+', '?firebase-setup=+1', '?firebase-setup=1%20',
    '?Firebase-setup=1', '?firebase-setup[]=1', '?firebase-setup=1#fragment']) {
    assert.equal(isCloudSetupRequest('localhost', search), false, search);
  }
});

test('Auth setup rejects duplicate decoded keys even when values agree', () => {
  for (const search of ['?firebase-setup=1&firebase-setup=1',
    '?firebase-setup=1&firebase-setup=0', '?firebase-setup=0&firebase-setup=1',
    '?firebase-setup=1&firebase-setup=', '?firebase-setup=1&%66irebase-setup=1']) {
    assert.equal(isCloudSetupRequest('127.0.0.1', search), false, search);
  }
});

test('Auth setup fails closed for malformed query encoding', () => {
  for (const search of ['?firebase-setup=%', '?firebase-setup=%1',
    '?firebase-setup=%GG', '?firebase-setup=%FF', '?firebase-setup=1&other=%',
    '?firebase-setup=1&other=%ED%A0%80']) {
    assert.equal(isCloudSetupRequest('localhost', search), false, search);
  }
});
