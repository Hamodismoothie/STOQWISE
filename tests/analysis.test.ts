import { describe, expect, test } from "bun:test";
import { analyze, zScore } from "../src/analysis.ts";
import type { ItemInput } from "../src/dataset.ts";

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

describe("analyze – grundläggande ekonomi", () => {
  const items: ItemInput[] = [
    item({ sku: "A", stock: 10, cost: 100, price: 200, monthly: steady(10) }),
    item({ sku: "B", stock: 50, cost: 100, price: 200, monthly: steady(0) }),
    item({ sku: "C", stock: 1000, cost: 10, price: 20, monthly: steady(5) }),
  ];
  const result = analyze(items, { months: 12 });

  test("lagervärde summeras till saldo × inköpspris", () => {
    expect(result.kpis.inventoryValue).toBe(16000);
    expect(result.kpis.skuCount).toBe(3);
  });

  test("inaktivt lager identifieras och värderas", () => {
    expect(result.kpis.deadStockCount).toBe(1);
    expect(result.kpis.deadStockValue).toBe(5000);
    expect(result.deadStock[0]!.sku).toBe("B");
  });

  test("lageromsättning räknas på årstakt", () => {
    // COGS: A 120*100 = 12000, C 60*10 = 600 => 12600 per 12 mån.
    expect(result.kpis.annualCogs).toBe(12600);
    expect(result.kpis.turns).toBe(0.79);
    expect(result.kpis.daysOfInventory).toBe(463);
  });

  test("överlager hittas på artikeln med för stort saldo", () => {
    const c = result.overstock.find((i) => i.sku === "C");
    expect(c).toBeDefined();
    expect(c!.overstockQty).toBeGreaterThan(900);
    expect(result.kpis.overstockValue).toBeGreaterThan(9000);
  });

  test("frigjort kapital är ett intervall där low < high", () => {
    expect(result.kpis.potentialReleaseLow).toBeGreaterThan(0);
    expect(result.kpis.potentialReleaseLow).toBeLessThan(result.kpis.potentialReleaseHigh);
  });

  test("ABC ger minst en A-artikel även med en dominant artikel", () => {
    const a = result.abc.find((x) => x.class === "A")!;
    expect(a.count).toBe(1);
    expect(result.topCapital[0]!.sku).toBe("C");
  });

  test("XYZ beräknas när historiken räcker", () => {
    expect(result.xyz).not.toBeNull();
    const x = result.xyz!.find((v) => v.class === "X")!;
    const z = result.xyz!.find((v) => v.class === "Z")!;
    // A och C är helt jämna (X). B har ingen försäljning alls och får ingen
    // efterfrågeklassning alls – noll försäljning är inte samma sak som Z.
    expect(x.count).toBe(2);
    expect(z.count).toBe(0);
  });
});

describe("analyze – kanter och fel", () => {
  test("tomt underlag kraschar inte", () => {
    const result = analyze([], { months: 12 });
    expect(result.kpis.inventoryValue).toBe(0);
    expect(result.kpis.turns).toBe(0);
    expect(result.kpis.daysOfInventory).toBeNull();
    expect(result.recommendations.length).toBe(0);
  });

  test("totalläge utan månadshistorik hoppar över XYZ", () => {
    const result = analyze([item({ sku: "X", stock: 5, totalSold: 60 })], { months: 12 });
    expect(result.xyz).toBeNull();
    expect(result.matrix).toBeNull();
    expect(result.dataQuality.hasMonthly).toBe(false);
  });

  test("artikel utan försäljning i totalläge blir inaktivt lager", () => {
    const result = analyze([item({ sku: "D", stock: 3, totalSold: 0 })], { months: 12 });
    expect(result.kpis.deadStockCount).toBe(1);
    expect(result.deadStock[0]!.action).toBe("write_off");
  });

  test("nollpris ger noll värde men ingen krasch", () => {
    const result = analyze([item({ sku: "Z", stock: 10, cost: 0, monthly: steady(1) }), item({ sku: "Y", stock: 1, cost: 50, monthly: steady(1) })], { months: 12 });
    expect(result.kpis.inventoryValue).toBe(50);
  });

  test("högre servicenivå ger högre säkerhetslager", () => {
    const varying = [3, 9, 2, 14, 5, 11, 4, 8, 6, 12, 3, 9];
    const low = analyze([item({ sku: "V", stock: 100, monthly: varying })], { months: 12, serviceLevel: 0.9 });
    const high = analyze([item({ sku: "V", stock: 100, monthly: varying })], { months: 12, serviceLevel: 0.98 });
    expect(high.topCapital[0]!.safetyStock).toBeGreaterThan(low.topCapital[0]!.safetyStock);
  });

  test("bristrisk upptäcks när täckningen är kortare än ledtiden", () => {
    const result = analyze(
      [item({ sku: "R", stock: 2, cost: 50, price: 100, leadTimeDays: 30, monthly: steady(60) })],
      { months: 12 },
    );
    expect(result.kpis.stockoutRiskCount).toBe(1);
    expect(result.reorder[0]!.sku).toBe("R");
    expect(result.reorder[0]!.coverDays).toBeLessThan(30);
  });

  test("inaktivt lagerfönstret styrs av inställningen", () => {
    // Sålde senast för 8 månader sedan: död vid 180 dagar, inte vid 365.
    const monthly = [5, 5, 5, 5, 0, 0, 0, 0, 0, 0, 0, 0];
    const at180 = analyze([item({ sku: "M", stock: 20, monthly })], { months: 12, deadStockDays: 180 });
    const at365 = analyze([item({ sku: "M", stock: 20, monthly })], { months: 12, deadStockDays: 365 });
    expect(at180.kpis.deadStockCount).toBe(1);
    expect(at365.kpis.deadStockCount).toBe(0);
  });

  test("z-värden matchar vald servicenivå", () => {
    expect(zScore(0.9)).toBeCloseTo(1.2816, 3);
    expect(zScore(0.95)).toBeCloseTo(1.6449, 3);
    expect(zScore(0.98)).toBeCloseTo(2.0537, 3);
  });
});
