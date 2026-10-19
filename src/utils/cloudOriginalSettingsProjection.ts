import type { CloudClinicSnapshot } from './cloudClinicSnapshot';
import type { CloudClinicContent } from './cloudClinicSettingsRepository';
import type { ContentDraft } from './clinicContent';
import type { ServiceCatalogValues } from './serviceCatalog';
import type { CloudServiceCatalogData } from './cloudServiceCatalogRepository';
import { parseCloudServiceCatalogData } from './cloudServiceCatalogRepository';
import { normalizeServiceName } from './serviceCatalog';
import { getDockAppearance, getDesktopDockAppearance } from './dockAppearance';
import { getDeviceNavigationOrder } from './clinicContent';
import { getHomeLayout } from './homeLayout';
import type { ProstheticRoutingSettings } from './prostheticRouting';

export function projectOriginalContent(content: CloudClinicContent): ContentDraft {
  return { tileOrder: [...content.mobile.order], labels: { homeSubtitle: content.homeSubtitle, welcomeText: content.welcomeText,
    tiles: structuredClone(content.tiles), tabs: structuredClone(content.tabs), navigationLabels: structuredClone(content.navigationLabels),
    homeLayout: structuredClone(content.homeLayout), dockAppearance: { size: content.mobile.size, showLabels: content.mobile.showLabels,
      mobileVisibleCount: content.mobile.visibleCount, moreSections: [...content.mobile.moreSections], desktop: structuredClone(content.desktop) } } };
}
export function captureOriginalContent(value: ContentDraft, base: CloudClinicContent): CloudClinicContent {
  const mobile = getDockAppearance(value.labels), desktop = getDesktopDockAppearance(value.labels);
  return { ...structuredClone(base), homeSubtitle: value.labels.homeSubtitle, welcomeText: value.labels.welcomeText,
    tiles: structuredClone(value.labels.tiles) as CloudClinicContent['tiles'], tabs: structuredClone(value.labels.tabs) as CloudClinicContent['tabs'],
    navigationLabels: { ...base.navigationLabels, ...value.labels.navigationLabels },
    mobile: { order: getDeviceNavigationOrder(value.labels, value.tileOrder, 'mobile'), size: mobile.size, showLabels: mobile.showLabels,
      visibleCount: mobile.mobileVisibleCount, moreSections: [...(mobile.moreSections ?? [])] as CloudClinicContent['mobile']['moreSections'] },
    desktop: { order: getDeviceNavigationOrder(value.labels, value.tileOrder, 'desktop'), size: desktop.size, showLabels: desktop.showLabels },
    homeLayout: getHomeLayout(value.labels) };
}
export function projectOriginalRouting(snapshot: CloudClinicSnapshot): ProstheticRoutingSettings {
  const services = new Map(snapshot.settings.serviceCatalog.data.services.map(row => [row.serviceId, row]));
  return { defaultLabs: {}, overrides: snapshot.settings.prostheticRouting.data.routes.map(route => {
    const service = services.get(route.serviceId), material = snapshot.records.labDefinitions.find(row => row.recordId === route.labId)?.data.costs.find(row => row.materialId === route.materialId);
    if (!service || !material || material.category === 'other') throw new Error('راجع تصنيف خامة المعمل قبل تعديل توجيه التركيبات.');
    return { kind: material.category, material: service.name, labId: route.labId, labServiceId: route.materialId };
  }) };
}
/** Preserve stable IDs by canonical names and retain inactive history rows.
 * Never guess identity from a similar name or a changed list position. */
export function captureOriginalCatalog(value: ServiceCatalogValues, base: CloudServiceCatalogData, newId: () => string): CloudServiceCatalogData {
  const names = [...value.serviceTypes.filter(name => !['تركيبات - ثابتة', 'تركيبات - متحركة'].includes(name)), ...Object.keys(value.crownPrices)];
  const unique = [...new Set(names)], normalized = unique.map(normalizeServiceName);
  if (new Set(normalized).size !== unique.length || normalized.some(name => !name)) throw new Error('أسماء الخدمات متكررة أو غير صالحة.');
  const used = new Set<string>(), services = base.services.map(row => ({ ...row }));
  for (const name of unique) {
    const kind = Object.hasOwn(value.crownPrices, name) ? 'prosthetic' as const : 'clinical' as const;
    const found = services.find(row => normalizeServiceName(row.name) === normalizeServiceName(name));
    const price = kind === 'prosthetic' ? value.crownPrices[name] : value.clinicalPrices?.[name];
    const priceCents = price === undefined ? null : Math.round(price * 100);
    if (price !== undefined && (!Number.isFinite(price) || price < 0 || Math.abs(priceCents! / 100 - price) > 1e-8)) throw new Error('راجع سعر الخدمة.');
    if (found) { if (found.kind !== kind) throw new Error('لا يمكن تحويل خدمة مرتبطة من علاج إلى تركيبة.'); Object.assign(found, { name, priceCents, active: true }); used.add(found.serviceId); }
    else { const row = { serviceId: newId(), name, kind, priceCents, active: true }; services.push(row); used.add(row.serviceId); }
  }
  for (const row of services) if (!used.has(row.serviceId)) row.active = false;
  return parseCloudServiceCatalogData({ examinationCents: Math.round((value.examinationFee ?? base.examinationCents / 100) * 100), services });
}
