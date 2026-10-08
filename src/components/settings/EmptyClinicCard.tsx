import React, { useRef, useState } from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { useToastAndConfirm, type ConfirmOptions } from '../common/ToastAndConfirm';

interface EmptyClinicCardProps {
  onAuthorize: () => void;
  onClear: () => Promise<void>;
}

/** The parent must hide this control without full-backup/admin access and in
 * privacy mode. Authorization is checked again at both user action boundaries;
 * the persistence callback must independently authorize its confirmed write.
 */
export function EmptyClinicCard({ onAuthorize, onClear }: EmptyClinicCardProps) {
  const { askConfirm, showToast } = useToastAndConfirm();
  const clearingRef = useRef(false);
  const [clearing, setClearing] = useState(false);

  const requestClear = () => {
    if (clearingRef.current) return;
    try { onAuthorize(); }
    catch { showToast('هذه العملية غير متاحة الآن لهذا الحساب أو في وضع الخصوصية.', 'error'); return; }
    const confirmation: ConfirmOptions = {
      title: 'تأكيد بدء عيادة فارغة',
      message: 'سيتم حذف جميع ملفات المرضى وجهات الاتصال والمواعيد والمعامل وحالاتها والجلسات والتحصيلات والمصروفات وحركات الخامات المحلية، سواء كانت تجريبية أو حقيقية. ستبقى حسابات الدخول وكلمات السر والهوية والإعدادات وفهارس الخدمات والأدوية والأسعار وقوالب الرسائل. تأكد من تنزيل نسخة JSON كاملة أولًا؛ لا يمكن التراجع إلا باستعادة نسخة محفوظة. هذه العملية لا تنقل بيانات إلى Firebase ولا تمسح بيانات سحابية.',
      confirmLabel: 'حذف بيانات التشغيل المحلية والبدء فارغًا',
      cancelLabel: 'إلغاء والاحتفاظ بالبيانات',
      tone: 'danger',
      onConfirm: async () => {
        if (clearingRef.current) return;
        clearingRef.current = true; setClearing(true);
        try {
          onAuthorize();
          await onClear();
          showToast('تم بدء عيادة فارغة محليًا مع الاحتفاظ بالحسابات والإعدادات والفهارس.', 'success');
        } catch {
          // Keep the shared confirmation open on failure; do not expose raw
          // storage/authorization errors or imply that deletion was completed.
          throw new Error('تعذر تأكيد بدء عيادة فارغة. لم يُؤكد اكتمال الحذف؛ احتفظ بالنسخة الاحتياطية وراجع البيانات قبل إعادة المحاولة.');
        } finally { clearingRef.current = false; setClearing(false); }
      },
    };
    askConfirm(confirmation);
  };

  return (
    <section aria-labelledby="empty-clinic-title" aria-busy={clearing} className="rounded-2xl border border-rose-200 bg-rose-50/60 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-700"><Trash2 className="h-5 w-5" /></span>
        <div className="min-w-0 space-y-3">
          <div className="space-y-1">
            <h3 id="empty-clinic-title" className="text-base font-bold text-rose-900 font-tajawal">بدء عيادة فارغة</h3>
            <p className="text-sm leading-relaxed text-slate-700">يمسح بيانات التشغيل المحلية: المرضى، جهات الاتصال، المواعيد، المعامل وحالاتها، الجلسات والتحصيلات، المصروفات وحركات الخامات.</p>
          </div>
          <p className="text-sm leading-relaxed text-slate-600">يحتفظ بحسابات الدخول وكلمات السر، اسم العيادة وشعارها ومظهرها، الإعدادات وفهارس الخدمات والأدوية والأسعار وقوالب الرسائل.</p>
          <p className="flex items-start gap-2 text-sm leading-relaxed text-rose-800"><AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" /><span>نزّل نسخة JSON كاملة أولًا من التصدير والاستيراد. لا يكتشف النظام البيانات التجريبية تلقائيًا؛ الحذف يشمل كل بيانات التشغيل المحلية، وليس التجريبية فقط.</span></p>
          <p className="text-xs leading-relaxed text-slate-600">لا يتم الحذف بمجرد فتح هذه البطاقة، ولا تُنقل بيانات إلى Firebase أو تُحذف بيانات سحابية.</p>
          <button type="button" disabled={clearing} onClick={requestClear} className="min-h-[44px] w-full rounded-xl bg-rose-700 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-rose-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-700 disabled:cursor-wait disabled:opacity-60 sm:w-auto">
            {clearing ? 'جارٍ تأكيد الحذف…' : 'مراجعة وتأكيد البدء فارغًا'}
          </button>
        </div>
      </div>
    </section>
  );
}
