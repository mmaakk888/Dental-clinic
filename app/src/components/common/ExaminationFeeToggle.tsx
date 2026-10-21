import React from 'react';
import { Check, Plus, Stethoscope } from 'lucide-react';
import './examinationFeeToggle.css';

interface ExaminationFeeToggleProps {
  selected: boolean;
  fee: number;
  onChange: (selected: boolean) => void;
  disabled?: boolean;
}

/** A draft choice only: selecting the fee never records a visit or a receipt. */
export function ExaminationFeeToggle({ selected, fee, onChange, disabled = false }: ExaminationFeeToggleProps) {
  return <div className="examination-fee-control" dir="rtl">
    <button type="button" aria-label="تسجيل الكشف" aria-pressed={selected} disabled={disabled}
      onClick={() => onChange(!selected)} className="examination-fee-toggle">
      <span className="examination-fee-symbol"><Stethoscope aria-hidden="true" /></span>
      <span className="examination-fee-copy"><strong>إضافة كشف</strong><span>بالسعر المحدد في الإعدادات</span></span>
      <bdi>{new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 }).format(fee)} ج.م</bdi>
      <span className="examination-fee-state">{selected ? <Check aria-hidden="true" /> : <Plus aria-hidden="true" />}{selected ? 'مُضاف' : 'إضافة'}</span>
    </button>
    <small>{selected ? 'الكشف مُضاف لهذه الزيارة فقط. اضغط لإلغائه؛ التحصيل يُسجّل منفصلًا.' : 'بدون كشف حاليًا. اضغط لإضافته؛ لا يُحفظ إلا عند حفظ الزيارة.'}</small>
  </div>;
}
