import { describe, expect, test } from "bun:test";
import { analyze } from "../src/analysis.ts";
import { buildDemoDataset } from "../src/demo.ts";
import { buildIntelligence } from "../src/core/intelligence.ts";
import { ask, extractNumbers, isGrounded, type CopilotContext } from "../src/core/copilot.ts";

const dataset = buildDemoDataset();
const result = analyze(dataset.items, { months: 12 });
const intel = buildIntelligence(dataset.items, result, { months: 12 });

const ctx: CopilotContext = {
  result,
  intelligence: intel,
  items: dataset.items,
  company: "Nordkap Fackhandel AB",
  months: 12,
  snapshots: [],
};

describe("siffergrind", () => {
  test("accepterar tal som finns i underlaget", () => {
    expect(isGrounded("Lagervärdet är 6 618 210 kr och det inaktiva lagret 690 360 kr.", [
      "lagervärde 6618210",
      "inaktivt lager 690360",
    ])).toBe(true);
  });

  test("avvisar påhittade tal", () => {
    expect(isGrounded("Lagervärdet är 12 345 678 kr.", ["lagervärde 6618210"])).toBe(false);
  });

  test("små tal i löptext tillåts", () => {
    expect(isGrounded("De 10 största artiklarna står för 40 % av värdet.", [`av ${result.kpis.inventoryValue}`])).toBe(true);
  });

  test("extraherar svenska tal", () => {
    expect(extractNumbers("1 234 567 kr och 12,5 %")).toContain(1234567);
    expect(extractNumbers("12,5 %")).toContain(12.5);
  });
});

describe("copilotens avsikter", () => {
  test("topplista på kapital respekterar antalet i frågan", () => {
    const a = ask(ctx, "Vilka 5 artiklar binder mest kapital?");
    expect(a.intent).toBe("top_capital");
    expect(a.table!.rows).toHaveLength(5);
    expect(a.answer).toContain("5");
    expect(a.sources.length).toBeGreaterThan(0);
  });

  test("frigjort kapital anger ett intervall, inte ett enskilt löfte", () => {
    const a = ask(ctx, "Hur mycket kapital kan frigöras?");
    expect(a.intent).toBe("release_capital");
    expect(a.answer).toContain("25");
    expect(a.answer).toContain("55");
    expect(a.facts.length).toBeGreaterThan(2);
  });

  test("bristrisk svarar med artiklar eller ett ärligt nej", () => {
    const a = ask(ctx, "Vilka produkter riskerar att ta slut inom 14 dagar?");
    expect(a.intent).toBe("stockout_risk");
    expect(a.answer.length).toBeGreaterThan(20);
  });

  test("inaktivt lager ger tabell med belopp", () => {
    const a = ask(ctx, "Visa inaktivt lager");
    expect(a.intent).toBe("dead_stock");
    expect(a.table!.rows.length).toBeGreaterThan(0);
    expect(a.answer).toMatch(/kr/);
  });

  test("efterfrågeökning tolkar procent och kör simulering", () => {
    const a = ask(ctx, "Vad händer om efterfrågan ökar med 30 procent?");
    expect(a.intent).toBe("demand_increase");
    expect(a.params.percent).toBe(30);
    expect(a.answer).toContain("30");
    expect(a.table!.rows.length).toBeGreaterThan(2);
  });

  test("leverantörsfråga använder leverantörsgrupper", () => {
    const a = ask(ctx, "Vilka leverantörer har störst påverkan på lagerhållningen?");
    expect(a.intent).toBe("suppliers");
    expect(a.table!.columns).toContain("Leverantör");
  });

  test("omsättningsfråga jämför mot median", () => {
    const a = ask(ctx, "Vilka produkter har försämrad omsättningshastighet?");
    expect(a.intent).toBe("slowing");
    expect(a.answer).toMatch(/median/i);
  });

  test("följdfråga behåller avsikten", () => {
    const first = ask(ctx, "Vilka artiklar binder mest kapital?");
    const follow = ask(ctx, "och de 3 största?", [
      { question: first.question, intent: first.intent, params: first.params },
    ]);
    expect(follow.intent).toBe("top_capital");
    expect(follow.table!.rows).toHaveLength(3);
  });

  test("artikelnummer i frågan slår igenom", () => {
    const sku = dataset.items[0]!.sku;
    const a = ask(ctx, `Berätta om artikel ${sku}`);
    expect(a.intent).toBe("item_lookup");
    expect(a.answer).toContain(sku);
  });

  test("okänt artikelnummer säger det uttryckligen", () => {
    const a = ask(ctx, "Vad vet vi om artikel ZZZ-99999?");
    expect(a.confidence).toBe("low");
    expect(a.answer).toMatch(/hittar ingen|finns inte/i);
  });

  test("säsongsfråga erkänner när underlaget inte räcker", () => {
    const short = { ...ctx, months: 3, intelligence: { ...intel, seasonality: [] } };
    const a = ask(short, "Vilka artiklar är säsongsberoende?");
    expect(a.intent).toBe("seasonality");
    expect(a.answer).toMatch(/kräver|ingen artikel/i);
  });

  test("varje svar är spårbart till källor", () => {
    for (const q of ["Vilka artiklar binder mest kapital?", "Visa inaktivt lager", "Vilka åtgärder ger störst effekt?"]) {
      const a = ask(ctx, q);
      expect(a.sources.length).toBeGreaterThan(0);
      expect(a.grounded).toBe(true);
    }
  });
});
