/** Actual release Rules acceptance, disposable hardcoded DEMO only. No IAM,
 * live project, owner credentials, activation or real clinic records. */
import assert from 'node:assert/strict';
import { readCloudReleaseRules } from './read-cloud-release-rules.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, writeBatch, runTransaction, getDoc, collection, query, limit, getDocs, setLogLevel } from 'firebase/firestore/lite';
import { createCloudProstheticRepository } from '../src/utils/cloudProstheticRepository';
import { createCloudOperationIntentRepository } from '../src/utils/cloudOperationIntent';
import { createCloudClinicalRepository } from '../src/utils/cloudClinicalRepository';
const PROJECT='demo-clinic-release-rules',BASE='http://127.0.0.1:8789',UID='synthetic-release-owner',WHEN='2026-10-12T00:00:00.000Z',DAY='2026-10-12';
if(process.argv[2]!=='--demo-emulator'||process.env.FIRESTORE_EMULATOR_HOST&&process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8789')throw Error('Explicit isolated DEMO required');
setLogLevel('silent');
const id=(n:number)=>`70000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const p=(col:string,key:string|number)=>`clinics/main/${col}/${key}`;
const digest=async(value:string)=>createHash('sha256').update(value).digest('hex');
const PATIENT=id(1),LAB=id(2),SERVICE=id(3),MATERIAL=id(4);
const token={uid:UID,token:{email_verified:true,dentalClinicId:'main',dentalClinicRole:'owner',auth_time:100,firebase:{sign_in_provider:'password'}}};
function encode(v:any):any{if(v===null)return{nullValue:null};if(typeof v==='string')return{stringValue:v};if(typeof v==='boolean')return{booleanValue:v};if(typeof v==='number')return{integerValue:String(v)};
  if(Array.isArray(v))return{arrayValue:{values:v.map(encode)}};return{mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,encode(x)]))}};}
async function admin(endpoint:string,method:string,body?:object){const url=new URL(endpoint,BASE);assert.equal(url.origin,BASE);assert.ok(url.pathname.includes(`/projects/${PROJECT}`));
  const r=await fetch(url,{method,headers:{'content-type':'application/json',authorization:'Bearer owner'},...(body?{body:JSON.stringify(body)}:{})});
  if(!r.ok)throw Error(`DEMO ${r.status}: ${(await r.text()).slice(0,3000)}`);return r;}
async function seed(rows:Map<string,any>){await admin(`/emulator/v1/projects/${PROJECT}/databases/(default)/documents`,'DELETE');
  if(rows.size)await admin(`/v1/projects/${PROJECT}/databases/(default)/documents:commit`,'POST',{writes:[...rows].map(([key,data])=>({update:{name:`projects/${PROJECT}/databases/(default)/documents/${key}`,fields:encode(data).mapValue.fields}}))});}
function client(auth:typeof token|null=token){const app=initializeApp({projectId:PROJECT,apiKey:'demo-only'},`prosthetic-demo-${randomUUID()}`),db=getFirestore(app);
  const payload=auth&&{iss:`https://securetoken.google.com/${PROJECT}`,aud:PROJECT,iat:1800000000,exp:4102444800,...auth.token,sub:auth.uid,user_id:auth.uid};
  const mockUserToken=payload&&`${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.`;
  connectFirestoreEmulator(db,'127.0.0.1',8789,mockUserToken?{mockUserToken}:undefined);return{app,db};}
const env=(recordId:string,data:any)=>({schemaVersion:1,clinicId:'main',recordId,revision:1,lastOperationId:id(999),data});
function initial(size=1){const services=Array.from({length:size===1?1:300},(_,n)=>({serviceId:n===0?SERVICE:id(2000+n),name:n===0?'تركيبة مصطنعة':`خدمة ${n}`,kind:'prosthetic',priceCents:100000,active:true}));
  const routes=Array.from({length:size===1?1:100},(_,n)=>({serviceId:services[n].serviceId,labId:LAB,materialId:n===0?MATERIAL:id(3000+n)}));
  const costs=routes.map((route,n)=>({materialId:route.materialId,name:`خامة ${n}`,category:'fixed',unitLabel:'وحدة',billingBasis:'per-unit',unitCostCents:20000,active:true}));
  return new Map<string,any>([[p('members',UID),{schemaVersion:1,clinicId:'main',uid:UID,role:'owner',status:'active',identityVersion:1,verifiedAfter:100}],
    [p('patientProfiles',PATIENT),{...env(PATIENT,{name:'مصطنع',mobile:'',age:30,gender:'',firstVisit:DAY,notes:'',allergy:''}),fileNo:401,phoneKey:null}],
    [p('patientFiles',401),{schemaVersion:1,clinicId:'main',fileNo:401,recordId:PATIENT}],
    [p('settings','serviceCatalog'),env('serviceCatalog',{examinationCents:10000,services})],
    [p('settings','prostheticRouting'),env('prostheticRouting',{routes})],
    [p('labDefinitions',LAB),env(LAB,{name:'معمل مصطنع',phone:'',address:'',notes:'',active:true,costs})]]);}
const create=(operationId=id(10),extra:object={})=>({action:'create',operationId,labId:LAB,expectedLabAccountRevision:0,createdAt:WHEN,patientId:PATIENT,expectedPatientRevision:0,
  serviceId:SERVICE,expectedCatalogRevision:1,expectedRoutingRevision:1,expectedLabRevision:1,kind:'fixed',units:3,teethIds:['ur1','ur2','ur3'],date:DAY,deliveryExpectedDate:null,
  patientUnitPriceCents:100000,includeExamination:true,paidCents:10000,note:'',...extra});
type S={name:string;command:any;before:Map<string,any>;after:Map<string,any>;writes:Map<string,any>};
function memory(rows:Map<string,any>){return{authorizeOwner:async()=>UID,runTransaction:async<T>(work:(tx:any)=>Promise<T>)=>{const copy=structuredClone(rows);const value=await work({get:async(key:string)=>structuredClone(copy.get(key)??null),set:(key:string,v:any)=>copy.set(key,structuredClone(v))});rows.clear();copy.forEach((v,k)=>rows.set(k,v));return value;}};}
async function scenario(name:string,command:any,start=initial()):Promise<S>{const rows=structuredClone(start),a=memory(rows),j=createCloudOperationIntentRepository(a,{digest});await j.prepare('prosthetic',command,WHEN);
  const before=structuredClone(rows);await createCloudProstheticRepository(a,{digest}).commit(command);const after=structuredClone(rows);
  return{name,command,before,after,writes:new Map([...after].filter(([key,value])=>JSON.stringify(value)!==JSON.stringify(before.get(key))))};}
const results:{name:string;expected:boolean;actual:boolean}[]=[];
async function check(name:string,expected:boolean,state:Map<string,any>,writes:Map<string,any>,auth:typeof token|null=token){await seed(state);const{app,db}=client(auth);let actual=false;
  try{const batch=writeBatch(db);for(const[key,value]of writes)value===null?batch.delete(doc(db,key)):batch.set(doc(db,key),value);await batch.commit();actual=true;}
  catch(e:any){if(e?.code!=='permission-denied'){console.log({diagnostic:name,code:e?.code,message:e?.message});throw e;}}
  finally{await deleteApp(app);}results.push({name,expected,actual});console.log(JSON.stringify({name,expected,actual}));}
try{await admin(`/emulator/v1/projects/${PROJECT}:securityRules`,'PUT',{rules:{files:[{name:'prosthetic-combined.rules',content:readCloudReleaseRules()}]}});
  const first=await scenario('order',create()),many=await scenario('catalog300-routing100-cost100',create(id(11)),initial(300));
  const progress=await scenario('progress',{action:'progress',operationId:id(12),labId:LAB,expectedLabAccountRevision:1,createdAt:WHEN,caseId:id(10),expectedCaseRevision:1,status:'ready',note:'جاهزة'},first.after);
  const payment=await scenario('payment1',{action:'lab-payment',operationId:id(13),labId:LAB,expectedLabAccountRevision:2,createdAt:WHEN,date:DAY,note:'دفعة',allocations:[{caseId:id(10),expectedRevision:2,amountCents:1000}]},progress.after);
  let state=initial();const cases:string[]=[];for(let n=0;n<8;n++){const key=id(100+n);cases.push(key);state=(await scenario(`seed${n}`,create(key,{expectedLabAccountRevision:n,expectedPatientRevision:n}),state)).after;}
  const eight=await scenario('payment8',{action:'lab-payment',operationId:id(120),labId:LAB,expectedLabAccountRevision:8,createdAt:WHEN,date:DAY,note:'',allocations:cases.map(caseId=>({caseId,expectedRevision:1,amountCents:1000}))},state);
  const zero=await scenario('zero-order',create(id(14),{paidCents:0,includeExamination:false}));
  const whole=initial();whole.get(p('labDefinitions',LAB)).data.costs[0].billingBasis='whole-case';whole.get(p('labDefinitions',LAB)).data.costs[0].category='removable';
  const removable=await scenario('removable100',create(id(15),{kind:'removable',units:100,teethIds:[],paidCents:0}),whole);
  const maxState=initial(300),selectedTeeth=['ur','ul','lr','ll'].flatMap(q=>Array.from({length:8},(_,n)=>q+(n+1)));
  const maxService=maxState.get(p('settings','serviceCatalog')).data.services[299];
  maxState.get(p('settings','prostheticRouting')).data.routes[99].serviceId=maxService.serviceId;
  maxState.get(p('labDefinitions',LAB)).data.costs[99].unitCostCents=31_250_000_000;
  const maximum=await scenario('max-order32-teeth-1e12-indices',create(id(16),{serviceId:maxService.serviceId,units:32,teethIds:selectedTeeth,
    patientUnitPriceCents:31_250_000_000,includeExamination:false,paidCents:0,note:'ن'.repeat(2000),deliveryExpectedDate:'2026-10-20'}),maxState);
  const smoke=process.argv[3]==='--smoke'||process.argv[3]==='--boundary';
  for(const s of(smoke?(process.argv[3]==='--boundary'?[maximum]:[first]):[first,many,progress,payment,eight,zero,removable,maximum])){
    await check(`${s.name}:prepare`,true,new Map([...s.before].filter(([key])=>key!==p('operationIntents',s.command.operationId))),new Map([[p('operationIntents',s.command.operationId),s.before.get(p('operationIntents',s.command.operationId))]]));
    await check(`${s.name}:complete`,true,s.before,s.writes);if(smoke)continue;await check(`${s.name}:anonymous`,false,s.before,s.writes,null);
    const secretary=structuredClone(token);secretary.token.dentalClinicRole='secretary';await check(`${s.name}:secretary`,false,s.before,s.writes,secretary);
    const unverified=structuredClone(token);unverified.token.email_verified=false;await check(`${s.name}:unverified`,false,s.before,s.writes,unverified);
    for(const key of s.writes.keys()){const incomplete=structuredClone(s.writes);incomplete.delete(key);await check(`${s.name}:missing-${key.split('/').at(-2)}-${key.split('/').at(-1)}`,false,s.before,incomplete);}
    const bad=structuredClone(s.writes);bad.get(p('prostheticOperations',s.command.operationId)).totalAllocatedCents++;await check(`${s.name}:forged-total`,false,s.before,bad);
    for(const[key,value]of s.writes)if(!key.includes('/operationIntents/')){const mutation=structuredClone(s.writes);mutation.get(key).extra='bad';await check(`${s.name}:extra-${key.split('/').at(-2)}`,false,s.before,mutation);}
    await check(`${s.name}:delete`,false,s.after,new Map([...s.writes.keys()].map(key=>[key,null])));
  }
  if(!smoke){
  for(const [key,value]of eight.writes)if(key.includes('/prostheticPaymentProofs/')){const bad=structuredClone(eight.writes);bad.get(key).subtotalCents++;await check(`payment8:proof-sum-${value.index}`,false,eight.before,bad);}
  for(const field of['serviceIndex','routeIndex','materialIndex']){const bad=structuredClone(many.writes);bad.get(p('prostheticOperations',many.command.operationId))[field]=1;await check(`indexed:${field}`,false,many.before,bad);}
  for(const patch of[{status:'disabled'},{verifiedAfter:101},{role:'secretary'}]){const before=structuredClone(first.before);Object.assign(before.get(p('members',UID)),patch);await check(`member:${Object.keys(patch)[0]}`,false,before,first.writes);}
  for(const key of[p('settings','serviceCatalog'),p('settings','prostheticRouting'),p('labDefinitions',LAB)]){const before=structuredClone(first.before);before.get(key).revision++;await check(`fresh-reference:${key}`,false,before,first.writes);}
  const wrongFile=structuredClone(first.writes);for(const key of[p('labCases',id(10)),p('patientAccounts',PATIENT),p('patientSessions',id(10)),p('patientReceipts',id(10)),p('prostheticOperations',id(10))])wrongFile.get(key).fileNo=402;
  await check('file-number-cannot-reassign-clinical-link',false,first.before,wrongFile);
  for(const field of['date','deliveryExpectedDate','teethIds']){const before=structuredClone(first.before),writes=structuredClone(first.writes),value=field==='teethIds'?['ur9']:'2026-02-30';
    before.get(p('operationIntents',first.command.operationId)).command[field]=value;writes.get(p('operationIntents',first.command.operationId)).command[field]=value;
    const caseValue=writes.get(p('labCases',first.command.operationId));caseValue.snapshot[field]=value;
    if(field==='teethIds'){writes.get(p('patientSessions',first.command.operationId)).data.teethIds=value;}
    else if(field==='date'){writes.get(p('patientSessions',first.command.operationId)).data.date=value;writes.get(p('patientReceipts',first.command.operationId)).date=value;}
    await check(`required-case:invalid-${field}`,false,before,writes);}
  for(const[key,value]of eight.writes)if(key.includes('/prostheticPaymentProofs/'))await check(`immutable-proof:${value.index}`,false,eight.after,new Map([[key,value]]));
  }
  // Real SDK transaction boundaries, historical ACK and later patient receipt.
  await seed(first.before);const{app,db}=client();const adapter={authorizeOwner:async()=>UID,runTransaction:<T>(work:(tx:any)=>Promise<T>)=>runTransaction(db,tx=>work({get:async(key:string)=>{const s=await tx.get(doc(db,key));return s.exists()?s.data():null;},set:(key:string,value:object)=>tx.set(doc(db,key),value)}))};
  try{const repo=createCloudProstheticRepository(adapter,{digest});await repo.commit(first.command);assert.equal((await repo.commit(first.command)).status,'already-committed');
    const clinical=createCloudClinicalRepository(adapter,{digest}),journal=createCloudOperationIntentRepository(adapter,{digest});const cash={action:'payment' as const,operationId:id(190),patientId:PATIENT,sessionId:id(10),expectedRevision:1,createdAt:WHEN,date:DAY,note:'',amountCents:1000};
    await journal.prepare('clinical',cash,WHEN);await clinical.commit(cash);assert.equal((await getDoc(doc(db,p('patientAccounts',PATIENT)))).data()!.paidCents,11000);
    assert.equal((await getDoc(doc(db,p('labAccounts',LAB)))).data()!.paidCostCents,0);results.push({name:'SDK-order-historical-ACK-later-patient-payment',expected:true,actual:true});
    for(const col of['labCases','labAccounts','labPayments']){await getDocs(query(collection(db,`clinics/main/${col}`),limit(50)));results.push({name:`bounded-query:${col}`,expected:true,actual:true});}
  }finally{await deleteApp(app);}
  await seed(eight.before);const paymentClient=client();const paymentAdapter={authorizeOwner:async()=>UID,runTransaction:<T>(work:(tx:any)=>Promise<T>)=>runTransaction(paymentClient.db,tx=>work({
    get:async(key:string)=>{const value=await tx.get(doc(paymentClient.db,key));return value.exists()?value.data():null;},set:(key:string,value:object)=>tx.set(doc(paymentClient.db,key),value)}))};
  try{const repo=createCloudProstheticRepository(paymentAdapter,{digest}),journal=createCloudOperationIntentRepository(paymentAdapter,{digest});
    await repo.commit(eight.command);assert.equal((await repo.commit(eight.command)).status,'already-committed');
    assert.equal((await getDoc(doc(paymentClient.db,p('labAccounts',LAB)))).data()!.paidCostCents,8000);
    const a={...eight.command,operationId:id(201),expectedLabAccountRevision:9,allocations:[{caseId:cases[0],expectedRevision:2,amountCents:100}]};
    const b={...a,operationId:id(202)};await journal.prepare('prosthetic',a,WHEN);await journal.prepare('prosthetic',b,WHEN);
    const outcomes=await Promise.allSettled([repo.commit(a),repo.commit(b)]);assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
    const winner=outcomes[0].status==='fulfilled'?a:b;assert.equal((await repo.commit(winner)).status,'already-committed');
    assert.equal((await getDoc(doc(paymentClient.db,p('labAccounts',LAB)))).data()!.paidCostCents,8100);
    results.push({name:'SDK-payment8-proof-reads-historical-ACK-concurrent-single-winner',expected:true,actual:true});
  }finally{await deleteApp(paymentClient.app);}
  const failed=results.filter(r=>r.expected!==r.actual);console.log(JSON.stringify({DEMO:PROJECT,cases:results.length,passed:results.length-failed.length,failed,completeRelease:false}));if(failed.length)process.exitCode=1;
}catch(e:any){console.error(JSON.stringify({status:'prosthetic-DEMO-incomplete',detail:String(e?.message??'unknown').slice(0,3000)}));process.exitCode=1;}
