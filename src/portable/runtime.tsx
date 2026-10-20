import React, {createContext, useContext} from 'react';
import type {User} from '../types';
import type {Storage as LocalStorage} from '../utils/storage';
import {DEFAULT_THEME,DEFAULT_UI_LABELS,DEFAULT_WHATSAPP_SETTINGS} from '../data/initialData';
import {configureAiTransport} from '../services/aiTransport';
type Snapshot={schemaVersion:1;revision:number;user:User;users:User[];domain:any;settings:any};
export interface PortableRuntime {
 storage:typeof LocalStorage; currentUser():User|null; authenticate(username:string,password:string):Promise<User>;
 action(action:string,args:unknown):Promise<any>; read(action:string):Promise<any>; refresh():Promise<void>; remember(value:boolean):Promise<void>; logout():Promise<void>;
 backupRequest(form?:FormData):Promise<Response>;
 prescriptionHeader():{doctorName:string;phone:string;address:string}|undefined;
 subscribe(listener:()=>void):()=>void; pending():boolean; error():string; retry():Promise<void>; cancel():Promise<void>;
}
export const PortableContext=createContext<PortableRuntime|null>(null);
PortableContext.displayName='ClinicPortableRuntime';
export const usePortableRuntime=()=>useContext(PortableContext);
const emptyDomain=()=>({patients:[],contacts:[],appointments:[],labCases:[],expenses:[],materialUsages:[]});
export function createPortableRuntime(endpoint:URL):PortableRuntime {
 let snapshot:Snapshot|null=null,branding:any={},csrf='',version=0,lastError='',pending:{action:string;args:unknown;operationId:string;expectedRevision:number}|null=null;
 const recoveryKey='clinic-operation:'+endpoint.origin+endpoint.pathname;
 let recovery:{operationId:string;userId:string}|null=null;
 try{const value=JSON.parse(sessionStorage.getItem(recoveryKey)||'null');if(value&&/^[a-f0-9-]{36}$/.test(value.operationId)&&typeof value.userId==='string')recovery=value;}catch{/* No clinical content is read or repaired. */}
 const rememberOperation=()=>{try{if(pending&&snapshot)sessionStorage.setItem(recoveryKey,JSON.stringify({operationId:pending.operationId,userId:snapshot.user.id}));}catch{pending=null;lastError='اسمح بتخزين هوية المحاولة في جلسة المتصفح قبل الحفظ؛ لم نرسل أي تعديل.';emit();throw Error(lastError);}};
 const forgetOperation=()=>{try{sessionStorage.removeItem(recoveryKey);}catch{/* An already acknowledged server commit must not become an uncertain write due to local cleanup. */}recovery=null;};
 let busy=false;let refreshInFlight:Promise<void>|null=null;const listeners=new Set<()=>void>();const privacy={value:false};
 configureAiTransport(async(route,input)=>{const result=await request({action:'ai.'+route.split('/').at(-1),args:JSON.parse(String(input.body))});return new Response(JSON.stringify(result.result),{headers:{'Content-Type':'application/json'}});});
 const emit=()=>listeners.forEach(listener=>listener());const clear=()=>{snapshot=null;version++;emit();};
 async function request(body?:unknown,query?:string){
  const target=new URL(endpoint);if(query)target.searchParams.set('action',query);if(!body&&!query&&snapshot)target.searchParams.set('since',String(snapshot.revision));
  const response=await fetch(target,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:body?{'Content-Type':'application/json','X-CSRF-Token':csrf}:{},...(body?{body:JSON.stringify(body)}:{})});
  let value:any;try{value=await response.json();}catch{throw Error('الخادم لم يُرجع JSON؛ راجع إعداد PHP أو فحص المتصفح في الاستضافة.');}
  if(value.csrf)csrf=value.csrf;
  if(!response.ok||value.ok!==true){if(response.status===401||value.kind==='session')clear();throw Object.assign(Error(typeof value.error==='string'?value.error:'تعذر تأكيد العملية.'),{safeToEdit:value.safeToEdit===true});}return value;
 }
 const accept=(value:any)=>{if(Object.hasOwn(value,'user')&&value.user===null){snapshot=null;version++;}if(value.snapshot){if(value.snapshot.schemaVersion!==1||!Number.isSafeInteger(value.snapshot.revision)||!value.snapshot.user?.id)throw Error('نسخة خادم غير صالحة.');if(snapshot?.user.id===value.snapshot.user.id&&value.snapshot.revision<snapshot.revision)return;snapshot=value.snapshot;if(recovery?.userId===snapshot!.user.id)lastError='توجد محاولة من قبل تحديث الصفحة. تحقّق من نتيجتها قبل تسجيل أي عملية أخرى؛ لن نرسل بياناتها مرة ثانية.';}branding=value.branding??branding;emit();};
 const getters:Record<string,()=>any>={getDomainData:()=>snapshot?.domain??emptyDomain(),getUsers:()=>snapshot?.users??[],getCurrentUser:()=>snapshot?.user??null,getRememberedSession:()=>null,
  getClinicName:()=>snapshot?.settings.clinicName??branding.clinicName??'عيادة الأسنان',getClinicLogo:()=>snapshot?.settings.clinicLogo??branding.clinicLogo??null,
  getTheme:()=>snapshot?.settings.theme??DEFAULT_THEME,getClinicContent:()=>snapshot?.settings.content??{labels:DEFAULT_UI_LABELS,tileOrder:['patients','contacts','appointments','lab','summary','settings']},
  getServiceCatalog:()=>snapshot?.settings.serviceCatalog??{serviceTypes:[],clinicalPrices:{},crownPrices:{},examinationFee:100},getProstheticRouting:()=>snapshot?.settings.prostheticRouting??{defaultLabs:{},overrides:[]},
  getLabs:()=>snapshot?.settings.labs??[],getExpenses:()=>snapshot?.domain.expenses??[],getMaterialUsages:()=>snapshot?.domain.materialUsages??[],getContacts:()=>snapshot?.domain.contacts??[],
  getPatients:()=>snapshot?.domain.patients??[],getAppointments:()=>snapshot?.domain.appointments??[],getLabCases:()=>snapshot?.domain.labCases??[],
  getWhatsappSettings:()=>snapshot?.settings.whatsappSettings??DEFAULT_WHATSAPP_SETTINGS,getDrugCatalog:()=>snapshot?.settings.drugCatalog??[],getPrivacyMode:()=>privacy.value,
  getBackupData:()=>({...snapshot?.domain,...snapshot?.settings,...snapshot?.settings.content,...snapshot?.settings.serviceCatalog,users:snapshot?.users??[],labs:snapshot?.settings.labs??[]})};
 getters.getUILabels=()=>getters.getClinicContent().labels;getters.getTileOrder=()=>getters.getClinicContent().tileOrder;
 const storage=new Proxy({}, {get(_target,name:string){const key=name.replace(/Fresh$/,'');if(getters[key])return getters[key];if(name==='savePrivacyMode')return (value:boolean)=>{privacy.value=value;};
  if(name==='saveCurrentUser')return (user:User|null)=>{if(user&&snapshot?.user.id!==user.id)throw Error('جلسة غير صالحة.');};if(name==='saveRememberedSession')return ()=>{};
  throw Error('عملية التخزين المحلي غير متاحة في نسخة PHP: '+name);
 }}) as typeof LocalStorage;
 const runtime:PortableRuntime={storage,currentUser:()=>snapshot?.user??null,prescriptionHeader:()=>snapshot?.settings.prescriptionHeader,read:action=>request(undefined,action),
  async backupRequest(form){if(!snapshot||!['admin','doctor'].includes(snapshot.user.role))throw Error('النسخ والنقل للمدير فقط.');if(pending||recovery?.userId===snapshot.user.id)throw Error('تحقق من العملية المعلقة أولًا.');const response=await fetch(new URL('backup.php',endpoint),{method:form?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:form?{'X-CSRF-Token':csrf}:{},...(form?{body:form}:{})});if(response.status===401)clear();return response;},
  refresh(){if(refreshInFlight)return refreshInFlight;const ticket=version;refreshInFlight=(async()=>{const value=await request();if(ticket!==version||value.unchanged===true)return;accept(value);})().finally(()=>{refreshInFlight=null;});return refreshInFlight;},
  async authenticate(username,password){const value=await request({action:'auth.login',args:{username,password}});version++;pending=null;accept(value);return snapshot!.user;},
  async remember(value){await request({action:'auth.remember',args:{remember:value}});},
  async logout(){if(pending&&snapshot)recovery={operationId:pending.operationId,userId:snapshot.user.id};try{await request({action:'auth.logout',args:{}});}finally{pending=null;clear();}},
  async action(action,args){if(!snapshot)throw Error('سجّل الدخول أولًا.');if(recovery?.userId===snapshot.user.id)throw Error(lastError);if(busy)throw Error('انتظر انتهاء العملية.');if(pending&&(pending.action!==action||JSON.stringify(pending.args)!==JSON.stringify(args)))throw Error('راجع المحاولة السابقة أو ألغها قبل تسجيل عملية أخرى.');pending??={action,args:JSON.parse(JSON.stringify(args)),operationId:crypto.randomUUID(),expectedRevision:snapshot.revision};rememberOperation();return perform();},
  subscribe(listener){listeners.add(listener);return()=>{listeners.delete(listener);};},pending:()=>!!pending||!!(recovery&&recovery.userId===snapshot?.user.id),error:()=>lastError,
  async retry(){if(recovery?.userId===snapshot?.user.id)await settleRecovery();else await perform();},async cancel(){if(recovery?.userId===snapshot?.user.id){await settleRecovery();return;}if(!pending||busy)return;busy=true;try{const result=await request({...pending,action:'operation.cancel',args:{}});pending=null;forgetOperation();lastError=result.committed?'العملية كانت محفوظة بالفعل؛ تم تحديث البيانات دون تكرارها.':'';accept(result);}finally{busy=false;emit();}}
 };
 async function settleRecovery(){if(!recovery||busy)return;busy=true;try{const result=await request({action:'operation.cancel',args:{},operationId:recovery.operationId});forgetOperation();lastError=result.committed?'تأكدنا أن المحاولة السابقة محفوظة؛ لم نسجلها مرة أخرى.':'تأكدنا أن المحاولة السابقة لم تُحفظ وأُغلقت بأمان. راجع البيانات قبل إعادة إدخالها.';accept(result);}finally{busy=false;emit();}}
 async function perform(){if(!pending||busy)throw Error('لا توجد محاولة متاحة.');busy=true;emit();try{const result=await request(pending);pending=null;forgetOperation();lastError='';accept(result);return result.result;}catch(error){if((error as any)?.safeToEdit===true){pending=null;forgetOperation();try{await runtime.refresh();}catch{}}lastError=error instanceof Error?error.message:'تعذر تأكيد الحفظ؛ أعد نفس المحاولة.';emit();throw error;}finally{busy=false;emit();}}
 return runtime;
}
