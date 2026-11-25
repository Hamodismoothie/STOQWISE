import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { analyze } from "../src/analysis.ts";
import { parseCsv } from "../src/csv.ts";
import { buildDataset } from "../src/dataset.ts";
import { detectMapping } from "../src/mapping.ts";
import {
  buildWarehouseScene,
  rackStatus,
  stackBoxes,
  DEPTH_BANDS,
  STACK_CAP,
  STOCKOUT_PULSE_HZ,
  type SceneArticle,
  type SceneMetrics,
} from "../src/ui/scene.ts";

/**
 * The scene adapter is tested without WebGL: it is a pure mapping from the
 * analysis to a warehouse model. Counts must follow the input exactly, and the
 * geometry rules (ABC depth, log stacks, pattern by XYZ, signal per status)
 * must hold for any portfolio.
 */

const METRICS: SceneMetrics = {
  inventoryValue: 500_115,
  skuCount: 36,
  stockUnits: 8_212,
  overstockValue: 267_683,
  overstockCount: 20,
  deadStockValue: 0,
  deadStockCount: 0,
  stockoutRiskCount: 6,
  stockoutRiskValue: 5_781,
  turns: 4.87,
  daysOfInventory: 75,
  potentialReleaseLow: 66_920.75,
  potentialReleaseHigh: 147_225.65,
};

const CATEGORIES = [
  "Arbetsskydd & Kläder",
  "Fästelement & Beslag",
  "El & Belysning",
  "Förpackning",
  "Städ & Hygien",
  "Kontor & Skrivmaterial",
  "Verktyg",
];

/** 36 articles: ABC 9/13/14, 6 stockouts, 20 overslocked, nothing inactive. */
function portfolio(): SceneArticle[] {
  return Array.from({ length: 36 }, (_, i) => {
    const abc = i < 9 ? "A" : i < 22 ? "B" : "C";
    const stockoutRisk = i < 6;
    const overstockQty = i >= 6 && i < 26 ? 40 + i : 0;
    const xyz = (["X", "Y", "Z", null] as const)[i % 4];
    return {
      sku: `ART-${String(i + 1).padStart(4, "0")}`,
      name: `Artikel ${i + 1}`,
      category: CATEGORIES[i % CATEGORIES.length]!,
      stock: i === 35 ? 0 : 12 + i * 3,
      value: 1_000 + i * 250,
      abc,
      xyz,
      action: stockoutRisk ? "reorder" : overstockQty > 0 ? "reduce" : "ok",
      overstockQty,
      stockoutRisk,
    } satisfies SceneArticle;
  });
}

describe("scenadapter – mappning", () => {
  const articles = portfolio();
  const scene = buildWarehouseScene(METRICS, articles);

  test("ett ställ per artikel, inga påhittade", () => {
    expect(scene.counts.racks).toBe(36);
    expect(scene.racks.map((r) => r.sku)).toEqual(articles.map((a) => a.sku));
  });

  test("statusräkning: 6 bristrisk, 20 överlager, 0 inaktiv", () => {
    expect(scene.counts.byStatus.stockout).toBe(6);
    expect(scene.counts.byStatus.overstock).toBe(20);
    expect(scene.counts.byStatus.inactive).toBe(0);
    expect(scene.counts.byStatus.balanced).toBe(10);
  });

  test("ABC-fördelning 9/13/14", () => {
    expect(scene.counts.byAbc).toEqual({ A: 9, B: 13, C: 14 });
  });

  test("A ligger närmast docken, C längst bort", () => {
    const depth = (cls: "A" | "B" | "C") => scene.racks.filter((r) => r.abc === cls).map((r) => r.depth);
    const a = depth("A");
    const b = depth("B");
    const c = depth("C");
    expect(Math.max(...a)).toBeLessThanOrEqual(DEPTH_BANDS.A.to);
    expect(Math.min(...b)).toBeGreaterThanOrEqual(DEPTH_BANDS.B.from);
    expect(Math.max(...b)).toBeLessThanOrEqual(DEPTH_BANDS.B.to);
    expect(Math.min(...c)).toBeGreaterThanOrEqual(DEPTH_BANDS.C.from);
    expect(Math.max(...a)).toBeLessThan(Math.min(...b));
    expect(Math.max(...b)).toBeLessThan(Math.min(...c));
    for (const rack of scene.racks) expect(rack.depth).toBeGreaterThanOrEqual(0);
    for (const rack of scene.racks) expect(rack.depth).toBeLessThanOrEqual(1);
  });

  test("lådstacken är logaritmisk, kapad och tom vid noll saldo", () => {
    expect(stackBoxes(0)).toBe(0);
    expect(stackBoxes(-5)).toBe(0);
    expect(stackBoxes(1)).toBe(1);
    expect(stackBoxes(10_000)).toBeLessThan(STACK_CAP);
    expect(stackBoxes(1_000_000)).toBe(STACK_CAP);
    let previous = 0;
    for (const qty of [0, 1, 5, 25, 120, 600, 3_000, 20_000]) {
      const boxes = stackBoxes(qty);
      expect(boxes).toBeGreaterThanOrEqual(previous);
      expect(boxes).toBeLessThanOrEqual(STACK_CAP);
      previous = boxes;
    }
    const empty = scene.racks.find((r) => r.sku === "ART-0036")!;
    expect(empty.boxes).toBe(0);
    expect(empty.stackHeight).toBe(0);
  });

  test("XYZ styr ytan: X slät, Y streckad, Z prickad", () => {
    const bySku = new Map(articles.map((a) => [a.sku, a]));
    for (const rack of scene.racks) {
      const xyz = bySku.get(rack.sku)!.xyz;
      expect(rack.pattern).toBe(xyz === "X" ? "smooth" : xyz === "Y" ? "striped" : "dotted");
    }
    expect(scene.counts.byPattern.smooth).toBeGreaterThan(0);
    expect(scene.counts.byPattern.striped).toBeGreaterThan(0);
    expect(scene.counts.byPattern.dotted).toBeGreaterThan(0);
  });

  test("signal per status: glöd, långsam puls, damm", () => {
    for (const rack of scene.racks) {
      if (rack.status === "overstock") {
        expect(rack.signal).toEqual({ kind: "glow", hz: null });
      } else if (rack.status === "stockout") {
        expect(rack.signal.kind).toBe("pulse");
        expect(rack.signal.hz).not.toBeNull();
        expect(rack.signal.hz!).toBeLessThanOrEqual(1);
        expect(rack.signal.hz).toBe(STOCKOUT_PULSE_HZ);
      } else if (rack.status === "inactive") {
        expect(rack.signal.kind).toBe("dust");
      } else {
        expect(rack.signal.kind).toBe("none");
      }
    }
  });

  test("statusprioritet: inaktiv slår brist och överlager", () => {
    expect(rackStatus({ action: "write_off", stockoutRisk: true, overstockQty: 10 })).toBe("inactive");
    expect(rackStatus({ action: "liquidate", stockoutRisk: true, overstockQty: 0 })).toBe("inactive");
    expect(rackStatus({ action: "reorder", stockoutRisk: true, overstockQty: 10 })).toBe("stockout");
    expect(rackStatus({ action: "reduce", stockoutRisk: false, overstockQty: 10 })).toBe("overstock");
    expect(rackStatus({ action: "ok", stockoutRisk: false, overstockQty: 0 })).toBe("balanced");
  });

  test("gångar grupperas per kategori, största kapitalet först", () => {
    expect(scene.aisles.length).toBeLessThanOrEqual(CATEGORIES.length);
    expect(scene.aisles.reduce((a, aisle) => a + aisle.racks, 0)).toBe(36);
    const values = scene.aisles.map((a) => a.value);
    expect([...values].sort((a, b) => b - a)).toEqual(values);
    for (const rack of scene.racks) {
      expect(rack.aisle).toBeGreaterThanOrEqual(0);
      expect(rack.aisle).toBeLessThan(scene.aisles.length);
    }
  });

  test("HUD visar tal från metrics och text från ordlistan", () => {
    expect(scene.hud.tiles).toHaveLength(5);
    const values = scene.hud.tiles.map((tile) => tile.value).join(" ");
    expect(values).toContain("500");
    expect(values).toContain("4,87");
    expect(values).toContain("6");
    for (const tile of scene.hud.tiles) {
      expect(tile.label.length).toBeGreaterThan(0);
      expect(tile.value.length).toBeGreaterThan(0);
    }
    expect(scene.hud.caption).toContain("Syntetisk");
    for (const rack of scene.racks) {
      expect(rack.label.title.length).toBeGreaterThan(0);
      expect(rack.label.value.length).toBeGreaterThan(0);
      expect(rack.label.status.length).toBeGreaterThan(0);
    }
  });

  test("engelska HUD innehåller inga svenska statusord", () => {
    const en = buildWarehouseScene(METRICS, articles, { locale: "en" });
    expect(en.hud.title).toBe("Inventory overview");
    expect(en.hud.tiles[0]!.label).toBe("Inventory value");
    const text = [en.hud.title, en.hud.subtitle, ...en.hud.tiles.flatMap((t) => [t.label, t.value]), ...en.hud.legend.map((l) => l.label), en.hud.caption, ...en.racks.flatMap((r) => [r.label.status, r.label.pattern])].join(" | ");
    for (const swedish of ["Överlager", "Bristrisk", "Inaktivt lager", "Slät yta", "Prickad yta", "Lageromsättning"]) {
      expect(text).not.toContain(swedish);
    }
  });

  test("deterministisk: samma underlag ger samma scen", () => {
    const again = buildWarehouseScene(METRICS, portfolio());
    expect(again.racks.map((r) => [r.sku, r.depth, r.boxes, r.aisle, r.status])).toEqual(
      scene.racks.map((r) => [r.sku, r.depth, r.boxes, r.aisle, r.status]),
    );
  });
});

/**
 * The fixture mirror test. It only runs when the agreed test file is on disk;
 * the suite reports it as skipped rather than silently passing.
 */
const FIXTURE = new URL("./fixtures/STOQWISE_Testdata_36_Artiklar.csv", import.meta.url);
const hasFixture = existsSync(FIXTURE);

describe("scenadapter – fixtur", () => {
  test.skipIf(!hasFixture)("36 ställ, 6 brist, 20 överlager, 0 inaktiva, ABC 9/13/14", () => {
    const parsed = parseCsv(readFileSync(FIXTURE, "utf8"));
    const mapping = detectMapping(parsed.headers, parsed.rows);
    const dataset = buildDataset(parsed, mapping);
    expect(dataset.errors).toEqual([]);
    expect(dataset.items).toHaveLength(36);

    const result = analyze(dataset.items, { months: 12 });
    const scene = buildWarehouseScene(result.kpis, result.items);

    expect(scene.counts.racks).toBe(36);
    expect(scene.counts.byStatus.stockout).toBe(6);
    expect(scene.counts.byStatus.overstock).toBe(20);
    expect(scene.counts.byStatus.inactive).toBe(0);
    expect(scene.counts.byAbc).toEqual({ A: 9, B: 13, C: 14 });
  });
});
