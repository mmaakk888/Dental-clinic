import {randomUUID} from 'node:crypto';
/** Runs only in the isolated synthetic PHP/MySQL harness. No real records or messaging. */
export async function testRxWorkflow({a,target,check,fullKey,client}) {
 let r=await a.request();
 const design={primaryColor:'#123456',accentColor:'#c59d5f',headerColor:'#165954',fontFamily:'Tahoma',fontSize:14,logoPosition:'right',headerStyle:'outline',showLogo:true,showWatermark:false,showFileNo:true,spacing:'compact',footerNote:'عبارة اختبار فقط'};
 const header={doctorTitle:'طبيب',doctorName:'طبيب اختبار مصطنع',doctorEnglish:'Synthetic',specialty1:'بيانات اختبار',specialty2:'',phone:'01000000000',address:'عنوان اختبار'};
 const template={header,design};
 r=await a.mutation('settings.prescription',{value:template});check(r.data.ok&&r.data.snapshot.settings.prescriptionTemplate.design.fontSize===14,'owner saves bounded prescription design in SQL');
 for(const bad of [ {...template,design:{...design,primaryColor:'url(https://invalid.test)'}}, {...template,design:{...design,fontFamily:'external'}}, {...template,design:{...design,fontSize:100}}, {...template,design:{...design,showLogo:'true'}}, {...template,design:{...design,footerNote:'x'.repeat(301)}}, {...template,design:{...design,css:'display:none'}}, {...template,header:{...header,doctorName:'x'.repeat(501)}} ]) {
  r=await a.mutation('settings.prescription',{value:bad});check(r.response.status===400&&r.data.safeToEdit,'server rejects unsafe unsupported or oversized prescription design');
 }
 r=await a.mutation('users.save',{value:{name:'تحكم محدود مصطنع',username:'rx-staff',newPassword:'SyntheticRxStaff_2026_Strong',role:'secretary',isActive:true,permissions:{patientView:true,controlPanel:true,patientEdit:false}}});check(r.data.ok,'prescription owner-only permission fixture');
 const staff=client();await staff.request();await staff.request('auth.login',{username:'rx-staff',password:'SyntheticRxStaff_2026_Strong'});r=await staff.mutation('settings.prescription',{value:template});check(r.response.status===403,'controlPanel permission alone cannot modify prescription design');
 r=await a.request();const next=r.data.snapshot.domain.nextFileNo;
 r=await a.mutation('patient.save',{value:{id:next,name:'ترابط روشتة ودفعات مصطنع',mobile:'01088888888',age:30}});check(r.data.ok,'new numbered patient for full prescription and cash workflow');const patientId=r.data.result;
 const visit={date:'2026-10-20',type:'خدمة اختبار',amount:600,paid:125,examinationFee:100,services:[{name:'خدمة اختبار',price:500,tooth:'ur2'}],teethIds:['ur2'],visitNotes:'ملاحظة اختبار'};
 r=await a.mutation('visit.save',{patientId,value:visit});check(r.data.ok,'optional examination service tooth and partial actual cash saved atomically');let patient=r.data.snapshot.domain.patients.find(p=>p.id===patientId);const sessionId=patient.sessions[0].id;
 check(patient.sessions[0].paid===125&&patient.sessions[0].remain===475&&patient.sessions[0].teethIds[0]==='ur2','session financial and clinical data agree after save');
 r=await a.mutation('visit.save',{patientId,value:{...visit,teethIds:['arbitrary-tooth']}});check(r.response.status===400,'invalid tooth chart identifiers rejected without a session or cash entry');
 r=await a.request();check(r.data.snapshot.domain.patients.find(p=>p.id===patientId).sessions.length===1,'invalid clinical write leaves no orphan visit');
 const rx={date:'2026-10-21',sessionId,diagnosis:'تشخيص اختبار فقط',instructions:'تعليمات اختبار',items:[{drugName:'دواء مصطنع',dosage:'اختبار وليس إرشادًا طبيًا',duration:'مدة اختبار'}],header,design};
 const command={operationId:randomUUID(),expectedRevision:a.revision};r=await a.mutation('rx.save',{patientId,value:rx},command);check(r.data.ok,'prescription saves full chosen design linked to the correct session');const rxId=r.data.result;
 r=await a.mutation('rx.save',{patientId,value:rx},command);check(r.data.ok&&r.data.result===rxId&&r.data.snapshot.domain.patients.find(p=>p.id===patientId).prescriptions.length===1,'uncertain prescription replay never creates a duplicate');
 r=await a.mutation('settings.prescription',{value:{header,design:{...design,primaryColor:'#654321'}}});check(r.data.ok&&r.data.snapshot.domain.patients.find(p=>p.id===patientId).prescriptions[0].design.primaryColor==='#123456','changing future design never rewrites historical prescription design');
 r=await a.mutation('receipt.add',{patientId,sessionId,value:{date:'2026-10-21',amount:125}});check(r.data.ok,'later dated installment linked to same session');
 r=await a.mutation('receipt.add',{patientId,sessionId,value:{date:'2026-10-21',amount:351}});check(r.response.status===409,'session overcollection is rejected');
 r=await a.request();patient=r.data.snapshot.domain.patients.find(p=>p.id===patientId);
 check(patient.sessions[0].paid===250&&patient.sessions[0].remain===350&&patient.payments.length===0,'service receipts stay linked and are not mirrored into general cash');
 r=await a.mutation('rx.save',{patientId,value:{...rx,design:{...design,headerStyle:'html'}}});check(r.response.status===400,'per-prescription design cannot bypass template validation');
 r=await a.request();const before=r.data.snapshot.domain.patients.find(p=>p.id===patientId);
 await a.backup('settings',{password:'SyntheticOwner_2026_Strong',value:JSON.stringify({publicKey:fullKey.publicKey,keySaved:true})});r=await a.backup('download',{password:'SyntheticOwner_2026_Strong'});check(r.response.ok&&Buffer.isBuffer(r.data),'encrypted backup includes design linked prescriptions sessions and cash');const bytes=r.data;
 await target.request();await target.backup('download',{password:'SyntheticOwner_2026_Strong'});r=await target.backup('preview',{password:'SyntheticOwner_2026_Strong'},{archive:bytes,key:JSON.stringify(fullKey)});check(r.data.ok,'new prescription design archive passes restore preview on another database');const token=r.data.result.token;
 r=await target.backup('restore',{password:'SyntheticOwner_2026_Strong',token,confirmation:'استبدال البيانات'},{archive:bytes,key:JSON.stringify(fullKey)});check(r.data.ok,'full restoration on a separate synthetic database: '+JSON.stringify(r.data));
 r=await target.request('auth.login',{username:'owner-test',password:'SyntheticOwner_2026_Strong'});const after=r.data.snapshot.domain.patients.find(p=>p.id===patientId);
 check(JSON.stringify(before)===JSON.stringify(after),'restored patient prescriptions sessions receipts relationships and cents match exactly');
 check(r.data.snapshot.settings.prescriptionTemplate.design.primaryColor==='#654321'&&after.prescriptions[0].design.primaryColor==='#123456','current design and historical design both survive restoration independently');
}
