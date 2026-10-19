import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { OriginalSettingsLayout, settingsSections, type SettingsSectionKey } from './OriginalSettingsLayout';
import { IdentityAppearance, type IdentityAppearanceDraft } from './IdentityAppearance';
import { ContentLayout } from './ContentLayout';
import { ServiceCatalogManagement } from './ServiceCatalogManagement';
import { DrugCatalogManagement } from './DrugCatalogManagement';
import { ToastAndConfirmProvider } from '../common/ToastAndConfirm';
import { CloudOriginalOperationRecovery } from '../common/CloudOriginalOperationRecovery';
import type { CloudClinicOverviewState } from '../../utils/cloudClinicOverviewController';
import type { CloudOriginalSettingsBridge } from '../../utils/cloudOriginalSettingsBridge';
import { projectOriginalClinicViews } from '../../utils/cloudOriginalViewProjection';
import { projectOriginalContent, projectOriginalRouting } from '../../utils/cloudOriginalSettingsProjection';
import { parseCloudClinicLogoData, type CloudClinicLogoData } from '../../utils/cloudClinicSettingsRepository';
import { CloudOriginalWhatsApp } from './CloudOriginalWhatsApp';
import type { CloudOriginalWhatsAppBridge } from '../../utils/cloudOriginalWhatsAppBridge';
import type { CloudOriginalContactsBridge } from '../../utils/cloudOriginalContactsBridge';
async function cloudLogo(value: string): Promise<CloudClinicLogoData> {
  if (!/^data:image\/(png|jpeg);base64,/.test(value) || value.length > 4 * 1024 * 1024) throw Error('استخدم شعار PNG أو JPEG صالحًا.');
  const image = new Image(); image.src = value; await image.decode();
  if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 16_000_000) throw Error('أبعاد الشعار كبيرة جدًا.');
  for (const max of [512, 384, 256, 192, 128]) {
    const ratio = Math.min(1, max / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio)); canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const ctx = canvas.getContext('2d'); if (!ctx) throw Error('تعذر تجهيز الشعار.'); ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    try { return parseCloudClinicLogoData({ mimeType: 'image/png', base64: canvas.toDataURL('image/png').split(',')[1], width: canvas.width, height: canvas.height }); } catch { /* Try a smaller raster without losing PNG transparency. */ }
  }
  throw Error('تعذر ضغط الشعار للحد الآمن؛ استخدم صورة أبسط.');
}
export function CloudOriginalSettings(props: { state: Readonly<CloudClinicOverviewState>; bridge: CloudOriginalSettingsBridge;
  disabled?: boolean; onNavigate?(section: string): void; initialSection?: 'identity' | 'services' | 'whatsapp'; initialPricingLabId?: string;
  whatsAppBridge?: CloudOriginalWhatsAppBridge; contactsBridge?: CloudOriginalContactsBridge; onOpenPatient(id: string): void }) {
  const operation = useSyncExternalStore(props.bridge.subscribe, props.bridge.getState, props.bridge.getState);
  useSyncExternalStore(props.bridge.subscribeCatalog, props.bridge.getCatalogState, props.bridge.getCatalogState);
  const [section, setSection] = useState<SettingsSectionKey>(props.initialSection ?? 'identity'), [visited, setVisited] = useState(new Set<SettingsSectionKey>([props.initialSection ?? 'identity']));
  useEffect(() => { const next = props.initialSection ?? 'identity'; setSection(next); setVisited(previous => new Set([...previous, next])); }, [props.initialSection, props.initialPricingLabId]);
  const latest = useRef(props); latest.current = props; const bridge = props.bridge, snapshot = props.state.snapshot;
  const setDirty = useCallback((key: string, dirty: boolean) => bridge.setDirty(key, dirty), [bridge]);
  const identityDirty = useCallback((value: IdentityAppearanceDraft) => {
    const state = latest.current.state; if (!state.snapshot) return;
    const data = state.snapshot.settings.clinicSettings.data;
    const theme = { ...data.theme, customFontUrl: data.theme.customFontUrl ?? undefined };
    setDirty('identity', value.clinicName !== data.identity.clinicName || value.clinicLogo !== state.logo || JSON.stringify(value.theme) !== JSON.stringify(theme));
  }, [setDirty]);
  const contentDirty = useCallback((value: boolean) => setDirty('content', value), [setDirty]);
  const servicesDirty = useCallback((value: boolean) => setDirty('services', value), [setDirty]);
  const drugsDirty = useCallback((value: boolean) => setDirty('drugs', value), [setDirty]);
  if (!snapshot || props.state.closed || operation.closed) return <p role="status">{props.state.error || 'جارٍ فتح الإعدادات…'}</p>;
  const valid = () => latest.current.bridge === bridge && !latest.current.disabled && !latest.current.state.closed && latest.current.state.snapshot === snapshot
    && !latest.current.state.loading && !latest.current.state.exporting && !bridge.getState().closed;
  const assert = () => { if (!valid()) throw Error('انتظر التحقق من الجلسة قبل الحفظ.'); };
  const data = snapshot.settings.clinicSettings.data, related = projectOriginalClinicViews(snapshot), content = projectOriginalContent(data.content);
  const clinicalPrices: Record<string, number> = {};
  const serviceTypes = snapshot.settings.serviceCatalog.data.services.filter(row => row.active && row.kind === 'clinical').map(row => { if (row.priceCents !== null) clinicalPrices[row.name] = row.priceCents / 100; return row.name; });
  const theme = { ...data.theme, customFontUrl: data.theme.customFontUrl ?? undefined };
  const shortcut = (target: string, title: string) => <button type="button" className="min-h-12 rounded-xl bg-indigo-600 px-5 py-3 font-bold text-white" onClick={() => { if (valid()) props.onNavigate?.(target); }}>{title}</button>;
  return <ToastAndConfirmProvider><CloudOriginalOperationRecovery bridge={bridge} label="الإعدادات" disabled={props.disabled} />
    <CloudOriginalOperationRecovery bridge={{ ...bridge, getState: bridge.getCatalogState, subscribe: bridge.subscribeCatalog }} label="فهرس الأسعار" disabled={props.disabled} />
    <div inert={props.disabled || props.state.loading || props.state.exporting || undefined}>
      <OriginalSettingsLayout activeSection={section} sectionKeys={settingsSections.map(row => row.key)} onBackToHome={() => { if (valid()) props.onNavigate?.('home'); }}
        onSection={next => { if (!valid()) return; setSection(next); setVisited(previous => new Set([...previous, next])); }}>
        {visited.has('identity') && <div hidden={section !== 'identity'}><IdentityAppearance clinicName={data.identity.clinicName} clinicLogo={props.state.logo} theme={theme} onDraftChange={identityDirty}
          onSaveIdentity={async value => { assert(); await bridge.identity(snapshot, { clinicName: value.clinicName,
            theme: { ...value.theme, fontFamily: value.theme.fontFamily ?? data.theme.fontFamily, customFontUrl: value.theme.customFontUrl ?? null },
            logo: value.clinicLogo === props.state.logo ? undefined : value.clinicLogo ? await cloudLogo(value.clinicLogo) : null }); }} /></div>}
        {visited.has('layout') && <div hidden={section !== 'layout'}><ContentLayout {...content} clinicName={data.identity.clinicName} onDirtyChange={contentDirty}
          onSaveContent={async value => { assert(); await bridge.content(snapshot, value); }} /></div>}
        {visited.has('services') && <div hidden={section !== 'services'}><ServiceCatalogManagement serviceTypes={serviceTypes} clinicalPrices={clinicalPrices} crownPrices={related.crownPrices}
          examinationFee={snapshot.settings.serviceCatalog.data.examinationCents / 100} labs={related.labs} canManagePrices canViewLabCosts canManageLabPrices initialPricingLabId={props.initialPricingLabId}
          onDirtyChange={servicesDirty} onRelatedDirtyChange={setDirty} prostheticRouting={projectOriginalRouting(snapshot)}
          onSaveServiceCatalog={async value => { assert(); await bridge.prices(snapshot, value); }}
          onSaveLabPricing={async (id, services, baseline) => { assert(); await bridge.labPricing(snapshot, id, services, baseline); }}
          onSaveProstheticRouting={async (value, baseline) => { assert(); await bridge.routing(snapshot, value, baseline); }} /></div>}
        {visited.has('drugs') && <div hidden={section !== 'drugs'}><DrugCatalogManagement drugCatalog={data.medications.filter(row => row.active).map(row => ({ ...row, id: row.medicationId }))}
          onDirtyChange={drugsDirty} onSaveDrugCatalog={async value => { assert(); await bridge.drugs(snapshot, value); }} /></div>}
        {visited.has('whatsapp') && props.whatsAppBridge && props.contactsBridge && <div hidden={section !== 'whatsapp'}><CloudOriginalWhatsApp state={props.state}
          bridge={props.whatsAppBridge} settingsBridge={bridge} contactsBridge={props.contactsBridge} disabled={props.disabled} onOpenPatient={props.onOpenPatient} onNavigate={props.onNavigate} /></div>}
        {section === 'excel' && <section className="rounded-2xl border bg-white p-5">{shortcut('transfer', 'استيراد ملفات المرضى وجهات الاتصال')}{shortcut('export', 'التصدير من النسخة المؤكدة')}</section>}
        {section === 'users' && <p role="status" className="rounded-2xl border bg-white p-5">نسخة التشغيل الأولى بحساب المالك فقط. إدارة حسابات السكرتيرة وصلاحياتها السحابية مؤجلة كما اتفقنا.</p>}
        {section === 'firebase' && <p role="status" className="rounded-2xl border bg-white p-5">البيانات محفوظة في Firestore، وليست نسخة من تخزين المتصفح. تحديث الموقع أو الرجوع لإصدار Hosting لا يحذف قاعدة البيانات.</p>}
        {section === 'audit' && <p role="status" className="rounded-2xl border bg-white p-5">سجلات العمليات المؤكدة محفوظة على الخادم لكل قسم؛ لا نعرض سجل نشاط المتصفح المحلي على أنه سجل سحابي.</p>}
        {section === 'system' && <p role="status" className="rounded-2xl border bg-white p-5">التشغيل بحساب المالك وقواعد حماية الخادم. مسح البيانات والرجوع إلى تخزين المتصفح غير متاحين من هذه الشاشة.</p>}
      </OriginalSettingsLayout>
    </div></ToastAndConfirmProvider>;
}
