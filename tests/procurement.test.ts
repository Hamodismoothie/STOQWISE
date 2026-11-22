import { describe, expect, test } from "bun:test";
import type { AnalyzedItem } from "../src/analysis.ts";
import { buildProcurementView } from "../src/pages/procurement.ts";

function item(overrides: Partial<AnalyzedItem>): AnalyzedItem {
  return {
    sku: "A-1",
    name: "Artikel",
    category: "Kategori",
    shelfLifeDays: null,
    storage: null,
    supplier: "Leverantör A",
    stock: 10,
    reserved: 0,
    available: 10,
    cost: 10,
    price: 20,
    value: 100,
    soldPeriod: 120,
    revenuePeriod: 2400,
    avgMonthlyDemand: 10,
    monthlyDemand: null,
    monthsSinceLastSale: 0,
    coverDays: 30,
    leadTimeDays: 30,
    safetyStock: 5,
    reorderPoint: 20,
    overstockQty: 0,
    overstockValue: 0,
    stockoutRisk: false,
    abc: "A",
    xyz: null,
    action: "ok",
    actionValue: 0,
    ...overrides,
  };
}

describe("procurement intelligence", () => {
  test("suggests a quantity that restores the reorder point and marks critical items first", () => {
    const view = buildProcurementView([
      item({ sku: "CRIT", stock: 5, available: 5, reorderPoint: 50, avgMonthlyDemand: 40, cost: 10, coverDays: 2, stockoutRisk: true }),
      item({ sku: "PLAN", stock: 15, available: 15, reorderPoint: 20, avgMonthlyDemand: 10, cost: 100, coverDays: 40 }),
      item({ sku: "OK", stock: 100, available: 100, reorderPoint: 20, avgMonthlyDemand: 1, coverDays: 400 }),
    ]);

    expect(view.suggestions.map((s) => s.sku)).toEqual(["CRIT", "PLAN"]);
    expect(view.suggestions[0]).toMatchObject({
      suggestedQty: 45,
      orderValue: 450,
      priority: "critical",
      eoq: 600,
    });
    expect(view.totals.critical).toBe(1);
    expect(view.totals.suggestions).toBe(2);
    expect(view.totals.orderValue).toBe(1_450);
  });

  test("available stock, not the physical balance, drives the purchase quantity", () => {
    const view = buildProcurementView([
      item({ sku: "HELD", stock: 100, reserved: 90, available: 10, reorderPoint: 50, avgMonthlyDemand: 10, coverDays: 30 }),
    ]);
    expect(view.suggestions[0]!.suggestedQty).toBe(40);
    expect(view.suggestions[0]!.available).toBe(10);
  });

  test("ranks suppliers by value and flags concentration of stockout and inactive stock", () => {
    const view = buildProcurementView([
      item({ sku: "A1", supplier: "A", value: 600, stockoutRisk: true, coverDays: 2 }),
      item({ sku: "A2", supplier: "A", value: 400, action: "write_off", actionValue: 400, coverDays: 900 }),
      item({ sku: "B1", supplier: "B", value: 2000, coverDays: 90 }),
    ]);

    expect(view.suppliers[0]!.name).toBe("B");
    expect(view.suppliers.find((s) => s.name === "A")).toMatchObject({
      items: 2,
      inventoryValue: 1000,
      stockoutRisk: 1,
      deadStockValue: 400,
      shareOfValue: 1 / 3,
      risk: "high",
    });
    expect(view.totals.supplierCount).toBe(2);
  });

  test("uses stated assumptions and reports missing lead times instead of inventing them", () => {
    const view = buildProcurementView(
      [item({ sku: "MISS", stock: 1, available: 1, reorderPoint: 10, leadTimeDays: 0, coverDays: 3 })],
      { orderCost: 500, holdingRate: 0.25, coverageDays: 45 },
    );

    expect(view.assumptions).toMatchObject({ orderCost: 500, holdingRate: 0.25, coverageDays: 45, missingLeadTime: 1 });
    expect(view.suggestions[0]!.suggestedQty).toBe(15);
    expect(view.assumptions.orderCost).toBe(500);
  });
});
