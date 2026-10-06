import test from 'node:test';
import assert from 'node:assert/strict';
import type { User } from '../types';
import {
  ACCOUNT_PERMISSION_GROUPS, accountPermissionEnabled, accountScheduleLabel,
  createSafeSecretaryPermissions, createUserAccountDraft, guardAccountRemoval,
  isUsableControlPanelManager, userAccountsSnapshot, validateAccountSchedule, validateUserAccountDraft,
} from './userAccounts';

const manager = (id = 'manager'): User => ({ id, name: 'الطبيب', username: `owner-${id}`, password: 'existing-test-credential', role: 'doctor', permissions: createSafeSecretaryPermissions() });
const secretary = (): User => ({ id: 'desk', name: 'مساعد العيادة', username: 'desk', password: 'existing-desk-credential', role: 'secretary', permissions: createSafeSecretaryPermissions() });
const permission = (key: string) => ACCOUNT_PERMISSION_GROUPS.flatMap(group => group.items).find(item => item.key === key)!;

test('new secretary uses explicit safe permissions and starts with an empty password', () => {
  const draft = createUserAccountDraft();
  assert.equal(draft.newPassword, '');
  assert.equal(draft.role, 'secretary');
  for (const key of ['lab', 'labProfit', 'summary', 'controlPanel', 'managePrices', 'financialReports', 'viewProfits', 'viewExpenses', 'deletePayment', 'editPayment', 'viewTodayCollections', 'patientFinance']) assert.equal(draft.permissions[key], false);
  for (const key of ['patientView', 'patientEdit', 'appointments', 'registerPayment', 'viewRemainingBalance']) assert.equal(draft.permissions[key], true);
  const groups = ACCOUNT_PERMISSION_GROUPS.flatMap(group => group.items.map(item => item.key));
  assert.equal(new Set(groups).size, 18);
  assert.deepEqual(new Set(groups), new Set(Object.keys(draft.permissions)));
});

test('editing draft is redacted and no unchanged save materializes optional fields or credentials', () => {
  const original: any = { id: 'legacy', name: 'قديم', username: 'Legacy', password: 'never-prefilled', role: 'secretary', permissions: { patientView: true, patientEdit: false, deletePatients: false, patientFinance: true, appointments: true, lab: false, labProfit: false, summary: false, controlPanel: false }, extra: { historicalNote: 'keep' } };
  const draft = createUserAccountDraft(original);
  assert.equal(draft.newPassword, '');
  assert.equal('password' in draft, false);
  assert.equal(JSON.stringify(draft).includes('never-prefilled'), false);
  const result = validateUserAccountDraft(draft, [manager(), original], original);
  assert.equal(result.valid, true);
  assert.deepEqual(result.user, original);
  assert.equal(Object.hasOwn(result.user!, 'credentialVersion'), false);
  assert.equal(Object.hasOwn(result.user!, 'isActive'), false);
  assert.equal(Object.hasOwn(result.user!, 'accessSchedule'), false);
  assert.equal(Object.hasOwn(result.user!.permissions, 'registerPayment'), false);
  assert.equal(result.passwordChanged, false);
});

test('effective legacy permissions use actual fallback without changing stored flags', () => {
  const user = secretary();
  delete user.permissions.registerPayment;
  delete user.permissions.viewRemainingBalance;
  delete user.permissions.viewTodayCollections;
  delete user.permissions.managePrices;
  delete user.permissions.viewExpenses;
  delete user.permissions.financialReports;
  user.permissions.patientFinance = true;
  user.permissions.summary = true;
  user.permissions.controlPanel = true;
  const draft = createUserAccountDraft(user);
  for (const key of ['registerPayment', 'viewRemainingBalance', 'viewTodayCollections', 'viewExpenses', 'financialReports', 'managePrices']) assert.equal(accountPermissionEnabled(draft, permission(key)), true);
  const result = validateUserAccountDraft({ ...draft, name: 'اسم جديد' }, [manager(), user], user);
  assert.equal(result.valid, true);
  assert.deepEqual(result.user!.permissions, user.permissions);
  assert.equal(Object.hasOwn(result.user!.permissions, 'registerPayment'), false);
});

test('shape, unknown permission fields and timezone survive and are cloned without input mutation', () => {
  const original: any = { ...secretary(), permissions: { ...secretary().permissions, futureCapability: { scope: ['one'] } }, extra: { audit: ['keep'] }, accessSchedule: { enabled: true, days: [1], startTime: '20:00', endTime: '02:00', timezone: 'UTC', futureSchedule: 'keep' }, credentialVersion: 7 };
  const before = userAccountsSnapshot([original]);
  const draft = createUserAccountDraft(original);
  draft.name = 'اسم محدث'; draft.scheduleEnd = '03:00';
  const result = validateUserAccountDraft(draft, [manager(), original], original);
  assert.equal(result.valid, true);
  assert.equal(result.user!.id, original.id);
  assert.equal(result.user!.accessSchedule!.timezone, 'UTC');
  assert.equal((result.user!.accessSchedule as any).futureSchedule, 'keep');
  assert.deepEqual((result.user as any).extra, original.extra);
  assert.notEqual((result.user as any).extra, original.extra);
  assert.deepEqual(result.user!.permissions, original.permissions);
  assert.notEqual((draft.permissions as any).futureCapability, original.permissions.futureCapability);
  assert.equal(result.user!.credentialVersion, 7);
  assert.equal(userAccountsSnapshot([original]), before);
});

test('new password required, length bounds checked and new account version starts at one', () => {
  const draft = { ...createUserAccountDraft(), name: 'حساب جديد', username: ' NewDesk ' };
  assert.equal(validateUserAccountDraft(draft, [manager()], null, 'new').errors.newPassword.length > 0, true);
  assert.equal(validateUserAccountDraft({ ...draft, newPassword: 'x'.repeat(129) }, [manager()], null, 'new').valid, false);
  const result = validateUserAccountDraft({ ...draft, newPassword: ' test-only-credential ' }, [manager()], null, 'new');
  assert.equal(result.valid, true);
  assert.equal(result.user!.username, 'newdesk');
  assert.equal(result.user!.credentialVersion, 1);
  assert.equal(result.user!.accessSchedule, undefined);
  assert.equal(result.user!.password, ' test-only-credential ');
});

test('blank or identical password does not bump version; changed password bumps exactly once', () => {
  const original = { ...secretary(), credentialVersion: 5 };
  const draft = createUserAccountDraft(original);
  for (const password of ['', original.password!]) {
    const result = validateUserAccountDraft({ ...draft, newPassword: password }, [manager(), original], original);
    assert.equal(result.valid, true); assert.equal(result.user!.password, original.password);
    assert.equal(result.user!.credentialVersion, 5); assert.equal(result.passwordChanged, false);
  }
  assert.equal(validateUserAccountDraft({ ...draft, newPassword: '  ' }, [manager(), original], original).valid, false);
  const result = validateUserAccountDraft({ ...draft, newPassword: 'new-test-credential' }, [manager(), original], original);
  assert.equal(result.user!.credentialVersion, 6);
  assert.equal(result.passwordChanged, true);
  assert.equal(validateUserAccountDraft({ ...draft, newPassword: 'new-test-credential' }, [manager(), original], original).user!.credentialVersion, 6);
});

test('passwordless managers cannot count as usable and must be repaired with a new credential', () => {
  const original = manager(); delete original.password;
  assert.equal(isUsableControlPanelManager(original), false);
  assert.equal(validateUserAccountDraft({ ...createUserAccountDraft(original), name: 'محدث' }, [original], original).valid, false);
  const repaired = validateUserAccountDraft({ ...createUserAccountDraft(original), newPassword: 'synthetic repaired phrase' }, [original], original);
  assert.equal(repaired.valid, true); assert.equal(isUsableControlPanelManager(repaired.user!), true);
});

test('username uniqueness is case-insensitive and trimmed; Arabic and length constraints work', () => {
  const user = secretary(); user.username = '  DESK  ';
  const draft = { ...createUserAccountDraft(), name: 'حساب عربي', username: ' desk ', newPassword: 'test-only-passphrase' };
  assert.equal(validateUserAccountDraft(draft, [manager(), user], null, 'new').valid, false);
  assert.equal(validateUserAccountDraft({ ...draft, username: 'دخول_العيادة' }, [manager(), user], null, 'new').valid, true);
  assert.equal(validateUserAccountDraft({ ...draft, username: 'unique', name: 'a'.repeat(101) }, [manager()], null, 'new').valid, false);
  assert.equal(validateUserAccountDraft({ ...draft, username: 'a'.repeat(61) }, [manager()], null, 'new').valid, false);
  assert.equal(validateUserAccountDraft({ ...draft, username: 'unique', name: 'اسم\nثان' }, [manager()], null, 'new').valid, false);
});

test('doctor and admin have full effective access but role change does not rewrite stored flags', () => {
  for (const role of ['doctor', 'admin'] as const) {
    const user = secretary(); const draft = { ...createUserAccountDraft(user), role };
    assert.equal(accountPermissionEnabled(draft, permission('controlPanel')), true);
    const result = validateUserAccountDraft(draft, [manager(), user], user);
    assert.equal(result.valid, true); assert.deepEqual(result.user!.permissions, user.permissions);
    assert.equal(result.user!.permissions.controlPanel, false);
    assert.equal(result.newPermissionGrants.includes('لوحة التحكم وإدارة الحسابات'), true);
  }
});

test('last usable manager cannot be paused or demoted, role-based and delegated managers count', () => {
  const owner = manager();
  assert.equal(validateUserAccountDraft({ ...createUserAccountDraft(owner), isActive: false }, [owner], owner).valid, false);
  assert.equal(validateUserAccountDraft({ ...createUserAccountDraft(owner), role: 'secretary' }, [owner], owner).valid, false);
  const delegated = secretary(); delegated.permissions.controlPanel = true;
  assert.equal(isUsableControlPanelManager(delegated), true);
  assert.equal(validateUserAccountDraft({ ...createUserAccountDraft(owner), isActive: false }, [owner, delegated], owner).valid, true);
  delegated.isActive = false;
  assert.equal(validateUserAccountDraft({ ...createUserAccountDraft(owner), role: 'secretary' }, [owner, delegated], owner).valid, false);
});

test('deletion protects current account and last manager, allows another account with a usable manager', () => {
  const owner = manager(); const desk = secretary();
  assert.ok(guardAccountRemoval([owner, desk], owner.id, owner.id));
  assert.ok(guardAccountRemoval([owner, desk], owner.id, desk.id));
  assert.equal(guardAccountRemoval([owner, desk], desk.id, owner.id), null);
  assert.ok(guardAccountRemoval([owner, desk], 'missing', owner.id));
});

test('work hours allow overnight shifts and preserve old absent timezone rather than inventing it', () => {
  const user = secretary(); user.accessSchedule = { enabled: true, days: [0, 6], startTime: '20:00', endTime: '02:00' };
  assert.equal(validateAccountSchedule(user.accessSchedule), null);
  const draft = { ...createUserAccountDraft(user), scheduleEnd: '03:00' };
  const result = validateUserAccountDraft(draft, [manager(), user], user);
  assert.equal(result.valid, true); assert.equal(Object.hasOwn(result.user!.accessSchedule!, 'timezone'), false);
  assert.match(accountScheduleLabel(result.user!), /اليوم التالي/);
  const newDraft = { ...createUserAccountDraft(), name: 'ليلي', username: 'night', newPassword: 'test-only-passphrase', scheduleEnabled: true, scheduleDays: [0], scheduleStart: '20:00', scheduleEnd: '02:00' };
  assert.equal(validateUserAccountDraft(newDraft, [manager()], null, 'new').user!.accessSchedule!.timezone, 'Africa/Cairo');
});

test('schedule rejects empty/out-of-range days, invalid/equal times and timezone; disabled legacy shape stays', () => {
  const valid = { enabled: true, days: [1], startTime: '09:00', endTime: '17:00', timezone: 'UTC' };
  for (const override of [{ days: [] }, { days: [7] }, { days: [1.5] }, { startTime: '9:00' }, { endTime: '24:00' }, { endTime: '09:00' }, { timezone: 'Not/AZone' }]) assert.ok(validateAccountSchedule({ ...valid, ...override }));
  assert.equal(validateAccountSchedule({ ...valid, enabled: false, days: [], timezone: 'Not/AZone' }), null);
  const user: any = { ...secretary(), accessSchedule: { enabled: false, timezone: 'UTC', future: 'preserve' } };
  const result = validateUserAccountDraft({ ...createUserAccountDraft(user), name: 'محدث' }, [manager(), user], user);
  assert.equal(result.valid, true); assert.deepEqual(result.user!.accessSchedule, user.accessSchedule);
});

test('malformed permissions cannot grant implicit access and stale/missing IDs fail validation', () => {
  const user = secretary(); const draft = createUserAccountDraft(user);
  assert.equal(validateUserAccountDraft(draft, [manager()], user).valid, false);
  assert.equal(validateUserAccountDraft({ ...draft, permissions: null as any }, [manager(), user], user).valid, false);
  assert.equal(validateUserAccountDraft({ ...draft, newPassword: 'test-only' }, [manager()], null, '').valid, false);
  assert.notEqual(userAccountsSnapshot([user]), userAccountsSnapshot([{ ...user, password: 'changed-in-test' }]));
});
