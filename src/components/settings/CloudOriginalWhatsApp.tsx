import React, { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import { WhatsAppManagement } from './WhatsAppManagement';
import { ToastAndConfirmProvider } from '../common/ToastAndConfirm';
import { CloudOriginalOperationRecovery } from '../common/CloudOriginalOperationRecovery';
import type { CloudClinicOverviewState } from '../../utils/cloudClinicOverviewController';
import type { CloudOriginalWhatsAppBridge } from '../../utils/cloudOriginalWhatsAppBridge';
import { projectOriginalWhatsApp } from '../../utils/cloudOriginalWhatsAppBridge';
import type { CloudOriginalSettingsBridge } from '../../utils/cloudOriginalSettingsBridge';
import type { CloudOriginalContactsBridge } from '../../utils/cloudOriginalContactsBridge';
import { projectOriginalClinicViews } from '../../utils/cloudOriginalViewProjection';
import type { ProtectedWhatsAppActions } from '../../utils/whatsappSafety';
export function CloudOriginalWhatsApp(props: { state: Readonly<CloudClinicOverviewState>; bridge: CloudOriginalWhatsAppBridge;
  settingsBridge: CloudOriginalSettingsBridge; contactsBridge: CloudOriginalContactsBridge; disabled?: boolean;
  onOpenPatient(id: string): void; onNavigate?(section: string): void }) {
  const operation = useSyncExternalStore(props.bridge.subscribe, props.bridge.getState, props.bridge.getState);
  const latest = useRef(props); latest.current = props; const snapshot = props.state.snapshot, bridge = props.bridge;
  const dirty = useCallback((value: boolean) => props.settingsBridge.setDirty('whatsapp', value), [props.settingsBridge]);
  const contactEditor = useCallback((value: boolean) => props.contactsBridge.setEditorOpen(value), [props.contactsBridge]);
  const actions = useMemo<ProtectedWhatsAppActions | undefined>(() => snapshot ? {
    prepare: async input => { const p = latest.current; if (p.disabled || p.state.closed || p.state.snapshot !== snapshot || p.state.loading) throw Error('انتظر التحقق.'); await bridge.prepare(snapshot, input); },
    consume: input => { const p = latest.current; return !p.disabled && !p.state.closed && p.state.snapshot === snapshot && !p.state.loading ? bridge.consume(snapshot, input) : null; },
  } : undefined, [bridge, snapshot]);
  if (!snapshot || operation.closed || props.state.closed) return <p role="status">{props.state.error || 'جارٍ فتح واتساب…'}</p>;
  const valid = () => !latest.current.disabled && !latest.current.state.closed && latest.current.state.snapshot === snapshot && !latest.current.state.loading && !latest.current.state.exporting;
  const assert = () => { if (!valid()) throw Error('انتظر التحقق قبل تنفيذ العملية.'); };
  const settings = projectOriginalWhatsApp(snapshot);
  return <ToastAndConfirmProvider><CloudOriginalOperationRecovery bridge={bridge} label="موافقة رسائل الحملات" disabled={props.disabled} />
    <CloudOriginalOperationRecovery bridge={props.contactsBridge} label="جهة الاتصال" disabled={props.disabled} />
    <CloudOriginalOperationRecovery bridge={props.settingsBridge} label="قوالب واتساب" disabled={props.disabled} />
    <div inert={props.disabled || props.state.loading || props.state.exporting || undefined}>
      <WhatsAppManagement clinicName={snapshot.settings.clinicSettings.data.identity.clinicName} patients={snapshot.patients.map(row => row.patient)}
        contacts={snapshot.records.contactRecords.flatMap(row => !row.deleted && row.data ? [row.data] : [])} canManageContacts canViewPatientFinance
        whatsappSettings={settings} appointments={projectOriginalClinicViews(snapshot).appointments} cloudActions={actions} readSettings={() => { assert(); return settings; }}
        onDirtyChange={dirty} onContactEditorChange={contactEditor} onAuthorizeSend={assert}
        onSaveWhatsappSettings={async value => { assert(); if (value.campaignConsent && JSON.stringify(value.campaignConsent) !== JSON.stringify(settings.campaignConsent)) await bridge.saveConsent(snapshot, value.campaignConsent);
          else await props.settingsBridge.whatsapp(snapshot, value); }}
        onSaveContact={async (value, original) => { assert(); await props.contactsBridge.save(snapshot, value, original); }}
        onDeleteContact={async original => { assert(); await props.contactsBridge.remove(snapshot, original); }}
        onOpenPatient={fileNo => { if (!valid()) return; props.contactsBridge.setEditorOpen(false); const file = snapshot.patients.find(row => String(row.profile.fileNo) === fileNo);
          if (file && props.contactsBridge.canClose()) props.onOpenPatient(file.patientRecordId); }} />
    </div></ToastAndConfirmProvider>;
}
