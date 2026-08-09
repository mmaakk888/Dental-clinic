import React, { useState } from 'react';
import { ShieldCheck, CheckCircle2, XCircle, Clock, AlertTriangle, UserCheck, X } from 'lucide-react';
import { DeviceSecurity, PendingApprovalRequest } from '../../utils/deviceSecurity';
import { User } from '../../types';

interface ApprovalQueueModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User | null;
  onApproveRequest?: (req: PendingApprovalRequest) => void;
  onRejectRequest?: (req: PendingApprovalRequest) => void;
}

export const ApprovalQueueModal: React.FC<ApprovalQueueModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onApproveRequest,
  onRejectRequest,
}) => {
  const [requests, setRequests] = useState<PendingApprovalRequest[]>(() => DeviceSecurity.getApprovalRequests());
  const [activeTab, setActiveTab] = useState<'pending' | 'processed'>('pending');
  const [doctorNotes, setDoctorNotes] = useState<Record<string, string>>({});

  if (!isOpen) return null;

  const handleAction = (req: PendingApprovalRequest, approve: boolean) => {
    const note = doctorNotes[req.id] || '';
    const updated = DeviceSecurity.processApprovalRequest(req.id, approve, note);
    setRequests(DeviceSecurity.getApprovalRequests());
    if (approve && onApproveRequest) onApproveRequest(req);
    if (!approve && onRejectRequest) onRejectRequest(req);
  };

  const pendingRequests = requests.filter(r => r.status === 'pending');
  const processedRequests = requests.filter(r => r.status !== 'pending');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-4 sm:p-5 bg-gradient-to-r from-slate-900 to-indigo-950 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold">مركز أذونات وتأكيدات الطبيب</h2>
              <p className="text-xs text-slate-300">مراجعة التعديلات والحذوفات الحساسة المطلوبة من المساعد / الاستقبال</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-white/10 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-200 bg-slate-50 px-4 pt-3 gap-2">
          <button
            onClick={() => setActiveTab('pending')}
            className={`px-4 py-2 font-medium text-sm rounded-t-xl transition flex items-center gap-2 ${
              activeTab === 'pending'
                ? 'bg-white border-t border-x border-slate-200 text-indigo-700 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Clock className="w-4 h-4 text-amber-500" />
            <span>طلبات معلقة ({pendingRequests.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('processed')}
            className={`px-4 py-2 font-medium text-sm rounded-t-xl transition flex items-center gap-2 ${
              activeTab === 'processed'
                ? 'bg-white border-t border-x border-slate-200 text-indigo-700 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <UserCheck className="w-4 h-4 text-emerald-500" />
            <span>السجل المكتمل ({processedRequests.length})</span>
          </button>
        </div>

        {/* Body List */}
        <div className="p-4 sm:p-5 flex-1 overflow-y-auto space-y-3">
          {activeTab === 'pending' ? (
            pendingRequests.length === 0 ? (
              <div className="py-12 text-center text-slate-400">
                <CheckCircle2 className="w-12 h-12 mx-auto mb-2 text-emerald-500/50" />
                <p className="font-medium">لا توجد طلبات أذونات معلقة حالياً</p>
                <p className="text-xs text-slate-400 mt-1">جميع إجراءات الاستقبال مطابقة مع الصلاحيات المعتمدة.</p>
              </div>
            ) : (
              pendingRequests.map(req => (
                <div key={req.id} className="p-4 rounded-xl border border-amber-200 bg-amber-50/50 shadow-sm space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
                      <div>
                        <span className="text-xs font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded">
                          {req.actionType === 'DELETE_PATIENT' && 'حذف سجل مريض'}
                          {req.actionType === 'DELETE_SESSION' && 'إلغاء جلسة علاجية'}
                          {req.actionType === 'DELETE_EXPENSE' && 'حذف مصروف مالي'}
                          {req.actionType === 'FINANCIAL_DISCOUNT_OVERRIDE' && 'تعديل خصم مالي'}
                          {req.actionType === 'MODIFY_SETTINGS' && 'تعديل إعدادات النظام'}
                        </span>
                        <h4 className="text-sm font-bold text-slate-900 mt-1">{req.details}</h4>
                      </div>
                    </div>
                    <span className="text-xs text-slate-500 whitespace-nowrap">{req.createdAt}</span>
                  </div>

                  <div className="text-xs text-slate-600 bg-white/80 p-2.5 rounded-lg border border-amber-100 flex items-center justify-between">
                    <span>المُطالب: <strong>{req.requestedBy.userName}</strong> ({req.requestedBy.role === 'secretary' ? 'مساعد / استقبال' : req.requestedBy.role})</span>
                    <span>معرف السجل: {req.entityId}</span>
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <input
                      type="text"
                      placeholder="ملاحظة الطبيب (اختياري)..."
                      value={doctorNotes[req.id] || ''}
                      onChange={e => setDoctorNotes({ ...doctorNotes, [req.id]: e.target.value })}
                      className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <button
                      onClick={() => handleAction(req, true)}
                      className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium px-3.5 py-1.5 rounded-lg transition"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>موافقة</span>
                    </button>
                    <button
                      onClick={() => handleAction(req, false)}
                      className="flex items-center gap-1 bg-rose-600 hover:bg-rose-700 text-white text-xs font-medium px-3.5 py-1.5 rounded-lg transition"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      <span>رفض</span>
                    </button>
                  </div>
                </div>
              ))
            )
          ) : processedRequests.length === 0 ? (
            <div className="py-12 text-center text-slate-400">
              <p>لا يوجد سجل طلبات معالجة سابقة.</p>
            </div>
          ) : (
            processedRequests.map(req => (
              <div key={req.id} className="p-3.5 rounded-xl border border-slate-200 bg-white flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs font-bold px-2 py-0.5 rounded ${
                        req.status === 'approved' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                      }`}
                    >
                      {req.status === 'approved' ? 'تمت الموافقة' : 'مرفوض'}
                    </span>
                    <span className="text-xs text-slate-500">{req.details}</span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    بواسطة: {req.requestedBy.userName} | التارِيخ: {req.processedAt || req.createdAt}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-5 py-2 text-sm font-medium bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-xl transition"
          >
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
};
