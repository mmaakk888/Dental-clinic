import React, { useState, useMemo } from 'react';
import { History, Filter, Search, Download, Trash2, User, ShieldCheck, Calendar, HardDrive, Printer } from 'lucide-react';
import { getAuditLogs, AuditLogItem } from '../../services/auditLogger';

export const AuditTrailView: React.FC = () => {
  const [logs] = useState<AuditLogItem[]>(() => getAuditLogs());
  const [searchQuery, setSearchQuery] = useState('');
  const [filterAction, setFilterAction] = useState<string>('all');
  const [filterEntity, setFilterEntity] = useState<string>('all');

  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      const q = searchQuery.toLowerCase().trim();
      const matchSearch =
        !q ||
        log.userName.toLowerCase().includes(q) ||
        log.recordName.toLowerCase().includes(q) ||
        log.details.toLowerCase().includes(q);

      const matchAction = filterAction === 'all' || log.action === filterAction;
      const matchEntity = filterEntity === 'all' || log.entity === filterEntity;

      return matchSearch && matchAction && matchEntity;
    });
  }, [logs, searchQuery, filterAction, filterEntity]);

  const handleExportCSV = () => {
    const headers = ['المعرف', 'التاريخ والوقت', 'المستخدم', 'الدور', 'العملية', 'الجهة', 'السجل', 'التفاصيل', 'الجهاز'];
    const rows = filteredLogs.map(l => [
      l.id,
      new Date(l.timestamp).toLocaleString('ar-EG'),
      l.userName,
      l.userRole,
      l.action,
      l.entity,
      `"${l.recordName.replace(/"/g, '""')}"`,
      `"${l.details.replace(/"/g, '""')}"`,
      l.device || ''
    ]);

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `سجل_نشاطات_العيادة_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="bg-white rounded-3xl p-5 sm:p-6 shadow-sm border border-slate-200/80 space-y-6 font-tajawal">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold shadow-2xs">
            <History className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg sm:text-xl font-black text-slate-900">سجل النشاطات والمراجعة (Audit Log)</h2>
            <p className="text-xs sm:text-sm text-slate-500">تتبع كامل لجميع العمليات، التعديلات والحذفيات في العيادة لضمان الأمان والمساءلة</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs sm:text-sm shadow-xs transition-all cursor-pointer"
          >
            <Download className="w-4 h-4" />
            تصدير excel / csv
          </button>
          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 px-3.5 py-2.5 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs sm:text-sm transition-all cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            طباعة
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50 p-3.5 rounded-2xl border border-slate-200/80">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="بحث باسم المستخدم أو السجل..."
            className="w-full pr-9 pl-3 py-2 bg-white rounded-xl border border-slate-200 text-xs sm:text-sm font-bold text-slate-900 focus:ring-2 focus:ring-indigo-200 outline-none"
          />
        </div>

        <select
          value={filterAction}
          onChange={e => setFilterAction(e.target.value)}
          className="px-3 py-2 bg-white rounded-xl border border-slate-200 text-xs sm:text-sm font-bold text-slate-800 outline-none"
        >
          <option value="all">كل العمليات</option>
          <option value="create">إضافة جديد</option>
          <option value="edit">تعديل بيانات</option>
          <option value="delete">حذف سجل</option>
          <option value="payment">تحصيل مالي</option>
          <option value="login">تسجيل دخول</option>
        </select>

        <select
          value={filterEntity}
          onChange={e => setFilterEntity(e.target.value)}
          className="px-3 py-2 bg-white rounded-xl border border-slate-200 text-xs sm:text-sm font-bold text-slate-800 outline-none"
        >
          <option value="all">كل الأقسام</option>
          <option value="patient">سجلات المرضى</option>
          <option value="appointment">المواعيد</option>
          <option value="lab">حالات المعمل</option>
          <option value="expense">المصروفات</option>
          <option value="system">النظام والسيشن</option>
        </select>
      </div>

      {/* Table of logs */}
      <div className="overflow-x-auto rounded-2xl border border-slate-200/80">
        <table className="w-full text-right border-collapse">
          <thead>
            <tr className="bg-slate-100/80 text-slate-700 text-xs font-black">
              <th className="p-3.5">الوقت والتاريخ</th>
              <th className="p-3.5">المستخدم</th>
              <th className="p-3.5">نوع العملية</th>
              <th className="p-3.5">السجل المترابط</th>
              <th className="p-3.5">التفاصيل والقيمة</th>
              <th className="p-3.5">الجهاز</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-xs sm:text-sm font-semibold">
            {filteredLogs.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-slate-400">
                  لا توجد عمليات مسجلة تطابق فلتر البحث
                </td>
              </tr>
            ) : (
              filteredLogs.map(log => {
                let badgeBg = 'bg-slate-100 text-slate-700';
                let actionLabel = log.action;

                if (log.action === 'create') {
                  badgeBg = 'bg-emerald-100 text-emerald-800 border-emerald-200';
                  actionLabel = 'إضافة جديد';
                } else if (log.action === 'edit') {
                  badgeBg = 'bg-amber-100 text-amber-800 border-amber-200';
                  actionLabel = 'تعديل';
                } else if (log.action === 'delete') {
                  badgeBg = 'bg-rose-100 text-rose-800 border-rose-200';
                  actionLabel = 'حذف';
                } else if (log.action === 'payment') {
                  badgeBg = 'bg-indigo-100 text-indigo-800 border-indigo-200';
                  actionLabel = 'تحصيل مالي';
                } else if (log.action === 'login') {
                  badgeBg = 'bg-purple-100 text-purple-800 border-purple-200';
                  actionLabel = 'تسجيل دخول';
                }

                return (
                  <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                    <td className="p-3.5 font-mono text-slate-600 dir-ltr text-right">
                      {new Date(log.timestamp).toLocaleString('ar-EG', {
                        month: 'numeric',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </td>
                    <td className="p-3.5">
                      <div className="font-extrabold text-slate-900">{log.userName}</div>
                      <span className="text-[10px] text-slate-500 font-bold">{log.userRole}</span>
                    </td>
                    <td className="p-3.5">
                      <span className={`px-2.5 py-1 rounded-lg text-xs font-bold border ${badgeBg}`}>
                        {actionLabel}
                      </span>
                    </td>
                    <td className="p-3.5 font-bold text-slate-800">{log.recordName}</td>
                    <td className="p-3.5 text-slate-600 max-w-xs leading-relaxed">
                      {log.details}
                      {log.newValue && (
                        <span className="block text-emerald-700 font-bold mt-0.5">القيمة: {log.newValue}</span>
                      )}
                    </td>
                    <td className="p-3.5 text-slate-500 text-xs font-medium">{log.device || 'كمبيوتر'}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
