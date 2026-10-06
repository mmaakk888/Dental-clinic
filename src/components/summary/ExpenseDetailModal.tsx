import React, { useEffect, useRef, useState } from 'react';
import { X, ZoomIn, ZoomOut, RotateCw, Maximize2, Download, Receipt, Building2, Phone, MapPin, Calendar, CreditCard, DollarSign, AlertTriangle, ShieldCheck, Clock, FileText, CheckCircle2, ChevronRight } from 'lucide-react';
import { Expense, ExpenseItem } from '../../types';
import { getExpensePaymentSummary } from '../../utils/expenseUtils';

interface ExpenseDetailModalProps {
  expense: Expense | null;
  isOpen: boolean;
  onClose: () => void;
  onEdit?: (expense: Expense) => void;
  isPrivacyMode?: boolean;
}

export const ExpenseDetailModal: React.FC<ExpenseDetailModalProps> = ({
  expense,
  isOpen,
  onClose,
  onEdit,
  isPrivacyMode = false,
}) => {
  const [zoomLevel, setZoomLevel] = useState(1);
  const [rotationDegree, setRotationDegree] = useState(0);
  const [isFullscreenImage, setIsFullscreenImage] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const fullscreenRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setZoomLevel(1);
    setRotationDegree(0);
    setIsFullscreenImage(false);
  }, [expense?.id, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const priorOverflow = document.body.style.overflow;
    const priorFocus = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    const activeModal = isFullscreenImage ? fullscreenRef.current : modalRef.current;
    activeModal?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (isFullscreenImage) setIsFullscreenImage(false); else onClose();
      }
      if (event.key === 'Tab' && activeModal) {
        const controls = (Array.from(activeModal.querySelectorAll('button, a[href], input, select, textarea, [tabindex="0"]')) as HTMLElement[])
          .filter(element => !element.hasAttribute('disabled') && element.getClientRects().length > 0);
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (!first) { event.preventDefault(); activeModal.focus(); }
        else if (event.shiftKey && (document.activeElement === first || document.activeElement === activeModal)) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = priorOverflow;
      document.removeEventListener('keydown', onKeyDown);
      if (priorFocus?.isConnected) priorFocus.focus();
    };
  }, [isOpen, isFullscreenImage, onClose]);

  if (!isOpen || !expense) return null;
  const financial = getExpensePaymentSummary(expense);

  const handleZoomIn = () => setZoomLevel(prev => Math.min(prev + 0.25, 3));
  const handleZoomOut = () => setZoomLevel(prev => Math.max(prev - 0.25, 0.5));
  const handleResetZoom = () => {
    setZoomLevel(1);
    setRotationDegree(0);
  };
  const handleRotateRight = () => setRotationDegree(prev => (prev + 90) % 360);

  const handleDownloadImage = () => {
    if (!expense.invoiceImageUrl) return;
    const a = document.createElement('a');
    a.href = expense.invoiceImageUrl;
    a.download = `Invoice_${expense.invoiceNumber || expense.id}_${expense.supplierName || 'Supplier'}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const maskMoney = (val?: number) => {
    if (val === undefined || val === null) return '0.00 ج.م';
    if (isPrivacyMode) return '*** ج.م';
    return `${val.toLocaleString()} ${expense.currency || 'ج.م'}`;
  };

  const getPaymentMethodBadge = (method?: string) => {
    switch (method) {
      case 'cash': return <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">نقداً (Cash)</span>;
      case 'card': return <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-800 border border-blue-300">بطاقة / فيزا</span>;
      case 'transfer': return <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-purple-100 text-purple-800 border border-purple-300">تحويل بنكي</span>;
      case 'credit':
      case 'deferred': return <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300">آجل / بالتقسيط</span>;
      default: return <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700">غير محدد</span>;
    }
  };

  return (
    <div onClick={onClose} className="clinic-modal-overlay fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-5 bg-slate-950/75 backdrop-blur-sm animate-fadeIn font-cairo dir-rtl">
      <div ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="expense-detail-title" tabIndex={-1} onClick={(e) => e.stopPropagation()} className="clinic-modal-panel clinic-modal-panel--framed bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-5xl max-h-[92dvh] flex flex-col overflow-hidden">
        
        {/* ERP Invoice Header */}
        <div className="shrink-0 p-4 sm:p-5 bg-gradient-to-r from-slate-950 via-slate-900 to-indigo-950 text-white flex flex-wrap gap-3 items-center justify-between border-b border-slate-800">
          <div className="flex min-w-0 items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-300 shadow-inner">
              <Receipt className="w-6 h-6" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 id="expense-detail-title" className="text-base sm:text-lg font-black break-words">{expense.supplierName || expense.title}</h3>
                {expense.invoiceNumber && (
                  <span className="bg-indigo-500/30 text-indigo-200 text-xs px-2.5 py-0.5 rounded-md font-mono border border-indigo-400/30">
                    {expense.invoiceNumber}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-300 flex items-center gap-3 mt-0.5">
                <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5 text-indigo-300" /> {expense.invoiceDate || expense.date}</span>
                {expense.invoiceTime && <span>• {expense.invoiceTime}</span>}
                {expense.taxNumber && <span className="hidden sm:inline">• ضريبي: {expense.taxNumber}</span>}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {onEdit && (
              <button
                type="button"
                onClick={() => { onClose(); onEdit(expense); }}
                className="px-3.5 py-2 text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl transition cursor-pointer shadow-xs"
              >
                تعديل البيانات
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="إغلاق تفاصيل الفاتورة"
              className="p-2 min-h-11 min-w-11 rounded-xl text-slate-300 hover:text-white hover:bg-white/10 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          
          {/* Supplier Info & Quick Status Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/90 flex flex-col justify-between">
              <div>
                <span className="text-[11px] font-bold text-slate-500 flex items-center gap-1.5 mb-1">
                  <Building2 className="w-3.5 h-3.5 text-slate-600" /> معلومات المورد والشركة
                </span>
                <p className="text-sm font-black text-slate-800">{expense.supplierName || 'شركة توريدات غير مسجلة'}</p>
                {expense.supplierPhone && (
                  <p className="text-xs font-bold text-slate-600 flex items-center gap-1 mt-1">
                    <Phone className="w-3 h-3 text-emerald-600" /> {expense.supplierPhone}
                  </p>
                )}
                {expense.supplierAddress && (
                  <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                    <MapPin className="w-3 h-3 text-indigo-600" /> {expense.supplierAddress}
                  </p>
                )}
              </div>
              <div className="mt-3 pt-2 border-t border-slate-200/80 flex items-center justify-between text-xs font-bold text-slate-600">
                <span>سجل تجاري: {expense.commercialRecord || 'غير متوفر'}</span>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/90 flex flex-col justify-between">
              <div>
                <span className="text-[11px] font-bold text-slate-500 flex items-center gap-1.5 mb-1">
                  <CreditCard className="w-3.5 h-3.5 text-slate-600" /> طريقة السداد والحالة
                </span>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {getPaymentMethodBadge(expense.paymentMethod)}
                  <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-indigo-50 text-indigo-800 border border-indigo-200">
                    {expense.category === 'supplies' ? 'خامات ومستلزمات' : expense.category === 'fixed' ? 'مصروفات ثابتة' : expense.category === 'maintenance' ? 'صيانة' : 'أخرى'}
                  </span>
                </div>
              </div>
              <div className="mt-3 pt-2 border-t border-slate-200/80 flex items-center justify-between text-xs font-bold">
                <span className="text-slate-500">الرقم الضريبي:</span>
                <span className="text-slate-800 font-mono">{expense.taxNumber || 'غير مسجل'}</span>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-gradient-to-br from-indigo-900 to-slate-900 text-white flex flex-col justify-between shadow-xs">
              <div>
                <span className="text-[11px] font-bold text-indigo-200/80">إجمالي صافي الفاتورة</span>
                <p className="text-2xl font-black text-emerald-400 mt-0.5">{maskMoney(expense.amount)}</p>
              </div>
              <div className="mt-3 pt-2 border-t border-white/10 flex items-center justify-between text-xs font-bold text-indigo-100">
                <span>المبلغ المدفوع: {maskMoney(financial.paid)}</span>
                {financial.remaining > 0 ? (
                  <span className="text-amber-300 font-extrabold">المتبقي: {maskMoney(financial.remaining)}</span>
                ) : (
                  <span className="text-emerald-300 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> مسددة بالكامل</span>
                )}
              </div>
            </div>
          </div>

          {/* Price Variance Alerts Banner if present */}
          {expense.priceVarianceAlerts && expense.priceVarianceAlerts.length > 0 && (
            <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-300 text-amber-900 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-xs space-y-1">
                <h4 className="font-bold text-amber-950">تنبيه اختلاف وتغير أسعار التوريدات عن المرات السابقة:</h4>
                <ul className="list-disc list-inside space-y-0.5 font-medium">
                  {expense.priceVarianceAlerts.map((alert, idx) => (
                    <li key={idx}>
                      مادة <span className="font-bold">{alert.itemName}</span>: ارتفع السعر من <span className="line-through text-slate-500">{alert.previousPrice} ج.م</span> إلى <span className="font-bold text-rose-700">{alert.currentPrice} ج.م</span> (زيادة {alert.percentageIncrease}%)
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* High-Resolution Interactive Image Lightbox Viewer */}
          {expense.invoiceImageUrl ? (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2 items-center justify-between px-1">
                <h4 className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <FileText className="w-4 h-4 text-indigo-600" /> صورة الفاتورة المستند الأصلي
                </h4>
                <div className="flex flex-wrap items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200">
                  <button type="button" onClick={handleZoomIn} className="p-1.5 hover:bg-white rounded-lg text-slate-700 transition cursor-pointer" title="تكبير">
                    <ZoomIn className="w-4 h-4" />
                  </button>
                  <button type="button" onClick={handleZoomOut} className="p-1.5 hover:bg-white rounded-lg text-slate-700 transition cursor-pointer" title="تصغير">
                    <ZoomOut className="w-4 h-4" />
                  </button>
                  <button type="button" onClick={handleRotateRight} className="p-1.5 hover:bg-white rounded-lg text-slate-700 transition cursor-pointer" title="تدوير">
                    <RotateCw className="w-4 h-4" />
                  </button>
                  <button type="button" onClick={handleResetZoom} className="px-2 py-1 hover:bg-white rounded-lg text-xs font-bold text-slate-600 transition cursor-pointer">
                    إعادة ضبط
                  </button>
                  <button type="button" onClick={() => setIsFullscreenImage(true)} className="p-1.5 hover:bg-white rounded-lg text-indigo-600 transition cursor-pointer" title="ملء الشاشة">
                    <Maximize2 className="w-4 h-4" />
                  </button>
                  <button type="button" onClick={handleDownloadImage} className="p-1.5 hover:bg-white rounded-lg text-emerald-600 transition cursor-pointer" title="تنزيل الصورة">
                    <Download className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="relative bg-slate-950 rounded-2xl border border-slate-800 p-4 min-h-[220px] max-h-[380px] overflow-auto flex items-center justify-center">
                <img
                  src={expense.invoiceImageUrl}
                  alt="صورة الفاتورة الأصلية"
                  className="object-contain transition-transform duration-200 max-h-[340px]"
                  style={{
                    transform: `scale(${zoomLevel}) rotate(${rotationDegree}deg)`,
                  }}
                />
              </div>
            </div>
          ) : (
            <div className="p-4 rounded-2xl bg-slate-50 border border-dashed border-slate-300 text-center text-xs text-slate-500">
              لا توجد صورة مرفقة لهذه الفاتورة
            </div>
          )}

          {/* Structured Line Items Table */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <Receipt className="w-4 h-4 text-emerald-600" /> جدول الأصناف والبنود تفصيلياً ({expense.items?.length || 0} صنف)
              </h4>
            </div>

            {expense.items && expense.items.length > 0 ? (
              <div className="overflow-x-auto rounded-2xl border border-slate-200 shadow-2xs bg-white">
                <table className="w-full text-right text-xs">
                  <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                    <tr>
                      <th className="p-3">#</th>
                      <th className="p-3">اسم الصنف / المادة</th>
                      <th className="p-3 text-center">الكمية</th>
                      <th className="p-3 text-center">الوحدة</th>
                      <th className="p-3 text-center">سعر الوحدة</th>
                      <th className="p-3 text-center">الخصم</th>
                      <th className="p-3 text-center">الضريبة</th>
                      <th className="p-3 text-left">إجمالي الصنف</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium text-slate-800">
                    {expense.items.map((item, idx) => (
                      <tr key={item.id || idx} className="hover:bg-slate-50/80 transition-colors">
                        <td className="p-3 font-mono text-slate-400">{idx + 1}</td>
                        <td className="p-3 font-bold text-slate-900">
                          {item.itemName}
                          {item.notes && <span className="block text-[11px] font-normal text-slate-500 mt-0.5">{item.notes}</span>}
                        </td>
                        <td className="p-3 text-center font-bold">{item.quantity}</td>
                        <td className="p-3 text-center text-slate-600">{item.unit || 'قطع'}</td>
                        <td className="p-3 text-center font-mono">{maskMoney(item.unitPrice)}</td>
                        <td className="p-3 text-center font-mono text-amber-700">{item.discount ? maskMoney(item.discount) : '-'}</td>
                        <td className="p-3 text-center font-mono text-indigo-700">{item.tax ? maskMoney(item.tax) : '-'}</td>
                        <td className="p-3 text-left font-black text-emerald-700 font-mono">{maskMoney(item.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-4 text-center rounded-2xl bg-slate-50 border border-slate-200 text-xs text-slate-500">
                لم تُسجل أصناف هذه الفاتورة بشكل منفصل؛ المبلغ الإجمالي فقط مسجل
              </div>
            )}
          </div>

          {/* Financial Breakdown Summary */}
          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-2 text-xs">
            {expense.subtotal !== undefined && <div className="flex justify-between text-slate-600">
              <span>الإجمالي الفرعي قبل الضريبة والخصم:</span>
              <span className="font-mono font-bold">{maskMoney(expense.subtotal)}</span>
            </div>}
            {Boolean(expense.discount) && (
              <div className="flex justify-between text-amber-700">
                <span>إجمالي الخصم التجاري:</span>
                <span className="font-mono font-bold">- {expense.discountType === 'percentage' ? `${isPrivacyMode ? '***' : expense.discount}%` : maskMoney(expense.discount)}</span>
              </div>
            )}
            {Boolean(expense.tax) && (
              <div className="flex justify-between text-indigo-700">
                <span>ضريبة القيمة المضافة (VAT):</span>
                <span className="font-mono font-bold">+ {maskMoney(expense.tax)}</span>
              </div>
            )}
            <div className="pt-2 border-t border-slate-300 flex justify-between text-sm font-black text-slate-900">
              <span>الصافي الإجمالي النهائي:</span>
              <span className="text-emerald-700 text-base">{maskMoney(expense.amount)}</span>
            </div>
          </div>

          {/* Notes & Audit Log */}
          {expense.note && (
            <div className="p-3.5 rounded-2xl bg-slate-100/80 border border-slate-200 text-xs text-slate-700">
              <span className="font-bold text-slate-900">ملاحظات وشروط الفاتورة: </span>
              {expense.note}
            </div>
          )}

          {expense.auditLog && expense.auditLog.length > 0 && (
            <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200 space-y-1.5">
              <span className="text-[11px] font-bold text-slate-500 flex items-center gap-1">
                <Clock className="w-3 h-3" /> سجل التعديلات والعمليات:
              </span>
              <div className="text-[11px] text-slate-600 space-y-1">
                {expense.auditLog.map((log) => (
                  <div key={log.id} className="flex items-center justify-between">
                    <span>• {log.action} بواسطة {log.user}</span>
                    <span className="text-slate-400 font-mono">{log.timestamp}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="shrink-0 p-4 bg-slate-50 border-t border-slate-200 flex flex-wrap gap-2 items-center justify-between">
          <span className="text-xs text-slate-500 font-medium break-all">معرّف الفاتورة: {expense.id}</span>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 text-xs font-bold bg-slate-800 hover:bg-slate-900 text-white rounded-xl transition cursor-pointer shadow-xs"
          >
            إغلاق
          </button>
        </div>
      </div>

      {/* Fullscreen Image Overlay */}
      {isFullscreenImage && expense.invoiceImageUrl && (
        <div ref={fullscreenRef} role="dialog" aria-modal="true" aria-label="صورة الفاتورة كاملة" tabIndex={-1} onClick={event => event.stopPropagation()} className="fixed inset-0 z-[70] h-dvh bg-slate-950/95 flex flex-col p-4 animate-fadeIn">
          <div className="shrink-0 flex items-center justify-between gap-3 text-white pb-3 border-b border-slate-800">
            <h4 className="min-w-0 break-words text-sm font-bold">{expense.supplierName || 'صورة الفاتورة الأصلية'}</h4>
            <div className="shrink-0 flex items-center gap-2">
              <button type="button" onClick={handleDownloadImage} className="p-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl transition cursor-pointer" title="تنزيل">
                <Download className="w-4 h-4" />
              </button>
              <button type="button" onClick={() => setIsFullscreenImage(false)} className="p-2 bg-white/10 hover:bg-white/20 text-white rounded-xl transition cursor-pointer" title="إغلاق">
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1 flex items-center justify-center p-4 overflow-auto">
            <img src={expense.invoiceImageUrl} alt="صورة الفاتورة كاملة" className="object-contain max-h-full max-w-full" />
          </div>
        </div>
      )}
    </div>
  );
};
