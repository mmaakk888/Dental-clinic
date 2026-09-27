import { Expense, MaterialUsage } from '../types';

export function normalizeMaterialPart(value: string) {
  return value.trim().toLocaleLowerCase('ar-EG').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ');
}

export function materialKey(name: string, unit: string) {
  return `${normalizeMaterialPart(name)}|${normalizeMaterialPart(unit || 'قطعة')}`;
}

export function getInventory(expenses: Expense[], usages: MaterialUsage[]) {
  const map = new Map<string, { key: string; name: string; unit: string; purchased: number; purchaseCost: number; used: number; waste: number }>();
  expenses.filter(expense => expense.category === 'supplies').forEach(expense => {
    const items = expense.items?.length ? expense.items : [{ itemName: expense.title, quantity: 1, unit: 'فاتورة', unitPrice: expense.amount, total: expense.amount }];
    items.forEach(item => {
      const quantity = Number(item.quantity) || 0;
      if (!item.itemName.trim() || quantity <= 0) return;
      const unit = item.unit || 'قطعة';
      const key = materialKey(item.itemName, unit);
      const row = map.get(key) ?? { key, name: item.itemName.trim(), unit, purchased: 0, purchaseCost: 0, used: 0, waste: 0 };
      row.purchased += quantity;
      row.purchaseCost += Number(item.total) || quantity * (Number(item.unitPrice) || 0);
      map.set(key, row);
    });
  });
  usages.forEach(usage => {
    const row = map.get(usage.materialKey) ?? { key: usage.materialKey, name: usage.materialName, unit: usage.unit, purchased: 0, purchaseCost: 0, used: 0, waste: 0 };
    if (usage.kind === 'waste') row.waste += Number(usage.quantity) || 0;
    else row.used += Number(usage.quantity) || 0;
    map.set(usage.materialKey, row);
  });
  return [...map.values()].map(row => ({ ...row,
    remaining: Math.max(0, row.purchased - row.used - row.waste),
    rawRemaining: row.purchased - row.used - row.waste,
    averageUnitCost: row.purchased > 0 ? row.purchaseCost / row.purchased : 0,
    consumedCost: row.purchased > 0 ? (row.used + row.waste) * (row.purchaseCost / row.purchased) : 0
  })).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
}
