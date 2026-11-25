/**
 * The PDF is a customer-facing artifact, not a debug output. These tests draw
 * the same analysis twice and record every string PDFKit receives, so a Swedish
 * heading, date style or warning cannot leak into the English report.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import PDFDocument from "pdfkit";
import { analyze } from "../src/analysis.ts";
import { buildDemoDataset } from "../src/demo.ts";
import { buildTemplateNarrative } from "../src/insights.ts";
import { buildPdf, reportFileName } from "../src/pdf.ts";

const ANALYSIS = analyze(buildDemoDataset("industri", "en").items, { months: 12 }, []);
const WITH_WARNING = {
  ...ANALYSIS,
  dataQuality: {
    ...ANALYSIS.dataQuality,
    warnings: [
      "3 artiklar saknar inköpspris. Deras lagervärde räknas som 0, vilket underskattar det bundna kapitalet.",
      "7 rader hade ett annat antal kolumner än rubrikraden (4 mot 6). Korta rader fylldes ut med tomma värden.",
    ],
  },
};
const META = {
  company: "Nordvind Industrial Supply AB",
  filename: "inventory-2026.csv",
  generatedAt: "2026-11-23T09:41:00.000Z",
  contactEmail: "hello@stoqwise.se",
};

const originalText = (PDFDocument.prototype as unknown as { text: (...args: unknown[]) => unknown }).text;

let drawn: string[] = [];

beforeAll(() => {
  (PDFDocument.prototype as unknown as { text: (text: unknown, ...args: unknown[]) => unknown }).text = function (
    this: unknown,
    text: unknown,
    ...args: unknown[]
  ) {
    if (typeof text === "string") drawn.push(text);
    return originalText.call(this, text, ...args);
  };
});

afterAll(() => {
  (PDFDocument.prototype as unknown as { text: (...args: unknown[]) => unknown }).text = originalText;
});

async function render(locale: "sv" | "en"): Promise<string> {
  drawn = [];
  await buildPdf(
    WITH_WARNING,
    buildTemplateNarrative(WITH_WARNING, { company: META.company, filename: META.filename }, locale),
    { ...META, locale },
  );
  return drawn.join("\n");
}

describe("PDF på svenska och engelska", () => {
  test("filnamnet följer språket", () => {
    expect(reportFileName("sv", "abcdef12-3456-7890")).toBe("lagerrapport-abcdef12.pdf");
    expect(reportFileName("en", "abcdef12-3456-7890")).toBe("inventory-report-abcdef12.pdf");
    expect(reportFileName("sv")).toBe("exempelrapport.pdf");
    expect(reportFileName("en")).toBe("sample-report.pdf");
  });

  test("engelsk PDF har engelsk copy, datum och varningar", async () => {
    const text = await render("en");
    expect(text).toContain("Inventory capital analysis");
    expect(text).toContain("Economic summary");
    expect(text).toContain("Recommended actions");
    expect(text).toContain("Method and assumptions");
    expect(text).toContain("91–180 days");
    expect(text).toContain("181–365 days");
    expect(text).toContain("3 items are missing a unit cost");
    expect(text).toContain("7 rows had a different number of columns");
    expect(text).toMatch(/Prepared [A-Z][a-z]{2} \d{1,2}, 2026/);
    expect(text).toContain("Page 2 of");

    for (const swedish of [
      "Lagerkapitalanalys",
      "Ekonomisk sammanfattning",
      "Prioriterade åtgärder",
      "Metod och antaganden",
      "Upprättad",
      "Sida ",
      "91–180 dagar",
      "artiklar saknar inköpspris",
      "rader hade ett annat antal kolumner",
    ]) {
      expect(text).not.toContain(swedish);
    }
  });

  test("svensk PDF behåller svensk copy, datum och varningar", async () => {
    const text = await render("sv");
    expect(text).toContain("Lagerkapitalanalys");
    expect(text).toContain("Ekonomisk sammanfattning");
    expect(text).toContain("Prioriterade åtgärder");
    expect(text).toContain("Metod och antaganden");
    expect(text).toContain("91–180 dagar");
    expect(text).toContain("181–365 dagar");
    expect(text).toContain("3 artiklar saknar inköpspris");
    expect(text).toContain("7 rader hade ett annat antal kolumner");
    expect(text).toMatch(/Upprättad \d{1,2} [a-zäöå]{3}\.? 2026/);
    expect(text).toContain("Sida 2 av");
    expect(text).not.toContain("Economic summary");
  });
});
