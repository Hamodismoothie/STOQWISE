import { describe, expect, test } from "bun:test";
import { buildDataset } from "../src/dataset.ts";
import { parseCsv } from "../src/csv.ts";
import { detectMapping } from "../src/mapping.ts";
import { aiTextIsGrounded, buildFacts, buildTemplateNarrative } from "../src/insights.ts";
import { analyze } from "../src/analysis.ts";
import { buildDemoDataset } from "../src/demo.ts";

const HEADERS = ["Artikelnummer", "Benämning", "Lagersaldo", "Inköpspris", "Sålt antal"];

describe("buildDataset", () => {
  test("hoppar över rader utan saldo och varnar", () => {
    const csv = parseCsv(
      `${HEADERS.join(";")}\nA1;Skruv;10;2,50;40\nA2;Mutter;;1,00;10\nA3;Bricka;5;1,00;3\n`,
    );
    const mapping = detectMapping(csv.headers, csv.rows);
    const ds = buildDataset(csv, mapping);
    expect(ds.items.length).toBe(2);
    expect(ds.stats.rowsSkipped).toBe(1);
    expect(ds.warnings.join(" ")).toContain("hoppades över");
  });

  test("negativt saldo sätts till noll", () => {
    const csv = parseCsv(`${HEADERS.join(";")}\nA1;Skruv;-3;2,50;0\n`);
    const mapping = detectMapping(csv.headers, csv.rows);
    const ds = buildDataset(csv, mapping);
    expect(ds.items[0]!.stock).toBe(0);
    expect(ds.stats.negativeStock).toBe(1);
  });

  test("dubbletter slås ihop och saldo summeras", () => {
    const csv = parseCsv(
      `${HEADERS.join(";")}\nA1;Skruv;10;2,50;5\nA1;Skruv;4;2,50;3\n`,
    );
    const mapping = detectMapping(csv.headers, csv.rows);
    const ds = buildDataset(csv, mapping);
    expect(ds.items.length).toBe(1);
    expect(ds.items[0]!.stock).toBe(14);
    expect(ds.items[0]!.totalSold).toBe(8);
    expect(ds.stats.duplicatesMerged).toBe(1);
  });

  test("saknad obligatorisk kolumn ger fel", () => {
    const csv = parseCsv("Artikel;Saldo\nA1;5\n");
    const mapping = detectMapping(csv.headers, csv.rows);
    const ds = buildDataset(csv, mapping);
    expect(ds.errors.length).toBeGreaterThan(0);
    expect(ds.items.length).toBe(0);
  });
});

describe("insights", () => {
  const demo = buildDemoDataset("industri");
  const result = analyze(demo.items, { months: 12 });
  const narrative = buildTemplateNarrative(result, {
    company: "Testbolaget AB",
    filename: "test.csv",
  });

  test("mallberättelsen innehåller headline och prioriteringar", () => {
    expect(narrative.headline.length).toBeGreaterThan(10);
    expect(narrative.summary.length).toBeGreaterThan(1);
    expect(narrative.priorities.length).toBeLessThanOrEqual(4);
    expect(narrative.source).toBe("template");
  });

  test("prioriteringar har belopp från motorn, inte påhittade", () => {
    for (const p of narrative.priorities) {
      expect(p.impactHigh).toBeGreaterThanOrEqual(p.impactLow);
      expect(Number.isFinite(p.impactLow)).toBe(true);
    }
  });

  test("AI-skyddet accepterar siffror som finns i faktan", () => {
    const facts = buildFacts(result);
    const value = Math.round(facts.lagervarde);
    expect(aiTextIsGrounded(`Lagervärdet är ${value} kr.`, facts as unknown as Record<string, unknown>)).toBe(
      true,
    );
  });

  test("AI-skyddet avvisar påhittade siffror", () => {
    const facts = buildFacts(result);
    const invented = Math.round(facts.lagervarde) + 987654;
    expect(
      aiTextIsGrounded(`Lagervärdet är ${invented} kr.`, facts as unknown as Record<string, unknown>),
    ).toBe(false);
  });
});

describe("demo dataset", () => {
  test("är deterministiskt", () => {
    const a = buildDemoDataset("hem");
    const b = buildDemoDataset("hem");
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test("ger en rimlig blandning av beteenden", () => {
    const demo = buildDemoDataset("industri");
    const result = analyze(demo.items, { months: demo.months });
    expect(result.kpis.skuCount).toBeGreaterThanOrEqual(40);
    expect(result.kpis.deadStockCount).toBeGreaterThan(0);
    expect(result.kpis.overstockCount).toBeGreaterThan(0);
    expect(result.kpis.stockoutRiskCount).toBeGreaterThan(0);
    expect(result.kpis.potentialReleaseLow).toBeGreaterThan(0);
    expect(result.kpis.turns).toBeGreaterThan(0.2);
    expect(result.kpis.turns).toBeLessThan(20);
  });
});
