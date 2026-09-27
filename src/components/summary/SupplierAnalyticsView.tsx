import React, { useMemo, useState } from 'react';
import { TrendingUp, Package, Building2, AlertTriangle, ArrowUpRight, ArrowDownRight, DollarSign, PieChart, Layers, Search, RefreshCw, BarChart2 } from 'lucide-react';
import { Expense, ExpenseItem, MaterialUsage } from '../../types';
import { MaterialInventoryPanel } from './MaterialInventoryPanel';

interface SupplierAnalyticsViewProps {
  expenses: Expense[];
  isPrivacyMode?: boolean;
  materialUsages: MaterialUsage[];
  onAddMaterialUsage: (usage: Omit<MaterialUsage, 'id'>) => void;
  onDeleteMaterialUsage: (id: string) => void;
}

export const SupplierAnalyticsView: React.FC<SupplierAnalyticsViewProps> = ({
  expenses,
  isPrivacyMode = false,
  materialUsages,
  onAddMaterialUsage,
  onDeleteMaterialUsage,
}) => {
  const [materialSearchQuery, setMaterialSearchQuery] = useState('');
  const [selectedMaterialFilter, setSelectedMaterialFilter] = useState<string | null>(null);

  const maskMoney = (amt: number) => {
    if (isPrivacyMode) return '*** ج.م';
    return `${amt.toLocaleString()} ج.م`;
  };

  // 1. Compile Material / Item Metrics across all invoice line items
  const materialAnalytics = useMemo(() => {
    const itemsMap: Record<string, {
      name: string;
      totalSpent: number;
      totalQty: number;
      unit: string;
      purchaseCount: number;
      pricesHistory: { price: number; date: string; supplier: string }[];
    }> = {};

    expenses.filter(exp => exp.category === 'supplies').forEach(exp => {
      const items = exp.items && exp.items.length > 0
        ? exp.items
        : [{ itemName: exp.title, quantity: 1, unit: 'دفعة', unitPrice: exp.amount, total: exp.amount }];

      items.forEach(item => {
        const rawName = item.itemName.trim();
        if (!rawName) return;

        if (!itemsMap[rawName]) {
          itemsMap[rawName] = {
            name: rawName,
            totalSpent: 0,
            totalQty: 0,
            unit: item.unit || 'قطع',
            purchaseCount: 0,
            pricesHistory: [],
          };
        }

        const entry = itemsMap[rawName];
        entry.totalSpent += item.total || (item.quantity * item.unitPrice);
        entry.totalQty += item.quantity || 1;
        entry.purchaseCount += 1;
        entry.pricesHistory.push({
          price: item.unitPrice,
          date: exp.invoiceDate || exp.date,
          supplier: exp.supplierName || exp.title,
        });
      });
    });

    const list = Object.values(itemsMap).map(m => {
      m.pricesHistory.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      const lastPrice = m.pricesHistory[0]?.price || 0;
      const prevPrice = m.pricesHistory[1]?.price || lastPrice;
      const avgPrice = m.totalQty > 0 ? Math.round(m.totalSpent / m.totalQty) : lastPrice;
      const priceChangePercent = prevPrice > 0 ? Math.round(((lastPrice - prevPrice) / prevPrice) * 100) : 0;

      return {
        ...m,
        lastPrice,
        prevPrice,
        avgPrice,
        priceChangePercent,
      };
    });

    list.sort((a, b) => b.totalSpent - a.totalSpent);
    return list;
  }, [expenses]);

  // 2. Compile Supplier Ranking Metrics
  const supplierAnalytics = useMemo(() => {
    const map: Record<string, { name: string; totalSpent: number; count: number; lastInvoiceDate: string; phone?: string }> = {};

    expenses.filter(exp => exp.category === 'supplies').forEach(exp => {
      const name = exp.supplierName || exp.title || 'مورد غير محدد';
      if (!map[name]) {
        map[name] = {
          name,
          totalSpent: 0,
          count: 0,
          lastInvoiceDate: exp.invoiceDate || exp.date,
          phone: exp.supplierPhone,
        };
      }
      map[name].totalSpent += exp.amount;
      map[name].count += 1;
      if (new Date(exp.invoiceDate || exp.date) > new Date(map[name].lastInvoiceDate)) {
        map[name].lastInvoiceDate = exp.invoiceDate || exp.date;
      }
    });

    const list = Object.values(map);
    list.sort((a, b) => b.totalSpent - a.totalSpent);
    return list;
  }, [expenses]);

  // 3. Price Variance Alerts List
  const priceAlerts = useMemo(() => {
    return materialAnalytics.filter(m => m.priceChangePercent > 0);
  }, [materialAnalytics]);

  // Filtered materials
  const filteredMaterials = useMemo(() => {
    if (!materialSearchQuery.trim()) return materialAnalytics;
    const q = materialSearchQuery.toLowerCase();
    return materialAnalytics.filter(m => m.name.toLowerCase().includes(q));
  }, [materialAnalytics, materialSearchQuery]);

  const totalSuppliesSpend = useMemo(() => {
    return expenses.filter(e => e.category === 'supplies').reduce((acc, e) => acc + e.amount, 0);
  }, [expenses]);

  return (
    <div className="space-y-6 animate-fadeIn font-cairo dir-rtl">
      <MaterialInventoryPanel expenses={expenses} usages={materialUsages} isPrivacyMode={isPrivacyMode} onAddUsage={onAddMaterialUsage} onDeleteUsage={onDeleteMaterialUsage} />
      
      {/* Top Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-2xs flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-700 shrink-0">
            <Package className="w-6 h-6" />
          </div>
          <div>
            <span className="text-xs font-bold text-slate-500">إجمالي الأصناف والمواد</span>
            <p className="text-xl font-black text-slate-900">{materialAnalytics.length} مادة طبية</p>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-2xs flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-700 shrink-0">
            <Building2 className="w-6 h-6" />
          </div>
          <div>
            <span className="text-xs font-bold text-slate-500">عدد الموردين النشطين</span>
            <p className="text-xl font-black text-slate-900">{supplierAnalytics.length} موردين</p>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-2xs flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-700 shrink-0">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div>
            <span className="text-xs font-bold text-slate-500">ارتفاعات أسعار المواد</span>
            <p className="text-xl font-black text-amber-700">{priceAlerts.length} تنبيهات أسعار</p>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-gradient-to-br from-slate-900 to-indigo-950 text-white shadow-2xs flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center text-emerald-400 shrink-0">
            <DollarSign className="w-6 h-6" />
          </div>
          <div>
            <span className="text-xs font-bold text-indigo-200/80">إجمالي إنفاق المستلزمات</span>
            <p className="text-xl font-black text-emerald-400">{maskMoney(totalSuppliesSpend)}</p>
          </div>
        </div>
      </div>

      {/* Price Hike Warning Panel */}
      {priceAlerts.length > 0 && (
        <div className="p-4 rounded-2xl bg-gradient-to-r from-amber-500/10 via-amber-100/50 to-orange-500/10 border border-amber-300 shadow-xs space-y-2">
          <div className="flex items-center gap-2 text-amber-950 font-black text-xs">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            <span>تنبيهات كشف تضخم وارتفاع أسعار الخامات والمواد الطبية:</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
            {priceAlerts.slice(0, 3).map((alert, idx) => (
              <div key={idx} className="p-2.5 rounded-xl bg-white border border-amber-200/90 shadow-2xs flex items-center justify-between text-xs">
                <div>
                  <p className="font-bold text-slate-900">{alert.name}</p>
                  <p className="text-[11px] text-slate-500">
                    آخر سعر: <span className="font-bold text-rose-700">{maskMoney(alert.lastPrice)}</span> (السابق: {maskMoney(alert.prevPrice)})
                  </p>
                </div>
                <span className="px-2 py-1 rounded-lg text-xs font-extrabold bg-rose-100 text-rose-800 flex items-center gap-0.5">
                  <ArrowUpRight className="w-3.5 h-3.5" /> +{alert.priceChangePercent}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Grid Layout: Top Purchased Materials & Top Suppliers */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Card 1: Top Materials & Consumption */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div>
              <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
                <Package className="w-4 h-4 text-indigo-600" /> أكثر المواد شراءً والإنفاق عليها
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">ترتيب الخامات الطبية حسب حجم الإنفاق المالي الإجمالي</p>
            </div>
            <div className="relative max-w-xs w-full">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-2.5" />
              <input
                type="text"
                value={materialSearchQuery}
                onChange={e => setMaterialSearchQuery(e.target.value)}
                placeholder="بحث باسم المادة..."
                className="w-full pr-8 pl-3 py-1.5 text-xs rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
            {filteredMaterials.length === 0 ? (
              <p className="text-center py-8 text-xs text-slate-400">لا توجد مواد مطابقة للبحث</p>
            ) : (
              filteredMaterials.map((mat, idx) => {
                const percentOfTotal = totalSuppliesSpend > 0 ? Math.round((mat.totalSpent / totalSuppliesSpend) * 100) : 0;
                return (
                  <div
                    key={mat.name}
                    onClick={() => setSelectedMaterialFilter(selectedMaterialFilter === mat.name ? null : mat.name)}
                    className={`p-3 rounded-xl border transition cursor-pointer ${
                      selectedMaterialFilter === mat.name ? 'border-indigo-500 bg-indigo-50/50 shadow-2xs' : 'border-slate-200/80 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-lg bg-slate-100 text-slate-600 font-bold flex items-center justify-center text-[11px]">
                          {idx + 1}
                        </span>
                        <span className="font-bold text-slate-900">{mat.name}</span>
                        <span className="text-[11px] text-slate-500 font-medium">({mat.totalQty} {mat.unit})</span>
                      </div>
                      <div className="text-left font-mono">
                        <span className="font-black text-slate-900 block">{maskMoney(mat.totalSpent)}</span>
                        <span className="text-[10px] text-slate-400">{mat.purchaseCount} عمليات شراء</span>
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="mt-2 space-y-1">
                      <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                        <div
                          className="bg-gradient-to-r from-indigo-500 to-purple-600 h-full rounded-full transition-all duration-300"
                          style={{ width: `${Math.min(percentOfTotal * 2, 100)}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-[10px] text-slate-500 font-medium">
                        <span>آخر سعر: {maskMoney(mat.lastPrice)} / {mat.unit}</span>
                        <span>متوسط السعر: {maskMoney(mat.avgPrice)}</span>
                        {mat.priceChangePercent !== 0 && (
                          <span className={mat.priceChangePercent > 0 ? 'text-rose-600 font-bold' : 'text-emerald-600 font-bold'}>
                            {mat.priceChangePercent > 0 ? `+${mat.priceChangePercent}%` : `${mat.priceChangePercent}%`}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Card 2: Top Suppliers Ranking */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-4">
          <div className="border-b border-slate-100 pb-3">
            <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
              <Building2 className="w-4 h-4 text-emerald-600" /> كبار الموردين وحجم التعامل
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">تحليل الموردين الأكثر توريداً لخامات العيادة والمبالغ المسددة لهم</p>
          </div>

          <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
            {supplierAnalytics.length === 0 ? (
              <p className="text-center py-8 text-xs text-slate-400">لا يوجد موردين تسجلوا بعد</p>
            ) : (
              supplierAnalytics.map((sup, idx) => (
                <div key={sup.name} className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/90 flex items-center justify-between hover:bg-slate-100/80 transition">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-lg bg-emerald-100 text-emerald-900 font-bold text-xs flex items-center justify-center">
                        #{idx + 1}
                      </span>
                      <h4 className="text-xs font-black text-slate-900">{sup.name}</h4>
                    </div>
                    <p className="text-[11px] text-slate-500 flex items-center gap-2">
                      <span>إجمالي الفواتير: {sup.count} فواتير</span>
                      <span>• آخر توريد: {sup.lastInvoiceDate}</span>
                    </p>
                  </div>
                  <div className="text-left font-mono">
                    <span className="text-sm font-black text-emerald-700 block">{maskMoney(sup.totalSpent)}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

      </div>

    </div>
  );
};
