import { prepareCloudIntentCommand } from './cloudOperationIntent';
import type { CloudClinicSettingsCommand } from './cloudClinicSettingsRepository';
import { cloudSettingsScalarParts, cloudSettingsProofLeafSize, cloudSettingsProofPath, cloudSettingsProofRootLevel,
  type CloudSettingsProofKind, type CloudSettingsReferenceRevisions, type CloudSettingsValidationProof,
  type buildCloudSettingsValidationProofs } from './cloudSettingsValidationProofs';

/** Reuse is validation evidence, never an old setting or authorization. Each
 * marker points directly to a materialized immutable proof (not another marker).
 * Only the explicit newly journaled command can be published by the final CAS. */
export interface CloudSettingsReuseSource { command:CloudClinicSettingsCommand; referenceRevisions:CloudSettingsReferenceRevisions|null }
type Plan=ReturnType<typeof buildCloudSettingsValidationProofs>;
const stable=(v:any):any=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const same=(a:unknown,b:unknown)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
function rows(c:CloudClinicSettingsCommand,kind:CloudSettingsProofKind):unknown[]{
  if(kind==='scalar')return cloudSettingsScalarParts(c);
  if(c.target==='clinicSettings'&&kind==='medications')return c.data.medications;
  if(c.target==='clinicSettings'&&kind==='templates')return c.data.whatsapp.templates;
  if(c.target==='lab'&&kind==='costs')return c.data.costs;
  if(c.target==='prostheticRouting'&&kind==='routes')return c.data.routes;
  return [];
}
export async function selectCloudSettingsReusableProofs(command:CloudClinicSettingsCommand,plan:Plan,source:CloudSettingsReuseSource,
  read:(path:string)=>Promise<unknown|null>):Promise<Plan>{
  const old=source.command;
  if(old.operationId===command.operationId||old.target!==command.target||old.recordId!==command.recordId)return plan;
  const byKey=new Map(plan.proofs.map(p=>[`${p.kind}:${p.level}:${p.index}`,p]));
  const cache=new Map<string,CloudSettingsValidationProof|null>();let readCount=0,readBytes=0;
  const get=async(op:string,kind:CloudSettingsProofKind,level:number,index:number)=>{
    const path=cloudSettingsProofPath(op,kind,level,index);if(cache.has(path))return cache.get(path)!;
    // Optimization has a hard resource bound; falling back to new validation
    // is safe. Provider/Auth errors are not swallowed or converted to reuse.
    if(readCount>=1500||readBytes>=8*1024*1024)return null;readCount++;
    const raw=await read(path);if(raw===null){cache.set(path,null);return null;}
    let value:CloudSettingsValidationProof|null=null;
    try{
      const parsed=prepareCloudIntentCommand(raw) as unknown as CloudSettingsValidationProof;
      readBytes+=new TextEncoder().encode(JSON.stringify(parsed)).byteLength;
      if(parsed.operationId===op&&parsed.kind===kind&&parsed.level===level&&parsed.index===index&&parsed.target===command.target
        &&parsed.recordId===command.recordId&&(!Object.hasOwn(parsed,'reuseFromOperationId')||uuid(parsed.reuseFromOperationId)))value=parsed;
    }catch{/* Corrupt/missing historical evidence is not reusable; never overwrite it. */}
    cache.set(path,value);return value;
  };
  const resolve=async(kind:CloudSettingsProofKind,level:number,index:number,count:number)=>{
    const top=cloudSettingsProofRootLevel(kind,count);if(level>top)return null;let operation=old.operationId;
    // At most five levels and one flattened jump per level. No history walk.
    for(let at=top;at>=level;at--){
      const ancestor=Math.floor(index/4**(at-level));let proof=await get(operation,kind,at,ancestor);if(!proof)return null;
      if(proof.reuseFromOperationId){operation=proof.reuseFromOperationId;proof=await get(operation,kind,at,ancestor);
        if(!proof||proof.reuseFromOperationId)return null;}
      if(at===level)return {proof,operation};
    }
    return null;
  };
  const selected:CloudSettingsValidationProof[]=[];
  const visit=async(kind:CloudSettingsProofKind,level:number,index:number)=>{
    const expected=byKey.get(`${kind}:${level}:${index}`);if(!expected)return;
    const span=cloudSettingsProofLeafSize(kind)*4**level,start=index*span;
    const newRows=rows(command,kind),oldRows=rows(old,kind);
    const refsSame=same(plan.referenceRevisions,source.referenceRevisions);
    const dependencies=kind==='dependencies'&&refsSame&&same(command.data,old.data);
    const count=dependencies?source.referenceRevisions?.routingRouteCount??0:oldRows.length;
    // A scalar group can be reused only when every scalar field is unchanged.
    // Changed groups fall back to single-field witnesses, keeping label/theme
    // edits bounded without asking Rules to reconstruct22 nested maps at once.
    const scalarCountsSame=command.target!=='clinicSettings'||old.target!=='clinicSettings'
      ||command.data.medications.length===old.data.medications.length&&command.data.whatsapp.templates.length===old.data.whatsapp.templates.length;
    const scalarGroupSame=kind!=='scalar'||(level===0?index!==0||scalarCountsSame:same(newRows,oldRows)&&scalarCountsSame);
    const unchanged=scalarGroupSame&&(dependencies||newRows.length>start&&oldRows.length>start
      &&same(newRows.slice(start,start+span),oldRows.slice(start,start+span)));
    // Bound each server-side old/new slice comparison. Larger roots are rebuilt
    // from small immutable reused children, never from1254 row witnesses again.
    if(command.target!=='prostheticRouting'&&unchanged&&span<=(kind==='templates'?4:16)&&(kind!=='routes'||refsSame)){
      const found=await resolve(kind,level,index,count);
      if(found){
        const logical={...found.proof,operationId:command.operationId,referenceRevisions:expected.referenceRevisions};delete logical.reuseFromOperationId;
        if(same(logical,expected)){selected.push({...expected,reuseFromOperationId:found.operation});return;}
      }
    }
    if(level>0){for(let child=0;child<4;child++)await visit(kind,level-1,index*4+child);selected.push(expected);return;}
    if(kind==='scalar')selected.push(byKey.get(`scalar-shape:0:${index}`)!);
    else if(kind==='routes')selected.push(byKey.get(`routes-shape:0:${index}`)!);
    else if(['medications','templates','costs'].includes(kind))selected.push(byKey.get(`${kind}-text:0:${index}`)!,byKey.get(`${kind}-shape:0:${index}`)!);
    selected.push(expected);
  };
  for(const root of plan.roots)for(let index=0;index<root.count;index++)await visit(root.kind,root.level,index);
  if(selected.some(p=>!p))throw new Error('invalid-proof-reuse-plan');
  return {...plan,proofs:selected};
}
