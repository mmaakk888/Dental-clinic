import React,{useEffect,useState} from 'react';
import {AppContent} from '../App';
import {ToastAndConfirmProvider} from '../components/common/ToastAndConfirm';
import {PortableContext,createPortableRuntime} from './runtime';
import {ScreenLoader} from '../components/common/ScreenLoader';
const runtime=createPortableRuntime(new URL('./api/index.php',document.baseURI));
export default function PortableRoot(){
 const [ready,setReady]=useState(false),[error,setError]=useState(''),[,redraw]=useState(0);
 useEffect(()=>runtime.subscribe(()=>redraw(value=>value+1)),[]);
 useEffect(()=>{let live=true;runtime.refresh().then(()=>{if(live)setReady(true);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[]);
 useEffect(()=>{const timer=setInterval(()=>{if(document.visibilityState==='visible'&&runtime.currentUser()&&!runtime.pending())void runtime.refresh().then(()=>setError('')).catch(e=>setError(e.message));},60000);return()=>clearInterval(timer);},[]);
 if(!ready)return <main dir="rtl" className="clinic-startup"><section className="clinic-status-card">{error?<><h1>تعذّر الاتصال بالعيادة</h1><p role="alert">{error}</p><button className="clinic-next-action" type="button" onClick={()=>{setError('');void runtime.refresh().then(()=>setReady(true)).catch(e=>setError(e.message));}}>إعادة الاتصال</button><p><a href="./api/update.php?console=1">متابعة التحديث أو الإنقاذ الآمن</a></p>{!error.includes('تحديث النظام')&&<p><a href="./install.html">فحص التثبيت لأول مرة فقط</a></p>}</>:<ScreenLoader label="جارٍ الاتصال بخادم العيادة…"/>}</section></main>;
 return <PortableContext.Provider value={runtime}><ToastAndConfirmProvider>{error&&runtime.currentUser()&&<aside role="status" dir="rtl" className="bg-amber-50 p-3 text-amber-950">تعذر تحديث بيانات الخادم. آخر نسخة مؤكدة معروضة للقراءة؛ لا تعتبر أي حفظ جديد ناجحًا دون تأكيد. <button onClick={()=>void runtime.refresh().then(()=>setError('')).catch(e=>setError(e.message))}>إعادة التحديث</button></aside>}{runtime.error()&&<aside role="alert" dir="rtl" className="sticky top-0 z-[200] bg-amber-50 p-4 text-amber-950">{runtime.error()} {runtime.pending()&&<><button onClick={()=>void runtime.retry().catch(()=>{})}>إعادة المحاولة أو التحقق</button> <button onClick={()=>void runtime.cancel().catch(()=>{})}>تحقق وإغلاق المحاولة</button></>}</aside>}<AppContent runtime={runtime}/></ToastAndConfirmProvider></PortableContext.Provider>;
}
