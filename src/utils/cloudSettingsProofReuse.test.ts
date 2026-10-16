import test from 'node:test';
import assert from 'node:assert/strict';
import { selectCloudSettingsReusableProofs } from './cloudSettingsProofReuse';
import { buildCloudSettingsValidationProofs, cloudSettingsProofPath } from './cloudSettingsValidationProofs';
import { prepareCloudClinicSettingsCommand, type CloudClinicSettingsCommand } from './cloudClinicSettingsRepository';
import { createCloudInitialClinicSettings } from './cloudInitialClinicSettings';
const id=(n:number)=>`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function command(op=1):CloudClinicSettingsCommand {
  const data=createCloudInitialClinicSettings();
  data.medications=Array.from({length:300},(_,n)=>({medicationId:id(1000+n),name:`دواء ${n}`,category:'',defaultDosage:'',defaultDuration:'',active:true}));
  data.whatsapp.templates=Array.from({length:60},(_,n)=>({templateId:id(2000+n),key:'custom',title:`قالب ${n}`,text:'نص'}));
  return prepareCloudClinicSettingsCommand({target:'clinicSettings',recordId:'clinicSettings',operationId:id(op),expectedRevision:op-1,createdAt:'2026-10-12T00:00:00.000Z',data});
}
const store=(c:CloudClinicSettingsCommand)=>new Map(buildCloudSettingsValidationProofs(c).proofs.map(p=>[cloudSettingsProofPath(p.operationId,p.kind,p.level,p.index),p]));
async function select(next:CloudClinicSettingsCommand,old:CloudClinicSettingsCommand,docs=store(old)){
  const reads:string[]=[];
  const plan=await selectCloudSettingsReusableProofs(next,buildCloudSettingsValidationProofs(next),{command:old,referenceRevisions:null},async path=>{
    reads.push(path);return structuredClone(docs.get(path)??null);
  });return {plan,reads};
}
test('a single medication change at300 medications/60 templates rebuilds only its immutable path',async()=>{
  const old=command(),next=command(2);if(next.target!=='clinicSettings')throw new Error();next.data.medications[299].defaultDosage='قرص مساء';
  const {plan,reads}=await select(next,old);
  assert.equal(buildCloudSettingsValidationProofs(old).proofs.length,1254);
  assert.ok(plan.proofs.length<=64,`proofs=${plan.proofs.length}`);assert.ok(reads.length<=80,`reads=${reads.length}`);
  assert.equal(plan.proofs.filter(p=>p.kind==='medications-text').length,1);
  assert.equal(plan.proofs.filter(p=>p.kind==='medications-shape').length,1);
  assert.ok(plan.proofs.some(p=>p.reuseFromOperationId===old.operationId));
  assert.deepEqual(plan.roots,buildCloudSettingsValidationProofs(next).roots);
});
test('a content label edit reuses single scalar fields and every unchanged catalog subtree',async()=>{
  const old=command(),next=command(2);if(next.target!=='clinicSettings')throw new Error();next.data.content.navigationLabels.patients='الملفات';
  const {plan}=await select(next,old);assert.ok(plan.proofs.length<=80,`proofs=${plan.proofs.length}`);
  assert.equal(plan.proofs.filter(p=>p.kind==='scalar-shape').length,1);
  assert.ok(plan.proofs.filter(p=>p.kind.startsWith('medications')).length<=32);
  assert.equal(plan.proofs.filter(p=>p.kind==='templates').length,19);
  assert.equal(plan.proofs.filter(p=>p.kind==='templates'&&p.reuseFromOperationId).length,15);
  assert.equal(plan.proofs.filter(p=>p.kind==='templates'&&p.reuseFromOperationId).every(p=>p.level<=1),true);
});
test('repeated revisions flatten markers to original materialized evidence without history traversal',async()=>{
  const first=command(),second=command(2);if(second.target!=='clinicSettings')throw new Error();second.data.medications[299].name='دواء معدل';
  const docs=store(first),selected=await select(second,first,docs);
  for(const p of selected.plan.proofs)docs.set(cloudSettingsProofPath(p.operationId,p.kind,p.level,p.index),p);
  const third=structuredClone(second);third.operationId=id(3);third.expectedRevision=2;
  third.data.medications[0].defaultDuration='يومان';
  const {plan,reads}=await select(third,second,docs);assert.ok(plan.proofs.length<=64);assert.ok(reads.length<=100);
  for(const p of plan.proofs.filter(p=>p.reuseFromOperationId)){
    const materialized=docs.get(cloudSettingsProofPath(p.reuseFromOperationId!,p.kind,p.level,p.index));
    assert.ok(materialized);assert.equal(materialized.reuseFromOperationId,undefined);
  }
});
test('changed array length cannot reuse scalar overhead or a differently clipped terminal subtree',async()=>{
  const old=command(),next=command(2);if(next.target!=='clinicSettings')throw new Error();next.data.medications.pop();
  const {plan}=await select(next,old);assert.ok(plan.proofs.length<100);
  assert.equal(plan.proofs.find(p=>p.kind==='scalar'&&p.level===0&&p.index===0)?.reuseFromOperationId,undefined);
  assert.equal(plan.proofs.find(p=>p.kind==='medications'&&p.level===4&&p.index===1)?.reuseFromOperationId,undefined);
});
test('balanced medication/template length changes still rebuild the scalar count witness',async()=>{
  const old=command();if(old.target!=='clinicSettings')throw new Error();old.data.whatsapp.templates.pop();
  const next=structuredClone(old);next.operationId=id(2);next.expectedRevision=1;next.data.medications.pop();
  next.data.whatsapp.templates.push({templateId:id(4000),key:'custom',title:'قالب إضافي',text:''});
  const {plan}=await select(next,old);
  assert.equal(plan.proofs.find(p=>p.kind==='scalar'&&p.level===0&&p.index===0)?.reuseFromOperationId,undefined);
  assert.equal(plan.proofs.some(p=>p.kind==='scalar'&&p.level>0&&p.reuseFromOperationId),false);
});
test('missing or corrupt historical proof falls back to new validation, never to unvalidated metadata',async()=>{
  const old=command(),next=command(2),empty=new Map();
  const {plan}=await select(next,old,empty);assert.equal(plan.proofs.length,1254);assert.equal(plan.proofs.some(p=>p.reuseFromOperationId),false);
  const docs=store(old),root=cloudSettingsProofPath(old.operationId,'medications',4,0);
  docs.set(root,{...docs.get(root)!,ids:['forged']});const result=await select(next,old,docs);
  assert.equal(result.plan.proofs.find(p=>p.kind==='medications'&&p.level===4&&p.index===0)?.reuseFromOperationId,undefined);
});
test('provider failures propagate and foreign target or record cannot be selected for reuse',async()=>{
  const old=command(),next=command(2),plan=buildCloudSettingsValidationProofs(next);
  await assert.rejects(selectCloudSettingsReusableProofs(next,plan,{command:old,referenceRevisions:null},async()=>{throw new Error('AUTH_LOSS');}),/AUTH_LOSS/);
  assert.equal(await selectCloudSettingsReusableProofs(next,plan,{command:{...old,target:'clinicLogo'} as any,referenceRevisions:null},async()=>{throw new Error();}),plan);
});
