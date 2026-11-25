import { describe, expect, test } from "bun:test";
import { analyze } from "../src/analysis.ts";
import type { ItemInput } from "../src/dataset.ts";
import { abcXyzMatrix } from "../src/ui/charts.ts";
import { appWorldTable } from "../src/pages/world-app.ts";
import { buildAppWorld, simulatePortfolio } from "../src/world.ts";

/**
 * Lagervärld shows the customer's own rows. These tests pin the two contracts
 * that matter: the scene is built from the analysis (not from invented demo
 * numbers), and the what-if is a pure calculation that leaves the import alone.
 */

function item(over: Partial<ItemInput> & { sku: string }): ItemInput {
  return {
    name: over.sku,
    category: null,
    supplier: null,
    stock: 0,
    cost: 100,
    price: 200,
    leadTimeDays: 30,
    moq: null,
    monthly: null,
    totalSold: 0,
    totalRevenue: null,
    ...over,
  };
}

const steady = (qty: number) => Array.from({ length: 12 }, () => qty);

const items: ItemInput[] = Array.from({ length: 40 }, (_, i) =>
  item({
    sku: `SKU-${String(i + 1).padStart(3, "0")}`,
    category: i % 3 === 0 ? "Verktyg" : i % 3 === 1 ? "Fästelement" : "El",
    stock: 10 + i * 4,
    monthly: i % 5 === 0 ? steady(0) : steady(2 + (i % 7)),
  }),
);

const result = analyze(items, { months: 12 });

describe("Live Warehouse-tabellen", () => {
  const many = analyze(
    Array.from({ length: 120 }, (_, i) =>
      item({
        sku: `TAB-${String(i + 1).padStart(3, "0")}`,
        category: i % 2 === 0 ? "Verktyg" : "El",
        stock: i + 1,
        monthly: steady(1 + (i % 5)),
      }),
    ),
    { months: 12 },
  );

  test("filtrerar hela beståndet och paginerar alla träffar", () => {
    const first = appWorldTable({ items: many.items, locale: "sv", analysisId: "a1" });
    expect(first.total).toBe(120);
    expect(first.pages).toBe(3);
    expect((first.html.match(/<tr data-sku=/g) ?? []).length).toBe(50);

    const last = appWorldTable({ items: many.items, locale: "sv", analysisId: "a1", page: 3 });
    expect(last.page).toBe(3);
    expect((last.html.match(/<tr data-sku=/g) ?? []).length).toBe(20);
    expect(last.note).toContain("101–120");
  });

  test("kategori, sökning och sortering gäller alla artiklar", () => {
    const category = appWorldTable({ items: many.items, locale: "sv", analysisId: "a1", category: "Verktyg" });
    expect(category.total).toBe(60);
    expect(category.html).not.toContain('data-category="El"');

    const search = appWorldTable({ items: many.items, locale: "sv", analysisId: "a1", query: "TAB-120" });
    expect(search.total).toBe(1);
    expect(search.html).toContain("TAB-120");

    const stock = appWorldTable({ items: many.items, locale: "sv", analysisId: "a1", sort: "stock", dir: "asc" });
    expect(stock.html.indexOf('data-sku="TAB-001"')).toBeLessThan(stock.html.indexOf('data-sku="TAB-002"'));
  });
});

describe("lagervärldens modell", () => {
  test("ett ställ per artikel under gränsen", () => {
    const model = buildAppWorld(result.items, result.kpis, "sv");
    expect(model.mode).toBe("racks");
    expect(model.racks).toHaveLength(result.kpis.skuCount);
    expect(model.omitted).toBe(0);
    expect(new Set(model.racks.map((r) => r.sku)).size).toBe(model.racks.length);
  });

  test("ställens värden kommer från analysen", () => {
    const model = buildAppWorld(result.items, result.kpis, "sv");
    const bySku = new Map(result.items.map((i) => [i.sku, i]));
    for (const rack of model.racks) {
      const analysed = bySku.get(rack.sku)!;
      expect(rack.value).toBe(Math.round(analysed.value));
      expect(rack.abc).toBe(analysed.abc);
    }
    const rackValue = model.racks.reduce((sum, rack) => sum + rack.value, 0);
    expect(Math.abs(rackValue - result.kpis.inventoryValue)).toBeLessThanOrEqual(model.racks.length);
  });

  test("kategorierna summerar till antalet ställ", () => {
    const model = buildAppWorld(result.items, result.kpis, "sv");
    expect(model.categories.reduce((sum, c) => sum + c.racks, 0)).toBe(model.racks.length);
    expect(model.categories.length).toBeGreaterThan(1);
  });

  test("över detaljbudgeten visas utbyggbara kluster för hela beståndet", () => {
    const model = buildAppWorld(result.items, result.kpis, "sv", { limit: 10 });
    expect(model.mode).toBe("hierarchical");
    expect(model.racks).toHaveLength(0);
    expect(model.omitted).toBe(0);
    expect(model.summary.articles).toBe(result.kpis.skuCount);
    expect(model.clusters.length).toBeGreaterThan(0);
    expect(model.clusters.reduce((sum, cluster) => sum + cluster.articles, 0)).toBe(result.kpis.skuCount);
    expect(model.categories.reduce((sum, c) => sum + c.racks, 0)).toBe(result.kpis.skuCount);
    for (const category of model.categories) {
      const statusSum = Object.values(category.status).reduce((a, b) => a + b, 0);
      expect(statusSum).toBe(category.racks);
    }
  });
});

describe("tänk om på egna data", () => {
  const settings = { months: 12, serviceLevel: 0.95 };

  test("räknar om utan att röra indata", () => {
    const snapshot = JSON.stringify(items);
    const simulation = simulatePortfolio(items, settings, { leadDeltaDays: 7, demandPct: 10 }, "sv");
    expect(JSON.stringify(items)).toBe(snapshot);
    expect(simulation.counts.racks).toBe(result.kpis.skuCount);
    expect(Object.keys(simulation.statusBySku)).toHaveLength(result.kpis.skuCount);
    for (const status of Object.values(simulation.statusBySku)) {
      expect(["balanced", "overstock", "stockout", "inactive"]).toContain(status);
    }
  });

  test("längre ledtid ger inte lägre bristrisk", () => {
    const base = simulatePortfolio(items, settings, {}, "sv");
    const longer = simulatePortfolio(items, settings, { leadDeltaDays: 20 }, "sv");
    expect(longer.counts.byStatus.stockout).toBeGreaterThanOrEqual(base.counts.byStatus.stockout);
  });

  test("högre efterfrågan ger inte mindre överlager", () => {
    const base = simulatePortfolio(items, settings, {}, "sv");
    const up = simulatePortfolio(items, settings, { demandPct: 30 }, "sv");
    expect(up.counts.byStatus.overstock).toBeLessThanOrEqual(base.counts.byStatus.overstock);
  });
});

describe("ABC/XYZ-matrisen som filter", () => {
  const matrix = [
    { abc: "A", x: 2, y: 1, z: 0, value: 0 },
    { abc: "B", x: 1, y: 2, z: 1, value: 0 },
    { abc: "C", x: 0, y: 1, z: 3, value: 0 },
  ];
  const html = abcXyzMatrix(matrix, {
    locale: "sv",
    analysisId: "analys-1",
    articles: result.items.map((i) => ({ sku: i.sku, name: i.name, abc: i.abc, xyz: i.xyz, action: i.action, value: i.value })),
    cutoffs: { abcA: 0.8, abcB: 0.95, xyzX: 0.5, xyzY: 1 },
  });

  test("varje ruta är en länk till filtrerad artikelista", () => {
    for (const key of ["AX", "AY", "AZ", "BX", "BY", "BZ", "CX", "CY", "CZ"]) {
      expect(html).toContain(`data-matrix-cell="${key}"`);
      expect(html).toContain(`abc=${key[0]}&xyz=${key[1]}`);
    }
  });

  test("panelen listar artiklar, åtgärder och exakta gränser", () => {
    expect(html).toContain("data-matrix-detail=");
    expect(html).toContain("Gränser: ABC");
    expect(html).toContain("A: andelen före artikeln &lt; 80 %");
    expect(html).toContain("XYZ efter variationskoefficient");
    const cellArticles = result.items
      .filter((i) => i.abc === "A" && i.xyz === "X")
      .sort((a, b) => b.value - a.value);
    if (cellArticles.length) expect(html).toContain(`data-sku="${cellArticles[0]!.sku}"`);
  });
});
