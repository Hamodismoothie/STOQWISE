import { describe, expect, test } from "bun:test";
import {
  economicOrderQuantity,
  forecastSeries,
  supplyPlan,
  normalCdf,
  normalLoss,
  aggregateSeries,
  sigmaDemandDuringLeadTime,
} from "../src/core/forecast.ts";
import { zScore } from "../src/analysis.ts";
import type { ItemInput } from "../src/dataset.ts";

const item = (monthly: number[], overrides: Partial<ItemInput> = {}): ItemInput => ({
  sku: "A-1",
  name: "Testartikel",
  category: "Test",
  supplier: "Lev",
  stock: 100,
  cost: 10,
  price: 25,
  leadTimeDays: 30,
  moq: 12,
  monthly,
  totalSold: monthly.reduce((a, b) => a + b, 0),
  totalRevenue: monthly.reduce((a, b) => a + b, 0) * 25,
  ...overrides,
});

describe("normal distribution helpers", () => {
  test("CDF ger kända värden", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
  });

  test("förlustfunktionen är positiv och avtar med högre lager", () => {
    expect(normalLoss(0)).toBeCloseTo(0.3989, 3);
    expect(normalLoss(2)).toBeLessThan(normalLoss(0));
    expect(normalLoss(-2)).toBeGreaterThan(2);
  });
});

describe("prognosmotor", () => {
  test("jämn serie ger prognos nära nivån", () => {
    const result = forecastSeries(Array(12).fill(100), { horizon: 6 });
    expect(result.points).toHaveLength(6);
    expect(result.points.every((p) => Math.abs(p.value - 100) < 1)).toBe(true);
    expect(result.confidence).toBe("high");
  });

  test("prognosen ger intervall som omsluter punkten", () => {
    const result = forecastSeries([10, 12, 9, 14, 11, 13, 10, 15, 12, 11, 13, 12], { horizon: 3 });
    for (const p of result.points) {
      expect(p.lo).toBeLessThanOrEqual(p.value);
      expect(p.hi).toBeGreaterThanOrEqual(p.value);
    }
  });

  test("glest förekommande efterfrågan väljer en intermittent modell", () => {
    const result = forecastSeries([0, 0, 0, 5, 0, 0, 0, 0, 3, 0, 0, 0], { horizon: 3 });
    expect(result.intermittent).toBe(true);
    expect(["croston", "sba", "tsb", "adida", "naive"]).toContain(result.method);
  });

  test("TSB och ADIDA backtestas som kandidater för intermittent efterfrågan", () => {
    const result = forecastSeries([0, 0, 6, 0, 0, 0, 4, 0, 0, 0, 9, 0], { horizon: 3 });
    const methods = result.candidates.map((candidate) => candidate.method);
    expect(methods).toContain("tsb");
    expect(methods).toContain("adida");
    for (const candidate of result.candidates) {
      expect(Number.isFinite(candidate.metrics.wape)).toBe(true);
      expect(Number.isFinite(candidate.metrics.mae)).toBe(true);
    }
  });

  test("TSB ger nollprognos utan att dividera med noll när serien är tom på efterfrågan", () => {
    const result = forecastSeries(Array(12).fill(0), { horizon: 3 });
    expect(result.points.every((point) => point.value === 0)).toBe(true);
    expect(result.candidates.every((candidate) => Number.isFinite(candidate.metrics.wape))).toBe(true);
  });

  test("modellval rapporterar alla kandidater med mått", () => {
    const result = forecastSeries([5, 7, 6, 8, 9, 7, 10, 11, 9, 12, 11, 13, 12, 14, 13, 15, 14, 16], { horizon: 3 });
    expect(result.candidates.length).toBeGreaterThan(1);
    for (const c of result.candidates) {
      expect(Number.isFinite(c.metrics.wape)).toBe(true);
      expect(Number.isFinite(c.metrics.mae)).toBe(true);
      expect(Number.isFinite(c.metrics.rmse)).toBe(true);
    }
    // Den valda modellen ska vara den med lägst WAPE.
    const best = [...result.candidates].sort((a, b) => a.metrics.wape - b.metrics.wape)[0]!;
    expect(result.method).toBe(best.method);
  });

  test("sigma mäter ett-stegs prognosfel, inte avståndet till slutfacit", () => {
    // En jämn trend kan följas nästan exakt ett steg framåt. Om sigma i stället
    // jämför hela historiken med den sista nivån blir den orimligt stor och
    // blåser upp säkerhetslagret.
    const trend = Array.from({ length: 12 }, (_, i) => 10 + i * 10);
    const result = forecastSeries(trend, { horizon: 3 });
    expect(result.sigma).toBeLessThan(5);
  });

  test("tom historik ger nollprognos med låg konfidens", () => {
    const result = forecastSeries([], { horizon: 3 });
    expect(result.method).toBe("zero");
    expect(result.points.every((p) => p.value === 0)).toBe(true);
    expect(result.confidence).toBe("low");
  });

  test("veckofrekvens ger fler steg än månader", () => {
    const result = forecastSeries(Array(12).fill(40), { horizon: 1, frequency: "week" });
    expect(result.points.length).toBeGreaterThan(4);
    expect(result.points[0]!.value).toBeLessThan(40);
  });
});

describe("lagerstyrning", () => {
  test("Wilsonformeln återger bokens Flexilek-exempel (241 st.)", () => {
    // Modern logistik, kap. 11.2, s. 277: D=1000, K=400, r=0,25, p=55.
    expect(economicOrderQuantity(1000, 400, 0.25, 55)).toBeCloseTo(241.2, 1);
  });

  test("SERV1 kombinerar efterfråge- och ledtidsosäkerhet enligt bokens exempel", () => {
    // Modern logistik, kap. 11.6, s. 294–295: veckoefterfrågan 19,2 st,
    // sigma_d=3,99, LT=1 vecka, sigma_LT=0,12 veckor, SERV1=99 %.
    const monthlySigma = 3.99 * Math.sqrt(30.44 / 7);
    const sigma = sigmaDemandDuringLeadTime(monthlySigma, 7, 19.2 / 7, 0.12 * 7);
    expect(sigma).toBeCloseTo(4.61, 1);
    expect(zScore(0.99) * sigma).toBeCloseTo(10.7, 1);
  });

  test("ledtidsosäkerhet höjer säkerhetslagret och flaggas i planen", () => {
    const stable = item(Array(12).fill(10), { leadTimeDays: 30 });
    const uncertain = item(Array(12).fill(10), { leadTimeDays: 30, leadTimeSigmaDays: 5 });
    const forecast = forecastSeries(stable.monthly!, { horizon: 3 });
    const base = supplyPlan(stable, forecast);
    const withLeadTime = supplyPlan(uncertain, forecast);
    expect(base.leadTimeVariabilityIncluded).toBe(false);
    expect(withLeadTime.leadTimeVariabilityIncluded).toBe(true);
    expect(withLeadTime.safetyStock).toBeGreaterThan(base.safetyStock);
  });

  test("beställningspunkt och säkerhetslager är positiva och konsistenta", () => {
    const it = item([20, 22, 19, 21, 23, 20, 18, 22, 21, 20, 24, 19]);
    const f = forecastSeries(it.monthly!, { horizon: 3 });
    const plan = supplyPlan(it, f, { serviceLevel: 0.95 });

    expect(plan.reorderPoint).toBeGreaterThan(plan.safetyStock);
    expect(plan.safetyStock).toBeGreaterThan(0);
    expect(plan.stockoutProbability).toBeGreaterThanOrEqual(0);
    expect(plan.stockoutProbability).toBeLessThanOrEqual(1);
    expect(plan.orderQuantity).toBeGreaterThanOrEqual(12); // MOQ respekteras
    expect(plan.orderQuantity % 12).toBe(0);
  });

  test("högre servicenivå ger högre säkerhetslager", () => {
    const it = item([10, 14, 9, 16, 11, 13, 10, 15, 12, 11, 13, 12]);
    const f = forecastSeries(it.monthly!, { horizon: 3 });
    const low = supplyPlan(it, f, { serviceLevel: 0.9 });
    const high = supplyPlan(it, f, { serviceLevel: 0.99 });
    expect(high.safetyStock).toBeGreaterThan(low.safetyStock);
  });

  test("reserverat lager minskar täckningen och räknas in i beställningsbehovet", () => {
    const monthly = [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10];
    const free = item(monthly, { stock: 100, reserved: 0 });
    const held = item(monthly, { stock: 100, reserved: 95 });
    const planFree = supplyPlan(free, forecastSeries(monthly, { horizon: 3 }));
    const planHeld = supplyPlan(held, forecastSeries(monthly, { horizon: 3 }));
    expect(planHeld.daysOfCover!).toBeLessThan(planFree.daysOfCover!);
    expect(planHeld.stockoutProbability).toBeGreaterThan(planFree.stockoutProbability);
    expect(planHeld.orderQuantity).toBeGreaterThanOrEqual(Math.ceil(planHeld.reorderPoint - 5));
  });

  test("stort lager ger låg bristrisk", () => {
    const it = item([10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10], { stock: 5000 });
    const f = forecastSeries(it.monthly!, { horizon: 3 });
    const plan = supplyPlan(it, f);
    expect(plan.stockoutProbability).toBeLessThan(0.01);
    expect(plan.expectedShortageUnits).toBeLessThan(1);
  });
});

describe("aggregering", () => {
  test("summerar serier med olika längd", () => {
    const series = aggregateSeries([
      { monthly: [1, 2, 3] },
      { monthly: [10, 20, 30] },
      { monthly: null },
    ]);
    expect(series).toEqual([11, 22, 33]);
  });

  test("returnerar null utan historik", () => {
    expect(aggregateSeries([{ monthly: null }])).toBeNull();
  });
});

describe("prognosens datakvalitet", () => {
  test("backtest sparar utfall och prognos och MAPE blir noll för jämn serie", () => {
    const result = forecastSeries(Array(12).fill(10), { horizon: 3 });
    expect(result.metrics.mape).toBe(0);
    expect(result.backtest).not.toBeNull();
    expect(result.backtest!.actual).toHaveLength(2);
    expect(result.backtest!.predicted).toHaveLength(2);
    expect(result.backtest!.actual).toEqual([10, 10]);
  });

  test("MAPE är null när ett utfall är noll, medan WAPE fortfarande är ett mått", () => {
    const result = forecastSeries([0, 0, 5, 0, 0, 3, 0, 0, 0, 4, 0, 0], { horizon: 3 });
    expect(result.metrics.mape).toBeNull();
    expect(Number.isFinite(result.metrics.wape)).toBe(true);
    expect(result.intermittent).toBe(true);
  });

  test("saknade värden räknas och behandlas som noll utan att krascha", () => {
    const result = forecastSeries([10, 10, Number.NaN, 10, 10, 10, 10, 10, 10, 10, 10, 10], { horizon: 3 });
    expect(result.missingCount).toBe(1);
    expect(result.notes.some((n) => n.includes("saknade"))).toBe(true);
    expect(result.points.every((p) => Number.isFinite(p.value))).toBe(true);
  });

  test("extremvärden kapas för modellen men backtestens utfall är oförändrat", () => {
    const result = forecastSeries([10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 500], { horizon: 3 });
    expect(result.outlierCount).toBe(1);
    expect(result.notes.some((n) => n.includes("extremvärden"))).toBe(true);
    expect(result.backtest!.actual).toContain(500);
  });

  test("EOQ avrundas uppåt till MOQ och beställningspunkten är summan av ledtidsbehov och säkerhetslager", () => {
    const it = item(Array(12).fill(10), { stock: 100, cost: 100, moq: 12 });
    const result = forecastSeries(it.monthly!, { horizon: 3 });
    const plan = supplyPlan(it, result, { serviceLevel: 0.95 });
    expect(plan.reorderPoint).toBeCloseTo(plan.demandDuringLeadTime + plan.safetyStock, 1);
    expect(plan.orderQuantity % 12).toBe(0);
    // EOQ = sqrt(2 × 120 × 350 / (0,22 × 100)) ≈ 61,8 → 72 efter MOQ-avrundning.
    expect(plan.orderQuantity).toBe(72);
  });
});
