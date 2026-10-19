import React, { useCallback, useRef, useSyncExternalStore } from 'react';
import { LabView } from './LabView';
import { ToastAndConfirmProvider } from '../common/ToastAndConfirm';
import type { CloudClinicOverviewState } from '../../utils/cloudClinicOverviewController';
import type { CloudOriginalLabsBridge } from '../../utils/cloudOriginalLabsBridge';
import { projectOriginalClinicViews } from '../../utils/cloudOriginalViewProjection';
import { CloudOriginalOperationRecovery } from '../common/CloudOriginalOperationRecovery';
export function CloudOriginalLabs(props: { state: Readonly<CloudClinicOverviewState>; bridge: CloudOriginalLabsBridge;
  disabled?: boolean; onNavigate?(section: string): void }) {
  const operation = useSyncExternalStore(props.bridge.subscribe, props.bridge.getState, props.bridge.getState);
  const settings = useSyncExternalStore(props.bridge.subscribeSettings, props.bridge.getSettingsState, props.bridge.getSettingsState);
  const latest = useRef(props); latest.current = props;
  const snapshot = props.state.snapshot, bridge = props.bridge;
  const onEditorChange = useCallback((open: boolean) => bridge.setEditorOpen(open), [bridge]);
  if (!snapshot || props.state.closed || operation.closed || settings.closed) return <p role="status">{props.state.error || 'جارٍ فتح المعامل والتركيبات…'}</p>;
  const valid = () => latest.current.bridge === bridge && !latest.current.disabled && !latest.current.state.closed
    && latest.current.state.snapshot === snapshot && !latest.current.state.loading && !latest.current.state.exporting && !bridge.getState().closed;
  const assert = () => { if (!valid()) throw new Error('انتظر التحقق من الجلسة قبل الحفظ.'); };
  const related = projectOriginalClinicViews(snapshot);
  return <ToastAndConfirmProvider>{props.state.error && <p role="alert">{props.state.error}</p>}
    <CloudOriginalOperationRecovery bridge={bridge} label="التركيبة أو دفعة المعمل" disabled={props.disabled} />
    <CloudOriginalOperationRecovery bridge={{ ...bridge, getState: bridge.getSettingsState, subscribe: bridge.subscribeSettings }} label="بيانات المعمل" disabled={props.disabled} />
    <div inert={props.disabled || props.state.loading || props.state.exporting || undefined}>
      <LabView labs={related.labs} labCases={related.labCases} patients={snapshot.patients.map(row => row.patient)} crownPrices={related.crownPrices}
        examinationFee={snapshot.settings.serviceCatalog.data.examinationCents / 100} canViewFinancials canManagePrices canRegisterPayment
        onEditorChange={onEditorChange}
        onSaveProstheticOrder={async value => { assert(); await bridge.order(snapshot, value); }}
        onSaveLab={async (value, baseline) => { assert(); await bridge.saveLab(snapshot, value, baseline); }}
        onDeleteLab={async id => { assert(); const original = related.labs.find(row => row.id === id); if (!original) throw new Error('المعمل غير موجود.'); await bridge.saveLab(snapshot, original, original, true); }}
        onSaveLabCase={async () => { throw new Error('الحالات السحابية ترتبط بخدمة المريض تلقائيًا؛ استخدم تسجيل تركيبة جديدة.'); }}
        onUpdateLabCase={async value => { assert(); await bridge.progress(snapshot, value); }}
        onAddLabCasePayment={async (id, amount) => { assert(); const original = related.labCases.find(row => row.id === id); if (!original) throw new Error('الحالة غير موجودة.'); await bridge.payment(snapshot, original.labId, id, amount); }}
        onBulkPayment={async (id, amount) => { assert(); await bridge.payment(snapshot, id, null, amount); }}
        onManageLabPrices={id => { if (valid()) props.onNavigate?.(`lab-prices:${id ?? '*'}`); }}
        onBackToHome={() => { if (valid()) props.onNavigate?.('home'); }} />
    </div></ToastAndConfirmProvider>;
}
