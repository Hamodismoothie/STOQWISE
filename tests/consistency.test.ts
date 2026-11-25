import { describe, expect, test } from "bun:test";
import { analyze } from "../src/analysis.ts";
import { buildDemoDataset } from "../src/demo.ts";
import { buildIntelligence } from "../src/core/intelligence.ts";
import { buildProcurementView } from "../src/pages/procurement.ts";

const dataset = buildDemoDataset();
const result = analyze(dataset.items, { months: 12 });
const intel = buildIntelligence(dataset.items, result, { months: 12 });
const procurement = buildProcurementView(result.items);

describe("konsistens mellan motor, översikt, artikel och inköp", () => {
  test("samma saldo och lagervärde i alla vyer", () => {
    for (const analyzed of result.items) {
      const raw = dataset.items.find((i) => i.sku === analyzed.sku)!;
      const intelItem = intel.items.find((i) => i.sku === analyzed.sku)!;
      expect(analyzed.stock).toBe(raw.stock);
      expect(intelItem.stock).toBe(raw.stock);
      expect(intelItem.stock).toBe(analyzed.stock);
      expect(analyzed.value).toBeCloseTo(raw.stock * raw.cost, 2);
      expect(intelItem.value).toBeCloseTo(analyzed.value, 2);
    }
  });

  test("KPI:er är summor av artikelraderna, inte en andra beräkning", () => {
    const inventory = result.items.reduce((a, i) => a + i.value, 0);
    const sales = result.items.reduce((a, i) => a + i.revenuePeriod, 0);
    const cogs = result.items.reduce((a, i) => a + i.soldPeriod * i.cost, 0);
    expect(result.kpis.inventoryValue).toBeCloseTo(inventory, 2);
    expect(result.kpis.salesValue).toBeCloseTo(sales, 2);
    expect(result.kpis.cogsPeriod).toBeCloseTo(cogs, 2);
    expect(result.kpis.grossProfit).toBeCloseTo(sales - cogs, 2);
    expect(intel.profitability.inventoryValue).toBeCloseTo(inventory, 2);
    expect(intel.profitability.revenue).toBeCloseTo(sales, 2);
    expect(intel.profitability.cogs).toBeCloseTo(cogs, 2);
  });

  test("inköpsförslagen använder artikelns saldo, beställningspunkt och säkerhetslager", () => {
    for (const s of procurement.suggestions) {
      const analyzed = result.items.find((i) => i.sku === s.sku)!;
      const intelItem = intel.items.find((i) => i.sku === s.sku)!;
      expect(s.available).toBe(analyzed.available);
      expect(s.available).toBe(intelItem.stock - (intelItem.reserved ?? 0));
      expect(s.reorderPoint).toBe(analyzed.reorderPoint);
      expect(s.safetyStock).toBe(analyzed.safetyStock);
      expect(s.stock).toBe(analyzed.stock);
    }
  });
});
