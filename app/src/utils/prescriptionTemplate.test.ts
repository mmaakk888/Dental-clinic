import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DEFAULT_PRESCRIPTION_DESIGN,normalizePrescriptionDesign,normalizePrescriptionTemplate,validatePrescriptionTemplate,prescriptionContrastColor} from './prescriptionTemplate';
import {prescriptionDraftSignature,validatePrescriptionDraft} from './prescriptionRecords';
import type {PrescriptionDraft} from '../types';
const draft=():PrescriptionDraft=>({date:'2026-10-21',sessionId:null,diagnosis:'',items:[{id:'synthetic',drugName:'اسم اختبار',dosage:'اختبار فقط',duration:''}],instructions:'',header:normalizePrescriptionTemplate().header});
test('missing template keeps the established A5 design and never seeds a doctor or patient',()=>{
 const t=normalizePrescriptionTemplate();assert.deepEqual(t.design,DEFAULT_PRESCRIPTION_DESIGN);assert.equal(t.header.doctorName,'');assert.equal(t.header.phone,'');validatePrescriptionTemplate(t);
 const legacy=normalizePrescriptionTemplate(undefined,{doctorName:'طبيب مصطنع',phone:'01000000000',address:'عنوان اختبار'});assert.equal(legacy.header.doctorName,'طبيب مصطنع');
});
test('design accepts only bounded controls, never arbitrary CSS, fonts, URLs or unsupported types',()=>{
 const t=normalizePrescriptionTemplate();assert.throws(()=>validatePrescriptionTemplate({...t,design:{...t.design,primaryColor:'url(https://invalid.test)'}}));
 for(const bad of [{fontFamily:'https://invalid.test'},{fontSize:1000},{showLogo:'yes'},{logoPosition:'rotate'},{footerNote:'x'.repeat(301)}])assert.deepEqual(normalizePrescriptionDesign(bad),{...DEFAULT_PRESCRIPTION_DESIGN});
 assert.equal(prescriptionContrastColor('#ffffff'),'#152536');assert.equal(prescriptionContrastColor('#000000'),'#ffffff');
});
test('a saved prescription signature includes its own design, independent of new clinic defaults',()=>{
 const a=draft();assert.equal(prescriptionDraftSignature(a),prescriptionDraftSignature({...a,design:{...DEFAULT_PRESCRIPTION_DESIGN}}));
 const edited={...a,design:{...DEFAULT_PRESCRIPTION_DESIGN,primaryColor:'#123456'}};assert.notEqual(prescriptionDraftSignature(a),prescriptionDraftSignature(edited));
 assert.equal(normalizePrescriptionDesign(a.design).primaryColor,'#1a4388');
});
test('clinical output and server save share drug/text/date limits without silently truncating',()=>{
 validatePrescriptionDraft(draft());for(const bad of [{date:'2026-02-30'},{items:[]},{items:Array(65).fill(draft().items[0])},{diagnosis:'x'.repeat(4001)},{items:[{...draft().items[0],drugName:'x'.repeat(201)}]}])assert.throws(()=>validatePrescriptionDraft({...draft(),...bad}));
});
test('template is owner-only, saved in SQL, included in backup and snapshot of each new Rx',()=>{
 const settings=fs.readFileSync('src/components/settings/SettingsView.tsx','utf8'),domain=fs.readFileSync('portable/api/domain.php','utf8'),core=fs.readFileSync('portable/api/core.php','utf8');
 assert.match(settings,/section.key === 'prescription' \? .*\['doctor','admin'\]/);assert.match(domain,/case 'settings.prescription':permit\(\$u,\$action\)/);assert.doesNotMatch(core,/'settings.prescription'=>'controlPanel'/);
 assert.match(domain,/'design'=>\$design/);assert.match(fs.readFileSync('portable/api/importer.php','utf8'),/validatePrescriptionTemplate\(\$backup\['prescriptionTemplate'\]\)/);
 const rx=fs.readFileSync('src/components/patient/PrescriptionAndInstructionsView.tsx','utf8');assert.match(rx,/design: rxDesign/);assert.match(rx,/createPrescriptionDocument\(imageData, paperRef\)/);assert.match(rx,/renderPrescriptionImage\(imageData, canPrint, onAuthorizePrint, paperRef.current\)/);
});
test('patient money stays hidden in privacy mode, including expanded receipts',()=>{
 const file=fs.readFileSync('src/components/patient/PatientFileView.tsx','utf8');assert.match(file,/!isPrivacyMode && canViewRemainingBalance && \(!s.paymentsLog/);assert.match(file,/canRevealRemainingBalance && <section className="patient-receipt-timeline"/);assert.match(file,/visibleSessions.map\(\(\{session:s,number\}\)/);
});
