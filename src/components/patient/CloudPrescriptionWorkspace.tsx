import React, { useSyncExternalStore } from 'react';
import { FileText, RefreshCw, X } from 'lucide-react';
import { ToastAndConfirmProvider } from '../common/ToastAndConfirm';
import { PrescriptionAndInstructionsView } from './PrescriptionAndInstructionsView';
import type { CloudPrescriptionWorkspaceController } from '../../utils/cloudPrescriptionWorkspaceController';

export default function CloudPrescriptionWorkspace({ controller, patientRecordId, onClose }: {
  controller: CloudPrescriptionWorkspaceController; patientRecordId: string; onClose(): void;
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  const document = state.closed ? null : state.document;
  return <section className="mx-auto w-full max-w-6xl space-y-4 pb-24" dir="rtl" aria-label="روشتة المريض السحابية">
    <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="inline-flex items-center gap-2 text-lg font-extrabold"><FileText className="text-indigo-600" />روشتة المريض</h2>
      <button type="button" disabled={state.loading || state.outputPending || state.closed}
        className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-bold disabled:opacity-40"
        onClick={() => { if (state.loading || state.outputPending || state.closed) return;
          if (document && !controller.discard(document)) return;
          if (controller.canClose()) onClose(); }}><X size={18} />إغلاق ومسح مسودة الروشتة</button>
    </header>
    <p className="rounded-xl bg-blue-50 p-3 text-sm leading-7 text-blue-900">مسودة الروشتة في هذه الشاشة فقط؛ لا تُحفظ كأرشيف. الطباعة وصورة واتساب تستخدمان تصميم الورقة نفسه، والمشاركة لا تعني تأكيد وصولها للمريض.</p>
    {state.error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{state.error}</p>}
    {state.loading && <p role="status" className="rounded-xl bg-slate-100 p-4">جارٍ التحقق من المريض وإعدادات العيادة…</p>}
    {!document && !state.closed && <button type="button" disabled={state.loading || state.outputPending}
      className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 font-bold text-white disabled:opacity-40"
      onClick={() => { if (!controller.getState().document) void controller.load(patientRecordId); }}><RefreshCw size={18} />قراءة بيانات الروشتة</button>}
    {document && <ToastAndConfirmProvider><PrescriptionAndInstructionsView key={document.patientRecordId}
      patient={document.patient} clinicName={document.clinicName} clinicLogo={document.clinicLogo} drugCatalog={document.medications}
      prescriptionHeader={document.header} canPrint canSendWhatsApp
      onPrepareOutput={() => controller.authorizeOutput(document)}
      onAuthorizePrint={() => controller.assertOutputActive(document)}
      onAuthorizeWhatsappSend={() => controller.assertOutputActive(document)} /></ToastAndConfirmProvider>}
  </section>;
}
