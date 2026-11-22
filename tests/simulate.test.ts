import { describe, expect, test } from "bun:test";
import type { ItemInput } from "../src/dataset.ts";
import { buildBaseline, compareScenarios, simulate } from "../src/core/simulate.ts";

function makeItem(sku: string, stock: number, monthly: number[], cost = 100, price = 200): ItemInput {
  return {
    sku,
    name: `Artikel ${sku}`,
    category: sku.startsWith("A") ? "Kategori A" : "Kategori B",
    supplier: "Leverantör",
    stock,
    cost,
    price,
    leadTimeDays: 30,
    moq: 1,
    monthly,
    totalSold: monthly.reduce((a, b) => a + b, 0),
    totalRevenue: monthly.reduce((a, b) => a + b, 0) * price,
  };
}

const steady = Array(12).fill(100);
const items: ItemInput[] = [
  makeItem("A-1", 4000, steady),
  makeItem("A-2", 300, steady),
  makeItem("B-1", 50, steady),
  makeItem("B-2", 9000, Array(12).fill(0)),
];

const baseline = buildBaseline(items, 12);

describe("simuleringsmotor", () => {
  test("oförändrat scenario ger noll i förändring", () => {
    const outcome = simulate(baseline, { name: "Oförändrat" });
    for (const value of Object.values(outcome.delta)) {
      expect(Math.abs(Number(value))).toBeLessThan(0.01);
    }
  });

  test("reduktion frigör kapital utan att röra bufferten", () => {
    const outcome = simulate(baseline, { name: "Reducera 15 %", stockReductionPct: 0.15 });
    expect(outcome.totals.freedCapital).toBeGreaterThan(0);
    expect(outcome.totals.inventoryValue).toBeLessThan(4000 * 100 + 300 * 100 + 50 * 100 + 9000 * 100);

    // Ingen artikel får gå under sin beställningspunkt av reduktionen.
    const heavy = outcome.rows.find((r) => r.sku === "A-1")!;
    expect(heavy.stockAfter).toBeGreaterThan(0);
    expect(outcome.totals.serviceLevel).toBeGreaterThan(0.9);
  });

  test("kraftig reduktion ökar bristrisken", () => {
    const mild = simulate(baseline, { name: "Mild", stockReductionPct: 0.05 });
    const hard = simulate(baseline, { name: "Hård", stockReductionPct: 0.6 });
    expect(hard.totals.freedCapital).toBeGreaterThan(mild.totals.freedCapital);
    expect(hard.totals.serviceLevel).toBeLessThanOrEqual(mild.totals.serviceLevel);
    expect(hard.risks.length).toBeGreaterThan(0);
  });

  test("ökad efterfrågan kräver mer kapital", () => {
    const outcome = simulate(baseline, { name: "Efterfrågan +20", demandMultiplier: 1.2 });
    expect(outcome.delta.requiredInventoryValue).toBeGreaterThan(0);
    expect(outcome.delta.inventoryValue).toBe(0); // dagens saldo ändras inte av prognosen
    expect(outcome.totals.serviceLevel).toBeLessThanOrEqual(1);
  });

  test("längre ledtid höjer säkerhetslagret", () => {
    const outcome = simulate(baseline, { name: "Längre ledtid", leadTimeMultiplier: 2 });
    expect(outcome.delta.requiredInventoryValue).toBeGreaterThan(0);
  });

  test("högre servicenivå ökar kapitalbehovet när efterfrågan varierar", () => {
    // Konstant efterfrågan har noll standardavvikelse, så säkerhetslagret blir
    // noll oavsett servicenivå. Testet behöver därför en varierad serie.
    const varied = buildBaseline(
      [makeItem("A-1", 900, [40, 90, 20, 110, 60, 30, 120, 50, 70, 10, 100, 80])],
      12,
    );
    const low = simulate(varied, { name: "90", serviceLevel: 0.9 });
    const high = simulate(varied, { name: "99", serviceLevel: 0.99 });
    expect(high.totals.requiredInventoryValue).toBeGreaterThan(low.totals.requiredInventoryValue);
  });

  test("scenariot redovisar formler och kategorisplit", () => {
    const outcome = simulate(baseline, { name: "Test", stockReductionPct: 0.1 });
    expect(outcome.formulas.length).toBeGreaterThan(4);
    expect(outcome.byCategory.length).toBe(2);
    const sum = outcome.byCategory.reduce((a, c) => a + c.freed, 0);
    expect(sum).toBeCloseTo(outcome.totals.freedCapital, -2);
  });

  test("flera scenarier jämförs mot samma baslinje", () => {
    const results = compareScenarios(baseline, [
      { name: "A", stockReductionPct: 0.1 },
      { name: "B", demandMultiplier: 1.3 },
    ]);
    expect(results).toHaveLength(2);
    expect(results[0]!.totals.freedCapital).toBeGreaterThan(0);
    // Varje scenario har samma utgångsvärde, så delta måste skilja sig.
    expect(results[0]!.delta.freedCapital).not.toBe(results[1]!.delta.freedCapital);
  });

  test("försening ökar kapitalbehovet och flaggas som risk", () => {
    const outcome = simulate(baseline, {
      name: "Försening",
      supplierDelayDays: 20,
      supplierDelayProbability: 0.6,
    });
    expect(outcome.risks.some((r) => r.title.toLowerCase().includes("leverantör"))).toBe(true);
    expect(outcome.delta.requiredInventoryValue).toBeGreaterThan(0);
  });
});
