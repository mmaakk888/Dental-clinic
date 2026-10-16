import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCloudSettingsValidationProofs, cloudSettingsProofPath, cloudSettingsProofRootLevel } from './cloudSettingsValidationProofs';
import { createCloudInitialClinicSettings } from './cloudInitialClinicSettings';
import { prepareCloudClinicSettingsCommand, type CloudClinicSettingsCommand } from './cloudClinicSettingsRepository';
import { prepareCloudIntentCommand } from './cloudOperationIntent';
const id=(n:number)=>`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const command=(data=createCloudInitialClinicSettings()):CloudClinicSettingsCommand=>prepareCloudClinicSettingsCommand({target:'clinicSettings',recordId:'clinicSettings',
  operationId:id(1),expectedRevision:0,createdAt:'2026-10-12T00:00:00.000Z',data});
test('settings proof forests retain300 medications/60 templates with4 scalar/med roots and4 template roots',()=>{
  const d=createCloudInitialClinicSettings();d.medications=Array.from({length:300},(_,n)=>({medicationId:id(100+n),name:`دواء ${n}`,category:'',defaultDosage:'',defaultDuration:'',active:true}));
  d.whatsapp.templates=Array.from({length:60},(_,n)=>({templateId:id(500+n),key:'custom',title:`قالب ${n}`,text:'نص'}));
  const plan=buildCloudSettingsValidationProofs(command(d));
  assert.deepEqual(plan.roots,[{kind:'scalar',level:2,count:2},{kind:'medications',level:4,count:2},{kind:'templates',level:2,count:4},{kind:'medications-unique-ids',level:0,count:1},{kind:'medications-unique-names',level:0,count:1}]);
  for(const proof of plan.proofs){assert.ok(proof.index<300);assert.ok(proof.level<=4);
    assert.ok(cloudSettingsProofPath(proof.operationId,proof.kind,proof.level,proof.index).startsWith('clinics/main/settingsValidationProofs/'));}
  assert.equal(cloudSettingsProofRootLevel('medications',300),4);
  assert.equal(plan.proofs.filter(p=>p.kind==='medications-shape').length,300);
  assert.equal(plan.proofs.filter(p=>p.kind==='medications-text').length,300);
  assert.equal(plan.proofs.filter(p=>p.kind==='templates-shape').length,60);
  for(const shape of plan.proofs.filter(p=>p.kind.endsWith('-shape'))){assert.equal(shape.rows?.length,1);
    assert.equal(shape.byteSize,0);assert.equal(Array.isArray(shape.rows![0]),false);}
});
test('summed root bytes equal JSON.stringify parsed data exactly including escaping and emoji Unicode',()=>{
  for(const count of [0,1,2,9,60]){
    const d=createCloudInitialClinicSettings();d.identity.address='عنوان "خاص"\\\n🌷';d.content.homeSubtitle='"\\🌷';
    d.medications=Array.from({length:count},(_,n)=>({medicationId:id(100+n),name:`دواء ${n}`,category:'فئة 🌷',defaultDosage:'"\\\t\n🌷',defaultDuration:'يوم',active:n%2===0}));
    d.whatsapp.templates=Array.from({length:count},(_,n)=>({templateId:id(500+n),key:'custom',title:`قالب ${n}`,text:'"\\\t\n🌷'}));
    const c=command(d),plan=buildCloudSettingsValidationProofs(c);
    const total=plan.roots.reduce((sum,root)=>sum+plan.proofs.filter(p=>p.kind===root.kind&&p.level===root.level).reduce((n,p)=>n+p.byteSize,0),0);
    assert.equal(total,new TextEncoder().encode(JSON.stringify(c.data)).byteLength);
  }
});
test('proofs are detached, deterministic and do not generate an operation ID, time, setting or dependency',()=>{
  const c=command(),before=JSON.stringify(c),a=buildCloudSettingsValidationProofs(c),b=buildCloudSettingsValidationProofs(c);
  assert.deepEqual(a,b);assert.equal(JSON.stringify(c),before);
  const leaf=a.proofs.find(p=>p.kind==='scalar'&&p.index===1&&p.level===0)!;(leaf.rows![0] as any).clinicName='Changed';
  assert.notEqual((c.data as any).identity.clinicName,'Changed');
  assert.throws(()=>buildCloudSettingsValidationProofs({...c,target:'lab',recordId:id(999),data:{name:'معمل',phone:'',address:'',notes:'',active:true,costs:[]}} as any));
});

test('lab scalar witnesses split name normalization from longer address/notes without changing public command',()=>{
  const c=prepareCloudClinicSettingsCommand({target:'lab',recordId:id(999),operationId:id(2),expectedRevision:0,
    createdAt:'2026-10-12T00:00:00.000Z',data:{name:'معمل',phone:'',address:'عنوان',notes:'ملاحظة 🌷',active:true,costs:[]}});
  const before=JSON.stringify(c),plan=buildCloudSettingsValidationProofs(c,{routing:{schemaVersion:1,clinicId:'main',
    recordId:'prostheticRouting',revision:1,lastOperationId:id(3),data:{routes:[]}}});
  assert.equal(JSON.stringify(c),before);
  assert.deepEqual(plan.roots,[{kind:'scalar',level:0,count:2}]);
  assert.deepEqual(plan.proofs.filter(p=>p.kind==='scalar').map(p=>p.rows),[[{name:'معمل',phone:'',active:true}],[{address:'عنوان',notes:'ملاحظة 🌷'}]]);
});

test('100 cost rows retain separate immutable unique-ID/name markers and no irrelevant dependency references',()=>{
  const costs=Array.from({length:100},(_,n)=>({materialId:id(100+n),name:`خامة ${n}`,category:'fixed' as const,
    unitLabel:'تاج',billingBasis:'per-unit' as const,unitCostCents:10000,active:true}));
  const c=prepareCloudClinicSettingsCommand({target:'lab',recordId:id(999),operationId:id(2),expectedRevision:0,
    createdAt:'2026-10-12T00:00:00.000Z',data:{name:'معمل',phone:'',address:'',notes:'',active:true,costs}});
  const routing={schemaVersion:1 as const,clinicId:'main' as const,recordId:'prostheticRouting' as const,revision:1,lastOperationId:id(3),
    data:{routes:[{serviceId:id(900),labId:id(999),materialId:costs[0].materialId}]}};
  const plan=buildCloudSettingsValidationProofs(c,{routing});
  assert.equal(plan.proofs.filter(p=>p.kind.startsWith('costs')).every(p=>p.referenceRevisions===null),true);
  assert.deepEqual(plan.roots.slice(-2),[{kind:'costs-unique-ids',level:0,count:1},{kind:'costs-unique-names',level:0,count:1}]);
  assert.equal(plan.proofs.find(p=>p.kind==='dependencies')?.referenceRevisions?.routingRevision,1);
});
test('new medication and material writes use stable server-comparable Arabic/ASCII names without narrowing historical parsers',()=>{
  for(const name of ['ＡＢＣ','a\u0301','Café']){
    const d=createCloudInitialClinicSettings();d.medications=[{medicationId:id(123),name,category:'',defaultDosage:'',defaultDuration:'',active:true}];
    const c=command(d);assert.throws(()=>buildCloudSettingsValidationProofs(c));
  }
});

test('exact96KiB settings data keeps every immutable witness below unchanged128KiB generic command parsing budget',()=>{
  const d=createCloudInitialClinicSettings();d.medications=Array.from({length:300},(_,n)=>({medicationId:id(100+n),name:`دواء ${n}`,category:'فئة 🌷',
    defaultDosage:'"\\\t\n🌷',defaultDuration:'مدة "خاصة"\\يوم',active:n%2===0}));
  d.whatsapp.templates=Array.from({length:60},(_,n)=>({templateId:id(500+n),key:'custom',title:`قالب ${n}`,text:'"\\\t\n🌷'}));
  let missing=98304-new TextEncoder().encode(JSON.stringify(d)).byteLength;
  for(const row of d.whatsapp.templates){const add=Math.min(missing,4000-[...row.text].length);row.text+='x'.repeat(add);missing-=add;}
  assert.equal(missing,0);const c=command(d);assert.equal(new TextEncoder().encode(JSON.stringify(c.data)).byteLength,98304);
  const plan=buildCloudSettingsValidationProofs(c);
  for(const proof of plan.proofs){assert.ok(new TextEncoder().encode(JSON.stringify(proof)).byteLength<=128*1024);assert.doesNotThrow(()=>prepareCloudIntentCommand(proof));}
});
