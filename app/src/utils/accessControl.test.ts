import test from 'node:test';
import assert from 'node:assert/strict';
import { User } from '../types';
import { canUserLoginNow, isSessionFresh, matchesRememberedSession, matchesSessionIdentity, REMEMBERED_SESSION_MAX_AGE_MS, SESSION_MAX_AGE_MS } from './accessControl';
import { hashPassword } from './passwords';

const user: User = {
  id: 'secretary', name: 'سكرتيرة', username: 'desk', role: 'secretary',
  permissions: {
    patientView: true, patientEdit: true, deletePatients: false, patientFinance: true,
    appointments: true, lab: false, labProfit: false, summary: false, controlPanel: false
  },
  isActive: true,
  accessSchedule: { enabled: true, days: [0], startTime: '09:00', endTime: '17:00' }
};

test('remembered identity stays valid outside work hours without granting access', () => {
  const session = { userId: user.id, username: 'DESK', credentialVersion: 1 };
  assert.equal(matchesSessionIdentity(user, session), true);
  assert.equal(canUserLoginNow(user, new Date(2026, 8, 27, 23)).allowed, false);
  assert.equal(canUserLoginNow(user, new Date(2026, 8, 27, 12)).allowed, true);
  assert.equal(matchesSessionIdentity({ ...user, isActive: false }, session), false);
  assert.equal(matchesSessionIdentity({ ...user, credentialVersion: 2 }, session), false);
  assert.equal(matchesSessionIdentity({ ...user, username: 'new-name' }, session), false);
  assert.equal(matchesSessionIdentity({ ...user, id: 'different' }, session), false);
});

test('allows login during an enabled work period', () => {
  assert.equal(canUserLoginNow(user, new Date(2026, 8, 27, 12, 0)).allowed, true);
});

test('blocks login outside work hours or on another day', () => {
  assert.equal(canUserLoginNow(user, new Date(2026, 8, 27, 18, 0)).allowed, false);
  assert.equal(canUserLoginNow(user, new Date(2026, 8, 28, 12, 0)).allowed, false);
});

test('supports overnight schedules', () => {
  const overnight = { ...user, accessSchedule: { enabled: true, days: [0], startTime: '20:00', endTime: '02:00' } };
  assert.equal(canUserLoginNow(overnight, new Date(2026, 8, 27, 23, 0)).allowed, true);
  assert.equal(canUserLoginNow(overnight, new Date(2026, 8, 28, 1, 59)).allowed, true);
  assert.equal(canUserLoginNow(overnight, new Date(2026, 8, 27, 1, 0)).allowed, false);
  assert.equal(canUserLoginNow(overnight, new Date(2026, 8, 28, 2, 0)).allowed, false);
});

test('includes start time but closes at the exact end time', () => {
  assert.equal(canUserLoginNow(user, new Date(2026, 8, 27, 9, 0)).allowed, true);
  assert.equal(canUserLoginNow(user, new Date(2026, 8, 27, 17, 0)).allowed, false);
});

test('overnight shift wraps from Saturday to Sunday in the configured timezone', () => {
  const scheduled = { ...user, accessSchedule: { enabled: true, days: [6], startTime: '20:00', endTime: '02:00', timezone: 'UTC' } };
  assert.equal(canUserLoginNow(scheduled, new Date('2026-09-27T01:00:00Z')).allowed, true);
  assert.equal(canUserLoginNow(scheduled, new Date('2026-09-26T01:00:00Z')).allowed, false);
});

test('rejects invalid schedules and timezone without throwing', () => {
  for (const override of [{ startTime: '25:00' }, { endTime: '09:00' }, { timezone: 'Invalid/Zone' }, { days: [] }, { days: [7] }, { days: [1.5] }]) {
    assert.equal(canUserLoginNow({ ...user, accessSchedule: { ...user.accessSchedule!, ...override } }, new Date(2026, 8, 27, 12)).allowed, false);
  }
  assert.equal(canUserLoginNow({ ...user, isActive: false }).allowed, false);
  assert.equal(canUserLoginNow({ ...user, accessSchedule: { ...user.accessSchedule!, enabled: false } }).allowed, true);
});

test('local sessions require canonical bounded issue and expiry times, including exact boundary', () => {
  const now = Date.parse('2026-10-06T10:00:00.000Z');
  const session = { issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + REMEMBERED_SESSION_MAX_AGE_MS).toISOString() };
  assert.equal(isSessionFresh(session, now), true);
  assert.equal(isSessionFresh(session, now + REMEMBERED_SESSION_MAX_AGE_MS - 1), true);
  assert.equal(isSessionFresh(session, now + REMEMBERED_SESSION_MAX_AGE_MS), false);
  assert.equal(isSessionFresh(session, now - 1), false);
  assert.equal(isSessionFresh({}, now), false);
  assert.equal(isSessionFresh({ ...session, expiresAt: new Date(now + REMEMBERED_SESSION_MAX_AGE_MS + 1).toISOString() }, now), false);
  assert.equal(isSessionFresh({ ...session, expiresAt: session.issuedAt }, now), false);
  assert.equal(isSessionFresh({ ...session, issuedAt: 'not-a-date' }, now), false);
  assert.equal(isSessionFresh({ ...session, issuedAt: '2026-10-06' }, now), false);
  assert.equal(isSessionFresh(session, NaN), false);
  assert.equal(isSessionFresh(session, now, SESSION_MAX_AGE_MS), false);
});

test('remembered legacy sessions require password authentication once and versions revoke hashed sessions', async () => {
  const now = Date.parse('2026-10-06T10:00:00.000Z');
  const identity = { userId: user.id, username: user.username, credentialVersion: 1 };
  const session = { ...identity, issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 1000).toISOString() };
  const hashed = { ...user, password: await hashPassword('synthetic passphrase only') };
  assert.equal(matchesRememberedSession(hashed, identity, now), false);
  assert.equal(matchesRememberedSession({ ...user, password: 'legacy-only' }, session, now), false);
  assert.equal(matchesRememberedSession(hashed, session, now), true);
  assert.equal(matchesRememberedSession({ ...hashed, credentialVersion: 2 }, session, now), false);
  assert.equal(matchesRememberedSession({ ...hashed, isActive: false }, session, now), false);
  assert.equal(matchesRememberedSession(hashed, session, now + 1000), false);
  assert.equal(matchesSessionIdentity(hashed, { ...identity, credentialVersion: 0 }), false);
  assert.equal(matchesSessionIdentity({ ...hashed, credentialVersion: 0 }, identity), false);
});
