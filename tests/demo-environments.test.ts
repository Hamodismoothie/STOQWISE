import { describe, expect, test } from "bun:test";
import { analyze } from "../src/analysis.ts";
import { parseCsv } from "../src/csv.ts";
import { buildDataset } from "../src/dataset.ts";
import { detectMapping } from "../src/mapping.ts";
import { buildIntelligence } from "../src/core/intelligence.ts";
import {
  buildDemoDataset,
  DEMO_ENVIRONMENTS,
  demoCsv,
  type DemoEnvironmentId,
} from "../src/demo.ts";

const EXPECTED_CATEGORIES: Record<DemoEnvironmentId, string[]> = {
  industri: [
    "Handverktyg",
    "Elverktyg",
    "Fästmaterial",
    "Elkomponenter",
    "VVS",
    "Rör och kopplingar",
    "Byggmaterial",
    "Skyddsutrustning",
    "Lim och fog",
    "Verkstad",
  ],
  hem: ["Förvaring", "Kök", "Trädgård", "Belysning", "Städning", "Färg", "Säsong", "Järnhandel", "Utemöbler", "Utgående"],
  livsmedel: ["Mejeri", "Kött och chark", "Frukt och grönt", "Fryst", "Torrvaror", "Dryck", "Bageri", "Färdigmat"],
  foodservice: [
    "Torrvaror",
    "Dryck",
    "Fryst",
    "Mejeri",
    "Förpackning",
    "Engångsmaterial",
    "Rengöring",
    "Restaurangutrustning",
  ],
  ecommerce: ["Kläder", "Accessoarer", "Elektronik", "Hem", "Personvård", "Sport", "Utgående"],
};

const datasets = DEMO_ENVIRONMENTS.map((environment) => buildDemoDataset(environment.id));

describe("demo environments", () => {
  test("five distinct fictional companies with coherent metadata", () => {
    expect(new Set(DEMO_ENVIRONMENTS.map((e) => e.id)).size).toBe(5);
    expect(new Set(DEMO_ENVIRONMENTS.map((e) => e.company)).size).toBe(5);
    for (const environment of DEMO_ENVIRONMENTS) {
      expect(environment.company).toMatch(/AB$/);
      expect(environment.orgNumber).toMatch(/^\d{6}-\d{4}$/);
      expect(environment.description.length).toBeGreaterThan(100);
      expect(environment.descriptionEn.length).toBeGreaterThan(100);
      expect([12, 24]).toContain(environment.months);
    }
  });

  test("SKUs, names and categories are unique and use a stable convention", () => {
    const skus = new Set<string>();
    for (const dataset of datasets) {
      const allowed = EXPECTED_CATEGORIES[dataset.environment.id];
      for (const item of dataset.items) {
        expect(item.sku).toMatch(/^[A-Z]{2}-\d{5}$/);
        expect(skus.has(item.sku)).toBe(false);
        skus.add(item.sku);
        expect(item.name.length).toBeGreaterThan(3);
        expect(item.name).not.toMatch(/^(Premium|Compact|Rapid|Smart) (Matlåda|Termos|Grusspade)$/);
        expect(allowed).toContain(item.category ?? "");
        expect(item.subcategory?.length).toBeGreaterThanOrEqual(2);
        expect(item.brand?.length).toBeGreaterThan(2);
        expect(item.unit?.length).toBeGreaterThan(0);
        expect(item.supplier?.length).toBeGreaterThan(3);
        expect(item.price!).toBeGreaterThan(item.cost);
        expect(item.stock).toBeGreaterThanOrEqual(0);
        expect(item.reserved ?? 0).toBeGreaterThanOrEqual(0);
        expect(item.reserved ?? 0).toBeLessThanOrEqual(item.stock);
        expect(item.leadTimeDays!).toBeGreaterThan(0);
        expect(item.moq!).toBeGreaterThan(0);
      }
    }
    expect(skus.size).toBeGreaterThan(150);
  });

  test("monthly history is long enough and agrees with totals", () => {
    for (const dataset of datasets) {
      expect(dataset.months).toBeGreaterThanOrEqual(12);
      for (const item of dataset.items) {
        expect(item.monthly).not.toBeNull();
        expect(item.monthly!.length).toBe(dataset.months);
        expect(item.monthly!.every((value) => Number.isInteger(value) && value >= 0)).toBe(true);
        expect(item.totalSold).toBe(item.monthly!.reduce((sum, value) => sum + value, 0));
        expect(item.totalRevenue).toBeCloseTo(item.totalSold * item.price!, 6);
      }
    }
  });

  test("every environment contains healthy, excess, stockout and inactive situations", () => {
    for (const dataset of datasets) {
      const result = analyze(dataset.items, { months: dataset.months });
      expect(result.kpis.inventoryValue).toBeGreaterThan(0);
      expect(result.kpis.turns).toBeGreaterThan(2);
      expect(result.kpis.turns).toBeLessThan(25);
      expect(result.kpis.deadStockCount).toBeGreaterThan(0);
      expect(result.kpis.overstockCount).toBeGreaterThanOrEqual(3);
      expect(result.kpis.stockoutRiskCount).toBeGreaterThan(0);
      expect(result.kpis.potentialReleaseLow).toBeGreaterThan(0);
      expect(result.items.some((item) => item.action === "ok")).toBe(true);
      expect(result.items.some((item) => item.action === "reduce")).toBe(true);
      expect(result.items.some((item) => item.action === "reorder")).toBe(true);
    }
  });

  test("inventory value, coverage and ABC/XYZ are derived from the same rows", () => {
    for (const dataset of datasets) {
      const result = analyze(dataset.items, { months: dataset.months });
      const value = result.items.reduce((sum, item) => sum + item.stock * item.cost, 0);
      expect(result.kpis.inventoryValue).toBeCloseTo(value, 2);
      for (const item of result.items) {
        expect(item.value).toBeCloseTo(item.stock * item.cost, 2);
        expect(item.available).toBe(item.stock - item.reserved);
        const raw = dataset.items.find((row) => row.sku === item.sku)!;
        if (raw.totalSold > 0) {
          const expected = (item.available / (raw.totalSold / dataset.months)) * 30.44;
          expect(item.coverDays).not.toBeNull();
          expect(item.coverDays!).toBeCloseTo(expected, 0);
        } else {
          expect(item.coverDays).toBeNull();
        }
        expect(["A", "B", "C"]).toContain(item.abc);
      }
      expect(result.abc.reduce((sum, row) => sum + row.count, 0)).toBe(dataset.items.length);
      expect(result.abc.reduce((sum, row) => sum + row.revenueShare, 0)).toBeCloseTo(100, 0);
      const matrix = buildIntelligence(dataset.items, result, { months: dataset.months }).classification.matrix;
      const matrixTotal = matrix.reduce((sum, row) => sum + row.x + row.y + row.z, 0);
      expect(matrixTotal).toBe(result.items.filter((item) => item.xyz !== null).length);
    }
  });

  test("an item without demand gets no misleading XYZ class", () => {
    for (const dataset of datasets) {
      const result = analyze(dataset.items, { months: dataset.months });
      const inactive = result.items.filter((item) => (item.monthlyDemand ?? []).every((value) => value === 0));
      expect(inactive.length).toBeGreaterThan(0);
      for (const item of inactive) {
        expect(item.xyz).toBeNull();
        expect(item.soldPeriod).toBe(0);
        expect(item.action).toBe("write_off");
      }
    }
  });

  test("seasonality and volatility are visible in the actual history", () => {
    const seasonal = buildDemoDataset("hem").items.find((item) => item.sku === "SE-20601")!;
    const values = seasonal.monthly!;
    expect(Math.max(...values)).toBeGreaterThan(Math.min(...values) * 2);
    const winter = buildDemoDataset("ecommerce").items.find((item) => item.sku === "SP-50503")!;
    const cv = (() => {
      const mean = winter.monthly!.reduce((a, b) => a + b, 0) / winter.monthly!.length;
      const variance = winter.monthly!.reduce((a, b) => a + (b - mean) ** 2, 0) / winter.monthly!.length;
      return Math.sqrt(variance) / mean;
    })();
    expect(cv).toBeGreaterThan(0.3);
  });

  test("recommendations carry reasons and traceable amounts", () => {
    for (const dataset of datasets) {
      const result = analyze(dataset.items, { months: dataset.months });
      const intel = buildIntelligence(dataset.items, result, { months: dataset.months });
      expect(intel.priorities.length).toBeGreaterThan(0);
      for (const priority of intel.priorities) {
        expect(priority.reasons.length).toBeGreaterThan(0);
        expect(priority.value).toBeGreaterThanOrEqual(0);
      }
      expect(intel.capital.byCategory.reduce((sum, row) => sum + row.value, 0)).toBeCloseTo(result.kpis.inventoryValue, 0);
    }
  });

  test("demo CSV round-trips to the same inventory positions and value", () => {
    for (const dataset of datasets) {
      const parsed = parseCsv(demoCsv(dataset));
      const mapping = detectMapping(parsed.headers, parsed.rows);
      const built = buildDataset(parsed, mapping);
      expect(built.errors).toEqual([]);
      const result = analyze(built.items, { months: dataset.months });
      const original = analyze(dataset.items, { months: dataset.months });
      expect(result.items.length).toBe(dataset.items.length);
      expect(result.kpis.inventoryValue).toBeCloseTo(original.kpis.inventoryValue, 2);
      for (const item of dataset.items) {
        const imported = built.items.find((row) => row.sku === item.sku)!;
        expect(imported.stock).toBe(item.stock);
        expect(imported.reserved).toBe(item.reserved);
        expect(imported.subcategory).toBe(item.subcategory);
        expect(imported.brand).toBe(item.brand);
        expect(imported.unit).toBe(item.unit);
        expect(imported.shelfLifeDays).toBe(item.shelfLifeDays ?? null);
        expect(imported.storage).toBe(item.storage ?? null);
      }
    }
  });

  test("foodservice carries shelf life, storage and FEFO waste risk", () => {
    const dataset = buildDemoDataset("foodservice");
    const result = analyze(dataset.items, { months: dataset.months });
    for (const item of dataset.items) {
      expect(item.shelfLifeDays).toBeGreaterThan(0);
      expect(item.storage?.length).toBeGreaterThan(3);
    }
    expect(result.items.some((item) => item.coverDays !== null && item.coverDays > item.shelfLifeDays!)).toBe(true);
  });

  test("CSV exports the same rows and the expected 12/24 month columns", () => {
    for (const dataset of datasets) {
      const csv = demoCsv(dataset);
      const lines = csv.trim().split("\r\n");
      expect(lines.length).toBe(dataset.items.length + 1);
      const header = lines[0]!.split(";");
      expect(header.slice(-dataset.months).every((label) => /^\d{4}-\d{2}$/.test(label))).toBe(true);
      expect(csv).toContain(dataset.items[0]!.sku);
    }
  });
});
