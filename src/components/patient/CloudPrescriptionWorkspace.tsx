import React, { useEffect, useRef, useSyncExternalStore } from 'react';
import { FileText, RefreshCw, X } from 'lucide-react';
import { ToastAndConfirmProvider } from '../common/ToastAndConfirm';
import { PrescriptionAndInstructionsView } from './PrescriptionAndInstructionsView';
import type { CloudPrescriptionWorkspaceController } from '../../utils/cloudPrescriptionWorkspaceController';

export interface CloudPrescriptionWorkspaceProps {
  controller: CloudPrescriptionWorkspaceController; patientRecordId: string; onClose(): void; disabled?: boolean;
}
export default function CloudPrescriptionWorkspace({ controller, patientRecordId, onClose, disabled = false }: CloudPrescriptionWorkspaceProps) {
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  const lease = { controller, patientRecordId, onClose, disabled };
  const latest = useRef<typeof lease | null>(lease); latest.current = lease;
  useEffect(() => {
    if (latest.current === null) latest.current = lease;
    return () => { if (latest.current?.controller === controller) latest.current = null; };
  }, [controller]);
  const document = state.closed || state.document?.patientRecordId !== patientRecordId ? null : state.document;
  const allowed = () => {
    const current = latest.current;
    if (!current || current.controller !== controller || current.patientRecordId !== patientRecordId || current.disabled) return false;
    const now = controller.getState();
    return latest.current === current && !now.closed && !now.loading && !now.outputPending
      && now.document === document && (!document || document.patientRecordId === patientRecordId);
  };
  const assertAllowed = () => { if (!allowed() || !document) throw new Error('انتظر تأكيد الجلسة قبل طباعة الروشتة أو مشاركتها.'); };
  return <section className="mx-auto w-full max-w-6xl space-y-4 pb-24" dir="rtl" aria-label="روشتة المريض السحابية">
    <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="inline-flex items-center gap-2 text-lg font-extrabold"><FileText className="text-indigo-600" />روشتة المريض</h2>
      <button type="button" disabled={disabled || state.loading || state.outputPending || state.closed}
        className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-bold disabled:opacity-40"
        onClick={() => { if (!allowed()) return;
          if (document && !controller.discard(document)) return;
          const current = latest.current;
          if (current?.controller === controller && current.patientRecordId === patientRecordId && !current.disabled
            && controller.canClose() && latest.current === current) current.onClose(); }}><X size={18} />إغلاق ومسح مسودة الروشتة</button>
    </header>
    <p className="rounded-xl bg-blue-50 p-3 text-sm leading-7 text-blue-900">مسودة الروشتة في هذه الشاشة فقط؛ لا تُحفظ كأرشيف. الطباعة وصورة واتساب تستخدمان تصميم الورقة نفسه، والمشاركة لا تعني تأكيد وصولها للمريض.</p>
    {state.error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{state.error}</p>}
    {state.loading && <p role="status" className="rounded-xl bg-slate-100 p-4">جارٍ التحقق من المريض وإعدادات العيادة…</p>}
    {!document && !state.closed && <button type="button" disabled={disabled || state.loading || state.outputPending}
      className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 font-bold text-white disabled:opacity-40"
      onClick={() => { if (allowed() && !controller.getState().document) void controller.load(patientRecordId); }}><RefreshCw size={18} />قراءة بيانات الروشتة</button>}
    {document && <ToastAndConfirmProvider><PrescriptionAndInstructionsView key={document.patientRecordId}
      patient={document.patient} clinicName={document.clinicName} clinicLogo={document.clinicLogo} drugCatalog={document.medications}
      prescriptionHeader={document.header} canPrint={!disabled} canSendWhatsApp={!disabled}
      onPrepareOutput={async () => { assertAllowed(); await controller.authorizeOutput(document); assertAllowed(); }}
      onAuthorizePrint={() => { assertAllowed(); controller.assertOutputActive(document); assertAllowed(); }}
      onAuthorizeWhatsappSend={() => { assertAllowed(); controller.assertOutputActive(document); assertAllowed(); }} /></ToastAndConfirmProvider>}
  </section>;
}
