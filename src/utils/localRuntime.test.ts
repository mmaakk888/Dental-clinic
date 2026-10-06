import test from 'node:test';
import assert from 'node:assert/strict';
import { isLocalClinicHost } from './localRuntime';

test('local-only runtime accepts loopback and denies cloud/tunnel/lookalike hosts', () => {
  ['localhost', 'LOCALHOST', '127.0.0.1', '::1', '[::1]'].forEach(host => assert.equal(isLocalClinicHost(host), true));
  ['clinic.web.app', 'x.trycloudflare.com', 'localhost.attacker.invalid', '192.168.1.2', '127.0.0.1.attacker.invalid', ''].forEach(host => assert.equal(isLocalClinicHost(host), false));
});
