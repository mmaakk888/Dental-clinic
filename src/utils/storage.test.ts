import test from 'node:test';
import assert from 'node:assert/strict';
import { Storage, STORAGE_FAILURE_EVENT } from './storage';
import { User } from '../types';
import { INITIAL_PATIENTS } from '../data/initialData';

const local = new Map<string, string>();
const session = new Map<string, string>();
const adapter = (map: Map<string, string>) => ({ getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => map.set(key, value), removeItem: (key: string) => map.delete(key) });
Object.defineProperty(globalThis, 'localStorage', { value: adapter(local), configurable: true });
Object.defineProperty(globalThis, 'sessionStorage', { value: adapter(session), configurable: true });
Object.defineProperty(globalThis, 'window', { value: new EventTarget(), configurable: true });

test('domain writes persist before save returns, and reset cannot be undone by delayed writes', () => {
  Storage.saveExpenses([{ id: 'e', title: 'اختبار', category: 'other', date: '2026-10-05', amount: 5 }]);
  assert.equal(JSON.parse(local.get('dental_expenses_v2')!)[0].amount, 5);
  Storage.resetAll();
  assert.equal(local.size, 0);
});

test('unchecked remember-me login is session-only and never persists password', () => {
  const user = { id: 'doctor', username: 'doctor', name: 'طبيب', password: 'test-secret', role: 'doctor', permissions: {} } as User;
  Storage.saveCurrentUser(user);
  assert.equal(local.has('dental_current_user_v2'), false);
  assert.equal(Storage.getCurrentUser()?.username, 'doctor');
  assert.equal(session.get('dental_current_user_v2')!.includes('test-secret'), false);
  session.clear();
  assert.equal(Storage.getCurrentUser(), null);
});

test('account checks observe updated permissions from another tab rather than stale cache', () => {
  const user = { id: 'reception', username: 'reception', name: 'استقبال', role: 'secretary', permissions: { patientEdit: true } } as User;
  Storage.saveUsers([user]);
  assert.equal(Storage.getUsers()[0].permissions.patientEdit, true);
  local.set('dental_users_v2', JSON.stringify([{ ...user, permissions: { patientEdit: false } }]));
  assert.equal(Storage.getUsers()[0].permissions.patientEdit, false);
});

test('only exact untouched legacy demo records receive the aggregate marker', () => {
  const oldFixture = { ...INITIAL_PATIENTS[0], payments: INITIAL_PATIENTS[0].payments.map(({ legacyAggregate: _marker, ...payment }) => payment) };
  Storage.savePatients([oldFixture, { ...oldFixture, id: 'real-501', name: 'مريض حقيقي' }]);
  const records = Storage.getPatients();
  assert.equal(records[0].payments[0].legacyAggregate, true);
  assert.equal(records[1].payments[0].legacyAggregate, undefined);
});

test('failed persistence emits a visible-failure signal while keeping data in memory', () => {
  let failures = 0;
  const listener = () => failures++;
  window.addEventListener(STORAGE_FAILURE_EVENT, listener);
  Object.defineProperty(globalThis, 'localStorage', { value: { ...adapter(local), setItem: () => { throw new Error('quota'); } }, configurable: true });
  Storage.saveExpenses([{ id: 'failed', title: 'اختبار', category: 'other', date: '2026-10-05', amount: 10 }]);
  assert.equal(failures, 1);
  assert.equal(Storage.getExpenses()[0].id, 'failed');
  window.removeEventListener(STORAGE_FAILURE_EVENT, listener);
  Object.defineProperty(globalThis, 'localStorage', { value: adapter(local), configurable: true });
});
