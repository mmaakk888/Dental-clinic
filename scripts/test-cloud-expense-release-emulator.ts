/** Actual engine checks for the expense fragment. Disposable loopback DEMO
 * only, no IAM, live project, real accounts, billing or clinic data. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase/app';
import { Bytes, connectFirestoreEmulator, getFirestore, doc, writeBatch, runTransaction, getDoc, setLogLevel } from 'firebase/firestore/lite';
import { createCloudExpenseRepository, cloudMaterialIdV2, type CloudExpenseCommand, type CloudExpenseData } from '../src/utils/cloudExpenseRepository';
import { createCloudOperationIntentRepository } from '../src/utils/cloudOperationIntent';
import { expenseRatioProof } from '../src/utils/cloudExpenseInventoryProofs';
const PROJECT='demo-clinic-release-rules',BASE='http://127.0.0.1:8789',UID='synthetic-release-owner',WHEN='2026-10-14T00:00:00.000Z',DAY='2026-10-14';
if(process.argv[2]!=='--demo-emulator'||process.env.FIRESTORE_EMULATOR_HOST&&process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8789')throw Error('Explicit isolated expense DEMO required');
setLogLevel('silent');
const id=(n:number)=>`71000000-0000-4000-8000-${String(n).padStart(12,'0')}`,p=(c:string,key:string)=>`clinics/main/${c}/${key}`;
const digest=async(value:string)=>createHash('sha256').update(value).digest('hex'),digestBytes=async(value:Uint8Array)=>createHash('sha256').update(value).digest('hex');
const member={schemaVersion:1,clinicId:'main',uid:UID,role:'owner',status:'active',identityVersion:1,verifiedAfter:100};
const token={uid:UID,token:{email_verified:true,dentalClinicId:'main',dentalClinicRole:'owner',auth_time:100,firebase:{sign_in_provider:'password'}}};
function wire(key:string,value:any):any { if(!key.includes('/invoiceImages/')||value===null)return value;const{base64,...metadata}=value;return{...metadata,bytes:Bytes.fromBase64String(base64)}; }
function unwire(key:string,value:any):any { if(!key.includes('/invoiceImages/')||value===null)return value;const{bytes,...metadata}=value;return{...metadata,base64:bytes.toBase64()}; }
function encode(v:any):any { if(v instanceof Bytes)return{bytesValue:v.toBase64()};if(v===null)return{nullValue:null};if(typeof v==='string')return{stringValue:v};
  if(typeof v==='boolean')return{booleanValue:v};if(typeof v==='number')return Number.isInteger(v)?{integerValue:String(v)}:{doubleValue:v};
  if(Array.isArray(v))return{arrayValue:{values:v.map(encode)}};return{mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,encode(x)]))}}; }
async function admin(endpoint:string,method:string,body?:object) {const url=new URL(endpoint,BASE);assert.equal(url.origin,BASE);assert.ok(url.pathname.includes(`/projects/${PROJECT}`));
  const r=await fetch(url,{method,headers:{'content-type':'application/json',authorization:'Bearer owner'},...(body?{body:JSON.stringify(body)}:{})});
  if(!r.ok)throw Error(`DEMO ${r.status}: ${(await r.text()).slice(0,3000)}`);return r; }
let seededFingerprint:string|null=null;
async function seed(rows:Map<string,any>) { const fingerprint=JSON.stringify([...rows]);if(seededFingerprint===fingerprint)return;
  await admin(`/emulator/v1/projects/${PROJECT}/databases/(default)/documents`,'DELETE');
  if(rows.size)await admin(`/v1/projects/${PROJECT}/databases/(default)/documents:commit`,'POST',{writes:[...rows].map(([key,data])=>({update:{name:`projects/${PROJECT}/databases/(default)/documents/${key}`,fields:encode(wire(key,data)).mapValue.fields}}))});seededFingerprint=fingerprint; }
function client(auth:typeof token|null=token) {const app=initializeApp({projectId:PROJECT,apiKey:'demo-only'},`expense-demo-${randomUUID()}`),db=getFirestore(app);
  const payload=auth&&{iss:`https://securetoken.google.com/${PROJECT}`,aud:PROJECT,iat:1800000000,exp:4102444800,...auth.token,sub:auth.uid,user_id:auth.uid};
  const mockUserToken=payload&&`${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.`;
  connectFirestoreEmulator(db,'127.0.0.1',8789,mockUserToken?{mockUserToken}:undefined);return{app,db}; }
const results:{name:string,expected:boolean,actual:boolean,error?:string}[]=[];
async function check(name:string,expected:boolean,before:Map<string,any>,writes:Map<string,any>,auth:typeof token|null=token) {await seed(before);const{app,db}=client(auth);let actual=true,error='';
  try{const batch=writeBatch(db);for(const[key,data]of writes)data===null?batch.delete(doc(db,key)):batch.set(doc(db,key),wire(key,data));await batch.commit();}
  catch(e:any){actual=false;error=String(e?.message??'unknown').slice(0,2800);}finally{await deleteApp(app);}
    if(actual)seededFingerprint=null;
    results.push({name,expected,actual,...(expected!==actual?{error}:{})});if(results.length%100===0)console.log(JSON.stringify({DEMO:PROJECT,progress:results.length,last:name}));
    if(expected!==actual){console.log(JSON.stringify(results.at(-1)));throw Error(`First expense engine mismatch ${name}: ${error}`);} }
type Step={before:Map<string,any>;writes:Map<string,any>};
async function scenario(name:string,command:CloudExpenseCommand,before=new Map([[p('members',UID),member]]),image?:string) {const rows=structuredClone(before),steps:Step[]=[];
  const adapter={authorizeOwner:async()=>UID,readRecord:async(key:string)=>structuredClone(rows.get(key)??null),runTransaction:async<T>(work:(tx:any)=>Promise<T>)=>{
    const old=structuredClone(rows),staged=structuredClone(rows),writes=new Map<string,any>();const result=await work({get:async(key:string)=>structuredClone(staged.get(key)??null),
      set:(key:string,value:any)=>{staged.set(key,structuredClone(value));writes.set(key,structuredClone(value));}});
    rows.clear();staged.forEach((value,key)=>rows.set(key,value));if(writes.size)steps.push({before:old,writes});return result;}};
  const journal=createCloudOperationIntentRepository(adapter,{digest});await journal.prepare('expense',command,WHEN);
  await createCloudExpenseRepository(adapter,{digest,digestBytes}).commit(command,image);return{name,command,steps,after:rows}; }
function data(count:number,changes:Partial<CloudExpenseData>={}):CloudExpenseData {return{title:'فاتورة مصطنعة',category:count?'supplies':'fixed',expenseType:count?'supplies':'rent',
  date:DAY,note:'',isFixed:!count,recurringPeriod:count?'none':'monthly',supplierName:'مورد مصطنع',supplierPhone:'',supplierAddress:'',invoiceNumber:'',invoiceDate:DAY,invoiceTime:'',taxNumber:'',commercialRecord:'',
  currency:'EGP',subtotalCents:count?count*100:10000,taxCents:count?1:0,discountCents:0,totalCents:count?count*100+1:10000,
  items:Array.from({length:count},(_,n)=>({itemId:id(500+n),name:`خامة ${n}`,unit:'علبة',quantityMilli:1000,unitPriceCents:100,discountCents:0,taxCents:0,totalCents:100})),...changes}; }
const create=(n:number,count:number,changes:Partial<CloudExpenseData>={},paidCents=0):CloudExpenseCommand=>({action:'create',operationId:id(n),recordId:id(100+n),expectedRevision:0,createdAt:WHEN,data:data(count,changes),paidCents});
const only=process.argv.includes('--sdk-only')?'__sdk_only__':process.argv.find(v=>v.startsWith('--only='))?.slice(7);
try {
  let rules=readFileSync('firestore.release.rules','utf8');const fragment=readFileSync('rules/expense.release.rules.fragment','utf8');
  if(!rules.includes('function ex_preparedExpense(')) {const start=rules.indexOf('function commandValid(d)'),end=rules.indexOf('function coupledIntent',start);
    assert.ok(start>=0 && end>start);const block=rules.slice(start,end),updated=block.replace(/: false;\s*}/,
      ": d.kind == 'expense' ? d.command.createdAt==d.createdAt && ex_preparedExpense(d.command) : false;\n    }");
    assert.notEqual(updated,block);rules=rules.slice(0,start)+updated+rules.slice(end);
    rules=rules.replace('    match /{document=**}',()=>`${fragment}\n    match /{document=**}`);}
  await admin(`/emulator/v1/projects/${PROJECT}:securityRules`,'PUT',{rules:{files:[{name:'firestore.release.rules',content:rules}]}});
  const scenarios=[];for(const count of[0,1,4,5,16,20].filter(count=>!only||count<=1||only===`create${count}`))scenarios.push(await scenario(`create${count}`,create(10+count,count,{},count?1:2000)));
  const duplicateData=data(20);duplicateData.items=duplicateData.items.map(row=>({...row,name:'خامة مشتركة'}));
  if(!only||only==='twenty-rows-one-material')scenarios.push(await scenario('twenty-rows-one-material',create(40,20,duplicateData)));
  const zeroData=data(20);zeroData.items=zeroData.items.map(row=>({...row,unitPriceCents:0,totalCents:0}));zeroData.subtotalCents=0;zeroData.taxCents=0;zeroData.totalCents=0;
  if(!only||only==='twenty-zero-cost-items')scenarios.push(await scenario('twenty-zero-cost-items',create(41,20,zeroData)));
  const first=scenarios[1],material=await cloudMaterialIdV2('خامة 0','علبة',{digest});
  scenarios.push(await scenario('pay',{action:'pay',operationId:id(50),recordId:first.command.action==='create'?first.command.recordId:'',expectedRevision:1,amountCents:1,date:DAY,note:'دفعة',createdAt:WHEN},first.after));
  scenarios.push(await scenario('edit',{action:'edit',operationId:id(51),recordId:first.command.action==='create'?first.command.recordId:'',expectedRevision:1,
    data:{title:'فاتورة معدلة',date:DAY,note:'',isFixed:false,recurringPeriod:'none',expenseType:'supplies'},createdAt:WHEN},first.after));
  scenarios.push(await scenario('usage',{action:'usage',operationId:id(52),materialId:material,expectedRevision:1,quantityMilli:333,kind:'used',date:DAY,note:'',createdAt:WHEN},first.after));
  const maxData=data(1);maxData.items[0]={...maxData.items[0],quantityMilli:1e12,unitPriceCents:1000,totalCents:1e12};maxData.subtotalCents=1e12;maxData.taxCents=0;maxData.totalCents=1e12;
  const max=await scenario('maximum-product',create(53,1,maxData));scenarios.push(max,await scenario('maximum-usage-product',{action:'usage',operationId:id(54),materialId:material,
    expectedRevision:1,quantityMilli:1e12,kind:'waste',date:DAY,note:'',createdAt:WHEN},max.after));
  const jpeg=Buffer.from([255,216,255,192,0,17,8,0,160,1,64,3,1,17,0,2,17,0,3,17,0,255,218,0,12,3,1,0,2,0,3,0,0,63,0,1,2,3,255,217]);
  const image:CloudExpenseCommand={action:'attach-image',operationId:id(55),recordId:first.command.action==='create'?first.command.recordId:'',expectedRevision:1,
    createdAt:WHEN,image:{sha256:await digestBytes(jpeg),byteLength:jpeg.length,width:320,height:160,contentType:'image/jpeg'}};
  scenarios.push(await scenario('image',image,first.after,jpeg.toString('base64')));
  const largeImage=Buffer.alloc(153600,1);jpeg.copy(largeImage);largeImage[largeImage.length-2]=255;largeImage[largeImage.length-1]=217;
  scenarios.push(await scenario('image150KiB',{...image,operationId:id(56),image:{...image.image,sha256:await digestBytes(largeImage),byteLength:largeImage.length}},first.after,largeImage.toString('base64')));
  const fixed=scenarios[0];scenarios.push(await scenario('unitemized-correction',{action:'edit',operationId:id(57),recordId:fixed.command.action==='create'?fixed.command.recordId:'',
    expectedRevision:1,createdAt:WHEN,data:{title:'إيجار معدل',date:DAY,note:'',isFixed:true,recurringPeriod:'monthly',expenseType:'rent',totalCents:8000}},fixed.after));
  const positiveOnly=process.argv.includes('--positive-only'),negativeShapes=new Set<string>();
  const from=Number(process.argv.find(v=>v.startsWith('--from-step='))?.slice(12)??0);
  if(!Number.isInteger(from)||from<0||from>1000||from&&!only)throw Error('Diagnostic step filter requires one explicit DEMO scenario');
  for(const s of scenarios.filter(s=>!only||only.split(',').includes(s.name)))for(let n=from;n<s.steps.length;n++){const step=s.steps[n],label=`${s.name}:${n}`;
    await check(`${label}:complete`,true,step.before,step.writes);
    if(positiveOnly)continue;
    const proof=[...step.writes].find(([key])=>key.includes('/expenseInventoryProofs/'))?.[1];
    const shape=n===s.steps.length-1?`${s.name}:final`:proof?.kind?`math:${proof.kind}:${proof.part}`
      :proof?.part!==undefined?`header:${proof.part}`:proof?.itemBase?`item:${proof.rowIndex===19?'max':'ordinary'}`
      :proof?.summary?`forest:${proof.level}:${proof.index===19?'max':proof.leaf&&[...step.before.values()].some(value=>value?.pending?.operationId===proof.operationId)?'existing-head':'ordinary'}`:'intent';
    if(negativeShapes.has(shape))continue;negativeShapes.add(shape);
    if(n===s.steps.length-1){await check(`${label}:anonymous`,false,step.before,step.writes,null);const secretary=structuredClone(token);secretary.token.dentalClinicRole='secretary';await check(`${label}:secretary`,false,step.before,step.writes,secretary);}
    for(const key of step.writes.keys()){if(step.writes.size>1){const partial=structuredClone(step.writes);partial.delete(key);await check(`${label}:missing-${key.split('/').at(-2)}`,false,step.before,partial);}
      const extra=structuredClone(step.writes);extra.get(key).extra=true;await check(`${label}:extra-${key.split('/').at(-2)}`,false,step.before,extra);}
    for(const[key,value]of step.writes){
      if(key.includes('/expenseInventoryProofs/')&&value.summary){const bad=structuredClone(step.writes);bad.get(key).summary.costCents++;await check(`${label}:forged-proof-cost`,false,step.before,bad);}
      if(key.includes('/expenseInventoryProofs/')&&value.ratio){
        const bad=structuredClone(step.writes);
        if(value.part===0)bad.get(key).ratio.operands.a[0]++;
        else if(value.part===1)bad.get(key).ratio.product[0]++;
        else bad.get(key).ratio.quotientCarry[0]++;
        await check(`${label}:forged-ratio-stage`,false,step.before,bad);
        if(value.part>0){const withoutPrior=structuredClone(step.before);withoutPrior.delete(p('expenseInventoryProofs',`${value.operationId}-math-${value.kind}-${value.rowIndex}-${value.part-1}`));
          await check(`${label}:missing-prior-ratio-stage`,false,withoutPrior,step.writes);}
      }
      if(key.includes('/materialBalances/')&&value.pending){const bad=structuredClone(step.writes);bad.get(key).pending.candidate.purchaseCostCents++;await check(`${label}:forged-head-cost`,false,step.before,bad);}
      if(key.includes('/invoiceImages/')){const bad=structuredClone(step.writes);const binary=Buffer.from(bad.get(key).base64,'base64');binary[10]^=1;bad.get(key).base64=binary.toString('base64');await check(`${label}:forged-image-bytes`,false,step.before,bad);}
    }
  }
  if(!only||only.split(',').includes('maximum-product')){
    const itemStep=max.steps.find(step=>[...step.writes.values()].some(value=>value?.itemBase));assert.ok(itemStep);
    const before=structuredClone(itemStep.before),writes=structuredClone(itemStep.writes),intent=before.get(p('operationIntents',max.command.operationId));
    intent.command.data.items[0].quantityMilli=1500;intent.command.data.items[0].unitPriceCents=666666666667;intent.command.data.items[0].discountCents=1;
    intent.requestHash=await digest(JSON.stringify(['clinic-operation-intent-v1',UID,'expense',intent.command]));
    const ratio=expenseRatioProof(1500,666666666667,1000);
    for(const value of before.values())if(value?.intentRequestHash){value.intentRequestHash=intent.requestHash;if(value.kind==='item')value.ratio=ratio;}
    for(const value of writes.values()){value.intentRequestHash=intent.requestHash;value.itemBase=ratio;}
    await check('rounded-item-base-over-cap-even-after-discount',false,before,writes);
  }
  if(only&&only!=='__sdk_only__'){console.log(JSON.stringify({DEMO:PROJECT,selected:only,cases:results.length,passed:results.length,completeRelease:false}));process.exit(0);}
  // Real SDK replay is readonly before private proof/head reads, including
  // after another stock usage. A cancelled prepared purchase never adds stock.
  await seed(new Map([[p('members',UID),member]]));const{app,db}=client();
  const adapter={authorizeOwner:async()=>UID,readRecord:async(key:string)=>{const v=await getDoc(doc(db,key));return v.exists()?unwire(key,v.data()):null;},
    runTransaction:<T>(work:(tx:any)=>Promise<T>)=>runTransaction(db,tx=>work({get:async(key:string)=>{const v=await tx.get(doc(db,key));return v.exists()?unwire(key,v.data()):null;},set:(key:string,value:any)=>tx.set(doc(db,key),wire(key,value))}))};
  try {const repo=createCloudExpenseRepository(adapter,{digest,digestBytes}),journal=createCloudOperationIntentRepository(adapter,{digest}),c=create(70,20,{},10);
    await journal.prepare('expense',c,WHEN);await repo.commit(c);assert.equal((await repo.commit(c)).status,'already-committed');
    assert.equal((await repo.getMaterial(material))?.purchasedMilli,1000);results.push({name:'actual-SDK20-create-readonly-replay',expected:true,actual:true});
    const more=create(76,1);await journal.prepare('expense',more,WHEN);await repo.commit(more);
    assert.equal((await repo.getMaterial(material))?.purchasedMilli,2000);
    assert.equal((await repo.commit(c)).status,'already-committed');assert.equal((await repo.getMaterial(material))?.purchasedMilli,2000);
    results.push({name:'actual-SDK-additional-purchase-resolves-committed-head-and-old-ACK-preserves-new-stock',expected:true,actual:true});
    // Preserve a committed base while another purchase is interrupted after
    // its first durable leaf. Cancellation changes no cash or stock balance.
    const interrupted=create(71,2),plan=await scenario('interrupted-plan',interrupted,scenarios[1].after);
    const locked=plan.steps.find(step=>[...step.before.values()].some(value=>value?.pending?.operationId===interrupted.operationId));assert.ok(locked);
    await seed(locked.before);const stoppedRepo=createCloudExpenseRepository(adapter,{digest,digestBytes});
    assert.equal((await stoppedRepo.getMaterial(material))?.purchasedMilli,1000);
    const use:CloudExpenseCommand={action:'usage',operationId:id(72),materialId:material,expectedRevision:1,quantityMilli:500,kind:'used',date:DAY,note:'',createdAt:WHEN};
    await journal.prepare('expense',use,WHEN);await assert.rejects(stoppedRepo.commit(use));
    await journal.cancel(interrupted.operationId);assert.equal((await stoppedRepo.getMaterial(material))?.purchasedMilli,1000);
    await stoppedRepo.commit(use);assert.equal((await stoppedRepo.getMaterial(material))?.usedMilli,500);await assert.rejects(stoppedRepo.commit(interrupted));
    results.push({name:'actual-SDK-interrupted-fence-cancel-preserves-base-then-usage',expected:true,actual:true});
    await journal.prepare('expense',image,WHEN);await stoppedRepo.commit(image,jpeg.toString('base64'));
    assert.equal((await stoppedRepo.getInvoiceImage(image.recordId))?.base64,jpeg.toString('base64'));
    assert.equal((await stoppedRepo.commit(image)).status,'already-committed');results.push({name:'actual-SDK-binary-image-read-and-readonly-replay',expected:true,actual:true});
    const lost=create(73,0,{},100);await journal.prepare('expense',lost,WHEN);let loseNext=true;
    const losingAdapter={...adapter,runTransaction:async<T>(work:(tx:any)=>Promise<T>)=>{let domain=false;const result=await adapter.runTransaction<T>(tx=>work({
      get:tx.get,set:(key:string,value:any)=>{domain ||= key.includes('/expenseRecords/');tx.set(key,value);}}));
      if(domain&&loseNext){loseNext=false;throw Error('SYNTHETIC_LOST_ACK');}return result;}};
    const losing=createCloudExpenseRepository(losingAdapter,{digest,digestBytes});await assert.rejects(losing.commit(lost));
    assert.equal((await losing.commit(lost)).status,'already-committed');assert.equal((await losing.get(lost.action==='create'?lost.recordId:''))?.paidCents,100);
    results.push({name:'actual-SDK-lost-ACK-original-operation-no-double-cash',expected:true,actual:true});
    const other=client();try{const secondAdapter={authorizeOwner:async()=>UID,runTransaction:<T>(work:(tx:any)=>Promise<T>)=>runTransaction(other.db,tx=>work({
      get:async(key:string)=>{const value=await tx.get(doc(other.db,key));return value.exists()?unwire(key,value.data()):null;},set:(key:string,value:any)=>tx.set(doc(other.db,key),wire(key,value))}))};
      const second=createCloudExpenseRepository(secondAdapter,{digest,digestBytes}),a:CloudExpenseCommand={...use,operationId:id(74),expectedRevision:2,quantityMilli:300},b:CloudExpenseCommand={...a,operationId:id(75)};
      await journal.prepare('expense',a,WHEN);await journal.prepare('expense',b,WHEN);const outcomes=await Promise.allSettled([stoppedRepo.commit(a),second.commit(b)]);
      assert.equal(outcomes.filter(value=>value.status==='fulfilled').length,1);assert.equal((await stoppedRepo.getMaterial(material))?.usedMilli,800);
      const winner=outcomes[0].status==='fulfilled'?a:b;assert.equal((await stoppedRepo.commit(winner)).status,'already-committed');
      results.push({name:'actual-SDK-two-context-stock-CAS-one-winner-readonly-replay',expected:true,actual:true});
    }finally{await deleteApp(other.app);}
  }finally{await deleteApp(app);}
  const failed=results.filter(r=>r.expected!==r.actual);console.log(JSON.stringify({DEMO:PROJECT,...(only?{selected:only}:{}),cases:results.length,passed:results.length-failed.length,failed,completeRelease:false}));if(failed.length)process.exitCode=1;
}catch(e:any){console.error(JSON.stringify({status:'expense-DEMO-incomplete',detail:String(e?.message??'unknown').slice(0,3000)}));process.exitCode=1;}
