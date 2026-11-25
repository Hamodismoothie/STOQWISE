import { describe, expect, test } from "bun:test";
import { analyze } from "../src/analysis.ts";
import type { ItemInput } from "../src/dataset.ts";
import { buildLiveWarehouse, LIVE_DETAIL_SLOT_BUDGET, TECHNICAL_ITEM_CAPACITY, locateLiveArticle, locateLiveArticles, liveCategory, liveClusterDetail, replenishList } from "../src/ui/live-warehouse.ts";

/**
 * The Live Warehouse layout must be a pure function of the analysis: every
 * article gets exactly one slot, the ABC strategy is spatial, inactive stock is
 * quarantined, and the replenishment list is derived from reorder points.
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

const items: ItemInput[] = [
  ...Array.from({ length: 24 }, (_, i) =>
    item({
      sku: `FAST-${i}`,
      category: i % 4 === 0 ? "Verktyg" : i % 4 === 1 ? "Fästelement" : i % 4 === 2 ? "El" : "Kemi",
      stock: 20 + i * 12,
      monthly: steady(2 + (i % 6)),
    }),
  ),
  ...Array.from({ length: 6 }, (_, i) =>
    item({
      sku: `DEAD-${i}`,
      category: "Verktyg",
      stock: 400,
      monthly: Array.from({ length: 12 }, (_, m) => (m < 3 ? 1 : 0)),
    }),
  ),
  ...Array.from({ length: 4 }, (_, i) =>
    item({
      sku: `SLUT-${i}`,
      category: "El",
      stock: 2,
      monthly: steady(40),
    }),
  ),
];

const result = analyze(items, { months: 12 });
const model = buildLiveWarehouse(result.items, "sv");

describe("live warehouse-layouten", () => {
  test("varje artikel får exakt en lagerplats", () => {
    expect(model.mode).toBe("racks");
    expect(model.slots).toHaveLength(result.items.length);
    expect(new Set(model.slots.map((slot) => slot.sku)).size).toBe(result.items.length);
    const positions = new Set(model.slots.map((slot) => `${slot.x}:${slot.z}:${slot.level}`));
    expect(positions.size).toBe(model.slots.length);
  });

  test("ABC är en rumslig strategi: A närmast utlastning, C längst bort", () => {
    const average = (band: "A" | "B" | "C") => {
      const rows = model.slots.filter((slot) => slot.band === band);
      return rows.reduce((sum, slot) => sum + slot.z, 0) / rows.length;
    };
    expect(average("A")).toBeGreaterThan(average("B"));
    expect(average("B")).toBeGreaterThan(average("C"));
  });

  test("inaktiva artiklar hamnar i karantänzonen", () => {
    const inactive = result.items.filter((entry) => entry.action === "write_off" || entry.action === "liquidate");
    expect(inactive.length).toBeGreaterThan(0);
    for (const entry of inactive) {
      const slot = model.slots.find((row) => row.sku === entry.sku)!;
      expect(slot.zone).toBe("inactive");
      expect(slot.band).toBe("inactive");
    }
  });

  test("plockfronter finns bara för A och B och pekar på rätt artikel", () => {
    expect(model.picks.length).toBeGreaterThan(0);
    for (const pick of model.picks) {
      expect(["A", "B"]).toContain(pick.abc);
      const slot = model.slots.find((row) => row.sku === pick.sku)!;
      expect(slot.abc).toBe(pick.abc);
      expect(pick.cartons).toBeGreaterThan(0);
    }
  });

  test("pallar och fyllnad följer saldot", () => {
    const total = model.slots.reduce((sum, slot) => sum + slot.pallets, 0);
    expect(total).toBe(model.summary.pallets);
    for (const slot of model.slots) {
      expect(slot.pallets).toBeGreaterThanOrEqual(0);
      expect(slot.pallets).toBeLessThanOrEqual(4);
      expect(slot.fill).toBeGreaterThanOrEqual(0);
      expect(slot.fill).toBeLessThanOrEqual(1);
      if (slot.stock === 0) expect(slot.pallets).toBe(0);
      if (slot.stock > 0) expect(slot.pallets).toBeGreaterThan(0);
    }
  });

  test("påfyllningslistan kommer från beställningspunkten", () => {
    const list = replenishList(result.items, 10);
    expect(list.length).toBeGreaterThan(0);
    for (const entry of list) {
      const analysed = result.items.find((row) => row.sku === entry.sku)!;
      expect(entry.qty).toBeGreaterThan(0);
      expect(
        analysed.available <= analysed.reorderPoint ||
          (analysed.coverDays !== null && analysed.coverDays < analysed.leadTimeDays),
      ).toBe(true);
    }
  });

  test("över detaljbudgeten blir hela beståndet utbyggbara kluster", () => {
    const hierarchical = buildLiveWarehouse(result.items, "sv", { limit: 5 });
    expect(hierarchical.mode).toBe("hierarchical");
    expect(hierarchical.slots).toHaveLength(0);
    expect(hierarchical.blocks.length).toBeGreaterThan(0);
    expect(hierarchical.omitted).toBe(0);
    expect(hierarchical.summary.articles).toBe(result.items.length);
    expect(hierarchical.blocks.reduce((sum, block) => sum + block.racks, 0)).toBe(result.items.length);
    expect(hierarchical.clusters).toHaveLength(hierarchical.blocks.length);
    for (const block of hierarchical.blocks) {
      expect(block.categoryName).toBeTruthy();
      expect(block.category).toContain(block.categoryName!);
    }
  });

  test("varje artikel går att lokalisera och expandera även i klusterläge", () => {
    const hierarchical = buildLiveWarehouse(result.items, "sv", { limit: 5 });
    for (const entry of result.items) {
      const location = locateLiveArticle(result.items, entry.sku, "sv", { detailLimit: 5 });
      expect(location).not.toBeNull();
      expect(location!.clusterId).not.toBeNull();
      const detail = liveClusterDetail(result.items, location!.clusterIndex!, "sv");
      expect(detail).not.toBeNull();
      expect(detail!.cluster.categoryName).toBe(liveCategory(entry, "sv"));
      expect(detail!.cluster.xyz).toBe(entry.xyz);
      expect(detail!.slots.some((slot) => slot.sku === entry.sku)).toBe(true);
    }
    expect(hierarchical.blocks.reduce((sum, block) => sum + block.racks, 0)).toBe(result.items.length);
  });

  test("batchlokalisering ger exakt samma placering som enkel uppslagning", () => {
    const skus = result.items.map((entry) => entry.sku);
    const batch = locateLiveArticles(result.items, skus, "sv", { detailLimit: 5 });
    expect(batch.size).toBe(skus.length);
    for (const sku of skus) {
      const single = locateLiveArticle(result.items, sku, "sv", { detailLimit: 5 });
      const many = batch.get(sku);
      expect(many ?? null).toEqual(single);
    }
  });

  test("plattformskapaciteten är 500 000 och detaljbudgeten är en renderingsbudget", () => {
    expect(TECHNICAL_ITEM_CAPACITY).toBe(500_000);
    expect(LIVE_DETAIL_SLOT_BUDGET).toBeGreaterThan(1_000);
  });
});
