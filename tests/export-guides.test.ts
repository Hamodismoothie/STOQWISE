import { describe, expect, test } from "bun:test";
import { EXPORT_GUIDES, exportGuide, requiredColumnList } from "../src/export-guides.ts";
import { checkHeaders, clientRules, detectMapping } from "../src/mapping.ts";
import { formatDuration, recordTimeToPdf } from "../src/import-timing.ts";

describe("exportguider", () => {
  test("de sex systemen finns och har unika id", () => {
    expect(EXPORT_GUIDES.map((guide) => guide.id)).toEqual([
      "visma",
      "fortnox",
      "business-central",
      "pyramid",
      "shopify",
      "woocommerce",
    ]);
    expect(new Set(EXPORT_GUIDES.map((guide) => guide.name)).size).toBe(EXPORT_GUIDES.length);
  });

  test("varje guide har menyväg, kolumner, tidsestimat och en verifierbar källa", () => {
    for (const guide of EXPORT_GUIDES) {
      expect(guide.steps.length).toBeGreaterThanOrEqual(3);
      for (const step of guide.steps) {
        expect(step.sv.length).toBeGreaterThan(10);
        expect(step.en.length).toBeGreaterThan(10);
      }
      expect(guide.steps.map((step) => step.sv).join(" ").length).toBeGreaterThan(150);
      expect(guide.steps.map((step) => step.en).join(" ").length).toBeGreaterThan(150);
      expect(guide.columns.length).toBeGreaterThanOrEqual(4);
      expect(guide.note.sv.length).toBeGreaterThan(40);
      expect(guide.minutes).toBeGreaterThan(0);
      expect(guide.docs.startsWith("https://")).toBe(true);
    }
  });

  test("inga em dash eller lösa tankstreck i guide-texten", () => {
    const text = JSON.stringify(EXPORT_GUIDES);
    expect(text.includes("\u2014")).toBe(false);
    expect(/\s\u2013\s/.test(text)).toBe(false);
  });

  test("kolumnkraven nämner saldo och inköpspris på båda språken", () => {
    const sv = requiredColumnList("sv").join(" ");
    const en = requiredColumnList("en").join(" ");
    expect(sv).toContain("Lagersaldo");
    expect(sv).toContain("Inköpspris");
    expect(en).toContain("Stock");
    expect(en).toContain("cost");
  });

  test("uppslagning kräver ett känt id", () => {
    expect(exportGuide("fortnox")?.name).toBe("Fortnox");
    expect(exportGuide("sap")).toBeNull();
  });
});

describe("förhandskontroll av filens rubriker", () => {
  test("Fortnox-export godkänns med kalkylkostnad", () => {
    expect(checkHeaders(["Artikelnummer", "Benämning", "Saldo", "Kalkylkostnad", "Utpris"]).missing).toEqual([]);
  });

  test("namnger den kolumn som saknas", () => {
    expect(checkHeaders(["Artikelnummer", "Benämning", "Saldo"]).missing).toEqual(["cost"]);
    expect(checkHeaders(["Artikelnummer", "Benämning", "Inpris"]).missing).toEqual(["stock"]);
  });

  test("kräver artikelnummer eller benämning", () => {
    expect(checkHeaders(["Saldo", "Inpris"]).missing).toEqual(["sku"]);
    expect(checkHeaders(["Benämning", "Saldo", "Inpris"]).missing).toEqual([]);
  });

  test("Shopify, WooCommerce och Business Central känns igen", () => {
    expect(checkHeaders(["Handle", "Title", "Variant SKU", "Variant Inventory Qty", "Variant Cost"]).missing).toEqual([]);
    expect(checkHeaders(["SKU", "Name", "Stock", "Regular price"]).missing).toEqual(["cost"]);
    expect(checkHeaders(["No.", "Description", "Inventory", "Unit Cost", "Unit Price"]).missing).toEqual([]);
  });

  test("rapporterar vilka rubriker som matchade", () => {
    const result = checkHeaders(["Artikelnummer", "I lager", "Senaste inköpspris"]);
    expect(result.missing).toEqual([]);
    expect(result.matched).toEqual(
      expect.arrayContaining([
        { field: "sku", header: "Artikelnummer" },
        { field: "stock", header: "I lager" },
        { field: "cost", header: "Senaste inköpspris" },
      ]),
    );
  });

  test("klientreglerna bygger på samma alias som mappningen", () => {
    const rules = clientRules();
    expect(rules.required.map((field) => field.key)).toEqual(["stock", "cost"]);
    expect(rules.required[0]!.aliases).toContain("saldo");
    expect(rules.required[1]!.aliases).toContain("kalkylkostnad");
    expect(rules.identity).toContain("artikelnummer");
  });

  test("den riktiga mappningen håller med kontrollen för samma fil", () => {
    const headers = ["Artikelnummer", "Benämning", "Saldo", "Kalkylkostnad", "Utpris"];
    const rows = [
      ["1001", "Skruv 4x40", "12", "2,50", "9,90"],
      ["1002", "Mutter M4", "40", "1,10", "4,50"],
    ];
    const mapping = detectMapping(headers, rows);
    expect(checkHeaders(headers).missing).toEqual([]);
    expect(mapping.missingRequired).toEqual([]);
    expect(mapping.columns.stock).toBe(2);
    expect(mapping.columns.cost).toBe(3);
  });
});

describe("tid från inloggning till färdig PDF", () => {
  test("varaktigheter skrivs som en människa säger dem", () => {
    expect(formatDuration(null)).toBe("–");
    expect(formatDuration(0)).toBe("0 s");
    expect(formatDuration(48)).toBe("48 s");
    expect(formatDuration(180)).toBe("3 min");
    expect(formatDuration(220)).toBe("3 min 40 s");
  });

  test("mätningen kräver en känd session och rör inte databasen utan den", () => {
    expect(() =>
      recordTimeToPdf({ userId: "u1", analysisId: "a1", rows: 10, sessionStartedAt: null }),
    ).not.toThrow();
  });
});
