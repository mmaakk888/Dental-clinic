import React, { useCallback, useRef, useSyncExternalStore } from 'react';
import { AppointmentsView } from './AppointmentsView';
import { ToastAndConfirmProvider } from '../common/ToastAndConfirm';
import type { CloudClinicOverviewState } from '../../utils/cloudClinicOverviewController';
import type { CloudOriginalAppointmentsBridge } from '../../utils/cloudOriginalAppointmentsBridge';
import { projectOriginalClinicViews } from '../../utils/cloudOriginalViewProjection';
import { CloudOriginalOperationRecovery } from '../common/CloudOriginalOperationRecovery';
export function CloudOriginalAppointments(props: { state: Readonly<CloudClinicOverviewState>; bridge: CloudOriginalAppointmentsBridge;
  disabled?: boolean; onOpenPatient(id: string): void; onNavigate?(section: string): void }) {
  const operation = useSyncExternalStore(props.bridge.subscribe, props.bridge.getState, props.bridge.getState);
  const latest = useRef(props); latest.current = props;
  const snapshot = props.state.snapshot, bridge = props.bridge;
  const onEditorChange = useCallback((open: boolean) => bridge.setEditorOpen(open), [bridge]);
  if (!snapshot || props.state.closed || operation.closed) return <p role="status">{props.state.error || 'جارٍ فتح المواعيد…'}</p>;
  const valid = () => latest.current.bridge === bridge && !latest.current.disabled && !latest.current.state.closed
    && latest.current.state.snapshot === snapshot && !latest.current.state.loading && !latest.current.state.exporting && !bridge.getState().closed;
  return <ToastAndConfirmProvider>{props.state.error && <p role="alert">{props.state.error}</p>}
    <CloudOriginalOperationRecovery bridge={bridge} label="الموعد" disabled={props.disabled} />
    <div inert={props.disabled || props.state.loading || props.state.exporting || undefined}>
      <AppointmentsView appointments={projectOriginalClinicViews(snapshot).appointments} patients={snapshot.patients.map(row => row.patient)}
        localAuditEnabled={false} onEditorChange={onEditorChange}
        onSaveAppointment={async value => { if (!valid()) throw new Error('انتظر التحقق من الجلسة.'); await bridge.save(snapshot, value); }}
        onUpdateApptStatus={async (id, status) => { if (!valid()) throw new Error('انتظر التحقق من الجلسة.'); await bridge.setStatus(snapshot, id, status); }}
        onSelectPatient={fileNo => { if (!valid()) return; const patient = snapshot.patients.find(row => String(row.profile.fileNo) === fileNo); if (patient) props.onOpenPatient(patient.patientRecordId); }}
        onBackToHome={() => { if (valid()) props.onNavigate?.('home'); }} />
    </div></ToastAndConfirmProvider>;
}
