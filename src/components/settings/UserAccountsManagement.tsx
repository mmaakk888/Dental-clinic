import React, { useRef, useState } from 'react';
import { ChevronLeft, Clock3, Pencil, Plus, Search, ShieldCheck, Trash2, UserRound, X } from 'lucide-react';
import type { User } from '../../types';
import { canPerformAction } from '../../utils/rbac';
import { secureUserAccountsForStorage } from '../../utils/passwords';
import {
  ACCOUNT_PERMISSION_GROUPS, ACCOUNT_WEEKDAYS, accountDraftHasChanges, accountPermissionEnabled,
  accountScheduleLabel, createUserAccountDraft, guardAccountRemoval, userAccountsSnapshot,
  validateUserAccountDraft, type UserAccountDraft,
} from '../../utils/userAccounts';
import { useAppointmentDialog } from '../appointments/useAppointmentDialog';
import { useToastAndConfirm } from '../common/ToastAndConfirm';
import './userAccountsManagement.css';

export interface UserAccountsManagementProps {
  users: User[];
  currentUser: User | null;
  onSaveUsers: (users: User[]) => void | Promise<void>;
}

type EditorTab = 'details' | 'permissions' | 'hours';
type Editor = {
  original: User | null;
  baseline: UserAccountDraft;
  draft: UserAccountDraft;
  snapshot: string;
  newId: string;
};
const roleLabel: Record<User['role'], string> = { doctor: 'طبيب', secretary: 'سكرتارية', admin: 'مدير' };
const tabs: { key: EditorTab; label: string }[] = [
  { key: 'details', label: 'البيانات' }, { key: 'permissions', label: 'الصلاحيات' }, { key: 'hours', label: 'أوقات العمل' },
];
const permissionKeys = new Set(ACCOUNT_PERMISSION_GROUPS.flatMap(group => group.items.map(item => item.key)));
const modalError = (error: unknown) => error instanceof Error && error.message ? error.message : 'تعذّر حفظ الحسابات. لم يتم إغلاق النافذة؛ راجع البيانات وحاول مرة أخرى.';

export function UserAccountsManagement({ users, currentUser, onSaveUsers }: UserAccountsManagementProps) {
  const { askConfirm, showToast } = useToastAndConfirm();
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [tab, setTab] = useState<EditorTab>('details');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const savingRef = useRef(false);
  const latest = useRef({ users, currentUser, onSaveUsers });
  latest.current = { users, currentUser, onSaveUsers };
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const authorized = currentUser?.isActive !== false && canPerformAction(currentUser, 'manage_users');
  const stale = !!editor && editor.snapshot !== userAccountsSnapshot(users);
  const dirty = !!editor && accountDraftHasChanges(editor.draft, editor.baseline);

  const closeEditor = () => {
    if (savingRef.current) return;
    if (editorRef.current && accountDraftHasChanges(editorRef.current.draft, editorRef.current.baseline)) {
      askConfirm({ title: 'إغلاق دون حفظ؟', message: 'توجد تعديلات في هذا الحساب لم تُحفظ. هل تريد تجاهلها؟', confirmLabel: 'تجاهل وإغلاق', tone: 'warning', onConfirm: () => { setEditor(null); setErrors({}); } });
    } else { setEditor(null); setErrors({}); }
  };
  const dialogRef = useAppointmentDialog(!!editor, closeEditor);
  const openEditor = (user: User | null) => {
    if (!authorized) { setNotice('الحساب الحالي لا يملك صلاحية إدارة المستخدمين.'); return; }
    const draft = createUserAccountDraft(user);
    setEditor({ original: user, baseline: createUserAccountDraft(user), draft, snapshot: userAccountsSnapshot(users), newId: user?.id || `u_${globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`}` });
    setTab('details'); setErrors({}); setNotice('');
  };
  const updateDraft = (values: Partial<UserAccountDraft>) => {
    if (savingRef.current) return;
    setEditor(value => value ? { ...value, draft: { ...value.draft, ...values } } : null);
    setErrors({});
  };
  const checkLatest = (expectedSnapshot: string): boolean => {
    const value = latest.current;
    if (value.currentUser?.isActive === false || !canPerformAction(value.currentUser, 'manage_users')) {
      setErrors({ account: 'لم تعد صلاحية إدارة الحسابات متاحة للحساب الحالي.' }); return false;
    }
    if (userAccountsSnapshot(value.users) !== expectedSnapshot) {
      setErrors({ account: 'تغيّرت قائمة الحسابات أثناء التحرير. لم نحفظ فوق التغييرات الجديدة. أغلق النافذة وأعد فتح الحساب من القائمة الحالية.' }); return false;
    }
    return true;
  };
  const saveEditor = (event: React.FormEvent) => {
    event.preventDefault();
    if (savingRef.current) return;
    if (!editor || !checkLatest(editor.snapshot)) return;
    const validation = validateUserAccountDraft(editor.draft, latest.current.users, editor.original, editor.newId);
    if (!validation.valid) {
      setErrors(validation.errors);
      if (validation.errors.name || validation.errors.username || validation.errors.newPassword || validation.errors.role || validation.errors.email || validation.errors.phone) setTab('details');
      else if (validation.errors.schedule) setTab('hours');
      else if (validation.errors.manager || validation.errors.permissions) setTab('permissions');
      return;
    }
    if (editor.original && !dirty) return;
    const pending = editor;
    const notes = [
      validation.newPermissionGrants.length ? `سيُمنح وصول إضافي إلى: ${validation.newPermissionGrants.join('، ')}.` : '',
      pending.original?.isActive !== false && !pending.draft.isActive ? 'سيُوقف دخول هذا الحساب وجلساته.' : '',
      pending.original && validation.passwordChanged ? 'سيتم تغيير كلمة السر وإلغاء جلسات الدخول القديمة لهذا الحساب.' : '',
      pending.original?.id === currentUser?.id ? 'أنت تعدّل الحساب المستخدم حاليًا؛ قد تحتاج لتسجيل الدخول مجددًا.' : '',
    ].filter(Boolean);
    askConfirm({
      title: pending.original ? 'حفظ تعديلات الحساب' : 'إنشاء حساب جديد',
      message: notes.length ? notes.join(' ') : 'ستُحفظ بيانات الحساب وصلاحياته وأوقات العمل الموضحة. هل تريد المتابعة؟',
      confirmLabel: 'تأكيد الحفظ', tone: notes.length ? 'warning' : 'info',
      onConfirm: async () => {
        // Recheck after confirmation: do not save a stale list or a subsequently changed draft.
        if (editorRef.current !== pending || !checkLatest(pending.snapshot)) return;
        const checked = validateUserAccountDraft(pending.draft, latest.current.users, pending.original, pending.newId);
        if (!checked.valid || !checked.user) { setErrors(checked.errors); return; }
        if (savingRef.current) return;
        const baselineUsers = latest.current.users;
        const nextUsers = pending.original ? baselineUsers.map(user => user.id === pending.original!.id ? checked.user! : user) : [...baselineUsers, checked.user];
        savingRef.current = true; setIsSaving(true);
        try {
          const secured = await secureUserAccountsForStorage(nextUsers, baselineUsers);
          // Hashing is asynchronous: do not apply a changed/closed draft, a stale
          // user list, or revoked authority after that wait.
          if (editorRef.current !== pending || !checkLatest(pending.snapshot)) return;
          await latest.current.onSaveUsers(secured);
          setEditor(null); setErrors({}); setNotice('');
          showToast('تم حفظ بيانات الحساب وصلاحياته.', 'success');
        } catch (error) { setErrors({ account: modalError(error) }); }
        finally { savingRef.current = false; setIsSaving(false); }
      },
    });
  };
  const removeAccount = (user: User) => {
    if (!authorized) { setNotice('الحساب الحالي لا يملك صلاحية إدارة المستخدمين.'); return; }
    const warning = guardAccountRemoval(users, user.id, currentUser?.id);
    if (warning) { setNotice(warning); return; }
    const snapshot = userAccountsSnapshot(users);
    askConfirm({ title: 'حذف حساب المستخدم', message: `سيُلغى دخول حساب «${user.name}» نهائيًا. إيقاف الحساب من نافذة التعديل يحافظ عليه للمراجعة. هل تريد الحذف؟`, confirmLabel: 'حذف الحساب', tone: 'danger', onConfirm: async () => {
      const value = latest.current;
      if (value.currentUser?.isActive === false || !canPerformAction(value.currentUser, 'manage_users')) { setNotice('لم تعد صلاحية إدارة الحسابات متاحة.'); return; }
      if (snapshot !== userAccountsSnapshot(value.users)) { setNotice('تغيّرت قائمة الحسابات. راجع القائمة الحالية قبل الحذف.'); return; }
      const error = guardAccountRemoval(value.users, user.id, value.currentUser?.id);
      if (error) { setNotice(error); return; }
      try { await value.onSaveUsers(value.users.filter(item => item.id !== user.id)); setNotice(''); showToast('تم حذف حساب المستخدم.', 'success'); }
      catch (error) { setNotice(modalError(error)); }
    } });
  };
  const query = search.trim().toLocaleLowerCase();
  const visible = users.filter(user => (!query || `${user.name || ''} ${user.username || ''}`.toLocaleLowerCase().includes(query))
    && (roleFilter === 'all' || user.role === roleFilter)
    && (statusFilter === 'all' || (statusFilter === 'active' ? user.isActive !== false : user.isActive === false)));
  const draft = editor?.draft;
  const unrestricted = draft?.role === 'doctor' || draft?.role === 'admin';
  const timezone = editor?.original?.accessSchedule?.timezone || (editor?.original?.accessSchedule ? 'توقيت الجهاز (إعداد سابق)' : 'Africa/Cairo');

  return <section className="ua-management" dir="rtl" aria-labelledby="ua-title">
    <header className="ua-heading">
      <div><span className="ua-eyebrow">الوصول إلى العيادة</span><h3 id="ua-title">الحسابات والصلاحيات</h3><p>كل حساب له بيانات دخول وصلاحيات وجدول عمل مستقل.</p></div>
      <button type="button" className="ua-button ua-button-primary" onClick={() => openEditor(null)} disabled={!authorized}><Plus size={17} aria-hidden="true" />إضافة حساب</button>
    </header>
    <div className="ua-toolbar">
      <label className="ua-search"><Search size={17} aria-hidden="true" /><span className="ua-sr-only">البحث بالاسم أو اسم الدخول</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="الاسم أو اسم الدخول" maxLength={100} /></label>
      <label className="ua-filter"><span>نوع الحساب</span><select value={roleFilter} onChange={event => setRoleFilter(event.target.value)}><option value="all">كل الأنواع</option><option value="doctor">طبيب</option><option value="secretary">سكرتارية</option><option value="admin">مدير</option></select></label>
      <label className="ua-filter"><span>الحالة</span><select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="all">كل الحالات</option><option value="active">نشط</option><option value="paused">موقوف</option></select></label>
    </div>
    <div className="ua-list-caption"><span>الحسابات الظاهرة: {visible.length} من {users.length}</span><span>كلمات السر لا تُعرض في القائمة.</span></div>
    {notice && <div className="ua-alert" role="alert">{notice}<button type="button" onClick={() => setNotice('')} aria-label="إغلاق التنبيه"><X size={16} /></button></div>}
    <div className="ua-account-list">
      {visible.map(user => <article key={user.id} className={`ua-account-row ${user.isActive === false ? 'ua-account-paused' : ''}`}>
        <div className="ua-avatar" aria-hidden="true"><UserRound size={19} /></div>
        <div className="ua-account-content"><div className="ua-account-name"><h4>{user.name || 'حساب بلا اسم'}</h4>{user.id === currentUser?.id && <span className="ua-badge ua-badge-current">حسابك الحالي</span>}</div>
          <p className="ua-account-username"><span dir="auto">{user.username}</span><span className="ua-account-dot" aria-hidden="true">·</span>{roleLabel[user.role] || 'نوع غير معروف'}</p>
          <div className="ua-account-meta"><span className={`ua-badge ${user.isActive === false ? 'ua-badge-paused' : 'ua-badge-active'}`}>{user.isActive === false ? 'موقوف' : 'نشط'}</span><span className="ua-schedule"><Clock3 size={13} aria-hidden="true" />{accountScheduleLabel(user)}</span></div>
        </div>
        <div className="ua-row-actions"><button type="button" className="ua-button ua-button-soft" onClick={() => openEditor(user)} disabled={!authorized} aria-label={`تعديل حساب ${user.name}`}><Pencil size={15} aria-hidden="true" /><span>تعديل</span></button><button type="button" className="ua-icon-button ua-delete" onClick={() => removeAccount(user)} disabled={!authorized || user.id === currentUser?.id} aria-label={`حذف حساب ${user.name}`} title={user.id === currentUser?.id ? 'لا يمكن حذف حسابك الحالي' : 'حذف الحساب'}><Trash2 size={16} aria-hidden="true" /></button></div>
      </article>)}
      {!visible.length && <div className="ua-empty"><UserRound size={24} aria-hidden="true" /><strong>لا توجد حسابات مطابقة</strong><p>غيّر البحث أو الفلاتر لعرض الحسابات.</p>{(search || roleFilter !== 'all' || statusFilter !== 'all') && <button type="button" className="ua-button ua-button-soft" onClick={() => { setSearch(''); setRoleFilter('all'); setStatusFilter('all'); }}>إلغاء الفلاتر</button>}</div>}
    </div>
    <p className="ua-footnote"><ShieldCheck size={15} aria-hidden="true" />أوقف الحساب غير المستخدم من نافذة التعديل. يُحمى آخر حساب إداري صالح للدخول من الحذف أو سحب إدارته.</p>

    {editor && draft && <div className="clinic-modal-overlay ua-overlay" onClick={event => { if (event.target === event.currentTarget) closeEditor(); }}>
      <div ref={dialogRef} className="clinic-modal-panel clinic-modal-panel--framed ua-dialog" role="dialog" aria-modal="true" aria-labelledby="ua-dialog-title" aria-describedby="ua-dialog-description" tabIndex={-1}>
        <header className="ua-dialog-header"><div><span className="ua-eyebrow">{editor.original ? 'تعديل حساب' : 'حساب جديد'}</span><h3 id="ua-dialog-title">{editor.original ? editor.original.name : 'إضافة مستخدم للعيادة'}</h3><p id="ua-dialog-description">راجع البيانات والصلاحيات وأوقات العمل قبل الحفظ.</p></div><button type="button" className="ua-icon-button" onClick={closeEditor} aria-label="إلغاء وإغلاق نافذة الحساب"><X size={20} /></button></header>
        <div className="ua-tabs" role="tablist" aria-label="أقسام إعداد الحساب">{tabs.map((item, index) => <button type="button" key={item.key} id={`ua-tab-${item.key}`} role="tab" aria-selected={tab === item.key} aria-controls={`ua-panel-${item.key}`} tabIndex={tab === item.key ? 0 : -1} onClick={() => setTab(item.key)} onKeyDown={event => {
          if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
            event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (['ArrowLeft', 'ArrowDown'].includes(event.key) ? 1 : -1) + tabs.length) % tabs.length;
            setTab(tabs[next].key); document.getElementById(`ua-tab-${tabs[next].key}`)?.focus();
          }
        }}>{item.label}</button>)}</div>
        <form className="ua-dialog-form" onSubmit={saveEditor} noValidate>
          <div className="ua-dialog-body">
            {stale && <div className="ua-alert" role="alert">تغيّرت بيانات الحسابات أثناء فتح النافذة. مسودتك محفوظة هنا، لكن يجب إعادة فتح الحساب قبل الحفظ لتجنب استبدال تغييرات جديدة.</div>}
            {!!Object.keys(errors).length && <div className="ua-alert" role="alert">{Object.entries(errors).map(([key, error]) => <p key={key}>{error}</p>)}</div>}
            {tab === 'details' && <div id="ua-panel-details" role="tabpanel" aria-labelledby="ua-tab-details" className="ua-tab-panel">
              <div className="ua-form-grid">
                <label className="ua-field"><span>الاسم الكامل <small>مطلوب</small></span><input data-dialog-autofocus value={draft.name} onChange={event => updateDraft({ name: event.target.value })} maxLength={100} autoComplete="name" aria-invalid={!!errors.name} /></label>
                <label className="ua-field"><span>اسم الدخول <small>مطلوب</small></span><input value={draft.username} onChange={event => updateDraft({ username: event.target.value })} maxLength={60} autoComplete="off" autoCapitalize="none" spellCheck={false} dir="auto" aria-invalid={!!errors.username} /></label>
                <label className="ua-field"><span>نوع الحساب</span><select value={draft.role} onChange={event => updateDraft({ role: event.target.value as User['role'] })}><option value="secretary">سكرتارية</option><option value="doctor">طبيب — وصول كامل</option><option value="admin">مدير — وصول كامل</option></select></label>
                <label className="ua-field"><span>حالة الحساب</span><select value={draft.isActive ? 'active' : 'paused'} onChange={event => updateDraft({ isActive: event.target.value === 'active' })}><option value="active">نشط — يمكنه الدخول</option><option value="paused">موقوف — لا يمكنه الدخول</option></select></label>
                <label className="ua-field"><span>الهاتف <small>اختياري</small></span><input type="tel" value={draft.phone} onChange={event => updateDraft({ phone: event.target.value })} maxLength={40} autoComplete="tel" dir="auto" aria-invalid={!!errors.phone} /></label>
                <label className="ua-field"><span>البريد الإلكتروني <small>اختياري</small></span><input type="email" value={draft.email} onChange={event => updateDraft({ email: event.target.value })} maxLength={254} autoComplete="email" dir="auto" aria-invalid={!!errors.email} /></label>
                <label className="ua-field ua-field-wide"><span>{editor.original ? 'كلمة سر جديدة' : 'كلمة السر'} <small>{editor.original?.password ? 'اختياري' : 'مطلوب'}</small></span><input type="password" value={draft.newPassword} onChange={event => updateDraft({ newPassword: event.target.value })} maxLength={128} autoComplete="new-password" aria-invalid={!!errors.newPassword} aria-describedby="ua-password-help" disabled={isSaving} /><small id="ua-password-help">{editor.original?.password ? 'اتركها فارغة للاحتفاظ بكلمة السر الحالية. أي كلمة سر جديدة تكون 12–128 حرفًا. لن نعرض القيمة المحفوظة.' : 'اكتب كلمة سر من 12–128 حرفًا؛ لا يُسمح بالدخول دون كلمة سر.'}</small></label>
              </div>
              <div className="ua-info"><ShieldCheck size={17} aria-hidden="true" /><p>{unrestricted ? 'الطبيب والمدير لهما وصول كامل في النظام الحالي، بغض النظر عن مفاتيح الصلاحيات. تغيير نوع الحساب لا يغيّر الصلاحيات المحفوظة تلقائيًا.' : 'السكرتارية تعمل حسب الصلاحيات في القسم التالي. تغيير نوع الحساب لا ينسخ صلاحيات جاهزة؛ راجعها قبل الحفظ.'}</p></div>
              <button type="button" className="ua-text-button" onClick={() => setTab('permissions')}>مراجعة الصلاحيات<ChevronLeft size={15} aria-hidden="true" /></button>
            </div>}
            {tab === 'permissions' && <div id="ua-panel-permissions" role="tabpanel" aria-labelledby="ua-tab-permissions" className="ua-tab-panel">
              <div className="ua-info"><ShieldCheck size={17} aria-hidden="true" /><p>{unrestricted ? 'هذا النوع من الحسابات يمتلك وصولًا كاملًا. المفاتيح أدناه توضح الوصول الفعلي ولا تفرض قيودًا عليه. الصلاحيات المحفوظة لم تتغير؛ اختر سكرتارية لتخصيصها.' : 'اختر ما يحتاجه هذا الحساب فقط. بعض الحسابات القديمة ترث صلاحيات فرعية؛ الحالة المعروضة تعكس الوصول الفعلي، ولن يتحول الإعداد القديم إلى اختيار صريح إلا إذا عدّلته.'}</p></div>
              {ACCOUNT_PERMISSION_GROUPS.map(group => <fieldset key={group.title} className="ua-permission-group"><legend>{group.title}</legend>{group.items.map(permission => <label key={permission.key} className={`ua-permission-row ${unrestricted ? 'ua-permission-disabled' : ''}`}><input type="checkbox" checked={accountPermissionEnabled(draft, permission)} disabled={unrestricted} onChange={event => {
                if (!permissionKeys.has(permission.key)) return;
                updateDraft({ permissions: { ...draft.permissions, [permission.key]: event.target.checked } });
              }} /><span><strong>{permission.label}</strong><small>{permission.help}</small>{!unrestricted && draft.permissions[permission.key] === undefined && <em>يتبع إعداد الحساب القديم</em>}</span></label>)}</fieldset>)}
            </div>}
            {tab === 'hours' && <div id="ua-panel-hours" role="tabpanel" aria-labelledby="ua-tab-hours" className="ua-tab-panel">
              <label className="ua-setting-switch"><input type="checkbox" checked={draft.scheduleEnabled} onChange={event => updateDraft({ scheduleEnabled: event.target.checked })} /><span><strong>تقييد الدخول بأوقات العمل</strong><small>خارج الأيام والأوقات المحددة يُمنع الدخول وتُراجع الجلسة المفتوحة.</small></span></label>
              <div className={`ua-hours-fields ${draft.scheduleEnabled ? '' : 'ua-hours-disabled'}`}>
                <fieldset disabled={!draft.scheduleEnabled} className="ua-days-field"><legend>أيام بداية الوردية</legend><div className="ua-day-grid">{ACCOUNT_WEEKDAYS.map((day, index) => <label key={day}><input type="checkbox" checked={draft.scheduleDays.includes(index)} onChange={event => updateDraft({ scheduleDays: event.target.checked ? [...draft.scheduleDays, index].sort((a, b) => a - b) : draft.scheduleDays.filter(value => value !== index) })} /><span>{day}</span></label>)}</div></fieldset>
                <div className="ua-form-grid"><label className="ua-field"><span>بداية العمل</span><input type="time" value={draft.scheduleStart} disabled={!draft.scheduleEnabled} onChange={event => updateDraft({ scheduleStart: event.target.value })} /></label><label className="ua-field"><span>نهاية العمل</span><input type="time" value={draft.scheduleEnd} disabled={!draft.scheduleEnabled} onChange={event => updateDraft({ scheduleEnd: event.target.value })} /></label></div>
                <p className="ua-hours-note">التوقيت: <b dir="auto">{timezone}</b>. إذا كانت النهاية قبل البداية، تنتهي الوردية في اليوم التالي وتُنسب إلى يوم بدايتها.</p>
              </div>
              <div className="ua-info"><Clock3 size={17} aria-hidden="true" /><p>«تذكرني» لا يلغي قيود أوقات العمل. هذا الإعداد يحدد الوقت فقط، ولا يقيّد شبكة الإنترنت أو مكان استخدام الهاتف.</p></div>
            </div>}
          </div>
          <footer className="ua-dialog-footer"><span>{isSaving ? 'جارٍ تأمين بيانات الدخول وحفظ الحساب…' : dirty ? 'تعديلات غير محفوظة' : editor.original ? 'لا توجد تعديلات' : 'راجع الحساب قبل الإنشاء'}</span><div><button type="button" className="ua-button ua-button-soft" onClick={closeEditor} disabled={isSaving}>إلغاء وإغلاق</button><button type="submit" className="ua-button ua-button-primary" disabled={isSaving || !authorized || stale || (!!editor.original && !dirty)}>{isSaving ? 'جارٍ الحفظ…' : editor.original ? 'حفظ التعديلات' : 'إنشاء الحساب'}</button></div></footer>
        </form>
      </div>
    </div>}
  </section>;
}

export default UserAccountsManagement;
