import React from 'react';
import { ShieldAlert, ArrowRight, Lock } from 'lucide-react';

interface PermissionDeniedCardProps {
  title: string;
  onBackToHome: () => void;
}

export const PermissionDeniedCard: React.FC<PermissionDeniedCardProps> = ({
  title,
  onBackToHome,
}) => {
  return (
    <div className="min-h-[60vh] flex items-center justify-center p-4 font-['Cairo',sans-serif]">
      <div className="bg-white rounded-3xl p-8 max-w-md w-full border border-rose-100 shadow-xl text-center space-y-4 animate-fadeIn">
        <div className="w-16 h-16 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mx-auto shadow-inner">
          <ShieldAlert className="w-8 h-8" />
        </div>

        <div className="space-y-1.5">
          <h3 className="text-lg font-black text-slate-900 font-tajawal">
            صلاحية الوصول غير متاحة
          </h3>
          <p className="text-xs text-slate-500 font-medium leading-relaxed">
            حسابك لا يمتلك صلاحية لعرض قسم <span className="font-bold text-rose-700">"{title}"</span>. يرجى التواصل مع الطبيب المسؤول لمنحك الصلاحيات المناسبة.
          </p>
        </div>

        <div className="pt-2 flex justify-center">
          <button
            type="button"
            onClick={onBackToHome}
            className="px-5 py-2.5 bg-slate-900 hover:bg-black text-white text-xs font-bold rounded-xl transition-all shadow-md cursor-pointer flex items-center gap-2"
          >
            <ArrowRight className="w-4 h-4" />
            <span>العودة للواجهة الرئيسية</span>
          </button>
        </div>
      </div>
    </div>
  );
};

