import test from 'node:test';import assert from 'node:assert/strict';
import {mergeWhatsAppTemplateDraft,hasIndividualWhatsAppDraft} from './whatsappDrafts';
const templates={reminderTomorrow:'موعد قديم',newAppt:'تأكيد',postOp:'إرشادات',accountBalance:'رصيد'};
test('independent remote template edits merge without dropping a local template draft',()=>{
 const current={...templates,postOp:'مسودة محلية'},incoming={...templates,newAppt:'تأكيد محفوظ جديد'};
 const result=mergeWhatsAppTemplateDraft(current,templates,incoming);
 assert.deepEqual(result.conflicts,[]);assert.equal(result.templates.postOp,'مسودة محلية');assert.equal(result.templates.newAppt,'تأكيد محفوظ جديد');assert.equal(templates.newAppt,'تأكيد');
});
test('same-template conflict keeps the local text and explicitly reports the conflict',()=>{
 const r=mergeWhatsAppTemplateDraft({...templates,postOp:'محلي'},templates,{...templates,postOp:'بعيد'});
 assert.deepEqual(r.conflicts,['postOp']);assert.equal(r.templates.postOp,'محلي');
});
test('a saved acknowledgement equal to the local text is not a conflict',()=>{
 const saved={...templates,postOp:'محفوظ'};assert.deepEqual(mergeWhatsAppTemplateDraft(saved,templates,saved).conflicts,[]);
});
test('simply selecting a recipient is not an unsaved message, but actual text/media/date edits are',()=>{
 const clean={edited:null,link:'',image:null,patientId:'1',date:'',time:''};assert.equal(hasIndividualWhatsAppDraft(clean),false);
 for(const delta of [{edited:''},{link:'https://example.invalid'},{image:{}},{date:'2026-10-21'},{time:'17:00'}])assert.equal(hasIndividualWhatsAppDraft({...clean,...delta}),true);
});
