import React, { useCallback, useRef, useSyncExternalStore } from 'react';
import { ClinicContacts } from '../settings/ClinicContacts';
import { ToastAndConfirmProvider } from '../common/ToastAndConfirm';
import type { CloudClinicOverviewState } from '../../utils/cloudClinicOverviewController';
import type { CloudOriginalContactsBridge } from '../../utils/cloudOriginalContactsBridge';
import { CloudOriginalOperationRecovery } from '../common/CloudOriginalOperationRecovery';

/** Render the exact original component, not a rewritten/look-alike directory. */
export function CloudOriginalContacts(props: {
  state: Readonly<CloudClinicOverviewState>; bridge: CloudOriginalContactsBridge; disabled?: boolean;
  onOpenPatient(id: string): void; onNavigate?(section: string): void;
}) {
  const { state, bridge } = props;
  const operation = useSyncExternalStore(bridge.subscribe, bridge.getState, bridge.getState);
  const latest = useRef(props); latest.current = props;
  const onEditorChange = useCallback((open: boolean) => bridge.setEditorOpen(open), [bridge]);
  const snapshot = state.snapshot;
  if (!snapshot || state.closed || operation.closed) return <p role="status">{state.error || 'جارٍ فتح دليل جهات الاتصال…'}</p>;
  const valid = () => latest.current.bridge === bridge && !latest.current.disabled && !latest.current.state.closed
    && latest.current.state.snapshot === snapshot && !latest.current.state.loading && !latest.current.state.exporting && !bridge.getState().closed;
  return <ToastAndConfirmProvider>
    <CloudOriginalOperationRecovery bridge={bridge} label="جهة الاتصال" disabled={props.disabled} />
    {state.error && <p role="alert" className="cloud-overview__error">{state.error}</p>}
    {operation.error && <p role="alert" className="cloud-overview__error">{operation.error}</p>}
    <div inert={props.disabled || state.loading || state.exporting || undefined}>
      <ClinicContacts contacts={snapshot.records.contactRecords.flatMap(row => !row.deleted && row.data ? [row.data] : [])}
        patients={snapshot.patients.map(row => row.patient)} canManageContacts onEditorChange={onEditorChange}
        onSave={async (contact, original) => { if (!valid()) throw new Error('انتظر تأكيد الجلسة قبل الحفظ.'); await bridge.save(snapshot, contact, original); }}
        onDelete={async original => { if (!valid()) throw new Error('انتظر تأكيد الجلسة قبل التعديل.'); await bridge.remove(snapshot, original); }}
        onOpenPatient={fileNo => { if (!valid()) return; bridge.setEditorOpen(false); if (!bridge.canClose()) return;
          const row = snapshot.patients.find(row => String(row.profile.fileNo) === fileNo); if (row) props.onOpenPatient(row.patientRecordId); }}
        onOpenCampaigns={props.onNavigate ? () => { if (valid() && bridge.canClose()) props.onNavigate?.('whatsapp'); } : undefined} />
    </div>
  </ToastAndConfirmProvider>;
}
