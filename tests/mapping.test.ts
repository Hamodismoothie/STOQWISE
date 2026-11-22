import { describe, expect, test } from "bun:test";
import { detectMapping, parseMonthHeader } from "../src/mapping.ts";

describe("parseMonthHeader", () => {
  test("vanliga månadsformat", () => {
    expect(parseMonthHeader("2024-01")).toBe("2024-01");
    expect(parseMonthHeader("2024 1")).toBe("2024-01");
    expect(parseMonthHeader("202401")).toBe("2024-01");
    expect(parseMonthHeader("jan 2024")).toBe("2024-01");
    expect(parseMonthHeader("Januari 2024")).toBe("2024-01");
    expect(parseMonthHeader("2024 dec")).toBe("2024-12");
  });

  test("vanliga kolumner är inte månader", () => {
    expect(parseMonthHeader("Lagersaldo")).toBeNull();
    expect(parseMonthHeader("Inköpspris")).toBeNull();
    expect(parseMonthHeader("2024")).toBeNull();
    expect(parseMonthHeader("2024-13")).toBeNull();
  });
});

describe("detectMapping", () => {
  const headers = [
    "Artikelnummer", "Benämning", "Kategori", "Leverantör", "Lagersaldo",
    "Inköpspris", "Försäljningspris", "Ledtid dagar", "2024-01", "2024-02", "2024-03",
  ];
  const rows = [
    ["1001", "Skruvdragare 18V", "Verktyg", "Nordic Supply AB", "12", "899,00", "1 499,00", "30", "3", "5", "4"],
    ["1002", "Hammare 500g", "Verktyg", "Nordic Supply AB", "40", "79,50", "149,00", "21", "10", "12", "8"],
    ["1003", "Kabelsko 2,5", "El", "AH Trading", "300", "1,20", "3,90", "14", "120", "90", "110"],
  ];

  test("hittar alla svenska kolumner", () => {
    const mapping = detectMapping(headers, rows);
    expect(mapping.columns.sku).toBe(0);
    expect(mapping.columns.name).toBe(1);
    expect(mapping.columns.category).toBe(2);
    expect(mapping.columns.supplier).toBe(3);
    expect(mapping.columns.stock).toBe(4);
    expect(mapping.columns.cost).toBe(5);
    expect(mapping.columns.price).toBe(6);
    expect(mapping.columns.leadTime).toBe(7);
    expect(mapping.missingRequired).toEqual([]);
  });

  test("hittar månadskolumner i ordning", () => {
    const mapping = detectMapping(headers, rows);
    expect(mapping.monthColumns.map((m) => m.month)).toEqual(["2024-01", "2024-02", "2024-03"]);
    expect(mapping.demandMode).toBe("wide");
    expect(mapping.periodMonths).toBe(3);
  });

  test("engelska rubriker fungerar", () => {
    const mapping = detectMapping(
      ["SKU", "Description", "On hand", "Unit cost", "Qty sold"],
      [["A1", "Widget", "5", "10", "40"]],
    );
    expect(mapping.columns.sku).toBe(0);
    expect(mapping.columns.name).toBe(1);
    expect(mapping.columns.stock).toBe(2);
    expect(mapping.columns.cost).toBe(3);
    expect(mapping.columns.totalSold).toBe(4);
    expect(mapping.demandMode).toBe("total");
  });

  test("saknade obligatoriska kolumner rapporteras", () => {
    const mapping = detectMapping(["Artikel", "Saldo"], [["A1", "4"]]);
    expect(mapping.missingRequired).toContain("cost");
  });

  test("fallback via datatyp när rubriken är okänd", () => {
    const mapping = detectMapping(
      ["Kolumn 1", "Kolumn 2", "Kolumn 3", "Kolumn 4", "Kolumn 5"],
      [
        ["A-1", "En produkt med längre namn", "4", "12,50", "9"],
        ["A-2", "Annan produkt med namn", "7", "8,00", "3"],
        ["A-3", "Tredje produkten här", "2", "19,90", "6"],
        ["A-4", "Fjärde produkten här", "9", "4,50", "1"],
        ["A-5", "Femte produkten här", "1", "2,00", "8"],
      ],
    );
    expect(mapping.columns.sku).toBe(0);
    expect(mapping.columns.name).toBe(1);
  });
});
