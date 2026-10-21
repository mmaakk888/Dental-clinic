import type { User, UserPermission } from '../types';
import { canPerformAction, type RBACAction } from './rbac';
import { hasPasswordCredential, validateNewPassword } from './passwords';

export interface AccountPermission {
  key: keyof UserPermission;
  action: RBACAction;
  label: string;
  help: string;
}

export const ACCOUNT_PERMISSION_GROUPS: readonly { title: string; items: readonly AccountPermission[] }[] = [
  { title: 'المرضى والمواعيد', items: [
    { key: 'patientView', action: 'view_patients', label: 'عرض ملفات المرضى', help: 'فتح الملفات وقراءة التفاصيل وطباعة الروشتة وعرض جهات الاتصال.' },
    { key: 'patientEdit', action: 'edit_patient', label: 'إضافة وتعديل المرضى والجلسات', help: 'تسجيل مريض أو جلسة وتعديل بيانات الملف، وإضافة وتعديل وحذف جهات الاتصال فقط دون حذف ملف مريض.' },
    { key: 'deletePatients', action: 'delete_patient', label: 'حذف المرضى والجلسات', help: 'صلاحية حساسة لحذف بيانات طبية مسجلة.' },
    { key: 'appointments', action: 'manage_appointments', label: 'إدارة المواعيد', help: 'تسجيل المواعيد ومتابعتها وتعديلها.' },
  ] },
  { title: 'حسابات المرضى والتحصيل', items: [
    { key: 'patientFinance', action: 'view_patient_finance', label: 'عرض التفاصيل المالية للمريض', help: 'عرض حساب المريض. في الحسابات القديمة تتبعها بعض صلاحيات التحصيل غير المحددة.' },
    { key: 'registerPayment', action: 'register_payment', label: 'تسجيل دفعة', help: 'تسجيل مبلغ مدفوع دون منح تعديل أو حذف دفعات سابقة.' },
    { key: 'viewRemainingBalance', action: 'view_remaining_balance', label: 'عرض المتبقي على المريض', help: 'معرفة المبلغ المتبقي في حساب المريض.' },
    { key: 'viewTodayCollections', action: 'view_today_collections', label: 'عرض تحصيل اليوم', help: 'عرض إجمالي وتفاصيل المدفوعات اليومية المسموح بها.' },
    { key: 'editPayment', action: 'edit_payment', label: 'تعديل دفعة مسجلة', help: 'صلاحية حساسة لتغيير مبلغ أو بيانات دفعة.' },
    { key: 'deletePayment', action: 'delete_payment', label: 'حذف دفعة مسجلة', help: 'صلاحية حساسة لإزالة دفعة من الحساب.' },
  ] },
  { title: 'المعامل وماليات العيادة', items: [
    { key: 'lab', action: 'manage_lab', label: 'إدارة التركيبات والمعامل', help: 'دخول قسم المعامل ومتابعة أعمال التركيبات.' },
    { key: 'labProfit', action: 'view_lab_costs', label: 'ماليات المعامل الخاصة', help: 'عرض تكلفة التركيبات وأرباحها وحساب المعمل، وتسجيل تسويات المعمل.' },
    { key: 'summary', action: 'view_summary_reports', label: 'دخول قسم الماليات', help: 'الوصول إلى لوحة الماليات؛ قد تتبعها صلاحيات مالية قديمة غير محددة.' },
    { key: 'viewExpenses', action: 'view_expenses', label: 'عرض المصروفات', help: 'الاطلاع على مصروفات العيادة.' },
    { key: 'viewProfits', action: 'view_profits', label: 'عرض الأرباح', help: 'الاطلاع على أرباح العيادة والتكاليف الخاصة.' },
    { key: 'financialReports', action: 'financial_reports', label: 'التقارير المالية', help: 'الوصول إلى تقارير وحسابات العيادة المالية.' },
  ] },
  { title: 'الإدارة', items: [
    { key: 'controlPanel', action: 'access_control_panel', label: 'دخول لوحة التحكم', help: 'دخول الإعدادات المسموح بها. لا يمنح السكرتارية إدارة الحسابات أو النسخ أو الاستيراد والتصدير.' },
    { key: 'managePrices', action: 'manage_prices', label: 'إدارة أسعار الخدمات', help: 'تعديل قائمة الخدمات وأسعارها.' },
  ] },
];

export const ACCOUNT_WEEKDAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'] as const;

// Explicit optional flags prevent the broad legacy financial fallbacks on new accounts.
export function createSafeSecretaryPermissions(): UserPermission {
  return {
    patientView: true, patientEdit: true, deletePatients: false, patientFinance: false,
    appointments: true, lab: false, labProfit: false, summary: false, controlPanel: false,
    registerPayment: true, viewRemainingBalance: true, viewTodayCollections: false,
    editPayment: false, deletePayment: false, viewExpenses: false, viewProfits: false,
    managePrices: false, financialReports: false,
  };
}

export interface UserAccountDraft {
  name: string;
  username: string;
  newPassword: string;
  email: string;
  phone: string;
  role: User['role'];
  isActive: boolean;
  permissions: UserPermission;
  scheduleEnabled: boolean;
  scheduleDays: number[];
  scheduleStart: string;
  scheduleEnd: string;
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const string = (value: unknown): string => typeof value === 'string' ? value : '';
const clone = <T,>(value: T): T => {
  if (Array.isArray(value)) return value.map(clone) as T;
  if (record(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) as T;
  return value;
};

export function createUserAccountDraft(user?: User | null): UserAccountDraft {
  const schedule = user?.accessSchedule;
  return {
    name: string(user?.name), username: string(user?.username), newPassword: '',
    email: string(user?.email), phone: string(user?.phone), role: user?.role || 'secretary',
    isActive: user?.isActive !== false,
    permissions: user ? clone(record(user.permissions) ? user.permissions : {} as UserPermission) : createSafeSecretaryPermissions(),
    scheduleEnabled: schedule?.enabled === true,
    scheduleDays: Array.isArray(schedule?.days) ? [...schedule.days] : [0, 1, 2, 3, 4, 5, 6],
    scheduleStart: typeof schedule?.startTime === 'string' ? schedule.startTime : '09:00',
    scheduleEnd: typeof schedule?.endTime === 'string' ? schedule.endTime : '21:00',
  };
}

export function accountDraftHasChanges(draft: UserAccountDraft, baseline: UserAccountDraft): boolean {
  return JSON.stringify(draft) !== JSON.stringify(baseline);
}

export function accountPermissionEnabled(draft: Pick<UserAccountDraft, 'role' | 'permissions'>, permission: AccountPermission): boolean {
  return canPerformAction({ role: draft.role, permissions: draft.permissions } as User, permission.action);
}

export function validateAccountSchedule(schedule: User['accessSchedule']): string | null {
  if (!schedule?.enabled) return null;
  if (!Array.isArray(schedule.days) || !schedule.days.length || schedule.days.some(day => !Number.isInteger(day) || day < 0 || day > 6)) {
    return 'اختر يوم عمل واحدًا على الأقل من أيام الأسبوع.';
  }
  const time = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!time.test(string(schedule.startTime)) || !time.test(string(schedule.endTime)) || schedule.startTime === schedule.endTime) {
    return 'اختر وقت بداية ونهاية صحيحين ومختلفين. يمكن أن تنتهي الوردية بعد منتصف الليل.';
  }
  if (schedule.timezone) {
    try { new Intl.DateTimeFormat('en', { timeZone: schedule.timezone }); }
    catch { return 'المنطقة الزمنية المحفوظة غير صالحة؛ راجع إعدادات الحساب قبل تفعيل الأوقات.'; }
  }
  return null;
}

/** A manager is usable in at least one valid work window, not necessarily at this instant. */
export function isUsableControlPanelManager(user: User): boolean {
  return user.isActive !== false && !!string(user.username).trim()
    && hasPasswordCredential(user) && canPerformAction(user, 'manage_users') && !validateAccountSchedule(user.accessSchedule);
}

export function guardAccountRemoval(users: User[], userId: string, currentUserId?: string, serverCredentials = false): string | null {
  if (userId === currentUserId) return 'لا يمكن حذف الحساب المستخدم حاليًا. يمكنك إيقاف حساب آخر بدلًا من حذفه.';
  if (!users.some(user => user.id === userId)) return 'الحساب لم يعد موجودًا. حدّث القائمة ثم حاول مرة أخرى.';
  if (!users.some(user => user.id !== userId && (serverCredentials ? user.passwordConfigured && user.isActive !== false && ['doctor','admin'].includes(user.role) : isUsableControlPanelManager(user)))) return 'لا يمكن حذف آخر حساب إداري صالح للدخول. احتفظ بحساب إداري نشط واحد على الأقل.';
  return null;
}

export interface UserAccountValidation {
  valid: boolean;
  user: User | null;
  errors: Record<string, string>;
  newPermissionGrants: string[];
  passwordChanged: boolean;
}

export function validateUserAccountDraft(draft: UserAccountDraft, users: User[], original?: User | null, newId = '', serverCredentials = false): UserAccountValidation {
  const errors: Record<string, string> = {};
  const baseline = createUserAccountDraft(original);
  const name = string(draft.name).trim();
  const username = string(draft.username).trim().toLowerCase();
  // Passwords are not names: leading/trailing spaces can be meaningful.
  const password = string(draft.newPassword);
  const singleLine = /[\u0000-\u001f\u007f]/;
  if (!name || Array.from(name).length > 100 || singleLine.test(name)) errors.name = 'اكتب اسمًا من 1 إلى 100 حرف في سطر واحد.';
  if (!username || Array.from(username).length > 60 || singleLine.test(username)) errors.username = 'اكتب اسم دخول من 1 إلى 60 حرف في سطر واحد.';
  else if (users.some(user => user.id !== original?.id && string(user.username).trim().toLowerCase() === username)) errors.username = 'اسم الدخول مستخدم بالفعل؛ اختر اسمًا آخر.';
  if ((!original || !(serverCredentials ? original.passwordConfigured : hasPasswordCredential(original))) && !password) errors.newPassword = 'اكتب كلمة سر للحساب؛ الدخول دون كلمة سر غير مسموح.';
  if (password) {
    const passwordError = validateNewPassword(password);
    if (passwordError) errors.newPassword = passwordError;
  }
  if (!['doctor', 'secretary', 'admin'].includes(draft.role)) errors.role = 'اختر نوع حساب صحيحًا.';
  if (string(draft.email).trim().length > 254 || singleLine.test(string(draft.email))) errors.email = 'البريد الإلكتروني طويل جدًا أو يحتوي على سطر جديد.';
  if (string(draft.phone).trim().length > 40 || singleLine.test(string(draft.phone))) errors.phone = 'رقم الهاتف طويل جدًا أو يحتوي على سطر جديد.';
  if (!record(draft.permissions)) errors.permissions = 'الصلاحيات غير صالحة؛ أعد فتح الحساب.';
  if (!original && (!newId || users.some(user => user.id === newId))) errors.account = 'تعذّر تحديد حساب جديد؛ أعد المحاولة.';
  if (original && !users.some(user => user.id === original.id)) errors.account = 'الحساب لم يعد موجودًا؛ أغلق النافذة وحدّث القائمة.';

  // Spread the original first: optional fields, unknown extras and legacy flags stay untouched.
  const user: User = original ? clone(original) : {
    id: newId, name, username, password, role: draft.role, permissions: clone(draft.permissions),
    credentialVersion: 1, isActive: draft.isActive,
  };
  if (!original || draft.name !== baseline.name) user.name = name;
  if (!original || draft.username !== baseline.username) user.username = username;
  if (!original || draft.email !== baseline.email) user.email = string(draft.email).trim();
  if (!original || draft.phone !== baseline.phone) user.phone = string(draft.phone).trim();
  if (!original || draft.role !== baseline.role) user.role = draft.role;
  if (!original || draft.isActive !== baseline.isActive) user.isActive = draft.isActive;
  if (!original || JSON.stringify(draft.permissions) !== JSON.stringify(baseline.permissions)) user.permissions = clone(draft.permissions);

  const passwordChanged = !!password && password !== original?.password;
  if (original && passwordChanged) {
    user.password = password;
    const version = Number.isInteger(original.credentialVersion) && original.credentialVersion! > 0 ? original.credentialVersion! : 1;
    user.credentialVersion = version + 1;
  }
  const scheduleChanged = draft.scheduleEnabled !== baseline.scheduleEnabled || draft.scheduleStart !== baseline.scheduleStart
    || draft.scheduleEnd !== baseline.scheduleEnd || JSON.stringify(draft.scheduleDays) !== JSON.stringify(baseline.scheduleDays);
  if (scheduleChanged || (!original && draft.scheduleEnabled)) {
    user.accessSchedule = {
      ...(record(original?.accessSchedule) ? clone(original.accessSchedule) : { timezone: 'Africa/Cairo' }),
      enabled: draft.scheduleEnabled, days: Array.isArray(draft.scheduleDays) ? [...new Set(draft.scheduleDays)] : [],
      startTime: draft.scheduleStart, endTime: draft.scheduleEnd,
    } as NonNullable<User['accessSchedule']>;
  }
  const scheduleError = validateAccountSchedule(user.accessSchedule);
  if (scheduleError) errors.schedule = scheduleError;
  const nextUsers = original ? users.map(item => item.id === original.id ? user : item) : [...users, user];
  if (!nextUsers.some(user => serverCredentials ? user.isActive !== false && ['doctor','admin'].includes(user.role) && (user.passwordConfigured || !!password && user.id === newId) : isUsableControlPanelManager(user))) errors.manager = 'احتفظ بحساب إداري نشط صالح للدخول واحد على الأقل؛ لا يمكن إيقافه أو سحب إدارته أو جعل جدوله غير صالح.';
  const before = original || ({ role: 'secretary', permissions: createSafeSecretaryPermissions() } as User);
  const newPermissionGrants = ACCOUNT_PERMISSION_GROUPS.flatMap(group => group.items)
    .filter(permission => !canPerformAction(before, permission.action) && canPerformAction(user, permission.action))
    .map(permission => permission.label);
  return { valid: Object.keys(errors).length === 0, user: Object.keys(errors).length ? null : user, errors, newPermissionGrants, passwordChanged };
}

// Internal comparison only. Do not render this value or place it in element attributes.
export function userAccountsSnapshot(users: User[]): string { return JSON.stringify(users); }

export function accountScheduleLabel(user: User): string {
  const schedule = user.accessSchedule;
  if (!schedule?.enabled) return 'دون تقييد أوقات';
  if (validateAccountSchedule(schedule)) return 'جدول يحتاج مراجعة';
  return `${schedule.days.length} أيام · ${schedule.startTime} – ${schedule.endTime}${schedule.startTime > schedule.endTime ? ' · حتى اليوم التالي' : ''}`;
}
