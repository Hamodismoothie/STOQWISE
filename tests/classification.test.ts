import { describe, expect, test } from "bun:test";
import { analyze } from "../src/analysis.ts";
import { auditAnalysis } from "../src/audit.ts";
import { CLASSIFICATION_VERSION, classifyAbc, evaluateXyz, refreshClassification } from "../src/core/classification.ts";
import { collapseDailyValues } from "../src/core/history.ts";
import { buildIntelligence } from "../src/core/intelligence.ts";
import type { ItemInput } from "../src/dataset.ts";
import { abcXyzMatrix } from "../src/ui/charts.ts";

/**
 * These tests use hand-computed data so the expected class, CV and totals can
 * be checked without running the engine against itself.
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

const steady = (qty: number, months = 12) => Array.from({ length: months }, () => qty);

describe("gemensam ABC-klassificering", () => {
  test("kumulativ andel före artikeln: den som passerar 80 % stannar i A", () => {
    const ranking = classifyAbc([
      { sku: "A1", measure: 50 },
      { sku: "A2", measure: 30 },
      { sku: "B1", measure: 20 },
    ]);
    // 0 % och 50 % före de två första; 80 % före den tredje.
    expect(ranking.get("A1")).toBe("A");
    expect(ranking.get("A2")).toBe("A");
    expect(ranking.get("B1")).toBe("B");
  });

  test("motorn, intelligensen och matrisen räknar samma ABC-klasser", () => {
    const result = analyze(
      [
        item({ sku: "HIGH", stock: 10, monthly: steady(10), price: 100 }),
        item({ sku: "MID", stock: 10, monthly: steady(3), price: 100 }),
        item({ sku: "LOW", stock: 10, monthly: steady(1), price: 100 }),
        item({ sku: "NONE", stock: 10, monthly: steady(0), price: 100 }),
      ],
      { months: 12 },
    );
    const intel = buildIntelligence([], result, { months: 12 });

    for (const cls of ["A", "B", "C"] as const) {
      const engine = result.abc.find((row) => row.class === cls)!.count;
      const revenue = intel.classification.abcRevenue.find((row) => row.class === cls)!.count;
      const matrix = intel.classification.matrix.find((row) => row.abc === cls)!;
      expect(revenue).toBe(engine);
      expect(matrix.x + matrix.y + matrix.z + matrix.unclassified).toBe(engine);
    }
    // Listan som filtrerar artiklar använder samma klass som matrisen.
    for (const row of result.items) {
      expect(intel.items.find((i) => i.sku === row.sku)!.abcRevenue).toBe(row.abc);
    }
  });

  test("ett underlag utan positivt försäljningsvärde ger C, inte A på 0 %", () => {
    const ranking = classifyAbc([
      { sku: "Z1", measure: 0 },
      { sku: "Z2", measure: 0 },
    ]);
    expect(ranking.get("Z1")).toBe("C");
    expect(ranking.get("Z2")).toBe("C");
  });

  test("äldre sparade resultat får ny klassning utan att KPI:er ändras", () => {
    const result = analyze(
      [
        item({ sku: "HIGH", stock: 10, monthly: steady(10), price: 100 }),
        item({ sku: "LOW", stock: 10, monthly: steady(1), price: 100 }),
      ],
      { months: 12 },
    );
    const stale = {
      ...result,
      classificationVersion: undefined,
      items: result.items.map((row) => ({ ...row, abc: "C" as const, xyz: null, xyzReason: undefined })),
      abc: result.abc.map((row) => ({ ...row, count: 0 })),
      xyz: null,
      matrix: null,
    };
    const refreshed = refreshClassification(stale);
    expect(refreshed.classificationVersion).toBe(CLASSIFICATION_VERSION);
    expect(refreshed.items.find((row) => row.sku === "HIGH")!.abc).toBe(result.items.find((row) => row.sku === "HIGH")!.abc);
    expect(refreshed.abc.map((row) => row.count)).toEqual(result.abc.map((row) => row.count));
    // Affärstalen är orörda: samma KPI-objekt och samma säkerhetslager.
    expect(refreshed.kpis).toBe(result.kpis);
    expect(refreshed.items.find((row) => row.sku === "HIGH")!.safetyStock).toBe(
      result.items.find((row) => row.sku === "HIGH")!.safetyStock,
    );
  });

  test("matrisens gränstext beskriver försäljningsvärde, inte lagervärde", () => {
    const html = abcXyzMatrix(
      [{ abc: "A", x: 1, y: 0, z: 0, unclassified: 2, value: 1000 }],
      { locale: "sv" },
    );
    expect(html).toContain("försäljningsvärdet");
    expect(html).toContain("A 2");
  });
});

describe("XYZ med noll, saknad och otillräcklig efterfrågan", () => {
  test("jämn efterfrågan ger X och CV 0", () => {
    const evaluation = evaluateXyz(steady(10));
    expect(evaluation.xyz).toBe("X");
    expect(evaluation.cv).toBe(0);
    expect(evaluation.reason).toBe("ok");
  });

  test("oregelbunden efterfrågan ger Z", () => {
    const evaluation = evaluateXyz(steady(0));
    expect(evaluation.xyz).toBeNull();
    expect(evaluation.reason).toBe("zero_demand");

    const volatile = evaluateXyz(Array.from({ length: 12 }, (_, i) => (i % 2 === 0 ? 0 : 20)));
    expect(volatile.xyz).toBe("Z");
    expect(volatile.cv).toBeGreaterThan(1);
  });

  test("måttlig variation ger Y", () => {
    const evaluation = evaluateXyz(Array.from({ length: 12 }, (_, i) => (i % 2 === 0 ? 2 : 10)));
    expect(evaluation.xyz).toBe("Y");
    expect(evaluation.cv).toBeGreaterThan(0.5);
    expect(evaluation.cv).toBeLessThanOrEqual(1);
  });

  test("medelefterfrågan noll: ingen CV och ingen påhittad Z-klass", () => {
    const evaluation = evaluateXyz(steady(0));
    expect(evaluation.xyz).toBeNull();
    expect(evaluation.cv).toBeNull();
    expect(evaluation.reason).toBe("zero_demand");
  });

  test("kortare historik än sex månader klassificeras inte", () => {
    const evaluation = evaluateXyz(steady(5, 3));
    expect(evaluation.xyz).toBeNull();
    expect(evaluation.reason).toBe("insufficient_history");
  });

  test("saknad historik och saknade värden ger egna förklaringar", () => {
    expect(evaluateXyz(null).reason).toBe("no_history");
    const withHole = evaluateXyz([10, 10, Number.NaN, 10, 10, 10, 10, 10]);
    expect(withHole.xyz).toBeNull();
    expect(withHole.reason).toBe("missing_values");
  });

  test("en artikel utan historik slår inte ut XYZ för hela datamängden", () => {
    const result = analyze(
      [
        item({ sku: "HIST", stock: 10, monthly: steady(10) }),
        item({ sku: "ZERO", stock: 10, monthly: steady(0) }),
        item({ sku: "NONE", stock: 10, monthly: null, totalSold: 60 }),
      ],
      { months: 12 },
    );
    expect(result.xyz).not.toBeNull();
    expect(result.xyz!.reduce((a, row) => a + row.count, 0)).toBe(1);
    expect(result.xyzUnclassified).toBe(2);
    expect(result.xyzCoverage.zeroDemand).toBe(1);
    expect(result.xyzCoverage.noHistory).toBe(1);
    expect(result.xyzCoverage.classified).toBe(1);
    expect(result.dataQuality.hasMonthly).toBe(true);
    expect(result.items.find((i) => i.sku === "HIST")!.xyz).toBe("X");
    expect(result.items.find((i) => i.sku === "ZERO")!.xyz).toBeNull();
    expect(result.items.find((i) => i.sku === "NONE")!.xyzReason).toBe("no_history");
  });
});

describe("historiska mätpunkter", () => {
  test("en mätpunkt per importdag, äldst först och senaste 24 dagar", () => {
    const rows = [
      { date: "2026-11-23T14:30:00.000Z", value: 300 },
      { date: "2026-11-23T09:00:00.000Z", value: 200 },
      { date: "2026-11-22T10:00:00.000Z", value: 100 },
      { date: "2026-11-21T10:00:00.000Z", value: null },
    ];
    const points = collapseDailyValues(rows, 24);
    expect(points).toEqual([
      { date: "2026-11-22T10:00:00.000Z", value: 100 },
      { date: "2026-11-23T14:30:00.000Z", value: 300 },
    ]);
  });

  test("noll lager är en giltig mätpunkt men negativa värden släpps", () => {
    const points = collapseDailyValues(
      [
        { date: "2026-11-23T10:00:00.000Z", value: 0 },
        { date: "2026-11-22T10:00:00.000Z", value: -5 },
      ],
      24,
    );
    expect(points).toEqual([{ date: "2026-11-23T10:00:00.000Z", value: 0 }]);
  });

  test("fler än 24 dagar kapas till de senaste 24", () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({
      date: `2026-01-${String(30 - i).padStart(2, "0")}T10:00:00.000Z`,
      value: 100 + i,
    }));
    const points = collapseDailyValues(rows, 24);
    expect(points).toHaveLength(24);
    expect(points[points.length - 1]!.date.slice(0, 10)).toBe("2026-01-30");
  });
});

describe("omsättning, kapitalbindning och lagerhälsa", () => {
  const result = analyze(
    [
      item({ sku: "FAST", stock: 10, monthly: steady(10), price: 200 }),
      item({ sku: "DEAD", stock: 50, monthly: steady(0), price: 200 }),
      item({ sku: "THIN", stock: 1, monthly: steady(60), price: 200, leadTimeDays: 30 }),
    ],
    { months: 12 },
  );

  test("lageromsättning = årlig COGS / lagervärde", () => {
    // COGS: 120×100 + 0 + 720×100 = 84 000. Lagervärde: 1 000 + 5 000 + 100 = 6 100.
    expect(result.kpis.annualCogs).toBe(84000);
    expect(result.kpis.inventoryValue).toBe(6100);
    expect(result.kpis.turns).toBe(13.77);
    expect(result.kpis.daysOfInventory).toBe(27);
  });

  test("kapitalbindning per artikel summerar till KPI:n", () => {
    const sum = result.items.reduce((a, i) => a + i.value, 0);
    expect(sum).toBe(result.kpis.inventoryValue);
    expect(result.items.find((i) => i.sku === "FAST")!.value).toBe(1000);
  });

  test("hälsopoängens fyra bidrag summerar exakt till totalpoängen", () => {
    const intel = buildIntelligence([], result, { months: 12 });
    const sum = intel.health.drivers.reduce((a, d) => a + d.contribution, 0);
    expect(sum).toBe(intel.health.score);
    expect(intel.health.drivers).toHaveLength(4);
  });

  test("revisionen hittar inga avvikelser i klassning, matris eller hälsa", () => {
    const intel = buildIntelligence([], result, { months: 12 });
    const findings = auditAnalysis(result, intel);
    expect(findings).toEqual([]);
  });
});
