import React from 'react';
import { ShieldCheck } from 'lucide-react';

/** Static closed entry: no Auth SDK, local accounts or clinical storage. */
export default function CloudUnavailablePage() {
  return <main dir="rtl" className="min-h-dvh bg-slate-50 p-4 text-slate-900 grid place-items-center">
    <section className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm space-y-4" aria-labelledby="cloud-unavailable-title">
      <ShieldCheck size={32} aria-hidden="true" className="text-indigo-600" />
      <h1 id="cloud-unavailable-title" className="text-xl sm:text-2xl font-extrabold">التشغيل السحابي لم يُفعّل بعد</h1>
      <p role="alert" className="text-base leading-8 text-slate-600">يلزم إكمال ربط الدخول والحفظ والصلاحيات واختبارها قبل استخدام الموقع خارج اللاب. لم تُفتح ملفات المرضى أو الحسابات المحلية من هذا المدخل.</p>
      <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-7 text-amber-950">لا تدخل بيانات حقيقية هنا، ولا تغيّر قواعد Firebase لتجاوز هذه الرسالة.</p>
      <p className="text-sm leading-7 text-slate-500">إذا كنت على اللاب، افتح رابط التشغيل المحلي الصحيح. رابط تجهيز غير صحيح أو متكرر يُرفض أيضًا لحماية الفصل بين النسختين.</p>
    </section>
  </main>;
}
