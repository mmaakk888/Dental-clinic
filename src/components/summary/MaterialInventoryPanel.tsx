import React, { useMemo, useState } from 'react';
import { Expense, MaterialUsage } from '../../types';
import { getInventory, getMonthlyMaterials } from '../../utils/inventory';
import { useToastAndConfirm } from '../common/ToastAndConfirm';
import { localDateISO } from '../appointments/appointmentScheduling';

interface Props {
  expenses: Expense[];
  usages: MaterialUsage[];
  isPrivacyMode: boolean;
  onAddUsage: (usage: Omit<MaterialUsage, 'id'>) => void;
  onDeleteUsage: (id: string) => void;
}

export function MaterialInventoryPanel({ expenses, usages, isPrivacyMode, onAddUsage, onDeleteUsage }: Props) {
  const inventory = useMemo(() => getInventory(expenses, usages), [expenses, usages]);
  const unitemizedCount = expenses.filter(expense => expense.category === 'supplies' && !expense.items?.length).length;
  const [selectedKey, setSelectedKey] = useState('');
  const [quantity, setQuantity] = useState<number | ''>('');
  const [kind, setKind] = useState<MaterialUsage['kind']>('used');
  const [date, setDate] = useState(localDateISO);
  const [note, setNote] = useState('');
  const [search, setSearch] = useState('');
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const monthly = useMemo(() => getMonthlyMaterials(expenses, usages, month), [expenses, usages, month]);
  const { showToast, askConfirm } = useToastAndConfirm();
  const selected = inventory.find(row => row.key === selectedKey);
  const filtered = inventory.filter(row => row.name.toLowerCase().includes(search.trim().toLowerCase()));
  const totalConsumedCost = inventory.reduce((sum, row) => sum + row.consumedCost, 0);
  const money = (value: number) => isPrivacyMode ? '*** ج.م' : `${Math.round(value).toLocaleString('ar-EG')} ج.م`;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const amount = Number(quantity);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return showToast('اختر تاريخ حركة الخامة.', 'warning');
    if (!selected || !Number.isFinite(amount) || amount <= 0) return showToast('اختر خامة واكتب كمية صحيحة.', 'warning');
    if (amount > selected.remaining) return showToast(`الكمية أكبر من المتاح (${selected.remaining} ${selected.unit}).`, 'warning');
    onAddUsage({ materialKey: selected.key, materialName: selected.name, quantity: amount, unit: selected.unit, date, kind, note: note.trim() || undefined, unitCostAtUse: selected.averageUnitCost });
    setQuantity(''); setNote('');
    showToast(kind === 'waste' ? 'تم تسجيل الهالك وخصمه من المخزون.' : 'تم تسجيل استهلاك الخامة.', 'success');
  };

  return <section className="space-y-4">
    {unitemizedCount > 0 && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">يوجد {unitemizedCount} فاتورة خامات بدون تفاصيل أصناف. قيمتها محسوبة ضمن المشتريات، لكنها لا تضيف كمية للمخزون حتى يتم تسجيل الأصناف والكميات. لا تسجل نفس الفاتورة مرة ثانية.</p>}
    <div className="rounded-2xl border bg-white p-4 space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h3 className="font-black text-slate-900">تقرير الخامات الشهري</h3>
        <label className="text-sm flex flex-wrap items-center gap-2">الشهر<input aria-label="شهر تقرير الخامات" type="month" required value={month} onChange={e => e.target.value && setMonth(e.target.value)} className="border rounded-xl p-2 min-w-0 max-w-full" /></label>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-xl bg-slate-50 p-3"><span className="block text-xs text-slate-600">قيمة المشتريات</span><strong>{money(monthly.purchases)}</strong></div>
        <div className="rounded-xl bg-slate-50 p-3"><span className="block text-xs text-slate-600">تكلفة الاستهلاك</span><strong>{money(monthly.usedCost)}</strong></div>
        <div className="rounded-xl bg-slate-50 p-3"><span className="block text-xs text-slate-600">تكلفة الهالك</span><strong>{money(monthly.wasteCost)}</strong></div>
      </div>
      <p className="text-xs text-slate-600">المشتريات هي قيمة الفواتير وليست بالضرورة المبلغ المسدّد. الاستهلاك والهالك محسوبان بسعر الوحدة المحفوظ عند تسجيل الحركة، ولا يُضافان مرة أخرى للمصروفات. أرصدة المخزون بالأسفل تشمل كل الشهور.</p>
      {monthly.estimatedCount > 0 && <p className="text-xs text-amber-800">توجد {monthly.estimatedCount} حركة قديمة بدون تكلفة محفوظة؛ تكلفتها تقديرية بمتوسط المشتريات الحالي.</p>}
    </div>
    <div className="rounded-2xl border border-indigo-200 bg-indigo-50/50 p-4">
      <div className="flex flex-col sm:flex-row justify-between gap-2"><div><h3 className="font-black text-slate-900">مخزون واستهلاك الخامات</h3><p className="text-xs text-slate-600">المشتريات مأخوذة من بنود فواتير الخامات؛ الاستهلاك والهالك يخفضان الكمية فقط ولا ينشئان مصروفًا جديدًا.</p></div><strong className="text-sm text-indigo-800">تكلفة المستهلك: {money(totalConsumedCost)}</strong></div>
      <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2 mt-4">
        <select aria-label="الخامة" required value={selectedKey} onChange={e => setSelectedKey(e.target.value)} className="lg:col-span-2 border rounded-xl p-3 bg-white"><option value="">اختر الخامة</option>{inventory.filter(row => row.remaining > 0).map(row => <option key={row.key} value={row.key}>{row.name} — متاح {row.remaining} {row.unit}</option>)}</select>
        <input aria-label="الكمية المستهلكة" type="number" min="0.001" step="any" value={quantity} onChange={e => setQuantity(e.target.value === '' ? '' : Number(e.target.value))} placeholder="الكمية" className="border rounded-xl p-3 min-w-0" />
        <select aria-label="نوع الحركة" value={kind} onChange={e => setKind(e.target.value as MaterialUsage['kind'])} className="border rounded-xl p-3 bg-white"><option value="used">استهلاك</option><option value="waste">هالك / تالف</option></select>
        <input aria-label="تاريخ حركة الخامة" type="date" value={date} onChange={e => setDate(e.target.value)} className="border rounded-xl p-3 min-w-0" />
        <button type="submit" className="rounded-xl bg-indigo-700 text-white p-3 font-bold">تسجيل الحركة</button>
        <input aria-label="ملاحظة حركة الخامة" value={note} onChange={e => setNote(e.target.value)} placeholder="ملاحظة اختيارية: استخدام/سبب الهالك" className="sm:col-span-2 lg:col-span-6 border rounded-xl p-3" />
      </form>
    </div>

    <input aria-label="بحث المخزون" value={search} onChange={e => setSearch(e.target.value)} placeholder="ابحث في المخزون..." className="w-full border rounded-xl p-3" />
    {!inventory.length ? <p className="rounded-xl bg-slate-50 p-5 text-sm text-slate-500">لا توجد بنود خامات بعد. صوّر فاتورة واختر «خامات ومستلزمات» وراجع بنودها، أو أضف فاتورة خامات يدويًا.</p> : <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {filtered.map(row => <article key={row.key} className="rounded-2xl border p-4 bg-white space-y-2">
        <div className="flex justify-between gap-2"><strong>{row.name}</strong><span className={`text-xs px-2 py-1 rounded-lg ${row.remaining <= 0 ? 'bg-rose-100 text-rose-800' : row.remaining <= row.purchased * .2 ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100 text-emerald-800'}`}>{row.remaining <= 0 ? 'نفد' : 'متاح'}</span></div>
        <div className="grid grid-cols-3 gap-2 text-center text-xs"><div><span className="block text-slate-500">مشتريات</span>{row.purchased} {row.unit}</div><div><span className="block text-slate-500">مستهلك/هالك</span>{row.used + row.waste} {row.unit}</div><div><span className="block text-slate-500">المتبقي</span><b>{row.remaining} {row.unit}</b></div></div>
        <p className="text-xs text-slate-500">متوسط تكلفة الوحدة: {money(row.averageUnitCost)} · تكلفة المستهلك: {money(row.consumedCost)}</p>
        {row.rawRemaining < 0 && <p className="text-xs text-rose-700">تنبيه: حركات الاستهلاك القديمة تتجاوز المشتريات المسجلة.</p>}
      </article>)}
    </div>}

    {!!usages.length && <div className="rounded-2xl border overflow-hidden"><h4 className="font-bold p-3 bg-slate-50">آخر حركات المخزون</h4>{[...usages].sort((a, b) => `${b.date}${b.id}`.localeCompare(`${a.date}${a.id}`)).slice(0, 20).map(usage => <div key={usage.id} className="p-3 border-t flex flex-wrap justify-between gap-2 text-sm"><span><b>{usage.materialName}</b> · {usage.kind === 'waste' ? 'هالك' : 'استهلاك'} {usage.quantity} {usage.unit}<small className="block text-slate-500">{usage.date}{usage.note ? ` · ${usage.note}` : ''}</small></span><button type="button" className="text-rose-700 p-2" onClick={() => askConfirm({ title: 'حذف حركة خامة', message: 'سيتم إرجاع الكمية إلى المتاح. هل تريد المتابعة؟', confirmLabel: 'حذف الحركة', tone: 'danger', onConfirm: () => onDeleteUsage(usage.id) })}>حذف</button></div>)}</div>}
  </section>;
}
