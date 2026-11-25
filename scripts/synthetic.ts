import type { ItemInput } from "../src/dataset.ts";

/** Deterministic synthetic inventory used only by scale measurements. */
export function syntheticItems(count: number): ItemInput[] {
  const items: ItemInput[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const base = 5 + ((i * 7) % 60);
    const monthly = new Array<number>(12);
    for (let month = 0; month < 12; month++) {
      monthly[month] = Math.max(0, Math.round(base * (0.8 + ((i + month) % 9) / 20)));
    }
    const totalSold = monthly.reduce((sum, value) => sum + value, 0);
    items[i] = {
      sku: `SKU-${String(i).padStart(6, "0")}`,
      name: `Synthetic article ${i}`,
      category: `Category ${i % 24}`,
      supplier: `Supplier ${i % 90}`,
      stock: Math.round(base * (1 + (i % 6))),
      cost: 20 + (i % 400),
      price: 40 + (i % 700),
      leadTimeDays: 30,
      moq: 10,
      monthly,
      totalSold,
      totalRevenue: null,
    };
  }
  return items;
}

export function syntheticCsv(items: ItemInput[]): string {
  const months = Array.from({ length: 12 }, (_, month) => `2025-${String(month + 1).padStart(2, "0")}`);
  const header = ["SKU", "Name", "Category", "Supplier", "Stock", "Cost", "Price", "LeadTimeDays", "MOQ", ...months].join(",");
  const rows = new Array<string>(items.length);
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    rows[i] = [
      item.sku,
      item.name,
      item.category ?? "",
      item.supplier ?? "",
      item.stock,
      item.cost,
      item.price ?? "",
      item.leadTimeDays ?? "",
      item.moq ?? "",
      ...(item.monthly ?? []),
    ].join(",");
  }
  return `${header}\n${rows.join("\n")}`;
}
