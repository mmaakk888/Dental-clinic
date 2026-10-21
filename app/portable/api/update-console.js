/* Immutable protocol-1 rescue UI. No framework, inline JS or patient data. */
let csrf='',job;
const out=document.getElementById('status'),form=document.getElementById('form');
async function read(){const r=await fetch('update.php',{cache:'no-store'}),v=await r.json();csrf=v.csrf||csrf;job=v.result?.job;out.textContent=v.error||job?.message||'لا توجد محاولة تحديث نشطة.';}
void read().catch(()=>{out.textContent='تعذر قراءة الحالة. حدّث الصفحة أو راجع أداة الإنقاذ الخاصة.';});
form.onsubmit=async e=>{
 e.preventDefault();const button=e.submitter;button.disabled=true;
 try{
  const f=new FormData(form);f.set('action',button.value);if(job)f.set('job',job.id);
  if(button.value==='step'&&job?.state==='health'){
   let proof='';try{const h=await fetch('index.php?'+job.healthQuery,{cache:'no-store'}),v=await h.json();if(h.ok&&v.ok&&v.version===job.to)proof=v.proof||'';}catch{/* No health proof means rollback, never success. */}
   f.set('action','health');f.set('proof',proof);
  }
  const r=await fetch('update.php',{method:'POST',headers:{'X-CSRF-Token':csrf},body:f}),v=await r.json();
  if(!r.ok||!v.ok){out.textContent=v.error||'تعذر تأكيد الإجراء.';return;}await read();
 }catch{out.textContent='انقطع الاتصال؛ حدّث الحالة قبل إعادة أي إجراء.';}
 finally{button.disabled=false;}
};
