/** Settings fragment acceptance. Disposable DEMO project and loopback only.
 * Never imports IAM, live configuration, real accounts or browser data.
 * Dedicated settings-only disposable namespace on loopback8790:
 * pnpm exec tsx scripts/test-cloud-settings-release-emulator.ts --demo-emulator
 */
import assert from 'node:assert/strict';
import { readCloudReleaseRules } from './read-cloud-release-rules.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, writeBatch, doc, getDoc, runTransaction, setLogLevel } from 'firebase/firestore/lite';
import { createCloudOperationIntentRepository, prepareCloudIntentCommand } from '../src/utils/cloudOperationIntent';
import { createCloudClinicSettingsRepository, prepareCloudClinicSettingsCommand, type CloudClinicSettingsCommand } from '../src/utils/cloudClinicSettingsRepository';
import { createCloudInitialClinicSettings } from '../src/utils/cloudInitialClinicSettings';
import { buildCloudSettingsValidationProofs, cloudSettingsProofPath } from '../src/utils/cloudSettingsValidationProofs';

const PROJECT='demo-clinic-settings-release-rules', BASE='http://127.0.0.1:8790', UID='synthetic-settings-release-owner', WHEN='2026-10-12T00:00:00.000Z';
if (process.argv[2]!=='--demo-emulator' || process.env.FIRESTORE_EMULATOR_HOST && process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8790')
  throw new Error('Explicit isolated DEMO emulator required.');
setLogLevel('silent');
const id=(n:number)=>`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const p=(collection:string,key:string)=>`clinics/main/${collection}/${key}`;
const digest=async (v:string)=>createHash('sha256').update(v).digest('hex');
const member={schemaVersion:1,clinicId:'main',uid:UID,role:'owner',status:'active',identityVersion:1,verifiedAfter:100};
const envelope=(recordId:string,data:unknown,revision=1)=>({schemaVersion:1,clinicId:'main',recordId,revision,lastOperationId:id(9999),data});
function encode(v:any):any { return v===null?{nullValue:null}:typeof v==='string'?{stringValue:v}:typeof v==='boolean'?{booleanValue:v}
  :typeof v==='number'?{integerValue:String(v)}:Array.isArray(v)?{arrayValue:{values:v.map(encode)}}
  :{mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,encode(x)]))}}; }
async function admin(endpoint:string,method:string,body?:object) {
  const url=new URL(endpoint,BASE); assert.equal(url.origin,BASE); assert.ok(url.pathname.includes(`/projects/${PROJECT}`));
  const r=await fetch(url,{method,headers:{'content-type':'application/json',authorization:'Bearer owner'},...(body?{body:JSON.stringify(body)}:{})});
  if (!r.ok) throw new Error(`DEMO setup ${r.status}: ${(await r.text()).slice(0,2500)}`); return r;
}
async function seed(rows:Map<string,any>) {
  await admin(`/emulator/v1/projects/${PROJECT}/databases/(default)/documents`,'DELETE');
  if(rows.size) await admin(`/v1/projects/${PROJECT}/databases/(default)/documents:commit`,'POST',{writes:[...rows].map(([key,data])=>({update:{
    name:`projects/${PROJECT}/databases/(default)/documents/${key}`,fields:encode(data).mapValue.fields}}))});
}
const base=()=>new Map<string,any>([[p('members',UID),member]]);
const client=(owner=true,claims:Record<string,unknown>={})=>{
  const app=initializeApp({projectId:PROJECT,apiKey:'demo-only-no-production-key'},`settings-demo-${randomUUID()}`),db=getFirestore(app);
  const payload={iss:`https://securetoken.google.com/${PROJECT}`,aud:PROJECT,iat:1800000000,exp:4102444800,sub:UID,user_id:UID,
    email_verified:true,dentalClinicId:'main',dentalClinicRole:'owner',auth_time:100,firebase:{sign_in_provider:'password'},...claims};
  const mockUserToken=`${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.`;
  connectFirestoreEmulator(db,'127.0.0.1',8790,owner?{mockUserToken}:undefined); return {app,db};
};
type Step={before:Map<string,any>;writes:Map<string,any>};
async function capture(input:CloudClinicSettingsCommand,initial=base()) {
  const command=prepareCloudClinicSettingsCommand(input), rows=structuredClone(initial),steps:Step[]=[];let reads=0;
  const adapter={authorizeOwner:async()=>UID,runTransaction:async<T>(work:any):Promise<T>=>{
    // get/set always detach values and stored envelopes are never mutated.
    // Share those immutable values between scenario snapshots; deep-cloning
    // the growing forest for every request would turn acceptance quadratic
    // in payload bytes without providing additional isolation.
    const before=new Map(rows),writes=new Map<string,any>();
    const result=await work({get:async(key:string)=>{reads++;return structuredClone(rows.get(key)??null);},set:(key:string,value:any)=>writes.set(key,structuredClone(value))});
    writes.forEach((v,k)=>rows.set(k,v)); if(writes.size)steps.push({before,writes}); return result;
  }};
  await createCloudOperationIntentRepository(adapter,{digest}).prepare('settings',command,command.createdAt);
  await createCloudClinicSettingsRepository(adapter,{digest}).commit(command);
  return {command,steps,rows,final:steps.at(-1)!,reads};
}
let passed=0,failed=0;
const sdk=client(),anon=client(false);
async function commit(writes:Map<string,any>,anonymous=false) {
  const batch=writeBatch(anonymous?anon.db:sdk.db); for(const[key,value]of writes) value===null?batch.delete(doc(anonymous?anon.db:sdk.db,key))
    :batch.set(doc(anonymous?anon.db:sdk.db,key),value); await batch.commit();
}
async function check(name:string,before:Map<string,any>,writes:Map<string,any>,allow:boolean,anonymous=false) {
  await seed(before); let error:unknown=null; try {await commit(writes,anonymous);}catch(e){error=e;}
  if((error===null)===allow){passed++;process.stdout.write(`PASS ${name}\n`);}else{failed++;process.stderr.write(`FAIL ${name} ${error instanceof Error?error.message:'unexpected allow'}\n`);}
}
function cloneStep(step:Step){return {before:structuredClone(step.before),writes:structuredClone(step.writes)};}
async function sequential(name:string,scenario:Awaited<ReturnType<typeof capture>>){
  await seed(scenario.steps[0].before);
  for(const[at,step]of scenario.steps.entries()){
    try{await commit(step.writes);passed++;}catch(e){failed++;const value=[...step.writes.values()][0];throw new Error(`${name} stage${at} ${value?.kind??'publication'}/${value?.level??'-'}/${value?.index??'-'}: ${String(e)}`);}
    if((at+1)%100===0)process.stdout.write(`PROGRESS ${name} ${at+1}/${scenario.steps.length} requests\n`);
  }
  process.stdout.write(`PASS ${name} all${scenario.steps.length} sequentialrequests\n`);
}
function command(target:CloudClinicSettingsCommand['target'],data:any,op:number,recordId:string=target):CloudClinicSettingsCommand {
  return {target,recordId,operationId:id(op),expectedRevision:0,createdAt:WHEN,data} as CloudClinicSettingsCommand;
}
const data=createCloudInitialClinicSettings(); data.medications=[];data.whatsapp.templates=[];
const lab=(n:number,count=1)=>({name:`معمل ${n}`,phone:'',address:'عنوان "خاص"\\مصر',notes:'نص \n"\\\t🌷',active:true,costs:Array.from({length:count},(_,x)=>({
  materialId:id(3000+x),name:`خامة ${x}`,category:'fixed',unitLabel:'تاج "خاص"\\وحدة',billingBasis:'per-unit',unitCostCents:10000+x,active:true}))});
async function sdkAcceptance(initial:Awaited<ReturnType<typeof capture>>) {
  await seed(initial.rows);let loseAck=false,mutations=0;
  const adapter={authorizeOwner:async()=>UID,readRecord:async(path:string)=>{const v=await getDoc(doc(sdk.db,path));return v.exists()?v.data():null;},
    runTransaction:async<T>(work:any):Promise<T>=>{
      let domain=false;
      const result=await runTransaction(sdk.db,async tx=>{
        domain=false;
        return work({get:async(path:string)=>{const v=await tx.get(doc(sdk.db,path));return v.exists()?v.data():null;},
          set:(path:string,value:any)=>{domain ||= path===p('settings','clinicSettings');tx.set(doc(sdk.db,path),value);}});
      });
      if(domain){mutations++;if(loseAck){loseAck=false;throw new Error('synthetic-lost-ack');}}
      return result;
    }};
  const repository=createCloudClinicSettingsRepository(adapter,{digest}),journal=createCloudOperationIntentRepository(adapter,{digest});
  const d=structuredClone(data);d.identity.clinicName='عيادة قبول SDK';
  const next={...command('clinicSettings',d,60),expectedRevision:1};
  await journal.prepare('settings',next,next.createdAt);loseAck=true;
  await assert.rejects(repository.commit(next));assert.equal(mutations,1);
  const after=await repository.get();assert.equal(after?.revision,2);assert.equal(after?.data.identity.clinicName,d.identity.clinicName);
  assert.equal((await createCloudClinicSettingsRepository(adapter,{digest}).commit(next)).status,'already-committed');assert.equal(mutations,1);passed++;
  process.stdout.write('PASS actual SDK lost ACK and original read-only retry\n');
  const a=structuredClone(d),b=structuredClone(d);a.identity.clinicName='نسخة أولى';b.identity.clinicName='نسخة ثانية';
  const left={...command('clinicSettings',a,61),expectedRevision:2},right={...command('clinicSettings',b,62),expectedRevision:2};
  await journal.prepare('settings',left,left.createdAt);await journal.prepare('settings',right,right.createdAt);
  const results=await Promise.allSettled([repository.commit(left),createCloudClinicSettingsRepository(adapter,{digest}).commit(right)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(mutations,2);
  const current=await repository.get();assert.equal(current?.revision,3);
  const receipts=await Promise.all([61,62].map(async n=>(await getDoc(doc(sdk.db,p('settingsOperations',id(n))))).exists()));
  assert.equal(receipts.filter(Boolean).length,1);passed++;process.stdout.write('PASS actual SDK concurrent CAS has exactly one winner\n');
  const second=client();try{
    const read=await getDoc(doc(second.db,p('settings','clinicSettings')));assert.deepEqual(read.data(),current);passed++;
    process.stdout.write('PASS independent SDK client reads confirmed current settings\n');
  }finally{await deleteApp(second.app);}
}
try {
  const rules=readCloudReleaseRules();
  assert.ok(Buffer.byteLength(rules)<=256*1024,'combined Rules source budget');
  await admin(`/emulator/v1/projects/${PROJECT}:securityRules`,'PUT',{rules:{files:[{name:'firestore.rules',content:rules}]}});
  const ordinary=await capture(command('clinicSettings',data,1));
  if(process.argv.includes('--lab-targets')||process.argv.includes('--routing-targets')){
    const initial=base();initial.set(p('settings','prostheticRouting'),envelope('prostheticRouting',{routes:[]}));
    const scenarios=[await capture(command('lab',lab(1,100),4,id(4001)),initial)];
    if(process.argv.includes('--routing-targets')){
      const routeSeed=base(),routes=Array.from({length:100},(_,n)=>({serviceId:id(5000+n),labId:id(4001+n%6),materialId:id(3000+n)}));
      routeSeed.set(p('settings','serviceCatalog'),envelope('serviceCatalog',{examinationCents:10000,services:routes.map((row,n)=>({serviceId:row.serviceId,name:`تركيبة ${n}`,kind:'prosthetic',priceCents:30000,active:true}))}));
      for(let n=0;n<6;n++)routeSeed.set(p('labDefinitions',id(4001+n)),envelope(id(4001+n),lab(n,100)));
      scenarios.push(await capture(command('prostheticRouting',{routes},5),routeSeed));
      const depSeed=new Map(routeSeed);depSeed.set(p('settings','prostheticRouting'),envelope('prostheticRouting',{routes}));
      scenarios.push(await capture({...command('lab',lab(1,100),6,id(4001)),expectedRevision:1},depSeed));
    }
    for(const scenario of scenarios){
    const seen=new Set<string>();
    for(const step of scenario.steps){
      const v=[...step.writes.values()][0];if(!v?.kind)continue;
      const key=v.kind==='scalar'||v.kind==='scalar-shape'||v.kind==='routing-refs-shape'?`${v.kind}:${v.index}`:`${v.kind}:${v.level}`;
      if(seen.has(key))continue;seen.add(key);await check(`${scenario.command.target} target ${key}`,step.before,step.writes,true);
    }
    await check(`${scenario.command.target} max final`,scenario.final.before,scenario.final.writes,true);
    }
    process.stdout.write(`SETTINGS DOMAIN TARGET ${passed}/${passed+failed} pass\n`);process.exit(failed?1:0);
  }
  if(process.argv.includes('--mid-only')){
    for(const[count,templates,logo]of [[0,60,true],[4,4,false],[16,16,false],[64,48,false],[128,60,true],[256,60,true]]as const){
      const d=structuredClone(data);d.medications=Array.from({length:count},(_,n)=>({medicationId:id(1000+n),name:`دواء ${n}`,category:'',defaultDosage:'',defaultDuration:'',active:true}));
      d.whatsapp.templates=Array.from({length:templates},(_,n)=>({templateId:id(2000+n),key:'custom',title:`قالب ${n}`,text:'نص'}));
      const initial=base();if(logo){d.identity.logoRecordId='clinicLogo';initial.set(p('settings','clinicLogo'),envelope('clinicLogo',{mimeType:'image/png',base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZNsAAAAASUVORK5CYII=',width:1,height:1}));}
      const probe=await capture(command('clinicSettings',d,100+count),initial);
      for(const step of probe.steps.filter(step=>[...step.writes.values()].some(v=>v.kind?.startsWith('medications-unique-'))))await check(`mid${count} uniqueness`,step.before,step.writes,true);
      await check(`mid${count}/templates${templates}/logo${logo} final`,probe.final.before,probe.final.writes,true);
    }
    process.stdout.write(`SETTINGS MID ${passed}/${passed+failed} pass\n`);process.exit(failed?1:0);
  }
  if(process.argv.includes('--sdk-only')){
    await sdkAcceptance(ordinary);process.stdout.write(`SETTINGS SDK ${passed}/${passed+failed} pass\n`);process.exit(0);
  }
  // Real sequential preparation requests, followed by one atomic publication.
  if(!process.argv.includes('--groups-only')&&!process.argv.includes('--reuse-only')){
  await seed(base());for(const[at,step]of ordinary.steps.entries()){
    try{await commit(step.writes);passed++;}catch(e){failed++;throw new Error(`ordinary stage ${at}: ${String(e)}`);}
  }
  process.stdout.write(`PASS ordinary all ${ordinary.steps.length} requests\n`);
  }
  if (process.argv.includes('--smoke')) { await deleteApp(sdk.app); await deleteApp(anon.app); process.exit(0); }
  const full=structuredClone(data);full.medications=Array.from({length:300},(_,n)=>({medicationId:id(1000+n),name:`دواء ${n}`,category:'فئة 🌷',defaultDosage:'"\\\t\n🌷',defaultDuration:'مدة "خاصة"\\يوم',active:true}));
  full.whatsapp.templates=Array.from({length:60},(_,n)=>({templateId:id(2000+n),key:'custom',title:`قالب ${n}`,text:'نص 🌷\n"\\\tتم'}));
  const maximum=await capture(command('clinicSettings',full,2));
  if(process.argv.includes('--groups-only')){
    const seen=new Set<string>();let group:Step|null=null;
    for(const step of maximum.steps){
      const value=[...step.writes.values()][0];if(!value||!value.kind||!Number.isInteger(value.level)||value.level<=0)continue;
      const key=`${value.kind}:${value.level}`;if(seen.has(key))continue;seen.add(key);group??=step;
      await check(`group budget ${key}`,step.before,step.writes,true);
    }
    for(const kind of ['medications-unique-ids','medications-unique-names']){
      const unique=maximum.steps.find(step=>[...step.writes.values()].some(v=>v.kind===kind));assert.ok(unique);
      await check(`maximum ${kind} marker budget`,unique.before,unique.writes,true);
    }
    await check('maximum final publication budget',maximum.final.before,maximum.final.writes,true);
    for(const path of maximum.final.writes.keys()){
      const step=cloneStep(maximum.final);step.writes.delete(path);await check(`final required companion ${path.split('/').at(-2)}`,step.before,step.writes,false);
    }
    for(const change of [{role:'secretary'},{status:'disabled'},{verifiedAfter:101}]){
      const step=cloneStep(maximum.final);Object.assign(step.before.get(p('members',UID)),change);
      await check(`final canonical owner gate ${Object.keys(change)[0]}`,step.before,step.writes,false);
    }
    await check('final anonymous cannot use companion authorization',maximum.final.before,maximum.final.writes,false,true);
    for(const claims of [{dentalClinicRole:'secretary'},{email_verified:false},{firebase:{sign_in_provider:'anonymous'}}]){
      const alternate=client(true,claims);try{
        await seed(maximum.final.before);const batch=writeBatch(alternate.db);for(const[path,value]of maximum.final.writes)batch.set(doc(alternate.db,path),value);
        await assert.rejects(batch.commit());passed++;process.stdout.write(`PASS final alternate claims denied ${Object.keys(claims)[0]}\n`);
      }finally{await deleteApp(alternate.app);}
    }
    for(const path of [p('settings','clinicSettings'),p('settingsOperations',maximum.command.operationId)]){
      for(const field of Object.keys(maximum.final.writes.get(path))){const step=cloneStep(maximum.final);delete step.writes.get(path)[field];
        await check(`final missing ${path.includes('/settingsOperations/')?'receipt':'domain'} ${field}`,step.before,step.writes,false);}
    }
    assert.ok(group);const path=[...group.writes.keys()][0];
    for(const field of Object.keys(group.writes.get(path))){const step=cloneStep(group);delete step.writes.get(path)[field];await check(`group missing ${field}`,step.before,step.writes,false);}
    const extra=cloneStep(group);extra.writes.get(path).extra=true;await check('group undeclared field denied',extra.before,extra.writes,false);
    process.stdout.write(`SETTINGS GROUP ${passed}/${passed+failed} pass\n`);process.exitCode=failed?1:0;
    await deleteApp(sdk.app);await deleteApp(anon.app);process.exit(process.exitCode??0);
  }
  if(process.argv.includes('--remaining'))process.stdout.write('SCOPE remainingonly; max/reuse acceptance must be recorded separately\n');
  if(!process.argv.includes('--remaining')){
  if(!process.argv.includes('--reuse-only')){
  await seed(base());for(const[at,step]of maximum.steps.entries()){
    try{await commit(step.writes);passed++;}catch(e){failed++;throw new Error(`maximum stage ${at}: ${String(e)}`);}
    if((at+1)%100===0)process.stdout.write(`PROGRESS maximum ${at+1}/${maximum.steps.length} requests\n`);
  }
  process.stdout.write(`PASS300 medications/60 templates ${maximum.steps.length} requests\n`);
  }else process.stdout.write('SCOPE reuse-only; initial capacity acceptance recorded separately\n');
  let previous=maximum;
  for(const [n,change]of [
    [20,(d:any)=>{d.medications[299].defaultDosage='قرص مساء';}],
    [21,(d:any)=>{d.content.navigationLabels.patients='الملفات';}],
    [22,(d:any)=>{d.medications[0].defaultDuration='يومان';}],
  ]as const){
    const nextData=structuredClone(previous.command.data);change(nextData);
    const next=await capture({...previous.command,operationId:id(n),expectedRevision:previous.command.expectedRevision+1,data:nextData}as CloudClinicSettingsCommand,previous.rows);
    assert.ok(next.steps.length<=90,`normal edit requests=${next.steps.length}`);assert.ok(next.reads<400,`normal edit reads=${next.reads}`);
    await seed(previous.rows);
    for(const[at,step]of next.steps.entries())try{await commit(step.writes);passed++;}catch(e){failed++;throw new Error(`reuse ${n} stage ${at}: ${String(e)}`);}
    process.stdout.write(`PASS bounded edit ${n}: ${next.steps.length} requests/${next.reads} document reads\n`);
    previous=next;
  }
  const markerStep=previous.steps.find(step=>[...step.writes.values()].some(v=>v.reuseFromOperationId));assert.ok(markerStep);
  const markerPath=[...markerStep.writes.keys()][0],marker=markerStep.writes.get(markerPath);
  for(const field of ['byteSize','ids','rows','reuseFromOperationId']){
    const step=cloneStep(markerStep),v=step.writes.get(markerPath);
    v[field]=field==='byteSize'?v.byteSize+1:field==='reuseFromOperationId'?id(777):['forged'];
    await check(`reuse rejects changed ${field}`,step.before,step.writes,false);
  }
  for(const status of ['prepared','cancelled']){
    const step=cloneStep(markerStep);step.before.get(p('operationIntents',marker.reuseFromOperationId)).status=status;
    await check(`reuse source is not ${status}`,step.before,step.writes,false);
  }
  {
    const step=cloneStep(markerStep);step.before.get(p('operationIntents',marker.reuseFromOperationId)).actorUid='different-owner';
    await check('reuse source actor is exact',step.before,step.writes,false);
  }
  {
    const step=cloneStep(markerStep);step.before.delete(p('settingsOperations',marker.reuseFromOperationId));
    await check('reuse needs committed receipt',step.before,step.writes,false);
  }
  await sdkAcceptance(ordinary);
  }
  if((process.argv.includes('--capacity-reuse')||process.argv.includes('--reuse-only'))&&!process.argv.includes('--remaining')){process.stdout.write(`SETTINGS DEMO ${passed} passed/${failed} failed\n`);process.exitCode=failed?1:0;}
  else {
  const boundary=structuredClone(full);let missing=98304-Buffer.byteLength(JSON.stringify(boundary));
  for(const row of boundary.whatsapp.templates){const add=Math.min(missing,4000-[...row.text].length);row.text+='x'.repeat(add);missing-=add;}
  assert.equal(missing,0);assert.equal(Buffer.byteLength(JSON.stringify(boundary)),98304);
  // The max forest was already accepted above. Reuse its unchanged medication
  // and scalar subtrees while growing only messages up to the exact byte cap.
  const exact=await capture({...command('clinicSettings',boundary,7),expectedRevision:1},maximum.rows);await seed(maximum.rows);
  for(const[at,step]of exact.steps.entries()){
    try{await commit(step.writes);passed++;}catch(e){failed++;throw new Error(`96KiB boundary stage ${at}: ${String(e)}`);}
    if((at+1)%100===0)process.stdout.write(`PROGRESS96KiB ${at+1}/${exact.steps.length} requests\n`);
  }
  process.stdout.write('PASS exact96KiB UTF8 data boundary\n');
  const over=cloneStep(exact.final),overCommand=structuredClone(exact.command);
  (overCommand.data as any).whatsapp.templates.find((row:any)=>[...row.text].length<4000).text+='x';
  const overPlan=buildCloudSettingsValidationProofs(overCommand);const overIntent=over.before.get(p('operationIntents',overCommand.operationId));
  overIntent.command=prepareCloudIntentCommand(overCommand);overIntent.requestHash=await digest(JSON.stringify(['clinic-operation-intent-v1',UID,'settings',overIntent.command]));
  // Same private proof forest is prepared by an adversarial client; its exact
  // recomputed server byte total must reject publication at98305, not trust UI.
  for(const proof of overPlan.proofs)over.before.set(cloudSettingsProofPath(proof.operationId,proof.kind,proof.level,proof.index),proof);
  over.writes.get(p('settings','clinicSettings')).data=overCommand.data;
  const overReceipt=over.writes.get(p('settingsOperations',overCommand.operationId));
  overReceipt.requestHash=await digest(JSON.stringify(['clinic-settings-v1',UID,overCommand]));
  overReceipt.templateBytes=(overCommand.data as any).whatsapp.templates.reduce((sum:number,row:any)=>sum+Buffer.byteLength(JSON.stringify(row)),0);
  const committed=over.writes.get(p('operationIntents',overCommand.operationId));committed.command=overIntent.command;committed.requestHash=overIntent.requestHash;
  await check('96KiB plus1 UTF8 byte denied',over.before,over.writes,false);
  const lone=await capture(command('prostheticRouting',{routes:[]},3));
  await sequential('empty routing',lone);
  const labSeed=base();labSeed.set(p('settings','prostheticRouting'),envelope('prostheticRouting',{routes:[]}));
  const hundred=await capture(command('lab',lab(1,100),4,id(4001)),labSeed);
  await sequential('100cost lab',hundred);
  const routeSeed=base(),routes=Array.from({length:100},(_,n)=>({serviceId:id(5000+n),labId:id(4001+n%6),materialId:id(3000+n)}));
  routeSeed.set(p('settings','serviceCatalog'),envelope('serviceCatalog',{examinationCents:10000,services:routes.map((row,n)=>({serviceId:row.serviceId,name:`تركيبة ${n}`,kind:'prosthetic',priceCents:30000,active:true}))}));
  for(let n=0;n<6;n++)routeSeed.set(p('labDefinitions',id(4001+n)),envelope(id(4001+n),lab(n,100)));
  const routed=await capture(command('prostheticRouting',{routes},5),routeSeed);
  await sequential('100 routes/6 labs',routed);
  const depSeed=structuredClone(routeSeed);depSeed.set(p('settings','prostheticRouting'),envelope('prostheticRouting',{routes}));
  const dependent=await capture({...command('lab',lab(1,100),6,id(4001)),expectedRevision:1},depSeed);
  await sequential('100-route dependent lab',dependent);
  const logo=await capture(command('clinicLogo',{mimeType:'image/png',base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZNsAAAAASUVORK5CYII=',width:1,height:1},8));
  const clearLogo=await capture(command('clinicLogo',null,9));
  for(const scenario of [logo,clearLogo])await sequential(`logo ${scenario.command.data==null?'clear':'save'}`,scenario);
  for(const scenario of [ordinary,maximum,lone,hundred,routed,dependent,logo,clearLogo]) {
    const label=scenario.command.target;
    await check(`${label} anonymous denied`,scenario.final.before,scenario.final.writes,false,true);
    for(const omit of scenario.final.writes.keys()){
      const step=cloneStep(scenario.final);step.writes.delete(omit);await check(`${label} companion omitted ${omit.split('/').at(-2)}`,step.before,step.writes,false);
    }
    const receipt=p('settingsOperations',scenario.command.operationId),domain=[...scenario.final.writes.keys()].find(k=>k!==receipt&&!k.includes('/operationIntents/'))!;
    for(const key of ['data','revision','recordId','lastOperationId']){
      const step=cloneStep(scenario.final);const value=step.writes.get(domain);value[key]=key==='data'?{}:key==='revision'?999:'invalid';
      await check(`${label} domain tamper ${key}`,step.before,step.writes,false);
    }
    for(const key of ['requestHash','validationVersion','referenceRevisions','templateBytes']){
      const step=cloneStep(scenario.final);step.writes.get(receipt)[key]=key==='requestHash'?'bad':key==='referenceRevisions'?{}:-1;
      await check(`${label} receipt tamper ${key}`,step.before,step.writes,false);
    }
    const missing=cloneStep(scenario.final),root=[...missing.before.keys()].filter(k=>k.includes('/settingsValidationProofs/')).at(-1)!;
    missing.before.delete(root);await check(`${label} missing immutable root`,missing.before,missing.writes,false);
  }
  const seenKinds=new Set<string>();
  for(const proofStep of [maximum,hundred,routed,dependent].flatMap(scenario=>scenario.steps).filter(step=>[...step.writes.keys()].some(k=>k.includes('/settingsValidationProofs/'))).filter(step=>{
    const proof=[...step.writes.values()][0],key=`${proof.kind}:${proof.level}`;if(seenKinds.has(key))return false;seenKinds.add(key);return true;
  })){
    const key=[...proofStep.writes.keys()][0];
    for(const prop of ['byteSize','ids','nameKeys','referenceRevisions','operationId']){
      const step=cloneStep(proofStep),v=step.writes.get(key);v[prop]=prop==='byteSize'?-1:prop==='operationId'?id(777):prop==='referenceRevisions'?{}:['forged'];
      await check(`proof ${[...proofStep.writes.values()][0].kind}/${[...proofStep.writes.values()][0].level} tamper ${prop}`,step.before,step.writes,false);
    }
    const already=structuredClone(proofStep.before);already.set(key,proofStep.writes.get(key));
    await check('immutable proof overwrite',already,proofStep.writes,false);
  }
  // Dependency changes invalidate the prepared plan, not silent rebasing.
  for(const scenario of [routed,dependent]){
    const step=cloneStep(scenario.final),key=scenario===routed?p('settings','serviceCatalog'):p('settings','prostheticRouting');
    step.before.get(key).revision++;await check('fresh dependency revision fence',step.before,step.writes,false);
  }
  for(const [kind,index]of [['routing-refs-shape',0],['routing-refs-shape',1],['routes-unique-ids',0],['scalar',0]]as const){
    const step=cloneStep(routed.final);step.before.delete(cloudSettingsProofPath(routed.command.operationId,kind,0,index));
    await check(`routing missing required ${kind}/${index}`,step.before,step.writes,false);
  }
  for(const duplicate of ['medicationId','medicationName','templateKey']){
    const step=cloneStep(maximum.final),c=structuredClone(maximum.command),d=c.data as typeof full;
    if(duplicate==='medicationId')d.medications[299].medicationId=d.medications[0].medicationId;
    if(duplicate==='medicationName')d.medications[299].name=d.medications[0].name;
    if(duplicate==='templateKey'){d.whatsapp.templates[0].key='offer';d.whatsapp.templates[59].key='offer';}
    const plan=buildCloudSettingsValidationProofs(c),i=step.before.get(p('operationIntents',c.operationId));i.command=prepareCloudIntentCommand(c);
    i.requestHash=await digest(JSON.stringify(['clinic-operation-intent-v1',UID,'settings',i.command]));
    for(const proof of plan.proofs)step.before.set(cloudSettingsProofPath(proof.operationId,proof.kind,proof.level,proof.index),proof);
    if(duplicate!=='templateKey'){
      const marker=plan.proofs.find(proof=>proof.kind===(duplicate==='medicationId'?'medications-unique-ids':'medications-unique-names'))!,markerPath=cloudSettingsProofPath(marker.operationId,marker.kind,0,0);
      for(const proof of plan.proofs.filter(proof=>proof.kind.startsWith('medications-unique-')))step.before.delete(cloudSettingsProofPath(proof.operationId,proof.kind,0,0));
      await check(`cross-root duplicate ${duplicate} uniqueness marker denied`,step.before,new Map([[markerPath,marker]]),false);
    }
    step.writes.get(p('settings','clinicSettings')).data=d;
    const r=step.writes.get(p('settingsOperations',c.operationId));r.requestHash=await digest(JSON.stringify(['clinic-settings-v1',UID,c]));
    r.templateBytes=d.whatsapp.templates.reduce((sum,row)=>sum+Buffer.byteLength(JSON.stringify(row)),0);
    step.writes.get(p('operationIntents',c.operationId)).command=i.command;step.writes.get(p('operationIntents',c.operationId)).requestHash=i.requestHash;
    await check(`cross-root duplicate ${duplicate}`,step.before,step.writes,false);
  }
  for(const duplicate of ['materialId','materialName','routeServiceId']){
    const scenario=duplicate==='routeServiceId'?routed:hundred,step=cloneStep(scenario.final),c=structuredClone(scenario.command);
    let markerKind:'costs-unique-ids'|'costs-unique-names'|'routes-unique-ids';
    if(c.target==='lab'){
      if(duplicate==='materialId'){c.data.costs[99].materialId=c.data.costs[0].materialId;markerKind='costs-unique-ids';}
      else {c.data.costs[99].name=c.data.costs[0].name;markerKind='costs-unique-names';}
    }else if(c.target==='prostheticRouting'){c.data.routes[99].serviceId=c.data.routes[0].serviceId;markerKind='routes-unique-ids';}
    else throw new Error('fixture target');
    const context=c.target==='lab'?{routing:step.before.get(p('settings','prostheticRouting'))}:{catalog:step.before.get(p('settings','serviceCatalog')),
      labs:[...step.before].filter(([key])=>key.includes('/labDefinitions/')).map(([,value])=>value)};
    const plan=buildCloudSettingsValidationProofs(c,context),i=step.before.get(p('operationIntents',c.operationId));
    i.command=prepareCloudIntentCommand(c);i.requestHash=await digest(JSON.stringify(['clinic-operation-intent-v1',UID,'settings',i.command]));
    for(const proof of plan.proofs)step.before.set(cloudSettingsProofPath(proof.operationId,proof.kind,proof.level,proof.index),proof);
    const marker=plan.proofs.find(proof=>proof.kind===markerKind)!,markerPath=cloudSettingsProofPath(marker.operationId,marker.kind,0,0);
    for(const proof of plan.proofs.filter(proof=>proof.kind.includes('-unique-')))step.before.delete(cloudSettingsProofPath(proof.operationId,proof.kind,0,0));
    await check(`cross-root duplicate ${duplicate} marker denied`,step.before,new Map([[markerPath,marker]]),false);
    step.writes.get(p(c.target==='lab'?'labDefinitions':'settings',c.recordId)).data=c.data;
    const r=step.writes.get(p('settingsOperations',c.operationId));r.requestHash=await digest(JSON.stringify(['clinic-settings-v1',UID,c]));
    step.writes.get(p('operationIntents',c.operationId)).command=i.command;step.writes.get(p('operationIntents',c.operationId)).requestHash=i.requestHash;
    await check(`cross-root duplicate ${duplicate} publication denied`,step.before,step.writes,false);
  }
  process.stdout.write(`SETTINGS DEMO ${passed}/${passed+failed} pass\n`);if(failed)process.exitCode=1;
  }
}finally{await deleteApp(sdk.app);await deleteApp(anon.app);}
