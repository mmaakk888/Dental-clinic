import React, { useCallback, useRef, useSyncExternalStore } from 'react';
import { PatientsView } from './PatientsView';
import { ToastAndConfirmProvider } from '../common/ToastAndConfirm';
import type { CloudClinicOverviewState } from '../../utils/cloudClinicOverviewController';
import type { CloudOriginalPatientsBridge } from '../../utils/cloudOriginalPatientsBridge';
import { projectOriginalClinicViews } from '../../utils/cloudOriginalViewProjection';
import type { CloudOriginalAppointmentsBridge } from '../../utils/cloudOriginalAppointmentsBridge';
import { CloudOriginalOperationRecovery } from '../common/CloudOriginalOperationRecovery';
export function CloudOriginalPatients(props: { state: Readonly<CloudClinicOverviewState>; bridge: CloudOriginalPatientsBridge; disabled?: boolean;
  createRequest?: number; appointmentsBridge?: CloudOriginalAppointmentsBridge; onOpenPatient(id: string): void; onNavigate?(section: string): void }) {
  const operation = useSyncExternalStore(props.bridge.subscribe, props.bridge.getState, props.bridge.getState);
  const latest = useRef(props); latest.current = props;
  const snapshot = props.state.snapshot, bridge = props.bridge;
  const appointmentsBridge = props.appointmentsBridge;
  const onEditorChange = useCallback((open: boolean) => { bridge.setEditorOpen(open); appointmentsBridge?.setEditorOpen(open); }, [bridge, appointmentsBridge]);
  if (!snapshot || props.state.closed || operation.closed) return <p role="status">{props.state.error || 'جارٍ فتح فهرس المرضى…'}</p>;
  const related = projectOriginalClinicViews(snapshot);
  const valid = () => latest.current.bridge === bridge && latest.current.state.snapshot === snapshot && !latest.current.disabled
    && !latest.current.state.closed && !latest.current.state.loading && !latest.current.state.exporting && !bridge.getState().closed;
  return <ToastAndConfirmProvider>{props.state.error && <p role="alert">{props.state.error}</p>}
    <CloudOriginalOperationRecovery bridge={bridge} label="ملف المريض" disabled={props.disabled} />
    {props.appointmentsBridge && <CloudOriginalOperationRecovery bridge={props.appointmentsBridge} label="الموعد" disabled={props.disabled} />}
    <div inert={props.disabled || props.state.loading || props.state.exporting || undefined}>
      <PatientsView patients={snapshot.patients.map(row => row.patient)} contacts={snapshot.records.contactRecords.flatMap(row => row.data ? [row.data] : [])}
        appointments={related.appointments} labCases={related.labCases}
        capabilities={{ viewBalances: true, editPatients: true, manageAppointments: !!props.appointmentsBridge, deletePatients: false, viewPatients: true }} isPrivacyMode={false}
        createRequest={props.createRequest} onEditorChange={onEditorChange}
        onSelectPatient={fileNo => { if (latest.current.disabled || latest.current.state.closed || bridge.getState().closed) return;
          bridge.setEditorOpen(false); appointmentsBridge?.setEditorOpen(false); if (!bridge.canClose() || appointmentsBridge && !appointmentsBridge.canClose()) return;
          const row = latest.current.state.snapshot?.patients.find(row => String(row.profile.fileNo) === fileNo);
          const saved = bridge.getState().selected; const id = row?.patientRecordId ?? (saved && String(saved.fileNo) === fileNo ? saved.recordId : null); if (id) props.onOpenPatient(id); }}
        onSavePatient={async (value, originalId) => { if (!valid()) throw new Error('انتظر التحقق من الجلسة قبل الحفظ.'); return bridge.save(snapshot, value, originalId); }}
        onSaveAppointment={props.appointmentsBridge ? async value => { if (!valid()) throw new Error('انتظر التحقق من الجلسة.'); await props.appointmentsBridge!.save(snapshot, value); } : undefined}
        onDeletePatient={async () => { throw new Error('الحذف المالي الدائم غير متاح في نسخة التشغيل المحمية.'); }}
        onBackToHome={() => { if (valid()) props.onNavigate?.('home'); }} onOpenContacts={() => { if (valid()) props.onNavigate?.('contacts'); }} />
    </div></ToastAndConfirmProvider>;
}
