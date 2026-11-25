import { describe, expect, test } from "bun:test";
import type { AnalyzedItem } from "../src/analysis.ts";
import { buildProcurementView } from "../src/pages/procurement.ts";
import { csvNumber, orderColumns, orderCsv, orderFileName, orderGroups, orderXlsx } from "../src/procurement-export.ts";
import { readXlsx } from "../src/xlsx.ts";

function item(overrides: Partial<AnalyzedItem>): AnalyzedItem {
  return {
    sku: "A-1",
    name: "Artikel",
    category: "Kategori",
    shelfLifeDays: null,
    storage: null,
    supplier: "Leverantör A",
    stock: 10,
    reserved: 0,
    available: 10,
    cost: 10,
    price: 20,
    value: 100,
    soldPeriod: 120,
    revenuePeriod: 2400,
    avgMonthlyDemand: 10,
    monthlyDemand: null,
    monthsSinceLastSale: 0,
    coverDays: 30,
    leadTimeDays: 30,
    safetyStock: 5,
    reorderPoint: 20,
    overstockQty: 0,
    overstockValue: 0,
    stockoutRisk: false,
    abc: "A",
    xyz: null,
    action: "ok",
    actionValue: 0,
    ...overrides,
  };
}

function view() {
  return buildProcurementView([
    item({ sku: "Z-9", name: "Mutter", supplier: "Zeta", stock: 2, available: 2, reorderPoint: 30, avgMonthlyDemand: 12, cost: 5, moq: 25, coverDays: 1 }),
    item({ sku: "A-2", name: "Skruv", supplier: "Alfa", stock: 4, available: 4, reorderPoint: 40, avgMonthlyDemand: 30, cost: 2, moq: 10, coverDays: 2, stockoutRisk: true }),
    item({ sku: "A-1", name: "Bricka", supplier: "Alfa", stock: 8, available: 8, reorderPoint: 20, avgMonthlyDemand: 6, cost: 1, coverDays: 5 }),
    item({ sku: "U-1", name: "Okänd", supplier: null, stock: 0, available: 0, reorderPoint: 15, avgMonthlyDemand: 4, cost: 3, coverDays: 0 }),
  ]);
}

/** The CSV as rows, which is what a buyer's spreadsheet sees. */
function csvRows(csv: string): string[][] {
  return csv.replace(/^\ufeff/, "").split("\r\n").map((line) => line.split(";"));
}

describe("beställningsfilen", () => {
  test("grupperar per leverantör, rader utan leverantör sist", () => {
    const groups = orderGroups(view());
    expect(groups.map((group) => group.supplier)).toEqual(["Alfa", "Zeta", null]);
    // Within a supplier the most urgent article comes first.
    expect(groups[0]!.suggestions.map((s) => s.sku)).toEqual(["A-2", "A-1"]);
    expect(groups[0]!.orderValue).toBe(80 + 12); // (40 − 4) × 2 kr and (20 − 8) × 1 kr
  });

  test("kolumnerna bär kvantitet, MOQ och beställningspunkt i den ordningen", () => {
    const headers = orderColumns("sv").map((column) => column.header);
    const at = (label: string) => headers.indexOf(label);
    expect(headers[0]).toBe("Leverantör");
    expect(at("MOQ")).toBe(at("Att beställa") + 1);
    expect(at("Beställningspunkt")).toBe(at("MOQ") + 1);
    expect(headers).toContain("Inköpsvärde");
  });

  test("CSV:n grupperar raderna och bär rätt kvantitet mot MOQ", () => {
    const rows = csvRows(orderCsv(view(), "sv"));
    expect(rows).toHaveLength(5);
    expect(rows[0]![0]).toBe("Leverantör");
    expect(rows.slice(1).map((row) => row[0])).toEqual(["Alfa", "Alfa", "Zeta", "Okänd leverantör"]);

    const skruv = rows.find((row) => row[1] === "A-2")!;
    expect(skruv.slice(3, 6)).toEqual(["40", "10", "40"]); // (40 − 4) rounded up to the MOQ of 10
    expect(skruv[13]).toBe("Kritisk");
  });

  test("avrundar som vyn: 146,6 blir 147 i både CSV och Excel", () => {
    const fractional = buildProcurementView([
      item({ sku: "F-1", supplier: "Alfa", stock: 132.4, available: 132.4, reorderPoint: 146.6, avgMonthlyDemand: 30, leadTimeDays: 14.6, cost: 2, moq: 5, coverDays: 3 }),
    ]);
    const row = csvRows(orderCsv(fractional, "sv")).find((cells) => cells[1] === "F-1")!;
    expect(row[5]).toBe("147"); // beställningspunkt
    expect(row[6]).toBe("132"); // saldo
    expect(row[7]).toBe("132"); // tillgängligt
    expect(row[9]).toBe("15"); // ledtid
    // Every numeric cell is a bare integer: no decimals to misread.
    expect(row.slice(3, 13).every((cell) => /^-?\d+$/.test(cell))).toBe(true);

    const sheetRow = readXlsx(orderXlsx(fractional, "sv"))[1]!;
    expect(sheetRow.slice(5, 10)).toEqual(["147", "132", "132", "5", "15"]);
  });

  test("decimaler skrivs med kommatecken i svensk CSV så Excel läser dem som tal", () => {
    expect(csvNumber(12.5, "sv")).toBe("12,5");
    expect(csvNumber(12.5, "en")).toBe("12.5");
    // No group separator: "1 234" would become text in Excel.
    expect(csvNumber(1234, "sv")).toBe("1234");
    expect(csvNumber(-0.5, "sv")).toBe("-0,5");
  });

  test("CSV:n skyddar mot formelinjektion och citerar semikolon", () => {
    const risky = buildProcurementView([
      item({ sku: "X-1", name: "=HYPERLINK(\"http://x\";\"klicka\")", supplier: "Alfa", stock: 0, available: 0, reorderPoint: 30, avgMonthlyDemand: 10, coverDays: 0 }),
    ]);
    expect(orderCsv(risky, "sv")).toContain(`"'=HYPERLINK(""http://x"";""klicka"")"`);
  });

  test("Excel-filen går att läsa tillbaka med samma rubriker, ordning och antal rader", () => {
    const rows = readXlsx(orderXlsx(view(), "sv"));
    expect(rows).toHaveLength(5);
    expect(rows[0]).toEqual(orderColumns("sv").map((column) => column.header));
    expect(rows.slice(1).map((row) => row[0])).toEqual(["Alfa", "Alfa", "Zeta", "Okänd leverantör"]);
    expect(rows[1]!.slice(1, 4)).toEqual(["A-2", "Skruv", "40"]);
  });

  test("engelska rubriker när språket är engelska", () => {
    const headers = orderColumns("en").map((column) => column.header);
    expect(headers.slice(0, 4)).toEqual(["Supplier", "SKU", "Description", "To order"]);
    expect(headers).toContain("Reorder point");
  });

  test("filnamnet är daterat, leverantörskvalificerat och utan diakriter", () => {
    const scoped = buildProcurementView(
      [item({ sku: "Ö-1", supplier: "Åhléns & Söner", stock: 0, available: 0, reorderPoint: 20, avgMonthlyDemand: 10, coverDays: 0 })],
      { supplier: "Åhléns & Söner" },
    );
    const date = new Date("2026-11-23T10:00:00Z");
    expect(orderFileName(scoped, "csv", date)).toBe("bestallning-ahlens-soner-2026-11-23.csv");
    expect(orderFileName(view(), "xlsx", date)).toBe("bestallning-2026-11-23.xlsx");
  });

  test("tom vy ger en fil med bara rubriker, inte en trasig fil", () => {
    const empty = buildProcurementView([item({ sku: "OK", stock: 100, available: 100, reorderPoint: 20, avgMonthlyDemand: 1, coverDays: 400 })]);
    expect(orderGroups(empty)).toHaveLength(0);
    expect(csvRows(orderCsv(empty, "sv"))).toHaveLength(1);
    expect(readXlsx(orderXlsx(empty, "sv"))).toHaveLength(1);
  });
});
