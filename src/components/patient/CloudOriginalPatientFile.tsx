import React, { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import { PatientFileView } from './PatientFileView';
import { ToastAndConfirmProvider } from '../common/ToastAndConfirm';
import { CloudOriginalOperationRecovery } from '../common/CloudOriginalOperationRecovery';
import type { CloudClinicOverviewState } from '../../utils/cloudClinicOverviewController';
import type { CloudOriginalPatientFileBridge } from '../../utils/cloudOriginalPatientFileBridge';
import type { CloudOriginalPatientsBridge } from '../../utils/cloudOriginalPatientsBridge';
import type { CloudOriginalAppointmentsBridge } from '../../utils/cloudOriginalAppointmentsBridge';
import type { CloudOriginalLabsBridge } from '../../utils/cloudOriginalLabsBridge';
import type { WhatsappSettings } from '../../types';
import type { CloudOriginalWhatsAppBridge } from '../../utils/cloudOriginalWhatsAppBridge';
import type { ProtectedWhatsAppActions } from '../../utils/whatsappSafety';
import { projectOriginalClinicViews } from '../../utils/cloudOriginalViewProjection';
export function CloudOriginalPatientFile(props: { state: Readonly<CloudClinicOverviewState>; bridge: CloudOriginalPatientFileBridge;
  patientsBridge: CloudOriginalPatientsBridge; appointmentsBridge: CloudOriginalAppointmentsBridge; labsBridge: CloudOriginalLabsBridge;
  patientRecordId: string; disabled?: boolean; onNavigate?(section: string): void; whatsAppBridge?: CloudOriginalWhatsAppBridge }) {
  const operation = useSyncExternalStore(props.bridge.subscribe, props.bridge.getState, props.bridge.getState);
  const latest = useRef(props); latest.current = props;
  const { bridge, patientsBridge, appointmentsBridge, labsBridge } = props, snapshot = props.state.snapshot;
  const onEditorChange = useCallback((open: boolean) => { bridge.setEditorOpen(open); patientsBridge.setEditorOpen(open);
    appointmentsBridge.setEditorOpen(open); labsBridge.setEditorOpen(open); }, [bridge, patientsBridge, appointmentsBridge, labsBridge]);
  const whatsAppBridge = props.whatsAppBridge;
  const actions = useMemo<ProtectedWhatsAppActions | undefined>(() => snapshot && whatsAppBridge ? {
    prepare: async input => { const p = latest.current; if (p.disabled || p.state.closed || p.state.snapshot !== snapshot || p.state.loading) throw Error('انتظر التحقق.'); await whatsAppBridge.prepare(snapshot, input); },
    consume: input => { const p = latest.current; return !p.disabled && !p.state.closed && p.state.snapshot === snapshot && !p.state.loading ? whatsAppBridge.consume(snapshot, input) : null; },
  } : undefined, [whatsAppBridge, snapshot]);
  if (!snapshot || props.state.closed || operation.closed) return <p role="status">{props.state.error || 'جارٍ فتح ملف المريض…'}</p>;
  const file = snapshot.patients.find(row => row.patientRecordId === props.patientRecordId);
  if (!file) return <p role="alert">الملف غير موجود في النسخة المؤكدة. حدّث البيانات من الرئيسية.</p>;
  const valid = () => latest.current.bridge === bridge && !latest.current.disabled && !latest.current.state.closed
    && latest.current.state.snapshot === snapshot && !latest.current.state.loading && !latest.current.state.exporting && !bridge.getState().closed;
  const assert = () => { if (!valid()) throw new Error('انتظر التحقق من الجلسة قبل إجراء العملية.'); };
  const related = projectOriginalClinicViews(snapshot), config = snapshot.settings.clinicSettings.data, clinicalPrices: Record<string, number> = {};
  const serviceTypes = snapshot.settings.serviceCatalog.data.services.filter(row => row.active && row.kind === 'clinical').map(row => { if (row.priceCents !== null) clinicalPrices[row.name] = row.priceCents / 100; return row.name; });
  const templates = { reminderTomorrow: '', newAppt: '', postOp: '', accountBalance: '' };
  for (const row of config.whatsapp.templates) if (row.key !== 'custom') Object.assign(templates, { [row.key]: row.text });
  const whatsappSettings: WhatsappSettings = { ...config.whatsapp, templates, apiKey: '', webhookUrl: '', autoConfirmOnAppt: false, autoRemind24h: false, autoPostOpOnAttended: false };
  return <ToastAndConfirmProvider>{props.state.error && <p role="alert">{props.state.error}</p>}
    <CloudOriginalOperationRecovery bridge={bridge} label="الخدمة أو التحصيل" disabled={props.disabled} />
    <CloudOriginalOperationRecovery bridge={patientsBridge} label="تعديل بيانات المريض" disabled={props.disabled} />
    <CloudOriginalOperationRecovery bridge={appointmentsBridge} label="الموعد" disabled={props.disabled} />
    <CloudOriginalOperationRecovery bridge={labsBridge} label="التركيبة" disabled={props.disabled} />
    <div inert={props.disabled || props.state.loading || props.state.exporting || undefined}>
      <PatientFileView key={file.patientRecordId} patient={file.patient} origin="patients" appointments={related.appointments} serviceTypes={serviceTypes}
        clinicalPrices={clinicalPrices} labs={related.labs} crownPrices={related.crownPrices} examinationFee={snapshot.settings.serviceCatalog.data.examinationCents / 100}
        capabilities={{ patientEdit: true, registerPayment: true, appointments: true, deletePatients: false, rx: true, whatsapp: true, viewRemainingBalance: true, exportData: true }}
        clinicName={config.identity.clinicName} clinicLogo={props.state.logo} drugCatalog={config.medications.filter(row => row.active).map(row => ({ ...row, id: row.medicationId }))}
        prescriptionHeader={config.identity} whatsappSettings={whatsappSettings} onEditorChange={onEditorChange}
        readWhatsappSettings={() => { assert(); return whatsappSettings; }}
        cloudWhatsAppActions={actions}
        onSaveSession={async (id, session) => { assert(); if (id !== file.patient.id) throw Error('الملف تغيّر.'); await bridge.visit(snapshot, file.patientRecordId, session); }}
        onAddPaymentInstallment={async (id, sessionId, value) => { assert(); if (id !== file.patient.id) throw Error('الملف تغيّر.'); await bridge.payment(snapshot, file.patientRecordId, sessionId, value); }}
        onUpdatePatient={async (value, baseline) => { assert(); if (JSON.stringify(baseline) !== JSON.stringify(file.patient)) throw Error('تغيّر الملف.'); await patientsBridge.save(snapshot, value, file.patient.id); }}
        onDeletePatient={async () => { throw Error('الحذف المالي الدائم غير متاح في نسخة التشغيل المحمية.'); }}
        onSaveAppointment={async value => { assert(); await appointmentsBridge.save(snapshot, value); }}
        onUpdateApptStatus={async (id, status) => { assert(); await appointmentsBridge.setStatus(snapshot, id, status); }}
        onDeleteAppointment={async id => { assert(); await appointmentsBridge.setStatus(snapshot, id, 'cancelled'); }}
        onSaveProstheticOrder={async value => { assert(); await labsBridge.order(snapshot, value); }}
        onAuthorizeWhatsappSend={assert} onPrepareOutput={async () => { assert(); await bridge.prepareOutput(snapshot, file.patientRecordId); }}
        onAuthorizePrint={() => { assert(); bridge.assertOutputActive(); }}
        onBack={() => { if (valid()) props.onNavigate?.('patients'); }} />
    </div></ToastAndConfirmProvider>;
}
