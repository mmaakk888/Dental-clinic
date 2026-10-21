import React from 'react';
import {LoaderCircle} from 'lucide-react';
export function ScreenLoader({label='جارٍ تحميل الشاشة…'}:{label?:string}) {
  return <div className="clinic-screen-loader" role="status" aria-live="polite" aria-busy="true" dir="rtl">
    <LoaderCircle className="clinic-loader-icon" aria-hidden="true" />
    <p>{label}</p><small>نجهّز العرض فقط؛ لم يتم تسجيل أي عملية.</small>
  </div>;
}
