import { describe, expect, test } from "bun:test";
import {
  normalizeSimulation,
  portfolioArticlesFromItems,
  runPortfolioSimulation,
  runSimulation,
  type PortfolioArticle,
  type SimArticle,
  type SimulationScenario,
} from "../src/ui/live-simulation.ts";
import { buildDemoDataset } from "../src/demo.ts";
import { analyze } from "../src/analysis.ts";

const article = (over: Partial<SimArticle> & { sku: string }): SimArticle => ({
  name: over.sku,
  category: "Test",
  abc: "B",
  xyz: "X",
  status: "balanced",
  zone: "storage",
  stock: 100,
  cost: 50,
  price: 100,
  avgMonthly: 120,
  leadTimeDays: 5,
  safetyStock: 20,
  reorderPoint: 40,
  overstockQty: 0,
  moq: 10,
  hasPick: false,
  ...over,
});

const articles: SimArticle[] = [
  article({ sku: "A-1", abc: "A", stock: 120, avgMonthly: 300, reorderPoint: 80, hasPick: true }),
  article({ sku: "A-2", abc: "A", stock: 60, avgMonthly: 180, reorderPoint: 50, hasPick: true }),
  article({ sku: "B-1", stock: 18, avgMonthly: 90, reorderPoint: 30, leadTimeDays: 3 }),
  article({ sku: "B-2", stock: 8, avgMonthly: 45, reorderPoint: 25, leadTimeDays: 8 }),
  article({ sku: "C-1", abc: "C", stock: 500, avgMonthly: 30, reorderPoint: 25, overstockQty: 320, cost: 12 }),
  article({ sku: "C-2", abc: "C", stock: 220, avgMonthly: 12, reorderPoint: 15, overstockQty: 180, cost: 8 }),
  article({ sku: "D-1", stock: 40, avgMonthly: 60, reorderPoint: 35, moq: 50 }),
  article({ sku: "E-1", stock: 0, avgMonthly: 30, reorderPoint: 20 }),
  article({ sku: "INACTIVE", status: "inactive", zone: "inactive", stock: 80, avgMonthly: 0, reorderPoint: 0 }),
];

const run = (scenario: Partial<SimulationScenario> = {}, seed = "test-seed") =>
  runSimulation(articles, { days: 90, ...scenario }, { seed, startDate: "2026-01-01" });

const eventsOf = (result: ReturnType<typeof run>, type: string) =>
  result.days.flatMap((day) => day.events).filter((event) => event.type === type);

describe("simuleringsmotorn", () => {
  test("samma indata ger exakt samma förlopp", () => {
    const first = run();
    const second = run();
    expect(JSON.stringify(first.days)).toBe(JSON.stringify(second.days));
    expect(first.summary).toEqual(second.summary);
    expect(first.seed).toBe(second.seed);
  });

  test("scenarier påverkar inte tidigare beräkningar", () => {
    const baseline = run();
    run({ demandPct: 40, leadDays: 5, delayDeliveries: true });
    const again = run();
    expect(again.summary.outboundUnits).toBe(baseline.summary.outboundUnits);
  });

  test("kortare period är ett prefix av den längre", () => {
    const short = run({ days: 30 });
    const long = run({ days: 90 });
    expect(JSON.stringify(short.days)).toBe(JSON.stringify(long.days.slice(0, 31)));
  });

  test("plock minskar saldot och inleverans ökar det", () => {
    const result = run();
    const picks = eventsOf(result, "order_picked");
    expect(picks.length).toBeGreaterThan(0);
    const pick = picks[0]!;
    expect(pick.sku).toBeTruthy();
    expect(pick.qty).toBeGreaterThan(0);
    expect(pick.stockAfter).toBeLessThan(120);

    const arrivals = eventsOf(result, "delivery_arrived");
    expect(arrivals.length).toBeGreaterThan(0);
    for (const arrival of arrivals) {
      expect(arrival.qty).toBeGreaterThan(0);
      expect(arrival.stockAfter).toBeGreaterThanOrEqual(arrival.qty);
    }
  });

  test("saldo blir aldrig negativt och händelser har tidsstämpel", () => {
    const result = run({ demandPct: 80, days: 120 });
    for (const day of result.days) {
      for (const change of day.changed) expect(change.stock).toBeGreaterThanOrEqual(0);
      for (const event of day.events) {
        expect(event.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(event.day).toBe(day.day);
        expect(event.id).toBeTruthy();
        if (event.stockAfter !== null) expect(event.stockAfter).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test("inaktiva artiklar påverkas inte", () => {
    const result = run({ days: 60 });
    const inactiveEvents = result.days.flatMap((day) => day.events).filter((event) => event.sku === "INACTIVE");
    expect(inactiveEvents).toHaveLength(0);
  });

  test("påfyllning skapar beställning med artikelns MOQ eller behov", () => {
    const result = run();
    const replenishments = eventsOf(result, "replenishment_needed");
    expect(replenishments.length).toBeGreaterThan(0);
    const d1 = replenishments.find((event) => event.sku === "D-1");
    expect(d1).toBeTruthy();
    expect(d1!.qty).toBeGreaterThanOrEqual(50);
  });

  test("MOQ-förändring ger större beställning", () => {
    const base = run();
    const high = run({ moqPct: 100 });
    const qty = (result: ReturnType<typeof run>) =>
      eventsOf(result, "replenishment_needed").find((event) => event.sku === "D-1")?.qty ?? 0;
    expect(qty(high)).toBeGreaterThanOrEqual(qty(base));
    expect(qty(high)).toBeGreaterThan(0);
  });

  test("höjd säkerhet ökar beställningsbehovet", () => {
    const base = run({ days: 1 });
    const safe = run({ days: 1, safetyPct: 50 });
    const qty = (result: ReturnType<typeof run>) =>
      eventsOf(result, "replenishment_needed").find((event) => event.sku === "B-1")?.qty ?? 0;
    expect(qty(safe)).toBeGreaterThan(qty(base));
  });

  test("ökad efterfrågan ger mer utflöde och fler brister", () => {
    const base = run();
    const peak = run({ demandPct: 40 });
    expect(peak.summary.outboundUnits).toBeGreaterThan(base.summary.outboundUnits);
    expect(peak.summary.fillRate).not.toBeNull();
    expect(peak.summary.fillRate!).toBeLessThanOrEqual(100);
    expect(peak.summary.stockoutEvents).toBeGreaterThanOrEqual(base.summary.stockoutEvents);
  });

  test("längre leveranstid ger fler försenade leveranser", () => {
    const clean = run({ leadDays: 0, delayDeliveries: false, delayRate: 0 });
    const slow = run({ leadDays: 10, delayDeliveries: true, delayRate: 0.5 });
    expect(slow.summary.delayedDeliveries).toBeGreaterThan(clean.summary.delayedDeliveries);
  });

  test("överlager och bristrisk går att härleda ur resultatet", () => {
    const result = run({ days: 30, demandPct: 40 });
    expect(result.summary.overstock.length).toBeGreaterThan(0);
    for (const entry of result.summary.overstock) {
      expect(entry.excess).toBeGreaterThan(0);
      expect(entry.value).toBeGreaterThan(0);
    }
    expect(result.summary.purchaseNeeds.length).toBeGreaterThan(0);
    for (const need of result.summary.purchaseNeeds) expect(need.qty).toBeGreaterThan(0);
  });

  test("dag 0 är utgångsläget och kan användas för återställning", () => {
    const result = run();
    const initial = new Map(articles.map((entry) => [entry.sku, entry.stock]));
    for (const change of result.days[0]!.changed) {
      expect(change.stock).toBe(initial.get(change.sku)!);
    }
    expect(result.days[0]!.day).toBe(0);
  });

  test("beslutsstödet per dag speglar dagens simuleringstillstånd", () => {
    const result = run({ days: 60, demandPct: 45 });
    for (const day of result.days) {
      const support = day.support!;
      const needSum = support.purchaseNeeds.reduce((sum, entry) => sum + entry.qty, 0);
      expect(needSum).toBeLessThanOrEqual(day.metrics.purchaseNeedUnits + support.purchaseNeeds.length);
      for (const entry of support.overstock) expect(entry.excess).toBeGreaterThan(0);
      for (const entry of support.purchaseNeeds) expect(entry.qty).toBeGreaterThan(0);
      expect(support.risks.length).toBe(Math.min(8, day.metrics.stockoutCount));
      expect(support.overstock.length).toBe(Math.min(8, day.metrics.overstockCount));
    }
    const varied = result.days.some(
      (day) => JSON.stringify(day.support) !== JSON.stringify(result.days[result.days.length - 1]!.support),
    );
    expect(varied).toBe(true);
  });

  test("normalisering stänger in orimliga scenarier", () => {
    const scenario = normalizeSimulation({ days: 9999, demandPct: 900, leadDays: -100, safetyPct: 500 });
    expect(scenario.days).toBe(365);
    expect(scenario.demandPct).toBe(100);
    expect(scenario.leadDays).toBe(-10);
    expect(scenario.safetyPct).toBe(100);
  });
});


describe("portföljsimulering för stora bestånd", () => {
  const portfolioArticle = (index: number, over: Partial<PortfolioArticle> = {}): PortfolioArticle => ({
    sku: `SKU-${index}`,
    name: `Artikel ${index}`,
    stock: 80 + (index % 40),
    cost: 40 + (index % 9) * 5,
    avgMonthly: 30 + (index % 25) * 6,
    leadTimeDays: 14 + (index % 5) * 3,
    safetyStock: 20,
    reorderPoint: 45,
    overstockQty: 0,
    moq: 12,
    status: "balanced",
    ...over,
  });

  test("varje artikel ingår i lagervärde och kapitalbindning", () => {
    const articles = Array.from({ length: 5_000 }, (_, i) => portfolioArticle(i));
    const run = runPortfolioSimulation(articles, { days: 90 }, { seed: "test" });
    const units = articles.reduce((sum, a) => sum + a.stock, 0);
    const capital = articles.reduce((sum, a) => sum + a.stock * a.cost, 0);
    expect(run.days).toHaveLength(91);
    expect(run.days[0]!.metrics.onHand).toBeCloseTo(units, 0);
    expect(run.days[0]!.metrics.capital).toBe(Math.round(capital));
    expect(run.summary.inboundUnits).toBeGreaterThan(0);
    expect(run.summary.outboundUnits).toBeGreaterThan(0);
  });

  test("samma indata ger samma serie och rimliga nyckeltal", () => {
    const articles = Array.from({ length: 3_000 }, (_, i) => portfolioArticle(i));
    const a = runPortfolioSimulation(articles, { days: 60, demandPct: 20 }, { seed: "abc" });
    const b = runPortfolioSimulation(articles, { days: 60, demandPct: 20 }, { seed: "abc" });
    expect(JSON.stringify(a.days.map((d) => d.metrics))).toBe(JSON.stringify(b.days.map((d) => d.metrics)));
    for (const day of a.days) {
      expect(day.metrics.stockoutCount).toBeGreaterThanOrEqual(0);
      expect(day.metrics.overstockCount).toBeGreaterThanOrEqual(0);
      expect(day.metrics.onHand).toBeGreaterThanOrEqual(0);
      if (day.metrics.fillRate !== null) {
        expect(day.metrics.fillRate).toBeGreaterThanOrEqual(0);
        expect(day.metrics.fillRate).toBeLessThanOrEqual(100);
      }
    }
    expect(a.summary.fillRate === null || a.summary.fillRate <= 100).toBe(true);
  });

  test("högre efterfrågan ger inte lägre utflöde", () => {
    const articles = Array.from({ length: 2_000 }, (_, i) => portfolioArticle(i));
    const normal = runPortfolioSimulation(articles, { days: 60, demandPct: 0 }, { seed: "s" });
    const peak = runPortfolioSimulation(articles, { days: 60, demandPct: 50 }, { seed: "s" });
    expect(peak.summary.outboundUnits).toBeGreaterThan(normal.summary.outboundUnits);
  });

  test("händelseflödet är begränsat men beslutsstödet fylls", () => {
    const articles = Array.from({ length: 2_000 }, (_, i) => portfolioArticle(i, i % 7 === 0 ? { stock: 0 } : {}));
    const run = runPortfolioSimulation(articles, { days: 90 }, { seed: "events" });
    for (const day of run.days) expect(day.events.length).toBeLessThanOrEqual(5);
    expect(run.summary.events).toBeGreaterThan(0);
    expect(run.summary.risks.length).toBeGreaterThan(0);
  });

  test("demodata ger en portfölj som speglar analysen", () => {
    const demo = buildDemoDataset("industri");
    const result = analyze(demo.items, { months: demo.months }, []);
    const view = portfolioArticlesFromItems(result.items);
    const run = runPortfolioSimulation(view, { days: 90 }, { seed: "demo" });
    const stock = result.items.reduce((sum: number, item) => sum + item.stock, 0);
    expect(run.days[0]!.metrics.onHand).toBeCloseTo(stock, 0);
    expect(run.summary.outboundUnits).toBeGreaterThan(0);
    expect(run.summary.ordersCreated).toBeGreaterThan(0);
  });
});
