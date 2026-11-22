import { describe, expect, test } from "bun:test";
import { analyze } from "../src/analysis.ts";
import { buildDemoDataset } from "../src/demo.ts";
import { buildIntelligence } from "../src/core/intelligence.ts";
import type { ItemInput } from "../src/dataset.ts";

const dataset = buildDemoDataset();
const result = analyze(dataset.items, { months: 12 });
const intel = buildIntelligence(dataset.items, result, { months: 12 });

describe("lagerintelligens", () => {
  test("alla artiklar får en klassning och prioritet", () => {
    expect(intel.items.length).toBe(result.kpis.skuCount);
    for (const item of intel.items) {
      expect(["A", "B", "C"]).toContain(item.abcValue);
      expect(["A", "B", "C"]).toContain(item.abcProfit);
      expect(item.priorityScore).toBeGreaterThanOrEqual(0);
      expect(item.priorityScore).toBeLessThanOrEqual(100);
    }
  });

  test("kapital per kategori summerar till totalen", () => {
    const sum = intel.capital.byCategory.reduce((a, c) => a + c.value, 0);
    expect(sum).toBeCloseTo(result.kpis.inventoryValue, -1);
    expect(intel.capital.bySupplier.reduce((a, c) => a + c.value, 0)).toBeCloseTo(result.kpis.inventoryValue, -1);
  });

  test("prioriteringar är sorterade och har skäl", () => {
    const scores = intel.priorities.map((p) => p.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(intel.priorities[0]!.reasons.length).toBeGreaterThan(0);
  });

  test("ABC/XYZ-matrisen räknar alla artiklar", () => {
    const total = intel.classification.matrix.reduce((a, row) => a + row.x + row.y + row.z, 0);
    expect(total).toBe(result.items.filter((item) => item.xyz !== null).length);
  });

  test("hälsopoäng ligger i intervallet och har drivare", () => {
    expect(intel.health.score).toBeGreaterThanOrEqual(0);
    expect(intel.health.score).toBeLessThanOrEqual(100);
    expect(intel.health.drivers).toHaveLength(4);
    expect(["utmärkt", "god", "svag", "kritisk"]).toContain(intel.health.grade);
  });

  test("lönsamhet räknas ur försäljning och inköpspris", () => {
    const revenue = intel.items.reduce((a, i) => a + i.revenuePeriod, 0);
    expect(intel.profitability.revenue).toBeCloseTo(revenue, -1);
    expect(intel.profitability.grossProfit).toBeCloseTo(revenue - intel.profitability.cogs, -1);
  });

  test("inaktivt lager hittas och kapitalet stämmer med motorn", () => {
    const deadValue = intel.items
      .filter((i) => i.action === "write_off" || i.action === "liquidate")
      .reduce((a, i) => a + i.value, 0);
    expect(deadValue).toBeCloseTo(result.kpis.deadStockValue, -1);
    expect(intel.items.some((i) => i.action === "write_off")).toBe(true);
  });

  test("anomalier beskriver vad som avviker", () => {
    expect(intel.anomalies.length).toBeGreaterThan(0);
    expect(intel.anomalies[0]!.detail.length).toBeGreaterThan(10);
  });

  test("låg marginal identifieras på konstruerad data", () => {
    const items: ItemInput[] = [
      {
        sku: "LOW-1",
        name: "Lågmarginal",
        category: "Test",
        supplier: "Lev",
        stock: 100,
        cost: 95,
        price: 100,
        leadTimeDays: 30,
        moq: 1,
        monthly: Array(12).fill(10),
        totalSold: 120,
        totalRevenue: 12000,
      },
      {
        sku: "BAD-1",
        name: "Negativ",
        category: "Test",
        supplier: "Lev",
        stock: 100,
        cost: 150,
        price: 100,
        leadTimeDays: 30,
        moq: 1,
        monthly: Array(12).fill(5),
        totalSold: 60,
        totalRevenue: 6000,
      },
    ];
    const res = analyze(items, { months: 12 });
    const intel2 = buildIntelligence(items, res, { months: 12 });
    expect(intel2.profitability.negativeMarginCount).toBeGreaterThanOrEqual(1);
    expect(intel2.items.find((i) => i.sku === "BAD-1")!.marginPct!).toBeLessThan(0);
  });
});
