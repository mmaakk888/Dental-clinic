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
    // An invoice amount is not a physical quantity. Keep unitemized expenses in
    // purchase reports, without inventing stock that can be consumed.
    const items = expense.items ?? [];
    items.forEach(item => {
      const quantity = Number(item.quantity) || 0;
      if (!item.itemName.trim() || !Number.isFinite(quantity) || quantity <= 0) return;
      const unit = item.unit || 'قطعة';
      const key = materialKey(item.itemName, unit);
      const row = map.get(key) ?? { key, name: item.itemName.trim(), unit, purchased: 0, purchaseCost: 0, used: 0, waste: 0 };
      row.purchased += quantity;
      const total = Number(item.total);
      row.purchaseCost += Number.isFinite(total) && total >= 0 ? total : quantity * (Number(item.unitPrice) || 0);
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
    consumedCost: usages.filter(usage => usage.materialKey === row.key).reduce((sum, usage) => sum + getUsageCost(usage, row.purchased > 0 ? row.purchaseCost / row.purchased : 0), 0)
  })).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
}

function getUsageCost(usage: MaterialUsage, fallbackUnitCost: number) {
  const cost = Number.isFinite(usage.unitCostAtUse) && usage.unitCostAtUse >= 0 ? usage.unitCostAtUse : fallbackUnitCost;
  return Math.max(0, Number(usage.quantity) || 0) * cost;
}

export function getMonthlyMaterials(expenses: Expense[], usages: MaterialUsage[], month: string) {
  const inventory = getInventory(expenses, usages);
  const movements = usages.filter(usage => usage.date.slice(0, 7) === month);
  const result = { purchases: 0, usedCost: 0, wasteCost: 0, estimatedCount: 0, movements };
  result.purchases = expenses.filter(expense => expense.category === 'supplies' && (expense.invoiceDate || expense.date).slice(0, 7) === month)
    .reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0);
  for (const usage of movements) {
    const fallback = inventory.find(row => row.key === usage.materialKey)?.averageUnitCost ?? 0;
    if (!Number.isFinite(usage.unitCostAtUse) || usage.unitCostAtUse < 0) result.estimatedCount++;
    const cost = getUsageCost(usage, fallback);
    if (usage.kind === 'waste') result.wasteCost += cost;
    else result.usedCost += cost;
  }
  return result;
}
