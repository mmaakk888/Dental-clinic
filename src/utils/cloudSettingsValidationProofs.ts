import type { CloudClinicSettingsCommand, CloudLabDefinitionRecord, CloudProstheticRoutingRecord } from './cloudClinicSettingsRepository';
import type { CloudServiceCatalogRecord } from './cloudServiceCatalogRepository';
import { normalizedCloudServiceName } from './cloudServiceCatalogRepository';

/** Immutable, owner-private validation only. No setting is published until the
 * final settings/receipt/journal transaction succeeds. No SDK, clock or IDs. */
export const CLOUD_SETTINGS_PROOF_COLLECTION = 'settingsValidationProofs';
export type CloudSettingsProofKind = 'scalar' | 'scalar-shape' | 'medications' | 'medications-shape' | 'medications-text' | 'medications-unique-ids' | 'medications-unique-names' | 'templates' | 'templates-shape' | 'templates-text' | 'costs' | 'costs-shape' | 'costs-text' | 'costs-unique-ids' | 'costs-unique-names' | 'routes' | 'routes-shape' | 'routes-unique-ids' | 'routing-refs-shape' | 'dependencies';
export interface CloudSettingsReferenceRevisions {
  catalogRevision: number | null; labs: { labId: string; revision: number }[];
  routingRevision: number | null; routingRouteCount: number | null;
}
export interface CloudSettingsValidationProof {
  schemaVersion: 1; clinicId: 'main'; operationId: string; target: CloudClinicSettingsCommand['target']; recordId: string;
  kind: CloudSettingsProofKind; level: number; index: number; referenceRevisions: CloudSettingsReferenceRevisions | null;
  ids: string[]; nameKeys: string[]; keys: string[]; byteSize: number; rows?: unknown[]; reuseFromOperationId?: string;
}
export interface CloudSettingsProofContext {
  routing?: CloudProstheticRoutingRecord; catalog?: CloudServiceCatalogRecord;
  labs?: readonly CloudLabDefinitionRecord[];
}
const sections = ['patients', 'contacts', 'appointments', 'lab', 'summary', 'settings'] as const;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
export function cloudSettingsScalarByteSize(command: CloudClinicSettingsCommand, index: number): number {
  if (command.target === 'clinicSettings' && index === 0) return 225
    + Math.max(0, command.data.medications.length - 1) + Math.max(0, command.data.whatsapp.templates.length - 1);
  return bytes(cloudSettingsScalarParts(command)[index]);
}
export const cloudSettingsProofPath = (operationId: string, kind: CloudSettingsProofKind, level: number, index: number) =>
  `clinics/main/${CLOUD_SETTINGS_PROOF_COLLECTION}/${operationId}-${kind}-${level}-${index}`;
export const cloudSettingsProofLeafSize = (_kind: CloudSettingsProofKind) => 1;
export function cloudSettingsProofRootLevel(kind: CloudSettingsProofKind, count: number) {
  let level = 0, span = cloudSettingsProofLeafSize(kind);
  while (Math.ceil(count / span) > 4) { level++; span *= 4; }
  return level;
}
/** Only names whose equality is enforced server-side use the reviewed stable
 * Arabic/ASCII alphabet. Historical reads/receipt ACK never call this guard. */
export function assertCloudSettingsNewWriteNames(command: CloudClinicSettingsCommand): void {
  const names = command.target === 'clinicSettings' ? command.data.medications.map(row => row.name)
    : command.target === 'lab' ? command.data.costs.map(row => row.name) : [];
  if (names.some(name => name.normalize('NFKC') !== name || !/^[A-Za-z0-9\u0600-\u06ff ().,+/\-_:]+$/.test(name)
    || /[\u0600-\u0605\u061c\u06dd\u0675-\u0678]/.test(name))) throw new Error('invalid-settings-name');
}
export function cloudSettingsScalarParts(command: CloudClinicSettingsCommand): unknown[] {
  if (command.target === 'clinicSettings') {
    const d = command.data, c = d.content, labels = [...Object.values(c.tabs), ...['home', ...sections].map(key => c.navigationLabels[key as keyof typeof c.navigationLabels])];
    return [{}, { clinicName: d.identity.clinicName, doctorName: d.identity.doctorName },
      { phone: d.identity.phone, address: d.identity.address, logoRecordId: d.identity.logoRecordId },
      { primary: d.theme.primary, secondary: d.theme.secondary, accent: d.theme.accent, background: d.theme.background },
      { fontFamily: d.theme.fontFamily, customFontUrl: d.theme.customFontUrl },
      { homeSubtitle: c.homeSubtitle, welcomeText: c.welcomeText },
      c.mobile, c.desktop, c.homeLayout, ...sections.map(key => c.tiles[key]),
      ...Array.from({ length: 6 }, (_, index) => ({ first: labels[index * 2], second: labels[index * 2 + 1] })),
      { senderNumber: d.whatsapp.senderNumber, autoConfirmOnAppt: d.whatsapp.autoConfirmOnAppt,
        autoRemind24h: d.whatsapp.autoRemind24h, autoPostOpOnAttended: d.whatsapp.autoPostOpOnAttended }];
  }
  if (command.target === 'lab') {
    const { name, phone, address, notes, active } = command.data;
    // Name normalization and the two longer text bounds must not share one
    // Rules expression budget. These remain private, nonfinancial witnesses.
    return [{ name, phone, active }, { address, notes }];
  }
  return [command.target === 'clinicLogo' ? command.data : {}];
}
/** Caller supplies fresh validated dependency records, never browser defaults. */
export function buildCloudSettingsValidationProofs(command: CloudClinicSettingsCommand, context: CloudSettingsProofContext = {}) {
  assertCloudSettingsNewWriteNames(command);
  let refs: CloudSettingsReferenceRevisions | null = null;
  if (command.target === 'lab') {
    if (!context.routing) throw new Error('missing-settings-dependency');
    refs = { catalogRevision: null, labs: [], routingRevision: context.routing.revision, routingRouteCount: context.routing.data.routes.length };
  } else if (command.target === 'prostheticRouting' && command.data.routes.length) {
    if (!context.catalog || !context.labs) throw new Error('missing-settings-dependency');
    const ids = [...new Set(command.data.routes.map(row => row.labId))].sort();
    refs = { catalogRevision: context.catalog.revision, labs: ids.map(labId => {
      const lab = context.labs!.find(row => row.recordId === labId); if (!lab) throw new Error('missing-settings-dependency');
      return { labId, revision: lab.revision };
    }), routingRevision: null, routingRouteCount: null };
  }
  const sources: { kind: CloudSettingsProofKind; rows: unknown[]; ids: string[]; names: string[]; keys: string[] }[] = [];
  const source = (kind: CloudSettingsProofKind, rows: unknown[], ids: string[] = [], names: string[] = [], keys: string[] = []) =>
    sources.push({ kind, rows, ids, names, keys });
  source('scalar', cloudSettingsScalarParts(command));
  if (command.target === 'clinicSettings') {
    source('medications', command.data.medications, command.data.medications.map(row => row.medicationId), command.data.medications.map(row => normalizedCloudServiceName(row.name)));
    source('templates', command.data.whatsapp.templates, command.data.whatsapp.templates.map(row => row.templateId), [], command.data.whatsapp.templates.map(row => row.key));
  } else if (command.target === 'lab') {
    source('costs', command.data.costs, command.data.costs.map(row => row.materialId), command.data.costs.map(row => normalizedCloudServiceName(row.name)));
    source('dependencies', context.routing!.data.routes.map(route => ({ route, costIndex: route.labId === command.recordId
      ? command.data.costs.findIndex(cost => cost.materialId === route.materialId) : -1 })));
  } else if (command.target === 'prostheticRouting') {
    source('routes', command.data.routes.map(route => ({ route,
      serviceIndex: context.catalog!.data.services.findIndex(row => row.serviceId === route.serviceId),
      labIndex: refs!.labs.findIndex(row => row.labId === route.labId),
      materialIndex: context.labs!.find(row => row.recordId === route.labId)!.data.costs.findIndex(row => row.materialId === route.materialId),
    })), command.data.routes.map(row => row.serviceId));
  }
  const proofs: CloudSettingsValidationProof[] = [];
  const roots: { kind: CloudSettingsProofKind; level: number; count: number }[] = [];
  for (const item of sources) {
    if (!item.rows.length) continue;
    const rootLevel = cloudSettingsProofRootLevel(item.kind, item.rows.length), leafSize = cloudSettingsProofLeafSize(item.kind);
    for (let level = 0, span = leafSize; level <= rootLevel; level++, span *= 4) {
      for (let index = 0; index < Math.ceil(item.rows.length / span); index++) {
        const start = index * span, end = start + span;
        const proof: CloudSettingsValidationProof = { schemaVersion: 1, clinicId: 'main', operationId: command.operationId, target: command.target, recordId: command.recordId,
          kind: item.kind, level, index, referenceRevisions: item.kind==='costs'||item.kind==='routes'&&level>0?null:clone(refs), ids: item.ids.slice(start, end), nameKeys: item.names.slice(start, end),
          keys: item.keys.slice(start, end), byteSize: item.rows.slice(start, end).reduce<number>((sum, row, offset) => sum
            + (item.kind === 'scalar' ? cloudSettingsScalarByteSize(command, start + offset)
              : item.kind === 'routes' || item.kind === 'dependencies' ? 0 : bytes(row)), 0),
          ...(level === 0 ? { rows: clone(item.rows.slice(start, end)) } : {}) };
        if (['scalar', 'medications', 'templates', 'costs', 'routes'].includes(item.kind) && level === 0) {
          for (let offset=0; offset<proof.rows!.length; offset++) {
            const shape:CloudSettingsValidationProof={ ...clone(proof),kind: `${item.kind}-shape` as CloudSettingsProofKind, index:start+offset, byteSize:0,
              ids:item.ids.slice(start+offset,start+offset+1),nameKeys:item.names.slice(start+offset,start+offset+1),
              keys:item.keys.slice(start+offset,start+offset+1),rows:clone(proof.rows!.slice(offset,offset+1)) };
            if(['medications','templates','costs'].includes(item.kind))proofs.push({...clone(shape),kind:`${item.kind}-text` as CloudSettingsProofKind,ids:[],nameKeys:[],keys:[]});
            proofs.push(shape);
          }
        }
        proofs.push(proof);
      }
    }
    roots.push({ kind: item.kind, level: rootLevel, count: Math.ceil(item.rows.length / (leafSize * 4 ** rootLevel)) });
  }
  if(command.target==='prostheticRouting'&&command.data.routes.length){
    for(let index=0;index<2;index++)proofs.push({schemaVersion:1,clinicId:'main',operationId:command.operationId,target:command.target,recordId:command.recordId,
      kind:'routing-refs-shape',level:0,index,referenceRevisions:clone(refs),ids:[],nameKeys:[],keys:[],byteSize:0});
    roots.push({kind:'routing-refs-shape',level:0,count:2});
  }
  const uniqueKinds:CloudSettingsProofKind[]=command.target==='clinicSettings'&&command.data.medications.length
    ?['medications-unique-ids','medications-unique-names']:command.target==='lab'&&command.data.costs.length?['costs-unique-ids','costs-unique-names']
      :command.target==='prostheticRouting'&&command.data.routes.length?['routes-unique-ids']:[];
  if(uniqueKinds.length){
    for(const kind of uniqueKinds){
      proofs.push({schemaVersion:1,clinicId:'main',operationId:command.operationId,target:command.target,recordId:command.recordId,
        kind,level:0,index:0,referenceRevisions:null,ids:[],nameKeys:[],keys:[],byteSize:0});
      roots.push({kind,level:0,count:1});
    }
  }
  return { proofs, roots, referenceRevisions: refs };
}
