import { describe, expect, test } from "bun:test";
import { worldEnvironments, whatIf, normalizeWhatIf, WHAT_IF_LIMITS } from "../src/world.ts";
import { worldSection } from "../src/pages/world.ts";
import { DEMO_ENVIRONMENTS } from "../src/demo.ts";

/**
 * The public world is only allowed to show numbers the engine produced.
 * These tests pin the contract between the landing page, the what-if endpoint
 * and the scene adapter - they never invent an expected inventory figure.
 */

describe("demovärldens data", () => {
  const environments = worldEnvironments("sv");

  test("alla demomiljöer har 36–60 artiklar vardera", () => {
    expect(environments.map((e) => e.id)).toEqual(DEMO_ENVIRONMENTS.map((m) => m.id));
    for (const environment of environments) {
      expect(environment.scene.counts.racks).toBeGreaterThanOrEqual(36);
      expect(environment.scene.counts.racks).toBeLessThanOrEqual(60);
      expect(environment.kpis.skuCount).toBe(environment.scene.counts.racks);
      expect(environment.scene.racks).toHaveLength(environment.scene.counts.racks);
    }
  });

  test("status- och ABC-räkningarna summerar till antalet ställ", () => {
    for (const { scene } of environments) {
      const statusSum = Object.values(scene.counts.byStatus).reduce((a, b) => a + b, 0);
      const abcSum = Object.values(scene.counts.byAbc).reduce((a, b) => a + b, 0);
      const patternSum = Object.values(scene.counts.byPattern).reduce((a, b) => a + b, 0);
      expect(statusSum).toBe(scene.counts.racks);
      expect(abcSum).toBe(scene.counts.racks);
      expect(patternSum).toBe(scene.counts.racks);
    }
  });

  test("HUD:en har fem plattor och demodata-märkning", () => {
    for (const { scene } of environments) {
      expect(scene.hud.tiles).toHaveLength(5);
      expect(scene.hud.caption).toContain("Syntetisk");
    }
  });
});

describe("tänk om", () => {
  test("standardvärden ger exakt samma siffror som demofilen", () => {
    for (const meta of DEMO_ENVIRONMENTS) {
      const base = whatIf(meta.id, {}, "sv");
      expect(base.kpis).toEqual(worldEnvironments("sv").find((e) => e.id === meta.id)!.kpis);
      expect(base.delta.overstockValue).toBe(0);
      expect(base.delta.stockoutRiskValue).toBe(0);
      expect(base.delta.turns).toBe(0);
      expect(base.delta.stockoutRiskCount).toBe(0);
    }
  });

  test("reglagen kläms till sina intervall och servicenivån snapas", () => {
    expect(normalizeWhatIf({ leadDeltaDays: 999, demandPct: -999, serviceLevel: 0.5 })).toEqual({
      leadDeltaDays: WHAT_IF_LIMITS.leadDeltaDays.max,
      demandPct: WHAT_IF_LIMITS.demandPct.min,
      serviceLevel: 0.95,
    });
    expect(normalizeWhatIf({ leadDeltaDays: -999 }).leadDeltaDays).toBe(WHAT_IF_LIMITS.leadDeltaDays.min);
    expect(normalizeWhatIf({ serviceLevel: 0.99 }).serviceLevel).toBe(0.99);
    expect(normalizeWhatIf({ demandPct: 7 }).demandPct).toBe(5);
  });

  test("höjd efterfrågan ökar den riskerade försäljningen", () => {
    const base = whatIf("ecommerce", {}, "sv");
    const up = whatIf("ecommerce", { demandPct: 30 }, "sv");
    expect(up.kpis.stockoutRiskValue).toBeGreaterThanOrEqual(base.kpis.stockoutRiskValue);
    expect(up.params.demandPct).toBe(30);
  });

  test("statuskartan täcker varje artikel och använder kända statusar", () => {
    const result = whatIf("industri", { leadDeltaDays: 10 }, "sv");
    const allowed = new Set(["balanced", "overstock", "stockout", "inactive"]);
    const keys = Object.keys(result.statusBySku);
    expect(keys).toHaveLength(result.counts.racks);
    for (const status of Object.values(result.statusBySku)) expect(allowed.has(status)).toBe(true);
    const counted = Object.values(result.statusBySku).filter((s) => s === "stockout").length;
    expect(counted).toBe(result.counts.byStatus.stockout);
  });

  test("alla tal är ändliga (ingen NaN i världen)", () => {
    for (const meta of DEMO_ENVIRONMENTS) {
      const result = whatIf(meta.id, { leadDeltaDays: 20, serviceLevel: 0.99, demandPct: 30 }, "sv");
      for (const value of Object.values(result.kpis)) {
        if (value === null) continue;
        expect(Number.isFinite(value)).toBe(true);
      }
      for (const value of Object.values(result.delta)) expect(Number.isFinite(value)).toBe(true);
    }
  });
});

describe("publik sektion", () => {
  const environments = worldEnvironments("sv");
  const html = worldSection({ locale: "sv", environments, metas: DEMO_ENVIRONMENTS });

  test("canvas är dekor och allt innehåll finns i DOM", () => {
    expect(html).toContain('<canvas class="world-canvas" data-world-canvas aria-hidden="true"');
    for (const heading of ["Importera lagerdata.", "Förstå ditt lager.", "Förutse efterfrågan.", "Optimera dina beslut."]) {
      expect(html).toContain(`>${heading}<`);
    }
    expect(html).toContain("Syntetisk demodata, inte verkliga kunddata");
    expect(html).toContain("Lagervärde");
  });

  test("lagret går att lämna och slutar med en diskret uppmaning", () => {
    expect(html).not.toContain("Skyltar i lagret");
    expect(html).not.toContain("Navigering från lagergolvet");
    expect(html).not.toContain('class="world-signs"');
    expect(html).toContain("data-world-exit-2");
    expect(html).toContain("Vill du se vad som döljer sig bakom siffrorna?");
    expect(html).toContain("Utforska STOQWISE eller skapa ett konto.");
    expect(html).not.toContain("Justera antagandena");
    expect(html).not.toContain("data-whatif-form");
  });

  test("fyra steg har en kompakt, central visualisering", () => {
    expect(html).toContain("data-world-story");
    expect(html).toContain("world-import-flow");
    expect(html).toContain("world-matrix");
    expect(html).toContain("world-chart");
    expect(html).toContain("world-optimise");
    // The public story shows aggregates and one proposal, not the full registers.
    expect(html).not.toContain("world-fields");
    expect(html).not.toContain("world-table");
    expect(html).not.toContain("world-totals");
    expect(html).not.toContain("data-world-scenario");
    expect(html).not.toContain("Säkerhetslager");
    expect(html).not.toContain("Beställningspunkt");
    expect(html).not.toContain("MOQ");
  });

  test("ABC/XYZ-matrisen är aggregerad och beskriver lagervärdet", () => {
    for (const environment of environments) {
      const matrix = environment.story.analysis.matrix;
      expect(matrix).toHaveLength(9);
      const counted = matrix.reduce((sum, cell) => sum + cell.count, 0);
      expect(counted).toBeLessThanOrEqual(environment.story.import.items);
      for (const cell of matrix) {
        expect(cell.count).toBeGreaterThanOrEqual(0);
        expect(cell.share).toBeGreaterThanOrEqual(0);
        expect(cell.share).toBeLessThanOrEqual(1);
      }
    }
  });

  test("postern ritas av samma scenmodell", () => {
    const poster = html.slice(html.indexOf("world-poster"), html.indexOf("</svg>"));
    expect(poster).toContain("wp-rack");
    expect((poster.match(/wp-rack /g) ?? []).length).toBe(environments[0]!.scene.counts.racks);
  });

  test("nyttolasten går att läsa och innehåller bara demodata", () => {
    const match = html.match(/<script type="application\/json" data-world-data>([\s\S]*?)<\/script>/);
    expect(match).not.toBeNull();
    const payload = JSON.parse(match![1]!);
    expect(payload).toHaveLength(DEMO_ENVIRONMENTS.length);
    for (const environment of payload) {
      expect(environment.racks.length).toBeGreaterThanOrEqual(36);
      expect(environment.racks.length).toBeLessThanOrEqual(60);
      expect(environment.kpis.skuCount).toBe(environment.racks.length);
      for (const rack of environment.racks) {
        expect(rack.sku.startsWith("ART-") || rack.sku.length > 2).toBe(true);
        expect(["smooth", "striped", "dotted"]).toContain(rack.pattern);
      }
    }
    // No customer fields leak into the public payload.
    expect(match![1]).not.toContain("orgNumber");
    expect(match![1]).not.toContain("supplier");
  });

  test("engelsk sektion innehåller ingen svensk rubrik", () => {
    const english = worldSection({ locale: "en", environments: worldEnvironments("en"), metas: DEMO_ENVIRONMENTS });
    for (const swedish of ["Skyltar i lagret", "Demolagret", "Importera lagerdata.", "Vill du se vad som döljer sig bakom siffrorna?", "Syntetisk demodata"]) {
      expect(english).not.toContain(swedish);
    }
    expect(english).toContain("Import inventory data.");
    expect(english).toContain("Forecast demand.");
    expect(english).toContain("Synthetic demo data");
    expect(english).toContain("Want to see what is hiding behind the numbers?");
  });
});
