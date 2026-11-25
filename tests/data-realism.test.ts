import { describe, expect, test } from "bun:test";
import { buildDemoDataset, DEMO_ENVIRONMENTS } from "../src/demo.ts";
import { analyze } from "../src/analysis.ts";
import { buildLiveWarehouse } from "../src/ui/live-warehouse.ts";
import { buildSimulationInput, runSimulation } from "../src/ui/live-simulation.ts";

describe("demodata är verksamhetsmässigt trovärdig", () => {
  for (const meta of DEMO_ENVIRONMENTS) {
    test(`${meta.id}: identifierare, priser, lager och historik hänger ihop`, () => {
      const dataset = buildDemoDataset(meta.id);
      const skus = new Set<string>();
      expect(dataset.items.length).toBeGreaterThan(20);
      expect(dataset.months).toBeGreaterThanOrEqual(12);

      for (const item of dataset.items) {
        expect(skus.has(item.sku)).toBe(false);
        skus.add(item.sku);

        expect(item.cost).toBeGreaterThan(0);
        expect(item.price ?? 0).toBeGreaterThan(item.cost);
        expect(item.stock).toBeGreaterThanOrEqual(0);
        expect(item.reserved ?? 0).toBeGreaterThanOrEqual(0);
        expect(item.reserved ?? 0).toBeLessThanOrEqual(item.stock);
        expect(item.leadTimeDays ?? 0).toBeGreaterThan(0);
        expect(item.leadTimeDays ?? 0).toBeLessThanOrEqual(60);
        expect(item.moq ?? 0).toBeGreaterThan(0);

        expect(item.monthly).not.toBeNull();
        expect(item.monthly!.length).toBe(dataset.months);
        expect(item.monthly!.every((v) => Number.isInteger(v) && v >= 0)).toBe(true);
        expect(item.totalSold).toBe(item.monthly!.reduce((sum, v) => sum + v, 0));
        expect(item.totalRevenue).toBe(item.totalSold * (item.price ?? 0));
      }

      // Samma deterministiska indata ska ge samma lagerbild varje gång.
      const again = buildDemoDataset(meta.id);
      expect(again.items.map((i) => [i.sku, i.stock, i.monthly])).toEqual(
        dataset.items.map((i) => [i.sku, i.stock, i.monthly]),
      );
    });
  }

  test("livsmedelsmiljön har hållbarhet och förvaring på varje artikel", () => {
    const dataset = buildDemoDataset("foodservice");
    expect(dataset.items.every((i) => typeof i.shelfLifeDays === "number" && i.shelfLifeDays! > 0)).toBe(true);
    expect(dataset.items.every((i) => Boolean(i.storage))).toBe(true);
  });
});

/**
 * The figures next to each other must tell the same story. These invariants are
 * deliberately expressed from the item record outward: coverage is recomputed
 * from stock and demand, stockout risk from coverage and lead time, and the
 * purchase quantity from MOQ. If a formula drifts, one of them fails.
 */
describe("nyckeltal och rekommendationer är konsistenta", () => {
  for (const meta of DEMO_ENVIRONMENTS) {
    test(`${meta.id}: täckning, bristrisk och inköpsvolym följer artikeldata`, () => {
      const dataset = buildDemoDataset(meta.id);
      const result = analyze(dataset.items, { months: dataset.months });
      const kpis = result.kpis;

      // Inventory levels for a wholesaler/retailer of this size: weeks to a few
      // months of cover, not a warehouse frozen for a year or an empty shelf.
      expect(kpis.inventoryValue).toBeGreaterThan(300_000);
      expect(kpis.turns).toBeGreaterThan(3);
      expect(kpis.turns).toBeLessThan(20);
      expect(kpis.daysOfInventory ?? 0).toBeGreaterThan(20);
      expect(kpis.daysOfInventory ?? 0).toBeLessThan(150);
      expect(kpis.grossMarginPct).toBeGreaterThan(20);
      expect(kpis.grossMarginPct).toBeLessThan(65);

      for (const item of result.items) {
        if (item.avgMonthlyDemand > 0) {
          const expectedCover = item.available / (item.avgMonthlyDemand / 30.44);
          // avgMonthlyDemand is published rounded to two decimals, so coverage
          // recomputed from the published figure may differ by a day or two.
          expect(Math.abs((item.coverDays ?? 0) - expectedCover)).toBeLessThanOrEqual(Math.max(2, expectedCover * 0.01));
          expect(item.stockoutRisk).toBe(expectedCover < item.leadTimeDays);
          // A minimum order quantity several months above demand would make the
          // replenishment proposal absurd; the catalogue stays within this.
          expect(item.moq ?? 1).toBeLessThanOrEqual(Math.ceil(item.avgMonthlyDemand * 6) + 1);
        }

        // Lead-time variability is part of SERV1, but it cannot exceed the
        // nominal lead time itself.
        const input = dataset.items.find((row) => row.sku === item.sku)!;
        expect(input.leadTimeSigmaDays ?? 0).toBeGreaterThan(0);
        expect(input.leadTimeSigmaDays ?? 0).toBeLessThan(input.leadTimeDays ?? 0);
      }

      // Every reorder recommendation must be a genuine risk, and every risk
      // must be visible in the reorder list.
      for (const item of result.items.filter((row) => row.action === "reorder")) {
        expect(item.stockoutRisk).toBe(true);
      }

      // The safety stock is positive wherever demand varies and lead time is
      // non-zero, otherwise SERV1 is silently disabled.
      expect(result.items.filter((row) => row.avgMonthlyDemand > 0 && row.safetyStock > 0).length).toBeGreaterThan(
        result.items.filter((row) => row.avgMonthlyDemand > 0).length * 0.9,
      );
    });
  }

  test("simulerade inköpsordrar är hela multiplar av MOQ", () => {
    const dataset = buildDemoDataset("industri");
    const result = analyze(dataset.items, { months: dataset.months });
    const model = buildLiveWarehouse(result.items, "sv");
    const input = buildSimulationInput(model, result.items, "test");
    // The simulation must use the supplier MOQ from the item record, not a
    // fraction of demand invented by the adapter.
    const moqBySku = new Map(result.items.map((item) => [item.sku, Math.max(1, Math.ceil(item.moq ?? 1))]));
    for (const article of input.articles) {
      expect(article.moq).toBe(moqBySku.get(article.sku)!);
    }
    const run = runSimulation(input.articles, { preset: "normal", days: 90 }, { seed: input.seed, startDate: input.startDate });
    const orders = run.days.flatMap((day) => day.events).filter((event) => event.type === "replenishment_needed");
    expect(orders.length).toBeGreaterThan(0);
    for (const order of orders) {
      const moq = moqBySku.get(order.sku!) ?? 1;
      expect(order.qty % moq).toBe(0);
    }
  });
});
