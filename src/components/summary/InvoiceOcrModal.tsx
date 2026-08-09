import React, { useState, useEffect } from 'react';
import { Camera, Sparkles, Check, Trash2, X, FileText, Upload, Plus, Copy, AlertTriangle, HelpCircle, Calculator, Building2, Phone, CreditCard, DollarSign, Layers, Calendar, Clock, RefreshCw, ZoomIn, ZoomOut, RotateCw } from 'lucide-react';
import { AiService, ExtractedInvoice } from '../../services/aiService';
import { Expense, ExpenseItem, PriceVarianceAlert } from '../../types';

interface InvoiceOcrModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveExpense: (expense: Omit<Expense, 'id'>) => void;
  existingExpenses?: Expense[];
}

export const InvoiceOcrModal: React.FC<InvoiceOcrModalProps> = ({
  isOpen,
  onClose,
  onSaveExpense,
  existingExpenses = [],
}) => {
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isExtracting, setIsExtracting] = useState<boolean>(false);
  const [extractedData, setExtractedData] = useState<ExtractedInvoice | null>(null);

  // Supplier & Invoice Header Form State
  const [title, setTitle] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [supplierPhone, setSupplierPhone] = useState('');
  const [supplierAddress, setSupplierAddress] = useState('');
  const [taxNumber, setTaxNumber] = useState('');
  const [commercialRecord, setCommercialRecord] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [invoiceTime, setInvoiceTime] = useState<string>('12:00');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'transfer' | 'credit' | 'deferred'>('cash');
  const [category, setCategory] = useState<'supplies' | 'fixed' | 'maintenance' | 'other'>('supplies');
  const [currency, setCurrency] = useState('ج.م');
  const [notes, setNotes] = useState('');

  // Financial Breakdown State
  const [subtotal, setSubtotal] = useState<number | ''>('');
  const [discount, setDiscount] = useState<number | ''>('');
  const [tax, setTax] = useState<number | ''>('');
  const [totalAmount, setTotalAmount] = useState<number | ''>('');
  const [paidAmount, setPaidAmount] = useState<number | ''>('');
  const [remainingAmount, setRemainingAmount] = useState<number | ''>('');

  // Structured Line Items State
  const [lineItems, setLineItems] = useState<ExpenseItem[]>([]);

  // Confidence & Validation Alerts
  const [fieldConfidence, setFieldConfidence] = useState<Record<string, number>>({});
  const [priceVarianceAlerts, setPriceVarianceAlerts] = useState<PriceVarianceAlert[]>([]);

  // Image Zoom State
  const [zoomLevel, setZoomLevel] = useState(1);
  const [rotationDegree, setRotationDegree] = useState(0);

  if (!isOpen) return null;

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = reader.result as string;
        setImagePreview(base64);
        setIsExtracting(true);

        const data = await AiService.extractInvoice(base64, file.type || 'image/jpeg');
        setExtractedData(data);

        // Populate fields
        setSupplierName(data.supplierName || 'شركة توريدات طبيّة');
        setTitle(data.supplierName || 'فاتورة توريد مستلزمات');
        if (data.supplierPhone) setSupplierPhone(data.supplierPhone);
        if (data.supplierAddress) setSupplierAddress(data.supplierAddress);
        if (data.taxNumber) setTaxNumber(data.taxNumber);
        if (data.commercialRecord) setCommercialRecord(data.commercialRecord);
        if (data.invoiceNumber) setInvoiceNumber(data.invoiceNumber);
        if (data.invoiceDate) setInvoiceDate(data.invoiceDate);
        if (data.invoiceTime) setInvoiceTime(data.invoiceTime);
        if (data.paymentMethod) setPaymentMethod(data.paymentMethod as any);
        if (data.category) setCategory(data.category as any);
        if (data.currency) setCurrency(data.currency);
        if (data.notes) setNotes(data.notes);

        // Amounts
        const netTotal = data.totalAmount || 0;
        setTotalAmount(netTotal);
        setSubtotal(data.subtotal || netTotal);
        setDiscount(data.discount || 0);
        setTax(data.tax || 0);
        setPaidAmount(data.paidAmount ?? netTotal);
        setRemainingAmount(data.remainingAmount ?? 0);

        // Line Items
        if (data.lineItems && data.lineItems.length > 0) {
          const formattedItems: ExpenseItem[] = data.lineItems.map((item, idx) => ({
            id: `item-${Date.now()}-${idx}`,
            itemName: item.itemName,
            quantity: item.quantity || 1,
            unit: item.unit || 'علبة',
            unitPrice: item.unitPrice || item.total || 0,
            discount: item.discount || 0,
            tax: item.tax || 0,
            total: item.total || (item.quantity * item.unitPrice) || 0,
            notes: item.notes || '',
            confidence: item.confidence || 90,
          }));
          setLineItems(formattedItems);
        } else {
          // Default initial single line item
          setLineItems([
            {
              id: `item-${Date.now()}-0`,
              itemName: data.supplierName || 'توريدات ومعدات عيادة',
              quantity: 1,
              unit: 'دفعة',
              unitPrice: netTotal,
              discount: 0,
              tax: 0,
              total: netTotal,
              confidence: 85,
            },
          ]);
        }

        if (data.fieldConfidence) {
          setFieldConfidence(data.fieldConfidence);
        }

        setIsExtracting(false);
      };
      reader.readAsDataURL(file);
    }
  };

  // Re-calculate Line Item Total
  const updateLineItem = (id: string, field: keyof ExpenseItem, val: any) => {
    setLineItems(prev => prev.map(item => {
      if (item.id !== id) return item;
      const updated = { ...item, [field]: val };
      
      const qty = Number(updated.quantity) || 1;
      const price = Number(updated.unitPrice) || 0;
      const disc = Number(updated.discount) || 0;
      const tx = Number(updated.tax) || 0;
      
      updated.total = Math.max(0, (qty * price) - disc + tx);
      return updated;
    }));
  };

  const handleAddLineItem = () => {
    setLineItems(prev => [
      ...prev,
      {
        id: `item-${Date.now()}-${prev.length}`,
        itemName: '',
        quantity: 1,
        unit: 'علبة',
        unitPrice: 0,
        discount: 0,
        tax: 0,
        total: 0,
        confidence: 100,
      }
    ]);
  };

  const handleDeleteLineItem = (id: string) => {
    setLineItems(prev => prev.filter(item => item.id !== id));
  };

  const handleDuplicateLineItem = (item: ExpenseItem) => {
    setLineItems(prev => [
      ...prev,
      {
        ...item,
        id: `item-${Date.now()}-${prev.length}`,
        itemName: `${item.itemName} (نسخة)`,
      }
    ]);
  };

  // Calculate sum of line items
  const itemsSum = lineItems.reduce((acc, item) => acc + (item.total || 0), 0);
  const totalVal = typeof totalAmount === 'number' ? totalAmount : 0;
  const isSumDiscrepancy = lineItems.length > 0 && Math.abs(itemsSum - totalVal) > 0.5;

  const handleAutoFixNetTotal = () => {
    setTotalAmount(itemsSum);
    setSubtotal(itemsSum);
  };

  // Check Price Variance against previous purchases
  useEffect(() => {
    if (lineItems.length === 0 || existingExpenses.length === 0) {
      setPriceVarianceAlerts([]);
      return;
    }

    const alerts: PriceVarianceAlert[] = [];

    lineItems.forEach(item => {
      if (!item.itemName.trim() || item.unitPrice <= 0) return;

      const matchedPastItems: { price: number; date: string }[] = [];
      existingExpenses.forEach(exp => {
        if (exp.items && exp.items.length > 0) {
          exp.items.forEach(past => {
            if (past.itemName.trim().toLowerCase() === item.itemName.trim().toLowerCase() && past.unitPrice > 0) {
              matchedPastItems.push({ price: past.unitPrice, date: exp.invoiceDate || exp.date });
            }
          });
        }
      });

      if (matchedPastItems.length > 0) {
        matchedPastItems.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        const lastPrice = matchedPastItems[0].price;
        if (item.unitPrice > lastPrice) {
          const increasePercent = Math.round(((item.unitPrice - lastPrice) / lastPrice) * 100);
          alerts.push({
            itemName: item.itemName,
            previousPrice: lastPrice,
            currentPrice: item.unitPrice,
            percentageIncrease: increasePercent,
            unit: item.unit,
            lastPurchaseDate: matchedPastItems[0].date,
          });
        }
      }
    });

    setPriceVarianceAlerts(alerts);
  }, [lineItems, existingExpenses]);

  const handleSave = () => {
    const finalAmount = typeof totalAmount === 'number' ? totalAmount : itemsSum;
    if (finalAmount <= 0) return;

    const finalSupplier = supplierName.trim() || title.trim() || 'مورد مستلزمات طبية';

    onSaveExpense({
      title: finalSupplier,
      supplierName: finalSupplier,
      supplierPhone: supplierPhone.trim() || undefined,
      supplierAddress: supplierAddress.trim() || undefined,
      taxNumber: taxNumber.trim() || undefined,
      commercialRecord: commercialRecord.trim() || undefined,
      invoiceNumber: invoiceNumber.trim() || undefined,
      invoiceDate,
      invoiceTime,
      paymentMethod,
      category,
      amount: finalAmount,
      subtotal: typeof subtotal === 'number' ? subtotal : finalAmount,
      discount: typeof discount === 'number' ? discount : 0,
      tax: typeof tax === 'number' ? tax : 0,
      paidAmount: typeof paidAmount === 'number' ? paidAmount : finalAmount,
      remainingAmount: typeof remainingAmount === 'number' ? remainingAmount : 0,
      currency,
      date: invoiceDate,
      note: notes.trim() || undefined,
      invoiceImageUrl: imagePreview || undefined,
      isFixed: category === 'fixed',
      items: lineItems,
      confidenceScores: fieldConfidence,
      priceVarianceAlerts,
      auditLog: [
        {
          id: `log-${Date.now()}`,
          action: 'إنشاء واستخراج مسح الفاتورة بالذكاء الاصطناعي',
          user: 'الطبيب / مسؤول العيادة',
          timestamp: new Date().toLocaleString('ar-EG'),
        }
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    onClose();
  };

  const getConfidenceBadge = (score?: number) => {
    if (!score) return null;
    if (score >= 80) {
      return (
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-emerald-100 text-emerald-800 border border-emerald-300">
          دقة {score}%
        </span>
      );
    }
    return (
      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-900 border border-amber-300 animate-pulse">
        مراجعة ({score}%)
      </span>
    );
  };

  return (
    <div onClick={onClose} className="fixed inset-0 z-[70] flex items-center justify-center p-2 sm:p-4 bg-slate-950/70 backdrop-blur-sm animate-fadeIn font-cairo dir-rtl">
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">
        
        {/* Header */}
        <div className="p-4 sm:p-5 bg-gradient-to-r from-emerald-950 via-slate-900 to-indigo-950 text-white flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center text-emerald-300 shadow-inner">
              <Camera className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-black">المسح والتصنيف الذكي لفواتير الموردين (ERP Invoice OCR)</h3>
              <p className="text-xs text-emerald-200/80">تصوير الفاتورة واستخراج جميع البنود، الضريبة، والمورد آلياً</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-xl text-slate-300 hover:text-white hover:bg-white/10 transition cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          
          {/* Image Uploader Area if no preview */}
          {!imagePreview ? (
            <div className="border-2 border-dashed border-emerald-300 hover:border-emerald-500 bg-emerald-50/40 rounded-3xl p-10 text-center transition cursor-pointer relative shadow-xs group">
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleImageUpload}
                className="absolute inset-0 opacity-0 cursor-pointer"
              />
              <div className="w-16 h-16 mx-auto bg-emerald-100 text-emerald-800 rounded-2xl flex items-center justify-center mb-4 shadow-sm group-hover:scale-105 transition-transform">
                <Camera className="w-8 h-8" />
              </div>
              <h4 className="text-base font-black text-slate-800">التقاط صورة الفاتورة بكاميرا الجوال أو رفع ملف مستند</h4>
              <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                سيقوم النظام بتحليل جدول الأصناف بالكامل، استخراج اسم الشركة والمورد، الأرقام الضريبية، والخصومات تلقائياً.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              
              {/* Image Preview Card with Zoom Controls */}
              <div className="bg-slate-950 rounded-2xl border border-slate-800 p-3 flex flex-col sm:flex-row items-center gap-3">
                <div className="relative overflow-hidden rounded-xl bg-slate-900 border border-slate-800 w-full sm:w-1/3 min-h-[160px] max-h-[220px] flex items-center justify-center">
                  <img
                    src={imagePreview}
                    alt="Invoice"
                    className="object-contain max-h-[200px] transition-transform duration-200"
                    style={{ transform: `scale(${zoomLevel}) rotate(${rotationDegree}deg)` }}
                  />
                  <div className="absolute top-2 left-2 flex items-center gap-1 bg-slate-950/80 p-1 rounded-lg border border-slate-800">
                    <button type="button" onClick={() => setZoomLevel(prev => Math.min(prev + 0.2, 2.5))} className="p-1 text-white hover:text-emerald-400 cursor-pointer" title="تكبير">
                      <ZoomIn className="w-3.5 h-3.5" />
                    </button>
                    <button type="button" onClick={() => setZoomLevel(prev => Math.max(prev - 0.2, 0.6))} className="p-1 text-white hover:text-emerald-400 cursor-pointer" title="تصغير">
                      <ZoomOut className="w-3.5 h-3.5" />
                    </button>
                    <button type="button" onClick={() => setRotationDegree(prev => (prev + 90) % 360)} className="p-1 text-white hover:text-emerald-400 cursor-pointer" title="تدوير">
                      <RotateCw className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="flex-1 space-y-2 text-white">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-400 flex items-center gap-1">
                      <Sparkles className="w-4 h-4" /> المستند الأصلي المرفق
                    </span>
                    <button
                      type="button"
                      onClick={() => { setImagePreview(null); setExtractedData(null); }}
                      className="px-3 py-1.5 rounded-xl bg-rose-600/90 hover:bg-rose-700 text-white text-xs font-bold transition flex items-center gap-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> تغيير الصورة
                    </button>
                  </div>
                  <p className="text-xs text-slate-300">تم حفظ صورة الفاتورة عالية الجودة داخل النظام. يمكنك مراجعة وتعديل البيانات المستخرجة أدناه قبل الاعتماد.</p>
                </div>
              </div>

              {/* Extraction Processing State */}
              {isExtracting && (
                <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-300 flex items-center gap-3 animate-pulse">
                  <Sparkles className="w-6 h-6 text-emerald-600 animate-spin" />
                  <div>
                    <h5 className="text-sm font-black text-emerald-900">جاري قراءة وتفنيط الفاتورة بالذكاء الاصطناعي (Gemini 3.6)...</h5>
                    <p className="text-xs text-emerald-700">استخراج اسم المورد، الرقم الضريبي، جدول الأصناف، الخصم، والضريبة...</p>
                  </div>
                </div>
              )}

              {/* Price Variance Alert Banner if detected */}
              {priceVarianceAlerts.length > 0 && (
                <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-300 text-amber-900 flex items-start gap-3 shadow-2xs">
                  <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <div className="text-xs space-y-1">
                    <h5 className="font-black text-amber-950">تنبيه ارتفاع أسعار المواد عن آخر توريد سابق:</h5>
                    <ul className="list-disc list-inside space-y-0.5">
                      {priceVarianceAlerts.map((alert, idx) => (
                        <li key={idx}>
                          ارتفع سعر مادة <span className="font-bold">{alert.itemName}</span> بنسبة <span className="font-bold text-rose-700">+{alert.percentageIncrease}%</span> (من {alert.previousPrice} ج.م إلى {alert.currentPrice} ج.م).
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {/* SECTION 1: Supplier & Invoice Metadata Fields */}
              <div className="bg-slate-50 p-4 sm:p-5 rounded-2xl border border-slate-200/90 space-y-4">
                <h4 className="text-xs font-black text-slate-800 flex items-center gap-2 border-b border-slate-200 pb-2">
                  <Building2 className="w-4 h-4 text-emerald-600" /> بيانات المورد والشركة والمستند
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-bold text-slate-700">اسم المورد / الشركة</label>
                      {getConfidenceBadge(fieldConfidence.supplierName)}
                    </div>
                    <input
                      type="text"
                      value={supplierName}
                      onChange={e => { setSupplierName(e.target.value); setTitle(e.target.value); }}
                      className={`w-full px-3 py-2 text-xs rounded-xl border bg-white focus:ring-2 focus:ring-emerald-500 font-bold ${
                        fieldConfidence.supplierName && fieldConfidence.supplierName < 80 ? 'border-amber-400 bg-amber-50/50' : 'border-slate-300'
                      }`}
                      placeholder="مثال: شركة النصر للمستلزمات الطبية"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">رقم الفاتورة / المستند</label>
                    <input
                      type="text"
                      value={invoiceNumber}
                      onChange={e => setInvoiceNumber(e.target.value)}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white font-mono"
                      placeholder="INV-2026-001"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">تاريخ الفاتورة</label>
                    <input
                      type="date"
                      value={invoiceDate}
                      onChange={e => setInvoiceDate(e.target.value)}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white font-bold"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">هاتف المورد</label>
                    <input
                      type="text"
                      value={supplierPhone}
                      onChange={e => setSupplierPhone(e.target.value)}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white"
                      placeholder="01000000000"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">الرقم الضريبي للمورد</label>
                    <input
                      type="text"
                      value={taxNumber}
                      onChange={e => setTaxNumber(e.target.value)}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white font-mono"
                      placeholder="400-123-987"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">السجل التجاري</label>
                    <input
                      type="text"
                      value={commercialRecord}
                      onChange={e => setCommercialRecord(e.target.value)}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white font-mono"
                      placeholder="CR-90812"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">طريقة السداد</label>
                    <select
                      value={paymentMethod}
                      onChange={e => setPaymentMethod(e.target.value as any)}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white font-bold text-slate-800"
                    >
                      <option value="cash">نقداً (Cash)</option>
                      <option value="card">بطاقة / فيزا (Card)</option>
                      <option value="transfer">تحويل بنكي (Bank Transfer)</option>
                      <option value="credit">آجل / بالتقسيط (Deferred / Credit)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">تصنيف المصروف</label>
                    <select
                      value={category}
                      onChange={e => setCategory(e.target.value as any)}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white font-bold"
                    >
                      <option value="supplies">مستلزمات وخامات طبية (Supplies)</option>
                      <option value="fixed">مصروفات ثابتة / إيجارات / رواتب</option>
                      <option value="maintenance">صيانة وتجهيزات أجهزة</option>
                      <option value="other">مصروفات تشغيلية أخرى</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">عنوان المورد</label>
                    <input
                      type="text"
                      value={supplierAddress}
                      onChange={e => setSupplierAddress(e.target.value)}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white"
                      placeholder="القاهرة - شارع الطيران"
                    />
                  </div>
                </div>
              </div>

              {/* SECTION 2: Structured Line Items Interactive Grid */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-black text-slate-900 flex items-center gap-2">
                    <Layers className="w-4 h-4 text-indigo-600" /> أصناف وبنود الفاتورة ({lineItems.length} صنف)
                  </h4>
                  <button
                    type="button"
                    onClick={handleAddLineItem}
                    className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition flex items-center gap-1 cursor-pointer shadow-xs"
                  >
                    <Plus className="w-4 h-4" /> إضافة صنف جديد
                  </button>
                </div>

                <div className="overflow-x-auto rounded-2xl border border-slate-200 shadow-2xs bg-white">
                  <table className="w-full text-right text-xs min-w-[700px]">
                    <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                      <tr>
                        <th className="p-2.5">#</th>
                        <th className="p-2.5 min-w-[180px]">اسم الصنف / المادة</th>
                        <th className="p-2.5 w-20 text-center">الكمية</th>
                        <th className="p-2.5 w-24 text-center">الوحدة</th>
                        <th className="p-2.5 w-28 text-center">سعر الوحدة</th>
                        <th className="p-2.5 w-24 text-center">الخصم</th>
                        <th className="p-2.5 w-24 text-center">الضريبة</th>
                        <th className="p-2.5 w-28 text-left">إجمالي البند</th>
                        <th className="p-2.5 w-20 text-center">إجراءات</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-medium">
                      {lineItems.map((item, idx) => (
                        <tr key={item.id} className="hover:bg-slate-50/90 transition-colors">
                          <td className="p-2.5 text-center font-mono text-slate-400">{idx + 1}</td>
                          <td className="p-2">
                            <input
                              type="text"
                              value={item.itemName}
                              onChange={e => updateLineItem(item.id, 'itemName', e.target.value)}
                              placeholder="اسم الصنف (مثل: حشو كامبوزيت Z350)"
                              className="w-full px-2 py-1.5 text-xs rounded-lg border border-slate-200 focus:ring-1 focus:ring-indigo-500 font-bold text-slate-900"
                            />
                          </td>
                          <td className="p-2">
                            <input
                              type="number"
                              min="1"
                              value={item.quantity}
                              onChange={e => updateLineItem(item.id, 'quantity', Number(e.target.value))}
                              className="w-full px-2 py-1.5 text-xs rounded-lg border border-slate-200 text-center font-bold"
                            />
                          </td>
                          <td className="p-2">
                            <select
                              value={item.unit || 'علبة'}
                              onChange={e => updateLineItem(item.id, 'unit', e.target.value)}
                              className="w-full px-1.5 py-1.5 text-xs rounded-lg border border-slate-200 text-center"
                            >
                              <option value="علبة">علبة</option>
                              <option value="محقنة">محقنة</option>
                              <option value="عبوة">عبوة</option>
                              <option value="طقم">طقم</option>
                              <option value="قطعة">قطعة</option>
                              <option value="كرتونة">كرتونة</option>
                              <option value="زجاجة">زجاجة</option>
                              <option value="دفعة">دفعة</option>
                            </select>
                          </td>
                          <td className="p-2">
                            <input
                              type="number"
                              min="0"
                              value={item.unitPrice}
                              onChange={e => updateLineItem(item.id, 'unitPrice', Number(e.target.value))}
                              className="w-full px-2 py-1.5 text-xs rounded-lg border border-slate-200 text-center font-mono font-bold text-slate-900"
                            />
                          </td>
                          <td className="p-2">
                            <input
                              type="number"
                              min="0"
                              value={item.discount || 0}
                              onChange={e => updateLineItem(item.id, 'discount', Number(e.target.value))}
                              className="w-full px-2 py-1.5 text-xs rounded-lg border border-slate-200 text-center font-mono text-amber-700"
                            />
                          </td>
                          <td className="p-2">
                            <input
                              type="number"
                              min="0"
                              value={item.tax || 0}
                              onChange={e => updateLineItem(item.id, 'tax', Number(e.target.value))}
                              className="w-full px-2 py-1.5 text-xs rounded-lg border border-slate-200 text-center font-mono text-indigo-700"
                            />
                          </td>
                          <td className="p-2.5 text-left font-black text-emerald-700 font-mono">
                            {item.total.toLocaleString()} ج.م
                          </td>
                          <td className="p-2 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleDuplicateLineItem(item)}
                                className="p-1 text-slate-500 hover:text-indigo-600 rounded-md hover:bg-indigo-50"
                                title="تكرار الصنف"
                              >
                                <Copy className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteLineItem(item.id)}
                                className="p-1 text-slate-400 hover:text-rose-600 rounded-md hover:bg-rose-50"
                                title="حذف"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Validation Discrepancy Notice */}
                {isSumDiscrepancy && (
                  <div className="p-3 rounded-2xl bg-amber-50 border border-amber-300 text-amber-900 flex items-center justify-between text-xs animate-fadeIn">
                    <div className="flex items-center gap-2 font-bold">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                      <span>تنبيه: مجموع بنود الجدول ({itemsSum.toLocaleString()} ج.م) يختلف عن الإجمالي الصافي المدخل للفاتورة ({totalVal.toLocaleString()} ج.م)</span>
                    </div>
                    <button
                      type="button"
                      onClick={handleAutoFixNetTotal}
                      className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-bold transition shrink-0 cursor-pointer"
                    >
                      تحديث إجمالي الفاتورة لـ {itemsSum.toLocaleString()} ج.م
                    </button>
                  </div>
                )}
              </div>

              {/* SECTION 3: Financial Summary & Notes */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-3">
                  <h4 className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                    <Calculator className="w-4 h-4 text-emerald-600" /> الملخص المالي للفاتورة
                  </h4>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <label className="block font-bold text-slate-600 mb-1">الإجمالي قبل الخصم والضريبة</label>
                      <input
                        type="number"
                        value={subtotal}
                        onChange={e => setSubtotal(e.target.value === '' ? '' : Number(e.target.value))}
                        className="w-full px-2.5 py-1.5 text-xs rounded-xl border border-slate-300 bg-white font-mono"
                      />
                    </div>

                    <div>
                      <label className="block font-bold text-slate-600 mb-1">إجمالي الخصومات</label>
                      <input
                        type="number"
                        value={discount}
                        onChange={e => setDiscount(e.target.value === '' ? '' : Number(e.target.value))}
                        className="w-full px-2.5 py-1.5 text-xs rounded-xl border border-slate-300 bg-white font-mono text-amber-700"
                      />
                    </div>

                    <div>
                      <label className="block font-bold text-slate-600 mb-1">قيمة الضريبة (VAT)</label>
                      <input
                        type="number"
                        value={tax}
                        onChange={e => setTax(e.target.value === '' ? '' : Number(e.target.value))}
                        className="w-full px-2.5 py-1.5 text-xs rounded-xl border border-slate-300 bg-white font-mono text-indigo-700"
                      />
                    </div>

                    <div>
                      <label className="block font-bold text-emerald-800 mb-1">الصافي الإجمالي النهائى</label>
                      <input
                        type="number"
                        value={totalAmount}
                        onChange={e => setTotalAmount(e.target.value === '' ? '' : Number(e.target.value))}
                        className="w-full px-2.5 py-1.5 text-xs rounded-xl border border-emerald-400 bg-emerald-50/50 font-mono font-black text-emerald-800"
                      />
                    </div>
                  </div>
                </div>

                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-2">
                  <label className="block text-xs font-black text-slate-800">ملاحظات وشروط الفاتورة</label>
                  <textarea
                    rows={4}
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    className="w-full p-2.5 text-xs rounded-xl border border-slate-300 bg-white focus:ring-2 focus:ring-emerald-500"
                    placeholder="ملاحظات تفصيلية أو شروط الضمان وتاريخ الانتهاء..."
                  />
                </div>
              </div>

            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-200 rounded-xl transition cursor-pointer">
            إلغاء وإغلاق
          </button>
          {imagePreview && (
            <button
              type="button"
              onClick={handleSave}
              className="px-6 py-2.5 text-xs font-black text-white bg-emerald-600 hover:bg-emerald-700 rounded-2xl shadow-md transition flex items-center gap-2 cursor-pointer active:scale-95"
            >
              <Check className="w-4 h-4" />
              <span>اعتماد وتأكيد حفظ الفاتورة بالكامل</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
