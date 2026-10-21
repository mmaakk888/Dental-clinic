/** Only called by the synthetic HTTP/SQL harness. No external message or production config. */
export async function testSettings({a,check}) {
 let r=await a.request();const original=r.data.snapshot.settings,domain=JSON.stringify(r.data.snapshot.domain);
 const catalog=original.serviceCatalog;
 r=await a.mutation('settings.catalog',{value:{...catalog,serviceTypes:[],clinicalPrices:{},examinationFee:150.25}});
 check(r.data.ok&&r.data.snapshot.settings.serviceCatalog.serviceTypes.length===0&&r.data.snapshot.settings.serviceCatalog.examinationFee===150.25,'empty clinical catalog can configure examination fee');
 check(JSON.stringify(r.data.snapshot.domain)===domain,'future pricing does not change historical services receipts balances or lab accounts');
 for(const value of [
  {...catalog,serviceTypes:'invalid'},
  {...catalog,serviceTypes:['إزالة','ازالة']},
  {...catalog,examinationFee:-1},
  {...catalog,crownPrices:{...catalog.crownPrices,'خاطئ':'100'}},
  {...catalog,clinicalPrices:{'خاطئ':10000001}},
  {...catalog,crownPrices:{}},
 ]) {r=await a.mutation('settings.catalog',{value});check(r.response.status===400&&r.data.safeToEdit,'server rejects malformed duplicate missing historical or invalid catalog prices');}
 r=await a.mutation('settings.catalog',{value:catalog});check(r.data.ok,'restore original synthetic catalog after validation checks');
 const whatsapp={templates:{newAppt:'أهلًا {patientName} من {clinicName}'},campaignConsent:{'201012345678':'declined'},senderNumber:'',apiKey:'',webhookUrl:'',autoConfirmOnAppt:false,autoRemind24h:false,autoPostOpOnAttended:false};
 r=await a.mutation('settings.whatsapp',{value:whatsapp});check(r.data.ok,'valid manual templates and actual consent save');r=await a.request();check(r.data.snapshot.settings.whatsappSettings.templates.newAppt===whatsapp.templates.newAppt&&r.data.snapshot.settings.whatsappSettings.campaignConsent['201012345678']==='declined','WhatsApp templates and consent survive new SQL read');
 for(const value of [
  {...whatsapp,templates:42},
  {...whatsapp,templates:{unknown:'خاطئ'}},
  {...whatsapp,templates:{newAppt:'x'.repeat(8001)}},
  {...whatsapp,campaignConsent:{'01012345678':'allowed'}},
  {...whatsapp,campaignConsent:{'201012345678':'yes'}},
  {...whatsapp,apiKey:'must-not-be-stored'},
  {...whatsapp,autoRemind24h:true},
 ]) {r=await a.mutation('settings.whatsapp',{value});check(r.response.status===400&&r.data.safeToEdit,'server rejects malformed consent templates secrets or fake automation');}
 r=await a.mutation('settings.whatsapp',{value:original.whatsappSettings});check(r.data.ok,'restore original synthetic WhatsApp settings');
 check(JSON.stringify(r.data.snapshot.domain)===domain,'settings validation never changes patient or supplier ledgers');
}
